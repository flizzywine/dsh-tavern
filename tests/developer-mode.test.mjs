import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveDeveloperMode } from '../tavern-plugin/lib/domain/developer-mode.js'

test('兼容模式在开发阶段默认开启，并可由环境变量显式关闭', () => {
  assert.equal(resolveDeveloperMode({}), true)
  assert.equal(resolveDeveloperMode({ DSH_TAVERN_DEV_MODE: '0' }), false)
  assert.equal(resolveDeveloperMode({ DSH_TAVERN_DEV_MODE: 'true' }), true)
  assert.equal(resolveDeveloperMode({ DSH_TAVERN_DEV_MODE: '1' }), true)
})
