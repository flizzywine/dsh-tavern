import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

const providers = () => [
  { id: 'browser', label: '浏览器朗读', browser: true, key: false, hasKey: false, fields: [], voices: [], voice: '', narratorVoice: '', description: '' },
  { id: 'openai', label: 'OpenAI 兼容接口', key: true, hasKey: false, voices: ['alloy'], voice: 'alloy', narratorVoice: '', description: 'OpenAI',
    fields: [{ name: 'baseUrl', label: 'API 根地址', value: 'https://api.openai.com/v1', placeholder: '' }, { name: 'model', label: '模型', value: 'gpt-4o-mini-tts', placeholder: '' }] },
  { id: 'volcengine', label: '火山引擎语音', key: true, keyLabel: 'Access Token', hasKey: false, voices: ['zh_female_vv_uranus_bigtts'], voice: 'zh_female_vv_uranus_bigtts', narratorVoice: '', description: '火山',
    fields: [{ name: 'appId', label: 'APP ID', value: '', placeholder: '' }, { name: 'baseUrl', label: '服务地址', value: 'https://openspeech.bytedance.com', placeholder: '' },
      { name: 'resourceId', label: '资源 ID（选填）', value: '', placeholder: '' }] }
]

test('配音设置：Fish 协议的 Key 标成选填，模型从服务读出的清单里选', async t => {
  const fish = { id: 'fish', label: 'Fish 协议', key: true, keyOptional: true, discovers: true, prepares: true, hasKey: false, voices: [], voice: 'ref-lin', narratorVoice: '', description: 'Fish',
    fields: [{ name: 'baseUrl', label: '服务地址', value: 'http://127.0.0.1:8080', placeholder: '' }, { name: 'model', label: '模型（选填）', value: '', placeholder: '' }] }
  const state = { enabled: false, provider: 'fish', providers: [...providers(), fish] }
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: speech settings', respond(method) {
    if (method === 'getTavernSettings') return { settings: { castPresentation: true, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }, modelCatalog: [], releaseCapabilities: {} }
    if (method === 'getSpeechSettings') return state
    if (method === 'speechServiceInfo') return { models: [{ id: 'model-a', label: 'Model A' }, { id: 'model-b', label: 'model-b' }] }
  } })
  const form = page.locator('.dsh-tavern-speech-settings')
  await form.getByText('API Key（选填）', { exact: true }).waitFor()
  await form.getByText('服务提供的模型：Model A、model-b', { exact: true }).waitFor()
  assert.equal(await form.getByLabel('模型（选填）', { exact: true }).getAttribute('list'), 'dsh-tavern-speech-models')
  assert.deepEqual(await form.locator('#dsh-tavern-speech-models option').evaluateAll(options => options.map(option => option.value)), ['model-a', 'model-b'])
  assert.deepEqual(calls.filter(call => call.method === 'speechServiceInfo').at(-1).args, { provider: 'fish' })
  // A channel without discovery asks nothing and shows no list.
  const asked = calls.filter(call => call.method === 'speechServiceInfo').length
  // 配音渠道 is the shared inline menu: its trigger, then the option.
  await page.locator('button[aria-label^="配音渠道："]').click()
  await page.getByRole('menuitemradio', { name: 'OpenAI 兼容接口' }).click()
  await form.getByText('API Key', { exact: true }).first().waitFor()
  assert.equal(await form.locator('#dsh-tavern-speech-models').count(), 0)
  assert.equal(calls.filter(call => call.method === 'speechServiceInfo').length, asked)
})
