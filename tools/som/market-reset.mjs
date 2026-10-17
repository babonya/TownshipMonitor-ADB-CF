// Disposable evidence for one completed market visit and its existing orders.
// Never restored from a shopping list, order history or a previous process.
import {freeMarketCountdown} from '../mumu-market-loop.mjs';
import {orderShortagesKnown} from './text-decisions.mjs';
import {near} from './geometry.mjs';
const MAX_RECHECK_PASSES=2;
function selectablePin(v,p){
  const b=p.visualBox;
  return b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>=10&&b.height>=10&&
    v.pins.filter(other=>other.color===p.color&&['x','y','width','height'].every(k=>other.box?.[k]===p.box?.[k])).length===1;
}
const scope=v=>JSON.stringify([v.profileHash,v.viewport]);
export function refreshDeadline(v){
  const r=v.marketRefresh,duration=freeMarketCountdown(r?.rawText),at=Date.parse(r?.observedAt);
  return r?.captionVerified===true&&r.sourceFrameId&&r.evidenceHash&&r.cropHash&&r.ocrScores?.length===1&&
    r.ocrScores.every(n=>Number.isFinite(n)&&n>=.82)&&duration!==null&&Number.isFinite(at)?at+duration:null;
}
export class MarketScan{
  constructor(survey,v){
  const held=survey.held??[];
  const activeOrders=[...survey.orders,...held.filter(o=>o.resetEligible===true)];
  // A waiting pin may become an active order while shopping. Recheck that
  // location too; its pre-shopping countdown cannot prove it still waits.
  const orders=[...activeOrders,...survey.refreshPins.filter(box=>!activeOrders.some(o=>near(o.box,box)))
    .map(box=>({box,orderHash:null}))];
  for(const pin of v.pins)if(pin.color==='red'&&!orders.some(o=>near(o.box,pin.box)))orders.push({box:pin.box,orderHash:null});
  // A selected balloon may cover a previously observed order or refresh pin.
  // Keep this visit's observed locations, not only the last survey raster.
  const knownPins=[...orders.map(o=>o.box),...survey.refreshPins,...v.pins.map(p=>p.box)]
    .filter((b,i,all)=>!all.slice(0,i).some(previous=>near(previous,b)));
  Object.assign(this,{started:false,scopeConsistent:true,complete:true,matched:false,uncertain:held.length>0,views:0,scope:null});
  // An unread order holds only itself. Recheck visible locations after shopping;
  // deletion still needs the current panel's complete shortage and trash proof.
  this.source=orders.length&&v.profileHash&&v.viewport&&
    !v.pins.some(p=>p.color==='green')?
    {scope:scope(v),orders:orders.map((o,id)=>({...structuredClone(o),id})),pins:knownPins.map(b=>({...b}))}:null;
}
  observe(v){
  const scan=this;
  const current=JSON.stringify([v.profileHash,v.viewport,v.view]);
  if(scan.scope&&scan.scope!==current){scan.complete=false;scan.scopeConsistent=false;}
  scan.scope=current;scan.views++;
  if(v.marketScanCoverage?.complete!==true||scan.views===1&&v.marketScanCoverage.leftEdgeComplete!==true)scan.complete=false;
  scan.rightEdgeComplete=v.marketScanCoverage?.rightEdgeComplete===true;
  scan.terminalVerified=v.marketEnd===true&&v.marketScanCoverage?.terminalVerified===true;
  scan.refreshDeadline=refreshDeadline(v);
  scan.timerSource=v.marketRefresh;
  // Coverage proves observed slot geometry, not successful product recognition.
  if(v.cells?.some(c=>c.state==='unknown'))scan.uncertain=true;
  if(!v.cells?.length||v.cells.some(c=>!['offer','sold','plus','unknown'].includes(c.state)))scan.complete=false;
}
  finish(_exhausted,attemptedNeeds,now){
  const s=this,source=this.source;
  // Returning from shopping starts a current-order recheck, even after purchases
  // or an early return. Market coverage and matches are not delivery evidence.
  return source&&s.started&&s.scopeConsistent&&s.views>0&&
    s.refreshDeadline!==null&&Date.parse(s.timerSource?.observedAt)<=now&&s.refreshDeadline-now>=1800000?
    new MarketReset({...structuredClone(source),phase:'recheck',checked:[],done:[],marketProof:{marketVisited:true,matched:s.matched,uncertain:s.uncertain,purchaseAttempts:attemptedNeeds.size,views:s.views,
      refreshDeadline:s.refreshDeadline,timerSource:structuredClone(s.timerSource)}}):null;
}
}
function uniqueCurrentOrder(v,identity,orderHash,box){
  return identity?.kind==='unique_current_order'&&identity.orderHash===orderHash&&
    Array.isArray(identity.surveyOrderHashes)&&identity.surveyOrderHashes.every(h=>typeof h==='string'&&h.length>0)&&
    identity.surveyOrderHashes.filter(h=>h===orderHash).length===1&&near(identity.selectionBox,box)&&
    !!v.sourceObservation?.frameId&&!!v.sourceObservation?.evidenceHash&&
    identity.sourceObservation?.frameId===v.sourceObservation.frameId&&identity.sourceObservation?.evidenceHash===v.sourceObservation.evidenceHash;
}
function currentPanel(v,identity){
  return identity?.kind==='current_panel'&&typeof v.orderHash==='string'&&v.orderHash.length>0&&identity.orderHash===v.orderHash&&
    !!v.sourceObservation?.frameId&&!!v.sourceObservation?.evidenceHash&&
    identity.sourceObservation?.frameId===v.sourceObservation.frameId&&
    identity.sourceObservation?.evidenceHash===v.sourceObservation.evidenceHash;
}
export function validMarketResetDelete(v,i,now=Date.now()){
  const p=i.marketResetProof;
  return i.reason==='market_return_no_deliverable_orders'&&p?.marketVisited===true&&p.noDeliverableOrders===true&&p.views>0&&
    p.refreshDeadline===refreshDeadline({marketRefresh:p.timerSource})&&Date.parse(p.timerSource?.observedAt)<=now&&p.refreshDeadline-now>=1800000&&
    p.scope===scope(v)&&p.orderHash===v.orderHash&&orderShortagesKnown(v)&&v.missing.length>0&&
    !v.pins?.some(pin=>pin.color==='green')&&(
      p.recheckScope==='currently_observable'&&p.orderId===null&&currentPanel(v,p.orderIdentity)||
      v.pins?.filter(pin=>pin.selected).length===1&&v.pins.some(pin=>pin.selected&&pin.color==='red'&&near(pin.box,p.box))||
      v.pins?.filter(pin=>pin.selected).length===0&&v.pins.some(pin=>pin.color==='red'&&near(pin.box,p.box))&&
      uniqueCurrentOrder(v,p.orderIdentity,p.orderHash,p.box));
}
export class MarketReset{
  constructor(proof){Object.assign(this,proof);this.selection=null;this.deferred=new Set();this.retryAt=null;this.recheckPass=1;}
  settle(intent,outcome){
    if(intent.kind==='som_close_panel'&&outcome==='confirmed'&&
      ['market_reset_reobserve','all_orders_refreshing'].includes(intent.reason)){
      this.selection=null;this.attempted=[];this.deferred.clear();this.retryAt=null;this.phase='recheck';
      this.recheckPass++;
    }
    if(intent.kind==='som_select'){
      if(intent.marketResetAttempt&&!this.attempted?.includes(intent.marketResetAttempt))(this.attempted??=[]).push(intent.marketResetAttempt);
      this.selection=['observed','confirmed'].includes(outcome)?{box:intent.box,color:intent.color}:null;
    }
    if(intent.kind==='som_delete'&&outcome==='confirmed'){
      if(intent.marketResetProof.orderId!==null)this.done.push(intent.marketResetProof.orderId);
      this.selection=null;
    }
  }
  plan(v,now){
  const r=this;
  // Two visits are enough for a best-effort return recheck. Unconfirmed orders
  // are skipped, never completed; the ordinary current-screen survey resumes.
  if(r.recheckPass>MAX_RECHECK_PASSES)return {reset:'abandon'};
  // Location uncertainty is local to an order. Timer, geometry and positive
  // delivery evidence still invalidate the reset as a whole.
  if(r.marketProof.refreshDeadline-now<1800000||r.scope!==scope(v)||v.pins.some(p=>p.color==='green')||
    !v.refreshing&&orderShortagesKnown(v)&&v.missing.length===0&&v.send){
    return {reset:'survey'};
  }
  if(r.retryAt!==null&&now>=r.retryAt)r.retryAt=null;
  for(const pin of v.pins)if(pin.color==='red'&&!r.pins.some(b=>near(b,pin.box))){
    r.pins.push({...pin.box});r.orders.push({id:r.orders.length,box:{...pin.box},orderHash:null});
    r.phase='recheck';
  }
  const selected=v.pins.filter(p=>p.selected);
  const located=selected.length===1?r.orders.find(o=>near(o.box,selected[0].box)):null;
  let order=located&&!r.done.includes(located.id)?located:null;
  let orderIdentity=null;
  if(!selected.length&&this.selection){
    // The exact current product/quantity crop can identify an order even when
    // its selection halo is occluded. A scheduled coordinate alone cannot.
    const matches=r.orders.filter(o=>o.orderHash===v.orderHash);
    order=matches.length===1&&!r.done.includes(matches[0].id)?matches[0]:null;
    orderIdentity={kind:'unique_current_order',orderHash:v.orderHash,surveyOrderHashes:r.orders.map(o=>o.orderHash),
      selectionBox:this.selection.box,sourceObservation:v.sourceObservation};
    if(!order||!v.pins.some(p=>p.color==='red'&&near(p.box,order.box))||
      !uniqueCurrentOrder(v,orderIdentity,order.orderHash,order.box)){order=null;orderIdentity=null;}
  }
  const readable=typeof v.orderHash==='string'&&v.orderHash.length>0&&orderShortagesKnown(v)&&v.missing.length>0&&!!v.trash&&!v.refreshing;
  if(order){
    if(v.refreshing)r.done.push(order.id);
    else if(!readable){r.deferred.add(order.id);}
    else if(v.orderHash!==order.orderHash&&r.checked.includes(order.id)){return {reset:'survey'};}
    else if(!r.checked.includes(order.id)){
      // Purchases change displayed owned counts. Bind this location to its
      // fresh return observation before using the hash for later deletion.
      order.orderHash=v.orderHash;r.checked.push(order.id);
    }
  }
  const remaining=r.orders.filter(o=>!r.done.includes(o.id));
  if(!remaining.length){return {reset:'deliver',action:v.refreshing&&v.close?
    {kind:'som_close_panel',box:v.close,next:'town',reason:'all_orders_refreshing'}:{waitMs:10000}};}
  // With only a positive refresh panel visible, keep the phone active. Old
  // unlocated orders stay pending and will be rechecked after town reentry.
  if(v.refreshing&&!v.pins.length&&v.close)return {phase:'reset_orders',
    action:{kind:'som_close_panel',box:v.close,next:'town',reason:'all_orders_refreshing'}};
  const target=phase=>remaining.find(o=>!r.deferred.has(o.id)&&
    (phase!=='recheck'||!r.checked.includes(o.id))&&
    !r.attempted?.includes(`${phase}:${o.id}`)&&v.pins.some(p=>near(p.box,o.box)&&selectablePin(v,p)));
  // Recheck every reachable untried location. Missing pins and missed selections
  // stay pending, but cannot veto deletion of a readable current order.
  if(r.phase==='recheck'&&!target('recheck'))r.phase='delete';
  if(r.phase==='delete'&&readable&&(!order&&!located||order&&!r.done.includes(order.id)&&!r.deferred.has(order.id))){
    if(!order)orderIdentity={kind:'current_panel',orderHash:v.orderHash,sourceObservation:v.sourceObservation};
    if(order||currentPanel(v,orderIdentity))
    return {phase:'reset_orders',action:{kind:'som_delete',box:v.trash,orderHash:v.orderHash,reason:'market_return_no_deliverable_orders',
      marketResetProof:{...r.marketProof,noDeliverableOrders:true,recheckScope:'currently_observable',scope:r.scope,orderId:order?.id??null,orderHash:v.orderHash,
        ...(order?{box:{...(selected[0]?.box??order.box)}}:{}),...(orderIdentity?{orderIdentity}: {})},next:'helicopter'}};
  }
  // A missing selection halo can leave every location unbound even after a
  // readable panel was seen. Revisit an untried visible location in deletion
  // phase; only its resulting current panel may authorize deletion.
  const next=target(r.phase);
  const pin=next&&v.pins.find(p=>near(p.box,next.box)&&selectablePin(v,p));
  const attempt=next&&`${r.phase}:${next.id}`;
  if(!pin||r.attempted?.includes(attempt)){
    // Return through town when this pass has no usable target. Pending orders
    // remain pending; a confirmed exit clears only visit-local retry state.
    if(v.close)return {phase:'reset_orders',action:{kind:'som_close_panel',box:v.close,
      next:'town',reason:'market_reset_reobserve'}};
    // Without current close geometry, keep observing without invented input.
    r.retryAt??=now+3000;
    return {phase:'reset_orders',action:{waitMs:Math.max(1,r.retryAt-now),reason:'SOM_MARKET_RESET_REOBSERVE'}};
  }
  // Count the proposal before dispatch too: a proven pre-input rejection must
  // not propose the same location forever. Pending input still blocks planning.
  (r.attempted??=[]).push(attempt);
  return {action:{kind:'som_select',box:pin.box,color:pin.color,
    ...(pin.visualBox?{visualBox:{...pin.visualBox}}:{}),next:'helicopter',marketResetAttempt:attempt}};
}
}
