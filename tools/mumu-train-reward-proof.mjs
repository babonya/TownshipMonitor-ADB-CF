import {resolvePercentageProfile} from './percentage-profile.mjs';
// Registered returned construction/mining cargo only. No quantity is inferred
// from the persistent x2 carriage badge or the size of a pictured stack.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,decodePng} from './adb.mjs';
import {acceptedFacts,reviewFactHash} from './mumu-evidence.mjs';
export const PROTECTED_TRAIN_REWARDS=new Set(['wiki_glass','wiki_brick','wiki_slab','wiki_nail','wiki_shovel','wiki_hammer','wiki_paint','protected_tool_box']);
export function trainRewardProfile(context){
  const file=new URL(context?.provider==='google_play_windows'?'../reference/image-matching/google-play/train-rewards/profile.json':'../reference/train-rewards/profile.json',import.meta.url);
  const bytes=readFileSync(file),profile=resolvePercentageProfile(JSON.parse(bytes)),assets=new Map();
  for(const entry of profile.assets){
    if(entry.file!==entry.file.split(/[\\/]/).at(-1))throw Error('TRAIN_ASSET_CHANGED');
    const data=readFileSync(join(dirname(fileURLToPath(file)),entry.file));
    if(digest(data)!==entry.sha256)throw Error('TRAIN_ASSET_CHANGED');
    assets.set(entry.file,decodePng(data));
  }
  return {profile,assets,hash:digest(bytes)};
}
const sky=(r,g,b)=>b>=210&&g>=180&&g<=b&&r<=g;
function matches(image,spec,assets){
  const template=assets.get(spec.file),box=spec.box;
  if(!template||template.width!==box.width||template.height!==box.height)return false;
  let changed=0,total=0;
  for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++){
    const p=((box.y+y)*image.width+box.x+x)*image.channels,q=(y*box.width+x)*template.channels;
    if(spec.maskSky&&sky(...template.pixels.subarray(q,q+3)))continue;
    total++;
    if([0,1,2].some(c=>Math.abs(image.pixels[p+c]-template.pixels[q+c])>12))changed++;
  }
  return total>=20&&changed/(box.width*box.height)<=.03;
}
// Empty means that the entire registered cargo area contains only sky/cloud
// pixels. Any unregistered object, a dialog or a moving train leaves it unknown.
function clearCargo(image,spec,assets,{native=false}={}){
  // Native empty cargo requires its own original registration. Identity crops
  // alone cannot prove complete absence, so unsupported results stay pending.
  if(native)return false;
  const box=spec.box,template=assets.get(spec.file);
  let other=0;
  for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
    const p=(y*image.width+x)*image.channels,[r,g,b]=image.pixels.subarray(p,p+3);
    const q=((y-box.y)*box.width+x-box.x)*template.channels;
    if(!sky(...template.pixels.subarray(q,q+3))&&!sky(r,g,b))other++;
  }
  return other===0;
}
export function readTrainRewards(image,registration=trainRewardProfile()){
  const {profile,assets}=registration;
  if(image.width!==profile.dimensions.width||image.height!==profile.dimensions.height||image.channels<3||!profile.anchors.every(a=>matches(image,a,assets)))
    return {supported:false,reason:'TRAIN_REWARD_LAYOUT_REQUIRED',rows:[],targets:[]};
  const rows=[],targets=[];
  for(const row of profile.rows){
    const loading=[row.loading,...(row.loadingAlternatives??[])].some(regions=>Array.isArray(regions)&&regions.length>0&&regions.every(a=>matches(image,a,assets)));
    if(loading){rows.push({row:row.row,phase:'loading',carriages:[]});continue;}
    const layouts=[row,...(row.variants??[])].filter(layout=>layout.carriages.every(c=>matches(image,c.body,assets)));
    if(layouts.length!==1){rows.push({row:row.row,phase:'unknown',carriages:[]});continue;}
    const layout=layouts[0],binding=layout.id?{layoutId:layout.id}:{};
    const carriages=layout.carriages.map(c=>({id:`r${row.row}-c${c.carriage}`,carriage:c.carriage,
      referenceKey:matches(image,c.cargo,assets)?c.referenceKey:null,
      status:matches(image,c.cargo,assets)?'present':clearCargo(image,c.cargo,assets,{native:profile.provider==='google_play_windows'})?'empty':'unknown',
      quantity:null,quantityConfirmed:false}));
    rows.push({row:row.row,phase:'returned_cargo',...binding,carriages});
    if(profile.provider==='google_play_windows'){
      for(const sweep of profile.sweeps??[])if(sweep.row===row.row){
        const selected=layout.carriages.filter(c=>c.carriage>=sweep.first&&c.carriage<=sweep.last);
        if(selected.length!==sweep.last-sweep.first+1||selected.some(c=>carriages[c.carriage-1].status!=='present'))continue;
        const boxes=selected.map(c=>c.body.box),first=boxes[0],last=boxes.at(-1);
        const box={x:first.x,y:first.y,width:last.x+last.width-first.x,height:first.height};
        const swipe={x1:Math.floor(first.x+first.width/2),y1:Math.floor(first.y+first.height/2),x2:Math.floor(last.x+last.width/2),y2:Math.floor(last.y+last.height/2),durationMs:sweep.durationMs};
        targets.push({id:`train-reward-swipe:r${row.row}-c${sweep.first}-${sweep.last}:${layout.id}`,kind:'collect_train',type:'swipe',box,swipe,
          management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',source:'train_return',row:row.row,...binding,
            rewards:selected.map(c=>({carriage:c.carriage,referenceKey:c.referenceKey}))},
          verification:{version:1,anchorBoxes:profile.anchors.map(a=>a.box),targetRegions:boxes,criticalRegions:[]}});
      }
      continue;
    }
    for(const c of layout.carriages)if(carriages[c.carriage-1].status==='present')targets.push({
      id:`train-reward:r${row.row}-c${c.carriage}${layout.id?':'+layout.id:''}`,kind:'collect_train',type:'tap',box:c.body.box,
      management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',source:'train_return',
        row:row.row,carriage:c.carriage,rewardReferenceKey:c.referenceKey,...binding},
      verification:{version:1,anchorBoxes:profile.anchors.map(a=>a.box),targetRegions:[c.body.box],
        criticalRegions:[]}}); // Full masked cargo identity is checked on the immediate preflight below.
  }
  return {supported:true,rows,targets};
}
export function validateTrainRewardProof(frame){
  if(frame.review?.reviewedBy!=='program-train-reward')return;
  if(!acceptedFacts(frame)||frame.review.proof.profileHash!==trainRewardProfile(frame).hash||
      frame.review.proof.reviewHash!==reviewFactHash(frame.review))throw Error('TRAIN_REWARD_PROOF_CHANGED');
}
export function verifyTrainRewardPreflight(frame,freshImage,target){
  validateTrainRewardProof(frame);
  if(frame.review?.reviewedBy!=='program-train-reward')throw Error('TRAIN_REWARD_SCOPE_REQUIRED');
  const candidate=readTrainRewards(freshImage,trainRewardProfile(frame)).targets.find(t=>t.id===target.id);
  if(!candidate||JSON.stringify(candidate)!==JSON.stringify(target))throw Error('NAVIGATION_TARGET_CHANGED');
}
// Batch settlement is all-or-nothing. Every selected slot must have its own
// same-row absence proof; no partial completion can authorize another swipe.
export function validTrainRewardSwipe(target,command){
  const m=target?.management,r=m?.rewards,s=target?.swipe;
  return target?.kind==='collect_train'&&target.type==='swipe'&&m.programVerified===true&&m.source==='train_return'&&m.currency==='NONE'&&
    Array.isArray(r)&&r.length>=2&&r.length<=5&&[1,2,3].includes(m.row)&&typeof m.layoutId==='string'&&
    r.every((c,i)=>Number.isSafeInteger(c.carriage)&&c.carriage>=1&&c.carriage<=({1:5,2:5,3:4}[m.row])&&PROTECTED_TRAIN_REWARDS.has(c.referenceKey)&&(i===0||c.carriage===r[i-1].carriage+1))&&
    s&&Object.keys(s).sort().join(',')==='durationMs,x1,x2,y1,y2'&&Object.values(s).every(Number.isSafeInteger)&&s.y1===s.y2&&s.x1<s.x2&&s.durationMs>=200&&s.durationMs<=2000&&
    JSON.stringify(command)===JSON.stringify({type:'swipe',...s});
}
export function protectedTrainReceipt(state,action,effect){
  if(action?.target?.management?.rewards!==undefined){
    const target=action.target,m=target.management,before=state.frames?.[action.frameId],receipt=effect?.trainRewardReceipt;
    const expected={row:m.row,carriages:m.rewards,quantity:null,quantityConfirmed:false,resultCargoAbsent:true,ordinaryInventoryNotObserved:true};
    if(before?.provider!=='google_play_windows'||!validTrainRewardSwipe(target,action.command)||
      !before.review?.targets?.some(t=>JSON.stringify(t)===JSON.stringify(target))||JSON.stringify(receipt)!==JSON.stringify(expected))return false;
    return m.rewards.every(c=>protectedTrainReceipt(state,{...action,target:{...target,management:{...m,rewards:undefined,carriage:c.carriage,rewardReferenceKey:c.referenceKey}}},
      {...effect,trainRewardReceipt:{row:m.row,carriage:c.carriage,referenceKey:c.referenceKey,quantity:null,quantityConfirmed:false,resultCargoAbsent:true,ordinaryInventoryNotObserved:true}}));
  }
  const before=state.frames?.[action?.frameId],after=state.frames?.[action?.resultFrameId];
  const receipt=effect?.trainRewardReceipt,m=action?.target?.management;
  const rewards=before?.review?.data?.trainRewards;
  const row=rewards?.rows?.find(r=>r.row===receipt?.row)??rewards;
  const native=before?.review?.reviewedBy==='program-train-reward';
  const proof=action?.resultProof;
  const resultRow=proof?.review?.data?.trainRewards?.rows?.find(r=>r.row===receipt?.row);
  // Native full-row facts can contain the same product in several carriages.
  // Bind this receipt to the issued target and its immutable same-slot result.
  const positionConfirmed=native?m?.programVerified===true&&m.row===receipt?.row&&m.carriage===receipt?.carriage&&row?.layoutId===m.layoutId&&
    proof?.frameId===after?.id&&proof.evidenceHash===after?.evidenceHash&&proof.sequence===after?.sequence&&
    proof.observedAt===after?.observedAt&&proof.review?.reviewedBy==='program-train-reward'&&
    acceptedFacts({id:after?.id,evidenceHash:after?.evidenceHash,review:proof.review})&&
    row?.carriages?.some(c=>c.carriage===m.carriage&&c.status==='present'&&c.referenceKey===m.rewardReferenceKey)&&
    (resultRow?.phase==='loading'||resultRow?.phase==='returned_cargo'&&resultRow.layoutId===m.layoutId&&
      resultRow.carriages?.some(c=>c.carriage===m.carriage&&c.id===`r${m.row}-c${m.carriage}`&&c.status==='empty')):
    before?.review?.reviewedBy==='GPT';
  return action?.management===true&&action.target?.kind==='collect_train'&&action.status==='verified'&&
    positionConfirmed&&
    action.inputAttempted===true&&acceptedFacts(before)&&acceptedFacts(after)&&
    before.review.actualKind==='train'&&after.review.actualKind==='train'&&
    after.epoch===action.epoch&&after.sequence>before.sequence&&after.evidenceHash!==before.evidenceHash&&
    !((state.observationInvalidation?.sequence??-1)>=before.sequence&&(state.observationInvalidation?.sequence??-1)<=after.sequence)&&
    Date.parse(after.captureStartedAt)>=Date.parse(action.issuedAt)+1000&&
    effect?.actionId===action.id&&effect.frameId===after.id&&effect.confirmed===true&&
    effect.stockScope==='protected_train_reward'&&m?.source==='train_return'&&m.currency==='NONE'&&
    PROTECTED_TRAIN_REWARDS.has(receipt?.referenceKey)&&m.rewardReferenceKey===receipt.referenceKey&&
    [1,2,3].includes(receipt.row)&&Number.isSafeInteger(receipt.carriage)&&receipt.carriage>=1&&receipt.carriage<=({1:5,2:5,3:4}[receipt.row])&&
    row?.row===receipt.row&&row.phase==='returned_cargo'&&row.carriages?.some(c=>
      c.id===`r${receipt.row}-c${receipt.carriage}`&&c.referenceKey===receipt.referenceKey)&&
    receipt.quantity===null&&receipt.quantityConfirmed===false&&receipt.resultCargoAbsent===true&&
    receipt.ordinaryInventoryNotObserved===true&&
    (effect.inventoryDeltas===undefined||Array.isArray(effect.inventoryDeltas)&&!effect.inventoryDeltas.length)&&
    effect.inventoryInvalidated===undefined&&effect.capacityDelta===undefined&&effect.coinDelta===undefined&&
    effect.orderId===undefined&&effect.completedOrderId===undefined&&effect.deletedOrderId===undefined;
}
