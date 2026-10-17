import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('const tavernCastStore = (function ()')
const body = source.slice(start, source.indexOf('function useTavernCast', start))
const flush = () => new Promise(resolve => setImmediate(resolve))

for (const failOldRequest of [false, true]) test('人物标注刷新后旧请求' + (failOldRequest ? '失败' : '成功') + '均不污染新缓存', async () => {
  let signal
  const requests = [], timers = []
  const store = vm.runInNewContext(body + '; tavernCastStore', {
    window: { setTimeout(fn) { timers.push(fn); return timers.length }, clearTimeout() {}, addEventListener() {} },
    rpc: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    tavernSessionSignals: { subscribe(_id, _type, listener) { signal = listener; return () => {} } }
  })
  const stop = store.subscribe('g', () => {})
  store.load('g', 2)
  timers.shift()()
  signal()
  store.load('g', 2)
  timers.shift()()
  requests[1].resolve({ enabled: true, turns: { 2: [{ speaker: 'new', quote: '新台词' }] } })
  await flush()
  if (failOldRequest) requests[0].reject(new Error('old request failed'))
  else requests[0].resolve({ enabled: true, turns: { 2: [{ speaker: 'old', quote: '旧台词' }] } })
  await flush()
  store.load('g', 2)
  assert.equal(store.lines('g', 2)[0].speaker, 'new')
  assert.equal(timers.length, 0, '有效的新缓存不需要重读')
  stop()
})
