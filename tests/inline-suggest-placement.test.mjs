import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {browserReactScript} from './fixtures/browser-react.mjs'
// The 触发词 / 标签 suggestion list sits against its input: under it, or above it when the window has no room below,
// and stays there when the list shrinks while typing (it used to keep the placement measured for the long list).
test('chip suggestions stay against the input after the list shrinks while typing',async()=>{
  const {chromium}=await import('playwright')
  const browser=await chromium.launch({channel:'chrome',headless:true})
  try{
    for(const viewport of [{width:1100,height:700},{width:375,height:640}]){
      const page=await browser.newPage({viewport}),errors=[]
      page.on('pageerror',e=>errors.push(e.message))
      await page.setContent('<html><body style="margin:0"><div id="root"></div></body></html>')
      await page.addStyleTag({content:await readFile(new URL('../tavern-plugin/lib/client-assets/theme.css',import.meta.url),'utf8')})
      const inline=await readFile(new URL('../tavern-plugin/src/client/inline-field.js',import.meta.url),'utf8')
      await page.addScriptTag({content:await browserReactScript()+';window.React=modules.react;window.ReactDOM={...modules["react-dom"],...modules["react-dom/client"]};'+inline+';window.InlineField=InlineField;window.InlineGrid=InlineGrid;'})
      await page.evaluate(()=>{
        const names=Array.from({length:40},(_,i)=>'条目'+i).concat(['总部大堂'])
        const App=()=>{const [v,setV]=React.useState([]);return React.createElement('div',{className:'ap-ui',style:{height:'100vh',overflow:'clip'}},React.createElement('div',{style:{height:'calc(100vh - 110px)'}}),React.createElement(InlineGrid,{label:'设置',columns:1},React.createElement(InlineField,{kind:'chips',label:'触发词',value:v,suggest:names,onCommit:setV})),React.createElement('div',{style:{height:'60px'}}))}
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App))
      })
      const input=page.getByRole('combobox')
      await input.scrollIntoViewIfNeeded();await input.focus()
      const gap=async()=>page.evaluate(()=>{const i=document.querySelector('[role=combobox]').getBoundingClientRect(),p=document.querySelector('.fork-chip-suggest').getBoundingClientRect();return Math.min(Math.abs(p.top-i.bottom),Math.abs(i.top-p.bottom))})
      await page.waitForSelector('.fork-chip-suggest')
      assert.ok(await gap()<=12,'list opened against the input '+JSON.stringify(viewport)+' gap '+await gap())
      await input.fill('总部');await page.waitForTimeout(200)
      assert.ok(await gap()<=12,'shrunken list still against the input, gap '+await gap())
      assert.deepEqual(errors,[]);await page.close()
    }
  }finally{await browser.close()}
})
