// Portrait phone (390 x 844): the stage is never a scroll container. A skin's text bleed (--fk-text-bleed, wider than the
// art box's right padding on a phone) reaches a few px past the screen; with the stage at overflow: hidden, focusing a
// CONFIG tab scrolled the whole stage sideways and CONFIG stood at [-7, 383]. The CSS is the stage's themes.css.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const css=await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css',import.meta.url),'utf8')

test('portrait phone: content past the screen edge and a focused control never scroll the stage',{timeout:60000},async t => {
 const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(() => browser.close())
 const page=await browser.newPage({viewport:{width:390,height:844}})
 await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>html,body{margin:0}</style></head><body></body></html>`)
 const seen=await page.evaluate(() => {
  const stage=document.createElement('div');stage.className='fork-gal-stage'
  // a line box 7 px past the right edge, and a control at the right edge of an overlay
  stage.innerHTML='<div style="position:absolute;left:0;bottom:0;width:397px;height:40px"></div>'
   + '<div style="position:absolute;inset:0"><button type="button" style="position:absolute;right:-7px;top:10px;width:60px;height:30px">tab</button></div>'
  document.body.append(stage)
  stage.querySelector('button').focus()
  const focused=stage.scrollLeft
  stage.scrollLeft=7;stage.querySelector('button').scrollIntoView()
  return {focused,after:stage.scrollLeft,overflow:getComputedStyle(stage).overflowX}
 })
 assert.equal(seen.focused,0,'focusing a control does not scroll the stage')
 assert.equal(seen.after,0,`the stage cannot be scrolled (${JSON.stringify(seen)})`)
})
