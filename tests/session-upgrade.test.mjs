import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import test from 'node:test'
import { prepareExpandedPatch } from '../tavern-plugin/lib/domain/host-session-patch.js'
import { encodeCurrentGeneration, encodeMigratedSessionLog, parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'
import { migrateSessionDirectory, prepareSessionUpgrade, restoreSessionLog } from '../tavern-plugin/lib/domain/session-upgrade.js'
import { compactedLegacySession } from './fixtures/compacted-legacy-session.mjs'

const runtime = process.env.TAVERN_DSH_RUNTIME || path.resolve('config/cli-runtime')
const patch = await prepareExpandedPatch(runtime)
const migration = patch.migration
const catalog = migration.sessionFormatCatalog
const require = createRequire(path.join(runtime, 'package.json'))
const { Session } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')).href)
const header = id => ({ type: 'session', version: 3, id, createdAt: 1, cwd: '/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'tavern' })
const message = (role, text) => ({ id: role + '-' + text, role, content: [{ type: 'text', text }], source: role === 'system' ? { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'instructions' } : role === 'assistant' ? { kind: 'model', provider: 'fixture', model: 'fixture' } : { kind: 'user' } })
function fixture(id = 'save') {
  return { header: header(id), events: [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'system/message', data: { turn: 1, step: 1, message: message('system', '角色设定') }, surfaceOp: 'append' },
    { type: 'user/message', data: message('user', '继续故事'), surfaceOp: 'append' },
    { type: 'assistant/message', data: { turn: 1, step: 1, stream: [], message: message('assistant', '旧正文') }, surfaceOp: 'append' },
    { type: patch.marker, data: { version: 1, hostVersion: '0.1.5-rc.2' } },
    { type: 'assistant/message', data: { turn: 1, step: 1, stream: [], message: message('assistant', '已编辑正文') }, surfaceOp: { op: 'replace', startSeq: 4, endSeq: 4 }, sourceEventSeqs: [4] },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ seq, time: 1, ...row })) }
}
const buffer = parsed => encodeMigratedSessionLog(JSON.stringify(parsed.header), parsed.events)
const openSession = artifact => Session.fromRestore(artifact.header.id, artifact.events, artifact.header, artifact.inheritedEventCount, 'detached')
const texts = session => session.deriveMessages().flatMap(message => message.content).map(block => block.text || '').filter(Boolean)
async function root(t) { const directory = await mkdtemp(path.join(tmpdir(), 'tavern-021-upgrade-')); t.after(() => rm(directory, { recursive: true, force: true })); return directory }
async function save(root, parsed, compressed = true) {
  const directory = path.join(root, 'project', parsed.header.id)
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `session${parsed.header.version ? '.v' + parsed.header.version : ''}.jsonl${compressed ? '.zstd' : ''}`)
  const bytes = compressed ? buffer(parsed) : Buffer.from([parsed.header, ...parsed.events].map(JSON.stringify).join('\n') + '\n')
  await writeFile(file, bytes)
  return { directory, file, bytes, target: path.join(directory, 'session.v4.jsonl.zstd') }
}

test('upgraded edit history keeps citations, supports new turns and cold restore', () => {
  const old = fixture()
  const before = structuredClone(old)
  const result = prepareSessionUpgrade(old, migration)
  assert.deepEqual(old, before)
  assert.equal(result.artifact.header.id, old.header.id)
  assert.deepEqual(result.artifact.events.find(row => row.type === 'assistant/message' && row.surfaceOp.op === 'replace').sourceEventSeqs, [4])
  const session = openSession(result.artifact)
  assert.deepEqual(texts(session), ['角色设定', '继续故事', '已编辑正文'])
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  const replacement = session.append('assistant/message', { turn: 2, step: 1, stream: [], message: message('assistant', '升级后再编辑') }, { surfaceOp: { op: 'replace', startSeq: 6, endSeq: 6 }, sourceEventSeqs: [6] })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  const bytes = encodeCurrentGeneration({ header: session.header, inheritedEventCount: 0, events: session.snapshotEvents() }, catalog)
  const reopened = openSession(restoreSessionLog(parseSessionLog(bytes), catalog))
  assert.equal(texts(reopened).at(-1), '升级后再编辑')
  assert.equal(replacement.data.turn, 2)
  assert.equal(reopened.snapshotEvents().filter(row => row.type === 'turn/start').length, 2)
})

test('old reserved opening moves boundaries, not turns, and remaps all message references', () => {
  const old = fixture()
  // Old reserved system preceded the first live turn.
  old.events = [old.events[2], old.events[0], old.events[1], ...old.events.slice(3)].map((row, seq) => ({ ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.equal(artifact.inheritedEventCount, 0)
  assert.deepEqual(artifact.events.slice(0, 3).map(row => row.type), ['turn/start', 'step/start', 'system/message'])
  assert.deepEqual(texts(openSession(artifact)), ['角色设定', '继续故事', '已编辑正文'])
  assert.deepEqual(artifact.events.filter(row => row.type === 'turn/start').map(row => row.data.turn), [1])
})

test('user prefix before first system gains an empty protected head without losing messages', () => {
  const old = fixture()
  old.events = [old.events[3], old.events[0], old.events[1], old.events[2], ...old.events.slice(4)].map((row, seq) => ({ ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(texts(openSession(artifact)), ['角色设定', '继续故事', '已编辑正文'])
  assert.equal(artifact.events.filter(row => row.type === 'system/message').length, 2)
  assert.equal(artifact.inheritedEventCount, 0)
})

test('v0 compaction keeps archived story, summary and source boundaries', () => {
  const old = compactedLegacySession()
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(texts(openSession(artifact)), ['SUMMARY_TO_KEEP'])
  assert.match(JSON.stringify(artifact.events), /OLD_STORY_SHOULD_STAY_ARCHIVED/)
  assert.equal(artifact.events.find(row => row.type === 'compaction/summary').data.shadowedSeqs.length, 1)
})

test('disk upgrade preserves originals and Tavern data; rerun cannot overwrite newer progress', async t => {
  const directory = await root(t)
  const source = await save(directory, fixture(), false)
  const journal = path.join(directory, 'chat.json')
  const chat = JSON.stringify({ id: 'chat', sessionId: 'save', variableSnapshots: [{ turn: 1, hp: 8 }], messages: ['已编辑正文'] })
  await writeFile(journal, chat)
  const result = await migrateSessionDirectory(directory, migration)
  assert.equal(result.migrated, 1, JSON.stringify(result.failures))
  assert.deepEqual(await readFile(source.file), source.bytes)
  assert.equal(await readFile(journal, 'utf8'), chat)
  const current = await readFile(source.target)
  assert.equal(restoreSessionLog(parseSessionLog(current), catalog).header.version, 4)
  const again = await migrateSessionDirectory(directory, migration)
  assert.equal(again.unchanged, 1)
  assert.deepEqual(await readFile(source.target), current)
  assert.equal((await readdir(source.directory)).some(name => name.includes('.tmp-')), false)
  // A broken newest file must never trigger fallback to an older, valid story.
  await writeFile(source.target, 'damaged new progress')
  assert.equal((await migrateSessionDirectory(directory, migration)).migrated, 0)
  assert.equal(await readFile(source.target, 'utf8'), 'damaged new progress')
})

test('parent catalog uses actual child descriptors and retains child session IDs', async t => {
  const directory = await root(t)
  const parent = await save(directory, fixture('parent'))
  const child = fixture('child')
  child.header = { ...child.header, origin: 'subagent', parentSession: 'parent', delegationDepth: 1 }
  child.events.push({ seq: child.events.length, time: 2, type: 'subagent/descriptor', data: { version: 2, provider: 'tavern', mode: 'continuable', label: '变量后台' } })
  const childFile = await save(directory, child)
  const result = await migrateSessionDirectory(directory, migration)
  assert.equal(result.migrated, 2, JSON.stringify(result.failures))
  const artifact = restoreSessionLog(parseSessionLog(await readFile(parent.target)), catalog)
  assert.equal(artifact.events.find(row => row.type === 'subagent/catalog').data.childId, 'child')
  assert.deepEqual(await readFile(childFile.file), childFile.bytes)
  assert.equal(restoreSessionLog(parseSessionLog(await readFile(childFile.target)), catalog).header.parentSession, 'parent')
})

test('invalid references and ambiguous generations never publish a partial current file', async t => {
  const directory = await root(t)
  const bad = fixture('bad')
  bad.events[6].sourceEventSeqs = [999]
  const source = await save(directory, bad)
  const result = await migrateSessionDirectory(directory, migration)
  assert.equal(result.refused, 1)
  assert.equal(existsSync(source.target), false)
  assert.deepEqual(await readFile(source.file), source.bytes)
  await writeFile(path.join(source.directory, 'session.v3.jsonl'), 'other generation')
  assert.equal((await migrateSessionDirectory(directory, migration)).refused, 1)
  assert.equal(existsSync(source.target), false)
})

test('compressed frame boundaries may split a UTF-8 character or JSON row', () => {
  const parsed = fixture()
  const raw = Buffer.from([parsed.header, ...parsed.events].map(JSON.stringify).join('\n') + '\n')
  const cut = raw.indexOf(Buffer.from('角色')) + 1
  const bytes = Buffer.concat([zstdCompressSync(raw.subarray(0, cut)), zstdCompressSync(raw.subarray(cut))])
  assert.deepEqual(parseSessionLog(bytes), { headerLine: JSON.stringify(parsed.header), ...parsed })
  assert.throws(() => parseSessionLog(bytes.subarray(0, bytes.length - 1)))
})

test('fork edits after inherited end-seed retain the seed cut and existing play turns', () => {
  const old = fixture('fork')
  old.events = [...old.events.slice(0, 5), old.events[7], old.events[8],
    { type: 'session/end-seed', data: { inherited: true } }, old.events[5], old.events[6],
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'step/start', data: { turn: 2, step: 1 } },
    { type: 'user/message', data: message('user', '分支继续'), surfaceOp: 'append' },
    { type: 'step/end', data: { turn: 2, step: 1 } },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ time: 1, ...row, seq }))
  const { type, ...logicalHeader } = old.header
  old.header = migration.historicalSessionFormatCatalog.encodeCurrentHeader({ ...logicalHeader, isSeeded: true }, 7)
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.equal(artifact.inheritedEventCount, 7)
  assert.deepEqual(artifact.events.filter(row => row.type === 'turn/start').map(row => row.data.turn), [1, 2])
  assert.deepEqual(texts(openSession(artifact)), ['角色设定', '继续故事', '已编辑正文', '分支继续'])
  assert.deepEqual(artifact.events.slice(0, 7).map(row => row.type), old.events.slice(0, 7).map(row => row.type))
  const replacement = artifact.events.find(row => row.surfaceOp?.op === 'replace')
  assert.equal(replacement.data.turn, 2)
  assert.deepEqual(replacement.sourceEventSeqs, [4])
})

test('a last closed-turn edit gets a new administrative turn, leaving old turn IDs intact', () => {
  const old = fixture()
  old.events = [...old.events.slice(0, 5), old.events[7], old.events[8], old.events[5], old.events[6]].map((row, seq) => ({ ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(artifact.events.filter(row => row.type === 'turn/start').map(row => row.data.turn), [1, 2])
  assert.deepEqual(texts(openSession(artifact)), ['角色设定', '继续故事', '已编辑正文'])
})

test('a corrupt child blocks parent catalog publication and retains both originals', async t => {
  const directory = await root(t)
  const parent = await save(directory, fixture('parent'))
  const child = fixture('child')
  child.header = { ...child.header, origin: 'subagent', parentSession: 'parent', delegationDepth: 1 }
  child.events.push({ seq: child.events.length, time: 2, type: 'subagent/descriptor', data: { version: 2, provider: 'tavern', mode: 'continuable' } }) // missing label
  const childFile = await save(directory, child)
  const result = await migrateSessionDirectory(directory, migration)
  assert.equal(result.refused, 2)
  assert.equal(existsSync(parent.target), false)
  assert.equal(existsSync(childFile.target), false)
  assert.deepEqual(await readFile(parent.file), parent.bytes)
  assert.deepEqual(await readFile(childFile.file), childFile.bytes)
})

test('a source changed during conversion is not published and temporary files are cleaned', async t => {
  const { writeFileSync } = await import('node:fs')
  const directory = await root(t)
  const source = await save(directory, fixture())
  let changed = false
  const concurrent = { ...migration, createSessionFormatCatalogWithChildren(children) {
    const real = migration.createSessionFormatCatalogWithChildren(children)
    return { ...real, encodeCurrentEvent(event) {
      if (!changed) { changed = true; writeFileSync(source.file, Buffer.concat([source.bytes, Buffer.from('another writer')])) }
      return real.encodeCurrentEvent(event)
    } }
  } }
  const result = await migrateSessionDirectory(directory, concurrent)
  assert.equal(result.refused, 1)
  assert.match(result.failures[0].reason, /发生变化/)
  assert.equal(existsSync(source.target), false)
  assert.equal((await readdir(source.directory)).some(name => name.includes('.tmp-')), false)
})

test('turn-zero opening works even when the old save has no system message', () => {
  const old = fixture()
  old.events = [
    { type: 'user/message', data: message('user', '开场设定'), surfaceOp: 'append' },
    { type: 'assistant/message', data: { turn: 0, step: 1, stream: [], message: message('assistant', '开场正文') }, surfaceOp: 'append' },
    old.events[0], old.events[1], old.events[4], old.events[7], old.events[8],
  ].map((row, seq) => ({ time: 1, ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(texts(openSession(artifact)), ['开场设定', '开场正文', '旧正文'])
  assert.deepEqual(artifact.events.filter(row => row.type === 'turn/start').map(row => row.data.turn), [1])
})

test('a save made before generating its first turn keeps the reserved prompt', () => {
  const old = fixture()
  old.events = [old.events[2], old.events[3], { type: 'session/end-seed', data: {} }].map((row, seq) => ({ time: 1, ...row, seq }))
  assert.deepEqual(texts(openSession(prepareSessionUpgrade(old, migration).artifact)), ['角色设定', '继续故事'])
})

test('the first system prompt may arrive on a later turn', () => {
  const old = fixture()
  old.events = [old.events[0], old.events[1], old.events[4], old.events[7], old.events[8],
    { type: 'turn/start', data: { turn: 2 } }, { type: 'step/start', data: { turn: 2, step: 1 } },
    { ...old.events[2], data: { ...old.events[2].data, turn: 2 } },
    { type: 'step/end', data: { turn: 2, step: 1 } }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ time: 1, ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(texts(openSession(artifact)), ['角色设定', '旧正文'])
  assert.deepEqual(artifact.events.filter(row => row.type === 'turn/start').map(row => row.data.turn), [1, 2])
})

test('editing after step/end but before turn/end uses a new step in the same turn', () => {
  const old = fixture()
  old.events = [...old.events.slice(0, 5), old.events[7], old.events[5], old.events[6], old.events[8]].map((row, seq) => ({ ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(texts(openSession(artifact)), ['角色设定', '继续故事', '已编辑正文'])
  assert.deepEqual(artifact.events.filter(row => row.type === 'turn/start').map(row => row.data.turn), [1])
  assert.deepEqual(artifact.events.filter(row => row.type === 'step/start').map(row => row.data.step), [1, 2])
})

test('a concurrently created newer save wins over migration output', async t => {
  const { writeFileSync } = await import('node:fs')
  const directory = await root(t)
  const source = await save(directory, fixture())
  let changed = false
  const concurrent = { ...migration, createSessionFormatCatalogWithChildren(children) {
    const real = migration.createSessionFormatCatalogWithChildren(children)
    return { ...real, encodeCurrentEvent(event) {
      if (!changed) { changed = true; writeFileSync(source.target, 'new user progress') }
      return real.encodeCurrentEvent(event)
    } }
  } }
  const result = await migrateSessionDirectory(directory, concurrent)
  assert.equal(result.refused, 1)
  assert.equal(await readFile(source.target, 'utf8'), 'new user progress')
  assert.deepEqual(await readFile(source.file), source.bytes)
  assert.equal((await readdir(source.directory)).some(name => name.includes('.tmp-')), false)
})

test('saved story anchors and pending undo counts resolve through the durable coordinate map', async () => {
  const { resolveSessionRoundAnchor, roundAnchor } = await import('../tavern-plugin/lib/domain/round-anchor.js')
  const { locateRegenerationSurface, locateRollbackSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const { unchangedSinceRollback } = await import('../tavern-plugin/lib/domain/surface-restoration.js')
  const { upgradeReferences } = await import('../tavern-plugin/lib/domain/session-upgrade-references.js')
  const old = fixture()
  old.events = [old.events[3], old.events[0], old.events[1], old.events[2], old.events[4], old.events[7], old.events[8], old.events[5], old.events[6]].map((row, seq) => ({ ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  const session = openSession(artifact)
  const references = upgradeReferences(artifact.events)
  const oldAnchor = { turn: 1, input: 0, reply: 4 }
  const located = resolveSessionRoundAnchor(session, oldAnchor)
  assert.equal(artifact.events[located.input].data.id, 'user-继续故事')
  assert.equal(artifact.events[located.reply].data.message.id, 'assistant-已编辑正文')
  const regenerated = locateRegenerationSurface({ events: artifact.events, nodes: session.surface.nodes, turn: 1 })
  assert.equal(regenerated.assistantSeq, located.reply)
  assert.equal(locateRollbackSurface({ events: artifact.events, nodes: session.surface.nodes, anchor: oldAnchor }).turn, 1)
  assert.equal(unchangedSinceRollback(session, old.events.length, 3), true)
  assert.notEqual(references.sequence(0, 3), 0)
  // Newly written anchors use native v4 coordinates, even when the number also
  // happens to name a different source event in the migration map.
  const current = roundAnchor(1, artifact.events[located.input], artifact.events[located.reply])
  assert.deepEqual(resolveSessionRoundAnchor(session, current), located)
  assert.equal(unchangedSinceRollback(session, session.snapshotEvents().length, 4), true)
  const cold = openSession(restoreSessionLog(parseSessionLog(encodeCurrentGeneration(artifact, catalog)), catalog))
  assert.deepEqual(resolveSessionRoundAnchor(cold, oldAnchor), located)
})

test('background rewind interprets an old boundary in upgraded coordinates', async () => {
  const { rewindBackgroundSurface } = await import('../tavern-plugin/lib/domain/background-surface.js')
  const old = fixture()
  old.events = [old.events[3], old.events[0], old.events[1], old.events[2], ...old.events.slice(4)].map((row, seq) => ({ ...row, seq }))
  const artifact = prepareSessionUpgrade(old, migration).artifact
  const session = openSession(artifact)
  rewindBackgroundSurface(session, 0, undefined, 3) // keep the original user's input
  assert.ok(texts(session).includes('继续故事'))
  assert.ok(!texts(session).includes('已编辑正文'))
  const reopened = restoreSessionLog(parseSessionLog(encodeCurrentGeneration({ header: session.header, events: session.snapshotEvents(), inheritedEventCount: 0 }, catalog)), catalog)
  assert.ok(texts(openSession(reopened)).includes('继续故事'))
})

test('undo restoration preserves copied tool results without inventing an execution', () => {
  const old = fixture('restored-tool')
  old.events = old.events.slice(0, 4)
  const add = (type, data, extra = {}) => old.events.push({ seq: old.events.length, time: 1, type, data: structuredClone(data), ...extra })
  const assistant = message('assistant', '工具调用正文')
  assistant.content.push({ type: 'tool-call', id: 'call-restore', name: 'lookup', arguments: '{}' })
  add('assistant/message', { turn: 1, step: 1, stream: [], message: assistant }, { surfaceOp: 'append' })
  add('tool/call', { turn: 1, step: 1, callId: 'call-restore', name: 'lookup', arguments: '{}' })
  const result = { turn: 1, step: 1, message: { id: 'tool-result', role: 'user', source: { kind: 'tool', callId: 'call-restore' }, content: [{ type: 'tool-result', toolCallId: 'call-restore', content: [{ type: 'text', text: '历史工具结果' }] }] } }
  add('tool/result', result, { surfaceOp: 'append', sourceEventSeqs: [5] })
  add('step/end', { turn: 1, step: 1 }); add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  add('assistant/message', { turn: 1, step: 1, stream: [], message: message('assistant', '') }, { surfaceOp: { op: 'replace', startSeq: 4, endSeq: 6 }, sourceEventSeqs: [4, 6] })
  add('assistant/message', { turn: 1, step: 1, stream: [], message: assistant, tavernRestoredSurfaceSeqs: [9] }, { surfaceOp: { op: 'replace', startSeq: 9, endSeq: 9 }, sourceEventSeqs: [9, 4] })
  const empty = structuredClone(result); empty.message.content[0].content = []
  add('tool/result', empty, { surfaceOp: 'append' })
  add('tool/result', result, { surfaceOp: { op: 'replace', startSeq: 11, endSeq: 11 }, sourceEventSeqs: [11, 6] })
  const upgraded = prepareSessionUpgrade(old, migration).artifact
  assert.ok(texts(openSession(upgraded)).includes('历史工具结果'))
  assert.equal(upgraded.events.filter(e => e.type === 'tool/result').length, 3)
  const copied = upgraded.events.find(e => e.type === 'tool/call' && e.data.tavernRestoredCallSeq !== undefined)
  assert.equal(copied.data.callId, 'call-restore')
  assert.equal(upgraded.events[copied.data.tavernRestoredCallSeq].type, 'tool/call')
  assert.deepEqual(upgraded.events.at(-1).data.repairHistory, old.events)
  const missingCall = structuredClone(old)
  delete missingCall.events[6].sourceEventSeqs
  assert.throws(() => prepareSessionUpgrade(missingCall, migration), /无法证明旧工具记录/)
  const modifiedCopy = structuredClone(old)
  modifiedCopy.events[12].data.message.content[0].content[0].text = '篡改过的结果'
  assert.throws(() => prepareSessionUpgrade(modifiedCopy, migration), /无法证明旧工具记录/)

})

test('legacy compaction of a late system prompt preserves history and the effective context', () => {
  const old = fixture('compact-late-system')
  old.events = [
    { type: 'user/message', data: message('user', '旧设定'), surfaceOp: 'append' },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'system/message', data: { turn: 1, step: 1, message: message('system', '已压缩的系统提示词') }, surfaceOp: 'append' },
    { type: 'assistant/message', data: { turn: 1, step: 1, stream: [], message: message('assistant', '历史正文') }, surfaceOp: 'append' },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'compaction/start', data: { compactionId: 'compact-old', turn: null } },
    { type: 'compaction/summary', data: { compactionId: 'compact-old', summary: [{ type: 'text', text: '完整旧摘要' }], shadowedRange: { start: 0, end: 4 }, shadowedSeqs: [0, 3, 4], shadowedTokenCount: 100, provider: 'fixture', model: 'fixture' } },
    { type: 'user/message', data: { ...message('user', '完整旧摘要'), source: { kind: 'plugin', plugin: 'compact', compactionId: 'compact-old' } }, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 4 }, sourceEventSeqs: [0, 3, 4, 7, 8] },
    { type: 'compaction/end', data: { compactionId: 'compact-old', turn: null } },
  ].map((event, seq) => ({ seq, time: 1, ...event }))
  const upgraded = prepareSessionUpgrade(old, migration).artifact
  assert.deepEqual(texts(openSession(upgraded)), ['完整旧摘要'])
  assert.ok(upgraded.events.some(e => e.data?.message?.content?.[0]?.text === '历史正文'))
  assert.ok(upgraded.events.some(e => e.data?.message?.content?.[0]?.text === '已压缩的系统提示词'))
  assert.deepEqual(upgraded.events.at(-1).data.repairHistory, old.events)
  const broken = structuredClone(old)
  broken.events[8].data.shadowedSeqs = [0, 3]
  assert.throws(() => prepareSessionUpgrade(broken, migration), /旧压缩范围本身不完整/)
})
