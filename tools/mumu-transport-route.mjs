// Observation memory only. Route choices never authorize input or stock effects.
import {digest} from './adb.mjs';
const sha=v=>digest(Buffer.from(JSON.stringify(v)));
import {transportKind,TRANSPORT_PRIORITY as priority} from './mumu-transport-kind.mjs';
export {transportKind} from './mumu-transport-kind.mjs';
const sorted=a=>a.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function transportDemandFingerprint(allocation,kind){
  const orders=(allocation.orders??[]).filter(o=>transportKind(o.transport??o.kind)===kind);
  const evaluations=(allocation.evaluations??[]).filter(o=>transportKind(o.transport??o.kind)===kind);
  const needs=sorted(orders.map(o=>({items:o.items,operation:o.operation,confirmed:o.confirmed,deadline:o.deadline}))),ids=new Set(orders.flatMap(o=>(o.items??[]).map(n=>n.itemId)));
  const items=Object.entries(allocation.projection?.items??{}).filter(([id])=>ids.has(id)).map(([id,i])=>[id,i.quantity,i.status,i.fresh]);
  // Exclude frame IDs, source revisions, timestamps and order IDs: none changes
  // a product requirement, available quantity, or a reservation decision.
  const reservations=sorted((allocation.projection?.reservations??[]).filter(r=>ids.has(r.itemId)).map(r=>({itemId:r.itemId,quantity:r.quantity,status:r.status,transport:transportKind(r.transport??r.kind)})));
  return sha({needs,items:sorted(items),reservations,config:allocation.config,
    evaluations:sorted(evaluations.map(e=>({status:e.status,items:e.items,reasons:e.reasons}))) });
}
export function routeBinding(state,release,profile){
  return sha({session:state.session.id,policy:state.session.management,deliveryScope:{helicopterOnly:state.settings?.helicopterOnly===true,afterSequence:state.settings?.deliveryScopeAfterSequence??-1},release,profile,invalidation:state.observationInvalidation??null});
}
export function rememberTransport(memory,{kind,frame,allocation,timers=[],phase,executionHold=null},now){
  if(!priority.includes(kind)||!['exhausted','transit'].includes(phase)||!frame?.evidenceHash||!Number.isFinite(Date.parse(frame.observedAt))||Date.parse(frame.observedAt)>now)
    throw Error('ROUTE_OBSERVATION_REQUIRED');
  // Only helicopter cooldowns keep an observed-time wake. Transport arrivals
  // are driven by visual indicators, including when old callers pass timers.
  const originals=kind==='helicopter'?timers:[];
  for(const t of originals)if(!t.frameId||!Number.isFinite(Date.parse(t.until))||Date.parse(t.until)<Date.parse(t.observedAt))throw Error('ROUTE_TIMER_INVALID');
  memory[kind]={kind,phase,frameId:frame.id,evidenceHash:frame.evidenceHash,observedAt:frame.observedAt,
    fingerprint:transportDemandFingerprint(allocation,kind),journeyKey:frame.journeyKey??null,timers:structuredClone(originals),
    checkedAt:now,...(executionHold?{executionHold:structuredClone(executionHold)}:{}),executionAllowed:false};
  return memory[kind];
}
export function endObservedTransit(memory,{kind,frame,rows=[]},now){
  const prior=memory[kind];if(!prior)return null;
  if(!['train','airport'].includes(kind)||!frame?.evidenceHash||Date.parse(frame.observedAt)>now||!Number.isFinite(Date.parse(frame.observedAt))||
    (kind==='train'&&(!rows.length||rows.some(row=>![1,2,3].includes(row)))))throw Error('ROUTE_ACTIVE_OBSERVATION_REQUIRED');
  const changedRows=[...new Set([...(prior.retiredRows??[]),...rows])].sort();
  if(prior.phase==='active'&&JSON.stringify(changedRows)===JSON.stringify(prior.retiredRows))return null;
  memory[kind]={...prior,phase:'active',frameId:frame.id,evidenceHash:frame.evidenceHash,observedAt:frame.observedAt,
    journeyKey:null,retiredRows:changedRows,timers:[],
    checkedAt:now,executionAllowed:false};
  return memory[kind];
}
export function chooseTransport(memory,allocation,{current=null,helicopterReady=false,readyKinds=[],returnToTown=false,availableKinds=priority,executionHolds={},now=Date.now()}={}){
  if(allocation.requiresSync!==false||allocation.holdReasons?.length||allocation.projection?.holdReasons?.length)return null;
  const feasible=new Set((allocation.evaluations??[]).filter(e=>e.status==='feasible').map(e=>transportKind(e.transport??e.kind)));
  const held=kind=>{
    const h=executionHolds[kind]??memory[kind]?.executionHold;
    return h?.kind===kind&&h.scope==='transport'&&h.executionAllowed===false&&h.fingerprint===transportDemandFingerprint(allocation,kind);
  };
  if(feasible.has(current)&&!held(current))return null; // Finish executable current work first.
  const available=new Set(availableKinds);
  const choice=(kind,reason)=>({kind,reason,executionAllowed:false});
  for(const kind of priority)if(kind!==current&&available.has(kind)&&feasible.has(kind)&&!held(kind))return choice(kind,'KNOWN_FEASIBLE_WORK');
  for(const kind of priority){
    const r=memory[kind];if(kind===current||!available.has(kind)||!r)continue;
    if(kind==='helicopter'&&r.timers.some(t=>Date.parse(t.until)<=now&&r.checkedAt< Date.parse(t.until)||Date.parse(t.until)<=r.checkedAt&&r.checkedAt+30000<=now))return choice(kind,'ORIGINAL_TIMER_DUE');
    if(r.phase==='exhausted'&&r.fingerprint!==transportDemandFingerprint(allocation,kind))return choice(kind,'RELEVANT_ALLOCATION_CHANGED');
  }
  for(const kind of priority)if(kind!==current&&available.has(kind)&&readyKinds.includes(kind))return choice(kind,'VISIBLE_ARRIVAL_INDICATOR');
  if(current!=='helicopter'&&available.has('helicopter')&&helicopterReady&&!memory.helicopter)return choice('helicopter','READY_HELICOPTER_OBSERVATION');
  for(const kind of ['train','airport'])if(kind!==current&&available.has(kind)&&!memory[kind])return choice(kind,'INITIAL_TRANSPORT_OBSERVATION');
  if(returnToTown&&current&&current!=='town')return choice('town','OBSERVE_ARRIVAL_INDICATORS');
  return null;
}
export function routeObservationDeadline(memory,current,now){
  const deadlines=Object.values(memory).filter(r=>r.kind==='helicopter'&&r.kind!==current).flatMap(r=>r.timers.map(t=>Math.max(Date.parse(t.until),r.checkedAt>=Date.parse(t.until)?r.checkedAt+30000:0)));
  return deadlines.length?Math.max(now,Math.min(...deadlines)):Infinity;
}
