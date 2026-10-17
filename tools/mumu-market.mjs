// Real perception adapter and canonical store review. No direct device input.
import './adb.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash} from './mumu-evidence.mjs';
import {marketProfile,marketTargets,MARKET_READER,marketPurchaseResult,marketProofHash,marketModalAnchorsMatch,decodeMarketRejectionText,readMarketTown,genericMarketErrorModalEvidence,marketExitRegionMatches,locateMarketNavigation} from './mumu-market-proof.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {MarketVisit,freeMarketCountdown} from './mumu-market-loop.mjs';
import {marketPurchaseHold} from './mumu-market-products.mjs';
import {currentMarketCapacity} from './mumu-market-capacity.mjs';
import {readTransportNavigation,transportNavigationProfile} from './mumu-transport-navigation-proof.mjs';
import {sameSelectionCaptureTarget} from './mumu-helicopter-proof.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function decodeMarketQuantities(frame,reading,ocr){
  const rows=structuredClone(reading.rows),fields=rows.filter(r=>r.state==='offer'&&r.fullyVisible&&r.identity?.status==='matched');
  if(!fields.length){if(ocr!==null)throw Error('MARKET_OCR_UNEXPECTED');return rows;}
  if(!ocr||ocr.frameId!==frame.id||ocr.evidenceHash!==frame.evidenceHash||ocr.epoch!==frame.epoch||ocr.sequence!==frame.sequence||
    ocr.observedAt!==frame.observedAt||ocr.scene!=='market'||ocr.fields.length!==fields.reduce((n,r)=>n+1+(r.priceBox?1:0),0))throw Error('MARKET_OCR_FRAME_BINDING_REQUIRED');
  for(const row of fields){
    delete row.quantity; // Only this original's validated OCR may supply it.
    delete row.price;
    if(row.priceBox){
      const prices=ocr.fields.filter(f=>f.slotId===row.slotId&&f.kind==='price_number'),p=prices.length===1?prices[0]:null;
      const raw=(p?.rawText??'').normalize('NFKC').replace(/\s+/g,'');
      row.priceEvidence=p;
      if(p?.status==='parsed_candidate'&&p.itemId===row.itemId&&same(p.box,row.priceBox)&&
        /^(?:\d{1,6}|\d{1,3}(?:,\d{3}){1,2})$/.test(raw)&&Number(raw.replaceAll(',',''))===p.value?.amount&&
        Number.isSafeInteger(p.value.amount)&&p.value.amount>0&&p.ocrScores?.length&&p.ocrScores.every(s=>Number.isFinite(s)&&s>=.95&&s<=1))row.price=p.value.amount;
    }
    const quantities=ocr.fields.filter(f=>f.slotId===row.slotId&&f.kind==='bundle_quantity'),f=quantities.length===1?quantities[0]:null,text=/^\s*[x×]\s*(\d{1,3})\s*$/i.exec(f?.rawText??'');
    row.quantityEvidence=f??null;
    if(!f||f.status!=='parsed_candidate'||f.kind!=='bundle_quantity'||f.itemId!==row.itemId||
      !same(f.box,row.quantityBox)||!text||Number(text[1])!==f.value||!Number.isSafeInteger(f.value)||f.value<1||!f.ocrScores?.length||
      f.ocrScores.some(s=>!Number.isFinite(s)||s<.90||s>1))continue;
    row.quantity=f.value;row.quantityEvidence=f;
  }
  return rows;
}
export async function observeMarket(store,{frameId='latest',offline=false,visit=null,actionId=null,scrollResult=false}={},workers={}){
  const state=store.load(),fid=frameId==='latest'?state.latestFrameId:frameId,e=store.evidence(fid),reg=marketProfile();
  if(!offline&&(state.stopCapture||state.stopReader||state.latestFrameId!==fid||e.frame.epoch!==state.scene.epoch))throw Error('CURRENT_MARKET_FRAME_REQUIRED');
  if(!workers.matcher||!workers.ocr)throw Error('MARKET_WORKERS_REQUIRED');
  const pending=state.actions[actionId??state.input];
  if(!offline&&pending?.target?.marketNative?.role==='close'){
    const source=state.frames[pending.frameId],nativeTown=readMarketTown(e.image,reg),town=nativeTown.supported?nativeTown:
      readTransportNavigation(e.image,'town',transportNavigationProfile(e.frame));
    if(!town.supported||e.frame.epoch!==pending.epoch||e.frame.sequence<=source.sequence||
      Date.parse(e.frame.captureStartedAt)<Date.parse(pending.issuedAt)+1000||pending.deviceReceipt?.commandIssued!==true)
      return {stored:false,reason:'MARKET_CLOSE_RESULT_UNKNOWN',executionAllowed:false};
    const result={actionId:pending.id,frameId:fid,confirmed:true,effect:'market_closed_to_registered_town',currentOwnedRecheckRequired:true};
    const review={reviewedBy:MARKET_READER,actualKind:'town',actualEntityId:null,quality:{gameVisible:true,occluded:false},
      data:{...source.review.data,actionResult:result},targets:[]};
    const proof={schema:'program-market-1',role:'result',frameId:fid,evidenceHash:e.frame.evidenceHash,profileHash:reg.hash,
      catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,
      inputId:state.input,invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review)};
    store.review({frameId:fid,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
    return {stored:true,review,result,visit,executionAllowed:false};
  }
  let reading=await workers.matcher.analyze(e.frame,e.bytes,{market:true,offline:true});
  // Only an already issued purchase may read an evidenced failure modal. This
  // is result recognition, never a routine resource or affordability precheck.
  if(!offline&&actionId&&pending?.target.kind==='buy_market'){
    const source=state.frames[pending.frameId],layoutId=source?.review?.data.market?.layoutId;
    const matches=(reg.profile.rejectionText??[]).filter(r=>r.layoutId===layoutId&&marketModalAnchorsMatch(e.frame,e.image,r,reg));
    if(matches.length===1){
      const registration=matches[0],field={fieldId:'market-rejection:'+registration.id,kind:'text',
        box:registration.messageBox,scale:3,minimumScore:.95,recognitionOnly:false};
      const ocr=await workers.ocr.analyze({...e.frame,kind:'market'},e.bytes,{fields:[field],scene:'market',offline:true});
      const rejection=decodeMarketRejectionText(e.frame,ocr,registration);
      if(rejection)reading={...reading,status:'rejected',reason:null,marketProfileHash:reg.hash,
        catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,
        market:{...source.review.data.market},rows:[],rejection:{...rejection,ocr}};
    }
    if(!reading.rejection&&reading.rejectionModal){
      const registration=genericMarketErrorModalEvidence(e.frame,reading.rejectionModal,e.image);
      if(registration){
        const field={fieldId:'market-rejection:'+registration.id,kind:'text',box:registration.messageBox,
          scale:3,minimumScore:.95,recognitionOnly:false};
        const ocr=await workers.ocr.analyze({...e.frame,kind:'market'},e.bytes,{fields:[field],scene:'market',offline:true});
        const rejection=decodeMarketRejectionText(e.frame,ocr,registration);
        if(rejection)reading={...reading,status:'rejected',reason:null,marketProfileHash:reg.hash,
          catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,
          market:{...source.review.data.market},rows:[],rejection:{...rejection,mode:'generic_error_modal',modal:reading.rejectionModal,ocr}};
      }
    }
  }
  if(!['candidate','rejected'].includes(reading.status)||reading.marketProfileHash!==reg.hash||reading.catalogueManifestSha256!==reg.catalogueManifestSha256||
      reading.thresholdSha256!==reg.thresholdSha256)return {stored:false,reason:reading.reason??'MARKET_PROOF_CHANGED',reading,executionAllowed:false};
  const fields=reading.rows.filter(r=>r.state==='offer'&&r.fullyVisible&&r.identity?.status==='matched').flatMap(r=>[{
    fieldId:'market-quantity:'+r.slotId,kind:'bundle_quantity',itemId:r.itemId,slotId:r.slotId,box:r.quantityBox,scale:3,
    minimumScore:.90,recognitionOnly:true},...r.priceBox?[{fieldId:'market-price:'+r.slotId,kind:'price_number',itemId:r.itemId,
      slotId:r.slotId,box:r.priceBox,scale:3,minimumScore:.95,recognitionOnly:true}]:[]]);
  const ocr=fields.length?await workers.ocr.analyze({...e.frame,kind:'market'},e.bytes,{fields,scene:'market',offline:true}):null;
  reading.rows=decodeMarketQuantities(e.frame,reading,ocr);
  if(offline)return {stored:false,reason:'OFFLINE',reading,executionAllowed:false};
  const current=store.load();if(current.latestFrameId!==fid||current.input!==state.input||current.scene.epoch!==state.scene.epoch)throw Error('MARKET_OBSERVATION_CONTEXT_CHANGED');
  const needs=currentScreenNeeds(current,{now:store.clock()}),data={market:reading.market,rows:reading.rows,currentNeeds:needs,
    ...reg.profile.requirePurchaseCapacity?{marketCapacity:currentMarketCapacity(current,e.frame,needs.hash,reg,store.clock())}:{}};
  let role='source',result=null;
  if(actionId){
    if(pending?.target?.marketNative?.role==='entry'){
      const source=current.frames[pending.frameId];
      if(reading.market?.layoutId!==source.review.data.market.layoutId||!reading.market.leftmostVerified||
        e.frame.epoch!==pending.epoch||e.frame.sequence<=source.sequence||
        Date.parse(e.frame.captureStartedAt)<Date.parse(pending.issuedAt)+1000||pending.deviceReceipt?.commandIssued!==true)
        return {stored:false,reason:'MARKET_ENTRY_RESULT_UNKNOWN',reading,executionAllowed:false};
      visit??=new MarketVisit({visitId:e.frame.sceneId,needProjection:needs,epoch:e.frame.epoch});
      visit.observe(reading);
      result={actionId:pending.id,frameId:fid,confirmed:true,effect:'market_entered_registered'};
    }else if(pending?.target.kind==='market_scroll'){
      const source=current.frames[pending.frameId];
      if(!visit||pending.target.marketNative?.role!=='scroll'||e.frame.epoch!==pending.epoch||e.frame.sequence<=source.sequence||
        Date.parse(e.frame.captureStartedAt)<Date.parse(pending.issuedAt)+1000||pending.deviceReceipt?.commandIssued!==true||
        reading.marketProfileHash!==source.review.proof.profileHash)throw Error('MARKET_SCROLL_RESULT_UNKNOWN');
      const decision=visit.observe(reading,{scrollResult:true});
      data.marketDecision={...decision,slotId:decision.offer?.slotId};delete data.marketDecision.offer;
      result={actionId:pending.id,frameId:fid,confirmed:true,effect:'market_scroll_with_verified_two_row_overlap',motionConfirmed:true};
    }else result=marketPurchaseResult(current,current.actions[actionId],e.frame,reading,e.image);
    if(!result)return {stored:false,reason:'MARKET_RESULT_UNKNOWN',reading,executionAllowed:false};
    role='result';data.actionResult=result;
  }else{
    if(reading.status==='rejected')return {stored:false,reason:reading.rejection?.reason??'MARKET_REJECTION_UNBOUND',reading,executionAllowed:false};
    visit??=new MarketVisit({visitId:e.frame.sceneId,needProjection:needs,epoch:e.frame.epoch});
    const decision=visit.observe(reading,{scrollResult});data.marketDecision={...decision,slotId:decision.offer?.slotId};delete data.marketDecision.offer;
    if(decision.kind==='buy'){
      const hold=marketPurchaseHold(decision.offer,reg.profile,data.marketCapacity);
      if(hold)data.marketDecision={kind:'close',reason:hold,sourcingHeld:true,blockedSlotId:decision.offer.slotId};
    }
  }
  const review={reviewedBy:MARKET_READER,actualKind:'market',actualEntityId:null,quality:{gameVisible:true,occluded:false},data,
    targets:role==='source'?marketTargets(e.frame,data,reg):[]};
  const proof={schema:'program-market-1',role,frameId:fid,evidenceHash:e.frame.evidenceHash,profileHash:reg.hash,
    catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,
    inputId:state.input,invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review),
    recognitionHash:marketProofHash(reading)};
  store.review({frameId:fid,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
  return {stored:true,review,reading,visit,result,reason:review.targets.length?null:'MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED',executionAllowed:false};
}
export function observeMarketTown(store,frameId,decision,reg=marketProfile()){
  const state=store.load(),e=store.evidence(frameId),reading=readMarketTown(e.image,reg);
  if(!reading.supported||state.input||state.latestFrameId!==frameId||e.frame.epoch!==state.scene.epoch)
    return {stored:false,reason:'CURRENT_MARKET_TOWN_REQUIRED'};
  const data={market:{layoutId:reading.layoutId},rows:[],marketTown:reading,marketDecision:decision,
    currentNeeds:currentScreenNeeds(state,{now:store.clock()})};
  const review={reviewedBy:MARKET_READER,actualKind:'town',actualEntityId:null,
    quality:{gameVisible:true,occluded:false},data,targets:marketTargets(e.frame,data,reg)};
  const proof={schema:'program-market-1',role:'source',frameId,evidenceHash:e.frame.evidenceHash,profileHash:reg.hash,
    catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,
    inputId:null,invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review)};
  store.review({frameId,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
  return {stored:true,review,reading};
}
export function observeMarketTransportExit(store,{frameId,sourceKind='helicopter'}={}){
  const state=store.load(),e=store.evidence(frameId),reg=marketProfile();
  const l=reg.profile.layouts.find(l=>l.dimensions.width===e.frame.width&&l.dimensions.height===e.frame.height&&l.helicopterExit?.sourceRegistered);
  if(sourceKind!=='helicopter'||!l||state.input||state.latestFrameId!==frameId||e.frame.epoch!==state.scene.epoch||e.frame.review)
    return {stored:false,reason:'CURRENT_NATIVE_HELICOPTER_EXIT_REQUIRED',targets:[]};
  // Registered static anchors allow only bounded native raster variation.
  // The immediate source/preflight contract still requires unchanged pixels.
  const h=l.helicopterExit,match=a=>marketExitRegionMatches(e.image,a,reg);
  if(!h.anchors.every(match)||!locateMarketNavigation(e.image,h.close,reg))return {stored:false,reason:'NATIVE_HELICOPTER_EXIT_PIXELS_CHANGED',targets:[]};
  const data={market:{layoutId:l.id},rows:[],marketDecision:{kind:'transport_exit'},transportExit:{from:'helicopter'}};
  const review={reviewedBy:MARKET_READER,actualKind:'helicopter',actualEntityId:null,quality:{gameVisible:true,occluded:false},
    data,targets:marketTargets(e.frame,data,reg)};
  const proof={schema:'program-market-1',role:'transport_exit',frameId,evidenceHash:e.frame.evidenceHash,profileHash:reg.hash,
    catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,inputId:null,
    invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review)};
  store.review({frameId,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
  return {stored:true,review,targets:review.targets};
}
export function observeMarketTransportExitResult(store,frameId){
  const state=store.load(),pending=state.actions[state.input],e=store.evidence(frameId),reg=marketProfile(),
    source=state.frames[pending?.frameId],town=readMarketTown(e.image,reg);
  if(pending?.target?.marketTownNavigation?.role!=='transport_exit'||pending.target.marketTownNavigation.profileHash!==reg.hash||
    !town.supported||!source||e.frame.epoch!==pending.epoch||e.frame.sceneId!==pending.nextVisit?.visitId||
    e.frame.provider!==source.provider||e.frame.serial!==source.serial||e.frame.width!==source.width||e.frame.height!==source.height||
    !sameSelectionCaptureTarget(e.frame.captureTarget,source.captureTarget)||e.frame.sequence<=source.sequence||
    Date.parse(e.frame.captureStartedAt)<Date.parse(pending.issuedAt)+1000||pending.deviceReceipt?.commandIssued!==true)
    return {stored:false,reason:'NATIVE_HELICOPTER_EXIT_RESULT_UNKNOWN'};
  const result={actionId:pending.id,frameId,confirmed:true,effect:'helicopter_closed_to_registered_town'};
  const review={reviewedBy:MARKET_READER,actualKind:'town',actualEntityId:null,quality:{gameVisible:true,occluded:false},
    data:{...source.review.data,actionResult:result},targets:[]};
  const proof={schema:'program-market-1',role:'result',frameId,evidenceHash:e.frame.evidenceHash,profileHash:reg.hash,
    catalogueManifestSha256:reg.catalogueManifestSha256,thresholdSha256:reg.thresholdSha256,inputId:pending.id,
    invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(review)};
  store.review({frameId,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
  return {stored:true,review,result};
}
export async function readMarketRefresh(store,frame,reading,workers){
  if(!reading.market?.refreshCaptionVerified)return {status:'hold',reason:'MARKET_FREE_REFRESH_CAPTION_REQUIRED',boundedUntil:new Date(store.clock()+30000).toISOString()};
  const e=store.evidence(frame.id),field={fieldId:'market-free-refresh',kind:'text',box:reading.market.refreshTimerBox,
    scale:3,minimumScore:.9,recognitionOnly:true};
  const ocr=await workers.ocr.analyze({...e.frame,kind:'market'},e.bytes,{fields:[field],scene:'market',offline:true});
  const f=ocr.fields[0],duration=f.ocrScores?.length&&f.ocrScores.every(s=>s>=.9)?freeMarketCountdown(f.rawText):null;
  return duration===null?{status:'hold',reason:'MARKET_FREE_REFRESH_TIMER_UNREADABLE',boundedUntil:new Date(store.clock()+30000).toISOString()}:
    {status:'waiting',reason:'MARKET_FREE_REFRESH_WAIT',timerSource:'NEW OFFERS IN',sourceFrameId:frame.id,evidenceHash:frame.evidenceHash,
      // Minute-only UI is observed no earlier than the displayed duration; a
      // subsequent free refresh is still verified from a changed source view.
      nextObservationAt:new Date(Date.parse(frame.observedAt)+duration).toISOString()};
}
