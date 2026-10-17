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
