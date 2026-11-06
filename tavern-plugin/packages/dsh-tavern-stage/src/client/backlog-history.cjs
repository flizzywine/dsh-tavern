// Stored performance history follows session invalidations; it never changes the session.
function createStageBacklogHistory({React, read, subscribe}) {
    let disposed = false;
    const releases = new Set();
    function watch(sessionId, publish) {
        if (disposed) return () => {};
        let active = true, reading = false, dirty = false;
        async function refresh() {
            if (!active || disposed) return;
            if (reading) { dirty = true; return; }
            reading = true;
            try {
                const value = await read(sessionId);
                if (active && !disposed) publish({turns:value.turns, kinds:value.kinds});
            } catch { /* Preserve the last successful history on read failure. */ }
            finally {
                reading = false;
                if (active && !disposed && dirty) { dirty = false; void refresh(); }
            }
        }
        let stop;
        function release() {
            if (!active) return;
            active = false; releases.delete(release); stop?.();
        }
        releases.add(release);
        try {
            stop = subscribe(sessionId, refresh);
            publish(null);
            void refresh();
        } catch (error) { release(); throw error; }
        return release;
    }
    function useHistory(sessionId) {
        const [history,setHistory] = React.useState(null);
        React.useEffect(() => watch(sessionId,setHistory), [sessionId]);
        return history;
    }
    return {watch, useHistory, dispose() {
        if (disposed) return;
        disposed = true;
        const errors = [];
        for (const release of [...releases]) { try { release(); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Backlog history cleanup failed');
    }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageBacklogHistory};
