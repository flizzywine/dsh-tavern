import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('已归档在历史列表底部折叠，展开后可恢复或彻底删除', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = [], deleteCalls = []
  page.on('pageerror', error => errors.push(error.message))
  let history = [
    { sessionId: 'active', chatId: 'chat-active', mode: 'story', cardName: '测试卡', title: '普通存档' },
    { sessionId: 'archived', chatId: 'chat-archived', mode: 'story', cardName: '测试卡', title: '旧归档' },
  ]
  await page.route('http://tavern.test/**', route => {
    const url = route.request().url()
    if (!url.includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    const method = new URL(url).pathname.split('/').at(-1)
    if (method === 'listSessions') return route.fulfill({ json: { ok: true, sessions: history } })
    if (method === 'prepareDeleteChats' || method === 'deleteChat') {
      const { _sessionPatchPage, ...args } = route.request().postDataJSON()
      deleteCalls.push({ method, args })
      if (method === 'prepareDeleteChats') return route.fulfill({ json: { ok: true, results: [{ ok: true }] } })
      history = history.filter(item => item.chatId !== args.chatId)
    }
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: 'window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==="react"?modules.react:{});}};' })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8') })
  await page.evaluate(() => {
    const slots = {}, listeners = new Set()
    const sessionState = { current: '', byId: {} }
    let workspace = { items: [], archivedSessionIds: ['archived'] }
    function setArchived(archivedSessionIds) {
      workspace = { ...workspace, archivedSessionIds }
      for (const listener of listeners) listener()
    }
    const React = modules.react
    const ctx = {
      inject() { return { dispose() {} } },
      get() {}, provide() {},
      effect(run, label) { return label === 'dsh-tavern: Tavern workspace browser' ? run() : () => {} },
      slots: { inject(_name, run) { return run() }, register(spec, component) { slots[spec.name] = component; return () => {} } },
      sessions: { list: { getSnapshot: () => sessionState }, binding: () => null },
      workspaces: {
        async archiveSession(id) { setArchived([...new Set([...workspace.archivedSessionIds, id])]) },
        async unarchiveSession(id) { setArchived(workspace.archivedSessionIds.filter(item => item !== id)) },
      },
      tavernSessionSignals: { subscribe: () => () => {} },
    }
    window.client.apply(ctx)
    const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
    modules['react-dom/client'].createRoot(document.querySelector('main')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: true, useSessions: select => select(sessionState),
      useWorkspaces: select => select(React.useSyncExternalStore(subscribe, () => workspace)),
      renderSlot: () => null,
    }))
  })
  const row = title => page.locator('.dsh-tavern-side-row').filter({ hasText: title })
  const button = name => page.getByRole('button', { name, exact: true })
  const menu = title => row(title).getByRole('button', { name: '对话操作' }).click()
  const archiveToggle = page.getByRole('button', { name: /^已归档/ })
  await page.getByRole('button', { name: /^测试卡/ }).click()
  await row('普通存档').waitFor()
  assert.equal(await page.locator('.dsh-tavern-history-group-toggle').last().getAttribute('title'), '已归档')
  assert.equal(await archiveToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(await row('旧归档').count(), 0)
  await menu('普通存档')
  await button('归档').click()
  await row('普通存档').waitFor({ state: 'detached' })
  assert.deepEqual(deleteCalls, [])

  await archiveToggle.click()
  await menu('普通存档')
  await button('恢复到历史').click()
  await row('普通存档').waitFor()
  await row('旧归档').waitFor()

  await button('管理').click()
  await page.getByRole('checkbox', { name: '选择对话：旧归档' }).click()
  await button('彻底删除所选（1）').waitFor()
  await archiveToggle.click()
  assert.equal(await button('彻底删除所选（0）').isDisabled(), true)
  await archiveToggle.click()
  assert.equal(await page.getByRole('checkbox', { name: '选择对话：旧归档' }).getAttribute('aria-checked'), 'false')
  await button('取消').click()

  await menu('旧归档')
  await button('彻底删除').click()
  await page.getByRole('dialog').getByRole('button', { name: '彻底删除', exact: true }).click()
  await row('旧归档').waitFor({ state: 'detached' })
  await archiveToggle.waitFor({ state: 'detached' })
  await row('普通存档').waitFor()
  assert.deepEqual(deleteCalls, [
    { method: 'prepareDeleteChats', args: { chatIds: ['chat-archived'] } },
    { method: 'deleteChat', args: { chatId: 'chat-archived' } },
  ])
  assert.deepEqual(errors, [])
})
