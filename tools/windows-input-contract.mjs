import {inputGeometry,resolvePercentageCommand} from './percentage-coordinates.mjs';
import {digest} from './adb.mjs';
const fail=reason=>{throw Error(reason);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
export function windowsInputEvidence(state,action){
  const proof=action?.somProof;
  if(proof?.inputMode===undefined)return action?.preflightEvidence;
  const frame=state.frames?.[action.frameId];
  if(proof.inputMode!=='source_observation'||state.settings?.workflowMode!=='som'||state.session?.provider!=='google_play_windows'||
    !action.target?.kind?.startsWith('som_')||action.target.som?.kind!==action.target.kind||!frame||
    state.latestFrameId!==frame.id||action.frameId!==frame.id||proof.frameId!==frame.id||proof.evidenceHash!==frame.evidenceHash||
    action.coordinateSource?.frameId!==frame.id||action.coordinateSource?.evidenceHash!==frame.evidenceHash||
    state.scene?.epoch!==action.epoch||frame.epoch+1!==action.epoch||state.observationInvalidation?.sequence>=frame.sequence)
    fail('INPUT_OBSERVATION_CHANGED');
  return frame;
}
export function resolveWindowsInputCommand(session,action,coordinates,{width,height}){
  action=resolvePercentageCommand(coordinates,inputGeometry(session,{width,height}),action);
  const point=(x,y)=>{if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y))fail('NAVIGATION_INVALID');const v=session.windowsViewport;if(x<v.x||y<v.y||x>=v.x+v.width||y>=v.y+v.height)fail('INPUT_OUTSIDE_GAME_VIEWPORT');};
  if(action.type==='tap')point(action.x,action.y);
  else if(action.type==='swipe'&&Number.isSafeInteger(action.durationMs)&&action.durationMs>=200&&action.durationMs<=2000){point(action.x1,action.y1);point(action.x2,action.y2);}
  else fail('NAVIGATION_INVALID');
  return action;
}
// Projection preserves original objects and key order; canonical state bytes
// and their SHA-256 remain owned by the caller, never a typed reserialization.
export function validateWindowsInputSequence(sequence,action){
  if(sequence==null)return null;
  if(sequence.kind!=='som_helicopter_send_skip'||sequence.delayMs!==100||sequence.clickCount!==2||!positive(sequence.ownerPid)||
    Object.keys(sequence).length!==4||action?.target?.kind!=='som_send'||action.target.som?.kind!=='som_send'||
    action.target.som.next!=='helicopter'||typeof action.target.som.orderHash!=='string'||!action.target.som.orderHash||
    action.command?.type!=='tap'||!action.somProof?.ownerToken)fail('INPUT_SEQUENCE_INVALID');
  return sequence;
}
export function windowsInputArguments({action,coordinates,expected,viewport,permit,stateHash,inputSequence}){
  return {action,coordinates,expected,viewport,permit:{...permit,sha256:stateHash},...(inputSequence?{inputSequence}:{})};
}
export function validateIssuedWindowsReceipt(receipt,actionId,inputSequence=null){
  if(receipt?.actionId!==actionId||receipt.status!=='issued'||receipt.gameResultVerified!==false||!positive(receipt.inserted)||receipt.inserted!==receipt.attempted)fail('WINDOWS_INPUT_RECEIPT_INVALID');
  if(inputSequence){
    const skipped=receipt.completionReason==='send_skip_omitted'&&receipt.completedClicks===1&&receipt.attempted===3;
    if(receipt.plannedClicks!==2||(!skipped&&(receipt.completedClicks!==2||receipt.attempted!==6))||receipt.releaseInserted!==0)fail('WINDOWS_INPUT_RECEIPT_INVALID');
    if(skipped){
      const recovered=completedWindowsSendReceipt(receipt.nativeInputFailure,receipt.interruptionContext,inputSequence);
      if(!recovered||['actionId','attempted','inserted','plannedClicks','completedClicks','releaseInserted','startedAt','completedAt'].some(k=>receipt[k]!==recovered[k]))fail('WINDOWS_INPUT_RECEIPT_INVALID');
    }
  }
  return receipt;
}
// User policy: a pointer-interrupted drag is complete once its owned button is
// released and the helper has exited. Preserve the native failure as evidence;
// this disposition never replays the gesture or proves a purchase/delivery.
function closedWindowsInputFailure(failure,{actionId,command,stateHash,bridgeHash,inputReservedAt,marker}={}){
  const r=failure?.receipt,t=failure?.terminal;
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  if(!actionId||!command||failure?.schema!==1||failure.provider!=='google_play_windows'||
    typeof failure.error!=='string'||failure.bridgeHash!==bridgeHash||failure.stateHash!==stateHash||
    !/^[a-f0-9]{64}$/.test(stateHash??'')||!same(failure.command,command)||
    r?.actionId!==actionId||r.status!=='unknown'||r.error!==failure.error||r.gameResultVerified!==false||
    !Number.isSafeInteger(r.attempted)||r.attempted<2||r.inserted!==r.attempted||
    t?.op!=='input'||t.actionId!==actionId||t.closed!==true||t.code!==1||t.signal!==null||
    t.stateHash!==stateHash||t.commandHash!==digest(Buffer.from(JSON.stringify(command))))return null;
  const times=[inputReservedAt,t.startedAt,r.startedAt,r.completedAt,t.closedAt].map(Date.parse);
  // The helper constructs the saved marker after its response receipt. Disk
  // scheduling can separate them; bind their order to helper exit, not 5 ms.
  const markerAt=Date.parse(marker?.completedAt);
  if(times.some((at,i)=>!Number.isFinite(at)||(i>0&&at<times[i-1]))||
    !Number.isFinite(markerAt)||markerAt<times[3]||markerAt>times[4]||
    !same({...marker,completedAt:r.completedAt},r))return null;
  return r;
}
const dragInterruptions=new Set(['POINTER_CHANGED_DURING_DRAG','USER_INPUT_ACTIVE','INPUT_TARGET_OCCLUDED','INPUT_GEOMETRY_CHANGED','WINDOW_UNAVAILABLE','WINDOW_CLOAKED']);
const sendInterruptions=new Set(['POINTER_CHANGED_DURING_SEND','USER_INPUT_ACTIVE','INPUT_TARGET_OCCLUDED','INPUT_GEOMETRY_CHANGED','WINDOW_UNAVAILABLE','WINDOW_CLOAKED','INPUT_SEQUENCE_WINDOW_EXPIRED']);
export function completedWindowsDragReceipt(failure,context={}){
  if(context.command?.type!=='swipe'||!dragInterruptions.has(failure?.error))return null;
  const r=closedWindowsInputFailure(failure,context);if(!r||r.releaseInserted!==1)return null;
  return {...r,status:'issued',error:null,completionReason:failure.error==='POINTER_CHANGED_DURING_DRAG'?'pointer_changed_during_drag':'drag_interrupted',nativeInputFailure:structuredClone(failure)};
}
export function completedWindowsSendReceipt(failure,context={},inputSequence){
  if(context.command?.type!=='tap'||inputSequence?.kind!=='som_helicopter_send_skip'||inputSequence.delayMs!==100||
    inputSequence.clickCount!==2||!sendInterruptions.has(failure?.error))return null;
  const r=closedWindowsInputFailure(failure,context);
  if(!r||r.plannedClicks!==2||r.completedClicks!==1||r.attempted!==3||r.releaseInserted!==0)return null;
  return {...r,status:'issued',error:null,completionReason:'send_skip_omitted',nativeInputFailure:structuredClone(failure),interruptionContext:structuredClone(context)};
}
