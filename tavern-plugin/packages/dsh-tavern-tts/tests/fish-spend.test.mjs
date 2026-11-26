import test from 'node:test'
import assert from 'node:assert/strict'
import { createFishAudioAdapter } from '../src/providers/fish-audio.js'
import { fishPricePerMillionBytes } from '../src/providers/fish-models.js'

const cloud = {kind:'fish-audio',config:{url:'https://api.fish.audio'}}
const speak = (adapter, model, text = '你好') => adapter.synthesize(cloud, {key:'k'}, {text, textPrepared:true, references:[{bytes:Buffer.from('ref'), promptText:'x'}], params:{model}})
const pcmResponse = () => new Response(new Uint8Array(8), {status:200})

test('a paid Fish cloud line asks the spend guard first and a refusal keeps its code without a request', async () => {
  const checks = []
  let requests = 0
  const adapter = createFishAudioAdapter({
    fetch: async () => { requests++; return pcmResponse() },
    loadSpend: async () => ({ async check(request) { checks.push(request); throw Object.assign(new Error('over the limit'), {code:'API_SPEND_DAILY_LIMIT'}) } })
  })
  await assert.rejects(speak(adapter, 's2-pro', 'abc'), {code:'API_SPEND_DAILY_LIMIT'})
  assert.equal(requests, 0)
  assert.deepEqual(checks, [{category:'other', purpose:'Fish 云端朗读', estimatedUsd:Math.ceil(3 * 15) / 1e6}])
})

test('a free Fish cloud model asks no guard, and a paid one without a guard speaks', async () => {
  let asked = 0, requests = 0
  const fetch = async () => { requests++; return pcmResponse() }
  await speak(createFishAudioAdapter({fetch, loadSpend: async () => { asked++; return null }}), 's2.1-pro-free')
  await speak(createFishAudioAdapter({fetch, loadSpend: async () => null}), 's2-pro')
  assert.equal(asked, 0)
  assert.equal(requests, 2)
})

test('Fish prices per million bytes, with the Drama 3 launch price until its end date', () => {
  assert.equal(fishPricePerMillionBytes('s2-pro'), 15)
  assert.equal(fishPricePerMillionBytes('s2.1-pro-free'), 0)
  assert.equal(fishPricePerMillionBytes('drama-3', Date.parse('2026-11-30T00:00:00Z')), 10)
  assert.equal(fishPricePerMillionBytes('drama-3', Date.parse('2026-12-02T00:00:00Z')), 50)
  assert.equal(fishPricePerMillionBytes('unknown'), undefined)
})
