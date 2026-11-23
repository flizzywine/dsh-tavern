import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import surfaces from '../tavern-plugin/src/client/surfaces.cjs'

test('context, plugin and regex status text stays readable in the host palette', async t => {
  const css = await Promise.all(['tavern.css', 'theme.css'].map(file =>
    readFile(new URL(`../tavern-plugin/lib/client-assets/${file}`, import.meta.url), 'utf8')))
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const sourceKinds = ['worldbook', 'preset', 'card', 'story', 'state', 'plugin', 'tool']
  const cacheStates = ['hit', 'break', 'cascade']
  const pluginStates = ['loaded', 'failed', 'skipped', 'restart']
  await page.setContent(`<!doctype html><html><body>
    <div class="dsh-tavern-full-context">
      ${sourceKinds.map(kind => `<span data-check class="dsh-context-source-pill is-src-${kind}">${kind}</span>`).join('')}
      ${cacheStates.map(state => `<span data-check class="dsh-context-cache-pill is-cache-${state}">${state}</span>`).join('')}
    </div>
    <div class="dsh-tavern-user-plugins">
      <p data-check class="dsh-tavern-user-plugins-notice">插件已安装</p>
      ${pluginStates.map(state => `<div class="dsh-tavern-user-plugin is-${state}"><span data-check class="dsh-tavern-user-plugin-state">${state}</span></div>`).join('')}
    </div>
    <p data-check class="dsh-tavern-rx-notice">已保存正则</p>
    <p data-check class="dsh-tavern-rx-error">保存失败</p>
  </body></html>`)
  await page.addStyleTag({ content: css.join('\n') })

  for (const [scheme, background, foreground] of [
    ['light', '#f9fafb', '#0f1115'],
    ['dark', '#1b1b1c', '#f9fafb'],
    ['dark', '#2d233d', '#ffeffa'],
  ]) {
    const samples = await page.evaluate(({ scheme, background, foreground }) => {
      document.documentElement.style.colorScheme = scheme
      document.body.toggleAttribute('data-ds-dark-theme', scheme === 'dark')
      document.body.style.backgroundColor = background
      document.body.style.setProperty('--dsw-alias-label-primary', foreground)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const paint = color => {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
      }
      const pixel = () => Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).concat(1)
      return [...document.querySelectorAll('[data-check]')].map(label => {
        const style = getComputedStyle(label)
        // Sample the translucent chip fill over the host background before drawing its text color.
        paint(background)
        paint(style.backgroundColor)
        const fill = pixel()
        paint(style.color)
        return { label: label.textContent, fill, ink: pixel() }
      })
    }, { scheme, background, foreground })
    for (const { label, fill, ink } of samples) {
      const contrast = surfaces.contrast(fill, ink)
      assert.ok(contrast >= 4.5, `${label} on ${background} has contrast ${contrast.toFixed(2)}`)
    }
  }
})
