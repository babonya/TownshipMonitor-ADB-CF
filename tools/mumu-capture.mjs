import {createDevice} from './device.mjs';
import {closeSync,readFileSync,unlinkSync,statSync,mkdirSync} from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import './adb.mjs';
import {MumuStore,sleep as defaultSleep} from './mumu-store.mjs';
import {acquireStateLock,atomic} from './mumu-persistence.mjs';
import {processOwner,assertNativeInputIdle} from './mumu-process-owner.mjs';
import {OBSERVATION_INTERVAL_MS,CAPTURE_POLL_MS,resultCaptureDueAt} from './mumu-timing.mjs';
import {waitDelay} from './mumu-wait.mjs';
const windowCaptureWaits=new Set(['WINDOW_UNAVAILABLE','WINDOW_CLOAKED','WINDOW_CHANGED_DURING_CAPTURE',
  'CAPTURE_GEOMETRY_CHANGED','WGC_GEOMETRY_MISMATCH','WGC_SURFACE_SIZE_MISMATCH']);
const androidCaptureWaits=new Set(['ADB_TARGET_NOT_FOREGROUND','ADB_DEVICE_NOT_READY','PROCESS_TIMEOUT']);

export async function runCapture(store,device,{maxCaptures=60,intervalMs=OBSERVATION_INTERVAL_MS,idleIntervalMs=Math.max(OBSERVATION_INTERVAL_MS,intervalMs),signal=null,onFrame=()=>{},getObservationSchedule=()=>null,renewBudget=()=>false,clock=Date.now,sleep=defaultSleep}={}) {
  if(!Number.isSafeInteger(maxCaptures) || maxCaptures<1 || !Number.isSafeInteger(intervalMs) || intervalMs<100)throw Error('CAPTURE_OPTIONS_INVALID');
  if(!Number.isSafeInteger(idleIntervalMs) || idleIntervalMs<intervalMs || idleIntervalMs>10000)throw Error('CAPTURE_OPTIONS_INVALID');
  if(typeof renewBudget!=='function')throw Error('CAPTURE_OPTIONS_INVALID');
  const lock=join(store.root,'capture.lock'),token=randomUUID();let fd;
  try{fd=acquireStateLock(lock,{owner:{...processOwner(),token},beforeRecover:()=>{if(store.load().session.provider==='google_play_windows')assertNativeInputIdle();}});}catch(e){if(e.message==='MUMU_STORE_BUSY')throw Error('CAPTURE_PRODUCER_ALREADY_RUNNING');throw e;}
  let captures=0,accepted=0,segmentCaptures=0,segments=1,lastHash=null,nextCaptureAt=clock(),cachedState=null,stateStamp=null,lastWaitKey=null;
  const servedActions=new Set();let lastScheduleKey=null,lastClock=clock();
  // Poll only file metadata while idle. Reload and verify the canonical ledger
  // when it changes, including actions issued by a separate input process.
  const currentState=()=>{
    const stat=statSync(store.file,{bigint:true}),stamp=stat.mtimeNs+':'+stat.ctimeNs+':'+stat.size;
    if(stamp!==stateStamp){cachedState=store.load();stateStamp=stamp;}
    return cachedState;
  };
  try{
    while(!signal?.aborted){
      const state=currentState();if(state.stopCapture)break;
      let owner;try{owner=JSON.parse(readFileSync(lock,'utf8'));}catch{}
      if(owner?.token!==token||owner.pid!==process.pid)throw Error('CAPTURE_PRODUCER_NOT_OWNED');
      // A budget is a segment boundary only when the owning controller agrees.
      // Keep this lease, absolute due times, served result IDs and callbacks;
      // reacquiring a producer would invalidate a confirmed idle schedule.
      if(segmentCaptures>=maxCaptures){
        if(renewBudget({state,captures,accepted,segments})!==true)break;
        segmentCaptures=0;segments++;
      }
      const now=clock(),schedule=getObservationSchedule(state),scheduleKey=JSON.stringify(schedule);
      if(now<lastClock||now-lastClock>60000)nextCaptureAt=now; // Reconnect/sleep/clock discontinuity needs observation.
      lastClock=now;
      if(schedule?.paused===true){await sleep(CAPTURE_POLL_MS);continue;}
      if(lastScheduleKey!==null&&scheduleKey!==lastScheduleKey)nextCaptureAt=Math.min(nextCaptureAt,now);
      lastScheduleKey=scheduleKey;
      const waitKey=JSON.stringify(state.observationWait??null);
      if(lastWaitKey!==null&&waitKey!==lastWaitKey)nextCaptureAt=Math.min(nextCaptureAt,clock());
      lastWaitKey=waitKey;
      if(state.scene.transitioning){await sleep(CAPTURE_POLL_MS);continue;}
      const action=state.actions[state.input],due=resultCaptureDueAt(action);
      // A newly issued input wakes the regular observation wait. Even when the
      // next regular frame is earlier, the post-input settling floor still wins.
      const refreshDue=state.observationRefresh&&!state.observationRefresh.firstFrameId;
      const regularRemaining=refreshDue?0:nextCaptureAt-clock(),settlingRemaining=due===null?0:due-store.clock();
      const remaining=due===null?regularRemaining:servedActions.has(action.id)?Math.max(regularRemaining,settlingRemaining):settlingRemaining;
      if(remaining>0){await sleep(Math.min(remaining,CAPTURE_POLL_MS));continue;}
      const started=clock(),context=store.context();
      let packet;
      try{packet=await device.capture({signal,resultAction:action});}
      catch(error){
        if(signal?.aborted&&['CAPTURE_CANCELLED','PROCESS_ABORTED'].includes(error.message))break;
        const recoverable=state.session.provider==='google_play_windows'?windowCaptureWaits.has(error.message):
          state.session.provider==='android_adb'&&(androidCaptureWaits.has(error.message)||/^PROCESS_FAILED:\d+$/.test(error.message));
        if(state.settings.workflowMode==='som'&&recoverable){
          if(signal?.aborted||store.load().stopCapture)break;
          await store.retry(()=>store.captureFailed(error.message));
          // [사용자 변경 2026-10-16] 게임이 꺼져 홈 화면이면 게임을 띄운다(android-adb-device.mjs launchGameIfHome).
          if(error.message==='ADB_TARGET_NOT_FOREGROUND'&&typeof device.launchGameIfHome==='function')
            await device.launchGameIfHome({signal}).catch(e=>console.error(`[android] game launch failed ${e.message}`));
          await onFrame({accepted:false,reason:error.message,recoverableCaptureError:true});
          const retryAt=clock()+3000;
          while(clock()<retryAt&&!signal?.aborted&&!currentState().stopCapture)await sleep(Math.min(CAPTURE_POLL_MS,retryAt-clock()));
          continue;
        }
        throw error;
      }
      captures++;segmentCaptures++;
      // Cancellation never publishes an ordinary frame or schedules matching.
      // An existing input/result remains canonical and is never replayed here.
      const result=await store.retry(()=>signal?.aborted||store.load().stopCapture?null:store.publish(packet,context));
      if(!result)break;if(result.accepted)accepted++;
      if(due!==null && context.scene.epoch===action.epoch)servedActions.add(action.id);
      // The optional sidecar receives the same accepted PNG bytes, even when a
      // later publisher supersedes the ordinary frame file. Existing callbacks
      // keep their first argument; the matching callback only enqueues work.
      if(!signal?.aborted)await onFrame(result,result.accepted?{bytes:packet.bytes}:null);
      const unchanged=result.accepted && result.frame.evidenceHash===lastHash;lastHash=result.frame?.evidenceHash??null;
      const after=store.load(),eventDelay=waitDelay(after,store.clock());lastWaitKey=JSON.stringify(after.observationWait??null);
      const programSchedule=getObservationSchedule(after);lastScheduleKey=JSON.stringify(programSchedule);lastClock=clock();
      const programDue=Date.parse(programSchedule?.nextObservationAt??'');
      nextCaptureAt=result.reason==='queue_full'?clock()+Math.max(1000,intervalMs*2):Number.isFinite(programDue)?Math.min(programDue,eventDelay===null?Infinity:clock()+eventDelay):eventDelay!==null?clock()+eventDelay:started+(unchanged?idleIntervalMs:intervalMs);
    }
    return {captures,accepted,stopped:signal?.aborted || !!store.load().stopCapture,segments};
  }catch(error){
    // Failure evidence only; never replace the original error or retry capture.
    if(error.bridgeDiagnostic?.op==='capture')try{
      const dir=join(store.root,'.monitor');mkdirSync(dir,{recursive:true});
      atomic(join(dir,'capture-diagnostic.json'),{schema:1,recordedAt:new Date().toISOString(),captureOwner:{pid:process.pid,token},diagnostic:error.bridgeDiagnostic});
    }catch{}
    await store.retry(()=>store.captureFailed(error.message));throw error;
  }
  finally{closeSync(fd);let owner;try{owner=JSON.parse(readFileSync(lock,'utf8'));}catch{}
    if(owner?.token===token)unlinkSync(lock);}
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [root,max='60',interval=String(OBSERVATION_INTERVAL_MS),idle,...extra]=process.argv.slice(2);if(!root || extra.length)throw Error('Usage: node tools/mumu-capture.mjs ROOT [MAX_CAPTURES] [INTERVAL_MS] [IDLE_INTERVAL_MS]');
    const store=new MumuStore({root}),controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
    const result=await runCapture(store,createDevice(store.load().session),{maxCaptures:Number(max),intervalMs:Number(interval),idleIntervalMs:idle===undefined?Math.max(3000,Number(interval)):Number(idle),signal:controller.signal,
      onFrame:r=>process.stdout.write(JSON.stringify({kind:'capture',accepted:r.accepted,reason:r.reason??null,frameId:r.frame?.id??null,sequence:r.frame?.sequence??null,required:r.frame?.required??false,
        observedAt:r.frame?.observedAt??null,captureStartedAt:r.frame?.captureStartedAt??null,durationMs:r.frame?Date.parse(r.frame.observedAt)-Date.parse(r.frame.captureStartedAt):null})+'\n')});
    process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n');process.exitCode=1;}
}
