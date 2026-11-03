import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { qwenWav } from '../src/providers/qwen-audio.js'
import { pcmWav } from '../src/providers/audio.js'
import { wav, durationMs } from '../src/core.js'
import { createTts } from '../src/service.js'
import { createServiceSettings } from '../src/settings.js'

// Only the 44-byte header was captured; all samples in these tests are synthetic silence.
const header = Buffer.from(readFileSync(new URL('./fixtures/qwen-flash-bella-header.hex', import.meta.url), 'utf8').trim(), 'hex')
const stream = () => Buffer.concat([header, Buffer.alloc(4800)])
const invalid = bytes => assert.throws(() => qwenWav(bytes), {code:'INVALID_AUDIO'})

test('captured Qwen flash/Bella streaming header becomes a strict, duration-readable PCM WAV', () => {
  assert.equal(header.length, 44)
  const input = stream(), original = Buffer.from(input)
  assert.throws(() => wav(input), {code:'INVALID_AUDIO'})
  const result = qwenWav(input)
  assert.deepEqual(result, pcmWav(Buffer.alloc(4800), 24000))
  assert.deepEqual(wav(result), result)
  assert.equal(durationMs(result), 100)
  assert.deepEqual(input, original)
  assert.deepEqual(result.subarray(44), input.subarray(44))
  assert.deepEqual(qwenWav(result), result)
})

test('Qwen normalization walks padded metadata chunks instead of assuming a 44-byte header', () => {
  const metadata = Buffer.from('4a554e4b0300000061626300', 'hex')
  const input = Buffer.concat([header.subarray(0,36), metadata, header.subarray(36), Buffer.alloc(4800)])
  const output = qwenWav(input)
  assert.equal(output.readUInt32LE(4), output.length - 8)
  assert.equal(output.readUInt32LE(52), 4800)
  assert.deepEqual(output.subarray(36,48), metadata)
  assert.equal(durationMs(output), 100)
})

test('only the observed paired sentinel is repaired; finite truncation and malformed WAV stay invalid', () => {
  for (const offset of [4,40]) {
    const input = stream(); input.writeUInt32LE(123456, offset); invalid(input)
  }
  for (const offset of [0,8]) { const input = stream(); input.write('BAD!', offset); invalid(input) }
  for (const [offset,value] of [[20,3],[22,0],[22,3],[32,4],[34,8]]) {
    const input = stream(); input.writeUInt16LE(value,offset); invalid(input)
  }
  for (const [offset,value] of [[16,15],[16,0xffffffff],[24,7999],[24,192001],[28,1]]) {
    const input = stream(); input.writeUInt32LE(value,offset); invalid(input)
  }
  invalid(header)
  invalid(stream().subarray(0,-1))
  invalid(pcmWav(Buffer.alloc(4800)).subarray(0,-2))
  invalid(Buffer.from('<html>download failed</html>'))
  invalid(Buffer.alloc(32 * 1024 ** 2 + 1))
  // No format, duplicate format, or finite data under an unknown RIFF length.
  invalid(Buffer.concat([header.subarray(0,12),header.subarray(36),Buffer.alloc(4800)]))
  invalid(Buffer.concat([header.subarray(0,36),header.subarray(12,36),header.subarray(36),Buffer.alloc(4800)]))
  const finiteData = stream(); finiteData.writeUInt32LE(4800,40); invalid(finiteData)
})

test('ordinary mono/stereo PCM16 WAV keeps its sample rate and bytes unchanged', () => {
  for (const rate of [8000,24000,48000,192000]) {
    const mono = pcmWav(Buffer.alloc(4800),rate)
    assert.deepEqual(qwenWav(mono),mono)
    const stereo = Buffer.from(mono)
    stereo.writeUInt16LE(2,22); stereo.writeUInt32LE(rate*4,28); stereo.writeUInt16LE(4,32)
    assert.deepEqual(qwenWav(stereo),stereo)
  }
})

test('Qwen adapter through production settings and core stores playable normalized audio', async t => {
  const tts = createTts(), calls = []
  const settings = createServiceSettings({tts,get:()=>({providers:[{id:'qwen',kind:'qwen',config:{region:'cn'}}]}),
    credentials:()=>({resolve:async()=>({value:'fake'})}),
    fetch:async (url,options)=>{
      calls.push({url,options})
      return calls.length === 1 ? Response.json({output:{audio:{url:'https://audio.example.test/qwen.wav'}}}) : new Response(stream(),{headers:{'content-type':'audio/x-wav'}})
    }})
  t.after(async()=>{settings.dispose();await tts.dispose()})
  settings.sync()
  const {grant} = tts.grantServiceConsumer({principal:'user',scope:'preview'})
  const result = await tts.synthesize({voiceId:'qwen/bella',text:'Hello.',language:'en'},{grant,scope:'preview'})
  const audio = await tts.readAudio({key:result.key,grant})
  assert.equal(result.mime,'audio/wav')
  assert.deepEqual(audio,pcmWav(Buffer.alloc(4800),24000))
  assert.equal(durationMs(audio),100)
  assert.equal(calls.length,2)
  assert.equal(calls[1].options.headers,undefined)
  assert.equal(calls[1].options.redirect,'error')
})
