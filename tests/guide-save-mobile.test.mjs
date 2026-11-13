import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { parseExpressionAt } from 'acorn'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// 手机端没有可靠的回车：输入框旁必须有常驻的「添加」按钮，回车只作为桌面快捷键。
function render({ draft = "", busy = false, guides = [] } = {}) {
  const start = source.indexOf('function StatusPanelView(')
  assert.ok(start >= 0, '找不到酒馆状态图')
  const node = parseExpressionAt(source, start, { ecmaVersion: 'latest' })
  const calls = { addGuide: 0, openStyleTab: [] }
  const view = { mode: 'story', statusBarPlacement: 'body', card: { name: '卡', path: '' }, activity: {}, guides }
  const TextArea = function TextArea() {}
  const context = {
    React: {
      useState: value => [value, () => {}], useRef: value => ({ current: value ?? null }),
      useSyncExternalStore: (subscribe, snapshot) => snapshot(), useEffect() {},
      createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
    },
    useTavernConfirm: () => () => {}, usePersistentError: () => ['', () => {}],
    useLiveTavernView: () => ({ view, phase: 'ready' }), isMissingTavernCardError: () => false,
    latestTavernAssistantMessageId: () => null, TavernPersistentStatusRuntime: () => {}, packUi: {},
    TextArea,
    EmptyState: () => {}, TavernDebugButton: () => {}, TavernBackgroundWait: () => {}, TavernBackgroundRunsLink: () => {},
    TavernSaveUpgrade: () => {}, TavernCardAppDock: () => {}, TavernPluginTasks: () => {}, TavernPluginStatusSections: () => {},
    TavernLedger: () => {}, TavernMvuVariables: () => {}, TavernLazyDetails: () => {}, ScriptNavigation: () => {}
  }
  const component = vm.runInNewContext('(' + source.slice(start, node.end) + ')', context)
  const tree = component({
    view, running: false, props: { sessionId: 's', openStyleTab: id => calls.openStyleTab.push(id) },
    guideDraft: draft, setGuideDraft: () => {}, guideBusy: busy, guideError: '', guideInputRef: { current: null },
    guideNotice: '', addGuide: () => { calls.addGuide++; }, saveGuideLibrary: () => {}
  })
  const all = []
  ;(function walk(value) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (value.type) all.push(value)
    for (const child of value.children || []) walk(child)
  })(tree)
  const field = all.find(element => element.type === TextArea && element.props.className === 'fork-status-guide-input')
  const button = all.find(element => element.type === 'button' && element.props.className === 'fork-status-guide-save')
  return { all, field, button, calls }
}

test('Guide 输入框旁常驻「添加」按钮，手机上不必依赖回车', () => {
  const { field, button } = render({ draft: '多写心理活动' })
  assert.ok(field, 'Guide 输入框仍在')
  assert.ok(button, '输入框旁必须有「添加」按钮')
  assert.equal(button.children.join(''), '添加')
  assert.notEqual(button.props.disabled, true, '有草稿时按钮可点')
  assert.equal(typeof button.props.onClick, 'function')
})

test('没有草稿或正在保存时「添加」按钮不可点，但按钮始终存在', () => {
  for (const options of [{ draft: '   ' }, { draft: '' }, { draft: '有内容', busy: true }]) {
    const { button } = render(options)
    assert.ok(button, '草稿为空时按钮也必须留在界面上')
    assert.equal(button.props.disabled, true, JSON.stringify(options) + ' 应为禁用')
  }
})

test('点「添加」走 addGuide，与回车走的是同一条保存路径', () => {
  const { button, calls } = render({ draft: '多写心理活动' })
  button.props.onClick()
  assert.equal(calls.addGuide, 1)
})

test('回车只有在输入法不介入时才保存：229 与 composition 期间不吞草稿', () => {
  const { field, calls } = render({ draft: '多写心理活动' })
  const press = overrides => {
    const event = { key: 'Enter', keyCode: 13, shiftKey: false, nativeEvent: {}, preventDefault() { this.prevented = true }, ...overrides }
    field.props.onKeyDown(event)
    return event
  }
  assert.equal(render({}).field.props.enterKeyHint, 'done', '手机键盘提示回车用途')

  const plain = press({})
  assert.equal(calls.addGuide, 1, '桌面回车仍然保存')
  assert.equal(plain.prevented, true)

  press({ keyCode: 229 })
  press({ nativeEvent: { isComposing: true } })
  press({ shiftKey: true })
  assert.equal(calls.addGuide, 1, '输入法组字与换行不得触发保存')
})
