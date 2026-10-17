const fields={"entryId":"marketEntryId","actionId":"marketActionId","visit":"marketVisit","needHash":"marketNeedHash","returnTransport":"marketReturnTransport","returnTransports":"marketReturnTransports","returnRecheckPending":"marketReturnRecheckPending","needsRecheckAfterSequence":"marketNeedsRecheckAfterSequence","refreshWait":"marketRefreshWait","purchaseFailure":"marketPurchaseFailure"};
export function marketSession(coordinator){
  if(coordinator.marketSessionState)return coordinator.marketSessionState;
  const state=Object.fromEntries(Object.entries(fields).map(([name,alias])=>[name,coordinator[alias]]));
  Object.defineProperty(state,'phase',{enumerable:true,get:()=>state.entryId?'entering':state.actionId?'awaiting_result':
    state.returnRecheckPending?.pending?.length?'rechecking_orders':state.visit?'shopping':state.refreshWait?'waiting_refresh':'idle'});
  coordinator.marketSessionState=state;
  for(const [name,alias] of Object.entries(fields))Object.defineProperty(coordinator,alias,{
    configurable:true,enumerable:true,get:()=>state[name],set:value=>{state[name]=value;}
  });
  return state;
}
export function requireMarketOrderRecheck(coordinator,sequence,transports){
  coordinator.marketVisit?.retire();coordinator.marketVisit=null;coordinator.marketActionId=null;
  coordinator.marketNeedsRecheckAfterSequence=sequence;
  coordinator.marketReturnRecheckPending={afterSequence:sequence,transports,pending:[...transports],currentOwnedRequired:true};
}
export function finishMarketOrderRecheck(coordinator){
  coordinator.marketReturnRecheckPending=null;coordinator.marketReturnTransport=null;coordinator.marketNeedsRecheckAfterSequence=null;
}
