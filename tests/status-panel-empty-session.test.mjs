import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { parseExpressionAt } from 'acorn'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// 当前对话不是游戏（no-session / no-chat / empty-view）时，酒馆状态显示空态提示，
// 不能把「出错了，请稍后再试」推进错误中心；真正的读取失败仍照常上报。
function render(liveState) {
  const start = source.indexOf('function TavernStatusPanel(')
  assert.ok(start >= 0, '找不到酒馆状态面板')
  const node = parseExpressionAt(source, start, { ecmaVersion: 'latest' })
  const persistentErrors = {}
  const context = {
    React: {
      useState: value => [value, () => {}],
      useRef: value => ({ current: value ?? null }),
      useEffect: callback => { callback() },
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
    },
    useTavernConfirm: () => async () => true,
    usePersistentError: source => {
      if (!(source in persistentErrors)) persistentErrors[source] = ''
      return [persistentErrors[source], value => { persistentErrors[source] = String(value && value.message || value || '') }]
    },
    useLiveTavernView: () => liveState,
    isMissingTavernCardError: () => false,
    latestTavernAssistantMessageId: () => null,
    notifyTavernDataChanged: () => {},
    rpc: async () => ({}),
    window: { addEventListener() {}, removeEventListener() {} }
  }
  const component = vm.runInNewContext('(' + source.slice(start, node.end) + ')', context)
  const tree = component({
    sessionId: 'session-empty',
    useSession: selector => selector({ running: false }),
    useChat: () => null
  })
  const texts = []
  ;(function walk(value) {
    if (typeof value === 'string') { texts.push(value); return }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    for (const child of value.children || []) walk(child)
  })(tree)
  return { persistentErrors, texts }
}

for (const reason of ['no-session', 'no-chat', 'empty-view']) {
  test(`重试耗尽后的 ${reason} 是空态，不是错误中心里的「出错了」`, () => {
    const { persistentErrors, texts } = render({ view: null, phase: 'unavailable', error: reason })
    assert.equal(persistentErrors['酒馆状态'], '', `${reason} 不得上报为持久错误`)
    assert.ok(texts.includes('选择人物卡后，这里会显示持续状态。'), '空态应提示选择人物卡')
    assert.ok(!texts.some(text => text.includes('出错了')), '空态不得显示通用错误文案')
  })
}

test('真正的读取失败仍上报错误中心', () => {
  const { persistentErrors } = render({ view: null, phase: 'unavailable', error: '读取存档超时' })
  assert.equal(persistentErrors['酒馆状态'], '读取存档超时')
})

test('重试期间显示重新连接提示，不报错', () => {
  const { persistentErrors, texts } = render({ view: null, phase: 'retrying', error: '' })
  assert.equal(persistentErrors['酒馆状态'], '')
  assert.ok(texts.includes('正在重新连接酒馆状态…'))
})
