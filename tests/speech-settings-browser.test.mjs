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

test('配音设置：选渠道、填 Key 后打开开关，开关跟着保存结果；失败时给出原因', async t => {
  let state = { enabled: false, provider: 'browser', providers: providers() }
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: speech settings section', respond(method, args) {
    if (method === 'getTavernSettings') return { settings: { castPresentation: true, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }, modelCatalog: [], releaseCapabilities: {} }
    if (method === 'getSpeechSettings') return state
    if (method === 'updateSpeechSettings') {
      if (args.enabled && !args.apiKey && args.provider === 'openai') throw new Error('还不能开启配音：请填写 API Key')
      state = { ...state, enabled: args.enabled, provider: args.provider, providers: state.providers.map(item => item.id === 'openai' && args.apiKey ? { ...item, hasKey: true } : item) }
      return state
    }
  } })
  const toggle = page.getByRole('switch', { name: '开启配音', exact: true })
  await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('openai')
  await toggle.click()
  await page.getByText('保存失败：还不能开启配音：请填写 API Key').waitFor()
  assert.equal(await toggle.isChecked(), false)
  await page.getByLabel('API Key', { exact: true }).fill('sk-1')
  await toggle.click()
  await page.getByText('已保存，使用「OpenAI 兼容接口」配音').waitFor()
  assert.equal(await toggle.isChecked(), true)
  await page.getByText('API Key（已保存，留空沿用）').waitFor()
  const saved = calls.filter(call => call.method === 'updateSpeechSettings').at(-1).args
  assert.deepEqual(saved, { enabled: true, provider: 'openai', config: { voice: 'alloy', narratorVoice: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' }, apiKey: 'sk-1' })
})

test('配音设置：火山引擎的密钥格标成 Access Token，APP ID 跟着设置一起保存', async t => {
  let state = { enabled: false, provider: 'browser', providers: providers() }
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: speech settings section', respond(method, args) {
    if (method === 'getTavernSettings') return { settings: { castPresentation: true, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }, modelCatalog: [], releaseCapabilities: {} }
    if (method === 'getSpeechSettings') return state
    if (method === 'updateSpeechSettings') {
      state = { ...state, provider: args.provider, providers: state.providers.map(item => item.id === args.provider && args.apiKey ? { ...item, hasKey: true } : item) }
      return state
    }
  } })
  await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('volcengine')
  const form = page.locator('.dsh-tavern-speech-settings')
  assert.equal(await form.getByLabel('API Key', { exact: true }).count(), 0, '火山的密钥叫 Access Token')
  await form.getByLabel('APP ID', { exact: true }).fill('app-1')
  await form.getByLabel('Access Token', { exact: true }).fill('token-1')
  await form.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('已保存，配音已关闭').waitFor()
  assert.deepEqual(calls.filter(call => call.method === 'updateSpeechSettings').at(-1).args, {
    enabled: false, provider: 'volcengine', apiKey: 'token-1',
    config: { voice: 'zh_female_vv_uranus_bigtts', narratorVoice: '', appId: 'app-1', baseUrl: 'https://openspeech.bytedance.com', resourceId: '' }
  })
})

test('配音设置：Fish 协议的 Key 标成选填，模型从服务读出的清单里选', async t => {
  const fish = { id: 'fish', label: 'Fish 协议', key: true, keyOptional: true, discovers: true, prepares: true, hasKey: false, voices: [], voice: 'ref-lin', narratorVoice: '', description: 'Fish',
    fields: [{ name: 'baseUrl', label: '服务地址', value: 'http://127.0.0.1:8080', placeholder: '' }, { name: 'model', label: '模型（选填）', value: '', placeholder: '' }] }
  const state = { enabled: false, provider: 'fish', providers: [...providers(), fish] }
  const { page, calls } = await openTavernSettings(t, { section: 'dsh-tavern: speech settings section', respond(method) {
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
  await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('openai')
  await form.getByText('API Key', { exact: true }).waitFor()
  assert.equal(await form.locator('#dsh-tavern-speech-models').count(), 0)
  assert.equal(calls.filter(call => call.method === 'speechServiceInfo').length, asked)
})