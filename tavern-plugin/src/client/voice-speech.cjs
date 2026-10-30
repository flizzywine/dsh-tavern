// Voice inputs of the stage and the chat (voice.js includes this source; Node tests require it or evaluate it beside their
// stubs): a segment's host speech input and the stage's voice look-ahead window.
// the bound figure owns voice identity; language and text completeness gate speech.
function segmentSpeechInput(segment, config) {
    const character = bubbleCharacter(config,segment);
    return packSpeechInput(segment,config,character,bubbleMood(segment.mood,bubbleMoodList(config,character?.alias)));
}
// native handles keep look-ahead local; no host queue or polling ticker.
function stageVoiceWindow(pages, page, paused) {
    if (paused) return [];
    const limit = pages[page]?.voice && !pages[page].pending ? 8 : 7;
    return pages.slice(page).filter(item => item.voice && !item.pending).slice(0,limit).map(item => item.voice);
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { segmentSpeechInput, stageVoiceWindow };
