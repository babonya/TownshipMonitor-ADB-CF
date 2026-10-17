import {isUnresolvedAction,terminalTransportMission} from './mumu-input-state.mjs';
import {cupBoundaryTown} from './mumu-cup-budget.mjs';
import {currentScreenOrders} from './mumu-current-needs.mjs';
import {evidenceDependencyGraph} from './mumu-evidence-dependencies.mjs';

export const MAX_RETAINED_FRAMES=100;
export const MAX_RETAINED_ACTIONS=100;
export const MAX_RETAINED_VISITS=100;
const terminal=new Set(['verified','rejected_before_input','externally_superseded','resolved_code_path_audit','superseded_on_restart','superseded_by_observation']);
const consumedKinds=new Set(['barn_sell','send_helicopter','delete_helicopter','load_train','load_airport','send_train','send_airport']);
const recentActions=(a,b)=>(Date.parse(b.finishedAt??b.at)||0)-(Date.parse(a.finishedAt??a.at)||0)||b.id.localeCompare(a.id);

// Retain live proof dependencies before selecting recent history. No archives,
// deleted-ID index, tombstones, source rewriting or game input are produced.
export function retainStateRecords(state,{now=Date.now()}={}){
  const frames=state.frames??{},actions=state.actions??{},visits=state.visits??{};
  const prior=state.retention;
  const counts={frames:Object.keys(frames).length,actions:Object.keys(actions).length,visits:Object.keys(visits).length};
  if(counts.frames<=MAX_RETAINED_FRAMES&&counts.actions<=MAX_RETAINED_ACTIONS&&counts.visits<=MAX_RETAINED_VISITS){
    if(prior?.overflow)state.retention={...prior,overflow:false};
    return {removedFrames:0,removedActions:0,overflow:false};
  }
  // Both native PC and Android SOM use current-screen evidence. Keep legacy
  // accounting intact for providers/modes that still require its journal.
  const currentScreen=state.session?.provider==='google_play_windows'||
    state.session?.provider==='android_adb'&&state.settings?.workflowMode==='som';
  if(!currentScreen){
    state.retention={schema:1,maxFrames:100,maxActions:100,overflow:true,reason:'LEGACY_HISTORY_REQUIRED'};
    return {removedFrames:0,removedActions:0,overflow:true};
  }
  const keepF=new Set(),keepA=new Set(),keepV=new Set();
  const dependencies=evidenceDependencyGraph(frames,actions,visits);
  const closure=(value,fs=keepF,as=keepA,vs=keepV)=>dependencies.include(value,fs,as,vs);
  closure([state.input,state.latestFrameId,state.latestCandidateFrameId,state.scene,
    state.barnRecovery?.active,state.visits?.[state.scene?.id],state.observationRefresh,state.marketView,state.observationWait,state.orderDemandStartup?.pending]);
  for(const a of Object.values(actions))if(isUnresolvedAction(a)||!terminal.has(a.status))closure(a.id);
  // Budget and predecessor proofs remain live until their operating policy
  // retires them. Dropping an attempt must never restore a consumed budget.
  for(const a of Object.values(actions))if(a.target?.kind==='claim_mayors_cup_reward'||a.target?.helicopterSelection||
    a.target?.eventClose&&frames[a.frameId]?.sceneId===state.scene?.id)closure(a.id);
  for(const r of Object.values(state.helicopterRounds??{}))if(!['boundary','complete'].includes(r.status))closure(r);
  for(const m of Object.values(state.transportMissions??{}))if(!terminalTransportMission(m)||m.waitingActionId)closure(m);
  for(const f of Object.values(frames))if(f.job?.status==='processing'||
    ['ready','deferred'].includes(f.job?.status)&&f.epoch===state.scene?.epoch)closure(f.id);
  const ordered=Object.values(actions).sort(recentActions);
  if(ordered[0])closure(ordered[0].id); // Never evict the transaction's latest result.
  const orders=currentScreenOrders(state,{now});
  closure(orders);
  const invalid=Math.max(state.observationInvalidation?.sequence??-1,state.orderDemandStartup?.cutoffSequence??-1);
  // Keep the latest consumption fence even when its order is no longer active.
  const consumption=ordered.filter(a=>a.status==='verified'&&consumedKinds.has(a.target?.kind)&&frames[a.frameId]?.sequence>invalid)
    .sort((a,b)=>frames[b.frameId].sequence-frames[a.frameId].sequence)[0];
  if(consumption)closure(consumption.id);
  const marketClose=ordered.filter(a=>a.status==='verified'&&a.target?.marketNative?.role==='close'&&a.target.kind==='close_panel'&&
    frames[a.frameId]?.sequence>invalid).sort((a,b)=>(frames[b.resultFrameId]?.sequence??-1)-(frames[a.resultFrameId]?.sequence??-1))[0];
  if(marketClose)closure(marketClose.id);
  // Older same-signature reads may supply missing current owned quantities.
  for(const order of orders){const f=frames[order.frameId];
    if(f?.review?.data?.order?.needs?.some(n=>n.owned===null||n.owned===undefined))
      for(const old of Object.values(frames))if(old.sequence>invalid&&old.review?.data?.order?.orderId===order.orderId&&
        old.review.data.order.signature===order.signature)closure(old.id);
  }
  // A completed Cup result needs a later accepted town witness to identify a
  // new event. Retain a witness while that result participates in the budget.
  for(const a of Object.values(actions))if(a.target?.kind==='claim_mayors_cup_reward'&&a.status==='verified'){
    const result=frames[a.resultFrameId];
    for(const currentId of new Set([state.latestFrameId,...Object.values(actions).filter(a=>isUnresolvedAction(a)).map(a=>a.frameId)])){
      const town=cupBoundaryTown(state,result,frames[currentId]);if(town)closure(town.id);
    }
  }
  const protectedFrames=keepF.size,protectedActions=keepA.size,protectedVisits=keepV.size;
  const addRecent=id=>{
    const fs=new Set(keepF),as=new Set(keepA),vs=new Set(keepV);closure(id,fs,as,vs);
    if(fs.size>MAX_RETAINED_FRAMES||as.size>MAX_RETAINED_ACTIONS||vs.size>MAX_RETAINED_VISITS)return;
    for(const key of fs)keepF.add(key);for(const key of as)keepA.add(key);for(const key of vs)keepV.add(key);
  };
  for(const a of ordered)addRecent(a.id);
  for(const f of Object.values(frames).sort((a,b)=>b.sequence-a.sequence))addRecent(f.id);
  for(const [id] of Object.entries(visits).sort((a,b)=>(Date.parse(b[1].startedAt)||0)-(Date.parse(a[1].startedAt)||0)||b[0].localeCompare(a[0])))addRecent(id);
  const view={...state,frames:Object.fromEntries(Object.entries(frames).filter(([id])=>keepF.has(id))),
    actions:Object.fromEntries(Object.entries(actions).filter(([id])=>keepA.has(id)))};
  // A changed current-order projection means an unhandled dependency. Keep
  // its evidence, report the limit exception and never weaken a stock guard.
  if(JSON.stringify(currentScreenOrders(view,{now}))!==JSON.stringify(orders)){
    state.retention={schema:1,maxFrames:100,maxActions:100,overflow:true,reason:'CURRENT_ORDER_DEPENDENCY_REQUIRED'};
    return {removedFrames:0,removedActions:0,overflow:true};
  }
  const removedFrames=counts.frames-keepF.size,removedActions=counts.actions-keepA.size,removedVisits=counts.visits-keepV.size;
  for(const id of Object.keys(frames))if(!keepF.has(id))delete frames[id];
  for(const id of Object.keys(actions))if(!keepA.has(id))delete actions[id];
  for(const id of Object.keys(visits))if(!keepV.has(id))delete visits[id];
  const overflow=keepF.size>100||keepA.size>100||keepV.size>100;
  state.retention={schema:1,maxFrames:100,maxActions:100,maxVisits:100,overflow,protectedFrames,protectedActions,protectedVisits,
    removedFrames:(prior?.removedFrames??0)+removedFrames,removedActions:(prior?.removedActions??0)+removedActions,
    removedVisits:(prior?.removedVisits??0)+removedVisits,
    ...overflow?{reason:'ACTIVE_PROOF_DEPENDENCY_REQUIRED'}:{}};
  return {removedFrames,removedActions,overflow};
}
