// Cubism Core for Web keeps every model in one emscripten heap. When a later, larger moc makes that heap
// grow, the core moves to a new ArrayBuffer, but the typed-array views a model created earlier (core Model.parameters /
// parts / drawables and the framework CubismModel's cached copies) keep pointing at the old copy. Such a figure stops
// responding: lip sync, motions, expressions and gaze write into the stale copy, and the renderer keeps drawing the
// vertices of the moment the heap grew (one figure loaded first, a second one's larger moc grew the heap, and the first never moved
// its mouth again). The guard rebinds such a model to the live heap right before its next core update. The heap only grows,
// so a view whose buffer is smaller than the newest one belongs to an older heap.
function cubismHeapGuard(core, live2d) {
    const Model = core && core.Model, CubismModel = live2d && live2d.CubismModel;
    if (!Model || typeof Model.fromMoc !== "function" || !CubismModel || !CubismModel.prototype || CubismModel.prototype.forkHeapGuard) return false;
    const heap = { bytes: 0 };
    const fromMoc = Model.fromMoc;
    Model.fromMoc = function (moc) {
        const model = fromMoc.call(this, moc);
        const bytes = model && model.parameters && model.parameters.values && model.parameters.values.buffer.byteLength;
        if (bytes > heap.bytes) heap.bytes = bytes;
        return model;
    };
    const update = CubismModel.prototype.update;
    CubismModel.prototype.update = function () {
        cubismRebind(this, core, heap.bytes);
        return update.apply(this, arguments);
    };
    CubismModel.prototype.forkHeapGuard = heap;
    return true;
}
// Rebuilds the core model's views on the current heap, carrying over the values written since the heap grew (they only
// reached the stale copy), and repoints the framework's cached arrays. Returns whether the model was stale.
function cubismRebind(model, core, heapBytes) {
    const raw = model && model._model;
    const values = raw && raw._ptr && raw.parameters && raw.parameters.values;
    if (!values || !(values.buffer.byteLength < heapBytes)) return false;
    const opacities = raw.parts.opacities;
    raw.parameters = new core.Parameters(raw._ptr);
    raw.parts = new core.Parts(raw._ptr);
    raw.drawables = new core.Drawables(raw._ptr);
    raw.parameters.values.set(values);
    raw.parts.opacities.set(opacities);
    model._parameterValues = raw.parameters.values;
    model._partOpacities = raw.parts.opacities;
    model._parameterMaximumValues = raw.parameters.maximumValues;
    model._parameterMinimumValues = raw.parameters.minimumValues;
    return true;
}
