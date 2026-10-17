import {encodePercentageProfile} from './percentage-profile.mjs';
// Supported normal orders use program facts. Unknown identity/layout stops input.
import {existsSync,readFileSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {digest,validateBox} from './adb.mjs';
import {acquireStateLock,atomic} from './mumu-persistence.mjs';
import {cropPng} from './png-crop.mjs';
import {PROGRAM_REVIEW_TOKEN,reviewFactHash,acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {helicopterProfile,mapNavigationTarget,selectionCapability,selectionTarget,miniGameNavigationConfirmed,miniGameSelectionTarget,normalOrderNavigationConfirmed} from './mumu-helicopter-proof.mjs';
import {PerceptionWorker,RapidOcrWorker,helicopterProfilePath,helicopterWorkerOptions,frameMetadata,validatePerception} from './mumu-perception-bridge.mjs';
import {orderSignature,orderDisposition} from './mumu-order-policy.mjs';
import {transportAbbreviation} from './mumu-transport-id.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {readHelicopterNumbers} from './mumu-helicopter-ocr.mjs';
import {confirmedSharedIdentity} from './mumu-product-recognition.mjs';

const integer=n=>Number.isSafeInteger(n)&&n>=0;
const fail=code=>{throw Error(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function deliveryCompleted(matching,profile){
  const spec=profile.profile.deliveryCompletion,result=matching.deliveryCompletion;
  return spec?.kind==='checked_delivery_parcel'&&result?.status==='matched_candidate'&&
    Number.isFinite(result.matchScore)&&result.matchScore>=spec.minimumScore&&same(result.box,spec.sourceBox);
}
export function helicopterFields(matching){
  return matching.slots.filter(s=>s.status!=='empty').map(s=>({fieldId:s.slotId,slotId:s.slotId,itemId:s.itemId,
    kind:'stock_pair',box:s.quantityBox,scale:3,minimumScore:.92,recognitionOnly:true}));
}
function confirmedHelicopterItem(slot,profile){
  if(slot.identitySource==='wiki_upper_crop')return confirmedSharedIdentity(slot.sharedIdentity,'delivery');
  return slot.status==='matched_candidate'&&profile.profile.items.some(i=>i.itemId===slot.itemId&&
    slot.matchScore>=i.minimumScore&&slot.scoreMargin>=i.minimumMargin)?slot.itemId:null;
}
export function reusableHelicopterAnalysis(analysis,frame,profile,matcher,state){
  if(!analysis||matcher.closed===true||!matcher.health?.registryHash||!matcher.health?.templateSetVersion||
      matcher.health.helicopterProfileHash!==profile.hash||frame.epoch!==state.scene.epoch||
      state.observationInvalidation?.sequence>=frame.sequence)return null;
  try{
    validatePerception(analysis,frameMetadata(frame),matcher.health,{helicopter:true});
    if(analysis.helicopterProfileHash!==profile.hash)return null;
    return structuredClone(analysis);
  }catch{return null;}
}
export function decodeHelicopter(frame,matching,ocr,{management=false,profile=helicopterProfile(frame),completedOccurrences=0}={}){
  const observationOnly=profile.profile.observationOnly===true;
  for(const record of [matching,ocr])if(!record||record.frameId!==frame.id||record.evidenceHash!==frame.evidenceHash||record.sequence!==frame.sequence||
    record.epoch!==frame.epoch||record.observedAt!==frame.observedAt)fail('HELICOPTER_FRAME_BINDING_REQUIRED');
  if(matching.status!=='candidate'||matching.scene?.kind!=='helicopter'||matching.helicopterProfileHash!==profile.hash)fail('SUPPORTED_HELICOPTER_REQUIRED');
  if(!Array.isArray(matching.slots)||matching.slots.length!==profile.profile.slots.length||matching.slots.some((s,i)=>
      s.slotId!==profile.profile.slots[i].slotId||!same(s.iconBox,profile.profile.slots[i].iconBox)||!same(s.quantityBox,profile.profile.slots[i].quantityBox)))fail('HELICOPTER_LAYOUT_CHANGED');
  const active=matching.slots.filter(s=>s.status!=='empty');
  if(miniGameNavigationConfirmed(matching,profile.profile)){
    const mapTargets=matching.mapTargets??[],targets=mapTargets.map(m=>miniGameSelectionTarget(frame,profile,m)).filter(Boolean);
    return {review:{reviewedBy:'program-helicopter',quality:{gameVisible:true,occluded:false},actualKind:'helicopter',actualEntityId:null,
      data:{order:null,helicopter:{mapTargets,complete:false,checksAgree:false,reasons:[],profileVersion:profile.profile.version,
        miniGameNavigationConfirmed:true,miniGameNavigation:matching.miniGameNavigation}},targets},ready:false,reasons:[],executionAllowed:false};
  }
  const cooldown=ocr.fields?.find(f=>f.fieldId==='deletion_status'&&f.status==='parsed_candidate');
  const cooldownConfirmed=!observationOnly&&matching.deleteAvailable===false&&typeof cooldown?.value==='string'&&/^new order in\s*:?\s*[0-9]{1,2}:[0-5][0-9](?:\s|$)/i.test(cooldown.value.trim());
  const completionConfirmed=!observationOnly&&deliveryCompleted(matching,profile);
  if(cooldownConfirmed||completionConfirmed){
    const anchors=profile.profile.anchors.map(a=>a.sourceBox),mapTargets=matching.mapTargets??[];
    const currentNative=frame.provider==='google_play_windows'&&profile.profile.dimensions.width===1578;
    const targets=currentNative?[]:mapTargets.filter(m=>m.status==='candidate').map(m=>mapNavigationTarget(m,anchors));
    return {review:{reviewedBy:'program-helicopter',quality:{gameVisible:true,occluded:false},actualKind:'helicopter',actualEntityId:null,data:{order:null,helicopter:{mapTargets,complete:false,checksAgree:false,reasons:[],profileVersion:profile.profile.version,
      ...(completionConfirmed?{deliveryCompletedConfirmed:true}:{deletionCooldownConfirmed:true,cooldownText:cooldown.value})}},targets},ready:false,reasons:[],executionAllowed:false};
  }
  if(!active.length||matching.slots.slice(0,active.length).some(s=>s.status==='empty'))fail('HELICOPTER_SLOT_COVERAGE_UNKNOWN');
  const fields=new Map((ocr?.fields??[]).map(f=>[f.fieldId,f]));
  const needs=active.map(slot=>{
    const field=fields.get(slot.slotId),value=field?.status==='parsed_candidate'?field.value:null;
    const numeric=field?.kind==='stock_pair'&&same(field.box,slot.quantityBox)&&integer(value?.owned)&&integer(value?.required)&&value.required>0;
    const itemId=confirmedHelicopterItem(slot,profile);
    return {slotId:slot.slotId,itemId,owned:numeric?value.owned:null,required:numeric?value.required:null,checkPresent:slot.checkPresent===true};
  });
  const signature=orderSignature(needs),disposition=orderDisposition(needs);
  const category=transportAbbreviation('helicopter');
  const orderId=signature?category+':'+signature+':'+completedOccurrences:category+'-unread:'+digest(Buffer.from(JSON.stringify(needs.map(n=>[n.slotId,n.itemId,n.required])))).slice(0,32);
  const complete=!!signature&&needs.every(n=>integer(n.owned));
  const checksAgree=complete&&needs.every(n=>n.checkPresent===(n.owned>=n.required));
  const ready=!observationOnly&&disposition==='deliver'&&checksAgree&&needs.every(n=>n.owned>=n.required);
  const anchors=profile.profile.anchors.map(a=>a.sourceBox),targets=[];
  const mapTargets=(matching.mapTargets??matching.customers??[]).filter(c=>c.status==='candidate').map(c=>
    ({mapId:c.mapId??('pin:'+c.box.x+':'+c.box.y),box:c.box,pinState:c.pinState,status:c.status}));
  if(!observationOnly)for(const location of mapTargets){
    if(frame.provider==='google_play_windows'&&profile.profile.dimensions.width===1578){
      if(normalOrderNavigationConfirmed(matching,profile.profile)){
        const target=miniGameSelectionTarget(frame,profile,location,'normal_order',matching.selectionGridHash);if(target)targets.push(target);
      }
    }else targets.push(mapNavigationTarget(location,anchors));
  }
  else if(selectionCapability(profile.profile)&&signature)for(const location of mapTargets){
    const target=selectionTarget(frame,profile,location,signature);if(target)targets.push(target);
  }
  const grid={field:'order_grid',box:profile.profile.orderGrid??{x:1245,y:201,width:285,height:370}};
  if(ready&&management)targets.push({id:'send:'+orderId,kind:'send_helicopter',type:'tap',box:profile.profile.sendBox,
    verification:{version:1,anchorBoxes:anchors,targetRegions:[profile.profile.sendVerificationBox??{x:1350,y:780,width:155,height:38}],criticalRegions:[grid]},
    management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',orderId}});
  if(!observationOnly&&disposition==='delete'&&management&&matching.deleteAvailable===true&&profile.profile.deleteBox)targets.push({id:'delete:'+orderId,kind:'delete_helicopter',type:'tap',box:profile.profile.deleteBox,
    verification:{version:1,anchorBoxes:anchors,targetRegions:[profile.profile.deleteBox],criticalRegions:[grid]},
    management:{purpose:'transport',verified:true,programVerified:true,currency:'NONE',orderId,orderPolicy:'delete'}});
  const reasons=[...(!complete?['PRODUCT_OR_QUANTITY_UNKNOWN']:[]),...(complete&&!checksAgree?['CHECK_COUNT_DISAGREEMENT']:[]),...(observationOnly?['HELICOPTER_OBSERVATION_ONLY']:[])];
  const data={order:{orderId,kind:'normal',transport:'helicopter',identityMode:'product_list',signature,orderConfirmed:!!signature,needs,ready,disposition},
    helicopter:{mapTargets,complete,checksAgree,reasons,profileVersion:profile.profile.version,
      ...(normalOrderNavigationConfirmed(matching,profile.profile)?{normalOrderNavigation:matching.normalOrderNavigation,selectionGridHash:matching.selectionGridHash}:{}),
      ...(matching.catalogueManifestSha256?{productRecognition:{catalogueManifestSha256:matching.catalogueManifestSha256,thresholdSha256:matching.thresholdSha256,
        identities:active.map(s=>({slotId:s.slotId,identitySource:s.identitySource,sharedIdentity:s.sharedIdentity}))}}:{})}};
  data.helicopter.recognitionFailures={
    productIdentity:needs.filter(n=>!n.itemId).map(n=>n.slotId),
    quantity:needs.filter(n=>!integer(n.owned)||!integer(n.required)||n.required<1).map(n=>n.slotId),
    productLocation:active.filter(s=>s.productPresent===false).map(s=>s.slotId)};
  const review={reviewedBy:'program-helicopter',quality:{gameVisible:true,occluded:false},actualKind:'helicopter',actualEntityId:null,data,targets};
  return {review,ready,reasons,executionAllowed:false};
}

export function helicopterReceipt(state,action,frame,review){
  if(!['send_helicopter','delete_helicopter'].includes(action?.target?.kind)||!['issued','captured'].includes(action.status))return null;
  if(helicopterProfile(frame).profile.observationOnly===true)return null;
  const before=state.frames[action.frameId];
  if(!acceptedFacts(before)||before.review.actualKind!=='helicopter')return null;
  const old=before.review.data.order,next=review.data.order;
  if(old?.identityMode!=='product_list'||frame.evidenceHash===before.evidenceHash||frame.epoch!==action.epoch||
      review.actualKind!=='helicopter'||!Number.isFinite(Date.parse(frame.observedAt))||!Number.isFinite(Date.parse(action.issuedAt))||
      Date.parse(frame.observedAt)<Date.parse(action.issuedAt))return null;
  const changed=!!next?.signature&&next.signature!==old.signature;
  if(action.target.kind==='delete_helicopter'){
    if(old.disposition!=='delete'||!changed&&!review.data.helicopter?.deletionCooldownConfirmed)return null;
    return {actionId:action.id,frameId:frame.id,confirmed:true,effect:'The requested order was removed after the verified trash input.',
      deletedOrderId:old.orderId,inventoryUnchanged:true,inventoryDeltas:[]};
  }
  const completed=review.data.helicopter?.deliveryCompletedConfirmed===true&&next===null&&
    action.management===true&&action.target.management?.orderId===old.orderId;
  if(old.ready!==true||!old.signature||!changed&&!completed)return null;
  const invalidated=[...new Set(old.needs.map(n=>n.itemId))];
  if(invalidated.some(x=>typeof x!=='string'||!x))return null;
  return {actionId:action.id,frameId:frame.id,confirmed:true,effect:completed?'The checked delivery parcel replaced the product grid after the verified SEND input.':'The requested product list changed after the verified SEND input.',
    completedOrderId:old.orderId,inventoryInvalidated:invalidated};
}

export async function observeHelicopter(store,{frameId='latest',offline=false,commit=!offline,currentScreenOnly=false}={},workers={},analysis=null){
  if(offline&&commit)fail('OFFLINE_OBSERVATION_CANNOT_COMMIT');
  const initial=store.load(),resolved=frameId==='latest'?initial.latestFrameId:frameId;
  if(commit){
    if(initial.stopCapture||initial.stopReader)fail('SESSION_STOPPED');
    if(initial.frames[resolved]?.epoch!==initial.scene.epoch)fail('CURRENT_FRAME_REQUIRED');
    await store.retry(()=>store.pinFrame(resolved,{ocr:false}));
  }
  const evidence=store.evidence(resolved),profile=helicopterProfile(evidence.frame);
  const matcher=workers.matcher??new PerceptionWorker(helicopterWorkerOptions(evidence.frame));
  const ocrWorker=workers.ocr??new RapidOcrWorker();
  try{
    const matching=reusableHelicopterAnalysis(analysis,evidence.frame,profile,matcher,initial)??
      await matcher.analyze(evidence.frame,evidence.bytes,{helicopter:true,offline:true});
    validatePerception(matching,frameMetadata(evidence.frame),matcher.health,{helicopter:true});
    if(matching.status!=='candidate')return {status:'exception',reason:matching.reason,frameId:resolved,stored:false,executionAllowed:false};
    const fields=helicopterFields(matching),ocrFrame={...evidence.frame,kind:'helicopter'};
    if(initial.actions[initial.input]?.target?.kind==='delete_helicopter'&&matching.deleteAvailable===false)fields.push({fieldId:'deletion_status',kind:'text',box:profile.profile.deletionStatusBox??{x:1188,y:190,width:365,height:370},scale:2,minimumScore:.96,recognitionOnly:false});
    const completionConfirmed=deliveryCompleted(matching,profile),miniConfirmed=miniGameNavigationConfirmed(matching,profile.profile);
    if(!fields.length&&!completionConfirmed&&!miniConfirmed)fail('HELICOPTER_SLOT_COVERAGE_UNKNOWN');
    const confirmedItems=Object.fromEntries(matching.slots.map(slot=>[slot.slotId,confirmedHelicopterItem(slot,profile)]));
    const ocr=completionConfirmed||miniConfirmed?{...frameMetadata(evidence.frame),fields:[]}:await readHelicopterNumbers(ocrWorker,ocrFrame,evidence.bytes,fields,{confirmedItems});
    const output=decodeHelicopter(evidence.frame,matching,ocr,{management:!!initial.session.management,profile});
    const current=store.load(),frame=current.frames[resolved],action=current.actions[current.input];
    const signature=output.review.data.order?.signature;
    if(signature&&!currentScreenOnly){
      const completedOccurrences=Object.values(current.actions).filter(a=>a.status==='verified'&&['send_helicopter','delete_helicopter'].includes(a.target?.kind)&&
        current.frames[a.frameId]?.review?.data?.order?.signature===signature&&(actionEffect(current,a)?.completedOrderId||actionEffect(current,a)?.deletedOrderId)).length;
      if(completedOccurrences){const rebased=decodeHelicopter(evidence.frame,matching,ocr,{management:!!initial.session.management,profile,completedOccurrences});Object.assign(output,rebased);}
    }
    if(commit&&(current.input!==initial.input||frame?.evidenceHash!==evidence.frame.evidenceHash||frame.epoch!==current.scene.epoch||
        current.stopCapture||current.stopReader||current.observationInvalidation?.sequence>=frame.sequence))fail('OBSERVATION_CONTEXT_CHANGED');
    const receipt=helicopterReceipt(current,action,evidence.frame,output.review);
    if(receipt)output.review.data.actionResult=receipt;
    output.review.proof={schema:'program-helicopter-1',frameId:resolved,evidenceHash:evidence.frame.evidenceHash,profileHash:profile.hash,
      ...(matching.catalogueManifestSha256?{productRecognition:{catalogueManifestSha256:matching.catalogueManifestSha256,thresholdSha256:matching.thresholdSha256}}:{}),
      registryHash:matching.registryHash,fieldsHash:digest(Buffer.from(JSON.stringify(ocr.fields))),inputId:initial.input,
      invalidationSequence:initial.observationInvalidation?.sequence??null,reviewHash:reviewFactHash(output.review)};
    if(commit)await store.retry(()=>store.review({frameId:resolved,...output.review,programToken:PROGRAM_REVIEW_TOKEN}));
    return {status:output.reasons.length?'exception':'observed',frameId:resolved,stored:commit,...output,matching,ocr};
  }finally{if(!workers.matcher)matcher.close();if(!workers.ocr)ocrWorker.close();}
}

export function syncOrderInventory(store,inventory,{mutationId,frameIds=[]}={}){
  const state=store.load();
  const old=existsSync(join(inventory.root,'inventory.json'))?inventory.locked(s=>inventory.load(s)):null;
  const refs=[...(old?.orderFrameIds??[]),...frameIds];
  const airport=frameIds.map(id=>state.frames[id]).filter(f=>acceptedFacts(f)&&f.review.reviewedBy==='program-airport-loading'&&
    f.review.data.airport?.timingMode==='visual_change'&&f.review.data.airport.fullDemandConfirmed&&f.review.data.order?.orderConfirmed)
    .sort((a,b)=>b.sequence-a.sequence)[0];
  const latest=new Map();
  for(const fid of refs){const frame=state.frames[fid],order=frame?.review?.data?.order;
    if(!orderDemandCurrent(state,frame)||!acceptedFacts(frame)||!order?.orderId||order.completed||!order.needs?.length)continue;
    if(airport&&frame.review.actualKind==='airport'&&order.orderId!==airport.review.data.order.orderId&&frame.sequence<airport.sequence)continue;
    if(!latest.has(order.orderId)||state.frames[latest.get(order.orderId)].sequence<frame.sequence)latest.set(order.orderId,fid);
  }
  const completed=new Set(Object.values(state.actions).filter(a=>a.status==='verified').map(a=>{const e=actionEffect(state,a);return e?.completedOrderId??e?.deletedOrderId;}).filter(Boolean));
  const orderFrameIds=[...latest].filter(([oid])=>!completed.has(oid)).map(([,fid])=>fid);
  return inventory.commit(old?'sync':'init',{mutationId,expectedSourceRevision:state.revision,...(old?{expectedRevision:old.revision}:{}),orderFrameIds});
}

export function learnHelicopterItem(store,{source,frameId,slotId,itemId,cropBox}={}){
  if(source!=='manager_exception')fail('MANAGER_EXCEPTION_REQUIRED');
  const catalog=JSON.parse(readFileSync(new URL('../reference/product-catalog.json',import.meta.url),'utf8'));
  if(!catalog.items.some(i=>i.itemId===itemId&&['crop','farm','factory','feed','island'].includes(i.category)))fail('ORDINARY_CONFIRMED_ITEM_REQUIRED');
  const {frame,image}=store.evidence(frameId),row=frame.review?.data?.order?.needs?.find(n=>n.slotId===slotId);
  if(!acceptedFacts(frame)||frame.review.reviewedBy!=='GPT'||frame.review.actualKind!=='helicopter'||row?.itemId!==itemId)fail('GPT_EXCEPTION_IDENTITY_REQUIRED');
  const profilePath=helicopterProfilePath(frame),root=dirname(profilePath),lock=join(root,'profile.lock'),fd=acquireStateLock(lock);
  try{
    const {profile}=helicopterProfile(frame),slot=profile.slots.find(s=>s.slotId===slotId),b=slot?.iconBox;
    validateBox(cropBox,frame.width,frame.height);
    if(!b||cropBox.x<b.x||cropBox.y<b.y||cropBox.x+cropBox.width>b.x+b.width||cropBox.y+cropBox.height>b.y+b.height)fail('ITEM_CROP_OUTSIDE_SLOT');
    const sums=[0,0,0],squares=[0,0,0],count=cropBox.width*cropBox.height;
    for(let y=cropBox.y;y<cropBox.y+cropBox.height;y++)for(let x=cropBox.x;x<cropBox.x+cropBox.width;x++)
      for(let c=0;c<3;c++){const v=image.pixels[(y*image.width+x)*image.channels+c];sums[c]+=v;squares[c]+=v*v;}
    if(cropBox.width<16||cropBox.height<16||Math.sqrt(squares.reduce((total,s,c)=>total+s/count-(sums[c]/count)**2,0)/3)<12)fail('ITEM_CROP_NOT_DISTINCTIVE');
    const bytes=cropPng(image,cropBox),sha=digest(bytes),file=`learned-${itemId}-${sha.slice(0,16)}.png`;
    if(profile.items.some(i=>i.sha256===sha&&i.itemId===itemId))return {duplicate:true,itemId,executionAllowed:false};
    writeFileSync(join(root,file),bytes);
    profile.items.push({file,sha256:sha,sourceFrameId:frameId,sourceHash:frame.evidenceHash,sourceBox:cropBox,
      itemId,minimumScore:.94,minimumMargin:.06,identitySource:'GPT_exception'});
    profile.version='helicopter-native-'+profile.items.length;
    atomic(profilePath,encodePercentageProfile(profile,profile.dimensions));
    return {duplicate:false,itemId,profileVersion:profile.version,executionAllowed:false};
  }finally{closeSync(fd);unlinkSync(lock);}
}
