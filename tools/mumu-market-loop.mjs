// One ephemeral visit; positions are retired on close, refresh or restart.
const fail=reason=>{throw Error(reason);};
const token=row=>row.contentHash??JSON.stringify([row.state,row.itemId,row.quantity,row.currency]);
export function marketColumns(reading){
  const columns=[];
  for(const row of reading.rows.filter(r=>r.fullyVisible).sort((a,b)=>a.column-b.column)){
    let c=columns.find(c=>Math.abs(c.x-row.column)<=20);
    if(!c){c={x:row.column,rows:{}};columns.push(c);}
    if(c.rows[row.row])fail('MARKET_COLUMN_AMBIGUOUS');c.rows[row.row]=row;
  }
  const pitch=reading.market?.columnPitch??190,first=columns[0]?.x??0;
  return columns.map(c=>({...c,index:Math.round((c.x-first)/pitch),key:JSON.stringify([c.rows[0]?token(c.rows[0]):null,c.rows[1]?token(c.rows[1]):null])}));
}
const sameOverlapRow=(a,b)=>{
  const p=a?.overlapPixels,q=b?.overlapPixels;
  if(!a||!b||a.state!==b.state||!Array.isArray(p)||!Array.isArray(q)||p.length!==432||q.length!==432||
    [...p,...q].some(n=>!Number.isSafeInteger(n)||n<0||n>255))return false;
  const avg=x=>x.reduce((s,n)=>s+n,0)/x.length,pm=avg(p),qm=avg(q);
  let covariance=0,pVariance=0,qVariance=0,delta=0;
  for(let i=0;i<p.length;i++){const x=p[i]-pm,y=q[i]-qm;covariance+=x*y;pVariance+=x*x;qVariance+=y*y;delta+=Math.abs(p[i]-q[i]);}
  return Math.sqrt(pVariance/p.length)>=10&&Math.sqrt(qVariance/q.length)>=10&&
    covariance/Math.sqrt(pVariance*qVariance)>=.995&&delta/p.length<=3;
};
const sameOverlapColumn=(a,b)=>a.key===b.key||[0,1].every(row=>sameOverlapRow(a.rows[row],b.rows[row]));
export function overlappingMarketShift(before,after){
  const matches=[],pairs=before.map(()=>[]);
  const same=(i,j)=>pairs[i][j]??=(sameOverlapColumn(before[i],after[j]));
  for(let i=0;i<before.length;i++)for(let j=0;j<after.length;j++)if(same(i,j)&&
      before[i].x>after[j].x+8){
    const shift=before[i].x-after[j].x;
    const aligned=before.filter((c,k)=>after.some((d,l)=>same(k,l)&&Math.abs(c.x-d.x-shift)<=3));
    if(aligned.length>=1&&!matches.some(m=>Math.abs(m.shift-shift)<=3))matches.push({shift,index:before[i].index-after[j].index});
  }
  return matches.length===1?matches[0]:null;
}
export class MarketVisit {
  constructor({visitId,needProjection,epoch}){
    this.visitId=visitId;this.needHash=needProjection.hash;this.epoch=epoch;
    this.remaining=Object.fromEntries(Object.values(needProjection.needs).map(n=>[n.itemId,n.quantity]));
    this.purchased=new Set();this.visited=new Set();this.columns=null;this.offset=0;this.lastRight=-1;this.pending=null;this.closed=false;this.endReason=null;this.purchaseFailure=null;
  }
  observe(reading,{scrollResult=false}={}){
    if(this.closed)fail('MARKET_VISIT_RETIRED');
    if(reading.status!=='candidate'||!reading.market||!Array.isArray(reading.rows))fail('SUPPORTED_MARKET_REQUIRED');
    // A restarted visit has no current orders. It may close a registered
    // market view without reconstructing its old horizontal exploration.
    if(this.columns===null&&!Object.values(this.remaining).some(n=>n>0))
      return {kind:'close',reason:'MARKET_NEEDS_COVERED'};
    const columns=marketColumns(reading),initialView=this.columns===null;
    if(!this.columns){if(!reading.market.leftmostVerified)fail('MARKET_LEFTMOST_REQUIRED');}
    else if(scrollResult){
      if(reading.market.viewportHash===this.viewportHash)fail('MARKET_SCROLL_NO_MOTION');
      const shift=overlappingMarketShift(this.columns,columns);if(!shift||shift.index<0)fail('MARKET_SCROLL_OVERLAP_REQUIRED');
      this.offset+=shift.index;
    }else if(reading.market.viewportHash!==this.viewportHash&&!this.allowPurchaseViewChange)fail('MARKET_VIEW_CHANGED');
    this.allowPurchaseViewChange=false;
    const oldRight=this.lastRight;
    let tail=false;
    for(const [i,c]of columns.entries()){
      const id=this.offset+c.index,isNew=id>oldRight&&!this.visited.has(id);
      if(scrollResult&&isNew&&id>0&&c.rows[0]&&c.rows[1]&&Object.values(c.rows).every(r=>r.state==='sold')&&
          ![0,1].some(row=>this.purchased.has(`${id}:${row}`)))tail=true;
      this.visited.add(id);this.lastRight=Math.max(this.lastRight,id);
      for(const row of Object.values(c.rows))row.logicalPosition=`${id}:${row.row}`;
    }
    this.columns=columns;this.viewportHash=reading.market.viewportHash;this.epoch=reading.epoch;
    // The scroll result already visited the later columns. Retain its end cue
    // for the following source callback, where scrollResult is false.
    if(tail||initialView&&this.purchased.size===0&&columns.length>0&&columns.every(c=>
      c.rows[0]?.state==='sold'&&c.rows[1]?.state==='sold'))this.endReason='MARKET_UNVISITED_SOLD_TAIL';
    else if(reading.market.plusVisible)this.endReason??='MARKET_PLUS_END';
    const need=Object.values(this.remaining).some(n=>n>0);
    if(!need)return {kind:'close',reason:'MARKET_NEEDS_COVERED'};
    if(this.purchaseFailure)return {kind:'close',reason:this.purchaseFailure};
    // Both rows are inspected before selecting a column. Clipped cells abstain.
    const offer=columns.flatMap(c=>[c.rows[0],c.rows[1]].filter(Boolean)).find(r=>r.state==='offer'&&r.itemId&&
      r.identity?.status==='matched'&&Number.isSafeInteger(r.quantity)&&r.quantity>0&&r.currency==='COIN'&&
      this.remaining[r.itemId]>0&&!this.purchased.has(r.logicalPosition));
    if(offer)return {kind:'buy',offer};
    if(this.endReason)return {kind:'exhausted',reason:this.endReason};
    return {kind:'scroll'};
  }
  requested(actionId,offer){
    if(this.pending||!(this.remaining[offer.itemId]>0)||!Number.isSafeInteger(offer.quantity)||offer.quantity<1||
      offer.currency!=='COIN'||offer.identity?.status!=='matched'||!offer.fullyVisible||!offer.logicalPosition||
      this.purchased.has(offer.logicalPosition))fail('MARKET_PURCHASE_CONTEXT_CHANGED');
    this.pending={actionId,itemId:offer.itemId,quantity:offer.quantity,logicalPosition:offer.logicalPosition};
  }
  verified(result){
    const p=this.pending;
    if(!p||result.actionId!==p.actionId||result.itemId!==p.itemId||result.quantity!==p.quantity||result.soldConfirmed!==true)fail('MARKET_RESULT_REQUIRED');
    this.remaining[p.itemId]=Math.max(0,this.remaining[p.itemId]-p.quantity);this.purchased.add(p.logicalPosition);this.pending=null;this.allowPurchaseViewChange=true;
  }
  rejected(result){
    const p=this.pending;
    if(!p||result.actionId!==p.actionId||result.itemId!==p.itemId||result.quantity!==p.quantity||
      result.purchaseRejected!==true||result.acquiredQuantity!==0||
      !['MARKET_INSUFFICIENT_COINS','MARKET_BARN_FULL'].includes(result.rejectionReason))fail('MARKET_REJECTION_REQUIRED');
    // A classified zero-acquisition result ends sourcing for this visit. It
    // never deducts need or creates another purchase attempt.
    this.purchaseFailure=result.rejectionReason;this.pending=null;
  }
  retire(){this.closed=true;this.columns=null;}
}
export function freeMarketCountdown(raw){
  // Only caller's separately verified NEW OFFERS IN field is allowed here.
  const m=/^\s*(?:(\d{1,2})\s*H)?\s*(?:(\d{1,2})\s*M)?\s*(?:(\d{1,2})\s*S)?\s*$/i.exec(raw??'');
  if(!m||!m.slice(1).some(Boolean))return null;
  const [h,min,s]=m.slice(1).map(x=>Number(x??0));
  return min<60&&s<60&&h<=24?(h*3600+min*60+s)*1000:null;
}
