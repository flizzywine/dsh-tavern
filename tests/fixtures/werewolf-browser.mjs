import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { createPluginHost } from './plugin-host.mjs'
import { createBackgroundNativeRuntime } from './background-native-runtime.mjs'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { resolveTavernDataRoot } from '../../tavern-plugin/lib/domain/tavern-data.js'
import { gameMode, actionFor } from '../../examples/werewolf/plugin/rules.mjs'

const root = resolveTavernDataRoot(), output = resolve('output/werewolf')
await mkdir(root, { recursive: true }); await mkdir(output, { recursive: true })
await writeFile(join(root, 'sessions.json'), JSON.stringify({ 'werewolf-game': 'werewolf-chat' }))
await createChatJournalStore({ dataRoot: root }).update('werewolf-chat', () => ({ id: 'werewolf-chat', _storageRevision: 1, sessionId: 'werewolf-game', mode: 'story', cardPath: 'cards/wolf.json',
  cardDefinitionSnapshot: { name: '狼人杀', first_mes: '开局', extensions: {} }, backgroundConfigVersion: 1, conversationFeaturesVersion: 1,
  timeline: { branchId: 'test', revision: 0 }, messages: [{ role: 'assistant', turn: 1, text: '开局', sourceText: '开局' }] }))
const native = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE, { modelResponse: input => {
  const text = input.messages.filter(m => m.role === 'user').flatMap(m => m.content || []).map(b => b.text).find(t => t?.startsWith('{') || t?.startsWith('['))
  const data = JSON.parse(text)
  return [{ type: 'text', text: Array.isArray(data) ? '请继续。' : JSON.stringify(data.action.kind === 'speak' ? { text: '请关注公开投票。' } : { target: data.action.targets[0] }) }]
} })
const host = await createPluginHost({ withTools: true })
const plugin = Object.create(host.services.get('tavern')); plugin.ctx = { fiber: { name: 'dsh-card-werewolf' } }
plugin.gameMode({ ...gameMode,
  create: args => { const result = gameMode.create(args); result.state.players.forEach((p, i) => { p.role = ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'][i] }); result.state.queue = [1, 2]; return result },
  advance: args => gameMode.advance({ ...args, agent: ({ id, system, prompt, signal }) => native.runBackground({
    task: 'plugin', pluginName: 'werewolf/' + id, sessionId: 'scene-parent', selection: { provider: 'scene-fixture', model: 'fixture-text' },
    ownPrefix: true, system, taskText: prompt, tools: [], messages: [], signal: args.signal }) }) })
const source = await readFile(new URL('../../tavern-plugin/src/client/features/reply-observer.js', import.meta.url), 'utf8')
const surface = source.slice(source.indexOf('function TavernGameModeSurface('), source.indexOf('function TavernComposerSlot('))
const pluginClient = await readFile(new URL('../../examples/werewolf/plugin/client.js', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
let bundle = 'const modules = {};\n'
for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
  const code = await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')
  bundle += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${code}\nreturn module.exports;})();\n`
}
const script = bundle + `const React=modules.react; const {createRoot}=modules['react-dom/client'];
const registry = new Map();
const tavernUiExtensions = {gameModeView: key => registry.get(key)};
const useTavernUiExtensions = () => {};
const tavernSessionSignals = {subscribe: () => () => {}};
const tavernPluginBoundary = () => function Boundary(p) { return p.children; };
async function rpc(method, args, sessionId) { const r = await fetch('/rpc/' + method, {method:'POST',body:JSON.stringify({...args,sessionId})}); const result = await r.json(); if (!result.ok) throw Error(result.error); return result; }
window.__ModuleLoader__ = {load: descriptor => descriptor.factory(name => React).apply({tavernUi:{registerGameModeView: input => registry.set('dsh-card-werewolf:' + input.name, {owner:'dsh-card-werewolf',render:input.render})}})};
${pluginClient}
${surface}
createRoot(document.getElementById('app')).render(React.createElement(TavernGameModeSurface,{sessionId:'werewolf-game'}));`
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<meta charset="utf-8"><title>狼人杀验证</title><div id="app"></div><script src="/app.js"></script>'); return }
  if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(script); return }
  try { let body = ''; for await (const chunk of req) body += chunk; const result = await host.rpc(req.url.split('/').at(-1), JSON.parse(body)); res.end(JSON.stringify(result)) }
  catch (error) { res.end(JSON.stringify({ ok: false, error: error.message })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true, ...(process.env.TAVERN_BROWSER_CHANNEL ? { channel: process.env.TAVERN_BROWSER_CHANNEL } : {}) })
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  page.setDefaultTimeout(10000)
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port)
  await page.getByRole('button', { name: '开始 六人狼人杀' }).click()
  await page.getByRole('heading', { name: '月下六席 · 狼人杀' }).waitFor()
  await page.getByLabel('你的发言').fill('今晚一起仔细观察。')
  await page.getByRole('button', { name: '提交发言' }).click()
  await page.getByRole('button', { name: '继续下一步' }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '继续下一步' }).waitFor()
  await page.getByRole('button', { name: '回退一步' }).click()
  await page.getByLabel('你的发言').waitFor()
  await page.getByRole('button', { name: '撤销回退' }).click()
  await page.getByRole('button', { name: '继续下一步' }).waitFor()
  for (let i = 0; i < 100; i++) {
    const view = (await host.rpc('gameMode', { sessionId: 'werewolf-game' })).mode
    if (view.data.winner) break
    if (view.data.action.kind === 'speak') { await page.getByLabel('你的发言').fill('我的发言：请按投票记录判断。'); await page.getByRole('button', { name: '提交发言' }).click() }
    else if (view.data.action.kind === 'continue') await page.getByRole('button', { name: '继续下一步' }).click()
    else await page.getByRole('button', { name: view.data.action.targets[0] + '号', exact: true }).click()
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).some(b => b.textContent === '角色正在思考…'))
    // Wait for the committed revision to reach the actual UI before the next action.
    await page.waitForFunction(() => document.querySelector('section button')?.disabled === true)
  }
  const final = (await host.rpc('gameMode', { sessionId: 'werewolf-game' })).mode
  assert.ok(final.data.winner); assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'werewolf-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(output, 'werewolf-mobile.png'), fullPage: true })
  await writeFile(join(output, 'browser-report.json'), JSON.stringify({ winner: final.data.winner, checkpoints: final.length, requests: native.requests.length, errors }, null, 2))
  console.log('werewolf browser completed', final.data.winner, final.length)
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await host.dispose(); await native.dispose() }
