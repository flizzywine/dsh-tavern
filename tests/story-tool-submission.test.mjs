import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createStorySubmissionTool, foldStorySubmission, storySubmissionForTurn, activeStoryTurn, storyToolCallEnabled } from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { assistantResultForTurn } from '../tavern-plugin/lib/domain/session-turn-result.js'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { locateRollbackSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'

function fixture(content = '<game>正文\\引号"\n新行</game>', { error = false, result = content, turn = 2 } = {}) {
  const raw = JSON.stringify({ content })
  return { id: 'game', events: [
    { type: 'turn/start', data: { turn } },
    { type: 'assistant/message', data: { turn, message: { id: 'model-1', source: { kind: 'model' }, content: [
      { type: 'reasoning', text: '思考' }, { type: 'text', text: '不应覆盖提交的杂话' },
      { type: 'tool-call', id: 'submit-1', name: 'submit_story', arguments: raw }
    ] } } },
    { type: 'tool/call', data: { turn, callId: 'submit-1', name: 'submit_story', arguments: raw } },
    { type: 'tool/result', data: { turn, message: { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'submit-1', isError: error, content: [{ type: 'text', text: result }] }] } } }
  ] }
}

test('只消费同回合已执行成功且匹配模型调用的提交，保留正文格式', () => {
  const session = fixture()
  const result = assistantResultForTurn(session, 2)
  assert.equal(result.storyToolSubmission, true)
  assert.equal(result.text, '<game>正文\\引号"\n新行</game>')
  assert.equal(result.reasoningText, '思考')
  assert.equal(result.event.data.message.id, 'model-1')
  assert.equal(storySubmissionForTurn(session, 1), null)
  assert.equal(storySubmissionForTurn(fixture('正文', { error: true }), 2), null)
  assert.equal(storySubmissionForTurn(fixture('正文', { result: '其他结果' }), 2), null)
  for (const remove of [1, 2, 3]) {
    const incomplete = fixture(); incomplete.events.splice(remove, 1)
    assert.equal(storySubmissionForTurn(incomplete, 2), null)
  }
  const mismatch = fixture(); mismatch.events[3].data.message.content[0].toolCallId = 'other'
  assert.equal(storySubmissionForTurn(mismatch, 2), null)
  const plugin = fixture(); plugin.events[1].data.message.source.kind = 'plugin'
  assert.equal(storySubmissionForTurn(plugin, 2), null)
  const invalid = fixture(); invalid.events[1].data.message.content[2].arguments = '{bad'
  assert.equal(storySubmissionForTurn(invalid, 2), null)
})

test('回滚或重新生成遮蔽的旧工具提交不会重新成为正文', () => {
  const session = fixture('旧正文')
  session.surface = { nodes: [0, 4] }
  session.events.push({ type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '重新生成的正文' }] } } })
  assert.equal(storySubmissionForTurn(session, 2), null)
  assert.equal(assistantResultForTurn(session, 2).text, '重新生成的正文')
})

test('Session 快照重放和结束事件仍可提取正文，不依赖内存提交状态', () => {
  const session = fixture('正文')
  assert.equal(activeStoryTurn(session), 2)
  session.events.push({ type: 'turn/end', data: { turn: 2 } })
  const copy = JSON.parse(JSON.stringify(session.events))
  assert.equal(activeStoryTurn({ snapshotEvents: () => copy }), null)
  assert.equal(assistantResultForTurn({ snapshotEvents: () => copy }, 2).text, '正文')
})

test('工具仅允许已开启的前台 story/script，拒绝空正文、后台、失效宿主和已结束回合', async () => {
  let chat = { mode: 'story' }, enabled = true, background = false, concluded = 0
  const tool = createStorySubmissionTool({ chatForSession: async () => chat, enabled: async () => enabled, isBackground: () => background })
  const session = { id: 'game', events: [{ type: 'turn/start', data: { turn: 1 } }] }
  const exec = { agent: { session }, signal: new AbortController().signal, concludeTurn() { concluded++ } }
  assert.equal(await tool.execute({ content: '正文' }, exec), '正文')
  assert.equal(concluded, 1)
  assert.equal(tool.isConcurrencySafe(), false)
  for (const content of ['', '  ', null, 123]) await assert.rejects(tool.execute({ content }, exec), /正文不能为空/)
  for (chat of [undefined, { mode: 'card' }]) await assert.rejects(tool.execute({ content: '正文' }, exec), /未开启/)
  chat = { mode: 'story' }; enabled = false
  await assert.rejects(tool.execute({ content: '正文' }, exec), /未开启/)
  chat = { mode: 'script' }; enabled = true
  assert.equal(await tool.execute({ content: '剧本正文' }, exec), '剧本正文')
  background = true
  await assert.rejects(tool.execute({ content: '正文' }, exec), /前台游玩/)
  background = false
  await assert.rejects(tool.execute({ content: '正文' }, { ...exec, concludeTurn: undefined }), /DSH 版本/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(tool.execute({ content: '正文' }, { ...exec, signal: controller.signal }), { name: 'AbortError' })
  session.events.push({ type: 'turn/end', data: { turn: 1 } })
  await assert.rejects(tool.execute({ content: '正文' }, exec), /没有正在生成/)
})

test('同轮重放相同正文幂等，冲突正文不覆盖已成功提交内容', async () => {
  const session = fixture('已提交')
  const tool = createStorySubmissionTool({ chatForSession: async () => ({ mode: 'story' }), enabled: async () => true })
  let concluded = 0
  const exec = { agent: { session }, concludeTurn() { concluded++ } }
  assert.equal(await tool.execute({ content: '已提交' }, exec), '已提交')
  await assert.rejects(tool.execute({ content: '不同正文' }, exec), /不允许重复覆盖/)
  assert.equal(concluded, 1)
  assert.equal(storySubmissionForTurn(session, 2).text, '已提交')
})

test('系统指令跟随 submit_story 是否可见，不影响 card 或旧存档', async () => {
  for (const mode of ['story', 'script', 'card']) for (const enabled of [false, true]) {
    const chat = { mode }
    const strategy = createNativePlayOrchestrationStrategy({ modeFor: async () => mode, visibleTools: async () => storyToolCallEnabled(chat, enabled) ? ['submit_story', 'tavern_recall_history'] : ['tavern_recall_history'], controlledToolNames: new Set(['submit_story']), modePrompt: () => 'card', cardSystemPrompt: () => '卡片', workspaceContext: () => '', resolvePreset: async () => null })
    const assembly = await strategy.assembleSystemPrompt({ tools: [{ name: 'submit_story' }, { name: 'tavern_recall_history' }], sections: [], fixedSystemSections: [{ name: 'tavern:base', text: '底座' }] }, { chat, sessionId: 'game' })
    assert.equal(assembly.tools.some(tool => tool.name === 'submit_story'), mode !== 'card' && enabled)
    assert.equal(assembly.sections.some(section => section.name === 'tavern:story-tool-submission'), mode !== 'card' && enabled)
    assert.equal(assembly.tools.some(tool => tool.name === 'tavern_recall_history'), true)
  }
  assert.equal(storyToolCallEnabled({ mode: 'story' }), false)
})

test('全局设置保存正文走工具调用开关，默认关闭，只接受布尔值', async () => {
  const { applyTavernSettingsPatch, presentTavernSettings } = await import('../tavern-plugin/lib/domain/tavern-settings.js')
  assert.equal(presentTavernSettings({}, {}).storyToolCall, false)
  const saved = applyTavernSettingsPatch({}, { storyToolCall: true })
  assert.equal(presentTavernSettings(saved, {}).storyToolCall, true)
  assert.throws(() => applyTavernSettingsPatch({}, { storyToolCall: 'true' }), /布尔值/)
})

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const hooks = await readFile(new URL('../tavern-plugin/lib/hooks/turn-lifecycle.js', import.meta.url), 'utf8')

test('真实收尾 hook 将工具正文交给现有保存链路，并把调用与回执折叠成保存后的正文', async () => {
  let hook, saved, replacements = []
  const session = fixture('最终正文')
  const context = { ctx: { on(_name, handler) { hook = handler } }, clearRuntimePresetRequestState() {},
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined }, fullTemplateRuntime: { cancel() {} },
    userMessageForTurn: () => ({ content: [{ type: 'text', text: '玩家输入' }] }),
    contentText: message => (Array.isArray(message?.content) ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('') : ''),
    inputAttachments: content => (Array.isArray(content) ? content.filter(block => block?.type === 'image') : []),
    requestIdForTurn: () => 'rpc-1', roundAnchor: () => null, inputEventForTurn: () => null,
    assistantResultForTurn, turnOrchestrator: { recordFailure() { throw new Error('不应误判空正文') } },
    foregroundHandoff: { async finalize(input) { saved = input; return { reply: { sessionText: '正则投影正文' } } } },
    replaceAssistantReply(_session, result, text) { replacements.push([result.storyToolSubmission, result.receiptIndex, text]) } }
  const start = hooks.indexOf("  ctx.on('agent/turn-stopping'")
  const end = hooks.indexOf("  ctx.on('agent/error'", start)
  vm.runInNewContext(hooks.slice(start, end), context)
  await hook({ agent: { session }, turn: 2 })
  assert.equal(saved.assistantText, '最终正文')
  assert.equal(saved.requestId, 'rpc-1')
  assert.deepEqual(replacements, [[true, 3, '正则投影正文']])
})

test('折叠后上下文只剩一条普通正文，回合结果、回退都按普通回合处理', () => {
  const session = Session.create('story-tool-fold')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', { id: 'input-1', role: 'user', content: [{ type: 'text', text: '玩家输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const raw = JSON.stringify({ content: '原始正文' })
  const call = appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'call-1', role: 'assistant', content: [{ type: 'tool-call', id: 'submit-1', name: 'submit_story', arguments: raw }], source: { kind: 'model', provider: 'test', model: 'test' } } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn: 1, step: 1, callId: 'submit-1', name: 'submit_story', arguments: raw })
  const receipt = appendSessionEvent(session, 'tool/result', { turn: 1, step: 1, message: { id: 'receipt-1', role: 'user', content: [{ type: 'tool-result', toolCallId: 'submit-1', isError: false, content: [{ type: 'text', text: '原始正文' }] }], source: { kind: 'tool', callId: 'submit-1' } } }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const result = assistantResultForTurn(session, 1)
  assert.deepEqual([result.index, result.receiptIndex], [call.seq, receipt.seq])

  const start = server.indexOf('  function replaceAssistantReply(')
  const context = { replaceSessionSurface, foldStorySubmission, randomUUID: () => 'projection-1' }
  vm.runInNewContext(server.slice(start, server.indexOf('\n  }\n', start) + 4) + '; this.replace = replaceAssistantReply', context)
  context.replace(session, result, '保存后的正文')

  const visible = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq))
  assert.deepEqual(visible.map(event => event.type), ['user/message', 'assistant/message'])
  assert.deepEqual(visible[1].data.message.content, [{ type: 'text', text: '保存后的正文' }])
  // The chat view only follows appends: the same step also gains a plain text answer.
  const shown = sessionEvents(session).findLast(event => event.type === 'assistant/message' && event.surfaceOp === 'append')
  assert.deepEqual([shown.data.turn, shown.data.step, shown.data.message.content], [1, 1, [{ type: 'text', text: '保存后的正文' }]])
  assert.equal(storySubmissionForTurn(session, 1), null)
  const after = assistantResultForTurn(session, 1)
  assert.equal(after.text, '保存后的正文')
  assert.equal(after.storyToolSubmission, undefined)
  const rollback = locateRollbackSurface({ events: sessionEvents(session), nodes: session.surface.nodes })
  assert.deepEqual(rollback.shadowedSeqs, [input.seq, visible[1].seq])
})

function foldFixture(tools) {
  const session = Session.create('fold-' + tools.join('-'))
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', { id: 'input-1', role: 'user', content: [{ type: 'text', text: '玩家输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const raw = JSON.stringify({ content: '原始正文' })
  const call = appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'call-1', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' }, content: tools.map(name => ({ type: 'tool-call', id: name + '-1', name, arguments: name === 'submit_story' ? raw : '{"query":"背景"}' })) } }, { surfaceOp: 'append' })
  const receipts = []
  for (const name of tools) {
    const args = name === 'submit_story' ? raw : '{"query":"背景"}'
    appendSessionEvent(session, 'tool/call', { turn: 1, step: 1, callId: name + '-1', name, arguments: args })
    receipts.push(appendSessionEvent(session, 'tool/result', { turn: 1, step: 1, message: { id: name + '-receipt', role: 'user', source: { kind: 'tool', callId: name + '-1' }, content: [{ type: 'tool-result', toolCallId: name + '-1', isError: false, content: [{ type: 'text', text: name === 'submit_story' ? '原始正文' : '背景资料' }] }] } }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] }))
  }
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  return { session, input, call, receipts }
}

test('一步并行调用多个工具时，折叠区间覆盖中间回执', () => {
  const { session } = foldFixture(['tavern_recall_history', 'submit_story'])
  const result = assistantResultForTurn(session, 1)
  assert.equal(result.storyToolSubmission, true)
  foldStorySubmission(session, result, '保存后的正文')
  const visible = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq))
  // A non-submission receipt rides the same step; replacing only three seqs
  // leaves it unmatched and the host refuses the whole replacement.
  assert.deepEqual(visible.map(event => event.type), ['user/message', 'assistant/message'])
  assert.equal(assistantResultForTurn(session, 1).text, '保存后的正文')
})

test('调用位置按事件 seq 定位，不依赖事件数组下标', () => {
  const { session, call, receipts } = foldFixture(['submit_story'])
  // assistantResultForTurn reports the events-array position; a filtered or
  // compacted log numbers its seq differently, so only the seq is trustworthy.
  foldStorySubmission(session, { index: 0, event: call, receiptIndex: receipts[0].seq, text: '正文', content: '正文', toolCallId: 'submit_story-1', storyToolSubmission: true }, '正文')
  const visible = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq))
  assert.deepEqual(visible.map(event => event.type), ['user/message', 'assistant/message'])
  assert.deepEqual(visible[1].data.message.content, [{ type: 'text', text: '正文' }])
})

test('追加的可见正文与替换后的正文是同一条消息', () => {
  const { session } = foldFixture(['submit_story'])
  foldStorySubmission(session, assistantResultForTurn(session, 1), '保存后的正文')
  const projections = sessionEvents(session).filter(event => event.type === 'assistant/message' &&
    event.data.message.source?.model === 'reply-projection')
  assert.equal(projections.length, 2)
  // The chat view keys a round's actions by the rendered message id and the fork
  // map reads the newest projection's id; two ids hide "从这一轮分叉".
  assert.equal(projections[0].data.message.id, projections[1].data.message.id)
  assert.equal(projections[1].surfaceOp.op, 'replace')
  assert.deepEqual(projections[1].sourceEventSeqs.slice(-1), [projections[0].seq])
})

