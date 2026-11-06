import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCache } from '../src/cache.js'
import { measureVoiceLoudness, voiceLoudnessGain } from '../src/loudness.js'
import { pcmWav } from '../src/providers/audio.js'

function tone(amplitude) {
  const pcm = Buffer.alloc(48000 * 2 * 2)
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * 440 * i / 48000)), i * 2)
  return pcmWav(pcm, 48000)
}
test('two levels reach equal integrated loudness with stored gain without rewriting audio', async () => {
  const a = await measureVoiceLoudness(tone(0.08)), b = await measureVoiceLoudness(tone(0.4))
  assert.ok(Math.abs(a.lufs - b.lufs) > 10)
  for (const value of [a, b]) {
    assert.ok(Math.abs(value.lufs + value.gainDb + 18) < 1)
    assert.ok(value.truePeak + value.gainDb <= -1.5)
  }
  assert.ok(Math.abs(a.lufs + a.gainDb - b.lufs - b.gainDb) < 1)
})
test('new cache entries measure once; legacy metadata is not measured on read', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'voice-loudness-'))
  let calls = 0
  const measureLoudness = async () => { calls++; return voiceLoudnessGain(-25, -12) }
  const key = 'a'.repeat(64), audio = tone(0.1)
  try {
    let cache = createCache({dataDir, measureLoudness})
    await cache.put(key, audio, ['test'])
    await Promise.all([cache.loudness(key), cache.loudness(key)])
    assert.equal(calls, 1)
    cache = createCache({dataDir, measureLoudness})
    assert.equal((await cache.loudness(key)).gainDb, 7)
    assert.equal(calls, 1)
    assert.deepEqual(await cache.get(key), audio)
    const manifest = join(dataDir, 'cache', 'audio-v2', key + '.json')
    const entry = JSON.parse(await readFile(manifest, 'utf8')); delete entry.loudness
    await writeFile(manifest, JSON.stringify(entry))
    cache = createCache({dataDir, measureLoudness})
    await Promise.all([cache.loudness(key), cache.loudness(key)])
    assert.equal(calls, 1)
    assert.equal((await cache.loudness(key)).gain, 1)
    assert.equal(JSON.parse(await readFile(manifest, 'utf8')).loudness, undefined)
  } finally { await rm(dataDir, {recursive:true, force:true}) }
})
test('true peak ceiling takes priority over target; silence stays silent', () => {
  assert.equal(voiceLoudnessGain(-30, -2).gainDb, 0.5)
  assert.equal(voiceLoudnessGain(-Infinity, -Infinity).gain, 1)
})
