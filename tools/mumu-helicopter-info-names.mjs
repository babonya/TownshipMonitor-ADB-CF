// Registered full-name rasters are recovery evidence only, never order truth.
import {readFileSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {digest,decodePng,validateBox} from './adb.mjs';
import {cropPng} from './png-crop.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const boxSame=(a,b)=>!!a&&!!b&&['x','y','width','height'].every(k=>a[k]===b[k]);
const fail=()=>{throw Error('HELICOPTER_INFO_NAME_REGISTRATION_INVALID');};
const verifiedRasters=new Map();

// Compare the entire bound name box. Native raster noise may change at most
// 0.5% of its pixels, and no channel may differ by more than two levels.
// This is only name evidence for dismissal, never product identity or OCR.
export function sameHelicopterInfoNameRegion(before,after,beforeBox,afterBox=beforeBox){
  try{
    if(!same(beforeBox,afterBox)||!before||!after||before.width!==after.width||before.height!==after.height||
      ![3,4].includes(before.channels)||before.channels!==after.channels||
      before.pixels?.length!==before.width*before.height*before.channels||after.pixels?.length!==after.width*after.height*after.channels)return false;
    validateBox(beforeBox,before.width,before.height);validateBox(afterBox,after.width,after.height);
    let changed=0;const limit=beforeBox.width*beforeBox.height*0.005;
    for(let y=beforeBox.y;y<beforeBox.y+beforeBox.height;y++)for(let x=beforeBox.x;x<beforeBox.x+beforeBox.width;x++){
      const i=(y*before.width+x)*before.channels;let different=false;
      for(let c=0;c<before.channels;c++){
        const delta=Math.abs(before.pixels[i+c]-after.pixels[i+c]);
        if(delta>2)return false;if(delta>0)different=true;
      }
      if(different&&++changed>limit)return false;
    }
    return true;
  }catch{return false;}
}

export function loadHelicopterNameTemplates(config,directory){
  if(config.nameTemplates===undefined)return [];
  if(!Array.isArray(config.nameTemplates))fail();
  const names=new Set(),root=realpathSync(directory);
  const asset=file=>{
    if(typeof file!=='string'||!file||isAbsolute(file)||file.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))fail();
    const path=realpathSync(join(root,file)),rel=relative(root,path);
    if(!rel||rel.startsWith('..')||isAbsolute(rel))fail();
    return readFileSync(path);
  };
  return config.nameTemplates.map(spec=>{
    const d=spec?.sourceDimensions,b=spec?.cropBox,p=spec?.percentageCrop,s=spec?.scope;
    if(!spec||typeof spec.id!=='string'||!/^[a-z0-9_-]+$/.test(spec.id)||names.has(spec.id)||
      typeof spec.canonicalProductId!=='string'||!/^[a-z0-9_]+$/.test(spec.canonicalProductId)||
      !hash(spec.sha256)||!hash(spec.sourceHash)||typeof spec.sourceFrameId!=='string'||!spec.sourceFrameId||
      !d||d.width!==1578||d.height!==1268||d.width!==config.dimensions?.width||d.height!==config.dimensions?.height||
      !s||s.provider!=='google_play_windows'||s.transport!=='helicopter'||s.width!==d.width||s.height!==d.height)fail();
    names.add(spec.id);validateBox(b,d.width,d.height);validateBox(s.viewport,d.width,d.height);
    if(b.width<16||b.height<16||b.x<s.viewport.x||b.y<s.viewport.y||b.x+b.width>s.viewport.x+s.viewport.width||b.y+b.height>s.viewport.y+s.viewport.height||
      !p||p.unit!=='fraction'||p.space!=='registered_capture'||!boxSame(p.referenceBox,{x:0,y:0,width:d.width,height:d.height})||
      !['x','y','width','height'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1&&p[k]===b[k]/(['x','width'].includes(k)?d.width:d.height)))fail();
    const bytes=asset(spec.file),source=asset(spec.sourceFile);
    if(digest(bytes)!==spec.sha256||digest(source)!==spec.sourceHash)fail();
    // Rehash every file on every call. Reuse decoding only after the exact
    // source/template bytes and crop provenance have already been verified.
    const key=JSON.stringify([spec.sha256,spec.sourceHash,d,b]);
    let image=verifiedRasters.get(key);
    if(!image){
      image=decodePng(bytes);const original=decodePng(source);
      if(original.width!==d.width||original.height!==d.height||image.width!==b.width||image.height!==b.height||
        ![3,4].includes(image.channels)||image.channels!==original.channels||digest(cropPng(original,b))!==spec.sha256)fail();
      if(verifiedRasters.size>=16)verifiedRasters.delete(verifiedRasters.keys().next().value);
      verifiedRasters.set(key,image);
    }
    return {spec,image:{...image,pixels:Buffer.from(image.pixels)}};
  });
}

function match(registration,side,viewport){
  const {frame,image,box}=side;
  if(!frame||!image||image.width!==frame.width||image.height!==frame.height)return null;
  const matches=(registration.nameTemplates??[]).filter(({spec,image:template})=>{
    const scope=spec.scope;
    if(frame.provider!==scope.provider||frame.width!==scope.width||frame.height!==scope.height||
      !boxSame(viewport,scope.viewport)||!boxSame(box,spec.cropBox))return false;
    const crop=decodePng(cropPng(image,box));
    return sameHelicopterInfoNameRegion(template,crop,{x:0,y:0,width:box.width,height:box.height});
  });
  if(new Set(matches.map(m=>m.spec.canonicalProductId)).size!==1)return null;
  const {spec}=matches[0];
  return {canonicalProductId:spec.canonicalProductId,frameId:frame.id,evidenceHash:frame.evidenceHash,
    box:structuredClone(box),templateId:spec.id,templateHash:spec.sha256,cropHash:digest(cropPng(image,box))};
}

export function helicopterInfoNameEquivalence(registration,before,current,viewport){
  const a=match(registration,before,viewport),b=match(registration,current,viewport);
  if(!a||!b||a.canonicalProductId!==b.canonicalProductId)return null;
  const {canonicalProductId,...old}=a,{canonicalProductId:ignored,...fresh}=b;
  return {schema:1,registrationHash:registration.hash,canonicalProductId,viewport:structuredClone(viewport),before:old,current:fresh};
}

export function validateHelicopterNameEquivalence(proof,registration,frame,popup){
  if(!proof||proof.schema!==1||proof.registrationHash!==registration.hash||typeof proof.canonicalProductId!=='string')throw Error('HELICOPTER_INFO_NAME_PROOF_CHANGED');
  for(const side of [proof.before,proof.current]){
    const entry=registration.nameTemplates?.find(t=>t.spec.id===side?.templateId),s=entry?.spec;
    if(!s||s.canonicalProductId!==proof.canonicalProductId||side.templateHash!==s.sha256||!hash(side.cropHash)||!hash(side.evidenceHash)||
      typeof side.frameId!=='string'||!side.frameId||!boxSame(side.box,s.cropBox)||!boxSame(proof.viewport,s.scope.viewport)||
      frame.provider!==s.scope.provider||frame.width!==s.scope.width||frame.height!==s.scope.height)throw Error('HELICOPTER_INFO_NAME_PROOF_CHANGED');
  }
  if(proof.current.frameId!==frame.id||proof.current.evidenceHash!==frame.evidenceHash||!boxSame(proof.current.box,popup?.nameBox)||
    proof.before.frameId===frame.id)throw Error('HELICOPTER_INFO_NAME_PROOF_CHANGED');
}
