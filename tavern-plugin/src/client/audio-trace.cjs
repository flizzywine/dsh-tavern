// DEV DIAGNOSTICS — live-only. Strip or reduce before a public build; never
// part of an upstream PR. Player UI never shows it.
//
// The audio trace: one compact record each time any sound starts, stops, fails or changes. The shared mixer
// (forkStageAudio, stage-audio.js) is the single hook point — BGM, ambience layers, stage SE, UI/skin cues, phone
// tones, voice, call audio and previews all bind through it. Records keep a ring of the last 500 in memory and flush in
// batches to the host log (RPC recordAudioTrace → desktop/logs/audio-trace.jsonl). No text, no secrets: URLs keep their
// path only, with sensitive query values redacted.

const AUDIO_TRACE_LIMIT = 500;
const AUDIO_TRACE_SECRET = /^(?:token|ticket|lease|sig|signature|key|api[_-]?key|auth|authorization|secret|credential|password|access[_-]?token|session)$/i;
// A media URL as evidence: blob/data kinds are named, http(s)/relative URLs keep origin-less path and non-secret query.
function audioTraceUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    if (value.startsWith('data:')) return 'data:' + (value.slice(5).split(/[;,]/)[0] || '').slice(0, 40);
    if (value.startsWith('blob:')) return 'blob:' + value.slice(-12);
    let parsed;
    try { parsed = new URL(value, 'http://trace.invalid'); } catch (_) { return '[invalid-url]'; }
    const query = [...parsed.searchParams].map(([key, item]) => key + '=' + (AUDIO_TRACE_SECRET.test(key) ? '[redacted]' : item.slice(0, 40)));
    return (parsed.pathname.slice(-160) + (query.length ? '?' + query.join('&') : '')).slice(0, 240);
}
const audioTraceText = (value, max = 80) => typeof value === 'string' && value ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : undefined;
const audioTraceNumber = (value, places = 2) => Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : undefined;
// The record shape (pure; tests/fork-audio-trace.test.mjs). input: {event, layer, url, content, lufs, trackDb, trim, duck,
// duration, position, preview, error, meta:{reason, ref:{packId,kind,assetId}, label, token, turn, para}}; context: the stage
// position {chatId, sessionId, turn, para, page, mode, audible}. position: the media time of an element source (a start at
// position > 0 resumes where it paused; a restart starts at 0). audible:false: the sound policy (foreground.js) has the
// app silent, so a stop then is its focus pause. Undefined fields are dropped so a record stays one short JSON line.
function audioTraceRecord(input, context = {}, now = Date.now(), seq = 0) {
    const meta = input.meta || {}, ref = meta.ref || {};
    const record = {
        v: 1, seq, at: new Date(now).toISOString(), event: audioTraceText(input.event, 24), layer: audioTraceText(input.layer, 24),
        reason: audioTraceText(meta.reason, 48), preview: input.preview ? true : undefined,
        chatId: audioTraceText(context.chatId, 120), sessionId: audioTraceText(context.sessionId, 120),
        turn: Number.isSafeInteger(meta.turn) ? meta.turn : Number.isSafeInteger(context.turn) ? context.turn : undefined,
        para: Number.isSafeInteger(meta.para) ? meta.para : Number.isSafeInteger(context.para) ? context.para : undefined,
        page: Number.isSafeInteger(context.page) ? context.page : undefined, mode: audioTraceText(context.mode, 16),
        packId: audioTraceText(ref.packId, 64), kind: audioTraceText(ref.kind, 24), entryId: audioTraceText(ref.assetId, 120),
        label: audioTraceText(meta.label), op: audioTraceText(meta.token, 200),
        media: audioTraceText(input.content, 64), url: audioTraceUrl(input.url) || undefined,
        duration: audioTraceNumber(input.duration), position: audioTraceNumber(input.position), audible: context.audible === false ? false : undefined, lufs: audioTraceNumber(input.lufs), trackDb: audioTraceNumber(input.trackDb),
        trim: audioTraceNumber(input.trim, 3), duck: audioTraceNumber(input.duck, 3), error: audioTraceText(input.error, 120)
    };
    for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
    return record;
}
// The trace owner: ring + batched flush. deps: {send(events) → Promise, context() → position, now(), schedule, cancel}.
function createAudioTrace(deps = {}) {
    const ring = [], queue = [], limit = deps.limit || AUDIO_TRACE_LIMIT;
    const now = deps.now || (() => Date.now());
    const schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms)), cancel = deps.cancel || (id => clearTimeout(id));
    let seq = 0, timer = null, sending = false, lastCue = null;
    function flush() {
        if (timer !== null) { cancel(timer); timer = null; }
        if (sending || !queue.length || !deps.send) return;
        const events = queue.splice(0, 64);
        sending = true;
        Promise.resolve().then(() => deps.send(events)).catch(() => {}).finally(() => { sending = false; if (queue.length) timer = schedule(flush, 2000); });
    }
    function record(input) {
        // Rapid UI cues (the typewriter tick, hover moves) keep one row per cue per second.
        if (input.layer === 'ui') {
            const key = (input.meta?.label || '') + '|' + (input.url || ''), at = now();
            if (lastCue && lastCue.key === key && at - lastCue.at < 1000) return null;
            lastCue = { key, at };
        }
        let context = {};
        try { context = deps.context ? deps.context() || {} : {}; } catch (_) {}
        const row = audioTraceRecord(input, context, now(), ++seq);
        ring.push(row); if (ring.length > limit) ring.splice(0, ring.length - limit);
        // Unsent rows beyond the bound are dropped; the ring still has them.
        if (deps.send && queue.length < 256) { queue.push(row); if (queue.length >= 32) flush(); else if (timer === null) timer = schedule(flush, 2000); }
        return row;
    }
    // Plain array reads only: read-only diagnostics calls this under V8's side-effect check.
    return { record, flush, events: (count = 50) => ring.slice(-Math.max(1, Math.min(limit, count))) };
}
// Where the reader is: the selected session's stage source turn, paragraph and page (history / replay / live).
function audioTraceContext() {
    const sessionId = window.__dshTavernSelectedSessionId || null;
    const audible = typeof forkForeground === 'undefined' ? undefined : forkForeground.isAudible();
    if (!sessionId) return { audible };
    const state = typeof stageSessions === 'object' ? stageSessions.get(sessionId)?.getSnapshot() : null;
    const view = typeof liveTavernView === 'object' ? liveTavernView.getSnapshot(sessionId)?.view : null;
    const anchor = state?.cursor?.anchor, pages = state?.text?.pages || [];
    const page = anchor ? pages.findIndex(row => row.anchor?.paragraphId === anchor.paragraphId && row.anchor?.offset === anchor.offset) : -1;
    return { chatId: view?.chatId, sessionId, turn: state?.source?.turn, para: anchor?.para, page: page >= 0 ? page : undefined,
        mode: state?.replay?.phase ? 'replay' : state?.cursor?.mode, audible };
}
const audioTrace = typeof window === 'undefined' ? null : createAudioTrace({
    context: audioTraceContext
});
if (audioTrace) window.forkAudioTraceEvents = count => audioTrace.events(count);
if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports = { audioTraceRecord, audioTraceUrl, createAudioTrace, AUDIO_TRACE_LIMIT };
