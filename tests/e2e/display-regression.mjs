import assert from 'node:assert/strict'
import {join} from 'node:path'
import {marked} from 'marked'
import {JSDOM} from 'jsdom'
import {Script} from 'node:vm'
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'

const fencedDocument='<html>\n\n<body><noscript><p>fallback</p></noscript><div id="e2e-display-fenced" style="height:120px;background:#def">正文美化加载中</div>\n<script>\nwindow.displayReady=false;\n\n    (()=>{document.getElementById("e2e-display-fenced").textContent="正文美化正常";window.displayReady=true})();\n</script></body></html>'
const rawDocument='<html>\n\n<body><% setMessageVar("displayProbeCount",(getMessageVar("displayProbeCount") || 0)+1) %><div id="e2e-display-raw" data-value="<%- 3 %>" style="height:100px;background:#fed">EJS 加载中</div>\n<script>\nwindow.displayReady=false;\n\n    (()=>{document.getElementById("e2e-display-raw").textContent="EJS 正常："+document.getElementById("e2e-display-raw").dataset.value;window.displayReady=true})();\n</script></body></html>'
export function displayRegressionRules() {
  return [
    {id:'e2e-raw-display',scriptName:'裸 HTML EJS',findRegex:'/(你获得了十枚金币。)/g',replaceString:'$1\n'+rawDocument,placement:[2],markdownOnly:true,disabled:false},
    {id:'e2e-fenced-display',scriptName:'正文美化',findRegex:'/(你获得了十枚金币。)/g',replaceString:'<scene_time>\n朝\n</scene_time>\n```\n'+fencedDocument+'\n```\n$1',placement:[2],markdownOnly:true,disabled:false}
  ]
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function durable(chat) {return {posture:chat.posture,messages:chat.messages.map(m=>({role:m.role,text:m.sourceText??m.text,variables:m.variables}))}}
async function rendered(page,id,text) {
  const deadline=Date.now()+30000
  while(Date.now()<deadline) {
    for(const frame of page.frames()) {
      // Frames can be parked or replaced while async template output arrives.
      // Re-select the visible document on each poll; never wait on an old one.
      if(frame===page.mainFrame() || frame.isDetached()) continue
      const element=await frame.frameElement().catch(()=>null)
      if(!element || !await element.isVisible() || await element.getAttribute('aria-hidden')==='true') continue
      const content=frame.locator('#'+id)
      if(!await content.count() || await content.innerText().catch(()=>'')!==text) continue
      if(!await frame.evaluate(()=>window.displayReady===true).catch(()=>false)) continue
      const box=await element.boundingBox()
      assert.ok(box && box.height>50 && box.height<800,`${id} frame must not expand into a large blank area: ${JSON.stringify(box)}`)
      return {height:box.height,text:await content.innerText()}
    }
    await pause(100)
  }
  throw Error('Display frame not found: '+id)
}
export async function displayRegressionChecks({page,step,savedChat,data,output,report,restartServer}) {
  const inspect=async()=>({fenced:await rendered(page,'e2e-display-fenced','正文美化正常'),raw:await rendered(page,'e2e-display-raw','EJS 正常：3')})
  let initial, before
  await step('HTML 美化、裸 HTML 和属性 EJS 实际执行',async()=>{
    before=await inspect();initial=durable(await savedChat())
    assert.equal(initial.messages.at(-1).variables[0].displayProbeCount,1)
    await page.screenshot({path:join(output,'display-before-candidates.png'),fullPage:true})
  })
  await step('点击生成候选项后正文布局、脚本和历史变量保持一致',async()=>{
    await page.getByRole('button',{name:'生成候选项',exact:true}).click()
    await page.getByText('5 个',{exact:true}).waitFor()
    const after=await inspect()
    assert.deepEqual(after,before)
    assert.deepEqual(durable(await savedChat()),initial)
    report.displayCandidates={before,after}
    await page.screenshot({path:join(output,'display-after-candidates.png'),fullPage:true})
  })
  await step('刷新后展示仍正常，EJS 不重复修改变量',async()=>{
    await page.reload({waitUntil:'domcontentloaded'})
    assert.deepEqual(await inspect(),before)
    assert.deepEqual(durable(await savedChat()),initial)
  })
  await step('重启载入旧损坏展示，实际页面恢复脚本且保留历史快照',async()=>{
    const chat=await savedChat()
    const legacy=marked.parse('<scene_time>\n朝\n</scene_time>\n```\n'+fencedDocument+'\n```\n你获得了十枚金币。')
    const dom=new JSDOM(legacy)
    const broken=dom.window.document.querySelector('script').textContent;dom.window.close()
    assert.throws(()=>new Script(broken),'old formatter must reproduce broken JavaScript')
    let injected
    await restartServer(async()=>{
      const store=createChatJournalStore({dataRoot:data})
      await store.update(chat.id,draft=>{
        const reply=draft.messages.at(-1), snapshot=reply.tavernPluginData.template_display
        const part=snapshot.parts.find(p=>p.kind==='html' && p.content.includes('id="e2e-display-fenced"'))
        assert.ok(part,'persisted display contains the fenced document')
        part.content=part.content.replace(/(<script>)[\s\S]*?(<\/script>)/,(_m,start,end)=>start+broken+end)
        snapshot.html=snapshot.parts.filter(p=>p.kind==='html').map(p=>p.content).join('\n')
        injected=structuredClone(snapshot)
        draft._storageRevision += 1
        return draft
      },{source:'e2e.legacy-display-fixture'})
    })
    await inspect()
    const restored=await savedChat()
    assert.deepEqual(durable(restored),initial)
    assert.deepEqual(restored.messages.at(-1).tavernPluginData.template_display,injected,'recovery must not rewrite the historical display snapshot')
    report.legacyDisplay={scriptRecovered:true,storedSnapshotUnchanged:true,variablesUnchanged:true}
    await page.screenshot({path:join(output,'display-legacy-recovered.png'),fullPage:true})
  })
}
