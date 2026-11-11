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

// and a one-sentence summary of what the opening is about (an opening page tells the player by it)
test('a greeting scene may carry a one-sentence summary', () => {
  validateCardOpenings({ scenes: { primary: { ...scene, summary: '露娜第一次登入虚拟城，一落地就撞上了你' } } })
  for (const summary of ['', ' 前后有空格 ', '长'.repeat(61), 3]) {
    assert.throws(() => validateCardOpenings({ scenes: { primary: { ...scene, summary } } }), { path: '$.openings.scenes.primary.summary' })
  }
})
