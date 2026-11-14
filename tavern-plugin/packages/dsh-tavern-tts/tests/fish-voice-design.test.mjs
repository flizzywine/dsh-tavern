import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, readdir, realpath, symlink, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createVoicePilot, validatePilot, outputPath, preparePilotAudio, decodePilotAudio, maxAudioBytes} from '../src/providers/fish-voice-design.js'
import {createServiceSettings} from '../src/settings.js'
import {pcmWav} from '../src/providers/audio.js'
import {credentialRef} from '../src/providers/params.js'
import {handleControl} from '../src/routes.js'

const key = 'private-test-secret-never-in-receipt'
const provider = {id:'fish-test',kind:'fish-audio',config:{url:'https://api.fish.audio'}}
const plan = () => ({language:'zh',characters:[{id:'ernie',instruction:'清晰温柔的中文女声',reference_text:'你好，今天也请多多关照。',n:2}],maxCostUsd:0.5})
const args = (out, extra = {}) => ({action:'design',serviceId:provider.id,plan:plan(),confirm:true,...extra})
// Synthetic PCM WAV exercises receipt handling only; F3's encoding is not established.
const audio = pcmWav(Buffer.alloc(8820),44100)
const success = () => Response.json({candidates:[0,1].map(index => ({id:'candidate-' + index,index:7-index,text:index === 0 ? '实际返回的中文文本。' : '',audio_base64:audio.toString('base64'),sample_rate:44100,duration_ms:100}))},{headers:{'x-request-id':'request-test'}})
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(),'voice-pilot-')), root = join(base,'output')
  await mkdir(root); t.after(() => rm(base,{recursive:true,force:true})); return {base,root}
}

test('design exact Chinese Fish request and redacted receipt; successful request costs one cent regardless of candidates', async t => {
  const {root} = await fixture(t); let calls = 0
  const run = createVoicePilot({budgetRoot:root,fetch:async (url,init) => {
    calls++; assert.equal(url,'https://api.fish.audio/v1/voice-design'); assert.equal(init.redirect,'error')
    assert.equal(init.headers.model,'voice-design-1'); assert.equal(init.headers.Authorization,'Bearer ' + key)
    assert.deepEqual(JSON.parse(init.body),{instruction:plan().characters[0].instruction,reference_text:plan().characters[0].reference_text,language:'zh',n:2})
    return success()
  }})
  const result = await run(args('design'),provider,async () => key)
  assert.equal(calls,1); assert.equal(result.receipt.requests[0].estimatedCostUsd,0.01)
  assert.equal(result.receipt.requests[0].outcome,'success'); assert.equal(result.receipt.requests[0].audio.length,2)
  const entry = result.receipt.requests[0]
  assert.equal(entry.instruction,plan().characters[0].instruction)
  assert.equal(entry.reference_text,plan().characters[0].reference_text)
  assert.equal(Object.hasOwn(entry,'text'),false)
  assert.deepEqual(entry.audio.map(c => [c.candidateId,c.candidateIndex,c.text,c.transcriptStatus]),[['candidate-0',7,'实际返回的中文文本。','provider_supplied'],['candidate-1',6,'','not_provided']])
  assert.equal(result.complete,true); assert.equal(result.receipt.stopReason,null)
  assert.equal(entry.requestId,'request-test')
  assert.deepEqual(Buffer.from(entry.audio[0].audioBase64,'base64'),audio)
  const receipt = await readFile(result.receipt.receiptFile,'utf8')
  assert.equal(receipt.includes('audioBase64'),false)
  assert.deepEqual(await readdir(root),['voice-pilot-budget.json','voice-pilot-receipts'])
  assert.equal(receipt.includes(key),false)
  assert.equal(JSON.parse(await readFile(join(root,'voice-pilot-budget.json'),'utf8')).reserved,10000000)
})

test('only Fish cloud, zh and approved fields; saved service shares secrets(p): stored key wins, env key is the fallback', async t => {
  const {root} = await fixture(t); let calls = 0, resolves = 0
  const authorization = [], storedKey = 'private-test-stored-secret-never-in-receipt'
  const fetch = async (url,init) => { calls++; authorization.push(init.headers.Authorization); return success() }
  const run = createVoicePilot({budgetRoot:root,fetch})
  for (const kind of ['minimax','qwen','openai-compatible']) await assert.rejects(run(args('denied'),{...provider,kind},async () => key),{code:'INVALID_PROVIDER'})
  await assert.rejects(run(args('denied'),{...provider,config:{url:'http://127.0.0.1:9884'}},async () => key),{code:'INVALID_PROVIDER'})
  for (const field of ['key','url','provider']) await assert.rejects(run(args('denied',{[field]:'override'}),provider,async () => key),{code:'INVALID_INPUT'})
  for (const language of ['ja','en']) await assert.rejects(run(args('denied',{plan:{...plan(),language}}),provider,async () => key),{code:'INVALID_INPUT'})
  const extra = plan(); extra.characters[0].seed = 1
  await assert.rejects(run(args('denied',{plan:extra}),provider,async () => key),{code:'INVALID_INPUT'})
  const previous = process.env.FISH_AUDIO_API_KEY; process.env.FISH_AUDIO_API_KEY = key
  t.after(() => { if (previous === undefined) delete process.env.FISH_AUDIO_API_KEY; else process.env.FISH_AUDIO_API_KEY = previous })
  let stored
  const services = createServiceSettings({tts:{},get:() => ({providers:[provider]}),credentials:() => ({resolve:async ref => {resolves++; assert.deepEqual(ref,credentialRef(provider.id,'key')); return stored}}),fetch,pilotBudgetRoot:root})
  // No stored credential: the saved service falls back to FISH_AUDIO_API_KEY, as every other Fish path does.
  assert.equal((await services.voicePilot(args('env'))).receipt.requests[0].outcome,'success')
  assert.equal(resolves,1); assert.equal(calls,1); assert.equal(authorization.at(-1),'Bearer ' + key)
  // A stored credential wins over the environment key.
  stored = {value:storedKey}
  assert.equal((await services.voicePilot(args('stored'))).receipt.requests[0].outcome,'success')
  assert.equal(resolves,2); assert.equal(calls,2); assert.equal(authorization.at(-1),'Bearer ' + storedKey)
  // Neither source: refused before any request.
  stored = undefined; delete process.env.FISH_AUDIO_API_KEY
  await assert.rejects(services.voicePilot(args('denied')),{code:'CREDENTIALS_REQUIRED'})
  assert.equal(resolves,3); assert.equal(calls,2)
})

test('cumulative budget refuses exceeding request before fetch; final UTF-8 bytes determine TTS price', async t => {
  const {root} = await fixture(t); let calls = 0
  await writeFile(join(root,'reference.wav'),audio)
  await writeFile(join(root,'voice-pilot-budget.json'),JSON.stringify({reserved:490000000}))
  const run = createVoicePilot({budgetRoot:root,fetch:async () => {calls++; return success()}})
  await run(args('last'),provider,async () => key)
  assert.equal((await run(args('over'),provider,async () => key)).receipt.stopReason,'BUDGET_EXCEEDED'); assert.equal(calls,1)
  const text = '[温柔] 你好，世界！'
  const pilot = {language:'zh',model:'s2.1-pro',maxCostUsd:0.5,rows:[{id:'line',text,reference:{file:'samples/reference.wav',text:'你好。',audioBase64:audio.toString('base64')}}]}
  const prepared = validatePilot('pilot',pilot)
  assert.equal(prepared.requests[0].textUtf8Bytes,Buffer.byteLength(text)); assert.equal(prepared.requests[0].cost,Buffer.byteLength(text)*15000)
  assert.notEqual(Buffer.byteLength(text),text.length)
  await writeFile(join(root,'voice-pilot-budget.json'),JSON.stringify({reserved:0}))
  const tts = createVoicePilot({budgetRoot:root,fetch:async (url,init) => {
    calls++; assert.equal(url,'https://api.fish.audio/v1/tts'); assert.equal(init.headers.model,'s2.1-pro')
    assert.equal(init.headers['Content-Type'],'application/msgpack'); assert.ok(Buffer.from(init.body).includes(Buffer.from(text)))
    return new Response(Buffer.alloc(8820))
  }})
  const result = await tts(args('pilot',{action:'pilot',plan:pilot}),provider,async () => key)
  assert.equal(result.receipt.requests[0].outcome,'success')
  assert.equal(result.receipt.requests[0].estimatedCostUsd,Buffer.byteLength(text)*15/1000000)
  assert.equal(result.receipt.requests[0].audio[0].durationMs,100)
  assert.deepEqual(result.receipt.requests[0].reference,{file:'samples/reference.wav',text:pilot.rows[0].reference.text})
})

test('network rejection and timeout remain unknown, reserve cost and never retry; known error releases reservation', async t => {
  const {root} = await fixture(t); let calls = 0
  for (const [index,error] of [new Error(key),new DOMException(key,'TimeoutError')].entries()) {
    const run = createVoicePilot({budgetRoot:root,fetch:async () => {calls++; throw error}})
    const result = await run(args('unknown-' + index),provider,async () => key)
    assert.equal(result.receipt.requests[0].outcome,'unknown'); assert.equal(result.receipt.requests[0].unknownCostUsd,0.01)
    assert.equal(result.receipt.requests[0].estimatedCostUsd,null); assert.equal(JSON.stringify(result).includes(key),false)
  }
  assert.equal(calls,2)
  assert.equal(JSON.parse(await readFile(join(root,'voice-pilot-budget.json'),'utf8')).reserved,20000000)
  const run = createVoicePilot({budgetRoot:root,fetch:async () => {calls++; return new Response('',{status:402})}})
  const result = await run(args('billing'),provider,async () => key)
  assert.equal(result.receipt.requests[0].code,'FISH_BILLING_REQUIRED'); assert.equal(result.receipt.requests[0].outcome,'error')
  assert.equal(JSON.parse(await readFile(join(root,'voice-pilot-budget.json'),'utf8')).reserved,20000000)
  assert.equal(calls,3)
})

test('deadline and failed requests persist all unattempted plan rows before fetch and after stopping', async t => {
  const {root} = await fixture(t)
  for (const mode of ['deadline','error','unknown']) {
    let clock = 0, calls = 0
    const p = plan(); p.characters.push({...p.characters[0],id:'minimax'})
    const run = createVoicePilot({budgetRoot:root,now:() => clock,fetch:async () => {
      calls++
      const receiptFiles = await readdir(join(root,'voice-pilot-receipts'))
      const receipts = await Promise.all(receiptFiles.map(f => readFile(join(root,'voice-pilot-receipts',f),'utf8').then(JSON.parse)))
      const saved = receipts.find(r => r.stopReason === 'in_progress')
      assert.equal(saved.complete,false); assert.equal(saved.plannedRequests,2)
      assert.deepEqual(saved.requests.map(r => [r.id,r.outcome]),[['ernie','unknown'],['minimax','not_attempted']])
      if (mode === 'error') return new Response('',{status:402})
      if (mode === 'unknown') throw new Error('lost reply')
      clock = 110001
      return success()
    }})
    const result = await run(args(mode,{plan:p}),provider,async () => key)
    assert.equal(calls,1); assert.equal(result.complete,false)
    assert.equal(result.status,mode === 'unknown' ? 'unknown' : 'partial')
    const saved = JSON.parse(await readFile(result.receipt.receiptFile,'utf8'))
    assert.deepEqual(saved,JSON.parse(JSON.stringify(result.receipt,(k,v) => k === 'audioBase64' ? undefined : v)))
    assert.equal(saved.stopReason,{deadline:'deadline',error:'FISH_BILLING_REQUIRED',unknown:'OUTCOME_UNKNOWN'}[mode])
    assert.equal(saved.requests[1].outcome,'not_attempted')
    assert.equal(saved.requests[1].unknownCostUsd,0)
  }
})

test('explicit host storage keeps budget independent of output location and refuses absent storage', async t => {
  const {base,root} = await fixture(t)
  const storage = join(base,'host-data'); await mkdir(storage)
  await writeFile(join(storage,'voice-pilot-budget.json'),JSON.stringify({reserved:500000000}))
  const run = createVoicePilot({budgetRoot:storage,fetch:async () => assert.fail('budget must block')})
  const blocked = await run(args('blocked'),provider,async () => key)
  assert.equal(blocked.status,'partial'); assert.equal(blocked.receipt.stopReason,'BUDGET_EXCEEDED')
  assert.equal(blocked.receipt.requests[0].outcome,'not_attempted')
  assert.deepEqual(JSON.parse(await readFile(blocked.receipt.receiptFile,'utf8')),blocked.receipt)
  await assert.rejects(createVoicePilot()(args('blocked'),provider,async () => key),{code:'PILOT_STORAGE_UNAVAILABLE'})
})

test('audio probing records source format before a single optional local conversion', async t => {
  const {root} = await fixture(t)
  for (const convert of [false,true]) {
    const source = join(root,`${convert}.source`), target = join(root,`${convert}.wav`)
    const bytes = convert ? Buffer.from('mock compressed audio') : audio
    await writeFile(source,bytes)
    const calls = []; let recorded
    const result = await preparePilotAudio({source,target,bytes,recordProbe:async probe => {recorded = probe},run:async (command,args,options) => {
      calls.push(command); assert.equal(options.windowsHide,true); assert.equal(options.timeout,30000)
      if (command === 'ffprobe') {
        assert.equal(args.at(-1),source)
        return {stdout:JSON.stringify({format:{format_name:convert ? 'mp3' : 'wav',duration:'0.1'},streams:[{codec_name:convert ? 'mp3' : 'pcm_s16le',sample_rate:'44100',channels:1}]})}
      }
      assert.ok(recorded); assert.equal(command,'ffmpeg'); assert.ok(args.includes('pcm_s16le')); assert.ok(args.includes('-n'))
      await writeFile(target,audio); return {stdout:''}
    }})
    assert.deepEqual(calls,convert ? ['ffprobe','ffmpeg'] : ['ffprobe'])
    assert.equal(result.transcoded,convert); assert.equal(result.durationMs,100)
    assert.equal(recorded.format,convert ? 'mp3' : 'wav'); assert.equal(recorded.sampleRate,44100)
    assert.deepEqual(await readFile(target),audio)
  }
})

test('base64 size boundary and oversized provider response preserve unknown reservation', async t => {
  assert.equal(decodePilotAudio(Buffer.alloc(maxAudioBytes).toString('base64')).length,maxAudioBytes)
  const oversized = Buffer.alloc(maxAudioBytes + 1).toString('base64')
  assert.throws(() => decodePilotAudio(oversized),{code:'AUDIO_TOO_LARGE'})
  const {root} = await fixture(t); let calls = 0
  const run = createVoicePilot({budgetRoot:root,fetch:async () => {
    calls++
    const response = await success().json(); response.candidates[0].audio_base64 = oversized
    return Response.json(response)
  }})
  const result = await run(args('large'),provider,async () => key)
  assert.equal(calls,1); assert.equal(result.status,'unknown')
  assert.equal(result.receipt.stopReason,'AUDIO_TOO_LARGE')
  assert.ok(result.receipt.requests[0].nextAction)
  assert.equal(result.receipt.requests[0].unknownCostUsd,0.01)
})


test('voice pilot control rejects cross-origin requests and dry-run never resolves credentials or fetches', async t => {
  const {root} = await fixture(t)
  const services = createServiceSettings({tts:{},get:() => ({providers:[provider]}),
    credentials:() => assert.fail('dry-run must not access credentials'),
    fetch:async () => assert.fail('dry-run must not fetch'),pilotBudgetRoot:root})
  const input = args('preview',{confirm:false,dryRun:true})
  const request = origin => new Request('http://localhost/api/dsh-tts/v1/control', {
    method:'POST',headers:{'Content-Type':'application/json',Origin:origin},
    body:JSON.stringify({method:'voicePilot',args:input})})
  const dispatch = (method, input) => { assert.equal(method,'voicePilot'); return services.voicePilot(input) }
  assert.equal((await handleControl(request('https://example.org'),dispatch)).status,403)
  const response = await handleControl(request('http://localhost'),dispatch)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{dryRun:true,model:'voice-design-1',requests:1,estimatedCostUsd:0.01,cumulativeReservedUsd:0})
  assert.deepEqual(await readdir(root),[])
})
