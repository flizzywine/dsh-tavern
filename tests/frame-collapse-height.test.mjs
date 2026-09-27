import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import vm from 'node:vm'
import {chromium} from 'playwright'

for(const width of [900,390]) test(`embedded status panel shrinks after collapse at width ${width}`,async()=>{
 let descriptor
 vm.runInNewContext(await readFile('tavern-plugin/lib/client.js','utf8'),{window:{__ModuleLoader__:{load(value){descriptor=value}}},console})
 const client=descriptor.factory(()=>({})),browser=await chromium.launch()
 try {
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('**/*',route=>route.abort())
  const content='<style>body{min-height:100vh}summary{height:64px;background:#112244;color:white}.inside{height:700px}</style><details open><summary>平行事件 · 3 则</summary><div class="inside">事件内容</div></details>'
  const doc=client.buildTavernFrameDocument({content,token:'collapse'})
  await page.setContent('<iframe style="display:block;width:100%;height:900px;border:0"></iframe><p id="after">下段正文应紧接状态栏</p>')
  await page.evaluate(doc=>{window.heights=[];window.onmessage=e=>{if(e.data.type==='dsh-tavern-frame-height'){heights.push(e.data.height);document.querySelector('iframe').style.height=e.data.height+'px'}};document.querySelector('iframe').srcdoc=doc},doc)
  const frame=page.frames()[1]
  await frame.waitForSelector('summary')
  await frame.locator('summary').click()
  await page.waitForTimeout(300)
  const result=await page.evaluate(()=>({height:document.querySelector('iframe').clientHeight,reports:heights}))
  assert.equal(result.height,64,JSON.stringify(result))
  assert.ok(await page.locator("#after").evaluate(node=>node.getBoundingClientRect().top<110))
  await mkdir('output/frame-size-audit',{recursive:true})
  await page.screenshot({path:`output/frame-size-audit/collapsed-${width}.png`})
  console.log(JSON.stringify({width,...result}))
  await frame.locator('summary').click()
  await page.waitForFunction(()=>document.querySelector('iframe').clientHeight>=764)
  await frame.locator('summary').click()
  await page.waitForFunction(()=>document.querySelector('iframe').clientHeight<100)
  // Closed details descendants can retain layout boxes; they must not request
  // a viewport floor just because their own rule uses viewport units.
  await frame.evaluate(()=>{const style=document.createElement('style');style.textContent='.inside{height:100vh}';document.head.append(style)})
  await page.waitForTimeout(200)
  assert.equal(await page.locator('iframe').evaluate(node=>node.clientHeight),64)
 } finally {await browser.close()}
})
