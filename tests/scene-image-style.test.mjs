import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSceneImageStyles, imageStyleSettings, applyImageStyle, composeSceneImagePrompt, imageStyleOverride } from '../tavern-plugin/lib/domain/scene-image-style.js'
import { applyImageAdjustment } from '../tavern-plugin/lib/domain/scene-image-adjustment.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scene-style-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  return { root, store, styles: createSceneImageStyles({ store }) }
}
const plan = () => ({ id: 'facts', profile: 'mixed-a', prompt: 'black hair, white coat, sitting indoors', people: [], blocks: [{ id: 'scene', owner: 'scene', field: 'composition', text: '黑发白衣室内坐着', tags: 'black hair, white coat, sitting indoors' }] })

test('style settings preserve original text and reject unknown/oversize configuration', () => {
  assert.deepEqual(imageStyleSettings(), { preset: 'auto', custom: '' })
  assert.equal(imageStyleSettings({ preset: 'custom', custom: '  低饱和\n水彩  ' }).custom, '  低饱和\n水彩  ')
  for (const value of [null, [], { preset: 'unknown' }, { custom: 'x'.repeat(2001) }, { preset: 'ink', secret: 'key' }]) assert.throws(() => imageStyleSettings(value))
  assert.deepEqual(imageStyleSettings({ preset: 'watercolor', custom: '低饱和' }), { preset: 'custom', custom: 'watercolor painting, translucent pigments, paper texture, 低饱和' }, 'a retired preset becomes a locked style')
  assert.deepEqual(imageStyleSettings({ preset: 'default' }), { preset: 'auto', custom: '' })
})

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

test('auto uses the picture\'s own written style; a locked style ignores it; an empty lock falls back to auto', async t => {
  const fx = await fixture(t)
  assert.equal((await fx.styles.resolve({ preset: 'auto', custom: '偏日系' }, 'mixed-a')).tags, '', 'the preference guides the Agent, it is not appended')
  const written = await fx.styles.resolve({ preset: 'auto' }, 'mixed-a', { text: '国风', tags: 'Chinese ink illustration' })
  assert.equal(written.tags, 'Chinese ink illustration')
  assert.equal((await fx.styles.resolve({ preset: 'custom', custom: ' film grain ' }, 'mixed-a', { tags: 'ignored' })).tags, 'film grain')
  assert.equal((await fx.styles.resolve({ preset: 'custom', custom: '  ' }, 'mixed-a', { tags: 'written' })).tags, 'written')
})
