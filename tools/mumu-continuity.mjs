import {CONTINUITY_VERSION,readContinuity,continuityRelease} from './mumu-continuity-record.mjs';
export {CONTINUITY_VERSION,readContinuity,continuityRelease} from './mumu-continuity-record.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
// A durable coordinator around rounds that drain feasible work. No input adapter,
// approval, resume, inventory initialization, or unknown-input recovery lives here.
import {existsSync,readFileSync,mkdirSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {sameRootPath} from './mumu-path-identity.mjs';
import {digest} from './adb.mjs';
import {assertNativeInputIdle} from './mumu-process-owner.mjs';
import {atomic,acquireStateLock} from './mumu-persistence.mjs';
import {runHelicopterRound,reconcileCompletedHelicopterRound,HELICOPTER_ROUND_END_CONDITION} from './mumu-helicopter-loop.mjs';
import {syncOrderInventory} from './mumu-helicopter.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {reconcileRejectedNavigationRound,validateNavigationNoEffectReceipt} from './mumu-navigation-rejection.mjs';

const fail=code=>{throw Error(code);};
const sha=value=>digest(Buffer.from(JSON.stringify(value)));
const configKeys=['managementId','sourceRoot','sessionId','inventoryRoot','endCondition','policyHash','releaseId'];
function configMatches(record,expected){
  const saved=Object.fromEntries(configKeys.map(key=>[key,record[key]]));
  return record.configHash===sha(saved)&&configKeys.every(key=>['sourceRoot','inventoryRoot'].includes(key)?
    sameRootPath(saved[key],expected[key]):saved[key]===expected[key]);
}
// Call only after terminalProof; locks, persistence and yielding stay with callers.
function advanceTerminalRound(record,roundId,round,sends,sourceRevision,inventoryRevision,reason=round.reason){
  if(!record.receipts.some(receipt=>receipt.roundId===roundId))record.receipts.push({roundId,status:round.status,reason,
    actionIds:[...round.actionIds],sends,sourceRevision,inventoryRevision});
  record.currentRoundId=null;record.nextOrdinal++;
}
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,60}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const paths=store=>({root:join(store.root,'.management'),file:join(store.root,'.management','continuity.json'),lock:join(store.root,'.management','runner.lock')});
// Observation scheduling only; these pins never authorize or identify an order.
// Require a unique one-to-one match within the existing visit-local tolerance.
export function sameNavigationPins(before,after){
  const valid=pins=>Array.isArray(pins)&&pins.every(p=>p?.status==='candidate'&&['red','green'].includes(p.pinState)&&
    ['x','y','width','height'].every(k=>Number.isFinite(p.box?.[k]))&&p.box.width>0&&p.box.height>0);
  if(!valid(before)||!valid(after)||before.length!==after.length)return false;
  const matches=(a,b)=>a.pinState===b.pinState&&a.box.width===b.box.width&&a.box.height===b.box.height&&
    Math.hypot(a.box.x-b.box.x,a.box.y-b.box.y)<=24;
  return before.every(a=>after.filter(b=>matches(a,b)).length===1)&&after.every(b=>before.filter(a=>matches(a,b)).length===1);
}
export const validUnambiguousNavigationPins=pins=>sameNavigationPins(pins,pins);
const currentPins=state=>{const frame=state.frames[state.latestFrameId];return acceptedFacts(frame)?frame.review.data?.helicopter?.mapTargets??null:null;};
// Explicit, settled code-upgrade boundary. No input or observation is invoked.
// A paused installation preserves both stops; execution still uses guard().
export function adoptContinuityRelease(store,inventory,{source,expectedRelease,newRelease}={}){
  if(source!=='explicit_user'||!(/^[a-f0-9]{64}$/).test(expectedRelease??'')||newRelease!==continuityRelease())fail('EXPLICIT_RELEASE_ADOPTION_REQUIRED');
  if(inventory?.source!==store||!existsSync(inventory.file))fail('EXISTING_INVENTORY_REQUIRED');
  const p=paths(store),fd=acquireStateLock(p.lock,{beforeRecover:()=>{if(store.load().session.provider==='google_play_windows')assertNativeInputIdle();}});
  try{
    if(existsSync(join(store.root,'capture.lock')))fail('CAPTURE_PRODUCER_NOT_OWNED');
    if(existsSync(join(store.root,'helicopter-runner.lock')))fail('DELIVERY_RUNNER_NOT_OWNED');
    let state=store.load();guard(state,{allowStopped:true});
    const record=readContinuity(store);delete record.executionAllowed;
    if(record.status==='not_started'||record.releaseId!==expectedRelease||expectedRelease===newRelease)fail('CONTINUITY_CONFIG_CHANGED');
    const config={managementId:record.managementId,sourceRoot:resolve(store.root),sessionId:state.session.id,inventoryRoot:resolve(inventory.root),
      endCondition:HELICOPTER_ROUND_END_CONDITION,policyHash:sha(state.session.management),releaseId:expectedRelease};
    if(!configMatches(record,config)||
      !Number.isSafeInteger(record.nextOrdinal)||record.nextOrdinal<1||!Array.isArray(record.receipts)||
      Object.entries(state.helicopterRounds??{}).some(([id,r])=>id!==record.currentRoundId&&!['boundary','complete'].includes(r.status))||
      Object.values(state.transportMissions??{}).some(m=>m.waitingActionId))fail('ROUND_RECONCILIATION_REQUIRED');
    if(record.currentRoundId){
      const old=state.helicopterRounds?.[record.currentRoundId];
      if(!old)fail('CANONICAL_ROUND_REQUIRED');
      if(!['boundary','complete'].includes(old.status)&&!reconcileRejectedNavigationRound(store,inventory,record.currentRoundId))fail('ROUND_RECONCILIATION_REQUIRED');
      state=store.load();guard(state,{allowStopped:true});
      const round=state.helicopterRounds[record.currentRoundId],allocation=inventory.locked(s=>inventory.load(s));
      const sends=terminalProof(state,round,allocation,store);
      advanceTerminalRound(record,record.currentRoundId,round,sends,state.revision,allocation.revision);
    }
    record.releaseAdoptions??=[];record.releaseAdoptions.push({from:expectedRelease,to:newRelease,source:'explicit_user',
      adoptedAt:new Date(store.clock()).toISOString(),sourceRevision:state.revision,inventoryUnchanged:true});
    record.releaseId=newRelease;record.configHash=sha({...config,sourceRoot:record.sourceRoot,inventoryRoot:record.inventoryRoot,releaseId:newRelease});record.holdEvidence=null;record.status='ready';record.reason=null;
    atomic(p.file,{version:CONTINUITY_VERSION,checksum:sha(record),record});
    return {...structuredClone(record),executionAllowed:false};
  }finally{closeSync(fd);unlinkSync(p.lock);}
}
function guard(state,{allowStopped=false}={}){
  if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')fail('MANAGEMENT_APPROVAL_REQUIRED');
  if(!allowStopped&&(state.stopCapture||state.stopReader))fail('SESSION_STOPPED');
  if(state.input||hasUnresolvedActions(state.actions??{}))fail('INPUT_UNRESOLVED');
}
function evidenceKey(state,allocation){
  const frame=state.frames[state.latestFrameId],review=acceptedFacts(frame)?frame.review:null;
  return sha({kind:state.scene.kind,order:review?.data?.order??null,
    profile:review?.proof?.profileHash??null,refresh:state.observationInvalidation?.sequence??null,
    items:allocation?.projection?.items&&Object.fromEntries(Object.entries(allocation.projection.items).map(([key,v])=>[key,{quantity:v.quantity,status:v.status,fresh:v.fresh}])),
    orders:allocation?.orders?.map(o=>({orderId:o.orderId,needs:o.needs})),reservations:allocation?.projection?.reservations});
}
function addException(record,state,{kind,reason,frameId=null,orderId=null,details=null}){
  const frame=state.frames[frameId],order=acceptedFacts(frame)?frame.review.data?.order:null;
  orderId??=order?.orderId??null;
  const profileHash=acceptedFacts(frame)?frame.review.proof?.profileHash??null:null;
  const key=sha({kind,reason,orderId,profileHash,unbound:orderId?null:frame?.evidenceHash??null});
  const group=record.exceptions[key]??={kind,reason,orderId,profileHash,evidence:[]};
  const proof={frameId,evidenceHash:frame?.evidenceHash??null,observedAt:frame?.observedAt??null,details};
  if(!group.evidence.some(p=>sha(p)===sha(proof)))group.evidence.push(proof);
}
function collect(record,state,round,allocation){
  for(const exception of round.exceptions??[])addException(record,state,{kind:'recognition',...exception});
  for(const evaluation of allocation?.evaluations??[]){
    if(!['shortage','hold'].includes(evaluation.status))continue;
    const frameId=(allocation.orderFrameIds??[]).find(fid=>state.frames[fid]?.review?.data?.order?.orderId===evaluation.orderId)??null;
    addException(record,state,{kind:evaluation.status==='shortage'?'shortage':'allocation',reason:evaluation.status,
      frameId,orderId:evaluation.orderId,details:{reasons:evaluation.reasons??[],items:evaluation.items??[]}});
  }
}
function terminalProof(state,round,inventoryRecord,store){
  if(state.input||round.waitingPlan||round.waitingActionId)fail('ROUND_RECONCILIATION_REQUIRED');
  const receipts=[];
  for(const actionId of round.actionIds){
    const action=state.actions[actionId];
    if(action?.status==='rejected_before_input'){
      try{validateNavigationNoEffectReceipt(store,state,inventoryRecord,round,actionId);}
      catch{fail('ROUND_ACTION_UNSETTLED');}continue;
    }
    if(action?.status!=='verified'||!action.resultFrameId)fail('ROUND_ACTION_UNSETTLED');
    if(!['send_helicopter','delete_helicopter'].includes(action.target.kind))continue;
    const mission=state.transportMissions?.[actionId],effect=actionEffect(state,action);
    if(mission?.status!=='complete'||mission.waitingActionId||!mission.receipts?.some(r=>r.actionId===actionId&&r.resultFrameId===action.resultFrameId)||
        !effect?.confirmed||effect.actionId!==actionId||effect.frameId!==action.resultFrameId||
        !inventoryRecord.effects?.some(e=>e.actionId===actionId))fail('ROUND_ACCOUNTING_REQUIRED');
    receipts.push({actionId,resultFrameId:action.resultFrameId,kind:action.target.kind,...(effect.deletedOrderId?{deletedOrderId:effect.deletedOrderId}:{} )});
  }
  return receipts;
}

export async function runContinuingHelicopter(store,inventory,{source,managementId,maxRounds=3,maxInputs,maxCustomers}={},options={}){
  if(source!=='explicit_user'||!id(managementId)||!Number.isSafeInteger(maxRounds)||maxRounds<1||maxRounds>10||
      maxInputs!==undefined&&(!Number.isSafeInteger(maxInputs)||maxInputs<1)||
      maxCustomers!==undefined&&(!Number.isSafeInteger(maxCustomers)||maxCustomers<1))fail('FINITE_CONTINUITY_REQUEST_REQUIRED');
  // Stops and unresolved input return before worker creation, sidecar creation,
  // locks, or inventory synchronization. This does not confer authority.
  try{guard(store.load());}catch(error){return {status:'hold',reason:error.message,managementId,input:store.load().input,executionAllowed:false};}
  if(inventory.source!==store||!existsSync(inventory.file))return {status:'hold',reason:'EXISTING_INVENTORY_REQUIRED',managementId,executionAllowed:false};
  const p=paths(store);mkdirSync(p.root,{recursive:true});const fd=acquireStateLock(p.lock,{beforeRecover:()=>{if(store.load().session.provider==='google_play_windows')assertNativeInputIdle();}});
  let record;
  const save=()=>atomic(p.file,{version:CONTINUITY_VERSION,checksum:sha(record),record});
  const finish=(status,reason=null)=>{record.status=status;record.reason=reason;save();return {...structuredClone(record),input:store.load().input,executionAllowed:false};};
  const sync=options.syncInventory??syncOrderInventory,runner=options.runRound??runHelicopterRound;
  try{
    let state=store.load();guard(state);
    const config={managementId,sourceRoot:resolve(store.root),sessionId:state.session.id,inventoryRoot:resolve(inventory.root),endCondition:HELICOPTER_ROUND_END_CONDITION,
      policyHash:sha(state.session.management),releaseId:continuityRelease()};
    const old=readContinuity(store);
    if(old.status!=='not_started'){
      if(!configMatches(old,config))fail('CONTINUITY_CONFIG_CHANGED');
      record=old;delete record.executionAllowed;
    }else record={...config,configHash:sha(config),nextOrdinal:1,currentRoundId:null,receipts:[],exceptions:{},status:'ready',reason:null,holdEvidence:null};
    let completedThisCall=0;
    while(completedThisCall<maxRounds){
      state=store.load();guard(state);
      if(record.currentRoundId){
        const reconciled=reconcileCompletedHelicopterRound(store,inventory,record.currentRoundId);
        if(reconciled){
          state=store.load();guard(state);
          const round=state.helicopterRounds[record.currentRoundId];
          const inventoryRecord=inventory.locked(s=>inventory.load(s));
          const sends=terminalProof(state,round,inventoryRecord,store);
          advanceTerminalRound(record,record.currentRoundId,round,sends,state.revision,inventoryRecord.revision);
          // Bookkeeping recovery yields before stock sync or another round.
          return finish('yielded','EXPIRED_ROUND_RECONCILED');
        }
      }
      let allocation=inventory.status();
      if(allocation.requiresSync){
        sync(store,inventory,{mutationId:'continuity:'+sha({id:managementId,phase:'sync',sourceRevision:state.revision,inventoryRevision:allocation.revision}),frameIds:[state.latestFrameId]});
        allocation=inventory.status();if(allocation.requiresSync)fail('CONTINUITY_SYNC_REQUIRED');
      }
      if(!record.currentRoundId){
        const pins=currentPins(state),sameMap=record.holdMapTargets==null&&pins==null||sameNavigationPins(record.holdMapTargets,pins);
        if(record.holdEvidence===evidenceKey(state,allocation)&&sameMap)return finish('hold',record.reason??'NO_PRODUCTIVE_PROGRESS');
        if(!['helicopter','unknown'].includes(state.scene.kind))return finish('hold','HELICOPTER_CONTEXT_REQUIRED');
        if(!Number.isSafeInteger(record.nextOrdinal)||record.nextOrdinal<1)fail('CONTINUITY_INTEGRITY_ERROR');
        record.currentRoundId=managementId+':round:'+record.nextOrdinal;record.holdEvidence=null;save();
      }
      const roundId=record.currentRoundId;
      let round=state.helicopterRounds?.[roundId];
      if(round&&!['boundary','complete'].includes(round.status)&&round.endCondition!==HELICOPTER_ROUND_END_CONDITION)fail('CONTINUITY_ROUND_CHANGED');
      if(round&&!['boundary','complete'].includes(round.status)){
        if(round.status==='exception'){
          if(!reconcileRejectedNavigationRound(store,inventory,roundId)){
            collect(record,state,round,allocation);return finish('hold',round.reason??'ROUND_EXCEPTION');
          }
          state=store.load();round=state.helicopterRounds[roundId];
        }
      }
      if(!round||!['boundary','complete'].includes(round.status)){
        await runner(store,inventory,{source:'explicit_user',roundId},options.roundOptions??{});
        state=store.load();guard(state);round=state.helicopterRounds?.[roundId];
        if(!round)fail('CANONICAL_ROUND_REQUIRED');
      }
      allocation=inventory.status();collect(record,state,round,allocation);
      if(!['boundary','complete'].includes(round.status))return finish('hold',round.reason??'ROUND_EXCEPTION');
      // Terminal is written before final sync by the inner runner. Reconcile it
      // even after crash reentry; never trust its returned status as accounting.
      if(allocation.requiresSync){
        sync(store,inventory,{mutationId:'continuity:'+sha({id:managementId,phase:'terminal',roundId,sourceRevision:state.revision,inventoryRevision:allocation.revision}),frameIds:[state.latestFrameId]});
        allocation=inventory.status();if(allocation.requiresSync)fail('CONTINUITY_SYNC_REQUIRED');
      }
      collect(record,state,round,allocation);
      const sends=terminalProof(state,round,allocation,store);
      advanceTerminalRound(record,roundId,round,sends,state.revision,allocation.revision,round.reason??null);completedThisCall++;
      if(round.status==='complete'||!sends.length){
        record.holdEvidence=evidenceKey(state,allocation);
        record.holdMapTargets=structuredClone(currentPins(state));
        return finish('hold',round.status==='complete'?'NO_SUPPORTED_WORK':'NO_PRODUCTIVE_PROGRESS');
      }
      record.status='ready';record.reason=null;save();
    }
    return finish('yielded','INVOCATION_BOUNDARY');
  }catch(error){
    if(!record)throw error;
    return finish('hold',error.message);
  }finally{closeSync(fd);unlinkSync(p.lock);}
}
