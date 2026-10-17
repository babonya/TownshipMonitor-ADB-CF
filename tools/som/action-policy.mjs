// Timing floors schedule observation; they never establish action success.
const effects={
  som_dealer_open:'dealer',som_dealer_tab:'dealer',som_dealer_select:'dealer',som_dealer_search:'dealer',som_dealer_buy:'dealer',
  som_select:'navigation',som_buy:'purchase',som_scroll:'scroll',som_send:'delivery',
  som_delete:'deletion',som_open_market:'market_entry',som_open_barn:'barn',
  som_barn_tab:'barn',som_barn_inspect:'barn',som_barn_sell:'barn',
  som_close_panel:'panel_exit',som_open_helicopter:'none',som_claim:'none',som_close_popup:'none',som_minigame_keepalive:'none'
};
const floors={som_dealer_search:3000,som_select:100,som_scroll:100,som_open_market:300,som_open_helicopter:300};
export const SOM_ACTION_POLICIES=Object.freeze(Object.fromEntries(Object.entries(effects).map(([kind,effect])=>
  [kind,Object.freeze({effect,firstResultMs:floors[kind]??1000,resultTimeoutMs:15000})])));
export const somActionPolicy=kind=>SOM_ACTION_POLICIES[kind]??null;
export function somFirstResultMs(action){
  if(action.target?.kind==='som_send'&&action.inputSequence?.kind==='som_helicopter_send_skip'&&
    action.inputSequence.delayMs===100&&action.inputSequence.clickCount===2&&
    action.deviceReceipt?.completedClicks===2&&action.deviceReceipt?.plannedClicks===2)return 500;
  return somActionPolicy(action.target?.kind)?.firstResultMs??1000;
}
