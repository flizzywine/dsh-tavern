import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

function extractTemplateCss(source, constName) {
  const marker = `const ${constName} = \``
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `未找到 ${constName}`)
  const end = source.indexOf('\n`', start + marker.length)
  assert.notEqual(end, -1, `未找到 ${constName} 结束位置`)
  return source.slice(start + marker.length, end)
}

test('剧情罗盘、叙事阻尼器、命运之骰在移动端右侧栏不发生控件拉伸变形', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 60000 }, async t => {
  const { chromium } = await import('playwright')
  const [tavernCss, themeCss, paperCss, pcSrc, tndSrc, fdSrc] = await Promise.all([
    readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/lib/client-assets/theme.css', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/packages/dsh-tavern-plot-compass/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/packages/dsh-tavern-narrative-damper/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/packages/dsh-tavern-fate-dice/client.js', import.meta.url), 'utf8'),
  ])
  const pcCss = extractTemplateCss(pcSrc, 'PC_CSS_TEXT')
  const tndCss = extractTemplateCss(tndSrc, 'TND_CSS')
  const fdCss = extractTemplateCss(fdSrc, 'CSS_TEXT')

  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())

  // 故意把插件样式放在 tavern.css / theme.css / paper.css 之前，确保靠特异性而非加载顺序胜出。
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await page.setContent(`<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${pcCss}</style>
<style>${tndCss}</style>
<style>${fdCss}</style>
<style>${tavernCss}</style>
<style>${themeCss}</style>
<style>${paperCss}</style>
</head>
<body class="dsh-tavern-shell-active">
  <div data-sidebar-right-panel="fullscreen" data-sidebar-right-open="true">
    <div class="pc-root pc-workbench">
      <div class="pc-wb-head">
        <button id="pc-help" type="button" class="pc-help-btn">?</button>
        <button id="pc-switch" type="button" role="switch" aria-checked="true" class="pc-switch is-on"></button>
        <button id="pc-chip" type="button" class="pc-chip">定制标签</button>
        <button id="pc-chip-x" type="button" class="pc-chip-x">×</button>
        <button id="pc-sm" type="button" class="pc-btn is-sm">暂停</button>
        <button id="pc-tab" type="button" class="pc-tab is-active">路线与推演</button>
        <button id="pc-close" type="button" class="pc-help-close">收起</button>
      </div>
    </div>
    <div class="tnd-root tnd-workbench">
      <div class="tnd-wb-head">
        <button id="tnd-help" type="button" class="tnd-help-btn">?</button>
        <button id="tnd-switch" type="button" role="switch" aria-checked="true" class="tnd-switch is-on"></button>
        <button id="tnd-sm" type="button" class="tnd-btn is-sm">重置</button>
        <button id="tnd-seg" type="button" class="tnd-seg is-active">全局默认</button>
        <button id="tnd-close" type="button" class="tnd-help-close">收起</button>
      </div>
    </div>
    <div class="fd-root fd-workbench">
      <div class="fd-wb-head">
        <button id="fd-help" type="button" class="fd-help-btn">?</button>
        <button id="fd-switch" type="button" role="switch" aria-checked="true" class="fd-switch is-on"></button>
        <button id="fd-pop-close" type="button" class="fd-popover-close">×</button>
        <button id="fd-chip" type="button" class="fd-chip">d20</button>
        <button id="fd-sm" type="button" class="fd-btn is-sm">恢复</button>
        <button id="fd-tab" type="button" class="fd-tab is-active">检定</button>
        <button id="fd-close" type="button" class="fd-help-close">收起</button>
      </div>
    </div>
    <button id="rx-switch" type="button" role="switch" aria-checked="true" class="dsh-tavern-rx-switch"></button>
  </div>
</body></html>`)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const box = async id => {
    const rect = await page.locator('#' + id).boundingBox()
    assert.ok(rect, `缺少元素 #${id}`)
    return rect
  }

  // 1) ? 帮助按钮保持正圆（17x17）
  for (const id of ['pc-help', 'tnd-help', 'fd-help']) {
    const b = await box(id)
    assert.ok(Math.abs(b.width - 17) <= 1 && Math.abs(b.height - 17) <= 1, `${id} 应保持 17×17 正圆，实际 ${JSON.stringify(b)}`)
  }
  const fdPopClose = await box('fd-pop-close')
  assert.ok(Math.abs(fdPopClose.width - 20) <= 1 && Math.abs(fdPopClose.height - 20) <= 1, `fd-pop-close 应保持 20×20，实际 ${JSON.stringify(fdPopClose)}`)

  // 2) 开关保持横向胶囊（44x26 / 34x19），不再被撑成 40px 方块
  for (const id of ['pc-switch', 'tnd-switch', 'fd-switch']) {
    const b = await box(id)
    assert.ok(Math.abs(b.width - 44) <= 1 && Math.abs(b.height - 26) <= 1, `${id} 应保持 44×26 胶囊，实际 ${JSON.stringify(b)}`)
  }
  const rxSwitch = await box('rx-switch')
  assert.ok(Math.abs(rxSwitch.width - 34) <= 1 && Math.abs(rxSwitch.height - 19) <= 1, `rx-switch 应保持 34×19，实际 ${JSON.stringify(rxSwitch)}`)

  // 3) 胶囊、小按钮、页签、收起按钮不再吃满 40px 高度地板
  for (const [id, maxH] of [
    ['pc-chip', 34], ['pc-chip-x', 24], ['pc-sm', 34], ['pc-tab', 34], ['pc-close', 28],
    ['tnd-sm', 34], ['tnd-seg', 34], ['tnd-close', 28],
    ['fd-chip', 34], ['fd-sm', 34], ['fd-tab', 34], ['fd-close', 28],
  ]) {
    const b = await box(id)
    assert.ok(b.height <= maxH, `${id} 高度应 ≤ ${maxH}px，实际 ${JSON.stringify(b)}`)
  }

  await page.close()
})
