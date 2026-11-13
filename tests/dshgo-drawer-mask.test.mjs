import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const webMobileUrl = new URL('../node_modules/dsh-web-mobile/lib/client.js', import.meta.url)

// 复刻 DSH 0.2.2 AppFrame + dsh-go WebViewPage（dsh_web_phone.{css,js} + #dsh-app-insets）
// + dsh-web-mobile（含未打补丁时的 > :first-child 规则与 [data-mobile-nav="backdrop"]）：
// - <768px：frame 带 data-sidebar-drawer，第一个子元素是 _drawerMask[data-sidebar-mask]（z-index:70），
//   第二个子元素才是 _sidebarCol（z-index:71, transform:translate(0), inline width:280px）。
// - 768..1023px：frame 无 data-sidebar-drawer，dsh_web_phone.js 常驻展开内层侧栏并用
//   frame[data-dsh-app-drawer] + _sidebarCol::after 灰罩滑入滑出，x > _sidebarCol.right 点击即收起。
function buildDshGoShell({ officialDrawer, initialOpen, withMobilePlugin = true }) {
  const collapsedAttr = officialDrawer && !initialOpen ? ' data-sidebar-collapsed="true"' : ''
  const appDrawerAttr = !officialDrawer && initialOpen ? ' data-dsh-app-drawer=""' : ''
  const drawerAttr = officialDrawer ? ' data-sidebar-drawer="true"' : ''
  const mobileNavAttr = withMobilePlugin ? ' data-mobile-nav="frame"' : ''
  return `<!doctype html>
<html data-dsh-app-layout="drawer">
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style id="dsh-app-insets">
    :root {
      --dsh-app-inset-top: 76px;
      --dsh-app-inset-bottom: 16px;
      --dsh-app-inset-left: 0px;
      --dsh-app-inset-right: 0px;
      --dsh-app-lead: 104px;
      --dsh-app-lead-h: 42px;
      --dsh-app-status: 28px;
      --dsw-alias-label-primary: #231f18;
      --dsw-alias-label-secondary: #6b655c;
      --dsw-alias-label-tertiary: #8d877d;
      --dsw-alias-border-l2: #e2dcd1;
      --dsw-alias-border-l3: #d8d1c5;
      --dsw-alias-bg-base: #faf9f5;
      --dsw-alias-bg-mask-1: rgba(15, 23, 42, 0.45);
      --dsw-specific-sidebar-fill: #f7f3ec;
      --dsw-specific-input-major: #fffdf9;
      --dsw-alias-interactive-bg-hover: #efe8dc;
      --dsw-alias-button-elevated-fill: #fffdf9;
      --dsw-alias-button-floating-hover: #f2ece2;
      --dsw-alias-brand-primary: #c8703c;
    }
    #root { position: fixed !important; top: 28px !important; bottom: 16px !important; left: 0px !important; right: 0px !important; height: auto !important; min-height: 0 !important; margin: 0 !important; }
    html, body { margin: 0; overflow: hidden !important; overscroll-behavior: none !important; background: var(--dsw-alias-bg-base); }
  </style>
  <style id="dsh-official-022">
    .VFpnAa_frame { position: relative; display: grid; width: 100%; height: 100%; grid-template-columns: 0px minmax(0px, 1fr) 0px; }
    .VFpnAa_frame[data-sidebar-drawer] .VFpnAa_sidebarCol { z-index: 71; box-sizing: border-box; visibility: visible; position: absolute; inset: 0 auto 0 0; transform: translate(0); }
    .VFpnAa_frame[data-sidebar-drawer][data-sidebar-collapsed] .VFpnAa_sidebarCol { visibility: hidden; transform: translate(-100%); }
    .VFpnAa_drawerMask { inset: 0; z-index: 70; background: var(--dsw-alias-bg-mask-1); opacity: 0; pointer-events: none; position: absolute; }
    .VFpnAa_frame[data-sidebar-drawer]:not([data-sidebar-collapsed]) .VFpnAa_drawerMask { opacity: 1; pointer-events: auto; }
    .VFpnAa_centerCol { grid-column: 2; min-width: 0; min-height: 0; position: relative; }
    .hRoot { height: 100%; display: flex; flex-direction: column; padding: 6px 12px; box-sizing: border-box; background: var(--dsw-specific-sidebar-fill); }
    .hLogoRow { flex: none; height: 36px; display: flex; align-items: center; }
    .hRegion { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .hFootArea { flex: none; display: flex; flex-direction: column; }
    .hSettingsArea { flex: none; width: 100%; display: flex; padding: 4px 0; }
    .hLauncher { position: relative; display: flex; align-items: center; width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: 10px; background: #ece4d6; cursor: pointer; }
  </style>
  <style id="dsh-app-phone">
    :root[data-dsh-app-layout="drawer"] [data-slot="root"] > [class*="_frame"][data-sidebar-drawer] > [class*="_sidebarCol"],
    :root[data-dsh-app-layout="drawer"] [data-slot="root"] > [class*="_frame"][data-sidebar-drawer] > [class*="_drawerMask"] {
      position: fixed !important; top: 0 !important; bottom: 0 !important; height: auto !important;
    }
    :root[data-dsh-app-layout="drawer"] [data-slot="root"] > [class*="_frame"]:not([data-sidebar-drawer]) > [class*="_centerCol"] { grid-column: 1 / 3 !important; }
    :root[data-dsh-app-layout="drawer"] [data-slot="root"] > [class*="_frame"]:not([data-sidebar-drawer]) > [class*="_sidebarCol"] {
      position: fixed !important; z-index: 60; top: 0; bottom: 0; left: 0;
      width: calc(min(86vw, 320px) + var(--dsh-app-inset-left, 0px)) !important;
      transform: translateX(calc(-100% - 64px)); will-change: transform; overflow: visible !important;
    }
    :root[data-dsh-app-layout="drawer"] [data-slot="root"] > [class*="_frame"][data-dsh-app-drawer] > [class*="_sidebarCol"] { transform: none; }
    :root[data-dsh-app-layout="drawer"] [data-slot="root"] > [class*="_frame"][data-dsh-app-drawer] > [class*="_sidebarCol"]::after {
      content: ""; position: absolute; top: 0; bottom: 0; left: 100%; width: 100vw; background: rgba(15, 23, 42, 0.28);
    }
    /* 模拟旧版未重装补丁的 dsh-web-mobile：frame 单轨 + 误中 :first-child（_drawerMask）+ 全屏 backdrop z-1250 */
    [data-mobile-nav="frame"] { grid-template-columns: minmax(0, 1fr) 0 0 !important; }
    [data-mobile-nav="frame"] > :first-child { position: absolute !important; inset: 0 auto 0 0 !important; width: min(88vw, 280px) !important; z-index: 1300 !important; }
    [data-mobile-nav="backdrop"] { position: absolute; inset: 0; z-index: 1250; background: rgba(0, 0, 0, 0.45); }
  </style>
  <link rel="stylesheet" href="/tavern.css">
</head>
<body class="dsh-tavern-shell-active">
  <div id="root">
    <div data-slot="root" style="display:contents">
      <div class="VFpnAa_frame"${mobileNavAttr}${drawerAttr}${collapsedAttr}${appDrawerAttr}>
        ${officialDrawer ? '<div class="VFpnAa_drawerMask" data-sidebar-mask="true" aria-hidden="true"></div>' : ''}
        <div class="VFpnAa_sidebarCol" style="${officialDrawer ? 'width: 280px;' : ''}">
          <div data-slot="sidebar" style="display:contents">
            <div class="hRoot">
              <div class="hLogoRow"><button class="h_iconButton" type="button" id="host-sidebar-toggle">☰</button></div>
              <div class="hRegion"><div data-slot="sidebar.workspaces"><main id="sidebar"></main></div></div>
              <div class="hFootArea"><div class="hSettingsArea" data-slot="sidebar.settings"><div><div data-slot="settings.launcher"><button class="hLauncher" data-signed-out="true" data-collapsed="false">设置</button></div></div></div></div>
            </div>
          </div>
        </div>
        <div class="VFpnAa_centerCol">
          <div data-slot="main"><div id="story-surface" style="height:400px;padding:24px;">酒馆正文区域</div></div>
        </div>
        ${withMobilePlugin ? '<div data-mobile-nav="backdrop" role="button" aria-label="关闭侧栏"></div>' : ''}
      </div>
    </div>
  </div>
</body>
</html>`
}

async function mountDshGoPage(t, { width, height, officialDrawer, initialOpen, withMobilePlugin = true }) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shell = buildDshGoShell({ officialDrawer, initialOpen, withMobilePlugin })
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
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    const frame = document.querySelector('.VFpnAa_frame')
    const mask = document.querySelector('.VFpnAa_drawerMask')
    const backdrop = document.querySelector('[data-mobile-nav="backdrop"]')
    let renderSidebar = () => {}

    function setOfficialCollapsed(collapsed) {
      if (collapsed) frame.setAttribute('data-sidebar-collapsed', 'true')
      else frame.removeAttribute('data-sidebar-collapsed')
      renderSidebar()
    }
    if (mask) mask.addEventListener('click', () => setOfficialCollapsed(true))
    if (backdrop) backdrop.addEventListener('click', () => setOfficialCollapsed(true))
    document.getElementById('host-sidebar-toggle').addEventListener('click', () => {
      setOfficialCollapsed(!frame.hasAttribute('data-sidebar-collapsed'))
    })

    // 复刻 dsh_web_phone.js 的抽屉状态机与外部坐标点击收起逻辑。
    function isAppDrawer() {
      return document.documentElement.getAttribute('data-dsh-app-layout') === 'drawer' && !frame.hasAttribute('data-sidebar-drawer')
    }
    window.__dshApp = {
      sidebarOpen() {
        return isAppDrawer() ? frame.hasAttribute('data-dsh-app-drawer') : !frame.hasAttribute('data-sidebar-collapsed')
      },
      closeSidebar() {
        if (isAppDrawer()) frame.removeAttribute('data-dsh-app-drawer')
        else setOfficialCollapsed(true)
      },
      toggleSidebar() {
        if (isAppDrawer()) {
          if (frame.hasAttribute('data-dsh-app-drawer')) frame.removeAttribute('data-dsh-app-drawer')
          else frame.setAttribute('data-dsh-app-drawer', '')
        } else {
          setOfficialCollapsed(!frame.hasAttribute('data-sidebar-collapsed'))
        }
      },
    }
    document.addEventListener('pointerup', event => {
      if (!isAppDrawer() || !frame.hasAttribute('data-dsh-app-drawer')) return
      const side = frame.querySelector('.VFpnAa_sidebarCol')
      if (side && event.clientX > side.getBoundingClientRect().right) frame.removeAttribute('data-dsh-app-drawer')
    }, true)

    const slots = {}, noop = () => () => {}
    const sessionState = { current: '', byId: {} }
    const ctx = {
      inject() { return { dispose() {} } },
      get() {}, provide() {},
      effect(run, label) { return ['dsh-tavern: shell marker', 'dsh-tavern: Tavern workspace browser'].includes(label) ? run() : () => {} },
      slots: { inject(_name, run) { return run() }, register(spec, component) { slots[spec.id || spec.name] = component; return () => {} } },
      sessions: { subagentAddress: () => null, refresh: async () => {}, list: { getSnapshot: () => sessionState, subscribe: noop }, binding: () => null },
      workspaces: {}, betterSidebar: { openTab() {} },
      layout: { toggleSidebar() { setOfficialCollapsed(!frame.hasAttribute('data-sidebar-collapsed')) } },
      tavernSessionSignals: { subscribe: noop },
    }
    window.client.apply(ctx)
    const React = modules.react
    const root = modules['react-dom/client'].createRoot(document.querySelector('#sidebar'))
    renderSidebar = () => {
      const wide = !frame.hasAttribute('data-sidebar-collapsed')
      root.render(React.createElement(slots['sidebar.workspaces'], {
        wide,
        expandSidebar: () => setOfficialCollapsed(false),
        useSessions: select => select(sessionState),
        useWorkspaces: select => select({ items: [], archivedSessionIds: [] }),
        renderSlot: () => null,
      }))
    }
    renderSidebar()
  })
  t.after(() => { if (errors.length) throw Error(errors.join('\n')) })
  return { page }
}

test('dsh-go 窄屏（<768px，DSH 0.2.2 官方抽屉）：无灰色遮罩，点击侧栏内部不缩回，收起按钮可正常开关', async t => {
  const { page } = await mountDshGoPage(t, { width: 412, height: 906, officialDrawer: true, initialOpen: true })
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'visible' })

  const initial = await page.evaluate(() => {
    const mask = document.querySelector('.VFpnAa_drawerMask')
    const backdrop = document.querySelector('[data-mobile-nav="backdrop"]')
    const sidebar = document.querySelector('.dsh-tavern-sidebar')
    const frame = document.querySelector('.VFpnAa_frame')
    const hitCenter = document.elementFromPoint(206, 320)
    const hitRight = document.elementFromPoint(360, 320)
    const launcher = document.querySelector('.hLauncher').getBoundingClientRect()
    const hitSettings = document.elementFromPoint(launcher.left + 20, (launcher.top + launcher.bottom) / 2)
    return {
      maskDisplay: getComputedStyle(mask).display,
      backdropBg: getComputedStyle(backdrop).backgroundColor,
      backdropEvents: getComputedStyle(backdrop).pointerEvents,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      sidebarPaddingTop: parseFloat(getComputedStyle(sidebar).paddingTop),
      frameTop: Math.round(frame.getBoundingClientRect().top),
      hitCenterInSidebar: sidebar.contains(hitCenter),
      hitRightInSidebar: sidebar.contains(hitRight),
      settingsClickable: Boolean(hitSettings && hitSettings.closest('[data-slot="settings.launcher"]')),
    }
  })
  assert.equal(initial.maskDisplay, 'none', '_drawerMask 必须隐藏，不能盖在侧栏之上')
  assert.equal(initial.backdropBg, 'rgba(0, 0, 0, 0)', 'backdrop 不得绘制灰色遮罩')
  assert.equal(initial.backdropEvents, 'none', 'backdrop 不得拦截触摸事件')
  assert.equal(initial.sidebarWidth, 412, '酒馆侧栏必须挣脱 280px 抽屉列铺满整屏')
  assert.ok(initial.sidebarPaddingTop >= 76, '酒馆侧栏顶部需避让 dsh-go 左上角原生返回/菜单按钮')
  assert.equal(initial.frameTop, 28, '主框架留在 dsh-go #root 安全区内，不钻进状态栏')
  assert.equal(initial.hitCenterInSidebar, true, '屏幕中央命中酒馆侧栏而非遮罩')
  assert.equal(initial.hitRightInSidebar, true, 'x>280 右侧区域同样命中酒馆侧栏而非遮罩')
  assert.equal(initial.settingsClickable, true, '宿主底部设置按钮保持可点')

  // 真实点击侧栏内「卡片」按钮（x>200）：切换模式、正常弹出卡片起始面板且侧栏绝不缩回。
  await page.getByRole('button', { name: '卡片', exact: true }).click()
  await page.locator('.dsh-tavern-picker-overlay').waitFor({ state: 'visible' })
  const afterInnerClick = await page.evaluate(() => ({
    collapsed: document.querySelector('.VFpnAa_frame').hasAttribute('data-sidebar-collapsed'),
    cardActive: document.querySelector('.dsh-tavern-mode-switch button.active')?.textContent,
  }))
  assert.equal(afterInnerClick.collapsed, false, '点击侧栏内部控件不得触发抽屉缩回')
  assert.equal(afterInnerClick.cardActive, '卡片', '侧栏内部点击正常送到酒馆按钮')
  await page.locator('.dsh-tavern-picker-overlay button').filter({ hasText: '关闭' }).first().click()
  await page.locator('.dsh-tavern-picker-overlay').waitFor({ state: 'hidden' })

  // 点击右上角「收起」按钮：侧栏收起，露出底下正文且无任何残留灰罩。
  await page.locator('.dsh-tavern-side-collapse').click()
  const afterCollapse = await page.evaluate(() => {
    const frame = document.querySelector('.VFpnAa_frame')
    const hit = document.elementFromPoint(206, 200)
    return {
      collapsed: frame.hasAttribute('data-sidebar-collapsed'),
      hitStory: Boolean(hit && hit.closest('#story-surface')),
    }
  })
  assert.equal(afterCollapse.collapsed, true, '收起按钮正常收起官方抽屉')
  assert.equal(afterCollapse.hitStory, true, '收起后酒馆正文直接可点，无遮罩阻挡')
})

test('dsh-go 窄屏未装 dsh-web-mobile 时：720px 桌面兜底不压低 _sidebarCol 层级，官方 _drawerMask 不盖屏', async t => {
  const { page } = await mountDshGoPage(t, { width: 390, height: 844, officialDrawer: true, initialOpen: true, withMobilePlugin: false })
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'visible' })
  const state = await page.evaluate(() => {
    const mask = document.querySelector('.VFpnAa_drawerMask')
    const sidebar = document.querySelector('.dsh-tavern-sidebar')
    const hit = document.elementFromPoint(195, 300)
    return {
      maskDisplay: getComputedStyle(mask).display,
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      hitInSidebar: sidebar.contains(hit),
    }
  })
  assert.equal(state.maskDisplay, 'none', '未装 dsh-web-mobile 时官方 _drawerMask 同样隐藏')
  assert.equal(state.sidebarWidth, 390, '酒馆侧栏整屏铺开')
  assert.equal(state.hitInSidebar, true, '点击落在酒馆侧栏内')
  await page.locator('.dsh-tavern-side-collapse').click()
  assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(195, 200)?.closest('#story-surface'))), true, '收起后命中酒馆正文')
})

test('dsh-go 平板/折叠屏抽屉（768..1023px，data-dsh-app-drawer）：进入无遮罩，展开整屏不误触收起', async t => {
  const { page } = await mountDshGoPage(t, { width: 820, height: 1180, officialDrawer: false, initialOpen: false })

  // 初始进入界面：dsh_web_phone.js 保持内层侧栏展开，但未挂 data-dsh-app-drawer，必须完全离屏且无灰罩。
  const closedState = await page.evaluate(() => {
    const sideCol = document.querySelector('.VFpnAa_sidebarCol')
    const hit = document.elementFromPoint(410, 240)
    return {
      sideRight: Math.round(sideCol.getBoundingClientRect().right),
      hitStory: Boolean(hit && hit.closest('#story-surface')),
    }
  })
  assert.ok(closedState.sideRight <= 0, '抽屉未打开时侧栏列必须留在屏幕外：' + JSON.stringify(closedState))
  assert.equal(closedState.hitStory, true, '进入酒馆界面直接点中正文，无灰色遮罩')

  // 通过 dsh-go 左上角菜单按钮打开抽屉：铺满 820px 全宽，去掉 ::after 灰罩，点右侧区域不缩回。
  await page.evaluate(() => window.__dshApp.toggleSidebar())
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'visible' })

  const openState = await page.evaluate(() => {
    const sideCol = document.querySelector('.VFpnAa_sidebarCol')
    const sidebar = document.querySelector('.dsh-tavern-sidebar')
    const afterStyle = getComputedStyle(sideCol, '::after')
    return {
      colWidth: Math.round(sideCol.getBoundingClientRect().width),
      sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
      afterContent: afterStyle.content,
      afterDisplay: afterStyle.display,
    }
  })
  assert.equal(openState.colWidth, 820, '抽屉列扩展为 100vw，使 dsh_web_phone.js 不把右侧点击判为抽屉外')
  assert.equal(openState.sidebarWidth, 820, '酒馆侧栏铺满 820px 视口')
  assert.ok(openState.afterContent === 'none' || openState.afterDisplay === 'none', '::after 灰色遮罩已移除')

  // 点击 x=600（超过原 320px 抽屉宽）：不得被 outsideDrawer 当成外部点击关掉侧栏。
  await page.mouse.click(600, 300)
  assert.equal(await page.evaluate(() => window.__dshApp.sidebarOpen()), true, '点击 x>320 区域侧栏保持打开')

  // 点击右上角「收起」按钮：走 window.__dshApp.toggleSidebar() 正常关闭 data-dsh-app-drawer。
  await page.locator('.dsh-tavern-side-collapse').click()
  assert.equal(await page.evaluate(() => window.__dshApp.sidebarOpen()), false, '收起按钮关闭 dsh-go 抽屉')
})

test('dsh-web-mobile 补丁：DSH 0.2.2 下 findDrawer 跳过 _drawerMask，drawerOpen 识别 dsh-go 抽屉状态', { skip: !existsSync(webMobileUrl) }, async () => {
  const source = await readFile(webMobileUrl, 'utf8')
  const start = source.indexOf('function findDrawer(')
  const end = source.indexOf('\nfunction filesPanelOpen(', start)
  assert.ok(start >= 0 && end > start, '定位 findDrawer 与 drawerOpen')

  class FakeElement {
    constructor(className = '', attrs = {}) {
      this.className = className
      this.attrs = new Map(Object.entries(attrs))
      this.children = []
    }
    hasAttribute(name) { return this.attrs.has(name) }
    getAttribute(name) { return this.attrs.get(name) ?? null }
  }

  const mask = new FakeElement('VFpnAa_drawerMask', { 'data-sidebar-mask': 'true' })
  const sidebarCol = new FakeElement('VFpnAa_sidebarCol')
  const frame = new FakeElement('VFpnAa_frame', { 'data-sidebar-drawer': 'true' })
  frame.children = [mask, sidebarCol]
  const html = new FakeElement('', { 'data-dsh-app-layout': 'drawer' })

  const { findDrawer, drawerOpen } = new Function(
    'frame_ts_1', 'HTMLElement', 'document',
    source.slice(start, end) + '\nreturn { findDrawer, drawerOpen }',
  )({ getFrame: () => frame }, FakeElement, { documentElement: html })

  assert.equal(findDrawer(), sidebarCol, 'DSH 0.2.2 下跳过前置 _drawerMask 拿到真正的 _sidebarCol')
  assert.equal(drawerOpen(), true, '官方抽屉未标记 collapsed 时为打开')
  frame.attrs.set('data-sidebar-collapsed', 'true')
  assert.equal(drawerOpen(), false, '官方抽屉标记 collapsed 时为关闭')

  // 768..1023px：摘掉 data-sidebar-drawer、摘掉 data-sidebar-collapsed（dsh_web_phone.js 常驻展开内栏）
  frame.attrs.delete('data-sidebar-drawer')
  frame.attrs.delete('data-sidebar-collapsed')
  assert.equal(drawerOpen(), false, 'dsh-go 自管抽屉未挂 data-dsh-app-drawer 时算关闭，不弹灰罩')
  frame.attrs.set('data-dsh-app-drawer', '')
  assert.equal(drawerOpen(), true, '挂上 data-dsh-app-drawer 时才算打开')
})
