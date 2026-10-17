// Reusable input geometry is normalized; physical pixels are derived evidence.
// This module has no device access and deliberately imports no input adapter.
const fail=reason=>{throw Error(reason);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const integer=n=>Number.isSafeInteger(n);
const fraction=n=>Number.isFinite(n)&&n>=0&&n<1;
const nearest=n=>Math.round(n);
export function inputGeometry(session,frame){
  const width=frame.width??frame.dimensions?.width,height=frame.height??frame.dimensions?.height;
  if(!integer(width)||!integer(height)||width<1||height<1)fail('COORDINATE_GEOMETRY_INVALID');
  if(session.provider==='android_adb'&&(session.adbTarget?.width!==width||session.adbTarget?.height!==height))fail('COORDINATE_GEOMETRY_CHANGED');
  const native=session.provider==='google_play_windows';
  const viewport=native?session.windowsViewport:{x:0,y:0,width,height};
  if(!viewport||!['x','y','width','height'].every(k=>integer(viewport[k]))||viewport.x<0||viewport.y<0||viewport.width<1||viewport.height<1||viewport.x+viewport.width>width||viewport.y+viewport.height>height)fail('COORDINATE_GEOMETRY_INVALID');
  if(native&&(session.windowsCaptureSize?.width!==width||session.windowsCaptureSize?.height!==height))fail('COORDINATE_GEOMETRY_CHANGED');
  return {capture:{width,height},viewport:{...viewport}};
}
export function percentagePoint(point,geometry){
  const v=geometry.viewport;
  if(!integer(point.x)||!integer(point.y)||point.x<v.x||point.y<v.y||point.x>=v.x+v.width||point.y>=v.y+v.height)fail('INPUT_OUTSIDE_GAME_VIEWPORT');
  return {x:(point.x-v.x)/v.width,y:(point.y-v.y)/v.height};
}
export function resolvePercentagePoint(point,geometry){
  if(!point||!fraction(point.x)||!fraction(point.y))fail('INPUT_PERCENTAGE_INVALID');
  const v=geometry.viewport,p={x:v.x+nearest(point.x*v.width),y:v.y+nearest(point.y*v.height)};
  percentagePoint(p,geometry);return p;
}
export function percentageCommand(command,geometry){
  let normalized;
  if(command.type==='tap')normalized={type:'tap',...percentagePoint(command,geometry)};
  else if(command.type==='swipe'&&integer(command.durationMs)&&command.durationMs>=200&&command.durationMs<=2000){
    const a=percentagePoint({x:command.x1,y:command.y1},geometry),b=percentagePoint({x:command.x2,y:command.y2},geometry);
    normalized={type:'swipe',x1:a.x,y1:a.y,x2:b.x,y2:b.y,durationMs:command.durationMs};
  }else fail('NAVIGATION_INVALID');
  return {schema:1,unit:'fraction',space:'game',geometry:structuredClone(geometry),command:normalized};
}
export function resolvePercentageCommand(record,geometry,physical=null){
  if(record?.schema!==1||record.unit!=='fraction'||record.space!=='game'||!same(record.geometry,geometry))fail('INPUT_PERCENTAGE_GEOMETRY_CHANGED');
  const c=record.command;let resolved;
  if(c?.type==='tap')resolved={type:'tap',...resolvePercentagePoint(c,geometry)};
  else if(c?.type==='swipe'&&integer(c.durationMs)&&c.durationMs>=200&&c.durationMs<=2000){
    const a=resolvePercentagePoint({x:c.x1,y:c.y1},geometry),b=resolvePercentagePoint({x:c.x2,y:c.y2},geometry);
    resolved={type:'swipe',x1:a.x,y1:a.y,x2:b.x,y2:b.y,durationMs:c.durationMs};
  }else fail('INPUT_PERCENTAGE_INVALID');
  if(physical&&!same(resolved,physical))fail('INPUT_PERCENTAGE_COMMAND_CHANGED');return resolved;
}
export function commandForTarget(target,swipe,geometry){
  const b=target.box;
  const physical=target.type==='tap'?{type:'tap',x:Math.floor(b.x+b.width/2),y:Math.floor(b.y+b.height/2)}:{type:'swipe',...swipe};
  if(target.type==='swipe')for(const [x,y]of[[physical.x1,physical.y1],[physical.x2,physical.y2]])if(!integer(x)||!integer(y)||x<b.x||y<b.y||x>=b.x+b.width||y>=b.y+b.height)fail('SWIPE_OUTSIDE_REVIEWED_REGION');
  const coordinates=percentageCommand(physical,geometry);
  return {coordinates,command:resolvePercentageCommand(coordinates,geometry)};
}
