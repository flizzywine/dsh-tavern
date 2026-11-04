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

  test(`${label}: avatar crop boxes are editable framing metadata, also next to an avatar replacement`, () => {
    const cropped = pack({ avatar: B }); cropped.figures.hero.outfits[0].sprite.avatarCrop = { im001: { x: 0, y: 0, w: .5, h: .5 } }
    assert.doesNotThrow(() => retain(pack(), cropped, new Map(), [], [row()]))
    const cropOnly = pack(); cropOnly.figures.hero.outfits[0].sprite.avatarCropAuto = { im002: { x: .1, y: .1, w: .4, h: .4 } }
    assert.doesNotThrow(() => retain(pack(), cropOnly))
  })

  test(`${label}: a closure rejection names the figure, outfit, image and changed field`, () => {
    assert.throws(() => retain(pack(), pack({ avatar: B })), error => error.code === 'IMMUTABLE_IMAGE'
      && error.path === '$.figures.hero.outfits.school.images.im001.avatar' && /\(avatar\)/.test(error.message))
  })

  test(`${label}: an explicit image removal withdraws an image no pool offers`, () => {
    const retired = () => { const value = pack(); value.figures.hero.outfits[0].sprite.imagePools.calm.imageIds = ['im001']; return value }
    const removed = retired(), outfit = removed.figures.hero.outfits[0]
    delete removed.sprites.school.images.im002; delete outfit.avatars.im002; delete outfit.sprite.assets['joy.png']
    const removal = { figureId: 'hero', outfitKey: 'school', imageId: 'im002' }
    assert.throws(() => retain(retired(), removed), error => error.path === '$.figures.hero.outfits.school.images.im002' && /imageRemovals/.test(error.message))
    assert.doesNotThrow(() => retain(retired(), removed, new Map(), [], [], [removal]))
    // A pooled image is still offered and cannot be withdrawn.
    assert.throws(() => retain(pack(), removed, new Map(), [], [], [removal]), /Only an image in no pool/)
    const leftover = structuredClone(removed); leftover.figures.hero.outfits[0].avatars.im002 = C
    assert.throws(() => retain(retired(), leftover, new Map(), [], [], [removal]), /still has an image, avatar/)
    assert.throws(() => retain(retired(), removed, new Map(), [], [], [{ ...removal, extra: true }]), /Invalid image removal/)
  })
}
