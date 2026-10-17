import {resolvePercentageProfile} from './percentage-profile.mjs';
// Exact static regions from saved native evidence. Animated rewards and people
// never participate in recognition. This registration grants no input authority.
import {readFileSync} from 'node:fs';
import {digest,regionDigest} from './adb.mjs';
import {reviewFactHash} from './mumu-evidence.mjs';
import {MAYORS_CUP_ACTIVATION,MAYORS_CUP_CLAIM_GEOMETRY,MAYORS_CUP_OPEN_GEOMETRY} from './mumu-management.mjs';
import {validateCupOcr,CUP_STAGE_SOURCES} from './mumu-cup-ocr.mjs';
export const MAYORS_CUP_READER='program-mayors-cup';
export function mayorsCupProfile(){
  const bytes=readFileSync(new URL('../reference/mayors-cup/profile.json',import.meta.url));
  const profile=resolvePercentageProfile(JSON.parse(bytes));
  if(profile.schema!==1||profile.provider!=='google_play_windows'||profile.width!==1578||profile.height!==1268||
      JSON.stringify(profile.geometry)!==JSON.stringify(MAYORS_CUP_CLAIM_GEOMETRY))throw Error('MAYORS_CUP_PROFILE_CHANGED');
  return {profile,hash:digest(bytes)};
}
export function mayorsCupTarget(){return {id:'mayors-cup:claim',kind:'claim_mayors_cup_reward',type:'tap',
  ...structuredClone(MAYORS_CUP_CLAIM_GEOMETRY),management:{purpose:'transport',verified:true,currency:'NONE',
    source:'mayors_cup_first_claim',activationId:MAYORS_CUP_ACTIVATION,maxAttempts:1,rewardContents:'undisclosed'}};}
export function mayorsCupOpenTarget(predecessorActionId,stage='open'){return {id:'mayors-cup:'+stage,kind:'claim_mayors_cup_reward',type:'tap',
  ...structuredClone(MAYORS_CUP_OPEN_GEOMETRY),management:{purpose:'transport',verified:true,currency:'NONE',
    source:CUP_STAGE_SOURCES[stage],activationId:MAYORS_CUP_ACTIVATION,maxAttempts:1,rewardContents:'undisclosed',predecessorActionId}};}
export function readMayorsCup(image,registration=mayorsCupProfile()){
  const p=registration.profile;
  if(image.width!==p.width||image.height!==p.height||image.channels<3)
    return {supported:false,reason:'MAYORS_CUP_LAYOUT_REQUIRED',executionAllowed:false};
  const failed=p.regions.filter(r=>regionDigest(image,r.box)!==r.sha256).map(r=>r.field);
  return failed.length?{supported:false,reason:'MAYORS_CUP_STATIC_REGIONS_REQUIRED',failed,executionAllowed:false}:
    {supported:true,kind:'mayors_cup_result',targets:[mayorsCupTarget()],executionAllowed:false};
}
export function mayorsCupFacts(frame){return {title:"MAYOR'S CUP",status:'Finished',rank:2,claimText:'CLAIM',
  rewardContents:'undisclosed',priceVisible:false,advertisementVisible:false,couponVisible:false,selectionRequired:false,
  frameId:frame.id,evidenceHash:frame.evidenceHash,epoch:frame.epoch};}
export function mayorsCupProgramProof(frame,review,state,role){return {
  schema:'program-mayors-cup-1',role,frameId:frame.id,evidenceHash:frame.evidenceHash,profileHash:mayorsCupProfile().hash,
  inputId:state.input,invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review)};}
export function validateProgramMayorsCupProof(frame,image){
  const r=frame?.review;if(r?.reviewedBy!==MAYORS_CUP_READER)return;
  const p=r.proof,registration=mayorsCupProfile(),reject=()=>{throw Error('MAYORS_CUP_PROGRAM_PROOF_REQUIRED');};
  if(frame.provider!=='google_play_windows'||!p||p.schema!=='program-mayors-cup-1'||
      p.frameId!==frame.id||p.evidenceHash!==frame.evidenceHash||p.profileHash!==registration.hash||
      p.reviewHash!==reviewFactHash(r)||r.quality?.gameVisible!==true||r.quality.occluded!==false||r.actualEntityId!==null)reject();
  if(['open_source','open_result','claim_source','claim_result','continue_source','continue_result','complete_result'].includes(p.role)){
    validateCupOcr(frame,image,r.data?.mayorsCupOcr);
    const stage=p.role.split('_')[0];if(r.data.mayorsCupOcr.stage!==stage)reject();
    if(r.actualKind!==(stage==='complete'?'unknown':'mayors_cup_result')||Object.keys(r.data).length!==1||
      JSON.stringify(r.targets)!==JSON.stringify(p.role.endsWith('_source')?[mayorsCupOpenTarget(r.targets[0]?.management?.predecessorActionId,stage)]:[]))reject();
  }else if(p.role==='source'){
    if(r.actualKind!=='mayors_cup_result'||JSON.stringify(r.targets)!==JSON.stringify([mayorsCupTarget()])||
        JSON.stringify(r.data)!==JSON.stringify({mayorsCupClaim:mayorsCupFacts(frame)})||!readMayorsCup(image,registration).supported)reject();
  }else reject();
}
