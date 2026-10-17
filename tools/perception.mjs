import { readFileSync, realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

// Candidate processing only: no screen acquisition, input, or live-state promotion.
export const PERCEPTION_VERSION = 'perception-1';
const fail = code => { throw new Error(code); };
const positive = n => Number.isFinite(n) && n > 0;
const timestamp = s => typeof s === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function validateObservation(o) {
  if (!o?.id || o.source !== 'screen_observation' || !o.screenshotId ||
      !timestamp(o.observedAt) || !positive(o.width) || !positive(o.height) ||
      !/^[a-f0-9]{64}$/.test(o.evidenceHash ?? '')) fail('SCREEN_EVIDENCE_REQUIRED');
}
function validateBox(b, width, height) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || b.x < 0 || b.y < 0 ||
      !positive(b.width) || !positive(b.height) || b.x+b.width > width || b.y+b.height > height) fail('REGION_OUT_OF_BOUNDS');
}

export function verifyEvidence(o, evidenceRoot) {
  validateObservation(o);
  const root = realpathSync(evidenceRoot), file = realpathSync(o.evidenceRef);
  const path = relative(root, file);
  if (!path || path === '..' || path.startsWith('..\\') || path.startsWith('../') || isAbsolute(path)) fail('EVIDENCE_OUTSIDE_ROOT');
  const bytes = readFileSync(file);
  if (digest(bytes) !== o.evidenceHash) fail('EVIDENCE_HASH_MISMATCH');
  return { file, bytes };
}

export function regionView(o, box, scale=1) {
  validateObservation(o); validateBox(box,o.width,o.height);
  if (!positive(scale) || scale > 8) fail('INVALID_REGION_SCALE');
  return { observationId:o.id, screenshotId:o.screenshotId, observedAt:o.observedAt,
    evidenceHash:o.evidenceHash, sourceWidth:o.width, sourceHeight:o.height,
    box:structuredClone(box), scale, width:box.width*scale, height:box.height*scale };
}

export function mapRegionPoint(view, point, currentObservation) {
  validateObservation(currentObservation);
  const o = currentObservation;
  if (view.observationId !== o.id || view.screenshotId !== o.screenshotId || view.evidenceHash !== o.evidenceHash ||
      view.observedAt !== o.observedAt || view.sourceWidth !== o.width || view.sourceHeight !== o.height) fail('REGION_OBSERVATION_MISMATCH');
  validateBox(view.box,o.width,o.height);
  if (!positive(view.scale) || view.scale>8 || view.width!==view.box.width*view.scale || view.height!==view.box.height*view.scale) fail('INVALID_REGION_SCALE');
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || point.x<0 || point.y<0 || point.x>=view.width || point.y>=view.height) fail('POINT_OUT_OF_BOUNDS');
  return {x:view.box.x+point.x/view.scale,y:view.box.y+point.y/view.scale,
    observationId:o.id,screenshotId:o.screenshotId}; // Logical window coordinates; no desktop origin added.
}

export function parseInteger(text) {
  if (typeof text !== 'string') return null;
  const value=text.trim();
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)) return null;
  const number=Number(value.replaceAll(',',''));
  return Number.isSafeInteger(number) ? number : null;
}

export function parseTimer(text, {format, eventKind}={}) {
  if (!['airport_loading_deadline','airport_return','train_return','helicopter_regeneration'].includes(eventKind) || typeof text !== 'string') return null;
  const value=text.trim(); let seconds=null;
  if (format==='hh:mm' || format==='mm:ss') {
    const m=/^(\d{1,4}):([0-5]\d)$/.exec(value);
    if (m) seconds=Number(m[1])*(format==='hh:mm'?3600:60)+Number(m[2])*(format==='hh:mm'?60:1);
  } else if (format==='hh:mm:ss') {
    const m=/^(\d{1,4}):([0-5]\d):([0-5]\d)$/.exec(value);
    if(m)seconds=Number(m[1])*3600+Number(m[2])*60+Number(m[3]);
  } else if(format==='ko-units') {
    const m=/^(?:(\d+)\s*시간\s*)?(?:(\d+)\s*분\s*)?(?:(\d+)\s*초)?$/.exec(value);
    if(m && m.slice(1).some(x=>x!==undefined))seconds=Number(m[1]??0)*3600+Number(m[2]??0)*60+Number(m[3]??0);
  }
  return Number.isSafeInteger(seconds) && seconds>=0 ? {remainingSeconds:seconds,eventKind,format} : null;
}

export function buildCandidates(o, report, regions) {
  validateObservation(o);
  if (report?.ok!==true || !report.engine || !positive(report.imageWidth) || !positive(report.imageHeight) || !Array.isArray(report.words)) fail('OCR_REPORT_INVALID');
  if(!Array.isArray(regions) || regions.length>100)fail('INVALID_REGIONS');
  const ratioX=o.width/report.imageWidth,ratioY=o.height/report.imageHeight;
  const words=report.words.map(w=>{
    if(typeof w.text!=='string')fail('OCR_REPORT_INVALID');
    validateBox(w.box,report.imageWidth,report.imageHeight);
    return {text:w.text,...(w.regionField?{regionField:w.regionField}:{}),box:{x:w.box.x*ratioX,y:w.box.y*ratioY,width:w.box.width*ratioX,height:w.box.height*ratioY}};
  });
  const ids=new Set();
  const candidates=regions.map(r=>{
    if (!r.field || ids.has(r.field) || !['integer','timer','text'].includes(r.type))fail('INVALID_REGIONS');
    ids.add(r.field);validateBox(r.box,o.width,o.height);
    const inside=words.filter(w=>(!w.regionField || w.regionField===r.field) && w.box.x>=r.box.x && w.box.y>=r.box.y &&
      w.box.x+w.box.width<=r.box.x+r.box.width && w.box.y+w.box.height<=r.box.y+r.box.height)
      .sort((a,b)=>a.box.x-b.box.x);
    const rawText=inside.map(w=>w.text).join(' ');
    // Multiple words remain uncertain for numeric fields. Never silently merge split digits.
    const value=r.type==='integer'?(inside.length===1?parseInteger(rawText):null):
      r.type==='timer'?parseTimer(rawText,r):rawText||null;
    const visible = o.confirmed?.quality?.gameVisible===true && o.confirmed?.quality?.occluded===false;
    return {field:r.field,type:r.type,rawText,value,box:structuredClone(r.box),words:inside,
      status:!visible?'blocked_screen_quality':value===null?'unreadable':'candidate',
      confidence:null,engine:report.engine,language:report.language??null,
      observationId:o.id,observedAt:o.observedAt,evidenceHash:o.evidenceHash,
      requiresGptReview:true};
  });
  return {schema:1,version:PERCEPTION_VERSION,mode:'offline_candidates',observationId:o.id,
    observedAt:o.observedAt,evidenceHash:o.evidenceHash,
    processor:{engine:report.engine,language:report.language??null,preprocessing:report.preprocessing??null,
      imageWidth:report.imageWidth,imageHeight:report.imageHeight},candidates,livePromotion:false};
}

export function compareCandidates(o, batch) {
  validateObservation(o);
  if (batch.observationId!==o.id || batch.evidenceHash!==o.evidenceHash || batch.observedAt!==o.observedAt) fail('CANDIDATE_OBSERVATION_MISMATCH');
  const counts={matched:0,mismatched:0,unreadable:0,blocked:0,unverified:0};
  const fields=batch.candidates.map(c=>{
    let result;
    if(c.status==='blocked_screen_quality') result='blocked';
    else if(c.status==='unreadable')result='unreadable';
    else if(c.status!=='candidate' || !Object.hasOwn(o.confirmed??{},c.field) || o.confirmed[c.field]===null)result='unverified';
    else result=JSON.stringify(c.value)===JSON.stringify(o.confirmed[c.field])?'matched':'mismatched';
    counts[result]++;
    return {field:c.field,result,candidate:c.value,reviewedValue:o.confirmed?.[c.field]??null};
  });
  return {reference:'stored_GPT_screen_review',observationId:o.id,counts,fields,
    accuracyClaim:false,livePromotion:false};
}
