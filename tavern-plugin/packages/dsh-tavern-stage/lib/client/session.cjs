'use strict';

function createStageSessionModule(stageSessionStore) {
// the stage's failure notice belongs to one attempt, the latest native turn.
// Its own end says so (the chat's turn-error node for a turn that ended in error, an interrupted reply for a stopped one);
// a retry or regeneration is a newer turn and replaces it, a cleared failure (withdrawn) is a suppressed turn. The host
// session's lastAgentError is not read: it is session-wide and outlives the attempt that set it (a host-side replay never
// clears it). Returns null, {turn, error: null} (stopped) or {turn, error} (failed).
function stageAttemptFailure(chat, view) {
    const turnOf = node => Number(node.kind === 'turn-error' ? node.data?.turn : node.location?.turn?.turn) || 0;
    let turn = 0;
    for (const node of chat.nodes.values()) turn = Math.max(turn, turnOf(node));
    if (!turn || (view?.suppressedDshTurns || []).map(Number).includes(turn)) return null;
    let stopped = null;
    for (const node of chat.nodes.values()) {
        if (turnOf(node) !== turn) continue;
        if (node.kind === 'turn-error') return {turn, error: String(node.data.message || node.data.code || 'error')};
        if (node.kind === 'assistant-step' && node.data.status === 'interrupted') stopped = {turn, error: null};
    }
    return stopped;
}

// lifetime follows native bindings, never the transcript or stage mount.
function createStageSessionOwner(options) {
    const records = new Map();
    let stopList = null, disposed = false;
    function sourceFor(record, turn, row) {
        return record.sources.get(turn)?.source || {...record.store.getSnapshot().latestSource,turn,
            sourceKey:JSON.stringify([record.id,turn,row.nativeTurn]),generation:1};
    }
    async function hydrate(record, turn, valid) {
        const row = record.index.getSnapshot().get(turn);
        if (!row || !options.readHistory) return null;
        let pending = record.historyReads.get(turn);
        if (!pending || pending.row !== row) {
            pending = {row,promise:(async () => options.readHistory({sessionId:record.id,turn,readOnly:true},sourceFor(record,turn,row),row.text))()};
            record.historyReads.set(turn,pending);
        }
        try {
            const value = await pending.promise;
            if (!valid() || record.index.getSnapshot().get(turn) !== row) return null;
            const hydrated = row.unloaded ? record.index.ingest(turn,value?.body) : row;
            if (!hydrated) return null;
            const source = sourceFor(record,turn,hydrated);
            const envelope = await options.primeHistory?.(source,hydrated.text,value);
            if (!valid()) return null;
            if (row.unloaded) record.reconcile();
            return {source,envelope,row:hydrated};
        } finally {if (record.historyReads.get(turn) === pending) record.historyReads.delete(turn);}
    }
    function prefetch(record, turn) {
        const row = record.index.getSnapshot().get(turn);
        if (!row || row.text.streaming || !options.prefetchHistory || record.prefetches.get(turn)?.row === row) return;
        const epoch = record.epoch, branch = record.branch, binding = record.binding;
        const valid = () => record.active && record.epoch === epoch && record.branch === branch && record.binding === binding;
        const entry = {row}; record.prefetches.delete(turn); record.prefetches.set(turn,entry);
        while (record.prefetches.size > 200) record.prefetches.delete(record.prefetches.keys().next().value);
        entry.promise = hydrate(record,turn,valid).then(async result => {
            if (!result || !valid()) {if (record.prefetches.get(turn) === entry) record.prefetches.delete(turn); return;}
            entry.row = result.row;
            await options.prefetchHistory(result.source,result.envelope);
        }).catch(() => {if (record.prefetches.get(turn) === entry) record.prefetches.delete(turn);});
    }
    // an undirected turn's baseline is the nearest earlier complete direction's end
    // (host predecessor rule). Read-only history reads, bounded like the widget history window.
    async function resolveCarry(record, token, dispatch) {
        const epoch = record.epoch, branch = record.branch, binding = record.binding;
        const valid = () => record.active && record.epoch === epoch && record.branch === branch && record.binding === binding && record.store.getSnapshot().source === token.source;
        const turns = [...record.index.getSnapshot().keys()].filter(turn => turn < token.source.turn).sort((a,b) => b-a).slice(0,20);
        let carry = null;
        try {
            for (const turn of turns) {
                const value = await hydrate(record,turn,valid);
                if (!valid()) return;
                if (value?.envelope?.complete && value.envelope.token) { carry = {source:value.source,envelope:value.envelope}; break; }
            }
        } catch (_) { carry = null; } // An unreadable predecessor keeps the current presentation.
        if (valid()) dispatch({type:'CARRY_RESULT',token,carry});
    }
    function release(record) {
        record.active = false;
        record.stopBinding();
        for (const stop of record.stops) stop();
        record.store.dispose();
        record.index.clear();
        options.invalidateHistory?.(record.id);
        records.delete(record.id);
    }
    function create(id) {
        const store = stageSessionStore.createStageRuntimeStore({observe:(event,previous,state)=>options.observe?.(id,event,previous,state),runEffect: (intent, dispatch, getSnapshot) => {
            if (intent.type === 'resolve-carry') { if (options.readHistory) void resolveCarry(record,intent.token,dispatch); }
            else options.runEffect?.(id, intent, dispatch, getSnapshot);
        }});
        if (options.opened === false) store.dispatch({type:'STAGE_OPEN',opened:false});
        if (options.visible) store.dispatch({type: 'VISIBILITY', visible: options.visible()});
        const record = {id, store, index: options.createIndex(), active: true, stops: [], binding: null,
            stopBinding: () => {}, reconciling: false, dirty: false, sources: new Map(), epoch: 0, branch: 0,
            widgetUi:{state:null,refs:new Map()}, widgetHistory:null, historyReads:new Map(), prefetches:new Map(), authority: null, context: null, lastTurns: [], lastNativeTurn: 0, lastRunning: false, promptError: null, rejectedSend: null, settingsKey: '', prefsKey: '', revision: 0};
        records.set(id, record);
        const viewSource = options.views.select(id, options.viewPaths);
        function reconcile() {
            if (!record.active) return;
            if (record.reconciling) {record.dirty = true; return;}
            record.reconciling = true;
            try {
                do {
                    record.dirty = false;
                    if (!record.binding) continue;
                    const session = record.binding.session.getSnapshot();
                    const chat = record.chat.getSnapshot();
                    record.watchNodes(chat);
                    const view = viewSource.getSnapshot().view;
                    const coordination = options.coordination.getSnapshot(id).view;
                    const settings = options.settings.get(id);
                    if (!settings) options.settings.load(id);
                    const prefs = options.preferences.get();
                    const authority = JSON.stringify([view?.chatId || '', view?.card?.path || coordination?.cardPath || '', coordination?.runtimeGeneration || '']);
                    if (record.authority !== null && record.authority !== authority) {record.epoch++; record.widgetUi.state=null; record.widgetUi.refs.clear(); record.widgetHistory=null; record.sources.clear(); record.index.clear(); record.prefetches.clear(); options.invalidateHistory?.(id);}
                    record.authority = authority;
                    // historyWindow.revision is a storage/cache revision (including
                    // playback metadata), not a branch reset. The text index invalidates its rows.
                    const context = JSON.stringify([view?.chatId || '', view?.tavernHelper?.lifecycleRevision || 0,
                        (view?.suppressedDshTurns || []).filter(turn => !Object.values(view?.regeneratedDshTurns || {}).includes(turn))]);
                    if (record.context !== null && record.context !== context) {record.branch++; record.widgetHistory=null; record.widgetUi.refs.clear(); record.sources.clear(); record.prefetches.clear(); options.invalidateHistory?.(id);}
                    record.context = context;
                    let branchId = JSON.stringify([view?.chatId || id, record.branch]);
                    let turns = record.index.reconcile({chat, view, branchId});
                    const ordered = [...turns.keys()].sort((a, b) => a - b);
                    const latestNativeTurn = turns.get(ordered.at(-1))?.nativeTurn || 0;
                    if (latestNativeTurn < record.lastNativeTurn && (ordered.at(-1) || 0) < (record.lastTurns.at(-1) || 0)) {
                        record.branch++; record.sources.clear();
                        branchId = JSON.stringify([view?.chatId || id, record.branch]);
                        turns = record.index.reconcile({chat, view, branchId});
                    }
                    const settingsKey = JSON.stringify(settings), prefsKey = JSON.stringify(prefs);
                    const inputs = {textIndex: turns};
                    if (settingsKey !== record.settingsKey) {record.settingsKey = settingsKey; inputs.settings = settings; record.prefetches.clear(); options.invalidatePresentation?.(id);}
                    if (prefsKey !== record.prefsKey) {record.prefsKey = prefsKey; inputs.preferences = prefs;}
                    store.dispatch({type: 'SESSION_INPUTS', ...inputs});
                    if (Object.hasOwn(inputs,'settings')) store.dispatch({type:'RECONCILE',source:store.getSnapshot().source});
                    let latest = ordered.at(-1);
                    const running = session.running === true;
                    // A user turn with no assistant text still gives SEND a concrete native identity.
                    if (running) for (const node of chat.nodes.values()) {
                        if (node.kind === 'user') latest = Math.max(latest || 0, options.storyTurn(view, Number(node.location?.turn?.turn) || 0));
                    }
                    const current = store.getSnapshot();
                    if (!running && (record.lastRunning || current.interrupted) && current.latestSource?.branchId === branchId && current.latestSource.turn > (latest || 0)) latest = current.latestSource.turn;
                    if (latest !== undefined) {
                        const row = turns.get(latest);
                        const nativeTurn = row?.nativeTurn || Number(view?.regeneratedDshTurns?.[latest]) || latest;
                        let sourceRecord = record.sources.get(latest);
                        const signature = JSON.stringify([nativeTurn, row?.parts.filter(part => !part.projected).map(part => part.nodeId).filter((value, i, all) => all.indexOf(value) === i)[0] || '']);
                        const replaced = sourceRecord && (sourceRecord.nativeTurn !== nativeTurn ||
                            (sourceRecord.signature !== signature && sourceRecord.row?.parts.length && row?.parts.some(part => !part.projected)) ||
                            // Only a replaced host streaming body advances generation; display formatting does not.
                            row?.body?.streaming && sourceRecord.row?.body?.paragraphs.some((old,index) =>
                                !row.body.paragraphs[index]?.source.text.startsWith(old.source.text)));
                        if (!sourceRecord || replaced) {
                            const generation = (sourceRecord?.source.generation || 0) + 1;
                            sourceRecord = {source: {sessionId: id, authorityEpoch: record.epoch, branchId,
                                turn: latest, sourceKey: JSON.stringify([id, latest, nativeTurn]), generation}, nativeTurn, signature};
                            record.sources.set(latest, sourceRecord);
                        }
                        sourceRecord.row = row;
                        sourceRecord.signature = signature;
                        const text = row?.text || null;
                        const streaming = text ? text.streaming && running : running;
                        // The adapter revision also covers sending/cancellation without a text chunk.
                        if (!sourceRecord.text || sourceRecord.inputText !== text || sourceRecord.text.streaming !== streaming) {
                            sourceRecord.inputText = text;
                            sourceRecord.text = {...(text || {pages: [], hasReadableText: false, units: []}), streaming, revision: ++record.revision};
                        }
                        const source = sourceRecord.source;
                        store.dispatch({type: running && !record.lastRunning ? 'SEND' : 'TURN_CHANGED', source, text: sourceRecord.text, generating: running});
                        store.dispatch({type: 'TEXT_RECONCILE', source, text: sourceRecord.text});
                        // A rejected send never started a turn: it is the latest attempt only until the session runs again.
                        if (session.promptError !== record.promptError) {
                            record.promptError = session.promptError;
                            record.rejectedSend = session.promptError?.op === 'send' ? session.promptError.error?.message || 'send' : null;
                        }
                        if (running) record.rejectedSend = null;
                        const attempt = running ? null : stageAttemptFailure(chat, view);
                        const failure = record.rejectedSend || attempt?.error || null;
                        const interrupted = !running && ((!row && record.lastRunning) || failure || attempt);
                        if (interrupted && (!store.getSnapshot().interrupted || store.getSnapshot().pending.error !== (failure || 'cancelled'))) {
                            store.dispatch({type: failure ? 'SEND_FAILED' : 'SEND_CANCELLED', source, error: failure, retryable: !!attempt?.error});
                        }
                    } else if (store.getSnapshot().source || view && !store.getSnapshot().empty) {
                        // Rollback to an empty conversation is a context withdrawal, not a spinner.
                        // so is a new chat whose view has loaded with no round yet - the stage has nothing to load (no endless veil).
                        store.dispatch({type: 'SESSION_EMPTY'});
                    }
                    record.lastRunning = running;
                    record.lastTurns = ordered;
                    record.lastNativeTurn = latestNativeTurn;
                } while (record.dirty);
            } finally {record.reconciling = false;}
        }
        record.reconcile = reconcile;
        // Native changes only wake the host body read; their text never enters the index.
        let bodyStamp = '', bodyRead = null, bodyRequest = null;
        async function refreshBody() {
            if (!options.readBody || !record.active) return;
            const chat = record.chat.getSnapshot(), view = viewSource.getSnapshot().view;
            const nodes = [...chat.nodes.values()].filter(node => node.kind === 'assistant-step');
            const nativeTurn = Math.max(0,...nodes.map(node => Number(node.location?.turn?.turn) || 0));
            const turn = options.storyTurn(view,nativeTurn);
            if (!turn) return;
            const stamp = JSON.stringify([record.branch,turn,nodes.filter(node => Number(node.location?.turn?.turn) === nativeTurn).map(node => [node.id,node.data])]);
            if (stamp === bodyStamp) return;
            bodyStamp = stamp;
            bodyRequest = {turn,branch:record.branch,epoch:record.epoch,binding:record.binding};
            if (bodyRead) return;
            bodyRead = Promise.resolve().then(async () => {
                while (bodyRequest && record.active) {
                    const request = bodyRequest; bodyRequest = null;
                    const body = await options.readBody({sessionId:id,turn:request.turn});
                    if (!record.active || record.branch !== request.branch || record.epoch !== request.epoch || record.binding !== request.binding) continue;
                    if (body) {record.index.ingest(request.turn,body);reconcile();}
                }
            }).catch(() => {bodyStamp = '';}).finally(() => {bodyRead = null;});
            return bodyRead;
        }
        const nativeChanged = () => {reconcile();void refreshBody();};
        record.replaceBinding = binding => {
            if (binding === record.binding) return;
            record.stopBinding(); // Unsubscribe old native and per-node sources before reading the replacement.
            record.binding = binding;
            record.chat = options.resolveChat(binding);
            const stops = [], nodeStops = new Map();
            record.watchNodes = chat => {
                const ids = new Set(chat.order || Array.from(chat.nodes.values(), node => node.id));
                for (const [nodeId, entry] of nodeStops) if (!ids.has(nodeId)) {entry.stop(); nodeStops.delete(nodeId);}
                for (const nodeId of ids) {
                    const source = chat.nodes.source?.(nodeId);
                    const old = nodeStops.get(nodeId);
                    if (old?.source === source) continue;
                    if (old) old.stop();
                    if (source) nodeStops.set(nodeId, {source, stop: source.subscribe(nativeChanged)});
                }
            };
            record.stopBinding = () => {for (const stop of stops) stop(); for (const entry of nodeStops.values()) entry.stop(); nodeStops.clear();};
            stops.push(binding.session.subscribe(nativeChanged), record.chat.subscribe(nativeChanged));
            nativeChanged();
        };
        record.stops.push(viewSource.subscribe(reconcile), options.coordination.subscribe(id, () => {
            // Notifications only wake an authoritative snapshot read; no signal payload is input.
            options.views.invalidate(id);
            options.settings.load(id, true);
            reconcile();
        }), options.settings.subscribe(reconcile), options.preferences.subscribe(reconcile));
        // session-owned speculation, never dependent on mounted history DOM.
        let prefetchKey = '';
        const navigation = store.select(state => [state.opened,state.source,state.cursor.anchor,state.text,state.pending.projection,state.pending.resources]);
        record.stops.push(navigation.subscribe(() => {
            const state = store.getSnapshot();
            if (!state.opened || !state.source) {prefetchKey = ''; record.widgetUi.state=null; record.widgetUi.refs.clear(); record.widgetHistory=null; return;}
            // Restoring an entry cursor precedes its foreground projection. Do not warm
            // unrelated history from the temporary first page or every stage open.
            if (state.pending.projection || state.pending.resources) return;
            const key = JSON.stringify([state.source,state.cursor.anchor]);
            if (key === prefetchKey) return;
            prefetchKey = key;
            const turns = [...record.index.getSnapshot().keys()].sort((a,b) => a-b);
            const at = turns.indexOf(state.source.turn);
            const page = state.text.pages.findLastIndex(page => page.anchor.paragraphId === state.cursor.anchor?.paragraphId &&
                page.anchor.para === state.cursor.anchor.para && page.anchor.offset <= state.cursor.anchor.offset);
            if (page >= 0 && page <= 2 && at > 0) prefetch(record,turns[at-1]);
            if (page >= state.text.pages.length-3 && at+1 < turns.length) prefetch(record,turns[at+1]);
        }),() => navigation.dispose());
        options.settings.load(id);
        if (options.settings.watch) record.stops.push(options.settings.watch(id));
        return record;
    }
    function reconcileList() {
        if (disposed) return;
        const snapshot = options.sessions.list.getSnapshot();
        const selected = options.selectedSessionId ? options.selectedSessionId() : snapshot.current;
        const ids = new Set(Object.keys(snapshot.byId || {}));
        if (selected) ids.add(selected);
        for (const record of records.values()) if (!ids.has(record.id) || !options.sessions.binding(record.id)) release(record);
        // Native binding(id) can materialize a cold session. Only open the selected
        // session here; keep previously opened sessions resident until native removal.
        const opened = new Set(records.keys());
        if (selected) opened.add(selected);
        for (const id of opened) {
            const binding = options.sessions.binding(id);
            if (!binding) continue;
            const record = records.get(id) || create(id);
            record.replaceBinding(binding);
            record.reconcile();
        }
    }
    return {
        start() {if (stopList || disposed) return; stopList = options.sessions.list.subscribe(reconcileList); reconcileList();},
        get: id => records.get(id)?.store || null,
        getIndex: id => records.get(id)?.index || null,
        getWidgetContext: id => records.get(id)?.widgetUi || null,
        // the earlier turns a source widget reads, newest first, `depth` of them (the phone
        // asks for more as the reader scrolls up its conversation); `limited` = the chat has turns before them.
        async readWidgetHistory(id, source, depth = 19) {
            const record=records.get(id);
            if (!record || record.store.getSnapshot().source !== source) return null;
            const epoch=record.epoch, branch=record.branch, binding=record.binding;
            const valid=()=>record.active && record.epoch===epoch && record.branch===branch && record.binding===binding && record.store.getSnapshot().source===source;
            const earlier=[...record.index.getSnapshot().keys()].filter(turn=>turn<source.turn).sort((a,b)=>b-a),turns=earlier.slice(0,depth);
            const key=JSON.stringify([epoch,branch,source,depth]);
            const indexed=turns.map(turn=>record.index.getSnapshot().get(turn));
            if (record.widgetHistory?.key===key && indexed.every((row,i)=>row===record.widgetHistory.indexed[i])) return record.widgetHistory.promise;
            const promise=(async()=>{
                const rows=[];let unavailable=false;
                for (const turn of turns) {
                    if (!valid()) return null;
                    try {
                        const value=await hydrate(record,turn,valid);
                        if (!valid()) return null;
                        if (value?.envelope?.token) rows.push({turn,sourceKey:value.envelope.binding?.stream?.operationId || value.envelope.token.sourceKey,record:value.envelope,pages:value.row.text.pages});
                    } catch { unavailable=true; }
                }
                if (valid() && record.widgetHistory?.key===key) record.widgetHistory.indexed=turns.map(turn=>record.index.getSnapshot().get(turn));
                return valid() ? {rows,unavailable,limited:earlier.length>turns.length} : null;
            })();
            record.widgetHistory={key,promise,indexed};
            return promise;
        },
        // still: a restored position - its history page shows as it stands and never plays.
        async navigate(id, turn, index, forward, para, still = false) {
            const record = records.get(id);
            if (!record) return;
            const request = record.navigation = (record.navigation || 0) + 1;
            const epoch = record.epoch, branch = record.branch, binding = record.binding;
            const navigationSource = record.store.getSnapshot().source;
            const valid = () => record.active && record.navigation === request && record.epoch === epoch && record.branch === branch && record.binding === binding && record.store.getSnapshot().source === navigationSource;
            const origin = record.store.getSnapshot().source?.turn || turn;
            const delta = turn < origin ? -1 : 1;
            let row = record.index.getSnapshot().get(turn);
            while (row?.unloaded || row?.emptyHistory) {
                if (!options.readHistory) return;
                let result;
                // Held Back and boundary prefetch share the same read-only request.
                try {if (row.unloaded) result = await hydrate(record,turn,valid);} catch (_) {return;}
                if (!valid()) return;
                row = record.index.getSnapshot().get(turn);
                if (!result && row?.unloaded) return;
                if (!row?.text.pages.length) {
                    const turns = [...record.index.getSnapshot().keys()].sort((a,b) => a-b);
                    turn = turns[turns.indexOf(turn) + delta];
                    row = record.index.getSnapshot().get(turn);
                    continue;
                }
            }
            const state = record.store.getSnapshot();
            if (!valid() || !state.latestSource || !row) return;
            forward = forward && turn === state.latestSource.turn;
            record.index.touch?.(turn);
            const source = sourceFor(record,turn,row);
            index = para ? row.text.pages.findIndex(page => page.anchor.para >= para) : index < 0 ? row.text.pages.length - 1 : index;
            index = Math.max(0,index || 0);
            const anchor = row.text.pages[index]?.anchor || row.text.pages[0]?.anchor;
            // A replay pages within its round; leaving the round leaves the replay.
            if (state.source?.turn !== turn || state.cursor.mode !== 'replay' && state.cursor.mode !== (forward ? 'live' : 'history')) {
                // back on the latest round the live adapter text is its one text - streaming only while
                // the session runs, on the adapter's revision - so later reconciles still land (the index row's revision is another
                // counter, and its streaming flag outlived the body: 正在生成正文… stuck after paging back from an earlier round).
                const text = forward && record.sources.get(turn)?.text || row.text;
                record.store.dispatch({type:forward ? 'RESUME_LIVE' : 'HISTORY_JUMP',source,text,anchor,...(still ? {still:true} : {})});
            } else record.store.dispatch({type:'PAGE',index,...(still ? {still:true} : {})});
        },
        // a clip export replays the round on screen from its starting state, everything
        // as if live (projection only, nothing is written); the player has no replay.
        replay(id, anchor) {
            const record = records.get(id), state = record?.store.getSnapshot();
            const row = state?.source && record.index.getSnapshot().get(state.source.turn);
            if (!row?.text.pages.length || state.cursor.mode === 'replay') return false;
            record.store.dispatch({type:'REPLAY_START',source:state.source,text:row.text,
                anchor:anchor && row.text.pages.find(page => page.anchor.para === anchor.para && page.anchor.offset === anchor.offset)?.anchor});
            return true;
        },
        // the backlog reads the text of an earlier turn outside the loaded history window
        // (same read-only history read as navigation); the index publishes the hydrated row on success.
        async hydrateText(id, turn) {
            const record = records.get(id), row = record?.index.getSnapshot().get(turn);
            if (!record || !row?.unloaded) return false;
            const epoch = record.epoch, branch = record.branch, binding = record.binding;
            const valid = () => record.active && record.epoch === epoch && record.branch === branch && record.binding === binding;
            try { return !!(await hydrate(record,turn,valid)); } catch (_) { return false; }
        },
        // the native conversation holds a window of recent events (its own 「加载更早」 pages);
        // turns before it are not in the index at all. The backlog reaching its oldest turn pulls earlier pages, read-only,
        // until an earlier turn is indexed or the history starts (a few pages per call). Their text then loads lazily
        // like any other unloaded row (hydrateText).
        hasOlder: id => records.get(id)?.binding?.session.getSnapshot()?.hasMore === true,
        async loadOlder(id) {
            const record = records.get(id), session = record?.binding?.session;
            if (!record || typeof session?.loadOlder !== 'function') return false;
            const binding = record.binding, first = () => Math.min(...record.index.getSnapshot().keys());
            const before = first();
            for (let page = 0; page < 4 && first() >= before; page++) {
                if (!record.active || record.binding !== binding || session.getSnapshot()?.hasMore !== true) break;
                await session.loadOlder();
                // The chat target can publish a prepended page on the next frame.
                await new Promise(resolve => setTimeout(resolve, 32));
                if (record.active) record.reconcile();
            }
            return first() < before;
        },
        reconcile(id) {records.get(id)?.reconcile();},
        dispose() {if (disposed) return; disposed = true; stopList?.(); for (const record of [...records.values()]) release(record);}
    };
}

return {createStageSessionOwner};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageSessionModule};
