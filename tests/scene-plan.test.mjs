import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScenePlans } from '../tavern-plugin/lib/domain/scene-plan.js'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

const field = (text, tags) => ({ text, tags })
const composition = { text: '半身构图', tags: 'medium shot' }
const first = () => ({ description: '林岚在门口', continuity: 'uncertain', subjects: ['lin'], characters: [{ id: 'lin', name: '林岚', fields: { appearance: field('黑发', 'black hair'), clothing: field('白衣', 'white coat'), action: field('站在门口', 'standing') } }], scene: { environment: field('门口', 'doorway'), composition } })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scene-plan-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  let module = createScenePlans({ store })
  const targets = [{ key: 'one', turn: 1 }, { key: 'two', turn: 2 }, { key: 'three', turn: 3 }, { key: 'four', turn: 4 }, { key: 'five', turn: 5 }]
  return { store, get module() { return module }, restart() { module = createScenePlans({ store }) }, async prepare(turn = 1, text = '林岚黑发白衣，站在门口。', extra = {}) {
    return module.prepare({ chatId: 'game', target: targets[turn - 1], lineage: targets.slice(0, turn), sources: [{ id: 'target', turn, text }], profile: 'tags-v1', ...extra })
  } }
}

test('new people get their name as id; a second same-named person gets 名字#2; legacy ids keep working', async t => {
  const fx = await fixture(t)
  const one = await fx.module.commit(await fx.prepare(), first())
  assert.deepEqual(one.subjects, ['林岚'])
  const two = await fx.module.commit(await fx.prepare(2, '另一个林岚出现了。'), { description: '', continuity: 'changed', subjects: ['other'],
    characters: [{ id: 'other', name: '林岚', fields: { appearance: field('红发', 'red hair') } }], scene: { composition } })
  assert.deepEqual(two.subjects, ['林岚'], 'the same name elsewhere in the game is the same person')
  const pair = first()
  pair.characters = [{ id: 'a', name: '小周', fields: { appearance: field('短发', 'short hair') } }, { id: 'b', name: '小周', fields: { appearance: field('长发', 'long hair') } }]
  pair.subjects = ['a', 'b']; pair.scene = { composition }
  assert.deepEqual((await fx.module.commit(await fx.prepare(3, '两个小周。'), pair)).subjects, ['小周', '小周#2'])
})

test('auto style: each plan writes its picture\'s style and is given the previous one; a missing style keeps the previous', async t => {
  const fx = await fixture(t)
  const asked = await fx.prepare(1, undefined, { autoStyle: true, stylePreference: '偏日系' })
  assert.match(asked.input.styleRequest.instruction, /题材/)
  assert.equal(asked.input.styleRequest.previous, undefined)
  assert.equal(asked.input.styleRequest.preference, '偏日系')
  assert.equal((await fx.prepare()).input.styleRequest, undefined, 'not asked when the style is locked')
  assert.equal((await fx.module.commit(asked, first())).artStyle, undefined, 'skipped style leaves the picture unstyled')
  const again = await fx.prepare(2, '林岚挥手。', { autoStyle: true })
  assert.equal(again.input.styleRequest.previous, undefined)
  await assert.rejects(fx.module.commit(again, { ...first(), style: { text: '', tags: '' } }), /不能为空/)
  const painted = await fx.module.commit(again, { ...first(), style: { text: '国风厚涂', tags: 'Chinese xianxia digital painting' } })
  assert.deepEqual(painted.artStyle, { text: '国风厚涂', tags: 'Chinese xianxia digital painting' })
  const later = await fx.prepare(3, '林岚坐下。', { autoStyle: true })
  assert.deepEqual(later.input.styleRequest.previous, painted.artStyle)
  assert.match(later.input.styleRequest.instruction, /连续/)
  assert.deepEqual((await fx.module.commit(later, first())).artStyle, painted.artStyle, 'no style given: the previous one continues')
  const night = await fx.prepare(4, '夜里下雨。', { autoStyle: true })
  assert.equal((await fx.module.commit(night, { ...first(), style: { text: '国风厚涂，冷色雨夜', tags: 'Chinese xianxia digital painting, cold rainy night' } })).artStyle.text, '国风厚涂，冷色雨夜')
  assert.equal((await fx.prepare(5, '天亮了。', { autoStyle: true })).input.styleRequest.previous.text, '国风厚涂，冷色雨夜')
  assert.equal((await fx.prepare(2, '回到前面补一张。', { autoStyle: true })).input.styleRequest.previous.text, '国风厚涂，冷色雨夜', 'the most recent picture, not story order')
})
