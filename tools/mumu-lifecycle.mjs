import { AdbDevice,runProcess,digest } from './adb.mjs';
import { prepareReview } from './mumu-operator.mjs';

// Official installed MuMu API; no shell, emulator restart, data reset or UI input.
export const MANAGER_EXE='C:\\Program Files\\Netease\\MuMuPlayer\\nx_main\\MuMuManager.exe';
const PACKAGE='com.playrix.township';
const LAUNCHER='app.lawnchair/.LawnchairLauncher';
const validId=s=>typeof s==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
const fail=code=>{throw Error(code);};
function authority(s,args){
  if(s.session.provider&&s.session.provider!=='mumu_adb')fail('LIFECYCLE_PROVIDER_UNSUPPORTED');
  if(s.stopCapture || s.stopReader)fail('SESSION_STOPPED');
  if(args.source!=='explicit_user' || !args.reason?.trim() || args.sessionId!==s.session.id || s.session.packageName!==PACKAGE || s.session.management?.source!=='explicit_user' || s.session.management?.scope!=='transport_no_tcash')fail('LAUNCH_AUTHORIZATION_REQUIRED');
}
export class MumuLauncher {
  constructor(session,{runner=runProcess}={}){this.session=session;this.runner=runner;this.device=new AdbDevice({...session,runner});}
  async preflight(){
    const info=JSON.parse((await this.runner(MANAGER_EXE,['info','-v','0'])).stdout.toString('utf8'));
    if(String(info.index)!=='0' || info.error_code!==0 || info.is_android_started!==true || info.is_process_started!==true || info.player_state!=='start_finished' || `${info.adb_host_ip}:${info.adb_port}`!==this.session.serial)fail('LAUNCH_INSTANCE_MISMATCH');
    if((await this.device.command(['get-state'])).stdout.toString('utf8').trim()!=='device')fail('ADB_NOT_CONNECTED');
    const window=(await this.device.command(['shell','dumpsys','window'])).stdout.toString('utf8');
    const focus=window.split(/\r?\n/).filter(l=>/mCurrentFocus=/.test(l));
    if(focus.length!==1 || !/(?:\s|\{)app\.lawnchair\/(?:\.LawnchairLauncher|app\.lawnchair\.LawnchairLauncher)(?:\s|\})/.test(focus[0]))fail('LAUNCH_LAUNCHER_REQUIRED');
    const names=(await this.device.command(['shell','ps','-A','-o','NAME'])).stdout.toString('utf8').trim().split(/\r?\n/).map(l=>l.trim());
    if(names[0]!=='NAME' || names.some(n=>n===PACKAGE || n.startsWith(PACKAGE+':')))fail('LAUNCH_PROCESS_ABSENCE_REQUIRED');
    return {instance:0,serial:this.session.serial,packageName:PACKAGE,foreground:LAUNCHER,processAbsent:true};
  }
  async launch(){return this.runner(MANAGER_EXE,['control','-v','0','app','launch','--package',PACKAGE]);}
}
export async function launchTownship(store,args={},options={}){
  if(!validId(args.actionId) || !validId(args.visitId))fail('LAUNCH_REQUEST_INVALID');
  const requestDigest=digest(Buffer.from(JSON.stringify(args)));
  const begun=await store.retry(()=>store.transact(s=>{
    authority(s,args);
    if(s.actions[args.actionId]){const a=s.actions[args.actionId];if(!a.lifecycle || a.requestDigest!==requestDigest)fail('ACTION_ID_COLLISION');return {duplicate:true,action:a};}
    if(s.input)fail('INPUT_UNRESOLVED');
    if(s.visits[args.visitId])fail('VISIT_ID_REUSED');
    s.input=args.actionId;s.scene={...s.scene,epoch:s.scene.epoch+1,transitioning:true};
    const a={id:args.actionId,lifecycle:'launch_township',requestDigest,authorization:{source:args.source,reason:args.reason},status:'pending',epoch:s.scene.epoch,at:new Date(store.clock()).toISOString(),nextVisit:{visitId:args.visitId,kind:'unknown'}};
    s.actions[a.id]=a;return {duplicate:false,action:a,session:s.session};
  }));
  if(begun.duplicate)return begun;
  const launcher=options.launcher??new MumuLauncher(begun.session);
  let attempted=false;
  try{
    const preflightStartedAt=store.clock();
    const evidence=await launcher.preflight();
    await store.retry(()=>store.transact(s=>{
      authority(s,args);
      if(store.clock()-preflightStartedAt<0 || store.clock()-preflightStartedAt>10000)fail('LAUNCH_PREFLIGHT_STALE');
      const a=s.actions[args.actionId];if(s.input!==a?.id || a.status!=='pending')fail('ACTION_NOT_PENDING');
      a.preflight={...evidence,observedAt:new Date(store.clock()).toISOString()};
      a.inputReservedAt=new Date(store.clock()).toISOString();return null;
    }));
    attempted=true;
    const result=await launcher.launch();
    const output=result.stdout.toString('utf8').trim();
    await store.retry(()=>store.transact(s=>{const a=s.actions[args.actionId];if(s.input!==a?.id || a.status!=='pending')fail('ACTION_NOT_PENDING');a.managerResponse={output:output.slice(0,16384),hash:digest(result.stdout),truncated:output.length>16384,exitCode:0};return null;}));
    // A nonzero official result is uncertain after invocation, never retry it.
    if(output){const response=JSON.parse(output);if(Object.hasOwn(response,'error_code') && response.error_code!==0)fail('LAUNCH_MANAGER_REJECTED');}
    const action=await store.retry(()=>store.finishAction(args.actionId,null,{inputAttempted:true}));
    return {duplicate:false,action,next:'FRESH_GPT_RESULT_REQUIRED'};
  }catch(error){
    await store.retry(()=>store.finishAction(args.actionId,error.message,{inputAttempted:attempted}));
    throw error;
  }
}
function freshLaunchVisualResult(frame,action,{now,notBefore,actionId,frameId}){
  const review=frame?.review,observed=Date.parse(frame?.observedAt),age=now-observed;
  return [observed,age,...notBefore].every(Number.isFinite)&&age>=0&&age<=30000&&
    notBefore.every(time=>observed>=time)&&frame.epoch===action.epoch&&
    review?.status==='accepted'&&review.reviewedBy==='GPT'&&review.quality.gameVisible&&!review.quality.occluded&&
    review.actualKind!=='unknown'&&!review.targets.length&&review.data.launchResult?.actionId===actionId&&
    review.data.launchResult?.frameId===frameId&&review.data.launchResult?.confirmed===true;
}
export function confirmTownshipLaunch(store,{actionId,frameId}={}){
  store.evidence(frameId);
  return store.transact(s=>{
    if(s.stopCapture || s.stopReader)fail('SESSION_STOPPED');
    const a=s.actions[actionId],f=s.frames[frameId],r=f?.review;
    if(s.input!==actionId || a?.lifecycle!=='launch_township' || !['issued','captured'].includes(a.status))fail('LAUNCH_ISSUED_RESULT_REQUIRED');
    if(f?.epoch!==s.scene.epoch||!freshLaunchVisualResult(f,a,{now:store.clock(),notBefore:[Date.parse(a.issuedAt)],actionId,frameId}))fail('LAUNCH_FRESH_VISUAL_RESULT_REQUIRED');
    a.status='verified';a.resultFrameId=frameId;a.resultObservedAt=f.observedAt;a.verifiedAt=new Date(store.clock()).toISOString();a.actualKind=r.actualKind;s.input=null;return a;
  });
}

function unknownLaunch(s,args){
  authority(s,args);
  const a=s.actions[args.actionId];
  if(s.input!==args.actionId || a?.lifecycle!=='launch_township' || a.status!=='unknown' || a.inputAttempted!==true || a.epoch!==s.scene.epoch)fail('UNKNOWN_LAUNCH_REQUIRED');
  return a;
}
// Observation only: keep the unknown action and shared input lock intact.
export async function prepareTownshipLaunchResult(store,args={},options={}){
  const initial=store.load();unknownLaunch(initial,args);
  const device=options.device??new AdbDevice(initial.session);
  await device.assertTarget();
  await store.retry(()=>store.transact(s=>{
    const a=unknownLaunch(s,args),v=a.nextVisit;
    if(s.visits[v.visitId] && s.scene.id!==v.visitId)fail('VISIT_ID_REUSED');
    s.scene={id:v.visitId,kind:'unknown',entityId:null,epoch:a.epoch,required:true,roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
    s.visits[v.visitId]??={...structuredClone(s.scene),startedAt:new Date(store.clock()).toISOString(),frameId:null,status:'awaiting_capture'};
    a.observationReconciliation={source:args.source,reason:args.reason,preparedAt:new Date(store.clock()).toISOString()};
    return null;
  }));
  return prepareReview(store,{fresh:true,pin:true,ocr:false},{device});
}
// Resolve only a launch postcondition, never an unknown game/navigation input.
export async function reconcileTownshipLaunch(store,args={},options={}){
  store.evidence(args.frameId);
  const initial=store.load();unknownLaunch(initial,args);
  const device=options.device??new AdbDevice(initial.session);
  await device.assertTarget();
  return store.retry(()=>store.transact(s=>{
    const a=unknownLaunch(s,args),f=s.frames[args.frameId],r=f?.review;
    if(!freshLaunchVisualResult(f,a,{now:store.clock(),notBefore:[Date.parse(a.finishedAt),Date.parse(a.observationReconciliation?.preparedAt)],actionId:a.id,frameId:f?.id}))fail('LAUNCH_FRESH_VISUAL_RESULT_REQUIRED');
    a.priorStatus='unknown';a.status='verified';a.outcome='observed_launch_postcondition';a.resultFrameId=f.id;a.resultObservedAt=f.observedAt;a.actualKind=r.actualKind;a.verifiedAt=new Date(store.clock()).toISOString();a.foregroundConfirmedAt=a.verifiedAt;s.input=null;
    return a;
  }));
}
