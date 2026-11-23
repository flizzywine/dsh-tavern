import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCardOpenings } from '../tavern-plugin/lib/domain/card-opening-scenes.js'

const scene = { greeting: '0123456789abcdef', background: null, timeOfDay: null, music: null, cast: [] }

test('a greeting scene may carry a short author-written title', () => {
  validateCardOpenings({ scenes: { primary: { ...scene, title: '竹取之夜' } } })
  validateCardOpenings({ scenes: { primary: scene } })
  for (const title of ['', ' 竹取之夜', '一二三四五六七八九十一二三', 7]) {
    assert.throws(() => validateCardOpenings({ scenes: { primary: { ...scene, title } } }), { path: '$.openings.scenes.primary.title' })
  }
})
