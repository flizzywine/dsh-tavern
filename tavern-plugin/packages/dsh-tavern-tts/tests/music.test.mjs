// 音乐生成 (music.js): the 'musicGeneration' service other plugins ask for a track.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMusicGeneration } from '../src/music.js'

const lyria = {id:'music', kind:'lyria', label:'Lyria', config:{url:'https://gateway.example/gemini', model:'lyria-3.5'}}
const track = Response.json({candidates:[{content:{parts:[{text:'ok'}, {inlineData:{mimeType:'audio/mpeg', data:'AQI='}}]}}]})

test('the first music service with a key generates through the official route', async () => {
  const requests = []
  const music = createMusicGeneration({providers:() => [{id:'voice', kind:'azure', config:{}}, {...lyria, id:'no-key'}, lyria],
    key:async p => p.id === 'music' ? 'test-key' : undefined, loadSpend:async () => null,
    fetch:async (url, init) => (requests.push({url, init}), track.clone())})
  assert.equal(await music.available(), true)
  assert.deepEqual(await music.generate({prompt:'calm piano'}), {bytes:Buffer.from([1, 2]), mimeType:'audio/mpeg', model:'lyria-3.5'})
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://gateway.example/gemini/v1beta/models/lyria-3.5:generateContent')
  assert.equal(requests[0].init.headers['x-goog-api-key'], 'test-key')
  assert.equal(requests[0].init.redirect, 'error')
  assert.equal(JSON.parse(requests[0].init.body).contents[0].parts[0].text, 'calm piano')
})

test('without a music service with a key nothing is asked', async () => {
  const music = createMusicGeneration({providers:() => [lyria], key:async () => undefined, loadSpend:async () => assert.fail('no spend'),
    fetch:async () => assert.fail('no request')})
  assert.equal(await music.available(), false)
  assert.equal(await music.generate({prompt:'x'}), null)
})

test('the spend guard is asked first; a refusal stops the request, an HTTP 4xx gives the reservation back', async () => {
  const calls = []
  const guard = refuse => async () => ({
    async check(request) { calls.push(['check', request]); if (refuse) throw Object.assign(new Error('over'), {code:'API_SPEND_DAILY_LIMIT'}); return {id:'r1'} },
    async release(id) { calls.push(['release', id]) },
  })
  let status = 400
  const music = refuse => createMusicGeneration({providers:() => [lyria], key:async () => 'k', loadSpend:guard(refuse),
    fetch:async () => status === 200 ? track.clone() : new Response('no', {status})})
  await assert.rejects(music(true).generate({prompt:'x'}), /over/)
  assert.deepEqual(calls.map(([name]) => name), ['check'], 'a refused guard sends nothing')
  assert.deepEqual(calls[0][1], {category:'music', purpose:'生成背景音乐', channel:'lyria:music:lyria-3.5', estimatedUsd:0.08})
  calls.length = 0
  await assert.rejects(music(false).generate({prompt:'x'}), error => error.status === 400)
  assert.deepEqual(calls.map(([name, value]) => name === 'release' ? value : name), ['check', 'r1'])
  calls.length = 0
  status = 503
  await assert.rejects(music(false).generate({prompt:'x'}), error => error.status === 503)
  assert.deepEqual(calls.map(([name]) => name), ['check'], 'a server failure may have been billed: kept')
})
