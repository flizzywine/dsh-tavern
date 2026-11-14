// 手机输入框上方的两条状态栏（插件停靠区 + 收起的「接下来的行动」）原来各占一行。
// 「接下来的行动」（含候选数）现在并进下面的操作行，点开仍是原来的底部抽屉：
// 收起卡片在手机上整块隐藏，桌面上照旧是那张卡片。
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
  + '</div>'
  + '<div class="dsh-tavern-dock-actions"><div class="dsh-tavern-dock-actions-primary">'
  + '<button type="button" class="dsh-tavern-choice-trigger dsh-tavern-candidate-entry" data-fork-action="open-choices">行动 11 ⌃</button>'
  + '<button type="button" class="dsh-tavern-choice-trigger" data-fork-action="choices-again">重新生成候选项</button>'
  + '</div></div>'
  + '</div></body></html>'

const tokens = ':root{--dsw-alias-border-l2:#ddd;--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#222;'
  + '--dsw-alias-label-secondary:#666;--dsw-specific-sidebar-fill:#fbfaf7;--dsw-specific-input-major:#fff;'
  + '--dsw-alias-brand-primary:#d9a15b;--dsw-shadow-lv1:0 1px 2px #0001}'
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
    const entry = document.querySelector('.dsh-tavern-candidate-entry')
    const sibling = document.querySelector('.dsh-tavern-dock-actions [data-fork-action="choices-again"]')
    const style = node => getComputedStyle(node)
    return {
      panelDisplay: style(panel).display,
      entryDisplay: style(entry).display,
      entryHeight: entry.getBoundingClientRect().height,
      siblingHeight: sibling.getBoundingClientRect().height,
      accentApplied: style(entry).backgroundColor,
    }
  })
  await browser.close()
  return view
}

test('手机上的「接下来的行动」不再单占一行，入口并进操作行', async () => {
  const view = await measure({ width: 390, height: 844 }, 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play')
  assert.equal(view.panelDisplay, 'none', '收起卡片整块隐藏，省掉一整行')
  // 操作行是 flex 容器，行内元素会被 blockify，computed display 是 flex。
  assert.notEqual(view.entryDisplay, 'none', '入口出现在操作行里')
  assert.ok(Math.abs(view.entryHeight - view.siblingHeight) <= 1, '入口和同一行的操作一样高：' + view.entryHeight.toFixed(1) + ' / ' + view.siblingHeight.toFixed(1))
  assert.notEqual(view.accentApplied, 'rgba(0, 0, 0, 0)', '入口带强调色，和别的操作区分开')
})

test('宽屏仍用收起卡片，操作行不出现入口', async () => {
  const view = await measure({ width: 1280, height: 900 }, '')
  assert.notEqual(view.panelDisplay, 'none', '桌面收起态照旧显示')
  assert.equal(view.entryDisplay, 'none', '桌面不重复一个入口')
})
