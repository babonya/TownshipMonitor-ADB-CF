// Reference fractions describe game content, never the player chrome or desktop.
export function gameTransform({reference={width:1600,height:900},viewport,alignX=.5,alignY=.5,fit='contain'}={}){
  if(!viewport||![reference.width,reference.height,viewport.width,viewport.height].every(n=>Number.isFinite(n)&&n>0)||
    ![viewport.x,viewport.y].every(n=>Number.isFinite(n)&&n>=0)||![alignX,alignY].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||!['contain','height'].includes(fit))throw Error('COORDINATE_SPACE_INVALID');
  const scale=fit==='height'?viewport.height/reference.height:Math.min(viewport.width/reference.width,viewport.height/reference.height);
  return {reference:{...reference},viewport:{...viewport},scale,
    x:viewport.x+(viewport.width-reference.width*scale)*alignX,y:viewport.y+(viewport.height-reference.height*scale)*alignY};
}
export function referenceFractions(box,reference={width:1600,height:900}){
  if(!box||![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>reference.width||box.y+box.height>reference.height)throw Error('REFERENCE_BOX_INVALID');
  return {x:box.x/reference.width,y:box.y/reference.height,width:box.width/reference.width,height:box.height/reference.height};
}
export function nativeBox(fraction,transform){
  referenceFractions(fraction,{width:1,height:1});
  const {reference,scale,x,y}=transform;
  const left=Math.floor(x+fraction.x*reference.width*scale),top=Math.floor(y+fraction.y*reference.height*scale);
  const right=Math.ceil(x+(fraction.x+fraction.width)*reference.width*scale),bottom=Math.ceil(y+(fraction.y+fraction.height)*reference.height*scale);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function nativePoint(point,transform){
  if(!point||![point.x,point.y].every(Number.isFinite)||point.x<0||point.y<0||point.x>1||point.y>1)throw Error('REFERENCE_POINT_INVALID');
  return {x:transform.x+point.x*transform.reference.width*transform.scale,y:transform.y+point.y*transform.reference.height*transform.scale};
}
export function referencePoint(point,transform){
  const p={x:(point.x-transform.x)/(transform.reference.width*transform.scale),y:(point.y-transform.y)/(transform.reference.height*transform.scale)};
  nativePoint(p,transform);return p;
}
