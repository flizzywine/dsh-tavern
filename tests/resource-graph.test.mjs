import assert from 'node:assert/strict'
import test from 'node:test'

import { createResourceGraph } from '../tavern-plugin/lib/domain/resource-graph.js'

function harness(fault) {
  const resourcePaths = new Set(['cards/old.json'])
  let operation = null
  let index = { chats: [{ id: 'chat-1', cardPath: 'cards/old.json', mode: 'card' }] }
  let chat = {
    id: 'chat-1',
    cardPath: 'cards/old.json',
    workspace: {
      sourcePaths: ['cards/old.json'],
      mountedResources: [{ kind: 'card', path: 'cards/old.json', label: 'old' }]
    }
  }
  const organizationMoves = []
  const options = {
    cardOrganization: { async movePath(from, to) { organizationMoves.push([from, to]) } },
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
      async updateIndex(updater) { const next = await updater(await this.readIndex()); if (next !== undefined) await this.writeIndex(next); return next },
      async writeIndex(value) { index = structuredClone(value) },
      async updateRefs(id, mutate) { const next = await mutate(structuredClone(chat)); chat = structuredClone(next) }
    },
    operations: {
      async read() { return structuredClone(operation) },
      async write(value) { operation = structuredClone(value) },
      async remove() { operation = null }
    },
    fault
  }
  return {
    options, organizationMoves,
    graph: createResourceGraph(options),
    snapshot() { return { resourcePaths: [...resourcePaths], operation: structuredClone(operation), index: structuredClone(index), chat: structuredClone(chat) } }
  }
}

test('后台更新存档引用失败时只记日志，操作日志保留到下次继续', async () => {
  const app = harness()
  app.options.chats.writeIndex({ chats: [{ id: 'chat-1', cardPath: 'cards/other.json', mode: 'card' }] })
  const warnings = []
  const updateRefs = app.options.chats.updateRefs
  app.options.chats.updateRefs = async () => { throw new Error('disk busy') }
  const graph = createResourceGraph(Object.assign({}, app.options, { logger: { warn: (...args) => warnings.push(args.join(' ')) } }))

  await graph.rename('cards/old.json', 'new.json')
  await graph.idle()
  assert.match(warnings.join('\n'), /disk busy/)
  assert.equal(app.snapshot().operation.kind, 'rename')

  app.options.chats.updateRefs = updateRefs
  await createResourceGraph(app.options).recover()
  assert.equal(app.snapshot().operation, null)
  assert.deepEqual(app.snapshot().chat.workspace.sourcePaths, ['cards/new.json'])
})
