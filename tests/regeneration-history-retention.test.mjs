import assert from 'node:assert/strict'
import test from 'node:test'

import { projectRegenerationRequestMessages } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

function player(text, id = '') {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function body(text) {
  return { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } }
}

function frame(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-tavern', form: 'foreground-frame' } }
}

function writingRules(text) {
  const rendered = '【正文固定规则】\n' + (text || '此前正文固定规则已撤回。')
  return {
    role: 'user',
    content: [{ type: 'text', text: rendered }],
    source: { kind: 'plugin:dsh-tavern', form: 'writing-rules', trace: { writingRulesSnapshot: { schemaVersion: 1, text, rendered } } }
  }
}

function regenerate(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }
}

test('没有可替换的玩家输入或没有重采样输入时原样返回', () => {
  const noPlayer = [body('正文'), regenerate('重新生成')]
  assert.equal(projectRegenerationRequestMessages(noPlayer), noPlayer)
  const noRegenerate = [player('输入'), body('正文')]
  assert.equal(projectRegenerationRequestMessages(noRegenerate), noRegenerate)
  assert.deepEqual(projectRegenerationRequestMessages([]), [])
  assert.deepEqual(projectRegenerationRequestMessages(null), [])
})

test('重新生成保留被替换回合首次注入的固定写作规则，丢弃旧正文和旧回合材料', () => {
  const opening = body('上一楼的开场')
  const input = player('原始动作', 'original')
  const rules = writingRules('避免重复已写情节')
  const retry = regenerate('改写本轮')
  const newFrame = frame('新的回合材料')
  const projected = projectRegenerationRequestMessages([
    opening, input, rules, frame('旧回合材料'), body('旧正文'), retry, newFrame
  ])
  assert.deepEqual(projected, [opening, { ...input, content: retry.content }, rules, newFrame])
})

test('重新生成有固定写作规则更新或撤回时，只使用这次请求的新版本', () => {
  const input = player('原始动作')
  const oldRules = writingRules('避免重复已写情节')
  const retry = regenerate('改写本轮')
  for (const newRules of [writingRules('新的固定规则'), writingRules('')]) {
    const projected = projectRegenerationRequestMessages([input, oldRules, body('旧正文'), retry, newRules])
    assert.deepEqual(projected, [{ ...input, content: retry.content }, newRules])
  }
})
