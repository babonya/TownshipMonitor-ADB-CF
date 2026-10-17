const fields=Object.freeze({"market":["helicopterSelectionRecovery","helicopterSelectionSeed","busy","currentMode","device","guard","marketActionId","barnSaleHold","marketEntryId","marketNeedHash","marketNeedsRecheckAfterSequence","marketPurchaseFailure","marketRefreshWait","marketReturnRecheckPending","marketReturnTransport","marketReturnTransports","marketVisit","navigationActionId","observe","signal","state","store","update","workers","workersFactory"],"events":["busy","cupActionId","device","guard","inventoryStamp","navigationActionId","reconcileHistory","state","store","update"]});
const contexts=new WeakMap();
export function deliveryModuleContext(owner,kind){
  if(!Object.hasOwn(fields,kind))throw Error('DELIVERY_MODULE_CONTEXT_INVALID');
  let cache=contexts.get(owner);if(!cache){cache=new Map();contexts.set(owner,cache);}
  if(cache.has(kind))return cache.get(kind);
  const context={};
  for(const name of fields[kind])Object.defineProperty(context,name,{
    enumerable:true,get:()=>typeof owner[name]==='function'?owner[name].bind(owner):owner[name],set:value=>{owner[name]=value;}
  });
  Object.preventExtensions(context);cache.set(kind,context);return context;
}
