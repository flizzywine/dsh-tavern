import { normalizeBackgroundTasks } from '../tavern-plugin/lib/domain/tavern-settings.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { applyLedgerDelta, emptyLedger, createLedgerSubmission, LEDGER_SUBMIT_TOOL, LEDGER_RULES, ledgerContext, readLedger } from '../tavern-plugin/lib/domain/story-ledger.js'
import { createLedgerEditor } from '../tavern-plugin/lib/domain/ledger-editor.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

test('台账保留离场角色和寄存物品，部分消耗、用尽和未知更新原子处理', () => {
  const first = applyLedgerDelta(null, { items: { add: [{ name: '解药', qty: 3 }, { name: '铜匣', carried: false, location: '客栈' }] }, npcs: { add: [{ name: '林岚', relation: '同行者，互相信任', follow: true }] }, scenes: { add: [{ path: ['城', '客栈'], desc: '初遇的客栈' }] }, location: '客栈', locationPath: ['城', '客栈'] }, 1)
  const second = applyLedgerDelta(first, { items: { update: [{ name: '解药', qty: 2 }] }, npcs: { update: [{ name: '林岚', follow: false, location: '客栈' }] }, location: '钟楼' }, 2)
  assert.equal(second.items[1].location, '客栈')
  assert.equal(second.npcs[0].relation, '同行者，互相信任')
  assert.equal(second.npcs[0].follow, false)
  assert.deepEqual(second.locationPath, [])
  assert.equal(first.items[0].qty, 3)
  assert.equal(second.itemLog.at(-1).from, 3)
  assert.equal(second.itemLog.at(-1).to, 2)
  const before = JSON.stringify(second)
  assert.throws(() => applyLedgerDelta(second, { items: { add: [{ name: '新物品' }], update: [{ name: '不存在', qty: 3 }] } }, 3), /尚未登记/)
  assert.equal(JSON.stringify(second), before)
  assert.equal(applyLedgerDelta(second, { items: { remove: ['解药'] } }, 3).items.length, 1)
})

test('工具已接受的提交重复调用不累计数量；无变化也可完成，坏参数可纠正', () => {
  const task = createLedgerSubmission({ enabled: true, current: null, turn: 2 })
  assert.equal(task.complete, false)
  assert.equal(JSON.parse(task.execute({ arguments: { items: { add: [{ name: '药', qty: -1 }] } } })).retryable, true)
  task.execute({ arguments: { items: { add: [{ name: '药', qty: 2 }] } } })
  assert.equal(JSON.parse(task.execute({ arguments: { items: { add: [{ name: '药', qty: 2 }] } } })).alreadySubmitted, true)
  assert.equal(task.result.items[0].qty, 2)
  const noChange = createLedgerSubmission({ enabled: true, current: task.result, turn: 3 })
  noChange.execute({ arguments: {} })
  assert.equal(noChange.result.items[0].qty, 2)
  assert.equal(noChange.complete, true)
  for (const value of [null, [], { items: { add: 'invalid' } }, { npcs: { add: [{ name: '' }] } }, { unexpected: [] }]) assert.throws(() => applyLedgerDelta(null, value, 1))
})

test('地点调整层级保留子树和当前位置，禁止循环和覆盖，删除清理当前位置', () => {
  let ledger = applyLedgerDelta(null, { scenes: { add: [{ path: ['家'], desc: '住处' }, { path: ['家', '卧室'], desc: '卧室' }] }, locationPath: ['家', '卧室'] }, 1)
  ledger = applyLedgerDelta(ledger, { scenes: { reparent: [{ node: ['家'], newPath: ['城', '家'] }] } }, 2)
  assert.deepEqual(ledger.locationPath, ['城', '家', '卧室'])
  assert.throws(() => applyLedgerDelta(ledger, { scenes: { reparent: [{ node: ['城', '家'], newPath: ['城', '家', '家'] }] } }, 3), /自身/)
  const removed = applyLedgerDelta(ledger, { scenes: { remove: [['城', '家']] } }, 3)
  assert.equal(removed.scenes.length, 0)
  assert.deepEqual(removed.locationPath, [])
})

test('普通卡结算忽略旧的自动台账开关，只提交姿势并保留已有台账', async () => {
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const existingLedger = applyLedgerDelta(null, { items: { add: [{ name: '旧台账解药', qty: 3 }] } }, 1)
  let chat = { ledger: structuredClone(existingLedger), id: 'chat', sessionId: 'front', messages: [{ role: 'assistant', turn: 2, text: '获得解药' }] }
  let calls = 0
  const ctx = {
    normalizeBackgroundTasks,
    readChat: async () => structuredClone(chat), prepareNextWorldBookContext: async c => c,
    backgroundTasks: { begin: async snapshot => ({ chat: snapshot, participantRequest: { sessionId: 'same-background', rewindTo: null }, participant: x => x, commit: async completion => { assert.notEqual(completion.status, 'failed', '真实结算意外进入失败分支'); assert.equal(typeof completion.apply, 'function'); completion.apply(chat); return { status: 'committed', chat } } }) },
    readChatCard: async () => ({ name: '测试卡' }), readTavernSettings: async () => ({ backgroundTasks: { ledger: true, posture: true, variables: false, characterDesign: false } }),
    backgroundModelSelection: () => ({ model: 'fake' }),
    backgroundAgentRunner: { run: async input => {
      calls++; assert.equal(input.persistentSessionId, 'same-background'); assert.ok(!input.system.includes('台账维护'))
      assert.deepEqual(Array.from(input.tools, tool => tool.name), ['posture_submit'])
      assert.equal(input.stopToolsWhen(), false)
      assert.equal(JSON.parse(await input.onToolCall({ name: 'ledger_submit', arguments: { items: { add: [{ name: '解药', qty: 2 }] } } })).ok, false)
      assert.equal(input.stopToolsWhen(), false)
      assert.equal(JSON.parse(await input.onToolCall({ name: 'posture_submit', arguments: { posture: '站立' } })).ok, true)
      assert.equal(input.stopToolsWhen(), true)
      return { traceSessionId: 'same-background', traceBoundary: 5 }
    } },
    runtimePrompt: () => '姿势', settleUserText: () => '正文', settlementTurn: () => 2,
    LEDGER_SUBMIT_TOOL, LEDGER_RULES, ledgerContext, createLedgerSubmission,
    POSTURE_SUBMIT_TOOL: { name: 'posture_submit' }, POSTURE_SUBMIT_TOOL_NAME: 'posture_submit', normalizePostureSubmission: x => x,
    CHARACTER_DESIGN_READ_TOOL: { name: 'design_read' }, CHARACTER_DESIGN_SAVE_TOOL: { name: 'design_save' },
    str: x => x == null ? '' : String(x), structuredClone, console,
  }
  const start = source.indexOf('  async function runSettlement(chatId, signal)')
  const applyStart = source.indexOf('  function applySettlement(chat, result)')
  vm.runInNewContext(source.slice(applyStart, source.indexOf('  function settlementTurn(', applyStart)), ctx)
  // Extract by braces through the next top-level function, not a duplicate implementation.
  const next = source.indexOf('\n  async function ', start + 10)
  const nextSync = source.indexOf('\n  function ', start + 10)
  const stop = Math.min(...[next, nextSync].filter(x => x > start))
  vm.runInNewContext(source.slice(start, stop) + '\nthis.run = runSettlement', ctx)
  await ctx.run('chat', new AbortController().signal)
  assert.equal(calls, 1)
  assert.deepEqual(chat.ledger, existingLedger)
  assert.equal(chat.posture, '站立')
  assert.equal(chat.settleStatus, 'done')
})

test('手改台账防过期、防生成中修改，不触碰正文、姿势或变量', async () => {
  let chat = { id: 'c', mode: 'story', messages: [{ role: 'assistant', turn: 2, text: '正文' }], ledger: emptyLedger(), posture: '原姿势', variables: { hp: 10 }, settleStatus: 'done' }
  const original = structuredClone(chat)
  let busy = false
  const edit = createLedgerEditor({ chats: { forSession: async () => chat, update: async (_id, fn) => { chat = fn(chat); return chat } }, timeline: createStoryTimeline(), isBusy: () => busy })
  const expected = JSON.stringify(chat.ledger)
  await edit({ sessionId: 's', expected, delta: { items: { add: [{ name: '剑' }] } } })
  assert.deepEqual(chat.messages, original.messages)
  assert.deepEqual(chat.variables, original.variables)
  assert.equal(chat.posture, original.posture)
  await assert.rejects(edit({ sessionId: 's', expected, delta: {} }), /已更新/)
  busy = true
  await assert.rejects(edit({ sessionId: 's', expected: JSON.stringify(chat.ledger), delta: {} }), /等待/)
})
