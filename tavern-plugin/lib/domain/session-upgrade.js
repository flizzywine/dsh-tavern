// DSH 0.2.1 upgrade: old generations remain immutable. Only a fully validated
// current generation is published, atomically and without replacing newer play.
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { link, open, readdir, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { encodeCurrentGeneration, parseSessionLog } from './session-log-codec.js'

import { SESSION_UPGRADE_EVENT } from './session-upgrade-references.js'

const generationName = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export function restoreSessionLog(parsed, catalog, validation = 'current') {
  const restore = catalog.createRestore(parsed.header, { recovery: 'strict', validation })
  for (const row of parsed.events) restore.decodeRow(structuredClone(row))
  return restore.finish()
}

function historicalLog(parsed, catalog) {
  // An older Tavern writer omitted the physical header tag. Only the unseeded
  // case has an unambiguous cut; never guess a branch's inherited boundary.
  if (parsed.header.version === 3 && parsed.header.type === undefined) {
    if (parsed.header.isSeeded) throw new Error('旧分支缺少继承边界，无法安全推断')
    parsed = { ...parsed, header: catalog.encodeCurrentHeader(parsed.header, 0) }
  }
  // Decode v3 physical rows first; known opening chronology is normalized before
  // the final v4 strict validator. No recovery or event dropping is enabled.
  return restoreSessionLog(parsed, catalog, parsed.header.version === 3 ? 'transformed' : 'current')
}

function remapReferences(event, mapping) {
  const copy = structuredClone(event)
  const ref = value => {
    if (!Number.isInteger(value) || (event.seq >= 0 && value >= event.seq) || mapping[value] === undefined) throw new Error('旧档含无效的消息引用')
    if (mapping[value] >= mapping[event.seq]) throw new Error('开场调整会产生向后的消息引用')
    return mapping[value]
  }
  copy.seq = mapping[event.seq]
  if (copy.sourceEventSeqs) copy.sourceEventSeqs = copy.sourceEventSeqs.map(ref)
  if (copy.surfaceOp?.op === 'replace') {
    copy.surfaceOp.startSeq = ref(copy.surfaceOp.startSeq)
    copy.surfaceOp.endSeq = ref(copy.surfaceOp.endSeq)
  }
  const data = copy.data
  if (data?.tavernRestoredCallSeq !== undefined) data.tavernRestoredCallSeq = ref(data.tavernRestoredCallSeq)
  if (Array.isArray(data?.tavernRestoredSurfaceSeqs)) data.tavernRestoredSurfaceSeqs = data.tavernRestoredSurfaceSeqs.map(ref)
  if (copy.type === 'command/done' && data.sourceEventSeq !== undefined) data.sourceEventSeq = ref(data.sourceEventSeq)
  if (copy.type === 'developer/message' && data.headerSeq !== undefined) data.headerSeq = ref(data.headerSeq)
  if (['session/title', 'session/title-llm-request'].includes(copy.type)) data.messageSeqs = data.messageSeqs.map(ref)
  if (['compaction/summary', 'compaction/prune'].includes(copy.type)) {
    data.shadowedRange.start = ref(data.shadowedRange.start)
    data.shadowedRange.end = ref(data.shadowedRange.end)
    data.shadowedSeqs = data.shadowedSeqs.map(ref)
  }
  if (copy.type === 'image/offload') data.targets = data.targets.map(target => ({ ...target, seq: ref(target.seq) }))
  return copy
}

// Old Session accepted a reserved system prefix before turn/start. V4 requires
// it inside the same turn/step. Move only those existing boundary events; never
// renumber turns (Tavern's journal and variable snapshots refer to them).
export function normalizeHistoricalOpening(artifact) {
  const events = structuredClone(artifact.events)
  const firstSurface = events.findIndex(event => event.surfaceOp !== undefined)
  const firstSystem = events.findIndex(event => event.type === 'system/message')
  const system = events[firstSystem]
  if (firstSurface < 0) return artifact
  let turn = events.find(event => event.type === 'turn/start' && event.data.turn === 1)
  let step = events.find(event => event.type === 'step/start' && event.data.turn === 1 && event.data.step === 1)
  const originalTurnSeq = turn?.seq ?? Infinity
  let moved = false
  if (!turn && !step && system?.data.turn === 1 && system.data.step === 1 && !artifact.header.isSeeded && !events.some(event => event.type === 'turn/start')) {
    // A save made before the first generation can contain just its reserved prompt.
    turn = { seq: -2, time: system.time, type: 'turn/start', data: { turn: 1 } }
    step = { seq: -3, time: system.time, type: 'step/start', data: { turn: 1, step: 1 } }
    events.splice(firstSurface, 0, turn, step)
    events.push({ seq: -4, time: events.at(-1).time, type: 'step/end', data: { turn: 1, step: 1 } })
    events.push({ seq: -5, time: events.at(-1).time, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    moved = true
  }
  if (!turn || !step) return artifact
  // Very early Tavern reserved opening prose as turn 0, before the first actual
  // Agent turn. Its identity/content stay intact; v4 coordinates start at 1.
  for (const event of events) {
    if (event.seq >= 0 && event.seq < originalTurnSeq && event.type === 'assistant/message' && event.data.turn === 0 && event.data.step === 1) {
      event.data.turn = 1
      moved = true
    }
  }
  for (const boundary of [turn, step]) {
    const before = events.findIndex(event => event.seq === artifact.events[firstSurface].seq)
    if (events.indexOf(boundary) > before) {
      events.splice(events.indexOf(boundary), 1)
      events.splice(before, 0, boundary)
      moved = true
    }
  }
  // A prompt installed after a user prefix needs a protected system head. Insert
  // an empty head, then let the original system event replace it at its old time.
  let head
  if (system && firstSurface < firstSystem && system.surfaceOp === 'append') {
    const before = events.findIndex(event => event.seq === artifact.events[firstSurface].seq)
    head = { ...structuredClone(system), seq: -1, data: { ...structuredClone(system.data), turn: 1, step: 1, message: { ...structuredClone(system.data.message), id: 'tavern-upgrade-system-head', content: [] } } }
    events.splice(before, 0, head)
    moved = true
  }
  if (!moved) return artifact
  const mapping = []
  events.forEach((event, seq) => { mapping[event.seq] = seq })
  const inheritedEventCount = artifact.header.isSeeded ? mapping[artifact.inheritedEventCount] : 0
  if (inheritedEventCount === undefined) throw new Error('无法保留分支继承边界')
  // Moving across an inherited seed boundary changes branch ownership.
  for (const event of artifact.events) {
    if ((event.seq < artifact.inheritedEventCount) !== (mapping[event.seq] < inheritedEventCount)) throw new Error('开场调整会跨越分支继承边界')
  }
  const remapped = events.map((event, seq) => event.seq < 0 && event.type !== 'tool/call' ? { ...event, seq } : remapReferences(event, mapping))
  if (head) {
    const replacement = remapped[mapping[system.seq]]
    replacement.surfaceOp = { op: 'replace', startSeq: mapping[-1], endSeq: mapping[-1] }
    replacement.sourceEventSeqs = [...new Set([...(replacement.sourceEventSeqs || []), mapping[-1]])]
  }
  return { ...artifact, inheritedEventCount, events: remapped, upgradeOrigins: events.map(event => event.seq < 0 ? null : (artifact.upgradeOrigins ? artifact.upgradeOrigins[event.seq] : event.seq)) }
}

// A late system prompt was an ordinary surface node in the old host and could
// be summarized. V4 reserves a permanent head. Retire that head immediately
// before the old turn closes, with no intervening model request, then compact
// the same non-system span. Keep all original rows in the upgrade audit record.
function normalizeHistoricalCompaction(artifact) {
  const events = structuredClone(artifact.events), surface = []
  const firstSystem = events.find(event => event.type === 'system/message')
  if (!firstSystem || events.find(event => event.surfaceOp)?.seq === firstSystem.seq) return artifact
  let synthetic = -1, changed = false
  for (const event of artifact.events) {
    if (event.type === 'compaction/summary' && event.data.shadowedSeqs.includes(firstSystem.seq)) {
      const { start, end } = event.data.shadowedRange
      const a = surface.indexOf(start), b = surface.indexOf(end)
      if (a < 0 || b < a || !isDeepStrictEqual(surface.slice(a, b + 1), event.data.shadowedSeqs)) throw new Error('旧压缩范围本身不完整，无法无损修复')
      const remaining = event.data.shadowedSeqs.filter(seq => seq !== firstSystem.seq)
      const checkpoint = artifact.events[event.seq + 1]
      const source = checkpoint?.data?.source
      if (!remaining.length || checkpoint?.type !== 'user/message' || source?.plugin !== 'compact'
        || source.compactionId !== event.data.compactionId || checkpoint.surfaceOp?.startSeq !== start || checkpoint.surfaceOp.endSeq !== end) throw new Error('旧压缩缺少完整的摘要替换记录')
      const closing = artifact.events.slice(0, event.seq).findLast(row => row.type === 'step/end')
      if (!closing || closing.seq < firstSystem.seq || (closing.seq < artifact.inheritedEventCount) !== (event.seq < artifact.inheritedEventCount) || artifact.events.slice(closing.seq + 1, event.seq).some(row => ['step/start', 'request/header', 'request/context', 'system/message'].includes(row.type))) throw new Error('无法安全关闭旧压缩中的系统提示词')
      const empty = { ...structuredClone(firstSystem), seq: synthetic--, time: closing.time,
        data: { ...structuredClone(firstSystem.data), turn: closing.data.turn, step: closing.data.step,
          message: { ...structuredClone(firstSystem.data.message), id: 'tavern-upgrade-compacted-head-' + event.seq, content: [] } },
        surfaceOp: { op: 'replace', startSeq: firstSystem.seq, endSeq: firstSystem.seq }, sourceEventSeqs: [firstSystem.seq] }
      events.splice(events.findIndex(row => row.seq === closing.seq), 0, empty)
      const summary = events.find(row => row.seq === event.seq)
      summary.data.shadowedSeqs = remaining
      summary.data.shadowedRange = { start: remaining[0], end: remaining.at(-1) }
      const replacement = events.find(row => row.seq === checkpoint.seq)
      replacement.surfaceOp = { op: 'replace', startSeq: remaining[0], endSeq: remaining.at(-1) }
      changed = true
    }
    if (event.surfaceOp === 'append') surface.push(event.seq)
    else if (event.surfaceOp?.op === 'replace') {
      const a = surface.indexOf(event.surfaceOp.startSeq), b = surface.indexOf(event.surfaceOp.endSeq)
      if (a < 0 || b < a) throw new Error('旧档上下文替换范围无效')
      surface.splice(a, b - a + 1, event.seq)
    }
  }
  if (!changed) return artifact
  const mapping = []
  events.forEach((event, seq) => { mapping[event.seq] = seq })
  const cut = artifact.header.isSeeded ? mapping[artifact.inheritedEventCount] : 0
  if (cut === undefined) throw new Error('无法保留压缩存档的分支边界')
  // Synthetic rows have earlier references; their numeric temporary IDs are not
  // chronological coordinates. remapReferences checks the mapped ordering.
  return { ...artifact, repairedHistory: true, inheritedEventCount: cut,
    events: events.map(event => remapReferences(event, mapping)),
    upgradeOrigins: events.map(event => event.seq < 0 ? null : event.seq) }
}

export function prepareSessionUpgrade(parsed, migration, children = []) {
  const historical = historicalLog(parsed, migration.historicalSessionFormatCatalog)
  const catalog = migration.createSessionFormatCatalogWithChildren(children)
  const convert = artifact => restoreSessionLog({
    header: migration.historicalSessionFormatCatalog.encodeCurrentHeader(artifact.header, artifact.inheritedEventCount),
    events: artifact.events.map(event => migration.historicalSessionFormatCatalog.encodeCurrentEvent(event)),
  }, catalog)
  let artifact
  let normalized = historical
  try { artifact = convert(historical) }
  catch (originalError) {
    normalized = normalizeHistoricalEdits(normalizeHistoricalOpening(normalizeHistoricalCompaction(historical)))
    if (normalized === historical) throw originalError
    artifact = convert(normalized)
  }
  artifact = retainUpgradeReferences(historical, normalized, artifact, parsed.header.version)
  // Validate the metadata-bearing artifact through the same installed reader.
  artifact = restoreSessionLog(parseSessionLog(encodeCurrentGeneration(artifact, catalog)), catalog)
  assertContentPreserved(historical, artifact)
  const bytes = encodeCurrentGeneration(artifact, catalog)
  const reopened = restoreSessionLog(parseSessionLog(bytes), catalog)
  if (!isDeepStrictEqual(reopened, artifact)) throw new Error('新版存档写入校验不一致')
  return { artifact, bytes }
}

function retainUpgradeReferences(original, normalized, target, sourceVersion) {
  const signature = event => JSON.stringify([event.type, event.time, event.data?.turn, event.data?.step,
    event.data?.message?.id ?? event.data?.id, event.type === 'turn/end' ? event.data.reason : undefined])
  const seqMap = [], storyTurns = [], targetPositions = []
  let cursor = 0
  for (const event of normalized.events) {
    while (cursor < target.events.length && signature(event) !== signature(target.events[cursor])) {
      if (target.events[cursor].type !== 'turn/end') throw new Error('无法验证升级后的事件位置映射')
      cursor++ // Native v3→v4 may close an interrupted inherited turn.
    }
    if (cursor >= target.events.length) throw new Error('升级丢失了原始事件位置')
    targetPositions[event.seq] = cursor
    const source = normalized.upgradeOrigins ? normalized.upgradeOrigins[event.seq] : event.seq
    if (source !== null) {
      seqMap.push([source, cursor])
      const old = original.events[source]
      if (old.type === 'assistant/message' && old.data.turn !== target.events[cursor].data.turn) {
        storyTurns.push([cursor, old.data.turn])
        target.events[cursor].data.message.source = { ...target.events[cursor].data.message.source, tavernStoryTurn: old.data.turn }
      }
    }
    cursor++
  }
  for (const event of target.events) if (event.data?.tavernRestoredCallSeq !== undefined) {
    const seq = targetPositions[event.data.tavernRestoredCallSeq]
    if (seq === undefined || target.events[seq]?.type !== 'tool/call') throw new Error('恢复工具调用的历史引用丢失')
    event.data.tavernRestoredCallSeq = seq
  }
  return { ...target, events: [...target.events, { seq: target.events.length, time: target.events.at(-1)?.time ?? target.header.createdAt,
    type: SESSION_UPGRADE_EVENT, ignorable: true, data: { version: 1, sourceVersion, sourceEventCount: original.events.length, seqMap, storyTurns, ...(normalized.repairedHistory ? { repairHistory: structuredClone(original.events) } : {}) } }] }
}

function assertContentPreserved(before, after) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
  const surface = artifact => {
    const nodes = []
    for (const event of artifact.events) {
      if (event.surfaceOp === 'append') nodes.push(event.seq)
      else if (event.surfaceOp?.op === 'replace') {
        const a = nodes.indexOf(event.surfaceOp.startSeq), b = nodes.indexOf(event.surfaceOp.endSeq)
        if (a < 0 || b < a) throw new Error('修复前后上下文范围无法核对')
        nodes.splice(a, b - a + 1, event.seq)
      }
    }
    return nodes.map(seq => artifact.events[seq]).filter(event => !(event.type === 'system/message'
      && event.data.message.id.startsWith('tavern-upgrade-compacted-head-') && event.data.message.content.length === 0))
  }
  const messages = artifact => artifact.events.flatMap(event => {
    if (!['system/message', 'user/message', 'assistant/message', 'tool/result'].includes(event.type)) return []
    let message = event.type === 'user/message' ? event.data : event.data.message
    // V4 lifts the old user/tool-result wrapper into a first-class tool message.
    // Compare its payload in that representation, including extension fields.
    if (event.type === 'tool/result' && message.role === 'user' && message.content?.length === 1 && message.content[0].type === 'tool-result') {
      const wrapper = message.content[0]
      const extra = (value, known, owner) => Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)).map(([key, value]) => [`plugin:${owner}:${key}`, value]))
      message = { id: message.id, role: 'tool', toolCallId: wrapper.toolCallId, content: wrapper.content,
        ...(wrapper.isError === undefined ? {} : { isError: wrapper.isError }),
        ...extra(message, ['id', 'role', 'source', 'content'], 'message'),
        ...extra(wrapper, ['type', 'toolCallId', 'content', 'isError'], 'result') }
    }
    // Producer vocabulary and turn coordinates change across generations; the
    // original payload, including attachments/tool calls, must remain available.
    const { source, turn, step, ...payload } = message
    return [JSON.stringify([event.type, canonical(payload)])]
  })
  const remaining = new Map()
  for (const value of messages(after)) remaining.set(value, (remaining.get(value) || 0) + 1)
  for (const value of messages(before)) {
    if (!remaining.get(value)) throw new Error('迁移未能完整保留原始消息，保留原档')
    remaining.set(value, remaining.get(value) - 1)
  }
  const repairHistory = after.events.at(-1)?.data?.repairHistory
  if (repairHistory) {
    if (!isDeepStrictEqual(repairHistory, before.events)) throw new Error('修复未完整保留原始历史事件')
    if (!isDeepStrictEqual(messages({ events: surface(before) }), messages({ events: surface(after) }))) throw new Error('修复改变了存档的有效上下文，保留原档')
  }
  const summaries = artifact => artifact.events.filter(event => event.type === 'compaction/summary').map(event => event.data.summary)
  if (!isDeepStrictEqual(summaries(before), summaries(after))) throw new Error('迁移未能完整保留压缩摘要，保留原档')
}

// Older rollback/fork writers recorded replacements after a closed step. Bind
// those administrative edits to the next existing step, without shifting any
// generated turn numbers. A final edit gets its own new turn when none follows.
// Inherited history stays on its side of the seed marker.
function normalizeHistoricalEdits(artifact) {
  const events = structuredClone(artifact.events)
  let turn = null, step = null, changed = false, restoredTools = false, synthetic = -1
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (event.type === 'turn/start') turn = event.data.turn
    if (event.type === 'step/start') step = event.data.step
    if (event.type === 'step/end') step = null
    if (event.type === 'turn/end') turn = null
    if (!['assistant/message', 'system/message'].includes(event.type) || event.surfaceOp?.op !== 'replace' || step !== null) continue
    const nextStep = events.slice(index + 1).find(row => row.type === 'step/start')
    const nextTurn = nextStep && events.slice(index + 1, events.indexOf(nextStep)).find(row => row.type === 'turn/start')
    const end = nextStep ? events.indexOf(nextStep) : events.length
    const replacements = events.slice(index, end).filter(row => (['assistant/message', 'system/message'].includes(row.type) && row.surfaceOp?.op === 'replace') || row.type === 'tool/result')
    const restoredCalls = []
    // Undo replay wrote an empty tool-result placeholder, followed immediately
    // by an exact copy of an earlier result. Reuse the recorded call as explicit
    // restoration history; never infer or run a tool from its name/arguments.
    for (const placeholder of replacements.filter(row => row.type === 'tool/result' && row.surfaceOp === 'append')) {
      const at = events.indexOf(placeholder), replacement = events[at + 1]
      const original = replacement?.sourceEventSeqs?.map(seq => artifact.events[seq]).find(row => row?.type === 'tool/result' && row.seq < placeholder.seq)
      const call = original?.sourceEventSeqs?.map(seq => artifact.events[seq]).find(row => row?.type === 'tool/call')
      const expected = original && structuredClone(original.data)
      if (expected?.message?.content?.[0]?.type === 'tool-result') expected.message.content[0].content = []
      if (!call || replacement?.surfaceOp?.startSeq !== placeholder.seq || replacement.surfaceOp.endSeq !== placeholder.seq
        || !isDeepStrictEqual(replacement.data, original.data) || !isDeepStrictEqual(placeholder.data, expected)) {
        throw new Error('无法证明旧工具记录是完整的撤销回退副本')
      }
      restoredTools = true
      const restoredCall = { ...structuredClone(call), seq: synthetic--, time: placeholder.time,
        data: { ...structuredClone(call.data), tavernRestoredCallSeq: call.seq } }
      restoredCalls.push(restoredCall)
      events.splice(at, 0, restoredCall)
    }
    const assignedTurn = nextStep?.data.turn ?? (turn ?? Math.max(0, ...events.filter(row => row.type === 'turn/start').map(row => row.data.turn)) + 1)
    const assignedStep = nextStep?.data.step ?? (turn === null ? 1 : Math.max(0, ...events.filter(row => row.type === 'step/start' && row.data.turn === turn).map(row => row.data.step)) + 1)
    for (const replacement of [...replacements, ...restoredCalls]) { replacement.data.turn = assignedTurn; replacement.data.step = assignedStep }
    const boundaries = []
    if (turn === null) boundaries.push(nextTurn || { seq: synthetic--, time: event.time, type: 'turn/start', data: { turn: assignedTurn } })
    boundaries.push(nextStep || { seq: synthetic--, time: event.time, type: 'step/start', data: { turn: assignedTurn, step: assignedStep } })
    for (const boundary of boundaries) {
      const from = events.indexOf(boundary)
      if (from >= 0) events.splice(from, 1)
    }
    events.splice(index, 0, ...boundaries)
    if (!nextStep) {
      const closingTurn = events.findIndex((row, at) => at > index && row.type === 'turn/end' && row.data.turn === assignedTurn)
      const closingStep = { seq: synthetic--, time: events.at(-1).time, type: 'step/end', data: { turn: assignedTurn, step: assignedStep } }
      if (closingTurn >= 0) events.splice(closingTurn, 0, closingStep)
      else events.push(closingStep)
      if (turn === null) events.push({ seq: synthetic--, time: events.at(-1).time, type: 'turn/end', data: { turn: assignedTurn, reason: { kind: 'completed' } } })
    }
    changed = true
    index-- // Process the moved boundaries through the same state machine.
  }
  if (!changed) return artifact
  const mapping = []
  events.forEach((event, seq) => { mapping[event.seq] = seq })
  const cut = artifact.header.isSeeded ? mapping[artifact.inheritedEventCount] : 0
  if (cut === undefined || artifact.events.some(event => (event.seq < artifact.inheritedEventCount) !== (mapping[event.seq] < cut))) throw new Error('正文编辑调整会跨越分支继承边界')
  return { ...artifact, repairedHistory: artifact.repairedHistory || restoredTools, inheritedEventCount: cut, upgradeOrigins: events.map(event => event.seq < 0 ? null : (artifact.upgradeOrigins ? artifact.upgradeOrigins[event.seq] : event.seq)), events: events.map((event, seq) => event.seq < 0 && event.type !== 'tool/call' ? { ...event, seq } : remapReferences(event, mapping)) }
}

async function inventory(root) {
  const found = []
  const directories = []
  async function walk(directory) {
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT' && directory === root) return; throw error }
    if (entries.some(entry => entry.isDirectory())) directories.push({ directory, stamp: await directoryStamp(directory) })
    const generations = entries.filter(entry => entry.isFile() && generationName.test(entry.name))
      .map(entry => ({ file: path.join(directory, entry.name), version: Number(entry.name.match(generationName)[1] || 0) }))
      .sort((a, b) => b.version - a.version)
    if (generations.length) {
      const first = generations[0]
      found.push({ ...first, ambiguous: generations[1]?.version === first.version })
    }
    for (const entry of entries) if (entry.isDirectory()) await walk(path.join(directory, entry.name))
  }
  await walk(root)
  return { records: found.sort((a, b) => a.file.localeCompare(b.file)), directories }
}

async function directoryStamp(directory) {
  const value = await stat(directory, { bigint: true })
  return `${value.dev}:${value.ino}:${value.mtimeNs}:${value.ctimeNs}`
}

async function verifyGeneration(record) {
  const names = (await readdir(path.dirname(record.file))).filter(name => generationName.test(name))
  const expected = record.published || record
  if (names.some(name => Number(name.match(generationName)[1] || 0) >= Number(path.basename(expected.file).match(generationName)[1] || 0) && name !== path.basename(expected.file))) throw new Error('迁移期间出现新的存档版本')
  await unchanged(expected)
}

async function unchanged(record) {
  if (digest(await readFile(record.file)) !== record.digest) throw new Error('迁移期间旧存档发生变化，请关闭其他 DSH 后重试')
}

async function publish(file, bytes, verify) {
  const temporary = file + '.tmp-tavern-upgrade-' + randomUUID()
  try {
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    if (!(await readFile(temporary)).equals(bytes)) throw new Error('新版文件落盘校验失败')
    await verify()
    // link is atomic and fails on EEXIST on all supported desktop platforms.
    // Unlike rename, it can never overwrite another process's newer progress.
    await link(temporary, file)
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

export async function migrateSessionDirectory(root, migration) {
  const currentVersion = migration.sessionFormatCatalog.currentVersion
  if (currentVersion !== 4) throw new Error('升级器仅支持 DSH v4 存档')
  const { records, directories } = await inventory(root)
  const summary = { seen: records.length, migrated: 0, unchanged: 0, refused: 0, failures: [] }
  if (records.every(record => record.version >= currentVersion)) return { ...summary, unchanged: records.length, sessions: records.map(record => ({ id: path.basename(path.dirname(record.file)), ready: record.version === currentVersion })) }
  // Collect complete child evidence before publishing anything; a bad child
  // blocks its parent, rather than silently declaring that the parent has none.
  for (const record of records) {
    try {
      if (record.ambiguous) throw new Error('同一代存档同时存在压缩和未压缩文件')
      const bytes = await readFile(record.file)
      record.digest = digest(bytes)
      const parsed = parseSessionLog(bytes)
      record.header = parsed.header
      if (parsed.header.version !== record.version) throw new Error('文件名与存档版本不一致')
      if (record.header.origin === 'subagent' && record.header.parentSession) {
        const artifact = record.version < currentVersion
          ? historicalLog(parsed, migration.historicalSessionFormatCatalog)
          : restoreSessionLog(parsed, migration.sessionFormatCatalog)
        record.child = migration.historicalChildCatalogSource(artifact)
      }
    } catch (error) { record.error = error.message || String(error) }
  }
  for (const record of records) {
    // A higher generation is authoritative even if damaged. Never resurrect an
    // older generation on top of newer user progress.
    if (record.version >= currentVersion) { summary.unchanged++; continue }
    try {
      if (record.error) throw new Error(record.error)
      if (records.some(other => other.error && !other.header)) throw new Error('存在无法读取身份的会话，无法确认完整父子关系')
      const children = records.filter(other => other.header?.origin === 'subagent' && other.header.parentSession === record.header.id)
      const broken = children.find(child => child.error)
      if (broken) throw new Error('子会话无法读取：' + broken.error)
      const bytes = await readFile(record.file)
      if (digest(bytes) !== record.digest) throw new Error('迁移期间旧存档发生变化')
      const result = prepareSessionUpgrade(parseSessionLog(bytes), migration, children.map(child => child.child))
      const target = path.join(path.dirname(record.file), `session.v${currentVersion}.jsonl.zstd`)
      await publish(target, result.bytes, async () => {
        for (const source of [record, ...children]) { await unchanged(source); await verifyGeneration(source) }
        for (const witness of directories) if (await directoryStamp(witness.directory) !== witness.stamp) throw new Error('迁移期间会话目录发生变化')
      })
      record.published = { file: target, digest: digest(result.bytes) }
      summary.migrated++
    } catch (error) {
      summary.refused++
      summary.failures.push({ file: record.file, reason: error.message || String(error) })
    }
  }
  summary.sessions = records.map(record => ({ id: record.header?.id || path.basename(path.dirname(record.file)), ready: Boolean(record.published) || record.version === currentVersion, error: summary.failures.find(failure => failure.file === record.file)?.reason }))
  return summary
}

export async function migrateInstalledSessions(dataRoot, loadMigration) {
  try {
    const summary = await migrateSessionDirectory(path.join(path.dirname(dataRoot), 'sessions'), await loadMigration())
    if (summary.migrated || summary.refused) console.warn(`dsh-tavern: DSH 0.2.1 存档升级：完成 ${summary.migrated}，已有新版 ${summary.unchanged}，保留原档待处理 ${summary.refused}`)
    for (const failure of summary.failures) console.warn(`dsh-tavern: 未升级 ${failure.file}：${failure.reason}`)
    return summary
  } catch (error) {
    console.warn('dsh-tavern: 存档升级未完成，原档保留：' + (error.message || error))
    return null
  }
}
