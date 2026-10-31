'use strict';
function createStagePosition({React, window, storage:localStorage, setTimeout, clearTimeout, sameAnchor, navigate}) {
const writers = new Set(), bindings = new Set();
let disposed = false;
function ownWriter(sessionId, storage) {
    const writer = galPositionWriter(sessionId,storage,setTimeout,clearTimeout);
    if (disposed) writer.dispose(); else writers.add(writer);
    return writer;
}
// Hash text only: voice readiness and other render metadata must not invalidate a bookmark.
function galTextDigest(parts) {
    const text = parts.map(part => typeof part.text === "string" ? part.text : (part.segments || []).map(segment => segment.text || "").join("\n")).join("\n");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}
// Offsets ignore pagination whitespace (page splitting trims its edges).
function galPositionAnchors(pages) {
    const offsets = new Map();
    return pages.map(function (page) {
        if (page.anchor) return { para: page.anchor.para, offset: page.anchor.offset, length: String(page.text || "").length };
        const offset = offsets.get(page.para) || 0;
        const length = String(page.text || "").replace(/\s/g, "").length;
        offsets.set(page.para, offset + length);
        return { para: page.para, offset, length };
    });
}
function galRestorePosition(saved, turn, pageCount, textDigest, pages = []) {
    const valid = saved && saved.turn === turn && saved.textDigest === textDigest && Number.isInteger(saved.page);
    let page = valid ? Math.max(0, Math.min(saved.page, Math.max(0, pageCount - 1))) : 0;
    const anchors = galPositionAnchors(pages), anchor = valid && saved.anchor;
    const anchored = anchor && Number.isInteger(anchor.para) && Number.isInteger(anchor.offset) && anchor.offset >= 0
        ? anchors.findIndex(item => item.para === anchor.para && item.offset <= anchor.offset && anchor.offset < item.offset + item.length) : -1;
    if (anchored >= 0) page = anchored;
    const target = anchored >= 0 ? anchor : anchors[page];
    return { turn, page, pageCount, textDigest, ...(Number.isInteger(saved && saved.latestSeenTurn) ? { latestSeenTurn: saved.latestSeenTurn } : {}), ...(target ? { anchor: { para: target.para, offset: target.offset } } : {}) };
}
// a cold runtime can publish an empty/unloaded row or a temporary
// text prefix. None of those is permission to consume a durable reading bookmark.
// callers that also restore pass `digestOf` so the turn text is hashed at most once.
function galPositionReady(saved, turn, parts, pages, digestOf = () => galTextDigest(parts)) {
    if (!turn || !parts.length || !pages.length || parts.some(part => part.streaming || part.unloaded) || pages.some(page => page.pending)) return false;
    if (!saved || saved.turn !== turn) return true;
    if (saved.textDigest !== digestOf()) return false;
    if (saved.anchor) return galPositionAnchors(pages).some(item => item.para === saved.anchor.para && item.offset <= saved.anchor.offset && saved.anchor.offset < item.offset + item.length);
    return pages.length >= (saved.pageCount || saved.page + 1);
}
function galPositionWriter(sessionId, storage, schedule, cancel) {
    const key = "fork-stage-position:" + sessionId;
    let saved = null, pending = null, timer = null, closed = false;
    try { saved = JSON.parse(storage && storage.getItem(key) || "null"); } catch (_) {}
    function flush() {
        if (timer !== null) cancel(timer);
        timer = null;
        if (!pending) return;
        try { if (storage && sessionId) storage.setItem(key, JSON.stringify(pending)); } catch (_) {}
        pending = null;
    }
    function discard() { if (timer !== null) cancel(timer); timer = null; pending = null; }
    return { saved, flush, discard,
        dispose() { if (closed) return; flush(); closed = true; },
        write(value) { if (closed) return; pending = value; if (timer === null) timer = schedule(flush, 250); } };
}
function useStagePosition(sessionId, runtime, parts, pages, {restored, onSelect}) {
    const writer = React.useMemo(() => {
        let storage = null;
        try { storage = localStorage; } catch (_) {}
        return ownWriter(sessionId,storage);
    },[sessionId]);
    const lifetime = React.useMemo(() => ({active:false}), [writer]);
    const turn = runtime.source?.turn || 0;
    const page = Math.max(0,pages.findIndex(item => sameAnchor(item.anchor,runtime.cursor.anchor)));
    // the turn's text digest is hashed once per parts array, not on every render.
    const textDigest = React.useMemo(() => galTextDigest(parts), [parts]);
    const anchor = pages[page]?.anchor;
    const active = {turn,page,textDigest,pageCount:pages.length,anchor:anchor ? {para:anchor.para,offset:anchor.offset} : null,latestSeenTurn:runtime.latestSource?.turn || turn};
    // A replay (clip export, a 履历 row's single replay) is not a reading position: the bookmark stays where the reader was.
    const ready = restored && runtime.cursor.mode !== 'replay' && !runtime.text.streaming && galPositionReady(null,turn,parts,pages);
    React.useEffect(() => {
        if (ready) writer.write(active);
        else writer.discard();
    },[writer,turn,page,textDigest,ready,pages.length,active.latestSeenTurn]);
    React.useEffect(() => {
        if (disposed) return;
        writers.add(writer);
        lifetime.active = true;
        window.addEventListener('pagehide',writer.flush);
        const stop = () => {
            lifetime.active = false; bindings.delete(stop); writers.delete(writer);
            try { window.removeEventListener('pagehide',writer.flush); } finally { writer.flush(); }
        };
        bindings.add(stop);
        return stop;
    },[writer]);
    // The shown page is read to its end: the runtime's in-page reading progress (one-shots placed after it).
    return [page,index => {
        if (disposed || !lifetime.active) return;
        onSelect();
        if (index !== page) navigate(sessionId,turn,index,index > page);
    },writer.saved,() => {
        if (disposed || !lifetime.active) return;
        const current = pages[page];
        runtime.store.dispatch({type:'READ_PROGRESS',source:runtime.source,anchor:current?.anchor,readThrough:(current?.anchor.offset || 0) + (current?.text.length || 0)});
    }];
}

return {usePosition:useStagePosition, digest:galTextDigest, anchors:galPositionAnchors, ready:galPositionReady, restore:galRestorePosition, writer:ownWriter, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [], owned = [...writers];
    for (const stop of [...bindings]) { try {stop();} catch (error) {errors.push(error);} }
    for (const writer of owned) { try {writer.dispose();} catch (error) {errors.push(error);} }
    bindings.clear(); writers.clear();
    if (errors.length) throw new AggregateError(errors, 'Stage position cleanup failed');
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStagePosition};
