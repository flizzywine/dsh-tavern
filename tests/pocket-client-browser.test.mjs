import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const source = await readFile(createRequire(import.meta.url).resolve('dsh-pocket/client'), 'utf8')

async function mount(t) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  t.after(async () => { await browser.close(); assert.deepEqual(errors, []) })
  await page.route('https://registry.npmjs.org/**', route => route.fulfill({ json: { version: '0.0.0' } }))
  await page.route('http://pocket.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="settings"></main>' }))
  await page.goto('http://pocket.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: 'window.__ModuleLoader__={load(d){window.pocket=d.factory(name=>modules[name]||{});}}' })
  await page.addScriptTag({ content: source })
  await page.evaluate(() => {
    window.entries = {}
    const dictionaries = {}
    window.pocket.apply({
      connection: { rpc: { call: async (_channel, endpoint) => ({ ok: true, value: endpoint === 'pocket.version'
        ? { current: '0.0.0', loaded: '0.0.0' }
        : { desktop: true, proxyRunning: true, proxyPort: 3081, lanEnabled: true, lanAuthEnabled: false,
          mobileRightbarEnabled: true, lanCandidates: [], tunnelRunning: false, tunnelState: { phase: 'idle' } } }) } },
      locale: {
        register(ns, value) { dictionaries[ns] = value.zh; return () => {} },
        bind: ns => key => dictionaries[ns]?.[key] ?? key,
      },
      layout: { toggleSidebar() {} }, sessionLogDownload: { download() {} },
      effect: run => run(),
      slots: {
        inject: (_name, run) => run(),
        register(spec, Component) { window.entries[spec.id] = { spec, Component }; return () => {} },
      },
    })
  })
  return page
}

test('Pocket mobile layout preserves host model selection and file preview handlers', async t => {
  const page = await mount(t)
  await page.evaluate(() => {
    window.clicks = []
    const model = '<span data-provider-id="gc" data-model-id="vendor/gemini-3.8-flash">vendor/gemini-3.8-flash</span>'
    document.body.insertAdjacentHTML('beforeend', `<button id="model-trigger">${model}</button>`)
    document.querySelector('#model-trigger').addEventListener('click', () => {
      window.clicks.push('open-models')
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      menu.innerHTML = `<button id="model-option" role="menuitemradio">${model}</button>`
      menu.firstElementChild.addEventListener('click', () => window.clicks.push('select-model'))
      document.body.append(menu)
    })
    document.body.insertAdjacentHTML('beforeend', '<button id="file-link">lib/story.mjs</button>')
    document.querySelector('#file-link').addEventListener('click', () => {
      window.clicks.push('preview-file')
      document.querySelector('main').textContent = '宿主文件预览'
    })
  })
  await page.locator('#model-trigger').click()
  assert.deepEqual(await page.evaluate(() => window.clicks), ['open-models'])
  await page.locator('#model-option').click()
  await page.locator('#file-link').click()
  assert.deepEqual(await page.evaluate(() => window.clicks), ['open-models', 'select-model', 'preview-file'])
  assert.equal(await page.locator('main').textContent(), '宿主文件预览')
})

test('Pocket settings keep the Tavern service slot alongside the original controls', async t => {
  const page = await mount(t)
  await page.evaluate(() => {
    const { spec, Component } = window.entries.pocket
    if (!spec.children?.['dsh-pocket.service-control']) throw new Error('Missing Tavern service slot')
    const React = modules.react
    window.serviceClicks = 0
    modules['react-dom/client'].createRoot(document.querySelector('#settings')).render(React.createElement(Component, {
      ...spec.inject(),
      renderSlot: name => {
        if (name !== 'dsh-pocket.service-control') throw new Error('Unexpected slot: ' + name)
        return React.createElement('button', { onClick: () => window.serviceClicks++ }, '酒馆服务入口')
      },
    }))
  })
  await page.getByRole('button', { name: '酒馆服务入口', exact: true }).click()
  assert.equal(await page.evaluate(() => window.serviceClicks), 1)
  await page.getByText('局域网访问', { exact: true }).waitFor()
  await page.getByText('公网访问', { exact: true }).waitFor()
})
