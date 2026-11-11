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

test('世界书开关支持 lean 返回：只回 revision，不推整本视图', async () => {
  const source = { kind: 'standalone', path: 'worldbooks/甲.json' }
  const view = inspectWorldBookDocument(book)
  const handlers = createResourceHandlers({
    worldBooks: { update: async () => ({ source, view, revision: 42, globalEnabled: true }) }
  })
  const lean = await handlers.updateWorldBook({ source, lean: true, update: { operations: [] } })
  assert.deepEqual(lean, { source, revision: 42, globalEnabled: true, lean: true })
  assert.equal(lean.view, undefined)
  const full = await handlers.updateWorldBook({ source, update: { operations: [] } })
  assert.equal(full.view.entryCount, 2, '不传 lean 时仍回传完整视图')
})

test('世界书读取命中 revision 时连领域读取都不发生', async () => {
  const source = { kind: 'standalone', path: 'worldbooks/甲.json' }
  const view = inspectWorldBookDocument(book)
  let gets = 0
  const handlers = createResourceHandlers({
    worldBooks: {
      revision: async () => 7,
      get: async () => { gets += 1; return { source, view, globalEnabled: false, revision: 7 } }
    }
  })
  assert.deepEqual(await handlers.getWorldBook({ source, ifRevision: 7 }), { unchanged: true, source, revision: 7 })
  assert.equal(gets, 0, '命中 revision 时不该加载整本书')
  assert.equal((await handlers.getWorldBook({ source, ifRevision: 8 })).view.entryCount, 2)
  assert.equal(gets, 1)
})
