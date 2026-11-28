import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installBundledTavernPlugins } from '../bin/bundled-tavern-plugins.mjs'
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

test('STcontext 和文风联想的配置从右侧插件管理打开，游玩侧栏可继续使用', async t => {
  const { page } = await openTavernSettings(t, { respond(method) {
    if (method === 'getTavernSettings') return {
      settings: { storyGenerationMode: 'plugin-tool-call', storyGenerationProvider: 'dsh-tavern-STcontext:st-context',
        defaultPlaySettings: { playerName: '你', backgroundTasks: {} } },
    }
  } })
  await page.getByRole('region', { name: '开局默认', exact: true }).getByRole('region', { name: '功能', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '正文生成', exact: true }).count(), 0)

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'tavern-plugin-manager-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
  const pluginNames = ['dsh-tavern-STcontext', 'dsh-tavern-style-recall']
  const clients = await Promise.all(pluginNames.map(async packageName => {
    const [installed] = installBundledTavernPlugins({ sourceRoot, dataRoot, packageName, logger: {} })
    assert.equal(installed.action, 'installed', installed.reason)
    return readFile(path.join(installed.target, 'client.js'), 'utf8')
  }))
  let defaults = { mode: 'plugin-direct', hostRegex: false }
  let style = { enabled: true, mode: 'background', guidance: '保留原设置', source: '' }
  const styleWrites = []
  const finishDisable = Promise.withResolvers()
  await page.exposeFunction('callPluginHost', async (name, patch) => {
    if (name === 'dsh-tavern-stcontext/body-generation-defaults') return defaults = { ...defaults, ...patch }
    if (name === 'dsh-tavern-stcontext/config') return { presets: [], settings: {}, hostReady: true }
    if (name === 'dsh-tavern-stcontext/models') return { groups: [] }
    if (name === 'dsh-tavern-style-recall/settings') return {
      settings: style, sources: [], backgroundAvailable: true
    }
    if (name === 'dsh-tavern-style-recall/save') {
      styleWrites.push(patch)
      if (styleWrites.length === 1) throw new Error('保存开关失败')
      if (patch.enabled === false) await finishDisable.promise
      return style = { ...style, ...patch }
    }
    throw new Error('Unexpected plugin request: ' + name)
  })
  await page.evaluate(() => {
    window.settingsPlugins = []
    window.__ModuleLoader__.load = definition => window.settingsPlugins.push(definition.factory(() => modules.react))
  })
  for (const content of clients) await page.addScriptTag({ content })
  const registrations = await page.evaluate(() => {
    const h = modules.react.createElement
    const contents = document.body.appendChild(document.createElement('aside'))
    const options = document.body.appendChild(document.createElement('nav'))
    const root = modules['react-dom/client'].createRoot(contents)
    const registered = [], sidebar = []
    const slots = {
      inject(_name, register) { return register() },
      register(spec, Component) {
        registered.push(spec.name)
        if (spec.name !== 'plugins.item') return
        const card = options.appendChild(document.createElement('button'))
        card.textContent = spec.label()
        card.onclick = () => root.render(h(Component, { view: 'page' }))
        return Component({ view: 'summary' })
      }
    }
    for (const plugin of window.settingsPlugins) {
      plugin.apply({ slots, effect(run) { return run() }, tavernUi: {
        assetUrl: () => 'data:text/css,',
        callHost: window.callPluginHost,
        components: { Icon: () => null, Segmented: () => null, Spinner: () => null,
          Switch: ({ id, label, checked, disabled, onChange }) => h('input', { id, type: 'checkbox', role: 'switch',
            'aria-label': label, checked, disabled, onChange: event => onChange(event.target.checked) }) },
        registerComposerAction() {},
        registerPanel(panel) { sidebar.push(panel.id) },
      } })
    }
    return { registered, sidebar }
  })
  assert.deepEqual(registrations.registered, ['plugins.item', 'plugins.item'])
  assert.deepEqual(registrations.sidebar, ['st-context', 'style-recall'])
  await page.getByRole('button', { name: 'STcontext', exact: true }).click()
  const mode = page.getByRole('combobox', { name: '默认正文生成方式' })
  assert.equal(await mode.inputValue(), 'plugin-direct')
  await mode.selectOption('plugin-tool-call')
  const regex = page.getByRole('checkbox', { name: '追加宿主正则', checked: false })
  // The controlled checkbox updates from the host response, not from the click itself.
  await regex.click()
  await page.getByRole('checkbox', { name: '追加宿主正则', checked: true }).waitFor()
  assert.deepEqual(defaults, { mode: 'plugin-tool-call', hostRegex: true })
  const stylePage = page.getByRole('button', { name: '文风联想', exact: true })
  await stylePage.click()
  await page.getByRole('heading', { name: '文风联想', exact: true }).waitFor()
  await page.getByText('每轮由本局后台模型联想范文，正文生成时参考。', { exact: true }).waitFor()
  const guidance = page.getByRole('textbox', { name: /文风偏好/ })
  await guidance.fill('尚未保存的偏好')
  const toggle = page.getByRole('switch', { name: '开启文风联想' })
  assert.equal(await toggle.isChecked(), true)
  await toggle.click()
  await page.getByRole('alert').filter({ hasText: '保存开关失败' }).waitFor()
  assert.equal(await toggle.isChecked(), true)

  await toggle.click()
  await page.getByText('正在保存…', { exact: true }).waitFor()
  assert.equal(await toggle.isChecked(), true, '保存成功前仍显示已生效的设置')
  finishDisable.resolve()
  await page.getByRole('switch', { name: '开启文风联想', checked: false }).waitFor()
  assert.deepEqual(styleWrites, [{ enabled: false }, { enabled: false }])
  assert.deepEqual(style, { enabled: false, mode: 'background', guidance: '保留原设置', source: '' })
  assert.equal(await guidance.inputValue(), '尚未保存的偏好')

  await page.getByRole('button', { name: '保存全局设置' }).click()
  await page.getByText('已保存', { exact: true }).waitFor()
  assert.deepEqual(styleWrites.at(-1), { mode: 'background', guidance: '尚未保存的偏好', source: '' })
  await page.getByRole('button', { name: 'STcontext', exact: true }).click()
  await mode.waitFor()
  await stylePage.click()
  await page.getByRole('switch', { name: '开启文风联想', checked: false }).waitFor()
  await toggle.click()
  await page.getByRole('switch', { name: '开启文风联想', checked: true }).waitFor()
  assert.deepEqual(style, { enabled: true, mode: 'background', guidance: '尚未保存的偏好', source: '' })
})
