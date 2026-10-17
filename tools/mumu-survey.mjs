// Information-only: these functions never purchase, send, delete, or reserve goods.
import { barnCoverage,barnEvidenceFresh,barnQuantity } from './mumu-barn.mjs';
import {evidenceWindow} from './mumu-freshness.mjs';
const fail=code=>{throw Error(code);};
const integer=n=>Number.isSafeInteger(n) && n>=0;
const id=s=>typeof s==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function reviewedVisit(state,visitId,kind,dataField) {
  return Object.values(state.frames).filter(f=>f.sceneId===visitId && f.review?.status==='accepted' && f.review.actualKind===kind && f.review.data[dataField])
    .sort((a,b)=>b.sequence-a.sequence)[0]??null;
}
function validSlot(s) {
  return s && integer(s.index) && (s.itemId===null || id(s.itemId)) && (s.quantity===null || (integer(s.quantity) && s.quantity>0)) &&
    (s.price===null || integer(s.price)) && [null,'COIN','TCASH'].includes(s.currency) && ['available','sold','unknown'].includes(s.status);
}
const slotIdentity=s=>({index:s.index,itemId:s.itemId,quantity:s.quantity,price:s.price,currency:s.currency,status:s.status});

export function marketCoverage(state,{roundId,visitIds}={}) {
  if(!id(roundId) || !Array.isArray(visitIds) || new Set(visitIds).size!==visitIds.length || !visitIds.every(id))fail('MARKET_SURVEY_INVALID');
  const reasons=[],pages=[],slots=new Map();let previous=null;
  for(const visitId of visitIds) {
    const frame=reviewedVisit(state,visitId,'market','market'),page=frame?.review.data.market;
    if(!frame || !page){reasons.push({visitId,reason:'unreviewed_page'});previous=null;continue;}
    if(page.roundId!==roundId){reasons.push({visitId,reason:'market_round_changed'});previous=null;continue;}
    if(!Array.isArray(page.slots) || !page.slots.length || !page.slots.every(validSlot) || new Set(page.slots.map(s=>s.index)).size!==page.slots.length)fail('MARKET_PAGE_INVALID');
    const indices=page.slots.map(s=>s.index).sort((a,b)=>a-b);
    if(indices.some((n,i)=>i && n!==indices[i-1]+1))reasons.push({visitId,reason:'page_slot_gap'});
    if(previous && !indices.some(i=>previous.includes(i)))reasons.push({visitId,reason:'overlap_unverified'});
    if(previous && indices.at(-1)<previous.at(-1))reasons.push({visitId,reason:'scroll_order_reversed'});
    for(const slot of page.slots) {
      const value=slotIdentity(slot),old=slots.get(slot.index);
      if(old && !equal(old,value))reasons.push({visitId,reason:'overlapping_slot_conflict',index:slot.index});
      else slots.set(slot.index,value);
    }
    pages.push({visitId,frameId:frame.id,observedAt:frame.observedAt,
      ...(page.deadline!==undefined?{deadline:page.deadline}:{}),...(page.remainingSeconds!==undefined?{remainingSeconds:page.remainingSeconds}:{}),
      invalidated:!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence,page});previous=indices;
  }
  const ordered=[...slots.values()].sort((a,b)=>a.index-b.index);
  if(!visitIds.length || pages.length!==visitIds.length)reasons.push({reason:'pages_incomplete'});
  if(!pages[0]?.page.atLeftBoundary || !ordered.length || ordered[0].index!==0)reasons.push({reason:'left_boundary_unverified'});
  if(!pages.at(-1)?.page.atRightBoundary)reasons.push({reason:'right_boundary_unverified'});
  if(ordered.some((s,i)=>s.index!==i))reasons.push({reason:'slot_coverage_gap'});
  const unreadable=ordered.filter(s=>s.status==='unknown' || (s.status==='available' && [s.itemId,s.quantity,s.price,s.currency].some(x=>x===null))).map(s=>s.index);
  return {roundId,coverage:reasons.length?'partial':'complete',readComplete:reasons.length===0 && unreadable.length===0,
    expectedPages:visitIds.length,reviewedPages:pages.length,slotCount:ordered.length,reasons,unreadableSlots:unreadable,
    pages:pages.map(({page,...meta})=>meta),slots:ordered,
    offers:ordered.filter(s=>s.status==='available' && !unreadable.includes(s.index)).map(s=>({offerId:roundId+'.slot-'+s.index,itemId:s.itemId,quantity:s.quantity,price:s.price,currency:s.currency})),executionAllowed:false};
}

function validNeed(n){return n && (n.itemId===null || id(n.itemId)) && (n.required===null || (integer(n.required) && n.required>0)) && (n.owned===null || integer(n.owned));}
export function helicopterCoverage(state,{customerIds,visitIds}={}) {
  if(!Array.isArray(customerIds) || !customerIds.length || !customerIds.every(id) || new Set(customerIds).size!==customerIds.length || !Array.isArray(visitIds) || !visitIds.every(id))fail('HELICOPTER_SURVEY_INVALID');
  const found=new Map(),reasons=[];
  for(const visitId of visitIds) {
    const frame=reviewedVisit(state,visitId,'helicopter','order'),customer=frame?.review.actualEntityId,order=frame?.review.data.order;
    if(!frame || !customer || !customerIds.includes(customer) || !order){reasons.push({visitId,reason:'customer_detail_unverified'});continue;}
    if(!id(order.orderId) || !['normal','special'].includes(order.kind) || !Array.isArray(order.needs) || !order.needs.length || !order.needs.every(validNeed) || new Set(order.needs.map(n=>n.itemId).filter(x=>x!==null)).size!==order.needs.filter(n=>n.itemId!==null).length)fail('HELICOPTER_ORDER_INVALID');
    if(!found.has(customer) || found.get(customer).sequence<frame.sequence)found.set(customer,{...structuredClone(order),customerId:customer,frameId:frame.id,sequence:frame.sequence,observedAt:frame.observedAt,
      invalidated:!!state.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence});
  }
  const missing=customerIds.filter(c=>!found.has(c));
  const orders=customerIds.filter(c=>found.has(c)).map(c=>found.get(c));
  const unreadable=orders.filter(o=>o.needs.some(n=>[n.itemId,n.required,n.owned].some(v=>v===null))).map(o=>o.customerId);
  return {coverage:missing.length || reasons.length?'partial':'complete',readComplete:missing.length===0 && reasons.length===0 && unreadable.length===0,
    expectedCustomers:customerIds.length,reviewedCustomers:orders.length,missingCustomers:missing,unreadableCustomers:unreadable,reasons,orders,executionAllowed:false};
}

// Each shelf slot is an indivisible bundle that can be proposed once.
function bundleOptions(offers,required,{budget,capacity}={}) {
  if(!integer(required) || !integer(budget) || !integer(capacity) || !Array.isArray(offers) || offers.length>200)fail('BUNDLE_PLAN_INVALID');
  if(new Set(offers.map(o=>o.offerId)).size!==offers.length)fail('BUNDLE_OFFER_DUPLICATE');
  if(required===0)return [{cost:0,units:0,offers:[]}];
  if(required>capacity)return [];
  let plans=new Map([[0,{cost:0,units:0,offers:[]}]]);
  for(const offer of offers) {
    if(!id(offer.offerId) || !integer(offer.quantity) || !offer.quantity || !integer(offer.price) || offer.currency!=='COIN')fail('BUNDLE_OFFER_INVALID');
    const next=new Map(plans);
    for(const p of plans.values()) {
      const units=p.units+offer.quantity,cost=p.cost+offer.price;
      if(!Number.isSafeInteger(units) || !Number.isSafeInteger(cost) || units>capacity || cost>budget)continue;
      const old=next.get(units);if(!old || cost<old.cost)next.set(units,{units,cost,offers:[...p.offers,offer]});
    }
    plans=next;
    if(plans.size>100000)fail('BUNDLE_PLAN_TOO_LARGE');
  }
  return [...plans.values()].filter(p=>p.units>=required).sort((a,b)=>a.cost-b.cost || a.units-b.units);
}
export function bundlePlan(offers,required,limits={}) {return bundleOptions(offers,required,limits)[0]??null;}

export function judgeOrder(order,{market,barn=null,protectedStock={},higherPriorityComplete=false,coinBudget=null,freeCapacity=null,
  policy={marketSources:null,decideAt:null},maxAgeMs=300000,now=Date.now()}={}) {
  if(!order || !Array.isArray(order.needs) || !order.needs.every(validNeed))fail('ORDER_INVALID');
  const base={customerId:order.customerId,orderId:order.orderId,executionAllowed:false,scope:'individual_order_feasibility',
    ...(barn?{inventorySource:{kind:'barn',snapshotId:barn.snapshotId}}:{})};
  const hold=(reason,extra={})=>({...base,decision:'hold',reason,...extra});
  if(order.kind!=='normal')return hold('special_order_policy_unconfirmed');
  if(!Number.isFinite(now) || !integer(maxAgeMs))fail('FRESHNESS_INVALID');
  if(!evidenceWindow(order,{now,maxAgeMs}).valid)return hold('requirements_stale');
  if(!higherPriorityComplete)return hold('higher_priority_inventory_unverified');
  if(order.needs.some(n=>n.itemId===null || n.required===null))return hold('requirements_or_inventory_unreadable');
  let needs=order.needs;
  if(barn){
    if(!barnEvidenceFresh(barn,{now,maxAgeMs}))return hold('barn_stale_or_incomplete');
    if(barn.reasons.some(r=>['overlapping_item_conflict','duplicate_item_identity','capacity_changed_during_scan'].includes(r.reason)))return hold('barn_observations_conflict');
    needs=[];
    for(const n of order.needs){
      const owned=barnQuantity(barn,n.itemId);
      if(!integer(owned))return hold('barn_item_unverified',{itemId:n.itemId});
      if(n.owned!==null && n.owned!==owned)return hold('inventory_observations_conflict',{itemId:n.itemId,orderOwned:n.owned,barnOwned:owned});
      needs.push({...n,owned});
    }
    // A caller-provided capacity never overrides an unreadable or stale barn header.
    freeCapacity=barn.capacity.readComplete?barn.capacity.freeCapacity:null;
  }else if(needs.some(n=>n.owned===null))return hold('requirements_or_inventory_unreadable');
  const shortages=[];
  for(const n of needs) {
    const reserved=protectedStock[n.itemId]??0;if(!integer(reserved))return hold('protected_inventory_unreadable');
    const available=Math.max(0,n.owned-reserved),shortage=Math.max(0,n.required-available);
    if(shortage)shortages.push({itemId:n.itemId,quantity:shortage,available,required:n.required});
  }
  if(!shortages.length)return {...base,decision:'keep',reason:'stock_sufficient',shortages:[]};
  if(market?.coverage!=='complete' || !market.readComplete)return hold('market_survey_incomplete',{shortages});
  if(market.pages.some(p=>!evidenceWindow(p,{now,maxAgeMs}).valid))return hold('market_stale',{shortages});
  const missing=shortages.filter(n=>market.offers.filter(o=>o.itemId===n.itemId && o.currency==='COIN').reduce((a,o)=>a+o.quantity,0)<n.quantity);
  if(missing.length){
    if(policy.marketSources!=='shelves')return hold('dealer_scope_or_quote_unconfirmed',{shortages,missingFromShelves:missing});
    if(policy.decideAt!=='current_market')return hold(policy.decideAt==='next_free_refresh'?'wait_for_market_refresh':'decision_time_unconfirmed',{shortages});
    return {...base,decision:'delete_candidate',reason:'current_market_cannot_replenish',shortages,missingFromShelves:missing};
  }
  if(!integer(coinBudget) || !integer(freeCapacity))return hold('budget_or_capacity_unverified',{shortages});
  // Keep cost/capacity alternatives so an inexpensive oversized bundle cannot hide a feasible small bundle.
  let combinations=[{cost:0,units:0,offers:[]}];
  for(const shortage of shortages){
    const offers=market.offers.filter(o=>o.itemId===shortage.itemId && o.currency==='COIN');
    const choices=bundleOptions(offers,shortage.quantity,{budget:coinBudget,capacity:freeCapacity});
    const next=[];
    for(const prior of combinations)for(const p of choices){const cost=prior.cost+p.cost,units=prior.units+p.units;if(cost<=coinBudget && units<=freeCapacity)next.push({cost,units,offers:[...prior.offers,...p.offers]});}
    const best=new Map();for(const p of next)if(!best.has(p.units) || p.cost<best.get(p.units).cost)best.set(p.units,p);
    combinations=[...best.values()];if(!combinations.length)return hold('budget_or_storage_limits',{shortages});
  }
  const proposedPurchase=combinations.sort((a,b)=>a.cost-b.cost || a.units-b.units)[0];
  return {...base,decision:'keep',reason:'market_replenishment_possible',shortages,proposedPurchase};
}

export function surveyReport(state,{market:marketArgs,helicopter:helicopterArgs,barn:barnArgs=null,...options}={}) {
  const market=marketCoverage(state,marketArgs),helicopter=helicopterCoverage(state,helicopterArgs);
  const barn=barnArgs?barnCoverage(state,{...barnArgs,now:options.now??Date.now(),maxAgeMs:options.maxAgeMs??300000}):null;
  const decisions=helicopter.orders.map(order=>judgeOrder(order,{market,...options,barn}));
  const sharedResources=[];
  const consumers=new Map();
  for(const d of decisions.filter(d=>d.decision==='keep')){
    const order=helicopter.orders.find(o=>o.orderId===d.orderId);
    for(const n of order.needs)if(n.itemId){const ids=consumers.get(n.itemId)??[];ids.push(d.orderId);consumers.set(n.itemId,ids);}
  }
  for(const [itemId,orderIds]of consumers)if(orderIds.length>1)sharedResources.push({itemId,orderIds,reason:'individual_feasibility_does_not_allocate_shared_inventory_or_shelves'});
  return {sessionId:state.session.id,generatedAt:new Date(options.now??Date.now()).toISOString(),market,helicopter,decisions,sharedResources,
    barn,policy:options.policy??{marketSources:null,decideAt:null},mode:'information_only',executionAllowed:false,reservationsCommitted:false};
}
