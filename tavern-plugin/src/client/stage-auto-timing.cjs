// The stage's auto-mode page timing, the one authority for how long a page stays up: the stage's auto mode
// (gal-stage.js galAutoDelay), a clip export's render and the export panel's estimate all use it
//. Shared by the client bundle and the host (clip-export-host.js).

// The reading defaults the waits are measured from (Config → 文字): autoWait = the pause after a line's voice ends,
// autoSpeed scales both waits (1.3x shortens idle dwell without speeding up or cutting off speech).
const STAGE_AUTO = { wait: 700, speed: 1.3 };
// a silent page's reading time scales with its visible characters
// (letters, digits, CJK; a punctuation-only line such as 「……」 counts as one), so 「嗯」 does not wait like a full line:
// clamp(400 + 70 × chars, 800, 10000) ms. From about 18 characters on it is within a few percent of the old
// max(1600, chars × 85); very long pages are capped.
const GAL_AUTO_HOLD = { base: 400, perChar: 70, min: 800, max: 10000 };
function galVisibleChars(text) { return Math.max(1, (String(text || "").match(/[\p{L}\p{N}]/gu) || []).length); }
function galAutoHold(text) { const hold = GAL_AUTO_HOLD; return Math.max(hold.min, Math.min(hold.max, hold.base + hold.perChar * galVisibleChars(text))); }
// Milliseconds auto waits on a page once it is typed: a voiced page's last card waits `wait` after its voice ends; a silent
// page waits its reading time shifted by the reader's wait. wait / speed: the reader's autoWait and autoSpeed.
function stageAutoDelay(wait, speed, voiced, text) {
    if (voiced) return Math.max(0, wait) / speed;
    return Math.max(0, galAutoHold(text) + wait - STAGE_AUTO.wait) / speed;
}

function validateStagePerformanceTiming(definition) {
    // a fixable message names the kind and the field that is missing or malformed.
    const hold=definition.autoHold,regions=definition.regions,where='Performance kind '+JSON.stringify(definition.kind || definition.id || '');
    const fail=(field,message)=>{throw Object.assign(new Error(where+' '+message),{code:'MOD_INVALID',details:{kind:definition.kind,field}});};
    if(hold===undefined)fail('autoHold','is missing "autoHold": declare {"minMs":<nonnegative ms>,"until":"minimum|complete|dismiss"}');
    if(!hold || typeof hold!=='object' || Object.keys(hold).some(key=>!['minMs','until'].includes(key)) || !Number.isFinite(hold.minMs) || hold.minMs<0 || !['minimum','complete','dismiss'].includes(hold.until))
        fail('autoHold','has an invalid "autoHold": use {"minMs":<nonnegative ms>,"until":"minimum|complete|dismiss"}');
    if(regions===undefined)fail('regions','is missing "regions": list the exclusive stage regions it occupies, or [] for none');
    if(!Array.isArray(regions) || regions.some(region=>typeof region!=='string' || !region.trim()) || new Set(regions).size!==regions.length)
        fail('regions','has invalid "regions": use an array of unique nonblank region names, or [] for none');
    return definition;
}
function stagePerformanceRegionsOverlap(left,right) {
    return left.some(region=>right.includes(region) || region==='stage' && right.length>0) || right.includes('stage') && left.length>0;
}

// All page blockers use the same hold shape. Pending preparation, completion or dismissal
// has no deadline yet; finite dwell runs alongside reading, never after it.
function stageAutoRemaining(readingRemainingMs, holds = []) {
    return Math.max(0, readingRemainingMs, ...holds.map(hold => hold.pending ? Infinity : hold.remainingMs || 0));
}

// A clip export reads at the default pace with the whole text at once (no typing time); clip-export-clock.js
// installs it as the export page's reading preference.
const CLIP_READING = { textSpeed: 0, autoWait: STAGE_AUTO.wait, autoSpeed: STAGE_AUTO.speed, voiceRate: 1, frameCap: 60 };
const CLIP_TIMING_FPS = 30;
// One paragraph's frames (30 fps) per card, as the stage's auto mode shows it: pages[page] = its text box cards
// [{ text, voiceAt }], voiceMs = the paragraph's cached voice (0 = silent). The voice plays over the first page: a card that
// is not the last turns at voiceAt (galSubtitleVoiceTime's share of the voice), the last one waits autoWait after the
// voice ends. Every other card waits its reading time. Frames are rounded on the paragraph's running time, so card turns
// stay on the voice; a card gets at least one frame. All callers supply actual stage pager measurements.
// voiceMs may instead list each page's own voice (旁白配音 reads a narration paragraph page by page; 0 = that page silent).
function clipParagraphFrames(pages, voiceMs) {
    const delay = (voiced, card) => stageAutoDelay(CLIP_READING.autoWait, CLIP_READING.autoSpeed, voiced, card.text);
    let ms = 0, at = 0;
    return pages.map((cards, page) => {
        const start = ms, pageMs = Array.isArray(voiceMs) ? voiceMs[page] || 0 : page ? 0 : voiceMs;
        return cards.map((card, index) => {
            const last = index === cards.length - 1;
            ms = !pageMs ? ms + delay(false, card) : last ? start + pageMs + delay(true, card) : start + pageMs * card.voiceAt;
            const end = Math.max(at + 1, Math.round(ms * CLIP_TIMING_FPS / 1000)), frames = end - at;
            at = end;
            return frames;
        });
    });
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {validateStagePerformanceTiming, stagePerformanceRegionsOverlap, stageAutoRemaining, STAGE_AUTO, GAL_AUTO_HOLD, galVisibleChars, galAutoHold, stageAutoDelay, CLIP_READING, CLIP_TIMING_FPS, clipParagraphFrames};
