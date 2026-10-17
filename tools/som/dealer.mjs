import {sameBox} from './geometry.mjs';
export const DEALER_COOLDOWN_MS=60*60*1000;

// Only a visit flag and a deadline; no stock or purchase history.
export class DealerSearch{
  constructor({clock=Date.now,nextAt=0}={}){this.clock=clock;this.nextAt=nextAt;this.checked=false;}
  enabled(){return !this.checked&&this.clock()>=this.nextAt;}
  observe(scene){if(['town','helicopter'].includes(scene))this.checked=false;else if(scene==='market')this.checked=true;}
}

export function dealerAction(v,search){
  if(v.scene==='market')return v.dealerSearch?.answer?.choice==='yes'&&search.clock()>=search.nextAt?
    {kind:'som_dealer_open',box:v.dealerSearch.box,hash:v.dealerSearch.hash,next:'dealer_search'}:null;
  if(!['dealer_search','dealer_offers'].includes(v.scene))return null;
  const d=v.dealer??{};
  if(search.clock()<search.nextAt)return v.close?{kind:'som_close_panel',box:v.close,next:'market'}:null;
  if(v.scene==='dealer_offers')return d.buy?{kind:'som_dealer_buy',box:d.buy,next:'market'}:null;
  if(!d.miningActive)return d.tab?{kind:'som_dealer_tab',box:d.tab,next:'dealer_search'}:null;
  if(!d.selectedPickaxe)return d.pickaxe?{kind:'som_dealer_select',box:d.pickaxe,next:'dealer_search'}:null;
  return d.search?{kind:'som_dealer_search',box:d.search,next:'dealer_offers'}:null;
}

export function validDealerIntent(v,i){
  if(i.kind==='som_dealer_open')return v.scene==='market'&&i.next==='dealer_search'&&v.dealerSearch?.answer?.choice==='yes'&&
    v.dealerSearch.hash===i.hash&&sameBox(v.dealerSearch.box,i.box);
  const d=v.dealer??{};
  if(i.kind==='som_dealer_buy')return v.scene==='dealer_offers'&&i.next==='market'&&!!d.buy&&sameBox(d.buy,i.box);
  if(v.scene!=='dealer_search')return false;
  if(i.kind==='som_dealer_tab')return i.next==='dealer_search'&&!d.miningActive&&!!d.tab&&sameBox(d.tab,i.box);
  if(i.kind==='som_dealer_select')return i.next==='dealer_search'&&d.miningActive&&!d.selectedPickaxe&&!!d.pickaxe&&sameBox(d.pickaxe,i.box);
  if(i.kind==='som_dealer_search')return i.next==='dealer_offers'&&d.selectedPickaxe&&!!d.search&&sameBox(d.search,i.box);
  return false;
}
