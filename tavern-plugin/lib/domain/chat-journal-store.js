import { createLegacyChatJournal } from './legacy-chat-journal.js'
import { createChatStorageMigration } from './chat-storage-migration.js'
import {projectTavernHelperContext,hydrateTavernHelperMessages} from './tavern-helper-context.js'
import { createNativeConversationStorage } from './native-conversation-storage.js'
import { createLegacyCompatibleStorage } from './legacy-compatible-storage.js'
import { createSessionMessageIndex } from './session-message-index.js'
import { copyLazyHistoryHeader } from './lazy-history-read.js'
import { Worker } from 'node:worker_threads'
import { createScopedMessages, isScopedMessages } from './scoped-messages.js'
import { createIndexedArrayApi } from './indexed-array.js'
import { copyJsonTree } from './copy-json-tree.js'
import { projectSceneImageState, projectChatSessionState, projectDisplayRuntimeState, projectChatBackgroundConfig, projectSettlementCheckpoint } from './chat-session-state.js'
import { mkdir, open, readdir, rename, rm, stat, truncate } from 'node:fs/promises'
import path from 'node:path'
import { channel } from 'node:diagnostics_channel'
import { performance } from 'node:perf_hooks'
const readMetrics = channel('dsh.chat.read')

import { applyJsonChangesShared, diffJson } from './json-mutation.js'

const STORAGE_REVISION = '_storageRevision'
// What every save stamps on itself (chat-persistence): alone, they are no change.
const STAMPS = new Set([STORAGE_REVISION, 'updatedAt'])
const SNAPSHOT_PATTERN = /^(\d{12})\.json(?:\.gz)?$/

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

async function exists(target) {
  try { await stat(target); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function directoryBytes(target) {
  let total = 0
  let entries = []
  try { entries = await readdir(target, { withFileTypes: true }) } catch (error) { if (error?.code === 'ENOENT') return 0; throw error }
  for (const entry of entries) {
    const file = path.join(target, entry.name)
    total += entry.isDirectory() ? await directoryBytes(file) : (await stat(file)).size
  }
  return total
}

/** Append-oriented JSON storage for one materialized Tavern Chat per directory. */
export function createChatJournalStore(options = {}) {
  const dataRoot = path.resolve(String(options.dataRoot || ''))
  const chatsRoot = path.join(dataRoot, 'chats')
  const loadMetrics = new Map()
  const native = createNativeConversationStorage({dataRoot,onIO:event => {
    options.onNativeIO?.(event)
    if (event.kind === 'phase' && readMetrics.hasSubscribers) readMetrics.publish(event)
    const row=loadMetrics.get(event.chatId)
    if(row && event.kind==='read') {
      row.blocks++; row.bytes+=event.bytes; row.readMs+=event.readMs||0; row.decodeMs+=event.decodeMs||0
      row.maxReadMs=Math.max(row.maxReadMs,event.readMs||0)
      row.refs.add(event.ref)
    }
  }})
  const compatible = options.compatibleStorage === false ? null : createLegacyCompatibleStorage({dataRoot,onIO:options.onCompatibilityIO})
  const legacyData = options.legacyData
  const logger = options.logger || console
  const now = typeof options.now === 'function' ? options.now : Date.now
  const maxSnapshotBytes = Number.isSafeInteger(options.maxSnapshotBytes) && options.maxSnapshotBytes > 0 ? options.maxSnapshotBytes : 256 * 1024 * 1024
  const mutationTails = new Map()
  const maintenancePending = new Map()
  let maintenanceRunning = null
  function requestSnapshot(chatId, revision) {
    maintenancePending.set(chatId, revision)
    if (maintenanceRunning) return
    maintenanceRunning = Promise.resolve().then(async () => {
      while (maintenancePending.size) {
        const [id, target] = maintenancePending.entries().next().value
        maintenancePending.delete(id)
        try {
          const prepared = await new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./chat-snapshot-worker.js', import.meta.url), {
              workerData:{dataRoot,chatId:id,revision:target,maxSnapshotBytes},execArgv:[]
            })
            let result
            worker.once('message', value => { result = value })
            worker.once('error', reject)
            worker.once('exit', code => code === 0 && result?.path ? resolve(result) : reject(new Error(result?.error || 'Snapshot worker exited ' + code)))
          })
          await serialize(id, async () => {
            const paths = layout(id)
            const state = await cachedState(id)
            if (!state || state.revision < target) { await rm(prepared.path,{force:true}); return }
            const name = path.basename(prepared.path)
            if (path.dirname(prepared.path) !== path.join(paths.root,'maintenance') || !SNAPSHOT_PATTERN.test(name)) throw new Error('Invalid prepared snapshot path')
            const targetPath = path.join(paths.snapshots,name)
            if (await exists(targetPath)) {
              // cachedState already validated the on-disk inventory. Do not
              // replace or bless a concurrently published snapshot here.
              await rm(prepared.path,{force:true})
              return
            } else {
              await rename(prepared.path,targetPath)
              if (process.platform !== 'win32') {
                const directory = await open(paths.snapshots,'r')
                try { await directory.sync() }
                catch (error) { if (!['EINVAL','ENOTSUP','EISDIR'].includes(error?.code)) throw error }
                finally { await directory.close() }
              }
            }
            const recent = knownChanges(id,state)
            rememberState(id,await version(id),{...state,snapshot:state.snapshot?.revision > target ? state.snapshot : {path:targetPath,name,revision:target}},recent)
          })
        } catch (error) {
          // The sealed journal remains authoritative and replayable. Maintenance
          // failure cannot revoke an already acknowledged variable transaction.
          logger?.warn?.('dsh-tavern: background Chat snapshot failed:', error.message)
        }
      }
    }).finally(() => {
      maintenanceRunning = null
      if (maintenancePending.size) { const [id, revision] = maintenancePending.entries().next().value; requestSnapshot(id,revision) }
    })
  }
  async function flushMaintenance() { while (maintenanceRunning) await maintenanceRunning }
  async function prepareSnapshot(chatId, revision) {
    const paths = layout(chatId)
    const state = await materialize(chatId,revision)
    if (!state) throw new Error('Snapshot chat disappeared')
    return {path:await writeSnapshot({...paths,snapshots:path.join(paths.root,'maintenance')},state.chat,revision),revision}
  }
  const journal = createLegacyChatJournal({ layout, chatsRoot, legacyData, logger, now, maxSnapshotBytes,
    frameLimit: Math.max(1, Number(options.frameLimit) || 200), byteLimit: Math.max(1, Number(options.byteLimit) || 1024 * 1024),
    backgroundSnapshots: options.backgroundSnapshots, requestSnapshot })
  const { read: materializeLegacy, version: legacyVersion, writeSnapshot, migrateLegacy, appendFrame, maybeRotate } = journal
  const { upgradeStorage, migrateCompatibility, restoreLegacy } = createChatStorageMigration({
    native, compatible, journal, serialize, flushMaintenance, materialize, version, forgetState, layout, safeChatId, now, logger })

  // Approximate retained JS size, bounded independently of the number of games.
  const limit = (value, fallback) => Number.isSafeInteger(value) && value >= 0 ? value : fallback
  const cacheMaxBytes = limit(options.cacheMaxBytes, 256 * 1024 * 1024)
  const maxCachedChats = limit(options.maxCachedChats, 8)
  const readCache = new Map()
  const pendingReads = new Map()
  const sizes = new WeakMap()
  let cachedBytes = 0
  const sessionMessages = createSessionMessageIndex()
  const indexedMessages = createIndexedArrayApi({
    valid: row => Boolean(row && typeof row === 'object' && !Array.isArray(row)),
    measure: value => estimateBytes(value),
    visit: options.onIndexedMessageVisit,
    eligible: row => {
      const count = Math.max(row?.variables?.length || 0, row?.swipes?.length || 0, 1)
      const swipe = Math.max(0,Math.min(count - 1,Number(row?.swipeId)||0))
      const value = row?.variables?.[swipe]
      return value?.stat_data !== undefined && value?.schema !== undefined
    }
  })
  function indexChat(chat) {
    return Array.isArray(chat?.messages) ? {...chat,messages:indexedMessages.from(chat.messages)} : chat
  }
  // Tail splices (append, truncate, replace the latest rows) and whole-row sets
  // keep the indexed history: unchanged floors are shared, not re-indexed.
  function applyTailChanges(chat, changes) {
    if (!Array.isArray(chat.messages)) return undefined
    let length = chat.messages.length
    const rows = new Map(), head = []
    for (const change of changes) {
      if (change.path[0] !== 'messages') { head.push(change); continue }
      if (change.path.length === 1 && change.op === 'splice') {
        if (change.index !== length - change.deleteCount || change.index < 0 || !Array.isArray(change.items)) return undefined
        for (let id = change.index; id < length; id++) rows.delete(id)
        length = change.index
        for (const item of change.items) rows.set(length++, item)
        continue
      }
      const id = change.path[1]
      if (change.path.length < 2 || !Number.isSafeInteger(id) || id < 0 || id >= length || (change.path.length === 2 && change.op !== 'set')) return undefined
      const row = rows.has(id) ? rows.get(id) : chat.messages[id]
      rows.set(id, change.path.length === 2 ? change.value : applyJsonChangesShared(row, [{ ...change, path: change.path.slice(2) }]))
    }
    const result = applyJsonChangesShared(chat, head)
    return { ...result, messages: indexedMessages.update(chat.messages, [...rows].filter(([id]) => id < length), length) }
  }
  function applyIndexedChanges(chat, changes) {
    if (changes.some(c => c.path.length === 1 && c.path[0] === 'messages' && c.op === 'splice')) {
      const tail = applyTailChanges(chat, changes)
      if (tail) return tail
    }
    const pointEdits = changes.every(c => c.path.length && (c.path[0] !== 'messages'
      || (c.path.length >= 2 && Number.isSafeInteger(c.path[1]) && c.path[1] >= 0 && c.path[1] < (chat.messages?.length || 0)
        && !(c.path.length === 2 && c.op === 'delete'))))
    if (!pointEdits || !Array.isArray(chat.messages)) return indexChat(applyJsonChangesShared(chat,changes))
    const rows = new Map(), head = []
    for (const change of changes) {
      if (change.path[0] !== 'messages') { head.push(change); continue }
      const id = change.path[1]
      const row = rows.has(id) ? rows.get(id) : chat.messages[id]
      rows.set(id,applyJsonChangesShared(row,[{...change,path:change.path.slice(2)}]))
    }
    const result = applyJsonChangesShared(chat,head)
    if (!rows.size) return result
    const messages=indexedMessages.update(chat.messages,[...rows])
    sessionMessages.advance(chat.id,chat.messages,messages,[...rows.keys()])
    return {...result,messages}
  }
  function estimateBytes(value) {
    if (typeof value === 'string') return 24 + value.length * 2
    if (!value || typeof value !== 'object') return 8
    const indexed = indexedMessages.info(value)
    if (indexed) return indexed.bytes
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
    state.chat = indexChat(state.chat)
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

  // Every committed revision, whatever wrote it: save maintenance counts these.
  function committed(chatId, revision) { options.onCommit?.(chatId, revision) }
  function serialize(chatId, operation) {
    const id = safeChatId(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const started = performance.now()
    const current = previous.catch(function () {}).then(async () => {
      if (readMetrics.hasSubscribers) readMetrics.publish({name:'chat.write.wait',chatId:id,durationMs:performance.now()-started})
      const entered = performance.now()
      try { return await (compatible ? compatible.lock(id,operation) : operation()) }
      finally { if (readMetrics.hasSubscribers) readMetrics.publish({name:'chat.write.hold',chatId:id,durationMs:performance.now()-entered}) }
    })
    mutationTails.set(id, current)
    return current.finally(function () { if (mutationTails.get(id) === current) mutationTails.delete(id) })
  }

  async function materialize(chatId, targetRevision = Number.POSITIVE_INFINITY) {
    return await native.read(chatId,targetRevision) || await compatible?.read(chatId,targetRevision) || materializeLegacy(chatId,targetRevision)
  }
  // Each cached game remains verified against disk on every read.
  async function cachedState(chatId) {
    const started = performance.now(), stamp = await version(chatId)
    if (readMetrics.hasSubscribers) readMetrics.publish({name:'chat.version',chatId,durationMs:performance.now()-started})
    const entry = readCache.get(chatId)
    if (stamp && entry?.stamp === stamp) {
      readCache.delete(chatId); readCache.set(chatId, entry)
      return entry.state
    }
    forgetState(chatId)
    // Native saves can read floors alone: building one whole on a per-turn path is reported.
    const built = state => { if (state?.native) reportWhole(chatId, state); return state }
    const pending = pendingReads.get(chatId)
    if (pending?.stamp === stamp) {
      pending.readers++
      const joined = performance.now()
      try { return built(await pending.promise) }
      finally { if (readMetrics.hasSubscribers) readMetrics.publish({name:'chat.join',chatId,durationMs:performance.now()-joined}) }
    }
    const load = { stamp, readers:1 }, entered = performance.now()
    const metrics = {blocks:0,bytes:0,readMs:0,decodeMs:0,maxReadMs:0,refs:new Set()}
    loadMetrics.set(chatId,metrics)
    load.promise = (async () => {
      try {
        const state = await materialize(chatId)
        if (stamp && stamp === await version(chatId) && pendingReads.get(chatId) === load) {
          rememberState(chatId, stamp, state)
        }
        return state
      } finally {
        if (readMetrics.hasSubscribers) readMetrics.publish({name:'chat.materialize',chatId,durationMs:performance.now()-entered,readers:load.readers,...metrics,refs:metrics.refs.size})
        if(loadMetrics.get(chatId)===metrics)loadMetrics.delete(chatId)
        if (pendingReads.get(chatId) === load) pendingReads.delete(chatId)
      }
    })()
    pendingReads.set(chatId, load)
    return load.promise.then(built)
  }
  function reportWhole(chatId, state, site) { options.wholeReadGuard?.report(chatId, state.chat?.messages?.length, site) }
  async function read(chatId) {
    if(options.migrateLegacy === true && compatible && !mutationTails.has(safeChatId(chatId)))await migrateCompatibility(chatId)
    const state = await cachedState(chatId)
    if (state?.native) reportWhole(chatId, state)
    return state ? copyJsonTree(state.chat) : undefined
  }
  // Native-only opt-in. Null keeps legacy readers on their complete contract.
  async function readWindow(chatId,options) { return native.readWindow(chatId,options) }
  async function readRecentSummaries(chatId,count) { return native.readRecentSummaries(chatId,count) }
  async function readHelperContext(chatId, range) {
    const selected = await native.readHelperContext(chatId, range)
    if (selected !== null) return selected
    const chat = range?.revision === undefined ? await read(chatId) : await readRevision(chatId,range.revision)
    if (!chat) return undefined
    const context = projectTavernHelperContext(range ? {...chat,messages:[]} : chat)
    if (!range) return {chat,context}
    const hydrated = hydrateTavernHelperMessages(chat,range.from,range.to)
    return {chat,context:{...context,messages:hydrated.messages},from:hydrated.from,to:hydrated.to}
  }
  async function readSessionState(chatId, options = {}) {
    const cached=readCache.get(chatId)
    if(!cached||cached.stamp!==await version(chatId)){
      const selected=await native.readSessionState(chatId,options)
      if(selected!==null)return selected
    }
    // Internal readers opt into lazy, detached rows. Default callers retain
    // ordinary arrays (including structuredClone compatibility).
    const state = await cachedState(chatId)
    if (state?.native) reportWhole(chatId, state)
    return state ? projectChatSessionState(state.chat, options.scoped === true ? sessionMessages.project(state.chat) : {}) : undefined
  }
  async function readSettlementCheckpoint(chatId, messageId, operationId) {
    const selected = await native.readSlice(chatId, [messageId], [
      'id', 'sessionId', '_storageRevision', 'tavernHelperLifecycleRevision', 'timeline.schemaVersion',
      'timeline.branchId', 'timeline.revision', 'timeline.operations'
    ])
    if (selected !== null) {
      if (!selected) return undefined
      const result = projectSettlementCheckpoint(selected.chat, 0, operationId)
      return result
    }
    const state = await cachedState(chatId)
    return state ? projectSettlementCheckpoint(state.chat, messageId, operationId) : undefined
  }
  async function readSceneImageState(chatId, options) {
    if(Array.isArray(options?.turns)){
      const selected=await native.readSceneImageState(chatId,options)
      if(selected!==null)return selected
    }
    const cached=readCache.get(chatId)
    if(!cached||cached.stamp!==await version(chatId)){
      const selected=await native.readSceneImageState(chatId, options)
      if(selected!==null)return selected
    }
    const state = await cachedState(chatId)
    return state ? projectSceneImageState(state.chat) : undefined
  }
  async function readBackgroundConfig(chatId) {
    const cached=readCache.get(chatId)
    if(!cached||cached.stamp!==await version(chatId)){
      const selected=await native.readSlice(chatId,[],['id','sessionId','mode','backgroundConfigVersion','conversationFeaturesVersion',
      'modModels','backgroundModelSelection','backgroundModelRevision','backgroundTasks','worldbookStrategy','webSearchEnabled','disabledForegroundTools','cardContextRevision','timeline.participants.background.status','mvu.enabled','mvu.owner'])
      if(selected!==null)return selected?projectChatBackgroundConfig(selected.chat):undefined
    }
    const state = await cachedState(chatId)
    return state ? projectChatBackgroundConfig(state.chat) : undefined
  }
  async function readDisplayRuntimeState(chatId, turn) {
    const selected = await native.readDisplayRuntimeState(chatId, turn)
    if (selected !== null) return selected
    const state = await cachedState(chatId)
    return state ? projectDisplayRuntimeState(state.chat, turn) : undefined
  }
  function slice(chat, indices, fields) {
    const {messages:rawMessages,...allHead}=chat
    const messages=Array.isArray(rawMessages)?rawMessages:[]
    if(indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=messages.length))throw new Error('消息楼层不存在')
    // Settlement never reads historical rollback checkpoints. Keep them on disk
    // and in full reads, but do not copy them into each scoped transaction.
    let head = fields === 'settlement' && allHead.timeline
      ? {...allHead, timeline:{...allHead.timeline, checkpoints:[]}} : allHead
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
    return {chat:structuredClone({...head,messages:indices.map(i=>messages[i])}),messageCount:messages.length,denseMessages:Array.isArray(rawMessages) && (indexedMessages.info(rawMessages)?.complete ?? messages.every(m=>m && typeof m==='object' && !Array.isArray(m)))}
  }
  // A pinned native snapshot for readers with their own shape (the stage's turn views); null without one.
  const openSnapshot = (chatId, options) => native.openSnapshot(chatId, options)
  /** Detached metadata and selected native rows, never an editable full-chat snapshot. */
  async function readSlice(chatId, indices=[], fields) {
    // A cached state at the current stamp answers directly. Otherwise read the selected rows:
    // re-checking the stamp in cachedState would load the whole Chat whenever a write lands
    // between the two checks.
    const stamp=await version(chatId),cached=readCache.get(chatId)
    const fresh=stamp&&cached?.stamp===stamp
    if(!fresh){
      const selected=await native.readSlice(chatId,indices,fields)
      if(selected!==null)return selected
    }
    const state=fresh?cached.state:await cachedState(chatId)
    return state && !indices.some(i=>i>=(state.chat.messages?.length||0)) ? slice(state.chat,indices,fields) : undefined
  }
  // Trusted settlement input: immutable revision-bound index, detached header,
  // and lazily detached rows. No writable storage-cache object escapes.
  async function readSettlementBase(chatId) {
    const selected = await native.readSettlementBase(chatId)
    if (selected !== null) return selected
    const state = await cachedState(chatId)
    if (!state || !Array.isArray(state.chat.messages)) return undefined
    const source = indexedMessages.from(state.chat.messages)
    if (!indexedMessages.info(source).complete) return undefined
    const header = slice(state.chat, [], 'settlement')
    const detached = new Map()
    const messages = createScopedMessages(source.length, [], id => {
      if (!detached.has(id)) detached.set(id, copyJsonTree(source[id]))
      return detached.get(id)
    })
    return {...header, chat:{...header.chat,messages}, previousMvu: id => indexedMessages.previous(source,id)}
  }
  function rememberChanges(previous, revision, changes) {
    const indices = new Set()
    let tail = Infinity
    let layoutChanged = false, layoutFrom = Infinity
    let headerFields = new Set(), runtimeInputKeys = new Set()
    for (const change of changes) {
      if (!change.path.length) { tail = 0; layoutChanged = true; layoutFrom = 0; headerFields = null; runtimeInputKeys = null; break }
      if (change.path[0] !== 'messages') {
        headerFields.add(String(change.path[0]))
        if(change.path[0]==='runtimeInputs' && runtimeInputKeys){
          if(change.path.length<2)runtimeInputKeys=null
          else runtimeInputKeys.add(String(change.path[1]))
        }
        continue
      }
      if (change.path.length <= 2 || ['turn','role','greeting','tavernRole','importSource'].includes(change.path[2])) {
        layoutChanged = true
        const start = Number.isSafeInteger(change.path[1]) ? change.path[1] : change.op === 'splice' ? change.index : 0
        layoutFrom = Math.min(layoutFrom, Number.isSafeInteger(start) && start >= 0 ? start : 0)
      }
      if (change.path.length > 1 && Number.isSafeInteger(change.path[1])) indices.add(change.path[1])
      else tail = Math.min(tail, change.op === 'splice' ? change.index : 0)
    }
    const frames = previous.concat({baseRevision: revision - 1, revision, indices: [...indices], tail, layoutChanged, layoutFrom, runtimeInputKeys:runtimeInputKeys && runtimeInputKeys.size<=4096 ? [...runtimeInputKeys] : null, headerFields:headerFields && headerFields.size<=4096 ? [...headerFields] : null})
    if (frames.length <= 32) return frames
    const [first, second, ...rest] = frames
    const mergedTail = Math.min(first.tail, second.tail)
    const mergedRuntimeKeys=first.runtimeInputKeys && second.runtimeInputKeys ? [...new Set([...first.runtimeInputKeys,...second.runtimeInputKeys])] : null
    const mergedHeaderFields = first.headerFields && second.headerFields ? [...new Set([...first.headerFields,...second.headerFields])] : null
    const mergedIndices = [...new Set([...first.indices, ...second.indices])].filter(index => index < mergedTail)
    // Keep a conservative older summary plus exact recent frames. Bound the
    // summary too; eviction loses coverage and safely restores the full fallback.
    if (mergedIndices.length > 4096) return frames.slice(-32)
    return [{baseRevision:first.baseRevision,revision:second.revision,indices:mergedIndices,tail:mergedTail,layoutChanged:first.layoutChanged || second.layoutChanged,layoutFrom:Math.min(first.layoutFrom ?? 0,second.layoutFrom ?? 0),runtimeInputKeys:mergedRuntimeKeys && mergedRuntimeKeys.length<=4096?mergedRuntimeKeys:null,headerFields:mergedHeaderFields && mergedHeaderFields.length<=4096 ? mergedHeaderFields : null},...rest]
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
  // Native change coverage lives with the full cache entry. A cache miss has
  // no delta to offer; reading the entire archive cannot recover that coverage.
  async function missingNativeCoverage(chatId) {
    const metadata = await native.readRevisionMetadata(chatId)
    if (!metadata) return null
    return readCache.get(chatId)?.stamp === metadata.stamp ? null : metadata
  }
  async function readChangedIndices(chatId, revision, options = {}) {
    const selected = await native.readChangedSlice(chatId, revision, undefined, true, options.limit)
    if (selected !== null) return selected
    const metadata = await missingNativeCoverage(chatId)
    if (metadata) return revision === metadata.revision ? {indices:[],baseRevision:revision,revision} : undefined
    return changedIndices(chatId, await cachedState(chatId), revision)
  }
  async function readChangedSlice(chatId, revision, fields) {
    const selected = await native.readChangedSlice(chatId, revision, fields)
    if (selected !== null) return selected
    if (await missingNativeCoverage(chatId)) return undefined
    const state = await cachedState(chatId)
    if (revision === state?.revision) return undefined
    const changed = changedIndices(chatId,state,revision)
    return changed ? {...slice(state.chat,changed.indices,fields),indices:changed.indices,baseRevision:revision,
      layoutFrom:Math.min(...knownChanges(chatId,state).filter(frame=>frame.revision>revision).map(frame=>frame.layoutFrom ?? 0)), layoutChanged:knownChanges(chatId,state).filter(frame=>frame.revision>revision).some(frame=>frame.layoutChanged !== false)} : undefined
  }
  /** Detached display input: unchanged Helper variables come from the cached view.
   * Never use this projection as a writable Chat or for a full Helper rebuild. */
  async function readViewDelta(chatId, revision) {
    if (await missingNativeCoverage(chatId)) return undefined
    const state = await cachedState(chatId)
    const changed = changedIndices(chatId, state, revision)
    if (!changed || revision === state.revision
      || Object.values(state.chat.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
      || !Array.isArray(state.chat.messages)
      || !(indexedMessages.info(state.chat.messages)?.complete ?? state.chat.messages.every(row=>row && typeof row==='object' && !Array.isArray(row)))) return undefined
    const dirty = new Set(changed.indices), detached = new Map()
    const source = state.chat.messages
    const messages = createScopedMessages(source.length,[],index=>{
      if (!detached.has(index)) {
        const row=source[index]
        if (dirty.has(index)) detached.set(index,copyJsonTree(row))
        else { const {variables,...display}=row; detached.set(index,copyJsonTree(display)) }
      }
      return detached.get(index)
    })
    const chat = copyLazyHistoryHeader({...state.chat,messages:[]})
    chat.messages = messages
    const headerFrames=knownChanges(chatId,state).filter(frame=>frame.revision>revision)
    const changedHeaderFields=headerFrames.every(frame=>Array.isArray(frame.headerFields)) ? [...new Set(headerFrames.flatMap(frame=>frame.headerFields))] : null
    const runtimeKeys=headerFrames.every(frame=>Array.isArray(frame.runtimeInputKeys)) ? [...new Set(headerFrames.flatMap(frame=>frame.runtimeInputKeys))] : null
    const runtime=state.chat.runtimeInputs
    const runtimeInputChanges=runtimeKeys?.map(key=>({key,present:runtime!=null && Object.hasOwn(runtime,key),value:runtime!=null && Object.hasOwn(runtime,key)?copyJsonTree(runtime[key]):undefined})) ?? null
    return { ...changed, changedHeaderFields, runtimeInputChanges, layoutFrom:Math.min(...knownChanges(chatId,state).filter(frame=>frame.revision>revision).map(frame=>frame.layoutFrom ?? 0)), layoutChanged:knownChanges(chatId,state).filter(frame=>frame.revision>revision).some(frame=>frame.layoutChanged !== false), chat }
  }

  function normalizePatch(chat,changes) {
      const normalized = []
      for (const change of changes) {
        if (change.op === 'set' && change.value === undefined) {
          if (!change.path.length) throw new Error('Journal root cannot be undefined')
          const current = applyIndexedChanges(chat, normalized)
          let parent = current
          for (const key of change.path.slice(0,-1)) parent = parent?.[key]
          if (!parent || typeof parent !== 'object') throw new Error('Missing mutation parent')
          const key = change.path.at(-1)
          if (Array.isArray(parent)) normalized.push({...change,value:null})
          else if (Object.hasOwn(parent,key)) normalized.push({op:'delete',path:change.path})
        } else normalized.push(jsonClone(change))
      }
      return normalized
  }

  /** Exact-version internal commit; stale callers must use their existing merge path. */
  async function patch(chatId, expectedRevision, changes, metadata={}) {
    return serialize(chatId,async()=>{
      if (!readCache.has(chatId) || Array.isArray(metadata.returnProjection)) {
        const cached=readCache.get(chatId)?.state
        const reusable=cached?.native && cached.revision===expectedRevision
        const normalized=reusable ? normalizePatch(cached.chat,changes) : changes
        const saved = await native.patch(chatId,expectedRevision,normalized,metadata.assertCurrent,metadata.returnProjection)
        if (saved !== null) {
          // A scoped native commit must not fall back to materializing the full
          // cached archive, nor replace that cache with a partial projection.
          if (saved && reusable) {
            const recent=knownChanges(chatId,cached)
            const chat=applyIndexedChanges(cached.chat,normalized)
            rememberState(chatId,'native:'+saved.native.view.snapshotCursor.snapshotId,{...saved,chat},rememberChanges(recent,saved.revision,normalized))
          } else if(saved) forgetState(chatId)
          if (saved && saved.revision !== expectedRevision) committed(chatId, saved.revision)
          return saved ? slice(saved.chat,[],metadata.returnProjection).chat : undefined
        }
      }
      const state=await cachedState(chatId)
      if(!state || state.revision!==expectedRevision)return undefined
      // An acknowledged no-op is not a story edit: keep undo points valid.
      // Check the exact revision and transaction guard under the same lock.
      if(changes.length===0){metadata.assertCurrent?.();return slice(state.chat,[],metadata.returnProjection).chat}
      const paths=layout(chatId)
      // Cache and disk must contain the same JSON. Canonicalize only changed
      // payloads, never copy the complete chat on this fast path.
      changes = normalizePatch(state.chat,changes)
      const next=applyIndexedChanges(state.chat,changes)
      if(next.id!==chatId || revisionOf(next)!==expectedRevision+1)throw new Error('Invalid journal patch revision')
      if(state.native){
        const recent=knownChanges(chatId,state)
        const saved=await native.write(chatId,state,next,changes,metadata.assertCurrent)
        rememberState(chatId,await version(chatId),saved,rememberChanges(recent,saved.revision,changes))
        committed(chatId,saved.revision)
        return slice(next,[],metadata.returnProjection).chat
      }
      if(state.compatible){
        const recent=knownChanges(chatId,state)
        const saved=await compatible.write(chatId,state,next,changes,metadata.assertCurrent)
        rememberState(chatId,await version(chatId),saved,rememberChanges(recent,saved.revision,changes))
        committed(chatId,saved.revision)
        return slice(next,[],metadata.returnProjection).chat
      }
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
        snapshot:rotated?.background ? state.snapshot : rotated || state.snapshot,open:rotated ? null : open,openFrameCount:rotated ? 0 : state.openFrameCount+1,openInvalidLine:0},
        rememberChanges(recentChanges, frame.revision, changes))
      committed(chatId,frame.revision)
      return slice(next,[],metadata.returnProjection).chat
    })
  }

  async function readRevision(chatId, revision) {
    const target = Number(revision)
    if (!Number.isSafeInteger(target) || target < 0) throw new Error('Chat storage revision 不合法: ' + String(revision))
    const state = await materialize(chatId, target)
    return state === null ? undefined : copyJsonTree(state.chat)
  }

  async function update(chatId, updater, metadata = {}) {
    if (typeof updater !== 'function') throw new Error('Chat Journal Store 缺少 updater')
    const site = options.wholeReadGuard?.site()
    return await serialize(chatId, async function () {
      const paths = layout(chatId)
      const currentState = await cachedState(paths.id)
      // The updater gets a copy of the whole Chat and the result is diffed against it.
      if (currentState?.native) reportWhole(chatId, currentState, site)
      const current = currentState == null ? undefined : currentState.chat
      const produced = await updater(copyJsonTree(current))
      if (produced === undefined) return copyJsonTree(current)
      // Normalize once before persistence. The already-JSON result can be
      // detached by copying its JSON containers without another full JSON string.
      if (isScopedMessages(produced?.messages)) throw new Error('局部读取的对话不能整档保存')
      const next = jsonClone(produced)
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) throw new Error('Chat Journal 只能保存 JSON object')
      if (currentState == null && options.newConversations === true && next.mode !== 'card') {
        const saved=await native.create(chatId,next,metadata.assertCurrent)
        rememberState(chatId,await version(chatId),saved)
        return copyJsonTree(next)
      }
      if (currentState == null) {
        await mkdir(paths.journals, { recursive: true })
        const revision = revisionOf(next)
        const snapshotPath = await writeSnapshot(paths, next, revision)
        rememberState(chatId, await version(chatId), { chat: next, revision, legacy: false,
          snapshot: { path: snapshotPath, name: path.basename(snapshotPath), revision },
          open: null, openFrameCount: 0, openValidBytes: 0, openInvalidLine: 0 })
        return copyJsonTree(next)
      }
      const baseRevision = currentState.revision
      const revision = revisionOf(next)
      if (revision !== baseRevision + 1) throw new Error('Chat Journal 写入 revision 非连续，期望 ' + (baseRevision + 1) + '，实际 ' + revision)
      const changes = diffJson(current, next)
      // A save that changes nothing but its own revision stamp and timestamp is no save:
      // nothing is written, the stored state and revision stay (as patch() does for no changes).
      if (changes.every(change => change.path.length === 1 && STAMPS.has(change.path[0]))) return copyJsonTree(current)
      if(currentState.native){
        const recent=knownChanges(chatId,currentState)
        const saved=await native.write(chatId,currentState,next,changes,metadata.assertCurrent)
        rememberState(chatId,await version(chatId),saved,rememberChanges(recent,saved.revision,changes))
        committed(chatId,saved.revision)
        return copyJsonTree(next)
      }
      if(currentState.compatible){
        const recent=knownChanges(chatId,currentState)
        const saved=await compatible.write(chatId,currentState,next,changes,metadata.assertCurrent)
        rememberState(chatId,await version(chatId),saved,rememberChanges(recent,saved.revision,changes))
        committed(chatId,saved.revision)
        return copyJsonTree(next)
      }
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
        snapshot: rotated?.background ? currentState.snapshot : rotated || currentState.snapshot, open: rotated ? null : open,
        openFrameCount: rotated ? 0 : currentState.openFrameCount + 1, openInvalidLine: 0 },
        rememberChanges(recentChanges, revision, changes))
      committed(chatId, revision)
      return copyJsonTree(next)
    })
  }

  async function version(chatId) {return await native.version(chatId) || await compatible?.version(chatId) || legacyVersion(chatId)}
  async function remove(chatId) {
    await flushMaintenance()
    await serialize(chatId, async function () {
      const paths = layout(chatId)
      forgetState(chatId)
      sessionMessages.forget(chatId)
      await compatible?.remove(chatId)
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
  // Only native saves have unreachable revisions to drop. The pass reads and lists
  // without the write queue; only its short publishing and deleting steps join it.
  async function compact(chatId, options) {
    return await native.compact(chatId, { ...options, exclusive: operation => serialize(chatId, operation) })
  }
  // Not serialized: it reads one pinned immutable head and takes the write lock
  // only in short relink steps, so play is never queued behind it.
  async function relayout(chatId, options) {
    return await native.relayout(chatId, options)
  }
  async function readRetentionHeader(chatId, revision) {
    try { return await native.readRetentionHeader(chatId, revision) }
    catch (error) { if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') return null; throw error }
  }
  // Pre-migration journal files of a native save. Callers decide whether any
  // retained revision still predates the migration before removing them.
  async function removeLegacyFiles(chatId) {
    return await serialize(chatId, async () => {
      const paths = layout(chatId)
      let bytes = 0
      for (const name of ['journals', 'snapshots']) {
        const target = path.join(paths.root, name)
        bytes += await directoryBytes(target)
        await rm(target, { recursive: true, force: true })
      }
      return { bytes }
    })
  }

  return Object.freeze({ compact, relayout, readRetentionHeader, removeLegacyFiles, detachedUpdate: true, upgradeStorage, migrateCompatibility, restoreLegacy, read, readWindow, readRecentSummaries, readHelperContext, readSessionState, readSceneImageState, readSettlementCheckpoint, readBackgroundConfig, readDisplayRuntimeState, flushMaintenance, prepareSnapshot, readSlice, readSettlementBase, readChangedSlice, readChangedIndices, readViewDelta, patch, readRevision, update, version, remove, openSnapshot })
}
