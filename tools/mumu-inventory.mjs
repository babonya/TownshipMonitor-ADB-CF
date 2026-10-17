import {isUnresolvedAction} from './mumu-input-state.mjs';
// Derived facts and joint allocation only. Never requests or confirms game input.
import {barnCoverage} from './mumu-barn.mjs';
import {evidenceWindow} from './mumu-freshness.mjs';
import {advanceCapacity,validateNumericMetadata} from './mumu-accounting.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';

const integer=n=>Number.isSafeInteger(n)&&n>=0;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s)&&!['constructor','prototype','__proto__'].includes(s);
const fail=code=>{throw Error(code);};
const fresh=(observedAt,now,maxAgeMs)=>Number.isFinite(Date.parse(observedAt))&&now-Date.parse(observedAt)>=0&&now-Date.parse(observedAt)<=maxAgeMs;
function checkRevision(projection,expectedRevision){
  if(projection?.schema!==1||!integer(expectedRevision)||projection.revision!==expectedRevision)fail('INVENTORY_REVISION_CONFLICT');
  if(!projection.items||!Array.isArray(projection.reservations)||!Array.isArray(projection.appliedActions)||!Array.isArray(projection.holdReasons)||projection.executionAllowed!==false)fail('INVENTORY_PROJECTION_INVALID');
  for(const [itemId,item] of Object.entries(projection.items))if(!id(itemId)||item.itemId!==itemId||!(item.quantity===null||integer(item.quantity)))fail('INVENTORY_PROJECTION_INVALID');
  for(const r of projection.reservations)if(!id(r.orderId)||!id(r.itemId)||!integer(r.quantity)||r.quantity===0)fail('INVENTORY_RESERVATION_INVALID');
}
function timeOptions(now,maxAgeMs){if(!Number.isFinite(now)||!integer(maxAgeMs))fail('INVENTORY_FRESHNESS_INVALID');}
import {inventoryUnchangedDeletion} from './mumu-inventory-effect.mjs';
export {inventoryUnchangedDeletion} from './mumu-inventory-effect.mjs';

export function deriveInventory(state,{snapshotId,visitIds,now=Date.now(),maxAgeMs=300000,eventTracked=false}={}){
  if(!integer(state.revision))fail('SOURCE_REVISION_INVALID');
  const barn=snapshotId!==undefined||visitIds!==undefined?barnCoverage(state,{snapshotId,visitIds,now,maxAgeMs,eventTracked}):
    {items:[],inventory:{},capacity:{readComplete:false,usedCapacity:null,totalCapacity:null,freeCapacity:null,overCapacity:null,
      source:null,frameIds:[],fresh:false},coverage:'partial',readComplete:false,fresh:false,pages:[]},items={};
  for(const item of barn.items){
    if(!id(item.itemId)||!Object.hasOwn(barn.inventory,item.itemId))continue;
    const frame=state.frames[item.frameId];
    const validity=eventTracked?{untilChange:true}:undefined;
    const invalidated=!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence;
    items[item.itemId]={itemId:item.itemId,quantity:item.quantity,observedAt:item.observedAt,...validity?{validity}:{},invalidated,
      source:{frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,epoch:frame.epoch,kind:'barn_quantity'},status:invalidated?'invalidated':'confirmed',fresh:evidenceWindow({...item,validity,invalidated},{now,maxAgeMs}).valid};
  }
  // Each displayed owned count is an absolute stock observation. Harvest all
  // known rows, including shortages; absent products remain unknown.
  const frames=Object.values(state.frames??{}).filter(f=>acceptedFacts(f)&&['airport','train','helicopter'].includes(f.review.actualKind))
    .sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.sequence-b.sequence);
  for(const frame of frames){
    const order=frame.review.data?.order;
    if(order?.kind!=='normal'||!Array.isArray(order.needs)||!Number.isFinite(Date.parse(frame.observedAt))||Date.parse(frame.observedAt)>now)continue;
    const rows=new Map(),conflicts=new Set();
    for(const need of order.needs){
      if(!id(need.itemId)||!integer(need.owned))continue;
      if(rows.has(need.itemId)&&rows.get(need.itemId)!==need.owned)conflicts.add(need.itemId);
      rows.set(need.itemId,need.owned);
    }
    for(const [itemId,quantity] of rows){
      const old=items[itemId];
      if(old&&(Date.parse(old.observedAt)>Date.parse(frame.observedAt)||
          Date.parse(old.observedAt)===Date.parse(frame.observedAt)&&old.source.sequence>frame.sequence))continue;
      const invalidated=!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence;
      const validity=eventTracked?{untilChange:true}:undefined;
      items[itemId]={itemId,quantity,observedAt:frame.observedAt,...validity?{validity}:{},invalidated,
        source:{frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,epoch:frame.epoch,kind:'order_owned',orderId:order.orderId},
        status:invalidated?'invalidated':conflicts.has(itemId)?'conflict':'confirmed',
        fresh:!conflicts.has(itemId)&&evidenceWindow({observedAt:frame.observedAt,validity,invalidated},{now,maxAgeMs}).valid};
    }
  }
  const unresolved=Object.values(state.actions??{}).filter(isUnresolvedAction).map(a=>a.id);
  return {schema:1,revision:0,sourceRevision:state.revision,snapshotId,createdAt:new Date(now).toISOString(),
    items,capacity:barn.capacity,coverage:barn.coverage,readComplete:barn.readComplete,fresh:barn.fresh,
    pages:barn.pages,reservations:[],appliedActions:[],holdReasons:unresolved.length||state.input?['INPUT_UNRESOLVED']:[],
    unresolvedActions:unresolved,executionAllowed:false};
}

export function allocateInventory(projection,orders,{expectedRevision,now=Date.now(),maxAgeMs=300000}={}){
  checkRevision(projection,expectedRevision);timeOptions(now,maxAgeMs);
  if(!Array.isArray(orders)||orders.length>100)fail('ORDERS_INVALID');
  const seen=new Set(),priority={plane:0,train:1,helicopter:2};
  for(const order of orders){
    if(!id(order?.orderId)||seen.has(order.orderId)||!Object.hasOwn(priority,order.transport)||!Array.isArray(order.items)||!order.items.length)fail('ORDER_INVALID');
    seen.add(order.orderId);
    for(const item of order.items)if(!(item.itemId===null||id(item.itemId))||!(item.quantity===null||Number.isSafeInteger(item.quantity)&&item.quantity>0))fail('ORDER_ITEM_INVALID');
    if(projection.reservations.some(r=>r.orderId===order.orderId))fail('RESERVATION_ORDER_EXISTS');
    if(order.deadline!==undefined&&!Number.isFinite(Date.parse(order.deadline)))fail('ORDER_DEADLINE_INVALID');
  }
  const output=structuredClone(projection),available={},evaluations=[];
  for(const [itemId,item] of Object.entries(output.items)){
    if(item.status==='confirmed'&&integer(item.quantity)&&evidenceWindow(item,{now,maxAgeMs}).valid)available[itemId]=item.quantity;
  }
  for(const reservation of output.reservations){
    if(Object.hasOwn(available,reservation.itemId))available[reservation.itemId]=Math.max(0,available[reservation.itemId]-reservation.quantity);
  }
  const deadline=order=>{
    const window=evidenceWindow({...order,observedAt:order.source?.observedAt},{now,maxAgeMs});
    return window.basis==='observed_deadline'?Date.parse(window.validUntil):Infinity;
  };
  const sorted=[...orders].sort((a,b)=>priority[a.transport]-priority[b.transport]||deadline(a)-deadline(b));
  for(const order of sorted){
    const reasons=[...output.holdReasons];
    const confirmedSource=order.confirmed===true&&id(order.source?.frameId)&&/^[a-f0-9]{64}$/.test(order.source?.evidenceHash??'')&&evidenceWindow({...order,observedAt:order.source?.observedAt},{now,maxAgeMs}).valid;
    if(!confirmedSource)reasons.push('ORDER_UNCONFIRMED_OR_STALE');
    if(order.deadline&&Date.parse(order.deadline)<=now)reasons.push('ORDER_EXPIRED');
    if(order.operation!=='load_from_inventory')reasons.push('OPERATION_UNSUPPORTED');
    const disposition=orderDisposition(order.items.map(i=>({itemId:i.itemId,required:i.quantity})));
    if(disposition==='delete'){
      evaluations.push({orderId:order.orderId,transport:order.transport,status:reasons.length?'hold':'delete',disposition,
        reasons:[...new Set(reasons)],items:order.items.map(i=>({itemId:i.itemId,required:i.quantity,reserved:0})),executionAllowed:false});
      continue;
    }
    const demand=new Map();
    for(const item of order.items){
      if(item.itemId===null||item.quantity===null){reasons.push('ORDER_ITEM_UNKNOWN');continue;}
      const next=(demand.get(item.itemId)??0)+item.quantity;if(!Number.isSafeInteger(next))fail('QUANTITY_OVERFLOW');demand.set(item.itemId,next);
    }
    const rows=[],reservationStart=output.reservations.length;
    for(const [itemId,required] of demand){
      const known=Object.hasOwn(available,itemId),owned=known?available[itemId]:null;
      if(!known)reasons.push('STOCK_UNKNOWN_OR_STALE');
      // Protect remaining goods for higher-priority incomplete plane/train orders.
      const reserve=known&&!output.holdReasons.length&&confirmedSource&&order.operation==='load_from_inventory'&&
        !(order.deadline&&Date.parse(order.deadline)<=now)?Math.min(owned,required):0;
      if(reserve){output.reservations.push({orderId:order.orderId,itemId,quantity:reserve,transport:order.transport});available[itemId]-=reserve;}
      rows.push({itemId,required,availableBefore:owned,reserved:reserve,shortage:owned===null?null:Math.max(0,required-owned)});
    }
    const status=reasons.length?'hold':rows.some(r=>r.shortage>0)?'shortage':'feasible';
    // Helicopters dispatch a whole order. Incomplete orders must not consume
    // allocation needed by feasible peers; plane/train partial reserves stay protected.
    if(order.transport==='helicopter'&&status!=='feasible'){
      for(const reservation of output.reservations.splice(reservationStart))available[reservation.itemId]+=reservation.quantity;
      for(const row of rows)row.reserved=0;
    }
    evaluations.push({orderId:order.orderId,transport:order.transport,status,reasons:[...new Set(reasons)],items:rows,executionAllowed:false});
  }
  output.revision++;return {projection:output,evaluations,executionAllowed:false};
}

export function releaseReservations(projection,orderIds,{expectedRevision}={}){
  checkRevision(projection,expectedRevision);
  if(!Array.isArray(orderIds)||!orderIds.every(id))fail('ORDER_IDS_INVALID');
  const output=structuredClone(projection);output.reservations=output.reservations.filter(r=>!orderIds.includes(r.orderId));output.revision++;return output;
}

export function applyConfirmedInventoryAction(projection,state,actionId,{expectedRevision,now=Date.now(),maxAgeMs=300000}={}){
  checkRevision(projection,expectedRevision);timeOptions(now,maxAgeMs);
  if(!id(actionId))fail('ACTION_ID_INVALID');
  if(projection.appliedActions.includes(actionId))return {projection:structuredClone(projection),duplicate:true};
  const action=state.actions?.[actionId],frame=state.frames?.[action?.resultFrameId],effect=actionEffect(state,action);
  const inventoryUnchanged=inventoryUnchangedDeletion(state,action,effect);
  if(action?.status!=='verified'||action.management!==true||effect?.confirmed!==true||effect.actionId!==actionId||effect.frameId!==frame.id||
      !fresh(frame.observedAt,now,maxAgeMs)||!Array.isArray(effect.inventoryDeltas)||!effect.inventoryDeltas.length&&!inventoryUnchanged)fail('CONFIRMED_NUMERIC_EFFECT_REQUIRED');
  const output=structuredClone(projection),seen=new Set();
  validateNumericMetadata(effect);
  for(const delta of effect.inventoryDeltas){
    if(!id(delta?.itemId)||seen.has(delta.itemId)||!integer(delta.before)||!integer(delta.after))fail('INVENTORY_EFFECT_INVALID');seen.add(delta.itemId);
    const item=output.items[delta.itemId];
    if(!item||item.status!=='confirmed'||item.quantity!==delta.before||Date.parse(frame.observedAt)<=Date.parse(item.observedAt))fail('INVENTORY_EFFECT_CONFLICT');
    item.quantity=delta.after;item.observedAt=frame.observedAt;item.fresh=true;item.source={frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,epoch:frame.epoch,actionId};
  }
  // Numerical stock change does not prove the displayed barn header or remaining
  // allocations. Rebuild allocations against the new source revision.
  output.reservations=[];output.holdReasons=[...new Set([...output.holdReasons,'REALLOCATION_REQUIRED'])];
  if(!inventoryUnchanged)output.capacity=advanceCapacity(output.capacity,{...effect,observedAt:frame.observedAt,frameId:frame.id,actionId},
    {now,maxAgeMs,eventTracked:Object.values(projection.items).every(i=>i.validity?.untilChange===true)});
  output.appliedActions.push(actionId);output.sourceRevision=state.revision;output.revision++;
  return {projection:output,duplicate:false};
}
