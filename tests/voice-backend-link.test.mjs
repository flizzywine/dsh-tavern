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
  assert.match(figure, /h\(VoiceTab,\{[^}]*commitVoice,nav\}/)
  assert.match(voice, /const openSettings=nav\?\.openTab\?/)
  // 「语音后端 ›」 sits at the foot of the service column of 新建声音 / 编辑声音.
  assert.match(voice, /openSettings&&h\(Button,\{className:'ap-link ap-vx-nav-foot',onClick:\(\)=>openSettings\(null\)\},'语音后端 ›'\)/)
})

// 新建声音 / 编辑声音: a service that cannot speak now carries ⚠ and why, in 语音后端's words; one not checked yet is fine.
test('a service that cannot speak says why in 语音后端 words; a service not checked yet is fine', async () => {
  const source = await client('asset-pack-voice-ui.js')
  const state = vm.runInNewContext(source.slice(source.indexOf('const SERVICE_STATE_WORDS='), source.indexOf('// Azure voice names')) + ';voiceServiceState', {window:{speechSynthesis:{}}})
  assert.deepEqual({...state({kind:'fish-audio', state:'needs-key'})}, {warn:true, setup:true, text:'缺少 API Key'})
  assert.equal(state({kind:'azure', state:'configured'}), null)
  assert.equal(state({kind:'browser'}), null)
})
