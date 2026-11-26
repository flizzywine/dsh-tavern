import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import {chromium} from 'playwright'

for(const width of [900,390]) for(const opening of [false,true]) test(`embedded panel shrinks after collapse at width ${width}, opening=${opening}`,async()=>{
 let descriptor
 vm.runInNewContext(await readFile('tavern-plugin/lib/client.js','utf8'),{window:{__ModuleLoader__:{load(value){descriptor=value}}},console})
 const client=descriptor.factory(()=>({})),browser=await chromium.launch()
 try {
  const page=await browser.newPage({viewport:{width,height:900}})
  await page.route('**/*',route=>route.abort())
  const content='<style>body{min-height:100vh}summary{height:64px;background:#112244;color:white}.inside{height:700px}</style><details open><summary>平行事件 · 3 则</summary><div class="inside">事件内容</div></details>'
  const doc=client.buildTavernFrameDocument({content,token:'collapse',...(opening ? {openingPreview:{runtime:{context:{},scripts:[]}}} : {})})
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

test('an absolutely centered opening keeps the viewport height its controls need', async () => {
  let descriptor
  vm.runInNewContext(await readFile('tavern-plugin/lib/client.js', 'utf8'), {
    window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
  })
  const client = descriptor.factory(() => ({}))
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 950, height: 850 } })
    await page.route('**/*', route => route.abort())
    const content = `<style>
      html,body { overflow: hidden; }
      body { position: relative; height: 100vh; }
      .screen { position: absolute; top: 50%; left: 50%; width: 90%; height: 80vh;
        transform: translate(-50%, -50%); display: grid; place-content: center; }
    </style><div class="screen"><h1>重塑仙缘</h1><button>开始</button></div>`
    const doc = client.buildTavernFrameDocument({ content, token: 'centered-opening' })
    await page.setContent('<iframe style="display:block;width:529px;height:48px;border:0"></iframe>')
    await page.evaluate(doc => {
      const frame = document.querySelector('iframe')
      window.onmessage = event => {
        if (event.source === frame.contentWindow && event.data.type === 'dsh-tavern-frame-height') {
          frame.style.height = event.data.height + 'px'
        }
      }
      frame.srcdoc = doc
    }, doc)
    const frame = page.frames()[1]
    await frame.waitForFunction(() => document.body.getBoundingClientRect().height >= 850)
    const bounds = await frame.locator('button').evaluate(button => {
      const rect = button.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, height: innerHeight }
    })
    assert.equal(bounds.height, 850)
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, JSON.stringify(bounds))
    await frame.locator('button').click()
  } finally { await browser.close() }
})
