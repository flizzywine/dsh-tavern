// 回合末选项 (cast-presentation.md 34/N): the stage's last card ends on the round's candidates and 自由输入 (modules/stage-choices.js,
// features/stage-choices.js), drawn by a skin's art.choices and moved by its transitions.choices (features/stage-skin.js). The
// states, the wait lines, the skin's tokens and the menu on a fake React: no browser. The real stage is exercised in
// tests/e2e/stage-choices.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { BUILTIN_STAGE_SKINS, skinContrast, stageSkinImageOf, stageSkinSliceEdges, validateStageSkin } from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

const client = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const interpreter = vm.runInNewContext(client('features/stage-skin.js') + '; ({ stageSkinRoot, stageSkinArt, stageSkinArtImages })', { skinContrast, stageSkinImageOf, stageSkinSliceEdges })
const skin = patch => ({ ...structuredClone(BUILTIN_STAGE_SKINS.classic), id: 'sample-choices', label: '示例', ...patch })
const art = choices => ({ screen: 1080, screenWidth: 1920, textbox: { images: { plain: 'art/box.png' }, body: [0, 0, 1800, 260], bottom: 20, text: [80, 1720, 130], font: 40, lines: 3 }, ...(choices ? { choices } : {}) })
const bar = { images: { plain: 'art/bar.png' }, slice: [10, 40, 10, 40], text: [60, 840, 40], font: 28, pitch: 40, gap: 12, center: 400 }
const rejects = document => assert.throws(() => validateStageSkin(document), error => error.code === 'INVALID_SKIN')

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat().filter(child => child !== null && child !== undefined && child !== false) })
const flat = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(flat)]
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(text).join('') : ''
// One component, re-rendered after every state change; effects run after each render.
function hookRunner() {
  let slots = [], at = 0, effects = [], dirty = false
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  const effect = (fn, deps) => { const i = at++; const old = slots[i]; if (!old || changed(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  const React = {
    createElement: h, Fragment: 'Fragment',
    useState(initial) {
      const i = at++
      if (!(i in slots)) slots[i] = initial
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true } }]
    },
    useRef(initial) { const i = at++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useSyncExternalStore: (subscribe, get) => get(),
    useEffect: effect, useLayoutEffect: effect
  }
  return { React, render(component, props) { let out; do { dirty = false; at = 0; effects = []; out = component(props); effects.forEach(run => run()) } while (dirty); return out } }
}
function load() {
  const runner = hookRunner(), coordination = { view: null }, invalidated = []
  const sandbox = { React: runner.React, Date, Math, setInterval: () => 0, clearInterval() {}, setTimeout: fn => fn(), getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    window: { matchMedia: () => ({ matches: false }) }, document: { addEventListener() {}, removeEventListener() {}, activeElement: null },
    useTavernCoordination: () => coordination, liveTavernView: { invalidate: id => invalidated.push(id) }, tavernCoordination: { invalidate() {} }, tavernErrorHub: { report() {} } }
  const api = vm.runInNewContext([client('modules/stage-choices.js'), client('features/stage-choices.js'),
    '({ stageChoiceState, stageChoiceItems, stageWaitEpisode, stageWaitLineAt, STAGE_WAIT_LINES, STAGE_WAIT_LINE_MS, TavernStageChoices })'].join('\n;'), sandbox)
  let stored = null
  const flow = { store: { subscribe: () => () => {}, getSnapshot: () => stored, set: value => { stored = value } }, ready: (sessionId, messageId, candidates) => ({ sessionId, messageId, phase: 'ready', choices: candidates.choices }),
    submitted: [], submit(sessionId, messageId, guidance) { flow.submitted.push([sessionId, messageId, guidance]); return Promise.resolve() } }
  return { ...api, runner, coordination, flow, panel: value => { stored = value } }
}

test('the menu shows on the round\'s last card only, from the shared candidate panel or the task; the stage never starts one', () => {
  const { stageChoiceState } = load()
  const state = patch => stageChoiceState({ panel: null, task: null, atEnd: true, running: false, ...patch })
  assert.equal(state({ atEnd: false }), 'hidden', 'not before the last card')
  assert.equal(state({ running: true }), 'hidden', 'not while the next reply is written')
  assert.equal(state(), 'off', 'no candidates yet: 生成选项')
  assert.equal(state({ panel: { phase: 'loading' } }), 'generating')
  assert.equal(state({ panel: { phase: 'ready' } }), 'ready')
  assert.equal(state({ panel: { phase: 'error' } }), 'failed')
  assert.equal(state({ task: { busy: true } }), 'generating', 'the host\'s automatic generation shows as it runs')
  assert.equal(state({ task: { status: 'succeeded' } }), 'ready')
  assert.equal(state({ task: { status: 'cancelled' } }), 'off', 'a stopped task offers 生成选项 again, not an error')
  assert.equal(state({ task: { status: 'failed', terminal: true } }), 'failed')
})

test('a scene change reads like any other choice; only the message sent carries its mark', () => {
  const { stageChoiceItems } = load()
  assert.deepEqual(JSON.parse(JSON.stringify(stageChoiceItems([{ type: 'action', text: '推门' }, { type: 'scene', text: '第二天清晨' }, '看地图', { type: 'action', text: ' ' }]))), [
    { type: 'action', text: '推门', send: '推门' }, { type: 'scene', text: '第二天清晨', send: '【场景变化】第二天清晨' }, { type: 'action', text: '看地图', send: '看地图' }])
})

test('the wait lines take turns in four slots, a line changing only while its slot is hidden; a wait resumes where it was', () => {
  const { stageWaitEpisode, stageWaitLineAt, STAGE_WAIT_LINES, STAGE_WAIT_LINE_MS } = load()
  const lines = ['甲', '乙', '丙', '丁', '戊', '己']
  assert.deepEqual([0, 1, 2, 3].map(slot => stageWaitLineAt(lines, 0, slot, 0)), ['甲', '乙', '丙', '丁'], 'the first four lines, in order')
  // Slot 0 shows 0 .. 1 turn of each 4-turn cycle and takes its next line half a turn after it faded out.
  assert.equal(stageWaitLineAt(lines, 0, 0, STAGE_WAIT_LINE_MS * 1.4), '甲', 'not yet, it is still fading out')
  assert.equal(stageWaitLineAt(lines, 0, 0, STAGE_WAIT_LINE_MS * 1.6), '戊', 'refilled while hidden')
  assert.equal(stageWaitLineAt(lines, 0, 0, STAGE_WAIT_LINE_MS * 4.1), '戊', 'and shows it on its next turn')
  assert.equal(stageWaitLineAt(lines, 4, 2, 0), '甲', 'wraps around the lines')
  const first = stageWaitEpisode(null, 'a', 23, () => .5, 1000)
  assert.deepEqual({ ...first }, { key: 'a', first: 11, start: 1000 })
  assert.equal(stageWaitEpisode(first, 'a', 23, () => 0, 9000), first, 'the same wait keeps its clock')
  assert.equal(stageWaitEpisode(first, 'b', 23, () => 0, 9000).start, 9000)
  assert.ok(STAGE_WAIT_LINES.length >= 4 && STAGE_WAIT_LINES.every(line => validateStageSkin(skin({ waitLines: [line] }))), 'the defaults are valid skin lines')
})

test('a skin declares its wait lines and its menu transitions; the document stays closed', () => {
  validateStageSkin(skin({ waitLines: ['灯影摇曳中'], transitions: { choices: { enter: { ms: 200, wipe: { shape: 'left' } }, leave: { ms: 300, ease: 'spring', delay: 50, stagger: 30, pose: { scale: 1.1 }, fade: true } } } }))
  rejects(skin({ waitLines: [] }))
  rejects(skin({ waitLines: ['一行\n两行'] }))
  rejects(skin({ waitLines: ['这是一句远远超过二十四个字的等待语，一行放不下手机屏幕的宽度'] }))
  rejects(skin({ transitions: { choices: { enter: { ms: 200 } } } }))
  rejects(skin({ transitions: { choices: {} } }))
  rejects(skin({ transitions: { choices: { enter: { ms: 200, fade: true, shapes: [] } } } }))
  validateStageSkin(skin({ transitions: { menu: { enter: { ms: 200, fade: true } } } }))
  rejects(skin({ transitions: { unknown: { enter: { ms: 200, fade: true } } } }))
})

test('transitions.choices become the stage root\'s data-fk-tx and tokens; without them the engine\'s own motion stays', () => {
  const plain = interpreter.stageSkinRoot(skin())
  assert.equal(plain['data-fk-tx'], undefined)
  assert.equal(Object.keys(plain.style).some(key => key.startsWith('--tx-')), false)
  const root = interpreter.stageSkinRoot(skin({ transitions: { choices: { enter: { ms: 240, stagger: 40, pose: { dx: 8, rot: -3 }, fade: true }, leave: { ms: 300, delay: 60, ease: [.2, 0, 0, 1], wipe: { shape: 'circle', at: [.25, .5] } } } } }))
  assert.equal(root['data-fk-tx'], 'choices-enter choices-leave')
  const t = root.style
  assert.deepEqual([t['--tx-choices-enter-ms'], t['--tx-choices-enter-ease'], t['--tx-choices-enter-stagger'], t['--tx-choices-enter-o'], t['--tx-choices-enter-t'], t['--tx-choices-enter-clip']],
    ['240ms', 'cubic-bezier(.2,.7,.3,1)', '40ms', '0', 'translate(8%, 0%) rotate(-3deg) scale(1)', 'none'])
  assert.deepEqual([t['--tx-choices-leave-ease'], t['--tx-choices-leave-delay'], t['--tx-choices-leave-o'], t['--tx-choices-leave-t'], t['--tx-choices-leave-clip'], t['--tx-choices-leave-open']],
    ['cubic-bezier(0.2,0,0,1)', '60ms', '1', 'none', 'circle(0% at 25% 50%)', 'circle(150% at 25% 50%)'])
  assert.equal(t['--tx-choices-pick-ms'], '360', 'the pick is sent after the leave\'s delay and time')
  // The engine's defaults: the ribbons send at once, the skin's bars after their .233 s pick; a declared leave holds its own.
  assert.match(css, /\.dsh-tavern-stage-choices \{\n  --sc-size:[^}]*--stage-choice-pick-ms: 0;/)
  assert.match(css, /\[data-fk-skin-choices\] \.dsh-tavern-stage-choices \{[^}]*--stage-choice-pick-ms: 233;/)
  assert.match(css, /\[data-fk-tx~="choices-leave"\] \.dsh-tavern-stage-choices \{ --stage-choice-pick-ms: var\(--tx-choices-pick-ms\); \}/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.dsh-tavern-stage-choices, \.dsh-tavern-stage-choices > \* \{ animation: none !important; \}/)
})

test('art.choices draws the menu as the skin\'s bars from its decoded images, or the whole art layer waits for them', () => {
  const document = skin({ art: art({ ...bar, center: undefined, anchor: 'above-box', images: { plain: 'art/bar.png', off: 'art/bar-off.png', alt: 'art/bar-alt.png' }, band: [20, 60],
    x: 700, align: 'left', tilt: [-2, 2], stagger: [0, 30], ink: '#f0e8d0', weight: 500, spacing: .05, focus: { image: 'art/bar-on.png', ink: '#ffffff', dx: 12 } }) })
  delete document.art.choices.center
  validateStageSkin(document)
  assert.deepEqual([...interpreter.stageSkinArtImages(document)].sort(), ['art/bar-alt.png', 'art/bar-off.png', 'art/bar-on.png', 'art/bar.png', 'art/box.png'])
  const files = Object.fromEntries(['art/box.png', 'art/bar.png', 'art/bar-off.png', 'art/bar-alt.png', 'art/bar-on.png'].map(name => [name, { url: '/lease/' + name, width: name === 'art/box.png' ? 1800 : 900, height: name === 'art/box.png' ? 300 : 80 }]))
  const { marks, tokens } = interpreter.stageSkinArt(document, files)
  assert.deepEqual(Object.keys(marks).filter(key => key.includes('choices')).sort(), ['data-fk-skin-choices', 'data-fk-skin-choices-alt', 'data-fk-skin-choices-anchor', 'data-fk-skin-choices-focus'])
  assert.deepEqual([tokens['--art-choice'], tokens['--art-choice-off'], tokens['--art-choice-w'], tokens['--art-choice-h'], tokens['--art-choice-sl'], tokens['--art-choice-r'], tokens['--art-choice-y']],
    ['url("/lease/art/bar.png")', 'url("/lease/art/bar-off.png")', '900', '80', '40', '840', '40'])
  assert.equal(tokens['--art-choice-center'], '380', 'above-box: the middle of the room above the box image (1080 - 20 - 300) / 2')
  assert.deepEqual([tokens['--art-choice-top'], tokens['--art-choice-x'], tokens['--art-choice-justify'], tokens['--art-choice-tilt-even'], tokens['--art-choice-shift-even']], ['20', '700', 'flex-start', '2deg', '30'])
  assert.deepEqual([tokens['--art-choice-ink'], tokens['--art-choice-weight'], tokens['--art-choice-spacing'], tokens['--art-choice-focus-ink'], tokens['--art-choice-focus-dx']], ['#f0e8d0', '500', '0.05em', '#ffffff', '12'])
  assert.equal(tokens['--art-choice-focus-alt'], 'url("/lease/art/bar-on.png")')
  const stage = interpreter.stageSkinArt(skin({ art: art({ ...bar, center: undefined, anchor: 'stage' }) }), files).tokens
  assert.equal(stage['--art-choice-center'], '540')
  assert.equal(interpreter.stageSkinArt(skin({ art: art(bar) }), files).tokens['--art-choice-center'], '400')
  const { 'art/bar.png': _, ...missing } = files
  assert.equal(interpreter.stageSkinArt(skin({ art: art(bar) }), missing), null, 'a declared bar that does not load drops the art layer')
  assert.equal(Object.keys(interpreter.stageSkinArt(skin({ art: art() }), files).marks).some(key => key.includes('choices')), false, 'no art.choices: the engine\'s ribbons')
})

test('the menu: suggestions, then 自由输入; 生成选项 without candidates, 重试 after a failure; the waits take the box', () => {
  const { TavernStageChoices, runner, flow, panel, coordination } = load()
  const props = patch => ({ sessionId: 's1', messageId: 'm1', flow, running: false, atEnd: true, submit: () => Promise.resolve(), lines: ['甲', '乙'], ...patch })
  const nodes = out => flat(out).filter(node => node.props && node.props.className)
  const of = (out, name) => nodes(out).filter(node => String(node.props.className).split(' ').includes(name))
  // Off: 生成选项 submits this reply's candidate task through the shared pipeline.
  let out = runner.render(TavernStageChoices, props())
  const generate = of(out, 'dsh-tavern-stage-choice-main').find(node => node.props['data-action'] === 'generate')
  assert.equal(text(generate), '生成选项')
  assert.equal(of(out, 'dsh-tavern-stage-choice').at(-1).props.className, 'dsh-tavern-stage-choice is-free')
  generate.props.onClick()
  assert.deepEqual(flow.submitted, [['s1', 'm1', '']])
  // Generating: the wait in the box, no 自由输入.
  out = runner.render(TavernStageChoices, props())
  assert.equal(of(out, 'dsh-tavern-stage-wait')[0].props['aria-label'], '正在生成选项')
  assert.equal(of(out, 'dsh-tavern-stage-choices')[0].props['data-state'], 'generating')
  assert.equal(of(out, 'is-free').length, 0)
  // Ready: each suggestion with its ✎, then 自由输入; another reply's panel is not this one's.
  panel({ sessionId: 's1', messageId: 'm1', phase: 'ready', choices: [{ type: 'action', text: '推门' }, { type: 'scene', text: '第二天清晨' }] })
  out = runner.render(TavernStageChoices, props())
  assert.deepEqual(of(out, 'dsh-tavern-stage-choice-text').map(text), ['推门', '第二天清晨', '自由输入'])
  assert.equal(of(out, 'dsh-tavern-stage-choice-edit').length, 2)
  assert.equal(of(out, 'dsh-tavern-stage-wait').length, 0)
  assert.equal(of(out, 'dsh-tavern-stage-choices')[0].props.style['--rows'], 3)
  assert.equal(of(runner.render(TavernStageChoices, props({ messageId: 'm2' })), 'dsh-tavern-stage-choice-text').length, 1, 'only 自由输入 for another reply (生成选项 too)')
  // Failed: 选项生成失败 · 重试.
  panel({ sessionId: 's1', messageId: 'm1', phase: 'error', choices: [], error: 'boom' })
  out = runner.render(TavernStageChoices, props())
  assert.equal(text(of(out, 'is-error')[0]), '选项生成失败重试')
  assert.equal(of(out, 'dsh-tavern-stage-choice-retry')[0].props.title, 'boom')
  // Hidden before the last card; while the reply is written its wait shows instead.
  assert.equal(runner.render(TavernStageChoices, props({ atEnd: false })), null)
  out = runner.render(TavernStageChoices, props({ running: true }))
  assert.equal(out.props['aria-label'], '正在生成下一轮')
  // A finished task drives the shared panel even with the chat away.
  panel(null)
  coordination.view = { task: { kind: 'candidate', input: { messageId: 'm1' }, taskId: 't', version: 2, status: 'succeeded', result: { candidates: { choices: [{ type: 'action', text: '看地图' }] } } } }
  runner.render(TavernStageChoices, props())
  out = runner.render(TavernStageChoices, props())
  assert.deepEqual(of(out, 'dsh-tavern-stage-choice-text').map(text), ['看地图', '自由输入'])
})

test('a pick sends the suggestion as offered (a scene with its mark); ✎ and 自由输入 open a field in place', async () => {
  const { TavernStageChoices, runner, flow, panel } = load()
  const sent = []
  const props = { sessionId: 's1', messageId: 'm1', flow, running: false, atEnd: true, submit: value => { sent.push(value); return Promise.resolve() }, lines: ['甲'] }
  panel({ sessionId: 's1', messageId: 'm1', phase: 'ready', choices: [{ type: 'action', text: '推门' }, { type: 'scene', text: '第二天清晨' }] })
  const find = (out, test) => flat(out).find(node => node.props && test(node))
  let out = runner.render(TavernStageChoices, props)
  // ✎ turns the suggestion into its field, the words as they were; the free row keeps its place.
  find(out, node => node.props['aria-label'] === '改一改再发送').props.onClick()
  out = runner.render(TavernStageChoices, props)
  const field = find(out, node => node.type === 'textarea')
  assert.equal(field.props.value, '推门')
  assert.equal(field.props['aria-label'], '修改选项')
  // Esc reverts it to the ribbon.
  field.props.onKeyDown({ key: 'Escape', stopPropagation() {}, preventDefault() {}, nativeEvent: {} })
  out = runner.render(TavernStageChoices, props)
  assert.equal(find(out, node => node.type === 'textarea'), undefined)
  find(out, node => node.type === 'button' && text(node) === '第二天清晨').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['【场景变化】第二天清晨'])
  assert.equal(flow.store.getSnapshot(), null, 'a sent pick clears the shared panel')
  // 自由输入: Enter sends what was typed.
  out = runner.render(TavernStageChoices, props)
  find(out, node => node.props['data-action'] === 'free').props.onClick()
  out = runner.render(TavernStageChoices, props)
  const free = find(out, node => node.type === 'textarea')
  assert.equal(free.props.placeholder, '你想怎么做？')
  free.props.onChange({ target: { value: '我自己走过去' } })
  out = runner.render(TavernStageChoices, props)
  find(out, node => node.type === 'textarea').props.onKeyDown({ key: 'Enter', shiftKey: false, stopPropagation() {}, preventDefault() {}, nativeEvent: { isComposing: false } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, ['【场景变化】第二天清晨', '我自己走过去'])
})
