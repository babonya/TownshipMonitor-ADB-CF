// Product coverage and proof from the same hash-bound market registration.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {digest,decodePng,regionDigest,validateBox} from './adb.mjs';
import {capacitySufficient} from './mumu-market-capacity.mjs';
export function validateMarketScreenshots(profile,assets,directory){
  const registration=profile.screenshotProducts;if(registration===undefined)return;
  const fail=()=>{throw Error('MARKET_SCREENSHOT_REGISTRATION_INVALID');};
  if(registration.schema!==1||!Array.isArray(registration.templates))fail();
  const ids=new Set(),sources=new Map();
  for(const t of registration.templates){
    const s=t.source,d=t.dimensions,r=s?.region;
    if(!t.templateId||ids.has(t.templateId)||!t.itemId||t.scene!=='market'||s?.identityReviewedBy!=='AI'||!s.frameId||
      !s.file||s.file!==s.file.split(/[\\/]/).at(-1)||s.dimensions?.width!==d?.width||s.dimensions?.height!==d?.height||
      !profile.layouts.some(l=>l.id===t.layoutId&&l.dimensions.width===d.width&&l.dimensions.height===d.height)||
      !Number.isFinite(t.minimumScore)||t.minimumScore<.9||t.minimumScore>1||!Number.isFinite(t.minimumMargin)||t.minimumMargin<.05||t.minimumMargin>1||
      !profile.assets.some(a=>a.file===t.file&&a.sha256===t.sha256))fail();
    ids.add(t.templateId);
    let source=sources.get(s.file);
    if(!source){const bytes=readFileSync(join(directory,s.file));source={hash:digest(bytes),image:decodePng(bytes)};sources.set(s.file,source);}
    if(source.hash!==s.sha256||source.image.width!==d.width||source.image.height!==d.height)fail();
    const b=validateBox(s.cropBox,d.width,d.height),icon=validateBox(s.iconBox,d.width,d.height),q=validateBox(s.quantityBox,d.width,d.height),template=assets.get(t.file);
    if(r?.space!=='registered_capture'||r.unit!=='fraction'||!['x','y','width','height'].every(k=>Number.isFinite(r[k])&&r[k]>=0&&r[k]<=1&&Math.round(r[k]*d[k==='x'||k==='width'?'width':'height'])===b[k])||
      b.x<icon.x||b.y<icon.y||b.x+b.width>icon.x+icon.width||b.y+b.height>Math.min(q.y,icon.y+icon.height)||
      !template||template.width!==b.width||template.height!==b.height||regionDigest(template)!==regionDigest(source.image,b))fail();
  }
}
export function marketScreenshotProducts(profile,dimensions){
  if(profile.screenshotProducts?.schema!==1||!dimensions)return [];
  const layouts=new Set(profile.layouts.filter(l=>l.dimensions.width===dimensions.width&&l.dimensions.height===dimensions.height&&
    l.executionEnabled===true&&l.nativeSourceResultRegistered===true).map(l=>l.id));
  return (profile.screenshotProducts.templates??[]).filter(t=>t.scene==='market'&&layouts.has(t.layoutId)&&
    t.dimensions.width===dimensions.width&&t.dimensions.height===dimensions.height&&t.source?.identityReviewedBy==='AI');
}
export function confirmedMarketScreenshot(row,layout,reg){
  const i=row?.identity;
  if(i?.status!=='matched'||i.identitySource!=='game_screenshot'||row.itemId!==i.itemId||i.layoutId!==layout.id||
    i.dimensions?.width!==layout.dimensions.width||i.dimensions?.height!==layout.dimensions.height)return false;
  const t=marketScreenshotProducts(reg.profile,layout.dimensions).find(t=>t.layoutId===layout.id&&t.templateId===i.templateId&&t.itemId===i.itemId);
  return !!t&&i.cropHash===t.sha256&&i.minimumScore===t.minimumScore&&i.minimumMargin===t.minimumMargin&&
    Number.isFinite(i.matchScore)&&i.matchScore>=t.minimumScore&&i.matchScore<=1&&
    Number.isFinite(i.scoreMargin)&&i.scoreMargin>=t.minimumMargin;
}
export function marketPurchaseHold(row,profile,capacity=null){
  if(profile.screenshotProductsOnly&&(!Number.isSafeInteger(row?.price)||row.price<1))return 'MARKET_PRICE_REQUIRED';
  if(profile.requirePurchaseCapacity===true){
    if(!capacity)return 'MARKET_CAPACITY_OBSERVATION_REQUIRED';
    if(!capacitySufficient(capacity,row?.quantity))return 'MARKET_BARN_SPACE_INSUFFICIENT';
  }
  return null;
}
