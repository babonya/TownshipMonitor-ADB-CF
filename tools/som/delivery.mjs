import {SomWorkflow} from './workflow.mjs';
import {resultOutcome,somActionPolicy,canReplanNavigation,canReplanCompletedSend,canReplanCompletedAction,completedSomInput,isDisposableNavigation,validateIntent} from './actions.mjs';
import {visionProof} from './geometry.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {recordMinigameEvent} from './minigame-events.mjs';
import {SomClient} from './client.mjs';
import {DealerSearch} from './dealer.mjs';
import {captureOwner,somGuard,issueSomInput} from './input.mjs';
import {saveDeliveryStatus,isPresentationIoError} from '../mumu-delivery-status.mjs';
import {resultCaptureReady} from '../mumu-timing.mjs';
import {hasUnresolvedActions} from '../mumu-input-state.mjs';
import {NeedImages} from './need-images.mjs';
import {recordDailyDelivery} from '../mumu-daily-deliveries.mjs';
import {failedProductArchive} from './failed-products.mjs';
import {MarketSessionStore} from './market-session-store.mjs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DEFAULT_PYTHON} from '../mumu-perception-bridge.mjs';
const MINIGAME_KEEPALIVE_MS=180000;
// [사용자 변경 2026-10-15] 마을 카메라 복원(addons/town-camera). stdout은 모니터 프로토콜이라 버리고 stderr만 넘긴다.
const TOWN_CAMERA_SCRIPT=fileURLToPath(new URL('../../addons/town-camera/town_camera.py',import.meta.url));
const TOWN_CAMERA_ATTEMPTS=3;
function restoreTownCamera(serial,signal){
  return new Promise(resolve=>{
    const child=spawn(DEFAULT_PYTHON,['-I',TOWN_CAMERA_SCRIPT,'--serial',serial],{windowsHide:true,stdio:['ignore','ignore','pipe'],signal,timeout:180000});
    child.stderr.on('data',d=>console.error(String(d).trimEnd()));
    child.on('error',()=>resolve(-1));child.on('close',code=>resolve(code));
  });
}
// [사용자 변경 2026-10-14] 미니게임 주문은 하지 않아도 된다 - 멈추지 않고 새로고침 대기 주문처럼 바꿔
// 다른 사람 주문(빨강·초록 핀)을 고른다. 모두 대기면 기존대로 닫고 마을로 간다. 아래 keepalive 분기에는 도달하지 않는다.
const skipMinigame=v=>v?.scene==='helicopter'&&v.minigame?.detected===true?
  {...v,minigame:null,refreshing:true,send:null,trash:null,missing:[],orderSlots:[],shortageChecks:[],orderHash:null,orderLimit:null}:v;
export class SomDelivery{
  constructor(store,{device,worker,signal,onEvent=()=>{},onDeliveryCompleted=()=>{},client=new SomClient({signal}),issue=issueSomInput}={}){
    Object.assign(this,{store,device,worker,signal,onEvent,onDeliveryCompleted,client,issue});this.dealerSearch=worker?.dealerSearch??new DealerSearch();
    this.dealerSearch.clock=()=>this.store.clock();this.dealerSearch.nextAt=this.store.load?.()?.somDealerSearchAfter??0;
    this.flow=new SomWorkflow({clock:()=>this.store.clock(),dealerSearch:this.dealerSearch,archiveFailedProduct:failedProductArchive()});this.busy=false;this.closed=false;
    const initial=this.store.load?.();
    if(store.root&&initial?.session?.provider==='android_adb'){
      this.sessionStore=new MarketSessionStore(store.root,{clock:()=>store.clock()});
      this.flow.marketSession=this.sessionStore.load(initial,{archive:this.flow.archiveFailedProduct});
    }
    this.state={phase:'ready',reason:null,...this.flow.summary()};this.nextAt=store.clock();
  }
  status(){return {...this.state,...this.flow.summary(),...(this.minigameRequest?{phase:'minigame_requesting'}:{}),running:!this.closed&&!this.minigameRequest,
    minigame:this.minigameRequest??null,executionAllowed:false};}
  resolveMinigame(){
    if(this.resolution)return this.resolution;
    if(this.closed||!this.minigameRequest)throw Error('MINIGAME_NOT_REQUESTING');
    if(this.busy||this.store.load().input||hasUnresolvedActions(this.store.load().actions))throw Error('INPUT_UNRESOLVED');
    const request=this.minigameRequest;request.resolving=true;this.update('minigame_requesting');
    this.resolution=(async()=>{
      await delay(1000);
      if(this.closed||this.signal?.aborted||this.minigameRequest!==request)throw Error('MINIGAME_RESOLUTION_CANCELLED');
      recordMinigameEvent(this.store,'resolved');
      // Rebuild temporary decisions from a new screen after external play.
      this.flow=new SomWorkflow({clock:()=>this.store.clock(),dealerSearch:this.dealerSearch,archiveFailedProduct:failedProductArchive()});this.minigameRequest=null;this.nextAt=this.store.clock();
      this.update('ready');return {resolved:true,delayMs:1000};
    })().finally(()=>{this.resolution=null;if(this.minigameRequest===request){request.resolving=false;this.update('minigame_requesting');}});
    return this.resolution;
  }
  saveMarketSession(){
    if(!this.owner||!this.sessionStore)return;
    try{this.sessionStore.save(this.flow.marketSession,this.store.load());this.sessionSaveError=null;}
    catch(error){this.sessionSaveError=error.code??error.message;}
  }
  update(phase,reason=null){this.saveMarketSession();this.state={phase,reason,...this.flow.summary()};const saved=saveDeliveryStatus(this.store,this.owner,this.status());this.onEvent({...this.status(),...(saved?.saved===false?{presentationError:saved.error}:{}),...(this.sessionSaveError?{sessionSaveError:this.sessionSaveError}:{})});}
  observationSchedule(){return this.minigameRequest?.resolving?{paused:true,reason:'minigame_requesting'}:
    {nextObservationAt:new Date(this.nextAt).toISOString(),reason:this.minigameRequest?'minigame_requesting':'som_current_screen'};}
  saveNeeds(frame){
    this.needImages??=new NeedImages(this.store.root);
    const session=this.flow.marketSession;session?.expire(this.store.clock());
    return this.needImages.save(this.flow.needs,{frame,state:this.store.load(),cycle:this.flow.cycle,
      failedProducts:session?.products.filter(p=>p.failed)??[],marketSessionId:session?.id??null,marketDeadline:session?.deadline??null});
  }
  async onFrame(frame,result){
    if(this.closed||this.busy||this.signal?.aborted||this.minigameRequest?.resolving)return;this.busy=true;
    try{
      const state=this.store.load();if(state.stopCapture||state.stopReader)return;
      if(this.minigameRequest&&!state.input&&this.store.clock()<this.nextAt)return;
      this.owner??=captureOwner(this.store);
      if(state.session.provider==='android_adb'&&result?.reason==='ANDROID_PROFILE_REQUIRED')return this.update('hold','ANDROID_PROFILE_REQUIRED');
      if(!result?.som||result.frameId!==frame.id||result.evidenceHash!==frame.evidenceHash||result.epoch!==frame.epoch||result.sequence!==frame.sequence||
        state.latestFrameId!==frame.id||state.scene.epoch!==frame.epoch)throw Error('SOM_CURRENT_OBSERVATION_REQUIRED');
      const v=skipMinigame(result.som);
      // Refresh restored failure tiles on the first owned current observation,
      // including popup/result waits that do not reach ordinary planning.
      if(!this.needImages)try{this.saveNeeds(frame);}catch(error){if(!isPresentationIoError(error))throw error;}
      // Consume the observation once; SOM decisions already bind its crops.
      this.store.transact(s=>{const f=s.frames[frame.id];f.job.status='done';f.ocrRequested=false;f.som={schema:1,scene:v.scene,visionHash:visionProof(v),profileHash:v.profileHash};});
      const pending=state.actions[state.input];
      if(pending){
        somGuard(this.store,state,{owner:this.owner,settling:pending.id,signal:this.signal});
        if(!pending.target?.som||!['issued','captured'].includes(pending.status))throw Error('INPUT_UNRESOLVED');
        if(frame.epoch!==pending.epoch||!resultCaptureReady(pending,frame)||!pending.deviceReceipt?.commandIssued||pending.somProof?.profileHash!==v.profileHash||
          state.frames[pending.frameId]?.evidenceHash!==pending.somProof?.evidenceHash)throw Error('SOM_RESULT_BINDING_REQUIRED');
        let outcome=resultOutcome(v,pending.target.som);
        if(!outcome){
          const expired=this.store.clock()-Date.parse(pending.issuedAt)>somActionPolicy(pending.target.som.kind).resultTimeoutMs;
          if(expired&&(canReplanNavigation(v,pending.target.som)||canReplanCompletedSend(v,pending)))outcome='replanned_from_current_screen';
          else if(expired&&canReplanCompletedAction(v,pending))outcome='unconfirmed';
          else{
            const reason=expired?(isDisposableNavigation(pending.target.som)?'SOM_CURRENT_SCREEN_REQUIRED':'SOM_RESULT_REVIEW_REQUIRED'):null;
            this.nextAt=this.store.clock()+(expired?3000:v.motionPending?100:300)/* [2026-10-19 raw 캡처라 빨라져 대기 단축] 600→300 */;this.update('waiting_result',reason);return;
          }
        }
        // [사용자 변경 2026-10-15] SEND 두 번(보내기+애니메이션 건너뛰기)을 다 누르고 헬기·마을로 정상 복귀한 경우도
        // 납품 1건으로 센다(미니게임 주문이 선택돼 결과 확인이 안 되는 경우 누락 방지).
        const delivered=pending.target.som.kind==='som_send'&&(outcome==='confirmed'||outcome==='replanned_from_current_screen'&&canReplanCompletedSend(v,pending));
        this.store.transact(s=>{const a=s.actions[pending.id];if(s.input!==pending.id||!['issued','captured'].includes(a.status))throw Error('INPUT_UNRESOLVED');
          a.status=['replanned_from_current_screen','unconfirmed'].includes(outcome)?'superseded_by_observation':'verified';a.outcome=outcome;a.resultFrameId=frame.id;a.resultObservedAt=frame.observedAt;
          a.somResult={schema:1,frameId:frame.id,evidenceHash:frame.evidenceHash,visionHash:visionProof(v),outcome};s.frames[frame.id].required=true;s.input=null;
          if(delivered)recordDailyDelivery(s,this.store.clock());});
        // Count only the committed result of one Send, never the animation-skip
        // click, an interrupted action, or another reading of the same frame.
        if(delivered)this.onDeliveryCompleted();
        if(outcome==='replanned_from_current_screen'){
          if(pending.target.som.kind==='som_send'){
            // Discard temporary order decisions, retaining the common market
            // refresh-period policy. The old Send is neither success nor failure.
            this.flow.reset();this.flow.destination='helicopter';this.flow.marketSession?.navigated();
          }else if(state.session.provider==='android_adb'){this.flow.survey.reset();this.flow.market.scrollAlignment=null;}
          else this.flow=new SomWorkflow({clock:()=>this.store.clock(),dealerSearch:this.dealerSearch,archiveFailedProduct:failedProductArchive()});
          this.flow.phase='recovering_navigation';
        }else if(outcome==='unconfirmed'||pending.target.som.kind==='som_barn_sell'&&outcome!=='confirmed'&&completedSomInput(pending))this.flow.recoverCompleted(pending.target.som,v);
        else if(pending.target.som.kind!=='som_minigame_keepalive')this.flow.settle(pending.target.som,v,outcome);
      }else if(hasUnresolvedActions(state.actions))throw Error('INPUT_UNRESOLVED');
      somGuard(this.store,this.store.load(),{owner:this.owner,signal:this.signal});
      if(this.minigameRequest){
        const request=this.minigameRequest,now=this.store.clock();
        this.nextAt=request.nextClickAt;
        if(now<request.nextClickAt){this.update('minigame_requesting');return;}
        // Reuse this fresh observation for both screen/target checks and input.
        request.nextClickAt=now+MINIGAME_KEEPALIVE_MS;this.nextAt=request.nextClickAt;
        const intent={kind:'som_minigame_keepalive',box:v.helicopterTitle,next:'helicopter'};
        if(validateIntent(v,intent,now)){
          await this.issue(this.store,frame,v,intent,{device:this.device,worker:this.worker,owner:this.owner,signal:this.signal});
          this.nextAt=this.store.clock()+1000;
        }
        this.update('minigame_requesting');return;
      }
      if(v.scene==='helicopter'&&v.minigame?.detected===true){
        this.nextAt=this.store.clock()+MINIGAME_KEEPALIVE_MS;
        this.minigameRequest={frameId:frame.id,evidenceHash:frame.evidenceHash,requestedAt:new Date(this.store.clock()).toISOString(),resolving:false,nextClickAt:this.nextAt};
        recordMinigameEvent(this.store,'requested');
        this.update('minigame_requesting');return;
      }
      // [사용자 변경 2026-10-15] 사람이 마을 카메라를 옮기면 고정 좌표가 다른 건물을 가리킨다. 비전이 cameraMismatch를
      // 알리면 시장·창고를 누르지 않고 카메라를 기준으로 복원한 뒤 새 화면을 다시 관측한다. 연속 3번 실패하면 멈춘다.
      if(v.scene==='town'&&state.session.provider==='android_adb'){
        if(!v.cameraMismatch)this.townCameraAttempts=0;
        else{
          if((this.townCameraAttempts??0)>=TOWN_CAMERA_ATTEMPTS){this.nextAt=this.store.clock()+3000;this.update('hold','TOWN_CAMERA_UNRESTORED');return;}
          this.townCameraAttempts=(this.townCameraAttempts??0)+1;this.update('recovering_camera');
          const code=await restoreTownCamera(state.session.serial,this.signal);
          console.error(`[som] town_camera restore exit=${code} attempt=${this.townCameraAttempts}`);
          this.nextAt=this.store.clock()+1500;return;
        }
      }
      const intent=await this.flow.plan(v,this.client);
      try{this.saveNeeds(frame);}catch(error){if(!isPresentationIoError(error))throw error;this.onEvent({phase:'presentation_error',reason:error.code,executionAllowed:false});}
      if(!intent||intent.waitMs){
        if(!intent&&this.missingTargetFrame!==frame.id){this.missingTargetFrame=frame.id;this.missingTargetReads=(this.missingTargetReads??0)+1;}
        if(intent)this.missingTargetReads=0;
        const reason=intent?.reason??(!intent&&this.missingTargetReads>=2?(v.scene==='unknown'?'SOM_SCREEN_UNIDENTIFIED':'SOM_CURRENT_TARGET_REQUIRED'):'SOM_SUPPORTED_TARGET_NOT_VISIBLE');
        this.nextAt=this.store.clock()+(intent?.waitMs??1500)/* [2026-10-19 raw 캡처라 빨라져 대기 단축] 3000→1500 */;this.update(intent?.reason||!intent&&this.missingTargetReads>=2?'hold':intent?'idle':'recognizing',reason);return;
      }
      this.missingTargetReads=0;this.missingTargetFrame=null;
      this.nextAt=this.store.clock()+400;this.update('acting');
      await this.issue(this.store,frame,v,intent,{device:this.device,worker:this.worker,owner:this.owner,signal:this.signal});
      if(intent.kind==='som_dealer_buy'&&!this.store.load().input){
        this.dealerSearch.nextAt=this.store.load().somDealerSearchAfter??this.dealerSearch.nextAt;
        this.update('ready');
      }else this.update('waiting_result');
    }catch(error){this.nextAt=this.store.clock()+3000;this.update('hold',error.message);
      if(this.store.load().input||['INPUT_UNRESOLVED','CAPTURE_PRODUCER_NOT_OWNED','FOREIGN_INPUT_OWNER'].includes(error.message))throw error;
    }finally{this.busy=false;}
  }
  close(){this.saveMarketSession();this.closed=true;this.minigameRequest=null;this.flow.needs.clear();}
}
