import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {browserReactScript} from './fixtures/browser-react.mjs'
// An empty hideEmpty menu (人物卡详情 › 剧本 while unbound) is the first dashed 「＋ 剧本」 chip in the grid's add line, ahead of the
// text fields' chips; the chip opens the menu's own list, a pick turns it into the 「剧本 名字 ▾」 row, and that row's 未绑定
// turns it back into the chip.
test('an empty hideEmpty menu is a dashed chip that opens its own list',async()=>{
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try{
    for(const viewport of [{width:1280,height:720},{width:375,height:700}]){
      const page=await browser.newPage({viewport}),errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.setContent('<html><body style="margin:0"><div id="root"></div></body></html>')
      await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/theme.css',import.meta.url),'utf8')})
      const inline=await readFile(new URL('../tavern-plugin/src/client/inline-field.js',import.meta.url),'utf8')
      await page.addScriptTag({content:await browserReactScript()+';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};'+inline+';window.InlineField=InlineField;window.InlineGrid=InlineGrid;'})
      await page.evaluate(()=>{
        const h=React.createElement
        const App=()=>{
          const [v,setV]=React.useState('')
          const options=(v?[{value:'',label:'未绑定'}]:[]).concat([{value:'a',label:'剧本甲'},{value:'b',label:'剧本乙'}])
          const script=h(InlineField,{key:'script',kind:'menu',label:'剧本',value:v,options,hideEmpty:true,wide:true,onCommit:setV,trail:h('input',{type:'file',hidden:true,className:'script-file'})})
          const text=[h(InlineField,{key:'d',kind:'text',label:'角色描述',value:'',hideEmpty:true,onCommit:()=>{}}),h(InlineField,{key:'p',kind:'text',label:'性格',value:'',hideEmpty:true,onCommit:()=>{}})]
          return h('div',{className:'ap-ui'},h(InlineGrid,{label:'基本信息',columns:1},v?text.concat([script]):[script].concat(text)))
        }
        ReactDOM.createRoot(document.getElementById('root')).render(h(App))
      })
      const chips=()=>page.$$eval('.fork-inline-adds button.fork-inline-add-field',nodes=>nodes.map(n=>n.textContent))
      assert.deepEqual(await chips(),['剧本','角色描述','性格'])
      assert.equal(await page.locator('.fork-inline-trigger').count(),0,'no 「剧本 未绑定 ▾」 row while unbound')
      assert.equal(await page.locator('input.script-file').count(),1,'the trail (剧本 import input) stays mounted beside the chip')
      const chip=page.getByRole('button',{name:'添加剧本'})
      assert.equal(await chip.getAttribute('aria-haspopup'),'menu')
      const box=await chip.boundingBox();assert.ok(box.height>=26,'chip height '+box.height)
      await chip.click()
      await page.waitForSelector('.fork-inline-pop[role=menu]')
      assert.deepEqual(await page.$$eval('.fork-inline-pop [role=menuitemradio]',n=>n.map(x=>x.textContent)),['剧本甲','剧本乙'])
      await page.keyboard.press('Escape')
      await page.waitForSelector('.fork-inline-pop',{state:'detached'})
      assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'添加剧本','Esc returns to the chip')
      await page.keyboard.press('Enter')
      await page.getByRole('menuitemradio',{name:'剧本乙'}).click()
      await page.waitForSelector('.fork-inline-trigger')
      assert.deepEqual(await chips(),['角色描述','性格'])
      assert.equal(await page.locator('.fork-inline-trigger').getAttribute('aria-label'),'剧本：剧本乙')
      await page.locator('.fork-inline-trigger').click()
      await page.getByRole('menuitemradio',{name:'未绑定'}).click()
      await page.waitForSelector('.fork-inline-trigger',{state:'detached'})
      assert.deepEqual(await chips(),['剧本','角色描述','性格'])
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no sideways scroll')
      assert.deepEqual(errors,[]);await page.close()
    }
  }finally{await browser.close()}
})
