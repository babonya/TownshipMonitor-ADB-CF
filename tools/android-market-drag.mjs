// Android market-only drag. Capture starts on the device at the held endpoint.
// Run with `adb exec-out` (binary-safe, stderr merged into stdout). The markers go first on stdout,
// the raw screencap (no PNG encoding on the phone) is written to a temp file and cat after release,
// so marker lines can never interleave with the image bytes.
export const MARKET_HOLD_MS=200;
export const MARKET_ENDPOINT='TOWNSHIP_MARKET_ENDPOINT';
export const MARKET_RELEASED='TOWNSHIP_MARKET_RELEASED';
export const MARKET_CAPTURE_PREFIX=`${MARKET_ENDPOINT}\n${MARKET_RELEASED}\n`;
export function marketDragScript(c,display){
  if(c.type!=='swipe'||![c.x1,c.y1,c.x2,c.y2,c.durationMs].every(Number.isSafeInteger)||
    Math.min(c.x1,c.y1,c.x2,c.y2)<0||c.y1!==c.y2||c.durationMs<200||c.durationMs>2000||!/^\d{1,20}$/.test(display))throw Error('ANDROID_MARKET_DRAG_INVALID');
  // [2026-10-19] MOVE마다 input 프로세스 기동(약 0.1초)이 들어 12단계면 스와이프가 1.7초 → 4단계로(끝점 hold·캡처는 그대로).
  const input='input touchscreen -d 0 motionevent',steps=4;
  const lines=['set -e','down=0','file=/data/local/tmp/township_endpoint_$$.raw',
    `cleanup() { if [ "$down" = 1 ]; then ${input} UP ${c.x2} ${c.y2} >/dev/null 2>&1; fi; rm -f "$file"; }`,
    "trap cleanup EXIT",`${input} DOWN ${c.x1} ${c.y1} >/dev/null 2>&1`,'down=1'];
  for(let n=1;n<=steps;n++)lines.push(`sleep ${(c.durationMs/steps/1000).toFixed(6)}`,
    `${input} MOVE ${Math.round(c.x1+(c.x2-c.x1)*n/steps)} ${c.y1} >/dev/null 2>&1`);
  lines.push(`echo ${MARKET_ENDPOINT}`,`screencap -d ${display} > "$file" 2>/dev/null &`,'capture_pid=$!',
    'sleep 0.2',`${input} UP ${c.x2} ${c.y2} >/dev/null 2>&1`,'down=0',`echo ${MARKET_RELEASED}`,'wait "$capture_pid"','cat "$file"');
  return lines.join('\n');
}
// Only a successful, released, exact-action capture can precede issuedAt.
export function endpointCaptureProof(action){
  const r=action?.deviceReceipt,p=r?.endpointCapture;
  if(!p||r.provider!=='android_adb'||!r.commandIssued||r.actionId!==action.id||
    action.target?.kind!=='som_scroll'||action.target?.som?.kind!=='som_scroll'||!action.somProof||
    action.command?.type!=='swipe'||JSON.stringify(r.command)!==JSON.stringify(action.command)||
    p.schema!==1||p.kind!=='android_market_endpoint'||p.actionId!==action.id||p.sourceFrameId!==action.frameId||p.epoch!==action.epoch||
    p.holdMs!==MARKET_HOLD_MS||!/^[a-f0-9]{64}$/.test(p.evidenceHash??''))return null;
  const times=[r.startedAt,p.startedAt,p.releasedAt,p.observedAt,r.completedAt].map(Date.parse);
  if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i&&t<times[i-1]))return null;
  return p;
}
export function matchesEndpointCapture(action,evidence){
  const p=endpointCaptureProof(action),q=evidence?.endpointCapture;
  return !!p&&JSON.stringify(p)===JSON.stringify(q)&&evidence.evidenceHash===p.evidenceHash&&
    (evidence.captureStartedAt??evidence.startedAt)===p.startedAt&&evidence.observedAt===p.observedAt;
}
