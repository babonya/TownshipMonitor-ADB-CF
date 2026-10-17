import {MarketPosition} from './market-position.mjs';
import {MarketMemory} from './market-memory.mjs';
import {MarketScan} from './market-reset.mjs';
import {soldOutView} from './actions.mjs';
import {descriptorDistance} from './geometry.mjs';
import {scrollIntent,scrollResult,scrollScope} from './market-scroll.mjs';
import {randomUUID} from 'node:crypto';

export class MarketVisit{
  constructor(survey=null,vision=null,{session=null}={}){
    this.session=session;this.visitId=randomUUID();this.uncertainNeeds=new Set();this.timerReads=0;this.timerReady=false;
    this.sessionId=session?.id;this.timerOnly=!!session&&!survey?.needs?.size;this.soldOutCompleted=false;
    this.needs=new Map(survey?.needs??[]);this.scan=survey?new MarketScan(survey,vision):null;
    this.offers=new Set();this.attemptedNeeds=new Set();this.purchasedImages=[];this.confirmedPurchases=new Set();
    this.preparedNeeds=null;this.marketMemory=new MarketMemory();this.pendingOffer=null;
    this.pages=0;this.scrollAlignment=null;this.position=new MarketPosition();this.positionWaits=0;this.positionWaitFrame=null;
  }
  opened(){this.soldOutCompleted=false;this.position.reset();this.positionWaits=0;this.positionWaitFrame=null;this.scrollWaits=0;this.scrollWaitFrame=null;if(this.scan)this.scan.started=true;this.pages=0;this.scrollAlignment=null;}
  hasShoppingState(){return this.scan?.views>0||this.preparedNeeds!==null||this.pages>0||this.offers.size>0||this.attemptedNeeds.size>0;}
  observeEntry(v,now){
    if(!this.session||this.timerReady||this.timerReads>=2||!v.marketRefresh)return;
    const frame=v.sourceObservation?.frameId;
    if(frame&&frame!==this.timerFrame){
      this.timerFrame=frame;this.timerReads++;
      this.timerReady=this.session.observeTimer(v,now);
      if(this.session.id!==this.sessionId&&this.hasShoppingState())this.sessionChanged=true;
      else this.sessionId=this.session.id;
    }
  }
  settle(intent,vision,outcome){
    this.position.settle(intent,vision,outcome);
    if(intent.kind==='som_buy'){
      if(outcome==='confirmed')this.confirmedPurchases.add(intent.hash);
      if(outcome==='confirmed'&&this.session?.id===this.sessionId){
        const need=this.needs.get(intent.needHash);
        if(need?.sessionProductId)this.session.purchased(need.sessionProductId,this.visitId+':'+intent.hash);
      }
      // Dispatch consumes the visit attempt, including a popup interruption.
      this.offers.add(intent.hash);this.attemptedNeeds.add(intent.needHash);
      if(this.pendingOffer?.hash===intent.hash){
        this.purchasedImages.push(this.pendingOffer.image);this.marketMemory.remember(this.pendingOffer);this.pendingOffer=null;
      }
    }
    if(intent.kind==='som_scroll'){
      if(outcome!=='confirmed'){this.scrollAlignment=null;return;}
      this.pages++;this.scrollAlignment={...scrollResult(intent,vision),scope:scrollScope(vision)};
      if(descriptorDistance(intent.descriptor,vision.descriptor)<3)this.scrollAlignment={end:true,scope:scrollScope(vision)};
    }
  }
  finish(exhausted,now){
    this.session?.expire(now);
    if(this.session&&this.session.id===this.sessionId&&this.scan?.started&&this.scan.scopeConsistent&&!this.unobservedOffers&&
      (this.soldOutCompleted||exhausted&&this.scan.complete&&this.scan.rightEdgeComplete&&(this.scan.terminalVerified||this.scrollAlignment?.end)))
      this.session.absent([...this.needs.values()].filter(n=>!this.attemptedNeeds.has(n.hash)&&!this.uncertainNeeds.has(n.hash)).map(n=>n.sessionProductId),this.visitId);
    const reset=this.session?null:this.scan?.finish(exhausted,this.attemptedNeeds,now)??null;
    this.soldOutCompleted=false;this.needs.clear();this.offers.clear();this.attemptedNeeds.clear();this.purchasedImages=[];this.confirmedPurchases.clear();
    this.preparedNeeds=null;this.marketMemory.clear();this.pendingOffer=null;this.scrollAlignment=null;this.position.reset();this.positionWaits=0;this.positionWaitFrame=null;
    return reset;
  }
  finishDecision(v,exhausted=false){return {finished:true,exhausted,action:v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null};}
  scrollDecision(v){
    let intent=scrollIntent(v,{anchorPhase:this.scrollAlignment?.anchorPhase??null});
    if(!intent&&this.scrollAlignment?.anchorPhase!=null){this.scrollAlignment=null;intent=scrollIntent(v);}
    if(intent){this.scrollWaits=0;this.scrollWaitFrame=null;return {action:this.position.scroll(v,intent)};}
    const frame=v.sourceObservation?.frameId;
    if(frame&&frame!==this.scrollWaitFrame){this.scrollWaits=(this.scrollWaits??0)+1;this.scrollWaitFrame=frame;}
    if(this.scrollWaits>=2&&v.close)return this.finishDecision(v);
    return {action:{waitMs:3000,reason:this.scrollWaits>=2?'SOM_MARKET_CLOSE_REQUIRED':'SOM_SCROLL_GEOMETRY_REQUIRED'}};
  }
  async prepareNeeds(client){
    const key=[...this.needs.keys()].join('|');if(key===this.preparedNeeds)return;
    const groups=[];
    for(const item of this.needs.values()){
      let duplicate=false;
      for(const group of groups)if((await client.match(group.image,item.image)).choice==='same_product'){
        group.variants.push(item.image);duplicate=true;break;
      }
      if(!duplicate)groups.push({...item,variants:[...(item.variants??[])]});
    }
    this.needs=new Map(groups.map(n=>[n.hash,n]));this.preparedNeeds=[...this.needs.keys()].join('|');
    if(this.session)await this.session.bindNeeds(this.needs,client);
    this.offers.clear();this.marketMemory.clear();
  }
  async plan(v,client,active=true,now=Date.now()){
      this.soldOutCompleted=false;
      this.observeEntry(v,now);
      if(this.sessionChanged||this.session&&this.session.id!==this.sessionId&&this.hasShoppingState())return this.finishDecision(v);
      if(v.motionPending)return {action:{waitMs:100}};
      if(this.session?.expire(now)||this.session&&this.timerReady&&this.session.id!==this.sessionId)return this.finishDecision(v);
      if(this.session&&!this.timerReady&&this.timerReads<2){
        const frame=v.sourceObservation?.frameId;
        if(frame&&frame!==this.timerWaitFrame){this.timerWaitFrame=frame;this.timerWaits=(this.timerWaits??0)+1;}
        // Missing caption frames do not spend OCR attempts or prevent a later
        // valid first reading. Give them only one fresh observation wait.
        if((this.timerWaits??0)<2)return {action:{waitMs:600,reason:'SOM_MARKET_TIMER_REOBSERVE'}};
      }
      if(this.timerOnly)return this.finishDecision(v);
      // The user's SOLD completion rule uses this current verified observation.
      // Bind requested artwork even if the existing exit precedes offer matching.
      // A later observation replaces this flag; it is consumed only on finish.
      if(active&&this.session&&soldOutView(v)&&v.close&&(!this.scan?.scope||this.scan.scope===scrollScope(v))){
        await this.prepareNeeds(client);this.soldOutCompleted=true;
      }
      // Only confirmed purchases count; interrupted attempts still keep their
      // existing per-product retry guard. Return before more matching or scrolling.
      // 사용자 결정 2026-10-15: 4개 구매 후에도(창고 때문에 더 사지는 않음) 남은 필요 상품이 있으면 오른쪽 끝까지
      // 훑기만 계속해 '시장에 없음'을 센다. 원본은 여기서 바로 닫아 실패 상품이 생기지 않았다.
      const batchFull=active&&this.confirmedPurchases.size>=4;
      if(batchFull&&!(this.session&&this.scan?.source&&this.scan.complete&&!this.scrollAlignment?.end&&v.marketEnd!==true&&this.pages<30&&
        [...this.needs.values()].some(n=>!this.attemptedNeeds.has(n.hash)&&!this.uncertainNeeds.has(n.hash))))return v.close?
        {finished:true,exhausted:false,action:{kind:'som_close_panel',box:v.close,next:'town',reason:'market_purchase_batch_complete'}}:{action:null};
      if(this.scrollAlignment&&this.scrollAlignment.scope!==scrollScope(v))this.scrollAlignment={hold:'SOM_SCROLL_GEOMETRY_CHANGED',scope:scrollScope(v)};
      if(active&&soldOutView(v)&&!this.scan?.source)return v.close?{finished:true,exhausted:false,action:{kind:'som_close_panel',box:v.close,next:'town',reason:'all_visible_products_sold'}}:{action:null};
      if(active){
        const positionAction=this.scrollAlignment?.hold?{waitMs:3000,reason:this.scrollAlignment.hold}:this.position.prepare(v);
        if(positionAction){
          // Permit one new observation, then leave this visit through the
          // current close target instead of holding the entire loop forever.
          const frame=v.sourceObservation?.frameId;
          if(frame&&frame!==this.positionWaitFrame){this.positionWaits++;this.positionWaitFrame=frame;}
          if(this.positionWaits>=2&&v.close)return this.finishDecision(v);
          return {action:positionAction};
        }
        this.positionWaits=0;this.positionWaitFrame=null;
      }
      this.scan?.observe(v);
      if(this.session&&v.cells?.some(c=>c.state==='unknown'))this.unobservedOffers=true;
      if(soldOutView(v)){
        if(!v.close)return {action:null};
        if(this.scan?.source&&!this.scan?.matched&&!v.marketEnd&&!this.scrollAlignment?.end&&this.pages<30)
          return this.scrollDecision(v);
        return {finished:true,exhausted:v.marketEnd===true||this.scrollAlignment?.end===true,action:{kind:'som_close_panel',box:v.close,next:'town',reason:'all_visible_products_sold'}};
      }
      if(!active||this.pages>=30){return this.finishDecision(v);}
      await this.prepareNeeds(client);
      if(this.marketMemory.bind(v))this.offers.clear();
      const needs=[...this.needs.values()].filter(n=>!this.attemptedNeeds.has(n.hash));
      if(!needs.length){
        // Finish an existing market scan when no purchase candidates remain.
        if(this.scan?.source&&!this.attemptedNeeds.size&&!this.scan.matched)
          return v.marketEnd===true?this.finishDecision(v,true):this.scrollDecision(v);
        return this.finishDecision(v);
      }
      offers:for(const cell of v.cells){
        if(cell.state!=='offer'||!this.position.eligible(v,cell)||this.offers.has(cell.hash)||this.marketMemory.seen(cell))continue;
        // D1's winning choice is sufficient; accepted product errors are not
        // silently reintroduced as confidence/margin gates.
        for(const need of needs){
          if(this.attemptedNeeds.has(need.hash))continue;
          let result=await client.match(need.image,cell.image);
          let uncertain=result.choice!=='different_product'&&result.choice!=='same_product';
          // Preserve an alternate observed crop for an unreadable primary.
          if(result.choice==='uncertain')for(const image of need.variants??[]){
            result=await client.match(image,cell.image);uncertain||=result.choice!=='different_product'&&result.choice!=='same_product';if(result.choice==='same_product')break;
          }
          if(result.choice==='same_product'){
            if(this.scan)this.scan.matched=true;
            // 훑기만 하는 중: 시장에 있음을 확인했으니 '없음'에서 빼고 사지는 않는다.
            if(this.confirmedPurchases.size>=4){this.attemptedNeeds.add(need.hash);continue;}
            // An uncertain survey alias can remain separate. Check purchased
            // artwork only on a prospective buy, not against every offer.
            for(const image of this.purchasedImages)if((await client.match(image,cell.image)).choice==='same_product'){
              this.attemptedNeeds.add(need.hash);this.offers.add(cell.hash);this.marketMemory.remember(cell);continue offers;
            }
            this.pendingOffer=cell;
            return {action:{kind:'som_buy',box:cell.buy,cell:cell.card,hash:cell.hash,match:result,needHash:need.hash,marketPosition:this.position.proof(v),next:'market'}};
          }
          if(uncertain&&this.scan){this.scan.uncertain=true;this.uncertainNeeds.add(need.hash);}
        }
        this.offers.add(cell.hash);this.marketMemory.remember(cell);
      }
      if([...this.needs.values()].every(n=>this.attemptedNeeds.has(n.hash))){return this.finishDecision(v);}
      if(this.scrollAlignment?.end||v.marketEnd===true){return this.finishDecision(v,true);}
      return this.scrollDecision(v);
  }
}
