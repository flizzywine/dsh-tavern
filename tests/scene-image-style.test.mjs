import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSceneImageStyles, applyImageStyle, composeSceneImagePrompt, imageStyleOverride } from "../tavern-plugin/lib/domain/scene-image-style.js"
import { applyImageAdjustment } from '../tavern-plugin/lib/domain/scene-image-adjustment.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scene-style-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  return { root, store, styles: createSceneImageStyles({ store }) }
}
const plan = () => ({ id: 'facts', profile: 'mixed-a', prompt: 'black hair, white coat, sitting indoors', people: [], blocks: [{ id: 'scene', owner: 'scene', field: 'composition', text: '黑发白衣室内坐着', tags: 'black hair, white coat, sitting indoors' }] })

test('changing global style replaces only style; image-local style remains isolated and is convertible', async t => {
  const fx = await fixture(t), original = plan(), frozen = structuredClone(original)
  const watercolor = await fx.styles.resolve({ preset: 'custom', custom: 'watercolor' }, 'mixed-a')
  const styled = applyImageStyle(original, watercolor)
  const adjusted = applyImageAdjustment(styled, { description: '仅这张用胶片', patches: [], style: { text: '胶片', tags: 'film grain' } }, 'mixed-a')
  assert.deepEqual(adjusted.blocks, frozen.blocks)
  assert.deepEqual(original, frozen)
  assert.match(composeSceneImagePrompt(adjusted), /film grain/)
  assert.doesNotMatch(composeSceneImagePrompt(adjusted), /watercolor/)
  assert.match(composeSceneImagePrompt(applyImageStyle(original, watercolor)), /watercolor/)
  const ink = await fx.styles.resolve({ preset: 'custom', custom: 'ink wash' }, 'mixed-a')
  const restyled = applyImageStyle(adjusted, ink)
  assert.deepEqual(restyled.blocks, frozen.blocks)
  assert.equal(restyled.styleOverride, undefined)
  assert.match(composeSceneImagePrompt(restyled), /ink wash/)
  assert.doesNotMatch(composeSceneImagePrompt(restyled), /film grain|watercolor/)
  assert.equal(applyImageStyle(restyled, ink), restyled)
  const switched = applyImageStyle(adjusted, await fx.styles.resolve({ preset: 'custom', custom: 'watercolor' }, 'mixed-b'))
  const patches = switched.blocks.map(({ owner, field, text }) => ({ owner, field, text, tags: 'new scene expression' }))
  assert.throws(() => applyImageAdjustment(switched, { description: '', patches }, 'mixed-b', 'convert'), /临时风格/)
  assert.throws(() => applyImageAdjustment(switched, { description: '', patches, style: { text: '水墨', tags: 'ink' } }, 'mixed-b', 'convert'), /不能改变本图风格/)
  const converted = applyImageAdjustment(switched, { description: '', patches, style: { text: '胶片', tags: 'analog film texture' } }, 'mixed-b', 'convert')
  assert.equal(converted.styleOverride.profile, 'mixed-b')
  assert.match(composeSceneImagePrompt(converted), /analog film texture/)
  assert.throws(() => imageStyleOverride({ text: 'a', tags: '' }, 'mixed-a'), /同时置空/)
})
