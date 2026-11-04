import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'

const client = name => readFile(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')

// 素材库 › 人物 › 声音: the library's pack modal has no card context (ctx:null), so 「配音后端 ›」 opens the 配音 tab
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
  assert.match(ui, /h\(FigureDetail,\{[^}]*figureActions:figureActions\(selected\.id\),nav,/)
  assert.match(figure, /h\(VoicePage,\{[^}]*nav,onClose:closeVoice\}/)
  assert.match(voice, /const openSettings=nav\?\.openTab\?/)
  assert.match(voice, /action:openSettings&&h\(Button,\{className:'ap-link ap-voice-backend',onClick:\(\)=>openSettings\(null\)\},'配音后端 ›'\)/)
})

// A source naming a service not set up in 配音后端 is one row: 「<服务名> · 未设置」 and the way there, no list to browse.
test('an unconfigured source row has no body, only its state and the link to 配音后端', async t => {
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
  const context = {h:React.createElement, Glyph:({name}) => React.createElement('i', {'data-glyph':name})}
  const VoiceWay = vm.runInNewContext(source.slice(source.indexOf('function VoiceWay('), source.indexOf('// A chosen-from-a-list row')) + ';VoiceWay', context)
  let opened = 0
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(React.createElement(VoiceWay, {way:{id:'library', title:'Fish Audio · 声音库'}, current:true,
    state:{warn:true, text:'Fish Audio · 未设置'}, action:React.createElement('button', {onClick:() => opened++}, '去配音后端设置 ›')})))
  const row = document.querySelector('.ap-voice-way')
  assert.equal(row.querySelector('.ap-voice-way-body'), null)
  assert.equal(row.querySelector('[aria-expanded]'), null)
  assert.equal(row.querySelector('.ap-voice-way-sum.is-warn').textContent, 'Fish Audio · 未设置')
  await act(() => row.querySelector('.ap-voice-way-action button').click())
  assert.equal(opened, 1)
})
