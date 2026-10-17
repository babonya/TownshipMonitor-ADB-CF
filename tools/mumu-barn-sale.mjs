import {barnSaleResult} from './mumu-barn-sale-result.mjs';
import {BARN_READER,barnHash,barnSaleProfile,barnFields,decodeBarnReading,barnPurchase,selectedBarnSource,barnTargets,validateBarnProof,validBarnTarget} from './mumu-barn-sale-proof.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash,acceptedFacts} from './mumu-evidence.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {compareWindowsGeometry} from './windows-device.mjs';
import {readMarketTown} from './mumu-market-proof.mjs';
import {boundNavigationOriginal} from './mumu-navigation-locator.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {requireMarketOrderRecheck} from './mumu-market-session.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const positive=n=>Number.isSafeInteger(n)&&n>0;
function enteredBarn(state,frame){
 // Only the verified native opening and this visit's own inspect/dismiss chain.
 let scene=frame.sceneId;const seen=new Set();
 while(scene&&!seen.has(scene)){
  seen.add(scene);const a=Object.values(state.actions).find(a=>a.nextVisit?.visitId===scene&&a.status==='verified');
  if(!a)return false;
  if(a.target?.marketNative?.role==='capacity_entry')return true;
  if(!a.target?.barnNative)return false;scene=state.frames[a.frameId]?.sceneId;
 }return false;
}
export function decideBarnSale(state,frame,barn,{now,holdSignature=null}={}){
 const needs=currentScreenNeeds(state,{now}),purchase=barnPurchase(state,needs,now),episode=state.barnRecovery?.active;
 const out=(kind,reason,extra={})=>({decision:{kind,reason,...extra},needs,purchase,episode:episode?.number??null});
 if(!episode||!enteredBarn(state,frame))return out('hold','BARN_OPENING_PROOF_REQUIRED');
 if(episode.pendingSale)return out('hold','BARN_SALE_RESULT_REQUIRED');
 if(holdSignature===barnHash(needs.needs))return out(barn.selected?'dismiss':'leave','BARN_SUPPORTED_SALE_UNAVAILABLE');
 if(needs.feasible.length)return out(barn.selected?'dismiss':'leave','BARN_DELIVER_FIRST');
 if(!purchase||!barn.capacity||needs.held.length||!needs.orders.length)return out(barn.selected?'dismiss':'leave','BARN_CURRENT_DEMAND_RECHECK_REQUIRED');
 if(barn.capacity.free>=purchase.quantity)return out(barn.selected?'dismiss':'leave','BARN_SPACE_SUFFICIENT');
 if(!['crops','products'].includes(barn.activeTab)){
  if(barn.selected)return out('dismiss','BARN_ALLOWED_TAB_REQUIRED');
  const tab=barn.tabs.find(t=>t.id==='products'&&t.state==='inactive');
  return tab?out('tab','BARN_ALLOWED_TAB_REQUIRED',{tabId:tab.id}):out('leave','BARN_ALLOWED_TAB_REQUIRED');
 }
 const reserves=item=>needs.orders.flatMap(o=>o.needs).filter(n=>n.itemId===item).reduce((n,r)=>n+r.required,0);
 if(barn.selected){
  const selected=selectedBarnSource(state,frame,barn),q=barn.selected.defaultQuantity;
  if(!selected||!positive(q)||selected.row.owned-reserves(barn.selected.itemId)<q)
   return out('dismiss','BARN_DEFAULT_QUANTITY_PROTECTED');
  return out('sell','BARN_DEFAULT_SURPLUS_SALE',{index:selected.row.index,surplus:selected.row.owned-reserves(barn.selected.itemId)});
 }
 const row=barn.rows.find(r=>r.identityConfirmed&&Number.isSafeInteger(r.owned)&&r.owned>reserves(r.itemId)&&
  ['crop','animal_product','factory_product'].includes(r.category));
 return row?out('inspect','BARN_DEFAULT_QUANTITY_REQUIRED',{index:row.index}):out('leave','BARN_REGISTERED_ELIGIBLE_ITEM_REQUIRED');
}
export async function observeBarnSale(store,frameId,workers,{holdSignature=null}={}){
 const state=store.load(),e=store.evidence(frameId),action=state.actions[state.input],reg=barnSaleProfile();
 if(state.stopCapture||state.stopReader||state.latestFrameId!==frameId||e.frame.epoch!==state.scene.epoch)throw Error('CURRENT_BARN_FRAME_REQUIRED');
 if(action&&!action.target?.barnNative)throw Error('INPUT_UNRESOLVED');
 const town=action?.target.barnNative.role==='leave'&&readMarketTown(e.image).supported;
 let reading=null,ocr=null,barn=null;
 if(!town){
  const previous=e.frame.review,sale=state.actions[previous?.data?.actionResult?.actionId];
  if(!action&&previous?.reviewedBy===BARN_READER&&previous.proof?.role==='result'&&sale?.status==='verified'&&sale.resultFrameId===frameId&&
   sale.target?.barnNative?.role==='sell'&&previous.data.actionResult.effect==='barn_sell_confirmed'){
   // Reuse only this settled sale's exact current result original, retaining
   // its validated screenshot/OCR bindings instead of rerunning recognition.
   validateBarnProof(e.frame,reg);({reading,ocr,barn}=previous.data);
  }else{
   const match=await workers.matcher.analyze(e.frame,e.bytes,{offline:true,barnSale:true});reading=match.barnSale;
   if(!reading?.supported||reading.profileHash!==reg.hash)return {stored:false,reason:'BARN_SOURCE_REQUIRED'};
   ocr=await workers.ocr.analyze(e.frame,e.bytes,{offline:true,scene:'barn',fields:barnFields(reading)});
   barn=decodeBarnReading(e.frame,reading,ocr,reg);
  }
 }
 const proposal=action?{needs:currentScreenNeeds(state,{now:store.clock()}),purchase:null,episode:state.barnRecovery?.active?.number??null}:
  decideBarnSale(state,e.frame,barn,{now:store.clock(),holdSignature});
 // MumuStore preserves accepted same-kind data when adding a source review
 // to a result frame. Include those facts before hashing the combined review.
 const previousData=acceptedFacts(e.frame)&&e.frame.review.actualKind===(town?'town':'barn')&&e.frame.review.actualEntityId===null?e.frame.review.data:{};
 const data={...previousData,reading,ocr,barn,currentNeeds:proposal.needs,purchase:proposal.purchase,episode:proposal.episode,
  ...proposal.decision?{barnDecision:proposal.decision}:{}};
 const review={reviewedBy:BARN_READER,actualKind:town?'town':'barn',actualEntityId:null,quality:{gameVisible:true,occluded:false},data,
  targets:action?[]:barnTargets(e.frame,data,reg)};
 const proof={schema:'program-barn-sale-1',role:action?'result':'source',frameId,evidenceHash:e.frame.evidenceHash,profileHash:reg.hash,
  inputId:state.input,invalidationSequence:state.observationInvalidation?.sequence??null,reviewHash:null};
 if(action){
  // A provisional effect is only a structural placeholder; derive the actual
  // result from source/after originals before committing anything.
  data.actionResult={actionId:action.id,frameId,confirmed:true};proof.reviewHash=reviewFactHash(review);
  const f={...e.frame,review:{...review,status:'accepted',proof}};
  const result=barnSaleResult(state,action,f);if(!result)return {stored:false,reason:'BARN_RESULT_UNKNOWN'};
  data.actionResult=result;
 }
 proof.reviewHash=reviewFactHash(review);
 const current=store.load();
 if(current.latestFrameId!==frameId||current.input!==state.input||currentScreenNeeds(current,{now:store.clock()}).hash!==proposal.needs.hash)throw Error('BARN_CONTEXT_CHANGED');
 store.review({frameId,...review,proof,programToken:PROGRAM_REVIEW_TOKEN});
 return {stored:true,review,result:data.actionResult};
}
export async function onBarnSaleFrame(c,frame){
 try{
  const state=c.store.load(),pending=state.actions[state.input];
  c.guard({context:'market',phase:pending?'owned-input':'observe'});c.busy=true;c.workers??=c.workersFactory();
  let observed=await observeBarnSale(c.store,frame.id,c.workers,{holdSignature:c.barnSaleHold?.signature??null});
  if(!observed.stored)throw Error(observed.reason);
  if(pending){
   if(c.store.load().input)throw Error('BARN_RESULT_UNKNOWN');c.marketActionId=null;
   if(pending.target.barnNative.role==='leave'){
    requireMarketOrderRecheck(c,frame.sequence,['helicopter']);
    return c.update('waiting','BARN_RETURN_CURRENT_ORDER_RECHECK',{transport:'helicopter'});
   }
   if(pending.target.barnNative.role!=='sell')return c.update('waiting','BARN_'+pending.target.barnNative.role.toUpperCase()+'_VERIFIED',{transport:'market'});
   c.marketPurchaseFailure=null;c.barnSaleHold=null;c.state.marketSourcingHold=null;
   // The verified count/capacity change settles the sale even while its visual
   // effect continues. Review this current original for its visible X, then
   // use the normal guarded close path without another observation interval.
   observed=await observeBarnSale(c.store,frame.id,c.workers);
   if(!observed.stored)throw Error(observed.reason);
   if(observed.review.data.barnDecision?.kind!=='leave')return c.update('waiting','BARN_SELL_VERIFIED',{transport:'market'});
  }
  const d=observed.review.data,decision=d.barnDecision,target=observed.review.targets[0];
  if(['BARN_DEFAULT_QUANTITY_PROTECTED','BARN_REGISTERED_ELIGIBLE_ITEM_REQUIRED','BARN_CURRENT_DEMAND_RECHECK_REQUIRED'].includes(decision.reason)&&Object.keys(d.currentNeeds.needs).length){
   c.barnSaleHold={signature:barnHash(d.currentNeeds.needs),reason:decision.reason};
   c.state.marketSourcingHold={reason:decision.reason};
  }
  if(!target)return c.update('hold',decision.reason,{transport:'market'});
  const actionId=generatedActionId(c.store.load(),{frameId:frame.id,targetId:target.id,kind:'b'});c.marketActionId=actionId;
  await navigateReviewed(c.store,{frameId:frame.id,targetId:target.id,actionId,nextVisit:{visitId:actionId+'-result',kind:decision.kind==='leave'?'town':'barn',required:true}},
   {device:c.device,management:decision.kind==='sell',beforeBegin:()=>c.guard({context:'market'}),beforeInputGuard:()=>c.guard({context:'market',phase:'owned-input'})});
  return c.update('waiting','BARN_'+decision.kind.toUpperCase()+'_RESULT_REQUIRED',{transport:'market',marketActionId:actionId});
 }catch(error){return c.update('hold',error.message,{transport:'market'});}finally{c.busy=false;}
}
