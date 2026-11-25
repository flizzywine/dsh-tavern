import assert from 'node:assert/strict'
import test from 'node:test'
import { createWritingPreparation } from '../tavern-plugin/lib/domain/writing-preparation.js'
import { createWritingPreparationSources } from '../tavern-plugin/lib/domain/writing-preparation-sources.js'

const stat_data = {
  game: {
    schemaVersion: 3,
    meta: { revision: 1, branchKey: 'current-branch' },
    player: { balance: 42, secretInventory: 'unrelated' },
    characters: {
      char_001: { name: '林婉', occupation: '律师', recentGoal: '找到钥匙', hobby: '摄影' },
      char_002: { name: '陈夏', occupation: '医生', recentGoal: '寻找病历' }
    }
  }
}
const previous = structuredClone(stat_data)
previous.game.meta.revision = 0
previous.game.player.balance = 30
const frame = {
  turn: 2,
  source: { regenerationMaterials: { generationState: { messageVariables: { stat_data } } } }
}
const chat = {
  mvu: { enabled: true },
  messages: [previous, stat_data].map(state => ({
    role: 'assistant', text: '剧情。', variables: [{ stat_data: state }]
  }))
}
const args = { gameId: 'game', frame, chat, signal: new AbortController().signal }
const readSources = createWritingPreparationSources({ chatForSession: async () => chat })

test('white glove requires a query and searches individual variable facts inside a namespace', async () => {
  const sources = readSources(args)
  for (const query of [undefined, '  ', 'game', 'schemaVersion', 'branchKey', 'revision', '未知人 occupation']) {
    assert.deepEqual(await sources.variables({ query }), [], query)
  }
  assert.deepEqual(await sources.variables({ query: '林婉' }), [
    { title: 'game', text: 'game的characters的char_001的name为 林婉。' }
  ])
  assert.deepEqual(await sources.variables({ query: 'char_001 林婉 occupation recentGoal' }), [{
    title: 'game',
    text: 'game的characters的char_001的occupation为 律师。\ngame的characters的char_001的recentGoal为 找到钥匙。'
  }])
  assert.deepEqual(await sources.variables({ query: 'balance' }), [
    { title: '上轮变量变化', text: 'game的player的balance为 42。' }
  ])
})

test('white glove keeps variable lookup receipts private and hands off only submitted prose', async () => {
  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources,
    runAgent: async (_owner, { tools: [read, submit] }, _context, onToolResult) => {
      const call = query => {
        const result = read(query).then(text => ({ ok: true, text }))
        onToolResult('read_variable_summary', result)
        return result.then(({ text }) => text)
      }
      assert.equal(await call({}), '没有查到资料。')
      const occupation = await call({ query: '林婉 occupation' })
      assert.match(occupation, /char_001的occupation为 律师/)
      const overlap = await call({ query: 'char_001 occupation recentGoal' })
      assert.match(overlap, /钥匙/)
      assert.doesNotMatch(overlap, /occupation/)
      assert.equal(await call({ query: '林婉 occupation' }), '命中的变量已在本轮查询结果中。')
      assert.throws(() => submit({ facts: ['char_001的职业是律师。'] }), /简短的剧情事实/)
      assert.deepEqual(submit({ facts: ['林婉是律师，最近在找钥匙。', '林婉是律师，最近在找钥匙。'] }), { accepted: true })
    }
  })
  preparation.register('white-glove', {
    prepare: ({ readVariables, submitVariableFacts, runAgent }) => runAgent({ tools: [readVariables, submitVariableFacts] })
  })
  const entry = await preparation.forGame(args.gameId)
  const material = await preparation.prepare(entry, { ...args, context: { messages: [] } })
  assert.equal(material, '【当前状态】\n林婉是律师，最近在找钥匙。')
})
