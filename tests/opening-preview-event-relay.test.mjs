import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

async function loadClient() {
  let descriptor
  const sandbox = { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console }
  vm.runInNewContext(clientSource, sandbox)
  return descriptor.factory(function () { return {} })
}

const client = await loadClient()

function makeWindow(pagehide) {
  const target = new EventTarget()
  const win = {
    CustomEvent,
    Event,
    document: target,
    addEventListener(name, fn) { if (name === 'pagehide' && pagehide) pagehide.push(fn); else target.addEventListener(name, fn) },
    removeEventListener(name, fn) { target.removeEventListener(name, fn) },
  }
  win.parent = win
  win.top = win
  return win
}

function buildPreviewScript() {
  const document = client.buildTavernFrameDocument({
    token: 'relay-token',
    content: '<button>选择开场</button>',
    openingPreview: { swipes: ['开场'], openingIds: ['primary'], selectedIndex: 0, preparationId: 'draft' }
  })
  return document.match(/<script data-dsh-tavern-opening-preview>([\s\S]*?)<\/script>/)[1]
}

function runPreviewScript() {
  const pagehide = []
  const parentWin = makeWindow(), frameWin = makeWindow(pagehide)
  frameWin.parent = parentWin
  frameWin.top = parentWin
  vm.runInNewContext(buildPreviewScript(), {
    window: frameWin, parent: parentWin, document: frameWin.document,
    addEventListener: (name, fn) => frameWin.addEventListener(name, fn),
    removeEventListener: (name, fn) => frameWin.removeEventListener(name, fn),
    setTimeout, clearTimeout, console,
  })
  return { parentWin, frameWin, pagehide }
}

test('中继过滤 dsh- 前缀与无对象 detail 的事件，释放后停止中继', () => {
  const { parentWin, frameWin, pagehide } = runPreviewScript()
  const received = []
  frameWin.document.addEventListener('hc1:opening-confirm', event => received.push(event.detail))
  parentWin.document.dispatchEvent(new CustomEvent('dsh-tavern-internal', { detail: { x: 1 } }))
  parentWin.document.dispatchEvent(new CustomEvent('plain-detail'))
  parentWin.document.dispatchEvent(new Event('no-detail'))
  assert.deepEqual(received, [])
  parentWin.document.dispatchEvent(new CustomEvent('hc1:opening-confirm', { detail: { chatId: 'c1' } }))
  assert.equal(received.length, 1)
  for (const handler of pagehide) handler()
  parentWin.document.dispatchEvent(new CustomEvent('hc1:opening-confirm', { detail: { chatId: 'c2' } }))
  assert.equal(received.length, 1, '释放后不再中继')
  const descriptor = Object.getOwnPropertyDescriptor(parentWin.document, 'dispatchEvent')
  assert.ok(!descriptor || descriptor.value === EventTarget.prototype.dispatchEvent, '释放后还原宿主 dispatchEvent')
})

function runPreviewScriptWithTransport() {
  const sent = []
  const parentWin = makeWindow(), frameWin = makeWindow()
  frameWin.parent = parentWin
  frameWin.top = parentWin
  parentWin.postMessage = (packet) => sent.push(packet)
  vm.runInNewContext(buildPreviewScript(), {
    window: frameWin, parent: parentWin, document: frameWin.document,
    addEventListener: (name, fn) => frameWin.addEventListener(name, fn),
    removeEventListener: (name, fn) => frameWin.removeEventListener(name, fn),
    setTimeout, clearTimeout, console,
  })
  return {
    parentWin, frameWin, sent,
    answer(packet, result) {
      const event = Object.assign(new Event('message'), { source: parentWin, data: { type: 'dsh-tavern-helper-response', token: packet.token, requestId: packet.requestId, ok: true, result } })
      frameWin.document.dispatchEvent(event)
    }
  }
}

test('延迟开局的 /send 让预览页里真的有"刚发送的那一楼"，卡写回时不至于落空', async () => {
  const run = runPreviewScriptWithTransport()
  const chat = run.frameWin.SillyTavern.getContext().chat
  assert.equal(chat.length, 1, '只有开场白')
  const pending = run.frameWin.triggerSlash('/send 我推门而入')
  const packet = run.sent.at(-1)
  assert.equal(packet.method, 'triggerTavernSlash')
  assert.equal(packet.args.line, '/send 我推门而入')
  run.answer(packet, { deferred: true, input: '' })
  await pending
  const rows = run.frameWin.SillyTavern.getContext().chat
  assert.equal(rows.length, 2)
  assert.equal(rows[1].is_user, true)
  assert.equal(rows[1].mes, '我推门而入')
  assert.equal(run.frameWin.getLastMessageId(), 1)
  // 大凉龙虎传 v4.11 就是按这个下标回写自己的开局记录
  const floor = rows.length - 1
  assert.equal(rows[floor].is_user, true)
  const read = run.frameWin.getChatMessages(floor, { role: 'user' })
  assert.equal(read.length, 1)
  assert.equal(read[0].message_id, 1)
  assert.equal(read[0].message, '我推门而入')
  // 再次 /send 改写同一层，不新增楼层
  const again = run.frameWin.triggerSlash('/send 我推门而入。')
  run.answer(run.sent.at(-1), { deferred: true, input: '' })
  await again
  const after = run.frameWin.SillyTavern.getContext().chat
  assert.equal(after.length, 2)
  assert.equal(after[1].mes, '我推门而入。')
})
