// Coordination only. Each disposable domain owns its work and invalidation.
import {SurveySession} from './survey.mjs';
import {MarketVisit} from './market-visit.mjs';
import {BarnRecovery} from './barn-recovery.mjs';
import {DealerSearch,dealerAction} from './dealer.mjs';
import {readyOrder,somActionPolicy} from './actions.mjs';
import {MarketSession} from './market-session.mjs';
import {orderQuantityLimitReached} from './text-decisions.mjs';
export {validateIntent,resultOutcome,readyOrder,soldOutView} from './actions.mjs';
export {near,sameBox,descriptorDistance,visionProof} from './geometry.mjs';

export class SomWorkflow{
  constructor({clock=Date.now,dealerSearch=new DealerSearch({clock}),archiveFailedProduct=()=>{}}={}){
    this.archiveFailedProduct=archiveFailedProduct;
    this.clock=clock;this.dealerSearch=dealerSearch;this.cycle=0;this.reset();this.phase='survey';this.destination='helicopter';
  }
  reset(){
    this.timerRequired=false;
    this.cycle++;this.survey=new SurveySession();this.market=new MarketVisit();
    this.marketReset=null;this.barnRecovery=null;
  }
  // A read-only projection of the currently owned image list; never a ledger.
  get needs(){return this.destination==='market'?this.market.needs:this.survey.needs;}
  summary(){
    return {mode:'som',cycle:this.cycle,step:this.phase,neededImages:this.needs.size,
      inspectedOrders:this.survey.visited.length,heldOrders:this.survey.held.length,
      holdReasons:[...new Set(this.survey.held.map(h=>h.reason))],marketPages:this.market.pages,quantityTracking:false,
      ...(this.marketSession?.summary(this.clock())??{})};
  }
  settle(intent,vision,outcome){
    const effect=somActionPolicy(intent.kind)?.effect;
    if(effect==='purchase'||effect==='scroll'){this.market.settle(intent,vision,outcome);return;}
    if(effect==='navigation'){
      this.marketSession?.navigated();
      this.survey.settle(intent,outcome);this.marketReset?.settle(intent,outcome);return;
    }
    if(outcome==='unconfirmed'&&intent.kind==='som_barn_sell'){
      this.barnRecovery?.settle(intent);this.phase='barn_recovery';
      if(this.barnRecovery?.stage==='leave')this.destination='helicopter';return;
    }
    if(outcome!=='confirmed')return;
    if(effect==='panel_exit'){this.marketReset?.settle(intent,outcome);this.marketSession?.navigated();}
    if(effect==='deletion'){
      if(intent.reason==='market_return_no_deliverable_orders'&&this.marketReset)this.marketReset.settle(intent,outcome);
      else {this.reset();this.phase='survey';this.destination='helicopter';}
    }
    if(effect==='delivery'){this.marketReset=null;this.survey.afterDelivery();this.phase='deliver';}
    if(effect==='market_entry')this.market.opened();
    if(effect==='barn'){
      this.barnRecovery?.settle(intent);
      if(intent.kind==='som_barn_sell'&&this.barnRecovery?.stage==='leave')this.destination='helicopter';
    }
    if(effect==='panel_exit'&&intent.next==='town'&&this.barnRecovery?.stage==='leave'){
      this.barnRecovery=null;this.phase='deliver';this.destination='helicopter';
    }
  }
  recoverCompleted(intent,vision){
    if(['som_claim','som_close_popup'].includes(intent.kind)){
      this.popupRecovery??={closeRetries:0};
      if(intent.kind==='som_claim')this.popupRecovery.claimHeld=true;
      return;
    }
    this.settle(intent,vision,'unconfirmed');
    if(intent.kind==='som_delete'){this.survey.reset();this.marketReset=null;this.destination='helicopter';this.phase='deliver';}
  }
  finishMarket({exhausted=false}={}){
    this.timerRequired=false;
    const reset=this.market.finish(exhausted,this.clock());
    if(this.destination==='market')this.marketReset=reset;
    this.survey.reset();this.phase='deliver';this.destination='helicopter';
  }
  startShopping(v){
    this.market=new MarketVisit(this.survey,v,{session:this.marketSession??null});this.destination='market';this.phase='shopping';
    return v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null;
  }
  planReset(v){
    if(!this.marketReset)return null;
    const decision=this.marketReset.plan(v,this.clock());
    if(decision.reset==='abandon'){this.marketReset=null;this.survey.route=null;}
    else if(decision.reset){this.reset();this.phase=decision.reset;}
    if(decision.phase)this.phase=decision.phase;
    return decision.action??null;
  }
  planHelicopter(v){
    if(['market','barn'].includes(this.destination))return v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null;
    if(readyOrder(v))this.marketReset=null;
    const resetAction=this.planReset(v);if(resetAction)return resetAction;
    if(readyOrder(v))return {kind:'som_send',box:v.send,orderHash:v.orderHash,
      greenPins:v.pins.filter(p=>p.color==='green').map(p=>p.box),next:'helicopter'};
    this.phase='survey';const decision=this.survey.plan(v,this.clock());
    return decision.shopping?this.startShopping(v):decision.action;
  }
  async planAndroidHelicopter(v,client){
    if(this.destination==='market'&&(readyOrder(v)||orderQuantityLimitReached(v)))this.finishMarket();
    if(['market','barn'].includes(this.destination))return v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null;
    const s=this.marketSession,now=this.clock();
    const review=await s.review(v,client,now);
    if(!review&&readyOrder(v)){
      s.navigated();return {kind:'som_send',box:v.send,orderHash:v.orderHash,greenPins:v.pins.filter(p=>p.color==='green').map(p=>p.box),next:'helicopter'};
    }
    if(review?.proof&&s.deadline===null)this.timerRequired=true;
    if(review?.waitMs)return review;
    if(review?.proof&&s.deletionAllowed(this.clock())&&v.trash)return {kind:'som_delete',box:v.trash,orderHash:v.orderHash,
      reason:review.reason,sessionDeleteProof:review.proof,next:'helicopter'};
    this.phase='survey';const decision=this.survey.plan(v,now,{skip:!!review?.proof});
    if(decision.shopping)return this.startShopping(v);
    if(decision.action?.kind==='som_select')return decision.action;
    // Unread/failed-only surveys may need one normal entry to establish time.
    if(this.timerRequired&&s.deadline===null)return this.startShopping(v);
    // A deferred order must not pin the phone on this panel for the cooldown.
    if(review?.proof&&v.close)return {kind:'som_close_panel',box:v.close,next:'town',reason:'order_deletion_deferred'};
    return decision.action;
  }
  async plan(v,client){
    // Only the current market observation may qualify a SOLD completion.
    // Popup/barn/other routes can finish the old visit without MarketVisit.plan.
    this.market.soldOutCompleted=false;
    if(v.provider==='android_adb'){
      this.marketSession??=new MarketSession({archive:this.archiveFailedProduct});this.marketSession.expire(this.clock());
    }
    if(v.minigame?.detected)return null;
    if(!v.popup&&['town','helicopter','market','barn'].includes(v.scene))this.popupRecovery=null;
    if(v.barnFull?.detected||v.popup?.kind==='barn_full'){
      if(!this.barnRecovery){this.finishMarket();this.barnRecovery=new BarnRecovery();this.phase='barn_recovery';this.destination='barn';}
      if(!v.popup)return null;
    }
    if(v.popup){
      this.market.scrollAlignment=null;
      if(this.popupRecovery){
        const p=v.popup.kind==='claim'?v.popupClose:v.popup;
        if(!p||this.popupRecovery.closeRetries>=1)return {waitMs:3000,reason:p?'SOM_POPUP_CLOSE_FAILED':'SOM_POPUP_CLOSE_REQUIRED'};
        this.popupRecovery.closeRetries++;
        return {kind:'som_close_popup',box:p.box,hash:p.hash,popupKind:p.kind,popupContext:p.contextHash,
          ...(p===v.popupClose?{popupPanelContext:v.popup.contextHash}:{}),next:'unknown'};
      }
      return {kind:v.popup.kind==='claim'?'som_claim':'som_close_popup',box:v.popup.box,hash:v.popup.hash,
        popupKind:v.popup.kind,popupContext:v.popup.contextHash,next:'unknown'};
    }
    if(['dealer_search','dealer_offers'].includes(v.scene))return dealerAction(v,this.dealerSearch);
    if(v.scene==='town'){
      this.survey.route=null;
      const box=v[this.destination];return box?{kind:'som_open_'+this.destination,box,next:this.destination}:null;
    }
    if(v.scene==='barn'){
      const action=this.barnRecovery?.plan(v)??(v.close?{kind:'som_close_panel',box:v.close,next:'town',reason:'unexpected_barn'}:null);
      if(action?.reason==='barn_recovery_abandoned'||action?.reason==='unexpected_barn'){
        this.barnRecovery=null;this.destination='helicopter';this.phase='deliver';
      }
      return action;
    }
    if(v.scene==='helicopter')return v.provider==='android_adb'?this.planAndroidHelicopter(v,client):this.planHelicopter(v);
    if(v.scene==='market'){
      this.market.observeEntry(v,this.clock());
      if(this.barnRecovery)return v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null;
      const dealer=dealerAction(v,this.dealerSearch);if(dealer)return dealer;
      const decision=await this.market.plan(v,client,this.destination==='market',this.clock());
      if(decision.finished)this.finishMarket({exhausted:decision.exhausted});
      return decision.action;
    }
    return null;
  }
}
