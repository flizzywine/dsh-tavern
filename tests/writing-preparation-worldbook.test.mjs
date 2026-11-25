import assert from 'node:assert/strict'
import test from 'node:test'
import { projectPureWritingRequest, pureWritingContext, pureWritingInjection } from '../tavern-plugin/lib/domain/pure-writing-request.js'
import { createWritingPreparation } from '../tavern-plugin/lib/domain/writing-preparation.js'
import { createWritingPreparationSources } from '../tavern-plugin/lib/domain/writing-preparation-sources.js'

test('white glove shows plot references by title and recognizes the same reference in legacy history', async () => {
  const frame = { frameId: 'writing', turn: 2 }
  const legacy = '【世界书 · [mvu_plot] 钟楼】\n塔钟在整点响。'
  const saved = pureWritingInjection({ frameId: 'previous', turn: 1 }, legacy)
  const player = { id: 'player', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '去钟楼' }] }
  const storedContext = { messages: [saved, player] }
  const visibleContext = pureWritingContext('', storedContext.messages)
  assert.equal(visibleContext.messages[0].content[0].text, '### 钟楼\n塔钟在整点响。')
  assert.equal(saved.content[0].text, legacy)

  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources: () => ({
      worldbook: async () => [
        { title: '[mvu_plot] 钟楼', text: '塔钟在整点响。' },
        { title: '02a_[MVU_PLOT] 钟楼', text: '塔钟改在半点响。' },
        { title: '侧门', text: '侧门朝北。' }
      ]
    }),
    runAgent: async (_owner, { tools: [find] }, _context, onToolResult) => {
      const result = find({ query: '钟楼' }).then(text => ({ ok: true, text }))
      onToolResult('find_worldbook', result)
      await result
    }
  })
  preparation.register('white-glove', { prepare: ({ findWorldbook, runAgent }) => runAgent({ tools: [findWorldbook] }) })
  const entry = await preparation.forGame('game')
  for (const context of [storedContext, visibleContext]) {
    assert.equal(await preparation.prepare(entry, { gameId: 'game', frame, context }),
      '### 钟楼\n塔钟改在半点响。\n\n【世界书 · 侧门】\n侧门朝北。')
  }
})

test('白手套每次查到前缀里的静态常驻 mvu_plot 都交接原文', async () => {
  const plot = { ref: 'plot', title: '[mvu_plot] 港城基调', constant: true, primaryKeys: ['南港'], content: '港城终年海风。' }
  const regular = { ref: 'regular', title: '南港常驻', constant: true, content: '灯塔是白色的。' }
  const frame = { frameId: 'writing', turn: 2, source: { regenerationMaterials: {
    worldbookPrefix: [plot.content, regular.content].join('\n\n'),
    worldbookEntries: [{ ref: plot.ref, text: '旧缓存正文' }]
  } } }
  const receipt = '### 港城基调\n' + plot.content
  const previous = pureWritingInjection({ frameId: 'previous', turn: 1 }, receipt)
  const context = { system: frame.source.regenerationMaterials.worldbookPrefix, messages: [previous] }
  const sources = createWritingPreparationSources({
    chatForSession: async () => ({ messages: [] }),
    worldbookForChat: async () => ({ view: { entries: [plot, regular] } })
  })
  let queries = []
  const preparation = createWritingPreparation({
    allowed: async () => true, readSources: sources,
    runAgent: async (_owner, { tools: [find] }, _context, onToolResult) => {
      for (const query of queries) {
        const result = find({ query }).then(text => ({ ok: true, text }))
        onToolResult('find_worldbook', result)
        assert.equal((await result).text, receipt)
      }
    }
  })
  preparation.register('white-glove', { prepare: ({ findWorldbook, runAgent }) => runAgent({ tools: [findWorldbook] }) })
  const registered = await preparation.forGame('game')
  const prepare = () => preparation.prepare(registered, { gameId: 'game', frame, context })
  assert.equal(await prepare(), '')
  queries = ['南港', '港城基调']
  const request = projectPureWritingRequest({}, { context, injection: pureWritingInjection(frame, await prepare()) })
  assert.equal(request.messages.at(-1).content[0].text, [receipt, receipt].join('\n\n'))
  assert.equal(request.system, context.system)
})
