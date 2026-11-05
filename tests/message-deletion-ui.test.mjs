import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/features/message-deletion.js', import.meta.url), 'utf8')
const assistantSource = await readFile(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))
function contextWith(extra = {}) {
  const context = vm.createContext({ React, rpc: async () => ({}), liveTavernView: { setView() {} }, askTavernConfirm: async () => false, ...extra })
  vm.runInContext(source, context)
  return context
}

test('/delete 注册为宿主 action，只进入当前 session 的选择模式', () => {
  const context = contextWith()
  const feature = context.createTavernMessageDeletionFeatureModule({ rpc: async () => { throw Error('不应调用 RPC') } })
  let command, Dock
  const ctx = { commandUi: { register(value) { command = value; return () => {} } }, effect(fn) { return fn() } }
  const slots = { inject(_name, fn) { return fn() }, register(_definition, component) { Dock = component; return () => {} } }
  feature.register({ ctx, slots })
  assert.equal(command.name, 'delete')
  assert.equal(command.label(), '删除')
  assert.equal(command.ui.kind, 'action')
  assert.equal(command.available({ sessionId: 'a' }), true)
  command.ui.run({ sessionId: 'a' })
  assert.equal(feature.store.getSnapshot('a').active, true)
  assert.equal(feature.store.getSnapshot('b').active, false)
  assert.equal(Dock, feature.Dock)
})

test('用户 selector 使用原生 turn，AI selector 只使用剧情回合与正文身份', () => {
  const context = contextWith()
  const feature = context.createTavernMessageDeletionFeatureModule()
  const user = feature.userSelector(7, { seq: 3 })
  const assistant = feature.assistantSelector(8, 5, { finalNode: { seq: 11, messageId: 42 } })
  assert.deepEqual({ ...user }, { role: 'user', turn: 7, seq: 3 })
  assert.deepEqual({ ...assistant }, { role: 'assistant', storyTurn: 5, seq: 11, messageId: '42' })
  feature.store.enter('a')
  feature.store.toggle('a', user)
  feature.store.toggle('a', assistant)
  assert.deepEqual(JSON.parse(JSON.stringify(feature.store.getSnapshot('a').items)), JSON.parse(JSON.stringify([user, assistant])))
  assert.equal(feature.store.getSnapshot('b').items.length, 0)
  feature.store.toggle('a', user)
  assert.deepEqual(JSON.parse(JSON.stringify(feature.store.getSnapshot('a').items)), JSON.parse(JSON.stringify([assistant])))
})

test('原生 turn 改变不会使已选正文变成另一项', () => {
  const context = contextWith()
  const feature = context.createTavernMessageDeletionFeatureModule()
  const before = feature.assistantSelector(8, 5, { finalNode: { seq: 11, messageId: 'reply-5' } })
  const after = feature.assistantSelector(99, 5, { finalNode: { seq: 11, messageId: 'reply-5' } })
  feature.store.enter('a')
  feature.store.toggle('a', before)
  feature.store.toggle('a', after)
  assert.equal(feature.store.getSnapshot('a').items.length, 0, '同一正文的新旧 turn 应共用选择键')
})

test('删除中锁定操作；成功清选择并刷新 view，失败保留选择', async () => {
  const calls = [], views = []
  let finish
  const context = contextWith()
  const feature = context.createTavernMessageDeletionFeatureModule({
    rpc: (...args) => { calls.push(args); return new Promise((resolve, reject) => { finish = { resolve, reject } }) },
    applyView: (...args) => views.push(args)
  })
  const selector = feature.userSelector(2, { seq: 9 })
  feature.store.enter('a')
  feature.store.toggle('a', selector)
  const pending = feature.store.remove('a')
  assert.equal(feature.store.getSnapshot('a').deleting, true)
  feature.store.toggle('a', feature.userSelector(3, { seq: 10 }))
  feature.store.clear('a')
  feature.store.cancel('a')
  assert.equal(feature.store.getSnapshot('a').items.length, 1)
  assert.equal(feature.store.getSnapshot('a').active, true)
  finish.resolve({ view: { revision: 2 }, deletedCount: 1 })
  await pending
  assert.equal(feature.store.getSnapshot('a').active, false)
  assert.equal(feature.store.getSnapshot('a').items.length, 0)
  assert.deepEqual(views, [['a', { revision: 2 }]])
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['deleteMessages', { items: [{ role: 'user', turn: 2, seq: 9 }] }, 'a'])

  feature.store.enter('a')
  feature.store.toggle('a', selector)
  const failed = feature.store.remove('a')
  finish.reject(Error('删除失败'))
  assert.equal(await failed, null)
  assert.equal(feature.store.getSnapshot('a').active, true)
  assert.equal(feature.store.getSnapshot('a').deleting, false)
  assert.equal(feature.store.getSnapshot('a').items.length, 1)
  assert.equal(feature.store.getSnapshot('a').error, '删除失败')
})

test('复选框、楼层点击与 dock 支持独立勾选、清空、删除禁用、Esc 和取消', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  let root
  t.after(async () => {
    if (root) await act(async () => { root.unmount() })
    Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act })
    dom.window.close()
  })
  const { createRoot } = await import('react-dom/client')
  const context = contextWith({ document: dom.window.document })
  let finish
  const feature = context.createTavernMessageDeletionFeatureModule({
    confirm: async () => true,
    rpc: () => new Promise(resolve => { finish = resolve }),
    applyView() {}
  })
  const user = feature.userSelector(1, { seq: 4 })
  const assistant = feature.assistantSelector(2, 2, { finalNode: { seq: 8, messageId: 'm8' } })
  function View() {
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: 'dsh-tavern-user-row' },
        React.createElement('div', { className: 'dsh-tavern-user-bubble' }, '用户楼层'),
        React.createElement('button', { type: 'button' }, '复制'),
        React.createElement(feature.Checkbox, { sessionId: 'a', selector: user })),
      React.createElement('div', { className: 'dsh-tavern-assistant' },
        React.createElement('div', { className: 'dsh-tavern-assistant-body' }, 'AI 楼层'),
        React.createElement(feature.Checkbox, { sessionId: 'a', selector: assistant })),
      React.createElement(feature.Dock, { sessionId: 'a' }))
  }
  root = createRoot(dom.window.document.querySelector('main'))
  await act(async () => { feature.store.enter('a'); root.render(React.createElement(View)) })
  const checkboxes = () => [...dom.window.document.querySelectorAll('input[type="checkbox"]')]
  assert.equal(checkboxes().length, 2)
  await act(async () => { checkboxes()[0].click() })
  await act(async () => { checkboxes()[1].click() })
  assert.deepEqual(checkboxes().map(input => input.checked), [true, true])
  assert.match(dom.window.document.querySelector('.dsh-tavern-message-deletion-count').textContent, /已选 2 条/)
  await act(async () => { [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '清空').click() })
  assert.deepEqual(checkboxes().map(input => input.checked), [false, false])
  await act(async () => { [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '复制').click() })
  assert.deepEqual(checkboxes().map(input => input.checked), [false, false], '楼层内原有按钮不触发选择')
  await act(async () => { dom.window.document.querySelector('.dsh-tavern-user-bubble').click() })
  await act(async () => { dom.window.document.querySelector('.dsh-tavern-assistant-body').click() })
  assert.deepEqual(checkboxes().map(input => input.checked), [true, true], '点击用户与 AI 楼层正文即可选中')
  await act(async () => { dom.window.document.querySelector('.dsh-tavern-user-bubble').click() })
  assert.deepEqual(checkboxes().map(input => input.checked), [false, true], '再次点击同一楼层取消选中')
  await act(async () => { checkboxes()[0].click() })
  assert.deepEqual(checkboxes().map(input => input.checked), [true, true], '复选框点击不会被楼层监听重复切换')
  await act(async () => { [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '删除').click() })
  await flush()
  assert.ok(checkboxes().every(input => input.disabled))
  assert.ok([...dom.window.document.querySelectorAll('.dsh-tavern-message-deletion-actions button')].every(button => button.disabled))
  await act(async () => { finish({ view: {}, deletedCount: 2 }); await flush() })
  assert.equal(checkboxes().length, 0)
  assert.equal(dom.window.document.querySelector('.dsh-tavern-message-deletion-dock'), null)

  await act(async () => { feature.store.enter('a') })
  await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  await act(flush)
  assert.equal(feature.store.getSnapshot('a').active, false)
  await act(async () => { feature.store.enter('a') })
  await act(async () => { [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '取消').click() })
  assert.equal(feature.store.getSnapshot('a').active, false)
})

test('assistant 的 deferred、distant 和隐藏行 early return 位于复选框创建之前', () => {
  const checkbox = assistantSource.indexOf('const deletionNode =')
  assert.ok(checkbox > 0)
  for (const marker of ['if (!tavernPlanShowsRow(', 'if (deferredFloor) return', 'if (distantHeight > 0) return']) {
    const at = assistantSource.indexOf(marker)
    assert.ok(at >= 0 && at < checkbox, marker)
  }
  assert.ok(assistantSource.includes('selector: messageDeletionFeature.userSelector(turn, data)'))
  assert.ok(assistantSource.includes('messageDeletionFeature.assistantSelector(turn, storyTurn, data)'))
})
