// shared by the app adapter and the portable authoring CLI.
import {readFile} from 'node:fs/promises'
import {assetEmotionGuidance} from './asset-generation-emotions.js'
import {matchBubbleMood} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {PACK_GEN_STYLES} from '../../packages/dsh-asset-library/lib/asset-packs/manifest.js'
import {skinSheetLayoutText} from './asset-skin-sheet.js'
import {SPRITE_DEFAULT_FRAMING_SENTENCE,spriteFramingSpec,spriteFramingSentence,assertFramingAgreesWithNotes} from './asset-sprite-framing.js'
export const ASSET_PRODUCTION_DEFAULTS = Object.freeze({avatarMode:'individual',quality:'high',blink:true})
export const ASSET_REFERENCE_ROLES = Object.freeze({
  identity:'Approved identity settei: authority for cross-outfit face, body proportions, hair structure and inherent skin/eye/hair colours; outfit accessories are not identity traits',
  settei:'Approved outfit settei: authority for clothing, outfit colours and explicit hair/accessory differences against its parent identity version; not sheet layout',
  sprite:'Approved default variant sprite: match size, framing, camera and facing direction',
  emotionSprite:'Approved same-emotion sprite: expression and outfit details',
  avatar:'Default variant avatar: match face scale, eye height and framing',
  base:'Source sprite: preserve every pixel except the requested local edit'
})
const variables = new Set(['figureName','outfitName','identityAppearance','outfitAppearance','emotion','emotionGuidance','userPrompt','referenceRoles','style','styleScope','backgroundStyle','sheetLayout'])
// the finish of a whole-image template is a style preset, the one source of that
// text. A template keeps `Finish: {{style}}` and, after its own sentence on which reference's line style comes first, the
// preset's `{{styleScope}}`; 'none' (不指定) sends no style text at all — the whole `{{style}}` line is left out. Local edits
// (mouth, blink, edit) always match their source and keep their fixed text. 'clean' renders the former template bytes.
export const ASSET_STYLE_DEFAULT = 'clean'
const STYLE_SUBJECTS = {background:'anime background art', cg:'anime illustration', prop:'anime illustration', 'skin-art':'game UI art'}
// The subject's own rendered detail (a character's eyes and hair; a UI part's ornament and materials).
const STYLE_DETAIL = {'skin-art':'carved ornament, metal, lacquer, paper and silk materials'}
// What a preset must never redesign: the character, or a UI part's design.
const STYLE_KEEP = {'skin-art':'design'}
const ASSET_STYLES = {
  clean:{text:subject => `clean cel-shaded ${subject} with ${subject === STYLE_SUBJECTS.background ? 'a very clean composition and colour, ' : ''}large simple colour masses, low visual frequency, restrained edge density, clear edge hierarchy, minimal internal contour lines, broad shadow shapes, suppressed micro-texture and micro-contrast, and no unnecessary specular highlights.`,
    scope:'this finish only reduces noise and texture.'},
  anime:{text:subject => `${subject} that looks like a frame of the original TV anime: reproduce the series' own drawing style faithfully, including its simplifications, with broadcast line weight, flat cel shading in one or two shadow tones, the show's own palette and the plain look of an actual episode screenshot, and no extra rendering, painterly texture, gradients, glow or detail the series itself does not draw.`,
    scope:'this finish only matches the broadcast look and never redesigns the {{subject}}.'},
  polished:{text:(subject,detail) => `polished, high-quality commercial ${subject} at key-visual or gacha-card quality: refined lighting with soft rim light and controlled highlights, rich but disciplined colour, crisp clean line art, carefully rendered ${detail || 'eyes, hair, fabric folds and materials'}, and clear form and depth, while the ${detail ? 'design' : 'character design'}, proportions and palette stay exactly as designed.`,
    scope:'this finish only raises the rendering quality and never redesigns the {{subject}}.'}
}
export function assetStyleValues(kind, style = ASSET_STYLE_DEFAULT) {
  if (!PACK_GEN_STYLES.includes(style)) throw Object.assign(new Error('未知的画风'),{code:'INVALID_ARGUMENT'})
  const preset = ASSET_STYLES[style]
  return preset ? {style:preset.text(STYLE_SUBJECTS[kind] || 'anime character art',STYLE_DETAIL[kind]),styleScope:preset.scope.replace('{{subject}}',STYLE_KEEP[kind] || 'character')} : {style:'',styleScope:''}
}
// No style: the template lines that carry it are left out (one rule for the prompt and its marked parts).
export const BACKGROUND_STYLE_REFERENCE_ROLE = 'Background style only: match rendering and colour language, never copy composition or objects; the redraw source remains the composition authority'
export const assetStyleLines = (template, values) => {
  if (values.backgroundStyle) return template.split('\n').filter(line => !/^Style:/.test(line)).map(line => /^Finish:/.test(line) ? 'Pack background style: {{backgroundStyle}}' : line).join('\n')
  return values.style ? template : template.split('\n').filter(line => !line.includes('{{style}}')).join('\n')
}
export function renderAssetTemplate(template, values) {
  return assetStyleLines(template, values).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!variables.has(key)) throw Object.assign(new Error('Unknown asset template variable: '+key),{code:'INVALID_ARGUMENT'})
    return values[key] || ''
  })
}
export function assetOutput(kind, quality = 'high') {
  return {size:kind === 'sprite' ? '1024x1536' : kind === 'avatar' ? '1024x1024' : '1536x1024',background:['sprite','avatar','avatar-sheet','blink','mouth','prop','edit'].includes(kind) ? 'transparent' : 'opaque',quality:kind === 'avatar' ? 'high' : quality}
}
export function assetPrerequisites(kind, emotionId, {settei,defaultEmotion,defaultSprite,defaultAvatar,sameSprite}) {
  if (['sprite','avatar','avatar-sheet'].includes(kind) && !settei) return 'SETTEI_REQUIRED'
  if (kind === 'sprite' && emotionId !== defaultEmotion && !defaultSprite) return 'DEFAULT_SPRITE_REQUIRED'
  if (kind === 'avatar' && emotionId !== defaultEmotion && !defaultAvatar) return 'DEFAULT_AVATAR_REQUIRED'
  if (kind === 'avatar' && !sameSprite) return 'EMOTION_SPRITE_REQUIRED'
  return null
}
export function assetPromptValues({kind,style,backgroundStyle,figure = {},outfit = {},emotions,emotion,userPrompt = '',references = [],sheet}) {
  return {...assetStyleValues(kind,style),sheetLayout:skinSheetLayoutText(sheet),backgroundStyle:['background','edit'].includes(kind) ? backgroundStyle?.prompt : undefined,figureName:figure.name,outfitName:outfit.label,identityAppearance:figure.identityAppearance,outfitAppearance:outfit.outfitAppearance,
    emotion:emotions ? emotions.map((e,index)=>`${index+1}. ${e.label}`).join('; ') : emotion?.label,
    emotionGuidance:emotions ? emotions.map(e=>`${e.label}: ${assetEmotionGuidance(e,figure)}`).join('\n') : emotion ? assetEmotionGuidance(emotion,figure) : '',
    userPrompt:kind === 'background' && backgroundStyle ? [userPrompt, references.length ? 'Reference images (style only, not layouts):\n' + references.map((r,i)=>`Image ${i+1}: ${r.role}`).join('\n') : ''].filter(Boolean).join('\n\n') : userPrompt,referenceRoles:references.map((r,i)=>`Image ${i+1}: ${r.role}`).join('\n')}
}
export async function productionPrompt({kind,style,backgroundStyle,figure,outfit,emotionId,userPrompt = '',references = [],frame = '',sheet,framing}) {
  let template = await readFile(new URL(`../../presets/asset-gen/templates/${kind}.md`,import.meta.url),'utf8')
  if(framing!==undefined) {
    if(kind!=='sprite')throw Object.assign(new Error('framing applies to sprite requests only'),{code:'INVALID_ARGUMENT'})
    const spec=spriteFramingSpec(framing)
    assertFramingAgreesWithNotes(spec,userPrompt)
    if(!template.includes(SPRITE_DEFAULT_FRAMING_SENTENCE))throw new Error('sprite.md no longer carries the default framing sentence; update asset-sprite-framing.js with it')
    template=template.replace(SPRITE_DEFAULT_FRAMING_SENTENCE,spriteFramingSentence(spec))
  }
  if(kind==='avatar'&&figure?.avatarFraming?.mode==='match-reference')template=template.replace(/^Framing:.*$/m,'Framing: on the final normalized 1024x1024 canvas, match this outfit\'s installed default avatar. Head height, crown y, chin y and centre x must each stay within +/-3% of the canvas; side cropping follows that reference, including wide ears. Use the measured visible headwear top as crown only when an occlusion: headwear note is supplied. Do not apply the generic 70% head-height or generic headroom rule. Preserve natural proportions, neck and shoulders.')
  return renderAssetTemplate(template,assetPromptValues({kind,style,backgroundStyle,figure,outfit,emotion:matchBubbleMood(emotionId,figure?.emotions||[]),
    ...(kind==='avatar-sheet'?{emotions:(figure.emotions||[]).filter(row=>!outfit.fallbackEmotions?.includes(row.id))}:{}),
    userPrompt:[userPrompt,frame && 'Mouth opening level: '+frame].filter(Boolean).join('\n'),references,sheet}))
}
