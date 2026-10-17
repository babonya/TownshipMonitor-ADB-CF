import {isUnresolvedAction} from './mumu-input-state.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash,acceptedFacts} from './mumu-evidence.mjs';
import {readTransportNavigation,transportNavigationProfile,validateTransportNavigationProof} from './mumu-transport-navigation-proof.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
export async function observeTransportNavigation(store,{frameId,actionId=null,sourceKind='town'}={}){
 const state=store.load(),e=store.evidence(frameId),a=state.actions[actionId];
 if(state.stopCapture||state.stopReader)throw Error('SESSION_STOPPED');
 if(state.session.management?.source!=='explicit_user'||state.session.management.scope!=='transport_no_tcash')throw Error('MANAGEMENT_APPROVAL_REQUIRED');
 if(state.latestFrameId!==frameId||e.frame.epoch!==state.scene.epoch||!inputEvidenceValid(e.frame,store.clock(),state))throw Error('CURRENT_FRAME_REQUIRED');
 if(Object.values(state.actions).some(x=>x.id!==actionId&&isUnresolvedAction(x)))throw Error('INPUT_UNRESOLVED');
 const kind=actionId?a?.target?.transportNavigation?.to:sourceKind,reading=readTransportNavigation(e.image,kind,transportNavigationProfile(e.frame));
 if(!reading.supported)return {...reading,stored:false};
 if(!actionId&&!reading.targets.length)return {...reading,stored:false,reason:'REGISTERED_PANEL_EXIT_REQUIRED'};
 // Keep accepted order/accounting facts intact. A fresh ordinary original is
 // required when this image already owns a consumptive result or demand review.
 if(!actionId&&e.frame.review&&(e.frame.review.reviewedBy==='GPT'||Object.keys(e.frame.review.data??{}).length))
  return {...reading,stored:false,reason:'NAVIGATION_SOURCE_OBSERVATION_REQUIRED'};
 let navigationResult=null;
 if(actionId){
  const before=state.frames[a?.frameId];
  if(state.input!==actionId||!['issued','captured'].includes(a?.status)||a.management||a.inputAttempted!==true||a.epoch!==e.frame.epoch||
   a.nextVisit?.kind!==kind||!acceptedFacts(before)||before.review.reviewedBy!=='program-transport-navigation'||before.review.proof.role!=='source'||
   !before.review.targets.some(t=>JSON.stringify(t)===JSON.stringify(a.target))||e.frame.sequence<=before.sequence||e.frame.evidenceHash===before.evidenceHash||
   !Number.isFinite(Date.parse(a.issuedAt))||!Number.isFinite(Date.parse(e.frame.captureStartedAt))||Date.parse(e.frame.captureStartedAt)<Date.parse(a.issuedAt)+1000||
   (state.observationInvalidation?.sequence??-1)>=before.sequence)throw Error('OWNED_NAVIGATION_RESULT_REQUIRED');
  // An already issued input retains its source registration across a recognition
  // crop repair. Fresh input and preflight still require the current profile.
  const current=transportNavigationProfile(before),oldHash=before.review.proof.profileHash;
  validateTransportNavigationProof(before,oldHash===current.hash?current:transportNavigationProfile(before,oldHash));
  navigationResult={actionId,frameId,confirmed:true,from:a.target.transportNavigation.from,to:kind};
 }else if(state.input||state.scene.transitioning)throw Error('INPUT_UNRESOLVED');
 const review={reviewedBy:'program-transport-navigation',quality:{gameVisible:true,occluded:false},actualKind:kind,actualEntityId:null,data:{},targets:actionId?[]:reading.targets};
 const profile=transportNavigationProfile(e.frame);
 review.proof={schema:'program-transport-navigation-1',role:actionId?'result':'source',frameId,evidenceHash:e.frame.evidenceHash,
  profileHash:profile.hash,inputId:state.input,invalidationSequence:state.observationInvalidation?.sequence??null,
  navigationResult,reviewHash:reviewFactHash(review)};
 await store.retry(()=>store.pinFrame(frameId,{ocr:false}));
 await store.retry(()=>store.review({frameId,...review,programToken:PROGRAM_REVIEW_TOKEN}));
 return {...reading,stored:true,frameId,review,executionAllowed:false};
}
