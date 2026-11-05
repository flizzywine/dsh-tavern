import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse } from 'acorn'
import React, { act } from 'react'
import { JSDOM } from 'jsdom'

const stageSource = await readFile(new URL('../tavern-plugin/src/client/stage-scene-images.js', import.meta.url), 'utf8')
const extensionsSource = await readFile(new URL('../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')
function declaration(source, name) {
  let found
  ;(function visit(node) {
    if (!node || found) return
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) { found = node; return }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
    }
  })(parse(source, { ecmaVersion: 'latest', sourceType: 'script' }))
  return source.slice(found.start, found.end)
}
// react-dom picks its input events from the document present when it loads, so it loads after one exists.
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const runSource = declaration(extensionsSource, 'watchTavernIllustrationStart') + '\n' + declaration(extensionsSource, 'runTavernIllustrator')

// The stage's 场景生图 popover with the real request wrapper; the illustrator and the turn's plugin items are fakes.
async function mount(t, existing = []) {
  const container = dom.window.document.body.appendChild(dom.window.document.createElement('main'))
  const items = existing.map(id => ({ id })), listeners = new Set(), draws = []
  const h = React.createElement
  const context = vm.createContext({ React, window: dom.window, document: dom.window.document, setTimeout,
    rpc: async (method, args, sessionId) => { assert.equal(JSON.stringify([method, args, sessionId]), JSON.stringify(['pluginMediaForTurn', { turn: 4 }, 'game-1'])); return { items: items.slice() } },
    tavernPluginMediaIndex: { subscribe: (_, listener) => { listeners.add(listener); return () => listeners.delete(listener) }, has: () => items.length > 0 },
    tavernIllustrationDrafts: { get: () => null, set() {} }, TAVERN_ILLUSTRATION_NOTICE_MS: 8000,
    useTavernIllustratePress: (_busy, _draw, openManual) => ({ handlers: { onClick() {}, onContextMenu: event => { event.preventDefault(); openManual() } }, release() {} }),
    useBgmPopover() {}, useForkUiSfxControls() {}, forkUiSfx: { play() {} }, TAVERN_ILLUSTRATE_TITLE: '',
    Spinner: () => null, Icon: () => null,
    TextArea: props => h('textarea', { ref: props.inputRef, value: props.value, disabled: props.disabled, 'aria-label': props.label, onChange: event => props.onChange(event.target.value) }),
  })
  vm.runInContext(runSource + '\n' + stageSource, context)
  const illustrator = { draw: request => new Promise((resolve, reject) => draws.push({ request, resolve, reject })) }
  const root = createRoot(container)
  await act(async () => root.render(h(context.StageSceneImageButton, { sessionId: 'game-1', turn: 4, illustrator })))
  t.after(async () => { await act(async () => root.unmount()); container.remove() })
  const $ = selector => container.querySelector(selector)
  const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) })
  return { $, draws, settle,
    async open(text) {
      await act(async () => $('.fork-gal-scene-image').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      const field = $('textarea'), setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set
      await act(async () => { setValue.call(field, text); field.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
    },
    async submit() { await act(async () => $('.fork-scene-image-submit').click()); await settle() },
    async pictureStarts(id) { items.push({ id }); await act(async () => listeners.forEach(listener => listener())); await settle() },
  }
}

test('the request popover closes once the illustrator takes the request, not when the pictures are done', async t => {
  const stage = await mount(t)
  await stage.open('从门外侧拍摄')
  await stage.submit()
  assert.deepEqual(JSON.parse(JSON.stringify(stage.draws.map(draw => draw.request))), [{ gameId: 'game-1', turn: 4, instruction: '从门外侧拍摄' }])
  assert.equal(stage.$('.fork-scene-image-submit').textContent, '正在提交…')
  await stage.pictureStarts('picture-1')
  assert.equal(stage.$('form'), null, 'the first picture of the turn closes the popover while it is still drawing')
  await stage.open('')
  assert.equal(stage.$('.fork-scene-image-submit').disabled, false, 'reopened, it takes a new request')
  stage.draws[0].reject(new Error('生成失败'))
  await stage.settle()
  assert.equal(stage.$('[role=alert]'), null, 'a failure after the start stays with the picture, not the new request')
})

test('a request the illustrator turns down keeps the popover, the text and a plain error', async t => {
  const stage = await mount(t, ['earlier'])
  await stage.open('角色正在推开窗户')
  await stage.submit()
  await stage.pictureStarts('earlier')
  assert.ok(stage.$('form'), 'an item the turn already had does not count as the start')
  stage.draws[0].reject(Object.assign(new Error('这一轮的生图任务正在进行，请稍后重试'), { statusCode: 409 }))
  await stage.settle()
  assert.ok(stage.$('form'))
  assert.equal(stage.$('textarea').value, '角色正在推开窗户')
  assert.equal(stage.$('[role=alert]').textContent, '⚠ 没能开始配图')
  assert.equal(stage.$('.fork-scene-image-submit').disabled, false)
})

test('a request that plans no picture closes on success; 取消 closes without drawing', async t => {
  const stage = await mount(t)
  await stage.open('俯拍')
  await stage.submit()
  stage.draws[0].resolve({ notice: '本轮跳过配图：没有合适的画面' })
  await stage.settle()
  assert.equal(stage.$('form'), null)
  await stage.open('近景')
  await act(async () => stage.$('.fork-scene-image-cancel').click())
  assert.equal(stage.$('form'), null)
  assert.equal(stage.draws.length, 1)
})
