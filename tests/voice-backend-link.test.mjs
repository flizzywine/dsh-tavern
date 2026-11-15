import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'

const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

// 素材库 › 人物 › 声音: the library's pack modal has no card context (ctx:null), so 「语音后端 ›」 opens the 配音 tab
// through the library's own nav, not the card's.
test('the 素材库 tab hands its pages a nav that opens the 配音 tab', async () => {
  const source = await client('asset-launcher.js'), opened = []
  const h = (type, props, ...children) => ({type, props:props || {}, children:children.flat()})
  const packUi = {App:'App', StagePanel:'StagePanel', stageScope:{use:() => true}}
  const context = {React:{createElement:h, useMemo:fn => fn(), useEffect() {}, useSyncExternalStore:(subscribe, get) => get()},
    BubbleLibraryPicker() {}, PackImage() {}, BUBBLE_MOODS:[], CUSTOM_MOOD_MAX:8, emotionUpsert() {}, customMoodColors:() => [],
    createAssetPackUI:() => packUi, useBubbles:() => ({cardPath:'cards/a.png'}), rpc() {}, createAssetPackBinding:() => ({}),
    createPackTransport:() => ({start() {}, dispose() {}, service:{subscribe:() => () => {}}})}
  vm.runInNewContext('let forkTtsScope;' + source + ';this.library=AssetLibraryTab;this.workbench=PackWorkbench;', context)
  context.installTavernAssetLaunchers({betterSidebar:{openTab:(tab, scope) => opened.push([tab, scope])}, inject() {}, provide() {}, effect() {}})
  const tab = context.library({scope:{sessionId:'s'}}), app = context.workbench(tab.props).children[0]
  assert.equal(app.type, 'App')
  assert.equal(typeof app.props.nav.take, 'function')
  await app.props.nav.openTab('dsh-tts:voice')
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [[{type:'dsh-tts:voice'}, {sessionId:'s'}]])
})

test('the library passes its nav from App through the pack modal and figure page to the voice page', async () => {
  const [ui, figure, voice] = await Promise.all([client('asset-pack-ui.js'), client('asset-pack-figure-ui.js'), client('asset-pack-voice-ui.js')])
  assert.match(ui, /h\(Home,\{[^}]*nav:props\.nav\}/)
  assert.match(ui, /h\(PackModal,\{[^}]*ctx:null,nav,/)
  // 舞台设置 opens the same modal with its card context, whose nav it uses.
  assert.match(ui, /function PackModal\(\{[^}]*ctx,nav=ctx\?\.nav,/)
  // the window's tab nav closes the window before the tab opens (voice-backend-focus.test.mjs).
  assert.match(ui, /const tabNav=nav\?\.openTab\?\{\.\.\.nav,openTab:type=>\{close\(\);return nav\.openTab\(type\);\}\}:nav;/)
  assert.match(ui, /h\(FigureDetail,\{[^}]*figureActions:figureActions\(selected\.id\),nav:tabNav,/)
  assert.match(figure, /h\(VoiceTab,\{[^}]*commitVoice,nav\}\)/)
  assert.match(voice, /const openSettings=nav\?\.openTab\?/)
  // 「语音后端」 is the gear at the right end of 选声音's tab strip.
  assert.match(voice, /openSettings&&h\('span',\{className:'ap-kind-new-anchor ap-voice-backend'\},h\(IconButton,\{icon:'sliders',label:'语音后端',onClick:\(\)=>openSettings\(null\)\}\)\)/)
})

// A service that cannot speak now (no key, offline): its tab says why and offers 去设置 in the list's place — no list.
test('a service tab that cannot speak shows only why and the way to 语音后端', async t => {
  const source = await client('asset-pack-voice-ui.js')
  const dom = new JSDOM('<div id="root"></div>')
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true})
  let root
  t.after(async () => {
    if (root) await act(() => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  const cut = (from, to) => source.slice(source.indexOf(from), source.indexOf(to))
  const context = {h:React.createElement, React, Glyph:({name}) => React.createElement('i', {'data-glyph':name}), Button:({className, onClick, children}) => React.createElement('button', {className, onClick}, children),
    VoiceProviderVoices:() => React.createElement('ul', {className:'list'})}
  const VoiceServiceTab = vm.runInNewContext(cut('function VoiceWarn(', 'function VoiceLoading(') + cut('function VoiceServiceTab(', '// Fish 声音库:') + ';VoiceServiceTab', context)
  const opened = []
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(React.createElement(VoiceServiceTab, {row:{id:'service:q', kind:'qwen', provider:'qwen', serviceId:'q', ways:[]}, state:{warn:true, setup:true, text:'缺少 API Key'},
    openSettings:(...args) => opened.push(args)})))
  assert.equal(document.querySelector('.list'), null)
  assert.match(document.querySelector('.ap-voice-warn').textContent, /缺少 API Key/)
  await act(() => document.querySelector('.ap-voice-warn button').click())
  assert.deepEqual(opened, [['qwen', undefined]])
  await act(() => root.render(React.createElement(VoiceServiceTab, {row:{id:'service:q', kind:'qwen', provider:'qwen', serviceId:'q', ways:[]}, state:{text:'可用'}, openSettings() {}})))
  assert.ok(document.querySelector('.list'))
})