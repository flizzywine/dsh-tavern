import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('DSH 0.2.2 移动端设置弹窗恢复圆角弹层、紧凑导航与字号步进器排版，桌面端保持原样', { timeout: 60000 }, async t => {
  const { chromium } = await import('playwright')
  const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())

  // 复现 DSH 0.2.2-rc.5 四直子 grid 设置弹窗、FontSizeRow 与 dsh-web-mobile@3.1.0 误命中的导出弹窗规则
  const hostAndWebMobileCss = `
    :root {
      --dsw-alias-bg-layer-1: #fff;
      --dsw-alias-bg-layer-2: #fff;
      --dsw-alias-bg-mask-1: rgba(0,0,0,.24);
      --dsw-alias-bg-module-platform: #f4f2ee;
      --dsw-alias-border-l2: rgba(0,0,0,.1);
      --dsw-alias-interactive-bg-hover: rgba(0,0,0,.06);
      --dsw-alias-label-primary: #1a1a1a;
      --dsw-alias-label-secondary: #555;
      --dsw-alias-label-tertiary: #777;
      --dsw-alias-state-error-primary: #c93b2b;
      --dsw-radius-xs: 4px;
      --dsw-radius-sm: 6px;
      --dsw-radius-md: 10px;
      --dsw-radius-panel: 16px;
    }
    body { margin: 0; font-family: system-ui, sans-serif; }
    .VOzbGW_overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .VOzbGW_mask { position: absolute; inset: 0; background: var(--dsw-alias-bg-mask-1); }
    .VOzbGW_panel {
      position: relative; z-index: 1; display: grid;
      grid-template-columns: 188px minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-areas: 'title header' 'nav options';
      width: 800px; height: min(800px, calc(100vh - 48px)); max-width: calc(100vw - 48px);
      border-radius: var(--dsw-radius-panel); overflow: hidden; background: var(--dsw-alias-bg-layer-2);
    }
    .VOzbGW_navTitle { grid-area: title; padding: 22px 12px 8px 24px; font-size: 16px; line-height: 24px; }
    .VOzbGW_nav { grid-area: nav; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 10px 12px 0; box-sizing: border-box; }
    .VOzbGW_navList { display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow-y: auto; }
    .VOzbGW_navCell { display: flex; align-items: center; gap: 8px; height: 40px; padding: 9px 16px 9px 12px; box-sizing: border-box; border: none; border-radius: 10px; background: transparent; font-size: 14px; }
    .VOzbGW_navLabel { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .VOzbGW_header { grid-area: header; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; height: 54px; padding: 20px 14px 8px 10px; box-sizing: border-box; }
    .VOzbGW_actions { min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; }
    .VOzbGW_close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: transparent; }
    .VOzbGW_options { grid-area: options; min-width: 0; min-height: 0; padding: 0 24px 24px; overflow-y: auto; }
    @media (max-width: 767px) {
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_overlay { position: absolute; height: 100%; background: var(--dsw-alias-bg-layer-2); }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_panel {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-rows: auto auto minmax(0, 1fr);
        grid-template-areas: 'title header' 'nav nav' 'options options';
        width: 100%; max-width: none; height: 100%; border-radius: 0;
      }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_navTitle { padding: 22px 0 0 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_header { height: auto; padding: 20px 16px 0 10px; }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_nav { padding: 0; }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_navList { flex-direction: row; gap: 4px; padding: 12px 16px 14px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_navCell { flex: 1 0 auto; justify-content: center; min-width: 108px; padding: 0 14px; }
      html:not([data-windows-titlebar]):not([data-platform='darwin']) .VOzbGW_options { padding: 0 16px 24px; }
    }
    .bVCLcG_row { display: flex; align-items: center; gap: 8px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
    .bVCLcG_rowText { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 48px; }
    .bVCLcG_desc { font-size: 12px; line-height: 18px; }
    .bVCLcG_control { display: inline-flex; align-items: center; gap: 8px; }
    .bVCLcG_stepper { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 72px; height: 36px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }
    .bVCLcG_arrows { position: absolute; right: 8px; display: flex; flex-direction: column; gap: 2px; opacity: 1; }
    .bVCLcG_arrow { display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 12px; padding: 0; border: none; border-radius: 4px; background: #fff; }
    .bVCLcG_expander { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; background: transparent; }
    @media (max-width: 1023px) and (pointer: coarse) {
      [aria-modal="true"]:not(:has(> :first-child > :last-child > button)) { max-width: calc(100vw - 32px); }
    }
  `

  const longRows = Array.from({ length: 12 }, (_, i) => `<div class="bVCLcG_row"><div class="bVCLcG_rowText"><div>设置项 ${i + 1}</div><div class="bVCLcG_desc">说明 ${i + 1}</div></div></div>`).join('')
  const html = `<!doctype html><html class="dsh-tavern-viewport-pinned"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${hostAndWebMobileCss}</style></head>
  <body class="dsh-tavern-shell-active">
    <div id="root"><div data-slot="root"><div class="pI_x6G_frame" data-mobile-nav="frame" data-sidebar-collapsed="true"></div></div></div>
    <div class="VOzbGW_overlay" role="presentation">
      <div class="VOzbGW_mask" aria-hidden="true"></div>
      <div class="VOzbGW_panel" data-shortcut-modal="settings" role="dialog" aria-modal="true">
        <div class="VOzbGW_navTitle">设置</div>
        <nav class="VOzbGW_nav">
          <div class="VOzbGW_navList">
            <button type="button" class="VOzbGW_navCell" aria-current="true"><span class="VOzbGW_navLabel">通用设置</span></button>
            <button type="button" class="VOzbGW_navCell"><span class="VOzbGW_navLabel">Theme / 外观</span></button>
            <button type="button" class="VOzbGW_navCell"><span class="VOzbGW_navLabel">模型</span></button>
            <button type="button" class="VOzbGW_navCell"><span class="VOzbGW_navLabel">DSH Tavern</span></button>
          </div>
        </nav>
        <div class="VOzbGW_header">
          <div class="VOzbGW_actions"><span role="alert">无法打开配置文件</span><button type="button">打开配置文件</button></div>
          <button type="button" class="VOzbGW_close" aria-label="关闭">✕</button>
        </div>
        <div class="VOzbGW_options">
          <div class="bVCLcG_row" id="font-size-row">
            <div class="bVCLcG_rowText"><div>字号大小</div><div class="bVCLcG_desc">仅影响会话内容的字号</div></div>
            <div class="bVCLcG_control">
              <div class="bVCLcG_stepper"><span class="bVCLcG_value">20</span><span class="bVCLcG_arrows"><button type="button" class="bVCLcG_arrow">⌃</button><button type="button" class="bVCLcG_arrow">⌄</button></span></div>
              <span class="bVCLcG_unit">px</span>
              <button type="button" class="bVCLcG_expander">⌄</button>
            </div>
          </div>
          ${longRows}
        </div>
      </div>
    </div>
  </body></html>`

  const settle = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))

  for (const size of [{ width: 390, height: 844 }, { width: 412, height: 915 }]) {
    const page = await browser.newPage({ viewport: size, hasTouch: true, isMobile: true })
    await page.setContent(html)
    await page.addStyleTag({ content: tavernCss })
    await settle(page)
    const m = await page.evaluate(() => {
      const panel = document.querySelector('.VOzbGW_panel')
      const overlay = document.querySelector('.VOzbGW_overlay')
      const navTitle = document.querySelector('.VOzbGW_navTitle')
      const actions = document.querySelector('.VOzbGW_actions')
      const navList = document.querySelector('.VOzbGW_navList')
      const tab3 = document.querySelector('.VOzbGW_navCell:nth-child(3)')
      const close = document.querySelector('.VOzbGW_close')
      const options = document.querySelector('.VOzbGW_options')
      const stepper = document.querySelector('.bVCLcG_stepper')
      const arrow = document.querySelector('.bVCLcG_arrow')
      let closeClicked = false
      close.addEventListener('click', () => { closeClicked = true })
      const cr = close.getBoundingClientRect()
      const hit = document.elementFromPoint(cr.left + cr.width / 2, cr.top + cr.height / 2)
      if (hit) hit.click()
      return {
        overlayBg: getComputedStyle(overlay).backgroundColor,
        panelRect: panel.getBoundingClientRect().toJSON(),
        panelRadius: getComputedStyle(panel).borderRadius,
        panelDisplay: getComputedStyle(panel).display,
        navTitleDisplay: getComputedStyle(navTitle).display,
        actionsDisplay: getComputedStyle(actions).display,
        navListRect: navList.getBoundingClientRect().toJSON(),
        tab3Rect: tab3.getBoundingClientRect().toJSON(),
        closeRect: cr.toJSON(),
        closeRadius: getComputedStyle(close).borderRadius,
        closeHit: Boolean(hit && hit.closest('.VOzbGW_close')),
        closeClicked,
        optionsScrolls: options.scrollHeight > options.clientHeight,
        stepperRect: stepper.getBoundingClientRect().toJSON(),
        arrowRect: arrow.getBoundingClientRect().toJSON(),
      }
    })
    assert.equal(m.panelDisplay, 'flex')
    assert.equal(m.panelRadius, '14px', '移动端设置弹层应为 14px 圆角')
    assert.equal(Math.round(m.panelRect.left), 8)
    assert.equal(Math.round(m.panelRect.width), size.width - 16, '面板宽度应为视口宽减 16px，而非被导出弹窗规则压窄 32px')
    assert.equal(m.overlayBg, 'rgba(0, 0, 0, 0)', 'overlay 不应铺不透明底色盖住页面背景')
    assert.equal(m.navTitleDisplay, 'none', '移动端隐藏冗余的「设置」标题行')
    assert.equal(m.actionsDisplay, 'none', '移动端隐藏不可用的「打开配置文件」与报错区域')
    assert.equal(Math.round(m.closeRect.width), 32)
    assert.equal(Math.round(m.closeRect.height), 32)
    assert.equal(m.closeRadius, '50%')
    assert.equal(m.closeHit, true, '右上角关闭按钮应可命中')
    assert.equal(m.closeClicked, true, '点击关闭按钮应正常触发')
    assert.ok(m.navListRect.right <= m.closeRect.left, `标签条右缘(${m.navListRect.right})不得压住关闭按钮(${m.closeRect.left})`)
    assert.ok(m.tab3Rect.width < 100, `「模型」标签应紧凑排布而非 108px 地板：${m.tab3Rect.width}`)
    assert.equal(Math.round(m.tab3Rect.height), 32)
    assert.equal(Math.round(m.stepperRect.height), 36)
    assert.equal(Math.round(m.arrowRect.width), 30)
    assert.equal(Math.round(m.arrowRect.height), 30)
    assert.ok(m.arrowRect.top > m.stepperRect.top && m.arrowRect.bottom < m.stepperRect.bottom, '字号步进按钮应在胶囊内上下对称内缩')
    assert.equal(m.optionsScrolls, true, '长设置列表应在 options 容器内正常滚动')
    await page.close()
  }

  // 平板触屏（768..1023px）居中收窄到 720px
  const tabletPage = await browser.newPage({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })
  await tabletPage.setContent(html)
  await tabletPage.addStyleTag({ content: tavernCss })
  await settle(tabletPage)
  const tabletPanel = await tabletPage.locator('.VOzbGW_panel').boundingBox()
  assert.equal(Math.round(tabletPanel.width), 720, '平板触屏设置弹层应限制在 720px 宽')
  assert.ok(Math.abs(tabletPanel.x - 50) <= 1, `平板设置弹层应水平居中：x=${tabletPanel.x}`)
  await tabletPage.close()

  // 桌面端（1280×800，非触屏）保持原始双栏 grid 与操作区
  const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false })
  await desktopPage.setContent(html)
  await desktopPage.addStyleTag({ content: tavernCss })
  await settle(desktopPage)
  const desk = await desktopPage.evaluate(() => ({
    panelDisplay: getComputedStyle(document.querySelector('.VOzbGW_panel')).display,
    navTitleDisplay: getComputedStyle(document.querySelector('.VOzbGW_navTitle')).display,
    actionsDisplay: getComputedStyle(document.querySelector('.VOzbGW_actions')).display,
    arrowWidth: document.querySelector('.bVCLcG_arrow').getBoundingClientRect().width,
  }))
  assert.equal(desk.panelDisplay, 'grid', '桌面端应保持宿主双栏 grid')
  assert.notEqual(desk.navTitleDisplay, 'none', '桌面端保留「设置」标题')
  assert.notEqual(desk.actionsDisplay, 'none', '桌面端保留「打开配置文件」按钮')
  assert.equal(Math.round(desk.arrowWidth), 17, '桌面端保留宿主原始字号微调按钮尺寸')
  await desktopPage.close()
})
