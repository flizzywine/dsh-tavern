import {createTemplateHistoryPipeClient} from './template-history-pipe.js'
import { readFile } from 'node:fs/promises'
import { JSDOM, VirtualConsole } from 'jsdom'
import { estimateWorldBookTokens } from './worldbook-activation.js'

// Templates live in this disposable process, never in the service's JS realm.
// jsdom supplies browser APIs; it is not the process isolation boundary.
let session, dom, sequence = 0
const pending = new Map()
const send = message => { if (process.connected) process.send(message) }
const rpc = (method, args) => {
  // Upstream schedules token statistics after returning its operation receipt.
  // This pure estimate needs no session lease: calculate it here, using the
  // same estimator as the host, without admitting expired state-changing RPCs.
  if (method === 'countFullTemplateTokens') return Promise.resolve({ tokens: estimateWorldBookTokens(args.text), estimator: 'unicode-estimate' })
  return new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    send({ type: 'rpc', id, method, args })
  })
}
rpc.readHistory = createTemplateHistoryPipeClient()
async function initialize(sessionId, readOnly = false) {
  dom = new JSDOM('<!doctype html><div id="extensions_settings"></div>', {
    url: 'https://template.invalid/', runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  })
  const w = dom.window
  Object.assign(w, { structuredClone, TextEncoder, TextDecoder, fetch, AbortController, AbortSignal })
  if (readOnly) {
    const blocked = () => { throw new Error('人物卡更新预览不允许网络请求') }
    w.fetch = blocked
    w.XMLHttpRequest = class { constructor() { blocked() } }
    w.WebSocket = class { constructor() { blocked() } }
    w.navigator.sendBeacon = blocked
  }
  w.toastr = Object.fromEntries(['error', 'warning', 'info', 'success'].map(name => [name, () => {}]))
  for (const file of ['../vendor/runtime-assets/jquery/jquery.min.js', '../vendor/runtime-assets/lodash/lodash.min.js', '../vendor/st-prompt-template/server-artifact/engine.js']) {
    w.eval(await readFile(new URL(file, import.meta.url), 'utf8'))
  }
  session = await w.DSHTemplate.createServerTemplateSession({ sessionId, rpc,
    settingsHtml: await readFile(new URL('../vendor/st-prompt-template/upstream/settings.html', import.meta.url), 'utf8') })
}
process.on('message', async message => {
  if (message.type === 'rpc-result') {
    const item = pending.get(message.id)
    if (!item) return
    pending.delete(message.id)
    // An error crosses the process boundary as its message and code (a code decides retry vs failure upstream).
    message.error ? item.reject(Object.assign(new Error(message.error), message.code ? { code: message.code } : {})) : item.resolve(message.result)
    return
  }
  try {
    let result
    if (message.type === 'initialize') await initialize(message.sessionId, message.readOnly)
    else if (message.type === 'project') result = await session.project(message.operation, message.input)
    else if (message.type === 'synchronize') result = await session.synchronize()
    else throw new Error('Unknown server template operation')
    send({ type: 'result', id: message.id, result })
  } catch (error) { send({ type: 'result', id: message.id, error: String(error.message || error), ...(error?.code ? { code: String(error.code) } : {}) }) }
})
process.on('disconnect', () => process.exit(0))
