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
  const bundle = await build({ stdin: { contents: `import React from 'react'; import * as dom from 'react-dom/client'; window.React=React; window.require=()=>dom;`, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  const browser = await chromium.launch({ headless: true, ...(process.env.STAGE_TEST_BROWSER ? { executablePath: process.env.STAGE_TEST_BROWSER } : {}) })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
    await page.setContent('<!doctype html><html><body></body></html>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.addScriptTag({ content: `window.tavernPluginBoundary=()=>({children})=>children; window.tavernErrorHub={report:console.error}; ${source.slice(start, end)}; window.ui=createTavernUiExtensions(); window.plugin=Object.create(ui.service); plugin.ctx={fiber:{name:'fixture'},effect(fn){return fn()}};` })
    await page.evaluate(() => { window.handle = window.plugin.openOverlay({ gameId: 'fixture', render: ({ layout }) => { window.layout = layout; return window.React.createElement('button', { id: 'fixture' }, 'Return') }, onClose: () => { window.fixtureClosed = (window.fixtureClosed || 0) + 1 } }) })
    await page.waitForSelector('#fixture')
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
