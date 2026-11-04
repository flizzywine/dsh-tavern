// A typing page keeps the line breaks of the whole page: every glyph, shown or still hidden, stays on the line it has
// once the page is typed, in a box whose lines break as prose (text-wrap: pretty).
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'

// (at this width a split page re-broke into 5 lines while the typed page has 4)
const TEXT = '「欸？你说的那个地方，真的存在吗……」她歪着头看着我，眼睛里闪着好奇的光，像是在期待一个只属于我们两个人的秘密答案。'

test('a typing page keeps the whole page line breaks until its last glyph shows', {timeout: 60000}, async t => {
  const browser = await chromium.launch({headless: true, args: ['--mute-audio']}); t.after(() => browser.close())
  const page = await browser.newPage({viewport: {width: 375, height: 812}}), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setContent(`<!doctype html><meta charset="utf-8"><div class="fork-gal-text" id="text"></div>`)
  // the stage's typewriter rules, and a text element whose lines break as prose (on the class: the typewriter measures
  // its lines in a clone of the text element)
  const themes = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css', import.meta.url), 'utf8')
  const typeRules = themes.split('\n').filter(line => /^(\.fork-gal-type|\.fork-gal-glyph|@keyframes fork-gal-glyph-in)/.test(line))
  await page.addStyleTag({content: typeRules.join('\n') + '\n.fork-gal-text{width:317px;font:17px/1.6 serif;word-break:keep-all;line-break:strict;overflow-wrap:anywhere;text-wrap:pretty}'})
  await page.addScriptTag({content: await browserReactScript() + `
    const React=modules.react,ReactDOM={...modules['react-dom'],...modules['react-dom/client']};
    ${await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/text.cjs', import.meta.url), 'utf8')}
    const clock={now:()=>performance.now(),setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id),requestAnimationFrame:fn=>requestAnimationFrame(fn),cancelAnimationFrame:id=>cancelAnimationFrame(id)};
    const {Typewriter}=createStageText({React,document,performance,ResizeObserver,getComputedStyle,clock,fonts:{subscribe:()=>()=>{},getSnapshot:()=>0},sounds:null,defaultTextSpeed:28});
    const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
    // the glyph indexes that start a line, as the page is laid out on screen now (shown run, fading glyphs and hidden rest;
    // a collapsible space at a line end has no place of its own)
    window.lineStarts=()=>{
      const type=document.querySelector('.fork-gal-type'),walker=document.createTreeWalker(type,NodeFilter.SHOW_TEXT),range=document.createRange(),starts=[]
      let index=0,top=null
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        let offset=0
        for(const {segment} of segmenter.segment(node.data)){
          range.setStart(node,offset);range.setEnd(node,offset+=segment.length)
          const rect=/^\s$/.test(segment)?null:range.getClientRects()[0]
          if(rect){if(top!==null&&rect.top>top+rect.height/2)starts.push(index);if(top===null||rect.top>top+rect.height/2)top=rect.top}
          index++
        }
      }
      return starts
    };
    window.typePage=text=>new Promise(resolve=>{
      const samples=[]
      const sample=()=>{const type=document.querySelector('.fork-gal-type');if(type)samples.push({starts:lineStarts(),runs:type.querySelectorAll('.fork-gal-type-line').length});requestAnimationFrame(sample)}
      requestAnimationFrame(sample)
      ReactDOM.createRoot(document.querySelector('#text')).render(React.createElement(Typewriter,{text,speed:12,onDone:()=>setTimeout(()=>resolve({samples,starts:lineStarts(),lines:document.querySelectorAll('.fork-gal-type-line').length}),400)}))
    });
  `})
  const got = await page.evaluate(text => typePage(text), TEXT)
  assert.ok(got.starts.length >= 2, `the page wraps onto several lines: ${JSON.stringify(got.starts)}`)
  // typed: one run again, laid out as the plain page
  assert.equal(got.lines, 0)
  const typing = got.samples.filter(sample => sample.runs)
  assert.ok(typing.length > 10, `${typing.length} typing frames sampled`)
  for (const sample of typing) {
    assert.equal(sample.runs, got.starts.length + 1)
    assert.deepEqual(sample.starts, got.starts)
  }
  assert.deepEqual(errors, [])
})
