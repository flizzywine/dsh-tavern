// The transcript bubbles' outfits (bubbles.js BubbleRow): per round, each figure's stage outfit by display unit, read
// from the host (getTranscriptOutfits, lib/domain/transcript-outfits.js) when the round's first staged bubble mounts.
// The session's stage-direction signal (a director run or update) re-reads the rounds already read; the signal
// replayed while subscribing is the state those reads already have.
// A host without transcript bubbles (stage-only pages, harnesses) passes no transport; nothing subscribes there.
function createStageTranscriptOutfits({rpc, signals} = {}) {
    const rounds = new Map(), watched = new Map(), listeners = new Set(), subscribers = new Map();
    const id = (sessionId, turn) => JSON.stringify([sessionId, turn]);
    function read(sessionId, turn) {
        const key = id(sessionId, turn), entry = {sessionId, turn, spans:rounds.get(key)?.spans || null};
        rounds.set(key, entry);
        rpc('getTranscriptOutfits', {turn}, sessionId).then(value => {
            if (rounds.get(key) !== entry) return;
            entry.spans = value.spans;
            for (const listener of [...listeners]) listener();
        }, () => {});
    }
    function watch(sessionId) {
        if (watched.has(sessionId)) return;
        let replay = true;
        watched.set(sessionId, signals.subscribe(sessionId, 'stage-direction', signal => {
            if (replay) return;
            const turn = Number(signal?.turn);
            for (const entry of [...rounds.values()]) if (entry.sessionId === sessionId && (!Number.isFinite(turn) || entry.turn === turn)) read(sessionId, entry.turn);
        }));
        replay = false;
    }
    return {
        // A stable subscribe per round, for React.useSyncExternalStore.
        subscribe(sessionId, turn) {
            const key = id(sessionId, turn);
            if (!subscribers.has(key)) subscribers.set(key, listener => {
                if (!rounds.has(key)) { watch(sessionId); read(sessionId, turn); }
                listeners.add(listener);
                return () => listeners.delete(listener);
            });
            return subscribers.get(key);
        },
        // The outfit key at unit `para` (the last span at or before it); null: the opening outfit.
        outfit(sessionId, turn, para, ref) {
            let outfit = null;
            for (const span of rounds.get(id(sessionId, turn))?.spans || []) {
                if (span.at > para) break;
                outfit = span.outfits[ref.packId + '/' + ref.figureId] || null;
            }
            return outfit;
        },
        dispose() {
            for (const stop of watched.values()) stop();
            watched.clear(); rounds.clear(); listeners.clear(); subscribers.clear();
        }
    };
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageTranscriptOutfits};
