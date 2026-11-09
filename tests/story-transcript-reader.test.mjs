import test from 'node:test'
import assert from 'node:assert/strict'
import { createStoryTranscriptReader } from '../tavern-plugin/lib/domain/story-transcript-reader.js'
import { legacyMessageUid } from '../tavern-plugin/lib/domain/message-uid.js'

const header = { id: 'chat', sessionId: 'session', mode: 'story', backgroundConfigVersion: 1 }
const summary = message => ({ role: message.role, turn: message.turn, greeting: message.greeting })

function fixture(messages, { paged = true, revision = 7, regeneratedDshTurns, readToolEvents } = {}) {
  const state = { messages: messages.map(message => ({ ...message })), revision, summariesCalled: 0, fullReads: 0 }
  const window = (before, limit) => {
    const end = before ?? state.messages.length
    const from = Math.max(0, end - limit)
    return {
      chat: { ...header, regeneratedDshTurns, _storageRevision: state.revision, messages: state.messages.slice(from, end).map(message => ({ ...message })) },
      from, to: end - 1, messageCount: state.messages.length, revision: state.revision
    }
  }
  const reader = createStoryTranscriptReader({
    readSessionMap: async () => ({ session: 'chat' }),
    readWindow: async (_chatId, options = {}) => {
      if (!paged) return null
      if (options.revision !== undefined && options.revision !== state.revision) return null
      return window(options.before, options.limit)
    },
    readRecentSummaries: async (_chatId, count, options = {}) => {
      state.summariesCalled++
      if (options.revision !== state.revision) return null
      return { from: 0, messageCount: state.messages.length, messages: state.messages.map(summary), revision: state.revision }
    },
    readChat: async () => {
      state.fullReads++
      return { ...header, regeneratedDshTurns, _storageRevision: state.revision, messages: state.messages.map(message => ({ ...message })) }
    },
    readToolEvents,
    messageFields: ['role', 'turn', 'text'],
    limit: 3
  })
  return { reader, state }
}

const history = [
  { role: 'assistant', greeting: true, turn: 1, text: '开场' },
  { role: 'user', text: '一' },
  { role: 'assistant', turn: 12, text: '正文一' },
  { role: 'user', text: '二' },
  { role: 'assistant', text: '无编号正文' },
  { role: 'assistant', turn: 12, text: '重复编号正文' }
]

test('分页故事首屏只取窗口正文，楼层与全历史顺序一致', async () => {
  const { reader, state } = fixture(history)
  const result = await reader('session')
  assert.equal(result.from, 3)
  assert.equal(result.to, 5)
  assert.equal(result.chat.messages.length, 3)
  assert.equal(result.storyTranscript.floorCount, 4)
  assert.equal(result.storyTranscript.floorOffset, 2)
  assert.deepEqual(result.storyTranscript.messages.map(row => [row.absoluteIndex, row.floorNo, row.key]), [
    [3, null, 'index:3'],
    [4, 3, 'index:4'],
    [5, 4, 'index:5']
  ])
  assert.equal(state.fullReads, 0)
  assert.equal(state.summariesCalled, 1)
})

test('故事传输裁掉插件副本但保留稳定身份与删除选择器', async () => {
  const original = {
    role: 'assistant', turn: 2, text: '正文', sourceText: '原始正文', nativeAnchor: 'native-2',
    displayText: '显示正文', displayMode: 'markdown', projectionVersion: 2, swipeId: 3,
    tavernPluginData: { large: 'x'.repeat(1000) }, variables: { stat: 1 },
    projectionText: '投影原文', swipes: ['候选'], displayRuntime: { frames: [{ html: 'large' }] }
  }
  const { reader } = fixture([original])
  const result = await reader('session')
  const row = result.storyTranscript.messages[0]
  assert.equal(row.messageUid, legacyMessageUid(original, 0), '裁剪必须发生在旧行 UID 计算之后')
  assert.equal(row.message.displayText, '显示正文')
  assert.equal(row.message.swipeId, 3)
  for (const field of ['sourceText', 'nativeAnchor', 'tavernPluginData', 'variables', 'projectionText', 'swipes', 'displayRuntime']) {
    assert.equal(Object.hasOwn(row.message, field), false, field + ' 不应进入故事传输')
  }
})

test('旧存储读取一次完整 Chat，缺 turn 与重复 turn 无需迁移', async () => {
  const { reader, state } = fixture(history, { paged: false })
  const result = await reader('session')
  assert.equal(result.from, 0)
  assert.equal(result.to, history.length - 1)
  assert.equal(result.storyTranscript.floorCount, 4)
  assert.deepEqual(result.storyTranscript.messages.map(row => row.floorNo), [1, null, 2, null, 3, 4])
  assert.equal(state.fullReads, 1)
  assert.equal(state.summariesCalled, 0)
})

test('窗口与摘要 revision 竞争时重试，不混合两个版本', async () => {
  const { state } = fixture(history)
  let calls = 0
  const racing = createStoryTranscriptReader({
    readSessionMap: async () => ({ session: 'chat' }),
    readWindow: async (_chatId, options = {}) => {
      const end = options.before ?? state.messages.length
      const from = Math.max(0, end - options.limit)
      return { chat: { ...header, messages: state.messages.slice(from, end) }, from, to: end - 1, messageCount: state.messages.length, revision: state.revision }
    },
    readRecentSummaries: async () => {
      calls++
      return { from: 0, messageCount: state.messages.length, messages: state.messages.map(summary), revision: calls === 1 ? state.revision - 1 : state.revision }
    },
    readChat: async () => { throw new Error('竞争重试成功时不应全量读取') },
    limit: 3
  })
  const result = await racing('session')
  assert.equal(result.storyTranscript.messages.length, 3)
  assert.equal(calls, 2)
})

test('读取目标不是故事会话时返回 null', async () => {
  const { reader } = fixture(history)
  assert.equal(await reader('other-session'), null)
})

test('工具记录只按需读取，分页和旧存储都使用正文实际对应的原生轮次', async () => {
  const messages = [
    { role: 'assistant', turn: 1, greeting: true, text: '开场' },
    { role: 'assistant', turn: 2, text: '旧楼层' },
    { role: 'assistant', turn: 3, text: '较近楼层' },
    { role: 'user', turn: 4, text: '输入' },
    { role: 'assistant', turn: 4, text: '重生成后的正文' }
  ]
  const call = (turn, callId, name, args = '{}') => ({ type: 'tool/call', data: { turn, callId, name, arguments: args } })
  const result = (turn, message) => ({ type: 'tool/result', data: { turn, message } })
  const output = text => [{ type: 'text', text }]
  const events = [call(1, 'greeting', '不属于开场的工具'), call(2, 'old', '旧楼层的工具'),
    call(3, 'shared-id', '查询'), result(3, { role: 'tool', toolCallId: 'shared-id', content: output('查询结果') }),
    result(3, { role: 'tool', toolCallId: 'shared-id', content: output('被压缩的替代结果') }),
    call(4, 'original', '被替换正文的工具'), call(15, 'shared-id', '重新查询', { query: '新参数' }),
    call(15, 'shared-id', '重复事件'), result(15, { role: 'user', content: [{ type: 'tool-result', toolCallId: 'shared-id', isError: true, content: output('错'.repeat(3000)) }] }),
    call(15, 'pending', '中断的调用'), result(16, { role: 'tool', toolCallId: 'pending', content: output('别的回合') }),
    call(15, 'roll', 'tavern_roll', '{"hidden":true,"reason":"暗骰原因"}'),
    result(15, { role: 'tool', toolCallId: 'roll', content: output('{"roll":43,"hidden":true}') })]
  for (const paged of [true, false]) {
    let reads = 0
    const { reader } = fixture(messages, { paged, regeneratedDshTurns: { 4: 15 }, readToolEvents: async id => {
      assert.equal(id, 'session')
      reads++
      return events
    } })
    const off = await reader('session')
    assert.equal(reads, 0)
    assert.ok(off.storyTranscript.messages.every(row => row.toolCalls === undefined))
    const recent = (await reader('session', undefined, { includeToolCalls: true })).storyTranscript.messages
    assert.equal(reads, 1)
    assert.deepEqual(recent.find(row => row.legacyTurn === 3).toolCalls, [
      { id: 'shared-id', name: '查询', arguments: '{}', status: 'success', result: '查询结果' }
    ])
    const calls = recent.find(row => row.message.role === 'assistant' && row.legacyTurn === 4).toolCalls
    assert.deepEqual(calls.map(({ name, status }) => [name, status]), [['重新查询', 'error'], ['中断的调用', 'unresolved'], ['tavern_roll', 'success']])
    assert.equal(calls[0].arguments, '{"query":"新参数"}')
    assert.match(calls[0].result, /^错{2400}…$/)
    assert.deepEqual(calls[2], { id: 'roll', name: 'tavern_roll', status: 'success' })
    assert.ok(recent.every(row => row.message.role === 'assistant' || row.toolCalls === undefined))
    if (paged) assert.ok(recent.every(row => row.legacyTurn !== 2))
    const older = (await reader('session', 0, { includeToolCalls: true })).storyTranscript.messages
    assert.equal(older.find(row => row.legacyTurn === 2).toolCalls[0].name, '旧楼层的工具')
    assert.equal(older.find(row => row.legacyTurn === 1).toolCalls, undefined)
  }
})
