import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {parseNativeSessionLog} from './native-session-log.mjs'
import {Session} from '../fixtures/dsh-session-host.mjs'
import {currentSessionLogs} from './session-files.mjs'
export async function openingUpdateChecks({page,step,savedChat,data,output,report,root}){
 const state=text=>JSON.parse(text.match(/<initvar>([\s\S]*?)<\/initvar>/)[1])
 const file=join(data,'resources/cards/e2e.json'),doc=JSON.parse(await readFile(file,'utf8'))
 const card=doc.raw?.data||doc.data||doc.raw
 await step('未跑第一轮，修改定义并重新加载，开场 initvar 与变量同步',async()=>{
  const before=await savedChat();assert.equal(before.messages.length,1)
  assert.deepEqual(state(before.messages[0].sourceText),{gold:0,old:1})
  card.first_mes=card.first_mes.replace(/<initvar>[\s\S]*?<\/initvar>/,'<initvar>{"gold":99,"energy":100}</initvar>')
  card.character_book.entries[0].content='gold: 99\nenergy: 100'
  await writeFile(file,JSON.stringify(doc));await page.reload()
  await page.getByText('酒馆状态',{exact:true}).filter({visible:true}).first().click()
  await page.getByRole('button',{name:'重新加载人物卡和世界书',exact:true}).click()
  await page.getByRole('dialog',{name:'确认操作'}).getByRole('button',{name:'确认',exact:true}).click()
  const deadline=Date.now()+30000
  while(Date.now()<deadline){if((await savedChat()).messages[0].sourceText.includes('"energy"'))break;await new Promise(r=>setTimeout(r,100))}
  const after=await savedChat()
  assert.deepEqual(state(after.messages[0].sourceText),{gold:99,energy:100})
  assert.deepEqual(after.messages[0].variables[0].stat_data,{gold:0,energy:100})
  assert.equal(after.messages.length,1)
  const directory=join(root,'profile-data/tavern/sessions')
  let verified=false
  for(const {path:file} of await currentSessionLogs(directory)){
   const parsed=parseNativeSessionLog(await readFile(file))
   if(parsed.header.id!==after.sessionId)continue
   const native=Session.create(after.sessionId,parsed.events,parsed.header)
   const texts=native.surface.nodes.map(seq=>parsed.events.find(event=>event.seq===seq)).filter(event=>event?.type==='assistant/message').flatMap(event=>event.data.message.content).filter(block=>block.type==='text').map(block=>block.text)
   assert.ok(texts.some(text=>text.includes('"energy": 100')),'轨迹当前开场必须包含新初值')
   assert.ok(!texts.some(text=>text.includes('"old"')),'轨迹当前开场不得包含已删除字段')
   verified=true
  }
  assert.ok(verified,'核对落盘的原生会话投影')
  await page.reload()
  assert.deepEqual(state((await savedChat()).messages[0].text),{gold:99,energy:100})
 })
 await step('重新加载后开始第一轮，后台正常结算且旧字段不恢复',async()=>{
  const composer=page.getByRole('textbox',{name:/下一步行动|Next action|发消息|Message/})
  await composer.fill('领取任务奖励');await composer.press('Enter')
  const deadline=Date.now()+30000
  while(Date.now()<deadline){if((await savedChat()).messages.at(-1).variables?.[0]?.stat_data?.gold===10)break;await new Promise(r=>setTimeout(r,100))}
  assert.deepEqual((await savedChat()).messages.at(-1).variables[0].stat_data,{gold:10,energy:100})
  await page.screenshot({path:join(output,'opening-update.png')})
 })
 report.openingUpdate={beforeFirstTurn:true,initvar:true,preserveValues:true,reload:true,settlement:true}
}
