import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPluginGameModes } from '../tavern-plugin/lib/domain/plugin-game-mode.js'

async function fixture(t, overrides = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'game-mode-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'state.json')
  const read = async () => { try { return JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  const deps = { read, async write(id, expected, doc) {
    assert.equal((await read())?.revision ?? null, expected)
    await writeFile(file + '.tmp', JSON.stringify(doc)); await rename(file + '.tmp', file)
  }, allowed: async () => {}, runAgent: async () => ({ text: 'agent' }), ...overrides }
  const provider = { name: 'counter', version: 1, create: async () => ({ state: { count: 0, secret: 'hidden' } }),
    advance: async ({ state }) => ({ state: { ...state, count: state.count + 1 } }), project: ({ state }) => ({ count: state.count }) }
  const runtime = createPluginGameModes(deps); runtime.register('test', provider)
  return { runtime, deps, provider, read }
}
test('durable mode: restart, projection, rewind, branch and stale actions', async t => {
  const f = await fixture(t), r = f.runtime
  assert.deepEqual((await r.execute('g', { op: 'create', key: 'test:counter' })).data, { count: 0 })
  await r.execute('g', { op: 'advance', revision: 1, actionId: 'a' })
  await r.execute('g', { op: 'advance', revision: 1, actionId: 'a' })
  assert.equal((await f.read()).frames.length, 2)
  await assert.rejects(r.execute('g', { op: 'advance', revision: 1 }), /已变化/)
  const reopened = createPluginGameModes(f.deps); reopened.register('test', f.provider)
  assert.equal((await reopened.view('g')).data.count, 1)
  await reopened.execute('g', { op: 'seek', revision: 2, cursor: 0 })
  await reopened.execute('g', { op: 'advance', revision: 3 })
  assert.equal((await f.read()).frames.length, 2)
  assert.equal((await reopened.view('g')).data.count, 1)
})
test('stop ignores late agent results and releases operation lock', async t => {
  let finish, started
  const entered = new Promise(resolve => { started = resolve })
  const f = await fixture(t)
  f.runtime.register('test', { ...f.provider, name: 'slow', advance: async ({ state }) => {
    started(); await new Promise(resolve => { finish = resolve }); return { state: { count: 99 } }
  } })
  await f.runtime.execute('g', { op: 'create', key: 'test:slow' })
  const pending = f.runtime.execute('g', { op: 'advance', revision: 1 })
  await entered
  await assert.rejects(f.runtime.execute('g', { op: 'advance', revision: 1 }), /正在运行/)
  f.runtime.stop('g'); await assert.rejects(pending, /停止/)
  finish(); await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await f.read()).revision, 1)
})
test('missing provider fails closed and incompatible versions do not alter saves', async t => {
  const f = await fixture(t)
  await f.runtime.execute('g', { op: 'create', key: 'test:counter' })
  const runtime = createPluginGameModes(f.deps)
  await assert.rejects(runtime.view('g'), /未加载/)
  runtime.register('test', { ...f.provider, version: 2 })
  await assert.rejects(runtime.execute('g', { op: 'advance', revision: 1 }), /不兼容/)
  assert.equal((await f.read()).revision, 1)
})
