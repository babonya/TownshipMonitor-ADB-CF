// Today and yesterday totals for the display; no order or stock history.
export const DELIVERY_COUNT_TIME_ZONE='Asia/Seoul';
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:DELIVERY_COUNT_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function dailyDeliverySummary(state,now=Date.now()){
  const date=day.format(new Date(now)),saved=state.dailyDeliveries;
  const yesterdayDate=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const total=saved?.date===date&&Number.isSafeInteger(saved.total)&&saved.total>=0?saved.total:0;
  const previous=saved?.date===yesterdayDate?saved:saved?.previous;
  let yesterday=previous?.date===yesterdayDate&&Number.isSafeInteger(previous.total)&&previous.total>=0?previous.total:null;
  // An older last delivery proves there were no deliveries yesterday. A legacy
  // total already overwritten today cannot establish yesterday's count.
  if(yesterday===null&&saved?.date<yesterdayDate&&Number.isSafeInteger(saved.total)&&saved.total>=0)yesterday=0;
  return {completedDeliveries:total,deliveryCountDate:date,yesterdayCompletedDeliveries:yesterday,
    yesterdayDeliveryCountDate:yesterdayDate,deliveryCountTimeZone:DELIVERY_COUNT_TIME_ZONE};
}
// Called inside the same state transaction that confirms one successful Send.
export function recordDailyDelivery(state,now=Date.now()){
  const summary=dailyDeliverySummary(state,now);
  if(summary.completedDeliveries===Number.MAX_SAFE_INTEGER)throw Error('DAILY_DELIVERY_COUNT_OVERFLOW');
  state.dailyDeliveries={date:summary.deliveryCountDate,total:summary.completedDeliveries+1,
    previous:{date:summary.yesterdayDeliveryCountDate,total:summary.yesterdayCompletedDeliveries}};
}
