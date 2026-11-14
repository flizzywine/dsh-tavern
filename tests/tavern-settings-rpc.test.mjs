import test from 'node:test'
import assert from 'node:assert/strict'
import {createSettingsHandlers} from '../tavern-plugin/lib/rpc/settings.js'

function harness({settingsDelay = 0} = {}){
  let reads = 0, catalogCalls = 0
  const deps = {
    readTavernSettings: async () => { reads++; if (settingsDelay) await new Promise(r => setTimeout(r, settingsDelay)); return { playerName: '你' } },
    slotDeclarations: async () => [],
    scoringCatalog: () => ({ weights: [] }),
    tavernModelCatalog: async () => { catalogCalls++; return [{ provider: 'p1', providerName: 'P1', models: [{ id: 'm1', name: 'M1' }] }] },
    pluginApi: { bodyGenerators: { list: async () => [] } },
    presentSystemPrompts: () => ({}),
    presentUserPreferenceProfile: () => ({})
  }
  return { handlers: createSettingsHandlers(deps), reads: () => reads, catalogCalls: () => catalogCalls }
}

test('同时到达的设置读取只读一次，返回各自独立的对象', async () => {
  const h = harness({ settingsDelay: 10 })
  const [a, b, c] = await Promise.all([h.handlers.getTavernSettings({}), h.handlers.getTavernSettings({}), h.handlers.getTavernSettings({})])
  assert.equal(h.reads(), 1, '并发读取合并成一次')
  assert.equal(h.catalogCalls(), 1)
  assert.deepEqual(a, b)
  a.settings.playerName = '改动'
  assert.equal(b.settings.playerName, '你', '返回的是副本，互不影响')
  await h.handlers.getTavernSettings({})
  assert.equal(h.reads(), 2, '请求结束后下一次读取重新读盘')
})

test('模型选择器只取目录，不读整份设置', async () => {
  const h = harness()
  assert.deepEqual(await h.handlers.getTavernModelCatalog(), { modelCatalog: [{ provider: 'p1', providerName: 'P1', models: [{ id: 'm1', name: 'M1' }] }] })
  assert.equal(h.reads(), 0, '取目录不触发设置读盘')
})
