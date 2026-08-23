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
    card: card(), chat: chat(), playerText: '继续',
    worldBook: { view: { entries: [entry('entry:0', '{{char}} 的故乡常年下雨。', { constant: true })] } }
  })
  assert.equal(direct.kind, 'direct')
  assert.equal(direct.context, '阿芙拉 的故乡常年下雨。')
})

test('超过 200 字时只给常驻标题，并把关键词命中的非常驻正文交给 Agent', () => {
  const long = '远方设定。'.repeat(50)
  const prepared = prepareWorldBookRecall({
    card: card(), chat: chat(), playerText: '我想去钟楼',
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
  assert.match(prepared.taskText, /\[entry:0\] 王都秘史/)
  assert.doesNotMatch(prepared.taskText, /远方设定/)
  assert.match(prepared.taskText, /钟楼藏着商队失踪的线索/)
  assert.doesNotMatch(prepared.taskText, /矿井已经封闭|停用内容/)
  assert.deepEqual(prepared.readConstantEntries(['entry:0']).map(function (item) { return item.title }), ['王都秘史'])
  assert.throws(function () { prepared.readConstantEntries(['entry:2']) }, /不在本轮常驻目录/)
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
    sessionId: 'front-1', turn: 2, chat: run.chat(), card: card(), playerText: '去钟楼',
    worldBook: { view: { entries: [entry('entry:0', '钟楼地下保存着失踪商队的账本。'.repeat(20), { title: '王都秘史', constant: true })] } }
  })

  assert.equal(result.context, '钟楼地下保存着失踪商队的账本。')
  assert.equal(run.chat().timeline.participants.background.sessionId, 'background-1')
  assert.equal(run.chat().lastWorldBookRecall.empty, false)
})

test('后台 Agent 返回空内容是成功结果，失败也回退为空且不阻断', async () => {
  const emptyRun = integrationHarness(async function () {
    return { text: '', traceSessionId: 'background-empty', traceBoundary: 4 }
  })
  const worldBook = { view: { entries: [entry('entry:0', '无关设定。'.repeat(50), { title: '远方', constant: true })] } }
  const empty = await emptyRun.recall.recall({ sessionId: 'front-1', turn: 2, chat: emptyRun.chat(), card: card(), playerText: '继续交谈', worldBook })
  assert.equal(empty.context, '')
  assert.equal(empty.error, null)
  assert.equal(emptyRun.chat().lastWorldBookRecall.empty, true)

  const failedRun = integrationHarness(async function () { throw new Error('模型暂时不可用') })
  const failed = await failedRun.recall.recall({ sessionId: 'front-1', turn: 2, chat: failedRun.chat(), card: card(), playerText: '继续交谈', worldBook })
  assert.equal(failed.context, '')
  assert.equal(failed.error, '模型暂时不可用')
  assert.equal(failedRun.chat().worldBookError, '模型暂时不可用')
})
