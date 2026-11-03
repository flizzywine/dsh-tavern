import { spawn } from 'node:child_process'

export const VOICE_TARGET_LUFS = -18
export const VOICE_TRUE_PEAK_DBTP = -1.5

export function voiceLoudnessGain(lufs, truePeak) {
  const gainDb = Number.isFinite(lufs) && Number.isFinite(truePeak)
    ? Math.min(VOICE_TARGET_LUFS - lufs, VOICE_TRUE_PEAK_DBTP - truePeak) : 0
  return { version: 1, lufs: Number.isFinite(lufs) ? lufs : null, truePeak: Number.isFinite(truePeak) ? truePeak : null,
    targetLufs: VOICE_TARGET_LUFS, peakCeiling: VOICE_TRUE_PEAK_DBTP, gainDb, gain: 10 ** (gainDb / 20) }
}

// Decode/measure only: stdout is discarded and the cached WAV is never rewritten.
export function measureVoiceLoudness(bytes, { ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-i', 'pipe:0', '-af',
      'apad=whole_dur=0.4,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Voice loudness analysis timed out')) }, 60000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdin.on('error', () => {})
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) { reject(new Error('Voice loudness analysis failed: ' + stderr.slice(-1000))); return }
      try {
        const measurement = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1))
        resolve(voiceLoudnessGain(Number(measurement.input_i), Number(measurement.input_tp)))
      } catch (error) { reject(error) }
    })
    child.stdin.end(bytes)
  })
}
