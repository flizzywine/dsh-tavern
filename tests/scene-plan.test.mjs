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
  const targets = [{ key: 'one', turn: 1 }, { key: 'two', turn: 2 }, { key: 'three', turn: 3 }]
  return { store, get module() { return module }, restart() { module = createScenePlans({ store }) }, async prepare(turn = 1, text = '林岚黑发白衣，站在门口。', extra = {}) {
    return module.prepare({ chatId: 'game', target: targets[turn - 1], lineage: targets.slice(0, turn), sources: [{ id: 'target', turn, text }], profile: 'tags-v1', ...extra })
  } }
}

test('field clearing removes old pose; scene change and incomplete continuity do not retain stale dynamic facts', async t => {
  const fx = await fixture(t), one = await fx.module.commit(await fx.prepare(), first()), id = one.subjects[0]
  const prepared = await fx.prepare(2, '林岚停止动作，进入室内。')
  const two = await fx.module.commit(prepared, { description: '进入室内', continuity: 'changed', subjects: [id], characters: [{ id, fields: { action: field('', '', '停止动作') } }], scene: { environment: field('室内', 'indoors'), composition } })
  assert.match(two.prompt, /black hair/)
  assert.doesNotMatch(two.prompt, /standing|white coat|doorway/)
  assert.match(two.prompt, /indoors/)
  await assert.rejects(fx.module.commit(await fx.prepare(3, '她继续走。', { gapComplete: false }), { description: '继续', continuity: 'continued', subjects: [id], characters: [], scene: {} }), /期间剧情有裁剪/)
})
test('same names stay distinct without citations; unknown identities and invalid fields are rejected', async t => {
  const fx = await fixture(t), prepared = await fx.prepare(1, '左边林岚黑发，右边林岚红发。')
  const value = first()
  value.characters = [
    { id: 'left', name: '林岚', fields: { appearance: field('黑发', 'black hair') } },
    { id: 'right', name: '林岚', fields: { appearance: field('红发', 'red hair') } }
  ]
  value.subjects = ['left', 'right']; value.scene = { composition }
  const frame = await fx.module.commit(prepared, value)
  assert.equal(new Set(frame.subjects).size, 2)
  assert.match(frame.prompt, /林岚: black hair\n林岚: red hair/)
  const next = await fx.prepare(2, '林岚挥手。')
  assert.equal(next.input.characters.length, 2)
  const bad = { description: '', subjects: [frame.subjects[0]], continuity: 'continued', characters: [{ id: frame.subjects[0], fields: { appearance: field('金发', '') } }], scene: {} }
  await assert.rejects(fx.module.commit(next, bad), /同时为空或非空/)
  bad.characters = [{ id: 'person-foreign', fields: {} }]
  await assert.rejects(fx.module.commit(next, bad), /不属于/)
  assert.equal((await fx.prepare(2)).saved, undefined, 'no partially valid revision published')
})

test('branches share identity and appearance but not state; games stay separate; stale parallel commits cannot overwrite a newer revision', async t => {
  const fx = await fixture(t), pending = await fx.prepare()
  const one = await fx.module.commit(pending, first())
  assert.equal((await fx.module.commit(pending, first())).id, one.id, 'identical submission is idempotent')
  const branch = await fx.prepare(2, '林岚挥手。', { lineage: [{ key: 'alternative', turn: 1 }, { key: 'two', turn: 2 }] })
  assert.deepEqual(branch.input.characters, [{ id: one.subjects[0], name: '林岚', fields: { appearance: '黑发' } }])
  assert.equal((await fx.prepare(1, '林岚', { chatId: 'other-game' })).input.characters.length, 0)
  const stale = await fx.prepare(2, '林岚坐下。')
  const fresh = await fx.prepare(3, '林岚挥手。')
  await fx.module.commit(fresh, { description: '', continuity: 'continued', subjects: one.subjects, characters: [], scene: { composition } })
  await assert.rejects(fx.module.commit(stale, { description: '', continuity: 'continued', subjects: one.subjects, characters: [], scene: { composition } }), /版本已变化/)
})

test('a picture records its moment, orientation and own negative tags; an earlier moment is reported to the next picture', async t => {
  const fx = await fixture(t)
  const one = await fx.module.commit(await fx.prepare(), { ...first(), moment: 'earlier', orientation: 'portrait', negative: 'extra person, hat' })
  assert.equal(one.moment, 'earlier')
  assert.equal(one.orientation, 'portrait')
  assert.equal(one.negative, 'extra person, hat')
  assert.equal((await fx.prepare(2, '林岚离开。')).previousMoment, 'earlier')
  // Defaults keep the stored frame identical to earlier versions.
  const fx2 = await fixture(t)
  const plain = await fx2.module.commit(await fx2.prepare(), first())
  assert.ok(!('moment' in plain) && !('orientation' in plain) && !('negative' in plain))
  assert.equal((await fx2.prepare(2, '林岚离开。')).previousMoment, 'end')
  await assert.rejects(fx2.module.commit(await fx2.prepare(2, 'x'), { ...first(), moment: 'middle' }), /moment/)
  await assert.rejects(fx2.module.commit(await fx2.prepare(2, 'x'), { ...first(), orientation: 'wide' }), /orientation/)
})

test('插图位置：方案里的原话在正文中找到才保留，找不到就忽略、图片仍放在末尾', async t => {
  const fx = await fixture(t)
  const text = '雨夜，林岚推开门。\n\n她站在门口，黑发白衣。'
  const kept = await fx.module.commit(await fx.prepare(1, text), { ...first(), anchor: '林岚推开门。' })
  assert.equal(kept.anchor, '林岚推开门。')
  const dropped = await fx.module.commit(await fx.prepare(2, text), { ...first(), continuity: 'changed', subjects: [kept.subjects[0]], characters: [], anchor: '正文里没有这句' })
  assert.equal(dropped.anchor, undefined)
  await assert.rejects(fx.module.commit(await fx.prepare(3, text), { ...first(), anchor: 'x'.repeat(201) }), /anchor/)
})

test('an earlier turn drawn after a later one keeps the same person id, without the later state', async t => {
  const fx = await fixture(t)
  const later = await fx.module.commit(await fx.prepare(3), first())
  const earlier = await fx.prepare(1, '她推门进来。')
  assert.equal(earlier.input.characters.length, 0, 'not mentioned: the archive is not sent')
  const value = first()
  value.characters = [{ id: 'linlan', name: '林岚', fields: { action: field('推门', 'opening door') } }]
  value.subjects = ['linlan']
  const frame = await fx.module.commit(earlier, value)
  assert.deepEqual(frame.subjects, later.subjects)
  assert.match(frame.prompt, /black hair/)
  assert.doesNotMatch(frame.prompt, /white coat|standing/)
  const next = await fx.prepare(2, '林岚坐下。')
  assert.deepEqual(next.input.characters.map(person => person.id), later.subjects)
})

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

test('shot leads the prompt: composition, then people, then environment', async t => {
  const fx = await fixture(t)
  const frame = await fx.module.commit(await fx.prepare(), { ...first(), scene: { environment: field('门口', 'doorway'), composition: field('低机位仰拍近景', 'low angle close-up') } })
  assert.match(frame.prompt, /^low angle close-up\n林岚: [^\n]+\ndoorway$/)
})

test("auto style: the first plan fixes the game's style once; a missing style never blocks the picture", async t => {
  const fx = await fixture(t)
  const asked = await fx.prepare(1, undefined, { autoStyle: true })
  assert.match(asked.input.styleRequest.instruction, /style/)
  assert.equal((await fx.prepare()).input.styleRequest, undefined, 'not asked unless the auto preset is active')
  await fx.module.commit(asked, first())
  assert.equal(await fx.module.gameStyle('game'), null, 'skipped style leaves the game undecided')
  const again = await fx.prepare(2, '林岚挥手。', { autoStyle: true })
  await assert.rejects(fx.module.commit(again, { ...first(), style: { text: '', tags: '' } }), /不能为空/)
  await fx.module.commit(again, { ...first(), style: { text: '国风厚涂', tags: 'Chinese xianxia digital painting, thick brushwork' } })
  assert.deepEqual(await fx.module.gameStyle('game'), { text: '国风厚涂', tags: 'Chinese xianxia digital painting, thick brushwork' })
  const later = await fx.prepare(3, '林岚坐下。', { autoStyle: true })
  assert.equal(later.input.styleRequest, undefined)
  await fx.module.commit(later, { ...first(), style: { text: '水彩', tags: 'watercolor' } })
  assert.equal((await fx.module.gameStyle('game')).text, '国风厚涂', 'a decided style is never replaced by a later plan')
})
