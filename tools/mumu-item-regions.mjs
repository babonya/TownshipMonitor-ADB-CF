import {iconOccurrence} from './mumu-region-match.mjs';
export function helicopterItemRegions(profile,needs){
 if(!Array.isArray(needs)||new Set(needs.map(n=>n.slotId)).size!==needs.length)return [];
 return needs.flatMap(n=>{const s=profile.slots.find(s=>s.slotId===n.slotId);
  return s&&profile.items.some(i=>i.itemId===n.itemId)?[iconOccurrence('helicopter:'+s.slotId,n.itemId,s.iconBox,[s.quantityBox,s.checkBox])]:[];});
}
export function trainSlotIcon(row,slot){return iconOccurrence('train:'+row.row+':'+(row.layoutId??'default')+':'+slot.slotId,slot.itemId,slot.item.box,[slot.quantity.box,...(slot.quantityAlternatives??[]).map(s=>s.box)]);}
export function trainItemRegions(profile,train,needs,observations=[]){
 if(profile.recognitionMode==='independent_slots')return observations.filter(s=>!s.loaded&&needs.some(n=>n.slotId===s.slotId&&n.itemId===s.itemId)).map(s=>
  iconOccurrence('train:'+train.row+':'+s.slotId,s.itemId,s.iconBox,[profile.rows.find(r=>r.row===train.row).slots.find(n=>n.slotId===s.slotId).quantityField.box]));
 const rows=profile.rows.filter(r=>r.row===train?.row&&r.layoutId===train?.layoutId);
 if(rows.length!==1||!Array.isArray(needs)||new Set(needs.map(n=>n.slotId)).size!==needs.length)return [];
 return needs.flatMap(n=>{const s=rows[0].slots.find(s=>s.slotId===n.slotId&&s.itemId===n.itemId&&s.required===n.required);return s?[trainSlotIcon(rows[0],s)]:[];});
}
// The current airport registration uses 3 x 3 crates. Only the icon's upper
// artwork is tolerant. Quantity badges, wood, loaded flags and popup stay exact.
// Unrecognized geometry or an occluded/loaded crate never gets an allowance.
export function airportItemRegions(profile,stage,region){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),index=profile.grid.findIndex(b=>same(b,region));
 const n=profile.originalNeeds[index],b=profile.grid[index];
 if(!n||!b||b.width!==153||b.height!==132||stage.loadedSlots.includes(n.slotId))return [];
 return [iconOccurrence('airport:'+profile.layoutId+':'+n.slotId,n.itemId,{x:b.x+29,y:b.y+49,width:70,height:42})];
}
