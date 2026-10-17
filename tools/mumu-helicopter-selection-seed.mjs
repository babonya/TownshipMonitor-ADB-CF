import {digest} from './adb.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {helicopterProfile,sameSelectionCaptureTarget} from './mumu-helicopter-proof.mjs';
import {sameNavigationPins,validUnambiguousNavigationPins} from './mumu-continuity.mjs';
import {detectHelicopterSelectionMarker,helicopterSelectionMarkerRegistration} from './mumu-helicopter-selection-marker.mjs';

const sha=v=>digest(Buffer.from(JSON.stringify(v??null)));
const actions=s=>sha(Object.entries(s.actions??{}).sort(([a],[b])=>a.localeCompare(b)));
const unique=pins=>validUnambiguousNavigationPins(pins)&&pins.length>0&&
  new Set(pins.map(p=>p.mapId)).size===pins.length&&pins.every(p=>typeof p.mapId==='string'&&
    pins.filter(q=>Math.hypot(p.box.x-q.box.x,p.box.y-q.box.y)<=24).length===1);
function current(coordinator,state,frame,analysis){
  return coordinator.currentMode===true&&!state.input&&!hasUnresolvedActions(state.actions??{})&&!state.stopCapture&&!state.stopReader&&
    state.latestFrameId===frame.id&&state.scene.id===frame.sceneId&&state.scene.epoch===frame.epoch&&!state.scene.transitioning&&
    state.session.provider===frame.provider&&state.session.serial===frame.serial&&
    typeof state.orderDemandStartup?.currentIncarnation==='string'&&state.orderDemandStartup.currentIncarnation&&
    frame.sequence>state.orderDemandStartup.cutoffSequence&&inputEvidenceValid(frame,coordinator.store.clock(),state)&&acceptedFacts(frame)&&frame.review.reviewedBy==='program-helicopter'&&
    frame.review.actualKind==='helicopter'&&frame.review.data?.order?.kind==='normal'&&
    /^[a-f0-9]{64}$/.test(frame.review.data.helicopter?.selectionGridHash??'')&&
    frame.review.proof.profileHash===helicopterProfile(frame).hash&&analysis?.helicopterProfileHash===helicopterProfile(frame).hash&&
    analysis.status==='candidate'&&analysis.scene?.kind==='helicopter'&&analysis.frameId===frame.id&&analysis.evidenceHash===frame.evidenceHash&&
    analysis.sequence===frame.sequence&&analysis.epoch===frame.epoch&&analysis.observedAt===frame.observedAt&&unique(analysis.mapTargets)&&
    sameNavigationPins(frame.review.data.helicopter.mapTargets,analysis.mapTargets);
}
// A single scheduling exclusion, never an order/stock observation or input target.
// Only the result callback may capture this; nothing is restored from disk.
export function captureHelicopterSelectionSeed(coordinator,frame,analysis,actionId){
  coordinator.helicopterSelectionSeed=null;
  try{
    const state=coordinator.store.load();frame=state.frames[frame.id];
    if(!frame||!current(coordinator,state,frame,analysis))return false;
    const action=state.actions[actionId],proof=action?.resultProof,nav=proof?.navigation;
    if(action?.status!=='verified'||action.target?.kind!=='open_helicopter'||action.target.marketTownNavigation?.role!=='order_return'||
      action.deviceReceipt?.commandIssued!==true||action.deviceReceipt.actionId!==actionId||action.command?.type!=='tap'||
      action.resultFrameId!==frame.id||action.nextVisit?.kind!=='helicopter'||action.nextVisit.visitId!==frame.sceneId||action.epoch!==frame.epoch||
      proof?.schema!==1||proof.frameId!==frame.id||proof.evidenceHash!==frame.evidenceHash||proof.sequence!==frame.sequence||
      proof.observedAt!==frame.observedAt||sha(proof.review)!==sha(frame.review)||nav?.confirmed!==true||
      nav.actionId!==actionId||nav.frameId!==frame.id||nav.to!=='helicopter'||frame.review.proof.inputId!==actionId)return false;
    const marker=detectHelicopterSelectionMarker(frame,coordinator.store.evidence(frame.id),analysis);
    if(marker.status!=='selected'||analysis.mapTargets.filter(p=>p.mapId===marker.mapId).length!==1)return false;
    coordinator.helicopterSelectionSeed={frameId:frame.id,evidenceHash:frame.evidenceHash,sequence:frame.sequence,
      sceneId:frame.sceneId,epoch:frame.epoch,provider:frame.provider,serial:frame.serial,width:frame.width,height:frame.height,
      observedAt:frame.observedAt,captureStartedAt:frame.captureStartedAt,
      captureTarget:structuredClone(frame.captureTarget),sessionId:state.session.id,incarnation:state.orderDemandStartup.currentIncarnation,
      startupHash:sha(state.orderDemandStartup),invalidationHash:sha(state.observationInvalidation),actionsHash:actions(state),
      reviewHash:sha(frame.review),profileHash:helicopterProfile(frame).hash,markerProfileHash:marker.profileHash,gridHash:frame.review.data.helicopter.selectionGridHash,
      pins:structuredClone(analysis.mapTargets),mapId:marker.mapId};
    return true;
  }catch{return false;}
}
export function consumeHelicopterSelectionSeed(coordinator,frame,analysis){
  const seed=coordinator.helicopterSelectionSeed;coordinator.helicopterSelectionSeed=null;
  if(!seed)return null;
  try{
    const state=coordinator.store.load();frame=state.frames[frame.id];
    const times=[seed.captureStartedAt,seed.observedAt,frame?.captureStartedAt,frame?.observedAt].map(Date.parse);
    if(!frame||!current(coordinator,state,frame,analysis)||frame.review.proof.inputId!==null||frame.sequence<=seed.sequence||
      times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1])||
      state.session.id!==seed.sessionId||state.orderDemandStartup.currentIncarnation!==seed.incarnation||
      sha(state.orderDemandStartup)!==seed.startupHash||sha(state.observationInvalidation)!==seed.invalidationHash||actions(state)!==seed.actionsHash||
      frame.sceneId!==seed.sceneId||frame.epoch!==seed.epoch||frame.provider!==seed.provider||frame.serial!==seed.serial||
      frame.width!==seed.width||frame.height!==seed.height||!sameSelectionCaptureTarget(seed.captureTarget,frame.captureTarget)||
      helicopterProfile(frame).hash!==seed.profileHash||helicopterSelectionMarkerRegistration().hash!==seed.markerProfileHash||
      frame.review.data.helicopter.selectionGridHash!==seed.gridHash||!sameNavigationPins(seed.pins,analysis.mapTargets)||
      state.frames[seed.frameId]?.evidenceHash!==seed.evidenceHash||sha(state.frames[seed.frameId]?.review)!==seed.reviewHash||
      Object.values(state.frames).some(f=>f.sequence>seed.sequence&&f.sequence<frame.sequence&&acceptedFacts(f)&&
        f.review.actualKind==='helicopter'&&f.review.data?.order?.kind==='normal'))return null;
    const old=seed.pins.filter(p=>p.mapId===seed.mapId);
    if(old.length!==1)return null;
    const pins=analysis.mapTargets.filter(p=>sameNavigationPins(old,[p]));
    if(pins.length!==1)return null;
    const marker=detectHelicopterSelectionMarker(frame,coordinator.store.evidence(frame.id),analysis);
    if(marker.status==='selected'?marker.mapId!==pins[0].mapId:marker.reason!=='HELICOPTER_SELECTION_MARKER_NOT_VISIBLE')return null;
    return pins[0].mapId;
  }catch{return null;}
}
