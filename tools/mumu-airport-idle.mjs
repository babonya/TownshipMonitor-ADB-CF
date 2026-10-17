import {resolvePercentageProfile} from './percentage-profile.mjs';
import {localizeIdleRegistration} from './mumu-idle-localization.mjs';
// Current airplane absence only. Future preview icons never become demand/stock.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng} from './adb.mjs';
import {cropPng} from './png-crop.mjs';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function airportIdleProfile(context){
 const current=context?.provider==='google_play_windows'&&(context.width??context.windowsCaptureSize?.width)===1578&&(context.height??context.windowsCaptureSize?.height)===1268;
 const file=new URL(current?'../reference/image-matching/google-play/current-1578/airport-idle/profile.json':context?.provider==='google_play_windows'?'../reference/image-matching/google-play/airport-idle/profile.json':'../reference/airport-idle/profile.json',import.meta.url);
 const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes)),assets=new Map();
 if(profile.schema!==1||!Array.isArray(profile.regions)||profile.regions.length!==8)throw Error('AIRPORT_IDLE_PROFILE_CHANGED');
 for(const a of profile.assets){
  if(a.file!==a.file.split(/[\\/]/).at(-1))throw Error('AIRPORT_IDLE_ASSET_CHANGED');
  const b=readFileSync(join(dirname(fileURLToPath(file)),a.file));if(digest(b)!==a.sha256)throw Error('AIRPORT_IDLE_ASSET_CHANGED');assets.set(a.file,decodePng(b));
 }
 return {profile,assets,hash:digest(bytes)};
}
function matches(image,spec,assets){
 const b=spec.box,t=assets.get(spec.file);if(!t||t.width!==b.width||t.height!==b.height)return false;
 let changed=0;for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const p=((b.y+y)*image.width+b.x+x)*image.channels,q=(y*t.width+x)*t.channels;
  if([0,1,2].some(c=>Math.abs(image.pixels[p+c]-t.pixels[q+c])>12))changed++;
 }return changed/(b.width*b.height)<=.03;
}
export function readAirportIdle(image,registration=airportIdleProfile()){
 registration=localizeIdleRegistration(image,registration);if(!registration)return {supported:false,reason:'AIRPORT_IDLE_LOCALIZATION_REQUIRED',executionAllowed:false};
 const {profile,assets,hash}=registration;
 if(image.width!==(profile.dimensions?.width??1600)||image.height!==(profile.dimensions?.height??900)||image.channels<3||![...profile.anchors,...profile.regions.filter(s=>s.file!=='units.png')].every(s=>matches(image,s,assets)))
  return {supported:false,reason:'AIRPORT_RETURN_PANEL_REQUIRED',executionAllowed:false};
 return {supported:true,...(registration.localization?{localization:registration.localization}:{}),profileHash:hash,journeyHash:digest(cropPng(image,profile.previewBox)),phase:'in_transit',
  rows:[1,2,3].map(row=>({row,phase:'empty'})),executionAllowed:false};
}
