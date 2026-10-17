// Disposable position of the two original market slots. No currency classifier.
import {scrollScope,scrollIntent} from './market-scroll.mjs';
const valid=r=>r?.width===384&&r.height===16&&Array.isArray(r.pixels)&&r.pixels.length===6144&&r.pixels.every(n=>Number.isInteger(n)&&n>=0&&n<=255);
export function marketDisplacement(a,b,maxDistance=.75){
  if(!valid(a)||!valid(b))return null;
  const w=a.width,h=a.height,shifts=[];
  if(!Number.isFinite(maxDistance)||maxDistance<=0||maxDistance>.94)return null;
  // The two market rows are independent evidence. A transient capacity badge
  // can obscure the upper row while the lower row still proves translation.
  for(let row=0;row<2;row++){
  const scores=[];
  for(let shift=-Math.floor(w*maxDistance);shift<=Math.floor(w*maxDistance);shift++){
    const start=Math.max(0,-shift),end=Math.min(w,w-shift);let error=0,sum=0,square=0;
    for(let y=row*h/2;y<(row+1)*h/2;y++)for(let x=start;x<end;x++){
      const p=a.pixels[y*w+x],q=b.pixels[y*w+x+shift];error+=Math.abs(p-q);sum+=p;square+=p*p;
    }
    const n=(end-start)*h/2;
    if(square/n-(sum/n)**2>=100)scores.push({shift,error:error/n});
  }
  scores.sort((a,b)=>a.error-b.error);const best=scores[0];
  if(!best||best.error>12)continue;
  const alternate=scores.find(s=>Math.abs(s.shift-best.shift)>3);
  if(alternate&&alternate.error-best.error<1.5)continue;
  shifts.push(best.shift);
  }
  if(!shifts.length||Math.max(...shifts)-Math.min(...shifts)>3)return null;
  // Use the smaller proven forward movement so an excluded slot is never
  // released early by a small disagreement between rows.
  return Math.max(...shifts)/w;
}
const positionDrag=(v,i)=>v.provider==='android_adb'?i.drag:{distance:.30,durationMs:400};
const displacement=(i,v)=>marketDisplacement(i.positionRaster,v.marketPosition?.raster,v.provider==='android_adb'?.94:.75);
export function validPositionScroll(v,i){
  const expected=scrollIntent(v,{anchorPhase:i.alignment?.anchorPhase});
  return !!expected&&valid(v.marketPosition?.raster)&&JSON.stringify(i)===JSON.stringify({...expected,
    reason:'market_leave_origin',drag:positionDrag(v,expected),positionRaster:v.marketPosition.raster});
}
export function purchasePositionValid(v,i){
  const p=i.marketPosition;
  return p?.schema===1&&p.scope===scrollScope(v)&&p.frameId===v.sourceObservation?.frameId&&!!p.frameId&&
    p.evidenceHash===v.sourceObservation?.evidenceHash&&!!p.evidenceHash&&Number.isFinite(p.excludedRight)&&
    p.excludedRight>=0&&p.excludedRight<.4&&i.cell?.x>=v.view.x+p.excludedRight*v.view.width;
}
export class MarketPosition{
  constructor(){this.reset();}
  reset(){this.scope=null;this.excludedRight=null;this.hold=null;}
  invalidate(){this.scope=null;this.excludedRight=null;this.hold='SOM_MARKET_POSITION_REQUIRED';}
  settle(i,v,outcome){
    if(i.kind!=='som_scroll')return;
    if(outcome!=='confirmed'||i.alignment?.scope!==scrollScope(v)){this.invalidate();return;}
    if(this.excludedRight!==null&&this.excludedRight>0){
      const delta=displacement(i,v);
      if(delta===null||delta>2/384){this.invalidate();return;}
      // Only actual observed translation moves the original excluded slots.
      // Keep a small raster margin until the entire column leaves the view.
      this.excludedRight=Math.max(0,this.excludedRight+delta);
    }
  }
  prepare(v){
    if(this.scope&&this.scope!==scrollScope(v))this.invalidate();
    const right=v.marketPosition?.firstColumnRight;
    // A currently observed initial-slot marker can also restore lost tracking.
    if(v.marketPosition?.originVisible===true&&Number.isFinite(right)&&right>0&&right<.4&&
      (this.hold||this.excludedRight===0))this.reset();
    if(this.hold)return {waitMs:3000,reason:this.hold};
    if(this.excludedRight===null){
      // The market always opens at its beginning. Establish the initial two
      // slots from the entry grid, without requiring SALE or a search drag.
      if(Number.isFinite(right)&&right>0&&right<.4){
        this.scope=scrollScope(v);this.excludedRight=right+3/v.view.width;return null;
      }
      return {waitMs:3000,reason:'SOM_MARKET_POSITION_REQUIRED'};
    }
    return null;
  }
  eligible(v,cell){return this.excludedRight!==null&&this.scope===scrollScope(v)&&cell.card.x>=v.view.x+this.excludedRight*v.view.width;}
  proof(v){return {schema:1,scope:this.scope,excludedRight:this.excludedRight,...v.sourceObservation};}
  scroll(v,i){return i&&this.excludedRight>0?{...i,reason:'market_leave_origin',drag:positionDrag(v,i),positionRaster:v.marketPosition?.raster}:i;}
}
