import { projectSceneImageState, projectChatSessionState, projectDisplayRuntimeState, projectChatBackgroundConfig, projectSettlementCheckpoint } from './chat-session-state.js'
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual, promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'
import path from 'node:path'

import { applyJsonChanges, applyJsonChangesShared, diffJson } from './json-mutation.js'

const STORAGE_REVISION = '_storageRevision'
const SNAPSHOT_PATTERN = /^(\d{12})\.json(?:\.gz)?$/
const JOURNAL_PATTERN = /^(\d{12})-(open|(\d{12}))\.jsonl$/
const compress = promisify(gzip)
const decompress = promisify(gunzip)
const SNAPSHOT_COMPRESSION_BYTES = 64 * 1024

function revisionOf(value) {
  return Math.max(0, Number(value && value[STORAGE_REVISION]) || 0)
}

function revisionName(value) {
  const revision = Number(value)
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999999999999) throw new Error('Chat storage revision 超出范围: ' + String(value))
  return String(revision).padStart(12, '0')
}

function jsonClone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function encodeSnapshot(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

function encodeFrame(value) {
  return JSON.stringify(value) + '\n'
}

function safeChatId(value) {
  const id = String(value || '')
  if (id === '' || id.includes('/') || id.includes('\\') || id === '.' || id === '..') throw new Error('Tavern Chat ID 不合法')
  return id
}

async function exists(target) {
  try { await stat(target); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function readJson(target) {
  try { return JSON.parse(await readFile(target, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return undefined; throw error }
}

/** Append-oriented JSON storage for one materialized Tavern Chat per directory. */
export function createChatJournalStore(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || ''))
  const chatsRoot = path.join(dataRoot, 'chats')
  const legacyData = options.legacyData
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const frameLimit = Math.max(1, Number(options.frameLimit) || 200)
  const maxSnapshotBytes = Number.isSafeInteger(options.maxSnapshotBytes) && options.maxSnapshotBytes > 0 ? options.maxSnapshotBytes : 256 * 1024 * 1024
  const byteLimit = Math.max(1, Number(options.byteLimit) || 1024 * 1024)
  const mutationTails = new Map()
  // Approximate retained JS size, bounded independently of the number of games.
  const limit = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback
  const cacheMaxBytes = limit(options.cacheMaxBytes, 256 * 1024 * 1024)
  const maxCachedChats = limit(options.maxCachedChats, 8)
  const readCache = new Map()
  const pendingReads = new Map()
  const sizes = new WeakMap()
  let cachedBytes = 0
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
    // Internal states are immutable; shared subtrees reuse their size estimate.
    // Size accounting must not serialize the entire chat on each small patch.
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
  if (String(options.dataRoot || '') === '') throw new Error('Chat Journal Store 缺少 dataRoot')

  function layout(chatId) {
    const id = safeChatId(chatId)
    const root = path.join(chatsRoot, id)
    return {
      id,
      root,
      snapshots: path.join(root, 'snapshots'),
      journals: path.join(root, 'journals'),
      legacy: path.join(chatsRoot, id + '.json'),
      legacyRelative: 'chats/' + id + '.json'
    }
  }

  function serialize(chatId, operation) {
    const id = safeChatId(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const current = previous.catch(function () {}).then(operation)
    mutationTails.set(id, current)
    return current.finally(function () { if (mutationTails.get(id) === current) mutationTails.delete(id) })
  }

  async function legacyRead(paths) {
    if (legacyData && typeof legacyData.readJson === 'function') return await legacyData.readJson(paths.legacyRelative)
    return await readJson(paths.legacy)
  }

  async function snapshotRows(paths) {
    let names
    try { names = await readdir(paths.snapshots) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = SNAPSHOT_PATTERN.exec(name)
      return match === null ? null : { name, revision: Number(match[1]), path: path.join(paths.snapshots, name) }
    }).filter(Boolean).sort(function (left, right) { return left.revision - right.revision })
  }

  async function journalRows(paths) {
    let names
    try { names = await readdir(paths.journals) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
    return names.map(function (name) {
      const match = JOURNAL_PATTERN.exec(name)
      if (match === null) return null
      return {
        name,
        start: Number(match[1]),
        end: match[2] === 'open' ? Number.POSITIVE_INFINITY : Number(match[3]),
        open: match[2] === 'open',
        path: path.join(paths.journals, name)
      }
    }).filter(Boolean).sort(function (left, right) { return left.start - right.start || Number(left.open) - Number(right.open) })
  }

  async function parseJournal(row, afterRevision, targetRevision) {
    const text = await readFile(row.path, 'utf8')
    const lines = text.split('\n')
    const frames = []
    let validBytes = 0
    let invalidLine = 0
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (line === '') {
        validBytes += index < lines.length - 1 ? 1 : 0
        continue
      }
      let frame
      try { frame = JSON.parse(line) } catch (error) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal 尾行损坏，忽略该行及后续内容:', row.path + ':' + invalidLine, String(error?.message || error))
        break
      }
      validBytes += Buffer.byteLength(line + '\n')
      const revision = Number(frame && frame.revision)
      if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(frame.changes)) {
        invalidLine = index + 1
        if (logger && typeof logger.warn === 'function') logger.warn('dsh-tavern: Chat journal frame 不合法，忽略该行及后续内容:', row.path + ':' + invalidLine)
        break
      }
      if (revision > afterRevision && revision <= targetRevision) frames.push(frame)
    }
    return { frames, lineCount: frames.length, bytes: Buffer.byteLength(text), validBytes, invalidLine }
  }

  async function materializeDirectory(paths, targetRevision = Number.POSITIVE_INFINITY) {
    const snapshots = await snapshotRows(paths)
    const eligible = snapshots.filter(function (row) { return row.revision <= targetRevision })
    let selected = null, chat
    for (const row of eligible.slice().reverse()) {
      chat = await readSnapshot(paths, row)
      if (chat !== undefined) { selected = row; break }
    }
    if (!selected) chat = await legacyRead(paths)
    const journals = await journalRows(paths)
    if (chat === undefined) {
      // An interrupted first write may have left only staging files/directories.
      if (snapshots.length === 0 && journals.length === 0) return null
      throw new Error('Chat Journal 缺少可用 snapshot: ' + paths.id)
    }
    let revision = selected ? selected.revision : revisionOf(chat)
    if (!selected && (chat === null || typeof chat !== 'object' || Array.isArray(chat) || chat.id !== paths.id)) {
      throw new Error('Legacy Chat 不合法: ' + paths.id)
    }
    let open = null
    let openFrameCount = 0
    let openValidBytes = 0
    let openInvalidLine = 0
    const changes = []
    for (const row of journals) {
      if (row.end <= revision || row.start > targetRevision) continue
      const parsed = await parseJournal(row, revision, targetRevision)
      for (const frame of parsed.frames) {
        if (Number(frame.baseRevision) !== revision || Number(frame.revision) !== revision + 1) {
          const error = new Error('Chat journal revision 不连续: ' + row.path + '，期望 ' + (revision + 1) + '，实际 ' + frame.revision)
          error.code = 'DSH_TAVERN_JOURNAL_GAP'
          throw error
        }
        if (!Array.isArray(frame.changes)) throw new Error('JSON mutation changes 必须是数组')
        for (const change of frame.changes) changes.push(change)
        revision = Number(frame.revision)
      }
      if (row.open) {
        open = row
        openFrameCount = parsed.frames.length
        openValidBytes = parsed.validBytes
        openInvalidLine = parsed.invalidLine
      }
    }
    // A corrupt published snapshot proves this revision once existed. Do not
    // silently return an older state when its replay chain is missing.
    const requiredRevision = eligible.at(-1)?.revision ?? revision
    if (revision < requiredRevision) throw new Error('Chat snapshot 恢复缺少完整 journal，期望 revision ' + requiredRevision + ': ' + paths.id)
    if (targetRevision !== Number.POSITIVE_INFINITY && revision !== targetRevision) {
      const error = new Error('Chat Journal 找不到 revision ' + targetRevision + ': ' + paths.id)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    // Replay the ordered changes in one clone. Cloning the full card once per
    // journal frame makes initialization slower with every small script write.
    chat = applyJsonChanges(chat, changes)
    chat[STORAGE_REVISION] = revision
    return { chat, revision, snapshot: selected, open, openFrameCount, openValidBytes, openInvalidLine, legacy: selected === null }
  }

  async function materialize(chatId, targetRevision = Number.POSITIVE_INFINITY) {
    const paths = layout(chatId)
    if (await exists(paths.root)) return await materializeDirectory(paths, targetRevision)
    const chat = await legacyRead(paths)
    if (chat === undefined) return null
    const revision = revisionOf(chat)
    if (targetRevision !== Number.POSITIVE_INFINITY && targetRevision !== revision) {
      const error = new Error('Legacy Chat 只有 revision ' + revision + '，无法读取 revision ' + targetRevision)
      error.code = 'DSH_TAVERN_REVISION_NOT_FOUND'
      throw error
    }
    chat[STORAGE_REVISION] = revision
    return { chat: jsonClone(chat), revision, snapshot: null, open: null, openFrameCount: 0, legacy: true }
  }

  async function readSnapshot(paths, row) {
    try {
      const bytes = await readFile(row.path)
      const chat = JSON.parse((row.path.endsWith('.gz') ? await decompress(bytes, { maxOutputLength: maxSnapshotBytes }) : bytes).toString('utf8'))
      if (chat && typeof chat === 'object' && !Array.isArray(chat) && chat.id === paths.id &&
        Number.isSafeInteger(chat[STORAGE_REVISION]) && chat[STORAGE_REVISION] === row.revision) return chat
    } catch (error) {
      if (!(error instanceof SyntaxError) && !['Z_DATA_ERROR', 'Z_BUF_ERROR', 'ENOENT'].includes(error?.code)) throw error
    }
    logger?.warn?.('dsh-tavern: Chat snapshot 损坏，尝试历史快照与 journal:', row.path)
    return undefined
  }

  async function writeSnapshot(paths, chat, revision) {
    await mkdir(paths.snapshots, { recursive: true })
    const plainTarget = path.join(paths.snapshots, revisionName(revision) + '.json')
    for (const target of [plainTarget, plainTarget + '.gz']) {
      if (!(await exists(target))) continue
      const previous = await readSnapshot(paths, { path: target, revision })
      if (previous !== undefined) {
        if (!isDeepStrictEqual(previous, chat)) throw new Error('Chat snapshot revision 冲突: ' + target)
        return target
      }
    }
    // Encode only at the file boundary. Preserve property order for JSON/YAML
    // variable macros and LLM prefix caching; never reconstruct MVU display deltas.
    const json = JSON.stringify(chat)
    if (Buffer.byteLength(json) > maxSnapshotBytes) throw new Error('Chat snapshot 超过大小上限')
    const compressed = Buffer.byteLength(json) >= SNAPSHOT_COMPRESSION_BYTES
    const bytes = compressed ? await compress(json, { level: 1 }) : encodeSnapshot(chat)
    const target = plainTarget + (compressed ? '.gz' : '')
    if (await exists(target)) {
      // Preserve the failed old writer's bytes for diagnosis before replacement.
      await rename(target, target + '.corrupt-' + randomUUID())
    }
    const staging = target + '.staging-' + randomUUID()
    let handle
    try {
      handle = await open(staging, 'wx')
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close(); handle = null
      await rename(staging, target)
      // Flush the published directory entry before migration removes its source.
      if (process.platform !== 'win32') {
        handle = await open(paths.snapshots, 'r')
        try { await handle.sync() } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error?.code)) throw error }
      }
    } finally {
      if (handle) await handle.close()
      await rm(staging, { force: true })
    }
    return target
  }

  async function migrateLegacy(paths, current) {
    await mkdir(paths.journals, { recursive: true })
    await writeSnapshot(paths, current, revisionOf(current))
    if (!(await exists(paths.legacy)) && !(legacyData && typeof legacyData.remove === 'function')) return
    const backup = path.join(chatsRoot, paths.id + '.legacy-' + now() + '.json')
    await writeFile(backup, encodeSnapshot(current), { encoding: 'utf8', flag: 'wx' })
    if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
    else await rm(paths.legacy, { force: true })
  }

  async function appendFrame(paths, frame, currentOpen) {
    await mkdir(paths.journals, { recursive: true })
    const openPath = currentOpen === null
      ? path.join(paths.journals, revisionName(frame.revision) + '-open.jsonl')
      : currentOpen.path
    await appendFile(openPath, encodeFrame(frame), 'utf8')
    return { path: openPath, start: currentOpen === null ? frame.revision : currentOpen.start, open: true }
  }

  async function maybeRotate(paths, state, open, frameCount) {
    const info = await stat(open.path)
    if (frameCount < frameLimit && info.size < byteLimit) return false
    const snapshotPath = await writeSnapshot(paths, state.chat, state.revision)
    const sealed = path.join(paths.journals, revisionName(open.start) + '-' + revisionName(state.revision) + '.jsonl')
    await rename(open.path, sealed)
    return { path: snapshotPath, name: path.basename(snapshotPath), revision: state.revision }
  }

  // Each cached game remains verified against disk on every read.
  async function cachedState(chatId) {
    const stamp = await version(chatId)
    const entry = readCache.get(chatId)
    if (stamp && entry?.stamp === stamp) {
      readCache.delete(chatId); readCache.set(chatId, entry)
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
  async function read(chatId) {
    const state = await cachedState(chatId)
    return state ? structuredClone(state.chat) : undefined
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
    const {messages:rawMessages,...allHead}=chat
    const messages=Array.isArray(rawMessages)?rawMessages:[]
    if(indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=messages.length))throw new Error('消息楼层不存在')
    let head=allHead
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
    return {chat:structuredClone({...head,messages:indices.map(i=>messages[i])}),messageCount:messages.length,denseMessages:Array.isArray(rawMessages) && messages.every(m=>m && typeof m==='object' && !Array.isArray(m))}
  }
  /** Detached metadata and selected native rows, never an editable full-chat snapshot. */
  async function readSlice(chatId, indices=[], fields) {
    const state=await cachedState(chatId)
    return state && !indices.some(i=>i>=(state.chat.messages?.length||0)) ? slice(state.chat,indices,fields) : undefined
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
    const frames = previous.concat({baseRevision: revision - 1, revision, indices: [...indices], tail})
    if (frames.length <= 32) return frames
    const [first, second, ...rest] = frames
    const mergedTail = Math.min(first.tail, second.tail)
    const mergedIndices = [...new Set([...first.indices, ...second.indices])].filter(index => index < mergedTail)
    // Keep a conservative older summary plus exact recent frames. Bound the
    // summary too; eviction loses coverage and safely restores the full fallback.
    if (mergedIndices.length > 4096) return frames.slice(-32)
    return [{baseRevision:first.baseRevision,revision:second.revision,indices:mergedIndices,tail:mergedTail},...rest]
  }
  function changedIndices(chatId, state, revision) {
    if (!state || !Number.isSafeInteger(revision) || revision < 0 || revision > state.revision) return undefined
    if (revision === state.revision) return {indices:[],baseRevision:revision,revision:state.revision}
    const frames = knownChanges(chatId, state).filter(frame => frame.revision > revision)
    if (!frames.length || frames[0].baseRevision > revision || frames.at(-1).revision !== state.revision
      || frames.some((frame,index)=>index > 0 && frame.baseRevision !== frames[index-1].revision)) return undefined
    const length = state.chat.messages?.length || 0
    const indices = new Set(frames.flatMap(frame => frame.indices).filter(index => index < length))
    const tail = Math.min(...frames.map(frame => frame.tail))
    for (let index = tail; index < length; index++) indices.add(index)
    const sorted = [...indices].sort((a,b) => a-b)
    return {indices:sorted,baseRevision:revision,revision:state.revision}
  }
  async function readChangedIndices(chatId, revision) {
    return changedIndices(chatId, await cachedState(chatId), revision)
  }
  async function readChangedSlice(chatId, revision) {
    const state = await cachedState(chatId)
    if (revision === state?.revision) return undefined
    const changed = changedIndices(chatId,state,revision)
    return changed ? {...slice(state.chat,changed.indices),indices:changed.indices,baseRevision:revision} : undefined
  }
  /** Detached display input: unchanged Helper variables come from the cached view.
   * Never use this projection as a writable Chat or for a full Helper rebuild. */
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
  /** Exact-version internal commit; stale callers must use their existing merge path. */
  async function patch(chatId, expectedRevision, changes, metadata={}) {
    return serialize(chatId,async()=>{
      const state=await cachedState(chatId)
      if(!state || state.revision!==expectedRevision)return undefined
      // An acknowledged no-op is not a story edit: keep undo points valid.
      // Check the exact revision and transaction guard under the same lock.
      if(changes.length===0){metadata.assertCurrent?.();return slice(state.chat,[]).chat}
      const paths=layout(chatId)
      // Cache and disk must contain the same JSON. Canonicalize only changed
      // payloads, never copy the complete chat on this fast path.
      const normalized = []
      for (const change of changes) {
        if (change.op === 'set' && change.value === undefined) {
          if (!change.path.length) throw new Error('Journal root cannot be undefined')
          const current = applyJsonChangesShared(state.chat, normalized)
          let parent = current
          for (const key of change.path.slice(0,-1)) parent = parent?.[key]
          if (!parent || typeof parent !== 'object') throw new Error('Missing mutation parent')
          const key = change.path.at(-1)
          if (Array.isArray(parent)) normalized.push({...change,value:null})
          else if (Object.hasOwn(parent,key)) normalized.push({op:'delete',path:change.path})
        } else normalized.push(jsonClone(change))
      }
      changes = normalized
      const next=applyJsonChangesShared(state.chat,changes)
      if(next.id!==chatId || revisionOf(next)!==expectedRevision+1)throw new Error('Invalid journal patch revision')
      if(state.legacy)await migrateLegacy(paths,state.chat)
      if(state.open && state.openInvalidLine>0)await truncate(state.open.path,state.openValidBytes)
      const frame={schemaVersion:1,chatId,baseRevision:expectedRevision,revision:expectedRevision+1,timestamp:now(),source:String(metadata.source||'unknown'),changes}
      if(metadata.requestId)frame.requestId=String(metadata.requestId)
      if(metadata.operationId)frame.operationId=String(metadata.operationId)
      metadata.assertCurrent?.()
      const recentChanges = knownChanges(chatId, state)
      forgetState(chatId)
      const open=await appendFrame(paths,frame,state.open)
      const rotated=await maybeRotate(paths,{chat:next,revision:frame.revision},open,state.openFrameCount+1)
      rememberState(chatId, await version(chatId), {...state,chat:next,revision:frame.revision,legacy:false,
        snapshot:rotated || state.snapshot,open:rotated ? null : open,openFrameCount:rotated ? 0 : state.openFrameCount+1,openInvalidLine:0},
        rememberChanges(recentChanges, frame.revision, changes))
      return slice(next,[]).chat
    })
  }

  async function readRevision(chatId, revision) {
    const target = Number(revision)
    if (!Number.isSafeInteger(target) || target < 0) throw new Error('Chat storage revision 不合法: ' + String(revision))
    const state = await materialize(chatId, target)
    return state === null ? undefined : jsonClone(state.chat)
  }

  async function update(chatId, updater, metadata = {}) {
    if (typeof updater !== 'function') throw new Error('Chat Journal Store 缺少 updater')
    return await serialize(chatId, async function () {
      const paths = layout(chatId)
      const currentState = await cachedState(paths.id)
      const current = currentState == null ? undefined : currentState.chat
      const produced = await updater(jsonClone(current))
      if (produced === undefined) return jsonClone(current)
      // Normalize once before persistence. The already-JSON result can be
      // detached with structuredClone without another full JSON string.
      const next = jsonClone(produced)
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) throw new Error('Chat Journal 只能保存 JSON object')
      if (currentState == null) {
        await mkdir(paths.journals, { recursive: true })
        const revision = revisionOf(next)
        const snapshotPath = await writeSnapshot(paths, next, revision)
        rememberState(chatId, await version(chatId), { chat: next, revision, legacy: false,
          snapshot: { path: snapshotPath, name: path.basename(snapshotPath), revision },
          open: null, openFrameCount: 0, openValidBytes: 0, openInvalidLine: 0 })
        return structuredClone(next)
      }
      const baseRevision = currentState.revision
      const revision = revisionOf(next)
      if (revision !== baseRevision + 1) throw new Error('Chat Journal 写入 revision 非连续，期望 ' + (baseRevision + 1) + '，实际 ' + revision)
      const changes = diffJson(current, next)
      if (changes.length === 0) return jsonClone(current)
      if (currentState.legacy) await migrateLegacy(paths, current)
      if (currentState.open !== null && currentState.openInvalidLine > 0) {
        await truncate(currentState.open.path, currentState.openValidBytes)
      }
      const frame = {
        schemaVersion: 1,
        chatId: paths.id,
        baseRevision,
        revision,
        timestamp: now(),
        source: String(metadata.source || 'unknown'),
        changes
      }
      if (metadata.requestId) frame.requestId = String(metadata.requestId)
      if (metadata.operationId) frame.operationId = String(metadata.operationId)
      const recentChanges = knownChanges(chatId, currentState)
      forgetState(chatId)
      const open = await appendFrame(paths, frame, currentState.open)
      const rotated = await maybeRotate(paths, { chat: next, revision }, open, currentState.openFrameCount + 1)
      // Rotation publishes the same materialized state. Keep it cached instead
      // of reading, decoding and replaying a full chat on the very next access.
      // Disk stamps still invalidate it for external writes or corruption.
      rememberState(chatId, await version(chatId), { ...currentState, chat: next, revision, legacy: false,
        snapshot: rotated || currentState.snapshot, open: rotated ? null : open,
        openFrameCount: rotated ? 0 : currentState.openFrameCount + 1, openInvalidLine: 0 },
        rememberChanges(recentChanges, revision, changes))
      return structuredClone(next)
    })
  }

  async function version(chatId) {
    const paths = layout(chatId)
    if (!(await exists(paths.root))) {
      if (legacyData && typeof legacyData.version === 'function') return await legacyData.version(paths.legacyRelative)
      try {
        const info = await stat(paths.legacy, { bigint: true })
        return ['legacy', info.size, info.mtimeNs].join(':')
      } catch (error) { if (error?.code === 'ENOENT') return ''; throw error }
    }
    const snapshots = await snapshotRows(paths)
    const journals = await journalRows(paths)
    const latestSnapshot = snapshots[snapshots.length - 1]
    // Recovery may use any earlier snapshot/journal, or the legacy source during
    // migration. All of those files must participate in cache invalidation.
    const stamps = await Promise.all([...snapshots, ...journals].map(async row => {
      const info = await stat(row.path, { bigint: true })
      return [row.name,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':')
    }))
    let legacyStamp = ''
    if (legacyData && typeof legacyData.version === 'function') legacyStamp = await legacyData.version(paths.legacyRelative)
    else {
      try {
        const info = await stat(paths.legacy, { bigint: true })
        legacyStamp = [info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':')
      } catch (error) { if (error?.code !== 'ENOENT') throw error }
    }
    if (!stamps.length && !legacyStamp) return ''
    return ['journal', latestSnapshot?.name || '', ...stamps, legacyStamp].join(':')
  }

  async function remove(chatId) {
    await serialize(chatId, async function () {
      const paths = layout(chatId)
      forgetState(chatId)
      await rm(paths.root, { recursive: true, force: true })
      if (legacyData && typeof legacyData.remove === 'function') await legacyData.remove(paths.legacyRelative)
      else await rm(paths.legacy, { force: true })
      let names
      try { names = await readdir(chatsRoot) } catch (error) { if (error?.code === 'ENOENT') return; throw error }
      await Promise.all(names.filter(function (name) { return name.startsWith(paths.id + '.legacy-') && name.endsWith('.json') }).map(function (name) {
        return rm(path.join(chatsRoot, name), { force: true })
      }))
    })
  }

  // update() owns both boundaries: updater drafts and returned values are
  // detached from cached state and from each other, including aborted writes.
  return Object.freeze({ detachedUpdate: true, read, readSessionState, readSceneImageState, readSettlementCheckpoint, readBackgroundConfig, readDisplayRuntimeState, readSlice, readChangedSlice, readChangedIndices, readViewDelta, patch, readRevision, update, version, remove })
}
