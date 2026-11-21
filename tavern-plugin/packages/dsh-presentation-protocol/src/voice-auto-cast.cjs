// 通用声音: a voice with a 使用情景 (`guidance`) or 「通用」 in its name, wherever it is installed. The old per-voice
// `autoCast` switch is no longer read. The one rule and the one order: the casting assistant picks only from these
// (library-search.js), 舞台设置 › 自动素材's 「可选声音」 lists them, and every 选择声音 list shows them first.
const voiceAutoCast = voice => Boolean(voice.guidance) || String(voice.name || '').includes('通用')
// Their order: by name, then by pack name (rows {name, packName}), in code points so server and client agree.
const castVoiceOrder = (a, b) => {
  for (const key of ['name', 'packName']) {
    const x = [...String(a[key] || '')], y = [...String(b[key] || '')]
    for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d }
    if (x.length !== y.length) return x.length - y.length
  }
  return 0
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {voiceAutoCast, castVoiceOrder};
