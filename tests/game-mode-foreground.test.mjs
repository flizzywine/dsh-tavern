import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { projectGameModeForeground, GAME_FOREGROUND_PREFIX } from '../tavern-plugin/lib/domain/game-mode-foreground.js'
import { createPluginGameModes } from '../tavern-plugin/lib/domain/plugin-game-mode.js'
import { planTranscriptRows, planShowsRow } from '../tavern-plugin/lib/domain/transcript-row-plan.js'
import { nativeStoryTurns } from '../tavern-plugin/lib/domain/story-alignment.js'
import { planNativeSurfaceRepair } from '../tavern-plugin/lib/domain/native-surface-repair.js'
import { nativeOpeningMessageId } from '../tavern-plugin/lib/domain/native-opening.js'

test('native foreground projects, retries and rewinds without retaining future text on the surface', () => {
  const id = 'game-foreground-test'
  const session = Session.create(id, undefined, { id, version: 4, createdAt: 0, isSeeded: false, delegationDepth: 0 })
  const show = text => projectGameModeForeground(session, { key: 'test:game', text })
  assert.equal(show('DM · 身份已分配'), true)
  const count = session.snapshotEvents().length
  assert.equal(show('DM · 身份已分配'), false)
  assert.equal(session.snapshotEvents().length, count)
  show('DM · 身份已分配\n天亮了。3号出局。')
  show('DM · 身份已分配')
  const messages = session.deriveMessages().filter(m => m.id.startsWith(GAME_FOREGROUND_PREFIX))
  assert.equal(messages.length, 1)
  assert.equal(messages[0].content[0].text, 'DM · 身份已分配')
  assert.equal(session.snapshotEvents().filter(e => e.type === 'turn/start').length,
    session.snapshotEvents().filter(e => e.type === 'turn/end').length)
})

test('failed native projection recovers from committed mode without repeating agents', async () => {
  let doc, fail = true, calls = 0
  const projections = []
  const modes = createPluginGameModes({ read: async () => doc, write: async (_, expected, next) => { doc = next },
    allowed: async () => {}, runAgent: async () => { calls++; return { text: 'reply' } },
    foreground: async (_, projection) => { if (fail) throw new Error('flush failed'); projections.push(projection.text) },
  })
  modes.register('test', { name: 'game', version: 1, create: () => ({ state: { count: 0, secret: 'private' } }),
    advance: async ({ state, agent }) => { await agent({ id: 'npc', system: 'role', prompt: 'speak' }); return { state: { ...state, count: state.count + 1 } } },
    project: ({ state }) => ({ count: state.count }),
    foreground: ({ data }) => { assert.equal(data.secret, undefined); return 'DM ' + data.count },
  })
  await assert.rejects(modes.execute('g', { op: 'create', key: 'test:game' }), /flush failed/)
  assert.equal(doc.revision, 1)
  fail = false
  assert.equal((await modes.view('g')).foreground, true)
  await modes.execute('g', { op: 'advance', revision: 1, actionId: 'one' })
  await modes.execute('g', { op: 'advance', revision: 1, actionId: 'one' })
  assert.equal(calls, 1)
  await modes.execute('g', { op: 'seek', revision: 2, cursor: 0 })
  assert.equal(projections.at(-1), 'DM 0')
})

test('game foreground stays visible outside story floors and survives story repair', () => {
  const id = 'game-visible-test'
  const session = Session.create(id, undefined, { id, version: 4, createdAt: 0, isSeeded: false, delegationDepth: 0 })
  const show = text => projectGameModeForeground(session, { key: 'test:game', text })
  show('身份已分配')
  show('天亮了')
  const events = session.snapshotEvents()
  const plan = planTranscriptRows({ chat: { messages: [] }, events })
  const visible = events.filter(e => e.type === 'assistant/message' && e.surfaceOp === 'append'
    && planShowsRow(plan, { turn: e.data.turn, kind: 'assistant-step' }))
  assert.deepEqual(visible.map(e => e.data.message.content[0].text), ['天亮了'])
  assert.deepEqual(nativeStoryTurns(session), [])
  const greeting = { seq: -1, type: 'assistant/message', data: { message: { id: nativeOpeningMessageId(id), content: [{ type: 'text', text: '开场' }] } } }
  const repair = planNativeSurfaceRepair({ chat: { id, messages: [{ role: 'assistant', greeting: true, text: '开场' }] },
    events: [greeting, ...events], nodes: [-1, ...session.surface.nodes] })
  assert.equal(repair.status, 'intact')
})
