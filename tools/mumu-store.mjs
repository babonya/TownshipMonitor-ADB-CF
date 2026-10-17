import {BARN_READER,validBarnTarget,validateBarnInput} from './mumu-barn-sale-proof.mjs';
import {barnSaleResult} from './mumu-barn-sale-result.mjs';
import {reserveBarnSale,settleBarnSale} from './mumu-barn-recovery.mjs';
import {beginActionTransition,captureActionTransition,finishActionTransition,verifyActionTransition,verifyUnexpectedViewTransition} from './mumu-action-transitions.mjs';
import {validateFrameProofs} from './mumu-review-validation.mjs';
import {inputGeometry,commandForTarget,resolvePercentageCommand} from './percentage-coordinates.mjs';
import {HELICOPTER_INFO_READER,validateHelicopterInfoProof,validateHelicopterInfoSource,helicopterInfoResult,verifyHelicopterInfoPreflight} from './mumu-helicopter-info-proof.mjs';
import {retainStateRecords} from './mumu-retention.mjs';
import {pruneCaptureImages} from './mumu-image-retention.mjs';
import {pruneAdbDispatch} from './android-adb-dispatch-retention.mjs';
import * as cupValidation from './mumu-mayors-cup-validation.mjs';
import {MARKET_READER,validateMarketProof,validNativeMarketTarget,validateMarketInput,verifyMarketPreflight} from './mumu-market-proof.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {assertInputSettled,assertResultSupported} from './mumu-input-state.mjs';
import {atomic,atomicBytes,acquireStateLock} from './mumu-persistence.mjs';
import {serializeStateEnvelope} from './mumu-state-envelope.mjs';
import {assertNativeInputIdle} from './mumu-process-owner.mjs';
export {atomic,acquireStateLock} from './mumu-persistence.mjs';
import {validateAirportLoadingProof,verifyAirportLoadingPreflight} from './mumu-airport-loading-proof.mjs';
import {readFileSync,existsSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {digest,decodePng,regionDigest,validateBox} from './adb.mjs';
import {validAdbNoInputProof} from './android-adb-device.mjs';
import {createDevice,deviceConfig,providerOf,validateDevicePacket} from './device.mjs';
import {WINDOWS_PROVIDER,compareWindowsGeometry,validWindowsNoInputProof} from './windows-device.mjs';
import {MANAGEMENT_KINDS,validateManagement,TRANSPORT_POLICY} from './mumu-management.mjs';
import {validateVerification,compareReviewedTarget} from './mumu-verification.mjs';
import {itemRegionsForPreflight} from './mumu-item-preflight.mjs';
import {assertOrderPolicy} from './mumu-order-policy.mjs';
import {orderDemandCurrent,orderInput,assertOrderStartupComplete} from './mumu-order-demand.mjs';
import {marketTicket,marketState,invalidateMarket,marketInput,recordMarketContents,getMarketContents} from './mumu-market-state.mjs';
import {exactReview,validateExactReview} from './mumu-program-review.mjs';
import {resultCaptureDueAt,resultCaptureReady,POST_INPUT_DELAY_MS} from './mumu-timing.mjs';
import {inputEvidenceValid,retainedReviewDeadline} from './mumu-freshness.mjs';
import {refreshProgress} from './mumu-refresh.mjs';
import {observationWait} from './mumu-wait.mjs';
import {PROGRAM_REVIEW_TOKEN,acceptedFacts,actionEffect,reviewFactHash,actionResultProof} from './mumu-evidence.mjs';
import {validateHelicopterProof,helicopterProfile,selectionCapability,selectionAttempts,selectionResult,miniGameSelectionResult,validateMiniGameSelectionSource} from './mumu-helicopter-proof.mjs';
import {validateTrainRewardProof,verifyTrainRewardPreflight,validTrainRewardSwipe} from './mumu-train-reward-proof.mjs';
import {validateTrainLoadingProof,verifyTrainLoadingPreflight,validNativeTrainLoad} from './mumu-train-loading-proof.mjs';

import {validateTransportNavigationProof,verifyTransportNavigationPreflight} from './mumu-transport-navigation-proof.mjs';
import {MAYORS_CUP_READER,validateProgramMayorsCupProof} from './mumu-mayors-cup-proof.mjs';
import {assertCupFirstBudget} from './mumu-cup-budget.mjs';
import {assertCupStageBudget} from './mumu-mayors-cup.mjs';
import {createCupOcrWorker,readCupOcr,validateCupOcr,cupActionStage} from './mumu-cup-ocr.mjs';

import {EVENT_CLOSE_READER,validateEventCloseReview,validateEventCloseSource,readEventClose,validateEventCloseOcr,eventCloseResult,eventCloseTarget} from './mumu-event-close.mjs';

export const MUMU_VERSION='mumu-pipeline-1';
// Read current bytes on every load, including stop/input guards. Only identical
// bytes may reuse a verified state serialization; every caller gets a new value.
const verifiedStateFiles=new WeakMap();
export const DEFAULT_MUMU_ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','runtime','mumu');
export const NAVIGATION_KINDS=['open_market','open_helicopter','open_airport','open_train','open_barn','select_customer','select_train','close_panel','market_scroll','barn_scroll','select_barn_category','inspect_item','town_scroll'];
// A visible in-game modal is its own scene. Do not relabel an obscured
// underlying station as unoccluded just to settle a navigation result.
const KINDS=['unknown','town','market','helicopter','airport','train','train_skin','received_products','barn','factory','mayors_cup_result'];
const fail=code=>{throw Error(code);};
const id=s=>typeof s==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
const integer=n=>Number.isSafeInteger(n) && n>=0;
const clone=v=>structuredClone(v);
function receivedProductsTarget(target){
  const m=target.management,r=m?.receipt;
  if(target.kind!=='collect_product' || target.type!=='tap' || m?.currency!=='NONE' || m?.source!=='received_products' || !Number.isSafeInteger(m?.quantity) || m.quantity<1 || r?.title!=='PRODUCTS RECEIVED!' || r?.prompt!=='TAP TO CLAIM' || typeof r?.sender!=='string' || !r.sender.trim() || !target.verification?.criticalRegions?.some(region=>region.field==='quantity'))fail('RECEIVED_PRODUCTS_CLAIM_ONLY');
}
function managementOrder(state,frame,target,now){
  if(target.kind!=='buy_market')return frame.review?.data?.order;
  const orderId=target.management?.orderId;
  if(target.marketNative?.schema===1&&target.management?.source==='current_market_bundle'){
    const needs=currentScreenNeeds(state,{now}),order=needs.orders.find(o=>o.orderId===orderId);
    if(!order||needs.held.some(h=>h.orderId===orderId)||!needs.allocations.some(a=>a.orderId===orderId&&a.itemId===target.management.itemId&&a.shortage>0))fail('CURRENT_PURCHASE_ORDER_REQUIRED');
    return {...order,kind:'normal',needs:order.originalNeeds};
  }
  const candidates=Object.values(state.frames).filter(f=>orderDemandCurrent(state,f)&&acceptedFacts(f)&&f.review.data?.order?.orderId===orderId).sort((a,b)=>b.sequence-a.sequence);
  const candidate=candidates[0];
  const settled=Object.values(state.actions).some(a=>a.status==='verified'&&
    [actionEffect(state,a)?.completedOrderId,actionEffect(state,a)?.deletedOrderId].includes(orderId));
  if(!candidate||!Number.isFinite(now)||!inputEvidenceValid(candidate,now,state)||
      candidate.review.data.order.kind!=='normal'||candidate.review.data.order.completed===true||settled||
      !['helicopter','train','airport'].includes(candidate.review.actualKind))fail('CURRENT_PURCHASE_ORDER_REQUIRED');
  return candidate.review.data.order;
}
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export class MumuStore {
  constructor({root=DEFAULT_MUMU_ROOT,clock=()=>Date.now()}={}) {
    this.root=resolve(root);this.clock=clock;mkdirSync(this.root,{recursive:true});
    this.evidenceRoot=join(this.root,'frames');mkdirSync(this.evidenceRoot,{recursive:true});
    this.file=join(this.root,'state.json');this.lockFile=join(this.root,'state.lock');
  }
  load() {
    if(!existsSync(this.file))fail('MUMU_SESSION_NOT_INITIALIZED');
    const bytes=readFileSync(this.file),cached=verifiedStateFiles.get(this);
    if(cached&&bytes.equals(cached.bytes))return JSON.parse(cached.stateJson);
    const envelope=JSON.parse(bytes),stateJson=JSON.stringify(envelope.state);
    if(envelope.version!==MUMU_VERSION || digest(Buffer.from(stateJson))!==envelope.checksum)fail('MUMU_STATE_INTEGRITY_ERROR');
    verifiedStateFiles.set(this,{bytes,stateJson});
    return envelope.state;
  }
  save(state){
    retainStateRecords(state,{now:this.clock()});
    const encoded=serializeStateEnvelope(MUMU_VERSION,state);
    atomicBytes(this.file,encoded.bytes);
    // Loads still compare current file bytes and return a freshly parsed object.
    verifiedStateFiles.set(this,encoded);
    pruneAdbDispatch(this.root,state);
    if(this.imageRetentionSequence!==state.sequence){
      const retention=pruneCaptureImages(this.root,state);
      if((retention.removed||retention.overflow||retention.errors.length||this.imageRetention?.removed||this.imageRetention?.overflow||this.imageRetention?.errors.length)&&
          JSON.stringify(retention)!==JSON.stringify(this.imageRetention))try{
        const dir=join(this.root,'.monitor');mkdirSync(dir,{recursive:true});
        atomic(join(dir,'image-retention.json'),retention);
      }catch{} // Cleanup/report failures must not invalidate the committed state.
      this.imageRetention=retention;
      this.imageRetentionSequence=state.sequence;
    }
  }
  captureProducerAlive(){
    const file=join(this.root,'capture.lock');if(!existsSync(file))return false;
    let lease;try{lease=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return false;throw e;}
    if(!Number.isSafeInteger(lease.pid)||lease.pid<1)fail('PRODUCER_LEASE_INVALID');
    try{process.kill(lease.pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;fail('PRODUCER_LIVENESS_UNCONFIRMED');}
  }
  transact(fn,{writeWhen=()=>true}={}) {
    const fd=acquireStateLock(this.lockFile,{beforeRecover:()=>{
      if(existsSync(this.file)){const state=this.load();if(state.session.provider==='google_play_windows')assertNativeInputIdle();}
    }});
    try{const state=this.load(),result=fn(state);if(writeWhen(result)){state.revision++;this.save(state);}return clone(result);}
    finally{closeSync(fd);unlinkSync(this.lockFile);}
  }
  async retry(fn,{attempts=100}={}) {
    for(let i=0;i<attempts;i++)try{return fn();}catch(e){if(e.message!=='MUMU_STORE_BUSY' || i===attempts-1)throw e;await sleep(10);}
  }
  init(config={}) {
    const {executable,serial,packageName='com.playrix.township',sessionId='mumu-'+randomUUID(),maxPending=24,maxOrdinary=8,recognitionMode='continuous'}=config;
    const device=deviceConfig({...config,executable,serial,packageName});
    if(!id(sessionId) || !integer(maxPending) || maxPending<2 || maxPending>500 || !integer(maxOrdinary) || maxOrdinary<2 || maxOrdinary>100 || !['continuous','on_demand'].includes(recognitionMode))fail('MUMU_CONFIG_INVALID');
    const fd=acquireStateLock(this.lockFile,{beforeRecover:()=>{
      if(existsSync(this.file)){const state=this.load();if(state.session.provider==='google_play_windows')assertNativeInputIdle();}
    }});
    try{
      if(existsSync(this.file))fail('MUMU_SESSION_EXISTS');
      const state={session:{id:sessionId,...device,startedAt:new Date(this.clock()).toISOString(),mode:'observation_only'},revision:0,sequence:0,
        settings:{maxPending,maxOrdinary,recognitionMode},scene:{id:'initial',kind:'unknown',entityId:null,epoch:1,required:false,roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null},
        frames:{},visits:{},actions:{},input:null,latestFrameId:null,latestCandidateFrameId:null,
        stats:{captures:0,accepted:0,superseded:0,backpressure:0,discardedTransition:0,completed:0,failed:0},captureError:null};
      this.save(state);return state;
    }finally{closeSync(fd);unlinkSync(this.lockFile);}
  }
  context(){const s=this.load();return {session:s.session,scene:s.scene,sequence:s.sequence};}
  configurePipeline({recognitionMode}={}) {
    if(!['continuous','on_demand'].includes(recognitionMode))fail('PIPELINE_CONFIG_INVALID');
    return this.transact(s=>{
      if(s.input)fail('INPUT_UNRESOLVED');s.settings.recognitionMode=recognitionMode;
      for(const f of Object.values(s.frames)){
        if(recognitionMode==='on_demand' && f.job.status==='ready' && !f.required && !f.ocrRequested)f.job.status='deferred';
        else if(recognitionMode==='continuous' && f.job.status==='deferred')f.job.status='ready';
      }return s.settings;
    });
  }
  pinFrame(frameId='latest',{ocr=true,regions=null}={}) {
    if(typeof ocr!=='boolean')fail('OCR_REQUEST_INVALID');
    return this.transact(s=>{
      const f=s.frames[frameId==='latest'?s.latestFrameId:frameId];if(!f)fail('FRAME_NOT_FOUND');
      if(regions!==null){
        if(!Array.isArray(regions) || !regions.length || regions.length>16 || regions.some(r=>!id(r.field)) || new Set(regions.map(r=>r.field)).size!==regions.length)fail('OCR_REGIONS_INVALID');
        for(const r of regions)validateBox(r.box,f.width,f.height);
        if(!['processing','done'].includes(f.job.status))f.ocrRegions=clone(regions);
      }
      f.required=true;f.ocrRequested=ocr;f.preparedAt=new Date(this.clock()).toISOString();
      if(ocr && f.job.status==='deferred')f.job.status='ready';
      if(!ocr && s.settings.recognitionMode==='on_demand' && f.job.status==='ready')f.job.status='deferred';
      return f;
    });
  }
  frameFile(frameId){if(!id(frameId))fail('FRAME_ID_INVALID');return join(this.evidenceRoot,frameId+'.png');}
  evidence(frameId) {
    const frame=this.load().frames[frameId];if(!frame)fail('FRAME_NOT_FOUND');
    const file=realpathSync(this.frameFile(frameId)),rel=relative(realpathSync(this.evidenceRoot),file);
    if(!rel || rel.startsWith('..') || isAbsolute(rel))fail('FRAME_OUTSIDE_ROOT');
    const bytes=readFileSync(file);if(digest(bytes)!==frame.evidenceHash)fail('FRAME_HASH_MISMATCH');
    const image=decodePng(bytes);if(image.width!==frame.width || image.height!==frame.height)fail('FRAME_GEOMETRY_MISMATCH');
    return {frame,bytes,image,file};
  }
  beginVisit({visitId,kind,entityId=null,roi=null,required=true}={}) {
    if(!id(visitId) || !KINDS.includes(kind) || (entityId!==null && !id(entityId)) || typeof required!=='boolean')fail('VISIT_INVALID');
    return this.transact(s=>{
      if(s.input)fail('INPUT_UNRESOLVED');
      if(s.visits[visitId])fail('VISIT_ID_REUSED');
      if(roi && s.session.width)validateBox(roi,s.session.width,s.session.height);
      const marketChanged=s.scene.kind==='market'||kind==='market'||!!s.marketView;
      s.scene={id:visitId,kind,entityId,epoch:s.scene.epoch+1,required,roi,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
      if(marketChanged)invalidateMarket(s,kind==='market'?'market_visit':'left_market');
      s.latestCandidateFrameId=null;
      s.visits[visitId]={...clone(s.scene),startedAt:new Date(this.clock()).toISOString(),status:'awaiting_capture',frameId:null};return s.scene;
    });
  }
  publish(packet,context,{preserveForReview=false}={}) {
    if(typeof preserveForReview!=='boolean')fail('REVIEW_PRESERVATION_INVALID');
    const image=packet.image??decodePng(packet.bytes),hash=digest(packet.bytes);
    const signature=regionDigest(image,context.scene.roi??undefined),retired=[];
    const result=this.transact(s=>{
      s.stats.captures++;
      validateDevicePacket(s.session,packet);
      if(context.scene.epoch!==s.scene.epoch || context.scene.id!==s.scene.id || s.scene.transitioning){s.stats.discardedTransition++;return {accepted:false,reason:'scene_changed'};}
      const due=resultCaptureDueAt(s.actions[s.input]);
      if(!resultCaptureReady(s.actions[s.input],{...packet,evidenceHash:hash})){
        s.stats.discardedTransition++;return {accepted:false,reason:'post_input_settling'};
      }
      if(s.session.width && (s.session.width!==image.width || s.session.height!==image.height))fail('CAPTURE_GEOMETRY_CHANGED');
      s.session.width=image.width;s.session.height=image.height;
      s.scene.stableCount=s.scene.lastSignature===signature?s.scene.stableCount+1:1;s.scene.lastSignature=signature;
      const required=s.scene.required && !s.scene.keyframeId && s.scene.stableCount>=2;
      // Only supersede an unclaimed, nonessential frame. Never remove in-flight evidence.
      for(const frame of Object.values(s.frames))if(!frame.required && !frame.review && ['ready','deferred'].includes(frame.job.status)){
        retired.push(frame.id);delete s.frames[frame.id];s.stats.superseded++;
      }
      const pending=Object.values(s.frames).filter(f=>['ready','processing'].includes(f.job.status)).length;
      if(pending>=s.settings.maxPending){s.stats.backpressure++;return {accepted:false,reason:'queue_full'};}
      const frameId='frame-'+randomUUID(),file=this.frameFile(frameId),temp=file+'.tmp';
      const fd=openSync(temp,'wx');try{writeFileSync(fd,packet.bytes);fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);
      const frame={id:frameId,source:'screen_observation',provider:providerOf(s.session),screenshotId:frameId,sequence:++s.sequence,
        observedAt:packet.observedAt,captureStartedAt:packet.startedAt,width:image.width,height:image.height,evidenceRef:file,evidenceHash:hash,
        serial:s.session.serial,packageName:s.session.packageName,window:packet.captureTarget?{app:packet.captureTarget.processPath,id:packet.captureTarget.hwnd,title:packet.captureTarget.title}:{app:s.session.packageName,id:s.session.serial,title:s.session.id},
        ...(packet.adbTarget?{adbTarget:clone(packet.adbTarget)}:{}),
        ...(packet.endpointCapture?{endpointCapture:clone(packet.endpointCapture)}:{}),
        ...(packet.captureTarget?{captureTarget:clone(packet.captureTarget),sourceQpcTicks:packet.sourceQpcTicks}:{}),
        // Review evidence must be protected in the same transaction as publication,
        // before an independent producer can supersede the ordinary frame.
        sceneId:s.scene.id,kind:s.scene.kind,entityId:s.scene.entityId,epoch:s.scene.epoch,regionSignature:signature,required:required || preserveForReview,
        stable:s.scene.stableCount>=2,ocrRequested:required && !preserveForReview,job:{status:s.settings.recognitionMode==='on_demand' && (!required || preserveForReview)?'deferred':'ready',attempt:0,token:null},review:null};
      if(frame.job.status==='deferred')s.stats.ocrDeferred=(s.stats.ocrDeferred??0)+1;
      s.frames[frameId]=frame;s.latestFrameId=frameId;s.stats.accepted++;s.captureError=null;
      const refresh=s.observationRefresh;
      if(refresh&&!refresh.firstFrameId&&frame.sequence>refresh.afterSequence&&Date.parse(frame.captureStartedAt)>=Date.parse(refresh.requestedAt)){
        frame.required=true;refresh.firstFrameId=frameId;refresh.status='awaiting_review';delete refresh.error;
      }
      if(required){s.scene.keyframeId=frameId;s.visits[s.scene.id].frameId=frameId;s.visits[s.scene.id].status='captured';
        captureActionTransition(s);}
      const ordinary=Object.values(s.frames).filter(f=>!f.required && !f.review && f.job.status!=='processing' && f.id!==frameId).sort((a,b)=>b.sequence-a.sequence);
      for(const old of ordinary.slice(s.settings.maxOrdinary-1)){retired.push(old.id);delete s.frames[old.id];}
      return {accepted:true,frame:clone(frame),pending:pending+1};
    });
    for(const frameId of retired) {const file=this.frameFile(frameId);if(existsSync(file)){const rel=relative(realpathSync(this.evidenceRoot),realpathSync(file));if(!rel.startsWith('..') && !isAbsolute(rel))unlinkSync(file);}}
    return result;
  }
  captureFailed(error){return this.transact(s=>s.captureError={at:new Date(this.clock()).toISOString(),error:String(error)});}
  claim({workerId,pid=process.pid}={}) {
    if(!id(workerId) || !integer(pid) || pid<1)fail('WORKER_INVALID');
    return this.transact(s=>{
      const frame=Object.values(s.frames).filter(f=>f.job.status==='ready').sort((a,b)=>Number(b.required)-Number(a.required) || a.sequence-b.sequence)[0];
      if(!frame)return null;
      frame.job={...frame.job,status:'processing',token:randomUUID(),workerId,pid,attempt:frame.job.attempt+1,claimedAt:new Date(this.clock()).toISOString()};return frame;
    },{writeWhen:frame=>frame!==null});
  }
  settle(frameId,token,{report=null,error=null}={}) {
    const {frame}=this.evidence(frameId);
    if(report && (report.observationId!==frameId || report.evidenceHash!==frame.evidenceHash))fail('RECOGNITION_FRAME_MISMATCH');
    if((report===null)===(error===null))fail('RECOGNITION_RESULT_INVALID');
    return this.transact(s=>{
      const f=s.frames[frameId];if(f?.job.status!=='processing' || f.job.token!==token)fail('RECOGNITION_CLAIM_CHANGED');
      f.job.status=error?'failed':'done';f.job.completedAt=new Date(this.clock()).toISOString();f.job.error=error?String(error):null;f.report=report;
      s.stats[error?'failed':'completed']++;
      if(!error && f.epoch===s.scene.epoch && (!s.frames[s.latestCandidateFrameId] || s.frames[s.latestCandidateFrameId].sequence<f.sequence))s.latestCandidateFrameId=f.id;
      return f;
    });
  }
  retryJob(frameId) {
    return this.transact(s=>{const f=s.frames[frameId];if(!f || f.job.status!=='failed')fail('JOB_NOT_FAILED');f.job.status='ready';f.job.token=null;return f;});
  }
  recoverReaders({isAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw Error('WORKER_LIVENESS_UNCONFIRMED');}}}={}) {
    return this.transact(s=>{const recovered=[];
      for(const f of Object.values(s.frames))if(f.job.status==='processing' && !isAlive(f.job.pid)){
        f.job.recoveredClaim={token:f.job.token,pid:f.job.pid,workerId:f.job.workerId,at:new Date(this.clock()).toISOString()};
        f.job.status='ready';f.job.token=null;recovered.push(f.id);
      }return {recovered};
    });
  }
  review({frameId,reviewedBy,quality,actualKind,actualEntityId=null,data={},targets=[],programToken=null,proof=null}={}) {
    const {frame}=this.evidence(frameId);
    const program=programToken===PROGRAM_REVIEW_TOKEN&&((reviewedBy===BARN_READER&&['barn','town'].includes(actualKind))||(reviewedBy===MARKET_READER&&(['market','town'].includes(actualKind)||actualKind==='barn'&&['source','result'].includes(proof?.role)||actualKind==='helicopter'&&proof?.role==='transport_exit'))||(reviewedBy===EVENT_CLOSE_READER&&actualKind==='unknown')||(reviewedBy===MAYORS_CUP_READER&&(actualKind==='mayors_cup_result'||actualKind==='unknown'&&proof?.role==='complete_result'))||(reviewedBy==='program-transport-navigation'&&['town','helicopter','train','airport'].includes(actualKind))||(reviewedBy==='program-helicopter'&&actualKind==='helicopter')||
      (['program-train-reward','program-train-loading'].includes(reviewedBy)&&actualKind==='train')||(reviewedBy===HELICOPTER_INFO_READER&&actualKind==='helicopter')||(reviewedBy==='program-airport-loading'&&actualKind==='airport'));
    if(reviewedBy==='program-train-reward'&&(data.order!==undefined||targets.some(t=>t.kind!=='collect_train')))fail('TRAIN_REWARD_SCOPE_REQUIRED');
    if((reviewedBy!=='GPT'&&!program) || !quality || typeof quality.gameVisible!=='boolean' || typeof quality.occluded!=='boolean' || !KINDS.includes(actualKind) || (actualEntityId!==null && !id(actualEntityId)) || !Array.isArray(targets) || !data || Array.isArray(data))fail('REVIEW_INVALID');
    const sourceState=this.load(),session=sourceState.session;
    if(targets.some(t=>!id(t.id) || !(NAVIGATION_KINDS.includes(t.kind) || (session.management && MANAGEMENT_KINDS.includes(t.kind))) || !['tap','swipe'].includes(t.type)))fail('CONSUMER_INPUT_DISABLED');
    if(actualKind==='train_skin' && targets.some(t=>t.kind!=='close_panel'))fail('TRAIN_SKIN_CLOSE_ONLY');
    if(actualKind==='received_products')for(const target of targets)receivedProductsTarget(target);
    for(const target of targets)if(target.management || MANAGEMENT_KINDS.includes(target.kind))validateManagement(session,target,target.kind==='buy_market'?managementOrder(sourceState,{...frame,review:{data}},target,this.clock()):data.order);
    if(targets.some(t=>t.kind==='collect_product')&&actualKind!=='received_products')fail('RECEIVED_PRODUCTS_CLAIM_ONLY');
    for(const target of targets){validateBox(target.box,frame.width,frame.height);if(target.verificationBox)validateBox(target.verificationBox,frame.width,frame.height);validateVerification(target,frame.width,frame.height,{management:MANAGEMENT_KINDS.includes(target.kind)});}
    return this.transact(s=>{
      const claimPending=s.actions[s.input]?.target?.kind==='claim_mayors_cup_reward';
      const claimSource=targets.some(t=>t.kind==='claim_mayors_cup_reward');
      const proposed={reviewedBy,quality,actualKind,actualEntityId,data,targets,...(program?{proof}: {})};
      if(claimSource)this.mayorsCupClaimSource(s,s.frames[frameId],proposed);
      if(claimPending&&(targets.length||data.actionResult!==undefined))fail('MAYORS_CUP_RESULT_OBSERVATION_ONLY');
      const eventProof=actualKind==='mayors_cup_result'&&!claimSource&&!claimPending?this.mayorsCupResultProof(s,s.frames[frameId],proposed):null;
      const f=s.frames[frameId],matches=program&&reviewedBy===EVENT_CLOSE_READER||(f.kind==='unknown' || f.kind===actualKind) && (program&&(data.order?.identityMode==='product_list'||data.helicopter?.deletionCooldownConfirmed===true) || f.entityId===null || f.entityId===actualEntityId);
      if(program&&f.review?.reviewedBy==='GPT')fail('PROGRAM_CANNOT_REPLACE_GPT_REVIEW');
      if([BARN_READER,HELICOPTER_INFO_READER,MARKET_READER,EVENT_CLOSE_READER,MAYORS_CUP_READER,'program-train-reward','program-train-loading','program-airport-loading','program-transport-navigation'].includes(reviewedBy)&&s.latestFrameId!==frameId)fail('CURRENT_FRAME_REQUIRED');
      if(program&&(s.stopCapture||s.stopReader||f.epoch!==s.scene.epoch||s.input!==proof?.inputId||
          (s.observationInvalidation?.sequence??null)!==proof?.invalidationSequence))fail('OBSERVATION_CONTEXT_CHANGED');
      const currentAction=s.actions[s.input],due=resultCaptureDueAt(currentAction);
      if(due!==null && f.epoch===currentAction.epoch && !resultCaptureReady(currentAction,f))fail('RESULT_CAPTURE_TOO_EARLY');
      const validityDeadline=retainedReviewDeadline(f,data);
      const previousData=f.review?.status==='accepted'&&f.review.actualKind===actualKind&&f.review.actualEntityId===actualEntityId?
        f.review.data:{};
      const combinedData={...clone(previousData??{}),...clone(data)};
      f.required=true;f.review={reviewedBy,quality,actualKind,actualEntityId,data:combinedData,targets:clone(targets),reviewedAt:new Date(this.clock()).toISOString(),
        ...(program?{proof:clone(proof)}:{}),
        ...(eventProof?{unexpectedObservationProof:eventProof}:{}),
        ...(validityDeadline?{validityDeadline}:{}),
        status:quality.gameVisible && !quality.occluded && matches?'accepted':'needs_revisit'};
      if(program)validateFrameProofs(f,'review');
      if(reviewedBy===EVENT_CLOSE_READER)validateEventCloseReview(this,s,f);
      if(reviewedBy===MAYORS_CUP_READER)validateProgramMayorsCupProof(f,this.evidence(frameId).image);
      if(f.review.status==='accepted'&&f.epoch===s.scene.epoch&&s.scene.kind==='unknown'&&actualKind!=='unknown'&&!s.input){
        s.scene.kind=actualKind;s.scene.entityId=actualEntityId;
        if(s.visits[f.sceneId])Object.assign(s.visits[f.sceneId],{kind:actualKind,entityId:actualEntityId});
      }
      if(f.review.status==='accepted' && s.visits[f.sceneId] && !s.visits[f.sceneId].frameId){s.visits[f.sceneId].frameId=frameId;s.visits[f.sceneId].keyframeMethod='GPT-reviewed';
        if(f.epoch===s.scene.epoch && !s.scene.keyframeId)s.scene.keyframeId=frameId;}
      if(s.visits[f.sceneId] && s.visits[f.sceneId].frameId===frameId)s.visits[f.sceneId].status=f.review.status==='accepted'?'reviewed':'needs_revisit';
      if(f.review.status==='accepted' && f.epoch===s.scene.epoch && s.input && s.actions[s.input]?.epoch===f.epoch && ['issued','captured'].includes(s.actions[s.input].status)){
        const a=s.actions[s.input];
        const claimProof=a.target?.kind==='claim_mayors_cup_reward'?this.mayorsCupClaimResult(s,a,f):null;
        const eventProofResult=a.target?.eventClose?eventCloseResult(s,a,f):null;
        const infoResult=a.target?.helicopterProductInfo?helicopterInfoResult(s,a,f):null;
        const effect=eventProofResult&&a.target.kind==='claim_popup_reward'?{actionId:a.id,frameId:f.id,confirmed:true,effect:'popup_reward_claimed',rewardAccounting:'unknown'}:claimProof?{actionId:a.id,frameId:f.id,confirmed:true,effect:claimProof.kind,rewardAccounting:claimProof.rewardAccounting}:data.actionResult;
        a.sceneReviewedAt=f.review.reviewedAt;
        const selectedProof=a.target?.currentHelicopterSelection?miniGameSelectionResult(s,a,f):a.target?.helicopterSelection?selectionResult(s,a,f):null;
        const selectedCustomer=a.target?.currentHelicopterSelection||a.target?.helicopterSelection?!!selectedProof:
          !program||a.target?.kind!=='select_customer'||data.order?.identityMode==='product_list'||data.helicopter?.deletionCooldownConfirmed===true;
        const trainDetail=!a.target?.trainDetail||(program&&reviewedBy==='program-train-loading'&&a.target.kind==='inspect_item'&&
          data.trainDetailResult?.actionId===a.id&&data.trainDetailResult?.frameId===f.id&&data.trainDetailResult?.confirmed===true);
        const nativeNavigation=!a.target?.transportNavigation||(program&&reviewedBy==='program-transport-navigation'&&proof?.role==='result'&&proof.navigationResult?.actionId===a.id&&proof.navigationResult.frameId===f.id&&proof.navigationResult.confirmed===true&&proof.navigationResult.from===a.target.transportNavigation.from&&proof.navigationResult.to===a.nextVisit.kind&&actualKind===a.target.transportNavigation.to);
        const airportDetail=!a.target?.airportDetail||(program&&reviewedBy==='program-airport-loading'&&a.target.kind==='inspect_item'&&
          data.airportDetailResult?.actionId===a.id&&data.airportDetailResult?.frameId===f.id&&data.airportDetailResult?.confirmed===true);
        const eventResult=eventProofResult;
        const marketResult=!a.target?.marketNative||(program&&reviewedBy===MARKET_READER&&proof.role==='result'&&
          proof.inputId===a.id&&effect?.actionId===a.id&&effect?.frameId===f.id&&effect.confirmed===true&&
          (a.target.kind!=='buy_market'||effect.itemId===a.target.management.itemId&&effect.quantity===a.target.management.quantity&&
            (effect.soldConfirmed===true||effect.purchaseRejected===true&&effect.acquiredQuantity===0&&
              ['MARKET_INSUFFICIENT_COINS','MARKET_BARN_FULL'].includes(effect.rejectionReason))));
        let marketTownResult=true;
        if(a.target?.marketTownNavigation){
          const source=s.frames[a.frameId],role=a.target.marketTownNavigation.role;
          validateMarketProof(source);
          marketTownResult=source?.review?.reviewedBy===MARKET_READER&&
            (role==='transport_exit'&&source.review.proof?.role==='transport_exit'&&a.target.kind==='close_panel'&&
              program&&reviewedBy===MARKET_READER&&proof?.role==='result'&&proof.inputId===a.id&&
              effect?.actionId===a.id&&effect.frameId===f.id&&effect.confirmed===true&&
              effect.effect==='helicopter_closed_to_registered_town'&&actualKind==='town'&&a.nextVisit.kind==='town'||
             role==='order_return'&&source.review.proof?.role==='source'&&a.target.kind==='open_helicopter'&&
              program&&reviewedBy==='program-helicopter'&&actualKind==='helicopter'&&
              proof?.schema==='program-helicopter-1'&&a.nextVisit.kind==='helicopter');
        }
        const barnResult=a.target?.barnNative?barnSaleResult(s,a,f):null;
        if(barnResult&&JSON.stringify(barnResult)!==JSON.stringify(effect))fail('BARN_RESULT_CHANGED');
        const receiptResult=(!a.target?.barnNative||!!barnResult)&&(!a.target?.helicopterProductInfo||!!infoResult)&&marketResult&&marketTownResult&&(!a.target?.eventClose||!!eventResult)&&(a.target?.kind!=='claim_mayors_cup_reward'||!!claimProof)&&nativeNavigation&&selectedCustomer&&trainDetail&&airportDetail&&(a.target?.management?.source!=='received_products' || (f.review.actualKind==='town' && effect?.receiptDismissed===true));
        if(!a.lifecycle && receiptResult && (!a.management || (effect?.actionId===a.id && effect.confirmed===true && effect.frameId===f.id && typeof effect.effect==='string' && effect.effect.trim()))){
          verifyActionTransition(s,a,f);
          if(barnResult){
            a.resultProof=actionResultProof(f,{navigation:barnResult});
            if(a.target.barnNative.role==='sell')s.barnRecovery=settleBarnSale(s.barnRecovery,barnResult);
          }
          if(claimProof){a.actualKind=actualKind;s.scene.kind=actualKind;s.scene.entityId=null;if(s.visits[f.sceneId])Object.assign(s.visits[f.sceneId],{kind:actualKind,entityId:null});}
          if(eventResult)a.resultProof=actionResultProof(f,{navigation:eventResult});
          if(selectedProof)a.resultProof=actionResultProof(f,{navigation:selectedProof});
          if(infoResult)a.resultProof=actionResultProof(f,{navigation:infoResult});
          if(a.target?.marketNative||a.target?.marketTownNavigation)a.resultProof=actionResultProof(f,{navigation:effect??{actionId:a.id,frameId:f.id,confirmed:true,to:actualKind}});
          if(a.management)a.resultProof=actionResultProof(f,{effect,...(claimProof?{rewardObservation:claimProof}:{})});
          if(a.target?.airportDetail)a.resultProof=actionResultProof(f,{navigation:data.airportDetailResult});
          if(a.target?.trainDetail)a.resultProof=actionResultProof(f,{navigation:data.trainDetailResult});
          if(a.target?.transportNavigation)a.resultProof=actionResultProof(f,{navigation:proof.navigationResult});
          if(a.target?.kind==='buy_market'||s.marketView)invalidateMarket(s,a.target?.kind==='buy_market'?'purchase_verified':'result_verified',{actionId:a.id});
        }
      }
      if(f.review.status!=='accepted'&&f.epoch===s.scene.epoch&&s.marketView)invalidateMarket(s,'unexpected_result');
      return f.review;
    });
  }
  invalidateObservations({source,reason}={}) {
    if(source!=='explicit_user'||typeof reason!=='string'||!reason.trim())fail('INVALIDATION_REASON_REQUIRED');
    return this.transact(s=>{
      s.observationInvalidation={sequence:s.sequence,at:new Date(this.clock()).toISOString(),reason};
      s.observationWait=null;
      if(s.marketView)invalidateMarket(s,'external_change');
      return clone(s.observationInvalidation);
    });
  }
  setObservationWait(request){
    for(const frameId of request?.frameIds??[])this.evidence(frameId);
    return this.transact(s=>{s.observationWait=observationWait(s,request,this.clock());return clone(s.observationWait);});
  }
  status() {
    const s=this.load(),jobs={ready:0,processing:0,done:0,failed:0,deferred:0};for(const f of Object.values(s.frames))jobs[f.job.status]++;
    const managementAuthorized=s.session.management?.scope==='transport_no_tcash' && s.session.management.source==='explicit_user';
    const stopped=!!(s.stopCapture || s.stopReader),navigationAllowed=!stopped && !s.input;
    let providerManagement=providerOf(s.session)!==WINDOWS_PROVIDER;
    if(!providerManagement&&navigationAllowed&&managementAuthorized){
      const frame=s.frames[s.latestFrameId];
      if(frame?.provider===WINDOWS_PROVIDER&&frame.epoch===s.scene.epoch&&acceptedFacts(frame)&&inputEvidenceValid(frame,this.clock(),s)){
        if(frame.review.reviewedBy==='program-helicopter'&&frame.review.targets.some(t=>['send_helicopter','delete_helicopter'].includes(t.kind)))
          try{validateHelicopterProof(frame);providerManagement=true;}catch{}
        if(frame.review.reviewedBy==='program-train-reward'&&frame.review.targets.some(t=>validTrainRewardSwipe(t,{type:'swipe',...t.swipe})))
          try{validateTrainRewardProof(frame);providerManagement=true;}catch{}
        if(frame.review.targets.some(t=>validNativeTrainLoad(frame,t)))providerManagement=true;
      }
    }
    const permissions={navigationAllowed,managementAuthorized,managementAllowed:navigationAllowed && managementAuthorized && providerManagement,
      blockedBy:stopped?'SESSION_STOPPED':s.input?'INPUT_UNRESOLVED':null};
    return {session:{...s.session,mode:managementAuthorized?'transport_management':'observation_only'},revision:s.revision,scene:s.scene,stats:s.stats,jobs,latestFrame:s.frames[s.latestFrameId]??null,
      latestCandidateFrameId:s.latestCandidateFrameId,visits:s.visits,actions:s.actions,captureError:s.captureError,permissions,
      policy:managementAuthorized?structuredClone(TRANSPORT_POLICY):null,marketView:clone(marketState(s)),
      observationRefresh:refreshProgress(s,this.clock()),observationWait:s.observationWait??null,executionAllowed:permissions.managementAllowed};
  }
  marketTicket(){return marketTicket(this.load());}
  recordMarketContents(contents,ticket){
    this.evidence(contents.frameId);
    return this.transact(s=>recordMarketContents(s,contents,ticket,this.clock()));
  }
  marketContents(options){return getMarketContents(this.load(),{...options,now:this.clock()});}
  reviewExactFrame(request){
    const current=this.evidence(request.frameId),reference=this.evidence(request.referenceFrameId);
    if(!current.bytes.equals(reference.bytes))fail('PROGRAM_EXACT_REFERENCE_REQUIRED');
    return this.transact(s=>{
      const review=exactReview(s,request,this.clock()),f=s.frames[request.frameId];
      f.required=true;f.review=review;return clone(review);
    });
  }
  resolveObserved({frameId,actionId,visitId}={}) {
    this.evidence(frameId);
    if(!id(actionId) || !id(visitId))fail('OBSERVED_RESOLUTION_INVALID');
    return this.transact(s=>{
      const f=s.frames[frameId],a=s.actions[actionId],r=f?.review;
      if(s.input!==actionId || !['issued','captured'].includes(a?.status) || a.epoch!==s.scene.epoch)fail('OBSERVED_ACTION_REQUIRED');
      if(a.management)fail('MANAGEMENT_RESULT_RECONCILIATION_REQUIRED');
      if(a.lifecycle)fail('LIFECYCLE_RESULT_RECONCILIATION_REQUIRED');
      if(!resultCaptureReady(a,f))fail('RESULT_CAPTURE_TOO_EARLY');
      if(!r || r.status!=='needs_revisit' || !r.quality.gameVisible || r.quality.occluded || f.epoch!==s.scene.epoch || !inputEvidenceValid(f,this.clock(),s) || r.actualKind==='unknown')fail('CURRENT_ACTUAL_SCENE_REQUIRED');
      if(s.visits[visitId])fail('VISIT_ID_REUSED');
      if(r.actualKind==='mayors_cup_result'){
        const observed=this.mayorsCupResultProof(s,f,r);
        if(JSON.stringify(observed)!==JSON.stringify(r.unexpectedObservationProof))fail('MAYORS_CUP_RESULT_PROOF_CHANGED');
        a.resultProof=actionResultProof(f,{navigation:observed});
      }
      verifyUnexpectedViewTransition(s,a,frameId,r.actualKind);
      s.scene={id:visitId,kind:r.actualKind,entityId:r.actualEntityId,epoch:s.scene.epoch+1,required:true,roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
      s.latestCandidateFrameId=null;
      s.visits[visitId]={...clone(s.scene),startedAt:new Date(this.clock()).toISOString(),status:'awaiting_capture',frameId:null};
      if(s.marketView||r.actualKind==='market')invalidateMarket(s,'unexpected_result');
      return {action:clone(a),scene:clone(s.scene)};
    });
  }
  mayorsCupClaimSource(state,frame,review,options={}){
    return cupValidation.mayorsCupClaimSource(this,state,frame,review,options);
  }
  mayorsCupReallocation(state,target,options={}){
    return cupValidation.mayorsCupReallocation(this,state,target,options);
  }
  mayorsCupClaimResult(state,action,frame,options={}){
    return cupValidation.mayorsCupClaimResult(this,state,action,frame,options);
  }
  mayorsCupResultProof(state,frame,review){
    return cupValidation.mayorsCupResultProof(this,state,frame,review);
  }
  beginAction({actionId,frameId,targetId,nextVisit,swipe=null}={}, {management=false,beforeBegin=null}={}) {
    if(!id(actionId) || !id(targetId) || !nextVisit || !id(nextVisit.visitId) || !KINDS.includes(nextVisit.kind) || (nextVisit.entityId!=null && !id(nextVisit.entityId)))fail('ACTION_INVALID');
    return this.transact(s=>{
      const requestDigest=digest(Buffer.from(JSON.stringify({actionId,frameId,targetId,nextVisit,swipe,...(management?{management:true}:{})})));
      if(s.actions[actionId]){if(s.actions[actionId].requestDigest!==requestDigest)fail('ACTION_ID_COLLISION');return {duplicate:true,action:s.actions[actionId]};}
      assertOrderStartupComplete(s);
      if(s.stopCapture || s.stopReader)fail('SESSION_STOPPED');
      assertInputSettled(s);
      const f=s.frames[frameId],target=f?.review?.targets.find(t=>t.id===targetId);
      assertResultSupported(target);
      if(management&&providerOf(s.session)===WINDOWS_PROVIDER&&(f?.provider!==WINDOWS_PROVIDER||!(f.review?.reviewedBy==='program-helicopter'&&['send_helicopter','delete_helicopter'].includes(target?.kind)||f.review?.reviewedBy==='program-train-reward'&&validTrainRewardSwipe(target,{type:'swipe',...swipe})||validNativeTrainLoad(f,target)||target?.kind==='barn_sell'&&validBarnTarget(f,target)||target?.kind==='buy_market'&&validNativeMarketTarget(f,target)||target?.kind==='claim_mayors_cup_reward'||target?.kind==='claim_popup_reward'&&target?.eventClose?.category==='claim')))fail('GOOGLE_PLAY_PROFILE_REQUIRED');
      if(!f || f.review.status!=='accepted' || f.epoch!==s.scene.epoch || !inputEvidenceValid(f,this.clock(),s) || !target)fail('CURRENT_REVIEWED_FRAME_REQUIRED');
      if(target.kind==='claim_mayors_cup_reward'){
        if(!management||nextVisit.kind!=='unknown'||nextVisit.entityId!=null||nextVisit.roi)fail('MAYORS_CUP_OBSERVE_RESULT_REQUIRED');
        this.mayorsCupClaimSource(s,f,f.review);
        if(f.review.reviewedBy===MAYORS_CUP_READER)assertCupStageBudget(s,target);
        else if(target.management.reallocation)this.mayorsCupReallocation(s,target);
        else assertCupFirstBudget(s);
      }
      if(target.eventClose){if(management!==(target.kind==='claim_popup_reward')||nextVisit.kind!=='unknown'||nextVisit.entityId!=null||nextVisit.roi)fail('EVENT_CLOSE_DESTINATION_REQUIRED');validateEventCloseSource(this,s,f);}
      if(orderInput(target.kind)&&!orderDemandCurrent(s,f))fail('ORDER_DEMAND_RESET');
      validateExactReview(s,f,this.clock());
      validateFrameProofs(f,'admission');
      validateMarketInput(s,f,target,this.clock());
      validateBarnInput(s,f,target,this.clock());
      if(target.barnNative&&(management!==(target.barnNative.role==='sell')||nextVisit.kind!==(target.barnNative.role==='leave'?'town':'barn')||nextVisit.entityId!=null||nextVisit.roi))fail('BARN_DESTINATION_CHANGED');
      if(target.currentHelicopterSelection){
        if(management||nextVisit.kind!=='helicopter')fail('MINI_GAME_NAVIGATION_ONLY');
        validateMiniGameSelectionSource(f,target);
      }
      if(target.helicopterSelection){
        const c=selectionCapability(helicopterProfile(f).profile);
        if(management||f.review.reviewedBy!=='program-helicopter'||target.kind!=='select_customer'||nextVisit.kind!=='helicopter'||!c||target.helicopterSelection.activationId!==c.activationId)fail('HELICOPTER_SELECTION_REQUIRED');
        if(selectionAttempts(s,c.activationId).length>=c.maxIssuedSelections)fail('HELICOPTER_SELECTION_CAP_REACHED');
      }
      if(target.transportNavigation&&(management||nextVisit.kind!==target.transportNavigation.to))fail('NAVIGATION_DESTINATION_CHANGED');
      if(target.helicopterProductInfo){if(management)fail('HELICOPTER_INFO_NAVIGATION_ONLY');validateHelicopterInfoSource(s,f,target,nextVisit,{evidence:id=>this.evidence(id)});}
      if(f.review.actualKind==='train_skin' && (management || target.kind!=='close_panel'))fail('TRAIN_SKIN_CLOSE_ONLY');
      if(f.review.actualKind==='received_products'){if(!management || nextVisit.kind!=='town')fail('RECEIVED_PRODUCTS_CLAIM_ONLY');receivedProductsTarget(target);}
      if(management){const order=managementOrder(s,f,target,this.clock());validateManagement(s.session,target,order);assertOrderPolicy(order,target.kind);if(target.kind==='collect_product'&&f.review.actualKind!=='received_products')fail('RECEIVED_PRODUCTS_CLAIM_ONLY');}
      else if(target.management || !NAVIGATION_KINDS.includes(target.kind))fail('CONSUMER_INPUT_DISABLED');
      if(s.visits[nextVisit.visitId])fail('VISIT_ID_REUSED');
      if(nextVisit.roi)validateBox(nextVisit.roi,f.width,f.height);
      const coordinateGeometry=inputGeometry(s.session,f);
      const {command:action,coordinates:percentageInput}=commandForTarget(target,swipe,coordinateGeometry);
      if(target.type==='swipe')for(const [x,y]of[[action.x1,action.y1],[action.x2,action.y2]])if(!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x<target.box.x || y<target.box.y || x>=target.box.x+target.box.width || y>=target.box.y+target.box.height)fail('SWIPE_OUTSIDE_REVIEWED_REGION');
      if(beforeBegin){const checked=beforeBegin(s,f,target);if(checked?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');}
      marketInput(s,f,target,actionId);
      if(target.barnNative?.role==='sell')s.barnRecovery=reserveBarnSale(s.barnRecovery,{kind:'sale_candidate',episode:target.barnNative.episode,itemId:target.management.itemId,quantity:target.management.quantity,construction:false,tabId:target.barnNative.tabId},actionId);
      beginActionTransition(s,{actionId,requestDigest,frameId,targetId,target,command:action,percentageCommand:percentageInput,nextVisit,management,frame:f},()=>this.clock());
      return {duplicate:false,action:s.actions[actionId],width:f.width,height:f.height};
    });
  }
  finishAction(actionId,error=null,{inputAttempted=true}={}) {
    return this.transact(s=>{
      return finishActionTransition(s,actionId,error,inputAttempted,()=>this.clock());
    });
  }
  actionStage(actionId,stage) {
    if(!['preflightStartedAt','preflightCapturedAt','inputReservedAt'].includes(stage))fail('ACTION_STAGE_INVALID');
    return this.transact(s=>{const a=s.actions[actionId];if(a?.status!=='pending' || s.input!==actionId)fail('ACTION_NOT_PENDING');a[stage]=new Date(this.clock()).toISOString();return a[stage];});
  }
  recordPreflight(actionId,packet) {
    const image=decodePng(packet.bytes),hash=digest(packet.bytes);
    return this.transact(s=>{
      const a=s.actions[actionId];
      if(a?.status!=='pending' || s.input!==actionId)fail('ACTION_NOT_PENDING');
      validateDevicePacket(s.session,packet);
      if(!Number.isFinite(Date.parse(packet.observedAt)) || !Number.isFinite(Date.parse(packet.startedAt)))fail('PREFLIGHT_TIME_INVALID');
      if(a.preflightEvidence)fail('PREFLIGHT_ALREADY_RECORDED');
      const dir=join(this.root,'preflight');mkdirSync(dir,{recursive:true});
      const evidenceId='preflight-'+randomUUID(),file=join(dir,evidenceId+'.png');
      const fd=openSync(file,'wx');try{writeFileSync(fd,packet.bytes);fsyncSync(fd);}finally{closeSync(fd);}
      a.preflightEvidence={id:evidenceId,source:'screen_observation',provider:providerOf(s.session),actionId,sourceFrameId:a.frameId,
        observedAt:packet.observedAt,captureStartedAt:packet.startedAt,width:image.width,height:image.height,
        serial:packet.serial,packageName:packet.packageName,epoch:a.epoch,evidenceRef:file,evidenceHash:hash,
        ...(packet.adbTarget?{adbTarget:clone(packet.adbTarget)}:{}),
        ...(packet.endpointCapture?{endpointCapture:clone(packet.endpointCapture)}:{}),
        ...(packet.captureTarget?{captureTarget:clone(packet.captureTarget),sourceQpcTicks:packet.sourceQpcTicks}:{})};
      return a.preflightEvidence;
    });
  }
}

export async function navigateReviewed(store,request,{device=null,management=false,beforeBegin=null,beforeInputGuard=null}={}) {
  const begun=await store.retry(()=>store.beginAction(request,{management,beforeBegin}));if(begun.duplicate)return begun;
  let inputAttempted=false,cupOcrWorker=null,cupPreflight=null;
  try{
    if(cupActionStage(begun.action)||begun.action.target.eventClose){
      cupOcrWorker=createCupOcrWorker();await cupOcrWorker.ready;
    }
    await store.retry(()=>store.actionStage(request.actionId,'preflightStartedAt'));
    const config=store.load().session,adb=device??createDevice(config),old=store.evidence(request.frameId),fresh=await adb.capture();
    if(providerOf(config)===WINDOWS_PROVIDER)compareWindowsGeometry(old.frame,fresh);
    await store.retry(()=>store.recordPreflight(request.actionId,fresh));
    await store.retry(()=>store.actionStage(request.actionId,'preflightCapturedAt'));
    const evidence=store.load().actions[request.actionId].preflightEvidence;
    if(cupOcrWorker){
      const frame={...evidence,sequence:old.frame.sequence+1};
      cupPreflight=begun.action.target.eventClose?await readEventClose(frame,fresh.bytes,fresh.image,{worker:cupOcrWorker}):await readCupOcr(frame,fresh.bytes,fresh.image,{worker:cupOcrWorker,stage:cupActionStage(begun.action)});
      if(!cupPreflight.supported)fail('CUP_PREFLIGHT_TEXT_REQUIRED');
      if(begun.action.target.eventClose&&JSON.stringify(eventCloseTarget(cupPreflight))!==JSON.stringify(begun.action.target))fail('EVENT_OCR_ACTION_CHANGED');
      await store.retry(()=>store.transact(s=>{
        if(s.input!==request.actionId||s.actions[request.actionId]?.status!=='pending')fail('INPUT_UNRESOLVED');
        s.actions[request.actionId].preflightOcr=clone(cupPreflight);
      }));
    }else compareReviewedTarget(old.image,fresh.image,begun.action.target,{management,itemRegions:itemRegionsForPreflight(old.frame,begun.action.target)});
    if(begun.action.target.transportNavigation)verifyTransportNavigationPreflight(old.frame,fresh.image,begun.action.target,old.image);
    if(begun.action.target.helicopterProductInfo)verifyHelicopterInfoPreflight(old.frame,fresh.image,begun.action.target,old.image);
    if(begun.action.target.marketNative||begun.action.target.marketTownNavigation)verifyMarketPreflight(old.frame,fresh.image,begun.action.target,old.image);
    if(begun.action.target.kind==='collect_train'&&begun.action.target.management?.programVerified)
      verifyTrainRewardPreflight(old.frame,fresh.image,begun.action.target);
    if(begun.action.target.kind==='load_train'&&begun.action.target.management?.programVerified||begun.action.target.kind==='inspect_item'&&begun.action.target.trainDetail)
      verifyTrainLoadingPreflight(old.frame,fresh.image,begun.action.target);
    if(begun.action.target.kind==='load_airport'&&begun.action.target.management?.programVerified||begun.action.target.airportDetail)
      verifyAirportLoadingPreflight(old.frame,fresh.image,begun.action.target,old.image);
    const beforeInput=()=>{
      const current=store.load();
      const coordinateAction=current.actions[request.actionId];
      if(JSON.stringify(coordinateAction?.percentageCommand)!==JSON.stringify(begun.action.percentageCommand)||coordinateAction?.coordinateSource?.frameId!==old.frame.id||coordinateAction?.coordinateSource?.evidenceHash!==old.frame.evidenceHash)fail('INPUT_PERCENTAGE_COMMAND_CHANGED');
      resolvePercentageCommand(coordinateAction.percentageCommand,inputGeometry(current.session,old.frame),coordinateAction.command);
      if(current.stopCapture || current.stopReader)fail('SESSION_STOPPED');
      assertInputSettled(current,{pendingActionId:request.actionId});
      assertResultSupported(current.actions[request.actionId].target);
      if(current.scene.epoch!==begun.action.epoch)fail('SCENE_CHANGED_BEFORE_INPUT');
      if(cupOcrWorker){
        if(JSON.stringify(current.actions[request.actionId].preflightOcr)!==JSON.stringify(cupPreflight))fail('CUP_PREFLIGHT_TEXT_CHANGED');
        (begun.action.target.eventClose?validateEventCloseOcr:validateCupOcr)({...evidence,sequence:old.frame.sequence+1},fresh.image,cupPreflight);
      }
      if(begun.action.target.eventClose)validateEventCloseSource(store,current,old.frame,{pending:true});
      if(begun.action.marketGeneration!==undefined&&current.marketView?.generation!==begun.action.marketGeneration)fail('MARKET_VIEW_CHANGED');
      if(begun.action.target.kind==='claim_mayors_cup_reward')store.mayorsCupClaimSource(current,old.frame,old.frame.review,{pending:true});
      if(begun.action.target.kind==='claim_mayors_cup_reward'&&old.frame.review.reviewedBy===MAYORS_CUP_READER)assertCupStageBudget(current,begun.action.target,request.actionId);
      if(begun.action.target.kind==='claim_mayors_cup_reward'&&begun.action.target.management?.reallocation)store.mayorsCupReallocation(current,begun.action.target,{pendingActionId:request.actionId});
      if(management){const order=managementOrder(current,old.frame,begun.action.target,store.clock());validateManagement(current.session,begun.action.target,order);assertOrderPolicy(order,begun.action.target.kind);}
      if(!inputEvidenceValid(old.frame,store.clock(),current))fail('CURRENT_REVIEWED_FRAME_REQUIRED');
      if(JSON.stringify(current.frames[old.frame.id]?.review)!==JSON.stringify(old.frame.review))fail('REVIEW_CHANGED_BEFORE_INPUT');
      if(Object.values(current.frames).some(f=>f.sceneId===old.frame.sceneId&&f.epoch===old.frame.epoch&&
        f.sequence>old.frame.sequence&&(f.review?.reviewedBy==='GPT'||acceptedFacts(f))))fail('NEWER_REVIEW_BEFORE_INPUT');
      validateExactReview({...current,scene:{...current.scene,epoch:old.frame.epoch,id:old.frame.sceneId}},current.frames[old.frame.id],store.clock());
      validateFrameProofs(current.frames[old.frame.id],'preflight');
      validateMarketInput(current,current.frames[old.frame.id],begun.action.target,store.clock(),{pending:true});
      validateBarnInput(current,current.frames[old.frame.id],begun.action.target,store.clock(),{pending:true});
      if(old.frame.review?.data?.helicopterProductInfo?.recoveryOf)validateHelicopterInfoSource(current,current.frames[old.frame.id],begun.action.target,begun.action.nextVisit,
        {evidence:id=>store.evidence(id),pendingActionId:request.actionId});
      if(beforeInputGuard){const checked=beforeInputGuard(current,old.frame,begun.action.target);if(checked?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');}
    };
    resolvePercentageCommand(begun.action.percentageCommand,inputGeometry(config,old.frame),begun.action.command);
    beforeInput();await store.retry(()=>store.actionStage(request.actionId,'inputReservedAt'));inputAttempted=true;const deviceReceipt=await adb.navigate(begun.action.command,{width:begun.width,height:begun.height,beforeInput,coordinates:begun.action.percentageCommand,expected:fresh,permit:{statePath:store.file,actionId:request.actionId}});
    if([WINDOWS_PROVIDER,'android_adb'].includes(providerOf(config)))await store.retry(()=>store.transact(s=>{if(s.input!==request.actionId||s.actions[request.actionId]?.status!=='pending')fail('INPUT_UNRESOLVED');s.actions[request.actionId].deviceReceipt=clone(deviceReceipt);}));
    return await store.retry(()=>store.finishAction(request.actionId));
  }catch(error){
    // Raw failure diagnostics are evidence, not a successful input or a no-input
    // conclusion. Preserve them even when the receipt cannot settle ownership.
    if(error.windowsInputFailure)await store.retry(()=>store.transact(s=>{
      const a=s.actions[request.actionId],f=error.windowsInputFailure;
      if(s.input!==request.actionId||a?.status!=='pending'||f.bridgeHash!==s.session.windowsBridgeHash||JSON.stringify(f.command)!==JSON.stringify(a.command))fail('INPUT_PROOF_MISMATCH');
      a.nativeInputFailure=clone(f);
    }));
    if(validAdbNoInputProof(error,request.actionId)){inputAttempted=false;await store.retry(()=>store.transact(s=>{s.actions[request.actionId].adapterRejectionProof=error.adbNoInputProof;}));}
    const proof=error.windowsNoInputProof;
    const current=store.load(),reserved=current.actions[request.actionId]?.inputReservedAt;
    if(validWindowsNoInputProof(proof,{actionId:request.actionId,command:begun.action.command,bridgeHash:current.session.windowsBridgeHash,error:error.message,inputReservedAt:reserved,lifecycle:!!current.actions[request.actionId]?.lifecycle})){
      await store.retry(()=>store.transact(s=>{const a=s.actions[request.actionId];if(s.input!==request.actionId||a?.status!=='pending'||proof.bridgeHash!==s.session.windowsBridgeHash||JSON.stringify(proof.command)!==JSON.stringify(a.command))fail('INPUT_PROOF_MISMATCH');a.deviceRejectionProof=clone(proof);}));inputAttempted=false;
    }
    await store.retry(()=>store.finishAction(request.actionId,error.message,{inputAttempted}));throw error;
  }finally{cupOcrWorker?.close();}
}
