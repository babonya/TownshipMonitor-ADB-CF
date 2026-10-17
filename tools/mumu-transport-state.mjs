// Coordinator-owned temporary transport state. Legacy property names remain
// views of the same values for existing callers; no separate copy is kept.
const fields=Object.freeze({
  train:{trainPlan:'plan',trainActionId:'actionId',trainNavigationId:'navigationId',trainHold:'hold',lastTrainKey:'lastKey',trainIdleEvidence:'idleEvidence',trainSlotContexts:'slotContexts'},
  airport:{airportPlan:'plan',airportActionId:'actionId',airportNavigationId:'navigationId',airportHold:'hold',lastAirportKey:'lastKey',airportIdleEvidence:'idleEvidence'},
  helicopter:{helicopterPlan:'plan',helicopterActionId:'actionId'}
});
export function readTransportState(coordinator,kind){
  if(!Object.hasOwn(fields,kind))throw Error('TRANSPORT_STATE_KIND_INVALID');
  return coordinator.transports?.[kind]??Object.fromEntries(Object.entries(fields[kind]).map(([alias,key])=>[key,coordinator[alias]]));
}
export function transportState(coordinator,kind){
  if(!Object.hasOwn(fields,kind))throw Error('TRANSPORT_STATE_KIND_INVALID');
  coordinator.transports??={};
  if(!coordinator.transports[kind]){
    const state=readTransportState(coordinator,kind);
    coordinator.transports[kind]=state;
    for(const [alias,key] of Object.entries(fields[kind]))Object.defineProperty(coordinator,alias,{
      configurable:true,enumerable:true,get:()=>state[key],set:value=>{state[key]=value;}
    });
  }
  return coordinator.transports[kind];
}
