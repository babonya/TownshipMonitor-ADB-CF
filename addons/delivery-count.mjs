// 감시(watchdog.ps1)의 시간당 요약용: 오늘 납품 수 출력 "<날짜> <total>". 실패하면 종료코드 1.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const file=process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),'..','runtime','mumu-autonomous-transport','state.json');
const d=JSON.parse(fs.readFileSync(file,'utf8')).state.dailyDeliveries??{};
process.stdout.write(`${d.date??'-'} ${Number(d.total??0)}\n`);
