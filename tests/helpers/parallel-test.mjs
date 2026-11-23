// Runs a browser test file's cases concurrently (default 4 at a time) instead of one after another.
// Drop-in for `import test from 'node:test'`: every case registers synchronously at module load, then one
// suite with {concurrency} runs them. sharedBrowser() launches Chromium once per file; each case opens its own page/context.
import nodeTest, {describe, after} from 'node:test'
import {chromium} from 'playwright'

let limit = Number(process.env.DSH_BROWSER_TEST_CONCURRENCY) || 4
// How many cases of this file run at once (call at module top, before the first test).
export const concurrency = n => { limit = n }
const queue = []
let scheduled = false
export default function test(name, options, fn) {
  if (typeof options === 'function') { fn = options; options = {} }
  queue.push({name, options, fn})
  if (scheduled) return
  scheduled = true
  setImmediate(() => describe('cases', {concurrency: limit}, () => {
    after(async () => { if (browserPromise) await (await browserPromise).close() })
    for (const row of queue) nodeTest(row.name, row.options, row.fn)
  }))
}

let browserPromise = null
export function sharedBrowser(args = ['--mute-audio']) {
  if (!browserPromise) {
    browserPromise = chromium.launch({headless: true, args})
  }
  return browserPromise
}
// Runs fn over items, at most n at a time, results in order: a case that opens many pages keeps its own fan-out bounded.
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => { for (let i; (i = next++) < items.length;) out[i] = await fn(items[i], i) }))
  return out
}

// A shared limit for tasks started from several loops: const run = limiter(6); await Promise.all(items.map(x => run(() => work(x)))).
export function limiter(n) {
  let active = 0
  const waiting = []
  const release = () => { active--; waiting.shift()?.() }
  return async fn => {
    if (active >= n) await new Promise(resolve => waiting.push(resolve))
    active++
    try { return await fn() } finally { release() }
  }
}

// page.addScriptTag for a big script: `{content}` is served to the page as a file, because sending megabytes of source
// over the protocol costs more than the page's own parse. Other options pass through.
let scriptSerial = 0
export async function addScriptFile(page, options) {
  if (options.content === undefined) return page.addScriptTag(options)
  const url = `https://script.test/${scriptSerial++}.js`
  await page.route(url, route => route.fulfill({contentType: 'text/javascript; charset=utf-8', body: options.content}))
  return page.addScriptTag({url})
}