import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

async function mountSidebar(t, { initialHistory, archived, recentReplyFirst = false }) {
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
  let history = initialHistory
  await page.route('http://tavern.test/**', route => {
    const url = route.request().url()
    if (!url.includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    const method = new URL(url).pathname.split('/').at(-1)
    if (method === 'getTavernSettings') return route.fulfill({ json: { ok: true, settings: { recentReplyFirst } } })
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
  await page.evaluate(archived => {
    const slots = {}, listeners = new Set()
    const sessionState = { current: '', byId: {} }
    let workspace = { items: [], archivedSessionIds: archived }
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
  }, archived)
  return { page, errors, deleteCalls, releaseDeletion }
}

test('侧栏归档可恢复，点击管理直接打开宽屏页批量删除', async t => {
  const { page, errors, deleteCalls, releaseDeletion } = await mountSidebar(t, {
    archived: ['archived'],
    initialHistory: [
      { sessionId: 'active', chatId: 'chat-active', mode: 'story', cardName: '测试卡', title: '普通存档' },
      { sessionId: 'archived', chatId: 'chat-archived', mode: 'story', cardName: '测试卡', title: '旧归档' },
    ],
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
  const archivedCard = manager.locator('.dsh-tavern-history-manager-row')
  const selectArchived = archivedCard.getByRole('checkbox', { name: '选择对话：旧归档' })
  await archivedCard.locator('.dsh-tavern-history-manager-preview').click()
  assert.equal(await selectArchived.isChecked(), true)
  assert.equal(await manager.getByRole('button', { name: '彻底删除（1）', exact: true }).isEnabled(), true)
  await archivedCard.getByText('旧归档', { exact: true }).click()
  assert.equal(await selectArchived.isChecked(), false)

  await archivedCard.getByRole('button', { name: '重命名：旧归档', exact: true }).click()
  const titleEditor = archivedCard.getByRole('textbox', { name: '对话标题' })
  await titleEditor.click()
  assert.equal(await selectArchived.isChecked(), false)
  await titleEditor.press('Escape')
  await archivedCard.getByRole('button', { name: '删除', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: '确认操作' })
  assert.equal(await selectArchived.isChecked(), false)
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await selectArchived.check()
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

test('宽屏管理沿用侧栏的组顺序和组内排序，筛选保留原顺序', async t => {
  const story = (sessionId, cardName, title, createdAt, updatedAt, replyText = '') => ({
    sessionId, chatId: 'chat-' + sessionId, mode: 'story', cardName, cardPath: cardName + '.png',
    title, createdAt, updatedAt, preview: { replyText, turnCount: Number(Boolean(replyText)), messageCount: 2 },
  })
  const initialHistory = [
    story('a-new', '甲卡', '甲卡 · 甲新', 220, 350, '月光'),
    story('b-new', '乙卡', '乙卡 · 乙新', 210, 280, '月光'),
    story('a-old', '甲卡', '甲卡 · 甲旧', 120, 400),
    story('b-old', '乙卡', '乙卡 · 乙旧', 110, 500),
    { ...story('single', '', '无卡对话', 180, 200), cardPath: '' },
    story('archive-new', '乙卡', '新归档', 160, 900),
    story('archive-old', '甲卡', '旧归档', 130, 910),
    { ...story('workbench-new', '工作台卡', '新工作台', 190, 200), mode: 'card' },
    { ...story('workbench-old', '工作台卡', '旧工作台', 150, 310), mode: 'card' },
  ]

  for (const recentReplyFirst of [false, true]) {
    await t.test(recentReplyFirst ? '最新回复排序' : '创建时间排序', async t => {
      const { page, errors } = await mountSidebar(t, { initialHistory, archived: ['archive-new', 'archive-old'], recentReplyFirst })
      const sidebar = page.locator('.dsh-tavern-side-list')
      const activeNames = ['乙卡', '甲卡', '未命名人物卡']
      for (const name of activeNames) await sidebar.getByRole('button', { name: new RegExp('^' + name) }).click()
      const sidebarTitles = await sidebar.locator('.dsh-tavern-side-row-title').allTextContents()
      assert.deepEqual(sidebarTitles, recentReplyFirst ? ['乙旧', '乙新', '甲旧', '甲新', '无卡对话'] : ['乙新', '乙旧', '甲新', '甲旧', '无卡对话'])

      const manage = page.getByRole('button', { name: '管理', exact: true })
      await manage.click()
      const manager = page.getByRole('dialog', { name: '会话管理' })
      const groups = manager.locator('.dsh-tavern-history-manager-group')
      const groupNames = () => groups.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')))
      const managerTitles = () => manager.locator('.dsh-tavern-history-manager-title').allTextContents()
      const archived = manager.getByRole('region', { name: '已归档', exact: true })
      await archived.waitFor()
      assert.deepEqual(await groupNames(), await sidebar.locator('.dsh-tavern-history-group-name').allTextContents())
      assert.deepEqual(await managerTitles(), sidebarTitles)
      assert.equal(await archived.getByRole('button', { expanded: false }).count(), 1)

      const search = manager.getByRole('textbox', { name: '搜索会话' })
      await search.fill('月光')
      assert.deepEqual(await groupNames(), ['乙卡', '甲卡'])
      assert.deepEqual(await managerTitles(), ['乙新', '甲新'])
      await manager.getByRole('button', { name: '全选筛选结果' }).click()
      await manager.getByRole('button', { name: '归档所选（2）' }).waitFor()

      await search.fill('')
      await manager.getByRole('button', { name: '全选筛选结果' }).click()
      await manager.getByRole('button', { name: '归档所选（5）' }).waitFor()
      assert.equal(await manager.getByRole('button', { name: '恢复所选', exact: true }).isDisabled(), true)
      await archived.getByRole('button', { expanded: false }).click()
      const archivedTitles = recentReplyFirst ? ['旧归档', '新归档'] : ['新归档', '旧归档']
      assert.deepEqual(await managerTitles(), sidebarTitles.concat(archivedTitles))
      await manager.getByRole('button', { name: '已归档', exact: true }).click()
      assert.deepEqual(await groupNames(), ['已归档'])
      assert.deepEqual(await managerTitles(), archivedTitles)
      await manager.getByRole('button', { name: '关闭', exact: true }).click()

      await page.getByRole('button', { name: '卡片', exact: true }).click()
      await manage.click()
      await manager.getByRole('button', { name: '关闭', exact: true }).waitFor()
      assert.deepEqual(await groupNames(), [])
      assert.deepEqual(await managerTitles(), await sidebar.locator('.dsh-tavern-side-row-title').allTextContents())
      assert.deepEqual(errors, [])
    })
  }
})

test('人物卡筛选限高滚动，支持搜索、区分同名卡和清除', async t => {
  function story(sessionId, cardName, cardPath, title = cardName) {
    return { sessionId, chatId: 'chat-' + sessionId, mode: 'story', title, cardName, cardPath, preview: {} }
  }
  const longName = '这是一张名字特别长的人物卡'.repeat(8)
  const initialHistory = [
    story('long', longName, 'long.png', '长标题存档'),
    story('duplicate-a', '同名人物卡', '旧版/同名人物卡.png', '旧版存档'),
    story('duplicate-b', '同名人物卡', '新版/同名人物卡.png', '新版存档'),
    ...Array.from({ length: 28 }, (_, i) => story('extra-' + i, '人物卡 ' + i, 'extra-' + i + '.png')),
  ]
  const { page, errors } = await mountSidebar(t, { initialHistory, archived: [] })
  await page.setViewportSize({ width: 390, height: 720 })
  for (const css of ['tavern.css', 'theme.css']) {
    await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/' + css, import.meta.url), 'utf8') })
  }
  await page.getByRole('button', { name: '管理', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '会话管理' })
  const trigger = manager.getByRole('button', { name: /^按人物卡筛选：/ })
  const picker = page.getByRole('dialog', { name: '筛选人物卡', exact: true })
  const search = picker.getByRole('textbox', { name: '搜索人物卡' })
  const list = picker.getByRole('menu', { name: '人物卡', exact: true })
  const titles = () => manager.locator('.dsh-tavern-history-manager-title').allTextContents()

  await trigger.click()
  await picker.waitFor()
  await search.evaluate(input => {
    if (document.activeElement !== input) throw new Error('打开人物卡筛选后应自动聚焦搜索框')
  })
  const bounds = await picker.boundingBox()
  assert.ok(bounds.width <= 320 && bounds.height <= 320 && bounds.x >= 0 && bounds.x + bounds.width <= 390)
  assert.equal(await list.evaluate(element => element.clientHeight < element.scrollHeight), true)
  assert.equal(await list.getByRole('menuitemradio').count(), 32)

  await search.fill('同名人物卡')
  assert.deepEqual(await list.getByRole('menuitemradio').allTextContents(), ['同名人物卡旧版/同名人物卡.png', '同名人物卡新版/同名人物卡.png'])
  await search.fill('不存在的人物卡')
  await picker.getByRole('status').getByText('没有匹配的人物卡').waitFor()
  await search.fill('新版/')
  await search.press('ArrowDown')
  await page.keyboard.press('Enter')
  await picker.waitFor({ state: 'detached' })
  assert.deepEqual(await titles(), ['新版存档'])
  assert.equal(await trigger.getAttribute('aria-label'), '按人物卡筛选：同名人物卡')

  await trigger.click()
  await search.press('Escape')
  await picker.waitFor({ state: 'detached' })
  assert.equal(await manager.isVisible(), true)

  await trigger.click()
  await search.fill('名字特别长')
  await list.getByRole('menuitemradio', { name: longName, exact: true }).click()
  assert.deepEqual(await titles(), ['长标题存档'])
  assert.ok((await trigger.boundingBox()).width < 390)
  await trigger.click()
  await list.getByRole('menuitemradio', { name: '全部人物卡', exact: true }).click()
  assert.equal((await titles()).length, initialHistory.length)
  assert.deepEqual(errors, [])
})
