import test from 'node:test'
import assert from 'node:assert/strict'

import { applySillyTavernStrictTools } from '../tavern-plugin/lib/domain/sillytavern-strict-tools.js'

test('strict_tools 合并同角色、改写中途 system 并补齐 user 占位', () => {
  const input = [
    { role: 'system', content: '系统一' },
    { role: 'system', content: '系统二' },
    { role: 'assistant', content: '助手' },
    { role: 'system', content: '中途系统' },
    { role: 'user', content: '用户' }
  ]

  const result = applySillyTavernStrictTools(input)

  assert.deepEqual(result.map(function (item) { return [item.role, item.content] }), [
    ['system', '系统一\n\n系统二'],
    ['user', '[Start a new chat]'],
    ['assistant', '助手'],
    ['user', '中途系统\n\n用户']
  ])
  assert.deepEqual(input, [
    { role: 'system', content: '系统一' },
    { role: 'system', content: '系统二' },
    { role: 'assistant', content: '助手' },
    { role: 'system', content: '中途系统' },
    { role: 'user', content: '用户' }
  ])
})

test('strict_tools 按酒馆语义展开示例名称并保留工具字段', () => {
  const result = applySillyTavernStrictTools([
    { role: 'system', name: 'example_assistant', content: '示例回答' },
    { role: 'system', name: 'example_user', content: '示例提问' },
    { role: 'assistant', name: '旁白', content: '继续' },
    { role: 'tool', content: '工具结果', tool_call_id: 'tool-1' }
  ], { charName: '阿芙拉', userName: '玩家' })

  assert.deepEqual(result.map(function (item) { return [item.role, item.content] }), [
    ['system', '阿芙拉: 示例回答\n\n玩家: 示例提问'],
    ['user', '[Start a new chat]'],
    ['assistant', '旁白: 继续'],
    ['tool', '工具结果']
  ])
  assert.equal(result[3].tool_call_id, 'tool-1')
  assert.equal(result.some(function (item) { return Object.hasOwn(item, 'name') }), false)
})

test('strict_tools 空请求生成与酒馆一致的起始占位', () => {
  assert.deepEqual(applySillyTavernStrictTools([]), [
    { role: 'user', content: '[Start a new chat]' }
  ])
})
