import assert from 'node:assert/strict'
import test from 'node:test'

import { projectRegenerationRequestMessages } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { applyRegenerationProjection } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { inputKind } from '../tavern-plugin/lib/domain/session-turn-input.js'

function player(text, id = '') {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function body(text) {
  return { role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } }
}

function frame(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-tavern', form: 'foreground-frame' } }
}

function writingRules(text) {
  const rendered = '【正文固定规则】\n' + (text || '此前正文固定规则已撤回。')
  return {
    role: 'user',
    content: [{ type: 'text', text: rendered }],
    source: { kind: 'plugin:dsh-tavern', form: 'writing-rules', trace: { writingRulesSnapshot: { schemaVersion: 1, text, rendered } } }
  }
}

function regenerate(text) {
  return { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern-regen' } }
}

test('没有可替换的玩家输入或没有重采样输入时原样返回', () => {
  const noPlayer = [body('正文'), regenerate('重新生成')]
  assert.equal(projectRegenerationRequestMessages(noPlayer), noPlayer)
  const noRegenerate = [player('输入'), body('正文')]
  assert.equal(projectRegenerationRequestMessages(noRegenerate), noRegenerate)
  assert.deepEqual(projectRegenerationRequestMessages([]), [])
  assert.deepEqual(projectRegenerationRequestMessages(null), [])
})

test('重新生成保留被替换回合首次注入的固定写作规则，丢弃旧正文和旧回合材料', () => {
  const opening = body('上一楼的开场')
  const input = player('原始动作', 'original')
  const rules = writingRules('避免重复已写情节')
  const retry = regenerate('改写本轮')
  const newFrame = frame('新的回合材料')
  const projected = projectRegenerationRequestMessages([
    opening, input, rules, frame('旧回合材料'), body('旧正文'), retry, newFrame
  ])
  assert.deepEqual(projected, [opening, { ...input, content: retry.content }, rules, newFrame])
})

test('重新生成有固定写作规则更新或撤回时，只使用这次请求的新版本', () => {
  const input = player('原始动作')
  const oldRules = writingRules('避免重复已写情节')
  const retry = regenerate('改写本轮')
  for (const newRules of [writingRules('新的固定规则'), writingRules('')]) {
    const projected = projectRegenerationRequestMessages([input, oldRules, body('旧正文'), retry, newRules])
    assert.deepEqual(projected, [{ ...input, content: retry.content }, newRules])
  }
})

test('旧会话残留多段历史重抽时，正常续写与再次重抽均逐段折叠旧拒答与重复输入', () => {
  const opening = body('开场白')
  const p1 = player('第一轮设定', 'p1')
  const rules = writingRules('保持第一人称')
  const r1a = regenerate('第一轮设定')
  const refusal = body('我无法满足该请求')
  const r1b = regenerate('第一轮设定')
  const f1b = frame('第一轮最终帧')
  const b1 = body('第一轮有效正文')

  const p2 = player('第二轮动作', 'p2')
  const f2a = frame('第二轮旧帧')
  const r2 = regenerate('第二轮动作')
  const f2b = frame('第二轮新帧')
  const b2 = body('第二轮有效正文')

  const p3 = player('第三轮动作', 'p3')
  const f3 = frame('第三轮帧')

  const projectedNext = projectRegenerationRequestMessages([
    opening,
    p1, rules, frame('第一轮旧帧'), r1a, frame('第一轮拒答帧'), refusal, r1b, f1b, b1,
    p2, f2a, r2, f2b, b2,
    p3, f3
  ])
  assert.deepEqual(projectedNext, [
    opening,
    { ...p1, content: r1b.content }, rules, f1b, b1,
    { ...p2, content: r2.content }, f2b, b2,
    p3, f3
  ])

  const r3 = regenerate('第三轮重抽')
  const f3b = frame('第三轮重抽帧')
  const projectedRegen = projectRegenerationRequestMessages([
    opening,
    p1, rules, r1a, refusal, r1b, f1b, b1,
    p2, f2a, r2, f2b, b2,
    p3, f3, body('第三轮旧正文'), r3, f3b
  ])
  assert.deepEqual(projectedRegen, [
    opening,
    { ...p1, content: r1b.content }, rules, f1b, b1,
    { ...p2, content: r2.content }, f2b, b2,
    { ...p3, content: r3.content }, f3b
  ])
})

function makeSurfaceSession(initialEvents) {
  const events = []
  const nodes = []
  const session = {
    header: { version: 3 },
    surface: { nodes },
    events,
    snapshotEvents() { return events },
    append(type, data, intent) {
      const seq = events.length
      const ev = { seq, type, data, ...(intent?.surfaceOp ? { surfaceOp: intent.surfaceOp } : {}) }
      events.push(ev)
      if (intent?.surfaceOp === 'append') nodes.push(seq)
      else if (intent?.surfaceOp?.op === 'replace') {
        const i1 = nodes.indexOf(intent.surfaceOp.startSeq)
        const i2 = nodes.indexOf(intent.surfaceOp.endSeq)
        assert.ok(i1 >= 0 && i2 >= i1, 'replace range must exist on surface')
        nodes.splice(i1, i2 - i1 + 1, seq)
      }
      return ev
    }
  }
  for (const item of initialEvents) session.append(item.type, item.data, { surfaceOp: 'append' })
  return session
}

test('失败尾补写提交后收口重复输入与 regen 标记，保留上一轮正文且幂等', () => {
  const session = makeSurfaceSession([
    { type: 'assistant/message', data: { turn: 2, step: 1, message: body('上一轮正文') } },
    { type: 'user/message', data: player('本轮失败输入', 'p-tail') },
    { type: 'user/message', data: frame('失败轮旧帧') },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '本轮失败输入' }], source: { kind: 'plugin:dsh-tavern-regen', regenerationId: 'op-1' } } },
    { type: 'user/message', data: frame('补写轮新帧') },
    { type: 'assistant/message', data: { turn: 3, step: 1, message: body('补写成功正文') } }
  ])
  const projection = { kind: 'append-round', storyTurn: 3, operationId: 'op-1', native: { formatVersion: 4, turn: 3, input: 3, reply: 5 } }
  const first = applyRegenerationProjection(session, projection)
  const visible = session.surface.nodes.map(seq => session.events[seq])
  assert.equal(visible.filter(ev => ev.type === 'user/message' && inputKind(ev.data) === 'regenerate').length, 0)
  assert.equal(visible.filter(ev => ev.type === 'user/message' && inputKind(ev.data) === 'player').length, 1)
  assert.equal(visible[0].seq, 0)
  assert.equal(first.nativeAnchor.input, visible[1].seq)
  assert.equal(first.nativeAnchor.reply, 5)
  const second = applyRegenerationProjection(session, projection)
  assert.deepEqual(second, first)
})

test('失败尾补写收口时保留首次注入的固定写作规则并清除 regen 标记', () => {
  const session = makeSurfaceSession([
    { type: 'assistant/message', data: { turn: 1, step: 1, message: body('开场白') } },
    { type: 'user/message', data: player('首轮输入', 'p-1') },
    { type: 'user/message', data: writingRules('首轮写作规则') },
    { type: 'user/message', data: frame('首轮旧帧') },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '首轮输入' }], source: { kind: 'plugin:dsh-tavern-regen', regenerationId: 'op-2' } } },
    { type: 'user/message', data: frame('首轮新帧') },
    { type: 'assistant/message', data: { turn: 2, step: 1, message: body('首轮正文') } }
  ])
  const result = applyRegenerationProjection(session, {
    kind: 'append-round', storyTurn: 2, operationId: 'op-2', native: { formatVersion: 4, turn: 2, input: 4, reply: 6 }
  })
  const visible = session.surface.nodes.map(seq => session.events[seq])
  assert.equal(visible.filter(ev => ev.type === 'user/message' && inputKind(ev.data) === 'regenerate').length, 0)
  assert.equal(visible.some(ev => ev.data?.source?.trace?.writingRulesSnapshot?.schemaVersion === 1), true)
  assert.equal(result.nativeAnchor.input, 1)
  assert.equal(result.nativeAnchor.reply, 6)
})
