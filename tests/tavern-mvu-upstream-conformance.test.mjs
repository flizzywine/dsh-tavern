import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTavernMvuRuntime,
  extractMvuCommands
} from '../tavern-plugin/lib/domain/tavern-mvu-runtime.js'

// Frozen conformance vectors from MagicalAstrogy/MagVarUpdate commit
// 0a730cd4a9b99689d1135a49b542c780b977c24c. JSON Patch cases are the exact
// successful add/replace/remove subset registered by tests/helpers/json_patch_suite.ts
// from json-patch/json-patch-tests commit 2a928f9044aad35c74e2788d498bcf2c6b91adea.
const upstreamJsonPatchCases = [
  {
    name: 'A.1. Adding an Object Member',
    doc: { foo: 'bar' },
    patch: [{ op: 'add', path: '/baz', value: 'qux' }],
    expected: { baz: 'qux', foo: 'bar' }
  },
  {
    name: 'A.2. Adding an Array Element',
    doc: { foo: ['bar', 'baz'] },
    patch: [{ op: 'add', path: '/foo/1', value: 'qux' }],
    expected: { foo: ['bar', 'qux', 'baz'] }
  },
  {
    name: 'A.3. Removing an Object Member',
    doc: { baz: 'qux', foo: 'bar' },
    patch: [{ op: 'remove', path: '/baz' }],
    expected: { foo: 'bar' }
  },
  {
    name: 'A.4. Removing an Array Element',
    doc: { foo: ['bar', 'qux', 'baz'] },
    patch: [{ op: 'remove', path: '/foo/1' }],
    expected: { foo: ['bar', 'baz'] }
  },
  {
    name: 'A.5. Replacing a Value',
    doc: { baz: 'qux', foo: 'bar' },
    patch: [{ op: 'replace', path: '/baz', value: 'boo' }],
    expected: { baz: 'boo', foo: 'bar' }
  },
  {
    name: 'A.10. Adding a nested Member Object',
    doc: { foo: 'bar' },
    patch: [{ op: 'add', path: '/child', value: { grandchild: {} } }],
    expected: { foo: 'bar', child: { grandchild: {} } }
  },
  {
    name: 'A.11. Ignoring Unrecognized Elements',
    doc: { foo: 'bar' },
    patch: [{ op: 'add', path: '/baz', value: 'qux', xyz: 123 }],
    expected: { foo: 'bar', baz: 'qux' }
  },
  {
    name: 'A.16. Adding an Array Value',
    doc: { foo: ['bar'] },
    patch: [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }],
    expected: { foo: ['bar', ['abc', 'def']] }
  }
]

function variables(statData) {
  return {
    initialized_lorebooks: {},
    stat_data: structuredClone(statData),
    display_data: {},
    delta_data: {},
    schema: {}
  }
}

for (const fixture of upstreamJsonPatchCases) {
  test(`MVU 上游 JSON Patch 一致性：${fixture.name}`, async () => {
    const runtime = createTavernMvuRuntime()
    const result = await runtime.settleResponse({
      previousVariables: variables(fixture.doc),
      sourceText: `<JsonPatch>${JSON.stringify(fixture.patch)}</JsonPatch>`
    })

    assert.deepEqual(result.variables.stat_data, fixture.expected)
    assert.deepEqual(result.diagnostics, [])
  })
}

test('MVU 上游一致性：重复或不对称 JSON Patch 标签仍提取内层命令', () => {
  const samples = [
    `<JsonPatch> <JsonPatch>[[PLACEHOLDER]]</JsonPatch>\n<JsonPatch> <JsonPatch>[[PLACEHOLDER_2]]</JsonPatch>`,
    `<json_patch> <JsonPatch>[[PLACEHOLDER]]</JsonPatch>\n<json_patch> <JsonPatch>[[PLACEHOLDER_2]]</JsonPatch>`,
    `<json_patch></json_patch>456 <JsonPatch>[[PLACEHOLDER]]</JsonPatch>fg\n<json_patch> df<JsonPatch>[[PLACEHOLDER_2]]</JsonPatch>123`,
    `<JsonPatch>345456 <json_patch>[[PLACEHOLDER]]</json_patch>2345\n<JsonPatch>46 <json_patch>[[PLACEHOLDER_2]]</json_patch>123`
  ]
  const first = '{"op":"replace","path":"/1","value":["bar","baz"]}'
  const second = '{"op":"replace","path":"/2","value":["bar","baz"]}'

  for (const sample of samples) {
    const source = sample.replace('[[PLACEHOLDER]]', `[${first}]`).replace('[[PLACEHOLDER_2]]', `[${second}]`)
    const commands = extractMvuCommands(source)
    assert.equal(commands.length, 2)
    assert.deepEqual(commands.map(command => command.path), [['1'], ['2']])
  }
})

test('MVU 上游一致性：lodash 命令支持嵌套调用文本、对象字面量和注释', () => {
  const source = `
_.set('悠纪.想对user说的事', ["包含\\"_.set('当前事件',null,'内部');//不是命令\\"的文本"], []);//外层命令
_.set('data', {arr: [1, 2, {nested: "value)"}]}, {arr: [3, 4]});//更新数据
`
  const commands = extractMvuCommands(source)

  assert.equal(commands.length, 2)
  assert.equal(commands[0].reason, '外层命令')
	assert.equal(commands[1].args.at(-1), '{arr: [3, 4]}')
  assert.equal(commands[1].reason, '更新数据')
})

test('MVU 上游一致性：JSON Patch 路径缺少开头斜杠时仍按斜杠分段', async () => {
  const runtime = createTavernMvuRuntime()
  const result = await runtime.settleResponse({
    previousVariables: variables({ 主角: { 备忘录: {} } }),
    sourceText: '<JSONPatch>[{"op":"insert","path":"主角/备忘录/楼道露出任务","value":"Day1 22:00"}]</JSONPatch>'
  })

  assert.deepEqual(result.variables.stat_data, {
    主角: { 备忘录: { 楼道露出任务: 'Day1 22:00' } }
  })
  assert.deepEqual(result.diagnostics, [])
})

test('MVU 上游一致性：add 只接受两个参数，命令保留含注释的 full_match', () => {
  const valid = extractMvuCommands("_.add('player.health', 10); // 恢复生命")
  const invalid = extractMvuCommands("_.add('player.health', 10, 20);//参数过多")

  assert.equal(valid.length, 1)
  assert.equal(valid[0].full_match, "_.add('player.health', 10); // 恢复生命")
  assert.deepEqual(invalid, [])
})

test('MVU 上游一致性：JSON Patch insert 与 move 向 COMMAND_PARSED 暴露官方参数顺序', async () => {
	const seen = []
	const runtime = createTavernMvuRuntime()
	const result = await runtime.settleResponse({
		previousVariables: variables({ bag: ['旧物'], source: 7, target: 0 }),
		sourceText: '<JsonPatch>[{"op":"insert","path":"/bag/-","value":"新物"},{"op":"move","from":"/source","path":"/target"}]</JsonPatch>',
		emit: async function (name, _variables, commands) {
			if (name === 'COMMAND_PARSED') seen.push(structuredClone(commands))
		}
	})

	assert.deepEqual(seen[0].map(command => command.args), [
		['["bag"]', '"-"', '"新物"'],
		['["source"]', '["target"]']
	])
	assert.deepEqual(result.variables.stat_data, { bag: ['旧物', '新物'], target: 7 })
})

test('MVU 上游一致性：lodash 命令使用固定 mathjs 解析数学表达式', async () => {
	const runtime = createTavernMvuRuntime()
	const result = await runtime.settleResponse({
		previousVariables: variables({ 分数: 0, 浓度: 0, 相位: 0, 阻抗: '' }),
		sourceText: [
			"_.set('分数', 100 * 2 + 50);//四则运算",
			"_.set('浓度', log(10^3, 10) * sqrt(144));//函数",
			"_.set('相位', cos(pi) + 2);//常数",
			"_.set('阻抗', (2 + 3i) * (1 - 2i));//复数"
		].join('\n')
	})

	assert.deepEqual(result.variables.stat_data, { 分数: 250, 浓度: 36, 相位: 1, 阻抗: '8 - i' })
	assert.deepEqual(result.diagnostics, [])
})

test('MVU 上游一致性：set 将数字字段中的引号数字转回 number', async () => {
	const runtime = createTavernMvuRuntime()
	const result = await runtime.settleResponse({
		previousVariables: variables({ 体力: 100, 好感度: [10, '角色好感'] }),
		sourceText: [
			"_.set('体力', \"85\");//模型错误地为数字加引号",
			"_.set('好感度', \"12\");//VWD 数字字段"
		].join('\n')
	})

	assert.deepEqual(result.variables.stat_data, { 体力: 85, 好感度: [12, '角色好感'] })
	assert.equal(typeof result.variables.stat_data.体力, 'number')
	assert.equal(typeof result.variables.stat_data.好感度[0], 'number')
	assert.deepEqual(result.diagnostics, [])
})
