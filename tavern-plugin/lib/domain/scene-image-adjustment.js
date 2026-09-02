import { createHash } from 'node:crypto'
import { imageStyleOverride } from './scene-image-style.js'

export const SCENE_ADJUSTMENT_TOOL = {
  name: 'submit_image_adjustment', description: '仅提交这张图片需要替换的表达块，不改人物资料或剧情。校验后等待图片生成并保存，返回实际成功或失败结果，不自动重发请求。',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { update: { type: 'object', properties: {}, additionalProperties: true, description: '{description:string,patches:[{owner:string,field:string,text:string,tags:string}],style?:{text:string,tags:string}}。style 仅在调整本图风格时提交；只改风格时 patches 为空。同一块仅提交一次，清除时 text/tags 同时为空。' } },
    required: ['update']
  }
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
export function imageAdjustmentInput(base, instruction, profile, mode = 'adjust') {
  return { mode, instruction, profile, baseProfile: base.profile, description: base.description || '', ...(base.style ? { style: base.styleOverride || { text: base.style.selection, tags: base.style.tags } } : {}), people: (base.people || []).map(person => ({ id: person.id, name: person.name })), blocks: base.blocks.map(block => ({ owner: block.owner, field: block.field, text: block.text || '', tags: block.tags })) }
}
/** Image-local immutable overlay. Never calls the persistent character store. */
export function applyImageAdjustment(base, update, profile, mode = 'adjust') {
  if (!update || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).some(key => !['description', 'patches', 'style'].includes(key))) throw new Error('update 只能包含 description、patches 和 style')
  if (mode === 'convert' && update.style !== undefined && (!base.styleOverride || update.style?.text !== base.styleOverride.text)) throw new Error('转换渠道时不能改变本图风格，只能转换已有风格表达')
  if (base.styleOverride && base.styleOverride.profile !== profile && update.style === undefined) throw new Error('新表达配置还需转换本图临时风格')
  if (typeof update.description !== 'string' || update.description.length > 1000) throw new Error('description 必须是不超过 1000 字符的文本')
  if (!Array.isArray(update.patches) || update.patches.length > 50) throw new Error('patches 必须是最多 50 项的数组')
  const blocks = structuredClone(base.blocks), seen = new Set()
  const people = new Set((base.people || []).map(person => person.id))
  for (const patch of update.patches) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['owner', 'field', 'text', 'tags'].includes(key))) throw new Error('patch 包含未知字段')
    const allowed = patch.owner === 'scene' ? ['environment', 'composition'] : people.has(patch.owner) ? ['appearance', 'clothing', 'action', 'expression', 'position'] : []
    if (!allowed.includes(patch.field)) throw new Error('patch 的人物或字段不属于原方案')
    const limit = base.legacy && patch.owner === 'scene' && patch.field === 'composition' ? 12000 : 1200
    if (typeof patch.text !== 'string' || patch.text.length > (base.legacy ? limit : 600) || typeof patch.tags !== 'string' || patch.tags.length > limit || Boolean(patch.text.trim()) !== Boolean(patch.tags.trim())) throw new Error('patch 的 text/tags 过长或没有同时清除')
    const key = patch.owner + '/' + patch.field
    if (seen.has(key)) throw new Error('同一表达块只能修改一次')
    seen.add(key)
    const index = blocks.findIndex(block => block.owner === patch.owner && block.field === patch.field)
    if (mode === 'convert' && (index < 0 || blocks[index].text !== patch.text || !patch.tags.trim())) throw new Error('转换渠道时不能改变原画面事实')
    const block = { ...patch, tags: patch.tags.trim(), text: patch.text.trim(), profile, sourceDigest: hash(patch.text.trim()) }
    block.id = hash(block)
    if (index >= 0) blocks[index] = block
    else blocks.push(block)
  }
  if (mode === 'convert' && blocks.some(block => block.tags && !seen.has(block.owner + '/' + block.field))) throw new Error('当前表达转换缺少原方案中的块')
  if (base.profile !== profile && blocks.some(block => block.tags && !seen.has(block.owner + '/' + block.field))) throw new Error('表达配置已变化，请同时转换所有未兼容的块，不要混用旧表达')
  const prompt = []
  for (const person of base.people || []) {
    const tags = blocks.filter(block => block.owner === person.id && block.tags).map(block => block.tags)
    if (tags.length) prompt.push(person.name + ': ' + tags.join(', '))
  }
  prompt.push(...blocks.filter(block => block.owner === 'scene' && block.tags).map(block => block.tags))
  if (!prompt.length || prompt.join('\n').length > 12000) throw new Error('组合画面提示词为空或过长')
  const result = { ...base, profile, description: update.description, blocks, prompt: prompt.join('\n'), imageOnly: true, basedOn: base.id }
  if (update.style !== undefined) result.styleOverride = imageStyleOverride(update.style, profile)
  result.id = hash(result)
  return result
}

export function legacyImagePlan(version, profile) {
  const prompt = String(version.prompt || '').trim()
  if (!prompt) throw new Error('旧图片没有保存画面方案，无法重画')
  return { id: hash(prompt), profile, legacy: true, description: version.description || '', people: [], blocks: [{ owner: 'scene', field: 'composition', text: prompt, tags: prompt }], prompt }
}
