import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { BUILTIN_STAGE_SKINS, skinContrast, stageSkinFiles, stageSkinImageOf, stageSkinSliceEdges, validateStageSkin } from '../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs'

// The stage's three type roles (body, name, ui): a skin's own faces or font library families, then the stage's stack.
const source = readFileSync(new URL('../tavern-plugin/src/client/features/stage-skin.js', import.meta.url), 'utf8')
const librarySource = readFileSync(new URL('../tavern-plugin/src/client/features/font-library.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const effects = []
const fonts = { added: [], deleted: [], add(face) { this.added.push(face) }, delete(face) { this.deleted.push(face) } }
class FontFace {
  constructor(family, src, descriptors) { Object.assign(this, { family, src, descriptors }) }
  load() { return Promise.resolve(this) }
}
const head = []
const document = { fonts, head: { appendChild(node) { head.push(node) } }, createElement: () => ({ dataset: {}, text: '', append(text) { this.text += text } }) }
const rpcCalls = []
const library = [
  { id: 'noto-sans-sc', family: 'Tavern noto-sans-sc', files: [{ weight: 400, style: 'normal', format: 'woff2', url: '/api/dsh-tavern/fonts/noto-sans-sc/400-0123456789abcdef.woff2' }, { weight: 700, style: 'normal', format: 'woff2', url: '/api/dsh-tavern/fonts/noto-sans-sc/700-0123456789abcdef.woff2' }] },
  { id: 'neo-xihei-screen', family: 'Tavern neo-xihei-screen', files: [{ weight: 400, style: 'normal', format: 'truetype', url: '/api/dsh-tavern/fonts/neo-xihei-screen/LXGWNeoXiHeiScreen.ttf' }] }
]
const React = { useEffect(fn) { effects.push(fn) }, useSyncExternalStore: (subscribe, get) => get() }
const interpreter = vm.runInNewContext(librarySource + '\n' + source + '; ({ stageSkinRoot, useStageSkinFonts, tavernFontLibrary })',
  { skinContrast, stageSkinImageOf, stageSkinSliceEdges, React, FontFace, document, console, rpc: method => { rpcCalls.push(method); return Promise.resolve({ fonts: library }) } })
const minimal = { schema: 'dsh.skin/1', id: 'sample-type', label: '示例', textbox: { paint: { bg: '#101418', fg: '#f2f2f2', accent: '#7fd0ff' } },
  nameplate: { shape: 'plain', paint: { bg: '#101418', fg: '#f2f2f2' } }, font: {}, textFx: { reveal: 'type' } }
const skin = font => validateStageSkin({ ...structuredClone(minimal), font })
const stack = '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
const roles = (document, list = library) => Object.fromEntries(Object.entries(interpreter.stageSkinRoot(document, list).style)
  .filter(([name]) => name.startsWith('--gal-skin-font-')).map(([name, value]) => [name.slice('--gal-skin-font-'.length), value]))
const all = value => ({ body: value, name: value, ui: value })

test('no usable font: every role is the stage\'s stack; 经典 is 霞鹜新晰黑 from the library', () => {
  assert.deepEqual(roles(skin({})), all(stack))
  assert.deepEqual(roles(skin({ body: 'zcool-kuaile', ui: 'wenkai-screen' })), all(stack), 'ids the library does not have')
  assert.deepEqual(BUILTIN_STAGE_SKINS.classic.font, { body: 'neo-xihei-screen', film: 'neo-xihei-screen' })
  assert.deepEqual(roles(BUILTIN_STAGE_SKINS.classic), all('"Tavern neo-xihei-screen", ' + stack))
  assert.deepEqual(roles(BUILTIN_STAGE_SKINS.classic, []), all(stack), 'until the library is listed')
})

test('name and ui follow body unless their own id resolves; a face comes before a library family of the same id', () => {
  const faces = { 'sample-serif': { file: 'fonts/sample-serif.woff2', weight: 500, fallback: 'noto-sans-sc' }, 'neo-xihei-screen': { file: 'fonts/own.woff2', weight: 700 } }
  const document = skin({ body: 'sample-serif', name: 'neo-xihei-screen', ui: 'missing-font', faces })
  assert.deepEqual(roles(document), { body: '"DSH Skin sample-serif", "Tavern noto-sans-sc", ' + stack, name: '"DSH Skin neo-xihei-screen", ' + stack,
    ui: '"DSH Skin sample-serif", "Tavern noto-sans-sc", ' + stack })
  assert.deepEqual(roles(document, []), { body: '"DSH Skin sample-serif", ' + stack, name: '"DSH Skin neo-xihei-screen", ' + stack, ui: '"DSH Skin sample-serif", ' + stack }, 'a fallback the library lacks is skipped')
  assert.deepEqual(stageSkinFiles(document), ['fonts/sample-serif.woff2', 'fonts/own.woff2'], 'the faces ship with the skin entry')
  assert.deepEqual(roles(skin({ body: 'missing-font', name: 'noto-sans-sc' })), { body: stack, name: '"Tavern noto-sans-sc", ' + stack, ui: stack })
})

test('the stage css draws each role from its token, the root and its controls in ui', () => {
  const block = css.slice(css.indexOf('/* ==== stage skin: fonts ===='), css.indexOf('/* ==== end stage skin: fonts ==== */')).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = Object.fromEntries([...block.matchAll(/([^{}]+)\{\s*font-family:\s*var\(--gal-skin-font-(\w+)\);\s*\}/g)].map(match => [match[2], match[1].trim()]))
  assert.deepEqual(rules, { ui: '.dsh-tavern-stage-overlay, .dsh-tavern-stage-overlay :is(button, input, textarea, select)',
    name: '.dsh-tavern-stage-overlay :is(.dsh-tavern-stage-name, .dsh-tavern-stage-side-name)', body: '.dsh-tavern-stage-overlay .dsh-tavern-stage-text' })
  assert.equal(css.replace(css.slice(css.indexOf('/* ==== stage skin: fonts ===='), css.indexOf('/* ==== end stage skin: fonts ==== */')), '').includes('--gal-skin-font-'), false, 'no other rule reads the roles')
})

test('the library is listed once; a used family joins the page once, at every weight it has', async () => {
  const api = interpreter.tavernFontLibrary
  assert.equal(api.fonts().length, 0)
  await Promise.all([api.load(), api.load()])
  assert.deepEqual(rpcCalls, ['listFonts'])
  assert.equal(api.fonts().length, 2)
  api.ensure('noto-sans-sc'); api.ensure('noto-sans-sc'); api.ensure('not-installed')
  assert.equal(head.length, 1)
  assert.equal(head[0].text, '@font-face{font-family:"Tavern noto-sans-sc";src:url("/api/dsh-tavern/fonts/noto-sans-sc/400-0123456789abcdef.woff2") format("woff2");font-weight:400;font-style:normal;font-display:swap}\n' +
    '@font-face{font-family:"Tavern noto-sans-sc";src:url("/api/dsh-tavern/fonts/noto-sans-sc/700-0123456789abcdef.woff2") format("woff2");font-weight:700;font-style:normal;font-display:swap}\n')
})

test('the stage loads what its roles name: library families once, the skin\'s faces from its lease while it is on stage', () => {
  const document = skin({ body: 'sample-serif', name: 'neo-xihei-screen', faces: { 'sample-serif': { file: 'fonts/sample.serif.woff2', weight: 600, fallback: 'noto-sans-sc' } } })
  effects.length = 0; fonts.added.length = 0; fonts.deleted.length = 0
  interpreter.useStageSkinFonts({ document, base: '/lease/abc/skin/' }, document, library)
  const [families, faces] = effects.map(effect => effect())
  assert.equal(families, undefined)
  assert.match(head[0].text, /Tavern neo-xihei-screen.*LXGWNeoXiHeiScreen\.ttf"\) format\("truetype"\)/, 'the name\'s original TrueType family joined the page')
  assert.equal(head[0].text.match(/Tavern noto-sans-sc/g).length, 2, 'the face\'s fallback was already there: not written again')
  assert.equal(fonts.added.length, 1)
  const [face] = fonts.added
  assert.equal(face.family, 'DSH Skin sample-serif')
  assert.equal(face.src, 'url("/lease/abc/skin/fonts/sample.serif.woff2") format("woff2")')
  assert.deepEqual({ ...face.descriptors }, { weight: '600', display: 'swap' })
  faces()
  assert.deepEqual(fonts.deleted, [face])
  effects.length = 0
  interpreter.useStageSkinFonts(null, BUILTIN_STAGE_SKINS.classic, library)
  assert.deepEqual(effects.map(effect => effect()), [undefined, undefined], '经典: no lease, nothing to load but its library family')
})
