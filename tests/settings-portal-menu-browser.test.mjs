// A menu floated out of a settings dialog (a portal into <body>) whose items load after it opens is placed again as soon as
// they arrive, so it never moves out from under the pointer on the first scroll: a click on an item picks it, the dialog
// stays open and the value is saved. Found on a settings page picker, where a pick used to land on the host dialog's
// backdrop and close the whole settings window without saving.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {sourceFunction} from './fixtures/source-function.mjs'
const read=file=>readFile(new URL('../tavern-plugin/'+file,import.meta.url),'utf8')

async function setup(t){
  const [widgets,ui]=await Promise.all([read('src/client/asset-pack-widgets.js'),read('src/client/asset-pack-ui.js')])
  const source=[await read('src/client/inline-field.js'),sourceFunction(widgets,'Popover'),sourceFunction(widgets,'popoverPlace'),sourceFunction(ui,'canPortal'),sourceFunction(ui,'TopLayer')].join('\n')
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><html lang="zh-CN"><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({content:await browserReactScript()})
  await page.addStyleTag({content:await read('lib/client-assets/theme.css')})
  await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom'],h=React.createElement;
    const Glyph=()=>null;
    ${source}
    const writes=[];window.writes=writes;
    const later=(ms,value)=>new Promise(resolve=>setTimeout(()=>resolve(value),ms));
    // a picker on the shared floating Popover: its items arrive after it has opened, long enough to fill it; a pick saves.
    function LazyMenu(){
      const [items,setItems]=React.useState(null),[value,setValue]=React.useState('off');
      return h(Popover,{label:'设置菜单',fit:true,limit:360,content:close=>items?items.map(o=>h('button',{key:o,type:'button',role:'menuitemradio','aria-checked':o===value,className:'ap-menu-item',
          onClick:()=>{close();setValue(o);writes.push(o);}},o)):[h('span',{key:'wait'},'…')],
        trigger:({open,toggle})=>h('button',{type:'button','aria-label':'设置菜单：'+value,'aria-expanded':open,onClick:()=>{toggle();if(!items)later(600,[...Array.from({length:40},(_,i)=>'选项'+i),'on']).then(setItems);}},value)});
    }
    // the host's settings dialog: a backdrop that closes it on click, the page scrolling inside, its last group low on the screen.
    function HostSettings(){
      const [open,setOpen]=React.useState(true);
      return open?h('div',{style:{position:'fixed',inset:0,zIndex:1000,display:'flex',justifyContent:'center',alignItems:'center'}},
        h('div',{style:{position:'absolute',inset:0,background:'rgba(0,0,0,.4)'},onClick:()=>setOpen(false)}),
        h('div',{role:'dialog','aria-modal':'true','aria-label':'设置',style:{position:'relative',width:'800px',height:'800px',overflow:'auto',background:'#222',color:'#eee'}},
          h('div',{style:{height:'680px'}}),h('div',{style:{display:'flex',justifyContent:'flex-end'}},h(LazyMenu)))):null;
    }
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(h(HostSettings));`})
  return {page,errors}
}

// as a player does: open the menu, wait for the item, scroll it into view, rest the pointer on it and click there.
async function pick(page,trigger,item){
  await page.locator(trigger).click()
  const target=page.locator('[role=menuitemradio] >> text='+item)
  await target.waitFor()
  await page.waitForTimeout(300)
  const menu=page.locator('.ap-popover.is-floating'),before=await menu.boundingBox()
  assert.ok(before.y>=0&&before.y+before.height<=1080,'the loaded menu is inside the window: '+JSON.stringify(before))
  await (await target.elementHandle()).scrollIntoViewIfNeeded()
  const box=await target.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2}
  await page.mouse.move(point.x,point.y,{steps:4});await page.waitForTimeout(400)
  assert.deepEqual(await menu.boundingBox(),before,'scrolling the list does not move the menu')
  await page.mouse.click(point.x,point.y)
}

test('a lazily filled menu floated out of the settings dialog picks under the pointer and keeps the dialog open',async t=>{
  const {page,errors}=await setup(t)
  const dialog=page.getByRole('dialog',{name:'设置'})
  await pick(page,'button[aria-label^="设置菜单："]','on')
  await page.locator('button[aria-label="设置菜单：on"]').waitFor()
  assert.equal(await dialog.count(),1,'the settings dialog stays open')
  assert.deepEqual(await page.evaluate(()=>writes),['on'])
  assert.deepEqual(errors,[])
})
