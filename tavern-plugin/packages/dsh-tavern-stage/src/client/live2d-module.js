// dsh-tavern-live2d: the Live2D client module, in neither the core client nor the stage's own chunk. The stage imports this file on demand (live2d-loader.cjs) when a Live2D figure, preview or runtime entry is
// needed, and makes one instance per stage activation over the core names in `host` (gal-stage.js `live2d.host`).
// Its parts stay in their source form (their tests read them as scripts): the runtime entry (cubism-core.cjs), the heap
// guard (cubism-heap.cjs), the runtime helpers (live2d.cjs) and the asset-library previews (live2d-preview.cjs).
// The stage's figure renderer (live2d-figures.cjs) draws through `runtime`.
function createLive2dModule({React, rpc, Spinner, RUNTIMES, RuntimeEntry, vendorRuntimeStore, forkLoadScript, loadPixiRuntime, forkLipSync,
    galApplyLipSync, galLipSyncIds, live2dStartIdle, galResolution, galFollowResolution, resolveFigureSizing}) {
    __LIVE2D_CUBISM_CORE__
    __LIVE2D_CUBISM_HEAP__
    __LIVE2D_RUNTIME__
    __LIVE2D_PREVIEW__
    const spec = RUNTIMES.live2d;
    return Object.freeze({
        store: forkCubismCore, Entry: CubismCoreEntry, preview: LIVE2D_PREVIEW_KIT,
        runtime: Object.freeze({loadLive2dRuntime, live2dPlace, live2dHeadFrame, live2dExpress, live2dUseContext, live2dDropContext, syntheticMouth, live2dLoadError}),
        // The head box the cast faces frame, for the core's rest-pose measurement (figure-measure.js figureMeasureLive2dHead).
        headBox: (model, anatomy) => live2dHeadBox(model, live2dDrawableBounds(model), anatomy),
        dispose() { if (RUNTIMES.live2d === spec) delete RUNTIMES.live2d; }
    });
}
export {createLive2dModule};
