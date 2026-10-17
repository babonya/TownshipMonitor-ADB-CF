import {hasUnresolvedActions} from './mumu-input-state.mjs';
// A rejected navigation is bookkeeping, never a delivery or input retry.
import {digest,decodePng} from './adb.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {WINDOWS_PROVIDER,validWindowsNoInputProof,compareWindowsGeometry} from './windows-device.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {rejectedPreflight} from './mumu-rejected-preflight.mjs';
import {compareReviewedTarget} from './mumu-verification.mjs';
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
const fail=code=>{throw Error(code);};
const nativeRejection=(state,action)=>state.session.provider===WINDOWS_PROVIDER&&validWindowsNoInputProof(action?.deviceRejectionProof,
 {actionId:action?.id,command:action?.command,bridgeHash:state.session.windowsBridgeHash,error:action?.error});
export function rejectedNavigationProof(store,state,record,round,actionId){
 const action=state.actions?.[actionId],frame=state.frames?.[action?.frameId];
 const native=nativeRejection(state,action);
 const target=frame?.review?.targets?.find(t=>t.id===action?.targetId);
 if(state.input!==null||hasUnresolvedActions(state.actions??{}))fail('INPUT_UNRESOLVED');
 if(action?.id!==actionId||action.status!=='rejected_before_input'||action.inputAttempted!==false||
   action.management!==false||(!native&&action.error!=='NAVIGATION_TARGET_CHANGED')||
   round.endCondition!=='no_feasible_deliveries'||round.waitingPlan!==null||
   !Array.isArray(round.actionIds)||new Set(round.actionIds).size!==round.actionIds.length||!round.actionIds.includes(actionId)||
   !acceptedFacts(frame)||frame.review.actualKind!=='helicopter'||!target||target.kind!=='select_customer'||target.type!=='tap'||
   sha(action.target)!==sha(target)||action.epoch!==frame.epoch+1||
   action.nextVisit?.kind!=='helicopter'||action.nextVisit?.visitId!==actionId||state.visits?.[actionId])fail('NAVIGATION_REJECTION_PROOF_REQUIRED');
 const request={actionId,frameId:frame.id,targetId:target.id,nextVisit:action.nextVisit,swipe:null};
 if(action.requestDigest!==sha(request)||sha(action.command)!==sha({type:'tap',x:Math.floor(target.box.x+target.box.width/2),y:Math.floor(target.box.y+target.box.height/2)}))fail('NAVIGATION_REJECTION_TARGET_CHANGED');
 const forbidden=['issuedAt',...(!native?['inputReservedAt']:[]),'deviceReceipt','resultFrameId','resultProof','resultCaptureNotBeforeAt','effect','effects','actionResult','inventoryDeltas','inventoryInvalidated','capacityDelta','coinDelta','accounted','accountedAt','accountedRevision','receipt','receiptId'];
 if(forbidden.some(key=>Object.hasOwn(action,key))||state.transportMissions?.[actionId]||
   Object.values(state.transportMissions??{}).some(m=>m.waitingActionId===actionId||m.receipts?.some(r=>r.actionId===actionId))||
   Object.values(state.frames??{}).some(f=>f.review?.data?.actionResult?.actionId===actionId)||
   record.effects.some(e=>e.actionId===actionId)||record.operations.some(e=>e.actionId===actionId))fail('NAVIGATION_REJECTION_EFFECT_PRESENT');
 if(!action.preflightEvidence||!Number.isFinite(Date.parse(action.finishedAt)))fail('NAVIGATION_REJECTION_PROOF_REQUIRED');
 rejectedPreflight(store,action,frame);
 const original=store.evidence(frame.id);
 if(original.frame.evidenceHash!==frame.evidenceHash)fail('NAVIGATION_REJECTION_TARGET_CHANGED');
 if(native){
  const receipt=action.deviceRejectionProof.receipt,reserved=Date.parse(action.inputReservedAt);
  if(frame.provider!==WINDOWS_PROVIDER||!Number.isFinite(reserved)||reserved<Date.parse(action.preflightEvidence.observedAt)||
    reserved>Date.parse(receipt.startedAt)||Date.parse(receipt.completedAt)>Date.parse(action.finishedAt)||
    existsSync(join(store.root,'desktop-input',digest(Buffer.from(actionId))+'.json')))fail('NAVIGATION_REJECTION_PROOF_REQUIRED');
  compareWindowsGeometry(frame,action.preflightEvidence);
 }
 let changed=false;
 try{compareReviewedTarget(original.image,decodePng(readFileSync(action.preflightEvidence.evidenceRef)),target,{management:false});}
 catch(error){if(error.message!=='NAVIGATION_TARGET_CHANGED')throw error;changed=true;}
 if(native?changed:!changed)fail('NAVIGATION_REJECTION_TARGET_CHANGED');
 return {schema:1,actionId,kind:'select_customer',outcome:'rejected_before_input',inputAttempted:false,
   sourceFrameId:frame.id,sourceHash:frame.evidenceHash,proofHash:sha({action,frame:{id:frame.id,evidenceHash:frame.evidenceHash,review:frame.review}}),
   rejectedAt:action.finishedAt,inventoryUnchanged:true,executionAllowed:false};
}
export function validateNavigationNoEffectReceipt(store,state,record,round,actionId){
 const expected=rejectedNavigationProof(store,state,record,round,actionId),saved=round.noEffectReceipts?.filter(r=>r.actionId===actionId);
 if(!Array.isArray(saved)||saved.length!==1||sha(saved[0])!==sha(expected))fail('NAVIGATION_REJECTION_RECEIPT_CHANGED');
 return expected;
}
export function reconcileRejectedNavigationRound(store,inventory,roundId,{resume=false}={}){
 const initial=store.load(),old=initial.helicopterRounds?.[roundId];
 const native=nativeRejection(initial,initial.actions?.[old?.waitingActionId]);
 if(old?.status!=='exception'||old.reason!=='NAVIGATION_TARGET_CHANGED'&&(!native||old.reason!==initial.actions[old.waitingActionId].error))return null;
 if(native&&resume)fail('NATIVE_NAVIGATION_REQUIRES_BOUNDARY');
 if(inventory?.source!==store)fail('INVENTORY_SOURCE_MISMATCH');
 return inventory.locked(state=>{
   if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')fail('MANAGEMENT_APPROVAL_REQUIRED');
   // A proven native zero-input rejection can close bookkeeping while stopped.
   // It never clears stops or resumes the round that lost foreground ownership.
   if((state.stopCapture||state.stopReader)&&!native)fail('SESSION_STOPPED');
   const round=state.helicopterRounds?.[roundId],record=inventory.load(state);
   if(sha(round)!==sha(old)||round.waitingActionId!==round.actionIds.at(-1)||
     round.noEffectReceipts!==undefined&&!Array.isArray(round.noEffectReceipts)||
     round.noEffectReceipts?.some(r=>r.actionId===round.waitingActionId))fail('NAVIGATION_REJECTION_PROOF_REQUIRED');
   // Other actions in this pass must be verified navigation only. Consumptive
   // recipes and their accounting remain in their dedicated reconciliation path.
   if(!resume)for(const id of round.actionIds.slice(0,-1)){
     const a=state.actions[id],result=state.frames[a?.resultFrameId];
     if(a?.status==='rejected_before_input'){validateNavigationNoEffectReceipt(store,state,record,round,id);continue;}
     if(a?.id!==id||a.status!=='verified'||a.management!==false||a.target?.kind!=='select_customer'||
       !acceptedFacts(result)||result.review.actualKind!=='helicopter'||result.review.proof?.inputId!==id||
       result.epoch!==a.epoch||result.sceneId!==a.nextVisit?.visitId||a.inputAttempted!==true||
       !Number.isFinite(Date.parse(a.issuedAt))||!Number.isFinite(Date.parse(result.captureStartedAt))||
       Date.parse(result.captureStartedAt)<Date.parse(a.issuedAt)+1000||actionEffect(state,a)||state.transportMissions?.[id]||
       record.effects.some(e=>e.actionId===id)||record.operations.some(e=>e.actionId===id))fail('ROUND_ACTION_UNSETTLED');
     store.evidence(a.frameId);store.evidence(a.resultFrameId);
   }
   const receipt=rejectedNavigationProof(store,state,record,round,round.waitingActionId);
   for(const saved of round.noEffectReceipts??[])validateNavigationNoEffectReceipt(store,state,record,round,saved.actionId);
   (round.noEffectReceipts??=[]).push(receipt);round.rejectionReconciliation={priorRoundHash:sha(old),inventoryUnchanged:true};
   round.waitingActionId=null;round.status=resume?'ready':'boundary';round.reason=resume?null:'NAVIGATION_REJECTED_WITHOUT_INPUT';
   state.revision++;store.save(state);return {roundId,receipt,executionAllowed:false};
 });
}
