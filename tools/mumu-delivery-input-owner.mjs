// Pure classification only; canonical guards still decide input admission.
import {isUnresolvedAction} from './mumu-input-state.mjs';
import {MAYORS_CUP_READER} from './mumu-mayors-cup-proof.mjs';
import {readTransportState} from './mumu-transport-state.mjs';

function ownershipFacts(state){
  const inputId=state.input,action=state.actions[inputId],target=action?.target;
  const active=['pending','issued','captured'].includes(action?.status);
  const unresolvedIds=new Set(Object.values(state.actions).filter(isUnresolvedAction).map(action=>action.id));
  return Object.freeze({inputId,action,target,reader:state.frames?.[action?.frameId]?.review?.reviewedBy,
    ownedBy:owner=>inputId===owner&&active&&(unresolvedIds.size===0||unresolvedIds.size===1&&unresolvedIds.has(owner))});
}
function navigationFamily(coordinator,facts,context){
  const target=facts.target;if(!target)return false;
  const productInfo=context==='helicopter'&&coordinator.currentMode&&target.helicopterProductInfo;
  const closeOrTransit=target.eventClose||target.transportNavigation||target.kind==='close_panel'&&target.marketTownNavigation?.role==='transport_exit';
  const helicopterEntry=target.kind==='open_helicopter';
  const orderSelection=target.kind==='select_customer'&&(target.helicopterSelection||coordinator.currentMode&&facts.reader==='program-helicopter');
  return !!(productInfo||closeOrTransit||helicopterEntry||orderSelection);
}
export function ownsNavigationInput(coordinator,state,{context,phase},facts=ownershipFacts(state)){
  return phase==='owned-input'&&['event','navigation','town','helicopter'].includes(context)&&facts.ownedBy(coordinator.navigationActionId)&&navigationFamily(coordinator,facts,context);
}
export function ownsTrainInput(coordinator,state,{context,phase},facts=ownershipFacts(state)){
  const transport=readTransportState(coordinator,'train'),target=facts.target,kind=target?.kind;
  const ownDetail=kind==='inspect_item'&&transport.navigationId===facts.inputId&&target.trainDetail;
  return phase==='owned-input'&&context==='train'&&facts.ownedBy(transport.actionId)&&
    !!(ownDetail||(kind==='collect_train'||kind==='load_train'&&transport.plan?.steps[0].actionId===facts.inputId)&&target.management?.programVerified===true);
}
export function ownsAirportInput(coordinator,state,{context,phase},facts=ownershipFacts(state)){
  const transport=readTransportState(coordinator,'airport'),target=facts.target;
  return phase==='owned-input'&&context==='airport'&&facts.ownedBy(transport.actionId)&&
    !!(target?.kind==='inspect_item'&&transport.navigationId===facts.inputId&&target.airportDetail||
     target?.kind==='load_airport'&&transport.plan?.steps[0].actionId===facts.inputId&&target.management?.programVerified===true);
}
export function ownsCupInput(coordinator,state,{context,phase},facts=ownershipFacts(state)){
  return phase==='owned-input'&&context==='cup'&&facts.ownedBy(coordinator.cupActionId)&&
    facts.target?.kind==='claim_mayors_cup_reward'&&facts.reader===MAYORS_CUP_READER;
}
export function ownsMarketInput(coordinator,state,{context,phase},facts=ownershipFacts(state)){
  return phase==='owned-input'&&context==='market'&&facts.ownedBy(facts.inputId)&&
    !!(facts.inputId===coordinator.marketActionId&&(facts.target?.marketNative||facts.target?.barnNative)||
     facts.inputId===coordinator.marketEntryId&&facts.target?.kind==='open_market');
}
export function ownsHelicopterInput(coordinator,state,{context,phase},facts=ownershipFacts(state)){
  const transport=readTransportState(coordinator,'helicopter');
  return coordinator.currentMode&&phase==='owned-input'&&context==='helicopter'&&facts.ownedBy(transport.actionId)&&
    transport.plan?.steps[0]?.actionId===facts.inputId&&['send_helicopter','delete_helicopter'].includes(facts.target?.kind);
}
export function ownsDeliveryInput(coordinator,state,options){
  const facts=ownershipFacts(state);
  // Evaluate every predicate, as the original guard did, before combining them.
  const owned=[ownsNavigationInput,ownsTrainInput,ownsAirportInput,ownsCupInput,ownsMarketInput,ownsHelicopterInput]
    .map(check=>check(coordinator,state,options,facts));
  return owned.some(Boolean);
}
