import {clearObservationWait} from './mumu-observation-wait-lifecycle.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {transportState} from './mumu-transport-state.mjs';
// airport processing uses the coordinator's state and its one input owner.
import {observeAirportLoading,airportLoadingPlan,selectAirportDetail,airportExhaustedShortage} from './mumu-airport-loading.mjs';
import {readAirportLoading,airportLoadingProfile,airportCase,airportAllocationAllowsCrate} from './mumu-airport-loading-proof.mjs';
import {digest} from './adb.mjs';
import {cropPng} from './png-crop.mjs';
import {inventorySourceFingerprint} from './mumu-inventory-store.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {airportPolicyExitBoundary} from './mumu-wait.mjs';
import {readAirportIdle,airportIdleProfile} from './mumu-airport-idle.mjs';
import {runTransportMission} from './mumu-automatic.mjs';
import {observeTransportWithRetry} from './mumu-delivery-state.mjs';
import {readTransportNavigation,transportNavigationProfile} from './mumu-transport-navigation-proof.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));

export async function onAirportFrame(coordinator,frame){
    const transport=transportState(coordinator,'airport');

    try{
      const {state,continuity}=coordinator.guard({context:'airport',phase:'owned-input',allowReconciliation:true});
      if(state.latestFrameId!==frame?.id||frame.epoch!==state.scene.epoch)throw Error('CURRENT_FRAME_REQUIRED');
      coordinator.reconcileHistory(state,continuity);coordinator.guard({context:'airport',phase:'owned-input'});coordinator.busy=true;coordinator.observationSchedule();
      const image=coordinator.store.evidence(frame.id).image,reading=readAirportIdle(image,airportIdleProfile(frame));
      if(!state.input&&!transport.plan&&reading.supported)return await coordinator.enterTransitWait(frame,reading,'airport');
      const ordinary=readAirportLoading(image,airportLoadingProfile(frame));
      if(ordinary.reason==='AIRPORT_LOADING_GEOMETRY_EVIDENCE_REQUIRED'){
        clearObservationWait(coordinator);transport.idleEvidence=null;coordinator.state.observationSchedule=null;
        return coordinator.update('hold',ordinary.reason,{transport:'airport',observationSchedule:null,
          geometry:{observed:ordinary.observedDimensions,registered:ordinary.registeredDimensions},requiredEvidence:['current_order','selected_stock_popup','verified_load_result']});
      }
      if(transport.plan||transport.navigationId||ordinary.supported){clearObservationWait(coordinator);transport.idleEvidence=null;coordinator.state.observationSchedule=null;coordinator.observeActiveTransport('airport',frame);return await coordinator.onAirportLoadingFrame(frame,ordinary);}
      if(readTransportNavigation(image,'airport',transportNavigationProfile(frame)).activity==='loading')coordinator.observeActiveTransport('airport',frame);
      clearObservationWait(coordinator);transport.idleEvidence=null;
      return coordinator.update('hold',reading.reason,{transport:'airport',observationSchedule:null});
    }catch(error){clearObservationWait(coordinator);return coordinator.update(coordinator.store.load().input&&transport.actionId?'waiting':'hold',error.message,{transport:'airport',observationSchedule:null});}
    finally{coordinator.busy=false;coordinator.update(coordinator.state.phase,coordinator.state.reason);}
}

export function airportLoadingKey(coordinator,frame,reading){
    const transport=transportState(coordinator,'airport');

    const registration=airportLoadingProfile(frame),c=airportCase(reading,registration),image=coordinator.store.evidence(frame.id).image;
    const boxes=[...registration.profile.anchors,...c.regions,...(c.load?[c.load]:[])].map(s=>s.box);if(c.field)boxes.push(c.field.box);
    const state=coordinator.store.load();return sha({caseId:c.id,pixels:digest(Buffer.concat(boxes.map(b=>cropPng(image,b)))),profile:registration.hash,
      epoch:frame.epoch,policy:state.session.management,invalidation:state.observationInvalidation,source:inventorySourceFingerprint(state),inventory:coordinator.inventoryStamp()});
}

export async function onAirportLoadingFrame(coordinator,frame,candidate){
    const transport=transportState(coordinator,'airport');

    if(!candidate.supported)return coordinator.update('waiting','AIRPORT_LOAD_RESULT_PENDING',{transport:'airport',recognitionReason:candidate.reason});
    const key=coordinator.airportLoadingKey(frame,candidate);if(!transport.plan&&!transport.navigationId&&!coordinator.store.load().input&&key===transport.lastKey)return coordinator.exitPolicyAirport(frame,candidate,key);
    transport.hold=null;
    const reading=await observeTransportWithRetry(coordinator,{kind:'airport',frame,key},async()=>{
      if(candidate.field)coordinator.workers??=coordinator.workersFactory();
      return observeAirportLoading(coordinator.store,{frameId:frame.id},coordinator.workers??{});
    });
    if(!reading.stored)return coordinator.update('hold',reading.reason,{transport:'airport'});
    coordinator.guard({context:'airport',phase:'owned-input'});if(coordinator.store.load().input)return coordinator.update('waiting','AIRPORT_RESULT_REQUIRED',{transport:'airport'});
    if(transport.navigationId){if(coordinator.store.load().actions[transport.navigationId]?.status!=='verified')throw Error('AIRPORT_DETAIL_RECONCILIATION_REQUIRED');transport.navigationId=null;transport.actionId=null;}
    if(transport.plan){
      if(coordinator.store.load().actions[transport.actionId]?.status!=='verified')throw Error('AIRPORT_MISSION_RECONCILIATION_REQUIRED');
      const settled=await runTransportMission(coordinator.store,coordinator.inventory,transport.plan,{device:coordinator.device});
      if(settled.status!=='complete')throw Error(settled.reason??'AIRPORT_LOAD_ACCOUNTING_REQUIRED');transport.plan=null;transport.actionId=null;
    }
    const full=reading.review.data.airport.fullDemandConfirmed;
    coordinator.syncInventory(coordinator.store,coordinator.inventory,{mutationId:'airport-observed:'+sha({session:coordinator.store.load().session.id,frameId:frame.id}),frameIds:full?[frame.id]:[]});
    coordinator.noteCurrentOrder(frame);
    coordinator.guard({context:'airport'});
    const hold=reason=>{transport.lastKey=coordinator.airportLoadingKey(frame,candidate);transport.hold={frameId:frame.id,evidenceHash:frame.evidenceHash,epoch:frame.epoch,key:transport.lastKey,reason};return coordinator.update('hold',reason,{transport:'airport',selectedCrate:reading.selectedCrate});};
    if(!full)return hold('AIRPORT_ORIGINAL_DEMAND_REQUIRED');
    if(reading.review.data.order.disposition==='delete')return hold('AIRPORT_ORDER_DELETION_UNSUPPORTED');
    const allocation=coordinator.inventory.status(),plan=airportLoadingPlan(coordinator.store.load(),reading),detail=selectAirportDetail(reading,allocation,airportLoadingProfile(frame));
    if(!plan){if(detail)return coordinator.inspectAirportDetail(frame,detail);const n=reading.review.data.order.needs.find(n=>n.slotId===reading.selectedCrate);return hold(airportExhaustedShortage(reading,allocation,airportLoadingProfile(frame))?'AIRPORT_EXHAUSTED_SHORTAGE':n&&Number.isSafeInteger(n.owned)&&n.owned<n.required?'AIRPORT_SELECTED_SHORTAGE':'AIRPORT_LOAD_RESULT_EVIDENCE_REQUIRED');}
    const step=plan.steps[0],order=allocation.evaluations.find(o=>o.orderId===step.orderId),reserved=allocation.projection.reservations.filter(r=>r.orderId===step.orderId&&r.itemId===step.itemId).reduce((n,r)=>n+r.quantity,0);
    if(!airportAllocationAllowsCrate(order)||reserved<step.maxUnits){if(detail)return coordinator.inspectAirportDetail(frame,detail);return hold('CURRENT_TRANSPORT_RESERVATION_REQUIRED');}
    transport.plan=plan;transport.actionId=step.actionId;
    const guard=settlingAirport=>{const checked=coordinator.guard({context:'airport',phase:settlingAirport?'owned-input':'observe'});if(checked.state.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');return checked;};
    const result=await runTransportMission(coordinator.store,coordinator.inventory,plan,{device:coordinator.device,beforeBegin:()=>guard(false),beforeInputGuard:()=>guard(true)});
    if(!coordinator.store.load().actions[step.actionId]){transport.plan=null;transport.actionId=null;transport.lastKey=coordinator.airportLoadingKey(frame,candidate);}
    return coordinator.update(result.status==='waiting_result_review'?'loading':'hold',result.reason??null,{transport:'airport',airportActionId:transport.actionId});
}

export async function exitPolicyAirport(coordinator,frame,reading,key){
    const transport=transportState(coordinator,'airport');

    const held=transport.hold;
    if(!held||!['AIRPORT_ORDER_DELETION_UNSUPPORTED','AIRPORT_EXHAUSTED_SHORTAGE'].includes(held.reason)||held.key!==key||held.epoch!==frame.epoch||transport.plan||transport.navigationId||transport.actionId)return coordinator.status();
    const {state}=coordinator.guard({context:'airport'}),allocation=coordinator.inventory.status(),route=coordinator.nextTransport(allocation,{current:'airport'})??
      (held.reason==='AIRPORT_EXHAUSTED_SHORTAGE'?await coordinator.requestMarketForShortages(frame,'airport'):null);if(!route)return coordinator.status();
    const args={frame,original:{id:held.frameId,evidenceHash:held.evidenceHash},reading,allocation,fingerprint:key,reason:held.reason};
    airportPolicyExitBoundary(state,args,coordinator.store.clock());
    coordinator.rememberRoute('airport',state.frames[held.frameId],allocation,[],'exhausted');
    return coordinator.exitPanel(frame,'airport',route,checked=>{if(coordinator.airportLoadingKey(frame,reading)!==held.key)throw Error('AIRPORT_HOLD_CHANGED');return airportPolicyExitBoundary(checked,args,coordinator.store.clock());});
}

export async function inspectAirportDetail(coordinator,frame,target){
    const transport=transportState(coordinator,'airport');

    const id=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'d'},()=> 'airport-detail:'+sha({session:coordinator.store.load().session.id,frame:frame.id,target:target.id}).slice(0,32));transport.navigationId=id;transport.actionId=id;
    const guard=settlingAirport=>{const checked=coordinator.guard({context:'airport',phase:settlingAirport?'owned-input':'observe'});if(checked.state.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');return checked;};
    const result=await navigateReviewed(coordinator.store,{frameId:frame.id,actionId:id,targetId:target.id,nextVisit:{visitId:id+'-result',kind:'airport',required:true}},
      {device:coordinator.device,beforeBegin:()=>guard(false),beforeInputGuard:()=>guard(true)});
    return coordinator.update(result.status==='issued'?'inspecting':'hold',result.status==='issued'?null:'AIRPORT_DETAIL_RECONCILIATION_REQUIRED',{transport:'airport',airportActionId:id});
}
