import {randomUUID} from 'node:crypto';
import {refreshDeadline} from './market-reset.mjs';
import {orderShortagesKnown,orderQuantityLimitReached} from './text-decisions.mjs';
import {sha} from './client.mjs';
import {permanentFailedProducts} from './failed-products.mjs';
export const DELETE_MIN_REMAINING_MS=15*60*1000;
export const PURCHASE_SHORTAGE_FAILURE_LIMIT=2;
export const MARKET_SEARCH_FAILURE_LIMIT=2;
const scope=v=>JSON.stringify([v.profileHash,v.viewport,v.captureSize]);
const sameSource=(a,b)=>!!a?.frameId&&!!a.evidenceHash&&a.frameId===b?.frameId&&a.evidenceHash===b?.evidenceHash;
const precision=r=>/S\s*$/i.test(r?.rawText??'')?1000:/M\s*$/i.test(r?.rawText??'')?60000:3600000;
const productHash=slot=>sha(slot.image);
const permanentScope=(v,p)=>v.provider==='android_adb'&&v.captureSize?.width===p.source.dimensions.width&&v.captureSize?.height===p.source.dimensions.height;
const ready=v=>v.scene==='helicopter'&&!v.refreshing&&orderShortagesKnown(v)&&!orderQuantityLimitReached(v)&&v.missing.length===0&&!!v.send;

// One refresh period, independent of shopping visits, order routes and deliveries.
// Only requested artwork and bounded decision state survive between visits.
export class MarketSession{
  constructor({archive=()=>{}}={}){this.archive=archive;this.permanentProducts=permanentFailedProducts();this.clear();}
  clear(){this.id=randomUUID();this.products=structuredClone(this.permanentProducts);this.timer=null;this.deadline=null;this.scope=null;this.retry=null;}
  expire(now){if(this.deadline!==null&&now>=this.deadline){this.clear();return true;}return false;}
  observeTimer(v,now){
    this.expire(now);
    const deadline=refreshDeadline(v),s=scope(v);
    if(deadline===null||Date.parse(v.marketRefresh.observedAt)>now||deadline<=now)return false;
    if(this.scope&&this.scope!==s)this.clear();
    if(this.deadline!==null&&deadline>this.deadline+Math.max(precision(this.timer),precision(v.marketRefresh))+1000)this.clear();
    this.scope=s;
    // Do not turn display rounding into an extension of deletion authority.
    if(this.deadline===null||deadline<this.deadline){this.deadline=deadline;this.timer=structuredClone(v.marketRefresh);}
    return true;
  }
  deletionAllowed(now){this.expire(now);return this.deadline!==null&&this.deadline-now>=DELETE_MIN_REMAINING_MS;}
  async compare(slot,p,client){
    if(p.hash===slot.hash&&p.image===slot.image)return 'same_product';
    let uncertain=false;
    for(const image of [p.image,...p.variants]){
      const choice=(await client.match(slot.image,image)).choice;
      if(choice==='same_product')return choice;
      uncertain||=choice!=='different_product';
    }
    return uncertain?'uncertain':'different_product';
  }
  async bindNeeds(needs,client){
    for(const n of needs.values()){
      let p=this.products.find(p=>p.hash===n.hash&&p.image===n.image);
      if(!p)for(const candidate of this.products)if(await this.compare(n,candidate,client)==='same_product'){p=candidate;break;}
      if(!p){p={id:randomUUID(),hash:n.hash,image:n.image,variants:[...(n.variants??[])],source:n.source??null,failures:0,searchFailures:0,lastAbsentVisit:null,failed:false,pending:[]};this.products.push(p);}
      n.sessionProductId=p.id;
      if(p.failed)needs.delete(n.hash);
    }
  }
  purchased(id,token){const p=this.products.find(p=>p.id===id);if(p&&!p.failed&&!p.pending.some(x=>x.token===token))p.pending.push({token,evaluated:false});}
  fail(p,reason){
    if(p.failed)return;
    this.archive({hash:p.hash,image:p.image,source:p.source,reason,failures:p.failures,searchFailures:p.searchFailures??0,sessionId:this.id});
    p.failed=true;p.reason=reason;p.pending=[];
  }
  absent(ids,visitId){
    if(typeof visitId!=='string'||!visitId)return;
    for(const id of new Set(ids)){
      const p=this.products.find(p=>p.id===id);
      if(!p||p.failed||p.lastAbsentVisit===visitId)continue;
      p.searchFailures=(p.searchFailures??0)+1;p.lastAbsentVisit=visitId;
      if(p.searchFailures>=MARKET_SEARCH_FAILURE_LIMIT)this.fail(p,'market_product_not_found');
    }
  }
  proof(v,reason,details={}){return {schema:1,sessionId:this.id,scope:this.scope,orderHash:v.orderHash,sourceObservation:v.sourceObservation,
    timerSource:this.timer,refreshDeadline:this.deadline,reason,...details};}
  retryUnread(v,comparisons=[]){
    const source=v.sourceObservation;
    const kind=comparisons.length?'comparison':'quantity';
    if(this.retry?.orderHash===v.orderHash&&this.retry.kind===kind&&this.retry.scope===scope(v)&&!sameSource(this.retry.sourceObservation,source)&&
      (kind==='quantity'||comparisons.some(c=>this.retry.comparisons.some(old=>old.slotId===c.slotId&&old.productId===c.productId))))
      return {reason:'order_unread_after_retry',proof:this.proof(v,'order_unread_after_retry',{retry:this.retry,comparisons})};
    this.retry={kind,orderHash:v.orderHash,scope:scope(v),sourceObservation:source,comparisons};
    return {waitMs:600,reason:'SOM_ORDER_REOBSERVE'};
  }
  async review(v,client,now){
    this.expire(now);
    if(this.scope&&this.scope!==scope(v))this.clear();
    if(v.refreshing){this.retry=null;return null;}
    if(!v.orderHash||!Array.isArray(v.orderSlots)||!v.orderSlots.length)return null;
    if(!orderShortagesKnown(v))return this.retryUnread(v);
    if(orderQuantityLimitReached(v)){
      this.retry=null;return {reason:'order_quantity_limit',proof:this.proof(v,'order_quantity_limit')};
    }
    const orderReady=ready(v);
    const comparisons=[];
    const compare=async(slot,p)=>{
      const choice=await this.compare(slot,p,client);
      if(choice==='uncertain')comparisons.push({slotId:slot.id,hash:slot.hash,imageHash:productHash(slot),productId:p.id,choice});
      return choice;
    };
    // Only current shortages evaluate purchases. A sufficient slot or another
    // ready order does not imply this requested product's need was resolved.
    for(const slot of orderReady?[]:v.missing){
      for(const p of this.products.filter(p=>p.pending.some(x=>!x.evaluated))){
        const choice=await compare(slot,p);
        if(choice!=='same_product')continue;
        // Each distinct confirmed purchase is evaluated once, not once per order.
        const pending=p.pending.filter(x=>!x.evaluated);
        for(const x of pending)x.evaluated=true;
        p.failures++;
        if(p.failures>=PURCHASE_SHORTAGE_FAILURE_LIMIT)this.fail(p,'purchase_shortage_repeated');
      }
    }
    for(const slot of v.orderSlots.filter(s=>s.amount?.reading?.status!=='empty')){
      for(const p of this.products.filter(p=>p.failed&&(!orderReady||p.permanent)&&(!p.permanent||permanentScope(v,p)))){
        const choice=await compare(slot,p);
        if(choice==='same_product'){
          this.retry=null;
          return {reason:'failed_product',proof:this.proof(v,'failed_product',{product:{id:p.id,hash:p.hash,imageHash:sha(p.image),reason:p.reason,failures:p.failures},
            match:{choice,slotId:slot.id,hash:slot.hash,imageHash:productHash(slot)}})};
        }
      }
    }
    if(comparisons.length)return this.retryUnread(v,comparisons);
    this.retry=null;return null;
  }
  navigated(){this.retry=null;}
  summary(now){this.expire(now);return {marketSession:this.id,marketRemainingMs:this.deadline===null?null:Math.max(0,this.deadline-now),failedProducts:this.products.filter(p=>p.failed).length};}
}

// Pure proof check repeated immediately before native dispatch. The surrounding
// input executor still enforces current frame, owner, device and percentage guards.
export function validSessionDelete(v,i,now){
  const p=i.sessionDeleteProof;
  if(v.provider!=='android_adb'||!p||p.schema!==1||!p.sessionId||p.scope!==scope(v)||p.orderHash!==v.orderHash||
    !sameSource(p.sourceObservation,v.sourceObservation)||p.reason!==i.reason||
    p.refreshDeadline!==refreshDeadline({marketRefresh:p.timerSource})||Date.parse(p.timerSource?.observedAt)>now||
    !Number.isFinite(p.refreshDeadline)||p.refreshDeadline-now<DELETE_MIN_REMAINING_MS||v.refreshing)return false;
  if(ready(v)&&!(p.reason==='failed_product'&&p.product?.reason==='permanent_failed_product'))return false;
  if(p.reason==='order_quantity_limit')return orderQuantityLimitReached(v);
  if(p.reason==='failed_product'){
    const m=p.match,s=v.orderSlots?.find(s=>s.id===m?.slotId),f=p.product;
    const permanent=f?.reason==='permanent_failed_product'&&permanentFailedProducts().some(p=>permanentScope(v,p)&&p.id===f.id&&p.hash===f.hash&&sha(p.image)===f.imageHash);
    return orderShortagesKnown(v)&&(permanent||v.missing.length>0)&&m?.choice==='same_product'&&s?.hash===m.hash&&productHash(s)===m.imageHash&&
      !!f?.id&&!!f.hash&&!!f.imageHash&&(permanent||['market_product_not_found','purchase_shortage_repeated'].includes(f.reason)&&
      (f.reason!=='purchase_shortage_repeated'||f.failures>=PURCHASE_SHORTAGE_FAILURE_LIMIT));
  }
  if(p.reason==='order_unread_after_retry')return !!p.retry&&p.retry.orderHash===v.orderHash&&p.retry.scope===scope(v)&&
    !!p.retry.sourceObservation?.frameId&&!!p.retry.sourceObservation.evidenceHash&&!sameSource(p.retry.sourceObservation,v.sourceObservation)&&
    (p.retry.kind==='quantity'&&!orderShortagesKnown(v)||p.retry.kind==='comparison'&&orderShortagesKnown(v)&&
      Array.isArray(p.comparisons)&&p.comparisons.some(c=>{
        const s=v.orderSlots?.find(s=>s.id===c.slotId);
        return c.choice==='uncertain'&&s?.hash===c.hash&&productHash(s)===c.imageHash&&
          p.retry.comparisons?.some(old=>old.choice==='uncertain'&&old.slotId===c.slotId&&old.productId===c.productId);
      }));
  return false;
}
