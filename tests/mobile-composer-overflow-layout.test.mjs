// 移动端输入框文字超出时的自适应两行排版：
// - 空态或单行短文本维持「工具 | 输入 | 发送」紧凑三列单行，节省阅读区高度；
// - 文字换行（超出窄列宽或显式换行）后自动切换为「全宽输入区 + 底部单行工具栏」；
// - 具备回滞余量，展开变宽后不会在临界字数上反复展开/收起抖动；
// - 长草稿超出最大高度时由单一滚动容器滚动，并在工具栏上方显示细分隔线；
// - 兼容 dsh-tavern-coarse-play、dsh-fork-phone-play、paper.css 皮肤、附件栏与极短横屏视口。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const readText = rel => readFile(new URL(rel, import.meta.url), 'utf8')

const hostCss = `
:root{
  --dsw-alias-border-l2:#e5dfd5;
  --dsw-alias-label-primary:#1f1c18;
  --dsw-alias-label-secondary:#6b645c;
  --dsw-alias-label-tertiary:#9a9186;
  --dsw-specific-input-major:#fffdf9;
  --dsw-alias-brand-primary:#9c5a44;
  --bg-raised:#fffdf9;
  --border:#e5dfd5;
  --r-lg:14px;
  --r-md:10px;
  --r-sm:8px;
  --accent:#9c5a44;
  --accent-hover:#854b38;
  --on-accent:#fff;
  --text-primary:#1f1c18;
  --text-secondary:#6b645c;
  --text-muted:#9a9186;
  --font-sans:system-ui,-apple-system,"PingFang SC","Noto Sans SC",sans-serif;
}
body{margin:0;font-family:var(--font-sans);background:#f7f2ea}
.uV2eYG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,780px);border-radius:16px;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;padding-top:8px;display:flex;position:relative}
.uV2eYG_overlayAnchor{height:0;position:absolute;inset:0 0 auto}
.uV2eYG_accessory{align-items:center;gap:8px;padding:10px 12px 0;display:flex;font-size:12px;color:#6b645c}
.uV2eYG_scroll{max-height:336px;margin-right:4px;overflow-y:auto}
.uV2eYG_grow{position:relative}
.uV2eYG_input{box-sizing:border-box;min-height:36px;padding:4px 8px 0 14px;outline:none}
.uV2eYG_input p{margin:0}
.uV2eYG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex}
.uV2eYG_tools,.uV2eYG_modes,.uV2eYG_trailing{align-items:center;min-width:0;display:flex}
.uV2eYG_tools,.uV2eYG_modes{gap:12px}
.uV2eYG_trailing{flex:none;gap:12px;margin-left:auto}
.uV2eYG_add{width:28px;height:28px;border-radius:999px;flex:none;display:grid;place-items:center;border:0;background:transparent}
.uV2eYG_primary{width:34px;height:34px;border-radius:999px;flex:none;display:grid;place-items:center;border:0;background:var(--accent);color:#fff;transform:translateY(-2px)}
._54WpYG_rail{min-width:0;margin-bottom:-6px;padding:2px 10px 0}
.JVDQca_root{min-width:0;position:relative}
.JVDQca_rail{align-items:stretch;gap:10px;display:flex;overflow:auto hidden}
.JVDQca_item{flex:none;height:56px}
.gSkjMW_card{box-sizing:border-box;align-items:center;gap:10px;width:200px;height:56px;padding:0 12px;display:inline-flex;position:relative;border:1px solid #ddd;border-radius:10px;background:#fff}
`

function buildMarkup({ htmlClass = '', withAccessory = false, withAttachment = false, initialHtml = '<p><br class="ProseMirror-trailingBreak"></p>' } = {}) {
  return `<!doctype html><html class="${htmlClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="dsh-tavern-shell-active">
<div data-dsh-fork-session="play">
  <header style="height:44px"></header>
  <div data-composer-seat style="position:fixed;left:0;right:0;bottom:0;padding:0 12px 10px">
    <div>
      <div class="uV2eYG_card" data-composer-card="true">
        <div class="uV2eYG_overlayAnchor" data-composer-overlay="true"></div>
        ${withAccessory ? '<div class="uV2eYG_accessory"><span>正在编辑上一条输入</span></div>' : ''}
        <div data-slot="conversation.input.attachments" style="display:contents">
          ${withAttachment ? '<div class="_54WpYG_rail"><div class="JVDQca_root"><div class="JVDQca_rail" role="group"><div class="JVDQca_item"><div class="gSkjMW_card"><span>scene-note.md</span></div></div></div></div></div>' : ''}
        </div>
        <div class="uV2eYG_scroll" data-input-scroll="true">
          <div class="uV2eYG_grow">
            <div class="uV2eYG_input" data-composer-input="true" contenteditable="true">${initialHtml}</div>
          </div>
        </div>
        <div class="uV2eYG_row">
          <div class="uV2eYG_tools">
            <button class="uV2eYG_add" type="button">+</button>
            <div class="uV2eYG_modes"></div>
            <div data-slot="conversation.input.left" style="display:contents"><button data-mobile-nav="file-upload" type="button" style="border:0;background:transparent">📎</button></div>
          </div>
          <div class="uV2eYG_trailing">
            <button class="dsh-tavern-compass-tool-btn" type="button" style="border:0;background:transparent">🧭</button>
            <button class="fork-model-trigger" type="button" style="border:0;background:transparent">🗄️</button>
            <button class="uV2eYG_primary" type="button">↑</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div></body></html>`
}

async function setupPage(page, { layoutSource, tavernCss, themeCss, paperCss = '', htmlClass = '', withAccessory = false, withAttachment = false, initialHtml } = {}) {
  await page.setContent(buildMarkup({ htmlClass, withAccessory, withAttachment, initialHtml }))
  await page.addStyleTag({ content: hostCss })
  await page.addStyleTag({ content: tavernCss })
  await page.addStyleTag({ content: themeCss })
  if (paperCss) await page.addStyleTag({ content: paperCss })
  await page.addScriptTag({
    content: `
      function composerOffsetPx(vh, _top, rt) { return Math.max(0, Math.round(vh - rt)) }
      function sheetMaxPx(vh, rt, hb) { return Math.max(0, Math.round(rt - hb - 12)) }
      ${layoutSource}
      window.__disposePin = installVisualViewportPin(document);
    `
  })
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))
}

async function readMetrics(page) {
  return page.evaluate(() => {
    const box = sel => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const card = document.querySelector('[data-composer-card]')
    const scroll = document.querySelector('[data-input-scroll]')
    const input = document.querySelector('[data-composer-input]')
    const row = document.querySelector('.uV2eYG_row')
    const rowStyle = row ? getComputedStyle(row) : null
    return {
      multiline: card?.getAttribute('data-mobile-multiline') || null,
      scrollable: card?.getAttribute('data-mobile-input-scrollable') || null,
      card: box('[data-composer-card]'),
      acc: box('.uV2eYG_accessory'),
      rail: box('._54WpYG_rail'),
      scroll: box('[data-input-scroll]'),
      input: box('[data-composer-input]'),
      row: box('.uV2eYG_row'),
      tools: box('.uV2eYG_tools'),
      trailing: box('.uV2eYG_trailing'),
      send: box('.uV2eYG_primary'),
      rowDisplay: rowStyle?.display || null,
      rowBorderTopWidth: rowStyle ? parseFloat(rowStyle.borderTopWidth) || 0 : 0,
      scrollHeight: scroll?.scrollHeight || 0,
      clientHeight: scroll?.clientHeight || 0,
      inputOverflowY: input ? getComputedStyle(input).overflowY : null,
      scrollDisplay: scroll ? getComputedStyle(scroll).display : null,
    }
  })
}

async function setDraftHtml(page, html) {
  await page.evaluate(nextHtml => {
    const input = document.querySelector('[data-composer-input]')
    input.innerHTML = nextHtml
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, html)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))
}

test('移动端输入框文字超出时自动展开为全宽编辑区与底部工具栏，短文本回落且无临界抖动', async t => {
  const [layoutSource, tavernCss, themeCss, paperCss] = await Promise.all([
    readText('../tavern-plugin/src/client/modules/mobile-layout.js'),
    readText('../tavern-plugin/lib/client-assets/tavern.css'),
    readText('../tavern-plugin/lib/client-assets/theme.css'),
    readText('../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css'),
  ])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  await setupPage(page, { layoutSource, tavernCss, themeCss })

  // 1) 空态与单行短文本保持紧凑三列单行
  const empty = await readMetrics(page)
  assert.equal(empty.multiline, null, '空态不应触发展开')
  assert.ok(empty.tools.right <= empty.scroll.left + 1 && empty.scroll.right <= empty.trailing.left + 1, '空态维持三列单行')

  await setDraftHtml(page, '<p>推开门走进去</p>')
  const shortText = await readMetrics(page)
  assert.equal(shortText.multiline, null, '单行短文本维持紧凑三列单行')
  const compactWidth = shortText.scroll.width

  // 2) 超出单行（模拟点选「接下来的行动」长文本）自动展开为全宽编辑区 + 底部单行工具栏
  await setDraftHtml(page, '<p>她深吸一口气稳住脚步，借着昏暗灯光贴近观测站门缝仔细倾听外面的动静，同时示意身旁的人做好防备准备。</p>')
  const expanded = await readMetrics(page)
  assert.equal(expanded.multiline, 'true', '多行长文本应自动切换为展开态')
  assert.equal(expanded.rowDisplay, 'flex', '展开态底部工具栏恢复为 flex 单行')
  assert.equal(expanded.scrollDisplay, 'block', '展开态滚动容器取消 flex center，避免上下裁切')
  assert.equal(expanded.inputOverflowY, 'visible', '展开态由单一滚动容器滚动，不叠加双滚动条')
  assert.ok(expanded.scroll.width >= expanded.card.width - 24, `展开态输入区应铺满卡片全宽(${expanded.scroll.width} vs card ${expanded.card.width})`)
  assert.ok(expanded.scroll.width >= compactWidth * 1.7, `展开态输入宽度应远大于窄列(${expanded.scroll.width} vs ${compactWidth})`)
  assert.ok(expanded.row.top >= expanded.scroll.bottom - 1, `工具栏应完整位于输入区下方(${expanded.row.top} vs ${expanded.scroll.bottom})`)
  assert.ok(expanded.tools.right < expanded.trailing.left, '底栏工具在左、发送在右，互不重叠')
  assert.ok(expanded.send.right <= expanded.card.right + 1, '发送按钮不溢出卡片右边缘')

  // 3) 临界字数回滞：窄列会折行、全宽只需 1 行的字数，展开后跨多帧稳定不抖动
  await setDraftHtml(page, '<p>她推开厚重的铁门走向走廊尽头</p>')
  const boundary1 = await readMetrics(page)
  assert.equal(boundary1.multiline, 'true', '临界字数应留在展开态，不立刻回弹')
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))))
  const boundary2 = await readMetrics(page)
  assert.equal(boundary2.multiline, 'true', '临界字数跨多帧不发生展开/收起振荡')

  // 4) 删减回远短于窄列的字数后平滑回落到紧凑单行
  await setDraftHtml(page, '<p>好的</p>')
  const collapsed = await readMetrics(page)
  assert.equal(collapsed.multiline, null, '删短回紧凑列可容纳宽度后应回落单行')

  // 5) 显式换行（即使每行很短）也进入展开态，清空（发送后）立刻回落
  await setDraftHtml(page, '<p>第一行</p><p>第二行</p>')
  const explicitNewline = await readMetrics(page)
  assert.equal(explicitNewline.multiline, 'true', '显式换行应进入展开态')
  await setDraftHtml(page, '<p><br class="ProseMirror-trailingBreak"></p>')
  const cleared = await readMetrics(page)
  assert.equal(cleared.multiline, null, '发送清空后应立即回落紧凑单行')

  // 6) 超长草稿触发滚动态并展示工具栏上方细分隔线
  const veryLong = '观测站外传来低沉的机械轰鸣，沙尘顺着通风管道不断灌入走廊，所有人屏住呼吸紧盯雷达屏幕上跳动的红点。'.repeat(6)
  await setDraftHtml(page, `<p>${veryLong}</p>`)
  const scrolled = await readMetrics(page)
  assert.equal(scrolled.multiline, 'true')
  assert.equal(scrolled.scrollable, 'true', '超长草稿应标记 scrollable')
  assert.ok(scrolled.scrollHeight > scrolled.clientHeight + 2, '滚动容器应可平滑上下滚动')
  assert.ok(scrolled.rowBorderTopWidth >= 0.5, '滚动态工具栏上方应显示细分隔线')
  assert.ok(scrolled.row.top >= scrolled.scroll.bottom - 1, '滚动态工具栏不被文本压住')

  // 7) 带顶部提示 + 附件栏 + paper.css 皮肤的展开态排版无重叠
  await setupPage(page, {
    layoutSource,
    tavernCss,
    themeCss,
    paperCss,
    withAccessory: true,
    withAttachment: true,
    initialHtml: '<p>带着附件与顶部提示一起编辑一整段较长的行动描述，确保纸墨皮肤下四层纵向排布清晰不重叠。</p>',
  })
  const withPaper = await readMetrics(page)
  assert.equal(withPaper.multiline, 'true', 'paper.css 皮肤下超长文本也应自动展开')
  assert.ok(withPaper.acc.bottom <= withPaper.rail.top + 1, '顶部提示在附件栏上方')
  assert.ok(withPaper.rail.bottom <= withPaper.scroll.top + 1, '附件栏在全宽输入区上方')
  assert.ok(withPaper.scroll.bottom <= withPaper.row.top + 1, '全宽输入区在底部工具栏上方')
  assert.ok(withPaper.scroll.width >= withPaper.card.width - 24, 'paper.css 下输入区同样铺满卡片全宽')

  // 8) phone-play（极简游玩）同样支持多行展开
  await setupPage(page, {
    layoutSource,
    tavernCss,
    themeCss,
    htmlClass: 'dsh-fork-phone-play',
    initialHtml: '<p>极简游玩模式下输入一整段超过单行宽度的剧情行动描述，应自动切换为全宽输入区加底部工具栏。</p>',
  })
  const phonePlay = await readMetrics(page)
  assert.equal(phonePlay.multiline, 'true', 'phone-play 下长文本应自动展开')
  assert.equal(phonePlay.rowDisplay, 'flex', 'phone-play 展开态底部工具栏恢复为 flex')
  assert.ok(phonePlay.scroll.width >= phonePlay.card.width - 24, 'phone-play 展开态输入区铺满全宽')
  assert.ok(phonePlay.row.top >= phonePlay.scroll.bottom - 1, 'phone-play 展开态工具栏位于输入区下方')

  // 9) 横屏键盘极短视口（short-viewport）限制展开最大高度，不顶出屏幕
  const shortPage = await browser.newPage({ viewport: { width: 667, height: 260 }, hasTouch: true, isMobile: true })
  await setupPage(shortPage, {
    layoutSource,
    tavernCss,
    themeCss,
    initialHtml: `<p>${veryLong}</p>`,
  })
  const shortVp = await readMetrics(shortPage)
  await shortPage.close()
  assert.equal(shortVp.multiline, 'true')
  assert.ok(shortVp.scroll.height <= 60, `极短视口下展开输入区高度应受限(${shortVp.scroll.height})`)
  assert.ok(shortVp.card.height < 140, `极短视口下整张输入卡保持紧凑(${shortVp.card.height})`)
})
