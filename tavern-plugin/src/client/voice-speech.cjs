// Voice inputs of the stage and the chat (voice.js includes this source; Node tests require it or evaluate it beside their
// stubs): a segment's host speech input and the stage's voice look-ahead window.
// the bound figure owns voice identity; language and text completeness gate speech.
// 通用声音 (config.voice.general): a speaker with no figure (a temporary NPC, name only) or a figure marked general speaks
// the one general voice - its display text at the default mood ({general:true}; the voice opens as {general:true}). Chat
// (voice.js) and stage (speech.cjs) key its clips by the general voice and the line's name.
// 「不配音」 (a figure with no voice that is not general) stays silent.
function segmentSpeechInput(segment, config) {
    const character = bubbleCharacter(config,segment);
    if (speaksGeneral(config,character,segment)) {
        // 配音语言 not 中文: its 配音补译 voice text (segment.speech); a held line waits for it.
        if (segment.kind !== 'bubble' || segment.streaming) return null;
        if (segment.voiceHold === true && voiceBackfillNeeded(segment, lineVoiceLanguage(config,character,segment))) return null;
        const text = segment.speech ?? segment.text;
        return speakableText(text) ? {text, mood:null, general:true} : null;
    }
    return packSpeechInput(segment,config,character,bubbleMood(segment.mood,bubbleMoodList(config,character?.alias)));
}
// native handles keep look-ahead local; no host queue or polling ticker.
function stageVoiceWindow(pages, page, paused) {
    if (paused) return [];
    const limit = pages[page]?.voice && !pages[page].pending ? 8 : 7;
    return pages.slice(page).filter(item => item.voice && !item.pending).slice(0,limit).map(item => item.voice);
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { segmentSpeechInput, stageVoiceWindow };
