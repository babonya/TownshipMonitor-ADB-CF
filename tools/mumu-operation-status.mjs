import {isUnresolvedAction} from './mumu-input-state.mjs';
// Read-only UI facts. This projection grants no action or resume authority.
export function operationStatusView(state,delivery,goods){
  const issues=[];
  const add=(code,scope,orderIds=[],extra={})=>issues.push({code,scope,orderIds,...extra,executionAllowed:false});
  const pending=Object.values(state.actions??{}).filter(isUnresolvedAction);
  if(pending.length)add('input_result','global',[],{actions:pending.map(a=>({id:a.id,status:a.status,sourceFrameId:a.frameId,resultFrameId:a.resultFrameId??null}))});
  if(state.stopCapture||state.stopReader)add('paused','global');
  const active=(goods.rows??[]).filter(r=>!['stale','order_changed','supply_excluded'].includes(r.status));
  const orderIds=[...new Set(active.map(r=>r.orderId))];
  for(const orderId of orderIds){
    const rows=active.filter(r=>r.orderId===orderId),frame=state.frames?.[rows[0].frameId],f=frame?.review?.data?.helicopter?.recognitionFailures;
    if(f?.productLocation?.length)add('location_unknown','order',[orderId],{slots:f.productLocation,frameId:frame.id});
    if(f?.productIdentity?.length)add('registration_wait','order',[orderId],{slots:f.productIdentity,frameId:frame.id});
    if(f?.quantity?.length)add('quantity_unknown','order',[orderId],{slots:f.quantity,frameId:frame.id});
    if(rows.some(r=>r.status==='shortage'))add('stock_shortage','order',[orderId],{items:rows.filter(r=>r.shortage>0).map(r=>({itemId:r.itemId,shortage:r.shortage}))});
  }
  const reason=delivery?.marketSourcingHold?.reason??delivery?.reason??'';
  const episode=state.barnRecovery?.active;
  if(episode){
    const evidence=episode.lastEvidence,current=state.frames?.[state.latestFrameId];
    const confirmed=current&&evidence?.sourceFrameId===current.id&&evidence.sourceHash===current.evidenceHash;
    add(confirmed?'barn_space':'barn_recheck','market',episode.lastEvidence?.demandOrders?.map(o=>o.orderId)??orderIds,
      {episode:episode.number,saleSupported:true,registeredSaleItems:['donut'],allowedSaleTabs:['crops','products'],constructionSaleSupported:false});
  }
  if(/MARKET_(FREE_REFRESH|UNVISITED_SOLD_TAIL|PLUS_END)/.test(reason)||delivery?.marketRefreshWait)
    add('market_refresh','market',active.filter(r=>r.status==='shortage').map(r=>r.orderId),{nextObservationAt:delivery?.marketRefreshWait?.nextObservationAt??delivery?.observationSchedule?.nextObservationAt??null});
  else if(reason==='MARKET_INSUFFICIENT_COINS')add('coins_shortage','market',orderIds);
  else if(/MARKET_(NATIVE|CAPACITY_UNREADABLE)/.test(reason))add('market_unavailable','market',orderIds);
  if(/PROFILE_REQUIRED|GEOMETRY|LAYOUT_CHANGED|LOCATION|SLOT_COVERAGE/.test(reason))add('location_unknown','transport',orderIds);
  if(/POPUP|INFO_SOURCE_REQUIRED/.test(reason)&&!issues.some(i=>i.code==='input_result'))add('screen_exception','transport',orderIds);
  const held=new Set(issues.flatMap(i=>i.scope==='order'?i.orderIds:[]));
  const ready=orderIds.filter(id=>!held.has(id)&&active.filter(r=>r.orderId===id).every(r=>r.status==='sufficient'));
  return {issues,readyOrders:ready,heldOrders:[...held],globalInputBlocked:pending.length>0||!!(state.stopCapture||state.stopReader),
    nextObservationAt:delivery?.observationSchedule?.nextObservationAt??null,detailReason:delivery?.reason??null,
    productEvidence:delivery?.productEvidence??null,executionAllowed:false};
}
