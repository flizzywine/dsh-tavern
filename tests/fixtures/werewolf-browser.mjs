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
let failNextNpc = true
plugin.gameMode({ ...gameMode,
  // This fixture hosts the standalone board, not the native conversation graph.
  // Native foreground projection and concurrent rows have separate regressions.
  foreground: undefined,
  create: args => { const result = gameMode.create({ ...args, input: { ...args.input, seat: 1 } }); result.state.players.forEach((p, i) => { p.role = ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'][i] }); result.state.queue = [1, 2]; return result },
  advance: args => gameMode.advance({ ...args, agent: ({ id, system, prompt, signal }) => {
    if (failNextNpc) { failNextNpc = false; throw new Error('测试网络中断') }
    return native.runBackground({
    task: 'plugin', pluginName: 'werewolf/' + id, sessionId: 'scene-parent', selection: { provider: 'scene-fixture', model: 'fixture-text' },
    ownPrefix: true, system, taskText: prompt, tools: [], messages: [], signal: args.signal }) } }) })
const source = await readFile(new URL('../../tavern-plugin/src/client/features/reply-observer.js', import.meta.url), 'utf8')
const surface = source.slice(source.indexOf('function TavernGameModeSurface('), source.indexOf('function TavernComposerSlot('))
const pluginClient = await readFile(new URL('../../examples/werewolf/plugin/client.js', import.meta.url), 'utf8')
const hostSkin = await readFile(new URL('../../tavern-plugin/packages/dsh-dream-skin/lib/skins/paper.css', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
let bundle = 'const modules = {};\n'
for (const [name, file] of [['react', 'react.production.js'], ['scheduler', 'scheduler.production.js'], ['react-dom', 'react-dom.production.js'], ['react-dom/client', 'react-dom-client.production.js']]) {
  const code = await readFile(join(dirname(require.resolve(name)), 'cjs', file), 'utf8')
  bundle += `modules[${JSON.stringify(name)}]=(()=>{const module={exports:{}};const exports=module.exports;const require=name=>modules[name];\n${code}\nreturn module.exports;})();\n`
}
const script = bundle + `const React=modules.react; const ReactDOM=modules['react-dom']; const {createRoot}=modules['react-dom/client'];
const registry = new Map();
const tavernUiExtensions = {gameModeView: key => registry.get(key)};
let extensionVersion = 0; const extensionListeners = new Set();
const useTavernUiExtensions = () => React.useSyncExternalStore(fn => { extensionListeners.add(fn); return () => extensionListeners.delete(fn); }, () => extensionVersion);
window.activateGamePlugin = () => { window.gamePluginReady = true; extensionVersion++; extensionListeners.forEach(fn => fn()); };
const tavernSessionSignals = {subscribe: () => () => {}};
const tavernPluginBoundary = () => function Boundary(p) { return p.children; };
async function rpc(method, args, sessionId) { if (args.op === 'list' && !window.gamePluginReady) { window.emptyListRead = true; return {modes:[]}; } const r = await fetch('/rpc/' + method, {method:'POST',body:JSON.stringify({...args,sessionId})}); const result = await r.json(); if (!result.ok) throw Error(result.error); return result; }
window.__ModuleLoader__ = {load: descriptor => descriptor.factory(name => modules[name]).apply({tavernUi:{registerGameModeView: input => registry.set('dsh-card-werewolf:' + input.name, {owner:'dsh-card-werewolf',render:input.render})}})};
${pluginClient}
${surface}
createRoot(document.getElementById('app')).render(React.createElement(TavernGameModeSurface,{sessionId:'werewolf-game'}));`
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>狼人杀验证</title><style>' + hostSkin + '\nbody{margin:16px;background:#faf9f6} #app div{background:transparent!important} #app button{background:#eee!important;color:#888!important}</style><div id="app"></div><script src="/app.js"></script>'); return }
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
  await page.waitForFunction(() => window.emptyListRead === true)
  assert.equal(await page.getByRole('button', { name: '开始 六人狼人杀' }).count(), 0)
  await page.evaluate(() => window.activateGamePlugin())
  await page.getByRole('button', { name: '开始 六人狼人杀' }).waitFor()
  await page.screenshot({ path: join(output, 'werewolf-launch.png'), fullPage: true })
  await page.getByRole('button', { name: '开始 六人狼人杀' }).click()
  await page.getByRole('heading', { name: '月下六席 · 狼人杀' }).waitFor()
  const dark = await page.getByRole('main', { name: '月下六席游戏桌面' }).evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
  assert.deepEqual(dark, { background: 'rgb(11, 18, 32)', color: 'rgb(238, 242, 250)' })
  await page.screenshot({ path: join(output, 'werewolf-ui-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'mobile layout must not overflow')
  await page.screenshot({ path: join(output, 'werewolf-ui-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.getByRole('button', { name: '展开视图' }).click()
  await page.getByRole('button', { name: '收起视图' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '展开视图' }).waitFor()
  await page.getByRole('button', { name: '我已了解，进入第一晚' }).click()
  await page.getByLabel('你的发言').fill('今晚一起仔细观察。')
  await page.getByRole('button', { name: '发送密谈', exact: true }).click()
  await page.getByRole('button', { name: '重试当前行动' }).waitFor()
  const failed = (await host.rpc('gameMode', { sessionId: 'werewolf-game' })).mode
  assert.equal(failed.data.history.filter(e => e.text === '今晚一起仔细观察。').length, 1, 'committed player speech survives a failed NPC call')
  await page.getByRole('button', { name: '重试当前行动' }).click()
  await page.getByRole('button', { name: '3号', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: '3号', exact: true }).waitFor()
  await page.getByRole('button', { name: '回退一步' }).click()
  await page.getByRole('button', { name: '恢复游戏' }).waitFor()
  await page.getByRole('button', { name: '撤销回退' }).click()
  await page.getByRole('button', { name: '恢复游戏' }).click()
  for (let i = 0; i < 150; i++) {
    const view = (await host.rpc('gameMode', { sessionId: 'werewolf-game' })).mode
    if (view.data.winner) break
    const action = view.data.action
    if (action.kind === 'speak') {
      await page.getByLabel('你的发言').fill('我的发言：请按投票记录判断。')
      await page.getByRole('button', { name: view.data.phase === 'wolf-talk' ? '发送密谈' : view.data.phase === 'last-words' ? '提交遗言' : '结束发言', exact: true }).click()
    } else if (action.kind === 'confirm') {
      await page.getByRole('button', { name: ({identity:'我已了解，进入第一晚',inspection:'记住结果，闭眼等待',daybreak:view.data.pendingLastWords?(view.data.currentSpeaker===view.data.human?'发表我的遗言':'听取首夜遗言'):'进入白天讨论','next-night':'进入第'+view.data.day+'晚'})[action.gate], exact:true }).click()
    } else if (action.kind !== 'auto') {
      await page.getByRole('button', { name: action.targets[0] + '号', exact: true }).click()
      await page.getByRole('button', { name: ({kill:'确认袭击',inspect:'确认查验',vote:'确认投票'})[action.kind], exact:true }).click()
    }
    await page.waitForFunction(revision => Number(document.querySelector('.dsh-tavern-game-mode')?.dataset.revision) > revision, view.revision)
  }
  await page.getByRole('region', { name: '终局复盘' }).waitFor()
  const final = (await host.rpc('gameMode', { sessionId: 'werewolf-game' })).mode
  assert.ok(final.data.winner); assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, 'werewolf-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(output, 'werewolf-mobile.png'), fullPage: true })
  await writeFile(join(output, 'browser-report.json'), JSON.stringify({ winner: final.data.winner, checkpoints: final.length, requests: native.requests.length, errors }, null, 2))
  console.log('werewolf browser completed', final.data.winner, final.length)
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); await host.dispose(); await native.dispose() }
