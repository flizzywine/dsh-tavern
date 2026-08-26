import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveDeveloperMode } from '../tavern-plugin/lib/domain/developer-mode.js'

test('兼容模式只由显式开发环境变量开启', () => {
  assert.equal(resolveDeveloperMode({}), false)
  assert.equal(resolveDeveloperMode({ DSH_TAVERN_DEV_MODE: '0' }), false)
  assert.equal(resolveDeveloperMode({ DSH_TAVERN_DEV_MODE: 'true' }), false)
  assert.equal(resolveDeveloperMode({ DSH_TAVERN_DEV_MODE: '1' }), true)
})
