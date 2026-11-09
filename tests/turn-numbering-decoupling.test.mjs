import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { findBodyRegenerationFrame } from '../tavern-plugin/lib/domain/body-regeneration-materials.js'

const model = () => ({ kind: 'model', provider: 'test', model: 'test' })

test('映射缺位时按帧上记着的剧情轮号找到重生成材料，而不是拿剧情号当宿主号', () => {
  const chat = {
    id: 'chat', messages: [], timeline: { branchId: 'b' },
    foregroundFrames: {
      a: { kind: 'foreground', turn: 11, storyTurn: 3, chatId: 'chat', branchId: 'b' },
      b: { kind: 'foreground', turn: 12, chatId: 'chat', branchId: 'b' }
    }
  }
  assert.equal(findBodyRegenerationFrame(chat, 3)?.storyTurn, 3)
  assert.equal(findBodyRegenerationFrame({ ...chat, regeneratedDshTurns: { 3: 12 } }, 3)?.turn, 12)
})
