import {resolvePercentageProfile} from './percentage-profile.mjs';
import {localizeIdleRegistration} from './mumu-idle-localization.mjs';
// Native observation-only proof. Never creates a review, target, order or effect.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng} from './adb.mjs';
import {cropPng} from './png-crop.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function trainIdleProfile(context){
 const current=context?.provider==='google_play_windows'&&(context.width??context.windowsCaptureSize?.width)===1578&&(context.height??context.windowsCaptureSize?.height)===1268;
 const file=new URL(current?'../reference/image-matching/google-play/current-1578/train-idle/profile.json':context?.provider==='google_play_windows'?'../reference/image-matching/google-play/train-idle/profile.json':'../reference/train-idle/profile.json',import.meta.url);
 const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes)),assets=new Map();
 if(profile.schema!==1||!same(profile.rows.map(r=>r.row),[1,2,3]))throw Error('TRAIN_IDLE_PROFILE_CHANGED');
 for(const a of profile.assets){
  if(a.file!==a.file.split(/[\\/]/).at(-1))throw Error('TRAIN_IDLE_ASSET_CHANGED');
  const b=readFileSync(join(dirname(fileURLToPath(file)),a.file));if(digest(b)!==a.sha256)throw Error('TRAIN_IDLE_ASSET_CHANGED');
  assets.set(a.file,decodePng(b));
 }
 return {profile,assets,hash:digest(bytes)};
}
function matches(image,spec,assets){
 const b=spec.box,t=assets.get(spec.file);if(!t||t.width!==b.width||t.height!==b.height)return false;
 let changed=0;for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const p=((b.y+y)*image.width+b.x+x)*image.channels,q=(y*b.width+x)*t.channels;
  if([0,1,2].some(c=>Math.abs(image.pixels[p+c]-t.pixels[q+c])>12))changed++;
 }
 return changed/(b.width*b.height)<=.03;
}
export function readTrainIdle(image,registration=trainIdleProfile()){
 registration=localizeIdleRegistration(image,registration);if(!registration)return {supported:false,reason:'TRAIN_IDLE_LOCALIZATION_REQUIRED',executionAllowed:false};
 const {profile,assets,hash}=registration,hold={supported:false,reason:'TRAIN_ALL_TRANSIT_REQUIRED',executionAllowed:false};
 if(image.width!==profile.dimensions.width||image.height!==profile.dimensions.height||image.channels<3||!profile.anchors.every(a=>matches(image,a,assets)))return hold;
 const rows=[];
 for(const row of profile.rows){
  if(!row.regions.every(s=>matches(image,s,assets)))return hold;
  rows.push({row:row.row,phase:'in_transit'});
 }
 // Destination cards change between trips; countdown digits never drive idle churn.
 const journeyHash=digest(Buffer.concat(profile.rows.map(r=>cropPng(image,r.journeyBox))));
 return {supported:true,...(registration.localization?{localization:registration.localization}:{}),profileHash:hash,journeyHash,rows,executionAllowed:false};
}
