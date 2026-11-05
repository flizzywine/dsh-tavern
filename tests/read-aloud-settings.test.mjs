import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
const source = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js',import.meta.url),'utf8')

test('reading settings write only the independent selection and auto flag', async t => {
  const browser = await chromium.launch({headless:true,args:['--mute-audio']})
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.on('pageerror',error => assert.fail(error.message))
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({content:await browserReactScript()})
  await page.addScriptTag({content:`
    const React=modules.react,h=React.createElement,calls=[];
    let reading={voice:null,auto:false};
    const binding={tts:{available:()=>true,subscribe:()=>()=>{},call:async(method,args)=>{
      if(method==='setReading'){calls.push(args);reading={...reading,...args.readAloud};}return {readAloud:reading};
    }}};
    ${source}
    const {TavernPluginsSettingsSection}=createGlobalSettingsModule({React,
      useReadingBinding:()=>binding,voiceKey:JSON.stringify,voiceFromKey:JSON.parse,
      TavernUserPluginsSettings:()=>null,TavernSettingRow:({title,children})=>h('div',null,title,children),
      Switch:({label,checked,onChange})=>h('button',{'aria-label':label,onClick:()=>onChange(!checked)},label),
      VoiceCataloguePicker:props=>{window.leading=props.leading;return h('div',null,
        ...[{browser:'Reader'},{serviceId:'cloud',voice:'reader'}].map((voice,i)=>h('button',{key:i,onClick:()=>props.onPick(JSON.stringify(voice))},'voice-'+i)));}
    });
    window.calls=calls;
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(h(TavernPluginsSettingsSection));
  `})
  await page.getByRole('button',{name:'voice-0'}).click()
  await page.getByRole('button',{name:'voice-1'}).click()
  await page.getByRole('button',{name:'自动朗读'}).click()
  assert.deepEqual(await page.evaluate(()=>calls),[{readAloud:{voice:{browser:'Reader'}}},{readAloud:{voice:{serviceId:'cloud',voice:'reader'}}},{readAloud:{auto:true}}])
  assert.deepEqual(await page.evaluate(()=>leading),[{value:'',label:'浏览器 · 系统默认'}])
})
