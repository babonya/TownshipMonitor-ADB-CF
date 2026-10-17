import {rejectedPreflight} from './mumu-rejected-preflight.mjs';
export {rejectedPreflight} from './mumu-rejected-preflight.mjs';
import {hasUnresolvedActions,assertInputSettled,assertResultSupported} from './mumu-input-state.mjs';
import {airportAllocationAllowsCrate,validateAirportLoadingProof,airportLoadingProfile} from './mumu-airport-loading-proof.mjs';
import {trainAllocationAllowsCarriage,validateTrainLoadingProof} from './mumu-train-loading-proof.mjs';
// Finite transport recipes. Facts come from actual canonical reviews; candidate
// rows never grant input authority. No restart, input retries or unknown recovery.
import {navigateReviewed} from './mumu-store.mjs';
import {waitForResultCapture} from './mumu-timing.mjs';
import {digest} from './adb.mjs';
import {validateMarketTicket} from './mumu-market-state.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {deriveCoins} from './mumu-accounting.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {assertOrderPolicy} from './mumu-order-policy.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {readFileSync,realpathSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {decodePng} from './adb.mjs';
const fail=code=>{throw Error(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,140}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const fresh=(frame,now,state=null)=>inputEvidenceValid(frame,now,state);
// Recipe fields, input scene, claim family and specialized result proof belong
// to the same action contract. The proof functions keep their transport rules.
const actionContracts=Object.freeze({
  buy_market:{scene:'market',family:'purchase',order:true,allocation:true,resource:true,heldOrder:true,account:true},
  load_train:{scene:'train',family:'load',order:true,allocation:true,heldOrder:true,account:true,programReader:'program-train-loading',receiptProof:confirmedTrainLoad},
  load_airport:{scene:'airport',family:'load',order:true,allocation:true,heldOrder:true,account:true,programReader:'program-airport-loading',receiptProof:confirmedAirportLoad},
  send_helicopter:{scene:'helicopter',family:'send_order',order:true,heldOrder:true,account:true,programReader:'program-helicopter'},
  delete_helicopter:{scene:'helicopter',family:'delete_order',order:true,account:true,programReader:'program-helicopter'},
  send_train:{scene:'train',family:'departure'},
  send_airport:{scene:'airport',family:'departure'}
});
const actionContract=kind=>Object.hasOwn(actionContracts,kind)?actionContracts[kind]:null;
const fingerprint=x=>digest(Buffer.from(JSON.stringify(x)));
const mutationId=(plan,phase,actionId,revision,sourceRevision)=>'auto:'+fingerprint({missionId:plan.missionId,phase,actionId,revision,sourceRevision});
// Bounded diagnostics only; this reference is never consulted by input/effect gates.
export function captureDiagnostic(value){
  const r=value?.captureReference;
  if(typeof r?.frameId!=='string'||!/^frame-[a-z0-9-]{1,100}$/.test(r.frameId)||
    !/^[a-f0-9]{64}$/.test(r.evidenceHash??'')||typeof r.observedAt!=='string'||r.observedAt.length>40||
    !Number.isFinite(Date.parse(r.observedAt))||!Number.isSafeInteger(r.epoch)||r.epoch<0)return null;
  return Object.freeze({frameId:r.frameId,evidenceHash:r.evidenceHash,observedAt:r.observedAt,epoch:r.epoch});
}
function missionIdentity(state,plan){
  const mission=state.transportMissions?.[plan.missionId];
  if(!mission||mission.planHash!==fingerprint(plan)||state.session.id!==plan.sessionId)fail('AUTOMATIC_MISSION_MISMATCH');
  return mission;
}
function missionCheck(state,plan,now,{input=true,allowStopped=false}={}){
  const mission=missionIdentity(state,plan);
  if(input&&(!Number.isFinite(Date.parse(mission.deadlineAt))||now>=Date.parse(mission.deadlineAt)))fail('AUTOMATIC_MISSION_EXPIRED');
  if(!allowStopped&&(state.stopCapture||state.stopReader))fail('SESSION_STOPPED');
  return mission;
}
function validatePlan(plan){
  if(plan?.source!=='explicit_user'||!id(plan.missionId)||!id(plan.sessionId)||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>10||
    !Number.isSafeInteger(plan.maxCoins)||plan.maxCoins<0)fail('FINITE_TRANSPORT_RECIPE_REQUIRED');
  const seen=new Set();
  for(const step of plan.steps){
    const contract=actionContract(step.kind);
    if(!id(step.actionId)||seen.has(step.actionId)||!id(step.targetId)||!contract||!id(step.nextVisit?.visitId))fail('AUTOMATIC_STEP_INVALID');
    if(step.frameId!==undefined&&(!id(step.frameId)||!contract.programReader))fail('AUTOMATIC_PROGRAM_FRAME_INVALID');
    seen.add(step.actionId);
    if(contract.order&&!id(step.orderId))fail('AUTOMATIC_ORDER_REQUIRED');
    if(contract.allocation&&(!id(step.itemId)||!positive(step.maxUnits)))fail('AUTOMATIC_ALLOCATION_REQUIRED');
    if(contract.resource&&!id(step.resourceFrameId))fail('AUTOMATIC_RESOURCE_FRAME_REQUIRED');
  }
}
export function startTransportMission(store,plan){
  validatePlan(plan);
  return store.transact(state=>{
    if(state.session.id!==plan.sessionId||state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')fail('MANAGEMENT_APPROVAL_REQUIRED');
    if(state.stopCapture||state.stopReader)fail('SESSION_STOPPED');assertInputSettled(state);
    state.transportMissions??={};const existing=state.transportMissions[plan.missionId];
    if(existing){if(existing.planHash!==fingerprint(plan))fail('AUTOMATIC_MISSION_MISMATCH');return existing;}
    if(plan.steps.some(step=>state.actions[step.actionId]))fail('AUTOMATIC_ACTION_ID_EXISTS');
    return state.transportMissions[plan.missionId]={plan:structuredClone(plan),planHash:fingerprint(plan),startedAt:new Date(store.clock()).toISOString(),
      deadlineAt:new Date(store.clock()+900000).toISOString(),nextIndex:0,waitingActionId:null,receipts:[],claims:{},status:'ready'};
  });
}
function guardStep(state,frame,target,plan,step,inventory,now,ticket){
  const mission=missionCheck(state,plan,now);
  const contract=actionContract(step.kind);
  if(mission.waitingActionId||plan.steps[mission.nextIndex]?.actionId!==step.actionId||target.kind!==step.kind)fail('AUTOMATIC_STEP_CHANGED');
  const m=target.management;
  assertResultSupported(target);
  if(frame.review.actualKind!==contract.scene)fail('AUTOMATIC_SCENE_CHANGED');
  assertOrderPolicy(frame.review.data?.order,step.kind);
  if(contract.allocation&&m.itemId!==step.itemId)fail('AUTOMATIC_ITEM_CHANGED');
  if(step.kind==='buy_market'&&m.orderId!==step.orderId)fail('AUTOMATIC_ORDER_CHANGED');
  const accountedCoins=Object.values(mission.claims).reduce((sum,c)=>sum+(c.price??0),0);
  let claim={kind:step.kind,itemId:m.itemId??null,quantity:0,price:0,orderId:step.orderId??null};
  inventory.inspectForInput(state,(allocation,record)=>{
    const order=allocation.evaluations.find(o=>o.orderId===step.orderId),stock=allocation.projection.items[m.itemId];
    assertOrderPolicy(order,step.kind==='delete_helicopter'?'inspect':step.kind);
    const scopedAirport=step.kind==='load_airport'&&frame.review.reviewedBy==='program-airport-loading'&&frame.review.data.airport.fullDemandConfirmed===true&&airportAllocationAllowsCrate(order);
    if(scopedAirport)validateAirportLoadingProof(frame);
    const scopedTrain=step.kind==='load_train'&&frame.review.reviewedBy==='program-train-loading'&&
      frame.review.data.train.fullDemandConfirmed===true&&frame.review.data.order.disposition==='deliver'&&
      m.resultRegistrationRequired!==true&&trainAllocationAllowsCarriage(order);
    if(scopedTrain)validateTrainLoadingProof(frame);
    if(contract.heldOrder&&(!order||order.status==='hold')&&!scopedAirport&&!scopedTrain)fail('AUTOMATIC_ORDER_HELD');
    if(contract.family==='purchase'){
      validateMarketTicket(state,ticket);
      const resource=state.frames[step.resourceFrameId],coins=deriveCoins(state,now);
      if(resource?.review?.reviewedBy!=='GPT'||resource.review.status!=='accepted'||!resource.review.quality.gameVisible||resource.review.quality.occluded||
        !fresh(resource,now,state)||!coins.fresh||!Number.isSafeInteger(coins.coinBalance)||coins.coinBalance<m.price)fail('CURRENT_COINS_REQUIRED');
      const shortage=order.items.find(i=>i.itemId===m.itemId)?.shortage;
      if(!positive(shortage)||!stock?.fresh||!Number.isSafeInteger(stock.quantity))fail('CONFIRMED_SHORTAGE_REQUIRED');
      const capacity=allocation.projection.capacity;
      if(!capacity.fresh||!Number.isSafeInteger(capacity.freeCapacity)||capacity.freeCapacity<m.quantity)fail('CURRENT_BARN_SPACE_REQUIRED');
      if(m.currency!=='COIN'||m.quantity>step.maxUnits||accountedCoins+m.price>plan.maxCoins)fail('AUTOMATIC_PURCHASE_BUDGET');
      claim={...claim,quantity:m.quantity,price:m.price,before:stock.quantity};
    }else if(contract.family==='load'){
      if(frame.review.data?.order?.orderId!==step.orderId)fail('CURRENT_TRANSPORT_ORDER_REQUIRED');
      const reserved=allocation.projection.reservations.filter(r=>r.orderId===step.orderId&&r.itemId===m.itemId).reduce((sum,r)=>sum+r.quantity,0);
      if(m.required>step.maxUnits||reserved<m.required||!stock?.fresh||stock.quantity!==m.owned)fail('CURRENT_TRANSPORT_RESERVATION_REQUIRED');
      claim={...claim,quantity:m.required,before:stock.quantity};
    }else if(contract.family==='delete_order'){
      const native=frame.review.data?.order;
      if(native?.orderId!==step.orderId||m.orderId!==step.orderId||m.orderPolicy!=='delete')fail('CURRENT_HELICOPTER_ORDER_REQUIRED');
      assertOrderPolicy(native,step.kind);
    }else if(contract.family==='send_order'){
      const native=frame.review.data?.order;
      if(order.status!=='feasible'||native?.orderId!==step.orderId)fail('CURRENT_HELICOPTER_ORDER_REQUIRED');
      for(const item of order.items){
        const reserved=allocation.projection.reservations.filter(r=>r.orderId===step.orderId&&r.itemId===item.itemId).reduce((n,r)=>n+r.quantity,0);
        const stock=allocation.projection.items[item.itemId];
        if(!positive(item.required)||reserved<item.required||!stock?.fresh||!Number.isSafeInteger(stock.quantity)||stock.quantity<item.required)fail('CURRENT_TRANSPORT_RESERVATION_REQUIRED');
      }
      claim={...claim,items:order.items.map(i=>({itemId:i.itemId,quantity:i.required,before:allocation.projection.items[i.itemId].quantity}))};
    }else if(frame.review.data?.departure?.ready!==true)fail('CONFIRMED_LOADED_TRANSPORT_REQUIRED');
    claim.inventoryRevision=record.revision;
  });
  mission.claims[step.actionId]=claim;mission.waitingActionId=step.actionId;mission.status='waiting_result';
}
function confirmedTrainLoad(state,action,claim,result){
  const before=state.frames[action.frameId],after=action.resultProof?.review;
  const old=before.review.data,newData=after?.data,receipt=result.trainLoadReceipt;
  const selected=old.train?.selectedCarriage,needs=old.order?.needs;
  const slot=needs?.find(n=>n.slotId===selected);
  if(action.target?.kind!=='load_train'||action.inputAttempted!==true||before.review.actualKind!=='train'||
    after?.actualKind!=='train'||old.train?.row!==newData?.train?.row||old.train?.layoutId!==newData?.train?.layoutId||
    (before.review.reviewedBy==='program-train-loading'&&(action.target.management?.row!==old.train?.row||action.target.management?.layoutId!==old.train?.layoutId))||old.train?.fullDemandConfirmed!==true||newData?.train?.fullDemandConfirmed!==true||
    !/^r[1-3]-c[1-5]$/.test(selected??'')||!Array.isArray(needs)||
    new Set(needs.map(n=>n.slotId)).size!==needs.length||
    needs.some(n=>!positive(n.required)||!id(n.itemId)||typeof n.slotId!=='string')||
    old.order.orderId!==claim.orderId||newData.order?.orderId!==claim.orderId||result.orderId!==claim.orderId||
    slot?.itemId!==claim.itemId||slot.required!==claim.quantity||
    !Number.isSafeInteger(claim.before)||claim.before<claim.quantity||
    slot.owned!==claim.before||action.target.management.owned!==claim.before||
    action.target.management.itemId!==claim.itemId||action.target.management.required!==claim.quantity||
    receipt?.slotId!==selected||receipt.itemId!==claim.itemId||receipt.required!==claim.quantity||
    receipt.loaded!==true||receipt.remainingDemandConfirmed!==true||receipt.stockAfterNotObserved!==true||
    !newData.train.loadedCarriages?.some(n=>n.slotId===selected&&n.itemId===claim.itemId&&n.required===claim.quantity&&n.loaded===true)||
    !Array.isArray(result.inventoryInvalidated)||!sameItems(result.inventoryInvalidated,[claim.itemId])||
    result.inventoryDeltas!==undefined||result.capacityDelta!==undefined||result.coinDelta!==undefined||
    result.completedOrderId!==undefined||result.deletedOrderId!==undefined)return false;
  const remaining=needs.filter(n=>n.slotId!==selected),current=newData.order.needs;
  return Array.isArray(current)&&current.length===remaining.length&&new Set(current.map(n=>n.slotId)).size===current.length&&
    current.every(n=>remaining.some(r=>r.slotId===n.slotId&&r.itemId===n.itemId&&r.required===n.required));
}
function confirmedAirportLoad(state,action,claim,result){
  const before=state.frames[action.frameId],after=action.resultProof?.review,old=before.review.data,next=after?.data,r=result.airportLoadReceipt;
  if(before.review.reviewedBy!=='program-airport-loading'||after?.reviewedBy!=='program-airport-loading')return false;
  validateAirportLoadingProof(before);
  validateAirportLoadingProof({...state.frames[action.resultFrameId],review:after});
  const transition=airportLoadingProfile(before).profile.loadTransitions.find(t=>t.popupId===old.airport.caseId);
  if(!transition||next.airport.caseId!=='bare'+transition.resultStage||next.airport.stage!==transition.resultStage||next.airport.selectedCrate!==null||
    after.proof.inputId!==action.id||after.proof.contextFrameId!==before.id||JSON.stringify(result)!==JSON.stringify(next.actionResult)||
    JSON.stringify(old.airport.origin)!==JSON.stringify(next.airport.origin)||old.order.deadline!==next.order.deadline)return false;
  const n=old.order?.needs?.find(n=>n.slotId===old.airport?.selectedCrate),m=action.target.management;
  if(action.target.kind!=='load_airport'||action.inputAttempted!==true||before.review.reviewedBy!=='program-airport-loading'||after?.reviewedBy!=='program-airport-loading'||
    before.review.actualKind!=='airport'||after.actualKind!=='airport'||!old.airport.fullDemandConfirmed||!next.airport?.fullDemandConfirmed||
    old.airport.layoutId!==next.airport.layoutId||m.layoutId!==old.airport.layoutId||JSON.stringify(old.airport.originalNeeds)!==JSON.stringify(next.airport.originalNeeds)||
    old.order.orderId!==claim.orderId||next.order.orderId!==claim.orderId||result.orderId!==claim.orderId||m.orderId!==claim.orderId||n?.slotId!==m.slotId||n.itemId!==claim.itemId||n.required!==claim.quantity||n.owned!==claim.before||
    !Number.isSafeInteger(claim.before)||claim.before<claim.quantity||m.owned!==claim.before||m.itemId!==claim.itemId||m.required!==claim.quantity||m.currency!=='NONE'||m.programVerified!==true||
    r?.slotId!==n.slotId||r.itemId!==n.itemId||r.required!==n.required||r.loaded!==true||r.remainingDemandConfirmed!==true||r.stockAfterNotObserved!==true||
    JSON.stringify([...next.airport.loadedSlots].sort())!==JSON.stringify([...old.airport.loadedSlots,n.slotId].sort())||
    !Array.isArray(result.inventoryInvalidated)||!sameItems(result.inventoryInvalidated,[n.itemId])||result.inventoryDeltas!==undefined||result.capacityDelta!==undefined||result.coinDelta!==undefined||
    result.completedOrderId!==undefined||result.deletedOrderId!==undefined)return false;
  const plain=a=>a.map(({slotId,itemId,required})=>({slotId,itemId,required}));
  return JSON.stringify(plain(next.order.needs))===JSON.stringify(plain(old.order.needs.filter(x=>x.slotId!==n.slotId)));
}
function confirmedEffect(state,action,claim,now){
  const contract=actionContract(claim.kind);
  if(state.observationInvalidation&&state.frames[action?.frameId]?.sequence<=state.observationInvalidation.sequence)
    fail('EXTERNAL_CHANGE_DURING_ACTION');
  const frame=state.frames[action?.resultFrameId],result=actionEffect(state,action);
  if(action?.status!=='verified'||!result||
    !fresh(frame,now,state)||Date.parse(frame.observedAt)<Date.parse(action.issuedAt)||frame.evidenceHash===state.frames[action.frameId].evidenceHash||
    result?.actionId!==action.id||result.frameId!==frame.id||result.confirmed!==true)fail('NEW_RESULT_REVIEW_REQUIRED');
  if(contract.family==='departure'){
    if(result.departed!==true)fail('DEPARTURE_RESULT_REQUIRED');return frame;
  }
  if(contract.family==='delete_order'){
    if(result.deletedOrderId!==claim.orderId||result.inventoryUnchanged!==true||
      !Array.isArray(result.inventoryDeltas)||result.inventoryDeltas.length||
      result.inventoryInvalidated!==undefined||result.completedOrderId!==undefined||
      result.capacityDelta!==undefined||result.coinDelta!==undefined)fail('EXACT_DELETE_EFFECT_REQUIRED');
    return frame;
  }
  const needs=contract.family==='send_order'?claim.items:[claim],deltas=result.inventoryDeltas;
  if(contract.receiptProof?.(state,action,claim,result))return frame;
  if(contract.family==='send_order'&&result.completedOrderId===claim.orderId&&Array.isArray(result.inventoryInvalidated)&&
      sameItems(result.inventoryInvalidated,needs.map(n=>n.itemId))&&deltas===undefined)return frame;
  if(!Array.isArray(deltas)||deltas.length!==needs.length||new Set(deltas.map(d=>d.itemId)).size!==deltas.length)fail('EXACT_NUMERIC_EFFECT_REQUIRED');
  for(const need of needs){
    const delta=deltas.find(d=>d.itemId===need.itemId),after=need.before+(claim.kind==='buy_market'?need.quantity:-need.quantity);
    if(!delta||delta.before!==need.before||delta.after!==after||after<0)fail('EXACT_NUMERIC_EFFECT_REQUIRED');
  }
  return frame;
}
function accountResult(store,inventory,plan,actionId,{settlementGuard=null}={}){
  const state=store.load();settlementGuard?.(state);
  const mission=missionCheck(state,plan,store.clock(),{input:false,allowStopped:!!settlementGuard}),claim=mission.claims[actionId];
  const frame=confirmedEffect(state,state.actions[actionId],claim,store.clock());
  const accounting=inventory.accounting;
  if(accounting&&actionContract(claim.kind).account){
    // One sidecar transaction accounts the effect and rebinds remaining orders.
    // Reentry after a source-receipt failure remains once-only by actionId.
    const current=store.load(),record=inventory.locked(s=>accounting.read(s));
    const result=actionEffect(current,current.actions[actionId]);
    const refs=record.orderFrameIds.flatMap(oldId=>{
      const orderId=current.frames[oldId]?.review?.data?.order?.orderId;
      if(orderId===result?.completedOrderId||orderId===result?.deletedOrderId)return [];
      const newest=Object.values(current.frames).filter(f=>acceptedFacts(f)&&
        ['airport','train','helicopter'].includes(f.review.actualKind)&&f.review.data?.order?.orderId===orderId)
        .sort((a,b)=>b.sequence-a.sequence)[0];
      const order=newest?.review.data.order;
      if(newest?.id===frame.id&&order.completed===true&&Array.isArray(order.needs)&&order.needs.length===0)return [];
      return [newest?.id??oldId];
    });
    if(acceptedFacts(frame)&&frame.review.data?.order?.needs?.length&&frame.review.data.order.kind==='normal')refs.push(frame.id);
    accounting.commit('account_action',{mutationId:mutationId(plan,'account',actionId,record.revision,current.revision),
      expectedRevision:record.revision,expectedSourceRevision:current.revision,actionId,orderFrameIds:refs},
      {beforeCommit:settlementGuard});
  }
  return store.transact(s=>{
    settlementGuard?.(s);
    const m=missionCheck(s,plan,store.clock(),{input:false,allowStopped:!!settlementGuard});
    if(m.receipts.some(r=>r.actionId===actionId))return m;
    confirmedEffect(s,s.actions[actionId],m.claims[actionId],store.clock());
    m.receipts.push({actionId,resultFrameId:frame.id,kind:claim.kind,
      ...(claim.kind==='delete_helicopter'?{deletedOrderId:claim.orderId,inventoryUnchanged:true}:{})});m.nextIndex++;m.waitingActionId=null;
    m.status=m.nextIndex===plan.steps.length?'complete':'ready';return m;
  });
}

// Recovery is bookkeeping only. Restrict it to a completely verified, single
// automatic load; a saved plan is never permission to execute its next input.
export function verifiedTransportMissionPlan(state,missionId,now){
  const mission=state.transportMissions?.[missionId],action=state.actions?.[mission?.waitingActionId];
  if(mission?.status!=='waiting_result'||mission.nextIndex!==0||mission.receipts?.length!==0||
      !action||action.status!=='verified'||action.inputAttempted!==true||action.management!==true||
      !['load_train','load_airport'].includes(action.target?.kind))fail('MISSION_RECONCILIATION_REQUIRED');
  const kind=action.target.kind,source=state.frames[action.frameId],claim=mission.claims?.[action.id];
  if(!acceptedFacts(source)||source.review.reviewedBy!==(kind==='load_train'?'program-train-loading':'program-airport-loading'))fail('MISSION_RECONCILIATION_REQUIRED');
  // Legacy automatic plans can be reconstructed only when the entire original
  // hash agrees; user-authored or multi-step recipes remain explicitly held.
  const plan=mission.plan??{source:'explicit_user',missionId,sessionId:state.session.id,maxCoins:0,steps:[{
    actionId:action.id,kind,frameId:action.frameId,targetId:action.target.id,orderId:claim?.orderId,
    itemId:claim?.itemId,maxUnits:claim?.quantity,nextVisit:action.nextVisit}]};
  validatePlan(plan);missionIdentity(state,plan);
  const step=plan.steps[0];
  if(plan.steps.length!==1||plan.maxCoins!==0||step.actionId!==action.id||step.kind!==kind||
      step.frameId!==source.id||step.targetId!==action.target.id||step.orderId!==claim?.orderId||
      step.itemId!==claim?.itemId||step.maxUnits!==claim?.quantity||fingerprint(step.nextVisit)!==fingerprint(action.nextVisit))
    fail('MISSION_RECONCILIATION_REQUIRED');
  confirmedEffect(state,action,claim,now);
  return structuredClone(plan);
}

export function reconcileVerifiedTransportMissions(store,inventory,{captureOwnerToken=null,beforeCommit=null}={}){
  const initial=store.load(),pending=Object.entries(initial.transportMissions??{}).filter(([,m])=>m.waitingActionId);
  if(!pending.length)return {reconciled:[],executionAllowed:false};
  const policy=fingerprint(initial.session.management);
  const boundary=state=>{
    assertInputSettled(state);
    if(inventory?.source!==store||state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash'||
        fingerprint(state.session.management)!==policy)fail('MANAGEMENT_APPROVAL_REQUIRED');
    for(const file of ['.management/runner.lock','helicopter-runner.lock'])if(existsSync(join(store.root,file)))fail('DELIVERY_RUNNER_NOT_OWNED');
    const lease=join(store.root,'capture.lock');
    if(existsSync(lease)){
      const owner=JSON.parse(readFileSync(lease,'utf8'));
      if(!captureOwnerToken||owner.pid!==process.pid||owner.token!==captureOwnerToken)fail('CAPTURE_PRODUCER_NOT_OWNED');
    }else if(captureOwnerToken)fail('CAPTURE_OWNERSHIP_REQUIRED');
    if(Object.values(state.helicopterRounds??{}).some(r=>!['complete','boundary'].includes(r.status)))fail('ROUND_RECONCILIATION_REQUIRED');
    for(const [id,m]of Object.entries(state.transportMissions??{})){
      if(['complete','rejected','externally_superseded'].includes(m.status))continue;
      verifiedTransportMissionPlan(state,id,store.clock());
    }
    if(beforeCommit?.(state)?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');
  };
  boundary(initial);
  const plans=pending.map(([id])=>verifiedTransportMissionPlan(initial,id,store.clock())),reconciled=[];
  for(const plan of plans){
    accountResult(store,inventory,plan,plan.steps[0].actionId,{settlementGuard:boundary});
    reconciled.push(plan.missionId);
  }
  return {reconciled,executionAllowed:false};
}
function sameItems(a,b){return a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));}

function rejectedMissionProof(store,state,inventory,plan){
  const mission=state.transportMissions?.[plan.missionId],step=plan.steps[mission?.nextIndex];
  if(!mission||mission.planHash!==fingerprint(plan)||state.session.id!==plan.sessionId||!step)
    fail('AUTOMATIC_MISSION_MISMATCH');
  const contract=actionContract(step.kind);
  const terminal=mission.status==='rejected';
  if((!terminal&&(mission.status!=='waiting_result'||mission.waitingActionId!==step.actionId))||
    (terminal&&mission.waitingActionId!==null))fail('REJECTION_WAITING_ACTION_MISMATCH');
  if(state.input!==null||hasUnresolvedActions(state.actions))
    fail('INPUT_UNRESOLVED');
  const action=state.actions[step.actionId],claim=mission.claims?.[step.actionId];
  if(action?.status!=='rejected_before_input'||action.inputAttempted!==false)
    fail('REJECTION_NO_INPUT_PROOF_REQUIRED');
  const forbidden=['issuedAt','inputReservedAt','resultFrameId','resultProof','resultCaptureNotBeforeAt',
    'effect','effects','actionResult','inventoryDeltas','inventoryInvalidated','capacityDelta','coinDelta',
    'accounted','accountedAt','accountedRevision','receipt','receiptId'];
  if(forbidden.some(key=>Object.hasOwn(action,key))||inventory.accounting?.effects.some(e=>e.actionId===action.id)||
    Object.values(state.frames).some(f=>f.review?.data?.actionResult?.actionId===action.id)||
    Object.values(state.transportMissions).some(m=>m.receipts?.some(r=>r.actionId===action.id)))
    fail('REJECTION_EFFECT_EVIDENCE_PRESENT');
  const frame=state.frames[action.frameId],target=frame?.review?.targets?.find(t=>t.id===step.targetId);
  const request={actionId:step.actionId,frameId:action.frameId,targetId:step.targetId,nextVisit:step.nextVisit,swipe:null,management:true};
  if(action.id!==step.actionId||action.management!==true||action.targetId!==step.targetId||
    action.requestDigest!==fingerprint(request)||fingerprint(action.nextVisit)!==fingerprint(step.nextVisit)||
    (step.frameId!==undefined&&step.frameId!==action.frameId)||!acceptedFacts(frame)||!target||
    target.kind!==step.kind||fingerprint(action.target)!==fingerprint(target)||action.epoch!==frame.epoch+1)
    fail('REJECTION_CANONICAL_TARGET_CHANGED');
  // Automatic recipes currently use canonical taps. A stored command is not
  // independently authoritative, even when the target snapshot is unchanged.
  if(target.type!=='tap'||fingerprint(action.command)!==fingerprint({type:'tap',
      x:Math.floor(target.box.x+target.box.width/2),y:Math.floor(target.box.y+target.box.height/2)}))
    fail('REJECTION_CANONICAL_TARGET_CHANGED');
  const m=target.management;
  if(!m||m.purpose!=='transport'||m.verified!==true||!claim||claim.kind!==step.kind||
    claim.orderId!==(step.orderId??null)||claim.itemId!==(m.itemId??null)||
    !Number.isSafeInteger(claim.inventoryRevision)||claim.inventoryRevision<0||claim.inventoryRevision>inventory.revision)
    fail('REJECTION_CLAIM_CHANGED');
  if(contract.order&&
    frame.review.data?.order?.orderId!==step.orderId&&step.kind!=='buy_market')fail('REJECTION_CLAIM_CHANGED');
  if(contract.family==='delete_order'){
    assertOrderPolicy(frame.review.data.order,step.kind);
    if(m.orderId!==step.orderId||m.orderPolicy!=='delete'||claim.itemId!==null||claim.quantity!==0||claim.price!==0||
      claim.items!==undefined||claim.before!==undefined)fail('REJECTION_CLAIM_CHANGED');
  }else if(contract.family==='send_order'){
    const needs=frame.review.data.order.needs;
    if(claim.quantity!==0||claim.price!==0||!Array.isArray(needs)||!Array.isArray(claim.items)||!needs.length||
      claim.items.length!==needs.length||new Set(claim.items.map(i=>i.itemId)).size!==needs.length||
      needs.some(n=>!claim.items.some(i=>i.itemId===n.itemId&&i.quantity===n.required&&
        Number.isSafeInteger(n.owned)&&i.before===n.owned&&i.before>=i.quantity)))fail('REJECTION_CLAIM_CHANGED');
  }else if(contract.allocation){
    const quantity=step.kind==='buy_market'?m.quantity:m.required,price=step.kind==='buy_market'?m.price:0;
    if(claim.itemId!==step.itemId||claim.quantity!==quantity||!positive(quantity)||quantity>step.maxUnits||
      claim.price!==price||!Number.isSafeInteger(price)||price<0||price>plan.maxCoins||
      !Number.isSafeInteger(claim.before)||claim.before<0)fail('REJECTION_CLAIM_CHANGED');
  }else if(claim.quantity!==0||claim.price!==0)fail('REJECTION_CLAIM_CHANGED');
  if(!Array.isArray(mission.receipts)||!id(action.frameId)||!Number.isFinite(Date.parse(action.finishedAt)))
    fail('REJECTION_NO_INPUT_PROOF_REQUIRED');
  rejectedPreflight(store,action,frame);
  const original=store.evidence(frame.id).frame;
  if(original.evidenceHash!==frame.evidenceHash)fail('REJECTION_CANONICAL_TARGET_CHANGED');
  return {mission,action,step,terminal,proofHash:fingerprint({planHash:mission.planHash,startedAt:mission.startedAt,
    deadlineAt:mission.deadlineAt,nextIndex:mission.nextIndex,claims:mission.claims,receipts:mission.receipts,action,
    frame:{id:frame.id,evidenceHash:frame.evidenceHash,epoch:frame.epoch,sequence:frame.sequence,observedAt:frame.observedAt,
      serial:frame.serial,packageName:frame.packageName,review:frame.review}})};
}
// Bookkeeping only: no input, stock accounting, lease clearing or new approval.
// InventoryStore.locked owns source.lock before inventory.lock; never nest transact.
export function reconcileRejectedMission(store,inventory,{source,plan}={}){
  if(source!=='explicit_user')fail('EXPLICIT_REJECTION_RECONCILIATION_REQUIRED');
  validatePlan(plan);
  if(inventory?.source!==store)fail('INVENTORY_SOURCE_MISMATCH');
  return inventory.locked(state=>{
    const record=inventory.readInputState(state),proof=rejectedMissionProof(store,state,record,plan);
    const {mission,action,step,terminal,proofHash}=proof;
    const receipt={schema:1,actionId:step.actionId,kind:step.kind,planHash:mission.planHash,proofHash,
      sourceFrameId:action.frameId,sourceHash:state.frames[action.frameId].evidenceHash,
      outcome:'rejected_before_input',inputAttempted:false,rejectedAt:action.finishedAt};
    if(terminal){
      const saved=mission.noEffectReceipts;
      if(!Array.isArray(saved)||saved.length!==1||!Number.isFinite(Date.parse(saved[0].recordedAt))||
        fingerprint(saved[0])!==fingerprint({...receipt,recordedAt:saved[0].recordedAt}))
        fail('REJECTION_RECEIPT_CHANGED');
      return structuredClone(saved[0]);
    }
    if(mission.noEffectReceipts!==undefined&&(!Array.isArray(mission.noEffectReceipts)||mission.noEffectReceipts.length))
      fail('REJECTION_RECEIPT_CHANGED');
    receipt.recordedAt=new Date(store.clock()).toISOString();
    mission.noEffectReceipts=[receipt];mission.status='rejected';mission.waitingActionId=null;
    state.revision++;store.save(state);return structuredClone(receipt);
  });
}
export async function runTransportMission(store,inventory,plan,{device=null,verifyResult=null,sleep=undefined,beforeBegin=null,beforeInputGuard=null,currentWorkBoundary=null}={}){
  validatePlan(plan);
  if(!store.load().transportMissions?.[plan.missionId])await store.retry(()=>startTransportMission(store,plan));
  try{
    while(true){
      const state=store.load(),existing=missionIdentity(state,plan);
      if(existing.status==='complete')return {status:'complete',receipts:existing.receipts};
      if(existing?.status==='externally_superseded')return {status:'hold',reason:'EXTERNAL_MANUAL_COMPLETION',resolutionId:existing.externalResolutionId};
      if(existing?.status==='rejected'){
        const receipt=reconcileRejectedMission(store,inventory,{source:plan.source,plan});
        return {status:'rejected',noEffectReceipts:[receipt]};
      }
      const mission=missionCheck(state,plan,store.clock(),{input:false});
      if(mission.waitingActionId){
        const action=state.actions[mission.waitingActionId];
        if(action?.status==='verified'){await accountResult(store,inventory,plan,action.id);continue;}
        missionCheck(state,plan,store.clock()); // An expired unresolved attempt stays held.
        if(['pending','unknown','rejected_before_input'].includes(action?.status))return {status:'hold',reason:action.status,actionId:action.id};
        if(!verifyResult)return {status:'waiting_result_review',actionId:action.id};
        await waitForResultCapture(store,{sleep});
        const observation=await verifyResult({action:structuredClone(action),store});
        const captureReference=captureDiagnostic(observation);
        if(store.load().actions[action.id]?.status!=='verified')return {status:'waiting_result_review',actionId:action.id,
          ...(captureReference?{captureReference}:{})};
        continue;
      }
      missionCheck(state,plan,store.clock()); // Only new input consumes the deadline.
      const step=plan.steps[mission.nextIndex];let frame=state.frames[step.frameId??state.latestFrameId];
      if(!orderDemandCurrent(state,frame))return {status:'needs_review',reason:'ORDER_DEMAND_RESET',frameId:frame?.id};
      if(step.frameId!==undefined&&(!acceptedFacts(frame)||frame.review.reviewedBy!==actionContract(step.kind).programReader||
        frame.sceneId!==state.scene.id||!frame.review.targets.some(t=>t.id===step.targetId&&t.kind===step.kind)))
        return {status:'needs_review',reason:'PROGRAM_FRAME_REQUIRED',frameId:step.frameId};
      if(!fresh(frame,store.clock(),state)||frame.epoch!==state.scene.epoch)return {status:'needs_review',reason:'CURRENT_FRAME_REQUIRED'};
      if(frame.review?.status!=='accepted'){
        const newest=Object.values(state.frames).filter(f=>f.epoch===frame.epoch&&f.sceneId===frame.sceneId&&f.review?.reviewedBy==='GPT')
          .sort((a,b)=>b.sequence-a.sequence)[0];
        if(frame.review||!newest||newest.review.status!=='accepted'||!fresh(newest,store.clock(),state)||
          !newest.review.targets?.some(t=>t.id===step.targetId&&t.kind===step.kind))
          return {status:'needs_review',reason:'CHANGED_FRAME_REQUIRES_GPT',frameId:frame.id};
        const reference=newest.evidenceHash===frame.evidenceHash?newest:null;
        if(reference)await store.retry(()=>store.reviewExactFrame({frameId:frame.id,referenceFrameId:reference.id}));
        else{
          // Keep the actually reviewed original. A different PNG never receives
          // fabricated GPT provenance. Current preflight still checks its target.
          frame=newest;
        }
      }
      const ticket=store.marketTicket(),request={actionId:step.actionId,frameId:frame.id,targetId:step.targetId,nextVisit:step.nextVisit};let currentWork=null,currentClaim=null;
      const begun=await navigateReviewed(store,request,{device,management:true,
        beforeBegin:(s,f,t)=>{const checked=beforeBegin?.(s,f,t);if(checked?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');
          currentWork=currentWorkBoundary?.()??null;if(currentWork?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');
          if(currentWork)currentClaim=currentWork.claim(s,t,{actionId:step.actionId});
          return guardStep(s,f,t,plan,step,inventory,store.clock(),ticket);},
        beforeInputGuard:()=>{const checked=beforeInputGuard?.();if(checked?.then)fail('SYNCHRONOUS_INPUT_GUARD_REQUIRED');return inventory.locked(s=>{
          const m=missionCheck(s,plan,store.clock());if(m.waitingActionId!==step.actionId)fail('AUTOMATIC_STEP_CHANGED');
          if(inventory.readInputState(s).revision!==m.claims[step.actionId].inventoryRevision)fail('AUTOMATIC_RESERVATION_CHANGED');
          if(currentWork)currentWork.assertCurrentClaim(s,currentClaim,s.frames[frame.id].review.targets.find(t=>t.id===step.targetId));
        });}});
      if(begun.duplicate)return {status:'hold',reason:'ACTION_ALREADY_EXISTS',actionId:step.actionId};
    }
  }catch(error){const captureReference=captureDiagnostic(error);return {status:'hold',reason:error.message,input:store.load().input,missionId:plan.missionId,
    ...(captureReference?{captureReference}:{})};}
}
