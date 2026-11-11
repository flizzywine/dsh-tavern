import test from 'node:test'
import assert from 'node:assert/strict'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {createServiceSettings} from '../tavern-plugin/packages/dsh-tavern-tts/src/settings.js'
import {createModelValidation} from '../tavern-plugin/packages/dsh-tavern-tts/src/model-validation.js'
import {qwenInstructions} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/qwen.js'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'
import {hash} from '../tavern-plugin/packages/dsh-tavern-tts/src/core.js'

function setup(t, fetch) {
  const tts = createTts()
  let settings = {enabled:true,cacheMaxGB:1,cacheMaxAgeDays:30,providers:[{id:'qwen',kind:'qwen',label:'Qwen',config:{region:'cn'}}],voices:[]}
  const services = createServiceSettings({tts,get:()=>settings,replace:async value=>{settings=value},
    credentials:()=>({resolve:async()=>({value:'test-only'}),describe:async()=>({configured:true,writable:true})}),fetch,warn:()=>{}})
  services.sync()
  t.after(async()=>{services.dispose();await tts.dispose()})
  return {services,tts}
}
const query = {serviceId:'qwen',model:'qwen3-tts-instruct-flash',voiceName:'Bella'}
const preset = {schemaVersion:1,id:'test/voice',label:'Test',enabled:true,kind:'qwen',providerId:'qwen',languages:['zh'],params:{voice:query.voiceName,model:query.model}}

test('known, omitted and failed model lists never establish an unavailable model',async t=>{
  for(const response of [()=>Response.json({data:[{id:query.model}]}),()=>Response.json({data:[{id:'qwen3-tts-flash'}]}),()=>{throw Error('offline')}]) {
    let calls=0
    const {services}=setup(t,async()=>{calls++;return response()})
    await services.voices({id:'qwen'})
    assert.deepEqual(services.validateVoiceModel(query),{issues:[]})
    assert.deepEqual(services.validateVoiceModel({...query,model:'unknown'}),{issues:[]})
    const saved=await services.saveVoicePreset({preset,expectedRevision:null})
    assert.deepEqual(saved.issues || [],[])
    assert.equal(calls,1,'validation and save never call discovery or synthesize')
  }
})

test('only real model or voice rejection populates a field warning; successful synthesis clears it',async t=>{
  let rejection={status:404,code:'InvalidParameter',message:'Model not exist.'},calls=0
  const {services,tts}=setup(t,async(url,options)=>{
    calls++
    if(options.method==='POST') return rejection ? Response.json({code:rejection.code,message:rejection.message},{status:rejection.status}) : Response.json({output:{audio:{url:'https://audio.invalid/result.wav'}}})
    return new Response(pcmWav(Buffer.alloc(100,1)))
  })
  await services.saveVoicePreset({preset,expectedRevision:null})
  const {grant}=tts.grantServiceConsumer({principal:'test',scope:'test'})
  const speak=text=>tts.synthesize({voiceId:preset.id,text,language:'zh'},{grant,scope:'test'})
  assert.equal(calls,0)
  await assert.rejects(speak('one'),e=>e.code==='QWEN_MODEL_NOT_FOUND')
  assert.deepEqual(services.validateVoiceModel(query).issues,[{code:'QWEN_MODEL_NOT_FOUND',field:'model',model:query.model,voiceName:query.voiceName}])
  const resolution=await tts.resolveVoiceService({voice:{defaultSource:'qwen',sources:{qwen:{kind:'preset',provider:'qwen',model:query.model,voiceName:query.voiceName}}},binding:{}})
  assert.equal(resolution.effective.serviceId,'qwen','confirmed warning remains non-blocking')
  assert.equal(resolution.issues[0].field,'model')
  assert.deepEqual(services.validateVoiceModel({...query,voiceName:'Cherry'}),{issues:[]})
  assert.deepEqual(services.validateVoiceModel({...query,model:'qwen3-tts-flash'}),{issues:[]})
  assert.deepEqual(services.validateVoiceModel({...query,serviceId:'missing'}),{issues:[]})
  const saved=await services.saveVoicePreset({preset,expectedRevision:hash(preset)})
  assert.equal(saved.issues[0].field,'model','save succeeds and keeps the warning')
  rejection=null
  await speak('two')
  assert.deepEqual(services.validateVoiceModel(query),{issues:[]})
  rejection={status:400,code:'InvalidParameter',message:'Voice Bella is not supported by model qwen3-tts-instruct-flash.'}
  await assert.rejects(speak('three'),e=>e.code==='QWEN_VOICE_UNSUPPORTED')
  assert.equal(services.validateVoiceModel(query).issues[0].field,'voice')
  const current=(await services.list())[0]
  await services.save({id:'qwen',kind:'qwen',config:{region:'intl'},expectedRevision:current.revision})
  assert.deepEqual(services.validateVoiceModel(query),{issues:[]})
})

test('unrelated HTTP errors do not create configuration warnings',async t=>{
  for(const [status,code,message] of [[400,'InvalidParameter','Invalid text.'],[404,'NotFound','Resource missing.'],[400,'InvalidParameter','Voice request failed.']]) {
    const {services,tts}=setup(t,async()=>Response.json({code,message},{status}))
    await services.saveVoicePreset({preset,expectedRevision:null})
    const {grant}=tts.grantServiceConsumer({principal:'test',scope:'test'})
    await assert.rejects(tts.synthesize({voiceId:preset.id,text:'test',language:'zh'},{grant,scope:'test'}))
    assert.deepEqual(services.validateVoiceModel(query),{issues:[]})
  }
})

test('confirmed failure cache is bounded, defensive and configuration-scoped',()=>{
  const cache=createModelValidation({limit:1}),identity={...query,revision:'r1'}
  cache.record(identity,{code:'QWEN_MODEL_NOT_FOUND'})
  cache.get(identity).issues[0].field='corrupted'
  assert.equal(cache.get(identity).issues[0].field,'model')
  assert.deepEqual(cache.get({...identity,revision:'r2'}),{issues:[]})
  cache.record({...identity,voiceName:'Cherry'},{code:'QWEN_VOICE_UNSUPPORTED'})
  assert.deepEqual(cache.get(identity),{issues:[]})
})

test('instruction metadata marks only known non-instruct models unused',async t=>{
  const {services}=setup(t,async()=>{throw Error('metadata must not call a provider')})
  assert.equal(services.voiceModelStatus({...query,model:'qwen3-tts-flash'}).modelInstructions,false)
  assert.equal(services.voiceModelStatus(query).modelInstructions,true)
  assert.equal(services.voiceModelStatus({...query,model:'unknown'}).modelInstructions,null)
})

test('default and non-instruct Qwen models omit both style and mood instructions',()=>{
  for(const model of [undefined,'qwen3-tts-flash']) assert.equal(qwenInstructions({params:{model,instructions:'style',moodInstruction:'mood'},mood:'joy'}),null)
  assert.ok(qwenInstructions({params:{model:'qwen3-tts-instruct-flash',instructions:'style',moodInstruction:'mood'},mood:'joy'}).includes('mood'))
})

// a 404 confirmed for an old model never follows the figure to its current one.
test('a failure confirmed for another model or voice is not shown for the current one, and a success clears it',async t=>{
  let fail=true
  const {services,tts}=setup(t,async(url,options)=>{
    if(options.method==='POST') return fail ? Response.json({code:'InvalidParameter',message:'Model not exist.'},{status:404}) : Response.json({output:{audio:{url:'https://audio.invalid/result.wav'}}})
    return new Response(pcmWav(Buffer.alloc(100,1)))
  })
  await services.saveVoicePreset({preset,expectedRevision:null})
  const {grant}=tts.grantServiceConsumer({principal:'test',scope:'test'})
  await assert.rejects(tts.synthesize({voiceId:preset.id,text:'old',language:'zh'},{grant,scope:'test'}),e=>e.code==='QWEN_MODEL_NOT_FOUND')
  assert.equal(services.validateVoiceModel(query).issues.length,1)
  const current={defaultSource:'qwen',sources:{qwen:{kind:'preset',provider:'qwen',model:'qwen3-tts-flash',voiceName:'Bella'}}}
  assert.deepEqual((await tts.resolveVoiceService({voice:current,binding:{}})).issues,[],'restored model shows no stale warning')
  assert.deepEqual(services.validateVoiceModel({...query,voiceName:'Cherry'}).issues,[],'another voice shows no stale warning')
  fail=false
  await tts.synthesize({voiceId:preset.id,text:'again',language:'zh'},{grant,scope:'test'})
  assert.deepEqual(services.validateVoiceModel(query).issues,[],'next success clears it')
})
