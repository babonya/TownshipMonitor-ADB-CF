import {resolvePercentageProfile} from './percentage-profile.mjs';
import {readFileSync} from 'node:fs';
import {digest,validateBox} from './adb.mjs';
const bytes=readFileSync(new URL('../reference/popup-actions.json',import.meta.url));
export const popupRegistryHash=digest(bytes),popupRegistry=resolvePercentageProfile(JSON.parse(bytes));
export const normalizePopupText=s=>String(s??'').toUpperCase().replace(/[\s!'’`]+/g,'');
export const popupRules=Object.entries(popupRegistry.categories).flatMap(([category,rows])=>rows.filter(r=>r.enabled!==false).map(r=>({...r,category})));
if(popupRegistry.schema!==1||Object.keys(popupRegistry.categories).some(k=>!['close','claim'].includes(k))||popupRegistry.minimumScore<.9||popupRegistry.minimumScore>1)throw Error('POPUP_REGISTRY_INVALID');
const ids=new Set(),titles=new Set();
for(const r of popupRules){
 if(!/^[a-z][a-z0-9_]{0,40}$/.test(r.id)||ids.has(r.id)||!normalizePopupText(r.title)||titles.has(normalizePopupText(r.title)))throw Error('POPUP_RULE_AMBIGUOUS');
 ids.add(r.id);titles.add(normalizePopupText(r.title));
 for(const box of [r.titleBox,r.buttonBox])validateBox(box,popupRegistry.width,popupRegistry.height);
 if(r.category==='claim'){
  if(r.buttonText!=='CLAIM')throw Error('POPUP_FREE_CLAIM_REQUIRED');validateBox(r.buttonTextBox,popupRegistry.width,popupRegistry.height);
  const b=r.buttonBox,t=r.buttonTextBox,c={x:Math.floor(b.x+b.width/2),y:Math.floor(b.y+b.height/2)};
  if(t.x<b.x||t.y<b.y||t.x+t.width>b.x+b.width||t.y+t.height>b.y+b.height||c.x<t.x||c.y<t.y||c.x>=t.x+t.width||c.y>=t.y+t.height)throw Error('POPUP_CLAIM_TEXT_LOCATION_REQUIRED');
 }
}
export function popupTarget(rule){
 if(!rule||!popupRules.includes(rule))throw Error('POPUP_RULE_REQUIRED');
 return {id:'popup:'+rule.id,kind:rule.category==='close'?'close_panel':'claim_popup_reward',type:'tap',box:structuredClone(rule.buttonBox),
  eventClose:{schema:1,event:rule.id,category:rule.category,registryHash:popupRegistryHash},
  ...(rule.category==='claim'?{management:{purpose:'transport',verified:true,currency:'NONE',source:'popup_registry',popupId:rule.id,registryHash:popupRegistryHash,rewardContents:'undisclosed'}}:{})};
}
const titleBoxes=[...new Map(popupRules.map(r=>[JSON.stringify(r.titleBox),r.titleBox])).values()];
export const popupFields=[...titleBoxes.map((box,i)=>({fieldId:'title:'+i,box})),...popupRules.filter(r=>r.category==='claim').map(r=>({fieldId:'button:'+r.id,box:r.buttonTextBox}))].map(f=>({...f,kind:'text',scale:2,minimumScore:popupRegistry.minimumScore,recognitionOnly:true}));
const titleFieldId=r=>'title:'+titleBoxes.findIndex(b=>JSON.stringify(b)===JSON.stringify(r.titleBox));
const textMatches=(f,text)=>f?.status==='parsed_candidate'&&normalizePopupText(f.value)===normalizePopupText(text)&&normalizePopupText(f.rawText)===normalizePopupText(text)&&f.ocrScores?.length&&f.ocrScores.every(s=>Number.isFinite(s)&&s>=popupRegistry.minimumScore&&s<=1);
export function matchPopupRule(ocr){
 const matches=popupRules.filter(r=>textMatches(ocr?.fields?.find(f=>f.fieldId===titleFieldId(r)),r.title)&&
  (r.category==='close'||textMatches(ocr.fields.find(f=>f.fieldId==='button:'+r.id),r.buttonText)));
 return matches.length===1?matches[0]:null;
}
