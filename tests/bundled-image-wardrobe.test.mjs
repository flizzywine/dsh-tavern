import assert from 'node:assert/strict'
import test from 'node:test'
import { imagePluginFixture } from './fixtures/image-plugin-runtime.mjs'
import { wardrobeSection } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/wardrobe-hints.js'

const outfit = (id, name, extra = {}) => ({ id, name, upper: '浅蓝色衬衫', ...extra })

test('wardrobe prompt prioritizes named outfits within a fixed budget and only includes referenced shared outfits', () => {
  const shared = [outfit('shared', '雨衣'), outfit('unrelated', '别的衣服')]
  const people = [{
    name: '林月', cards: ['cards/a.json'], outfitRefs: ['shared'],
    outfits: [...Array.from({ length: 40 }, (_, i) => outfit(String(i), '常服 ' + i, { upper: '长'.repeat(120) })),
      outfit('private', '私密套装', { nsfw: true }), outfit('off', '停用套装', { enabled: false })],
  }]
  const text = wardrobeSection(people, shared, '她换上了雨衣')
  assert.match(text.split('\n')[1], /林月 · 雨衣/)
  assert.doesNotMatch(text, /私密套装|停用套装|别的衣服/)
  assert.ok(text.length <= 1200)
  assert.ok(text.split('\n').length <= 13)
  assert.match(wardrobeSection(people, shared, '她换上私密套装').split('\n')[1], /私密套装（仅私密场合）/)
})

test('real plugin registers an opt-in per-turn hint and reads only the current card', { timeout: 15000 }, async t => {
  let register, settled, reads = 0
  const installed = new Promise(resolve => { register = resolve })
  const definitions = { characters: [
    { id: 'a', name: '林月', cards: ['cards/a.json'], outfits: [outfit('a', '工作服'), outfit('private', '私密套装', { nsfw: true })] },
    { id: 'b', name: '路人', cards: ['cards/b.json'], outfits: [outfit('b', '夜行衣')] },
    { id: 'player', name: '玩家', note: '玩家', outfits: [outfit('p', '睡衣')] },
  ] }
  const fixture = await imagePluginFixture(t, {
    config: { plannerEnabled: true, characterAutoUpdate: false }, definitions,
    tavern: {
      attach() {}, promptSection() {},
      turnSection({ text }) { register(text) },
      onTurnSettled(callback) { settled = callback },
      getTurn: async ({ gameId, turn }) => {
        reads++
        assert.equal(turn, 1)
        return gameId === 'a' ? { card: { id: 'cards/a.json' } } : null
      },
    },
  })
  const runtime = await fixture.start()
  const hints = await installed
  assert.equal(await hints({ gameId: 'a', turn: 2 }), '')
  assert.equal(reads, 0)
  const set = (patch) => runtime.request('config', { config: patch })
  assert.equal((await set({ wardrobeHints: true })).body.state.config.wardrobeHints, true)
  assert.equal((await fixture.read('config.json')).wardrobeHints, true)
  const first = await hints({ gameId: 'a', turn: 2 })
  assert.match(first, /林月 · 工作服/)
  assert.match(first, /玩家 · 睡衣/)
  assert.doesNotMatch(first, /夜行衣|私密套装/)
  assert.equal(reads, 1)
  assert.equal(await hints({ gameId: 'unknown', turn: 2 }), '')
  assert.match(await hints({ gameId: 'a', turn: 2, input: '换私密套装' }), /私密套装（仅私密场合）/)
  assert.equal((await runtime.request('definitions', { definitions })).body.state.definitions.characters[0].outfits[1].nsfw, true)
  settled({ gameId: 'a', turn: 1, card: { id: 'cards/a.json' } })
  const readCount = reads
  assert.match(await hints({ gameId: 'a', turn: 2 }), /林月 · 工作服/)
  assert.equal(reads, readCount)
  await set({ plannerEnabled: false })
  assert.equal(await hints({ gameId: 'a', turn: 2 }), '')
  assert.equal(reads, readCount)
})
