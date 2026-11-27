// explicit measured regions, never guessed anatomical landmarks.
import {decodeAssetRgba,encodeAssetRgba,checkAssetImage,VISIBLE_ALPHA_THRESHOLD} from './asset-image-processing.js'
import {checkAvatarFraming} from './avatar-framing.js'
import {resizeImage,cropImage} from './sprite-blink-patch.js'
const fail=message=>{throw Object.assign(new Error(message),{code:'PRECONDITION'})}
const warning=(code,message)=>({code,severity:'warning',message})
function rect(r,image,label) {
  if(!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite)||r[0]<0||r[1]<0||r[2]<=0||r[3]<=0||r[0]+r[2]>image.width||r[1]+r[3]>image.height)fail(label+' must be x,y,w,h inside the source canvas')
  return r
}
function normalizedHeadRect(head,image,width,height) {
  const scale=Math.min(width/image.width,height/image.height),w=Math.round(image.width*scale),h=Math.round(image.height*scale)
  const x=Math.floor((width-w)/2),y=Math.floor((height-h)/2)
  const left=Math.round(head[0]*w/image.width),top=Math.round(head[1]*h/image.height)
  return [x+left,y+top,Math.round((head[0]+head[2])*w/image.width)-left,Math.round((head[1]+head[3])*h/image.height)-top]
}
function matchAvatarReference(output,headRect,reference) {
  const source=decodeAssetRgba(reference.bytes),head=rect(reference.geometry.headRect,source,'referenceHeadRect')
  const normalized=normalizeAvatar(reference.bytes,'1024x1024',reference.geometry)
  const candidate=checkAvatarFraming(output,{headRect}),baseline=checkAvatarFraming(normalized.bytes,{headRect:normalizedHeadRect(head,source,1024,1024)})
  const replaced=new Set(['AVATAR_HEAD_SCALE','AVATAR_HEADROOM','AVATAR_CENTER','AVATAR_SIDE_HAIR','AVATAR_NECK_SHOULDERS'])
  const warnings=candidate.warnings.filter(w=>!replaced.has(w.code))
  const metrics=result=>result.headBBox&&{
    headHeight:result.headBBox.h/result.height,crownY:result.headBBox.y/result.height,
    chinY:(result.headBBox.y+result.headBBox.h)/result.height,centerX:result.metrics.headCenterX,
    leftHairMargin:result.metrics.leftHairMarginRatio,rightHairMargin:result.metrics.rightHairMarginRatio,
    bottomGap:result.metrics.bottomGapRatio,shoulderWidth:result.metrics.shoulderWidthRatio,neckVisible:Number(result.metrics.neckVisible),
  }
  const measured=metrics(candidate),expected=metrics(baseline),deltas={}
  if(!expected)warnings.push(warning('AVATAR_REFERENCE_INVALID','Installed default has no measurable head; remeasure referenceHeadRect'))
  if(measured&&expected)for(const key of Object.keys(expected)) {
    deltas[key]=measured[key]-expected[key]
    if(Math.abs(deltas[key])>reference.tolerance+1e-9)warnings.push(warning('AVATAR_REFERENCE_DELTA',`${key} delta ${(deltas[key]*100).toFixed(3)}% (${(deltas[key]*1024).toFixed(2)} px), allowed +/-${reference.tolerance*100}% of final 1024 canvas; adjust framing to installed default`))
  }
  return {mode:'match-reference',referenceRelative:2,pass:Boolean(measured&&expected)&&warnings.length===0,canvas:[1024,1024],tolerance:reference.tolerance,reference:{slot:reference.slot,hash:reference.hash,metrics:expected},metrics:measured,deltas,warnings}
}
export function normalizeAvatar(bytes,target='1024x1024',geometry={},reference) {
  const image=decodeAssetRgba(bytes),[width,height]=target.split('x').map(Number),warnings=[]
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)fail('Invalid avatar target')
  const mismatch=image.width!==width||image.height!==height
  let output=bytes,redo=false
  if(mismatch) {
    warnings.push(warning('AVATAR_SIZE_MISMATCH',`Received ${image.width}x${image.height}; target ${width}x${height}; one fixed-ratio resize`))
    const scale=Math.min(width/image.width,height/image.height),scaled=resizeImage(image,Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale))),data=new Uint8ClampedArray(width*height*4),x=Math.floor((width-scaled.width)/2),y=Math.floor((height-scaled.height)/2)
    for(let row=0;row<scaled.height;row++)data.set(scaled.data.subarray(row*scaled.width*4,(row+1)*scaled.width*4),((row+y)*width+x)*4)
    output=encodeAssetRgba({width,height,data})
  }
  let qa
  const head=geometry.headRect
  if(!head){redo=true;warnings.push(warning('AVATAR_HEAD_REQUIRED','Supply a measured headRect; alpha bounds cannot identify a head. Needs redo/review, never automatic retry.'))}
  else {
    rect(head,image,'headRect')
    const framing=reference?matchAvatarReference(output,normalizedHeadRect(head,image,width,height),reference):checkAvatarFraming(bytes,{headRect:head.map(Math.round)})
    qa=framing
    redo=!framing.pass;warnings.push(...framing.warnings)
    if(redo)warnings.push(warning('AVATAR_FRAMING_REDO','Head position, scale or margins failed framing limits; redo explicitly, no automatic retry.'))
  }
  if(geometry.occlusion!==undefined) {
    if(geometry.occlusion!=='headwear')fail('occlusion must be headwear')
    warnings.push(warning('AVATAR_OCCLUSION','occlusion: headwear; measured visible headwear top substitutes for crown; review against installed default'))
  }
  return {bytes:output,warnings,redo,geometry,qa,resizeCount:mismatch?1:0}
}
export function extractEyeRegion(baseBytes,editBytes,geometry) {
  const base=decodeAssetRgba(baseBytes),edit=decodeAssetRgba(editBytes)
  if(base.width!==edit.width||base.height!==edit.height)fail('Blink edit must use registered canvas')
  if (geometry?.eyeMasks !== undefined) return extractMaskedEyes(base,edit,geometry)
  if (geometry?.tearMasks !== undefined) fail('tearMasks requires per-eye eyeMasks')
  if(!geometry?.headRect||!geometry?.eyeRect)fail('Blink requires explicit headRect and eyeRect from registered calm anchors or outfit geometry')
  const head=rect(geometry.headRect,base,'headRect'),roi=rect(geometry.eyeRect,base,'eyeRect')
  if(!roi.every(Number.isInteger))fail('eyeRect must use integer pixels')
  const [hx,hy,hw,hh]=head,[x,y,w,h]=roi
  const band=Math.max(geometry.browBottom??hy+hh*0.25,geometry.hairBottom??hy+hh*0.25)
  if(x<hx||x+w>hx+hw||y<band||y+h>hy+hh*0.7||w>hw*0.95||h>hh*0.3)fail('Eye ROI overlaps brow/hair band or has implausible size/position relative to head')
  let left=x+w,top=y+h,right=-1,bottom=-1
  for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++) {
    const i=(yy*base.width+xx)*4
    if(Math.max(base.data[i+3],edit.data[i+3])<=VISIBLE_ALPHA_THRESHOLD)continue
    if(Math.max(...[0,1,2,3].map(c=>Math.abs(base.data[i+c]-edit.data[i+c])))<=24)continue
    left=Math.min(left,xx);top=Math.min(top,yy);right=Math.max(right,xx);bottom=Math.max(bottom,yy)
  }
  if(right<left||bottom<top)fail('No eye change inside explicit ROI')
  const r=[left,top,right-left+1,bottom-top+1]
  if(r[2]<hw*0.08||r[3]>hh*0.3||top<band)fail('Extracted blink fails head-relative eye geometry')
  return {bytes:encodeAssetRgba(cropImage(edit,...r)),rect:r,blend:'replace',warnings:[]}
}
function extractMaskedEyes(base,edit,geometry) {
  const head=rect(geometry.headRect,base,'headRect'),[hx,hy,hw,hh]=head
  const masks=geometry.eyeMasks
  if(!Array.isArray(masks)||masks.length!==2)fail('eyeMasks requires two measured eye polygons')
  const tears=geometry.tearMasks??[]
  if(!Array.isArray(tears)||tears.length>16)fail('tearMasks must contain at most 16 measured tear polygons')
  for(const [polygons,bounds,label] of [[masks,head,'Eye'],[tears,[0,0,base.width,base.height],'Tear']])for(const polygon of polygons) {
    if(!Array.isArray(polygon)||polygon.length<3||polygon.length>64)fail(label+' mask requires 3..64 polygon vertices')
    const [x,y,w,h]=bounds
    for(const point of polygon)if(!Array.isArray(point)||point.length!==2||!point.every(Number.isInteger)||point[0]<x||point[0]>x+w||point[1]<y||point[1]>y+h)fail(label+' mask vertices must be integer pixels inside '+(label==='Eye'?'headRect':'source canvas'))
  }
  const inside=(polygon,x,y)=>{
    let hit=false
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const a=polygon[i],b=polygon[j]
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit
    }
    return hit
  }
  const data=new Uint8ClampedArray(base.data.length),counts=[0,0],changes=[0,0]
  let left=base.width,top=base.height,right=-1,bottom=-1,alphaRestored=0,tearPixels=0,tearLoss=0
  for(let y=Math.floor(hy);y<hy+hh;y++)for(let x=Math.floor(hx);x<hx+hw;x++) {
    const hits=masks.map(p=>inside(p,x+0.5,y+0.5))
    if(hits[0]&&hits[1])fail('Per-eye masks must not overlap')
    const eye=hits.findIndex(Boolean);if(eye<0)continue
    const i=(y*base.width+x)*4
    if(Math.max(base.data[i+3],edit.data[i+3])<=VISIBLE_ALPHA_THRESHOLD)continue
    // Transparent patch pixels leave the original tears above any overlapping lash paint.
    if(tears.some(p=>inside(p,x+0.5,y+0.5))) {
      tearPixels++
      if(base.data[i+3]>VISIBLE_ALPHA_THRESHOLD&&[0,1,2,3].some(c=>base.data[i+c]!==edit.data[i+c]))tearLoss++
      continue
    }
    // Quantization tolerance, not permission to cut holes: retain the original coverage.
    const originalAlpha=base.data[i+3],candidateAlpha=edit.data[i+3],drop=originalAlpha-candidateAlpha
    if(drop>0&&!(candidateAlpha>VISIBLE_ALPHA_THRESHOLD&&(candidateAlpha>=250||drop<=4)))fail('Blink mask cannot replace opaque skin with transparency')
    data.set(edit.data.subarray(i,i+4),i);counts[eye]++
    if(candidateAlpha!==originalAlpha&&(drop>0||candidateAlpha>=250&&originalAlpha>=250)){data[i+3]=originalAlpha;alphaRestored++}
    if([0,1,2,3].some(c=>Math.abs(base.data[i+c]-edit.data[i+c])>24))changes[eye]++
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)
  }
  if(counts.some(n=>!n)||changes.some(n=>!n))fail('Both eye masks must contain visible pixels and a real eye change')
  const r=[left,top,right-left+1,bottom-top+1]
  const warnings=[]
  if(alphaRestored)warnings.push(warning('BLINK_ALPHA_RESTORED',`${alphaRestored} eye pixels retained original alpha (candidate >=250 or opacity drop <=4; transparent holes rejected).`))
  if(tearPixels)warnings.push(warning('BLINK_TEARS_PROTECTED',`${tearPixels} overlapping tear-mask pixels excluded from lash replacement; original tears remain above lashes.`))
  if(tearLoss)warnings.push(warning('BLINK_TEAR_LOSS_PREVENTED',`${tearLoss} original tear pixels differ in the candidate; replacement excluded. Check tear masks and lash continuity manually.`))
  return {bytes:encodeAssetRgba(cropImage({...base,data},...r)),rect:r,blend:'replace',warnings}
}
export function measureMouthOpening(bytes,{threshold=70,skinRgb,colorDistance=24,interiorInset=0,centerX}={}) {
  const image=decodeAssetRgba(bytes),{width,height,data}=image
  if(!Number.isFinite(threshold)||threshold<0||threshold>255)fail('Legacy threshold must be 0..255 (not used for aperture)')
  if(!Number.isFinite(colorDistance)||colorDistance<1||colorDistance>255)fail('colorDistance must be 1..255')
  const samples=[]
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x===0||y===0||x===width-1||y===height-1) {
    const i=(y*width+x)*4;if(data[i+3]>VISIBLE_ALPHA_THRESHOLD)samples.push([...data.subarray(i,i+3)])
  }
  if(skinRgb!==undefined&&(!Array.isArray(skinRgb)||skinRgb.length!==3||!skinRgb.every(n=>Number.isFinite(n)&&n>=0&&n<=255)))fail('skinRgb must be three 0..255 channels')
  if(!skinRgb&&!samples.length)return {method:'skin-distance-v1',opening:0,area:0,confident:false,warnings:[warning('MOUTH_SKIN_REFERENCE_REQUIRED','Transparent crop has no surrounding skin; supply measured skinRgb or a wider mouth crop. No automatic ordering.')]}
  const median=v=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)]
  const skin=skinRgb||[0,1,2].map(c=>median(samples.map(s=>s[c])))
  const distance=rgb=>Math.sqrt(rgb.reduce((sum,n,c)=>sum+(n-skin[c])**2,0)/3)
  const mask=new Uint8Array(width*height),outside=new Uint8Array(mask.length),queue=[]
  for(let i=0;i<mask.length;i++)if(data[i*4+3]>VISIBLE_ALPHA_THRESHOLD&&distance([...data.subarray(i*4,i*4+3)])>=colorDistance)mask[i]=1
  const neighbours=at=>{const x=at%width,y=Math.floor(at/width);return [x?at-1:-1,x+1<width?at+1:-1,y?at-width:-1,y+1<height?at+width:-1]}
  // A coloured lip boundary can enclose near-white teeth or pale pink skin-like interiors.
  for(let i=0;i<mask.length;i++)if((i<width||i>=width*(height-1)||i%width===0||i%width===width-1)&&!mask[i]){outside[i]=1;queue.push(i)}
  for(let q=0;q<queue.length;q++)for(const n of neighbours(queue[q]))if(n>=0&&!mask[n]&&!outside[n]){outside[n]=1;queue.push(n)}
  for(let i=0;i<mask.length;i++)if(!outside[i]&&data[i*4+3]>VISIBLE_ALPHA_THRESHOLD)mask[i]=1
  if(!Number.isInteger(interiorInset)||interiorInset<0||interiorInset>8)fail('interiorInset must be 0..8 pixels')
  if(centerX!==undefined&&(!Number.isFinite(centerX)||centerX<0||centerX>=width))fail('centerX must be inside the mouth crop')
  let best=0,opening=0,bbox=null,interiorArea=0,centralAperture=0
  for(let i=0;i<mask.length;i++)if(mask[i]) {
    queue.length=0;queue.push(i);mask[i]=0;let left=width,top=height,right=-1,bottom=-1
    for(let q=0;q<queue.length;q++){const at=queue[q],x=at%width,y=Math.floor(at/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);for(const n of neighbours(at))if(n>=0&&mask[n]){mask[n]=0;queue.push(n)}}
    if(queue.length>best){
      best=queue.length;opening=bottom-top+1;bbox=[left,top,right-left+1,bottom-top+1]
      if(centerX!==undefined){
        const heights=[]
        for(let x=Math.round(centerX)-1;x<=Math.round(centerX)+1;x++){
          const ys=queue.filter(at=>at%width===x).map(at=>Math.floor(at/width))
          if(ys.length)heights.push(Math.max(0,Math.max(...ys)-Math.min(...ys)+1-2*interiorInset))
        }
        centralAperture=heights.length?median(heights):null
      }
      if(interiorInset){
      const component=new Set(queue)
      interiorArea=queue.filter(at=>{
        const x=at%width,y=Math.floor(at/width)
        for(let dy=-interiorInset;dy<=interiorInset;dy++)for(let dx=-interiorInset;dx<=interiorInset;dx++)
          if(x+dx<0||x+dx>=width||y+dy<0||y+dy>=height||!component.has(at+dy*width+dx))return false
        return true
      }).length
      }
    }
  }
  const edge=Boolean(bbox&&(bbox[0]===0||bbox[1]===0||bbox[0]+bbox[2]===width||bbox[1]+bbox[3]===height))
  return {method:'skin-distance-v1',opening,area:best,...(centerX!==undefined?{centralAperture,centerX}:{}),...(interiorInset?{interiorArea,interiorInset}:{}),bbox,skinRgb:skin,colorDistance,confident:!edge,warnings:edge?[warning('MOUTH_CROP_EDGE','Lip component meets crop edge; verify the mouth ROI, no automatic ordering.')]:[]}
}
