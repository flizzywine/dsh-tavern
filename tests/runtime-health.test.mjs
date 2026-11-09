import assert from 'node:assert/strict'
import test from 'node:test'

import { createRuntimeLogBuffer } from '../tavern-plugin/lib/domain/runtime-health.js'

test('只收酒馆自己的警告报错，密钥隐去，原输出照常', () => {
  const printed = []
  const target = { warn: (...args) => printed.push(['warn', ...args]), error: (...args) => printed.push(['error', ...args]) }
  const logs = createRuntimeLogBuffer({ now: () => 0 })
  const undo = logs.install(target)
  target.warn('dsh-tavern: 读取失败 Bearer abcdefghijklmnop')
  target.error('别的插件出错')
  target.error(new Error('dsh-tavern: 结算失败'))
  undo()
  target.warn('dsh-tavern: 卸载后不再记录')
  assert.equal(printed.length, 4, '原输出不受影响')
  assert.deepEqual(logs.read().map(line => [line.level, line.message]), [['warn', 'dsh-tavern: 读取失败 [已隐藏]'], ['error', 'dsh-tavern: 结算失败']])
})
