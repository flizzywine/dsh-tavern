import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createScenePlans } from '../tavern-plugin/lib/domain/scene-plan.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

const field = (text, tags, quote = text) => ({ text, tags, evidence: [{ source: 'target', quote }] })
const composition = { text: '半身构图', tags: 'medium shot', evidence: [] }
const first = () => ({ description: '林岚在门口', continuity: 'uncertain', subjects: ['lin'], characters: [{ id: 'lin', name: '林岚', identity: { source: 'target', quote: '林岚' }, fields: { appearance: field('黑发', 'black hair'), clothing: field('白衣', 'white coat'), action: field('站在门口', 'standing') } }], scene: { environment: field('门口', 'doorway'), composition } })
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
test('persistent character identity, independent block versions and a complete prompt after action-only delta', async t => {
  const fx = await fixture(t)
  const one = await fx.module.commit(await fx.prepare(), first())
  fx.restart()
  const prepared = await fx.prepare(2, '林岚坐下。')
  const id = one.subjects[0]
  assert.equal(prepared.input.characters[0].id, id)
  assert.equal(prepared.input.characters[0].fields.appearance, '黑发')
  assert.equal(JSON.stringify(prepared.input).includes('black hair'), false, 'unchanged tags are not sent back to the text model')
  const two = await fx.module.commit(prepared, { description: '林岚坐下', continuity: 'continued', subjects: [id], characters: [{ id, fields: { action: field('坐下', 'sitting') } }], scene: { composition } })
  assert.match(two.prompt, /black hair, white coat, sitting/)
  assert.doesNotMatch(two.prompt, /standing/)
  assert.match(two.prompt, /doorway/)
  assert.equal(two.blockIds[0], one.blockIds[0])
  assert.equal(two.blockIds[1], one.blockIds[1])
  assert.equal(two.blockIds[3], one.blockIds[3])
  assert.notEqual(two.blockIds[2], one.blockIds[2])
  assert.equal((await fx.prepare()).saved.id, one.id, 'historical frame is unchanged')
  assert.equal((await fx.prepare(2)).saved.id, two.id)
})
test('field clearing removes old pose; scene change and incomplete continuity do not retain stale dynamic facts', async t => {
  const fx = await fixture(t), one = await fx.module.commit(await fx.prepare(), first()), id = one.subjects[0]
  const prepared = await fx.prepare(2, '林岚停止动作，进入室内。')
  const two = await fx.module.commit(prepared, { description: '进入室内', continuity: 'changed', subjects: [id], characters: [{ id, fields: { action: field('', '', '停止动作') } }], scene: { environment: field('室内', 'indoors'), composition } })
  assert.match(two.prompt, /black hair/)
  assert.doesNotMatch(two.prompt, /standing|white coat|doorway/)
  assert.match(two.prompt, /indoors/)
  await assert.rejects(fx.module.commit(await fx.prepare(3, '她继续走。', { gapComplete: false }), { description: '继续', continuity: 'continued', subjects: [id], characters: [], scene: {} }), /期间剧情有裁剪/)
})
test('same names stay distinct; unavailable identities and quoted evidence are rejected', async t => {
  const fx = await fixture(t), prepared = await fx.prepare(1, '左边林岚黑发，右边林岚红发。')
  const value = first()
  value.characters = [
    { id: 'left', name: '林岚', identity: { source: 'target', quote: '左边林岚' }, fields: { appearance: field('黑发', 'black hair') } },
    { id: 'right', name: '林岚', identity: { source: 'target', quote: '右边林岚' }, fields: { appearance: field('红发', 'red hair') } }
  ]
  value.subjects = ['left', 'right']; value.scene = { composition }
  const frame = await fx.module.commit(prepared, value)
  assert.equal(new Set(frame.subjects).size, 2)
  assert.match(frame.prompt, /林岚: black hair\n林岚: red hair/)
  const next = await fx.prepare(2, '林岚挥手。')
  assert.equal(next.input.characters.length, 2)
  const bad = { description: '', subjects: [frame.subjects[0]], continuity: 'continued', characters: [{ id: frame.subjects[0], fields: { appearance: field('金发', 'blond hair', '不存在的依据') } }], scene: {} }
  await assert.rejects(fx.module.commit(next, bad), /原文不存在/)
  bad.characters = [{ id: 'person-foreign', fields: {} }]
  await assert.rejects(fx.module.commit(next, bad), /不属于/)
  assert.equal((await fx.prepare(2)).saved, undefined, 'no partially valid revision published')
})
test('branches and games do not share future identities; stale parallel commits cannot overwrite a newer revision', async t => {
  const fx = await fixture(t), pending = await fx.prepare()
  const one = await fx.module.commit(pending, first())
  assert.equal((await fx.module.commit(pending, first())).id, one.id, 'identical submission is idempotent')
  const branch = await fx.prepare(2, '林岚挥手。', { lineage: [{ key: 'alternative', turn: 1 }, { key: 'two', turn: 2 }] })
  assert.equal(branch.input.characters.length, 0)
  assert.equal((await fx.prepare(1, '林岚', { chatId: 'other-game' })).input.characters.length, 0)
  const stale = await fx.prepare(2, '林岚坐下。')
  const fresh = await fx.prepare(3, '林岚挥手。')
  await fx.module.commit(fresh, { description: '', continuity: 'continued', subjects: one.subjects, characters: [], scene: { composition } })
  await assert.rejects(fx.module.commit(stale, { description: '', continuity: 'continued', subjects: one.subjects, characters: [], scene: { composition } }), /版本已变化/)
})
test('channel conversion requires only missing expressions and leaves character fact revisions unchanged', async t => {
  const fx = await fixture(t), one = await fx.module.commit(await fx.prepare(), first())
  const prepared = await fx.prepare(1, '林岚黑发白衣，站在门口。', { profile: 'another-profile' })
  assert.equal(prepared.input.characters[0].id, one.subjects[0])
  assert.equal(prepared.input.missingBlocks.length, 4)
  const input = { description: '新表达', continuity: 'continued', subjects: one.subjects, characters: [], scene: { composition } }
  await assert.rejects(fx.module.commit(prepared, input), /缺少当前渠道标签/)
  input.expressions = prepared.input.missingBlocks.map(item => ({ ...item, tags: item.field + ' translated' }))
  const converted = await fx.module.commit(prepared, input)
  assert.deepEqual(converted.characterRefs, one.characterRefs)
  assert.notDeepEqual(converted.blockIds, one.blockIds)
  assert.equal((await fx.prepare()).saved.id, one.id)
})
