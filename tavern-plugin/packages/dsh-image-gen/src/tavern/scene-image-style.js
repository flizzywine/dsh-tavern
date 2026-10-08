import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const TEMPLATE_VERSION = 'scene-style-v1'
const presets = [
  { id: 'auto', label: '自动（按题材定）', tags: '' },
  { id: 'default', label: '不指定', tags: '' },
  { id: 'anime', label: '日系插画', tags: 'Japanese illustration, clean linework, cel shading' },
  { id: 'photo', label: '写实摄影', tags: 'photorealistic photography, lifelike textures' },
  { id: 'watercolor', label: '水彩', tags: 'watercolor painting, translucent pigments, paper texture' },
  { id: 'ink', label: '水墨', tags: 'Chinese ink wash painting, expressive brushwork, ink on paper' },
  { id: 'custom', label: '自定义', tags: '' }
]
export const SCENE_STYLE_PRESETS = presets.map(({ id, label }) => ({ id, label }))

export function imageStyleSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['preset', 'custom', 'orientation'].includes(key))) throw new Error('风格设置只能包含 preset、custom 与 orientation')
  const preset = input.preset ?? 'auto', custom = input.custom ?? '', orientation = input.orientation ?? 'auto'
  if (!presets.some(item => item.id === preset)) throw new Error('未知的生图风格')
  if (typeof custom !== 'string' || custom.length > 2000) throw new Error('风格补充须为不超过 2000 字符的文本')
  // 'auto' (the default, omitted so older records compare equal) lets each picture
  // turn the configured size to portrait or landscape; 'fixed' never does.
  if (!['auto', 'fixed'].includes(orientation)) throw new Error('画幅方向只能是 auto 或 fixed')
  return { preset, custom, ...(orientation === 'fixed' ? { orientation } : {}) } // Keep the user's original wording, independently of its expression.
}

/** Current Images channel accepts short sentences as well as tags: its custom
 * style can be used verbatim without a separate paid translation task. A future
 * tag-only channel must supply its own versioned expression implementation. */
export function createSceneImageStyles({ store }) {
  /** 'auto' uses the style the planning Agent fixed for this game (gameStyle);
   * until one exists the result is unstyled (see gameStylePending). */
  async function resolve(input, profile, gameStyle) {
    const selection = imageStyleSettings(input)
    const normalized = { preset: selection.preset === 'custom' && !selection.custom.trim() ? 'default' : selection.preset, custom: selection.custom.trim(),
      ...(selection.preset === 'auto' && gameStyle?.tags ? { game: gameStyle.tags } : {}) }
    const selectionDigest = hash(normalized)
    const id = hash([TEMPLATE_VERSION, profile, selectionDigest])
    const path = 'scene-images/styles/' + id + '.json'
    const existing = await store.readJson(path)
    if (existing) return existing
    const preset = presets.find(item => item.id === normalized.preset)
    const tags = [preset.tags, normalized.game, normalized.custom].filter(Boolean).join(', ')
    const block = { id, selectionDigest, templateVersion: TEMPLATE_VERSION, profile, selection: normalized, tags }
    return store.updateJson(path, current => current || block)
  }
  return { resolve }
}

export const gameStylePending = style => style?.selection?.preset === 'auto' && !style.selection.game

/** Style lives only in image snapshots; canonical people/scene blocks are untouched. */
export function applyImageStyle(plan, style) {
  const styleOverride = plan.style?.selectionDigest === style.selectionDigest ? plan.styleOverride : undefined
  if (plan.style?.id === style.id && plan.styleOverride === styleOverride) return plan
  const { id, style: previous, styleOverride: discarded, ...facts } = plan
  const result = { ...facts, style, ...(styleOverride ? { styleOverride } : {}) }
  return { ...result, id: hash(result) }
}

export function composeSceneImagePrompt(plan) {
  const style = plan.styleOverride?.tags ?? plan.style?.tags ?? ''
  const prompt = plan.prompt + (style ? '\nVisual style only (preserve the people, clothing, actions and scene facts above): ' + style : '')
  if (prompt.length > 16000) throw new Error('组合后的画面和风格提示词过长')
  return prompt
}

export function imageStyleOverride(value, profile) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['text', 'tags'].includes(key)) || typeof value.text !== 'string' || typeof value.tags !== 'string' || value.text.length > 2000 || value.tags.length > 3000 || Boolean(value.text.trim()) !== Boolean(value.tags.trim())) throw new Error('单图风格须为 text/tags 文本，同时置空可清除')
  const result = { text: value.text.trim(), tags: value.tags.trim(), profile, imageOnly: true }
  return { ...result, id: hash(result) }
}
