import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function CandidateAction('), source.indexOf('function CandidateDockActions('))
// The replay submit path sits above CandidateAction; slice it with its only helper.

function harness() {
  let running = true, activity = { phase: 'idle', busy: false, role: '' }, regen = null, fail = false, warning = '', canRollback = true, undoTurn = null
  const states = [], calls = [], extraView = {}, effects = []
  let published = null
  let cursor = 0
  const context = {
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      useRef: value => ({ current: value }), useEffect(effect) { effects.push(effect) }, useLayoutEffect() {},
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      }
    },
    useCandidatePanel: () => null, useRegenPanel: () => regen,
    regenEntry: { get value() { return published } }, setRegenEntry: value => { published = value },
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
  const actions = vm.runInNewContext(component + '; ({ CandidateAction, TavernRollbackAction, TavernUndoRollbackAction, TavernMoreActions })', context)
  return {
    calls,
    view(value) { Object.assign(extraView, value) },
    undoTurn(value) { undoTurn = value },
    undo() { cursor = 0; return actions.TavernUndoRollbackAction({ sessionId: 'session', useSession: select => select({ running }) }) },
    playerRound(value) { canRollback = value },
    running(value) { running = value },
    background(value) { activity = value ? { phase: 'running', busy: true, role: 'settlement' } : { phase: 'idle', busy: false, role: '' } },
    activity(value) { activity = value },
    regen(value) { regen = value ? { sessionId: 'session', phase: 'loading' } : null },
    fail(value) { fail = value }, warning(value) { warning = value },
    // The 重新生成正文 entry CandidateAction publishes for the icon in the turn's action row.
    entry() {
      cursor = 0; effects.length = 0; published = null
      actions.CandidateAction({ sessionId: 'session', messageId: 'reply', useSession: select => select({ running }), useChat: select => select({}) })
      const mine = effects.splice(0)
      calls.length = 0
      mine.forEach(effect => effect())
      calls.length = 0
      return published
    },
    buttons() {
      cursor = 0
      return actions.CandidateAction({ sessionId: 'session', messageId: 'reply',
        useSession: select => select({ running }), useChat: select => select({})
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

test('开场白不显示正文重生成入口；正式玩家轮次完成后由该轮操作栏的图标提供，输入框上方不再有按钮', () => {
  const h = harness()
  h.running(false); h.playerRound(false)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项'])
  assert.equal(h.entry(), null)
  h.playerRound(true)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项'])
  const entry = h.entry()
  assert.equal(entry.messageId, 'reply')
  assert.equal(entry.disabled, false)
  assert.equal(entry.spinning, false)
  h.regen(true)
  assert.equal(h.entry().spinning, true, '重新生成期间图标旋转')
  h.regen(false); h.running(true)
  assert.equal(h.entry().disabled, true)
  h.running(false); h.playerRound(false)
  assert.equal(h.entry(), null)
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
