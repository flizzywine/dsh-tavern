import { encodeCurrentGeneration } from '../tavern-plugin/lib/domain/session-log-codec.js'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { repairCurrentSessionBuffer, repairCurrentSessionFile, repairStoredSessionLog } from '../tavern-plugin/lib/domain/session-log-repair.js'

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
