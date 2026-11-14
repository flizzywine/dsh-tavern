// 手机输入框上方的两条状态栏（插件停靠区 + 收起的「接下来的行动」）原来各占一张卡的高度：
// 收起态仍带 9px/6px 的上下内边距、40px 标题行和投影，和停靠区叠起来吃掉近 120px。
// 收起态在手机上压成一行细条（≈36px、无投影），桌面的卡片外观保持不变。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const css = async name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')

const markup = '<!doctype html><html class="__HTML_CLASS__"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
  + '</head><body class="dsh-tavern-shell-active"><div data-composer-seat>'
  + '<div class="dsh-tavern-question dsh-tavern-candidate-question collapsed">'
  + '<div class="dsh-tavern-question-head" role="button" tabindex="0" aria-expanded="false">'
  + '<span>接下来的行动</span><span class="dsh-tavern-question-sub">11 个</span>'
  + '<button type="button" class="dsh-tavern-question-close" title="展开行动列表">⌄</button></div>'
  + '</div></div></body></html>'

const tokens = ':root{--dsw-alias-border-l2:#ddd;--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#222;'
  + '--dsw-alias-label-secondary:#666;--dsw-specific-sidebar-fill:#fbfaf7;--dsw-specific-input-major:#fff;'
  + '--dsh-tavern-accent:#d9a15b;--dsw-shadow-lv1:0 1px 2px #0001}'
  + 'body{margin:0;font:16px/1.6 system-ui}'

async function measure(viewport, htmlClass) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1024 })
  await page.setContent(markup.replace('__HTML_CLASS__', htmlClass))
  await page.addStyleTag({ content: tokens })
  await page.addStyleTag({ content: await css('tavern.css') })
  await page.addStyleTag({ content: await css('theme.css') })
  const view = await page.evaluate(() => {
    const panel = document.querySelector('.dsh-tavern-candidate-question')
    const head = document.querySelector('.dsh-tavern-question-head')
    const style = getComputedStyle(panel)
    return {
      panelHeight: panel.getBoundingClientRect().height,
      headHeight: head.getBoundingClientRect().height,
      paddingTop: parseFloat(style.paddingTop),
      paddingBottom: parseFloat(style.paddingBottom),
      radius: style.borderRadius,
    }
  })
  await browser.close()
  return view
}

test('手机上收起的「接下来的行动」是一行细条，不再按卡片高度压在输入框上方', async () => {
  const view = await measure({ width: 390, height: 844 }, 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play')
  assert.ok(view.panelHeight <= 38, '收起态整块不超过 38px：' + view.panelHeight.toFixed(1))
  assert.equal(view.paddingTop, 0, '收起态没有多余的上下留白')
  assert.equal(view.paddingBottom, 0)
  assert.equal(view.radius, '11px', '收起态收成细条圆角')
  assert.ok(view.headHeight >= 32, '整行仍是可点的热区：' + view.headHeight.toFixed(1))
})

test('宽屏保留原来的卡片外观', async () => {
  const view = await measure({ width: 1280, height: 900 }, '')
  assert.ok(view.paddingTop > 0, '桌面保留卡片内边距')
  assert.equal(view.radius, '14px', '桌面保留卡片圆角')
  assert.ok(view.headHeight < 32, '桌面的标题行不带触屏热区：' + view.headHeight.toFixed(1))
})
