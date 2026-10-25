// 逐字显示: the glyph steps and pauses (modules/stage-typewriter.js) and the typewriter (features/stage-typewriter.js), on a
// one-component hook runner with a fake clock: no browser.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const client = name => readFileSync(new URL('../tavern-plugin/src/client/' + name, import.meta.url), 'utf8')
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat().filter(child => child !== null && child !== undefined) })
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(text).join('') : ''

// One component, re-rendered after every state change; effects run after a render when their deps changed.
function hookRunner() {
  let slots = [], at = 0, effects = [], dirty = false
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  const React = {
    createElement: h, Fragment: 'Fragment',
    useState(initial) {
      const i = at++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true } }]
    },
    useRef(initial) { const i = at++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useMemo(fn, deps) { const i = at++; if (!(i in slots) || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value },
    useEffect(fn, deps) { const i = at++; const old = slots[i]; if (!old || changed(old.deps, deps)) { effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) } }
  }
  return {
    React,
    render(component, props) {
      let out
      do { dirty = false; at = 0; effects = []; out = component(props); effects.forEach(run => run()) } while (dirty)
      return out
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) }
  }
}
function clock() {
  let now = 0, id = 0
  const timers = new Map()
  return {
    setTimeout(fn, ms) { timers.set(++id, { fn, at: now + ms }); return id },
    clearTimeout(timer) { timers.delete(timer) },
    // Runs the next due timer; returns its delay from the previous time.
    next() {
      const [key, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || []
      if (!timer) return null
      timers.delete(key); const step = timer.at - now; now = timer.at; timer.fn(); return step
    },
    get pending() { return timers.size }
  }
}
function load() {
  const runner = hookRunner(), time = clock()
  const sandbox = { React: runner.React, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout, Intl }
  const api = vm.runInNewContext([client('modules/stage-runtime.js'), client('modules/stage-typewriter.js'), client('features/stage-typewriter.js'),
    '({ stageGlyphs, stageGlyphPause, stageGlyphDelay, TavernStageTypewriter, STAGE_READING_DEFAULTS })'].join('\n;'), sandbox)
  return { ...api, runner, time }
}

test('a glyph is a grapheme; sentence ends, commas and dashes pause, a closing quote carries its sentence end', () => {
  const { stageGlyphs, stageGlyphPause, stageGlyphDelay } = load()
  assert.deepEqual(Array.from(stageGlyphs('e\u0301👍🏽啊')), ['e\u0301', '👍🏽', '啊'], 'a letter with its mark and an emoji with its tone are one step each')
  const line = Array.from(stageGlyphs('她说：“走吧。”然后，……他—'))
  const pause = glyph => stageGlyphPause(line, line.indexOf(glyph))
  assert.equal(pause('说'), 0, 'inside a run of words: no pause, the colon comes next')
  assert.equal(pause('：'), 2)
  assert.equal(stageGlyphPause(line, line.indexOf('。')), 0, 'the sentence end waits behind its closing quote')
  assert.equal(stageGlyphPause(line, line.indexOf('”')), 5, 'the closing quote carries the sentence end')
  assert.equal(stageGlyphPause(line, line.indexOf('，')), 0, 'a run of punctuation pauses once, at its end')
  assert.equal(stageGlyphPause(line, line.lastIndexOf('…')), 5)
  assert.equal(stageGlyphPause(line, line.length - 1), 0, 'nothing waits after the last glyph')
  const latin = Array.from(stageGlyphs('Mr.Smith. Go'))
  assert.deepEqual([stageGlyphPause(latin, 2), stageGlyphPause(latin, 8)], [0, 5], 'a Latin full stop pauses only before a space')
  assert.deepEqual([stageGlyphDelay(line, -1, 20), stageGlyphDelay(line, line.indexOf('：'), 20)], [20, 60])
})

test('the line types glyph by glyph at the reader\'s speed and reports once it is typed', () => {
  const page = load(), { runner, time } = page
  let done = 0
  const props = { text: '好的。走吧', speed: 30, onDone: () => done++ }
  let out = runner.render(page.TavernStageTypewriter, props)
  assert.equal(text(out), '好的。走吧', 'the whole line is laid out from the start')
  assert.equal(out.children.at(-1).props.className, 'dsh-tavern-stage-type-rest')
  assert.equal(out.props['data-typed'], undefined)
  const steps = []
  for (let i = 0; i < 5; i++) { steps.push(time.next()); out = runner.render(page.TavernStageTypewriter, props) }
  assert.deepEqual(steps, [30, 30, 30, 180, 30], 'one step per glyph; the sentence end waits five more')
  assert.equal(out.props['data-typed'], '')
  assert.equal(done, 1)
  assert.ok(out.children.every(child => child.props.className !== 'dsh-tavern-stage-type-rest'), 'nothing is left hidden')
  assert.deepEqual(out.children.map(child => child.props.className), Array(5).fill('dsh-tavern-stage-glyph'), 'the glyphs still fading in are their own elements')
  time.next(); out = runner.render(page.TavernStageTypewriter, props)
  assert.deepEqual(out.children.map(child => [child.props.className, text(child)]), [['dsh-tavern-stage-type-shown', '好的。走吧']], 'once the last glyphs faded in the line is one plain run')
  runner.unmount()
})

test('instant and speed 0 show the whole line at once; finishing mid-line shows the rest', () => {
  const page = load(), { runner } = page
  let done = 0
  const instant = runner.render(page.TavernStageTypewriter, { text: '一句话。', speed: 0, onDone: () => done++ })
  assert.deepEqual([instant.props.className, instant.children.length, text(instant.children[0]), done], ['dsh-tavern-stage-type is-instant', 1, '一句话。', 1])
  const other = load(), props = { text: '慢慢地出现', speed: 40, onDone: () => done++ }
  other.runner.render(other.TavernStageTypewriter, props); other.time.next()
  other.runner.render(other.TavernStageTypewriter, props); other.time.next()
  let out = other.runner.render(other.TavernStageTypewriter, props)
  assert.equal(text(out.children.at(-1)), '地出现')
  assert.ok(out.children.some(child => child.props.className === 'dsh-tavern-stage-type-rest'))
  out = other.runner.render(other.TavernStageTypewriter, { ...props, instant: true })
  assert.deepEqual([out.props['data-typed'], out.children.length, text(out.children[0]), done], ['', 1, '慢慢地出现', 2], 'a click finished it')
})
