import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { openTavernSettings } from './fixtures/tavern-settings-browser.mjs'

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

test('全局配置移除正文生成入口，STcontext 侧栏仍可选择生成方式和宿主正则', async t => {
  const { page } = await openTavernSettings(t, { respond(method) {
    if (method === 'getTavernSettings') return {
      settings: { storyGenerationMode: 'plugin-tool-call', storyGenerationProvider: 'dsh-tavern-STcontext:st-context',
        defaultPlaySettings: { playerName: '你', backgroundTasks: {} } },
    }
  } })
  await page.getByRole('region', { name: '开局默认', exact: true }).getByRole('region', { name: '功能', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '正文生成', exact: true }).count(), 0)

  let defaults = { mode: 'plugin-direct', hostRegex: false }
  await page.exposeFunction('callStcontextHost', (name, patch) => {
    if (name === 'dsh-tavern-stcontext/body-generation-defaults') return defaults = { ...defaults, ...patch }
    if (name === 'dsh-tavern-stcontext/config') return { presets: [], settings: {}, hostReady: true }
    if (name === 'dsh-tavern-stcontext/models') return { groups: [] }
    throw new Error('Unexpected STcontext request: ' + name)
  })
  await page.evaluate(() => { window.__ModuleLoader__.load = definition => { window.stcontext = definition.factory(() => modules.react) } })
  await page.addScriptTag({ content: await readFile(new URL('../tavern-plugin/packages/dsh-tavern-STcontext/client.js', import.meta.url), 'utf8') })
  await page.evaluate(() => {
    const target = document.body.appendChild(document.createElement('aside'))
    window.stcontext.apply({ effect() {}, tavernUi: {
      callHost: window.callStcontextHost,
      registerComposerAction() {},
      registerPanel(panel) {
        modules['react-dom/client'].createRoot(target).render(panel.render({ gameId: 'game', visible: true }))
      },
    } })
  })
  const mode = page.getByRole('combobox', { name: '默认正文生成方式' })
  assert.equal(await mode.inputValue(), 'plugin-direct')
  await mode.selectOption('plugin-tool-call')
  const regex = page.getByRole('checkbox', { name: '追加宿主正则' })
  await regex.check()
  await page.getByRole('checkbox', { name: '追加宿主正则', checked: true }).waitFor()
  assert.deepEqual(defaults, { mode: 'plugin-tool-call', hostRegex: true })
})
