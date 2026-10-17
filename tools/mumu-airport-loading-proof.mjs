import {resolvePercentageProfile} from './percentage-profile.mjs';
import {transportAbbreviation} from './mumu-transport-id.mjs';
// Exact saved airport layouts. Hidden crates never establish original demand.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodePng,digest,regionDigest} from './adb.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {matchRegisteredRegion,compareImageRegion} from './mumu-region-match.mjs';
import {airportItemRegions} from './mumu-item-regions.mjs';
import {orderSignature,orderDisposition} from './mumu-order-policy.mjs';
import {gameTransform,nativeBox} from './windows-coordinate-space.mjs';
import {validateProductDependencies} from './mumu-product-recognition.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function airportLoadingProfile(context,issuedSourceHash=null){
 const native=context?.provider==='google_play_windows';
 if(issuedSourceHash!==null&&(!native||!/^[a-f0-9]{64}$/.test(issuedSourceHash)))throw Error('AIRPORT_LOADING_PROFILE_CHANGED');
 const file=new URL(native?'../reference/image-matching/google-play/airport-loading/'+(issuedSourceHash?'profile-'+issuedSourceHash+'.json':'profile.json'):'../reference/airport-loading/profile.json',import.meta.url);
 const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes),{historical:!!issuedSourceHash}),assets=new Map();
 if(profile.schema!==1||profile.identityMode!=='product_list'||profile.originalNeeds.length!==9||native&&profile.provider!==context.provider||issuedSourceHash&&digest(bytes)!==issuedSourceHash)throw Error('AIRPORT_LOADING_PROFILE_CHANGED');
 if(native)for(const b of profile.coordinateBindings)if(!same(nativeBox(b.fraction,gameTransform(profile.coordinateSpace)),b.box))throw Error('AIRPORT_LOADING_COORDINATE_CHANGED');
 for(const a of profile.assets){if(a.file!==a.file.split(/[\\/]/).at(-1))throw Error('AIRPORT_LOADING_ASSET_CHANGED');const b=readFileSync(join(dirname(fileURLToPath(file)),a.file));if(digest(b)!==a.sha256)throw Error('AIRPORT_LOADING_ASSET_CHANGED');assets.set(a.file,decodePng(b));}
 return {profile,assets,hash:digest(bytes)};
}
function matches(image,spec,assets){
 const t=assets.get(spec.file),b=spec.box;if(!t||t.width!==b.width||t.height!==b.height)return false;
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){const p=((b.y+y)*image.width+b.x+x)*image.channels,q=(y*t.width+x)*t.channels;for(let c=0;c<3;c++)if(image.pixels[p+c]!==t.pixels[q+c])return false;}return true;
}
export function readAirportLoading(image,registration=airportLoadingProfile()){
 if(registration.profile.provider==='google_play_windows'&&(image.width!==registration.profile.dimensions.width||image.height!==registration.profile.dimensions.height))return {supported:false,reason:'AIRPORT_LOADING_GEOMETRY_EVIDENCE_REQUIRED',observedDimensions:{width:image.width,height:image.height},registeredDimensions:registration.profile.dimensions,executionAllowed:false};
 const {profile,assets}=registration,hold=reason=>({supported:false,reason,executionAllowed:false});
 if(image.width!==(profile.dimensions?.width??1600)||image.height!==(profile.dimensions?.height??900)||image.channels<3||!profile.anchors.every(a=>matches(image,a,assets)))return hold('AIRPORT_LOADING_LAYOUT_REQUIRED');
 const candidates=[...profile.bare,...profile.popups].filter(c=>c.regions.every(s=>
  matchRegisteredRegion(image,s,assets.get(s.file),{icons:airportItemRegions(profile,c,s.box)})));
 if(candidates.length!==1)return hold('AIRPORT_REGISTERED_CRATES_REQUIRED');
 const c=candidates[0];return {supported:true,caseId:c.id,layoutId:profile.layoutId,stage:c.stage,loadedSlots:c.loadedSlots,
  selectedCrate:c.slotId??null,popupId:c.slotId?c.id:null,field:c.field??null,
  freeLoad:!!c.load&&matches(image,c.load,assets),executionAllowed:false};
}
export function airportCase(reading,registration=airportLoadingProfile()){return [...registration.profile.bare,...registration.profile.popups].find(c=>c.id===reading.caseId);}
export function airportLoadingTargets(reading,data,registration=airportLoadingProfile()){
 const {profile}=registration,c=airportCase(reading,registration),n=data.order.needs.find(n=>n.slotId===reading.selectedCrate),targets=[];
 if(!data.airport.fullDemandConfirmed||data.order.disposition!=='deliver')return targets;
 const v=box=>({version:1,anchorBoxes:profile.anchors.map(a=>a.box),targetRegions:[box],maxChangedRatio:0,channelTolerance:0,
  criticalRegions:reading.selectedCrate?[{field:'stock',box:c.field.box}]:[]});
 if(n&&reading.freeLoad&&Number.isSafeInteger(n.owned)&&n.owned>=n.required&&profile.loadTransitions.some(t=>t.popupId===reading.popupId))
  targets.push({id:'airport-load:'+n.slotId,kind:'load_airport',type:'tap',box:c.load.box,
   management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',itemId:n.itemId,required:n.required,owned:n.owned,orderId:data.order.orderId,slotId:n.slotId,layoutId:reading.layoutId},verification:v(c.load.box)});
 if(!reading.selectedCrate){
  for(const dest of profile.popups.filter(p=>p.stage===reading.stage))targets.push({id:'airport-detail:'+dest.slotId,kind:'inspect_item',type:'tap',box:dest.target,
   airportDetail:{caseId:dest.id,slotId:dest.slotId,itemId:dest.itemId,orderId:data.order.orderId,layoutId:reading.layoutId},verification:v(dest.target)});
 }else targets.push({id:'airport-detail:dismiss',kind:'inspect_item',type:'tap',box:profile.dismiss.box,
  airportDetail:{caseId:'bare'+reading.stage,slotId:null,itemId:null,orderId:data.order.orderId,layoutId:reading.layoutId},verification:v(profile.dismiss.box)});
 return targets;
}
export function validateAirportLoadingProof(frame,registration=airportLoadingProfile(frame)){
 if(frame.review?.reviewedBy!=='program-airport-loading')return;
 validateProductDependencies(frame.review.proof?.productRecognition);
 const r=frame.review,p=r.proof,data=r.data,a=data.airport;
 const c=airportCase({caseId:a?.caseId},registration),full=a?.fullDemandConfirmed;
 if(!acceptedFacts(frame)||p.profileHash!==registration.hash||p.reviewHash!==reviewFactHash(r)||r.actualKind!=='airport'||!c||
  a.layoutId!==registration.profile.layoutId||a.stage!==c.stage||data.order?.identityMode!=='product_list'||data.order.transport!=='plane'||data.order.kind!=='normal'||!same(a.loadedSlots,c.loadedSlots)||a.selectedCrate!==(c.slotId??null)||
  (full?data.order.orderConfirmed!==true||!same(a.originalNeeds,registration.profile.originalNeeds)||!a.origin:
   full!==false||data.order.orderConfirmed!==false||data.order.disposition!=='hold'||a.originalNeeds!==null||a.origin!==null||r.targets.length))throw Error('AIRPORT_LOADING_PROOF_CHANGED');
 if(full){
  const o=a.origin,time=Date.parse(o.observedAt),deadline=Date.parse(data.order.deadline);
  if(typeof o.frameId!=='string'||!o.frameId||!/^[a-f0-9]{64}$/.test(o.evidenceHash??'')||!Number.isSafeInteger(o.sequence)||o.sequence<0||o.sequence>frame.sequence||
   !Number.isFinite(time)||time>Date.parse(frame.observedAt)||
   (a.timingMode==='visual_change'?data.order.deadline!==undefined||data.order.remainingSeconds!==undefined:!Number.isFinite(deadline)||deadline<time)||
   (o.frameId===frame.id&&(o.evidenceHash!==frame.evidenceHash||o.sequence!==frame.sequence||o.observedAt!==frame.observedAt))||
   ![transportAbbreviation('plane'),'airport'].some(prefix=>data.order.orderId===prefix+':'+digest(Buffer.from(JSON.stringify({origin:o,layout:a.layoutId}))).slice(0,40))||
   data.order.signature!==orderSignature(registration.profile.originalNeeds)||data.order.disposition!==orderDisposition(registration.profile.originalNeeds))throw Error('AIRPORT_ORIGIN_CHANGED');
 }
 const expected=!full&&c.slotId?registration.profile.originalNeeds.filter(n=>n.slotId===c.slotId):registration.profile.originalNeeds.filter(n=>!a.loadedSlots.includes(n.slotId));
 if(!same(data.order.needs.map(({slotId,itemId,required})=>({slotId,itemId,required})),expected))throw Error('AIRPORT_DEMAND_CHANGED');
 const reading={supported:true,caseId:c.id,popupId:c.slotId?c.id:null,selectedCrate:c.slotId??null,stage:c.stage,layoutId:a.layoutId,freeLoad:a.freeLoad};
 if(!same(r.targets,airportLoadingTargets(reading,data,registration)))throw Error('AIRPORT_TARGET_CHANGED');
}
export function verifyAirportLoadingPreflight(frame,image,target,oldImage){
 validateAirportLoadingProof(frame);if(frame.review?.reviewedBy!=='program-airport-loading')throw Error('AIRPORT_LOADING_SCOPE_REQUIRED');
 const registration=airportLoadingProfile(frame),r=readAirportLoading(image,registration),a=frame.review.data.airport;
 if(!r.supported||r.caseId!==a.caseId||!frame.review.targets.some(t=>same(t,target))||target.kind==='load_airport'&&!r.freeLoad)throw Error('NAVIGATION_TARGET_CHANGED');
 const c=airportCase(r,registration);
 for(const s of [...registration.profile.anchors,...c.regions,...c.load?[c.load]:[]])
  if(!compareImageRegion(oldImage,image,s.box,airportItemRegions(registration.profile,c,s.box)).matched)throw Error('NAVIGATION_TARGET_CHANGED');
 if(c.field&&regionDigest(image,c.field.box)!==regionDigest(oldImage,c.field.box))throw Error('NAVIGATION_TARGET_CHANGED');
}

// A crate consumes only its own reserved stock. Other unknown products cannot
// erase that reservation; every other allocation hold still blocks the load.
export function airportAllocationAllowsCrate(order){
 return order?.transport==='plane'&&(['feasible','shortage'].includes(order.status)||order.status==='hold'&&Array.isArray(order.reasons)&&order.reasons.length>0&&order.reasons.every(r=>r==='STOCK_UNKNOWN_OR_STALE'));
}
