import test from 'node:test'
import assert from 'node:assert/strict'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { fingerprint } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'

const runtime = await UpstreamTemplateRuntime.create()
const long = 'x'.repeat(4400)
const entries = ['漕帮', '剑宗', '药王谷', '铁骨', '商会', '皇女'].map((name, i) => ({ ref: 'e' + i, title: name, enabled: true, primaryKeys: [name], content: name + '设定' + long }))

// Old screening options must never invoke a model.
function setup({ screening = true } = {}) {
  const worldBook = { view: { entries: structuredClone(entries) } }
  const screened = []
  const chat = { backgroundTasks: { worldbookScreening: screening }, messages: [{ role: 'assistant', turn: 1, text: '漕帮 剑宗 药王谷 铁骨 商会 皇女' }] }
  const filterCandidates = async () => { screened.push('unexpected') }
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

for (const screening of [false, true]) test(`世界书模型筛选已退役，旧开关 ${screening} 不调用模型且旧排除失效`, async () => {
  const h = setup({ screening })
  const prepared = await h.project({ chat: h.chat, card: {}, userText: '', purpose: 'prefilter' })
  assert.equal(h.screened.length, 0)
  assert.equal(prepared.log.screening, undefined)
  assert.ok(!Object.values(prepared.reads).some(read => read.kind === 'screened'))
  // An exclusion left by an earlier session with screening on no longer holds the entry back.
  h.chat.worldBookReads = { e1: { turn: 1, fingerprint: fingerprint(h.worldBook.view.entries[1].content), kind: 'screened' } }
  h.chat.messages[0].text = '剑宗'
  const sent = await h.project({ chat: h.chat, card: {}, userText: '继续' })
  assert.equal(sent.context, '')
  assert.match(sent.titleHints, /可能用到的世界书条目：剑宗/)
  assert.equal(h.screened.length, 0)
})

test('十轮内已有工具结果时不补标题，也不影响常驻设定', async () => {
  const h = setup()
  h.chat.messages[0].text = '剑宗'
  h.worldBook.view.entries.push({ ref: 'constant', enabled: true, constant: true, content: '常驻设定' })
  const request = { chat: h.chat, card: {}, userText: '继续', requestKey: 'same-request' }
  assert.match((await h.project(request)).titleHints, /可能用到的世界书条目：剑宗/)
  const lookedUp = await h.project({ ...request, recentlyReadRefs: ['e1'] })
  assert.equal(lookedUp.context, '')
  assert.equal(lookedUp.titleHints, '')
  assert.equal(lookedUp.prefixContext, '常驻设定')
})
