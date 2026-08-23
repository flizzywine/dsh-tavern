import assert from 'node:assert/strict'
import test from 'node:test'

import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createWorldBookRecall, prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'

function entry(ref, content, options = {}) {
  return {
    ref,
    title: options.title || ref,
    content,
    enabled: options.enabled !== false,
    constant: options.constant === true,
    primaryKeys: options.primaryKeys || [],
    secondaryKeys: options.secondaryKeys || []
  }
}

function card() { return { name: '阿芙拉' } }

function chat() {
  return {
    id: 'chat-1', cardPath: 'cards/阿芙拉.json', cardName: '阿芙拉', mode: 'story',
    messages: [{ role: 'assistant', text: '两人正在旅店大厅交谈。' }],
    macroState: { userName: '叶舟', local: {}, global: {} }
  }
}

test('未绑定、空世界书和不超过 200 字的世界书不运行 Agent', () => {
  assert.deepEqual(prepareWorldBookRecall({ card: card(), chat: chat(), worldBook: null }), {
    kind: 'skip', context: '', totalChars: 0, reason: 'unbound'
  })
  assert.equal(prepareWorldBookRecall({ card: card(), chat: chat(), worldBook: { view: { entries: [] } } }).kind, 'skip')

  const direct = prepareWorldBookRecall({
    card: card(), chat: chat(),
    worldBook: { view: { entries: [entry('entry:0', '{{char}} 的故乡常年下雨。', { constant: true })] } }
  })
  assert.equal(direct.kind, 'direct')
  assert.equal(direct.context, '阿芙拉 的故乡常年下雨。')
})

test('超过 200 字时常驻和命中的非常驻条目都只给标题，正文统一按需读取', () => {
  const long = '远方设定。'.repeat(50)
  const current = chat()
  current.messages = [{ role: 'assistant', text: '两人抵达钟楼，正在寻找失踪商队的线索。' }]
  const prepared = prepareWorldBookRecall({
    card: card(), chat: current,
    worldBook: {
      view: {
        entries: [
          entry('entry:0', long, { title: '王都秘史', constant: true }),
          entry('entry:1', '钟楼藏着商队失踪的线索。', { title: '钟楼', primaryKeys: ['钟楼'] }),
          entry('entry:2', '矿井已经封闭。', { title: '矿井', primaryKeys: ['矿井'] }),
          entry('entry:3', '停用内容。', { enabled: false, constant: true })
        ]
      }
    }
  })

  assert.equal(prepared.kind, 'agent')
  assert.match(prepared.taskText, /【最新一轮正文】\n两人抵达钟楼/)
  assert.match(prepared.taskText, /\[entry:0\] 王都秘史/)
  assert.doesNotMatch(prepared.taskText, /远方设定/)
  assert.match(prepared.taskText, /\[entry:1\] 钟楼/)
  assert.doesNotMatch(prepared.taskText, /钟楼藏着商队失踪的线索/)
  assert.doesNotMatch(prepared.taskText, /矿井已经封闭|停用内容/)
  assert.deepEqual(prepared.readEntries(['entry:0', 'entry:1']).map(function (item) { return item.title }), ['王都秘史', '钟楼'])
  assert.throws(function () { prepared.readEntries(['entry:2']) }, /不在本轮标题目录/)
})

test('目录读取兼容带标题引用和唯一精确标题，但不模糊猜测', () => {
  const prepared = prepareWorldBookRecall({
    card: card(), chat: chat(),
    worldBook: {
      view: {
        entries: [
          entry('entry:109', '现实世界设定。'.repeat(30), { title: '设定·现实世界线', constant: true }),
          entry('entry:6', '职业设定。'.repeat(30), { title: '设定·职业与转职体系', constant: true }),
          entry('entry:7', '重复一。', { title: '重复标题', constant: true }),
          entry('entry:8', '重复二。', { title: '重复标题', constant: true })
        ]
      }
    }
  })

  assert.deepEqual(prepared.resolveEntryRefs(['[entry:109] 设定·现实世界线', '设定·职业与转职体系']), ['entry:109', 'entry:6'])
  assert.deepEqual(prepared.readEntries(['[entry:109] 设定·现实世界线', '设定·职业与转职体系']).map(function (item) { return item.ref }), ['entry:109', 'entry:6'])
  assert.throws(function () { prepared.readEntries(['现实世界']) }, /不在本轮标题目录/)
  assert.throws(function () { prepared.readEntries(['重复标题']) }, /不在本轮标题目录/)
})

test('关键词只匹配最新一轮正文，不读取玩家行动和更早历史', () => {
  const current = chat()
  current.messages = [
    { role: 'assistant', text: '此前众人曾经讨论矿井。' },
    { role: 'user', text: '我现在要去钟楼。' },
    { role: 'assistant', text: '众人留在旅店大厅继续交谈。' }
  ]
  const prepared = prepareWorldBookRecall({
    card: card(), chat: current,
    worldBook: { view: { entries: [
      entry('entry:0', '足够长的常驻设定。'.repeat(30), { title: '常驻', constant: true }),
      entry('entry:1', '矿井设定。', { title: '矿井', primaryKeys: ['矿井'] }),
      entry('entry:2', '钟楼设定。', { title: '钟楼', primaryKeys: ['钟楼'] }),
      entry('entry:3', '旅店设定。', { title: '旅店', primaryKeys: ['旅店'] })
    ] } }
  })

  assert.match(prepared.taskText, /众人留在旅店大厅继续交谈/)
  assert.match(prepared.taskText, /\[entry:3\] 旅店/)
  assert.doesNotMatch(prepared.taskText, /此前众人|我现在要去钟楼|\[entry:1\]|\[entry:2\]/)
})

function integrationHarness(modelRun) {
  let stored = chat()
  const timeline = createStoryTimeline({ id: (prefix) => prefix + '-1', now: () => 1000 })
  const begun = timeline.apply({ chat: stored, intent: { kind: 'body.begin', turn: 2, userText: '去钟楼' } })
  stored = begun.chat
  const calls = []
  const recall = createWorldBookRecall({
    store: {
      async writeChat(value) { stored = structuredClone(value) },
      async readChat() { return structuredClone(stored) }
    },
    timeline,
    model: {
      selection() { return { provider: 'test', model: 'scripted' } },
      async run(input) { calls.push(input); return await modelRun(input) }
    },
    prompt(name) { assert.equal(name, 'worldbook-recall'); return '世界书规则' },
    now: () => 2000,
    logger: { error() {} }
  })
  return { recall, chat: () => structuredClone(stored), calls }
}

test('后台召回最终文本直接成为上下文，并复用 background participant', async () => {
  const run = integrationHarness(async function (input) {
    assert.equal(input.task, 'worldbook')
    assert.equal(input.tools[0].name, 'tavern_read_worldbook_entries')
    const read = JSON.parse(await input.onToolCall({ name: 'tavern_read_worldbook_entries', arguments: { entries: ['entry:0'] } }))
    assert.equal(read.entries[0].title, '王都秘史')
    return { text: '钟楼地下保存着失踪商队的账本。', traceSessionId: 'background-1', traceBoundary: 9 }
  })
  const result = await run.recall.recall({
    sessionId: 'front-1', turn: 2, chat: run.chat(), card: card(),
    worldBook: { view: { entries: [entry('entry:0', '钟楼地下保存着失踪商队的账本。'.repeat(20), { title: '王都秘史', constant: true })] } }
  })

  assert.equal(result.context, '钟楼地下保存着失踪商队的账本。')
  assert.equal(run.chat().timeline.participants.background.sessionId, 'background-1')
  assert.equal(run.chat().lastWorldBookRecall.empty, false)
})

test('失败调用不消耗读取额度，重试相同条目只按不同有效引用计数', async () => {
  const entries = Array.from({ length: 9 }, function (_value, index) {
    return entry('entry:' + index, ('设定 ' + index + '。').repeat(20), { title: '设定·' + index, constant: true })
  })
  const run = integrationHarness(async function (input) {
    await assert.rejects(input.onToolCall({ name: 'tavern_read_worldbook_entries', arguments: { entries: ['不存在的标题'] } }), /不在本轮标题目录/)
    const first = JSON.parse(await input.onToolCall({ name: 'tavern_read_worldbook_entries', arguments: { entries: ['[entry:0] 设定·0', '设定·1', 'entry:2', 'entry:3', 'entry:4'] } }))
    assert.equal(first.entries.length, 5)
    const retry = JSON.parse(await input.onToolCall({ name: 'tavern_read_worldbook_entries', arguments: { entries: ['设定·0', 'entry:1', 'entry:5', 'entry:6', 'entry:7'] } }))
    assert.equal(retry.entries.length, 5)
    await assert.rejects(input.onToolCall({ name: 'tavern_read_worldbook_entries', arguments: { entries: ['entry:8'] } }), /最多读取 8 条/)
    return { text: '', traceSessionId: 'background-1', traceBoundary: 9 }
  })
  const result = await run.recall.recall({ sessionId: 'front-1', turn: 2, chat: run.chat(), card: card(), worldBook: { view: { entries } } })

  assert.equal(result.error, null)
})

test('已读条目隐藏十轮但仍允许按引用重读，重读后重新计算冷却', async () => {
  const worldBook = { view: { entries: [
    entry('entry:0', '钟楼地下保存着失踪商队的账本。'.repeat(20), { title: '王都秘史', constant: true })
  ] } }
  let invocation = 0
  const run = integrationHarness(async function (input) {
    invocation += 1
    if (invocation === 1) assert.match(input.messages[0].content[0].text, /\[entry:0\] 王都秘史/)
    else assert.doesNotMatch(input.messages[0].content[0].text, /\[entry:0\] 王都秘史/)
    const read = JSON.parse(await input.onToolCall({
      name: 'tavern_read_worldbook_entries',
      arguments: { entries: [invocation === 1 ? 'entry:0' : '王都秘史'] }
    }))
    assert.equal(read.entries[0].title, '王都秘史')
    return { text: '', traceSessionId: 'background-1', traceBoundary: invocation * 10 }
  })

  await run.recall.recall({ sessionId: 'front-1', turn: 2, chat: run.chat(), card: card(), worldBook })
  assert.equal(run.chat().worldBookReads['entry:0'].turn, 2)
  await run.recall.recall({ sessionId: 'front-1', turn: 3, chat: run.chat(), card: card(), worldBook })
  assert.equal(run.chat().worldBookReads['entry:0'].turn, 3)

  const stillHidden = prepareWorldBookRecall({ card: card(), chat: run.chat(), turn: 13, worldBook })
  assert.doesNotMatch(stillHidden.taskText, /\[entry:0\] 王都秘史/)
  const visibleAgain = prepareWorldBookRecall({ card: card(), chat: run.chat(), turn: 14, worldBook })
  assert.match(visibleAgain.taskText, /\[entry:0\] 王都秘史/)
})

test('冷却中的世界书条目内容变化后立即重新进入目录', async () => {
  const original = { view: { entries: [entry('entry:0', '旧设定。'.repeat(60), { title: '王都秘史', constant: true })] } }
  const run = integrationHarness(async function (input) {
    await input.onToolCall({ name: 'tavern_read_worldbook_entries', arguments: { entries: ['entry:0'] } })
    return { text: '', traceSessionId: 'background-1', traceBoundary: 10 }
  })
  await run.recall.recall({ sessionId: 'front-1', turn: 2, chat: run.chat(), card: card(), worldBook: original })

  const changed = { view: { entries: [entry('entry:0', '修改后的新设定。'.repeat(60), { title: '王都秘史', constant: true })] } }
  const prepared = prepareWorldBookRecall({ card: card(), chat: run.chat(), turn: 3, worldBook: changed })
  assert.match(prepared.taskText, /\[entry:0\] 王都秘史/)
})

test('后台 Agent 返回空内容是成功结果，失败也回退为空且不阻断', async () => {
  const emptyRun = integrationHarness(async function () {
    return { text: '', traceSessionId: 'background-empty', traceBoundary: 4 }
  })
  const worldBook = { view: { entries: [entry('entry:0', '无关设定。'.repeat(50), { title: '远方', constant: true })] } }
  const empty = await emptyRun.recall.recall({ sessionId: 'front-1', turn: 2, chat: emptyRun.chat(), card: card(), worldBook })
  assert.equal(empty.context, '')
  assert.equal(empty.error, null)
  assert.equal(emptyRun.chat().lastWorldBookRecall.empty, true)

  const failedRun = integrationHarness(async function () { throw new Error('模型暂时不可用') })
  const failed = await failedRun.recall.recall({ sessionId: 'front-1', turn: 2, chat: failedRun.chat(), card: card(), worldBook })
  assert.equal(failed.context, '')
  assert.equal(failed.error, '模型暂时不可用')
  assert.equal(failedRun.chat().worldBookError, '模型暂时不可用')
})
