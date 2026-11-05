import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { build } from 'esbuild'
import { chromium } from 'playwright'

test('overlay lifecycle and layout in a browser at mobile and desktop widths', async () => {
  const source = await readFile(new URL('../../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')
  const start = source.indexOf('function createTavernUiExtensions()')
  const end = source.indexOf('const tavernUiExtensions = createTavernUiExtensions()', start)
  assert.ok(start >= 0 && end > start)
  const css=await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css',import.meta.url),'utf8')
  const rule=css.match(/\.dsh-tavern-plugin-overlay\s*\{[^}]+\}/)?.[0]
  assert.ok(rule)
  const bundle = await build({ stdin: { contents: `import React from 'react'; import * as dom from 'react-dom/client'; window.React=React; window.require=()=>dom;`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  const browser = await chromium.launch({ headless: true, ...(process.env.STAGE_TEST_BROWSER ? { executablePath: process.env.STAGE_TEST_BROWSER } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
    page.on('pageerror', error => console.error('browser fixture error:', error.message))
    await page.setContent('<!doctype html><html><head></head><body style="--overlay-test-theme: rgb(11, 22, 33)"><div id="stage"><button id="enter">Enter fullscreen</button></div></body></html>')
    await page.addStyleTag({content:rule+'\n#stage{position:fixed;inset:0;z-index:2147483000;background:#789}.dsh-tavern-plugin-overlay{color:var(--overlay-test-theme)}'})
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.addScriptTag({ content: `window.tavernPluginBoundary=()=>({children})=>children; window.tavernErrorHub={report:console.error}; window.tavernPluginAllowed=()=>true; ${source.slice(start, end)}; window.ui=createTavernUiExtensions(); window.plugin=Object.create(ui.service); plugin.ctx={fiber:{name:'fixture'},effect(fn){return fn()}}; document.querySelector('#enter').onclick=()=>document.documentElement.requestFullscreen();` })
    await page.click('#enter')
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement)
    assert.equal(await page.evaluate(() => typeof window.require),'function')
    await page.evaluate(() => { window.handle = window.plugin.openOverlay({ gameId: 'fixture', render: ({ layout }) => { window.layout = layout; return window.React.createElement('button', { id: 'fixture',onClick:()=>{window.clicked=true;if(window.reenter)document.querySelector('#stage').requestFullscreen()} }, 'Return') }, onClose: () => { window.fixtureClosed = (window.fixtureClosed || 0) + 1 } }) })
    await page.waitForSelector('#fixture')
    assert.equal(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('.dsh-tavern-plugin-overlay'))),true)
    assert.equal(await page.evaluate(() => document.querySelector('.dsh-tavern-plugin-overlay').parentNode === document.body),true)
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.dsh-tavern-plugin-overlay')).color),'rgb(11, 22, 33)')
    await page.click('#fixture')
    assert.equal(await page.evaluate(() => window.clicked),true)
    await page.evaluate(() => document.exitFullscreen())
    await page.waitForFunction(() => !document.fullscreenElement && document.querySelector('.dsh-tavern-plugin-overlay')?.parentNode === document.body)
    assert.equal(await page.evaluate(() => document.activeElement?.id),'fixture')
    await page.evaluate(() => { window.reenter=true })
    await page.click('#fixture')
    await page.waitForFunction(() => document.fullscreenElement?.contains(document.querySelector('.dsh-tavern-plugin-overlay')))
    assert.equal(await page.evaluate(() => document.activeElement?.id),'fixture')
    await page.evaluate(() => document.exitFullscreen())
    await page.waitForFunction(() => !document.fullscreenElement && document.querySelector('.dsh-tavern-plugin-overlay')?.parentNode === document.body)
    assert.equal(await page.evaluate(() => window.layout.get().width), 390)
    await page.evaluate(() => { window.changes = []; window.layout.subscribe(rect => window.changes.push(rect.width)) })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForFunction(() => window.changes.includes(1280))
    await page.keyboard.press('Escape')
    await page.waitForSelector('#fixture', { state: 'detached' })
    await page.evaluate(() => window.handle.close())
    assert.equal(await page.evaluate(() => window.fixtureClosed), 1)
  } finally { await browser.close() }
})
