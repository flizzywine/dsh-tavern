import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createBodyEditor, synchronizeBodyEdits } from '../tavern-plugin/lib/domain/body-editor.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { computeSceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'

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

test('stale tabs, blank text and new HTML reject without writes; a running turn queues instead', async () => {
  const h = fixture(), edit = await h.editor.read(h.session.id), original = structuredClone(h.chat)
  for (const input of [{ token: 'stale', texts: ['新'] }, { token: edit.token, texts: [''] }, { token: edit.token, texts: ['<div>注入</div>'] }, { token: edit.token, texts: [] }]) await assert.rejects(h.editor.save(h.session.id, input))
  h.busy(true)
  const queued = await h.editor.save(h.session.id, { token: edit.token, texts: ['新'] })
  assert.equal(queued.queued, true)
  assert.equal(queued.queuedCount, 1)
  h.busy(false)
  // Reading is side-effect free: the editor opens while the turn runs, it only
  // must not write before the turn is over.
  h.agent.phase.kind = 'running'
  assert.equal((await h.editor.read(h.session.id)).token, edit.token)
  h.agent.phase.kind = 'idle'
  assert.deepEqual(h.chat, original)
  const html = fixture('<div>纯 HTML</div>'); await assert.rejects(html.editor.read(html.session.id), /没有可编辑文本/)
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


// The same edit through a bounded history (patch of the last floor) and through
// the complete Chat update must store the same Chat and native surface.
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
  assert.equal(h.chat.messages[1].polishedFrom, undefined)

  const polished = fixture('雨停了。\n\n' + block)
  const beforeTarget = computeSceneTarget(polished.chat, 2)
  await polished.editor.replaceText(polished.session.id, '雨终于停了，灯也亮了。\n\n' + block, { polish: true })
  assert.equal(polished.chat.messages[1].sourceText, '雨终于停了，灯也亮了。\n\n' + block)
  assert.equal(polished.chat.messages[1].polished, true)
  assert.ok(polished.chat.messages[1].polishedFrom, 'polish 模式保留原场景摘要')
  assert.equal(computeSceneTarget(polished.chat, 2).key, beforeTarget.key, 'polish 模式不改变场景媒体键')
})


test('编辑不再取消旧预备任务，后台忙碌时读取照常、写入排队', async () => {
  const h = fixture()
  const editor = createBodyEditor({ ...h.options, cancelPreparation: async () => assert.fail('retired callback') })
  h.busy(true)
  assert.equal((await editor.read(h.session.id)).parts.filter(part => part.kind === 'text')[0].text, '原正文')
  const queued = await editor.save(h.session.id, { token: (await editor.read(h.session.id)).token, texts: ['排队正文'] })
  assert.equal(queued.queued, true)
  h.busy(false)
  await editor.flushQueued(h.session.id)
  assert.equal(h.chat.messages[1].text, '排队正文')
  const edit = await editor.read(h.session.id)
  await editor.save(h.session.id, { token: edit.token, texts: ['改过的正文'] })
  assert.equal(h.chat.messages[1].text, '改过的正文')
})

// 故事列表按 chat.messages 的位置编辑：目标行由 messageIndex 给出，turn 缺失、
// 重复或非单调都不参与定位；原生锚点/轮次与正文同时吻合时才改写模型上下文。
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
  const editor = createBodyEditor({
    chats: { forSession: async () => structuredClone(chat),
      update: async (_id, fn) => { chat = fn(structuredClone(chat)); chat._storageRevision++; return structuredClone(chat) } },
    sessions: { get: () => withNative ? agent : undefined, flush: async () => {} },
    timeline: createStoryTimeline(), activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text), present: async value => value
  })
  return { editor, session, get chat() { return chat }, setMessages(rows) { chat = { ...chat, messages: rows } },
    surface(turn) { return sessionEvents(session).findLast(event => event.type === 'assistant/message' && Number(event.data?.turn) === Number(turn))?.data.message.content[0].text } }
}

test('故事直选：陈旧 revision、越界、role 不符与过期 token 都拒绝写入', async () => {
  const h = storyFixture(), before = structuredClone(h.chat)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 2, revision: 9 }), /重新打开编辑/)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 99, revision: 1 }), /刷新/)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 1, revision: 1, role: 'assistant' }), /已变化/)
  await assert.rejects(h.editor.read(h.session.id, { messageIndex: 2, revision: 1, role: 'user' }), /已变化/)
  const edit = await h.editor.read(h.session.id, { messageIndex: 2, revision: 1 })
  await assert.rejects(h.editor.save(h.session.id, { token: 'stale', messageIndex: 2, revision: 1, role: 'assistant', texts: ['新'] }), /重新打开编辑/)
  await assert.rejects(h.editor.save(h.session.id, { token: edit.token, messageIndex: 1, revision: 1, role: 'assistant', texts: ['新'] }), /已变化/)
  assert.deepEqual(h.chat, before)
  // 存档计数被后台推进不再作废面板 token：行正文没变就照常写入。
  const bumped = await h.editor.save(h.session.id, { token: edit.token, messageIndex: 2, revision: 2, role: 'assistant', texts: ['新'] })
  assert.equal(bumped.messages[2].text, '新')
})
