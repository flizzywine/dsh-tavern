import assert from 'node:assert/strict'
import test from 'node:test'
import { rebaseCardEdits } from '../tavern-plugin/lib/domain/card-update-merge.js'

const card = data => ({ spec: 'chara_card_v3', data: { name: '卡', ...data } })

test('with the original file, the player edits stay and the author changes elsewhere come in', () => {
  const base = card({ description: 'v1', first_mes: 'hi' })
  const local = card({ description: 'v1', first_mes: 'hi, edited' })
  const incoming = card({ description: 'v2', first_mes: 'hi' })
  const merged = rebaseCardEdits({ base, local, incoming })
  assert.equal(merged.data.description, 'v2')
  assert.equal(merged.data.first_mes, 'hi, edited')
})

// A card with no original file (copied in, made locally, or whose original is gone) cannot tell the player's edits
// apart: counting every value as the player's made the update change nothing while reporting success.
test('without the original file, the update takes the new file and keeps only the extension blocks it lacks', () => {
  const local = card({ description: 'old', extensions: { regex_scripts: [{ id: 'page', replaceString: 'old page' }], local_block: { kept: true } } })
  const incoming = card({ description: 'new', extensions: { regex_scripts: [{ id: 'page', replaceString: 'new page' }] } })
  const merged = rebaseCardEdits({ base: undefined, local, incoming })
  assert.equal(merged.data.description, 'new')
  assert.equal(merged.data.extensions.regex_scripts[0].replaceString, 'new page')
  assert.deepEqual(merged.data.extensions.local_block, { kept: true })
})
