import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSceneImageStyles, imageStyleSettings, applyImageStyle, composeSceneImagePrompt, imageStyleOverride, gameStylePending } from '../tavern-plugin/lib/domain/scene-image-style.js'
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
})

test('changing global style replaces only style; image-local style remains isolated and is convertible', async t => {
  const fx = await fixture(t), original = plan(), frozen = structuredClone(original)
  const watercolor = await fx.styles.resolve({ preset: 'watercolor' }, 'mixed-a')
  const styled = applyImageStyle(original, watercolor)
  const adjusted = applyImageAdjustment(styled, { description: '仅这张用胶片', patches: [], style: { text: '胶片', tags: 'film grain' } }, 'mixed-a')
  assert.deepEqual(adjusted.blocks, frozen.blocks)
  assert.deepEqual(original, frozen)
  assert.match(composeSceneImagePrompt(adjusted), /film grain/)
  assert.doesNotMatch(composeSceneImagePrompt(adjusted), /watercolor/)
  assert.match(composeSceneImagePrompt(applyImageStyle(original, watercolor)), /watercolor/)
  const ink = await fx.styles.resolve({ preset: 'ink' }, 'mixed-a')
  const restyled = applyImageStyle(adjusted, ink)
  assert.deepEqual(restyled.blocks, frozen.blocks)
  assert.equal(restyled.styleOverride, undefined)
  assert.match(composeSceneImagePrompt(restyled), /ink wash/)
  assert.doesNotMatch(composeSceneImagePrompt(restyled), /film grain|watercolor/)
  assert.equal(applyImageStyle(restyled, ink), restyled)
  const switched = applyImageStyle(adjusted, await fx.styles.resolve({ preset: 'watercolor' }, 'mixed-b'))
  const patches = switched.blocks.map(({ owner, field, text }) => ({ owner, field, text, tags: 'new scene expression' }))
  assert.throws(() => applyImageAdjustment(switched, { description: '', patches }, 'mixed-b', 'convert'), /临时风格/)
  assert.throws(() => applyImageAdjustment(switched, { description: '', patches, style: { text: '水墨', tags: 'ink' } }, 'mixed-b', 'convert'), /不能改变本图风格/)
  const converted = applyImageAdjustment(switched, { description: '', patches, style: { text: '胶片', tags: 'analog film texture' } }, 'mixed-b', 'convert')
  assert.equal(converted.styleOverride.profile, 'mixed-b')
  assert.match(composeSceneImagePrompt(converted), /analog film texture/)
  assert.throws(() => imageStyleOverride({ text: 'a', tags: '' }, 'mixed-a'), /同时置空/)
})

test('auto preset is unstyled until the game has a style, then uses it with the custom supplement', async t => {
  const fx = await fixture(t)
  const pending = await fx.styles.resolve({ preset: 'auto', custom: '低饱和' }, 'mixed-a')
  assert.equal(gameStylePending(pending), true)
  assert.equal(pending.tags, '低饱和')
  const decided = await fx.styles.resolve({ preset: 'auto', custom: '低饱和' }, 'mixed-a', { text: '国风', tags: 'Chinese ink illustration' })
  assert.equal(gameStylePending(decided), false)
  assert.equal(decided.tags, 'Chinese ink illustration, 低饱和')
  assert.notEqual(decided.id, pending.id)
  assert.equal(gameStylePending(await fx.styles.resolve({ preset: 'watercolor' }, 'mixed-a', { tags: 'ignored' })), false)
  assert.doesNotMatch((await fx.styles.resolve({ preset: 'watercolor' }, 'mixed-a', { tags: 'ignored' })).tags, /ignored/)
})
