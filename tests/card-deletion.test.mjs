import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createCardDeletion } from '../tavern-plugin/lib/domain/card-deletion.js'

const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

test('删除人物卡只清理人物卡文件和绑定，不触碰已有对话', async () => {
  const calls = []
  const deletion = createCardDeletion({
    resources: {
      async remove(path) { calls.push(['remove', path]) },
      async unbindMaterial(path) { calls.push(['unbindMaterial', path]) }
    }
  })

  assert.deepEqual(await deletion.remove('cards/角色.json'), {
    deleted: true,
    cardPath: 'cards/角色.json'
  })
  assert.deepEqual(calls, [
    ['remove', 'cards/角色.json'],
    ['unbindMaterial', 'cards/角色.json']
  ])
})

test('人物卡处于半删除状态时可以直接重试', async () => {
  let attempts = 0
  const deletion = createCardDeletion({
    resources: {
      async remove() { attempts += 1 },
      async unbindMaterial() {}
    }
  })

  await deletion.remove('cards/角色.json')
  await deletion.remove('cards/角色.json')
  assert.equal(attempts, 2)
})

test('删除确认明确说明已有对话会保留', () => {
  assert.match(clientSource, /人物卡工作版和原版都会删除，已有对话会保留/)
  assert.doesNotMatch(clientSource, /相关对话都会删除/)
})
