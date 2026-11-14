// 手机上的候选抽屉（「接下来的行动」）必须在列向里排成单列、占满宽度。
// theme.css 给这块面板设的是行向换行（每块 flex: 1 0 100% 独占一行）；抽屉只把方向改成列向时，
// 同一个 flex-wrap 会把标题、标签行和列表各自换成一列并排到面板右手边：正文只剩最左一截，
// 标题被挤到中间，面板还会出现整块横向滚动。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const css = async name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')

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
    + '<span class="dsh-tavern-question-sub">11 个</span>'
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
