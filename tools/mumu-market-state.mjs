// Persistent position fencing, changed only inside the canonical source lock.
import {inputEvidenceValid,evidenceWindow} from './mumu-freshness.mjs';
const copy=x=>structuredClone(x);
const fail=code=>{throw Error(code);};
export function marketState(state){
  return state.marketView??{schema:1,generation:0,visitId:state.scene.kind==='market'?state.scene.id:null,
    epoch:state.scene.epoch,minimumSequence:0,contentsFrameId:null,status:'needs_read',lastEvent:'initial'};
}
export function marketTicket(state){
  const view=marketState(state);return {sessionId:state.session.id,generation:view.generation,visitId:view.visitId,epoch:view.epoch};
}
export function invalidateMarket(state,event,{actionId=null}={}){
  const previous=marketState(state);
  state.marketView={schema:1,generation:previous.generation+1,visitId:state.scene.kind==='market'?state.scene.id:null,
    epoch:state.scene.epoch,minimumSequence:state.sequence,contentsFrameId:null,status:'needs_read',lastEvent:event,actionId};
  return marketTicket(state);
}
export function marketInput(state,frame,target,actionId){
  if(frame.review.actualKind==='market'||target.kind==='open_market'||target.kind==='buy_market')
    invalidateMarket(state,target.kind==='buy_market'?'purchase_requested':target.kind,{actionId});
}
export function validateMarketTicket(state,ticket){
  const current=marketTicket(state);
  if(!ticket||Object.keys(current).some(key=>current[key]!==ticket[key]))fail('MARKET_VIEW_CHANGED');
}
export function recordMarketContents(state,contents,ticket,now){
  validateMarketTicket(state,ticket);
  const frame=state.frames[contents?.frameId],view=marketState(state),age=now-Date.parse(frame?.observedAt??'');
  if(state.input||state.scene.transitioning)fail('INPUT_UNRESOLVED');
  if(state.stopCapture||state.stopReader)fail('SESSION_STOPPED');
  if(state.scene.kind!=='market'||!frame||frame.epoch!==state.scene.epoch||frame.sceneId!==state.scene.id||frame.sequence<=view.minimumSequence||
    !Number.isFinite(age)||age<0||!inputEvidenceValid(frame,now,state))fail('CURRENT_MARKET_FRAME_REQUIRED');
  const position=contents.marketPosition;
  if(contents.schema!==1||contents.status!=='candidate'||contents.scene?.kind!=='market'||contents.valueState!=='unreviewed'||
    contents.executionAllowed!==false||contents.requiresGptReview!==true||contents.epoch!==frame.epoch||contents.sequence!==frame.sequence||
    contents.evidenceHash!==frame.evidenceHash||contents.observedAt!==frame.observedAt||contents.dimensions?.width!==frame.width||contents.dimensions?.height!==frame.height||
    position?.visitId!==frame.sceneId||position.epoch!==frame.epoch||position.frameId!==frame.id||position.evidenceHash!==frame.evidenceHash||position.stableAcrossReopen!==false||
    !Array.isArray(contents.rows)||contents.rows.length>32||new Set(contents.rows.map(row=>row.slotId)).size!==contents.rows.length||
    Buffer.byteLength(JSON.stringify(contents))>256*1024)fail('MARKET_CONTENTS_CONTRACT_MISMATCH');
  for(const row of contents.rows)if(row.binding?.frameId!==frame.id||row.binding.evidenceHash!==frame.evidenceHash||
    row.binding.slotId!==row.slotId||row.identityConfirmed!==false)fail('MARKET_ROW_CONTRACT_MISMATCH');
  frame.required=true;frame.contentsCandidates=copy(contents);
  state.marketView={...view,contentsFrameId:frame.id,status:'candidate',lastEvent:'contents_recorded'};
  return {ticket:marketTicket(state),frameId:frame.id,requiresGptReview:true,executionAllowed:false};
}
export function getMarketContents(state,{frameId,evidenceHash,now,maxAgeMs=null}={}){
  const view=marketState(state),frame=state.frames[view.contentsFrameId],age=now-Date.parse(frame?.observedAt??'');
  if(state.input||state.scene.transitioning||state.stopCapture||state.stopReader||view.status!=='candidate'||!frame||
    frame.id!==frameId||frame.evidenceHash!==evidenceHash||frame.epoch!==state.scene.epoch||frame.sceneId!==state.scene.id||
    !Number.isFinite(age)||age<0||!inputEvidenceValid(frame,now,state)||!evidenceWindow({observedAt:frame.observedAt},{now,maxAgeMs}).valid)return null;
  return copy(frame.contentsCandidates);
}
