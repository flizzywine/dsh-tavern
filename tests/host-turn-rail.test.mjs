// 轮次导航（domain/host-turn-rail.js）：`turnOutline` 发出去之前裁到表面里还有内容的轮次。
import assert from 'node:assert/strict'
import test from 'node:test'
import { installHostTurnRailFilter } from '../tavern-plugin/lib/domain/host-turn-rail.js'

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
