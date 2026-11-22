import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { createBodyEditor } from '../tavern-plugin/lib/domain/body-editor.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

test('saved edit survives disk restore and replaces the old body in the next real Agent request', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  await h.importHistory({ ...h.input, operationId: 'body-edit-native', text: [{ chat_metadata: {} }, { is_user: false, mes: '开场' }, { is_user: true, mes: '走到花店' }, { is_user: false, mes: '原正文：抵达花店' }].map(JSON.stringify).join('\n') })
  const chat = await h.open().ensureOpening(h.input.sessionId)
  const editor = createBodyEditor({
    chats: { forSession: () => h.persistence.read(chat.id), update: h.persistence.update },
    sessions: { get: () => h.target.agent, flush: () => h.checkpoint() },
    timeline: createStoryTimeline(), activity: () => ({ busy: false }), project: async text => projectReplyLayers(text), present: async chat => chat
  })
  const edit = await editor.read(h.input.sessionId)
  await editor.save(h.input.sessionId, { token: edit.token, texts: ['修改正文：留在邮局'] })
  assert.equal(h.requests.length, 0)
  await h.restoreDetached()
  await h.continueWithAgent()
  assert.equal(h.requests.length, 1)
  const messages = h.requests[0].messages.map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
  assert.equal(messages.filter(text => text === '修改正文：留在邮局').length, 1)
  assert.equal(messages.filter(text => text.includes('原正文：抵达花店')).length, 0)
  assert.equal((await h.persistence.read(chat.id)).messages.at(-1).text, '修改正文：留在邮局')
})

test('editing an earlier story reply survives reload and keeps the later reply in the next Agent request', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const history = [
    { chat_metadata: {} }, { is_user: false, mes: '开场' },
    { is_user: true, mes: '先去广场' }, { is_user: false, mes: '原来的旧正文' },
    { is_user: true, mes: '再去邮局' }, { is_user: false, mes: '后续正文' }
  ]
  await h.importHistory({ ...h.input, operationId: 'body-edit-old-floor', text: history.map(JSON.stringify).join('\n') })
  const chat = await h.open().ensureOpening(h.input.sessionId)
  const editor = createBodyEditor({
    chats: { forSession: () => h.persistence.read(chat.id), update: h.persistence.update },
    sessions: { get: () => h.target.agent, flush: () => h.checkpoint() },
    timeline: createStoryTimeline(), activity: () => ({ busy: false }),
    project: async text => projectReplyLayers(text), present: async chat => chat
  })
  const index = chat.messages.findIndex(row => row.text === '原来的旧正文')
  const edit = await editor.read(h.input.sessionId, {
    role: 'assistant', messageIndex: index, revision: chat._storageRevision, text: '原来的旧正文'
  })
  await editor.save(h.input.sessionId, { ...edit, texts: ['改了的旧正文'] })
  await h.restoreDetached()
  await h.continueWithAgent()
  const texts = h.requests[0].messages.flatMap(message => message.role === 'assistant'
    ? message.content.filter(block => block.type === 'text').map(block => block.text) : [])
  assert.equal(texts.includes('原来的旧正文'), false)
  assert.ok(texts.indexOf('改了的旧正文') >= 0 && texts.indexOf('后续正文') > texts.indexOf('改了的旧正文'))
  const saved = await h.persistence.read(chat.id)
  assert.equal(saved.messages[index].text, '改了的旧正文')
  assert.equal(saved.messages.at(-1).text, '后续正文')
})
