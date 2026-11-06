import { randomUUID } from 'node:crypto'
import { normalizeGuideName, normalizeGuideTexts } from './guide-content.js'
const PATH = 'temporary-guide-library.json'
export function createGuideLibrary({ store, now = Date.now }) {
  async function list() { return (await store.readJson(PATH))?.items || [] }
  async function save(name, guides) {
    name = normalizeGuideName(name)
    const texts = normalizeGuideTexts(Array.isArray(guides) ? guides.map(item => item.text) : guides)
    const item = { id: randomUUID(), name, guides: texts, createdAt: now() }
    await store.updateJson(PATH, value => ({ version: 1, items: [...(value?.items || []), item] }))
    return item
  }
  async function get(id) {
    const item = (await list()).find(item => item.id === id)
    if (!item) throw new Error('指导方案不存在，请刷新指导库')
    return item
  }
  async function update(input) {
    let updated
    await store.updateJson(PATH, value => {
      const item = value?.items?.find(item => item.id === input.id)
      if (!item) throw new Error('Guide 方案不存在，请刷新后重试')
      if (JSON.stringify(item) !== JSON.stringify(input.expected)) throw new Error('方案已被修改，请刷新后重试')
      if (Object.hasOwn(input, 'name')) {
        item.name = normalizeGuideName(input.name)
      }
      if (Object.hasOwn(input, 'guides')) {
        item.guides = normalizeGuideTexts(input.guides)
      }
      item.updatedAt = now()
      updated = item
      return value
    })
    return updated
  }
  async function remove(input) {
    await store.updateJson(PATH, value => {
      const items = value?.items || []
      const item = items.find(item => item.id === input?.id)
      if (!item) throw new Error('Guide 方案不存在，请刷新后重试')
      if (JSON.stringify(item) !== JSON.stringify(input.expected)) throw new Error('方案已被修改，请刷新后重试')
      return { ...value, items: items.filter(other => other !== item) }
    })
  }
  return { list, save, get, update, remove }
}
