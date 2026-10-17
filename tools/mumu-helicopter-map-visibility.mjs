import {sameNavigationPins} from './mumu-continuity.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {helicopterProfile,sameSelectionCaptureTarget} from './mumu-helicopter-proof.mjs';

// Scheduling only. Never manufacture a hidden pin or an input target.
function selectedPoint(state,frame){
  if(!frame||frame.provider!=='google_play_windows'||!acceptedFacts(frame)||frame.review.actualKind!=='helicopter')return null;
  let current=frame;const seen=new Set();
  while(!seen.has(current.sceneId)){
    seen.add(current.sceneId);
    const incoming=Object.values(state.actions).filter(a=>a.nextVisit?.visitId===current.sceneId);
    if(incoming.length!==1)return null;
    const action=incoming[0],source=state.frames[action.frameId],result=state.frames[action.resultFrameId],proof=action.resultProof?.navigation;
    if(action.status!=='verified'||action.nextVisit.kind!=='helicopter'||!source||!result||!acceptedFacts(result)||
      result.sceneId!==current.sceneId||result.epoch!==current.epoch||action.epoch!==current.epoch||source.epoch+1!==action.epoch||
      proof?.confirmed!==true||proof.actionId!==action.id||proof.frameId!==result.id||
      action.resultProof.frameId!==result.id||action.resultProof.evidenceHash!==result.evidenceHash||result.sequence>current.sequence||
      source.provider!==frame.provider||source.serial!==frame.serial||source.width!==frame.width||source.height!==frame.height||
      !sameSelectionCaptureTarget(source.captureTarget,frame.captureTarget)||!sameSelectionCaptureTarget(result.captureTarget,frame.captureTarget)||
      state.observationInvalidation?.sequence>=source.sequence)return null;
    const selection=action.target?.currentHelicopterSelection;
    if(action.target?.kind==='select_customer'&&selection?.sourceFrameId===source.id&&selection.sourceHash===source.evidenceHash&&
      proof.kind==='mini_game_order_selection'&&proof.profileHash===helicopterProfile(frame).hash&&
      proof.sourceFrameId===source.id&&proof.sourceHash===source.evidenceHash&&proof.evidenceHash===result.evidenceHash&&
      action.command?.type==='tap'&&Number.isFinite(action.command.x)&&Number.isFinite(action.command.y))return action.command;
    const tag=action.target?.helicopterProductInfo;
    // A completed tooltip does not change which map pin is selected.
    if(tag?.mode!=='dismiss'||proof.mode!=='dismiss'||proof.sourceFrameId!==tag.sourceFrameId||proof.sourceHash!==tag.sourceHash)return null;
    const origin=state.frames[tag.sourceFrameId];
    if(!origin||origin.evidenceHash!==tag.sourceHash||origin.sequence>=current.sequence)return null;
    current=origin;
  }
  return null;
}

export function sameVisibleNavigationMap(state,before,after,beforeFrame,afterFrame){
  if(sameNavigationPins(before,after))return true;
  if(!sameNavigationPins(before,before)||!sameNavigationPins(after,after)||Math.abs(before.length-after.length)!==1)return false;
  const [large,small,frame]=before.length>after.length?[before,after,afterFrame]:[after,before,beforeFrame];
  if(!beforeFrame||!afterFrame||beforeFrame.provider!==afterFrame.provider||beforeFrame.serial!==afterFrame.serial||
    beforeFrame.width!==afterFrame.width||beforeFrame.height!==afterFrame.height||
    !sameSelectionCaptureTarget(beforeFrame.captureTarget,afterFrame.captureTarget))return false;
  const missing=large.filter(a=>!small.some(b=>sameNavigationPins([a],[b])));
  if(missing.length!==1||missing[0].pinState!=='red'||!sameNavigationPins(large.filter(a=>a!==missing[0]),small))return false;
  const point=selectedPoint(state,frame);
  if(!point||small.filter(p=>p.pinState==='red'&&Math.hypot(p.box.x+p.box.width/2-point.x,p.box.y+p.box.height/2-point.y)<=24).length!==1)return false;
  const scale=helicopterProfile(frame).profile.pinScale??1,box=missing[0].box;
  const dx=(box.x+box.width/2-point.x)/frame.width,dy=(point.y-box.y-box.height/2)/frame.height;
  // Existing detector's maximum pin body, expressed in the registered frame.
  // At most one neighbouring red tip can be hidden by the enlarged selection.
  return Math.abs(dx)<=70*scale/frame.width&&dy>24/frame.height&&dy<=170*scale/frame.height;
}
