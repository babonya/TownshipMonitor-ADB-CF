// Order identity is the requested product multiset; owned stock is not identity.
import {digest} from './adb.mjs';
export function orderSignature(needs){
  if(!Array.isArray(needs)||!needs.length)return null;
  const totals=new Map();
  for(const need of needs){
    const required=need.required??need.quantity;
    if(typeof need.itemId!=='string'||!need.itemId||!Number.isSafeInteger(required)||required<1)return null;
    const total=(totals.get(need.itemId)??0)+required;
    if(!Number.isSafeInteger(total))return null;
    totals.set(need.itemId,total);
  }
  return digest(Buffer.from(JSON.stringify([...totals].sort(([a],[b])=>a.localeCompare(b))))).slice(0,32);
}
export function orderDisposition(needs){
  if(!Array.isArray(needs)||!needs.length)return 'hold';
  if(needs.some(n=>Number.isSafeInteger(n.required??n.quantity)&&(n.required??n.quantity)>=8))return 'delete';
  const totals=new Map();
  for(const n of needs){
    const required=n.required??n.quantity;
    if(typeof n.itemId==='string'&&Number.isSafeInteger(required))totals.set(n.itemId,(totals.get(n.itemId)??0)+required);
  }
  if([...totals.values()].some(n=>n>=8))return 'delete';
  if(needs.some(n=>!Number.isSafeInteger(n.required??n.quantity)||(n.required??n.quantity)<1))return 'hold';
  return 'deliver';
}
export function assertOrderPolicy(order,kind){
  const disposition=orderDisposition(order?.needs??order?.items);
  if(kind==='delete_helicopter'){
    if(disposition!=='delete')throw Error('ORDER_DELETE_POLICY_REQUIRED');
  }else if(['buy_market','load_train','load_airport','send_helicopter','send_train','send_airport'].includes(kind)&&disposition==='delete'){
    throw Error('ORDER_DELETE_REQUIRED');
  }
}
