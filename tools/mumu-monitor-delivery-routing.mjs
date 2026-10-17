import {installObservationWait,invalidateObservationWait,clearObservationWait} from './mumu-observation-wait-lifecycle.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {helicopterOnly,transportEnabled} from './mumu-delivery-scope.mjs';
// routing processing uses the coordinator's state and its one input owner.
import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {digest} from './adb.mjs';
import {inventorySourceFingerprint} from './mumu-inventory-store.mjs';
import {helicopterProfile} from './mumu-helicopter-proof.mjs';
import {readContinuity,continuityRelease} from './mumu-continuity.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {atomic} from './mumu-persistence.mjs';
import {programObservationWait,trainObservationWait,airportObservationWait,transportPanelExitBoundary,helicopterExhaustionBoundary,helicopterObservationTimers} from './mumu-wait.mjs';
import {routeBinding,rememberTransport,endObservedTransit,chooseTransport,routeObservationDeadline} from './mumu-transport-route.mjs';
import {validateNavigationNoEffectReceipt} from './mumu-navigation-rejection.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {transportNavigationProfile} from './mumu-transport-navigation-proof.mjs';
import {observeTransportNavigation} from './mumu-transport-navigation.mjs';
import {marketReturnRecheck} from './mumu-monitor-delivery-market.mjs';
import {observeMarketTransportExit} from './mumu-market.mjs';
import {validWindowsNoInputProof} from './windows-device.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const unresolved=state=>state.input||hasUnresolvedActions(state.actions??{});
export function priorNativePointerRejectionSettled(state,action,frame){
  const cutoff=state.orderDemandStartup?.cutoffSequence,source=state.frames[action?.frameId];
  return state.session.provider==='google_play_windows'&&state.input===null&&Number.isSafeInteger(cutoff)&&
    Number.isSafeInteger(source?.sequence)&&source.sequence<=cutoff&&frame.sequence>cutoff&&
    action.status==='rejected_before_input'&&action.inputAttempted===false&&!action.issuedAt&&action.error==='USER_POINTER_ACTIVE'&&
    action.target?.kind==='close_panel'&&action.target.marketTownNavigation?.role==='transport_exit'&&
    Number.isFinite(Date.parse(action.finishedAt))&&Date.parse(action.finishedAt)>=Date.parse(action.deviceRejectionProof?.receipt?.completedAt)&&
    validWindowsNoInputProof(action.deviceRejectionProof,{actionId:action.id,command:action.command,
      bridgeHash:state.session.windowsBridgeHash,error:action.error,inputReservedAt:action.inputReservedAt});
}

function saveRouteCache(file,record,{ensureDirectory=false}={}){
  if(ensureDirectory)mkdirSync(dirname(file),{recursive:true});
  atomic(file,{schema:1,checksum:sha(record),record});
}

export function readRouteCache(file,binding,state,{original=()=>{}}={}){
    const routes={},arrivalIndicators={},discarded=[];
    const discard=reason=>discarded.push(reason);
    let e;
    try{e=JSON.parse(readFileSync(file,'utf8'));}catch(error){
      if(error.code==='ENOENT')return {routes,arrivalIndicators,discarded};
      if(!(error instanceof SyntaxError))throw error;
      discard('parse');return {routes,arrivalIndicators,discarded};
    }
    if(e?.schema!==1||!e.record||e.checksum!==sha(e.record)){discard('checksum');return {routes,arrivalIndicators,discarded};}
    if(e.record.binding!==binding){discard('binding');return {routes,arrivalIndicators,discarded};}
    const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
    const reference=r=>{
      const f=state.frames[r?.frameId];if(!f||f.evidenceHash!==r.evidenceHash)return false;
      try{original(r.frameId);return true;}catch(error){
        if(['ENOENT','FRAME_NOT_FOUND','FRAME_HASH_MISMATCH','FRAME_GEOMETRY_MISMATCH'].includes(error.code??error.message))return false;
        throw error;
      }
    };
    if(!object(e.record.routes))discard('routes');
    else for(const [kind,r] of Object.entries(e.record.routes)){
      if(!['helicopter','train','airport'].includes(kind)||r?.kind!==kind||r.executionAllowed!==false||
        !['active','transit','exhausted'].includes(r.phase)||!reference(r)||!Array.isArray(r.timers)||
        !Number.isFinite(r.checkedAt)||!Number.isFinite(Date.parse(r.observedAt))||
        r.timers.some(t=>!state.frames[t?.frameId]||!reference({...t,evidenceHash:state.frames[t.frameId].evidenceHash})||!Number.isFinite(Date.parse(t.until)))){discard('route:'+kind);continue;}
      routes[kind]=r;
    }
    if(e.record.arrivalIndicators!==undefined&&!object(e.record.arrivalIndicators))discard('indicators');
    else for(const [kind,r] of Object.entries(e.record.arrivalIndicators??{})){
      if(!['train','airport'].includes(kind)||!reference(r)||typeof r.token!=='string'){discard('indicator:'+kind);continue;}
      arrivalIndicators[kind]=r;
    }
    return {routes,arrivalIndicators,discarded};
}
export function routeMemory(coordinator,state=coordinator.store.load()){

    const binding=routeBinding(state,continuityRelease(),transportNavigationProfile(state.session).hash);
    if(coordinator.routeBinding===binding)return coordinator.routes;
    let routes={};coordinator.arrivalIndicators={};
    const file=join(coordinator.store.root,'.monitor','transport-route.json');
    if(existsSync(file)){
      const restored=readRouteCache(file,binding,state,{original:id=>coordinator.store.evidence(id)});
      routes=restored.routes;coordinator.arrivalIndicators=restored.arrivalIndicators;
      if(restored.discarded.length){
        coordinator.state.routeCacheRecovery={reasons:restored.discarded,executionAllowed:false};
        const record={binding,routes,arrivalIndicators:coordinator.arrivalIndicators};
        saveRouteCache(file,record);
      }
    }
    coordinator.routes=routes;coordinator.routeBinding=binding;return coordinator.routes;
}

export function rememberRoute(coordinator,kind,frame,allocation,timers,phase,journeyKey=null,executionHold=null){

    const routes=coordinator.routeMemory();
    for(const id of new Set([frame.id,...(timers??[]).map(t=>t.frameId)]))
      if(!coordinator.store.load().frames[id]?.required)coordinator.store.pinFrame(id,{ocr:false});
    rememberTransport(routes,{kind,frame:{...frame,journeyKey},allocation,timers,phase,executionHold},coordinator.store.clock());
    const record={binding:coordinator.routeBinding,routes,arrivalIndicators:coordinator.arrivalIndicators};
    saveRouteCache(join(coordinator.store.root,'.monitor','transport-route.json'),record,{ensureDirectory:true});
}

export function observeActiveTransport(coordinator,kind,frame,rows=[]){

    const routes=coordinator.routeMemory();
    if(!endObservedTransit(routes,{kind,frame,rows},coordinator.store.clock()))return;
    if(!coordinator.store.load().frames[frame.id]?.required)coordinator.store.pinFrame(frame.id,{ocr:false});
    coordinator[kind+'IdleEvidence']=null;
    const record={binding:coordinator.routeBinding,routes,arrivalIndicators:coordinator.arrivalIndicators};
    saveRouteCache(join(coordinator.store.root,'.monitor','transport-route.json'),record);
}

export function nextTransport(coordinator,allocation,options={}){
const state=coordinator.store.load(),only=helicopterOnly(state);
return chooseTransport(coordinator.routeMemory(),allocation,{returnToTown:state.session.provider==='google_play_windows',...options,
  ...(only?{availableKinds:(options.availableKinds??['helicopter']).filter(k=>transportEnabled(state,k)),returnToTown:false}:{}),now:coordinator.store.clock()});
}

export function saveArrivalIndicators(coordinator,){

    const routes=coordinator.routeMemory(),record={binding:coordinator.routeBinding,routes,arrivalIndicators:coordinator.arrivalIndicators};
    saveRouteCache(join(coordinator.store.root,'.monitor','transport-route.json'),record,{ensureDirectory:true});
}

export function arrivalCandidates(coordinator,frame,reading){

    if(helicopterOnly(coordinator.store.load()))return [];
    coordinator.routeMemory();const ready=[];
    for(const [kind,signal] of Object.entries(reading.arrivalIndicators??{})){
      // Plane absence after a previously handled indication calls for one
      // visual panel check, so departed orders cannot reserve stock forever.
      if(signal.state==='absent'&&coordinator.arrivalIndicators[kind]?.token!=='absent'&&coordinator.arrivalIndicators[kind]){
        if(kind==='airport')ready.push(kind);
        else {delete coordinator.arrivalIndicators[kind];coordinator.saveArrivalIndicators();}
      }
      if(signal.state==='ready'&&coordinator.arrivalIndicators[kind]?.token!==signal.token)ready.push(kind);
    }
    return ready;
}

export function consumeArrival(coordinator,frame,reading,kind){

    coordinator.routeMemory();
    const signal=reading.arrivalIndicators?.[kind];if(!signal||signal.state==='unknown')return;
    coordinator.arrivalIndicators[kind]={token:signal.token,frameId:frame.id,evidenceHash:frame.evidenceHash};coordinator.saveArrivalIndicators();
}

export function observationSchedule(coordinator,state=coordinator.store.load()){

    if(!coordinator.wait)return null;
    try{
      const owner=JSON.parse(readFileSync(join(coordinator.store.root,'capture.lock'),'utf8'));
      if(!coordinator.owner||sha(owner)!==sha(coordinator.owner))throw Error('CAPTURE_PRODUCER_NOT_OWNED');
      if(coordinator.signal?.aborted||state.stopCapture||state.stopReader||unresolved(state)||state.scene.transitioning||
        state.scene.kind!==(coordinator.wait.sceneKind??'helicopter')||state.scene.epoch!==coordinator.wait.epoch||coordinator.inventoryStamp()!==coordinator.wait.inventoryStamp)
        throw Error('PROGRAM_WAIT_INVALIDATED');
      if(coordinator.waitRevision!==state.revision){
        if(sha(state.session.management)!==coordinator.wait.policyHash||inventorySourceFingerprint(state)!==coordinator.wait.sourceFingerprint)
          throw Error('PROGRAM_WAIT_INVALIDATED');
        coordinator.waitRevision=state.revision;
      }
      const next=Math.min(Date.parse(coordinator.wait.nextObservationAt),routeObservationDeadline(coordinator.routeMemory(state),state.scene.kind,coordinator.store.clock()));
      return {source:coordinator.wait.source,reason:coordinator.wait.reason,intervalMs:coordinator.wait.intervalMs,
        nextObservationAt:new Date(next).toISOString(),timers:coordinator.wait.timers,roundId:coordinator.wait.roundId};
    }catch{invalidateObservationWait(coordinator);return null;}
}

export async function enterWait(coordinator,frame,fingerprint){

    if(coordinator.currentMode){
      const state=coordinator.guard().state,allocation=coordinator.inventory.status();
      if(!coordinator.currentHelicopterExhausted)throw Error('CURRENT_HELICOPTER_EXHAUSTION_REQUIRED');
      const anchor=state.frames[coordinator.currentHelicopterExhausted.frameId];
      if(!anchor||coordinator.inventory.stamp()!==coordinator.currentHelicopterExhausted.allocationKey)throw Error('CURRENT_HELICOPTER_EXHAUSTION_REQUIRED');
      const args={frameId:anchor.id,allocation,fingerprint,profileHash:helicopterProfile(frame).hash,currentExhausted:coordinator.currentHelicopterExhausted,previous:coordinator.wait??coordinator.invalidatedWait,observedAt:frame.observedAt};
      helicopterExhaustionBoundary(state,args,coordinator.store.clock());
      coordinator.rememberRoute('helicopter',anchor,allocation,helicopterObservationTimers(anchor,coordinator.store.clock()),'exhausted');
      // The market planner refuses shopping while any known order is feasible.
      // Initial transport surveys therefore cannot eclipse a current shortage.
      const route=await coordinator.requestMarketForShortages(frame,'helicopter')??coordinator.nextTransport(allocation,{current:'helicopter'});
      if(route){
        coordinator.helicopterExhaustedFrameId=anchor.id;
        // Keep the canonical order/exhaustion review intact. The ordinary next
        // producer original becomes the independently registered close source.
        if(frame.width===1578&&frame.height===1268&&frame.id===anchor.id)
          return coordinator.update('waiting','CURRENT_PANEL_EXIT_OBSERVATION_REQUIRED',{transport:'helicopter',nextTransport:route.kind});
        return coordinator.exitPanel(frame,'helicopter',route,s=>helicopterExhaustionBoundary(s,args,coordinator.store.clock()));
      }
      installObservationWait(coordinator,programObservationWait(state,args,coordinator.store.clock()),{inventoryStamp:coordinator.inventoryStamp(),sourceFingerprint:inventorySourceFingerprint(state),policyHash:sha(state.session.management),revision:state.revision});
      return coordinator.update('waiting','NO_SUPPORTED_WORK',{observationSchedule:coordinator.observationSchedule(state)});
    }

    const state=coordinator.store.load(),continuity=readContinuity(coordinator.store),allocation=coordinator.inventory.status();
    const previous=coordinator.wait??coordinator.invalidatedWait;
    const anchor=state.frames[previous?.frameId??coordinator.helicopterExhaustedFrameId]??state.frames[state.latestFrameId];
    const record=coordinator.inventory.locked(s=>coordinator.inventory.load(s));
    const round=state.helicopterRounds?.[continuity.receipts?.at(-1)?.roundId];
    for(const id of round?.actionIds??[])if(state.actions[id]?.status==='rejected_before_input')
      validateNavigationNoEffectReceipt(coordinator.store,state,record,round,id);
    const args={frameId:anchor?.id,continuity,allocation:{...allocation,effects:record.effects,noEffectReceipts:round?.noEffectReceipts??[]},fingerprint,
      profileHash:helicopterProfile(frame).hash,previous,observedAt:frame.observedAt};
    helicopterExhaustionBoundary(state,args,coordinator.store.clock());
    coordinator.helicopterExhaustedFrameId=anchor.id;
    // Retain any original cooldown while temporarily yielding to higher-priority
    // work. No observation schedule is granted by the exit boundary itself.
    const others=allocation.evaluations?.some(e=>e.status==='feasible'&&(e.transport??e.kind)!=='helicopter');
    const waiting=others?null:programObservationWait(state,args,coordinator.store.clock());
    coordinator.rememberRoute('helicopter',anchor,allocation,helicopterObservationTimers(anchor,coordinator.store.clock()),'exhausted');
    const route=coordinator.nextTransport(allocation,{current:'helicopter'})??await coordinator.requestMarketForShortages(anchor,'helicopter');
    if(route)return coordinator.exitPanel(frame,'helicopter',route,checked=>helicopterExhaustionBoundary(checked,args,coordinator.store.clock()));
    installObservationWait(coordinator,waiting,{inventoryStamp:coordinator.inventoryStamp(),sourceFingerprint:inventorySourceFingerprint(state),policyHash:sha(state.session.management),revision:state.revision});
    return coordinator.update('waiting','NO_SUPPORTED_WORK',{coordinatorStatus:continuity.status,
      lastObservationAt:frame.observedAt,observationSchedule:coordinator.observationSchedule(state),heldOrders:
        (allocation.evaluations??[]).filter(e=>['hold','shortage'].includes(e.status)).map(e=>({orderId:e.orderId,status:e.status,reasons:e.reasons??[]}))});
}

export async function exitTransitForReadyWork(coordinator,frame,reading,kind){

    const {state}=coordinator.guard({context:'navigation'}),allocation=coordinator.inventory.status();
    const route=coordinator.nextTransport(allocation,{current:kind});
    if(!route)return null;
    const args={frame,reading,allocation,fingerprint:reading.journeyHash,route};
    const boundary=transportPanelExitBoundary(state,args,coordinator.store.clock());
    if(!boundary)return null;
    return coordinator.exitPanel(frame,kind,route,checked=>transportPanelExitBoundary(checked,args,coordinator.store.clock()));
}

export async function exitPanel(coordinator,frame,kind,route,validateBoundary){

    const {state}=coordinator.guard({context:'navigation'});
    validateBoundary(state);
    const inventoryStamp=coordinator.inventoryStamp(),policyHash=sha(state.session.management);
    clearObservationWait(coordinator);
    const rejected=Object.values(state.actions).some(a=>a.status==='rejected_before_input'&&a.target?.kind==='close_panel'&&
      (a.target.transportNavigation?.from===kind||kind==='helicopter'&&a.target.marketTownNavigation?.role==='transport_exit')&&state.frames[a.frameId]?.sceneId===frame.sceneId&&
      !(coordinator.currentMode&&priorNativePointerRejectionSettled(state,a,frame)));
    if(rejected)return coordinator.update('hold','NAVIGATION_REJECTED_WITHOUT_INPUT');
    let actionId=null;
    const settledStamp=s=>sha({source:inventorySourceFingerprint({...s,input:null,actions:Object.fromEntries(Object.entries(s.actions).filter(([id])=>id!==actionId))}),
      rounds:s.helicopterRounds,missions:s.transportMissions});
    // Bind the checked allocation before awaiting source preparation. A new
    // order/reconciliation during that await must not become the new baseline.
    const boundaryStamp=settledStamp(state);
    const nativeMarketExit=frame.width===1578&&frame.height===1268&&kind==='helicopter';
    const observed=nativeMarketExit?await observeMarketTransportExit(coordinator.store,{frameId:frame.id,sourceKind:kind}):
      await observeTransportNavigation(coordinator.store,{frameId:frame.id,sourceKind:kind});
    if(settledStamp(coordinator.store.load())!==boundaryStamp)throw Error('NAVIGATION_BOUNDARY_CHANGED');
    if(!observed.stored)return coordinator.update('waiting',observed.reason,{transport:kind});
    const target=observed.targets.find(t=>t.kind==='close_panel');
    if(!target)throw Error('REGISTERED_PANEL_EXIT_REQUIRED');
    actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'x'},()=> 'native-exit:'+sha({session:state.session.id,frame:frame.id,kind}).slice(0,32));
    coordinator.navigationActionId=actionId;
    const currentGuard=settlingNavigation=>{
      const checked=coordinator.guard({context:'navigation',phase:settlingNavigation?'owned-input':'observe'});
      if(checked.state.latestFrameId!==frame.id||coordinator.inventoryStamp()!==inventoryStamp||sha(checked.state.session.management)!==policyHash)
        throw Error('NAVIGATION_ALLOCATION_CHANGED');
      if(settledStamp(checked.state)!==boundaryStamp)throw Error('NAVIGATION_BOUNDARY_CHANGED');
      // Before begin the complete settled boundary must still hold. After begin,
      // the sole owned pending navigation is checked by guard and preflight.
      if(!settlingNavigation)validateBoundary(checked.state);
      return checked;
    };
    await navigateReviewed(coordinator.store,{frameId:frame.id,actionId,targetId:target.id,
      nextVisit:{visitId:actionId+'-result',kind:'town',required:true}},
      {device:coordinator.device,beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
    return coordinator.update('waiting','NAVIGATION_RESULT_REQUIRED',{transport:kind,navigationActionId:actionId,nextTransport:route.kind,routeReason:route.reason});
}

export async function enterTransitWait(coordinator,frame,reading,kind){

    const options={context:kind==='train'?'train':'airport'};
    const waitFor=kind==='train'?trainObservationWait:airportObservationWait;

    const {state}=coordinator.guard(options);
    if(coordinator.currentMode)coordinator.inventory.retire(kind,frame.sequence);
    if(kind==='airport'&&!coordinator.currentMode){
      // Only the registered empty panel retires plane demand. This creates no
      // delivery, stock debit, or receipt and preserves all other reservations.
      const record=coordinator.inventory.locked(s=>coordinator.inventory.load(s));
      const refs=record.orderFrameIds.filter(id=>state.frames[id]?.review?.actualKind!=='airport');
      if(refs.length!==record.orderFrameIds.length){
        const before=coordinator.inventory.status();
        transportPanelExitBoundary(state,{frame,reading,allocation:{...before,
          evaluations:before.evaluations.filter(e=>!['airport','plane'].includes(e.transport??e.kind))},
          fingerprint:reading.journeyHash,route:{kind:'town'}},coordinator.store.clock());
        coordinator.store.pinFrame(frame.id,{ocr:false});
        const checked=coordinator.guard(options).state;
        if(checked.latestFrameId!==frame.id||checked.scene.epoch!==frame.epoch||
          sha(checked.session.management)!==sha(state.session.management)||inventorySourceFingerprint(checked)!==inventorySourceFingerprint(state))throw Error('PROGRAM_WAIT_INVALIDATED');
        coordinator.inventory.commit('sync',{mutationId:'airport-absence:'+frame.id,expectedSourceRevision:checked.revision,
          expectedRevision:record.revision,orderFrameIds:refs},{beforeCommit:locked=>{
            coordinator.guard(options);
            transportPanelExitBoundary(locked,{frame,reading,allocation:{...before,
              evaluations:before.evaluations.filter(e=>!['airport','plane'].includes(e.transport??e.kind))},
              fingerprint:reading.journeyHash,route:{kind:'town'}},coordinator.store.clock());
          }});
      }
    }
    const allocation=coordinator.inventory.status();
    const inventoryStamp=coordinator.inventoryStamp(),sourceFingerprint=inventorySourceFingerprint(state);
    const fingerprint=sha({journey:reading.journeyHash,profile:reading.profileHash,epoch:frame.epoch,
      policy:state.session.management,source:sourceFingerprint,inventory:inventoryStamp});
    const previous=coordinator.wait??coordinator.invalidatedWait;
    // Validate the settled allocation before OCR; idle never supersedes ready work.
    transportPanelExitBoundary(state,{frame,reading,allocation,fingerprint,route:{kind:kind==='train'?'airport':'train'}},coordinator.store.clock());
    const cacheKey=sha({journey:reading.journeyHash,profile:reading.profileHash,invalidation:state.observationInvalidation});
    const current=coordinator.guard(options).state;
    if(current.latestFrameId!==frame.id||coordinator.inventoryStamp()!==inventoryStamp||inventorySourceFingerprint(current)!==sourceFingerprint)
      throw Error('PROGRAM_WAIT_INVALIDATED');
    coordinator.rememberRoute(kind,frame,allocation,[],'transit',cacheKey);
    // A proven empty transport rearms its visual arrival signal.
    if(coordinator.arrivalIndicators[kind]?.token!=='absent'&&coordinator.arrivalIndicators[kind]){
      coordinator.arrivalIndicators[kind]={token:'absent',frameId:frame.id,evidenceHash:frame.evidenceHash};coordinator.saveArrivalIndicators();
    }
    const exit=await coordinator.exitTransitForReadyWork(frame,reading,kind);
    if(exit)return exit;
    installObservationWait(coordinator,waitFor(current,{frame,reading,allocation:coordinator.inventory.status(),fingerprint,previous,
      timers:[]},coordinator.store.clock()),{inventoryStamp:coordinator.inventoryStamp(),sourceFingerprint:inventorySourceFingerprint(current),policyHash:sha(current.session.management),revision:current.revision});
    return coordinator.update('waiting',kind==='train'?'TRAIN_ALL_IN_TRANSIT':'AIRPORT_IN_TRANSIT',{transport:kind,lastObservationAt:frame.observedAt,
      observationSchedule:coordinator.observationSchedule(current),[kind+'Rows']:reading.rows.map(r=>({row:r.row,phase:r.phase})),
      arrivalDetection:'visual',coverage:'registered_transport_routes'});
}

export async function onNativeTown(coordinator,frame,reading){

    try{
      const recheck=marketReturnRecheck(coordinator,frame);
      if(!recheck){const market=await coordinator.tryMarketTown(frame,reading);if(market)return market;}
      const {state,continuity}=coordinator.guard({context:'navigation',allowReconciliation:true});
      if(state.latestFrameId!==frame.id||frame.epoch!==state.scene.epoch||!inputEvidenceValid(frame,coordinator.store.clock(),state))throw Error('CURRENT_FRAME_REQUIRED');
      coordinator.reconcileHistory(state,continuity);coordinator.guard({context:'navigation'});coordinator.busy=true;
      if(!['town','unknown'].includes(state.scene.kind)){
        // A stopped diagnostic/manual visit may have changed the actual screen.
        // Start a fresh observed visit; do not graft the old frame into it.
        coordinator.store.beginVisit({visitId:'native-town-'+sha({session:state.session.id,frame:frame.id}).slice(0,24),kind:'town',required:true});
        return coordinator.update('waiting','CURRENT_TOWN_VISIT_REQUIRED');
      }
      const currentAllocation=coordinator.inventory.status();
      if(currentAllocation.requiresSync===false&&!currentAllocation.holdReasons?.length&&!currentAllocation.projection?.holdReasons?.length){
        const readyKinds=coordinator.arrivalCandidates(frame,reading);
        const choice=coordinator.nextTransport(currentAllocation,{current:'town',readyKinds,helicopterReady:reading.helicopterReady,
          availableKinds:reading.targets.map(t=>t.transportNavigation.to)});
        // An unchanged town needs no new canonical review or full inventory
        // rebuild. Fresh input still goes through normal source/preflight below.
        if(!choice&&!recheck)return coordinator.update('waiting','NO_READY_REGISTERED_TRANSPORT');
      }
      const observed=await observeTransportNavigation(coordinator.store,{frameId:frame.id});
      if(!observed.stored)throw Error(observed.reason);
      coordinator.syncInventory(coordinator.store,coordinator.inventory,{mutationId:'native-town:'+sha({frame:frame.id}),frameIds:[]});
      const allocation=coordinator.inventory.status();
      if(allocation.requiresSync||allocation.holdReasons?.length)throw Error('ALLOCATION_SYNCHRONIZATION_REQUIRED');
      const readyKinds=coordinator.arrivalCandidates(frame,observed);
      const route=recheck??coordinator.nextTransport(allocation,{current:'town',readyKinds,helicopterReady:observed.helicopterReady,
        availableKinds:observed.targets.map(t=>t.transportNavigation.to)}),kind=route?.kind;
      if(!kind)return coordinator.update('waiting','NO_READY_REGISTERED_TRANSPORT');
      const target=observed.targets.find(t=>t.transportNavigation.to===kind);
      if(!target)throw Error('REGISTERED_TRANSPORT_ENTRY_REQUIRED');
      const rejected=Object.values(coordinator.store.load().actions).find(a=>a.status==='rejected_before_input'&&a.target?.transportNavigation?.from==='town'&&a.target?.transportNavigation?.to===kind&&a.nextVisit?.visitId&&coordinator.store.load().frames[a.frameId]?.sceneId===frame.sceneId);
      if(rejected)return coordinator.update('hold','NAVIGATION_REJECTED_WITHOUT_INPUT');
      const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'n'},()=> 'native-nav:'+sha({session:state.session.id,frame:frame.id,kind}).slice(0,32));
      coordinator.navigationActionId=actionId;
      const inventoryStamp=coordinator.inventoryStamp(),policyHash=sha(coordinator.store.load().session.management);
      const currentGuard=settlingNavigation=>{
        const checked=coordinator.guard({context:'navigation',phase:settlingNavigation?'owned-input':'observe'});
        if(checked.state.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');
        if(coordinator.inventoryStamp()!==inventoryStamp||sha(checked.state.session.management)!==policyHash)throw Error('NAVIGATION_ALLOCATION_CHANGED');
        return checked;
      };
      const result=await navigateReviewed(coordinator.store,{frameId:frame.id,actionId,targetId:target.id,
        nextVisit:{visitId:actionId+'-result',kind,required:true}},
        {device:coordinator.device,beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
      if(result.status==='issued')coordinator.consumeArrival(frame,observed,kind);
      return coordinator.update('waiting','NAVIGATION_RESULT_REQUIRED',{navigationActionId:actionId,transport:kind});
    }catch(error){return coordinator.update('hold',error.message);}
    finally{coordinator.busy=false;coordinator.update(coordinator.state.phase,coordinator.state.reason);}
}
