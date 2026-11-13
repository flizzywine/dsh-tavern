import assert from 'node:assert/strict'
import test from 'node:test'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { prepareTemplateHistory, synchronizeTemplateHistory } from '../tavern-plugin/lib/domain/template-history.js'
import path from 'node:path'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { setAgentResolver } from '../tavern-plugin/lib/domain/agent-lookup.js'

// The host catalog is the only judge of whether a stored log opens again.
async function reopen(session) {
  const { prepareExpandedPatch } = await import('../tavern-plugin/lib/domain/host-session-patch.js')
  const { catalog } = await prepareExpandedPatch(process.env.DSH_BOOT_MODULE.split(path.sep + 'node_modules' + path.sep)[0])
  const restore = catalog.createRestore({ type: 'session', version: catalog.currentVersion, id: session.id, createdAt: 1, cwd: '/tmp', isSeeded: false, delegationDepth: 0, agentPreset: 'tavern' }, { recovery: 'strict', validation: 'current' })
  for (const event of sessionEvents(session)) restore.decodeRow(structuredClone(event))
  return restore.finish()
}

test('卡片更新后的第一轮：模板同步不写进已经开始的回合，回合结束后才改写开场白，存档仍能打开', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => { setAgentResolver(null); return h.dispose() })
  // As the plugin does: surface writes find the live Agent of their session.
  setAgentResolver(sessionId => h.ctx.agents.get(sessionId))
  await h.importHistory({ ...h.input, operationId: 'template-open-turn', text: [{chat_metadata:{}},{is_user:false,mes:'开场 金币: 10'},{is_user:true,mes:'行动'},{is_user:false,mes:'回复'}].map(JSON.stringify).join('\n') })
  const before = await h.open().ensureOpening(h.input.sessionId)
  const after = structuredClone(before)
  after.messages.find(message => message.role === 'assistant').text = '开场 金币: 20'
  prepareTemplateHistory(h.target.session, before, after)
  // The player's next turn has already started when the save carries the rewrite:
  // the request hooks synchronize inside that open turn, before its first step.
  h.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    await synchronizeTemplateHistory(context.agent.session, after, () => h.checkpoint())
    return assembly
  })
  await h.continueInPlace()
  await reopen(h.target.session)
  const texts = () => h.target.session.deriveMessages().flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  assert(texts().includes('开场 金币: 10'), 'the started turn keeps the opening it was prepared with')
  // Idle again: the same synchronization writes the new opening in an edit turn of its own.
  await synchronizeTemplateHistory(h.target.session, after, () => h.checkpoint())
  await reopen(h.target.session)
  assert(texts().includes('开场 金币: 20'))
  assert(!texts().includes('开场 金币: 10'))
  await h.continueInPlace()
  await reopen(h.target.session)
})

test('模板永久改写用户和回复，恢复磁盘后真实 Agent 不再收到旧正文', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  await h.importHistory({ ...h.input, operationId: 'template-edit-native', text: [{chat_metadata:{}},{is_user:false,mes:'开场'},{is_user:true,mes:'旧行动'},{is_user:false,mes:'旧回复'}].map(JSON.stringify).join('\n') })
  const before = await h.open().ensureOpening(h.input.sessionId)
  const after = structuredClone(before)
  after.messages.find(message => message.role === 'user').text = '新行动'
  after.messages.at(-1).text = '新回复'
  prepareTemplateHistory(h.target.session, before, after)
  assert.equal(after.messages.filter(message => message.templateHistoryEdit).length, 2)
  await h.persistence.write(after)
  await synchronizeTemplateHistory(h.target.session, after, () => h.checkpoint())
  const count = h.target.session.surface.nodes.length
  await synchronizeTemplateHistory(h.target.session, after, () => h.checkpoint())
  assert.equal(h.target.session.surface.nodes.length, count)
  await h.restoreDetached()
  await h.continueWithAgent()
  const texts = h.requests[0].messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  assert(texts.includes('新行动')); assert(texts.includes('新回复'))
  assert(!texts.some(text => text.includes('旧行动') || text.includes('旧回复')))
})

import { Session } from './fixtures/dsh-session-host.mjs'
import { createScopedMessages } from '../tavern-plugin/lib/domain/scoped-messages.js'

test('局部历史按最近楼层对齐原生消息面，与完整历史标记同一条输入', async () => {
  const build = () => {
    const session = Session.create('template-window')
    const messages = []
    for (let turn = 1; turn <= 6; turn++) {
      session.append('user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '继续' }] }, { surfaceOp: 'append' })
      session.append('assistant/message', { turn, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' + turn }] } }, { surfaceOp: 'append' })
      messages.push({ role: 'user', text: turn === 6 ? '继续（模板渲染）' : '继续', ...(turn === 6 ? { templateInputSource: '继续' } : {}) },
        { role: 'assistant', text: '回复' + turn, turn })
    }
    return { session, messages }
  }
  const full = build(), windowed = build()
  await synchronizeTemplateHistory(full.session, { messages: full.messages }, async () => {})
  const from = 8
  const scoped = createScopedMessages(windowed.messages.length, windowed.messages.slice(from).map((row, index) => [from + index, row]))
  await synchronizeTemplateHistory(windowed.session, { messages: scoped }, async () => {})
  const edit = full.messages[10].templateHistoryEdit
  assert.ok(edit)
  assert.equal(scoped[10].templateHistoryEdit.seq, edit.seq)
  assert.equal(full.messages.filter(row => row.templateHistoryEdit).length, 1)
  const texts = session => session.deriveMessages().flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  assert.deepEqual(texts(windowed.session), texts(full.session))
  assert.ok(texts(full.session).includes('继续（模板渲染）'))
})

test('DSH 0.2.1 的压缩检查点（source.kind = compact-checkpoint）同样不会被模板同步改写', async () => {
  const session = Session.create('template-compact-v4')
  const seqs = []
  for (let turn = 1; turn <= 3; turn++) {
    seqs.push(session.append('user/message', { id: 'u' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }] }, { surfaceOp: 'append' }))
    seqs.push(session.append('assistant/message', { turn, message: { id: 'a' + turn, role: 'assistant', content: [{ type: 'text', text: '回复' + turn }] } }, { surfaceOp: 'append' }))
  }
  const seqOf = value => typeof value === 'number' ? value : value.seq
  // 0.2.1 / 会话格式 v4 把检查点记成 { kind: 'compact-checkpoint' }，不再是插件来源。
  const checkpoint = { id: 'compact-1', role: 'user', content: [{ type: 'text', text: '【摘要】前两轮' }], source: { kind: 'compact-checkpoint', compactionId: 'c1' } }
  session.append('user/message', checkpoint, { surfaceOp: { op: 'replace', startSeq: seqOf(seqs[0]), endSeq: seqOf(seqs[3]) }, sourceEventSeqs: seqs.slice(0, 4).map(seqOf) })
  const messages = [
    { role: 'user', text: '行动1', templateInputSource: '【摘要】前两轮' }, { role: 'assistant', text: '回复1', turn: 1 },
    { role: 'user', text: '行动2' }, { role: 'assistant', text: '回复2', turn: 2 },
    { role: 'user', text: '行动3' }, { role: 'assistant', text: '回复3', turn: 3 }
  ]
  const before = session.snapshotEvents().length
  const texts = () => session.deriveMessages().flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
  await synchronizeTemplateHistory(session, { messages }, async () => {})
  assert.ok(texts().includes('【摘要】前两轮'))
  assert.ok(!texts().includes('行动1'))
  // 压缩之外替换检查点会让 DSH 重启后拒绝加载（compaction checkpoint has no matching compaction/start），一条都不能写。
  const written = session.snapshotEvents().slice(before)
  assert.ok(!written.some(event => event.data?.source?.kind === 'compact-checkpoint'), JSON.stringify(written.map(event => event.type)))
})
