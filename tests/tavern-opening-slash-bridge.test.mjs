import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import {
  applyPendingOpeningCommand, parseOpeningCommand, parsePendingOpeningCommand
} from '../tavern-plugin/lib/domain/opening-command.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
let descriptor
vm.runInNewContext(clientSource, { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(function () { return {} })

// Wizards written for SillyTavern send the opening input ("/send …") and the
// generation term ("/trigger") as two calls, and persist their own data in
// between. Starting on the first call unmounts the preview page, so the host
// remembers that text and only starts when the /trigger arrives.
function harness() {
  const listeners = new Map()
  const replies = [], calls = [], submitted = [], commands = []
  const draft = { pending: {} }
  // Other page calls (a wizard's persist) wait here until the test opens the gate.
  const gate = {}
  gate.promise = new Promise(resolve => { gate.open = resolve })
  gate.open()
  const frame = { contentWindow: { postMessage(message) { replies.push(message) } } }
  const hostWindow = {
    crypto: { randomUUID() { return 'opening-token' } },
    sessionStorage: { getItem() { return null }, setItem() {} },
    document: null, setTimeout, clearTimeout,
    addEventListener(name, handler) { listeners.set(name, handler) },
    removeEventListener(name, handler) { listeners.delete(name) }
  }
  const lifecycle = client.createTavernMessageFrameLifecycle({
    content: '<button>入局</button>', turn: 0, partIndex: 0,
    openingPreview: { swipes: ['opening'], openingIds: ['primary'], selectedIndex: 0, preparationId: 'prep-1' },
    helperContext: { playerName: '旅人', characterName: '角色' },
    onSubmitOpening: async function (text) { submitted.push(text); return { taken: true } }
  }, {
    window: hostWindow,
    rpc: async function (method, payload) {
      calls.push({ method, payload })
      if (method !== 'callOpeningRuntime' || payload.method !== 'prepareOpeningCommand') { await gate.promise; return { updated: true } }
      // The same deferral the preparation draft performs on the host.
      const pending = parsePendingOpeningCommand(payload.args.line)
      if (pending) {
        Object.assign(draft.pending, pending)
        commands.push({ ...pending, deferred: true })
        return { deferred: true, input: '' }
      }
      const command = applyPendingOpeningCommand(parseOpeningCommand(payload.args.line), draft.pending, payload.args.line)
      draft.pending = {}
      commands.push({ ...command, deferred: false })
      return { deferred: false, input: command.input }
    }
  })
  const doc = lifecycle.snapshot().visibleDocument
  doc.ref(frame)
  const stop = lifecycle.start(function () {})
  return {
    calls, commands, replies, submitted, doc,
    hold() { gate.promise = new Promise(resolve => { gate.open = resolve }) },
    release() { gate.open() },
    call(method, args, requestId) {
      listeners.get('message')({ source: frame.contentWindow, data: { type: 'dsh-tavern-helper-call', token: doc.token, requestId, method, args } })
    },
    send(line, requestId) {
      listeners.get('message')({ source: frame.contentWindow, data: { type: 'dsh-tavern-helper-call', token: doc.token, requestId, method: 'triggerTavernSlash', args: { line } } })
    },
    stop
  }
}
const settle = function () { return new Promise(resolve => setImmediate(resolve)) }

test('其余未以 /trigger 结束的命令仍然明确拒绝，只读命令照旧应答', async () => {
  const h = harness()
  try {
    h.send('/unknown 指令', 'bad')
    await settle()
    assert.equal(h.calls.length, 0)
    assert.equal(h.replies.length, 1)
    assert.equal(h.replies[0].ok, false)
    assert.match(h.replies[0].error, /只执行 \/send 文本、\/sys 文本或以 \/trigger 结束/)
    h.send('/pass {{char}}', 'pass')
    await settle()
    // The reply object comes from the vm realm, so compare its shape as data.
    assert.equal(JSON.stringify(h.replies[1].result), JSON.stringify({ pipe: '角色' }))
  } finally { h.stop() }
})
