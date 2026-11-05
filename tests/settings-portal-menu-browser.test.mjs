// A menu floated out of a settings dialog (a portal into <body>) whose items load after it opens is placed again as soon as
// they arrive, so it never moves out from under the pointer on the first scroll: a click on an item picks it, the dialog
// stays open and the value is saved. Reproduced in 设置 › 酒馆插件 › 朗读声音, where a pick used to land on the host
// dialog's backdrop and close the whole settings window without saving.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {sourceFunction} from './fixtures/source-function.mjs'
const read=file=>readFile(new URL('../tavern-plugin/'+file,import.meta.url),'utf8')

async function setup(t){
  const [widgets,ui,voice]=await Promise.all([read('src/client/asset-pack-widgets.js'),read('src/client/asset-pack-ui.js'),read('src/client/asset-pack-voice-ui.js')])
  const source=[await read('src/client/inline-field.js'),await read('src/client/browser-speech.cjs'),await read('src/client/voice-catalogue-picker.js'),
    sourceFunction(widgets,'Popover'),sourceFunction(widgets,'popoverPlace'),sourceFunction(ui,'canPortal'),sourceFunction(ui,'TopLayer'),sourceFunction(voice,'useVoiceLoad'),
    await read('src/client/modules/global-settings.js')].join('\n')
  const browser=await chromium.launch({headless:true,args:['--mute-audio']});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<!doctype html><html lang="zh-CN"><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({content:await browserReactScript()})
  await page.addStyleTag({content:await read('lib/client-assets/theme.css')})
  await page.addScriptTag({content:`const React=modules.react,ReactDOM=modules['react-dom'],h=React.createElement;
    const previewWait=work=>work,voiceErrorText=e=>String(e?.message||e),voiceNeedle=q=>q,voiceMatches=(needle,words)=>!needle||words.some(w=>w&&w.includes(needle));
    const Glyph=()=>null,Spinner=()=>h('span',null,'…'),
      PackSearchBox=({label,value,onChange})=>h('input',{type:'search','aria-label':label,value,onChange:e=>onChange(e.target.value)});
    ${source}
    const writes=[];window.writes=writes;
    let reading={voice:null,auto:true};
    const later=(ms,value)=>new Promise(resolve=>setTimeout(()=>resolve(value),ms));
    // the voice list arrives after the menu has opened behind its spinner, long enough to fill it.
    const presets=[...Array.from({length:40},(_,i)=>({voiceId:'v'+i,name:'声音'+i})),{voiceId:'Qianxue',name:'千雪'},{voiceId:'Cherry',name:'芊悦'}];
    const binding={service:{listVoiceCatalogue:async()=>({voices:[]})},tts:{available:()=>true,subscribe:()=>()=>{},call:async(method,args)=>{
      if(method==='voiceServices')return {services:[{id:'qwen-main',kind:'qwen',label:'通义千问',voiceList:'preset',state:'ready'}]};
      if(method==='listOnlinePresetVoices')return later(600,{voices:presets});
      if(method==='reading')return {readAloud:reading};
      if(method==='setReading'){writes.push(args);reading={...reading,...args.readAloud};return {readAloud:reading};}
      throw new Error('unexpected '+method);
    }}};
    const {TavernPluginsSettingsSection}=createGlobalSettingsModule({React,useReadingBinding:()=>binding,VoiceCataloguePicker,voiceKey,voiceFromKey,
      TavernUserPluginsSettings:()=>null,TavernSettingRow:({title,children})=>h('div',{style:{display:'flex',justifyContent:'space-between'}},title,children),
      Switch:({label,checked,onChange})=>h('button',{'aria-label':label,onClick:()=>onChange(!checked)},label)});
    // a second picker on the shared floating Popover: its items load after opening too and the pick saves the reading.
    function LazyMenu(){
      const [items,setItems]=React.useState(null),[value,setValue]=React.useState('off');
      return h(Popover,{label:'朗读设置菜单',fit:true,limit:360,content:close=>items?items.map(o=>h('button',{key:o,type:'button',role:'menuitemradio','aria-checked':o===value,className:'ap-menu-item',
          onClick:()=>{close();setValue(o);binding.tts.call('setReading',{readAloud:{auto:o==='on'}});}},o)):[h('span',{key:'wait'},'…')],
        trigger:({open,toggle})=>h('button',{type:'button','aria-label':'朗读设置菜单：'+value,'aria-expanded':open,onClick:()=>{toggle();if(!items)later(600,[...Array.from({length:40},(_,i)=>'选项'+i),'on']).then(setItems);}},value)});
    }
    // the host's settings dialog: a backdrop that closes it on click, the page scrolling inside, its last group low on the screen.
    function HostSettings(){
      const [open,setOpen]=React.useState(true);
      return open?h('div',{style:{position:'fixed',inset:0,zIndex:1000,display:'flex',justifyContent:'center',alignItems:'center'}},
        h('div',{style:{position:'absolute',inset:0,background:'rgba(0,0,0,.4)'},onClick:()=>setOpen(false)}),
        h('div',{role:'dialog','aria-modal':'true','aria-label':'设置',style:{position:'relative',width:'800px',height:'800px',overflow:'auto',background:'#222',color:'#eee'}},
          h('div',{style:{height:'560px'}}),h(TavernPluginsSettingsSection),h('div',{style:{display:'flex',justifyContent:'flex-end'}},h(LazyMenu)))):null;
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
  await page.locator('button[aria-label^="朗读声音："]').waitFor({timeout:10000}).catch(async error=>{t.diagnostic(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error})
  // 设置 › 酒馆插件 › 朗读声音
  await pick(page,'button[aria-label^="朗读声音："]','千雪')
  await page.locator('button[aria-label="朗读声音：通义千问 · 千雪"]').waitFor()
  assert.equal(await dialog.count(),1,'the settings dialog stays open')
  assert.deepEqual(await page.evaluate(()=>writes),[{readAloud:{voice:{serviceId:'qwen-main',voice:'Qianxue'}}}])
  // another floating picker in the same dialog
  await pick(page,'button[aria-label^="朗读设置菜单："]','on')
  await page.locator('button[aria-label="朗读设置菜单：on"]').waitFor()
  assert.equal(await dialog.count(),1,'the settings dialog stays open')
  assert.deepEqual((await page.evaluate(()=>writes)).at(-1),{readAloud:{auto:true}})
  assert.deepEqual(errors,[])
})
