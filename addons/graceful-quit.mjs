// [2026-10-19 사용자 결정] 게임 정상 종료: 뒤로가기(시장·헬기 창은 닫힘 → 마을) → 'Are you sure?' 확인창에서 YES.
// force-stop은 진행이 서버에 저장되지 않을 수 있다(기기 간 경험치 차이, 작업현황 0-D).
// 사용: node graceful-quit.mjs <serial>  → stdout 'quit' | 'fallback'(못 찾아 실패)
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const serial=process.argv[2];
const adb=join(process.env.LOCALAPPDATA,'Android','Sdk','platform-tools','adb.exe');
const env={...process.env,ANDROID_ADB_SERVER_PORT:'15037'};
const run=(args,opts={})=>execFileSync(adb,['-s',serial,...args],{env,maxBuffer:64<<20,...opts});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function frame(){
  const b=run(['exec-out','screencap']);const w=b.readUInt32LE(0),h=b.readUInt32LE(4),off=b.length-w*h*4;
  return {w,h,px:(fx,fy)=>{const i=off+(Math.round(fy*h)*w+Math.round(fx*w))*4;return [b[i],b[i+1],b[i+2]];}};
}
// 확인창(1600x720 실측, 비율, 글자 피해서): NO (0.36,0.70) 초록, YES (0.535,0.70) 빨강, 창 가운데 (0.5,0.45) 밝은 베이지. 누르는 곳은 YES 가운데 (0.586,0.725).
function quitDialog(f){
  const [nr,ng,nb]=f.px(0.36,0.70),[yr,yg,yb]=f.px(0.535,0.70),[cr,cg,cb]=f.px(0.5,0.45);
  return ng>150&&nr<120&&nb<120&&yr>200&&yg<110&&yb<90&&cr>220&&cg>210&&cb>180;
}
const foreground=()=>{try{return /township/.test(run(['shell','dumpsys window | grep -m1 mCurrentFocus'],{stdio:['ignore','pipe','ignore']}).toString());}catch{return true;}};
for(let i=0;i<6;i++){
  if(!foreground())break;
  run(['shell','input','keyevent','4']);await sleep(1500);
  const f=frame();
  if(quitDialog(f)){
    run(['shell','input','tap',String(Math.round(0.586*f.w)),String(Math.round(0.725*f.h))]);
    for(let k=0;k<10;k++){await sleep(1000);if(!foreground()){process.stdout.write('quit');process.exit(0);}}
  }
}
process.stdout.write(foreground()?'fallback':'quit');
