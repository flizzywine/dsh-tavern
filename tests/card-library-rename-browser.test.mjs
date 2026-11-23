import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('重命名从标签页路径打开的人物卡后，刷新和重新打开仍使用新路径', async t => {
  const oldName = '示例角色-舞台版.json'
  const newName = '示例角色.json'
  const oldPath = 'cards/' + oldName
  const newPath = 'cards/' + newName
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = [], reads = []
  page.on('pageerror', error => errors.push(error.message))
  const card = { path: oldPath, name: '示例角色', tags: [] }
  await page.route('http://tavern.test/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    if (!method) return route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    const args = route.request().postDataJSON()
    if (method === 'getCard') {
      reads.push(args.path)
      if (args.path !== card.path) return route.fulfill({ json: { ok: false, error: '人物卡不存在: ' + args.path } })
      return route.fulfill({ json: { ok: true, card } })
    }
    if (method === 'renameResource') {
      assert.equal(args.path, oldPath)
      assert.equal(args.name, newName)
      card.path = newPath
      return route.fulfill({ json: { ok: true, resource: { oldPath, path: newPath } } })
    }
    if (method === 'listCards') return route.fulfill({ json: { ok: true, cards: [card] } })
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') })
  await page.evaluate(path => {
    let library, tab = { id: 'cards-tab', meta: { cardPath: path } }
    const scope = { sessionId: 'cards-session' }
    const root = modules['react-dom/client'].createRoot(document.querySelector('main'))
    const render = (key = 'library') => root.render(modules.react.createElement(library, { key, tab, scope, ctx, visible: true }))
    const ctx = {
      effect(run, label) { if (label === 'dsh-tavern: Better Sidebar card library tab') return run() },
      inject() { return { dispose() {} } }, get() {}, provide() {},
      slots: {}, tavernSessionSignals: { subscribe() { return () => {} } },
      betterSidebar: {
        registerTab(spec) { library = spec.component },
        updateTab(id, patch, sessionId) {
          if (id !== tab.id || sessionId !== scope.sessionId) throw new Error('Wrong sidebar tab scope')
          tab = { ...tab, ...patch }
          render()
        },
      },
    }
    window.client.apply(ctx)
    window.reopenCardLibrary = () => render('reopened')
    render()
  }, oldPath)
  const rename = page.getByRole('button', { name: '重命名', exact: true })
  await rename.click()
  const input = page.locator('.dsh-tavern-prompt-input')
  assert.equal(await input.inputValue(), oldName)
  const renameReadStart = reads.length
  await input.fill(newName)
  await input.press('Enter')
  await page.getByText(newName, { exact: true }).waitFor()
  const refreshed = page.waitForResponse(response => response.url().endsWith('/getCard'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  assert.equal((await refreshed).request().postDataJSON().path, newPath)
  await page.evaluate(() => window.reopenCardLibrary())
  await rename.click()
  assert.equal(await input.inputValue(), newName)
  assert.ok(reads.slice(renameReadStart).length >= 3)
  assert.ok(reads.slice(renameReadStart).every(path => path === newPath), reads.join(', '))
  assert.deepEqual(errors, [])
})
