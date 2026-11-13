import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

// 手机端酒馆侧栏是整屏 fixed，宿主的侧栏底部还留着「设置」那一行（宿主 footArea 排在
// regionArea 之后）。侧栏按视口铺开就会把版本行和更新状态压到设置按钮上——这里要量出
// 宿主底栏写进 --dsh-tavern-host-foot-inset，让侧栏底部自己让位。
// 手机上外壳常比布局视口矮（手势条、地址栏），抽屉又带 transform（fixed 侧栏的包含块变成抽屉），
// 这时只有「侧栏盒子压住底栏的那一截」才是要让的高度。
const hostShell = (drawerStyle) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/tavern.css">
<style>
:root{
  --dsw-alias-label-primary:#231f18; --dsw-alias-label-secondary:#6b655c; --dsw-alias-label-tertiary:#8d877d;
  --dsw-alias-border-l2:#e2dcd1; --dsw-alias-border-l3:#d8d1c5; --dsw-alias-bg-base:#faf9f5;
  --dsw-specific-sidebar-fill:#f7f3ec; --dsw-specific-input-major:#fffdf9;
  --dsw-alias-interactive-bg-hover:#efe8dc; --dsw-alias-button-elevated-fill:#fffdf9;
  --dsw-alias-button-floating-hover:#f2ece2; --dsw-alias-brand-primary:#c8703c;
}
html,body{margin:0;height:100%}
.hRoot{height:100%;display:flex;flex-direction:column;padding:6px 12px;box-sizing:border-box;background:var(--dsw-specific-sidebar-fill)}
.hRegion{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}
.hFootArea{flex:none;display:flex;flex-direction:column}
.hSettingsArea{flex:none;width:100%;min-width:0;display:flex;padding-bottom:6px}
.hLauncher{position:relative;display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 10px;border:0;border-radius:10px;background:#ece4d6;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}
.hLauncher > .lbl{display:none}
.hLauncher[data-collapsed="false"]::after{content:"设置"}
</style></head>
<body class="dsh-tavern-shell-active">
<div data-slot="root"><div class="host_frame" data-mobile-nav="frame">
  <div class="host_sidebarCol" style="${drawerStyle}">
    <div class="hRoot">
      <div class="hRegion"><div data-slot="sidebar.workspaces"><main id="sidebar"></main></div></div>
      <div class="hFootArea"><div class="hSettingsArea" data-slot="sidebar.settings"><div><div data-slot="settings.launcher"><button class="hLauncher" data-signed-out="true" data-collapsed="false"><span>···</span><span class="lbl">账号</span></button></div></div></div></div>
    </div>
  </div>
</div></div>
</body></html>`

async function mountMobileSidebar(t, { drawer = 'position:fixed;inset:0;z-index:1300' } = {}) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 412, height: 906 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shell = hostShell(drawer)
  await page.route('http://tavern.test/**', async route => {
    const url = route.request().url()
    if (url.endsWith('/tavern.css')) return route.fulfill({ contentType: 'text/css', body: tavernCss })
    if (!url.includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: shell })
    const method = new URL(url).pathname.split('/').at(-1)
    const responses = {
      getUpdateStatus: { status: { phase: 'running', host: 'cli', currentVersion: '3.3.0', currentCommit: 'c'.repeat(40), stage: '安装程序', cancellable: true } },
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
  t.after(() => { if (errors.length) throw Error(errors.join('\n')) })
  return { page }
}

test('手机端整屏侧栏给宿主的「设置」行让位，更新状态不压在设置按钮上', async t => {
  const { page } = await mountMobileSidebar(t)
  assert.equal(await page.evaluate(() => matchMedia('(max-width: 1023px) and (pointer: coarse)').matches), true, '手机断点生效')
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
  await page.locator('.dsh-tavern-update-status').waitFor({ state: 'visible' })
  // 侧栏是整屏 fixed，量宿主底栏高度时以宿主 regionArea 的下沿为准。
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--dsh-tavern-host-foot-inset').trim() !== '')

  const measured = await page.evaluate(() => {
    const region = document.querySelector('[data-slot="sidebar.workspaces"]').parentElement
    const sidebar = document.querySelector('.dsh-tavern-sidebar:not(.collapsed)')
    const pill = document.querySelector('.hLauncher').getBoundingClientRect()
    const update = document.querySelector('.dsh-tavern-update').getBoundingClientRect()
    return {
      hostFoot: Math.round(window.innerHeight - region.getBoundingClientRect().bottom),
      insetVar: parseFloat(document.documentElement.style.getPropertyValue('--dsh-tavern-host-foot-inset')),
      paddingBottom: parseFloat(getComputedStyle(sidebar).paddingBottom),
      pillTop: Math.round(pill.top), updateBottom: Math.round(update.bottom),
      pillHit: (() => { const el = document.elementFromPoint(pill.left + 12, (pill.top + pill.bottom) / 2); return el ? (el.closest('[data-slot="settings.launcher"]') ? 'settings' : el.className || el.tagName) : null })(),
    }
  })
  assert.ok(measured.hostFoot > 0, '宿主底栏确实占着高度：' + JSON.stringify(measured))
  assert.equal(measured.insetVar, measured.hostFoot, '让位高度就是侧栏盒子压住底栏的那一截：' + JSON.stringify(measured))
  assert.ok(measured.paddingBottom >= measured.hostFoot + 11, '侧栏底部让出了宿主底栏高度：' + JSON.stringify(measured))
  assert.ok(measured.updateBottom <= measured.pillTop, '更新状态不再压到设置按钮上：' + JSON.stringify(measured))
  assert.equal(measured.pillHit, 'settings', '宿主设置按钮仍然可点')

  // 让位高度就是这个变量：清零后同一屏立刻退回错位状态（防止断言在没让位时也通过）。
  const withoutInset = await page.evaluate(() => {
    document.documentElement.style.setProperty('--dsh-tavern-host-foot-inset', '0px')
    const pill = document.querySelector('.hLauncher').getBoundingClientRect()
    const update = document.querySelector('.dsh-tavern-update').getBoundingClientRect()
    return { pillTop: Math.round(pill.top), updateBottom: Math.round(update.bottom) }
  })
  assert.ok(withoutInset.updateBottom > withoutInset.pillTop, '没有让位高度时确实会压上去：' + JSON.stringify(withoutInset))
})

test('外壳比布局视口矮时只让出真正重叠的那一截，底部不留大块空白', async t => {
  // 手机实况：抽屉带 transform（fixed 侧栏的包含块变成抽屉）且比 window.innerHeight 矮一截，
  // 用 innerHeight 减底栏上沿会让出「比底栏多一条系统栏」的空白。
  const { page } = await mountMobileSidebar(t, { drawer: 'position:fixed;left:0;right:0;top:0;height:640px;transform:translateX(0);z-index:1300' })
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
  await page.locator('.dsh-tavern-update-status').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--dsh-tavern-host-foot-inset').trim() !== '')

  const measured = await page.evaluate(() => {
    const region = document.querySelector('[data-slot="sidebar.workspaces"]').parentElement
    const sidebar = document.querySelector('.dsh-tavern-sidebar:not(.collapsed)')
    const pill = document.querySelector('.hLauncher').getBoundingClientRect()
    const update = document.querySelector('.dsh-tavern-update').getBoundingClientRect()
    const own = sidebar.getBoundingClientRect()
    const foot = region.parentElement.getBoundingClientRect()
    return {
      innerHeight: window.innerHeight,
      ownBottom: Math.round(own.bottom),
      footBottom: Math.round(foot.bottom),
      overlap: Math.round(own.bottom - region.getBoundingClientRect().bottom),
      insetVar: parseFloat(document.documentElement.style.getPropertyValue('--dsh-tavern-host-foot-inset')),
      gap: Math.round(pill.top - update.bottom),
      pillHit: (() => { const el = document.elementFromPoint(pill.left + 12, (pill.top + pill.bottom) / 2); return el ? (el.closest('[data-slot="settings.launcher"]') ? 'settings' : el.className || el.tagName) : null })(),
    }
  })
  assert.ok(measured.ownBottom < measured.innerHeight, '外壳确实比布局视口矮：' + JSON.stringify(measured))
  assert.equal(measured.ownBottom, measured.footBottom, '固定侧栏跟着抽屉收在同一高度：' + JSON.stringify(measured))
  assert.equal(measured.insetVar, measured.overlap, '让位高度按重叠那一截算：' + JSON.stringify(measured))
  assert.ok(measured.insetVar < 80, '不会把视口与外壳的差值也算成底栏：' + JSON.stringify(measured))
  assert.ok(measured.gap > -1 && measured.gap <= 24, '版本行和设置行之间只留常规间距：' + JSON.stringify(measured))
  assert.equal(measured.pillHit, 'settings', '宿主设置按钮仍然可点')
})
