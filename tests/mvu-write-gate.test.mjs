import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuSettlementModule, normalizeMvuToolSubmission } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { checkMvuCard } from '../tavern-plugin/lib/domain/mvu-card-check.js'
import { validateMvuLimits } from '../tavern-plugin/lib/domain/mvu-limits.js'
import { createMvuWriteGate } from '../tavern-plugin/lib/domain/mvu-write-gate.js'

const limitsOf = state => validateMvuLimits(state).normalized

// The official executor reduced to its JSON Patch dialect on stat_data; `refuse` stands for a card script that keeps a path.
function executor(start, { refuse = [] } = {}) {
  const saved = []
  return { saved, runtime: { async settleMvuUpdate(request) {
    const operations = JSON.parse(request.command.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/)[1])
    const after = structuredClone(start)
    for (const operation of operations) {
      const keys = operation.path.split('/').slice(1)
      if (refuse.includes(operation.path)) continue
      let node = after.stat_data
      for (const key of keys.slice(0, -1)) node = node?.[key]
      if (!node) continue
      if (operation.op === 'delta') node[keys.at(-1)] += operation.value
      else node[keys.at(-1)] = operation.value
    }
    const validation = await request.validate({ before: start, after })
    if (validation.failures.length) return { updated: false, rejected: true, retryable: true, validation, variables: start }
    saved.push({ operations, after })
    return { updated: true, validation, variables: after }
  } } }
}

async function settle({ variables, limits, submissions, refuse }) {
  const replies = []
  const { saved, runtime } = executor(variables, { refuse })
  const module = createMvuSettlementModule({ runtime, model: { async run(request) {
    for (const operations of submissions) {
      const reply = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: operations.map(([op, path, value]) => ({ op, path, valueJson: JSON.stringify(value) })) } }))
      replies.push(reply)
      if (reply.ok || !reply.retryable) break
    }
    return { text: '' }
  } } })
  const result = await module.settleVariables({ operationId: 'gate', chatId: 'c', branchId: 'b', basedOnRevision: 1, sessionId: 's', messageId: 0, swipeId: 0,
    storyText: '正文。', currentVariables: variables, variableLimits: limits, backgroundTasks: { posture: false } })
  return { replies, saved, result }
}

const party = () => ({ stat_data: { 金币: 120, 嘉奖: 57, 体力: '8/10', 姓名: '', 档案: '',
  $meta: { limits: { 金币: { min: 0, integer: true }, 嘉奖: { min: 0, integer: true }, 体力: { meter: true, max: 12 } } } } })

test('segmented settlement: two of four operations fail, one is fixed, the other is dropped once the attempts run out', async () => {
  const variables = party(), limits = limitsOf(variables.stat_data)
  const { replies, saved, result } = await settle({ variables, limits, submissions: [
    [['replace', '/stat_data/姓名', '高坂月'], ['replace', '/stat_data/档案', '…'], ['replace', '/stat_data/嘉奖', 57.5], ['replace', '/stat_data/体力', '11/10']],
    [['replace', '/stat_data/体力', '10/10'], ['replace', '/stat_data/嘉奖', 57.5]],
    [['replace', '/stat_data/嘉奖', 57.5]]] })
  assert.deepEqual(replies[0].kept, ['/stat_data/姓名', '/stat_data/档案'])
  assert.deepEqual(replies[0].rejected.map(row => [row.path, row.current, row.allowed]), [['/stat_data/嘉奖', 57, '是整数，应不小于 0'],
    ['/stat_data/体力', '8/10', '写成 "当前/上限"（两边整数，当前不超过上限，如 "2/3"），上限不超过 12，当前不小于 0']])
  assert.deepEqual(replies[1].kept, ['/stat_data/姓名', '/stat_data/档案', '/stat_data/体力'])
  assert.deepEqual(replies[1].rejected.map(row => row.path), ['/stat_data/嘉奖'])
  assert.equal(replies.length, 3)
  // Saved once: the kept three; the integer one is dropped with a reason, the reply is not failed.
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].operations.map(operation => operation.path), ['/姓名', '/档案', '/体力'])
  assert.equal(result.receipt.status, 'updated')
  assert.deepEqual(result.receipt.dropped.map(row => row.path), ['/stat_data/嘉奖'])
  assert.match(result.receipt.summary, /1 条变量改动没通过检查，已丢弃/)
})

test('segmented settlement: a kept delta sent again is ignored, and an empty submission gives the rest up', async () => {
  const variables = party(), limits = limitsOf(variables.stat_data)
  const { replies, saved, result } = await settle({ variables, limits, submissions: [
    [['delta', '/stat_data/金币', 45], ['replace', '/stat_data/嘉奖', 1.5]],
    [['delta', '/stat_data/金币', 45], ['replace', '/stat_data/嘉奖', 2]]] })
  assert.deepEqual(replies[1].ignored, ['/stat_data/金币'])
  assert.equal(saved.at(-1).after.stat_data.金币, 165)
  assert.equal(saved.at(-1).after.stat_data.嘉奖, 2)
  assert.equal(result.receipt.status, 'updated')

  const gaveUp = await settle({ variables, limits, submissions: [[['delta', '/stat_data/金币', 45], ['replace', '/stat_data/嘉奖', 1.5]], []] })
  assert.equal(gaveUp.replies[1].ok, true)
  assert.equal(gaveUp.saved.length, 1)
  assert.equal(gaveUp.saved[0].after.stat_data.金币, 165)
  assert.deepEqual(gaveUp.result.receipt.dropped.map(row => row.path), ['/stat_data/嘉奖'])
})

test('segmented settlement: an operation a card script refused goes back as no-effect with the names that level has', async () => {
  const variables = { stat_data: { 成员: { 芙蕾雅: { 等级: 3 }, 安娜: { 等级: 1 } } } }
  const { replies } = await settle({ variables, limits: [], refuse: ['/成员/安娜/等级'], submissions: [
    [['replace', '/stat_data/成员/安娜/等级', 2], ['replace', '/stat_data/成员/芫蕉雅/等级', 4]], []] })
  const rows = Object.fromEntries(replies[0].rejected.map(row => [row.path, row]))
  assert.match(rows['/stat_data/成员/安娜/等级'].reason, /没有变化：路径不存在，或卡的脚本拒收了它/)
  assert.deepEqual(rows['/stat_data/成员/芫蕉雅/等级'].existingKeys, ['芙蕾雅', '安娜'])
})

test('prepare: a delta on a meter becomes its replace, a clamp limit brings a value back', () => {
  const state = { 体力: '8/10', 好感: 95, 队伍: { $meta: { limits: { '*/生命': { meter: true, max: 999, clamp: true } } } },
    $meta: { limits: { 体力: { meter: true, max: 12, clamp: true }, 好感: { min: 0, max: 100, integer: true, clamp: true } } } }
  const gate = createMvuWriteGate({ limits: limitsOf(state) })
  const { operations, clamped } = gate.prepare([
    { op: 'delta', path: '/stat_data/体力', value: 1 }, { op: 'delta', path: '/stat_data/体力', value: 5 },
    { op: 'delta', path: '/stat_data/好感', value: 40 },
    { op: 'insert', path: '/stat_data/队伍/新人', value: { 生命: '50/30' } }], { stat_data: state })
  assert.deepEqual(operations, [{ op: 'replace', path: '/stat_data/体力', value: '9/10' }, { op: 'replace', path: '/stat_data/体力', value: '10/10' },
    { op: 'replace', path: '/stat_data/好感', value: 100 }, { op: 'insert', path: '/stat_data/队伍/新人', value: { 生命: '30/30' } }])
  assert.deepEqual(clamped.map(row => [row.path, row.to]), [['/stat_data/体力', '10/10'], ['/stat_data/好感', 100], ['/stat_data/队伍/新人/生命', '30/30']])
})

test('check: every changed value is checked (no cut-off), clamps correct the host\'s own writes, rule paths refuse scripts', () => {
  const many = Object.fromEntries(Array.from({ length: 300 }, (_v, i) => ['n' + i, 0]))
  const limits = limitsOf({ 表: { ...many, $meta: { limits: { '*': { min: 0, max: 10 } } } }, 好感: 0, $meta: { limits: { 好感: { min: 0, max: 100, clamp: true } } } })
  const gate = createMvuWriteGate({ limits, ownedPaths: ['/stat_data/资质保证'] })
  const after = { stat_data: { 表: Object.fromEntries(Object.keys(many).map((key, i) => [key, i === 250 ? 11 : 1])), 好感: 120, 资质保证: 3 } }
  const checked = gate.check({ source: 'script', before: { stat_data: { 表: many, 好感: 0, 资质保证: 2 } }, after })
  assert.deepEqual(checked.failures.map(failure => [failure.path, failure.rule]), [['/stat_data/表/n250', 'range'], ['/stat_data/资质保证', 'owner']])
  assert.equal(checked.corrected.stat_data.好感, 100)
  assert.deepEqual(checked.clamped, [{ path: '/stat_data/好感', from: 120, to: 100 }])
  assert.equal(gate.check({ source: 'panel', before: { stat_data: { 资质保证: 2 } }, after: { stat_data: { 资质保证: 3 } } }).failures.length, 0)
  // A path nobody declared stays the card's own: a script may change its type.
  assert.equal(gate.check({ source: 'script', before: { stat_data: { 备注: 1 } }, after: { stat_data: { 备注: null } } }).failures.length, 0)
})

test('limits: children added in play take a relative-path rule; the card check holds initial values to their limits and names template limits', () => {
  const state = { 队伍: { $meta: { extensible: true, limits: { '*/好感': { min: 0, max: 100 } } } } }
  const gate = createMvuWriteGate({ limits: limitsOf(state) })
  assert.equal(gate.check({ source: 'settlement', before: { stat_data: { 队伍: {} } }, after: { stat_data: { 队伍: { 新人: { 好感: 120 } } } } }).failures[0].path, '/stat_data/队伍/新人/好感')
  assert.match(validateMvuLimits({ 队伍: { $meta: { limits: { '艾琳/好感': { min: 0 } } } } }).errors[0].message, /没有「艾琳」/)

  const card = initvar => ({ first_mes: '<initvar>' + initvar + '</initvar>', character_book: { entries: [{ comment: '[mvu_update]', content: '' }] } })
  const checked = checkMvuCard(card(JSON.stringify({ 体力: '3/2', $meta: { limits: { 体力: { meter: true } } } })))
  assert.ok(checked.errors.some(error => /初值 "3\/2" 不满足自己的范围/.test(error.message)))
  const templated = checkMvuCard(card('{"好感": <%= 1 %>, "$meta": {"limits": {"好感": {"min": 0}}}}'))
  assert.ok(templated.warnings.some(warning => /limits 没有生效/.test(warning.message)))
})

test('a meter written bare (51/100, without JSON quotes) is that text; other broken numbers still go back', () => {
  assert.equal(normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: '/stat_data/声望', valueJson: '51/100' }] }).operations[0].value, '51/100')
  assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: '/stat_data/声望', valueJson: '51/1.5' }] }), /不是有效 JSON/)
})
