import {migrateDevice} from './device-migration.mjs';
import {navigateReviewed} from './mumu-store.mjs';
import {authorizeManagement} from './mumu-management.mjs';

async function legacyInventory(store,args){
  const {InventoryStore}=await import('./mumu-inventory-store.mjs');
  return new InventoryStore({source:store,root:args.inventoryRoot,clock:store.clock});
}
async function observeMarket(store,args){
  const {PerceptionWorker,RapidOcrWorker,DEFAULT_MARKET_PROFILE}=await import('./mumu-perception-bridge.mjs');
  const workers={matcher:new PerceptionWorker({marketProfile:DEFAULT_MARKET_PROFILE}),ocr:new RapidOcrWorker()};
  try{return await(await import('./mumu-market.mjs')).observeMarket(store,args,workers);}
  finally{workers.matcher.close();workers.ocr.close();}
}
// Retry applies only to the explicitly listed state transactions. Input paths
// keep their own admission and uncertain-result handling and are never replayed.
export function requestHandlers(store){
  const retry=fn=>args=>store.retry(()=>fn(args));
  return {
    migrate_device:retry(args=>migrateDevice(store,args)),
    visit:retry(args=>store.beginVisit(args)),
    pin:retry(args=>store.pinFrame(args?.frameId??'latest',args)),
    review:retry(args=>store.review(args)),
    navigate:args=>navigateReviewed(store,args),
    authorize_management:retry(args=>authorizeManagement(store,args)),
    readiness:async args=>(await import('./mumu-readiness.mjs')).readiness(store,args),
    prepare_review:async args=>(await import('./mumu-operator.mjs')).prepareReview(store,args),
    prepare_contents:async args=>(await import('./mumu-operator.mjs')).prepareContents(store,args),
    review_program_exact:retry(args=>store.reviewExactFrame(args)),
    observe_helicopter:async args=>(await import('./mumu-helicopter.mjs')).observeHelicopter(store,args),
    current_needs:async ()=>(await import('./mumu-current-needs.mjs')).currentScreenNeeds(store.load(),{now:store.clock()}),
    observe_market:args=>observeMarket(store,args),
    observe_train_rewards:async args=>(await import('./mumu-train-rewards.mjs')).observeTrainRewards(store,args),
    observe_airport_loading:async args=>(await import('./mumu-airport-loading.mjs')).observeAirportLoading(store,args),
    observe_train_loading:async args=>(await import('./mumu-train-loading.mjs')).observeTrainLoading(store,args),
    learn_helicopter_item:async args=>(await import('./mumu-helicopter.mjs')).learnHelicopterItem(store,args),
    transport_automatic:async args=>{
      const {runTransportMission}=await import('./mumu-automatic.mjs'),inventory=await legacyInventory(store,args);
      const verifyResult=args.programHelicopter?async()=>(await import('./mumu-helicopter-loop.mjs')).captureHelicopterObservation(store):null;
      return runTransportMission(store,inventory,args.plan,{verifyResult});
    },
    reconcile_transport_rejection:async args=>{
      const {reconcileRejectedMission}=await import('./mumu-automatic.mjs'),inventory=await legacyInventory(store,args);
      return store.retry(()=>reconcileRejectedMission(store,inventory,{source:args.source,plan:args.plan}));
    },
    helicopter_round:async args=>(await import('./mumu-helicopter-loop.mjs')).runHelicopterRound(store,await legacyInventory(store,args),args),
    review_and_act:async args=>(await import('./mumu-operator.mjs')).reviewAndAct(store,args),
    configure_pipeline:retry(args=>store.configurePipeline(args)),
    invalidate_observations:retry(args=>store.invalidateObservations(args)),
    reconcile_external_train:async args=>{
      const {reconcileExternalTrain}=await import('./mumu-external-train.mjs'),inventory=await legacyInventory(store,args);
      const {inventoryRoot,...request}=args;return store.retry(()=>reconcileExternalTrain(store,inventory,request));
    },
    set_observation_wait:retry(args=>store.setObservationWait(args)),
    navigation_memory:async args=>(await import('./mumu-memory.mjs')).navigationMemory(store.load(),args),
    prepare_town_navigation:async args=>(await import('./mumu-town-navigation.mjs')).prepareTownNavigation(store,args),
    town_navigation:async args=>(await import('./mumu-town-navigation.mjs')).navigateTown(store,args),
    market_catalogue:async ()=>(await import('./mumu-memory.mjs')).marketCatalogue(store.load(),{now:store.clock()}),
    performance:async ()=>(await import('./mumu-performance.mjs')).performanceReport(store),
    item_reference:async args=>(await import('./mumu-reference.mjs')).itemReference(args),
    manage:args=>navigateReviewed(store,args,{management:true}),
    resolve_observed:retry(args=>store.resolveObserved(args)),
    launch_township:async args=>(await import('./mumu-lifecycle.mjs')).launchTownship(store,args),
    confirm_launch:async args=>{const lifecycle=await import('./mumu-lifecycle.mjs');return store.retry(()=>lifecycle.confirmTownshipLaunch(store,args));},
    prepare_launch_result:async args=>(await import('./mumu-lifecycle.mjs')).prepareTownshipLaunchResult(store,args),
    reconcile_launch_observed:async args=>(await import('./mumu-lifecycle.mjs')).reconcileTownshipLaunch(store,args),
    retry_job:retry(args=>store.retryJob(args.frameId)),
    recover_readers:retry(()=>store.recoverReaders()),
    stop:retry(()=>store.transact(s=>{s.stopCapture=true;s.stopReader=true;return {stopRequested:true};})),
    resume:retry(()=>store.transact(s=>{s.stopCapture=false;s.stopReader=false;return {resumeRequested:true};})),
    survey:async args=>(await import('./mumu-survey.mjs')).surveyReport(store.load(),args),
    barn:async args=>(await import('./mumu-barn.mjs')).barnCoverage(store.load(),args)
  };
}
export function dispatchRequest(store,request){
  const handlers=requestHandlers(store);
  if(!Object.hasOwn(handlers,request.op))throw Error('MUMU_OPERATION_UNSUPPORTED');
  return handlers[request.op](request.args);
}
