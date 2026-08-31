import assert from 'node:assert/strict'
import test from 'node:test'
import { applyImageAdjustment, imageAdjustmentInput, legacyImagePlan } from '../tavern-plugin/lib/domain/scene-image-adjustment.js'

const base = { id: 'original', profile: 'tags-a', description: '雨中人物', people: [{ id: 'p1', name: '林岚' }], blocks: [
  { id: 'hair', owner: 'p1', field: 'appearance', text: '黑色短发', tags: 'short black hair' },
  { id: 'coat', owner: 'p1', field: 'clothing', text: '白外套', tags: 'white coat' },
  { id: 'rain', owner: 'scene', field: 'environment', text: '雨夜', tags: 'rainy night' }
] }
const update = patches => ({ description: '调整后的画面', patches })

test('image-local changes replace/clear blocks without mutating the source plan', () => {
  const frozen = structuredClone(base)
  const result = applyImageAdjustment(base, update([
    { owner: 'p1', field: 'clothing', text: '红外套', tags: 'red coat' },
    { owner: 'scene', field: 'environment', text: '', tags: '' }
  ]), base.profile)
  assert.deepEqual(base, frozen)
  assert.equal(result.blocks[0].id, 'hair')
  assert.equal(result.basedOn, base.id)
  assert.equal(result.imageOnly, true)
  assert.equal(result.prompt, '林岚: short black hair, red coat')
  const input = imageAdjustmentInput(base, '改为红衣', base.profile)
  assert.deepEqual(Object.keys(input).sort(), ['baseProfile', 'blocks', 'description', 'instruction', 'mode', 'people', 'profile'])
  assert.equal(input.instruction, '改为红衣')
})

test('conversion covers every nonempty block and cannot alter facts or invent owners', () => {
  const patches = base.blocks.map(({ owner, field, text, tags }) => ({ owner, field, text, tags: tags + ', converted' }))
  const converted = applyImageAdjustment(base, update(patches), 'tags-b', 'convert')
  assert.equal(converted.profile, 'tags-b')
  assert.deepEqual(converted.blocks.map(block => block.text), base.blocks.map(block => block.text))
  assert.throws(() => applyImageAdjustment(base, update(patches.slice(1)), 'tags-b', 'convert'), /缺少/)
  assert.throws(() => applyImageAdjustment(base, update(patches.slice(1)), 'tags-b'), /混用旧表达/)
  assert.throws(() => applyImageAdjustment(base, update([{ ...patches[0], text: '金发' }]), 'tags-b', 'convert'), /不能改变/)
  assert.throws(() => applyImageAdjustment(base, update([{ ...patches[0], owner: 'stranger' }]), 'tags-a'), /不属于/)
  assert.throws(() => applyImageAdjustment(base, update([patches[0], patches[0]]), 'tags-a'), /只能修改一次/)
  assert.throws(() => applyImageAdjustment(base, update([{ ...patches[0], tags: '' }]), 'tags-a'), /同时清除/)
})

test('legacy saved prompts can be converted without truncating their facts', () => {
  const legacy = legacyImagePlan({ prompt: 'long scene '.repeat(150) }, 'old')
  const block = legacy.blocks[0]
  const result = applyImageAdjustment(legacy, update([{ ...block, tags: 'converted complete scene' }]), 'new', 'convert')
  assert.equal(result.blocks[0].text, legacy.prompt)
  assert.equal(result.prompt, 'converted complete scene')
})
