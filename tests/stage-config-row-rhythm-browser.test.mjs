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
    const rate = {voiceRate: 1}, reading = {subscribe: none, get: () => rate, set() {}}
    const mix = createStageMixer({React, Icon, Slider, audio, sounds, entries: null, report: () => {}, icons: {}, fields: fieldKit, reading, voiceRateLimits: [.5, 2, .1]})
    const config = createStageConfigScreen({React, window, document, matchMedia: query => window.matchMedia(query), rpc: async () => ({mods: []}), sections: {}, useSounds: () => {}, sounds, Icon,
      Looks: fieldKit.Looks, Sound: mix.Sound, Text: () => null, Appearance: () => null})
    ReactDOMClient.createRoot(document.getElementById('root')).render(h(config.Screen, {sessionId: 's', tests: {}, onClose() {}}))
  `})
  await page.waitForSelector('.fork-gal-config-page[data-tab="sound"] .fork-gal-mix-row[data-layer="ui"]', {state: 'attached', timeout: 5000})
}

function measure() {
  const page = document.querySelector('.fork-gal-config-page'), box = node => node.getBoundingClientRect()
  const middle = node => (box(node).top + box(node).bottom) / 2
  const mix = [...page.querySelectorAll('.fork-gal-mix-row')].map(row => ({layer: row.dataset.layer, top: box(row).top, bottom: box(row).bottom, middle: middle(row.querySelector('.fork-gal-mix-mute')),
    label: box(row.querySelector('.fork-gal-mix-label')).left, control: box(row.querySelector('.fork-gal-mix-slider')).left}))
  const rows = [...page.querySelectorAll('.fork-gal-config-row')].map(row => ({label: row.querySelector('.fork-gal-config-label b').textContent,
    labelX: box(row.querySelector('.fork-gal-config-label')).left, control: box(row.querySelector('.fork-gal-config-control')).left,
    inlineToggle: row.dataset.fkControl === 'toggle' ? Math.abs(middle(row.querySelector('.fork-gal-config-label')) - middle(row.querySelector('.fork-gal-config-switch'))) < 2 : null,
    stackedSlider: row.dataset.fkControl === 'slider' ? box(row.querySelector('.fork-gal-slider')).top >= box(row.querySelector('.fork-gal-config-label')).bottom - 1 : null}))
  return {layout: document.querySelector('.fork-gal-config').dataset.layout, mix, rows, inset: box(page).left + parseFloat(getComputedStyle(page).paddingLeft)}
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
    assert.deepEqual(got.mix.map(row => row.layer), ['master', 'voice', 'music', 'sfx', 'ambience', 'ui'])
    // the rhythm: the same pitch from one row's middle to the next, and the same room between the rows' boxes.
    const pitch = got.mix.slice(1).map((row, i) => Math.round((row.middle - got.mix[i].middle) * 10) / 10)
    const gaps = got.mix.slice(1).map((row, i) => Math.round((row.top - got.mix[i].bottom) * 10) / 10)
    for (const [i, step] of pitch.entries()) assert.ok(Math.abs(step - pitch[1]) <= 1.5 && Math.abs(gaps[i] - gaps[1]) <= 1.5, `${tag}: the mixer's row pitch ${JSON.stringify(pitch)}, gaps ${JSON.stringify(gaps)}`)
    assert.deepEqual(got.rows.map(row => row.label), ['自动混音', '配音倍速'])
    if (layout === 'compact') {
      for (const row of got.rows) assert.ok(Math.abs(row.labelX - got.inset) <= 1, `${tag}: ${row.label} shares the compact page inset`)
      assert.equal(got.rows[0].inlineToggle, true)
      assert.equal(got.rows[1].stackedSlider, true)
    } else for (const row of got.rows) {
      assert.ok(Math.abs(row.labelX - got.mix[1].label) <= 1, `${tag}: ${row.label}'s label at x ${row.labelX}, the mixer's at ${got.mix[1].label}`)
      assert.ok(Math.abs(row.control - got.mix[1].control) <= 1, `${tag}: ${row.label}'s control at x ${row.control}, the mixer's sliders at ${got.mix[1].control}`)
    }
    assert.deepEqual(errors, [])
  })
}
