import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {createDevice} from './device.mjs';
// One owner drains supported feasible helicopter work; persistent actions never replay.
import {closeSync,unlinkSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,regionDigest} from './adb.mjs';
import {helicopterProfile} from './mumu-helicopter-proof.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {assertNativeInputIdle} from './mumu-process-owner.mjs';
import {acquireStateLock} from './mumu-persistence.mjs';
import {waitForResultCapture} from './mumu-timing.mjs';
import {observeHelicopter,syncOrderInventory} from './mumu-helicopter.mjs';
import {PerceptionWorker,RapidOcrWorker,helicopterWorkerOptions} from './mumu-perception-bridge.mjs';
import {runTransportMission,captureDiagnostic} from './mumu-automatic.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {reconcileRejectedNavigationRound} from './mumu-navigation-rejection.mjs';
const fail=code=>{throw Error(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/.test(x);
export const HELICOPTER_ROUND_END_CONDITION='no_feasible_deliveries';
const legacyLimit=x=>x===undefined||Number.isSafeInteger(x)&&x>0;
// Visit-local colored pin geometry can bob a few pixels. It is never an order
// identity; avoid selecting the same nearby node again during this pass.
export function visitedNavigationPin(visited,mapId){
  if(visited.includes(mapId))return true;
  const position=id=>/^pin:([0-9]+):([0-9]+)$/.exec(id??'')?.slice(1).map(Number);
  const current=position(mapId);if(!current)return false;
  return visited.some(id=>{const old=position(id);return old&&Math.hypot(current[0]-old[0],current[1]-old[1])<=24;});
}
export function nextNavigationTarget(review,visited){
  const candidates=review.targets.filter(t=>t.kind==='select_customer'&&!visitedNavigationPin(visited,t.mapId));
  const green=new Set((review.data?.helicopter?.mapTargets??[]).filter(p=>p.status==='candidate'&&p.pinState==='green').map(p=>p.mapId));
  // Colour prioritizes inspection only; stock allocation and SEND proof remain authoritative.
  return candidates.find(t=>green.has(t.mapId))??candidates[0];
}
function authority(state){
  if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')fail('MANAGEMENT_APPROVAL_REQUIRED');
  if(state.stopCapture||state.stopReader)fail('SESSION_STOPPED');
}
// Expiry ends input authority, but must not strand already verified/accounted
// completion. Only clear this finite loop's exact one-SEND pointer; never run
// the mission again, synchronize stock, or manufacture completion evidence.
export function reconcileCompletedHelicopterRound(store,inventory,roundId){
  const initial=store.load(),old=initial.helicopterRounds?.[roundId];
  if(!old?.waitingPlan||!Number.isFinite(Date.parse(old.deadlineAt))||store.clock()<Date.parse(old.deadlineAt))return null;
  if(inventory?.source!==store)fail('INVENTORY_SOURCE_MISMATCH');
  return inventory.locked(state=>{
    authority(state);
    if(state.input!==null||hasUnresolvedActions(state.actions??{}))fail('INPUT_UNRESOLVED');
    const round=state.helicopterRounds?.[roundId],plan=round?.waitingPlan;
    const hash=value=>digest(Buffer.from(JSON.stringify(value)));
    if(!plan||hash(round)!==hash(old)||round.waitingActionId!==null||!Array.isArray(round.actionIds)||
        !round.actionIds.length||new Set(round.actionIds).size!==round.actionIds.length||
        round.actionIds.some(a=>state.actions[a]?.status!=='verified'||!state.actions[a]?.resultFrameId))fail('ROUND_RECONCILIATION_REQUIRED');
    const step=plan.steps?.[0],mission=state.transportMissions?.[plan.missionId];
    if(plan.source!=='explicit_user'||plan.sessionId!==state.session.id||plan.maxCoins!==0||plan.steps?.length!==1||
        step?.kind!=='send_helicopter'||step.actionId!==plan.missionId||round.actionIds.at(-1)!==step.actionId||
        mission?.planHash!==hash(plan)||mission.status!=='complete'||mission.waitingActionId!==null||mission.nextIndex!==1||
        mission.receipts?.length!==1)fail('ROUND_ACCOUNTING_REQUIRED');
    const action=state.actions[step.actionId],frame=state.frames[action.resultFrameId],before=state.frames[action.frameId];
    const target=before?.review?.targets?.find(t=>t.id===step.targetId),claim=mission.claims?.[step.actionId],receipt=mission.receipts[0];
    if(action.id!==step.actionId||action.management!==true||action.targetId!==step.targetId||action.frameId!==step.frameId||
        action.target?.kind!=='send_helicopter'||!target||hash(target)!==hash(action.target)||!acceptedFacts(before)||
        before.review.actualKind!=='helicopter'||before.review.data?.order?.orderId!==step.orderId||
        action.target.management?.orderId!==step.orderId||hash(action.nextVisit)!==hash(step.nextVisit)||
        claim?.kind!=='send_helicopter'||claim.orderId!==step.orderId||
        receipt.actionId!==action.id||receipt.resultFrameId!==frame?.id||receipt.kind!=='send_helicopter'||
        action.resultProof?.schema!==1||frame?.evidenceHash===before.evidenceHash||
        !Number.isFinite(Date.parse(action.issuedAt))||!Number.isFinite(Date.parse(frame?.observedAt))||
        Date.parse(frame.observedAt)<Date.parse(action.issuedAt))fail('ROUND_ACCOUNTING_REQUIRED');
    const effect=actionEffect(state,action);
    if(effect?.confirmed!==true||effect.actionId!==action.id||effect.frameId!==frame.id||effect.completedOrderId!==step.orderId||
        hash(effect)!==hash(action.resultProof.review.data?.actionResult))fail('ROUND_ACCOUNTING_REQUIRED');
    for(const f of [before,frame])if(store.evidence(f.id).frame.evidenceHash!==f.evidenceHash)fail('ROUND_ACCOUNTING_REQUIRED');
    const record=inventory.load(state),deltas=effect.inventoryDeltas??[],invalidated=effect.inventoryInvalidated??[];
    if(!Array.isArray(deltas)||!Array.isArray(invalidated)||!deltas.length&&!invalidated.length)fail('ROUND_ACCOUNTING_REQUIRED');
    const expected={actionId:action.id,frameId:frame.id,evidenceHash:frame.evidenceHash,observedAt:frame.observedAt,
      sequence:frame.sequence,epoch:frame.epoch,orderId:effect.orderId??effect.completedOrderId??null,deltas,
      ...(invalidated.length?{invalidatedItems:invalidated}:{}),
      ...(effect.capacityDelta?{capacityDelta:effect.capacityDelta}:{}),...(effect.coinDelta?{coinDelta:effect.coinDelta}:{})};
    const saved=record.effects.filter(e=>e.actionId===action.id);
    if(saved.length!==1||hash(saved[0])!==hash(expected))fail('ROUND_ACCOUNTING_REQUIRED');
    round.waitingPlan=null;round.waitingActionId=null;round.status='boundary';round.reason='DEADLINE_BOUNDARY';
    state.revision++;store.save(state);
    return {roundId,...structuredClone(round),input:state.input,inventoryRevision:record.revision,executionAllowed:false};
  });
}
// Retire only expired, inactive legacy recognition passes that never reserved
// an action. Preserve their exact exceptions; this is not delivery completion.
export function reconcileInactiveHelicopterRounds(store,inventory,{excludeRoundId=null,ownerToken}={}){
  if(inventory?.source!==store)fail('INVENTORY_SOURCE_MISMATCH');
  const ownership=()=>{
    let lease;try{lease=JSON.parse(readFileSync(join(store.root,'capture.lock'),'utf8'));}catch{fail('CAPTURE_OWNERSHIP_REQUIRED');}
    if(typeof ownerToken!=='string'||!ownerToken||lease.pid!==process.pid||lease.token!==ownerToken)fail('CAPTURE_PRODUCER_NOT_OWNED');
    if(existsSync(join(store.root,'helicopter-runner.lock'))||existsSync(join(store.root,'.management','runner.lock')))fail('DELIVERY_RUNNER_NOT_OWNED');
  };
  ownership();
  const state=store.load();authority(state);
  if(state.input!==null||hasUnresolvedActions(state.actions??{}))fail('INPUT_UNRESOLVED');
  if(Object.values(state.transportMissions??{}).some(m=>m.waitingActionId))fail('MISSION_RECONCILIATION_REQUIRED');
  const recognitionReasons=new Set(['CUSTOMER_BINDING_UNKNOWN','PRODUCT_OR_QUANTITY_UNKNOWN','PRODUCT_TEMPLATE_UNKNOWN']);
  for(const [roundId,old] of Object.entries(state.helicopterRounds??{})){
    if(roundId===excludeRoundId||['boundary','complete'].includes(old.status))continue;
    try{
    ownership();
    if(reconcileCompletedHelicopterRound(store,inventory,roundId))continue;
    // New-policy, active, action-bearing and unsupported exceptions stay held.
    if(old.endCondition!==undefined||old.status!=='exception'||old.reason!=='UNSUPPORTED_ORDERS_REMAIN'||
        !Number.isFinite(Date.parse(old.deadlineAt))||store.clock()<Date.parse(old.deadlineAt)||
        !Array.isArray(old.actionIds)||old.actionIds.length||old.waitingPlan!==null||old.waitingActionId!==null||
        !Array.isArray(old.exceptions)||!old.exceptions.length||old.exceptions.some(e=>!recognitionReasons.has(e.reason)))fail('ROUND_RECONCILIATION_REQUIRED');
    inventory.locked(current=>{
      ownership();
      authority(current);
      if(current.input!==null||hasUnresolvedActions(current.actions??{}))fail('INPUT_UNRESOLVED');
      if(Object.values(current.transportMissions??{}).some(m=>m.waitingActionId))fail('MISSION_RECONCILIATION_REQUIRED');
      const hash=value=>digest(Buffer.from(JSON.stringify(value))),round=current.helicopterRounds?.[roundId];
      if(hash(round)!==hash(old))fail('ROUND_RECONCILIATION_REQUIRED');
      const frameIds=[...new Set(round.exceptions.map(e=>e.frameId))];
      const belongs=(key,value)=>key===roundId||key.startsWith(roundId+':')||value?.roundId===roundId;
      if(Object.entries(current.actions??{}).some(([key,a])=>belongs(key,a)||frameIds.includes(a.frameId))||
          Object.entries(current.transportMissions??{}).some(([key,m])=>belongs(key,m)||m.plan?.roundId===roundId))fail('ROUND_ACTION_UNSETTLED');
      const record=inventory.load(current);
      if(record.effects.some(e=>belongs(e.actionId??'',e))||record.operations.some(e=>belongs(e.actionId??'',e)))fail('ROUND_ACCOUNTING_REQUIRED');
      const evidence=frameIds.map(frameId=>{
        const frame=current.frames[frameId];
        if(!acceptedFacts(frame)||frame.review.actualKind!=='helicopter'||frame.review.data?.order?.ready!==false||
            frame.review.targets?.length||frame.review.proof?.inputId||
            round.exceptions.filter(e=>e.frameId===frameId).some(e=>!frame.review.data?.helicopter?.reasons?.includes(e.reason)))fail('ROUND_RECOGNITION_EVIDENCE_REQUIRED');
        if(store.evidence(frameId).frame.evidenceHash!==frame.evidenceHash)fail('ROUND_RECOGNITION_EVIDENCE_REQUIRED');
        return {frameId,evidenceHash:frame.evidenceHash,observedAt:frame.observedAt,originalPath:store.frameFile(frameId),
          reasons:round.exceptions.filter(e=>e.frameId===frameId).map(e=>e.reason)};
      });
      round.reconciliation={kind:'expired_recognition_without_input',priorRoundHash:hash(old),evidence,
        inventoryUnchanged:true,executionAllowed:false};
      round.status='boundary';round.reason='LEGACY_RECOGNITION_HOLD_ARCHIVED';
      current.revision++;store.save(current);
    });
    }catch(error){
      error.roundId=roundId;
      error.actionIds=[...(old.actionIds??[])];
      error.frameIds=[...new Set([...(old.exceptions??[]).map(e=>e.frameId),
        ...(old.actionIds??[]).flatMap(id=>[state.actions[id]?.frameId,state.actions[id]?.resultFrameId])].filter(Boolean))];
      throw error;
    }
  }
  return helicopterReconciliationSummary(store.load());
}
export function helicopterReconciliationSummary(state){
  const rounds=Object.entries(state.helicopterRounds??{}).filter(([,r])=>r.status==='boundary');
  return {completedRounds:rounds.filter(([,r])=>r.reason==='DEADLINE_BOUNDARY').length,
    recognitionOnlyRounds:rounds.filter(([,r])=>r.reconciliation?.kind==='expired_recognition_without_input').length,
    heldEvidence:rounds.filter(([,r])=>r.reconciliation?.kind==='expired_recognition_without_input')
      .flatMap(([roundId,r])=>r.reconciliation.evidence.map(e=>({roundId,...e}))),executionAllowed:false};
}
// Google Play can still enlarge the next order after the first result capture.
// Re-observe that same issued action only: never replay input or infer completion
// from a delay. Identical unresolved grids and three originals bound the wait.
export async function captureHelicopterObservation(store,options={}){
  const initial=store.load(),action=initial.actions[initial.input];
  const settling=initial.session.provider==='google_play_windows'&&['issued','captured'].includes(action?.status)&&
    ['send_helicopter','delete_helicopter'].includes(action.target?.kind);
  const sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  let previousGrid=null,observation;
  for(let attempt=0;attempt<(settling?3:1);attempt++){
    if(attempt>0){
      const current=store.load();authority(current);
      if(current.input!==action.id||!['issued','captured'].includes(current.actions[action.id]?.status)||
          current.scene.epoch!==initial.scene.epoch||current.latestFrameId!==observation.frameId)fail('OBSERVATION_CONTEXT_CHANGED');
    }
    observation=await captureHelicopterObservationOnce(store,options);
    const state=store.load();
    if(!settling||state.input!==action.id||observation.stored!==true||observation.review?.actualKind!=='helicopter')return observation;
    if(!['issued','captured'].includes(state.actions[action.id]?.status))fail('INPUT_UNRESOLVED');
    if(state.latestFrameId!==observation.frameId||state.scene.epoch!==initial.scene.epoch)fail('OBSERVATION_CONTEXT_CHANGED');
    const grid=regionDigest(store.evidence(observation.frameId).image,helicopterProfile(state.session).profile.orderGrid);
    if(grid===previousGrid||attempt===2)return observation;
    previousGrid=grid;
    const due=store.clock()+500;
    while(store.clock()<due){
      const current=store.load();authority(current);
      if(current.input!==action.id||!['issued','captured'].includes(current.actions[action.id]?.status)||current.scene.epoch!==initial.scene.epoch)fail('OBSERVATION_CONTEXT_CHANGED');
      await sleep(Math.min(100,due-store.clock()));
    }
  }
  return observation;
}
async function captureHelicopterObservationOnce(store,{device=null,workers={},sleep=undefined}={}){
  const state=store.load();authority(state);
  const action=state.actions[state.input];
  if(state.input&&!['issued','captured'].includes(action?.status))fail('INPUT_UNRESOLVED');
  if(!['helicopter','unknown'].includes(state.scene.kind)||state.input&&!['send_helicopter','delete_helicopter','select_customer'].includes(action?.target?.kind))fail('HELICOPTER_CONTEXT_REQUIRED');
  await waitForResultCapture(store,{sleep});
  const adb=device??createDevice(state.session),context=store.context();
  const packet=await adb.capture();
  const current=store.load();authority(current);
  if(current.scene.epoch!==context.scene.epoch||current.input!==state.input)fail('OBSERVATION_CONTEXT_CHANGED');
  const published=await store.retry(()=>store.publish(packet,context,{preserveForReview:true}));
  if(!published.accepted)fail('HELICOPTER_CAPTURE_'+published.reason.toUpperCase());
  // Diagnostic only: bind our published original before decoding can fail or
  // another observer can publish. Never use latestFrameId to recover this ref.
  const captureReference=Object.freeze({frameId:published.frame.id,evidenceHash:published.frame.evidenceHash,
    observedAt:published.frame.observedAt,epoch:published.frame.epoch});
  try{return {...await observeHelicopter(store,{frameId:captureReference.frameId},workers),captureReference};}
  catch(error){error.captureReference=captureReference;throw error;}
}

export async function runHelicopterRound(store,inventory,{source,roundId,maxInputs,maxCustomers}={},options={}){
  // Accept legacy request fields without imposing their former progress caps.
  if(source!=='explicit_user'||!id(roundId)||!legacyLimit(maxInputs)||!legacyLimit(maxCustomers))fail('HELICOPTER_ROUND_REQUEST_REQUIRED');
  const lock=join(store.root,'helicopter-runner.lock'),fd=acquireStateLock(lock,{beforeRecover:()=>{if(store.load().session.provider==='google_play_windows')assertNativeInputIdle();}});
  const ownedMatcher=!options.workers?.matcher,ownedOcr=!options.workers?.ocr;
  const workers={matcher:options.workers?.matcher??new PerceptionWorker(helicopterWorkerOptions(store.load().session)),
    ocr:options.workers?.ocr??new RapidOcrWorker()};
  const capture=options.captureObservation??captureHelicopterObservation;
  try{
    const reconciled=reconcileCompletedHelicopterRound(store,inventory,roundId);
    if(reconciled)return reconciled;
    await store.retry(()=>store.transact(s=>{
      authority(s);s.helicopterRounds??={};
      const old=s.helicopterRounds[roundId];
      if(old){
        if(!['boundary','complete'].includes(old.status)&&old.endCondition!==HELICOPTER_ROUND_END_CONDITION)fail('HELICOPTER_ROUND_POLICY_CHANGED');
        return;
      }
      if(s.input)fail('INPUT_UNRESOLVED');
      s.helicopterRounds[roundId]={endCondition:HELICOPTER_ROUND_END_CONDITION,
        actionIds:[],visited:[],checkedOrders:{},exceptions:[],status:'ready',waitingPlan:null,waitingActionId:null};
    }));
    const reserve=(state,actionId)=>{
      authority(state);const r=state.helicopterRounds[roundId];
      if(r.endCondition!==HELICOPTER_ROUND_END_CONDITION)fail('HELICOPTER_ROUND_POLICY_CHANGED');
      if(!r.actionIds.includes(actionId))r.actionIds.push(actionId);
    };
    const finish=async(status,reason=null,captureReference=null)=>{
      captureReference=captureDiagnostic({captureReference});
      const result=await store.retry(()=>store.transact(s=>{
        const r=s.helicopterRounds[roundId];r.status=status;r.reason=reason;
        if(captureReference)r.captureReference=captureReference;else delete r.captureReference;
        return {roundId,...r,input:s.input,executionAllowed:false};
      }));
      if(!result.input&&['boundary','complete'].includes(status))syncOrderInventory(store,inventory,
        {mutationId:`${roundId}:finish:${store.load().revision}`,frameIds:[store.load().latestFrameId]});
      return result;
    };
    while(true){
      let state=store.load(),round=state.helicopterRounds[roundId];authority(state);
      if(['boundary','complete'].includes(round.status))return {roundId,...round,input:state.input,executionAllowed:false};
      if(round.waitingPlan){
        const result=await runTransportMission(store,inventory,round.waitingPlan,{device:options.device,sleep:options.sleep,currentWorkBoundary:options.currentWorkBoundary,
          verifyResult:()=>capture(store,{device:options.device,workers,sleep:options.sleep})});
        if(result.status!=='complete')return finish('exception',result.reason??result.status,result.captureReference);
        await store.retry(()=>store.transact(s=>{const r=s.helicopterRounds[roundId];r.waitingPlan=null;r.waitingActionId=null;}));
        continue;
      }
      if(round.waitingActionId){
        const action=state.actions[round.waitingActionId];
        const observed=action?.status!=='verified'?await capture(store,{device:options.device,workers,sleep:options.sleep}):null;
        if(store.load().input)return finish('exception','CUSTOMER_SELECTION_REQUIRES_EXCEPTION',observed?.captureReference);
        await store.retry(()=>store.transact(s=>{s.helicopterRounds[roundId].waitingActionId=null;}));
        continue;
      }
      if(state.input)return finish('exception','INPUT_UNRESOLVED');
      let frame=state.frames[state.latestFrameId],captureReference=null;
      if(frame?.review?.reviewedBy!=='program-helicopter'||frame.epoch!==state.scene.epoch){
        const observed=await capture(store,{device:options.device,workers,sleep:options.sleep});
        captureReference=observed?.captureReference;
        state=store.load();frame=state.frames[observed?.frameId];
      }
      if(frame?.review?.status!=='accepted'||frame.review.reviewedBy!=='program-helicopter'||
        frame.epoch!==state.scene.epoch||frame.sceneId!==state.scene.id)return finish('exception','SUPPORTED_HELICOPTER_REQUIRED',captureReference);
      const order=frame.review.data.order;
      const allocation=syncOrderInventory(store,inventory,{mutationId:`${roundId}:sync:${state.revision}`,frameIds:[frame.id]});
      const evaluation=allocation.evaluations.find(e=>e.orderId===order?.orderId);
      const feasible=evaluation?.status==='feasible';
      const send=frame.review.targets.find(t=>t.kind==='delete_helicopter')??frame.review.targets.find(t=>t.kind==='send_helicopter');
      if(send&&(send.kind==='delete_helicopter'||feasible)){
        const actionId=`${roundId}:input:${round.actionIds.length+1}`;
        const plan={source:'explicit_user',sessionId:state.session.id,missionId:actionId,maxCoins:0,
          steps:[{actionId,targetId:send.id,kind:send.kind,frameId:frame.id,orderId:order.orderId,nextVisit:{visitId:actionId,kind:'helicopter'}}]};
        await store.retry(()=>store.transact(s=>{reserve(s,actionId);const r=s.helicopterRounds[roundId];r.waitingPlan=plan;}));
        continue;
      }
      await store.retry(()=>store.transact(s=>{
        const r=s.helicopterRounds[roundId];
        if(order)(r.checkedOrders??={})[order.orderId]=evaluation?.status??'hold';
        for(const reason of frame.review.data.helicopter.reasons)r.exceptions.push({frameId:frame.id,reason});
      }));
      round=store.load().helicopterRounds[roundId];
      // A later stock observation or released reservation can make an inspected
      // order feasible. Revisit that transition once; unchanged shortages and
      // already checked feasible-but-unready orders do not cause navigation churn.
      const becameFeasible=allocation.orders.some(o=>round.checkedOrders?.[o.orderId]&&round.checkedOrders[o.orderId]!=='feasible'&&
        allocation.evaluations.some(e=>e.orderId===o.orderId&&e.status==='feasible'));
      // Navigation nodes are visit-local geometry, never a customer identity.
      // A changed stock/reservation allocation permits one new pass over ready nodes.
      const allocationKey=digest(Buffer.from(JSON.stringify(allocation.evaluations.map(e=>[e.orderId,e.status,e.items]))));
      if(becameFeasible&&round.allocationKey!==allocationKey){
        await store.retry(()=>store.transact(s=>{s.helicopterRounds[roundId].visited=[];s.helicopterRounds[roundId].allocationKey=allocationKey;}));
        round=store.load().helicopterRounds[roundId];
      }
      const target=nextNavigationTarget(frame.review,round.visited);
      if(!target)return finish('complete',round.exceptions.length?'NO_FEASIBLE_WITH_HELD_ORDERS':'NO_FEASIBLE_DELIVERIES');
      const actionId=`${roundId}:input:${round.actionIds.length+1}`;
      let result;
      try{result=await navigateReviewed(store,{actionId,frameId:frame.id,targetId:target.id,nextVisit:{visitId:actionId,kind:'helicopter'}},
        {device:options.device,beforeBegin:s=>{reserve(s,actionId);const r=s.helicopterRounds[roundId];
          if(!r.visited.includes(target.mapId))r.visited.push(target.mapId);r.waitingActionId=actionId;}});}
      catch(error){
        if(error.message!=='NAVIGATION_TARGET_CHANGED')throw error;
        await store.retry(()=>store.transact(s=>{const r=s.helicopterRounds[roundId];r.status='exception';r.reason=error.message;}));
        if(!reconcileRejectedNavigationRound(store,inventory,roundId,{resume:true}))throw error;
        continue;
      }
      if(result.duplicate)return finish('exception','ACTION_ALREADY_EXISTS');
    }
  }catch(error){
    const captureReference=captureDiagnostic(error);
    await store.retry(()=>store.transact(s=>{
      const r=s.helicopterRounds?.[roundId];
      if(!r||['boundary','complete'].includes(r.status))return false;
      r.status='exception';r.reason=error.message;
      if(captureReference)r.captureReference=captureReference;else delete r.captureReference;
      return true;
    },{writeWhen:changed=>changed})).catch(()=>{});
    return {status:'exception',reason:error.message,roundId,input:store.load().input,executionAllowed:false,
      ...(captureReference?{captureReference}:{})};
  }finally{
    if(ownedMatcher)workers.matcher.close();if(ownedOcr)workers.ocr.close();closeSync(fd);unlinkSync(lock);
  }
}
