// 通用声音 (声音页的开关「是否通用」, voice spec field `autoCast`): whether the casting assistant (自动素材) may pick this voice
// for a new figure. A voice from before the switch counts as on when it has a 使用情景 (the only thing that offered it then).
// The one rule: the library's candidate filter (library-search.js) and the voice page both call it.
const voiceAutoCast = voice => voice.autoCast ?? Boolean(voice.guidance)
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {voiceAutoCast};
