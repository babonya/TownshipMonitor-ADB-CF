import {digest,regionDigest} from './adb.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {helicopterProfile,sameSelectionCaptureTarget,validateMiniGameSelectionSource} from './mumu-helicopter-proof.mjs';
import {helicopterSelectionMarkerRegistration} from './mumu-helicopter-selection-marker.mjs';
import {helicopterInfoRegistration} from './mumu-helicopter-info-proof.mjs';
import {sameNavigationPins} from './mumu-continuity.mjs';
import {observeMarketTown} from './mumu-market.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {sameRootPath} from './mumu-path-identity.mjs';

const sha=v=>digest(Buffer.from(JSON.stringify(v??null)));
const actions=s=>sha(Object.entries(s.actions??{}).sort(([a],[b])=>a.localeCompare(b)));
// Monitor pause/start and option changes replace both MumuStore and delivery.
// Retain only consumption identities for this process, never seed/order/state.
// The supported bridge replacement path starts a new GUI startup incarnation.
const consumedRecoveryQuotas=[];
const sameQuota=(a,b)=>a.sessionId===b.sessionId&&a.incarnation===b.incarnation&&sameRootPath(a.root,b.root);
const recoveryQuota=(c,state)=>typeof c.store.root==='string'&&c.store.root&&typeof state.session.id==='string'&&state.session.id?
  {root:c.store.root,sessionId:state.session.id,incarnation:state.orderDemandStartup?.currentIncarnation}:null;
const reason='HELICOPTER_SELECTION_BOOTSTRAP_RECOVERY_HELD';
const fail=()=>{throw Error(reason);};
function idle(state,frame){
  if(state.input||hasUnresolvedActions(state.actions??{})||state.stopCapture||state.stopReader||state.scene.transitioning||
    state.latestFrameId!==frame.id||state.scene.id!==frame.sceneId||state.scene.epoch!==frame.epoch||
    !inputEvidenceValid(frame,Date.parse(frame.observedAt),state))fail();
}
function identity(state,frame,r){
  if(state.session.id!==r.sessionId||state.session.provider!==frame.provider||state.session.serial!==frame.serial||
    sha(state.orderDemandStartup)!==r.startupHash||sha(state.session.management)!==r.policyHash||
    frame.provider!==r.provider||frame.serial!==r.serial||frame.width!==r.width||frame.height!==r.height||
    !sameSelectionCaptureTarget(r.captureTarget,frame.captureTarget)||helicopterProfile(frame).hash!==r.profileHash||
    helicopterSelectionMarkerRegistration().hash!==r.markerProfileHash)fail();
}
// Consume once per startup incarnation across coordinator and store recreation.
// An uncertain or rejected transition cannot arm another attempt.
export function armHelicopterSelectionRecovery(c,frame,marker){
  try{
    const state=c.guard().state,incarnation=state.orderDemandStartup?.currentIncarnation,quota=recoveryQuota(c,state);
    if(!quota||consumedRecoveryQuotas.some(prior=>sameQuota(prior,quota))||
      !c.currentMode||typeof incarnation!=='string'||!incarnation||c.helicopterSelectionRecovery?.incarnation===incarnation||
      c.helicopterSelectionSeed||c.helicopterSelectedMapId||c.helicopterSurvey?.selectedMapId||
      marker?.status!=='hold'||marker.reason!=='HELICOPTER_SELECTION_MARKER_NOT_VISIBLE'||marker.frameId!==frame.id||
      marker.evidenceHash!==frame.evidenceHash||marker.profileHash!==helicopterSelectionMarkerRegistration().hash)return false;
    idle(state,frame);identity(state,frame,{sessionId:state.session.id,startupHash:sha(state.orderDemandStartup),policyHash:sha(state.session.management),
      provider:frame.provider,serial:frame.serial,width:frame.width,height:frame.height,captureTarget:frame.captureTarget,
      profileHash:helicopterProfile(frame).hash,markerProfileHash:marker.profileHash});
    if(!acceptedFacts(frame)||frame.review.reviewedBy!=='program-helicopter'||frame.review.proof.inputId!==null||
      frame.review.data?.order?.kind!=='normal'||!inputEvidenceValid(frame,c.store.clock(),state))return false;
    const target=frame.review.targets.find(t=>t.kind==='select_customer'&&t.currentHelicopterSelection?.sourcePanel==='normal_order');
    if(!target)return false;validateMiniGameSelectionSource(frame,target);
    consumedRecoveryQuotas.push(quota);
    c.helicopterSelectionRecovery={incarnation,phase:'armed',sourceFrameId:frame.id,sourceHash:frame.evidenceHash,
      sessionId:state.session.id,startupHash:sha(state.orderDemandStartup),policyHash:sha(state.session.management),
      provider:frame.provider,serial:frame.serial,width:frame.width,height:frame.height,captureTarget:structuredClone(frame.captureTarget),
      profileHash:helicopterProfile(frame).hash,markerProfileHash:marker.profileHash,
      invalidationHash:sha(state.observationInvalidation),actionsHash:actions(state)};
    return true;
  }catch{return false;}
}
export async function continueHelicopterSelectionRecovery(c,frame){
  const r=c.helicopterSelectionRecovery;if(!r||r.phase!=='armed')return null;
  // Consume before any await or input preparation, including rejected attempts.
  r.phase='preparing';
  try{
    const state=c.guard({context:'navigation'}).state,source=state.frames[r.sourceFrameId];
    const boundary=checked=>{
      idle(checked,frame);identity(checked,frame,r);
      if(!source||source.evidenceHash!==r.sourceHash||!acceptedFacts(source)||!inputEvidenceValid(source,c.store.clock(),checked)||
        !inputEvidenceValid(frame,c.store.clock(),checked)||
        frame.sequence<=source.sequence||frame.sceneId!==source.sceneId||frame.epoch!==source.epoch||
        sha(checked.observationInvalidation)!==r.invalidationHash||actions(checked)!==r.actionsHash||
        c.helicopterSelectionSeed||c.helicopterSelectedMapId||c.helicopterSurvey?.selectedMapId)fail();
      const times=[source.observedAt,frame.captureStartedAt,frame.observedAt].map(Date.parse);
      if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1]))fail();
      return true;
    };
    boundary(state);if(frame.review)fail();
    const old=c.store.evidence(source.id),fresh=c.store.evidence(frame.id),target=source.review.targets.find(t=>
      t.kind==='select_customer'&&t.currentHelicopterSelection?.sourcePanel==='normal_order');
    validateMiniGameSelectionSource(source,target);
    if(digest(old.bytes)!==source.evidenceHash||digest(fresh.bytes)!==frame.evidenceHash)fail();
    for(const box of [...target.verification.anchorBoxes,...target.verification.criticalRegions.map(x=>x.box)])
      if(regionDigest(old.image,box)!==regionDigest(fresh.image,box))fail();
    c.workers??=c.workersFactory();
    const analysis=await c.workers.matcher.analyze(frame,fresh.bytes,{helicopter:true,offline:true});
    if(analysis.status!=='candidate'||analysis.scene?.kind!=='helicopter'||analysis.frameId!==frame.id||
      analysis.evidenceHash!==frame.evidenceHash||analysis.sequence!==frame.sequence||analysis.epoch!==frame.epoch||
      analysis.observedAt!==frame.observedAt||analysis.helicopterProfileHash!==r.profileHash||
      !sameNavigationPins(source.review.data.helicopter.mapTargets,analysis.mapTargets))fail();
    const info=await c.workers.matcher.analyze(frame,fresh.bytes,{helicopterInfo:true,offline:true});
    if(info.status!=='candidate'||info.productInfoProfileHash!==helicopterInfoRegistration().hash||
      !Array.isArray(info.productInfo?.popups)||info.productInfo.popups.length)fail();
    boundary(c.guard({context:'navigation'}).state);
    const result=await c.exitPanel(frame,'helicopter',{kind:'helicopter',reason:'HELICOPTER_SELECTION_BOOTSTRAP_RECOVERY'},boundary);
    const after=c.store.load(),a=after.actions[c.navigationActionId];
    if(!after.input||after.input!==a?.id||a.target?.marketTownNavigation?.role!=='transport_exit'||a.frameId!==frame.id)fail();
    r.phase='closing';r.closeActionId=a.id;return result;
  }catch(error){r.phase='failed';return c.update('hold',error.message);}
}
export function verifiedSelectionRecoveryClose(c,frame,actionId){
  const r=c.helicopterSelectionRecovery;if(!r||r.phase!=='closing'||r.closeActionId!==actionId)return;
  const s=c.store.load(),a=s.actions[actionId],p=a?.resultProof;
  frame=s.frames[frame.id];
  if(!frame||s.input||a?.status!=='verified'||a.target?.marketTownNavigation?.role!=='transport_exit'||
    a.resultFrameId!==frame.id||p?.schema!==1||p.frameId!==frame.id||p.evidenceHash!==frame.evidenceHash||
    p.sequence!==frame.sequence||p.observedAt!==frame.observedAt||!acceptedFacts(frame)||sha(p.review)!==sha(frame.review)||p?.navigation?.confirmed!==true||
    p.navigation.actionId!==actionId||p.navigation.frameId!==frame.id||p.navigation.effect!=='helicopter_closed_to_registered_town'){
    r.phase='failed';fail();
  }
  r.phase='town';r.townFrameId=frame.id;r.actionsHash=actions(s);r.invalidationHash=sha(s.observationInvalidation);
}
// Called before generic town sourcing. Re-entry needs a new raw town original
// and the exact verified close; it never routes after an uncertain close.
export async function returnSelectionRecovery(c,frame){
  const r=c.helicopterSelectionRecovery;if(!r||!['town','failed'].includes(r.phase))return null;
  if(r.phase==='failed')return c.update('hold',reason);
  r.phase='preparing_return';c.busy=true;
  try{
    const state=c.guard({context:'navigation'}).state,town=state.frames[r.townFrameId];
    const boundary=checked=>{
      idle(checked,frame);identity(checked,frame,r);
      const a=checked.actions[r.closeActionId];
      if(!town||frame.review||frame.sequence<=town.sequence||frame.sceneId!==town.sceneId||frame.epoch!==town.epoch||
        !inputEvidenceValid(frame,c.store.clock(),checked)||
        a?.status!=='verified'||a.resultFrameId!==town.id||a.resultProof?.navigation?.confirmed!==true||
        a.resultProof.navigation.effect!=='helicopter_closed_to_registered_town'||actions(checked)!==r.actionsHash||
        sha(checked.observationInvalidation)!==r.invalidationHash)fail();
      const times=[town.observedAt,frame.captureStartedAt,frame.observedAt].map(Date.parse);
      if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1]))fail();
    };
    boundary(state);
    const observed=observeMarketTown(c.store,frame.id,{kind:'return_order'});
    const target=observed.review?.targets.find(t=>t.kind==='open_helicopter'&&t.marketTownNavigation?.role==='order_return');
    if(!observed.stored||!target)fail();
    const actionId=generatedActionId(c.store.load(),{frameId:frame.id,targetId:target.id,kind:'n'});
    c.navigationActionId=actionId;c.marketActionId=actionId;r.returnActionId=actionId;
    const beforeBegin=()=>{
      const checked=c.guard({context:'navigation'}).state;
      // The registered town observer just supplied this source review.
      if(checked.latestFrameId!==frame.id||checked.scene.id!==frame.sceneId||checked.scene.epoch!==frame.epoch||
        actions(checked)!==r.actionsHash||sha(checked.observationInvalidation)!==r.invalidationHash)fail();
      identity(checked,frame,r);
    };
    await navigateReviewed(c.store,{frameId:frame.id,actionId,targetId:target.id,
      nextVisit:{visitId:actionId+'-result',kind:'helicopter',required:true}},
      {device:c.device,beforeBegin,beforeInputGuard:()=>{
        const checked=c.guard({context:'navigation',phase:'owned-input'}).state;
        identity(checked,frame,r);if(checked.latestFrameId!==frame.id||checked.input!==actionId)fail();
      }});
    r.phase='entering';return c.update('waiting','HELICOPTER_SELECTION_BOOTSTRAP_RETURN_REQUIRED');
  }catch(error){r.phase='failed';return c.update('hold',error.message);}
  finally{c.busy=false;}
}
export function finishSelectionRecovery(c,actionId,seeded){
  const r=c.helicopterSelectionRecovery;
  if(r?.phase==='entering'&&r.returnActionId===actionId)r.phase=seeded?'done':'failed';
}
