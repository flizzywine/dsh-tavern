import { createHash } from 'node:crypto'
import { readdir, readFile, rm } from 'node:fs/promises'
import { createDurableFilePromotion } from '../durable-file-promotion.js'
import path from 'node:path'
import { currentBackgroundSessionId, referencedBackgroundSessionIds } from './background-identity.js'

// One game's data lives in many places on disk. This is the single list of them:
// export packs from it, deletion cleans by it, and a new per-game store must be added here.
const sha = value => createHash('sha256').update(String(value)).digest('hex')
const str = value => typeof value === 'string' ? value : ''
const safeName = value => /^[a-zA-Z0-9_-]+$/.test(value)

/**
 * Categories:
 *   core       the save itself (chat storage and registrations); removed by the conversation registry
 *   product    player-visible results kept with the game (scene image records)
 *   subsession native DSH sessions of this game: foreground and every background/image agent
 *   log        audit logs and diagnostics that can be dropped
 *   cache      transient state rebuilt on demand
 */
export function createGameFootprint({ dataRoot, sessionsRoot = path.join(path.dirname(dataRoot), 'sessions'), readdir: listDirectory = readdir }) {
  const root = path.resolve(dataRoot)
  const file = relative => path.join(root, relative)

  async function readJson(relative) {
    try { return JSON.parse(await readFile(file(relative), 'utf8')) } catch { return null }
  }

  // Native sessions are stored under a directory derived from their working directory,
  // which differs between installs and old versions; find each id in every project.
  async function nativeSessionDirectories(ids) {
    const wanted = new Set(ids.filter(safeName))
    if (!wanted.size) return []
    let projects
    try { projects = await listDirectory(sessionsRoot, { withFileTypes: true }) } catch { return [] }
    const found = []
    for (const project of projects) {
      if (!project.isDirectory()) continue
      let entries
      try { entries = await listDirectory(path.join(sessionsRoot, project.name), { withFileTypes: true }) } catch { continue }
      for (const entry of entries) if (entry.isDirectory() && wanted.has(entry.name)) found.push({ id: entry.name, path: path.join(sessionsRoot, project.name, entry.name) })
    }
    return found
  }

  // ownsSession(id): whether a background session really belongs to this game. Imported
  // saves and old bugs can leave another game's ids in history; never delete those.
  // One batch = one sessions-tree scan and one ownership probe per session id: bulk
  // deletion used to re-list every project directory once per game.
  async function describeMany(chats, { ownsSession = async () => true } = {}) {
    const prepared = []
    for (const chat of chats) {
      const chatId = str(chat?.id)
      if (!safeName(chatId)) throw new Error('无效的游戏编号')
      const foreground = str(chat.sessionId)
      const sceneAgent = await readJson('scene-images/' + sha(chatId) + '/agent.json')
      const background = new Set([
        currentBackgroundSessionId(chat), ...referencedBackgroundSessionIds(chat),
        ...(Array.isArray(chat.backgroundHistoryIds) ? chat.backgroundHistoryIds : []),
        chat.candidates?.traceSessionId, ...(Array.isArray(chat.candidates?.traceSessionIds) ? chat.candidates.traceSessionIds : []),
        sceneAgent?.sessionId
      ].map(str).filter(id => id && id !== foreground))
      prepared.push({ chat, chatId, foreground, background })
    }
    // Ownership is per game: one id can be a parent for one save and a stray for another.
    const ownership = new Map()
    for (const entry of prepared) {
      for (const id of [...entry.background]) {
        const key = entry.chatId + '\u0000' + id
        let owned = ownership.get(key)
        // Second argument keeps the per-game context available without changing the
        // positional contract existing callers (and tests) rely on.
        if (owned === undefined) { owned = await ownsSession(id, entry.chat); ownership.set(key, owned) }
        if (!owned) entry.background.delete(id)
      }
    }
    const wanted = [...new Set(prepared.flatMap(entry => [entry.foreground, ...entry.background]))].filter(safeName)
    const directories = new Map()
    for (const session of await nativeSessionDirectories(wanted)) if (!directories.has(session.id)) directories.set(session.id, session.path)
    return prepared.map(function (entry) {
      const { chat, chatId, foreground, background } = entry
      const sessionIds = [foreground, ...background].filter(Boolean)
      const items = []
      const add = (category, relative, kind = 'file') => items.push({ category, kind, path: file(relative) })
      add('product', 'scene-images/' + sha(chatId), 'dir')
      add('log', 'model-requests/' + chatId, 'dir')
      add('log', 'worldbook-recalls/' + chatId, 'dir')
      add('log', 'diagnostics/scene-' + sha(chatId) + '.json')
      add('log', 'diagnostics/scene-' + sha(chatId), 'dir')
      add('log', 'diffs/polish-' + chatId + '.html')
      const importOperation = str(chat.importHistory?.operationId)
      if (safeName(importOperation)) add('log', 'chat-imports/' + importOperation + '.json')
      add('cache', '.conversation-locks/' + chatId, 'dir')
      for (const id of sessionIds) {
        add('log', 'model-request-sessions/' + encodeURIComponent(id) + '.json')
        for (const kind of ['mvu', 'api-calls', 'compatibility']) add('log', 'diagnostics/' + kind + '-' + sha(id) + '.json')
        add('log', 'diagnostics/mvu-' + sha(id) + '.jsonl')
        add('cache', 'template-work/' + sha(id) + '.json')
        if (safeName(id)) add('cache', 'session-prefixes/' + id + '.json')
      }
      for (const id of sessionIds) {
        const found = directories.get(id)
        if (found) items.push({ category: 'subsession', kind: 'dir', path: found, sessionId: id, foreground: id === foreground })
      }
      return { chatId, foregroundSessionId: foreground, backgroundSessionIds: [...background], items }
    })
  }

  async function describe(chat, options = {}) {
    return (await describeMany([chat], options))[0]
  }

  // Everything except the core save, which the conversation registry removes first.
  async function removeLeftovers(footprint) {
    const failures = []
    for (const item of footprint.items) {
      if (item.category === 'core') continue
      const resolved = path.resolve(item.path)
      // Never follow a computed path out of the profile.
      if (!resolved.startsWith(root + path.sep) && !resolved.startsWith(path.resolve(sessionsRoot) + path.sep)) continue
      try { await rm(resolved, { recursive: true, force: true }) } catch (error) { failures.push({ path: resolved, error: String(error?.message || error) }) }
    }
    return { failures }
  }

  // Scene image records belong to the game; the image agent binding is rebuilt after import.
  async function readSceneFiles(chatId) {
    const dir = file('scene-images/' + sha(chatId))
    let names
    try { names = await readdir(dir, { withFileTypes: true }) } catch { return [] }
    const files = []
    for (const entry of names) if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'agent.json') files.push({ path: entry.name, content: await readFile(path.join(dir, entry.name)) })
    return files
  }
  async function readSceneWorldbook(digest) {
    if (!safeName(str(digest))) return null
    try { return await readFile(file('scene-images/worldbooks/' + digest + '.json')) } catch { return null }
  }
  // DSH keeps a session it has opened loaded and would write it back if its files were
  // removed now. Such sessions are deleted on the next start, before anything loads them.
  const pendingPath = file('pending-session-deletions.json')
  const pendingFiles = createDurableFilePromotion()
  function pendingItems(raw) {
    const value = raw ? JSON.parse(raw) : []
    if (!Array.isArray(value)) throw new Error('延迟删除队列格式无效')
    return value
  }
  async function deferSessionDeletion(items) {
    if (!items.length) return
    await pendingFiles.update(pendingPath, raw => JSON.stringify([
      ...new Set([...pendingItems(raw), ...items.map(item => path.resolve(item.path))])
    ]))
  }
  async function processDeferredDeletions() {
    let removed = 0
    const sessions = path.resolve(sessionsRoot) + path.sep
    await pendingFiles.update(pendingPath, async raw => {
      const remaining = []
      for (const target of pendingItems(raw)) {
        if (typeof target !== 'string' || !path.resolve(target).startsWith(sessions)) continue
        try { await rm(path.resolve(target), { recursive: true, force: true }); removed++ }
        catch { remaining.push(target) }
      }
      // Keep failed deletions for the next start; enqueue and drain share one lock.
      return raw === undefined ? undefined : JSON.stringify(remaining)
    })
    return removed
  }
  // Games deleted before deletion cleaned by this list (2026-10-07) left their scene image
  // records behind. Remove each record folder whose game no longer has a save; when the
  // saves cannot be listed, nothing is removed.
  async function sweepDeletedGameImages() {
    let entries
    try { entries = await readdir(file('chats'), { withFileTypes: true }) } catch { return 0 }
    const live = new Set(entries.map(entry => entry.isDirectory() ? entry.name : entry.name.endsWith('.json') ? entry.name.slice(0, -5) : '')
      .filter(id => id.startsWith('chat-')).map(sha))
    let folders
    try { folders = await readdir(file('scene-images'), { withFileTypes: true }) } catch { return 0 }
    let removed = 0
    for (const folder of folders) {
      if (!folder.isDirectory() || !/^[0-9a-f]{64}$/.test(folder.name) || live.has(folder.name)) continue
      try { await rm(file('scene-images/' + folder.name), { recursive: true, force: true }); removed++ } catch {}
    }
    return removed
  }
  return Object.freeze({ describe, describeMany, removeLeftovers, readSceneFiles, readSceneWorldbook, deferSessionDeletion, processDeferredDeletions, sweepDeletedGameImages })
}
