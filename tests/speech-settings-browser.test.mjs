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


test('配音页只配置对白和旁白声音，保存两种声音并允许清空旁白', async t => {
  let state = { enabled: false, provider: 'browser', providers: providers() }
  // An old readMode must not override the new two-voice behavior.
  state.readMode = 'dialogue'
  const respond = (method, args) => {
    if (method === 'getSpeechSettings') return state
    if (method === 'updateSpeechSettings') {
      state = {...state,providers:state.providers.map(p=>p.id===args.provider?{...p,...args.config}:p)}
      return state
    }
  }
  const {page,calls} = await openTavernSettings(t, {section:'dsh-tavern: speech settings',respond})
  const dialogue = page.getByLabel('对白声音', {exact:true})
  const narrator = page.getByLabel('旁白声音', {exact:true})
  await dialogue.fill('对白音色')
  await dialogue.press('Enter')
  await narrator.fill('旁白音色')
  await narrator.press('Enter')
  assert.equal(await page.locator('button[aria-label^="朗读内容："]').count(), 0)
  await page.getByRole('button', {name:'保存',exact:true}).click()
  await page.getByRole('status').getByText('已保存，朗读已关闭', {exact:true}).waitFor()
  assert.deepEqual(calls.filter(c=>c.method==='updateSpeechSettings').at(-1).args.config, {voice:'对白音色',narratorVoice:'旁白音色'})
  assert.equal('readMode' in calls.filter(c=>c.method==='updateSpeechSettings').at(-1).args, false)
  const reopened = await openTavernSettings(t, {section:'dsh-tavern: speech settings',respond})
  await reopened.page.waitForFunction(() => document.querySelector('input[aria-label="对白声音"]')?.value === '对白音色')
  assert.equal(await reopened.page.getByLabel('对白声音', {exact:true}).inputValue(), '对白音色')
  assert.equal(await reopened.page.getByLabel('旁白声音', {exact:true}).inputValue(), '旁白音色')
  await narrator.fill('')
  await narrator.press('Enter')
  await page.getByRole('button', {name:'保存',exact:true}).click()
  assert.equal(calls.filter(c=>c.method==='updateSpeechSettings').at(-1).args.config.narratorVoice, '')
})

test('浏览器朗读保留在配音渠道，系统音色加载后可选，开启保存无需 Key 且不切换到在线渠道', async t => {
  let state = { enabled: false, provider: 'browser', providers: providers() }
  const {page,calls} = await openTavernSettings(t, {
    section: 'dsh-tavern: speech settings',
    beforeRender() {
      const synth = new EventTarget()
      synth.voices = []
      synth.getVoices = () => synth.voices
      Object.defineProperty(window, 'speechSynthesis', {value:synth})
    },
    respond(method,args) {
      if (method === 'getSpeechSettings') return state
      if (method === 'updateSpeechSettings') { state = {...state,...args}; return state }
    }
  })
  await page.locator('button[aria-label="配音渠道：浏览器朗读"]').waitFor()
  await page.evaluate(() => {
    speechSynthesis.voices = [{name:'系统中文音色',lang:'zh-CN'}]
    speechSynthesis.dispatchEvent(new Event('voiceschanged'))
  })
  await page.waitForFunction(() => document.querySelector('#dsh-tavern-speech-voices option')?.value === '系统中文音色')
  assert.equal(await page.getByText('API Key', {exact:true}).count(), 0)
  await page.getByRole('switch', {name:'开启朗读',exact:true}).locator('..').click()
  await page.getByRole('status').getByText('已保存，使用「浏览器朗读」配音', {exact:true}).waitFor()
  const saved = calls.filter(c=>c.method==='updateSpeechSettings').at(-1).args
  assert.equal(saved.provider, 'browser')
  assert.equal(saved.enabled, true)
  assert.equal('readMode' in saved, false)
  await page.locator('button[aria-label^="配音渠道："]').click()
  await page.getByRole('menuitemradio', {name:'OpenAI 兼容接口',exact:true}).click()
  await page.locator('button[aria-label^="配音渠道："]').click()
  await page.getByRole('menuitemradio', {name:'浏览器朗读',exact:true}).click()
  await page.locator('button[aria-label="配音渠道：浏览器朗读"]').waitFor()
})
