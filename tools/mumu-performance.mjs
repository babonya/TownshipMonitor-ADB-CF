import { readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import {acceptedFacts,actionEffect} from './mumu-evidence.mjs';
import {inventoryUnchangedDeletion} from './mumu-inventory.mjs';
export function distribution(values){
  const xs=values.filter(Number.isFinite).sort((a,b)=>a-b),q=p=>xs.length?xs[Math.ceil(xs.length*p)-1]:null;
  return {samples:xs.length,medianMs:q(.5),p90Ms:q(.9),maxMs:xs.at(-1)??null};
}
const duration=(end,start)=>{const d=Date.parse(end)-Date.parse(start);return d>=0?d:NaN;};
const counts=(xs,key)=>xs.reduce((out,x)=>{const value=typeof key==='function'?key(x):x[key];out[value]=(out[value]??0)+1;return out;},{});
const programTransport=new Map([
  ['program-helicopter','helicopter'],['program-train-reward','train'],
  ['program-train-loading','train'],['program-airport-loading','airport']
]);
function logRows(file){
  if(!existsSync(file))return {rows:[],malformed:0};let malformed=0;
  const rows=readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).flatMap(line=>{try{const row=JSON.parse(line);if(!row || Array.isArray(row) || typeof row!=='object' || typeof row.kind!=='string')throw Error('LOG_ROW_INVALID');return [row];}catch{malformed++;return [];}});
  return {rows,malformed};
}
// Historical replay report: no pin, retry, source rewrite, OCR invocation, or ADB.
export function performanceReport(store){
  const s=store.load(),frames=Object.values(s.frames),reviews=frames.filter(f=>f.review),actions=Object.values(s.actions);
  const recognition=logRows(join(store.root,'recognition.log')),capture=logRows(join(store.root,'capture.log'));
  const jobs=recognition.rows.filter(r=>r.kind==='recognition'),captureRows=capture.rows.filter(r=>r.kind==='capture');
  const lastObserved=frames.map(f=>f.observedAt).sort().at(-1);
  const phase=(end,start)=>distribution(actions.map(a=>duration(a[end],a[start])));
  const deliveryKinds=new Set(['send_helicopter','load_train','load_airport']);
  const completed=[];let changedProofs=0;
  for(const action of actions){
    if(action.status!=='verified'||action.management!==true)continue;
    try{
      const effect=actionEffect(s,action);
      if(effect?.confirmed===true&&effect.actionId===action.id&&effect.frameId===action.resultFrameId)completed.push({action,effect});
    }catch{changedProofs++;}
  }
  const deliveries=completed.filter(({action})=>deliveryKinds.has(action.target?.kind));
  const deletions=completed.filter(({action,effect})=>inventoryUnchangedDeletion(s,action,effect));
  const attempts=actions.filter(a=>a.inputAttempted===true).length;
  const totalCaptures=Number.isSafeInteger(s.stats?.captures)?s.stats.captures:captureRows.length||frames.length;
  const accepted=reviews.filter(acceptedFacts);
  const programReviews=accepted.filter(f=>programTransport.has(f.review.reviewedBy)&&programTransport.get(f.review.reviewedBy)===f.review.actualKind);
  const programReviewsByTransport={helicopter:0,train:0,airport:0,...counts(programReviews,f=>f.review.actualKind)};
  const exceptions=Object.values(s.helicopterRounds??{}).flatMap(r=>r.exceptions??[]);
  const end=action=>action.verifiedAt??s.frames[action.resultFrameId]?.observedAt;
  return {schema:1,sessionId:s.session.id,sourceRoot:store.root,startedAt:s.session.startedAt,lastObservedAt:lastObserved??null,
    capturedSpanMs:duration(lastObserved,s.session.startedAt),recognitionMode:s.settings.recognitionMode??'continuous',stats:s.stats,
    logChecks:{captureRows:captureRows.length,recognitionRows:jobs.length,malformed:capture.malformed+recognition.malformed,
      capturesAgree:captureRows.length?captureRows.length===s.stats.captures:null,recognitionAgree:jobs.length?jobs.length===s.stats.completed+s.stats.failed:null},
    ocr:{processing:distribution(jobs.map(j=>j.elapsedMs)),queue:distribution(jobs.map(j=>j.queueWaitMs)),requiredAtProcessing:counts(jobs,'required')},
    review:{retained:reviews.length,status:counts(reviews,f=>f.review.status),captureToReview:distribution(reviews.map(f=>duration(f.review.reviewedAt,f.observedAt))),
      preparedToReview:distribution(reviews.map(f=>duration(f.review.reviewedAt,f.preparedAt))),over30Seconds:reviews.filter(f=>duration(f.review.reviewedAt,f.observedAt)>30000).length,
      overInputAgeLimit:reviews.filter(f=>duration(f.review.reviewedAt,f.observedAt)>30000).length,inputAgeLimitMs:null},
    action:{recorded:actions.length,status:counts(actions,'status'),errors:counts(actions.filter(a=>a.error),'error'),inputAttempted:actions.filter(a=>a.inputAttempted).length,
      reviewToBegin:distribution(actions.map(a=>duration(a.at,s.frames[a.frameId]?.review?.reviewedAt))),
      preflightCapture:phase('preflightCapturedAt','preflightStartedAt'),inputCall:phase('finishedAt','inputReservedAt'),postInputVerification:phase('verifiedAt','issuedAt')},
    delivery:{basis:'retained_verified_action_evidence',verifiedDeliveries:deliveries.length,verifiedDeletions:deletions.length,
      deliveriesByKind:counts(deliveries,({action})=>action.target.kind),changedProofs,
      captures:totalCaptures,inputAttempts:attempts,capturesPerDelivery:deliveries.length?totalCaptures/deliveries.length:null,
      inputsPerDelivery:deliveries.length?attempts/deliveries.length:null,
      completionLatency:distribution(deliveries.map(({action})=>duration(end(action),s.frames[action.frameId]?.observedAt))),
      actionCompletionLatency:distribution(deliveries.map(({action})=>duration(end(action),action.at))),
      deletionCompletionLatency:distribution(deletions.map(({action})=>duration(end(action),action.at)))},
    intervention:{basis:'retained_reviews_and_round_exceptions',programReviews:programReviews.length,programReviewsByTransport,
      programReviewsByProvenance:counts(programReviews,f=>f.review.reviewedBy),
      programNavigationReviews:accepted.filter(f=>f.review.reviewedBy==='program-transport-navigation').length,
      gptReviews:accepted.filter(f=>f.review.reviewedBy==='GPT').length,reviewedBy:counts(reviews,f=>f.review.reviewedBy??'unknown'),
      exceptionReviews:reviews.filter(f=>f.review.reviewedBy==='GPT'&&f.review.data?.exception!==undefined).length,
      roundExceptions:exceptions.length,exceptionReasons:counts(exceptions,e=>e.reason??'unknown'),
      heldRounds:Object.values(s.helicopterRounds??{}).filter(r=>r.status==='exception').length},
    limits:['overInputAgeLimit는 기존 보고서 호환용 30초 초과 표본 수이며 현재 입력 제한이 아니다.','모델 계산시간과 도구 대기는 분리 계측하지 않았다.','보존 프레임의 검토 통계이며 삭제된 일반 프레임 전체를 대표하지 않는다.','OCR 처리시간 합계는 병렬 실행의 총 벽시계 시간이 아니다.','장면 확인/관리 결과 검증은 실제 납품 성과와 별도로 해석한다.',
      'Delivery counts use retained confirmed management receipts; train/airport loads count as deliveries and dispatches do not.',
      'programReviews counts accepted supported helicopter, train reward/loading and airport loading reviews; programReviewsByTransport sums to that total. Accepted transport-navigation reviews are reported separately as programNavigationReviews.',
      'Capture/input ratios use whole-session totals, including navigation and exceptions. Completion latency begins at the action source observation; action completion latency begins at action creation.',
      'Exception reviews count explicitly marked GPT reviews; round exceptions count recorded occurrences. Unmarked interventions cannot be inferred.',
      'These are historical evidence metrics, not a live performance comparison or a claim of improvement.']};
}
