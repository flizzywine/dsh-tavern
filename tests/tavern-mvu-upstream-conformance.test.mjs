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
  assert.deepEqual(commands[1].args.at(-1), { arr: [3, 4] })
  assert.equal(commands[1].reason, '更新数据')
})
