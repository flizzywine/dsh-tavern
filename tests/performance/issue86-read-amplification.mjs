// Synthetic production-store/adapter benchmark. No real user data or model calls.
// node --expose-gc tests/performance/issue86-read-amplification.mjs [report.json] [--assert-budget]
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'

const root = await mkdtemp(join(tmpdir(), 'tavern-issue86-'))
const originalClone = globalThis.structuredClone
const results = []
let active
globalThis.structuredClone = function(value, ...args) {
  const start = performance.now()
  try { return originalClone(value, ...args) }
  finally {
    if (active) {
      active.cloneCalls++
      active.cloneMs += performance.now() - start
      if (value?.id === 'issue86' && value.messages?.length === 453) active.fullChatClones++
    }
  }
}
async function measure(name, fn) {
  globalThis.gc?.()
  const before = process.memoryUsage(), cpu = process.cpuUsage()
  const row = { name, cloneCalls: 0, fullChatClones: 0, cloneMs: 0 }
  active = row
  const start = performance.now()
  let value
  try { value = await fn() } finally { active = undefined }
  row.ms = performance.now() - start
  row.cpuMs = Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000
  row.heapDeltaMB = (process.memoryUsage().heapUsed-before.heapUsed)/1e6
  row.rssMB = process.memoryUsage().rss/1e6
  results.push(row)
  console.log(JSON.stringify(row))
  return value
}
try {
  const store = createChatJournalStore({dataRoot: root})
  const persistence = createChatPersistence({store})
  let seed = {id:'issue86', sessionId:'s', mode:'story', cardPath:'cards/synthetic.json', _storageRevision:5921,
    messages:Array.from({length:453},(_,i)=>({role:i%2?'assistant':'user',turn:Math.floor(i/2)+1,text:'Synthetic story '+i,
      variables:[{stat_data:{records:Array.from({length:120},(_,j)=>({id:j,value:i,description:'synthetic historical state '.repeat(14)}))},schema:{}}]}))}
  const bytes = Buffer.byteLength(JSON.stringify(seed))
  await store.update('issue86',()=>seed)
  seed = null
  await persistence.read('issue86')
  await measure('warm read x1',()=>persistence.read('issue86'))
  await measure('warm reads x20 sequential',async()=>{for(let i=0;i<20;i++) await persistence.read('issue86')})
  await measure('metadata slice x20',async()=>{for(let i=0;i<20;i++) await persistence.readSlice('issue86',[])})
  const adapter = createTavernScriptHostAdapter({resolveChat:()=>persistence.read('issue86'),
    resolveChatSlice:(_s,indices)=>persistence.readSlice('issue86',indices),
    resolveChangedChatSlice:(_s,revision)=>persistence.readChangedSlice('issue86',revision),
    writeChat:persistence.write,readCard:async()=>({name:'Synthetic'}),worldBooks:{bound:async()=>null},scriptDispatch:{}})
  let response = await measure('template initial full',()=>adapter.readFullPromptTemplateState('s'))
  let cursor = response.cursor
  response = null
  response = await measure('template unchanged',()=>adapter.readFullPromptTemplateState('s',cursor))
  assert.ok(response.delta)
  cursor = response.cursor
  response = null
  let revision = 5921
  const advance = async n => {
    for(let i=0;i<n;i++) {
      assert.ok(await store.patch('issue86',revision,[
        {op:'set',path:['_storageRevision'],value:revision+1},
        {op:'set',path:['messages',452,'text'],value:'changed '+(revision+1)}]))
      revision++
    }
  }
  await advance(32)
  assert.ok(await store.readChangedSlice('issue86',5921))
  response = await measure('template after 32 revisions',()=>adapter.readFullPromptTemplateState('s',cursor))
  assert.equal(response.delta.chat.set.length,1)
  cursor = response.cursor
  response = null
  const previous = revision
  await advance(33)
  if (process.argv.includes('--assert-optimized')) assert.ok(await store.readChangedSlice('issue86',previous))
  response = await measure('template after 33 revisions',()=>adapter.readFullPromptTemplateState('s',cursor))
  assert.equal(response.delta.chat.set.length,1)
  results.at(-1).responseBytes = Buffer.byteLength(JSON.stringify(response))
  response = null
  const timeline = createStoryTimeline()
  let chat = await persistence.read('issue86')
  const inspected = await measure('timeline inspect full chat',()=>timeline.inspect({chat}))
  const metadata = await persistence.readSlice('issue86',[])
  const small = await measure('timeline inspect metadata only',()=>timeline.inspect({chat:metadata.chat}))
  // The synthetic chat has no timeline; generated branch IDs differ. Compare
  // stable fields only. Legacy migration equivalence needs separate tests.
  assert.equal(inspected.revision,small.revision)
  assert.deepEqual(inspected.operations,small.operations)
  chat = null
  await measure('persistence no-op update',()=>persistence.update('issue86',()=>undefined))
  await measure('persistence metadata update',()=>persistence.update('issue86',current=>{
    current.diagnosticCounter=1
    return current
  }))
  revision = (await persistence.readSlice('issue86',[])).chat._storageRevision
  await measure('persistence metadata patch',()=>persistence.patch('issue86',revision,[
    {op:'set',path:['diagnosticCounter'],value:2}
  ]))
  const report = {node:process.version,platform:process.platform,arch:process.arch,
    commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),bytes,count:453,initialRevision:5921,
    scope:'Synthetic journal/persistence/template adapter only; excludes DSH turn, sessionView RPC, browser and model.',results}
  await writeFile(process.argv[2] || 'output/issue86/report.json',JSON.stringify(report,null,2)+'\n')
  if(process.argv.includes('--assert-budget')) {
    assert.equal(results.find(r=>r.name==='warm reads x20 sequential').fullChatClones,0,
      'Read amplification budget: repeated same-revision reads still clone every full chat (mechanism probe, not a 148s turn reproduction)')
  }
  if(process.argv.includes('--assert-optimized')) {
    assert.equal(results.find(r=>r.name==='template after 33 revisions').fullChatClones,0)
  }
} finally {
  globalThis.structuredClone = originalClone
  await rm(root,{recursive:true,force:true})
}
