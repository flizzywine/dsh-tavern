import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {openInterfaceSkins} from './fixtures/interface-skin-browser.mjs'
const font = {id:'example',family:'Example',label:'示例',category:'sans',files:[{url:'/dream-skin/fonts/example/400.woff2',weight:400,style:'normal',format:'woff2'}]}

test('skin font service owns faces; stage/reading choices survive unload and reload',async t=>{
  const {page,calls}=await openInterfaceSkins(t,{respond:method=>method==='listFonts'?{fonts:[font]}:method==='getActiveInterfaceSkin'?{css:''}:{skins:[],active:null}})
  await page.evaluate(()=>{
    window.mountFonts=()=>window.skinPlugin.installSkinFontLibrary({effect(run){window.disposeFonts=run()}})
    window.mountFonts()
  })
  const source=await readFile(new URL('../tavern-plugin/src/client/fonts.js',import.meta.url),'utf8')
  await page.addScriptTag({content:'const BUILTIN_STAGE_SKINS = {};\n'+source+'\nwindow.disposeFontConsumer=installForkFonts({on(){return ()=>{}},theme:{getTheme(){return {active:{}}}}});'})
  await page.evaluate(async()=>{
    await window.tavernFonts.list()
    window.tavernFonts.setOverride('reading','example')
    window.tavernFonts.setOverride('stage','example')
    await window.dshSkinFonts.ensure('example')
  })
  assert.equal(calls.filter(row=>row.method==='listFonts').length,1)
  assert.match(await page.locator('style[data-dsh-skin-fonts]').textContent(),/font-family:"Example"/)
  assert.equal(await page.evaluate(()=>window.tavernFonts.resolve('stage').id),'example')
  await page.evaluate(()=>window.disposeFonts())
  await page.waitForFunction(()=>window.tavernFonts.resolve('reading').source==='fallback')
  assert.equal(await page.locator('style[data-dsh-skin-fonts]').count(),0)
  assert.equal(await page.locator('style[data-dsh-skin-font-picker]').count(),0)
  assert.equal(await page.evaluate(()=>localStorage.getItem('dsh-tavern-font-reading')),'example')
  await page.evaluate(()=>window.mountFonts())
  await page.waitForFunction(()=>window.tavernFonts.resolve('reading').id==='example')
  assert.equal(await page.evaluate(()=>window.tavernFonts.resolve('stage').id),'example')
  await page.evaluate(()=>{window.disposeFontConsumer();window.disposeFonts();window.disposeSkin()})
})

test('font catalog completing after plugin disposal cannot create font styles',async t=>{
  let done
  const pending=new Promise(resolve=>{done=resolve})
  const {page}=await openInterfaceSkins(t,{respond:method=>method==='listFonts'?pending:method==='getActiveInterfaceSkin'?{css:''}:{skins:[],active:null}})
  await page.evaluate(()=>{
    window.skinPlugin.installSkinFontLibrary({effect(run){window.disposeFonts=run()}})
    window.ensureFont=window.dshSkinFonts.ensure('example').catch(()=>null)
  })
  await page.evaluate(()=>window.disposeFonts())
  done({fonts:[font]})
  await page.evaluate(()=>window.ensureFont)
  assert.equal(await page.locator('style[data-dsh-skin-fonts]').count(),0)
  assert.equal(await page.evaluate(()=>Boolean(window.dshSkinFonts)),false)
})
