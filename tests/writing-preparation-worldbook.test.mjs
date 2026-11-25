import assert from 'node:assert/strict'
import test from 'node:test'
import { pureWritingContext, pureWritingInjection } from '../tavern-plugin/lib/domain/pure-writing-request.js'
import { createWritingPreparation } from '../tavern-plugin/lib/domain/writing-preparation.js'

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
