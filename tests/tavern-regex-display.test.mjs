import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTavernRegexText } from '../tavern-plugin/lib/domain/tavern-regex-display.js'

function script(name, findRegex, replaceString, flags = {}) {
  return {
    name,
    findRegex,
    replaceString,
    trimStrings: flags.trimStrings || [],
    placement: flags.placement || [1, 2],
    enabled: flags.enabled !== false,
    markdownOnly: flags.markdownOnly === true,
    promptOnly: flags.promptOnly === true,
    runOnEdit: flags.runOnEdit === true,
    minDepth: flags.minDepth ?? null,
    maxDepth: flags.maxDepth ?? null
  }
}

test('正则按数组顺序修改同一份字符串并保持未命中内容的位置', () => {
  const result = applyTavernRegexText('前言\n<status>体力 90</status>\n尾声', [
    script('状态', '/<status>(.*?)<\\/status>/s', '<aside>$1</aside>', { markdownOnly: true }),
    script('体力', '体力', 'HP', { markdownOnly: true })
  ], { placement: 2, isMarkdown: true })

  assert.equal(result.text, '前言\n<aside>HP 90</aside>\n尾声')
  assert.deepEqual(result.applied.map(item => item.name), ['状态', '体力'])
})

test('两位数捕获组、match token 和 trimStrings 保持酒馆替换语义', () => {
  const result = applyTavernRegexText('abcdefghijklm', [
    script('捕获组', '/(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)/', '{{match}}|$1|$10|$13', {
      trimStrings: ['abc']
    })
  ], { placement: 2, isMarkdown: true })

  assert.equal(result.text, 'defghijklm|a|j|m')
})

test('损坏规则只产生诊断，后续规则继续执行', () => {
  const result = applyTavernRegexText('进入校园', [
    script('损坏规则', '/[/', '<b>bad</b>'),
    script('可用规则', '校园', '学院')
  ], { placement: 2, isMarkdown: true })

  assert.equal(result.text, '进入学院')
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /损坏规则/)
})

test('placement、depth、runOnEdit、禁用状态共同决定规则是否执行', () => {
  const scripts = [
    script('禁用', '校园', '禁用', { enabled: false }),
    script('用户输入', '校园', '用户', { placement: [1] }),
    script('深度', '校园', '深度', { minDepth: 2, maxDepth: 4 }),
    script('编辑', '校园', '编辑', { runOnEdit: true })
  ]

  assert.equal(applyTavernRegexText('校园', scripts, { placement: 2, isMarkdown: true, depth: 1 }).text, '编辑')
  assert.equal(applyTavernRegexText('校园', scripts, { placement: 2, isMarkdown: true, depth: 3 }).text, '深度')
  assert.equal(applyTavernRegexText('校园', scripts, { placement: 2, isMarkdown: true, depth: 1, isEdit: true }).text, '编辑')
})

test('promptOnly 与 markdownOnly 遵循四种目标组合', () => {
  const cases = [
    { promptOnly: false, markdownOnly: false, display: true, prompt: true },
    { promptOnly: true, markdownOnly: false, display: false, prompt: true },
    { promptOnly: false, markdownOnly: true, display: true, prompt: false },
    { promptOnly: true, markdownOnly: true, display: true, prompt: true }
  ]

  for (const item of cases) {
    const rule = script('测试规则', '校园', '学院', item)
    const display = applyTavernRegexText('校园', [rule], { placement: 2, isMarkdown: true })
    const prompt = applyTavernRegexText('校园', [rule], { placement: 2, isMarkdown: false })
    assert.equal(display.changed, item.display, JSON.stringify(item) + ' display')
    assert.equal(prompt.changed, item.prompt, JSON.stringify(item) + ' prompt')
  }
})
