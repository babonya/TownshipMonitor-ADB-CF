import {decodePng} from '../adb.mjs';

// Reuse only within one visit and one registered geometry. These pixels are
// comparison evidence, never coordinates for another input.
function artwork(image){
  if(typeof image!=='string'||!image.startsWith('data:image/png;base64,'))return null;
  try{return decodePng(Buffer.from(image.slice(22),'base64'));}catch{return null;}
}
export function sameArtwork(a,b,{quantityOverlay=false}={}){
  if(!a||!b||a.channels<3||b.channels<3||a.width!==b.width||a.height!==b.height||a.width<16||a.height<16)return false;
  // Small translation absorbs crop/scroll raster rounding; a strict absolute
  // error and outlier cap prevent a shared background from deciding identity.
  for(const dy of [0,-1,1,-2,2])for(const dx of [0,-1,1,-2,2]){
    let sum=0,outliers=0,n=0;
    const sx=Math.max(1,Math.floor(a.width/32)),sy=Math.max(1,Math.floor(a.height/32));
    for(let y=3;y<a.height-3;y+=sy)for(let x=3;x<a.width-3;x+=sx){
      if(quantityOverlay&&((x>=a.width*.4&&y>=a.height*.65)||(x+dx>=b.width*.4&&y+dy>=b.height*.65)))continue;
      const i=(y*a.width+x)*a.channels,j=((y+dy)*b.width+x+dx)*b.channels;
      for(let c=0;c<3;c++){const d=Math.abs(a.pixels[i+c]-b.pixels[j+c]);sum+=d;if(d>12)outliers++;n++;}
    }
    if(n&&sum/n<=2&&outliers/n<=.01){
      sum=0;outliers=0;n=0;
      for(let y=3;y<a.height-3;y++)for(let x=3;x<a.width-3;x++){
        if(quantityOverlay&&((x>=a.width*.4&&y>=a.height*.65)||(x+dx>=b.width*.4&&y+dy>=b.height*.65)))continue;
        const i=(y*a.width+x)*a.channels,j=((y+dy)*b.width+x+dx)*b.channels;
        for(let c=0;c<3;c++){const d=Math.abs(a.pixels[i+c]-b.pixels[j+c]);sum+=d;if(d>12)outliers++;n++;}
      }
      if(sum/n<=2&&outliers/n<=.01)return true;
    }
  }
  return false;
}
export class MarketMemory{
  constructor(){this.clear();}
  clear(){this.scope=null;this.entries=[];this.decoded=new Map();this.quantityOverlay=false;}
  bind(v){
    // This overlay placement is validated only for the registered phone layout.
    // Keep full crops for D1 and for all other or unbound capture geometries.
    const quantityOverlay=v.provider==='android_adb'&&v.captureSize?.width===1544&&v.captureSize?.height===720;
    const scope=v.profileHash&&v.viewport?JSON.stringify([v.profileHash,v.viewport,v.view,v.provider,v.captureSize]):null;
    if(scope!==this.scope){this.clear();this.scope=scope;this.quantityOverlay=quantityOverlay;return true;}return false;
  }
  decode(cell){
    if(!this.decoded.has(cell.hash)){
      if(this.decoded.size>=256)this.decoded.delete(this.decoded.keys().next().value);
      this.decoded.set(cell.hash,artwork(cell.image));
    }
    return this.decoded.get(cell.hash);
  }
  seen(cell){return !!this.scope&&this.entries.some(e=>sameArtwork(e,this.decode(cell),{quantityOverlay:this.quantityOverlay}));}
  remember(cell){
    if(!this.scope)return;const im=this.decode(cell);if(!im)return;
    if(this.entries.length>=256)this.entries.shift();this.entries.push(im);
  }
}
