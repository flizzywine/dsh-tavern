import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function CandidateAction('), source.indexOf('function CandidateDockActions('))
const roundOrdinal = source.slice(source.indexOf('function tavernRoundOrdinal('), source.indexOf('function tavernStoryTurnForDshTurn('))
// The replay submit path sits above CandidateAction; slice it with its only helper.

function harness() {
  let running = true, activity = { phase: 'idle', busy: false, role: '' }, regen = null, fail = false, warning = '', canRollback = true, undoTurn = null
  const states = [], calls = [], extraView = {}
  let cursor = 0
  const context = {
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {},
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      }
    },
    useCandidatePanel: () => null, useRegenPanel: () => regen,
    useTavernSessionMode: () => 'story', latestTavernAssistantMessageId: () => 'reply',
    useLiveTavernView: () => ({ view: { canRollback, undoRollbackTurn: undoTurn, ...extraView } }),
    useTavernCoordination: () => ({ view: { activity } }),
    describeTavernActivity: value => value, isPlayMode: () => true,
    window: { confirm: () => { calls.push('confirm'); return true } },
    rpc: async () => { calls.push('rpc'); if (fail) throw new Error('本次回复未完成'); return { view: { rollbackWarning: warning } } },
    historyProjection: { rolledBack: () => calls.push('project'), restored: () => calls.push('restore') },
    setCandidatePanel() { calls.push('set-candidate-panel') }, setRegenPanel() { calls.push('set-regen-panel') }, setCandidateGuidePanel() { calls.push('set-guide-panel') },
    liveTavernView: { invalidate: () => calls.push('refresh-view') },
    tavernCoordination: { invalidate: () => calls.push('refresh-activity') },
    notifyTavernDataChanged: () => calls.push('notify'),
    tavernErrorHub: { report: (name, error) => calls.push(name + ': ' + error.message) },
    submitFailedTurnReplay: async sessionId => { calls.push('replay'); return { view: {} } },
    TavernCompactionAction: function TavernCompactionAction() {}
  }
  const actions = vm.runInNewContext(roundOrdinal + component + '; ({ CandidateAction, TavernRollbackAction, TavernUndoRollbackAction, TavernMoreActions, tavernRoundOrdinal })', context)
  return {
    calls,
    ordinal: actions.tavernRoundOrdinal,
    view(value) { Object.assign(extraView, value) },
    undoTurn(value) { undoTurn = value },
    undo() { cursor = 0; return actions.TavernUndoRollbackAction({ sessionId: 'session', useSession: select => select({ running }) }) },
    playerRound(value) { canRollback = value },
    running(value) { running = value },
    background(value) { activity = value ? { phase: 'running', busy: true, role: 'settlement' } : { phase: 'idle', busy: false, role: '' } },
    activity(value) { activity = value },
    regen(value) { regen = value ? { sessionId: 'session', phase: 'loading' } : null },
    fail(value) { fail = value }, warning(value) { warning = value },
    buttons() {
      cursor = 0
      return actions.CandidateAction({ sessionId: 'session', messageId: 'reply',
        useSession: select => select({ running }), useChat: select => select({}), useInput: select => select({ draft: '' })
      }).children.filter(Boolean)
    },
    button() {
      cursor = 0
      return actions.TavernRollbackAction({ sessionId: 'session',
        useSession: select => select({ running }), useChat: select => select({})
      })
    },
    more() {
      cursor = 0
      return actions.TavernMoreActions({ sessionId: 'session',
        useSession: select => select({ running }), useChat: select => select({})
      })
    }
  }
}

test('开场白不显示正文重生成入口，正式玩家轮次完成后只显示一个入口', () => {
  const h = harness()
  h.running(false); h.playerRound(false)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项'])
  h.playerRound(true)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项', '重新生成正文'])
  h.playerRound(false)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项'])
})

test('回退标签和轮距按正文楼层顺序计算，稳定 turn 仍用于操作', () => {
  const h = harness()
  const displayRoundOrder = [1, 2, 3, 12, 48, 72, 75, 84]
  h.view({ rollbackTargetTurn: 84, displayRoundOrder })
  assert.equal(h.button().children[0], '回退第 8 轮')
  assert.equal(h.ordinal({ displayRoundOrder }, 84) - h.ordinal({ displayRoundOrder }, 75), 1, '倒数第二轮与最后一轮只隔一楼')
  assert.equal(h.ordinal({ displayRoundOrder: [84, 1, 75] }, 75), 3, '导入的非单调楼层也按实际顺序取序号')
  h.undoTurn(75)
  const undo = h.undo()
  assert.equal(undo.children[0], '撤销回退（恢复第 7 轮）')
  assert.equal(undo.props.title.includes('恢复第 7 轮正文'), true)
  h.view({ displayRoundOrder: [1, 2, 3] })
  h.undoTurn(11)
  assert.equal(h.undo().children[0], '撤销回退（恢复第 4 轮）', '撤销目标已被删除时按恢复后的楼层位置显示')
  assert.deepEqual(displayRoundOrder, [1, 2, 3, 12, 48, 72, 75, 84], '显示计算不改回合号')
})

test('实际回退组件在前台、后台和重生成期间禁用，完成后允许点击', async () => {
  const h = harness()
  for (const phase of ['front', 'background', 'regen']) {
    h.running(phase === 'front'); h.background(phase === 'background'); h.regen(phase === 'regen')
    const button = h.button()
    assert.equal(button.props.disabled, true)
    await button.props.onClick()
    assert.deepEqual(h.calls, [], '禁用时即便直接调用处理器也不能发起请求')
  }
  h.running(false); h.background(false); h.regen(false)
  assert.equal(h.button().props.disabled, false)
  await h.button().props.onClick()
  assert.ok(h.calls.includes('project'))
  assert.ok(!h.calls.includes('confirm'), '点击回退直接执行，不弹确认框')
  assert.equal(h.button().props.disabled, false)
})
