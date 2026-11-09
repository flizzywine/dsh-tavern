import test from 'node:test'
import assert from 'node:assert/strict'

import {createOpeningPreparation} from '../tavern-plugin/lib/domain/opening-preparation.js'
import {initializationFixture} from './fixtures/conversation-initialization.mjs'

test('pre-game sys/cut/trigger removes only the wizard and carries MVU into the new game', async () => {
  const h=initializationFixture()
  h.state.extensions={mvuResources:[{name:'MVU'}]}
  const service=createOpeningPreparation({readCard:async()=>h.card,worldBooks:{bound:async()=>null}})
  const draft=await service.create(h.card.path,{runtime:true})
  const variables={stat_data:{name:'example',realm:3},schema:{}}
  await service.callRuntime(draft.id,'updateTavernHelperVariables',{variables,option:{type:'message',message_id:0,swipe_id:1}})
  const line='/sys Name: example\nRealm: 3 | /cut 0 | /trigger'
  const plan=await service.callRuntime(draft.id,'prepareOpeningCommand',{line,openingId:'alternate:0'})
  assert.equal(plan.input,'继续。')
  assert.equal(service.resolve(draft.id,h.card.path,'primary').startCommand,undefined)
  const prepared=service.resolve(draft.id,h.card.path,'alternate:0')
  const chat=await h.make().start({...h.input,openingId:'alternate:0',preparation:prepared})
  assert.equal(chat.openingText,'')
  assert.equal(chat.messages.some(m=>m.greeting),false)
  assert.equal(chat.messages[0].role,'system')
  assert.equal(chat.messages[0].text,'Name: example\nRealm: 3')
  assert.deepEqual(chat.messages[0].variables[0],variables)
  assert.equal(chat.tavernScriptPrompts[0].role,'system')
  assert.equal(chat.tavernScriptPrompts[0].content,'Name: example\nRealm: 3')
  assert.equal(h.session().events.some(e=>e.data?.message?.source?.model==='character-card'),false)
  const before=service.resolve(draft.id,h.card.path,'primary')
  for(const bad of ['/sys x | /cut 1 | /trigger','/sys x | /unknown | /trigger','/sys x | /cut 0','/send x | /cut 0 | /trigger']) {
    await assert.rejects(service.callRuntime(draft.id,'prepareOpeningCommand',{line:bad}))
    assert.deepEqual(service.resolve(draft.id,h.card.path,'primary'),before)
  }
})
