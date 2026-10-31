// Backlog replay composes published host voice handles; the shared player remains host-owned.
function createStageBacklogVoice({player, wake}) {
    let disposed = false, generation = 0;
    const subscriptions = new Set();
    function cancel() {
        generation++;
        const errors = [];
        for (const off of [...subscriptions]) { try { off(); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Backlog replay cleanup failed');
    }
    function voice(handle, current) {
        if (!handle) return null;
        return {...handle, player:current || null, click(event) {
            event?.stopPropagation?.();
            if (disposed) return;
            wake?.();
            return handle.click();
        }};
    }
    function narration(handles) {
        if (handles.length < 2) return handles[0] || null;
        const id = JSON.stringify(handles.map(handle => handle.id));
        return {...handles[0], id, click() {
            if (disposed) return;
            cancel();
            const ticket = generation;
            let index = 0;
            const live = () => !disposed && ticket === generation;
            async function next() {
                const handle = handles[index++];
                if (!handle || !live()) return;
                let played;
                try { played = await handle.click({id}); } catch { return; }
                if (!live()) return;
                const current = player.get(), audio = played && current?.id === id && current.audio;
                if (!audio) return;
                let active = true;
                const unsubscribe = player.subscribe(() => {
                    if (!active || !live()) return;
                    const current = player.get();
                    if (current?.id === id && current.audio === audio) return;
                    off();
                    if (!current && audio.ended) void next();
                });
                function off() { if (!active) return; active = false; subscriptions.delete(off); unsubscribe(); }
                subscriptions.add(off);
            }
            return next();
        }};
    }
    return {voice, narration, cancel, dispose() { if (disposed) return; disposed = true; cancel(); }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageBacklogVoice};
