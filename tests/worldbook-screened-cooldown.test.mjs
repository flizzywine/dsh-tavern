import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { createWorldbookFilter } from '../tavern-plugin/lib/domain/worldbook-filter.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()
const long = 'x'.repeat(4400)
const entries = ['漕帮', '剑宗', '药王谷', '铁骨', '商会', '皇女'].map((name, i) => ({ ref: 'e' + i, enabled: true, primaryKeys: [name], content: name + '设定' + long }))

// A store-backed task stub: commit applies the filter's verdict to the chat, like the real coordinator.
function setup() {
  const worldBook = { view: { entries: structuredClone(entries) } }
  const screened = []
  const chat = { messages: [{ role: 'assistant', turn: 1, text: '漕帮 剑宗 药王谷 铁骨 商会 皇女' }] }
  const filterCandidates = createWorldbookFilter({ selection: () => ({}),
    beginTask: async () => ({ participantRequest: {}, bindSession() {}, participant: () => ({}), fail: async () => {},
      commit: async ({ apply }) => { apply?.(chat); return { status: 'committed' } } }),
    runAgent: async input => {
      const refs = JSON.parse(input.messages[0].content[0].text).candidates.map(item => item.ref)
      screened.push(refs)
      input.onToolCall({ name: 'worldbook_filter_submit', arguments: { selected: refs.slice(0, 1) } })
      return {}
    } })
  const project = createForegroundWorldbook({ bound: async () => worldBook, runtime: async () => runtime, globalVariables: async () => ({}), filterCandidates })
  // One round: send (never asks the model), reply, then the post-reply prefilter.
  async function round(userText) {
    const sent = await project({ chat, card: {}, userText })
    assert.equal(sent.error, null)
    chat.worldBookReads = sent.reads
    chat.messages.push({ role: 'assistant', turn: chat.messages.at(-1).turn + 1, text: chat.messages[0].text })
    await project({ chat, card: {}, userText: '', purpose: 'prefilter' })
    return sent
  }
  return { worldBook, screened, chat, project, round }
}

test('发送正文从不询问模型；回复结束后预筛，被排除条目之后十轮直接排除', async () => {
  const h = setup()
  await h.project({ chat: h.chat, card: {}, userText: '', purpose: 'prefilter' })
  assert.equal(h.screened.length, 1)
  assert.equal(h.screened[0].length, 6)
  const first = await h.round('继续')
  assert.deepEqual(first.refs, ['e0'], '预筛排除的五条不进入下一轮')
  let sent
  for (let i = 0; i < 9; i++) sent = await h.round('继续')
  assert.ok(!sent.refs.includes('e1'), '第十轮仍在冷却')
  sent = await h.round('继续')
  assert.equal(h.screened.length, 1, '冷却期内候选不足门槛，不再询问模型')
  assert.deepEqual(sent.refs.sort(), ['e1', 'e2', 'e3', 'e4', 'e5'], '十轮后排除失效；剩余候选不超门槛则直接注入')
})

test('玩家本轮输入直接提到被排除条目时照常注入；条目正文改变后冷却失效', async () => {
  const h = setup()
  await h.project({ chat: h.chat, card: {}, userText: '', purpose: 'prefilter' })
  const named = await h.round('我去找剑宗的人')
  assert.ok(named.refs.includes('e1'))
  assert.ok(!named.refs.includes('e2'))
  h.worldBook.view.entries[2].content = '药王谷新设定' + long
  const edited = await h.round('继续')
  assert.ok(edited.refs.includes('e2'))
})
