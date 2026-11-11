// 配音 › 发音字典 (ReadingsEditor in asset-pack-card-ui.js) rendered over the real inline fields (inline-field.js) and the
// real reading store (dsh-tavern-tts reading-presets.js) behind its control RPC.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {JSDOM} from 'jsdom'
import {createReadingPresetStore} from '../tavern-plugin/packages/dsh-tavern-tts/src/reading-presets.js'

const read = file => readFile(new URL('../tavern-plugin/' + file, import.meta.url), 'utf8')
const [cardUi, inlineField] = await Promise.all([read('packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js'), read('src/client/inline-field.js')])
const editorSource = cardUi.slice(cardUi.indexOf('// the one 读音词典'), cardUi.indexOf('// the card export helpers of 「素材包」'))

// react-dom decides at load time which input events the document supports: the DOM comes first.
const dom = new JSDOM('<!doctype html><body></body>', {pretendToBeVisual:true})
Object.assign(globalThis, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true, HTMLElement:dom.window.HTMLElement})
const {default:React, act} = await import('react'), {default:ReactDOM} = await import('react-dom'), {createRoot} = await import('react-dom/client')
test.after(() => dom.window.close())

const STORE_METHODS = {readingPresets:'list', readingPreset:'get', editReading:'edit', mergeReadings:'merge', createReadingPreset:'create', renameReadingPreset:'rename',
  deleteReadingPreset:'remove', setActiveReadingPreset:'setActive', exportReadingPreset:'exportPreset', importReadingPreset:'importPreset'}

async function mount(t, {entries = []} = {}) {
  const container = dom.window.document.body.appendChild(dom.window.document.createElement('div'))
  const store = createReadingPresetStore(), calls = []
  if (entries.length) await store.importPreset({document:{version:1, kind:'dsh-tts-readings', name:'大', entries}}).then(r => store.setActive({id:r.id}))
  const call = async (method, args = {}) => { calls.push({method, args}); return structuredClone(await store[STORE_METHODS[method]](args)) }
  const h = React.createElement, renders = {rows:0}
  // count row renders: the rows are the editor's only React.memo views.
  const counting = {...React, memo:view => React.memo(props => { renders.rows++; return view(props) })}
  const context = {React:counting, ReactDOM, document:dom.window.document, window:dom.window, setTimeout, clearTimeout, requestAnimationFrame:fn => setTimeout(fn, 0),
    cancelAnimationFrame:clearTimeout, console, URL, Blob, Promise, Object, Array, Set, Map, WeakMap, Math, JSON, String, Number, Error, SyntaxError}
  vm.runInNewContext(inlineField, context)
  const Button = ({children, primary, ...props}) => h('button', {type:'button', className:primary ? 'ap-primary' : '', ...props}, children)
  Object.assign(context, {h, Button, VOICE_LANGUAGES:[['ja', '日语'], ['zh', '中文'], ['en', '英语']], errorText:e => String(e?.code || e?.message || e),
    Glyph:({name}) => h('i', {'data-glyph':name}),
    IconButton:({icon, label, danger, ...props}) => h(Button, {className:'ap-icon-button' + (danger ? ' is-danger' : ''), 'aria-label':label, title:label, ...props}, h('i', {'data-glyph':icon})),
    MenuItem:({onClick, disabled, title, danger, children}) => h('button', {type:'button', role:'menuitem', className:'ap-menu-item' + (danger ? ' is-danger' : ''), disabled, title, onClick}, children),
    Popover({label, trigger, className, content}) {
      const [open, setOpen] = React.useState(false), close = () => setOpen(false)
      return h('div', {className:'ap-popover-anchor ' + (className || '')}, trigger({open, toggle:() => setOpen(!open)}), open && h('div', {className:'ap-popover', role:'menu', 'aria-label':label}, content(close)))
    },
    PackSearchBox:({value, onChange, label, placeholder, className = ''}) => h('label', {className:'ap-search ' + className}, h('input', {type:'search', 'aria-label':label, placeholder, value, onChange:e => onChange(e.target.value)})),
    ErrorBox:({error}) => h('div', {role:'alert'}, error), Loading:() => h('p', {className:'ap-loading'}, '载入中'),
    StageSection:({title, meta, action, children}) => h('section', {className:'ap-section'}, h('header', null, h('h3', null, title, meta !== undefined && h('span', {className:'ap-section-meta'}, meta)), action), h('div', {className:'ap-section-body'}, children)),
    ConfirmDialog({title, body, confirmLabel, onConfirm, onClose}) {
      return h('div', {role:'dialog', 'aria-label':title}, h('p', null, body), h('button', {type:'button', onClick:onClose}, '取消'),
        h('button', {type:'button', className:'ap-confirm-run', onClick:async () => { await onConfirm(); onClose() }}, confirmLabel))
    }})
  const ReadingsEditor = vm.runInNewContext(editorSource + ';ReadingsEditor', context)
  const root = createRoot(container)
  t.after(async () => { await act(() => root.unmount()); container.remove() })
  const started = performance.now()
  await act(async () => root.render(h(ReadingsEditor, {call})))
  await act(async () => { for (let i = 0; i < 50 && !container.querySelector('.fork-readings-bar'); i++) await new Promise(resolve => setTimeout(resolve, 5)) })
  const openMs = performance.now() - started
  const $ = selector => dom.window.document.querySelector(selector), $$ = selector => [...container.querySelectorAll(selector)]
  const type = async (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', {bubbles:true})) })
  }
  const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 1)) })
  return {dom, store, calls, renders, openMs, $, $$, type, settle, click:node => act(async () => node.click())}
}
const fixtureEntries = n => Array.from({length:n}, (_, i) => ({forms:['词' + i, 'Word' + i], reading:'よみ' + i, languageOverride:'ja'}))

test('a row edit commits on its visible ✓ and on blur; ✕ deletes with an undo', async t => {
  const f = await mount(t, {entries:fixtureEntries(3)})
  const row = () => f.$$('.ap-readings-row')[1]
  const reading = row().querySelector('input[aria-label^="读音"]')
  await act(async () => reading.focus())
  await f.type(reading, 'かえた')
  const confirm = row().querySelector('.ap-reading-confirm')
  assert.ok(confirm, 'the row has a visible confirm')
  await f.click(confirm)
  await f.settle()
  assert.equal((await f.store.activeEntries())[1].reading, 'かえた')
  const forms = row().querySelector('input[aria-label^="写法"]')
  await act(async () => forms.focus())
  await f.type(forms, 'A，B')
  await act(async () => forms.blur())
  await f.settle()
  assert.deepEqual((await f.store.activeEntries())[1].forms, ['A', 'B'])
  await f.click(row().querySelector('.ap-reading-remove'))
  await f.settle()
  assert.equal((await f.store.activeEntries()).length, 2)
  const undo = f.$('.ap-reading-note button')
  assert.equal(undo.textContent, '撤销')
  await f.click(undo)
  await f.settle()
  const back = await f.store.activeEntries()
  assert.equal(back.length, 3)
  assert.deepEqual(back.at(-1).forms, ['A', 'B'])
  assert.equal(f.$('.ap-reading-note'), null)
})

test('合并同读音 shows the count first and merges only after the confirm', async t => {
  const f = await mount(t, {entries:[{forms:'Alice', reading:'ありす'}, {forms:'星空', reading:'ほしぞら'}, {forms:'アリス', reading:'ありす'}, {forms:'艾莉丝', reading:'ありす'}]})
  await f.click(f.$('.fork-readings-more button'))
  await f.click(f.$$('[role=menuitem]').find(item => item.textContent.startsWith('合并同读音')))
  await f.settle()
  const dialog = f.$('[role=dialog]')
  assert.match(dialog.textContent, /1 组/)
  assert.match(dialog.textContent, /4 → 2/)
  assert.equal((await f.store.activeEntries()).length, 4)
  await f.click(dialog.querySelector('.ap-confirm-run'))
  await f.settle()
  const merged = await f.store.activeEntries()
  assert.deepEqual(merged.map(e => e.forms), [['Alice', 'アリス', '艾莉丝'], ['星空']])
  assert.equal(f.$('.ap-section-meta').textContent, '2')
})
