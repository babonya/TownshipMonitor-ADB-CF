import {CurrentAllocation} from './mumu-current-allocation.mjs';
import {InventoryStore} from './mumu-inventory-store.mjs';

// Select capabilities once. Native allocation has no historical accounting API.
export function createDeliveryAllocation(source,inventoryRoot){
  if(['google_play_windows','android_adb'].includes(source.load().session.provider))return new CurrentAllocation({source});
  return inventoryRoot?new InventoryStore({source,root:inventoryRoot,clock:source.clock}):null;
}
