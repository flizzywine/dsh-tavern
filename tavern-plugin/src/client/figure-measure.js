// candidates only. Loading a scene never persists or confirms calibration.
const figureCandidateCache = new Map();
function figureCached(key, measure) {
    if (figureCandidateCache.has(key)) {
        const result = figureCandidateCache.get(key); figureCandidateCache.delete(key); figureCandidateCache.set(key, result); return result;
    }
    const result = measure();
    if (figureCandidateCache.size >= 256) figureCandidateCache.delete(figureCandidateCache.keys().next().value);
    figureCandidateCache.set(key, result);
    return result;
}
function figureMeasureTexture(sourceSha, texture) {
    return figureCached(sourceSha + ":alpha:" + FIGURE_ALGORITHM + ":2048", function () {
        try {
            const canvas = document.createElement("canvas"), ratio = Math.min(1, 2048 / Math.max(texture.width, texture.height));
            canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(texture.baseTexture.resource.source, 0, 0, canvas.width, canvas.height);
            return { sourceSha, canvas: [texture.width, texture.height], status: "pending", auto: measureFigureAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, [texture.width, texture.height]) };
        } catch (_) { return { sourceSha, status: "pending", auto: { invalid: true, warnings: ["pixel-read-failed"] } }; }
    });
}
// the horizontal centre of a picture's body (its largest opaque part) in
// canvas px, read once per picture at 256 px - only where the bubble tail points, never sizing. undefined when unreadable.
function figureBodyCentre(key, texture) {
    return figureCached(key + ":body-x", function () {
        try {
            const canvas = document.createElement("canvas"), ratio = Math.min(1, 256 / Math.max(texture.width, texture.height));
            canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(texture.baseTexture.resource.source, 0, 0, canvas.width, canvas.height);
            return measureFigureAlpha(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, [texture.width, texture.height]).supportX;
        } catch (_) { return undefined; }
    });
}
// The default rest pose: every parameter at its default, the pose groups applied. Do not call internalModel.update: it
// runs blink, breath and physics. Pose alone is deterministic.
function figureLive2dRestPose(im) {
    const core = im.coreModel;
    if (!core.getParameterCount || !core.getParameterDefaultValue || !core.update) throw new Error("Rest state unavailable");
    for (let i = 0; i < core.getParameterCount(); i++) core.setParameterValueByIndex(i, core.getParameterDefaultValue(i));
    if (im.settings.pose && !im.pose) throw new Error("Pose unavailable");
    if (im.pose) im.pose.updateParameters(core, 0);
    core.update(); core.saveParameters();
}
// the model's own head at rest - its head hit area or declared ForkStage head, the
// box the cast faces frame (live2dHeadBox) - as canvas fractions {top, chin}, for the head-normalised stage size
// (packFigureAnatomy). null when the model only has an estimate. Once per model identity.
function figureMeasureLive2dHead(model, identity) {
    return figureCached(identity + ":rest-head-v1", function () {
        const im = model.internalModel, H = im.originalHeight;
        try { figureLive2dRestPose(im); } catch (_) { return null; }
        const head = live2dHeadBox(model, live2dDrawableBounds(model), null);
        return head.source === "hit" || head.source === "declared" ? { top: head.top / H, chin: head.chin / H } : null;
    });
}
function figureMeasureLive2d(model, modelRevision) {
    const im = model.internalModel, core = im.coreModel;
    const coreVersion = String(window.Live2DCubismCore?.Version?.csmGetVersion?.() || "unknown");
    return figureCached(modelRevision + ":rest-default-pose:" + coreVersion + ":" + FIGURE_ALGORITHM, function () {
        const canvas = [im.originalWidth, im.originalHeight];
        try {
            figureLive2dRestPose(im);
            let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
            const hit = new Set((im.settings.hitAreas || []).map(h => h.Id));
            const ids = im.getDrawableIDs(), transform = im.localTransform;
            ids.forEach(function (id, index) {
                if (hit.has(id) || /(?:effect|sparkle|shadow|hitarea)/i.test(id) || core.getDrawableOpacity(index) < 0.05 || !core.getDrawableDynamicFlagIsVisible(index)) return;
                // The Pixi adapter converts Cubism units to pixels and flips Y; apply only its local layout here.
                const vertices = im.getDrawableVertices(index);
                for (let i = 0; i < vertices.length; i += 2) {
                    const p = transform.apply({ x: vertices[i], y: vertices[i + 1] });
                    left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
                }
            });
            if (!(right > left && bottom > top)) throw new Error("Empty drawable bounds");
            const declared = im.settings.json.ForkStage;
            const auto = { figureTop: top, visibleBottom: bottom, supportX: (left + right) / 2, inkBounds: [left, top, right - left, bottom - top], method: "rest-drawable-upper-bound", restPosePolicy: "default-parameters-pose-v1", coreVersion, algorithmVersion: FIGURE_ALGORITHM, confidence: 0.3, warnings: ["drawable-upper-bound", "confirm-mask-and-texture-alpha"] };
            if (declared?.Chin > declared?.HeadTop) {
                auto.headTop = transform.apply({ x: canvas[0] / 2, y: declared.HeadTop * canvas[1] }).y;
                auto.chin = transform.apply({ x: canvas[0] / 2, y: declared.Chin * canvas[1] }).y;
            }
            return { version: 1, modelRevision, canvas, status: "pending", auto };
        } catch (_) { return { version: 1, modelRevision, canvas, status: "pending", auto: { invalid: true, warnings: ["rest-pose-unavailable"] } }; }
    });
}

// Render the default rest pose once; never infer anatomy from a texture atlas.
function figureMeasurePackLive2d(model, identity, renderer, PIXI) {
    return figureCached(identity + ":pack-rest-alpha-v1", function () {
        const rest = figureMeasureLive2d(model, identity), canvas = rest.canvas;
        if (rest.auto.invalid) return rest;
        let texture;
        try {
            texture = renderer.generateTexture(model, {region: new PIXI.Rectangle(0, 0, ...canvas), resolution: Math.min(1, 1024 / Math.max(...canvas))});
            const pixels = renderer.plugins.extract.canvas(texture), ctx = pixels.getContext("2d");
            return {...rest, auto: measureFigureAlpha(ctx.getImageData(0, 0, pixels.width, pixels.height).data, pixels.width, pixels.height, canvas)};
        } catch (_) { return {...rest, auto: {invalid: true, warnings: ["rest-alpha-unavailable"]}}; }
        finally { if (texture) texture.destroy(true); }
    });
}
