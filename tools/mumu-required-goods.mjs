import {transportEnabled,deliveryScopeCutoff} from './mumu-delivery-scope.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
// Read-only presentation of canonical allocation; never reserves stock or navigates.
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {evidenceWindow} from './mumu-freshness.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
import {inventoryUnchangedDeletion} from './mumu-inventory.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';

const transports=[['airport','plane','비행기'],['train','train','열차'],['helicopter','helicopter','헬리콥터 착륙장']];
const integer=n=>Number.isSafeInteger(n)&&n>=0;

function groupItems(rows){
  const products=new Map();
  for(const row of rows){
    if(!products.has(row.itemId))products.set(row.itemId,[]);
    products.get(row.itemId).push(row);
  }
  return [...products.values()].map(entries=>{
    // Excluded orders never add demand. A shared stock pool is counted once,
    // including helicopters whose incomplete orders release their reservations.
    const historical=entries.filter(r=>['stale','order_changed'].includes(r.status));
    const active=entries.filter(r=>r.status!=='supply_excluded'&&!historical.includes(r));
    const confirmed=active.filter(r=>['shortage','sufficient'].includes(r.status));
    const uncertain=active.filter(r=>!confirmed.includes(r));
    const required=confirmed.reduce((sum,r)=>sum+r.required,0);
    const available=confirmed.reduce((max,r)=>Math.max(max,r.available),0);
    const confirmedShortage=confirmed.length&&integer(required)?Math.max(0,required-available):null;
    // A partial number describes only confirmed current orders. Exact totals
    // remain unknown when another active order for this product is uncertain.
    const shortage=uncertain.length?null:confirmedShortage;
    const excluded=entries.filter(r=>r.status==='supply_excluded');
    const contributing=active.length?active:excluded.length?excluded:historical;
    return {transport:entries[0].transport,label:entries[0].label,itemId:entries[0].itemId,shortage,
      orderIds:[...new Set(contributing.map(r=>r.orderId))],recognitionReasons:[...new Set(contributing.flatMap(r=>r.recognitionReasons??[]))],
      confirmedShortage,uncertainOrderCount:new Set(uncertain.map(r=>r.orderId)).size,
      historicalOrderCount:new Set(historical.map(r=>r.orderId)).size,
      status:!active.length?excluded.length?'supply_excluded':'stale':uncertain.length?confirmed.length?'partial':uncertain[0].status:
        shortage===null?'unknown':shortage>0?'shortage':'sufficient',
      observedAt:contributing.map(r=>r.observedAt).sort()[0],executionAllowed:false};
  });
}

export function requiredGoodsView(state,inventory,{now=Date.now()}={}){
  const completed=new Map(),changed=new Map();
  for(const action of Object.values(state.actions??{})){
    // Navigation and event rewards do not complete or change order demand.
    // Their historical result proofs belong to their own accounting paths.
    if(action.status!=='verified'||!['load_train','load_airport','send_train','send_airport','send_helicopter','delete_helicopter'].includes(action.target?.kind))continue;
    const effect=actionEffect(state,action),result=state.frames[action.resultFrameId];
    if(effect?.confirmed!==true||effect.actionId!==action.id||effect.frameId!==result?.id)continue;
    const completedId=action.target?.kind==='delete_helicopter'?
      inventoryUnchangedDeletion(state,action,effect)?effect.deletedOrderId:null:effect.completedOrderId;
    if(completedId)completed.set(completedId,Math.max(completed.get(completedId)??-1,result.sequence));
    if(['load_train','load_airport','send_helicopter'].includes(action.target?.kind)){
      const orderId=state.frames[action.frameId]?.review?.data?.order?.orderId;
      if(orderId)changed.set(orderId,Math.max(changed.get(orderId)??-1,result.sequence));
    }
  }
  const seen=new Set(),frames=[];
  for(const frame of Object.values(state.frames??{}).sort((a,b)=>b.sequence-a.sequence)){
    const order=frame.review?.data?.order;
    if(!transportEnabled(state,frame.review?.actualKind)||frame.sequence<=deliveryScopeCutoff(state)||!orderDemandCurrent(state,frame)||!acceptedFacts(frame)||!order?.orderId||!transports.some(([kind])=>kind===frame.review.actualKind))continue;
    const key=frame.review.actualKind+':'+order.orderId;
    if(seen.has(key))continue;seen.add(key);
    if(order.completed===true||frame.sequence<=(completed.get(order.orderId)??-1))continue;
    frames.push(frame);
  }
  const evaluations=new Map((inventory.orders??[]).map(o=>[o.orderId,o]));
  const sources=new Map((inventory.orderSources??[]).map(o=>[o.orderId,o]));
  const unresolved=!!state.input||hasUnresolvedActions(state.actions??{});
  const rows=[],groups=[],itemRows=[];
  for(const [kind,transport,label] of transports){
    const own=frames.filter(f=>f.review.actualKind===kind),start=rows.length;
    for(const frame of own){
      const order=frame.review.data.order,evaluation=evaluations.get(order.orderId),source=sources.get(order.orderId);
      const sourceMatches=source?.source?.frameId===frame.id&&source.transport===transport;
      const invalidated=!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence;
      const current=evidenceWindow({...order,...sourceMatches?{validity:source.validity}:{},observedAt:frame.observedAt,invalidated},{now}).valid;
      const disposition=orderDisposition(order.needs);
      let status=!current?'stale':disposition==='delete'?'supply_excluded':
        unresolved?'input_unresolved':inventory.requiresSync?'requires_sync':inventory.status==='error'?'inventory_error':
        frame.sequence<(changed.get(order.orderId)??-1)?'order_changed':
        !inventory.allocationKnown?'allocation_unknown':!sourceMatches||!evaluation?'allocation_pending':
        source.confirmed!==true||evaluation.status==='hold'?'hold':null;
      const totals=new Map();
      for(const need of order.needs??[]){
        const key=need.itemId??null,previous=totals.get(key)??0;
        const total=integer(need.required)&&need.required>0&&previous!==null?previous+need.required:null;
        totals.set(key,integer(total)?total:null);
      }
      if(!totals.size)totals.set(null,null);
      for(const [itemId,required] of totals){
        const allocated=evaluation?.items?.find(i=>i.itemId===itemId);
        const numeric=status===null&&itemId!==null&&required!==null&&allocated?.required===required&&
          integer(allocated.availableBefore)&&integer(allocated.shortage);
        rows.push({transport,label,orderId:order.orderId,itemId,required,
          recognitionReasons:[...(!itemId?['product_identity']:[]),
            ...(order.needs??[]).some(n=>n.itemId===itemId&&(!integer(n.owned)||!integer(n.required)||n.required<1))?['quantity']:[]],
          available:numeric?allocated.availableBefore:null,shortage:numeric?allocated.shortage:null,
          status:status??(numeric?allocated.shortage>0?'shortage':'sufficient':'unknown'),
          reasons:evaluation?.reasons??[],observedAt:frame.observedAt,frameId:frame.id,executionAllowed:false});
      }
    }
    const ownRows=groupItems(rows.slice(start)),shortageRows=ownRows.filter(r=>r.status==='shortage');
    itemRows.push(...ownRows);
    groups.push({transport,label,status:!own.length?'unobserved':ownRows.some(r=>!['shortage','sufficient','supply_excluded'].includes(r.status))?'partial':
      shortageRows.length?'shortage':ownRows.every(r=>r.status==='supply_excluded')?'supply_excluded':'sufficient',
      orderCount:own.length,shortageItems:[...new Set(shortageRows.map(r=>r.itemId))],
      observedAt:own[0]?.observedAt??null,executionAllowed:false});
  }
  return {groups,rows,itemRows,coverage:'observed_orders_only',executionAllowed:false};
}
