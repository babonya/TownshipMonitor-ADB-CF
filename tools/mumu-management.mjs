import {registeredPercentageBox} from './percentage-profile.mjs';
// Explicit transport-management scope; observation sessions retain their old contract.
import {assertOrderPolicy,orderDisposition} from './mumu-order-policy.mjs';
import {digest} from './adb.mjs';
import {popupTarget,popupRules} from './mumu-popup-registry.mjs';
export const MANAGEMENT_KINDS=['claim_popup_reward','claim_daily_bonus','claim_mayors_cup_reward','buy_market','buy_dealer','load_airport','load_train','send_airport','send_train','send_helicopter','delete_helicopter','barn_sell','open_dealer','dealer_search','dealer_scroll','select_dealer_item','barn_quantity','collect_train','queue_production','collect_product','harvest_crop','plant_crop'];
// Keep historical kind IDs readable, but they never authorize new input.
export const FORBIDDEN_PRODUCTION_KINDS=['queue_production','plant_crop','harvest_crop'];
const fail=code=>{throw Error(code);};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
export const DISABLED_MANAGEMENT_KINDS=['buy_dealer','open_dealer','dealer_search','dealer_scroll','select_dealer_item'];
// The current user charter is stricter than historical session policies. Never
// derive permission from a stored last-resort policy or caller-supplied override.
export const TRANSPORT_POLICY=Object.freeze({version:3,tcash:'forbidden',coupons:'forbidden',loadCoupons:'forbidden',dealer:'disabled',
  production:'forbidden',orderDeleteAtLeast:20,customerIdentity:'not_required',orderIdentity:'requested_products',
  marketRefresh:'free_only',protectedSales:['construction_material','mineral','ingot','unknown']});
export function authorizeManagement(store,{source,scope}={}) {
  if(source!=='explicit_user' || scope!=='transport_no_tcash')fail('MANAGEMENT_APPROVAL_REQUIRED');
  return store.transact(s=>{
    if(s.input)fail('INPUT_UNRESOLVED');
    s.session.mode='transport_management';
    s.session.management={scope,source,policy:structuredClone(TRANSPORT_POLICY),approvedAt:new Date(store.clock()).toISOString()};
    s.settings.recognitionMode='on_demand';
    for(const f of Object.values(s.frames))if(f.job.status==='ready' && !f.required && !f.ocrRequested)f.job.status='deferred';
    return s.session.management;
  });
}
export const MAYORS_CUP_ACTIVATION='mayors-cup-reward-20261005-1401';
export const MAYORS_CUP_REALLOCATION='mayors-cup-no-input-reallocation-20261005-1501';
export const MAYORS_CUP_POLICY_REVISION='mayors-cup-zero-input-policy-revision-20261005-1701';
// Same canonical object ordering as inventorySourceFingerprint. This is a
// workflow artifact binding, not an independent signature or approval engine.
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,stable(value[k])])):value;
export const mayorsCupBindingHash=value=>digest(Buffer.from(JSON.stringify(stable(value))));
export function validateMayorsCupGrant(r,{historical=false}={}){
  const g=r?.grant,revision=g?.id===MAYORS_CUP_POLICY_REVISION;
  const keys=['id','activationId','predecessorActionId','predecessorActionHash','sourceFrameId','sourceHash','preflightId','preflightHash','correctedGeometryHash','candidateRelease','maxCanonicalAttempts','maxPotentialInputs','replenish'];
  if(revision)keys.push('supersedesGrantHash','secondFailure');
  const hashes=['predecessorActionHash','sourceHash','preflightHash','correctedGeometryHash','candidateRelease'];
  if(revision)hashes.push('supersedesGrantHash');
  if(!r||Object.keys(r).length!==2||!g||Array.isArray(g)||Object.keys(g).length!==keys.length||Object.keys(g).some(k=>!keys.includes(k))||
      r.grantHash!==mayorsCupBindingHash(g)||(!revision&&g.id!==MAYORS_CUP_REALLOCATION)||(historical&&revision)||g.activationId!==MAYORS_CUP_ACTIVATION||
      g.predecessorActionId!=='manager-mayors-cup-claim-20261005-1403'||g.maxCanonicalAttempts!==(revision?3:2)||g.maxPotentialInputs!==1||g.replenish!==0||
      !hashes.every(k=>/^[a-f0-9]{64}$/.test(g[k]??''))||!validId(g.sourceFrameId)||!validId(g.preflightId))fail('MAYORS_CUP_REALLOCATION_GRANT_REQUIRED');
  if(revision){
    const s=g.secondFailure,keys=['actionId','actionHash','sourceFrameId','sourceHash','preflightId','preflightHash'];
    if(!s||Array.isArray(s)||Object.keys(s).length!==keys.length||Object.keys(s).some(k=>!keys.includes(k))||
        s.actionId!=='manager-mayors-cup-claim-20261005-1503'||!validId(s.sourceFrameId)||!validId(s.preflightId)||
        !['actionHash','sourceHash','preflightHash'].every(k=>/^[a-f0-9]{64}$/.test(s[k]??'')))fail('MAYORS_CUP_REALLOCATION_GRANT_REQUIRED');
  }
}
// Native 1578x1268 registration from the saved Mayor's Cup original. Exclude
// animated chests and leaderboard avatars; the entire free-claim strip is exact.
export const MAYORS_CUP_CLAIM_GEOMETRY=Object.freeze({
  box:registeredPercentageBox({x: 0.1932826362484157, y: 0.7160883280757098, width: 0.14892268694550062, height: 0.061514195583596214},{width:1578,height:1268}),
  verification:{version:1,maxChangedRatio:0,channelTolerance:0,
    anchorBoxes:[registeredPercentageBox({x: 0.4024081115335868, y: 0.2539432176656151, width: 0.28073510773130544, height: 0.04258675078864353},{width:1578,height:1268})],
    targetRegions:[registeredPercentageBox({x: 0.2256020278833967, y: 0.7310725552050473, width: 0.08998732572877059, height: 0.027602523659305992},{width:1578,height:1268})],
    criticalRegions:[
      {field:'event_title',box:registeredPercentageBox({x: 0.4024081115335868, y: 0.2539432176656151, width: 0.28073510773130544, height: 0.04258675078864353},{width:1578,height:1268})},
      {field:'finished_rank',box:registeredPercentageBox({x: 0.21039290240811154, y: 0.3588328075709779, width: 0.12610899873257286, height: 0.13485804416403785},{width:1578,height:1268})},
      {field:'free_claim',box:registeredPercentageBox({x: 0.17300380228136883, y: 0.7160883280757098, width: 0.19074778200253487, height: 0.07413249211356467},{width:1578,height:1268})}]}});
export const MAYORS_CUP_OPEN_GEOMETRY=Object.freeze({
  box:registeredPercentageBox({x: 0.44866920152091255, y: 0.7878548895899053, width: 0.18694550063371357, height: 0.030757097791798107},{width:1578,height:1268}),
  verification:{version:1,maxChangedRatio:0,channelTolerance:0,
    anchorBoxes:[registeredPercentageBox({x: 0.4524714828897338, y: 0.7910094637223974, width: 0.17997465145754118, height: 0.02444794952681388},{width:1578,height:1268})],
    targetRegions:[registeredPercentageBox({x: 0.4524714828897338, y: 0.7910094637223974, width: 0.17997465145754118, height: 0.02444794952681388},{width:1578,height:1268})],
    criticalRegions:[{field:'open_prompt',box:registeredPercentageBox({x: 0.4524714828897338, y: 0.7910094637223974, width: 0.17997465145754118, height: 0.02444794952681388},{width:1578,height:1268})}]}});
export function validateMayorsCupClaim(target){
  const m=target?.management,v=target?.verification;
  if(['mayors_cup_open','mayors_cup_collect','mayors_cup_continue'].includes(m?.source)){
    if(target.kind!=='claim_mayors_cup_reward'||target.type!=='tap'||m.activationId!==MAYORS_CUP_ACTIVATION||
      m.maxAttempts!==1||m.currency!=='NONE'||m.rewardContents!=='undisclosed'||!validId(m.predecessorActionId)||
      m.price!==undefined||m.quantity!==undefined||m.itemId!==undefined||m.reallocation!==undefined||
      JSON.stringify(target.box)!==JSON.stringify(MAYORS_CUP_OPEN_GEOMETRY.box)||
      JSON.stringify(v)!==JSON.stringify(MAYORS_CUP_OPEN_GEOMETRY.verification))fail('MAYORS_CUP_FREE_OPEN_REQUIRED');
    return true;
  }
  if(target?.kind!=='claim_mayors_cup_reward'||target.type!=='tap'||m?.source!=='mayors_cup_first_claim'||
      m.activationId!==MAYORS_CUP_ACTIVATION||m.maxAttempts!==1||m.currency!=='NONE'||
      m.price!==undefined||m.quantity!==undefined||m.itemId!==undefined||m.rewardContents!=='undisclosed'||
      !v||v.motion!==undefined||v.maxChangedRatio!==0||v.channelTolerance!==0||
      JSON.stringify(target.box)!==JSON.stringify(MAYORS_CUP_CLAIM_GEOMETRY.box)||
      JSON.stringify(v)!==JSON.stringify(MAYORS_CUP_CLAIM_GEOMETRY.verification))
    fail('MAYORS_CUP_FREE_FIRST_CLAIM_REQUIRED');
  if(m.reallocation!==undefined){
    validateMayorsCupGrant(m.reallocation);
  }
  return true;
}
export const dailyBonusTarget=()=>({id:'event-claim:daily-bonus',kind:'claim_daily_bonus',type:'tap',box:registeredPercentageBox({x: 0.7192648922686945, y: 0.7539432176656151, width: 0.11406844106463879, height: 0.03470031545741325},{width:1578,height:1268}),eventClose:{schema:1,event:'daily_bonus'},management:{purpose:'transport',verified:true,currency:'NONE',source:'daily_bonus',rewardContents:'undisclosed'}});
export function validateManagement(session,target,order=null) {
  if(session.management?.scope!=='transport_no_tcash' || session.management.source!=='explicit_user')fail('MANAGEMENT_APPROVAL_REQUIRED');
  if(!MANAGEMENT_KINDS.includes(target.kind))fail('MANAGEMENT_TARGET_INVALID');
  if(DISABLED_MANAGEMENT_KINDS.includes(target.kind))fail('MANAGEMENT_DEALER_DISABLED');
  if(FORBIDDEN_PRODUCTION_KINDS.includes(target.kind))fail('MANAGEMENT_PRODUCTION_FORBIDDEN');
  const m=target.management;
  if(!m || m.purpose!=='transport' || m.verified!==true || !['NONE','COIN'].includes(m.currency))fail('MANAGEMENT_NO_TCASH_REQUIRED');
  if(typeof m.resource==='string' && /coupon/i.test(m.resource))fail('MANAGEMENT_COUPON_FORBIDDEN');
  if(m.resource!==undefined)fail('MANAGEMENT_RESOURCE_UNKNOWN');
  assertOrderPolicy(order,target.kind);
  if(target.kind==='delete_helicopter'&&
    (typeof m.orderId!=='string'||!m.orderId||m.orderPolicy!=='delete'||order?.orderId!==m.orderId))fail('ORDER_DELETE_POLICY_REQUIRED');
  if(target.kind==='claim_popup_reward'&&JSON.stringify(target)!==JSON.stringify(popupTarget(popupRules.find(r=>r.id===m.popupId&&r.category==='claim'))))fail('POPUP_FREE_CLAIM_REQUIRED');
  if(target.kind==='claim_daily_bonus'&&JSON.stringify(target)!==JSON.stringify(dailyBonusTarget()))fail('DAILY_BONUS_FREE_CLAIM_REQUIRED');
  if(target.kind==='claim_mayors_cup_reward')validateMayorsCupClaim(target);
  if(target.kind==='collect_product'){
    const receipt=m.receipt;
    if(target.type!=='tap'||m.source!=='received_products'||!Number.isSafeInteger(m.quantity)||m.quantity<1||
      receipt?.title!=='PRODUCTS RECEIVED!'||receipt?.prompt!=='TAP TO CLAIM'||
      typeof receipt?.sender!=='string'||!receipt.sender.trim()||
      !target.verification?.criticalRegions?.some(region=>region.field==='quantity'))fail('RECEIVED_PRODUCTS_CLAIM_ONLY');
  }
  if(['buy_market','buy_dealer'].includes(target.kind)) {
    const currentBundle=target.kind==='buy_market'&&target.marketNative?.schema===1&&m.source==='current_market_bundle'&&m.numericResourcePrecheck===false;
    if(m.currency!=='COIN' || (!currentBundle&&(!Number.isSafeInteger(m.price)||m.price<1)) || !Number.isSafeInteger(m.quantity) || m.quantity<1 || typeof m.itemId!=='string' || !m.itemId)fail('PURCHASE_FACTS_REQUIRED');
    if(currentBundle&&(m.balance!==undefined||m.capacity!==undefined||m.price!==undefined&&
      !(m.capacityChecked===true&&Number.isSafeInteger(m.price)&&m.price>0)))fail('MARKET_NUMERIC_RESOURCE_INFERENCE_FORBIDDEN');
    if(!validId(m.orderId)||order?.orderId!==m.orderId)fail('PURCHASE_ORDER_REQUIRED');
    if(orderDisposition(order.needs)!=='deliver'||!order.needs.some(n=>n.itemId===m.itemId))fail('PURCHASE_ORDER_HELD');
  }else if(m.currency!=='NONE')fail('MANAGEMENT_NO_TCASH_REQUIRED');
  if(['load_airport','load_train'].includes(target.kind)) {
    assertOrderPolicy({needs:[{required:m.required}]},target.kind);
    if(!Number.isSafeInteger(m.owned) || !Number.isSafeInteger(m.required) || m.required<1 || m.owned<m.required)fail('LOAD_STOCK_INSUFFICIENT');
  }
  if(target.kind==='barn_sell') {
    if(!['crops','products'].includes(m.barnTab))fail('BARN_ALLOWED_TAB_REQUIRED');
    if(!['crop','animal_product','factory_product'].includes(m.category) || typeof m.itemId!=='string' || !m.itemId || !Number.isSafeInteger(m.quantity) || m.quantity<1 || !Number.isSafeInteger(m.spaceNeeded) || m.spaceNeeded<1 || !Number.isSafeInteger(m.surplus) || m.surplus<m.quantity)fail('BARN_SALE_PROTECTED');
  }
  return true;
}
