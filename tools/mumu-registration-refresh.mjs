import {hasUnresolvedActions} from './mumu-input-state.mjs';
import {resetHelicopterObservationSession} from './mumu-helicopter-session.mjs';
// Refresh only disposable readers and visits. A changed profile is not input
// authority and cannot retire an action or clear a user stop.
export function refreshHelicopterRegistration(c,hash){
  const previous=c.productRegistrationHash;
  if(previous===hash)return false;
  const state=c.store.load();
  if(state.input||hasUnresolvedActions(state.actions??{}))return false;
  if(previous){
    c.workers?.matcher?.close();c.workers?.ocr?.close();c.workers=null;
    resetHelicopterObservationSession(c);c.failedProductEvidence?.clear();
    c.state.productRegistration={status:'current_screen_recheck_required',profileHash:hash};
  }
  c.productRegistrationHash=hash;
  return !!previous;
}
