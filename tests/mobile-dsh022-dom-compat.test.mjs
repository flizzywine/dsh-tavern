import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const webMobileUrl = new URL('../node_modules/dsh-web-mobile/lib/client.js', import.meta.url)

test('dsh-web-mobile 补丁：DSH 0.2.2 侧栏 data-shortcut-modal="sidebar" 不触发 modalOpen 与 drawer-close 误拦截', { skip: !existsSync(webMobileUrl) }, async () => {
  const src = await readFile(webMobileUrl, 'utf8')
  const modalMatch = src.match(/function modalOpen\(\)\s*\{\s*return document\.querySelector\('([^']+)'\) !== null;\s*\}/)
  assert.ok(modalMatch, '未找到 modalOpen()')
  const modalSel = modalMatch[1]
  assert.match(modalSel, /:not\(\[data-shortcut-modal="sidebar"\]\)/, 'modalOpen 应排除侧栏抽屉')

  // drawer-close 内两处 [aria-modal="true"] 均应排除侧栏抽屉
  const drawerCloseIdx = src.indexOf('dsh-web-mobile: drawer close')
  assert.ok(drawerCloseIdx !== -1, '未找到 drawer-close 块')
  const drawerCloseSlice = src.slice(drawerCloseIdx, drawerCloseIdx + 2500)
  const bareChecks = [...drawerCloseSlice.matchAll(/querySelector\('([^']*aria-modal[^']*)'\)/g)].map(m => m[1])
  assert.ok(bareChecks.length >= 2, 'drawer-close 应保留模态拦截检查')
  for (const sel of bareChecks) {
    assert.match(sel, /:not\(\[data-shortcut-modal="sidebar"\]\)/, `drawer-close 选择器漏排侧栏抽屉：${sel}`)
  }

  // 用 JSDOM 实测选择器：仅侧栏展开时为 false，真正弹窗打开时为 true
  const dom = new JSDOM(`<!doctype html><body>
    <div class="pI_x6G_sidebarCol">
      <div class="hHd-Xa_root" role="dialog" data-shortcut-modal="sidebar" aria-modal="true"></div>
    </div>
  </body>`)
  assert.equal(dom.window.document.querySelector(modalSel), null, '只有侧栏展开时不应视为模态弹窗')
  const settings = dom.window.document.createElement('div')
  settings.setAttribute('role', 'dialog')
  settings.setAttribute('aria-modal', 'true')
  settings.setAttribute('data-shortcut-modal', 'settings')
  dom.window.document.body.appendChild(settings)
  assert.equal(dom.window.document.querySelector(modalSel), settings, '打开设置弹窗时应命中 modalOpen')
})

test('DSH 0.2.2 移动端 DOM 兼容：侧栏不被 aria-modal 压窄、顶栏更多/Open in App 隐藏、模型页换行与推理等级菜单 208px 限宽', { timeout: 60000 }, async t => {
  const { chromium } = await import('playwright')
  const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  const wmCss = existsSync(webMobileUrl)
    ? (() => {
        return readFile(webMobileUrl, 'utf8').then(s =>
          (s.match(/exports\.LAYOUT_CSS = `([\s\S]*?)`;/)?.[1] || '') + '\n' +
          (s.match(/exports\.MISC_CSS = `([\s\S]*?)`;/)?.[1] || ''))
      })()
    : ''
  const webMobileCss = await wmCss

  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())

  const fixtureCss = `
    body { margin: 0; font-family: system-ui, sans-serif; }
    .pI_x6G_sidebarCol { width: 100%; }
    .hHd-Xa_root { width: 100%; box-sizing: border-box; }
    .zGbnIq_rowCard { width: 328px; box-sizing: border-box; padding: 12px; }
    .zGbnIq_rowHead { display: flex; align-items: center; gap: 10px; }
    .zGbnIq_rowIdentity { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
    .zGbnIq_rowName { font-size: 14px; white-space: nowrap; }
    .zGbnIq_rowActions { display: inline-flex; gap: 4px; margin-left: auto; flex: none; }
    ._7KE1Ra_menu { min-width: 240px; width: 260px; box-sizing: border-box; }
  `

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${fixtureCss}</style>
    <style>${webMobileCss}</style>
    <style>${tavernCss}</style>
  </head><body class="dsh-tavern-shell-active">
    <div id="root"><div data-slot="root">
      <div class="pI_x6G_frame" data-mobile-nav="frame">
        <div class="pI_x6G_sidebarCol">
          <div class="hHd-Xa_root" id="sidebar-root" role="dialog" data-shortcut-modal="sidebar" aria-modal="true">侧栏</div>
        </div>
        <div class="pI_x6G_centerCol">
          <div data-phase="active">
            <header>
              <div class="wSkVaW_headerLeading"></div>
              <div class="wSkVaW_titleRow">
                <div class="wSkVaW_titleCluster"><nav class="wSkVaW_crumbs"><span>会话</span></nav></div>
                <div class="wSkVaW_headerUtilities">
                  <div class="OMoRSG_split" id="open-in-app">在应用中打开</div>
                  <button type="button" class="wSkVaW_headerMenuButton" id="header-more">⋯</button>
                </div>
              </div>
            </header>
          </div>
        </div>
      </div>
    </div></div>
    <div role="dialog" aria-modal="true" data-shortcut-modal="settings">
      <nav class="VOzbGW_nav"><div class="VOzbGW_navList"><button class="VOzbGW_navCell">模型</button></div></nav>
      <div class="VOzbGW_header"><button class="VOzbGW_close">✕</button></div>
      <div class="VOzbGW_options">
        <div class="zGbnIq_rowCard" id="model-card">
          <div class="zGbnIq_rowHead" id="model-head">
            <div class="zGbnIq_rowIdentity"><span class="zGbnIq_rowName">Super Long Custom OpenAI Compatible Provider Name</span></div>
            <div class="zGbnIq_rowActions"><button>编辑</button><button>删除</button></div>
          </div>
        </div>
      </div>
    </div>
    <div class="_7KE1Ra_menu" id="effort-menu" role="menu">
      <div class="_7KE1Ra_groups"><button role="menuitemradio">中</button><button role="menuitemradio">高</button></div>
    </div>
    <div class="_7KE1Ra_menu" id="catalog-menu" role="group">
      <div class="_7KE1Ra_groups" role="menu"><section role="group"><button role="menuitemradio">DeepSeek</button></section></div>
    </div>
  </body></html>`

  const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

  // 手机 390×844
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await phone.setContent(html)
  await settle(phone)
  const p = await phone.evaluate(() => ({
    sidebarWidth: Math.round(document.getElementById('sidebar-root').getBoundingClientRect().width),
    openInAppDisplay: getComputedStyle(document.getElementById('open-in-app')).display,
    headerMoreDisplay: getComputedStyle(document.getElementById('header-more')).display,
    rowHeadWrap: getComputedStyle(document.getElementById('model-head')).flexWrap,
    effortWidth: Math.round(document.getElementById('effort-menu').getBoundingClientRect().width),
    catalogWidth: Math.round(document.getElementById('catalog-menu').getBoundingClientRect().width),
  }))
  assert.equal(p.sidebarWidth, 390, `展开的侧栏根不应被 aria-modal 规则压窄 32px：${p.sidebarWidth}`)
  assert.equal(p.openInAppDisplay, 'none', '0.2.2 OMoRSG_split 应隐藏')
  assert.equal(p.headerMoreDisplay, 'none', '0.2.2 _headerMenuButton 应隐藏')
  assert.equal(p.rowHeadWrap, 'wrap', '0.2.2 设置→模型页提供商卡片头应允许换行')
  assert.equal(p.effortWidth, 208, `0.2.2 推理等级菜单手机端应限宽 208px：${p.effortWidth}`)
  assert.equal(p.catalogWidth, 260, `模型目录面板不应被误限宽：${p.catalogWidth}`)
  await phone.close()

  // 平板 820×1180
  const tablet = await browser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })
  await tablet.setContent(html)
  await settle(tablet)
  const tSidebar = await tablet.evaluate(() => Math.round(document.getElementById('sidebar-root').getBoundingClientRect().width))
  assert.equal(tSidebar, 820, `平板触屏侧栏根不应被 MISC_CSS 居中压成 720px：${tSidebar}`)
  await tablet.close()
})
