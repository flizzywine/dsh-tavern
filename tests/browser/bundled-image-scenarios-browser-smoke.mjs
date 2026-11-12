import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parse} from 'acorn'
import {chromium} from 'playwright'
import {browserReactScript} from '../fixtures/browser-react.mjs'
import {DEFAULT_MODULAR_TEMPLATE} from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-presets.js'
import {normalizePromptEntries} from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-entries.js'
import {normalizePromptStructure} from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/prompt-structure.js'
import {listTemplateModules} from '../../tavern-plugin/packages/dsh-tavern-image-bundled/lib/template-modules.js'
const source=await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-image-bundled/client.js',import.meta.url),'utf8')
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==','base64')
const clone=value=>JSON.parse(JSON.stringify(value))
const state={config:{promptSystem:'worldbook',imageEnabled:true,imageBackend:'openai',activeImageChannel:'test',imageDisplayPosition:'inline',imageDisplayWidth:0,promptDefaultEditable:true,promptWorkbench:true,promptWorkbenchDraw:true,promptDefault:clone(DEFAULT_MODULAR_TEMPLATE),promptPresets:[],promptEntries:[],promptEntryLimit:1000,promptPresetLimit:200,promptRevision:'1',promptModuleTypes:listTemplateModules(),imageChannels:[{id:'test',provider:'openai',name:'本地验证',model:'test',options:{}}]},definitions:{revision:'1',characters:[],outfits:[]},outfits:[],workflows:[],tasks:[],imageProviders:[{id:'openai',label:'OpenAI 兼容'}],worldbookFormat:'natural',worldbookBooks:[]}
const patches=[],errors=[]
const executablePath=[process.env.DSH_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path=>path&&existsSync(path))||chromium.executablePath()
const browser=await chromium.launch({headless:true,executablePath})
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(6000)
 page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url()),path=u.pathname.replace('/plugins/dsh-tavern-image',''),method=route.request().method()
  if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><div id="root" style="width:880px;padding:20px"></div><div id="host" style="width:880px;padding:20px"></div>'})
  if(u.pathname==='/sample.png')return route.fulfill({contentType:'image/png',body:png})
  let response={ok:true}
  if(path==='/state')response=clone(state)
  else if(path==='/config'){
   const patch=route.request().postDataJSON().config;patches.push(clone(patch));Object.assign(state.config,patch)
   if(patch.promptDefault)state.config.promptDefault={...patch.promptDefault,structure:normalizePromptStructure(patch.promptDefault.structure)}
   if(patch.promptEntries)state.config.promptEntries=normalizePromptEntries(patch.promptEntries)
   state.config.promptRevision=String(Number(state.config.promptRevision)+1);response={ok:true,state:clone(state)}
  }else if(path==='/history')response={ok:true,jobs:[]}
  else if(path==='/tasks')response={tasks:[]}
  else if(u.pathname.endsWith('/tools-enabled'))response={ok:true,enabled:false}
  else if(path==='/worldbook')response={ok:true,worldbookFormat:'natural',worldbookBooks:[]}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(response)})
 })
 await page.goto('http://image-scenarios.test/')
 await page.addScriptTag({content:await browserReactScript()})
 await page.addScriptTag({content:'window.__ModuleLoader__={load(spec){window.__plugin=spec.factory(name=>modules[name])}};'})
 await page.addScriptTag({content:source})
 await page.evaluate(()=>{
  let Settings,Placement
  window.__plugin.apply({slots:{inject(name,install){return install()},register(spec,component){if(spec.name==='settings.section')Settings=component;if(spec.id==='dsh-tavern-image-placement')Placement=component;return()=>{}}},inject(){}})
  const h=modules.react.createElement;modules['react-dom/client'].createRoot(document.querySelector('#root')).render(h(modules.react.Fragment,null,h(Settings),h(Placement)))
 })
 await page.getByLabel('生图系统模式',{exact:true}).waitFor()
 assert.equal(await page.getByLabel('生图系统模式',{exact:true}).inputValue(),'worldbook')
 assert.equal(await page.getByRole('button',{name:'生图工作台',exact:true}).count(),0)
 await page.locator('summary').filter({hasText:'生图位置和大小'}).click()
 await page.getByLabel('生图显示位置').selectOption('floating')
 await page.evaluate(()=>{const row=document.createElement('article');row.setAttribute('data-chat-turn','1');row.innerHTML='<figure class="dsh-tavern-illustration" data-kind="dsh-tavern-image/image"><img src="/sample.png" alt="宽度验证"></figure>';document.body.append(row)})
 const placement=page.getByLabel('正文图片查看器',{exact:true});await placement.waitFor()
 await page.getByLabel('正文图片显示宽度（像素）',{exact:true}).fill('520')
 await page.waitForFunction(()=>Math.round(document.querySelector('[data-dti-placement]').getBoundingClientRect().width)===520)
 await page.getByLabel('悬浮图片宽度',{exact:true}).fill('360')
 await page.waitForFunction(()=>Math.round(document.querySelector('[data-dti-placement]').getBoundingClientRect().width)===360)
 await placement.getByRole('button',{name:'保存大小',exact:true}).click()
 await placement.getByText('已保存',{exact:true}).waitFor()
 assert.equal(state.config.imageDisplayWidth,360)
 await page.waitForFunction(()=>document.querySelector('[aria-label="正文图片显示宽度（像素）"]').value==='360')
 await page.getByLabel('生图显示位置').selectOption('inline')
 await page.getByLabel('生图系统模式',{exact:true}).selectOption('workbench')
 await page.getByRole('button',{name:'保存工作台',exact:true}).waitFor()
 await page.getByLabel('场景模式设置',{exact:true}).locator('summary').first().click()
 await page.getByLabel('启用场景模式',{exact:true}).check()
 await page.getByLabel('场景判断方式',{exact:true}).selectOption('model')
 const style=page.locator('[data-prompt-block="画风"]');await style.locator('summary').first().click()
 await style.getByLabel('NSFW',{exact:true}).check()
 await page.getByRole('button',{name:'保存工作台',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent!=='保存中…')
 assert.equal(state.config.promptDefault.structure.scenarios.policy,'model')
 assert.deepEqual(state.config.promptDefault.structure.blocks.find(b=>b.title==='画风').modes,['nsfw'])
 await page.getByRole('button',{name:'设置',exact:true}).click()
 await page.getByRole('button',{name:'生图工作台',exact:true}).click()
 await page.getByLabel('场景模式设置',{exact:true}).locator('summary').first().click()
 assert.equal(await page.getByLabel('场景判断方式',{exact:true}).inputValue(),'model')
 // Entry catalogue adds real records and keeps tag-chain options editable.
 await page.getByRole('button',{name:'资料库',exact:true}).click()
 const library=page.getByLabel('生图词条库',{exact:true});await library.locator('summary').first().click()
 await page.getByRole('button',{name:'添加内置词条',exact:true}).click()
 await page.getByText('已添加 64 条，可继续编辑触发词和内容',{exact:true}).waitFor()
 assert.equal(state.config.promptEntries.length,64)
 await library.getByRole('button',{name:'特写',exact:false}).first().click()
 await page.getByLabel('词条内容写法',{exact:true}).selectOption('tags')
 await page.getByLabel('词条命中后用途',{exact:true}).selectOption('positive')
 await page.getByLabel('视觉资料',{exact:true}).fill('cinematic lighting, rim light, depth of field')
 await page.getByRole('button',{name:'保存词条',exact:true}).click()
 await page.getByText('词条已保存',{exact:true}).waitFor()
 assert.equal(state.config.promptEntries[0].injection,'positive')
 assert.equal(state.config.promptEntries[0].content,'cinematic lighting, rim light, depth of field')
 // Render the actual host component to check one row and dispatch of its extension action.
 const extensions=await readFile(new URL('../../tavern-plugin/src/client/features/plugin-extensions.js',import.meta.url),'utf8')
 let node
 const visit=n=>{if(!n||node)return;if(n.type==='FunctionDeclaration'&&n.id?.name==='TavernIllustrationCard'){node=n;return}for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'&&v.type)visit(v)}};visit(parse(extensions,{ecmaVersion:'latest'}));assert.ok(node)
 const css=await readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css',import.meta.url),'utf8')
 await page.addStyleTag({content:css})
 await page.addScriptTag({content:`(()=>{const React=modules.react;const useTavernConfirm=()=>async()=>true,tavernPluginMediaUrl=()=>'/sample.png',openSceneImagePreview=()=>{},rpc=async()=>{},TextArea=()=>null;window.actionCalls=[];${extensions.slice(node.start,node.end)};modules['react-dom/client'].createRoot(document.querySelector('#host')).render(React.createElement(TavernIllustrationCard,{sessionId:'test',turn:1,item:{id:'picture',kind:'dsh-tavern-image/image',attachment:{},caption:'操作栏验证',prompt:'A room',status:'ready',actions:[{id:'image-edit',label:'改图'}]},illustrator:{redraw:async()=>{},editPrompt:async()=>{},action:async r=>window.actionCalls.push(r)}}));})()`})
 const toolbar=page.locator('#host .dsh-tavern-image-actions');await toolbar.waitFor()
 assert.equal(await toolbar.count(),1)
 const boxes=await toolbar.locator('button').evaluateAll(buttons=>buttons.map(b=>({top:b.getBoundingClientRect().top,text:b.textContent})))
 assert.equal(new Set(boxes.map(b=>b.top)).size,1,JSON.stringify(boxes))
 await toolbar.getByRole('button',{name:'改图',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.actionCalls[0].actionId),'image-edit')
 await page.locator('#host').screenshot({path:process.env.DSH_TOOLBAR_SCREENSHOT||join(tmpdir(),'dsh-image-actions-row.png')})
 await page.setViewportSize({width:390,height:844})
 await page.evaluate(()=>document.querySelector('#host').style.width='350px')
 const narrow=await toolbar.locator('button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().top))
 assert.equal(new Set(narrow).size,1)
 assert.deepEqual(errors,[])
 console.log('PASS: default worldbook, floating live resize/save, scenario save/reload, 64 tag entries, single-row native image actions at desktop/mobile widths')
}finally{await browser.close()}
