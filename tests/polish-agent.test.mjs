import assert from 'node:assert/strict'
import test from 'node:test'
import { createPolishDraft, createPolishReviewer, POLISH_TOOLS } from '../tavern-plugin/lib/domain/polish-agent.js'
import { applyPolishEdits } from '../tavern-plugin/lib/domain/polish-review.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

test('逐处修改校验、重试、去重和完成；按原文坐标应用，不误改替换结果', () => {
  const texts = ['甲。乙。', '重复。重复。']
  const changes = [], draft = createPolishDraft(texts, edits => changes.push(edits.length))
  const edit = (find, replace) => JSON.parse(draft.call({ name: 'polish_edit', arguments: { find, replace, reason: '原因' } }))
  assert.equal(edit('没有', '新').ok, false)
  assert.equal(edit('重复。', '新').ok, false)
  assert.equal(edit('甲。', '乙。').ok, true)
  assert.equal(edit('甲。', '乙。').duplicate, true)
  assert.equal(edit('甲。乙。', '新').ok, false)
  assert.equal(edit('乙。', '丙。').ok, true)
  assert.deepEqual(applyPolishEdits(texts, draft.result().edits), ['乙。丙。', '重复。重复。'])
  draft.call({ name: 'polish_finish', arguments: {} })
  assert.equal(edit('重复。重复。', '').ok, false)
  assert.deepEqual(changes, [1, 2, 2])
})

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

test('无修改必须显式完成，正文或模型错误不冒充成功', async () => {
  const f = fixture()
  f.options.runAgent = async input => { await input.onPersistentSessionReady('child'); return { traceSessionId: 'child', text: '完成了' } }
  const reviewer = createPolishReviewer(f.options)
  await assert.rejects(reviewer.review('parent', ['甲。乙。']), /未调用完成工具/)
  assert.equal(reviewer.progress('parent').phase, 'failed')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(reviewer.review('parent', ['甲。乙。'], controller.signal), { name: 'AbortError' })
  assert.equal(POLISH_TOOLS.length, 2)
})

test('RPC 只在两步精修都完成后保存一次，失败不写入半成品；保留原文供撤销', async () => {
  for (const outcome of ['saved', 'failed', 'queued']) {
    const saves = [], records = []
    let onSaved
    const handlers = createPlayHandlers({
      str: value => String(value || ''), reconcileStory: async () => {}, notifyPluginTimeline() {},
      polishPrereview: { settle() {}, take: async () => null },
      bodyEditor: { read: async () => ({ token: 'original-version', turn: 1, parts: [{ kind: 'text', text: '甲。乙。' }] }),
        save: async (_id, change, options) => {
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
  }
})
