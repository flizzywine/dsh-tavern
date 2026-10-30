'use strict';

// the kernel owns scheduling/single-flight; this adapter only executes
// read-only IO and projects already admitted direction into runtime events.
const stageDirectorSourceKey = source => JSON.stringify(source);
const stageDirectorCanonical = value => Array.isArray(value) ? '[' + value.map(stageDirectorCanonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort((a,b) => {
        // compare Unicode scalars without allocating arrays per key comparison.
        let i = 0, j = 0;
        while (i < a.length && j < b.length) {
            const x = a.codePointAt(i), y = b.codePointAt(j);
            if (x !== y) return x - y;
            i += x > 65535 ? 2 : 1; j += y > 65535 ? 2 : 1;
        }
        return (a.length - i) - (b.length - j);
    }).map(key => JSON.stringify(key) + ':' + stageDirectorCanonical(value[key])).join(',') + '}' : JSON.stringify(value);
// The submission tool admits direction data. This is projection, not a second
// validation boundary; source switches remain stale responses, not model errors.
async function projectStageDirection(value, source) {
    if (value.unchanged) return null;
    if (!value.token) return {phase:value.phase, revision:value.revision, generation:value.generation, assetRevision:value.assetRevision, error:value.error};
    if (value.target.sessionId !== source.sessionId || value.target.turn !== source.turn) return null;
    const commands = typeof directorCommands !== 'undefined' ? directorCommands : require('../../packages/dsh-presentation-protocol/src/director-commands.cjs');
    const entries = value.entries.map((entry,ordinal) => {
        const ops = entry.ops.map(op => commands.recordOperation(op,value.binding)).filter(Boolean);
        return {...entry, ops, ordinal, events:ops.flatMap((op,ordinal) => op.op === 'event' ? [{...op.value, kind:op.value.op, ordinal}] : [])};
    });
    return {...value, entries};
}

function createStageDirectorSource({read, watch, clock = globalThis, onEffect = () => {}}) {
    const watches = new Map(), timers = new Map(), reads = new Map();
    // admitted completed turns are reusable across back/forward visits.
    // Polls still read the host. A latest-turn wake must not evict old sealed turns.
    const completed = new Map(), signalVersions = new Map();
    function cache(sessionId) {
        if (!completed.has(sessionId)) completed.set(sessionId,new Map());
        return completed.get(sessionId);
    }
    function remember(source, text, envelope) {
        const entries = cache(source.sessionId), key = stageDirectorSourceKey(source);
        entries.delete(key);
        if (!text.streaming && (envelope?.complete && envelope.phase === 'done' || ['off','error','unknown'].includes(envelope?.phase))) {
            entries.set(key,{textKey:stageDirectorCanonical(text.units),envelope});
            while (entries.size > 200) entries.delete(entries.keys().next().value);
        }
        return envelope;
    }
    function runEffect(sessionId, intent, dispatch, getSnapshot) {
        const id = token => JSON.stringify([sessionId,token.id]);
        switch (intent.type) {
        case 'watch-director': {
            const source = intent.source, key = stageDirectorSourceKey(source);
            watches.get(key)?.();
            let subscribing = true;
            watches.set(key,watch(source,signal => {
                if (signal?.kind && signal.version !== undefined) {
                    // Per watched source: the working round stays watched beside an earlier round being read (indicator v2),
                    // and one signal wakes both.
                    const signalKey = JSON.stringify([key,signal.kind]);
                    if (signalVersions.get(signalKey) === signal.version) return;
                    signalVersions.set(signalKey,signal.version);
                }
                // Subscription replay is not a mutation. Poll/wake validates only its source.
                if (!subscribing) {
                    cache(source.sessionId).delete(key);
                    dispatch({type:'DIRECTOR_WAKE',source});
                }
            }));
            subscribing = false;
            break;
        }
        case 'unwatch-director': {
            const key = stageDirectorSourceKey(intent.source);
            watches.get(key)?.(); watches.delete(key); break;
        }
        case 'read-director': {
            const token = intent.token, key = id(token), controller = new AbortController();
            const cacheKey = stageDirectorSourceKey(token.source), text = getSnapshot().text;
            const textKey = stageDirectorCanonical(text.units);
            const entries = cache(sessionId), cached = entries.get(cacheKey);
            if (intent.sinceRevision < 0 && cached && !text.streaming && cached.textKey === textKey) {
                entries.delete(cacheKey); entries.set(cacheKey,cached);
                dispatch({type:'DIRECTOR_READ_RESULT',token,envelope:cached.envelope});
                break;
            }
            reads.set(key,controller);
            Promise.resolve().then(() => read({sessionId,turn:token.source.turn,readOnly:true,sinceRevision:intent.sinceRevision},controller.signal))
                .then(async value => {
                    if (controller.signal.aborted) return;
                    const envelope = await projectStageDirection(value,token.source,getSnapshot().text);
                    if (!controller.signal.aborted) {
                        const before = getSnapshot().director;
                        if (envelope) remember(token.source,text,envelope);
                        else remember(token.source,text,before); // An unchanged wake revalidates the cached snapshot.
                        dispatch({type:'DIRECTOR_READ_RESULT',token,envelope});
                        if (envelope && before.assetRevision !== undefined && envelope.assetRevision !== before.assetRevision &&
                            envelope.token?.digest === before.token?.digest) dispatch({type:'REFRESH_BEGIN',source:token.source});
                    }
                }).catch(error => {
                    if (!controller.signal.aborted) dispatch({type:'DIRECTOR_READ_FAILED',token,error:String(error.message)});
                }).finally(() => {if (reads.get(key) === controller) reads.delete(key);});
            break;
        }
        // the working round's phase while an earlier round is read - the same
        // read-only host read, projected only for its phase; it never touches the page cache or the read round's text.
        case 'read-round': {
            const token = intent.token, key = id(token), controller = new AbortController();
            reads.set(key,controller);
            Promise.resolve().then(() => read({sessionId,turn:token.source.turn,readOnly:true,sinceRevision:intent.sinceRevision},controller.signal))
                .then(value => projectStageDirection(value,token.source))
                .then(envelope => {if (!controller.signal.aborted) dispatch({type:'ROUND_READ_RESULT',token,envelope});})
                .catch(error => {if (!controller.signal.aborted) dispatch({type:'ROUND_READ_FAILED',token,error:String(error.message)});})
                .finally(() => {if (reads.get(key) === controller) reads.delete(key);});
            break;
        }
        case 'cancel-read': reads.get(id(intent.token))?.abort(); reads.delete(id(intent.token)); break;
        case 'schedule-read': {
            const key = id(intent.token);
            timers.set(key,clock.setTimeout(() => {timers.delete(key); dispatch({type:'READ_TIMER',token:intent.token});},intent.delay));
            break;
        }
        case 'cancel-timer': clock.clearTimeout(timers.get(id(intent.token))); timers.delete(id(intent.token)); break;
        default: onEffect(sessionId,intent,dispatch,getSnapshot);
        }
    }
    return {runEffect,
        cached(source, text) {
            const entries = cache(source.sessionId), key = stageDirectorSourceKey(source), entry = entries.get(key);
            if (!entry || text.streaming || entry.textKey !== stageDirectorCanonical(text.units)) return null;
            entries.delete(key); entries.set(key,entry);
            return entry.envelope;
        },
        async prime(source, text, value) {
            const entry = cache(source.sessionId).get(stageDirectorSourceKey(source));
            if (entry?.envelope === value && entry.textKey === stageDirectorCanonical(text.units)) return value;
            return remember(source,text,await projectStageDirection(value,source,text));
        },
        invalidate(sessionId) {completed.delete(sessionId);},
        dispose() {
        for (const stop of watches.values()) stop();
        for (const timer of timers.values()) clock.clearTimeout(timer);
        for (const controller of reads.values()) controller.abort();
        watches.clear(); timers.clear(); reads.clear(); completed.clear(); signalVersions.clear();
    }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageDirectorSource, projectStageDirection};
