import {generatedActionId} from './mumu-action-id.mjs';
// Normal returned-cargo observation and one guarded claim. No ADB shortcut,
// authority grant, ordinary stock estimate, quantity badge or automatic retry.
import {digest} from './adb.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash,acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {readTrainRewards,trainRewardProfile,validateTrainRewardProof,validTrainRewardSwipe} from './mumu-train-reward-proof.mjs';
import {navigateReviewed} from './mumu-store.mjs';
export function trainRewardResult(state,action,frame,reading){
  const before=state.frames[action?.frameId],m=action?.target?.management;
  if(action?.target?.kind!=='collect_train'||action.management!==true||m?.programVerified!==true||
      !['issued','captured'].includes(action.status)||!acceptedFacts(before)||
      before.review.reviewedBy!=='program-train-reward'||frame.epoch!==action.epoch||
      frame.sequence<=before.sequence||frame.evidenceHash===before.evidenceHash||
      !Number.isFinite(Date.parse(frame.captureStartedAt))||!Number.isFinite(Date.parse(action.issuedAt))||
      (state.observationInvalidation?.sequence??-1)>=before.sequence||
      Date.parse(frame.captureStartedAt)<Date.parse(action.issuedAt)+1000)return null;
  if(m.rewards!==undefined){
    if(before.provider!=='google_play_windows'||!validTrainRewardSwipe(action.target,action.command)||
      !before.review.targets.some(t=>JSON.stringify(t)===JSON.stringify(action.target)))return null;
    const results=m.rewards.map(c=>trainRewardResult(state,{...action,target:{...action.target,management:{...m,rewards:undefined,carriage:c.carriage,rewardReferenceKey:c.referenceKey}}},frame,reading));
    if(results.some(r=>!r))return null;
    return {actionId:action.id,confirmed:true,frameId:frame.id,effect:'Every registered cargo crossed by the single swipe is now absent.',
      stockScope:'protected_train_reward',trainRewardReceipt:{row:m.row,carriages:m.rewards,quantity:null,quantityConfirmed:false,resultCargoAbsent:true,ordinaryInventoryNotObserved:true}};
  }
  const oldRow=before.review.data.trainRewards.rows.find(r=>r.row===m.row),old=oldRow?.carriages.find(c=>c.carriage===m.carriage);
  const row=reading.rows.find(r=>r.row===m.row),carriage=row?.carriages.find(c=>c.carriage===m.carriage);
  if(old?.status!=='present'||old.referenceKey!==m.rewardReferenceKey||oldRow.layoutId!==m.layoutId||
      !(row?.phase==='loading'||row?.phase==='returned_cargo'&&row.layoutId===m.layoutId&&carriage?.status==='empty'))return null;
  return {actionId:action.id,confirmed:true,frameId:frame.id,
    effect:row.phase==='loading'?'All returned cargo was replaced by loading carriages.':'The same returned cargo carriage is now empty.',
    stockScope:'protected_train_reward',trainRewardReceipt:{row:m.row,carriage:m.carriage,
      referenceKey:m.rewardReferenceKey,quantity:null,quantityConfirmed:false,resultCargoAbsent:true,ordinaryInventoryNotObserved:true}};
}
export async function observeTrainRewards(store,{frameId='latest',offline=false}={}){
  const initial=store.load(),fid=frameId==='latest'?initial.latestFrameId:frameId;
  if(!offline&&(initial.stopCapture||initial.stopReader||initial.frames[fid]?.epoch!==initial.scene.epoch))throw Error('SESSION_STOPPED');
  if(!offline&&fid!==initial.latestFrameId)throw Error('CURRENT_FRAME_REQUIRED');
  const evidence=store.evidence(fid),registration=trainRewardProfile(evidence.frame),reading=readTrainRewards(evidence.image,registration);
  if(!reading.supported)return {...reading,stored:false,frameId:fid};
  // Reuse an already accepted result original after input settlement. Rewriting
  // it would merge the old actionResult into a proof computed without that data.
  const prior=evidence.frame.review;
  if(!offline&&!initial.input&&prior?.reviewedBy==='program-train-reward'){
    if(prior.proof?.invalidationSequence!==(initial.observationInvalidation?.sequence??null))throw Error('OBSERVATION_CONTEXT_CHANGED');
    validateTrainRewardProof(evidence.frame);
    if(JSON.stringify(prior.data.trainRewards)!==JSON.stringify({rows:reading.rows})||
      JSON.stringify(prior.targets)!==JSON.stringify(reading.targets))throw Error('TRAIN_REWARD_PROOF_CHANGED');
    return {...reading,stored:true,frameId:fid,review:prior,executionAllowed:false};
  }
  const review={reviewedBy:'program-train-reward',quality:{gameVisible:true,occluded:false},actualKind:'train',actualEntityId:null,
    data:{trainRewards:{rows:reading.rows}},targets:reading.targets};
  const result=trainRewardResult(initial,initial.actions[initial.input],evidence.frame,reading);
  if(result)review.data.actionResult=result;
  review.proof={schema:'program-train-reward-1',frameId:fid,evidenceHash:evidence.frame.evidenceHash,
    profileHash:registration.hash,inputId:initial.input,invalidationSequence:initial.observationInvalidation?.sequence??null,
    reviewHash:reviewFactHash(review)};
  if(!offline){await store.retry(()=>store.pinFrame(fid,{ocr:false}));
    await store.retry(()=>store.review({frameId:fid,...review,programToken:PROGRAM_REVIEW_TOKEN}));}
  return {...reading,stored:!offline,frameId:fid,review,executionAllowed:false};
}
export function accountTrainRewards(store,inventory){
  let count=0;
  for(const a of Object.values(store.load().actions??{})){
    if(a.target?.kind!=='collect_train'||a.status!=='verified')continue;
    const state=store.load(),record=inventory.locked(s=>inventory.load(s));
    if(record.effects.some(e=>e.actionId===a.id))continue;
    // account_action validates the protected source/result contract itself.
    if(actionEffect(state,a)?.stockScope!=='protected_train_reward')continue;
    inventory.commit('account_action',{mutationId:'train-reward:'+a.id,actionId:a.id,
      expectedRevision:record.revision,expectedSourceRevision:state.revision});count++;
  }
  return count;
}
export const trainRewardActionId=(state,reading)=>generatedActionId(state,{frameId:reading.frameId,targetId:reading.targets[0]?.id,kind:'r'},()=> 'train-reward:'+digest(Buffer.from(JSON.stringify({session:state.session.id,frameId:reading.frameId,targetId:reading.targets[0]?.id}))).slice(0,32));
export async function claimTrainReward(store,reading,{device,signal,beforeBegin,beforeInputGuard}={}){
  const state=store.load();if(state.input)throw Error('INPUT_UNRESOLVED');
  const target=reading.targets[0];if(!target)return {issued:false,reason:'NO_REGISTERED_RETURNED_CARGO'};
  const actionId=trainRewardActionId(state,reading);
  return navigateReviewed(store,{actionId,frameId:reading.frameId,targetId:target.id,
    nextVisit:{visitId:actionId+'-result',kind:'train',required:true},...(target.type==='swipe'?{swipe:target.swipe}:{})},
    {management:true,device,signal,beforeBegin,beforeInputGuard});
}
