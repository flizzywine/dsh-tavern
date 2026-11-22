import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import surfaces from '../tavern-plugin/src/client/surfaces.cjs'

const read = path => readFile(new URL(`../tavern-plugin/${path}`, import.meta.url), 'utf8')

test('本局设置 and 发音字典 follow the host palette over their transparent backgrounds', async t => {
  const [base, theme, voice] = await Promise.all([
    read('lib/client-assets/tavern.css'), read('lib/client-assets/theme.css'),
    read('packages/dsh-tavern-tts/src/client.css'),
  ])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><body data-fk-context="chat-light">
    <div class="ap-ui ap-stage dsh-session-settings">
      <div class="dsh-session-rows">
        <div class="fork-inline-field" data-kind="text">
          <label class="fork-inline-label" for="player">玩家称呼</label>
          <div class="fork-inline-value"><input class="fork-inline-input" id="player" value="小夏"></div>
        </div>
      </div>
      <p class="ap-notice">设置仅用于本局</p>
    </div>
    <div class="dtts"><section class="dtts-readings"><div class="ap-ui fork-readings">
      <div class="fork-readings-bar"><div class="fork-inline-field" data-kind="menu">
        <span class="fork-inline-label">预设</span>
        <div class="fork-inline-value"><span class="fork-inline-anchor"><button type="button" class="fork-inline-trigger">默认</button></span></div>
      </div></div>
      <div class="ap-readings-row"><div class="fork-inline-field ap-reading-field" data-kind="text">
        <div class="fork-inline-value"><input class="fork-inline-input" aria-label="读音" value="よみ"></div>
      </div></div>
    </div></section></div>
  </body></html>`)
  await page.addStyleTag({ content: [base, theme, surfaces.css(), voice, '* { transition: none !important; }'].join('\n') })

  for (const [scheme, primary, secondary, surface] of [
    ['dark', 'rgb(249, 250, 251)', 'rgb(207, 211, 214)', 'rgb(27, 27, 28)'],
    ['light', 'rgb(15, 17, 21)', 'rgb(97, 102, 107)', 'rgb(249, 250, 251)'],
    ['dark', 'rgb(255, 227, 242)', 'rgb(200, 178, 220)', 'rgb(43, 29, 51)'],
  ]) {
    const computed = await page.evaluate(({ scheme, primary, secondary, surface }) => {
      document.documentElement.style.colorScheme = scheme
      document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark')
      document.body.style.setProperty('--dsw-alias-label-primary', primary)
      document.body.style.setProperty('--dsw-alias-label-secondary', secondary)
      document.body.style.setProperty('--dsw-alias-bg-base', surface)
      const style = selector => getComputedStyle(document.querySelector(selector))
      return {
        label: style('.fork-inline-label').color,
        input: style('.fork-inline-input').color,
        notice: style('.ap-notice').color,
        background: style('.dsh-session-settings').backgroundColor,
        readingLabel: style('.fork-readings .fork-inline-label').color,
        readingPreset: style('.fork-readings .fork-inline-trigger').color,
        readingInput: style('.fork-readings .fork-inline-input').color,
        readingBackground: style('.fork-readings').backgroundColor,
        controlSurface: style('.fork-readings').getPropertyValue('--fork-raised').trim(),
      }
    }, { scheme, primary, secondary, surface })
    assert.deepEqual(computed, {
      label: primary,
      input: primary,
      notice: secondary,
      background: 'rgba(0, 0, 0, 0)',
      readingLabel: secondary,
      readingPreset: primary,
      readingInput: primary,
      readingBackground: 'rgba(0, 0, 0, 0)',
      controlSurface: surface,
    }, `${scheme} host theme (${primary})`)
  }
})

test('开场设置 uses the card palette for both its background and shared fields', async t => {
  const [base, theme] = await Promise.all([read('lib/client-assets/tavern.css'), read('lib/client-assets/theme.css')])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><body data-fk-context="chat-light">
    <div class="dsh-opening-setup ap-ui" style="--dsh-opening-bg:#1c1830;--dsh-opening-surface:#2b2340;--dsh-opening-text:#f5f0fa;--dsh-opening-muted:#d2b8dc">
      <p class="dsh-opening-intro">选择故事开场</p>
      <div class="dsh-opening-fields"><div class="fork-inline-field" data-kind="text">
        <label class="fork-inline-label" for="player">玩家称呼</label>
        <div class="fork-inline-value"><input class="fork-inline-input" id="player" value="小夏"></div>
      </div></div>
    </div>
  </body></html>`)
  await page.addStyleTag({ content: [base, theme, surfaces.css()].join('\n') })
  const computed = await page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector))
    return {
      background: style('.dsh-opening-setup').backgroundColor,
      intro: style('.dsh-opening-intro').color,
      fieldSurface: style('.dsh-opening-fields').backgroundColor,
      label: style('.fork-inline-label').color,
      input: style('.fork-inline-input').color,
    }
  })
  assert.deepEqual(computed, {
    background: 'rgb(28, 24, 48)',
    intro: 'rgb(210, 184, 220)',
    fieldSurface: 'rgb(43, 35, 64)',
    label: 'rgb(210, 184, 220)',
    input: 'rgb(245, 240, 250)',
  })
})
