import { spawn } from 'node:child_process'
import { resolveAudioFfmpeg } from '../packages/dsh-asset-library/lib/pack-v2/audio-loudness.js'

const RATE = 24000, MAX_PCM_BYTES = 30 * 1024 * 1024
const isWav = bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'

// A plugin speech provider's audio (mp3, ogg, …) as the 16-bit mono WAV the voice service caches. ffmpeg cannot seek a pipe
// to finish a WAV header, so it writes raw PCM and the header is written here.
export async function speechAudioToWav(data, mediaType) {
  const bytes = Buffer.from(data)
  if (/wav|wave/i.test(mediaType) && isWav(bytes)) return bytes
  const ffmpeg = await resolveAudioFfmpeg()
  if (!ffmpeg) throw Object.assign(new Error('插件返回的配音需要转换格式，请安装 ffmpeg，或请插件作者返回标准 WAV 音频'), { code: 'INVALID_AUDIO' })
  const pcm = await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], { windowsHide: true })
    const chunks = []
    let size = 0, stderr = ''
    child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_PCM_BYTES) child.kill(); else chunks.push(chunk) })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-400) })
    child.on('error', reject)
    child.on('close', code => code === 0 && size <= MAX_PCM_BYTES ? resolve(Buffer.concat(chunks)) : reject(Object.assign(new Error('插件配音的音频无法解码：' + stderr.trim()), { code: 'INVALID_AUDIO' })))
    child.stdin.on('error', () => {})
    child.stdin.end(bytes)
  })
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii'); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
