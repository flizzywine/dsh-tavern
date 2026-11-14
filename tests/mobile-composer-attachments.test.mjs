// 手机端输入卡（dsh-tavern-coarse-play 与 dsh-fork-phone-play）改为三列网格后，
// 宿主的附件槽 [data-slot="conversation.input.attachments"] 外层带 display:contents，
// 其子元素附件栏不能放在 `[data-composer-card] > :is(...)` 里匹配，否则会落回第 1 列把输入框挤窄或盖住；
// 同时需把附件栏的负 margin-bottom 改为正间距，并将 40px 触控热区限定在工具行按钮，不撑大卡片移除键。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const css = async name => readFile(new URL('../tavern-plugin/lib/client-assets/' + name, import.meta.url), 'utf8')

const hostCss = `
.uV2eYG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,780px);border-radius:16px;background:#222;flex-direction:column;gap:12px;padding-top:8px;display:flex;position:relative}
.uV2eYG_overlayAnchor{height:0;position:absolute;inset:0 0 auto}
.uV2eYG_accessory{align-items:center;gap:8px;padding:10px 12px 0;display:flex}
.uV2eYG_scroll{max-height:336px;margin-right:4px;overflow-y:auto}
.uV2eYG_grow{position:relative}
.uV2eYG_input{box-sizing:border-box;min-height:36px;padding:4px 8px 0 14px;outline:none}
.uV2eYG_input p{margin:0}
.uV2eYG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex}
.uV2eYG_tools,.uV2eYG_modes,.uV2eYG_trailing{align-items:center;min-width:0;display:flex}
.uV2eYG_tools,.uV2eYG_modes{gap:12px}
.uV2eYG_trailing{flex:none;gap:12px;margin-left:auto}
.uV2eYG_add{width:28px;height:28px;border-radius:999px;flex:none;display:grid;place-items:center}
.uV2eYG_primary{width:34px;height:34px;border-radius:999px;flex:none;display:grid;place-items:center;transform:translateY(-2px)}
._54WpYG_rail{min-width:0;margin-bottom:-6px;padding:2px 10px 0}
.JVDQca_root{min-width:0;position:relative}
.JVDQca_rail{align-items:stretch;gap:10px;display:flex;overflow:auto hidden}
.JVDQca_item{flex:none;height:64px}
.gSkjMW_card{box-sizing:border-box;align-items:center;gap:10px;width:240px;height:64px;padding:0 12px;display:inline-flex;position:relative}
.gSkjMW_remove{width:18px;height:18px;border-radius:50%;position:absolute;top:6px;right:6px}
`

function buildMarkup({ htmlClass, withAccessory, fileCount }) {
  const items = Array.from({ length: fileCount }, (_, index) =>
    `<div class="JVDQca_item"><div class="gSkjMW_card"><span>file-${index}.json</span><button class="gSkjMW_remove" type="button">×</button></div></div>`
  ).join('')
  return `<!doctype html><html class="${htmlClass}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="dsh-tavern-shell-active">
<div data-dsh-fork-session="play">
  <div data-composer-seat style="padding:0 16px">
    <div>
      <div class="uV2eYG_card" data-composer-card="true">
        <div class="uV2eYG_overlayAnchor" data-composer-overlay="true"></div>
        ${withAccessory ? '<div class="uV2eYG_accessory"><span>顶部提示</span></div>' : ''}
        <div data-slot="conversation.input.attachments" style="display:contents">
          ${fileCount > 0 ? `<div class="_54WpYG_rail"><div class="JVDQca_root"><div class="JVDQca_rail" role="group">${items}</div></div></div>` : ''}
        </div>
        <div class="uV2eYG_scroll" data-input-scroll="true">
          <div class="uV2eYG_grow">
            <div class="uV2eYG_input" data-composer-input="true" contenteditable="true"><p>测试输入</p></div>
          </div>
        </div>
        <div class="uV2eYG_row">
          <div class="uV2eYG_tools">
            <button class="uV2eYG_add" type="button">+</button>
            <div class="uV2eYG_modes"></div>
            <div data-slot="conversation.input.left" style="display:contents"><button data-mobile-nav="file-upload" type="button">📎</button></div>
          </div>
          <div class="uV2eYG_trailing">
            <button class="fork-model-trigger" type="button">M</button>
            <button class="uV2eYG_primary" type="button">↑</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div></body></html>`
}

test('手机端输入框挂载附件后不遮挡、不挤窄输入框，且不撑大附件移除按钮', async t => {
  const [tavernCss, themeCss] = await Promise.all([css('tavern.css'), css('theme.css')])
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })

  const measure = async options => {
    await page.setContent(buildMarkup(options))
    await page.addStyleTag({ content: hostCss })
    await page.addStyleTag({ content: tavernCss })
    await page.addStyleTag({ content: themeCss })
    return page.evaluate(() => {
      const box = selector => {
        const el = document.querySelector(selector)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
      }
      return {
        card: box('[data-composer-card]'),
        acc: box('.uV2eYG_accessory'),
        rail: box('._54WpYG_rail'),
        remove: box('.gSkjMW_remove'),
        input: box('[data-input-scroll]'),
        tools: box('.uV2eYG_tools'),
        trailing: box('.uV2eYG_trailing'),
        send: box('.uV2eYG_primary'),
      }
    })
  }

  const empty = await measure({ htmlClass: 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play', withAccessory: false, fileCount: 0 })
  const single = await measure({ htmlClass: 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play', withAccessory: false, fileCount: 1 })
  const multi = await measure({ htmlClass: 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play', withAccessory: false, fileCount: 3 })
  const accAndFile = await measure({ htmlClass: 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play', withAccessory: true, fileCount: 1 })
  const phonePlay = await measure({ htmlClass: 'dsh-tavern-viewport-pinned dsh-tavern-coarse-play dsh-fork-phone-play', withAccessory: true, fileCount: 1 })

  for (const [label, view, baseInputWidth] of [
    ['单附件(coarse-play)', single, empty.input.width],
    ['多附件(coarse-play)', multi, empty.input.width],
    ['顶部提示+附件(coarse-play)', accAndFile, empty.input.width],
  ]) {
    assert.ok(view.rail.width >= view.card.width - 16, `${label}: 附件栏应横跨整张输入卡`)
    assert.ok(view.rail.bottom <= view.input.top + 0.5, `${label}: 附件栏底边(${view.rail.bottom})不应压住输入框顶边(${view.input.top})`)
    assert.ok(Math.abs(view.input.width - baseInputWidth) <= 1, `${label}: 输入框宽度不应因附件被压缩(${view.input.width} vs ${baseInputWidth})`)
    assert.ok(view.tools.right <= view.input.left + 0.5 && view.input.right <= view.trailing.left + 0.5, `${label}: 工具、输入框、右侧按钮应三列有序排列`)
    assert.ok(view.remove.width <= 20 && view.remove.height <= 20, `${label}: 附件移除按钮应保持宿主小尺寸(${view.remove.width}x${view.remove.height})`)
    assert.ok(view.send.width >= 40 && view.send.height >= 40, `${label}: 发送按钮保持 40px 触控热区`)
  }

  assert.ok(accAndFile.acc.bottom <= accAndFile.rail.top + 0.5, '顶部提示应排在附件栏上方，互不重叠')
  assert.ok(phonePlay.acc.bottom <= phonePlay.rail.top + 0.5, 'phone-play 模式下顶部提示与附件栏不重叠')
  assert.ok(phonePlay.rail.bottom <= phonePlay.input.top + 0.5, 'phone-play 模式下附件栏不遮挡输入框')
  assert.ok(phonePlay.input.width >= 200, `phone-play 模式下输入框应保留充足宽度(${phonePlay.input.width})`)
})
