// Explicit numeric effects only. Request quantities are never accounting proof.
import {evidenceWindow} from './mumu-freshness.mjs';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {inventoryUnchangedDeletion} from './mumu-inventory-effect.mjs';
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function validateNumericMetadata(effect){
  if(effect.capacityDelta!==undefined){
    const d=effect.capacityDelta;
    if(!d||!['beforeUsed','afterUsed','beforeTotal','afterTotal'].every(k=>integer(d[k])))throw Error('CAPACITY_EFFECT_INVALID');
  }
  if(effect.coinDelta!==undefined){
    if(!effect.coinDelta||!integer(effect.coinDelta.before)||!integer(effect.coinDelta.after))throw Error('COIN_EFFECT_INVALID');
  }
}
export function demandAffected(state,effect,order,items){
  const action=state.actions[effect.actionId],kind=action?.target?.kind??action?.kind;
  if(['buy_market','barn_sell','collect_product'].includes(kind))return false;
  if(['load_train','load_airport','send_helicopter'].includes(kind)){
    const sourceOrder=state.frames[action.frameId]?.review?.data?.order?.orderId;
    const orderId=sourceOrder??effect.orderId;
    if(orderId)return orderId===order.orderId;
  }
  // Older or unclassified effects have no reliable demand-change scope.
  return effect.orderId===order.orderId||effect.deltas.some(d=>items.some(i=>i.itemId===d.itemId));
}
export function advanceCapacity(capacity,effect,{now,maxAgeMs=300000,eventTracked=false}={}){
  const delta=effect.capacityDelta;
  if(!delta||!capacity.fresh)return {...capacity,fresh:false};
  validateNumericMetadata(effect);
  if(capacity.usedCapacity!==delta.beforeUsed||capacity.totalCapacity!==delta.beforeTotal)throw Error('CAPACITY_EFFECT_CONFLICT');
  return {...capacity,usedCapacity:delta.afterUsed,totalCapacity:delta.afterTotal,
    freeCapacity:Math.max(0,delta.afterTotal-delta.afterUsed),overCapacity:Math.max(0,delta.afterUsed-delta.afterTotal),
    observedAt:effect.observedAt,source:'confirmed_capacity_effect',actionId:effect.actionId,frameIds:[effect.frameId],
    fresh:evidenceWindow({observedAt:effect.observedAt},{now,maxAgeMs:eventTracked?null:maxAgeMs}).valid};
}
export function deriveCoins(state,now=Date.now()){
  const frames=Object.values(state.frames).filter(f=>acceptedFacts(f)&&integer(f.review.data?.resources?.coinBalance)&&
    evidenceWindow({observedAt:f.observedAt,invalidated:!!state.observationInvalidation&&f.sequence<=state.observationInvalidation.sequence},
      {now,maxAgeMs:null}).valid).sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||b.sequence-a.sequence);
  const frame=frames[0];if(!frame)return {coinBalance:null,fresh:false,reason:'CURRENT_COINS_REQUIRED'};
  let result={coinBalance:frame.review.data.resources.coinBalance,fresh:true,observedAt:frame.observedAt,frameId:frame.id,
    evidenceHash:frame.evidenceHash,appliedActions:[]};
  const actions=Object.values(state.actions).filter(a=>a.management&&a.status==='verified').sort((a,b)=>
    Date.parse(state.frames[a.resultFrameId]?.observedAt??'')-Date.parse(state.frames[b.resultFrameId]?.observedAt??''));
  for(const action of actions){
    const f=state.frames[action.resultFrameId],time=Date.parse(f?.observedAt??'');
    if(f?.id===frame.id||time<Date.parse(frame.observedAt))continue;
    const effect=actionEffect(state,action);
    if(inventoryUnchangedDeletion(state,action,effect))continue;
    if(!Number.isFinite(time)||time>now||!effect){result.fresh=false;result.reason='COINS_EFFECT_REVIEW_REQUIRED';break;}
    if(effect?.actionId!==action.id||effect.frameId!==f.id||effect.confirmed!==true||!effect.coinDelta){result.fresh=false;result.reason='COINS_EFFECT_REVIEW_REQUIRED';break;}
    validateNumericMetadata(effect);
    if(effect.coinDelta.before!==result.coinBalance)throw Error('COIN_EFFECT_CONFLICT');
    result={...result,coinBalance:effect.coinDelta.after,observedAt:f.observedAt,frameId:f.id,evidenceHash:f.evidenceHash,
      appliedActions:[...result.appliedActions,action.id]};
  }
  if(state.input){result.fresh=false;result.reason='INPUT_UNRESOLVED';}
  return result;
}
