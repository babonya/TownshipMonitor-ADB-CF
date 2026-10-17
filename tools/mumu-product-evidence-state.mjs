// Collection states describe evidence only, never product registration or input authority.
export function productEvidenceTransition(metadata,event,data={}){
  const next=structuredClone(metadata);
  switch(event){
    case 'captured':
      next.info=data.info;next.files['info.png']=data.hash;next.status='captured';
      if(data.clearReason)delete next.reason;
      break;
    case 'recovery':
      next.previousFailure=next.reason;delete next.reason;
      next.recovery=data.recovery;next.status='captured';break;
    case 'returned':
      next.returned=data.returned;
      next.status=data.saveError||!next.files['info.png']||data.returned?.confirmed!==true?'failed':'complete';
      if(next.status==='failed')next.reason=data.saveError??(!next.files['info.png']?'INFO_CAPTURE_MISSING':'ORDER_RETURN_UNCONFIRMED');
      next.completedAt=data.completedAt;break;
    case 'failed':next.status='failed';next.reason=data.reason;break;
    default:throw Error('PRODUCT_EVIDENCE_EVENT_INVALID');
  }
  return next;
}
