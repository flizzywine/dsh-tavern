import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as surface from '../tavern-plugin/lib/domain/rollback-surface.js'

function fixture() {
  const message = (seq, turn, text, extra = {}) => ({ seq, type: 'assistant/message', data: { turn, message: { source: { kind: 'model' }, content: text ? [{ type: 'text', text }] : [] } }, ...extra })
  return [
    { seq: 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } },
    message(10, 6, 'original'),
    { seq: 20, type: 'turn/end', data: { turn: 7, reason: { kind: 'error' } } },
    message(30, 8, 'regenerated'),
    { seq: 31, type: 'turn/end', data: { turn: 8, reason: { kind: 'completed' } } },
    message(32, 6, '', { surfaceOp: { op: 'replace', start: 10, end: 30 }, sourceEventSeqs: [10, 30] }),
    { seq: 40, type: 'turn/end', data: { turn: 9, reason: { kind: 'error' } } }
  ]
}

test('成功重生成只隐藏替换范围内的旧错误；保留原始事件、早期和最新失败', () => {
  const events = fixture()
  const before = JSON.stringify(events)
  assert.deepEqual(surface.supersededRegenerationErrorTurns({ events, suppressedDshTurns: [8] }), [7])
  assert.equal(JSON.stringify(events), before)
  assert.deepEqual(surface.supersededRegenerationErrorTurns({ events: JSON.parse(before), suppressedDshTurns: [8] }), [7])
})

test('重生成未完成、失败、未提交或普通回退都不能隐藏旧错误', () => {
  for (const mutate of [
    events => events.filter(e => e.seq !== 32),
    events => events.filter(e => e.seq !== 31),
    events => events.map(e => e.seq === 31 ? { ...e, data: { turn: 8, reason: { kind: 'error' } } } : e),
    events => events.map(e => e.seq === 30 ? { ...e, data: { turn: 8, message: { source: { kind: 'model' }, content: [{ type: 'reasoning', text: 'thinking' }] } } } : e),
    events => events.map(e => e.seq === 32 ? { ...e, data: { ...e.data, turn: 8 } } : e)
  ]) assert.deepEqual(surface.supersededRegenerationErrorTurns({ events: mutate(fixture()), suppressedDshTurns: [8] }), [])
  assert.deepEqual(surface.supersededRegenerationErrorTurns({ events: fixture(), suppressedDshTurns: [] }), [])
})

test('连续重生成从持久替换记录恢复，不受后续事件增长影响', () => {
  const events = fixture()
  const body = { seq: 50, type: 'assistant/message', data: { turn: 10, message: { source: { kind: 'model' }, content: [{ type: 'text', text: 'next' }] } } }
  events.push(body, { seq: 51, type: 'turn/end', data: { turn: 10, reason: { kind: 'completed' } } }, {
    seq: 52, type: 'assistant/message', data: { turn: 6, message: { source: { kind: 'model' }, content: [] } }, surfaceOp: { op: 'replace', start: 32, end: 50 }
  })
  assert.deepEqual(surface.supersededRegenerationErrorTurns({ events, suppressedDshTurns: [8, 10] }), [7, 9])
})

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console })
const client = descriptor.factory(() => ({}))
function row(turn, alpha = true) {
  const attrs = { 'data-chat-flow-kind': 'turn-error', 'data-chat-flow-key': '10:turn-error' + turn }
  if (alpha) attrs['data-chat-turn'] = String(turn)
  return { hidden: false, getAttribute(name) { return attrs[name] ?? null } }
}

test('main 与 alpha 错误节点均隐藏；卸载、切换会话恢复，只处理作用域内错误', () => {
  for (const alpha of [false, true]) {
    const old = row(7, alpha), latest = row(9, alpha), other = row(7, alpha)
    const root = { querySelectorAll(selector) { assert.equal(selector, '[data-chat-flow-kind]'); return [old, latest] } }
    const projection = client.createSupersededErrorProjection(root)
    projection.apply([7])
    assert.equal(old.hidden, true)
    assert.equal(latest.hidden, false)
    assert.equal(other.hidden, false)
    projection.apply([])
    assert.equal(old.hidden, false)
    old.hidden = true
    projection.apply([7])
    projection.dispose()
    assert.equal(old.hidden, true, 'preserve another owner’s hidden state')
    old.hidden = false
    projection.apply([7])
    projection.dispose()
    assert.equal(old.hidden, false)
  }
})

function flowRow(kind, turn, alpha) {
  const attrs = { 'data-chat-flow-kind': kind }
  if (alpha) attrs['data-chat-turn'] = String(turn)
  // Legacy user/message keys identify a message, not its turn. A failed tail
  // may be empty: the preceding turn-error is the reliable turn anchor.
  attrs['data-chat-flow-key'] = kind === 'turn-error'
    ? '10:turn-error' + turn : kind.length + ':' + kind + 'opaque-message-id'
  return { hidden: false, style: { display: '' }, getAttribute(name) { return attrs[name] ?? null }, querySelector() { return null } }
}

test('回退重生成后，已被替代的失败输入、思考、上下文和空尾部一起隐藏', () => {
  for (const alpha of [false, true]) {
    const original = ['user', 'assistant-step', 'turn-tail'].map(kind => flowRow(kind, 6, alpha))
    const failed = ['system-prompt', 'user', 'turn-process', 'context', 'assistant-step', 'turn-error', 'turn-tail'].map(kind => flowRow(kind, 7, alpha))
    const next = ['user', 'assistant-step', 'turn-error', 'turn-tail'].map(kind => flowRow(kind, 9, alpha))
    const rows = [...original, ...failed, ...next]
    const projection = client.createSupersededErrorProjection({ querySelectorAll() { return rows } })
    projection.apply([7])
    assert.ok(failed.every(row => row.hidden), 'failed attempt must disappear as one complete turn')
    assert.ok([...original, ...next].every(row => !row.hidden), 'preserve normal history and the latest failure')
    projection.apply([7])
    assert.ok(failed.every(row => row.hidden), 'reapplying after rollback/refresh is idempotent')
    projection.dispose()
    assert.ok(rows.every(row => !row.hidden), 'leaving the session restores projection-owned visibility')
  }
})

test('alpha 只隐藏明确属于目标轮的节点，包括尾部尚未挂载的流式节点', () => {
  const other = flowRow('user', 6, true)
  const failed = flowRow('assistant-step', 7, true)
  const projection = client.createSupersededErrorProjection({ querySelectorAll() { return [other, failed] } })
  projection.apply([7])
  assert.equal(other.hidden, false)
  assert.equal(failed.hidden, true)
})

test('原生过程节点重置 hidden 后仍隐藏，解除投影时恢复原来的显示样式', () => {
  const process = flowRow('turn-process', 7, true)
  process.style.display = 'flex'
  const projection = client.createSupersededErrorProjection({ querySelectorAll() { return [process] } })
  projection.apply([7])
  process.hidden = false // DSH updates its own folding state after a render.
  assert.equal(process.style.display, 'none')
  projection.apply([7])
  projection.apply([])
  assert.equal(process.hidden, false)
  assert.equal(process.style.display, 'flex')
})

test('延迟加载的错误节点仍应用投影，脱离作用域的节点恢复', () => {
  const old = row(7)
  let rows = []
  const projection = client.createSupersededErrorProjection({ querySelectorAll() { return rows } })
  projection.apply([7])
  rows = [old]
  projection.apply([7])
  assert.equal(old.hidden, true)
  rows = []
  projection.apply([7])
  assert.equal(old.hidden, false)
})

test('宿主提供独立错误投影，前端按 Session 隔离并只观察对话滚动区', async () => {
  const host = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.match(host, /const projectionEvents = sessionDebugEvidence\(chat.sessionId\).events/)
  assert.match(host, /suppressedDshTurns = [\s\S]*abortedRegenerationTurns\(\{ events: projectionEvents \}\)/)
  assert.match(host, /suppressedDshErrorTurns: supersededRegenerationErrorTurns\(\{\s*events: projectionEvents,\s*suppressedDshTurns: chat.suppressedDshTurns/)
  assert.match(source, /createElement\(SupersededTurnErrors, Object.assign\(\{\}, props, \{ key: props.sessionId \}\)\)/)
  const component = source.slice(source.indexOf('function SupersededTurnErrors('), source.indexOf('function CandidateQuestion('))
  assert.match(component, /closest\("\[data-conversation-scroll\]"\)/)
  assert.match(component, /observer.observe\(root,/)
  assert.match(component, /observer.disconnect\(\); projection.dispose\(\)/)
})
