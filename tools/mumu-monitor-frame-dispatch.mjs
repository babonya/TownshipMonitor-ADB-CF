// A stage continues only explicitly. A returned hold/status (even undefined)
// terminates this frame; rejected work propagates without trying another stage.
export const continueFrame=Symbol('continue_frame');
export const deliveryFrameStages=Object.freeze([
  'productInfoFrame','marketTownFrame','marketAndAccountingFrame','eventFrame',
  'profileFrame','navigationFrame','transportFrame','townFrame','helicopterFrame'
]);
export async function dispatchDeliveryFrame(delivery,frame,matching){
  for(const stage of deliveryFrameStages){
    const result=await delivery[stage](frame,matching);
    if(result!==continueFrame)return result;
  }
  throw Error('FRAME_HANDLER_REQUIRED');
}
