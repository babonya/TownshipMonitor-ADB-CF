// General operating limits. Historical incident reconciliation remains in the
// audit module and does not grant a standing exception to this policy.
import {validWindowsNoInputProof,targetIdentity} from './windows-device.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';

export function cupNoInput(a,state){
  if(a?.status!=='rejected_before_input'||a.inputAttempted!==false||a.issuedAt||a.deviceReceipt?.commandIssued||
    !Number.isFinite(Date.parse(a.finishedAt)))return false;
  // The executor records rejection before reserving dispatch, or a validated
  // native zero-event receipt after reserving it. Restart retirement is neither.
  return !a.inputReservedAt&&!a.nativeInputFailure&&!a.deviceReceipt||
    /^[a-f0-9]{64}$/.test(state.session?.windowsBridgeHash??'')&&validWindowsNoInputProof(a.deviceRejectionProof,
    {actionId:a.id,command:a.command,bridgeHash:state.session.windowsBridgeHash,error:a.error,inputReservedAt:a.inputReservedAt});
}
const sameDevice=(a,b)=>a&&b&&a.provider===b.provider&&a.serial===b.serial&&a.packageName===b.packageName&&
  a.width===b.width&&a.height===b.height&&JSON.stringify(targetIdentity(a.captureTarget))===JSON.stringify(targetIdentity(b.captureTarget));
export function cupBoundaryTown(state,result,current){
  if(!sameDevice(result,current))return null;
  return Object.values(state.frames).filter(f=>acceptedFacts(f)&&f.review.actualKind==='town'&&
    f.review.quality?.gameVisible===true&&f.review.quality.occluded===false&&sameDevice(f,current)&&
    f.sequence>result.sequence&&f.sequence<current.sequence).sort((a,b)=>b.sequence-a.sequence)[0]??null;
}
export function assertCupFirstBudget(state,pendingId=null){
  const pending=pendingId?state.actions[pendingId]:null;
  if(pendingId&&(!pending||state.input!==pendingId||pending.status!=='pending'))throw Error('INPUT_UNRESOLVED');
  const current=state.frames[pending?.frameId??state.latestFrameId];
  const claims=Object.values(state.actions).filter(a=>a.id!==pendingId&&a.target?.kind==='claim_mayors_cup_reward');
  // Require a completed reward chain and a later accepted town screen before
  // treating another completed-event modal as a new event. PNG changes, elapsed
  // time and restart incarnation alone cannot distinguish events.
  const completed=claims.filter(a=>a.status==='verified'&&a.resultProof?.rewardObservation?.kind==='mayors_cup_completed'&&
    a.resultProof.frameId===a.resultFrameId&&a.resultProof.rewardObservation.actionId===a.id&&
    acceptedFacts({id:a.resultFrameId,evidenceHash:a.resultProof.evidenceHash,review:a.resultProof.review})&&
    a.resultProof.review.proof?.role==='complete_result'&&a.resultProof.review.data?.mayorsCupOcr?.stage==='complete'&&
    a.resultProof.evidenceHash===state.frames[a.resultFrameId]?.evidenceHash&&sameDevice(state.frames[a.resultFrameId],current));
  let boundary=-1;
  for(const a of completed){
    const result=state.frames[a.resultFrameId];
    if(cupBoundaryTown(state,result,current))boundary=Math.max(boundary,result.sequence);
  }
  for(const a of claims){
    const source=state.frames[a.frameId];
    if(boundary>=0&&source&&source.sequence<boundary)continue;
    if(!cupNoInput(a,state))throw Error('MAYORS_CUP_EVENT_OR_STAGE_UNPROVEN');
    if(!current||!source||!sameDevice(source,current)||current.id===a.frameId||current.sequence<=source.sequence||
      Date.parse(current.captureStartedAt)<=Date.parse(a.finishedAt))throw Error('MAYORS_CUP_FRESH_RETRY_REQUIRED');
  }
  return true;
}
