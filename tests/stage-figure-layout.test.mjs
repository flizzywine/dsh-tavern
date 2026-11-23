// Stage figure layout and camera: default slots, the default framing, the phone cap, shared framing, head
// centring, and the handheld frame rate / resolution.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const scale = require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-scale.cjs')
const {createStageSceneMath} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/scene-math.cjs')
const {galResolution} = require('../tavern-plugin/shared/canvas-resolution.cjs')
const {stageSkinFigures} = require('../tavern-plugin/src/client/gal-stage-helpers.cjs')
const {galFigureLayout: layout, galSlots, galCentredAnatomy, galFrameRate, GAL_FIGURE_FIT: FIT, GAL_DEFAULT_FRAMING: DEFAULT} =
  createStageSceneMath({colorMath: require('../tavern-plugin/shared/color-math.cjs'), figureScale: scale})

const CAST = ['madoka', 'homura', 'mami', 'kyoko']

test('portrait draws the speaker alone at the lone size unless the skin declares phoneFigures', () => {
  for (const [W, H] of [[390, 844], [360, 640]]) for (let n = 1; n <= 4; n++) {
    const cast = CAST.slice(0, n), speaker = cast[n - 1], name = `${W}x${H} n=${n}`
    const r = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast, priority: [speaker]})
    const alone = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast: [speaker], priority: [speaker]})
    assert.deepEqual(r, alone, name)
    assert.deepEqual(r.x, {[speaker]: 0.5}, name)
    assert.ok(alone.head * FIT.bodyHeads <= W + 1e-6, name + ': fits the width')
    const two = layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast, priority: [speaker], phone: 2})
    assert.equal(two.count, Math.min(n, 2), name)
    assert.deepEqual([two.fit, two.head], [alone.fit, alone.head], name + ': the lone size')
    assert.equal(layout({W, H, boxTop: H * 0.78, hMax: 158, groundRatio: 0.99, cast, priority: [speaker], phone: 3, max: 1}).count, 1, name + ': maxFigures caps it')
  }
  assert.deepEqual(stageSkinFigures(undefined).phone, 1)
  assert.deepEqual(stageSkinFigures({phoneFigures: 2}).phone, 2)
  // A bust-window skin has no bust on a phone: there the speaker stands at the default framing.
  const bust = {figures: {mode: 'none', scale: 2}, art: {portrait: {bust: {}}}}
  assert.deepEqual([stageSkinFigures(bust).shown, stageSkinFigures(bust, true).shown, stageSkinFigures(bust, true).framing], [false, true, undefined])
})

// The default slots: equal gaps, half a gap from each edge for 2-3 figures, 0.7 of a gap for 4.
const SLOTS = { 2: [0.25, 0.75], 3: [1 / 6, 0.5, 5 / 6], 4: [0.1591, 0.3864, 0.6136, 0.8409] }
const near = (actual, expected, name) => { assert.equal(actual.length, expected.length, name); actual.forEach((x, i) => assert.ok(Math.abs(x - expected[i]) < 1e-4, `${name} #${i}: ${x} != ${expected[i]}`)) }

// Space the cast by measured widths rather than shrink it: figures of widths
// 50, 50, 100 as boxes on a 16:9 screen, the gaps between them as large as possible and a margin to each edge. The
// measured pictures stand where their widths need, in stage order: with room, the pictures clear by one equal gap and
// the outer ones half a gap from the edges, at the full size; without, the cast shrinks only as far as the faces need
// (every face clear of its neighbours' pictures, whichever way anyone turns, and half a face from the edges) - never
// less than standing on the fixed slots would allow.
test('measured pictures stand by their widths: equal gaps and edge margins at full size, shrinking only when faces need it', () => {
  const W = 1920, H = 1080, ids = ['a', 'b', 'c', 'd']
  const cmOf = { a: 160, b: 170, c: 180, d: 175 }, sizes = Object.fromEntries(ids.map(id => [id, { cm: cmOf[id], ground: 1 }]))
  const run = (cast, widths, extra = {}) => {
    const r = layout({ W, H, boxTop: H * 0.78, hMax: 180, groundRatio: 1, cast, priority: [cast[0]], sizes, widths, ...extra })
    const body = id => scale.figureDisplayCm(sizes[id].cm, 180) * scale.figurePixelsPerCm(H, 180) * r.fit
    const px = id => ({ x: r.x[id] * W, left: widths[id].left * body(id), right: widths[id].right * body(id),
      reach: Math.max(widths[id].left, widths[id].right) * body(id), face: widths[id].face * body(id) })
    return { r, px }
  }
  const slim = { left: 0.14, right: 0.14, face: 0.065 }
  const checkFaces = (cast, { r, px }, name) => {
    const p = cast.map(px)
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], gap = b.x - a.x
      assert.ok(gap + 1e-6 >= a.reach + b.face && gap + 1e-6 >= b.reach + a.face, `${name}: ${cast[i - 1]} / ${cast[i]} faces clear`)
    }
    const first = p[0], last = p[p.length - 1]
    assert.ok(first.x - first.face * 2 >= -1e-6 && W - last.x - last.face * 2 >= -1e-6, `${name}: half a face of margin at both edges`)
    assert.deepEqual(r.visible, cast, name + ': stage order kept')
  }
  // Equal widths: exactly the default slots, whatever the count.
  for (let n = 2; n <= 4; n++) {
    const cast = ids.slice(0, n), widths = Object.fromEntries(cast.map(id => [id, slim]))
    const same = layout({ W, H, boxTop: H * 0.78, hMax: 180, groundRatio: 1, cast, priority: [cast[0]], sizes: Object.fromEntries(cast.map(id => [id, { cm: 180, ground: 1 }])), widths })
    near(cast.map(id => same.x[id]), SLOTS[n], 'equal widths n=' + n); assert.equal(same.fit, DEFAULT.scale)
  }
  // The owner's 50 / 50 / 100: full size; the broad one gets the room its picture needs; the pictures clear by one equal gap,
  // half of it at the edges.
  {
    const box = { left: 0.08, right: 0.08, face: 0.06 }, cast = ['a', 'b', 'c'], widths = { a: box, b: box, c: { left: 0.16, right: 0.16, face: 0.065 } }, out = run(cast, widths), p = cast.map(out.px)
    assert.equal(out.r.fit, DEFAULT.scale, 'room enough: unshrunk')
    const gaps = [p[1].x - p[1].left - p[0].x - p[0].right, p[2].x - p[2].left - p[1].x - p[1].right]
    assert.ok(gaps[0] > 0 && Math.abs(gaps[0] - gaps[1]) < 0.5, 'one equal gap between pictures: ' + gaps)
    assert.ok(Math.abs(p[0].x - p[0].left - gaps[0] / 2) < 0.5 && Math.abs(W - p[2].x - p[2].right - gaps[0] / 2) < 0.5, 'half a gap at the edges')
    assert.ok(out.r.x.c - out.r.x.b > out.r.x.b - out.r.x.a, 'the broad one stands farther from its neighbour')
    checkFaces(cast, out, '50/50/100')
  }
  // A picture reaching one way (a weapon held out): the gap is measured on the sides that face each other.
  {
    const cast = ['a', 'b'], widths = { a: { left: 0.08, right: 0.3, face: 0.06 }, b: { left: 0.09, right: 0.09, face: 0.06 } }, out = run(cast, widths), p = cast.map(out.px)
    assert.equal(out.r.fit, DEFAULT.scale)
    const gap = p[1].x - p[1].left - p[0].x - p[0].right
    assert.ok(Math.abs(p[0].x - p[0].left - gap / 2) < 0.5 && Math.abs(W - p[1].x - p[1].right - gap / 2) < 0.5, 'equal gap from the drawn sides')
    checkFaces(cast, out, 'one-sided')
  }
  // Too broad to clear: the pictures overlap but no face is covered, at a larger size than the fixed slots allowed.
  for (const [name, cast, widths] of [
    ['broad pair + slim', ['a', 'b', 'c'], { a: slim, b: { left: 0.5, right: 0.5, face: 0.08 }, c: { left: 0.45, right: 0.45, face: 0.08 } }],
    ['four, one broad', ['a', 'b', 'c', 'd'], { a: slim, b: slim, c: { left: 0.55, right: 0.55, face: 0.08 }, d: slim }]
  ]) {
    const out = run(cast, widths, { max: 4 })
    assert.equal(out.r.count, cast.length, name)
    checkFaces(cast, out, name)
    const slots = galSlots(cast.length), body1 = id => scale.figureDisplayCm(sizes[id].cm, 180) * scale.figurePixelsPerCm(H, 180) * DEFAULT.scale
    const reach = id => Math.max(widths[id].left, widths[id].right) * body1(id), face = id => widths[id].face * body1(id)
    let fixed = DEFAULT.scale
    for (let i = 1; i < cast.length; i++) fixed = Math.min(fixed, DEFAULT.scale * W * (slots[i] - slots[i - 1]) / Math.max(reach(cast[i - 1]) + face(cast[i]), reach(cast[i]) + face(cast[i - 1])))
    assert.ok(out.r.fit > fixed + 1e-6 || out.r.fit === DEFAULT.scale, `${name}: ${out.r.fit} larger than on the fixed slots ${fixed}`)
  }
})
