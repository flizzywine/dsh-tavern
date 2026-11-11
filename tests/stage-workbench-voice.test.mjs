import test from 'node:test'
import assert from 'node:assert/strict'
import {workbenchFixture} from './fixtures/workbench-features.mjs'

test('reading returns normalized TTS settings without writes or approval and retains card authority',async t=>{
  const {readingOf}=await import('../tavern-plugin/packages/dsh-tavern-tts/src/settings.js')
  const calls=[],settings={}
  const f=await workbenchFixture({tts:{call(method,args){calls.push({method,args});assert.equal(method,'reading');return readingOf(settings)}}})
  t.after(()=>f.close())
  const fresh={general:{figure:null},narrator:{enabled:false,figure:null},readAloud:{voice:null,auto:false}}
  assert.deepEqual((await f.invoke('voice_read',{action:'reading'})).data,fresh)
  settings.reading={general:{figure:{packId:'11111111-1111-4111-8111-111111111111',figureId:'speaker-a'}},narrator:{enabled:true,figure:null},readAloud:{voice:{browser:'Reader'},auto:true}}
  const before=structuredClone(settings)
  assert.deepEqual((await f.invoke('voice_read',{action:'reading'})).data,before.reading)
  assert.deepEqual(settings,before)
  assert.deepEqual(calls,[{method:'reading',args:{}},{method:'reading',args:{}}])
  assert.equal(f.approvals.length,0)
  assert.equal(f.paidCalls,0)
  f.chat.mode='story'
  assert.equal((await f.invoke('voice_read',{action:'reading'})).error.code,'CARD_MODE_REQUIRED')
  assert.equal(calls.length,2)
})
