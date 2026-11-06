// read-only stage consumers share immutable journal snapshots, never editable drafts.
import {freezeJson} from './freeze-json.js'
import {stageReadScope, markStageRead, stageReadOpsFields, stageRecordRounds} from './stage-read-projection.js'
import {projectTavernHelperContext} from './tavern-helper-context.js'

const turnOf = row => Number(row.turn || (row.greeting ? 1 : 0))
const asksLatest = options => !options.configOnly && !options.stateOnly && !options.sourceOnly && !options.rounds && !Number(options.turn)

// Least recently used goes first: a hit moves its entry to the end. One history page keeps about five keys (its turn
// view, state, config, source and the latest view), so the byte budget, not the entry count, decides how many rounds of
// paging stay warm (a 117-floor archive's turn view is ~19 MiB, so three rounds plus the small views fit).
// A chain-only view naming earlier `rounds` is that view plus those floors, read by readFloors(chatId, indices,
// {revision}) at the view's revision: the earlier floors it already read are shared, never read again.
export function createStageChatCache({readHeader, readChat, readChanges, readView, readFloors, trace, maxEntries = 12, maxBytes = 96 * 1024 * 1024, projectHelper = projectTavernHelperContext}) {
  const phase = (name, operation) => trace ? trace.stage(name,operation) : operation()
  const cache = new Map(), pending = new Map()
  // A complete read over the budget is measured once per chat revision; later reads of that revision skip the accounting.
  const oversized = new Map()
  // The latest turn view lives under its explicit turn key: a latest read and the live round's turn read share it.
  const latest = new Map()
  // The accounted size of each cached projection, so a view derived from it is accounted without measuring it again.
  const projected = new WeakMap()
  // Earlier rounds' beat ops (or their read in flight) by chat and record digest: a record never changes under its digest.
  const beats = new Map(), maxBeats = 1024
  // Earlier floors read in full (or in flight) by chat, revision and index: views naming different rounds share them.
  const floorRows = new Map(), maxFloorRows = 64
  let bytes = 0
  const measure = value => JSON.stringify(value).length * 2
  const hit = key => {
    const entry = cache.get(key)
    if (entry) {cache.delete(key); cache.set(key, entry)}
    return entry
  }
  const evict = (incoming, slot) => {
    while (cache.size && (bytes + incoming > maxBytes || cache.size + slot > maxEntries)) {
      const [key, entry] = cache.entries().next().value; bytes -= entry.size; cache.delete(key)
    }
  }
  const admit = (key, entry) => {
    if (cache.has(key)) {bytes -= cache.get(key).size; cache.delete(key)}
    evict(entry.size, 1)
    cache.set(key, entry); bytes += entry.size
  }
  async function load(sessionId, header, previous) {
    let chat, sizes, helper
    if (previous && previous.chat.sessionId === header.sessionId && previous.chat._storageRevision < header._storageRevision) {
      const changed = await readChanges(header.id, previous.chat._storageRevision)
      if (changed?.baseRevision === previous.chat._storageRevision && changed.chat?._storageRevision === header._storageRevision
        && changed.denseMessages && Array.isArray(changed.indices) && changed.indices.length === changed.chat.messages.length) {
        const messages = previous.chat.messages.slice(0, changed.messageCount)
        sizes = previous.sizes.slice(0, changed.messageCount)
        changed.indices.forEach((id, ordinal) => { messages[id] = changed.chat.messages[ordinal]; sizes[id] = measure(messages[id]) })
        chat = {...changed.chat, messages}
        // Only an unchanged prefix can retain its Helper projection. Edits and
        // truncation rebuild; pending template input never enters this base.
        if (changed.messageCount >= previous.chat.messages.length
          && (chat.tavernHelperLifecycleRevision || 0) === (previous.chat.tavernHelperLifecycleRevision || 0)
          && changed.indices.every(id => id >= previous.chat.messages.length)) helper = previous.helper
      }
    }
    chat ||= await phase('stageChat.materialize', () => readChat(sessionId))
    if (!chat) return chat
    const identity = Number.isSafeInteger(chat._storageRevision) ? JSON.stringify([chat.sessionId, chat._storageRevision]) : null
    if (identity && oversized.get(chat.id) === identity) return phase('stageChat.freeze', () => freezeJson(chat))
    const size = await phase('stageChat.accounting', () => {
      sizes ||= chat.messages.map(measure)
      const {messages, ...head} = chat
      return measure(head) + sizes.reduce((total, size) => total + size, 0) + (helper?.size || 0)
    })
    chat = await phase('stageChat.freeze', () => freezeJson(chat))
    if (identity && size > maxBytes) oversized.set(chat.id, identity)
    else if (identity && maxEntries > 0 && !(cache.get(chat.id)?.chat._storageRevision > chat._storageRevision)) admit(chat.id, {chat,sizes,size,helper})
    return chat
  }
  const read = async sessionId => {
    const header = await phase('stageChat.header', () => readHeader(sessionId))
    if (!header) return undefined
    const previous = cache.get(header.id), revision = header._storageRevision
    if (Number.isSafeInteger(revision) && previous?.chat._storageRevision === revision && previous.chat.sessionId === header.sessionId) return hit(header.id).chat
    if (!Number.isSafeInteger(revision)) return load(sessionId,header)
    const key = JSON.stringify([header.id,header.sessionId,revision])
    let loading = pending.get(key)
    if (!loading) {loading = load(sessionId,header,previous); pending.set(key,loading)}
    try {return await loading} finally {if (pending.get(key) === loading) pending.delete(key)}
  }
  read.view = async (sessionId, options = {}) => {
    if (!readView) return read(sessionId)
    const header = await phase('stageChat.header', () => readHeader(sessionId))
    return header ? viewAt(header, options) : undefined
  }
  // The view of `options` at the header just read: a view derived from another reads the header once.
  async function viewAt(header, options) {
    const full = cache.get(header.id)
    if (full && full.chat._storageRevision === header._storageRevision && full.chat.sessionId === header.sessionId) return hit(header.id).chat
    const identity = [header.id, header.sessionId, header._storageRevision], stamp = JSON.stringify(identity)
    // A chain-only view and a complete one never stand in for each other.
    const variant = header.id + (options.chainOnly ? ':chain' : '')
    const alias = asksLatest(options) ? latest.get(variant) : undefined
    const key = alias?.stamp === stamp ? alias.key : JSON.stringify([...identity, options])
    const cached = hit(key)
    if (cached) return cached.chat
    if (pending.has(key)) return pending.get(key)
    const loading = phase('stageChat.projection', async () => {
      if (options.rounds) return withRounds(header, options, key)
      const chat = await readView(header.id, options)
      if (!chat) return chat
      const size = measure(chat)
      freezeJson(chat)
      let entryKey = key
      const scope = asksLatest({...options, turn:0}) && stageReadScope(chat)
      if (scope && scope.turn === Math.max(0, ...chat.messages.filter(row => row.role === 'assistant').map(turnOf))) {
        entryKey = JSON.stringify([...identity, {...options, turn:scope.turn}])
        latest.set(variant, {stamp, key:entryKey})
      }
      projected.set(chat, size)
      if (size <= maxBytes && maxEntries > 0) admit(entryKey, {chat,size})
      return chat
    })
    pending.set(key,loading)
    try { return await loading } finally { pending.delete(key) }
  }
  // Of the latest `count` rounds through the turn view of `options`, the earlier ones' record digest, bound source views
  // and beat ops (stageReadOpsFields) by turn, and view(rounds) at the same header (null without the chat): a consumer
  // looking for its marks reads in full only the rounds that carry them.
  read.ops = async (sessionId, options, count) => {
    const header = await phase('stageChat.header', () => readHeader(sessionId))
    const base = header && await viewAt(header, options), scope = base && stageReadScope(base)
    if (!base) return null
    const turn = Number(options.turn) || scope?.turn, rounds = stageRecordRounds(base, turn, count).filter(number => number !== turn)
    const floors = base.messages.flatMap((row, i) => row.role === 'assistant' && row.stageDirectionAssetPacks && rounds.includes(turnOf(row)) ? [i] : [])
    const keyOf = i => JSON.stringify([base.id, base.messages[i].stageDirectionAssetPacks.digest])
    // A floor this view carries in full answers itself.
    const missing = floors.filter(i => scope?.chainOnly && i !== scope.index && !scope.full.includes(i) && !beats.has(keyOf(i)))
    if (missing.length) {
      const rows = readFloors(base.id, missing, {revision:base._storageRevision, fields:stageReadOpsFields})
      missing.forEach((i, ordinal) => {
        const key = keyOf(i), record = rows.then(values => values && freezeJson(values[ordinal].stageDirectionAssetPacks))
        record.catch(() => { if (beats.get(key) === record) beats.delete(key) })
        beats.set(key, record)
        if (beats.size > maxBeats) beats.delete(beats.keys().next().value)
      })
    }
    const records = await Promise.all(floors.map(i => beats.get(keyOf(i)) ?? (base.messages[i].stageDirectionAssetPacks.entries ? base.messages[i].stageDirectionAssetPacks : null)))
    return {records:new Map(floors.flatMap((i, ordinal) => records[ordinal] ? [[turnOf(base.messages[i]), records[ordinal]]] : [])),
      view:named => viewAt(header, named.length ? {...options, rounds:named} : options)}
  }
  async function withRounds(header, {rounds, ...options}, key) {
    const base = await viewAt(header, options), scope = base && stageReadScope(base)
    // A complete chat already carries every round.
    if (!scope?.chainOnly) return base
    const indices = base.messages.flatMap((row, i) => i < scope.index && row.role === 'assistant' && rounds.includes(turnOf(row)) ? [i] : [])
    const keyOf = i => JSON.stringify([base.id, base._storageRevision, i]), missing = indices.filter(i => !floorRows.has(keyOf(i)))
    const reading = new Map()
    if (missing.length) {
      const read = readFloors(base.id, missing, {revision:base._storageRevision})
      missing.forEach((i, ordinal) => {
        const key = keyOf(i), row = read.then(values => values && freezeJson(values[ordinal]))
        row.catch(() => { if (floorRows.get(key) === row) floorRows.delete(key) })
        reading.set(i, row)
        floorRows.set(key, row)
        if (floorRows.size > maxFloorRows) floorRows.delete(floorRows.keys().next().value)
      })
    }
    const rows = await Promise.all(indices.map(i => reading.get(i) ?? floorRows.get(keyOf(i))))
    if (rows.some(row => !row)) return undefined
    const messages = base.messages.slice()
    indices.forEach((index, i) => { messages[index] = {...base.messages[index], ...rows[i]} })
    const chat = markStageRead(freezeJson({...base, messages}), {...scope, full:indices})
    const size = (projected.get(base) ?? measure(base)) + measure(rows)
    projected.set(chat, size)
    if (size <= maxBytes && maxEntries > 0) admit(key, {chat,size})
    return chat
  }
  read.template = async sessionId => {
    const chat = await read(sessionId)
    if (!chat) return undefined
    const entry = cache.get(chat.id), previous = entry?.chat === chat ? entry.helper : null
    if (previous?.revision === chat._storageRevision) return {chat, helper:previous.context}
    const context = projectHelper(chat, {
      indexed:true, previousContext:previous?.context, previousMessages:previous?.context.messages,
      dirtyIndices:previous ? new Set() : null, layoutFrom:previous?.context.messages.length,
      layoutChanged:previous?.context.messages.length !== chat.messages.length,
    })
    if (entry?.chat === chat) {
      const {messages, ...header} = context
      const sizes = messages.map((row, id) => row === previous?.context.messages[id] ? previous.sizes[id] : measure(row))
      const size = measure(header) + sizes.reduce((sum, value) => sum + value, 0)
      bytes -= entry.helper?.size || 0; entry.size -= entry.helper?.size || 0
      entry.helper = {context, sizes, size, revision:chat._storageRevision}
      bytes += size; entry.size += size
      evict(0, 0)
    }
    return {chat, helper:context}
  }
  return read
}
