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

test('display captures do not invalidate an open edit, but advancing the conversation does', async () => {
  const h = fixture(), edit = await h.editor.read(h.session.id)
  h.change(chat => { chat._storageRevision++; chat.messages.at(-1).displayRuntime = { frames: [] }; chat.messages.at(-1).tavernPluginData = { template_display: { source: '正文', formattingText: '刷新显示' } } })
  await h.editor.save(h.session.id, { token: edit.token, texts: ['新正文'] })
  assert.equal(h.chat.messages.at(-1).displayRuntime, undefined)
  const next = await h.editor.read(h.session.id)
  h.change(chat => { chat.messages.push({ role: 'user', text: '下一轮' }) })
  await assert.rejects(h.editor.save(h.session.id, { token: next.token, texts: ['过时正文'] }), /最后一轮/)
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

test('bounded body edit whose revision moved falls back to the complete update and its checks', async t => {
  const h = await nativeEditor(t, true)
  const edit = await h.editor.read(h.session.id)
  h.hooks.beforePatch = () => h.p.update('chat', chat => { chat.messages.at(-1).tavernPluginData = { template_display: { source: 'x' } }; return chat }, { source: 'display.capture' })
  await h.editor.save(h.session.id, { token: edit.token, texts: ['并发后的编辑'] })
  assert.deepEqual(h.calls, ['patch', 'update'])
  const stored = await h.p.read('chat')
  assert.equal(stored.messages.at(-1).sourceText, '并发后的编辑')
  assert.deepEqual(stored.messages.at(-1).tavernPluginData, { template_display: { source: 'x' } })
  // A real story change between read and save is still refused by the complete path.
  const next = await h.editor.read(h.session.id)
  h.hooks.beforePatch = () => h.p.update('chat', chat => { chat.messages.at(-1).sourceText = '别处改过'; return chat }, { source: 'other' })
  await assert.rejects(h.editor.save(h.session.id, { token: next.token, texts: ['过时编辑'] }), /已变化/)
  assert.equal((await h.p.read('chat')).messages.at(-1).sourceText, '别处改过')
})

test('在正文末尾追加文字时保留与后续结构块之间的空行，美化正则仍能匹配', async () => {
  const h = fixture('剑光飞过。\n\n<name>秦晚晴</name>')
  const edit = await h.editor.read(h.session.id)
  assert.equal(edit.parts[0].text, '剑光飞过。\n\n')
  await h.editor.save(h.session.id, { token: edit.token, texts: ['剑光飞过。她笑了。', '秦晚晴'] })
  assert.equal(h.chat.messages[1].sourceText, '剑光飞过。她笑了。\n\n<name>秦晚晴</name>')
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
