import assert from 'node:assert/strict'
import test from 'node:test'

import { createResourceGraph } from '../tavern-plugin/lib/domain/resource-graph.js'

function harness(fault) {
  const resourcePaths = new Set(['cards/old.json'])
  let operation = null
  let index = { chats: [{ id: 'chat-1', cardPath: 'cards/old.json' }] }
  let chat = {
    id: 'chat-1',
    cardPath: 'cards/old.json',
    workspace: {
      sourcePaths: ['cards/old.json'],
      mountedResources: [{ kind: 'card', path: 'cards/old.json', label: 'old' }]
    }
  }
  const options = {
    resources: {
      async rename(oldPath) {
        const next = 'cards/new.json'
        if (resourcePaths.has(oldPath)) { resourcePaths.delete(oldPath); resourcePaths.add(next) }
        else if (!resourcePaths.has(next)) throw new Error('missing resource')
        return { oldPath, path: next }
      },
      async remove(target) { resourcePaths.delete(target) }
    },
    presets: { async rename() {}, async remove() {} },
    chats: {
      async readIndex() { return structuredClone(index) },
      async writeIndex(value) { index = structuredClone(value) },
      async readChat() { return structuredClone(chat) },
      async writeChat(value) { chat = structuredClone(value) }
    },
    operations: {
      async read() { return structuredClone(operation) },
      async write(value) { operation = structuredClone(value) },
      async remove() { operation = null }
    },
    fault
  }
  return {
    options,
    graph: createResourceGraph(options),
    snapshot() { return { resourcePaths: [...resourcePaths], operation: structuredClone(operation), index: structuredClone(index), chat: structuredClone(chat) } }
  }
}

test('资源已改名但 Chat 投影前崩溃时，重启完成整个资源图', async function () {
  const app = harness(async function ({ stage }) { if (stage === 'resource-renamed') throw new Error('process died') })
  await assert.rejects(app.graph.rename('cards/old.json', 'new.json'), /process died/)
  assert.deepEqual(app.snapshot().resourcePaths, ['cards/new.json'])
  assert.equal(app.snapshot().chat.cardPath, 'cards/old.json')
  assert.equal(app.snapshot().operation.stage, 'resource-renamed')

  await createResourceGraph(Object.assign({}, app.options, { fault: undefined })).recover()

  assert.equal(app.snapshot().operation, null)
  assert.equal(app.snapshot().chat.cardPath, 'cards/new.json')
  assert.equal(app.snapshot().chat.workspace.sourcePaths[0], 'cards/new.json')
  assert.equal(app.snapshot().chat.workspace.mountedResources[0].path, 'cards/new.json')
  assert.equal(app.snapshot().index.chats[0].cardPath, 'cards/new.json')
})

test('资源删除后崩溃时，重启清理 Chat 中的旧引用', async function () {
  const app = harness(async function ({ stage }) { if (stage === 'resource-removed') throw new Error('process died') })
  await assert.rejects(app.graph.remove('cards/old.json', 'card'), /process died/)

  await createResourceGraph(Object.assign({}, app.options, { fault: undefined })).recover()

  assert.deepEqual(app.snapshot().resourcePaths, [])
  assert.deepEqual(app.snapshot().chat.workspace.sourcePaths, [])
  assert.deepEqual(app.snapshot().chat.workspace.mountedResources, [])
})
