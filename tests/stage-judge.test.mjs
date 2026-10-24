// 舞台模式 › 判断模型 and green-lamp recall. Every provider call is fake; no credential or real endpoint is contacted.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createEngineJudge, defaultJudgeConfig, judgeRequests, readJudgeConfig, validateJudgeConfig } from '../tavern-plugin/lib/domain/engine-judge.js'
import { judgeAssetId, judgeItemText, recallGreenAssets, selectJudgeRecall } from '../tavern-plugin/lib/domain/stage-judge-recall.js'
import { applyTavernSettingsPatch } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'
import { stageDirectorFixture } from './helpers/stage-director-fixture.mjs'

const input = { material: 'Body\n\nThe latest turn.', questions: [{ id: 'a', text: 'Does this asset fit this turn\'s story? [music] Rain; use when: rain' }] }
function fixture(config = validateJudgeConfig({ provider: 'jev' }), transport) {
  const calls = [], logs = [], reads = []
  const service = createEngineJudge({ getConfig: async () => config, log: event => logs.push(event),
    credentials: () => ({ resolve: async name => { reads.push(name); return { value: 'fake-secret' } }, describe: async () => ({ configured: true, source: 'env', value: 'never-return-this' }) }),
    fetch: async (url, options) => {
      calls.push({ url, ...options })
      if (transport) return transport(url, options)
      const body = JSON.parse(options.body)
      return { ok: true, json: async () => ({ answers: Array.isArray(body.questions) ? body.questions.map(q => ({ type: 'predicate', name: q.name, probability: 0.7 })) : Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: 'noul', noul: 0.7 }])), usage: { input_tokens: 100, output_tokens: 0 } }) }
    } })
  return { service, calls, logs, reads }
}

test('unset and off are zero calls, credential reads and request bytes; the config is strict', async () => {
  for (const config of [defaultJudgeConfig(), validateJudgeConfig({ provider: 'jev', enabled: false })]) {
    const f = fixture(config)
    assert.deepEqual(judgeRequests(config, input), [])
    assert.equal(await f.service.judge(input), null)
    assert.deepEqual([f.calls, f.reads, f.logs], [[], [], []])
  }
  assert.deepEqual(validateJudgeConfig({}), defaultJudgeConfig())
  assert.equal(validateJudgeConfig({ provider: 'jev' }).keyName, 'TYPESAFE_API_KEY')
  assert.equal(validateJudgeConfig({ provider: 'openai' }).model, 'gpt-6-luna')
  assert.throws(() => validateJudgeConfig({ apiKey: 'not-allowed' }), { code: 'UNKNOWN_FIELD' })
  for (const patch of [{ threshold: 1.1 }, { threshold: -1 }, { timeoutMs: 0 }, { capPerKind: 1.1 }, { provider: 'bad' }, { keyName: 'a-b' }, { baseUrl: 'https://example.org' },
    { provider: 'openai-compatible', baseUrl: 'https://secret@host' }, { provider: 'openai-compatible', baseUrl: 'https://host?key=secret' }, { provider: 'openai-compatible', baseUrl: 'http://192.168.1.2/v1' }]) assert.throws(() => validateJudgeConfig(patch))
  for (const baseUrl of ['http://localhost:9876/v1', 'http://127.0.0.1:9876/v1', 'http://[::1]:9876/v1']) assert.equal(validateJudgeConfig({ provider: 'openai-compatible', baseUrl }).baseUrl, baseUrl)
  assert.deepEqual(readJudgeConfig({ provider: 'bad' }), defaultJudgeConfig(), 'a stored config that no longer validates reads as unset')
})

test('Jev sends the Noul shape, Decisions the predicate shape; the sent body is the previewed bytes and the key is never logged', async () => {
  const f = fixture(), [request] = judgeRequests(validateJudgeConfig({ provider: 'jev' }), input)
  assert.deepEqual(JSON.parse(request.body), { model: 'jev-1.13.0', state: input.material, questions: { a: { type: 'noul', instructions: input.questions[0].text } } })
  assert.deepEqual(await f.service.judge(input), new Map([['a', 0.7]]))
  assert.deepEqual([f.calls[0].url, f.calls[0].body, f.calls[0].redirect], ['https://api.typesafe.ai/v1/systemone', request.body, 'error'])
  assert.equal(Buffer.byteLength(f.calls[0].body), request.bytes)
  assert.deepEqual(f.reads, ['DSH_TAVERN_JUDGE_JEV_KEY'], 'a stored key is looked up first')
  assert.equal(f.logs[0].costEstimateUSD, 100 * 0.042 / 1e6)
  assert.ok(!JSON.stringify(f.logs).includes('fake-secret'))
  for (const [provider, baseUrl, url] of [['openai', '', 'https://api.openai.com/v1/decisions'], ['openai-compatible', 'http://localhost:9876/v1/', 'http://localhost:9876/v1/decisions']]) {
    const g = fixture(validateJudgeConfig({ provider, baseUrl }))
    assert.deepEqual(await g.service.judge(input), new Map([['a', 0.7]]))
    assert.equal(g.calls[0].url, url)
    assert.deepEqual(JSON.parse(g.calls[0].body), { model: 'gpt-6-luna', input: input.material, questions: [{ type: 'predicate', name: 'a', instructions: input.questions[0].text }] })
  }
})

test('601 questions batch 300/300/1 in parallel; any failure, bad answer or the deadline discards the whole turn', async () => {
  const releases = []
  const f = fixture(undefined, async (_url, options) => { await new Promise(resolve => releases.push(resolve)); return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.keys(JSON.parse(options.body).questions).map(id => [id, { type: 'noul', noul: 0.8 }])) }) } })
  const big = { material: 'body', questions: Array.from({ length: 601 }, (_, i) => ({ id: 'q' + i, text: 'Question?' })) }
  const pending = f.service.judge(big)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.calls.map(c => Object.keys(JSON.parse(c.body).questions).length), [300, 300, 1])
  releases.forEach(resolve => resolve())
  assert.equal((await pending).size, 601)
  let call = 0
  assert.equal(await fixture(undefined, async () => ++call === 1 ? { ok: false } : { ok: true, json: async () => ({ answers: {} }) }).service.judge(big), null)
  for (const answers of [{}, { a: { type: 'noul', noul: 2 } }, { a: { type: 'noul', noul: '0.8' } }, { a: { type: 'refusal' } }]) {
    const g = fixture(undefined, async () => ({ ok: true, json: async () => ({ answers }) }))
    assert.equal(await g.service.judge(input), null)
    assert.equal(g.logs[0].code, 'JUDGE_INVALID_RESPONSE')
  }
  const slow = fixture(validateJudgeConfig({ provider: 'jev', timeoutMs: 15 }), async () => new Promise(() => {}))
  const result = await slow.service.test()
  assert.equal(result.error.code, 'JUDGE_TIMEOUT')
  assert.equal(slow.calls[0].signal.aborted, true)
  const slowKey = createEngineJudge({ getConfig: async () => validateJudgeConfig({ provider: 'jev', timeoutMs: 10 }), credentials: () => ({ resolve: () => new Promise(() => {}) }) })
  assert.equal((await slowKey.test()).error.code, 'JUDGE_TIMEOUT')
  const broken = fixture(undefined, async () => { throw new Error('fake-secret in provider error') })
  assert.equal((await broken.service.test()).error.code, 'JUDGE_ERROR')
  assert.ok(!JSON.stringify(broken.logs).includes('fake-secret'))
  const noKey = createEngineJudge({ getConfig: async () => validateJudgeConfig({ provider: 'jev' }), credentials: () => ({ resolve: async () => null }), fetch: () => assert.fail('no call without a key') })
  assert.equal((await noKey.test()).error.code, 'JUDGE_NO_KEY')
})

test('a draft test cannot send a stored credential to a server the saved config does not name', async () => {
  const saved = validateJudgeConfig({ provider: 'openai-compatible', baseUrl: 'https://saved.example/v1', keyName: 'SAVED_KEY' })
  const f = fixture(saved)
  assert.equal((await f.service.test({ ...saved, baseUrl: 'https://foreign.example/v1' })).error.code, 'JUDGE_KEY_URL_MISMATCH')
  assert.equal((await f.service.test({ ...saved, keyName: 'OTHER_KEY' })).error.code, 'JUDGE_KEY_URL_MISMATCH')
  assert.deepEqual([f.calls, f.reads], [[], []])
  assert.equal((await f.service.test({ ...saved, model: 'draft-model' })).ok, true)
  assert.equal((await f.service.test(validateJudgeConfig({ provider: 'openai' }))).ok, true)
})

test('tavern settings keep 判断模型 as stageJudge: unset by default; a patch is the whole config, validated', () => {
  assert.deepEqual(readJudgeConfig(undefined), defaultJudgeConfig())
  let document = applyTavernSettingsPatch({}, { stageJudge: { provider: 'jev' } })
  assert.deepEqual([document.stageJudge.provider, document.stageJudge.model, document.stageJudge.keyName], ['jev', 'jev-1.13.0', 'TYPESAFE_API_KEY'])
  document = applyTavernSettingsPatch(document, { stageJudge: { ...document.stageJudge, threshold: 0.8 } })
  assert.deepEqual([document.stageJudge.provider, document.stageJudge.model, document.stageJudge.threshold], ['jev', 'jev-1.13.0', 0.8])
  assert.deepEqual(applyTavernSettingsPatch(document, { stageJudge: {} }).stageJudge, defaultJudgeConfig(), 'an empty config is unset')
  for (const stageJudge of [null, { threshold: 2 }, { apiKey: 'x' }, { provider: 'openai-compatible' }]) assert.throws(() => applyTavernSettingsPatch(document, { stageJudge }))
})

test('API Key: a pasted key is stored and never returned; a variable name that resolves becomes the keyName reference', async () => {
  const env = { MY_JUDGE_KEY: 'env-secret' }, stored = new Map(), logs = [], sent = []
  const vault = {
    resolve: async ref => env[ref] !== undefined ? { value: env[ref], source: 'env' } : stored.has(ref) ? { value: stored.get(ref), source: 'file' } : undefined,
    describe: async ref => env[ref] !== undefined ? { configured: true, source: 'env' } : stored.has(ref) ? { configured: true, source: 'file' } : { configured: false },
    set: async (ref, value) => { stored.set(ref, value) }, unset: async ref => { stored.delete(ref) } }
  let document = applyTavernSettingsPatch({}, { stageJudge: { provider: 'jev' } })
  const readTavernSettings = async () => ({ stageJudge: readJudgeConfig(document.stageJudge) })
  const updateTavernSettings = async patch => { document = applyTavernSettingsPatch(document, patch); return readTavernSettings() }
  const stageJudge = createEngineJudge({ getConfig: async () => (await readTavernSettings()).stageJudge, credentials: () => vault, log: event => logs.push(event),
    fetch: async (_url, options) => { sent.push(options.headers.Authorization); return { ok: true, json: async () => ({ answers: { test: { type: 'noul', noul: 0.5 } } }) } } })
  const rpc = createSettingsHandlers({ readTavernSettings, updateTavernSettings, stageJudge }), secret = 'fake-test-value'
  const replies = [await rpc.setJudgeKey({ provider: 'jev', value: secret })]
  assert.equal(stored.get('DSH_TAVERN_JUDGE_JEV_KEY'), secret)
  assert.deepEqual(replies[0], { status: { configured: true, source: 'stored' } })
  replies.push(await rpc.getJudgeCredentialStatus({ provider: 'jev', keyName: document.stageJudge.keyName }))
  assert.equal((await rpc.testJudgeConnection({})).ok, true)
  assert.equal(sent.at(-1), 'Bearer ' + secret)
  assert.ok(!JSON.stringify([replies, document, logs]).includes(secret), 'the key is never sent back, kept in settings or logged')
  const reference = await rpc.setJudgeKey({ provider: 'jev', value: 'MY_JUDGE_KEY' })
  assert.deepEqual(reference.status, { configured: true, source: 'env', keyName: 'MY_JUDGE_KEY' })
  assert.deepEqual([reference.settings.stageJudge.keyName, stored.size], ['MY_JUDGE_KEY', 0])
  assert.equal((await rpc.testJudgeConnection({})).ok, true)
  assert.equal(sent.at(-1), 'Bearer env-secret')
  // A name that resolves nowhere is the key itself; bad values are refused once, at entry.
  await rpc.setJudgeKey({ provider: 'jev', value: 'NOT_SET_ANYWHERE' })
  assert.equal(stored.get('DSH_TAVERN_JUDGE_JEV_KEY'), 'NOT_SET_ANYWHERE')
  for (const value of ['', 'has space', 'x'.repeat(4097), 42]) await assert.rejects(rpc.setJudgeKey({ provider: 'jev', value }))
  await assert.rejects(rpc.setJudgeKey({ provider: 'unset', value: 'k' }))
  await rpc.setJudgeKey({ provider: 'jev', value: null })
  assert.equal(stored.size, 0)
})

// Green-lamp recall: the director's catalog for one window.
const entry = (kind, name, mode, keywords = [], note) => ({ name, ref: { packId: 'p', kind, assetId: name }, recall: { mode, keywords }, ...(note ? { note } : {}) })
const catalog = () => ({ player: 'Reader', cast: [], background: [entry('backgrounds', 'Hall', 'constant'), entry('backgrounds', 'Garden', 'keyword', ['花园']), entry('backgrounds', 'Roof', 'keyword', ['天台'], 'night talks')],
  music: [entry('music', 'Theme', 'constant'), entry('music', 'Storm', 'keyword', ['雷雨']), entry('music', 'Waltz', 'keyword', ['舞会']), entry('music', 'Lull', 'keyword', ['摇篮'])] })

test('recall: blue and named green entries are offered without asking; the judge is asked only about the green ones not named', async () => {
  const jev = validateJudgeConfig({ provider: 'jev', capPerKind: 1 }), asked = []
  const ask = probabilities => async (request, config) => { asked.push({ request, config }); return probabilities }
  const names = offered => [offered.background.map(item => item.name), offered.music.map(item => item.name)]
  // Unset: no question at all.
  assert.deepEqual(names(await recallGreenAssets(catalog(), ['窗外雷雨。'], defaultJudgeConfig(), ask(null))), [['Hall'], ['Theme', 'Storm']])
  assert.equal(asked.length, 0)
  const probabilities = new Map([['p/backgrounds/Garden', 0.4], ['p/backgrounds/Roof', 0.9], ['p/music/Waltz', 0.7], ['p/music/Lull', 0.8]])
  const offered = await recallGreenAssets(catalog(), ['窗外雷雨。'], jev, ask(probabilities))
  assert.deepEqual(names(offered), [['Hall', 'Roof'], ['Theme', 'Storm', 'Lull']], 'p ≥ 0.6, then the most likely capPerKind per kind, in catalog order')
  assert.deepEqual(asked[0].request.questions.map(q => q.id), ['p/backgrounds/Garden', 'p/backgrounds/Roof', 'p/music/Waltz', 'p/music/Lull'])
  assert.equal(asked[0].request.material, '窗外雷雨。')
  assert.equal(asked[0].request.questions[1].text, judgeItemText('Roof', 'night talks', 'background'))
  assert.match(asked[0].request.questions[1].text, /^<judge_request>\nDoes this asset fit this turn's story\? \[background\] Roof; use when: night talks\n<\/judge_request>$/)
  // A failed judge (null) is triggers only; nothing is filled in at random.
  assert.deepEqual(names(await recallGreenAssets(catalog(), ['窗外雷雨。'], jev, ask(null))), [['Hall'], ['Theme', 'Storm']])
  // Every green entry named: no question.
  asked.length = 0
  await recallGreenAssets(catalog(), ['花园里，天台上，舞会和摇篮曲，雷雨'], jev, ask(probabilities))
  assert.equal(asked.length, 0)
  assert.deepEqual([...selectJudgeRecall([{ id: 'b', kind: 'music' }, { id: 'a', kind: 'music' }], new Map([['a', 0.7], ['b', 0.7]]), { threshold: 0.6, capPerKind: 1 })], ['a'], 'ties go by id')
  assert.equal(judgeAssetId(catalog().music[1]), 'p/music/Storm')
  assert.equal(judgeItemText('Rain', 'Field rain; licensed under CC BY 4.0.', 'music').includes('licensed'), false, 'credits are not sent')
})

test('the director offers a recalled green background or track for this turn only; the judge never sees the player input or history', async () => {
  const story = { id: 'story', sessionId: 'game', mode: 'story', timeline: { branchId: 'branch', revision: 3 },
    messages: [{ role: 'assistant', turn: 1, text: 'Opening.' }, { role: 'user', text: 'Secret player plan.' }, { role: 'assistant', turn: 2, text: 'They climb the stairs in silence.' }] }
  const asked = []
  let config = validateJudgeConfig({ provider: 'jev', preamble: 'Pick quiet cues.' })
  const judge = { config: async () => config, judge: async (request, frozen) => { asked.push({ request, frozen }); return new Map([['p/backgrounds/Roof', 0.9], ['p/music/Lull', 0.2]]) } }
  const h = await stageDirectorFixture(story, catalog(), { judge })
  const request = await h.prepare(), context = JSON.parse(request.turnContext)
  assert.deepEqual([context.background, context.music], [['Hall', 'Roof'], ['Theme']])
  assert.equal(asked[0].request.material, 'Pick quiet cues.\n\nThey climb the stairs in silence.')
  assert.ok(!JSON.stringify(asked).includes('Secret player plan') && !JSON.stringify(asked).includes('Opening.'))
  assert.equal((await request.call({ background: 'Garden' })).ok, false, 'an unrecalled green entry is not a choice')
  assert.deepEqual(await request.call({ background: 'Roof' }), { ok: true })
  // Unset: the judge is not called and green entries follow their triggers.
  config = defaultJudgeConfig()
  await h.persistence.update('story', current => { current.messages.push({ role: 'user', text: 'Go on.' }, { role: 'assistant', turn: 3, text: 'Wind howls.' }); current.timeline.revision++; return current })
  const next = JSON.parse((await h.prepare()).turnContext)
  assert.deepEqual([next.background, next.state.background, asked.length], [['Hall'], 'Roof', 1], 'the current scene stays when its entry is not offered')
})
