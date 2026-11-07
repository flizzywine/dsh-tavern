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

test('删除首轮唯一正文后，末尾输入仍可重新生成正文', () => {
  const session = { surface: { nodes: [] } }
  const fields = createSessionStateView({ activity: () => ({ busy: false }),
    evidence: () => ({ session, events: [] }) })
  const chat = {
    id: 'c', sessionId: 's', mode: 'story', _storageRevision: 3,
    foregroundError: null,
    messages: [{ role: 'assistant', greeting: true, text: '就绪。等待输入。' },
      { role: 'user', text: '首轮输入', native: true, source: { kind: 'user', rpcId: 'rpc-deleted-body' } }]
  }
  for (const projected of [false, true]) {
    const view = fields.volatile(projected ? projectChatSessionState(chat) : chat, { busy: false })
    assert.equal(view.canRegenerate, true, projected ? '缓存投影也允许补写首轮正文' : '完整存档允许补写首轮正文')
    assert.equal(view.failedTailPersisted, true)
  }
})

test('可重生成不检查正文、开场、placeholder 或导入消息形态', () => {
  const session = { surface: { nodes: [] } }
  const fields = createSessionStateView({ activity: () => ({ busy: false }),
    evidence: () => ({ session, events: [] }) })
  const greeting = { role: 'assistant', greeting: true, text: '开场' }
  const messageSets = [
    [],
    [greeting],
    [greeting, { role: 'user', text: '尚未提交', native: true, placeholder: true }],
    [greeting, { role: 'user', text: '导入历史', native: true, source: { kind: 'import' } }]
  ]
  for (const messages of messageSets) for (const projected of [false, true]) {
    const chat = { id: 'c', sessionId: 's', mode: 'story', _storageRevision: 2, messages }
    const view = fields.volatile(projected ? projectChatSessionState(chat) : chat, { busy: false })
    assert.equal(view.canRegenerate, true, JSON.stringify(messages.at(-1) || '空存档'))
  }
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
