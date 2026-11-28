// On-demand stage client. The stage client is not part of the core combo: a card without the
// stage downloads and runs none of the stage code. It is imported once, and started with
// ctx.plugin(), when the server stage is ready and an open session needs the stage. The host
// decides that per card (card-stage-settings.js effectiveCardStage) and publishes it in the
// session view as view.stage.{dialogue,stage}. The loader combines that demand with server
// readiness. The stage plugin mounts its views from the resulting snapshot.
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
    const listeners = new Set(), holds = new Set();
    let current = null, ready = false, modulePromise = null;
    const availability = Object.freeze({
        getSnapshot: () => ready,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
    });
    function setReady(next) {
        if (ready === next) return;
        ready = next;
        for (const listener of [...listeners]) listener();
    }

    function loadPlugin() {
        return modulePromise ??= Promise.resolve().then(load).then(module => {
            const plugin = module?.default;
            if (typeof plugin?.apply !== 'function') throw new Error('舞台客户端包没有导出插件');
            return plugin;
        }).catch(error => { modulePromise = null; throw error; });
    }

    function disposeFiber(lifetime) {
        const fiber = lifetime.fiber;
        lifetime.fiber = null;
        if (typeof fiber?.dispose !== 'function') return;
        try { Promise.resolve(fiber.dispose()).catch(report); }
        catch (error) { report(error); }
    }

    async function ensureLoaded(lifetime) {
        if (lifetime.fiber || lifetime.loading) return;
        lifetime.loading = true;
        try {
            const plugin = await loadPlugin();
            if (current !== lifetime || !ready || lifetime.confirmed !== lifetime.revision) return;
            // Record the fiber before awaiting it so host disposal also stops pending installs.
            lifetime.fiber = install(plugin);
            await lifetime.fiber;
        } catch (error) {
            if (current === lifetime) { disposeFiber(lifetime); report(error); }
        } finally { lifetime.loading = false; }
    }

    async function refresh(lifetime, wake = false) {
        if (!lifetime || current !== lifetime) return;
        const demand = holds.size ? 'workbench' : [...lifetime.sessions].some(id => stageWantedOf(views.getSnapshot(id))) ? 'session' : null;
        if (demand === lifetime.demand && !wake) return;
        lifetime.demand = demand;
        const expected = ++lifetime.revision;
        if (!demand) { setReady(false); return; }
        let value;
        try { value = await runtime.read({ workbench: demand === 'workbench' }); }
        catch (error) {
            if (current === lifetime && expected === lifetime.revision) { setReady(false); report(error); }
            return;
        }
        if (current !== lifetime || expected !== lifetime.revision) return;
        lifetime.confirmed = expected;
        setReady(value?.status === 'ready');
        if (ready && current === lifetime && expected === lifetime.revision) void ensureLoaded(lifetime);
    }

    return Object.freeze({
        availability,
        // Opening a stage workbench explicitly also needs the client.
        hold() {
            const token = {};
            holds.add(token);
            void refresh(current);
            return () => { if (holds.delete(token)) void refresh(current); };
        },
        loaded: () => Boolean(current?.fiber && !current.loading),
        start() {
            if (current) throw new Error('Stage client loader already started');
            const lifetime = { sessions: new Set(), demand: null, revision: 0, confirmed: 0, loading: false, fiber: null };
            const watched = new Map(), stops = [];
            let serverVersion;
            const update = () => void refresh(lifetime);
            const wake = () => void refresh(lifetime, true);
            const syncSessions = () => {
                if (current !== lifetime) return;
                lifetime.sessions = new Set(openSessionIds(sessions.list.getSnapshot()));
                for (const [id, stop] of watched) if (!lifetime.sessions.has(id)) { watched.delete(id); stop(); }
                for (const id of lifetime.sessions) if (!watched.has(id)) watched.set(id, views.subscribe(id, update, [['stage']]));
                update();
            };
            const changed = signal => {
                if (current !== lifetime) return;
                const version = signal?.version;
                // The first signal is replayed on connect. Later versions invalidate pre-existing flags.
                const invalidate = serverVersion !== undefined && version !== serverVersion;
                serverVersion = version;
                if (invalidate) for (const id of lifetime.sessions) views.invalidate(id);
                wake();
            };
            const stop = () => {
                if (current !== lifetime) return;
                current = null;
                const errors = [];
                for (const cleanup of [() => setReady(false), ...stops.reverse(), ...watched.values(), () => disposeFiber(lifetime)]) {
                    try { cleanup(); } catch (error) { errors.push(error); }
                }
                watched.clear();
                if (errors.length) throw new AggregateError(errors, 'Stage client loader cleanup failed');
            };
            current = lifetime;
            try {
                stops.push(runtime.subscribe(changed, wake));
                stops.push(sessions.list.subscribe(syncSessions));
                syncSessions();
            } catch (error) {
                try { stop(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Stage client loader startup failed'); }
                throw error;
            }
            return stop;
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
