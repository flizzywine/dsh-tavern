import assert from 'node:assert/strict'
import test from 'node:test'
import contract from '../tavern-plugin/shared/sprite-emotions.cjs'

const { resolveSpriteEmotion } = contract
const sprites = () => ({ version: 1, kind: 'static-sprites', emotions: { calm: { src: 'emotions/calm/stage.png' } } })

test('with no calm picture either, nothing is resolved', () => {
  const resolved = resolveSpriteEmotion({ version: 1, kind: 'static-sprites', emotions: {} }, 'disgust', ['joy', 'disgust'])
  assert.equal(resolved.state, null)
  assert.equal(resolved.reason, 'missing-sprite')
})
