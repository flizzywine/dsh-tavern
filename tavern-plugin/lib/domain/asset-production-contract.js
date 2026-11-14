// shared by the app adapter and the portable authoring CLI.
import {readFile} from 'node:fs/promises'
import {assetEmotionGuidance} from './asset-generation-emotions.js'
import {matchBubbleMood} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {skinSheetLayoutText} from './asset-skin-sheet.js'
import {packGenStyle} from '../../packages/dsh-asset-library/lib/asset-packs/manifest.js'
import {composePresetText, withPromptPreset} from '../../packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import {SPRITE_DEFAULT_FRAMING_SENTENCE,spriteFramingSpec,spriteFramingSentence,assertFramingAgreesWithNotes} from './asset-sprite-framing.js'
export const ASSET_PRODUCTION_DEFAULTS = Object.freeze({avatarMode:'individual',quality:'high',blink:true})
export const ASSET_IMAGE_QUALITIES = Object.freeze(['auto','low','medium','high','xhigh','max'])
export const ASSET_REFERENCE_ROLES = Object.freeze({
  identity:'Approved identity settei: authority for cross-outfit face, body proportions, hair structure and inherent skin/eye/hair colours; outfit accessories are not identity traits',
  settei:'Approved outfit settei: authority for clothing, outfit colours and explicit hair/accessory differences against its parent identity version; not sheet layout',
  sprite:'Approved default variant sprite: match size, framing, camera and facing direction',
  emotionSprite:'Approved same-emotion sprite: expression and outfit details',
  avatar:'Default variant avatar: match face scale, eye height and framing',
  base:'Source sprite: preserve every pixel except the requested local edit'
})
// 画风 is a style preset of the image plugin (its text and name live there): the template describes the picture, and the
// plugin adds the preset's text for this kind's use — 'figure' (one character on a transparent background, and local
// edits of one), 'sheet' (a settei), 'background' (an empty place) or 'scene' (a CG, a prop, UI art). 'style' and
// 'styleScope' are the former in-template finish; an older 设置 → 生图 override may still carry them, and their lines are left out.
const variables = new Set(['figureName','outfitName','identityAppearance','outfitAppearance','emotion','emotionGuidance','userPrompt','referenceRoles','style','styleScope','backgroundStyle','sheetLayout'])
const STYLE_USES = {sprite:'figure', avatar:'figure', 'avatar-sheet':'figure', mouth:'figure', blink:'figure', settei:'sheet', 'identity-settei':'sheet', background:'background'}
export const assetStyleUse = kind => STYLE_USES[kind] || 'scene'
export const BACKGROUND_STYLE_REFERENCE_ROLE = 'Background style only: match rendering and colour language, never copy composition or objects; the redraw source remains the composition authority'
// The pack's own background style replaces the preset for its backgrounds (asset-generation.js sends no preset then).
export const assetStyleLines = (template, values) => template.split('\n')
  .filter(line => !/\{\{styleScope\}\}|\{\{style\}\}/.test(line) && (values.backgroundStyle || !line.includes('{{backgroundStyle}}'))).join('\n')
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
export function assetPromptValues({kind,backgroundStyle,figure = {},outfit = {},emotions,emotion,userPrompt = '',references = [],sheet}) {
  return {sheetLayout:skinSheetLayoutText(sheet),backgroundStyle:['background','edit'].includes(kind) ? backgroundStyle?.prompt : undefined,figureName:figure.name,outfitName:outfit.label,identityAppearance:figure.identityAppearance,outfitAppearance:outfit.outfitAppearance,
    emotion:emotions ? emotions.map((e,index)=>`${index+1}. ${e.label}`).join('; ') : emotion?.label,
    emotionGuidance:emotions ? emotions.map(e=>`${e.label}: ${assetEmotionGuidance(e,figure)}`).join('\n') : emotion ? assetEmotionGuidance(emotion,figure) : '',
    userPrompt:kind === 'background' && backgroundStyle ? [userPrompt, references.length ? 'Reference images (style only, not layouts):\n' + references.map((r,i)=>`Image ${i+1}: ${r.role}`).join('\n') : ''].filter(Boolean).join('\n\n') : userPrompt,referenceRoles:references.map((r,i)=>`Image ${i+1}: ${r.role}`).join('\n')}
}
// The portable CLI sends a finished prompt (frozen in its receipt), so it adds the preset's text itself, with the image
// plugin's own assembly (natural language, as the CLI's image tools take). A pack background style replaces the preset.
export function withAssetStyle(prompt, {style, use, backgroundStyle}) {
  if (backgroundStyle) return prompt
  return composePresetText(prompt, withPromptPreset({promptMode:'natural'}, packGenStyle(style)), 'openai', {usage:use, maxLength:Infinity})
}
export async function productionPrompt({kind,outputKind,style,backgroundStyle,figure,outfit,emotionId,userPrompt = '',references = [],frame = '',sheet,framing}) {
  let template = await readFile(new URL(`../../presets/asset-gen/templates/${kind}.md`,import.meta.url),'utf8')
  if(framing!==undefined) {
    if(kind!=='sprite')throw Object.assign(new Error('framing applies to sprite requests only'),{code:'INVALID_ARGUMENT'})
    const spec=spriteFramingSpec(framing)
    assertFramingAgreesWithNotes(spec,userPrompt)
    if(!template.includes(SPRITE_DEFAULT_FRAMING_SENTENCE))throw new Error('sprite.md no longer carries the default framing sentence; update asset-sprite-framing.js with it')
    template=template.replace(SPRITE_DEFAULT_FRAMING_SENTENCE,spriteFramingSentence(spec))
  }
  if(kind==='avatar'&&figure?.avatarFraming?.mode==='match-reference')template=template.replace(/^Framing:.*$/m,'Framing: on the final normalized 1024x1024 canvas, match this outfit\'s installed default avatar. Head height, crown y, chin y and centre x must each stay within +/-3% of the canvas; side cropping follows that reference, including wide ears. Use the measured visible headwear top as crown only when an occlusion: headwear note is supplied. Do not apply the generic 70% head-height or generic headroom rule. Preserve natural proportions, neck and shoulders.')
  return withAssetStyle(renderAssetTemplate(template,assetPromptValues({kind,backgroundStyle,figure,outfit,emotion:matchBubbleMood(emotionId,figure?.emotions||[]),
    ...(kind==='avatar-sheet'?{emotions:(figure.emotions||[]).filter(row=>!outfit.fallbackEmotions?.includes(row.id))}:{}),
    userPrompt:[userPrompt,frame && 'Mouth opening level: '+frame].filter(Boolean).join('\n'),references,sheet})),
    {style,use:assetStyleUse(kind==='edit'?outputKind:kind),backgroundStyle:['background','edit'].includes(kind)?backgroundStyle?.prompt:undefined})
}
