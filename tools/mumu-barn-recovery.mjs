// Policy state is durable; orders, owned counts and purchase coordinates are not.
// These decisions never authorize a click. Unregistered sale source/results hold.
import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {validateMarketProof} from './mumu-market-proof.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
const ordinary=new Set(['crop','animal_product','factory_product']);
const materials=new Set(['bricks','shovel','glass']);
const count=n=>Number.isSafeInteger(n)&&n>=0;
const positive=n=>count(n)&&n>0;
const hold=reason=>({kind:'hold',reason,executionAllowed:false});
export function recoveryPolicy(value){
  if(value===undefined||value===null)return {schema:1,occurrences:0,active:null};
  if(value.schema!==1||!count(value.occurrences)||value.active&&
    (!positive(value.active.number)||value.active.number!==value.occurrences||!['available','reserved','used'].includes(value.active.construction)))
    throw Error('BARN_RECOVERY_POLICY_INVALID');
  return structuredClone(value);
}
export function beginBarnShortage(policy,{sourceFrameId,sourceHash,sequence,itemId,quantity,reason,free,demandOrders=[]}){
  const next=recoveryPolicy(policy);
  if(!sourceFrameId||!/^[a-f0-9]{64}$/.test(sourceHash??'')||!count(sequence)||!itemId||!positive(quantity)||
    !['MARKET_BARN_SPACE_INSUFFICIENT','MARKET_BARN_FULL'].includes(reason)||
    reason==='MARKET_BARN_SPACE_INSUFFICIENT'&&(!count(free)||free>=quantity))throw Error('CONFIRMED_BARN_SHORTAGE_REQUIRED');
  const source={sourceFrameId,sourceHash,sequence,itemId,quantity,reason,demandOrders:structuredClone(demandOrders)};
  if(next.active){next.active.lastEvidence=source;return next;}
  next.occurrences++;
  next.active={number:next.occurrences,origin:source,lastEvidence:source,construction:'available',pendingSale:null};
  return next;
}
export function resolveBarnShortage(policy,{sourceFrameId,sourceHash,free,quantity,currentOfferConfirmed=false,needRetired=false}){
  const next=recoveryPolicy(policy);if(!next.active)return next;
  if(next.active.pendingSale)throw Error('BARN_SALE_RESULT_REQUIRED');
  if(!sourceFrameId||!/^[a-f0-9]{64}$/.test(sourceHash??'')||!needRetired&&
    (!currentOfferConfirmed||!count(free)||!positive(quantity)||free<quantity))throw Error('BARN_SHORTAGE_RESOLUTION_REQUIRED');
  // Keep the counter only, never accumulate an order/stock history.
  next.active=null;return next;
}
export function barnRecoveryDecision(policy,{inputUnresolved=false,needs,capacity,rows,atStart=false,category=null,sourceResultRegistered=false}={}){
  const episode=recoveryPolicy(policy).active;
  if(inputUnresolved||episode?.pendingSale)return hold('BARN_SALE_RESULT_REQUIRED');
  if(!episode)return hold('CONFIRMED_BARN_SHORTAGE_REQUIRED');
  if(needs?.feasible?.length)return {kind:'deliver_first',orders:needs.feasible,executionAllowed:false};
  if(!capacity||!count(capacity.free)||!positive(capacity.requiredBundle))return hold('BARN_CAPACITY_RECHECK_REQUIRED');
  if(capacity.free>=capacity.requiredBundle)return {kind:'return_market_recheck',executionAllowed:false};
  if(!Array.isArray(needs?.orders)||!Array.isArray(needs?.held)||needs.held.length)return hold('BARN_CURRENT_RESERVES_REQUIRED');
  if(!sourceResultRegistered)return hold('BARN_SALE_SOURCE_RESULT_EVIDENCE_REQUIRED');
  if(!['crops','products'].includes(category))return hold('BARN_ALLOWED_TAB_REQUIRED');
  if(!atStart||!Array.isArray(rows))return hold('BARN_DISPLAY_ORDER_REQUIRED');
  const reserves=new Map();
  for(const order of needs.orders)for(const n of order.needs??[]){
    if(!n.itemId||!positive(n.required))return hold('BARN_CURRENT_RESERVES_REQUIRED');
    reserves.set(n.itemId,(reserves.get(n.itemId)??0)+n.required);
  }
  // No ranking, computed half-stock quantity, slider adjustment or guessed ID.
  for(const [index,row] of rows.entries()){
    if(row.index!==index)return hold('BARN_DISPLAY_ORDER_REQUIRED');
    if(!row.itemId||row.identityConfirmed!==true||!count(row.owned)||!positive(row.defaultQuantity)||row.defaultUnchanged!==true)continue;
    const construction=false;
    if(!ordinary.has(row.category))continue;
    if(row.defaultQuantity>row.owned-(reserves.get(row.itemId)??0))continue;
    return {kind:'sale_candidate',itemId:row.itemId,quantity:row.defaultQuantity,index,construction,
      episode:episode.number,tabId:category,executionAllowed:false};
  }
  return hold('BARN_NO_ELIGIBLE_DEFAULT_SALE');
}
export function reserveBarnSale(policy,decision,actionId){
  const next=recoveryPolicy(policy),e=next.active;
  if(!e||e.pendingSale||decision?.kind!=='sale_candidate'||decision.episode!==e.number||!actionId||
    !positive(decision.quantity)||decision.construction||!['crops','products'].includes(decision.tabId))
    throw Error('BARN_SALE_RESERVATION_REJECTED');
  e.pendingSale={actionId,itemId:decision.itemId,quantity:decision.quantity,construction:decision.construction===true};
  if(decision.construction)e.construction='reserved';return next;
}
export function settleBarnSale(policy,{actionId,itemId,quantity,beforeOwned,afterOwned,beforeUsed,afterUsed,confirmed=false}){
  const next=recoveryPolicy(policy),e=next.active,p=e?.pendingSale;
  if(!p||p.actionId!==actionId||p.itemId!==itemId||p.quantity!==quantity||!confirmed||
    ![beforeOwned,afterOwned,beforeUsed,afterUsed].every(count)||beforeOwned-afterOwned!==quantity||beforeUsed-afterUsed!==quantity)
    throw Error('BARN_SALE_RESULT_REQUIRED');
  if(p.construction)e.construction='used';e.pendingSale=null;return next;
}
export function recordMarketSpaceHold(store,frame,reg){
  const state=store.load(),f=state.frames[frame.id],d=f?.review?.data,decision=d?.marketDecision;
  if(state.input||hasUnresolvedActions(state.actions??{}))throw Error('INPUT_UNRESOLVED');
  if(state.latestFrameId!==frame.id||!d?.currentNeeds)throw Error('CURRENT_MARKET_FRAME_REQUIRED');
  validateMarketProof(f,reg);
  const offer=d.rows.find(r=>r.slotId===decision?.blockedSlotId),capacity=d.marketCapacity;
  if(decision?.reason!=='MARKET_BARN_SPACE_INSUFFICIENT'||!offer||offer.identity?.status!=='matched'||
    !(d.currentNeeds.needs[offer.itemId]?.quantity>0)||!capacity)throw Error('CONFIRMED_BARN_SHORTAGE_REQUIRED');
  return store.transact(s=>{
    if(s.latestFrameId!==frame.id||s.input||hasUnresolvedActions(s.actions??{}))throw Error('CURRENT_MARKET_FRAME_REQUIRED');
    s.barnRecovery=beginBarnShortage(s.barnRecovery,{sourceFrameId:f.id,sourceHash:f.evidenceHash,sequence:f.sequence,
      itemId:offer.itemId,quantity:offer.quantity,reason:decision.reason,free:capacity.free,
      demandOrders:shortageOrders(d.currentNeeds,offer.itemId)});
    return s.barnRecovery;
  });
}
export function recordMarketSpaceReady(store,frame,reg){
  const s=store.load(),f=s.frames[frame.id],d=f?.review?.data;
  if(!s.barnRecovery?.active||d?.marketDecision?.kind!=='buy')return;
  validateMarketProof(f,reg);const offer=d.rows.find(r=>r.slotId===d.marketDecision.slotId);
  if(!offer||offer.itemId!==s.barnRecovery.active.origin.itemId||!d.marketCapacity||s.latestFrameId!==frame.id||s.input||hasUnresolvedActions(s.actions??{}))return;
  store.transact(state=>{
    if(state.latestFrameId!==frame.id||state.input||hasUnresolvedActions(state.actions??{}))throw Error('CURRENT_MARKET_FRAME_REQUIRED');
    state.barnRecovery=resolveBarnShortage(state.barnRecovery,{sourceFrameId:f.id,sourceHash:f.evidenceHash,
      free:d.marketCapacity.free,quantity:offer.quantity,currentOfferConfirmed:true});
  });
}
export function recordRejectedMarketSpaceHold(store,frame,actionId,reg){
  const state=store.load(),f=state.frames[frame.id],a=state.actions[actionId],r=f?.review?.data?.actionResult;
  if(state.input||hasUnresolvedActions(state.actions??{}))throw Error('INPUT_UNRESOLVED');
  validateMarketProof(f,reg);
  if(state.latestFrameId!==frame.id||a?.status!=='verified'||a.resultFrameId!==f.id||a.target?.kind!=='buy_market'||
    r?.actionId!==a.id||r.purchaseRejected!==true||r.acquiredQuantity!==0||r.rejectionReason!=='MARKET_BARN_FULL')
    throw Error('CONFIRMED_BARN_SHORTAGE_REQUIRED');
  return store.transact(s=>{
    if(s.latestFrameId!==frame.id||s.input||hasUnresolvedActions(s.actions??{}))throw Error('CURRENT_MARKET_FRAME_REQUIRED');
    s.barnRecovery=beginBarnShortage(s.barnRecovery,{sourceFrameId:f.id,sourceHash:f.evidenceHash,sequence:f.sequence,
      itemId:a.target.management.itemId,quantity:a.target.management.quantity,reason:r.rejectionReason,
      demandOrders:shortageOrders(state.frames[a.frameId]?.review?.data?.currentNeeds,a.target.management.itemId)});
    return s.barnRecovery;
  });
}
function shortageOrders(needs,itemId){
  const ids=new Set(needs?.needs?.[itemId]?.orders??[]);
  return (needs?.orders??[]).filter(o=>ids.has(o.orderId)).map(o=>({orderId:o.orderId,signature:o.signature}));
}
// Missing/expired observations and restart are not evidence that demand ended.
// Keep only active-incident demand references, never a completed-order ledger.
export function retireBarnShortageForCurrentOrders(store,frame){
  const state=store.load(),episode=state.barnRecovery?.active,source=episode?.origin;
  if(!episode||episode.pendingSale||!source?.demandOrders?.length||state.input||hasUnresolvedActions(state.actions??{})||
    state.latestFrameId!==frame.id||!acceptedFacts(state.frames[frame.id])||frame.sequence<=source.sequence)return false;
  const needs=currentScreenNeeds(state,{now:store.clock()});
  const retired=source.demandOrders.every(ref=>{
    const current=needs.orders.find(o=>o.orderId===ref.orderId);
    if(current&&state.frames[current.frameId]?.sequence>source.sequence&&!needs.held.some(o=>o.orderId===ref.orderId)&&
      !needs.allocations.some(a=>a.orderId===ref.orderId&&a.itemId===source.itemId&&(a.shortage===null||a.shortage>0)))return true;
    return Object.values(state.actions??{}).some(a=>{
      const before=state.frames[a.frameId],after=state.frames[a.resultFrameId],order=before?.review?.data?.order;
      if(a.status!=='verified'||!['send_helicopter','delete_helicopter'].includes(a.target?.kind)||
        !acceptedFacts(before)||order?.orderId!==ref.orderId||!ref.signature||order.signature!==ref.signature||
        !(before.sequence>source.sequence)||!(after?.sequence>source.sequence))return false;
      const effect=actionEffect(state,a);
      return effect?.confirmed===true&&effect.actionId===a.id&&effect.frameId===after.id;
    });
  });
  if(!retired)return false;
  store.transact(s=>{
    if(s.latestFrameId!==frame.id||s.input||hasUnresolvedActions(s.actions??{})||
      JSON.stringify(s.barnRecovery)!==JSON.stringify(state.barnRecovery))throw Error('CURRENT_BARN_RECOVERY_REQUIRED');
    s.barnRecovery=resolveBarnShortage(s.barnRecovery,{sourceFrameId:frame.id,sourceHash:frame.evidenceHash,needRetired:true});
  });
  return true;
}
