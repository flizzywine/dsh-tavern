import { readFile } from 'node:fs/promises'
import { browserReactScript } from './browser-react.mjs'
import { chromium } from 'playwright'

// Exercise the public plugin registration and real React effects/events. Only
// the DSH host and HTTP boundary are fixtures; no component source extraction.
// stageClient: the page loads the built stage client through the core's hold and loader, as in production.
export async function openTavernSettings(t, { settings, respond, exposeModelSlotGroups = false, section: pageSection, provided, sessionId, beforeRender, stageClient = false, sidebarStart = false, browserExecutable, renderPropsCode, contextOptions } = {}) {
  const executablePath = browserExecutable || process.env.PLAYWRIGHT_EXECUTABLE_PATH
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'], ...(executablePath ? { executablePath } : {}) })
  t.after(() => browser.close())
  const page = await browser.newPage(contextOptions)
  page.setDefaultTimeout(5000)
  const calls = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://tavern.test/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    // the core's on-demand loader imports the built stage client (packages/dsh-tavern-stage/lib/client.js)
    if (stageClient && route.request().url().endsWith('/api/dsh-tavern/client-assets/stage-client.mjs'))
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-stage/lib/client.js', import.meta.url), 'utf8') })
    // the stage's Live2D module, imported by 舞台配置 › 运行库 (its Live2D entry)
    if (stageClient && route.request().url().endsWith('/api/dsh-tavern/client-assets/live2d-client.mjs'))
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-stage/lib/client/live2d-client.mjs', import.meta.url), 'utf8') })
    if (!route.request().url().includes('/api/')) return route.fulfill({ contentType: 'text/html', body: '<main></main>' })
    const args = route.request().postDataJSON()
    calls.push({ method, args })
    let result
    try { result = await respond?.(method, args) } catch (error) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: error.message }) })
    }
    if (result === undefined) {
      if (method === 'getTavernSettings') result = { settings: { defaultPlaySettings: { playerName: "你", backgroundTasks: { variables: true, posture: true } } } }
      // optional runtime detection is an offline settings read.
      else if (method === 'getLive2dRuntime') result = { core: '', installed: false, coreInstalled: false, displayInstalled: false, missing: ['core', 'display'] }
      else if (method === 'getAssetEngineSettings') result = { revision: 'e1', writable: true, values: { stageToggles: { dialogue: false, stage: false } } }
      else if (method === 'getSpineRuntimeStatus') result = { installed: false, runtime: '', importSupported: true }
      else if (method === 'getWebSearchStatus') result = { provider: 'tavern-search', attempts: [] }
      else if (method === 'listPresets') result = { presets: [], activePresetPath: '' }
      else if (method === 'getUserPreferenceProfile') result = { userProfile: { profiles: [], defaultProfileId: '' } }
      else if (method === 'getCandidatePreferences') result = { candidateDismissMode: 'after-fill' }
      else if (method === 'confirmSessionPatch') result = {}
      else if (method === 'getTavernModelCatalog') result = { modelCatalog: [] }
      else if (method === 'getDefaultWritingSkills') result = { skills: [] }
      else if (method === 'listUserPlugins') result = { plugins: [], dir: '/tmp/tavern/plugins' }
      else if (method === 'managedModsList') result = { revision: 'fixture', mods: [] }
      else if (method === 'listLegacyPlugins') result = { plugins: [] }
      else if (method === 'checkUserPluginUpdates') result = { plugins: [] }
      else if (method === 'getActiveInterfaceSkin') result = { id: null, css: '' }
      else if (method === 'listInterfaceSkins') result = { active: null, skins: [] }
      else if (method === 'getConversationDialogueSettings') result = { dialogue: false, voice: true }
      else if (method === 'getDialogueBubbles') result = { config: { enabled: false, characters: [] } }
      else if (method === 'getSpeechSettings') result = { enabled: false, provider: 'browser', providers: [{ id: 'browser', label: '浏览器朗读', browser: true, key: false, fields: [], voices: [], voice: '', narratorVoice: '' }] }
      else throw new Error('Unexpected settings request: ' + method)
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, ...result }) })
  })
  await page.goto('http://tavern.test/')
  if (beforeRender) await page.evaluate(beforeRender)
  let script = await browserReactScript()
  script += `window.__ModuleLoader__={load(definition){window.client=definition.factory(name=>name==='react'?modules.react:{});}};`
  await page.addScriptTag({ content: script })
  let source = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  // the core's slot rows component, for a page that also mounts the stage's settings (they take it as an option)
  if (exposeModelSlotGroups) source = source.replace('function TavernModelSlotGroups({', 'window.__modelSlotGroups = TavernModelSlotGroups; function TavernModelSlotGroups({')
  await page.addScriptTag({ content: source })
  const section = provided || sidebarStart ? '' : pageSection || (sessionId ? 'dsh-tavern: conversation settings tab' : 'dsh-tavern: settings section')
  await page.evaluate(async ({ section, provided, sessionId, stageClient, sidebarStart, renderPropsCode }) => {
    let Settings
    // stageClient: the core's stage client hold and loader run, and the loader's ctx.plugin applies the stage plugin
    // with the core's tavernStageFrontend.
    const services = {}, stageEffects = ['dsh-tavern: stage client hold', 'dsh-tavern: stage client loader']
    const stageCtx = { provide() {}, get: name => services[name], effect(run) { return run() } }
    const tabs = new Map()
    const sidebarEffects = ['dsh-tavern: stage config tab', 'dsh-tavern: header item catalog', 'dsh-tavern: native start page', 'tavernUi.registerStartGroup()']
    if (sidebarStart) tabs.set('dsh-asset-library:library', { id: 'dsh-asset-library:library', title: '舞台素材', order: 9.5 })
    const registry = { guide: () => [...tabs.values()].sort((a, b) => a.order - b.order)
      .map(tab => ({ kind: tab.id, title: () => tab.title, icon: tab.icon })) }
    window.__tavernTestSlots = []
    const testSignals = new EventTarget()
    window.__tavernTestSignal = (id, kind) => testSignals.dispatchEvent(new Event(id + ':' + kind))
    const host = {
      inject(names, apply) { if (sidebarStart && names[0] === 'sidebarRightTabs') apply(host); return { dispose() {} } },
      // A provided panel (e.g. ttsLineSpeechSettings, placed by another plugin's page) renders as the page itself.
      provide(name, value) { services[name] = value; if (name === provided) Settings = () => value.render() },
      plugin(plugin) { return plugin.apply(stageCtx) },
      get(name) { if (name === 'sidebarRightTabs') return registry },
      sessions: { subagentAddress() {}, list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
      betterSidebar: { registerTab(spec) {
        tabs.set(spec.id, spec)
        if (!sidebarStart) Settings = () => modules.react.createElement(spec.component, { scope: { sessionId } })
      } },
      tavernSessionSignals: { subscribe(id, kind, listener) {
        const key = id + ':' + kind
        testSignals.addEventListener(key, listener)
        return () => testSignals.removeEventListener(key, listener)
      } },
      effect(run, label) { if (label === section || (stageClient && stageEffects.includes(label)) || (sidebarStart && sidebarEffects.includes(label))) return run() },
      slots: { inject(name, run) { window.__tavernTestSlots.push(name); return run() }, register(_spec, Component) { Settings = Component } }
    }
    window.client.apply(host)
    if (sidebarStart) services.tavernUi.registerStartGroup({ title: '舞台装置', tabs: ['dsh-asset-library:library'] })
    // A renamed or removed section would otherwise leave the test waiting forever.
    for (const deadline = Date.now() + 3000; !Settings; await new Promise(resolve => setTimeout(resolve, 10)))
      if (Date.now() > deadline) throw new Error('No settings section ' + JSON.stringify(section || provided))
    const renderProps = renderPropsCode ? new Function('modules', 'return ' + renderPropsCode)(modules) : {};
    const root = modules['react-dom/client'].createRoot(document.querySelector('main'))
    const render = (Component, props) => root.render(modules.react.createElement(Component, props))
    const useTabInfo = () => ({ tab: { actions: { openTab: id => render(tabs.get(id).component, { scope: {} }) } } })
    render(Settings, { renderSlot: () => null, useTabInfo, ...renderProps })
  }, { section, provided, sessionId, stageClient, sidebarStart, renderPropsCode })
  t.after(() => { if (errors.length) throw Error(errors.join('\n')) })
  return { page, calls }
}
