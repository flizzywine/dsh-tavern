import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { clientControls } from './fixtures/native-controls.mjs'

// 真实 DOM 上的状态面板回归：展开、改字段、保存时只写当前楼层。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEARCH_ROOTS = [path.join(root, 'tavern-plugin/node_modules'), path.join(root, 'node_modules')]
function loadPackage(name) {
  let failure = null
  for (const base of SEARCH_ROOTS) {
    try { return createRequire(path.join(base, 'noop.js'))(name) } catch (error) { failure = error }
  }
  throw new Error('缺少测试依赖 ' + name + '：' + (failure && failure.message))
}

const { JSDOM } = loadPackage('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:41661/' })
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true
})) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })

const React = loadPackage('react')
const { createRoot } = loadPackage('react-dom/client')
const act = React.act || loadPackage('react-dom/test-utils').act

function panelFactory() {
  const domain = readFileSync(path.join(root, 'tavern-plugin/lib/domain/mvu-variable-editor.js'), 'utf8')
    .replace(/\r?\nexport \{[\s\S]*\}\r?\n?$/, '\n')
  const panel = readFileSync(path.join(root, 'tavern-plugin/src/client/modules/mvu-variables.js'), 'utf8')
  const controls = clientControls(React)
  const factory = new Function('React', 'rpc', 'liveTavernView', ...Object.keys(controls), domain + '\n' + panel + '\nreturn { TavernMvuVariables };')
  return (...args) => factory(...args, ...Object.values(controls))
}

const view = {
  latestAssistantTurn: 2,
  tavernHelper: {
    mvuEnabled: true,
    lifecycleRevision: 7,
    turnMessageIds: { 2: 1 },
    messages: [
      { message_id: 0, role: 'user', swipe_id: 0, variables: [] },
      { message_id: 1, role: 'assistant', swipe_id: 0, variables: {
        stat_data: { 生命: 5, 背包: ['药'] },
        schema: { 生命: 'number' },
        display_data: { 生命: '生命值' }
      } }
    ]
  }
}

test('MVU 面板展开当前楼层、改字段并保留 schema', async () => {
  const calls = []
  const invalidated = []
  const factory = panelFactory()
  const { TavernMvuVariables } = factory(React, async function (method, args, sessionId) {
    calls.push({ method, args, sessionId })
    return { updated: true }
  }, { invalidate(sessionId) { invalidated.push(sessionId) } })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const reactRoot = createRoot(host)
  await act(async () => { reactRoot.render(React.createElement(TavernMvuVariables, { sessionId: 'game', view })) })
  try {
    const toggle = Array.from(host.querySelectorAll('button')).find(button => /MVU 变量/.test(button.textContent))
    assert.ok(toggle)
    await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    assert.match(host.textContent, /第 2 轮楼层 #1 的 MVU 状态数据/)
    const field = Array.from(host.querySelectorAll('label.dsh-mvu-field')).find(label => label.textContent.includes('生命'))
    assert.ok(field)
    const input = field.querySelector('input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '9')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '保存修改')
    assert.equal(save.disabled, false)
    await act(async () => { save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)) })
    assert.match(host.textContent, /已保存到当前楼层（第 2 轮）/)
    const call = calls.find(item => item.method === 'updateTavernHelperVariables')
    assert.ok(call)
    assert.equal(call.sessionId, 'game')
    assert.deepEqual(call.args.option, { type: 'message', message_id: 1, swipe_id: 0 })
    assert.equal(call.args.expectedLifecycleRevision, 7)
    assert.equal(call.args.variables.stat_data['生命'], 9)
    assert.deepEqual(call.args.variables.schema, { 生命: 'number' })
    assert.deepEqual(call.args.variables.display_data, { 生命: '生命值' })
    assert.deepEqual(invalidated, ['game'])
  } finally {
    await act(async () => { reactRoot.unmount() })
    host.remove()
  }
})
