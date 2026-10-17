import {PROGRAM_REVIEW_TOKEN,reviewFactHash} from './mumu-evidence.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {marketProfile,marketTargets,MARKET_READER,readMarketTown,validNativeMarketTarget} from './mumu-market-proof.mjs';
import {capacityRoles,readMarketCapacityPanel,decodeMarketCapacity} from './mumu-market-capacity.mjs';
import {compareWindowsGeometry} from './windows-device.mjs';

export async function observeMarketCapacity(store,frameId,workers,reg=marketProfile()){
  const state=store.load(),e=store.evidence(frameId),a=state.actions[state.input];
  if(state.stopCapture||state.stopReader||state.latestFrameId!==frameId||e.frame.epoch!==state.scene.epoch)throw Error('CURRENT_MARKET_FRAME_REQUIRED');
  const resultRole=a?.target.marketNative?.role;
  if(a&&!capacityRoles.has(resultRole))return {stored:false,reason:'INPUT_UNRESOLVED'};
  const panel=readMarketCapacityPanel(e.image,reg),town=!panel?readMarketTown(e.image,reg):null;
  let result=null;
  if(a){
    const source=state.frames[a.frameId];
    if(!['issued','captured'].includes(a.status)||!source||!validNativeMarketTarget(source,a.target,reg)||
      e.frame.provider!==source.provider||e.frame.serial!==source.serial||e.frame.sceneId!==a.nextVisit?.visitId||e.frame.epoch!==a.epoch||
      e.frame.sequence<=source.sequence||Date.parse(e.frame.captureStartedAt)<Date.parse(a.issuedAt)+1000||a.deviceReceipt?.commandIssued!==true||
      (resultRole==='capacity_entry'?!panel:!town?.supported))return {stored:false,reason:'MARKET_CAPACITY_NAVIGATION_RESULT_UNKNOWN'};
    try{compareWindowsGeometry(source,e.frame);}catch{return {stored:false,reason:'MARKET_CAPACITY_GEOMETRY_CHANGED'};}
    result={actionId:a.id,frameId,confirmed:true,effect:resultRole==='capacity_entry'?'market_capacity_barn_opened':'market_capacity_barn_closed'};
  }else if(!panel)return {stored:false,reason:'MARKET_CAPACITY_PANEL_REQUIRED'};
  const needs=currentScreenNeeds(state,{now:store.clock()});
  let capacity=null;
  if(panel){
    const field={fieldId:'market-capacity',kind:'capacity',box:panel.capacityBox,scale:3,minimumScore:.95,recognitionOnly:true};
    const ocr=await workers.ocr.analyze({...e.frame,kind:'barn'},e.bytes,{fields:[field],scene:'barn',offline:true});
    capacity=decodeMarketCapacity(e.frame,ocr,panel.capacityBox);
  }
  const current=store.load();
  if(current.latestFrameId!==frameId||current.input!==state.input||currentScreenNeeds(current,{now:store.clock()}).hash!==needs.hash)throw Error('MARKET_CAPACITY_CONTEXT_CHANGED');
  const data={market:{layoutId:panel?.layoutId??town.layoutId},rows:[],currentNeeds:needs,
    marketCapacity:capacity,...panel&&!capacity?{capacityReadFailed:true}:{},
    ...result?{actionResult:result}:{marketDecision:{kind:'capacity_close'}}};
  const review={reviewedBy:MARKET_READER,actualKind:panel?'barn':'town',actualEntityId:null,
    quality:{gameVisible:true,occluded:false},data,targets:result?[]:marketTargets(e.frame,data,reg)};
  const proof={schema:'program-market-1',role:result?'result':'source',frameId,evidenceHash:e.frame.evidenceHash,
    profileHash:reg.hash,catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,
    inputId:state.input,invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review)};
  store.review({frameId,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
  return {stored:true,review,result,capacity};
}
