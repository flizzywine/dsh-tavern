import { readFile } from 'node:fs/promises'
import { browserReactScript } from './browser-react.mjs'
import { chromium } from 'playwright'

// Exercise the public plugin registration and real React effects/events. Only
// the DSH host and HTTP boundary are fixtures; no component source extraction.
export async function openTavernSettings(t, { settings, respond, exposeConversationModels = false, section: pageSection, provided, sessionId, beforeRender } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  const calls = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://tavern.test/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
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
      else if (method === 'getSpineRuntimeStatus') result = { installed: false, runtime: '', importSupported: true }
      else if (method === 'getWebSearchStatus') result = { provider: 'tavern-search', attempts: [] }
      else if (method === 'listPresets') result = { presets: [], activePresetPath: '' }
      else if (method === 'getUserPreferenceProfile') result = { userProfile: { profiles: [], defaultProfileId: '' } }
      else if (method === 'getCandidatePreferences') result = { candidateDismissMode: 'after-fill' }
      else if (method === 'confirmSessionPatch') result = {}
      else if (method === 'getDefaultWritingSkills') result = { skills: [] }
      else if (method === 'listUserPlugins') result = { plugins: [], dir: '/tmp/tavern/plugins' }
      else if (method === 'managedModsList') result = { revision: 'fixture', mods: [] }
      else if (method === 'listLegacyPlugins') result = { plugins: [] }
      else if (method === 'checkUserPluginUpdates') result = { plugins: [] }
      else if (method === 'getActiveInterfaceSkin') result = { id: null, css: '' }
      else if (method === 'listInterfaceSkins') result = { active: null, skins: [] }
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
  if (exposeConversationModels) source = source.replace('function TavernConversationBackgroundModel(props) {', 'window.__modelSlotsChat = TavernConversationBackgroundModel; function TavernConversationBackgroundModel(props) {')
  await page.addScriptTag({ content: source })
  const section = provided ? '' : pageSection || (sessionId ? 'dsh-tavern: conversation settings tab' : 'dsh-tavern: settings section')
  await page.evaluate(async ({ section, provided, sessionId }) => {
    let Settings
    window.client.apply({
      inject() { return { dispose() {} } },
      // A provided panel (e.g. ttsLineSpeechSettings, placed by another plugin's page) renders as the page itself.
      provide(name, value) { if (name === provided) Settings = () => value.render() },
      get() {},
      sessions: { subagentAddress() {} },
      betterSidebar: { registerTab(spec) { Settings = () => modules.react.createElement(spec.component, { scope: { sessionId } }); } },
      tavernSessionSignals: { subscribe() { return () => {} } },
      effect(run, label) { if (label === section) return run() },
      slots: { inject(_name, run) { return run() }, register(_spec, Component) { Settings = Component } }
    })
    // A renamed or removed section would otherwise leave the test waiting forever.
    for (const deadline = Date.now() + 3000; !Settings; await new Promise(resolve => setTimeout(resolve, 10)))
      if (Date.now() > deadline) throw new Error('No settings section ' + JSON.stringify(section || provided))
    modules['react-dom/client'].createRoot(document.querySelector('main')).render(modules.react.createElement(Settings, { renderSlot: () => null }))
  }, { section, provided, sessionId })
  t.after(() => { if (errors.length) throw Error(errors.join('\n')) })
  return { page, calls }
}
