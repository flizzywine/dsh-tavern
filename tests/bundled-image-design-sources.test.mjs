import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'

test('Agent 设计按选择读取卡片、世界书和最近的玩家输入与正文', async t => {
  const reads = [], calls = []
  const tavern = {
    async getTurnState({ gameId }) { reads.push(['state', gameId]); return { turn: 5, settled: true } },
    async getTurn({ gameId, turn }) { reads.push(['turn', gameId, turn]); return { text: '正文' + turn } },
    async getRequestContext({ gameId, turn }) { reads.push(['input', gameId, turn]); return { input: '玩家输入' + turn, sections: [{ text: '不能读取其他提示词段' }] } },
    async getCardContext({ gameId, turn }) { reads.push(['card', gameId, turn]); return { description: '当前卡的设定' } },
    async readCardRaw({ card }) { reads.push(['book', card]); return { character_book: { entries: [
      { comment: '外貌', content: '世界书中的黑发' },
      { comment: '禁用', content: '不应出现的条目', disable: true },
    ] } } },
  }
  const llm = { stream(args) { calls.push(args); return (async function* () {
    yield { type: 'text-delta', text: '<人物>\n中文名称: 林月\n<服装>\n服装名称: 蓝裙\n上衣: blue blouse\n</服装>\n</人物>' }
  })() } }
  const fixture = await imagePluginFixture(t, { tavern, llm })
  const root = join(fixture.root, 'data')
  await mkdir(join(root, 'resources', 'cards'), { recursive: true })
  const entry = name => ({ content: '姓名: ' + name + '\n年龄: 25岁\n性别: 女\n外貌: 黑色长发，蓝色眼睛。' + '外貌清晰可见。'.repeat(22) })
  await writeFile(join(root, 'resources', 'cards', 'story.json'), JSON.stringify({ name: '故事卡',
    character_book: { entries: [entry('林月'), entry('阿岚')] } }))
  await writeFile(join(root, 'index.json'), JSON.stringify({ chats: [
    { id: 'chat-a', sessionId: 'game-a', title: '我的故事', mode: 'story', updatedAt: 2 },
    { id: 'chat-b', sessionId: 'game-b', title: '另一局', mode: 'story', updatedAt: 1 },
  ] }))
  const runtime = await fixture.start()
  const cards = await runtime.request('cards', {})
  assert.deepEqual(cards.body.games.map(game => game.id), ['game-a', 'game-b'])
  const response = await runtime.request('design', { sessionId: 'game-a', current: { name: '林月', traits: {}, outfits: [{ name: '旧衣' }] },
    designType: 'outfit', brief: '', sources: { card: true, worldbook: true, worldbookCard: 'cards/story.json', recentTurns: 2 } })
  assert.equal(response.status, 200)
  assert.equal(response.body.people[0].outfits[0].name, '蓝裙')
  const prompt = calls[0].messages[0].content.find(item => item.type === 'text').text
  assert.match(prompt, /当前卡的设定/)
  assert.match(prompt, /世界书中的黑发/)
  assert.match(prompt, /玩家输入4/)
  assert.match(prompt, /正文5/)
  assert.doesNotMatch(prompt, /玩家输入3|不应出现的条目|不能读取其他提示词段/)
  assert.deepEqual(reads.filter(item => item[0] === 'turn').map(item => item.slice(1)), [['game-a', 4], ['game-a', 5]])
  assert.ok(reads.some(item => item[0] === 'book' && item[1] === 'cards/story.json'))

  reads.length = 0
  const manual = await runtime.request('design', { sessionId: '', brief: '自己的设定', sources: { card: false, worldbook: false, recentTurns: 0 } })
  assert.equal(manual.status, 200)
  assert.deepEqual(reads, [], '未选择的资料不读取')
  const bad = await runtime.request('design', { sessionId: 'game-a', sources: { worldbook: true, worldbookCard: '../other.json' } })
  assert.equal(bad.status, 400)
  const imported = await runtime.request('import-characters', { card: 'cards/story.json', apply: [{ name: '林月', traits: { face: '黑发' } }] })
  assert.equal(imported.status, 200)
  assert.deepEqual(imported.body.state.definitions.characters.map(person => person.name), ['林月'], '确认导入只写入勾选的角色')
})
