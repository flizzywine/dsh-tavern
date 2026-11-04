import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')

// 素材库 › 人物 › 声音 「配音后端 ›」: the pack window closes and the 配音后端 tab (the real dsh-tts page) opens in front
// with the keyboard focus on it — whether the tab mounts now or was already mounted.
async function harness(t, {mounted}) {
  const [voice, ui, tts] = await Promise.all([read('src/client/asset-pack-voice-ui.js'), read('src/client/asset-pack-ui.js'), read('packages/dsh-tavern-tts/src/client.js')])
  const dom = new JSDOM('<div id="root"></div>', {url:'http://tavern.invalid/'})
  const keys = ['window', 'document', 'sessionStorage', 'fetch', 'EventSource', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const answers = {services:{configured:[], running:[]}, providerKinds:[{kind:'fish-audio', label:'Fish Audio', fields:[]}],
    reading:{dialogueVoice:null, narrator:{enabled:false, voice:null}}, voicePresets:[], cache:{bytes:0, count:0, maxBytes:1024 ** 3, maxAgeDays:30}}
  const fetch = async (url, options = {}) => Response.json(answers[JSON.parse(options.body || '{}').method] ?? {})
  for (const key of keys) delete globalThis[key]
  Object.assign(globalThis, {window:dom.window, document:dom.window.document, sessionStorage:dom.window.sessionStorage, fetch,
    EventSource:class { close() {} }, IS_REACT_ACT_ENVIRONMENT:true})
  let root
  const disposers = []
  t.after(async () => {
    if (root) await act(() => root.unmount())
    for (const dispose of disposers) dispose?.()
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  // the dsh-tts client registers its sidebar tab (the real 配音后端 page).
  const tabs = new Map(), services = new Map([['betterSidebar', {registerTab:tab => { tabs.set(tab.id, tab); return () => tabs.delete(tab.id) }}]])
  const ctx = {get:key => services.get(key), provide() { return () => {} }, effect:fn => { disposers.push(fn()) }, inject(names, fn) { if (names.every(n => services.has(n))) fn(ctx) },
    slots:{inject() {}, register() { return () => {} }}}
  const exports = {}
  new Function('require', 'exports', tts)(name => ({react:React})[name], exports)
  exports.apply(ctx)
  // the voice page's link and the pack window's nav (PackModal tabNav), as written.
  const line = (source, name) => source.match(new RegExp('^\\s*const ' + name + '=.*$', 'm'))[0]
  const openVoiceSettings = vm.runInNewContext([line(voice, 'VOICE_FOCUS_KEY'),
    voice.slice(voice.indexOf('function openVoiceSettings('), voice.indexOf('// re-read a useVoiceLoad')), 'openVoiceSettings'].join('\n'),
  {sessionStorage:dom.window.sessionStorage, window:dom.window, Promise})
  const tabNav = (nav, close) => vm.runInNewContext(line(ui, 'tabNav') + ';tabNav', {nav, close})
  let opened = []
  function Host() {
    const [open, setOpen] = React.useState(true), [tab, setTab] = React.useState(mounted ? 'dsh-tts:voice' : 'dsh-asset-library:library')
    const nav = tabNav({openTab:type => { opened.push(type); setTab(type); return Promise.resolve(true) }}, () => setOpen(false))
    const Backend = tabs.get('dsh-tts:voice').component
    return React.createElement(React.Fragment, null,
      React.createElement('aside', {className:'sidebar'}, tab === 'dsh-tts:voice' ? React.createElement(Backend) : React.createElement('button', {className:'library-row'}, '素材包')),
      open && React.createElement('section', {role:'dialog', className:'ap-pack-modal'},
        React.createElement('button', {className:'ap-link ap-voice-backend', onClick:() => openVoiceSettings(nav, null)}, '配音后端 ›')))
  }
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(React.createElement(Host)))
  await act(() => new Promise(resolve => setTimeout(resolve, 20)))
  return {dom, opened: () => opened}
}
const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 120)))

for (const mounted of [false, true]) test('「配音后端 ›」 closes the pack window and focuses the 配音后端 tab' + (mounted ? ' (already mounted)' : ''), async t => {
  const {opened} = await harness(t, {mounted})
  const link = document.querySelector('.ap-voice-backend')
  link.focus()
  await act(() => link.click())
  await settle()
  assert.equal(document.querySelector('[role=dialog]'), null)
  assert.deepEqual(opened(), ['dsh-tts:voice'])
  const page = document.querySelector('.sidebar .dtts')
  assert.ok(page)
  assert.ok(page.contains(document.activeElement), 'focus is in 配音后端: ' + document.activeElement?.outerHTML)
  assert.ok(document.activeElement.matches('.dtts-line-main'))
})
