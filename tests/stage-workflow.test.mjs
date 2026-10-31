import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageWorkflow} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workflow.js'
import {createWorkflow} from '../tavern-plugin/lib/domain/workflow.js'
import {createStoryEvents} from '../tavern-plugin/lib/domain/story-events.js'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function setup(overrides={}) {
  const events=createStoryEvents(),workflow=createWorkflow({events}),calls=[]
  const stage=createStageWorkflow({workflow,chatHeaderForSession:async()=>({cardPath:'card',mode:'story'}),
    dialogueBubbles:{read:async()=>({enabled:true})},chatForSession:async()=>({id:'chat',cardPath:'card',mode:'story'}),
    chatPersistence:{readSlice:async()=>({chat:{sessionId:'game'}}),readRecentSummaries:async()=>({messages:[{role:'assistant',greeting:true}]})},
    stageDirector:{get:async()=>calls.push('direct'),cancel:()=>calls.push('cancel')},...overrides})
  return {events,workflow,stage,calls}
}
test('stage owns director job registration, opening, cancellation and removal',async()=>{
  const {events,workflow,stage,calls}=setup()
  assert.equal(workflow.catalog().some(row=>row.task==='stage-director'),true)
  events.emit('reply-committed',{sessionId:'game'});await tick()
  events.emit('turn-discarded',{sessionId:'game',turn:1});await tick()
  await stage.settlementQueued('chat')
  assert.deepEqual(calls,['direct','cancel','direct'])
  stage.dispose();assert.deepEqual(workflow.table(),[]);assert.deepEqual(workflow.catalog(),[])
  events.emit('reply-committed',{sessionId:'game'});await stage.settlementQueued('chat');await tick()
  assert.equal(calls.length,3)
})
test('ordinary cards do not read rounds or opening summaries',async()=>{
  const {stage,events,calls}=setup({dialogueBubbles:{read:async()=>({enabled:false})},
    chatForSession(){assert.fail('ordinary round read')},chatPersistence:{readSlice:async()=>({chat:{sessionId:'game'}}),readRecentSummaries(){assert.fail('ordinary summary read')}}})
  events.emit('reply-committed',{sessionId:'game'});await stage.settlementQueued('chat');await tick()
  assert.deepEqual(calls,[]);stage.dispose()
})
test('disposal while admission waits prevents a late director start',async()=>{
  let resolve;const gate=new Promise(done=>resolve=done)
  const {events,stage,calls}=setup({dialogueBubbles:{read:()=>gate}})
  events.emit('reply-committed',{sessionId:'game'});await tick()
  stage.dispose();resolve({enabled:true});await tick()
  assert.deepEqual(calls,[])
})

test('removed workflow jobs cannot publish late outputs to a replacement job',async()=>{
  let resolve;const gate=new Promise(done=>resolve=done)
  const events=createStoryEvents(),workflow=createWorkflow({events})
  const stop=workflow.job({id:'stage',on:'reply-committed',run:()=>gate})
  events.emit('reply-committed',{sessionId:'game',turn:1});await tick();stop()
  const replacement=workflow.job({id:'stage',on:'reply-committed',run:()=>42})
  resolve('old');await tick()
  assert.equal(workflow.output('game',1,'stage'),undefined)
  events.emit('reply-committed',{sessionId:'game',turn:1});await tick()
  assert.equal(workflow.output('game',1,'stage'),42);replacement()
})

test('optional task catalog follows registration and cannot replace a core task',()=>{
  const workflow=createWorkflow({events:createStoryEvents(),tasks:[{task:'core',name:'Core'}]})
  assert.throws(()=>workflow.job({id:'bad',task:'core',taskInfo:{name:'Replacement'},on:'reply-committed',run(){}}),/任务目录/)
  assert.deepEqual(workflow.table(),[])
  for(let i=0;i<2;i++) {
    const stop=workflow.job({id:'optional',task:'optional',taskInfo:{name:'Optional',needs:['core']},on:'reply-committed',run(){}})
    const snapshot=workflow.catalog();snapshot[1].needs.push('mutated')
    assert.deepEqual(workflow.catalog()[1].needs,['core'])
    stop();stop();assert.deepEqual(workflow.catalog(),[{task:'core',name:'Core'}])
  }
})
