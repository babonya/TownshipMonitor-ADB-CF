import {generatedActionId} from './mumu-action-id.mjs';
// events processing uses the coordinator's state and its one input owner.
import {observeEventClose} from './mumu-event-close.mjs';
import {digest} from './adb.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {observeMayorsCup} from './mumu-mayors-cup.mjs';
import './mumu-mayors-cup-audit.mjs';
const sha=value=>digest(Buffer.from(JSON.stringify(value)));

export async function onEventCloseFrame(coordinator,frame){

    try{
      const {state}=coordinator.guard({context:'event',phase:'owned-input'});coordinator.busy=true;
      if(state.input){const observed=await observeEventClose(coordinator.store,{frameId:frame.id,actionId:state.input});if(observed.stored)coordinator.navigationActionId=null;return coordinator.update(observed.stored?'waiting':'hold',observed.stored?'POPUP_NEXT_REGISTERED':observed.reason);}
      const observed=await observeEventClose(coordinator.store,{frameId:frame.id});
      if(!observed.stored)return coordinator.update('hold',observed.reason);
      const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:observed.targets[0].id,kind:'e'},()=> 'event-close:'+sha({session:state.session.id,frame:frame.id}).slice(0,32));
      coordinator.navigationActionId=actionId;
      const policyHash=sha(state.session.management),stamp=coordinator.inventoryStamp();
      const guard=settlingNavigation=>{const current=coordinator.guard({context:'event',phase:settlingNavigation?'owned-input':'observe'});
        if(current.state.latestFrameId!==frame.id||coordinator.inventoryStamp()!==stamp||sha(current.state.session.management)!==policyHash)throw Error('EVENT_CLOSE_CONTEXT_CHANGED');};
      const result=await navigateReviewed(coordinator.store,{actionId,frameId:frame.id,targetId:observed.targets[0].id,
        nextVisit:{visitId:actionId+'-result',kind:'unknown',required:true}},
        {management:observed.targets[0].kind==='claim_popup_reward',device:coordinator.device,beforeBegin:()=>guard(false),beforeInputGuard:()=>guard(true)});
      return coordinator.update('waiting',result.status==='issued'?'EVENT_CLOSE_RESULT_REVIEW_REQUIRED':result.error);
    }catch(error){return coordinator.update('hold',error.message);}
    finally{coordinator.busy=false;coordinator.update(coordinator.state.phase,coordinator.state.reason);}
}

export async function onMayorsCupFrame(coordinator,frame){

    try{
      const {state,continuity}=coordinator.guard({context:'cup',phase:'owned-input',allowReconciliation:true});
      if(state.latestFrameId!==frame.id||frame.epoch!==state.scene.epoch||!inputEvidenceValid(frame,coordinator.store.clock(),state))throw Error('CURRENT_FRAME_REQUIRED');
      coordinator.busy=true;
      if(state.input){
        const observed=await observeMayorsCup(coordinator.store,{frameId:frame.id,actionId:state.input});
        return coordinator.update(observed.stored?'waiting':'hold',observed.stored?'MAYORS_CUP_NEXT_TEXT_REQUIRED':observed.reason,{cupActionId:coordinator.cupActionId});
      }
      coordinator.reconcileHistory(state,continuity);coordinator.guard({context:'cup'});
      if(!['unknown','mayors_cup_result'].includes(state.scene.kind)){
        coordinator.store.beginVisit({visitId:'cup-visit:'+sha({session:state.session.id,frame:frame.id}).slice(0,24),kind:'mayors_cup_result',required:true});
        return coordinator.update('waiting','MAYORS_CUP_CURRENT_VISIT_REQUIRED');
      }
      const observed=await observeMayorsCup(coordinator.store,{frameId:frame.id});
      if(!observed.stored)return coordinator.update('hold',observed.reason);
      const actionId=generatedActionId(coordinator.store.load(),{frameId:frame.id,targetId:observed.targets[0].id,kind:'c'},()=> 'cup-claim:'+sha({session:state.session.id,frame:frame.id}).slice(0,32));
      coordinator.cupActionId=actionId;
      const policyHash=sha(state.session.management),inventoryStamp=coordinator.inventoryStamp();
      const currentGuard=settlingMayorsCup=>{
        const checked=coordinator.guard({context:'cup',phase:settlingMayorsCup?'owned-input':'observe'});
        if(checked.state.latestFrameId!==frame.id||coordinator.inventoryStamp()!==inventoryStamp||sha(checked.state.session.management)!==policyHash)
          throw Error('MAYORS_CUP_CONTEXT_CHANGED');
      };
      const result=await navigateReviewed(coordinator.store,{actionId,frameId:frame.id,targetId:observed.targets[0].id,
        nextVisit:{visitId:actionId+'-result',kind:'unknown',required:true}},
        {management:true,device:coordinator.device,beforeBegin:()=>currentGuard(false),beforeInputGuard:()=>currentGuard(true)});
      return coordinator.update(result.status==='issued'?'waiting':'hold',result.status==='issued'?'MAYORS_CUP_RESULT_CAPTURE_REQUIRED':result.error??'MAYORS_CUP_CLAIM_HELD',
        {cupActionId:actionId});
    }catch(error){return coordinator.update('hold',error.message,{cupActionId:coordinator.cupActionId??null});}
    finally{coordinator.busy=false;coordinator.update(coordinator.state.phase,coordinator.state.reason);}
}
