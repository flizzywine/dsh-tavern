import assert from 'node:assert/strict'
import test from 'node:test'
import { scriptChunkLayout } from '../tavern-plugin/lib/domain/script-chunks.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'

function fixture() {
  const source = ('汉'.repeat(100) + '，hello '.repeat(30) + '。\n').repeat(20)
  const script = { title: 'test', ...scriptChunkLayout(source) }
  const scripts = createScriptContinuity()
  const old = { cursor: 5, initialCursor: 0, scriptVersion: 0, recalledChunkIds: ['chunk-00005'], prepared: null, lastReference: null }
  const offset = script.legacyChunkStarts[old.cursor]
  const expected = script.chunkStarts.findLastIndex(start => start <= offset)
  return { script, scripts, old, expected }
}

test('prepared legacy reply preserves its text and next source position; fallback rollback maps old references', () => {
  const {script,scripts,old,expected} = fixture()
  const ref = {chunkId:'chunk-00006',order:5,cursorBefore:5,text:'已开始生成的原参考',userText:'继续',nativeTurn:1}
  const preparing = scripts.transition({script,state:{...old,prepared:ref},event:{kind:'prepare',userText:'继续',nativeTurn:1}})
  assert.equal(preparing.reference.text, ref.text)
  assert.equal(preparing.reference.cursorBefore, expected)
  const next = script.chunkStarts.findLastIndex(start => start <= script.legacyChunkStarts[6])
  assert.equal(scripts.transition({script,state:preparing.state,event:{kind:'commit',userText:'继续',nativeTurn:1}}).state.cursor, next)
  const restored = scripts.transition({script,state:scripts.start(script, 3),event:{kind:'restore',reference:ref}}).state
  assert.equal(restored.cursor, expected)
})
