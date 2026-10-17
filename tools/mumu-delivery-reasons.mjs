const retryable=new Set(['PERCEPTION_START_TIMEOUT','PERCEPTION_REQUEST_TIMEOUT','PERCEPTION_WORKER_CLOSED','OCR_QUEUE_FULL','TRANSIENT_OCR_FAILURE']);
const orderHolds=new Set(['TRAIN_ORIGINAL_DEMAND_REQUIRED','TRAIN_SELECTED_SHORTAGE','TRAIN_LOAD_RESULT_EVIDENCE_REQUIRED',
  'AUTOMATIC_ORDER_HELD','CURRENT_TRANSPORT_RESERVATION_REQUIRED','HELICOPTER_SLOT_COVERAGE_UNKNOWN','SUPPORTED_HELICOPTER_REQUIRED']);
const transportHolds=new Set(['HELICOPTER_OBSERVATION_ONLY','HELICOPTER_SELECTION_CAP_REACHED','GOOGLE_PLAY_PROFILE_REQUIRED',
  'HELICOPTER_SELECTION_MARKER_NOT_VISIBLE','HELICOPTER_SELECTION_MARKER_AMBIGUOUS',
  'TRAIN_LOADING_GEOMETRY_EVIDENCE_REQUIRED','AIRPORT_LOADING_GEOMETRY_EVIDENCE_REQUIRED',
  'MARKET_NATIVE_SOURCE_RESULT_EVIDENCE_REQUIRED','MARKET_NATIVE_EVIDENCE_REQUIRED','MARKET_LEFTMOST_REQUIRED',
  'MARKET_FREE_REFRESH_TIMER_UNREADABLE','MARKET_SCROLL_NO_MOTION','MARKET_SCROLL_OVERLAP_REQUIRED']);
const rules=new Map();
for(const [scope,reasons] of [['observation',retryable],['order',orderHolds],['transport',transportHolds]])
  for(const reason of reasons)rules.set(reason,Object.freeze({scope,retryObservation:scope==='observation'}));
const globalRule=Object.freeze({scope:'global',retryObservation:false});
const transientRule=Object.freeze({scope:'observation',retryObservation:true});
export function deliveryReasonPolicy(reason){
  return rules.get(reason)??(/^PERCEPTION_EXIT:/.test(reason)||/^(EPIPE|ECONNRESET)(:|$)/.test(reason)?transientRule:globalRule);
}
