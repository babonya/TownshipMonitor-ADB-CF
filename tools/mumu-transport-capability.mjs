// Capability evidence is independent of inventory feasibility. This describes
// an exhausted supported path; it does not release stock or authorize an exit.
import {validateTrainLoadingProof,trainLoadingProfile} from './mumu-train-loading-proof.mjs';
import {trainLoadingPlan,selectTrainDetail} from './mumu-train-loading.mjs';
import {transportDemandFingerprint} from './mumu-transport-route.mjs';
export function trainExecutionHold(state,frame,allocation){
  const review=frame?.review,order=review?.data?.order;
  if(review?.status!=='accepted'||review.reviewedBy!=='program-train-loading'||
    review.data.train?.fullDemandConfirmed!==true||order?.disposition!=='deliver')return null;
  const registration=trainLoadingProfile(frame,frame.provider==='google_play_windows'?review.proof.profileHash:null);
  validateTrainLoadingProof(frame,registration);
  const reading={frameId:frame.id,review};
  if(trainLoadingPlan(state,reading)||selectTrainDetail(reading,allocation,registration))return null;
  // Do not let one unsupported carriage hide feasible work in another order.
  const feasible=(allocation.evaluations??[]).filter(o=>o.transport==='train'&&o.status==='feasible');
  if(!feasible.length||feasible.some(o=>o.orderId!==order.orderId))return null;
  const independent=registration.profile.recognitionMode==='independent_slots';
  const unsupported=independent&&order.needs.length===1||review.targets.some(t=>t.kind==='load_train'&&t.management?.resultRegistrationRequired===true);
  if(!unsupported)return null;
  return {kind:'train',scope:'transport',reason:independent?'TRAIN_FINAL_DEPARTURE_EVIDENCE_REQUIRED':'TRAIN_LOAD_RESULT_EVIDENCE_REQUIRED',orderIds:[order.orderId],
    frameId:frame.id,evidenceHash:frame.evidenceHash,profileHash:review.proof.profileHash,
    fingerprint:transportDemandFingerprint(allocation,'train'),executionAllowed:false};
}
