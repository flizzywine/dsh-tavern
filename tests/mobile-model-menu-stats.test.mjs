// 移动端移除操作栏右侧的运行信息展开按钮，折叠输入卡下方的原生状态栏，
// 并将对应统计内容缩小字号放入模型根菜单面板的最后一行；桌面端保持原状。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { generationStreamModeBootScript } from '../tavern-plugin/lib/domain/generation-stream-mode-boot-patch.js'

const cssAsset = name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')
const paperSkinCss = () => readFile(new URL('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8')

const hostCss = `
:root{--dsw-radius-sm:6px;--dsw-radius-md:8px;--dsw-radius-lg:12px;--dsw-alias-border-l1:#e2dcd2;--dsw-alias-border-l2:#dfd9d0;--dsw-alias-border-l3:#ece7df;--dsw-alias-bg-base:#faf9f7;--dsw-specific-menu:#fcfbf9;--dsw-specific-sidebar-fill:#fbfaf7;--dsw-specific-input-major:#fff;--dsw-alias-label-primary:#262421;--dsw-alias-label-secondary:#6f6960;--dsw-alias-label-tertiary:#8a8379;--dsw-alias-menu-icon:#8a8379;--dsw-alias-separator-primary:#b4aea4;--dsw-alias-interactive-bg-hover:#f1ede6;--dsw-alias-brand-primary:#c96442;--dsw-elevation-prominent:0 10px 30px rgba(0,0,0,.12)}
body{margin:0;background:var(--dsw-alias-bg-base);font:14px/1.5 system-ui,-apple-system,sans-serif}
.wSkVaW_composerSeat{position:fixed;left:0;right:0;bottom:0;display:flex;flex-direction:column;padding:0 8px 8px}
.wSkVaW_composerStack{display:flex;flex-direction:column;gap:6px}
.uV2eYG_card{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-specific-input-major);padding:6px}
._7KE1Ra_menu{z-index:1100;width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);flex-direction:column;padding:4px;display:flex;position:fixed;right:16px;bottom:84px;box-sizing:border-box}
._7KE1Ra_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}
._7KE1Ra_cellLabel{white-space:nowrap;flex:none}
._7KE1Ra_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}
._7KE1Ra_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}
[data-composer-dock]{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:4px 12px}
.bOPqQW_anchor{display:inline-flex;font-size:12px;line-height:20px}
.bOPqQW_pill{display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;white-space:nowrap}
.bOPqQW_pill svg{width:14px;height:14px;flex:none}
.bOPqQW_sep{margin:0 6px;color:var(--dsw-alias-separator-primary)}
.JObwrW_root{display:inline-flex}
.JObwrW_trigger{display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;white-space:nowrap}
.JObwrW_track{fill:none;stroke:var(--dsw-alias-border-l2);stroke-width:2px}
.JObwrW_fill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round}
`

const markup = `<!doctype html>
<html class="dsh-tavern-viewport-pinned dsh-tavern-coarse-play">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body class="dsh-tavern-shell-active">
  <div data-conversation-content>
    <div class="wSkVaW_composerSeat" data-composer-seat>
      <div class="wSkVaW_composerStack">
        <div class="dsh-tavern-dock-actions">
          <div class="dsh-tavern-dock-actions-primary">
            <button type="button" class="dsh-tavern-choice-trigger dsh-tavern-candidate-entry" data-fork-action="open-choices">行动 ⌃</button>
            <button type="button" class="dsh-tavern-choice-trigger" data-fork-action="choices-again">重新生成候选项</button>
            <button type="button" class="dsh-tavern-choice-trigger" data-fork-action="regen">重新生成正文</button>
          </div>
          <div class="dsh-tavern-more-actions"><button type="button" class="dsh-tavern-choice-trigger" data-fork-action="more">更多 ▾</button></div>
        </div>
        <div data-slot="conversation.composer.bar" style="display:contents">
          <div>
            <div class="uV2eYG_card" data-composer-card="true">
              <div class="uV2eYG_row" style="display:flex;align-items:center;justify-content:space-between">
                <div class="uV2eYG_tools"><button class="uV2eYG_add" type="button">+</button></div>
                <div data-composer-input contenteditable="true" style="flex:1;padding:6px">发消息或创建任务</div>
                <div class="uV2eYG_trailing" style="display:flex;gap:4px">
                  <button type="button" class="_7KE1Ra_trigger" aria-controls="model-menu" aria-expanded="true">⚙</button>
                  <button type="button" class="uV2eYG_primary">↑</button>
                </div>
              </div>
            </div>
            <div data-composer-dock>
              <div data-slot="conversation.composer.dock">
                <span class="bOPqQW_anchor" data-composer-stat="activity">
                  <button type="button" class="bOPqQW_pill" aria-label="49 轮 67 步 · 161 tok/s">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12a6 6 0 1 1 10 0M8 8l2.5-2.5"/></svg>
                    <span class="bOPqQW_label">49 轮 67 步<span class="bOPqQW_sep" aria-hidden="true">·</span>161 tok/s</span>
                  </button>
                </span>
                <span class="bOPqQW_anchor" data-composer-stat="usage">
                  <button type="button" class="bOPqQW_pill" aria-label="1.2M tok · 缓存命中 47%">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4"/></svg>
                    <span class="bOPqQW_label">1.2M tok<span class="bOPqQW_sep" aria-hidden="true">·</span>缓存命中 47%</span>
                  </button>
                </span>
              </div>
              <span class="JObwrW_root">
                <button type="button" class="JObwrW_trigger" aria-label="已使用 7% 上下文">
                  <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
                    <circle class="JObwrW_track" cx="7" cy="7" r="5"></circle>
                    <circle class="JObwrW_fill" cx="7" cy="7" r="5" stroke-dasharray="2.2 31.4" transform="rotate(-90 7 7)"></circle>
                  </svg>
                  <span>7%</span>
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="model-menu" class="_7KE1Ra_menu" role="menu" aria-label="模型选项">
    <button type="button" role="menuitem" class="_7KE1Ra_cell">
      <span class="_7KE1Ra_cellLabel">模型</span>
      <span class="_7KE1Ra_cellValue">Gemini 4 Hydrogen</span>
      <svg class="_7KE1Ra_cellChevron" viewBox="0 0 12 12"><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>
    <button type="button" role="menuitem" class="_7KE1Ra_cell">
      <span class="_7KE1Ra_cellLabel">推理等级</span>
      <span class="_7KE1Ra_cellValue">Medium</span>
      <svg class="_7KE1Ra_cellChevron" viewBox="0 0 12 12"><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>
  </div>
</body></html>`

test('移动端模型菜单末行以缩小字号展示运行统计，隐藏底部原生状态栏，桌面端恢复原状', async t => {
  const [tavernCss, themeCss, paperCss] = await Promise.all([
    cssAsset('tavern.css'),
    cssAsset('theme.css'),
    paperSkinCss(),
  ])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  await page.route('**/api/dsh-tavern/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, stream: true }),
  }))
  await page.setContent(markup)
  await page.addStyleTag({ content: hostCss })
  await page.addStyleTag({ content: tavernCss })
  await page.addStyleTag({ content: themeCss })
  await page.addStyleTag({ content: paperCss })
  await page.addScriptTag({ content: generationStreamModeBootScript() })

  const statsRow = page.locator('#model-menu [data-dsh-tavern-mobile-stats]')
  await statsRow.waitFor({ state: 'visible' })
  assert.equal(await page.locator('[data-composer-dock]').isVisible(), false, '移动端隐藏输入框下方原生状态栏')
  const dockVsCard = await page.evaluate(() => ({
    actionsBottom: document.querySelector('.dsh-tavern-dock-actions').getBoundingClientRect().bottom,
    cardTop: document.querySelector('[data-composer-card]').getBoundingClientRect().top,
  }))
  assert.ok(dockVsCard.actionsBottom <= dockVsCard.cardTop + 1, '操作行保持排在输入框卡片上方')

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const metrics = await page.evaluate(() => {
      const menu = document.getElementById('model-menu')
      const cell = menu.querySelector('._7KE1Ra_cell')
      const stream = menu.querySelector('[data-dsh-tavern-stream-mode]')
      const stats = menu.querySelector('[data-dsh-tavern-mobile-stats]')
      const menuRect = menu.getBoundingClientRect()
      const streamRect = stream.getBoundingClientRect()
      const statsRect = stats.getBoundingClientRect()
      const svgRect = stats.querySelector('svg').getBoundingClientRect()
      return {
        isLastChild: menu.lastElementChild === stats,
        cellFontPx: parseFloat(getComputedStyle(cell).fontSize),
        statsFontPx: parseFloat(getComputedStyle(stats).fontSize),
        svgWidth: svgRect.width,
        belowStream: statsRect.top >= streamRect.bottom - 1,
        withinViewport: menuRect.left >= 0 && menuRect.right <= window.innerWidth,
        text: stats.textContent,
      }
    })
    assert.equal(metrics.isLastChild, true, `${width}px: 统计行位于面板最后一行`)
    assert.ok(metrics.statsFontPx < metrics.cellFontPx, `${width}px: 统计字号(${metrics.statsFontPx}px)小于菜单项(${metrics.cellFontPx}px)`)
    assert.ok(metrics.svgWidth <= 12, `${width}px: 图标同步缩小(${metrics.svgWidth}px)`)
    assert.equal(metrics.belowStream, true, `${width}px: 排在输出方式正下方`)
    assert.equal(metrics.withinViewport, true, `${width}px: 菜单不超出屏幕边界`)
    assert.match(metrics.text, /49 轮 67 步.*161 tok\/s/)
    assert.match(metrics.text, /1\.2M tok.*缓存命中 47%/)
    assert.match(metrics.text, /7%/)
  }

  // 切换到桌面宽屏视口：底部状态栏恢复可见，模型菜单内统计行隐藏
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => document.documentElement.classList.remove('dsh-tavern-viewport-pinned', 'dsh-tavern-coarse-play'))
  assert.equal(await statsRow.isVisible(), false, '桌面视口隐藏菜单末行移动统计')
  assert.equal(await page.locator('[data-composer-dock]').isVisible(), true, '桌面视口保留底部原生状态栏')
  assert.equal(await page.locator('._7KE1Ra_trigger').getAttribute('data-dsh-tavern-ctx-trigger'), null, '桌面端清除方案 C 触发器属性')
})

test('移动端模型触发按钮呈现方案 C 液位与告警角标且不增加触发按钮宽度或引起窄屏溢出', async t => {
  const [tavernCss, themeCss, paperCss] = await Promise.all([
    cssAsset('tavern.css'),
    cssAsset('theme.css'),
    paperSkinCss(),
  ])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  await page.route('**/api/dsh-tavern/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, stream: true }),
  }))
  await page.setContent(markup)
  await page.addStyleTag({ content: hostCss })
  await page.addStyleTag({ content: tavernCss })
  await page.addStyleTag({ content: themeCss })
  await page.addStyleTag({ content: paperCss })

  const baseTriggerWidth = await page.locator('._7KE1Ra_trigger').evaluate(el => el.getBoundingClientRect().width)
  await page.addScriptTag({ content: generationStreamModeBootScript() })

  // 健康态：有液位无告警角标，且触发器宽度零增量
  const healthyInfo = await page.evaluate(() => {
    const btn = document.querySelector('._7KE1Ra_trigger')
    return {
      width: btn.getBoundingClientRect().width,
      mode: btn.getAttribute('data-dsh-tavern-ctx-trigger'),
      tone: btn.getAttribute('data-ctx-tone'),
      alert: btn.getAttribute('data-ctx-alert'),
      level: btn.style.getPropertyValue('--dsh-ctx-level'),
      afterContent: getComputedStyle(btn, '::after').content,
      bgImage: getComputedStyle(btn).backgroundImage,
      overflowX: document.documentElement.scrollWidth > window.innerWidth
    }
  })
  assert.equal(healthyInfo.width, baseTriggerWidth, '触发器宽度与未启用方案 C 前完全一致')
  assert.equal(healthyInfo.mode, 'scheme-c')
  assert.equal(healthyInfo.tone, 'normal')
  assert.equal(healthyInfo.alert, null)
  assert.equal(healthyInfo.level, '7%')
  assert.notEqual(healthyInfo.bgImage, 'none', '液位背景生效')
  assert.equal(healthyInfo.overflowX, false)

  // 危险高占用态：出现 86% 红色微角标与 6 色微条
  await page.evaluate(() => {
    window.__dshTavernGenerationStreamMode.setContextVisual({
      sessionId: 's1',
      triggerState: {
        percent: 86,
        level: 86,
        tone: 'danger',
        alertPill: '86%',
        bucketShares: [{ key: 'worldbook', share: 0.36 }, { key: 'story', share: 0.5 }]
      }
    })
  })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const alertState = await page.evaluate(() => {
      const btn = document.querySelector('._7KE1Ra_trigger')
      const menu = document.getElementById('model-menu')
      const segs = menu.querySelectorAll('[data-dsh-tavern-stats-seg]')
      return {
        tone: btn.getAttribute('data-ctx-tone'),
        pill: btn.getAttribute('data-ctx-pill'),
        afterContent: getComputedStyle(btn, '::after').content,
        segCount: segs.length,
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        menuRightOk: menu.getBoundingClientRect().right <= window.innerWidth
      }
    })
    assert.equal(alertState.tone, 'danger')
    assert.equal(alertState.pill, '86%')
    assert.match(alertState.afterContent, /86%/)
    assert.equal(alertState.segCount, 2)
    assert.equal(alertState.overflowX, false, `${width}px: 页面无横向溢出`)
    assert.equal(alertState.menuRightOk, true, `${width}px: 菜单不超右边界`)
  }
})
