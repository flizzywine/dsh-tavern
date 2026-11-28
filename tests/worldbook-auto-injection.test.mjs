import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'
import { completedCompactionEpoch } from '../tavern-plugin/lib/domain/session-events.js'
import { createWorldbookFiles } from '../tavern-plugin/lib/domain/worldbook-files.js'

const entry = (ref, content, extra = {}) => ({
  ref, title: ref, content, primaryKeys: ['钟楼'], enabled: true, ...extra
})
const reply = (turn, extra) => ({ role: 'assistant', turn, text: '往前走。', ...extra })
const automatic = result => result.log.entries.filter(row => row.reason === 'keyword-bm25')

function fixture(entries, raw = {}) {
  const worldBook = { view: { entries, raw } }
  const chat = { sessionId: 'worldbook-hybrid', cardPath: 'cards/hybrid.json', messages: [] }
  const newProjector = () => createForegroundWorldbook({ bound: async () => worldBook,
    runtime: async () => ({ render: async text => ({ ok: true, text, scopes: {} }) }), globalVariables: async () => ({}) })
  let project = newProjector()
  const run = async (turn, overrides = {}) => {
    const result = await project({ chat, card: {}, requestKey: String(turn), turn, userText: '在钟楼找青铜罗盘', ...overrides })
    assert.equal(result.error, null)
    chat.worldBookVirtualState = JSON.parse(JSON.stringify(result.virtualState))
    return result
  }
  return { chat, run, worldBook, restart: () => { project = newProjector() } }
}

test('关键词先过滤，BM25 再选前五；未注入与冷却中的原文都可以主动读取', async t => {
  const entries = [
    ...Array.from({ length: 6 }, (_, i) => entry('无关传闻' + i, '钟楼附近有人经过。', { order: 100 + i })),
    entry('罗盘用法', '钟楼的青铜罗盘指向地下密室。青铜罗盘需要先校准。', { order: 1 }),
    entry('未匹配', '钟楼的青铜罗盘有两根指针。', { primaryKeys: ['地窖'] }),
    entry('停用资料', '钟楼的青铜罗盘已经坏了。', { enabled: false }),
    entry('次关键词缺失', '钟楼里有青铜罗盘。', { selective: true, secondaryKeys: ['暗门'] }),
    entry('固定背景', '钟楼深夜关闭。', { constant: true })
  ]
  const { chat, run, worldBook } = fixture(entries)
  const first = await run(2)
  const selected = automatic(first)
  assert.equal(selected.length, 5)
  assert.equal(selected[0].ref, '罗盘用法', '正文相关度应排在作者顺序之前')
  assert.ok(selected[0].score > selected[1].score)
  assert.equal(first.staticPrefix, '钟楼深夜关闭。')
  assert.doesNotMatch(first.context, /未匹配|停用资料|次关键词缺失|固定背景/)
  assert.doesNotMatch(first.titleHints, /罗盘用法/)
  const overflow = entries.find(row => row.ref.startsWith('无关传闻') && !first.refs.includes(row.ref))
  assert.match(first.titleHints, new RegExp(overflow.ref))
  chat.messages.push(reply(2))
  const next = await run(4)
  assert.deepEqual(new Set(next.refs), new Set(entries.filter(row => row.ref.startsWith('无关传闻') && !first.refs.includes(row.ref)).map(row => row.ref)))

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worldbook-hybrid-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const lookup = { scope: { session: { id: chat.sessionId } } }
  const tools = createWorldbookFiles({ directory, load: async () => ({ chat, worldBook }) })
  assert.equal((await tools.readByKeyword({ keyword: overflow.ref }, lookup)).text, overflow.content)
  assert.equal((await tools.readByKeyword({ keyword: '罗盘用法' }, lookup)).text, entries[6].content)
  assert.equal((await tools.readByKeyword({ keyword: '停用资料' }, lookup)).text, undefined)
})

test('冷却持续十个已完成剧情回合，跨重启，跳过占位、开场和原生回合编号空档', async () => {
  const f = fixture([entry('罗盘', '罗盘被锁在箱子里。')])
  f.chat.messages.push(reply(1, { greeting: true }))
  assert.deepEqual((await f.run(5)).refs, ['罗盘'])
  f.restart()
  assert.deepEqual((await f.run(6)).refs, ['罗盘'], '未完成的请求不消耗冷却')
  for (let i = 0; i < 10; i++) {
    const turn = 6 + 9 * i
    f.chat.messages.push(reply(turn), reply(turn + 1, { placeholder: true }))
    assert.deepEqual((await f.run(turn + 2)).refs, [], '注入后的第 ' + (i + 1) + ' 轮')
  }
  f.chat.messages.push(reply(100))
  assert.deepEqual((await f.run(102)).refs, ['罗盘'])
})

test('成功压缩并替换上下文后可重新注入；失败的压缩不能重置', async () => {
  const events = [{ type: 'turn/start', data: { turn: 2 } }]
  const session = { snapshotEvents: () => events }
  const f = fixture([entry('罗盘', '罗盘被锁在箱子里。')])
  const run = turn => f.run(turn, { worldbookEpoch: completedCompactionEpoch(session) })
  assert.deepEqual((await run(2)).refs, ['罗盘'])
  f.chat.messages.push(reply(2))
  events.push({ type: 'compaction/summary', data: { compactionId: 'failed' } },
    { type: 'compaction/end', data: { compactionId: 'failed', error: 'timeout' } },
    { type: 'turn/start', data: { turn: 3 } })
  assert.deepEqual((await run(3)).refs, [])
  f.chat.messages.push(reply(3))
  events.push({ type: 'compaction/summary', data: { compactionId: 'success' } },
    { type: 'user/message', surfaceOp: { op: 'replace' }, data: { source: { compactionId: 'success' } } },
    { type: 'compaction/end', data: { compactionId: 'success' } },
    { type: 'turn/start', data: { turn: 4 } })
  assert.deepEqual((await run(4)).refs, ['罗盘'])
  f.chat.messages.push(reply(4))
  assert.deepEqual((await run(5)).refs, [], '压缩后的新注入仍进入冷却')
})

test('正文超预算时留给主动检索；已编辑的原文不受旧版本冷却限制', async () => {
  const f = fixture([entry('超大', '钟楼的青铜罗盘。'.repeat(30)), entry('简短', '用来找门。')], { token_budget: 22 })
  const first = await f.run(2)
  assert.deepEqual(first.refs, ['简短'])
  assert.match(first.titleHints, /超大/)
  f.chat.messages.push(reply(2))
  f.worldBook.view.entries[1] = { ...f.worldBook.view.entries[1], content: '用来找路。' }
  assert.match((await f.run(3)).automaticContext, /用来找路/)
})

test('关键词扫描使用玩家本轮输入和上一条正文，不被准备阶段的占位消息挤占', async () => {
  const f = fixture([entry('钟楼', '钟楼的秘密。')], { scan_depth: 2 })
  f.chat.messages.push(reply(2, { text: '你到了钟楼。' }),
    { role: 'user', text: '往前', placeholder: true }, reply(3, { text: '', placeholder: true }))
  assert.deepEqual((await f.run(3, { userText: '往前' })).refs, ['钟楼'])
})
