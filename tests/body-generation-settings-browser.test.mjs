import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'
import { applyTavernSettingsPatch } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'

test('本局正文生成可以覆盖全局选择并恢复继承', async t => {
  const chat = { id: 'chat', sessionId: 'game', mode: 'story' }
  const providers = [{ id: 'p:body', title: 'STcontext' }]
  const handlers = createSettingsHandlers({
    chatForSession: async () => chat, str: String, groupOfMode: () => 'play',
    readTavernSettings: async () => ({ storyPluginOutputRegex: false }),
    updateChat: async (_id, mutate) => mutate(chat),
    pluginApi: { bodyGenerators: { list: async () => providers, require: async () => providers[0] } }
  })
  const { page } = await openTavernSettings(t, { sessionId: 'game', browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH, respond(method, args) {
    if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
    if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName: '你' } }
    if (method === 'getConversationBackgroundConfig') return { backgroundTasks: {}, modelCatalog: [], foregroundTools: [] }
    if (method === 'getConversationWritingSkills') return { skills: [] }
    if (method === 'listGamePlugins') return { plugins: { plugins: [], errors: [], settings: [], tasks: { settlement: [], manual: [] } } }
    if (method === 'getBodyGenerationSettings' || method === 'setBodyGenerationSettings') return handlers[method](args)
  } })
  await page.getByRole('button', { name: /^本局正文生成插件：/ }).click()
  await page.getByRole('menuitemradio', { name: 'STcontext', exact: true }).click()
  await page.getByRole('button', { name: '本局正文生成插件：STcontext', exact: true }).waitFor()
  await page.getByRole('button', { name: /^本局正文生成方式：/ }).click()
  await page.getByRole('menuitemradio', { name: '插件直接生成', exact: true }).click()
  await page.getByRole('button', { name: '本局正文生成方式：插件直接生成', exact: true }).waitFor()
  assert.equal(chat.storyGenerationMode, 'plugin-direct')
  assert.equal(chat.storyGenerationProvider, 'p:body')
  await page.getByRole('button', { name: /^本局正文生成方式：/ }).click()
  await page.getByRole('menuitemradio', { name: '跟随全局设置', exact: true }).click()
  await page.getByRole('button', { name: '本局正文生成方式：跟随全局设置', exact: true }).waitFor()
  assert.equal(chat.storyGenerationMode, undefined)
  const hostRegex = page.getByRole('button', { name: /^插件生成正文后仍应用宿主正则：/ })
  for (const [label, value] of [['开启', true], ['关闭', false], ['跟随全局设置', undefined]]) {
    await hostRegex.click()
    await page.getByRole('menuitemradio', { name: label, exact: true }).click()
    await page.getByRole('button', { name: '插件生成正文后仍应用宿主正则：' + label, exact: true }).waitFor()
    assert.equal(chat.storyPluginOutputRegex, value)
    assert.equal(chat.storyGenerationMode, undefined, 'updating regex does not turn route inheritance into an override')
  }
})

test('正文生成设置：选择插件、启用工具调用并切回宿主；丢失插件仍显示已选值', async t => {
  let settings = { storyGenerationMode: 'host', storyGenerationProvider: '', defaultPlaySettings: { playerName: '你', backgroundTasks: {} } }
  let available = true
  const { page, calls } = await openTavernSettings(t, { browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH, respond(method, args) {
    if (method === 'getTavernSettings') return { settings, bodyGenerationProviders: available ? [{ id: 'p:body', owner: 'p', title: 'STcontext' }] : [] }
    if (method === 'updateTavernSettings') { settings = applyTavernSettingsPatch(settings, args.patch); return { settings } }
  } })
  const mode = page.getByRole('button', { name: /^正文生成方式：/ })
  const provider = page.getByRole('button', { name: /^正文生成插件：/ })
  await provider.click(); await page.getByRole('menuitemradio', { name: 'STcontext（p）' }).click()
  await page.getByRole('button', { name: '正文生成插件：STcontext（p）', exact: true }).waitFor()
  await mode.click(); await page.getByRole('menuitemradio', { name: '前台检索后由插件生成', exact: true }).click()
  await page.getByRole('button', { name: '正文生成方式：前台检索后由插件生成', exact: true }).waitFor()
  assert.equal(settings.storyGenerationProvider, 'p:body')
  assert.equal(settings.storyGenerationMode, 'plugin-tool-call')
  await page.getByRole('switch', { name: '插件生成正文后仍应用宿主正则' }).press('Space')
  await page.getByRole('switch', { name: '插件生成正文后仍应用宿主正则', checked: true }).waitFor()
  assert.equal(settings.storyPluginOutputRegex, true)
  available = false
  await page.evaluate(() => window.dispatchEvent(new Event('dsh-tavern-mods-changed')))
  await page.getByRole('button', { name: '正文生成插件：已选插件不可用', exact: true }).waitFor()
  await mode.click(); await page.getByRole('menuitemradio', { name: '宿主生成', exact: true }).click()
  await page.getByRole('button', { name: '正文生成方式：宿主生成', exact: true }).waitFor()
  assert.equal(settings.storyGenerationMode, 'host')
  assert.deepEqual(calls.filter(call => call.method === 'updateTavernSettings').at(-1).args.patch, { storyGenerationMode: 'host' })
})
