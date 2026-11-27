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

test('右侧栏世界书库随宿主皮肤与壁纸实时更新表面调色板，且常驻排布按钮保留语义配色', async t => {
  const [base, theme, surfacesSrc, presentationSrc] = await Promise.all([
    read('lib/client-assets/tavern.css'),
    read('lib/client-assets/theme.css'),
    read('src/client/surfaces.cjs'),
    read('src/client/tavern-presentation.js'),
  ])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><body>
    <div data-sidebar-right-panel>
      <div class="fork-tab-scroll dsh-tavern-wblib">
        <div class="ap-ui ap-library">
          <header class="ap-head dsh-tavern-wblib-head">
            <h2>世界书库</h2>
            <button type="button" class="dsh-wbl-entry-btn">常驻排布</button>
          </header>
          <div class="ap-pack-toolbar">
            <label class="ap-search"><input type="search" value=""></label>
          </div>
          <ul class="ap-pack-list dsh-tavern-wblib-list">
            <li class="ap-pack-row dsh-tavern-wblib-row">
              <div class="ap-pack-title">
                <button type="button" class="fork-help-tip-face dsh-tavern-worldbook-primary">主书</button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </body></html>`)
  await page.addStyleTag({ content: [base, theme, '* { transition: none !important; }'].join('\n') })

  await page.evaluate(({ surfacesSrc, presentationSrc }) => {
    const fn = new Function(
      'tavernFonts', 'liveTavernView', 'isPlayMode', 'FontPicker', 'HelpTip', 'Spinner', 'InlineField', 'rpc',
      `${surfacesSrc}\n${presentationSrc}\nreturn installTavernPresentation;`
    )
    const installTavernPresentation = fn(
      { list: () => [], get: () => null, ensure: async () => {}, subscribe: () => () => {} },
      { getSnapshot: () => ({}), subscribe: () => () => {} },
      () => false, () => null, () => null, () => null, () => null, async () => null
    )
    const listeners = new Set()
    window.__emitThemeChange = () => listeners.forEach(cb => cb())
    const ctx = {
      effect(cb) { cb() },
      provide() {},
      on(ev, cb) { if (ev === 'theme/change') listeners.add(cb); return () => listeners.delete(cb) },
      sessions: { list: { getSnapshot: () => ({ current: '' }) } },
    }
    installTavernPresentation(ctx)
  }, { surfacesSrc, presentationSrc })

  // 1) 暖陶土浅色皮肤 + 开启壁纸（--dsw-alias-bg-base 半透明，--dsh-dream-skin-composer-base 保留不透明皮肤底色）
  const warm = await page.evaluate(async () => {
    document.body.removeAttribute('data-ds-dark-theme')
    document.body.style.setProperty('--dsw-alias-bg-base', 'rgba(250, 249, 245, 0.72)')
    document.body.style.setProperty('--dsh-dream-skin-composer-base', '#faf9f5')
    document.body.style.setProperty('--dsw-alias-label-primary', '#141413')
    document.body.style.setProperty('--dsw-alias-label-secondary', '#6c6a64')
    document.body.style.setProperty('--dsw-alias-brand-primary', '#cc785c')
    window.__emitThemeChange()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const style = s => getComputedStyle(document.querySelector(s))
    return {
      context: document.body.getAttribute('data-fk-context'),
      libraryBg: style('.ap-library').backgroundColor,
      searchBg: style('.ap-search > input').backgroundColor,
      primaryBg: style('.dsh-tavern-worldbook-primary').backgroundColor,
      primaryColor: style('.dsh-tavern-worldbook-primary').color,
      entryBtnColor: style('button.dsh-wbl-entry-btn').color,
      entryBtnBg: style('button.dsh-wbl-entry-btn').backgroundColor,
    }
  })
  assert.equal(warm.context, 'chat-light')
  assert.equal(warm.libraryBg, 'rgba(0, 0, 0, 0)', '右侧栏内世界书库背景应透明以透出皮肤和壁纸')
  assert.notEqual(warm.searchBg, 'rgb(241, 241, 241)', '搜索框应跟随暖陶土底色而非默认冷灰')
  assert.equal(warm.primaryColor, 'rgb(204, 120, 92)', '主书标签文字应跟随暖陶土强调色')
  assert.notEqual(warm.primaryBg, 'rgb(230, 237, 252)', '主书标签底色不应停留在默认蓝色')
  assert.equal(warm.entryBtnColor, 'rgb(46, 157, 91)', '常驻排布按钮应保留绿色语义文字色')
  assert.notEqual(warm.entryBtnBg, 'rgba(0, 0, 0, 0)', '常驻排布按钮背景不应被 .ap-ui button 覆盖为透明')

  // 2) 切换到深色皮肤，验证 data-fk-context 与表面文字/底色实时同步
  const dark = await page.evaluate(async () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    document.body.style.setProperty('--dsw-alias-bg-base', '#181715')
    document.body.style.setProperty('--dsh-dream-skin-composer-base', '#181715')
    document.body.style.setProperty('--dsw-alias-label-primary', '#faf9f5')
    document.body.style.setProperty('--dsw-alias-label-secondary', '#a09d96')
    document.body.style.setProperty('--dsw-alias-brand-primary', '#d4896c')
    window.__emitThemeChange()
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const style = s => getComputedStyle(document.querySelector(s))
    return {
      context: document.body.getAttribute('data-fk-context'),
      libraryColor: style('.ap-library').color,
      primaryColor: style('.dsh-tavern-worldbook-primary').color,
      surfaceToken: style('.ap-library').getPropertyValue('--fk-current-bgSolid').trim(),
    }
  })
  assert.equal(dark.context, 'chat-dark')
  assert.equal(dark.libraryColor, 'rgb(250, 249, 245)')
  assert.equal(dark.primaryColor, 'rgb(212, 137, 108)')
  assert.equal(dark.surfaceToken, 'rgb(24, 23, 21)')
})
