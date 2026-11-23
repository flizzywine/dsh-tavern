import test from 'node:test'
import assert from 'node:assert/strict'
import { createTavernConversationRegistry } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

function registry(cardName) {
  const index = { chats: [
    { id: 'a', sessionId: 's-a', cardPath: 'cards/Story.json', cardName: '旧卡名', title: '第一局', mode: 'story', createdAt: 1 },
    { id: 'b', sessionId: 's-b', cardPath: 'cards/Story.json', cardName: '旧卡名', title: '', mode: 'story', createdAt: 2 },
    { id: 'c', sessionId: 's-c', cardPath: 'cards/Gone.json', cardName: '已删除的卡', title: '', mode: 'story', createdAt: 3 }
  ] }
  const store = {
    readLinks: async () => ({ 's-a': 'a', 's-b': 'b', 's-c': 'c' }), updateLinks: async () => {},
    readIndex: async () => structuredClone(index), updateIndex: async () => {},
    readChat: async () => undefined, writeChat: async () => {}, removeChat: async () => {}
  }
  return createTavernConversationRegistry({ store, cardName })
}

test('游玩历史按人物卡当前的名字列出，卡改名或原地更新后立刻跟上', async () => {
  const asked = []
  const rows = await registry(async path => {
    asked.push(path)
    if (path === 'cards/Gone.json') throw Object.assign(Error('missing'), { code: 'ENOENT' })
    return '新卡名'
  }).list()
  const name = id => rows.find(row => row.chatId === id).cardName
  assert.equal(name('a'), '新卡名')
  assert.equal(name('b'), '新卡名')
  // A card that is gone keeps the name saved with its games.
  assert.equal(name('c'), '已删除的卡')
  // One read per card, not per game.
  assert.deepEqual(asked.sort(), ['cards/Gone.json', 'cards/Story.json'])
})
