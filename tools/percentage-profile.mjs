// Path-bound percentages are the authoritative reusable profile geometry.
// Pixel fields are retained for raster evidence and must equal the derivation.
import {readFileSync} from 'node:fs';
const policy=JSON.parse(readFileSync(new URL('../reference/percentage-profile-policy.json',import.meta.url),'utf8'));
if(policy.schema!==1)throw Error('PROFILE_PERCENTAGE_POLICY_INVALID');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{throw Error('PROFILE_PERCENTAGE_GEOMETRY_CHANGED');};
const snap=n=>Math.round(n);
const box=v=>v&&['x','y','width','height'].every(k=>Number.isSafeInteger(v[k]))&&v.x>=0&&v.y>=0&&v.width>0&&v.height>0;
const dimensions=v=>v?.dimensions??(Number.isSafeInteger(v?.width)&&Number.isSafeInteger(v?.height)&&!Object.hasOwn(v,'x')?{width:v.width,height:v.height}:null);
const excluded=new Set(policy.excludedFields);
const axes=policy.axes;
const point=v=>v&&Number.isSafeInteger(v.x)&&Number.isSafeInteger(v.y)&&!Object.hasOwn(v,'width')&&!Object.hasOwn(v,'height');
export function registeredPercentageBox(fraction,canvas){
  if(!canvas||!Number.isSafeInteger(canvas.width)||!Number.isSafeInteger(canvas.height)||!fraction||!['x','y','width','height'].every(k=>Number.isFinite(fraction[k]))||fraction.x<0||fraction.y<0||fraction.width<=0||fraction.height<=0||fraction.x+fraction.width>1+1e-12||fraction.y+fraction.height>1+1e-12)fail();
  return {x:snap(fraction.x*canvas.width),y:snap(fraction.y*canvas.height),width:snap(fraction.width*canvas.width),height:snap(fraction.height*canvas.height)};
}
export function encodePercentageProfile(document,fallback={...policy.defaultCanvas}){
  const copy=structuredClone(document);delete copy.percentageGeometry;const entries=[];
  const sourceCanvases=new Map(),assetCanvases=new Map();
  for(const layout of copy.layouts??[]){if(!layout.dimensions)continue;sourceCanvases.set(layout.sourceHash,layout.dimensions);for(const value of [...policy.layoutAssetLists.flatMap(key=>layout[key]??[]),...policy.layoutAssetObjects.map(key=>layout[key])].filter(Boolean))if(value.file)assetCanvases.set(value.file,layout.dimensions);}
  const walk=(v,path,canvas)=>{
    const axis=axes[path.at(-1)]??(path.at(-2)===policy.rowField&&Number.isSafeInteger(v)?policy.rowAxis:null);
    if(axis&&Number.isSafeInteger(v)){entries.push({kind:'scalar',axis,path,canvas:{...canvas},fraction:v/canvas[axis]});return;}
    if(!v||typeof v!=='object')return;
    canvas=dimensions(v)??sourceCanvases.get(v.sourceHash)??assetCanvases.get(v.file)??canvas;
    if(point(v)){entries.push({kind:'point',path,canvas:{...canvas},fraction:{x:v.x/canvas.width,y:v.y/canvas.height}});return;}
    if(box(v)&&v.x+v.width<=canvas.width&&v.y+v.height<=canvas.height){
      entries.push({path,canvas:{...canvas},fraction:{x:v.x/canvas.width,y:v.y/canvas.height,width:v.width/canvas.width,height:v.height/canvas.height}});return;
    }
    for(const [k,child]of Object.entries(v))if(!excluded.has(k))walk(child,[...path,k],canvas);
  };walk(copy,[],dimensions(copy)??fallback);
  copy.percentageGeometry={schema:1,unit:'fraction',space:'registered_capture',canvas:dimensions(copy)??fallback,entries};return copy;
}
export function resolvePercentageProfile(document,{historical=false}={}){
  const meta=document.percentageGeometry;if(meta===undefined){if(historical)return document;fail();}
  if(meta.schema!==1||meta.unit!=='fraction'||meta.space!=='registered_capture'||!Array.isArray(meta.entries))fail();
  const resolved=structuredClone(document),seen=new Map();
  for(const e of meta.entries){
    if(!Array.isArray(e.path)||!e.path.length||e.path.some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)))fail();
    const key=JSON.stringify(e.path);if(seen.has(key))fail();seen.set(key,e);
    const d=e.canvas,f=e.fraction;
    if(e.kind==='scalar'||e.kind==='point'){
      if(!d||!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<1||d.height<1)fail();
      let parent=resolved;for(const k of e.path.slice(0,-1)){if(!Object.hasOwn(parent??{},k))fail();parent=parent[k];}
      const k=e.path.at(-1),old=parent?.[k];
      if(e.kind==='scalar'){
        if(!['width','height'].includes(e.axis)||!Number.isFinite(f)||!Number.isSafeInteger(old))fail();
        const physical=Math.floor(f*d[e.axis]+.5);if(physical!==old)fail();parent[k]=physical;
      }else{
        if(!point(old)||!f||!Number.isFinite(f.x)||!Number.isFinite(f.y))fail();
        const physical={x:Math.floor(f.x*d.width+.5),y:Math.floor(f.y*d.height+.5)};
        if(physical.x!==old.x||physical.y!==old.y)fail();parent[k]={...old,...physical};
      }
      continue;
    }
    if(!d||!Number.isSafeInteger(d.width)||!Number.isSafeInteger(d.height)||d.width<1||d.height<1||!f||!['x','y','width','height'].every(k=>Number.isFinite(f[k]))||f.x<0||f.y<0||f.width<=0||f.height<=0||f.x+f.width>1+1e-12||f.y+f.height>1+1e-12)fail();
    let parent=resolved;for(const k of e.path.slice(0,-1)){if(!Object.hasOwn(parent??{},k))fail();parent=parent[k];}
    const k=e.path.at(-1),old=parent?.[k];if(!box(old))fail();
    const physical={x:snap(f.x*d.width),y:snap(f.y*d.height),width:snap(f.width*d.width),height:snap(f.height*d.height)};
    if(!same(physical,{x:old.x,y:old.y,width:old.width,height:old.height}))fail();
    parent[k]={...old,...physical};
  }
  const expected=encodePercentageProfile(resolved,meta.canvas).percentageGeometry.entries;
  // The registered canvas can vary by layout. Paths, not duplicated boxes, bind coverage.
  if(expected.length!==seen.size||expected.some(e=>{const actual=seen.get(JSON.stringify(e.path));return !actual||!same(e.canvas,actual.canvas)||e.kind!==actual.kind||e.axis!==actual.axis;}))fail();
  delete resolved.percentageGeometry;return resolved;
}
