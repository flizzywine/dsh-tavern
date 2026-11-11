import test from 'node:test'
import assert from 'node:assert/strict'
import { createQwenAdapter, qwenVoices } from '../src/providers/qwen.js'
import { providerConfig, presetParams, providerKind } from '../src/providers/params.js'
import { portableVoice, id, serviceVoiceId as voiceId } from '../src/core.js'
import { createTts } from '../src/service.js'
import { createServiceSettings } from '../src/settings.js'
import { pcmWav } from '../src/providers/audio.js'

const audio = pcmWav(Buffer.alloc(100, 1))
const audioUrl = 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=fake'
const provider = { config: { region: 'cn' } }
const spec = { text: '你好', language: 'zh', mood: 'joy', params: { voice: 'Bella' } }
function fakeFetch(calls) {
  return async (url, options) => { calls.push({ url, options }); return url.endsWith('/v1/models') ? Response.json({data:[]}) : url === audioUrl ? new Response(audio) : Response.json({ output: { audio: { url: audioUrl } } }) }
}

test('Qwen non-streaming request uses bearer key and downloads only returned WAV without credentials', async () => {
  const calls = [], adapter = createQwenAdapter({ fetch: fakeFetch(calls) }), abort = new AbortController()
  assert.deepEqual(await adapter.synthesize(provider, { key: 'fake-key' }, { ...spec, signal: abort.signal }), audio)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(calls[0].options.headers, { Authorization: 'Bearer fake-key', 'Content-Type': 'application/json' })
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'qwen3-tts-flash', input: { text: '你好', voice: 'Bella', language_type: 'Auto' } })
  assert.equal(calls[1].url, audioUrl)
  assert.equal(calls[1].options.headers, undefined)
  for (const call of calls) assert.equal(call.options.redirect, 'error')
  assert.equal(calls[1].options.signal, calls[0].options.signal)
  abort.abort(); assert.equal(calls[0].options.signal.aborted, true)
})

test('Qwen rejects punctuation-only pauses locally and classifies the observed upstream invalid-text response', async () => {
  let calls = 0
  const adapter = createQwenAdapter({warn(){},fetch:async()=>{
    calls++
    return Response.json({code:'InvalidParameter',message:'Due to invalid text, invalid audio was returned.'},{status:400})
  }})
  for (const text of ['\u2026\u2026','...','?!','\u3002','   ']) {
    await assert.rejects(adapter.synthesize(provider,{key:'fake'},{...spec,text}),{code:'QWEN_INVALID_TEXT',status:400,retryable:false})
  }
  assert.equal(calls,0)
  await assert.rejects(adapter.synthesize(provider,{key:'fake'},spec),{code:'QWEN_INVALID_TEXT',status:400,retryable:false})
  assert.equal(calls,1,'deterministic HTTP 400 is never retried')
})

// The HTTP API places style controls inside input, not parameters or the top level.
test('Qwen instruct alias and snapshot send the exact documented input body for Cherry and Bella', async () => {
  for (const model of ['qwen3-tts-instruct-flash', 'qwen3-tts-instruct-flash-2026-01-26']) {
    for (const voice of ['Cherry', 'Bella']) {
      const calls = []
      await createQwenAdapter({fetch:fakeFetch(calls)}).synthesize(provider, {key:'fake'}, {
        ...spec, text:'Hello.', params:{voice, model, instructions:'Speak softly.', moodInstruction:'Sound cheerful.'}
      })
      assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        model, input:{text:'Hello.', voice, language_type:'Auto', instructions:'Speak softly.\uff1bSound cheerful.'}
      })
      // optimize_instructions is optional; omission retains the documented false default.
      assert.equal(calls.length, 2)
    }
  }
})

// card voice language must not force single-language pronunciation on mixed text.
test('Qwen intl host and explicit model always use Auto for mixed-language text', async () => {
  const text = '让我 call 一下 tool，写个 json 给你。'
  for (const language of ['zh', 'ja', 'all_ja', 'en', 'zh-CN', 'ko', 'fr', 'unknown', undefined]) {
    const calls = [], adapter = createQwenAdapter({ fetch: fakeFetch(calls) })
    await adapter.synthesize({ config: { region: 'intl' } }, { key: 'fake' }, { ...spec, text, language, params: { voice: 'Bella', model: 'qwen3-tts-instruct-flash', moodInstruction:'语气开心、轻快' } // explicit voice style
 })
    assert.equal(new URL(calls[0].url).hostname, 'dashscope-intl.aliyuncs.com')
    const body = JSON.parse(calls[0].options.body)
    assert.equal(body.model, 'qwen3-tts-instruct-flash'); assert.equal(body.input.language_type, 'Auto')
    assert.equal(body.input.text, text)
    assert.equal(body.input.instructions, '语气开心、轻快')
  }
})

for (const [status, message] of [[401, /API Key 无效/], [403, /访问被拒绝/], [429, /频繁.*限额/], [500, /500/]]) {
  test('Qwen reports Chinese error for HTTP ' + status, async () => {
    let calls = 0
    const adapter = createQwenAdapter({ fetch: async () => { calls++; return new Response('', { status }) } })
    await assert.rejects(adapter.synthesize(provider, { key: 'fake' }, spec), message)
    assert.equal(calls, 1)
  })
}

// preserve safe categories through the native service and async job boundary.
test('Qwen billing, auth and rate errors survive synthesis without exposing response messages', async t => {
  const { createJobs } = await import('../src/jobs.js');
  for (const [status, code, expected] of [[403,'AllocationQuota.FreeTierOnly','QWEN_BILLING_REQUIRED'],[400,'Arrearage','QWEN_BILLING_REQUIRED'],[401,'InvalidApiKey','QWEN_AUTH_FAILED'],[429,'Throttling.RateQuota','QWEN_RATE_LIMITED'],[403,'AccessDenied','QWEN_ACCESS_DENIED']]) {
    const tts = createTts(), logs = [];
    const adapter = createQwenAdapter({fetch:async()=>Response.json({code,message:'private-key-and-dialogue',request_id:'private-request'},{status}),warn:line=>logs.push(line)});
    tts.registerProvider('test',{id:'qwen-test',kind:'qwen',revision:'test',capabilities:{serviceVoiceEngines:['qwen']},catalog:async()=>[{id:'qwen/bella',engine:'qwen',state:'ready',revision:'1',languages:['zh'],params:spec.params}],synthesize:input=>adapter.synthesize(provider,{key:'private-key'},{...spec,...input})});
    const grant = tts.grantServiceConsumer({principal:'user',scope:'card'});
    const jobs = createJobs({synthesize:(input,opts)=>tts.synthesize(input,opts),resolveGrant:()=>grant.grant,checkGrant:()=>{},ticket:()=>{throw Error('no audio on failure')}});
    t.after(async()=>{jobs.dispose();await tts.dispose()});
    const submitted = jobs.submit({voiceId:'qwen/bella',text:'hello',language:'zh'},{principal:'user',scope:'card'});
    let result;
    for (let i=0;i<20;i++) { await new Promise(resolve=>setImmediate(resolve)); result=jobs.poll(submitted.requestId,'user'); if(result.state!=='running')break; }
    assert.equal(result.state,'error'); assert.equal(result.error,expected); assert.equal(result.status,status);
    assert.equal(logs.length,1); assert.match(logs[0],new RegExp('HTTP '+status));
    assert.ok(logs[0].includes('code='+code));
    assert.doesNotMatch(JSON.stringify({result,logs}),/private/);
  }
});

test('Qwen production settings route diagnostics through the injected host logger', async t => {
  const tts=createTts(), logs=[];
  const settings={providers:[{id:'qwen',kind:'qwen',config:{region:'cn'}}]};
  const service=createServiceSettings({tts,get:()=>settings,credentials:()=>({resolve:async()=>({value:'private-key'})}),warn:message=>logs.push(message),fetch:async()=>Response.json({code:'AllocationQuota.FreeTierOnly',message:'private'},{status:403})});
  t.after(async()=>{service.dispose();await tts.dispose()});
  // a failed test is reported as data in plain words, not thrown.
  assert.deepEqual(await service.test({id:'qwen'}),{ok:false,status:'error',message:'通义千问配音额度或账户余额不足，请检查阿里云用量与账单',voiceCount:0,reachable:false,synthesisTested:false,credentialScope:'models'});
  assert.deepEqual(logs,['[dsh-tts:qwen] HTTP 403 phase=discovery code=AllocationQuota.FreeTierOnly category=QWEN_BILLING_REQUIRED']);
});

test('Qwen rejects HTTP-success error envelopes rather than reporting a missing audio URL', async () => {
  const adapter=createQwenAdapter({fetch:async()=>Response.json({code:'AllocationQuota.FreeTierOnly',message:'private'}),warn:()=>{}});
  await assert.rejects(adapter.synthesize(provider,{key:'fake'},spec),{code:'QWEN_BILLING_REQUIRED'});
});

test('Qwen connection failure and timeout are sanitized; timeout budget is 45 seconds', async () => {
  const timeout = AbortSignal.timeout, budgets = []
  AbortSignal.timeout = ms => { budgets.push(ms); return timeout(ms) }
  try {
    const adapter = createQwenAdapter({ fetch: async () => { throw Error('private upstream details') } })
    await assert.rejects(adapter.synthesize(provider, { key: 'fake' }, spec), /通义千问语音连接失败或请求超时/)
    assert.deepEqual(budgets, [45000])
  } finally { AbortSignal.timeout = timeout }
})

// official examples return signed http:// OSS URLs, so http is accepted (no key is sent there).
test('Qwen rejects absent, malformed, non-web and credential-bearing audio URLs before download', async () => {
  for (const url of [undefined, 'broken', 'file:///tmp/a.wav', 'https://user:pass@example.test/a.wav']) {
    let calls = 0
    const adapter = createQwenAdapter({ fetch: async () => { calls++; return Response.json({ output: { audio: { url } } }) } })
    await assert.rejects(adapter.synthesize(provider, { key: 'fake' }, spec), /音频地址/)
    assert.equal(calls, 1)
  }
})

test('Qwen download failures are not returned as audio', async () => {
  for (const status of [302, 404]) {
    const adapter = createQwenAdapter({ fetch: async url => url === audioUrl ? new Response('', { status }) : Response.json({ output: { audio: { url: audioUrl } } }) })
    await assert.rejects(adapter.synthesize(provider, { key: 'fake' }, spec), new RegExp(String(status)))
  }
})

test('Qwen config, field descriptors, preset validation, and scoped voice IDs', () => {
  assert.deepEqual(providerConfig('qwen'), { region: 'cn' })
  assert.deepEqual(providerConfig('qwen', { region: 'intl' }), { region: 'intl' })
  assert.throws(() => providerConfig('qwen', { region: 'invalid' }), /区域无效/)
  const fields = providerKind('qwen').fields
  assert.equal(fields[0].type, 'select'); assert.deepEqual(fields[0].options.map(v => v[0]), ['cn', 'intl'])
  assert.equal(fields[1].key, 'key'); assert.equal(fields[1].secret, true)
  assert.deepEqual(presetParams('qwen', { voice: 'Bella' }), { voice: 'Bella', model: 'qwen3-tts-flash' })
  assert.deepEqual(presetParams('qwen', { model: 'qwen3-tts-instruct-flash' }, { voice: 'Bella' }), { voice: 'Bella', model: 'qwen3-tts-instruct-flash' })
  for (const voice of ['', '1Bella', 'Bella/other', 'B'.repeat(42), ['Bella']]) assert.throws(() => presetParams('qwen', { voice }))
  for (const model of ['', 'other-tts', 'qwen3_TTS', 'qwen3/tts', 'qwen' + 'a'.repeat(61), ['qwen']]) assert.throws(() => presetParams('qwen', { voice: 'Bella', model }))
  // optional base style text (<= 200 chars); blank is dropped.
  assert.deepEqual(presetParams('qwen', { voice: 'Bella', instructions: ' 软糯 ' }), { voice: 'Bella', model: 'qwen3-tts-flash', instructions: '软糯' })
  assert.deepEqual(presetParams('qwen', { voice: 'Bella', instructions: '  ' }), { voice: 'Bella', model: 'qwen3-tts-flash' })
  for (const instructions of ['x'.repeat(201), 3, ['a']]) assert.throws(() => presetParams('qwen', { voice: 'Bella', instructions }))
  assert.throws(() => presetParams('qwen', { voice: 'Bella', style: 'joy' }))
  const voice = { schemaVersion: 1, id: 'qwen/bella', label: 'Bella', kind: 'qwen', enabled: true, languages: ['zh', 'fr'], params: { voice: 'Bella' } }
  assert.equal(portableVoice(voice).params.model, 'qwen3-tts-flash')
  assert.throws(() => portableVoice({ ...voice, params: { voice: 'bad/voice' } }), { code: 'INVALID_PARAMS' })
  assert.throws(() => portableVoice({ ...voice, modelRequirements: { id: 'm' } }), { code: 'INVALID_INPUT' })
  assert.throws(() => portableVoice({ ...voice, references: [{ sha256: 'a'.repeat(64), transcript: 'x', language: 'zh', file: 'default.wav' }] }), { code: 'REFERENCE_UNSUPPORTED' })
  assert.equal(voiceId('qwen/bella'), 'qwen/bella')
  for (const value of ['../bella', 'qwen//bella', '/qwen/bella', 'qwen/bella/']) assert.throws(() => voiceId(value))
  assert.throws(() => id('qwen/bella')) // Provider/source/scope IDs retain their existing contract.
})

test('builtin Bella stays searchable without configuration, resolves via credentials, synthesizes and goes offline on removal', async t => {
  const tts = createTts(), calls = [], stored = new Map()
  let settings = { providers: [] }
  const credentials = { resolve: async ref => stored.has(ref) ? { value: stored.get(ref) } : undefined, describe: async ref => ({ configured: stored.has(ref), writable: true }), set: async (ref, value) => stored.set(ref, value), unset: async ref => stored.delete(ref) }
  const service = createServiceSettings({ tts, get: () => settings, replace: async v => { settings = v }, credentials: () => credentials, fetch: fakeFetch(calls) })
  t.after(async () => { service.dispose(); await tts.dispose() })
  const grant = tts.grantServiceConsumer({ principal: 'user', scope: 'card' })
  const say = (language = 'zh') => tts.synthesize({ voiceId: 'qwen/bella', text: '你好', language, mood: 'joy' }, { grant: grant.grant, scope: 'card' })
  const find = async () => (await tts.listProviderCatalog()).find(v => v.id === 'qwen/bella')
  assert.equal((await find()).label, '萌宝（Qwen Bella）'); assert.equal((await find()).state, 'offline')
  // Mengbao keeps Bella's identity and uses the currently listed base model.
  assert.equal((await find()).params.model, 'qwen3-tts-flash')
  assert.deepEqual((await find()).languages, ['zh', 'en', 'fr', 'de', 'ru', 'it', 'es', 'pt', 'ja', 'ko'])
  await assert.rejects(say(), { code: 'SERVICE_OFFLINE' })
  await service.save({ id: 'qwen-main', kind: 'qwen', config: {} })
  assert.equal((await find()).state, 'ready')
  await tts.synthesize({voiceId:'qwen/bella',text:'keyless fixture',language:'zh'},{grant:grant.grant,scope:'card'})
  assert.equal(calls[0].options.headers.Authorization,undefined); calls.length = 0
  await service.save({ id: 'qwen-main', kind: 'qwen', config: {}, expectedRevision: (await service.list())[0].revision, secrets: { key: 'fake-key' } })
  assert.equal(stored.get('DSH_TAVERN_TTS_QWEN_MAIN_KEY'), 'fake-key')
  assert.equal(JSON.stringify(settings).includes('fake-key'), false)
  assert.equal((await find()).serviceId, 'qwen-main'); assert.equal((await find()).state, 'ready')
  // the test is the unbilled model listing GET, never a synthesis POST.
  assert.deepEqual(await service.test({ id: 'qwen-main' }), { ok: true, status: 'connected', voiceCount: qwenVoices().length, reachable: true, synthesisTested: false, credentialScope: 'models' })
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/models')
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined)
  assert.equal((await service.list())[0].check.status, 'connected'); assert.ok((await service.list())[0].check.voiceCount > 40)
  calls.length = 0
  const result = await say()
  assert.equal(result.mime, 'audio/wav'); assert.deepEqual(await tts.readAudio({ key: result.key, grant: grant.grant }), audio)
  for (const lang of ['fr', 'de', 'ru', 'it', 'es', 'pt', 'en', 'ja', 'ko']) await say(lang)
  assert.equal(calls.length, 20)
  stored.clear(); assert.equal((await find()).state, 'ready')
  service.dispose(); assert.equal((await find()).state, 'offline'); await assert.rejects(say(), { code: 'SERVICE_OFFLINE' })
})

test('multiple Qwen services remain ambiguous instead of selecting credentials silently', async t => {
  const tts = createTts()
  const settings = { providers: ['qwen-one', 'qwen-two'].map(id => ({ id, kind: 'qwen', config: { region: 'cn' } })) }
  const service = createServiceSettings({ tts, get: () => settings, credentials: () => ({ resolve: async () => ({ value: 'fake' }) }), fetch: async () => { throw Error('unexpected fetch') } })
  t.after(async () => { service.dispose(); await tts.dispose() }); service.sync()
  assert.equal((await tts.listServiceVoices()).filter(v => v.id === 'qwen/bella').length, 2)
  const { grant } = tts.grantServiceConsumer({ principal: 'user', scope: 'card' })
  await assert.rejects(tts.synthesize({ voiceId: 'qwen/bella', text: 'hello', language: 'en' }, { grant, scope: 'card' }), { code: 'SERVICE_REQUIRED' })
})

// service/preset task flow.
test('Qwen base style precedes the mood instruction and only reaches instruct models', async () => {
  const send = async params => { const calls = []; await createQwenAdapter({ fetch: fakeFetch(calls) }).synthesize(provider, { key: 'fake' }, { ...spec, params }); return JSON.parse(calls[0].options.body).input.instructions }
  assert.equal(await send({ voice: 'Bella', model: 'qwen3-tts-instruct-flash', instructions: '声音软糯', moodInstruction:'语气开心、轻快' }), '声音软糯；语气开心、轻快') // explicit voice-owned instructions
  assert.equal(await send({ voice: 'Bella', model: 'qwen3-tts-instruct-flash', instructions: '声音软糯', moods: { joy: null } }), '声音软糯')
  assert.equal(await send({ voice: 'Bella', model: 'qwen3-tts-flash', instructions: '声音软糯' }), undefined)
  const calm = []; await createQwenAdapter({ fetch: fakeFetch(calm) }).synthesize(provider, { key: 'fake' }, { ...spec, mood: 'calm', params: { voice: 'Bella', model: 'qwen3-tts-instruct-flash', instructions: '声音软糯' } })
  assert.equal(JSON.parse(calm[0].options.body).input.instructions, '声音软糯')
})

test('Qwen base voices are the documented system list; draft probe never synthesizes or echoes keys', async t => {
  const { voices, models, source } = await createQwenAdapter({ fetch: async () => { throw Error('no network') } }).voices()
  assert.equal(source, 'builtin'); assert.deepEqual(models, [{id:'qwen3-tts-flash',label:'Qwen3-TTS Flash',instruct:false}])
  const bella = voices.find(v => v.id === 'Bella')
  assert.equal(bella.label, '萌宝'); assert.equal(bella.instruct, true); assert.equal(bella.languages.length, 10)
  assert.equal(voices.find(v => v.id === 'Jennifer').instruct, false)
  for (const v of voices) assert.deepEqual(presetParams('qwen', { voice: v.id }).voice, v.id)
  assert.equal(new Set(voices.map(v => v.id)).size, voices.length)
  const tts = createTts(), calls = [], stored = new Map()
  let settings = { providers: [] }, status = 200
  const credentials = { resolve: async ref => stored.has(ref) ? { value: stored.get(ref) } : undefined, describe: async ref => ({ configured: stored.has(ref), writable: true }), set: async (ref, value) => stored.set(ref, value), unset: async ref => stored.delete(ref) }
  const fetch = async (url, options) => { calls.push({ url, options }); return new Response('{"data":[]}', { status }) }
  const service = createServiceSettings({ tts, get: () => settings, replace: async v => { settings = v }, credentials: () => credentials, fetch })
  t.after(async () => { service.dispose(); await tts.dispose() })
  const missing = await service.probe({ kind: 'qwen', config: { region: 'intl' } })
  assert.equal(missing.status, 'connected'); assert.ok(missing.voices.some(v => v.id === 'Bella')); assert.equal(calls.length, 1)
  assert.equal(calls[0].options.headers.Authorization,undefined); calls.length = 0
  const ok = await service.probe({ kind: 'qwen', config: { region: 'intl' }, secrets: { key: 'typed-key' } })
  assert.equal(ok.status, 'connected'); assert.equal(JSON.stringify(ok).includes('typed-key'), false)
  assert.equal(calls[0].url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models'); assert.equal(calls[0].options.headers.Authorization, 'Bearer typed-key')
  status = 401
  const denied = await service.probe({ kind: 'qwen', config: {}, secrets: { key: 'bad' } })
  assert.equal(denied.status, 'error'); assert.equal(denied.message, '通义千问 API Key 无效'); assert.equal('error' in denied, false)
  assert.equal((await service.probe({ kind: 'qwen', config: { region: 'mars' } })).status, 'invalid')
  assert.equal((await service.probe({ kind: 'reference', config: {} })).status, 'invalid')
  assert.equal(stored.size, 0); assert.equal(settings.providers.length, 0) // Probing never persists.
  await service.save({ id: 'qwen-main', kind: 'qwen', label: 'Qwen', config: {}, secrets: { key: 'saved-key' } })
  status = 200; calls.length = 0
  // A saved service reuses its stored key; the result becomes the row status.
  assert.equal((await service.probe({ id: 'qwen-main', kind: 'qwen', config: { region: 'cn' } })).status, 'connected')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer saved-key')
  assert.equal((await service.list())[0].check.status, 'connected')
  assert.equal((await service.voices({ id: 'qwen-main' })).voices.length, voices.length)
  status = 403; assert.match((await service.test({ id: 'qwen-main' })).message, /访问被拒绝/)
  assert.deepEqual([(await service.list())[0].check.status, (await service.list())[0].check.message], ['error', '通义千问配音访问被拒绝，请检查模型权限与账户状态'])
  assert.equal(calls.every(c => c.options.method === 'GET'), true)
  assert.equal(service.kinds().some(k => k.kind === 'reference'), false)
  assert.deepEqual(service.kinds().filter(k => k.paid).map(k => k.kind).sort(), ['azure', 'fish-audio', 'minimax', 'openai-compatible', 'qwen', 'volcengine'])
})
