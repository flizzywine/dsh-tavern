import assert from 'node:assert/strict'
import test from 'node:test'
import { createPolishReviewer } from '../tavern-plugin/lib/domain/polish-agent.js'
import { applyPolishEdits } from '../tavern-plugin/lib/domain/polish-review.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'
import { withHostAgent } from '../tavern-plugin/lib/host/sessions.js'

function coldForeground() {
  const agent = { session: { id: 'parent' } }
  const state = { live: false, resumes: 0, disposals: 0 }
  const host = { sessions: { get: () => state.live ? agent.session : undefined }, agents: {
    get: () => state.live ? agent : undefined,
    async resume() {
      state.live = true
      state.resumes++
      return { agent, async dispose() { state.live = false; state.disposals++ } }
    }
  } }
  return { state, host, withAgent: (id, work) => withHostAgent(host, id, work) }
}

function fixture() {
  let saved, sequence = 0, replaceSession = false, fail = false
  let chat = { id: 'game', messages: [{ role: 'assistant', text: '开场' }, { role: 'user', text: '继续' }, { role: 'assistant', text: '甲。乙。' }] }
  let card = { name: '人物', description: '固定设定' }
  const calls = []
  const options = {
    latestFloors: async () => chat, readCard: async () => card, prompt,
    selection: async () => ({ provider: 'test', model: 'test' }),
    data: { readGame: async () => structuredClone(saved), saveGame: async ({ data }) => { saved = structuredClone(data) } },
    runAgent: async input => {
      const id = input.newSession || replaceSession ? 'child-' + ++sequence : input.persistentSessionId
      await input.onPersistentSessionReady(id)
      calls.push({ ...input, text: input.taskText(), id })
      if (fail) throw new Error('模型失败')
      if (calls.length === 1) input.onToolCall({ name: 'polish_edit', arguments: { find: '甲。', replace: '甲改。', reason: '套话' } })
      input.onToolCall({ name: 'polish_finish', arguments: {} })
      return { traceSessionId: id }
    }
  }
  return { options, calls, get chat() { return chat }, set chat(value) { chat = value }, set card(value) { card = value },
    set replaceSession(value) { replaceSession = value }, set fail(value) { fail = value }, get saved() { return saved } }
}

test('回退、重生成、前文变化仍用同一个润色会话并说明剧情有变；固定设定变化或分叉才换会话', async () => {
  for (const change of ['rewind', 'regenerate', 'previous']) {
    const f = fixture(), reviewer = createPolishReviewer(f.options)
    await reviewer.review('parent', ['甲。乙。'])
    if (change === 'rewind') f.chat.messages = [{ role: 'assistant', text: '开场' }]
    if (change === 'previous') {
      f.chat.messages[2].text = '已手动改过'
      f.chat.messages.push({ role: 'user', text: '继续' }, { role: 'assistant', text: '新正文' })
    }
    await reviewer.review('parent', [change === 'regenerate' ? '另一个正文' : '甲。乙。'])
    assert.equal(f.calls[1].id, f.calls[0].id, change)
    assert.match(f.calls[1].text, /<story_changed>\n/, change)
  }
  for (const change of ['card', 'fork']) {
    const f = fixture(), reviewer = createPolishReviewer(f.options)
    await reviewer.review('parent', ['甲。乙。'])
    if (change === 'card') f.card = { name: '人物', description: '新的固定设定' }
    await reviewer.review(change === 'fork' ? 'fork-parent' : 'parent', ['甲。乙。'])
    assert.notEqual(f.calls[1].id, f.calls[0].id, change)
  }
})

test('精修在借用前台 Agent 后选模型，取消等待中的审稿会释放 Agent', async () => {
  const f = fixture(), foreground = coldForeground()
  const resume = foreground.host.agents.resume
  const opening = Promise.withResolvers(), publish = Promise.withResolvers()
  foreground.host.agents.resume = async () => {
    opening.resolve()
    await publish.promise
    return resume()
  }
  f.options.withForegroundAgent = foreground.withAgent
  let selections = 0
  f.options.selection = async () => {
    assert.equal(foreground.state.live, true)
    selections++
    return { provider: 'configured', model: 'polish' }
  }
  const runAgent = f.options.runAgent
  f.options.runAgent = async input => {
    assert.equal(foreground.state.live, true)
    return runAgent(input)
  }
  const reviewer = createPolishReviewer(f.options)
  const controller = new AbortController()
  const aborted = assert.rejects(reviewer.review('parent', ['甲。乙。'], controller.signal), { name: 'AbortError' })
  try {
    await Promise.race([opening.promise, aborted])
    controller.abort()
  } finally { publish.resolve(); await aborted }
  assert.equal(selections, 0)
  assert.deepEqual(foreground.state, { live: false, resumes: 1, disposals: 1 })

  await reviewer.guide('parent', ['甲。乙。'], '写具体一些')
  assert.deepEqual(f.calls[0].selection, { provider: 'configured', model: 'polish' })
  assert.deepEqual(foreground.state, { live: false, resumes: 2, disposals: 2 })
})

test('RPC 只在两步精修都完成后保存一次，失败不写入半成品；保留原文供撤销', async () => {
  for (const outcome of ['saved', 'failed', 'queued']) {
    const saves = [], records = []
    const foreground = coldForeground()
    let onSaved
    const handlers = createPlayHandlers({
      str: value => String(value || ''), reconcileStory: async () => {}, notifyPluginTimeline() {},
      withForegroundTaskAgent: foreground.withAgent,
      polishPrereview: { settle() {}, take: async () => null },
      bodyEditor: { read: async () => {
        assert.equal(foreground.state.live, true)
        return { token: 'original-version', turn: 1, parts: [{ kind: 'text', text: '甲。乙。' }] }
      },
        save: async (_id, change, options) => {
          assert.equal(foreground.state.live, true)
          saves.push(change)
          if (outcome === 'queued') {
            onSaved = options.onSaved
            return { queued: true }
          }
          await options.onSaved()
          return { saved: true }
        } },
      polishReviewer: {
        review: async () => ({ edits: [{ find: '甲。', replace: '甲改。', reason: '原则', status: 'ok' }], fallback: '' }),
        guide: async (_id, texts) => {
          assert.equal(foreground.state.live, true)
          assert.deepEqual(texts, ['甲改。乙。'])
          assert.equal(saves.length, 0)
          if (outcome === 'failed') throw new Error('模型中断')
          return { edits: [{ find: '甲改。', replace: '甲再改。', reason: '意见', status: 'ok' }], fallback: '' }
        }
      },
      polishRecords: { save: async (_id, _turn, record) => records.push(record) }
    })
    if (outcome === 'failed') {
      await assert.rejects(handlers.polishBody({ sessionId: 'parent', guidance: '更短' }), /模型中断/)
      assert.equal(saves.length, 0); assert.equal(records.length, 0)
    } else {
      const result = await handlers.polishBody({ sessionId: 'parent', guidance: '更短', requestId: 'polish-test' })
      assert.deepEqual(saves, [{ token: 'original-version', texts: ['甲再改。乙。'] }])
      if (outcome === 'queued') {
        assert.equal(result.queued, true)
        assert.equal(result.view, null)
        assert.deepEqual(records, [])
        await onSaved()
      }
      assert.deepEqual(records[0].original, ['甲。乙。'])
      assert.equal(records[0].requestId, 'polish-test')
      assert.deepEqual(applyPolishEdits(records[0].original, records[0].edits), ['甲再改。乙。'])
    }
    assert.deepEqual(foreground.state, { live: false, resumes: 1, disposals: 1 })
  }
})
