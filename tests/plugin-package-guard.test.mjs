import test from 'node:test'
import assert from 'node:assert/strict'

import { isCompatibleHost } from '../bin/plugin-package-guard.mjs'

// 版本判定只会返回 allowed / blocked；guard 曾经要求一个不存在的 verified，
// 结果在任何宿主上都抛错，user-tools-bridge 与 compaction 因此永远不启动。
test('允许清单内的宿主通过 guard，清单外或读取失败拒绝', () => {
  assert.equal(isCompatibleHost({ status: 'allowed', message: '' }), true)
  assert.equal(isCompatibleHost({ status: 'verified', message: '' }), true)
  assert.equal(isCompatibleHost({ status: 'blocked', message: 'DSH 0.2.2 不在允许清单' }), false)
})
