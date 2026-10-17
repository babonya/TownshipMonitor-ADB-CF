import {OrderRoute} from './order-route.mjs';
import {near} from './geometry.mjs';
import {orderShortagesKnown,orderQuantityLimitReached} from './text-decisions.mjs';

// One disposable panel survey owns its route, observations and ungrouped needs.
export class SurveySession{
  constructor(){this.reset();}
  reset(){
    this.route=null;this.visited=[];this.held=[];this.refreshPins=[];
    this.orders=[];this.needs=new Map();
  }
  afterDelivery(){this.orders=[];this.visited=[];this.needs.clear();this.route=null;}
  settle(intent,outcome){
    this.route?.settle(intent,outcome);
    if(outcome==='navigation_departed')this.route=null;
  }
  collect(v,selectedBox){
    if(!orderShortagesKnown(v)||orderQuantityLimitReached(v)||this.visited.some(b=>near(b,selectedBox)))return;
    this.visited.push({...selectedBox});
    for(const item of v.missing??[])this.needs.set(item.hash,item);
    this.orders.push({box:{...selectedBox},orderHash:v.orderHash});
  }
  plan(v,now,{skip=false}={}){
    skip=skip||orderQuantityLimitReached(v);
    if(!this.route||!this.route.matches(v)){this.reset();this.route=new OrderRoute(v);}
    const current=this.route.currentBox(v);
    if(current){
      this.held=this.held.filter(h=>!near(h.box,current));
      if(skip){if(!this.visited.some(b=>near(b,current)))this.visited.push({...current});}
      else if(v.refreshing){
        if(!this.refreshPins.some(b=>near(b,current)))this.refreshPins.push({...current});
      }else if(orderShortagesKnown(v))this.collect(v,current);
      else if(!this.visited.some(b=>near(b,current)))this.held.push({box:{...current},orderHash:v.orderHash,
        resetEligible:false,reason:'SOM_ORDER_SHORTAGE_UNCLEAR'});
    }
    const action=this.route.next(v,now);
    if(action)return {action};
    if(!current&&!skip&&!v.refreshing&&orderShortagesKnown(v))for(const item of v.missing)this.needs.set(item.hash,item);
    if(this.needs.size||this.held.some(o=>o.resetEligible))return {shopping:true};
    // Keep the phone active by leaving a completed all-refreshing survey.
    // A missing marker alone is not refresh evidence; retain unread orders.
    if(v.refreshing&&!this.visited.length&&!this.held.length&&this.refreshPins.length===this.route.entries.length&&
      v.pins.every(p=>p.color==='red'&&this.refreshPins.some(b=>near(b,p.box)))&&v.close)
      return {action:{kind:'som_close_panel',box:v.close,next:'town',reason:'all_orders_refreshing'}};
    return {action:v.close?{kind:'som_close_panel',box:v.close,next:'town',reason:'order_survey_finished'}:
      {waitMs:3000,reason:'SOM_HELICOPTER_CLOSE_REQUIRED'}};
  }
}
