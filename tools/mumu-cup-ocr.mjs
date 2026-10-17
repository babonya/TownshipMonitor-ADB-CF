import {registeredPercentageBox} from './percentage-profile.mjs';
// Read fixed text only. Chest, sparkles and reward icons are deliberately absent.
import {RapidOcrWorker} from './mumu-perception-bridge.mjs';
export const createCupOcrWorker=options=>new RapidOcrWorker({timeoutMs:60000,...options});
export const CUP_TEXT_FIELDS=Object.freeze([
 {fieldId:'title',box:registeredPercentageBox({x: 0.22053231939163498, y: 0.23659305993690852, width: 0.6476552598225602, height: 0.06703470031545741},{width:1578,height:1268}),text:'CONGRATULATIONS!'},
 {fieldId:'prompt',box:registeredPercentageBox({x: 0.31685678073510776, y: 0.7807570977917981, width: 0.45627376425855515, height: 0.0473186119873817},{width:1578,height:1268}),text:'TAP TO OPEN'}
]);
const normalized=s=>String(s??'').toUpperCase().replace(/[\s!'’]+/g,'');
const terminalTitle=f=>f?.status==='parsed_candidate'&&normalized(f.value)==='FARMERSRACE'&&normalized(f.rawText)==='FARMERSRACE'&&
 f.ocrScores?.length&&f.ocrScores.every(s=>Number.isFinite(s)&&s>=.9&&s<=1);
export const CUP_STAGE_SOURCES=Object.freeze({open:'mayors_cup_open',claim:'mayors_cup_collect',continue:'mayors_cup_continue'});
export const cupActionStage=a=>Object.keys(CUP_STAGE_SOURCES).find(k=>CUP_STAGE_SOURCES[k]===a?.target?.management?.source)??null;
const promptStage=f=>f?.status==='parsed_candidate'&&f.ocrScores?.length&&f.ocrScores.every(s=>Number.isFinite(s)&&s>=.9&&s<=1)&&normalized(f.value)===normalized(f.rawText)?
 ({TAPTOOPEN:'open',TAPTOCLAIM:'claim',TAPTOCONTINUE:'continue',CONTINUE:'continue'}[normalized(f.value)]??null):null;
const fieldsFor=stage=>CUP_TEXT_FIELDS.map(f=>f.fieldId==='prompt'?{...f,
 box:stage==='auto'?f.box:stage==='continue'?registeredPercentageBox({x: 0.3929024081115336, y: 0.7807570977917981, width: 0.3041825095057034, height: 0.0473186119873817},{width:1578,height:1268}):registeredPercentageBox({x: 0.4423320659062104, y: 0.7807570977917981, width: 0.20595690747782003, height: 0.0473186119873817},{width:1578,height:1268}),
 text:stage==='claim'?'TAP TO CLAIM':stage==='continue'?'TAP TO CONTINUE':'TAP TO OPEN'}:f);
export function validateCupOcr(frame,image,reading){
 const o=reading?.ocr;
 if(!(Object.hasOwn(CUP_STAGE_SOURCES,reading?.stage??'')||reading?.stage==='complete')||o?.frameId!==(frame.id??frame.frameId)||o.evidenceHash!==frame.evidenceHash||
   o.epoch!==frame.epoch||o.sequence!==frame.sequence||o.observedAt!==frame.observedAt||o.scene!=='mayors_cup_result'||
   o.status!=='candidate'||o.provider!=='rapidocr'||o.executionAllowed!==false||o.ocrRequested!==true||
   image.width!==1578||image.height!==1268||o.fields?.length!==2)
   throw Error('CUP_OCR_EVIDENCE_REQUIRED');
 const detected=promptStage(o.fields[1]);
 if(detected&&detected!==reading.stage)throw Error('CUP_PROMPT_STAGE_CHANGED');
 let matched=reading.stage==='complete'?terminalTitle(o.fields[0])&&!detected:detected===reading.stage;
 for(const [i,spec] of fieldsFor(reading.scanMode==='auto'?'auto':reading.stage).entries()){
   const f=o.fields[i];
   if(f?.fieldId!==spec.fieldId||f.kind!=='text'||JSON.stringify(f.box)!==JSON.stringify(spec.box))throw Error('CUP_FIXED_TEXT_REQUIRED');
   if(f.status==='parsed_candidate'&&normalized(f.value)===normalized(spec.text)&&normalized(f.rawText)===normalized(spec.text)&&
     f.ocrScores?.length&&f.ocrScores.every(s=>Number.isFinite(s)&&s>=.9&&s<=1)&&
     reading.stage!=='complete'&&(reading.stage==='open'&&spec.fieldId==='title'||spec.fieldId==='prompt'))matched=true;
 }
 if(!matched)throw Error('CUP_FIXED_TEXT_REQUIRED');
 return true;
}
export async function readCupOcr(frame,bytes,image,{worker=null,python,offline=false,stage='open'}={}){
 const owned=!worker;worker??=new RapidOcrWorker({...(python?{python}:{}),timeoutMs:60000});
 try{
   const ocr=await worker.analyze({...frame,kind:'mayors_cup_result'},bytes,{scene:'mayors_cup_result',offline,
     fields:fieldsFor(stage).map(({text,...f})=>({...f,kind:'text',scale:2,minimumScore:.9,recognitionOnly:stage!=='auto'||f.fieldId!=='prompt'}))});
   const reading={stage:stage==='auto'?(promptStage(ocr.fields[1])??(terminalTitle(ocr.fields[0])?'complete':null)):stage,scanMode:stage==='auto'?'auto':'stage',ocr};
   try{validateCupOcr(frame,image,reading);}catch(error){return {supported:false,reason:error.message,ocr};}
   return {supported:true,...reading};
 }finally{if(owned)worker.close();}
}
