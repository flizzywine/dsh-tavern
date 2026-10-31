import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'

// 正文走工具调用时整段正文一次性落地；这里只验证落点与放手条件，不启动浏览器。
async function loadClient() {
  let descriptor
  vm.runInNewContext(await readFile('tavern-plugin/lib/client.js', 'utf8'), { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
  return descriptor.factory(() => ({}))
}

function rect(top, height) { return { top, height, bottom: top + height } }

function scrollport({ top = 100, clientHeight = 400, scrollHeight = 4000, scrollTop = 3600 } = {}) {
  return {
    isConnected: true, scrollTop, scrollHeight, clientHeight,
    getBoundingClientRect: () => rect(top, clientHeight),
  }
}

function replyRow(scroller, options = {}) {
  // The row keeps its document offset while the scrollport moves under it.
  const settings = { offset: 1200, height: 1200, following: true, laterUser: false, hidden: false, ...options }
  const candidate = { id: 'later-user' }
  const flow = { querySelectorAll: () => settings.laterUser ? [candidate] : [] }
  const row = {
    isConnected: true, parentElement: null,
    hasAttribute: name => (settings.hidden && name === 'hidden') || false,
    getAttribute: name => settings.hidden && name === 'data-turn-process-hidden' ? '' : null,
    closest(selector) {
      if (selector === '[data-conversation-scroll]') return scroller
      if (selector === '[data-chat-following-tail]') return settings.following ? {} : null
      if (selector === '[data-chat-flow]') return flow
      if (selector === '[hidden]') return null
      return null
    },
    getBoundingClientRect() {
      const box = scroller.getBoundingClientRect()
      return rect(box.top + settings.offset - scroller.scrollTop, settings.height)
    },
    compareDocumentPosition(other) { return other === candidate ? 4 : 0 },
  }
  return row
}

function fakeHost() {
  const frames = new Map(), listeners = new Map()
  let next = 1
  return {
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    document: { scrollingElement: null },
    getComputedStyle: () => ({ overflowY: 'visible' }),
    requestAnimationFrame(callback) { const id = next++; frames.set(id, callback); return id },
    cancelAnimationFrame(id) { frames.delete(id) },
    addEventListener(name, handler) { listeners.set(name, handler) },
    removeEventListener(name) { listeners.delete(name) },
    fire(name) { const handler = listeners.get(name); if (handler) handler() },
    frames: () => frames.size,
    flush() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback() },
  }
}

test('reader input stops the short hold loop', async () => {
  const client = await loadClient()
  const scroller = scrollport()
  const row = replyRow(scroller)
  const host = fakeHost()
  client.tavernReplyReveal(row, { host, padding: 24, holdMs: 5000 })
  host.flush()
  assert.equal(scroller.scrollTop, 1176)
  host.fire('wheel')
  scroller.scrollTop = 3200
  host.flush()
  assert.equal(scroller.scrollTop, 3200)
  assert.equal(host.frames(), 0)
})
