import {verifiedSelectionRecoveryClose,returnSelectionRecovery,finishSelectionRecovery} from './mumu-helicopter-selection-recovery.mjs';
import {captureHelicopterSelectionSeed} from './mumu-helicopter-selection-seed.mjs';
import {onBarnSaleFrame} from './mumu-barn-sale.mjs';
import {barnPurchase,barnHash} from './mumu-barn-sale-proof.mjs';
import {requireMarketOrderRecheck} from './mumu-market-session.mjs';
import {recordMarketSpaceHold,recordMarketSpaceReady,recordRejectedMarketSpaceHold} from './mumu-barn-recovery.mjs';
import {generatedActionId} from './mumu-action-id.mjs';
// Market execution shares Monitor's awaited callback and sole input owner.
import {digest} from './adb.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {observeMarket,readMarketRefresh,observeMarketTown,observeMarketTransportExitResult} from './mumu-market.mjs';
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {marketProfile,readMarketTown} from './mumu-market-proof.mjs';
import {MarketVisit} from './mumu-market-loop.mjs';
import {marketScreenshotProducts} from './mumu-market-products.mjs';
import {capacityRoles,readMarketCapacityPanel,currentMarketCapacity} from './mumu-market-capacity.mjs';
import {observeMarketCapacity} from './mumu-market-capacity-observation.mjs';
import {navigateTown} from './mumu-town-navigation.mjs';
import {readTransportNavigation,transportNavigationProfile} from './mumu-transport-navigation-proof.mjs';
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
import {transportKind,allocationTransport,TRANSPORT_PRIORITY} from './mumu-transport-kind.mjs';
const priority=TRANSPORT_PRIORITY.map(allocationTransport);
const affectedTransports=need=>priority.filter(kind=>need.allocations.some(a=>allocationTransport(a.transport)===kind&&a.shortage>0));
export function marketRoutingNeed(coordinator,state=coordinator.store.load(),registration=null){
  const projection=currentScreenNeeds(state,{now:coordinator.store.clock(),afterSequence:coordinator.marketNeedsRecheckAfterSequence??null});
  if(projection.feasible.length||!Object.keys(projection.needs).length)return null;
  if(coordinator.barnSaleHold?.signature===sha(projection.needs))return null;
  const profile=(registration??marketProfile()).profile;
  if(profile.screenshotProductsOnly===true){
    const frame=state.frames[state.latestFrameId]??state.frames[projection.orders[0]?.frameId];
    const products=marketScreenshotProducts(profile,frame);
    if(!products.some(t=>projection.needs[t.itemId]?.quantity>0))return null;
    if(profile.requirePurchaseCapacity===true&&!profile.layouts.some(l=>l.dimensions.width===frame.width&&l.dimensions.height===frame.height&&l.capacityObservation))return null;
  }
  if(coordinator.marketPurchaseFailure?.shortageSignature===sha(projection.needs)){
    const failure=coordinator.marketPurchaseFailure,episode=state.barnRecovery?.active;
    const freed=episode&&['MARKET_BARN_SPACE_INSUFFICIENT','MARKET_BARN_FULL'].includes(failure.reason)&&
      Object.values(state.actions??{}).some(a=>a.status==='verified'&&a.target?.kind==='send_helicopter'&&
        (state.frames[a.resultFrameId]?.sequence??-1)>episode.lastEvidence.sequence);
    if(!freed&&!(episode&&['MARKET_BARN_SPACE_INSUFFICIENT','MARKET_BARN_FULL'].includes(failure.reason)))return null;
    // A verified delivery permits a fresh capacity/offer read, never a presumed
    // free-space balance or replay of the old market position.
  }
  const wait=coordinator.marketRefreshWait;
  if(wait&&wait.shortageSignature===sha(projection.needs)&&Date.parse(wait.nextObservationAt??wait.boundedUntil)>coordinator.store.clock())return null;
  return projection;
}
export async function tryMarketTown(coordinator,frame,matching){
  const need=marketRoutingNeed(coordinator);if(!need){coordinator.state.marketSourcingHold=null;return null;}
  coordinator.guard({context:'market'});
  const reg=marketProfile();
  if(reg.profile.requirePurchaseCapacity&&!currentMarketCapacity(coordinator.store.load(),frame,need.hash,reg,coordinator.store.clock())){
    coordinator.state.marketSourcingHold={reason:'MARKET_CAPACITY_NAVIGATION_REQUIRED',neededGoods:need.needs,executionAllowed:false};return null;
  }
  if(reg.profile.executionEnabled!==true||!reg.profile.layouts.some(l=>l.dimensions.width===frame.width&&
    l.dimensions.height===frame.height&&l.executionEnabled&&l.nativeSourceResultRegistered)){
    // A missing market registration holds sourcing only. Keep the ordinary
    // town routing callback available for other registered transport work.
    coordinator.state.marketSourcingHold={reason:'MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED',
      neededGoods:need.needs,heldOrders:need.held,executionAllowed:false};
    return null;
  }
  coordinator.state.marketSourcingHold=null;
  // Registered town navigation owns source approval; market title never grants
  // town input. Missing current review remains a concrete navigation hold.
  const before=coordinator.store.load(),policy=sha(before.session.management);
  if(matching?.frameId!==frame.id){
    coordinator.workers??=coordinator.workersFactory();const e=coordinator.store.evidence(frame.id);
    matching=await coordinator.workers.matcher.analyze(e.frame,e.bytes,{scope:'navigation',offline:true});
  }
  const result=await navigateTown(coordinator.store,{source:'explicit_user',facilityKind:'market',
    searchId:'market-'+sha({session:before.session.id,epoch:frame.epoch,need:need.hash}).slice(0,24)},
    {device:coordinator.device,signal:coordinator.signal,matching});
  if(sha(coordinator.store.load().session.management)!==policy)throw Error('MANAGEMENT_POLICY_CHANGED');
  if(result.status==='waiting_result'){
    coordinator.marketEntryId=result.actionId;coordinator.navigationActionId=result.actionId;
    coordinator.marketVisit=null;coordinator.marketNeedHash=need.hash;
    coordinator.marketReturnTransports=affectedTransports(need);
  }
  return coordinator.update(result.status==='waiting_result'?'waiting':'hold',result.reason??'MARKET_NAVIGATION_RESULT_REQUIRED',
    {transport:'market',navigationActionId:result.actionId,neededGoods:need.needs});
}
export async function requestMarketForShortages(coordinator,frame,kind){
  const need=marketRoutingNeed(coordinator);if(!need)return null;
  const reg=marketProfile();
  if(reg.profile.executionEnabled!==true)return null; // Existing transport hold remains authoritative.
  // Finish already feasible current work before exiting. The ordinary panel
  // exit path still verifies its original transport boundary and allocation.
  if(need.feasible.length)return null;
  coordinator.marketReturnTransport=kind;coordinator.marketReturnTransports=affectedTransports(need);coordinator.marketNeedHash=need.hash;
  return {kind:'market',reason:'CURRENT_MARKET_SHORTAGE',needHash:need.hash};
}
export async function onMarketFrame(coordinator,frame){
  try{
    const {state}=coordinator.guard({context:'market',phase:'owned-input'});
    if(state.latestFrameId!==frame.id||frame.epoch!==state.scene.epoch)throw Error('CURRENT_MARKET_FRAME_REQUIRED');
    coordinator.busy=true;coordinator.workers??=coordinator.workersFactory();
    const needs=currentScreenNeeds(state,{now:coordinator.store.clock()}),pending=state.actions[state.input];
    if(!pending){
      if(coordinator.marketVisit&&coordinator.marketVisit.needHash!==needs.hash){coordinator.marketVisit.retire();coordinator.marketVisit=null;throw Error('MARKET_CURRENT_NEEDS_CHANGED');}
      coordinator.marketVisit??=new MarketVisit({visitId:frame.sceneId,needProjection:needs,epoch:frame.epoch});
    }else if(pending.id!==coordinator.marketActionId&&pending.id!==coordinator.marketEntryId)throw Error('INPUT_UNRESOLVED');
    // This narrow source/result registration gate precedes any candidate input.
    const reg=marketProfile();
    if(reg.profile.executionEnabled!==true||!reg.profile.layouts.some(l=>l.dimensions.width===frame.width&&l.dimensions.height===frame.height&&l.executionEnabled&&l.nativeSourceResultRegistered))
      return coordinator.update('hold','MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED',{transport:'market',neededGoods:needs.needs,evidenceMissing:reg.profile.nativeEvidenceMissing});
    const observed=await observeMarket(coordinator.store,{frameId:frame.id,visit:coordinator.marketVisit,
      actionId:pending?.target.marketNative?pending.id:null,scrollResult:pending?.target.kind==='market_scroll'},coordinator.workers);
    if(!observed.stored)return coordinator.update('hold',observed.reason,{transport:'market'});
    coordinator.marketVisit=observed.visit??coordinator.marketVisit;
    if(pending&&pending.id===coordinator.marketEntryId){
      if(coordinator.store.load().input)throw Error('MARKET_ENTRY_RESULT_UNKNOWN');
      coordinator.marketEntryId=null;coordinator.navigationActionId=null;
      coordinator.state.marketRefreshWait=null;coordinator.state.marketSourcingHold=null;
      return coordinator.update('waiting','MARKET_ENTRY_VERIFIED',{transport:'market'});
    }
    if(pending?.target.kind==='buy_market'){
      if(coordinator.store.load().input)throw Error('MARKET_RESULT_UNKNOWN');
      if(observed.result.purchaseRejected){
        if(observed.result.rejectionReason==='MARKET_BARN_FULL')recordRejectedMarketSpaceHold(coordinator.store,frame,pending.id,reg);
        coordinator.marketVisit.rejected(observed.result);coordinator.marketActionId=null;
        coordinator.marketPurchaseFailure={reason:observed.result.rejectionReason,shortageSignature:sha(needs.needs),sourceFrameId:frame.id};
        coordinator.state.marketSourcingHold={reason:observed.result.rejectionReason,neededGoods:needs.needs,
          purchaseRejected:true,acquiredQuantity:0,sourceFrameId:frame.id};
        return coordinator.update('hold',observed.result.rejectionReason,{transport:'market',rejection:observed.result});
      }
      coordinator.marketVisit.verified(observed.result);coordinator.marketActionId=null;
      return coordinator.update('waiting','MARKET_BUNDLE_VERIFIED',{transport:'market',acquired:observed.result,remaining:coordinator.marketVisit.remaining});
    }
    if(pending?.target.kind==='market_scroll'){
      if(coordinator.store.load().input)throw Error('MARKET_SCROLL_RESULT_UNKNOWN');
      coordinator.marketActionId=null;return coordinator.update('waiting','MARKET_SCROLL_VERIFIED',
        {transport:'market',marketDecision:observed.review.data.marketDecision});
    }
    if(pending?.target.kind==='close_panel'){
      if(coordinator.store.load().input)throw Error('MARKET_CLOSE_RESULT_UNKNOWN');
      const transports=coordinator.marketReturnTransports?.length?coordinator.marketReturnTransports:
        [allocationTransport(coordinator.marketReturnTransport)].filter(Boolean);
      requireMarketOrderRecheck(coordinator,frame.sequence,transports);
      return coordinator.update('waiting','MARKET_RETURN_CURRENT_ORDER_RECHECK',{transport:coordinator.marketReturnTransport??'helicopter'});
    }
    const decision=observed.review.data.marketDecision;
    if(decision.reason==='MARKET_BARN_SPACE_INSUFFICIENT'){
      const policy=recordMarketSpaceHold(coordinator.store,frame,reg);
      coordinator.state.barnRecovery={episode:policy.active.number,reason:'BARN_ALLOWED_TAB_SALE_RECHECK_REQUIRED',
        nextAction:'deliver_or_register_sale_evidence',executionAllowed:false};
    }else if(decision.kind==='buy'){
      recordMarketSpaceReady(coordinator.store,frame,reg);coordinator.state.barnRecovery=null;
    }
    if(decision.sourcingHeld){
      coordinator.marketPurchaseFailure={reason:decision.reason,shortageSignature:sha(needs.needs),sourceFrameId:frame.id};
      coordinator.state.marketSourcingHold={reason:decision.reason,neededGoods:needs.needs,sourceFrameId:frame.id};
    }
    if(decision.kind==='exhausted'){
      coordinator.marketRefreshWait={...await readMarketRefresh(coordinator.store,frame,observed.reading,coordinator.workers),needHash:needs.hash,shortageSignature:sha(needs.needs)};
      coordinator.state.marketRefreshWait=coordinator.marketRefreshWait;
      // An unread free timer holds sourcing for a bounded interval. Retire the
      // market view through its verified close so other current work can run.
      if(coordinator.marketRefreshWait.status==='hold')coordinator.state.marketSourcingHold={...coordinator.marketRefreshWait,neededGoods:needs.needs};
    }
    const target=observed.review.targets[0];if(!target)throw Error('MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED');
    const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'m'},()=> 'market:'+sha({session:state.session.id,frame:frame.id,target:target.id,need:needs.hash}).slice(0,40));
    const purchase=target.kind==='buy_market';coordinator.marketActionId=actionId;
    const currentGuard=owned=>{
      const checked=coordinator.guard({context:'market',phase:owned?'owned-input':'observe'}).state;
      if(checked.latestFrameId!==frame.id||currentScreenNeeds(checked,{now:coordinator.store.clock()}).hash!==needs.hash)throw Error('MARKET_CURRENT_NEEDS_CHANGED');
      return checked;
    };
    if(purchase)coordinator.marketVisit.requested(actionId,observed.reading.rows.find(r=>r.slotId===decision.slotId));
    await navigateReviewed(coordinator.store,{frameId:frame.id,actionId,targetId:target.id,swipe:target.swipe??null,
      nextVisit:{visitId:actionId+'-result',kind:target.kind==='close_panel'?'town':'market',required:true}},
      {management:purchase,device:coordinator.device,beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
    return coordinator.update('waiting','MARKET_ACTION_RESULT_REQUIRED',{transport:'market',marketActionId:actionId,kind:target.kind});
  }catch(error){return coordinator.update('hold',error.message,{transport:'market'});}
  finally{coordinator.busy=false;coordinator.update(coordinator.state.phase,coordinator.state.reason);}
}
export function marketReturnRecheck(coordinator,frame){
  const pending=coordinator.marketReturnRecheckPending;
  if(!pending?.pending?.length)return null;
  if(coordinator.store.load().input)return null;
  const e=coordinator.store.evidence(frame.id),native=readMarketTown(e.image);
  const reading=native.supported?native:readTransportNavigation(e.image,'town',transportNavigationProfile(frame));
  if(!reading.supported)return null;
  const kind=pending.pending.find(kind=>priority.includes(kind));
  if(!kind)return null;
  // Re-entry goes through the existing registered transport source/result; its
  // normal decoder rereads current owned quantities before any fulfillment.
  return {kind:transportKind(kind),reason:'MARKET_RETURN_CURRENT_ORDER_RECHECK',required:true,
    afterSequence:pending.afterSequence,currentOwnedRequired:true};
}
export async function onMarketTownFrame(coordinator,frame,matching){
  const initial=coordinator.store.load(),pending=initial.actions[initial.input];
  if(pending?.target.barnNative)return onBarnSaleFrame(coordinator,frame);
  const capacityReg=marketProfile(),capacityPanel=readMarketCapacityPanel(coordinator.store.evidence(frame.id).image,capacityReg);
  if(!pending&&capacityPanel&&initial.barnRecovery?.active){
    const needs=currentScreenNeeds(initial,{now:coordinator.store.clock()});
    const previous=Object.values(initial.actions).some(a=>a.status==='verified'&&a.target?.barnNative&&a.nextVisit?.visitId===frame.sceneId);
    if(previous||barnPurchase(initial,needs,coordinator.store.clock()))return onBarnSaleFrame(coordinator,frame);
  }
  if(capacityRoles.has(pending?.target.marketNative?.role)||!pending&&capacityPanel&&capacityReg.profile.requirePurchaseCapacity){
    try{
      coordinator.guard({context:'market',phase:pending?'owned-input':'observe'});coordinator.busy=true;
      coordinator.workers??=coordinator.workersFactory();
      const observed=await observeMarketCapacity(coordinator.store,frame.id,coordinator.workers,capacityReg);
      if(!observed.stored)throw Error(observed.reason);
      if(pending){
        if(coordinator.store.load().input)throw Error('MARKET_CAPACITY_NAVIGATION_RESULT_UNKNOWN');
        coordinator.marketActionId=null;coordinator.navigationActionId=null;
        return coordinator.update('waiting','MARKET_CAPACITY_NAVIGATION_VERIFIED',{transport:'market'});
      }
      if(observed.review.data.capacityReadFailed){
        coordinator.marketPurchaseFailure={reason:'MARKET_CAPACITY_UNREADABLE',shortageSignature:sha(observed.review.data.currentNeeds.needs)};
        coordinator.state.marketSourcingHold={reason:'MARKET_CAPACITY_UNREADABLE'};
      }
      const target=observed.review.targets[0];if(!target)throw Error('MARKET_CAPACITY_CLOSE_REQUIRED');
      const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'m'});
      coordinator.marketActionId=actionId;
      await navigateReviewed(coordinator.store,{frameId:frame.id,actionId,targetId:target.id,nextVisit:{visitId:actionId+'-result',kind:'town',required:true}},
        {device:coordinator.device,beforeBegin:()=>coordinator.guard({context:'market'}),beforeInputGuard:()=>coordinator.guard({context:'market',phase:'owned-input'})});
      return coordinator.update('waiting','MARKET_CAPACITY_CLOSE_RESULT_REQUIRED',{transport:'market',marketActionId:actionId});
    }catch(error){return coordinator.update('hold',error.message,{transport:'market'});}
    finally{coordinator.busy=false;}
  }
  if(pending?.target.marketTownNavigation?.role==='transport_exit'){
    try{
      coordinator.guard({context:'navigation',phase:'owned-input'});coordinator.busy=true;
      const result=observeMarketTransportExitResult(coordinator.store,frame.id);
      if(!result.stored||coordinator.store.load().input)throw Error(result.reason??'NATIVE_HELICOPTER_EXIT_RESULT_UNKNOWN');
      verifiedSelectionRecoveryClose(coordinator,frame,pending.id);
      coordinator.navigationActionId=null;
      return coordinator.update('waiting','NATIVE_HELICOPTER_EXIT_VERIFIED',{transport:'market'});
    }catch(error){return coordinator.update('hold',error.message,{transport:'helicopter'});}
    finally{coordinator.busy=false;}
  }
  if(pending?.target.marketTownNavigation?.role==='order_return'){
    try{
      coordinator.guard({context:'navigation',phase:'owned-input'});coordinator.busy=true;
      coordinator.workers??=coordinator.workersFactory();
      const observed=await coordinator.observe(coordinator.store,{frameId:frame.id,currentScreenOnly:coordinator.currentMode},coordinator.workers,matching);
      if(!observed.stored||coordinator.store.load().input)throw Error(observed.reason??'MARKET_RETURN_RESULT_UNKNOWN');
      const seeded=captureHelicopterSelectionSeed(coordinator,frame,observed.matching,pending.id);
      finishSelectionRecovery(coordinator,pending.id,seeded);
      coordinator.marketActionId=null;coordinator.navigationActionId=null;
      return coordinator.update('waiting','MARKET_RETURN_RECHECK_OBSERVATION_REQUIRED',{transport:'helicopter'});
    }catch(error){return coordinator.update('hold',error.message,{transport:'helicopter'});}
    finally{coordinator.busy=false;}
  }
  // Pending market close/entry results belong to onMarketFrame, even when the
  // resulting pixels are town. Never intercept their settled-result path.
  if(initial.input)return null;
  const recovery=await returnSelectionRecovery(coordinator,frame);if(recovery)return recovery;
  const reg=marketProfile(),town=readMarketTown(coordinator.store.evidence(frame.id).image,reg);
  if(!town.supported)return null;
  const recheck=marketReturnRecheck(coordinator,frame),projection=currentScreenNeeds(initial,{now:coordinator.store.clock(),
    afterSequence:coordinator.marketNeedsRecheckAfterSequence??null}),need=marketRoutingNeed(coordinator,initial);
  const bootstrap=coordinator.currentMode&&projection.orders.length===0;
  if(!recheck&&!need&&!bootstrap)return null;
  const returning=!!recheck||bootstrap&&!need;
  if(returning&&recheck&&recheck.kind!=='helicopter')return coordinator.update('hold','REGISTERED_TRANSPORT_ENTRY_REQUIRED',{transport:recheck.kind});
  try{
    coordinator.guard({context:'navigation'});coordinator.busy=true;
    const capacityNeeded=!returning&&reg.profile.requirePurchaseCapacity&&(!currentMarketCapacity(initial,frame,need.hash,reg,coordinator.store.clock())||!!barnPurchase(initial,need,coordinator.store.clock()));
    const observed=observeMarketTown(coordinator.store,frame.id,{kind:returning?'return_order':capacityNeeded?'capacity_entry':'enter'},reg);
    const target=observed.review?.targets[0];if(!target)throw Error('MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED');
    const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:target.id,kind:'n'},()=> 'native-market-town:'+sha({session:initial.session.id,frame:frame.id,target:target.id}).slice(0,32));
    coordinator.navigationActionId=actionId;
    if(returning||capacityNeeded)coordinator.marketActionId=actionId;
    else{coordinator.marketEntryId=actionId;coordinator.marketVisit=null;coordinator.marketReturnTransports=affectedTransports(need);}
    await navigateReviewed(coordinator.store,{frameId:frame.id,actionId,targetId:target.id,
      nextVisit:{visitId:actionId+'-result',kind:returning?'helicopter':capacityNeeded?'barn':'market',required:true}},
      {device:coordinator.device,beforeBegin:()=>coordinator.guard({context:'navigation'}),
        beforeInputGuard:()=>coordinator.guard({context:returning?'navigation':'market',phase:'owned-input'})});
    return coordinator.update('waiting','MARKET_TOWN_NAVIGATION_RESULT_REQUIRED',{transport:returning?'helicopter':'market',navigationActionId:actionId});
  }catch(error){return coordinator.update('hold',error.message,{transport:'market'});}
  finally{coordinator.busy=false;}
}
