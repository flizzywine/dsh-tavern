import assert from 'node:assert/strict'
import test from 'node:test'
import { projectPureWritingRequest, projectWritingPreparationRequest, pureWritingContext, pureWritingInjection, pureWritingSystemSections } from '../tavern-plugin/lib/domain/pure-writing-request.js'
import { createWritingPreparation } from '../tavern-plugin/lib/domain/writing-preparation.js'
import { createWritingPreparationSources } from '../tavern-plugin/lib/domain/writing-preparation-sources.js'

test('白手套旧资料只留引用，动态快照留在本轮任务中，正文仍用原始上下文', () => {
  const original = '【世界书 · 旧塔】\n石塔坐北朝南。\n\n【剧情记忆 · 第 2 轮】\n他找到了罗盘。\n\n【当前状态】\n他还有三文钱。'
  const previous = pureWritingInjection({ frameId: 'previous', turn: 2 }, original)
  const player = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '看门里有什么。' }] }
  const task = { role: 'user', source: { kind: 'plugin:dsh-tavern', form: 'writing-preparation-task' }, content: [{ type: 'text', text: '查本轮资料。' }] }
  const tools = { role: 'assistant', content: [{ type: 'tool-call', name: 'find_worldbook', id: 'find', arguments: '{}' }] }
  const context = state => {
    const sections = pureWritingSystemSections([{ name: 'tavern:character-card', text: '固定设定' }], {
      source: { worldBook: { variableConstantRefs: ['status'] }, regenerationMaterials: { worldbookEntries: [{ ref: 'status', text: state }] },
        card: { systemPromptText: '固定人物规则' } }, contributions: []
    })
    return pureWritingContext(sections.map(section => section.text).join('\n\n'), [previous, player], sections)
  }
  const old = context('门关着。'), latest = context('门打开了。')
  const request = projectWritingPreparationRequest({ messages: [task, tools] }, latest)
  assert.equal(request.system, projectWritingPreparationRequest({ messages: [task] }, old).system)
  assert.match(request.system, /固定人物规则/)
  assert.doesNotMatch(request.system, /门打开了/)
  const index = request.messages[0].content[0].text
  assert.match(index, /已交接资料索引[\s\S]*旧塔[\s\S]*第 2 轮[\s\S]*三文钱/)
  assert.doesNotMatch(index, /石塔坐北朝南|找到了罗盘/)
  assert.deepEqual(request.messages[1], player)
  assert.match(request.messages[2].content.at(-1).text, /<writing_current_worldbook>[\s\S]*门打开了/)
  assert.deepEqual(request.messages.at(-1), tools)
  const foreground = projectPureWritingRequest({}, { context: latest })
  assert.match(foreground.system, /门打开了/)
  assert.equal(foreground.messages[0].content[0].text, original)
})

test('白手套能重查历史索引里的世界书，前台只追加新资料', async () => {
  const previous = pureWritingInjection({ frameId: 'previous', turn: 1 }, '【世界书 · 旧塔】\n塔门朝南。')
  const context = { messages: [previous], preparation: { system: '', snapshot: '' } }
  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources: () => ({ worldbook: async () => [{ title: '旧塔', text: '塔门朝南。' }, { title: '新塔', text: '塔门朝北。' }] }),
    runAgent: async (_owner, { tools: [find] }, _context, onToolResult) => {
      const result = find({ query: '塔' }).then(text => ({ ok: true, text }))
      onToolResult('find_worldbook', result)
      assert.match((await result).text, /塔门朝南[\s\S]*塔门朝北/)
    }
  })
  preparation.register('white-glove', { prepare: ({ findWorldbook, runAgent }) => runAgent({ tools: [findWorldbook] }) })
  const entry = await preparation.forGame('game')
  const material = await preparation.prepare(entry, { gameId: 'game', frame: { frameId: 'current', turn: 2 }, context })
  assert.equal(material, '【世界书 · 新塔】\n塔门朝北。')
})

test('白手套可以直接使用本轮自动注入正文，主动检索只交接缺少的资料', async () => {
  const automatic = '【世界书 · 钟楼】\n塔钟整点鸣响。'
  const frame = { frameId: 'current', turn: 2, source: { worldBook: { automaticContext: automatic } } }
  const task = { role: 'user', source: { kind: 'plugin:dsh-tavern', form: 'writing-preparation-task' }, content: [{ type: 'text', text: '查本轮资料。' }] }
  const preparation = createWritingPreparation({
    allowed: async () => true,
    readSources: () => ({ worldbook: async () => [{ title: '钟楼', text: '塔钟整点鸣响。' }, { title: '侧门', text: '侧门朝北。' }] }),
    runAgent: async (_owner, { tools: [find] }, context, onToolResult) => {
      assert.equal(projectWritingPreparationRequest({ messages: [task] }, context).messages[0].content[0].text, automatic)
      const result = find({ query: '钟楼' }).then(text => ({ ok: true, text }))
      onToolResult('find_worldbook', result)
      assert.equal((await result).text, '【世界书 · 侧门】\n侧门朝北。')
    }
  })
  preparation.register('white-glove', { prepare: ({ findWorldbook, runAgent }) => runAgent({ tools: [findWorldbook] }) })
  const material = await preparation.prepare(await preparation.forGame('game'), {
    gameId: 'game', frame, context: { messages: [], preparation: { system: '', snapshot: '' } }
  })
  assert.equal(material, '【世界书 · 侧门】\n侧门朝北。')
})

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
  const system = frame.source.regenerationMaterials.worldbookPrefix
  const context = { system, messages: [previous], preparation: { system, snapshot: '' } }
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
