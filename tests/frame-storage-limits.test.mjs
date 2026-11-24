import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

import { createFrameStorage } from '../tavern-plugin/lib/domain/frame-storage.js'

const namespace = 'dsh-card:' + encodeURIComponent(JSON.stringify(['cards/re0.png', 's1'])) + ':'

function memoryProfile() {
  let doc = {}
  return {
    async readJson() { return doc },
    async updateJson(_path, fn) { doc = fn(doc); return doc },
    get doc() { return doc },
  }
}

// A phone photo inside the 1.5 MB card limit becomes a ~2 MB data URL inside one JSON map.
const avatarMap = JSON.stringify({ emilia: 'data:image/jpeg;base64,' + 'A'.repeat(2_100_000) })

test('服务端卡片存储接受手机照片大小的头像值，且不回传整份存储', async () => {
  const profile = memoryProfile()
  const storage = createFrameStorage(profile)
  const result = await storage.update([{ op: 'set', key: namespace + 're0:narrative-v2:avatar-overrides', value: avatarMap }])
  assert.deepEqual(result, { ok: true, applied: 1 })
  assert.equal(profile.doc[namespace + 're0:narrative-v2:avatar-overrides'], avatarMap)
})

test('服务端卡片存储仍拒绝超过单条和总量上限的写入', async () => {
  const storage = createFrameStorage(memoryProfile())
  await assert.rejects(storage.update([{ op: 'set', key: namespace + 'big', value: 'x'.repeat(16 * 1024 * 1024 + 1) }]), /Invalid frame storage value/)
  const ops = Array.from({ length: 5 }, (_, index) => ({ op: 'set', key: namespace + 'k' + index, value: 'x'.repeat(15 * 1024 * 1024) }))
  await assert.rejects(storage.update(ops), /64 MB/)
})

async function frameStorageSource() {
  return await readFile(new URL('../tavern-plugin/src/client/frame-storage.js', import.meta.url), 'utf8')
}

test('卡片内的 localStorage 替身接受 2 MB 头像并转交宿主', async () => {
  const posted = []
  const window = { parent: { postMessage: message => posted.push(message) }, addEventListener() {} }
  const context = vm.createContext({ window, TextEncoder, Object, Set, Error, String, Number })
  vm.runInContext(await frameStorageSource() + '\ninstallFrameStorage({ token: "t", namespace: ' + JSON.stringify(namespace) + ', seed: {} });', context)
  window.localStorage.setItem('re0:narrative-v2:avatar-overrides', avatarMap)
  assert.equal(window.localStorage.getItem('re0:narrative-v2:avatar-overrides'), avatarMap)
  assert.equal(posted.length, 1)
  assert.equal(posted[0].value, avatarMap)
  assert.throws(() => window.localStorage.setItem('big', 'x'.repeat(16 * 1024 * 1024 + 1)), /QuotaExceededError/)
})

test('宿主转发并持久化 2 MB 头像，大写入分批提交', async () => {
  const calls = []
  const timers = []
  const window = {
    setTimeout(fn) { timers.push(fn); return timers.length },
    clearTimeout() {},
    MutationObserver: undefined,
    crypto: { getRandomValues: array => array.fill(7) },
  }
  const rpc = async (method, args) => {
    calls.push({ method, args })
    if (method === 'getFrameStorage') return { values: {} }
    return { ok: true, applied: args.ops.length }
  }
  const context = vm.createContext({ window, rpc, TextEncoder, console, Promise, Map, Array, Object, Set, Error, String, Number, Date, JSON, Uint8Array })
  vm.runInContext(await frameStorageSource() + '\nglobalThis.forkFrameStorage = forkFrameStorage;', context)
  const storage = context.forkFrameStorage
  const capability = storage.capability({ sessionId: 's1', cardPath: 'cards/re0.png' }, window)
  const source = { postMessage() {} }
  const frame = { contentWindow: source, addEventListener() {}, removeEventListener() {} }
  storage.register(frame, capability)
  storage.start()
  const send = (key, value) => storage.receive({ source, data: { type: 'dsh-tavern-frame-storage', token: capability.token, namespace: capability.namespace, op: 'set', key: capability.namespace + key, value } })
  assert.equal(send('re0:narrative-v2:avatar-overrides', avatarMap), true)
  for (let index = 0; index < 3; index++) assert.equal(send('photo' + index, 'y'.repeat(15 * 1024 * 1024)), true)
  assert.equal(await storage.flush(), true)
  const batches = calls.filter(call => call.method === 'updateFrameStorage')
  assert.ok(batches.length >= 2, 'writes over 32 MB are split into several acknowledged batches')
  const written = batches.flatMap(call => call.args.ops)
  assert.equal(written.length, 4)
  assert.equal(written[0].value, avatarMap)
})
