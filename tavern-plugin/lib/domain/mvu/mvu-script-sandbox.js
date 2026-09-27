// MVU 卡脚本服务端沙箱（第二阶段 M2）
// node:vm 沙箱执行卡脚本源码：脚本通过注入的 eventOn 注册事件钩子，
// 通过注入的变量/楼层 API 读写数据（SQLite 后端）。
// 生命周期：按卡创建 runtime → 服务端事件桥接触发钩子 → dispose 释放。
// 所有脚本执行带超时保护（同步 vm.timeout；异步钩子 Promise.race）。
import vm from 'node:vm'
import { setTimeout as sleepSetTimeout, clearTimeout } from 'node:timers'

const DEFAULT_TIMEOUT_MS = 5000
const MAX_TIMER_MS = 60_000

/** 受控 setTimeout：沙箱内可用，但有上限（防恶意常驻定时器） */
function sandboxSetTimeout(fn, ms, ...args) {
  return sleepSetTimeout(fn, Math.min(Number(ms) || 0, MAX_TIMER_MS), ...args)
}

export function createScriptRuntime({ scriptId, sources, hostApi, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console }) {
  const events = [] // 已注册的事件钩子 [{event, handler}]
  const errors = []

  function makeConsole(tag) {
    return {
      log: (...a) => logger.info?.(`[${tag}]`, ...a),
      info: (...a) => logger.info?.(`[${tag}]`, ...a),
      warn: (...a) => logger.warn?.(`[${tag}]`, ...a),
      error: (...a) => logger.error?.(`[${tag}]`, ...a),
      debug: () => {},
    }
  }

  // 宿主 API 注入：事件钩子注册到沙箱内（服务端事件触发时调用）
  const eventOn = (event, handler) => {
    if (typeof handler !== 'function') return handler
    events.push({ event: String(event), handler })
    return handler
  }
  const eventOff = (event, handler) => {
    const list = events.filter(e => e.event === String(event))
    const idx = list.findIndex(e => e.handler === handler)
    if (idx >= 0) {
      const target = list[idx]
      const all = events.indexOf(target)
      events.splice(all, 1)
    }
    return handler
  }
  const eventTavern = {
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    MESSAGE_UPDATED: 'MESSAGE_UPDATED',
    MESSAGE_DELETED: 'MESSAGE_DELETED',
    MESSAGE_SWIPED: 'MESSAGE_SWIPED',
    MESSAGE_EDITED: 'MESSAGE_EDITED',
  }

  const sandboxConsole = makeConsole(scriptId)
  const sandbox = {
    // 变量/楼层 API（由调用方通过 hostApi 注入）
    ...(hostApi || {}),
    // 沙箱事件 API（后展开，覆盖宿主同名：钩子注册到本 runtime 的事件表）
    eventOn, eventOff, eventTavern,
    eventEmit: async (event, ...args) => {
      // 沙箱内自派发：只投回本 runtime 的钩子
      for (const e of events.filter(e => e.event === String(event))) {
        await e.handler(...args)
      }
    },
    // 基础环境
    console: sandboxConsole,
    setTimeout: sandboxSetTimeout,
    clearTimeout,
    setInterval: (fn, ms, ...args) => sandboxSetTimeout(fn, Math.min(Number(ms) || 0, MAX_TIMER_MS), ...args),
    clearInterval: clearTimeout,
    queueMicrotask,
    structuredClone,
    performance: { now: () => Date.now() },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) dsh-server-engine', language: 'zh-CN', languages: ['zh-CN'], platform: 'Linux x86_64', onLine: true, clipboard: {} },
    location: { href: 'http://127.0.0.1:3081/', origin: 'http://127.0.0.1:3081', protocol: 'http:', host: '127.0.0.1:3081', hostname: '127.0.0.1', port: '3081', pathname: '/', search: '', hash: '' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: cb => sleepSetTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: id => clearTimeout(id),
    localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size } } })(),
    sessionStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), get length() { return m.size } } })(),
    alert() {}, confirm() { return false }, prompt() { return null },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
    crypto: globalThis.crypto,
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.globalThis = sandbox
  sandbox.top = sandbox
  sandbox.parent = sandbox
  sandbox.frames = sandbox

  const context = vm.createContext(sandbox)

  // 编译并执行脚本源码（顶层代码注册钩子/初始化）
  const compiled = []
  for (const src of sources) {
    try {
      const script = new vm.Script(src.code, { filename: src.name || scriptId + ':' + (src.name || 'script') })
      script.runInContext(context, { timeout: timeoutMs })
      compiled.push({ name: src.name || src.code.slice(0, 40), ok: true })
    } catch (error) {
      compiled.push({ name: src.name || '?', ok: false, error: String(error && error.message || error) })
      errors.push({ source: src.name, error: String(error && error.message || error) })
      logger?.warn?.(`[mvu-sandbox] 脚本执行失败 ${scriptId}/${src.name}:`, String(error && error.message || error))
    }
  }

  return {
    scriptId,
    events,           // [{event, handler}] 已注册的事件钩子
    errors,           // 加载期错误
    compiled,
    timeoutMs,
    /** 触发本 runtime 的某事件钩子（服务端事件桥接调用） */
    async dispatchEvent(event, ...args) {
      for (const e of events.filter(e => e.event === String(event))) {
        try {
          await Promise.race([
            e.handler(...args),
            new Promise((_, reject) => sleepSetTimeout(() => reject(new Error('钩子执行超时')), timeoutMs)),
          ])
        } catch (error) {
          // 单钩子失败不中断其他钩子（与浏览器 eventEmit 的失败隔离语义一致）
          logger?.warn?.(`[mvu-sandbox] 钩子异常 ${scriptId}/${event}:`, String(error && error.message || error))
        }
      }
    },
    /** 释放：清钩子表与上下文引用（GC 回收） */
    dispose() {
      events.length = 0
      errors.length = 0
      compiled.length = 0
    },
  }
}

/** 创建多个 runtime 的事件桥：服务端事件 → 各 runtime 的同名钩子 */
export function bridgeServerEvents(serverEvents, runtimes) {
  for (const event of serverEvents) {
    serverEvents.on(event, async (...args) => {
      for (const rt of runtimes) {
        try { await rt.dispatchEvent(event, ...args) } catch { /* 钩子异常已逐个记录 */ }
      }
    })
  }
}
