// explicit sprite framing (dsh-assets 1.3.63). One spec drives both the sprite prompt's framing sentence and
// finalize's head-top/feet QA, so the request and the check can never disagree. Without it the sprite template's own
// default sentence (about 95%, 3% top, 2% bottom) is sent unchanged and finalize adds no sprite framing QA.
import {decodeAssetRgba,encodeAssetRgba,VISIBLE_ALPHA_THRESHOLD} from './asset-image-processing.js'
import {resizeImage,cropImage} from './sprite-blink-patch.js'
export const SPRITE_CANVAS = Object.freeze({width:1024,height:1536})
// Allowed distance between the requested and the measured head top / feet, as a share of the canvas height.
export const SPRITE_FRAMING_TOLERANCE = 0.02
export const SPRITE_DEFAULT_FRAMING_SENTENCE = 'The figure fills about 95% of the canvas height: the hair top and ornaments about 3% below the top edge, the soles about 2% above the bottom edge, nothing cropped.'
const invalid = message => Object.assign(new Error(message),{code:'INVALID_ARGUMENT'})
const percent = ratio => Math.round(ratio*100)

// framing = {headTop, feet}: y pixels of the highest hair/ornament point and of the soles on the 1024x1536 sprite canvas.
export function spriteFramingSpec(framing) {
  if (!framing || typeof framing !== 'object' || Array.isArray(framing) || Object.keys(framing).some(key => !['headTop','feet'].includes(key))) throw invalid('framing is {headTop, feet} in pixels of the 1024x1536 sprite canvas')
  const {headTop,feet} = framing, H = SPRITE_CANVAS.height
  if (![headTop,feet].every(Number.isInteger) || headTop < 0 || feet <= headTop || feet > H) throw invalid(`framing needs integer pixels 0 <= headTop < feet <= ${H}`)
  return {headTop,feet,canvas:[SPRITE_CANVAS.width,H],heightRatio:(feet-headTop)/H,topRatio:headTop/H,bottomRatio:(H-feet)/H,tolerancePx:SPRITE_FRAMING_TOLERANCE*H}
}
export function spriteFramingSentence(spec) {
  return `The figure fills about ${percent(spec.heightRatio)}% of the canvas height: the hair top and ornaments about ${percent(spec.topRatio)}% below the top edge (y≈${spec.headTop} of ${spec.canvas[1]} px), the soles about ${percent(spec.bottomRatio)}% above the bottom edge (y≈${spec.feet} px), nothing cropped.`
}
// Explicit numbers in the user's notes (percentages, pixels, y=…) must agree with the framing; otherwise the prompt would
// carry two framings. Agreement is the spec's own values; anything else is refused at prepare, before any image call.
export function assertFramingAgreesWithNotes(spec, notes = '') {
  const percents = [spec.heightRatio,spec.topRatio,spec.bottomRatio].map(r => r*100)
  const pixels = [spec.headTop,spec.feet,spec.feet-spec.headTop,...spec.canvas]
  const conflicts = []
  for (const match of notes.matchAll(/(\d+(?:\.\d+)?)\s*(%|％|px\b|像素)/gi)) {
    const value = Number(match[1]), allowed = match[2] === '%' || match[2] === '％' ? percents.some(p => Math.abs(p-value) <= 1) : pixels.some(p => Math.abs(p-value) <= 2)
    if (!allowed) conflicts.push(match[0])
  }
  for (const match of notes.matchAll(/\by\s*[=≈~:：]\s*(\d+(?:\.\d+)?)/gi)) if (!pixels.some(p => Math.abs(p-Number(match[1])) <= 2)) conflicts.push(match[0])
  if (conflicts.length) throw Object.assign(new Error(`The notes state framing numbers (${conflicts.join(', ')}) that differ from framing {headTop:${spec.headTop}, feet:${spec.feet}}. Keep framing numbers only in framing and remove them from the notes.`),{code:'INVALID_ARGUMENT'})
}
// Alpha bounds of the returned image, expressed on the 1536 px sprite canvas height.
export function measureSpriteFraming(bytes) {
  const {width,height,data} = decodeAssetRgba(bytes)
  let top = -1, bottom = -1
  for (let y = 0; y < height && top < 0; y++) for (let x = 0; x < width; x++) if (data[(y*width+x)*4+3] > VISIBLE_ALPHA_THRESHOLD) { top = y; break }
  for (let y = height-1; y >= 0 && bottom < 0; y--) for (let x = 0; x < width; x++) if (data[(y*width+x)*4+3] > VISIBLE_ALPHA_THRESHOLD) { bottom = y+1; break }
  const scale = SPRITE_CANVAS.height/height
  return top < 0 ? null : {headTop:Math.round(top*scale),feet:Math.round(bottom*scale),size:[width,height]}
}
export function checkSpriteFraming(bytes, framing) {
  const spec = spriteFramingSpec(framing), measured = measureSpriteFraming(bytes), warnings = []
  if (!measured) warnings.push({code:'SPRITE_FRAMING',severity:'warning',message:'No visible figure to measure'})
  else for (const key of ['headTop','feet']) {
    const delta = measured[key]-spec[key]
    if (Math.abs(delta) > spec.tolerancePx) warnings.push({code:'SPRITE_FRAMING',severity:'warning',message:`${key} y=${measured[key]} is ${delta > 0 ? '+' : ''}${delta} px from the requested ${spec[key]} (allowed ±${spec.tolerancePx.toFixed(2)} px of the ${spec.canvas[1]} px canvas)`})
  }
  return {target:{headTop:spec.headTop,feet:spec.feet},measured,tolerancePx:spec.tolerancePx,basis:`alpha>${VISIBLE_ALPHA_THRESHOLD} bounds on a ${spec.canvas.join('x')} canvas`,pass:!warnings.length,warnings}
}

// dsh-assets 1.3.64. Alpha at or below this is haze (a grey veil the model leaves around a cut-out), never figure.
export const HAZE_ALPHA_MAX = 32
// The solid figure mask is alpha > HAZE_ALPHA_MAX grown by this many px, so the figure's own anti-aliased rim stays in it.
export const SOLID_MASK_GROW = 2
// Report-only haze warning: share of the pixels outside the solid mask that carry haze alpha.
export const HAZE_WARNING_FRACTION = 0.001
function figureBounds({width,height,data}) {
  let left = width, right = -1, top = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y*width+x)*4+3] > HAZE_ALPHA_MAX) {
    if (top < 0) top = y
    bottom = y+1; if (x < left) left = x; if (x+1 > right) right = x+1
  }
  return top < 0 ? null : {left,top,right,bottom}
}
function solidMask({width,height,data}) {
  const solid = new Uint8Array(width*height), wide = new Uint8Array(width*height), mask = new Uint8Array(width*height), r = SOLID_MASK_GROW
  for (let p = 0; p < solid.length; p++) solid[p] = data[p*4+3] > HAZE_ALPHA_MAX ? 1 : 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (solid[y*width+x]) for (let i = Math.max(0,x-r); i <= Math.min(width-1,x+r); i++) wide[y*width+i] = 1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (wide[y*width+x]) for (let j = Math.max(0,y-r); j <= Math.min(height-1,y+r); j++) mask[j*width+x] = 1
  return mask
}
// Alpha QA (report only): the figure's maximum alpha must reach 255, and haze is the share of pixels outside the solid
// figure mask whose alpha is 1..HAZE_ALPHA_MAX.
export function measureSpriteAlpha(bytes) {
  const image = decodeAssetRgba(bytes), mask = solidMask(image), {data} = image
  let maxAlpha = 0, haze = 0, outside = 0
  for (let p = 0; p < mask.length; p++) {
    const a = data[p*4+3]
    if (mask[p]) { if (a > maxAlpha) maxAlpha = a; continue }
    outside++
    if (a >= 1 && a <= HAZE_ALPHA_MAX) haze++
  }
  const fraction = outside ? haze/outside : 0, warnings = []
  if (maxAlpha < 255) warnings.push({code:'ALPHA_NOT_OPAQUE',severity:'warning',message:`The figure's maximum alpha is ${maxAlpha}, not 255: the whole figure is slightly transparent`})
  if (fraction >= HAZE_WARNING_FRACTION) warnings.push({code:'ALPHA_HAZE',severity:'warning',message:`${haze} px (${(fraction*100).toFixed(2)}% of the area outside the figure) carry haze alpha 1..${HAZE_ALPHA_MAX}`})
  return {maxAlpha,haze:{pixels:haze,outsidePixels:outside,fraction},basis:`solid mask alpha>${HAZE_ALPHA_MAX} grown ${SOLID_MASK_GROW} px; haze alpha 1..${HAZE_ALPHA_MAX} outside it`,pass:!warnings.length,warnings}
}
// --clean-haze (opt-in): haze alpha outside the solid figure mask becomes 0. Colour and the figure are untouched.
export function cleanSpriteHaze(bytes) {
  const image = decodeAssetRgba(bytes), mask = solidMask(image)
  let pixels = 0
  for (let p = 0; p < mask.length; p++) if (!mask[p] && image.data[p*4+3] >= 1 && image.data[p*4+3] <= HAZE_ALPHA_MAX) { image.data[p*4+3] = 0; pixels++ }
  return {bytes:pixels ? encodeAssetRgba(image) : bytes,cleaned:{pixels,alphaMax:HAZE_ALPHA_MAX,maskGrowPx:SOLID_MASK_GROW}}
}
// A figure pixel at or above this alpha is meant to be opaque: models leave the whole figure at 250..254, which lets
// the stage show through it on dark backgrounds.
export const NEAR_OPAQUE_ALPHA_MIN = 250
// Host-side cleanup of a transparent sprite (dsh-assets alpha-clean, dot intake): near-opaque alpha becomes 255 and
// the haze outside the solid figure mask is zeroed exactly as cleanSpriteHaze does. Colour is untouched.
export function cleanSpriteAlpha(bytes) {
  const haze = cleanSpriteHaze(bytes), image = decodeAssetRgba(haze.bytes)
  let opaque = 0
  for (let p = 3; p < image.data.length; p += 4) if (image.data[p] >= NEAR_OPAQUE_ALPHA_MIN && image.data[p] < 255) { image.data[p] = 255; opaque++ }
  return {bytes:opaque ? encodeAssetRgba(image) : haze.bytes,cleaned:{haze:haze.cleaned,opaque:{pixels:opaque,alphaMin:NEAR_OPAQUE_ALPHA_MIN}}}
}
// --fit-framing (opt-in): scale the whole image down once (Lanczos3) and translate it by whole pixels so the figure's
// alpha>HAZE_ALPHA_MAX top and bottom land on framing; the horizontal centre stays. Never enlarges, never edits content.
export function fitSpriteFraming(bytes, framing) {
  const spec = spriteFramingSpec(framing), image = decodeAssetRgba(bytes), {width,height} = image, k = height/spec.canvas[1]
  const source = figureBounds(image)
  if (!source) throw invalid(`fit-framing: no figure above alpha ${HAZE_ALPHA_MAX}`)
  const targetTop = spec.headTop*k, scale = (spec.feet-spec.headTop)*k/(source.bottom-source.top)
  if (scale > 1) throw invalid(`fit-framing only scales down: the figure spans ${source.bottom-source.top} px and framing ${spec.headTop},${spec.feet} needs ${Math.round((spec.feet-spec.headTop)*k)} px. Finalize without --fit-framing and redraw instead of enlarging.`)
  const w = Math.round(width*scale), h = Math.round(height*scale), sx = w/width, sy = h/height
  const resized = resizeImage(image,w,h,'lanczos3'), centre = (source.left+source.right)/2
  const dx = Math.round(centre-centre*sx), dy = Math.round(targetTop-source.top*sy)
  const fitted = cropImage(resized,-dx,-dy,width,height), result = figureBounds(fitted), canvas = y => Math.round(y/k)
  return {bytes:encodeAssetRgba(fitted),fit:{scale:[sx,sy],offset:[dx,dy],resampler:'lanczos3',resamples:w === width && h === height ? 0 : 1,alphaThreshold:HAZE_ALPHA_MAX,target:{headTop:spec.headTop,feet:spec.feet},source:{headTop:canvas(source.top),feet:canvas(source.bottom)},result:result && {headTop:canvas(result.top),feet:canvas(result.bottom)}}}
}
