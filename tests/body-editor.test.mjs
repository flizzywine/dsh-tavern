import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBodyEditor, synchronizeBodyEdits } from '../tavern-plugin/lib/domain/body-editor.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'

function fixture(text = '原正文', seeded = false) {
  let session = Session.create('body-edit-test')
  appendSessionEvent(session, 'user/message', { id: 'user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'reply', role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'fixture', model: 'fixture' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  if (seeded) session = Session.create(session.id, sessionEvents(session), { ...session.header, isSeeded: true }, session.seq)
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, messages: [{ role: 'user', text: '继续' }, { role: 'assistant', turn: 2, text, sourceText: text, swipes: [text], swipeId: 0, variables: [{ hp: 9 }] }], settleStatus: 'done', posture: '原状态', scriptState: { cursor: 5 }, variables: { hp: 9 } }
  const agent = { get session() { return session }, phase: { kind: 'idle', lastTurn: 2 } }
  let busy = false, failWrite = false, failFlush = false
  const options = {
    chats: { forSession: async () => structuredClone(chat), update: async (_id, fn) => { if (failWrite) throw Error('write failed'); chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => agent, flush: async () => { if (failFlush) throw Error('flush failed') } },
    timeline: createStoryTimeline(), activity: () => ({ busy }), project: async text => projectReplyLayers(text), present: async chat => chat
  }
  return { editor: createBodyEditor(options), get chat() { return chat }, get session() { return session }, agent, options,
    busy(value) { busy = value }, failWrite(value) { failWrite = value }, failFlush(value) { failFlush = value },
    restore(events = sessionEvents(session)) { session = Session.create(session.id, events, session.header) },
    change(fn) { fn(chat) } }
}

test('stale tabs, blank text, new HTML, running turns and HTML-only replies reject without writes', async () => {
  const h = fixture(), edit = await h.editor.read(h.session.id), original = structuredClone(h.chat)
  for (const input of [{ token: 'stale', texts: ['新'] }, { token: edit.token, texts: [''] }, { token: edit.token, texts: ['<div>注入</div>'] }, { token: edit.token, texts: [] }]) await assert.rejects(h.editor.save(h.session.id, input))
  h.busy(true); await assert.rejects(h.editor.save(h.session.id, { token: edit.token, texts: ['新'] }), /等待/); h.busy(false)
  h.agent.phase.kind = 'running'; await assert.rejects(h.editor.read(h.session.id), /等待/)
  assert.deepEqual(h.chat, original)
  const html = fixture('<div>纯 HTML</div>'); await assert.rejects(html.editor.read(html.session.id), /没有可编辑文本/)
})

test('peek reads the last reply\'s text while settlement runs, the same text read gives once idle', async () => {
  const h = fixture('第一段\n\n第二段')
  h.change(chat => { chat.settleStatus = 'running' }); h.busy(true)
  await assert.rejects(h.editor.read(h.session.id), /等待/)
  const peeked = await h.editor.peek(h.session.id)
  h.change(chat => { chat.settleStatus = 'done' }); h.busy(false)
  assert.deepEqual(peeked, (await h.editor.read(h.session.id)).parts.filter(part => part.kind === 'text').map(part => part.text))
})

test('editing provider-final prose preserves its pipeline marker and bypasses host regexes', async () => {
  const h = fixture('原正文')
  h.change(chat => { chat.messages.at(-1).bodyRegenerationProcessed = true })
  const editor = createBodyEditor({ ...h.options, project: () => assert.fail('final plugin text must not enter host regexes') })
  const edit = await editor.read(h.session.id)
  await editor.save(h.session.id, { token: edit.token, texts: ['改写 {{user}} {{setvar::x::changed}}'] })
  const row = h.chat.messages.at(-1)
  assert.equal(row.bodyRegenerationProcessed, true)
  assert.equal(row.text, row.projectionText)
  assert.equal(row.displayText, row.text)
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, row.text)
})

test('issue #72: stale bodyEdit after migration clears instead of blocking turns', async () => {
  const h = fixture('原正文')
  h.change(chat => {
    chat.messages.at(-1).text = '已编辑正文'
    chat.messages.at(-1).bodyEdit = { id: 'tavern-body-edit:gone', seq: 99999, turn: 999 }
  })
  const cleared = []
  await synchronizeBodyEdits(h.session, h.chat, h.options.sessions.flush, async (_chat, ids) => { cleared.push(...ids) })
  assert.deepEqual(cleared, ['tavern-body-edit:gone'])
  assert.equal(h.chat.messages.at(-1).bodyEdit, undefined)
  assert.equal(h.session.deriveMessages().at(-1).content[0].text, '原正文')
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createBoundedHistory } from '../tavern-plugin/lib/domain/bounded-history.js'

// The same edit through a bounded history (patch of the last floor) and through
// the complete Chat update must store the same Chat and native surface.
async function nativeEditor(t, bounded) {
  const root = await mkdtemp(join(tmpdir(), 'body-edit-native-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const p = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const session = Session.create('body-edit-native')
  const messages = []
  for (let turn = 1; turn <= 60; turn++) {
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '正文' + turn }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    messages.push({ role: 'user', text: '行动' + turn }, { role: 'assistant', turn, text: '正文' + turn, sourceText: '正文' + turn, swipes: ['正文' + turn], swipeId: 0, variables: [{ hp: turn }], displayRuntime: { frames: [] } })
  }
  const timeline = createStoryTimeline({ id: prefix => prefix + '-fixed', now: () => 5 })
  const chat = timeline.apply({ chat: { id: 'chat', sessionId: session.id, mode: 'story', backgroundConfigVersion: 1, conversationFeaturesVersion: 1, settleStatus: 'done', messages }, intent: { kind: 'ensure' } }).chat
  await p.write(chat, { source: 'create' })
  const history = createBoundedHistory({ links: async () => ({ [session.id]: 'chat' }), readWindow: p.readWindow, pageSize: 8 })
  const calls = []
  const hooks = {}
  const agent = { session, phase: { kind: 'idle' } }
  const editor = createBodyEditor({
    chats: { forSession: async id => bounded ? (await history.forSession(id, { lastAssistant: true })).chat : p.read('chat'),
      update: async (...args) => { calls.push('update'); return p.update(...args) }, patch: async (...args) => { calls.push('patch'); await hooks.beforePatch?.(); hooks.beforePatch = null; return p.patch(...args) } },
    sessions: { get: () => agent, flush: async () => {} }, timeline, activity: () => ({ busy: false }), project: async text => projectReplyLayers(text), present: async chat => chat })
  return { p, editor, session, calls, hooks }
}

test('bounded body edit patches only the last floor and stores the same Chat as the complete update', async t => {
  const results = []
  for (const bounded of [true, false]) {
    const h = await nativeEditor(t, bounded)
    const edit = await h.editor.read(h.session.id)
    await h.editor.save(h.session.id, { token: edit.token, texts: ['改写后的第六十轮'] })
    const stored = await h.p.read('chat')
    const id = stored.messages.at(-1).bodyEdit.id
    results.push({ calls: h.calls, stored: JSON.parse(JSON.stringify({ ...stored, updatedAt: 0 }).replaceAll(id, 'EDIT')),
      surface: h.session.deriveMessages().at(-1).content[0].text })
  }
  assert.deepEqual(results[0].calls, ['patch'])
  assert.deepEqual(results[1].calls, ['update'])
  assert.deepEqual(results[0].stored, results[1].stored)
  assert.equal(results[0].surface, '改写后的第六十轮')
  assert.equal(results[0].stored.messages.at(-1).displayRuntime, undefined)
  assert.equal(results[0].stored.messages.length, 120)
})

test('插件整段替换正文：HTML 块必须原样保留，只改文字', async () => {
  const block = '```html\n<div class="status">体力 9</div>\n```'
  const h = fixture('雨停了。\n\n' + block)
  const original = structuredClone(h.chat)
  await assert.rejects(h.editor.replaceText(h.session.id, '雨停了。\n\n```html\n<div class="status">体力 1</div>\n```'), /HTML 块要保持原样/)
  await assert.rejects(h.editor.replaceText(h.session.id, '雨停了。'), /HTML 块要保持原样/)
  await assert.rejects(h.editor.replaceText(h.session.id, '雨停了。\n\n' + block + '\n\n多出来的一段。'), /不能在 HTML 块之间新增段落/)
  assert.deepEqual(h.chat, original)
  await h.editor.replaceText(h.session.id, '雨停了，灯亮了。\n\n' + block)
  assert.equal(h.chat.messages[1].sourceText, '雨停了，灯亮了。\n\n' + block)
})

 test('分页正文缺失原生楼层时，保存成功后继续修复正确的会话', async () => {
  const { createScopedMessages } = await import('../tavern-plugin/lib/domain/scoped-messages.js')
  const { applyJsonChanges } = await import('../tavern-plugin/lib/domain/json-mutation.js')
let chat={id:'c',sessionId:'session-1',mode:'story',_storageRevision:1,settleStatus:'done',messages:[{role:'user',text:'continue'},{role:'assistant',turn:1,text:'original',sourceText:'original'}]}
const session={id:'session-1',events:[],surface:{nodes:[]}},agent={session,phase:{kind:'idle'}}
let patched=false,repairs=0
const editor=createBodyEditor({chats:{forSession:async()=>({...structuredClone(chat),messages:createScopedMessages(2,[[1,structuredClone(chat.messages[1])]])}),async patch(id,rev,changes){patched=true;chat=applyJsonChanges(chat,changes);return structuredClone(chat)}},sessions:{get:()=>agent,flush:async()=>{}},timeline:createStoryTimeline(),activity:()=>({busy:false}),project:async text=>({sessionText:text,displayText:text}),present:async c=>c,repairNative:async id=>{assert.equal(id, session.id);repairs++;return null}})
const edit=await editor.read(session.id)
const saved = await editor.save(session.id,{token:edit.token,texts:['edited']})
assert.equal(saved.messages[1].text, 'edited')
assert.equal(patched, true)
assert.equal(repairs, 3)
})

 test('分页正文缺失原生楼层时，保存成功后继续修复正确的会话', async () => {
  const { createScopedMessages } = await import('../tavern-plugin/lib/domain/scoped-messages.js')
  const { applyJsonChanges } = await import('../tavern-plugin/lib/domain/json-mutation.js')
let chat={id:'c',sessionId:'session-1',mode:'story',_storageRevision:1,settleStatus:'done',messages:[{role:'user',text:'continue'},{role:'assistant',turn:1,text:'original',sourceText:'original'}]}
const session={id:'session-1',events:[],surface:{nodes:[]}},agent={session,phase:{kind:'idle'}}
let patched=false,repairs=0
const editor=createBodyEditor({chats:{forSession:async()=>({...structuredClone(chat),messages:createScopedMessages(2,[[1,structuredClone(chat.messages[1])]])}),async patch(id,rev,changes){patched=true;chat=applyJsonChanges(chat,changes);return structuredClone(chat)}},sessions:{get:()=>agent,flush:async()=>{}},timeline:createStoryTimeline(),activity:()=>({busy:false}),project:async text=>({sessionText:text,displayText:text}),present:async c=>c,repairNative:async id=>{assert.equal(id, session.id);repairs++;return null}})
const edit=await editor.read(session.id)
const saved = await editor.save(session.id,{token:edit.token,texts:['edited']})
assert.equal(saved.messages[1].text, 'edited')
assert.equal(patched, true)
assert.equal(repairs, 3)
})

test('编辑不再取消旧预备任务，仍遵守后台忙碌保护', async () => {
  const h = fixture()
  const editor = createBodyEditor({ ...h.options, cancelPreparation: async () => assert.fail('retired callback') })
  h.busy(true)
  await assert.rejects(editor.read(h.session.id), /等待/)
  h.busy(false)
  const edit = await editor.read(h.session.id)
  await editor.save(h.session.id, { token: edit.token, texts: ['改过的正文'] })
  assert.equal(h.chat.messages[1].text, '改过的正文')
})

test('编辑正文写入模型上下文的替换带剧情轮次：重新生成过的轮次核对时不会算成别的轮', async () => {
  const h = fixture()
  const edit = await h.editor.read(h.session.id)
  await h.editor.save(h.session.id, { token: edit.token, texts: ['改过的正文'] })
  const replaced = sessionEvents(h.session).findLast(event => event.type === 'assistant/message')
  assert.equal(replaced.data.message.source.model, 'body-edit')
  assert.equal(replaced.data.message.source.tavernStoryTurn, 2)
})

// 故事列表按 chat.messages 的位置编辑：目标行由 messageIndex 给出，turn 缺失、
// 重复或非单调都不参与定位；只有原生尾部且正文一致时才就地改写模型上下文。
function storyFixture(withNative = true) {
  let session = Session.create('body-edit-story')
  const append = (turn, text) => {
    appendSessionEvent(session, 'turn/start', { turn })
    appendSessionEvent(session, 'user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  }
  append(2, '第二轮正文')
  append(5, '第五轮正文')
  let chat = { id: 'chat', sessionId: session.id, mode: 'story', _storageRevision: 1, settleStatus: 'done', messages: [
    { role: 'assistant', greeting: true, turn: 1, text: '开场正文', sourceText: '开场正文' },
    { role: 'user', text: '行动一' },
    { role: 'assistant', turn: 2, text: '第二轮正文', sourceText: '第二轮正文', swipes: ['第二轮正文'], swipeId: 0 },
    { role: 'user', text: '行动二' },
    { role: 'assistant', turn: 5, text: '第五轮正文', sourceText: '第五轮正文' },
    { role: 'assistant', turn: 2, text: '重复回合正文', sourceText: '重复回合正文' }
  ] }
  const agent = { get session() { return session }, phase: { kind: 'idle' } }
  const repairs = []
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat),
      update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => withNative ? agent : undefined, flush: async () => {} },
    timeline: createStoryTimeline(), activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text), present: async value => value,
    repairNative: async id => { repairs.push(id); return null }
  })
  return { editor, session, get chat() { return chat }, repairs, setMessages(rows) { chat = { ...chat, messages: rows } },
    surface(turn) { return sessionEvents(session).findLast(event => event.type === 'assistant/message' && Number(event.data?.turn) === Number(turn))?.data.message.content[0].text } }
}

test('故事直选：messageIndex 定位助手行，中间行只改存档并交给原生修复', async () => {
  const h = storyFixture()
  const edit = await h.editor.read(h.session.id, { messageIndex: 2, revision: 1 })
  assert.equal(edit.messageIndex, 2)
  assert.equal(edit.revision, 1)
  assert.equal(edit.role, 'assistant')
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '第二轮正文' }])
  const saved = await h.editor.save(h.session.id, { token: edit.token, messageIndex: 2, revision: 1, role: 'assistant', texts: ['改写第二轮'] })
  assert.equal(saved.messages[2].text, '改写第二轮')
  assert.equal(saved.messages[4].text, '第五轮正文')
  assert.equal(saved.messages[5].text, '重复回合正文')
  assert.deepEqual(h.repairs, [h.session.id])
  assert.equal(h.surface(2), '第二轮正文')
})

test('故事直选：原生尾部正文一致时就地替换模型上下文', async () => {
  const h = storyFixture()
  h.setMessages([{ role: 'user', text: '行动二' }, { role: 'assistant', turn: 5, text: '第五轮正文', sourceText: '第五轮正文' }])
  const edit = await h.editor.read(h.session.id, { messageIndex: 1, revision: 1 })
  await h.editor.save(h.session.id, { token: edit.token, messageIndex: 1, revision: 1, role: 'assistant', texts: ['改写第五轮'] })
  assert.equal(h.chat.messages[1].text, '改写第五轮')
  assert.equal(sessionEvents(h.session).findLast(event => event.type === 'assistant/message').data.message.content[0].text, '改写第五轮')
  assert.deepEqual(h.repairs, [])
})

test('故事直选：重复回合的尾行不覆盖别的原生楼层，改走修复', async () => {
  const h = storyFixture()
  const edit = await h.editor.read(h.session.id, { messageIndex: 5, revision: 1 })
  assert.deepEqual(edit.parts, [{ kind: 'text', text: '重复回合正文' }])
  await h.editor.save(h.session.id, { token: edit.token, messageIndex: 5, revision: 1, role: 'assistant', texts: ['改写重复回合'] })
  assert.equal(h.chat.messages[5].text, '改写重复回合')
  assert.equal(h.surface(2), '第二轮正文')
  assert.deepEqual(h.repairs, [h.session.id])
})

test('故事直选：陈旧 revision、越界、role 不符与过期 token 都拒绝写入', async () => {
  const h = storyFixture(), before = structuredClone(h.chat)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 2, revision: 9 }), /重新打开编辑/)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 99, revision: 1 }), /刷新/)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 1, revision: 1, role: 'assistant' }), /已变化/)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 2, revision: 1, role: 'user' }), /已变化/)
  const edit = await h.editor.read(h.session.id, { messageIndex: 2, revision: 1 })
  await assert.rejects(h.editor.save(h.session.id, { token: 'stale', messageIndex: 2, revision: 1, role: 'assistant', texts: ['新'] }), /重新打开编辑/)
  await assert.rejects(h.editor.save(h.session.id, { token: edit.token, messageIndex: 2, revision: 2, role: 'assistant', texts: ['新'] }), /重新打开编辑/)
  await assert.rejects(h.editor.save(h.session.id, { token: edit.token, messageIndex: 1, revision: 1, role: 'assistant', texts: ['新'] }), /已变化/)
  assert.deepEqual(h.chat, before)
  assert.deepEqual(h.repairs, [])
})

test('故事直选：没有原生 Session 也能编辑 Chat，缺失 revision 会拒绝', async () => {
  const h = storyFixture(false)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 2 }), /重新打开编辑/)
  const edit = await h.editor.read(h.session.id, { messageIndex: 2, revision: 1 })
  await h.editor.save(h.session.id, { token: edit.token, messageIndex: 2, revision: 1, role: 'assistant', texts: ['离线改写'] })
  assert.equal(h.chat.messages[2].text, '离线改写')
  assert.equal(h.chat.messages[4].text, '第五轮正文')
  assert.deepEqual(h.repairs, [])
})
