// a streaming provider's line is playable from its first audio.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTts } from '../src/service.js'
import { pcmWav } from '../src/providers/audio.js'
import { createLiveAudio } from '../src/live-audio.js'
import { handleSynthesis } from '../src/routes.js'
import { createCache } from '../src/cache.js'
import { voiceLoudnessGain } from '../src/loudness.js'

const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r}); return {promise,resolve} }
const read = async stream => Buffer.concat(await Array.fromAsync(stream, chunk => Buffer.from(chunk)))

test('live audio replays every chunk from the start as float WAV, across odd chunk boundaries', async () => {
  const live = createLiveAudio()
  const first = live.stream()
  live.push(Buffer.from([0x00, 0x40, 0x00])); live.push(Buffer.from([0xC0]))
  const second = live.stream()
  live.end()
  for (const bytes of [await read(first), await read(second)]) {
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt16LE(20), 3); assert.equal(bytes.readUInt16LE(34), 32)
    assert.deepEqual([bytes.readFloatLE(44), bytes.readFloatLE(48)], [0.5, -0.5])
  }
  const failed = createLiveAudio(), cut = failed.stream()
  failed.push(Buffer.alloc(4)); failed.fail(new Error('cut'))
  await assert.rejects(read(cut), /cut/)
})

test('a streaming provider hands the job a live ticket before the line completes, then the complete line', async () => {
  const tts = createTts({profileId:'test'}), release = deferred(), started = deferred()
  tts.registerProvider('test',{id:'p',kind:'azure',revision:'r',capabilities:{voiceKinds:['reference'],paid:false,referenceInput:['bytes-v1'],stream:{sampleRate:44100}},
    health:async () => ({state:'ready'}),catalog:async () => [],
    synthesize:async (_input,{onPcm}) => { onPcm(Buffer.from([0x00,0x40])); started.resolve(); await release.promise; onPcm(Buffer.from([0x00,0xC0])); return pcmWav(Buffer.from([0x00,0x40,0x00,0xC0]),44100) }})
  const voice = {schemaVersion:1,id:'v',label:'Voice',enabled:true,kind:'azure',languages:['ja'],params:{voiceName:'ja-JP-NanamiNeural'}}
  tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[voice],bindings:{v:'p'},readReference:async () => Buffer.alloc(0)})
  const g = tts.grantConsumer({source:'card',principal:'dsh-browser',scope:'card'})
  const {requestId} = tts.jobs.submit({voice:{source:'card',id:'v'},text:'line',language:'ja'},{principal:'dsh-browser',scope:'card'})
  const status = query => handleSynthesis(new Request('http://localhost/synthesis/status?requestId='+requestId+query,{headers:{'sec-fetch-site':'same-origin'}}),tts.jobs).then(r => r.json())
  try {
    await started.promise
    const playable = await status('&wait=1&stream=1')
    assert.equal(playable.state,'running'); assert.equal(playable.stream.mime,'audio/wav')
    const live = await tts.redeemAudioTicket(playable.stream.ticket), body = read(live)
    release.resolve()
    const bytes = await body
    assert.deepEqual([bytes.readFloatLE(44), bytes.readFloatLE(48)], [0.5, -0.5])
    let done = await status('&wait=1')
    while (done.state === 'running') done = await status('&wait=1')
    assert.equal(done.state,'ready'); assert.equal(done.stream,undefined)
    assert.deepEqual(await tts.redeemAudioTicket(done.result.ticket),pcmWav(Buffer.from([0x00,0x40,0x00,0xC0]),44100))
    // Once the line is complete and cached, only the complete audio is issued.
    await assert.rejects(tts.createLiveTicket({key:done.result.key,grant:g.grant}),{code:'AUDIO_GONE'})
  } finally { await tts.dispose() }
})

test('a streamed line of a voice already measured carries that voice level for its first play', async () => {
  const measured = [voiceLoudnessGain(-24, -6), voiceLoudnessGain(-22, -4)]
  const tts = createTts({profileId:'test', cache:createCache({measureLoudness:async () => measured.shift()})})
  const releases = [deferred(), deferred()], started = [deferred(), deferred()]
  let line = 0
  tts.registerProvider('test',{id:'p',kind:'azure',revision:'r',capabilities:{paid:false,stream:{sampleRate:44100}},
    health:async () => ({state:'ready'}),catalog:async () => [],
    synthesize:async (_input,{onPcm}) => { const n = line++; onPcm(Buffer.from([0x00,0x40])); started[n].resolve(); await releases[n].promise; return pcmWav(Buffer.from([0x00,0x40,n,0]),44100) }})
  const voice = {schemaVersion:1,id:'v',label:'Voice',enabled:true,kind:'azure',languages:['ja'],params:{voiceName:'ja-JP-NanamiNeural'}}
  tts.registerVoiceSource({owner:'consumer',sourceId:'card',revision:'one',voices:[voice],bindings:{v:'p'},readReference:async () => Buffer.alloc(0)})
  tts.grantConsumer({source:'card',principal:'dsh-browser',scope:'card'})
  const submit = text => tts.jobs.submit({voice:{source:'card',id:'v'},text,language:'ja'},{principal:'dsh-browser',scope:'card'}).requestId
  try {
    const first = submit('first')
    await started[0].promise
    // Nothing of this voice is measured yet: the first play stays at the nominal level.
    assert.equal((await tts.jobs.wait(first,'dsh-browser',undefined,{stream:true})).stream.loudness, undefined)
    releases[0].resolve()
    while ((await tts.jobs.wait(first,'dsh-browser')).state === 'running');
    const second = submit('second')
    await started[1].promise
    const {stream} = await tts.jobs.wait(second,'dsh-browser',undefined,{stream:true})
    assert.equal(stream.loudness.gainDb, voiceLoudnessGain(-24, -6).gainDb)
    releases[1].resolve()
    while ((await tts.jobs.wait(second,'dsh-browser')).state === 'running');
    // The complete line brings its own measurement.
    assert.equal(tts.jobs.poll(second,'dsh-browser').result.loudness.gainDb, voiceLoudnessGain(-22, -4).gainDb)
  } finally { await tts.dispose() }
})