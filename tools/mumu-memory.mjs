// Semantic reference memory. No returned coordinate, offer, or route grants input.
import {marketCoverage} from './mumu-survey.mjs';
import {evidenceWindow,inputEvidenceValid} from './mumu-freshness.mjs';
const facilities={open_airport:'airport',open_train:'train',open_helicopter:'helicopter',open_market:'market',open_barn:'barn'};
const visible=f=>f?.review?.reviewedBy==='GPT'&&f.review.quality?.gameVisible&&!f.review.quality.occluded;
export function navigationMemory(state,{facilityKind=null}={}){
  const actions=Object.values(state.actions).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),entries=[];
  for(const action of actions){
    const expected=facilities[action.target?.kind];if(!expected||facilityKind&&facilityKind!==expected)continue;
    const source=state.frames[action.frameId],result=state.frames[action.resultFrameId];
    if(!visible(source)||source.review.status!=='accepted')continue;
    const rejected=action.status==='rejected_before_input'&&action.error==='NAVIGATION_TARGET_CHANGED';
    if(!rejected&&(action.status!=='verified'||!visible(result)||result.review.status!=='accepted'||result.review.actualKind!==expected))continue;
    const observed=result??source,invalidated=!!state.observationInvalidation&&observed.sequence<=state.observationInvalidation.sequence;
    const route=actions.filter(a=>a.target?.kind==='town_scroll'&&a.status==='verified'&&Date.parse(a.at)<Date.parse(action.at)).slice(-3)
      .map(a=>({actionId:a.id,sourceFrameId:a.frameId,resultFrameId:a.resultFrameId}));
    entries.push({facilityKind:expected,actionId:action.id,sourceFrameId:source.id,targetId:action.targetId,
      resultFrameId:result?.id??null,actualKind:result?.review.actualKind??null,
      outcome:rejected?'unstable_target':result.review.actualKind===expected?'confirmed_facility':'wrong_scene',
      label:source.review.data?.navigation?.label??null,landmarkId:source.review.data?.navigation?.landmarkId??null,
      layoutId:source.review.data?.navigation?.layoutId??null,route,observedAt:observed.observedAt,
      status:invalidated?'needs_confirmation':'reference',coordinatesReusable:false,executionAllowed:false});
  }
  return {entries:entries.slice(-100),requiresCurrentTargetReview:true,executionAllowed:false};
}
export function marketCatalogue(state,{now=Date.now()}={}){
  const frames=Object.values(state.frames).filter(f=>visible(f)&&f.review.status==='accepted'&&f.review.actualKind==='market'&&f.review.data?.market)
    .sort((a,b)=>b.sequence-a.sequence);
  let baseline=null;
  const groups=new Set(frames.map(f=>JSON.stringify([f.review.data.market.roundId,f.review.data.market.catalogueId??null])));
  for(const key of groups){
    const [roundId,catalogueId]=JSON.parse(key),group=frames.filter(f=>f.review.data.market.roundId===roundId&&(f.review.data.market.catalogueId??null)===catalogueId)
      .sort((a,b)=>a.sequence-b.sequence);
    try{
      const coverage=marketCoverage({...state,frames:Object.fromEntries(group.map(f=>[f.id,f]))},{roundId,visitIds:[...new Set(group.map(f=>f.sceneId))]});
      const start=Math.min(...coverage.pages.map(p=>Date.parse(p.observedAt))),end=Math.max(...coverage.pages.map(p=>Date.parse(p.observedAt)));
      // A catalogue scan spanning a purchase is not a consistent snapshot.
      if(Object.values(state.actions).some(a=>a.target?.kind==='buy_market'&&
        [Date.parse(a.at),Date.parse(state.frames[a.resultFrameId]?.observedAt??'')].some(t=>t>=start&&t<=end)))continue;
      if(coverage.readComplete&&coverage.pages.every(p=>evidenceWindow(p,{now}).valid)){
        baseline={...coverage,catalogueId,lastSequence:Math.max(...group.map(f=>f.sequence))};break;
      }
    }catch{}
  }
  if(!baseline)return {status:'needs_survey',offers:[],coordinatesReusable:false,executionAllowed:false};
  const offers=structuredClone(baseline.offers),appliedActions=[];
  for(const action of Object.values(state.actions).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){
    if(action.target?.kind!=='buy_market')continue;
    const result=state.frames[action.resultFrameId],source=state.frames[action.frameId];
    if(result&&result.sequence<=baseline.lastSequence)continue;
    if(Date.parse(action.at)<Math.max(...baseline.pages.map(p=>Date.parse(p.observedAt))))continue;
    const facts=action.target.management,effect=result?.review?.data?.actionResult;
    if(action.status!=='verified'||!visible(result)||result.review.status!=='accepted'||!inputEvidenceValid(result,now,state)||
      source?.review?.data?.market?.roundId!==baseline.roundId||effect?.actionId!==action.id||effect.frameId!==result.id||effect.confirmed!==true||
      !effect.inventoryDeltas?.some(d=>d.itemId===facts.itemId&&d.after-d.before===facts.quantity))
      return {status:'needs_reconcile',roundId:baseline.roundId,offers:[],coordinatesReusable:false,executionAllowed:false};
    const index=offers.findIndex(o=>o.itemId===facts.itemId&&o.quantity===facts.quantity&&o.price===facts.price&&o.currency===facts.currency);
    if(index<0)return {status:'needs_reconcile',roundId:baseline.roundId,offers:[],coordinatesReusable:false,executionAllowed:false};
    offers.splice(index,1);appliedActions.push(action.id);
  }
  if(state.input)return {status:'hold',offers:[],coordinatesReusable:false,executionAllowed:false};
  return {status:'reference',roundId:baseline.roundId,catalogueId:baseline.catalogueId,pages:baseline.pages,
    offers:offers.map(o=>({...o,coordinateBinding:null})),appliedActions,coordinatesReusable:false,
    requiresCurrentOfferReview:true,executionAllowed:false};
}
