import {nextNavigationTarget} from './mumu-helicopter-loop.mjs';

// Disposable, per-coordinator pass state. Map changes/restarts retire it.
// Stored pin IDs are exclusions only; every input target comes from this review.
export function surveyStep(pass,review){
  if(pass.phase==='survey'){
    const target=nextNavigationTarget(review,pass.visited);
    if(target)return {phase:'survey',target};
    pass.phase='collect';
    // The last inspected order is already open. Do not select it again.
    if(pass.selectedMapId)pass.collectVisited.push(pass.selectedMapId);
  }
  return {phase:'collect',target:null};
}
export function newHelicopterSurvey(visited=[],selectedMapId=null){
  return {phase:'survey',visited:[...new Set([...visited,...(selectedMapId?[selectedMapId]:[])])],collectVisited:[],selectedMapId};
}
export function noteSurveySelection(pass,target){
  (pass.phase==='survey'?pass.visited:pass.collectVisited).push(target.mapId);
  pass.selectedMapId=target.mapId;
}
