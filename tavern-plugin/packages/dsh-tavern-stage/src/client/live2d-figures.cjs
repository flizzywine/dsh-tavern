// Live2D figures on the stage scene: the scene.cjs figure renderer for kind 'live2d', beside spine-figures.cjs.
// The runtime helpers (loader, placement, expression, per-context shaders, the head box) are the Live2D module's
// (live2d-loader.cjs `runtime`, loaded on demand); the Cubism Core and pixi-live2d-display are the user's imports
// (cubism-core.cjs), never bundled.
// Staged actions are live2d-acts.cjs (included beside this file).
function createStageLive2dFigures({window, math, idle, tap, lipSync, runtime = {}, measure = {}}) {
const {performance} = window;
const {galBodyX, galCentredAnatomy, galTextureOwners, galMotionTransitions, galEstimateHeadTop, galInitFace, live2dStartIdle, galApplyStageHead,
    galLipSyncIds, galApplyLipSync, galBlushStep, galCheekValue, galFlushFace, galDisplayMatrix, galMeshRotation, galMeshHead, galFallbackHead,
    galFaceUnion, galSmoothHead, galPlayMoodMotion, galBlinkCalm, galHopAt, galShiverAt, galBodyActAt} = math;
const {loadLive2dRuntime, live2dPlace, live2dHeadFrame, live2dExpress, live2dUseContext, live2dDropContext, syntheticMouth, live2dLoadError, headBox, core:runtimeCore = () => '', ready:runtimeReady = () => true} = runtime;
const {figureMeasureLive2d, figureMeasurePackLive2d, figureMeasureLive2dHead, figureMeasureLive2dCentre, figureKnowsBody, packFigureAnatomy, packFigureRecord} = measure;
const moves = {galHopAt, galShiverAt, galBodyActAt};
const textures = galTextureOwners();
const scenes = new Set();
let disposed = false;
function renderer(scene) {
    if (disposed) throw new Error('Live2D figures disposed');
    const {PIXI, app, state, emotes:emotesBox, figures:figuresBox, onError, commit, lifeOn} = scene;
    const gl = app.renderer.gl;
    // `ready` without a load: a page that already has the runtime (a preview loaded it first) and its helpers.
    const live = { core: '', ready: Boolean(PIXI.live2d) && runtimeReady(), loading: false };
    const entries = new Set();
    let closed = false;
    const useContext = () => live2dUseContext(app.renderer.gl);
    app.renderer.on('prerender', useContext);
    function load(entry) {
        if (closed || entry.loading || entry.model || entry.failed || !live.ready) return;
        entry.loading = true;
        entries.add(entry);
        textures.begin();
        PIXI.live2d.Live2DModel.from(entry.url, { autoInteract: false, autoUpdate: false, idleMotionGroup: '__none__' }).then(function (model) {
            const releaseTextures = textures.retain(model.textures);
            textures.end();
            if (entry.dead || state.destroyed || closed) { model.destroy({ children: true }); releaseTextures(); return; }
            entry.model = model;
            // freeze calibration at entry; candidates never switch a running figure.
            entry.figureSizing = entry.figure.figureSizing;
            if (entry.figureSizing?.source) {
                const input = entry.figureSizing, identity = input.source + ':' + input.outfitKey;
                entry.figureCandidate = input.pack
                    ? (input.anatomy ? null : figureMeasurePackLive2d(model, identity, app.renderer, PIXI))
                    : figureMeasureLive2d(model, input.source);
                if (input.pack) {
                    // The model's own head sizes it unless its anatomy really knows head and feet (packFigureAnatomy).
                    const canvas = [model.internalModel.originalWidth, model.internalModel.originalHeight];
                    const sized = { ...input, head: input.anatomy && figureKnowsBody(input.anatomy) ? null : figureMeasureLive2dHead(model, identity, headBox) };
                    const anatomy = galCentredAnatomy(packFigureAnatomy(sized, canvas, entry.figureCandidate), canvas, anatomy => figureMeasureLive2dCentre(model, identity, anatomy, headBox));
                    entry.figureSizing = { ...sized, anatomy, metrics: packFigureRecord({ ...sized, anatomy }, canvas, entry.figureCandidate) };
                }
            }
            // The body's centre in model px (the model canvas is rarely centred on the figure), for the speaker anchor.
            model.forkBodyX = galBodyX(entry.figureSizing?.metrics, entry.figureCandidate) ?? galBodyX(null, figureMeasureLive2d(model, entry.url)) ?? model.internalModel.originalWidth / 2;
            entry.releaseTextures = releaseTextures;
            galMotionTransitions(model.internalModel);
            // Models without metadata are sampled once in their untransformed canvas bounds.
            const declared = model.internalModel.settings.json && model.internalModel.settings.json.ForkStage;
            if (!entry.figureSizing?.pack && !(declared && declared.Chin > declared.HeadTop && declared.HeadTop >= 0)) {
                let texture;
                try {
                    const im = model.internalModel, Wm = im.originalWidth, Hm = im.originalHeight;
                    model.update(0);
                    texture = app.renderer.generateTexture(model, { region: new PIXI.Rectangle(0, 0, Wm, Hm), resolution: Math.min(1, 1024 / Math.max(Wm, Hm)) });
                    const canvas = app.renderer.plugins.extract.canvas(texture), ctx = canvas.getContext('2d');
                    const top = galEstimateHeadTop(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
                    model.forkStageHeadFrame = { HeadTop: top, Chin: Math.min(1, top + (Hm / Wm < 1.15 ? 0.38 : 0.15)) };
                } catch (_) {
                    const im = model.internalModel;
                    model.forkStageHeadFrame = { HeadTop: 0, Chin: im.originalHeight / im.originalWidth < 1.15 ? 0.38 : 0.15 };
                } finally { if (texture) texture.destroy(true); }
            }
            model.update(0);
            entry.face = galInitFace(model);
            live2dStartIdle(model, () => entry.updateSeconds || 0, entry.idle.jitter);
            model.internalModel.on('afterMotionUpdate', () => galApplyStageHead(model.internalModel.coreModel, entry.lookOn ? entry.look : 0, entry.param));
            // figure-life (figure-idle.cjs): drift / attention / saccade offsets and the tap flinch, before physics like the head offsets.
            const idleIds = {};
            model.internalModel.on('afterMotionUpdate', () => applyIdle(entry, model, idleIds));
            // Lip sync, including silent syllables (zero), wins over motion/expression mouth curves.
            const lipSyncIds = galLipSyncIds(model.internalModel.settings);
            model.internalModel.on('beforeModelUpdate', function () {
                const core = model.internalModel.coreModel;
                if (!entry.reducedMotion) galApplyLipSync(core, lipSyncIds, entry);
                entry.faceAngles = Object.fromEntries(['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamBodyAngleX', 'ParamBodyAngleZ'].map(id => [id, core.getParameterValueById(id)]));
                // The shy emotion's blush (stage input `blush`, asset-pack-presentation.js): this event follows
                // expressions/saveParameters, so it never accumulates or overwrites an expression's own blush.
                const cheek = entry.face.cheek, now = state.clock;
                entry.blushAmount = galBlushStep(entry.blushAmount || 0, entry.figure && (entry.figure.blush || entry.tapBlush > performance.now() && !entry.figure.speaking) ? 1 : 0, Math.max(0, Math.min(0.1, (now - (entry.blushAt ?? now)) / 1000)), entry.reducedMotion);
                entry.blushAt = now;
                if (cheek >= 0 && entry.blushAmount > 0) core.setParameterValueByIndex(cheek, galCheekValue(core.getParameterValueByIndex(cheek), entry.blushAmount, typeof core.getParameterDefaultValue === 'function' ? core.getParameterDefaultValue(cheek) : Math.max(0, core.getParameterMinimumValue(cheek)), core.getParameterMaximumValue(cheek)));
            });
            entry.container.addChild(model);
            entry.mood = null;
            live2dExpress(entry, entry.figure);
            commit(entry);
        }, function (error) {
            textures.end();
            entry.loading = false; entry.failed = true;
            if (!entry.dead && !closed) onError(live2dLoadError(error));
        });
    }
    // afterMotionUpdate, after galApplyStageHead: offsets on top of the motion layers and director head, before physics.
    function applyIdle(entry, model, ids) {
        const desc = state.desc;
        if (!lifeOn(desc) || entry.dead || !figuresBox.visible || galBlinkCalm()) return;
        const core = model.internalModel.coreModel, dt = Math.min(0.05, entry.updateSeconds || 0), figure = entry.figure;
        const add = (id, value) => {
            if (!value) return;
            if (ids[id] === undefined) { const index = core.getParameterIndex(id); ids[id] = index >= 0 && index < core.getParameterCount(); }
            if (ids[id]) core.addParameterValueById(id, value);
        };
        const offsets = idle.galLive2dIdleStep(entry.idle, dt, Boolean(figure.speaking), Boolean(entry.lookOn && entry.look));
        for (const id in offsets) add(id, offsets[id] * idle.FIGURE_LIFE.live2dGain);
        const frame = tap.galTapFrame(entry.tapReaction, state.clock, false);
        if (frame.flinch) {
            const pat = entry.tapReaction.region === 'head';
            add('ParamAngleY', (pat ? -9 : 6) * frame.flinch);
            add('ParamAngleZ', frame.tilt * (pat ? 7 : 4));
            add('ParamBodyAngleX', -frame.tilt * 4);
            add('ParamBodyAngleY', (pat ? -3 : 4) * frame.flinch);
        }
    }
    function tapSquash(entry, model, now) {
        const frame = tap.galTapFrame(entry.tapReaction, now, galBlinkCalm()), body = entry.restBody;
        if (!body || (frame.scaleY === 1 && frame.scaleX === 1 && !frame.dx)) return;
        const k = 0.7, sx = 1 + (frame.scaleX - 1) * k, sy = 1 + (frame.scaleY - 1) * k;
        const px = body.x + body.width / 2, py = body.y + body.height;
        model.x = px + (model.x - px) * sx + frame.dx * body.width;
        model.y = py + (model.y - py) * sy;
        model.scale.set(model.scale.x * sx, model.scale.y * sy);
    }
    function tick(entry, figure, desc, {now, W, H, framing, reducedHop}) {
        const model = entry.model;
        entry.reducedMotion = desc.reducedMotion === true;
        if (model.internalModel.motionManager.forkMotionLayers) model.internalModel.motionManager.forkMotionLayers.reduced = entry.reducedMotion;
        if (figure.act && figure.act.nonce !== entry.actNonce) { entry.actNonce = figure.act.nonce; live2dStartAct(entry, figure.act.name, now); }
        const act = live2dActFrame(entry, now, reducedHop, moves);
        entry.param = act;
        const sizingInput = entry.figureSizing ? { ...entry.figureSizing, ...framing } : null;
        const physical = live2dPlace(model, W, H, entry.cx.v, false, false, 1, 1, sizingInput);
        entry.figureResolved = model.forkFigureSizing || { mode: 'legacy' };
        const im = model.internalModel, hf = live2dHeadFrame(model), mh = im.originalHeight || 3100, s = Math.abs(model.scale.y);
        entry.restBody = { x: model.x, y: model.y, width: (im.originalWidth || 2400) * s, height: mh * s };
        entry.restHead = { x: W * entry.cx.v, top: model.y + hf.HeadTop * mh * s, chin: model.y + hf.Chin * mh * s, width: (hf.Chin - hf.HeadTop) * mh * s };
        if (physical?.restHead) entry.restHead = physical.restHead;
        // The rest head in the figure's own space, before the stage moves its container: the bust frames it (bust.cjs).
        entry.localHead = entry.restHead;
        // REST bounds in model pixels; the clamp applies the actual act/focus/container
        // transforms without forcing another walk of Cubism's deforming drawables.
        const head = entry.restHead;
        entry.clampLocalHead = { x: (head.x - model.x) / model.scale.x, top: (head.top - model.y) / model.scale.y,
            chin: (head.chin - model.y) / model.scale.y, width: head.width / Math.abs(model.scale.x) };
        const placed = live2dPlace(model, W, H, entry.cx.v + (physical ? 0 : act.dx), false, false, (act.zoom || 1), act.flip, sizingInput);
        model.x += act.px;
        if (placed?.mode === 'physical') {
            // All physical action displacement uses the pose span, not canvas padding or stage H.
            model.x += act.dx * physical.poseSpan + placed.supportX * model.scale.x * (1 - (act.scaleX || 1));
            model.y += act.dy * physical.poseSpan + placed.feet * model.scale.y * (1 - (act.scaleY || 1));
            model.scale.set(model.scale.x * (act.scaleX || 1), model.scale.y * (act.scaleY || 1));
        } else if (act.hop) live2dApplyHop(model, act);
        else model.y += act.dy * H;
        tapSquash(entry, model, now);
        galPlayMoodMotion(entry, figure, now, desc.snap || desc.skipping);
        live2dExpress(entry, figure);
        // Audio pauses must close the mouth, not fall back to synthetic speech.
        const voiced = figure.speaking ? lipSync.level(figure.audio) : 0;
        entry.mouthActive = figure.speaking && (Boolean(figure.audio) || figure.talking);
        entry.mouth = figure.audio ? voiced : figure.speaking && figure.talking ? syntheticMouth(entry, now) : 0;
        // A skin that draws no figures (figures.mode none) only animates the one its bust shows (not a sprite source's
        // picture; and the call view its own).
        if (entry.container.visible && (desc.figureMode !== 'none' || figure.alias === desc.bust?.alias && !desc.bust.still || figure.offstage)) {
            entry.updateSeconds = app.ticker.deltaMS * state.timeScale / 1000; model.update(entry.updateSeconds * 1000);
        }
    }
    // Emote-layer pixels: the deforming face mesh with its rotation, else the head frame turned by the face angles.
    function head(entry, exact) {
        const model = entry.model, im = model.internalModel, face = entry.face;
        galFlushFace(model);
        const Wm = im.originalWidth || 2400, Hm = im.originalHeight || 3100, frame = live2dHeadFrame(model);
        const local = im.localTransform.clone();
        const matrix = galDisplayMatrix(model, emotesBox, local);
        let box;
        if (face && face.indices.length) {
            const arrays = face.indices.map(i => im.coreModel.getDrawableVertices(i));
            const unit = im.pixelsPerUnit;
            const meshMatrix = { a: matrix.a * unit, b: matrix.b * unit, c: -matrix.c * unit, d: -matrix.d * unit,
                tx: matrix.a * Wm / 2 + matrix.c * Hm / 2 + matrix.tx, ty: matrix.b * Wm / 2 + matrix.d * Hm / 2 + matrix.ty };
            const angle = galMeshRotation(face.reference, arrays), x = Math.cos(angle), y = Math.sin(angle);
            let rotation = Math.atan2(meshMatrix.b * x + meshMatrix.d * y, meshMatrix.a * x + meshMatrix.c * y);
            if (rotation > Math.PI / 2) rotation -= Math.PI;
            if (rotation < -Math.PI / 2) rotation += Math.PI;
            box = galMeshHead(arrays, meshMatrix, rotation);
        }
        if (!box) {
            const hh = (frame.Chin - frame.HeadTop) * Hm;
            const fallback = galFallbackHead({ x: Wm / 2, top: frame.HeadTop * Hm, chin: frame.Chin * Hm, width: hh * 0.95 }, entry.faceAngles);
            const cy = (fallback.top + fallback.chin) / 2, c = Math.cos(fallback.rotation), s = Math.sin(fallback.rotation);
            const vertices = [];
            for (const x of [-fallback.width / 2, fallback.width / 2]) for (const y of [-hh / 2, hh / 2]) vertices.push(fallback.x + c * x - s * y, cy + s * x + c * y);
            const rotation = Math.atan2(-matrix.c, matrix.d) + fallback.rotation * Math.sign(matrix.a * matrix.d - matrix.b * matrix.c || 1);
            box = galMeshHead([vertices], matrix, rotation);
        }
        if (exact && entry.figureResolved?.mode === 'physical') {
            const record = entry.figureSizing?.metrics, m = { ...record?.auto, ...record?.override };
            const top = m.headTop ?? m.faceRect?.[1], chin = m.chin ?? (m.faceRect && m.faceRect[1] + m.faceRect[3]);
            if (chin > top) {
                const left = m.faceRect ? m.faceRect[0] : Wm / 2 - (chin - top) / 2, right = left + (m.faceRect ? m.faceRect[2] : chin - top);
                const restMatrix = galDisplayMatrix(model, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
                box = galFaceUnion([box, galMeshHead([[left, top, right, top, left, chin, right, chin]], restMatrix, 0)]);
            }
        }
        return box && face && !exact ? galSmoothHead(face, box, state.clock) : box;
    }
    function hit(entry, point) {
        return tap.galTapHitLive2d(entry.model, point, entry.model && live2dHeadFrame(entry.model), app.renderer, PIXI);
    }
    function react(entry, reaction, at, plan) {
        // Applied by live2dExpress, the one expression path (live2d.cjs).
        if (reaction.expression) entry.tapExpression = { name: reaction.expression, until: performance.now() + idle.FIGURE_LIFE.expressionMs };
        // A shy reaction blushes through the same emotion rule as a line's own shy emotion.
        entry.tapBlush = tap.GAL_TAP_EMOTION[plan.kind] === 'shy' ? performance.now() + idle.FIGURE_LIFE.expressionMs : 0;
        // The emotion's gesture, else the model's own Tap motion group (model3 TapHead / TapBody / Tap), else none.
        const motions = entry.model.internalModel.settings.motions || {}, layers = entry.model.internalModel.motionManager.forkMotionLayers;
        const group = reaction.motion && motions[reaction.motion] && motions[reaction.motion].length ? reaction.motion : tap.galTapMotionGroup(motions, at.region);
        // Lowest priority, and only on a free gesture track: a director or mood gesture always wins.
        if (group && !galBlinkCalm() && layers && !layers.gesture && !layers.pending) Promise.resolve(entry.model.motion(group, Math.floor(Math.random() * motions[group].length), 1)).catch(() => {});
    }
    function release(entry) {
        entries.delete(entry);
        const model = entry.model, releaseTextures = entry.releaseTextures;
        entry.model = null; entry.releaseTextures = null;
        if (model) model.destroy({ children: true });
        releaseTextures?.();
    }
    // The Core comes with the scene (desc.core) or from the user's import (runtime.core()); the runtime loads once.
    function set(desc) {
        const core = desc.core || runtimeCore();
        if (!core || core === live.core) return;
        live.core = core;
        if (live.ready || live.loading) return;
        live.loading = true;
        loadLive2dRuntime(core).then(() => { live.ready = true; live.loading = false; }, error => { live.loading = false; if (!closed) onError(String(error && error.message || error)); });
    }
    // A failed runtime load tries again on the next frame; failed models are retried by the scene (entry.failed).
    function reload() { if (!live.ready && !live.loading) live.core = ''; }
    function dispose() {
        if (closed) return;
        closed = true; scenes.delete(instance);
        const errors = [];
        for (const entry of [...entries]) try { release(entry); } catch (error) { errors.push(error); }
        try { app.renderer.off('prerender', useContext); live2dDropContext(gl); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Live2D figure cleanup failed');
    }
    const instance = { load, tick, head, hit, react, release, set, reload, dispose };
    scenes.add(instance);
    return instance;
}
return { renderer, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const instance of [...scenes]) try { instance.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Stage Live2D cleanup failed');
} };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { createStageLive2dFigures };
