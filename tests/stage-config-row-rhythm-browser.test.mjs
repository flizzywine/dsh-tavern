// CONFIG › 声音 in a real browser: the stage's config screen, fields and mixer (config-screen.cjs, config-fields.cjs,
// mixer.cjs) over the stage's theme CSS, at a desktop (1920 x 1080, the wide sheet) and a phone (375 x 812, compact).
// Every row keeps one rhythm and one grid: the gaps between the mixer's rows are equal (总音量 keeps no extra room under
// it). Wide rows align with the mixer grid; compact rows keep the fork's page inset, inline toggle and stacked slider.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const client = name => read('tavern-plugin/packages/dsh-tavern-stage/src/client/' + name)

async function mountSound(page) {
  const [react, theme, stageTheme, fields, mixer, screen] = await Promise.all([browserReactScript(), read('tavern-plugin/lib/client-assets/theme.css'),
    client('themes.css'), client('config-fields.cjs'), client('mixer.cjs'), client('config-screen.cjs')])
  await page.setContent('<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:\'Microsoft YaHei\',sans-serif"><div id="root" class="fork-gal-stage" data-theme="classic" style="position:fixed;inset:0;--fk-s-stage-panel-bgSolid:#1b1726;--fk-s-stage-panel-fgMuted:#b8b1c9;--fk-s-stage-panel-accent:#e59ac0"></div></body></html>')
  await page.addStyleTag({content: theme + '\n' + stageTheme + '\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
  await page.addScriptTag({content: react + '\nwindow.React=modules.react;window.ReactDOMClient=modules["react-dom/client"];\n' + fields + '\n' + mixer + '\n' + screen + `
    const h = React.createElement, none = () => () => {}, sounds = {play() {}}
    const Slider = ({skin, className, label, value, min, max}) => h('div', {className: [skin, className].filter(Boolean).join(' '), style: {'--at': (value - min) / (max - min) * 100 + '%'}},
      h('div', {className: skin + '-track', role: 'slider', tabIndex: 0, 'aria-label': label}, h('div', {className: skin + '-fill', style: {width: 'var(--at)'}}), h('div', {className: skin + '-thumb', style: {left: 'var(--at)'}})))
    const Icon = ({name}) => h('svg', {className: 'fork-icon', 'data-icon': name, width: 20, height: 20})
    const HelpTip = () => h('button', {type: 'button', className: 'fork-help-tip-button'}, '?')
    const fieldKit = createStageConfigFields({React, HelpTip, Segmented: () => null, Slider, ResetButton: () => null, FontPicker: () => null, InlineField: () => null, sounds, classify: () => null})
    const levels = {master: .8, voice: 1, music: .6, sfx: .7, ambience: .5, ui: .4, muted: {}, duck: true}
    const audio = {subscribe: none, getSnapshot: () => levels, toggleMute() {}, setVolume() {}, setDucking() {}}
    const mix = createStageMixer({React, Icon, Slider, audio, sounds, entries: null, report: () => {}, icons: {}, fields: fieldKit})
    const config = createStageConfigScreen({React, window, document, matchMedia: query => window.matchMedia(query), rpc: async () => ({mods: []}), sections: {}, useSounds: () => {}, sounds, Icon,
      Looks: fieldKit.Looks, Sound: mix.Sound, Text: () => null, Appearance: () => null})
    ReactDOMClient.createRoot(document.getElementById('root')).render(h(config.Screen, {sessionId: 's', tests: {}, onClose() {}}))
  `})
  await page.waitForSelector('.fork-gal-config-page[data-tab="sound"] .fork-gal-mix-row[data-layer="ui"]', {state: 'attached', timeout: 5000})
}

function measure() {
  const page = document.querySelector('.fork-gal-config-page'), box = node => node.getBoundingClientRect()
  const middle = node => (box(node).top + box(node).bottom) / 2
  const mix = [...page.querySelectorAll('.fork-gal-mix-row')].map(row => {
    const mute = row.querySelector('.fork-gal-mix-mute'), control = row.querySelector('.fork-gal-mix-slider, .fork-gal-mix-switch')
    return {layer: row.dataset.layer, top: box(row).top, bottom: box(row).bottom, middle: mute ? middle(mute) : null,
      label: box(row.querySelector('.fork-gal-mix-label')).left, control: box(control).left, controlRight: box(control).right, controlMiddle: middle(control), labelMiddle: middle(row.querySelector('.fork-gal-mix-label'))}
  })
  const sheet = box(page)
  return {layout: document.querySelector('.fork-gal-config').dataset.layout, mix, configRows: page.querySelectorAll('.fork-gal-config-row').length, glyphs: page.querySelectorAll('.fork-gal-config-glyph').length,
    inset: sheet.left + parseFloat(getComputedStyle(page).paddingLeft), pageLeft: sheet.left, pageRight: sheet.right}
}

for (const [width, height, layout] of [[1920, 1080, 'wide'], [375, 812, 'compact']]) {
  test(`${width} x ${height}: CONFIG › 声音 keeps one row rhythm and one grid`, {timeout: 60000}, async t => {
    const browser = await chromium.launch({headless: true, args: ['--mute-audio']}); t.after(() => browser.close())
    const page = await browser.newPage({viewport: {width, height}}), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await mountSound(page).catch(error => { throw new Error(error.message + ' ' + errors.join(' | ')) })
    const got = await page.evaluate(measure), tag = `@${width}`
    // STAGE_ROW_RHYTHM_SHOTS=DIR keeps the page's top and its scrolled end for review.
    if (process.env.STAGE_ROW_RHYTHM_SHOTS) for (const end of [false, true]) {
      await page.evaluate(end => { const page = document.querySelector('.fork-gal-config-page'); page.scrollTop = end ? page.scrollHeight : 0 }, end)
      await page.screenshot({path: `${process.env.STAGE_ROW_RHYTHM_SHOTS}/sound-${width}${end ? '-end' : ''}.png`})
    }
    assert.equal(got.layout, layout)
    // the page is the mixer alone: 自动混音 is its last row, in the mixer's grid (no loose config row, no hanging glyph).
    assert.deepEqual(got.mix.map(row => row.layer), ['master', 'voice', 'music', 'sfx', 'ambience', 'ui', 'duck'])
    assert.equal(got.configRows, 0)
    assert.equal(got.glyphs, 0)
    // the rhythm: the same pitch from one row's middle to the next, and the same room between the rows' boxes (the duck row is one line, so it only keeps the gap).
    const slidered = got.mix.slice(0, 6)
    const pitch = slidered.slice(1).map((row, i) => Math.round((row.middle - slidered[i].middle) * 10) / 10)
    const gaps = got.mix.slice(1).map((row, i) => Math.round((row.top - got.mix[i].bottom) * 10) / 10)
    for (const [i, step] of pitch.entries()) assert.ok(Math.abs(step - pitch[1]) <= 1.5, `${tag}: the mixer's row pitch ${JSON.stringify(pitch)}`)
    for (const gap of gaps) assert.ok(Math.abs(gap - gaps[1]) <= 1.5, `${tag}: the room between the rows ${JSON.stringify(gaps)}`)
    const [voice, duck] = [got.mix[1], got.mix[6]]
    assert.ok(Math.abs(duck.label - voice.label) <= 1, `${tag}: 自动混音's name at x ${duck.label}, the mixer's at ${voice.label}`)
    assert.ok(Math.abs(duck.controlMiddle - duck.labelMiddle) <= 2, `${tag}: the switch stands on its name's line`)
    assert.ok(duck.controlRight <= got.pageRight + 1, `${tag}: the switch stays inside the page`)
    if (layout === 'wide') assert.ok(Math.abs(duck.control - voice.control) <= 1, `${tag}: the switch at x ${duck.control}, the mixer's sliders at ${voice.control}`)
    assert.deepEqual(errors, [])
  })
}