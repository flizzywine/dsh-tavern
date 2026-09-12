import test from 'node:test'
import assert from 'node:assert/strict'
import { createHelperWorldbookHost } from './fixtures/helper-worldbook-host.mjs'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('普通开场的真实 startChat 入口也建立多书快照，并复用交互草稿', async () => {
  const h = await createHelperWorldbookHost(false, true)
  try {
    const openingPreparation = createOpeningPreparation({ readCard: h.readCard, worldBooks: h.library })
    const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
    const startSource = source.slice(source.indexOf('async function startChat('), source.indexOf('\n  async function scriptPreviewOf('))
    const start = vm.runInNewContext('(' + startSource + ')', {
      openingPreparation, groupOfMode: mode => mode === 'card' ? 'card' : 'play',
      conversationInitialization: { async start(input) { return input } }
    })
    const plain = await start('card.json', 'plain', 'story', 'primary', '你')
    const snapshot = plain.preparation.worldbookSnapshot
    assert.equal(snapshot.version, 1)
    assert.equal(Object.keys(snapshot.document.entries).length, 2)
    assert.match(JSON.stringify(snapshot.document), /附加正文/)
    const draft = await openingPreparation.create('card.json')
    const interactive = await start('card.json', 'interactive', 'story', 'primary', '你', 'dsh', draft.id)
    assert.deepEqual(interactive.preparation.worldbookSnapshot, snapshot)
    const workbench = await start('card.json', 'workbench', 'card')
    assert.equal(workbench.preparation, undefined)
  } finally { await h.cleanup() }
})

for (const embedded of [false, true]) {
  for (const legacy of [false, true]) test(`多书开局及两种脚本写入均保存在本局：embedded=${embedded}, legacy=${legacy}`, async () => {
    const h = await createHelperWorldbookHost(embedded, true)
    try {
      const before = [await h.read(), await h.readExtra()]
      const preparation = createOpeningPreparation({ readCard: h.readCard, worldBooks: h.library })
      const first = await preparation.create('card.json')
      const second = await preparation.create('card.json')
      assert.equal(first.worldbook.entries.length, 2)
      assert.equal(first.worldbook.name, '审计书')
      assert.equal(new Set(first.worldbook.entries.map(entry => entry.uid)).size, 2)
      if (!legacy) h.chat.openingWorldbookSnapshot = preparation.resolve(first.id, 'card.json', 'primary').worldbookSnapshot
      const { worldbook } = await h.adapter.getWorldbook('audit', '审计书')
      const entries = structuredClone(worldbook.entries)
      const supplementary = entries.find(entry => entry.content === '附加正文')
      supplementary.content = '本局修改'
      await h.adapter.replaceWorldbook('audit', '审计书', entries, worldbook.entries)
      assert.ok(h.chat.openingWorldbookSnapshot)
      assert.equal(h.writes.at(-1).chat.openingWorldbookSnapshot.version, 1)
      assert.ok((await h.adapter.getWorldbook('audit', '审计书')).worldbook.entries.some(entry => entry.content === '本局修改'))
      const { worldInfo } = await h.adapter.loadWorldInfo('audit', '审计书')
      assert.equal(Object.keys(worldInfo.entries).length, 2)
      const native = structuredClone(worldInfo)
      native.entries[7].content = '本局主书修改'
      await h.adapter.saveWorldInfo('audit', '审计书', native, worldInfo)
      assert.equal((await h.readChat()).openingWorldbookSnapshot.document.entries[7].content, '本局主书修改')
      assert.deepEqual([await h.read(), await h.readExtra()], before)
      assert.deepEqual(preparation.get(second.id).worldbook, second.worldbook)
      const another = await h.library.bound('card.json', await h.readCard(), { id: 'another' })
      assert.ok(another.view.entries.some(entry => entry.content === '附加正文'))
      await assert.rejects(h.adapter.getWorldbook('audit', '附加书'), /只能访问/)
      await assert.rejects(h.adapter.saveWorldInfo('audit', '审计书', worldInfo, worldInfo), /已被其他操作修改/)
    } finally { await h.cleanup() }
  })
}
