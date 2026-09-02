import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeBackgroundModel, resolveChatBackgroundModel, snapshotBackgroundModel } from '../tavern-plugin/lib/domain/background-model-selection.js'

test('后台模型设置只接受完整 provider/model', () => {
  assert.deepEqual(normalizeBackgroundModel({ provider: ' vertex ', model: ' gemini ' }), { provider: 'vertex', model: 'gemini' })
  assert.equal(normalizeBackgroundModel({ provider: 'vertex' }), null)
  assert.equal(normalizeBackgroundModel(null), null)
})

test('开局快照优先固定设置，否则复制前台选择及推理强度', () => {
  assert.deepEqual(snapshotBackgroundModel({ provider: 'fixed', model: 'worker' }, { provider: 'front', model: 'chat' }), { provider: 'fixed', model: 'worker' })
  assert.deepEqual(snapshotBackgroundModel(null, { provider: 'front', model: 'chat', reasoningEffort: 'high' }), { provider: 'front', model: 'chat', reasoningEffort: 'high' })
})

test('运行时优先使用游戏快照，旧游戏才回退当前前台模型', () => {
  assert.deepEqual(resolveChatBackgroundModel({ backgroundModelSelection: { provider: 'fixed', model: 'worker', reasoningEffort: 'high' } }, { provider: 'front', model: 'chat' }), { provider: 'fixed', model: 'worker', reasoningEffort: 'high' })
  assert.deepEqual(resolveChatBackgroundModel({}, { provider: 'front', model: 'chat' }), { provider: 'front', model: 'chat' })
})
