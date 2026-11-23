// Average Hann-windowed power spectra before computing flatness; a single frame
// overstates narrow peaks and makes the result depend on where a loop starts.
function measureAmbienceBrightness(channels, rate) {
  const size = 1024, power = new Float64Array(size / 2 + 1)
  const re = new Float64Array(size), im = new Float64Array(size)
  const window = re.map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size))
  for (const pcm of channels) for (let start = 0; start + size <= Math.min(pcm.length, 60 * rate); start += size) {
    for (let i = 0, j = 0; i < size; i++) {
      re[j] = pcm[start + i] * window[i]; im[j] = 0
      let bit = size >> 1
      while (bit && (j & bit)) { j ^= bit; bit >>= 1 }
      j ^= bit
    }
    for (let span = 2; span <= size; span *= 2) {
      for (let k = 0; k < span / 2; k++) {
        const angle = -2 * Math.PI * k / span, c = Math.cos(angle), s = Math.sin(angle)
        for (let i = k; i < size; i += span) {
          const j = i + span / 2, r = re[j] * c - im[j] * s, q = re[j] * s + im[j] * c
          re[j] = re[i] - r; im[j] = im[i] - q; re[i] += r; im[i] += q
        }
      }
    }
    for (let i = 1; i < power.length; i++) power[i] += re[i] ** 2 + im[i] ** 2
  }
  const total = power.reduce((a, b) => a + b, 0)
  if (!total) return 0
  const band = (lo, hi) => power.slice(Math.ceil(lo * size / rate), Math.ceil(hi * size / rate))
  const high = band(4000, 12000).reduce((a, b) => a + b, 0) / total
  const bins = band(200, 12000).map(p => p / total)
  const mean = bins.reduce((a, b) => a + b, 0) / bins.length
  const flatness = mean ? Math.exp(bins.reduce((a, b) => a + Math.log(Math.max(1e-15, b)), 0) / bins.length) / mean : 0
  return Math.round(Math.min(5, Math.max(0, high - 0.09) * (9 + 5 * flatness)) * 100) / 100
}

if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = { measureAmbienceBrightness };
