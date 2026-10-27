// 旁白 (cast-presentation.md 29/N): a skin's art.narration lays narration pages out without the box - over the darkened
// scene, or in a band while the page shows a picture - and brings each card in line by line (modules/stage-narration.js,
// features/stage-narration.js). The layout, the line runs, the skin's tokens and the line reader on a fake clock and a fake
// measured box: no browser. The real stage is exercised in tests/e2e/stage-narration.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { BUILTIN_STAGE_SKINS, skinContrast, stageSkinImageOf, stageSkinSliceEdges, validateStageSkin } from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

const STAGE_NARRATION_INK = vm.runInNewContext(readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs', import.meta.url), 'utf8') + '; STAGE_NARRATION_INK')
const client = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat().filter(child => child !== null && child !== undefined) })
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(text).join('') : ''
const narration = { font: 32, pitch: 64, veil: .7, y: 292, band: { font: 28, pitch: 42, veil: .4, bottom: 12 }, lines: { fade: .7, stagger: .9, rise: 30 } }
const skin = art => ({ ...structuredClone(BUILTIN_STAGE_SKINS.classic), id: 'sample-narration', label: '示例', ...(art ? { art } : {}) })

// One component, re-rendered after every state change; refs point at fake elements; layout effects run before effects.
function hookRunner(element) {
  let slots = [], at = 0, effects = [], dirty = false
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  const effect = (fn, deps) => { const i = at++; const old = slots[i]; if (!old || changed(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) }
  const React = {
    createElement: h, Fragment: 'Fragment',
    useState(initial) {
      const i = at++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true } }]
    },
    useRef(initial) { const i = at++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useMemo(fn, deps) { const i = at++; if (!(i in slots) || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value },
    useEffect: effect, useLayoutEffect: effect
  }
  return {
    React,
    render(component, props) {
      let out
      do { dirty = false; at = 0; effects = []; out = component(props); if (out.props.ref) out.props.ref.current = element; effects.forEach(run => run()) } while (dirty)
      return out
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) }
  }
}
// A text area `perLine` glyphs wide and 40 px a line: a glyph's top is its line's, a line break ends its line.
function box(perLine) {
  const parent = { clientWidth: 400, appendChild(probe) { probe.parentNode = parent } }
  const document = {
    fonts: { status: 'loaded', addEventListener() {}, removeEventListener() {} },
    createElement: () => ({ style: {}, set textContent(value) { this.firstChild = { data: value } }, remove() {} }),
    createRange() {
      let node, start
      return { setStart(n, offset) { node = n; start = offset }, setEnd() {},
        getBoundingClientRect() {
          let row = 0, col = 0
          for (const glyph of node.data.slice(0, start)) if (glyph === '\n' || ++col === perLine) { row++; col = 0 }
          return { top: 40 * row }
        } }
    }
  }
  return { element: { parentElement: parent }, document }
}
function clock() {
  let now = 0, id = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimeout(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id },
    clearTimeout(timer) { timers.delete(timer) },
    run(ms) { now += ms; for (const [key, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (timer.at <= now) { timers.delete(key); timer.fn() } }
  }
}
function load({ perLine = 10, reduced = false } = {}) {
  const fake = box(perLine), time = clock(), runner = hookRunner(fake.element)
  const sandbox = { React: runner.React, document: fake.document, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, performance: { now: time.now }, Intl,
    getComputedStyle: () => ({ paddingLeft: '0', paddingRight: '0' }), ResizeObserver: class { observe() {} disconnect() {} }, matchMedia: () => ({ matches: reduced }) }
  const api = vm.runInNewContext([client('modules/stage-runtime.js'), client('modules/stage-typewriter.js'), client('features/stage-typewriter.js'), client('modules/stage-narration.js'), client('features/stage-narration.js'),
    '({ stageNarrationLayout, stageNarrationLineRuns, TavernStageNarrationLines })'].join('\n;'), sandbox)
  return { ...api, runner, time, fake }
}

test('only a skin that declares art.narration lays out a narration page; a picture on a playing visit takes the band', () => {
  const { stageNarrationLayout } = load()
  const said = { kind: 'line', text: '"走吧。"', speaker: '纱织' }, told = { kind: 'narration', text: '雨停了。' }
  const item = image => ({ op: 'item.play', at: 2, item: '旧钥匙', ...(image ? { image } : {}) })
  const layout = patch => stageNarrationLayout({ narration, beat: told, skipping: false, mode: 'page', events: [], at: 2, ...patch })
  assert.equal(layout({ narration: null }), undefined, 'a skin without art.narration keeps its own narration box')
  assert.equal(layout({ beat: said }), undefined, 'a line page keeps the box')
  assert.equal(layout({ beat: undefined }), undefined)
  assert.equal(layout({ skipping: true }), undefined, 'a fast-forward keeps the box, so 150 ms pages do not flip it')
  assert.equal(layout(), 'screen')
  assert.equal(layout({ events: [item('blob:key')] }), 'band', 'the page\'s item picture stays uncovered')
  assert.equal(layout({ events: [item('blob:key')], mode: 'live' }), 'band')
  assert.equal(layout({ events: [item('blob:key')], at: 3 }), 'screen', 'another page\'s item')
  assert.equal(layout({ events: [item('')] }), 'screen', 'an item without a picture shows only its name')
  for (const mode of ['skip', 'refresh']) assert.equal(layout({ events: [item('blob:key')], mode }), 'screen', 'a ' + mode + ' visit never shows the item')
})

test('the skin\'s art.narration.layout wins over the item picture: box keeps the box, free is always centred, band always the strip', () => {
  const { stageNarrationLayout } = load()
  const told = { kind: 'narration', text: '雨停了。' }, picture = [{ op: 'item.play', at: 2, item: '旧钥匙', image: 'blob:key' }]
  const layout = (mode, patch) => stageNarrationLayout({ narration: { ...narration, ...(mode ? { layout: mode } : {}) }, beat: told, skipping: false, mode: 'page', events: [], at: 2, ...patch })
  assert.deepEqual([layout(), layout(undefined, { events: picture })], ['screen', 'band'], 'omitted: the stage\'s rule (centred, the band while the picture shows)')
  assert.deepEqual([layout('free'), layout('free', { events: picture })], ['screen', 'screen'])
  assert.deepEqual([layout('band'), layout('band', { events: picture }), layout('band', { mode: 'refresh' })], ['band', 'band', 'band'])
  assert.deepEqual([layout('box'), layout('box', { events: picture })], [undefined, undefined])
  for (const mode of ['free', 'band']) {
    assert.equal(layout(mode, { skipping: true }), undefined, 'a fast-forward still keeps the box')
    assert.equal(layout(mode, { beat: { kind: 'line', text: '"走吧。"', speaker: '纱织' } }), undefined, 'a line page keeps the box')
  }
})

test('the skin declares the boxless ink, its halo and the veil colour; the defaults are the subtitle look on black', () => {
  const interpreter = vm.runInNewContext(client('features/stage-skin.js') + '; ({ stageSkinTokens, stageSkinRoot })', { skinContrast, stageSkinImageOf, stageSkinSliceEdges, STAGE_NARRATION_INK })
  const plain = interpreter.stageSkinTokens(skin({ screen: 576, narration }))
  assert.deepEqual([plain['--art-nar-ink'], plain['--art-nar-ink-rgb'], plain['--art-nar-veil-rgb'], plain['--art-nar-halo']],
    ['#fbf8ff', '251 248 255', '0 0 0', '0 0 2px #000, 0 1px 3px rgb(0 0 0 / .95), 0 0 14px rgb(0 0 0 / .65)'])
  const day = skin({ screen: 576, narration: { ...narration, ink: '#1d1a22', veilColor: '#f4efe6', halo: { y: 1, blur: 4, color: '#ffffff', alpha: .8 } } })
  validateStageSkin(day)
  const tokens = interpreter.stageSkinTokens(day)
  assert.deepEqual([tokens['--art-nar-ink'], tokens['--art-nar-ink-rgb'], tokens['--art-nar-veil-rgb'], tokens['--art-nar-halo']],
    ['#1d1a22', '29 26 34', '244 239 230', 'calc(0 * var(--nar-u)) calc(1 * var(--nar-u)) calc(4 * var(--nar-u)) rgb(255 255 255 / 0.8)'])
  assert.equal(interpreter.stageSkinTokens(skin({ screen: 576, narration: { ...narration, halo: false } }))['--art-nar-halo'], 'none')
  // textStyle.narration inks narration in the box: a token and a mark, on any skin.
  const inked = { ...skin(), textStyle: { narration: '#cfc6ff' } }
  validateStageSkin(inked)
  const root = interpreter.stageSkinRoot(inked)
  assert.deepEqual([root.style['--gal-skin-narration'], root['data-fk-skin-narration-ink']], ['#cfc6ff', ''])
  assert.equal('data-fk-skin-narration-ink' in interpreter.stageSkinRoot(BUILTIN_STAGE_SKINS.classic), false)
  const section = css.slice(css.indexOf('/* ==== stage narration ===='), css.indexOf('/* ==== end stage narration ==== */'))
  assert.match(section, /\[data-fk-skin-narration-ink\]:not\(\[data-narration-layout\]\) \.dsh-tavern-stage-scene \.dsh-tavern-stage-text\.is-narration \{ --gal-skin-fg: var\(--gal-skin-narration\); \}/)
  assert.match(section, /--gal-skin-qm-idle: var\(--art-nar-ink\);[^}]*text-shadow: var\(--art-nar-halo\);/, 'the control row takes the ink and halo')
})

test('the new fields are checked where the skin enters: their words and ranges, and 4.5:1 on every ground the words can stand on', () => {
  const rejects = (value, code = 'INVALID_SKIN') => assert.throws(() => validateStageSkin(skin({ screen: 576, narration: { ...narration, ...value } })), error => error.code === code, JSON.stringify(value))
  const accepts = value => validateStageSkin(skin({ screen: 576, narration: { ...narration, ...value } }))
  for (const layout of ['box', 'free', 'band']) accepts({ layout })
  rejects({ layout: 'screen' }); rejects({ ink: 'white' }); rejects({ veilColor: '#fff' }); rejects({ halo: true }); rejects({ halo: { blur: 2 } })
  accepts({ halo: false, band: { veil: .7 } }); accepts({ halo: { blur: 2, color: '#000000' } })
  // Dark ink on a light veil reads with no halo; on the default black veil or under the default dark halo it does not.
  accepts({ ink: '#1d1a22', veilColor: '#f4efe6', halo: false, veil: .75, band: { veil: .75 } })
  rejects({ ink: '#1d1a22', veilColor: '#f4efe6', veil: .75, band: { veil: .75 } }, 'SKIN_CONTRAST')
  rejects({ ink: '#1d1a22', halo: false }, 'SKIN_CONTRAST')
  // Each veil the layout can use: free has no band, band no centre veil; the default band veil (80/255) is too thin for no halo.
  rejects({ ink: '#1d1a22', veilColor: '#f4efe6', halo: false, veil: .75 }, 'SKIN_CONTRAST')
  accepts({ ink: '#1d1a22', veilColor: '#f4efe6', halo: false, veil: .75, layout: 'free' })
  accepts({ ink: '#1d1a22', veilColor: '#f4efe6', halo: false, veil: .1, band: { veil: .75 }, layout: 'band' })
  // A halo is a ground too: a faint one over a thin veil does not carry the ink.
  rejects({ halo: { blur: 3, color: '#000000', alpha: .2 }, veil: .1, band: { veil: .1 } }, 'SKIN_CONTRAST')
  accepts({ ink: '#1d1a22', layout: 'box' }, 'a box layout has no veil')
  // textStyle.narration keeps 7:1 on the box.
  assert.throws(() => validateStageSkin({ ...skin(), textStyle: { narration: '#7a7a8a' } }), error => error.code === 'SKIN_CONTRAST')
  // Every skin written before keeps validating: the defaults are white on a dark halo.
  validateStageSkin(skin({ screen: 576, narration: { font: 30, pitch: 50, veil: 0 } }))
})

test('a card\'s visual lines come from its glyphs\' measured tops; a line break ends its line', () => {
  const { stageNarrationLineRuns } = load()
  assert.deepEqual(Array.from(stageNarrationLineRuns(['一', '二', '三', '四'], [0, 0, 40, 40])), ['一二', '三四'])
  assert.deepEqual(Array.from(stageNarrationLineRuns(['甲', '\n', '乙'], [0, 0, 40])), ['甲\n', '乙'])
  assert.deepEqual(Array.from(stageNarrationLineRuns([], [])), [])
})

test('art.narration is drawn from the document alone: its size, pitch, veil and centre, and the band\'s, with defaults', () => {
  const interpreter = vm.runInNewContext(client('features/stage-skin.js') + '; ({ stageSkinTokens, stageSkinArt })', { skinContrast, stageSkinImageOf, stageSkinSliceEdges, STAGE_NARRATION_INK })
  const declared = skin({ screen: 576, screenWidth: 1024, narration })
  validateStageSkin(declared)
  const tokens = interpreter.stageSkinTokens(declared)
  assert.deepEqual([tokens['--nar-screen'], tokens['--nar-screen-w'], tokens['--art-nar-font'], tokens['--art-nar-pitch'], tokens['--art-nar-veil'], tokens['--art-nar-y']], ['576', '1024', '32', '64', '0.7', '292'])
  assert.deepEqual([tokens['--art-nar-band-font'], tokens['--art-nar-band-pitch'], tokens['--art-nar-band-veil'], tokens['--art-nar-band-bottom']], ['28', '42', '0.4', '12'])
  assert.equal(interpreter.stageSkinArt(declared, {}), null, 'no text box art: the art layer is not drawn, the narration still is')
  const plain = skin({ screen: 720, narration: { font: 30, pitch: 50, veil: .5 } })
  validateStageSkin(plain)
  const defaults = interpreter.stageSkinTokens(plain)
  assert.deepEqual([defaults['--nar-screen-w'], defaults['--art-nar-y'], defaults['--art-nar-band-font'], defaults['--art-nar-band-pitch'], defaults['--art-nar-band-veil'], defaults['--art-nar-band-bottom']], ['1280', '360', '30', '43', '0.314', '0'])
  assert.equal(Object.keys(interpreter.stageSkinTokens(BUILTIN_STAGE_SKINS.classic)).some(key => key.includes('nar')), false, '经典 declares no narration')
  // The stylesheet reads only these tokens and the stage's layout attribute; a card keeps the pager's three lines.
  const section = css.slice(css.indexOf('/* ==== stage narration ===='), css.indexOf('/* ==== end stage narration ==== */'))
  assert.match(section, /\[data-narration-layout="screen"\] \.dsh-tavern-stage-figures::after \{[^}]*inset: -100vmax;[^}]*background: rgb\(var\(--art-nar-veil-rgb\) \/ var\(--art-nar-veil\)\); \}/)
  assert.match(section, /\[data-narration-layout="band"\][^{]*\{[^}]*bottom: calc\(var\(--art-nar-band-bottom\) \* var\(--nar-u\)\)[^}]*background: rgb\(var\(--art-nar-veil-rgb\) \/ var\(--art-nar-band-veil\)\)/)
  assert.match(section, /--gal-skin-fg: var\(--art-nar-ink\);[^}]*text-shadow: var\(--art-nar-halo\);/)
  assert.match(section, /max-height: calc\(3 \* var\(--nar-fs\) \* var\(--nar-pitch\) \/ var\(--nar-font\)\)/)
  assert.doesNotMatch(section, /data-fk-skin="/, 'no skin id')
})

test('a narration card comes in line by line on the skin\'s fade and stagger, and is typed once its last line has faded in', () => {
  const page = load(), { runner, time } = page
  let done = 0
  const props = { text: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯', lines: narration.lines, speed: 28, onDone: () => done++ }
  let out = runner.render(page.TavernStageNarrationLines, props)
  assert.deepEqual(out.children.map(text), ['一二三四五六七八九十', '甲乙丙丁戊己庚辛壬癸', '子丑寅卯'], 'one element per visual line')
  assert.equal(out.props.className, 'dsh-tavern-stage-type dsh-tavern-stage-lines')
  assert.deepEqual(out.children.map(line => [line.props.style['--nar-delay'], line.props.style['--nar-fade'], line.props.style['--nar-rise']]),
    [['0s', '0.7s', 'calc(30 * var(--nar-u))'], ['0.9s', '0.7s', 'calc(30 * var(--nar-u))'], ['1.8s', '0.7s', 'calc(30 * var(--nar-u))']])
  assert.equal(out.props['data-typed'], undefined)
  time.run(2400); out = runner.render(page.TavernStageNarrationLines, props)
  assert.deepEqual([done, out.props['data-typed']], [0, undefined], 'the last line is still fading in')
  time.run(100); out = runner.render(page.TavernStageNarrationLines, props)
  assert.deepEqual([done, out.props['data-typed']], [1, ''], 'typed at 1.8 + 0.7 s')
  // A click finishes a card at once: every line shown, no animation.
  const other = load(), quick = { ...props, onDone: () => done++ }
  other.runner.render(other.TavernStageNarrationLines, quick); other.time.run(500)
  out = other.runner.render(other.TavernStageNarrationLines, { ...quick, instant: true })
  assert.deepEqual([out.props['data-instant'], out.props['data-typed'], done], ['', '', 2])
  runner.unmount(); other.runner.unmount()
})

test('a line break ends its line; 文字速度 0 and reduced motion show the card at once', () => {
  const page = load()
  const out = page.runner.render(page.TavernStageNarrationLines, { text: '雨停了。\n她推开门。', lines: { fade: .5, stagger: .5 }, speed: 28 })
  assert.deepEqual(out.children.map(text), ['雨停了。\n', '她推开门。'], 'the break stays in the card\'s one flow')
  assert.equal(out.children[0].props.style['--nar-rise'], 'calc(0 * var(--nar-u))', 'no rise by default')
  for (const [options, props] of [[{}, { speed: 0 }], [{ reduced: true }, { speed: 28 }]]) {
    const at = load(options)
    let done = 0
    const shown = at.runner.render(at.TavernStageNarrationLines, { text: '一二三四五六七八九十甲乙', lines: narration.lines, onDone: () => done++, ...props })
    assert.deepEqual([shown.props['data-instant'], shown.props['data-typed'], done, shown.children.length], ['', '', 1, 2])
  }
})

test('the stage wires one reader per page: lines for a narration page of a skin that declares them, the typewriter otherwise', () => {
  const source = client('features/stage-runtime.js')
  assert.match(source, /const typer = beat && beat\.kind === "narration" && props\.narrationLines \? TavernStageNarrationLines : TavernStageTypewriter;/)
  assert.match(source, /h\(typer, \{ key: props\.visit, text: props\.card \?\? beat\.text,[^}]*lines: props\.narrationLines, instant: props\.typed, onDone: props\.onTyped \}\)/)
  assert.match(source, /stageNarrationLayout\(\{ narration, beat: beats\[reader\.index\], skipping, mode: reader\.mode,/)
  assert.match(source, /"data-narration-layout": narrationLayout,/)
})
