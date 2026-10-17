// Locate a registered, static input core in the current original. Scene and
// authorization checks remain the caller's responsibility; ambiguity abstains.
import {readFileSync} from 'node:fs';
import {decodePng,digest} from './adb.mjs';
const inside=(b,r)=>b.x>=r.x&&b.y>=r.y&&b.x+b.width<=r.x+r.width&&b.y+b.height<=r.y+r.height;
const valid=b=>b&&['x','y','width','height'].every(k=>Number.isSafeInteger(b[k]))&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0;
export function boundNavigationOriginal(frame){
  if(!frame?.evidenceRef||!/^[a-f0-9]{64}$/.test(frame.evidenceHash??''))throw Error('NAVIGATION_ORIGINAL_REQUIRED');
  const bytes=readFileSync(frame.evidenceRef);if(digest(bytes)!==frame.evidenceHash)throw Error('NAVIGATION_ORIGINAL_CHANGED');
  const image=decodePng(bytes);if(image.width!==frame.width||image.height!==frame.height)throw Error('NAVIGATION_ORIGINAL_CHANGED');
  return image;
}
function navigationMatches(image,spec,template,matches){
  if(!spec?.locator)return matches(image,spec,template)?[{...spec.box}]:[];
  const search=spec.locator.searchBox,b=spec.box;
  if(spec.locator.schema!==1||!valid(search)||!valid(b)||!inside(search,{x:0,y:0,width:image.width,height:image.height})||
    !template||template.width!==b.width||template.height!==b.height||template.channels<3||image.channels<3)return [];
  // The cheap filter only rejects positions; the existing full matcher is
  // authoritative. Sample points span the core, excluding no required pixels.
  const samples=[];for(let gy=0;gy<4;gy++)for(let gx=0;gx<4;gx++){
    const x=Math.floor(gx*(b.width-1)/3),y=Math.floor(gy*(b.height-1)/3);
    samples.push({x,y,values:[0,1,2].map(c=>template.pixels[(y*b.width+x)*template.channels+c])});
  }
  const exact=!['static','illumination'].includes(spec.mode),hits=[];
  for(let y=search.y;y<=search.y+search.height-b.height;y++)for(let x=search.x;x<=search.x+search.width-b.width;x++){
    let possible=true;
    const first=samples[0],deltas=first.values.map((v,c)=>image.pixels[((y+first.y)*image.width+x+first.x)*image.channels+c]-v);
    for(const q of samples){
      for(let c=0;c<3;c++){
        const delta=image.pixels[((y+q.y)*image.width+x+q.x)*image.channels+c]-q.values[c];
        if(exact?delta!==0:spec.mode==='static'?Math.abs(delta)>32:Math.abs(delta-deltas[c])>48){possible=false;break;}
      }
      if(!possible)break;
    }
    if(!possible)continue;
    const candidate={...b,x,y};if(!matches(image,{...spec,box:candidate},template))continue;
    hits.push(candidate);if(hits.length>1)return hits;
  }
  return hits;
}
export function locateNavigationCore(image,spec,template,matches){
  const hits=navigationMatches(image,spec,template,matches);return hits.length===1?hits[0]:null;
}
export function locateNavigationVariants(image,specs,assets,matches){
  const hits=[];
  for(const spec of specs){
    const found=navigationMatches(image,spec,assets.get(spec.file),matches);if(found.length>1)return null;
    const box=found[0];if(!box)continue;
    if(!hits.some(h=>JSON.stringify(h.box)===JSON.stringify(box)))hits.push({spec,box});
  }
  return hits.length===1?hits[0]:null;
}
