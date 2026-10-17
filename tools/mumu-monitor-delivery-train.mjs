import {clearObservationWait} from './mumu-observation-wait-lifecycle.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {transportState} from './mumu-transport-state.mjs';
// train processing uses the coordinator's state and its one input owner.
import {digest} from './adb.mjs';
import {cropPng} from './png-crop.mjs';
import {inventorySourceFingerprint} from './mumu-inventory-store.mjs';
import {readContinuity} from './mumu-continuity.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {trainHeldExitBoundary} from './mumu-wait.mjs';
import {readTrainIdle,trainIdleProfile} from './mumu-train-idle.mjs';
import {observeTrainRewards,accountTrainRewards,claimTrainReward,trainRewardActionId} from './mumu-train-rewards.mjs';
import {readTrainRewards,trainRewardProfile} from './mumu-train-reward-proof.mjs';
import {readTrainLoading,trainLoadingProfile,trainLoadingRow,trainAllocationAllowsCarriage} from './mumu-train-loading-proof.mjs';
import {observeTrainLoading,trainLoadingPlan,selectTrainDetail} from './mumu-train-loading.mjs';
import {runTransportMission} from './mumu-automatic.mjs';
import {observeTransportWithRetry} from './mumu-delivery-state.mjs';
import {independentTrain,trainSlotPopup} from './mumu-train-slots.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));

export async function onTrainFrame(coordinator,frame){
    const transport=transportState(coordinator,'train');

    try{
      const {state}=coordinator.guard({context:'train',phase:'owned-input',allowReconciliation:true});
      if(state.latestFrameId!==frame?.id||frame.epoch!==state.scene.epoch)throw Error('CURRENT_FRAME_REQUIRED');
      if(!coordinator.currentMode)coordinator.reconcileHistory(state,readContinuity(coordinator.store));
      coordinator.guard({context:'train',phase:'owned-input'});coordinator.busy=true;
      coordinator.observationSchedule();
      const image=coordinator.store.evidence(frame.id).image,idle=readTrainIdle(image,trainIdleProfile(frame));
      if(!state.input&&!transport.plan&&idle.supported)return await coordinator.enterTrainWait(frame,idle);
      clearObservationWait(coordinator);transport.idleEvidence=null;
      const pending=state.actions[state.input],scope=pending?.target?.kind==='load_train'?pending.target.management:pending?.target?.trainDetail;
      const ordinary=readTrainLoading(image,trainLoadingProfile(frame),scope);
      if(ordinary.reason==='TRAIN_LOADING_GEOMETRY_EVIDENCE_REQUIRED')return coordinator.update('hold',ordinary.reason,{transport:'train',geometry:{observed:ordinary.observedDimensions,registered:ordinary.registeredDimensions},requiredEvidence:['current_order','selected_stock_popup','verified_load_result']});
      const rewards=readTrainRewards(image,trainRewardProfile(frame)),activeRows=rewards.rows.filter(r=>['returned_cargo','loading'].includes(r.phase)).map(r=>r.row);
      if(ordinary.supported&&!ordinary.departed)activeRows.push(ordinary.row);
      if(activeRows.length)coordinator.observeActiveTransport('train',frame,[...new Set(activeRows)]);
      const otherCargo=!transport.plan&&rewards.rows.some(r=>r.phase==='returned_cargo');
      if(transport.plan||transport.navigationId||ordinary.supported&&!otherCargo&&state.actions[state.input]?.target.kind!=='collect_train')
        return await coordinator.onTrainLoadingFrame(frame,ordinary);
      // A completed load proof is already retained on coordinator original. A new normal
      // observation can own the next reward review without overwriting its facts.
      if(otherCargo&&state.frames[frame.id].review?.reviewedBy==='program-train-loading')
        return coordinator.update('waiting','TRAIN_REWARD_OBSERVATION_REQUIRED',{transport:'train'});
      const reading=await observeTrainRewards(coordinator.store,{frameId:frame.id});
      if(!reading.stored)return coordinator.update('hold',reading.reason,{transport:'train'});
      const current=coordinator.store.load();
      if(current.input)return coordinator.update('waiting','TRAIN_REWARD_RESULT_REQUIRED',{transport:'train',trainRows:reading.rows});
      transport.actionId=null;if(!coordinator.currentMode)accountTrainRewards(coordinator.store,coordinator.inventory);
      const rejected=new Set(Object.values(current.actions).filter(a=>a.status==='rejected_before_input'&&a.target?.kind==='collect_train'&&a.target.management?.programVerified)
        .map(a=>a.target.id));
      reading.targets=reading.targets.filter(t=>!rejected.has(t.id));
      // Settle and journal the returned cargo before reusing its original for loading.
      if(!reading.targets.length&&ordinary.supported)return await coordinator.onTrainLoadingFrame(frame,ordinary);
      if(!reading.targets.length)return coordinator.update('hold',rejected.size?'TRAIN_REWARD_PREFLIGHT_REJECTED':'TRAIN_LOADING_OR_UNREGISTERED_CARGO',
        {transport:'train',trainRows:reading.rows});
      coordinator.guard({context:'train'});
      transport.actionId=trainRewardActionId(coordinator.store.load(),reading);
      const currentGuard=settlingTrain=>{
        const checked=coordinator.guard({context:'train',phase:settlingTrain?'owned-input':'observe'});
        if(checked.state.latestFrameId!==reading.frameId)throw Error('CURRENT_FRAME_REQUIRED');return checked;
      };
      const result=await claimTrainReward(coordinator.store,reading,{device:coordinator.device,signal:coordinator.signal,
        beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
      if(result.status==='issued')transport.actionId=result.action?.id??result.id;
      return coordinator.update(result.status==='issued'?'collecting':'hold',result.status==='issued'?null:'TRAIN_REWARD_PREFLIGHT_REJECTED',
        {transport:'train',trainRows:reading.rows,trainActionId:transport.actionId});
    }catch(error){clearObservationWait(coordinator);return coordinator.update('hold',error.message,{transport:'train',observationSchedule:null});}
    finally{coordinator.busy=false;coordinator.update(coordinator.state.phase,coordinator.state.reason);}
}

export async function enterTrainWait(coordinator,frame,reading){
    const transport=transportState(coordinator,'train');
return coordinator.enterTransitWait(frame,reading,'train');
}

export function trainLoadingKey(coordinator,frame,reading){
    const transport=transportState(coordinator,'train');

    const registration=trainLoadingProfile(frame),{profile,hash}=registration,row=trainLoadingRow(profile,reading);
    if(independentTrain(registration)){
      const slot=row.slots.find(s=>s.slotId===reading.selectedCarriage),p=slot?trainSlotPopup(profile,row,slot,null):null;
      const boxes=[...profile.anchors,...(p?[...p.anchors,p.load]:row.bareAnchors)].map(s=>s.box).concat(row.slots.map(s=>s.gridBox),p?[p.field.box]:[]);
      const state=coordinator.store.load();return sha({pixels:digest(Buffer.concat(boxes.map(b=>cropPng(coordinator.store.evidence(frame.id).image,b)))),profile:hash,
        epoch:frame.epoch,policy:state.session.management,invalidation:state.observationInvalidation,source:inventorySourceFingerprint(state),inventory:coordinator.inventoryStamp()});
    }
    const p=profile.popups.find(p=>p.id===reading.popupId);
    const evidence=coordinator.store.evidence(frame.id),boxes=[...profile.anchors,...(p?[...p.anchors,p.item,p.load]:(row.bareAnchors??[])),...row.slots.flatMap(s=>[s.body,s.item,s.quantity,...(s.quantityAlternatives??[])]),...row.loaded.flatMap(s=>s.regions)].map(s=>s.box);
    if(p)boxes.push(p.field.box);const state=coordinator.store.load();
    return sha({pixels:digest(Buffer.concat(boxes.map(b=>cropPng(evidence.image,b)))),profile:hash,epoch:frame.epoch,
      policy:state.session.management,invalidation:state.observationInvalidation,source:inventorySourceFingerprint(state),inventory:coordinator.inventoryStamp()});
}

export function holdTrainLoading(coordinator,frame,candidate,reason,extra={}){
    const transport=transportState(coordinator,'train');

    transport.lastKey=coordinator.trainLoadingKey(frame,candidate);
    transport.hold={frameId:frame.id,evidenceHash:frame.evidenceHash,epoch:frame.epoch,key:transport.lastKey,reason};
    return coordinator.update('hold',reason,{transport:'train',...extra});
}

export async function exitHeldTrain(coordinator,frame,candidate,key){
    const transport=transportState(coordinator,'train');

    const held=transport.hold;
    if(!held||held.key!==key||held.epoch!==frame.epoch||transport.plan||transport.navigationId||transport.actionId)return coordinator.status();
    const {state}=coordinator.guard({context:'train'}),allocation=coordinator.inventory.status();
    // Visible supported returned cargo still belongs to the current transport.
    // An unknown layout is a local recognition hold and grants no claim target.
    if(readTrainRewards(coordinator.store.evidence(frame.id).image,trainRewardProfile(frame)).targets.length)return coordinator.status();
    const original=state.frames[held.frameId],executionHold=trainExecutionHold(state,original,allocation);
    const route=coordinator.nextTransport(allocation,{current:'train',executionHolds:{train:executionHold}})??
      (held.reason==='TRAIN_SELECTED_SHORTAGE'?await coordinator.requestMarketForShortages(frame,'train'):null);if(!route)return coordinator.status();
    const args={frame,original:{id:held.frameId,evidenceHash:held.evidenceHash},reading:candidate,allocation,fingerprint:key,reason:held.reason};
    trainHeldExitBoundary(state,args,coordinator.store.clock());
    const timers=coordinator.routeMemory().train?.timers??[];
    coordinator.rememberRoute('train',original,allocation,timers,'exhausted',null,executionHold);
    return coordinator.exitPanel(frame,'train',route,checked=>{
      if(coordinator.trainLoadingKey(frame,candidate)!==held.key)throw Error('TRAIN_HOLD_CHANGED');
      return trainHeldExitBoundary(checked,args,coordinator.store.clock());
    });
}

export async function onTrainLoadingFrame(coordinator,frame,candidate){
    const transport=transportState(coordinator,'train');

    if(!candidate.supported){
      const pending=(transport.plan||transport.navigationId)&&coordinator.store.load().input;
      return coordinator.update(pending?'waiting':'hold',pending?'TRAIN_LOAD_RESULT_PENDING':candidate.reason,{transport:'train',recognitionReason:candidate.reason});
    }
    if(candidate.departed&&!transport.plan&&!coordinator.store.load().input)return coordinator.update('hold','TRAIN_IN_TRANSIT',{transport:'train',trainRow:candidate.row});
    const key=coordinator.trainLoadingKey(frame,candidate);
    if(!transport.plan&&!coordinator.store.load().input&&key===transport.lastKey)return coordinator.exitHeldTrain(frame,candidate,key);
    transport.hold=null;
    // A bare row has no numeric field; defer OCR until a screen needs it.
    const reading=await observeTransportWithRetry(coordinator,{kind:'train',frame,key},async()=>{
      if(candidate.field||candidate.fields?.length)coordinator.workers??=coordinator.workersFactory();
      return observeTrainLoading(coordinator.store,{frameId:frame.id,
        temporaryContext:coordinator.currentMode?transport.slotContexts.get(candidate.layoutId)??null:null},coordinator.workers??{});
    });
    if(!reading.stored)return coordinator.update('hold',reading.reason,{transport:'train'});
    coordinator.guard({context:'train',phase:'owned-input'});
    if(coordinator.store.load().input)return coordinator.update('waiting','TRAIN_LOAD_RESULT_REQUIRED',{transport:'train'});
    if(transport.navigationId){
      if(coordinator.store.load().actions[transport.navigationId]?.status!=='verified')
        return coordinator.update('hold','TRAIN_DETAIL_RECONCILIATION_REQUIRED',{transport:'train'});
      transport.navigationId=null;transport.actionId=null;
    }
    // The same original first proves the load, then exposes the next owned pair.
    if(transport.plan){
      if(coordinator.store.load().actions[transport.actionId]?.status!=='verified')
        return coordinator.update('hold',coordinator.state.reason??'TRAIN_MISSION_RECONCILIATION_REQUIRED',{transport:'train'});
      const settled=await runTransportMission(coordinator.store,coordinator.inventory,transport.plan,{device:coordinator.device});
      if(settled.status!=='complete')return coordinator.update('hold',settled.reason??'TRAIN_LOAD_ACCOUNTING_REQUIRED',{transport:'train'});
      transport.plan=null;transport.actionId=null;
    }
    const fullDemand=reading.review.data.train.fullDemandConfirmed;
    if(coordinator.currentMode&&independentTrain(trainLoadingProfile(frame))){
      if(fullDemand)transport.slotContexts.set(reading.layoutId,structuredClone(coordinator.store.load().frames[frame.id]));
      else transport.slotContexts.delete(reading.layoutId);
    }
    coordinator.syncInventory(coordinator.store,coordinator.inventory,{mutationId:'train-observed:'+sha({session:coordinator.store.load().session.id,frameId:frame.id}),frameIds:fullDemand?[frame.id]:[]});
    coordinator.noteCurrentOrder(frame);
    coordinator.guard({context:'train'});
    if(reading.review.data.order.completed===true&&reading.review.data.departure?.departed===true){
      transport.lastKey=coordinator.trainLoadingKey(frame,candidate);
      const idle=readTrainIdle(coordinator.store.evidence(frame.id).image,trainIdleProfile(frame));
      if(idle.supported)return await coordinator.enterTrainWait(frame,idle);
      return coordinator.update('hold','TRAIN_AUTOMATICALLY_DEPARTED',{transport:'train',trainRow:reading.row});
    }
    if(!fullDemand)return coordinator.holdTrainLoading(frame,candidate,'TRAIN_ORIGINAL_DEMAND_REQUIRED');
    if(reading.review.data.order.disposition==='delete')return coordinator.holdTrainLoading(frame,candidate,'ORDER_8_UNIT_LIMIT');
    const plan=trainLoadingPlan(coordinator.store.load(),reading);
    const allocation=coordinator.inventory.status();
    const inspect=()=>coordinator.inspectTrainDetail(frame,reading,allocation);
    if(!plan){
      if(selectTrainDetail(reading,allocation,trainLoadingProfile(frame)))return inspect();
      const selected=reading.review.data.order.needs.find(n=>n.slotId===reading.selectedCarriage);
      const bareShortage=candidate.barePartial===true&&reading.review.data.order.needs.length>0&&reading.review.data.order.needs.every(n=>{
        const stock=allocation.projection?.items?.[n.itemId];return stock?.fresh===true&&Number.isSafeInteger(stock.quantity)&&stock.quantity<n.required;
      });
      return coordinator.holdTrainLoading(frame,candidate,bareShortage||selected&&Number.isSafeInteger(selected.owned)&&selected.owned<selected.required?'TRAIN_SELECTED_SHORTAGE':'TRAIN_LOAD_RESULT_EVIDENCE_REQUIRED',
        {trainRow:reading.row,selectedCarriage:reading.selectedCarriage});
    }
    const order=allocation.evaluations?.find(o=>o.orderId===plan.steps[0].orderId),step=plan.steps[0];
    const reserved=allocation.projection?.reservations?.filter(r=>r.orderId===step.orderId&&r.itemId===step.itemId).reduce((sum,r)=>sum+r.quantity,0)??0;
    const scopedHold=trainAllocationAllowsCarriage(order)&&plan.steps[0].kind==='load_train'&&
      reading.review.targets.find(t=>t.id===step.targetId)?.management?.resultRegistrationRequired!==true;
    if(!order||order.status==='hold'&&!scopedHold||reserved<step.maxUnits){
      if(selectTrainDetail(reading,allocation,trainLoadingProfile(frame)))return inspect();
      return coordinator.holdTrainLoading(frame,candidate,!order||order.status==='hold'?'AUTOMATIC_ORDER_HELD':'CURRENT_TRANSPORT_RESERVATION_REQUIRED');
    }
    transport.plan=plan;transport.actionId=plan.steps[0].actionId;
    const currentGuard=settlingTrain=>{
      const checked=coordinator.guard({context:'train',phase:settlingTrain?'owned-input':'observe'});
      if(checked.state.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');return checked;
    };
    const result=await runTransportMission(coordinator.store,coordinator.inventory,plan,{device:coordinator.device,
      beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
    if(!coordinator.store.load().actions[transport.actionId]){
      transport.plan=null;transport.actionId=null;transport.lastKey=coordinator.trainLoadingKey(frame,candidate);
    }
    return coordinator.update(result.status==='waiting_result_review'?'loading':'hold',result.reason??null,
      {transport:'train',trainRow:reading.row,trainActionId:transport.actionId});
}

export async function inspectTrainDetail(coordinator,frame,reading,allocation){
    const transport=transportState(coordinator,'train');

    const target=selectTrainDetail(reading,allocation,trainLoadingProfile(frame));if(!target)throw Error('TRAIN_DETAIL_REQUIRED');
    const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'d'},()=> 'train-detail:'+sha({session:coordinator.store.load().session.id,frame:frame.id,target:target.id}).slice(0,32));
    transport.navigationId=actionId;transport.actionId=actionId;
    const currentGuard=settlingTrain=>{
      const checked=coordinator.guard({context:'train',phase:settlingTrain?'owned-input':'observe'});
      if(checked.state.latestFrameId!==frame.id)throw Error('CURRENT_FRAME_REQUIRED');
      return checked;
    };
    const result=await navigateReviewed(coordinator.store,{frameId:frame.id,actionId,targetId:target.id,
      nextVisit:{visitId:actionId+'-result',kind:'train',required:true}},
      {device:coordinator.device,beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
    return coordinator.update(result.status==='issued'?'inspecting':'hold',result.status==='issued'?null:'TRAIN_DETAIL_RECONCILIATION_REQUIRED',
      {transport:'train',trainRow:reading.row,trainActionId:actionId,selectedCarriage:target.trainDetail.slotId});
}
import {trainExecutionHold} from './mumu-transport-capability.mjs';
