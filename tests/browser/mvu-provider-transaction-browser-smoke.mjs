// Run: node tests/browser/mvu-provider-transaction-browser-smoke.mjs
// Exercises the pinned official MVU bundle through the real browser Helper bridge
// and the isolated settlement transaction adapter. No Tavern profile is loaded.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { chromium } from 'playwright'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { readOfficialMvuBundle } from '../../tavern-plugin/lib/domain/official-mvu-assets.js'
import { readTavernRuntimeAsset, TAVERN_RUNTIME_ASSET_PREFIX } from '../../tavern-plugin/lib/domain/tavern-runtime-assets.js'
import { formatMvuUpdateCommand } from '../../tavern-plugin/lib/domain/mvu-background-settlement.js'

const clientSource = await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
let descriptor
vm.runInNewContext(clientSource, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(() => ({}))
const bundle = (await readOfficialMvuBundle()).body
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const command = formatMvuUpdateCommand({ operations: [{ op: 'replace', path: '/stat_data/hp', value: 9 }] })
const initial = { stat_data: { hp: 10 }, schema: { type: 'object', properties: { hp: { type: 'number' } } },
  display_data: {}, delta_data: {}, initialized_lorebooks: {} }

async function scenario(enabled) {
  const token = 'mvu-provider-' + enabled
  const body = '测试正文\n' + command
  const chat = { id: token, sessionId: token, mode: 'story', mvu: { enabled: true }, tavernHelperLifecycleRevision: 1,
    messages: [
      { role: 'assistant', text: '开场', swipeId: 0, swipes: ['开场'], variables: [structuredClone(initial)] },
      { role: 'user', text: '继续', swipeId: 0, swipes: ['继续'], variables: [structuredClone(initial)] },
      { role: 'assistant', text: body, swipeId: 0, swipes: [body], variables: [structuredClone(initial)] }
    ] }
  let page, browser, adapter
  const rpcCalls = [], writes = [], audit = []
  let dispatchReceipt
  const context = await import('../../tavern-plugin/lib/domain/tavern-helper-context.js')
  const html = client.buildTavernHelperScriptDocument({ token, scripts: [{ id: '__dsh_official_mvu__', name: '官方 MVU',
    system: 'official-mvu', content: "await import(new URL('/mvu.js', document.baseURI).href);", data: {}, buttons: [] }],
    context: { ...context.projectTavernHelperContext(chat), characterName: '测试卡', character: { name: '测试卡', data: {} } } })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html)
    if (url.pathname === '/mvu.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle)
    if (url.pathname === '/version') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pkgVersion: '1.12.14' }))
    if (url.pathname === '/favicon.ico') return res.writeHead(204).end()
    if (url.pathname.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)) {
      try { const asset = await readTavernRuntimeAsset(url.pathname); return res.writeHead(200, { 'content-type': asset.mediaType }).end(asset.body) }
      catch (error) { return res.writeHead(404).end(error.message) }
    }
    if (url.pathname === '/bridge') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const call = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      rpcCalls.push(call)
      try {
        let result
        if (call.method === 'updateTavernHelperVariables') result = await adapter.updateVariables(token, call.args.option,
          call.args.variables, call.lifecycleRevision, call.eventId, call.args.contextBaseline)
        else if (call.method === 'updateTavernHelperMessages') result = await adapter.updateMessages(token, call.args.messages,
          call.lifecycleRevision, call.eventId)
        else if (call.method === 'saveTavernExtensionSettings') result = { updated: true, extensionSettings: call.args.settings }
        else throw new Error('unexpected browser RPC: ' + call.method)
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, result }))
      } catch (error) {
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: error.message }))
      }
    }
    if (url.pathname === '/api/dsh-tavern/static-assets') return res.writeHead(404).end('unused')
    return res.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    browser = await chromium.launch({ headless: true, executablePath: chromePath })
    page = await browser.newPage()
    page.on('console', message => { if (message.type() === 'error') console.error('[browser]', message.text()) })
    adapter = createTavernScriptHostAdapter({ resolveChat: async () => structuredClone(chat), writeChat: async (draft, metadata) => writes.push(metadata?.source),
      diagnostics: { record: async (_sessionId, entry) => audit.push(entry) },
      readCard: async () => ({}), worldBooks: { bound: async () => null },
      globalVariables: { read: async () => ({}), save: async value => value },
      scriptDispatch: { status: () => ({ ready: true, busy: false }), async dispatch(_sessionId, name, args, eventContext, work) {
        await page.evaluate(async ({ name, args, eventContext, eventId, enabled, token }) => {
          // Switch the upstream unique-script preference through its actual event;
          // controlledStoppableEventOn gates the official handler on this value.
          await window.eventEmit('th_unique_check.MVU变量框架', enabled ? window.getScriptId() : '__not_the_active_mvu__')
          window.postMessage({ type: 'dsh-tavern-helper-event', name, args, eventId, token }, '*')
        }, { name, args, eventContext, eventId: work.eventId, enabled, token })
        dispatchReceipt = await page.evaluate(async eventId => {
          for (let i = 0; i < 200; i++) {
            const receipt = window.__mvuReceipts?.[eventId]
            if (receipt) return { handled: !receipt.error, error: receipt.error }
            await new Promise(resolve => setTimeout(resolve, 25))
          }
          throw new Error('browser event completion timed out')
        }, work.eventId)
        return dispatchReceipt
      } }
    })
    await page.addInitScript(({ bridgePath }) => {
      window.__mvuReceipts = Object.create(null)
      window.__mvuSeen = []
      addEventListener('message', async event => {
        const data = event.data
        if (data?.type) window.__mvuSeen.push(data.type + ':' + String(data.name || data.method || ''))
        if (data?.type === 'dsh-tavern-helper-event-complete') window.__mvuReceipts[data.eventId] = data
        if (data?.type !== 'dsh-tavern-helper-call') return
        try {
          const response = await fetch(bridgePath, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(data) }).then(value => value.json())
          window.postMessage({ type: 'dsh-tavern-helper-response', requestId: data.requestId,
            ok: response.ok, result: response.result, error: response.error, token: data.token }, '*')
        } catch (error) {
          window.postMessage({ type: 'dsh-tavern-helper-response', requestId: data.requestId, ok: false, error: error.message, token: data.token }, '*')
        }
      })
    }, { bridgePath: `http://127.0.0.1:${server.address().port}/bridge` })
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction(() => window.Mvu && window.Mvu.__dshBootstrap !== true
      && typeof window.Mvu.parseMessage === 'function', null, { timeout: 20000 })
    // Core startup persists its own global/chat initialization before the game
    // turn; the assertions below concern only the isolated settlement interval.
    rpcCalls.length = 0
    writes.length = 0
    const base = structuredClone(chat.messages[2].variables[0])
    const result = await adapter.settleMvuUpdate({ operationId: token, sessionId: token, messageId: 2, swipeId: 0,
      expectedLifecycleRevision: 1, storyText: '', command, validate: ({ before, after }) => ({ changes: [], sideEffects: [],
        failures: before.stat_data.hp === after.stat_data.hp ? [{ message: '未观察到对应变量变化' }] : [] }) })
    if (enabled) {
      assert.equal(result.updated, true, JSON.stringify({ validation: result.validation, rpcCalls: rpcCalls.map(call => call.method),
        debug: await page.evaluate(() => ({ scriptId: window.getScriptId?.(), state: window.Mvu && Object.keys(window.Mvu), vars: window.getVariables?.({ type: 'message', message_id: 2 }) })) }))
      assert.equal(result.effect.changes.some(change => change.path.join('.') === 'messages.2.variables.0.stat_data.hp' && change.value === 9), true)
      assert.equal(result.variables.stat_data.hp, 9)
      assert.deepEqual(writes, [], JSON.stringify({ message: 'the settlement must remain isolated until its caller commits the effect',
        writes, calls: rpcCalls.map(call => ({ method: call.method, eventId: call.eventId, option: call.args?.option })) }))
      assert.equal(dispatchReceipt.handled, true)
      assert.ok(rpcCalls.some(call => call.method === 'updateTavernHelperVariables'
        && call.args.option?.type === 'message' && call.eventId.startsWith('mvu-work:')))
      assert.ok(audit.some(entry => entry.stage === 'prepared'))
    } else {
      assert.equal(result.rejected, true)
      assert.equal(result.validation.failures[0].message, '未观察到对应变量变化')
      assert.equal(result.updated, false)
      assert.equal(dispatchReceipt.handled, true, 'no-op handler completion must not be mistaken for a variable effect')
      assert.ok(audit.some(entry => entry.stage === 'runtime-completed' && entry.handled === true))
      assert.ok(audit.some(entry => entry.stage === 'validation-rejected'))
      assert.deepEqual(writes, [])
    }
    assert.equal(chat.messages[2].variables[0].stat_data.hp, base.stat_data.hp)
    assert.equal(rpcCalls.filter(call => call.method === 'updateTavernHelperVariables' && call.eventId.startsWith('mvu-work:')).length, enabled ? 1 : 0,
      JSON.stringify(rpcCalls.map(call => ({ method: call.method, eventId: call.eventId, option: call.args?.option }))))
    return { enabled, result, dispatchReceipt }
  } finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
  }
}

const outcomes = []
for (const enabled of [true, false]) outcomes.push(await scenario(enabled))
console.log('MVU_PROVIDER_TRANSACTION_BROWSER_SMOKE=' + JSON.stringify(outcomes.map(({ enabled, result, dispatchReceipt }) => ({
  enabled, dispatchHandled: dispatchReceipt.handled, committedCandidate: result.updated === true, rejected: result.rejected === true,
  hp: result.variables?.stat_data?.hp, failures: result.validation?.failures?.length,
  effectChanges: result.effect?.changes?.length
}))))
