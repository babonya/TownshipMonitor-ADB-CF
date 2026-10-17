import {resolvePercentageProfile} from './percentage-profile.mjs';
// Fixed HUD shortcuts and one registered airport building in this town view.
// Building recognition allows bounded illumination; immediate source/preflight
// comparison still uses the existing stricter navigation verification contract.
import {readFileSync} from 'node:fs';
import {digest,decodePng} from './adb.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
import {readTrainIdle,trainIdleProfile} from './mumu-train-idle.mjs';
import {readTrainRewards,trainRewardProfile} from './mumu-train-reward-proof.mjs';
import {readTrainLoading,trainLoadingProfile,trainLoadingRow} from './mumu-train-loading-proof.mjs';
import {readAirportLoading,airportLoadingProfile,airportCase} from './mumu-airport-loading-proof.mjs';
import {readAirportIdle,airportIdleProfile} from './mumu-airport-idle.mjs';
import {helicopterProfile} from './mumu-helicopter-proof.mjs';
import {gameTransform,nativeBox} from './windows-coordinate-space.mjs';
import {cropPng} from './png-crop.mjs';
import {locateNavigationCore,boundNavigationOriginal} from './mumu-navigation-locator.mjs';
export function transportNavigationProfile(context,issuedSourceHash=null){
 const windows=context?.provider==='google_play_windows';
 if(issuedSourceHash!==null&&(!windows||!/^[a-f0-9]{64}$/.test(issuedSourceHash)))throw Error('TRANSPORT_NAVIGATION_PROFILE_CHANGED');
 const file=new URL(windows?'../reference/image-matching/google-play/transport-navigation/'+(issuedSourceHash?'profile-'+issuedSourceHash+'.json':'profile.json'):'../reference/transport-navigation/profile.json',import.meta.url);
 const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes)),assets=new Map();
 if(issuedSourceHash&&digest(bytes)!==issuedSourceHash)throw Error('TRANSPORT_NAVIGATION_PROFILE_CHANGED');
 if(profile.schema!==1||windows&&profile.provider!==context.provider)throw Error('TRANSPORT_NAVIGATION_PROFILE_CHANGED');
 if(!issuedSourceHash&&(profile.navigationLocationVersion!==1||[...profile.town.shortcuts.map(t=>t.spec),...Object.values(profile.panels??{}).map(p=>p.close)].some(s=>s.locator?.schema!==1)))throw Error('NAVIGATION_LOCATOR_REGISTRATION_REQUIRED');
 if(windows)for(const spec of [...profile.town.anchors,...profile.town.shortcuts.map(t=>t.spec)]){
  if(!spec.coordinate||JSON.stringify(spec.box)!==JSON.stringify(nativeBox(spec.coordinate.fraction,gameTransform({...profile.coordinateSpace,alignY:spec.coordinate.alignY}))))throw Error('NAVIGATION_COORDINATE_MAP_CHANGED');
 }
 for(const a of profile.assets){if(a.file!==a.file.split(/[\\/]/).at(-1))throw Error('NAVIGATION_ASSET_CHANGED');
  const bytes=readFileSync(new URL(a.file,file));if(digest(bytes)!==a.sha256)throw Error('NAVIGATION_ASSET_CHANGED');assets.set(a.file,decodePng(bytes));}
 return {profile,assets,hash:digest(bytes)};
}
export function navigationRegionMatches(image,spec,template){
 const b=spec.box;if(b.x<0||b.y<0||b.width<1||b.height<1||b.x+b.width>image.width||b.y+b.height>image.height||!template||template.width!==b.width||template.height!==b.height)return false;
 const n=b.width*b.height,sa=[0,0,0],sb=[0,0,0],aa=[0,0,0],bb=[0,0,0],ab=[0,0,0];let changed=0;
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
  const p=((y+b.y)*image.width+x+b.x)*image.channels,q=(y*b.width+x)*template.channels;let different=false;
  for(let c=0;c<3;c++){const a=template.pixels[q+c],v=image.pixels[p+c];if(a!==v)different=true;sa[c]+=a;sb[c]+=v;aa[c]+=a*a;bb[c]+=v*v;ab[c]+=a*v;}if(different)changed++;
 }
 if(spec.mode!=='illumination')return changed===0;
 let va=0,vb=0,cov=0,delta=0;
 for(let c=0;c<3;c++){va+=aa[c]-sa[c]*sa[c]/n;vb+=bb[c]-sb[c]*sb[c]/n;cov+=ab[c]-sa[c]*sb[c]/n;delta=Math.max(delta,Math.abs(sa[c]-sb[c])/n);}
 const stdA=Math.sqrt(Math.max(0,va)/(n*3)),stdB=Math.sqrt(Math.max(0,vb)/(n*3)),ratio=stdB/stdA,corr=cov/Math.sqrt(va*vb);
 return stdA>=10&&stdB>=10&&ratio>=.85&&ratio<=1.15&&corr>=.99&&delta<=24;
}
export function transportNavigationTargets(kind,reg=transportNavigationProfile(),image=null){
 const p=reg.profile;
 const located=spec=>image?locateNavigationCore(image,spec,reg.assets.get(spec.file),navigationRegionMatches):spec.locator?null:spec.box;
 if(kind==='town')return p.town.shortcuts.map(t=>({...t,located:located(t.spec)})).filter(t=>t.located).map(t=>({id:'transport-nav:'+t.kind,kind:'open_'+t.kind,type:'tap',box:t.located,
  transportNavigation:{from:'town',to:t.kind},verification:{version:1,anchorBoxes:p.town.anchors.map(a=>a.box),targetRegions:[t.spec.box],
    ...(t.kind==='helicopter'?{criticalRegions:[{field:'helicopter_readiness',box:{...p.town.ready.box,x:p.town.ready.box.x+t.located.x-t.spec.box.x,y:p.town.ready.box.y+t.located.y-t.spec.box.y}}]}:{}),channelTolerance:t.kind==='airport'?12:0,maxChangedRatio:t.kind==='airport'?.03:0}})).map(t=>({...t,verification:{...t.verification,targetRegions:[t.box]}}));
 const panel=p.panels?.[kind],close=panel&&located(panel.close);
 return close?[{id:'transport-close:'+kind,kind:'close_panel',type:'tap',box:close,transportNavigation:{from:kind,to:'town'},
  verification:{version:1,anchorBoxes:panel.anchors.map(a=>a.box),targetRegions:[close],channelTolerance:0,maxChangedRatio:0}}]:[];
}
export function readTransportNavigation(image,kind,registration=transportNavigationProfile()){
 const no=reason=>({supported:false,kind,reason,executionAllowed:false});
 if(image.width!==registration.profile.dimensions.width||image.height!==registration.profile.dimensions.height||image.channels<3)return no('NAVIGATION_LAYOUT_REQUIRED');
 const {profile,assets}=registration,match=s=>navigationRegionMatches(image,s,assets.get(s.file));
 if(kind==='town'){
  if(!profile.town.anchors.every(match))return no('REGISTERED_TOWN_VIEW_REQUIRED');
  const views=[{map:profile.town.map,availableKinds:profile.town.shortcuts.map(t=>t.kind)},...(profile.town.mapAlternatives??[])];
  const visible=views.filter(view=>view.map.every(match));
  if(!visible.length)return no('REGISTERED_TOWN_VIEW_REQUIRED');
  const kinds=new Set(visible.flatMap(view=>view.availableKinds));
  // A changed shortcut withholds only that control. Static town geometry still
  // identifies the scene; every offered target must independently match.
  const targets=transportNavigationTargets(kind,registration,image).filter(t=>kinds.has(t.transportNavigation.to));
  const available=new Set(targets.map(t=>t.transportNavigation.to));
  const arrivalIndicators={};
  for(const [transport,indicator] of Object.entries(profile.town.arrivalIndicators??{})){
   if(!available.has(transport))continue;
   let ready=false;
   if(indicator.regions)ready=indicator.regions.every(match);
   else if(indicator.region&&indicator.searchBox){
    const s=indicator.region,b=indicator.searchBox;
    for(let y=b.y;!ready&&y<=b.y+b.height-s.box.height;y++)for(let x=b.x;!ready&&x<=b.x+b.width-s.box.width;x++)
     ready=navigationRegionMatches(image,{...s,box:{...s.box,x,y}},assets.get(s.file));
   }
   arrivalIndicators[transport]=ready?{state:'ready',token:indicator.tokenBox?digest(cropPng(image,indicator.tokenBox)):'present'}:
    {state:indicator.absent&&match(indicator.absent)?'absent':'unknown',token:'absent'};
  }
  const heli=targets.find(t=>t.transportNavigation.to==='helicopter'),readyBox=heli?.verification.criticalRegions[0].box;
  return {supported:true,kind,helicopterReady:!!readyBox&&navigationRegionMatches(image,{...profile.town.ready,box:readyBox},assets.get(profile.town.ready.file)),arrivalIndicators,targets,executionAllowed:false};
 }
 const panel=profile.panels?.[kind],anchorSets=panel?[panel.anchors,...(panel.anchorAlternatives??[])]:[];
 const targets=panel&&anchorSets.some(anchors=>
   JSON.stringify(anchors.map(a=>a.box))===JSON.stringify(panel.anchors.map(a=>a.box))&&anchors.every(match))?transportNavigationTargets(kind,registration,image):[];
 if(kind==='train'&&(readTrainIdle(image,trainIdleProfile(profile)).supported||readTrainRewards(image,trainRewardProfile(profile)).supported||readTrainLoading(image,trainLoadingProfile(profile)).supported||profile.provider==='google_play_windows'&&panel&&panel.anchors.every(match)))return {supported:true,kind,targets,executionAllowed:false};
 // Header and close identify the navigation destination independently of cargo
 // recognition. A arrived plane may still require an order-recognition hold.
 if(kind==='airport'&&(readAirportIdle(image,airportIdleProfile(profile)).supported||panel&&match(panel.anchors[0])&&targets.length>0))return {supported:true,kind,targets,
  activity:panel.activeCaption&&match(panel.activeCaption)?'loading':null,executionAllowed:false};
 if(kind==='helicopter'&&profile.provider==='google_play_windows')return panel&&panel.anchors.every(match)?{supported:true,kind,targets,executionAllowed:false}:no('REGISTERED_NAVIGATION_DESTINATION_REQUIRED');
 if(kind==='helicopter'){
  const {profile:p}=helicopterProfile();const pass=p.anchors.every(a=>navigationRegionMatches(image,{box:a.sourceBox},decodePng(readFileSync(new URL('../reference/image-matching/helicopter/'+a.file,import.meta.url)))));
  if(pass)return {supported:true,kind,targets,executionAllowed:false};
 }
 return no('REGISTERED_NAVIGATION_DESTINATION_REQUIRED');
}
export function validateTransportNavigationProof(frame,issuedSourceRegistration=null){
 if(frame.review?.reviewedBy!=='program-transport-navigation')return;
 const r=frame.review,p=r.proof,reg=issuedSourceRegistration??transportNavigationProfile(frame);
 const dynamic=r.actualKind==='town'?reg.profile.town.shortcuts.some(t=>t.spec.locator):!!reg.profile.panels?.[r.actualKind]?.close.locator;
 const allowed=dynamic&&p.role==='source'?readTransportNavigation(boundNavigationOriginal(frame),r.actualKind,reg).targets??[]:transportNavigationTargets(r.actualKind,reg);
 const expected=r.actualKind==='town'?allowed.filter(t=>r.targets.some(s=>JSON.stringify(s)===JSON.stringify(t))):allowed;
 if(!acceptedFacts(frame)||p.profileHash!==reg.hash||p.reviewHash!==reviewFactHash(r)||r.actualEntityId!==null||JSON.stringify(r.data)!=='{}'||
  (p.role==='source'?!expected.length||JSON.stringify(r.targets)!==JSON.stringify(expected):
   p.role!=='result'||!['helicopter','train','airport','town'].includes(r.actualKind)||r.targets.length!==0||p.navigationResult?.confirmed!==true||p.navigationResult?.frameId!==frame.id))throw Error('TRANSPORT_NAVIGATION_PROOF_CHANGED');
}
export function verifyTransportNavigationPreflight(frame,image,target,sourceImage){
 validateTransportNavigationProof(frame);
 const current=readTransportNavigation(image,target.transportNavigation?.from,transportNavigationProfile(frame));
 if(frame.review?.reviewedBy!=='program-transport-navigation'||frame.review.proof.role!=='source'||
  !current.supported||!current.targets.some(t=>JSON.stringify(t)===JSON.stringify(target))||
  !frame.review.targets.some(t=>JSON.stringify(t)===JSON.stringify(target)))throw Error('NAVIGATION_TARGET_CHANGED');
 if(target.transportNavigation.from==='town'&&sourceImage){
  const before=readTransportNavigation(sourceImage,'town',transportNavigationProfile(frame)).arrivalIndicators?.[target.transportNavigation.to];
  if(before&&before.state!=='unknown'&&JSON.stringify(before)!==JSON.stringify(current.arrivalIndicators?.[target.transportNavigation.to]))throw Error('NAVIGATION_TARGET_CHANGED');
 }
 if(target.kind==='close_panel'&&target.transportNavigation.from==='airport'){
  if(!sourceImage)throw Error('NAVIGATION_SOURCE_IMAGE_REQUIRED');
  const registration=airportLoadingProfile(frame),before=readAirportLoading(sourceImage,registration);
  if(before.supported){const after=readAirportLoading(image,registration);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('NAVIGATION_TARGET_CHANGED');
   const c=airportCase(before,registration);for(const spec of [...registration.profile.anchors,...c.regions,...(c.load?[c.load]:[]),...(c.field?[c.field]:[])]){
    const b=spec.box;for(let y=b.y;y<b.y+b.height;y++)for(let x=b.x;x<b.x+b.width;x++)for(let k=0;k<3;k++)if(sourceImage.pixels[(y*sourceImage.width+x)*sourceImage.channels+k]!==image.pixels[(y*image.width+x)*image.channels+k])throw Error('NAVIGATION_TARGET_CHANGED');
   }
  }
 }
 if(target.kind==='close_panel'&&target.transportNavigation.from==='train'){
  if(!sourceImage)throw Error('NAVIGATION_SOURCE_IMAGE_REQUIRED');
  const before=readTrainLoading(sourceImage,trainLoadingProfile(frame));
  if(before.supported&&!before.departed){
   const after=readTrainLoading(image,trainLoadingProfile(frame));
   if(JSON.stringify(before)!==JSON.stringify(after))throw Error('NAVIGATION_TARGET_CHANGED');
   const {profile}=trainLoadingProfile(frame),row=trainLoadingRow(profile,before),popup=profile.popups.find(p=>p.id===before.popupId);
   const boxes=[...row.slots.flatMap(s=>[s.body,s.item,s.quantity,...(s.quantityAlternatives??[])]),...row.loaded.flatMap(s=>s.regions),
    ...(popup?[...popup.anchors,popup.item,popup.load,popup.field]:row.bareAnchors??[])].map(s=>s.box);
   for(const b of boxes)for(let y=b.y;y<b.y+b.height;y++)for(let x=b.x;x<b.x+b.width;x++)for(let c=0;c<3;c++)
    if(sourceImage.pixels[(y*sourceImage.width+x)*sourceImage.channels+c]!==image.pixels[(y*image.width+x)*image.channels+c])throw Error('NAVIGATION_TARGET_CHANGED');
  }
 }
}
