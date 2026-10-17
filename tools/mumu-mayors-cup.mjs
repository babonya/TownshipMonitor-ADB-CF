import {isUnresolvedAction} from './mumu-input-state.mjs';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {PROGRAM_REVIEW_TOKEN} from './mumu-evidence.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {targetIdentity} from './windows-device.mjs';
import {MAYORS_CUP_READER,readMayorsCup,mayorsCupFacts,mayorsCupTarget,mayorsCupOpenTarget,mayorsCupProgramProof,validateProgramMayorsCupProof} from './mumu-mayors-cup-proof.mjs';
import {readCupOcr,CUP_STAGE_SOURCES,cupActionStage} from './mumu-cup-ocr.mjs';
import {assertMayorsCupProgramBudget} from './mumu-mayors-cup-audit.mjs';
import {cupNoInput} from './mumu-cup-budget.mjs';
import {resultCaptureDueAt} from './mumu-timing.mjs';
const unresolved=a=>isUnresolvedAction(a);
export const cupResultStage=a=>Object.keys(CUP_STAGE_SOURCES).find(k=>a?.resultProof?.rewardObservation?.kind==='mayors_cup_'+k+'_ready')??null;
export function cupPredecessor(state){
  const found=Object.values(state.actions).filter(a=>a.status==='verified'&&a.nextVisit?.visitId===state.scene.id&&
    a.target?.kind==='claim_mayors_cup_reward'&&cupResultStage(a));
  return found.length===1?found[0]:null;
}
export function assertCupStageBudget(state,target,pendingId=null){
  const stage=cupActionStage({target});
  if(!stage)return assertMayorsCupProgramBudget(state,pendingId);
  const prior=state.actions[target.management.predecessorActionId],pending=state.actions[pendingId];
  const attempts=Object.values(state.actions).filter(a=>a.id!==pendingId&&a.target?.management?.predecessorActionId===prior?.id);
  const zero=a=>cupNoInput(a,state)&&
    JSON.stringify(a.target)===JSON.stringify(target)&&state.frames[a.frameId]?.sequence<state.frames[state.latestFrameId]?.sequence&&
    Date.parse(state.frames[state.latestFrameId]?.captureStartedAt)>Date.parse(a.finishedAt);
  if(!prior||prior.status!=='verified'||prior.target?.kind!=='claim_mayors_cup_reward'||cupResultStage(prior)!==stage||
    (pendingId?(state.input!==pendingId||pending?.status!=='pending'||pending.frameId!==state.latestFrameId||
      state.frames[pending.frameId]?.sceneId!==prior.nextVisit.visitId):state.scene.id!==prior.nextVisit.visitId)||
    attempts.some(a=>!zero(a)))
    throw Error('MAYORS_CUP_STAGE_ALREADY_USED_OR_UNPROVEN');
  const seen=new Set();let current=prior;
  while(current.target?.management?.source!=='mayors_cup_first_claim'){
    if(seen.has(current.id)||seen.size>=12||current.status!=='verified')throw Error('CUP_CHAIN_LIMIT_OR_GAP');
    seen.add(current.id);current=state.actions[current.target?.management?.predecessorActionId];
    if(!current)throw Error('CUP_CHAIN_LIMIT_OR_GAP');
  }
  if(current.status!=='verified'||current.target?.kind!=='claim_mayors_cup_reward'||seen.size>=12)throw Error('CUP_CHAIN_LIMIT_OR_GAP');
}
export function validateProgramMayorsCupSource(store,state,frame,review,{pending=false}={}){
  const fail=()=>{throw Error('MAYORS_CUP_CLAIM_SOURCE_REQUIRED');},a=state.actions[state.input];
  validateProgramMayorsCupProof({...frame,review},store.evidence(frame.id).image);
  const stage=review.proof?.role?.split('_')[0];
  const expected=Object.hasOwn(CUP_STAGE_SOURCES,stage??'')?mayorsCupOpenTarget(review.targets?.[0]?.management?.predecessorActionId,stage):mayorsCupTarget();
  if(!['source','open_source','claim_source','continue_source'].includes(review.proof?.role)||!['unknown','mayors_cup_result'].includes(frame.kind)||
      state.latestFrameId!==frame.id||frame.sceneId!==state.scene.id||frame.epoch!==state.scene.epoch-(pending?1:0)||
      state.stopCapture||state.stopReader||state.session.provider!=='google_play_windows'||frame.serial!==state.session.serial||
      frame.packageName!==state.session.packageName||JSON.stringify(targetIdentity(frame.captureTarget))!==JSON.stringify(targetIdentity(state.session.windowsTarget))||
      !inputEvidenceValid(frame,store.clock(),state)||store.clock()-Date.parse(frame.observedAt)>120000||
      !Number.isFinite(Date.parse(frame.observedAt))||Date.parse(frame.observedAt)>store.clock()||
      (state.observationInvalidation?.sequence??null)!==review.proof.invalidationSequence||
      review.proof.inputId!==null||Object.values(state.actions).some(x=>unresolved(x)&&(!pending||x!==a))||
      (pending?(a?.status!=='pending'||a.frameId!==frame.id||JSON.stringify(a.target)!==JSON.stringify(expected)):!!state.input))fail();
  assertCupStageBudget(state,expected,pending?a.id:null);
  // An owned Monitor callback may use the existing capture lease. No foreign
  // observer or delivery runner is admitted by this program source path.
  const path=join(store.root,'capture.lock');
  if(existsSync(path)){
    const owner=JSON.parse(readFileSync(path,'utf8'));
    if(owner.pid!==process.pid||typeof owner.token!=='string'||!owner.token)throw Error('MAYORS_CUP_EXCLUSIVE_OWNER_REQUIRED');
  }
  if(['helicopter-runner.lock','.management/runner.lock'].some(p=>existsSync(join(store.root,p)))||
      Object.values(state.transportMissions??{}).some(m=>m.waitingActionId))throw Error('MAYORS_CUP_EXCLUSIVE_OWNER_REQUIRED');
  return true;
}
export async function observeMayorsCup(store,{frameId,actionId=null,python}={}){
  const state=store.load(),e=store.evidence(frameId),frame=e.frame;
  if(state.stopCapture||state.stopReader)throw Error('SESSION_STOPPED');
  if(state.latestFrameId!==frameId||frame.epoch!==state.scene.epoch||!inputEvidenceValid(frame,store.clock(),state))throw Error('CURRENT_FRAME_REQUIRED');
  if(Object.values(state.actions).some(a=>unresolved(a)&&a.id!==actionId)||state.input!==actionId)throw Error('INPUT_UNRESOLVED');
  let review,role='source';
  if(actionId){
    const a=state.actions[actionId],source=state.frames[a?.frameId],due=resultCaptureDueAt(a);
    if(a?.target?.kind!=='claim_mayors_cup_reward'||source?.review?.reviewedBy!==MAYORS_CUP_READER||
        !['issued','captured'].includes(a.status))throw Error('INPUT_UNRESOLVED');
    if(due===null||!Number.isFinite(Date.parse(frame.captureStartedAt))||Date.parse(frame.captureStartedAt)<due)
      return {stored:false,reason:'MAYORS_CUP_RESULT_CAPTURE_REQUIRED'};
    await store.retry(()=>store.pinFrame(frameId,{ocr:false}));
    const reading=await readCupOcr(frame,e.bytes,e.image,{python,stage:cupActionStage(a)?'auto':'open'}),stage=reading.stage;
    if(!reading.supported||stage===cupActionStage(a))
      return {stored:false,frameId,reason:'MAYORS_CUP_RESULT_REVIEW_REQUIRED',reading,executionAllowed:false};
    role=stage+'_result';review={reviewedBy:MAYORS_CUP_READER,quality:{gameVisible:true,occluded:false},actualKind:stage==='complete'?'unknown':'mayors_cup_result',actualEntityId:null,
      data:{mayorsCupOcr:reading},targets:[]};
  }else{
    const prior=cupPredecessor(state);
    if(prior){
      const stage=cupResultStage(prior);
      const reading=await readCupOcr(frame,e.bytes,e.image,{python,stage});if(!reading.supported)return {...reading,stored:false};
      role=stage+'_source';review={reviewedBy:MAYORS_CUP_READER,quality:{gameVisible:true,occluded:false},actualKind:'mayors_cup_result',actualEntityId:null,
        data:{mayorsCupOcr:reading},targets:[mayorsCupOpenTarget(prior.id,stage)]};
    }else{
    const reading=readMayorsCup(e.image);if(!reading.supported)return {...reading,stored:false};
    review={reviewedBy:MAYORS_CUP_READER,quality:{gameVisible:true,occluded:false},actualKind:'mayors_cup_result',actualEntityId:null,
      data:{mayorsCupClaim:mayorsCupFacts(frame)},targets:reading.targets};
    }
  }
  review.proof=mayorsCupProgramProof(frame,review,state,role);
  await store.retry(()=>store.pinFrame(frameId,{ocr:false}));
  await store.retry(()=>store.review({frameId,...review,programToken:PROGRAM_REVIEW_TOKEN}));
  return {stored:true,frameId,targets:review.targets,review,executionAllowed:false};
}

// Settle the saved successful first CLAIM before upgrading a stopped runtime.
// This never turns an old result into a fresh input source or overwrites its GPT review.
export async function settleSavedCupResult(store,{frameId,source,python}={}){
  if(source!=='explicit_user')throw Error('EXPLICIT_RESULT_SETTLEMENT_REQUIRED');
  const before=store.load(),e=store.evidence(frameId),priorAction=before.actions[before.input];
  const reading=await readCupOcr(e.frame,e.bytes,e.image,{python,offline:true,stage:cupActionStage(priorAction)?'auto':'open'}),stage=reading.stage;
  if(!reading.supported)throw Error(reading.reason);
  return store.transact(s=>{
    if(s.revision!==before.revision||!s.stopCapture||!s.stopReader||
      ['capture.lock','helicopter-runner.lock','.management/runner.lock'].some(p=>existsSync(join(store.root,p))))throw Error('CUP_SETTLED_OWNER_BOUNDARY_REQUIRED');
    const a=s.actions[s.input];
    if(a?.target?.kind!=='claim_mayors_cup_reward'||stage===cupActionStage(a))throw Error('CUP_RECEIPT_STAGE_REQUIRED');
    const actualKind=stage==='complete'?'unknown':'mayors_cup_result';
    const review={reviewedBy:MAYORS_CUP_READER,status:'accepted',quality:{gameVisible:true,occluded:false},actualKind,actualEntityId:null,
      data:{mayorsCupOcr:reading},targets:[]};
    review.proof=mayorsCupProgramProof(e.frame,review,s,stage+'_result');
    const proof=store.mayorsCupClaimResult(s,a,{...e.frame,review},{historical:true});
    if(!proof)throw Error('CUP_RESULT_PROOF_REQUIRED');
    Object.assign(a,{status:'verified',verifiedAt:new Date(store.clock()).toISOString(),resultFrameId:frameId,resultObservedAt:e.frame.observedAt,actualKind,
      resultProof:{schema:1,frameId,evidenceHash:e.frame.evidenceHash,sequence:e.frame.sequence,observedAt:e.frame.observedAt,review,
        effect:{actionId:a.id,frameId,confirmed:true,effect:proof.kind,rewardAccounting:proof.rewardAccounting},rewardObservation:proof}});
    s.input=null;s.scene.kind=actualKind;s.scene.entityId=null;
    if(s.visits[e.frame.sceneId])Object.assign(s.visits[e.frame.sceneId],{kind:actualKind,entityId:null});
    return {actionId:a.id,resultFrameId:frameId,status:a.status,kind:proof.kind};
  });
}
