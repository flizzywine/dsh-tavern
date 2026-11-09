// 轮次导航（domain/host-turn-rail.js）：`turnOutline` 发出去之前裁到表面里还有内容的轮次。
import assert from 'node:assert/strict'
import test from 'node:test'
import { installHostTurnRailFilter, surfaceTurns } from '../tavern-plugin/lib/domain/host-turn-rail.js'

const entry = (turn, seq) => ({ turn, seq, prompt: '第 ' + turn + ' 轮输入', response: '第 ' + turn + ' 轮正文' })

function session(nodes, replaceGeneration = 0) {
  return { surface: { nodes, replaceGeneration } }
}

function registry(state) {
  const listeners = new Set()
  const store = { registrations: new Map(), listeners, snapshot: undefined }
  return Object.assign(store, {
    snapshot(current, keys) {
      return { asOfSeq: 99, values: { turnOutline: state.outline, inbox: state.inbox, sessionStats: { turns: 1 } } }
    },
    cachedSnapshot() { return { asOfSeq: 42, values: { turnOutline: state.outline } } },
    hydrate() { return { asOfSeq: 7, values: { turnOutline: state.outline } } },
    onChanged(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })
}

// turn 1..4，边界 seq 0/10/20/30；表面只剩第 1、3 轮的内容（第 2 轮失败重试、第 4 轮是被取代的尝试）。
const outline = [entry(1, 0), entry(2, 10), entry(3, 20), entry(4, 30)]
const liveNodes = [1, 5, 23, 27]

test('没有要裁的条目时保持原数组身份，表面没变时复用结果', () => {
  const state = { outline, inbox: [] }
  const host = registry(state)
  const dispose = installHostTurnRailFilter(host)
  const kept = [outline[0], outline[1]]
  state.outline = kept
  const current = session(liveNodes)
  assert.equal(host.snapshot(current).values.turnOutline, kept, '不裁就不换引用')
  state.outline = outline
  const first = host.snapshot(current).values.turnOutline
  assert.equal(host.snapshot(current).values.turnOutline, first, '同一份表面复用裁剪结果')
  const moved = session([1, 5, 12, 23])
  assert.deepEqual(host.snapshot(moved).values.turnOutline.map(item => item.turn), [1, 2, 3], '表面变了重新算')
  dispose()
})

test('宿主接口不认识时原样放回，不抛错', () => {
  for (const broken of [undefined, {}, { registrations: new Map() }, { registrations: [], snapshot() {} }]) {
    const dispose = installHostTurnRailFilter(broken)
    assert.equal(typeof dispose, 'function')
    dispose()
  }
  const host = registry({ outline, inbox: [] })
  const nativeSnapshot = host.snapshot
  const dispose = installHostTurnRailFilter(host)
  const second = installHostTurnRailFilter(host)
  dispose()
  assert.equal(typeof host.snapshot, 'function', '两次安装后卸载一次仍然生效')
  assert.deepEqual(host.snapshot(session(liveNodes)).values.turnOutline.map(item => item.turn), [1, 3])
  second()
  assert.equal(host.snapshot, nativeSnapshot, '最后一次卸载还原方法本身')
})

test('surfaceTurns：表面里还有节点的轮次，清理标记不算', () => {
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'user/message', data: { turn: 1, content: [{ type: 'text', text: '一' }], source: { kind: 'user' } } },
    { seq: 2, type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '答一' }] } } },
    { seq: 3, type: 'turn/start', data: { turn: 2 } },
    { seq: 4, type: 'user/message', data: { turn: 2, content: [{ type: 'text', text: '二' }], source: { kind: 'user' } } },
    { seq: 5, type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '答二' }] } } },
    { seq: 6, type: 'turn/start', data: { turn: 3 } },
    { seq: 7, type: 'user/message', data: { content: [], source: { kind: 'plugin:fixture-cleanup' } } },
  ]
  assert.deepEqual(surfaceTurns({ events, nodes: [1, 2, 5] }), [1, 2], '第 3 轮只剩清理标记，不算')
  // tavern 自己写的、不带 turn 的正文按 turn/start 边界换算。
  assert.deepEqual(surfaceTurns({ events, nodes: [1, 4, 7] }), [1, 2], '标记被跳过，seq 4 落在第 2 轮')
  assert.deepEqual(surfaceTurns({ events, nodes: [] }), [], '表面空就是没有轮次')
  assert.deepEqual(surfaceTurns({ events: [], nodes: [1] }), [])
  assert.deepEqual(surfaceTurns({}), [])
  assert.deepEqual(surfaceTurns({ events, nodes: [99] }), [], '没有对应事件的 seq 不算正文')
  // 只有系统消息的轮次（第 3 轮）也不算：跳过去只会滚一段空气。
  const withSystem = [...events, { seq: 8, type: 'system/message', data: { turn: 3, message: { role: 'system', content: [{ type: 'text', text: '系统' }] } } }]
  assert.deepEqual(surfaceTurns({ events: withSystem, nodes: [1, 8] }), [1], '系统消息撑不起一根能跳的刻度')
  assert.deepEqual(surfaceTurns({ events: withSystem, nodes: [1, 4, 5] }), [1, 2], '玩家输入与助手正文照常算')
})
