import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { BUILTIN_STAGE_SKINS, skinContrast, validateStageSkin } from '../tavern-plugin/lib/domain/stage-skin.js'

const interpreter = vm.runInNewContext(readFileSync(new URL('../tavern-plugin/src/client/features/stage-skin.js', import.meta.url), 'utf8')
  + '; ({ stageSkinTokens, stageSkinQuickMenu, stageSkinPanelTokens, stageSkinRoot })', { skinContrast })
const schema = JSON.parse(readFileSync(new URL('../tavern-plugin/lib/domain/stage-skin.schema.json', import.meta.url), 'utf8'))
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
  assert.deepEqual(Object.keys(BUILTIN_STAGE_SKINS), ['classic'])
  assert.equal(validateStageSkin(classic), classic)
  assert.equal(classic.label, '经典')
  assert.deepEqual(classic.font, {}, 'the built-in names no library font')
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

test('performance themes, mod options and skin assets are not part of this document', () => {
  for (const extra of [{ levels: { default: 1 } }, { overlay: {} }, { mods: {} }, { assets: {} }]) rejects(skin(extra))
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
  assert.deepEqual({ ...root.style }, { ...tokens })
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

test('the stage draws only from skin tokens: no colour of its own on the box, plate, text, controls or input', () => {
  const rules = css.match(/^\.dsh-tavern-stage-(?:textbox|name|text|controls|input)[^{]*\{[^}]*\}/gm)
  assert.ok(rules.length >= 10)
  for (const rule of rules) assert.doesNotMatch(rule, /#[\da-f]{3,8}\b|rgba?\(|hsl\(/i, rule)
  assert.match(css, /\.dsh-tavern-stage-textbox \{[^}]*background: var\(--gal-skin-bg\)/)
  assert.match(css, /\.dsh-tavern-stage-input button \{[^}]*background: var\(--gal-ui-accent\)/)
})

// The JSON Schema mirror for editors and tools: a small walker of the keywords it uses.
function schemaAccepts(value, s = schema, path = '$') {
  if (s.$ref) return schemaAccepts(value, s.$ref.slice(2).split('/').reduce((o, k) => o[k], schema), path)
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value
  const ok = (s.type === undefined || [].concat(s.type).some(t => t === type || t === 'number' && type === 'integer'))
    && (!('const' in s) || JSON.stringify(s.const) === JSON.stringify(value)) && (!s.enum || s.enum.some(x => JSON.stringify(x) === JSON.stringify(value)))
    && (typeof value !== 'number' || (s.minimum === undefined || value >= s.minimum) && (s.maximum === undefined || value <= s.maximum))
    && (typeof value !== 'string' || (!s.pattern || new RegExp(s.pattern, 'u').test(value)) && (s.maxLength === undefined || [...value].length <= s.maxLength))
    && (!Array.isArray(value) || (s.minItems === undefined || value.length >= s.minItems) && (s.maxItems === undefined || value.length <= s.maxItems) && (!s.items || value.every(item => schemaAccepts(item, s.items))))
    && (Array.isArray(value) || !value || typeof value !== 'object' || (s.required || []).every(key => Object.hasOwn(value, key))
      && Object.entries(value).every(([key, item]) => Object.hasOwn(s.properties || {}, key) ? schemaAccepts(item, s.properties[key]) : s.additionalProperties === false ? false
        : s.additionalProperties && typeof s.additionalProperties === 'object' ? schemaAccepts(item, s.additionalProperties) : true))
  return ok && (!s.oneOf || s.oneOf.filter(choice => schemaAccepts(value, choice)).length === 1) && (!s.anyOf || s.anyOf.some(choice => schemaAccepts(value, choice)))
}

test('the JSON Schema mirror describes the same document: same fields, the generic parts, the same closed shape', () => {
  assert.equal(schema.$id, 'dsh.skin/1')
  assert.deepEqual(schema.required, ['schema', 'id', 'label', 'textbox', 'nameplate', 'font', 'textFx'])
  assert.deepEqual(Object.keys(schema.properties).sort(), ['art', 'cursor', 'dimListeners', 'effects', 'figureSlots', 'figures', 'font', 'hud', 'id', 'label', 'license', 'maxFigures', 'modes', 'nameplate', 'quickMenu', 'schema', 'sfx', 'photosensitive', 'textFx', 'textStyle', 'textbox', 'ui'].sort())
  const name = { arc: [160, 200, 120], font: 30, min: 14, ink: '#f0e8d0', stroke: { color: '#201810', width: 2 }, shadow: { color: '#000000', dy: 2 }, bed: { color: '#000000', alpha: .4 } }
  const documents = [classic, minimal, skin({ quickMenu: { bg: '#101418', fg: '#f2f2f2', place: 'box-top-right', narrow: 'top' } }),
    skin({ art: art({ textbox: { ...art().textbox, slice: { edges: [8, 8, 8, 8] }, cue: [900, 40, 40], next: { image: 'art/next.png', frames: { columns: 4, rows: 1, fps: 8 } } } }) }),
    skin({ art: art({ portrait: { ...frame({ fill: ['#304050', '#102030'], name }), narrow: { width: 96, x: 8, y: -40, name: 'arc', nameMin: 10 } } }) })]
  for (const document of documents) { validateStageSkin(document); assert.ok(schemaAccepts(document), document.id) }
  for (const document of [{ ...minimal, css: 'x' }, { ...minimal, overlay: {} }, skin({ art: art({ portrait: frame({ fill: 'red' }) }) })]) assert.equal(schemaAccepts(document), false)
})