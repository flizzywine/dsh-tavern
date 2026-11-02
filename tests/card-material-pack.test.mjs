// A card's loose material as one library pack (importCardMaterial) and back as cast material (projectCardMaterial).
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { castVoice, castVoiceFields } from '../tavern-plugin/packages/dsh-presentation-protocol/src/cast-voice.js'
import { png } from './fixtures/asset-packs/pack.mjs'

function wav(seed) {
  const bytes = Buffer.alloc(60)
  bytes.write('RIFF'); bytes.writeUInt32LE(52, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(16, 40)
  bytes.writeUInt32LE(seed, 44)
  return bytes
}

// The figure is 彩叶 (alias Iroha); emotion ids are the card's names, labels Chinese.
const material = (avatar = png([240, 160, 180])) => ({ characters: [{ name: '彩叶', aliases: ['Iroha'], avatar,
  sprites: [{ emotion: 'neutral', label: '平静', bytes: png([120, 180, 120]) }, { emotion: 'joy', label: '开心', bytes: png([250, 200, 80]) }, { emotion: 'sadness', label: '难过', bytes: png([60, 90, 200]) }],
  voiceReferences: [1, 2, 3].map(seed => ({ audio: wav(seed), text: '参考の台詞 ' + seed })), voiceSource: { provider: 'fish', clone: true }, voiceLanguage: 'ja' }],
  backgrounds: [{ name: '教室', bytes: png([200, 200, 210]) }] })

test('card material becomes one pack named after the card; the same material again is that pack; its figures project back', async t => {
  const root = await mkdtemp(join(tmpdir(), 'card-material-'))
  const service = createAssetPackService({ assetRoot: root, voiceChannels: async () => ['fish-audio'] })
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  const first = await service.importCardMaterial({ name: 'Iroha', material: material() })
  assert.deepEqual([first.status, first.notices], ['installed', []])
  assert.deepEqual(await service.importCardMaterial({ name: 'Iroha', material: material() }), { ...first, status: 'noop' })
  assert.notEqual((await service.importCardMaterial({ name: 'Iroha', material: material(png([1, 2, 3])) })).packId, first.packId, 'other material is another pack')

  const projected = await service.projectCardMaterial({ packIds: [first.packId] })
  const [character] = projected.characters
  assert.deepEqual([character.name, character.aliases, Object.keys(character.sprites), character.voiceLanguage, character.voiceSource],
    ['彩叶', ['Iroha'], ['neutral', 'joy', 'sadness'], 'ja', { provider: 'fish', clone: true }])
  assert.deepEqual(await projected.read(character.avatar), png([240, 160, 180]))
  assert.deepEqual(await Promise.all(character.references.map(clip => projected.read(clip.file))), [1, 2, 3].map(wav))
  assert.deepEqual(projected.backgrounds.map(row => row.name), ['教室'])
})

test('cast voice fields and a library voice map both ways through one mapping', () => {
  const references = [{ media: 'a'.repeat(64), text: 'ひとこと' }]
  const matched = castVoice({ name: 'Voice owner', references, voiceSource: { provider: 'openai' }, voiceLanguage: 'ja', voices: { openai: 'alloy' } }, ['openai-compatible'], 'voice-a')
  assert.equal(matched.dropped, '')
  assert.deepEqual(matched.voice.sources[matched.voice.defaultSource], { kind: 'preset', provider: 'openai-compatible', voiceName: 'alloy' })
  assert.deepEqual(castVoiceFields(matched.voice, matched.binding), { references, voiceLanguage: 'ja', voiceSource: { provider: 'openai' }, voices: { openai: 'alloy' } })
  const clipsOnly = castVoice({ name: 'Voice owner', references, voiceSource: { provider: 'fish', clone: true } }, [], 'voice-b')
  assert.deepEqual([clipsOnly.dropped, clipsOnly.voice.language, clipsOnly.voice.sources.fish.references.length], ['fish', 'zh', 1], 'an unmatched source keeps the clips')
  const unmatched = castVoice({ name: 'Voice owner', references: [], voiceSource: { provider: 'minimax' }, voices: { minimax: 'x' } }, ['fish-audio'], 'voice-c')
  assert.deepEqual([unmatched.voice, unmatched.dropped], [null, 'minimax'])
})
