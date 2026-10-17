import { createHash } from 'node:crypto'
import { projectAgentContent } from './runtime-content-projection.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const digest = value => hash(JSON.stringify(value))
const validRef = value => value?.version === 1 && /^[a-f0-9]{64}$/.test(value.digest)
const snapshotPath = value => 'scene-images/worldbooks/' + value + '.json'
// Entries are stored once each: a turn's snapshot only lists them. Most entries
// repeat verbatim every turn; a large worldbook otherwise costs ~1 MB per turn.
const entryPath = value => 'scene-images/worldbook-entries/' + value + '.json'
const refsPath = chatId => 'scene-images/worldbook-refs/' + String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json'
const COUNTS_PATH = 'scene-images/worldbook-entry-counts.json'
const maxCharacters = 500000
const maxEntries = 2000
// Like fork history, only the latest turns keep the setting snapshot an image
// of that turn is drawn with; the opening (turn 0) is always kept.
export const SCENE_WORLDBOOK_KEEP_TURNS = 50

function saveReferences(states) {
  const refs = new Map()
  const add = (ref, turn) => { if (validRef(ref)) refs.set(ref.digest + ':' + turn, { digest: ref.digest, turn }) }
  for (const state of states) {
    add(state.sceneOpeningWorldbook, 0)
    for (const message of state.messages || []) {
      if (message?.role === 'assistant') add(message.sceneWorldbook, Number(message.turn || (message.greeting ? 1 : 0)))
    }
  }
  return [...refs.values()]
}

/** Freeze auxiliary setting data before a body is generated. This does not
 * activate entries or add them to the foreground prompt. Equal books share one file. */
export function createSceneWorldbooks({ store, keepTurns = SCENE_WORLDBOOK_KEEP_TURNS }) {
  // Captures and cleanup of shared snapshot/entry files run one at a time.
  let tail = Promise.resolve()
  const serial = task => { const next = tail.then(task, task); tail = next.catch(() => {}); return next }
  async function capture({ worldBook, chat, card, turn }) {
    const ref = await captureSnapshot({ worldBook, chat, card })
    if (ref && chat?.id && Number.isSafeInteger(turn)) await serial(() => register(chat.id, ref.digest, turn)).catch(() => {})
    return ref
  }
  async function captureSnapshot({ worldBook, chat, card }) {
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
    // The digest always covers the complete (version 1) snapshot, whichever
    // layout stores it, so exported archives and old references stay valid.
    const value = { version: 1, entries, omitted, omittedCount }
    const id = digest(value)
    if (!await store.version(snapshotPath(id))) {
      const entryRefs = []
      for (const entry of entries) {
        const ref = digest(entry)
        if (!await store.version(entryPath(ref))) await store.writeJson(entryPath(ref), entry)
        entryRefs.push(ref)
      }
      await serial(async () => {
        if (await store.version(snapshotPath(id))) return
        await store.writeJson(snapshotPath(id), { version: 2, entryRefs, omitted, omittedCount })
        await store.updateJson(COUNTS_PATH, counts => {
          const next = { ...(counts || {}) }
          for (const ref of entryRefs) next[ref] = (Number(next[ref]) || 0) + 1
          return next
        })
      })
    }
    return { version: 1, digest: id }
  }
  // The complete snapshot, materialized from either layout and verified.
  async function load(id) {
    const stored = await store.readJson(snapshotPath(id))
    if (!stored) return null
    if (stored.version !== 2) return stored
    if (!Array.isArray(stored.entryRefs)) return { invalid: true }
    const entries = []
    for (const ref of stored.entryRefs) {
      const entry = /^[a-f0-9]{64}$/.test(ref) ? await store.readJson(entryPath(ref)) : null
      if (!entry || digest(entry) !== ref) return { invalid: true }
      entries.push(entry)
    }
    return { version: 1, entries, omitted: stored.omitted, omittedCount: stored.omittedCount }
  }
  async function read(ref) {
    if (!validRef(ref)) return null
    const value = await load(ref.digest)
    if (!value) return { unavailable: '历史世界书快照缺失，未读取当前世界书。' }
    if (value.version !== 1 || !Array.isArray(value.entries) || digest(value) !== ref.digest) {
      return { unavailable: '历史世界书快照校验失败，未读取当前世界书。' }
    }
    return { ...value, digest: ref.digest }
  }
  // Self-contained bytes for a save package (always the version 1 layout).
  async function exportSnapshot(id) {
    if (!/^[a-f0-9]{64}$/.test(String(id || ''))) return null
    const value = await load(id)
    return value && value.version === 1 && digest(value) === id ? Buffer.from(JSON.stringify(value)) : null
  }
  async function exportForSave(states) {
    return serial(async () => {
      const snapshots = []
      for (const id of new Set(saveReferences(states).map(ref => ref.digest))) {
        const content = await exportSnapshot(id)
        if (content) snapshots.push({ digest: id, content })
      }
      return snapshots
    })
  }

  async function importForSave(chatId, states, snapshots) {
    // Validate the entire package before publishing any new references.
    const supplied = new Map()
    for (const item of snapshots) {
      let value
      try { value = JSON.parse(item.content.toString('utf8')) } catch { throw new Error('存档生图世界书快照无法读取') }
      if (value?.version !== 1 || !Array.isArray(value.entries) || digest(value) !== item.digest) {
        throw new Error('存档生图世界书快照校验失败')
      }
      supplied.set(item.digest, value)
    }
    return serial(async () => {
      const available = new Map()
      for (const ref of saveReferences(states)) {
        if (available.has(ref.digest)) continue
        const existing = await load(ref.digest)
        if (existing?.version === 1 && digest(existing) === ref.digest) available.set(ref.digest, null)
        else if (supplied.has(ref.digest)) available.set(ref.digest, supplied.get(ref.digest))
      }
      // Register before writing: a concurrent deletion can never collect these
      // snapshots. The caller forgets the target chat if the import later fails.
      const refs = saveReferences(states).filter(ref => available.has(ref.digest))
      await store.writeJson(refsPath(chatId), { version: 1, refs })
      for (const [id, value] of available) {
        // Preserve an existing v2 layout and its shared-entry reference counts.
        if (value) await store.writeJson(snapshotPath(id), value)
      }
    })
  }

  // Which snapshots each game still needs, by turn. Snapshots this game no
  // longer needs are deleted unless another game still lists them; an entry
  // file goes when no snapshot counts it any more. Snapshots written before
  // this index existed are never touched.
  async function register(chatId, id, turn) {
    let dropped = []
    await store.updateJson(refsPath(chatId), value => {
      const refs = (Array.isArray(value?.refs) ? value.refs : []).filter(item => !(item.digest === id && item.turn === turn))
      refs.push({ digest: id, turn })
      const latest = Math.max(0, ...refs.map(item => Number(item.turn) || 0))
      const kept = refs.filter(item => Number(item.turn) === 0 || Number(item.turn) > latest - keepTurns)
      dropped = refs.filter(item => !kept.includes(item)).map(item => item.digest)
      return { version: 1, refs: kept }
    })
    if (dropped.length) await release(new Set(dropped))
  }
  async function release(candidates) {
    for (const item of await store.list('scene-images/worldbook-refs').catch(() => [])) {
      const name = typeof item === 'string' ? item : item?.name
      if (!name?.endsWith('.json')) continue
      for (const ref of (await store.readJson('scene-images/worldbook-refs/' + name).catch(() => null))?.refs || []) candidates.delete(ref.digest)
    }
    for (const id of candidates) {
      const stored = await store.readJson(snapshotPath(id)).catch(() => null)
      if (!stored) continue
      await store.remove(snapshotPath(id))
      if (stored.version !== 2 || !Array.isArray(stored.entryRefs)) continue
      const gone = []
      await store.updateJson(COUNTS_PATH, counts => {
        const next = { ...(counts || {}) }
        for (const ref of stored.entryRefs) {
          if (!Object.hasOwn(next, ref)) continue
          next[ref] = Number(next[ref]) - 1
          if (next[ref] <= 0) { delete next[ref]; gone.push(ref) }
        }
        return next
      })
      for (const ref of gone) await store.remove(entryPath(ref))
    }
  }
  async function forgetChat(chatId) {
    return serial(async () => {
      const refs = (await store.readJson(refsPath(chatId)).catch(() => null))?.refs || []
      await store.remove(refsPath(chatId))
      if (refs.length) await release(new Set(refs.map(item => item.digest)))
    })
  }
  // A fork keeps reading its parent's snapshots for the turns it copied.
  async function copyRefs(sourceChatId, targetChatId, upToTurn) {
    return serial(async () => {
      const refs = ((await store.readJson(refsPath(sourceChatId)).catch(() => null))?.refs || []).filter(item => Number(item.turn) <= upToTurn)
      if (refs.length) await store.writeJson(refsPath(targetChatId), { version: 1, refs })
    })
  }
  return { capture, read, exportSnapshot, exportForSave, importForSave, forgetChat, copyRefs }
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
