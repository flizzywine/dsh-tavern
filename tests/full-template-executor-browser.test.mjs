import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('global settings need no game and local commands remain session-bound', {skip:!process.env.TAVERN_BROWSER_TESTS}, async()=>{
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({headless:true})
  try {
    const page=await browser.newPage()
    const source=await readFile(new URL('../tavern-plugin/src/client/full-template-executor.js',import.meta.url),'utf8')
    const css=await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css',import.meta.url),'utf8')
    await page.setContent('<!doctype html><body></body>')
    await page.addStyleTag({content:css + '\nbody { color-scheme: light; --dsw-alias-bg-base: #eee8; --dsw-specific-sidebar-fill: #ddd8; }'})
    await page.addScriptTag({content:'function isPlayMode(){return true}\n'+source})
    await page.evaluate(()=>{
      window.calls=[]
      window.invoke=async(method,args,id)=>{
        calls.push({method,args,id})
        if(method==='getGlobalPromptTemplateSettings')return {settings:{enabled:false,render_enabled:true,custom:'preserved'}}
        if(method==='saveGlobalPromptTemplateSettings')return {updated:true,settings:args.settings}
        if(method==='executeFullTemplateCommand')return {pipe:'0'}
        throw Error('Unexpected game access: '+method)
      }
      window.globalPanel=createServerTemplatePanel({window,rpc:invoke,globalSettings:true})
      globalPanel.open()
    })
    assert.equal(await page.getByLabel('启用提示词模板').isChecked(),false)
    const globalDialog=page.getByRole('dialog',{name:'提示词模板设置'})
    const lightBackground=await globalDialog.evaluate(node=>getComputedStyle(node).backgroundColor)
    assert.match(lightBackground,/^rgb\(/,'半透明皮肤下仍有不透明底色')
    await page.evaluate(()=>document.body.style.colorScheme='dark')
    const darkBackground=await globalDialog.evaluate(node=>getComputedStyle(node).backgroundColor)
    assert.match(darkBackground,/^rgb\(/)
    assert.notEqual(darkBackground,lightBackground)
    assert.equal(await page.getByLabel('模板命令',{exact:true}).count(),0)
    assert.equal(await page.getByLabel('世界书条目',{exact:true}).count(),0)
    await page.getByLabel('启用提示词模板').check()
    await page.getByRole('button',{name:'保存设置'}).click()
    await page.getByRole('status').filter({hasText:'已保存'}).waitFor()
    const saved=await page.evaluate(()=>calls.find(c=>c.method==='saveGlobalPromptTemplateSettings'))
    assert.equal(saved.id,undefined)
    assert.equal(saved.args.settings.enabled,true)
    assert.equal(saved.args.settings.custom,'preserved')
    assert.equal(saved.args.expectedSettings.enabled,false)
    await page.getByRole('button',{name:'关闭',exact:true}).click()
    await page.evaluate(()=>{
      window.panel=createServerTemplatePanel({window,rpc:invoke})
      panel.sync('s',{chatId:'c'})
      window.dispatchEvent(new CustomEvent('dsh-template-settings',{detail:{sessionId:'wrong'}}))
    })
    assert.equal(await page.locator('dialog').count(),0)
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('dsh-template-settings',{detail:{sessionId:'s'}})))
    assert.equal(await page.getByLabel('启用提示词模板').count(),0)
    await page.getByLabel('模板命令',{exact:true}).fill('/ejs <%= 1+1 %>')
    await page.getByRole('button',{name:'执行模板命令'}).click()
    await page.getByRole('status').filter({hasText:'0'}).waitFor()
    assert.equal(await page.evaluate(()=>calls.find(c=>c.method==='executeFullTemplateCommand').id),'s')
    assert.equal(await page.locator('iframe').count(),0)
    await page.evaluate(()=>panel.sync('other',{chatId:'other'}))
    assert.equal(await page.locator('dialog').count(),0)
  } finally {await browser.close()}
})
