// Live2D previews for the character modal.
// Same runtime path as the stage (loadLive2dRuntime → pixi-live2d-display, per-context Cubism shaders).
// A `source` is {identity, open()} where open() leases the bundle and resolves {url, core, close()}; the
// asset-pack factory builds it from the pack transport, so this file never sees packs or cards.

// Visible drawable bounds in model-local pixels (rest of the current frame). Falls back to the canvas.
function live2dDrawableBounds(model) {
    const im = model.internalModel, core = im.coreModel;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    try {
        const ids = im.getDrawableIDs(), transform = im.localTransform, point = { x: 0, y: 0 };
        for (let index = 0; index < ids.length; index++) {
            if (core.getDrawableOpacity(index) < 0.05 || !core.getDrawableDynamicFlagIsVisible(index)) continue;
            const vertices = im.getDrawableVertices(index);
            for (let i = 0; i < vertices.length; i += 2) {
                point.x = vertices[i]; point.y = vertices[i + 1];
                const p = transform.apply(point);
                if (p.x < left) left = p.x; if (p.x > right) right = p.x;
                if (p.y < top) top = p.y; if (p.y > bottom) bottom = p.y;
            }
        }
    } catch (_) { /* older runtimes: canvas fallback below */ }
    if (right > left && bottom > top) return { x: left, y: top, w: right - left, h: bottom - top };
    return { x: 0, y: 0, w: im.originalWidth || 2400, h: im.originalHeight || 3100 };
}
// Stage-card framing: a tall figure is shown knee-up (top 64% of its bounds), anything squarer whole;
// centred, standing on the card's floor line.
// `fit` (optional, the figure editor's FIGURE_FIT rule) = { share: the
// figure's height on the card, spill(aspect): how wide the drawn figure may be against the card }. Without it the card
// keeps its plain contain framing.
function live2dCardPlace(model, bounds, width, height, fit) {
    const tall = bounds.h / bounds.w > 1.7, shownH = tall ? bounds.h * 0.64 : bounds.h;
    const pad = Math.round(height * 0.05), spill = fit && typeof fit.spill === "function" ? fit.spill(bounds.w / shownH) : 1, share = fit && fit.share > 0 ? fit.share : 1;
    // A knee-up crop already frames the upper body; the height share applies to whole figures.
    const scale = Math.min((width * spill - pad * 2) / bounds.w, (height - pad * (tall ? 1 : 2)) * (tall ? 1 : share) / shownH);
    model.scale.set(scale, scale);
    model.x = width / 2 - (bounds.x + bounds.w / 2) * scale;
    model.y = tall ? pad - bounds.y * scale : height - pad - (bounds.y + bounds.h) * scale;
}
// face and outfit thumbnails share one head-anchored rule with the static pictures.
// The head box comes from the outfit's calibrated anatomy (canvas fractions), else the model's ForkStage HeadTop / Chin,
// else the usual estimate (top of the drawn figure, one head = 1/6.5 of its height). Its horizontal centre is the middle
// of the drawn ink inside the head band (10th–90th percentile), so a tail, a raised arm or a long ribbon on one side
// never pushes the face off-centre (大肥鱼's tail did, which read as a tilted head).
// 'cast' = the cast faces' CAST_FACE (head 62% from 10%, at most 7% of the figure's
// height under the chin), so a Live2D-only figure's face matches the static ones.
const LIVE2D_FRAMES = { face: { w: 1, h: 1, head: 0.8, top: 0.1 }, bust: { w: 3, h: 4, head: 0.42, top: 0.12 }, cast: { w: 1, h: 1, head: 0.62, top: 0.1, below: 0.07 } };
// A big head (chibi) shows only shoulders too: the head grows until no more than `below` of the figure shows under the chin.
function live2dFitFrame(frame, headH, figureH) {
    if (!frame.below || !(figureH > headH)) return frame;
    const need = (1 - frame.top) / (1 + frame.below * figureH / headH);
    return need > frame.head ? Object.assign({}, frame, { head: need }) : frame;
}
function live2dDerivedHead(a) {
    const per = Number(a.headsPerBody), feet = Number.isFinite(a.feet) ? a.feet : a.visibleBottom;
    return a.source === 'estimated' || (per > 0 && Number.isFinite(feet) && Number.isFinite(a.figureTop) && Math.abs(a.headTop - a.figureTop) < 0.002 && Math.abs((a.chin - a.headTop) - (feet - a.figureTop) / per) < 0.004);
}
function live2dHeadBox(model, bounds, anatomy) {
    const im = model.internalModel, core = im.coreModel, declared = im.settings && im.settings.json && im.settings.json.ForkStage;
    const H = im.originalHeight || 3100, W = im.originalWidth || 2400, t = im.localTransform;
    let top = bounds.y, chin = bounds.y + bounds.h / 6.5, source = "estimate";
    // An anatomy whose head is only derived from the figure height (headTop = figureTop, chin = one head of headsPerBody)
    // places the figure on stage but does not locate the face; the head hit area below beats it.
    const derived = anatomy && live2dDerivedHead(anatomy);
    let pair = anatomy && !derived && anatomy.chin > anatomy.headTop && anatomy.headTop >= 0 ? [anatomy.headTop, anatomy.chin]
        : declared && declared.Chin > declared.HeadTop && declared.HeadTop >= 0 ? [declared.HeadTop, declared.Chin] : null;
    if (pair) { top = t.apply({ x: W / 2, y: pair[0] * H }).y; chin = t.apply({ x: W / 2, y: pair[1] * H }).y; source = anatomy && !derived && anatomy.chin > anatomy.headTop && anatomy.headTop >= 0 ? "anatomy" : "declared"; }
    // without calibration, the model's own head hit area (HitAreaHead) marks the head —
    // the 1/6.5 estimate assumed a full-length figure, so knee-up models got faces cut at the eyes.
    let hitX = null;
    if (!pair) try {
        const ids = im.getDrawableIDs(), area = (im.settings.hitAreas || []).find(a => /head/i.test(a.Id || '') || /head|頭|头/i.test(a.Name || ''));
        const index = area ? ids.indexOf(area.Id) : -1, vertices = index >= 0 ? im.getDrawableVertices(index) : null;
        if (vertices && vertices.length >= 6) {
            let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity; const point = { x: 0, y: 0 };
            for (let i = 0; i < vertices.length; i += 2) { point.x = vertices[i]; point.y = vertices[i + 1]; const p = t.apply(point); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); }
            if (y1 - y0 > bounds.h * 0.04 && y1 - y0 < bounds.h * 0.6) { top = y0; chin = y1; hitX = (x0 + x1) / 2; source = "hit"; }
        }
    } catch (_) { /* no hit areas: estimate */ }
    if (hitX === null && !pair && derived && anatomy.chin > anatomy.headTop) { pair = [anatomy.headTop, anatomy.chin]; top = t.apply({ x: W / 2, y: pair[0] * H }).y; chin = t.apply({ x: W / 2, y: pair[1] * H }).y; source = "derived"; }
    const xs = [];
    try {
        const ids = im.getDrawableIDs(), hit = new Set((im.settings.hitAreas || []).map(area => area.Id)), point = { x: 0, y: 0 };
        for (let index = 0; index < ids.length; index++) {
            if (hit.has(ids[index]) || /(?:effect|sparkle|shadow|hitarea)/i.test(ids[index]) || core.getDrawableOpacity(index) < 0.05 || !core.getDrawableDynamicFlagIsVisible(index)) continue;
            const vertices = im.getDrawableVertices(index);
            for (let i = 0; i < vertices.length; i += 2) {
                point.x = vertices[i]; point.y = vertices[i + 1];
                const p = t.apply(point);
                if (p.y >= top && p.y <= chin) xs.push(p.x);
            }
        }
    } catch (_) { /* older runtimes: bounds centre below */ }
    xs.sort((a, b) => a - b);
    const cx = hitX !== null ? hitX : xs.length > 8 ? (xs[Math.floor(xs.length * 0.1)] + xs[Math.floor(xs.length * 0.9)]) / 2 : bounds.x + bounds.w / 2;
    // source: where the head came from - "anatomy" / "declared" (ForkStage) / "hit" (the head hit area) locate it;
    // "derived" / "estimate" only restate the figure's height (figureMeasureLive2dHead keeps only the first three).
    return { top, chin: Math.max(chin, top + 1), cx, source };
}
function live2dFramePlace(model, head, frame, width, height) {
    const scale = height * frame.head / (head.chin - head.top);
    model.scale.set(scale, scale);
    model.x = width / 2 - head.cx * scale;
    model.y = height * frame.top - head.top * scale;
}
// Expression-grid face framing (kept for callers outside the editor): the head fills about 80% of the square.
function live2dFacePlace(model, bounds, size, anatomy) {
    live2dFramePlace(model, live2dHeadBox(model, bounds, anatomy), LIVE2D_FRAMES.face, size, size);
}
// the user's view on top of the card framing — zoom around the box centre, then pan (CSS pixels).
function live2dApplyView(model, view, width, height) {
    if (!view || (view.zoom === 1 && !view.x && !view.y)) return;
    const cx = width / 2, cy = height / 2;
    model.scale.set(model.scale.x * view.zoom, model.scale.y * view.zoom);
    model.x = cx + (model.x - cx) * view.zoom + view.x;
    model.y = cy + (model.y - cy) * view.zoom + view.y;
}
// Expression by name like the stage (live2dExpress): '' means the model's own neutral, else a reset.
function live2dPreviewExpress(model, name) {
    const neutral = (model.internalModel.settings.expressions || []).some(item => item.Name === "neutral") ? "neutral" : "";
    const target = name || neutral, manager = model.internalModel.motionManager.expressionManager;
    if (target) return Promise.resolve(model.expression(target)).catch(() => false);
    if (manager) { manager.resetExpression(); manager.currentExpression = manager.defaultExpression; }
    return Promise.resolve(true);
}

// pixi-live2d-display's Cubism 4 breath also swings ParamAngleX/Y/Z and
// ParamBodyAngleX (head roll up to ±10° on a ~5.5 s sine), and most idle motions roll the body too. Face and outfit
// snapshots keep only the chest breath, so the still stands upright; blink and physics stay.
function live2dUpright(model) {
    const im = model.internalModel, breath = im && im.breath;
    if (breath && typeof breath.getParameters === "function" && typeof breath.setParameters === "function")
        breath.setParameters((breath.getParameters() || []).filter(item => item.parameterId === im.idParamBreath));
}

// The last first-frame of each model (bundle identity + expression), kept for the page's lifetime (bounded): reopening
// the modal paints it at once and the live model cross-fades in over it.
const live2dPreviewFrames = new Map();
function live2dRememberFrame(key, frame) {
    live2dPreviewFrames.delete(key); live2dPreviewFrames.set(key, frame);
    while (live2dPreviewFrames.size > 24) { const [old, gone] = live2dPreviewFrames.entries().next().value; live2dPreviewFrames.delete(old); if (gone && gone.blob && typeof URL !== "undefined" && URL.revokeObjectURL) URL.revokeObjectURL(gone.url); }
}
// The card's pixi application and its WebGL context (shaders included) go together.
function live2dPreviewDestroy(current) {
    const app = current.app; if (!app) return;
    const gl = app.renderer && app.renderer.gl;
    current.stopRatio(); app.destroy(true, { children: true }); live2dDropContext(gl);
    current.app = null; current.pixi = null; current.model = null; current.bounds = null;
}
// the first frame is remembered once per model + expression, and
// encoded off the main thread (toBlob reads the pixels now, encodes on a worker) — a synchronous toDataURL of the whole
// card (WebP, device pixels) was the longest task of every outfit switch. A context without toBlob keeps toDataURL.
function live2dCaptureFrame(view, key, width, height) {
    if (live2dPreviewFrames.has(key)) return;
    if (typeof view.toBlob === "function" && typeof URL !== "undefined" && URL.createObjectURL) {
        live2dPreviewFrames.set(key, null); // pending: one capture per key
        view.toBlob(function (blob) {
            if (!blob) { if (live2dPreviewFrames.get(key) === null) live2dPreviewFrames.delete(key); return; }
            live2dRememberFrame(key, { url: URL.createObjectURL(blob), blob: true, width, height });
        }, "image/webp", 0.9);
        return;
    }
    live2dRememberFrame(key, { url: view.toDataURL("image/webp", 0.9), width, height });
}
// Live, animated preview: one small pixi canvas, current expression, and the stage's own idle (live2dStartIdle:
// the Idle group looping, blink and breath under it, `motion` played once over it as on stage).
// props: { source, expression, motion, fallback, label, interactive }.
// interactive: wheel zooms around the cursor, dragging pans (like the still previews; the model no longer
// looks toward the cursor), double-click resets the view. No flash: while loading the card shows this
// model's last first-frame, else its own floor with the shared Spinner centred on it once the load has taken longer
// than SPINNER_DELAY_MS (a cached load never flashes it); the canvas is hidden until its first frame has rendered
// with the expression applied, then fades in while the spinner fades out. The fallback (a static picture) is only for a model that
// cannot load.
function Live2dFigurePreview(props) {
    const h = React.createElement, coreRevision = useCubismRevision();
    const host = React.useRef(null), root = React.useRef(null), state = React.useRef({ app: null, model: null, bounds: null, close: null, expressed: false, view: { zoom: 1, x: 0, y: 0 } });
    const [status, setStatus] = React.useState("loading");
    // The latest props for long-lived callbacks (the ticker, the view listeners).
    const latest = React.useRef(props); latest.current = props;
    // "hidden" → "in" (fading in over the still) → "shown" (still removed).
    const [reveal, setReveal] = React.useState("hidden");
    const source = props.source;
    const frameKey = (source && source.identity || "") + "\n" + (props.expression || "");
    // The remembered frame for this model, chosen once per bundle identity (not per render).
    const stillRef = React.useRef(null);
    if (!stillRef.current || stillRef.current.identity !== (source && source.identity)) stillRef.current = { identity: source && source.identity, frame: live2dPreviewFrames.get(frameKey) || null };
    const still = stillRef.current.frame;
    // one pixi application (one WebGL context, its compiled
    // shaders) serves every model this card shows; a new model (another outfit) swaps in on the same canvas. Creating and
    // losing a context per outfit cost a shader compile on load and a context teardown inside the click. The application
    // goes with the card (or with a new Cubism runtime).
    React.useEffect(function () {
        let live = true, model = null, tick = null;
        setStatus("loading"); setReveal("hidden");
        const current = state.current;
        current.expressed = false;
        // A new model starts at the card's own framing.
        if (current.view.zoom !== 1 || current.view.x || current.view.y) {
            current.view.zoom = 1; current.view.x = 0; current.view.y = 0;
            if (typeof latest.current.onView === "function") latest.current.onView({ zoom: 1, x: 0, y: 0 });
        }
        (async function () {
            // `delay` (ms) lets a quick switch paint first and skips the loads of models
            // switched past (the card shows the remembered frame or the spinner meanwhile).
            if (props.delay > 0) { await new Promise(resolve => setTimeout(resolve, props.delay)); if (!live) return; }
            const opened = await source.open();
            if (!live) { opened.close?.(); return; }
            current.close = opened.close;
            const PIXI = await loadLive2dRuntime(opened.core);
            if (!live || !host.current) return;
            if (!PIXI) { current.close?.(); current.close = null; setStatus("missing"); return; }
            if (current.app && current.pixi !== PIXI) live2dPreviewDestroy(current);
            if (!current.app) {
                const created = new PIXI.Application({ resizeTo: host.current, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: galResolution("high") });
                created.renderer.on("prerender", () => live2dUseContext(created.renderer.gl));
                current.app = created; current.pixi = PIXI; current.stopRatio = galFollowResolution(created);
                host.current.appendChild(created.view);
            }
            const app = current.app;
            model = await PIXI.live2d.Live2DModel.from(opened.url, { autoInteract: false, idleMotionGroup: "__none__" });
            if (!live || current.app !== app) { model.destroy({ children: true }); model = null; return; }
            current.model = model;
            live2dStartIdle(model);
            // `audio` (a voice the editor plays) opens the mouth like the stage does —
            // forkLipSync's level of that element on the model's LipSync parameters, set before each model update so it wins
            // over idle / expression mouth curves; without audio the model's own idle mouth is back.
            if (typeof forkLipSync !== "undefined" && typeof galLipSyncIds === "function" && typeof model.internalModel.on === "function") {
                const lipIds = galLipSyncIds(model.internalModel.settings);
                model.internalModel.on("beforeModelUpdate", function () {
                    const audio = latest.current.audio;
                    if (audio) galApplyLipSync(model.internalModel.coreModel, lipIds, { mouthActive: true, mouth: forkLipSync.level(audio) });
                });
            }
            model.alpha = 0;
            app.stage.addChild(model);
            // Bounds after the first drawn frame (vertices exist only once the core has updated).
            // The first visible frame waits for the expression, so the card never shows a neutral face first.
            app.ticker.add(tick = function () {
                if (current.model !== model) return;
                if (!current.bounds) {
                    if (!current.expressed || !model.internalModel.coreModel) return;
                    current.bounds = live2dDrawableBounds(model); model.alpha = 1;
                    // Right after that frame is drawn (same task, so the drawing buffer is still readable): remember it
                    // for the next open and reveal the canvas.
                    app.renderer.once("postrender", function () {
                        if (!live || current.app !== app || current.model !== model) return;
                        try { live2dCaptureFrame(app.view, frameKey, app.screen.width, app.screen.height); } catch (_) { /* tainted or lost context: no still next time */ }
                        setStatus("ready"); setReveal("in");
                    });
                }
                live2dCardPlace(model, current.bounds, app.screen.width, app.screen.height, latest.current.fit);
                live2dApplyView(model, current.view, app.screen.width, app.screen.height);
            });
            await live2dPreviewExpress(model, props.expression || "");
            current.expressed = true;
        })().catch(function (error) { if (live) { console.warn("Live2D preview", error); setStatus("error"); } });
        return function () {
            live = false;
            current.expressed = false;
            const app = current.app;
            if (app && tick) app.ticker.remove?.(tick);
            if (model) { app?.stage.removeChild?.(model); model.destroy({ children: true }); }
            if (current.model === model) current.model = null;
            current.bounds = null;
            current.close?.(); current.close = null;
        };
    }, [source && source.identity, coreRevision]);
    // The application leaves with the card — a task later, so a click that hides the card (a 立绘-only outfit) paints first.
    React.useEffect(() => () => { const current = state.current; setTimeout(() => live2dPreviewDestroy(current), 0); }, []);
    // Expression (and its gesture, once) follow the selected emotion.
    React.useEffect(function () {
        const model = state.current.model;
        if (status !== "ready" || !model) return;
        live2dPreviewExpress(model, props.expression || "");
        if (props.motion && (model.internalModel.settings.motions || {})[props.motion]) model.motion(props.motion, 0, 2);
    }, [status, props.expression, props.motion]);
    // Off screen (scrolled away inside the modal): stop drawing.
    React.useEffect(function () {
        if (typeof IntersectionObserver === "undefined" || !host.current) return;
        const io = new IntersectionObserver(function (entries) {
            const app = state.current.app; if (!app) return;
            if (entries.some(e => e.isIntersecting)) app.ticker.start(); else app.ticker.stop();
        });
        io.observe(host.current);
        return () => io.disconnect();
    }, [status]);
    // View controls. Listeners sit on the preview box (wheel must be non-passive to keep the modal from scrolling).
    // a left or middle drag pans; on touch one finger pans and two pinch.
    // `viewRef` (optional) receives { zoom(factor), reset() } for on-card buttons; `onView` hears every view change.
    React.useEffect(function () {
        const el = root.current;
        if (!props.interactive || !el || typeof el.addEventListener !== "function") return;
        const current = state.current, view = current.view, touches = new Map();
        let drag = null;
        const report = () => { const onView = latest.current.onView; if (typeof onView === "function") onView({ zoom: view.zoom, x: view.x, y: view.y }); };
        const local = event => { const r = el.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top, w: r.width, h: r.height }; };
        // Zoom to `next`, keeping the point (px from the box centre) where it is.
        const zoomAt = (next, px, py) => { next = Math.min(4, Math.max(0.5, next)); view.x = px - (px - view.x) * next / view.zoom; view.y = py - (py - view.y) * next / view.zoom; view.zoom = next; };
        function wheel(event) {
            if (!current.model) return;
            event.preventDefault();
            const p = local(event);
            // Keep the point under the cursor in place.
            zoomAt(view.zoom * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015), p.x - p.w / 2, p.y - p.h / 2); report();
        }
        const pinchOf = () => { const list = [...touches.values()]; return list.length < 2 ? null : { d: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) || 1, x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 }; };
        function down(event) {
            if (!current.model || (event.button !== 0 && event.button !== 1)) return;
            event.preventDefault();
            try { el.focus({ preventScroll: true }); } catch (_) { /* not focusable */ }
            try { el.setPointerCapture(event.pointerId); } catch (_) { /* synthetic events */ }
            if (event.pointerType === "touch") {
                touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const pinch = pinchOf();
                drag = pinch ? { mode: "pinch", pinch, zoom: view.zoom } : { mode: "pan", x: event.clientX, y: event.clientY, id: event.pointerId };
            } else drag = { mode: "pan", x: event.clientX, y: event.clientY, id: event.pointerId };
            el.dataset.drag = "pan";
        }
        function move(event) {
            if (!drag) return;
            if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (drag.mode === "pinch") {
                const now = pinchOf(); if (!now) return;
                const r = el.getBoundingClientRect();
                zoomAt(drag.zoom * now.d / drag.pinch.d, now.x - r.left - r.width / 2, now.y - r.top - r.height / 2);
                view.x += now.x - drag.pinch.x; view.y += now.y - drag.pinch.y; drag.pinch = { ...now, d: drag.pinch.d }; report(); return;
            }
            if (event.pointerId !== drag.id) return;
            view.x += event.clientX - drag.x; view.y += event.clientY - drag.y; drag.x = event.clientX; drag.y = event.clientY; report();
        }
        function up(event) {
            touches.delete(event.pointerId);
            if (!drag) return;
            if (drag.mode === "pinch") { const [id, p] = [...touches.entries()][0] || []; drag = id === undefined ? null : { mode: "pan", x: p.x, y: p.y, id }; if (!drag) delete el.dataset.drag; return; }
            if (event.pointerId !== drag.id) return;
            drag = null; delete el.dataset.drag;
        }
        function reset() { view.zoom = 1; view.x = 0; view.y = 0; report(); }
        function key(event) {
            const moves = { ArrowLeft: [24, 0], ArrowRight: [-24, 0], ArrowUp: [0, 24], ArrowDown: [0, -24] }[event.key];
            if (moves) { event.preventDefault(); view.x += moves[0]; view.y += moves[1]; report(); }
            else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(view.zoom * 1.25, 0, 0); report(); }
            else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomAt(view.zoom / 1.25, 0, 0); report(); }
            else if (event.key === "0" || event.key === "Home") { event.preventDefault(); reset(); }
        }
        const viewRef = latest.current.viewRef;
        if (viewRef) viewRef.current = { zoom: factor => { zoomAt(view.zoom * factor, 0, 0); report(); }, reset };
        el.addEventListener("keydown", key);
        const aux = event => { if (event.button === 1) event.preventDefault(); };
        el.addEventListener("wheel", wheel, { passive: false });
        el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
        el.addEventListener("dblclick", reset); el.addEventListener("auxclick", aux);
        return function () {
            el.removeEventListener("wheel", wheel); el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); el.removeEventListener("dblclick", reset); el.removeEventListener("auxclick", aux);
            el.removeEventListener("keydown", key);
            if (viewRef && viewRef.current && viewRef.current.reset === reset) viewRef.current = null;
        };
    }, [props.interactive, status]);
    // The still leaves once the canvas has faded in (animationend; a timer covers reduced motion / no animation).
    React.useEffect(function () {
        if (reveal !== "in") return;
        const timer = setTimeout(() => setReveal("shown"), 400);
        return () => clearTimeout(timer);
    }, [reveal]);
    const under = status === "error" || status === "missing" ? props.fallback || null
        : reveal !== "shown" && still ? h("img", { className: "fork-live2d-preview-still", src: still.url, alt: "", draggable: false, style: { width: still.width + "px", height: still.height + "px" } }) : null;
    // The spinner (no remembered still) stays mounted through the canvas fade-in so one already showing fades out
    // underneath (`out`; one not yet showing never appears); it is gone once the canvas is shown.
    const ring = !still && status !== "error" && status !== "missing" && reveal !== "shown";
    return h("div", { ref: root, className: "fork-live2d-preview", "data-status": status, "data-interactive": props.interactive || undefined, role: status === "missing" ? "group" : "img", "aria-label": props.label || "Live2D", "aria-busy": status === "loading" || undefined,
            tabIndex: props.interactive && status === "ready" ? 0 : undefined,
            title: props.interactive && status === "ready" ? "拖动平移 · 滚轮缩放 · 双击复位" : undefined },
        under ? h("div", { className: "fork-live2d-preview-fallback" }, under) : null,
        status === "missing" && h(CubismCoreEntry, { request: rpc }),
        h("div", { className: "fork-live2d-preview-canvas", ref: host, "aria-hidden": true, "data-reveal": reveal,
            onAnimationEnd: event => { if (event.target === event.currentTarget) setReveal("shown"); } }),
        ring ? h(Spinner, { key: source && source.identity || "", fill: true, className: "fork-live2d-preview-wait", out: status !== "loading" }) : null);
}

// One shared offscreen renderer snapshots each expression's face once; results are small cached data URLs
// keyed by bundle identity + expression name, kept for the page's lifetime (bounded). Jobs run one at a time.
// `frame`: 'face' (square, emotion faces) or 'bust' (3:4 head-and-shoulders, outfit tiles); see live2dHeadBox.
const live2dSnapshots = (function () {
    const SIZE = 128, LIMIT = 160, cache = new Map(), jobs = new Map();
    let renderer = null, queue = Promise.resolve(), idleTimer = null;
    const frameOf = frame => LIVE2D_FRAMES[frame] ? frame : "face";
    const keyOf = (identity, name, frame) => identity + "\n" + frameOf(frame) + "\n" + (name || "");
    // snapshots are object URLs of off-thread encoded WebP (toBlob), revoked when evicted.
    function remember(key, url) { cache.delete(key); cache.set(key, url); while (cache.size > LIMIT) { const [old, gone] = cache.entries().next().value; cache.delete(old); if (/^blob:/.test(gone) && URL.revokeObjectURL) URL.revokeObjectURL(gone); } }
    const encode = view => typeof view.toBlob === "function" && typeof URL !== "undefined" && URL.createObjectURL
        ? new Promise((resolve, reject) => view.toBlob(blob => blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("snapshot encode failed")), "image/webp", 0.92))
        : Promise.resolve(view.toDataURL("image/webp", 0.92));
    // One expression per task: the page stays responsive while a roster is being shot.
    const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
    function dropRendererLater() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
            if (!renderer) return;
            const gl = renderer.gl; renderer.destroy(true); live2dDropContext(gl); renderer = null;
        }, 20000);
    }
    async function shoot(source, names, frame) {
        const opened = await source.open();
        let model = null;
        try {
            const PIXI = await loadLive2dRuntime(opened.core);
            if (!PIXI) return {};
            clearTimeout(idleTimer);
            if (!renderer) renderer = new PIXI.Renderer({ width: SIZE, height: SIZE, backgroundAlpha: 0, antialias: true, preserveDrawingBuffer: true, resolution: 1 });
            live2dUseContext(renderer.gl);
            model = await PIXI.live2d.Live2DModel.from(opened.url, { autoInteract: false, autoUpdate: false, idleMotionGroup: "__none__" });
            // Open eyes in every snapshot; no idle motion. Face framing = the stage's face window.
            model.internalModel.eyeBlink = undefined;
            live2dUpright(model);
            const settle = () => { for (let step = 0; step < 24; step++) { model.update(100); model.internalModel.update(model.deltaTime, model.elapsedTime); model.deltaTime = 0; } };
            settle();
            const shape = LIVE2D_FRAMES[frameOf(frame)], width = Math.round(SIZE * shape.w / Math.max(shape.w, shape.h) * (shape.h > shape.w ? 1.5 : 1)), height = Math.round(width * shape.h / shape.w);
            const bounds = live2dDrawableBounds(model), head = live2dHeadBox(model, bounds, source.anatomy), fit = live2dFitFrame(shape, head.chin - head.top, bounds.h);
            const out = {};
            for (const name of names) {
                await yieldTask();
                await live2dPreviewExpress(model, name);
                // Let the expression fade in fully (exp3 fades are about 1 s); physics settles meanwhile.
                settle();
                live2dUseContext(renderer.gl);
                if (renderer.width !== width || renderer.height !== height) renderer.resize(width, height);
                live2dFramePlace(model, head, fit, width, height);
                renderer.render(model);
                out[name || ""] = await encode(renderer.view);
            }
            return out;
        } finally {
            if (model) model.destroy({ children: true });
            opened.close?.();
            dropRendererLater();
        }
    }
    return {
        // Cached snapshots now (name → url), without loading anything.
        peek(identity, names, frame) { const out = {}; for (const name of names) { const url = cache.get(keyOf(identity, name, frame)); if (url) out[name || ""] = url; } return out; },
        // Resolves {name → url} for every requested expression; failures reject (callers fall back to a list).
        request(source, names, frame) {
            const wanted = [...new Set(names.map(name => name || ""))], missing = wanted.filter(name => !cache.has(keyOf(source.identity, name, frame)));
            if (!missing.length) return Promise.resolve(this.peek(source.identity, wanted, frame));
            const jobKey = source.identity + "\n" + frameOf(frame) + "\n" + missing.join("\u0001");
            if (!jobs.has(jobKey)) {
                const job = queue.then(() => shoot(source, missing, frame)).then(function (shots) {
                    for (const [name, url] of Object.entries(shots)) remember(keyOf(source.identity, name, frame), url);
                }).finally(() => jobs.delete(jobKey));
                queue = job.catch(() => {});
                jobs.set(jobKey, job);
            }
            return jobs.get(jobKey).then(() => this.peek(source.identity, wanted, frame));
        }
    };
})();
const LIVE2D_PREVIEW_KIT = { Preview: Live2dFigurePreview, snapshots: live2dSnapshots, useRevision: useCubismRevision };
