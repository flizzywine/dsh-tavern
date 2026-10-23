import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/stage-settings.js', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../tavern-plugin/src/client/features/stage-runtime.js', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
const expand = node => typeof node?.type === 'function' ? expand(node.type({ ...node.props })) : node && typeof node === 'object' ? { ...node, children: (node.children || []).map(expand) } : node
const find = (node, test) => !node || typeof node !== 'object' ? null : test(node) ? node : (node.children || []).reduce((found, child) => found || find(child, test), null)
const all = (node, test, out = []) => { if (node && typeof node === 'object') { if (test(node)) out.push(node); (node.children || []).forEach(child => all(child, test, out)) } return out }
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? (node.children || []).map(text).join('') : ''

// useState hands out the given states in call order, so a test can render a page as it looks after loading.
function load({ states = [], ...context } = {}) {
  const queue = [...states]
  const React = { createElement: h, Fragment: 'Fragment', useState: init => [queue.length ? queue.shift() : init, () => {}], useRef: () => ({ current: null }), useEffect() {},
    useSyncExternalStore: (subscribe, get) => get() }
  return vm.runInNewContext(source + '; ({ TAVERN_STAGE_TABS, tavernStageReturn, registerTavernStagePanels, TavernStageSwitches, TavernStageSettingsTab, TavernStageMaterialsTab, TavernVoiceTab })', {
    React, DshUi: {}, Date, Set, window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail } },
    useTavernSpeechSettings: () => ({ enabled: false }), useTavernStageView: () => ({ views: [] }), TavernStageViewSwitch: 'ViewSwitch', TavernSpeechSettings: 'SpeechSettings',
    rpc: async () => ({}), tavernSpeechSettings: { set() {} }, tavernStageRuntime: { refresh: async () => {} }, ...context
  })
}
const rowsOf = tree => all(tree, node => /dsh-tavern-switch-row/.test(node.props.className || '')).map(row => ({ row, label: text(find(row, node => node.props.className === 'dsh-tavern-switch-name')), input: find(row, node => node.type === 'input') }))

test('three stage panels are registered like the reference design: 舞台设置, 舞台素材 and 配音', () => {
  const tabs = []
  const { registerTavernStagePanels } = load({ openTavernSidebarTab: () => {} })
  registerTavernStagePanels({ effect: fn => fn(), betterSidebar: { registerTab: tab => { tabs.push(tab); return () => {} } }, sessions: {} })
  assert.deepEqual(tabs.map(tab => [tab.id, tab.title, tab.order, tab.single]), [
    ['dsh-tavern:stage-settings', '舞台设置', 9, true], ['dsh-tavern:stage-materials', '舞台素材', 9.5, true], ['dsh-tavern:voice', '配音', 10, true]])
  // Neither id is claimed by a start-page group, so they are listed under 「其他」; the chip calls icon(size), the start page renders it.
  assert.equal(tabs[0].icon(20).props.width, 20)
  assert.equal(tabs[2].icon({ size: 24 }).props.width, 24)
})

test('基础设置 lists 对话气泡, 配音 › and 舞台模式 in order and each switch writes its own owner', async () => {
  const calls = [], events = [], opened = []
  const { TavernStageSwitches, tavernStageReturn } = load({
    states: [{ castPresentation: true }, 'idle', ''],
    useTavernSpeechSettings: () => ({ enabled: true }),
    rpc: async (method, args) => { calls.push([method, args]); return method === 'updateTavernSettings' ? { settings: { castPresentation: args.patch.castPresentation } } : { enabled: args.enabled } },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event.type) },
    tavernSpeechSettings: { set: value => calls.push(['speech-store', value]) },
    tavernStageRuntime: { refresh: async id => calls.push(['refresh', id]) }
  })
  const tree = expand(TavernStageSwitches({ sessionId: 'game', path: 'cards/a.json', data: { enabled: false }, openTab: id => opened.push(id) }))
  assert.equal(text(find(tree, node => node.type === 'h3')), '基础设置')
  const rows = rowsOf(tree)
  assert.deepEqual(rows.map(row => [row.label, row.input.props.checked, row.input.props.disabled]), [['对话气泡', true, false], ['配音', true, false], ['舞台模式', false, false]])
  assert.deepEqual(rows.map(row => row.input.props.role), ['switch', 'switch', 'switch'])
  await rows[0].input.props.onChange({ target: { checked: false } })
  await rows[1].input.props.onChange({ target: { checked: false } })
  await rows[2].input.props.onChange({ target: { checked: true } })
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['updateTavernSettings', { patch: { castPresentation: false } }],
    ['updateSpeechSettings', { enabled: false }], ['speech-store', { enabled: false }],
    ['setCardStage', { path: 'cards/a.json', enabled: true }], ['refresh', 'game']])
  assert.deepEqual(events, ['dsh-tavern-settings-changed', 'dsh-tavern-settings-changed', 'dsh-tavern-card-stage-changed'])
  // 配音 › opens the 配音 panel and leaves the way back to 舞台设置.
  find(rows[1].row, node => node.props['aria-label'] === '声音设置').props.onClick()
  assert.deepEqual(opened, ['dsh-tavern:voice'])
  assert.equal(tavernStageReturn.get().toTab, 'dsh-tavern:stage-settings')
  assert.equal(rows[1].row.props.className, 'dsh-tavern-switch-row is-openable')
})

test('配音 is greyed while nothing marks speakers, and 舞台样式 appears only with a plugin stage view', () => {
  const { TavernStageSwitches } = load({ states: [{ castPresentation: false }, 'idle', ''], useTavernStageView: () => ({ views: [{ key: 'p' }] }) })
  const tree = expand(TavernStageSwitches({ sessionId: 'game', path: 'cards/a.json', data: { enabled: false } }))
  const rows = rowsOf(tree)
  assert.deepEqual(rows.map(row => row.label), ['对话气泡', '配音?', '舞台模式', '舞台样式'])
  assert.equal(rows[1].input.props.disabled, true)
  assert.match(find(rows[1].row, node => node.props.className === 'dsh-tavern-switch-help').props.title, /需要对话气泡/)
  assert.ok(find(rows[3].row, node => node.type === 'ViewSwitch'))
  const none = rowsOf(expand(load({ states: [{ castPresentation: true }, 'idle', ''] }).TavernStageSwitches({ sessionId: 'game', path: '', data: { enabled: true } })))
  assert.deepEqual(none.map(row => row.label), ['对话气泡', '配音', '舞台模式'])
  assert.equal(none[2].input.props.disabled, true, 'no card path, no stage write')
})

test('舞台设置 and 舞台素材 follow the game; outside a game they point to the card library', () => {
  const page = mode => ({ useTavernSessionMode: () => mode, isPlayMode: value => value === 'story', useTavernStageRuntime: () => ({ data: { enabled: false, cast: [] } }),
    useScopedLiveTavernView: () => ({ view: { card: { path: 'cards/a.json' } } }), TavernCastManager: 'Cast' })
  const sessions = { subagentAddress: () => ({ parentSessionId: 'game' }) }
  const settings = load(page('story')).TavernStageSettingsTab({ sessionId: 'sub', sessions })
  assert.equal(settings.props['aria-label'], '舞台设置')
  const switches = find(settings, node => typeof node.type === 'function' && node.type.name === 'TavernStageSwitches')
  assert.deepEqual([switches.props.sessionId, switches.props.path], ['game', 'cards/a.json'])
  const materials = load(page('story')).TavernStageMaterialsTab({ sessionId: 'game', sessions })
  assert.equal(materials.props['aria-label'], '舞台素材')
  assert.equal(find(materials, node => node.type === 'Cast').props.sessionId, 'game', 'cast material is editable while the stage is off')
  const opened = []
  const empty = load(page('chat')).TavernStageMaterialsTab({ sessionId: 'game', sessions, openTab: id => opened.push(id) })
  assert.equal(find(empty, node => node.type === 'Cast'), null)
  assert.ok(find(empty, node => text(node) === '未打开人物卡'))
  find(empty, node => node.type === 'button').props.onClick()
  assert.deepEqual(opened, ['dsh-tavern:cards'])
})

test('配音 is the voicing service page, with ‹ back to 舞台设置 when it was opened from there', () => {
  const opened = []
  const { TavernVoiceTab, tavernStageReturn } = load()
  let tab = TavernVoiceTab({ openTab: id => opened.push(id) })
  assert.equal(tab.props['aria-label'], '配音')
  assert.ok(find(tab, node => node.type === 'SpeechSettings'))
  assert.equal(find(tab, node => node.type === 'button'), null)
  tavernStageReturn.set({ toTab: 'dsh-tavern:stage-settings', label: '返回舞台设置' })
  tab = TavernVoiceTab({ openTab: id => opened.push(id) })
  find(tab, node => node.props['aria-label'] === '返回舞台设置').props.onClick()
  assert.deepEqual(opened, ['dsh-tavern:stage-settings'])
  assert.equal(tavernStageReturn.get(), null, 'the way back is used once')
})

test('酒馆状态 keeps only the stage entry; the fullscreen stage has no 设置 or 朗读 of its own', () => {
  const start = runtime.indexOf('function TavernStageStatus(')
  const status = vm.runInNewContext(runtime.slice(start) + '; TavernStageStatus', { React: { createElement: h }, useTavernStageRuntime: () => ({ data: { enabled: true } }), TavernStageEntry: 'Entry' })
  const tree = status({ sessionId: 'game' })
  assert.ok(find(tree, node => node.type === 'Entry'))
  assert.deepEqual(all(tree, node => node.type === 'button' || node.type === 'details'), [])
  assert.equal(vm.runInNewContext(runtime.slice(start) + '; TavernStageStatus', { React: { createElement: h }, useTavernStageRuntime: () => ({ data: { enabled: false } }), TavernStageEntry: 'Entry' })({ sessionId: 'game' }), null)
  const screen = runtime.slice(runtime.indexOf('function TavernStageScreen('), runtime.indexOf('function TavernStageEntry('))
  assert.doesNotMatch(screen, /"朗读"|"设置"|localStorage/)
  assert.match(screen, /TavernMusicToggle/, 'the ♪ quick mute stays on the control bar')
})
