import {invalidateMarket} from './mumu-market-state.mjs';
import {postInputDelayMs} from './mumu-timing.mjs';
import {reviewFactHash} from './mumu-evidence.mjs';
import {digest} from './adb.mjs';
const fail=code=>{throw Error(code);};
const clone=v=>structuredClone(v);
export function beginActionTransition(s,{actionId,requestDigest,frameId,targetId,target,command,percentageCommand,nextVisit,management,frame},clock){
  s.observationWait=null;
  s.scene={...s.scene,epoch:s.scene.epoch+1,transitioning:true};s.input=actionId;
  s.actions[actionId]={id:actionId,requestDigest,frameId,targetId,target:clone(target),command,percentageCommand,
    coordinateSource:{frameId:frame.id,evidenceHash:frame.evidenceHash},nextVisit:clone(nextVisit),management,status:'pending',epoch:s.scene.epoch,at:new Date(clock()).toISOString(),
    ...(s.marketView?{marketGeneration:s.marketView.generation}:{})};
  if(target.eventClose)s.actions[actionId].eventCloseSourceHash=reviewFactHash(frame.review);
  if(target.kind==='claim_mayors_cup_reward')s.actions[actionId].rewardClaimSourceProof={
    sessionId:s.session.id,bridgeHash:s.session.windowsBridgeHash,reviewHash:digest(Buffer.from(JSON.stringify(frame.review)))};
}
export function captureActionTransition(state){
  if(state.input&&state.actions[state.input]?.status==='issued')state.actions[state.input].status='captured';
}
export function verifyUnexpectedViewTransition(state,action,frameId,actualKind){
  action.status='verified';action.outcome='unexpected_view';action.resultFrameId=frameId;action.actualKind=actualKind;state.input=null;
}
export function finishActionTransition(s,actionId,error,inputAttempted,clock){
      const action=s.actions[actionId];if(!action || action.status!=='pending')fail('ACTION_NOT_PENDING');
      action.inputAttempted=inputAttempted;
      action.finishedAt=new Date(clock()).toISOString();
      if(error){action.error=String(error);
        if(inputAttempted){action.status='unknown';if(s.marketView)invalidateMarket(s,'unknown_input',{actionId});return action;}
        action.status='rejected_before_input';s.input=null;
        s.scene={...s.scene,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};s.latestCandidateFrameId=null;
        if(s.marketView)invalidateMarket(s,'rejected_before_input',{actionId});
        return action;
      }
      action.status='issued';action.issuedAt=action.finishedAt;const v=action.nextVisit;
      if(!action.lifecycle)action.resultCaptureNotBeforeAt=new Date(Date.parse(action.issuedAt)+postInputDelayMs(action)).toISOString();
      s.scene={id:v.visitId,kind:v.kind,entityId:v.entityId??null,epoch:action.epoch,required:true,roi:v.roi??null,transitioning:false,stableCount:0,lastSignature:null,keyframeId:null};
      s.latestCandidateFrameId=null;
      s.visits[v.visitId]={...clone(s.scene),startedAt:new Date(clock()).toISOString(),frameId:null,status:'awaiting_capture'};
      if(s.marketView||v.kind==='market')invalidateMarket(s,v.kind==='market'?'market_transition':'left_market',{actionId});return action;
}
export function verifyActionTransition(state,action,frame){
  action.status='verified';action.verifiedAt=frame.review.reviewedAt;action.resultFrameId=frame.id;action.resultObservedAt=frame.observedAt;state.input=null;
}
