import meter from './shared/pcm-loudness.cjs'
const {measurePcmLoudness} = meter

export const VOICE_TARGET_LUFS = -18
export const VOICE_TRUE_PEAK_DBTP = -1.5

export function voiceLoudnessGain(lufs, truePeak) {
  const gainDb = Number.isFinite(lufs) && Number.isFinite(truePeak)
    ? Math.min(VOICE_TARGET_LUFS - lufs, VOICE_TRUE_PEAK_DBTP - truePeak) : 0
  return { version: 1, lufs: Number.isFinite(lufs) ? lufs : null, truePeak: Number.isFinite(truePeak) ? truePeak : null,
    targetLufs: VOICE_TARGET_LUFS, peakCeiling: VOICE_TRUE_PEAK_DBTP, gainDb, gain: 10 ** (gainDb / 20) }
}

// Input is PCM16 WAV already validated at the write boundary. No subprocess or decode.
export function measureVoiceLoudness(bytes) {
  let rate, channels, count = 0
  const chunks = []
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(at + 4), start = at + 8
    const name = bytes.toString('ascii', at, at + 4)
    if (name === 'fmt ') { channels = bytes.readUInt16LE(start + 2); rate = bytes.readUInt32LE(start + 4) }
    if (name === 'data') { chunks.push([start, size]); count += size }
    at = start + size + size % 2
  }
  const pcm = Array.from({length:channels}, () => new Float32Array(count / (channels * 2)))
  let frame = 0
  for (const [start, size] of chunks) for (let at = start; at < start + size; at += channels * 2) {
    for (let c = 0; c < channels; c++) pcm[c][frame] = bytes.readInt16LE(at + c * 2) / 32768
    frame++
  }
  const {lufs, truePeak} = measurePcmLoudness(pcm, rate)
  return voiceLoudnessGain(lufs, truePeak)
}

// Loudness is optional metadata: an analyzer failure must not discard paid audio.
export async function measureVoiceLoudnessSafely(bytes, measure = measureVoiceLoudness) {
  try { return await measure(bytes) } catch { return voiceLoudnessGain(null, null) }
}
