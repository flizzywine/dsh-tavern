import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { installCompactionRequestProjection } from '../tavern-plugin/lib/domain/compaction-request.js'
import { retainRecentStoryRounds } from '../tavern-plugin/lib/domain/story-compaction.js'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }

test('real DSH: manual story compaction commits the summary with the latest rounds appended verbatim', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 32768 })
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const agent = h.target.agent
  for (let i = 1; i <= 5; i++) {
    agent.followup({ id: 'round-' + i, role: 'user', content: [{ type: 'text', text: `第${i}轮行动。` + '旧事。'.repeat(200) }], source: { kind: 'human' } })
    await agent.whenIdle()
  }
  installCompactionRequestProjection(h.ctx, async id => id === agent.session.id, async request => retainRecentStoryRounds(request, 2))
  const summarized = []
  h.ctx.on('llm/stream', (request, next) => {
    if (request.purpose === 'compaction') summarized.push(JSON.stringify(request.messages))
    return next()
  })
  // DSH 0.2 reserves 64k output tokens by default, more than this fixture model's whole window.
  const result = await new BasicCompactionEngine(h.ctx, { auto: false, maxTokens: 4096 }).compactNow(agent, new AbortController().signal)
  assert.ok(result)
  assert.equal(summarized.length, 1)
  assert.ok(summarized[0].includes('第3轮行动') && !summarized[0].includes('第4轮行动'), 'the summarizer sees only older rounds')
  const checkpoint = sessionEvents(agent.session).findLast(e => e.type === 'user/message' && e.data?.source?.compactionId)
  const text = checkpoint.data.content.map(block => block.text || '').join('\n')
  assert.match(text, /<recent_transcript>\n最近 2 轮原文（未压缩，按时间顺序）\n/)
  assert.match(text, /\[玩家\]\n第4轮行动/)
})

test('real DSH: a second story compaction carries the first volume verbatim before the new one', native, async t => {
  const { storyVolumePlan, STORY_SUMMARY_NOTE } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  const { requestHandledBy } = await import('../tavern-plugin/lib/domain/request-lineage.js')
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 32768 })
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const agent = h.target.agent
  let through = 0
  const outputs = ['【第 1–3 轮剧情摘要】\n甲在第二轮许下约定。', '【第 4–6 轮剧情摘要】\n乙离开了城镇。']
  const instructions = []
  installCompactionRequestProjection(h.ctx, async id => id === agent.session.id, async request => {
    const plan = storyVolumePlan(request, { through })
    instructions.push(plan.instruction)
    return { ...retainRecentStoryRounds(request, 1), prefix: plan.prefix }
  })
  h.ctx.on('llm/stream', (request, next) => {
    if (request.purpose !== 'compaction' || !requestHandledBy(request, 'compaction-projection')) return next()
    const text = outputs.shift()
    return (async function * () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  })
  const play = async from => { for (let i = from; i < from + 4; i++) { agent.followup({ id: 'round-' + i, role: 'user', content: [{ type: 'text', text: `第${i}轮行动。` + "旧事。".repeat(200) }], source: { kind: "human" } }); await agent.whenIdle() } }
  const engine = new BasicCompactionEngine(h.ctx, { auto: false, maxTokens: 4096 })
  const compact = () => engine.compactNow(agent, new AbortController().signal)
  const checkpointText = () => sessionEvents(agent.session).findLast(e => e.type === 'user/message' && e.data?.source?.compactionId).data.content.map(block => block.text || '').join('\n')
  await play(1); through = 3; assert.ok(await compact())
  assert.match(instructions[0], /第 1–3 轮剧情摘要/)
  await play(5); through = 6; assert.ok(await compact())
  assert.match(instructions[1], /旧卷会原样保留[^]*第 4–6 轮剧情摘要/)
  const text = checkpointText()
  const order = [STORY_SUMMARY_NOTE, '【第 1–3 轮剧情摘要】\n甲在第二轮许下约定。', '【第 4–6 轮剧情摘要】\n乙离开了城镇。', '<recent_transcript>\n最近 1 轮原文'].map(part => text.indexOf(part))
  assert.ok(order.every(index => index >= 0), text)
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'note, old volume, new volume, then the kept rounds')
})

test('real DSH: the summarizer receives the story prompt, not DSH\'s own directive', native, async t => {
  const { createStoryCompactionRequest } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 32768 })
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const agent = h.target.agent
  for (let i = 1; i <= 3; i++) { agent.followup({ id: 'round-' + i, role: 'user', content: [{ type: 'text', text: `第${i}轮行动。` + '旧事。'.repeat(200) }], source: { kind: 'human' } }); await agent.whenIdle() }
  installCompactionRequestProjection(h.ctx, async id => id === agent.session.id, async request => ({ request: createStoryCompactionRequest(request, '剧情压缩提示词') }))
  const instructions = []
  h.ctx.on('llm/stream', (request, next) => {
    if (request.purpose === 'compaction') instructions.push(request.messages.at(-1).content.map(block => block.text).join(''))
    return next()
  })
  await new BasicCompactionEngine(h.ctx, { auto: false, maxTokens: 4096 }).compactNow(agent, new AbortController().signal)
  assert.deepEqual(instructions, ['剧情压缩提示词'])
})

const text = value => [{ type: 'text', text: value }]
const player = (id, value) => ({ id, role: 'user', content: text(value) })
const story = (id, value) => ({ id, role: 'assistant', content: text(value) })

// A tool result (DSH 0.2 role 'tool') is not story prose, and plugin-injected settings are not a player action.
test('the kept rounds hold only player actions and story prose, not tool results or derived settings', () => {
  const messages = [
    player('u1', '第1轮行动'), story('a1', '第1轮正文'),
    player('u2', '第2轮行动'),
    { id: 's2', role: 'user', source: { kind: 'plugin:dsh-tavern' }, content: text('<turn_settings>派生设置：对话气泡开启</turn_settings>') },
    { id: 't2', role: 'tool', toolCallId: 'call-1', content: text('{"ok":true,"variables":{"hp":3}}') },
    story('a2', '第2轮正文'),
    player('u3', '第3轮行动'), story('a3', '第3轮正文'),
    { id: 'c', role: 'user', content: text('请压缩') }
  ]
  const { appendix, kept } = retainRecentStoryRounds({ purpose: 'compaction', messages }, 2)
  assert.equal(kept, 2)
  assert.match(appendix, /第2轮正文/)
  assert.doesNotMatch(appendix, /"ok":true/, 'tool results are not story prose')
  assert.doesNotMatch(appendix, /派生设置/, 'plugin-injected settings are not a player action')
})
