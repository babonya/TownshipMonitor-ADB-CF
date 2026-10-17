// Observation-only, same-scale relocation of registered static panel regions.
// This module supplies no target, order, quantity, countdown or input proof.
import {digest} from './adb.mjs';

const inside=(image,b)=>[b.x,b.y,b.width,b.height].every(Number.isSafeInteger)&&
  b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width<=image.width&&b.y+b.height<=image.height;
const moved=(b,x,y)=>({...b,x:b.x+x,y:b.y+y});
function matches(image,template,b){
  if(!inside(image,b)||template.width!==b.width||template.height!==b.height)return false;
  let changed=0;const limit=Math.floor(b.width*b.height*.03);
  for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
    const p=((b.y+y)*image.width+b.x+x)*image.channels,q=(y*b.width+x)*template.channels;
    if([0,1,2].some(c=>Math.abs(image.pixels[p+c]-template.pixels[q+c])>12)&&++changed>limit)return false;
  }
  return true;
}
export function localizeIdleRegistration(image,registration){
  const {profile,assets,hash}=registration,spec=profile.localization;
  if(!spec)return registration;
  if(spec.mode!=='translation_only'||spec.inputSupport!==false||spec.scale!==1||image.channels<3||
    !spec.acceptedDimensions?.some(d=>d.width===image.width&&d.height===image.height))return null;
  const anchor=profile.anchors[0],template=assets.get(anchor.file);
  if(!template||!inside({width:spec.sourceDimensions.width,height:spec.sourceDimensions.height},anchor.box))return null;
  // Exact sample prefilter may conservatively abstain. Full-region verification
  // remains mandatory; neither sample matches nor a title alone proves absence.
  const samples=[];
  for(let y=2;y<template.height;y+=5)for(let x=2;x<template.width;x+=7){
    const q=(y*template.width+x)*template.channels;
    if(template.pixels[q]<180&&template.pixels[q+1]<150)samples.push({x,y,q});
  }
  if(samples.length<8)return null;
  const probes=samples.filter((_,i)=>i%Math.max(1,Math.floor(samples.length/20))===0).slice(0,20);
  const found=[];
  const maxX=image.width-spec.sourceDimensions.width,maxY=image.height-spec.sourceDimensions.height;
  if(maxX<0||maxY<0)return null;
  for(let dy=0;dy<=maxY;dy++)for(let dx=0;dx<=maxX;dx++){
    const b=moved(anchor.box,dx,dy);
    if(probes.some(({x,y,q})=>{const p=((b.y+y)*image.width+b.x+x)*image.channels;
      return [0,1,2].some(c=>Math.abs(image.pixels[p+c]-template.pixels[q+c])>12);}))continue;
    if(matches(image,template,b))found.push({dx,dy});
    if(found.length>1)return null;
  }
  if(found.length!==1)return null;
  const {dx,dy}=found[0];
  const transform=value=>{
    if(Array.isArray(value))return value.map(transform);
    if(!value||typeof value!=='object')return value;
    if(['x','y','width','height'].every(k=>Number.isSafeInteger(value[k])))return moved(value,dx,dy);
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,transform(v)]));
  };
  const localized=transform({...profile,localization:undefined,dimensions:undefined});
  localized.dimensions={width:image.width,height:image.height};
  // Every required static region must match in the single original transform.
  const required=[...localized.anchors,...(localized.regions??[]).filter(r=>r.file!=='units.png'),
    ...(localized.rows??[]).flatMap(r=>r.regions)];
  if(!required.every(r=>assets.has(r.file)&&matches(image,assets.get(r.file),r.box)))return null;
  const localization={scale:1,dx,dy,sourceHash:profile.source.evidenceHash,inputSupport:false};
  return {profile:localized,assets,hash:digest(Buffer.from(JSON.stringify({profileHash:hash,localization}))),localization};
}
