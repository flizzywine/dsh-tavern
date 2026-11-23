// Generated from dsh-presentation-protocol by build.mjs; do not edit.
// 通用声音: the voices any figure may speak with, read from the data only (never from names or fixed ids):
// - a voice with a 使用情景 (`guidance`: what kind of person it suits; every voice of the 通用角色 archetypes has one);
// - every voice of a pack 通用声音 or 旁白 points at (tts.reading's figures: the system voices, `systemPacks`).
// The old per-voice `autoCast` switch is not read. The one rule and the one order: the casting assistant picks only from
// these (library-search.js), 舞台设置 › 自动素材's 「可选声音」 lists them, and every 选择声音 list shows them first.
const voiceAutoCast = (voice, packId, systemPacks = []) => Boolean(voice.guidance) || systemPacks.includes(packId)
// The language a voice speaks, as its primary subtag ('zh', 'ja', 'en'): the voice spec's own `language`, unset = 中文. The
// one reading of a voice's language for 自动素材 (a speaker is cast only with voices of the language it speaks) and for
// every 选择声音 list. Also normalizes a speaker's language tag the same way.
const castLanguage = language => String(language || '').trim().split('-')[0].toLowerCase() || 'zh'
// The packs 通用声音 / 旁白 point at, from tts.reading() ({general, narrator}: {figure: {packId, figureId} | null}).
const readingPackIds = reading => [...new Set([reading?.general?.figure?.packId, reading?.narrator?.figure?.packId].filter(Boolean))]
// Their order: by name, then by pack name (rows {name, packName}), in code points so server and client agree.
const castVoiceOrder = (a, b) => {
  for (const key of ['name', 'packName']) {
    const x = [...String(a[key] || '')], y = [...String(b[key] || '')]
    for (let i = 0; i < Math.min(x.length, y.length); i++) { const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d }
    if (x.length !== y.length) return x.length - y.length
  }
  return 0
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {voiceAutoCast, castLanguage, readingPackIds, castVoiceOrder};
