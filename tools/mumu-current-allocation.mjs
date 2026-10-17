import {transportEnabled,deliveryScopeCutoff} from './mumu-delivery-scope.mjs';
// Disposable current-screen allocation for Monitor. No inventory file, stock
// deltas, completed-order archive, or continuity record is consulted.
import {currentScreenNeeds} from './mumu-current-needs.mjs';
import {acceptedFacts} from './mumu-evidence.mjs';
import {orderDemandCurrent} from './mumu-order-demand.mjs';
import {orderDisposition} from './mumu-order-policy.mjs';
import {inputEvidenceValid} from './mumu-freshness.mjs';
import {digest} from './adb.mjs';
import {acquireStateLock} from './mumu-persistence.mjs';
import {closeSync,unlinkSync} from 'node:fs';
const sha=x=>digest(Buffer.from(JSON.stringify(x)));
export class CurrentAllocation {
  constructor({source,clock=source.clock}){this.source=source;this.clock=clock;this.allocationKind='current_screen';this.accounting=null;this.currentMode=true;this.revision=0;this.key=null;this.cutoff=null;this.retired=new Map();}
  status(state=this.source.load()){
    const projection=currentScreenNeeds(state,{now:this.clock(),afterSequence:this.cutoff,includePolicyHolds:false,includeStock:true,
      includeOrder:o=>state.frames[o.frameId].sequence>(this.retired.get(o.transport)??-1)});
    const orders=projection.orders;
    const ids=new Set(orders.map(o=>o.orderId));
    const allocations=projection.allocations;
    const allocationsByOrder=new Map(),heldReasonsByOrder=new Map(),feasibleIds=new Set(projection.feasible.map(f=>f.orderId));
    for(const allocation of allocations){const rows=allocationsByOrder.get(allocation.orderId)??[];rows.push(allocation);allocationsByOrder.set(allocation.orderId,rows);}
    for(const hold of projection.held){const reasons=heldReasonsByOrder.get(hold.orderId)??[];reasons.push(hold.reason==='CURRENT_OWNED_COUNTS_REQUIRED'?'OWNED_COUNT_UNKNOWN':hold.reason);heldReasonsByOrder.set(hold.orderId,reasons);}
    const items={},reservations=[];
    for(const [itemId,sample] of projection.stock.samples){
      const fresh=!projection.stock.uncertain.has(itemId);
      items[itemId]={itemId,quantity:sample.quantity,status:fresh?'confirmed':'unknown',fresh,
        observedAt:state.frames[sample.source.frameId].observedAt,source:{kind:'order_owned',...sample.source}};
    }
    // Status, shopping shortages and reservations share the same projection.
    for(const a of allocations)if(a.allocated)reservations.push({...a,quantity:a.allocated,status:'reserved'});
    const evaluations=orders.map(o=>({...o,needs:o.originalNeeds,items:(allocationsByOrder.get(o.orderId)??[]).map(a=>({...a,owned:items[a.itemId]?.quantity})),
      status:feasibleIds.has(o.orderId)?'feasible':heldReasonsByOrder.has(o.orderId)?'hold':'shortage',
      reasons:heldReasonsByOrder.get(o.orderId)??[]}));
    // The selected whole order remains eligible for supported policy deletion,
    // even though deletion-only demand is deliberately excluded from shopping.
    const f=state.frames[state.latestFrameId],o=f?.review?.data?.order;
    if(transportEnabled(state,f?.review?.actualKind)&&transportEnabled(state,o?.transport??f?.review?.actualKind)&&acceptedFacts(f)&&orderDemandCurrent(state,f)&&inputEvidenceValid(f,this.clock(),state)&&f.sequence>Math.max(this.cutoff??-1,deliveryScopeCutoff(state))&&
        o?.orderId&&o.kind==='normal'&&!ids.has(o.orderId)){
      const full=f.review.data.train?.fullDemandConfirmed??f.review.data.airport?.fullDemandConfirmed??o.orderConfirmed;
      const whole=f.review.data.train?.originalNeeds??f.review.data.airport?.originalNeeds??o.needs;
      const disposition=full?orderDisposition(whole):'hold';
      evaluations.push({...o,transport:o.transport??f.review.actualKind,needs:whole,items:(o.needs??[]).map(n=>({...n,shortage:null})),
        status:'hold',disposition,reasons:[disposition==='delete'?'ORDER_DELETE_REQUIRED':'CURRENT_OWNED_COUNTS_REQUIRED']});
    }
    const result={currentMode:true,config:{mode:'current_screen'},requiresSync:false,holdReasons:[],orders:orders.map(o=>({...o,items:o.needs,confirmed:true})),evaluations,
      projection:{items,reservations,holdReasons:[],capacity:{fresh:false}},neededGoods:projection.needs,needsHash:projection.hash};
    const key=sha(result);if(key!==this.key){this.key=key;this.revision++;}return {...result,revision:this.revision};
  }
  stamp(){this.status();return this.key;}
  locked(fn){const fd=acquireStateLock(this.source.lockFile);try{return fn(this.source.load());}finally{closeSync(fd);unlinkSync(this.source.lockFile);}}
  load(state=this.source.load()){const s=this.status(state);return {...s,orderFrameIds:s.orders.map(o=>o.frameId)};}
  readInputState(state){return {revision:this.status(state).revision,accounting:null};}
  inspectForInput(state,fn){const s=this.status(state);return fn(s,{revision:s.revision});}
  sync(){return this.status();}
  retire(kind,sequence){this.retired.set(kind,sequence);return this.status();}
}
