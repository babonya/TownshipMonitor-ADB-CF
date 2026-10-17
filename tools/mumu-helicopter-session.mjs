import {clearObservationWait} from './mumu-observation-wait-lifecycle.mjs';
import {sameSelectionCaptureTarget,helicopterProfile,validateMiniGameSelectionSource} from './mumu-helicopter-proof.mjs';
import {validUnambiguousNavigationPins,sameNavigationPins} from './mumu-continuity.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {helicopterSelectionMarkerRegistration} from './mumu-helicopter-selection-marker.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {readFileSync} from 'node:fs';
import {digest,decodePng,regionDigest} from './adb.mjs';
import {rejectedPreflight} from './mumu-rejected-preflight.mjs';
import {compareReviewedTarget} from './mumu-verification.mjs';
import {commandForTarget,inputGeometry} from './percentage-coordinates.mjs';

const point=id=>/^pin:([0-9]+):([0-9]+)$/.exec(id??'')?.slice(1).map(Number);
const pinMatches=(a,b)=>sameNavigationPins([a],[b]);
const boundAnalysis=(frame,a)=>a?.status==='candidate'&&a.scene?.kind==='helicopter'&&a.frameId===frame.id&&a.evidenceHash===frame.evidenceHash&&
  a.epoch===frame.epoch&&a.sequence===frame.sequence&&a.observedAt===frame.observedAt&&a.helicopterProfileHash===helicopterProfile(frame).hash;
const uniqueLocations=pins=>validUnambiguousNavigationPins(pins)&&pins.every(a=>pins.filter(b=>Math.hypot(a.box.x-b.box.x,a.box.y-b.box.y)<=24).length===1);
const mapIds=(ids,pins)=>[...new Set(ids.flatMap(id=>{
    const p=point(id);if(!p)return [];
    const matches=pins.filter(q=>Math.hypot(q.box.x+q.box.width/2-p[0],q.box.y+q.box.height/2-p[1])<=24);
    return matches.length===1?[matches[0].mapId]:[];
}))];
function sameCapture(a,b){
    return a&&b&&a.provider==='google_play_windows'&&a.provider===b.provider&&typeof a.serial==='string'&&a.serial&&a.serial===b.serial&&
      a.width===1578&&a.height===1268&&a.width===b.width&&a.height===b.height&&a.captureTarget&&b.captureTarget&&
      sameSelectionCaptureTarget(a.captureTarget,b.captureTarget);
}
function sameScope(a,b){
    return sameCapture(a,b)&&acceptedFacts(a)&&acceptedFacts(b)&&
      a.review.actualKind==='helicopter'&&b.review.actualKind==='helicopter'&&
      a.review.proof?.profileHash===helicopterProfile(b).hash&&a.review.proof.profileHash===b.review.proof?.profileHash;
}
function verifiedPath(state,before,after){
    if(state.observationInvalidation?.sequence>=before.sequence)return false;
    let current=after;const seen=new Set();
    while(current.sceneId!==before.sceneId){
      if(seen.has(current.sceneId))return false;seen.add(current.sceneId);
      const incoming=Object.values(state.actions??{}).filter(a=>a.nextVisit?.visitId===current.sceneId);
      if(incoming.length!==1)return false;
      const a=incoming[0],source=state.frames[a.frameId],result=state.frames[a.resultFrameId],proof=a.resultProof?.navigation;
      if(a.status!=='verified'||!source||!result||!acceptedFacts(result)||result.sceneId!==current.sceneId||result.epoch!==current.epoch||
        result.sequence>current.sequence||a.epoch!==result.epoch||source.epoch+1!==a.epoch||proof?.confirmed!==true||
        proof.actionId!==a.id||proof.frameId!==result.id||a.resultProof.frameId!==result.id||a.resultProof.evidenceHash!==result.evidenceHash||
        !sameCapture(source,after)||!sameCapture(result,after))return false;
      if(a.target?.kind==='select_customer'&&a.target.currentHelicopterSelection?.sourceFrameId===source.id&&
          a.target.currentHelicopterSelection.sourceHash===source.evidenceHash&&proof.profileHash===helicopterProfile(after).hash&&
          proof.kind==='mini_game_order_selection'&&proof.sourceFrameId===source.id&&proof.sourceHash===source.evidenceHash&&proof.evidenceHash===result.evidenceHash){
        if(!sameScope(source,after))return false;current=source;
      }else if(a.target?.helicopterProductInfo?.mode==='dismiss'&&proof.mode==='dismiss'){
        const tag=a.target.helicopterProductInfo,origin=state.frames[tag.sourceFrameId];
        if(!origin||origin.evidenceHash!==tag.sourceHash||!sameScope(origin,after)||origin.sequence>=current.sequence||
          proof.sourceFrameId!==origin.id||proof.sourceHash!==origin.evidenceHash)return false;
        current=origin;
      }else return false;
    }
    return current.epoch===before.epoch&&current.sequence>=before.sequence;
}
// This exception is scheduling-only, and only for a target rejected before input
// reservation. An unchanged scene ID alone never explains an epoch change.
function rejectedSelectionContinuity(coordinator,state,before,after){
    try{
      if(state.input!==null||hasUnresolvedActions(state.actions??{})||state.stopCapture||state.stopReader||
        state.latestFrameId!==after.id||state.scene.id!==after.sceneId||state.scene.epoch!==after.epoch||state.scene.transitioning||
        after.review.reviewedBy!=='program-helicopter'||after.review.proof.inputId!==null||
        before.sceneId!==after.sceneId||before.epoch+1!==after.epoch||before.sequence>=after.sequence||
        state.observationInvalidation?.sequence>=before.sequence||state.orderDemandStartup?.cutoffSequence>=before.sequence||
        state.session?.provider!==before.provider||state.session.serial!==before.serial||
        Object.values(state.externalHelicopterSelectionResolutions??{}).some(r=>r.visitId===before.sceneId))return null;
      const edges=Object.values(state.actions??{}).filter(a=>a.epoch===after.epoch);
      if(edges.length!==1)return null;
      const a=edges[0],source=state.frames[a.frameId],target=source?.review?.targets?.find(t=>t.id===a.targetId),sha=v=>digest(Buffer.from(JSON.stringify(v)));
      if(source?.id!==before.id||source.evidenceHash!==before.evidenceHash||a.status!=='rejected_before_input'||a.inputAttempted!==false||
        a.error!=='NAVIGATION_TARGET_CHANGED'||a.management!==false||target?.kind!=='select_customer'||target.type!=='tap'||
        target.currentHelicopterSelection?.sourcePanel!=='normal_order'||sha(a.target)!==sha(target)||
        a.nextVisit?.kind!=='helicopter'||a.nextVisit.visitId!==a.id+'-result'||state.visits?.[a.nextVisit.visitId]||
        a.coordinateSource?.frameId!==before.id||a.coordinateSource.evidenceHash!==before.evidenceHash||
        a.requestDigest!==sha({actionId:a.id,frameId:before.id,targetId:target.id,nextVisit:a.nextVisit,swipe:null}))return null;
      // Exclude every indication that input was reserved, issued, or had effects.
      const forbidden=['inputReservedAt','issuedAt','deviceReceipt','deviceRejectionProof','nativeInputFailure','resultFrameId','resultProof',
        'resultCaptureNotBeforeAt','effect','effects','actionResult','inventoryDeltas','inventoryInvalidated','capacityDelta','coinDelta',
        'accounted','accountedAt','accountedRevision','receipt','receiptId'];
      if(forbidden.some(key=>Object.hasOwn(a,key))||state.transportMissions?.[a.id]||Object.values(state.transportMissions??{}).some(m=>m.waitingActionId===a.id||m.receipts?.some(r=>r.actionId===a.id))||
        Object.values(state.frames??{}).some(f=>f.review?.data?.actionResult?.actionId===a.id))return null;
      validateMiniGameSelectionSource(before,target);
      const expected=commandForTarget(target,null,inputGeometry(state.session,before));
      if(sha(expected.command)!==sha(a.command)||sha(expected.coordinates)!==sha(a.percentageCommand))return null;
      const p=a.preflightEvidence;
      if(!p||!sameCapture(before,p))return null;
      const times=[before.observedAt,a.at,a.preflightStartedAt,p.captureStartedAt,p.observedAt,a.preflightCapturedAt,a.finishedAt,after.captureStartedAt,after.observedAt].map(Date.parse);
      if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1]))return null;
      if(Object.values(state.actions??{}).some(other=>other.id!==a.id&&
        Date.parse(other.at)>=times[0]&&Date.parse(other.at)<=times.at(-1)))return null;
      rejectedPreflight(coordinator.store,a,before);
      const old=coordinator.store.evidence(before.id),fresh=coordinator.store.evidence(after.id);
      if(old.frame.evidenceHash!==before.evidenceHash||fresh.frame.evidenceHash!==after.evidenceHash||
        digest(old.bytes)!==before.evidenceHash||digest(fresh.bytes)!==after.evidenceHash)return null;
      const original=decodePng(old.bytes),current=decodePng(fresh.bytes),preflight=decodePng(readFileSync(p.evidenceRef));
      if(original.width!==before.width||original.height!==before.height||current.width!==after.width||current.height!==after.height)return null;
      // A changed anchor/order grid is not this narrow pin-animation rejection.
      for(const box of [...target.verification.anchorBoxes,...target.verification.criticalRegions.map(r=>r.box)]){
        const hash=regionDigest(original,box);
        if(regionDigest(preflight,box)!==hash||regionDigest(current,box)!==hash)return null;
      }
      let rejected=false;
      try{compareReviewedTarget(original,preflight,target,{management:false});}
      catch(error){if(error.message!=='NAVIGATION_TARGET_CHANGED')return null;rejected=true;}
      const oldPins=before.review.data.helicopter.mapTargets,pins=after.review.data.helicopter.mapTargets;
      if(!rejected||!uniqueLocations(oldPins)||!uniqueLocations(pins)||!sameNavigationPins(oldPins,pins))return null;
      const mapped=mapIds([target.mapId],pins);if(mapped.length!==1)return null;
      return {kind:'rejected_before_input',actionId:a.id,mapId:mapped[0]};
    }catch{return null;}
}
function schedulingContinuity(coordinator,frame){
    const state=coordinator.store.load(),before=state.frames[coordinator.helicopterMapFrameId];
    if(coordinator.helicopterSchedulingProfileHash&&coordinator.helicopterSchedulingProfileHash!==helicopterSelectionMarkerRegistration().hash||!sameScope(before,frame))return null;
    return verifiedPath(state,before,frame)?{kind:'verified'}:rejectedSelectionContinuity(coordinator,state,before,frame);
}
export function helicopterSchedulingContinues(coordinator,frame){return schedulingContinuity(coordinator,frame)!==null;}
// Mark the failed location as an exclusion, never as the currently selected pin.
// The existing pass and selected pin survive; reviewed current targets stay fresh.
export function continueHelicopterScheduling(coordinator,frame){
    const continuity=schedulingContinuity(coordinator,frame);if(!continuity)return false;
    if(continuity.kind==='rejected_before_input'){
      const pass=coordinator.helicopterSurvey;
      if(pass&&(!['survey','collect'].includes(pass.phase)||!Array.isArray(pass.visited)||!Array.isArray(pass.collectVisited)))return false;
      const list=pass?(pass.phase==='collect'?pass.collectVisited:pass.visited):(coordinator.helicopterVisited??=[]);
      if(!Array.isArray(list))return false;
      if(!list.includes(continuity.mapId))list.push(continuity.mapId);
    }
    return true;
}
// Disposable exclusions survive only this coordinator's supported map refresh.
// The canonical observation fence still retires all order/owned-count facts.
export function retainHelicopterSurveyContinuity(coordinator,frame,analysis,visitId){
    const state=coordinator.store.load(),before=state.frames[coordinator.helicopterMapFrameId],previous=coordinator.helicopterMapPins;
    if(state.input||hasUnresolvedActions(state.actions??{})||state.latestFrameId!==frame.id||state.scene.id!==frame.sceneId||state.scene.epoch!==frame.epoch||
      !helicopterSchedulingContinues(coordinator,frame)||!boundAnalysis(frame,analysis)||!uniqueLocations(previous)||
      !uniqueLocations(analysis?.mapTargets))return null;
    const prior=coordinator.helicopterContinuityArchive,known=prior?.pins??previous,current=analysis.mapTargets;
    if(!uniqueLocations(known)||Math.abs(previous.length-current.length)>1)return null;
    const common=previous.filter(a=>current.filter(b=>pinMatches(a,b)).length===1);
    if(common.length<Math.max(previous.length,current.length)-1)return null;
    if(known.some(a=>current.filter(b=>pinMatches(a,b)).length>1)||current.some(b=>known.filter(a=>pinMatches(a,b)).length>1))return null;
    const pins=[...known.filter(a=>!current.some(b=>pinMatches(a,b))),...current];
    if(!uniqueLocations(pins))return null;
    const pass=coordinator.helicopterSurvey;
    const exclusions=key=>mapIds([...(prior?.[key]??[]),...(pass?.[key]??[])],pins);
    return {visitId,epoch:frame.epoch+1,afterSequence:frame.sequence,frame:structuredClone(frame),pins:structuredClone(pins),
      incarnation:state.orderDemandStartup?.currentIncarnation??null,profileHash:helicopterProfile(frame).hash,
      markerProfileHash:helicopterSelectionMarkerRegistration().hash,
      phase:pass?.phase??null,visited:exclusions('visited'),collectVisited:exclusions('collectVisited'),
      selectedMapId:pass?.selectedMapId??null,helicopterVisited:mapIds([...(prior?.helicopterVisited??[]),...(coordinator.helicopterVisited??[])],pins)};
}
export function restoreHelicopterSurveyContinuity(coordinator,frame,analysis){
    const memory=coordinator.helicopterPendingContinuity;if(!memory)return false;
    coordinator.helicopterPendingContinuity=null;
    const state=coordinator.store.load(),fence=state.observationInvalidation;
    if(state.input||hasUnresolvedActions(state.actions??{})||state.latestFrameId!==frame.id||state.scene.id!==frame.sceneId||state.scene.epoch!==frame.epoch||
      !sameScope(memory.frame,frame)||!boundAnalysis(frame,analysis)||frame.sceneId!==memory.visitId||frame.epoch!==memory.epoch||frame.sequence<=memory.afterSequence||
      fence?.reason!=='helicopter_map_changed'||fence.sceneId!==memory.visitId||fence.sequence!==memory.afterSequence||
      (state.orderDemandStartup?.currentIncarnation??null)!==memory.incarnation||!sameScope(memory.frame,frame)||
      helicopterProfile(frame).hash!==memory.profileHash||helicopterSelectionMarkerRegistration().hash!==memory.markerProfileHash||!uniqueLocations(analysis?.mapTargets)||
      analysis.mapTargets.some(b=>memory.pins.filter(a=>pinMatches(a,b)).length!==1))return false;
    coordinator.helicopterVisited=mapIds(memory.helicopterVisited,analysis.mapTargets);
    if(memory.phase)coordinator.helicopterSurvey={phase:memory.phase,visited:mapIds(memory.visited,analysis.mapTargets),
      collectVisited:mapIds(memory.collectVisited,analysis.mapTargets),selectedMapId:mapIds([memory.selectedMapId],analysis.mapTargets)[0]??null};
    coordinator.helicopterContinuityArchive=memory;
    coordinator.helicopterVisitId=frame.sceneId;
    return true;
}
// Invoke only after the fresh canonical visit and invalidation fence are committed.
export function resetHelicopterObservationSession(coordinator){
    coordinator.helicopterSelectionSeed=null;coordinator.helicopterVisited=[];coordinator.helicopterVisitId=null;coordinator.helicopterMapPins=null;coordinator.helicopterMapFrameId=null;coordinator.helicopterSurvey=null;
    coordinator.navigationActionId=null;coordinator.currentHelicopterExhausted=null;coordinator.helicopterExhaustedFrameId=null;
    coordinator.lastKey=null;coordinator.passiveObservationKey=null;coordinator.mapState=null;
    coordinator.helicopterPendingContinuity=null;coordinator.helicopterContinuityArchive=null;coordinator.helicopterSelectedMapId=null;coordinator.helicopterSchedulingProfileHash=null;
    clearObservationWait(coordinator);coordinator.observationFailure=null;
}
