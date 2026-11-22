import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('侧栏归档可恢复，点击管理直接打开宽屏页批量删除', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const errors = [], deleteCalls = []
  let finishDeletion = null
  async function releaseDeletion() {
    while (!finishDeletion) await new Promise(resolve => setTimeout(resolve, 20))
    const finish = finishDeletion
    finishDeletion = null
    finish()
  }
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
    if (method === 'prepareDeleteChats' || method === 'deleteChats') {
      const { _sessionPatchPage, ...args } = route.request().postDataJSON()
      deleteCalls.push({ method, args })
      const results = args.chatIds.map(chatId => ({ chatId, ok: true }))
      if (method === 'prepareDeleteChats') return route.fulfill({ json: { ok: true, results } })
      // Removing a long save takes a while; the archive step has already happened by now.
      return new Promise(resolve => { finishDeletion = resolve }).then(() => {
        history = history.filter(item => !args.chatIds.includes(item.chatId))
        return route.fulfill({ json: { ok: true, results } })
      })
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
  const archiveToggle = page.locator('.dsh-tavern-side-list').getByRole('button', { name: /^已归档/ })
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

  const manage = page.locator('.dsh-tavern-history-heading').getByRole('button', { name: '管理', exact: true })
  const manager = page.getByRole('dialog', { name: '会话管理' })
  assert.deepEqual(await page.locator('.dsh-tavern-history-heading').getByRole('button').allTextContents(), ['管理'])
  await manage.click()
  await manager.waitFor()
  await manager.getByRole('button', { name: '已归档', exact: true }).click()
  const selectArchived = manager.getByRole('checkbox', { name: '选择对话：旧归档' })
  await selectArchived.check()
  assert.equal(await manager.getByRole('button', { name: '彻底删除（1）', exact: true }).isEnabled(), true)
  await manager.getByRole('button', { name: '关闭', exact: true }).click()
  await manager.waitFor({ state: 'detached' })
  await manage.click()
  await selectArchived.waitFor()
  assert.equal(await selectArchived.isChecked(), false)

  await selectArchived.check()
  await manager.getByRole('button', { name: '彻底删除（1）', exact: true }).click()
  await page.getByRole('dialog', { name: '确认操作' }).getByRole('button', { name: '彻底删除', exact: true }).click()
  await row('旧归档').waitFor({ state: 'detached' })
  await archiveToggle.waitFor({ state: 'detached' })
  await row('普通存档').waitFor()
  assert.equal(await page.locator('.dsh-tavern-side-row').count(), 1)
  await releaseDeletion()
  await manager.getByRole('status').filter({ hasText: '已删除 1 个' }).waitFor()
  await page.keyboard.press('Escape')
  await manager.waitFor({ state: 'detached' })

  // 彻底删除先归档再删记录：删除还没完成时，这条不能出现在「已归档」里给人点「恢复到历史」。
  await menu('普通存档')
  await button('彻底删除').click()
  await page.getByRole('dialog').getByRole('button', { name: '彻底删除', exact: true }).click()
  await row('普通存档').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.dsh-tavern-side-row').count(), 0)
  assert.equal(await archiveToggle.count(), 0)
  await releaseDeletion()
  assert.deepEqual(deleteCalls, [
    { method: 'prepareDeleteChats', args: { chatIds: ['chat-archived'] } },
    { method: 'deleteChats', args: { chatIds: ['chat-archived'] } },
    { method: 'prepareDeleteChats', args: { chatIds: ['chat-active'] } },
    { method: 'deleteChats', args: { chatIds: ['chat-active'] } },
  ])
  assert.deepEqual(errors, [])
})
