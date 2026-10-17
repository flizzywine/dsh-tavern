import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { roundAnchor } from '../tavern-plugin/lib/domain/round-anchor.js'
import { locateRollbackSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { nativeOpeningMessageId } from '../tavern-plugin/lib/domain/native-opening.js'
import { planNativeSurfaceRepair, repairNativeSurface } from '../tavern-plugin/lib/domain/native-surface-repair.js'

const model = { kind: 'model', provider: 'test', model: 'test' }
const textOf = event => (event.data.message?.content || event.data.content || []).map(block => block.text).join('')

// A played game: prefix, opening, then rounds whose Chat rows carry anchors.
function game(rounds, { anchors = true, id = 'repair' } = {}) {
  const session = Session.create(id)
  const chat = { id: 'chat-' + id, mode: 'story', messages: [] }
  appendSessionEvent(session, 'user/message', { id: 'tavern-session-prefix:' + id, role: 'user', content: [{ type: 'text', text: '前缀' }], source: { kind: 'plugin', plugin: 'dsh-tavern' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: nativeOpeningMessageId(chat.id), role: 'assistant', content: [{ type: 'text', text: '开场' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  chat.messages.push({ role: 'assistant', turn: 1, greeting: true, text: '开场' })
  for (let turn = 2; turn < rounds + 2; turn++) play(session, chat, turn, anchors)
  return { session, chat }
}
function play(session, chat, turn, anchors = true) {
  appendSessionEvent(session, 'turn/start', { turn })
  appendSessionEvent(session, 'user/message', { id: 'frame-' + turn, role: 'user', content: [{ type: 'text', text: '本轮上下文' }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'foreground-frame' } }, { surfaceOp: 'append' })
  const input = appendSessionEvent(session, 'user/message', { id: 'in-' + turn, role: 'user', content: [{ type: 'text', text: '行动' + turn }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const reply = appendSessionEvent(session, 'assistant/message', { turn, step: 1, message: { id: 'out-' + turn, role: 'assistant', content: [{ type: 'text', text: '正文' + turn }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  chat.messages.push({ role: 'user', text: '行动' + turn }, { role: 'assistant', turn, text: '正文' + turn, ...(anchors ? { nativeAnchor: roundAnchor(turn, input, reply) } : {}) })
  return { input, reply }
}
const nodeTexts = session => { const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event])); return session.surface.nodes.map(seq => textOf(bySeq.get(seq))) }
const plan = ({ session, chat }) => planNativeSurfaceRepair({ chat, events: sessionEvents(session), nodes: session.surface.nodes })
function repair(h, repairId = 'r1') {
  const result = repairNativeSurface(h.session, h.chat, { repairId })
  for (const { messageIndex, anchor } of result.anchors) if (anchor) h.chat.messages[messageIndex].nativeAnchor = anchor
  return result
}

test('一致的存档不写任何东西', () => {
  const h = game(3)
  const before = h.session.surface.nodes.slice()
  assert.equal(plan(h).status, 'intact')
  assert.equal(repair(h).applied, false)
  assert.deepEqual(h.session.surface.nodes, before)
})

test('只坏最后一轮：保留前面全部节点，只重写最后一轮，修复后回退能直接定位', () => {
  const h = game(3)
  const kept = h.session.surface.nodes.slice(0, -3) // through round 3's reply
  const last = h.chat.messages.at(-1)
  last.text = '玩家改过的正文' // Chat changed, native never followed (a lost body-edit sync).
  const result = repair(h)
  assert.equal(result.plan.status, 'tail')
  assert.deepEqual(result.plan.rounds.map(round => round.turn), [4])
  assert.deepEqual(h.session.surface.nodes.slice(0, kept.length), kept)
  assert.deepEqual(nodeTexts(h.session).slice(kept.length), ['行动4', '玩家改过的正文'])
  assert.equal(plan(h).status, 'intact', 'repair is idempotent')
  const target = locateRollbackSurface({ events: sessionEvents(h.session), nodes: h.session.surface.nodes, anchor: last.nativeAnchor })
  assert.ok(target, 'rollback finds the repaired round by its new anchor')
  assert.equal(textOf(sessionEvents(h.session).find(event => event.seq === target.assistantSeq)), '玩家改过的正文')
})

test('回退后 Chat 少了一轮、原生却留着：去掉原生多出的那一轮', () => {
  const h = game(3)
  h.chat.messages.splice(-2) // Chat committed the rollback; native mutation failed.
  const kept = h.session.surface.nodes.slice(0, -3)
  repair(h)
  assert.deepEqual(h.session.surface.nodes.slice(0, kept.length), kept)
  assert.deepEqual(nodeTexts(h.session).slice(kept.length), [''], 'only an empty placeholder stands for the removed round')
  assert.equal(plan(h).status, 'intact')
})

test('最后一轮之后残留失败的输入或半截正文：只遮掉残留，最后一轮保留', () => {
  const h = game(2)
  appendSessionEvent(h.session, 'user/message', { id: 'stray', role: 'user', content: [{ type: 'text', text: '中断的输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(h.session, 'assistant/message', { turn: 9, step: 1, message: { id: 'half', role: 'assistant', content: [{ type: 'text', text: '半截' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  assert.equal(plan(h).status, 'tail')
  const kept = h.session.surface.nodes.slice(0, -2)
  repair(h)
  assert.deepEqual(h.session.surface.nodes.slice(0, kept.length), kept)
  assert.deepEqual(nodeTexts(h.session).slice(kept.length), [''])
  assert.equal(plan(h).status, 'intact')
})

test('注入的上下文和空占位不算残留', () => {
  const h = game(2)
  appendSessionEvent(h.session, 'user/message', { id: 'vars', role: 'user', content: [{ type: 'text', text: '变量变化' }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'variable-changes' } }, { surfaceOp: 'append' })
  assert.equal(plan(h).status, 'intact')
})

test('旧存档没有锚点：按正文文字找到断点', () => {
  const h = game(3, { anchors: false })
  h.chat.messages.at(-1).text = '新正文'
  const kept = h.session.surface.nodes.slice(0, -3)
  repair(h)
  assert.deepEqual(h.session.surface.nodes.slice(0, kept.length), kept)
  assert.deepEqual(nodeTexts(h.session).slice(-2), ['行动4', '新正文'])
})

test('压缩摘要保留：断点之前的压缩检查点不被替换', () => {
  const h = game(4)
  const nodes = h.session.surface.nodes
  // Compaction replaced rounds 2-3 (from round 2's frame through round 3's reply) by one summary.
  const start = nodes[2], end = nodes[7]
  const summary = replaceSessionSurface(h.session, 'user/message', { id: 'summary', role: 'user', content: [{ type: 'text', text: '前情摘要' }], source: { kind: 'plugin', plugin: 'compact' } }, { start, end, sourceEventSeqs: nodes.slice(2, 8) })
  h.chat.messages.at(-1).text = '改过的第五轮'
  repair(h)
  assert.ok(h.session.surface.nodes.includes(summary.seq))
  assert.deepEqual(nodeTexts(h.session), ['前缀', '开场', '前情摘要', '本轮上下文', '行动4', '正文4', '行动5', '改过的第五轮'])
})

test('压缩之后的轮次全部对不上：保留摘要，只重写压缩后的轮次', () => {
  const h = game(3, { anchors: false })
  const nodes = h.session.surface.nodes
  replaceSessionSurface(h.session, 'user/message', { id: 'summary', role: 'user', content: [{ type: 'text', text: '前情摘要' }], source: { kind: 'plugin', plugin: 'compact' } }, { start: nodes[2], end: nodes[4], sourceEventSeqs: nodes.slice(2, 5) })
  for (const message of h.chat.messages) if (message.role === 'assistant' && !message.greeting) message.text += '（改）'
  const result = repair(h)
  assert.equal(result.plan.keep, 3)
  assert.equal(nodeTexts(h.session)[2], '前情摘要')
  assert.equal(nodeTexts(h.session).at(-1), '正文4（改）')
  assert.ok(!nodeTexts(h.session).includes('正文2（改）'), '摘要已经代表的第 2 轮不被写回')
})

test('旧档迁移后锚点失效：摘要代表的轮次不写回，摘要之后没有轮次就算一致', () => {
  const h = game(1)
  const nodes = h.session.surface.nodes
  // A legacy session replaced the native log: its summary stands for round 2, and the
  // Chat's anchor still points at the old log's seqs.
  replaceSessionSurface(h.session, 'user/message', { id: 'summary', role: 'user', content: [{ type: 'text', text: '前情摘要' }], source: { kind: 'plugin', plugin: 'compact' } }, { start: nodes[2], end: nodes.at(-1), sourceEventSeqs: nodes.slice(2) })
  h.chat.messages.at(-1).nativeAnchor = { turn: 2, input: 9000, reply: 9001 }
  assert.equal(plan(h).status, 'intact')
  assert.deepEqual(nodeTexts(h.session), ['前缀', '开场', '前情摘要'])
  // A later round played on top is located and kept; still nothing to write.
  play(h.session, h.chat, 3)
  assert.equal(plan(h).status, 'intact')
})

test('一轮都对不上也不拒绝：保留前缀和开场，按 Chat 整段重写', () => {
  const h = game(2)
  for (const message of h.chat.messages) if (message.role === 'assistant' && !message.greeting) message.text += '!'
  for (const message of h.chat.messages) delete message.nativeAnchor
  const result = repair(h)
  assert.equal(result.plan.status, 'tail', 'the opening is still an intact boundary')
  assert.deepEqual(nodeTexts(h.session), ['前缀', '开场', '行动2', '正文2!', '行动3', '正文3!'])
  // Opening lost too: keep only the prefix.
  const g = game(1, { id: 'full' })
  replaceSessionSurface(g.session, 'assistant/message', { turn: 1, step: 1, message: { id: 'x', role: 'assistant', content: [{ type: 'text', text: '坏' }], source: model } }, { start: g.session.surface.nodes[1], end: g.session.surface.nodes.at(-1), sourceEventSeqs: g.session.surface.nodes.slice(1) })
  delete g.chat.messages.at(-1).nativeAnchor
  const full = repair(g)
  assert.equal(full.plan.status, 'full')
  assert.deepEqual(nodeTexts(g.session), ['前缀', '开场', '行动2', '正文2'])
  assert.equal(plan(g).status, 'intact')
})

test('1000 轮存档坏了最后一轮：前 999 轮节点逐个不变，修复只看末尾', () => {
  const h = game(1000, { id: 'long' })
  const kept = h.session.surface.nodes.slice(0, -3)
  h.chat.messages.at(-1).text = '最后一轮改过'
  const started = performance.now()
  const result = repair(h)
  const elapsed = performance.now() - started
  assert.deepEqual(result.plan.rounds.map(round => round.turn), [1001])
  assert.deepEqual(h.session.surface.nodes.slice(0, kept.length), kept)
  assert.ok(elapsed < 1000, 'repair took ' + elapsed + 'ms')
})

test('修复写回存档：只给读时未变的楼层换锚点，清掉待修复标记与旧编辑标记', async () => {
  const { recordNativeSurfaceRepair } = await import('../tavern-plugin/lib/domain/native-surface-repair.js')
  const h = game(2)
  h.chat.messages.at(-1).text = '改过'
  h.chat.messages.at(-1).bodyEdit = { id: 'old', seq: 1, turn: 3 }
  h.chat.nativeSync = { status: 'stale', reason: 'x', at: 1 }
  const read = structuredClone(h.chat)
  const result = repairNativeSurface(h.session, read, { repairId: 'w' })
  const current = structuredClone(h.chat)
  assert.equal(recordNativeSurfaceRepair(current, read, result.anchors), true)
  assert.equal(current.nativeSync, undefined)
  assert.equal(current.messages.at(-1).bodyEdit, undefined)
  assert.deepEqual(current.messages.at(-1).nativeAnchor, result.anchors[0].anchor)
  // The row changed after the repair read it: keep its anchor, repair again later.
  const moved = structuredClone(h.chat); moved.messages.at(-1).text = '又改了'
  recordNativeSurfaceRepair(moved, read, result.anchors)
  assert.deepEqual(moved.messages.at(-1).nativeAnchor, h.chat.messages.at(-1).nativeAnchor)
  assert.equal(recordNativeSurfaceRepair(structuredClone(current), read, []), false)
})

test('原生里是模型原文（未去空白、未经正则），存档里是投影后的文字：仍算一致', () => {
  const h = game(2)
  for (const message of h.chat.messages.filter(row => row.role === 'assistant' && !row.greeting)) {
    message.sourceText = message.text
    message.text = message.text + '〔正则处理后〕'
  }
  // A further round whose raw native text keeps trailing blank lines; saved texts are trimmed.
  const input = appendSessionEvent(h.session, 'user/message', { id: 'in-raw', role: 'user', content: [{ type: 'text', text: '行动' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  const reply = appendSessionEvent(h.session, 'assistant/message', { turn: 4, step: 1, message: { id: 'out-raw', role: 'assistant', content: [{ type: 'text', text: '原文\n\n' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  h.chat.messages.push({ role: 'user', text: '行动' }, { role: 'assistant', turn: 4, sourceText: '原文', text: '原文〔正则处理后〕', nativeAnchor: roundAnchor(4, input, reply) })
  assert.equal(plan(h).status, 'intact')
  delete h.chat.messages.at(-1).nativeAnchor
  assert.equal(plan(h).status, 'intact', 'text fallback normalizes the same way')
})

test('失败、中断或仍在进行的回合留在末尾：交给失败回合重放处理，不算残留', () => {
  for (const reason of ['error', 'aborted', null]) {
    const h = game(2, { id: 'failed-' + reason })
    appendSessionEvent(h.session, 'turn/start', { turn: 9 })
    appendSessionEvent(h.session, 'user/message', { id: 'in-9', role: 'user', content: [{ type: 'text', text: '被拦截的输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    appendSessionEvent(h.session, 'assistant/message', { turn: 9, step: 1, message: { id: 'out-9', role: 'assistant', content: [{ type: 'text', text: '半截' }], source: model } }, { surfaceOp: 'append', sourceEventSeqs: [] })
    if (reason) appendSessionEvent(h.session, 'turn/end', { turn: 9, reason: { kind: reason } })
    assert.equal(plan(h).status, 'intact', String(reason))
  }
})
