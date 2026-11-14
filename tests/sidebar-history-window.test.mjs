import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

// 上百条会话时，手机抽屉展开那一帧不能把整张历史表都排一遍：侧栏只挂第一屏的行，
// 滚到底部再按屏追加。这里用真实的 client.js 起侧栏，确认挂载的行数被窗口截住、
// 滚动后才会变多。
const SESSIONS = 200
const sessions = Array.from({ length: SESSIONS }, (_, index) => ({
  sessionId: 'card-' + index,
  chatId: 'chat-' + index,
  mode: 'card',
  title: '工作台对话 ' + (index + 1),
  cardName: '卡 ' + (index + 1),
  created: Date.now() - index * 60_000,
}))

test('侧栏历史只挂第一屏的行，滚到底部再按屏追加', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 420, height: 760 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  await page.route('http://tavern.test/**', async route => {
    const url = route.request().url()
    if (!url.includes('/api/dsh-tavern/')) {
      // 抽屉里的列表有确定高度、到顶就滚；这里给个同样的上限，才看得到窗口行为。
      return route.fulfill({
        contentType: 'text/html',
        body: '<main id="sidebar"></main><style>' + tavernCss + '</style>'
          + '<style>.dsh-tavern-sidebar{height:320px;display:flex;flex-direction:column;overflow:hidden}</style>',
      })
    }
    const method = new URL(url).pathname.split('/').at(-1)
    const responses = {
      listCards: { cards: [] },
      getCardOrganization: { organization: { groups: [], assignments: {} } },
      listSessions: { sessions },
      getUpdateStatus: { status: { phase: 'idle', host: 'cli', currentVersion: '3.2.0', currentCommit: 'a'.repeat(40) } },
      getHostCompatibility: {},
      confirmSessionPatch: {},
      getActiveInterfaceSkin: { css: '' },
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
      workspaces: {}, betterSidebar: { openTab() {} },
      layout: { toggleSidebar() {} },
      tavernSessionSignals: { subscribe: noop },
    }
    window.client.apply(ctx)
    const React = modules.react
    modules['react-dom/client'].createRoot(document.querySelector('#sidebar')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: true, useSessions: select => select(sessionState), useWorkspaces: select => select({ items: [] }), renderSlot: () => null,
    }))
  })

  // 卡片模式是平铺列表；游玩模式默认把历史按卡分组收起，那条路径本来就不挂行。
  await page.getByRole('button', { name: '卡片', exact: true }).click()
  await page.locator('.dsh-tavern-side-row').first().waitFor({ state: 'visible' })

  const first = await page.evaluate(() => ({
    rows: document.querySelectorAll('.dsh-tavern-side-row').length,
    scrollHeight: document.querySelector('.dsh-tavern-side-list').scrollHeight,
    clientHeight: document.querySelector('.dsh-tavern-side-list').clientHeight,
  }))
  assert.ok(first.rows > 0, '第一屏有行')
  assert.ok(first.rows <= 30, '挂载的行数被窗口截住，不是整张 ' + SESSIONS + ' 条的列表：' + first.rows)
  assert.ok(first.scrollHeight > first.clientHeight, '第一屏就能滚动，滚动事件才会来：' + JSON.stringify(first))

  await page.evaluate(() => {
    const list = document.querySelector('.dsh-tavern-side-list')
    list.scrollTop = list.scrollHeight
  })
  await page.waitForFunction(previous => document.querySelectorAll('.dsh-tavern-side-row').length > previous, first.rows)

  const grown = await page.evaluate(() => document.querySelectorAll('.dsh-tavern-side-row').length)
  assert.ok(grown > first.rows, '滚到底部后按屏追加：' + first.rows + ' -> ' + grown)
  assert.ok(grown < SESSIONS, '追加是一屏一屏来的，不会一次把整张表都挂上：' + grown)

  // 后续追加不改变已挂行：第一行仍然是同一条对话。
  assert.equal(await page.locator('.dsh-tavern-side-row').first().innerText().then(text => text.includes('工作台对话')), true)
  if (errors.length) throw Error(errors.join('\n'))
})
