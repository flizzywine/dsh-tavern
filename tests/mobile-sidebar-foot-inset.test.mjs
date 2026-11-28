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
/* 真实宿主：底栏里「设置」上面还有一条 footerActions（整屏侧栏铺开时画在侧栏之下、看不见，
   空着时也占 34px），「设置」那一行在它下面。 */
.hFooterActions{flex:none;height:34px}
.hSettingsArea{flex:none;width:100%;min-width:0;display:flex;padding:4px 0}
.hLauncher{position:relative;display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 10px;border:0;border-radius:10px;background:#ece4d6;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}
.hFooterButton{width:100%;height:34px;border:0;background:none;font:inherit;font-size:14px;cursor:pointer}
.hLauncher > .lbl{display:none}
.hLauncher[data-collapsed="false"]::after{content:"设置"}
</style></head>
<body class="dsh-tavern-shell-active">
<div data-slot="root"><div class="host_frame" data-mobile-nav="frame">
  <div class="host_sidebarCol" style="${drawerStyle}">
    <div class="hRoot">
      <div class="hRegion"><div data-slot="sidebar.workspaces"><main id="sidebar"></main></div></div>
      <div class="hFootArea"><div class="hFooterActions"><button class="hFooterButton">导出会话日志</button></div><div class="hSettingsArea" data-slot="sidebar.settings"><div><div data-slot="settings.launcher"><button class="hLauncher" data-signed-out="true" data-collapsed="false"><span>···</span><span class="lbl">账号</span></button></div></div></div></div>
    </div>
  </div>
</div></div>
</body></html>`

const RUNNING_STATUS = { phase: 'running', host: 'cli', currentVersion: '3.3.0', currentCommit: 'c'.repeat(40), stage: '安装程序', cancellable: true }

async function mountMobileSidebar(t, { drawer = 'position:fixed;inset:0;z-index:1300', status = RUNNING_STATUS, html = null } = {}) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 412, height: 906 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const shell = html || hostShell(drawer)
  await page.route('http://tavern.test/**', async route => {
    const url = route.request().url()
    if (url.endsWith('/tavern.css')) return route.fulfill({ contentType: 'text/css', body: tavernCss })
    if (!url.includes('/api/dsh-tavern/')) return route.fulfill({ contentType: 'text/html', body: shell })
    const method = new URL(url).pathname.split('/').at(-1)
    const responses = {
      getUpdateStatus: { status },
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

test('手机端整屏侧栏把「设置」与版本/更新按钮压到同一行，更新状态排在上方且两侧按钮均可点', async t => {
  const { page } = await mountMobileSidebar(t)
  assert.equal(await page.evaluate(() => matchMedia('(max-width: 1023px) and (pointer: coarse)').matches), true, '手机断点生效')
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
  await page.locator('.dsh-tavern-update-status').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--dsh-tavern-host-settings-inset').trim() !== '')

  const measured = await page.evaluate(() => {
    const sidebar = document.querySelector('.dsh-tavern-sidebar:not(.collapsed)')
    const pill = document.querySelector('.hLauncher').getBoundingClientRect()
    const updateRow = document.querySelector('.dsh-tavern-update-row').getBoundingClientRect()
    const identity = document.querySelector('.dsh-tavern-update-identity').getBoundingClientRect()
    const status = document.querySelector('.dsh-tavern-update-status').getBoundingClientRect()
    const cancelBtn = document.querySelector('.dsh-tavern-update-actions button:last-child').getBoundingClientRect()
    const hitAt = (x, y) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return null
      if (el.closest('[data-slot="settings.launcher"]')) return 'settings'
      if (el.closest('.dsh-tavern-update-button')) return 'update-button'
      return el.className || el.tagName
    }
    return {
      pillTop: Math.round(pill.top), pillBottom: Math.round(pill.bottom), pillRight: Math.round(pill.right),
      rowTop: Math.round(updateRow.top), rowBottom: Math.round(updateRow.bottom),
      identityLeft: Math.round(identity.left),
      statusBottom: Math.round(status.bottom),
      paddingBottom: parseFloat(getComputedStyle(sidebar).paddingBottom),
      footBottomVar: parseFloat(document.documentElement.style.getPropertyValue('--dsh-tavern-host-foot-bottom') || '0'),
      pillHit: hitAt(pill.left + 12, (pill.top + pill.bottom) / 2),
      actionHit: hitAt((cancelBtn.left + cancelBtn.right) / 2, (cancelBtn.top + cancelBtn.bottom) / 2),
    }
  })
  assert.ok(Math.abs(measured.rowBottom - measured.pillBottom) <= 2, '版本行底边与设置按钮底边对齐：' + JSON.stringify(measured))
  assert.ok(Math.abs(measured.rowTop - measured.pillTop) <= 2, '版本行顶边与设置按钮顶边对齐（合并为同一行）：' + JSON.stringify(measured))
  assert.ok(measured.identityLeft >= measured.pillRight + 6, '版本文字在设置按钮右侧且留有间距，互不遮挡：' + JSON.stringify(measured))
  assert.ok(measured.statusBottom <= measured.rowTop, '更新进度提示排在单行底栏上方，不压到设置按钮：' + JSON.stringify(measured))
  assert.equal(measured.paddingBottom, measured.footBottomVar, '底边只留设置按钮下方的安全距离：' + JSON.stringify(measured))
  assert.equal(measured.pillHit, 'settings', '宿主设置按钮仍然可点')
  assert.equal(measured.actionHit, 'update-button', '同行右侧的更新按钮可点击（不被宿主底栏容器拦住）')
})

test('手机端发现新构建时，目标构建写在版本行里，不再单占一行状态', async t => {
  const { page } = await mountMobileSidebar(t, { status: { phase: 'update-available', host: 'cli', currentVersion: '3.3.0', currentCommit: 'a390af1c0ffee5', latestCommit: '6e511e9d4f00d' } })
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
  await page.locator('.dsh-tavern-update-identity').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.dsh-tavern-update-status').count(), 0, '「发现新构建 ×××」不再单占一行')
  const identity = await page.evaluate(() => {
    const wide = document.querySelector('.dsh-tavern-update-identity-wide')
    const compact = document.querySelector('.dsh-tavern-update-identity-compact')
    return {
      shown: document.querySelector('.dsh-tavern-update-identity').innerText.trim(),
      wideDisplay: getComputedStyle(wide).display, compactDisplay: getComputedStyle(compact).display,
      compactText: compact.textContent.trim(),
      update: Math.round(document.querySelector('.dsh-tavern-update').getBoundingClientRect().height),
    }
  })
  assert.equal(identity.wideDisplay, 'none', '手机上看缩短版：' + JSON.stringify(identity))
  assert.notEqual(identity.compactDisplay, 'none', '手机上看缩短版：' + JSON.stringify(identity))
  assert.equal(identity.compactText, 'v3.3.0 · a390af1 → 6e511e9', '目标构建就在版本行里：' + JSON.stringify(identity))
  assert.equal(identity.shown, 'v3.3.0 · a390af1 → 6e511e9', '版本行只显示缩短版：' + JSON.stringify(identity))
  assert.ok(identity.update <= 44, '更新块只剩与设置同行的一行，没有多出来的状态行：' + JSON.stringify(identity))
})

test('外壳比布局视口矮时底栏仍与设置按钮对齐为同一行，底部不留大块空白', async t => {
  // 手机实况：抽屉带 transform（fixed 侧栏的包含块变成抽屉）且比 window.innerHeight 矮一截。
  const { page } = await mountMobileSidebar(t, { drawer: 'position:fixed;left:0;right:0;top:0;height:640px;transform:translateX(0);z-index:1300' })
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
  await page.locator('.dsh-tavern-update-status').waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--dsh-tavern-host-settings-inset').trim() !== '')

  const measured = await page.evaluate(() => {
    const region = document.querySelector('[data-slot="sidebar.workspaces"]').parentElement
    const sidebar = document.querySelector('.dsh-tavern-sidebar:not(.collapsed)')
    const pill = document.querySelector('.hLauncher').getBoundingClientRect()
    const updateRow = document.querySelector('.dsh-tavern-update-row').getBoundingClientRect()
    const identity = document.querySelector('.dsh-tavern-update-identity').getBoundingClientRect()
    const own = sidebar.getBoundingClientRect()
    const foot = region.parentElement.getBoundingClientRect()
    return {
      innerHeight: window.innerHeight,
      ownBottom: Math.round(own.bottom),
      footBottom: Math.round(foot.bottom),
      pillTop: Math.round(pill.top), pillBottom: Math.round(pill.bottom), pillRight: Math.round(pill.right),
      rowTop: Math.round(updateRow.top), rowBottom: Math.round(updateRow.bottom),
      identityLeft: Math.round(identity.left),
      pillHit: (() => { const el = document.elementFromPoint(pill.left + 12, (pill.top + pill.bottom) / 2); return el ? (el.closest('[data-slot="settings.launcher"]') ? 'settings' : el.className || el.tagName) : null })(),
    }
  })
  assert.ok(measured.ownBottom < measured.innerHeight, '外壳确实比布局视口矮：' + JSON.stringify(measured))
  assert.equal(measured.ownBottom, measured.footBottom, '固定侧栏跟着抽屉收在同一高度：' + JSON.stringify(measured))
  assert.ok(Math.abs(measured.rowBottom - measured.pillBottom) <= 2, '版本行底边与设置按钮对齐：' + JSON.stringify(measured))
  assert.ok(Math.abs(measured.rowTop - measured.pillTop) <= 2, '版本行与设置按钮合并成同一行：' + JSON.stringify(measured))
  assert.ok(measured.identityLeft >= measured.pillRight + 6, '版本行横向避开设置按钮：' + JSON.stringify(measured))
  assert.equal(measured.pillHit, 'settings', '宿主设置按钮仍然可点')
})

test('手机端未在更新时隐藏底部更新详情行（含检查中与带警告的检查结果）', async t => {
  for (const status of [
    { phase: 'checking', host: 'cli', currentVersion: '3.3.0', currentCommit: 'a390af1c0ffee5' },
    { phase: 'up-to-date', host: 'cli', currentVersion: '3.3.0', currentCommit: 'a390af1c0ffee5', checkWarning: 'GitHub 核实不可用；CDN 可能有数小时缓存延迟。' },
    { phase: 'update-available', host: 'cli', currentVersion: '3.3.0', currentCommit: 'a390af1c0ffee5', latestCommit: '6e511e9d4f00d', checkWarning: 'GitHub 核实不可用；已发现清单上的较新构建。' },
    { phase: 'check-failed', host: 'cli', currentVersion: '3.3.0', currentCommit: 'a390af1c0ffee5', error: '暂时无法确认最新版本' },
  ]) {
    const { page } = await mountMobileSidebar(t, { status })
    await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
    await page.waitForFunction(() => document.querySelector('.dsh-tavern-update-identity')?.textContent?.includes('v3.3.0'))
    const detail = await page.evaluate(() => {
      const el = document.querySelector('.dsh-tavern-update-status')
      return {
        exists: Boolean(el),
        attr: el?.getAttribute('data-mobile-update-detail') ?? null,
        display: el ? getComputedStyle(el).display : null,
        identity: document.querySelector('.dsh-tavern-update-identity')?.innerText?.trim() ?? '',
      }
    })
    assert.equal(detail.exists, true, `${status.phase} 仍保留 DOM 给宽屏展示：` + JSON.stringify(detail))
    assert.equal(detail.attr, 'hidden', `${status.phase} 在移动端标记为隐藏：` + JSON.stringify(detail))
    assert.equal(detail.display, 'none', `${status.phase} 在移动端隐藏更新详情行：` + JSON.stringify(detail))
    if (status.phase === 'update-available') {
      assert.equal(detail.identity, 'v3.3.0 · a390af1 → 6e511e9', '带警告发现更新时移动端版本行仍附带目标构建')
    }
    await page.context().close()
  }
})

test('DSH 0.2.2 侧栏多了 _scrollRegion 与 scrollport 包裹层时，仍只避开「设置」行且响应底栏异步挂载', async t => {
  const dsh022Shell = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
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
.hHd-Xa_root{height:100%;display:flex;flex-direction:column;padding:6px 8px;box-sizing:border-box;background:var(--dsw-specific-sidebar-fill)}
.hHd-Xa_scrollRegion{flex:1;min-height:0;margin-top:4px;display:flex;flex-direction:column;position:relative;container-type:size}
.hHd-Xa_scrollArea{display:grid;grid-template-columns:4px minmax(0,1fr) 6px;grid-template-rows:8px max-content 2px max-content;align-content:start;flex:1;min-height:0;overflow:hidden auto}
.hHd-Xa_regionArea{grid-area:4/2;display:flex;flex-direction:column;min-width:0;min-height:0}
.hHd-Xa_footArea{flex:none;display:flex;flex-direction:column}
.hHd-Xa_footerActions{flex:none;width:100%;min-width:0;display:flex}
.hFooterButton{width:100%;height:42px;border:0;background:none;font:inherit;font-size:14px}
.hHd-Xa_settingsArea{flex:none;width:100%;min-width:0}
[data-slot="sidebar.settings"]{display:contents}
.VOzbGW_triggerRow{display:flex;align-items:center;width:100%;margin:4px 0;position:relative}
.yHnPSG_trigger{display:flex;align-items:center;gap:8px;width:100%;height:44px;padding:6px 10px;border:0;border-radius:10px;background:#ece4d6;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}
</style></head>
<body class="dsh-tavern-shell-active">
<div data-slot="root"><div class="host_frame" data-mobile-nav="frame" data-sidebar-drawer>
  <div class="host_sidebarCol" style="position:fixed;inset:0;z-index:1300">
    <div class="hHd-Xa_root" role="dialog" data-shortcut-modal="sidebar" aria-modal="true">
      <div class="hHd-Xa_scrollRegion">
        <div class="hHd-Xa_scrollArea" data-sidebar-scrollport="">
          <div class="hHd-Xa_regionArea"><div data-slot="sidebar.workspaces"><main id="sidebar"></main></div></div>
        </div>
      </div>
      <div class="hHd-Xa_footArea">
        <div class="hHd-Xa_footerActions"><div data-slot="sidebar.footer.action"><button class="hFooterButton">导出会话日志</button></div></div>
        <div class="hHd-Xa_settingsArea"><div data-slot="sidebar.settings"></div></div>
      </div>
    </div>
  </div>
</div></div>
</body></html>`

  const { page } = await mountMobileSidebar(t, {
    html: dsh022Shell,
    status: { phase: 'idle', host: 'cli', currentVersion: '3.5.0', currentCommit: 'a2fc3a4000000' },
  })
  await page.locator('.dsh-tavern-sidebar:not(.collapsed)').waitFor({ state: 'attached' })
  await page.waitForFunction(() => document.querySelector('.dsh-tavern-update-identity')?.textContent?.includes('v3.5.0'))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

  // 1) sidebar.settings 尚未挂载内容时，不把隐藏的 footerActions 算成底部空白。
  const beforeSettings = await page.evaluate(() => ({
    inset: document.documentElement.style.getPropertyValue('--dsh-tavern-host-foot-inset').trim(),
    footerActionsHeight: Math.round(document.querySelector('.hHd-Xa_footerActions').getBoundingClientRect().height),
  }))
  assert.ok(beforeSettings.footerActionsHeight >= 40, 'footerActions 占着高度：' + JSON.stringify(beforeSettings))
  assert.equal(beforeSettings.inset, '', '设置行未挂载时不应为隐藏的 footerActions 让出空白：' + JSON.stringify(beforeSettings))

  // 2) 宿主异步挂载「设置」按钮后，即使 _root 高度 100% 不变，ResizeObserver 也应立刻重算，把「设置」与版本/检查更新压缩为同一行。
  await page.evaluate(() => {
    document.querySelector('[data-slot="sidebar.settings"]').innerHTML =
      '<div class="VOzbGW_triggerRow"><div data-slot="settings.launcher"><div class="yHnPSG_root"><div class="yHnPSG_anchor"><button class="yHnPSG_trigger" data-signed-out="true" data-collapsed="false"><span>···</span><span>设置</span></button></div></div></div></div>'
  })
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--dsh-tavern-host-settings-inset').trim() !== '')

  const measureSingleRow = () => page.evaluate(() => {
    const button = document.querySelector('.yHnPSG_trigger').getBoundingClientRect()
    const update = document.querySelector('.dsh-tavern-update').getBoundingClientRect()
    const updateRow = document.querySelector('.dsh-tavern-update-row').getBoundingClientRect()
    const identity = document.querySelector('.dsh-tavern-update-identity').getBoundingClientRect()
    const checkBtn = document.querySelector('.dsh-tavern-update-button').getBoundingClientRect()
    const hitAt = (x, y) => {
      const el = document.elementFromPoint(x, y)
      if (!el) return null
      if (el.closest('[data-slot="settings.launcher"]')) return 'settings'
      if (el.closest('.dsh-tavern-update-button')) return 'check-update'
      return el.className || el.tagName
    }
    return {
      buttonLeft: Math.round(button.left), buttonRight: Math.round(button.right),
      buttonTop: Math.round(button.top), buttonBottom: Math.round(button.bottom),
      updateHeight: Math.round(update.height),
      rowTop: Math.round(updateRow.top), rowBottom: Math.round(updateRow.bottom),
      identityLeft: Math.round(identity.left),
      settingsHit: hitAt(button.left + 12, (button.top + button.bottom) / 2),
      checkHit: hitAt((checkBtn.left + checkBtn.right) / 2, (checkBtn.top + checkBtn.bottom) / 2),
    }
  })

  const measured = await measureSingleRow()
  assert.ok(measured.buttonLeft < 24, '设置按钮留在左下角：' + JSON.stringify(measured))
  assert.ok(measured.updateHeight <= 44, '底部整个区域压缩成单行：' + JSON.stringify(measured))
  assert.ok(Math.abs(measured.rowTop - measured.buttonTop) <= 2, '版本行顶边与设置按钮对齐：' + JSON.stringify(measured))
  assert.ok(Math.abs(measured.rowBottom - measured.buttonBottom) <= 2, '版本行底边与设置按钮对齐：' + JSON.stringify(measured))
  assert.ok(measured.identityLeft >= measured.buttonRight + 6, '版本文字排在设置按钮右侧不重叠：' + JSON.stringify(measured))
  assert.equal(measured.settingsHit, 'settings', '宿主设置按钮仍可点击')
  assert.equal(measured.checkHit, 'check-update', '同行右侧的「检查更新」按钮可点击')

  // 3) 加载纸感皮肤后，移动端仍保持同一单行（设置按钮不被桌面规则 fixed 到 206px）。
  const paperCss = await readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8')
  await page.addStyleTag({ content: paperCss })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const paperMeasured = await measureSingleRow()
  assert.ok(paperMeasured.buttonLeft < 24, '纸感皮肤在移动端设置按钮仍留在左下角：' + JSON.stringify(paperMeasured))
  assert.ok(Math.abs(paperMeasured.rowBottom - paperMeasured.buttonBottom) <= 2, '纸感皮肤在移动端底栏仍对齐单行：' + JSON.stringify(paperMeasured))
  assert.equal(paperMeasured.settingsHit, 'settings', '纸感皮肤下设置按钮仍可点')
  assert.equal(paperMeasured.checkHit, 'check-update', '纸感皮肤下检查更新按钮仍可点')
})
