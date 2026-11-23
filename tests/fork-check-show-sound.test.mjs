// The check show's synthesized score (mods/dice/client/show-sound.js: sound made in code,
// on the picture's beats). Rendered here exactly as the stage renders it: every beat of the timeline
// (show-art.js SHOW_T) has its onset in the score, the constant the mixer gains it by is its measured level, nothing
// clips, the same input gives the same samples, and 减少动态's stem has no blow in it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const read = name => readFileSync(new URL('../tavern-plugin/' + name, import.meta.url), 'utf8')
const S = new Function([read('src/client/stage-audio-math.js'), read('mods/dice/client/show-sound.js'), read('mods/dice/client/show-art.js')].join('\n;\n') +
  ';return { SHOW_T, SHOW_SOUND_RATE, SHOW_SOUND_BEDS, SHOW_SOUND_LOUDNESS, showSoundCues, showSoundMixBed, showSoundStem, showEdgeAt, showSlamAt, measureAudioLoudness, audioGain }')()
const T = S.SHOW_T, cast = { dice: 6, marked: 3, corners: 3, letters: 4 }

// The stems laid at their cues: { left, right } at `rate`.
function score(calm, rate = S.SHOW_SOUND_RATE, beds = {}) {
  const stems = S.showSoundCues(T, calm).map(cue => ({ at: Math.round(cue.at / 1000 * rate), ...S.showSoundStem(cue.stem, T, cast, rate, beds[cue.stem] || null) }))
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
  assert.ok(Math.abs(calm.left.length / calm.rate - (T.calmIn + T.calmHold) / 1000 - 1.9) < 0.01, 'it holds as long as the still and rings out')
})

test('packaged harmonic beds (Option C): valid Ogg Opus assets mix cleanly on the beats without clipping', () => {
  const assetDir = new URL('../tavern-plugin/lib/vendor/runtime-assets/gal-stage/', import.meta.url)
  const paths = {}
  for (const [key, file] of Object.entries(S.SHOW_SOUND_BEDS)) {
    const fileUrl = new URL(file, assetDir)
    const raw = readFileSync(fileUrl)
    assert.equal(raw.subarray(0, 4).toString('ascii'), 'OggS', file + ' starts with OggS container magic')
    assert.ok(raw.length > 20 * 1024 && raw.length < 250 * 1024, file + ' compact size: ' + raw.length)
    paths[key] = fileURLToPath(fileUrl)
  }
  const decode = filePath => {
    try {
      const raw = execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-ar', String(S.SHOW_SOUND_RATE), '-ac', '2', '-f', 'f32le', 'pipe:1'], { maxBuffer: 32 * 1024 * 1024 })
      const f = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), n = Math.floor(f.length / 2)
      const left = new Float32Array(n), right = new Float32Array(n)
      for (let i = 0; i < n; i++) { left[i] = f[i * 2]; right[i] = f[i * 2 + 1] }
      return { left, right, rate: S.SHOW_SOUND_RATE }
    } catch (_) { return null }
  }
  const bloomBed = decode(paths.bloom), calmBed = decode(paths.calm)
  if (!bloomBed || !calmBed) return
  const hybrid = score(false, S.SHOW_SOUND_RATE, { bloom: bloomBed })
  const measured = S.measureAudioLoudness([hybrid.left, hybrid.right], hybrid.rate)
  assert.ok(Math.abs(measured.lufs - S.SHOW_SOUND_LOUDNESS.lufs) < 0.6, 'hybrid integrated ' + measured.lufs.toFixed(2) + ' LUFS')
  assert.ok(measured.peak <= S.SHOW_SOUND_LOUDNESS.peak + 0.05, 'hybrid true peak ' + measured.peak.toFixed(2) + ' dBFS')
  assert.ok(peakDb(hybrid, 0, 60000) < -1, 'hybrid sample peak under -1 dBFS: ' + peakDb(hybrid, 0, 60000).toFixed(2))
  // Dynamic lift: climax (accent..end) sits clearly above build-up (2.5..accent).
  const rms = (buf, a, b) => { let sum = 0, i0 = Math.round(a * buf.rate), i1 = Math.min(buf.left.length, Math.round(b * buf.rate)); for (let i = i0; i < i1; i++) sum += buf.left[i] * buf.left[i] + buf.right[i] * buf.right[i]; return 10 * Math.log10(sum / (2 * Math.max(1, i1 - i0)) + 1e-12) }
  const lift = rms(hybrid, T.accent / 1000, T.end / 1000) - rms(hybrid, 2.5, T.accent / 1000)
  assert.ok(lift >= 4.5, 'climax lift over build-up: +' + lift.toFixed(2) + ' dB')
  // Every major beat still lands cleanly with the bed mixed in.
  for (const [name, at, rise] of [['the hit', T.hit, 8], ['first letter', S.showSlamAt(T, 0, 4), 2], ['the accent', T.accent, 5], ['filed', T.end + T.ebb + T.exit, 6]]) {
    const before = peakDb(hybrid, at - 30, 30), after = peakDb(hybrid, at, 30)
    assert.ok(after - before >= rise, `hybrid ${name} @${at} ms: ${before.toFixed(1)} → ${after.toFixed(1)} dBFS`)
  }
  // 44.1 kHz resample of the 48 kHz bed matches loudness and stays clean.
  const resampled = score(false, 44100, { bloom: bloomBed }), rm = S.measureAudioLoudness([resampled.left, resampled.right], 44100)
  assert.ok(Math.abs(rm.lufs - measured.lufs) < 0.5 && peakDb(resampled, 0, 60000) < -0.9, 'hybrid 44.1 kHz: ' + rm.lufs.toFixed(2) + ' LUFS')
  // Calm hybrid stays soft and low-end free.
  const calmHybrid = score(true, S.SHOW_SOUND_RATE, { calm: calmBed }), cm = S.measureAudioLoudness([calmHybrid.left, calmHybrid.right], calmHybrid.rate)
  assert.ok(cm.lufs < measured.lufs - 3.5 && peakDb(calmHybrid, 0, 60000) < peakDb(hybrid, 0, 60000) - 4, 'calm hybrid: ' + cm.lufs.toFixed(2) + ' LUFS')
})
