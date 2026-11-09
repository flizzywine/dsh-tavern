import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

test('中心列覆盖规则仅命中 dsh-web-mobile 的触屏竖屏布局', t => {
  const block = /@media[^{}]*\(orientation: portrait\)[^{}]*\{[^{}]*_centerCol[^{}]*\{[^{}]*\}\s*\}/.exec(css)
  assert.ok(block, '应包含中心列的竖屏覆盖规则')
  const dom = new JSDOM(`<style>${block[0]}</style><body class="dsh-tavern-shell-active">
    <div data-slot="root">
      <div class="PIRFFq_frame" data-mobile-nav="frame">
        <div class="PIRFFq_centerCol"></div>
      </div>
    </div>
  </body>`)
  t.after(() => dom.window.close())
  const { document } = dom.window
  const [media] = document.styleSheets[0].cssRules
  assert.equal(media.media.mediaText, '(max-width: 1023px) and (orientation: portrait) and (pointer: coarse)')
  const [rule] = media.cssRules
  const center = document.querySelector('.PIRFFq_centerCol')
  assert.ok(center.matches(rule.selectorText), '覆盖规则应命中移动插件接管的 frame')
  center.parentElement.dataset.mobileNav = 'other'
  assert.equal(center.matches(rule.selectorText), false, '覆盖规则应限定为 frame 标记')
  assert.equal(rule.style.getPropertyValue('grid-area'), '1 / 1', '中心列应回到第 1 轨')
  assert.equal(rule.style.getPropertyPriority('grid-area'), 'important', '需要 !important 压过宿主的动态内联样式')
})
