// Explicit mouth cores include both the old and new lips; feather only the surrounding skin.
const fail=message=>{throw Object.assign(new Error(message),{code:'PRECONDITION'})}
function inside(x,y,polygon) {
  let hit=false
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [ax,ay]=polygon[i],[bx,by]=polygon[j]
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)hit=!hit
  }
  return hit
}
function distance(x,y,polygon) {
  let nearest=Infinity
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [ax,ay]=polygon[i],[bx,by]=polygon[j],dx=bx-ax,dy=by-ay
    const t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)))
    nearest=Math.min(nearest,Math.hypot(x-ax-t*dx,y-ay-t*dy))
  }
  return nearest
}
export function sourceBoundMouthPatch(base,edit,rect,{core,feather=3}) {
  if(base.width!==edit.width||base.height!==edit.height)fail('Mouth matte requires the exact source canvas; never resize')
  if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isInteger))fail('Mouth rect must be integer source x,y,w,h')
  const [left,top,width,height]=rect
  if(left<0||top<0||width<=0||height<=0||left+width>base.width||top+height>base.height)fail('Mouth rect must be inside the source')
  if(!Number.isFinite(feather)||feather<=0||!Array.isArray(core)||!core.length)fail('mouthMask requires core polygons and a positive feather radius')
  // A two-pixel unchanged border makes the cropped patch safe under renderer filtering.
  for(const polygon of core)if(!Array.isArray(polygon)||polygon.length<3||polygon.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<left+feather+2||p[0]>left+width-feather-2||p[1]<top+feather+2||p[1]>top+height-feather-2))fail('Mouth core plus feather and 2px source border must fit the rect; widen the rect, not the mouth')
  const data=new Uint8ClampedArray(width*height*4),mask=new Uint8ClampedArray(width*height)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const sx=left+x,sy=top+y,src=(sy*base.width+sx)*4,dst=(y*width+x)*4
    let coverage=0
    for(const polygon of core) {
      const d=inside(sx+.5,sy+.5,polygon)?0:distance(sx+.5,sy+.5,polygon)
      const t=Math.max(0,1-d/feather)
      coverage=Math.max(coverage,t*t*(3-2*t))
    }
    mask[y*width+x]=Math.round(coverage*255)
    if(coverage&&base.data[src+3]<250)fail('Mouth matte must stay on near-opaque source skin (alpha >= 250); keep silhouette and alpha outside the mask')
    for(let c=0;c<3;c++)data[dst+c]=Math.round(base.data[src+c]*(1-coverage)+edit.data[src+c]*coverage)
    data[dst+3]=base.data[src+3]
  }
  // Bake against the bound source once: parts replace a group, while static mouths overlay it.
  // Both routes must receive identical face pixels, without double feathering or old-lip ghosts.
  return {width,height,data,mask}
}
