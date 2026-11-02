// Same 512-sample voiced-frame gate and peak-limited gain as serve.py.
export function pcmWav(pcm, sampleRate = 24000) {
  if (pcm.length % 2) throw new Error('PCM 音频长度无效')
  const head = Buffer.alloc(44)
  head.write('RIFF'); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(sampleRate, 24); head.writeUInt32LE(sampleRate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34)
  head.write('data', 36); head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, pcm])
}
export function normalizeWav(input) {
  const wav = Buffer.from(input)
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('语音服务未返回 WAV 音频')
  const end = wav.readUInt32LE(4) + 8
  if (end > wav.length) throw new Error('WAV 音频不完整')
  let format, data
  for (let pos = 12; pos + 8 <= end;) {
    const size = wav.readUInt32LE(pos + 4), start = pos + 8, id = wav.toString('ascii', pos, pos + 4)
    if (start + size > end) throw new Error('WAV 音频不完整')
    if (id === 'fmt ' && size >= 16) format = { code: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), bits: wav.readUInt16LE(start + 14) }
    if (id === 'data') data = { start, size }
    pos = start + size + size % 2
  }
  if (!format || format.code !== 1 || format.bits !== 16 || format.channels !== 1 || !data || data.size % 2) throw new Error('语音服务必须返回单声道 PCM16 WAV')
  const count = data.size / 2, usable = Math.floor(count / 512) * 512
  if (!usable) return wav
  const samples = new Float32Array(count), energies = []
  let peak = 0, sum = 0
  for (let i = 0; i < count; i++) { samples[i] = wav.readInt16LE(data.start + i * 2) / 32768; peak = Math.max(peak, Math.abs(samples[i])); if (i < usable) { sum += samples[i] ** 2; if (i % 512 === 511) { energies.push(Math.sqrt(sum / 512)); sum = 0 } } }
  const gate = Math.max(...energies) * 0.1, voiced = energies.filter(e => e > gate)
  const rms = voiced.length ? Math.sqrt(voiced.reduce((s, e) => s + e * e, 0) / voiced.length) : Math.sqrt(samples.reduce((s, e) => s + e * e, 0) / count)
  if (rms <= 1e-6 || peak <= 1e-6) return wav
  const gain = Math.min(0.1 / rms, 10 ** (-1 / 20) / peak)
  for (let i = 0; i < count; i++) wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(Math.fround(samples[i] * gain) * 32768))), data.start + i * 2)
  return wav
}
