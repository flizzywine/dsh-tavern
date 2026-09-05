import assert from 'node:assert/strict'
import test from 'node:test'

import {
  constantWorldBookContext,
  mvuUpdateRulesFromWorldBook,
  projectWorldBookTemplates,
  prepareWorldBookRecall
} from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { TavernPromptTemplateRuntime } from '../tavern-plugin/lib/domain/tavern-prompt-template-runtime.js'

function entry(ref, content, options = {}) {
  return {
    ref,
    title: options.title || ref,
    content,
    enabled: options.enabled !== false,
    constant: options.constant === true,
    primaryKeys: options.primaryKeys || [],
    secondaryKeys: options.secondaryKeys || [],
    selective: options.selective === true,
    selectiveLogic: options.selectiveLogic ?? 0,
    caseSensitive: options.caseSensitive ?? null,
    matchWholeWords: options.matchWholeWords ?? null,
    order: options.order ?? 100,
    displayIndex: options.displayIndex ?? Number(ref.replace(/\D/g, '') || 0)
  }
}

function card() { return { name: '阿芙拉' } }

function chat(body = '两人正在旅店大厅交谈。') {
  return {
    id: 'chat-1', cardPath: 'cards/阿芙拉.json', cardName: '阿芙拉', mode: 'story',
    messages: [{ role: 'assistant', text: body, turn: 2 }],
    macroState: { userName: '叶舟', local: {}, global: {} }
  }
}

test('常驻条目按 Tavern order 进入稳定前缀，不受动态三条上限和冷却影响', function () {
  const worldBook = { view: { entries: [
    entry('entry:0', '{{char}} 的故乡常年下雨。', { constant: true, order: 100 }),
    entry('entry:1', '王室法律优先执行。', { constant: true, order: 300 }),
    entry('entry:2', '停用内容。', { constant: true, enabled: false, order: 999 }),
    entry('entry:3', '钟楼秘密。', { primaryKeys: ['钟楼'], order: 500 })
  ] } }

  const result = constantWorldBookContext({ worldBook })

  assert.equal(result.count, 2)
  assert.equal(result.context, '王室法律优先执行。\n\n{{char}} 的故乡常年下雨。')
  assert.doesNotMatch(result.context, /停用|钟楼秘密/)
})

test('非常驻条目只匹配最新一轮正文，按 Tavern order 取前三条', function () {
  const current = chat('众人抵达钟楼，并在雨夜发现一扇暗门。')
  current.messages.unshift(
    { role: 'assistant', text: '更早以前曾去过矿井。', turn: 1 },
    { role: 'user', text: '我准备调查王宫。', turn: 2 }
  )
  const worldBook = { view: { entries: [
    entry('entry:0', '低优先级钟楼。', { primaryKeys: ['钟楼'], order: 10 }),
    entry('entry:1', '高优先级钟楼。', { primaryKeys: ['钟楼'], order: 400 }),
    entry('entry:2', '暗门机关。', { primaryKeys: ['暗门'], order: 300 }),
    entry('entry:3', '雨夜规则。', { primaryKeys: ['雨夜'], order: 200 }),
    entry('entry:4', '矿井规则。', { primaryKeys: ['矿井'], order: 900 }),
    entry('entry:5', '王宫规则。', { primaryKeys: ['王宫'], order: 800 })
  ] } }

  const prepared = prepareWorldBookRecall({ card: card(), chat: current, turn: 2, worldBook })

  assert.equal(prepared.kind, 'keywords')
  assert.deepEqual(prepared.refs, ['entry:1', 'entry:2', 'entry:3'])
  assert.equal(prepared.context, '高优先级钟楼。\n\n暗门机关。\n\n雨夜规则。')
  assert.doesNotMatch(prepared.context, /低优先级|矿井|王宫/)
})

test('主副关键词遵守 Tavern 四种 selectiveLogic，正则关键词可参与匹配', function () {
  const worldBook = { view: { entries: [
    entry('entry:0', 'AND_ANY', { primaryKeys: ['钟楼'], secondaryKeys: ['午夜', '正午'], selective: true, selectiveLogic: 0, order: 400 }),
    entry('entry:1', 'NOT_ALL', { primaryKeys: ['钟楼'], secondaryKeys: ['午夜', '正午'], selective: true, selectiveLogic: 1, order: 300 }),
    entry('entry:2', 'NOT_ANY', { primaryKeys: ['钟楼'], secondaryKeys: ['卫兵'], selective: true, selectiveLogic: 2, order: 200 }),
    entry('entry:3', 'AND_ALL', { primaryKeys: ['/钟楼/u'], secondaryKeys: ['午夜', '暗门', '正午'], selective: true, selectiveLogic: 3, order: 100 })
  ] } }

  const prepared = prepareWorldBookRecall({
    card: card(), chat: chat('午夜，众人抵达钟楼并发现暗门。'), turn: 2, worldBook
  })

  assert.deepEqual(prepared.refs, ['entry:0', 'entry:1', 'entry:2'])
  assert.doesNotMatch(prepared.context, /AND_ALL/)
})

test('只有实际注入的三条进入十轮冷却，未入选条目下一轮仍可竞争', function () {
  const entries = [0, 1, 2, 3].map(function (index) {
    return entry('entry:' + index, '设定 ' + index, { primaryKeys: ['钟楼'], order: 400 - index * 100 })
  })
  const worldBook = { view: { entries } }
  const first = prepareWorldBookRecall({ card: card(), chat: chat('抵达钟楼。'), turn: 2, worldBook })
  const reads = first.recordReads(null)

  assert.deepEqual(Object.keys(reads), ['entry:0', 'entry:1', 'entry:2'])

  const nextChat = chat('仍在钟楼。')
  nextChat.worldBookReads = reads
  const next = prepareWorldBookRecall({ card: card(), chat: nextChat, turn: 3, worldBook })
  assert.deepEqual(next.refs, ['entry:3'])

  const afterTen = prepareWorldBookRecall({ card: card(), chat: nextChat, turn: 12, worldBook })
  assert.deepEqual(afterTen.refs, ['entry:3'])
  const afterEleven = prepareWorldBookRecall({ card: card(), chat: nextChat, turn: 13, worldBook })
  assert.deepEqual(afterEleven.refs, ['entry:0', 'entry:1', 'entry:2'])
})

test('条目正文改变后立即解除冷却，空世界书直接跳过', function () {
  const skipped = prepareWorldBookRecall({ card: card(), chat: chat(), worldBook: null })
  assert.equal(skipped.kind, 'skip')
  assert.equal(skipped.context, '')
  assert.deepEqual(skipped.refs, [])

  const original = entry('entry:0', '旧设定。', { primaryKeys: ['钟楼'] })
  const first = prepareWorldBookRecall({ card: card(), chat: chat('抵达钟楼。'), turn: 2, worldBook: { view: { entries: [original] } } })
  const current = chat('仍在钟楼。')
  current.worldBookReads = first.recordReads(null)
  const changed = entry('entry:0', '修改后的新设定。', { primaryKeys: ['钟楼'] })

  const prepared = prepareWorldBookRecall({ card: card(), chat: current, turn: 3, worldBook: { view: { entries: [changed] } } })
  assert.deepEqual(prepared.refs, ['entry:0'])
  assert.equal(prepared.context, '修改后的新设定。')
})

test('[mvu_update] 只进入后台变量规则，不再要求前台剧情模型输出协议', function () {
  const update = entry('entry:0', '每轮按正文更新体力。', { constant: true, title: '[mvu_update]变量更新' })
  const plot = entry('entry:1', '古殿深处传来水声。', { constant: true, title: '[mvu_plot]剧情规则' })
  const worldBook = { view: { entries: [update, plot] } }

  assert.equal(constantWorldBookContext({ worldBook }).context, '古殿深处传来水声。')
  assert.deepEqual(mvuUpdateRulesFromWorldBook(worldBook), ['每轮按正文更新体力。'])
})

test('原生世界书把 EJS 控制器移出稳定前缀，并可按最新 MVU 变量读取停用资料条目', async function () {
  const runtime = await TavernPromptTemplateRuntime.create()
  const worldBook = { view: { displayName: '测试世界书', entries: [
    entry('entry:0', '始终可见的静态规则。', { constant: true, order: 300 }),
    {
      ...entry('entry:1', '@@preprocessing\n<% if (getvar("stat_data.stage") === "觉醒") print(await getwi("觉醒资料")) %>', { constant: true, order: 200 }),
      comment: '阶段控制器', title: '阶段控制器', sourceUid: 1
    },
    {
      ...entry('entry:2', '仅在觉醒阶段注入的完整设定。', { constant: true, enabled: false, order: 100 }),
      comment: '觉醒资料', title: '觉醒资料', sourceUid: 2
    }
  ] } }

  const stable = constantWorldBookContext({ worldBook })
  const projected = projectWorldBookTemplates({
    worldBook,
    runtime,
    card: { name: '阿芙拉' },
    chat: {
      macroState: { userName: '叶舟', global: {} },
      variables: {},
      messages: [{ role: 'assistant', text: '她抬起头。', variables: [{ stat_data: { stage: '觉醒' } }] }]
    }
  })

  assert.equal(stable.context, '始终可见的静态规则。')
  assert.doesNotMatch(stable.context, /preprocessing|getwi|觉醒资料/)
  assert.equal(projected.context, '仅在觉醒阶段注入的完整设定。')
  assert.deepEqual(projected.refs, ['entry:1'])
  assert.deepEqual(projected.diagnostics, [])
  assert.doesNotMatch(projected.context, /<%|getwi|@@preprocessing/)
})

test('原生世界书控制器失败时局部跳过，不把模板源码发送给正文模型', async function () {
  const runtime = await TavernPromptTemplateRuntime.create()
  const worldBook = { view: { entries: [
    entry('entry:0', '静态规则。', { constant: true }),
    entry('entry:1', '@@preprocessing\n<% if ( %>泄漏源码', { constant: true })
  ] } }

  const stable = constantWorldBookContext({ worldBook })
  const projected = projectWorldBookTemplates({ worldBook, runtime, card: card(), chat: chat() })

  assert.equal(stable.context, '静态规则。')
  assert.equal(projected.context, '')
  assert.deepEqual(projected.diagnostics, [{ kind: 'worldbook-template', code: 'syntax-error', ref: 'entry:1' }])
})
