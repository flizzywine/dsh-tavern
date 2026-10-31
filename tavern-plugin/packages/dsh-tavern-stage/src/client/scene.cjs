// Plugin-owned scene composition; only shared execution services cross the host seam.
function createStageScene({React,window,document,math,modules:stageViews,services={},figureScale={},lighting={},lookMath={},reading:stageReading,quality:stageQuality}){
const {galFigureRects, galCropHidden, galBodyX, galBodyReport, sceneFigureScale, galFrameRate, galFrameDue, galTextureOwners, galMoodMotionPlan, galPlayMoodMotion, galMotionFade, galMotionTransitions, galShouldBlink, forkGalOwnBlink, live2dStartIdle, galMeshHead, galFaceDrawables, galCheekIndex, galCheekValue, galBlushStep, galFlushFace, galInitFace, galMeshRotation, galFallbackHead, galDisplayMatrix, galSmoothHead, galLipSyncIds, galApplyLipSync, galApplyStageHead, galEase, galClamp01, galSpring, galSpringValue, galTween, galTweenAt, galCallView, galCover, GAL_TRANSITIONS, GAL_TEXTURE_KEEP_BYTES, galBackgroundTransition, galTransitionPlan, galTransitionFrame, galBlinkLids, galSlashBars, galFigureCutFrame, galWipeRect, galIrisSize, galMatrix, GAL_GLOW_MATRIX, GAL_SHADOW_MATRIX, galFigureMatrix, GAL_ZOOM_IN, GAL_ZOOM_MS, galCameraTarget, GAL_SCENE_DIP_MS, galFigureInit, galFigureStep, galFigureGone, GAL_FIGURE_FIT, galSlots, galFigureLayout, galShotFrame, galVisibleFrame, galFrameMix, GAL_CLOSE_MIN_HEAD, galFramedHead, galCloseFrame, GAL_CHOICE_PROBE, galChoiceReserveTop, galFrameCameraTarget, galEstimateHeadTop, galHeadroomShift, galFaceRest, galFaceRestFrame, galFaceRestUpdate, galFaceUnion, galFaceClamp, galHeadTopCache, galTextureHeadTop, galFlatLayout, GAL_HOP_MS, GAL_FLAT_ACTS, galHopAt, galHopReduced, galBlinkCalm, galShiverAt, galBodyActAt, galFlatActAt, galSceneMerge}=math;
const {FIGURE_DISPLAY,figureSceneFrame,figureSceneUpdate,figureMixedWarning,resolveFigureSizing}=figureScale;
const {stageLighting,stageApplyLight}=lighting;
const {GAL_LOOKS_EMPTY,galLookRegistry,galLookResolve}=lookMath;
const {foreground:forkForeground,lipSync:forkLipSync,loadPixi:loadPixiRuntime,resolution:galResolution,subscribeResolution:galResolutionSubscribe}=services;
const {urls:layeredSpriteUrls,clear:layeredSpriteClearScene,tick:layeredSpriteTickScene}=services.layered || {};
const {paint:stagePaintEmpty,palette:stageEmptyPalette}=services.canvas || {};
const {Image,MessageChannel,MutationObserver,ResizeObserver,performance}=window;
const getComputedStyle=(...args)=>window.getComputedStyle(...args),setTimeout=(...args)=>window.setTimeout(...args);
const galFigureSources=new WeakMap(),instances=new Set();let disposed=false;
function create(host,options){
    if(disposed)throw new Error('Stage scene disposed');
    const rollback=[];
    const own=(value,release)=>{rollback.push(()=>release(value));return value;};
    try{
        const instance=galCreateScene(host,options,own),destroy=instance.destroy;
        rollback.length=0;let closed=false;
        instance.destroy=()=>{if(closed)return;closed=true;instances.delete(instance);if(window.forkGalDebug===instance.debug)delete window.forkGalDebug;destroy();};
        instances.add(instance);return instance;
    }catch(error){
        const errors=[error];for(const release of rollback.reverse())try{release();}catch(cleanup){errors.push(cleanup);}
        if(errors.length>1)throw new AggregateError(errors,'Stage scene initialization failed');throw error;
    }
}
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
function galCreateScene(host, options, own) {
    const warnings=new Map();
    const recordAssetWarning=warning=>{warnings.set(JSON.stringify(warning),warning);if(warnings.size>50)warnings.delete(warnings.keys().next().value);};
    const assetDiagnostics=()=>[...warnings.values()];
    const node=value=>own(value,item=>{if(!item.destroyed && !item.parent)item.destroy({children:true});});
    const PIXI = window.PIXI;
    const onError = options.onError || function () {};
    const onDebug = options.onDebug || function () {};
    let quality = options.quality === "low" ? "low" : "high";
    const refreshRate = options.refreshRate || window.screen && window.screen.refreshRate;
    const app = new PIXI.Application({ resizeTo: host, backgroundColor: 0x0b0812, backgroundAlpha: 1, antialias: true, autoDensity: true,
        resolution: galResolution(quality), powerPreference: "high-performance" });
    own(app,value=>value.destroy(true,{children:true}));
    host.appendChild(app.view);
    const gl = app.renderer.gl;

    // resizeTo resizes - and so clears - the canvas in its own animation frame; the paced
    // ticker may skip that vsync, which then shows an empty scene for a frame (leaving full screen flashed). Redraw now.
    app.renderer.on("resize", () => { if (!state.destroyed && state.desc) app.render(); });
    app.ticker.maxFPS = galFrameRate(quality, true, refreshRate, stageReading.get().frameCap);
    const tickerUpdate = app.ticker.update;
    const pace = { last: 0, next: 0, fps: 0, vsync: 0 };
    const generated = stageViews.sceneGraphics.textures(PIXI, host);
    for(const texture of Object.values(generated))own(texture,value=>value.destroy(true));
    const world = node(new PIXI.Container()), backdrop = node(new PIXI.Container()), layersBox = node(new PIXI.Container());
    const vignette = node(new PIXI.Sprite(generated.vignette));
    const backFx = node(new PIXI.Container()), figuresBox = node(new PIXI.Container()), frontFx = node(new PIXI.Container()), emotesBox = node(new PIXI.Container()), overlay = node(new PIXI.Container());
    figuresBox.sortableChildren = true;
    backdrop.addChild(layersBox, vignette);
    // the skin's inner-monologue backdrop (art.thinking; an original's
    // StoryEffectUnit::setThinking, layout order 2: over the background, under the figures at 4). Screen-fixed (plugin monologue layer).
    const thinking = stageViews.monologue.create({PIXI,world});
    own(thinking,value=>value.dispose());
    world.addChild(backdrop, thinking.sprite, backFx, figuresBox, frontFx, emotesBox);
    const cover = node(new PIXI.Sprite(PIXI.Texture.WHITE));
    cover.alpha = 0; cover.visible = false;
    // the open phone dims the scene behind it (backdrop, figures, effects alike).
    const phoneShade = node(new PIXI.Sprite(PIXI.Texture.WHITE));
    phoneShade.tint = 0; phoneShade.alpha = 0; phoneShade.visible = false;
    // blink: the two eyelids (galBlinkLids), drawn over the stage while a blink transition runs.
    const lids = node(new PIXI.Graphics());
    lids.visible = false;
    overlay.addChild(phoneShade, cover, lids);
    // the speaker's bust - their own figure (the same Live2D
    // model or picture, in its current outfit, mood and mouth) drawn once more into a texture the size of the skin's crop,
    // framed by its rest head box (tickBust). No second model and no camera; above the world and under the overlay (phone
    // shade, cover), so the DOM text box covers it as the original's box covers its bust.
    const bust = stageViews.bust.create({PIXI,renderer:app.renderer});
    own(bust,value=>value.dispose());
    // the call view - each party framed by its rest head into a
    // texture the size of the phone page's box, over everything (the phone shade, transitions), under the page's own glass.
    // Figures loaded for it alone stay off stage: their containers live in a holder the stage never draws (`offstageBox`).
    // The page's Liquid Glass (pill, bubbles, glass keys) cannot blur the stage's picture through the sandboxed iframe, so the
    // scene draws the blur: a blurred copy of her video under each glass shape the page reports, the page's tint and rim on top.
    const offstageBox = node(new PIXI.Container());
    const call=stageViews.callViews.create({PIXI,renderer:app.renderer,screen:app.screen,canvas:app.view,tune});
    own(call,value=>value.dispose());
    app.stage.addChild(world, bust.sprite, overlay, call.container);
    // Filter attachment points (render order within each chain).
    const filters = {
        world: stageViews.sceneGraphics.filters(world, app.screen, ["timeGrade", "grade", "soften", "bloom", "screen", "film", "beatBlur", "glitch", "shock"]), backdrop: stageViews.sceneGraphics.filters(backdrop, app.screen, ["blur"]),
        backFx: stageViews.sceneGraphics.filters(backFx), figures: stageViews.sceneGraphics.filters(figuresBox), frontFx: stageViews.sceneGraphics.filters(frontFx), overlay: stageViews.sceneGraphics.filters(overlay, app.screen)
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
    stageViews.effects.loadFilters().catch(error => console.warn("[fork-gal-scene] pixi-filters", error));

    const cameraMotion=stageViews.sceneCamera.create();
    let closeHead=null;
    const sceneLayout=stageViews.castLayout.create();
    own(sceneLayout,value=>value.dispose());
    const cast=stageViews.cast.create({build:(figure,pending)=>addFigure(figure,!pending),release:destroyFigure});
    own(cast,value=>value.dispose());
    const state = {
        desc: null, override: null, debugEffects: [], destroyed: false,
        figures: cast.entries,            // read-only membership; entries hold rendering state
        seen: new Set(),
        camera: cameraMotion.snapshot(),
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
    const effects = stageViews.effects.create({ PIXI, app, world, backdrop, backFx, frontFx, emotes: emotesBox, overlay, filters, tune, quality: () => quality, headOf });
    own(effects,value=>value.destroy());

    const textures=stageViews.sceneTextures.create({PIXI,upload:texture=>app.renderer.plugins.prepare?.upload(texture)});
    own(textures,value=>value.dispose());
    const figureAssets=stageViews.figureAssets.create({PIXI,renderer:app.renderer,screen:app.screen,textures});
    own(figureAssets,value=>value.dispose());
    const loadTexture=textures.load;
    function pruneTextures() {
        const keep = new Set(describe().preload || []);
        backgrounds.layers.forEach(layer => keep.add(layer.url));
        if (backgrounds.pending) keep.add(backgrounds.pending);
        [...state.figures.values(), ...state.offstage.values(), ...[...state.offstage.values()].map(entry => entry.next).filter(Boolean)].forEach(function (entry) { if (entry.src) keep.add(entry.src); if (entry.pendingSrc) keep.add(entry.pendingSrc); layeredSpriteUrls(entry.figure.spriteBundle).forEach(url => keep.add(url)); stageViews.figureBlink.urls(entry.figure.blinkBundle).forEach(url => keep.add(url)); (entry.fading || []).forEach(item => keep.add(item.url)); });
        textures.prune(keep,describe().visit);
    }

    const backgrounds=stageViews.backgrounds.create({PIXI,screen:app.screen,container:layersBox,generated,tune,loadTexture,warn:recordAssetWarning});
    own(backgrounds,value=>value.dispose());
    function tickBackdrop(now) {
        const desc=describe(),background=desc.background;
        backgrounds.update(desc,registryOf(),now);
        // wait for the incoming texture, then share its transition clock. A director
        // cut on the same background still gets the selected transition rather than a visible size jump.
        if (state.figureCut && !backgrounds.pending) {
            const cut = state.figureCut;
            if (!cut.layer) {
                let top = backgrounds.layers[backgrounds.layers.length - 1];
                if (top && top.start < cut.since) {
                    backgrounds.restart(top, background?.transition || "fade", desc.grade || "", now);
                    top = backgrounds.layers[backgrounds.layers.length - 1];
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
        const {coverAlpha,coverColor,lidsShut,barsIn,barsOut,pruned}=backgrounds.paint(now);
        if(pruned)state.lastPrune=0;
        cover.tint = coverColor; cover.alpha = coverAlpha; cover.visible = coverAlpha > 0.002;
        lids.clear(); lids.visible = lidsShut > 0.002 || barsIn > 0.002;
        const shapes = lidsShut > 0.002 ? galBlinkLids(lidsShut, app.screen.width, app.screen.height) : barsIn > 0.002 ? galSlashBars(barsIn, app.screen.width, app.screen.height, barsOut) : [];
        for (const shape of shapes) { lids.beginFill(0x000000, 1); lids.drawPolygon(shape); lids.endFill(); }
        vignette.width = app.screen.width * 1.04; vignette.height = app.screen.height * 1.04;
        vignette.position.set(-app.screen.width * 0.02, -app.screen.height * 0.02);
    }
    // ---- figures
    function addFigure(figure, attach = true) {
        const container = new PIXI.Container();
        container.visible = false;
        const entry = { key: figure.key, kind: figure.kind, identity:figure.identity, url: figure.url || "", src: "", pendingSrc: "", container, figure, leaving: false, leavingSince: 0,
            model: null, loading: false, sprite: null, fading: [], mood: null, mouth: 0, param: null, act: null, started: false,
            idle: stageViews.figureIdle.galIdleState(stageViews.figureIdle.galIdleSeed(figure.key)), tapReaction: null };
        entry.appearance=stageViews.figureAppearance.create({PIXI,container,tune});
        entry.filters=entry.appearance.filters;
        entry.blink=stageViews.figureBlink.create({PIXI,textures,allowed:()=>blinkAllowed(entry)});
        Object.defineProperty(entry,'spriteBlink',{get:()=>entry.blink.phase()});
        // Per-figure idle rhythm (stageViews.figureIdle.galIdleJitter): the plain breath below keeps the same phase and period factor.
        entry.breath = entry.idle.jitter.phase * Math.PI * 2; entry.breathMs = 4500 * entry.idle.jitter.period;
        entry.pose=stageViews.figurePose.create({kind:entry.kind,phase:entry.breath,period:entry.breathMs});
        figuresBox.addChild(container);
        if (!attach) entry.swap = true;
        return entry;
    }
    function commitFigureReplacement(entry) {
        // A loaded picture / model brings its own (head-normalised) anatomy: the cast layout reads it (figureLayout).
        state.figureLoads = (state.figureLoads || 0) + 1;
        cast.commit(entry);
    }
    function destroyFigure(entry) {
        if(entry.dead)return;
        entry.dead=true;
        cast.forget(entry);
        const errors=[];
        const release=action=>{try{action();}catch(error){errors.push(error);}};
        if(entry.replacement){const replacement=entry.replacement;entry.replacement=null;release(()=>destroyFigure(replacement));}
        release(()=>releaseTapStills(entry));
        if(entry.warp){const warp=entry.warp;entry.warp=null;release(()=>warp.destroy());}
        release(()=>entry.blink.dispose());
        release(()=>layeredSpriteClearScene(entry));
        release(()=>entry.appearance.dispose());
        release(()=>entry.pose.dispose());
        release(()=>entry.figureAsset?.destroy());
        entry.figureAsset=null;entry.spineFigure=null;
        for(const item of entry.fading)release(()=>item.asset?.destroy());
        entry.fading=[];
        release(()=>entry.container.destroy({children:true}));
        state.lastPrune=0;
        // A failed release must not invalidate the replacement or prevent the remaining figures from retiring.
        if(errors.length)console.warn('[fork-gal-scene] figure cleanup failed',new AggregateError(errors,'Figure cleanup failed'));
    }
    // the runtime loads with the first Spine figure; the figure then becomes a
    // sprite-like body (entry.sprite) placed and sized by the static path, from its rest-pose frame and pack anatomy.
    function loadSpine(entry) {
        if (entry.loading || entry.sprite || entry.failed || !entry.url) return;
        entry.loading = true;
        const identity = entry.figure.identity, config = entry.figure.spine || {};
        const input=entry.figure.figureSizing;
        figureAssets.spine({url:entry.url,identity,config,input,animation:entry.figure.animation}).then(function(asset){
            entry.loading=false;
            if(!asset)return;
            if(entry.dead || state.destroyed){asset.destroy();return;}
            try {
                entry.container.addChildAt(asset.sprite,0);
                entry.figureAsset=asset;entry.figureCandidate=asset.candidate;entry.spineFigure=asset.spine;
                entry.sprite=asset.sprite;entry.loadedIdentity=identity;
                commitFigureReplacement(entry);
            }catch(error){asset.destroy();throw error;}
        }).catch(function(error){
            entry.loading=false;entry.failed=true;
            if(!entry.dead)onError("Spine 模型加载失败："+String(error&&error.message||error));
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
        const request=(entry.pictureRequest||0)+1;entry.pictureRequest=request;
        figureAssets.picture({src,input:entry.figure.figureSizing}).then(function(asset){
            if(!asset)return;
            if(entry.dead || state.destroyed || entry.pictureRequest!==request || entry.pendingIdentity!==identity || entry.figure.identity!==identity){asset.destroy();return;}
            try {
                const sprite=asset.sprite,texture=sprite.texture;
                entry.container.addChildAt(sprite,0);
                if(entry.sprite){entry.sprite.texture=entry.baseTexture;layeredSpriteClearScene(entry);clearBlink(entry);entry.fading.push({sprite:entry.sprite,asset:entry.figureAsset,url:entry.src,start:state.clock});}
                entry.figureAsset=asset;entry.figureCandidate=asset.candidate;
                entry.sprite=sprite;entry.src=src;entry.loadedIdentity=identity;entry.baseTexture=texture;entry.pendingSrc='';
                commitFigureReplacement(entry);
            }catch(error){asset.destroy();throw error;}
        }).catch(function(error){
            if(String(error&&error.message)!=='cancelled')console.warn('[fork-gal-scene] portrait failed',src,error);
            if(entry.pictureRequest===request)entry.pendingSrc='';
        });
    }
    // authored blink overlay. Steady state is two comparisons per frame; the
    // scheduler runs on (foreground-paused) timers and only flips child visibility.
    function clearBlink(entry) { entry.blink.reset(); }
    function blinkAllowed(entry) {
        return !state.destroyed && !entry.dead && !entry.leaving && entry.container.visible && world.visible && !document.hidden && !galBlinkCalm();
    }
    // A replace blink only sets the phase: layeredSpriteTickScene repaints the eyes on the layered canvas. An over-blend
    // blink is two child sprites whose visibility the scheduler flips.
    function tickBlink(entry) {
        entry.blink.update({bundle:entry.figure.blinkBundle,sprite:entry.sprite,baseTexture:entry.baseTexture,
            ready:entry.loadedIdentity===entry.figure.identity,rhythm:entry.idle.jitter.blink});
    }
    const GAL_NO_FIGURES = [];
    // the viewport layout of the directed cast (galFigureLayout), recomputed only
    // when the stage size, text box, ruler, cast or priority change. The fit eases like the face rest (700 ms).
    function figureLayout(desc,W,H,now) {
        const crops={};
        for(const figure of desc.figures||[]){
            const entry=figure&&state.figures.get(figure.key);
            const anatomy=(entry?.model?entry.figureSizing:entry?.sprite?.figureInput)?.anatomy||figure?.figureSizing?.anatomy;
            if(anatomy&&anatomy.feet>anatomy.visibleBottom)crops[figure.alias]=(anatomy.feet-anatomy.visibleBottom)/(anatomy.feet-(anatomy.headTop??anatomy.figureTop));
        }
        const result=sceneLayout.update({plan:desc.figureLayout,figures:desc.figures,W,H,now,
            top:faceEnvironment(desc,W,H).layoutTop,ruler:state.figureScale,loaded:state.figureLoads,crops,instant:desc.snap||desc.skipping});
        if(result.report&&options.onLayout){state.layoutReport=result.report;reportLayout();}
        return result.layout;
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
        const figures = sceneLayout.project(desc.figures || GAL_NO_FIGURES, layout);
        cast.update(figures,now).forEach(function({entry,replacement}) {
            const figure=entry.figure;
            if(replacement){
                if(figure.kind==='spine')loadSpine(entry);else showStatic(entry,figure.src);
                return;
            }
            if (figure.kind === "static") {
                showStatic(entry, figure.src);
                const mouthKey = figure.spriteBundle?.revision || "";
                if (entry.preloadMouth !== mouthKey) {
                    entry.preloadMouth = mouthKey;
                    layeredSpriteUrls(figure.spriteBundle).forEach(url => loadTexture(url).catch(error => console.warn("[layered-sprite] asset failed", url, error)));
                }
                if (entry.preloadBlink !== (figure.blinkBundle?.key || "")) {
                    entry.preloadBlink = figure.blinkBundle?.key || "";
                    stageViews.figureBlink.urls(figure.blinkBundle).forEach(url => loadTexture(url).catch(error => console.warn("[fork-gal-scene] blink layer failed", url, error)));
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
    function tickFigureLook(entry,desc,now,dt,dofTarget) {
        const figure=entry.figure;
        return entry.appearance.tick({mode:(desc.figureLight&&figure.alias&&desc.figureLight[figure.alias])||figure.light||'',
            defocused:Boolean(dofTarget&&dofTarget!==entry),quality,
            armedOn:stageViews.figureTap.galTapArmed(tapArm,entry.key,performance.now())?1:0,
            reduced:galBlinkCalm(),color:figure.color,now,dt});
    }
    // ---- idle and tap feedback, core stage behaviour (no switch).
    // Hidden figures (container off, CG / phone / leave) do no idle work; reduced motion keeps today's idle.
    function figureLifeOn(desc) { return Boolean(desc) && !state.destroyed; }
    function staticIdle(entry, desc, dt, now) {
        const reduced = galBlinkCalm(), tap = stageViews.figureTap.galTapFrame(entry.tapReaction, now, reduced);
        const out = { on: false, scaleY: 1, scaleX: tap.scaleX, rotation: tap.tilt * 0.5 * Math.PI / 180, dx: tap.dx, tapY: tap.scaleY };
        const warp = !reduced && entry.kind === "static" && stageViews.figureGeometry.galStaticWarps(entry.figure);
        const active = figureLifeOn(desc) && !reduced && entry.kind === "static" && entry.sprite && entry.container.visible && figuresBox.visible;
        if (active) {
            const frame = stageViews.figureIdle.galStaticIdleStep(entry.idle, dt, warp);
            entry.idleBreath = frame.breath;
            out.on = true; out.scaleY = frame.scaleY; out.scaleX *= frame.scaleX; out.rotation += frame.rotation; out.dx += frame.dx;
            if (warp) {
                if (!entry.warp) { entry.warp = tune(stageViews.figureWarp.galWarpFilter(PIXI)); entry.filters.set("warp", entry.warp, { before: "shade" }); }
                const sprite = entry.sprite;
                if (sprite.forkIdleBody === undefined) sprite.forkIdleBody = stageViews.figureGeometry.galStaticBody(sprite);
                entry.warp.forkSprite = sprite; entry.warp.forkBody = sprite.forkIdleBody;
                entry.warp.forkMotion = [0.0045 * frame.breath, 0.012 * frame.breath, frame.headTilt - tap.tilt * 0.02, stageViews.figureGeometry.galStaticCenterU(sprite)];
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
        if (!state.tap) state.tap = stageViews.figureTap.galTapState();
        const plan = stageViews.figureTap.galTapPlan(state.tap, entry, hit.region, now);
        entry.tapReaction = { start: now, region: hit.region, kind: plan.kind, side: hit.side };
        if (!plan.full) return;
        const figure = entry.figure, emote = stageViews.figureTap.GAL_TAP_EMOTES[plan.kind];
        if (emote) state.debugEffects.push({ op: "emote", id: figure.alias, value: emote, color: figure.color || "", nonce: "tap:" + (++state.tap.serial) });
        // Never fight lip sync or the line's own expression while the figure is speaking.
        if (figure.speaking) return;
        const reaction = figure.reactions && figure.reactions[stageViews.figureTap.GAL_TAP_EMOTION[plan.kind]] || {};
        if (entry.kind === "spine" && reaction.animation) {
            entry.tapAnimation = { animation: reaction.animation, base: figure.animation, until: now + stageViews.figureIdle.FIGURE_LIFE.animationMs };
        } else if (entry.kind === "static" && reaction.still && typeof desc.tapMedia === "function") {
            const src = entry.src;
            entry.tapStillError = null;
            tapStill(entry, reaction.still, desc.tapMedia).then(still => {
                if (still && !entry.dead && entry.src === src && entry.tapReaction && entry.tapReaction.start === now) entry.tapTexture = { texture: still.texture, src, until: state.clock + stageViews.figureIdle.FIGURE_LIFE.stillMs };
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
                hit = entry.kind === "spine" ? stageViews.figureTap.galTapHitSpine(entry.sprite, entry.spineFigure && entry.spineFigure.spine, point, app.renderer, PIXI)
                    : entry.kind === "static" ? stageViews.figureTap.galTapHitStatic(entry.sprite, point) : null;
            } catch (error) { console.warn("[fork-gal-scene] tap hit test failed", error); }
            if (hit) return { entry, hit };
        }
        return null;
    }
    // (arming, stageViews.figureTap.galTapArm): a deliberate tap (stageViews.figureTap.galTapDeliberate) on a figure's visible body is a page
    // turn, except the second tap of a double tap on it or any tap on an armed figure: those react and stop here, before
    // the stage's page-turn handler. Everything else (drags, long presses, a second finger, transparent pixels, empty
    // scene, the text box and every control) passes through untouched. The stage's tapGate says when a click must keep
    // its stage meaning (box hidden, a click that stops SKIP, a text card, menus, phone, CG).
    const tapTracker = stageViews.figureTap.galTapTracker(), tapArm = stageViews.figureTap.galTapArmState();
    function onStagePointer(event) { stageViews.figureTap.galTapPointer(tapTracker, event); }
    function onStageTap(event) {
        const desc = state.desc, deliberate = stageViews.figureTap.galTapDeliberate(tapTracker, event), at = event.timeStamp, x = event.clientX, y = event.clientY;
        const eligible = deliberate && figureLifeOn(desc) && typeof desc.tapGate === "function" && desc.tapGate() && figuresBox.visible && world.visible &&
            !desc.hideFigures && !desc.figuresAway && stageViews.figureTap.galTapBareTarget(event.target, app.view, host);
        if (!eligible) { tapArm.first = null; return; }
        // Hit-test now only when this tap could be claimed; a plain page turn never waits for it.
        const found = stageViews.figureTap.galTapNeedsHit(tapArm, x, y, at) ? figureAt(x, y) : undefined;
        const plan = stageViews.figureTap.galTapArm(tapArm, found === undefined ? undefined : found && found.entry.key, x, y, at);
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
        const fit = sceneLayout.fit(now);
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
            if (!entry.started && !backgrounds.layers.length) return;
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
            const key = shade.toFixed(3) + ":" + alpha.toFixed(3) + ":" + look.glow.toFixed(3) + ":" + look.shadow.toFixed(3) + ":" + backgrounds.grade.version;
            if (entry.shadeKey !== key) {
                entry.shadeKey = key;
                entry.appearance.setShade(galFigureMatrix(shade, alpha, look.glow, look.shadow, backgrounds.grade.current));
            }
            ;
            if (entry.kind === "spine") tickSpine(entry, figure, desc);
            else {
                if (!layeredSpriteTickScene(entry, textures, PIXI, !desc.skipping && figure.speaking)) entry.sprite.texture = entry.baseTexture;
                tickBlink(entry);
                tapTextureStatic(entry, now);
            }
            const pose=entry.pose.update({sprite:entry.sprite,fading:entry.fading,now,reduced:reducedHop,
                command:figure.act,idle:staticIdle(entry,desc,dt,now),framing,W,H,x:entry.cx.v,flip:entry.flip.v,lift:entry.lift.v,size:figure.size,ground:figure.ground});
            if(pose){
                entry.restHead=pose.restHead;entry.restBody=pose.restBody;entry.localHead=pose.localHead;
                if(pose.resolved)entry.figureResolved=pose.resolved;
                entry.fading=pose.remaining;
                for(const item of pose.retired){item.asset.destroy();state.lastPrune=0;}
            }
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
        const fitTo = sceneLayout.target;
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
        const k = frame.head.height / galFramedHead(Math.max(1, head.chin - head.top), sceneLayout.layout?.head);
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
            layeredSpriteUrls(entry.figure.spriteBundle).concat(stageViews.figureBlink.urls(entry.figure.blinkBundle)).forEach(url => loadTexture(url).catch(error => console.warn("[fork-gal-scene] call figure layer failed", url, error)));
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
    function tickCallView(desc,dt,W,H) {
        const spec=desc.callView || null;
        syncOffstage(spec ? spec.views : []);
        const subjects=new Map([...state.offstage].map(([key,entry])=>[key,{container:entry.container,head:entry.localHead}]));
        const layers=backgrounds.layers;
        call.tick({spec,dt,W,H,reducedMotion:desc.reducedMotion,background:layers[layers.length-1]?.texture,subjects});
        state.callCovers=call.covers;
        if(call.covers)bust.sprite.visible=false;
    }
    function tickBust(desc, now, W, H) {
        const spec=desc.bust && W>640 && !desc.hideFigures && !desc.shot ? desc.bust : null;
        const entry=spec && entryOf(spec.alias);
        bust.tick({spec,subject:entry ? {container:entry.container,head:entry.localHead} : null,
            now,W,H,instant:desc.snap || desc.skipping || desc.reducedMotion,rulerHead:sceneLayout.layout?.head});
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
        if (closeHead?.key !== key) {
            const exact = headOf(entry, false, true), shift = (entry.headroom || 0) - (entry.faceClamp?.lift || 0);
            if (!exact) return rest;
            closeHead = { key, below: Math.max(0, exact.chin - shift - rest.chin) };
        }
        return { ...rest, chin: rest.chin + closeHead.below };
    }
    function tickCamera(desc, now, W, H, frame) {
        const spec=desc.camera||{},head=spec.shot==='close'?closeHeadOf(spec.target,W,H):null;
        const framing=head?galCloseFrame(head,frame,state.faceEnvironment.closeBottom,W,H,sceneLayout.layout?.head):null;
        const camera=state.camera=cameraMotion.step({spec,framing,hasTarget:!!head,frame,W,H,now,skipping:desc.skipping,snap:desc.snap,kick:effects.zoomKick(now)});
        const reported=camera.key+'|'+W+'|'+H,r3=v=>Math.round(v*1000)/1000;
        if(reported!==state.cameraReported){state.cameraReported=reported;state.cameraReport={zoom:r3(camera.goal.zoom),fx:r3(camera.goal.fx),ax:r3(camera.goal.ax)};reportLayout();}
        const safe=camera.safe,shake=effects.shakeOffset(now);
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
        backgrounds.layers.forEach(layer => { if (layer.correction) all.push(layer.correction); });
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
        if (newVisit) { state.visit = desc.visit; state.camera = cameraMotion.reset(); }
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
        thinking.tick(desc, dt, W, H);
        tickCallView(desc, dt, W, H);
        galSpring(state.dof, dofTarget && quality === "high" ? 1 : 0, 6, dt);
        effects.tick(desc, now, dt, state.dof.v);
        // accepted groups reveal independently, including historical entry.
        // The resource runner already gates each element; a slow model must not hide the backdrop.
        world.visible = overlay.visible = !state.callCovers;
        if (options.onUi) options.onUi(effects.ui(backgrounds.grade.current));
        // the entry gate may reveal the backdrop and text box before slow figures are built.
        if (options.onBackdrop && !backgrounds.pending && backgrounds.layers.length <= 1) options.onBackdrop(desc.presentationRevision);
        if (options.onPresented && !backgrounds.pending && backgrounds.layers.length <= 1 &&
            Array.from(state.figures.values()).every(entry => !entry.leaving && !entry.replacement && !entry.pendingSrc &&
                !entry.fading.length && (entry.model || entry.sprite))) options.onPresented(desc.presentationRevision);
        cover.width = W; cover.height = H;
        if (now - state.lastPrune > 1500) { state.lastPrune = now; pruneTextures(); }
        const preload = desc.preload || [];
        if (preload.join("\n") !== state.preloadKey) { state.preloadKey = preload.join("\n"); preload.slice(0, 8).forEach(url => loadTexture(url)); }
    }
    // A broken renderer stops until explicitly reloaded; it never retries every frame.
    let releaseForeground = () => {};
    function failFrame(error) {
        if(state.destroyed || state.tickError)return;
        state.tickError=String(error && error.stack || error);
        for(const stop of [()=>app.ticker.stop(),()=>releaseForeground(),()=>{if(state.pump){state.pump.stop=true;state.pump.off();state.pump=null;}}]){
            try{stop();}catch(cleanup){console.warn('[fork-gal-scene] frame stop failed',cleanup);}
        }
        try{onError(String(error && error.message || error));}catch(report){console.warn('[fork-gal-scene] error report failed',report);}
        console.error('[fork-gal-scene] frame failed',error);
    }
    function frame() { if(state.destroyed || state.tickError)return;try { tick(); } catch (error) { failFrame(error); } }
    // Be deliberately conservative: even flat figures can breathe, blink or gesture. Only a
    // settled, empty, neutral stage without DOM animations qualifies for the idle rate.
    function frameRate() {
        const desc = describe(), plan = effects.looks.plan();
        const neutral = plan && !plan.grade && !plan.soften && !plan.frame && !plan.bloom && !plan.screen && !plan.film && !plan.backBlur && !plan.motes.length && !plan.vignette && !plan.haze && !plan.leaks.length && !plan.flare;
        const idle = !state.figures.size && !(desc.figures || []).length && !desc.animatedUi && !desc.thinking && !(thinking.alpha > 0) && !desc.weather && !(desc.effects || []).length && !state.debugEffects.length && !state.override && !state.preview && neutral && backgrounds.layers.length <= 1 && !backgrounds.pending && performance.now() - state.changedAt > 4000 && state.clock >= state.camera.start + state.camera.ms;
        return galFrameRate(quality, !idle, refreshRate, stageReading.get().frameCap);
    }
    // The wrapper restores the requested cap after Pixi dispatches its listeners.
    app.ticker.update = function (now) {
        if(state.destroyed || state.tickError)return;
        try{
            now = now == null ? performance.now() : now;
            const fps = frameRate();
            if (!galFrameDue(pace, now, fps)) return;
            this.maxFPS = 0;
            try { tickerUpdate.call(this, now); } finally { this.maxFPS = fps; }
        }catch(error){failFrame(error);}
    };
    app.ticker.add(frame);
    releaseForeground = forkForeground.application(app);
    own(releaseForeground,release=>release());
    // A new pixel ratio (another monitor, the zoom) re-renders at it, with the filters retuned, without a reload.
    const releaseResolution = galResolutionSubscribe(() => applyQuality(quality));
    own(releaseResolution,release=>release());

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
                    scaleY: entry.sprite ? round(entry.sprite.scale.y, 5) : null, rotation: entry.sprite ? round(entry.sprite.rotation * 180 / Math.PI, 4) : null, blink: entry.blink.active ? entry.blink.phase() : null,
                    live2d: core ? { breath: param("ParamBreath"), angleX: param("ParamAngleX"), angleZ: param("ParamAngleZ"), bodyX: param("ParamBodyAngleX"), eyeL: param("ParamEyeLOpen") } : null };
            });
        },
        blinks() { return Array.from(state.figures.values()).filter(entry => entry.blink.active).map(entry => ({ key: entry.key, phase: entry.blink ? entry.blink.phase() : "open", rect: entry.figure.blinkBundle && entry.figure.blinkBundle.rect, half: entry.blink.hasHalf, allowed: blinkAllowed(entry) })); },
        textures() {
            return { gpu: app.renderer.texture.managedTextures.length, cached: textures.size, layers: backgrounds.layers.length,
                cachedUrls: Array.from(textures.keys()), baseTextureCache: Object.keys(PIXI.utils.BaseTextureCache).length };
        },
        stats() {
            const safe = state.camera.safe || { zoom: 1, fx: 0.5, fy: 0.42, rotation: 0 };
            const shake = { x: round(world.position.x - (safe.ax || 0.5) * app.screen.width, 1), y: round(world.position.y - (safe.ay || 0.42) * app.screen.height, 1) };
            return { quality, grade: backgrounds.grade.name, look: effects.looks.stats(), camera: { shot: state.camera.key, zoom: round(safe.zoom, 3), fx: round(safe.fx, 3), fy: round(safe.fy, 3), rotation: round(safe.rotation * 180 / Math.PI, 2) },
                scale: round(world.scale.x, 3), shake, frame: state.visibleFrame, figureLayer: { visible: figuresBox.visible, alpha: round(figuresBox.alpha, 3) }, phoneShade: round(phoneShade.alpha, 3), call: { ...call.snapshot(), offstage: [...state.offstage.values()].map(entry => ({ key: entry.key, identity: entry.identity, ready: Boolean(entry.model || entry.sprite) })), covers: Boolean(state.callCovers), world: world.visible }, thinking: round(thinking.sprite.visible ? thinking.alpha : 0, 3), dof: round(state.dof.v, 2), effects: effects.stats(),
                layers: backgrounds.layers.map(layer => ({ url: layer.url, time: layer.time, transition: layer.plan ? layer.plan.kind : "", corrected: Boolean(layer.correction) })),
                figures: Array.from(state.figures.values()).map(entry => ({ key: entry.key, kind: entry.kind, leaving: entry.leaving, parked: Boolean(entry.figure.parked), ready: Boolean(entry.model || entry.sprite),
                    x: entry.started ? round(entry.cx.v, 3) : null, alpha: entry.started ? round(entry.alpha.v, 3) : null, shade: entry.started ? round(entry.shade.v, 2) : null,
                    glow: round(entry.appearance.snapshot().glow, 2), shadow: round(entry.appearance.snapshot().shadow, 2), blur: round(entry.appearance.snapshot().blur, 2), filters: entry.filters.all().length,
                    ...(entry.spineFigure ? { spine: entry.spineFigure.debug() } : {}),
                    // figure-life: warp on, the last tap reaction, the reaction still (size, on screen) and the emotions a tap can borrow.
                    life: { armed: round(entry.appearance.snapshot().armed, 2), warp: Boolean(entry.warp), tap: entry.tapReaction ? entry.tapReaction.kind : null, still: entry.tapTexture ? { size: [entry.tapTexture.texture.width, entry.tapTexture.texture.height], shown: Boolean(entry.sprite && entry.sprite.texture === entry.tapTexture.texture) } : entry.tapStills ? entry.tapStills.size : null, stillError: entry.tapStillError || null, reactions: Object.keys(entry.figure.reactions || {}) } })),
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
        figureLayout() { const layout = sceneLayout.layout; return layout && { W: layout.W, H: layout.H, count: layout.count, fit: layout.fit, drop: layout.drop, top: layout.top, framed: layout.framed, head: layout.head, x: layout.x, visible: layout.visible, current: sceneLayout.fit(state.clock) }; },
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
    own(emptyThemeObserver,value=>value.disconnect());
    if (stageHost) emptyThemeObserver.observe(stageHost, {attributes:true, attributeFilter:['data-theme']});
    if(stageHost){for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])own(type,value=>stageHost.removeEventListener(value,onStagePointer,{capture:true}));own('click',value=>stageHost.removeEventListener(value,onStageTap,true));}
    if (stageHost) { for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) stageHost.addEventListener(type, onStagePointer, { capture: true, passive: true }); stageHost.addEventListener("click", onStageTap, true); }
    const faceBoxObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
        if (state.faceEnvironment) state.faceEnvironment.boxDirty = true;
    }) : null;
    if(faceBoxObserver)own(faceBoxObserver,value=>value.disconnect());
    if (stageHost) {galFigureSources.set(stageHost, figureRects);own(stageHost,root=>{if(galFigureSources.get(root)===figureRects)galFigureSources.delete(root);});}
    return {
        figureRects,
        debug,
        set(desc) { state.desc = desc; state.changedAt = performance.now(); },
        // failed figure models and a failed Live2D runtime load try again on
        // the next frame; figures already on stage and the backdrop stay as they are.
        reload() {
            state.figures.forEach(entry => { if (entry.failed && !entry.loading) entry.failed = false; });
            ;
            state.changedAt = performance.now();
        },
        destroy() {
            if(state.destroyed)return;
            state.destroyed = true;
            const errors=[];
            const clean=fn=>{try{fn();}catch(error){errors.push(error);}};
            clean(()=>app.ticker.stop());
            clean(releaseForeground);clean(releaseResolution);
            clean(()=>faceBoxObserver?.disconnect());clean(()=>emptyThemeObserver.disconnect());
            if(stageHost){
                for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])clean(()=>stageHost.removeEventListener(type,onStagePointer,{capture:true}));
                clean(()=>stageHost.removeEventListener('click',onStageTap,true));
                if(galFigureSources.get(stageHost)===figureRects)galFigureSources.delete(stageHost);
            }
            clean(()=>{if(state.pump){state.pump.stop=true;state.pump.off();state.pump=null;}});
            clean(()=>app.ticker.remove(frame));
            for(const dispose of [()=>effects.destroy(),()=>cast.dispose(),()=>sceneLayout.dispose()])clean(dispose);
            for(const entry of state.offstage.values()){if(entry.next)clean(()=>destroyFigure(entry.next));clean(()=>destroyFigure(entry));}
            for(const dispose of [()=>call.dispose(),()=>offstageBox.destroy(),()=>backgrounds.dispose(),()=>figureAssets.dispose(),()=>textures.dispose(),()=>bust.dispose(),()=>thinking.dispose(),()=>app.destroy(true,{children:true})])clean(dispose);
            for(const texture of Object.values(generated))clean(()=>texture.destroy(true));
            if(errors.length)throw new AggregateError(errors,'Stage scene cleanup failed');
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
        if (scene.current && !error) scene.current.reload(); else setAttempt(n => n + 1);
    }, [props.reload]);
    React.useEffect(function () {
        if (!startRenderer) return;
        let live = true;
        loadPixiRuntime().then(function () {
            if (disposed || !live || !host.current) return;
            try {
                scene.current = create(host.current, { quality: latest.current && latest.current.quality, onError: message => { if (live) setError(message); },
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
                const previous=scene.current;scene.current=null;
                try{previous.destroy();}catch(error){console.warn('[fork-gal-scene] cleanup failed',error);}
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

return {Scene:GalScene,create,rects:root=>galFigureSources.get(root)?.() || [],dispose(){
    if(disposed)return;disposed=true;const errors=[];
    for(const instance of [...instances])try{instance.destroy();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'Stage scene scope cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageScene};
