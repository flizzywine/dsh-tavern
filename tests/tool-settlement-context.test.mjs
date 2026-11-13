import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuBackgroundTaskFrame, createMvuSettlementModule, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { createMvuSettlementEngine } from '../tavern-plugin/lib/domain/mvu-settlement-engine.js'
import { settledVariables } from '../tavern-plugin/lib/domain/read-variables.js'
import { toolSettlementContext } from '../tavern-plugin/lib/domain/tool-settlement-context.js'
import { checkSettlement } from '../tavern-plugin/mods/dice/check-tool.js'
import { modTools } from '../tavern-plugin/lib/mod-tools.js'

const call = (callId, name) => ({ type: 'tool/call', data: { name, callId } })
const result = (callId, turn, record, isError = false) => ({ type: 'tool/result', data: { turn, message: { role: 'tool', toolCallId: callId, isError, content: [{ type: 'text', text: JSON.stringify(record) }] } } })
const roll = (id, changes) => ({ id, status: 'settled', changes })
const chaos = (from, to) => ({ resource: 'chaos', label: '混沌', from, to, add: to - from, path: '/机构/混沌' })
const ids = results => ({ note: results.map(text => JSON.parse(text).id).join(','), operations: [{ op: 'replace', path: '/stat_data/n', value: results.length }] })
const tools = [{ name: 'tavern_check', settlement: ids }, { name: 'tavern_roll' }]

test('a declaring tool sees its own successful results the baseline does not hold yet, on the current branch', () => {
  const events = [
    call('a', 'tavern_check'), result('a', 3, roll('#1', [chaos(0, 5)])),
    call('b', 'tavern_check'), result('b', 4, roll('#2', [chaos(5, 7)])),
    call('c', 'tavern_check'), result('c', 4, roll('#3', []), true),
    call('d', 'tavern_roll'), result('d', 4, { roll: 40 }),
    call('e', 'tavern_check'), result('e', 4, roll('#4', [chaos(7, 9)]))
  ]
  const notes = (session, turns, list = tools) => toolSettlementContext(session, list, turns).map(row => row.tool + ':' + row.note)
  assert.deepEqual(notes({ events }, { after: 3, upTo: 4 }), ['tavern_check:#2,#4'])
  assert.deepEqual(notes({ events }, { after: 2, upTo: 4 }), ['tavern_check:#1,#2,#4'], 'turn 3 never settled: its results are written with turn 4')
  assert.deepEqual(notes({ events }, { after: 8, upTo: 9 }), [])
  // Regenerated: the reply's first result is no longer on the surface.
  assert.deepEqual(notes({ events, surface: { nodes: [9] } }, { after: 3, upTo: 4 }), ['tavern_check:#4'])
  assert.deepEqual(notes({ events }, { after: 3, upTo: 4 }, [{ name: 'tavern_check' }]), [], 'a tool that declares nothing adds nothing')
})

test('the turn the settled variables belong to skips replies whose settlement is pending or did not save', () => {
  const reply = (turn, value, mvu) => ({ role: 'assistant', turn, swipeId: 0, variables: [{ stat_data: { n: value } }], ...(mvu ? { mvu } : {}) })
  const messages = [reply(1, 0), { role: 'user', turn: 2, variables: [{ stat_data: { n: 9 } }] }, reply(2, 1, { pending: false, receipt: { status: 'updated' } }),
    reply(3, 1, { pending: false, receipt: { status: 'error' } }), reply(4, 1, { pending: true })]
  assert.deepEqual(settledVariables({ messages }), { snapshot: { n: 1 }, turn: 2 })
  assert.deepEqual(settledVariables({ messages }, 2), { snapshot: { n: 0 }, turn: 1 }, 'before a message index; the player\'s floor does not count')
})

test('the dice check writes one operation per changed variable, the value after the last check that changed it', () => {
  assert.equal(modTools.find(tool => tool.name === 'tavern_check').settlement, checkSettlement)
  assert.equal(modTools.find(tool => tool.name === 'tavern_roll').settlement, undefined)
  const qa = { resource: 'qa', key: '欺瞒', label: '素质保证', from: 3, to: 2, add: -1, path: '/特工/素质保证/欺瞒' }
  const declared = checkSettlement([roll('#2', [chaos(2, 7), qa]), { id: '#3', status: 'awaiting' }, roll('#3', [chaos(7, 9), { resource: 'burn', label: '本次燃尽', from: 0, to: 1, add: 1 }])].map(row => JSON.stringify(row)))
  assert.equal(declared.note, '检定 #2、#3 改到的变量。')
  assert.deepEqual(declared.operations, [{ op: 'replace', path: '/stat_data/机构/混沌', value: 9 }, { op: 'replace', path: '/stat_data/特工/素质保证/欺瞒', value: 2 }])
  assert.equal(checkSettlement([JSON.stringify({ id: '#1', status: 'awaiting' })]), null)
})

const toolResults = [{ tool: 'tavern_check', note: '检定 #2 改到的变量。', operations: [{ op: 'replace', path: '/stat_data/机构/混沌', value: 9 }] }]
const frameInput = { operationId: 'o', chatId: 'c', branchId: 'b', basedOnRevision: 1, messageId: 0, swipeId: 0, storyText: '正文。', currentVariables: { stat_data: { 机构: { 混沌: 5 }, 地点: '总部' } } }

test('the settlement prompt says the host writes the tools\' values, and its snapshot already holds them', () => {
  const { turnContext } = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({ ...frameInput, toolResults }))
  assert.match(turnContext, /"机构":\{"混沌":9\}/)
  assert.match(turnContext, /<turn_tool_results>\n[^\n]*程序会原样写入[^\n]*\n\[tavern_check\]\n检定 #2 改到的变量。\n\/stat_data\/机构\/混沌 = 9/)
  assert.doesNotMatch(projectMvuBackgroundRequest(createMvuBackgroundTaskFrame(frameInput)).turnContext, /turn_tool_results/)
})

// Like the real transaction: the patch is applied to the baseline, then the host's validate decides whether it is kept.
function runtime(saved) {
  return { async settleMvuUpdate(request) {
    const operations = JSON.parse(request.command.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/)[1])
    saved.push(operations)
    const after = structuredClone(request.baselineVariables)
    for (const operation of operations) {
      const keys = operation.path.slice(1).split('/'), parent = keys.slice(0, -1).reduce((node, key) => node[key], after.stat_data)
      parent[keys.at(-1)] = operation.op === 'delta' ? parent[keys.at(-1)] + operation.value : operation.value
    }
    return { updated: true, validation: request.validate({ before: request.baselineVariables, after }), variables: after }
  } }
}

test('settlement: the tools\' operations go first; the background\'s writes to those paths are dropped and recorded, not sent back', async () => {
  const saved = [], records = [], feedback = []
  const module = createMvuSettlementModule({ runtime: runtime(saved), diagnostics: { record: (_id, row) => records.push(row) },
    model: { async run(request) {
      // A card still telling the background to copy the tool results: its copy and a guess on top are both dropped.
      feedback.push(JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [
        { op: 'replace', path: '/stat_data/机构/混沌', valueJson: '9' }, { op: 'delta', path: '/stat_data/机构/混沌', valueJson: '-2' },
        { op: 'replace', path: '/stat_data/地点', valueJson: '"现场"' }] } })))
      return { text: '' }
    } } })
  const settled = await module.settleVariables({ ...frameInput, sessionId: 's', toolResults, backgroundTasks: { posture: false } })
  assert.equal(feedback.length, 1, 'one background run')
  assert.equal(feedback[0].ok, true)
  assert.deepEqual(saved, [[{ op: 'replace', path: '/机构/混沌', value: 9 }, { op: 'replace', path: '/地点', value: '现场' }]])
  assert.equal(settled.receipt.status, 'updated')
  assert.deepEqual(records.find(row => row.stage === 'tool-paths-dropped').operations.map(row => row.op), ['replace', 'delta'])
  // The durable copy is the background's share; redelivering it writes the same batch.
  const durable = []
  await module.resumeVariables({ ...frameInput, sessionId: 's', toolResults, submission: settled.submission, onSubmission: submission => durable.push(submission) })
  assert.deepEqual(saved[1], saved[0])
  assert.deepEqual(durable[0].operations, [{ op: 'replace', path: '/stat_data/地点', value: '现场' }])
})

test('settlement: when the background fails, the tools\' values are written alone and the reply says the rest can be retried', async () => {
  const saved = []
  const mvuSettlement = createMvuSettlementModule({ runtime: runtime(saved), model: { async run() { throw new Error('模型超时') } } })
  const message = { role: 'assistant', turn: 4, text: '正文。', swipeId: 0, variables: [structuredClone(frameInput.currentVariables)], mvu: { pending: true } }
  const snapshot = { id: 'c', sessionId: 's', mvu: { enabled: true, owner: 'official' }, messages: [
    { role: 'assistant', turn: 3, swipeId: 0, variables: [structuredClone(frameInput.currentVariables)], mvu: { pending: false, receipt: { status: 'updated' } } }, message] }
  let asked
  const engine = createMvuSettlementEngine({ mvuSettlement, mvuUpdateRules: async () => [], backgroundModelSelection: () => ({ model: 'm' }), postureItem: { requirement: () => '' },
    turnToolResults: async (_chat, turns) => { asked = turns; return toolResults } })
  const taskRun = { operationId: 'op', basedOn: { branchId: 'b', revision: 1 }, checkpointMessage: async () => {}, bindSession: async () => {} }
  const run = { snapshot, taskRun, card: { name: 'c' }, signal: new AbortController().signal, trace: {}, backgroundTasksSettings: { posture: false } }
  const { mvuResult } = await engine.run({ ...run, mvuTarget: engine.target(snapshot) })
  assert.deepEqual(asked, { after: 3, upTo: 4 })
  assert.deepEqual(saved, [[{ op: 'replace', path: '/机构/混沌', value: 9 }]])
  assert.equal(mvuResult.receipt.status, 'updated')
  assert.match(mvuResult.receipt.summary, /模型超时.*只写入了工具算定的值/)
  // Settling again (a retry) writes the same absolute value: nothing is added twice.
  await engine.run({ ...run, mvuTarget: engine.target(snapshot) })
  assert.deepEqual(saved[1], saved[0])
})
