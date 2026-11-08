import test from 'node:test'
import assert from 'node:assert/strict'
import { createConversationInitialization } from '../tavern-plugin/lib/domain/conversation-initialization.js'
import { createRequestPerformance } from '../tavern-plugin/lib/domain/request-performance.js'

const card = { name: '测试角色', first_mes: '开始的第一句正文', alternate_greetings: [] }
const requestId = '00000000-0000-0000-0000-000000000001'

function build(trace, overrides = {}) {
  const published = [], prepared = []
  const initialization = createConversationInitialization({
    id: prefix => prefix + '-1',
    cards: { read: async () => card, script: async () => undefined, extensions: async () => ({ regexScripts: [] }), startDefaults: async () => null },
    chats: { resolve: async () => undefined, publish: async chat => { published.push(chat) }, write: async chat => chat },
    timeline: { apply: ({ chat }) => ({ chat }) },
    snapshots: { prepare: async (chat, card, book) => { prepared.push(book); return '' }, ensure: async () => '' },
    presets: { fullSnapshot: async () => ({ presetPath: 'play', regexScripts: [] }), claimPreparedFullSnapshot: async () => undefined },
    settings: async () => ({ defaultPlaySettings: {} }),
    emptyCardWorkspace: () => ({}),
    // No native session: the opening only reaches the Chat store in this fixture.
    native: { wait: async () => ({ session: {} }), ensurePrefix: async () => {}, flush: async () => {}, selectModel: async () => {} },
    present: async (_chat, _card, options) => ({ presented: true, options }),
    trace,
    ...overrides
  })
  return { initialization, published, prepared }
}

test('新开局的分段计时覆盖每个耗时步骤且不记录正文', async () => {
  const trace = createRequestPerformance()
  const { initialization, published } = build(trace)
  const view = await trace.run('startChat', requestId, () => initialization.start({ cardPath: 'card.json', sessionId: '', mode: 'story', userName: '你' }))
  assert.equal(view.presented, true)
  assert.equal(view.options.deferResources, true)
  assert.equal(published.length, 1)
  const row = trace.read().openings.at(-1)
  assert.equal(row.method, 'startChat')
  const names = row.stages.map(stage => stage.name)
  for (const stage of ['settings', 'card', 'cardDefaults', 'script', 'preset', 'extensions', 'snapshot', 'publish', 'present']) assert.ok(names.includes(stage), '缺少阶段 ' + stage)
  assert.ok(row.stages.every(stage => Number.isFinite(stage.durationMs) && stage.durationMs >= 0))
  assert.doesNotMatch(JSON.stringify(row), /第一句正文/)
})

test('新开局并行独立读取，扩展等待卡片迁移完成', async () => {
  const started = [], resolvers = {}
  function read(name, value) {
    return async () => {
      started.push(name)
      return await new Promise(resolve => { resolvers[name] = () => resolve(value) })
    }
  }
  const { initialization } = build(undefined, {
    settings: read('settings', { defaultPlaySettings: {} }),
    cards: {
      read: read('card', card),
      startDefaults: read('cardDefaults', null),
      script: read('script', undefined),
      extensions: read('extensions', { regexScripts: [] })
    }
  })
  const work = initialization.start({ cardPath: 'card.json', sessionId: '', mode: 'story', userName: '你' })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started.slice().sort(), ['card', 'cardDefaults', 'script', 'settings'])
  for (const name of started.slice()) resolvers[name]()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(started.includes('extensions'))
  assert.ok(started.indexOf('card') < started.indexOf('extensions'))
  resolvers.extensions()
  const view = await work
  assert.equal(view.presented, true)
})
