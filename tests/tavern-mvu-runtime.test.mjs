import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTavernMvuRuntime,
  extractMvuCommands,
  lastMvuVariables,
  MVU_EVENTS,
  readMvuWorldBookInitialState
} from '../tavern-plugin/lib/domain/tavern-mvu-runtime.js'

function variables(statData) {
  return { initialized_lorebooks: {}, stat_data: structuredClone(statData), schema: { extensible: false, properties: {}, type: 'object' } }
}

test('MVU 按正文顺序提取 JSON Patch 与 lodash 风格命令', () => {
  const commands = extractMvuCommands(`
_.set('角色.体力', 9); // 受伤
<JSONPatch>[{"op":"delta","path":"/角色/体力","value":1}]</JSONPatch>
_.remove('角色.旧状态');
`)

  assert.deepEqual(commands.map(item => item.type), ['set', 'add', 'delete'])
  assert.deepEqual(commands[0].path, ['角色', '体力'])
  assert.equal(commands[0].reason, '受伤')
})

test('MVU 执行标准 JSON Patch 别名、JSON Pointer 转义和数组操作', async () => {
  const runtime = createTavernMvuRuntime()
  const before = variables({
    角色: { 体力: 10, 储物: ['剑'], 标记: { 旧: true } },
    特殊: { 'a/b': 1 }
  })
  const sourceText = `<JSONPatch>
[
  {"op":"replace","path":"/角色/体力","value":8},
  {"op":"delta","path":"/角色/体力","value":2},
  {"op":"add","path":"/角色/储物/-","value":"丹药"},
  {"op":"remove","path":"/角色/标记/旧"},
  {"op":"move","from":"/特殊/a~1b","path":"/特殊/已移动"}
]
</JSONPatch>`

  const result = await runtime.settleResponse({ sourceText, previousVariables: before })

  assert.equal(result.modified, true)
  assert.equal(result.variables.stat_data.角色.体力, 10)
  assert.deepEqual(result.variables.stat_data.角色.储物, ['剑', '丹药'])
  assert.deepEqual(result.variables.stat_data.角色.标记, {})
  assert.deepEqual(result.variables.stat_data.特殊, { 已移动: 1 })
  assert.match(result.sourceText, /<StatusPlaceHolderImpl\/>$/)
  assert.deepEqual(before.stat_data.角色.储物, ['剑'], '上一楼层快照不得被修改')
})

test('MVU 兼容 set、insert、remove、add 并隔离单条失败命令', async () => {
  const runtime = createTavernMvuRuntime()
  const result = await runtime.settleResponse({
    previousVariables: variables({ 角色: { 体力: [10, '当前体力'], 储物: ['剑'], 标记: { 旧: true } } }),
    sourceText: `
_.add('角色.体力', -2);
_.insert('角色.储物', "丹药");
_.remove('角色.标记.旧');
_.set('不存在.字段', 1);
`
  })

  assert.deepEqual(result.variables.stat_data, { 角色: { 体力: [8, '当前体力'], 储物: ['剑', '丹药'], 标记: {} } })
  assert.equal(result.diagnostics.length, 1)
  assert.match(result.diagnostics[0].message, /路径不存在/)
})

test('开场 initvar 覆盖世界书初值并为每个 swipe 建立独立快照', async () => {
  const emitted = []
  const runtime = createTavernMvuRuntime({ emit: async function (name) { emitted.push(name) } })
  const result = await runtime.initializeChat({
    selectedSwipeId: 1,
    baseStatData: { 角色: { 姓名: '世界书', 体力: 1 } },
    macroContext: { userName: '王辰', charName: '灯火' },
    swipes: [
      '<initvar>角色:\n  姓名: "{{user}}"\n  体力: 10</initvar>\n_.add(\'角色.体力\', 2);',
      '没有开场初值'
    ]
  })

  assert.equal(result.swipeId, 1)
  assert.deepEqual(result.variables[0].stat_data, { 角色: { 姓名: '王辰', 体力: 12 } })
  assert.deepEqual(result.variables[1].stat_data, { 角色: { 姓名: '世界书', 体力: 1 } })
  assert.equal(emitted.filter(name => name === MVU_EVENTS.initialized).length, 2)
})

test('世界书只合并启用的 [initvar] 条目并保留嵌套对象', () => {
  const result = readMvuWorldBookInitialState({ entries: [
    { comment: '[initvar] 基础', enabled: true, content: '角色:\n  姓名: "{{user}}"\n  属性:\n    体力: 10' },
    { comment: '[initvar] 补充', enabled: true, content: '```yaml\n角色:\n  属性:\n    灵力: 20\n```' },
    { comment: '[initvar] 禁用', enabled: false, content: '角色:\n  姓名: 错误' },
    { comment: '普通条目', enabled: true, content: '角色:\n  姓名: 错误' }
  ] }, { userName: '王辰' })

  assert.deepEqual(result.statData, { 角色: { 姓名: '王辰', 属性: { 体力: 10, 灵力: 20 } } })
  assert.deepEqual(result.diagnostics, [])
})

test('事件顺序与上一条有效 swipe 快照符合消息结算语义', async () => {
  const emitted = []
  const runtime = createTavernMvuRuntime({ emit: async function (name) { emitted.push(name) } })
  const result = await runtime.settleResponse({
    previousVariables: variables({ 体力: 10 }),
    sourceText: '正文\n_.add("体力", -1);'
  })
  const messages = [
    { role: 'assistant', swipeId: 0, variables: [variables({ 体力: 3 })] },
    { role: 'assistant', swipeId: 1, variables: [variables({ 体力: 8 }), result.variables] }
  ]

  assert.deepEqual(emitted, [
    MVU_EVENTS.updateStarted,
    MVU_EVENTS.commandParsed,
    MVU_EVENTS.updateEnded,
    MVU_EVENTS.beforeMessageUpdate
  ])
  assert.equal(lastMvuVariables(messages).stat_data.体力, 9)
  assert.equal(lastMvuVariables(messages, 1).stat_data.体力, 3)
})

test('COMMAND_PARSED 使用上游 args 形态并允许变量守卫改写命令', async () => {
  const runtime = createTavernMvuRuntime()
  const result = await runtime.settleResponse({
    previousVariables: variables({ 角色: { 体力: 10, 灵力: 3 } }),
    sourceText: '_.set("角色.错误字段", 8);',
    emit: async function (name, current, commands) {
      if (name !== MVU_EVENTS.commandParsed) return
      assert.deepEqual(commands[0].args, ['角色.错误字段', 8])
	  commands[0].args[0] = 'stat_data.角色.体力'
      commands[0].args[1] = 6
      return [current, commands]
    }
  })

  assert.equal(result.variables.stat_data.角色.体力, 6)
  assert.equal(result.diagnostics.length, 0)
})
