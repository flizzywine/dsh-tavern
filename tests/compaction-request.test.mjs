import test from 'node:test'
import assert from 'node:assert/strict'
import { projectCompactionRequest } from '../tavern-plugin/lib/domain/compaction-request.js'

const empty = plugin => Object.freeze({ role: 'user', content: Object.freeze([]), source: Object.freeze({ kind: 'plugin', plugin }) })
const metadata = empty('dsh-tavern')

test('ordinary requests and summaries without placeholders retain object identity', () => {
  for (const request of [undefined, {}, { messages: [metadata] }, { purpose: 'compaction', messages: [] }]) {
    assert.equal(projectCompactionRequest(request), request)
  }
})

test('marking a frozen, already-marked request copies it instead of throwing (#148)', async () => {
  const { markRequestHandled, requestHandledBy } = await import('../tavern-plugin/lib/domain/request-lineage.js')
  const { createStoryCompactionRequest } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  // The real chain: the projection hook marks the request, then the story hook
  // returns a frozen copy carrying that mark and marks it again.
  const projected = markRequestHandled({ purpose: 'compaction', messages: [{ role: 'user', content: [], source: { plugin: 'dsh-compaction-basic' } }] }, 'compaction-projection')
  const request = createStoryCompactionRequest(projected, '剧情压缩')
  assert.ok(Object.isFrozen(request))
  const marked = markRequestHandled(request, 'story-compaction')
  assert.notEqual(marked, request)
  assert.ok(requestHandledBy(marked, 'story-compaction') && requestHandledBy(marked, 'compaction-projection'))
  assert.ok(!requestHandledBy(request, 'story-compaction'))
})

test('one hook projects, applies the story prompt and sends a single summary request (#146/#148)', async () => {
  const { installCompactionRequestProjection } = await import('../tavern-plugin/lib/domain/compaction-request.js')
  const { createStoryCompactionRequest } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  const hooks = [], sent = []
  const dispatch = (request, index = 0) => index < hooks.length
    ? hooks[index](request, () => dispatch(request, index + 1))
    : (async function * () { sent.push(request); yield { type: 'block-end', index: 0, block: { type: 'text', text: '摘要' } }; yield { type: 'finish', reason: { kind: 'stop' } } })()
  const ctx = { on: (_, hook) => hooks.push(hook), llm: { stream: request => dispatch(request), resolveModelInfo: async () => undefined } }
  installCompactionRequestProjection(ctx, async () => true, async request => ({ request: createStoryCompactionRequest(request, '剧情压缩提示') }))
  const instruction = Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: '原生提示' }]), source: Object.freeze({ kind: 'plugin', plugin: 'dsh-compaction-basic' }) })
  const host = Object.freeze({ purpose: 'compaction', sessionId: 's', messages: Object.freeze([metadata, instruction]) })
  for await (const _ of ctx.llm.stream(host)) { /* drain */ }
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].messages.map(m => m.content[0]?.text), ['剧情压缩提示'])
})

test('story compaction summarizes only history before the latest rounds and appends them verbatim', async () => {
  const { installCompactionRequestProjection } = await import('../tavern-plugin/lib/domain/compaction-request.js')
  const { retainRecentStoryRounds } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  const say = (role, text, source = { kind: 'human' }) => ({ role, content: [{ type: 'text', text }], source })
  const history = [say('system', '固定背景', undefined)]
  for (let i = 1; i <= 4; i++) history.push(say('user', '玩家' + i), { role: 'assistant', content: [{ type: 'thinking', text: '思考' }, { type: 'text', text: '正文' + i }] })
  const instruction = say('user', '总结指令', { kind: 'plugin', plugin: 'dsh-compaction-basic' })
  const request = { purpose: 'compaction', sessionId: 's', messages: [...history, instruction] }

  const { request: older, appendix } = retainRecentStoryRounds(request, 2)
  assert.deepEqual(older.messages.map(m => m.content.at(-1).text), ['固定背景', '玩家1', '正文1', '玩家2', '正文2', '总结指令'])
  assert.equal(appendix, '【最近 2 轮原文（未压缩，按时间顺序）】\n\n[玩家]\n玩家3\n\n[正文]\n正文3\n\n[玩家]\n玩家4\n\n[正文]\n正文4')
  // At least one round is always summarized, so capacity recovery makes progress.
  assert.match(retainRecentStoryRounds(request, 4).appendix, /^【最近 3 轮原文/)
  assert.equal(retainRecentStoryRounds({ ...request, messages: [history[0], history[1], history[2], instruction] }, 4).appendix, undefined)

  // Kept rounds also respect a token budget (rounds 4 and 3 each cost 5 here).
  const budgeted = retainRecentStoryRounds(request, 3, { budget: 9, estimate: text => text.split('\n\n').length * 2 + 1 })
  assert.match(budgeted.appendix, /^【最近 1 轮原文/)

  // A later compaction splits the carried transcript back into rounds.
  const checkpoint = { role: 'user', content: [{ type: 'text', text: '<compacted-summary>' }, { type: 'text', text: '旧摘要' }, { type: 'text', text: appendix }, { type: 'text', text: '</compacted-summary>' }], source: { kind: 'plugin', plugin: 'compaction' } }
  const next = retainRecentStoryRounds({ purpose: 'compaction', messages: [history[0], checkpoint, say('user', '玩家5'), { role: 'assistant', content: [{ type: 'text', text: '正文5' }] }, instruction] }, 2)
  assert.equal(next.appendix, '【最近 2 轮原文（未压缩，按时间顺序）】\n\n[玩家]\n玩家4\n\n[正文]\n正文4\n\n[玩家]\n玩家5\n\n[正文]\n正文5')
  // The previous summary stays whole, so the summarizer input remains a prefix of the foreground request.
  assert.deepEqual(next.request.messages, [history[0], checkpoint, instruction])

  const hooks = [], sent = [], events = []
  const dispatch = (r, index = 0) => index < hooks.length
    ? hooks[index](r, () => dispatch(r, index + 1))
    : (async function * () {
        sent.push(r)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '摘要' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
  const ctx = { on: (_, hook) => hooks.push(hook), llm: { stream: r => dispatch(r), resolveModelInfo: async () => undefined } }
  installCompactionRequestProjection(ctx, async () => true, async r => retainRecentStoryRounds(r, 2))
  for await (const event of ctx.llm.stream(request)) events.push(event)
  assert.equal(sent.length, 1)
  assert.ok(!JSON.stringify(sent[0].messages).includes('玩家3'))
  assert.deepEqual(events.filter(e => e.type === 'block-end').map(e => [e.index, e.block.text]), [[0, '摘要'], [1, appendix]])
  assert.equal(events.at(-1).type, 'finish')
})

test('rounds the native engine already keeps outside the request count toward the retained quota', async () => {
  const { nativelyRetainedRounds } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  const user = (id, text, kind = 'human') => ({ type: 'user/message', data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind } } })
  const events = [user('a', '旧'), { type: 'assistant/message', data: { message: { id: 'b' } } }, user('c', '近1'), user('frame', '帧', 'plugin'), user('d', '近2')]
    .map((event, seq) => ({ ...event, seq }))
  const session = { surface: { nodes: events.map(e => e.seq) }, eventAt: seq => events[seq] }
  const request = { purpose: 'compaction', messages: [events[0].data, events[1].data.message] }
  assert.equal(nativelyRetainedRounds(session, request), 2)
  assert.equal(nativelyRetainedRounds(undefined, request), 0)
})

test('a history whose rounds all fit the retention needs no compaction, counting carried rounds', async () => {
  const { storyHistoryFullyRetained } = await import('../tavern-plugin/lib/domain/story-compaction.js')
  const events = [
    { type: 'user/message', data: { id: 'c', role: 'user', content: [{ type: 'text', text: '【最近 2 轮原文（未压缩，按时间顺序）】\n\n[玩家]\n甲\n\n[正文]\n乙\n\n[玩家]\n丙' }], source: { kind: 'plugin' } } },
    { type: 'user/message', data: { id: 'u', role: 'user', content: [{ type: 'text', text: '丁' }], source: { kind: 'human' } } },
    { type: 'assistant/message', data: { message: { id: 'a', role: 'assistant', content: [{ type: 'text', text: '戊' }] } } }
  ].map((event, seq) => ({ ...event, seq }))
  const session = { surface: { nodes: [0, 1, 2] }, eventAt: seq => events[seq] }
  assert.equal(storyHistoryFullyRetained(session, 3), true)
  assert.equal(storyHistoryFullyRetained(session, 2), false)
  assert.equal(storyHistoryFullyRetained(session, 3, { budget: 1 }), false, '超出保留预算的长轮次仍需压缩')
  assert.equal(storyHistoryFullyRetained(session, 0), false)
})

test('a summary answered with a tool call or no text is retried once as plain text without tools', async () => {
  const { installCompactionRequestProjection } = await import('../tavern-plugin/lib/domain/compaction-request.js')
  for (const first of [[{ type: 'block-end', index: 0, block: { type: 'tool-call', name: 'submit', arguments: {} } }, { type: 'finish', reason: { kind: 'tool' } }],
    [{ type: 'finish', reason: { kind: 'stop' } }]]) {
    const hooks = [], sent = []
    const dispatch = (request, index = 0) => index < hooks.length
      ? hooks[index](request, () => dispatch(request, index + 1))
      : (async function * () { sent.push(request); if (sent.length === 1) { yield* first; return } yield { type: 'block-end', index: 0, block: { type: 'text', text: '后台摘要' } }; yield { type: 'finish', reason: { kind: 'stop' } } })()
    const ctx = { on: (_, hook) => hooks.push(hook), llm: { stream: request => dispatch(request), resolveModelInfo: async () => ({ context: { contextWindow: 100000 } }) } }
    installCompactionRequestProjection(ctx, async () => true)
    const say = (role, text) => ({ role, content: [{ type: 'text', text }], source: { kind: 'human' } })
    const request = { purpose: 'compaction', sessionId: 'background', provider: 'p', model: 'm', tools: [{ name: 'submit' }],
      messages: [say('system', '后台规则'), say('user', '任务'), say('assistant', '结果'), { ...say('user', '总结指令'), source: { kind: 'plugin', plugin: 'dsh-compaction-basic' } }] }
    const out = []
    for await (const chunk of ctx.llm.stream(request)) out.push(chunk)
    assert.equal(sent.length, 2)
    assert.equal(sent[1].tools, undefined)
    assert.match(sent[1].messages.at(-2).content[0].text, /任务/)
    assert.equal(sent[1].messages.at(-1).content[0].text, '总结指令')
    assert.deepEqual(out.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block.text), ['后台摘要'])
  }
})
