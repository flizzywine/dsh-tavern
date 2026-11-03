import { fail } from '../core.js'
import { setTimeout as delay } from 'node:timers/promises'
export function boundedFetch(fetch = globalThis.fetch, sleep = (ms, signal) => delay(ms, undefined, {signal})) {
  return async (url, options) => {
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      options?.signal?.throwIfAborted()
      response = await fetch(url, options)
      if (response.status !== 429 || attempt === 2) break
      // quota responses back off, but auth/network errors never retry.
      const retry = response.headers.get('retry-after')
      const seconds = retry === null ? NaN : Number(retry)
      const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now()
      await response.body?.cancel()
      await sleep(Math.min(15000,Math.max(1000 * 2 ** attempt,requested || 0)),options?.signal)
    }
    if (!response.body) return response
    const chunks = [], reader = response.body.getReader(); let size = 0
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break
        size += value.length; if (size > 32 * 1024 ** 2) fail('INVALID_AUDIO')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers})
  }
}
