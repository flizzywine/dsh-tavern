// The check show's synthesized score (mods/dice/client/show-sound.js: sound made in code,
// on the picture's beats). Rendered here exactly as the stage renders it: every beat of the timeline
// (show-art.js SHOW_T) has its onset in the score, the constant the mixer gains it by is its measured level, nothing
// clips, the same input gives the same samples, and 减少动态's stem has no blow in it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = name => readFileSync(new URL('../tavern-plugin/' + name, import.meta.url), 'utf8')
const S = new Function([read('src/client/stage-audio-math.js'), read('mods/dice/client/show-sound.js'), read('mods/dice/client/show-art.js')].join('\n;\n') +
  ';return { SHOW_T, SHOW_SOUND_RATE, SHOW_SOUND_LOUDNESS, showSoundCues, showSoundStem, showEdgeAt, showSlamAt, measureAudioLoudness, audioGain }')()
const T = S.SHOW_T, cast = { dice: 6, marked: 3, corners: 3, letters: 4 }

// The stems laid at their cues: { left, right } at `rate`.
function score(calm, rate = S.SHOW_SOUND_RATE) {
  const stems = S.showSoundCues(T, calm).map(cue => ({ at: Math.round(cue.at / 1000 * rate), ...S.showSoundStem(cue.stem, T, cast, rate) }))
  const length = Math.max(...stems.map(stem => stem.at + stem.left.length)), left = new Float32Array(length), right = new Float32Array(length)
  for (const stem of stems) for (let i = 0; i < stem.left.length; i++) { left[stem.at + i] += stem.left[i]; right[stem.at + i] += stem.right[i] }
  return { left, right, rate }
}
// Peak (dBFS) of both channels over [from, from + ms).
function peakDb({ left, right, rate }, from, ms) {
  let peak = 0
  for (let i = Math.max(0, Math.round(from / 1000 * rate)), end = Math.min(left.length, Math.round((from + ms) / 1000 * rate)); i < end; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  return 20 * Math.log10(peak + 1e-9)
}

const full = score(false)

test('every beat of the picture has its onset in the score', () => {
  // [beat, ms on the show's clock, least rise (dB) of the 30 ms after it over the 30 ms before it]
  const beats = [['the shutter closes', T.irisDur, 4], ['first count', T.count, 20], ['second count', T.count + T.countStep, 3], ['third count', T.count + 2 * T.countStep, 3],
    ['the stamp', T.fill, 12], ['the hit', T.hit, 8], ['first letter', S.showSlamAt(T, 0, 4), 2], ['the accent', T.accent, 5], ['filed', T.end + T.ebb + T.exit, 6]]
  for (const [name, at, rise] of beats) {
    const before = peakDb(full, at - 30, 30), after = peakDb(full, at, 30)
    assert.ok(after - before >= rise, `${name} @${at} ms: ${before.toFixed(1)} → ${after.toFixed(1)} dBFS`)
  }
  // The dice set down: a tick each, louder than the gap before the row.
  for (let i = 0; i < cast.dice; i++) assert.ok(peakDb(full, T.deal + i * T.dealStep, 20) > -30, 'die ' + i)
  // The held beat before the hit: between the stamp ringing out and the breath there is a quiet far under the hit.
  const quiet = Math.min(...Array.from({ length: Math.floor((T.hit - T.fill) / 20) - 2 }, (_, i) => peakDb(full, T.fill + i * 20, 60)))
  assert.ok(quiet < peakDb(full, T.hit, 30) - 14, 'a quiet before the hit: ' + quiet.toFixed(1) + ' vs ' + peakDb(full, T.hit, 30).toFixed(1) + ' dBFS')
  // The accent is the loudest moment of the whole score.
  const accent = peakDb(full, T.accent, 120)
  for (let at = 0; at < T.accent - 100; at += 100) assert.ok(peakDb(full, at, 100) <= accent + 0.01, 'nothing before the accent tops it (' + at + ' ms)')
})

test('the level the mixer is told is the level rendered; nothing clips', () => {
  const measured = S.measureAudioLoudness([full.left, full.right], full.rate)
  assert.ok(Math.abs(measured.lufs - S.SHOW_SOUND_LOUDNESS.lufs) < 0.5, 'integrated ' + measured.lufs.toFixed(2) + ' LUFS')
  assert.ok(measured.peak <= S.SHOW_SOUND_LOUDNESS.peak + 0.05, 'true peak ' + measured.peak.toFixed(2) + ' dBFS within the declared ' + S.SHOW_SOUND_LOUDNESS.peak)
  assert.ok(peakDb(full, 0, 60000) < -1, 'sample peak under -1 dBFS')
  // On the sfx bus it lands at the bus target (stage-audio-math.js), like every other sound effect.
  assert.ok(Math.abs(20 * Math.log10(S.audioGain('sfx', S.SHOW_SOUND_LOUDNESS)) - (-20 - S.SHOW_SOUND_LOUDNESS.lufs)) < 0.01)
  // A device at 44.1 kHz renders the same score.
  const other = score(false, 44100), there = S.measureAudioLoudness([other.left, other.right], 44100)
  assert.ok(Math.abs(there.lufs - measured.lufs) < 0.5 && peakDb(other, 0, 60000) < -0.9, '44.1 kHz: ' + there.lufs.toFixed(2) + ' LUFS, peak ' + peakDb(other, 0, 60000).toFixed(2))
})

test('the same record renders the same samples; the cast changes the score', () => {
  const again = S.showSoundStem('open', T, cast), first = S.showSoundStem('open', T, cast)
  assert.deepEqual(Buffer.from(again.left.buffer), Buffer.from(first.left.buffer))
  // Two marked dice: the same score up to the third count, which is not struck.
  const two = S.showSoundStem('open', T, { ...cast, marked: 2 }), third = Math.round((T.count + 2 * T.countStep) / 1000 * S.SHOW_SOUND_RATE)
  let before = 0, after = 0
  for (let i = 0; i < first.left.length; i++) { const d = Math.abs(first.left[i] - two.left[i]); if (i < third) before = Math.max(before, d); else after = Math.max(after, d) }
  assert.ok(before < 1e-6 && after > 0.05, 'differs only from the third count on: ' + before + ', ' + after)
})

test('减少动态: one soft stem with no blow in it', () => {
  assert.deepEqual(S.showSoundCues(T, true), [{ stem: 'calm', at: 0 }])
  const calm = score(true)
  assert.ok(peakDb(calm, 0, 60000) < peakDb(full, 0, 60000) - 4, 'softer than the full score')
  // No sub drop: far less under 90 Hz than the full score, whose hits live there.
  const low = ({ left, rate }) => { let y = 0, sum = 0; const k = 1 - Math.exp(-2 * Math.PI * 90 / rate); for (let i = 0; i < left.length; i++) { y += k * (left[i] - y); sum += y * y } return 10 * Math.log10(sum / left.length + 1e-12) }
  assert.ok(low(calm) < low(full) - 6, 'no low blow: ' + low(calm).toFixed(1) + ' vs ' + low(full).toFixed(1) + ' dB')
  assert.ok(Math.abs(calm.left.length / calm.rate - (T.calmIn + T.calmHold) / 1000 - 2.4) < 0.01, 'it holds as long as the still and rings out')
})
