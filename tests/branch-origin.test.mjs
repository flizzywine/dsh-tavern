import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBranchOriginRepair } from '../tavern-plugin/lib/domain/branch-origin-repair.js'
import { repairBranchOriginFile } from '../tavern-plugin/lib/domain/branch-origin.js'
import { encodeCurrentGeneration, parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'

// A minimal stand-in for the host catalog: current generation only, no recovery and no
// extra validation, so the test exercises Tavern's own decision and rewrite.
const catalog = {
  currentVersion: 4,
  createRestore(header) {
    const events = []
    return {
      decodeRow(row) { events.push(row) },
      finish() {
        const inherited = events.findLastIndex(event => event.type === 'session/end-seed' && event.data?.inherited === true)
        return { header, events, inheritedEventCount: inherited + 1 }
      }
    }
  },
  encodeCurrentHeader(header) { return { type: 'session', ...header } },
  encodeCurrentEvent(event) { return event }
}

const message = (role, text) => ({
  id: role + '-' + text,
  role,
  content: [{ type: 'text', text }],
  source: role === 'assistant' ? { kind: 'model', provider: 'fixture', model: 'fixture' } : { kind: 'user' }
})

function branchLog(id = 'session-branch', events) {
  const header = { type: 'session', version: 4, id, createdAt: 1, cwd: '/tmp', parentSession: 'session-game', isSeeded: true, origin: 'subagent', delegationDepth: 0, agentPreset: 'tavern' }
  const rows = (events || [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'system/message', data: { turn: 1, step: 1, message: message('system', '角色设定') }, surfaceOp: 'append' },
    { type: 'session/end-seed', data: { inherited: true } },
    { type: 'user/message', data: message('user', '继续故事'), surfaceOp: 'append' },
    { type: 'assistant/message', data: { turn: 1, step: 1, stream: [], message: message('assistant', '分支正文') }, surfaceOp: 'append' },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
  ]).map((row, seq) => ({ seq, time: 1, ...row }))
  return { header, events: rows, inheritedEventCount: rows.findLastIndex(event => event.type === 'session/end-seed' && event.data?.inherited === true) + 1 }
}

const buffer = artifact => encodeCurrentGeneration(artifact, catalog)

test('rewriting a stored branch keeps the original generation beside it', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tavern-branch-origin-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'session.v4.jsonl.zstd')
  const bytes = buffer(branchLog())
  await writeFile(file, bytes)

  const first = await repairBranchOriginFile(file, catalog)
  assert.equal(first.ok, true)
  assert.equal(first.changed, true)
  assert.equal(first.written, true)
  assert.equal(first.backup, file + '.bak-tavern-branch-origin')
  assert.deepEqual(await readFile(first.backup), bytes)
  assert.equal(Object.hasOwn(parseSessionLog(await readFile(file)).header, 'origin'), false)

  // The repaired log is healthy: a second pass reports it and leaves the file alone.
  const before = await readFile(file)
  const second = await repairBranchOriginFile(file, catalog)
  assert.equal(second.ok, true)
  assert.equal(second.changed, false)
  assert.equal(second.written, false)
  assert.deepEqual(await readFile(file), before)
})

async function install(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'tavern-branch-origin-repair-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const project = path.join(home, 'sessions', 'project')
  const dataRoot = path.join(home, 'data')
  await mkdir(project, { recursive: true })
  await mkdir(dataRoot, { recursive: true })
  async function save(id) {
    const directory = path.join(project, id)
    await mkdir(directory, { recursive: true })
    const file = path.join(directory, 'session.v4.jsonl.zstd')
    await writeFile(file, buffer(branchLog(id)))
    return file
  }
  return { home, dataRoot, save }
}

test('the repair runs once per session and skips loaded or foreign sessions', async t => {
  const { dataRoot, save } = await install(t)
  const branch = await save('session-branch')
  const loaded = await save('session-loaded')
  const foreign = await save('session-foreign')

  const live = new Set(['session-loaded'])
  const chats = new Set(['session-branch', 'session-loaded'])
  const repair = createBranchOriginRepair({
    dataRoot,
    loadCatalog: async () => catalog,
    isLive: id => live.has(id),
    ownsChat: async id => chats.has(id),
    logger: { warn() {} }
  })

  const first = await repair.ensure('session-branch')
  assert.equal(first.changed, true)
  assert.equal(Object.hasOwn(parseSessionLog(await readFile(branch)).header, 'origin'), false)
  // Nothing more to do for that session this process.
  assert.equal((await repair.ensure('session-branch')).changed, false)

  // A run held by the host is retried next time instead of rewritten underneath it.
  assert.equal((await repair.ensure('session-loaded')).changed, false)
  assert.equal(Object.hasOwn(parseSessionLog(await readFile(loaded)).header, 'origin'), true)
  live.delete('session-loaded')
  assert.equal((await repair.ensure('session-loaded')).changed, true)

  // Another plugin's delegated child is left alone.
  assert.equal((await repair.ensure('session-foreign')).changed, false)
  assert.equal(Object.hasOwn(parseSessionLog(await readFile(foreign)).header, 'origin'), true)
})
