import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright'
import vm from './fixtures/client-vm.mjs'

const tavernCss = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const paperCss = await readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8')
const stageThemesCss = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css', import.meta.url), 'utf8')
const mobileLayoutSource = await readFile(new URL('../tavern-plugin/src/client/modules/mobile-layout.js', import.meta.url), 'utf8')
const frameTouchSource = await readFile(new URL('../tavern-plugin/src/client/modules/frame-touch-scroll.js', import.meta.url), 'utf8')
const webMobileUrl = new URL('../node_modules/dsh-web-mobile/lib/client.js', import.meta.url)

test('移动端左侧栏抽屉在收起与展开态保持恒定 100vw 宽度且列表项启用视口外跳过', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await context.newPage()

  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${tavernCss}</style>
    <style>${paperCss}</style>
  </head><body class="dsh-tavern-shell-active">
    <div data-slot="root">
      <div class="VFpnAa_frame" data-mobile-nav="frame" data-sidebar-drawer="true" data-sidebar-collapsed="true">
        <div class="VFpnAa_drawerMask" data-sidebar-mask="true"></div>
        <div class="VFpnAa_sidebarCol">
          <div class="dsh-tavern-sidebar collapsed"></div>
          <div class="dsh-tavern-side-list">
            <section class="dsh-tavern-history-group" id="g1"></section>
            <div class="dsh-tavern-side-row" id="r1"></div>
            <div class="dsh-tavern-side-row" id="r2"><div class="dsh-tavern-side-row-menu"></div></div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`)

  const collapsedMetrics = await page.evaluate(() => {
    const col = document.querySelector('.VFpnAa_sidebarCol')
    const box = col.getBoundingClientRect()
    const g1 = getComputedStyle(document.getElementById('g1'))
    const r1 = getComputedStyle(document.getElementById('r1'))
    const r2 = getComputedStyle(document.getElementById('r2'))
    return {
      width: Math.round(box.width),
      right: Math.round(box.right),
      willChange: getComputedStyle(col).willChange,
      g1Cv: g1.contentVisibility,
      r1Cv: r1.contentVisibility,
      r2Cv: r2.contentVisibility,
      r1Backdrop: r1.backdropFilter || r1.webkitBackdropFilter || 'none',
    }
  })
  assert.equal(collapsedMetrics.width, 390, '收起态抽屉列已保持 100vw，避免展开第 0 帧从 280px 突变重排')
  assert.ok(collapsedMetrics.right <= 0, '收起态抽屉完全位于屏幕左侧之外：' + JSON.stringify(collapsedMetrics))
  assert.equal(collapsedMetrics.willChange, 'transform', '收起态预先提升 GPU 合成层')
  assert.equal(collapsedMetrics.g1Cv, 'auto', '历史分组在视口外跳过布局绘制')
  assert.equal(collapsedMetrics.r1Cv, 'auto', '普通会话行启用 content-visibility: auto')
  assert.notEqual(collapsedMetrics.r2Cv, 'auto', '打开操作菜单的行不启用 content-visibility 以免弹出菜单被裁切')
  assert.equal(collapsedMetrics.r1Backdrop, 'none', '移动端窄屏下侧栏行不启用逐行 backdrop-filter 毛玻璃')

  await page.evaluate(() => {
    document.querySelector('.VFpnAa_frame').removeAttribute('data-sidebar-collapsed')
  })
  const expandedWidth = await page.evaluate(() => Math.round(document.querySelector('.VFpnAa_sidebarCol').getBoundingClientRect().width))
  assert.equal(expandedWidth, 390, '展开态保持相同 100vw 宽度，无宽度重排')
})

test('dsh-web-mobile 点击展开抽屉复用 content-visibility 分帧揭示，首帧不阻塞滑入动画', { skip: !existsSync(webMobileUrl) }, async () => {
  const source = await readFile(webMobileUrl, 'utf8')
  assert.match(source, /exports\.openDrawerAnimated = openDrawerAnimated;/, '导出 openDrawerAnimated')
  assert.match(source, /if \(\(0, sidebar_swipe_ts_1\.openDrawerAnimated\)\(ctx\)\)\s*return;/, 'toggleDrawer 点击展开走分帧揭示路径')

  const openStart = source.indexOf('function openDrawerAnimated(ctx)')
  const openEnd = source.indexOf('\nfunction abortStroke(', openStart)
  assert.ok(openStart > 0 && openEnd > openStart, '定位 openDrawerAnimated 实现')
  const fnSource = source.slice(openStart, openEnd)

  const events = []
  const rafQueue = []
  const styleMap = new Map()
  const drawer = {
    style: {
      setProperty: (k, v, p) => { styleMap.set(k, `${v}${p ? '!' + p : ''}`); events.push(`style:${k}=${v}`) },
      removeProperty: k => { styleMap.delete(k); events.push(`remove:${k}`) },
    },
  }
  let isOpen = false
  const sandbox = {
    window: { matchMedia: () => ({ matches: false }) },
    drawerOpen: () => isOpen,
    findDrawer: () => drawer,
    modalOpen: () => false,
    takeoverActive: () => false,
    armRevealRaf: 0,
    followDrawer: null,
    cvDeferred: false,
    requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length },
    cancelAnimationFrame: () => {},
    revealDrawerContent() {
      if (!sandbox.cvDeferred) return
      sandbox.cvDeferred = false
      sandbox.followDrawer.style.removeProperty('content-visibility')
    },
  }
  const openDrawerAnimated = vm.runInNewContext(`(${fnSource})`, sandbox)
  const handled = openDrawerAnimated({ layout: { toggleSidebar() { isOpen = true; events.push('toggleSidebar') } } })
  assert.equal(handled, true)
  assert.deepEqual(events, ['style:content-visibility=hidden', 'toggleSidebar'], '先挂 content-visibility:hidden 再翻转侧栏状态')
  assert.equal(styleMap.get('content-visibility'), 'hidden!important')

  while (rafQueue.length) rafQueue.shift()()
  assert.equal(styleMap.has('content-visibility'), false, '两帧 rAF 后自动恢复抽屉子树可见性')
})

test('mobile-layout 点击普通按钮不触发 450ms 逐帧同步布局，且空转帧零 DOM 测量', () => {
  let rectReads = 0
  const listeners = new Map()
  const frames = new Map()
  let nextId = 1
  const styleValues = new Map()
  const classes = new Set()
  const seat = {
    getBoundingClientRect: () => { rectReads++; return { top: 700, left: 0, width: 390 } },
    scrollHeight: 60, clientHeight: 60, isConnected: true, children: [],
  }
  const header = { getBoundingClientRect: () => { rectReads++; return { bottom: 44 } }, isConnected: true }
  const doc = {
    documentElement: {
      style: {
        getPropertyValue: k => styleValues.get(k) || '',
        getPropertyPriority: () => '',
        setProperty: (k, v) => styleValues.set(k, String(v)),
        removeProperty: k => styleValues.delete(k),
      },
      classList: {
        add: (...ns) => ns.forEach(n => classes.add(n)),
        remove: (...ns) => ns.forEach(n => classes.delete(n)),
        contains: n => classes.has(n),
        toggle: (n, on) => { if (on) classes.add(n); else classes.delete(n) },
      },
    },
    body: {},
    querySelector: sel => sel === '[data-composer-seat]' ? seat : sel.includes('header') ? header : null,
    addEventListener: (k, fn) => listeners.set(k, [...(listeners.get(k) || []), fn]),
    removeEventListener: (k, fn) => listeners.set(k, (listeners.get(k) || []).filter(x => x !== fn)),
  }
  const vv = { height: 800, offsetTop: 0, scale: 1, addEventListener() {}, removeEventListener() {} }
  const view = {
    innerHeight: 800, innerWidth: 390, visualViewport: vv,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: fn => { const id = nextId++; frames.set(id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id),
    addEventListener() {}, removeEventListener() {},
  }
  doc.defaultView = view
  let now = 1000
  const { installVisualViewportPin } = vm.runInNewContext(
    `${mobileLayoutSource}\n;({ installVisualViewportPin })`,
    { Date: { now: () => now }, composerOffsetPx: () => 0, sheetMaxPx: () => 0 }
  )
  const release = installVisualViewportPin(doc)
  rectReads = 0

  // 点击侧栏展开/收起等普通 button 产生 focusin：不应重测布局，也不应启动 chase rAF 循环
  for (const fn of listeners.get('focusin') || []) fn({ target: { nodeType: 1, tagName: 'BUTTON' } })
  assert.equal(rectReads, 0, '点击普通按钮不触发同步布局测量')
  assert.equal(frames.size, 0, '点击普通按钮不启动 450ms rAF 轮询')

  // 聚焦真实文本输入框：立即测量 1 次（header + seat 共 2 次 rect 批量读），后续几何未变的空转帧 0 次测量
  for (const fn of listeners.get('focusin') || []) fn({ target: { nodeType: 1, tagName: 'TEXTAREA' } })
  assert.equal(rectReads, 2, '单帧内合并读取 header 与 composer 几何，无重复重排')
  assert.ok(frames.size > 0, '输入框聚焦启动键盘跟随窗口')

  rectReads = 0
  now += 16
  const queued = [...frames.values()]
  frames.clear()
  queued.forEach(fn => fn())
  assert.equal(rectReads, 0, '视口与键盘几何未变化的跟随帧零 getBoundingClientRect 调用')
  release()
})

test('frame-touch-scroll 缓存可滚动祖先链，惯性滚动期间不重复调用 getComputedStyle', () => {
  let styleCalls = 0
  const root = {
    nodeType: 1, parentElement: null, isConnected: true,
    scrollHeight: 1000, clientHeight: 400, scrollTop: 0,
    scrollTo({ top }) { this.scrollTop = top },
  }
  const wrapper = { nodeType: 1, parentElement: root, isConnected: true }
  const leaf = { nodeType: 1, parentElement: wrapper, isConnected: true }
  const view = {
    document: { scrollingElement: root },
    getComputedStyle: node => {
      styleCalls++
      return node === root ? { overflowY: 'auto', overscrollBehaviorY: 'auto' } : { overflowY: 'visible', overscrollBehaviorY: 'auto' }
    },
  }
  const { buildTavernTouchChain, scrollTavernTouchChain } = vm.runInNewContext(
    `${frameTouchSource}\n;({ buildTavernTouchChain, scrollTavernTouchChain })`,
    {}
  )
  const chain = buildTavernTouchChain(leaf, view)
  const initialCalls = styleCalls
  assert.equal(initialCalls, 3, '手势锁定阶段一次性扫描祖先链样式')

  for (let i = 0; i < 30; i++) scrollTavernTouchChain(leaf, 10, view, chain)
  assert.equal(styleCalls, initialCalls, '后续 30 帧滑动与惯性滚动 0 次 getComputedStyle 调用')
  assert.equal(root.scrollTop, 300, '滚动距离正常累加传递')
})

test('常驻状态点与舞台扫光/宝石动画全部使用合成层属性，不再逐帧触发 left 或 box-shadow/filter 重绘', () => {
  const pulseMatch = paperCss.match(/@keyframes\s+tv-live-pulse\s*\{[\s\S]*?\n\}/)
  assert.ok(pulseMatch, '存在 tv-live-pulse 关键帧')
  assert.doesNotMatch(pulseMatch[0], /box-shadow/, 'tv-live-pulse 不再逐帧重绘 box-shadow')

  const sweepMatch = stageThemesCss.match(/@keyframes\s+fork-gal-sweep\s*\{[^\n]*\}/)
  assert.ok(sweepMatch, '存在 fork-gal-sweep 关键帧')
  assert.doesNotMatch(sweepMatch[0], /\bleft\s*:/, 'fork-gal-sweep 不再逐帧触发 left 布局')
  assert.match(sweepMatch[0], /translate3d/, 'fork-gal-sweep 使用 translate3d 合成层位移')

  const gemMatch = stageThemesCss.match(/@keyframes\s+fork-gal-gem\s*\{[^\n]*\}/)
  assert.ok(gemMatch, '存在 fork-gal-gem 关键帧')
  assert.doesNotMatch(gemMatch[0], /filter\s*:/, 'fork-gal-gem 不再逐帧执行 filter 滤镜')
})
