// 语音后端 › 语音识别 (src/client/speech-recognition-ui.js), drawn with the dsh-tavern-tts page's parts: services by
// address with their reported models, 定稿用 from the others, saved fields saved as they are left, add and delete.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/src/client/speech-recognition-ui.js', import.meta.url), 'utf8')
const h = React.createElement
// The page's parts, reduced to what they render (the real ones: dsh-tavern-tts client.js).
const parts = {
  Section: ({title, meta, children}) => h('section', {'data-title': title}, h('h3', null, title, meta !== undefined ? ' ' + meta : ''), children),
  Field: ({label, children}) => h('div', {'data-field': label}, children),
  Line: ({title, open, onOpen, warn, children}) => h('div', {className: 'line'}, onOpen ? h('button', {'aria-expanded': !!open, onClick: onOpen}, title) : h('span', null, title), warn, children),
  Confirm: ({text, onYes, onNo}) => h('div', {role: 'alertdialog'}, text, h('button', {onClick: onNo}, '取消'), h('button', {onClick: onYes}, '确认删除')),
  Button: ({primary, link, ...props}) => h('button', props),
  Menu: ({label, items}) => h('span', null, items.map(item => h('button', {key: item.label, 'aria-label': label + ' ' + item.label, onClick: item.onSelect}, item.label))),
  AddRow: ({label, onClick}) => h('button', {'aria-label': label, onClick}, '＋'),
  StateWord: ([, text]) => h('span', {className: 'state'}, text),
  Status: ({children}) => children ? h('p', {role: 'status'}, children) : null,
}
// Tavern's InlineField: a text box committing on blur, or a menu of options.
function InlineField({kind, label, value, options, onCommit}) {
  if (kind === 'menu') return h('select', {'aria-label': label, value, onChange: e => onCommit(e.target.value)}, options.map(o => h('option', {key: o.value, value: o.value}, o.label)))
  return h('input', {'aria-label': label, defaultValue: value, onBlur: e => onCommit(e.target.value)})
}

function backend() {
  let revision = 1, services = [{id: 'sensevoice', label: 'SenseVoice', kind: 'openai-compatible', url: 'http://127.0.0.1:9887/v1', model: 'sensevoice', language: 'zh', key: {configured: true}}]
  const calls = []
  const view = () => ({revision, services: structuredClone(services), external: [], kinds: [{kind: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', keyRequired: true}, {kind: 'openai-compatible', label: 'OpenAI 兼容', url: '', model: '', keyRequired: false}]})
  const rpc = async (method, args) => {
    calls.push({method, args: structuredClone(args)})
    if (method === 'getSpeechRecognitionConfig') return view()
    if (method === 'listSpeechRecognitionServices') return {services: services.map(row => ({id: row.id, label: row.label, available: row.id !== 'broken'}))}
    if (method === 'describeSpeechRecognitionService') return {available: true, models: args.service.url?.includes('9888') ? [{id: 'firered'}] : [{id: 'sensevoice'}, {id: 'paraformer'}], languages: null, turnDetection: false}
    assert.equal(args.expectedRevision, revision)
    if (method === 'saveSpeechRecognitionService') { const at = services.findIndex(row => row.id === args.service.id); const row = {...args.service, key: {configured: !!args.key || !!services[at]?.key.configured}}; if (at < 0) services.push(row); else services[at] = row; revision++; return view() }
    if (method === 'deleteSpeechRecognitionService') { services = services.filter(row => row.id !== args.id).map(({final, ...row}) => final === args.id ? row : {...row, ...(final ? {final} : {})}); revision++; return view() }
    assert.fail('unexpected ' + method)
  }
  return {rpc, calls, services: () => services}
}

test('语音识别: a service by its address, its reported models, 定稿用 from the others, add / save / delete', async () => {
  const dom = new JSDOM('<div id="root"></div>'), previous = {window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis, {window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true})
  const server = backend(), scope = {React, rpc: server.rpc, InlineField}
  vm.runInNewContext(source + '\nthis.RecognitionSection = RecognitionSection', scope)
  const root = createRoot(document.getElementById('root')), q = selector => document.querySelector(selector)
  const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) })
  const blur = async (label, value) => { const input = q(`[aria-label="${label}"]`); input.value = value; await act(async () => input.dispatchEvent(new dom.window.FocusEvent('focusout', {bubbles: true}))); await settle() }
  const pick = async (label, value) => { const select = q(`[aria-label="${label}"]`); select.value = value; await act(async () => select.dispatchEvent(new dom.window.Event('change', {bubbles: true}))); await settle() }
  try {
    await act(async () => root.render(h(scope.RecognitionSection, parts))); await settle()
    assert.match(q('section[data-title="语音识别"] h3').textContent, /语音识别 1/)
    assert.match(document.body.textContent, /SenseVoice可用/)
    // Add FireRed by its address: its model comes from what the server reports.
    await act(async () => q('[aria-label="添加识别服务"]').click())
    await blur('名称', 'FireRed'); await blur('接口地址', 'http://127.0.0.1:9888/v1')
    assert.equal(q('[aria-label="模型"]').value, 'firered')
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === '添加').click()); await settle()
    assert.deepEqual(server.services().map(row => [row.id, row.model, row.url]), [['sensevoice', 'sensevoice', 'http://127.0.0.1:9887/v1'], ['firered', 'firered', 'http://127.0.0.1:9888/v1']])
    assert.match(q('[role=status]').textContent, /已添加「FireRed」/)
    // A saved service saves each field as it is left: SenseVoice's 定稿用 is FireRed.
    await act(async () => [...document.querySelectorAll('button[aria-expanded]')].find(b => b.textContent === 'SenseVoice').click()); await settle()
    assert.deepEqual([...q('[aria-label="定稿用"]').options].map(o => o.textContent), ['不用', 'FireRed'])
    assert.deepEqual([...q('[aria-label="模型"]').options].map(o => o.value), ['sensevoice', 'paraformer'])
    await pick('定稿用', 'firered')
    assert.equal(server.services()[0].final, 'firered')
    assert.equal(server.calls.filter(c => c.method === 'saveSpeechRecognitionService').at(-1).args.key, undefined, 'the key is left alone')
    // Deleting FireRed takes its 定稿用 use with it.
    await act(async () => q('[aria-label="FireRed 更多操作 删除…"]').click())
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === '确认删除').click()); await settle()
    assert.deepEqual(server.services().map(row => [row.id, row.final]), [['sensevoice', undefined]])
    assert.doesNotMatch(document.body.textContent, /FireRed可用/)
  } finally { await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, previous) }
})
