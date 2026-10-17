// Semantic lifetime is measured from the original capture, never from review/OCR.
// Mutable facts using untilChange must be fenced by the canonical action ledger.
export function evidenceWindow(evidence,{now=Date.now(),maxAgeMs=300000}={}) {
  const observed=Date.parse(evidence?.observedAt??''),validity=evidence?.validity??{};
  const invalid=reason=>({valid:false,reason,validUntil:null,remainingSeconds:null});
  if(!Number.isFinite(now)||!Number.isFinite(observed)||observed>now)return invalid('OBSERVATION_TIME_INVALID');
  if(evidence.invalidated===true||validity.invalidated===true)return invalid('OBSERVATION_CHANGED');
  const deadlines=[];
  for(const value of [evidence.deadline,validity.deadline])if(value!==undefined){
    const time=Date.parse(value);if(!Number.isFinite(time)||time<observed)return invalid('DEADLINE_INVALID');deadlines.push(time);
  }
  for(const seconds of [evidence.remainingSeconds,validity.remainingSeconds])if(seconds!==undefined){
    if(!Number.isSafeInteger(seconds)||seconds<0||!Number.isSafeInteger(observed+seconds*1000))return invalid('TIMER_INVALID');
    deadlines.push(observed+seconds*1000);
  }
  let until,basis;
  if(deadlines.length){until=Math.min(...deadlines);basis='observed_deadline';}
  else if(maxAgeMs===null||validity.untilChange===true){until=null;basis='until_change';}
  else {
    if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0)return invalid('FRESHNESS_INVALID');
    until=observed+maxAgeMs;basis='untracked_fallback';
  }
  if(until!==null&&!Number.isFinite(new Date(until).getTime()))return invalid('DEADLINE_INVALID');
  const valid=until===null||(basis==='untracked_fallback'?now<=until:now<until);
  return {valid,reason:valid?null:'OBSERVATION_EXPIRED',basis,
    validUntil:until===null?null:new Date(until).toISOString(),remainingSeconds:until===null?null:Math.max(0,Math.floor((until-now)/1000))};
}

// Input age alone does not require another GPT capture/review. Current epoch,
// ownership, target/critical pixels and preflight still fence every input.
export function inputEvidenceValid(frame,now,state=null) {
  if(!frame||state?.observationInvalidation&&frame.sequence<=state.observationInvalidation.sequence)return false;
  const data=frame.review?.data??{};
  return [frame.review?.validityDeadline?{deadline:frame.review.validityDeadline}:{},data.validity?{validity:data.validity}:{},data.order??{},data.market??{}]
    .every(fact=>evidenceWindow({...fact,observedAt:frame.observedAt},{now,maxAgeMs:null}).valid);
}

// Replacing a review's details must not erase an already observed lifetime.
export function retainedReviewDeadline(frame,data) {
  const previous=frame.review?.data??{};
  const deadlines=[frame.review?.validityDeadline,
    ...[previous.validity?{validity:previous.validity}:{},previous.order??{},previous.market??{},data.validity?{validity:data.validity}:{},data.order??{},data.market??{}]
      .map(fact=>evidenceWindow({...fact,observedAt:frame.observedAt},{now:Date.parse(frame.observedAt),maxAgeMs:null}).validUntil)]
    .filter(value=>value&&Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(a)-Date.parse(b));
  return deadlines[0]??null;
}
