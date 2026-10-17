import {hasUnresolvedActions,terminalTransportMission} from './mumu-input-state.mjs';
import {evidenceWindow,inputEvidenceValid} from './mumu-freshness.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
import {validateAirportLoadingProof,airportLoadingProfile} from './mumu-airport-loading-proof.mjs';
import {airportExhaustedShortage} from './mumu-airport-loading.mjs';
import {trainExecutionHold} from './mumu-transport-capability.mjs';

export const PROGRAM_IDLE_INITIAL_MS=10000;
export const PROGRAM_IDLE_STABLE_MS=30000;
const unsettled=state=>state.input||hasUnresolvedActions(state.actions??{});
// The imported early ADB log predates product-list orders and immutable result
// receipts. It cannot manufacture a delivery effect. A later global invalidation
// and independently observed absolute stock can supersede that old stock basis.
// Modern program actions still require their once-only effect/mission receipts.
function legacyStockBaseline(state,allocation,action){
  const before=state.frames?.[action.frameId],after=state.frames?.[action.resultFrameId],cut=state.observationInvalidation;
  if(state.session.provider!=='google_play_windows'||action.management!==true||action.target?.kind!=='send_helicopter'||
    action.inputAttempted!==true||action.resultProof||action.target.management?.programVerified||
    !acceptedFacts(before)||!acceptedFacts(after)||before.provider!=='mumu_adb'||after.provider!=='mumu_adb'||
    before.review.reviewedBy!=='GPT'||after.review.reviewedBy!=='GPT'||before.review.actualKind!=='helicopter'||after.review.actualKind!=='helicopter'||
    !Array.isArray(before.review.data?.order?.products)||!before.review.data.order.products.length||before.review.data.order.needs||before.review.data.order.orderId||
    !Number.isSafeInteger(cut?.sequence)||!Number.isSafeInteger(before.sequence)||!Number.isSafeInteger(after.sequence)||
    after.sequence<=before.sequence||after.epoch!==action.epoch||after.sequence>cut.sequence||
    !Number.isFinite(Date.parse(action.verifiedAt))||!Number.isFinite(Date.parse(after.observedAt))||
    !(Date.parse(after.observedAt)<=Date.parse(action.verifiedAt)&&Date.parse(action.verifiedAt)<Date.parse(cut.at))||
    Object.values(state.helicopterRounds??{}).some(r=>r.actionIds?.includes(action.id))||
    Object.entries(state.transportMissions??{}).some(([id,m])=>id===action.id||m.actionId===action.id||m.waitingActionId===action.id||
      m.actionIds?.includes(action.id)||Object.hasOwn(m.claims??{},action.id)||Object.values(m.claims??{}).some(c=>c?.actionId===action.id)||
      [...(m.receipts??[]),...(m.noEffectReceipts??[])].some(r=>r.actionId===action.id))||
    allocation.requiresSync!==false||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length||
    allocation.projection?.capacity?.fresh!==false)return false;
  const items=Object.values(allocation.projection?.items??{});
  return items.length>0&&items.every(item=>{
    if(item.fresh===false)return true; // Unknown/invalidated stock remains unavailable.
    const frame=state.frames[item.source?.frameId];
    return item.fresh===true&&item.status==='confirmed'&&item.source.kind==='order_owned'&&acceptedFacts(frame)&&
      frame.sequence>cut.sequence&&frame.evidenceHash===item.source.evidenceHash&&frame.observedAt===item.observedAt&&
      frame.review.data?.order?.needs?.some(n=>n.itemId===item.itemId&&n.owned===item.quantity);
  });
}
function requireAccounted(state,allocation){
  if(allocation.currentMode){
    if(state.input||hasUnresolvedActions(state.actions??{})||Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m)))throw Error('PROGRAM_WAIT_UNSETTLED');
    return []; // Completed historical effects are not a stock prerequisite.
  }
  if(allocation?.isCurrentWork){
    if(!allocation.generation||!Number.isSafeInteger(allocation.cutoffSequence)||!Array.isArray(allocation.settledActionIds))throw Error('PROGRAM_WAIT_ACCOUNTING_REQUIRED');
    for(const a of Object.values(state.actions??{}))if(a.management===true&&a.status==='verified'&&state.frames[a.resultFrameId]?.sequence>allocation.cutoffSequence){
      const effect=actionEffect(state,a);
      if(effect?.confirmed!==true||!allocation.settledActionIds.includes(a.id))throw Error('PROGRAM_WAIT_ACCOUNTING_REQUIRED');
    }
    return [];
  }
  const baseline=[];
  for(const a of Object.values(state.actions??{}))if(a.status==='verified'&&(['load_train','collect_train','send_helicopter','delete_helicopter'].includes(a.target?.kind)||
    a.target?.kind==='load_airport'&&(a.target.management?.programVerified===true||Object.values(state.transportMissions??{}).some(m=>m.claims?.[a.id])))&&
    !allocation.effects?.some(e=>e.actionId===a.id)){
      if(!legacyStockBaseline(state,allocation,a))throw Error('PROGRAM_WAIT_ACCOUNTING_REQUIRED');
      baseline.push(a.id);
    }
  return baseline;
}

// All three registered return boards establish only a current-screen wait. This
// transient proof cannot be submitted as an order review or grant game input.
export function trainObservationWait(state,args={},now=Date.now()){
  return transportObservationWait(state,args,now,'train');
}
export function airportObservationWait(state,args={},now=Date.now()){
  return transportObservationWait(state,args,now,'airport');
}
// Exit uses the same exhaustion/accounting boundary as wait, but other ready
// transports are the reason to move. This proof never grants an idle schedule.
export function transportPanelExitBoundary(state,args={},now=Date.now()){
 const kind=state.scene.kind;
 if(!['train','airport'].includes(kind))throw Error('TRANSIT_PANEL_REQUIRED');
 const ready=(args.allocation?.evaluations??[]).filter(e=>e.status==='feasible');
 if(!args.route&&!ready.some(e=>(e.transport??e.kind)!==kind))return null;
 transportObservationWait(state,args,now,kind,true);
 const kinds=ready.map(e=>e.transport??e.kind),to=args.route?.kind??(kinds.includes('airport')||kinds.includes('plane')?'airport':kinds.includes('train')?'train':kinds.includes('helicopter')?'helicopter':null);
 if(!['airport','train','helicopter','town'].includes(to)||to===kind)throw Error('READY_TRANSPORT_ROUTE_UNSUPPORTED');
 return {source:'program-transit-exit',from:kind,to,frameId:args.frame.id,evidenceHash:args.frame.evidenceHash,epoch:args.frame.epoch,executionAllowed:false};
}
// A scoped order hold is not an unresolved input. It may yield the panel after
// supported current work is exhausted, while retaining the original order facts.
export function trainHeldExitBoundary(state,{frame,original,reading,allocation,fingerprint,reason}={},now=Date.now()){
 if(state.stopCapture||state.stopReader||unsettled(state))throw Error('PROGRAM_WAIT_UNSETTLED');
 const held=state.frames?.[original?.id],train=held?.review?.data?.train;
 if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||
   state.scene.kind!=='train'||state.scene.transitioning||frame?.epoch!==state.scene.epoch||state.latestFrameId!==frame.id||
   !inputEvidenceValid(frame,now,state)||!held||held.epoch!==frame.epoch||!inputEvidenceValid(held,now,state)||
   !acceptedFacts(held)||held.review.reviewedBy!=='program-train-loading'||held.evidenceHash!==original.evidenceHash||
   reading?.supported!==true||reading.departed||reading.executionAllowed!==false||train.row!==reading.row||train.layoutId!==reading.layoutId||
   !['TRAIN_ORIGINAL_DEMAND_REQUIRED','TRAIN_SELECTED_SHORTAGE','TRAIN_LOAD_RESULT_EVIDENCE_REQUIRED','AUTOMATIC_ORDER_HELD','CURRENT_TRANSPORT_RESERVATION_REQUIRED',
     ...(allocation?.isCurrentWork||allocation?.currentMode?['TRAIN_WHOLE_ORDER_POLICY_REQUIRED','TRAIN_FINAL_DEPARTURE_EVIDENCE_REQUIRED','TRAIN_CURRENT_ALLOCATION_OR_SHORTAGE_HOLD','ORDER_8_UNIT_LIMIT']:[])].includes(reason)||
   typeof fingerprint!=='string'||!fingerprint||allocation?.requiresSync!==false||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length||
   ((allocation.evaluations??[]).some(e=>(e.transport??e.kind)==='train'&&e.status==='feasible')&&!trainExecutionHold(state,held,allocation))||
   Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status))||
   Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m)))
   throw Error('TRAIN_HOLD_EXIT_BOUNDARY_REQUIRED');
 requireAccounted(state,allocation);
 return {source:'program-train-held-exit',frameId:frame.id,heldFrameId:held.id,epoch:frame.epoch,executionAllowed:false};
}
function transportObservationWait(state,{frame,reading,allocation,timers=[],previous=null,fingerprint},now,kind,forExit=false){
  const source=`program-${kind}-idle`,prefix=kind.toUpperCase(),phase=kind==='train'?'in_transit':'empty';
  if(state.stopCapture||state.stopReader||unsettled(state))throw Error('PROGRAM_WAIT_UNSETTLED');
  if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||
    state.scene.kind!==kind||state.scene.transitioning||frame?.epoch!==state.scene.epoch||state.latestFrameId!==frame.id||
    !inputEvidenceValid(frame,now,state)||reading?.supported!==true||reading.executionAllowed!==false||
    JSON.stringify(reading.rows?.map(r=>[r.row,r.phase]))!==JSON.stringify([[1,phase],[2,phase],[3,phase]])||
    (kind==='airport'&&reading.phase!=='in_transit')||
    allocation?.requiresSync!==false||typeof fingerprint!=='string'||!fingerprint||
    (allocation.evaluations??[]).some(e=>e.status==='feasible'&&(!forExit||(e.transport??e.kind)===kind))||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length||
    Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status))||
    Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m)))
      throw Error(prefix+'_WAIT_EXHAUSTION_REQUIRED');
  const legacyStockBaselineActions=requireAccounted(state,allocation);
  const observationTime=Date.parse(frame.observedAt);
  if(!Number.isFinite(observationTime)||observationTime>now)throw Error('OBSERVATION_TIME_INVALID');
  if(forExit)return; // A boundary, never an observation schedule.
  const same=previous?.source===source&&previous.fingerprint===fingerprint&&previous.epoch===frame.epoch&&
    previous.profileHash===reading.profileHash;
  if(same&&previous.frameId===frame.id)return previous;
  if(same&&observationTime<=Date.parse(previous.lastObservationAt))throw Error(prefix+'_WAIT_NEW_OBSERVATION_REQUIRED');
  const unchangedChecks=same?previous.unchangedChecks+1:0,intervalMs=unchangedChecks>=2?PROGRAM_IDLE_STABLE_MS:PROGRAM_IDLE_INITIAL_MS;
  // Train and airport arrival are observed visually; legacy timer arguments
  // cannot wake this path or extend the observation interval.
  const active=[],next=observationTime+intervalMs;
  return {source,schema:source+'-1',reason:kind==='train'?'TRAIN_ALL_IN_TRANSIT':'AIRPORT_IN_TRANSIT',sceneKind:kind,
    frameId:frame.id,evidenceHash:frame.evidenceHash,epoch:frame.epoch,profileHash:reading.profileHash,fingerprint,unchangedChecks,
    intervalMs,timers:active,lastObservationAt:frame.observedAt,nextObservationAt:new Date(next).toISOString(),
    ...(legacyStockBaselineActions.length?{legacyStockBaselineActions}:{}),executionAllowed:false};
}

// Scheduling proof only. The coordinator's canonical hold remains authoritative;
// a wake authorizes observation, never input, stock, or a fabricated effect.
export function helicopterExhaustionBoundary(state,{frameId,continuity,allocation,fingerprint,profileHash,currentExhausted}={},now=Date.now()){
  if(state.stopCapture||state.stopReader||unsettled(state))throw Error('PROGRAM_WAIT_UNSETTLED');
  const frame=state.frames?.[frameId],receipt=continuity?.receipts?.at(-1),round=state.helicopterRounds?.[receipt?.roundId];
  if(allocation?.currentMode){
    if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||state.scene.kind!=='helicopter'||state.scene.transitioning||
       frame?.epoch!==state.scene.epoch||!acceptedFacts(frame)||frame.review.reviewedBy!=='program-helicopter'||frame.review.proof.profileHash!==profileHash||
       !inputEvidenceValid(frame,now,state)||typeof fingerprint!=='string'||!fingerprint||!currentExhausted||
       allocation.requiresSync!==false||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length||
       allocation.evaluations?.some(e=>(e.transport??e.kind)==='helicopter'&&e.status==='feasible')||
       Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status)))throw Error('PROGRAM_WAIT_EXHAUSTION_REQUIRED');
    requireAccounted(state,allocation);
    return {frame,receipt:{roundId:null},executionAllowed:false};
  }
  if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||
    state.scene.kind!=='helicopter'||state.scene.transitioning||frame?.epoch!==state.scene.epoch||
    !acceptedFacts(frame)||frame.review.reviewedBy!=='program-helicopter'||frame.review.proof.profileHash!==profileHash||
    !inputEvidenceValid(frame,now,state)||typeof fingerprint!=='string'||!fingerprint||
    continuity?.status!=='hold'||continuity.reason!=='NO_SUPPORTED_WORK'||continuity.currentRoundId||
    round?.status!=='complete'||!['NO_FEASIBLE_DELIVERIES','NO_FEASIBLE_WITH_HELD_ORDERS'].includes(round.reason)||
    round.waitingActionId||round.waitingPlan||allocation?.requiresSync!==false||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length||
    (allocation.evaluations??[]).some(e=>(e.transport??e.kind)==='helicopter'&&e.status==='feasible')||
    Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status))||
    Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m)))throw Error('PROGRAM_WAIT_EXHAUSTION_REQUIRED');
  requireAccounted(state,allocation);
  if(JSON.stringify(receipt.actionIds)!==JSON.stringify(round.actionIds))throw Error('PROGRAM_WAIT_RECEIPT_REQUIRED');
  for(const actionId of round.actionIds){
    const action=state.actions[actionId];
    if(action?.status==='rejected_before_input'){
      if(action.inputAttempted!==false||action.resultFrameId||!allocation.noEffectReceipts?.some(r=>r.actionId===actionId))
        throw Error('PROGRAM_WAIT_RECEIPT_REQUIRED');
      continue; // The caller also validates the existing canonical no-effect proof.
    }
    if(action?.status!=='verified'||!action.resultFrameId)throw Error('PROGRAM_WAIT_RECEIPT_REQUIRED');
    if(!['send_helicopter','delete_helicopter'].includes(action.target?.kind))continue;
    if(!action.resultProof)throw Error('PROGRAM_WAIT_RECEIPT_REQUIRED');
    const effect=actionEffect(state,action),mission=state.transportMissions?.[actionId];
    if(!effect?.confirmed||effect.actionId!==actionId||effect.frameId!==action.resultFrameId||mission?.status!=='complete'||
      mission.waitingActionId||!mission.receipts?.some(r=>r.actionId===actionId&&r.resultFrameId===action.resultFrameId)||
      !allocation.effects?.some(e=>e.actionId===actionId))throw Error('PROGRAM_WAIT_ACCOUNTING_REQUIRED');
  }
  return {frame,receipt,executionAllowed:false};
}
export function programObservationWait(state,args={},now=Date.now()){
  const {frameId,allocation,fingerprint,profileHash,previous=null,observedAt=null,stableIntervalMs=PROGRAM_IDLE_STABLE_MS}=args;
  const {frame,receipt}=helicopterExhaustionBoundary(state,args,now);
  if((allocation.evaluations??[]).some(e=>['plane','airport','train'].includes(e.transport??e.kind)&&e.status==='feasible')||
    ![PROGRAM_IDLE_INITIAL_MS,PROGRAM_IDLE_STABLE_MS].includes(stableIntervalMs))throw Error('PROGRAM_WAIT_EXHAUSTION_REQUIRED');
  const same=previous?.fingerprint===fingerprint&&previous.epoch===state.scene.epoch&&previous.profileHash===profileHash&&
    previous.roundId===receipt.roundId;
  const unchangedChecks=same?previous.unchangedChecks+1:0;
  const intervalMs=unchangedChecks>=2?stableIntervalMs:PROGRAM_IDLE_INITIAL_MS;
  const observationTime=Date.parse(observedAt??frame.observedAt);
  if(!Number.isFinite(observationTime)||observationTime>now)throw Error('OBSERVATION_TIME_INVALID');
  const timers=helicopterObservationTimers(frame,now);
  const next=Math.min(observationTime+intervalMs,...timers.map(t=>Date.parse(t.until)));
  return {source:'program-helicopter',reason:'NO_SUPPORTED_WORK',coordinatorStatus:'hold',frameId,evidenceHash:frame.evidenceHash,
    epoch:state.scene.epoch,profileHash,roundId:receipt.roundId,fingerprint,unchangedChecks,intervalMs,timers,
    lastObservationAt:new Date(observationTime).toISOString(),nextObservationAt:new Date(next).toISOString(),executionAllowed:false};
}
export function helicopterObservationTimers(frame,now=Date.now()){
  const timers=[],frameId=frame.id;
  for(const [kind,fact] of Object.entries({order:frame.review.data?.order,validity:frame.review.data?.validity?{validity:frame.review.data.validity}:null})){
    if(!fact)continue;
    const window=evidenceWindow({...fact,observedAt:frame.observedAt},{now,maxAgeMs:null});
    if(!window.valid)throw Error('PROGRAM_WAIT_TIMER_INVALID');
    if(window.validUntil)timers.push({kind,frameId,observedAt:frame.observedAt,until:window.validUntil});
  }
  const helicopter=frame.review.data?.helicopter;
  if(helicopter?.deletionCooldownConfirmed){
    const match=/^new order in\s*:?\s*([0-9]{1,2}):([0-5][0-9])(?:\s|$)/i.exec(helicopter.cooldownText?.trim()??'');
    if(!match)throw Error('PROGRAM_WAIT_TIMER_INVALID');
    const deadline=Date.parse(frame.observedAt)+(Number(match[1])*60+Number(match[2]))*1000;
    // An expired event is consumed, never moved into the future by status/OCR.
    if(deadline>now)timers.push({kind:'deletion_cooldown',frameId,observedAt:frame.observedAt,until:new Date(deadline).toISOString()});
  }
  return timers;
}
// Opt-in idle observation. Default active cadence and post-input timing remain.
export function observationWait(state,{source,frameIds,reason,maxSilenceMs=30000,until=null}={},now=Date.now()){
  if(source!=='explicit_user'||typeof reason!=='string'||!reason.trim()||!Array.isArray(frameIds)||!frameIds.length||
    new Set(frameIds).size!==frameIds.length||!Number.isSafeInteger(maxSilenceMs)||maxSilenceMs<3000||maxSilenceMs>60000)
    throw Error('OBSERVATION_WAIT_INVALID');
  if(state.input)throw Error('INPUT_UNRESOLVED');
  const deadlines=frameIds.map(id=>{
    const frame=state.frames[id],data=frame?.review?.data;
    if(frame?.review?.status!=='accepted'||frame.review.reviewedBy!=='GPT'||!frame.review.quality.gameVisible||frame.review.quality.occluded||
      !inputEvidenceValid(frame,now,state))throw Error('WAIT_REVIEWED_TIMER_REQUIRED');
    const windows=[data.order,data.market].filter(Boolean).map(fact=>evidenceWindow({...fact,observedAt:frame.observedAt},{now,maxAgeMs:null}));
    const times=windows.filter(w=>w.valid&&w.basis==='observed_deadline').map(w=>Date.parse(w.validUntil));
    if(!times.length)throw Error('WAIT_REVIEWED_TIMER_REQUIRED');return Math.min(...times);
  });
  const earliest=Math.min(...deadlines),target=until===null?earliest:Date.parse(until);
  if(!Number.isFinite(target)||target<=now||target>earliest)throw Error('WAIT_DEADLINE_INVALID');
  return {source,frameIds:[...frameIds],reason,until:new Date(target).toISOString(),maxSilenceMs,afterSequence:state.sequence};
}
export function waitDelay(state,now){
  const wait=state.observationWait;
  if(!wait||state.input||state.observationRefresh&&!state.observationRefresh.firstFrameId||
    state.observationInvalidation&&state.observationInvalidation.sequence>=wait.afterSequence||
    wait.frameIds.some(id=>!inputEvidenceValid(state.frames[id],now,state)))return null;
  const remaining=Date.parse(wait.until)-now;return remaining>0?Math.min(remaining,wait.maxSilenceMs):null;
}

// An evidenced deletion-only airport order cannot be supplied or dispatched.
// Unsupported deletion holds the order while a fresh unchanged view can exit.
export function airportPolicyExitBoundary(state,{frame,original,reading,allocation,fingerprint,reason}={},now=Date.now()){
 if(state.stopCapture||state.stopReader||unsettled(state))throw Error('PROGRAM_WAIT_UNSETTLED');
 const held=state.frames?.[original?.id],airport=held?.review?.data?.airport,order=held?.review?.data?.order;
 const deletion=reason==='AIRPORT_ORDER_DELETION_UNSUPPORTED'&&order?.disposition==='delete'&&orderDisposition(airport?.originalNeeds)==='delete';
 const shortage=reason==='AIRPORT_EXHAUSTED_SHORTAGE'&&order?.disposition==='deliver'&&orderDisposition(airport?.originalNeeds)==='deliver'&&
  airportExhaustedShortage({...reading,review:held?.review},allocation,airportLoadingProfile(held));
 if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||
  state.scene.kind!=='airport'||state.scene.transitioning||frame?.epoch!==state.scene.epoch||state.latestFrameId!==frame.id||
  !inputEvidenceValid(frame,now,state)||!held||held.epoch!==frame.epoch||!inputEvidenceValid(held,now,state)||
  frame.id===held.id||frame.sequence<=held.sequence||!acceptedFacts(held)||held.review.reviewedBy!=='program-airport-loading'||held.evidenceHash!==original.evidenceHash||
  !airport?.fullDemandConfirmed||order?.orderConfirmed!==true||(!deletion&&!shortage)||
  reading?.supported!==true||reading.executionAllowed!==false||airport.layoutId!==reading.layoutId||airport.caseId!==reading.caseId||
  JSON.stringify(airport.loadedSlots)!==JSON.stringify(reading.loadedSlots)||
  typeof fingerprint!=='string'||!fingerprint||allocation?.requiresSync!==false||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length||
  (allocation.evaluations??[]).some(e=>['airport','plane'].includes(e.transport??e.kind)&&e.status==='feasible')||
  Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status))||
  Object.values(state.transportMissions??{}).some(m=>!terminalTransportMission(m)))throw Error('AIRPORT_POLICY_EXIT_BOUNDARY_REQUIRED');
 validateAirportLoadingProof(held);requireAccounted(state,allocation);
 return {source:shortage?'program-airport-shortage-exit':'program-airport-policy-exit',frameId:frame.id,heldFrameId:held.id,epoch:frame.epoch,executionAllowed:false};
}
