import {targetTransportCategory} from './mumu-transport-id.mjs';
// Native IDs use the transport category, capture sequence and target position.
// No history, deleted-ID index or additional persistent counter is required.
export function generatedActionId(state,{frameId,targetId,kind},legacy){
  if(state.session?.provider!=='google_play_windows')return legacy();
  const frame=state.frames?.[frameId],targets=frame?.review?.targets??[];
  const targetIndex=targets.findIndex(t=>t.id===targetId);
  if(!Number.isSafeInteger(frame?.sequence)||frame.sequence<0||targetIndex<0||!/^[a-z]$/.test(kind??''))
    throw Error('ACTION_ID_SOURCE_REQUIRED');
  const actions=Object.values(state.actions??{});
  // Existing retained requests keep their exact ID, including older formats.
  const previous=actions.find(a=>a.frameId===frameId&&a.targetId===targetId);
  if(previous)return previous.id;
  const category=targetTransportCategory(frame,targets[targetIndex])??'a';
  const base=category+frame.sequence.toString(36)+'-'+kind+targetIndex.toString(36);
  let id=base,collision=0;
  // Only currently retained records are checked. beginAction still binds the
  // full request digest under its state lock before any input is authorized.
  while(Object.hasOwn(state.actions??{},id))id=base+'-'+(++collision).toString(36);
  return id;
}
