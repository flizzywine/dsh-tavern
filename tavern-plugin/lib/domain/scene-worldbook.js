import { createHash } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const digest = value => hash(JSON.stringify(value))
const validRef = value => value?.version === 1 && /^[a-f0-9]{64}$/.test(value.digest)
const snapshotPath = value => 'scene-images/worldbooks/' + value + '.json'
const maxCharacters = 500000
const maxEntries = 2000

/** Freeze auxiliary setting data before a body is generated. This does not
 * activate entries or add them to the foreground prompt. Equal books share one file. */
export function createSceneWorldbooks({ store }) {
  async function capture({ worldBook, chat, card }) {
    if (!worldBook?.view || !Array.isArray(worldBook.view.entries)) return null
    const entries = [], omitted = []
    let remaining = maxCharacters, omittedCount = 0
    function omit(entry) { omittedCount++; if (omitted.length < 20) omitted.push(String(entry.ref || '').slice(0, 200)) }
    for (const entry of worldBook.view.entries) {
      if (!entry || entry.enabled === false || isMvuUpdateEntry(entry) || typeof entry.content !== 'string' || !entry.content.trim()) continue
      if (entries.length >= maxEntries || entry.content.length > remaining) { omit(entry); continue }
      const text = projectAgentContent(entry.content, { macroState: chat?.macroState, charName: card?.name }).agentText
      if (!text.trim()) continue
      const title = String(entry.title || entry.comment || '').slice(0, 200)
      const keys = (Array.isArray(entry.primaryKeys) ? entry.primaryKeys : []).filter(key => typeof key === 'string' && key.length <= 100 && !key.startsWith('/')).slice(0, 20)
      const ref = String(entry.ref || entries.length).slice(0, 200)
      const secondary = Array.isArray(entry.secondaryKeys) ? entry.secondaryKeys : []
      const conditions = entry.selective === true && secondary.length ? {
        unsupported: secondary.length > 20 || secondary.some(key => typeof key !== 'string' || key.length > 100 || key.startsWith('/')) || ![0, 1, 2, 3].includes(Number(entry.selectiveLogic) || 0),
        keys: secondary.length <= 20 ? secondary.filter(key => typeof key === 'string' && key.length <= 100 && !key.startsWith('/')) : [],
        logic: Number(entry.selectiveLogic) || 0, caseSensitive: entry.caseSensitive === true, wholeWords: entry.matchWholeWords === true
      } : null
      const size = text.length + title.length + ref.length + JSON.stringify(conditions).length + keys.reduce((sum, key) => sum + key.length, 0)
      if (size > remaining) { omit(entry); continue }
      entries.push({ ref, title, keys, text, constant: entry.constant === true, conditions })
      remaining -= size
    }
    const value = { version: 1, entries, omitted, omittedCount }
    const id = digest(value)
    if (!await store.version(snapshotPath(id))) await store.writeJson(snapshotPath(id), value)
    return { version: 1, digest: id }
  }
  async function read(ref) {
    if (!validRef(ref)) return null
    const value = await store.readJson(snapshotPath(ref.digest))
    if (!value) return { unavailable: '历史世界书快照缺失，未读取当前世界书。' }
    if (value.version !== 1 || !Array.isArray(value.entries) || digest(value) !== ref.digest) {
      return { unavailable: '历史世界书快照校验失败，未读取当前世界书。' }
    }
    return { ...value, digest: ref.digest }
  }
  return { capture, read }
}

/** Bind only the original bodies. An edited/new swipe must not inherit an
 * unrelated body's setting snapshot merely because it occupies the same slot. */
export function bindSceneWorldbook(message, ref) {
  if (!validRef(ref)) return message
  const bodies = Array.isArray(message.swipes) && message.swipes.length ? message.swipes
    : [message.sourceText ?? message.text ?? '']
  message.sceneWorldbook = { ...ref, bodyDigests: [...new Set(bodies.map(body => hash(String(body))))] }
  return message
}

export function sceneWorldbookBinding(chat, target) {
  const message = (chat.messages || []).find(item => item.role === 'assistant' && Number(item.turn || (item.greeting ? 1 : 0)) === target.turn)
  const ref = message?.sceneWorldbook
  return validRef(ref) && Array.isArray(ref.bodyDigests) && ref.bodyDigests.includes(target.sourceDigest)
    ? { version: ref.version, digest: ref.digest } : null
}
