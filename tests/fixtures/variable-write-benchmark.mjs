// Isolated production variable API + journal + persistence + summary index. No user data.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createProfileDataStore } from '../../tavern-plugin/lib/profile-data-store.js'
import { createTavernConversationRegistry } from '../../tavern-plugin/lib/domain/tavern-conversation-registry.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { execFileSync } from 'node:child_process'
const compact = process.argv.includes('--compact')
const output=resolve(process.argv[2] || 'output/playwright/variable-writes/run')
await mkdir(output,{recursive:true})
const root=await mkdtemp(join(tmpdir(),'tavern-variable-bench-'))
const metrics=[];let measuring=false
const timed=(name,fn)=>async(...args)=>{const start=performance.now();try{return await fn(...args)}finally{if(measuring)metrics.push({name,ms:performance.now()-start})}}
const persistence=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
const data=createProfileDataStore({dataRoot:root})
const registry=createTavernConversationRegistry({store:{readLinks:()=>data.readJson('sessions.json'),updateLinks:fn=>data.updateJson('sessions.json',fn),readIndex:timed('index.read',()=>data.readJson('index.json')),writeIndex:timed('index.write',v=>data.writeJson('index.json',v)),readChat:persistence.read,writeChat:persistence.write,removeChat:persistence.remove}})
const countArg=process.argv.find(value=>value.startsWith('--count='))
const count=countArg ? Number(countArg.slice('--count='.length)) : 600
if(!Number.isSafeInteger(count) || count<2 || count>20000) throw new Error('--count must be an integer between 2 and 20000')
const seeded={id:'c',sessionId:'s',cardPath:'cards/test.json',mode:'story',mvu:{enabled:true},variables:{},messages:Array.from({length:count},(_,i)=>({role:i%2?'assistant':'user',text:'正文'.repeat(2000),variables:[{stat_data:{hp:10,details:'历史变量'.repeat(1000)},schema:{}}]}))}
await persistence.write(seeded)
const adapter=createTavernScriptHostAdapter({resolveChat:timed('chat.read',()=>persistence.read('c')),resolveChatSlice:timed('chat.slice',(_session,indices,fields)=>persistence.readSlice('c',indices,fields)),readChatRevision:persistence.readRevision,readCard:async()=>({}),worldBooks:{},scriptDispatch:{},
 writeChat:timed('chat.write',async(chat,metadata)=>{const saved=await persistence.write(chat,metadata);await registry.sync(saved);return saved}),
 patchChat:timed('chat.patch',async(...args)=>{const saved=await persistence.patch(...args);if(saved)await registry.sync(saved);return saved})})
const results=[]
try {
 for(const type of ['message','chat','script']){
  const samples=[]
  for(let i=0;i<6;i++){
   const before=await persistence.read('c')
   metrics.length=0;measuring=true
   const begin=performance.now()
   const result=await adapter.updateVariables('s',{type,message_id:-1,script_id:'sample'},{hp:20+i,payload:'变量'.repeat(1000)},undefined,undefined,compact ? {chatId:'c',stateRevision:before._storageRevision,lifecycleRevision:0}:undefined)
   const responseBytes=Buffer.byteLength(JSON.stringify(result));const ms=performance.now()-begin;measuring=false
   assert.equal(result.updated,true)
   const saved=await persistence.read('c')
   const vars=type==='message'?saved.messages.at(-1).variables[0]:type==='chat'?saved.variables:saved.tavernHelperScriptVariables.sample
   assert.equal(vars.hp,20+i);assert.equal(saved.messages[0].variables[0].stat_data.hp,10)
   samples.push({ms,responseBytes,metrics:structuredClone(metrics)})
  }
  const measured=samples.slice(1).map(x=>x.ms).sort((a,b)=>a-b)
  const result={type,medianMs:measured[2],samples};results.push(result);console.log(type,result.medianMs.toFixed(1)+' ms')
 }
 const restarted=createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 assert.deepEqual(await restarted.read('c'),await persistence.read('c'))
 await writeFile(join(output,'results.json'),JSON.stringify({compact,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,count,chatBytes:Buffer.byteLength(JSON.stringify(seeded)),warmup:1,samples:5,results},null,2)+'\n')
}finally{await rm(root,{recursive:true,force:true})}
