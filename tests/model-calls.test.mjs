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

test('no model, an empty reply, a token cut-off and a failed stream all reject with the reason', async () => {
  await assert.rejects(harness({ defaultSelection: null }).calls.callModel({ messages: [] }), /没有可用的模型配置/)
  await assert.rejects(harness({ chunks: [{ type: 'text-delta', text: '  ' }] }).calls.callModel({ messages: [] }), /模型返回为空/)
  await assert.rejects(harness({ chunks: [{ type: 'finish', reason: { kind: 'max-tokens' } }] }).calls.callModel({ messages: [] }), /token 上限/)
  await assert.rejects(harness({ chunks: [{ type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }] }).calls.callModel({ messages: [] }), /额度不足/)
})
