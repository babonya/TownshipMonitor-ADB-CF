// Pure deletion effect proof, shared by legacy projection and accounting.
import {acceptedFacts} from './mumu-evidence.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
const id=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(s)&&!['constructor','prototype','__proto__'].includes(s);
export function inventoryUnchangedDeletion(state,action,effect){
  const frame=state.frames?.[action?.frameId],sourceOrder=frame?.review?.data?.order;
  return action?.target?.kind==='delete_helicopter'&&acceptedFacts(frame)&&frame.review.actualKind==='helicopter'&&
    orderDisposition(sourceOrder?.needs)==='delete'&&effect?.inventoryUnchanged===true&&
    id(effect.deletedOrderId)&&effect.deletedOrderId===sourceOrder?.orderId&&
    Array.isArray(effect.inventoryDeltas)&&effect.inventoryDeltas.length===0&&
    (effect.inventoryInvalidated===undefined||Array.isArray(effect.inventoryInvalidated)&&effect.inventoryInvalidated.length===0)&&
    effect.capacityDelta===undefined&&effect.coinDelta===undefined;
}

