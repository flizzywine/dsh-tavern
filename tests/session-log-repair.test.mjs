import { encodeCurrentGeneration } from '../tavern-plugin/lib/domain/session-log-codec.js'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installSessionLogAutoRepair, repairCurrentSessionBuffer, repairCurrentSessionFile, repairStoredSessionLog } from '../tavern-plugin/lib/domain/session-log-repair.js'

// The host catalog is the only judge of whether a log opens, so these tests use it
// instead of a stand-in. Without a boot module the whole file is skipped.
const bootModule = process.env.DSH_BOOT_MODULE ? pathToFileURL(process.env.DSH_BOOT_MODULE) : null
const catalogUrl = bootModule ? pathToFileURL(createRequire(path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(bootModule)))), 'dsh-session', 'package.json')).resolve('@deepseek-ai/dsh-session-format-catalog')).href : null
const needsHost = catalogUrl ? {} : { skip: '需要 DSH_BOOT_MODULE 指向宿主 dsh-app-boot' }

const HEADER = { type: 'session', version: 4, id: 'session-repair-fixture', createdAt: 1, cwd: '/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'tavern' }

function turnRows(turn, text) {
  return [
    { type: 'turn/start', time: turn, data: { turn } },
    { type: 'step/start', time: turn, data: { turn, step: 1 } },
    { type: 'user/message', time: turn, surfaceOp: 'append', data: { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' }, turn, step: 1 } },
    { type: 'step/end', time: turn, data: { turn, step: 1 } },
    { type: 'turn/end', time: turn, data: { turn, reason: { kind: 'completed' } } },
  ]
}

function open(catalog, events) {
  const restore = catalog.createRestore(HEADER, { recovery: 'strict', validation: 'current' })
  for (const event of events) restore.decodeRow(structuredClone(event))
  return restore.finish()
}

function validArtifact(catalog) {
  return open(catalog, [...turnRows(1, '开场'), ...turnRows(2, '继续')].map((row, seq) => ({ seq, ...row })))
}

// The live Agent numbered its second turn 1 again; DSH then refuses the whole log.
function duplicatedTurnArtifact(catalog) {
  const artifact = validArtifact(catalog)
  const events = structuredClone(artifact.events)
  const second = events.findIndex(event => event.type === 'turn/start' && event.data.turn === 2)
  for (const event of events.slice(second)) if (event.data && Object.hasOwn(event.data, 'turn')) event.data.turn = 1
  return { ...artifact, events }
}

function turnNumbers(events) {
  return events.filter(event => event.type === 'turn/start').map(event => event.data.turn)
}

test('a log whose turns open in order is left untouched', needsHost, async () => {
  const { sessionFormatCatalog: catalog } = await import(catalogUrl)
  const result = repairCurrentSessionBuffer(encodeCurrentGeneration(validArtifact(catalog), catalog), catalog)
  assert.equal(result.ok, true)
  assert.equal(result.changed, false)
  assert.deepEqual(turnNumbers(result.artifact.events), [1, 2])
})

test('a turn the live Agent numbered twice is renumbered until the host accepts it', needsHost, async () => {
  const { sessionFormatCatalog: catalog } = await import(catalogUrl)
  const corrupt = duplicatedTurnArtifact(catalog)
  assert.throws(() => open(catalog, corrupt.events), /turn\/start does not open the expected turn/)
  const result = repairCurrentSessionBuffer(encodeCurrentGeneration(corrupt, catalog), catalog)
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.deepEqual(turnNumbers(result.artifact.events), [1, 2])
  // The repair is what makes the log open, not a looser validator.
  assert.doesNotThrow(() => open(catalog, result.artifact.events))
  // Story text is untouched; only the turn numbers move.
  assert.deepEqual(result.artifact.events.filter(event => event.type === 'user/message').map(event => event.data.content[0].text), ['开场', '继续'])
})

test('repairing a stored log keeps the original bytes beside it', needsHost, async t => {
  const { sessionFormatCatalog: catalog } = await import(catalogUrl)
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-log-repair-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'sessions', '--project--', 'session-2d85f0e4')
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'session.v' + catalog.currentVersion + '.jsonl.zstd')
  const original = encodeCurrentGeneration(duplicatedTurnArtifact(catalog), catalog)
  await writeFile(file, original)
  const result = await repairCurrentSessionFile(file, catalog)
  assert.equal(result.ok, true)
  assert.equal(result.written, true)
  assert.deepEqual(await readFile(result.backup), original)
  const repaired = repairCurrentSessionBuffer(await readFile(file), catalog)
  assert.equal(repaired.ok, true)
  assert.equal(repaired.changed, false)
  // A second repair has nothing left to do and must not touch the file again.
  const again = await repairCurrentSessionFile(file, catalog)
  assert.equal(again.ok, true)
  assert.equal(again.written, false)
})

test('the repair finds one session by id and never touches a healthy one', needsHost, async t => {
  const { sessionFormatCatalog: catalog } = await import(catalogUrl)
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-log-repair-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = path.join(root, 'data')
  await mkdir(dataRoot, { recursive: true })
  const broken = path.join(root, 'sessions', '--other-project--', 'session-broken')
  const healthy = path.join(root, 'sessions', '--project--', 'session-healthy')
  await mkdir(broken, { recursive: true })
  await mkdir(healthy, { recursive: true })
  const name = 'session.v' + catalog.currentVersion + '.jsonl.zstd'
  await writeFile(path.join(broken, name), encodeCurrentGeneration(duplicatedTurnArtifact(catalog), catalog))
  const healthyBytes = encodeCurrentGeneration(validArtifact(catalog), catalog)
  await writeFile(path.join(healthy, name), healthyBytes)
  const repaired = await repairStoredSessionLog(dataRoot, 'session-broken', async () => catalog)
  assert.equal(repaired.ok, true)
  assert.equal(repaired.repaired, true)
  assert.equal(repaired.file, path.join(broken, name))
  assert.deepEqual(await readFile(path.join(healthy, name)), healthyBytes)
  const untouched = await repairStoredSessionLog(dataRoot, 'session-healthy', async () => catalog)
  assert.equal(untouched.ok, true)
  assert.equal(untouched.repaired, false)
  const missing = await repairStoredSessionLog(dataRoot, 'session-unknown', async () => catalog)
  assert.equal(missing.ok, false)
  assert.equal(missing.repaired, false)
})

// The host reports a broken log only when something reads it (history pane, resume,
// query), never through the call that switched to the session. The repair therefore
// sits on the real persistence read.
test('a read of a broken log repairs it in place and then succeeds', needsHost, async t => {
  const { sessionFormatCatalog: catalog } = await import(catalogUrl)
  const hostRequire = createRequire(fileURLToPath(bootModule))
  const load = name => import(pathToFileURL(hostRequire.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const loaded = await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const Jsonl = typeof loaded.apply === 'function' ? loaded : loaded.default
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-log-autorepair-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(Jsonl, { root: path.join(root, 'sessions'), compression: 'zstd' }).await()
  t.after(() => ctx.fiber.dispose())
  const persistence = ctx.sessionPersistence
  const corrupt = duplicatedTurnArtifact(catalog)
  const header = corrupt.header
  const file = persistence.locate(header).path
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, encodeCurrentGeneration(corrupt, catalog))
  await assert.rejects(persistence.open(header.id, 'read'), /turn\/start does not open the expected turn/)

  const dataRoot = path.join(root, 'data')
  let repairs = 0
  const restore = installSessionLogAutoRepair({ persistence, repair: id => { repairs += 1; return repairStoredSessionLog(dataRoot, id, async () => catalog) } })
  const handle = await persistence.open(header.id, 'read')
  const { events } = await handle.read(0)
  await handle.close()
  assert.deepEqual(turnNumbers(events), [1, 2])
  assert.equal(repairs, 1)
  // A healthy read afterwards never calls the repair again.
  await (await persistence.open(header.id, 'read')).close()
  assert.equal(repairs, 1)
  const wrapped = persistence.open
  restore()
  assert.notEqual(persistence.open, wrapped)
})

// #247: replies older versions wrote after their step closed. The repair runs with the
// installed session patch's catalog, which accepts Tavern's reply replacements.
async function patchedCatalog() {
  const { prepareExpandedPatch } = await import('../tavern-plugin/lib/domain/host-session-patch.js')
  return (await prepareExpandedPatch(fileURLToPath(bootModule).split(path.sep + 'node_modules' + path.sep)[0])).catalog
}

function lateReplyLog(shape) {
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const reply = (turn, step, id, text, source = model) => ({ turn, step, stream: [], message: { id, role: 'assistant', content: [{ type: 'text', text }], source } })
  const rows = []
  const add = (type, data, extra = {}) => { const event = { seq: rows.length, type, time: 1, data, ...extra }; rows.push(event); return event }
  function round(turn) {
    add('turn/start', { turn })
    add('step/start', { turn, step: 1 })
    add('user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }], source: { kind: 'user' }, turn, step: 1 }, { surfaceOp: 'append' })
    const answer = add('assistant/message', reply(turn, 1, 'a' + turn, '正文' + turn), { surfaceOp: 'append' })
    add('step/end', { turn, step: 1 })
    return answer
  }
  round(1)
  add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const answer = round(2)
  if (shape === 'settlement') {
    // The copy was appended before the edit step for its replacement opened.
    const projection = { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }
    const copy = add('assistant/message', reply(2, 1, 'p2', '整理后', projection), { surfaceOp: 'append' })
    add('step/start', { turn: 2, step: 2 })
    add('assistant/message', reply(2, 2, 'p2', '整理后', projection), { surfaceOp: { op: 'replace', startSeq: answer.seq, endSeq: copy.seq }, sourceEventSeqs: [answer.seq, copy.seq] })
    add('step/end', { turn: 2, step: 2 })
    add('turn/end', { turn: 2, reason: { kind: 'completed' } })
  } else {
    // Native repair wrote two older rounds back after the last turn ended.
    add('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const repair = { kind: 'model', provider: 'dsh-tavern', model: 'native-repair' }
    add('user/message', { id: 'r1', role: 'user', content: [{ type: 'text', text: '行动1' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    add('assistant/message', reply(2, 1, 'r1a', '正文1', repair), { surfaceOp: 'append' })
    add('user/message', { id: 'r2', role: 'user', content: [{ type: 'text', text: '行动2' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    add('assistant/message', reply(3, 1, 'r2a', '正文2', repair), { surfaceOp: 'append' })
  }
  return rows
}

// The host writes its empty system head before the first step. A log that projected a
// message first (older Tavern seeding, a restored surface) leaves the surface without
// that head; the next system/message the host appends then makes the whole log unreadable.
const SYSTEM_SOURCE = { kind: 'system-prompt', plugin: '@deepseek-ai/dsh-system-prompt' }

function headlessLog() {
  const rows = []
  const add = (type, data, extra = {}) => { const event = { seq: rows.length, type, time: 1, data, ...extra }; rows.push(event); return event }
  const user = (turn, text) => add('user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' }, turn, step: 1 }, { surfaceOp: 'append' })
  add('turn/start', { turn: 1 })
  add('step/start', { turn: 1, step: 1 })
  user(1, '开场')
  add('step/end', { turn: 1, step: 1 })
  add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  add('turn/start', { turn: 2 })
  add('step/start', { turn: 2, step: 1 })
  // The host refreshed the system prompt in history: first surface row that is a system message.
  add('system/message', { turn: 2, step: 1, message: { id: 'sys2', role: 'system', content: [{ type: 'text', text: '系统提示' }], source: SYSTEM_SOURCE } }, { surfaceOp: 'append' })
  user(2, '继续')
  add('step/end', { turn: 2, step: 1 })
  add('turn/end', { turn: 2, reason: { kind: 'completed' } })
  return rows
}

test('a surface that starts without a system head gets one reserved', needsHost, async () => {
  const { sessionFormatCatalog: catalog } = await import(catalogUrl)
  const rows = headlessLog()
  assert.throws(() => open(catalog, rows), /system\/message requires a protected first surface head/)
  const artifact = { ...open(catalog, []), events: rows }
  const result = repairCurrentSessionBuffer(encodeCurrentGeneration(artifact, catalog), catalog)
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.changed, true)
  assert.doesNotThrow(() => open(catalog, result.artifact.events))
  const firstSurface = result.artifact.events.find(event => event.surfaceOp !== undefined)
  assert.equal(firstSurface.type, 'system/message')
  assert.equal(firstSurface.surfaceOp, 'append')
  // Only the reserved head is added; every story row survives with a contiguous seq.
  assert.equal(result.artifact.events.length, rows.length + 1)
  assert.deepEqual(result.artifact.events.map(event => event.seq), Array.from({ length: rows.length + 1 }, (_, index) => index))
  assert.deepEqual(result.artifact.events.filter(event => event.type === 'user/message').map(event => event.data.content[0].text), ['开场', '继续'])
  // A later system/message the host appends now lands on a protected head.
  const turn = 3
  const grown = [
    ...result.artifact.events,
    { type: 'turn/start', data: { turn } },
    { type: 'step/start', data: { turn, step: 1 } },
    { type: 'system/message', surfaceOp: 'append', data: { turn, step: 1, message: { id: 'sys3', role: 'system', content: [{ type: 'text', text: '系统提示2' }], source: SYSTEM_SOURCE } } },
    { type: 'user/message', surfaceOp: 'append', data: { id: 'u3', role: 'user', content: [{ type: 'text', text: '再来' }], source: { kind: 'user' }, turn, step: 1 } },
    { type: 'step/end', data: { turn, step: 1 } },
    { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ time: 1, ...row, seq }))
  assert.doesNotThrow(() => open(catalog, grown))
})

test('a settlement copy written before its edit step moves into that step', needsHost, async () => {
  const catalog = await patchedCatalog()
  const rows = lateReplyLog('settlement')
  assert.throws(() => open(catalog, rows), /does not match an open turn and step/)
  const result = repairCurrentSessionBuffer(encodeCurrentGeneration({ ...open(catalog, []), events: rows }, catalog), catalog)
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.changed, true)
  assert.doesNotThrow(() => open(catalog, result.artifact.events))
  // No row is added or dropped, and every earlier event keeps its seq.
  assert.equal(result.artifact.events.length, rows.length)
  const copy = result.artifact.events.find(event => event.data?.message?.id === 'p2' && event.surfaceOp === 'append')
  assert.deepEqual([copy.data.turn, copy.data.step], [2, 2])
  const replacement = result.artifact.events.find(event => event.surfaceOp?.op === 'replace')
  assert.ok(replacement.sourceEventSeqs.includes(copy.seq), 'the replacement still cites the moved copy')
})

// Older versions synchronized a template rewrite inside the player's turn before the
// Agent's first step: the edit step took step 1, and the Agent then opened step 1 again.
test('a template edit step written into an open turn is renumbered before the Agent steps', needsHost, async () => {
  const catalog = await patchedCatalog()
  const rows = []
  const add = (type, data, extra = {}) => { const event = { seq: rows.length, type, time: 1, data, ...extra }; rows.push(event); return event }
  const reply = (turn, step, id, text, source) => ({ turn, step, stream: [], message: { id, role: 'assistant', content: [{ type: 'text', text }], source } })
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  add('turn/start', { turn: 1 })
  add('step/start', { turn: 1, step: 1 })
  const opening = add('assistant/message', reply(1, 1, 'opening', '开场 金币: 10', { kind: 'model', provider: 'dsh-tavern', model: 'character-card' }), { surfaceOp: 'append' })
  add('step/end', { turn: 1, step: 1 })
  add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  add('turn/start', { turn: 2 })
  add('user/message', { id: 'u2', role: 'user', content: [{ type: 'text', text: '行动' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  add('step/start', { turn: 2, step: 1 })
  add('assistant/message', reply(2, 1, 'tavern-template-edit:1', '开场 金币: 20', { kind: 'model', provider: 'dsh-tavern', model: 'character-card' }),
    { surfaceOp: { op: 'replace', startSeq: opening.seq, endSeq: opening.seq }, sourceEventSeqs: [opening.seq] })
  add('step/end', { turn: 2, step: 1 })
  add('step/start', { turn: 2, step: 1 })
  add('assistant/message', reply(2, 1, 'a2', '正文', model), { surfaceOp: 'append' })
  add('step/end', { turn: 2, step: 1 })
  add('turn/end', { turn: 2, reason: { kind: 'completed' } })
  assert.throws(() => open(catalog, rows), /step\/start does not match the open turn and next step/)
  const result = repairCurrentSessionBuffer(encodeCurrentGeneration({ ...open(catalog, []), events: rows }, catalog), catalog)
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.changed, true)
  assert.doesNotThrow(() => open(catalog, result.artifact.events))
  // No row is added, dropped or moved; the Agent's step and its reply follow the edit step.
  assert.deepEqual(result.artifact.events.map(event => [event.seq, event.type]), rows.map(event => [event.seq, event.type]))
  assert.deepEqual(result.artifact.events.filter(event => event.type === 'step/start').map(event => [event.data.turn, event.data.step]), [[1, 1], [2, 1], [2, 2]])
  const answer = result.artifact.events.find(event => event.data?.message?.id === 'a2')
  assert.deepEqual([answer.data.turn, answer.data.step], [2, 2])
})
