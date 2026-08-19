import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createPublicDemo, publicDemoIds } from '../preview/public-demo.mjs'

async function demo() {
  const [cardText, scriptText, characterSource, worldSource] = await Promise.all([
    readFile(new URL('../demo/cards/avra-complete.json', import.meta.url), 'utf8'),
    readFile(new URL('../demo/scripts/the-missing-silver-bell-caravan.md', import.meta.url), 'utf8'),
    readFile(new URL('../demo/sources/01-avra-character.md', import.meta.url), 'utf8'),
    readFile(new URL('../demo/sources/02-blackwheat-town.md', import.meta.url), 'utf8'),
  ])
  return createPublicDemo({
    workspaceRoot: '/tmp/dsh-tavern-preview/workspace',
    cardDocument: JSON.parse(cardText),
    scriptText,
    characterSource,
    worldSource,
  })
}

test('公开案例初始化四类会话并默认打开剧本案例', async () => {
  const value = await demo()
  assert.deepEqual(value.chats.map((chat) => chat.mode).sort(), ['extract', 'revision', 'script', 'story'])
  assert.equal(value.workspace.sessionIds[0], publicDemoIds.scriptSession)
  assert.equal(value.sessionLogs.length, 4)
  assert.match(value.sessionLogs[0].content, /剧本故事 · 失踪的银铃商队/)
})

test('公开案例覆盖候选项、剧本、Guide、姿势、世界书和素材抽取', async () => {
  const value = await demo()
  const free = value.chats.find((chat) => chat.mode === 'story')
  const script = value.chats.find((chat) => chat.mode === 'script')
  const extract = value.chats.find((chat) => chat.mode === 'extract')
  assert.equal(free.candidates.choices.length, 5)
  assert.equal(script.candidates.choices.length, 1)
  assert.equal(script.guides.length, 3)
  assert.ok(script.posture.length > 0)
  assert.equal(value.script.chunks.length, 6)
  assert.equal(value.card.character_book.entries.length, 6)
  assert.equal(value.sources.length, 2)
  assert.equal(extract.extract.player, '受雇调查银铃商队失踪事件的旅行者')
  assert.equal(extract.extract.draft.name, '阿芙拉')
})
