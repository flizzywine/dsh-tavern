import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

const settings = { provider: 'openai', activeProvider: 'openai', enabled: false, ready: false, model: 'image', baseURL: 'https://example.test/v1', style: { preset: 'default', custom: '' }, channels: [{ id: 'openai', label: 'OpenAI', fields: ['baseURL', 'model'], models: ['image'] }] }

test('global API form loads while disabled and saves edited credentials without a game toggle', async t => {
  const { form, calls } = await openTavernSettings(t, { settings, respond(method) {
    if (method === 'saveSceneImageSettings') return { settings: { ...settings, hasKey: true } }
  } })
  assert.equal(await form.getByRole('switch').count(), 0)
  assert.equal(await form.getByLabel('API 根地址').inputValue(), settings.baseURL)
  await form.getByLabel('API Key', { exact: true }).fill('draft-key')
  await form.getByRole('button', { name: '保存生图配置', exact: true }).click()
  await form.getByRole('status').filter({ hasText: '已保存全局 API 配置' }).waitFor()
  const saved = calls.filter(call => call.method === 'saveSceneImageSettings')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].args.apiKey, 'draft-key')
  assert.equal(Object.hasOwn(saved[0].args, 'enabled'), false)
  assert.equal(await form.getByLabel(/API Key/).inputValue(), '')
})

test('global API save failure preserves typed credentials and displays the error', async t => {
  const { form, calls } = await openTavernSettings(t, { settings, respond(method) {
    if (method === 'saveSceneImageSettings') return { ok: false, error: '保存失败' }
  } })
  await form.getByLabel('API Key', { exact: true }).fill('draft-key')
  await form.getByRole('button', { name: '保存生图配置', exact: true }).click()
  await form.getByRole('status').filter({ hasText: '保存失败' }).waitFor()
  assert.equal(calls.find(call => call.method === 'saveSceneImageSettings').args.apiKey, 'draft-key')
  assert.equal(await form.getByLabel('API Key', { exact: true }).inputValue(), 'draft-key')
  assert.equal(await form.getByRole('button', { name: '保存生图配置', exact: true }).isEnabled(), true)
})

test('connection probes use draft credentials, model choices stay editable, and address edits clear stale results', async t => {
  const { form, calls } = await openTavernSettings(t, { settings: { ...settings, channels: [{ ...settings.channels[0], fields: ['baseURL', 'model', 'size'], canListModels: true }] }, respond(method) {
    if (method === 'testSceneImageConnection') return { status: 'reachable', apiKeyStatus: 'unverified', httpStatus: 404, probePath: '/models', message: '连接成功，但服务暂时无法完成 Key 验证。' }
    if (method === 'listSceneImageModels') return { models: ['new-image'], message: '已获取' }
  } })
  const setupOrder = await form.locator('label, button').allTextContents()
  const position = text => setupOrder.findIndex(value => value.startsWith(text))
  for (const [first, second] of [['提供商', 'API Key'], ['API Key', '测试连接与鉴权'], ['测试连接与鉴权', '生图模型'], ['生图模型', '图片尺寸／分辨率']]) {
    assert.ok(position(first) >= 0 && position(second) > position(first), `${first} precedes ${second}`)
  }
  const key = form.getByLabel('API Key', { exact: true })
  await key.fill('draft-key')
  await form.getByRole('button', { name: '测试连接与鉴权', exact: true }).click()
  await form.locator('[data-connection-status="reachable"]').waitFor()
  assert.equal(calls.find(call => call.method === 'testSceneImageConnection').args.apiKey, 'draft-key')
  assert.equal(await key.inputValue(), 'draft-key')
  assert.ok(!(await form.locator('[data-connection-status]').innerText()).includes('404'))
  const diagnostic = form.locator('details').filter({ hasText: '连接诊断' })
  assert.equal(await diagnostic.getAttribute('open'), null)
  await form.getByText('连接诊断', { exact: true }).click()
  await diagnostic.getByText(/HTTP 404/).waitFor()
  await form.getByRole('button', { name: '获取模型列表', exact: true }).click()
  await form.locator('datalist option[value="new-image"]').waitFor({ state: 'attached' })
  await form.getByLabel('从获取的 1 个模型中选择').selectOption('new-image')
  assert.equal(await form.getByLabel('生图模型', { exact: true }).inputValue(), 'new-image')
  const model = form.getByLabel('生图模型', { exact: true })
  await model.fill('custom-image-model')
  assert.equal(await model.inputValue(), 'custom-image-model')
  assert.equal(await model.getAttribute('list'), await form.locator('datalist').getAttribute('id'))
  await form.getByLabel('API 根地址').fill('https://another.test/v1')
  assert.equal(await form.locator('[data-connection-status]').count(), 0)
  assert.equal(await form.locator('datalist option[value="new-image"]').count(), 0)
  assert.equal(calls.filter(call => call.method === 'saveSceneImageSettings').length, 0)
})
