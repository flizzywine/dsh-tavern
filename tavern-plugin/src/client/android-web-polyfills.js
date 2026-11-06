// DSH 0.1.5 session projections use findLast; Android WebView 95 lacks it.
(function () {
  for (const name of ['findLast', 'findLastIndex']) {
    if (typeof Array.prototype[name] === 'function') continue
    Object.defineProperty(Array.prototype, name, {
      configurable: true, writable: true,
      value: function (predicate, thisArg) {
        'use strict'
        if (this == null) throw new TypeError('Array receiver is null or undefined')
        const object = Object(this)
        const length = Math.min(Math.max(Math.trunc(Number(object.length)) || 0, 0), Number.MAX_SAFE_INTEGER)
        if (typeof predicate !== 'function') throw new TypeError('predicate must be a function')
        for (let index = length - 1; index >= 0; index--) {
          const value = object[index]
          if (predicate.call(thisArg, value, index, object)) return name === 'findLast' ? value : index
        }
        return name === 'findLast' ? undefined : -1
      }
    })
  }
})();

// Android System WebView on MuMu can be Chrome 95-class: AbortSignal exists, but
// throwIfAborted / any / timeout and Promise.withResolvers do not. DSH 0.1.5-rc.2
// history load calls signal.throwIfAborted() on the client and fails without these.
//
// AbortSignal.any must not spuriously abort: a cancelled follow opens as an empty
// transcript with no loadError toast. Prefer addEventListener without an options
// object — some WebView AbortSignal paths mishandle { once: true }.
(function installAndroidWebPolyfills(global) {
	if (!global) return
	const AbortSignal = global.AbortSignal
	const AbortController = global.AbortController
	if (AbortSignal && AbortController) {
		const proto = AbortSignal.prototype
		if (typeof proto.throwIfAborted !== 'function') {
			proto.throwIfAborted = function throwIfAborted() {
				if (!this.aborted) return
				if (this.reason !== undefined) throw this.reason
				const error = new Error('This operation was aborted')
				error.name = 'AbortError'
				throw error
			}
		}
		if (typeof AbortSignal.any !== 'function') {
			AbortSignal.any = function any(signals) {
				const list = Array.from(signals || [])
				const controller = new AbortController()
				const onAbort = function () {
					if (controller.signal.aborted) return
					let reason
					for (let i = 0; i < list.length; i++) {
						const signal = list[i]
						if (signal && signal.aborted) {
							reason = signal.reason
							break
						}
					}
					if (reason === undefined) {
						const error = new Error('This operation was aborted')
						error.name = 'AbortError'
						reason = error
					}
					try { controller.abort(reason) }
					catch (_) { controller.abort() }
				}
				for (let i = 0; i < list.length; i++) {
					const signal = list[i]
					if (!signal || typeof signal.addEventListener !== 'function') continue
					if (signal.aborted) {
						onAbort()
						break
					}
					const onAbortOnce = function () {
						if (typeof signal.removeEventListener === 'function') {
							signal.removeEventListener('abort', onAbortOnce)
						}
						onAbort()
					}
					signal.addEventListener('abort', onAbortOnce)
				}
				return controller.signal
			}
		}
		if (typeof AbortSignal.timeout !== 'function') {
			AbortSignal.timeout = function timeout(ms) {
				const controller = new AbortController()
				const delay = Number(ms)
				const id = global.setTimeout(function () {
					const error = new Error('The operation was aborted due to timeout')
					error.name = 'TimeoutError'
					try { controller.abort(error) }
					catch (_) { controller.abort() }
				}, Number.isFinite(delay) && delay > 0 ? delay : 0)
				const onAbortOnce = function () {
					global.clearTimeout(id)
					if (typeof controller.signal.removeEventListener === 'function') {
						controller.signal.removeEventListener('abort', onAbortOnce)
					}
				}
				controller.signal.addEventListener('abort', onAbortOnce)
				return controller.signal
			}
		}
	}
	if (global.Promise && typeof global.Promise.withResolvers !== 'function') {
		global.Promise.withResolvers = function withResolvers() {
			let resolve
			let reject
			const promise = new Promise(function (res, rej) {
				resolve = res
				reject = rej
			})
			return { promise: promise, resolve: resolve, reject: reject }
		}
	}
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : undefined)
