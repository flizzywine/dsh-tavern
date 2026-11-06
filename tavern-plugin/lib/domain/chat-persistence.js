import { diffJson } from './json-mutation.js'
import { projectSceneImageState, projectDisplayRuntimeState, projectChatBackgroundConfig } from './chat-session-state.js'
import { isDeepStrictEqual } from 'node:util'
import { isScopedMessages } from './scoped-messages.js'

const STORAGE_REVISION = '_storageRevision'
const MISSING = Symbol('missing')

function clone(value) {
  // Preserve the merge sentinel so the parent omits deleted fields.
  return value === undefined || value === MISSING ? value : structuredClone(value)
}

// A preparation draft owns metadata only. Full read()/write() isolation is unchanged.
export function captureChatHeader(chat) {
  const {messages: _messages, ...head} = chat
  return clone(head)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function same(left, right) {
  if (left === MISSING || right === MISSING) return left === right
  return isDeepStrictEqual(left, right)
}

// Bookkeeping stamps that every writer bumps, not story data. Like the root
// updatedAt, two compatible writers (a settlement finishing and the next round
// starting) must not conflict over them; keep the later one. Entries inside the
// timeline stay strict.
const MONOTONIC_STAMPS = new Set(['timeline.updatedAt'])

function conflict(chatId, path) {
  const error = new Error('Tavern Chat 已被另一项操作修改，拒绝覆盖冲突字段：' + (path || '<root>'))
  error.code = 'DSH_TAVERN_CHAT_CONFLICT'
  error.chatId = chatId
  error.path = path
  return error
}

function withoutDisplayCapture(messages) {
  return messages.map(function ({ displayRuntime: _capture, ...message }) { return message })
}

function sameCaptureTarget(left, right) {
  if (!object(left) || !object(right)) return false
  for (const key of ['id', 'role', 'turn', 'greeting']) if (!same(left[key], right[key])) return false
  if (Number(left.swipeId || 0) !== Number(right.swipeId || 0)) return false
  for (const key of ['text', 'sourceText', 'projectionText', 'displayText']) {
    if (!same(left[key] ?? left.text, right[key] ?? right.text)) return false
  }
  return same(left.swipes ?? [left.text], right.swipes ?? [right.text])
}

function captureOf(message) {
  return object(message) && Object.hasOwn(message, 'displayRuntime') ? message.displayRuntime : MISSING
}

function mergeMessages(base, latest, desired, chatId) {
  // Display captures are observational data, not competing story edits. Keep
  // the authoritative array atomic: two distinct story/variable edits still
  // conflict, even when they affect different messages or also carry captures.
  const before = withoutDisplayCapture(base)
  const current = withoutDisplayCapture(latest)
  const proposed = withoutDisplayCapture(desired)
  let chosen, other
  if (same(proposed, before)) { chosen = latest; other = desired }
  else if (same(current, before) || same(current, proposed)) { chosen = desired; other = latest }
  else throw conflict(chatId, 'messages')
  const result = clone(chosen)
  for (let index = 0; index < result.length; index++) {
    const previousCapture = captureOf(base[index])
    const otherCapture = captureOf(other[index])
    if (same(otherCapture, previousCapture) || !same(captureOf(chosen[index]), previousCapture)) continue
    // Never attach a late capture to a replacement, reordered message or swipe.
    if (!sameCaptureTarget(base[index], chosen[index]) || !sameCaptureTarget(other[index], chosen[index])) continue
    if (otherCapture === MISSING) delete result[index].displayRuntime
    else result[index].displayRuntime = clone(otherCapture)
  }
  return result
}

function mergeValue(base, latest, desired, path, chatId) {
  if (same(desired, base)) return clone(latest)
  if (same(latest, base) || same(latest, desired)) return clone(desired)
  if (path === 'messages' && [base, latest, desired].every(value => Array.isArray(value) && value.every(object))) {
    return mergeMessages(base, latest, desired, chatId)
  }
  if (object(base) && object(latest) && object(desired)) {
    const result = {}
    const keys = new Set([...Object.keys(base), ...Object.keys(latest), ...Object.keys(desired)])
    for (const key of keys) {
      if (path === '' && (key === STORAGE_REVISION || key === 'updatedAt')) continue
      const childPath = path === '' ? key : path + '.' + key
      if (MONOTONIC_STAMPS.has(childPath)) {
        const stamps = [latest[key], desired[key]].filter(Number.isFinite)
        if (stamps.length) { result[key] = Math.max(...stamps); continue }
      }
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
        Object.prototype.hasOwnProperty.call(latest, key) ? latest[key] : MISSING,
        Object.prototype.hasOwnProperty.call(desired, key) ? desired[key] : MISSING,
        childPath,
        chatId
      )
      if (value !== MISSING) result[key] = value
    }
    return result
  }
  throw conflict(chatId, path)
}

// A reused draft must describe its new storage revision, including fields
// merged from other writers. Preserve edits made by its owner during the await.
function refreshDraft(input, desired, saved) {
  for (const key of new Set([...Object.keys(desired), ...Object.keys(saved)])) {
    const before = Object.hasOwn(desired, key) ? desired[key] : MISSING
    const after = Object.hasOwn(saved, key) ? saved[key] : MISSING
    if (same(before, after)) continue
    const current = Object.hasOwn(input, key) ? input[key] : MISSING
    if (object(current) && object(before) && object(after)) {
      refreshDraft(current, before, after)
    } else if (same(current, before)) {
      if (after === MISSING) delete input[key]
      else input[key] = clone(after)
    }
  }
}

/**
 * Persist the authoritative Tavern Chat with optimistic three-way merging.
 * Callers keep a small read/write interface; revision tracking, stale-write
 * rejection and locality-preserving merges stay inside this implementation.
 */
export function createChatPersistence(options = {}) {
  const data = options.data
  const store = options.store
  const normalize = typeof options.normalize === 'function' ? options.normalize : function (value) { return value }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const baselines = new Map()
  let baselineBytes = 0

  function relative(chatId) {
    const id = String(chatId || '')
    if (id === '' || id.includes('/') || id.includes('\\')) throw new Error('Tavern Chat ID 不合法')
    return 'chats/' + id + '.json'
  }

  const records = store || (data && typeof data.readJson === 'function' && typeof data.updateJson === 'function' && typeof data.remove === 'function' ? {
    async read(chatId) { return await data.readJson(relative(chatId)) },
    async update(chatId, updater) { return await data.updateJson(relative(chatId), updater) },
    async remove(chatId) { await data.remove(relative(chatId)) },
    async version(chatId) { return typeof data.version === 'function' ? await data.version(relative(chatId)) : '' }
  } : null)
  if (records === null || typeof records.read !== 'function' || typeof records.update !== 'function' || typeof records.remove !== 'function') {
    throw new Error('Chat Persistence 缺少 Chat Store adapter')
  }

  function remember(chat) {
    if (!chat || typeof chat !== 'object') return chat
    const revision = Math.max(0, Number(chat[STORAGE_REVISION]) || 0)
    chat[STORAGE_REVISION] = revision
    // Journal revisions are durable: reconstruct a baseline only for a stale
    // write. Legacy stores have no revision reader, so keep a bounded fallback.
    if (typeof records.readRevision !== 'function') {
      const key = chat.id + ':' + revision
      if (!baselines.has(key)) {
        const bytes = JSON.stringify(chat).length * 2
        if (bytes <= 16 * 1024 * 1024) {
          baselines.set(key, {value:clone(chat),bytes}); baselineBytes += bytes
          while (baselines.size > 8 || baselineBytes > 16 * 1024 * 1024) {
            const oldest = baselines.keys().next().value
            baselineBytes -= baselines.get(oldest).bytes; baselines.delete(oldest)
          }
        }
      }
    }
    return chat
  }

  async function read(chatId) {
    const value = await records.read(chatId)
    if (value === undefined) return undefined
    return remember(normalize(value))
  }

  // Detached read-only projection; never remember it as a stale-write baseline.
  async function readSessionState(chatId, options) {
    if (typeof records.readSessionState !== 'function') return read(chatId)
    const value = await records.readSessionState(chatId, options)
    return value === undefined ? undefined : normalize(value)
  }

  // Only adapters explicitly guaranteeing detached updater input AND output can
  // skip this layer's copies. Journal still clones at its ownership boundaries.
  function updateValue(value) { return records.detachedUpdate === true ? value : clone(value) }

  async function write(input, metadata = {}) {
    if (!input || typeof input !== 'object' || String(input.id || '') === '') throw new Error('不能保存没有 id 的 Tavern Chat')
    const desired = clone(input)
    const chatId = String(desired.id)
    const touchUpdatedAt = metadata.touchUpdatedAt !== false
    const basedOn = Math.max(0, Number(desired[STORAGE_REVISION]) || 0)
    let baseline = baselines.get(chatId + ':' + basedOn)?.value
    const saved = await records.update(chatId, async function (stored) {
      if (stored === undefined) {
        if (basedOn !== 0) throw conflict(chatId, '<deleted>')
        desired[STORAGE_REVISION] = 1
        desired.updatedAt = touchUpdatedAt ? Math.max(Number(desired.updatedAt) || 0, now()) : Math.max(0, Number(desired.updatedAt) || 0)
        return desired
      }
      const latest = normalize(updateValue(stored))
      const latestRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      let next
      if (latestRevision === basedOn) {
        next = desired
      } else {
        if (baseline === undefined && typeof records.readRevision === 'function') {
          try { baseline = await records.readRevision(chatId, basedOn) }
          catch (error) { if (error.code !== 'DSH_TAVERN_REVISION_NOT_FOUND') throw error }
          if (baseline !== undefined) baseline = normalize(baseline)
        }
        if (baseline === undefined) throw conflict(chatId, '<baseline>')
        next = mergeValue(baseline, latest, desired, '', chatId)
      }
      next[STORAGE_REVISION] = latestRevision + 1
      next.updatedAt = touchUpdatedAt
        ? Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0, now())
        : Math.max(Number(latest.updatedAt) || 0, Number(desired.updatedAt) || 0)
      return next
    }, metadata)
    const normalized = remember(normalize(updateValue(saved)))
    refreshDraft(input, desired, normalized)
    input[STORAGE_REVISION] = normalized[STORAGE_REVISION]
    input.updatedAt = normalized.updatedAt
    return normalized
  }

  // Only callers that do not edit history may use this operation. Merge metadata
  // against its captured baseline, then refresh concurrent historical row edits
  // before promoting the caller's revision. Never label stale rows as current.
  async function writeHeader(input, baseline, metadata = {}) {
    if (!records.readSlice || !records.patch) throw new Error('Chat Store 不支持字段保存')
    if (!baseline || baseline.id !== input.id || baseline.sessionId !== input.sessionId
      || !Number.isSafeInteger(baseline[STORAGE_REVISION]) || !Array.isArray(input.messages)
      || Object.hasOwn(baseline,'messages')) throw new Error('无效的 Chat 字段保存基线')
    const desired = captureChatHeader(input)
    for (let attempt=0;attempt<5;attempt++) {
      let selected = await records.readSlice(input.id, [])
      if (!selected) throw conflict(input.id,'<deleted>')
      let fullMessages, entries=[]
      if (selected.chat[STORAGE_REVISION] !== baseline[STORAGE_REVISION]) {
        const changed = await records.readChangedSlice?.(input.id,baseline[STORAGE_REVISION])
        if (changed?.denseMessages) {
          selected=changed
          entries=changed.indices.map((id,index)=>[id,changed.chat.messages[index]])
        } else {
          // Lost revision evidence is an explicit, safe full-read fallback.
          // A bounded history cannot adopt it: the caller retries from fresh reads.
          if (isScopedMessages(input.messages)) throw conflict(input.id,'messages')
          const full=await records.read(input.id)
          if (!full) throw conflict(input.id,'<deleted>')
          fullMessages=full.messages
          selected={chat:full,messageCount:fullMessages.length}
        }
      }
      // A bounded history keeps its floor count: new floors mean the story moved on.
      if (isScopedMessages(input.messages) && input.messages.length !== selected.messageCount) throw conflict(input.id,'messages')
      const latest=captureChatHeader(normalize(selected.chat))
      if (latest.sessionId !== baseline.sessionId) throw conflict(input.id,'sessionId')
      const next=mergeValue(baseline,latest,desired,'',input.id)
      // patch() owns storage revision and timestamp, including no-op semantics.
      next[STORAGE_REVISION]=latest[STORAGE_REVISION]
      if (Object.hasOwn(latest,'updatedAt')) next.updatedAt=latest.updatedAt
      else delete next.updatedAt
      const saved=await patch(input.id,latest[STORAGE_REVISION],diffJson(latest,next),metadata)
      if (!saved) continue
      const head=captureChatHeader(saved)
      if (fullMessages) input.messages=fullMessages
      else {
        input.messages.length=selected.messageCount
        for (const [id,row] of entries) input.messages[id]=row
      }
      refreshDraft(input,desired,head)
      input[STORAGE_REVISION]=head[STORAGE_REVISION]
      input.updatedAt=head.updatedAt
      return head
    }
    throw conflict(input.id,'<busy>')
  }

  async function update(chatId, mutation, metadata = {}) {
    if (typeof mutation !== 'function') throw new Error('Chat Persistence 缺少 mutation')
    const touchUpdatedAt = metadata.touchUpdatedAt !== false
    const saved = await records.update(chatId, async function (stored) {
      if (stored === undefined) return undefined
      const latest = normalize(updateValue(stored))
      const currentRevision = Math.max(0, Number(latest[STORAGE_REVISION]) || 0)
      const result = await mutation(latest)
      if (result === undefined) return undefined
      const next = result === latest ? latest : normalize(result)
      next[STORAGE_REVISION] = currentRevision + 1
      next.updatedAt = touchUpdatedAt ? Math.max(Number(next.updatedAt) || 0, now()) : Math.max(0, Number(next.updatedAt) || 0)
      return next
    }, metadata)
    return saved === undefined ? undefined : remember(normalize(updateValue(saved)))
  }

  async function readRevision(chatId, revision) {
    if (typeof records.readRevision !== 'function') throw new Error('当前 Chat Store 不支持按 revision 读取')
    const value = await records.readRevision(chatId, revision)
    return value === undefined ? undefined : normalize(clone(value))
  }

  async function version(chatId) {
    return typeof records.version === 'function' ? await records.version(chatId) : ''
  }

  async function readSettlementCheckpoint(chatId, messageId, operationId) {
    return records.readSettlementCheckpoint?.(chatId, messageId, operationId)
  }
  async function readSceneImageState(chatId, options) {
    if (records.readSceneImageState) return records.readSceneImageState(chatId, options)
    const chat = await read(chatId)
    return chat ? projectSceneImageState(chat) : undefined
  }
  async function readBackgroundConfig(chatId) {
    if (records.readBackgroundConfig) return records.readBackgroundConfig(chatId)
    const chat = await read(chatId)
    return chat ? projectChatBackgroundConfig(chat) : undefined
  }
  async function readDisplayRuntimeState(chatId, turn) {
    if (records.readDisplayRuntimeState) return records.readDisplayRuntimeState(chatId, turn)
    const chat = await read(chatId)
    return chat ? projectDisplayRuntimeState(chat, turn) : undefined
  }
  // Do not normalize/remember a window as a full editable Chat baseline.
  async function readWindow(chatId,options) { return records.readWindow ? records.readWindow(chatId,options) : null }
  async function readRecentSummaries(chatId,count) { return records.readRecentSummaries ? records.readRecentSummaries(chatId,count) : null }
  async function readHelperContext(chatId, range) {
    return records.readHelperContext?.(chatId, range)
  }
  async function readSlice(chatId, indices=[], fields) {
    if(!records.readSlice)return undefined
    const selected=await records.readSlice(chatId,indices,fields)
    return selected ? {...selected,chat:normalize(selected.chat)} : undefined
  }
  async function readSettlementBase(chatId) {
    const selected = await records.readSettlementBase?.(chatId)
    return selected ? {...selected,chat:normalize(selected.chat)} : undefined
  }
  async function readChangedSlice(chatId, revision, fields) {
    const selected = await records.readChangedSlice?.(chatId, revision, fields)
    return selected ? {...selected, chat: normalize(selected.chat)} : undefined
  }
  async function readChangedIndices(chatId, revision, options) {
    return await records.readChangedIndices?.(chatId, revision, options)
  }
  async function readViewDelta(chatId, revision) {
    const selected = await records.readViewDelta?.(chatId, revision)
    return selected ? { ...selected, chat: normalize(selected.chat) } : undefined
  }
  // Returns metadata only. Callers cannot accidentally retain another complete history.
  async function patch(chatId, revision, changes, metadata={}) {
    if(!records.patch)return undefined
    if(changes.length===0)return records.patch(chatId,revision,[],metadata)
    if(changes.some(c=>['_storageRevision','updatedAt','id'].includes(c.path?.[0])))throw new Error('Reserved journal patch field')
    return await records.patch(chatId,revision,[...changes,{op:'set',path:['_storageRevision'],value:revision+1},
      ...(metadata.touchUpdatedAt===false?[]:[{op:'set',path:['updatedAt'],value:now()}])],metadata)
  }

  async function remove(chatId) {
    baselines.forEach(function (entry, key) { if (key.startsWith(String(chatId) + ':')) { baselineBytes -= entry.bytes; baselines.delete(key) } })
    await records.remove(chatId)
  }

  return Object.freeze({ read, readWindow, readRecentSummaries, readHelperContext, readSessionState, readSceneImageState, readSettlementCheckpoint, readBackgroundConfig, readDisplayRuntimeState, readSlice, readSettlementBase, readChangedSlice, readChangedIndices, readViewDelta, patch, readRevision, write, writeHeader, update, version, remove })
}
