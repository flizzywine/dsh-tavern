import test from 'node:test'
import assert from 'node:assert/strict'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'
import { applyTavernSettingsPatch } from '../tavern-plugin/lib/domain/tavern-settings.js'

test('本局设置不展示或请求正文生成配置', async t => {
  const { page, calls } = await openTavernSettings(t, { sessionId: 'game', browserExecutable: process.env.PLAYWRIGHT_EXECUTABLE_PATH, respond(method) {
    if (method === 'listSessions') return { sessions: [{ sessionId: 'game', mode: 'story' }] }
    if (method === 'getSession') return { view: { sessionId: 'game', mode: 'story', playerName: '你' } }
    if (method === 'getConversationBackgroundConfig') return { backgroundTasks: {}, modelCatalog: [], foregroundTools: [] }
    if (method === 'getConversationWritingSkills') return { skills: [] }
    if (method === 'listGamePlugins') return { plugins: { plugins: [], errors: [], settings: [], tasks: { settlement: [], manual: [] } } }
  } })
  const sessionSettings = page.getByRole('region', { name: '本局设置', exact: true })
  await sessionSettings.getByRole('heading', { name: '功能', exact: true }).waitFor()
  assert.equal(await sessionSettings.getByRole('heading', { name: /正文生成/ }).count(), 0)
  assert.equal(await sessionSettings.getByRole('button', { name: /^本局正文生成/ }).count(), 0)
  assert.equal(calls.some(call => call.method === 'getBodyGenerationSettings'), false)
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
