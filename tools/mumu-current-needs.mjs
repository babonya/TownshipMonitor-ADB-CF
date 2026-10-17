import {transportEnabled,deliveryScopeCutoff} from './mumu-delivery-scope.mjs';
// Temporary current-screen demand. No durable stock ledger or receipts replay.
import {digest} from './adb.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
import {transportPriority} from './mumu-transport-kind.mjs';
const positive=n=>Number.isSafeInteger(n)&&n>0;
const consumedOrderKinds=new Set(['barn_sell','send_helicopter','delete_helicopter','load_train','load_airport','send_train','send_airport']);
function currentStock(orders){
  const owned=new Map(),uncertain=new Set(),samples=new Map();
  for(const order of orders)for(const need of order.needs){
    if(!Number.isSafeInteger(need.owned)||need.owned<0){uncertain.add(need.itemId);continue;}
    if(owned.has(need.itemId)&&owned.get(need.itemId)!==need.owned)uncertain.add(need.itemId);
    else owned.set(need.itemId,need.owned);
    samples.set(need.itemId,{quantity:need.owned,source:need.ownedSource??{frameId:order.frameId,evidenceHash:order.evidenceHash}});
  }
  return {owned,uncertain,samples};
}
export function projectCurrentNeeds(orders,{includePolicyHolds=true,includeStock=false}={}){
  const held=[],eligible=[];
  for(const order of orders){
    const whole=order.originalNeeds??order.needs;
    const disposition=order.fullDemandConfirmed===true?orderDisposition(whole):'hold';
    if(disposition!=='deliver'){if(includePolicyHolds)held.push({orderId:order.orderId,transport:order.transport,reason:disposition==='delete'?'ORDER_DELETE_REQUIRED':'WHOLE_ORDER_REQUIRED'});continue;}
    if(!order.needs?.length||order.needs.some(n=>!n.itemId||!positive(n.required))){if(includePolicyHolds)held.push({orderId:order.orderId,reason:'KNOWN_PRODUCT_REQUIRED'});continue;}
    eligible.push(order);
  }
  eligible.sort((a,b)=>transportPriority(a.transport)-transportPriority(b.transport)||a.orderId.localeCompare(b.orderId));
  const stock=currentStock(eligible),{owned,uncertain}=stock;
  const available=new Map(owned),needs={},allocations=[],feasible=[];
  const ordered=[...eligible];
  // Preserve plane/train priority and partial commitments. Within helicopters,
  // commit complete orders first; an incomplete A cannot starve a ready B.
  for(let index=0;index<ordered.length;index++){
    if(ordered[index].transport==='helicopter'){
      const readyIndex=ordered.findIndex((order,i)=>{
        if(i<index||order.transport!=='helicopter')return false;
        const totals=new Map();for(const n of order.needs)totals.set(n.itemId,(totals.get(n.itemId)??0)+n.required);
        return [...totals].every(([id,required])=>!uncertain.has(id)&&available.has(id)&&available.get(id)>=required);
      });
      if(readyIndex>index)ordered.splice(index,0,ordered.splice(readyIndex,1)[0]);
    }
    const order=ordered[index];
    const demand=new Map();for(const n of order.needs)demand.set(n.itemId,(demand.get(n.itemId)??0)+n.required);
    const unread=[...demand.keys()].some(id=>uncertain.has(id)||!available.has(id));
    if(unread)held.push({orderId:order.orderId,transport:order.transport,reason:'CURRENT_OWNED_COUNTS_REQUIRED'});
    let ready=!unread;
    for(const [itemId,required]of demand){
      if(uncertain.has(itemId)||!available.has(itemId)){
        allocations.push({orderId:order.orderId,transport:order.transport,itemId,required,allocated:0,shortage:null,frameId:order.frameId,evidenceHash:order.evidenceHash});
        continue; // Unknown separate stock cannot release a known priority commitment.
      }
      const stock=available.get(itemId),allocated=Math.min(stock,required),shortage=required-allocated;
      available.set(itemId,stock-allocated);if(shortage)ready=false;
      allocations.push({orderId:order.orderId,transport:order.transport,itemId,required,allocated,shortage,
        frameId:order.frameId,evidenceHash:order.evidenceHash});
      if(shortage&&!unread){const n=needs[itemId]??={itemId,quantity:0,orders:[]};n.quantity+=shortage;n.orders.push(order.orderId);}
    }
    if(ready)feasible.push({orderId:order.orderId,transport:order.transport,frameId:order.frameId});
  }
  const record={schema:1,orders:eligible.map(o=>({orderId:o.orderId,signature:o.signature,transport:o.transport,frameId:o.frameId,evidenceHash:o.evidenceHash,
    needs:o.needs,originalNeeds:o.originalNeeds??o.needs})),needs,allocations,feasible,held};
  return {...record,hash:sha(record),...includeStock?{stock}:{}};
}
function currentOrderFences(state,invalid){
  let visitCommitments=null;
  const consumedSequenceByOrder=new Map();
  const consumedAfter=Object.values(state.actions??{}).filter(a=>a.status==='verified').reduce((n,a)=>{
    if(consumedOrderKinds.has(a.target?.kind)){
      const source=state.frames[a.frameId],orderId=source?.review?.data?.order?.orderId,sequence=Number(source?.sequence);
      if(orderId!==undefined&&!Number.isNaN(sequence))consumedSequenceByOrder.set(orderId,Math.max(consumedSequenceByOrder.get(orderId)??-Infinity,sequence));
      return Math.max(n,state.frames[a.frameId]?.sequence??-1);
    }
    // Close the shopping visit before invalidating its demand projection. All
    // readers then share this current-count fence, even after recheck finishes.
    if(a.target?.kind==='close_panel'&&a.target.marketNative&&!['capacity_entry','capacity_close'].includes(a.target.marketNative.role)){
      const source=state.frames[a.frameId],result=state.frames[a.resultFrameId],review=a.resultProof?.review;
      if(!orderDemandCurrent(state,source)||source?.sequence<=invalid)return n;
      const snapshot=source?.review?.data?.currentNeeds,{hash,...demand}=snapshot??{};
      if(!acceptedFacts(source)||source.review.reviewedBy!=='program-market'||source.review.actualKind!=='market'||
         a.target.marketNative.role!=='close'||!a.resultProof||source.review.proof.role!=='source'||
         a.target.marketNative.needHash!==hash||sha(demand)!==hash||
         review?.reviewedBy!=='program-market'||review.actualKind!=='town'||review.proof?.role!=='result'||review.proof.inputId!==a.id)
        throw Error('CURRENT_MARKET_CLOSE_PROOF_REQUIRED');
      // Native navigation stores its effect under navigation, while the
      // immutable, hash-validated result review binds the same actionResult.
      const effect=actionEffect(state,a)??review.data?.actionResult;
      if(effect?.confirmed===true&&effect.actionId===a.id&&effect.frameId===result?.id&&
         effect.effect==='market_closed_to_registered_town'&&effect.currentOwnedRecheckRequired===true){
        if(!visitCommitments||result.sequence>visitCommitments.sequence)
          visitCommitments={sequence:result.sequence,orders:source.review.data.currentNeeds.orders};
        return Math.max(n,result.sequence);
      }
      throw Error('CURRENT_MARKET_CLOSE_PROOF_REQUIRED');
    }
    return n;
  },-1);
  return {consumedAfter,consumedSequenceByOrder,visitCommitments};
}
function mergeCurrentObservations(state,{now,afterSequence,invalid,consumedAfter}){
  const orders=new Map();
  for(const frame of Object.values(state.frames??{}).sort((a,b)=>b.sequence-a.sequence)){
    const r=frame.review,o=r?.data?.order;
    if(!transportEnabled(state,r?.actualKind)||!transportEnabled(state,o?.transport??r?.actualKind)||!acceptedFacts(frame)||!orderDemandCurrent(state,frame)||!o?.orderId||o.kind!=='normal'||o.completed===true||
      !['helicopter','train','airport'].includes(r.actualKind)||frame.sequence<=invalid||
      afterSequence!==null&&frame.sequence<=afterSequence||!inputEvidenceValid(frame,now,state))continue;
    if(frame.sequence<=consumedAfter)continue; // Recheck counts; never subtract old receipts.
    const d=r.data,full=d.airport?.fullDemandConfirmed??d.train?.fullDemandConfirmed??o.orderConfirmed;
    const previous=orders.get(o.orderId);
    if(previous){
      if(previous.signature!==o.signature||full!==true)continue;
      // Reuse only missing displayed counts within this unconsumed current
      // order. Navigation itself creates no stock balance.
      for(const n of previous.needs)if(n.owned===null||n.owned===undefined){
        const old=o.needs.find(x=>x.itemId===n.itemId&&Number.isSafeInteger(x.owned)&&x.owned>=0);
        if(old)n.owned=old.owned;
      }
      continue;
    }
    orders.set(o.orderId,{...o,frameId:frame.id,evidenceHash:frame.evidenceHash,
      needs:structuredClone(o.needs).map(({ownedSource,...n})=>n),
      transport:o.transport??r.actualKind,fullDemandConfirmed:full===true,
      originalNeeds:d.airport?.originalNeeds??d.train?.originalNeeds??o.needs});
  }
  return orders;
}
function restoreVisitDemand(state,orders,{now,invalid,visitCommitments,consumedSequenceByOrder}){
  if(visitCommitments){
    // Keep only this current visit's required goods, never its old stock. A
    // restart/external invalidation or a consumed order retires this evidence.
    const fresh=new Map(),conflicts=new Set();
    for(const o of orders.values())for(const need of o.needs)if(need.itemId&&Number.isSafeInteger(need.owned)&&need.owned>=0){
      if(fresh.has(need.itemId)&&fresh.get(need.itemId).quantity!==need.owned)conflicts.add(need.itemId);
      else fresh.set(need.itemId,{quantity:need.owned,frameId:o.frameId,evidenceHash:o.evidenceHash});
    }
    const demanded=needs=>sha(needs.map(n=>({itemId:n.itemId,required:n.required})));
    for(const commitment of visitCommitments.orders??[]){
      if(orders.has(commitment.orderId))continue;
      const frame=state.frames[commitment.frameId],r=frame?.review,o=r?.data?.order;
      if(!transportEnabled(state,r?.actualKind)||!transportEnabled(state,o?.transport??r?.actualKind)||!acceptedFacts(frame)||!orderDemandCurrent(state,frame)||frame.sequence<=invalid||
         frame.evidenceHash!==commitment.evidenceHash||o?.orderId!==commitment.orderId||o.signature!==commitment.signature||o.kind!=='normal'||o.completed===true||
         !inputEvidenceValid(frame,now,state)||demanded(o.needs)!==demanded(commitment.needs))continue;
      const consumed=(consumedSequenceByOrder.get(o.orderId)??-Infinity)>=frame.sequence;
      if(consumed)continue;
      const d=r.data,full=d.airport?.fullDemandConfirmed??d.train?.fullDemandConfirmed??o.orderConfirmed;
      const needs=o.needs.map(n=>{
        const stock=fresh.get(n.itemId),known=Number.isSafeInteger(n.owned)&&n.owned>=0&&stock&&!conflicts.has(n.itemId);
        return {...n,owned:known?stock.quantity:null,...known?{ownedSource:{frameId:stock.frameId,evidenceHash:stock.evidenceHash}}:{}};
      });
      orders.set(o.orderId,{...o,frameId:frame.id,evidenceHash:frame.evidenceHash,needs,
        transport:o.transport??r.actualKind,fullDemandConfirmed:full===true,
        originalNeeds:d.airport?.originalNeeds??d.train?.originalNeeds??o.needs});
    }
  }
}
export function currentScreenOrders(state,{now=Date.now(),afterSequence=null}={}){
  const invalid=Math.max(state.observationInvalidation?.sequence??-1,deliveryScopeCutoff(state));
  const fences=currentOrderFences(state,invalid);
  const orders=mergeCurrentObservations(state,{now,afterSequence,invalid,consumedAfter:fences.consumedAfter});
  restoreVisitDemand(state,orders,{now,invalid,...fences});
  return [...orders.values()];
}

export function currentScreenNeeds(state,{includeOrder=()=>true,includePolicyHolds=true,includeStock=false,...observationOptions}={}){
  return projectCurrentNeeds(currentScreenOrders(state,observationOptions).filter(includeOrder),{includePolicyHolds,includeStock});
}
