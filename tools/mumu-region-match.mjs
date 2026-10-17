// Appearance belongs to an occurrence, never to a globally unique product.
// This module does not discover coordinates, resize images or authorize input.
const contains=(b,x,y)=>x>=b.x&&y>=b.y&&x<b.x+b.width&&y<b.y+b.height;
const inside=(a,b)=>a.x>=b.x&&a.y>=b.y&&a.x+a.width<=b.x+b.width&&a.y+a.height<=b.y+b.height;
const overlaps=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const validBox=(b,w,h)=>b&&['x','y','width','height'].every(k=>Number.isSafeInteger(b[k]))&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width<=w&&b.y+b.height<=h;
const validImage=i=>i&&Number.isSafeInteger(i.width)&&Number.isSafeInteger(i.height)&&[3,4].includes(i.channels)&&i.pixels?.length===i.width*i.height*i.channels;
const stats=()=>({n:0,changed:0,different:0,maxDelta:0,a:[0,0,0],b:[0,0,0],aa:[0,0,0],bb:[0,0,0],ab:[0,0,0]});
function add(s,a,p,b,q){
 s.n++;let changed=false,different=false;
 for(let c=0;c<3;c++){const x=a[p+c],y=b[q+c],delta=Math.abs(x-y);different||=x!==y;changed||=delta>12;s.maxDelta=Math.max(s.maxDelta,delta);s.a[c]+=x;s.b[c]+=y;s.aa[c]+=x*x;s.bb[c]+=y*y;s.ab[c]+=x*y;}
 s.changed+=Number(changed);s.different+=Number(different);
}
function assess(s){
 if(s.n<64)return {matched:false,reason:'ICON_COVERAGE_REQUIRED'};
 // Zero difference is a cheap path and retains existing exact flat regions.
 if(!s.different)return {matched:true,method:'exact',changedRatio:0,correlation:1};
 let va=0,vb=0,cov=0,meanDelta=0;
 for(let c=0;c<3;c++){va+=s.aa[c]-s.a[c]*s.a[c]/s.n;vb+=s.bb[c]-s.b[c]*s.b[c]/s.n;cov+=s.ab[c]-s.a[c]*s.b[c]/s.n;meanDelta=Math.max(meanDelta,Math.abs(s.a[c]-s.b[c])/s.n);}
 const stdA=Math.sqrt(Math.max(0,va)/(3*s.n)),stdB=Math.sqrt(Math.max(0,vb)/(3*s.n)),ratio=stdB/stdA,correlation=cov/Math.sqrt(va*vb),changedRatio=s.changed/s.n;
 // 95% pixel agreement alone is insufficient: preserve texture, shape and colour.
 const matched=changedRatio<=.05&&s.maxDelta<=32&&stdA>=10&&stdB>=10&&ratio>=.85&&ratio<=1.15&&Number.isFinite(correlation)&&correlation>=.995&&meanDelta<=12;
 return {matched,method:'bounded_appearance',changedRatio,correlation,meanDelta,maxChannelDelta:s.maxDelta,reason:matched?null:'ICON_APPEARANCE_CHANGED'};
}
function assessOccurrence(reference,image,sourceBox,box,s,unshifted){
 const initial=assess(unshifted);if(initial.matched)return initial;
 // Local artwork alignment only. Every destination pixel is still checked;
 // clamped edges and protected pixels never become an ignored border.
 for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(!dx&&!dy)continue;
  const sample=stats();
  for(let y=s.box.y;y<s.box.y+s.box.height;y++)for(let x=s.box.x;x<s.box.x+s.box.width;x++){
   if(s.protectedBoxes.some(b=>contains(b,x,y)))continue;
   const sx=Math.max(s.box.x,Math.min(s.box.x+s.box.width-1,x-dx)),sy=Math.max(s.box.y,Math.min(s.box.y+s.box.height-1,y-dy));
   const p=((sourceBox.y+sy-box.y)*reference.width+sourceBox.x+sx-box.x)*reference.channels,q=(y*image.width+x)*image.channels;
   add(sample,reference.pixels,p,image.pixels,q);
  }
  const aligned=assess(sample);
  // Exact shifted flat areas must not bypass the texture requirement.
  const textured=sample.aa.reduce((sum,n,c)=>sum+n-sample.a[c]*sample.a[c]/sample.n,0)>=300*sample.n;
  if(aligned.matched&&textured)return {...aligned,method:'bounded_alignment',offset:{x:dx,y:dy}};
 }
 return initial;
}
export function iconOccurrence(instanceId,itemId,box,protectedBoxes=[]){return {instanceId,itemId,box,protectedBoxes};}
function includedArea(s){
 const xs=[...new Set([s.box.x,s.box.x+s.box.width,...s.protectedBoxes.flatMap(b=>[b.x,b.x+b.width]).filter(x=>x>s.box.x&&x<s.box.x+s.box.width)])].sort((a,b)=>a-b);
 const ys=[...new Set([s.box.y,s.box.y+s.box.height,...s.protectedBoxes.flatMap(b=>[b.y,b.y+b.height]).filter(y=>y>s.box.y&&y<s.box.y+s.box.height)])].sort((a,b)=>a-b);
 let area=0;for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++)if(!s.protectedBoxes.some(b=>contains(b,xs[x],ys[y])))area+=(xs[x+1]-xs[x])*(ys[y+1]-ys[y]);return area;
}
// sourceBox and box have the same size but may be at entirely different origins.
// Each instance is checked independently, even when every itemId is identical.
export function matchScopedRegion(reference,image,{sourceBox,box,icons=[],channelTolerance=0,maxChangedRatio=0}={}){
 const no=reason=>({matched:false,reason,instances:[]});
 if(!validImage(reference)||!validImage(image)||!validBox(box,image.width,image.height)||!validBox(sourceBox,reference.width,reference.height)||sourceBox.width!==box.width||sourceBox.height!==box.height)return no('REGION_GEOMETRY_INVALID');
 if(!Number.isInteger(channelTolerance)||channelTolerance<0||channelTolerance>12||!Number.isFinite(maxChangedRatio)||maxChangedRatio<0||maxChangedRatio>.03||!Array.isArray(icons)||icons.length>9)return no('REGION_POLICY_INVALID');
 const ids=new Set();
 for(const [i,s] of icons.entries()){
  if(!s||typeof s.instanceId!=='string'||!s.instanceId||ids.has(s.instanceId)||typeof s.itemId!=='string'||!s.itemId||!validBox(s.box,image.width,image.height)||!inside(s.box,box)||icons.slice(0,i).some(p=>overlaps(p.box,s.box))||!Array.isArray(s.protectedBoxes)||s.protectedBoxes.some(b=>!validBox(b,image.width,image.height)))return no('INSTANCE_SCOPE_INVALID');
  ids.add(s.instanceId);
 }
 const areas=icons.map(includedArea);if(areas.some(n=>n<64))return no('ICON_COVERAGE_REQUIRED');
 let identical=true;
 exact:for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){
  const p=((sourceBox.y+y)*reference.width+sourceBox.x+x)*reference.channels,q=((box.y+y)*image.width+box.x+x)*image.channels;
  for(let c=0;c<3;c++)if(reference.pixels[p+c]!==image.pixels[q+c]){identical=false;break exact;}
 }
 if(identical)return {matched:true,reason:null,instances:icons.map(s=>({instanceId:s.instanceId,itemId:s.itemId,box:s.box,matched:true,method:'exact',changedRatio:0,correlation:1}))};
 const accum=icons.map(stats),fixedPixels=box.width*box.height-areas.reduce((a,b)=>a+b,0);let fixed=0,changed=0;
 for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){
  const ax=box.x+x,ay=box.y+y,p=((sourceBox.y+y)*reference.width+sourceBox.x+x)*reference.channels,q=(ay*image.width+ax)*image.channels;
  const i=icons.findIndex(s=>contains(s.box,ax,ay)&&!s.protectedBoxes.some(b=>contains(b,ax,ay)));
  if(i>=0)add(accum[i],reference.pixels,p,image.pixels,q);
  else {fixed++;if([0,1,2].some(c=>Math.abs(reference.pixels[p+c]-image.pixels[q+c])>channelTolerance))changed++;
   if(changed>fixedPixels*maxChangedRatio)return no('PROTECTED_REGION_CHANGED');}
 }
 const instances=icons.map((s,i)=>({instanceId:s.instanceId,itemId:s.itemId,box:s.box,...assessOccurrence(reference,image,sourceBox,box,s,accum[i])}));
 const matched=changed<=(fixed*maxChangedRatio)&&instances.every(s=>s.matched);
 return {matched,reason:matched?null:changed>fixed*maxChangedRatio?'PROTECTED_REGION_CHANGED':'ICON_APPEARANCE_CHANGED',instances};
}
export function compareImageRegion(before,after,box,icons=[]){
 if(before?.width!==after?.width||before?.height!==after?.height||before?.channels!==after?.channels)return {matched:false,reason:'REGION_GEOMETRY_INVALID',instances:[]};
 return matchScopedRegion(before,after,{sourceBox:box,box,icons});
}
// Validate full registered occurrences once, then project their accepted artwork
// into critical/target subregions. A thin target intersection is not a new icon.
// The closure owns its evidence; serialized targets cannot supply acceptance.
export function prepareOccurrenceComparison(before,after,icons=[]){
 const no=reason=>({matched:false,reason,instances:[]});
 const valid=validImage(before)&&validImage(after)&&before.width===after.width&&before.height===after.height&&before.channels===after.channels&&Array.isArray(icons)&&icons.length<=9&&icons.every((s,i)=>s&&validBox(s.box,after.width,after.height)&&!icons.slice(0,i).some(p=>p.instanceId===s.instanceId||overlaps(p.box,s.box)));
 // Copy descriptors so later mutation cannot broaden a validated scope.
 const scopes=valid?icons.map(s=>structuredClone(s)):[];
 const results=scopes.map(s=>compareImageRegion(before,after,s.box,[s]));
 return {compare(box,{channelTolerance=0,maxChangedRatio=0}={}){
  if(!valid||!validBox(box,after.width,after.height))return no('INSTANCE_SCOPE_INVALID');
  if(!Number.isInteger(channelTolerance)||channelTolerance<0||channelTolerance>12||!Number.isFinite(maxChangedRatio)||maxChangedRatio<0||maxChangedRatio>.03)return no('REGION_POLICY_INVALID');
  const relevant=scopes.map((s,i)=>({s,result:results[i]})).filter(({s})=>overlaps(s.box,box));
  if(relevant.some(({result})=>!result.matched))return no('ICON_APPEARANCE_CHANGED');
  let fixed=0,changed=0;
  for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
   const p=(y*before.width+x)*before.channels,q=(y*after.width+x)*after.channels;
   const protectedPixel=scopes.some(s=>s.protectedBoxes?.some(b=>contains(b,x,y)));
   if(protectedPixel){if([0,1,2].some(c=>before.pixels[p+c]!==after.pixels[q+c]))return no('PROTECTED_REGION_CHANGED');continue;}
   if(relevant.some(({s})=>contains(s.box,x,y)))continue;
   fixed++;if([0,1,2].some(c=>Math.abs(before.pixels[p+c]-after.pixels[q+c])>channelTolerance))changed++;
  }
  const matched=changed<=fixed*maxChangedRatio;
  return {matched,reason:matched?null:'PROTECTED_REGION_CHANGED',instances:relevant.flatMap(({result})=>result.instances)};
 }};
}
export function matchRegisteredRegion(image,spec,template,{icons=[]}={}){
 if(!template||template.width!==spec.box.width||template.height!==spec.box.height)return false;
 return matchScopedRegion(template,image,{sourceBox:{x:0,y:0,width:template.width,height:template.height},box:spec.box,icons,
  channelTolerance:spec.exact===false?12:0,maxChangedRatio:spec.exact===false?.03:0}).matched;
}
