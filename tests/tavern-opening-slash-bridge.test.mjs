import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
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
      if (method !== 'callOpeningRuntime') return {}
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
    send(line, requestId) {
      listeners.get('message')({ source: frame.contentWindow, data: { type: 'dsh-tavern-helper-call', token: doc.token, requestId, method: 'triggerTavernSlash', args: { line } } })
    },
    stop
  }
}
const settle = function () { return new Promise(resolve => setImmediate(resolve)) }

test('单独的 /send 只记录文本，页面留在原地，等 /trigger 才开局', async () => {
  const h = harness()
  try {
    h.send('/send 我推门而入', 'one')
    await settle()
    assert.equal(h.calls.length, 1)
    assert.equal(h.calls[0].payload.method, 'prepareOpeningCommand')
    assert.equal(h.calls[0].payload.args.line, '/send 我推门而入')
    assert.equal(h.calls[0].payload.args.openingId, 'primary')
    assert.deepEqual(h.submitted, [], '记录文本不等于开局')
    assert.equal(h.replies.length, 1)
    assert.equal(h.replies[0].ok, true)
    assert.equal(JSON.stringify(h.replies[0].result), JSON.stringify({ pipe: '', deferred: true }))
    h.send('/trigger', 'go')
    await settle()
    assert.equal(h.calls[1].payload.args.line, '/trigger')
    assert.deepEqual(h.submitted, ['我推门而入'])
    assert.equal(h.replies[1].ok, true)
  } finally { h.stop() }
})

test('单独的 /sys 先留住设定，随后的 /trigger 带着它开局', async () => {
  const h = harness()
  try {
    h.send('/sys 天启三年', 'sys')
    await settle()
    assert.deepEqual(h.submitted, [])
    assert.equal(h.replies[0].ok, true)
    h.send('/trigger', 'go')
    await settle()
    assert.equal(h.commands[1].deferred, false)
    assert.equal(h.commands[1].systemText, '天启三年')
    assert.deepEqual(h.submitted, ['继续。'])
  } finally { h.stop() }
})

test('已经带 /trigger 的管道原样传递，/send 优先于留住的设定', async () => {
  const whole = harness()
  try {
    whole.send('/send 你好 | /trigger', 'whole')
    await settle()
    assert.equal(whole.calls[0].payload.args.line, '/send 你好 | /trigger')
    assert.equal(whole.commands[0].deferred, false)
    assert.deepEqual(whole.submitted, ['你好'])
  } finally { whole.stop() }
  const h = harness()
  try {
    h.send('/sys 只作旁白', 'sys')
    await settle()
    h.send('/send 我推门而入', 'one')
    await settle()
    assert.deepEqual(h.submitted, [], '设定与文本各记一次，都不开局')
    h.send('/trigger', 'go')
    await settle()
    assert.equal(h.commands.at(-1).systemText, '只作旁白')
    assert.deepEqual(h.submitted, ['我推门而入'])
  } finally { h.stop() }
})

test('开局之后重复的 /trigger 不再新建一局', async () => {
  const h = harness()
  try {
    h.send('/send 我推门而入', 'one')
    await settle()
    h.send('/trigger', 'go')
    await settle()
    h.send('/trigger', 'again')
    await settle()
    assert.deepEqual(h.submitted, ['我推门而入'], '只提交一次')
    assert.equal(h.replies.at(-1).ok, true)
  } finally { h.stop() }
})

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

test('待开局文本的解析只认得单独一条 /send 或 /sys', () => {
  assert.deepEqual(parsePendingOpeningCommand('/send 我推门而入'), { sendText: '我推门而入' })
  assert.deepEqual(parsePendingOpeningCommand('/sys 天启三年'), { systemText: '天启三年' })
  assert.equal(parsePendingOpeningCommand('/trigger'), null)
  assert.equal(parsePendingOpeningCommand('/pass {{user}}'), null)
  assert.equal(parsePendingOpeningCommand('/send 你好 | /trigger'), null)
  assert.equal(parsePendingOpeningCommand('/echo 好'), null)
  assert.deepEqual(applyPendingOpeningCommand({ input: '继续。' }, { sendText: '我推门而入' }, '/trigger'), { input: '我推门而入' })
  assert.deepEqual(applyPendingOpeningCommand({ input: '继续。' }, { systemText: '天启三年' }, '/trigger'), { input: '继续。', systemText: '天启三年', removeGreeting: false })
  assert.deepEqual(applyPendingOpeningCommand({ input: '你好' }, { sendText: '我推门而入' }, '/send 你好 | /trigger'), { input: '你好' })
})
