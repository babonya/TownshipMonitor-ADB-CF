import {validPositionScroll,purchasePositionValid} from './market-position.mjs';
import {validDealerIntent} from './dealer.mjs';
import {near,sameBox,descriptorDistance} from './geometry.mjs';
import {routeTarget} from './order-route.mjs';
import {orderShortagesKnown,orderQuantityLimitReached} from './text-decisions.mjs';
import {validMarketResetDelete} from './market-reset.mjs';
import {validSessionDelete} from './market-session.mjs';
import {validScrollIntent} from './market-scroll.mjs';
import {somActionPolicy} from './action-policy.mjs';
export {somActionPolicy,SOM_ACTION_POLICIES} from './action-policy.mjs';
export const readyOrder=v=>v.scene==='helicopter'&&!v.refreshing&&!v.popup&&typeof v.orderHash==='string'&&v.orderHash.length>0&&orderShortagesKnown(v)&&!orderQuantityLimitReached(v)&&v.missing.length===0&&!!v.send;
export const soldOutView=v=>v.scene==='market'&&!v.popup&&!v.motionPending&&v.cardCoverageComplete===true&&
  Array.isArray(v.cells)&&v.cells.length>0&&v.cells.every(c=>c.state==='sold');
// [2026-10-19 사용자 결정] SOLD 칸이 2x2(위 두 칸·아래 두 칸, 가로로 붙은 두 열)로 보이면 시장 끝으로 본다.
// 칸 간격 실측(1600x720): 가로 169px(칸 너비 133), 세로 200px(칸 높이 103).
export const soldBlockView=v=>{
  if(v.scene!=='market'||v.popup||v.motionPending||v.cardCoverageComplete!==true||!Array.isArray(v.cells))return false;
  const s=v.cells.filter(c=>c.state==='sold'&&c.box);
  const near=(a,dx,dy)=>s.some(b=>b!==a&&Math.abs(b.box.x-a.box.x-dx*a.box.width*1.27)<a.box.width*0.4&&Math.abs(b.box.y-a.box.y-dy*a.box.height*1.94)<a.box.height*0.5);
  return s.some(a=>near(a,1,0)&&near(a,0,1)&&near(a,1,1));
};
const disposableNavigation=new Set(['som_select','som_scroll','som_open_helicopter','som_open_market','som_open_barn',
  'som_close_panel','som_barn_tab','som_barn_inspect','som_close_popup']);
export const canReplanNavigation=(v,i)=>disposableNavigation.has(i?.kind)&&(['town','helicopter','market','barn'].includes(v.scene)||i.kind==='som_scroll'&&v.scene==='dealer_search')&&
  !v.popup&&!v.barnFull?.detected&&!v.minigame?.detected&&!v.motionPending;
export const isDisposableNavigation=i=>disposableNavigation.has(i?.kind);
export function completedSomInput(action){
  const r=action?.deviceReceipt,send=action?.target?.som?.kind==='som_send',count=send?2:1;
  return ['issued','captured'].includes(action?.status)&&r?.actionId===action.id&&r.status==='issued'&&r.commandIssued===true&&
    r.plannedClicks===count&&r.completedClicks===count&&Number.isFinite(Date.parse(r.completedAt))&&
    (!send||action.inputSequence?.kind==='som_helicopter_send_skip'&&action.inputSequence.delayMs===100&&action.inputSequence.clickCount===2);
}
export function canReplanCompletedAction(v,action){
  if(v.provider!=='android_adb'||!completedSomInput(action)||v.motionPending||v.minigame?.detected)return false;
  const kind=action.target.som.kind;
  if(['som_claim','som_close_popup'].includes(kind))return !!v.popup||['town','helicopter','market','barn'].includes(v.scene);
  if(kind==='som_barn_sell'&&v.popup)return true;
  return ['som_buy','som_delete','som_barn_sell'].includes(kind)&&!v.popup&&!v.barnFull?.detected&&['town','helicopter','market','barn'].includes(v.scene);
}
const popupTarget=(v,i)=>i.popupPanelContext&&v.popup?.contextHash===i.popupPanelContext&&v.popupClose?.panelContextHash===i.popupPanelContext?v.popupClose:i.popupPanelContext?null:v.popup;
// Completed Send input can leave its game result unconfirmed. Replan from the
// current screen without treating elapsed time or the dispatch receipt as delivery.
export function canReplanCompletedSend(v,action){
  const sequence=action?.inputSequence,receipt=action?.deviceReceipt;
  return action?.target?.som?.kind==='som_send'&&sequence?.kind==='som_helicopter_send_skip'&&
    sequence.delayMs===100&&sequence.clickCount===2&&receipt?.actionId===action.id&&
    receipt.status==='issued'&&receipt.commandIssued===true&&receipt.plannedClicks===2&&receipt.completedClicks===2&&
    Number.isFinite(Date.parse(receipt.completedAt))&&['town','helicopter'].includes(v.scene)&&
    !v.popup&&!v.barnFull?.detected&&!v.minigame?.detected&&!v.motionPending;
}
export function validateIntent(v,i,now=Date.now()){
  if(!i||!somActionPolicy(i.kind))return false;
  if(i.kind==='som_minigame_keepalive')return v.scene==='helicopter'&&!!v.helicopterTitle&&sameBox(v.helicopterTitle,i.box)&&
    !v.popup&&!v.barnFull?.detected&&!v.motionPending;
  if(v.minigame?.detected)return false;
  if(i.kind==='som_claim'||i.kind==='som_close_popup'){
    const p=popupTarget(v,i);return p?.kind===i.popupKind&&p.contextHash===i.popupContext&&sameBox(p.box,i.box);
  }
  if(v.popup||v.barnFull?.detected||v.motionPending)return false;
  if(i.kind.startsWith('som_dealer_'))return validDealerIntent(v,i);
  if(i.kind==='som_open_helicopter'||i.kind==='som_open_market'||i.kind==='som_open_barn')return v.scene==='town'&&sameBox(v[i.next],i.box);
  if(i.kind==='som_close_panel')return ['market','helicopter','barn','dealer_search','dealer_offers'].includes(v.scene)&&sameBox(v.close,i.box)&&
    (i.reason!=='all_orders_refreshing'||v.scene==='helicopter'&&v.refreshing&&!v.pins.some(p=>p.color==='green'))&&
    (i.reason!=='all_visible_products_sold'||soldOutView(v));
  if(i.kind==='som_scroll')return v.scene==='market'&&i.reason!=='market_find_origin'&&sameBox(v.view,i.box)&&descriptorDistance(v.descriptor,i.descriptor)<3&&(i.reason==='market_leave_origin'?validPositionScroll(v,i):validScrollIntent(v,i));
  if(i.kind==='som_barn_tab')return v.scene==='barn'&&!v.selected&&['crops','products'].includes(i.tabId)&&v.tabs?.some(t=>t.id===i.tabId&&t.state==='inactive'&&sameBox(t.box,i.box));
  if(i.kind==='som_barn_inspect')return v.scene==='barn'&&!v.selected&&['crops','products'].includes(v.activeTab)&&i.tabId===v.activeTab&&
    v.rows?.find(r=>r.occupied)?.index===i.index&&v.rows.some(r=>r.index===i.index&&r.hash===i.hash&&sameBox(r.box,i.box));
  if(i.kind==='som_barn_sell')return v.scene==='barn'&&['crops','products'].includes(i.tabId)&&(!v.activeTab||v.activeTab===i.tabId)&&
    v.selected?.index===i.index&&v.selected.hash===i.selectionHash&&sameBox(v.selected.sell,i.box);
  if(i.kind==='som_buy')return v.scene==='market'&&purchasePositionValid(v,i)&&v.cells.some(c=>c.state==='offer'&&sameBox(c.card,i.cell)&&sameBox(c.buy,i.box)&&c.hash===i.hash)&&i.match?.choice==='same_product';
  if(i.kind==='som_select')return i.route?!!routeTarget(v,i):v.scene==='helicopter'&&v.pins.some(p=>sameBox(p.box,i.box)&&p.color===i.color&&(!i.visualBox||sameBox(p.visualBox,i.visualBox)));
  if(i.kind==='som_delete')return v.scene==='helicopter'&&!v.refreshing&&v.orderHash===i.orderHash&&!!v.trash&&sameBox(v.trash,i.box)&&
    (v.provider==='android_adb'?validSessionDelete(v,i,now):validMarketResetDelete(v,i,now));
  if(i.kind==='som_send')return readyOrder(v)&&v.orderHash===i.orderHash&&sameBox(v.send,i.box);
  return false;
}
export function resultOutcome(v,i){
  if(!somActionPolicy(i?.kind))return null;
  // This harmless title tap only observes the current screen; it never resolves the handoff.
  if(i.kind==='som_minigame_keepalive')return !v.popup&&!v.barnFull?.detected&&!v.motionPending&&
    (v.scene==='helicopter'&&!!v.helicopterTitle||['town','market','barn','mission','dealer_search','dealer_offers'].includes(v.scene))?'observed':null;
  // A modal or unchanged order cannot settle a destructive click or permit another one.
  if(i.kind==='som_delete')return v.scene==='helicopter'&&!v.popup&&!v.minigame?.detected&&!v.trash&&
    typeof v.orderHash==='string'&&v.orderHash!==i.orderHash?'confirmed':null;
  if(i.kind==='som_close_popup'&&i.popupKind==='products_missing'&&v.productsMissing?.detected)return null;
  if(i.kind==='som_claim'||i.kind==='som_close_popup'){
    if(i.popupPanelContext&&v.popup?.contextHash===i.popupPanelContext)return null;
    return !v.popup&&v.scene!=='unknown'||v.popup&&(v.popup.contextHash!==i.popupContext||v.popup.kind!==i.popupKind||!sameBox(v.popup.box,i.box))?'confirmed':null;
  }
  // A dispatched sale completes when its popup closes back to the barn.
  // Capacity changes are deliberately not read or compared.
  if(i.kind==='som_barn_sell')return v.scene==='barn'&&!v.selected&&!v.popup&&!v.barnFull?.detected&&!v.minigame?.detected&&!v.motionPending?'confirmed':null;
  if(v.popup||v.barnFull?.detected)return 'interrupted_by_popup';
  // The request is an interruption, never proof of a delivery or purchase.
  if(v.minigame?.detected)return 'interrupted_by_minigame';
  if(i.kind.startsWith('som_dealer_'))return i.kind!=='som_dealer_buy'&&v.scene===i.next?'observed':null;
  if(i.kind.startsWith('som_open_')||i.kind==='som_close_panel')return v.scene===i.next?'confirmed':null;
  if(i.kind==='som_barn_tab')return v.scene==='barn'&&!v.selected&&v.activeTab===i.tabId?'confirmed':null;
  if(i.kind==='som_barn_inspect')return v.scene==='barn'&&v.selected?.index===i.index&&(!v.activeTab||v.activeTab===i.tabId)?'confirmed':null;
  // Observed navigation is not a claim that a particular order was selected.
  if(i.kind==='som_select')return v.scene==='helicopter'?'observed':v.scene==='town'?'navigation_departed':null;
  // [사용자 변경 2026-10-15] 배송 후 미니게임 주문이 선택되면 skipMinigame이 orderHash를 지우므로,
  // 핀을 읽은 화면에서 보낸 주문의 초록 핀이 사라진 것도 배송 성공으로 본다.
  if(i.kind==='som_send')return v.scene==='helicopter'&&(typeof v.orderHash==='string'&&v.orderHash!==i.orderHash||
    (v.pins?.length>0)&&(i.greenPins??[]).some(b=>!v.pins.some(p=>p.color==='green'&&near(p.box,b))))?'confirmed':null;
  if(i.kind==='som_buy')return v.scene==='market'&&v.cells.some(c=>c.state==='sold'&&near(c.card,i.cell))?'confirmed':null;
  // The first post-drag observation is enough; no frame-to-frame stability gate.
  if(i.kind==='som_scroll')return v.scene==='market'?'confirmed':null;
  return null;
}
