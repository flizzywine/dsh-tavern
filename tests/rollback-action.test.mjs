import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const component = source.slice(source.indexOf('function CandidateAction('), source.indexOf('function CandidateDockActions('))

function harness() {
  let running = true, activity = { phase: 'idle', busy: false, role: '' }, regen = null, fail = false, warning = '', canRollback = true
  const states = [], calls = []
  let cursor = 0
  const context = {
    React: {
      Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props, children }),
      useRef: value => ({ current: value }), useEffect() {},
      useState(initial) {
        const index = cursor++
        if (!(index in states)) states[index] = initial
        return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
      }
    },
    useCandidatePanel: () => null, useRegenPanel: () => regen,
    useTavernSessionMode: () => 'story', latestTavernAssistantMessageId: () => 'reply',
    useLiveTavernView: () => ({ view: { canRollback } }),
    useTavernCoordination: () => ({ view: { activity } }),
    describeTavernActivity: value => value, isPlayMode: () => true,
    window: { confirm: () => { calls.push('confirm'); return true } },
    rpc: async () => { calls.push('rpc'); if (fail) throw new Error('本次回复未完成'); return { view: { rollbackWarning: warning } } },
    historyProjection: { rolledBack: () => calls.push('project') },
    setCandidatePanel() {}, setRegenPanel() {}, setCandidateGuidePanel() {},
    liveTavernView: { invalidate: () => calls.push('refresh-view') },
    tavernCoordination: { invalidate: () => calls.push('refresh-activity') },
    notifyTavernDataChanged: () => calls.push('notify'),
    tavernErrorHub: { report: (name, error) => calls.push(name + ': ' + error.message) },
    TavernCompactionAction: function TavernCompactionAction() {}
  }
  const actions = vm.runInNewContext(component + '; ({ CandidateAction, TavernRollbackAction, TavernMoreActions })', context)
  return {
    calls,
    playerRound(value) { canRollback = value },
    running(value) { running = value },
    background(value) { activity = value ? { phase: 'running', busy: true, role: 'settlement' } : { phase: 'idle', busy: false, role: '' } },
    activity(value) { activity = value },
    regen(value) { regen = value ? { sessionId: 'session', phase: 'loading' } : null },
    fail(value) { fail = value }, warning(value) { warning = value },
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

test('开场白不显示正文重生成入口，正式玩家轮次完成后只显示一个入口', () => {
  const h = harness()
  h.running(false); h.playerRound(false)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项'])
  h.playerRound(true)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项', '重新生成正文'])
  h.playerRound(false)
  assert.deepEqual(h.buttons().map(button => button.children[0]), ['生成候选项'])
})

test('更多菜单收起回退和压缩，并可再次关闭', () => {
  const h = harness()
  h.running(false)
  let more = h.more()
  assert.equal(more.children[0].children[0], '更多 ▾')
  assert.equal(more.children[0].props['aria-expanded'], false)
  assert.equal(more.children[1].props.hidden, true)
  more.children[0].props.onClick()
  more = h.more()
  assert.equal(more.children[0].props['aria-expanded'], true)
  assert.equal(more.children[1].props.hidden, false)
  assert.equal(more.children[1].props.role, 'menu')
  assert.deepEqual(more.children[1].children.map(child => child.type.name), ['TavernRollbackAction', 'TavernCompactionAction'])
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
  assert.equal(h.button().props.disabled, false)
})

test('待接续或运行中的结算只允许重新生成取消旧结算，其他轮次操作保持禁用', async () => {
  const h = harness()
  h.running(false)
  for (const phase of ['pending', 'running']) {
    h.activity({ phase, busy: phase === 'running', role: 'settlement' })
    const [candidate, regenerate] = h.buttons()
    assert.equal(candidate.props.disabled, true)
    assert.equal(candidate.children[0], '后台结算中…')
    assert.equal(regenerate.props.disabled, false)
    assert.match(regenerate.props.title, /取消当前正文的后台结算/)
    assert.equal(h.button().props.disabled, true, '回退不能绕过结算取消协议')
  }
  h.activity({ phase: 'running', busy: true, role: 'candidate' })
  assert.equal(h.buttons()[1].props.disabled, true, '候选任务不能被正文重生成误取消')
})

test('实际回退组件在请求被拒后解除忙碌并刷新，下一次点击重新提交', async () => {
  const h = harness()
  h.running(false); h.fail(true)
  await h.button().props.onClick()
  assert.equal(h.button().props.disabled, false)
  assert.ok(h.calls.includes('refresh-view'))
  assert.ok(h.calls.includes('refresh-activity'))
  assert.ok(!h.calls.includes('project'), '失败不隐藏正文')
  h.fail(false)
  await h.button().props.onClick()
  assert.equal(h.calls.filter(call => call === 'rpc').length, 2)
  assert.equal(h.calls.filter(call => call === 'project').length, 1)
})

test('脚本联动警告保留成功回退投影，不显示为回退失败', async () => {
  const h = harness()
  h.running(false); h.warning('回退已完成，但脚本联动失败')
  await h.button().props.onClick()
  assert.ok(h.calls.includes('project'))
  assert.ok(h.calls.includes('回退脚本联动: 回退已完成，但脚本联动失败'))
  assert.ok(!h.calls.some(call => call.startsWith('回退本轮:')))
})
