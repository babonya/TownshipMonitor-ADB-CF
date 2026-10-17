import {MonitorRunSession} from './mumu-monitor-run-session.mjs';
import {isPresentationIoError} from './mumu-delivery-status.mjs';
import {dailyDeliverySummary} from './mumu-daily-deliveries.mjs';
import {WORKFLOW_MODES,workflowMode,createWorkflowWorker,createWorkflowDelivery} from './mumu-workflow-mode.mjs';


import {restartCurrentScreen,assertNativeInputIdle} from './mumu-restart-current-screen.mjs';
import {helicopterOnly,transportEnabled,deliveryScopeCutoff} from './mumu-delivery-scope.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';

import {createDevice} from './device.mjs';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {sameRootPath} from './mumu-path-identity.mjs';
import {randomUUID} from 'node:crypto';
import {MumuStore,sleep as defaultSleep} from './mumu-store.mjs';
import {atomic} from './mumu-persistence.mjs';
import {digest} from './adb.mjs';
import {InventoryStore,inventoryRequiresSync} from './mumu-inventory-store.mjs';
import {deriveInventory,inventoryUnchangedDeletion} from './mumu-inventory.mjs';
import {runCapture} from './mumu-capture.mjs';
import {runRecognizer} from './mumu-recognize.mjs';
import {LatestFrameMatcher,validatePerception,frameMetadata} from './mumu-perception-bridge.mjs';
import {OBSERVATION_INTERVAL_MS,POST_INPUT_DELAY_MS} from './mumu-timing.mjs';
import {evidenceWindow,inputEvidenceValid} from './mumu-freshness.mjs';
import {refreshProgress} from './mumu-refresh.mjs';
import {deriveCoins} from './mumu-accounting.mjs';
import {navigationMemory,marketCatalogue} from './mumu-memory.mjs';
import {townNavigationStatus} from './mumu-town-navigation.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {readMonitorDelivery} from './mumu-delivery-status-reader.mjs';

import {operationStatusView} from './mumu-operation-status.mjs';
import {snapshotEvidenceStore} from './mumu-monitor-evidence.mjs';
import {orderDemandCurrent,assertOrderStartupComplete} from './mumu-order-demand.mjs';
import {reconcileVerifiedTransportMissions} from './mumu-automatic.mjs';
import {readContinuity,continuityRelease} from './mumu-continuity.mjs';
import {CurrentAllocation} from './mumu-current-allocation.mjs';
import {terminalTransportMission} from './mumu-input-state.mjs';
import {snapshotProjectionContext,reservationTotals} from './mumu-monitor-projection.mjs';

export const MONITOR_MAX_CAPTURES=900;

// Do not call claim() repeatedly on an empty on-demand queue: a native claim
// transaction advances the ledger even when no frame is ready. The app waits
// by reading, then delegates each actual job to the existing token/settle path.
export async function runMonitorRecognizer(store,{maxJobs=MONITOR_MAX_CAPTURES,continuous=false,idleExitMs=500,producerAlive=()=>false,clock=Date.now,sleep=defaultSleep,...options}={}){
  let jobs=0,failed=0,segmentJobs=0,lastWork=clock();
  while(true){
    const state=store.load();if(state.stopReader)break;
    if(segmentJobs>=maxJobs){if(!continuous||!producerAlive())break;segmentJobs=0;}
    if(Object.values(state.frames).some(f=>f.job.status==='ready')){
      const result=await runRecognizer(store,{...options,maxJobs:1,idleExitMs:100,producerAlive:()=>false});
      jobs+=result.jobs;segmentJobs+=result.jobs;failed+=result.failed;lastWork=clock();continue;
    }
    if(producerAlive())lastWork=clock();else if(clock()-lastWork>=idleExitMs)break;
    await sleep(250);
  }
  return {jobs,failed};
}
const fresh=(at,now,ttl)=>Number.isFinite(Date.parse(at)) && now-Date.parse(at)>=0 && now-Date.parse(at)<=ttl;
function openSource(root,clock=Date.now){
  if(typeof root!=='string'||!root||!existsSync(join(resolve(root),'state.json')))throw Error('MUMU_SESSION_NOT_INITIALIZED');
  return new MumuStore({root:resolve(root),clock});
}
function inventoryView(store,state,root,now,context){
  try{
    if(['google_play_windows','android_adb'].includes(state.session.provider)){
      const current=new CurrentAllocation({source:store,clock:()=>now}).status(state);
      const reserved=reservationTotals(current.projection.reservations);
      return {status:'ready',origin:'current_order_screens',requiresSync:false,allocationKnown:true,holdReasons:[],
        rows:Object.values(current.projection.items).map(i=>({...i,available:Math.max(0,i.quantity-(reserved.get(i.itemId)??0))})),
        orders:current.evaluations,orderSources:current.orders,capacity:{fresh:false},executionAllowed:false};
    }
    let record,projection,requiresSync=false,allocationKnown=false,origin='reviewed_observations',evaluations=[],orderSources=[];
    if(root && existsSync(join(root,'inventory.json'))){
      const inventory=new InventoryStore({source:snapshotEvidenceStore(store,state),root,clock:()=>now});record=inventory.load(state);
      requiresSync=inventoryRequiresSync(state,record);
      // Preserve historical values when relevant source facts have changed.
      // Never silently sync, reserve, or turn cached numbers into available stock.
      const view=requiresSync?record:inventory.rebuild(state,record);
      projection=view.projection;evaluations=view.evaluations??[];allocationKnown=!requiresSync;origin='inventory_file';
      if(!requiresSync)orderSources=view.orders??[];
    }else{
      const frames=context.orderedFrames.filter(f=>f.review?.status==='accepted' && f.review.reviewedBy==='GPT' && f.review.actualKind==='barn' && f.review.data?.barn);
      const snapshotId=frames[0]?.review.data.barn.snapshotId;
      const visits=[...new Set(frames.filter(f=>f.review.data.barn.snapshotId===snapshotId).reverse().map(f=>f.sceneId))];
      projection=deriveInventory(state,{...(snapshotId?{snapshotId,visitIds:visits}:{}),now,eventTracked:true});
    }
    if(!projection)throw Error('INVENTORY_PROJECTION_MISSING');
    const held=requiresSync || !!projection.holdReasons?.length || !!state.input;
    const totals=allocationKnown?reservationTotals(projection.reservations):null;
    const rows=Object.values(projection.items??{}).map(item=>{
      const reserved=allocationKnown?(totals.get(item.itemId)??0):null;
      const current=evidenceWindow(item,{now,maxAgeMs:record?.config.maxAgeMs??300000}).valid;
      return {itemId:item.itemId,quantity:item.quantity,reserved,
        available:allocationKnown && !held && current && item.status==='confirmed' && Number.isSafeInteger(item.quantity)?Math.max(0,item.quantity-reserved):null,
        status:requiresSync?'requires_sync':!current?'stale':held?'hold':item.status!=='confirmed'?item.status:allocationKnown?'confirmed':'observed_only',observedAt:item.observedAt,source:item.source};
    }).sort((a,b)=>a.itemId.localeCompare(b.itemId));
    return {status:requiresSync?'requires_sync':origin==='reviewed_observations'?'observations_only':'ready',origin,requiresSync,allocationKnown,
      coverage:projection.coverage,readComplete:projection.readComplete,holdReasons:projection.holdReasons??[],rows,orders:evaluations,orderSources,
      capacity:projection.capacity?{...projection.capacity,fresh:!held && projection.capacity.fresh===true &&
        (projection.pages??[]).every(page=>evidenceWindow(page,{now,maxAgeMs:record?.config.maxAgeMs??300000}).valid)}:null,executionAllowed:false};
  }catch(error){return {status:'error',error:error.message,rows:[],orders:[],capacity:null,allocationKnown:false,executionAllowed:false};}
}
function storedMatching(store,state,frame,now){
  const file=join(store.root,'.monitor','perception.json');if(!frame || !existsSync(file))return {status:'not_available',detections:[],executionAllowed:false};
  try{
    const envelope=JSON.parse(readFileSync(file,'utf8')),record=envelope.record;
    if(digest(Buffer.from(JSON.stringify(record)))!==envelope.checksum || record.sessionId!==state.session.id)throw Error('MONITOR_MATCHING_INTEGRITY_ERROR');
    validatePerception(record.result,frameMetadata(frame),record.health,{scope:'navigation'});
    const current=fresh(frame.observedAt,now,2500)&&frame.epoch===state.scene.epoch&&!state.input&&inputEvidenceValid(frame,now,state)&&
      record.result.status==='candidate'&&record.result.coordinateState==='fresh';
    return {...record.result,status:record.result.status==='candidate'&&!current?'stale':record.result.status,
      coordinateState:current?'fresh':'expired',executionAllowed:false};
  }catch(error){return {status:error.message==='PERCEPTION_RESULT_CONTRACT_MISMATCH'?'waiting_current_frame':'error',error:error.message,detections:[],executionAllowed:false};}
}

// Read only. Querying this snapshot never resumes workers, requests OCR,
// pins images, rewrites inventory, or sends game input.
export function readMonitorSnapshot({sourceRoot,inventoryRoot=null,clock=Date.now,worker=null,delivery=null,sourceStore=null,view=null}={}){
  if(sourceStore&&!sameRootPath(sourceStore.root,sourceRoot))throw Error('MONITOR_SNAPSHOT_SOURCE_MISMATCH');
  const store=sourceStore??openSource(sourceRoot,clock),state=store.load(),now=clock(),frame=state.frames[state.latestFrameId]??null;
  const input=state.input?state.actions[state.input]:null,stopped=!!(state.stopCapture||state.stopReader),mode=workflowMode(state);
  let producerAlive=false,producerError=null;
  try{producerAlive=store.captureProducerAlive();}catch(error){producerError=error.message;}
  const liveDelivery=delivery??readMonitorDelivery(store);
  const automationStatus=stopped?'paused':liveDelivery.phase==='minigame_requesting'?'minigame_requesting':input?'waiting_result':producerAlive?'observing':'idle';
  if(view==='required_goods'&&mode.imageNeeds)return {
    schema:1,sourceRoot:store.root,inventoryRoot:null,snapshotAt:new Date(now).toISOString(),revision:state.revision,
    session:{id:state.session.id,provider:state.session.provider},deliveryOptions:{helicopterOnly:true,workflowMode:'som'},
    automation:{...dailyDeliverySummary(state,now),status:automationStatus,stopCapture:!!state.stopCapture,stopReader:!!state.stopReader,
      producerAlive,producerError,input:input?{id:input.id,status:input.status}:null,worker,delivery:liveDelivery},
    requiredGoods:mode.requiredGoods(store,state),executionAllowed:false};
  const context=snapshotProjectionContext(state),{jobs}=context;
  const somMode=mode.imageNeeds;
  const inventory=somMode?{status:'ready',origin:'temporary_som_images',requiresSync:false,allocationKnown:false,holdReasons:[],rows:[],orders:[],orderSources:[],capacity:null,executionAllowed:false}:inventoryView(store,state,inventoryRoot?resolve(inventoryRoot):null,now,context);
  const matching=storedMatching(store,state,frame,now);
  const seen=new Set(),seenHelicopterCustomers=new Set(),completedHelicopter=new Map(),orders=[];
  for(const action of somMode?[]:context.actions){
    if(action.status!=='verified'||!['send_helicopter','delete_helicopter'].includes(action.target?.kind))continue;
    const effect=actionEffect(state,action),result=state.frames[action.resultFrameId];
    const completedOrderId=action.target.kind==='delete_helicopter'?
      inventoryUnchangedDeletion(state,action,effect)?effect.deletedOrderId:null:effect?.completedOrderId;
    if(effect?.confirmed===true&&effect.actionId===action.id&&effect.frameId===result?.id&&completedOrderId)
      completedHelicopter.set(completedOrderId,Math.max(completedHelicopter.get(completedOrderId)??-1,result.sequence));
  }
  for(const f of somMode?[]:context.orderedFrames){
    if(!transportEnabled(state,f.review?.actualKind)||f.sequence<=deliveryScopeCutoff(state)||!orderDemandCurrent(state,f))continue;
    const order=f.review?.status==='accepted'?f.review.data?.order:null;
    if(f.review?.actualKind==='helicopter'&&!acceptedFacts(f))continue;
    if(!order?.orderId || seen.has(order.orderId))continue;seen.add(order.orderId);
    const current=evidenceWindow({...order,observedAt:f.observedAt,
      invalidated:!!state.observationInvalidation&&f.sequence<=state.observationInvalidation.sequence},{now}).valid;
    if(f.review.actualKind==='helicopter'){
      const customerId=order.identityMode==='product_list'||order.bindingConfirmed===false?null:order.customerId??f.review.actualEntityId;
      if(customerId){
        if(seenHelicopterCustomers.has(customerId))continue;
        seenHelicopterCustomers.add(customerId);
      }
      if(!current||order.completed===true||f.sequence<=(completedHelicopter.get(order.orderId)??-1))continue;
    }
    orders.push({orderId:order.orderId,kind:f.review.actualKind,needs:order.needs??[],completed:order.completed===true,
      observedAt:f.observedAt,frameId:f.id,fresh:current});
  }
  const requiredGoods=mode.requiredGoods(store,state,{inventory,now}),deliveryState=liveDelivery;
  return {schema:1,sourceRoot:store.root,inventoryRoot:inventoryRoot?resolve(inventoryRoot):null,snapshotAt:new Date(now).toISOString(),
    session:state.session,revision:state.revision,deliveryOptions:{helicopterOnly:somMode||helicopterOnly(state),workflowMode:mode.id},
    automation:{...dailyDeliverySummary(state,now),status:automationStatus,stopCapture:!!state.stopCapture,stopReader:!!state.stopReader,
      producerAlive,producerError,input:input?{id:input.id,status:input.status,issuedAt:input.issuedAt,resultCaptureNotBeforeAt:input.resultCaptureNotBeforeAt}:null,
      blockedBy:stopped?'SESSION_STOPPED':input?'INPUT_UNRESOLVED':null,worker,delivery:deliveryState},
    // An archived picture is proof of foreground only at its own capture time.
    game:{status:frame?(frame.provider==='google_play_windows'&&!frame.captureTarget?.isForeground?'window_captured_in_background':'foreground_at_last_capture'):'not_checked',lastVerifiedAt:frame?.observedAt??null,currentDeviceChecked:false},
    scene:state.scene,frame:frame?{...frame,imagePath:store.frameFile(frame.id),ageMs:now-Date.parse(frame.observedAt),fresh:!stopped&&!input&&frame.epoch===state.scene.epoch&&inputEvidenceValid(frame,now,state)}:null,
    matching,inventory,orders,requiredGoods,operationStatus:operationStatusView(state,deliveryState,requiredGoods),observationRefresh:refreshProgress(state,now),
    resources:deriveCoins(state,now),observationWait:state.observationWait??null,
    navigationMemory:navigationMemory(state),townNavigation:townNavigationStatus(state,matching),
    marketCatalogue:marketCatalogue(state,{now}),
    actions:context.recentActions.map(a=>
      ({id:a.id,kind:a.target?.kind??a.lifecycle,status:a.status,at:a.at,issuedAt:a.issuedAt,error:a.error,resultFrameId:a.resultFrameId})),
    stats:state.stats,jobs,captureError:state.captureError,
    timing:{observationIntervalMs:OBSERVATION_INTERVAL_MS,postInputDelayMs:POST_INPUT_DELAY_MS},executionAllowed:false};
}

export class MonitorController{
  constructor({deviceFactory=s=>createDevice(s),workerFactory=createWorkflowWorker,capture=runCapture,recognizer=runMonitorRecognizer,
    deliveryFactory=createWorkflowDelivery,onEvent=()=>{},clock=Date.now,snapshotReader=null,nativeInputIdle=assertNativeInputIdle}={}){
    Object.assign(this,{deviceFactory,workerFactory,capture,recognizer,deliveryFactory,onEvent,clock});this.sourceRoot=null;this.inventoryRoot=null;
    this.running=false;this.starting=false;this.generation=0;this.tasks=null;this.abort=null;this.lastError=null;this.phase='idle';
    this.workerOptions=null;this.delivery=null;this.snapshotReader=snapshotReader;this.snapshotGeneration=0;this.nativeInputIdle=nativeInputIdle;
  }
  emit(kind,data={}){this.onEvent({kind,at:new Date(this.clock()).toISOString(),...data});}
  connect({sourceRoot,inventoryRoot=null,startupIncarnation=null}={}){
    if(this.shuttingDown)throw Error('MONITOR_SHUTTING_DOWN');
    if(this.running||this.starting||this.tasks)throw Error('MONITOR_PAUSE_BEFORE_SESSION_CHANGE');
    if(startupIncarnation!==null){
      if(this.startupIncarnation&&this.startupIncarnation!==startupIncarnation)throw Error('MONITOR_INCARNATION_CHANGED');
      const source=openSource(sourceRoot,this.clock),native=['google_play_windows','android_adb'].includes(source.load().session.provider);
      if(!native&&!inventoryRoot)throw Error('EXISTING_INVENTORY_REQUIRED');
      const inventory=native?new CurrentAllocation({source,clock:this.clock}):new InventoryStore({source,root:inventoryRoot,clock:this.clock});
      if(native)restartCurrentScreen(source,startupIncarnation,{nativeInputIdle:this.nativeInputIdle});
      else {
        reconcileVerifiedTransportMissions(source,inventory,{beforeCommit:state=>{
          const continuity=readContinuity(source);
          if(continuity.status!=='not_started'&&(continuity.releaseId!==continuityRelease()||
              !sameRootPath(continuity.inventoryRoot,inventory.root)||
              continuity.policyHash!==digest(Buffer.from(JSON.stringify(state.session.management)))))throw Error('CONTINUITY_CONFIG_CHANGED');
        }});
        inventory.resetStartupDemand(startupIncarnation);
      }
      this.startupIncarnation=startupIncarnation;
    }
    const connected=snapshot=>{this.sourceRoot=snapshot.sourceRoot;this.inventoryRoot=snapshot.inventoryRoot;this.lastError=null;return snapshot;};
    if(this.snapshotReader)return this.snapshotReader.read({sourceRoot,inventoryRoot}).then(connected);
    return connected(readMonitorSnapshot({sourceRoot,inventoryRoot,clock:this.clock}));
  }
  resolveMinigame(){
    if(this.shuttingDown)throw Error('MONITOR_SHUTTING_DOWN');
    if(!this.delivery?.resolveMinigame)throw Error('MINIGAME_NOT_REQUESTING');
    return this.delivery.resolveMinigame();
  }
  status({view=null}={}){
    const decorate=snapshot=>({...snapshot,automation:{...snapshot.automation,
      ...(this.delivery?.status().phase==='minigame_requesting'&&!this.delivery.closed&&
        !snapshot.automation.stopCapture&&!snapshot.automation.stopReader?{status:'minigame_requesting'}:{}),
      worker:{running:this.running,starting:this.starting,phase:this.phase,
        error:this.lastError??(this.delivery?.status().phase==='waiting_result'?this.delivery.status().reason:null),owned:true,...this.workerOptions},
      delivery:this.delivery?.status()??snapshot.automation.delivery}});
    const args={sourceRoot:this.sourceRoot,inventoryRoot:this.inventoryRoot,snapshotGeneration:this.snapshotGeneration,view};
    return this.snapshotReader?this.snapshotReader.read(args).then(decorate):decorate(readMonitorSnapshot({...args,clock:this.clock}));
  }
  setDeliveryOptions({helicopterOnly:only}={}){
    if(typeof only!=='boolean')throw Error('MONITOR_DELIVERY_OPTIONS_INVALID');
    if(!this.sourceRoot)throw Error('MONITOR_SESSION_REQUIRED');
    if(this.shuttingDown)throw Error('MONITOR_SHUTTING_DOWN');
    if(this.running||this.starting||this.tasks||this.delivery?.busy)throw Error('MONITOR_PAUSE_BEFORE_DELIVERY_CHANGE');
    const store=openSource(this.sourceRoot,this.clock);
    store.transact(state=>{
      if(!['google_play_windows','android_adb'].includes(state.session.provider))throw Error('NATIVE_DELIVERY_SCOPE_REQUIRED');
      if(existsSync(join(store.root,'capture.lock'))||existsSync(join(store.root,'.management','runner.lock'))||existsSync(join(store.root,'helicopter-runner.lock')))throw Error('CAPTURE_PRODUCER_ALREADY_RUNNING');
      if(state.input||hasUnresolvedActions(state.actions??{}))throw Error('INPUT_UNRESOLVED');
      if(Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m))||
          Object.values(state.helicopterRounds??{}).some(r=>!['boundary','complete'].includes(r.status)))throw Error('DELIVERY_SETTLED_BOUNDARY_REQUIRED');
      if(helicopterOnly(state)!==only){
        state.settings.helicopterOnly=only;
        state.settings.deliveryScopeAfterSequence=state.sequence;
      }
    });
    this.delivery?.close();this.delivery=null;
    // Do not share a query that captured state before this preference change.
    ++this.snapshotGeneration;
    return this.status();
  }
  setWorkflowMode({mode}={}){
    if(!Object.hasOwn(WORKFLOW_MODES,mode))throw Error('WORKFLOW_MODE_INVALID');
    if(!this.sourceRoot)throw Error('MONITOR_SESSION_REQUIRED');
    if(this.running||this.starting||this.tasks||this.delivery?.busy||this.shuttingDown)throw Error('MONITOR_PAUSE_BEFORE_DELIVERY_CHANGE');
    const store=openSource(this.sourceRoot,this.clock);
    store.transact(s=>{
      if(!s.stopCapture||!s.stopReader)throw Error('WORKFLOW_PAUSED_BOUNDARY_REQUIRED');
      if(!['google_play_windows','android_adb'].includes(s.session.provider))throw Error('NATIVE_DELIVERY_SCOPE_REQUIRED');
      if(s.input||hasUnresolvedActions(s.actions??{}))throw Error('INPUT_UNRESOLVED');
      for(const name of ['capture.lock','.management/runner.lock','helicopter-runner.lock'])if(existsSync(join(store.root,name)))throw Error('STARTUP_OWNER_NOT_SETTLED');
      if(Object.values(s.transportMissions??{}).some(m=>!terminalTransportMission(m))||Object.values(s.helicopterRounds??{}).some(r=>!['boundary','complete'].includes(r.status)))throw Error('DELIVERY_SETTLED_BOUNDARY_REQUIRED');
      this.nativeInputIdle();s.settings.workflowMode=mode;
    });
    this.delivery?.close();this.delivery=null;++this.snapshotGeneration;
    return {workflowMode:mode,paused:true,gameInputs:0};
  }
  async start({ocr=false,language='en-US',maxCaptures=MONITOR_MAX_CAPTURES,continuous=maxCaptures===MONITOR_MAX_CAPTURES,automatic=false}={}){
    if(typeof ocr!=='boolean'||typeof continuous!=='boolean'||typeof automatic!=='boolean'||!['en-US','ko-KR'].includes(language)||!Number.isSafeInteger(maxCaptures)||maxCaptures<1||maxCaptures>MONITOR_MAX_CAPTURES)throw Error('MONITOR_START_INVALID');
    if(!this.sourceRoot)throw Error('MONITOR_SESSION_REQUIRED');
    if(this.shuttingDown)throw Error('MONITOR_SHUTTING_DOWN');
    if(this.running||this.starting||this.tasks)throw Error('MONITOR_ALREADY_RUNNING');
    const automaticPreflight=s=>{
      if(!automatic)return;
      if(s.stopCapture||s.stopReader)throw Error('SESSION_STOPPED');
      if(s.input||hasUnresolvedActions(s.actions??{}))throw Error('INPUT_UNRESOLVED');
    };
    const store=openSource(this.sourceRoot,this.clock),initial=store.load(),mode=workflowMode(initial);
    assertOrderStartupComplete(initial);
    automaticPreflight(initial);
    if(existsSync(join(store.root,'capture.lock')))throw Error('CAPTURE_PRODUCER_ALREADY_RUNNING');
    if(initial.settings.recognitionMode!=='on_demand')throw Error('ON_DEMAND_SESSION_REQUIRED');
    if(initial.input && !['issued','captured'].includes(initial.actions[initial.input]?.status))throw Error('INPUT_UNRESOLVED');
    const token=++this.generation,run=new MonitorRunSession(this,token);this.runSession=run;let worker;
    try{
      const device=this.deviceFactory(initial.session);
      // [사용자 변경 2026-10-17] 시작 버튼을 눌렀는데 게임이 꺼져 있으면(홈 화면) 게임을 띄우고 전면·가로 화면이 될 때까지 최대 60초 기다린다.
      // 전엔 이 검사에서 바로 ADB_TARGET_NOT_FOREGROUND로 멈춰, 실행 중에만 동작하는 자동 실행(mumu-capture.mjs)까지 가지 못했다.
      try{await device.assertTarget();}
      catch(error){
        if(error.message!=='ADB_TARGET_NOT_FOREGROUND'||typeof device.launchGameIfHome!=='function'||!await device.launchGameIfHome())throw error;
        for(let i=0;;i++){
          await new Promise(r=>setTimeout(r,2000));if(!run.current())throw Error('MONITOR_START_CANCELLED');
          try{await device.assertTarget();break;}
          catch(e){if(i>=30||!['ADB_TARGET_NOT_FOREGROUND','ADB_TARGET_OR_GEOMETRY_CHANGED','ADB_DISPLAY_GEOMETRY_REQUIRED'].includes(e.message))throw e;}
        }
      }
      if(!run.current())throw Error('MONITOR_START_CANCELLED');
      worker=run.worker=await this.workerFactory(initial.session,initial);await worker.ready;
      if(!run.current())throw Error('MONITOR_START_CANCELLED');
      this.delivery=run.delivery=await this.deliveryFactory(store,{inventoryRoot:this.inventoryRoot,device,worker,signal:run.abort.signal,
        onEvent:result=>this.emit('delivery',result)});
      if(!run.current()||this.shuttingDown||run.abort.signal.aborted)throw Error('MONITOR_START_CANCELLED');
      if(existsSync(join(store.root,'capture.lock')))throw Error('CAPTURE_PRODUCER_ALREADY_RUNNING');
      const current=store.load();if(current.session.id!==initial.session.id)throw Error('MONITOR_SESSION_CHANGED');
      automaticPreflight(current);
      if(current.settings.recognitionMode!=='on_demand')throw Error('ON_DEMAND_SESSION_REQUIRED');
      if(current.input && !['issued','captured'].includes(current.actions[current.input]?.status))throw Error('INPUT_UNRESOLVED');
      const oldStops={stopCapture:!!current.stopCapture,stopReader:!!current.stopReader};
      const resumedRevision=await store.retry(()=>store.transact(s=>{
        // Lock retry yields to shutdown; cancellation must precede any resume mutation.
        if(token!==this.generation||this.shuttingDown)throw Error('MONITOR_START_CANCELLED');
        if(s.session.id!==initial.session.id)throw Error('MONITOR_SESSION_CHANGED');
        automaticPreflight(s);
        s.stopCapture=false;s.stopReader=false;return s.revision+1;
      }));
      if(token!==this.generation||this.shuttingDown)throw Error('MONITOR_START_CANCELLED');
      run.activate({ocr,language,maxCaptures,continuous});
      const cache=join(store.root,'.monitor');
      try{mkdirSync(cache,{recursive:true});}catch(error){if(!isPresentationIoError(error))throw error;this.emit('presentation_error',{error:error.code});}
      let matchedFrame=null,captureWaitError=null;
      const matcher=run.matcher=new LatestFrameMatcher(worker,{clock:this.clock,onResult:result=>{
        matchedFrame=result;
        const record={sessionId:initial.session.id,health:worker.health,result};
        try{atomic(join(cache,'perception.json'),{schema:1,checksum:digest(Buffer.from(JSON.stringify(record))),record});}
        catch(error){if(!isPresentationIoError(error))throw error;this.emit('presentation_error',{error:error.code});}
        this.emit('matching',{frameId:result.frameId,status:result.status});
      },onError:async error=>{
        matchedFrame=null;this.lastError=error.message;this.emit('error',{error:error.message});
        const mayRecover=()=>mode.id==='som'&&initial.session.provider==='android_adb'&&token===this.generation&&!this.shuttingDown&&
          !this.abort.signal.aborted&&!store.load().stopCapture&&!store.load().stopReader&&!Object.values(store.load().actions??{}).some(a=>a.status==='unknown');
        if(mayRecover()&&worker.recover){
          try{if(await worker.recover(error,{signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(30000)])})&&mayRecover()){this.lastError=null;this.emit('recognition_recovered');return;}}
          catch(recoveryError){this.lastError=recoveryError.message;this.emit('error',{error:recoveryError.message});}
        }
        if(!this.preserveStopsOnShutdown)await this.pause();
      }});
      // These tasks are owned by this controller. No foreign process is killed
      // or foreign lease removed, including on UI shutdown or failed startup.
      const producer=Promise.resolve().then(()=>this.capture(store,device,{maxCaptures,signal:this.abort.signal,
        renewBudget:({state,captures,segments})=>{
          const pending=state.actions[state.input],deliveryPhase=this.delivery.status().phase,
            observingResult=mode.id==='som'&&(deliveryPhase==='waiting_result'||
              deliveryPhase==='minigame_requesting'&&pending?.target?.som?.kind==='som_minigame_keepalive')&&
            pending?.target?.som&&pending.deviceReceipt?.commandIssued===true&&['issued','captured'].includes(pending.status)&&
            !Object.entries(state.actions).some(([id,a])=>id!==state.input&&hasUnresolvedActions({[id]:a}));
          if(!continuous||token!==this.generation||this.shuttingDown||this.abort.signal.aborted||this.delivery.busy||
              state.session.id!==initial.session.id||JSON.stringify(state.session.management)!==JSON.stringify(initial.session.management)||
              state.stopCapture||state.stopReader||state.scene.transitioning||
              (state.input||hasUnresolvedActions(state.actions??{}))&&!observingResult)return false;
          this.emit('observation_segment',{segment:segments+1,captures});return true;
        },
        getObservationSchedule:state=>this.delivery?.observationSchedule(state)??null,onFrame:async(r,p)=>{
        if(this.abort.signal.aborted)return;
        if(r.recoverableCaptureError){captureWaitError=r.reason;this.lastError=r.reason;}
        else if(r.accepted&&captureWaitError){if(this.lastError===captureWaitError)this.lastError=null;captureWaitError=null;}
        if(r.accepted&&mode.bindPending)mode.bindPending(worker,store.load());
        if(r.accepted)matcher.enqueue(r,p);this.emit('capture',{frameId:r.frame?.id,accepted:r.accepted,reason:r.reason});
        // A round uses the existing input/result capture path while this owned
        // producer waits. No background capture races its preflight or results.
        if(r.accepted){await matcher.flush();if(!this.abort.signal.aborted&&matchedFrame?.frameId===r.frame.id)await this.delivery.onFrame(r.frame,matchedFrame);}
        // Unknown input cannot be retried or reconciled by this observer. Stop
        // only our producer; preserve canonical input and the user's stop flags.
        if(Object.values(store.load().actions??{}).some(a=>a.status==='unknown'))this.abort.abort();
      }})).catch(async error=>{
        // Roll back our resume only when no other source mutation has occurred.
        if(!this.preserveStopsOnShutdown)await store.retry(()=>{if(store.load().revision===resumedRevision)return store.transact(s=>Object.assign(s,oldStops));});
        throw error;
      });
      const reader=ocr&&mode.backgroundOcr?Promise.resolve().then(()=>this.recognizer(store,{maxJobs:MONITOR_MAX_CAPTURES,continuous,idleExitMs:500,
        workerId:'monitor-'+randomUUID(),producerAlive:()=>this.running && !this.abort.signal.aborted,
        processor:async(s,f)=>(await import('./mumu-recognize.mjs')).recognizeFile(s,f,{language}),onResult:r=>this.emit('ocr',r)})).catch(async error=>{
          this.lastError=error.message;this.emit('error',{error:error.message});if(!this.preserveStopsOnShutdown)await this.pause();throw error;
        }):Promise.resolve(null);
      // Producer completion releases the reader's keep-alive. All failures are
      // observed immediately; the bridge never leaves an unhandled rejection.
      producer.then(()=>{this.running=false;},async error=>{this.running=false;this.lastError=error.message;this.emit('error',{error:error.message});
        if(!this.preserveStopsOnShutdown&&!existsSync(join(store.root,'capture.lock')))await store.retry(()=>store.transact(s=>{s.stopCapture=true;s.stopReader=true;})).catch(()=>{});
      }).catch(()=>{});
      this.tasks=Promise.allSettled([producer,reader]).then(results=>run.finish(results)).finally(()=>{this.tasks=null;});
      this.emit('worker_start',{ocr,maxCaptures,continuous});return {started:true,maxCaptures,continuous,ocr,gameInputs:0,deliveryLinked:true};
    }catch(error){run.failStartup(error);throw error;}
  }
  async pause(){
    ++this.generation;if(!this.sourceRoot)throw Error('MONITOR_SESSION_REQUIRED');
    this.abort?.abort();const store=openSource(this.sourceRoot,this.clock);
    await store.retry(()=>store.transact(s=>{s.stopCapture=true;s.stopReader=true;}));
    this.phase=this.tasks?'stopping':'paused';this.emit('paused');return {paused:true,workersStopping:!!this.tasks,inputPreserved:store.load().input,gameStopRequested:false};
  }
  async shutdown({preserveStops=false}={}){
    if(typeof preserveStops!=='boolean')throw Error('MONITOR_SHUTDOWN_INVALID');
    if(this.shutdownPromise)return this.shutdownPromise;
    if(preserveStops&&this.sourceRoot){
      if(this.delivery?.busy)throw Error('MONITOR_DELIVERY_BUSY');
      const state=openSource(this.sourceRoot,this.clock).load();
      if(!['google_play_windows','android_adb'].includes(state.session.provider)&&(state.input||hasUnresolvedActions(state.actions??{})))throw Error('INPUT_UNRESOLVED');
      const lease=join(this.sourceRoot,'capture.lock');
      if(existsSync(lease)){
        let owner;try{owner=JSON.parse(readFileSync(lease,'utf8'));}catch{}
        if(!this.tasks||owner?.pid!==process.pid)throw Error('CAPTURE_PRODUCER_NOT_OWNED');
      }
    }
    this.shuttingDown=true;
    this.preserveStopsOnShutdown=preserveStops;
    this.shutdownPromise=(async()=>{
      if(preserveStops){++this.generation;this.abort?.abort();this.running=false;this.phase='stopping';}
      else if(this.running||this.starting||this.tasks)await this.pause();
      return {shutdown:true,preserveStops,ownedWorkersStopping:!!this.tasks};
    })();
    return this.shutdownPromise;
  }
  async wait(){if(this.tasks)await this.tasks;if(this.shuttingDown)await this.snapshotReader?.close();}
}
