// The composition boundary selects implementations; it grants no input authority.
import {somRequiredGoods} from './som/required-goods.mjs';
import {requiredGoodsView} from './mumu-required-goods.mjs';

export const WORKFLOW_MODES=Object.freeze({
  som:Object.freeze({
    id:'som',imageNeeds:true,backgroundOcr:false,
    worker:session=>({module:'./som/worker.mjs',name:'SomWorker',options:{viewport:session.windowsViewport,ensureServer:true}}),
    delivery:{module:'./som/delivery.mjs',name:'SomDelivery'},
    requiredGoods:(store,state)=>somRequiredGoods(store,state),
    bindPending:(worker,state)=>worker.setPendingAction?.(state.actions[state.input])
  }),
  legacy:Object.freeze({
    id:'legacy',imageNeeds:false,backgroundOcr:true,
    worker:session=>session?.provider==='google_play_windows'?
      {module:'./windows-observation.mjs',name:'WindowsObservationWorker',options:{}}:
      {module:'./mumu-perception-bridge.mjs',name:'PerceptionWorker',options:{}},
    delivery:{module:'./mumu-monitor-delivery.mjs',name:'MonitorDelivery'},
    requiredGoods:(store,state,{inventory,now})=>requiredGoodsView(state,inventory,{now}),
    bindPending:null
  })
});
export const workflowMode=state=>WORKFLOW_MODES[state?.settings?.workflowMode==='som'?'som':'legacy'];
// Literal lazy imports also keep every mode in the execution release graph.
const loaders={
  './som/worker.mjs':()=>import('./som/worker.mjs'),
  './som/delivery.mjs':()=>import('./som/delivery.mjs'),
  './windows-observation.mjs':()=>import('./windows-observation.mjs'),
  './mumu-perception-bridge.mjs':()=>import('./mumu-perception-bridge.mjs'),
  './mumu-monitor-delivery.mjs':()=>import('./mumu-monitor-delivery.mjs')
};
const loadModule=specifier=>loaders[specifier]();
export async function createWorkflowWorker(session,state,{load=loadModule,workerOptions={}}={}){
  if(session?.provider==='android_adb'){
    const {AndroidObservationWorker,AndroidSomWorker,registeredAndroidGeometry}=await import('./android-adb-observation.mjs');
    return workflowMode(state).id==='som'&&registeredAndroidGeometry(session)?new AndroidSomWorker(session,{ensureServer:true,...workerOptions}):new AndroidObservationWorker();
  }
  const spec=workflowMode(state).worker(session),module=await load(spec.module);
  return new module[spec.name]({...spec.options,...workerOptions});
}
export async function createWorkflowDelivery(store,options,{load=loadModule}={}){
  const spec=workflowMode(store.load()).delivery,module=await load(spec.module);
  return new module[spec.name](store,options);
}
