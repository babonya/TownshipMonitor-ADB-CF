// [사용자 변경 2026-10-18] 텔레그램 /stat 명령 응답 봇: 폰에서 /stat 을 보내면 오늘 납품·이번 실행 이후 납품·현재 상태를 답장한다.
// 필요 환경변수: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (없으면 HKCU\Environment 에서 읽음). 토큰은 로그·출력에 남기지 않는다.
// 실행: node addons\telegram-bot.mjs   (검증: node addons\telegram-bot.mjs --selftest)
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {dailyDeliverySummary} from '../tools/mumu-daily-deliveries.mjs';
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

// [사용자 변경 2026-10-19] 맨 윗줄만 봐도 현재 상황(진행 단계 / 일시정지 / 꺼짐), 그 아래 오늘 납품과 시간별 집계(최근 5줄, 일시정지는 한 줄로).
const PHASE_KO={survey:'주문 훑기',shopping:'시장 구매',deliver:'배송',delete:'주문 삭제',recheck:'주문 재확인',reset_orders:'주문 새로고침 대기',barn_recovery:'창고 복구',recovering_camera:'카메라 맞추기',recovering_navigation:'화면 이동 복구',minigame_requesting:'미니게임 주문',hold:'보류',ready:'준비',acting:'조작',waiting_result:'결과 확인'};
const hm=d=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;
// 감시가 1분마다 남기는 runtime/stat-samples.jsonl({t,d,n,r}) → 시간별 줄.
function hourlyLines(now=new Date()){
  let rows=[];
  try{rows=fs.readFileSync(path.join(rt,'stat-samples.jsonl'),'utf8').split(/\r?\n/).map(x=>{try{const j=JSON.parse(x.replace(/^\uFEFF/,''));const t=new Date(j.t);return isNaN(t)?null:{t,n:Number(j.n)||0,r:!!j.r};}catch{return null;}}).filter(Boolean);}catch{}
  const midnight=new Date(now);midnight.setHours(0,0,0,0);
  const firstRun=rows.findIndex(x=>x.r&&x.t>=midnight);
  if(firstRun<0)return ['시간별 집계: 오늘 실행 기록 없음'];
  rows=rows.slice(firstRun);
  const start=rows[0].t,buckets=[];
  for(let h=new Date(start);h<=now;h=new Date(h.getTime()+3600000)){
    const b=new Date(h);b.setMinutes(0,0,0);if(buckets.length&&buckets.at(-1).from.getTime()===b.getTime())continue;
    buckets.push({from:b,run:0,stop:0,add:0});
  }
  for(let i=0;i<rows.length;i++){
    const x=rows[i],b=buckets.find(b=>x.t>=b.from&&x.t<new Date(b.from.getTime()+3600000));if(!b)continue;
    if(x.r)b.run++;else b.stop++;
    if(i>0){const p=rows[i-1];b.add+=x.n>=p.n?x.n-p.n:x.n;}   // 날짜가 바뀌어 0부터 다시 세면 새 값만 더한다
  }
  const out=[];
  for(const b of buckets){
    const h=b.from.getHours(),cur=now-b.from<3600000;
    if(b.run===0&&b.add===0){const last=out.at(-1);if(last?.pause){last.to=h+1;continue;}out.push({pause:true,from:h,to:h+1});continue;}
    out.push({text:`~${(h+1)%24}시: +${b.add}${b.stop>=10?` (정지 ${b.stop}분)`:''}${cur?' (지금)':''}`});
  }
  return [`시작 ${hm(start)}`,...out.slice(-5).map(o=>o.pause?`${o.from}~${o.to%24}시: 일시정지`:o.text)];
}
function buildStat(){
  let date='',total=null;
  try{
    const first=execFileSync('node',[path.join(root,'addons','delivery-count.mjs')],{encoding:'utf8',cwd:root,stdio:['ignore','pipe','ignore'],timeout:30000}).split(/\r?\n/)[0].trim();
    [date,total]=first.split(' ');total=Number(total);if(!Number.isFinite(total))total=null;
  }catch{}
  let alive=null;
  try{alive=/TownshipMonitor\.exe/i.test(execFileSync('tasklist',['/FI','IMAGENAME eq TownshipMonitor.exe'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{}
  // [2026-10-18] delivery.json 상태는 지난 기록일 수 있어 모니터 화면의 현재 상태 글자로 실행·정지를 판단한다.
  let now='';
  if(alive)try{now=execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'addons','tg-control.ps1'),'status'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:30000,windowsHide:true}).trim();}catch{}
  let st={},age=null;
  try{const f=path.join(rt,'mumu-autonomous-transport','.monitor','delivery.json');st=readJson(f)?.record?.status||{};age=Math.round((Date.now()-fs.statSync(f).mtimeMs)/1000);}catch{}
  const code=(now.match(/·\s*([A-Z][A-Z0-9_]+)/)||[])[1];
  let head;
  if(alive===false)head='모니터 꺼짐';
  else if(alive===null||!now)head='상태 확인 실패';
  else if(now.startsWith('일시정지'))head='현재 일시정지 중'+(code?` (오류 ${code})`:'');
  else{
    const key=['acting','waiting_result','ready'].includes(st.phase)&&st.step?st.step:st.phase;   // 조작·결과 확인은 지금 단계(시장 구매 등)로 보여 준다
    const phase=st.phase==='hold'&&st.reason?`보류 · ${st.reason}`:(PHASE_KO[key]||key||'실행');
    head=`${phase} 중`+(code&&code!==st.reason?` · ${code}`:'')+(age!==null&&age>=300?` (${Math.round(age/60)}분째 그대로)`:'');
  }
  // [사용자 변경 2026-10-23] 어제 총 납품도 같이: '오늘 xx건 (어제 xxx건)'. 모니터와 같은 계산(한국 날짜 기준, mumu-daily-deliveries.mjs).
  let yesterday=null;
  try{const st=readJson(path.join(rt,'mumu-autonomous-transport','state.json'))?.state;if(st)yesterday=dailyDeliverySummary(st).yesterdayCompletedDeliveries;}catch{}
  const lines=[`[꿈마] ${head}`,`오늘 ${total===null?'납품 확인 실패':total+'건'}${yesterday===null?'':` (어제 ${yesterday}건)`}`,''];
  try{lines.push(...hourlyLines());}catch{lines.push('시간별 집계: 확인 실패');}
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

// [사용자 변경 2026-10-19] /stat 에 현재 폰 화면 사진을 붙인다. 사진은 runtime/screenshots/stat-*.png 로 남기고 4일 지나면 지운다(감시의 복구 실패 화면과 같은 폴더).
const shotDir=path.join(rt,'screenshots');
const deviceSerial=()=>process.env.TOWNSHIP_SERIAL?.trim()||String(readJson(path.join(root,'setup-local','device.json'))?.serial||'').trim();
const clearOldShots=()=>{try{for(const f of fs.readdirSync(shotDir)){const p=path.join(shotDir,f);if(Date.now()-fs.statSync(p).mtimeMs>4*86400000)fs.unlinkSync(p);}}catch{}};
const captureScreen=()=>new Promise((res,rej)=>{
  const serial=deviceSerial();if(!serial)return rej(Error('폰 시리얼 없음'));
  const adb=path.join(process.env.LOCALAPPDATA||'','Android','Sdk','platform-tools','adb.exe');
  execFile(adb,['-s',serial,'exec-out','screencap','-p'],{encoding:'buffer',maxBuffer:32<<20,timeout:20000,windowsHide:true,env:{...process.env,ANDROID_ADB_SERVER_PORT:'15037'}},(e,out)=>{
    if(e)return rej(e);if(!out||out.length<1000||out.readUInt32BE(0)!==0x89504e47)return rej(Error('화면 캡처 실패'));
    const d=new Date(),file=path.join(shotDir,`stat-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`);
    try{fs.mkdirSync(shotDir,{recursive:true});fs.writeFileSync(file,out);}catch(err){return rej(err);}
    res({file,bytes:out});
  });
});
const sendPhoto=async(bytes,caption)=>{
  const fd=new FormData();fd.append('chat_id',chatId);fd.append('caption',caption);fd.append('photo',new Blob([bytes],{type:'image/png'}),'screen.png');
  const r=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:'POST',body:fd,signal:AbortSignal.timeout(60000)});
  if(r.status!==200)log(`sendPhoto HTTP ${r.status}`);return r.status===200;
};
const sendStat=async()=>{
  const text=buildStat();clearOldShots();
  let shot=null;try{shot=await captureScreen();}catch(e){log('화면 캡처 오류: '+e.message);}
  if(!shot){await send(text+'\n화면: 캡처 실패');return;}
  // 텔레그램 사진 설명은 1024자까지 — 넘으면 글을 따로 보낸다.
  const long=text.length>1000;if(long)await send(text);
  let ok=false;try{ok=await sendPhoto(shot.bytes,long?'[꿈마] 현재 화면':text);}catch(e){log('sendPhoto 오류: '+e.message);}
  if(!ok&&!long)await send(text+'\n화면: 사진 전송 실패');
};

const keyboard={keyboard:[[{text:'/stat'}],[{text:'/start'},{text:'/stop'}]],resize_keyboard:true,is_persistent:true};
// [사용자 변경 2026-10-18] /start /stop → addons/tg-control.ps1(모니터 버튼 UIAutomation). 한 번에 하나만.
let controlBusy=false;
const control=action=>new Promise(res=>execFile('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'addons','tg-control.ps1'),action],{encoding:'utf8',timeout:300000,windowsHide:true},(e,out)=>res((out||'').trim().split(/\r?\n/).pop()||('X '+(e?.message||'응답 없음')))));
const handle=async text=>{
  const cmd=(text||'').trim().split(/\s+/)[0].replace(/@.*$/,'').toLowerCase();
  if(cmd==='/stat')await sendStat();
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
  const setCommands=async()=>{try{const r=await api('setMyCommands',{commands:[{command:'stat',description:'오늘 납품·이번 실행 이후 납품·현재 상태·화면 사진'},{command:'start',description:'게임 켜고 시작(창고부터)'},{command:'stop',description:'게임앱종료&타운쉽모니터 일시중지'}]},20000);commandsSet=r.status===200;if(commandsSet)log('명령어 메뉴 등록');}catch(e){log('setMyCommands 오류: '+e.message);}};
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
