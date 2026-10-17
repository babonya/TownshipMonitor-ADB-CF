// Align existing market drags to observed gaps. No image matching or model calls.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const scrollScope=v=>JSON.stringify([v.profileHash,v.viewport,v.view]);
export function columnGeometry(v){
  const g=v.scrollGeometry,w=v.view?.width;
  if(!g||!w||g.unit!=='fraction'||g.space!=='market_view'||!same(g.basis,v.view)||
    !Number.isFinite(g.pitch)||g.pitch<.1||g.pitch>.3||!Number.isFinite(g.phase)||g.phase<0||g.phase>=g.pitch||
    !Array.isArray(g.gaps)||g.gaps.length<3||g.gaps.length>12)return null;
  for(let i=0;i<g.gaps.length;i++){
    const x=g.gaps[i];if(!Number.isFinite(x)||x<=0||x>=1)return null;
    if(i&&Math.abs(x-g.gaps[i-1]-g.pitch)>3/w)return null;
    const phaseError=((x-g.phase+g.pitch*1.5)%g.pitch)-g.pitch*.5;
    if(Math.abs(phaseError)>3/w)return null;
  }
  return {pitch:g.pitch,phase:g.phase};
}
export const columnPitch=v=>columnGeometry(v)?.pitch??null;
const phaseError=(phase,anchor,pitch)=>((phase-anchor+pitch*1.5)%pitch)-pitch*.5;
export function scrollIntent(v,{anchorPhase=null}={}){
  if(!v.view||!Number.isFinite(v.view.width)||v.view.width<=0||!v.viewport||!v.profileHash)return null;
  if(anchorPhase!==null&&(!Number.isFinite(anchorPhase)||anchorPhase<0||anchorPhase>=.3))return null;
  const geometry=columnGeometry(v);
  let pitch=null,error=null;
  if(geometry){
    pitch=geometry.pitch;anchorPhase??=geometry.phase;
    if(anchorPhase>=pitch)return null;
    error=phaseError(geometry.phase,anchorPhase,pitch);
  }else anchorPhase=null;
  // Gap measurement only adjusts an ordinary drag. Missing measurements and
  // errors of five pixels or less use the unchanged baseline, without a hold.
  const correction=error!==null&&Math.abs(error)*v.view.width>5+1e-9?error:0;
  const distance=v.provider==='android_adb'?675/734:.57+correction;
  if(distance<=0||distance>=.94)return null;
  return {kind:'som_scroll',box:v.view,direction:'right',descriptor:v.descriptor,next:'market',
    alignment:{schema:2,scope:scrollScope(v),pitch,anchorPhase,error,sourceGeometry:v.scrollGeometry??null},
    drag:{distance,durationMs:400}};
}
export function validScrollIntent(v,i){
  const a=i.alignment,expected=a&&scrollIntent(v,{anchorPhase:a.anchorPhase});
  return !!expected&&same(expected.alignment,a)&&same(expected.drag,i.drag)&&expected.direction===i.direction&&i.next==='market';
}
export function scrollResult(i,v){
  const a=i.alignment;
  if(!a||a.scope!==scrollScope(v))return {hold:'SOM_SCROLL_GEOMETRY_CHANGED'};
  if(v.marketEnd===true)return {end:true};
  const g=columnGeometry(v);
  if(!g||!Number.isFinite(a.pitch)||Math.abs(g.pitch-a.pitch)>2/v.view.width)return {anchorPhase:null,error:null};
  const error=phaseError(g.phase,a.anchorPhase,a.pitch),anchorPhase=a.anchorPhase;
  return {anchorPhase,error};
}
export function scrollSwipe(i){
  const b=i.box,d=i.drag.distance*(i.direction==='right'?1:-1);
  return {x1:Math.round(b.x+b.width*(.5+d/2)),x2:Math.round(b.x+b.width*(.5-d/2)),
    y1:Math.round(b.y+b.height*.25),y2:Math.round(b.y+b.height*.25),durationMs:i.drag.durationMs};
}
