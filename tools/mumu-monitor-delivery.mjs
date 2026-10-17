import {readMonitorDelivery} from './mumu-delivery-status-reader.mjs';
export {readMonitorDelivery} from './mumu-delivery-status-reader.mjs';
import {armHelicopterSelectionRecovery,continueHelicopterSelectionRecovery} from './mumu-helicopter-selection-recovery.mjs';
import {consumeHelicopterSelectionSeed} from './mumu-helicopter-selection-seed.mjs';
import {marketSession,finishMarketOrderRecheck} from './mumu-market-session.mjs';
import {refreshHelicopterRegistration} from './mumu-registration-refresh.mjs';
import {inspectDeliveryGeometry} from './mumu-delivery-geometry.mjs';
import {retireBarnShortageForCurrentOrders} from './mumu-barn-recovery.mjs';
import {deliveryModuleContext} from './mumu-delivery-context.mjs';
import {resetHelicopterObservationSession,retainHelicopterSurveyContinuity,restoreHelicopterSurveyContinuity,continueHelicopterScheduling} from './mumu-helicopter-session.mjs';
import {detectHelicopterSelectionMarker,helicopterSelectionMarkerRegistration} from './mumu-helicopter-selection-marker.mjs';
import {deliveryStatus,saveDeliveryStatus} from './mumu-delivery-status.mjs';
import {clearObservationWait} from './mumu-observation-wait-lifecycle.mjs';
import {continueFrame,dispatchDeliveryFrame} from './mumu-monitor-frame-dispatch.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {startUnknownProductCollection,handleUnknownProductResult,recoverRejectedProductDismissal} from './mumu-monitor-helicopter-info.mjs';
import {helicopterInfoRegistration} from './mumu-helicopter-info-proof.mjs';
import {collectHelicopterObservation} from './mumu-helicopter-observation-evidence.mjs';
import {newHelicopterSurvey,surveyStep,noteSurveySelection} from './mumu-helicopter-survey.mjs';
import {transportEnabled} from './mumu-delivery-scope.mjs';
import {transportKind} from './mumu-transport-kind.mjs';
import {transportState} from './mumu-transport-state.mjs';
import {assertDeliveryContext} from './mumu-monitor-delivery-guard.mjs';
import {deliveryHold,failedObservation,observationRetryDue} from './mumu-delivery-state.mjs';
import * as routingDelivery from './mumu-monitor-delivery-routing.mjs';
import * as eventsDelivery from './mumu-monitor-delivery-events.mjs';
import * as trainDelivery from './mumu-monitor-delivery-train.mjs';
import * as airportDelivery from './mumu-monitor-delivery-airport.mjs';
import * as marketDelivery from './mumu-monitor-delivery-market.mjs';
import {createDeliveryAllocation} from './mumu-delivery-allocation.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {runTransportMission} from './mumu-automatic.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {reconcileVerifiedTransportMissions} from './mumu-automatic.mjs';
import {readEventClose} from './mumu-event-close.mjs';
// Invoked only inside an owned producer's awaited frame callback. This module
// grants no approval, clears no stops, and recovers no foreign or unknown input.
import {existsSync,readFileSync,mkdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {digest} from './adb.mjs';
import {cropPng} from './png-crop.mjs';
import {inventorySourceFingerprint} from './mumu-inventory-store.mjs';
import {observeHelicopter,syncOrderInventory,reusableHelicopterAnalysis,helicopterReceipt} from './mumu-helicopter.mjs';
import {helicopterProfile,selectionCapability,selectionAttempts,sameSelectionCaptureTarget,validateHelicopterProof} from './mumu-helicopter-proof.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {inputGeometry,commandForTarget,resolvePercentageCommand} from './percentage-coordinates.mjs';
import {resultCaptureDueAt} from './mumu-timing.mjs';
import {PerceptionWorker,RapidOcrWorker,helicopterWorkerOptions,supportedWindowsGeometry,DEFAULT_MARKET_PROFILE} from './mumu-perception-bridge.mjs';
import {readContinuity,runContinuingHelicopter,sameNavigationPins,validUnambiguousNavigationPins} from './mumu-continuity.mjs';
import {sameVisibleNavigationMap} from './mumu-helicopter-map-visibility.mjs';
import {reconcileInactiveHelicopterRounds,helicopterReconciliationSummary,nextNavigationTarget} from './mumu-helicopter-loop.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {atomic} from './mumu-persistence.mjs';
import {navigateTown,townNavigationStatus} from './mumu-town-navigation.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';

import {readTransportNavigation,transportNavigationProfile} from './mumu-transport-navigation-proof.mjs';
import {observeTransportNavigation} from './mumu-transport-navigation.mjs';
import {readMayorsCup} from './mumu-mayors-cup-proof.mjs';
import {cupPredecessor} from './mumu-mayors-cup.mjs';

const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const unresolved=state=>state.input||hasUnresolvedActions(state.actions??{});
export class MonitorDelivery{
  constructor(store,{inventoryRoot,device,signal,onEvent=()=>{},workersFactory=()=>({
    matcher:new PerceptionWorker({...helicopterWorkerOptions(store.load().session),marketProfile:DEFAULT_MARKET_PROFILE,timeoutMs:60000}),ocr:new RapidOcrWorker()
  }),observe=observeHelicopter,syncInventory=syncOrderInventory,run=runContinuingHelicopter,roundOptions={}}={}){
    Object.assign(this,{store,device,signal,onEvent,workersFactory,observe,syncInventory,run,roundOptions});
    this.inventory=createDeliveryAllocation(store,inventoryRoot);
    this.currentMode=this.inventory?.allocationKind==='current_screen';
    if(this.currentMode)this.syncInventory=()=>this.inventory.sync();
    for(const kind of ['train','airport','helicopter'])transportState(this,kind);
    this.transports.train.slotContexts=new Map();
    marketSession(this);
    this.workers=null;this.owner=null;this.busy=false;this.lastKey=null;this.passiveObservationKey=null;this.navigationActionId=null;
    this.state=readMonitorDelivery(store);this.eventKey=null;this.wait=null;this.invalidatedWait=null;this.waitRevision=null;
  }
  status(){return deliveryStatus(this.state,this.busy);}
  update(phase,reason=null,extra={}){
    this.state={...this.state,phase,reason,...extra,hold:deliveryHold(reason)};
    const status=this.status(),key=sha(status);
    if(key!==this.eventKey){
      saveDeliveryStatus(this.store,this.owner,status);
      this.eventKey=key;this.onEvent(status);
    }
    return this.status();
  }
  inventoryStamp(){if(this.currentMode)return this.inventory.stamp();const s=statSync(this.inventory.file,{bigint:true});return s.mtimeNs+':'+s.ctimeNs+':'+s.size;}
  noteCurrentOrder(frame){
    const pending=this.marketReturnRecheckPending;if(!pending||frame.sequence<=pending.afterSequence)return;
    const state=this.store.load(),f=state.frames[frame.id],o=f?.review?.data?.order,d=f?.review?.data;
    const full=d?.train?.fullDemandConfirmed??d?.airport?.fullDemandConfirmed??o?.orderConfirmed;
    const current=currentScreenNeeds(state,{now:this.store.clock(),afterSequence:pending.afterSequence});
    const observed=current.orders.find(n=>n.orderId===o?.orderId);
    if(!acceptedFacts(f)||!full||!observed?.needs?.length||current.held.some(h=>h.orderId===o.orderId)||
      observed.needs.some(n=>!n.itemId||!Number.isSafeInteger(n.required)||!Number.isSafeInteger(n.owned)))return;
    const kind=f.review.actualKind;
    pending.pending=pending.pending.filter(k=>transportKind(k)!==kind);
    if(!pending.pending.length){finishMarketOrderRecheck(this);}
  }
  async currentHelicopter(frame,observed){
    frame=this.store.load().frames[frame.id];
    const selectionSeed=consumeHelicopterSelectionSeed(this,frame,observed.matching);
    if(this.transports.helicopter.plan){
      const result=await runTransportMission(this.store,this.inventory,this.transports.helicopter.plan,{device:this.device});
      if(result.status!=='complete')return this.update('hold',result.reason??'HELICOPTER_RESULT_REQUIRED');
      this.transports.helicopter.plan=null;this.transports.helicopter.actionId=null;
    }
    if(this.currentMode&&this.geometryRecheckRequired){
      const result=this.reobserveHelicopterMap(frame,observed.matching);
      this.geometryRecheckRequired=false;return result;
    }
    if(this.currentMode){
      restoreHelicopterSurveyContinuity(this,frame,observed.matching);
      if(this.helicopterMapFrameId&&!continueHelicopterScheduling(this,frame))resetHelicopterObservationSession(this);
    }
    if(this.currentMode&&validUnambiguousNavigationPins(observed.matching?.mapTargets)){
      const mapState=this.helicopterMapPins?this.store.load():null;
      if(this.helicopterMapPins&&!sameVisibleNavigationMap(mapState,this.helicopterMapPins,observed.matching.mapTargets,
        mapState.frames[this.helicopterMapFrameId],frame))
        return this.reobserveHelicopterMap(frame,observed.matching);
      this.helicopterMapPins=structuredClone(observed.matching.mapTargets);
      this.helicopterMapFrameId=frame.id;
      this.helicopterSchedulingProfileHash=helicopterSelectionMarkerRegistration().hash;
    }
    if(retireBarnShortageForCurrentOrders(this.store,frame))this.state.barnRecovery=null;
    const infoRegistration=helicopterInfoRegistration(),infoConfig=infoRegistration.config;
    const surveyEnabled=this.currentMode&&infoConfig.surveyOrdersFirst===true&&
      frame.width===infoConfig.dimensions.width&&frame.height===infoConfig.dimensions.height;
    if(surveyEnabled){
      this.guard();
      const evidence=this.store.evidence(frame.id);
      const info=await this.workers.matcher.analyze(frame,evidence.bytes,{offline:true,helicopterInfo:true});
      if(info.status!=='candidate'||info.productInfoProfileHash!==infoRegistration.hash||
          !Array.isArray(info.productInfo?.popups)||info.productInfo.popups.length)
        throw Error('HELICOPTER_INFO_SOURCE_REQUIRED');
      this.guard();
      if(this.store.load().latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');
      try{
        const collected=collectHelicopterObservation(this.productEvidenceRoot??infoConfig.evidenceRoot,frame,
          evidence,observed.matching,helicopterProfile(frame).profile);
        this.state.orderEvidence=collected?{orderKey:collected.orderKey,status:collected.status}:null;
        this.state.orderEvidenceError=null;
      }catch(error){this.state.orderEvidenceError=error.message;}
      const normalOrderSelection=observed.review.data.order?.kind==='normal'&&observed.review.targets.some(t=>
        t.kind==='select_customer'&&t.currentHelicopterSelection?.sourcePanel==='normal_order');
      if(!this.helicopterSurvey){
        const visited=await this.selectionVisited(frame,observed.matching);
        let selected=this.helicopterSelectedMapId??selectionSeed;
        if(!selected&&normalOrderSelection){
          const marker=detectHelicopterSelectionMarker(frame,evidence,observed.matching);
          this.state.helicopterSelectionMarker=marker;
          if(marker.status!=='selected'){
            if(armHelicopterSelectionRecovery(this,frame,marker))return this.update('waiting','HELICOPTER_SELECTION_BOOTSTRAP_SOURCE_REQUIRED');
            return this.update('hold',marker.reason);
          }
          selected=marker.mapId;
        }
        this.helicopterSurvey=newHelicopterSurvey(visited,selected);
      }
      if(!this.helicopterSurvey.selectedMapId&&normalOrderSelection){
        const marker=detectHelicopterSelectionMarker(frame,evidence,observed.matching);
        this.state.helicopterSelectionMarker=marker;
        if(marker.status!=='selected'){
          if(armHelicopterSelectionRecovery(this,frame,marker))return this.update('waiting','HELICOPTER_SELECTION_BOOTSTRAP_SOURCE_REQUIRED');
          return this.update('hold',marker.reason);
        }
        this.helicopterSurvey.selectedMapId=marker.mapId;
        this.helicopterSurvey.visited.push(marker.mapId);
        if(this.helicopterSurvey.phase==='collect')this.helicopterSurvey.collectVisited.push(marker.mapId);
      }
      const step=surveyStep(this.helicopterSurvey,observed.review);
      this.state.helicopterSurvey={phase:step.phase,attemptedLocations:this.helicopterSurvey.visited.length};
      if(step.target)return this.selectCurrentHelicopterOrder(frame,step.target,this.helicopterSurvey);
    }
    // Identity uncertainty does not block the first pass. Information dialogs
    // are opened only after every currently supported pin was inspected.
    if(await startUnknownProductCollection(this,frame,observed))return this.status();
    const state=this.guard().state,allocation=this.inventory.status(),order=observed.review.data.order;
    this.noteCurrentOrder(frame);
    const evaluated=allocation.evaluations.find(o=>o.orderId===order?.orderId);
    const action=observed.review.targets.find(t=>t.kind==='delete_helicopter')??(evaluated?.status==='feasible'?observed.review.targets.find(t=>t.kind==='send_helicopter'):null);
    if(action){
      const actionId=generatedActionId(state,{frameId:frame.id,targetId:action.id,kind:'h'},()=> 'current-heli:'+sha({session:state.session.id,frame:frame.id,target:action.id}).slice(0,32));
      this.transports.helicopter.actionId=actionId;
      this.transports.helicopter.plan={source:'explicit_user',sessionId:state.session.id,missionId:actionId,maxCoins:0,steps:[{actionId,frameId:frame.id,targetId:action.id,kind:action.kind,orderId:order.orderId,nextVisit:{visitId:actionId+'-result',kind:'helicopter'}}]};
      const guard=settling=>{const s=this.guard({phase:settling?'owned-input':'observe'}).state;if(s.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');};
      const result=await runTransportMission(this.store,this.inventory,this.transports.helicopter.plan,{device:this.device,beforeBegin:()=>guard(false),beforeInputGuard:()=>guard(true)});
      return this.update(result.status==='waiting_result_review'?'delivering':'hold',result.reason??'HELICOPTER_RESULT_REQUIRED');
    }
    // Source the known current shortage before surveying unrelated pins. A
    // fresh startup cannot safely infer which normal-order pin is selected.
    if(evaluated?.status==='shortage'&&marketDelivery.marketRoutingNeed(deliveryModuleContext(this,'market'),state)){
      this.currentHelicopterExhausted={frameId:frame.id,allocationKey:this.inventory.stamp()};
      this.lastKey=await this.key(frame,null,observed.matching);
      return this.enterWait(frame,this.lastKey);
    }
    this.helicopterVisited??=[];
    if(surveyEnabled)this.helicopterVisited=this.helicopterSurvey.collectVisited;
    else if(this.helicopterVisitId!==frame.sceneId&&!this.navigationActionId){this.helicopterVisited=await this.selectionVisited(frame,observed.matching);this.helicopterVisitId=frame.sceneId;}
    const target=nextNavigationTarget(observed.review,this.helicopterVisited);
    if(target){
      return this.selectCurrentHelicopterOrder(frame,target,surveyEnabled?this.helicopterSurvey:null);
    }
    this.currentHelicopterExhausted={frameId:frame.id,allocationKey:this.inventory.stamp()};
    this.lastKey=await this.key(frame,null,observed.matching);
    return this.enterWait(frame,this.lastKey);
  }
  async selectCurrentHelicopterOrder(frame,target,survey=null){
    const state=this.guard().state;
    const actionId=generatedActionId(state,{frameId:frame.id,targetId:target.id,kind:'s'},()=> 'current-select:'+sha({session:state.session.id,frame:frame.id,target:target.id}).slice(0,32));this.navigationActionId=actionId;
    const guard=settling=>{const s=this.guard({phase:settling?'owned-input':'observe'}).state;if(s.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');};
    await navigateReviewed(this.store,{actionId,frameId:frame.id,targetId:target.id,nextVisit:{visitId:actionId+'-result',kind:'helicopter'}},{device:this.device,beforeBegin:()=>guard(false),beforeInputGuard:()=>guard(true)});
    if(survey)noteSurveySelection(survey,target);else this.helicopterVisited.push(target.mapId);
    this.helicopterVisitId=actionId+'-result';
    return this.update('waiting','HELICOPTER_SELECTION_RESULT_REQUIRED');
  }
  routeMemory(...args){return routingDelivery.routeMemory(this,...args);}
  rememberRoute(...args){return routingDelivery.rememberRoute(this,...args);}
  observeActiveTransport(...args){return routingDelivery.observeActiveTransport(this,...args);}
  nextTransport(...args){return routingDelivery.nextTransport(this,...args);}
  saveArrivalIndicators(...args){return routingDelivery.saveArrivalIndicators(this,...args);}
  arrivalCandidates(...args){return routingDelivery.arrivalCandidates(this,...args);}
  consumeArrival(...args){return routingDelivery.consumeArrival(this,...args);}
  observationSchedule(...args){return routingDelivery.observationSchedule(this,...args);}
  async enterWait(...args){return routingDelivery.enterWait(this,...args);}
  guard(options={}){return assertDeliveryContext(this,options);}
  reobserveHelicopterMap(frame,analysis){
    // A changed, supported map retires disposable observations, never an input.
    // Commit the fresh visit and count fence together before requesting a PNG.
    if(!this.currentMode)throw Error('HELICOPTER_SELECTION_MAP_CHANGED');
    this.guard();
    if(analysis?.status!=='candidate'||analysis.scene?.kind!=='helicopter'||
        analysis.frameId!==frame.id||analysis.evidenceHash!==frame.evidenceHash||
        analysis.epoch!==frame.epoch||analysis.sequence!==frame.sequence||analysis.observedAt!==frame.observedAt||
        !validUnambiguousNavigationPins(analysis.mapTargets))throw Error('HELICOPTER_SELECTION_MAP_CHANGED');
    const visitId='heli-map:'+frame.sequence.toString(36)+':'+frame.epoch.toString(36);
    const continuity=this.geometryRecheckRequired?null:retainHelicopterSurveyContinuity(this,frame,analysis,visitId);
    this.store.transact(s=>{
      this.guard();
      if(unresolved(s))throw Error('INPUT_UNRESOLVED');
      if(s.latestFrameId!==frame.id||s.scene.epoch!==frame.epoch||s.scene.id!==frame.sceneId||
          !acceptedFacts(s.frames[frame.id])||s.frames[frame.id].review.actualKind!=='helicopter')throw Error('CURRENT_FRAME_REQUIRED');
      if(s.visits[visitId])throw Error('VISIT_ID_REUSED');
      const at=new Date(this.store.clock()).toISOString();
      s.observationInvalidation={sequence:s.sequence,at,reason:'helicopter_map_changed',sceneId:visitId};
      s.observationWait=null;s.latestCandidateFrameId=null;
      s.scene={id:visitId,kind:'helicopter',entityId:null,epoch:s.scene.epoch+1,required:true,
        roi:null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
      s.visits[visitId]={...structuredClone(s.scene),startedAt:at,status:'awaiting_capture',frameId:null};
    });
    resetHelicopterObservationSession(this);
    this.helicopterPendingContinuity=continuity;
    return this.update('recognizing','HELICOPTER_MAP_REOBSERVATION_REQUIRED',
      {observationSchedule:null,observationRetry:null,exception:null,navigationActionId:null});
  }
  checkSelectionMap(before,analysis){
    if(before.status!=='candidate'||before.scene?.kind!=='helicopter'||
        !validUnambiguousNavigationPins(before.mapTargets)||
        !validUnambiguousNavigationPins(analysis.mapTargets))throw Error('HELICOPTER_SELECTION_MAP_CHANGED');
    if(sameNavigationPins(before.mapTargets,analysis.mapTargets))return;
    const state=this.store.load();
    if(!sameVisibleNavigationMap(state,before.mapTargets,analysis.mapTargets,state.frames[before.frameId],state.frames[analysis.frameId]))
      throw Object.assign(Error('HELICOPTER_SELECTION_MAP_CHANGED'),{reobserveMap:true,mapAnalysis:analysis});
  }
  async selectionSendBoundary(state,action,frame,analysis,sceneId){
    this.guard();
    const fail=()=>{throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');};
    const source=state.frames[action.frameId],result=state.frames[action.resultFrameId],proof=action.resultProof;
    if(!this.currentMode||unresolved(state)||state.latestFrameId!==frame.id||state.scene.epoch!==frame.epoch||
        state.scene.id!==frame.sceneId||!source||!result||proof?.schema!==1||action.status!=='verified'||
        action.target?.kind!=='send_helicopter'||action.lifecycle||action.management!==true||action.command?.type!=='tap'||
        action.targetId!==action.target.id||action.nextVisit?.kind!=='helicopter'||action.nextVisit.visitId!==sceneId||
        source.epoch+1!==action.epoch||result.epoch!==action.epoch||result.sceneId!==sceneId||
        result.sequence<=source.sequence||frame.sequence<result.sequence||frame.epoch<result.epoch||
        state.orderDemandStartup?.cutoffSequence>=source.sequence||
        state.observationInvalidation?.sequence>=source.sequence||!acceptedFacts(source)||!acceptedFacts(result)||
        source.review.reviewedBy!=='program-helicopter'||result.review.reviewedBy!=='program-helicopter'||
        !source.review.targets.some(t=>sha(t)===sha(action.target))||
        action.coordinateSource?.frameId!==source.id||action.coordinateSource.evidenceHash!==source.evidenceHash||
        action.preflightEvidence?.sourceFrameId!==source.id||action.preflightEvidence.actionId!==action.id||
        action.preflightEvidence.epoch!==action.epoch||action.deviceReceipt?.actionId!==action.id||
        action.deviceReceipt.commandIssued!==true||result.review.proof?.inputId!==action.id||
        sha(proof.review)!==sha(result.review)||analysis.frameId!==frame.id||analysis.evidenceHash!==frame.evidenceHash||
        analysis.epoch!==frame.epoch||analysis.sequence!==frame.sequence||analysis.observedAt!==frame.observedAt||
        analysis.status!=='candidate'||analysis.scene?.kind!=='helicopter')fail();
    for(const captured of [source,result,action.preflightEvidence])if(captured.provider!==frame.provider||
        captured.serial!==frame.serial||captured.width!==frame.width||captured.height!==frame.height||
        !sameSelectionCaptureTarget(captured.captureTarget,frame.captureTarget))fail();
    const issued=Date.parse(action.issuedAt),captured=Date.parse(result.captureStartedAt),observed=Date.parse(result.observedAt),
      currentCaptured=Date.parse(frame.captureStartedAt),currentObserved=Date.parse(frame.observedAt);
    if(!Number.isFinite(issued)||!Number.isFinite(captured)||!Number.isFinite(observed)||
        !Number.isFinite(currentCaptured)||!Number.isFinite(currentObserved)||currentCaptured<captured||
        currentObserved<observed||currentObserved<currentCaptured||
        captured<resultCaptureDueAt({...action,status:'captured'})||observed<captured)fail();
    validateHelicopterProof(source);validateHelicopterProof(result);
    const effect=actionEffect(state,action),receipt=helicopterReceipt(state,{...action,status:'captured'},result,result.review);
    if(!receipt||effect?.confirmed!==true||effect.actionId!==action.id||effect.frameId!==result.id||
        sha(effect)!==sha(result.review.data.actionResult)||sha(effect)!==sha(receipt))fail();
    const geometry=inputGeometry(state.session,source);
    resolvePercentageCommand(action.percentageCommand,geometry,action.command);
    if(sha(commandForTarget(action.target,null,geometry).command)!==sha(action.command))fail();
    let resultEvidence;
    for(const original of [source,result]){
      const evidence=this.store.evidence(original.id);
      if(digest(evidence.bytes)!==original.evidenceHash||evidence.image.width!==original.width||evidence.image.height!==original.height)fail();
      if(original===result)resultEvidence=evidence;
    }
    // Delivery changes the map legitimately. The verified result is the new
    // navigation boundary; only later map changes use fresh re-observation.
    const before=await this.workers.matcher.analyze(result,resultEvidence.bytes,{helicopter:true,offline:true});
    const current=this.guard().state;
    if(current.revision!==state.revision||current.latestFrameId!==frame.id||unresolved(current)||
        before.frameId!==result.id||before.evidenceHash!==result.evidenceHash||before.epoch!==result.epoch||
        before.sequence!==result.sequence||before.observedAt!==result.observedAt||
        before.helicopterProfileHash!==helicopterProfile(result).hash)fail();
    this.checkSelectionMap(before,analysis);
  }
  async selectionVisited(frame,analysis){
    const state=this.store.load(),visited=[],seen=new Set();let sceneId=frame.sceneId,currentSelectionRead=false;
    this.helicopterSelectedMapId=null;
    // Follow only the canonical visit chain. Never reset exclusions on a gap,
    // external invalidation, missing original or ambiguous edge. A supported
    // map change is handled separately by the native fresh-observation path.
    while(true){
      if(seen.has(sceneId))throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');seen.add(sceneId);
      // The fresh startup scene is a new observation root, with no old pin exclusions.
      if(state.orderDemandStartup?.currentIncarnation&&sceneId==='restart:'+state.orderDemandStartup.currentIncarnation&&
          frame.sequence>state.orderDemandStartup.cutoffSequence)break;
      if(this.currentMode&&state.observationInvalidation?.reason==='helicopter_map_changed'&&
          sceneId===state.observationInvalidation.sceneId&&frame.sequence>state.observationInvalidation.sequence)break;
      const external=Object.values(state.externalHelicopterSelectionResolutions??{}).filter(r=>r.visitId===sceneId);
      if(external.length){
        if(external.length!==1)throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
        const r=external[0],a=state.actions[r.actionId],source=state.frames[r.originalAction?.frameId];
        const saved=JSON.parse(readFileSync(join(this.store.root,'.management',r.id+'.json'),'utf8'));
        if(sha(saved.receipt)!==sha(r)||r.source!=='explicit_user'||r.confirmation!=='user_manually_selected_other_order'||
            r.originalInputOutcome!=='unknown'||r.deliverySuccessClaimed!==false||
            sha(a)!==sha({...r.originalAction,status:'externally_superseded',externalResolutionId:r.id})||
            !source||!sameSelectionCaptureTarget(source.captureTarget,frame.captureTarget)||
            source.provider!==frame.provider||source.serial!==frame.serial||source.width!==frame.width||source.height!==frame.height)
          throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
        const before=await this.workers.matcher.analyze(source,this.store.evidence(source.id).bytes,{helicopter:true,offline:true});this.guard();
        if(!Array.isArray(r.excludedMapIds)||!r.excludedMapIds.includes(r.selectedMapId)||!r.excludedMapIds.includes(r.originalAction.target.mapId))throw Error('HELICOPTER_SELECTION_MAP_CHANGED');
        this.checkSelectionMap(before,analysis);
        visited.push(...r.excludedMapIds);break;
      }
      const incoming=Object.values(state.actions).filter(a=>a.nextVisit?.visitId===sceneId);
      if(incoming.length!==1)throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
      const a=incoming[0];
      if(a.status!=='verified'||a.nextVisit.kind!=='helicopter')throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
      if(a.target?.kind==='open_helicopter')break;
      if(a.target?.kind==='send_helicopter'){
        await this.selectionSendBoundary(state,a,frame,analysis,sceneId);break;
      }
      if(a.target?.helicopterProductInfo){
        const origin=state.frames[a.target.helicopterProductInfo.sourceFrameId];
        if(a.target.helicopterProductInfo.mode!=='dismiss'||!origin||origin.evidenceHash!==a.target.helicopterProductInfo.sourceHash||
          a.resultProof?.navigation?.confirmed!==true||a.resultProof.navigation.mode!=='dismiss'||a.resultProof.navigation.actionId!==a.id)
          throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
        const source=state.frames[a.frameId],restartOf=source?.review?.data?.helicopterProductInfo?.restartOf;
        if(restartOf){
          const interrupted=state.actions[restartOf],marker=state.orderDemandStartup;
          // This dismissal was authorized from a newly observed startup popup.
          // Its item crop keeps the older registration original, but navigation
          // starts at the fresh visit instead of restoring old pin exclusions.
          if(!acceptedFacts(source)||source.review.reviewedBy!=='program-helicopter-info'||source.review.proof?.role!=='source'||
            source.sceneId!=='restart:'+marker?.currentIncarnation||source.sequence<=marker.cutoffSequence||source.epoch+1!==a.epoch||
            interrupted?.status!=='superseded_on_restart'||!marker.completed?.[interrupted.restartSupersession?.incarnation]?.actionIds?.includes(restartOf)||
            sha({...interrupted.target?.helicopterProductInfo,mode:'dismiss'})!==sha(a.target.helicopterProductInfo)||
            source.provider!==frame.provider||source.serial!==frame.serial||source.width!==frame.width||source.height!==frame.height||
            !sameSelectionCaptureTarget(source.captureTarget,frame.captureTarget))throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
          sceneId=source.sceneId;continue;
        }
        sceneId=origin.sceneId;continue;
      }
      if(a.target?.kind!=='select_customer'||a.command?.type!=='tap')throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
      const source=state.frames[a.frameId],result=state.frames[a.resultFrameId];
      if(!source||!result||!acceptedFacts(result)||source.epoch+1!==a.epoch||result.epoch!==a.epoch||
          result.sceneId!==sceneId||source.provider!==frame.provider||source.serial!==frame.serial||
          source.width!==frame.width||source.height!==frame.height||
          !sameSelectionCaptureTarget(source.captureTarget,frame.captureTarget)||
          state.observationInvalidation?.sequence>=source.sequence)throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
      const evidence=this.store.evidence(source.id);
      const before=await this.workers.matcher.analyze(source,evidence.bytes,{helicopter:true,offline:true});
      this.guard();
      this.checkSelectionMap(before,analysis);
      if(!currentSelectionRead){
        currentSelectionRead=true;
        const current=analysis.mapTargets.filter(p=>Math.hypot(p.box.x+p.box.width/2-a.command.x,p.box.y+p.box.height/2-a.command.y)<=24);
        if(current.length===1)this.helicopterSelectedMapId=current[0].mapId;
      }
      visited.push(`pin:${a.command.x}:${a.command.y}`);sceneId=source.sceneId;
    }
    // Failed attempts in this same chain are exclusions too, never retry seeds.
    for(const a of Object.values(state.actions))if(a.target?.kind==='select_customer'&&seen.has(state.frames[a.frameId]?.sceneId)){
      if(a.command?.type!=='tap'||!Number.isSafeInteger(a.command.x)||!Number.isSafeInteger(a.command.y))throw Error('HELICOPTER_SELECTION_SCOPE_REQUIRED');
      visited.push(`pin:${a.command.x}:${a.command.y}`);
    }
    return visited;
  }
  async selectObservationOrder(frame,observed){
    const c=selectionCapability(helicopterProfile(frame).profile);if(!c)return false;
    let {state}=this.guard();
    if(selectionAttempts(state,c.activationId).length>=c.maxIssuedSelections){this.update('hold','HELICOPTER_SELECTION_CAP_REACHED');return true;}
    if(!observed.review.data.order?.signature)throw Error('HELICOPTER_SELECTION_KNOWN_SOURCE_REQUIRED');
    const visited=await this.selectionVisited(frame,observed.matching);
    state=this.guard().state;
    if(state.latestFrameId!==frame.id||state.scene.epoch!==frame.epoch)throw Error('CURRENT_FRAME_REQUIRED');
    const target=nextNavigationTarget(observed.review,visited);
    if(!target){this.update('hold','HELICOPTER_SELECTION_NO_UNVISITED_PIN');return true;}
    const actionId=generatedActionId(state,{frameId:frame.id,targetId:target.id,kind:'s'},()=> 'heli-select:'+sha({session:state.session.id,activationId:c.activationId}).slice(0,32));
    const inventoryStamp=this.inventoryStamp(),policyHash=sha(state.session.management),revision=state.revision;
    const check=(settling=false)=>{
      const checked=this.guard({phase:settling?'owned-input':'observe'}).state;
      if(checked.latestFrameId!==frame.id||checked.scene.epoch!==(settling?frame.epoch+1:frame.epoch)||
          this.inventoryStamp()!==inventoryStamp||sha(checked.session.management)!==policyHash)throw Error('HELICOPTER_SELECTION_CONTEXT_CHANGED');
      if(!settling&&checked.revision!==revision)throw Error('HELICOPTER_SELECTION_CONTEXT_CHANGED');
    };
    this.navigationActionId=actionId;
    const result=await navigateReviewed(this.store,{actionId,frameId:frame.id,targetId:target.id,
      nextVisit:{visitId:actionId,kind:'helicopter'}},{device:this.device,beforeBegin:()=>check(),beforeInputGuard:()=>check(true)});
    if(result.duplicate)throw Error('ACTION_ALREADY_EXISTS');
    this.update('waiting','HELICOPTER_SELECTION_RESULT_REQUIRED',{navigationActionId:actionId});return true;
  }
  reconcileHistory(state,continuity){
    if(this.currentMode)return; // Real unfinished journals are held by guard.
    if(Object.entries(state.helicopterRounds??{}).some(([id,r])=>id!==continuity.currentRoundId&&!['boundary','complete'].includes(r.status))){
      this.busy=true;this.update('reconciling');
      const reconciliation=reconcileInactiveHelicopterRounds(this.store,this.inventory,
        {excludeRoundId:continuity.currentRoundId??null,ownerToken:this.owner.token});
      this.update('reconciling',null,{reconciliation});
    }
  }
  recognitionContext(frame){
    const state=this.store.load(),{profile,hash}=helicopterProfile(frame);
    const evidence=this.store.evidence(frame.id);
    if(evidence.image.width!==profile.dimensions.width||evidence.image.height!==profile.dimensions.height)throw Error('HELICOPTER_LAYOUT_CHANGED');
    const boxes=[...profile.anchors.map(a=>a.sourceBox),...profile.slots.flatMap(s=>[s.iconBox,s.quantityBox,s.checkBox]),
      profile.sendBox,profile.deleteBox].filter(Boolean);
    return {state,profile,hash,evidence,pixels:digest(Buffer.concat(boxes.map(box=>cropPng(evidence.image,box))))};
  }
  async key(frame,analysisSink=null,analysis=null,context=null){
    const {state,profile,hash,evidence,pixels}=context??this.recognitionContext(frame);
    if(refreshHelicopterRegistration(this,hash))analysis=null;
    // Reuse native navigation geometry instead of hashing animated map imagery.
    // Full matching is read-only; numeric OCR still runs only after a key change.
    this.workers??=this.workersFactory();
    const matching=reusableHelicopterAnalysis(analysis,evidence.frame,{profile,hash},this.workers.matcher,state)??
      await this.workers.matcher.analyze(evidence.frame,evidence.bytes,{helicopter:true,offline:true});
    if(analysisSink)analysisSink(matching);
    const bound=matching.frameId===frame.id&&matching.evidenceHash===frame.evidenceHash&&matching.epoch===frame.epoch&&
      matching.sequence===frame.sequence&&matching.observedAt===frame.observedAt&&matching.helicopterProfileHash===hash&&
      matching.status==='candidate'&&matching.scene?.kind==='helicopter';
    this.keySupported=bound;let map;
    if(bound&&validUnambiguousNavigationPins(matching.mapTargets)){
      if(this.mapState?.epoch!==frame.epoch||this.mapState.profile!==hash||!sameNavigationPins(this.mapState.pins,matching.mapTargets))
        this.mapState={epoch:frame.epoch,profile:hash,pins:structuredClone(matching.mapTargets)};
      map=this.mapState.pins;
    }else{this.mapState=null;map=digest(cropPng(evidence.image,profile.mapBox));} // Conservative fallback.
    const allocation=this.inventory.status();
    return sha({image:pixels,map,profile:hash,
      epoch:frame.epoch,policy:state.session.management,source:inventorySourceFingerprint(state),
      inventory:{config:allocation.config,orders:allocation.orders,evaluations:allocation.evaluations,
        items:Object.fromEntries(Object.entries(allocation.projection?.items??{}).map(([id,item])=>[id,{quantity:item.quantity,status:item.status,fresh:item.fresh}])),
        reservations:allocation.projection?.reservations}});
  }
  async onAirportFrame(...args){return airportDelivery.onAirportFrame(this,...args);}
  airportLoadingKey(...args){return airportDelivery.airportLoadingKey(this,...args);}
  async onAirportLoadingFrame(...args){return airportDelivery.onAirportLoadingFrame(this,...args);}
  async exitPolicyAirport(...args){return airportDelivery.exitPolicyAirport(this,...args);}
  async inspectAirportDetail(...args){return airportDelivery.inspectAirportDetail(this,...args);}
  async onTrainFrame(...args){return trainDelivery.onTrainFrame(this,...args);}
  async enterTrainWait(...args){return trainDelivery.enterTrainWait(this,...args);}
  async exitTransitForReadyWork(...args){return routingDelivery.exitTransitForReadyWork(this,...args);}
  async exitPanel(...args){return routingDelivery.exitPanel(this,...args);}
  async enterTransitWait(...args){return routingDelivery.enterTransitWait(this,...args);}
  trainLoadingKey(...args){return trainDelivery.trainLoadingKey(this,...args);}
  holdTrainLoading(...args){return trainDelivery.holdTrainLoading(this,...args);}
  async exitHeldTrain(...args){return trainDelivery.exitHeldTrain(this,...args);}
  async onTrainLoadingFrame(...args){return trainDelivery.onTrainLoadingFrame(this,...args);}
  async inspectTrainDetail(...args){return trainDelivery.inspectTrainDetail(this,...args);}
  async onNativeTown(...args){return routingDelivery.onNativeTown(this,...args);}
  async onEventCloseFrame(...args){return eventsDelivery.onEventCloseFrame(deliveryModuleContext(this,'events'),...args);}
  async onMayorsCupFrame(...args){return eventsDelivery.onMayorsCupFrame(deliveryModuleContext(this,'events'),...args);}
  async onMarketFrame(...args){return marketDelivery.onMarketFrame(deliveryModuleContext(this,'market'),...args);}
  async tryMarketTown(...args){return marketDelivery.tryMarketTown(deliveryModuleContext(this,'market'),...args);}
  marketRoutingNeed(...args){return marketDelivery.marketRoutingNeed(deliveryModuleContext(this,'market'),...args);}
  async requestMarketForShortages(...args){return marketDelivery.requestMarketForShortages(deliveryModuleContext(this,'market'),...args);}
  async onFrame(frame,matching){
    if(this.store.load().session.provider==='android_adb')return this.update('hold','ANDROID_PROFILE_REQUIRED');
    if(this.busy)return this.status();
    const geometryHold=inspectDeliveryGeometry(this,frame);
    if(geometryHold)return this.update('hold',geometryHold,{geometryRecheckRequired:true});
    if(this.currentMode&&matching?.status==='candidate'&&['town','market','train','airport'].includes(matching.scene?.kind))
      this.helicopterSurvey=null;
    return dispatchDeliveryFrame(this,frame,matching);
  }
  async productInfoFrame(frame,matching){
    if(this.currentMode){const inputState=this.store.load();if(inputState.actions[inputState.input]?.target?.helicopterProductInfo)return handleUnknownProductResult(this,frame);}
    if(this.currentMode){const recovered=await recoverRejectedProductDismissal(this,frame);if(recovered)return recovered;}
    return continueFrame;
  }
  async marketTownFrame(frame,matching){
    if(this.currentMode&&Number.isSafeInteger(this.marketNeedsRecheckAfterSequence))this.inventory.cutoff=Math.max(this.inventory.cutoff??-1,this.marketNeedsRecheckAfterSequence);
    if(this.currentMode&&frame.width===1578&&frame.height===1268&&marketDelivery.onMarketTownFrame){
      const townResult=await marketDelivery.onMarketTownFrame(deliveryModuleContext(this,'market'),frame,matching);
      if(townResult)return townResult;
    }
    return continueFrame;
  }
  async marketAndAccountingFrame(frame,matching){
    const initial=this.store.load();
    if(initial.scene.kind==='market'||initial.actions[initial.input]?.target?.marketNative||matching?.scene?.kind==='market')
      return this.onMarketFrame(frame);
    if(!unresolved(initial)&&Object.values(initial.transportMissions??{}).some(m=>m.waitingActionId&&m.waitingActionId!==this.transports.helicopter.actionId&&initial.actions[m.waitingActionId]?.status==='verified')){
      try{
        this.guard({context:'event',phase:'accounting'});this.busy=true;
        const settlement=reconcileVerifiedTransportMissions(this.store,this.inventory,{captureOwnerToken:this.owner.token,
          beforeCommit:()=>this.guard({context:'event',phase:'accounting'})});
        return this.update('waiting','VERIFIED_MISSIONS_ACCOUNTED',{settlement});
      }catch(error){return this.update('hold',error.message);}
      finally{this.busy=false;this.update(this.state.phase,this.state.reason);}
    }
    return continueFrame;
  }
  async eventFrame(frame,matching){
    // Event recognition precedes generic scene hints, which do not yet know
    // this modal. It still enters the same ownership, stop and preflight guards.
    if(this.store.load().session.provider==='google_play_windows'){
      const state=this.store.load(),claim=state.actions[state.input]?.target?.kind==='claim_mayors_cup_reward';
      try{
        if(state.actions[state.input]?.target?.eventClose)return this.onEventCloseFrame(frame);
        if(!state.input&&frame.width===1578&&frame.height===1268){
          const e=this.store.evidence(frame.id),reading=await readEventClose(e.frame,e.bytes,e.image);
          if(reading.supported)return this.onEventCloseFrame(frame);
        }
        if(claim||cupPredecessor(state)||readMayorsCup(this.store.evidence(frame.id).image).supported)return this.onMayorsCupFrame(frame);
      }catch(error){return this.update('hold',error.message);}
    }
    return continueFrame;
  }
  async profileFrame(frame,matching){
    if(this.store.load().session.provider==='google_play_windows'&&(!supportedWindowsGeometry(frame)||!['candidate','blocked'].includes(matching?.status)||!['helicopter','town','train','airport'].includes(matching.scene?.kind)||matching.status==='blocked'&&!(matching.reason==='SCENE_HINT_MISMATCH'&&matching.scene.kind==='town')))return this.update('hold','GOOGLE_PLAY_PROFILE_REQUIRED');
    if(this.busy)return this.status();
    return continueFrame;
  }
  async navigationFrame(frame,matching){
    const currentInput=this.store.load(),pending=currentInput.actions[currentInput.input];
    if(pending?.target?.transportNavigation){
      try{
        if(pending.id!==this.navigationActionId)throw Error('INPUT_UNRESOLVED');
        this.guard({context:'navigation',phase:'owned-input',allowReconciliation:true});
        const result=await observeTransportNavigation(this.store,{frameId:frame.id,actionId:pending.id});
        if(!result.stored)return this.update('waiting','NAVIGATION_RESULT_REQUIRED');
        this.navigationActionId=null;
        // The immutable navigation proof is retained before normal recognition
        // reuses this same result original for orders, cargo or idle timing.
      }catch(error){return this.update('hold',error.message);}
    }
    // A matching scene hint can be stale after an externally observed visit.
    // This branch creates only a fresh visit; it never consumes blocked coordinates.
    if(matching?.status==='blocked'&&matching.reason==='SCENE_HINT_MISMATCH'&&matching.scene?.kind==='town'&&
      matching.frameId===frame?.id&&matching.evidenceHash===frame?.evidenceHash&&matching.epoch===frame?.epoch&&
      matching.sequence===frame?.sequence&&matching.observedAt===frame?.observedAt){
      const current=this.store.load();
      if(!['town','unknown'].includes(current.scene.kind)){
        const native=readTransportNavigation(this.store.evidence(frame.id).image,'town',transportNavigationProfile(frame));
        if(native.supported)return this.onNativeTown(frame,native);
      }
    }
    return continueFrame;
  }
  async transportFrame(frame,matching){
    if(matching?.status==='candidate'&&['train','airport'].includes(matching.scene?.kind)&&!transportEnabled(this.store.load(),matching.scene.kind))
      return this.update('hold','TRANSPORT_DISABLED_HELICOPTER_ONLY',{transport:matching.scene.kind});
    if(matching?.status==='candidate'&&matching.scene?.kind==='train')return this.onTrainFrame(frame);
    if(matching?.status==='candidate'&&matching.scene?.kind==='airport')return this.onAirportFrame(frame);
    if(['program-train-idle','program-airport-idle'].includes(this.wait?.source)){clearObservationWait(this);}
    if(matching?.scene?.kind!=='helicopter'){clearObservationWait(this);}
    return continueFrame;
  }
  async townFrame(frame,matching){
    if(matching?.status==='candidate'&&matching.scene?.kind==='town'){
      const market=await this.tryMarketTown(frame,matching);if(market)return market;
      const native=readTransportNavigation(this.store.evidence(frame.id).image,'town',transportNavigationProfile(frame));
      if(native.supported)return this.onNativeTown(frame,native);
      const navigation=townNavigationStatus(this.store.load(),matching);
      if(!navigation.helicopterShortcut||!navigation.helicopterReadyCandidate)
        return this.update('waiting','NO_READY_HELICOPTER_SHORTCUT',{townNavigation:navigation});
      try{
        const {state,continuity}=this.guard({context:'town',allowReconciliation:true});
        if(state.latestFrameId!==frame?.id||matching.frameId!==frame.id||matching.evidenceHash!==frame.evidenceHash||
            matching.epoch!==frame.epoch||matching.sequence!==frame.sequence)throw Error('CURRENT_FRAME_REQUIRED');
        this.reconcileHistory(state,continuity);
        this.guard({context:'town'});
        const allocation=this.inventory.status();
        if((allocation.evaluations??[]).some(o=>['plane','airport','train'].includes(o.transport??o.kind)&&o.status==='feasible'))
          throw Error('HIGHER_PRIORITY_READY_TRANSPORT');
        this.busy=true;this.update('navigating',null,{townNavigation:navigation});
        const result=await navigateTown(this.store,{source:'explicit_user',facilityKind:'helicopter',
          searchId:'monitor-'+sha({session:state.session.id,epoch:frame.epoch}).slice(0,24)},
          {device:this.device,signal:this.signal,matching});
        if(result.status==='waiting_result')this.navigationActionId=result.actionId;
        return this.update(result.status==='waiting_result'?'waiting':'hold',result.reason??null,
          {townNavigation:{...navigation,proposal:result.proposal??null},navigationActionId:this.navigationActionId});
      }catch(error){return this.update('hold',error.message,{townNavigation:navigation});}
      finally{this.busy=false;this.update(this.state.phase,this.state.reason);}
    }
    return continueFrame;
  }
  async helicopterFrame(frame,matching){
    if(matching?.status!=='candidate'||matching.scene?.kind!=='helicopter')return this.update('waiting','HELICOPTER_SCREEN_REQUIRED');
    let observationKey=null,observing=false;
    try{
      const {state,continuity}=this.guard({phase:'owned-input',allowReconciliation:true}),current=state.frames[frame?.id];
      if(!current||state.latestFrameId!==current.id||current.epoch!==state.scene.epoch||
          matching.frameId!==current.id||matching.evidenceHash!==current.evidenceHash||matching.sequence!==current.sequence||matching.epoch!==current.epoch)throw Error('CURRENT_FRAME_REQUIRED');
      this.reconcileHistory(state,continuity);
      this.guard({phase:'owned-input'});
      this.busy=true;
      const selectionTarget=state.actions[state.input]?.target;
      const selectionPending=selectionTarget?.helicopterSelection||selectionTarget?.currentHelicopterSelection;
      if(selectionPending){
        const due=resultCaptureDueAt(state.actions[state.input]);
        if(due===null||!Number.isFinite(Date.parse(current.captureStartedAt))||Date.parse(current.captureStartedAt)<due)
          return this.update('waiting','HELICOPTER_SELECTION_RESULT_REQUIRED');
      }
      let analysis=null;
      // If matching itself fails, animated map/background pixels cannot reset
      // the budget. Use the same registered static regions as semantic caching.
      const recognition=this.recognitionContext(current);
      observationKey=sha({epoch:current.epoch,image:recognition.pixels,profile:recognition.hash,
        policy:state.session.management,source:inventorySourceFingerprint(state)});
      if(!observationRetryDue(this.observationFailure,{key:observationKey,frameId:current.id,now:this.store.clock()}))
        return this.update('hold',this.observationFailure.reason,{observationRetry:this.observationFailure});
      observing=true;
      const key=await this.key(current,result=>{analysis=result;},null,recognition);
      observing=false;observationKey=key;
      const keyed=this.guard({phase:'owned-input'}).state;
      if(keyed.latestFrameId!==current.id||keyed.scene.epoch!==current.epoch)throw Error('CURRENT_FRAME_REQUIRED');
      const selectionRecovery=await continueHelicopterSelectionRecovery(this,current);
      if(selectionRecovery)return selectionRecovery;
      // A deferred native close needs a fresh original, not a new order review.
      // Inventory/source fingerprints may change after every accepted review;
      // preserve the checked anchor only while its order pixels and visit agree.
      const exitAnchor=this.currentMode&&this.keySupported&&!keyed.input&&!selectionPending&&
        this.currentHelicopterExhausted?.frameId===this.helicopterExhaustedFrameId?
        keyed.frames[this.helicopterExhaustedFrameId]:null;
      if(exitAnchor&&current.sequence>exitAnchor.sequence&&current.sceneId===exitAnchor.sceneId&&
        current.epoch===exitAnchor.epoch&&recognition.pixels===this.recognitionContext(exitAnchor).pixels)
        return await this.enterWait(current,key);
      const previous=this.wait??this.invalidatedWait;
      const expired=previous&&!inputEvidenceValid(state.frames[previous.frameId],this.store.clock(),state);
      if(!observationRetryDue(this.observationFailure,{key,frameId:current.id,now:this.store.clock()}))
        return this.update('hold',this.observationFailure.reason,{observationRetry:this.observationFailure});
      if(!selectionPending&&key===this.lastKey&&!expired){
        if((previous||this.helicopterExhaustedFrameId)&&this.keySupported)await this.enterWait(current,key);
        else if(this.state.reason==='GOOGLE_PLAY_PROFILE_REQUIRED'&&this.keySupported&&key===this.passiveObservationKey){
          const profile=helicopterProfile(current).profile;
          if(profile.observationOnly===true&&!selectionCapability(profile)){
            const passive=this.guard().state;
            if(passive.latestFrameId!==current.id||passive.scene.epoch!==current.epoch)throw Error('CURRENT_FRAME_REQUIRED');
            return this.update('hold','HELICOPTER_OBSERVATION_ONLY');
          }
        }
        return this.status();
      }
      clearObservationWait(this);
      this.helicopterExhaustedFrameId=null;
      this.busy=true;
      const managementId=continuity.managementId??('monitor-heli-'+sha({session:state.session.id,policy:state.session.management}).slice(0,24));
      this.update('recognizing',null,{managementId});
      this.workers??=this.workersFactory();
      observing=true;
      if(this.signal?.aborted)throw Error('DELIVERY_CANCELLED');
      const observed=await this.observe(this.store,{frameId:current.id,currentScreenOnly:this.currentMode},this.workers,analysis);
      if(this.signal?.aborted)throw Error('DELIVERY_CANCELLED');
      if(!observed.stored)throw Error(observed.reason??'SUPPORTED_HELICOPTER_REQUIRED');
      observing=false;this.observationFailure=null;this.state.observationRetry=null;
      if(selectionPending&&this.store.load().input){
        this.guard({phase:'owned-input'});
        return this.update('waiting','HELICOPTER_SELECTION_RESULT_REQUIRED');
      }
      const checked=this.guard({phase:this.transports.helicopter.plan?'owned-input':'observe'}).state;
      this.navigationActionId=null;
      if(checked.latestFrameId!==current.id||checked.scene.epoch!==current.epoch)throw Error('CURRENT_FRAME_REQUIRED');
      this.syncInventory(this.store,this.inventory,{mutationId:'monitor:'+sha({managementId,frameId:current.id}),frameIds:[current.id]});
      // This physical profile has saved observation evidence only. Keep all
      // existing admission guards and stock synchronization, but never enter a round.
      if(helicopterProfile(current).profile.observationOnly===true){
        // Observation and stock sync changed the source fingerprint. Retain
        // their resulting key so identical later frames do not retrigger OCR.
        this.guard();
        const observedKey=await this.key(current,null,analysis);
        const settled=this.guard().state;
        if(settled.latestFrameId!==current.id||settled.scene.epoch!==current.epoch)throw Error('CURRENT_FRAME_REQUIRED');
        this.lastKey=observedKey;
        if(selectionPending)return this.update('hold','HELICOPTER_SELECTION_CAP_REACHED');
        if(await this.selectObservationOrder(current,observed))return this.status();
        // Certify only a supported passive observation after its stock sync and
        // final admission check. lastKey alone may come from a failed attempt.
        if(this.keySupported&&!selectionCapability(helicopterProfile(current).profile)){
          const passive=this.guard().state;
          if(passive.latestFrameId!==current.id||passive.scene.epoch!==current.epoch)throw Error('CURRENT_FRAME_REQUIRED');
          this.passiveObservationKey=observedKey;
        }
        return this.update('hold','HELICOPTER_OBSERVATION_ONLY');
      }
      if(this.currentMode)return await this.currentHelicopter(current,observed);
      let result;
      do{
        this.guard();this.update('delivering');
        result=await this.run(this.store,this.inventory,{source:'explicit_user',managementId,maxRounds:1},
          {roundOptions:{...this.roundOptions,device:this.device,workers:this.workers}});
        this.update(result.status==='hold'?'hold':'delivering',result.reason??null,{
          currentRoundId:result.currentRoundId??null,lastRoundId:result.receipts?.at(-1)?.roundId??this.state.lastRoundId,
          completedRounds:result.receipts?.length??this.state.completedRounds});
      }while(result.status==='yielded'&&['INVOCATION_BOUNDARY','EXPIRED_ROUND_RECONCILED'].includes(result.reason));
      const after=this.store.load(),latest=after.frames[after.latestFrameId];
      if(latest&&!unresolved(after)){
        this.lastKey=await this.key(latest,null,latest.id===current.id?analysis:null);
        if(result.status==='hold'&&result.reason==='NO_SUPPORTED_WORK'&&this.keySupported)await this.enterWait(latest,this.lastKey);
      }
    }catch(error){
      if(this.currentMode&&error.reobserveMap){
        try{return this.reobserveHelicopterMap(this.store.load().frames[frame.id],error.mapAnalysis);}
        catch(recoveryError){error=recoveryError;}
      }
      const state=this.store.load();
      // An admitted owned result observation can recover its failed workers
      // while the input stays unresolved. This never retries the input itself.
      if(observing&&observationKey&&!this.signal?.aborted&&!state.stopCapture&&!state.stopReader){
        this.observationFailure=failedObservation(this.observationFailure,{key:observationKey,frameId:frame.id,reason:error.message,now:this.store.clock()});
        this.state.observationRetry=this.observationFailure;
        if(deliveryHold(error.message).retryObservation){
          this.workers?.matcher.close();this.workers?.ocr.close();this.workers=null;
        }
      }
      const exception=error.roundId?{roundId:error.roundId,reason:error.message,actionIds:error.actionIds,
        evidence:(error.frameIds??[]).map(frameId=>({frameId,evidenceHash:state.frames[frameId]?.evidenceHash??null,
          originalPath:this.store.frameFile(frameId)}))}:null;
      clearObservationWait(this);
      this.update('hold',error.message,{observationSchedule:null,reconciliation:helicopterReconciliationSummary(state),exception});
    }
    finally{this.busy=false;this.update(this.state.phase,this.state.reason);}
    return this.status();
  }
  close(){clearObservationWait(this);
    if(this.state.phase==='waiting'){this.state.phase='observer_unavailable';this.state.observerAvailable=false;}
    this.workers?.matcher.close();this.workers?.ocr.close();this.workers=null;}
}
