// Only lifecycle facts from the live session store escape this adapter. No director
// payload, media lease, text, token, path or mod state is a public playback field.
function createStagePublicPlayback({getStore, isAllowed}) {
    let disposed = false;
    const subscriptions = new Set();
    function read(gameId, expectedStore) {
        if (disposed || !isAllowed(gameId)) return null;
        const store = getStore(gameId);
        if (!store || (expectedStore && expectedStore !== store)) return null;
        const state = store.getSnapshot();
        if (!state || state.disposed || state.source?.sessionId !== gameId) return null;
        const active = state.opened === true && state.visible === true;
        const counts = {pending:0, playing:0, played:0, skipped:0};
        if (active) for (const entry of Object.values(state.ledger || {})) {
            if (['performance-phase', 'mod-performance'].includes(entry?.descriptor?.kind) && Object.hasOwn(counts, entry.status)) counts[entry.status]++;
        }
        return {version:1, turn:Number.isSafeInteger(state.source.turn) ? state.source.turn : null,
            opened:state.opened === true, visible:state.visible === true,
            mode:['live','history','replay'].includes(state.cursor?.mode) ? state.cursor.mode : 'unknown',
            ledger:counts};
    }
    function subscribe(gameId, listener) {
        if (typeof gameId !== 'string' || !gameId || typeof listener !== 'function') throw new TypeError('gameId and listener required');
        if (disposed || !isAllowed(gameId)) { listener(null); return () => {}; }
        const store = getStore(gameId);
        if (!store) { listener(null); return () => {}; }
        let closed = false, last;
        function stop() { if (closed) return; closed = true; off(); subscriptions.delete(update); }
        function update() {
            if (closed) return;
            const next = read(gameId, store), serialized = JSON.stringify(next);
            if (serialized !== last) { last = serialized; try { listener(next); } catch (_) {} }
            if (next === null) stop();
        }
        let off = () => {};
        off = store.subscribe(update);
        if (closed) { off(); return () => {}; }
        subscriptions.add(update);
        try { update(); } catch (error) { stop(); throw error; }
        return stop;
    }
    return {get:gameId => read(gameId), subscribe, revalidate() { for (const update of [...subscriptions]) update(); },
        dispose() { if (disposed) return; disposed = true; for (const update of [...subscriptions]) update(); }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStagePublicPlayback};
