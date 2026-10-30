// the stage's scene renderer. One pixi Application draws
// everything behind the DOM text box: backgrounds, figures (Live2D models and static portraits), the
// camera and the screen overlays. GalStage hands it a plain scene description every render; the
// pixi side eases towards it in its own ticker, so paging never re-renders pixi objects.
//
// Display tree (filters attach to any of these through galFilterChain):
//   stage
//   ├─ world       camera: the shot's focus point, zoom, rotation, shake offset. filters: the stage look
//   │  │           (grade, bloom, screen, film; gal-looks.js), beat blur / glitch / shockwave
//   │  ├─ backdrop background layers (current + incoming, transition masks; each picture carries its
//   │  │           own time-of-day correction) and the vignette. filters: depth-of-field / dream blur
//   │  ├─ backFx   weather particles behind the figures
//   │  ├─ figures  sortable; one container per figure (Live2D model or portrait sprites). filters: one
//   │  │           colour matrix (time grade, figure light, speaker lighting, alpha), rim glow, blur
//   │  ├─ frontFx  weather particles in front of the figures
//   │  └─ emotes   emote stickers above heads
//   └─ overlay     screen space: transition cover, look overlays (vignette, haze, leaks, flare), flashes,
//                  lightning, blackout

// @include stage-resolution.js
// @include sprite-blink.cjs
// @include spine.js
// @include spine-preview.js
// @include gal-idle.js

// Stage-keyed readers expose geometry, never Pixi nodes or mutable scene state.
const galFigureSources = new WeakMap();

// ---------- Scene helpers (pure; gal-scene-helpers.cjs) ----------
// @include gal-scene-helpers.cjs
// ---------- Scene runtime (pixi) ----------

// Machine preference: stage effects quality, "high" (default) or "low".
const stageQuality = (function () {
    const KEY = "fork-stage-quality";
    const listeners = new Set();
    function get() { try { return localStorage.getItem(KEY) === "low" ? "low" : "high"; } catch (_) { return "high"; } }
    return {
        get,
        set(value) { try { localStorage.setItem(KEY, value === "low" ? "low" : "high"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useStageQuality() { return React.useSyncExternalStore(stageQuality.subscribe, stageQuality.get); }

// Ordered, named filter slots on one container: set(name, filter) adds or replaces (null removes);
// disabled filters (filter.enabled = false) are skipped; no filters at all means no render pass.
// order: slot names in render order (unlisted names go last, in insertion order).
// singleSample: the chain's filters render without MSAA (a figure's: see the scene's tune()).
function galFilterChain(container, area, order, singleSample) {
    const slots = [];
    let signature = "";
    const rank = name => { const at = order ? order.indexOf(name) : -1; return at < 0 ? 1e6 : at; };
    const chain = {
        container,
        set(name, filter, options) {
            const at = slots.findIndex(slot => slot.name === name);
            if (at >= 0) slots.splice(at, 1);
            if (filter) {
                if (singleSample) { filter.forkSingleSample = true; filter.multisample = PIXI.MSAA_QUALITY.NONE; }
                const before = options && options.before ? slots.findIndex(slot => slot.name === options.before) : slots.findIndex(slot => rank(slot.name) > rank(name));
                if (before >= 0) slots.splice(before, 0, { name, filter }); else slots.push({ name, filter });
            }
            chain.refresh(true);
            return filter;
        },
        get(name) { const slot = slots.find(item => item.name === name); return slot ? slot.filter : null; },
        all() { return slots.map(slot => slot.filter); },
        refresh(force) {
            const active = slots.filter(slot => slot.filter.enabled !== false);
            const next = active.map(slot => slot.name).join(",");
            if (!force && next === signature) return;
            signature = next;
            container.filters = active.length ? active.map(slot => slot.filter) : null;
            if (area) container.filterArea = active.length ? area : null;
        }
    };
    return chain;
}
// A filter created on first use (make), disabled while inactive and destroyed after 3 s idle, so effects
// that are off cost nothing. store: { [key]: slot }; returns the live filter or null.
function galUseFilter(store, chain, name, make, active, now, tune) {
    let slot = store[name];
    if (active) {
        if (!slot) {
            let filter = null;
            try { filter = make(); } catch (error) { console.warn("[fork-gal-scene] filter", name, error); }
            if (!filter) return null;
            tune(filter);
            slot = store[name] = { chain, name, filter, idle: now };
            chain.set(name, filter);
        }
        slot.idle = now;
        if (slot.filter.enabled === false) { slot.filter.enabled = true; chain.refresh(); }
        return slot.filter;
    }
    if (slot) {
        if (slot.filter.enabled !== false) { slot.filter.enabled = false; chain.refresh(); }
        if (now - slot.idle > 3000 || now < slot.idle) { chain.set(name, null); slot.filter.destroy(); delete store[name]; }
    }
    return null;
}

// Generated textures: vignette, the empty stage gradient and the transition mask shapes.
function galCanvasTexture(PIXI, width, height, paint) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    paint(canvas.getContext("2d"), width, height);
    return PIXI.Texture.from(canvas);
}
function galMakeTextures(PIXI, host) {
    return {
        vignette: galCanvasTexture(PIXI, 640, 360, function (ctx, w, h) {
            ctx.save(); ctx.translate(w / 2, h * 0.4); ctx.scale(1.2, 1);
            const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.hypot(w / 2, h * 0.6) / 1.2);
            radial.addColorStop(0, "rgba(0,0,0,0)"); radial.addColorStop(0.55, "rgba(0,0,0,0)"); radial.addColorStop(1, "rgba(0,0,0,.45)");
            ctx.fillStyle = radial; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
            const floor = ctx.createLinearGradient(0, 0, 0, h);
            floor.addColorStop(0.58, "rgba(8,5,14,0)"); floor.addColorStop(1, "rgba(8,5,14,.55)");
            ctx.fillStyle = floor; ctx.fillRect(0, 0, w, h);
        }),
        empty: galCanvasTexture(PIXI, 640, 360, function (ctx, w, h) {
            stagePaintEmpty(ctx, w, h, stageEmptyPalette(host));
        }),
        wipe: galCanvasTexture(PIXI, 1024, 4, function (ctx, w, h) {
            const edge = ctx.createLinearGradient(0, 0, w, 0);
            edge.addColorStop(0, "rgba(255,255,255,1)"); edge.addColorStop(1 / 1.25, "rgba(255,255,255,1)"); edge.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
        }),
        iris: galCanvasTexture(PIXI, 512, 512, function (ctx, w, h) {
            const disc = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            disc.addColorStop(0, "rgba(255,255,255,1)"); disc.addColorStop(0.78, "rgba(255,255,255,1)"); disc.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = disc; ctx.fillRect(0, 0, w, h);
        })
    };
}



// The scene runtime: creates the pixi Application in host and follows set(description).
// follow rendered orientation, not a separate portrait-facing rule.
// Per-layer aliases keep outgoing speakers independent during face crossfades.
function galSyncFaceOrientation(root, figures) {
    if (!root) return;
    const scales = new Map();
    figures.forEach(entry => {
        const image = entry.sprite;
        if (image) scales.set(entry.figure.alias, image.scale.x < 0 ? "-1" : "1");
    });
    root.querySelectorAll("[data-face-actor]").forEach(node => {
        const flip = scales.get(node.getAttribute("data-face-actor")) || "1";
        if (node.style.getPropertyValue("--face-flip") !== flip) node.style.setProperty("--face-flip", flip);
    });
}
function galCreateScene(host, options) {
    const PIXI = window.PIXI;
    const onError = options.onError || function () {};
    const onDebug = options.onDebug || function () {};
    let quality = options.quality === "low" ? "low" : "high";
    const refreshRate = options.refreshRate || window.screen && window.screen.refreshRate;
    const app = new PIXI.Application({ resizeTo: host, backgroundColor: 0x0b0812, backgroundAlpha: 1, antialias: true, autoDensity: true,
        resolution: galResolution(quality), powerPreference: "high-performance" });
    host.appendChild(app.view);
    const gl = app.renderer.gl;
    
    // resizeTo resizes - and so clears - the canvas in its own animation frame; the paced
    // ticker may skip that vsync, which then shows an empty scene for a frame (leaving full screen flashed). Redraw now.
    app.renderer.on("resize", () => { if (!state.destroyed && state.desc) app.render(); });
    app.ticker.maxFPS = galFrameRate(quality, true, refreshRate, stageReading.get().frameCap);
    const tickerUpdate = app.ticker.update;
    const pace = { last: 0, next: 0, fps: 0, vsync: 0 };
    const generated = galMakeTextures(PIXI, host);
    const world = new PIXI.Container(), backdrop = new PIXI.Container(), layersBox = new PIXI.Container();
    const vignette = new PIXI.Sprite(generated.vignette);
    const backFx = new PIXI.Container(), figuresBox = new PIXI.Container(), frontFx = new PIXI.Container(), emotesBox = new PIXI.Container(), overlay = new PIXI.Container();
    figuresBox.sortableChildren = true;
    backdrop.addChild(layersBox, vignette);
    // the skin's inner-monologue backdrop (art.thinking; an original's
    // StoryEffectUnit::setThinking, layout order 2: over the background, under the figures at 4). Screen-fixed (tickThinking).
    const thinking = { sprite: new PIXI.Sprite(PIXI.Texture.EMPTY), image: null, texture: null, alpha: 0, at: 0 };
    thinking.sprite.anchor.set(0.5); thinking.sprite.visible = false;
    world.addChild(backdrop, thinking.sprite, backFx, figuresBox, frontFx, emotesBox);
    const cover = new PIXI.Sprite(PIXI.Texture.WHITE);
    cover.alpha = 0; cover.visible = false;
    // the open phone dims the scene behind it (backdrop, figures, effects alike).
    const phoneShade = new PIXI.Sprite(PIXI.Texture.WHITE);
    phoneShade.tint = 0; phoneShade.alpha = 0; phoneShade.visible = false;
    // blink: the two eyelids (galBlinkLids), drawn over the stage while a blink transition runs.
    const lids = new PIXI.Graphics();
    lids.visible = false;
    overlay.addChild(phoneShade, cover, lids);
    // the speaker's bust - their own figure (the same Live2D
    // model or picture, in its current outfit, mood and mouth) drawn once more into a texture the size of the skin's crop,
    // framed by its rest head box (tickBust). No second model and no camera; above the world and under the overlay (phone
    // shade, cover), so the DOM text box covers it as the original's box covers its bust.
    const bust = { sprite: new PIXI.Sprite(PIXI.Texture.EMPTY), texture: null, key: "", matrix: new PIXI.Matrix(), inverse: new PIXI.Matrix() };
    bust.sprite.visible = false;
    // the call view - each party framed by its rest head into a
    // texture the size of the phone page's box, over everything (the phone shade, transitions), under the page's own glass.
    // Figures loaded for it alone stay off stage: their containers live in a holder the stage never draws (`offstageBox`).
    // The page's Liquid Glass (pill, bubbles, glass keys) cannot blur the stage's picture through the sandboxed iframe, so the
    // scene draws the blur: a blurred copy of her video under each glass shape the page reports, the page's tint and rim on top.
    const callBox = new PIXI.Container(), callViews = new PIXI.Container(), callGlass = new PIXI.Container(), offstageBox = new PIXI.Container();
    callBox.addChild(callViews, callGlass);
    const call = { views: new Map(), alpha: 0, matrix: new PIXI.Matrix(), inverse: new PIXI.Matrix(), gradient: null, seen: false,
        glass: { texture: null, key: "", drawn: "", source: null, blur: null, saturate: null, pieces: [] } };
    app.stage.addChild(world, bust.sprite, overlay, callBox);
    // Filter attachment points (render order within each chain).
    const filters = {
        world: galFilterChain(world, app.screen, ["timeGrade", "grade", "soften", "bloom", "screen", "film", "beatBlur", "glitch", "shock"]), backdrop: galFilterChain(backdrop, app.screen, ["blur"]),
        backFx: galFilterChain(backFx), figures: galFilterChain(figuresBox), frontFx: galFilterChain(frontFx), overlay: galFilterChain(overlay, app.screen)
    };
    function tune(filter) {
        filter.resolution = filter.forkLowRes ? 1 : app.renderer.resolution;
        // A figure's filters (shade, rim, warp, depth of field) draw single-sampled: its pictures and Live2D meshes take
        // their edges from texture alpha, so MSAA there changed no pixel, but once a figure
        // is taller than 2048 device px (4K at 200% / 225%) its pooled 4096 px MSAA targets cost ~35 ms a frame.
        filter.multisample = quality === "low" || filter.forkSingleSample ? PIXI.MSAA_QUALITY.NONE : PIXI.MSAA_QUALITY.MEDIUM;
        return filter;
    }
    // pixi-filters (post effects) load in the background; until then grading and particles still work.
    loadPixiFilters().catch(error => console.warn("[fork-gal-scene] pixi-filters", error));

    const state = {
        desc: null, override: null, debugEffects: [], destroyed: false,
        textures: new Map(),           // url → { promise, texture, dead }
        layers: [],                    // backdrop layers, bottom → top: { url, time, texture, sprite, plan, start, mask, owned, standIn, correction }
        bg: { target: null, pending: "" },
        grade: { name: null, start: 0, duration: 0, current: null, version: 0 },
        figures: new Map(),            // key → entry
        seen: new Set(),
        camera: { key: null, from: null, current: null, start: 0, ms: 0, ease: "inOutCubic" },
        dof: galSpringValue(0),
        
        frames: [], lastPrune: 0, clock: performance.now(), timeScale: 1, preview: null, previewCount: 0,
        offstage: new Map()            // call view figures not on stage: key → entry
    };
    // A debug light override of day or a time look (dusk, night …) drives the time-of-day grade, as the
    // stage does for commands.
    function describe() {
        const light = state.override && state.override.light;
        const registry = registryOf();
        const base = state.desc || {};
        const lighting = light ? stageApplyLight(stageLighting(state.override.lighting || base.lighting || base.light, registry.list), light, registry.list) : state.override && state.override.lighting;
        const extra = lighting ? { lighting, grade: galLookResolve(registry, lighting, base.autoGrade || base.grade || "").grade } : null;
        const desc = galSceneMerge(state.desc || {}, extra ? Object.assign({}, state.override, extra) : state.override);
        if (desc.background && desc.background.variantUrls) {
            const background = desc.background, time = desc.grade || "day";
            const variant = background.variantUrls[time];
            desc.background = { ...background, url: variant || background.baseUrl || background.url, time: variant ? time : background.baseTime || "" };
        }
        return state.preview ? Object.assign({}, desc, { looks: registry }) : desc;
    }
    // forkGalDebug.preview(params) adds a temporary look "preview" to the loaded ones (for tuning looks).
    function registryOf() {
        const base = state.desc && state.desc.looks || GAL_LOOKS_EMPTY;
        if (!state.preview) return base;
        if (state.preview.base !== base) {
            const list = base.list.filter(entry => entry.id !== "preview").concat([{ id: "preview", label: "预览", meaning: "", time: false, params: state.preview.params, source: "debug" }]);
            state.preview.base = base; state.preview.registry = galLookRegistry(list, base.version * 1000 + (++state.previewCount));
        }
        return state.preview.registry;
    }
    const effects = galCreateEffects({ PIXI, app, world, backdrop, backFx, frontFx, emotes: emotesBox, overlay, filters, tune, quality: () => quality, headOf });

    // ---- textures (backgrounds and static portraits): decoded off the main thread, uploaded before use.
    function loadTexture(url) {
        let record = state.textures.get(url);
        if (record) return record.promise;
        record = { url, texture: null, promise: null, dead: false };
        state.textures.set(url, record);
        record.promise = new Promise(function (resolve, reject) {
            const image = new Image();
            image.decoding = "async";
            image.src = url;
            (image.decode ? image.decode() : new Promise((ok, fail) => { image.onload = ok; image.onerror = fail; })).then(function () {
                if (record.dead || state.destroyed) throw new Error("cancelled");
                record.texture = new PIXI.Texture(new PIXI.BaseTexture(image));
                const prepare = app.renderer.plugins.prepare;
                return prepare ? prepare.upload(record.texture) : null;
            }).then(function () {
                if (record.dead || state.destroyed) throw new Error("cancelled");
                record.ready = true;
                resolve(record.texture);
            }).catch(function (error) {
                if (state.textures.get(url) === record && !record.texture) state.textures.delete(url);
                reject(error);
            });
        });
        record.promise.catch(() => {});
        return record.promise;
    }
    function pruneTextures() {
        const keep = new Set(describe().preload || []);
        state.layers.forEach(layer => keep.add(layer.url));
        if (state.bg.pending) keep.add(state.bg.pending);
        [...state.figures.values(), ...state.offstage.values(), ...[...state.offstage.values()].map(entry => entry.next).filter(Boolean)].forEach(function (entry) { if (entry.src) keep.add(entry.src); if (entry.pendingSrc) keep.add(entry.pendingSrc); layeredSpriteUrls(entry.figure.spriteBundle).forEach(url => keep.add(url)); blinkUrls(entry.figure.blinkBundle).forEach(url => keep.add(url)); (entry.fading || []).forEach(item => keep.add(item.url)); });
        // a figure/emotion texture that leaves stays decoded for the rest of this
        // reading visit (the round) and the page just left, most recently used first, within GAL_TEXTURE_KEEP_BYTES;
        // a returning emotion is not decoded and uploaded again. Older rounds' textures go.
        const visit = describe().visit, now = performance.now();
        if (state.keepNow && (state.keepNow.size !== keep.size || [...keep].some(url => !state.keepNow.has(url)))) state.keepBefore = state.keepNow;
        state.keepNow = keep;
        const retired = [];
        state.textures.forEach(function (record, url) {
            if (!record.texture) return;
            if (keep.has(url)) { record.used = now; record.visit = visit; } else retired.push(record);
        });
        let room = GAL_TEXTURE_KEEP_BYTES;
        retired.sort((a, b) => (b.used || 0) - (a.used || 0)).forEach(function (record) {
            const base = record.texture.baseTexture, bytes = (base ? base.realWidth * base.realHeight : 0) * 4;
            if ((record.visit === visit || state.keepBefore?.has(record.url)) && bytes <= room) { room -= bytes; return; }
            record.dead = true; record.texture.destroy(true); state.textures.delete(record.url);
        });
    }

    // ---- backdrop
    function startLayer(url, texture, kind, grade, now) {
        const desc = describe();
        const previous = state.layers[state.layers.length - 1];
        const plan = galBackgroundTransition(kind, desc, previous);
        const sprite = new PIXI.Sprite(texture);
        const layer = { identity:describe().background?.identity, url, scene: desc.background && desc.background.scene, time: url && desc.background ? desc.background.time || "" : "", texture, sprite, plan, start: now, mask: null, owned: url !== "", standIn: null, correction: null };
        setStandIn(layer, grade, now, 0);
        if (plan.kind === "wipe" || plan.kind === "iris") {
            layer.mask = new PIXI.Sprite(plan.kind === "wipe" ? generated.wipe : generated.iris);
            if (plan.kind === "iris") layer.mask.anchor.set(0.5);
            layersBox.addChild(layer.mask);
            sprite.mask = layer.mask;
        }
        layersBox.addChild(sprite);
        state.layers.push(layer);
        // The figures' grade travels with the picture: it changes during the transition, not before it.
        const duration = desc.snap ? 0 : describe().timeFadeMs === 2500 ? 2500 : plan.kind === "black" || plan.kind === "white" ? 0 : Math.max(plan.duration, 360);
        const gradeStart = plan.split ? now + plan.duration * plan.split[0] : plan.kind === "black" ? now + plan.duration * 0.42 : plan.kind === "white" ? now + plan.duration * 0.36 : now;
        setGrade(grade, gradeStart, state.layers.length === 1 ? 0 : duration);
        paintLayer(layer, now);
    }
    // Per-picture correction (galLayerCorrection); eases when the time of day changes on the same picture.
    function setStandIn(layer, grade, now, duration) {
        const to = describe().packLayers?.backgroundGrade || galLayerCorrection(registryOf(), grade, layer.time), from = layer.standIn ? layer.standIn.current : to;
        layer.standIn = { grade, from, to, start: now, duration, current: from, settled: false, version: registryOf().version };
    }
    function paintStandIn(layer, now) {
        const s = layer.standIn;
        if (s.settled) return;
        const t = s.duration > 0 ? galClamp01((now - s.start) / s.duration) : 1;
        s.current = galMatrix.mix(s.from, s.to, galEase.inOutSine(t));
        s.settled = t >= 1;
        if (galMatrix.isIdentity(s.current)) { if (layer.correction) { layer.sprite.filters = null; layer.correction.destroy(); layer.correction = null; } return; }
        if (!layer.correction) { layer.correction = tune(new PIXI.filters.ColorMatrixFilter()); layer.sprite.filters = [layer.correction]; }
        layer.correction.matrix = s.current.slice();
    }
    function paintLayer(layer, now) {
        const W = app.screen.width, H = app.screen.height;
        paintStandIn(layer, now);
        const texture = layer.sprite.texture;
        const settle = 1 + 0.03 * (1 - galEase.outCubic(galClamp01((now - layer.start) / 8000)));
        const fit = galCover(texture.width, texture.height, W, H, 1.04 * settle);
        layer.sprite.scale.set(fit.scale); layer.sprite.position.set(fit.x, fit.y);
        let frame = null;
        if (layer.plan) {
            frame = galTransitionFrame(layer.plan, layer.plan.duration ? (now - layer.start) / layer.plan.duration : 1);
            layer.sprite.alpha = frame.incoming;
            if (layer.mask && frame.mask >= 0) {
                if (layer.plan.kind === "wipe") {
                    const rect = galWipeRect(frame.mask, W, 0.25, layer.plan.direction);
                    layer.mask.position.set(rect.x, -H * 0.1);
                    layer.mask.scale.set(rect.flip * rect.width / generated.wipe.width, H * 1.2 / generated.wipe.height);
                } else {
                    const cx = W / 2, cy = H * 0.42, size = Math.max(1, galIrisSize(frame.mask, W, H, cx, cy, 0.78));
                    layer.mask.position.set(cx, cy); layer.mask.width = size; layer.mask.height = size;
                }
            }
        } else layer.sprite.alpha = 1;
        return frame;
    }
    function destroyLayer(layer) { if (layer.mask) layer.mask.destroy(); if (layer.correction) layer.correction.destroy(); layer.sprite.destroy(); }
    function tickBackdrop(now) {
        const desc = describe();
        const gradeMs = desc.snap ? 0 : desc.timeFadeMs === 2500 ? 2500 : GAL_ZOOM_MS;
        const background = desc.background || null;
        const url = background && background.url || "", identity = background?.identity;
        // an initial scene.clear still needs the empty backdrop that releases figure entry.
        if (state.bg.target === null || background?.identity !== state.bg.identity || !background && state.bg.target) {
            state.bg.identity = background?.identity; state.bg.failed = false;
            state.bg.target = url;
            const kind = background && background.transition || "fade", grade = desc.grade || "";
            const top = state.layers[state.layers.length - 1];
            if (top && top.url && top.identity === background?.identity) { state.bg.pending = ""; top.time = background && background.time || ""; setGrade(grade, now, gradeMs); setStandIn(top, grade, now, gradeMs); }
            else if (!url) { state.bg.pending = ""; startLayer("", generated.empty, kind, grade, now); }
            else {
                state.bg.pending = url;
                loadTexture(url).then(function (texture) {
                    if (state.destroyed || state.bg.identity !== identity) return;
                    state.bg.pending = "";
                    startLayer(url, texture, kind, describe().grade || "", state.clock);
                }, function (error) {
                    if (state.destroyed || String(error && error.message) === "cancelled") return;
                    if (state.bg.identity !== identity) return;
                    state.bg.pending = ""; state.bg.failed = true;
                    if (typeof recordAssetWarning === "function") recordAssetWarning({ code: "missing-asset", module: "backgrounds", url });
                    // a failed candidate never removes the last-good background.
                });
            }
        } else if (!state.bg.pending && ((desc.grade || "") !== state.grade.name || registryOf().version !== state.grade.version0)) {
            setGrade(desc.grade || "", now, gradeMs);
            const top = state.layers[state.layers.length - 1];
            if (top) { top.time = background && background.time || ""; setStandIn(top, desc.grade || "", now, gradeMs); }
        }
        // wait for the incoming texture, then share its transition clock. A director
        // cut on the same background still gets the selected transition rather than a visible size jump.
        if (state.figureCut && !state.bg.pending) {
            const cut = state.figureCut;
            if (!cut.layer) {
                let top = state.layers[state.layers.length - 1];
                if (top && top.start < cut.since) {
                    startLayer(top.url, top.texture, background?.transition || "fade", desc.grade || "", now);
                    top = state.layers[state.layers.length - 1];
                }
                cut.layer = top;
            }
            const layer = cut.layer, plan = layer?.plan;
            const progress = plan?.duration ? (now - layer.start) / plan.duration : 1;
            const frame = galFigureCutFrame(plan, progress);
            state.figureCutAlpha = frame.alpha;
            if (frame.swap) state.figureScale = figureSceneUpdate(state.figureScale, cut.snapshot, now, true);
            if (progress >= 1) { state.figureCut = null; state.figureCutAlpha = 1; }
        }
        let coverAlpha = 0, coverColor = 0, lidsShut = 0, barsIn = 0, barsOut = false;
        for (let i = 0; i < state.layers.length; i++) {
            const layer = state.layers[i];
            const frame = paintLayer(layer, now);
            if (!frame) continue;
            if (frame.cover > coverAlpha) { coverAlpha = frame.cover; coverColor = frame.color; }
            if (frame.lids > lidsShut) lidsShut = frame.lids;
            if (frame.bars > barsIn) { barsIn = frame.bars; barsOut = frame.out; }
            if (frame.done) {
                layer.plan = null;
                if (layer.mask) { layer.sprite.mask = null; layer.mask.destroy(); layer.mask = null; }
                // Everything under a finished layer is hidden: release it.
                state.layers.splice(0, i).forEach(destroyLayer);
                i = 0;
                state.lastPrune = 0;
            }
        }
        cover.tint = coverColor; cover.alpha = coverAlpha; cover.visible = coverAlpha > 0.002;
        lids.clear(); lids.visible = lidsShut > 0.002 || barsIn > 0.002;
        const shapes = lidsShut > 0.002 ? galBlinkLids(lidsShut, app.screen.width, app.screen.height) : barsIn > 0.002 ? galSlashBars(barsIn, app.screen.width, app.screen.height, barsOut) : [];
        for (const shape of shapes) { lids.beginFill(0x000000, 1); lids.drawPolygon(shape); lids.endFill(); }
        vignette.width = app.screen.width * 1.04; vignette.height = app.screen.height * 1.04;
        vignette.position.set(-app.screen.width * 0.02, -app.screen.height * 0.02);
    }
    // The figures' time grade blends from whatever is on screen now (also mid-blend) to the new one.
    // The looks arriving (or reloading) re-grade to the same name with the new matrices.
    function setGrade(name, start, duration) {
        const grade = state.grade, version = registryOf().version;
        if (grade.name === name && grade.version0 === version) return;
        grade.from = grade.current || galMatrix.identity(); grade.to = describe().packLayers?.figureGrade || galTimeGrade(registryOf(), name).grade; grade.start = start; grade.duration = duration; grade.name = name; grade.version0 = version;
    }
    function tickGrade(now) {
        const grade = state.grade;
        if (!grade.to) return;
        const t = grade.duration > 0 ? galClamp01((now - grade.start) / grade.duration) : now >= grade.start ? 1 : 0;
        const next = galMatrix.mix(grade.from, grade.to, galEase.inOutSine(t));
        if (!grade.current || next.some((value, i) => Math.abs(value - grade.current[i]) > 1e-4)) { grade.current = next; grade.version++; }
    }

    // ---- figures
    function entryList() { return Array.from(state.figures.values()).map(entry => ({ key: entry.key, kind: entry.kind, url: entry.url, identity:entry.identity, leaving: entry.leaving })); }
    function addFigure(figure, attach = true) {
        const container = new PIXI.Container();
        container.visible = false;
        const entry = { key: figure.key, kind: figure.kind, identity:figure.identity, url: figure.url || "", src: "", pendingSrc: "", container, figure, leaving: false, leavingSince: 0,
            model: null, loading: false, sprite: null, fading: [], mood: null, mouth: 0, param: null, act: null, actNonce: null, flatAct: null, started: false,
            filters: galFilterChain(container, null, ["shade", "rim", "dof"], true), shadeFilter: tune(new PIXI.filters.ColorMatrixFilter()),
            slots: {}, glow: galSpringValue(0), shadow: galSpringValue(0), blur: galSpringValue(0), idle: galIdleState(galIdleSeed(figure.key)), tapReaction: null, armed: galSpringValue(0) };
        // Per-figure idle rhythm (galIdleJitter): the plain breath below keeps the same phase and period factor.
        entry.breath = entry.idle.jitter.phase * Math.PI * 2; entry.breathMs = 4500 * entry.idle.jitter.period;
        entry.filters.set("shade", entry.shadeFilter);
        figuresBox.addChild(container);
        if (attach) state.figures.set(figure.key, entry); else entry.swap = true;
        return entry;
    }
    function commitFigureReplacement(entry) {
        // A loaded picture / model brings its own (head-normalised) anatomy: the cast layout reads it (figureLayout).
        state.figureLoads = (state.figureLoads || 0) + 1;
        const previous = entry.previous;
        if (!previous) return;
        if (state.figures.get(entry.key) !== previous || previous.replacement !== entry) { destroyFigure(entry); return; }
        previous.replacement = null; entry.previous = null;
        destroyFigure(previous);
        state.figures.set(entry.key, entry);
    }
    function destroyFigure(entry) {
        if (state.figures.get(entry.key) === entry) state.figures.delete(entry.key);
        if (entry.replacement) { destroyFigure(entry.replacement); entry.replacement = null; }
        entry.dead = true;
        releaseTapStills(entry);
        if (entry.warp) { entry.warp.destroy(); entry.warp = null; }
        clearBlink(entry);
        layeredSpriteClearScene(entry);
        Object.values(entry.slots).forEach(slot => slot.filter.destroy());
        ;
        entry.container.destroy({ children: true });
        if (entry.spineFigure) { entry.spineFigure.destroy(); entry.spineFigure = null; }
        state.lastPrune = 0;
    }
    // the runtime loads with the first Spine figure; the figure then becomes a
    // sprite-like body (entry.sprite) placed and sized by the static path, from its rest-pose frame and pack anatomy.
    function loadSpine(entry) {
        if (entry.loading || entry.sprite || entry.failed || !entry.url) return;
        entry.loading = true;
        const identity = entry.figure.identity, config = entry.figure.spine || {};
        spineLoadData(entry.url).then(function (loaded) {
            const figure = spineFigure(PIXI, loaded, config);
            if (entry.dead || state.destroyed) { figure.destroy(); return; }
            entry.loading = false; entry.spineFigure = figure;
            const frame = spineFrame(figure.spine, config.frame), canvas = [frame[2], frame[3]];
            const input = entry.figure.figureSizing, anatomy = input?.pack && input.anatomy;
            const measured = anatomy ? null : spineMeasure(figure.spine, frame, identity, app.renderer, PIXI);
            const fade = packSpineBottomFade(config.bottomFade, anatomy, measured && measured.candidate.auto, frame[3]);
            if (fade) spineBottomFade(PIXI, figure, frame, fade);
            const body = spineBody(PIXI, figure.spine, frame);
            body.forkHeadTop = anatomy ? anatomy.headTop : measured.headTop;
            body.figureInput = null;
            if (input?.pack && input.source) {
                entry.figureCandidate = measured ? measured.candidate : null;
                body.figureInput = {...input,metrics:packFigureRecord(input,canvas,entry.figureCandidate)};
                const sizing = resolveFigureSizing({ ...body.figureInput, W: app.screen.width, H: app.screen.height, canvas });
                if (sizing.mode === "physical") body.anchor.set(sizing.supportX / canvas[0], sizing.feet / canvas[1]);
            }
            body.forkBodyX = galBodyX(body.figureInput?.metrics, measured?.candidate) ?? canvas[0] / 2;
            figure.mood(entry.figure.animation);
            entry.container.addChildAt(body, 0);
            entry.sprite = body; entry.loadedIdentity = identity;
            commitFigureReplacement(entry);
        }, function (error) {
            entry.loading = false; entry.failed = true;
            if (!entry.dead) onError("Spine 模型加载失败：" + String(error && error.message || error));
        });
    }
    // Emotion → track 0, audible voice → track 1; the skeleton only advances while visible.
    function tickSpine(entry, figure, desc) {
        const model = entry.spineFigure;
        model.mood(spineAnimation(entry, figure));
        const level = figure.speaking && !desc.skipping && !document.hidden ? forkLipSync.level(figure.audio) : 0;
        model.voice(level, figure.talk, performance.now());
        if (entry.container.visible) model.update(app.ticker.deltaMS * state.timeScale / 1000);
    }
    
    function showStatic(entry, src) {
        if (!src) return;
        const identity = entry.figure.identity;
        if (entry.sprite && identity === entry.loadedIdentity) { entry.pendingSrc = ""; return; }
        if (entry.pendingSrc && identity === entry.pendingIdentity) return;
        entry.pendingSrc = src; entry.pendingIdentity = identity;
        loadTexture(src).then(function (texture) {
            if (entry.dead || state.destroyed || entry.pendingIdentity !== identity || entry.figure.identity !== identity) return;
            entry.pendingSrc = "";
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5, 1);
            sprite.forkHeadTop = galTextureHeadTop(src, texture);
            // the old fading sprite keeps its own metric snapshot and pivot.
            sprite.figureInput = entry.figure.figureSizing;
            if (sprite.figureInput?.source && (sprite.figureInput.sourceUrl ? sprite.figureInput.sourceUrl === src : sprite.figureInput.source === figureSource(src))) {
                entry.figureCandidate = sprite.figureInput.pack && sprite.figureInput.anatomy ? null : figureMeasureTexture(sprite.figureInput.source, texture);
                if (sprite.figureInput.pack) {
                    // Sized by the picture's head (its crop) unless its anatomy really knows head and feet (packFigureAnatomy).
                    const canvas = [texture.width, texture.height], anatomy = packFigureAnatomy(sprite.figureInput, canvas, entry.figureCandidate);
                    sprite.figureInput = { ...sprite.figureInput, anatomy, metrics: packFigureRecord({ ...sprite.figureInput, anatomy }, canvas, entry.figureCandidate) };
                }
                const sizing = resolveFigureSizing({ ...sprite.figureInput, W: app.screen.width, H: app.screen.height, canvas: [texture.width, texture.height] });
                if (sizing.mode === "physical") sprite.anchor.set(sizing.supportX / texture.width, sizing.feet / texture.height);
            } else sprite.figureInput = null;
            // The body's centre across the picture (canvases are often off-centre), for the speaker anchor.
            sprite.forkBodyX = galBodyX(sprite.figureInput?.metrics, sprite.figureInput ? entry.figureCandidate : null) ?? figureBodyCentre(src, texture) ?? texture.width / 2;
            // Mood change: the new picture goes underneath at full strength and the old one fades out
            // on top of it, so the figure never turns see-through.
            if (entry.sprite) { entry.sprite.texture = entry.baseTexture; layeredSpriteClearScene(entry); clearBlink(entry); entry.fading.push({ sprite: entry.sprite, url: entry.src, start: state.clock }); }
            entry.container.addChildAt(sprite, 0);
            entry.sprite = sprite; entry.src = src; entry.loadedIdentity = identity; entry.baseTexture = texture;
            commitFigureReplacement(entry);
        }, function (error) { if (String(error && error.message) !== "cancelled") console.warn("[fork-gal-scene] portrait failed", src, error); if (entry.pendingIdentity === identity) entry.pendingSrc = ""; });
    }
    // authored blink overlay. Steady state is two comparisons per frame; the
    // scheduler runs on (foreground-paused) timers and only flips child visibility.
    function clearBlink(entry) {
        if (entry.blink) entry.blink.stop();
        for (const name of ["blinkClosed", "blinkHalf"]) if (entry[name]) { entry[name].destroy(); entry[name] = null; }
        entry.blink = null; entry.blinkKey = ""; entry.spriteBlink = "open";
    }
    function blinkAllowed(entry) {
        return !state.destroyed && !entry.dead && !entry.leaving && entry.container.visible && world.visible && !document.hidden && !galBlinkCalm();
    }
    // A replace blink only sets the phase: layeredSpriteTickScene repaints the eyes on the layered canvas. An over-blend
    // blink is two child sprites whose visibility the scheduler flips.
    function tickBlink(entry) {
        const bundle = entry.figure.blinkBundle, sprite = entry.sprite;
        if (!bundle || !sprite || entry.loadedIdentity !== entry.figure.identity) { if (entry.blinkKey) clearBlink(entry); return; }
        if (entry.blinkKey === bundle.key && (bundle.blend === 'replace' || entry.blinkClosed && entry.blinkClosed.parent === sprite)) return;
        const records = blinkUrls(bundle).map(url => state.textures.get(url));
        if (!records.every(record => record && record.ready && record.texture)) { if (entry.blinkKey) clearBlink(entry); return; }
        const [closed, half] = records.map(record => record.texture);
        const at = blinkPlacement(bundle, entry.baseTexture.width, entry.baseTexture.height, sprite.anchor);
        if (!at || closed.width !== at.w || closed.height !== at.h || half && (half.width !== at.w || half.height !== at.h)) {
            if (entry.blinkFault !== bundle.key) console.warn("[fork-gal-scene] blink patch ignored", bundle.rect);
            entry.blinkFault = bundle.key; if (entry.blinkKey) clearBlink(entry); return;
        }
        clearBlink(entry); entry.blinkKey = bundle.key;
        const timing = { setTimeout: forkForeground.setTimeout, clearTimeout: forkForeground.clearTimeout, timing: blinkTimingFor(entry.idle.jitter.blink), hasHalf: Boolean(half), allowed: () => blinkAllowed(entry) };
        if (bundle.blend === 'replace') {
            entry.blink = createBlinkScheduler({ ...timing, apply: phase => { entry.spriteBlink = phase; } });
            entry.blink.start();
            return;
        }
        const overlay = texture => { const child = new PIXI.Sprite(texture); child.position.set(at.x, at.y); child.visible = false; sprite.addChild(child); return child; };
        entry.blinkClosed = overlay(closed); entry.blinkHalf = half ? overlay(half) : null;
        entry.blink = createBlinkScheduler({ ...timing,
            apply: phase => { if (entry.blinkClosed) entry.blinkClosed.visible = phase === "closed"; if (entry.blinkHalf) entry.blinkHalf.visible = phase === "half"; } });
        entry.blink.start();
    }
    const GAL_NO_FIGURES = [];
    // the viewport layout of the directed cast (galFigureLayout), recomputed only
    // when the stage size, text box, ruler, cast or priority change. The fit eases like the face rest (700 ms).
    function figureLayout(desc, W, H, now) {
        const plan = desc.figureLayout;
        if (!plan) { state.figureLayout = state.figureLayoutSeen = state.fit = null; return null; }
        const env = faceEnvironment(desc, W, H), ruler = state.figureScale, seen = state.figureLayoutSeen;
        if (seen && seen.plan === plan && seen.figures === desc.figures && seen.W === W && seen.H === H && seen.top === env.layoutTop && seen.ruler === ruler && seen.loaded === state.figureLoads) {
            if (desc.snap || desc.skipping) state.fit.from = state.fit.to;
            return state.figureLayout;
        }
        state.figureLayoutSeen = { plan, figures: desc.figures, W, H, top: env.layoutTop, ruler, loaded: state.figureLoads };
        // A cropped picture (pack anatomy: feet below its visible bottom) needs its edge hidden too. A loaded figure's
        // anatomy is its head-normalised one (packFigureAnatomy), whose feet may lie below a knee-up picture.
        const crops = {};
        (desc.figures || []).forEach(figure => {
            const entry = figure && state.figures.get(figure.key), a = (entry?.model ? entry.figureSizing : entry?.sprite?.figureInput)?.anatomy || figure?.figureSizing?.anatomy;
            if (a && a.feet > a.visibleBottom) crops[figure.alias] = (a.feet - a.visibleBottom) / (a.feet - (a.headTop ?? a.figureTop));
        });
        const key = [W, H, env.layoutTop, ruler?.to, ruler?.groundTo, plan.cast.join("\n"), plan.priority.join("\n"), JSON.stringify(crops), JSON.stringify(plan.slots || null), plan.max || 0, JSON.stringify(plan.framing || null)].join("|");
        if (state.figureLayout?.key !== key) {
            state.figureLayout = { key, W, H, ...galFigureLayout({ W, H, boxTop: env.layoutTop, hMax: ruler?.to, groundRatio: ruler?.groundTo, cast: plan.cast, priority: plan.priority, crops, slots: plan.slots, max: plan.max, framing: plan.framing }) };
            const to = { fit: state.figureLayout.fit, drop: state.figureLayout.drop, top: state.figureLayout.top, framed: state.figureLayout.framed, ruler: state.figureLayout.ruler, shrunk: state.figureLayout.shrunk, spread: state.figureLayout.spread };
            // A skin's fixed ruler replaces the scene's: a ruler change (another skin) lands at once, never tweens across two rulers.
            state.fit = !state.fit || desc.snap || desc.skipping || state.fit.to.ruler !== to.ruler || state.fit.to.spread !== to.spread ? { from: to, to, start: now } : { from: fitFrame(now), to, start: now };
            // Reported only when who stands where (or the stage width) changes: the stage's stand-ins and the speaker anchor
            // (--speaker-x on the text box) follow it; a new priority alone is silent.
            const shown = JSON.stringify([state.figureLayout.x, W]);
            if (options.onLayout && shown !== state.figureLayoutShown) { state.figureLayoutShown = shown; state.layoutReport = { count: state.figureLayout.count, x: state.figureLayout.x, visible: state.figureLayout.visible, width: W }; reportLayout(); }
        } else if (desc.snap || desc.skipping) state.fit.from = state.fit.to;
        return state.figureLayout;
    }
    // One report for the stage: the layout plus where the camera settles (its goal, sampled when the shot or the stage size
    // changes, never per frame), so the speaker anchor can place a figure under a close-up: screen x = (x - fx) * zoom + ax.
    // With it, where each figure's body is actually drawn (sampleBodies), so the anchor follows the picture, not only the slot.
    function reportLayout() { if (options.onLayout && state.layoutReport) options.onLayout({ ...state.layoutReport, ...(state.cameraReport ? { camera: state.cameraReport } : null), ...(state.bodyReport ? { body: state.bodyReport } : null) }); }
    // A figure's drawn body centre as a fraction of the stage width: its picture's body x through the figure's actual
    // transform (slot, motion offsets, flip, face-rest scale) into the world, then the settled camera goal (not the shake).
    function bodyCentre(entry, goal, W, H) {
        const model = entry.model, node = model || entry.sprite;
        if (!node || entry.leaving || !entry.container.visible || !Number.isFinite(node.forkBodyX)) return null;
        const point = model ? new PIXI.Point(node.forkBodyX, model.internalModel.originalHeight / 2)
            : new PIXI.Point(node.forkBodyX - node.anchor.x * node.texture.width, (0.5 - node.anchor.y) * node.texture.height);
        const p = world.toLocal(point, node), z = goal.zoom || 1, r = goal.rotation || 0;
        return (goal.ax * W + z * (Math.cos(r) * (p.x - goal.fx * W) - Math.sin(r) * (p.y - goal.fy * H))) / W;
    }
    function sampleBodies(W, H) {
        const real = performance.now();
        if (!options.onLayout || !state.layoutReport || real - (state.bodyAt || 0) < 250) return;
        state.bodyAt = real;
        const goal = state.camera.goal, now = {};
        if (goal) state.figures.forEach(entry => { const x = bodyCentre(entry, goal, W, H); if (x != null) now[entry.figure.alias] = Math.round(x * 1000) / 1000; });
        const next = galBodyReport(state.bodyReport, state.bodySample, now);
        state.bodySample = now;
        if (next) { state.bodyReport = next; reportLayout(); }
    }
    function fitFrame(now) {
        const fit = state.fit;
        if (!fit) return { fit: 1, drop: 0 };
        const mix = galFrameMix(0, 1, now - fit.start);
        if (mix === 1) return fit.to;
        return { fit: fit.from.fit + (fit.to.fit - fit.from.fit) * mix, drop: fit.from.drop + (fit.to.drop - fit.from.drop) * mix,
            top: fit.from.top + (fit.to.top - fit.from.top) * mix, framed: fit.to.framed, ruler: fit.to.ruler, shrunk: fit.to.shrunk, spread: fit.to.spread };
    }
    function laidOut(source, layout) {
        const memo = state.laidOut;
        if (memo && memo.source === source && memo.layout === layout) return memo.list;
        const figures = source.filter(figure => figure && figure.key && (figure.kind === "static" || figure.kind === "spine"));
        const list = layout ? figures.map(figure => figure.alias in layout.x ? (figure.x === layout.x[figure.alias] ? figure : { ...figure, x: layout.x[figure.alias] })
            : { ...figure, visible: false, parked: true, speaking: false, talking: false, audio: null, act: null }) : figures;
        state.laidOut = { source, layout, list };
        return list;
    }
    function syncFigures(desc, now, W, H) {
        // replay owns scene timing; previews without a director get one fixed scene.
        const snapshot = desc.figureScale || state.figureSnapshot || (() => {
            const cast = (desc.figures || []).map(f => resolveFigureSizing({ ...f.figureSizing, canvas: f.figureSizing?.metrics?.canvas, W: 1, H: 1 })).filter(r => r.mode === "physical");
            const hMax = Math.max(0, ...cast.map(r => r.heightCm)) || FIGURE_DISPLAY.REF_MIN_CM;
            const groundRatio = Math.max(0, ...cast.filter(r => r.heightCm === hMax).map(r => r.restHead ? (r.support.y - r.restHead.top) / r.displayPx : 1)) || 1;
            return { version: FIGURE_DISPLAY.version, scene: 0, hMax, groundRatio, rescales: 0 };
        })();
        state.figureSnapshot = snapshot;
        const previousScale = state.figureScale;
        if (previousScale && previousScale.scene !== snapshot.scene && (previousScale.to !== snapshot.hMax || previousScale.groundTo !== (snapshot.groundRatio ?? 1)) && !desc.snap && !desc.skipping) {
            if (state.figureCut?.snapshot.scene !== snapshot.scene) state.figureCut = { snapshot, since: now, layer: null };
            else state.figureCut.snapshot = snapshot;
        } else {
            state.figureScale = figureSceneUpdate(previousScale, snapshot, now, desc.snap || desc.skipping);
            if (desc.snap || desc.skipping) { state.figureCut = null; state.figureCutAlpha = 1; }
            if (state.figureScale !== previousScale && state.figureScale.warning) console.warn("[fork-gal-scene] mid-scene rescale");
        }
        const layout = figureLayout(desc, W, H, now);
        const figures = laidOut(desc.figures || GAL_NO_FIGURES, layout);
        const plan = galFigurePlan(entryList(), figures);
        plan.retire.forEach(function (key) {
            const entry = state.figures.get(key), last = entry.figure;
            if (entry.replacement) { destroyFigure(entry.replacement); entry.replacement = null; }
            entry.leaving = true; entry.leavingSince = now;
            entry.figure = Object.assign({}, last, { visible: false, exit: last.visible === false ? last.exit : "soft", speaking: false, talking: false, audio: null, act: null });
        });
        plan.revive.forEach(key => { state.figures.get(key).leaving = false; });
        figures.forEach(function (figure) {
            let entry = state.figures.get(figure.key);
            // retain the last-good GPU object until its replacement loads.
            if (entry && plan.replace.includes(figure.key)) {
                if (entry.replacement && entry.replacement.identity !== figure.identity) { destroyFigure(entry.replacement); entry.replacement = null; }
                if (!entry.replacement) { entry.replacement = addFigure(figure, false); entry.replacement.previous = entry; }
                const candidate = entry.replacement;
                candidate.figure = figure;
                if (figure.kind === 'spine') { candidate.url = figure.url || ""; loadSpine(candidate); }
                else showStatic(candidate, figure.src);
                return;
            }
            if (!entry) entry = addFigure(figure);
            if (entry.replacement) { destroyFigure(entry.replacement); entry.replacement = null; }
            // renewing a lease keeps all loaded sprite resources in place.
            if (entry.sprite && entry.figure.identity === figure.identity) {
                const old = entry.figure;
                figure = {...figure,src:old.src,spriteBundle:old.spriteBundle,blinkBundle:old.blinkBundle};
            }
            entry.figure = figure;
            if (!entry.model && !entry.loading) entry.url = figure.url || "";
            if (figure.kind === "static") {
                showStatic(entry, figure.src);
                const mouthKey = figure.spriteBundle?.revision || "";
                if (entry.preloadMouth !== mouthKey) {
                    entry.preloadMouth = mouthKey;
                    layeredSpriteUrls(figure.spriteBundle).forEach(url => loadTexture(url).catch(error => console.warn("[layered-sprite] asset failed", url, error)));
                }
                if (entry.preloadBlink !== (figure.blinkBundle?.key || "")) {
                    entry.preloadBlink = figure.blinkBundle?.key || "";
                    blinkUrls(figure.blinkBundle).forEach(url => loadTexture(url).catch(error => console.warn("[fork-gal-scene] blink layer failed", url, error)));
                }

            }
        });
    }
    // Emote-layer pixels: a deforming face with rotation, or the rendered portrait's alpha-top box.
    // Camera/headroom callers request the independent rest pose to avoid chasing a gesture.
    function entryOf(alias) {
        let found = null;
        state.figures.forEach(function (entry) { if (!found && alias && entry.figure && (entry.figure.alias === alias || entry.key === alias) && !entry.leaving && entry.started && entry.figure.visible !== false) found = entry; });
        return found;
    }
    function headOf(alias, rest, exact) {
        const entry = typeof alias === "object" ? alias : entryOf(alias);
        if (!entry) return null;
        if (rest && entry.restHead) return entry.restHead;
        ;
        if (entry.sprite) {
            const sprite = entry.sprite, height = sprite.texture.height, width = sprite.texture.width;
            const metrics = sprite.figureInput?.metrics, m = { ...metrics?.auto, ...metrics?.override };
            const calibrated = entry.figureResolved?.mode === "physical";
            const ht = calibrated ? m.headTop ?? m.faceRect?.[1] : null, ch = calibrated ? m.chin ?? (m.faceRect && m.faceRect[1] + m.faceRect[3]) : null;
            const top = (ht ?? height * (sprite.forkHeadTop || 0)) - height * sprite.anchor.y;
            const chin = (ch ?? (ht ?? height * (sprite.forkHeadTop || 0)) + height * 0.17) - height * sprite.anchor.y;
            const left = (calibrated && m.faceRect ? m.faceRect[0] : width / 2 - height * 0.08) - width * sprite.anchor.x;
            const right = left + (calibrated && m.faceRect ? m.faceRect[2] : height * 0.16);
            const matrix = galDisplayMatrix(sprite, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
            const head = galMeshHead([[left, top, right, top, left, chin, right, chin]], matrix, Math.atan2(-matrix.c, matrix.d));
            return exact ? galFaceUnion([head, ...(entry.fading || []).map(item => headOf({ ...entry, sprite: item.sprite }, false, false))]) : head;
        }
        return null;
    }
    // Figure light (glow / shadow) and depth of field: filters on the figure's own container.
    function tickFigureLook(entry, desc, now, dt, dofTarget) {
        const figure = entry.figure;
        const mode = (desc.figureLight && figure.alias && desc.figureLight[figure.alias]) || figure.light || "";
        galSpring(entry.glow, mode === "glow" ? 1 : 0, 6, dt);
        galSpring(entry.shadow, mode === "shadow" ? 1 : 0, 6, dt);
        galSpring(entry.blur, dofTarget && dofTarget !== entry && quality === "high" ? 2 : 0, 6, dt);
        // figure-life armed cue (galTapArm): a soft steady outline in the figure's colour while taps on it react; it
        // fades out when the period ends (reduced motion: on and off without a fade).
        const armedOn = galTapArmed(tapArm, entry.key, performance.now()) ? 1 : 0;
        if (galBlinkCalm()) { entry.armed.v = armedOn; entry.armed.d = 0; } else galSpring(entry.armed, armedOn, 5, dt);
        const glow = entry.glow.v, shadow = entry.shadow.v, armed = entry.armed.v;
        const hasFilters = Boolean(PIXI.filters.GlowFilter);
        const rimDistance = quality === "low" ? 8 : 14;
        if (entry.slots.rim && entry.slots.rim.distance !== rimDistance) { entry.filters.set("rim", null); entry.slots.rim.filter.destroy(); delete entry.slots.rim; }
        const rim = galUseFilter(entry.slots, entry.filters, "rim", function () {
            if (!hasFilters) return null;
            const filter = new PIXI.filters.GlowFilter({ distance: rimDistance, outerStrength: 0, innerStrength: 0, color: 0xffcf8a, quality: quality === "low" ? 0.1 : 0.18 });
            return filter;
        }, glow + shadow + armed > 0.01, now, tune);
        if (rim) {
            if (entry.slots.rim) entry.slots.rim.distance = rimDistance;
            const warm = glow >= shadow;
            if (armed > glow && armed > shadow) {
                // The figure's colour lifted halfway to white, so the outline reads as light on any background.
                const hex = /^#[0-9a-f]{6}$/i.test(figure.color || "") ? parseInt(figure.color.slice(1), 16) : 0xfff3e0;
                rim.color = ((((hex >> 16) & 255) + 255) >> 1 << 16) | ((((hex >> 8) & 255) + 255) >> 1 << 8) | (((hex & 255) + 255) >> 1);
                rim.outerStrength = armed * 2; rim.innerStrength = armed * 0.2;
            } else {
                rim.color = warm ? 0xffcf8a : 0x9ab6ff;
                rim.outerStrength = warm ? glow * (2.4 + 0.35 * Math.sin(2 * Math.PI * now / 2400)) : shadow * 1.5;
                rim.innerStrength = warm ? glow * 0.7 : shadow * 0.25;
            }
        }
        const blur = galUseFilter(entry.slots, entry.filters, "dof", () => hasFilters ? Object.assign(new PIXI.filters.KawaseBlurFilter(0, 3, false), { forkLowRes: true }) : null, entry.blur.v > 0.05, now, tune);
        if (blur) blur.blur = entry.blur.v;
        return { glow, shadow };
    }
    // ---- idle and tap feedback, core stage behaviour (no switch).
    // Hidden figures (container off, CG / phone / leave) do no idle work; reduced motion keeps today's idle.
    function figureLifeOn(desc) { return Boolean(desc) && !state.destroyed; }
    function staticIdle(entry, desc, dt, now) {
        const reduced = galBlinkCalm(), tap = galTapFrame(entry.tapReaction, now, reduced);
        const out = { on: false, scaleY: 1, scaleX: tap.scaleX, rotation: tap.tilt * 0.5 * Math.PI / 180, dx: tap.dx, tapY: tap.scaleY };
        const warp = !reduced && entry.kind === "static" && galStaticWarps(entry.figure);
        const active = figureLifeOn(desc) && !reduced && entry.kind === "static" && entry.sprite && entry.container.visible && figuresBox.visible;
        if (active) {
            const frame = galStaticIdleStep(entry.idle, dt, warp);
            entry.idleBreath = frame.breath;
            out.on = true; out.scaleY = frame.scaleY; out.scaleX *= frame.scaleX; out.rotation += frame.rotation; out.dx += frame.dx;
            if (warp) {
                if (!entry.warp) { entry.warp = tune(galWarpFilter(PIXI)); entry.filters.set("warp", entry.warp, { before: "shade" }); }
                const sprite = entry.sprite;
                if (sprite.forkIdleBody === undefined) sprite.forkIdleBody = galStaticBody(sprite);
                entry.warp.forkSprite = sprite; entry.warp.forkBody = sprite.forkIdleBody;
                entry.warp.forkMotion = [0.0045 * frame.breath, 0.012 * frame.breath, frame.headTilt - tap.tilt * 0.02, galStaticCenterU(sprite)];
                entry.warp.padding = Math.ceil(Math.abs(sprite.height) * 0.008) + 4;
            }
        }
        if (!(active && warp) && entry.warp) { entry.filters.set("warp", null); entry.warp.destroy(); entry.warp = null; }
        return out;
    }
    // afterMotionUpdate, after galApplyStageHead: offsets on top of the motion layers and director head, before physics.
    
    
    // A reaction still stands in for the base picture (mouth / blink patches hidden) until it expires, the figure
    // speaks, its own picture changes or the still does not match the base canvas.
    function tapTextureStatic(entry, now) {
        const swap = entry.tapTexture, sprite = entry.sprite;
        if (!swap || !sprite) return;
        const base = entry.baseTexture, fits = base && swap.texture.width === base.width && swap.texture.height === base.height;
        if (now < swap.until && fits && !entry.figure.speaking && entry.src === swap.src) {
            sprite.texture = swap.texture;
            sprite.children.forEach(child => { child.renderable = false; });
            return;
        }
        if (sprite.texture === swap.texture) sprite.texture = base;
        sprite.children.forEach(child => { child.renderable = true; });
        entry.tapTexture = null;
    }
    // Spine: the emotion's animation on track 0 for a moment; the figure's own returns on its next mood().
    function spineAnimation(entry, figure) {
        const swap = entry.tapAnimation;
        if (!swap) return figure.animation;
        if (state.clock < swap.until && !figure.speaking && figure.animation === swap.base) return swap.animation;
        entry.tapAnimation = null;
        return figure.animation;
    }
    function releaseTapStills(entry) {
        for (const pending of (entry.tapStills || new Map()).values()) pending.then(still => { if (still) { still.texture.destroy(true); still.pin.release(); } }, () => {});
        entry.tapStills = null; entry.tapTexture = null;
    }
    function tapStill(entry, descriptor, acquire) {
        if (!entry.tapStills) entry.tapStills = new Map();
        let pending = entry.tapStills.get(descriptor.identity);
        if (!pending) {
            pending = Promise.resolve(acquire(descriptor)).then(async pin => {
                try {
                    const image = new Image();
                    image.src = pin.handle.url;
                    await image.decode();
                    if (entry.dead) { pin.release(); return null; }
                    return { pin, texture: PIXI.Texture.from(image) };
                } catch (error) { pin.release(); throw error; }
            });
            // A failed still is forgotten, so a later tap can try again.
            pending.catch(() => { if (entry.tapStills && entry.tapStills.get(descriptor.identity) === pending) entry.tapStills.delete(descriptor.identity); });
            entry.tapStills.set(descriptor.identity, pending);
        }
        return pending;
    }
    function reactToTap(entry, hit, now, desc) {
        if (!state.tap) state.tap = galTapState();
        const plan = galTapPlan(state.tap, entry, hit.region, now);
        entry.tapReaction = { start: now, region: hit.region, kind: plan.kind, side: hit.side };
        if (!plan.full) return;
        const figure = entry.figure, emote = GAL_TAP_EMOTES[plan.kind];
        if (emote) state.debugEffects.push({ op: "emote", id: figure.alias, value: emote, color: figure.color || "", nonce: "tap:" + (++state.tap.serial) });
        // Never fight lip sync or the line's own expression while the figure is speaking.
        if (figure.speaking) return;
        const reaction = figure.reactions && figure.reactions[GAL_TAP_EMOTION[plan.kind]] || {};
        if (entry.kind === "spine" && reaction.animation) {
            entry.tapAnimation = { animation: reaction.animation, base: figure.animation, until: now + FIGURE_LIFE.animationMs };
        } else if (entry.kind === "static" && reaction.still && typeof desc.tapMedia === "function") {
            const src = entry.src;
            entry.tapStillError = null;
            tapStill(entry, reaction.still, desc.tapMedia).then(still => {
                if (still && !entry.dead && entry.src === src && entry.tapReaction && entry.tapReaction.start === now) entry.tapTexture = { texture: still.texture, src, until: state.clock + FIGURE_LIFE.stillMs };
            }, error => { entry.tapStillError = String(error && error.code || error && error.message || error); console.warn("[fork-gal-scene] tap still unavailable", error); });
        }
    }
    // The figure under a stage point: its visible body only (gal-idle.js hit tests), the front-most figure first.
    function figureAt(clientX, clientY) {
        const rect = app.view.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const point = new PIXI.Point((clientX - rect.left) * app.screen.width / rect.width, (clientY - rect.top) * app.screen.height / rect.height);
        const entries = Array.from(state.figures.values()).filter(entry => !entry.leaving && entry.started && entry.container.visible && entry.alpha.v > 0.5)
            .sort((a, b) => b.container.zIndex - a.container.zIndex || figuresBox.getChildIndex(b.container) - figuresBox.getChildIndex(a.container));
        for (const entry of entries) {
            let hit = null;
            try {
                hit = entry.kind === "spine" ? galTapHitSpine(entry.sprite, entry.spineFigure && entry.spineFigure.spine, point, app.renderer, PIXI)
                    : entry.kind === "static" ? galTapHitStatic(entry.sprite, point) : null;
            } catch (error) { console.warn("[fork-gal-scene] tap hit test failed", error); }
            if (hit) return { entry, hit };
        }
        return null;
    }
    // (arming, galTapArm): a deliberate tap (galTapDeliberate) on a figure's visible body is a page
    // turn, except the second tap of a double tap on it or any tap on an armed figure: those react and stop here, before
    // the stage's page-turn handler. Everything else (drags, long presses, a second finger, transparent pixels, empty
    // scene, the text box and every control) passes through untouched. The stage's tapGate says when a click must keep
    // its stage meaning (box hidden, a click that stops SKIP, a text card, menus, phone, CG).
    const tapTracker = galTapTracker(), tapArm = galTapArmState();
    function onStagePointer(event) { galTapPointer(tapTracker, event); }
    function onStageTap(event) {
        const desc = state.desc, deliberate = galTapDeliberate(tapTracker, event), at = event.timeStamp, x = event.clientX, y = event.clientY;
        const eligible = deliberate && figureLifeOn(desc) && typeof desc.tapGate === "function" && desc.tapGate() && figuresBox.visible && world.visible &&
            !desc.hideFigures && !desc.figuresAway && galTapBareTarget(event.target, app.view, host);
        if (!eligible) { tapArm.first = null; return; }
        // Hit-test now only when this tap could be claimed; a plain page turn never waits for it.
        const found = galTapNeedsHit(tapArm, x, y, at) ? figureAt(x, y) : undefined;
        const plan = galTapArm(tapArm, found === undefined ? undefined : found && found.entry.key, x, y, at);
        if (!plan.claim) {
            // A possible first tap: which figure it hit is resolved after this click has turned the page.
            const first = tapArm.first;
            if (first && first.key === undefined) setTimeout(() => { if (tapArm.first === first && !state.destroyed) { const hit = figureAt(x, y); first.key = hit ? hit.entry.key : null; } }, 0);
            return;
        }
        event.stopPropagation();
        reactToTap(found.entry, found.hit, state.clock, desc);
        state.lastTap = { key: found.entry.key, region: found.hit.region, kind: found.entry.tapReaction.kind, armed: plan.armed, pointer: event.pointerType || "" };
    }    function tickFigures(desc, now, dt, W, H) {
        const sceneFrame = figureSceneFrame(state.figureScale, now);
        state.figureScale = sceneFrame.state;
        // normal and film use the same stable occluder contract as REST.
        const fit = fitFrame(now);
        // A skin's fixed ruler (galFigureLayout) stands in for the scene's: one height, one head line, whoever is present.
        const ruled = fit.ruler != null;
        const framing = { sceneHMax: ruled ? fit.ruler : sceneFrame.hMax, sceneGroundRatio: ruled ? 1 : sceneFrame.groundRatio,
            groundHMax: ruled ? fit.ruler : state.figureScale?.to, groundRatio: ruled ? 1 : state.figureScale?.groundTo,
            occluderTop: faceEnvironment(desc, W, H).occluderTop, fit: fit.fit, fitDrop: fit.drop, fitTop: fit.top, spread: fit.spread };
        const reducedHop = galHopReduced(quality);
        const dofTarget = desc.dof ? entryOf(desc.dof) : null;
        // figures loaded off stage for the call view live the same life (load, blink, mouth, mood, place).
        const tickEntry = function (entry) {
            const figure = entry.figure;
            if (entry.kind === "spine") loadSpine(entry);
            ;
            // Figures arrive with the first picture (and its grade), never over an empty, ungraded stage.
            if (!entry.started && !state.layers.length) return;
            // a figure still loading when the entry revealed fades in where it stands, even on a
            // reopened page that otherwise restores without entrances. Outfit swaps keep their in-place replacement.
            if (!entry.started && desc.lateFade && !entry.swap && figure.enter === "none") galFigureInit(entry, { ...figure, enter: "soft" });
            const closeOn = state.camera.closeOn;
            entry.cropped = Boolean(closeOn && figure.alias !== closeOn && !entry.leaving && galCropHidden(entry.restBody, state.camera.goal, W, H));
            galFigureStep(entry, figure, now, dt);
            // A performance shot cuts to its subject: no fade in (tickShot hides everyone else).
            if (desc.shot && figure.alias === desc.shot.alias && figure.visible !== false && !entry.leaving) entry.alpha.v = 1;
            if (entry.leaving && (galFigureGone(entry) || now - entry.leavingSince > 2500)) { destroyFigure(entry); return; }
            entry.container.position.set(0, 0);
            entry.container.scale.set(1);
            const alpha = entry.alpha.v, shade = entry.shade.v;
            entry.container.visible = alpha > 0.003;
            entry.container.zIndex = entry.leaving ? 0 : figure.close ? 3 : figure.speaking ? 2 : 1;
            const look = tickFigureLook(entry, desc, now, dt, dofTarget);
            const key = shade.toFixed(3) + ":" + alpha.toFixed(3) + ":" + look.glow.toFixed(3) + ":" + look.shadow.toFixed(3) + ":" + state.grade.version;
            if (entry.shadeKey !== key) {
                entry.shadeKey = key;
                entry.shadeFilter.matrix = galFigureMatrix(shade, alpha, look.glow, look.shadow, state.grade.current);
            }
            ;
            if (entry.kind === "spine") tickSpine(entry, figure, desc);
            else {
                if (!layeredSpriteTickScene(entry, state.textures, PIXI, !desc.skipping && figure.speaking)) entry.sprite.texture = entry.baseTexture;
                tickBlink(entry);
                tapTextureStatic(entry, now);
            }
            // Static portrait: bottom-anchored sprite, gentle breathing, mirrored when looking left.
            if (figure.act && figure.act.nonce !== entry.actNonce) { entry.actNonce = figure.act.nonce; entry.flatAct = { name: figure.act.name, start: now }; }
            const act = entry.flatAct ? galFlatActAt(entry.flatAct.name, now - entry.flatAct.start, reducedHop) : galFlatActAt("", 0);
            if (act.done) entry.flatAct = null;
            // A Spine rig breathes in its own idle animation.
            let breath = entry.kind === "spine" ? 1 : 1 + 0.008 * (1 - Math.cos(2 * Math.PI * now / entry.breathMs + entry.breath)) / 2;
            const idle = staticIdle(entry, desc, dt, now);
            if (idle.on) breath = idle.scaleY;
            entry.restHead = null;
            entry.restBody = null;
            const place = function (sprite) {
                // metrics are in base-image pixels; talk frames and mouth children reuse the pivot.
                const input = sprite.figureInput;
                if (input) {
                    const rest = resolveFigureSizing({ ...input, ...framing, W, H, stageX: W * entry.cx.v, canvas: [sprite.texture.width, sprite.texture.height], flip: entry.flip.v });
                    if (sprite === entry.sprite) entry.figureResolved = rest;
                    if (rest.mode === "physical") {
                        const body = { x: Math.min(rest.x, rest.x + sprite.texture.width * rest.scale * entry.flip.v), y: rest.y, width: sprite.texture.width * rest.scale, height: sprite.texture.height * rest.scale };
                        if (!entry.restBody) entry.restBody = body;
                        else { const old = entry.restBody, x = Math.min(old.x, body.x), y = Math.min(old.y, body.y); entry.restBody = { x, y, width: Math.max(old.x + old.width, body.x + body.width) - x, height: Math.max(old.y + old.height, body.y + body.height) - y }; }
                        const head = rest.restHead || { x: rest.support.x, top: rest.y + (sprite.forkHeadTop || 0) * sprite.texture.height * rest.scale, chin: rest.y + ((sprite.forkHeadTop || 0) + 0.17) * sprite.texture.height * rest.scale, width: rest.poseSpan * 0.16 };
                        if (!entry.restHead || head.top < entry.restHead.top) entry.restHead = head;
                        sprite.position.set(rest.support.x + (act.dx + idle.dx) * rest.poseSpan + act.px, rest.support.y + act.dy * rest.poseSpan);
                        sprite.scale.set(rest.scale * act.zoom * entry.flip.v * act.flip * act.scaleX * idle.scaleX, rest.scale * act.zoom * breath * act.scaleY * idle.tapY);
                        sprite.rotation = idle.rotation;
                        return;
                    }
                }
                const rest = galFlatLayout(sprite.texture.width, sprite.texture.height, W, H, entry.cx.v, 1, 0, entry.figure.size, entry.figure.ground);
                const body = { x: rest.x - rest.width / 2, y: rest.y - rest.height * 1.008, width: rest.width, height: rest.height * 1.008 };
                if (!entry.restBody) entry.restBody = body;
                else {
                    const old = entry.restBody, x = Math.min(old.x, body.x), y = Math.min(old.y, body.y);
                    entry.restBody = { x, y, width: Math.max(old.x + old.width, body.x + body.width) - x, height: Math.max(old.y + old.height, body.y + body.height) - y };
                }
                const top = rest.y - rest.height * 1.008 * (1 - (sprite.forkHeadTop || 0));
                if (!entry.restHead || top < entry.restHead.top) entry.restHead = { x: rest.x, top, chin: top + rest.height * 0.17, width: rest.height * 0.16 };
                const L = galFlatLayout(sprite.texture.width, sprite.texture.height, W, H, entry.cx.v, act.zoom, entry.lift.v, entry.figure.size, entry.figure.ground);
                sprite.position.set(L.x + (act.dx + idle.dx) * L.width + act.px, L.y + act.dy * L.height);
                sprite.scale.set(L.scale * entry.flip.v * act.flip * act.scaleX * idle.scaleX, L.scale * breath * act.scaleY * idle.tapY);
                sprite.rotation = idle.rotation;
            };
            place(entry.sprite);
            entry.localHead = entry.restHead;
            entry.fading = entry.fading.filter(function (item) {
                const t = (now - item.start) / 260;
                if (t >= 1) { item.sprite.destroy(); state.lastPrune = 0; return false; }
                item.sprite.alpha = 1 - galEase.inOutSine(t);
                place(item.sprite);
                return true;
            });
        };
        state.figures.forEach(tickEntry);
        if (!desc.callView?.frozen) state.offstage.forEach(tickEntry);
        galSyncFaceOrientation(stageHost, state.figures);
        return dofTarget;
    }

    function faceEnvironment(desc, W, H) {
        const theme = stageHost?.dataset.theme || "classic", key = [W, H, !!desc.film, theme, stageHost?.dataset.fkSkin, stageHost?.dataset.fkSkinLayout].join(":");
        if (state.faceEnvironment?.key === key) return state.faceEnvironment;
        const box = stageHost?.querySelector(".fork-gal-box");
        let normalTop = H * 0.72, reserveTop = null;
        const rise = box ? parseFloat(getComputedStyle(box).getPropertyValue("--gal-box-safe-rise")) || 0 : 0;
        if (box) {
            // Resolve the normal-mode tokens even when first opened in film mode. No text measurement.
            const probe = document.createElement("i");
            probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:var(--gal-box-normal-bottom);height:var(--gal-box-normal-height)";
            box.appendChild(probe);
            // Stage units: a docked stage is only scaled (createModStageDock), never re-laid out.
            const rect = probe.getBoundingClientRect(), outer = stageHost.getBoundingClientRect();
            const k = outer.width > 0 && Math.abs(outer.width - stageHost.offsetWidth) >= 1 ? stageHost.offsetWidth / outer.width : 1;
            if (rect.height > 0) normalTop = H - (rect.height + rect.width) * k;
            probe.remove();
            reserveTop = galChoiceReserveTop(stageHost, k);
        }
        const header = stageHost?.querySelector(".fork-gal-topbar")?.offsetHeight || 52;
        const frame = galVisibleFrame(W, H, desc.film ? 1 : 0, header);
        faceBoxObserver?.disconnect();
        if (box) faceBoxObserver?.observe(box);
        // layoutTop: the normal-mode box top; the cast layout does not change with film mode.
        const occluderTop = desc.film ? frame.bottom - rise : normalTop - rise;
        // closeBottom: the fixed close-up safe line (galCloseFrame), whether or not the choices are showing.
        return state.faceEnvironment = { key, rise, box, boxDirty: true,
            top: frame.top + H * 0.02, occluderTop, layoutTop: normalTop - rise, closeBottom: reserveTop == null ? occluderTop : Math.min(occluderTop, reserveTop) };
    }
    function tickFaceRest(desc, now, W, H) {
        const env = faceEnvironment(desc, W, H);
        const closeShot = desc.camera?.shot === "close";
        const fitTo = state.fit ? state.fit.to : { fit: 1, drop: 0 };
        const layoutKey = [state.figureScale?.scene, state.figureScale?.rescales, env.key, closeShot, fitTo.fit, fitTo.drop, fitTo.top, fitTo.ruler, fitTo.spread].join(":");
        const ruled = fitTo.ruler != null;
        state.figures.forEach(entry => {
            if (!entry.restHead) return;
            const input = entry.figureSizing || entry.sprite?.figureInput;
            const key = [layoutKey, input?.source || entry.figure.url || entry.figure.modelId, entry.figure.close || false].join(":");
            const supportY = entry.figureResolved?.support?.y ?? H * (1 - (entry.figure.ground || 0));
            const old = entry.faceRest;
            let lockHead = entry.restHead, lockSupportY = supportY;
            let lockBody = entry.figureResolved?.restBounds || (entry.restBody && { top: entry.restBody.y, bottom: entry.restBody.y + entry.restBody.height });
            if (old?.key !== key && entry.figureResolved?.mode === "physical") {
                // A rare scene rescale locks against its destination ruler, not the first tween frame.
                const target = resolveFigureSizing({ ...input, canvas: input?.metrics?.canvas, W, H, stageX: W * entry.cx.v, sceneHMax: ruled ? fitTo.ruler : state.figureScale?.to,
                    sceneGroundRatio: ruled ? 1 : state.figureScale?.groundTo, occluderTop: env.occluderTop, fit: fitTo.fit, fitDrop: fitTo.drop, fitTop: fitTo.top, spread: fitTo.spread });
                if (target.restHead) { lockHead = target.restHead; lockSupportY = target.support.y; lockBody = target.restBounds; }
            }
            entry.faceRest = galFaceRestUpdate(old, key, lockHead, lockSupportY, env.top, env.occluderTop, H, now,
                // a shrunk cast shares its lowered ground; no full-body ledge. A skin's
                // framing (stage-skin-adv.md「figures」) decides where the cast stands, so it has none either - except a fixed
                // ruler (figures.ruler), whose one ground is the camera's: a short figure (the Warden owl) whose whole body fits
                // stands on the box like the original's instead of sinking behind it; the framed humans never fit and stay put.
                !old || old.scene !== state.figureScale?.scene, (fitTo.ruler != null ? fitTo.shrunk : fitTo.fit < 1 || fitTo.framed) ? null : !closeShot && !entry.figure.close ? lockBody : null);
            entry.faceRest.scene = state.figureScale?.scene;
            if (old !== entry.faceRest && entry.faceRest.to.warning) console.warn("[fork-gal-scene] face-visibility-shrink", entry.figure.alias, entry.faceRest.to);
            const rest = galFaceRestFrame(entry.faceRest, now), x = W * entry.cx.v;
            entry.container.scale.set(rest.scale);
            entry.container.position.set(x * (1 - rest.scale), supportY * (1 - rest.scale) - rest.lift);
            const pointX = v => x + (v - x) * rest.scale, pointY = v => supportY + (v - supportY) * rest.scale - rest.lift;
            const head = entry.restHead, body = entry.restBody;
            entry.restHead = { ...head, x: pointX(head.x), top: pointY(head.top), chin: pointY(head.chin), width: head.width * rest.scale };
            if (body) entry.restBody = { x: pointX(body.x), y: pointY(body.y), width: body.width * rest.scale, height: body.height * rest.scale };
            entry.faceRestCurrent = rest;
        });
    }
    function clampHeadOf(entry) {
        if (!entry.model || !entry.clampLocalHead) return headOf(entry, false, true);
        const head = entry.clampLocalHead, left = head.x - head.width / 2, right = head.x + head.width / 2;
        const matrix = galDisplayMatrix(entry.model, emotesBox, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
        return galMeshHead([[left, head.top, right, head.top, left, head.chin, right, head.chin]], matrix, Math.atan2(-matrix.c, matrix.d));
    }
    function tickFaceClamp(dt, W, H, frame) {
        const env = state.faceEnvironment;
        // ResizeObserver invalidates animated height too; settled reading does no style reads.
        if (env.boxDirty) {
            const style = env.box && getComputedStyle(env.box);
            // The box covers at most its normal-mode reservation (layoutTop): a page whose box stands elsewhere or is not
            // drawn (an art skin's narration, centred over the scene) never moves a figure; only film / theme changes do.
            env.boxTop = style ? Math.max(env.layoutTop, H - parseFloat(style.bottom) - parseFloat(style.height) - env.rise) : env.occluderTop;
            env.boxDirty = false;
        }
        const boxTop = env.boxTop;
        const camera = { ...state.camera.safe, shakeY: world.position.y - state.camera.safe.ay * H };
        // UI shake is a 0..1 gain of this camera shake; reserve its entire upward excursion.
        const occluderTop = Math.min(boxTop + Math.min(0, camera.shakeY), frame.bottom);
        state.faceOccluderTop = occluderTop;
        state.figures.forEach(entry => {
            if (!entry.restHead || !entry.container.visible) return;
            const head = clampHeadOf(entry);
            if (!head) return;
            const clamp = galFaceClamp(head, camera, W, H, occluderTop, entry.faceClamp?.lift || 0, dt);
            entry.faceClampActivations = (entry.faceClampActivations || 0) + (clamp.active && !entry.faceClamp?.active ? 1 : 0);
            entry.faceClamp = clamp;
            entry.container.y -= clamp.lift;
        });
    }

    // the bust of desc.bust.alias on wide stages (the skin's art is wide
    // only), while that figure stands on stage and is drawn: its rest head box (localHead) lands on the skin's head rect, the
    // texture is the crop. A new subject takes the skin's entrance (still under reduced motion, skip and history).
    // while a performance's shot holds, only its subject is drawn - its rest head
    // box (localHead, the same box the bust frames, sprite or Live2D alike) placed by galShotFrame - and the world turns
    // and zooms with it. A hard cut: no tween in, out or between subjects. The others stay loaded and on stage, undrawn;
    // the director's camera is kept and shows again when the shot ends. Runs after every other placement of the frame.
    function tickShot(desc, W, H) {
        const spec = desc.shot && !desc.hideFigures ? desc.shot : null;
        if (!spec) return;
        const frame = galShotFrame(spec, W, H), entry = entryOf(spec.alias), head = entry && entry.localHead, shake = effects.shakeOffset(state.clock);
        world.pivot.set(W / 2, H / 2);
        world.position.set(W / 2 + shake.x, H / 2 + shake.y);
        world.scale.set(frame.zoom);
        world.rotation = frame.rotation;
        state.figures.forEach(other => { if (other !== entry) other.container.visible = false; });
        if (!head) return;
        // The head box's top lands on the shot's head top; the scale floors the head at half the ruler's (galFramedHead).
        const k = frame.head.height / galFramedHead(Math.max(1, head.chin - head.top), state.figureLayout?.head);
        entry.container.scale.set(k);
        entry.container.position.set(frame.head.x - head.x * k, frame.head.top - head.top * k);
    }
    // ---- FaceTime call view ------------------------------------------------------------------------------------------
    function syncOffstage(views) {
        const wanted = new Map(views.filter(view => view.figure).map(view => [view.figure.key, view.figure]));
        state.offstage.forEach((entry, key) => {
            if (wanted.has(key)) return;
            if (entry.next) destroyFigure(entry.next);
            destroyFigure(entry); state.offstage.delete(key);
        });
        const load = entry => {
            ;
            if (entry.kind === "spine") { entry.url = entry.figure.url || ""; loadSpine(entry); return; }
            showStatic(entry, entry.figure.src);
            const key = (entry.figure.spriteBundle?.revision || "") + "|" + (entry.figure.blinkBundle?.key || "");
            if (entry.preloadCall === key) return;
            entry.preloadCall = key;
            layeredSpriteUrls(entry.figure.spriteBundle).concat(blinkUrls(entry.figure.blinkBundle)).forEach(url => loadTexture(url).catch(error => console.warn("[fork-gal-scene] call figure layer failed", url, error)));
        };
        const create = figure => { const entry = addFigure(figure, false); entry.swap = false; offstageBox.addChild(entry.container); galFigureInit(entry, figure); return entry; };
        wanted.forEach((figure, key) => {
            let entry = state.offstage.get(key);
            // Another mood's picture loads beside the shown one and takes over once it is ready (no blank frame).
            if (entry && entry.identity !== figure.identity) {
                if (entry.next && entry.next.identity !== figure.identity) { destroyFigure(entry.next); entry.next = null; }
                entry.next ||= create(figure);
                entry.next.figure = figure; load(entry.next);
                if (entry.next.model || entry.next.sprite) { const next = entry.next; entry.next = null; destroyFigure(entry); state.offstage.set(key, next); }
                else entry.figure = { ...entry.figure, speaking: figure.speaking, audio: figure.audio };
                return;
            }
            if (!entry) { entry = create(figure); state.offstage.set(key, entry); }
            if (!entry.model && !entry.loading) entry.url = figure.url || "";
            entry.figure = figure; load(entry);
        });
    }
    // The screen box of a page view: the phone frame's place on the canvas (read every frame - the phone moves and zooms).
    function callRect(spec, view) {
        const frame = spec.frame;
        if (!frame || !frame.isConnected) return null;
        const f = frame.getBoundingClientRect(), c = app.view.getBoundingClientRect(), k = c.width ? app.screen.width / c.width : 1;
        if (!f.width || !f.height) return null;
        return { x: (f.left - c.left + view.rect.x * f.width) * k, y: (f.top - c.top + view.rect.y * f.height) * k,
            width: view.rect.width * f.width * k, height: view.rect.height * f.height * k, radius: view.radius * f.width * k };
    }
    function callGradient() {
        // §2.2: a light darkening at the top (25 %) and bottom (30 %) keeps the status bar, pill and keys readable.
        call.gradient ||= galCanvasTexture(PIXI, 4, 256, function (ctx, w, h) {
            const image = ctx.createImageData(w, h), data = image.data;
            for (let y = 0; y < h; y++) {
                const t = y / (h - 1), a = t < 0.22 ? 0.25 * (1 - t / 0.22) : t > 0.7 ? 0.3 * (t - 0.7) / 0.3 : 0;
                for (let x = 0; x < w; x++) data[(y * w + x) * 4 + 3] = Math.round(a * 255);
            }
            ctx.putImageData(image, 0, 0);
        });
        return call.gradient;
    }
    function callViewOf(role) {
        let view = call.views.get(role);
        if (view) return view;
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY), mask = new PIXI.Graphics(), back = new PIXI.Sprite(PIXI.Texture.EMPTY), shade = new PIXI.Sprite(callGradient());
        // Drawn once per picture and box size: enough passes that a 14 pt blur at 2-3x leaves no banding.
        const blur = new PIXI.filters.BlurFilter(8, 10), saturate = new PIXI.filters.ColorMatrixFilter();
        blur.repeatEdgePixels = true;
        saturate.saturate(0.1);
        back.filters = [blur, saturate].map(tune);
        sprite.mask = mask;
        callViews.addChild(sprite, mask);
        view = { role, sprite, mask, back, shade, blur, texture: null, backTexture: null, key: "", backKey: "", version: 0 };
        call.views.set(role, view);
        return view;
    }
    function dropCallView(view) {
        call.views.delete(view.role);
        view.sprite.destroy(); view.mask.destroy(); view.back.destroy();
        if (view.texture) view.texture.destroy(true);
        if (view.backTexture) view.backTexture.destroy(true);
    }
    // §2.1-2.2: each box gets the stage's current background, cover-fitted and blurred (14 pt), then the party framed by the
    // rest head the mod declares (head = [centre x, top, height] of the box). Not graded, shaded or blurred with the scene. A frozen
    // call (hung up) keeps its last frame, dimmed.
    function tickCallView(desc, dt, W, H) {
        const spec = desc.callView || null;
        syncOffstage(spec ? spec.views : []);
        call.alpha = spec ? Math.min(1, call.alpha + dt * 1000 / (desc.reducedMotion ? 120 : 180)) : Math.max(0, call.alpha - dt * 1000 / 120);
        callBox.alpha = call.alpha;
        if (!spec && call.alpha <= 0) { call.views.forEach(dropCallView); tickCallGlass(null); callBox.visible = false; state.callCovers = false; return; }
        if (!spec) state.callCovers = false;
        callBox.visible = true;
        if (!spec) return;
        const resolution = app.renderer.resolution, layer = state.layers[state.layers.length - 1], backTexture = layer && layer.texture && layer.texture !== PIXI.Texture.EMPTY ? layer.texture : null;
        const shown = new Set(), remoteSpec = spec.views.find(view => view.role === "remote"), remoteRect = remoteSpec && callRect(spec, remoteSpec);
        // One iOS point of the call screen (it is 393 pt wide) in screen px: the background blur is 14 pt.
        const point = (remoteRect ? remoteRect.width : W) / 393;
        spec.views.forEach(function (viewSpec) {
            const rect = callRect(spec, viewSpec), entry = viewSpec.figure ? state.offstage.get(viewSpec.figure.key) : null;
            if (!rect || rect.width < 2 || rect.height < 2 || !entry && viewSpec.role === "self") return;
            const view = callViewOf(viewSpec.role);
            shown.add(view.role);
            const width = Math.ceil(rect.width), height = Math.ceil(rect.height), key = width + "x" + height + "@" + resolution;
            view.sprite.position.set(rect.x, rect.y);
            view.mask.clear().beginFill(0xffffff).drawRoundedRect(rect.x, rect.y, rect.width, rect.height, rect.radius).endFill();
            view.sprite.tint = spec.frozen ? 0x8a8a8a : 0xffffff;
            if (spec.frozen && view.texture && view.key === key) return;
            if (view.key !== key) {
                if (view.texture) view.texture.destroy(true);
                view.texture = PIXI.RenderTexture.create({ width, height, resolution });
                view.sprite.texture = view.texture; view.key = key;
            }
            // The blurred background is drawn once per picture and box size, then reused every frame.
            const backKey = key + ":" + (spec.backdrop === "stage" && backTexture ? backTexture.baseTexture.uid + ":" + backTexture.frame.width : "none");
            if (view.backKey !== backKey) {
                view.backKey = backKey;
                if (!view.backTexture || view.backTexture.width !== width || view.backTexture.height !== height) { if (view.backTexture) view.backTexture.destroy(true); view.backTexture = PIXI.RenderTexture.create({ width, height, resolution }); }
                const holder = new PIXI.Container(), fill = new PIXI.Graphics().beginFill(0x0b0812).drawRect(0, 0, width, height).endFill();
                holder.addChild(fill);
                if (spec.backdrop === "stage" && backTexture) {
                    const cover = galCover(backTexture.width, backTexture.height, width, height, 1.06);
                    view.back.texture = backTexture; view.back.anchor.set(0.5);
                    view.back.scale.set(cover.scale); view.back.position.set(width / 2, height / 2);
                    view.blur.blur = 14 * point;
                    holder.addChild(view.back);
                }
                app.renderer.render(holder, { renderTexture: view.backTexture, clear: true });
                holder.removeChildren(); fill.destroy(); holder.destroy();
            }
            const base = new PIXI.Sprite(view.backTexture);
            app.renderer.render(base, { renderTexture: view.texture, clear: true });
            base.destroy();
            const head = entry && entry.localHead;
            if (head && entry.container.visible !== false) {
                const [hx, htop, hheight] = viewSpec.head, container = entry.container;
                const s = hheight * height / Math.max(1, head.chin - head.top);
                view.framed = { s, span: head.chin - head.top, hheight, height };
                container.transform.updateLocalTransform();
                container.transform.localTransform.copyTo(call.inverse).invert();
                call.matrix.set(s, 0, 0, s, hx * width - head.x * s, htop * height - head.top * s).append(call.inverse);
                const filters = container.filters;
                container.filters = null;
                app.renderer.render(container, { renderTexture: view.texture, clear: false, transform: call.matrix, skipUpdateTransform: false });
                container.filters = filters;
                container.transform._parentID = -1;
            }
            if (viewSpec.role === "remote") {
                view.shade.width = width; view.shade.height = height;
                app.renderer.render(view.shade, { renderTexture: view.texture, clear: false });
            }
            view.version++;
        });
        call.views.forEach(view => { if (!shown.has(view.role)) dropCallView(view); });
        tickCallGlass(spec, remoteRect);
        // §2.8: a call view over the whole stage (the phone full screen) leaves nothing of the world to draw.
        const rect = remoteRect;
        state.callCovers = Boolean(call.alpha >= 1 && rect && rect.x <= 0.5 && rect.y <= 0.5 && rect.x + rect.width >= W - 0.5 && rect.y + rect.height >= H - 0.5);
        if (state.callCovers) bust.sprite.visible = false;
    }
    // The glass (iOS 26 Liquid Glass): her video, blurred and saturated as the page asks (`glass.blur` a fraction of the page
    // width, `glass.saturate`), drawn at half size once per new video frame and shown inside each shape the page reports
    // (rounded rects in page fractions, each with its opacity). The page draws the tint and rim over it; the page's layout
    // is the one authority for where glass is.
    function tickCallGlass(spec, rect) {
        const glass = call.glass, view = call.views.get("remote");
        const shapes = spec && spec.glass && view && view.texture && rect ? spec.glass.rects : [];
        while (glass.pieces.length < shapes.length) {
            const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY), mask = new PIXI.Graphics();
            sprite.mask = mask; callGlass.addChild(sprite, mask); glass.pieces.push({ sprite, mask });
        }
        glass.pieces.forEach((piece, index) => { piece.sprite.visible = index < shapes.length; });
        if (!shapes.length) return;
        const scale = 0.5, width = Math.max(1, Math.ceil(rect.width * scale)), height = Math.max(1, Math.ceil(rect.height * scale)), key = width + "x" + height + "@" + app.renderer.resolution;
        if (glass.key !== key) {
            if (glass.texture) glass.texture.destroy(true);
            glass.texture = PIXI.RenderTexture.create({ width, height, resolution: app.renderer.resolution }); glass.key = key; glass.drawn = "";
        }
        if (!glass.source) {
            glass.source = new PIXI.Sprite(PIXI.Texture.EMPTY);
            glass.blur = new PIXI.filters.BlurFilter(8, 4); glass.blur.repeatEdgePixels = true;
            glass.saturate = new PIXI.filters.ColorMatrixFilter();
            glass.source.filters = [glass.blur, glass.saturate].map(tune);
        }
        const pageWidth = rect.width / Math.max(1e-6, spec.views.find(row => row.role === "remote").rect.width);
        const drawn = view.version + ":" + view.key + ":" + spec.glass.blur + ":" + spec.glass.saturate;
        if (glass.drawn !== drawn) {
            glass.drawn = drawn;
            glass.source.texture = view.texture; glass.source.scale.set(scale);
            glass.blur.blur = spec.glass.blur * pageWidth * scale;
            glass.saturate.saturate(spec.glass.saturate - 1);
            app.renderer.render(glass.source, { renderTexture: glass.texture, clear: true });
        }
        shapes.forEach((shape, index) => {
            const piece = glass.pieces[index], box = callRect(spec, { rect: shape, radius: shape.radius });
            if (!box) { piece.sprite.visible = false; return; }
            piece.sprite.texture = glass.texture; piece.sprite.position.set(rect.x, rect.y);
            piece.sprite.width = rect.width; piece.sprite.height = rect.height;
            piece.sprite.alpha = shape.alpha; piece.sprite.tint = spec.frozen ? 0x8a8a8a : 0xffffff;
            piece.mask.clear().beginFill(0xffffff).drawRoundedRect(box.x, box.y, box.width, box.height, box.radius).endFill();
        });
    }
    // The shutter (§2.5): the remote picture as it stands (background and her), as iOS keeps the other party's video.
    const stopCallFrames = typeof phoneModCall === "object" && phoneModCall?.frames ? phoneModCall.frames(captureCallFrame) : null;
    function captureCallFrame() {
        const view = call.views.get("remote");
        if (!view || !view.texture) return Promise.reject(Object.assign(new Error("没能拍下这一帧"), { code: "NO_FRAME" }));
        const canvas = app.renderer.plugins.extract.canvas(view.texture);
        return Promise.resolve(canvas.toDataURL("image/jpeg", 0.9));
    }
    function tickBust(desc, now, W, H) {
        const spec = desc.bust && W > 640 && !desc.hideFigures && !desc.shot ? desc.bust : null, entry = spec && entryOf(spec.alias), head = entry && entry.localHead;
        const frame = head && entry.container.visible ? galBustFrame(spec, W, H) : null, clip = frame && frame.clip;
        if (!clip || clip.width < 1 || clip.height < 1) { state.bust = null; bust.sprite.visible = false; return; }
        if (state.bust?.alias !== spec.alias) state.bust = { alias: spec.alias, since: desc.snap || desc.skipping || desc.reducedMotion ? -Infinity : now };
        const pose = galBustEnter(spec.enter, now - state.bust.since, frame.u), resolution = app.renderer.resolution;
        const width = Math.ceil(clip.width), height = Math.ceil(clip.height), key = width + "x" + height + "@" + resolution;
        if (bust.key !== key) {
            if (bust.texture) bust.texture.destroy(true);
            bust.texture = PIXI.RenderTexture.create({ width, height, resolution });
            bust.sprite.texture = bust.texture; bust.key = key;
        }
        // Projection = the bust framing after undoing the stage's own placement of the container.
        const container = entry.container, s = frame.head.height / galFramedHead(Math.max(1, head.chin - head.top), state.figureLayout?.head);
        container.transform.updateLocalTransform();
        container.transform.localTransform.copyTo(bust.inverse).invert();
        bust.matrix.set(s, 0, 0, s, frame.head.x - head.x * s + pose.dx - clip.x, frame.head.top - head.top * s - clip.y).append(bust.inverse);
        // Without the figure's stage filters (scene grade, listener shade, entrance alpha, depth blur): the bust is the skin's
        // portrait, not part of the lit scene, and a filter pass would render it at stage size before the framing scales it.
        const filters = container.filters;
        container.filters = null;
        app.renderer.render(container, { renderTexture: bust.texture, clear: true, transform: bust.matrix, skipUpdateTransform: false });
        container.filters = filters;
        // The render used a temporary parent: the stage pass must recompute this container's world transform.
        container.transform._parentID = -1;
        bust.sprite.position.set(clip.x, clip.y);
        bust.sprite.alpha = pose.alpha;
        bust.sprite.visible = true;
    }

    // the inner-monologue backdrop while the line is inner monologue. Linear
    // fades (the original: in .1 s, out .2 s); stretched to `over` x the screen (1.1) and held still against the camera and
    // shake, as the original's node sits outside the background's pan. Skip and history show the end state at once.
    // desc.thinking: the resolved `thinking` effect (stage-effects.cjs) while the line on screen is inner monologue.
    // Without an image (the engine default) the backdrop is our own procedural dim: the scene darkened by `dim` with a
    // light vignette (dithered, no banding at 4K); a skin's image replaces it. 减少动态: 120 ms fades.
    function thinkingDim(spec) {
        const key = spec.dim + ":" + spec.vignette;
        if (thinking.dimKey !== key) {
            if (thinking.dimTexture) thinking.dimTexture.destroy(true);
            thinking.dimKey = key;
            thinking.dimTexture = galCanvasTexture(PIXI, 960, 540, function (ctx, w, h) {
                const image = ctx.createImageData(w, h), data = image.data;
                for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
                    const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2), r = Math.min(1, Math.hypot(dx * 0.82, dy));
                    const a = Math.min(1, spec.dim + spec.vignette * Math.pow(Math.max(0, (r - 0.45) / 0.55), 1.6)), at = (y * w + x) * 4;
                    data[at] = data[at + 1] = data[at + 2] = 0; data[at + 3] = Math.max(0, Math.min(255, Math.round(a * 255 + Math.random() - 0.5)));
                }
                ctx.putImageData(image, 0, 0);
            });
        }
        return thinking.dimTexture;
    }
    function tickThinking(desc, now, dt, W, H) {
        const spec = desc.thinking || null;
        if (spec && spec.image && spec.image !== thinking.image) {
            if (thinking.texture) thinking.texture.destroy(true);
            thinking.image = spec.image; thinking.texture = PIXI.Texture.from(spec.image);
        }
        if (spec) thinking.source = spec.image ? thinking.texture : thinkingDim(spec);
        if (thinking.source && thinking.sprite.texture !== thinking.source) thinking.sprite.texture = thinking.source;
        const target = spec && thinking.source ? 1 : 0, fade = spec?.fade || thinking.fade || [0.15, 0.25];
        if (spec) thinking.fade = fade;
        const ms = desc.reducedMotion ? 120 : 1000 * (target > thinking.alpha ? fade[0] : fade[1]);
        thinking.alpha = desc.snap || desc.skipping || ms <= 0 ? target : target > thinking.alpha ? Math.min(target, thinking.alpha + dt * 1000 / ms) : Math.max(target, thinking.alpha - dt * 1000 / ms);
        const sprite = thinking.sprite;
        sprite.visible = thinking.alpha > 0.001 && Boolean(thinking.source);
        if (!sprite.visible) return;
        const over = spec?.over || thinking.over || 1;
        if (spec) thinking.over = over;
        const center = world.toLocal(new PIXI.Point(W / 2, H / 2)), zoom = world.scale.x || 1, texture = sprite.texture;
        sprite.position.set(center.x, center.y); sprite.rotation = -world.rotation;
        sprite.scale.set(W / (texture.width || 1) * over / zoom, H / (texture.height || 1) * over / zoom);
        sprite.alpha = thinking.alpha;
    }

    // ---- one-shot effects (screen.play beats, emotes) and the camera
    function tickEffects(desc, now) {
        const list = (desc.effects || []).concat(state.debugEffects);
        list.forEach(function (effect) {
            if (!effect || effect.nonce == null || state.seen.has(effect.nonce)) return;
            state.seen.add(effect.nonce);
            const debug = String(effect.nonce).startsWith("debug:");
            const played = effects.trigger(effect, now, desc.effectTables);
            // A debug emote for someone not on stage goes to the face window (the stage decides).
            if (!played && debug && effect.op === "emote") onDebug(effect);
        });
        if (state.seen.size > 400) state.seen = new Set(Array.from(state.seen).slice(-200));
    }
    // The close-up plans on the REST head (stable, never per frame), extended down to the drawn face where that reaches
    // lower (a Live2D face mesh below a calibrated chin): sampled once per target and stage size, with the figure's own
    // headroom / face-clamp offsets taken out, so the chin it protects is the one the player sees.
    function closeHeadOf(alias, W, H) {
        const entry = entryOf(alias), rest = entry && headOf(entry, true);
        if (!rest) return null;
        const key = alias + ":" + W + ":" + H;
        if (state.camera.closeHead?.key !== key) {
            const exact = headOf(entry, false, true), shift = (entry.headroom || 0) - (entry.faceClamp?.lift || 0);
            if (!exact) return rest;
            state.camera.closeHead = { key, below: Math.max(0, exact.chin - shift - rest.chin) };
        }
        return { ...rest, chin: rest.chin + state.camera.closeHead.below };
    }
    function tickCamera(desc, now, W, H, frame) {
        const camera = state.camera, spec = desc.camera || {};
        let target, key, ms, ease, zoomMax = Infinity;
        if (!spec.shot && typeof spec.zoom === "number") {
            // Plain numbers (debug override): zoom / pan / rotation around the default focus.
            const t = galCameraTarget(spec);
            target = { zoom: t.zoom, fx: 0.5 + t.panX, fy: 0.42 + t.panY, ax: 0.5, ay: 0.42, rotation: t.rotation };
            key = "manual:" + [t.zoom, t.panX, t.panY, t.rotation].join(","); ms = GAL_ZOOM_MS; ease = "inOutCubic";
        } else {
            const shot = spec.shot || "", head = shot === "close" ? closeHeadOf(spec.target, W, H) : null;
            const framing = head ? galCloseFrame(head, frame, state.faceEnvironment.closeBottom, W, H, state.figureLayout?.head) : null;
            const plan = galShotTarget(shot, framing);
            target = plan.target; key = shot + ":" + (head ? spec.target : ""); ms = plan.ms; ease = plan.ease;
            zoomMax = framing ? framing.zoomMax : Infinity;
        }
        target = galFrameCameraTarget(target, frame, H);
        // Where the shot settles, for close-up crop fades (read by the next figure tick).
        camera.closeOn = spec.shot === "close" && key !== "close:" ? spec.target : "";
        camera.goal = galCameraClamp(target, W, H, 0.018);
        const reported = key + "|" + W + "|" + H, r3 = v => Math.round(v * 1000) / 1000;
        if (reported !== state.cameraReported) { state.cameraReported = reported; state.cameraReport = { zoom: r3(camera.goal.zoom), fx: r3(camera.goal.fx), ax: r3(camera.goal.ax) }; reportLayout(); }
        if (desc.skipping) ms = Math.min(ms, 200);
        if (desc.snap) ms = 0;
        if (camera.key !== key) { camera.from = camera.current || target; camera.key = key; camera.start = now; camera.ms = camera.current ? ms : 0; camera.ease = ease; }
        const k = camera.ms > 0 ? galEase[camera.ease](galClamp01((now - camera.start) / camera.ms)) : 1;
        const current = {};
        ["zoom", "fx", "fy", "ax", "ay", "rotation"].forEach(name => { current[name] = camera.from[name] + (target[name] - camera.from[name]) * k; });
        camera.current = current;
        const kick = effects.zoomKick(now), shake = effects.shakeOffset(now);
        // A beat's zoom kick never pushes a close-up's chin past the safe line.
        const safe = galCameraClamp(Object.assign({}, current, { zoom: Math.min(current.zoom * (1 + kick), Math.max(current.zoom, zoomMax)) }), W, H, 0.018);
        camera.safe = safe;
        world.pivot.set(safe.fx * W, safe.fy * H);
        world.position.set(safe.ax * W + shake.x, safe.ay * H + shake.y);
        // a skin shake of the background alone (screen px).
        backdrop.position.set((shake.bx || 0) / safe.zoom, (shake.by || 0) / safe.zoom);
        world.scale.set(safe.zoom);
        world.rotation = safe.rotation;
    }

    function applyQuality(next) {
        quality = next === "low" ? "low" : "high";
        const resolution = galResolution(quality);
        app.ticker.maxFPS = galFrameRate(quality, true, refreshRate, stageReading.get().frameCap);
        if (app.renderer.resolution !== resolution) { app.renderer.resolution = resolution; app.resize(); }
        const all = [].concat(...Object.values(filters).map(chain => chain.all()));
        state.figures.forEach(entry => all.push(...entry.filters.all()));
        state.layers.forEach(layer => { if (layer.correction) all.push(layer.correction); });
        all.forEach(tune);
    }
    function tick() {
        if (state.destroyed || !state.desc) return;
        // Scene clock (ms): real time, or slowed down by forkGalDebug.slow(). Everything animates on it.
        state.clock += app.ticker.deltaMS * state.timeScale;
        const now = state.clock, dt = Math.min(0.25, app.ticker.deltaMS * state.timeScale / 1000);
        const real = performance.now();
        state.frames.push(real);
        while (state.frames.length && state.frames[0] < real - 1000) state.frames.shift();
        const desc = describe();
        if (desc.holding) { world.visible = overlay.visible = bust.sprite.visible = false; return; }
        const newVisit = desc.snap && desc.visit !== state.visit;
        if (newVisit) { state.visit = desc.visit; state.camera.key = null; state.camera.current = null; }
        const W = app.screen.width, H = app.screen.height;
        if ((desc.quality === "low" ? "low" : "high") !== quality) applyQuality(desc.quality);
        ;
        // CG gates the whole figure layer, including pending Live2D arrivals and exit fades.
        // Keep directed state/resources current so clearing CG reveals the latest outfit and cast.
        // an open phone no longer takes the
        // figures away; the whole scene eases into a shade behind it (280 ms, smoothstep; CONFIG 「减少动态」 120 ms) and
        // back out when it is put away, so nothing jumps or leaves. Skip and history snap. CG still hides the figures at once;
        // the scene-change figure cut multiplies in.
        const shadeTarget = desc.figuresAway ? 1 : 0, shadeMs = desc.reducedMotion ? 120 : 280;
        state.phoneShade = desc.snap || desc.skipping || state.phoneShade === undefined || state.phoneShade === shadeTarget ? shadeTarget : shadeTarget > state.phoneShade ? Math.min(1, state.phoneShade + dt * 1000 / shadeMs) : Math.max(0, state.phoneShade - dt * 1000 / shadeMs);
        const shade = state.phoneShade * state.phoneShade * (3 - 2 * state.phoneShade);
        phoneShade.alpha = 0.42 * shade; phoneShade.visible = shade > 0.001; phoneShade.width = W; phoneShade.height = H;
        figuresBox.alpha = state.figureCutAlpha ?? 1;
        emotesBox.alpha = 1;
        // a skin may draw no figures at all (mode none); the cast, its state and its
        // models go on (a bust portrait still draws the speaker).
        figuresBox.visible = emotesBox.visible = !desc.hideFigures && desc.figureMode !== "none";
        syncFigures(desc, now, W, H);
        // a parked figure is kept loaded across visits.
        if (newVisit) state.figures.forEach(entry => {
            if (entry.leaving || entry.figure.visible === false && !entry.figure.parked) destroyFigure(entry);
            else galFigureInit(entry, { ...entry.figure, enter: "none" });
        });
        tickBackdrop(now);
        tickGrade(now);
        tickEffects(desc, now);
        const wantedFilm = desc.film ? 1 : 0;
        if (!state.frameBlend) state.frameBlend = { from: wantedFilm, to: wantedFilm, start: real, value: wantedFilm };
        const blend = state.frameBlend;
        if (blend.to !== wantedFilm) { blend.from = blend.value; blend.to = wantedFilm; blend.start = real; }
        blend.value = galFrameMix(blend.from, blend.to, real - blend.start);
        const visibleFrame = galVisibleFrame(W, H, blend.value);
        state.visibleFrame = visibleFrame;
        const dofTarget = tickFigures(desc, now, dt, W, H);
        tickFaceRest(desc, now, W, H);
        tickCamera(desc, now, W, H, visibleFrame);
        state.figures.forEach(function (entry) {
            if (!entry.restHead || !entry.container.visible) return;
            const target = galHeadroomShift(entry.restHead, state.camera.safe, visibleFrame, W, H);
            // Camera, focus and frame targets already ease. Ease release too, without ever lagging safety.
            entry.headroom = Math.max(target, (entry.headroom || 0) + (target - (entry.headroom || 0)) * (1 - Math.exp(-12 * dt)));
            entry.container.y += entry.headroom;
        });
        tickFaceClamp(dt, W, H, visibleFrame);
        tickShot(desc, W, H);
        if (desc.figureMode !== "none" && !desc.shot) sampleBodies(W, H);
        tickBust(desc, now, W, H);
        tickThinking(desc, now, dt, W, H);
        tickCallView(desc, dt, W, H);
        galSpring(state.dof, dofTarget && quality === "high" ? 1 : 0, 6, dt);
        effects.tick(desc, now, dt, state.dof.v);
        // accepted groups reveal independently, including historical entry.
        // The resource runner already gates each element; a slow model must not hide the backdrop.
        world.visible = overlay.visible = !state.callCovers;
        if (options.onUi) options.onUi(effects.ui(state.grade.current));
        // the entry gate may reveal the backdrop and text box before slow figures are built.
        if (options.onBackdrop && !state.bg.pending && state.layers.length <= 1) options.onBackdrop(desc.presentationRevision);
        if (options.onPresented && !state.bg.pending && state.layers.length <= 1 &&
            Array.from(state.figures.values()).every(entry => !entry.leaving && !entry.replacement && !entry.pendingSrc &&
                !entry.fading.length && (entry.model || entry.sprite))) options.onPresented(desc.presentationRevision);
        cover.width = W; cover.height = H;
        if (now - state.lastPrune > 1500) { state.lastPrune = now; pruneTextures(); }
        const preload = desc.preload || [];
        if (preload.join("\n") !== state.preloadKey) { state.preloadKey = preload.join("\n"); preload.slice(0, 8).forEach(url => loadTexture(url)); }
    }
    // A failing frame is reported once and the next frame tries again (the stage never freezes silently).
    function frame() { try { tick(); } catch (error) { if (!state.tickError) { state.tickError = String(error && error.stack || error); console.error("[fork-gal-scene] frame failed", error); } } }
    // Be deliberately conservative: even flat figures can breathe, blink or gesture. Only a
    // settled, empty, neutral stage without DOM animations qualifies for the idle rate.
    function frameRate() {
        const desc = describe(), plan = effects.looks.plan();
        const neutral = plan && !plan.grade && !plan.soften && !plan.frame && !plan.bloom && !plan.screen && !plan.film && !plan.backBlur && !plan.motes.length && !plan.vignette && !plan.haze && !plan.leaks.length && !plan.flare;
        const idle = !state.figures.size && !(desc.figures || []).length && !desc.animatedUi && !desc.thinking && !(thinking.alpha > 0) && !desc.weather && !(desc.effects || []).length && !state.debugEffects.length && !state.override && !state.preview && neutral && state.layers.length <= 1 && !state.bg.pending && performance.now() - state.changedAt > 4000 && state.clock >= state.camera.start + state.camera.ms;
        return galFrameRate(quality, !idle, refreshRate, stageReading.get().frameCap);
    }
    // The wrapper restores the requested cap after Pixi dispatches its listeners.
    app.ticker.update = function (now) {
        now = now == null ? performance.now() : now;
        const fps = frameRate();
        if (!galFrameDue(pace, now, fps)) return;
        this.maxFPS = 0;
        try { tickerUpdate.call(this, now); } finally { this.maxFPS = fps; }
    };
    app.ticker.add(frame);
    const releaseForeground = forkForeground.application(app);
    // A backgrounded stage never freezes mid-blink: eyes open now, a fresh interval on return.
    const releaseBlinkForeground = forkForeground.subscribe(active => { if (!active) state.figures.forEach(entry => { if (entry.blink) entry.blink.restart(); }); });
    // A new pixel ratio (another monitor, the zoom) re-renders at it, with the filters retuned, without a reload.
    const releaseResolution = galResolutionSubscribe(() => applyQuality(quality));

    // Verification hook, present only while the stage is open.
    let debugNonce = 0;
    const round = (value, digits) => Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits);
    const debug = {
        assetWarnings() { return typeof assetDiagnostics === "function" ? assetDiagnostics() : []; },
        override(patch) {
            const current = describe();
            state.override = patch ? Object.assign({}, patch, patch.light ? { lighting: stageApplyLight(stageLighting(current.lighting || current.light, registryOf().list), patch.light, registryOf().list) } : {}) : null;
            return describe();
        },
        // The loaded stage looks: id, label, meaning, time, source.
        looks() { return registryOf().list.map(entry => ({ id: entry.id, label: entry.label, meaning: entry.meaning, time: entry.time, layer: entry.layer, source: entry.source })); },
        // preview(params): shows a look from raw params (asset paths as URLs); preview(null) ends it.
        preview(params) {
            state.preview = params ? { params, base: null } : null;
            state.override = params ? Object.assign({}, state.override, { light: "preview" }) : state.override && state.override.light === "preview" ? null : state.override;
            return describe().light;
        },
        // trigger('beat', 'glitch'), trigger('emote', { id, value }), trigger('title', text) - canonical ids only; a screen
        // look or the thinking backdrop: override({ screen: 'memory' }) / override({ thinking: STAGE_EFFECTS.thinking }).
        trigger(op, value) {
            if (op === "title") { onDebug({ op: "title", value: String(value || "") }); return; }
            let effect = { op, value, nonce: "debug:" + (++debugNonce) };
            if (op === "emote" && value && typeof value === "object") effect = Object.assign({}, value, { op, nonce: effect.nonce });
            if (op === "emote" && !effect.color) { const entry = entryOf(effect.id); effect.color = entry && entry.figure.color || ""; }
            if (op === "beat" && effect.value === "shock" && !effect.id) { const speaker = Array.from(state.figures.values()).find(entry => entry.figure.speaking); if (speaker) effect.id = speaker.figure.alias; }
            state.debugEffects.push(effect);
            if (state.debugEffects.length > 20) state.debugEffects.shift();
        },
        transition(kind, url) { const base = state.desc && state.desc.background || {}; state.override = galSceneMerge(state.override || {}, { background: Object.assign({}, base, { url: url || base.url || "", transition: kind }) }); },
        error() { return state.tickError || ""; },
        probe() { let render = "ok"; try { app.render(); } catch (error) { render = String(error && error.stack || error); } let step = "ok"; try { tick(); } catch (error) { step = String(error && error.stack || error); } return { started: app.ticker.started, count: app.ticker.count, desc: Boolean(state.desc), render, step }; },
        fps() { return { measured: state.frames.length, ticker: Math.round(app.ticker.FPS * 10) / 10, maxFPS: app.ticker.maxFPS, resolution: app.renderer.resolution, quality }; },
        // each figure's idle rhythm and its current idle signals, for phase traces.
        idlePhase() {
            return Array.from(state.figures.values()).map(entry => {
                const core = entry.model && entry.model.internalModel && entry.model.internalModel.coreModel;
                const param = id => { const index = core.getParameterIndex(id); return index >= 0 && index < core.getParameterCount() ? round(core.getParameterValueByIndex(index), 3) : null; };
                return { key: entry.key, kind: entry.kind, jitter: entry.idle.jitter, breath: entry.idleBreath == null ? null : round(entry.idleBreath, 4),
                    scaleY: entry.sprite ? round(entry.sprite.scale.y, 5) : null, rotation: entry.sprite ? round(entry.sprite.rotation * 180 / Math.PI, 4) : null, blink: entry.blink ? entry.blink.phase() : null,
                    live2d: core ? { breath: param("ParamBreath"), angleX: param("ParamAngleX"), angleZ: param("ParamAngleZ"), bodyX: param("ParamBodyAngleX"), eyeL: param("ParamEyeLOpen") } : null };
            });
        },
        blinks() { return Array.from(state.figures.values()).filter(entry => entry.blinkKey).map(entry => ({ key: entry.key, phase: entry.blink ? entry.blink.phase() : "open", rect: entry.figure.blinkBundle && entry.figure.blinkBundle.rect, half: Boolean(entry.blinkHalf), allowed: blinkAllowed(entry) })); },
        textures() {
            return { gpu: app.renderer.texture.managedTextures.length, cached: state.textures.size, layers: state.layers.length,
                cachedUrls: Array.from(state.textures.keys()), baseTextureCache: Object.keys(PIXI.utils.BaseTextureCache).length };
        },
        stats() {
            const safe = state.camera.safe || { zoom: 1, fx: 0.5, fy: 0.42, rotation: 0 };
            const shake = { x: round(world.position.x - (safe.ax || 0.5) * app.screen.width, 1), y: round(world.position.y - (safe.ay || 0.42) * app.screen.height, 1) };
            return { quality, grade: state.grade.name, look: effects.looks.stats(), camera: { shot: state.camera.key, zoom: round(safe.zoom, 3), fx: round(safe.fx, 3), fy: round(safe.fy, 3), rotation: round(safe.rotation * 180 / Math.PI, 2) },
                scale: round(world.scale.x, 3), shake, frame: state.visibleFrame, figureLayer: { visible: figuresBox.visible, alpha: round(figuresBox.alpha, 3) }, phoneShade: round(phoneShade.alpha, 3), call: { alpha: round(call.alpha, 3), views: [...call.views.keys()], framed: [...call.views.values()].map(view => view.framed || null), offstage: [...state.offstage.values()].map(entry => ({ key: entry.key, identity: entry.identity, ready: Boolean(entry.model || entry.sprite) })), glass: call.glass.pieces.filter(piece => piece.sprite.visible).length, covers: Boolean(state.callCovers), world: world.visible }, thinking: round(thinking.sprite.visible ? thinking.alpha : 0, 3), dof: round(state.dof.v, 2), effects: effects.stats(),
                layers: state.layers.map(layer => ({ url: layer.url, time: layer.time, transition: layer.plan ? layer.plan.kind : "", corrected: Boolean(layer.correction) })),
                figures: Array.from(state.figures.values()).map(entry => ({ key: entry.key, kind: entry.kind, leaving: entry.leaving, parked: Boolean(entry.figure.parked), ready: Boolean(entry.model || entry.sprite),
                    x: entry.started ? round(entry.cx.v, 3) : null, alpha: entry.started ? round(entry.alpha.v, 3) : null, shade: entry.started ? round(entry.shade.v, 2) : null,
                    glow: round(entry.glow.v, 2), shadow: round(entry.shadow.v, 2), blur: round(entry.blur.v, 2), filters: entry.filters.all().length,
                    ...(entry.spineFigure ? { spine: entry.spineFigure.debug() } : {}),
                    // figure-life: warp on, the last tap reaction, the reaction still (size, on screen) and the emotions a tap can borrow.
                    life: { armed: round(entry.armed.v, 2), warp: Boolean(entry.warp), tap: entry.tapReaction ? entry.tapReaction.kind : null, still: entry.tapTexture ? { size: [entry.tapTexture.texture.width, entry.tapTexture.texture.height], shown: Boolean(entry.sprite && entry.sprite.texture === entry.tapTexture.texture) } : entry.tapStills ? entry.tapStills.size : null, stillError: entry.tapStillError || null, reactions: Object.keys(entry.figure.reactions || {}) } })),
                lastTap: state.lastTap || null,
                filters: Object.fromEntries(Object.entries(filters).map(([name, chain]) => [name, chain.container.filters ? chain.container.filters.length : 0])) };
        },
        // read-only calibration seam; no candidate is persisted by this runtime.
        figureCalibration() {
            return Array.from(state.figures.values()).map(entry => {
                const sizing = entry.figureResolved || { mode: "legacy" }, warnings = [...(sizing.warnings || [])];
                if (entry.faceRest?.to.warning) warnings.push(entry.faceRest.to.warning);
                const clamp = entry.faceClamp, head = entry.restHead && headOf(entry, false, true);
                let screenChin = null;
                if (head) {
                    const cy = (head.top + head.chin) / 2, c = Math.cos(head.rotation || 0), s = Math.sin(head.rotation || 0), ys = [];
                    for (const x of [-head.width / 2, head.width / 2]) for (const y of [head.top - cy, head.chin - cy]) {
                        ys.push(world.toGlobal(new PIXI.Point(head.x + c * x - s * y, cy + s * x + c * y)).y);
                    }
                    screenChin = Math.max(...ys);
                }
                return { key: entry.key, alias: entry.figure.alias, candidate: entry.figureCandidate || null, sizing: { ...sizing, warnings },
                    restHead: entry.restHead, headroom: entry.headroom, occluderTop: state.faceOccluderTop,
                    faceVisibility: { rest: entry.faceRestCurrent, target: entry.faceRest?.to, computations: entry.faceRest?.computations,
                        clamp, activations: entry.faceClampActivations || 0, screenChin } };
            });
        },
        figureScale() { return { ...state.figureScale, hMax: figureSceneFrame(state.figureScale, state.clock).hMax }; },
        // the current viewport cast layout and its eased fit.
        figureLayout() { const layout = state.figureLayout; return layout && { W: layout.W, H: layout.H, count: layout.count, fit: layout.fit, drop: layout.drop, top: layout.top, framed: layout.framed, head: layout.head, x: layout.x, visible: layout.visible, current: fitFrame(state.clock) }; },
        figureWarnings() { return figureMixedWarning(Array.from(state.figures.values()).filter(e => !e.leaving && e.figure.visible !== false).map(e => e.figureResolved || { mode: "legacy" })); },
        head(alias) { return headOf(alias); },
        // figure-life: read-only hit test at a client point (the figure a deliberate tap there would claim), no reaction.
        hitAt(clientX, clientY) { const found = figureAt(clientX, clientY); return found ? { key: found.entry.key, kind: found.entry.kind, region: found.hit.region } : null; },
        description() { return JSON.parse(JSON.stringify(describe(), (key, value) => key === "audio" ? (value ? "audio" : null) : value)); },
        quality(value) { stageQuality.set(value); },
        slow(scale) { state.timeScale = Math.max(0.01, Math.min(4, Number(scale) || 1)); return state.timeScale; },
        // Keeps frames coming while the window is hidden (occluded or on another desktop, where the browser
        // pauses animation frames), for screenshots from automation. Not for FPS measurements.
        pump(on) {
            if (state.pump) { state.pump.stop = true; state.pump.off(); state.pump = null; }
            if (!on) return false;
            const channel = new MessageChannel(), pump = { stop: false, last: 0 };
            state.pump = pump;
            channel.port1.onmessage = function () {
                if (pump.stop || state.destroyed || !forkForeground.isForeground()) return;
                const t = performance.now();
                if (forkForeground.isForeground() && document.hidden && t - pump.last >= 15) { pump.last = t; app.ticker.update(t); }
                channel.port2.postMessage(0);
            };
            pump.off = forkForeground.subscribe(active => { if (active) channel.port2.postMessage(0); });
            return true;
        }
    };
    function figureRects() {
        return galFigureRects(Array.from(state.figures.values(), entry => ({ id: entry.figure.alias, visible: figuresBox.visible && entry.container.visible,
            body: entry.restBody, head: entry.restHead, shift: entry.headroom })), state.camera.safe, app.screen.width, app.screen.height);
    }
    const stageHost = host.closest('.fork-gal-stage');
    // Refresh only the shared empty texture; keep figures, transitions and configured backgrounds intact.
    const emptyThemeObserver = new MutationObserver(() => {
        const canvas = generated.empty.baseTexture.resource.source;
        stagePaintEmpty(canvas.getContext('2d'), canvas.width, canvas.height, stageEmptyPalette(host));
        generated.empty.baseTexture.update();
        state.changedAt = performance.now();
    });
    if (stageHost) emptyThemeObserver.observe(stageHost, {attributes:true, attributeFilter:['data-theme']});
    if (stageHost) { for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) stageHost.addEventListener(type, onStagePointer, { capture: true, passive: true }); stageHost.addEventListener("click", onStageTap, true); }
    const faceBoxObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
        if (state.faceEnvironment) state.faceEnvironment.boxDirty = true;
    }) : null;
    if (stageHost) galFigureSources.set(stageHost, figureRects);
    return {
        figureRects,
        app, filters, layers: { world, backdrop, backFx, figures: figuresBox, frontFx, emotes: emotesBox, overlay }, debug,
        set(desc) { state.desc = desc; state.changedAt = performance.now(); },
        // failed figure models and a failed Live2D runtime load try again on
        // the next frame; figures already on stage and the backdrop stay as they are.
        reload() {
            state.figures.forEach(entry => { if (entry.failed && !entry.loading) entry.failed = false; });
            ;
            state.changedAt = performance.now();
        },
        destroy() {
            state.destroyed = true;
            releaseForeground();
            releaseBlinkForeground();
            releaseResolution();
            faceBoxObserver?.disconnect();
            emptyThemeObserver.disconnect();
            if (stageHost) { for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) stageHost.removeEventListener(type, onStagePointer, { capture: true }); stageHost.removeEventListener("click", onStageTap, true); }
            if (stageHost && galFigureSources.get(stageHost) === figureRects) galFigureSources.delete(stageHost);
            if (state.pump) { state.pump.stop = true; state.pump.off(); }
            app.ticker.remove(frame);
            effects.destroy();
            state.figures.forEach(destroyFigure);
            state.offstage.forEach(entry => { if (entry.next) destroyFigure(entry.next); destroyFigure(entry); });
            call.views.forEach(dropCallView);
            if (call.gradient) call.gradient.destroy(true);
            if (call.glass.texture) call.glass.texture.destroy(true);
            call.glass.source?.destroy();
            stopCallFrames?.();
            offstageBox.destroy();
            state.layers.forEach(layer => { if (layer.correction) layer.correction.destroy(); });
            state.textures.forEach(record => { record.dead = true; if (record.texture) record.texture.destroy(true); });
            state.textures.clear();
            if (bust.texture) bust.texture.destroy(true);
            if (thinking.texture) thinking.texture.destroy(true);
            if (thinking.dimTexture) thinking.dimTexture.destroy(true);
            app.destroy(true, { children: true });
            Object.values(generated).forEach(texture => texture.destroy(true));
            
        }
    };
}

// The stage's scene layer (behind the DOM text box, top bar and choices). props.scene is the description
// built by GalStage: { core, quality, background: { url, name, time, transition }, grade (time of day),
// light (a stage look id), looks (the look registry), weather, camera: { shot, target }, dof, figures (…
// light, color), effects, skipping, preload }.
// props.onDebug receives debug-hook effects the stage renders itself (title cards, face-window emotes);
// props.onUi receives the UI-follow frame every scene frame (galLookUi).
function GalScene(props) {
    const h = React.createElement;
    // install only changes runtime availability, never persistent stage state.
    
    const host = React.useRef(null);
    const scene = React.useRef(null);
    const latest = React.useRef(props.scene);
    const debugHandler = React.useRef(props.onDebug);
    const uiHandler = React.useRef(props.onUi);
    const presentedHandler = React.useRef(props.onPresented);
    const backdropHandler = React.useRef(props.onBackdrop);
    const layoutHandler = React.useRef(props.onLayout);
    const [error, setError] = React.useState("");
    const [canvasReady, setCanvasReady] = React.useState(false);
    const firstCanvas = React.useRef(false), poster = React.useRef(null);
    const backgroundUrl = props.scene?.background?.url || '';
    // The first decoded backdrop is readable before Pixi/Cubism is downloaded and compiled.
    // This is presentation only: the runtime still owns the accepted scene and resource pins.
    React.useEffect(() => {
        if (firstCanvas.current) return;
        let live = true;
        const image = poster.current;
        const ready = image ? image.decode() : Promise.resolve();
        ready.then(() => { if (live) backdropHandler.current?.(latest.current.presentationRevision); }, () => {});
        return () => { live = false; };
    }, [backgroundUrl, props.scene?.presentationRevision]);
    latest.current = props.scene;
    debugHandler.current = props.onDebug;
    uiHandler.current = props.onUi;
    presentedHandler.current = props.onPresented;
    backdropHandler.current = props.onBackdrop;
    layoutHandler.current = props.onLayout;
    if (scene.current) scene.current.set(latest.current);
    const startRenderer = props.start !== false;
    // props.reload counts the player's reload presses. A live renderer retries its
    // failed models; a renderer that never started is created again.
    const [attempt, setAttempt] = React.useState(0);
    const reloads = React.useRef(props.reload || 0);
    React.useEffect(() => {
        if ((props.reload || 0) === reloads.current) return;
        reloads.current = props.reload || 0;
        setError('');
        if (scene.current) scene.current.reload(); else setAttempt(n => n + 1);
    }, [props.reload]);
    React.useEffect(function () {
        if (!startRenderer) return;
        let live = true;
        loadPixiRuntime().then(function () {
            if (!live || !host.current) return;
            try {
                scene.current = galCreateScene(host.current, { quality: latest.current && latest.current.quality, onError: message => { if (live) setError(message); },
                    onDebug: effect => { if (live && debugHandler.current) debugHandler.current(effect); },
                    onUi: frame => { if (live && uiHandler.current) uiHandler.current(frame); },
                    onPresented: revision => { if (live) presentedHandler.current?.(revision); },
                    onBackdrop: revision => { if (live) {
                        backdropHandler.current?.(revision);
                        if (!firstCanvas.current && latest.current.background?.url) {
                            firstCanvas.current = true; setCanvasReady(true);
                        }
                    } },
                    onLayout: layout => { if (live) layoutHandler.current?.(layout); } });
                scene.current.set(latest.current);
                window.forkGalDebug = scene.current.debug;
            } catch (err) { setError(String(err && err.message || err)); }
        }, function (err) { if (live) setError(String(err && err.message || err)); });
        return function () {
            live = false;
            if (scene.current) {
                if (window.forkGalDebug === scene.current.debug) delete window.forkGalDebug;
                scene.current.destroy(); scene.current = null;
            }
        };
    }, [startRenderer, attempt]);
    // the stage shows scene failures in its own notice stack, clear of the HUD.
    const errorHandler = props.onError;
    React.useEffect(() => { if (errorHandler) errorHandler(error); }, [error, errorHandler]);
    return h("div", { className: "fork-gal-scene", ref: host, "aria-hidden": true, 'data-canvas-ready':canvasReady || undefined },
        // A Spine figure fades in once its model is drawn (lateFade).
        !canvasReady && backgroundUrl ? h('img', {className:'fork-gal-entry-backdrop',ref:poster,src:backgroundUrl,alt:''}) : null,
        error && !errorHandler ? h("p", { className: "fork-live2d-error", role: "alert" }, error) : null);
}
