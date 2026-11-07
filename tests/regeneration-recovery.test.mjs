import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

for (const legacy of [false, true]) test('SIGKILL 后保持原正文已删除并仅清理候选：legacy=' + legacy, { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-regen-crash-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/regeneration-crash.mjs', import.meta.url)), root, String(legacy)], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let errors = ''
  child.stderr.on('data', data => { errors += data })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  const [ready] = await Promise.race([once(child, 'message'), once(child, 'exit').then(([code]) => { throw new Error('child exited: ' + code + ' ' + errors) })])
  assert.equal(ready.ready, true)
  const stopped = once(child, 'exit')
  child.kill('SIGKILL')
  await stopped
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const interrupted = await persistence.read('chat')
  assert.equal(interrupted.regenInProgress, true)
  assert.deepEqual(interrupted.messages.map(message => message.text), ['继续', ''], '崩溃时旧正文已撤成空占位')
  assert.equal(interrupted.posture, '原状态')
  const stored = JSON.parse(await readFile(join(root, 'session.json'), 'utf8'))
  const session = Session.create(stored.id, stored.events, stored.header)
  let disposed = 0
  const history = createRoundHistory({
    chats: persistence, scripts: {}, timeline: createStoryTimeline(),
    sessions: { get: () => undefined, resume: async () => ({ agent: { session, phase: { kind: 'idle' } }, dispose: async () => { disposed++ } }),
      flush: async current => writeFile(join(root, 'session.json'), JSON.stringify({ id: current.id, header: current.header, events: sessionEvents(current) })) }
  })
  await history.recover('chat')
  assert.equal(disposed, 1)
  const reopened = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const restored = await reopened.read('chat')
  assert.deepEqual(restored.messages.map(message => message.text), ['继续'])
  assert.deepEqual(restored.failedRegenerationTarget.assistant.variables, [{ hp: 9 }])
  assert.equal(restored.posture, '原状态')
  assert.ok(!restored.regenInProgress)
  assert.equal(restored.regenRecovery, undefined)
  assert.deepEqual(restored.suppressedDshTurns, [3])
  assert.deepEqual(restored.replacingDshTurns, [2])
  const saved = JSON.parse(await readFile(join(root, 'session.json'), 'utf8'))
  const native = Session.create(saved.id, saved.events, saved.header)
  const visible = JSON.stringify(native.deriveMessages())
  assert.match(visible, /原正文/)
  assert.doesNotMatch(visible, /未完成的新正文/)
  assert.deepEqual(saved.events.slice(0, stored.events.length), stored.events)
  await history.recover('chat')
  assert.equal((await reopened.read('chat'))._storageRevision, restored._storageRevision)
})

for (const stage of ['committed-before', 'committed-after']) test('SIGKILL after Chat commit completes native projection: ' + stage, {timeout:15000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-regen-commit-crash-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/regeneration-crash.mjs', import.meta.url)), root, stage], {stdio:['ignore','ignore','pipe','ipc']})
  let errors = ''
  child.stderr.on('data', data => { errors += data })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  await Promise.race([once(child, 'message'), once(child,'exit').then(([code]) => {throw Error('child exited '+code+' '+errors)})])
  const stopped=once(child,'exit');child.kill('SIGKILL');await stopped
  const chats = createChatPersistence({store:createChatJournalStore({dataRoot:root})})
  assert.equal((await chats.read('chat')).regenRecovery.phase,'committed')
  const stored=JSON.parse(await readFile(join(root,'session.json'),'utf8'))
  const session=Session.create(stored.id,stored.events,stored.header)
  const history=createRoundHistory({chats,scripts:{},timeline:createStoryTimeline(),sessions:{get:()=>({session,phase:{kind:'idle'}}),flush:async current=>writeFile(join(root,'session.json'),JSON.stringify({id:current.id,header:current.header,events:sessionEvents(current)}))}})
  await history.recover('chat')
  const restored=await chats.read('chat')
  assert.equal(restored.messages.at(-1).text,'未完成的新正文')
  assert.equal(restored.regenRecovery,undefined)
  assert.equal(restored.regenInProgress,undefined)
  const saved=JSON.parse(await readFile(join(root,'session.json'),'utf8'))
  const native=Session.create(saved.id,saved.events,saved.header)
  const text=JSON.stringify(native.deriveMessages())
  assert.match(text,/未完成的新正文/)
  assert.doesNotMatch(text,/"text":"原正文"/)
  const count=sessionEvents(session).length
  await history.recover('chat')
  assert.equal(sessionEvents(session).length,count)
})
