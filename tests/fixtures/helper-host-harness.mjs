import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let descriptor
vm.runInNewContext(await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
export const helperClient = descriptor.factory(() => ({}))

export function helperHostHarness(context = {}, options = {}) {
  const scripts = [{ id: 'a', content: '' }, { id: 'b', content: '' }]
  const html = helperClient.buildTavernHelperScriptDocument({ token: 'host-test', scripts, context })
  let source = html.match(/<script data-dsh-tavern-helper-script>([\s\S]*?)<\/script>/)[1]
  const download = 'import(window.__dshTavernStaticAssetUrl("https://testingcf.jsdelivr.net/npm/zod@4.4.3/+esm"))'
  assert(source.includes(download))
  // The host implementation is real; only the unrelated CDN dependency is excluded.
  source = source.replace(download, 'Promise.resolve({})')
  const sent = [], listeners = new Map()
  const parent = { postMessage(message) { sent.push(message); options.onCall?.(message) } }
  const window = { parent, structuredClone, setTimeout, clearTimeout, localStorage: {},
    console: { info() {}, warn() {}, error() {} },
    addEventListener(name, listener) { listeners.set(name, listener) },
    _: { mergeWith(...args) { return Object.assign({}, ...args.slice(0, -1)) } }
  }
  window.window = window
  vm.runInNewContext(source, window)
  function receive(data) { listeners.get('message')({ source: parent, data: { token: 'host-test', ...data } }) }
  return { window, sent, receive,
    reply(call, result, ok = true) { receive({ type: 'dsh-tavern-helper-response', requestId: call.requestId, ok, result, error: ok ? undefined : result }) },
    calls() { return sent.filter(message => message.type === 'dsh-tavern-helper-call') }
  }
}
