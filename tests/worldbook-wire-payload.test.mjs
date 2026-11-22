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
