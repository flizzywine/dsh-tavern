// disposable read-only index; journal revisions, never record claims, authorize reuse.
import { createHash } from 'node:crypto'
import { captureStageTarget, stageTargetPrefixBytes } from '../../../../lib/domain/stage-incremental.js'
import { readAssetPackRecord, ASSET_PACK_RECORD_FIELD } from './stage-asset-pack-director.js'
import { stageReadIdentityOnly } from '../../../../lib/domain/stage-read-projection.js'

// The performance fold resets at a record that starts without a performance or with one exiting
//: the chain a page needs starts at the last such record.
export const isPerformanceChainBoundary = record => !record.baseline?.performance || record.baseline.performance.phase === 'exit'
const historyRecordChanged = () => Object.assign(new Error('Stage record changed while reading history'), {code:'REVISION_CONFLICT'})
// An identity row is never handed out as a record: whoever needs it loads it first (load), so a missing `end` or
// `entries` cannot pass for an empty stage.
const full = row => {
  if (row.thin) throw Object.assign(new Error('Stage history row carries only its record identity; load it first'), {code:'STAGE_HISTORY_UNLOADED'})
  return row.checked
}

// Rows carry an accepted record in full when the read chat has it, or only its identity when a chain-only
// turn view does (stageReadChainFields; 256 bytes a row). Full records an identity row needs are read by
// index through readRecords(chat, indices) after the chain is known.
export function createStageHistoryCache({ readChanges, readRecords, maxEntries = 4, maxBytes = 32 * 1024 * 1024, onRead = () => {}, onTarget = () => {} } = {}) {
  const cache = new Map(), pending = new Map()
  let bytes = 0
  function fill(value, index, raw) {
    const row = value.rows[index], checked = readAssetPackRecord(raw, {shared:true})
    if (checked.digest !== row.checked.digest) throw historyRecordChanged()
    const recordBytes = JSON.stringify(checked).length * 2
    Object.assign(row, {checked, thin:false, recordBytes})
    value.size += recordBytes
    if (cache.get(value.id) !== value) return
    bytes += recordBytes
    for (const id of [...cache.keys()]) if (bytes > maxBytes && id !== value.id) { bytes -= cache.get(id).size; cache.delete(id) }
    if (bytes > maxBytes) { bytes -= value.size; cache.delete(value.id) }
  }
  // A cached index built from a chain-only view serves a later chat at the same revision that carries more records.
  function complete(value, chat, count) {
    for (let i = 0; i < Math.min(count, value.rows.length); i++) {
      const raw = chat.messages[i]?.[ASSET_PACK_RECORD_FIELD]
      if (value.rows[i].thin && value.rows[i].accepted && raw && !stageReadIdentityOnly(chat, i)) fill(value, i, raw)
    }
    return value
  }
  async function build(chat, previous, count) {
    const revision = chat._storageRevision, messages = chat.messages
    let changes
    if (previous && previous.sessionId === chat.sessionId) {
      if (previous.revision === revision) changes = {baseRevision:revision,revision,indices:[]}
      else if (previous.revision < revision) changes = await readChanges?.(chat.id, previous.revision)
    }
    const compatible = changes?.baseRevision === previous?.revision && changes?.revision === revision && Array.isArray(changes?.indices)
    const dirty = compatible ? new Set(changes.indices) : null
    const start = compatible ? Math.min(previous.rows.length, count, ...changes.indices) : 0
    const rows = compatible ? previous.rows.slice(0, start) : []
    let prefix = start ? rows[start - 1].prefix.copy() : createHash('sha256').update('[')
    let last = start ? rows[start - 1].last : -1, chain = start ? rows[start - 1].chain : -1
    for (let i = start; i < count; i++) {
      const message = messages[i], raw = message?.[ASSET_PACK_RECORD_FIELD], reuse = compatible && !dirty.has(i) ? previous.rows[i] : null
      let checked = null, target = null, accepted = false, recordBytes = 0, identity = false
      if (raw) {
        const identityOnly = stageReadIdentityOnly(chat, i)
        if (reuse?.checked && (!reuse.thin || identityOnly)) ({checked, recordBytes, thin:identity} = reuse)
        else if (identityOnly) { checked = raw; identity = true }
        else {
          onRead(i)
          checked = readAssetPackRecord(raw, {shared:true})
          recordBytes = JSON.stringify(checked).length * 2
        }
        onTarget(i)
        target = captureStageTarget(chat, i, prefix.copy().update(']').digest('hex'))
        if (checked.binding.target.sourceKey === target.sourceKey && checked.binding.target.predecessorDigest === (last >= 0 ? rows[last].checked.digest : null)) {
          accepted = true
          if (last < 0 || isPerformanceChainBoundary(checked)) chain = i
          last = i
        }
      }
      if (i) prefix.update(',')
      prefix.update(stageTargetPrefixBytes(message))
      rows.push({checked, thin:identity, accepted, last, chain, target, prefix:prefix.copy(), recordBytes})
    }
    const value = {id:chat.id, revision, sessionId:chat.sessionId, rows, size:rows.reduce((sum, row) => sum + 256 + row.recordBytes, 0), target(index, currentChat) {
      // a read target uses the already indexed prefix, never scans history again.
      const row = rows[index]
      if (!row) return captureStageTarget(currentChat,index)
      if (!row.target) {
        onTarget(index)
        const prefix = index ? rows[index - 1].prefix.copy() : createHash('sha256').update('[')
        row.target = captureStageTarget(currentChat,index,prefix.update(']').digest('hex'))
      }
      return {...row.target,branchId:currentChat.timeline.branchId,revision:currentChat.timeline.revision}
    }, at(index) {
      // current/previous through index; records is the accepted chain from its last performance boundary.
      const end = Math.min(rows.length, Math.max(0, index + 1)), row = rows[end - 1]
      return {accepted:index < rows.length && !!row?.accepted,
        get current() { return index < rows.length && row?.accepted ? full(row) : null },
        get previous() { return row && row.last >= 0 ? full(rows[row.last]) : null },
        get records() { return row && row.chain >= 0 ? rows.slice(row.chain, end).flatMap(item => item.accepted ? [full(item)] : []) : [] }}
    }, identity(index) {
      // The accepted record at this index as far as its identity goes (digest and binding target, loaded or not), or null.
      return rows[index]?.accepted ? rows[index].checked : null
    }, async load(currentChat, index, {chain = false} = {}) {
      // The last accepted record through this index (the round's own record, or the predecessor whose end an
      // undirected round shows), or the whole bounded chain.
      const end = Math.min(rows.length, Math.max(0, index + 1)), row = rows[end - 1]
      const wanted = !row || row.last < 0 ? [] : chain ? rows.slice(row.chain, end).flatMap((item, i) => item.accepted && item.thin ? [row.chain + i] : []) : rows[row.last].thin ? [row.last] : []
      const wantedRows = wanted.map(i => rows[i])
      if (wanted.length) {
        const records = await readRecords(currentChat, wanted)
        wanted.forEach((position, i) => { if (wantedRows[i].thin) { if (!records[i]) throw historyRecordChanged(); fill(value, position, records[i]) } })
      }
      return value.at(index)
    }}
    const latest = cache.get(chat.id)
    if (Number.isSafeInteger(revision) && value.size <= maxBytes && maxEntries > 0 && !(latest?.revision > revision || latest?.revision === revision && latest.rows.length > rows.length)) {
      if (cache.has(chat.id)) { bytes -= cache.get(chat.id).size; cache.delete(chat.id) }
      while (cache.size && (bytes + value.size > maxBytes || cache.size >= maxEntries)) {
        const id = cache.keys().next().value; bytes -= cache.get(id).size; cache.delete(id)
      }
      cache.set(chat.id, value); bytes += value.size
    }
    return value
  }
  return {
    async read(chat, through = chat.messages.length - 1) {
      // Do not validate future records while reading an earlier, still-valid historical turn.
      const count = Math.min(chat.messages.length, Math.max(0, through + 1))
      const previous = cache.get(chat.id), revision = chat._storageRevision
      if (Number.isSafeInteger(revision) && previous?.revision === revision && previous.sessionId === chat.sessionId && previous.rows.length >= count) return complete(previous, chat, count)
      if (!Number.isSafeInteger(revision)) return build(chat,undefined,count)
      const key = JSON.stringify([chat.id, chat.sessionId, revision, count])
      if (pending.has(key)) return complete(await pending.get(key), chat, count)
      const load = build(chat, previous,count)
      pending.set(key, load)
      try { return await load } finally { pending.delete(key) }
    },
    clear() { cache.clear(); bytes = 0 },
  }
}
