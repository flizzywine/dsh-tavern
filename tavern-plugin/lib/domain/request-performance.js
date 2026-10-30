import { AsyncLocalStorage } from 'node:async_hooks'
import { channel } from 'node:diagnostics_channel'
import { performance } from 'node:perf_hooks'

// Host log entries are truncated at 10 KiB. Keep each metadata record independently parseable.
export function coldReadLogRows(row) {
  const {stages, reads, waits, ...summary} = row
  const result = [summary]
  for (const [section, values] of Object.entries({stages, reads, waits})) {
    if (!values?.length) continue
    summary[section + 'Count'] = values.length
    for (let offset = 0; offset < values.length; offset += 8) result.push({pid:row.pid, method:row.method,
      id:row.id, receivedAt:row.receivedAt, phase:'detail', section, offset, values:values.slice(offset, offset + 8)})
  }
  return result
}

// Only fixed metadata is retained; arguments, paths and response bodies never enter traces.
export function createRequestPerformance({ now = () => performance.now(), wall = Date.now, onColdRead = () => {} } = {}) {
  const context = new AsyncLocalStorage()
  const recent = [], slow = [], openings = []
  let active = 0
  // Requests whose reads are traced: the stage's first view, and the stage readers of one round.
  const coldMethods = new Set(['getStageDirection', 'getDialogueBubbles', 'getAssetPackPresentation', 'getStageMusicTracks', 'getStageBackgrounds', 'startup-history',
    'getStageItems', 'readStageModMedia', 'getStageModHistory', 'getStageTimerReaction', 'getStagePhoneThreads', 'getStagePhonePresentation'])
  // Past its first three, a request is logged when it is slow enough to matter for a spike.
  const slowLogMs = 250
  const firstReads = new Map(), reads = channel('dsh.asset.read'), chatReads = channel('dsh.chat.read'), modReads = channel('dsh.mod.read')
  let slowGates = 0, chatLoads = 0, registryScans = 0
  const serialized = new Map()
  const ordinalFor = (counts, key) => {
    if (!counts.has(key) && counts.size >= 64) return Infinity
    const ordinal = (counts.get(key) || 0) + 1
    counts.set(key, ordinal)
    return ordinal
  }
  const collect = event => {
    event = {endedAt: wall(), ...event}
    if (event.packIds) {
      const ids = [...new Set(event.packIds)]
      event = {...event, packIds:ids.slice(0, 8), packCount:ids.length}
    }
    if (event.name?.startsWith('mod.') && event.durationMs >= 10 && slowGates++ < 80) onColdRead({method:'mod-read',...event})
    if (event.name === 'pack.registry-scan' && registryScans++ < 10) onColdRead({method:'pack-scan',...event})
    if (event.name === 'pack.gate.hold' && event.durationMs >= 100 && slowGates++ < 30) onColdRead({method:'pack-gate', ...event})
    if (event.name === 'chat.materialize' && event.durationMs >= 100 && chatLoads++ < 40) onColdRead({method:'chat-load',...event})
    if (event.name === 'chat.write.hold' && event.durationMs >= 100 && chatLoads++ < 40) onColdRead({method:'chat-write',...event})
    const row = context.getStore()
    if (!row?.reads) return
    if (event.durationMs >= 10 && row.waits.length < 80 && /gate\.|recovery|materialize|join|registry|chat\.native\./.test(event.name)) {
      row.waits.push({name:event.name, atMs:Math.round(now() - row.startedMono - event.durationMs), durationMs:Math.round(event.durationMs), packIds:event.packIds})
    }
    const key = event.name + ':' + (event.packId || event.chatId || '') + (event.lane ? ':' + event.lane : '')
    let phase = row.reads.find(item => item.key === key)
    if (!phase && row.reads.length < 128) row.reads.push(phase = {key, count:0, durationMs:0, bytes:0})
    if (phase) {
      phase.count++; phase.durationMs += event.durationMs; phase.bytes += event.bytes || 0
      if (event.readMs !== undefined) {phase.readMs=(phase.readMs||0)+event.readMs;phase.decodeMs=(phase.decodeMs||0)+(event.decodeMs||0)}
      if (event.queueMs !== undefined) phase.queueMs=(phase.queueMs||0)+event.queueMs
    }
  }
  reads.subscribe(collect)
  chatReads.subscribe(collect)
  modReads.subscribe(collect)
  function append(rows, row, limit) { rows.push(row); if (rows.length > limit) rows.shift() }
  return {
    async run(method, id, operation) {
      if (!coldMethods.has(method) && !['getSession', 'syncSession', 'getCardOpenings', 'initializeOpeningTemplate', 'preparePlayStart', 'startChat', 'stage-director'].includes(method)) return operation()
      const start = now(), utilization = performance.eventLoopUtilization()
      const row = { startedMono: start, method, id: (/^(?:session-)?[a-f0-9-]{36}$/.test(id || '') || method === 'stage-director' && /^operation-[a-z0-9-]{1,140}$/.test(id || '')) ? id : '', receivedAt: wall(), active: ++active, stages: [] }
      if (coldMethods.has(method)) {
        row.reads = []
        row.waits = []
        row.ordinal = ordinalFor(firstReads, method + ':' + row.id)
        if (row.ordinal <= 3) onColdRead({method, id: row.id, phase:'begin', receivedAt:row.receivedAt, ordinal:row.ordinal})
      }
      let lastTick = now()
      row.eventLoopDelayMaxMs = 0
      const sample = () => {
        const tick = now()
        row.eventLoopDelayMaxMs = Math.max(row.eventLoopDelayMaxMs, Math.round(Math.max(0, tick - lastTick - 100)))
        lastTick = tick
      }
      const timer = setInterval(sample, 100)
      timer.unref()
      const mark = name => { if (row.stages.length < 120) row.stages.push({ name, durationMs: 0, atMs: Math.round(now() - start) }) }
      try { return await context.run(row, () => operation(mark)) }
      catch (error) { row.failed = true; throw error }
      finally {
        sample(); clearInterval(timer)
        active--
        row.durationMs = Math.round(now() - start)
        row.eventLoopUtilization = performance.eventLoopUtilization(utilization).utilization
        append(recent, row, 120)
        if (!['getSession', 'syncSession', 'stage-director'].includes(method)) append(openings, row, 60)
        if (row.durationMs >= 1000) append(slow, row, 60)
        if (coldMethods.has(method) && (row.ordinal <= 3 || row.durationMs >= slowLogMs)) onColdRead({...row, phase:'end', endedAt:wall()})
      }
    },
    async stage(name, operation) {
      const row = context.getStore(), start = now()
      try { return await operation() }
      finally { if (row && row.stages.length < 120) row.stages.push({ name, atMs: Math.round(start - row.startedMono), durationMs: Math.round(now() - start) }) }
    },
    serialize(method, id, value) {
      const start = now(), receivedAt = wall()
      const result = JSON.stringify(value)
      if (coldMethods.has(method) && ordinalFor(serialized, method + ':' + id) <= 3) {
        onColdRead({method, phase:'serialize', receivedAt, durationMs:now() - start, chars:result.length})
      }
      return result
    },
    state({ foregroundRunning, backgroundBusy, backgroundRole, viewRebuild, helperMessageCount }) {
      const row = context.getStore()
      if (row) {
        row.activity = { foregroundRunning: foregroundRunning === true, backgroundBusy: backgroundBusy === true,
          backgroundRole: ['candidate', 'settlement', 'worldbook-filter', 'style-reference', 'image', 'phone'].includes(backgroundRole) ? backgroundRole : '' }
        if (viewRebuild === 'window' || viewRebuild === 'full' || viewRebuild === 'dirty' || viewRebuild === 'cache') row.viewRebuild = viewRebuild
        if (Number.isSafeInteger(helperMessageCount) && helperMessageCount >= 0) row.helperMessageCount = helperMessageCount
      }
    },
    dispose() { reads.unsubscribe(collect); chatReads.unsubscribe(collect); modReads.unsubscribe(collect) },
    read() { return structuredClone({ recent, slow, openings }) }
  }
}
