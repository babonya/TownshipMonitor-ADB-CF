import {readFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {atomic} from '../mumu-persistence.mjs';
import {sha} from './client.mjs';
import {MarketSession,PURCHASE_SHORTAGE_FAILURE_LIMIT} from './market-session.mjs';
import {refreshDeadline} from './market-reset.mjs';

export const MARKET_SESSION_REUSE_MS=180000;
const binding=state=>({sessionId:state.session.id,provider:state.session.provider,serial:state.session.serial,
  executableHash:state.session.adbExecutableHash,target:state.session.adbTarget,
  width:state.session.width,height:state.session.height,mode:state.settings?.workflowMode});
const png=s=>typeof s==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(s);
const product=p=>p&&typeof p.id==='string'&&/^[a-f0-9]{64}$/.test(p.hash)&&png(p.image)&&
  Array.isArray(p.variants)&&p.variants.every(png)&&Number.isSafeInteger(p.failures)&&p.failures>=0&&
  (p.searchFailures===undefined||Number.isSafeInteger(p.searchFailures)&&p.searchFailures>=0)&&
  (p.lastAbsentVisit===undefined||p.lastAbsentVisit===null||typeof p.lastAbsentVisit==='string'&&!!p.lastAbsentVisit)&&
  typeof p.failed==='boolean'&&(!p.failed||p.reason==='market_product_not_found'||
    p.reason==='purchase_shortage_repeated'&&p.failures>=PURCHASE_SHORTAGE_FAILURE_LIMIT)&&
  Array.isArray(p.pending)&&p.pending.every(x=>typeof x.token==='string'&&typeof x.evaluated==='boolean');

// One current refresh-period checkpoint. It never restores orders or game inputs.
export class MarketSessionStore{
  constructor(root,{clock=Date.now,write=atomic}={}){
    this.file=join(root,'.monitor','market-session.json');this.clock=clock;this.write=write;
  }
  load(state,{archive=()=>{}}={}){
    const fresh=()=>new MarketSession({archive});
    try{
      const e=JSON.parse(readFileSync(this.file,'utf8')),r=e.record,s=r?.market,now=this.clock();
      const incarnation=state.orderDemandStartup?.currentIncarnation??null,restart=state.observationInvalidation;
      const restarted=incarnation&&r?.incarnation!==incarnation&&restart?.reason==='restart_current_screen'&&restart.incarnation===incarnation;
      const reuseAt=restarted?Date.parse(restart.at):now;
      if(e.schema!==1||e.checksum!==sha(r)||!Number.isFinite(r?.savedAt)||!Number.isFinite(reuseAt)||reuseAt>now||
        reuseAt<r.savedAt||reuseAt-r.savedAt>MARKET_SESSION_REUSE_MS||
        JSON.stringify(r.binding)!==JSON.stringify(binding(state))||state.session.provider!=='android_adb'||state.settings?.workflowMode!=='som'||
        !s||typeof s.id!=='string'||!s.id||!Array.isArray(s.products)||!s.products.every(product)||
        !(s.scope===null||typeof s.scope==='string')||
        !(s.deadline===null&&s.timer===null||Number.isFinite(s.deadline)&&s.deadline>now&&
          s.deadline===refreshDeadline({marketRefresh:s.timer})&&Date.parse(s.timer.observedAt)<=now))return fresh();
      const result=fresh();
      Object.assign(result,{id:s.id,products:[...result.products,...s.products],timer:s.timer,deadline:s.deadline,scope:s.scope});
      // The same current order must earn its own fresh unread retry after restart.
      result.retry=null;return result;
    }catch{return fresh();}
  }
  save(session,state){
    if(state.session.provider!=='android_adb'||state.settings?.workflowMode!=='som')return;
    const now=this.clock();session?.expire(now);
    const record={savedAt:now,incarnation:state.orderDemandStartup?.currentIncarnation??null,binding:binding(state),market:session?{id:session.id,products:session.products.filter(p=>!p.permanent),
      timer:session.timer,deadline:session.deadline,scope:session.scope}:null};
    mkdirSync(dirname(this.file),{recursive:true});
    this.write(this.file,{schema:1,checksum:sha(record),record},{compact:true});
  }
}
