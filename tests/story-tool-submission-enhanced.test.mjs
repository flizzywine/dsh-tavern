import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import {
  STORY_CONTEXT_TOOL_NAME,
  STORY_REFUSAL_ABORT_RECEIPT,
  STORY_SUBMIT_ACK_TEXT,
  STORY_SUBMIT_TOOL_NAME,
  buildStorySubmitWireSchema,
  createStoryContextTool,
  createStorySubmissionTool,
  detectStoryRefusal,
  foldStorySubmission,
  storySubmissionForTurn,
} from '../tavern-plugin/lib/domain/story-tool-submission.js'
import { assistantResultForTurn } from '../tavern-plugin/lib/domain/session-turn-result.js'
import {
  ENVELOPE_INIT_CALL_ID,
  ENVELOPE_SYSTEM_SHELL,
  projectEnvelopeRequest,
  projectHistoryAsToolCalls,
} from '../tavern-plugin/lib/domain/history-tool-call.js'
import {
  createForegroundOrchestrationStrategies,
  toolProtocolDirectiveOf,
} from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { GEMINI_THOUGHT_SIGNATURE_SENTINEL } from '../tavern-plugin/lib/domain/tool-protocol-enforcement.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { foregroundToolCatalog, normalizeDisabledForegroundTools } from '../tavern-plugin/lib/domain/foreground-tools.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'

test('拒答识别：精准命中模型场外退回话术，放行角色台词与正常长篇小说正文', () => {
  assert.equal(detectStoryRefusal('抱歉，我无法协助生成此类内容。'), true)
  assert.equal(detectStoryRefusal('<game>\n抱歉，作为一个人工智能助手，我不能继续这段剧情。\n</game>'), true)
  assert.equal(detectStoryRefusal("I'm sorry, but I cannot fulfill this request."), true)
  assert.equal(detectStoryRefusal('「抱歉，让你久等了。」少女轻轻推开木门。'), false)
  assert.equal(detectStoryRefusal('“对不起，我不能答应你的条件。”骑士握紧了剑柄。'), false)
  assert.equal(detectStoryRefusal('夜风拂过庭院，灯笼微晃。'.repeat(40)), false)
})

test('submit_story：首次退回触发同回合纠偏错（不结束回合），二次退回干净中止并标记 content-filter', async () => {
  const session = Session.create('refusal-game')
  appendSessionEvent(session, 'turn/start', { turn: 1 }, null)

  let concluded = 0
  const tool = createStorySubmissionTool({
    chatForSession: async () => ({ id: 'c1', mode: 'story' }),
    enabled: async () => true,
  })
  const exec = {
    agent: { session },
    concludeTurn() { concluded++ }
  }

  // 第 1 次：抛出纠偏指令，不调 concludeTurn，驱动 Agent Loop 进入 step 2 重试
  let firstErr = null
  try {
    await tool.execute({ content: '抱歉，我无法生成这段内容。' }, exec)
  } catch (err) {
    firstErr = err
  }
  assert.ok(firstErr)
  assert.match(firstErr.message, /提交被退回：content 中检测到场外说明/)
  assert.equal(concluded, 0)

  // 模拟宿主记录了第 1 次的错误 tool/result
  const errCall = appendSessionEvent(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      id: 'm1-err',
      role: 'assistant',
      source: { kind: 'model', provider: 'google', model: 'gemini-3-pro' },
      content: [{ type: 'tool-call', id: 'c1', name: STORY_SUBMIT_TOOL_NAME, arguments: '{}' }]
    }
  }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'err-1',
      role: 'user',
      source: { kind: 'tool', callId: 'c1' },
      content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: firstErr.message }] }]
    }
  }, { surfaceOp: 'append', sourceEventSeqs: [errCall.seq] })

  // 第 2 次仍退回：调用 concludeTurn 立即收束回合，返回中止回执，避免死循环
  const secondOut = await tool.execute({ content: "I'm sorry, I cannot write that." }, exec)
  assert.equal(concluded, 1)
  assert.equal(secondOut, STORY_REFUSAL_ABORT_RECEIPT)

  // 结算读取到 refusalAborted 与 content-filter 分类
  const argsJson = JSON.stringify({ content: "I'm sorry, I cannot write that." })
  const callEvent = appendSessionEvent(session, 'assistant/message', {
    turn: 1,
    step: 2,
    message: {
      id: 'm2',
      role: 'assistant',
      source: { kind: 'model', provider: 'google', model: 'gemini-3-pro' },
      content: [{ type: 'tool-call', id: 'c2', name: STORY_SUBMIT_TOOL_NAME, arguments: argsJson }]
    }
  }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn: 1, step: 2, callId: 'c2', name: STORY_SUBMIT_TOOL_NAME, arguments: argsJson }, null)
  appendSessionEvent(session, 'tool/result', {
    turn: 1,
    step: 2,
    message: {
      id: 'r2',
      role: 'user',
      source: { kind: 'tool', callId: 'c2' },
      content: [{ type: 'tool-result', toolCallId: 'c2', isError: false, content: [{ type: 'text', text: STORY_REFUSAL_ABORT_RECEIPT }] }]
    }
  }, { surfaceOp: 'append', sourceEventSeqs: [callEvent.seq] })

  const result = assistantResultForTurn(session, 1)
  assert.equal(result.refusalAborted, true)
  assert.equal(result.failure.category, 'content-filter')
})

test('纯文本回退防漏：模型未调 submit_story 直接吐出拒答或复读确认语时标记 plainTextRefusal', () => {
  const session = Session.create('plain-leak')
  appendSessionEvent(session, 'turn/start', { turn: 1 }, null)
  appendSessionEvent(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      id: 'm1',
      role: 'assistant',
      source: { kind: 'model', provider: 'openai', model: 'gpt-5' },
      content: [{ type: 'text', text: STORY_SUBMIT_ACK_TEXT }]
    }
  }, { surfaceOp: 'append' })
  assert.equal(assistantResultForTurn(session, 1).plainTextRefusal, true)
})

test('read_story_context 被误调用时抛出引导直达 submit_story', async () => {
  const ctxTool = createStoryContextTool()
  await assert.rejects(() => ctxTool.execute({ query: 'sync' }), /直接调用 submit_story/)
})

test('foldStorySubmission 保留 think 思考槽与真实 thoughtSignature，同模型回放还原真签名、跨模型降级哨兵', () => {
  const session = Session.create('sig-preserve')
  appendSessionEvent(session, 'turn/start', { turn: 1 }, null)
  const realSig = Buffer.from('authentic-gemini-sig-000', 'utf8').toString('base64')
  const argsJson = JSON.stringify({ think: '先铺垫雨夜气氛', content: '雨水顺着屋檐滑落。' })
  const callEvent = appendSessionEvent(session, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      id: 'call-1',
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'google',
        model: 'gemini-3.1-pro',
        replayState: {
          response: { kind: 'pi-ai', version: 2, api: 'google-generative-ai', provider: 'google', model: 'gemini-3.1-pro', stopReason: 'toolUse' },
          blocks: [{ type: 'tool-call', thoughtSignature: realSig }]
        }
      },
      content: [{ type: 'tool-call', id: 'tc_1', name: STORY_SUBMIT_TOOL_NAME, arguments: argsJson }]
    }
  }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn: 1, step: 1, callId: 'tc_1', name: STORY_SUBMIT_TOOL_NAME, arguments: argsJson }, null)
  const receiptEvent = appendSessionEvent(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'rec-1',
      role: 'user',
      source: { kind: 'tool', callId: 'tc_1' },
      content: [{ type: 'tool-result', toolCallId: 'tc_1', isError: false, content: [{ type: 'text', text: '雨水顺着屋檐滑落。' }] }]
    }
  }, { surfaceOp: 'append', sourceEventSeqs: [callEvent.seq] })

  const submitted = assistantResultForTurn(session, 1)
  assert.equal(submitted.toolThinkText, '先铺垫雨夜气氛')
  assert.equal(submitted.reasoningText, '先铺垫雨夜气氛')

  foldStorySubmission(session, submitted, submitted.text, 'tavern-tool-reply:1')
  const foldedMsg = sessionEvents(session).filter(e => e.type === 'assistant/message').at(-1).data.message
  assert.deepEqual(foldedMsg.content, [
    { type: 'reasoning', text: '先铺垫雨夜气氛' },
    { type: 'text', text: '雨水顺着屋檐滑落。' }
  ])
  assert.equal(foldedMsg.source.toolReplay.thoughtSignature, realSig)

  // 同 provider + model 回放：还原真签名 + think 字段
  const sameSigs = {}
  const history = [
    { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '开场' }] },
    foldedMsg,
    { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }
  ]
  const sameProjected = projectHistoryAsToolCalls(history, {
    toolName: STORY_SUBMIT_TOOL_NAME,
    layout: 'bodies',
    includeThink: true,
    targetProvider: 'google',
    targetModel: 'gemini-3.1-pro',
    signaturesByCallId: sameSigs,
    preserve: (_m, idx) => idx === 2
  })
  const replayedAssistant = sameProjected[1]
  assert.deepEqual(JSON.parse(replayedAssistant.content[0].arguments), {
    think: '先铺垫雨夜气氛',
    content: '雨水顺着屋檐滑落。'
  })
  assert.equal(replayedAssistant.source.replayState.blocks[0].thoughtSignature, realSig)
  assert.equal(sameSigs[replayedAssistant.content[0].id], realSig)

  // 切换不同模型时回放：自动降级为哨兵签名
  const crossSigs = {}
  const crossProjected = projectHistoryAsToolCalls(history, {
    toolName: STORY_SUBMIT_TOOL_NAME,
    layout: 'bodies',
    targetProvider: 'openrouter',
    targetModel: 'google/gemini-3-flash',
    signaturesByCallId: crossSigs,
    preserve: (_m, idx) => idx === 2
  })
  assert.equal(crossSigs[crossProjected[1].content[0].id], GEMINI_THOUGHT_SIGNATURE_SENTINEL)
})

test('envelope 全信封模式：下沉 system 入 read_story_context(init_world)、玩家输入归并 submit_story 回执、末尾追加 sync 且严格锁死出口', async () => {
  const sigs = {}
  const messages = [
    { id: 'greet-0', role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'opening' }, content: [{ type: 'text', text: '欢迎来到神域剧场。' }] },
    { id: 'p-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '推开大门' }] },
    { id: 'frame-1', role: 'user', source: { kind: 'plugin', plugin: 'dsh-tavern' }, content: [{ type: 'text', text: '【世界书增量：大厅灯火通明】' }] },
    { id: 'ai-1', role: 'assistant', source: { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }, content: [{ type: 'reasoning', text: '构思大厅' }, { type: 'text', text: '沉重的石门缓缓开启。' }] },
    { id: 'p-2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '走向王座' }] }
  ]

  const env = projectEnvelopeRequest({
    system: '【角色卡：猫神】\n【创作细则】',
    messages,
    toolName: STORY_SUBMIT_TOOL_NAME,
    contextToolName: STORY_CONTEXT_TOOL_NAME,
    includeThink: true,
    outputToolCall: true,
    turn: 2,
    inputIndex: 4,
    targetProvider: 'google',
    targetModel: 'gemini-3-pro',
    signaturesByCallId: sigs
  })

  assert.equal(env.system, ENVELOPE_SYSTEM_SHELL)
  // 结构顺序：user(init) -> assistant(init_world) -> tool(init_world) -> assistant(greet) -> tool(p-1+frame-1) -> assistant(ai-1) -> tool(p-2) -> assistant(sync) -> tool(sync)
  assert.deepEqual(env.messages.map(m => m.role), [
    'user', 'assistant', 'tool',
    'assistant', 'tool',
    'assistant', 'tool',
    'assistant', 'tool'
  ])
  assert.equal(env.messages[1].content[0].id, ENVELOPE_INIT_CALL_ID)
  assert.match(env.messages[2].content[0].text, /【角色卡：猫神】/)
  const firstTurnReceipt = JSON.parse(env.messages[4].content[0].text)
  assert.equal(firstTurnReceipt.user_input, '推开大门')
  assert.deepEqual(firstTurnReceipt.context_updates, ['【世界书增量：大厅灯火通明】'])
  assert.deepEqual(JSON.parse(env.messages[5].content[0].arguments), { think: '构思大厅', content: '沉重的石门缓缓开启。' })
  const latestReceipt = JSON.parse(env.messages[6].content[0].text)
  assert.equal(latestReceipt.user_input, '走向王座')
  assert.equal(env.messages[7].content[0].name, STORY_CONTEXT_TOOL_NAME)
  assert.deepEqual(JSON.parse(env.messages[7].content[0].arguments), { query: 'sync' })

  // 验证 foregroundStrategies 在 envelope + read_story_context 下仍选用 STRICT 提示词并把 allowedToolNames 锁死为 ['submit_story']
  const strategies = createForegroundOrchestrationStrategies({
    nativePlay: {
      async modeFor() { return 'story' },
      filterMessages: m => m,
      async resolvePreset() { return null },
      async prepareTurn() { return { frame: { userInput: { projectedText: '走向王座' } } } },
      appendFrame: ({ messages: m }) => ({ messages: m, receipt: {} }),
      recordFrame() {},
      async visibleTools() { return [STORY_SUBMIT_TOOL_NAME, STORY_CONTEXT_TOOL_NAME] },
      async historyToolCall() { return true },
      async storyOutputToolCall() { return true },
      async storyToolThinking() { return true },
      async historyLayout() { return 'envelope' },
      modePrompt() { return 'story' },
      workspaceContext() { return '' },
      controlledToolNames: new Set([STORY_SUBMIT_TOOL_NAME, STORY_CONTEXT_TOOL_NAME])
    }
  })

  const assembled = await strategies.assembleSystemPrompt(
    { sections: [], contexts: [], tools: [{ name: STORY_SUBMIT_TOOL_NAME }, { name: STORY_CONTEXT_TOOL_NAME }] },
    { sessionId: 'env-sess', chat: { mode: 'story' } }
  )
  const contractText = assembled.sections.find(s => s.name === 'tavern:story-tool-submission').text
  assert.match(contractText, /submit_story 是本轮唯一允许的工具调用/)
  assert.match(contractText, /先在 think 参数中完成充分的剧情构思/)

  await strategies.prepareStep({
    sessionId: 'env-sess',
    chat: { mode: 'story' },
    payload: { turn: 2, step: 1, messages },
    decision: { kind: 'enter', messages }
  })
  const projectedReq = strategies.projectRequest({
    sessionId: 'env-sess',
    provider: 'google',
    model: 'gemini-3-pro',
    system: '角色设定',
    messages,
    tools: [{ name: STORY_SUBMIT_TOOL_NAME }, { name: STORY_CONTEXT_TOOL_NAME }]
  })
  assert.equal(projectedReq.system, ENVELOPE_SYSTEM_SHELL)
  assert.equal(projectedReq.toolChoice, 'any')
  const directive = toolProtocolDirectiveOf(projectedReq)
  assert.deepEqual(directive.allowedToolNames, [STORY_SUBMIT_TOOL_NAME])
  assert.deepEqual(directive.resolveToolSchema(STORY_SUBMIT_TOOL_NAME, {}).order, ['think', 'content'])
  assert.deepEqual(buildStorySubmitWireSchema({ includeThink: false }).order, ['content'])
})

test('设置项校验：storyToolThinking 与 storyToolHistoryMode 持久化与非法值拦截', () => {
  const updated = applyTavernSettingsPatch({}, {
    storyInputToolCall: true,
    storyOutputToolCall: true,
    storyToolThinking: true,
    storyToolHistoryMode: 'envelope'
  })
  const presented = presentTavernSettings(updated)
  assert.equal(presented.storyToolThinking, true)
  assert.equal(presented.storyToolHistoryMode, 'envelope')
  assert.throws(() => applyTavernSettingsPatch({}, { storyToolThinking: 'yes' }), /布尔值/)
  assert.throws(() => applyTavernSettingsPatch({}, { storyToolHistoryMode: 'unknown' }), /无效的工具回放结构/)
})

test('submit_story 从前台工具列表移除，直接与全局设置开关绑定且不受旧档 disabledForegroundTools 屏蔽', async () => {
  for (const mode of ['story', 'script']) {
    const names = foregroundToolCatalog(mode).map(tool => tool.name)
    assert.equal(names.includes(STORY_SUBMIT_TOOL_NAME), false)
    assert.equal(names.includes(STORY_CONTEXT_TOOL_NAME), false)
  }
  assert.deepEqual(
    normalizeDisabledForegroundTools([STORY_SUBMIT_TOOL_NAME, STORY_CONTEXT_TOOL_NAME, 'tavern_recall_history']),
    ['tavern_recall_history']
  )

  let inputSwitch = false
  let outputSwitch = false
  let layoutSwitch = 'story'
  const orchestrator = createTurnOrchestrator({
    frameBuilder: { build() {} },
    storyToolCall: async () => outputSwitch,
    storyInputToolCall: async () => inputSwitch,
    historyLayout: async () => layoutSwitch,
    store: {
      async headerForSession() {
        return {
          mode: 'story',
          disabledForegroundTools: [STORY_SUBMIT_TOOL_NAME, STORY_CONTEXT_TOOL_NAME, 'tavern_recall_history']
        }
      }
    }
  })

  // 设置未开启时，不插入 submit_story
  const whenOff = await orchestrator.visibleTools('s1')
  assert.equal(whenOff.includes(STORY_SUBMIT_TOOL_NAME), false)
  assert.equal(whenOff.includes(STORY_CONTEXT_TOOL_NAME), false)
  assert.equal(whenOff.includes('tavern_recall_history'), false)

  // 开启输出走工具调用后，即使旧存档 disabledForegroundTools 曾含 submit_story，也照常插入
  outputSwitch = true
  const whenOutOn = await orchestrator.visibleTools('s1')
  assert.equal(whenOutOn.includes(STORY_SUBMIT_TOOL_NAME), true)

  // 开启输入走工具调用 + envelope 模式后，同时插入 submit_story 与 read_story_context
  inputSwitch = true
  layoutSwitch = 'envelope'
  const whenEnvelopeOn = await orchestrator.visibleTools('s1')
  assert.equal(whenEnvelopeOn.includes(STORY_SUBMIT_TOOL_NAME), true)
  assert.equal(whenEnvelopeOn.includes(STORY_CONTEXT_TOOL_NAME), true)
})
