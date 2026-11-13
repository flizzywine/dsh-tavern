import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuBackgroundTaskFrame, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { toolSettlementContext } from '../tavern-plugin/lib/domain/tool-settlement-context.js'
import { checkSettlement } from '../tavern-plugin/mods/dice/check-tool.js'
import { modTools } from '../tavern-plugin/lib/mod-tools.js'

const call = (callId, name) => ({ type: 'tool/call', data: { name, callId } })
const result = (callId, turn, record, isError = false) => ({ type: 'tool/result', data: { turn, message: { role: 'tool', toolCallId: callId, isError, content: [{ type: 'text', text: JSON.stringify(record) }] } } })
const roll = (id, changes) => ({ id, status: 'settled', changes })
const chaos = (from, to) => ({ resource: 'chaos', label: '混沌', from, to, add: to - from, path: '/机构/混沌' })
const tools = [{ name: 'tavern_check', settlement: results => results.map(text => JSON.parse(text).id).join(',') }, { name: 'tavern_roll' }]

test('a declaring tool sees only its own successful results of this reply on the current branch', () => {
  const events = [
    call('a', 'tavern_check'), result('a', 3, roll('#1', [chaos(0, 5)])),
    call('b', 'tavern_check'), result('b', 4, roll('#2', [chaos(5, 7)])),
    call('c', 'tavern_check'), result('c', 4, roll('#3', []), true),
    call('d', 'tavern_roll'), result('d', 4, { roll: 40 }),
    call('e', 'tavern_check'), result('e', 4, roll('#4', [chaos(7, 9)]))
  ]
  assert.deepEqual(toolSettlementContext({ events }, tools, 4), [{ tool: 'tavern_check', text: '#2,#4' }])
  assert.deepEqual(toolSettlementContext({ events }, tools, 9), [])
  // Regenerated: the reply's first result is no longer on the surface.
  assert.deepEqual(toolSettlementContext({ events, surface: { nodes: [9] } }, tools, 4), [{ tool: 'tavern_check', text: '#4' }])
  assert.deepEqual(toolSettlementContext({ events }, [{ name: 'tavern_check' }], 4), [], 'a tool that declares nothing adds nothing')
})

test('the dice check declares one line per changed variable, the value after the reply\'s last check', () => {
  assert.equal(modTools.find(tool => tool.name === 'tavern_check').settlement, checkSettlement)
  assert.equal(modTools.find(tool => tool.name === 'tavern_roll').settlement, undefined)
  const qa = { resource: 'qa', key: '欺瞒', label: '素质保证', from: 3, to: 2, add: -1, path: '/特工/素质保证/欺瞒' }
  const text = checkSettlement([roll('#2', [chaos(2, 7), qa]), JSON.stringify({ id: '#3', status: 'awaiting' }), roll('#3', [chaos(7, 9), { resource: 'burn', label: '本次燃尽', from: 0, to: 1, add: 1 }])].map(row => typeof row === 'string' ? row : JSON.stringify(row)))
  assert.match(text, /^检定 #2、#3 结算后的变量值。用 replace/)
  assert.deepEqual(text.split('\n').slice(1), ['/stat_data/机构/混沌 = 9', '/stat_data/特工/素质保证/欺瞒 = 2'])
  assert.equal(checkSettlement([JSON.stringify({ id: '#1', status: 'awaiting' })]), '')
})

test('the settlement prompt carries the tools\' text in its own section', () => {
  const frame = createMvuBackgroundTaskFrame({ operationId: 'o', chatId: 'c', branchId: 'b', basedOnRevision: 1, messageId: 0, swipeId: 0, storyText: '正文。', currentVariables: { stat_data: {} },
    toolResults: [{ tool: 'tavern_check', text: '检定 #2 结算后的变量值。\n/stat_data/机构/混沌 = 9' }] })
  assert.match(projectMvuBackgroundRequest(frame).turnContext, /<turn_tool_results>\n[^\n]*照它们写变量[^\n]*\n\[tavern_check\]\n检定 #2 结算后的变量值。\n\/stat_data\/机构\/混沌 = 9/)
  const none = createMvuBackgroundTaskFrame({ operationId: 'o', chatId: 'c', branchId: 'b', basedOnRevision: 1, messageId: 0, swipeId: 0, storyText: '正文。', currentVariables: { stat_data: {} } })
  assert.doesNotMatch(projectMvuBackgroundRequest(none).turnContext, /本轮工具结果/)
})
