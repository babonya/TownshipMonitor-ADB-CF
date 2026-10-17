import { validateBox,regionDigest } from './adb.mjs';
import {prepareOccurrenceComparison} from './mumu-region-match.mjs';
const fail=code=>{throw Error(code);};
const inside=(a,b)=>a.x>=b.x && a.y>=b.y && a.x+a.width<=b.x+b.width && a.y+a.height<=b.y+b.height;
const overlap=(a,b)=>a.x<b.x+b.width && b.x<a.x+a.width && a.y<b.y+b.height && b.y<a.y+a.height;
const overlappingIcons=(icons,b)=>icons.filter(s=>overlap(s.box,b));
export function validateVerification(target,width,height,{management=false}={}) {
  const v=target.verification;if(!v)return;
  const sweep=target.kind==='collect_train'&&target.type==='swipe'&&target.management?.programVerified===true&&Array.isArray(target.management.rewards);
  const marketSwipe=target.kind==='market_scroll'&&target.type==='swipe'&&target.marketNative?.schema===1;
  if(sweep&&(v.motion!==undefined||target.management.rewards.length!==v.targetRegions?.length))fail('VERIFICATION_INVALID');
  if(v.version!==1 || (target.type!=='tap'&&!sweep&&!marketSwipe) || !Array.isArray(v.anchorBoxes) || v.anchorBoxes.length<1 || v.anchorBoxes.length>3 || !Array.isArray(v.targetRegions) || v.targetRegions.length<1 || v.targetRegions.length>(sweep?5:4) || !Array.isArray(v.criticalRegions??[]) || (v.criticalRegions??[]).length>6)fail('VERIFICATION_INVALID');
  if(marketSwipe&&(v.motion!==undefined||v.maxChangedRatio!==0||v.channelTolerance!==0||!v.criticalRegions?.some(c=>c.field==='market_viewport')))fail('VERIFICATION_INVALID');
  const ratio=v.maxChangedRatio??0.03,tolerance=v.channelTolerance??12;
  if(!Number.isFinite(ratio) || ratio<0 || ratio>0.03 || !Number.isSafeInteger(tolerance) || tolerance<0 || tolerance>12)fail('VERIFICATION_TOO_PERMISSIVE');
  for(const box of v.anchorBoxes)validateBox(box,width,height);
  let area=0;const center={x:Math.floor(target.box.x+target.box.width/2),y:Math.floor(target.box.y+target.box.height/2),width:1,height:1};
  for(let i=0;i<v.targetRegions.length;i++){
    const box=v.targetRegions[i];validateBox(box,width,height);
    if(!inside(box,target.box) || v.targetRegions.slice(0,i).some(other=>overlap(box,other)))fail('VERIFICATION_TARGET_REGION_INVALID');
    area+=box.width*box.height;
  }
  if(area<Math.ceil(target.box.width*target.box.height*0.15) || (!sweep&&!marketSwipe&&!v.targetRegions.some(box=>inside(center,box))))fail('VERIFICATION_TARGET_COVERAGE_REQUIRED');
  if(sweep||marketSwipe)for(const [x,y] of [[target.swipe?.x1,target.swipe?.y1],[target.swipe?.x2,target.swipe?.y2]])if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||!v.targetRegions.some(box=>inside({x,y,width:1,height:1},box)))fail('VERIFICATION_TARGET_COVERAGE_REQUIRED');
  if(v.motion!==undefined){
    const m=v.motion;
    if(!m || !Number.isSafeInteger(m.maxOffsetPx) || m.maxOffsetPx<1 || m.maxOffsetPx>10 || !Number.isFinite(m.minCorrelation??0.97) || (m.minCorrelation??0.97)<0.97 || (m.minCorrelation??0.97)>1 || !Number.isFinite(m.maxMeanDelta??12) || (m.maxMeanDelta??12)<0 || (m.maxMeanDelta??12)>12 || area>16384)fail('VERIFICATION_MOTION_INVALID');
  }
  for(const c of v.criticalRegions??[]){if(typeof c.field!=='string' || !c.field)fail('VERIFICATION_INVALID');validateBox(c.box,width,height);}
  if(management){
    const needed=['buy_market','buy_dealer'].includes(target.kind)?(target.marketNative?.schema===1?['item','quantity','currency']:['price','quantity','currency']):['load_airport','load_train'].includes(target.kind)?[target.management?.resource==='load_coupon'?'coupon_cost':'stock']:target.kind==='barn_sell'?['quantity']:
      ['send_helicopter','delete_helicopter'].includes(target.kind)&&target.management?.programVerified?['order_grid']:[];
    if(needed.some(field=>!(v.criticalRegions??[]).some(c=>c.field===field)))fail('VERIFICATION_CRITICAL_FACTS_REQUIRED');
  }
}
// One translation applies to every core. Exact anchors and critical facts never move.
function motionMatch(old,fresh,target,v){
  const m=v.motion,center={x:Math.floor(target.box.x+target.box.width/2),y:Math.floor(target.box.y+target.box.height/2),width:1,height:1};
  let best=null;
  for(let dy=-m.maxOffsetPx;dy<=m.maxOffsetPx;dy++)for(let dx=-m.maxOffsetPx;dx<=m.maxOffsetPx;dx++){
    const shifted=v.targetRegions.map(b=>({...b,x:b.x+dx,y:b.y+dy}));
    if(shifted.some(b=>!inside(b,target.box)) || !shifted.some(b=>inside(center,b)))continue;
    let correlation=1,meanDelta=0,valid=true;
    for(const box of v.targetRegions){
      const n=box.width*box.height,channels=Math.min(3,old.channels),sa=Array(channels).fill(0),sb=Array(channels).fill(0),aa=Array(channels).fill(0),bb=Array(channels).fill(0),ab=Array(channels).fill(0);
      for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
        const p=(y*old.width+x)*old.channels,q=((y+dy)*fresh.width+x+dx)*fresh.channels;
        for(let c=0;c<channels;c++){const a=old.pixels[p+c],b=fresh.pixels[q+c];sa[c]+=a;sb[c]+=b;aa[c]+=a*a;bb[c]+=b*b;ab[c]+=a*b;}
      }
      let va=0,vb=0,cov=0,delta=0;
      for(let c=0;c<channels;c++){va+=aa[c]-sa[c]*sa[c]/n;vb+=bb[c]-sb[c]*sb[c]/n;cov+=ab[c]-sa[c]*sb[c]/n;delta=Math.max(delta,Math.abs(sa[c]-sb[c])/n);}
      const stdA=Math.sqrt(Math.max(0,va)/(n*channels)),stdB=Math.sqrt(Math.max(0,vb)/(n*channels)),ratio=stdB/stdA,corr=cov/Math.sqrt(va*vb);
      if(stdA<10 || stdB<10 || ratio<0.85 || ratio>1.15 || !Number.isFinite(corr) || corr<(m.minCorrelation??0.97) || delta>(m.maxMeanDelta??12)){valid=false;break;}
      correlation=Math.min(correlation,corr);meanDelta=Math.max(meanDelta,delta);
    }
    if(valid && (!best || correlation>best.correlation))best={offset:{x:dx,y:dy},correlation,meanDelta};
  }
  return best;
}
export function compareReviewedTarget(old,fresh,target,{management=false,itemRegions=[]}={}) {
  if(old.width!==fresh.width || old.height!==fresh.height || old.channels!==fresh.channels)fail('NAVIGATION_TARGET_CHANGED');
  validateBox(target.box,old.width,old.height);validateVerification(target,old.width,old.height,{management});
  const v=target.verification;
  if(!v){
    const box=target.verificationBox??target.box;
    if(regionDigest(old,box)!==regionDigest(fresh,box) || (management && target.verificationBox && regionDigest(old,target.box)!==regionDigest(fresh,target.box)))fail('NAVIGATION_TARGET_CHANGED');
    return {method:target.verificationBox?'legacy_anchor':'exact',changedRatio:0};
  }
  for(const box of v.anchorBoxes)if(regionDigest(old,box)!==regionDigest(fresh,box))fail('NAVIGATION_TARGET_CHANGED');
  const occurrences=prepareOccurrenceComparison(old,fresh,itemRegions);
  for(const critical of v.criticalRegions??[]){
    // Only program-derived item occurrences inside order_grid get appearance
    // tolerance. Stock, numeric badges, checks and all surrounding pixels stay exact.
    const icons=critical.field==='order_grid'?overlappingIcons(itemRegions,critical.box):[];
    if(icons.length?!occurrences.compare(critical.box).matched:regionDigest(old,critical.box)!==regionDigest(fresh,critical.box))fail('NAVIGATION_TARGET_CHANGED');
  }
  const differences=[];
  for(const box of v.targetRegions){
    const icons=overlappingIcons(itemRegions,box);
    if(icons.length){
      const result=occurrences.compare(box,{channelTolerance:v.channelTolerance??12,maxChangedRatio:v.maxChangedRatio??.03});
      if(!result.matched)fail('NAVIGATION_TARGET_CHANGED');
      differences.push(Math.max(...result.instances.map(s=>s.changedRatio??0)));continue;
    }
    let changed=0;
    for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
      const offset=(y*old.width+x)*old.channels;
      for(let c=0;c<Math.min(3,old.channels);c++)if(Math.abs(old.pixels[offset+c]-fresh.pixels[offset+c])>(v.channelTolerance??12)){changed++;break;}
    }
    differences.push(changed/(box.width*box.height));
  }
  if(differences.some((ratio,i)=>!overlappingIcons(itemRegions,v.targetRegions[i]).length&&ratio>(v.maxChangedRatio??0.03))){
    const match=v.motion && motionMatch(old,fresh,target,v);
    if(!match)fail('NAVIGATION_TARGET_CHANGED');
    return {method:'anchor_and_motion_target',changedRatio:Math.max(...differences),...match};
  }
  return {method:'anchor_and_target',changedRatio:Math.max(...differences)};
}
