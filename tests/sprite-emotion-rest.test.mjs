import assert from 'node:assert/strict'
import test from 'node:test'
import contract from '../tavern-plugin/shared/sprite-emotions.cjs'

const { resolveSpriteEmotion } = contract
const sprites = () => ({ version: 1, kind: 'static-sprites', emotions: { calm: { src: 'emotions/calm/stage.png' } } })

// An outfit whose default emotion (first in the order) has no image still rests at its calm picture, not the avatar.
test('a missing requested emotion and a missing outfit default rest at calm', () => {
  const resolved = resolveSpriteEmotion(sprites(), 'disgust', ['joy', 'calm', 'disgust'])
  assert.equal(resolved.resolvedEmotion, 'calm')
  assert.equal(resolved.missing, true)
  assert.equal(resolved.reason, 'missing-emotion')
})

test('the outfit default still comes before calm when it has an image', () => {
  const manifest = { ...sprites(), emotions: { ...sprites().emotions, joy: { src: 'emotions/joy/stage.png' } } }
  assert.equal(resolveSpriteEmotion(manifest, 'disgust', ['joy', 'calm', 'disgust']).resolvedEmotion, 'joy')
})

test('with no calm picture either, nothing is resolved', () => {
  const resolved = resolveSpriteEmotion({ version: 1, kind: 'static-sprites', emotions: {} }, 'disgust', ['joy', 'disgust'])
  assert.equal(resolved.state, null)
  assert.equal(resolved.reason, 'missing-sprite')
})
