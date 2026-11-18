import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { lstat } from 'node:fs/promises'
import { freezeJson } from './domain/freeze-json.js'

export const CARD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SEGMENT = /^[A-Za-z0-9_@.-]{1,160}$/

export function safeAssetPath(root, relative) {
  if (typeof relative !== 'string' || relative.split('/').some(segment => !SEGMENT.test(segment) || segment === '.' || segment === '..' || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment))) throw new Error('Invalid asset path')
  return path.join(root, ...relative.split('/'))
}
export async function checkedAssetPath(root, relative, inspect = lstat) {
  const target = safeAssetPath(root, relative)
  // The configured root may itself be beneath a reparse point.
  const absolute = path.resolve(target), anchor = path.parse(absolute).root
  let current = anchor
  for (const segment of ['', ...absolute.slice(anchor.length).split(path.sep)]) {
    if (segment) current = path.join(current, segment)
    const info = await inspect(current).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (info?.isSymbolicLink()) throw new Error('Asset symlinks are not allowed')
  }
  return target
}

// Shared card-write queue used by Card Preparation and pack/card transactions.
// readWorkspace: a card file is read and parsed once per file version (profileData.version, the durable promotion stamp)
// and that one frozen copy is shared by every reader; a hit costs the version check. A writer edits a copy of its own.
export function createCardStorage({dataRoot, profileData, sharedCards = 8}) {
  const held = new AsyncLocalStorage(), queues = new Map(), shared = new Map()
  async function readWorkspace(cardPath) {
    if (typeof cardPath !== 'string' || !cardPath.startsWith('cards/') || cardPath.includes('\\') || cardPath.split('/').some(s => !s || s === '.' || s === '..' || /[:\x00-\x1f]/.test(s))) throw new Error('Invalid card path')
    const relative = 'resources/' + cardPath, version = await profileData.version(relative)
    let entry = shared.get(cardPath)
    shared.delete(cardPath)
    if (entry?.version !== version) {
      entry = {version, workspace:profileData.readJson(relative).then(freezeJson)}
      entry.workspace.catch(() => { if (shared.get(cardPath) === entry) shared.delete(cardPath) })
    }
    // Least recently read goes first; a missing file ('' version) is not kept.
    if (version) shared.set(cardPath, entry)
    while (shared.size > sharedCards) shared.delete(shared.keys().next().value)
    return entry.workspace
  }
  async function resolve(cardPath) {
    const id = (await readWorkspace(cardPath))?.meta?.id
    if (!CARD_ID.test(id || '')) throw new Error('Card has no identity')
    return id
  }
  return {dataRoot:path.resolve(dataRoot), readWorkspace, resolve, withCardLock(cardId, task) {
    if (!CARD_ID.test(cardId)) throw new Error('Invalid cardId')
    const outer = held.getStore() || new Set()
    if (outer.has(cardId)) throw Object.assign(new Error('Card lock reentry'), {code:'LOCK_REENTRY'})
    const pending = (queues.get(cardId) || Promise.resolve()).then(() => held.run(new Set([...outer,cardId]),task))
    const tail = pending.catch(() => {})
    queues.set(cardId,tail)
    tail.finally(() => {if (queues.get(cardId) === tail) queues.delete(cardId)})
    return pending
  }}
}
