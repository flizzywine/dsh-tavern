import { randomUUID } from 'node:crypto'

export function normalizeGuideText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Guide 内容须为非空文字')
  const text = value.trim()
  if (text.length > 2000) throw new Error('每条 Guide 最多 2000 字')
  return text
}

export function normalizeGuideTexts(values) {
  if (!Array.isArray(values) || !values.length || values.length > 20) throw new Error('方案须包含 1 至 20 条非空指导')
  return values.map(normalizeGuideText)
}

export function normalizeGuideName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 80) throw new Error('请输入 1 至 80 字的方案名称')
  return name
}

export function appendGuides(existing, incoming, { deduplicate = false, now = Date.now(), id = randomUUID } = {}) {
  const current = Array.isArray(existing) ? existing : []
  const texts = normalizeGuideTexts(incoming)
  const additions = deduplicate ? [...new Set(texts)].filter(text => !current.some(item => item.text === text)) : texts
  if (current.length + additions.length > 20) throw new Error('Guide 数量已达上限（20 条），请先删除部分本局指导')
  return [...current, ...additions.map(text => ({ id: id(), text, createdAt: now }))]
}
