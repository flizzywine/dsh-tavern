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

test('生成中的一轮只读一次开关和人物；刷新后重读', async () => {
  let signal
  const requests = [], timers = []
  const store = vm.runInNewContext(body + '; tavernCastStore', {
    window: { setTimeout(fn) { timers.push(fn); return timers.length }, clearTimeout() {}, addEventListener() {} },
    rpc: (method, args) => new Promise(resolve => requests.push({ args, resolve })),
    tavernSessionSignals: { subscribe(_id, _type, listener) { signal = listener; return () => {} } }
  })
  const stop = store.subscribe('g', () => {})
  assert.equal(store.shown('g'), null, '宿主回答前不知道对话气泡开没开')
  store.load('g', 0); store.load('g', 0)
  timers.shift()()
  assert.equal(timers.length, 0)
  assert.equal(JSON.stringify(requests.map(request => request.args.turns)), '[[]]')
  const characters = [{ name: '店主' }]
  requests[0].resolve({ enabled: true, turns: {}, characters })
  await flush()
  assert.equal(store.shown('g'), true)
  assert.equal(store.characters('g'), characters)
  store.load('g', 0)
  assert.equal(timers.length, 0, '已读过不再请求')
  signal()
  assert.equal(store.shown('g'), true, '刷新期间保持上次的回答，说话人行不闪')
  store.load('g', 0)
  timers.shift()()
  requests[1].resolve({ enabled: false, turns: {}, characters })
  await flush()
  assert.equal(store.shown('g'), false)
  stop()
})
