// deterministic operations; no anatomical recognition or aesthetic approval.
import {decodeAssetRgba,encodeAssetRgba,checkAssetImage} from './asset-image-processing.js'
import {imageDimensions,imageKind} from '../../packages/dsh-asset-library/lib/pack-v2/media.js'
import {resizeImage,cropImage,extractBlinkPatch,alignEdit} from './sprite-blink-patch.js'
import {sourceBoundMouthPatch} from './sprite-mouth-matte.js'
const fail = message => {throw Object.assign(new Error(message),{code:'PRECONDITION'})}
export {registerSprite} from './asset-image-processing.js'
export function cropAvatar(bytes, rect) {
  const image=decodeAssetRgba(bytes)
  if(!Array.isArray(rect)||rect.length!==4||!rect.every(Number.isInteger)||rect[0]<0||rect[1]<0||rect[2]<=0||rect[3]<=0||rect[0]+rect[2]>image.width||rect[1]+rect[3]>image.height) fail('Crop rect x,y,w,h must be inside the source canvas (pixels)')
  const crop=cropImage(image,...rect),side=Math.max(crop.width,crop.height),data=new Uint8ClampedArray(side*side*4)
  const x=Math.floor((side-crop.width)/2),y=Math.floor((side-crop.height)/2)
  for(let row=0;row<crop.height;row++)data.set(crop.data.subarray(row*crop.width*4,(row+1)*crop.width*4),((row+y)*side+x)*4)
  return encodeAssetRgba({width:side,height:side,data})
}
export function extractProductionPatch(baseBytes, editBytes, kind, rect, geometry) {
  const size=imageDimensions(baseBytes,imageKind(baseBytes)),base=kind==='mouth'?{width:size[0],height:size[1]}:decodeAssetRgba(baseBytes),edit=decodeAssetRgba(editBytes)
  if(base.width!==edit.width||base.height!==edit.height) fail('Edit must use the registered sprite canvas dimensions')
  if(kind==='mouth') {
    if(!rect)fail('Mouth requires an explicit pixel rect, shared by all four levels')
    if(geometry?.mouthMask) {
      const patch=sourceBoundMouthPatch(decodeAssetRgba(baseBytes),edit,rect,geometry.mouthMask)
      return {bytes:encodeAssetRgba(patch),rect,blend:'replace',warnings:[]}
    }
    const patch=cropAvatar(editBytes,rect)
    if(rect[2]!==rect[3]) return {bytes:encodeAssetRgba(cropImage(edit,...rect)),rect,warnings:[]}
    return {bytes:patch,rect,warnings:[]}
  }
  const aligned=alignEdit(base,edit),result=extractBlinkPatch(base,aligned.image)
  if(!result.patch)fail('No extractable eye change; supply a real closed-eye edit or mark this state eyesClosed')
  return {bytes:encodeAssetRgba(result.patch),rect:result.rect,warnings:result.warnings.map(message=>({code:'BLINK_DIFF',severity:'warning',message}))}
}
