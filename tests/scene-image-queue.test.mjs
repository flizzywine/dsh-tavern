import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSceneImageQueue } from '../tavern-plugin/lib/domain/scene-image-queue.js'

async function until(check) { for (let n = 0; n < 400; n++) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 10)) } throw new Error('queue condition timeout') }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tavern-image-queue-'))
  const children = []
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited }
    await rm(root, { recursive: true, force: true })
  })
  const store = createProfileDataStore({ dataRoot: root })
  const child = requestId => {
    const child = fork(new URL('./fixtures/scene-image-queue-worker.mjs', import.meta.url), [root, requestId], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    const events = []
    child.on('message', message => events.push(message))
    children.push(child)
    return { child, events }
  }
  return { root, store, child, queue: () => createSceneImageQueue({ store: createProfileDataStore({ dataRoot: root }) }) }
}

test('independent processes share a FIFO queue; a live owner is not displaced by elapsed time', async t => {
  const fx = await fixture(t)
  const a = fx.child('first')
  await until(() => a.events.some(event => event.event === 'entered'))
  const b = fx.child('second')
  await until(async () => (await fx.store.readJson('scene-images/request-queue.json')).entries.length === 2)
  const c = fx.child('third')
  await until(async () => (await fx.store.readJson('scene-images/request-queue.json')).entries.length === 3)
  await until(async () => {
    try { await fx.store.updateJson('scene-images/request-queue.json', value => ({ ...value, entries: value.entries.map(entry => ({ ...entry, enqueuedAt: 1 })) })); return true }
    catch (error) { if (error.code === 'DSH_TAVERN_WRITE_CONFLICT') return false; throw error }
  })
  assert.equal(b.events.length, 0); assert.equal(c.events.length, 0)
  a.child.send('release')
  await until(() => b.events.some(event => event.event === 'entered'))
  assert.equal(c.events.length, 0)
  b.child.send('release')
  await until(() => c.events.some(event => event.event === 'entered'))
  c.child.send('release')
  await until(() => c.events.some(event => event.event === 'done'))
  assert.equal((await fx.store.readJson('scene-images/request-queue.json')).entries.length, 0)
})

test('confirmed dead process releases its position without replaying its operation', async t => {
  const fx = await fixture(t)
  const a = fx.child('dead-owner')
  await until(() => a.events.some(event => event.event === 'entered'))
  const b = fx.child('survivor')
  await until(async () => (await fx.store.readJson('scene-images/request-queue.json')).entries.length === 2)
  const exited = once(a.child, 'exit'); a.child.kill('SIGKILL'); await exited
  await until(() => b.events.some(event => event.event === 'entered'))
  b.child.send('release')
  await until(() => b.events.some(event => event.event === 'done'))
  assert.equal(a.events.filter(event => event.event === 'entered').length, 1)
})

test('cancelling a queued process does not enter or cancel the active process', async t => {
  const fx = await fixture(t)
  const a = fx.child('active')
  await until(() => a.events.some(event => event.event === 'entered'))
  const b = fx.child('cancel-queued')
  await until(async () => (await fx.store.readJson('scene-images/request-queue.json')).entries.length === 2)
  b.child.send('cancel')
  await until(() => b.events.some(event => event.event === 'failed'))
  assert.equal(b.events.some(event => event.event === 'entered'), false)
  assert.equal(a.events.some(event => event.event === 'done'), false)
  assert.equal((await fx.store.readJson('scene-images/request-queue.json')).entries.length, 1)
  a.child.send('release')
  await until(() => a.events.some(event => event.event === 'done'))
})

test('abort signal alone cannot release an operation that has not finished', async t => {
  const fx = await fixture(t), controller = new AbortController()
  let release, entered = false, second = false
  const first = fx.queue().run({ requestId: 'first', signal: controller.signal }, async () => { entered = true; return new Promise(resolve => { release = resolve }) })
  await until(() => entered)
  controller.abort()
  const next = fx.queue().run({ requestId: 'second', signal: new AbortController().signal }, async () => { second = true })
  await until(async () => (await fx.store.readJson('scene-images/request-queue.json')).entries.length === 2)
  assert.equal(second, false)
  release(); await first; await next
  assert.equal(second, true)
})
