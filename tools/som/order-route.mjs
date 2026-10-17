// A disposable list of navigation attempts, not an order identity ledger.
// The user accepts missed selections within this same-panel survey.
const finiteBox=b=>b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0;
const inside=(b,v)=>finiteBox(b)&&finiteBox(v)&&b.x>=v.x&&b.y>=v.y&&b.x+b.width<=v.x+v.width&&b.y+b.height<=v.y+v.height;
export const routeScope=v=>JSON.stringify([v.profileHash,v.viewport,v.captureSize,v.captureSerial]);
const fractional=(b,v)=>({x:(b.x-v.x)/v.width,y:(b.y-v.y)/v.height,width:b.width/v.width,height:b.height/v.height});
const raster=(b,v)=>({x:Math.round(v.x+b.x*v.width),y:Math.round(v.y+b.y*v.height),width:Math.round(b.width*v.width),height:Math.round(b.height*v.height)});
export function routeTarget(v,i){
  const r=i.route,point=r?.point;
  if(v.scene!=='helicopter'||v.popup||v.minigame?.detected||!finiteBox(v.viewport)||r?.scope!==routeScope(v)||
    r.unit!=='fraction'||r.space!=='game'||!point||!['x','y'].every(k=>Number.isFinite(point[k])&&point[k]>0&&point[k]<1))return null;
  const x=v.viewport.x+point.x*v.viewport.width,y=v.viewport.y+point.y*v.viewport.height;
  const b={x:Math.round(x)-1,y:Math.round(y)-1,width:2,height:2};
  return inside(b,v.viewport)?b:null;
}
export class OrderRoute{
  constructor(v){
    this.scope=routeScope(v);this.source=v.sourceObservation??null;this.current=null;this.finishedAt=null;
    this.entries=(v.pins??[]).filter(p=>['red','green'].includes(p.color)&&inside(p.visualBox,v.viewport)&&inside(p.box,v.viewport))
      .map(p=>({color:p.color,body:fractional(p.visualBox,v.viewport),tip:fractional(p.box,v.viewport),selected:!!p.selected,attempted:false}))
      .sort((a,b)=>a.body.y-b.body.y||a.body.x-b.body.x);
    // Reuse an already visible selection opportunistically; absence is harmless.
    const selected=this.entries.filter(e=>e.selected);
    if(selected.length===1){this.current=this.entries.indexOf(selected[0]);selected[0].attempted=true;}
  }
  matches(v){return this.scope===routeScope(v);}
  currentBox(v){return this.current===null?null:raster(this.entries[this.current].tip,v.viewport);}
  next(v,now){
    const index=this.entries.findIndex(e=>!e.attempted);
    if(index<0){this.finishedAt??=now;return null;}
    const e=this.entries[index],point={x:e.body.x+e.body.width/2,y:e.body.y+e.body.height/2};
    return {kind:'som_select',box:raster(e.tip,v.viewport),color:e.color,next:'helicopter',
      route:{scope:this.scope,source:this.source,index,unit:'fraction',space:'game',point}};
  }
  settle(i,outcome){
    if(i.route?.scope!==this.scope||!Number.isInteger(i.route.index)||!this.entries[i.route.index])return;
    this.entries[i.route.index].attempted=true;
    this.current=['observed','confirmed'].includes(outcome)?i.route.index:null;
  }
}
