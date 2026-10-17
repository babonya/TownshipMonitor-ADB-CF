const allowedTabs=['crops','products'];
export class BarnRecovery{
  constructor(){this.stage='enter';this.selection=null;this.completedTabs=new Set();}
  settle(intent){
    if(intent.kind==='som_open_barn')this.stage='choose';
    if(intent.kind==='som_barn_inspect'){
      this.stage='sell';this.selection={index:intent.index,tabId:intent.tabId};
    }
    if(intent.kind==='som_barn_sell'){
      this.completedTabs.add(intent.tabId);this.selection=null;
      this.stage=allowedTabs.every(id=>this.completedTabs.has(id))?'leave':'choose';
    }
  }
  plan(v){
    const r=this;
    const abandon=()=>v.close?{kind:'som_close_panel',box:v.close,next:'town',reason:'barn_recovery_abandoned'}:{waitMs:3000,reason:'SOM_BARN_CLOSE_REQUIRED'};
    if(r.stage==='leave')return v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null;
    if(r.stage==='sell'){
      const s=r.selection;
      if(!s||!v.selected||v.selected.index!==s.index||v.activeTab&&v.activeTab!==s.tabId)return abandon();
      return {kind:'som_barn_sell',box:v.selected.sell,index:s.index,tabId:s.tabId,selectionHash:v.selected.hash,
        next:'barn'};
    }
    // A pre-existing selection is not proof of an untouched default quantity.
    if(v.selected)return abandon();
    if(!allowedTabs.includes(v.activeTab)||r.completedTabs.has(v.activeTab)){
      const tab=allowedTabs.filter(id=>!r.completedTabs.has(id)).map(id=>v.tabs?.find(t=>t.id===id&&t.state==='inactive')).find(Boolean);
      return tab?{kind:'som_barn_tab',box:tab.box,tabId:tab.id,next:'barn'}:abandon();
    }
    if(!Array.isArray(v.rows))return abandon();
    const row=v.rows?.find(row=>row.occupied);
    if(!row){
      r.completedTabs.add(v.activeTab);
      if(allowedTabs.every(id=>r.completedTabs.has(id))){
        r.stage='leave';return v.close?{kind:'som_close_panel',box:v.close,next:'town'}:null;
      }
      const tab=v.tabs?.find(t=>allowedTabs.includes(t.id)&&!r.completedTabs.has(t.id)&&t.state==='inactive');
      return tab?{kind:'som_barn_tab',box:tab.box,tabId:tab.id,next:'barn'}:null;
    }
    return {kind:'som_barn_inspect',box:row.box,index:row.index,tabId:v.activeTab,hash:row.hash,next:'barn'};
  }
}
