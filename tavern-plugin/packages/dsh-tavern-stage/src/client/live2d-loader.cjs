// The stage's side of the Live2D module (live2d-module.js → lib/client/live2d-client.mjs, served as a stage client asset).
// One loader per stage activation. Nothing is downloaded until a Live2D figure gets a Cubism Core, a Live2D preview or
// snapshot is asked for, or a runtime entry (设置 › 舞台 › 运行库, the 「Live2D 未安装」 notice) is shown: a stage card
// without Live2D loads none of it, and a card without the stage loads neither this nor the module.
// The adapters keep the shapes the stage and the core already read: `runtime` (live2d-figures.cjs), `store` + `Entry`
// (notices.cjs, global-settings.js) and `previews` (the asset-pack closure's live2dKit, asset-pack-ui.js stageScope).
// `host`: the core names the module uses (gal-stage.js `live2d.host`) plus the stage's scene math.
let stageLive2dChunk = null;
function createStageLive2d({React, host, load = () => import('/api/dsh-tavern/client-assets/live2d-client.mjs'), report = error => console.error('[dsh-tavern-stage] Live2D instance', error)}) {
    const listeners = new Set();
    let instance = null, loading = null, failed = false, revision = 0, disposed = false, stopStore = null;
    const notify = () => { revision++; for (const listener of [...listeners]) listener(); };
    const subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
    const snapshot = () => revision;
    function start(chunk) {
        instance = chunk.createLive2dModule({React, ...host});
        stopStore = instance.store.subscribe(notify);
        failed = false;
        notify();
        return instance;
    }
    // A chunk this page already imported starts at once (no frame without the runtime on a re-activation).
    if (stageLive2dChunk) start(stageLive2dChunk);
    function ready() {
        if (instance) return Promise.resolve(instance);
        if (disposed) return Promise.reject(new Error('Live2D 模块已卸载'));
        return loading ||= load().then(chunk => {
            stageLive2dChunk = chunk;
            if (disposed) throw new Error('Live2D 模块已卸载');
            return start(chunk);
        }).catch(error => { loading = null; if (!disposed) { failed = true; notify(); } throw error; });
    }
    function useModule() {
        React.useSyncExternalStore(subscribe, snapshot);
        React.useEffect(() => { if (!instance) ready().catch(report); }, []);
        return instance;
    }
    const h = React.createElement;
    function Entry(props) {
        const loaded = useModule();
        return loaded ? h(loaded.Entry, props) : null;
    }
    // While the module loads the preview waits as the module's own preview does; a module that cannot load shows the fallback.
    function Preview(props) {
        const loaded = useModule();
        if (loaded) return h(loaded.preview.Preview, props);
        return h('div', { className: 'fork-live2d-preview', 'data-status': failed ? 'error' : 'loading', role: 'img', 'aria-label': props.label || 'Live2D', 'aria-busy': failed ? undefined : true },
            failed ? (props.fallback ? h('div', { className: 'fork-live2d-preview-fallback' }, props.fallback) : null)
                : h(host.Spinner, { fill: true, className: 'fork-live2d-preview-wait' }));
    }
    const call = name => (...args) => instance.runtime[name](...args);
    return Object.freeze({
        // The scene renderer's helpers. Only the loader and the per-frame GL context swap run before the module is in;
        // the rest are reached once loadLive2dRuntime resolved. `core`: the Cubism Core the user imported.
        runtime: Object.freeze({
            loadLive2dRuntime: core => ready().then(loaded => loaded.runtime.loadLive2dRuntime(core)),
            live2dUseContext: gl => { instance?.runtime.live2dUseContext(gl); },
            live2dDropContext: gl => { instance?.runtime.live2dDropContext(gl); },
            live2dPlace: call('live2dPlace'), live2dHeadFrame: call('live2dHeadFrame'), live2dExpress: call('live2dExpress'),
            syntheticMouth: call('syntheticMouth'), live2dLoadError: call('live2dLoadError'),
            headBox: (...args) => instance.headBox(...args),
            core: () => instance ? instance.store.core : '',
            ready: () => instance !== null
        }),
        store: Object.freeze({ subscribe, snapshot, get core() { return instance ? instance.store.core : ''; } }),
        Entry,
        previews: Object.freeze({
            Preview,
            snapshots: Object.freeze({
                peek: (...args) => instance ? instance.preview.snapshots.peek(...args) : {},
                request: (...args) => ready().then(loaded => loaded.preview.snapshots.request(...args))
            }),
            useRevision: () => React.useSyncExternalStore(subscribe, snapshot)
        }),
        dispose() {
            if (disposed) return;
            disposed = true;
            stopStore?.();
            listeners.clear();
            instance?.dispose();
        }
    });
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { createStageLive2d };
