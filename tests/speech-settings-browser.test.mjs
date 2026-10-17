import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

const providers = () => [
  { id: 'browser', label: '浏览器朗读', browser: true, key: false, hasKey: false, fields: [], voices: [], voice: '', narratorVoice: '', description: '' },
  { id: 'openai', label: 'OpenAI 兼容接口', key: true, hasKey: false, voices: ['alloy'], voice: 'alloy', narratorVoice: '', description: 'OpenAI',
    fields: [{ name: 'baseUrl', label: 'API 根地址', value: 'https://api.openai.com/v1', placeholder: '' }, { name: 'model', label: '模型', value: 'gpt-4o-mini-tts', placeholder: '' }] }
]

test('配音设置：选渠道、填 Key 后打开开关，开关跟着保存结果；失败时给出原因', async t => {
  let state = { enabled: false, provider: 'browser', providers: providers() }
  const { page, calls } = await openTavernSettings(t, { sceneImages: false, respond(method, args) {
    if (method === 'getTavernSettings') return { settings: { castPresentation: true, defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }, modelCatalog: [], releaseCapabilities: { sceneImages: false } }
    if (method === 'getSpeechSettings') return state
    if (method === 'updateSpeechSettings') {
      if (args.enabled && !args.apiKey && args.provider === 'openai') throw new Error('还不能开启配音：请填写 API Key')
      state = { ...state, enabled: args.enabled, provider: args.provider, providers: state.providers.map(item => item.id === 'openai' && args.apiKey ? { ...item, hasKey: true } : item) }
      return state
    }
  } })
  const toggle = page.getByRole('switch', { name: '配音', exact: true })
  await page.getByRole('combobox', { name: '配音渠道', exact: true }).selectOption('openai')
  await toggle.click()
  await page.getByText('保存失败：还不能开启配音：请填写 API Key').waitFor()
  assert.equal(await toggle.isChecked(), false)
  await page.getByLabel('API Key', { exact: true }).fill('sk-1')
  await toggle.click()
  await page.getByText('已保存，使用「OpenAI 兼容接口」配音').waitFor()
  assert.equal(await toggle.isChecked(), true)
  assert.equal(await page.getByLabel('API Key', { exact: true }).getAttribute('placeholder'), '已保存，留空不改')
  const saved = calls.filter(call => call.method === 'updateSpeechSettings').at(-1).args
  assert.deepEqual(saved, { enabled: true, provider: 'openai', config: { voice: 'alloy', narratorVoice: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' }, apiKey: 'sk-1' })
})
