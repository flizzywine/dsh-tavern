import './host-session-patch-preload.mjs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Session } from './dsh-session-host.mjs'
import { createRoundHistory } from '../../tavern-plugin/lib/domain/round-history.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { appendSessionEvent, sessionEvents } from '../../tavern-plugin/lib/domain/session-events.js'

const [root, legacy] = process.argv.slice(2)
const committed = legacy.startsWith('committed-')
async function saveSession(current) {
  await writeFile(join(root, 'session.json'), JSON.stringify({ id: current.id, header: current.header, events: sessionEvents(current) }))
}
async function crashPoint() { process.send({ ready: true }); await new Promise(() => {}) }
const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
const session = Session.create('crash-session')
appendSessionEvent(session, 'user/message', { id: 'original-user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'original-assistant', role: 'assistant', content: [{ type: 'text', text: '原正文' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
await persistence.write({ id: 'chat', sessionId: session.id, mode: 'story', messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 2, text: '原正文', variables: [{ hp: 9 }] }], posture: '原状态', settleStatus: 'done' })
const agent = { session, phase: { kind: 'idle', lastTurn: 2 }, followup(message) {
  this.input = message
  this.phase.kind = 'running'
  appendSessionEvent(session, 'user/message', { ...message, turn: 3 }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 3, step: 1, message: { id: 'partial-assistant', role: 'assistant', content: [{ type: 'text', text: '未完成的新正文' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
}, async whenIdle() {
  if (committed) {
    await persistence.update('chat', chat => { chat.messages.push({role:'user',text:this.input.content[0].text},{role:'assistant',turn:3,text:'未完成的新正文'});return chat })
    this.phase = {kind:'idle',lastTurn:3}
    return
  }
  if (legacy === 'true') await persistence.update('chat', chat => { delete chat.regenRecovery; return chat }, { source: 'fixture.legacy' })
  await writeFile(join(root, 'session.json'), JSON.stringify({ id: session.id, header: session.header, events: sessionEvents(session) }))
  process.send({ ready: true })
  await new Promise(() => {})
} }
await createRoundHistory({
  chats: { ...persistence, update: async (...args) => {
    const result = await persistence.update(...args)
    if (committed && args[2]?.source === 'foreground.regen-commit' && legacy === 'committed-before') await crashPoint()
    return result
  }, forSession: () => persistence.read('chat'), readCard: async () => ({}) },
  sessions: { get: () => agent, flush: async current => {
    await saveSession(current)
    if (legacy === 'committed-after' && (await persistence.read('chat')).regenRecovery?.phase === 'committed') await crashPoint()
  } }, scripts: {}, timeline: createStoryTimeline(),
  // The regeneration request is prepared from the live fixture, never replayed
  // from the old body's frame. Preview owns no story rows.
  prepareRegenerationFrame: async input => ({
    ready: true, mode: 'story', cardName: 'fixture', userText: input.userText,
    frame: { kind: 'foreground', frameId: 'fixture-preview', chatId: 'chat', branchId: 'branch',
      basedOnRevision: 0, operationId: 'preview', turn: input.turn,
      userInput: { sourceText: input.userText, projectedText: input.userText, source: { stage: 'player-input' } },
      contributions: [{ slot: 'writingRules', text: 'fixture 当前规则', source: { stage: 'fixture' } }],
      source: {}, diagnostics: [], ignored: [] }
  }),
  queueSettlement: async () => { throw new Error('must not settle') }, present: async chat => chat
}).regenerate('chat', '', session.id)
