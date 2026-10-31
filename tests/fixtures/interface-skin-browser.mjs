import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './browser-react.mjs'

// Load the actual skin plugin bundle without Tavern's client or server.
export async function openInterfaceSkins(t, {respond, beforeRender} = {}) {
  const browser = await chromium.launch({headless:true})
  t.after(() => browser.close())
  const page = await browser.newPage(), calls = [], errors = []
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://tavern.test/**', async route => {
    if (!route.request().url().endsWith('/dream-skin/api')) return route.fulfill({contentType:'text/html',body:'<main></main>'})
    const {method,args} = route.request().postDataJSON();calls.push({method,args})
    try { await route.fulfill({json:{ok:true,value:await respond(method,args)}}) }
    catch(error) { await route.fulfill({status:400,json:{ok:false,error:{message:error.message}}}) }
  })
  await page.goto('http://tavern.test/')
  if (beforeRender) await page.evaluate(beforeRender)
  await page.addScriptTag({content:await browserReactScript()})
  await page.evaluate(() => {
    window.__ModuleLoader__ = {load(definition) {
      window.skinPlugin = definition.factory(name => {
        if (name === 'react') return modules.react
        if (name === 'react/jsx-runtime') return {jsx:modules.react.createElement,jsxs:modules.react.createElement}
        return {defineStore:() => () => ({})}
      })
    }}
  })
  await page.addScriptTag({content:await readFile(new URL('../../tavern-plugin/packages/dsh-dream-skin/lib/client.js',import.meta.url),'utf8')})
  await page.evaluate(() => {
    let Settings
    window.skinPlugin.installInterfaceSkinSettings({
      effect(run) {window.disposeSkin = run()},
      slots:{inject(name,run){return run()},register(spec,Component){Settings=Component;return ()=>{}}}
    },modules.react,window.dshDreamSkin)
    window.skinRoot=modules['react-dom/client'].createRoot(document.querySelector('main'))
    window.skinRoot.render(modules.react.createElement(Settings))
  })
  t.after(() => {if(errors.length) throw Error(errors.join('\n'))})
  return {page,calls}
}
