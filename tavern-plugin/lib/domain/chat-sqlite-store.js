import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { readFile, stat, writeFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import path from 'node:path'

import { copyJsonTree } from './copy-json-tree.js'
import { projectSceneImageState, projectChatSessionState, projectDisplayRuntimeState, projectChatBackgroundConfig, projectSettlementCheckpoint } from './chat-session-state.js'
import { applyJsonChangesShared, diffJson } from './json-mutation.js'
import { createChatJournalStore } from './chat-journal-store.js'

/**
 * SQLite 后端的 Tavern Chat 存储（3.5 行级 schema v2）：
 *   archive_head      单行：楼层之外的全部头部字段 + 键序（保留 JSON 属性序，LLM 前缀缓存依赖）
 *   archive_messages  每楼一行（message_index 主键）——写哪楼改哪楼，无变更行零序列化零写入
 * 没有变更帧、没有历史快照表：回退 = DELETE 行（零残留）；写入 = 行级条件落库（原子）。
 * 上层接口与 chat-journal-store 完全一致；v1 schema（archive_state/journal/snapshots）与文件版打开时自动迁移。
 */
const STORAGE_REVISION = '_storageRevision'

function revisionOf(value) {
  return Math.max(0, Number(value && value[STORAGE_REVISION]) || 0)
}

function jsonClone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function safeChatId(value) {
  const id = String(value || '')
  if (id === '' || id.includes('/') || id.includes('\\') || id === '.' || id === '..') throw new Error('Tavern Chat ID 不合法')
  return id
}

async function readJsonFile(target) {
  try { return JSON.parse(await readFile(target, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
}

export function createChatSqliteStore(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || ''))
  if (dataRoot === '') throw new Error('Chat SQLite Store 缺少 dataRoot')
  const chatsRoot = path.join(dataRoot, 'chats')
  const legacyData = options.legacyData
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const mutationTails = new Map()
  const limit = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback
  const cacheMaxBytes = limit(options.cacheMaxBytes, 256 * 1024 * 1024)
  const maxCachedChats = limit(options.maxCachedChats, 8)
  const readCache = new Map()
  const pendingReads = new Map()
  const sizes = new WeakMap()
  let cachedBytes = 0
  const open = new Map()
  const generations = new Map()

  function generationStamp(chatId) {
    const id = safeChatId(chatId)
    return 'sqlite:gen:' + (generations.get(id) || 0) + (existsSync(dbFile(id)) ? '' : ':empty')
  }

  function bumpGeneration(chatId) {
    const id = safeChatId(chatId)
    generations.set(id, (generations.get(id) || 0) + 1)
  }

  function dbFile(chatId) {
    return path.join(chatsRoot, safeChatId(chatId), 'archive.db')
  }

  /** 头部（非 messages 字段）按键序存储：组装时按键序重建，JSON 属性序与文件版完全一致。返回行 JSON 数组（缓存复用）。 */
  function writeRows(db, chat, revision, at, useTransaction = true) {
    const keys = Object.keys(chat)
    const head = {}
    for (const key of keys) if (key !== 'messages') head[key] = chat[key]
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    const rowJsons = messages.map(message => JSON.stringify(message === undefined ? null : message))
    if (useTransaction) db.exec('BEGIN')
    try {
      db.exec('DELETE FROM archive_messages')
      const insert = db.prepare('INSERT INTO archive_messages (message_index, message_json) VALUES (?, ?)')
      messages.forEach((message, index) => insert.run(index, rowJsons[index]))
      db.prepare('INSERT INTO archive_head (id, head_json, keys_json, revision, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET head_json = excluded.head_json, keys_json = excluded.keys_json, revision = excluded.revision, updated_at = excluded.updated_at')
        .run(JSON.stringify(head), JSON.stringify(keys), revision, at)
      if (useTransaction) db.exec('COMMIT')
    } catch (error) {
      if (useTransaction) { try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ } }
      throw error
    }
    return rowJsons
  }

  /** 行级增量落库：未变更楼层共享对象引用（immutable apply 的性质）——直接复用旧 JSON 字符串，零序列化。
   *  返回本次的行 JSON 数组（缓存 state 携带，供下次写继续复用）。 */
  function writeRowsIncremental(db, prevRowJsons, prevMessages, nextChat, revision, at) {
    const keys = Object.keys(nextChat)
    const head = {}
    for (const key of keys) if (key !== 'messages') head[key] = nextChat[key]
    const nextMessages = Array.isArray(nextChat.messages) ? nextChat.messages : []
    const prevMessagesArr = Array.isArray(prevMessages) ? prevMessages : []
    const prevJsonsArr = Array.isArray(prevRowJsons) ? prevRowJsons : []
    const nextRowJsons = new Array(nextMessages.length)
    db.exec('BEGIN')
    try {
      const upsert = db.prepare('INSERT INTO archive_messages (message_index, message_json) VALUES (?, ?) ON CONFLICT(message_index) DO UPDATE SET message_json = excluded.message_json')
      let changedRows = 0
      for (let index = 0; index < nextMessages.length; index++) {
        const row = nextMessages[index]
        if (index < prevMessagesArr.length && prevMessagesArr[index] === row && prevRowJsons && prevRowJsons[index] != null) {
          nextRowJsons[index] = prevRowJsons[index]
        } else {
          nextRowJsons[index] = JSON.stringify(row === undefined ? null : row)
        }
        if (index >= prevJsonsArr.length || nextRowJsons[index] !== prevJsonsArr[index]) {
          upsert.run(index, nextRowJsons[index])
          changedRows++
        }
      }
      if (prevJsonsArr.length > nextMessages.length) {
        db.prepare('DELETE FROM archive_messages WHERE message_index >= ?').run(nextMessages.length)
      }
      db.prepare('INSERT INTO archive_head (id, head_json, keys_json, revision, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET head_json = excluded.head_json, keys_json = excluded.keys_json, revision = excluded.revision, updated_at = excluded.updated_at')
        .run(JSON.stringify(head), JSON.stringify(keys), revision, at)
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ }
      throw error
    }
    return nextRowJsons
  }

  function handle(chatId, { create = false } = {}) {
    const id = safeChatId(chatId)
    const file = dbFile(id)
    if (!create && !existsSync(file)) return null
    const existing = open.get(id)
    if (existing) {
      open.delete(id)
      open.set(id, existing)
      return existing
    }
    if (create) mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL')
    ensureSchema(db)
    open.set(id, db)
    while (open.size > 8) {
      const oldest = open.keys().next().value
      try { open.get(oldest).close() } catch { /* Already closed by remove(). */ }
      open.delete(oldest)
    }
    return db
  }

  function ensureSchema(db) {
    // v1 库（archive_state/journal/snapshots）自动迁移到行级 v2；旧表随后删除（彻底清理语义）。
    const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('archive_state','archive_journal')").all()
    const head = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='archive_head'").get()
    if (legacy.length > 0 && head === undefined) {
      db.exec('BEGIN')
      try {
        createV2Tables(db)
        const stateRow = db.prepare('SELECT chat_json, revision FROM archive_state WHERE id = 1').get()
        if (stateRow !== undefined) {
          const chat = JSON.parse(stateRow.chat_json)
          // 嵌套在外层迁移事务内：不再开启内层事务
          writeRows(db, chat, Number(stateRow.revision), now(), false)
        }
        db.exec('DROP TABLE archive_journal')
        db.exec('DROP TABLE archive_snapshots')
        db.exec('DROP TABLE archive_state')
        db.exec('COMMIT')
      } catch (error) {
        try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ }
        throw error
      }
    } else if (head === undefined) {
      createV2Tables(db)
    }
  }

  function createV2Tables(db) {
    db.exec(`CREATE TABLE archive_head (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      head_json TEXT NOT NULL,
      keys_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    db.exec(`CREATE TABLE archive_messages (
      message_index INTEGER PRIMARY KEY,
      message_json TEXT NOT NULL
    )`)
  }

  function assemble(db) {
    const headRow = db.prepare('SELECT head_json, keys_json, revision FROM archive_head WHERE id = 1').get()
    if (headRow === undefined) return null
    const head = JSON.parse(headRow.head_json)
    const keys = JSON.parse(headRow.keys_json)
    const rows = db.prepare('SELECT message_index, message_json FROM archive_messages ORDER BY message_index').all()
    const messages = new Array(rows.length)
    const rowJsons = new Array(rows.length)
    for (const row of rows) {
      const index = Number(row.message_index)
      messages[index] = JSON.parse(row.message_json)
      rowJsons[index] = row.message_json
    }
    const chat = {}
    let placed = false
    for (const key of keys) {
      if (key === 'messages') { chat.messages = messages; placed = true }
      else if (Object.hasOwn(head, key)) chat[key] = head[key]
    }
    if (!placed) chat.messages = messages
    chat[STORAGE_REVISION] = Number(headRow.revision)
    return { chat, revision: Number(headRow.revision), rowJsons }
  }

  function serialize(chatId, operation) {
    const id = safeChatId(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const current = previous.catch(function () {}).then(operation)
    mutationTails.set(id, current)
    return current.finally(function () { if (mutationTails.get(id) === current) mutationTails.delete(id) })
  }

  async function legacyRead(chatId) {
    const id = safeChatId(chatId)
    const legacyRelative = 'chats/' + id + '.json'
    if (legacyData && typeof legacyData.readJson === 'function') return await legacyData.readJson(legacyRelative)
    return await readJsonFile(path.join(chatsRoot, id + '.json'))
  }

  // ---------- 读缓存（与后端无关） ----------
  function estimateBytes(value) {
    if (typeof value === 'string') return 24 + value.length * 2
    if (!value || typeof value !== 'object') return 8
    if (sizes.has(value)) return sizes.get(value)
    let size = 64
    for (const key of Object.keys(value)) size += 24 + key.length * 2 + estimateBytes(value[key])
    sizes.set(value, size)
    return size
  }
  function forgetState(chatId) {
    const entry = readCache.get(chatId)
    if (entry) cachedBytes -= entry.bytes
    readCache.delete(chatId)
  }
  function rememberState(chatId, stamp, state, recentChanges = []) {
    forgetState(chatId)
    if (!stamp || !state || !maxCachedChats || !cacheMaxBytes) return
    let bytes
    try { bytes = estimateBytes(state) + estimateBytes(recentChanges) + estimateBytes(stamp) } catch { return }
    if (bytes > cacheMaxBytes) return
    readCache.set(chatId, { stamp, state, recentChanges, bytes })
    cachedBytes += bytes
    while (readCache.size > maxCachedChats || cachedBytes > cacheMaxBytes) forgetState(readCache.keys().next().value)
  }
  function knownChanges(chatId, state) {
    const entry = readCache.get(chatId)
    return entry?.state === state ? entry.recentChanges : []
  }

  // ---------- 惰性迁移：文件版 → SQLite（行级） ----------
  let migrationSource = null
  function hasFileStoreData(chatId) {
    const id = safeChatId(chatId)
    return existsSync(path.join(chatsRoot, id, 'snapshots')) || existsSync(path.join(chatsRoot, id, 'journals'))
  }
  async function migrateOneFromFile(chatId) {
    const id = safeChatId(chatId)
    migrationSource ??= createChatJournalStore({ dataRoot, legacyData, now, logger })
    const chat = await migrationSource.read(id)
    if (chat === undefined) return
    const db = handle(chatId, { create: true })
    db.exec('BEGIN')
    try {
      writeRows(db, chat, revisionOf(chat), now())
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* Connection-level failure; nothing to roll back. */ }
      throw error
    }
    bumpGeneration(chatId)
    logger.log('dsh-tavern: 存档 SQLite 迁移完成(行级):', id, 'revision', revisionOf(chat), '楼层', (chat.messages || []).length)
  }

  async function cachedState(chatId) {
    const stamp = await version(chatId)
    const entry = readCache.get(chatId)
    if (stamp && entry?.stamp === stamp) {
      readCache.delete(chatId)
      readCache.set(chatId, entry)
      return entry.state
    }
    forgetState(chatId)
    const pending = pendingReads.get(chatId)
    if (pending?.stamp === stamp) return pending.promise
    const load = { stamp }
    load.promise = (async () => {
      try {
        const state = await materialize(chatId)
        if (stamp && stamp === await version(chatId) && pendingReads.get(chatId) === load) {
          rememberState(chatId, stamp, state)
        }
        return state
      } finally {
        if (pendingReads.get(chatId) === load) pendingReads.delete(chatId)
      }
    })()
    pendingReads.set(chatId, load)
    return load.promise
  }

  async function materialize(chatId, targetRevision = Number.POSITIVE_INFINITY) {
    const id = safeChatId(chatId)
    const file = dbFile(id)
    if (!existsSync(file)) {
      if (hasFileStoreData(id)) {
        await migrateOneFromFile(id)
        return await materialize(chatId, targetRevision)
      }
      const legacy = await legacyRead(id)
      if (legacy === undefined) return null
      const revision = revisionOf(legacy)
      if (targetRevision !== Number.POSITIVE_INFINITY && targetRevision !== revision) {
        const error = new Error('Legacy Chat 只有 revision ' + revision + '，无法读取 revision ' + targetRevision)
        error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
        throw error
      }
      if (legacy === null || typeof legacy !== 'object' || Array.isArray(legacy) || legacy.id !== id) throw new Error('Legacy Chat 不合法: ' + id)
      legacy[STORAGE_REVISION] = revision
      return { chat: jsonClone(legacy), revision, legacy: true, frameCount: 0, frameBytes: 0 }
    }
    // 行级存储（彻底清理语义）：仅保留当前态，不保留历史版本——被回退/被修改的旧版本不可重建
    if (targetRevision !== Number.POSITIVE_INFINITY) {
      const db = handle(chatId)
      const state = assemble(db)
      if (state !== null && state.revision === targetRevision) {
        return { chat: state.chat, revision: state.revision, legacy: false, frameCount: 0, frameBytes: 0 }
      }
      const error = new Error('行级存储不保留历史版本，找不到 revision ' + targetRevision + ': ' + id)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    const db = handle(chatId)
    const state = assemble(db)
    if (state === null) return null
    const { chat, revision, rowJsons } = state
    if (!chat || typeof chat !== 'object' || Array.isArray(chat) || chat.id !== id) throw new Error('Archive state 不合法: ' + id)
    return { chat, revision, legacy: false, frameCount: 0, frameBytes: 0, rowJsons }
  }

  // ---------- 写路径（行级，无帧） ----------
  async function patch(chatId, expectedRevision, changes, metadata = {}) {
    return serialize(chatId, async () => {
      const state = await cachedState(chatId)
      if (!state || state.revision !== expectedRevision) return undefined
      if (changes.length === 0) { metadata.assertCurrent?.(); return slice(state.chat, []).chat }
      const normalized = []
      for (const change of changes) {
        if (change.op === 'set' && change.value === undefined) {
          if (!change.path.length) throw new Error('Journal root cannot be undefined')
          const current = applyJsonChangesShared(state.chat, normalized)
          let parent = current
          for (const key of change.path.slice(0, -1)) parent = parent?.[key]
          if (!parent || typeof parent !== 'object') throw new Error('Missing mutation parent')
          const key = change.path.at(-1)
          if (Array.isArray(parent)) normalized.push({ ...change, value: null })
          else if (Object.hasOwn(parent, key)) normalized.push({ op: 'delete', path: change.path })
        } else normalized.push(jsonClone(change))
      }
      changes = normalized
      const next = applyJsonChangesShared(state.chat, changes)
      if (next.id !== chatId || revisionOf(next) !== expectedRevision + 1) throw new Error('Invalid journal patch revision')
      await migrateLegacyIfNeeded(chatId, state)
      const db = handle(chatId)
      metadata.assertCurrent?.()
      const nextRowJsons = writeRowsIncremental(db, state.rowJsons, state.chat.messages, next, expectedRevision + 1, now())
      bumpGeneration(chatId)
      const recentChanges = knownChanges(chatId, state)
      forgetState(chatId)
      rememberState(chatId, generationStamp(chatId), {
        chat: next, revision: expectedRevision + 1, legacy: false, frameCount: 0, frameBytes: 0, rowJsons: nextRowJsons
      }, rememberChanges(recentChanges, expectedRevision + 1, changes))
      return slice(next, []).chat
    })
  }

  async function update(chatId, updater, metadata = {}) {
    if (typeof updater !== 'function') throw new Error('Chat SQLite Store 缺少 updater')
    return await serialize(chatId, async function () {
      const currentState = await cachedState(chatId)
      const current = currentState == null ? undefined : currentState.chat
      const produced = await updater(copyJsonTree(current))
      if (produced === undefined) return copyJsonTree(current)
      const next = jsonClone(produced)
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) throw new Error('Chat 存储只能保存 JSON object')
      const db = handle(chatId, { create: true })
      if (currentState == null) {
        const revision = revisionOf(next)
        const rowJsons = writeRows(db, next, revision, now())
        bumpGeneration(chatId)
        rememberState(chatId, generationStamp(chatId), { chat: next, revision, legacy: false, frameCount: 0, frameBytes: 0, rowJsons })
        return copyJsonTree(next)
      }
      const baseRevision = currentState.revision
      const revision = revisionOf(next)
      if (revision !== baseRevision + 1) throw new Error('Chat 存储写入 revision 非连续，期望 ' + (baseRevision + 1) + '，实际 ' + revision)
      const changes = diffJson(current, next)
      if (changes.length === 0) return copyJsonTree(current)
      await migrateLegacyIfNeeded(chatId, currentState)
      const nextRowJsons = writeRowsIncremental(db, currentState.rowJsons, currentState.chat.messages, next, revision, now())
      bumpGeneration(chatId)
      const recentChanges = knownChanges(chatId, currentState)
      forgetState(chatId)
      rememberState(chatId, generationStamp(chatId), {
        chat: next, revision, legacy: false, frameCount: 0, frameBytes: 0, rowJsons: nextRowJsons
      }, rememberChanges(recentChanges, revision, changes))
      return copyJsonTree(next)
    })
  }

  async function migrateLegacyIfNeeded(chatId, state) {
    if (!state.legacy) return
    const db = handle(chatId, { create: true })
    writeRows(db, state.chat, state.revision, now())
    state.legacy = false
    const backup = path.join(chatsRoot, safeChatId(chatId) + '.legacy-' + now() + '.json')
    await writeFile(backup, JSON.stringify(state.chat, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove('chats/' + safeChatId(chatId) + '.json')
    else await rmSync(path.join(chatsRoot, safeChatId(chatId) + '.json'), { force: true })
    bumpGeneration(chatId)
  }

  // ---------- 读取面 ----------
  async function read(chatId) {
    const state = await cachedState(chatId)
    return state ? copyJsonTree(state.chat) : undefined
  }
  async function readSessionState(chatId) {
    const state = await cachedState(chatId)
    return state ? projectChatSessionState(state.chat) : undefined
  }
  async function readSettlementCheckpoint(chatId, messageId, operationId) {
    const state = await cachedState(chatId)
    return state ? projectSettlementCheckpoint(state.chat, messageId, operationId) : undefined
  }
  async function readSceneImageState(chatId) {
    const state = await cachedState(chatId)
    return state ? projectSceneImageState(state.chat) : undefined
  }
  async function readBackgroundConfig(chatId) {
    const state = await cachedState(chatId)
    return state ? projectChatBackgroundConfig(state.chat) : undefined
  }
  async function readDisplayRuntimeState(chatId, turn) {
    const state = await cachedState(chatId)
    return state ? projectDisplayRuntimeState(state.chat, turn) : undefined
  }
  function slice(chat, indices, fields) {
    const { messages: rawMessages, ...allHead } = chat
    const messages = Array.isArray(rawMessages) ? rawMessages : []
    if (indices.some(i => !Number.isSafeInteger(i) || i < 0 || i >= messages.length)) throw new Error('消息楼层不存在')
    let head = allHead
    if (Array.isArray(fields)) {
      head = {}
      for (const field of fields) {
        const parts = String(field).split('.').filter(Boolean)
        if (!parts.length || parts[0] === 'messages' || parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) continue
        let source = chat
        for (const part of parts) source = source && Object.hasOwn(source, part) ? source[part] : undefined
        if (source === undefined) continue
        let target = head
        for (const part of parts.slice(0, -1)) {
          if (!Object.hasOwn(target, part) || !target[part] || typeof target[part] !== 'object') target[part] = {}
          target = target[part]
        }
        target[parts.at(-1)] = source
      }
    }
    return { chat: structuredClone({ ...head, messages: indices.map(i => messages[i]) }), messageCount: messages.length, denseMessages: Array.isArray(rawMessages) && messages.every(m => m && typeof m === 'object' && !Array.isArray(m)) }
  }
  async function readSlice(chatId, indices = [], fields) {
    const state = await cachedState(chatId)
    return state && !indices.some(i => i >= (state.chat.messages?.length || 0)) ? slice(state.chat, indices, fields) : undefined
  }
  function rememberChanges(previous, revision, changes) {
    const indices = new Set()
    let tail = Infinity
    for (const change of changes) {
      if (!change.path.length) { tail = 0; break }
      if (change.path[0] !== 'messages') continue
      if (change.path.length > 1 && Number.isSafeInteger(change.path[1])) indices.add(change.path[1])
      else tail = Math.min(tail, change.op === 'splice' ? change.index : 0)
    }
    const frames = previous.concat({ baseRevision: revision - 1, revision, indices: [...indices], tail })
    if (frames.length <= 32) return frames
    const [first, second, ...rest] = frames
    const mergedTail = Math.min(first.tail, second.tail)
    const mergedIndices = [...new Set([...first.indices, ...second.indices])].filter(index => index < mergedTail)
    if (mergedIndices.length > 4096) return frames.slice(-32)
    return [{ baseRevision: first.baseRevision, revision: second.revision, indices: mergedIndices, tail: mergedTail }, ...rest]
  }
  function changedIndices(chatId, state, revision) {
    if (!state || !Number.isSafeInteger(revision) || revision < 0 || revision > state.revision) return undefined
    if (revision === state.revision) return { indices: [], baseRevision: revision, revision: state.revision }
    const frames = knownChanges(chatId, state).filter(frame => frame.revision > revision)
    if (!frames.length || frames[0].baseRevision > revision || frames.at(-1).revision !== state.revision
      || frames.some((frame, index) => index > 0 && frame.baseRevision !== frames[index - 1].revision)) return undefined
    const length = state.chat.messages?.length || 0
    const indices = new Set(frames.flatMap(frame => frame.indices).filter(index => index < length))
    const tail = Math.min(...frames.map(frame => frame.tail))
    for (let index = tail; index < length; index++) indices.add(index)
    const sorted = [...indices].sort((a, b) => a - b)
    return { indices: sorted, baseRevision: revision, revision: state.revision }
  }
  async function readChangedIndices(chatId, revision) {
    return changedIndices(chatId, await cachedState(chatId), revision)
  }
  async function readChangedSlice(chatId, revision) {
    const state = await cachedState(chatId)
    if (revision === state?.revision) return undefined
    const changed = changedIndices(chatId, state, revision)
    return changed ? { ...slice(state.chat, changed.indices), indices: changed.indices, baseRevision: revision } : undefined
  }
  async function readViewDelta(chatId, revision) {
    const state = await cachedState(chatId)
    const changed = changedIndices(chatId, state, revision)
    if (!changed || revision === state.revision
      || Object.values(state.chat.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
      || !Array.isArray(state.chat.messages)
      || !state.chat.messages.every(row => row && typeof row === 'object' && !Array.isArray(row))) return undefined
    const dirty = new Set(changed.indices)
    const messages = state.chat.messages.map((row, index) => {
      if (dirty.has(index)) return row
      const { variables, ...display } = row
      return display
    })
    return { ...changed, chat: structuredClone({ ...state.chat, messages }) }
  }

  async function readRevision(chatId, revision) {
    const target = Number(revision)
    if (!Number.isSafeInteger(target) || target < 0) throw new Error('Chat storage revision 不合法: ' + String(revision))
    // 行级存储（彻底清理语义）：仅保留当前态，不保留历史版本——被回退/被修改的旧版本不可重建。
    // 当前态请求（revision == 现行 revision）照常返回。
    const state = await materialize(chatId, target)
    return state === null ? undefined : copyJsonTree(state.chat)
  }

  async function version(chatId) {
    const id = safeChatId(chatId)
    const file = dbFile(id)
    if (!existsSync(file)) {
      if (legacyData && typeof legacyData.version === 'function') return await legacyData.version('chats/' + id + '.json')
      try {
        const info = await stat(path.join(chatsRoot, id + '.json'), { bigint: true })
        return ['legacy', info.size, info.mtimeNs].join(':')
      } catch (error) { if (error?.code === 'ENOENT') return ''; throw error }
    }
    return generationStamp(id)
  }

  async function remove(chatId) {
    await serialize(chatId, async function () {
      const id = safeChatId(chatId)
      forgetState(chatId)
      generations.delete(id)
      const entry = open.get(id)
      if (entry) {
        try { entry.close() } catch { /* Already closed. */ }
        open.delete(id)
      }
      rmSync(dbFile(id), { force: true })
      for (const suffix of ['-wal', '-shm']) rmSync(dbFile(id) + suffix, { force: true })
      if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove('chats/' + id + '.json')
      else rmSync(path.join(chatsRoot, id + '.json'), { force: true })
      let names = []
      try { names = await readdir(chatsRoot) } catch { /* chatsRoot gone with the archive. */ }
      await Promise.all(names.filter(function (name) { return name.startsWith(id + '.legacy-') && name.endsWith('.json') }).map(function (name) {
        return rmSync(path.join(chatsRoot, name), { force: true })
      }))
    })
  }

  return Object.freeze({ detachedUpdate: true, read, readSessionState, readSceneImageState, readSettlementCheckpoint, readBackgroundConfig, readDisplayRuntimeState, readSlice, readChangedSlice, readChangedIndices, readViewDelta, patch, readRevision, update, version, remove })
}
