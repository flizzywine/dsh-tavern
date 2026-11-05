// official provider samples are cached once, same-origin, and only for listed voices.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSampleCache } from '../src/sample-cache.js'
import { createServiceSettings } from '../src/settings.js'
import { handleSample } from '../src/routes.js'
import { providerConfig } from '../src/providers/params.js'

const temp = async t => { const dir = await mkdtemp(join(tmpdir(), 'dsh-tts-samples-')); t.after(() => rm(dir, { recursive:true, force:true })); return dir }
const clip = (size = 64) => new Response(Buffer.alloc(size, 1), { headers:{ 'content-type':'audio/mpeg' } })
const level = { version:1, gain:.7 }

test('only a sample the service discovery listed is downloaded; a second play is a cache hit with no network', async t => {
  const dataDir = await temp(t), calls = []
  const samples = createSampleCache({ dataDir, fetch:async url => { calls.push(url); return clip() }, measureLoudness:async () => { calls.push('measure'); return level } })
  const services = createServiceSettings({ samples, get:() => ({ providers:[{ id:'fish', kind:'fish-audio', config:providerConfig('fish-audio', {}) }] }),
    credentials:() => ({ resolve:async () => ({ value:'test-key' }) }),
    fetch:async url => { calls.push(url); return Response.json({ _id:'listed', title:'Listed', type:'tts', state:'trained', visibility:'public', languages:['ja'],
      samples:[{ audio:'https://cdn.example/task/listed.mp3?X-Amz-Signature=' + calls.length }] }) } })
  t.after(() => services.dispose())
  await assert.rejects(services.fishSample({ serviceId:'fish', voiceId:'listed' }), { code:'SAMPLE_UNAVAILABLE' })
  await assert.rejects(services.fishSample({ serviceId:'fish', voiceId:'https://evil.example/x.mp3' }), { code:'SAMPLE_UNAVAILABLE' })
  assert.deepEqual(calls, [], 'nothing unlisted touches the network')
  await services.validateFishVoice({ serviceId:'fish', voiceId:'listed' })
  const first = await services.fishSample({ serviceId:'fish', voiceId:'listed' })
  assert.match(first.url, /^\/api\/dsh-tts\/v1\/sample\?key=[a-f0-9]{40}$/); assert.equal(first.loudness.gain, 1)
  assert.equal(calls.length, 2)
  // A new listing re-signs the URL; the clip is the same identity and answers from the cache.
  await services.validateFishVoice({ serviceId:'fish', voiceId:'listed' })
  const before = calls.length, second = await services.fishSample({ serviceId:'fish', voiceId:'listed' })
  assert.deepEqual(second, first); assert.equal(calls.length, before, 'cache hit: no download, no measurement')
  const key = first.url.split('=')[1], request = (k, site = 'same-origin') => new Request('http://dsh.internal/api/dsh-tts/v1/sample?key=' + k, { headers:{ 'sec-fetch-site':site } })
  const served = await handleSample(request(key), samples)
  assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'audio/mpeg'); assert.equal((await served.arrayBuffer()).byteLength, 64)
  assert.equal((await handleSample(request(key, 'cross-site'), samples)).status, 403)
  assert.equal((await handleSample(request('../../readings'), samples)).status, 404)
  assert.equal((await handleSample(request('b'.repeat(40)), samples)).status, 404)
})

test('clips over the size limit are refused and the cache keeps under its total limit', async t => {
  const dataDir = await temp(t); let clock = 0
  const samples = createSampleCache({ dataDir, now:() => ++clock, maxClipBytes:100, maxBytes:150, fetch:async url => clip(url.includes('big') ? 101 : 60), measureLoudness:async () => level })
  await assert.rejects(samples.clip({ provider:'fish-audio', voiceId:'big', url:'https://cdn.example/big.mp3' }), { code:'SAMPLE_TOO_LARGE' })
  await assert.rejects(samples.clip({ provider:'fish-audio', voiceId:'plain', url:'http://cdn.example/a.mp3' }), { code:'SAMPLE_UNAVAILABLE' })
  const a = await samples.clip({ provider:'fish-audio', voiceId:'a', url:'https://cdn.example/a.mp3' })
  await samples.clip({ provider:'fish-audio', voiceId:'b', url:'https://cdn.example/b.mp3' })
  await samples.clip({ provider:'fish-audio', voiceId:'c', url:'https://cdn.example/c.mp3' })
  const files = await readdir(join(dataDir, 'cache', 'samples-v1'))
  assert.equal(files.length, 4, 'two clips (mp3 + json) fit in 150 bytes')
  assert.ok(!files.some(name => name.startsWith(a.key)), 'the oldest clip left first')
  await assert.rejects(samples.read(a.key), { code:'SAMPLE_UNAVAILABLE' })
})
