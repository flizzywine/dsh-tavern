import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

// 手机端左栏是抽屉：宿主的 _sidebarCol 收起时是 translate3d(-101%) + visibility: hidden。
// 报错面板画在侧栏子树里时，position: fixed 的包含块就是这个带 transform 的抽屉，整块跟着滑出屏幕——
// 正文界面里看不到，只有拉开左侧栏才出现。面板必须挂在 body 上，始终相对视口定位。
function phoneShell({ drawerOpen }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { --dsw-alias-label-primary: #231f18; --dsw-alias-label-secondary: #6b655c; --dsw-alias-label-tertiary: #8d877d;
      --dsw-alias-border-l2: #e2dcd1; --dsw-alias-bg-base: #faf9f5; --dsw-specific-sidebar-fill: #f7f3ec;
      --dsw-specific-input-major: #fffdf9; --dsw-alias-interactive-bg-hover: #efe8dc; }
    html, body { margin: 0; height: 100%; background: var(--dsw-alias-bg-base); }
    #story { height: 100%; padding: 24px; box-sizing: border-box; }
    /* 抽屉收起：滑出屏幕并隐藏；展开：铺满视口。与 tavern.css 的手机抽屉规则同形。 */
    #drawer { position: fixed; inset: 0 auto 0 0; width: 100vw; z-index: 1300;
      ${drawerOpen ? 'transform: none; visibility: visible;' : 'transform: translate3d(-101%, 0, 0); will-change: transform; visibility: hidden;'} }
  </style>
  <link rel="stylesheet" href="/tavern.css">
</head>
<body class="dsh-tavern-shell-active">
  <div id="story">正文区域</div>
  <div id="drawer"><main id="sidebar"></main></div>
</body>
</html>`
}

async function mountPhoneSidebar(t, { drawerOpen = false } = {}) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shell = phoneShell({ drawerOpen })
  await page.route('http://tavern.test/**', async route => {
    const url = route.request().url()
    if (url.endsWith('/tavern.css')) return route.fulfill({ contentType: 'text/css', body: tavernCss })
    if (!url.includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: shell })
    const method = new URL(url).pathname.split('/').at(-1)
    const responses = {
      getUpdateStatus: { status: { phase: 'idle', host: 'cli', currentVersion: '3.3.0', currentCommit: 'a'.repeat(40) } },
      listCards: { cards: [] },
      getCardOrganization: { organization: { groups: [], assignments: {} } },
      listSessions: { sessions: [] },
      getHostCompatibility: {},
      confirmSessionPatch: {},
      getActiveInterfaceSkin: { css: '' },
    }
    return route.fulfill({ json: { ok: true, ...(responses[method] || {}) } })
  })
  await page.goto('http://tavern.test/')
  // 错误中心从 sessionStorage 恢复上一条记录：先放一条，挂载后就能看到面板。
  await page.evaluate(() => {
    sessionStorage.setItem('dsh-tavern:error-history:v1', JSON.stringify([{
      id: 'tavern-error-1', source: '正文重新生成', message: 'Provider finish_reason: content_filter', code: '',
      firstAt: Date.now(), lastAt: Date.now(), count: 1,
    }]))
  })
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:name==='react-dom'?modules['react-dom']:{});}};` })
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
      workspaces: {}, betterSidebar: { openTab() {} }, layout: { toggleSidebar() {} },
      tavernSessionSignals: { subscribe: noop },
    }
    window.client.apply(ctx)
    const React = modules.react
    modules['react-dom/client'].createRoot(document.querySelector('#sidebar')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: false, useSessions: select => select(sessionState), useWorkspaces: select => select({ items: [] }), renderSlot: () => null,
    }))
  })
  await page.locator('.dsh-tavern-error-center').waitFor({ state: 'attached' })
  t.after(() => { if (errors.length) throw Error(errors.join('\n')) })
  return { page }
}

function panelState(page) {
  return page.evaluate(() => {
    const element = document.querySelector('.dsh-tavern-error-center')
    if (!element) return { found: false }
    const rect = element.getBoundingClientRect()
    return {
      found: true,
      inBody: element.parentElement === document.body,
      insideDrawer: Boolean(element.closest('#drawer')),
      visible: element.checkVisibility ? element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : rect.width > 0,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight },
    }
  })
}

test('抽屉收起时，报错面板挂在 body 上，正文界面里直接可见', async t => {
  const { page } = await mountPhoneSidebar(t)
  const state = await panelState(page)
  assert.equal(state.found, true, '有错误记录时面板应当渲染')
  assert.equal(state.inBody, true, '面板要挂在 body 上，不能留在带 transform 的抽屉子树里')
  assert.equal(state.insideDrawer, false, '面板不能留在抽屉里，否则抽屉收起时跟着滑出屏幕')
  assert.equal(state.visible, true, '抽屉收起时面板仍然可见')
  assert.ok(state.rect.x >= 0 && state.rect.y >= 0, '面板要落在视口内：' + JSON.stringify(state.rect))
  assert.ok(state.rect.x + state.rect.width <= state.viewport.width + 1, '面板不能超出视口右边：' + JSON.stringify(state.rect))
  assert.equal(await page.locator('.dsh-tavern-error-center').isVisible(), true)
})

test('抽屉展开时，报错面板仍按视口定位，不随抽屉内容滚动', async t => {
  const { page } = await mountPhoneSidebar(t, { drawerOpen: true })
  const state = await panelState(page)
  assert.equal(state.inBody, true)
  assert.equal(state.visible, true)
  assert.ok(state.rect.x >= 0 && state.rect.y >= 0, '面板要落在视口内：' + JSON.stringify(state.rect))
})

test('报错面板显示五秒后自动移除，记录一起清掉', async t => {
  const { page } = await mountPhoneSidebar(t)
  await page.locator('.dsh-tavern-error-center').waitFor({ state: 'visible' })
  const shownAt = Date.now()
  await page.waitForFunction(() => !document.querySelector('.dsh-tavern-error-center'), null, { timeout: 9000 })
  const elapsed = Date.now() - shownAt
  assert.ok(elapsed >= 4000, '面板要留够五秒，不能一闪就没：' + elapsed + 'ms')
  assert.ok(elapsed <= 7000, '面板要在五秒左右自行移除：' + elapsed + 'ms')
  assert.equal(await page.evaluate(() => sessionStorage.getItem('dsh-tavern:error-history:v1')), '[]', '自动移除后不留记录，刷新页面不会又冒出来')
})
