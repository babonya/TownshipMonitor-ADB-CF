// Hold scope describes which work may be considered. It never grants input;
// canonical ownership, evidence and allocation guards remain authoritative.
import {deliveryReasonPolicy} from './mumu-delivery-reasons.mjs';
export function deliveryHold(reason){
  return reason?{reason,...deliveryReasonPolicy(reason),executionAllowed:false}:null;
}
export function failedObservation(previous,{key,frameId,reason,now}){
  const hold=deliveryHold(reason);
  // Transient worker errors belong to the observation context, not PNG bytes.
  // Animation or a different capture hash must not restart the short burst.
  const attempts=previous&&(previous.key===key||deliveryHold(previous.reason)?.retryObservation&&hold.retryObservation)?previous.attempts+1:1;
  const delay=attempts<3?1000*attempts*attempts:Math.min(60000,15000*2**Math.min(2,attempts-3));
  return {key,frameId,reason,attempts,retryAt:hold.retryObservation?now+delay:null,executionAllowed:false};
}
export function observationRetryDue(failure,{key,frameId,now}){
  if(!failure)return true;
  if(deliveryHold(failure.reason)?.retryObservation)return failure.frameId!==frameId&&failure.retryAt!==null&&now>=failure.retryAt;
  return failure.key!==key;
}

// Transport observations share the same bounded worker recovery as helicopter
// observations. This wrapper never plans, repeats, or settles an input itself.
export async function observeTransportWithRetry(coordinator,{kind,frame,key},observe){
  const check=()=>{
    if(coordinator.signal?.aborted)throw Error('DELIVERY_CANCELLED');
    const state=coordinator.store.load?.();
    if(state?.stopCapture||state?.stopReader)throw Error('SESSION_STOPPED');
  };
  check();
  const failures=coordinator.transportObservationFailures??={};
  const failure=failures[kind];
  if(!observationRetryDue(failure,{key,frameId:frame.id,now:coordinator.store.clock()}))
    return {stored:false,reason:failure.reason,observationRetry:failure};
  try{
    const result=await observe();
    check();
    if(!result.stored)throw Error(result.reason??'SUPPORTED_TRANSPORT_REQUIRED');
    delete failures[kind];coordinator.state.observationRetry=null;
    return result;
  }catch(error){
    check();
    const next=failedObservation(failure,{key,frameId:frame.id,reason:error.message,now:coordinator.store.clock()});
    failures[kind]=next;coordinator.state.observationRetry=next;
    if(deliveryHold(error.message)?.retryObservation){
      coordinator.workers?.matcher?.close();coordinator.workers?.ocr?.close();coordinator.workers=null;
    }
    return {stored:false,reason:error.message,observationRetry:next};
  }
}
