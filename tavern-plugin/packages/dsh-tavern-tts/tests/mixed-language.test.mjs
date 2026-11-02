// provider language metadata must not filter English out of Chinese dialogue.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVolcengineAdapter } from '../src/providers/volcengine.js'
import { azureSsml } from '../src/providers/azure.js'
import { createOpenAICompatibleAdapter } from '../src/providers/openai-compatible.js'
import { createServiceSettings } from '../src/settings.js'
import { hash } from '../src/core.js'

const text = '\u8ba9\u6211 call \u4e00\u4e0b tool\uff0c\u5199\u4e2a json \u7ed9\u4f60\u3002'

test('Volcengine leaves Chinese/English unfiltered but retains required other language selection', async () => {
  const calls = []
  const adapter = createVolcengineAdapter({ fetch: async (_url, options) => {
    calls.push(JSON.parse(options.body))
    return new Response(JSON.stringify({ code: 0, data: Buffer.alloc(100, 1).toString('base64') }) + '\n' + JSON.stringify({ code: 20000000 }))
  } })
  for (const language of ['zh', 'en', 'ja', 'ko']) {
    await adapter.synthesize({ config: { appId: 'test', resourceId: 'seed-tts-1.0' } }, { key: 'test' }, { text, language, params: { speaker: 'test', speechRate: 0 } })
    const p = calls.at(-1).req_params
    assert.equal(p.text, text)
    assert.equal(JSON.parse(p.additions).explicit_language, ['zh', 'en'].includes(language) ? undefined : language)
    assert.equal(p.language, undefined)
    assert.equal(p.audio_params.language, undefined)
  }
})

test('Volcengine registration versions old audio without changing settings revisions or re-registering', async () => {
  const providers = [
    { id: 'volc', kind: 'volcengine', config: { appId: 'test', resourceId: 'seed-tts-1.0' } },
    { id: 'azure', kind: 'azure', config: { region: 'eastasia' } },
  ]
  const registered = []
  const services = createServiceSettings({
    get: () => ({ providers, voices: [] }),
    tts: {
      registerVoiceSource: () => ({ replace() {}, dispose() {} }),
      registerProvider: (_owner, provider) => { registered.push(provider); return () => {} },
    },
  })
  await services.sync()
  await services.sync()
  assert.equal(registered.length, 2)
  assert.notEqual(registered[0].revision, hash(providers[0]))
  assert.equal(registered[1].revision, hash(providers[1]))
})

test('Azure uses the voice locale and never wraps mixed text in a forced language element', () => {
  for (const voiceName of ['zh-CN-XiaoxiaoNeural', 'en-US-AvaMultilingualNeural']) {
    const ssml = azureSsml({ text, language: 'zh', params: { voiceName } })
    assert.ok(ssml.includes(text))
    assert.ok(ssml.includes('xml:lang="' + voiceName.split('-').slice(0, 2).join('-') + '"'))
    assert.doesNotMatch(ssml, /<lang\b/)
  }
})
