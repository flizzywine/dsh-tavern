import { outfitPromptText } from './outfit-parts.js'

export function libraryPromptOverride(record) {
  return typeof record?.imagePrompt === 'string' ? record.imagePrompt.trim() : null
}

export function libraryPromptFields(record) {
  const fields = typeof record?.imagePrompt === 'string' ? { imagePrompt: record.imagePrompt.slice(0, 8000) } : {}
  if (Array.isArray(record?.imageDetails)) fields.imageDetails = record.imageDetails.slice(0, 24).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : ''
    return [{ name: name || '未命名资料', text: typeof item.text === 'string' ? item.text.slice(0, 2000) : '', useForImage: item.useForImage === true }]
  })
  return fields
}

export function libraryImageDetails(record) {
  return (Array.isArray(record?.imageDetails) ? record.imageDetails : [])
    .filter(item => item?.useForImage === true).map(item => libraryPromptPart(item.text)).filter(Boolean)
}

export function libraryPromptPart(value) {
  const text = String(value ?? '').trim()
  return /^(?:none|n\/a|null|undefined|无|没有)$/i.test(text) ? '' : text
}

export function characterLibraryPrompt(record, { mode = 'tags', traitMode = 'auto', back = false } = {}) {
  const traits = record?.traits ?? {}
  const body = traitMode === 'all' ? 'NSFW' : 'SFW'
  return libraryPromptOverride(record) ?? [traits[back ? 'faceBack' : 'face'], traits['body' + body + (back ? 'Back' : '')], traits['lower' + body + (back ? 'Back' : '')]]
    .map(libraryPromptPart).filter(Boolean).join(mode === 'tags' ? ', ' : '\n')
}

// 角色自带服装与通用服装库走同一套字段和部位规则（见 outfit-parts.js）。
// 旧签名里的 shared 参数保留给现有调用方，字段归一已在 collectOutfitParts 里完成。
export function outfitLibraryPrompt(record, { mode = 'tags', back = false } = {}) {
  return libraryPromptOverride(record) ?? outfitPromptText(record, { mode, back: back === true })
}
