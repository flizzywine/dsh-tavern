// 端到端 Playwright 验证上下文窗口桌面 Popover / 宽弹窗 / 完整页，以及移动端 Bottom Sheet 与二级原文详阅。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { generationStreamModeBootScript } from '../tavern-plugin/lib/domain/generation-stream-mode-boot-patch.js'

const readRepoFile = rel => readFile(new URL('../tavern-plugin/' + rel, import.meta.url), 'utf8')

const baseHostCss = `
:root{--dsw-radius-sm:6px;--dsw-radius-md:8px;--dsw-radius-lg:12px;--dsw-alias-border-l1:#e2dcd2;--dsw-alias-border-l2:#dfd9d0;--dsw-alias-border-l3:#ece7df;--dsw-alias-bg-base:#faf9f7;--dsw-specific-menu:#fcfbf9;--dsw-specific-sidebar-fill:#fbfaf7;--dsw-specific-input-major:#fff;--dsw-alias-label-primary:#262421;--dsw-alias-label-secondary:#6f6960;--dsw-alias-label-tertiary:#8a8379;--dsw-alias-interactive-bg-hover:#f1ede6;--dsw-alias-button-info-fill:#4176e6;--dsw-elevation-prominent:0 10px 30px rgba(0,0,0,.12)}
body{margin:0;background:var(--dsw-alias-bg-base);font:14px/1.5 system-ui,-apple-system,sans-serif}
[data-composer-seat]{position:fixed;left:0;right:0;bottom:0;padding:8px}
[data-composer-card]{display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-input-major)}
[data-composer-dock]{display:flex;align-items:center;gap:12px;padding:6px 12px}
.JObwrW_trigger{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
._7KE1Ra_menu{z-index:1100;width:max-content;min-width:240px;max-width:calc(100vw - 24px);background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:4px;display:flex;flex-direction:column;position:fixed;right:12px;bottom:76px}
._7KE1Ra_cell{height:34px;border:0;background:transparent;display:flex;align-items:center;gap:6px;padding:0 8px}
`

const sampleRpcPayload = {
  record: {
    id: 'req-ui-1',
    turn: 12,
    step: 2,
    scope: 'foreground',
    task: 'reply',
    createdAt: 1795593000000,
    request: {
      model: 'claude-4-sonnet',
      system: '你是一位擅长冷峻奇幻叙事的地下城主持人。',
      tools: [{ name: 'roll_check', description: '检定掷骰' }],
      messages: [
        {
          role: 'system',
          content: '常驻世界书 · 灰枭城暗巷地图与巡城时刻表。',
          source: { sections: [{ name: 'tavern:constant-worldbook', text: '常驻世界书 · 灰枭城暗巷地图与巡城时刻表。' }] }
        },
        {
          role: 'system',
          content: '人物卡 · 奥尔德的伤势记录与怀中红珊瑚香盒。',
          source: { sections: [{ name: 'tavern:character-card', text: '人物卡 · 奥尔德的伤势记录与怀中红珊瑚香盒。' }] }
        },
        {
          role: 'user',
          content: '状态投影 · 生命 14/20，警戒度 72%。',
          source: { kind: 'mod', form: 'variable-changes' }
        },
        {
          role: 'user',
          content: '我压低剑尖，示意奥尔德先顺着偏门石阶退入阴影。',
          source: { kind: 'user' }
        }
      ]
    },
    cacheDiff: {
      compareStatus: 'compared',
      usage: { inputTokens: 28000, cacheReadTokens: 0, cacheWriteTokens: 4000, totalInputTokens: 32000, hitRate: 0 },
      sectionStatus: { 'field:system': 'hit', 'msg:0': 'break', 'msg:1': 'cascade', 'msg:3': 'appended' },
      breakPoint: {
        kind: 'message',
        key: 'msg:0',
        title: 'msg:0',
        partLabel: '常驻世界书',
        diff: {
          addedLines: 1,
          removedLines: 1,
          truncated: false,
          lines: [
            { type: 'del', text: '巡夜更夫间隔：每刻一次。' },
            { type: 'add', text: '巡夜更夫间隔：每半刻一次。' }
          ]
        }
      },
      zeroReadReason: 'prefix-broken'
    }
  },
  meta: {
    scope: 'foreground',
    contextWindow: 128000,
    compactionPolicy: { mode: 'percent', percent: 80, rounds: 20, retainRounds: 10 },
    hasBackground: true,
    recentSeries: [
      { id: 'r1', turn: 10, tokens: 24000, cacheReadTokens: 20000 },
      { id: 'r2', turn: 11, tokens: 28000, cacheReadTokens: 24000 },
      { id: 'r3', turn: 12, tokens: 32000, cacheReadTokens: 0 }
    ]
  }
}

async function mountTestPage(page, width, height) {
  const [reactScript, tavernCss, themeCss, paperCss, modelJs, featureJs] = await Promise.all([
    browserReactScript(),
    readRepoFile('lib/client-assets/tavern.css'),
    readRepoFile('lib/client-assets/theme.css'),
    readRepoFile('packages/dsh-dream-skin/lib/skins/paper.css'),
    readRepoFile('src/client/modules/context-window-model.js'),
    readRepoFile('src/client/features/request-context.js')
  ])

  const consoleErrors = []
  const pageErrors = []
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', err => pageErrors.push(String(err)))

  await page.setViewportSize({ width, height })
  await page.route('**/api/dsh-tavern/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, stream: true })
  }))

  await page.setContent(`<!doctype html>
  <html class="dsh-tavern-shell-active">
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body class="dsh-tavern-shell-active">
      <div id="full-page-host"></div>
      <div id="overlay-host"></div>
      <div data-conversation-content>
        <div data-composer-seat>
          <div data-composer-card>
            <div style="flex:1">输入框</div>
            <button type="button" class="_7KE1Ra_trigger" aria-controls="model-menu">⚙</button>
          </div>
          <div data-composer-dock>
            <span data-composer-stat="activity"><button type="button" class="bOPqQW_pill"><span class="bOPqQW_label">12 轮 2 步<span class="bOPqQW_sep">·</span>88 tok/s</span></button></span>
            <span data-composer-stat="usage"><button type="button" class="bOPqQW_pill"><span class="bOPqQW_label">32K tok<span class="bOPqQW_sep">·</span>缓存命中 0%</span></button></span>
            <button type="button" class="JObwrW_trigger" aria-label="已使用 25% 上下文">25%</button>
          </div>
        </div>
      </div>
      <div id="model-menu" class="_7KE1Ra_menu" role="menu">
        <button type="button" role="menuitem" class="_7KE1Ra_cell"><span class="_7KE1Ra_cellLabel">模型</span><span class="_7KE1Ra_cellValue">claude-4-sonnet</span></button>
      </div>
    </body>
  </html>`)

  await page.addStyleTag({ content: baseHostCss })
  await page.addStyleTag({ content: tavernCss })
  await page.addStyleTag({ content: themeCss })
  await page.addStyleTag({ content: paperCss })
  await page.addScriptTag({ content: generationStreamModeBootScript() })

  const bootstrap = `
    ${reactScript}
    window.React = modules.react;
    window.ReactDOM = { ...modules['react-dom'], ...modules['react-dom/client'] };
    window.__calls = [];
    window.__nativeTriggerCount = 0;
    document.querySelector('.JObwrW_trigger').addEventListener('click', () => { window.__nativeTriggerCount += 1; });
    window.rpc = async function (method, args) {
      window.__calls.push({ method, args });
      if (method === 'getLatestRequestContext') {
        const sc = args && args.scope === 'background' ? 'background' : 'foreground';
        return {
          record: { ...window.__payload.record, scope: sc },
          meta: { ...window.__payload.meta, scope: sc }
        };
      }
      if (method === 'runCompaction') return { result: { status: 'completed' } };
      return {};
    };
    window.__payload = ${JSON.stringify(sampleRpcPayload)};
    window.tavernSessionSignals = { subscribe: () => () => {} };
    window.compactionRuns = { set: () => {}, get: () => null, subscribe: () => () => {} };
    window.useCompactionState = () => ({ running: false });
    window.liveTavernView = { invalidate: () => {} };
    window.downloadTavernBlob = () => {};
    window.EmptyState = function EmptyState(p) { return React.createElement('p', null, '暂无' + (p.noun || '')); };
    window.TavernLazyDetails = function TavernLazyDetails(p) {
      const [open, setOpen] = React.useState(Boolean(p.defaultOpen));
      React.useEffect(() => { if (p.defaultOpen) setOpen(true); }, [p.defaultOpen]);
      return React.createElement('details', {
        className: p.className,
        open,
        onToggle: e => setOpen(e.currentTarget.open),
        ...(p.attributes || {})
      }, p.summary, open ? p.render() : null);
    };
    ${modelJs}
    ${featureJs}
    ReactDOM.createRoot(document.getElementById('overlay-host')).render(React.createElement(TavernContextWindowOverlay, { sessionId: 'sess-ui' }));
    window.__mountFullPage = function () {
      ReactDOM.createRoot(document.getElementById('full-page-host')).render(React.createElement(FullRequestContextView, { contextSessionId: 'sess-ui' }));
    };
  `
  await page.addScriptTag({ content: bootstrap })
  return { consoleErrors, pageErrors }
}

test('桌面端拦截原生上下文按钮弹出 426px Magpie 浮层、切 Waffle 与宽弹窗、并在完整页点击 Tile 跳转展开', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const { consoleErrors, pageErrors } = await mountTestPage(page, 1280, 800)

  // 点击 25% 上下文按钮，应被捕获拦截并弹出 426px 浮层
  await page.locator('[data-composer-dock] .JObwrW_trigger').click()
  const popover = page.locator('.dsh-ctx-popover')
  await popover.waitFor({ state: 'visible' })
  const box = await popover.boundingBox()
  assert.ok(box.width >= 400 && box.width <= 430, `浮层宽度约 426px，实际 ${box.width}`)
  assert.equal(await page.evaluate(() => window.__nativeTriggerCount), 0, '捕获拦截阻止了宿主原生 click handler')

  // 切换 Waffle 视图并验证渲染 400 格
  await popover.locator('button[aria-label="Waffle 网格图"]').click()
  assert.equal(await popover.locator('.dsh-ctx-waffle-cell').count(), 400)
  await popover.locator('button[aria-label="Treemap 块状图"]').click()

  // 无隐藏 Tab 时点击「完整分析 ›」打开宽弹窗（带完整页并支持点击 Tile 跳转展开）
  await popover.getByRole('button', { name: '完整分析 ›' }).click()
  const modal = page.locator('.dsh-ctx-modal')
  await modal.waitFor({ state: 'visible' })
  await modal.locator('.dsh-ctx-card.is-full').waitFor({ state: 'visible' })

  // 验证完整页中 .dsh-tavern-full-context button 不再覆盖色块背景与切换按钮图标
  const fullCheck = await modal.evaluate(el => {
    const baseBg = getComputedStyle(document.body).backgroundColor
    const tile = el.querySelector('.dsh-ctx-tile:not(.is-free)')
    const tileBg = tile ? getComputedStyle(tile).backgroundColor : ''
    const modeBtns = [...el.querySelectorAll('.dsh-ctx-mode-btn')]
    const svgWidths = modeBtns.map(b => b.querySelector('svg')?.getBoundingClientRect().width || 0)
    const legendBtn = el.querySelector('.dsh-ctx-legend-item:not(.is-readonly)')
    const legendBorder = legendBtn ? getComputedStyle(legendBtn).borderTopColor : ''
    const tileAnim = tile ? getComputedStyle(tile).animationName : ''
    return { baseBg, tileBg, svgWidths, legendBorder, tileAnim }
  })
  assert.notEqual(fullCheck.tileBg, fullCheck.baseBg, '完整页 Treemap 色块应保留填充底色，不被底色覆盖')
  assert.notEqual(fullCheck.tileBg, 'rgba(0, 0, 0, 0)', '完整页 Treemap 色块不应为透明')
  assert.ok(fullCheck.svgWidths.length === 2 && fullCheck.svgWidths.every(w => w >= 12), `切换按钮 SVG 图标应可见，实际宽度 ${JSON.stringify(fullCheck.svgWidths)}`)
  assert.equal(fullCheck.tileAnim, 'dsh-ctx-tile-enter', 'Treemap 色块具备 Magpie 错峰入场动画')

  // 验证悬停选择高亮：其余色块（含剩余空间）降淡、当前色块高亮、弹出深色悬浮气泡
  const targetTile = modal.locator('[data-ctx-tile^="msg:0#"]')
  await targetTile.hover()
  await modal.locator('.dsh-ctx-tip.is-placed').waitFor({ state: 'visible' })
  const hoverCheck = await modal.evaluate(el => {
    const map = el.querySelector('.dsh-ctx-treemap')
    const active = el.querySelector('[data-ctx-tile^="msg:0#"]')
    const free = el.querySelector('.dsh-ctx-tile.is-free')
    const tip = el.querySelector('.dsh-ctx-tip')
    return {
      focus: map?.getAttribute('data-focus'),
      activeOn: active?.classList.contains('is-on'),
      activeOpacity: active ? Number(getComputedStyle(active).opacity) : 0,
      freeOpacity: free ? Number(getComputedStyle(free).opacity) : 1,
      tipBg: tip ? getComputedStyle(tip).backgroundColor : '',
      tipBgImage: tip ? getComputedStyle(tip).backgroundImage : '',
      tipVisible: !!tip && getComputedStyle(tip).visibility !== 'hidden'
    }
  })
  assert.equal(hoverCheck.focus, 'tile', '悬停色块时进入 tile 聚焦态')
  assert.equal(hoverCheck.activeOn, true, '悬停色块标记为 is-on')
  assert.ok(hoverCheck.freeOpacity < 0.5, `其余色块应明显变淡，实际 opacity=${hoverCheck.freeOpacity}`)
  assert.equal(hoverCheck.tipVisible, true, '悬停色块弹出悬浮气泡')
  assert.equal(hoverCheck.tipBg, 'rgb(23, 23, 27)', '悬浮气泡采用深色高对比背景')
  assert.equal(hoverCheck.tipBgImage, 'none', '悬浮气泡不被 theme.css 的浅色 tooltip 渐变覆盖')

  // 切换到 Waffle 网格检查波浪入场动画与聚焦效果，再切回 Treemap
  await modal.locator('button[aria-label="Waffle 网格图"]').click()
  const waffleAnim = await modal.locator('.dsh-ctx-waffle-cell').first().evaluate(el => getComputedStyle(el).animationName)
  assert.equal(waffleAnim, 'dsh-ctx-cell-enter', 'Waffle 400 格具备波浪入场动画')
  await modal.locator('.dsh-ctx-row').first().hover()
  const rowFocus = await modal.locator('.dsh-ctx-waffle').getAttribute('data-focus')
  assert.equal(rowFocus, 'item', '悬停内容列表行联动高亮 Waffle 对应格子')
  await modal.locator('button[aria-label="Treemap 块状图"]').click()

  // 点击首处缓存断层对应的 Tile（msg:0）应定位并展开该段落 details
  await modal.locator('[data-ctx-tile^="msg:0#"]').click()
  const detailsOpen = await modal.locator('details[data-cache-key="msg:0"]').evaluate(el => el.open)
  assert.equal(detailsOpen, true, '点击 Treemap Tile 跳转并自动展开对应原文段落')
  await modal.locator('.dsh-context-diff-box').waitFor({ state: 'visible' })

  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(pageErrors, [])
})

test('移动端通过菜单底栏开启 Bottom Sheet，支持 390px/320px 零溢出、tap 选中查看详情及真压缩 RPC', async t => {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ hasTouch: true })
  const { consoleErrors, pageErrors } = await mountTestPage(page, 390, 844)

  // 验证方案 C 已根据实时摘要给模型触发器同步 0% 告警微角标
  await page.waitForFunction(() => document.querySelector('._7KE1Ra_trigger')?.getAttribute('data-ctx-pill') === '0%')

  // 点击模型菜单底栏唤起 Bottom Sheet
  await page.locator('#model-menu [data-dsh-tavern-mobile-stats]').click()
  const sheet = page.locator('.dsh-ctx-sheet[role="dialog"]')
  await sheet.waitFor({ state: 'visible' })

  // 玻璃皮肤将底色 token 设为半透明时，抽屉与底栏必须叠在 Canvas 实底上防止透视正文
  const solidBgCheck = await page.evaluate(() => {
    document.body.style.setProperty('--dsw-alias-bg-base', 'rgba(250, 249, 245, 0.35)')
    document.body.style.setProperty('--dsw-specific-sidebar-fill', 'rgba(250, 249, 245, 0.35)')
    const sheetEl = document.querySelector('.dsh-ctx-sheet')
    const stickyEl = document.querySelector('.dsh-ctx-sheet-sticky')
    return {
      sheetBgImage: getComputedStyle(sheetEl).backgroundImage,
      sheetBgColor: getComputedStyle(sheetEl).backgroundColor,
      stickyBgImage: getComputedStyle(stickyEl).backgroundImage,
      stickyBgColor: getComputedStyle(stickyEl).backgroundColor
    }
  })
  assert.match(solidBgCheck.sheetBgImage, /linear-gradient/, '移动端抽屉采用 --dsh-tavern-solid 实底叠加层')
  assert.notEqual(solidBgCheck.sheetBgColor, 'rgba(0, 0, 0, 0)', '移动端抽屉底层 Canvas 必须不透明')
  assert.match(solidBgCheck.stickyBgImage, /linear-gradient/, '移动端抽屉底栏同样采用实底叠加层')
  assert.notEqual(solidBgCheck.stickyBgColor, 'rgba(0, 0, 0, 0)', '移动端抽屉底栏底层 Canvas 必须不透明')

  const filters = sheet.locator('.dsh-ctx-chips')
  for (const width of [390, 375, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    assert.equal(noOverflow, true, `${width}px: 抽屉内无横向溢出`)
    assert.equal(await filters.evaluate(el => el.scrollWidth <= el.clientWidth), true, `${width}px: context filters fit without sideways scrolling`)
  }
  const lastFilter = filters.getByRole('button').last()
  await lastFilter.press('Enter')
  assert.match(await lastFilter.getAttribute('class'), /\bis-active\b/)
  await lastFilter.press('Enter')
  assert.match(await filters.getByRole('button', { name: '全部' }).getAttribute('class'), /\bis-active\b/)

  // 点击 Treemap Tile 显示底部 tap 选中 bar，再点「查看原文 ›」切入抽屉内二级明细并可返回
  await sheet.locator('[data-ctx-tile^="msg:0#"]').click()
  const selectedBar = sheet.locator('.dsh-ctx-selected-bar')
  await selectedBar.waitFor({ state: 'visible' })
  await selectedBar.getByRole('button', { name: '查看原文 ›' }).click()
  await sheet.locator('.dsh-ctx-sheet-subhead').waitFor({ state: 'visible' })
  await sheet.locator('.dsh-context-diff-box').waitFor({ state: 'visible' })

  await sheet.getByRole('button', { name: '‹ 返回总览' }).click()
  await sheet.getByRole('button', { name: '压缩上下文' }).click()
  const compacted = await page.evaluate(() => window.__calls.some(c => c.method === 'runCompaction'))
  assert.equal(compacted, true, '点击压缩上下文实际调用 runCompaction RPC')

  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(pageErrors, [])
})
