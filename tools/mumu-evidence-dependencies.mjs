// Named proof references. Unknown matching strings remain conservative roots
// during migration, so adding an unlisted proof field cannot lose its evidence.
export const evidenceReferenceFields=Object.freeze({
  frames:Object.freeze(['frameId','frameIds','sourceFrameId','resultFrameId','contextFrameId','referenceFrameId','originalFrameId',
    'latestFrameId','latestCandidateFrameId','keyframeId','firstFrameId','heldFrameId','contentsFrameId','resourceFrameId','reviewFrameId',
    'helicopterExhaustedFrameId','helicopterMapFrameId','orderFrameIds','clearedOrderFrameIds','obsoleteOrderFrameIds','remainingOrderFrameIds']),
  actions:Object.freeze(['actionId','actionIds','inputId','waitingActionId','pendingActionId','predecessorActionId','rejectedActionId',
    'navigationActionId','openActionId','dismissActionId','supersededOpenActionId','verifiesActionId','settledActionIds','unresolvedActionIds',
    'airportActionId','trainActionId','trainRewardActionId','helicopterActionId','marketActionId','cupActionId']),
  visits:Object.freeze(['visitId','visitIds','sceneId','nextVisitId','sourceVisitId','resultVisitId']),
  either:Object.freeze(['id','input'])
});

export function evidenceDependencyGraph(frames,actions,visits={}){
  const frameFields=new Set(evidenceReferenceFields.frames),actionFields=new Set(evidenceReferenceFields.actions),visitFields=new Set(evidenceReferenceFields.visits),either=new Set(evidenceReferenceFields.either);
  const cache=new WeakMap(),unmapped=new Set();
  const references=value=>{
    if(value&&typeof value==='object'&&cache.has(value))return cache.get(value);
    const result={frames:new Set(),actions:new Set(),visits:new Set()},seen=new Set();
    const walk=(item,key=null,path=[])=>{
      if(typeof item==='string'){
        for(const [kind,records,fields]of [['frames',frames,frameFields],['actions',actions,actionFields],['visits',visits,visitFields]])if(records[item]){
          result[kind].add(item);
          if(key!==null&&!either.has(key)&&!fields.has(key))unmapped.add(path.join('.'));
        }
      }else if(item&&typeof item==='object'&&!seen.has(item)){
        seen.add(item);
        for(const [name,child]of Object.entries(item))walk(child,Array.isArray(item)?key:name,[...path,name]);
      }
    };
    walk(value);
    if(value&&typeof value==='object')cache.set(value,result);
    return result;
  };
  return {
    include(value,keepFrames,keepActions,keepVisits=new Set()){
      const pending=[value];
      while(pending.length){
        const direct=references(pending.pop());
        for(const [kind,records,kept]of [['frames',frames,keepFrames],['actions',actions,keepActions],['visits',visits,keepVisits]])for(const id of direct[kind])
          if(!kept.has(id)){kept.add(id);pending.push(records[id]);}
      }
    },
    diagnostics:()=>({unmappedReferenceFields:[...unmapped].sort(),unknownReferencesPreserved:true})
  };
}
