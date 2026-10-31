import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import vm from '../fixtures/client-vm.mjs'
import {chromium} from 'playwright'
let descriptor
vm.runInNewContext(await readFile('tavern-plugin/lib/client.js','utf8'),{window:{__ModuleLoader__:{load(value){descriptor=value}}},console})
const client=descriptor.factory(()=>({})),browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}})
await page.route('**/*',route=>route.abort())
await mkdir("output/frame-size-audit",{recursive:true})
const results=[]
for(const [name,css] of Object.entries({normal:'#panel{height:600px}',local:'#panel{height:120px;overflow:auto}',viewport:'#panel{height:100vh;overflow:auto}',sandbox:'#panel{height:100vh;overflow:auto}',long:'#panel{height:100vh;overflow:auto}.inside{min-height:2000px}',floating:'#panel{height:120px;overflow:auto}#panel:after{content:"";position:fixed;bottom:0;width:20px;height:20px}',fixed:'#panel{position:fixed;inset:0;overflow:auto}',centered:'#panel{height:100vh;display:flex;align-items:center;overflow:hidden}',header:'h1{margin:0;height:40px}#panel{height:100vh;overflow:auto}',tall:'#panel{min-height:100vh}.inside.inside{height:2000px}'})){
 const content='<style>'+css+' .inside{height:600px;width:320px;background:#334;color:white}</style>'+(name==='header'?'<h1>标题</h1>':'')+'<div id="panel"><div class="inside">顶部状态<br>中性测试内容</div></div>'
 const doc=client.buildTavernFrameDocument({content,token:name})
 await page.setContent('<iframe '+(name==='sandbox'?'sandbox="allow-scripts" ':'')+'style="width:100%;height:48px;border:0"></iframe>')
 await page.evaluate(({doc})=>{window.heights=[];window.onmessage=e=>{if(e.data.type==='dsh-tavern-frame-height'){heights.push(e.data.height);document.querySelector('iframe').style.height=e.data.height+'px'}};document.querySelector('iframe').srcdoc=doc},{doc})
 await page.waitForTimeout(700)
 const report=await page.evaluate(()=>({height:document.querySelector('iframe').clientHeight,reports:heights}))
 const frame=page.frames()[1];Object.assign(report,await frame.evaluate(()=>({panel:document.querySelector('#panel').getBoundingClientRect().height,scroll:document.querySelector('#panel').scrollHeight,body:document.body.scrollHeight})))
 results.push({name,...report});await page.screenshot({path:'output/frame-size-audit/'+name+'.png'})
}
console.log(JSON.stringify(results,null,2));await writeFile('output/frame-size-audit/report.json',JSON.stringify(results,null,2));await browser.close()

const header=results.find(r=>r.name==='header')
assert.ok(header.height>=844&&header.height<=844+80&&header.reports.length<10,'标题加 100vh 不应无限长高：'+JSON.stringify(header))
assert.equal(results.find(r=>r.name==='tall').height,2000,'能收敛的 min-height:100vh 长内容仍随内容撑高')
for (const result of results.filter(r=>!['header','tall'].includes(r.name))) assert.equal(result.height, result.name === "normal" ? 600 : ["local","floating"].includes(result.name) ? 120 : result.name === "sandbox" ? 600 : 844, result.name)

assert.equal(results.find(r=>r.name === "long").scroll,2000)
