// Active order demand only. Historical stock, receipts and navigation retain
// their original evidence semantics. A new review cannot rejuvenate an old PNG.
export function orderDemandCurrent(state,frame,seen=new Set()){
  const marker=state.orderDemandStartup;
  if(!marker)return true;
  if(marker.pending||!frame||!Number.isSafeInteger(marker.cutoffSequence)||!Number.isSafeInteger(frame.sequence)||
      frame.sequence<=marker.cutoffSequence||seen.has(frame.id))return false;
  seen.add(frame.id);
  const refs=[frame.review?.proof?.referenceFrameId,frame.review?.proof?.contextFrameId,
    frame.review?.data?.train?.origin?.frameId,frame.review?.data?.airport?.origin?.frameId].filter(Boolean);
  for(const id of new Set(refs))if(id!==frame.id&&!orderDemandCurrent(state,state.frames[id],new Set(seen)))return false;
  return true;
}
export function assertOrderStartupComplete(state){
  if(state.orderDemandStartup?.pending)throw Error('ORDER_STARTUP_RESET_PENDING');
}
export function orderInput(kind){
  return ['send_helicopter','delete_helicopter','load_train','load_airport','send_train','send_airport','buy_market','select_customer','inspect_item'].includes(kind);
}
