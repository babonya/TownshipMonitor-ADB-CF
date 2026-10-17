// [2026-10-16] 헛돌기 감지(정지사례 #9): 입력은 계속 나가는데 결과가 없는 반복. addons/watchdog.ps1이 매분 실행한다.
// 최근 동작 LOOP_COUNT개가 모두 같은 종류이고 결과가 재계획(replanned_from_current_screen)이면 "LOOP <종류> <개수> <무입력분>", 아니면 "OK <무입력분>".
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const LOOP_COUNT=10;
const file=process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),'..','runtime','mumu-autonomous-transport','state.json');
const actions=Object.values(JSON.parse(fs.readFileSync(file,'utf8')).state.actions??{}).sort((a,b)=>String(a.at).localeCompare(String(b.at)));
const done=actions.filter(a=>a.outcome).slice(-LOOP_COUNT);
const kind=done[0]?.target?.som?.kind;
// [2026-10-17] 같은 팝업(같은 popupContext)을 '닫힘 확인'인데도 계속 닫는 반복도 헛돌기(정지사례 #17, Flip the Tiles 98회).
const ctx=done[0]?.target?.som?.popupContext;
const loop=done.length===LOOP_COUNT&&(done.every(a=>a.target?.som?.kind===kind&&a.outcome==='replanned_from_current_screen')||
  (kind==='som_close_popup'&&!!ctx&&done.every(a=>a.target?.som?.kind===kind&&a.target?.som?.popupContext===ctx)));
// 둘째 값 = 마지막 동작 후 지난 분(감시의 무입력 판정용). adb-dispatch 마커는 재시작 때 비워져 쓸 수 없다(정지사례 #8 재발 10-16 04:54).
const last=Math.max(0,...actions.map(a=>Date.parse(a.at)).filter(Number.isFinite));
const idle=last?((Date.now()-last)/60000).toFixed(1):'0';
process.stdout.write(loop?`LOOP ${kind} ${LOOP_COUNT} ${idle}\n`:`OK ${idle}\n`);
