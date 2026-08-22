import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTavernMacros } from '../tavern-plugin/lib/domain/tavern-macro-engine.js'

test('没有玩家名时把 user 宏解析为第二人称“你”', () => {
  const result = renderTavernMacros('{{user}}走到门口。', { charName: '命运' })
  assert.equal(result.text, '你走到门口。')
})

test('解析 user 和 char 环境宏而不修改原始文本', () => {
  const raw = '{{char}} 看向 {{ user }}。'
  const result = renderTavernMacros(raw, { charName: '命运', userName: '陈锋' })
  assert.equal(result.text, '命运 看向 陈锋。')
  assert.equal(raw, '{{char}} 看向 {{ user }}。')
})

test('执行局部变量宏并返回可持久化快照', () => {
  const result = renderTavernMacros('{{setvar::level::1}}{{incvar::level}}Lv{{.level}}', {})
  assert.equal(result.text, '2Lv2')
  assert.deepEqual(result.localVariables, { level: 2 })
})

test('解析命运人物卡使用的默认值与嵌套条件', () => {
  const source = '{{setvar::mode::0}}{{setvar::level::1}}<b>{{.level || 9}}</b>{{if {{.mode == 1}} }}自由冒险{{else}}邪天主线{{/if}}'
  const result = renderTavernMacros(source, { charName: '命运' })
  assert.equal(result.text, '<b>1</b>邪天主线')
  assert.deepEqual(result.localVariables, { mode: '0', level: '1' })
})

test('兼容命运人物卡把默认值运算符写在 getvar 宏中的旧写法', () => {
  const existing = renderTavernMacros('阶段 {{getvar::stage || 1}}，模式 {{getvar::mode || 0}}', {
    localVariables: { stage: 2, mode: '1' }
  })
  assert.equal(existing.text, '阶段 2，模式 1')

  const missing = renderTavernMacros('阶段 {{getvar::stage || 1}}，模式 {{getvar::mode || 0}}', {})
  assert.equal(missing.text, '阶段 1，模式 0')
})

test('未知宏原样保留', () => {
  assert.equal(renderTavernMacros('{{future::value}}', {}).text, '{{future::value}}')
})

test('递归执行命运开场白中转义的延迟状态宏', () => {
  const source = '{{setvar::stage::1}}{{setvar::mode::0}}进入第\\{\\{incvar::stage\\}\\}阶段｜\\{\\{setvar::mode::1\\}\\}自由冒险'
  const result = renderTavernMacros(source, {})

  assert.equal(result.text, '进入第2阶段｜自由冒险')
  assert.deepEqual(result.localVariables, { stage: 2, mode: '1' })
})
