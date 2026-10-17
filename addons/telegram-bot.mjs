// [사용자 변경 2026-10-18] 텔레그램 /stat 명령 응답 봇: 폰에서 /stat 을 보내면 오늘 납품·이번 실행 이후 납품·현재 상태를 답장한다.
// 필요 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (없으면 HKCU\Environment 에서 읽음). 토큰은 로그·출력에 남기지 않는다.
// 실행: node addons\telegram-bot.mjs   (검증: node addons\telegram-bot.mjs --selftest)
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
// [2026-10-18] node fetch가 IPv6/IPv4 연결 시도를 250ms만 기다려 이 PC에서 ETIMEDOUT 반복(curl은 정상) → 명령 응답이 2~3분 늦음. 3초로 늘림.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const rt=path.join(root,'runtime');
const logFile=path.join(rt,'telegram-bot.log'),pidFile=path.join(rt,'telegram-bot.pid'),offsetFile=path.join(rt,'telegram-offset.json');
const selftest=process.argv.includes('--selftest');

const readEnv=name=>{
  if(process.env[name])return process.env[name];
  try{
    const out=execFileSync('reg',['query','HKCU\Environment','/v',name],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
    const m=out.match(new RegExp(name+'\s+REG_\w+\s+(.+)'));
    return m?m[1].trim():'';
  }catch{return '';}
};
const token=selftest?'':readEnv('TELEGRAM_BOT_TOKEN'),chatId=selftest?'':readEnv('TELEGRAM_CHAT_ID');
const scrub=s=>{s=String(s);return token?s.split(token).join('***'):s;};
const pad=n=>String(n).padStart(2,'0');
const stamp=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const log=m=>{const line=`${stamp(new Date())} ${scrub(m)}`;console.log(line);try{fs.appendFileSync(logFile,line+'\n');}catch{}};
const readJson=(f,def=null)=>{try{return JSON.parse(fs.readFileSync(f,'utf8').replace(/^﻿/,''));}catch{return def;}};

function buildStat(){
  const title='[꿈마] 현황';
  const lines=[`${title} 오늘 납품`];
  let date='',total=null;
  try{
    const first=execFileSync('node',[path.join(root,'addons','delivery-count.mjs')],{encoding:'utf8',cwd:root,stdio:['ignore','pipe','ignore'],timeout:30000}).split(/\r?\n/)[0].trim();
    [date,total]=first.split(' ');total=Number(total);if(!Number.isFinite(total))total=null;
  }catch{}
  lines[0]=`${title}
오늘 납품: ${total===null?'확인 실패':total+'건'}${date?` (${date})`:''}`;
  const rs=readJson(path.join(rt,'run-start.json'));
  let since='기록 없음';
  if(rs&&rs.date&&Number.isFinite(Number(rs.total))&&total!==null){
    const hm=(()=>{const d=new Date(rs.startedAt);return isNaN(d)?'?':`${pad(d.getHours())}:${pad(d.getMinutes())}`;})();
    since=rs.date===date?`${total-Number(rs.total)}건 (시작 ${hm})`:`${rs.date} 시작 — 오늘 ${total}건`;
  }
  lines.push(`이번 실행 이후 납품: ${since}`);
  let alive='확인 실패';
  try{
    const out=execFileSync('tasklist',['/FI','IMAGENAME eq TownshipMonitor.exe'],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
    alive=/TownshipMonitor\.exe/i.test(out)?'실행 중':'꺼짐';
  }catch{}
  // [2026-10-18] delivery.json 상태는 지난 기록일 수 있어(새벽 UNIDENTIFIED가 그대로 보임) 모니터 화면의 현재 상태 글자를 보여 준다.
  let now='-';
  if(alive==='실행 중')try{now=execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'addons','tg-control.ps1'),'status'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:30000,windowsHide:true}).trim()||'-';}catch{}
  lines.push(`상태: TownshipMonitor ${alive}, 모니터 표시='${now}'`);
  // [2026-10-18 사용자 요청] 지금 진행 단계(delivery.json, 갱신 시각 함께 — 오래됐으면 지난 기록).
  try{
    const f=path.join(rt,'mumu-autonomous-transport','.monitor','delivery.json');
    const st=readJson(f)?.record?.status||{};const age=Math.round((Date.now()-fs.statSync(f).mtimeMs)/1000);
    const ko={survey:'주문 훑기',shopping:'시장 구매',deliver:'배송',delete:'주문 삭제',recheck:'주문 재확인',reset_orders:'주문 새로고침 대기',barn_recovery:'창고 복구',recovering_camera:'카메라 맞추기',recovering_navigation:'화면 이동 복구',minigame_requesting:'미니게임 주문',hold:'보류',ready:'준비'};
    const name=v=>v?(ko[v]?`${ko[v]}(${v})`:v):'-';
    const ago=age<120?`${age}초 전`:`${Math.round(age/60)}분 전`;
    lines.push(`진행: ${name(st.phase)} / 단계 ${name(st.step)}${st.reason?`, 사유 ${st.reason}`:''} (${ago} 갱신)`);
  }catch{lines.push('진행: 확인 실패');}
  let last='-';
  try{const t=fs.readFileSync(path.join(rt,'hourly.log'),'utf8').replace(/^﻿/,'').split(/\r?\n/).filter(x=>x.trim());if(t.length)last=t[t.length-1];}catch{}
  lines.push(`마지막 시간 요약: ${last}`);
  return lines.join('\n');
}

if(selftest){console.log(buildStat());process.exit(0);}

if(!token||!chatId){log('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 없어 종료합니다.');process.exit(1);}
try{
  const old=Number(fs.readFileSync(pidFile,'utf8').trim());
  if(old&&old!==process.pid){try{process.kill(old,0);log(`이미 실행 중(pid ${old}) — 종료`);process.exit(0);}catch(e){if(e.code==='EPERM'){log(`이미 실행 중(pid ${old}) — 종료`);process.exit(0);}}}
}catch{}
try{fs.writeFileSync(pidFile,String(process.pid));}catch{}
process.on('exit',()=>{try{if(fs.readFileSync(pidFile,'utf8').trim()===String(process.pid))fs.unlinkSync(pidFile);}catch{}});

const api=async(method,body,timeoutMs=70000)=>{
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(timeoutMs)});
  const j=await r.json().catch(()=>({}));
  return {status:r.status,json:j};
};
const send=async(text,extra={})=>{try{const r=await api('sendMessage',{chat_id:chatId,text,...extra},20000);if(r.status!==200)log(`sendMessage HTTP ${r.status}`);}catch(e){log('sendMessage 오류: '+e.message);}};

const keyboard={keyboard:[[{text:'/stat'}],[{text:'/start'},{text:'/stop'}]],resize_keyboard:true,is_persistent:true};
// [사용자 변경 2026-10-18] /start /stop → addons/tg-control.ps1(모니터 버튼 UIAutomation). 한 번에 하나만.
let controlBusy=false;
const control=action=>new Promise(res=>execFile('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'addons','tg-control.ps1'),action],{encoding:'utf8',timeout:300000,windowsHide:true},(e,out)=>res((out||'').trim().split(/\r?\n/).pop()||('X '+(e?.message||'응답 없음')))));
const handle=async text=>{
  const cmd=(text||'').trim().split(/\s+/)[0].replace(/@.*$/,'').toLowerCase();
  if(cmd==='/stat')await send(buildStat());
  else if(cmd==='/start'||cmd==='/stop'){
    if(controlBusy){await send('[꿈마] 이전 명령 처리 중입니다. 잠시 뒤 다시 보내 주세요.');return;}
    controlBusy=true;log('제어 '+cmd);
    try{await send(`[꿈마] ${cmd} 처리 중...`,{reply_markup:keyboard});const r=await control(cmd.slice(1));log('제어 결과 '+r);await send(`[꿈마] ${cmd}: ${r}`);}
    finally{controlBusy=false;}
  }
};

(async()=>{
  // 명령어 메뉴 등록은 성공할 때까지 폴링 반복마다 다시 시도한다(시작 직후 네트워크가 잠깐 안 될 수 있음, 10-18 실측).
  let commandsSet=false;
  const setCommands=async()=>{try{const r=await api('setMyCommands',{commands:[{command:'stat',description:'오늘 납품·이번 실행 이후 납품·현재 상태'},{command:'start',description:'게임 켜고 시작(창고부터)'},{command:'stop',description:'게임앱종료&타운쉽모니터 일시중지'}]},20000);commandsSet=r.status===200;if(commandsSet)log('명령어 메뉴 등록');}catch(e){log('setMyCommands 오류: '+e.message);}};
  let offset=readJson(offsetFile,{})?.offset||0;
  log('텔레그램 봇 시작');
  for(;;){
    if(!commandsSet)await setCommands();
    try{
      const r=await api('getUpdates',{timeout:50,offset,allowed_updates:['message']});
      if(r.status===409){log('다른 곳에서 getUpdates 중(HTTP 409) — 종료');process.exit(1);}
      if(r.status!==200||!r.json.ok){log(`getUpdates HTTP ${r.status}`);await new Promise(s=>setTimeout(s,10000));continue;}
      for(const u of r.json.result){
        offset=u.update_id+1;
        const m=u.message;
        if(m&&String(m.chat?.id)===String(chatId)){try{await handle(m.text);}catch(e){log('처리 오류: '+e.message);}}
      }
      if(r.json.result.length)try{fs.writeFileSync(offsetFile,JSON.stringify({offset}));}catch{}
    }catch(e){log('네트워크 오류: '+e.message);await new Promise(s=>setTimeout(s,10000));}
  }
})();
