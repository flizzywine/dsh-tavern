// 手机上的候选抽屉（「接下来的行动」）必须在列向里排成单列、占满宽度。
// theme.css 给这块面板设的是行向换行（每块 flex: 1 0 100% 独占一行）；抽屉只把方向改成列向时，
// 同一个 flex-wrap 会把标题、标签行和列表各自换成一列并排到面板右手边：正文只剩最左一截，
// 标题被挤到中间，面板还会出现整块横向滚动。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const css = async name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')
const layoutSource = async () => readFile(new URL('../tavern-plugin/src/client/modules/mobile-layout.js', import.meta.url), 'utf8')
const frameSource = async () => readFile(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')

const option = index => '<button type="button" class="dsh-tavern-question-option" data-type="action">'
  + '<span class="dsh-tavern-question-index" aria-hidden="true">' + index + '</span>'
  + '<span class="dsh-tavern-question-text"><span class="dsh-tavern-question-tag dsh-tavern-question-tag-actor">角色甲</span>'
  + '<span>他算准时间在衣帽间外等到脚步声远去才推门出来，故意问起那件湿透的白衬衫到底放在哪里，然后自己找了快二十分钟。</span></span>'
  + '</button>'

function sheetMarkup(htmlClass) {
  return '<!doctype html><html class="' + htmlClass + '"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '</head><body class="dsh-tavern-shell-active"><div id="frame" data-mobile-nav="frame">'
    + '<div data-composer-seat style="position:absolute;bottom:0;left:0;right:0;height:90px;background:#fff">'
    + '<div class="dsh-tavern-question dsh-tavern-candidate-question">'
    + '<div class="dsh-tavern-question-head" role="button" tabindex="0" aria-expanded="true"><span>接下来的行动</span>'
    + '<button type="button" class="dsh-tavern-question-close" title="收起行动列表">⌃</button></div>'
    + '<div class="dsh-tavern-question-tabs" role="tablist">'
    + ['精选 6', '角色甲 3', '全局 2'].map((label, index) => '<button type="button" role="tab" class="dsh-tavern-question-tab' + (index ? '' : ' active') + '">'
      + '<span class="dsh-tavern-question-tab-label">' + label + '</span></button>').join('')
    + '</div>'
    + '<div class="dsh-tavern-question-body">' + Array.from({ length: 11 }, (_, index) => option(index + 1)).join('') + '</div>'
    + '</div></div></div></body></html>'
}

const tokens = ':root{--dsh-composer-offset:120px;--dsh-sheet-max:min(60dvh,480px);--dsw-alias-border-l2:#ddd;'
  + '--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;'
  + '--dsw-specific-sidebar-fill:#fbfaf7;--dsw-specific-input-major:#fff;--dsh-tavern-accent:#d9a15b}'
  + 'body{margin:0;font:16px/1.6 system-ui}'

async function openSheet(page, htmlClass) {
  await page.setContent(sheetMarkup(htmlClass))
  await page.addStyleTag({ content: tokens })
  await page.addStyleTag({ content: await css('tavern.css') })
  await page.addStyleTag({ content: await css('theme.css') })
}

async function measure(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.dsh-tavern-candidate-question')
    const head = document.querySelector('.dsh-tavern-question-head')
    const body = document.querySelector('.dsh-tavern-question-body')
    const options = [...document.querySelectorAll('.dsh-tavern-question-option')]
    const rect = element => element.getBoundingClientRect()
    const style = getComputedStyle(panel)
    return {
      direction: style.flexDirection, wrap: style.flexWrap, align: style.alignItems,
      panel: { left: rect(panel).left, right: rect(panel).right, width: rect(panel).width, clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth },
      head: { left: rect(head).left, right: rect(head).right, height: rect(head).height },
      body: { left: rect(body).left, right: rect(body).right, width: rect(body).width, clientWidth: body.clientWidth, scrollWidth: body.scrollWidth },
      bodyInner: parseFloat(getComputedStyle(body).paddingLeft) + parseFloat(getComputedStyle(body).paddingRight),
      options: options.map(element => ({ left: rect(element).left, right: rect(element).right, width: rect(element).width, top: rect(element).top }))
    }
  })
}

test('手机候选抽屉排成单列，标题与选项都不越出面板', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  await openSheet(page, 'dsh-tavern-viewport-pinned')
  const view = await measure(page)

  assert.equal(view.direction, 'column', '抽屉是列向布局')
  assert.equal(view.wrap, 'nowrap', '主题的行向换行不能留在列向抽屉上')
  assert.equal(view.align, 'stretch', '每块撑满面板宽度')
  assert.equal(view.panel.scrollWidth, view.panel.clientWidth, '面板没有横向滚动')
  assert.equal(view.body.scrollWidth, view.body.clientWidth, '列表没有横向滚动')
  assert.ok(view.head.height < 64, '标题只占一行，不再按整块高度撑开：' + Math.round(view.head.height))
  for (const [label, box] of [['标题', view.head], ['列表', view.body], ...view.options.map((box, index) => ['选项 ' + (index + 1), box])]) {
    assert.ok(box.left >= view.panel.left - 1 && box.right <= view.panel.right + 1, label + ' 留在面板内')
  }
  const width = view.body.clientWidth - view.bodyInner
  for (const [index, box] of view.options.entries()) {
    assert.ok(Math.abs(box.width - width) <= 2, '选项 ' + (index + 1) + ' 撑满列表宽度')
  }
  assert.ok(view.options[1].top > view.options[0].top + 20, '选项自上而下堆叠')
  assert.ok(view.body.left < view.panel.left + 24, '列表贴着面板左侧，不再被推到右手边')
})

test('键盘把窗口压成短视口时列表仍单列、由整个面板滚动', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  await openSheet(page, 'dsh-tavern-viewport-pinned dsh-tavern-short-viewport')
  const view = await measure(page)

  assert.equal(view.wrap, 'nowrap')
  assert.equal(view.panel.scrollWidth, view.panel.clientWidth, '短视口下也没有横向滚动')
  assert.equal(view.body.scrollWidth, view.body.clientWidth)
  assert.ok(view.body.scrollHeight === view.body.clientHeight, '短视口里列表不自带滚动，交给面板')
  assert.ok(view.head.height < 64)
  for (const box of view.options) assert.ok(box.right <= view.panel.right + 1 && box.left >= view.panel.left - 1)
})

test('宽屏走原来的行向换行，每块仍独占一行', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await openSheet(page, '')
  const view = await measure(page)

  assert.equal(view.direction, 'row')
  assert.equal(view.panel.scrollWidth, view.panel.clientWidth, '宽屏面板没有横向滚动')
  assert.ok(view.body.width > 500, '宽屏列表占满卡片宽度')
  assert.ok(view.options[1].top > view.options[0].top + 20, '宽屏里选项同样自上而下堆叠')
})

const dsh022HostCss = `:root{--dsw-alias-border-l2:#ddd;--dsw-alias-bg-base:#faf9f5;--dsw-alias-label-primary:#222;`
  + `--dsw-alias-label-secondary:#666;--dsw-specific-sidebar-fill:#fbfaf7;--dsw-specific-input-major:#fff;`
  + `--dsw-alias-brand-primary:#c96442;--dsh-composer-card-max-width:780px;--dsh-composer-side-clearance:16px}`
  + `html,body,#root,[data-slot="root"]{margin:0;padding:0;height:100%;width:100%;font:16px/1.6 system-ui}`
  + `.pI_x6G_frame{position:relative;display:grid;grid-template-rows:minmax(0,1fr) auto;height:100%;box-sizing:border-box;overflow:hidden;background:var(--dsw-alias-bg-base)}`
  + `.pI_x6G_sidebarCol{grid-column:1;grid-row:1;min-width:0;overflow:hidden;background:#f5f3ee}`
  + `.pI_x6G_centerCol{grid-column:2;grid-row:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}`
  + `.pI_x6G_mainPanel{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}`
  + `.pI_x6G_rightbarCol{grid-column:3;grid-row:1;position:relative;min-width:0;overflow:visible;background:#f5f3ee;z-index:10}`
  + `.wSkVaW_root{position:relative;display:flex;flex-direction:column;height:100%;min-width:0;overflow:hidden}`
  + `.wSkVaW_header{flex:none;min-height:60px}`
  + `.wSkVaW_body{position:relative;display:flex;flex:1;flex-direction:column;min-height:0}`
  + `.wSkVaW_scrollBody{display:flex;flex:1;flex-direction:column;min-height:0;margin-right:2px;overflow-y:auto;scrollbar-gutter:stable}`
  + `.wSkVaW_viewArea{flex:1 0 auto;min-height:500px}`
  + `.wSkVaW_root[data-phase="active"] .wSkVaW_composerSeat{position:sticky;bottom:0;margin-top:auto;z-index:9;will-change:transform;overflow-anchor:none;display:flex;flex:none;flex-direction:column}`
  + `.wSkVaW_composerStack{display:flex;flex-direction:column;gap:6px}`
  + `.uV2eYG_root{display:flex;flex-direction:column;align-items:center;padding:0 16px 4px}`
  + `.uV2eYG_card{box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:100%;max-width:780px;min-height:92px;border:1px solid #ddd;border-radius:16px;background:#fff}`

function dsh022Markup({ gridCols, appInsets = false }) {
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>' + dsh022HostCss + '</style>'
    + (appInsets ? '<style id="dsh-app-insets">#root{position:fixed;top:36px;bottom:48px;left:0;right:0;height:auto !important;}</style>' : '')
    + '</head><body class="dsh-tavern-shell-active"><div id="root"><div data-slot="root">'
    + '<div class="pI_x6G_frame" style="grid-template-columns:' + gridCols + '">'
    + '<div class="pI_x6G_sidebarCol">sidebar</div>'
    + '<div class="pI_x6G_centerCol"><div class="pI_x6G_mainPanel">'
    + '<div class="wSkVaW_root" data-phase="active">'
    + '<header class="wSkVaW_header">header</header>'
    + '<div class="wSkVaW_body"><div class="wSkVaW_scrollBody">'
    + '<div class="wSkVaW_viewArea">messages</div>'
    + '<div class="wSkVaW_composerSeat" data-composer-seat="">'
    + '<div data-slot="conversation.composer" style="display:contents"><div class="wSkVaW_composerStack">'
    + '<div data-slot="conversation.input.dock" style="display:contents">'
    + '<div class="dsh-tavern-question dsh-tavern-candidate-question">'
    + '<div class="dsh-tavern-question-head" role="button" tabindex="0" aria-expanded="true"><span>接下来的行动</span>'
    + '<button type="button" class="dsh-tavern-question-close" title="收起行动列表">⌃</button></div>'
    + '<div class="dsh-tavern-question-body">' + option(1) + option(2) + '</div>'
    + '</div></div>'
    + '<div data-slot="conversation.composer.bar" style="display:contents"><div class="uV2eYG_root"><div class="uV2eYG_card" data-composer-card="true">composer</div></div></div>'
    + '</div></div></div></div></div></div></div></div>'
    + '<div class="pI_x6G_rightbarCol">rightbar</div>'
    + '</div></div></div></body></html>'
}

async function openDsh022Case(browser, viewport, options) {
  const [tavernCss, themeCss, layoutJs, frameJs] = await Promise.all([
    css('tavern.css'),
    css('theme.css'),
    layoutSource(),
    frameSource(),
  ])
  const helperJs = frameJs.slice(0, frameJs.indexOf('// @include modules/mobile-layout.js'))
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true })
  const page = await context.newPage()
  await page.setContent(dsh022Markup(options))
  await page.addStyleTag({ content: tavernCss })
  await page.addStyleTag({ content: themeCss })
  await page.evaluate(({ helperJs, layoutJs }) => {
    const install = new Function(`${helperJs}\n${layoutJs}\nreturn installVisualViewportPin(document);`)
    window.__releasePin = install()
  }, { helperJs, layoutJs })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return { context, page }
}

async function measureDsh022(page) {
  return page.evaluate(() => {
    const box = sel => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const seat = document.querySelector('[data-composer-seat]')
    return {
      htmlClasses: [...document.documentElement.classList],
      seatWillChange: getComputedStyle(seat).willChange,
      center: box('.pI_x6G_centerCol'),
      header: box('header'),
      seat: box('[data-composer-seat]'),
      card: box('[data-composer-card]'),
      sheet: box('.dsh-tavern-candidate-question'),
      close: box('.dsh-tavern-question-close'),
    }
  })
}

test('DSH 0.2.2 真实多栏与窄屏结构下，候选抽屉解除包含块并准确落在聊天列上方', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())

  // 1. 平板横屏 1280×900（左 280px | 中 720px | 右 280px）并模拟收起左侧栏到 56px
  {
    const { context, page } = await openDsh022Case(browser, { width: 1280, height: 900 }, { gridCols: '280px minmax(400px,1fr) 280px' })
    const m = await measureDsh022(page)
    assert.equal(m.seatWillChange, 'auto', '移动端激活态输入座位解除 will-change 包含块')
    assert.ok(m.sheet.left >= m.center.left - 0.5 && m.sheet.right <= m.center.right + 0.5, '平板横屏抽屉留在中心列内')
    assert.ok(Math.abs(m.sheet.bottom - m.seat.top) <= 2, '平板横屏抽屉底边贴合输入座位顶边')
    assert.ok(m.sheet.width > 600, '平板横屏抽屉占满聊天列宽：' + m.sheet.width)
    assert.ok(
      m.close.left >= m.sheet.left - 0.5 && m.close.right <= m.sheet.right + 0.5
      && m.close.left >= m.center.left - 0.5 && m.close.right <= m.center.right + 0.5
      && m.close.top >= m.sheet.top - 0.5 && m.close.bottom <= m.sheet.bottom + 0.5,
      '关闭按钮完整落在面板与中心列内'
    )

    // 模拟收起左侧栏（280px -> 56px），验证 ResizeObserver 触发重新对齐
    await page.evaluate(() => {
      document.querySelector('.pI_x6G_frame').style.gridTemplateColumns = '56px minmax(400px,1fr) 280px'
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))))
    const collapsed = await measureDsh022(page)
    assert.equal(Math.round(collapsed.center.left), 56)
    assert.ok(collapsed.sheet.left >= collapsed.center.left - 0.5 && collapsed.sheet.right <= collapsed.center.right + 0.5, '收起左栏后抽屉仍留在中心列内')
    assert.ok(collapsed.sheet.left < m.sheet.left, '收起左栏后抽屉随输入区左移对齐')
    assert.ok(Math.abs((collapsed.sheet.left + collapsed.sheet.right) / 2 - (collapsed.card.left + collapsed.card.right) / 2) <= 2, '收起左栏后仍与输入卡居中对齐')
    assert.ok(Math.abs(collapsed.sheet.bottom - collapsed.seat.top) <= 2)
    await context.close()
  }

  // 2. 宽屏平板单栏 1440×900（左 56px | 中 1384px 含居中 780px 输入卡 | 无右栏）
  {
    const { context, page } = await openDsh022Case(browser, { width: 1440, height: 900 }, { gridCols: '56px minmax(0,1fr) 0px' })
    const m = await measureDsh022(page)
    assert.ok(m.sheet.width <= 780, '宽屏单栏抽屉宽度对齐输入卡上限：' + m.sheet.width)
    assert.ok(Math.abs((m.sheet.left + m.sheet.right) / 2 - (m.card.left + m.card.right) / 2) <= 2, '宽屏单栏抽屉居中于输入卡上方')
    assert.ok(Math.abs(m.sheet.bottom - m.seat.top) <= 2)
    await context.close()
  }

  // 3. 平板竖屏 820×1180（左 56px | 中 464px | 右 300px）
  {
    const { context, page } = await openDsh022Case(browser, { width: 820, height: 1180 }, { gridCols: '56px minmax(400px,1fr) 300px' })
    const m = await measureDsh022(page)
    assert.ok(m.sheet.left >= 56 && m.sheet.right <= 520, '平板竖屏多栏抽屉不越入左右侧栏')
    assert.ok(Math.abs(m.sheet.bottom - m.seat.top) <= 2)
    await context.close()
  }

  // 4. 手机竖屏 390×844（含 #dsh-app-insets）
  {
    const { context, page } = await openDsh022Case(browser, { width: 390, height: 844 }, { gridCols: '0px minmax(0,1fr) 0px', appInsets: true })
    const m = await measureDsh022(page)
    assert.ok(m.sheet.left >= 8 && m.sheet.left <= 10 && m.sheet.right >= 378 && m.sheet.right <= 382, '手机端抽屉左右居中占满视口宽度')
    assert.ok(Math.abs(m.sheet.bottom - m.seat.top) <= 2, '手机端带 #dsh-app-insets 时底边仍紧贴输入座位')
    await context.close()
  }

  // 5. 手机短视口 667×320（软键盘弹出触发 dsh-tavern-short-viewport）
  {
    const { context, page } = await openDsh022Case(browser, { width: 667, height: 320 }, { gridCols: '0px minmax(0,1fr) 0px' })
    const m = await measureDsh022(page)
    assert.ok(m.htmlClasses.includes('dsh-tavern-short-viewport'), '短视口应进入 dsh-tavern-short-viewport')
    assert.ok(m.sheet.top >= m.header.bottom, '短视口抽屉顶部落在顶栏下方')
    assert.ok(m.sheet.bottom <= 320, '短视口抽屉不再被 .composerSeat 包含块顶出屏底')
    await context.close()
  }
})
