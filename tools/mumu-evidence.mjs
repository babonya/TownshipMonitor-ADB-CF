// Canonical facts, distinct from perception candidates and exact-image reuse.
import {digest} from './adb.mjs';
export const PROGRAM_REVIEW_TOKEN=Symbol('scoped program review');
export function actionResultProof(frame,payload){
  return {schema:1,frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,observedAt:frame.observedAt,
    review:structuredClone(frame.review),...structuredClone(payload)};
}
export const reviewFactHash=r=>digest(Buffer.from(JSON.stringify({quality:r.quality,actualKind:r.actualKind,
  actualEntityId:r.actualEntityId,data:r.data,targets:r.targets})));
export function acceptedFacts(frame){
  const r=frame?.review;
  if(r?.status!=='accepted'||r.quality?.gameVisible!==true||r.quality.occluded!==false)return false;
  return r.reviewedBy==='program-barn-sale'&&['barn','town'].includes(r.actualKind)&&r.proof?.schema==='program-barn-sale-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-helicopter-info'&&r.actualKind==='helicopter'&&r.proof?.schema==='program-helicopter-info-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-market'&&(['market','town'].includes(r.actualKind)||r.actualKind==='barn'&&['source','result'].includes(r.proof?.role)||r.actualKind==='helicopter'&&r.proof?.role==='transport_exit')&&r.proof?.schema==='program-market-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-event-close'&&r.actualKind==='unknown'&&r.proof?.schema==='program-event-close-1'&&r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-mayors-cup'&&(r.actualKind==='mayors_cup_result'||r.actualKind==='unknown'&&r.proof?.role==='complete_result')&&r.proof?.schema==='program-mayors-cup-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-airport-loading'&&r.actualKind==='airport'&&r.proof?.schema==='program-airport-loading-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-transport-navigation'&&r.proof?.schema==='program-transport-navigation-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='GPT'||r.reviewedBy==='program-helicopter'&&r.proof?.schema==='program-helicopter-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-train-reward'&&r.actualKind==='train'&&r.proof?.schema==='program-train-reward-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r)||r.reviewedBy==='program-train-loading'&&r.actualKind==='train'&&r.proof?.schema==='program-train-loading-1'&&
    r.proof.frameId===frame.id&&r.proof.evidenceHash===frame.evidenceHash&&r.proof.reviewHash===reviewFactHash(r);
}

export function actionEffect(state,action){
  const frame=state.frames?.[action?.resultFrameId],proof=action?.resultProof;
  if(proof){
    if(proof.frameId!==frame?.id||proof.evidenceHash!==frame.evidenceHash||proof.sequence!==frame.sequence||
        proof.observedAt!==frame.observedAt||!acceptedFacts({id:proof.frameId,evidenceHash:proof.evidenceHash,review:proof.review}))throw Error('ACTION_PROOF_CHANGED');
    return proof.effect;
  }
  return acceptedFacts(frame)?frame.review.data?.actionResult:null;
}
