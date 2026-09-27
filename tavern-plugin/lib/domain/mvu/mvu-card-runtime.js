// MVU 卡脚本服务端运行时（第二阶段 M2 沙箱）
// 在服务端 node:vm 沙箱中执行卡脚本源码，让脚本通过 eventOn 注册钩子。
// 服务端事件（MESSAGE_RECEIVED 等）触发时，沙箱内的钩子通过宿主 API 读写变量。
//
// 生命周期：按 cardPath 惰性创建 → 常驻复用 → dispose 释放。
// 超时保护：同步 vm.timeout + 异步 Promise.race。
import vm from 'node:vm'

const runtimes = new Map() // cardPath → runtime

export function createCardScriptRuntime({ cardPath, sources, hostApi, timeoutMs = 8000, logger = console, onDomAccess }) {
  const events = [] // [{event, handler}]
  const errors = []
  let domAccessed = false
  // DOM 探针（A.6.2 自愈）：UI 脚本误入服务端时，读取/调用 document 即标记（首次通知宿主）。
  // Proxy 只包普通函数对象（不碰 contextify 全局拦截器，跨 realm 可靠）：get/apply 触发标记，
  // 返回可链式 no-op——脚本不炸、不产生脏数据，标记后由下次分派转浏览器。
  function makeDomProbe() {
    const arm = () => {
      const first = !domAccessed
      domAccessed = true
      if (first) { try { onDomAccess?.() } catch {} }
    }
    return new Proxy(function cardUiDomProbe() {}, {
      get(target, prop) {
        if (typeof prop === 'symbol') return Reflect.get(target, prop)
        arm()
        if (prop === 'toString' || prop === Symbol.toPrimitive) return () => '[card-dom-probe]'
        return makeDomProbe()
      },
      apply() {
        arm()
        return makeDomProbe()
      },
      set(target, prop, value) { return true },
      has() { return true }
    })
  }

  const consoleShim = {
    log: (...a) => logger.info?.(`[${cardPath}]`, ...a),
    info: (...a) => logger.info?.(`[${cardPath}]`, ...a),
    warn: (...a) => logger.warn?.(`[${cardPath}]`, ...a),
    error: (...a) => logger.error?.(`[${cardPath}]`, ...a),
    debug: () => {},
  }

  const eventOn = (event, handler) => {
    if (typeof handler !== 'function') return handler
    events.push({ event: String(event), handler })
    return handler
  }
  const eventOff = (event, handler) => {
    const idx = events.findIndex(e => e.event === String(event) && e.handler === handler)
    if (idx >= 0) events.splice(idx, 1)
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

  const sandbox = {
    // 宿主 API（由调用方注入：变量读写、楼层操作等）
    ...(hostApi || {}),
    // 事件系统
    eventOn, eventOff, eventTavern,
    eventEmit: async (event, ...args) => {
      for (const e of events.filter(e => e.event === String(event))) {
        try { await e.handler(...args) } catch (err) {
          consoleShim.error('钩子异常:', String(err && err.message || err))
        }
      }
    },
    // 环境
    console: consoleShim,
    setTimeout: (fn, ms, ...args) => globalThis.setTimeout(fn, Math.min(Number(ms) || 0, 60_000), ...args),
    clearTimeout: id => globalThis.clearTimeout(id),
    setInterval: (fn, ms, ...args) => globalThis.setInterval(fn, Math.min(Number(ms) || 1000, 60_000), ...args),
    clearInterval: id => globalThis.clearInterval(id),
    queueMicrotask,
    structuredClone,
    performance: { now: () => Date.now() },
    navigator: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) dsh-server-engine', language: 'zh-CN', languages: ['zh-CN'], platform: 'Linux x86_64', onLine: true },
    location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', host: '127.0.0.1', pathname: '/', search: '', hash: '' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: cb => globalThis.setTimeout(() => cb(Date.now()), 16),
    cancelAnimationFrame: id => globalThis.clearTimeout(id),
    localStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size } } })(),
    sessionStorage: (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), get length() { return m.size } } })(),
    alert() {}, confirm() { return false }, prompt() { return null },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true },
    fetch: undefined,
    crypto: globalThis.crypto,
    document: makeDomProbe(),
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.globalThis = sandbox
  sandbox.top = sandbox
  sandbox.parent = sandbox
  sandbox.frames = sandbox

  const context = vm.createContext(sandbox)

  // 编译并执行脚本源码（逐脚本执行，加载期 DOM 探针触发可定位到脚本名）
  for (const src of sources) {
    try {
      new vm.Script(src.code, { filename: src.name || cardPath + ':script' }).runInContext(context, { timeout: timeoutMs })
    } catch (error) {
      if (error && error.code === 'DSH_CARD_UI_SCRIPT') {
        try { onDomAccess?.(src.name) } catch {}
        errors.push({ source: src.name || cardPath + ':script', error: '已自动识别为界面脚本，转浏览器执行', domProbe: true })
        logger?.info?.(`[mvu-card-runtime] ${cardPath}/${src.name}: DOM 探针触发，转浏览器执行`)
        continue
      }
      errors.push({ source: src.name || cardPath + ':script', error: String(error && error.message || error) })
      logger?.warn?.(`[mvu-card-runtime] 脚本执行失败 ${cardPath}/${src.name}:`, String(error && error.message || error))
    }
  }

  return {
    cardPath,
    context,
    sandbox,
    events,
    errors,
    timeoutMs,
    get domAccessed() { return domAccessed },
    /** 触发事件 → 调用沙箱内所有匹配的钩子 */
    async dispatchEvent(event, ...args) {
      for (const e of events.filter(e => e.event === String(event))) {
        try {
          await Promise.race([
            e.handler(...args),
            new Promise((_, reject) => setTimeout(() => reject(new Error('钩子执行超时')), timeoutMs)),
          ])
        } catch (error) {
          // 事件钩子期访问 DOM：探针 getter 已落标记，此处通知宿主（无法定位脚本，runtime 级）后静默跳过
          if (error && error.code === 'DSH_CARD_UI_SCRIPT') {
            try { onDomAccess?.(null) } catch {}
            continue
          }
          logger?.warn?.(`[mvu-card-runtime] 钩子异常 ${cardPath}/${event}:`, String(error && error.message || error))
        }
      }
    },
    /** 释放 */
    dispose() {
      events.length = 0
    },
  }
}

/** 获取或创建某卡的运行时（按 cardPath 缓存） */
export function getOrCreateRuntime(cardPath, sources, hostApi, timeoutMs, onDomAccess) {
  let rt = runtimes.get(cardPath)
  if (!rt) {
    rt = createCardScriptRuntime({ cardPath, sources, hostApi, timeoutMs, onDomAccess })
    runtimes.set(cardPath, rt)
  }
  return rt
}

export function disposeRuntime(cardPath) {
  const rt = runtimes.get(cardPath)
  if (rt) { rt.dispose(); runtimes.delete(cardPath) }
}

export function disposeAll() {
  for (const rt of runtimes.values()) rt.dispose()
  runtimes.clear()
}
