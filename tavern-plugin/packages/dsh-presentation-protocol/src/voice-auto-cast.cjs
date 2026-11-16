// 可选声音 (舞台设置 › 自动素材, preset 「默认」): whether the casting assistant (自动素材) may pick this
// voice for a new figure — a voice with a 使用情景 (`guidance`) or 「通用」 in its name. The old per-voice
// `autoCast` switch is no longer read. The one rule: the library's candidate filter (library-search.js) and 自动素材 call it.
const voiceAutoCast = voice => Boolean(voice.guidance) || String(voice.name || '').includes('通用')
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {voiceAutoCast};
