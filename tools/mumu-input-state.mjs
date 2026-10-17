// Pure lifecycle predicates. Ownership and settlement authority remain caller-specific.
const UNRESOLVED_STATUSES=Object.freeze(['pending','issued','captured','unknown']);
export const isUnresolvedAction=action=>UNRESOLVED_STATUSES.includes(action.status);
export const hasUnresolvedActions=actions=>Object.values(actions).some(isUnresolvedAction);

// The pointer is only an index. Every unsettled journal entry blocks new input.
// Only the exact pending action owned by the final preflight may be excluded.
export function assertInputSettled(state,{pendingActionId=null}={}){
  const actions=state.actions??{};
  if(pendingActionId!==null&&(state.input!==pendingActionId||actions[pendingActionId]?.status!=='pending'))throw Error('INPUT_UNRESOLVED');
  if(state.input&&state.input!==pendingActionId)throw Error('INPUT_UNRESOLVED');
  if(Object.entries(actions).some(([id,action])=>isUnresolvedAction(action)&&id!==pendingActionId))throw Error('INPUT_UNRESOLVED');
}

export const terminalTransportMission=mission=>['complete','rejected','externally_superseded'].includes(mission?.status);

// Result registration is a prerequisite for ordinary input, even when stock
// allocation is feasible. Keep historical target proofs readable.
export function assertResultSupported(target){
  if(target?.management?.resultRegistrationRequired===true)throw Error('TRAIN_LOAD_RESULT_EVIDENCE_REQUIRED');
}
