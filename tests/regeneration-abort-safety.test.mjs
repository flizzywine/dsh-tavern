import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { createRegenerationRecovery } from '../tavern-plugin/lib/domain/regeneration-recovery.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

function fixture({ ended = true } = {}) {
 const session=Session.create('regen-safety')
 const user=(id,source={kind:'user'},content=[{type:'text',text:id}])=>appendSessionEvent(session,'user/message',{id,role:'user',content,source},{surfaceOp:'append'})
 user('original-input')
 const frame=user('frame',{kind:'plugin',plugin:'dsh-tavern',form:'foreground-frame'})
 const body=appendSessionEvent(session,'assistant/message',{turn:1,step:1,message:{id:'body',role:'assistant',content:[{type:'text',text:'original-body'}],source:{kind:'model',provider:'fixture',model:'fixture'}}},{surfaceOp:'append'})
 const eventStart=sessionEvents(session).length
 appendSessionEvent(session,'turn/start',{turn:2})
 const retired=replaceSessionSurface(session,'user/message',{id:'retired',role:'user',content:[],source:{kind:'plugin',plugin:'dsh-tavern',form:'foreground-frame'}},{start:frame.seq,end:frame.seq,sourceEventSeqs:[frame.seq]})
 const attempt=user('attempt',{kind:'plugin',plugin:'dsh-tavern-regen'})
 if (ended) appendSessionEvent(session,'turn/end',{turn:2,reason:{kind:'error',error:{message:'Provider stopped with: SAFETY'}}})
 const cleaned=replaceSessionSurface(session,'user/message',{id:'failed',role:'user',content:[],source:{kind:'plugin',plugin:'dsh-tavern-failed-turn-cleanup'}},{start:attempt.seq,end:attempt.seq,sourceEventSeqs:[attempt.seq]})
 return {session,eventStart,body,frame,retired,cleaned,user}
}

// Native cancellation can finish before the host writes turn/end.

test('重新生成卡住时被拒绝的发送（失败回合）不会让恢复永远失败', async t => {
  const root = await mkdtemp(join(tmpdir(), 'regen-rejected-')); t.after(() => rm(root, { recursive: true, force: true }))
  const chats = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const before = await chats.write({ id: 'chat', messages: [{ role: 'user', text: 'input' }, { role: 'assistant', text: 'original-body' }] })
  await chats.update('chat', c => ({ ...c, regenInProgress: true, regenRecovery: { id: 'op', candidateTurn: 2, candidateFrame: { kind: 'foreground' } } }))
  const f = fixture()
  // The player sent while the marker was set: prepareStep rejected it and its turn failed.
  appendSessionEvent(f.session, 'turn/start', { turn: 3 })
  f.user('rejected')
  appendSessionEvent(f.session, 'turn/end', { turn: 3, reason: { kind: 'error', error: { message: '上一次正文重新生成尚未完成' } } })
  const recovery = createRegenerationRecovery({ chats, timeline: createStoryTimeline(), isActive: () => false, sessions: {} })
  await recovery.abort({ chatId: 'chat', originalChat: before, session: f.session, eventStart: f.eventStart, operationId: 'op' })
  const restored = await chats.read('chat')
  assert.equal(restored.regenInProgress, undefined)
  assert.deepEqual(restored.messages.map(message => message.text), ['input', 'original-body'])
})
