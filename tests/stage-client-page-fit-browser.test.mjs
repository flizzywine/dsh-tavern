// A page cut by the stage's pager fits the box it is read in on narrow stages: on a phone (375 x 812), a tablet
// (768 x 1024) and a short landscape phone (812 x 375) the pager measures with the text element's own computed style
// (pageLines), a full card's lines stay inside the box and the box stays on the screen, and the pager reports a full
// card's block (its lines x line height) for layouts that keep a streaming card's room.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'

const LONG = '展厅下方的大理石地面上，她静静地站立着，夜风吹拂着她的裙摆，远处的钟声一下一下地传来。她抬起头望向穹顶，那里的玻璃早已碎裂，月光从缺口倾泻而下，落在她的肩上，也落在她脚边那一圈褪色的花纹上。'
const PAGE = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style><div class="fork-gal-stage" data-theme="classic" style="position:fixed;inset:0"><div id="root"></div></div>'

for (const [width, height] of [[375, 812], [768, 1024], [812, 375]]) {
  test(`${width} x ${height}: a full card fits its box and reports its block`, {timeout: 60000}, async t => {
    const browser = await chromium.launch({headless: true, args: ['--mute-audio']}); t.after(() => browser.close())
    const page = await browser.newPage({viewport: {width, height}}), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.setContent(PAGE)
    await page.addStyleTag({content: await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css', import.meta.url), 'utf8') + '\n*,*::before,*::after{animation-duration:0s!important;transition:none!important}'})
    await page.addScriptTag({content: await browserReactScript() + `
      const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
      const foreground={requestAnimationFrame:fn=>requestAnimationFrame(fn),cancelAnimationFrame:id=>cancelAnimationFrame(id),setTimeout:(f,ms)=>setTimeout(f,ms),clearTimeout:id=>clearTimeout(id)};
      ${await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/subtitles.cjs', import.meta.url), 'utf8')}
      const {useSubtitles,pageLines}=createStageSubtitles({React,document,window,foreground,fonts:{subscribe:()=>()=>{}},getComputedStyle,ResizeObserver,heldTail:()=>0,quote:t=>t});
      const h=React.createElement;
      function Probe({text}){
        const subtitles=useSubtitles(false,[{kind:'narration',text}],0,'probe','classic',null);
        window.subtitles=subtitles;
        return h('div',{className:'fork-gal-box'},h('div',{className:'fork-gal-text',ref:subtitles.textRef},h('span',{className:'fork-gal-type'},subtitles.text)));
      }
      window.mountProbe=text=>new Promise(resolve=>{
        ReactDOM.createRoot(document.querySelector('#root')).render(h(Probe,{text}));
        requestAnimationFrame(()=>requestAnimationFrame(resolve));
      });
      window.pageLines=pageLines;
    `})
    await page.evaluate(text => mountProbe(text), LONG.repeat(3))
    const got = await page.evaluate(() => {
      const box = document.querySelector('.fork-gal-box'), text = box.querySelector('.fork-gal-text'), type = text.querySelector('.fork-gal-type')
      const {lines, lineHeight} = pageLines(text, getComputedStyle(text), false)
      const range = document.createRange(), node = type.firstChild, rows = []
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1)
        const r = range.getBoundingClientRect(); if (!r.width) continue
        const row = rows.find(row => Math.abs(row.top - r.top) < r.height / 2)
        if (row) { row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right) } else rows.push({top: r.top, bottom: r.bottom, left: r.left, right: r.right})
      }
      const b = box.getBoundingClientRect()
      return {lines, lineHeight, cards: window.subtitles.cards.length, block: window.subtitles.block, rows, box: {left: b.left, top: b.top, right: b.right, bottom: b.bottom}}
    })
    const tag = `@${width}x${height}`
    assert.ok(got.lines >= 1 && got.lineHeight > 0, `${tag}: ${JSON.stringify(got)}`)
    assert.ok(got.cards >= 2, `${tag}: the long page is cut into ${got.cards} card(s)`)
    assert.equal(got.block, Math.round(got.lines * got.lineHeight * 100) / 100, `${tag}: block`)
    assert.ok(got.rows.length >= 1 && got.rows.length <= got.lines, `${tag}: ${got.rows.length} lines laid out for a ${got.lines}-line card`)
    for (const [i, row] of got.rows.entries()) {
      assert.ok(row.top >= got.box.top - .5 && row.bottom <= got.box.bottom + .5, `${tag}: line ${i + 1} ${JSON.stringify(row)} out of the box ${JSON.stringify(got.box)}`)
      assert.ok(row.left >= got.box.left - .5 && row.right <= got.box.right + .5, `${tag}: line ${i + 1} past the box's side`)
    }
    assert.ok(got.box.left >= -.5 && got.box.right <= width + .5 && got.box.bottom <= height + .5, `${tag}: the box off the screen ${JSON.stringify(got.box)}`)
    assert.deepEqual(errors, [])
  })
}
