import { stat } from 'node:fs/promises'
import path from 'node:path'

const INDEX_FILE = 'index.json'
const LINKS_FILE = 'sessions.json'
const emptyIndex = () => ({ cards: [], chats: [] })

function indexView(value) {
  return {
    ...value,
    cards: [...(Array.isArray(value.cards) ? value.cards : [])],
    chats: [...(Array.isArray(value.chats) ? value.chats : [])],
  }
}

function cloneLinks(value) {
  return value && typeof value === 'object' ? structuredClone(value) : value
}

export function createConversationIndexStore({ dataRoot, store }) {
  const linksPath = path.join(dataRoot, LINKS_FILE)
  let indexCache
  let linksCache = null

  // Share cached rows. Each reader gets its own arrays for sorting and filtering.
  async function readIndex() {
    const stamp = await store.version(INDEX_FILE)
    if (indexCache !== undefined && indexCache.stamp === stamp) return indexView(indexCache.value)
    const index = await store.readJson(INDEX_FILE)
    const value = index !== undefined && typeof index === 'object' ? index : emptyIndex()
    indexCache = { stamp, value }
    return indexView(value)
  }

  async function cacheWrittenIndex(value) {
    indexCache = { stamp: await store.version(INDEX_FILE), value }
  }

  async function writeIndex(index) {
    await store.writeJson(INDEX_FILE, index)
    await cacheWrittenIndex(index)
  }

  async function updateIndex(updater) {
    const next = await store.updateJson(INDEX_FILE, value => updater(value || emptyIndex()))
    if (next !== undefined && typeof next === 'object') await cacheWrittenIndex(next)
    else indexCache = undefined
    return next
  }

  // Polling only stats the file when its size and timestamp still match.
  async function readLinks() {
    let info = null
    try { info = await stat(linksPath) } catch { linksCache = null }
    if (info && linksCache && linksCache.mtimeMs === info.mtimeMs && linksCache.size === info.size) return cloneLinks(linksCache.value)
    const value = await store.readJson(LINKS_FILE)
    try {
      const after = info || await stat(linksPath)
      linksCache = { mtimeMs: after.mtimeMs, size: after.size, value: cloneLinks(value) }
    } catch { linksCache = null }
    return value
  }

  async function updateLinks(updater) {
    const result = await store.updateJson(LINKS_FILE, updater)
    try {
      const info = await stat(linksPath)
      linksCache = { mtimeMs: info.mtimeMs, size: info.size, value: cloneLinks(result) }
    } catch { linksCache = null }
    return result
  }

  return { readIndex, writeIndex, updateIndex, readLinks, updateLinks }
}
