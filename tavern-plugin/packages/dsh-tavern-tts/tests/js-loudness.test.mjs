import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measureVoiceLoudness } from '../src/loudness.js'
import { createCache } from '../src/cache.js'
import { createSampleCache } from '../src/sample-cache.js'
import { createTts } from '../src/service.js'
import { pcmWav } from '../src/providers/audio.js'

const fixtures = new URL('./fixtures/loudness/', import.meta.url)
test('speech PCM16 fixtures agree with ffmpeg loudnorm within 0.5 LU / dB', async () => {
  const rows = JSON.parse(await readFile(new URL('reference.json', fixtures), 'utf8'))
  for (const row of rows) {
    const result = measureVoiceLoudness(await readFile(new URL(row.file, fixtures)))
    assert.ok(Math.abs(result.lufs - row.ffmpegI) <= 0.5, row.file + ' LUFS')
    assert.ok(Math.abs(result.truePeak - row.ffmpegTP) <= 0.5, row.file + ' dBTP')
  }
})
test('stereo sums channel energies and takes the largest channel true peak', () => {
  const pcm = Buffer.alloc(32000 * 2)
  for (let i = 0; i < 32000; i++) pcm.writeInt16LE(Math.round(10000 * Math.sin(i * 0.13)), i * 2)
  const mono = measureVoiceLoudness(pcmWav(pcm, 32000)), interleaved = Buffer.alloc(pcm.length * 2)
  for (let i = 0; i < 32000; i++) { interleaved.writeInt16LE(pcm.readInt16LE(i * 2), i * 4); interleaved.writeInt16LE(pcm.readInt16LE(i * 2), i * 4 + 2) }
  const audio = pcmWav(interleaved, 32000)
  audio.writeUInt16LE(2,22); audio.writeUInt32LE(128000,28); audio.writeUInt16LE(4,32)
  const stereo = measureVoiceLoudness(audio)
  assert.ok(Math.abs(stereo.lufs - mono.lufs - 10 * Math.log10(2)) < 0.001)
  assert.equal(stereo.truePeak, mono.truePeak)
})
test('no ffmpeg on PATH: synthesis, cached playback, PCM and compressed samples succeed', async t => {
  const path = process.env.PATH
  process.env.PATH = ''
  t.after(() => { process.env.PATH = path })
  const dataDir = await mkdtemp(join(tmpdir(), 'tts-no-ffmpeg-'))
  t.after(() => rm(dataDir, {recursive:true, force:true}))
  const audio = await readFile(new URL('speech-16000-0.wav', fixtures))
  const tts = createTts({profileId:'test', dataDir})
  t.after(() => tts.dispose())
  let calls = 0
  tts.registerProvider('test',{id:'p',kind:'azure',revision:'one',capabilities:{paid:false},synthesize:async () => { calls++; return audio }})
  tts.registerVoiceSource({owner:'test',sourceId:'card',revision:'one',voices:[{schemaVersion:1,id:'v',label:'Voice',enabled:true,kind:'azure',languages:['en'],params:{voiceName:'en-US-JennyNeural'}}],bindings:{v:'p'}})
  const grant = tts.grantConsumer({source:'card',principal:'user',scope:'card'})
  const input = {voice:{source:'card',id:'v'},text:'Hello.',language:'en'}
  const options = {grant:grant.grant,scope:'card'}
  const first = await tts.synthesize(input,options)
  assert.ok(Number.isFinite(first.loudness.lufs))
  assert.equal((await tts.synthesize(input,options)).cacheHit,true)
  assert.equal(calls,1)
  assert.deepEqual((await tts.readCached(input,options)).audio,audio)
  for (const mime of ['audio/wav','audio/mpeg','audio/ogg','audio/aac','audio/flac']) {
    const samples = createSampleCache({dataDir,fetch:async () => new Response(audio,{headers:{'content-type':mime}})})
    const clip = await samples.clip({provider:'test',voiceId:mime,url:'https://example.test/'+mime})
    assert.deepEqual((await samples.read(clip.key)).bytes,audio)
    if (mime === 'audio/wav') assert.ok(Number.isFinite(clip.loudness.lufs))
    else assert.equal(clip.loudness.gain,1)
  }
  const cache = createCache({measureLoudness:async () => { throw new Error('measurement failed') }})
  const key = 'b'.repeat(64)
  await cache.put(key,audio,['test'])
  assert.deepEqual(await cache.get(key),audio)
  assert.equal((await cache.loudness(key)).gain,1)
})
