import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeGameSettings } from '../tavern-plugin/lib/domain/plugin-game-settings.js'
import { GAME_SETTINGS_SCHEMA, apply, inject, name } from '../tavern-plugin/packages/dsh-tavern-tool-trace-cleaner/lib/index.js'
import { cleanContextMessages, createStreamingBodyCleaner } from '../tavern-plugin/packages/dsh-tavern-tool-trace-cleaner/lib/cleaner.js'
import { stripBodyTextTraces } from '../tavern-plugin/packages/dsh-tavern-tool-trace-cleaner/lib/matcher.js'

test('plugin exports and gameSettings schema pass Tavern host validation', () => {
  assert.equal(name, 'dsh-tavern-tool-trace-cleaner')
  assert.deepEqual(inject, ['tavern'])
  const normalized = normalizeGameSettings(GAME_SETTINGS_SCHEMA)
  assert.equal(normalized.title, '工具痕迹清理')
  assert.ok(normalized.fields.length >= 8)
})

test('L1 strips 4 foreground tool pairs in completed turns, preserves current turn, non-target tools, and tvh_ synthetic history', () => {
  const messages = [
    // 合成历史（tvh_）必须原样保留
    {
      id: 'h1',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'tvh_abc123', name: 'tavern_recall_history', arguments: '{"content":"旧剧情"}' }]
    },
    {
      id: 'h1:receipt',
      role: 'tool',
      toolCallId: 'tvh_abc123',
      source: { kind: 'tool', callId: 'tvh_abc123' },
      content: [{ type: 'text', text: '已收到。' }]
    },
    // 第 1 轮玩家输入
    { id: 'u1', role: 'user', content: [{ type: 'text', text: '推开门看看里面有什么。' }] },
    // 第 1 轮工具调用：读变量 + 查世界书 + 召回历史 + 掷骰子（非目标工具）
    {
      id: 'a1-tools',
      role: 'assistant',
      content: [
        { type: 'tool-call', id: 'c_var', name: 'tavern_read_variables', arguments: '{"action":"list"}' },
        { type: 'tool-call', id: 'c_wb', name: 'query_lorebook', arguments: '{"action":"search","query":"古堡"}' },
        { type: 'tool-call', id: 'c_hist', name: 'tavern_recall_history', arguments: '{"query":"钥匙"}' },
        { type: 'tool-call', id: 'c_roll', name: 'tavern_roll', arguments: '{"expr":"1d20"}' }
      ]
    },
    { id: 'r_var', role: 'tool', toolCallId: 'c_var', source: { kind: 'tool', callId: 'c_var' }, content: [{ type: 'text', text: '{"hp":10}' }] },
    { id: 'r_wb', role: 'tool', toolCallId: 'c_wb', source: { kind: 'tool', callId: 'c_wb' }, content: [{ type: 'text', text: '古堡设定' }] },
    { id: 'r_hist', role: 'tool', toolCallId: 'c_hist', source: { kind: 'tool', callId: 'c_hist' }, content: [{ type: 'text', text: '上次拿到铜钥匙' }] },
    { id: 'r_roll', role: 'tool', toolCallId: 'c_roll', source: { kind: 'tool', callId: 'c_roll' }, content: [{ type: 'text', text: '18' }] },
    // 第 1 轮纯工具空壳 assistant（全部被清后应整条移除）
    {
      id: 'a1-only-wb',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'c_wb_legacy', name: 'worldbook_grep', arguments: '{"q":"大厅"}' }]
    },
    // 兼容 DSH 0.1.5 的 user 内嵌 tool-result
    {
      id: 'r_wb_legacy',
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: 'c_wb_legacy', content: '大厅设定' }]
    },
    // 第 1 轮正文
    { id: 'a1-body', role: 'assistant', content: [{ type: 'text', text: '门轴发出低沉的吱呀声，灰尘在光柱里缓缓飘落。' }] },
    // 当前轮（第 2 轮）：正在 tool-loop 中，必须完整保留！
    { id: 'u2', role: 'user', content: [{ type: 'text', text: '检查壁炉。' }] },
    {
      id: 'a2-tools',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'c_var_now', name: 'tavern_read_variables', arguments: '{"action":"list"}' }]
    },
    { id: 'r_var_now', role: 'tool', toolCallId: 'c_var_now', source: { kind: 'tool', callId: 'c_var_now' }, content: [{ type: 'text', text: '{"hp":9}' }] }
  ]

  const result = cleanContextMessages(messages, {
    enabled: true,
    cleanReadVariables: true,
    cleanWorldbook: true,
    cleanRecallHistory: true,
    skillPolicy: 'keep-latest'
  })

  assert.equal(result.changed, true)
  assert.equal(result.stats.removedToolCalls, 4)
  assert.equal(result.stats.removedToolResults, 4)
  assert.equal(result.stats.removedEmptyMessages, 2) // a1-only-wb + r_wb_legacy

  const ids = result.messages.map(m => m.id)
  assert.deepEqual(ids, ['h1', 'h1:receipt', 'u1', 'a1-tools', 'r_roll', 'a1-body', 'u2', 'a2-tools', 'r_var_now'])

  // a1-tools 只剩 tavern_roll
  const a1Tools = result.messages.find(m => m.id === 'a1-tools')
  assert.equal(a1Tools.content.length, 1)
  assert.equal(a1Tools.content[0].name, 'tavern_roll')

  // 原数组未被原地修改
  assert.equal(messages.find(m => m.id === 'a1-tools').content.length, 4)
})

test('L1 skillPolicy keep-latest keeps only latest skill invocation, while all strips all historical skills', () => {
  const messages = [
    { id: 'u1', role: 'user', content: [{ type: 'text', text: '第一轮' }] },
    {
      id: 'a1-sk',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'sk_1', name: 'skill', arguments: '{"name":"novel-style"}' }]
    },
    { id: 'r_sk1', role: 'tool', toolCallId: 'sk_1', content: [{ type: 'text', text: '<skill_content name="novel-style">v1</skill_content>' }] },
    {
      id: 'inj_1',
      role: 'user',
      source: { kind: 'skill-invocation', name: 'novel-style', form: 'instructions' },
      content: [{ type: 'text', text: '<skill_content name="novel-style">old</skill_content>' }]
    },
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '第一段正文。' }] },
    { id: 'u2', role: 'user', content: [{ type: 'text', text: '第二轮' }] },
    {
      id: 'a2-sk',
      role: 'assistant',
      content: [{ type: 'tool-call', id: 'sk_2', name: 'skill', arguments: '{"name":"novel-style"}' }]
    },
    { id: 'r_sk2', role: 'tool', toolCallId: 'sk_2', content: [{ type: 'text', text: '<skill_content name="novel-style">v2</skill_content>' }] },
    {
      id: 'inj_2',
      role: 'user',
      source: { kind: 'skill-invocation', name: 'novel-style', form: 'instructions' },
      content: [{ type: 'text', text: '<skill_content name="novel-style">new</skill_content>' }]
    },
    { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '第二段正文。' }] },
    { id: 'u3', role: 'user', content: [{ type: 'text', text: '第三轮' }] }
  ]

  const keepLatest = cleanContextMessages(messages, { skillPolicy: 'keep-latest' })
  assert.deepEqual(keepLatest.messages.map(m => m.id), ['u1', 'a1', 'u2', 'a2-sk', 'r_sk2', 'inj_2', 'a2', 'u3'])

  const stripAll = cleanContextMessages(messages, { skillPolicy: 'all' })
  assert.deepEqual(stripAll.messages.map(m => m.id), ['u1', 'a1', 'u2', 'a2', 'u3'])

  const stripOff = cleanContextMessages(messages, { skillPolicy: 'off' })
  assert.equal(stripOff.changed, false)
})

test('L2 stripBodyTextTraces strips leaked XML/tool JSON without harming normal dialogue', () => {
  const dirty = [
    '<skill_content name="novel-style"><skill_instructions>rule</skill_instructions></skill_content>',
    '```json',
    '{"name":"query_lorebook","arguments":{"action":"search","query":"王城"}}',
    '```',
    '她合上手里的世界书，低声说：“我先查阅一下历史记录，看看那个技能到底怎么用。”'
  ].join('\n')

  const cleaned = stripBodyTextTraces(dirty, { enabled: true, cleanBodyText: true, stripMetaPrefix: true })
  assert.equal(cleaned, '她合上手里的世界书，低声说：“我先查阅一下历史记录，看看那个技能到底怎么用。”')

  const withMeta = '我先查询一下世界书和当前变量：\n\n夜风穿过廊柱，火把明灭不定。'
  assert.equal(
    stripBodyTextTraces(withMeta, { enabled: true, cleanBodyText: true, stripMetaPrefix: false }),
    withMeta
  )
  assert.equal(
    stripBodyTextTraces(withMeta, { enabled: true, cleanBodyText: true, stripMetaPrefix: true }),
    '夜风穿过廊柱，火把明灭不定。'
  )
})

test('L2 streaming rewriter buffers split <skill_content> tags across chunks and strips them cleanly', async () => {
  const rewriter = createStreamingBodyCleaner(async () => ({ enabled: true, cleanBodyText: true }))

  // 未闭合的 <skill_content> 应该暂缓切分（返回 null）
  assert.equal(rewriter.plan('前文。\n<skill_content name="a">内容未完', { eof: false }), null)

  // 闭合后立刻切出并清洗
  const buf = '前文。\n<skill_content name="a">内容未完</skill_content>后文。'
  const cut = rewriter.plan(buf, { eof: false })
  assert.ok(cut > 0)
  const out = await rewriter.rewrite(buf.slice(0, cut), { sessionId: 'game-1' })
  assert.equal(out, '前文。\n')
})

test('apply(ctx) wires L1 pre-step (skipping background sessions) and L2 settled fallback without loop', async () => {
  let preStepHandler = null
  let settledHandler = null
  let registeredRewriter = null
  const editCalls = []

  const fakeCtx = {
    on(event, handler) {
      if (event === 'agent/pre-step') preStepHandler = handler
      return () => { preStepHandler = null }
    },
    tavern: {
      gameSettings() { return () => {} },
      onGameSettingsChanged() { return () => {} },
      async getGameSettings() { return { enabled: true, cleanReadVariables: true, cleanBodyText: true } },
      async getTurnState({ gameId }) {
        if (gameId === 'game-main') return { gameId, latestTurn: 2 }
        throw Object.assign(new Error('not found'), { code: 'TAVERN_PLUGIN_NOT_FOUND' })
      },
      replyRewriter(rw) {
        registeredRewriter = rw
        return () => { registeredRewriter = null }
      },
      onTurnSettled(fn) {
        settledHandler = fn
        return () => { settledHandler = null }
      },
      async editTurn(args) {
        editCalls.push(args)
        return { ...args, textVersion: 'v2' }
      }
    }
  }

  const dispose = apply(fakeCtx)
  assert.ok(preStepHandler)
  assert.ok(settledHandler)
  assert.ok(registeredRewriter)

  const sampleMessages = [
    { id: 'u1', role: 'user', content: [{ type: 'text', text: '一' }] },
    { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'tavern_read_variables', arguments: '{}' }] },
    { id: 'r1', role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '{}' }] },
    { id: 'u2', role: 'user', content: [{ type: 'text', text: '二' }] }
  ]

  // 后台子代理会话：必须原样放行
  const bgDecision = await preStepHandler(
    { agent: { session: { id: 'bg-settlement-1' } } },
    async () => ({ kind: 'enter', messages: sampleMessages })
  )
  assert.equal(bgDecision.messages.length, 4)

  // 前台游戏主会话：清理历史轮读变量痕迹
  const fgDecision = await preStepHandler(
    { agent: { session: { id: 'game-main' } } },
    async () => ({ kind: 'enter', messages: sampleMessages })
  )
  assert.deepEqual(fgDecision.messages.map(m => m.id), ['u1', 'u2'])

  // L2 结算兜底：编辑一次后再次收到新版本不重复编辑
  await settledHandler({
    gameId: 'game-main',
    turn: 2,
    textVersion: 'v1',
    text: '<tool_call>{"name":"query_lorebook"}</tool_call>\n正文内容。'
  })
  assert.equal(editCalls.length, 1)
  assert.equal(editCalls[0].text, '正文内容。')

  await settledHandler({
    gameId: 'game-main',
    turn: 2,
    textVersion: 'v2',
    text: '正文内容。'
  })
  assert.equal(editCalls.length, 1)

  dispose()
  assert.equal(preStepHandler, null)
  assert.equal(settledHandler, null)
  assert.equal(registeredRewriter, null)
})
