import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelCalls } from '../tavern-plugin/lib/domain/model-calls.js'

function harness({ sessionConfig, defaultSelection = { provider: 'p', model: 'default' }, chunks = [{ type: 'text-delta', text: ' 好 ' }, { type: 'finish', reason: { kind: 'stop' } }] } = {}) {
  const prepared = []
  const llm = {
    async prepareCall(config) { prepared.push(config); return { config, async * stream() { yield * chunks } } },
    listProviders: () => [{ id: 'p', name: 'P' }, { id: 'empty' }],
    async listModels(id) { return id === 'p' ? [{ id: 'text' }, { id: 'vision', inputModalities: ['image'] }] : [] }
  }
  const agents = new Map(sessionConfig ? [['story', { session: { requestHeader: () => ({ config: sessionConfig }) } }]] : [])
  const calls = createModelCalls({
    llm, agentDefaultModel: { currentSelection: () => defaultSelection }, agents: () => agents, sessionProjections: () => undefined,
    backgroundConfigForSession: async () => ({ sessionId: 'story' })
  })
  return { calls, prepared }
}

test('a call trims the reply, keeps temperature except for Codex, and lists only text models', async () => {
  const { calls, prepared } = harness({ sessionConfig: { provider: 'p', model: 'session' } })
  assert.equal(await calls.callModel({ sessionId: 'story', messages: [], temperature: 0.7, maxTokens: 10 }), '好')
  assert.deepEqual(prepared[0], { provider: 'p', model: 'session', temperature: 0.7, maxTokens: 10 })
  const codex = harness({ sessionConfig: { provider: 'openai-codex', model: 'c' } })
  await codex.calls.callModel({ sessionId: 'story', messages: [], temperature: 0.7 })
  assert.equal('temperature' in codex.prepared[0], false)
  assert.deepEqual(await calls.tavernModelCatalog(), [{ provider: 'p', providerName: 'P', models: [{ id: 'text', name: 'text' }] }])
})

test('an explicit selection, streamed deltas and chunks, and usage on request', async () => {
  const { calls, prepared } = harness({ chunks: [
    { type: 'text-delta', text: ' answer ' }, { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
  ] })
  const deltas = [], chunks = []
  const result = await calls.callModel({ selection: { provider: 'judge', model: 'small' }, messages: [], returnUsage: true, onText: text => deltas.push(text), onChunk: chunk => chunks.push(chunk.type) })
  assert.deepEqual(prepared[0], { provider: 'judge', model: 'small' })
  assert.deepEqual(deltas, [' answer '])
  assert.deepEqual(chunks, ['text-delta', 'usage'])
  assert.deepEqual(result, { output: 'answer', usage: { inputTokens: 7, outputTokens: 2 } })
})

test('no model, an empty reply, a token cut-off and a failed stream all reject with the reason', async () => {
  await assert.rejects(harness({ defaultSelection: null }).calls.callModel({ messages: [] }), /没有可用的模型配置/)
  await assert.rejects(harness({ chunks: [{ type: 'text-delta', text: '  ' }] }).calls.callModel({ messages: [] }), /模型返回为空/)
  await assert.rejects(harness({ chunks: [{ type: 'finish', reason: { kind: 'max-tokens' } }] }).calls.callModel({ messages: [] }), /token 上限/)
  await assert.rejects(harness({ chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }] }).calls.callModel({ messages: [] }), /额度不足/)
})
