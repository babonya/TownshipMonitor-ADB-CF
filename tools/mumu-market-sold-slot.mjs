// Native SOLD anchor rounding may differ by one physical pixel. A stable
// opposite-row original proves the column; all legacy exact cases are retained.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function sameMarketSoldSlot(before,reading,row,after){
  if(!row||!after||after.row!==row.row||after.state!=='sold'||!after.fullyVisible||after.currency!==null)return false;
  if(same(after.cardBox,row.cardBox))return true;
  const b=row.cardBox,c=after.cardBox;
  if(before.provider!=='google_play_windows'||before.width!==1578||before.height!==1268||
    before.review.data.market.layoutId!=='native-market-1578-20261006'||
    reading.market?.layoutId!==before.review.data.market.layoutId||
    !b||!c||!Number.isSafeInteger(c.x)||Math.abs(c.x-b.x)!==1||
    c.y!==b.y||c.width!==b.width||c.height!==b.height)return false;
  const original=before.review.data.rows.filter(r=>r.row===1-row.row&&r.fullyVisible&&r.cardBox?.x===b.x&&
    r.cardBox.width===b.width&&r.cardBox.height===b.height);
  if(original.length!==1||!/^[a-f0-9]{64}$/.test(original[0].contentHash??''))return false;
  const counterpart=reading.rows.filter(r=>r.row===original[0].row&&r.fullyVisible&&same(r.cardBox,original[0].cardBox));
  return counterpart.length===1&&counterpart[0].state===original[0].state&&
    counterpart[0].currency===original[0].currency&&counterpart[0].contentHash===original[0].contentHash;
}
