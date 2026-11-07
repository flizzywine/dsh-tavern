import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

// 手机竖屏访问（data-mobile-nav="frame"）时正文整页空白：宿主在 ≤1023px 把 frame 模板设为
// minmax(0, 1fr) 0 0，但宿主基线仍把 _centerCol 放在 grid-area 1/2，中心列落进 0 宽的第 2 轨
// （横屏由宿主 JS 动态改回 1/1，所以只有竖屏踩坑）。回归：竖屏方向的覆盖规则必须存在，
// 且能压过宿主基线，把中心列放回第 1 轨。
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

const RULE_ANCHOR = '[data-mobile-nav] > [class*="_centerCol"]'

test('竖屏修复规则存在于源 CSS，且限定在 ≤1023px 竖屏方向', () => {
  const mediaIndex = css.indexOf('@media (max-width: 1023px) and (orientation: portrait)')
  assert.notEqual(mediaIndex, -1, '应包含 portrait 方向的媒体查询块')
  const block = css.slice(mediaIndex, css.indexOf('}', css.indexOf(RULE_ANCHOR, mediaIndex)))
  assert.ok(block.includes(RULE_ANCHOR), '媒体块内应包含中心列覆盖规则')
  assert.ok(block.includes('grid-area: 1 / 1 !important'), '覆盖规则应为 grid-area 1/1 且带 !important（压过宿主动态内联样式）')
})

test('覆盖规则能压过宿主基线的 grid-area 1/2，把中心列放回第 1 轨', () => {
  const mediaBlock = /@media \(max-width: 1023px\) and \(orientation: portrait\) \{\n\s*([^\n]*_centerCol[^\n]*)\n\s*\}/.exec(css)
  assert.ok(mediaBlock, '应能从源 CSS 提取竖屏覆盖规则')
  const ruleText = mediaBlock[1]
  const dom = new JSDOM(`<style>
    .PIRFFq_centerCol { grid-area: 1 / 2; }
    ${ruleText}
  </style><body class="dsh-tavern-shell-active">
    <div data-slot="root">
      <div class="PIRFFq_frame" data-mobile-nav="frame">
        <div class="PIRFFq_centerCol"></div>
      </div>
    </div>
  </body>`)
  const { document } = dom.window
  const center = document.querySelector('.PIRFFq_centerCol')
  const rule = [...document.styleSheets[0].cssRules].find(r => r.selectorText && r.selectorText.includes('_centerCol') && r.selectorText.includes('data-mobile-nav'))
  assert.ok(rule, '覆盖规则应进入 CSSOM')
  assert.equal(center.matches(rule.selectorText), true, '覆盖规则应命中实际 DOM 结构（frame 带 data-mobile-nav）')
  assert.equal(rule.style.getPropertyValue('grid-area'), '1 / 1', '中心列应回到第 1 轨')
  assert.equal(rule.style.getPropertyPriority('grid-area'), 'important', '需要 !important 压过宿主的动态内联样式')
  dom.window.close()
})
