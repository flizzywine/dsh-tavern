import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { BUILTIN_STAGE_SKINS, skinContrast, stageSkinImageOf, stageSkinSliceEdges, validateStageSkin } from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

const interpreter = vm.runInNewContext(readFileSync(new URL('../tavern-plugin/src/client/features/stage-skin.js', import.meta.url), 'utf8')
  + '; ({ stageSkinTokens, stageSkinQuickMenu, stageSkinPanelTokens, stageSkinRoot, stageSkinArt, stageSkinArtImages, stageSkinImages, stageSkinControlIcons })', { skinContrast, stageSkinImageOf, stageSkinSliceEdges })
const schema = JSON.parse(readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/schema/skin.schema.json', import.meta.url), 'utf8'))
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const classic = BUILTIN_STAGE_SKINS.classic
const minimal = { schema: 'dsh.skin/1', id: 'sample-min', label: '示例', textbox: { paint: { bg: '#101418', fg: '#f2f2f2', accent: '#7fd0ff' } },
  nameplate: { shape: 'plain', paint: { bg: '#101418', fg: '#f2f2f2' } }, font: {}, textFx: { reveal: 'type' } }
const skin = patch => ({ ...structuredClone(minimal), ...patch })
const rejects = (document, code = 'INVALID_SKIN') => assert.throws(() => validateStageSkin(document), error => error.code === code, JSON.stringify(document).slice(0, 160))
// An art layer with every image the checks need; the images are names only, the contract never loads them.
const art = extra => ({ screen: 1080, screenWidth: 1920, textbox: { images: { plain: 'art/box.svg' }, body: [0, 0, 1800, 260], bottom: 20, text: [80, 1720, 130], font: 40, lines: 3 }, ...extra })
const frame = extra => ({ left: 40, bottom: 40, size: 240, frame: { image: 'art/frame.svg', left: 20, bottom: 20, ...extra } })

test('经典 is an ordinary dsh.skin/1 document, and so is the smallest document a designer can write', () => {
  assert.deepEqual(Object.keys(BUILTIN_STAGE_SKINS), ['classic', 'gothic', 'magical', 'crt', 'aero'])
  assert.equal(validateStageSkin(classic), classic)
  assert.equal(classic.label, '经典')
  assert.deepEqual(classic.font, { body: 'neo-xihei-screen', film: 'neo-xihei-screen' }, 'the font library\'s 霞鹜新晰黑')
  assert.equal(validateStageSkin(minimal), minimal)
})

test('the document is closed: unknown fields, ids, words and ranges reject the whole skin', () => {
  rejects({ ...minimal, css: 'body{}' })
  rejects(skin({ textbox: { paint: minimal.textbox.paint, url: 'https://example.invalid' } }))
  rejects(skin({ id: 'Not An Id' }))
  rejects(skin({ textbox: { layout: 'window', paint: minimal.textbox.paint } }))
  rejects(skin({ nameplate: { shape: 'plain', paint: minimal.nameplate.paint, rotate: 9 } }))
  rejects(skin({ textFx: { reveal: 'type', cps: 400 } }))
  for (const key of ['schema', 'id', 'label', 'textbox', 'nameplate', 'font', 'textFx']) { const missing = skin(); delete missing[key]; rejects(missing) }
  rejects(skin({ label: 'x'.repeat(40000) }))
})

test('readability is part of the contract: unsafe text pairs, a light scrim and ornaments over the text are refused', () => {
  rejects(skin({ textbox: { paint: { bg: '#101418', fg: '#303438' } } }), 'SKIN_CONTRAST')
  rejects(skin({ nameplate: { shape: 'plain', paint: { bg: '#ffffff', fg: '#eeeeee' } } }), 'SKIN_CONTRAST')
  rejects(skin({ quickMenu: { bg: '#000000', fg: '#111111' } }), 'SKIN_CONTRAST')
  rejects(skin({ textbox: { layout: 'scrim', paint: { bg: '#808080', fg: '#000000' } } }), 'SKIN_CONTRAST')
  rejects(skin({ textbox: { layout: 'bubble', paint: { bg: '#707070', fg: '#ffffff' } } }), 'SKIN_CONTRAST')
  validateStageSkin(skin({ textbox: { paint: { bg: '#707070', fg: '#ffffff' } } }))
  rejects(skin({ textbox: { paint: minimal.textbox.paint, frame: { top: { pattern: 'dots', colors: ['#7fd0ff'], height: 22, offset: 20 }, insets: [24, 40, 40, 40] } } }), 'SKIN_GEOMETRY')
  validateStageSkin(skin({ textbox: { layout: 'scrim', paint: { bg: '#050505', fg: '#f2f2f2' } } }))
})

test('one slice shape on every slicing slot and one frames shape on every playing slot', () => {
  for (const slice of [[8, 12, 8, 12], { edges: [8, 12, 8, 12] }]) {
    validateStageSkin(skin({ art: art({ textbox: { ...art().textbox, slice } }) }))
    validateStageSkin(skin({ art: art({ nameplate: { x: 0, y: 0, h: 60, font: 32, image: 'art/plate.svg', slice, grow: 200, pad: [16, 16] } }) }))
    validateStageSkin(skin({ art: art({ choices: { images: { plain: 'art/bar.svg' }, slice, text: [20, 400, 30], font: 32, pitch: 40, gap: 8, anchor: 'above-box' } }) }))
  }
  rejects(skin({ art: art({ nameplate: { x: 0, y: 0, h: 60, font: 32, slice: [8, 8, 8, 8] } }) }))
  rejects(skin({ art: art({ nameplate: { x: 0, y: 0, h: 60, font: 32, image: 'art/plate.svg', grow: 200 } }) }))
  const frames = { columns: 4, rows: 2, count: 6, fps: 12, loop: false }
  validateStageSkin(skin({ art: art({ textbox: { ...art().textbox, cue: [900, 40, 40], next: { image: 'art/next.png', frames } } }) }))
  validateStageSkin(skin({ art: art({ textbox: { ...art().textbox, lamp: { image: 'art/lamp.png', x: 10, y: 10, frames } } }) }))
  rejects(skin({ art: art({ textbox: { ...art().textbox, lamp: { image: 'art/lamp.png', x: 10, y: 10, frames, motion: 'blink' } } }) }))
  rejects(skin({ art: art({ textbox: { ...art().textbox, next: { image: 'art/next.png', frames: { columns: 1, rows: 1, fps: 12 } } } }) }))
})

test('the portrait frame and the control row are generic parts: fill, a legible name on the frame, phone places', () => {
  for (const fill of ['#203040', ['#304050', '#102030']]) validateStageSkin(skin({ art: art({ portrait: frame({ round: true, front: true, back: 'art/back.svg', fill }) }) }))
  const name = { arc: [160, 200, 120], span: 80, font: 30, min: 14, ink: ['#f0e8d0', '#c8b080'], stroke: { color: '#201810', width: 2 }, shadow: { color: '#000000', dy: 2 }, bed: { color: '#000000', alpha: .4 } }
  validateStageSkin(skin({ art: art({ portrait: { ...frame({ name }), narrow: { width: 96, x: 8, y: -40, name: 'arc', nameMin: 10, flow: 'wrap' } } }) }))
  rejects(skin({ art: art({ portrait: frame({ name: { ...name, min: 40 } }) }) }))
  rejects(skin({ art: art({ portrait: { ...frame(), narrow: { width: 96, x: 8, y: -40, name: 'below' } } }) }))
  validateStageSkin(skin({ quickMenu: { bg: '#101418', fg: '#f2f2f2', place: 'box-top-right', narrow: 'edge' } }))
  rejects(skin({ quickMenu: { bg: '#101418', fg: '#f2f2f2', narrow: 'top' } }))
  rejects(skin({ quickMenu: { bg: '#101418', fg: '#f2f2f2', button: { normal: 'art/button.svg', glyph: [.2, .2, .6, .6] } } }))
})

test('the shared contract accepts extension containers and rejects malformed ones', () => {
  for (const extra of [{ levels: { default: 1, 1: {} } }, { mods: {} }, { assets: {} }]) validateStageSkin(skin(extra))
  for (const extra of [{ levels: { default: 4 } }, { levels: { default: 1 } }, { overlay: {} }, { overlay: [] }, { mods: [] }, { assets: { unsafe: '../image.png' } }]) rejects(skin(extra))
})

test('the interpreter reads 经典 like any skin: paint, plate, rings and readable control chips', () => {
  const tokens = interpreter.stageSkinTokens(classic)
  assert.equal(tokens['--gal-skin-bg'], '#0c0a14')
  assert.equal(tokens['--gal-skin-fg'], '#f5f2fa')
  assert.equal(tokens['--gal-skin-border'], '#bcb8c6')
  assert.equal(tokens['--gal-skin-radius'], '10px')
  assert.equal(tokens['--gal-skin-name-radius'], '2px')
  assert.equal(tokens['--gal-skin-rings'], 'none')
  for (const chip of ['--gal-skin-qm-hover', '--gal-skin-qm-active']) assert.ok(skinContrast(tokens['--gal-skin-qm-on'], tokens[chip]) >= 3, chip)
  assert.ok(skinContrast(tokens['--gal-skin-qm-idle'], tokens['--gal-skin-bg']) >= 3)
  assert.ok(skinContrast(tokens['--gal-ui-accent'], tokens['--gal-ui-surface']) >= 4.5)
  assert.ok(skinContrast(tokens['--gal-ui-accent-ink'], tokens['--gal-ui-accent']) >= 4.5)
  const root = interpreter.stageSkinRoot(classic)
  assert.equal(root['data-fk-skin'], 'classic')
  // The root adds the three font roles (tests/stage-skin-fonts.test.mjs).
  assert.deepEqual(Object.fromEntries(Object.entries(root.style).filter(([name]) => !name.startsWith('--gal-skin-font-'))), { ...tokens })
})

test('another document changes the look through the same tokens, never through a skin id', () => {
  const pill = skin({ textbox: { paint: { bg: '#fff8f0', fg: '#3a2010', fgMuted: '#6a5040', accent: '#a03010' }, shape: { radius: 0, borderWidth: 3, rings: [{ width: 2, color: '#a03010' }, { width: 3, color: '#3a2010' }] } },
    nameplate: { shape: 'pill', paint: { bg: '#a03010', fg: '#ffffff' }, rotate: -2 }, textStyle: { weight: 700, lineHeight: 1.5, letterSpacing: .05 }, quickMenu: { bg: '#fff8f0', fg: '#3a2010' } })
  validateStageSkin(pill)
  const tokens = interpreter.stageSkinTokens(pill)
  assert.equal(tokens['--gal-skin-rings'], '0 0 0 2px #a03010,0 0 0 5px #3a2010')
  assert.equal(tokens['--gal-skin-name-radius'], '99px')
  assert.equal(tokens['--gal-skin-name-rotate'], '-2deg')
  assert.equal(tokens['--gal-skin-border-width'], '3px')
  assert.equal(tokens['--gal-skin-weight'], '700')
  assert.equal(tokens['--gal-skin-qm-idle'], '#3a2010')
  assert.equal(tokens['--gal-ui-accent'], '#a03010')
})

test('textFx draws the glyphs\' entrance: its flash ink, the side a stamp drops from and the skin\'s own poses as tokens', () => {
  const plain = interpreter.stageSkinTokens(classic)
  assert.deepEqual([plain['--gal-skin-flash'], plain['--gal-skin-stamp-y'], Object.keys(plain).some(key => key.startsWith('--gal-hop-'))], ['#f5f2fa', '-16px', false])
  const posed = skin({ textStyle: { emphasis: '#7fd0ff' }, textFx: { reveal: 'stamp', from: 'bottom', poses: [{ dy: -.2, rot: 4, scale: 1.1, blur: .1, ink: 'flash' }, { sx: .9, skew: 3, ink: 'accent' }] } })
  validateStageSkin(posed)
  const tokens = interpreter.stageSkinTokens(posed)
  assert.equal(tokens['--gal-skin-flash'], '#7fd0ff', 'no flash: the emphasis ink')
  assert.equal(tokens['--gal-skin-stamp-y'], '16px')
  assert.equal(tokens['--gal-hop-0-t'], 'translate(0em, -0.2em) rotate(4deg) scale(1.1, 1.1) skewX(0deg)')
  assert.deepEqual([tokens['--gal-hop-0-f'], tokens['--gal-hop-0-c'], tokens['--gal-hop-1-f'], tokens['--gal-hop-1-c']], ['blur(0.1em)', 'var(--gal-skin-flash)', 'none', 'var(--gal-skin-accent)'])
  assert.equal(tokens['--gal-hop-1-t'], 'translate(0em, 0em) rotate(0deg) scale(0.9, 1) skewX(3deg)')
  assert.equal(interpreter.stageSkinTokens(skin({ textFx: { reveal: 'ink', flash: '#ffd27f' } }))['--gal-skin-flash'], '#ffd27f')
  // Every reveal the contract accepts has its poses in the stylesheet, and the system's reduced motion keeps the steps without them.
  for (const reveal of ['ink', 'pop', 'stutter', 'stamp', 'cut', 'scan', 'scrawl']) assert.match(css, new RegExp('data-skin-reveal="' + reveal + '"\\] \\.dsh-tavern-stage-glyph-paint\\[data-hop="0"\\]'))
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\n  \.dsh-tavern-stage-type\[data-skin-reveal="ink"\]/)
})
test('the stage draws only from skin tokens: no colour of its own on the box, plate, text, controls or choices', () => {
  const rules = css.match(/^\.dsh-tavern-stage-(?:textbox|name|text|controls|choice|wait)[^{]*\{[^}]*\}/gm)
  assert.ok(rules.length >= 10)
  for (const rule of rules) assert.doesNotMatch(rule, /#[\da-f]{3,8}\b|rgba?\(|hsl\(/i, rule)
  assert.match(css, /\.dsh-tavern-stage-textbox \{[^}]*background: var\(--gal-skin-bg\)/)
  assert.match(css, /\.dsh-tavern-stage-choice:has\(> \[data-action="generate"\]\) \{[^}]*background: color-mix\(in srgb, var\(--gal-ui-accent\) 14%, var\(--gal-ui-surface\)\)/)
})

// Consumers use the package schema; schema semantics belong to the package tests.
test('the upstream skin consumer uses the single package JSON Schema', () => {
  assert.equal(schema.$id, 'dsh.skin/1')
  const consumer = readFileSync(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/skin-overlay.cjs', import.meta.url), 'utf8')
  assert.match(consumer, /require\('\.\.\/schema\/skin\.schema\.json'\)/)
  assert.throws(() => readFileSync(new URL('../tavern-plugin/lib/domain/stage-skin.schema.json', import.meta.url)), { code: 'ENOENT' })
})
test('the art layer draws the skin\'s box, plate, cue and lamp from its decoded images, or not at all', () => {
  const document = skin({ art: art({ textbox: { ...art().textbox, images: { plain: 'art/box.png', narration: 'art/narration.png' }, cue: [1700, 230, 40], rise: 6,
    next: { image: 'art/next.png', frames: { columns: 4, rows: 2, count: 6, fps: 12 } }, lamp: { image: 'art/lamp.png', x: 1600, y: 20, frames: { columns: 2, rows: 1, fps: 4, loop: false } } },
    nameplate: { x: 60, y: -40, h: 60, font: 30, image: 'art/plate.png', slice: [10, 20, 10, 20], grow: 300 } }) })
  validateStageSkin(document)
  assert.deepEqual([...interpreter.stageSkinArtImages(document)].sort(), ['art/box.png', 'art/lamp.png', 'art/narration.png', 'art/next.png', 'art/plate.png'])
  const files = { 'art/box.png': { url: '/lease/t/art/box.png', width: 1800, height: 300 }, 'art/narration.png': { url: '/lease/t/art/narration.png', width: 1800, height: 300 },
    'art/next.png': { url: '/lease/t/art/next.png', width: 160, height: 80 }, 'art/lamp.png': { url: '/lease/t/art/lamp.png', width: 100, height: 40 }, 'art/plate.png': { url: '/lease/t/art/plate.png', width: 240, height: 60 } }
  const drawn = interpreter.stageSkinArt(document, files)
  assert.equal(drawn.marks['data-fk-skin-art'], 'box')
  assert.equal(drawn.tokens['--art-plain'], 'url("/lease/t/art/box.png")')
  assert.equal(drawn.tokens['--art-narration'], 'url("/lease/t/art/narration.png")')
  assert.equal(drawn.tokens['--art-screen-w'], '1920')
  // The default phone slice keeps everything outside the three-line block centred on text[2] as drawn.
  assert.equal(drawn.tokens['--art-sl'], '34 80 74 80')
  // next.frames: one cell of the sheet, played through its cells and resting on the first; lamp played once rests on its last.
  assert.equal(drawn.marks['data-fk-skin-art-cue'], 'image')
  assert.deepEqual([drawn.tokens['--art-next-w'], drawn.tokens['--art-next-h'], drawn.tokens['--art-next-sheet'], drawn.tokens['--art-next-rest']], ['40', '40', '400% 200%', '0% 0%'])
  assert.equal(drawn.frames.next.keys.length, 7)
  assert.equal(drawn.frames.next.keys[5].backgroundPosition, '33.333333333333336% 100%')
  assert.equal(drawn.frames.next.ms, 500)
  assert.equal(drawn.marks['data-fk-skin-art-lamp'], 'frames')
  assert.equal(drawn.tokens['--art-lamp-rest'], '100% 0%')
  assert.equal(drawn.frames.lamp.loop, false)
  // The plate image grows along the name, 9-sliced, between pads that default to its own side slices.
  assert.equal(drawn.marks['data-fk-skin-art-name'], 'image')
  assert.deepEqual([drawn.tokens['--art-np-sl'], drawn.tokens['--art-np-grow'], drawn.tokens['--art-np-pad-a'], drawn.tokens['--art-np-pad-b']], ['10 20 10 20', '300', '20', '20'])
  // One missing image drops the whole art layer; a skin without a box art draws none.
  const { 'art/plate.png': _plate, ...partial } = files
  assert.equal(interpreter.stageSkinArt(document, partial), null)
  assert.equal(interpreter.stageSkinArt(document, null), null)
  assert.equal(interpreter.stageSkinArt(minimal, files), null)
  assert.deepEqual([...interpreter.stageSkinArtImages(minimal)], [])
})

test('the stylesheet draws the art layer only from its tokens, and phones keep the reading size over a 9-sliced box', () => {
  const block = css.slice(css.indexOf('/* ==== stage skin: art ===='), css.indexOf('/* ==== end stage skin: art ==== */'))
  assert.ok(block.length > 0)
  assert.doesNotMatch(block, /url\(/, 'images come from the skin tokens')
  assert.match(block, /border-image: var\(--art-plain\) var\(--art-sl\) fill/)
  assert.match(block, /--art-fs: max\(17px,/)
  assert.match(block, /prefers-reduced-motion: no-preference/)
})

test('the face window, the name on its frame and the drawn control row come from the same document and its decoded images', () => {
  const name = { arc: [160, 60, 120], span: 80, font: 30, min: 14, ink: ['#f0e8d0', '#c8b080'], stroke: { color: '#201810', width: 2 }, bed: { color: '#000000', alpha: .4 } }
  const document = skin({ art: art({ textbox: { ...art().textbox, images: { plain: 'art/box.png' }, controls: { x: 1700, y: 20, size: 60, w: 40, gap: 8 } },
    portrait: { ...frame({ image: 'art/frame.png', window: [50, 50, 220, 200], round: true, front: true, glass: 'art/glass.png', speaking: 'art/speaking.png', fill: ['#304050', '#102030'], name }),
      narrow: { width: 96, x: 0, y: -40, name: 'arc', nameMin: 10, flow: 'below', left: 16 } } }),
    quickMenu: { bg: '#101418', fg: '#f2f2f2', place: 'box-top-right', narrow: 'edge', icons: { auto: { image: 'art/auto.svg', on: 'art/auto-on.svg' }, back: { image: 'art/back.svg' } },
      button: { normal: 'art/button.png', hover: 'art/button-hover.png', glyph: [.2, .3, .6, .4] } } })
  validateStageSkin(document)
  assert.deepEqual([...interpreter.stageSkinArtImages(document)].sort(), ['art/box.png', 'art/frame.png', 'art/glass.png', 'art/speaking.png'])
  assert.deepEqual([...interpreter.stageSkinImages(document)].sort(), ['art/auto-on.svg', 'art/auto.svg', 'art/back.svg', 'art/box.png', 'art/button-hover.png', 'art/button.png', 'art/frame.png', 'art/glass.png', 'art/speaking.png'])
  const file = (path, width, height) => [path, { url: '/lease/t/' + path, width, height }]
  const files = Object.fromEntries([file('art/box.png', 1800, 300), file('art/frame.png', 300, 280), file('art/glass.png', 220, 200), file('art/speaking.png', 300, 280),
    file('art/auto.svg', 32, 32), file('art/auto-on.svg', 32, 32), file('art/back.svg', 32, 32), file('art/button.png', 60, 90), file('art/button-hover.png', 60, 90)])
  const root = interpreter.stageSkinRoot(document)
  assert.deepEqual([root['data-fk-skin-controls-place'], root['data-fk-skin-controls-narrow'], root['data-fk-skin-controls-icons']], ['box-top-right', 'edge', ''])
  const drawn = interpreter.stageSkinArt(document, files)
  for (const mark of ['frame', 'round', 'front', 'glass', 'speaking', 'fill', 'name', 'name-stroke']) assert.equal(drawn.marks['data-fk-skin-portrait-' + mark], '', mark)
  assert.equal(drawn.marks['data-fk-skin-portrait'], 'avatar')
  assert.equal(drawn.tokens['--art-face-frame'], 'url("/lease/t/art/frame.png")')
  assert.deepEqual(['fw', 'fh', 'wl', 'wb', 'ww', 'wh'].map(key => drawn.tokens['--art-face-' + key]), ['300', '280', '50', '50', '220', '200'])
  assert.equal(drawn.tokens['--art-face-fill'], 'radial-gradient(closest-side, #304050, #102030 99%, transparent 100%)')
  // The arc in the frame image's own px (y down), and the phone's place and floor.
  assert.deepEqual(JSON.parse(JSON.stringify(drawn.faceName)), { view: [300, 280], x: 140, y: 240, r: 120, span: 80, side: 'bottom', font: 30, ink: ['#f0e8d0', '#c8b080'], weight: 700, spacing: 0,
    engrave: null, stroke: { color: '#201810', width: 2 }, shadow: null, bed: { color: '#000000', alpha: .4, width: 30 }, min: 14, narrowMin: 10 })
  assert.deepEqual([drawn.marks['data-fk-skin-portrait-narrow'], drawn.marks['data-fk-skin-portrait-flow'], drawn.tokens['--art-face-nh'], drawn.tokens['--art-face-nleft']], ['', 'below', '89.6', '16'])
  assert.deepEqual(['x', 'y', 'size', 'w', 'gap'].map(key => drawn.tokens['--art-qc-' + key]), ['1700', '20', '60', '40', '8'])
  // Each drawn control: its icon, its `on` image and the shared button body with its glyph box and aspect.
  const icons = interpreter.stageSkinControlIcons(document, files)
  assert.deepEqual(Object.keys(icons), ['auto', 'back'])
  assert.equal(icons.auto.on, '/lease/t/art/auto-on.svg')
  assert.equal(icons.back.on, null)
  assert.deepEqual(JSON.parse(JSON.stringify(icons.auto.button)), { normal: '/lease/t/art/button.png', hover: '/lease/t/art/button-hover.png', on: null, disabled: null, glyph: [.2, .3, .6, .4], aspect: .6667 })
  // A bust portrait is the scene's, not the face window's; a folded menu has no row to place or draw.
  const bust = skin({ art: art({ screenWidth: 1920, portrait: { left: 0, bottom: 0, size: 200, source: 'bust', bust: { head: [0.5, 0.2] } } }) })
  assert.equal(interpreter.stageSkinArt(bust, { 'art/box.svg': { url: 'u', width: 1800, height: 300 } })?.marks['data-fk-skin-portrait'], undefined)
  const folded = skin({ quickMenu: { ...document.quickMenu, layout: 'orb' } })
  assert.equal(interpreter.stageSkinRoot(folded)['data-fk-skin-controls-place'], undefined)
  assert.deepEqual({ ...interpreter.stageSkinControlIcons(folded, files) }, {})
})

test('the face window and the drawn controls read only their tokens; a phone keeps the side, the lines and 44px targets apart', () => {
  const block = css.slice(css.indexOf('/* ==== stage skin: art portrait ===='), css.indexOf('/* ==== end stage skin: art ==== */'))
  assert.ok(block.length > 0)
  assert.doesNotMatch(block, /url\(/)
  assert.match(block, /\.dsh-tavern-stage-textbox\.is-speaking \.dsh-tavern-stage-side\.is-on::before \{ opacity: 1/)
  assert.match(block, /--art-u: calc\(var\(--art-face-nw\) \* 1px \/ var\(--art-face-nsw\)\)/)
  assert.match(block, /button\.has-icon \{ width: 44px; height: 44px/)
  assert.match(block, /--art-dock-over:/)
})