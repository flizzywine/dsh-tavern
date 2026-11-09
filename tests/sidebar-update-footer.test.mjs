import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// 侧栏底部的版本行和「检查更新」不能等 getUpdateStatus 回来才出现：状态读到慢（后端忙、
// 页面刚重载、切对话后重挂）时整行会先消失再出现，看起来就是按钮时有时无。
async function mountSidebar(t, initialStatus = { phase: 'idle', host: 'cli', currentVersion: '3.2.0', currentCommit: 'a390af1c0ffee5' }, methodResponses = {}) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(5000)
  const errors = [], methods = []
  page.on('pageerror', error => errors.push(error.message))
  let releaseStatus
  const statusGate = new Promise(resolve => { releaseStatus = resolve })
  let held = true
  await page.route('http://tavern.test/**', async route => {
    const url = route.request().url()
    if (!url.includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: '<main id="sidebar"></main>' })
    const method = new URL(url).pathname.split('/').at(-1)
    methods.push(method)
    if (method === 'getUpdateStatus') {
      if (held) { await statusGate; held = false }
      return route.fulfill({ json: { ok: true, status: initialStatus } })
    }
    const responses = {
      listCards: { cards: [] },
      getCardOrganization: { organization: { groups: [], assignments: {} } },
      listSessions: { sessions: [] },
      getHostCompatibility: {},
      confirmSessionPatch: {},
      getActiveInterfaceSkin: { css: '' },
      ...methodResponses,
    }
    return route.fulfill({ json: { ok: true, ...(responses[method] || {}) } })
  })
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    const slots = {}, noop = () => () => {}
    const sessionState = { current: '', byId: {} }
    const ctx = {
      inject() { return { dispose() {} } },
      get() {}, provide() {},
      effect(run, label) { return ['dsh-tavern: Tavern workspace browser'].includes(label) ? run() : () => {} },
      slots: { inject(_name, run) { return run() }, register(spec, component) { slots[spec.id || spec.name] = component; return () => {} } },
      sessions: { subagentAddress: () => null, refresh: async () => {}, list: { getSnapshot: () => sessionState }, binding: () => null },
      workspaces: {}, betterSidebar: {},
      tavernSessionSignals: { subscribe: noop },
    }
    window.client.apply(ctx)
    const React = modules.react
    modules['react-dom/client'].createRoot(document.querySelector('#sidebar')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: true, useSessions: select => select(sessionState), useWorkspaces: select => select({ items: [] }), renderSlot: () => null,
    }))
  })
  t.after(() => { if (errors.length) throw Error(errors.join('\n')) })
  return { page, releaseStatus, methods }
}

test('更新状态还没回来时，版本行和「检查更新」已经在侧栏底部', async t => {
  const { page, releaseStatus } = await mountSidebar(t)
  const row = page.locator('.dsh-tavern-update-row')
  await row.waitFor({ state: 'visible' })
  const check = page.getByRole('button', { name: '检查更新', exact: true })
  await check.waitFor({ state: 'visible' })
  assert.equal(await check.isDisabled(), false, '首次状态查询慢时也能直接检查更新')
  assert.equal(await page.locator('.dsh-tavern-update-identity').innerText(), 'DSH Tavern · DSH 0.2.1')

  releaseStatus()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-update-identity')?.textContent?.includes('v3.2.0'))
  assert.equal(await page.locator('.dsh-tavern-update-identity').innerText(), 'DSH Tavern v3.2.0 · DSH 0.2.1 · a390af1')
  assert.equal(await check.isVisible(), true)
  assert.equal(await check.isDisabled(), false)
})

test('刚打开页面时不用等待状态查询，直接点击检查更新', async t => {
  const available = { phase: 'update-available', host: 'cli', currentVersion: '3.2.0', currentCommit: 'a'.repeat(40), latestCommit: 'b'.repeat(40) }
  const { page, releaseStatus, methods } = await mountSidebar(t, undefined, { checkUpdate: { status: available } })
  const check = page.getByRole('button', { name: '检查更新', exact: true })
  await check.waitFor({ state: 'visible' })
  assert.equal(await check.isDisabled(), false)
  await check.click()
  await page.getByRole('button', { name: '进行更新', exact: true }).waitFor({ state: 'visible' })
  assert.ok(methods.includes('checkUpdate'))
  releaseStatus()
})

test('发现更新时进行更新可点击，确认后真正发送 startUpdate', async t => {
  const available = { phase: 'update-available', host: 'cli', currentVersion: '3.2.0', currentCommit: 'a'.repeat(40), latestCommit: 'b'.repeat(40) }
  const { page, releaseStatus, methods } = await mountSidebar(t, available, {
    startUpdate: { status: { phase: 'running', host: 'cli', cancellable: false } },
  })
  releaseStatus()
  const update = page.getByRole('button', { name: '进行更新', exact: true })
  await update.waitFor({ state: 'visible' })
  assert.equal(await update.isDisabled(), false)
  await update.click()
  const dialog = page.getByRole('dialog', { name: '确认操作' })
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '确认', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-update-button')?.textContent === '正在更新…')
  assert.ok(methods.includes('startUpdate'))
})
