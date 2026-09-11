import assert from 'node:assert/strict'
import test from 'node:test'
import { helperClient } from './fixtures/helper-host-harness.mjs'
import { createCardDeletion } from '../tavern-plugin/lib/domain/card-deletion.js'

test('批量删除串行执行并去重，部分失败不会阻断其他人物卡，失败项可重试', async () => {
  const calls = [], pending = new Set()
  let fail = true
  const deletion = createCardDeletion({ resources: {
    async remove(path) {
      assert.equal(pending.size, 0)
      pending.add(path)
      await new Promise(resolve => setImmediate(resolve))
      pending.delete(path)
      calls.push(path)
      if (path === 'cards/b.json' && fail) throw Error('文件占用')
    },
    async unbindMaterial() {}
  } })
  const cards = ['a', 'b', 'a', 'c'].map(name => ({ name, path: 'cards/' + name + '.json' }))
  const result = await helperClient.deleteTavernCards(cards, path => deletion.remove(path))
  assert.deepEqual(calls, ['cards/a.json', 'cards/b.json', 'cards/c.json'])
  assert.deepEqual(Array.from(result, item => item.ok), [true, false, true])
  assert.equal(result[1].error, '文件占用')
  fail = false
  const retry = await helperClient.deleteTavernCards(result.filter(item => !item.ok), path => deletion.remove(path))
  assert.equal(retry.length, 1)
  assert.equal(retry[0].ok, true)
})

test('空选择不删除；服务端未确认删除时不报告成功', async () => {
  assert.equal((await helperClient.deleteTavernCards([], () => { throw Error('unexpected') })).length, 0)
  const result = await helperClient.deleteTavernCards([{ path: 'cards/a.json', name: 'a' }], async () => ({ deleted: false }))
  assert.equal(result[0].ok, false)
})
