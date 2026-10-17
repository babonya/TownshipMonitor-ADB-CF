// Conservative program proof: the entire current PNG equals a recent GPT-reviewed
// original in the same visit/epoch. Never infer post-input semantic changes.
import {digest} from './adb.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
const fail=code=>{throw Error(code);};
const fingerprint=review=>digest(Buffer.from(JSON.stringify({quality:review.quality,actualKind:review.actualKind,
  actualEntityId:review.actualEntityId,data:review.data,targets:review.targets,validityDeadline:review.validityDeadline})));
export function exactReview(state,{frameId,referenceFrameId},now){
  const frame=state.frames[frameId],reference=state.frames[referenceFrameId],review=reference?.review;
  if(state.input||state.scene.transitioning)fail('INPUT_UNRESOLVED');
  if(state.stopCapture||state.stopReader)fail('SESSION_STOPPED');
  if(!frame||!reference||reference.id===frame.id||review?.status!=='accepted'||review.reviewedBy!=='GPT'||
    !review.quality?.gameVisible||review.quality.occluded||review.actualKind==='unknown'||
    frame.epoch!==state.scene.epoch||reference.epoch!==frame.epoch||reference.sceneId!==frame.sceneId||frame.sceneId!==state.scene.id||
    reference.entityId!==frame.entityId||reference.width!==frame.width||reference.height!==frame.height||
    frame.evidenceHash!==reference.evidenceHash||frame.kind!==reference.kind)fail('PROGRAM_EXACT_REFERENCE_REQUIRED');
  if(frame.review?.reviewedBy==='GPT')fail('PROGRAM_CANNOT_REPLACE_GPT_REVIEW');
  if(Object.values(state.frames).some(f=>f.id!==reference.id&&f.review?.reviewedBy==='GPT'&&
    f.sceneId===frame.sceneId&&f.epoch===frame.epoch&&f.evidenceHash===frame.evidenceHash&&f.sequence>reference.sequence&&
    (f.review.status!=='accepted'||fingerprint(f.review)!==fingerprint(review))))fail('PROGRAM_REFERENCE_SUPERSEDED');
  for(const f of [frame,reference])if(!inputEvidenceValid(f,now,state))fail('PROGRAM_REFERENCE_STALE');
  if(review.data?.order&&(!orderDemandCurrent(state,frame)||!orderDemandCurrent(state,reference)))fail('ORDER_DEMAND_RESET');
  const data=structuredClone(review.data);delete data.actionResult;delete data.launchResult;
  // Preserve the original timer's absolute deadline when copying to a new PNG.
  for(const fact of [data.order,data.market,data.validity&&{validity:data.validity}])if(fact){
    for(const timing of [fact,fact.validity])if(timing?.remainingSeconds!==undefined){
      const deadline=new Date(Date.parse(reference.observedAt)+timing.remainingSeconds*1000).toISOString();
      if(timing.deadline===undefined||Date.parse(deadline)<Date.parse(timing.deadline))timing.deadline=deadline;
      delete timing.remainingSeconds;
    }
  }
  return {reviewedBy:'program-exact',schema:1,quality:structuredClone(review.quality),actualKind:review.actualKind,
    actualEntityId:review.actualEntityId,data,targets:structuredClone(review.targets),status:'accepted',reviewedAt:new Date(now).toISOString(),
    ...(review.validityDeadline?{validityDeadline:review.validityDeadline}:{}),
    proof:{schema:'program-exact-1',referenceFrameId:reference.id,referenceReviewHash:fingerprint(review),evidenceHash:frame.evidenceHash,
      scope:'whole_png_same_current_visit',semanticEffectsInferred:false}};
}
export function validateExactReview(state,frame,now){
  if(frame.review?.reviewedBy!=='program-exact')return;
  const expected=exactReview({...state,input:null,scene:{...state.scene,transitioning:false}},
    {frameId:frame.id,referenceFrameId:frame.review.proof?.referenceFrameId},now);
  if(JSON.stringify(frame.review.proof)!==JSON.stringify(expected.proof)||fingerprint(frame.review)!==fingerprint(expected))fail('PROGRAM_PROOF_CHANGED');
}
