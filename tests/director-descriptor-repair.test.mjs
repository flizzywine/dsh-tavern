import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { STAGE_DIRECTOR_DESCRIPTOR, subagentDescriptor } from '../tavern-plugin/lib/domain/background-descriptors.js'
import { createDirectorDescriptorRepair, withReadableDirectorDescriptor } from '../tavern-plugin/lib/domain/director-descriptor-repair.js'
import { encodeCurrentGeneration, parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'

// Current generation only, no recovery: the test exercises Tavern's decision and rewrite.
const catalog = {
  currentVersion: 4,
  createRestore(header) {
    const events = []
    return {
      decodeRow(row) { events.push(row) },
      finish() { return { header, events, inheritedEventCount: 0 } }
    }
  },
  encodeCurrentHeader(header) { return { type: 'session', ...header } },
  encodeCurrentEvent(event) { return event }
}

// What the director wrote before: a one-shot descriptor with a field the host does not allow.
const OLD_DIRECTOR = { version: 3, mode: 'one-shot', provider: 'dsh-tavern-stage-director', label: '舞台导演', persona: '独立处理已完成正文的增量演出。' }

function directorLog(id, descriptor) {
  const header = { type: 'session', version: 4, id, createdAt: 1, cwd: '/tmp', parentSession: 'session-game', isSeeded: false, origin: 'subagent', delegationDepth: 1, agentPreset: 'tavern-background' }
  const events = [
    { type: 'permission/preset', data: { preset: 'default' } },
    { type: 'subagent/descriptor', data: descriptor },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
  ].map((row, seq) => ({ seq, time: 1, ...row }))
  return encodeCurrentGeneration({ header, events, inheritedEventCount: 0 }, catalog)
}

const hostReads = data => foldSubagentDescriptor([{ type: 'subagent/descriptor', data }])

test('the director descriptor is one the host reads back, and a disallowed field fails where it is made', () => {
  assert.deepEqual(hostReads(STAGE_DIRECTOR_DESCRIPTOR), STAGE_DIRECTOR_DESCRIPTOR)
  assert.throws(() => hostReads(OLD_DIRECTOR), /unknown field "persona"/)
  assert.throws(() => subagentDescriptor({ mode: 'one-shot', provider: 'p', label: 'l', persona: 'x' }), /unknown field "persona"/)
})

test('an old director log gets the current descriptor and nothing else changes', () => {
  const before = parseSessionLog(directorLog('background-a', OLD_DIRECTOR))
  const result = withReadableDirectorDescriptor(directorLog('background-a', OLD_DIRECTOR), catalog)
  assert.equal(result.changed, true)
  const after = parseSessionLog(result.bytes)
  assert.deepEqual(after.header, before.header)
  assert.deepEqual(after.events[1].data, STAGE_DIRECTOR_DESCRIPTOR)
  assert.deepEqual(after.events.filter((_, index) => index !== 1), before.events.filter((_, index) => index !== 1))

  assert.equal(withReadableDirectorDescriptor(result.bytes, catalog).changed, false)
})

test('the startup sweep repairs only children the host reads without identity and drops their cached projections', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'tavern-director-descriptor-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dataRoot = path.join(home, 'data')
  await mkdir(dataRoot, { recursive: true })
  const files = {}
  for (const [id, descriptor] of [['background-old', OLD_DIRECTOR], ['background-ok', STAGE_DIRECTOR_DESCRIPTOR], ['background-running', OLD_DIRECTOR]]) {
    const directory = path.join(home, 'sessions', 'project', id)
    await mkdir(directory, { recursive: true })
    files[id] = path.join(directory, 'session.v4.jsonl.zstd')
    await writeFile(files[id], directorLog(id, descriptor))
  }
  const identities = { 'background-old': null, 'background-ok': { mode: 'one-shot', label: '舞台导演', seq: 1 }, 'background-running': null }
  const forgotten = []
  const repair = createDirectorDescriptorRepair({
    dataRoot,
    loadCatalog: async () => catalog,
    listSessions: async () => Object.keys(identities).map(id => ({ header: { id, origin: 'subagent', parentSession: 'session-game' } })),
    hostIdentity: header => identities[header.id],
    forgetProjections: async id => { forgotten.push(id) },
    isLive: id => id === 'background-running',
    logger: { warn() {} }
  })

  assert.deepEqual(await repair.sweep(), { checked: 1, changed: 1 })
  assert.deepEqual(forgotten, ['background-old'])
  assert.deepEqual(parseSessionLog(await readFile(files['background-old'])).events[1].data, STAGE_DIRECTOR_DESCRIPTOR)
  assert.deepEqual(parseSessionLog(await readFile(files['background-running'])).events[1].data, OLD_DIRECTOR)
})
