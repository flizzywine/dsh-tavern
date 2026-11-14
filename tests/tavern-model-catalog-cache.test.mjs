import test from 'node:test'
import assert from 'node:assert/strict'
import {createModelCalls} from '../tavern-plugin/lib/domain/model-calls.js'

function harness({catalogTtlMs = 30000, listDelay = 0} = {}){
  let walks = 0
  const llm = {
    listProviders(){ return [{id:'p1', name:'P1'}] },
    async listModels(){ walks++; if (listDelay) await new Promise(r => setTimeout(r, listDelay)); return [{id:'m1', name:'M1'}] }
  }
  const calls = createModelCalls({ llm, agentDefaultModel: undefined, agents: () => undefined, sessionProjections: () => undefined, backgroundConfigForSession: async () => null, catalogTtlMs })
  return { calls, walks: () => walks }
}

test('模型目录在 TTL 内复用，过期后重新遍历', async () => {
  const h = harness({ catalogTtlMs: 20 })
  assert.deepEqual(await h.calls.tavernModelCatalog(), [{ provider: 'p1', providerName: 'P1', models: [{ id: 'm1', name: 'M1' }] }])
  await h.calls.tavernModelCatalog()
  assert.equal(h.walks(), 1, 'TTL 内不重复遍历 provider')
  await new Promise(resolve => setTimeout(resolve, 30))
  await h.calls.tavernModelCatalog()
  assert.equal(h.walks(), 2, 'TTL 过期后重新遍历')
  await h.calls.tavernModelCatalog({ fresh: true })
  assert.equal(h.walks(), 3, 'fresh 强制重新遍历')
})

test('并发读取共享同一次遍历', async () => {
  const h = harness({ listDelay: 10 })
  const [a, b, c] = await Promise.all([h.calls.tavernModelCatalog(), h.calls.tavernModelCatalog(), h.calls.tavernModelCatalog()])
  assert.equal(h.walks(), 1)
  assert.deepEqual(a, b)
  assert.deepEqual(b, c)
})
