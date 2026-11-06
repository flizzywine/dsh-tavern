// Generated from Tavern shared/pcm-loudness.cjs; do not edit.
// BS.1770 channel order: mono; L/R; L/R/C; L/R/Ls/Rs; L/R/C/Ls/Rs;
// L/R/C/LFE/Ls/Rs; L/R/C/LFE/BL/BR/SL/SR. LFE is excluded only from loudness.
function measurePcmLoudness(channels, rate) {
  const layouts = {1:[1],2:[1,1],3:[1,1,1],4:[1,1,1.41,1.41],5:[1,1,1,1.41,1.41],6:[1,1,1,0,1.41,1.41],8:[1,1,1,0,1.41,1.41,1.41,1.41]}
  const weights = layouts[channels.length]
  if (!weights) throw new Error('不支持此音频声道布局，请转换为单声道、立体声或标准环绕声')
// BS.1770 K weighting, with the bilinear transform evaluated at the input rate.
function weighting(rate) {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = 0.7071752369554196
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416
  const a = 1 + k / q + k * k
  const shelf = [(vh + vb * k / q + k * k) / a, 2 * (k * k - vh) / a,
    (vh - vb * k / q + k * k) / a, 2 * (k * k - 1) / a, (1 - k / q + k * k) / a]
  const h = Math.tan(Math.PI * 38.13547087602444 / rate), d = 1 + h / 0.5003270373238773 + h * h
  return [shelf, [1, -2, 1, 2 * (h * h - 1) / d, (1 - h / 0.5003270373238773 + h * h) / d]]
}

// Four-times polyphase interpolation; the integer phase is the original signal.
const phases = [0.25, 0.5, 0.75].map(f => {
  const taps = new Float64Array(24)
  let sum = 0
  for (let j = 0; j < taps.length; j++) {
    const x = j - 11 - f
    taps[j] = Math.sin(Math.PI * x) / (Math.PI * x) * (0.42 + 0.5 * Math.cos(Math.PI * x / 12) + 0.08 * Math.cos(2 * Math.PI * x / 12))
    sum += taps[j]
  }
  return taps.map(v => v / sum)
})

  const frames = channels[0].length, block = Math.round(rate * 0.4), step = Math.round(rate * 0.1)
  const length = Math.max(frames, block), energy = new Float64Array(length)
  const [s, h] = weighting(rate)
  let peak = 0
  for (let channel = 0; channel < channels.length; channel++) {
    const samples = new Float64Array(length + 48)
    samples.set(channels[channel], 24)
    for (const x of channels[channel]) peak = Math.max(peak, Math.abs(x))
    let z1 = 0, z2 = 0, w1 = 0, w2 = 0
    for (let i = 0; i < length; i++) {
      const x = samples[i + 24], y = s[0] * x + z1
      z1 = s[1] * x - s[3] * y + z2; z2 = s[2] * x - s[4] * y
      const v = y + w1
      w1 = -2 * y - h[3] * v + w2; w2 = y - h[4] * v
      energy[i] += weights[channel] * v * v
    }
    for (let i = 12; i < frames + 36; i++) {
      let a = 0, b = 0, c = 0
      for (let j = 0; j < 24; j++) {
        const x = samples[i + j - 11]
        a += x * phases[0][j]; b += x * phases[1][j]; c += x * phases[2][j]
      }
      peak = Math.max(peak, Math.abs(a), Math.abs(b), Math.abs(c))
    }
  }
  let sum = 0
  const blocks = []
  const absolute = 10 ** ((-70 + 0.691) / 10)
  for (let i = 0; i < length; i++) {
    sum += energy[i]
    if (i >= block) sum -= energy[i - block]
    if (i + 1 >= block && (i + 1 - block) % step === 0 && sum / block >= absolute) blocks.push(sum / block)
  }
  const relative = blocks.reduce((a, b) => a + b, 0) / blocks.length / 10
  const gated = blocks.filter(v => v >= relative)
  const lufs = -0.691 + 10 * Math.log10(gated.reduce((a, b) => a + b, 0) / gated.length)
  return {lufs: Number.isFinite(lufs) ? lufs : null, truePeak: peak > 0 ? 20 * Math.log10(peak) : null}
}


if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {measurePcmLoudness}
