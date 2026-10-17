import {readFileSync} from 'node:fs';
import {decodePng,digest} from './adb.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {helicopterProfile} from './mumu-helicopter-proof.mjs';
import {validUnambiguousNavigationPins} from './mumu-continuity.mjs';

const root=new URL('../reference/helicopter-selected-pin-native-1578/',import.meta.url);
const fraction=v=>Number.isFinite(v)&&v>=0&&v<=1;
const box=(f,w,h)=>{
  if(!f||!Object.values(f).every(fraction)||f.width<=0||f.height<=0||f.x+f.width>1||f.y+f.height>1)throw Error('HELICOPTER_SELECTION_MARKER_REGISTRATION_REQUIRED');
  return {x:Math.round(f.x*w),y:Math.round(f.y*h),width:Math.round(f.width*w),height:Math.round(f.height*h)};
};
// No cache: release identity binds profile JSON; each use verifies the mask bytes.
export function helicopterSelectionMarkerRegistration(){
  const bytes=readFileSync(new URL('profile.json',root)),profile=JSON.parse(bytes);
  if(profile.schema!==1||profile.kind!=='bilateral_outer_selection_halo'||profile.provider!=='google_play_windows'||
      profile.dimensions?.width!==1578||profile.dimensions?.height!==1268||profile.mask.file!=='outer-rim-mask.png')throw Error('HELICOPTER_SELECTION_MARKER_REGISTRATION_REQUIRED');
  const maskBytes=readFileSync(new URL(profile.mask.file,root));
  if(digest(maskBytes)!==profile.mask.sha256)throw Error('HELICOPTER_SELECTION_MARKER_ASSET_CHANGED');
  const mask=decodePng(maskBytes),w=Math.round(profile.cropFraction.width*profile.dimensions.width),h=Math.round(profile.cropFraction.height*profile.dimensions.height);
  if(mask.width!==w||mask.height!==h||profile.bands.length!==2||!Object.values(profile.pinAnchor).every(fraction))throw Error('HELICOPTER_SELECTION_MARKER_REGISTRATION_REQUIRED');
  const bands=profile.bands.map(f=>box(f,w,h));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const expected=bands.some(b=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height)?255:0;
    for(let c=0;c<3;c++)if(mask.pixels[(y*w+x)*mask.channels+c]!==expected)throw Error('HELICOPTER_SELECTION_MARKER_MASK_REQUIRED');
  }
  return {profile,hash:digest(bytes),mask,bands};
}

// Scheduling evidence only. Never creates input, order identity, stock or result proof.
export function detectHelicopterSelectionMarker(frame,evidence,analysis,registration=helicopterSelectionMarkerRegistration()){
  const {profile:p,hash,bands,mask}=registration;
  const held=reason=>({status:'hold',reason,mapId:null,frameId:frame?.id,evidenceHash:frame?.evidenceHash,profileHash:hash,scores:[]});
  if(frame?.provider!==p.provider||typeof frame.serial!=='string'||!frame.serial||frame.width!==p.dimensions.width||frame.height!==p.dimensions.height||!frame.captureTarget||
      frame.captureTarget.bounds?.width!==frame.width||frame.captureTarget.bounds?.height!==frame.height)return held('HELICOPTER_SELECTION_MARKER_GEOMETRY_REQUIRED');
  const current=helicopterProfile(frame);
  if(current.hash!==p.helicopterProfileHash||frame.review?.proof?.profileHash!==current.hash||analysis?.helicopterProfileHash!==current.hash||
      JSON.stringify(box(p.viewportFraction,frame.width,frame.height))!==JSON.stringify(current.profile.coordinateSpace.viewport))return held('HELICOPTER_SELECTION_MARKER_PROFILE_CHANGED');
  if(!acceptedFacts(frame)||frame.review.actualKind!=='helicopter'||!Buffer.isBuffer(evidence?.bytes)||digest(evidence.bytes)!==frame.evidenceHash||
      analysis?.status!=='candidate'||analysis.scene?.kind!=='helicopter'||analysis.frameId!==frame.id||analysis.evidenceHash!==frame.evidenceHash||
      analysis.epoch!==frame.epoch||analysis.sequence!==frame.sequence||analysis.observedAt!==frame.observedAt||
      !validUnambiguousNavigationPins(analysis.mapTargets)||!analysis.mapTargets.length)return held('HELICOPTER_SELECTION_MARKER_SOURCE_REQUIRED');
  const image=decodePng(evidence.bytes);
  if(image.width!==frame.width||image.height!==frame.height)return held('HELICOPTER_SELECTION_MARKER_GEOMETRY_REQUIRED');
  const viewport=current.profile.coordinateSpace.viewport,c=p.color,s=p.support;
  const scores=analysis.mapTargets.map(pin=>{
    const crop={x:Math.round(pin.box.x+pin.box.width/2-p.pinAnchor.x*mask.width),y:Math.round(pin.box.y+pin.box.height/2-p.pinAnchor.y*mask.height),width:mask.width,height:mask.height};
    if(crop.x<viewport.x||crop.y<viewport.y||crop.x+crop.width>viewport.x+viewport.width||crop.y+crop.height>viewport.y+viewport.height)return {mapId:pin.mapId,matched:false,sides:[]};
    const sides=bands.map(b=>{
      let pixels=0,rows=0,run=0,longestRun=0;const thirds=[0,0,0];
      for(let y=0;y<b.height;y++){
        let hits=0;for(let x=0;x<b.width;x++){
          const i=((crop.y+b.y+y)*image.width+crop.x+b.x+x)*image.channels,r=image.pixels[i],g=image.pixels[i+1],blue=image.pixels[i+2];
          if(r>c.redAbove&&g>c.greenAbove&&blue>c.blueAbove&&r-blue>c.redMinusBlueAbove)hits++;
        }
        pixels+=hits;if(hits>=s.minimumPixelsPerRow){rows++;run++;thirds[Math.min(2,Math.floor(3*y/b.height))]++;}else run=0;
        longestRun=Math.max(longestRun,run);
      }
      return {pixels,rows,longestRun,thirds,matched:pixels>=s.minimumPixels&&rows>=s.minimumRows&&longestRun>=s.minimumRun&&thirds.filter(n=>n>=s.minimumThirdRows).length>=s.minimumThirds};
    });
    return {mapId:pin.mapId,matched:sides.every(x=>x.matched),sides,cropFraction:{x:crop.x/frame.width,y:crop.y/frame.height,width:crop.width/frame.width,height:crop.height/frame.height}};
  });
  const selected=scores.filter(s=>s.matched);
  return {...held(selected.length>1?'HELICOPTER_SELECTION_MARKER_AMBIGUOUS':'HELICOPTER_SELECTION_MARKER_NOT_VISIBLE'),
    ...(selected.length===1?{status:'selected',reason:null,mapId:selected[0].mapId}:{}),scores};
}
