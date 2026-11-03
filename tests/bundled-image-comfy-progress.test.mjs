import assert from 'node:assert/strict'
import test from 'node:test'
import { createComfyProgress } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/comfy-progress.js'
import { installTavernBridge } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/tavern-bridge.js'

test('ComfyUI progress shares a lazy connection, isolates prompt IDs, and discards terminal jobs', () => {
  const connections = []
  const tracker = createComfyProgress({ connect(url, headers) {
    const socket = new EventTarget()
    socket.close = () => { socket.closed = true }
    connections.push({ url, headers, socket })
    return socket
  } })
  const first = { comfyId: 'first', state: 'running', percent: 0 }
  const second = { comfyId: 'second', state: 'pending', percent: 0, controller: new AbortController() }
  const endpoint = 'https://comfy.example/base'
  assert.equal(connections.length, 0)
  const clientId = tracker.watch(endpoint, { authorization: 'Bearer key' }, first)
  assert.equal(tracker.watch(endpoint, {}, second), clientId)
  assert.equal(connections.length, 1)
  const { url, headers, socket } = connections[0]
  assert.equal(url.href, 'wss://comfy.example/base/ws?clientId=' + clientId)
  assert.deepEqual(headers, { authorization: 'Bearer key' })
  const progress = (id, value, max) => socket.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ type: 'progress', data: { prompt_id: id, value, max } })
  }))
  progress('unknown', 40, 40)
  progress('first', 11, 40)
  progress('first', 2, 40)
  progress('second', 2, 0)
  assert.deepEqual([first.percent, second.percent], [27, 0])
  progress('first', 40, 40)
  assert.equal(first.percent, 99)
  second.controller.abort()
  progress('second', 10, 40)
  assert.equal(second.percent, 0)
  first.state = 'done'
  tracker.sweep(endpoint, job => job.state !== 'done')
  assert.equal(socket.closed, true)
  tracker.dispose()
  assert.equal(tracker.watch(endpoint, {}, first), undefined)
})

test('the bridge writes progress only for the pending image and keeps the ready transition', { timeout: 5000 }, async t => {
  const updates = []
  const job = { state: 'running', percent: 27 }
  const text = '她推开了木门，屋里的灯亮了起来。'
  const tavern = {
    apiVersion: 5, promptSection() {}, onTurnSettled() {}, list: async () => [],
    getTurn: async () => ({ textVersion: 'v1', text }),
    attach: async () => ({ id: 'media-1' }),
    async update(id, patch) {
      updates.push({ id, patch })
      if (patch.progress === 0.27) Object.assign(job, { state: 'done', percent: 100, file: 'image.png' })
    },
  }
  const bridge = installTavernBridge({
    tavern, attachments: { saveImage: async () => ({ attachmentId: 'a1' }) },
    getConfig: () => ({}), readFileAsBytes: async () => new Uint8Array([1]),
    engine: {
      getJob: () => job,
      planMessage: async ({ onPlan }) => {
        onPlan({ jobId: 'job-1', regex: text, caption: '进门' })
        return { plans: [] }
      },
    },
  })
  t.after(() => bridge.dispose())
  await bridge.attachTurn({ gameId: 'g', turn: 1, textVersion: 'v1', text, manual: true })
  assert.deepEqual(updates.map(({ id, patch }) => [id, patch.status, patch.progress]), [
    ['media-1', undefined, 0.27], ['media-1', 'ready', 1],
  ])
})
