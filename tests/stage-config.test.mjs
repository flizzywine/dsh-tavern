// The stage's CONFIG: the audio layers' state and buses (features/stage-audio.js), the mixer rows and the 「声音」 entry
// (features/stage-mixer.js), the CONFIG screen (features/stage-config.js) and the reading pace (modules/stage-runtime.js), on a
// fake audio context, a fake storage and a plain createElement: no device, no sound.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const client = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
const expand = node => typeof node?.type === 'function' ? expand(node.type({ ...node.props })) : node && typeof node === 'object' ? { ...node, children: (node.children || []).map(expand) } : node
const all = (node, test, out = []) => { if (node && typeof node === 'object') { if (test(node)) out.push(node); (node.children || []).forEach(child => all(child, test, out)) } return out }
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? (node.children || []).map(text).join('') : ''

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => { values.set(key, String(value)) } }
}
function audioContext() {
  const context = {
    state: 'running', currentTime: 0, destination: { name: 'destination' },
    createGain() { return { gain: { value: 1, target: null, setTargetAtTime(value) { this.target = value } }, connect(next) { this.next = next } } }
  }
  return context
}
// The audio state, the mixer and CONFIG as the page has them; speech records what it is tuned to.
function load(storage = memoryStorage()) {
  const tuned = [], context = audioContext()
  const window = { AudioContext: function () { return context } }
  const sandbox = { localStorage: storage, window, tavernSpeech: { tune: value => tuned.push({ ...value }), watch: () => () => {} },
    React: { createElement: h, Fragment: 'Fragment', useState: value => [typeof value === 'function' ? value() : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value === undefined ? null : value }), useMemo: fn => fn() },
    TavernStageGlyph: props => h('glyph', { name: props.name }) }
  const api = vm.runInNewContext([client('modules/stage-runtime.js'), client('modules/stage-typewriter.js'), client('stage-audio-math.js'), client('features/stage-audio.js'), client('features/stage-mixer.js'), client('features/stage-config.js'), client('features/stage-typewriter.js'),
    '({ tavernStageAudio, stageMixLevel, stageMixIcon, TavernStageMixerRows, TavernStageSoundEntry, TavernStageConfigScreen, stageReadingPrefs, stageAutoDelay, STAGE_READING_DEFAULTS })'].join('\n;'), sandbox)
  return { ...api, storage, tuned, context, sandbox }
}

test('every layer starts at its old level; volume and mute are kept apart and read back from this browser', () => {
  const page = load(), audio = page.tavernStageAudio
  assert.deepEqual(JSON.parse(JSON.stringify(audio.get())), { v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {} })
  assert.deepEqual(page.tuned.at(-1), { level: 1 }, 'voices start at full volume')
  audio.setVolume('voice', .6); audio.setVolume('master', .5)
  assert.deepEqual(page.tuned.at(-1), { level: .3 }, 'a voice plays at 配音 × 总音量, at once')
  audio.toggleMute('voice')
  assert.deepEqual([audio.get().voice, audio.get().muted.voice, page.tuned.at(-1).level], [.6, true, 0], 'a mute keeps the level')
  audio.toggleMute('voice')
  assert.equal(page.tuned.at(-1).level, .3, 'unmuting restores it')
  audio.toggleMute('music'); audio.setVolume('music', .4)
  assert.equal(audio.get().muted.music, undefined, 'moving a muted slider unmutes it')
  const again = load(page.storage).tavernStageAudio.get()
  assert.deepEqual([again.voice, again.master, again.music], [.6, .5, .4], 'a reload reads the saved levels')
  const odd = load(memoryStorage({ 'dsh-tavern-stage-audio': JSON.stringify({ voice: 7, sfx: 'loud', ambience: .3, muted: { music: true, extra: true } }) })).tavernStageAudio.get()
  assert.deepEqual(JSON.parse(JSON.stringify(odd)), { v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: .3, muted: { music: true } })
  assert.equal(load(memoryStorage({ 'dsh-tavern-stage-audio': '{' })).tavernStageAudio.get().master, 1, 'an unreadable record is the defaults')
})

test('BGM, 音效 and 环境音 end in their layer bus and its dip, then 总音量; a change glides on what is already sounding', () => {
  const page = load(), audio = page.tavernStageAudio, ctx = audio.context()
  const music = audio.output(ctx, 'music'), sfx = audio.output(ctx, 'sfx'), ambience = audio.output(ctx, 'ambience')
  assert.ok(music !== sfx && sfx !== ambience)
  assert.ok(music.next.next === sfx.next.next && sfx.next.next === ambience.next.next, 'one 总音量 after every layer (and its 避让 dip)')
  assert.equal(music.next.next.next, ctx.destination)
  audio.setVolume('sfx', .25); audio.toggleMute('master')
  assert.deepEqual([sfx.gain.target, music.next.next.gain.target], [.25, 0])
  assert.equal(audio.output({ destination: 'other' }, 'music'), 'other', 'another context keeps its own destination')
})

test('the mix at a glance: normal, partial and muted', () => {
  const { stageMixLevel, stageMixIcon } = load()
  const all = { master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {} }
  assert.equal(stageMixLevel(all), 'normal')
  assert.equal(stageMixLevel({ ...all, muted: { sfx: true } }), 'partial')
  assert.equal(stageMixLevel({ ...all, ambience: 0 }), 'partial')
  assert.equal(stageMixLevel({ ...all, muted: { master: true } }), 'muted')
  assert.equal(stageMixLevel({ ...all, voice: 0, music: 0, sfx: 0, ambience: 0 }), 'muted')
  assert.deepEqual(['normal', 'partial', 'muted'].map(stageMixIcon), ['voice', 'speakerLow', 'speakerOff'])
})

test('CONFIG › 声音 lists every layer with a mute, a slider and its value; ▶ previews the current voice only', () => {
  const page = load(), audio = page.tavernStageAudio
  audio.setVolume('music', .4); audio.toggleMute('music')
  const said = []
  const rows = expand(h(page.TavernStageMixerRows, { state: audio.get(), tests: { voice: () => said.push('line') } }))
  const each = all(rows, node => node.props['data-layer'])
  assert.deepEqual(each.map(row => text(all(row, node => node.type === 'b')[0])), ['总音量', '配音', '背景音乐', '音效', '环境音'])
  const music = each[2], slider = all(music, node => node.type === 'input')[0]
  assert.deepEqual([slider.props.value, slider.props['aria-label'], slider.props['aria-valuetext']], [.4, '背景音乐音量', '静音（40）'])
  assert.match(music.props.className, /is-muted/)
  const mute = all(music, node => node.type === 'button')[0]
  assert.equal(mute.props['aria-label'], '取消背景音乐静音')
  mute.props.onClick(); assert.equal(audio.get().muted.music, undefined)
  slider.props.onChange({ target: { value: '0.7' } }); assert.equal(audio.get().music, .7)
  const tests = all(rows, node => node.type === 'button' && node.props['aria-label'] === '试听配音')
  assert.equal(tests.length, 1, 'only the voice has a preview')
  tests[0].props.onClick(); assert.deepEqual(said, ['line'])
  const none = expand(h(page.TavernStageMixerRows, { state: audio.get(), tests: { voice: null } }))
  assert.equal(all(none, node => node.props['aria-label'] === '试听配音')[0].props.disabled, true, 'no voice on this page: the ▶ is disabled')
  // The 「声音」 entry opens CONFIG at 声音 and says the mix at a glance.
  audio.toggleMute('master')
  const opened = []
  const entry = expand(h(page.TavernStageSoundEntry, { openConfig: (tab, opener) => opened.push([tab, opener]) }))
  assert.deepEqual([entry.props['aria-label'], entry.props['data-level']], ['声音（已静音）', 'muted'])
  entry.props.onClick({ stopPropagation() {}, currentTarget: 'button' })
  assert.deepEqual(opened, [['sound', 'button']])
})

test('CONFIG has the 声音 and 文字 tabs; the opener picks the first and the pace sliders are in 文字', () => {
  const page = load()
  page.sandbox.useTavernStageAudioState = () => page.tavernStageAudio.get()
  page.sandbox.useTavernStageReadingPrefs = () => page.STAGE_READING_DEFAULTS
  const screen = expand(h(page.TavernStageConfigScreen, { tab: 'text', tests: {}, onClose() {} }))
  assert.equal(screen.props.role, 'dialog')
  assert.deepEqual(all(screen, node => node.props.role === 'tab').map(tab => [text(tab.children[1]), tab.props['aria-selected']]), [['声音', false], ['文字', true]])
  assert.deepEqual(all(screen, node => node.type === 'input').map(input => input.props['aria-label']), ['文字速度', '自动阅读速度', '自动模式等待'])
  const speed = all(screen, node => node.props['aria-label'] === '文字速度')[0]
  assert.deepEqual([speed.props.min, speed.props.max, speed.props.value, speed.props['aria-valuetext']], [0, 80, 52, '28 毫秒每字'], '慢 → 快 reads left to right; the default is 28 ms per glyph')
  assert.ok(all(screen, node => node.props.className === 'dsh-tavern-stage-config-preview').length === 1, 'the 文字 page types a sample line')
  const sound = expand(h(page.TavernStageConfigScreen, { tab: 'sound', tests: {}, onClose() {} }))
  assert.deepEqual(all(sound, node => node.type === 'input').map(input => input.props['aria-label']), ['总音量', '配音音量', '背景音乐音量', '音效音量', '环境音音量', '配音倍速'])
})

test('the reading pace keeps the stage\'s own timing by default and scales every auto wait without cutting a voice', () => {
  const { stageReadingPrefs, stageAutoDelay, STAGE_READING_DEFAULTS } = load()
  const short = 'Hi.', long = 'x'.repeat(40)
  assert.deepEqual([stageAutoDelay(STAGE_READING_DEFAULTS, true, short), stageAutoDelay(STAGE_READING_DEFAULTS, false, short), stageAutoDelay(STAGE_READING_DEFAULTS, false, long)], [400, 1500, 3200],
    'the defaults are the old 400 ms after a voice and the length-based wait')
  const fast = stageReadingPrefs({ autoSpeed: 2, autoWait: 1000 })
  assert.deepEqual([stageAutoDelay(fast, true, short), stageAutoDelay(fast, false, short)], [500, 1050], 'the wait shifts a silent page, the speed divides both')
  assert.deepEqual(JSON.parse(JSON.stringify(stageReadingPrefs({ textSpeed: 95, autoSpeed: 9, autoWait: -5, voiceRate: 1.26, extra: 1 }))), { textSpeed: 80, autoWait: 0, autoSpeed: 3, voiceRate: 1.3 }, 'saved values are clamped to their range and step')
  assert.deepEqual(JSON.parse(JSON.stringify(stageReadingPrefs('x'))), { textSpeed: 28, autoWait: 400, autoSpeed: 1, voiceRate: 1 })
  assert.equal(stageReadingPrefs({ textSpeed: 0 }).textSpeed, 0, '0 shows each line at once')
})
