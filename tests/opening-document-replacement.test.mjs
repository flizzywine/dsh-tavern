import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import vm from './fixtures/client-vm.mjs' // foreground document fixture
import test from 'node:test'
import {chromium} from 'playwright'
import {readTavernRuntimeAsset} from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'

for (const afterComposer of [false, true]) test('远程开局重写到 head 阶段时，MVU 和输入层恢复且能保存角色：afterComposer=' + afterComposer, async t => {
  let descriptor
  vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:d=>descriptor=d}},console})
  const client=descriptor.factory(()=>({}))
  let unblockBundle
  const replacementStarted=new Promise(resolve=>{unblockBundle=resolve})
  const context={messages:[{message_id:0,role:'assistant',message:'opening',variables:{stat_data:{}}}]}
  const html=client.buildTavernFrameDocument({token:'replacement',trustedCardMode:true,
    content:`<script>(async()=>{${afterComposer ? 'while(!document.getElementById("send_textarea"))await new Promise(r=>setTimeout(r,5));' : ''}const html=await fetch('/wizard').then(r=>r.text());document.open();document.write(html);document.close()})()</script>`,
    openingPreview:{swipes:['opening'],openingIds:['primary'],selectedIndex:0,preparationId:'test',runtime:{context,scripts:[
      {id:'__dsh_official_mvu__',system:'official-mvu',assetUrl:'/mvu.js'}
    ]}}})
  const bundle=`window.openingRuntimeStarts=(window.openingRuntimeStarts||0)+1;window.initializeGlobal('Mvu',{getMvuData:()=>({stat_data:{}}),replaceMvuData:async data=>{window.savedCharacter=data.stat_data.name}});`
  const server=createServer(async(req,res)=>{
    const p=new URL(req.url,'http://localhost').pathname
    if(p==='/frame'){res.setHeader('content-type','text/html');res.end(html);return}
    if(p==='/wizard'){res.setHeader('content-type','text/html');res.end('<!doctype html><head><script src="/parser-wait.js"></script></head><body><button onclick="saveCharacter()">保存角色</button><script>async function saveCharacter(){const m=parent.Mvu;if(!m)return alert("MVU系统不可用，无法保存角色数据");const d=m.getMvuData({type:"message",message_id:"latest"});d.stat_data.name="开局角色";await m.replaceMvuData(d,{type:"message",message_id:"latest"});document.querySelector("button").textContent="已保存"}</script></body>');return}
    if(p==='/parser-wait.js'){unblockBundle();await new Promise(r=>setTimeout(r,200));res.setHeader('content-type','text/javascript');res.end('');return}
    if(p==='/mvu.js'){await replacementStarted;res.setHeader('content-type','text/javascript');res.end(bundle);return}
    const asset=await readTavernRuntimeAsset(p)
    if(asset){res.setHeader('content-type',asset.mediaType);res.end(asset.body);return}
    res.setHeader('content-type','text/html');res.end('<iframe src="/frame"></iframe>')
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r))})
  const browser=await chromium.launch();t.after(()=>browser.close())
  const page=await browser.newPage(),dialogs=[],errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss()})
  await page.goto('http://127.0.0.1:'+server.address().port)
  const frame=page.frames().find(f=>f.url().endsWith('/frame'))
  await frame.waitForFunction(()=>window.openingRuntimeStarts===1,null,{timeout:3000})
  await frame.getByRole('button',{name:'保存角色'}).click()
  await frame.getByRole('button',{name:'已保存'}).waitFor()
  assert.equal(await frame.evaluate(()=>window.savedCharacter),'开局角色')
  assert.equal(await frame.evaluate(()=>window.openingRuntimeStarts),1)
  assert.equal(await frame.locator('#send_textarea').count(),1)
  assert.equal(await frame.locator('#send_but').count(),1)
  assert.deepEqual(errors,[])
  assert.deepEqual(dialogs,[])
})
