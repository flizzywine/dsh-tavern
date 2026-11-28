import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('DSH 0.2.2 顶栏 _titleCluster 的 mask-image 不得裁掉移动端左侧栏按钮', { timeout: 60000 }, async t => {
  const { chromium } = await import('playwright')
  const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())

  // 复现 DSH 0.2.2-rc.5 的 _titleCluster 渐隐蒙版与 dsh-web-mobile 绝对定位到左侧的目录开关
  const hostCss = `
    .wSkVaW_header { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); padding: 0 8px; }
    .wSkVaW_headerLeading { grid-area: 1 / 1; width: 0; }
    .wSkVaW_titleRow { grid-column: 2; display: flex; align-items: center; min-height: 40px; padding-left: 32px; }
    .wSkVaW_titleCluster {
      --title-cluster-fade: 20px;
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
      margin: -4px calc(-1 * var(--title-cluster-fade)) -4px -4px;
      padding: 4px var(--title-cluster-fade) 4px 4px;
      mask-image: linear-gradient(to left, transparent calc(.3 * var(--title-cluster-fade)), #000 var(--title-cluster-fade));
      -webkit-mask-image: linear-gradient(to left, transparent calc(.3 * var(--title-cluster-fade)), #000 var(--title-cluster-fade));
      overflow: auto hidden;
    }
    .wSkVaW_headerActions { display: flex; align-items: center; flex: none; margin-left: auto; overflow: auto; }
    [data-mobile-nav="toggle"] {
      position: absolute; left: 8px; top: 6px; z-index: 2;
      width: 28px; height: 28px; padding: 0; border: 0;
    }
  `
  // 必须显式声明视口：isMobile 仿真在缺少 viewport meta 时会退回 980px 布局视口，
  // 页面被自动缩放后 elementFromPoint 的坐标与 getBoundingClientRect 不再同一空间，
  // 命中判定会随缩放时序抖动（Linux headless 下稳定失败）。
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${hostCss}</style></head>
    <body class="dsh-tavern-shell-active">
      <div class="pI_x6G_frame" data-mobile-nav="frame" data-sidebar-drawer="true" data-sidebar-collapsed="true">
        <!-- 真实 DSH 抽屉里 frame 的首个子元素是带 data-sidebar-mask 的侧栏槽位；
             缺了它，tavern.css 的抽屉规则会把下面的 _root 当成侧栏列横向整体位移，
             按钮被推出视口，命中判定就与顶栏蒙版无关了。 -->
        <div class="_sidebarCol" data-sidebar-mask="true" hidden></div>
        <div class="wSkVaW_root" data-phase="active">
          <header class="wSkVaW_header">
            <div class="wSkVaW_headerLeading"></div>
            <div class="wSkVaW_titleRow">
              <div class="wSkVaW_titleCluster">
                <nav class="wSkVaW_crumbs"><span>测试会话</span></nav>
                <div class="wSkVaW_headerActions">
                  <button type="button" data-mobile-nav="toggle" aria-label="打开目录">☰</button>
                </div>
              </div>
            </div>
          </header>
        </div>
      </div>
    </body></html>`

  const settleLayout = page => page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)))
  }))
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await mobilePage.setContent(html)
  await settleLayout(mobilePage)
  const hitBefore = await mobilePage.evaluate(() => {
    const btn = document.querySelector('[data-mobile-nav="toggle"]')
    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return Boolean(hit && hit.closest('[data-mobile-nav="toggle"]'))
  })
  assert.equal(hitBefore, false, '未加载 tavern.css 时，DSH 0.2.2 的 mask-image 应裁掉位于 _titleCluster 左侧外的目录开关')

  await mobilePage.addStyleTag({ content: tavernCss })
  await settleLayout(mobilePage)
  const after = await mobilePage.evaluate(() => {
    const tc = document.querySelector('.wSkVaW_titleCluster')
    const btn = document.querySelector('[data-mobile-nav="toggle"]')
    let clicked = false
    btn.addEventListener('click', () => { clicked = true })
    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (hit) hit.click()
    return {
      maskImage: getComputedStyle(tc).maskImage,
      hitToggle: Boolean(hit && hit.closest('[data-mobile-nav="toggle"]')),
      clicked,
    }
  })
  assert.equal(after.maskImage, 'none', '触屏窄屏下应关闭 _titleCluster 的 mask-image')
  assert.equal(after.hitToggle, true, '加载 tavern.css 后应能命中左侧栏按钮')
  assert.equal(after.clicked, true, '点击左侧栏按钮应正常触发事件')

  const desktopPage = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false })
  await desktopPage.setContent(html)
  await desktopPage.addStyleTag({ content: tavernCss })
  await settleLayout(desktopPage)
  const desktopMask = await desktopPage.evaluate(() => getComputedStyle(document.querySelector('.wSkVaW_titleCluster')).maskImage)
  assert.notEqual(desktopMask, 'none', '桌面端应保留宿主原有的 _titleCluster 渐隐蒙版')
})
