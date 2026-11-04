// An avatar is a derived crop of a published pool image: an explicit avatarReplacements row may re-cut it in place,
// while the image, its resources and every other avatar stay immutable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { retainPublishedStateImages } from '../src/pack-v2/state-images.js'
import { retainPublishedStateImages as builtRetain } from '../lib/pack-v2/state-images.js'

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), ART = 'd'.repeat(64), ART2 = 'e'.repeat(64)
function pack({ avatar = A, art = ART } = {}) {
  return {
    manifest: { schemaVersion: 2 },
    sprites: { school: { version: 2, kind: 'static-sprites', images: { im001: { src: 'calm.png' }, im002: { src: 'joy.png' } } } },
    figures: { hero: { outfits: [{ key: 'school', avatars: { im001: avatar, im002: C },
      sprite: { manifestKey: 'school', assets: { 'calm.png': art, 'joy.png': ART2 }, imagePools: { calm: { defaultImageId: 'im001', imageIds: ['im001', 'im002'] } } } }] } },
  }
}
const row = (expectedAvatar = A, imageId = 'im001') => ({ figureId: 'hero', outfitKey: 'school', imageId, expectedAvatar })
const code = expected => error => error.code === expected

for (const [label, retain] of [['src', retainPublishedStateImages], ['lib', builtRetain]]) {
  test(`${label}: a declared avatar replacement re-cuts one pool image avatar in place`, () => {
    const before = pack(), after = pack({ avatar: B })
    assert.throws(() => retain(before, after), code('IMMUTABLE_IMAGE'), 'without a declaration the avatar is part of the published image')
    assert.doesNotThrow(() => retain(before, after, new Map(), [], [row()]))
    // A replay finds the new avatar already published.
    assert.doesNotThrow(() => retain(pack({ avatar: B }), after, new Map(), [], [row()]))
  })

  test(`${label}: an avatar replacement leaves the image and other avatars immutable`, () => {
    assert.throws(() => retain(pack(), pack({ avatar: B, art: B }), new Map(), [], [row()]), code('IMMUTABLE_IMAGE'))
    const other = pack({ avatar: B }); other.figures.hero.outfits[0].avatars.im002 = A
    assert.throws(() => retain(pack(), other, new Map(), [], [row()]), code('IMMUTABLE_IMAGE'))
  })

  test(`${label}: avatar replacement declarations are checked against the published pack`, () => {
    const before = pack(), after = pack({ avatar: B })
    assert.throws(() => retain(before, after, new Map(), [], [row(C)]), code('REVISION_CONFLICT'), 'the avatar changed concurrently')
    assert.throws(() => retain(before, after, new Map(), [], [row(A, 'im009')]), code('REVISION_CONFLICT'), 'not a published pool image')
    assert.throws(() => retain(before, pack(), new Map(), [], [row()]), /Declared avatar replacement is missing/)
    assert.throws(() => retain(before, after, new Map(), [], [row(), row()]), /Duplicate avatar replacement/)
    assert.throws(() => retain(before, after, new Map(), [], [{ ...row(), extra: true }]), /Invalid avatar replacement/)
    assert.throws(() => retain(before, after, new Map(), [], {}), /Expected an array/)
  })
}
