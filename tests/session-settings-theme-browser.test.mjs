import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import surfaces from '../tavern-plugin/src/client/surfaces.cjs'

test('本局设置 follows the host text palette over its transparent background', async t => {
  const [base, theme] = await Promise.all(['tavern.css', 'theme.css'].map(file =>
    readFile(new URL(`../tavern-plugin/lib/client-assets/${file}`, import.meta.url), 'utf8')))
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
  </body></html>`)
  await page.addStyleTag({ content: [base, theme, surfaces.css()].join('\n') })

  for (const [scheme, primary, secondary] of [
    ['dark', 'rgb(249, 250, 251)', 'rgb(207, 211, 214)'],
    ['light', 'rgb(15, 17, 21)', 'rgb(97, 102, 107)'],
    ['dark', 'rgb(255, 227, 242)', 'rgb(200, 178, 220)'],
  ]) {
    const computed = await page.evaluate(({ scheme, primary, secondary }) => {
      document.documentElement.style.colorScheme = scheme
      document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark')
      document.body.style.setProperty('--dsw-alias-label-primary', primary)
      document.body.style.setProperty('--dsw-alias-label-secondary', secondary)
      const style = selector => getComputedStyle(document.querySelector(selector))
      return {
        label: style('.fork-inline-label').color,
        input: style('.fork-inline-input').color,
        notice: style('.ap-notice').color,
        background: style('.dsh-session-settings').backgroundColor,
      }
    }, { scheme, primary, secondary })
    assert.deepEqual(computed, {
      label: primary,
      input: primary,
      notice: secondary,
      background: 'rgba(0, 0, 0, 0)',
    }, `${scheme} host theme (${primary})`)
  }
})
