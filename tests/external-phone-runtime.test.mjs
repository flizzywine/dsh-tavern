import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'
import { helperHostHarness } from './fixtures/helper-host-harness.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
const tick = () => new Promise(resolve => setImmediate(resolve))

function host(extraWindow = {}) {
  const timers = new Map(), listeners = new Set()
  let id = 0, descriptor
  const window = {
    crypto: {
      randomUUID: () => 'token-' + ++id,
      getRandomValues(array) { for (let i = 0; i < array.length; i++) array[i] = (i + 1) & 0xff; return array }
    },
    setTimeout(run, delay = 0) { timers.set(++id, { run, delay }); return id },
    clearTimeout(id) { timers.delete(id) },
    addEventListener(type, run) { if (type === 'message') listeners.add(run) },
    removeEventListener(type, run) { if (type === 'message') listeners.delete(run) },
    __ModuleLoader__: { load(value) { descriptor = value } },
    ...extraWindow
  }
  vm.runInNewContext(source, { window, TextEncoder, console: { info() {}, warn() {}, error() {} } })
  const client = descriptor.factory(() => ({}))
  return {
    window,
    client,
    timers,
    listeners,
    deliver(node, data, sender = node.contentWindow) {
      for (const run of listeners) run({ source: sender, data })
    }
  }
}

function makeDom() {
  const byId = new Map()
  const observers = []

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.targets = []
      observers.push(this)
    }
    observe(target, options) {
      this.targets.push({ target, options })
    }
    disconnect() {
      this.targets.length = 0
    }
    takeRecords() {
      return []
    }
  }

  function notifyMutations(target, addedNodes = []) {
    for (const observer of [...observers]) {
      const matched = observer.targets.some(entry => {
        if (entry.target === target) return true
        if (entry.options?.subtree) {
          let cursor = target
          while (cursor) {
            if (cursor === entry.target) return true
            cursor = cursor.parentNode || cursor.host || null
          }
        }
        return false
      })
      if (matched) observer.callback([{ type: addedNodes.length ? 'childList' : 'attributes', target, addedNodes }])
    }
  }

  function makeStyle(owner) {
    const props = new Map()
    let display = ''
    let height = ''
    let position = ''
    let inset = ''
    let zIndex = ''
    let width = ''
    let overflow = ''
    return {
      get display() { return display },
      set display(v) { display = String(v ?? ''); notifyMutations(owner) },
      get height() { return height },
      set height(v) { height = String(v ?? '') },
      get position() { return position },
      set position(v) { position = String(v ?? '') },
      get inset() { return inset },
      set inset(v) { inset = String(v ?? '') },
      get zIndex() { return zIndex },
      set zIndex(v) { zIndex = String(v ?? '') },
      get width() { return width },
      set width(v) { width = String(v ?? '') },
      get overflow() { return overflow },
      set overflow(v) { overflow = String(v ?? '') },
      setProperty(k, v) { props.set(k, String(v)) },
      getPropertyValue(k) { return props.get(k) || '' },
      removeProperty(k) { props.delete(k) }
    }
  }

  function matchesSelector(node, selector) {
    if (selector === '[id^="improved-phone-shadow-host-"]') return String(node.id || '').startsWith('improved-phone-shadow-host-')
    if (selector === '[id^="improved-phone-floating-button-"]') return String(node.id || '').startsWith('improved-phone-floating-button-')
    if (selector === '[data-dsh-tavern-card-app-parking]') return node.attributes?.get('data-dsh-tavern-card-app-parking') !== undefined
    if (selector === 'style[data-dsh-tavern-card-app-fonts]') return node.tagName === 'STYLE' && node.attributes?.get('data-dsh-tavern-card-app-fonts') !== undefined
    if (selector === '[data-dsh-tavern-card-app-layout]') return node.attributes?.get('data-dsh-tavern-card-app-layout') !== undefined
    if (selector === '.phone-wrapper') return String(node.className || '').split(/\s+/).includes('phone-wrapper')
    if (selector === '.phone-close-btn') return String(node.className || '').split(/\s+/).includes('phone-close-btn')
    if (selector === '[script_id]') return node.attributes?.get('script_id') !== undefined
    return false
  }

  function queryAll(root, selector) {
    const out = []
    for (const child of root.childNodes || []) {
      if (child.nodeType === 1) {
        for (const part of selector.split(',').map(s => s.trim())) {
          if (matchesSelector(child, part)) { out.push(child); break }
        }
        out.push(...queryAll(child, selector))
      }
    }
    return out
  }

  const document = {
    defaultView: null,
    head: null,
    body: null,
    documentElement: null,
    createElement(tag) {
      const attributes = new Map()
      const listeners = new Map()
      const node = {
        nodeType: 1,
        tagName: String(tag).toUpperCase(),
        ownerDocument: document,
        id: '',
        className: '',
        hidden: false,
        textContent: '',
        clientWidth: 384,
        parentNode: null,
        nextSibling: null,
        childNodes: [],
        attributes,
        shadowRoot: null,
        isConnected: false,
        setAttribute(k, v) {
          attributes.set(k, String(v))
          if (k === 'id') { this.id = String(v); if (this.isConnected) byId.set(this.id, this) }
          notifyMutations(this)
        },
        getAttribute(k) { return attributes.has(k) ? attributes.get(k) : null },
        hasAttribute(k) { return attributes.has(k) },
        removeAttribute(k) { attributes.delete(k); notifyMutations(this) },
        appendChild(child) {
          if (child.parentNode) child.remove()
          const prevLast = this.childNodes.at(-1)
          if (prevLast) prevLast.nextSibling = child
          child.nextSibling = null
          child.parentNode = this
          this.childNodes.push(child)
          setConnected(child, this.isConnected)
          notifyMutations(this, [child])
          return child
        },
        insertBefore(child, ref) {
          const idx = this.childNodes.indexOf(ref)
          if (idx < 0) return this.appendChild(child)
          if (child.parentNode) child.remove()
          if (idx > 0) this.childNodes[idx - 1].nextSibling = child
          child.nextSibling = ref
          child.parentNode = this
          this.childNodes.splice(idx, 0, child)
          setConnected(child, this.isConnected)
          notifyMutations(this, [child])
          return child
        },
        removeChild(child) {
          const idx = this.childNodes.indexOf(child)
          if (idx >= 0) {
            if (idx > 0) this.childNodes[idx - 1].nextSibling = child.nextSibling
            this.childNodes.splice(idx, 1)
            child.parentNode = null
            child.nextSibling = null
            setConnected(child, false)
            notifyMutations(this)
          }
          return child
        },
        remove() {
          if (this.parentNode) this.parentNode.removeChild(this)
        },
        attachShadow() {
          const sr = {
            host: this,
            ownerDocument: document,
            childNodes: [],
            isConnected: this.isConnected,
            appendChild(child) {
              if (child.parentNode) child.remove()
              child.parentNode = sr
              sr.childNodes.push(child)
              setConnected(child, sr.isConnected)
              notifyMutations(sr, [child])
              return child
            },
            removeChild(child) {
              const idx = sr.childNodes.indexOf(child)
              if (idx >= 0) { sr.childNodes.splice(idx, 1); child.parentNode = null; setConnected(child, false) }
              return child
            },
            querySelector(sel) { return queryAll(sr, sel)[0] || null },
            querySelectorAll(sel) { return queryAll(sr, sel) }
          }
          this.shadowRoot = sr
          return sr
        },
        querySelector(sel) { return queryAll(this, sel)[0] || null },
        querySelectorAll(sel) { return queryAll(this, sel) },
        addEventListener(type, fn) {
          if (type === 'load') this.load = fn
          listeners.set(type, (listeners.get(type) || []).concat(fn))
        },
        removeEventListener(type, fn) {
          listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn))
        },
        click() {
          for (const fn of listeners.get('click') || []) fn()
        }
      }
      node.style = makeStyle(node)
      if (node.tagName === 'IFRAME') {
        const loadListeners = []
        node.contentWindow = {
          messages: [],
          postMessage(data) { this.messages.push(copy(data)) }
        }
        node.addEventListener = (type, fn) => { if (type === 'load') loadListeners.push(fn) }
        node.removeEventListener = (type, fn) => {
          if (type === 'load') {
            const idx = loadListeners.indexOf(fn)
            if (idx >= 0) loadListeners.splice(idx, 1)
          }
        }
        node.load = () => { for (const fn of [...loadListeners]) fn() }
      }
      return node
    },
    getElementById(id) {
      return byId.get(String(id)) || null
    },
    querySelector(sel) {
      return queryAll(document.head, sel)[0] || queryAll(document.body, sel)[0] || null
    },
    querySelectorAll(sel) {
      return [...queryAll(document.head, sel), ...queryAll(document.body, sel)]
    }
  }

  function setConnected(node, value) {
    node.isConnected = value
    if (node.id) {
      if (value) byId.set(node.id, node)
      else if (byId.get(node.id) === node) byId.delete(node.id)
    }
    if (node.shadowRoot) {
      node.shadowRoot.isConnected = value
      for (const child of node.shadowRoot.childNodes) setConnected(child, value)
    }
    for (const child of node.childNodes || []) setConnected(child, value)
  }

  document.head = document.createElement('head')
  document.body = document.createElement('body')
  document.documentElement = document.createElement('html')
  setConnected(document.documentElement, true)
  document.documentElement.appendChild(document.head)
  document.documentElement.appendChild(document.body)

  return { document, FakeMutationObserver, byId }
}

test('tavern_events 与小写别名均归一化 GENERATION_STARTED/ENDED，且多轮无 eventId 通知不会在首轮后被去重吞掉', async () => {
  const h = helperHostHarness({ chatId: 'phone-chat' }, { scripts: [{ id: 'phone', content: '' }] })
  const w = h.window
  const received = []
  w.__dshTavernHelperSetCurrentScript('phone')
  assert.equal(w.tavern_events.GENERATION_STARTED, 'GENERATION_STARTED')
  assert.equal(w.tavern_events.GENERATION_STOPPED, 'GENERATION_STOPPED')
  assert.equal(w.tavern_events.GENERATION_ENDED, 'GENERATION_ENDED')

  w.eventOn(w.tavern_events.GENERATION_STARTED, type => { received.push(['started', type]) })
  w.eventOn('generation_ended', id => { received.push(['ended', id]) })
  w.eventOn(w.tavern_events.MESSAGE_RECEIVED, id => { received.push(['received', id]) })

  const subReport = h.sent.filter(item => item.type === 'dsh-tavern-helper-subscriptions').at(-1)
  assert.ok(subReport.names.includes('GENERATION_STARTED'))
  assert.ok(subReport.names.includes('GENERATION_ENDED'))
  assert.ok(subReport.names.includes('MESSAGE_RECEIVED'))

  // Simulate multi-turn untracked notifications posted by helper-script-runtime sync()
  h.receive({ type: 'dsh-tavern-helper-event', name: 'GENERATION_STARTED', args: ['normal', {}, false] })
  h.receive({ type: 'dsh-tavern-helper-event', name: 'MESSAGE_RECEIVED', args: [1] })
  h.receive({ type: 'dsh-tavern-helper-event', name: 'GENERATION_ENDED', args: [1] })
  h.receive({ type: 'dsh-tavern-helper-event', name: 'GENERATION_STARTED', args: ['normal', {}, false] })
  h.receive({ type: 'dsh-tavern-helper-event', name: 'MESSAGE_RECEIVED', args: [3] })
  h.receive({ type: 'dsh-tavern-helper-event', name: 'GENERATION_ENDED', args: [3] })
  await tick(); await tick(); await tick()

  assert.deepEqual(received, [
    ['started', 'normal'],
    ['received', 1],
    ['ended', 1],
    ['started', 'normal'],
    ['received', 3],
    ['ended', 3]
  ])
})

test('MVU 强制重试的空字符串 CHAT_CHANGED 仅重置官方 MVU，不触发伴随小手机脚本的换聊重载', async () => {
  const h = helperHostHarness(
    { chatId: 'real-chat-1' },
    { scripts: [{ id: '__dsh_official_mvu__', system: 'official-mvu', content: '' }, { id: 'phone-script', content: '' }] }
  )
  const w = h.window
  const log = []

  w.__dshTavernHelperSetCurrentScript('__dsh_official_mvu__')
  w.eventOn('CHAT_CHANGED', chatId => { log.push(['mvu', chatId]) })

  w.__dshTavernHelperSetCurrentScript('phone-script')
  w.eventOn(w.tavern_events.CHAT_CHANGED, chatId => { log.push(['phone', chatId]) })

  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'reset-1', name: 'CHAT_CHANGED', args: [''] })
  await tick(); await tick()
  h.receive({ type: 'dsh-tavern-helper-event', eventId: 'announce-1', name: 'CHAT_CHANGED', args: ['real-chat-1'] })
  await tick(); await tick()

  assert.deepEqual(log, [
    ['mvu', ''],
    ['mvu', 'real-chat-1'],
    ['phone', 'real-chat-1']
  ])
})

test('helper-script-runtime 在官方 MVU 卡下派发开始和结束事件，且沙箱 reload 不重放旧事件死循环', async () => {
  const { document, FakeMutationObserver } = makeDom()
  const readyCalls = []
  const h = host({ MutationObserver: FakeMutationObserver, document })
  document.defaultView = h.window

  const frames = []
  const origCreate = document.createElement.bind(document)
  document.createElement = tag => {
    const node = origCreate(tag)
    if (node.tagName === 'IFRAME') frames.push(node)
    return node
  }

  const runtime = h.client.createTavernHelperScriptRuntime({
    window: h.window,
    document,
    rpc: () => Promise.resolve({ updated: true, ok: true, values: {} }),
    onMutation() {},
    reportError() {},
    resolveError() {},
    onReady(sessionId) { readyCalls.push(sessionId) }
  })

  const makeView = (messages, mvu = false) => ({
    chatId: 'chat-phone',
    tavernRuntimePolicy: { trustedCardMode: true },
    ...(mvu ? { tavernMvuRuntime: { owner: 'official', assetUrl: '/bundle.js' } } : {}),
    tavernHelperScripts: [{ id: 'phone', name: '外置手机', content: 'void 0' }],
    tavernHelper: {
      version: 1,
      stateRevision: messages.length,
      lifecycleRevision: 1,
      frameStorageScope: { cardPath: '/cards/phone.png' },
      messages: messages.map((m, i) => ({ message_id: i, ...m })),
      turnMessageIds: {},
      chatVariables: {},
      scriptVariables: {}
    }
  })

  runtime.sync('S1', makeView([{ role: 'assistant', message: 'opening', variables: { stat_data: {}, schema: {} } }], true))
  const frame = frames[0]
  frame.load()
  const token = frame.contentWindow.messages[0].token
  h.deliver(frame, {
    token,
    type: 'dsh-tavern-helper-subscriptions',
    ready: true,
    names: ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'GENERATION_STARTED', 'GENERATION_ENDED'],
    scripts: [
      { id: '__dsh_official_mvu__', ready: true },
      { id: 'phone', ready: true }
    ]
  })
  await tick()
  assert.deepEqual(readyCalls, ['S1'])

  // User floor + Assistant floor when officialOwner === true:
  // Message events belong to MVU transactions; generation events reach companion scripts.
  frame.contentWindow.messages.length = 0
  runtime.sync('S1', makeView([
    { role: 'assistant', message: 'opening', variables: { stat_data: {}, schema: {} } },
    { role: 'user', message: 'hello', variables: {} }
  ], true))
  runtime.sync('S1', makeView([
    { role: 'assistant', message: 'opening', variables: { stat_data: {}, schema: {} } },
    { role: 'user', message: 'hello', variables: {} },
    { role: 'assistant', message: 'reply [AutoMessage]', variables: { stat_data: {}, schema: {} } }
  ], true))

  const mvuCompanionEvents = frame.contentWindow.messages.filter(m => m.type === 'dsh-tavern-helper-event')
  assert.deepEqual(mvuCompanionEvents.map(e => [e.name, e.args]), [
    ['GENERATION_STARTED', ['normal', {}, false]],
    ['GENERATION_ENDED', [2]]
  ])

  // Simulate external phone mounting raw host DOM nodes + another session's parked phone node
  const ownPhone = document.createElement('div')
  ownPhone.setAttribute('id', 'improved-phone-shadow-host-phone')
  ownPhone.setAttribute('data-dsh-tavern-card-app-session', 'S1')
  document.body.appendChild(ownPhone)

  const otherSessionPhone = document.createElement('div')
  otherSessionPhone.setAttribute('id', 'improved-phone-shadow-host-phone-b')
  otherSessionPhone.setAttribute('data-dsh-tavern-card-app-session', 'S2')
  document.body.appendChild(otherSessionPhone)

  const toast = document.createElement('div')
  toast.setAttribute('id', 'auto-message-notification-container')
  document.body.appendChild(toast)

  // Start a host event (e.g. CHAT_CHANGED) and simulate script calling location.reload() mid-event
  h.deliver(frame, {
    token,
    type: 'dsh-tavern-helper-subscriptions',
    ready: true,
    names: ['CHAT_CHANGED', 'GENERATION_ENDED'],
    scripts: [{ id: '__dsh_official_mvu__', ready: true }, { id: 'phone', ready: true }]
  })
  const pendingEmit = runtime.emit('CHAT_CHANGED', ['chat-phone'])
  const sentBeforeReload = frame.contentWindow.messages.filter(m => m.type === 'dsh-tavern-helper-event' && m.name === 'CHAT_CHANGED')
  assert.equal(sentBeforeReload.length, 1)
  const oldEventId = sentBeforeReload[0].eventId

  h.deliver(frame, { token, type: 'dsh-tavern-helper-reloading' })
  frame.contentWindow.messages.length = 0
  frame.load()

  // Pre-reload event must settle cleanly without throwing or replaying on phase="unknown"
  assert.deepEqual(copy(await pendingEmit), ['chat-phone'])
  h.deliver(frame, { token, type: 'dsh-tavern-helper-event-state', eventId: oldEventId, phase: 'unknown' })
  assert.equal(
    frame.contentWindow.messages.some(m => m.type === 'dsh-tavern-helper-event' && m.eventId === oldEventId),
    false,
    'reloaded iframe must not receive replayed pre-reload event'
  )

  // S1 phone host & notification container were cleaned up, S2 phone host was preserved
  assert.equal(document.getElementById('improved-phone-shadow-host-phone'), null)
  assert.equal(document.getElementById('auto-message-notification-container'), null)
  assert.equal(document.getElementById('improved-phone-shadow-host-phone-b'), otherSessionPhone)

  // Reloaded scripts report ready -> onReady fires again cleanly
  h.deliver(frame, {
    token,
    type: 'dsh-tavern-helper-subscriptions',
    ready: true,
    names: ['CHAT_CHANGED', 'GENERATION_ENDED'],
    scripts: [{ id: '__dsh_official_mvu__', ready: true }, { id: 'phone', ready: true }]
  })
  await tick()
  assert.deepEqual(readyCalls, ['S1', 'S1'])

  runtime.dispose()
})

test('createTavernCardAppDock 跟踪 v-show 折叠状态，并在无悬浮球时通过脚本按钮打开/收起/刷新外置小手机', async () => {
  const { document, FakeMutationObserver } = makeDom()
  const h = host({ MutationObserver: FakeMutationObserver, document })
  document.defaultView = h.window

  const triggered = []
  const presence = h.client.createTavernCardAppPresence({ window: h.window })
  const slot = document.createElement('div')
  slot.clientWidth = 384
  document.body.appendChild(slot)

  // Build external phone shadow DOM WITHOUT #improved-phone-floating-button-* (default showFloatingButton: false)
  const phoneHost = document.createElement('div')
  phoneHost.setAttribute('id', 'improved-phone-shadow-host-script123')
  const shadow = phoneHost.attachShadow({ mode: 'open' })
  const wrapper = document.createElement('div')
  wrapper.className = 'phone-wrapper'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'phone-close-btn'
  closeBtn.addEventListener('click', () => { wrapper.style.display = 'none' })
  wrapper.appendChild(closeBtn)
  shadow.appendChild(wrapper)
  document.body.appendChild(phoneHost)

  h.window.__dshTavernTriggerScriptButton = async (sessionId, scriptId, buttonName) => {
    triggered.push([sessionId, scriptId, buttonName])
    if (buttonName === '手机') {
      wrapper.style.display = wrapper.style.display === 'none' ? '' : 'none'
    }
  }

  const dock = h.client.createTavernCardAppDock({
    document,
    slot,
    sessionId: 'S-phone',
    loadIconCss: () => Promise.resolve('/* icons */'),
    MutationObserver: FakeMutationObserver,
    onChange: presence.change
  })

  // Initially visible & expanded
  assert.deepEqual(copy(presence.inspect()), { visible: true, attached: true, recovering: false, expanded: true })
  assert.equal(phoneHost.style.height, '620px')
  assert.equal(slot.getAttribute('data-collapsed'), null)

  // User clicks internal .phone-close-btn (v-show sets display: none) -> slot collapses to 0px!
  closeBtn.click()
  assert.deepEqual(copy(presence.inspect()), { visible: true, attached: true, recovering: false, expanded: false })
  assert.equal(phoneHost.style.height, '0px')
  assert.equal(slot.getAttribute('data-collapsed'), 'true')

  // Clicking header toggle ("打开手机") invokes script button "手机" even without floating button!
  dock.toggle()
  await tick()
  assert.deepEqual(triggered, [['S-phone', 'script123', '手机']])
  assert.deepEqual(copy(presence.inspect()), { visible: true, attached: true, recovering: false, expanded: true })
  assert.equal(phoneHost.style.height, '620px')
  assert.equal(slot.getAttribute('data-collapsed'), null)

  // Clicking "刷新" triggers script button "刷新"
  await dock.trigger('刷新')
  assert.deepEqual(triggered.at(-1), ['S-phone', 'script123', '刷新'])

  // Toggling again while open closes via .phone-close-btn
  dock.toggle()
  assert.deepEqual(copy(presence.inspect()), { visible: true, attached: true, recovering: false, expanded: false })
  assert.equal(phoneHost.style.height, '0px')

  dock.dispose()
  presence.dispose()
})
test('手机按钮异步渲染时，打开和收起均只切换一次', async () => {
  const { document, FakeMutationObserver } = makeDom()
  const h = host({ MutationObserver: FakeMutationObserver, document })
  document.defaultView = h.window
  const slot = document.createElement('div')
  document.body.appendChild(slot)
  const phone = document.createElement('div')
  phone.id = 'improved-phone-shadow-host-async'
  const shadow = phone.attachShadow({ mode: 'open' })
  const wrapper = document.createElement('div')
  wrapper.className = 'phone-wrapper'
  const closeButton = document.createElement('button')
  closeButton.className = 'phone-close-btn'
  wrapper.appendChild(closeButton)
  shadow.appendChild(wrapper)
  document.body.appendChild(phone)
  const floating = document.createElement('button')
  floating.id = 'improved-phone-floating-button-async'
  document.body.appendChild(floating)
  let shown = true
  let fallbackCalls = 0
  function toggle() {
    shown = !shown
    queueMicrotask(() => { wrapper.style.display = shown ? '' : 'none' })
  }
  closeButton.addEventListener('click', toggle)
  floating.addEventListener('click', toggle)
  const dock = h.client.createTavernCardAppDock({
    document, slot, sessionId: 'S-async', MutationObserver: FakeMutationObserver,
    loadIconCss: () => Promise.resolve(''),
    triggerButton: async () => { fallbackCalls++; toggle() }
  })
  try {
    dock.close()
    await tick()
    assert.equal(shown, false)
    assert.equal(dock.inspect().expanded, false)
    assert.equal(slot.getAttribute('data-collapsed'), 'true')
    dock.open()
    await tick()
    assert.equal(shown, true)
    assert.equal(dock.inspect().expanded, true)
    assert.equal(slot.getAttribute('data-collapsed'), null)
    assert.equal(fallbackCalls, 0)
  } finally {
    dock.dispose()
  }
})

test('多会话 keepMounted 并发停靠栏：后台选人会话不抢占 ReadStory 新会话手机且按钮精准路由', async () => {
  const { document, FakeMutationObserver } = makeDom()
  const h = host({ MutationObserver: FakeMutationObserver, document })
  document.defaultView = h.window

  const presence1 = h.client.createTavernCardAppPresence({ window: h.window })
  const presence2 = h.client.createTavernCardAppPresence({ window: h.window })
  const slot1 = document.createElement('div')
  slot1.clientWidth = 384
  document.body.appendChild(slot1)
  const slot2 = document.createElement('div')
  slot2.clientWidth = 384
  document.body.appendChild(slot2)

  const triggered = []
  let wrapper2 = null
  h.window.__dshTavernTriggerScriptButton = async (sessionId, scriptId, buttonName) => {
    triggered.push([sessionId, scriptId, buttonName])
    if (sessionId === 'S-story' && buttonName === '手机' && wrapper2) {
      wrapper2.style.display = wrapper2.style.display === 'none' ? '' : 'none'
    }
    return { ok: true }
  }

  // 1. Session 1（选人台）先挂载 Dock（更早注册在 document.body 上的 MutationObserver）
  h.window.__dshTavernSelectedSessionId = 'S-menu'
  const dock1 = h.client.createTavernCardAppDock({
    document,
    slot: slot1,
    sessionId: 'S-menu',
    active: true,
    loadIconCss: () => Promise.resolve('/* icons */'),
    MutationObserver: FakeMutationObserver,
    onChange: presence1.change
  })

  // 2. 点击 ReadStory 进入新会话 S-story：S-menu 退入后台但保持 keepMounted，S-story 挂载新 Dock
  h.window.__dshTavernSelectedSessionId = 'S-story'
  dock1.setActive(false)
  const dock2 = h.client.createTavernCardAppDock({
    document,
    slot: slot2,
    sessionId: 'S-story',
    active: true,
    loadIconCss: () => Promise.resolve('/* icons */'),
    MutationObserver: FakeMutationObserver,
    onChange: presence2.change
  })

  // 新会话脚本异步初始化期间，前台 presence2 保持隐藏，绝不露出灰框或无效按钮
  assert.deepEqual(copy(presence2.inspect()), { visible: false, attached: false, recovering: false, expanded: false })

  // 3. S-story 脚本初始化完成，向 document.body 追加新手机宿主（即使未预先标记也只能由前台 S-story 接管）
  const phoneHost2 = document.createElement('div')
  phoneHost2.setAttribute('id', 'improved-phone-shadow-host-script456')
  const shadow2 = phoneHost2.attachShadow({ mode: 'open' })
  wrapper2 = document.createElement('div')
  wrapper2.className = 'phone-wrapper'
  const closeBtn2 = document.createElement('button')
  closeBtn2.className = 'phone-close-btn'
  closeBtn2.addEventListener('click', () => { wrapper2.style.display = 'none' })
  wrapper2.appendChild(closeBtn2)
  shadow2.appendChild(wrapper2)
  document.body.appendChild(phoneHost2)

  assert.equal(dock1.inspect().attached, false, '后台选人会话 Dock 绝不抢占新会话手机节点')
  assert.deepEqual(copy(presence1.inspect()), { visible: false, attached: false, recovering: false, expanded: false })
  assert.equal(dock2.inspect().attached, true, '前台新会话 Dock 成功接管手机节点')
  assert.equal(slot2.childNodes.includes(phoneHost2), true)
  assert.equal(phoneHost2.getAttribute('data-dsh-tavern-card-app-session'), 'S-story')
  assert.deepEqual(copy(presence2.inspect()), { visible: true, attached: true, recovering: false, expanded: true })
  assert.equal(phoneHost2.style.height, '620px')

  // 4. 在新会话点击「刷新」与「收起手机」/「打开手机」均可正常响应并精准路由到 S-story
  await dock2.trigger('刷新')
  assert.deepEqual(triggered.at(-1), ['S-story', 'script456', '刷新'])

  dock2.toggle()
  assert.deepEqual(copy(presence2.inspect()), { visible: true, attached: true, recovering: false, expanded: false })
  assert.equal(phoneHost2.style.height, '0px')

  dock2.toggle()
  await tick()
  assert.deepEqual(triggered.at(-1), ['S-story', 'script456', '手机'])
  assert.deepEqual(copy(presence2.inspect()), { visible: true, attached: true, recovering: false, expanded: true })
  assert.equal(phoneHost2.style.height, '620px')

  dock1.dispose()
  dock2.dispose()
  presence1.dispose()
  presence2.dispose()
})

test('跨人物卡隔离：停放区手机仅归属原会话，切换到无手机人物卡绝不串台领养', async () => {
  const { document, FakeMutationObserver } = makeDom()
  const h = host({ MutationObserver: FakeMutationObserver, document })
  document.defaultView = h.window

  const presenceA = h.client.createTavernCardAppPresence({ window: h.window })
  const presenceB = h.client.createTavernCardAppPresence({ window: h.window })
  const slotA = document.createElement('div')
  slotA.clientWidth = 384
  document.body.appendChild(slotA)
  const slotB = document.createElement('div')
  slotB.clientWidth = 384
  document.body.appendChild(slotB)

  const phoneHost = document.createElement('div')
  phoneHost.setAttribute('id', 'improved-phone-shadow-host-card-a')
  const shadow = phoneHost.attachShadow({ mode: 'open' })
  const wrapper = document.createElement('div')
  wrapper.className = 'phone-wrapper'
  shadow.appendChild(wrapper)
  document.body.appendChild(phoneHost)

  // 1. 带手机的人物卡 A 停靠并随后卸载停放
  h.window.__dshTavernSelectedSessionId = 'S-card-a'
  const dockA = h.client.createTavernCardAppDock({
    document,
    slot: slotA,
    sessionId: 'S-card-a',
    active: true,
    loadIconCss: () => Promise.resolve('/* icons */'),
    MutationObserver: FakeMutationObserver,
    onChange: presenceA.change
  })
  assert.equal(dockA.inspect().attached, true)
  assert.equal(phoneHost.getAttribute('data-dsh-tavern-card-app-session'), 'S-card-a')

  dockA.dispose()
  const parking = document.querySelector('[data-dsh-tavern-card-app-parking]')
  assert.ok(parking)
  assert.equal(parking.childNodes.includes(phoneHost), true)

  // 2. 切换到无手机的人物卡 B：B 绝不能领养停放区中 A 的手机
  h.window.__dshTavernSelectedSessionId = 'S-card-b'
  const dockB = h.client.createTavernCardAppDock({
    document,
    slot: slotB,
    sessionId: 'S-card-b',
    active: true,
    loadIconCss: () => Promise.resolve('/* icons */'),
    MutationObserver: FakeMutationObserver,
    onChange: presenceB.change
  })
  assert.equal(dockB.inspect().attached, false)
  assert.deepEqual(copy(presenceB.inspect()), { visible: false, attached: false, recovering: false, expanded: false })
  assert.equal(parking.childNodes.includes(phoneHost), true)
  assert.equal(phoneHost.getAttribute('data-dsh-tavern-card-app-session'), 'S-card-a')

  // 3. 切回人物卡 A 重新打开状态栏：A 顺利找回自己的停放宿主并恢复展开高度
  h.window.__dshTavernSelectedSessionId = 'S-card-a'
  dockB.setActive(false)
  const dockAReopened = h.client.createTavernCardAppDock({
    document,
    slot: slotA,
    sessionId: 'S-card-a',
    active: true,
    loadIconCss: () => Promise.resolve('/* icons */'),
    MutationObserver: FakeMutationObserver,
    onChange: presenceA.change
  })
  assert.equal(dockAReopened.inspect().attached, true)
  assert.equal(slotA.childNodes.includes(phoneHost), true)
  assert.equal(phoneHost.style.height, '620px')

  dockB.dispose()
  dockAReopened.dispose()
  presenceA.dispose()
  presenceB.dispose()
})

