import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,copyFile} from 'node:fs/promises'
import {join} from 'node:path'
import {parse,stringify} from 'yaml'
import {parseSessionLog} from '../../tavern-plugin/lib/domain/session-log-codec.js'
export async function setupRealVariables({root,profile,data,runtimeHome}){
 const settings=parse(await readFile(join(runtimeHome,'settings.yaml'),'utf8'))
 const selection={...settings['agent-default-model'],reasoningEffort:'low'}
 await writeFile(join(root,'settings.yaml'),stringify({'agent-default-model':selection,'llm-pi-ai':settings['llm-pi-ai']}),{mode:0o600})
 await copyFile(join(runtimeHome,'.credentials.yaml'),join(root,'.credentials.yaml'))
 await writeFile(join(profile,'cordis.patch.yml'),stringify([{id:'agent-default-model',config:selection}]))
 const state={gold:0,...Object.fromEntries(Array.from({length:65},(_,i)=>['仓库'+String(i).padStart(2,'0'),{库存:100+i}]))}
 state.仓库64.核验编号=734219;state.记录={备注:'分段读取测试。'.repeat(200)+'终点验证码：59283'}
 const file=join(data,'resources/cards/e2e.json'),doc=JSON.parse(await readFile(file,'utf8'))
 doc.data.description='中性仓库查询。按用户要求调用变量查询工具读取存档，不猜测，不推进剧情，不改变库存。'
 doc.data.character_book.entries[0].content=JSON.stringify(state)
 await writeFile(file,JSON.stringify(doc))
 return selection
}
export async function realVariableLookupChecks({page,step,savedChat,root,output,report}){
 async function events(){
  const chat=await savedChat(),dir=join(root,'profile-data/tavern/sessions')
  for(const file of await readdir(dir,{recursive:true}))if(file.endsWith('session.v3.jsonl.zstd')){
   const parsed=parseSessionLog(await readFile(join(dir,file)))
   if(parsed.header.id===chat.sessionId)return parsed.events
  }
  return []
 }
 async function send(input,expected){
  const old=(await savedChat()).messages.length
  const box=page.getByRole('textbox',{name:/发消息|Message/});await box.fill(input);await box.press('Enter')
  const deadline=Date.now()+180000;let tick=Date.now()
  while(Date.now()<deadline){
   const chat=await savedChat(),message=chat.messages.at(-1)
   if(chat.messages.length>old&&message.role==='assistant'&&message.text?.includes(expected))return
   if(Date.now()-tick>30000){console.log('等待真实模型查询…');tick=Date.now()}
   await page.waitForTimeout(500)
  }
  throw Error('真实模型未在时限内完成查询，请检查保存的调用记录')
 }
 await step('真实模型分页浏览、搜索并读取变量',async()=>{
  await send('请使用 tavern_read_variables 浏览顶层目录第一页和第二页，每页20项；再搜索核验编号并读取准确路径的当前值。必须实际调用工具，不根据上下文猜测，不推进剧情。最后报告页数、路径和编号。','734219')
 })
 await step('真实模型续读长文本并查询不存在字段',async()=>{
  await send('请用变量工具 read /记录/备注，并使用 nextCursor 续读至末尾，给出终点验证码；再查询 /记录/不存在 并说明是否存在。不推进剧情。','59283')
 })
 const all=await events(),calls=all.filter(e=>e.type==='tool/call'&&e.data.name==='tavern_read_variables')
 const args=calls.map(e=>typeof e.data.arguments==='string'?JSON.parse(e.data.arguments):e.data.arguments)
 assert.ok(args.some(a=>(a.action||'list')==='list'&&!a.cursor))
 assert.ok(args.some(a=>(a.action||'list')==='list'&&a.cursor))
 assert.ok(args.some(a=>a.action==='search'))
 assert.ok(args.some(a=>a.action==='read'&&a.path==='/仓库64/核验编号'))
 assert.ok(args.some(a=>a.action==='read'&&a.path==='/记录/备注'&&a.cursor))
 assert.ok(args.some(a=>a.path==='/记录/不存在'))
 const ids=new Set(calls.map(e=>e.data.callId))
 const results=all.filter(e=>e.type==='tool/result'&&ids.has(e.data.message?.source?.callId))
 await writeFile(join(output,'variable-tool-evidence.json'),JSON.stringify({calls:calls.map(e=>e.data),results:results.map(e=>e.data)},null,2))
 const rows=results.map(result=>JSON.parse(result.data.message.content[0].content[0].text))
 const pages=rows.filter(row=>row.action==='list')
 assert.deepEqual(pages.map(row=>row.entries.length),[20,20])
 assert.equal(new Set(pages.flatMap(row=>row.entries.map(entry=>entry.path))).size,40)
 assert.equal(rows.find(row=>row.path==='/仓库64/核验编号').value,734219)
 assert.equal(rows.find(row=>row.path==='/记录/不存在').found,false)
 assert.ok(rows.filter(row=>row.path==='/记录/备注').at(-1).value.endsWith('59283'))
 assert.equal(results.length,calls.length)
 assert.ok(!results.some(e=>JSON.stringify(e.data).includes('"isError":true')))
 await page.screenshot({path:join(output,'real-variable-lookup.png')})
 report.variableLookup={realModel:true,calls:calls.length,pagination:true,search:true,read:true,textContinuation:true,missingPath:true}
}
