// On-demand stage client. The stage client is not part of the core combo: a card without the
// stage downloads and runs none of the stage code. It is imported once, and started with
// ctx.plugin(), when the server stage is ready and an open session needs the stage. The host
// decides that per card (card-stage-settings.js effectiveCardStage) and publishes it in the
// session view as view.stage.{dialogue,stage}; the client never recomputes it. Afterwards the
// stage plugin's own watchStageAvailability mounts and unmounts its views from the same
// availability.
function stageWantedOf(state) {
    const stage = state && state.view && state.view.stage;
    return !!stage && (stage.dialogue === true || stage.stage === true);
}
function stageDialogueOf(state) {
    const stage = state && state.view && state.view.stage;
    return !!stage && stage.dialogue === true;
}
// Sessions shown somewhere: any retain on the list row, else the snapshot's current session.
function openSessionIds(snapshot) {
    const ids = [];
    for (const row of Object.values(snapshot && snapshot.byId || {})) {
        if (row && row.retainedBy && Object.values(row.retainedBy).some(count => (count ?? 0) > 0)) ids.push(String(row.id));
    }
    if (!ids.length && snapshot && typeof snapshot.current === 'string' && snapshot.current) ids.push(snapshot.current);
    return ids;
}
// sessions: ctx.sessions ({list:{getSnapshot,subscribe}}); views: liveTavernView ({getSnapshot,subscribe(id,listener,paths),invalidate(id)});
// runtime: {read:()=>Promise<{status}>, subscribe(changed, wake)}: `changed(signal)` with each stage lifecycle signal
// ({version}, the latest one replayed on connect), `wake` on errors and (re)connection;
// load: ()=>import(stage-client.mjs); install: plugin=>ctx.plugin(plugin).
function createStageClientLoader({sessions, views, runtime, load, install, report}) {
    const listeners = new Set(), watched = new Map();
    let wanted = false, stopped = true, revision = 0, loading = null, fiber = null, lifecycle;
    const compute = () => {
        for (const id of watched.keys()) if (stageWantedOf(views.getSnapshot(id))) return true;
        return false;
    };
    const notify = () => { for (const listener of [...listeners]) listener(); };
    const update = () => {
        const next = compute();
        if (next === wanted) return;
        wanted = next;
        notify();
    };
    const syncSessions = () => {
        const ids = new Set(openSessionIds(sessions.list.getSnapshot()));
        for (const [id, stop] of [...watched]) if (!ids.has(id)) { watched.delete(id); stop(); }
        for (const id of ids) if (!watched.has(id)) watched.set(id, views.subscribe(id, update, [['stage']]));
        update();
    };
    // The server stage started or stopped: views computed before carry the old stage flags, so the open sessions read
    // theirs again. The first signal seen (replayed on connect) is the state the views were read in.
    const changed = signal => {
        const version = signal && signal.version;
        if (lifecycle !== undefined && version !== lifecycle) for (const id of watched.keys()) views.invalidate(id);
        lifecycle = version;
        notify();
    };
    const availability = Object.freeze({
        // Without a session that needs the stage there is nothing to ask the server.
        async read() {
            if (!compute()) return {status:'idle'};
            const status = await runtime.read();
            return {status: status && status.status === 'ready' ? 'ready' : 'idle'};
        },
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
    });
    async function ensureLoaded() {
        if (fiber || loading) return;
        loading = (async () => {
            const module = await load();
            const plugin = module && module.default;
            if (!plugin || typeof plugin.apply !== 'function') throw new Error('舞台客户端包没有导出插件');
            if (stopped) return;
            const started = install(plugin);
            await started;
            fiber = started;
        })();
        try { await loading; }
        catch (error) { report(error); }
        finally { loading = null; }
    }
    async function refresh() {
        const expected = ++revision;
        try {
            const value = await availability.read();
            if (stopped || expected !== revision || value.status !== 'ready') return;
            await ensureLoaded();
        } catch (error) { if (!stopped) report(error); }
    }
    return Object.freeze({
        availability,
        loaded: () => fiber !== null,
        start() {
            if (!stopped) throw new Error('Stage client loader already started');
            stopped = false;
            const stops = [runtime.subscribe(changed, notify), sessions.list.subscribe(syncSessions), availability.subscribe(refresh)];
            syncSessions();
            void refresh();
            return () => {
                if (stopped) return;
                stopped = true; revision++;
                for (const stop of stops.reverse()) stop();
                for (const [, stop] of [...watched]) stop();
                watched.clear();
                const started = fiber; fiber = null;
                if (started && typeof started.dispose === 'function') started.dispose();
            };
        }
    });
}
// Whether dialogue bubbles are on for this session (view.stage.dialogue, host-decided); false until the view arrives.
// Transcript bubbles read this before asking the stage for bubble settings, so a card without bubbles sends no request.
function useStageDialogue(sessionId) {
    const subscribe = React.useCallback(notify => sessionId ? liveTavernView.subscribe(sessionId, notify, [['stage']]) : () => {}, [sessionId]);
    const snapshot = React.useCallback(() => sessionId ? stageDialogueOf(liveTavernView.getSnapshot(sessionId)) : false, [sessionId]);
    return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageClientLoader, stageWantedOf, stageDialogueOf, openSessionIds};
