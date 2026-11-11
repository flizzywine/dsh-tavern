import {decodeAssetRgba,VISIBLE_ALPHA_THRESHOLD} from './asset-image-processing.js'
import spec from './avatar-framing-spec.json' with {type:'json'}
export const AVATAR_FRAMING_SPEC=Object.freeze(spec)
const percent=n=>Number((n*100).toFixed(6))
const percentRange=range=>range.map(percent).join('-')
export function avatarFramingSummary() {
  const s=AVATAR_FRAMING_SPEC
  return `Target head height ${percent(s.targetHeadHeightRatio)}% (${percentRange(s.headHeightRatio)}%), headroom ${percentRange(s.topMarginRatio)}%, side hair >=${percent(s.minSideHairMarginRatio)}%, aspect ratio ${s.aspectRatio.join('-')}; calibrated spec: avatar-framing-spec.json; edge contact at zero margin requires manual clipping review.`
}
// Alpha locates visible boundaries; a measured crown-to-chin ROI supplies anatomy, never guessed.
export function checkAvatarFraming(bytes,geometry={}) {
  const image=decodeAssetRgba(bytes),{width,height,data}=image,warnings=[]
  const warn=(code,message)=>warnings.push({code,severity:'warning',symbol:'\u26a0',message})
  const bounds=([x,y,w,h])=>{
    let left=width,top=height,right=-1,bottom=-1,count=0
    for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)if(data[(yy*width+xx)*4+3]>VISIBLE_ALPHA_THRESHOLD){left=Math.min(left,xx);top=Math.min(top,yy);right=Math.max(right,xx);bottom=Math.max(bottom,yy);count++}
    return count?{x:left,y:top,w:right-left+1,h:bottom-top+1,count}:null
  }
  const full=bounds([0,0,width,height]),result={pass:false,width,height,alphaThreshold:8,spec:AVATAR_FRAMING_SPEC,alphaBBox:full,warnings,modified:false}
  if(!full){warn('EMPTY_IMAGE','No alpha>8 pixels');return result}
  const r=geometry.headRect
  if(!Array.isArray(r)||r.length!==4||!r.every(Number.isInteger)||r[0]<0||r[1]<0||r[2]<1||r[3]<1||r[0]+r[2]>width||r[1]+r[3]>height){warn('AVATAR_HEAD_REQUIRED','Supply integer headRect covering crown through chin; alpha alone cannot identify anatomy');return result}
  const head=bounds(r),chin=r[1]+r[3],hair=bounds([0,0,width,chin]),shoulders=bounds([0,Math.floor(height*0.85),width,height-Math.floor(height*0.85)])
  if(!head||!hair){warn('AVATAR_HEAD_EMPTY','Measured head region has no visible pixels');return result}
  const neckHeight=Math.min(height-chin,Math.max(1,Math.round(height*0.05)))
  const neck=neckHeight>0?bounds([Math.floor(width*0.4),chin,Math.max(1,Math.floor(width*0.2)),neckHeight]):null
  const metrics={headHeightRatio:head.h/height,topMarginRatio:full.y/height,leftHairMarginRatio:hair.x/width,rightHairMarginRatio:(width-hair.x-hair.w)/width,headCenterX:(head.x+head.w/2)/width,bottomGapRatio:(height-full.y-full.h)/height,shoulderWidthRatio:(shoulders?.w||0)/width,neckVisible:Boolean(neck)}
  const between=(n,[min,max])=>n>=min&&n<=max,s=AVATAR_FRAMING_SPEC
  if(!between(width/height,s.aspectRatio))warn('AVATAR_ASPECT_RATIO',`Calibrated canvas width/height must be ${s.aspectRatio.join('-')}; checking never crops or stretches`)
  if(full.count===width*height)warn('AVATAR_NO_TRANSPARENCY','Transparent background required for alpha boundary measurements')
  if(!between(metrics.headHeightRatio,s.headHeightRatio))warn('AVATAR_HEAD_SCALE',`Crown-to-chin height must be ${percentRange(s.headHeightRatio)}% (target ${percent(s.targetHeadHeightRatio)}%)`)
  if(!between(metrics.topMarginRatio,s.topMarginRatio))warn('AVATAR_HEADROOM',`Highest visible hair/ornament needs ${percentRange(s.topMarginRatio)}% top margin`)
  if(Math.min(metrics.leftHairMarginRatio,metrics.rightHairMarginRatio)<s.minSideHairMarginRatio)warn('AVATAR_SIDE_HAIR',`Head-band hair needs at least ${percent(s.minSideHairMarginRatio)}% margin on each side; inspect clipping manually`)
  if(!between(metrics.headCenterX,s.headCenterX))warn('AVATAR_CENTER',`Head center must be at ${percentRange(s.headCenterX)}% canvas width`)
  if(!neck||metrics.shoulderWidthRatio<s.minShoulderWidthRatio||metrics.bottomGapRatio>s.maxBottomGapRatio)warn('AVATAR_NECK_SHOULDERS',`Short neck and shoulder tops must remain visible; shoulder width >=${percent(s.minShoulderWidthRatio)}%, bottom gap <=${percent(s.maxBottomGapRatio)}%`)
  return {...result,pass:warnings.length===0,headBBox:head,headBandBBox:hair,metrics}
}
