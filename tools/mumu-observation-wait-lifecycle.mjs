// A wait is disposable scheduling state. Invalidation retains the original
// record for cooldown continuity; clearing explicitly ends that continuity.
export function installObservationWait(owner,wait,binding){
  owner.wait=wait;owner.invalidatedWait=null;
  Object.assign(wait,{inventoryStamp:binding.inventoryStamp,sourceFingerprint:binding.sourceFingerprint,policyHash:binding.policyHash});
  owner.waitRevision=binding.revision;
  return wait;
}
export function invalidateObservationWait(owner){
  owner.invalidatedWait=owner.wait;owner.wait=null;owner.waitRevision=null;
  owner.state.observationSchedule=null;
}
export function clearObservationWait(owner){
  owner.wait=null;owner.invalidatedWait=null;owner.waitRevision=null;
  owner.state.observationSchedule=null;
}
