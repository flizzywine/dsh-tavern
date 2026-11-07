import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { projectChatSessionState, createSessionStateView } from '../tavern-plugin/lib/domain/chat-session-state.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

test('cached rollback controls follow the stored Session surface without resuming an Agent', async () => {
  const source=await readFile(new URL('../tavern-plugin/lib/index.js',import.meta.url),'utf8')
  const evidence=source.slice(source.indexOf('  function sessionDebugEvidence('),source.indexOf('  const readBackgroundSuppression'))
  const session={id:'s',events:[
    {seq:0,type:'user/message',data:{role:'user',source:{kind:'user'}}},
    {seq:1,type:'assistant/message',data:{turn:2,message:{source:{kind:'model',provider:'test',model:'test'}}}}
  ],surface:{nodes:[0,1]}}
  const chat={id:'c',sessionId:'s',mode:'story',cardPath:'card',_storageRevision:1,messages:[{role:'user'},{role:'assistant',turn:2}]}
  let loaded=true
  const context={str:String,sessionEvents,
    ctx:{get:()=>({get:()=>loaded?session:undefined})},
    agentRegistry:{get:()=>undefined,resume:()=>{throw Error('view must not resume')}},
    requestPerformance:{stage:(_name,fn)=>fn(),state(){}}}
  const evidenceOf=vm.runInNewContext(`(()=>{${evidence}\nreturn sessionDebugEvidence})()`,context)
  const fields=createSessionStateView({activity:()=>({busy:false}),evidence:id=>evidenceOf(id,true)})
  const reader=createSessionViewReader({readState:async()=>projectChatSessionState(chat),readChat:async()=>chat,
    project:{full:async value=>fields.volatile(value,{busy:false}),cached:async(value,previous,activity)=>({...previous,...fields.volatile(value,activity)})},
    readChanges:async()=>null,activity:()=>({busy:false}),trace:context.requestPerformance,foregroundRunning:()=>false,synchronize:()=>{}})
  const run=reader.read
  assert.equal((await run('s')).canRollback,true)
  // The save decides availability; a surface that lost the round is repaired on rollback.
  session.surface.nodes=[]
  const lost=await run('s')
  assert.equal(lost.canRollback,true)
  assert.equal(lost.rollbackUnavailableReason,'')
  session.surface.nodes=[0,1]
  assert.equal((await run('s')).canRollback,true)
  // Rollback resumes an unloaded session itself.
  loaded=false
  assert.equal((await run('s')).canRollback,true)
})

test('末尾持久输入在会话视图中标记为待回复的失败尾，可供撤回', () => {
  const session = { surface: { nodes: [] } }
  const fields = createSessionStateView({ activity: () => ({ busy: false }),
    evidence: () => ({ session, events: [] }) })
  const chat = {
    id: 'c', sessionId: 's', mode: 'story', _storageRevision: 2,
    foregroundError: null,
    messages: [{ role: 'user', text: '上一轮输入' }, { role: 'assistant', turn: 2, text: '上一轮正文' },
      { role: 'user', text: '最新输入', native: true }]
  }
  const view = fields.volatile(projectChatSessionState(chat), { busy: false })
  assert.equal(view.failedTailPersisted, true)
  assert.equal(view.failedTailTurn, 0)
  const beforeNativeTurn = fields.volatile(projectChatSessionState(chat), { busy: false })
  assert.equal(beforeNativeTurn.failedTailPersisted, true)
  assert.equal(beforeNativeTurn.failedTailTurn, 0)
})

test('尚未进入原生轮的 placeholder 持久输入也提供撤回入口', () => {
  const session = { surface: { nodes: [] } }
  const fields = createSessionStateView({ activity: () => ({ busy: false }),
    evidence: () => ({ session, events: [] }) })
  const chat = {
    id: 'c', sessionId: 's', mode: 'story', _storageRevision: 2,
    foregroundError: null,
    messages: [{ role: 'assistant', turn: 2, text: '上一轮正文' },
      { role: 'user', text: '6', native: true, placeholder: true }]
  }
  const view = fields.volatile(projectChatSessionState(chat), { busy: false })
  assert.equal(view.failedTailPersisted, true)
  assert.equal(view.failedTailTurn, 0)
})
