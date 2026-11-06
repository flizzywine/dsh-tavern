// EXPERIMENT: run the browser's own card-script executor headless.
// One disposable process per game loads the unchanged client bundle into jsdom
// and drives createTavernScriptSessionOwner exactly as an open page would. Its
// HTTP traffic is answered in-process by the parent's Tavern routes, so leases,
// claims, settlements and history reads keep their existing semantics. The
// script sandbox iframe is emulated by a second jsdom window: classic scripts
// run in its VM context and module scripts through vm.SourceTextModule.
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { JSDOM, VirtualConsole } from 'jsdom'

const ORIGIN = 'http://tavern.invalid'
const clientUrl = new URL('../client.js', import.meta.url)
const send = message => { if (process.connected) process.send(message) }
const log = (level, ...args) => send({ type: 'log', level, message: args.map(item => item && typeof item === 'object' && 'message' in item ? String(item.stack || item.message) : typeof item === 'string' ? item : safeJson(item)).join(' ').slice(0, 4000) })
function safeJson(value) { try { return JSON.stringify(value) } catch { return String(value) } }

// ---- HTTP bridge -----------------------------------------------------------
let fetchSequence = 0
const fetches = new Map()
const signalListeners = new Map()
process.on('message', message => {
  if (message.type === 'fetch-result') {
    const item = fetches.get(message.id)
    if (!item) return
    fetches.delete(message.id)
    if (message.error) item.reject(new TypeError(message.error))
    else item.resolve(message)
  } else if (message.type === 'signal') {
    for (const listener of signalListeners.get(message.signal.sessionId) || []) {
      try { listener(message.signal) } catch (error) { log('warn', 'signal listener failed', error) }
    }
  } else if (message.type === 'start') start(message.sessionId).catch(error => { log('error', 'start failed', error); send({ type: 'failed', error: String(error?.stack || error) }) })
})
process.on('disconnect', () => process.exit(0))

function bridgeFetch(Response) {
  return async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), ORIGIN)
    if (url.origin !== ORIGIN) return globalThis.fetch(url.href, init)
    const id = ++fetchSequence
    const body = init.body === undefined || init.body === null ? undefined : String(init.body)
    const result = await new Promise((resolve, reject) => {
      fetches.set(id, { resolve, reject })
      send({ type: 'fetch', id, path: url.pathname + url.search, method: String(init.method || 'GET').toUpperCase(), headers: init.headers || {}, body })
    })
    return new Response(Buffer.from(result.body, 'base64'), { status: result.status, headers: result.headers })
  }
}

// ---- Module loading inside a jsdom VM context --------------------------------
function createModuleHost(window, context) {
  const modules = new Map()
  async function source(url) {
    const response = await window.fetch(url)
    if (!response.ok) throw new TypeError('Failed to fetch dynamically imported module: ' + url + ' (' + response.status + ')')
    return await response.text()
  }
  async function load(url) {
    if (modules.has(url)) return modules.get(url)
    const pending = (async () => {
      const module = new vm.SourceTextModule(await source(url), { context, identifier: url, initializeImportMeta: meta => { meta.url = url }, importModuleDynamically })
      return module
    })()
    modules.set(url, pending)
    return pending
  }
  async function link(module) {
    await module.link(async (specifier, referencing) => load(new URL(specifier, /^https?:/.test(referencing.identifier) ? referencing.identifier : window.document.baseURI).href))
  }
  async function importModuleDynamically(specifier, referrer) {
    const base = referrer?.identifier && /^https?:/.test(referrer.identifier) ? referrer.identifier : window.document.baseURI
    const module = await load(new URL(specifier, base).href)
    if (module.status === 'unlinked') await link(module)
    if (module.status === 'linked') await module.evaluate()
    else if (module.status === 'evaluating') await new Promise(resolve => setTimeout(resolve, 0))
    return module
  }
  return {
    importModuleDynamically,
    async runModule(text, identifier) {
      const module = new vm.SourceTextModule(text, { context, identifier, initializeImportMeta: meta => { meta.url = window.document.baseURI }, importModuleDynamically })
      await link(module)
      await module.evaluate()
    },
    runClassic(text, filename) {
      return new vm.Script(text, { filename, importModuleDynamically }).runInContext(context)
    }
  }
}

function reportScriptError(window, error, filename) {
  const event = new window.ErrorEvent('error', { message: String(error?.message || error), filename, error })
  window.dispatchEvent(event)
}

// ---- Sandbox iframe emulation ---------------------------------------------------
function messageEvent(window, data, source) {
  const event = new window.MessageEvent('message', { data })
  Object.defineProperty(event, 'source', { value: source })
  return event
}

function createHeadlessFrame(hostWindow, virtualConsole) {
  const element = hostWindow.document.createElement('dsh-headless-frame')
  let child = null
  // The real sandbox is cross-origin: anything but postMessage is a SecurityError.
  const proxyParent = new Proxy({
    postMessage(data) {
      const copy = structuredClone(data)
      setTimeout(() => hostWindow.dispatchEvent(messageEvent(hostWindow, copy, child && child.window)), 0)
    }
  }, {
    get(target, key) {
      if (key === 'postMessage' || typeof key === 'symbol') return target[key]
      // Trusted card mode runs the sandbox same-origin with the host page.
      if (!element.sandbox) { const value = Reflect.get(hostWindow, key, hostWindow); return typeof value === 'function' && !Object.prototype.hasOwnProperty.call(hostWindow, key) && !/^[A-Z]/.test(String(key)) ? value.bind(hostWindow) : value }
      const DOMException = child?.window?.DOMException || globalThis.DOMException
      throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError')
    }
  })
  Object.defineProperty(element, 'contentWindow', { get: () => child && child.window })
  Object.defineProperty(element, 'contentDocument', { get: () => child && child.window.document })
  Object.defineProperty(element, 'srcdoc', {
    set(html) { boot(String(html)).catch(error => log('error', 'sandbox boot failed', error)) },
    get() { return '' }
  })
  for (const key of ['sandbox', 'referrerPolicy', 'title']) element[key] = ''
  async function boot(html) {
    child = new JSDOM(html, { url: ORIGIN + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
    const w = child.window
    installWindowBasics(w)
    Object.defineProperty(w, 'parent', { value: proxyParent, configurable: true })
    try { Object.defineProperty(w, 'top', { value: proxyParent, configurable: true }) } catch {}
    w.postMessage = function (data) {
      const copy = structuredClone(data)
      setTimeout(() => w.dispatchEvent(messageEvent(w, copy, proxyParent)), 0)
    }
    await runDocumentScripts(w, child.getInternalVMContext())
    element.dispatchEvent(new hostWindow.Event('load'))
  }
  element.remove = function () { if (child) child.window.close(); child = null; hostWindow.Element.prototype.remove.call(element) }
  return element
}

// Browsers run <script> elements as they are inserted; jsdom here does not.
// Execute the document's scripts in order, then any inserted later.
async function runDocumentScripts(w, context) {
  const host = createModuleHost(w, context)
  const executed = new WeakSet()
  async function execute(script) {
    if (executed.has(script)) return
    executed.add(script)
    const type = String(script.type || '').trim().toLowerCase()
    const src = script.getAttribute('src')
    const filename = src ? new URL(src, ORIGIN).href : (String(script.textContent).match(/\/\/# sourceURL=(\S+)\s*$/)?.[1] || 'inline-script')
    try {
      if (type === 'module') {
        if (src) await host.importModuleDynamically(src)
        else await host.runModule(script.textContent, filename)
      } else if (!type || /javascript/.test(type)) {
        const text = src ? await (await w.fetch(src)).text() : script.textContent
        host.runClassic(text, filename)
      } else return
      script.dispatchEvent(new w.Event('load'))
    } catch (error) {
      log('warn', 'script failed', filename.slice(0, 120), error)
      reportScriptError(w, error, filename)
      script.dispatchEvent(new w.ErrorEvent('error', { message: String(error?.message || error), error }))
    }
  }
  for (const script of [...w.document.querySelectorAll('script')]) await execute(script)
  new w.MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      const scripts = node.nodeName === 'SCRIPT' ? [node] : node.querySelectorAll ? [...node.querySelectorAll('script')] : []
      for (const script of scripts) void execute(script)
    }
  }).observe(w.document, { childList: true, subtree: true })
}

function installWindowBasics(w) {
  const bridged = bridgeFetch(Response)
  // Object URLs: the helper loader hands large sources to modules as blobs.
  const blobs = new Map()
  w.URL.createObjectURL = blob => { const id = 'blob:' + ORIGIN + '/' + globalThis.crypto.randomUUID(); blobs.set(id, blob); return id }
  w.URL.revokeObjectURL = id => { blobs.delete(String(id)) }
  w.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    if (url.startsWith('blob:')) {
      const blob = blobs.get(url)
      if (!blob) throw new TypeError('Failed to fetch ' + url)
      const text = typeof blob.text === 'function' ? await blob.text() : await new Promise((resolve, reject) => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob) })
      return new Response(text, { headers: { 'content-type': blob.type || 'text/javascript' } })
    }
    return bridged(input, init)
  }
  for (const [key, value] of Object.entries({ structuredClone, TextEncoder, TextDecoder, AbortController, AbortSignal, Response, Request, Headers, URLSearchParams })) {
    if (w[key] === undefined) w[key] = value
  }
  if (!w.crypto?.randomUUID) Object.defineProperty(w, 'crypto', { value: globalThis.crypto, configurable: true })
  if (!w.requestAnimationFrame) { w.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 16); w.cancelAnimationFrame = id => clearTimeout(id) }
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  installUserTiming(w.performance)
}

// jsdom's performance has now() only; card scripts time themselves with marks and measures.
function installUserTiming(performance) {
  if (!performance || typeof performance.mark === 'function') return
  let entries = []
  const startOf = value => typeof value === 'number' ? value : value === undefined ? 0 : entries.findLast(entry => entry.name === value && entry.entryType === 'mark')?.startTime ?? 0
  const add = entry => { entries.push(entry); if (entries.length > 1000) entries = entries.slice(-1000); return entry }
  Object.assign(performance, {
    mark: (name, options) => add({ name: String(name), entryType: 'mark', startTime: options?.startTime ?? performance.now(), duration: 0, detail: options?.detail ?? null }),
    measure(name, start, end) {
      const options = start && typeof start === 'object' ? start : null
      const from = startOf(options ? options.start : start), to = options?.end !== undefined ? startOf(options.end) : end !== undefined ? startOf(end) : performance.now()
      return add({ name: String(name), entryType: 'measure', startTime: from, duration: to - from, detail: options?.detail ?? null })
    },
    getEntries: () => entries.slice(),
    getEntriesByName: (name, type) => entries.filter(entry => entry.name === name && (!type || entry.entryType === type)),
    getEntriesByType: type => entries.filter(entry => entry.entryType === type),
    clearMarks: name => { entries = entries.filter(entry => entry.entryType !== 'mark' || (name !== undefined && entry.name !== name)) },
    clearMeasures: name => { entries = entries.filter(entry => entry.entryType !== 'measure' || (name !== undefined && entry.name !== name)) }
  })
}

// ---- Host page -------------------------------------------------------------
async function start(sessionId) {
  const virtualConsole = new VirtualConsole()
  for (const level of ['log', 'info', 'warn', 'error']) virtualConsole.on(level, (...args) => log(level, ...args))
  virtualConsole.on('jsdomError', error => log('warn', 'jsdom', error?.message || error))
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: ORIGIN + '/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole })
  const w = dom.window
  installWindowBasics(w)
  // Runtime leases minted here are recognisably the server's (dispatch priority).
  const webcrypto = globalThis.crypto
  Object.defineProperty(w, 'crypto', { configurable: true, value: { subtle: webcrypto.subtle, getRandomValues: array => webcrypto.getRandomValues(array), randomUUID: () => 'server-' + webcrypto.randomUUID() } })
  let factory
  w.__ModuleLoader__ = { load(definition) { factory = definition.factory } }
  // Tells the client bundle it has no real page: page-only patches stay out.
  w.__dshTavernHeadless = true
  w.eval(await readFile(clientUrl, 'utf8'))
  await runDocumentScripts(w, dom.getInternalVMContext())
  const React = new Proxy({ createElement: () => null, useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value }), useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: (_subscribe, get) => get(), useReducer: (_reducer, state) => [state, () => {}], useContext() {}, createContext: () => ({ Provider: 'provider' }), memo: value => value, forwardRef: value => value, Fragment: 'fragment' }, { get: (target, key) => key in target ? target[key] : () => null })
  const exports = factory(name => name === 'react' ? React : new Proxy({}, { get: () => () => null }))

  const realCreateElement = w.document.createElement.bind(w.document)
  const document = new Proxy(w.document, {
    get(target, key) {
      if (key === 'createElement') return (name, options) => String(name).toLowerCase() === 'iframe' ? createHeadlessFrame(w, virtualConsole) : realCreateElement(name, options)
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })

  const listeners = new Set()
  const sessions = {
    list: { getSnapshot: () => ({ current: sessionId, byId: {} }), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    subagentAddress: () => null
  }
  const transition = { getSnapshot: () => null, subscribe: () => () => {} }
  async function readView(id, request) {
    const response = await w.fetch('/api/dsh-tavern/getSession', { method: 'POST', body: JSON.stringify({ sessionId: id, openingWindow: 1 }), signal: request?.signal })
    const result = await response.json()
    if (!result.ok) throw new Error(result.error || '读取会话失败')
    return result.view && result.view.historyWindow ? { ...result, view: exports.expandTavernOpeningWindow(result.view) } : result
  }
  const liveView = exports.createLiveTavernViewModule({ deduplicateViews: true, loadTimeoutMs: 30000, cacheRetentionMs: 600000, timeoutRetryDelayMs: 5000, load: readView, shouldPoll: () => false, pollWhileBusy: false })
  const signals = {
    subscribe(id, kind, onSignal, _onError, onReconnect) {
      const listener = signal => { if (!kind || signal.kind === kind) onSignal(signal) }
      if (!signalListeners.has(id)) signalListeners.set(id, new Set())
      signalListeners.get(id).add(listener)
      setTimeout(() => onReconnect && onReconnect(), 0)
      return () => signalListeners.get(id)?.delete(listener)
    }
  }
  // Committed state changes refresh the view the runtime reads.
  signals.subscribe(sessionId, 'tavern-state', () => liveView.invalidate(sessionId))
  const owner = exports.createTavernScriptSessionOwner({
    window: w, sessions, liveView, transition, signals,
    createExecution: options => exports.createTavernScriptExecutionModule({
      ...options,
      createRuntime: runtimeOptions => exports.createTavernHelperScriptRuntime({ ...runtimeOptions, document, reportError: (source, error) => log('error', source, error), resolveError() {} })
    })
  })
  owner.start()
  send({ type: 'started', sessionId })
}
