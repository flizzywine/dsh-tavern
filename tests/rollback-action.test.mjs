import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function CandidateAction('), source.indexOf('function CandidateDockActions('))
const roundOrdinal = source.slice(source.indexOf('function tavernRoundOrdinal('), source.indexOf('function tavernStoryTurnForDshTurn('))
const withdrawHelper = source.slice(source.indexOf('async function withdrawFailedTavernTurn('), source.indexOf('// Any problem in a game'))
// The replay submit path sits above CandidateAction; slice it with its only helper.

function harness() {
  let running = true, activity = { phase: 'idle', busy: false, role: '' }, regen = null, fail = false, warning = '', canRollback = true, undoTurn = null, noView = false, bareView = false
  const states = [], calls = [], extraView = {}, refs = [], effects = [], timers = []
  let cursor = 0
  const context = {
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      // 同一位置的 ref 跨渲染保持，补读计数才不会被一次重渲染清零。
      useRef(value) {
        const index = cursor++
        if (!(index in refs)) refs[index] = { current: value }
        return refs[index]
      },
      useEffect(fn) { effects.push(fn) }, useLayoutEffect() {},
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      }
    },
    useCandidatePanel: () => null, useRegenPanel: () => regen,
    useTavernSessionMode: () => 'story', latestTavernAssistantMessageId: () => 'reply',
    // bareView：视图在、但没带上 canRegenerate/canRollback 这一栏（投影视图、落盘前那一秒）。
    useLiveTavernView: () => (noView ? { view: null } : { view: bareView ? { undoRollbackTurn: undoTurn, ...extraView } : { canRollback, undoRollbackTurn: undoTurn, ...extraView } }),
    useTavernCoordination: () => ({ view: { activity } }),
    describeTavernActivity: value => value, isPlayMode: () => true,
    window: {
      confirm: () => { calls.push('confirm'); return true },
      setTimeout(run, delay) { timers.push({ run, delay, cancelled: false, fired: false }); return timers.length },
      clearTimeout(id) { const timer = timers[id - 1]; if (timer) timer.cancelled = true }
    },
    rpc: async () => { calls.push('rpc'); if (fail) throw new Error('本次回复未完成'); return { view: { rollbackWarning: warning } } },
    historyProjection: { rolledBack: () => calls.push('project'), restored: () => calls.push('restore') },
    setCandidatePanel() { calls.push('set-candidate-panel') }, setRegenPanel() { calls.push('set-regen-panel') }, setCandidateGuidePanel() { calls.push('set-guide-panel') },
    liveTavernView: { invalidate: () => calls.push('refresh-view') },
    tavernCoordination: { invalidate: () => calls.push('refresh-activity') },
    notifyTavernDataChanged: () => calls.push('notify'),
    tavernErrorHub: { report: (name, error) => calls.push(name + ': ' + error.message) },
    submitFailedTurnReplay: async sessionId => { calls.push('replay'); return { view: {} } },
    TavernDebugButton: function TavernDebugButton() {},
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
    noView(value) { noView = value },
    bareView(value) { bareView = value },
    effects() { return effects.slice() },
    renderEffects() {
      const cleanups = effects.map(fn => fn())
      return cleanups
    },
    timers() { return timers.filter(timer => !timer.cancelled && !timer.fired) },
    fire() {
      const pending = timers.filter(timer => !timer.cancelled && !timer.fired)
      pending.forEach(timer => { timer.fired = true; timer.run() })
      return pending
    },
    buttons() {
      cursor = 0
      effects.length = 0
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

test('旧版视图缺少 canRegenerate 时仍兼容 canRollback 回退判断', () => {
  const h = harness()
  h.running(false); h.playerRound(false)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项', '重新生成正文'])
  assert.equal(h.buttons()[1].props.disabled, true)
  h.playerRound(true)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项', '重新生成正文'])
  assert.equal(h.buttons()[1].props.disabled, false)
  h.playerRound(false)
  assert.equal(h.buttons()[1].props.disabled, true)
})

test('首轮正文删除后，待回复输入提供的 canRegenerate 直接启用按钮', () => {
  const h = harness()
  h.running(false); h.playerRound(false)
  h.view({ canRegenerate: true, failedTailTurn: 2, failedTailPersisted: true })
  const regenerate = h.buttons()[1]
  assert.equal(regenerate.children[0], '重新生成正文')
  assert.equal(regenerate.props.disabled, false)
})

test('视图在、却没带重生成能力字段时，按正文判断，不说「还没有正文」', () => {
  const h = harness()
  h.running(false); h.bareView(true)
  h.view({ latestAssistantTurn: 46, latestAssistantMessageId: 'tavern-regen:1' })
  const regenerate = h.buttons()[1]
  assert.equal(regenerate.props.disabled, false)
  assert.doesNotMatch(regenerate.props.title, /还没有可重新生成的正文/)
})

test('视图在、没有正文也没有能力字段时，仍然禁用并说明没东西可重生成', () => {
  const h = harness()
  h.running(false); h.bareView(true)
  const regenerate = h.buttons()[1]
  assert.equal(regenerate.props.disabled, true)
  assert.match(regenerate.props.title, /还没有可重新生成的正文/)
})

test('视图在但按钮还不能用时，同样补读一次，不把灰的原因锁死在旧视图上', () => {
  const h = harness()
  h.running(false); h.bareView(true)
  h.view({ latestAssistantTurn: 0 })
  h.buttons(); h.renderEffects()
  const pending = h.fire()
  assert.equal(pending.length, 1)
})

test('视图还没读到时，灰按钮说的是「正在读取这一局」，不是「还没有正文」', () => {
  const h = harness()
  h.running(false); h.noView(true)
  const regenerate = h.buttons()[1]
  assert.equal(regenerate.props.disabled, true)
  assert.match(regenerate.props.title, /正在读取这一局/)
  assert.doesNotMatch(regenerate.props.title, /还没有可重新生成的正文/)
})

test('正在跑的那一轮把灰的原因写成「还在收尾」，不再是一句默认说明', () => {
  const h = harness()
  h.running(true)
  const regenerate = h.buttons()[1]
  assert.equal(regenerate.props.disabled, true)
  assert.match(regenerate.props.title, /这一轮还在收尾/)
})

test('视图丢了没人重读时，按钮自己补读，最多三次', () => {
  const h = harness()
  h.running(false); h.noView(true)
  const delays = []
  for (let round = 0; round < 4; round++) {
    h.buttons(); h.renderEffects()
    const pending = h.timers()
    delays.push(pending.length ? pending[0].delay : null)
    if (!pending.length) continue
    h.calls.length = 0
    h.fire()
    assert.deepEqual(h.calls, ['refresh-view', 'refresh-activity'])
  }
  assert.deepEqual(delays, [700, 1600, 2500, null])
})

test('视图已经在手时不补读，别的都在忙时也不补读', () => {
  const h = harness()
  h.running(false)
  h.buttons(); h.renderEffects()
  assert.deepEqual(h.timers(), [], '视图在手不补读')
  h.noView(true); h.activity({ phase: 'running', busy: true, role: 'settlement' })
  h.buttons(); h.renderEffects()
  assert.deepEqual(h.timers(), [], '结算在跑时交给它自己收尾')
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

test('撤回持久输入后立即刷新故事列表，原输入只回填到输入框', async () => {
  const calls = []
  const context = {
    rpc: async () => ({ view: { clearedInput: '6' } }),
    historyProjection: { rolledBack: () => calls.push('native-hidden') },
    window: { dispatchEvent: event => calls.push(['story-refresh', event.detail.sessionId]) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    setCandidatePanel() {}, setRegenPanel() {}, setCandidateGuidePanel() {},
    askTavernConfirm: async () => true
  }
  const withdraw = vm.runInNewContext(withdrawHelper + '; withdrawFailedTavernTurn', context)
  await withdraw('session', { setDraft: value => calls.push(['draft', value]) }, '')
  assert.deepEqual(calls, ['native-hidden', ['story-refresh', 'session'], ['draft', '6']])
})
