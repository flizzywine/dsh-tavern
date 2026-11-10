import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { createResourceHandlers } from '../tavern-plugin/lib/rpc/resources.js'

const book = {
  name: '体量验收',
  description: '',
  entries: [
    { uid: 1, key: ['甲'], keysecondary: [], comment: '第一条', content: '正文一'.repeat(200), enabled: true, insertion_order: 1, extensions: { dsh_tavern_helper_extra: { keep: 'server only' } } },
    { uid: 2, key: ['乙'], keysecondary: [], comment: '第二条', content: '正文二'.repeat(200), enabled: false, insertion_order: 2, extensions: {} }
  ]
}

test('世界书 RPC 出口只回传渲染所需的视图，领域层对象不受影响', async () => {
  const view = inspectWorldBookDocument(book)
  const handlers = createResourceHandlers({
    worldBooks: {
      get: async () => ({ source: { kind: 'standalone', path: 'worldbooks/甲.json' }, view, globalEnabled: false }),
      update: async () => ({ source: { kind: 'standalone', path: 'worldbooks/甲.json' }, view, globalEnabled: false })
    }
  })
  for (const result of [await handlers.getWorldBook({ source: { kind: 'standalone', path: 'worldbooks/甲.json' } }), await handlers.updateWorldBook({ source: { kind: 'standalone', path: 'worldbooks/甲.json' }, update: {} })]) {
    assert.equal(result.view.raw, undefined)
    assert.equal(result.view.entries[0].rawEntry, undefined)
    assert.equal(result.view.entries[0].content.length, 600)
    assert.equal(result.globalEnabled, false)
  }
  assert.ok(view.entries[0].rawEntry, '同一份视图在服务端仍带着 rawEntry')
})

test('世界书读取带上相同 revision 时只回传未变化标记', async () => {
  const source = { kind: 'standalone', path: 'worldbooks/甲.json' }
  const view = inspectWorldBookDocument(book)
  const handlers = createResourceHandlers({
    worldBooks: {
      get: async () => ({ source, view, globalEnabled: false, revision: 1700000000000 })
    }
  })
  const same = await handlers.getWorldBook({ source, ifRevision: 1700000000000 })
  assert.deepEqual(same, { unchanged: true, source, revision: 1700000000000 })
  const stale = await handlers.getWorldBook({ source, ifRevision: 1 })
  assert.equal(stale.unchanged, undefined)
  assert.equal(stale.view.entryCount, 2)
  const uncached = createResourceHandlers({ worldBooks: { get: async () => ({ source, view, globalEnabled: false, revision: null }) } })
  assert.equal((await uncached.getWorldBook({ source, ifRevision: 1 })).view.entryCount, 2, '没有 revision 时照常回传整本书')
})
