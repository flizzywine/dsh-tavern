function createStageLooks({math={},shaders,art:galLookArt,matrix:galMatrix,clamp:galClamp01,ease:galEase,fade:stageLookFadeMs,useFilter:galUseFilter,weather:weatherModule,colors,document,Image}){
let disposed=false;const instances=new Set();
const {GAL_LOOK_MS, galLookHex, GAL_LOOK_NEUTRAL, galLookMix, galLookMatrix, galLookPlan, galGradeUniforms, GAL_LOOKS_EMPTY, galLookResolve, galLookComposeMatrix, galLookCompose, galFitAffine, galLookUi}=math;
const {GAL_SOFTEN_SIGMA,GAL_SOFTEN_FRAG,GAL_GRADE_FRAG,GAL_SCREEN_FRAG}=shaders;
function galCreateLookRenderer(env) {
    if(disposed)throw new Error('Look renderer is disposed');
    const { PIXI, app, filters } = env;
    const ownedFilters=new Set(),ownedNodes=new Set(),slots={};
    let timeGradeTarget='world';
    function ownFilter(filter){ownedFilters.add(filter);return filter;}
    function ownNode(node){ownedNodes.add(node);return node;}
    const use=(chain,name,make,active,now)=>galUseFilter(slots[chain]||(slots[chain]={}),filters[chain],name,()=>PIXI.filters.KawaseBlurFilter?make():null,active,now,env.tune);

    // Layers: time, mood and the persistent screen look (screen.set) above them.
    const state = {
        layers: [0, 1, 2].map(() => ({ key: null, from: GAL_LOOK_NEUTRAL, to: GAL_LOOK_NEUTRAL, look: GAL_LOOK_NEUTRAL, start: 0, duration: 0 })),
        look: GAL_LOOK_NEUTRAL,
        weatherKey: null, weatherFrom: galMatrix.identity(), weatherTo: galMatrix.identity(), weather: galMatrix.identity(), weatherStart: 0,
        resolved: null, grainAt: 0, textures: new Map(), plan: null, matrix: galMatrix.identity(), lastSweep: 0, lutFits: new Map()
    };
    let instance;
    const destroy=()=>{
        if(state.destroyed)return;state.destroyed=true;instances.delete(instance);const errors=[];
        const cleanup=[...Array.from(state.textures.values(),record=>()=>{if(record.image){record.image.onload=null;record.image.onerror=null;}if(record.texture)record.texture.destroy(true);}),
            ()=>filters[timeGradeTarget].set('timeGrade',null),()=>filters.world.set('grade',null),()=>filters.world.set('screenGrade',null),
            ...Object.values(slots).flatMap(store=>Object.values(store).flatMap(slot=>[()=>slot.chain.set(slot.name,null),()=>slot.filter.destroy()])),
            ...Array.from(ownedFilters,filter=>()=>filter.destroy()),...Array.from(ownedNodes,node=>()=>node.destroy({children:true}))];
        for(const fn of cleanup)try{fn();}catch(error){errors.push(error);}
        state.textures.clear();state.lutFits.clear();ownedFilters.clear();ownedNodes.clear();
        for(const chain of Object.keys(slots))delete slots[chain];
        if(errors.length)throw new AggregateError(errors,'Look renderer cleanup failed');
    };
    try {
    // ---- textures: URLs (LUTs, card leaks / dirt) and generated pictures, released after 3 s unused.
    function texture(key, now) {
        let record = state.textures.get(key);
        if (!record) {
            record = { key, texture: null, used: now, failed: false };
            state.textures.set(key, record);
            if (key.startsWith("url:")) {
                const url = key.slice(4), image = new Image();record.image=image;
                image.decoding = "async";
                const pending=image.decode?null:new Promise((ok,fail)=>{image.onload=ok;image.onerror=fail;});
                image.src=url;
                (pending||Promise.resolve().then(()=>image.decode())).then(function () {
                    image.onload=null;image.onerror=null;
                    if (state.destroyed || state.textures.get(key) !== record) return;
                    record.texture = new PIXI.Texture(new PIXI.BaseTexture(image, { mipmap: PIXI.MIPMAP_MODES.OFF, scaleMode: PIXI.SCALE_MODES.LINEAR, wrapMode: PIXI.WRAP_MODES.CLAMP }));
                    record.image = image;
                }).catch(function (error) { image.onload=null;image.onerror=null;if(state.destroyed||state.textures.get(key)!==record)return;record.failed = true; console.warn("[fork-gal-looks] texture failed", url, error); });
            } else record.texture = galLookArt(PIXI, key);
        }
        record.used = now;
        return record.texture;
    }
    function sweep(now) {
        if (now - state.lastSweep < 1000 && now >= state.lastSweep) return;
        state.lastSweep = now;
        state.textures.forEach(function (record, key) {
            if (now - record.used < 3000 && now >= record.used) return;
            if(record.image){record.image.onload=null;record.image.onerror=null;}
            if (record.texture) record.texture.destroy(true);
            state.textures.delete(key); state.lutFits.delete(key);
        });
    }
    // Affine approximation of a loaded LUT (for the DOM UI), computed once per LUT.
    function lutFit(url) {
        const key = "url:" + url;
        if (state.lutFits.has(key)) return state.lutFits.get(key);
        const record = state.textures.get(key);
        if (!record || !record.image) return null;
        let fit = null;
        try {
            const img = record.image, size = img.naturalHeight, canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth; canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, size).data, samples = [];
            for (let b = 0; b < 5; b++) for (let g = 0; g < 5; g++) for (let r = 0; r < 5; r++) {
                const ri = Math.round(r / 4 * (size - 1)), gi = Math.round(g / 4 * (size - 1)), bi = Math.round(b / 4 * (size - 1));
                const at = (gi * canvas.width + bi * size + ri) * 4;
                samples.push([[r / 4, g / 4, b / 4], [data[at] / 255, data[at + 1] / 255, data[at + 2] / 255]]);
            }
            fit = galFitAffine(samples);
        } catch (error) { console.warn("[fork-gal-looks] LUT fit", error); }
        state.lutFits.set(key, fit);
        return fit;
    }

    // ---- world passes
    const makeGrade = () => env.tune(ownFilter(new PIXI.Filter(undefined, GAL_GRADE_FRAG, {
        uR: new Float32Array([1, 0, 0, 0]), uG: new Float32Array([0, 1, 0, 0]), uB: new Float32Array([0, 0, 1, 0]), uGamma: new Float32Array([1, 1, 1]),
        uShadows: new Float32Array([0.5, 0.5, 0.5]), uHighlights: new Float32Array([0.5, 0.5, 0.5]), uSplit: new Float32Array([0, 0]), uKeep: new Float32Array([0, 0.1, 0]),
        uStyle: new Float32Array([0, 0, 2]), uLutA: PIXI.Texture.WHITE, uLutB: PIXI.Texture.WHITE, uLut: new Float32Array([0, 0, 16, 16])
    })));
    const timeGradeFilter = makeGrade(), gradeFilter = makeGrade(), screenGradeFilter = makeGrade();
    timeGradeFilter.enabled = gradeFilter.enabled = screenGradeFilter.enabled = false;
    filters.world.set("timeGrade", timeGradeFilter);
    filters.world.set("grade", gradeFilter);
    filters.world.set("screenGrade", screenGradeFilter);
    const setUniform = (u, name, values) => { const target = u[name]; for (let i = 0; i < values.length; i++) target[i] = values[i]; };

    // ---- overlay sprites
    const sprite = function (blend) {
        const item = ownNode(new PIXI.Sprite(PIXI.Texture.EMPTY));
        item.alpha = 0; item.visible = false;
        if (blend) item.blendMode = blend;
        env.overlay.addChild(item);
        return item;
    };
    // the look's frame picture lies under the other look overlays (the original's frame sprite, layout order 7).
    const framePicture = sprite();
    const vignette = sprite(), haze = sprite(PIXI.BLEND_MODES.SCREEN);
    const leaks = [sprite(PIXI.BLEND_MODES.SCREEN), sprite(PIXI.BLEND_MODES.SCREEN)], leakCores = [sprite(PIXI.BLEND_MODES.SCREEN), sprite(PIXI.BLEND_MODES.SCREEN)];
    const flare = ownNode(new PIXI.Container());
    flare.visible = false;
    env.overlay.addChild(flare);
    const flareParts = ["glow", "streak", "core", "ring", "ghost", "ghost", "ghost", "ghost"].map(function (art) {
        const item = new PIXI.Sprite(PIXI.Texture.EMPTY);
        item.anchor.set(0.5); item.blendMode = PIXI.BLEND_MODES.ADD; item.art = art;
        flare.addChild(item);
        return item;
    });
    const hide = item => { item.visible = false; item.alpha = 0; };

    // ---- target selection: registry + light + automatic time grade → world look; weather tint.
    function setTarget(desc, now) {
        const registry = desc.looks || GAL_LOOKS_EMPTY;
        const resolved = desc.packLayers || galLookResolve(registry, desc.lighting || desc.light || "auto", desc.grade || "");
        state.resolved = resolved;
        const target=desc.packLayers?.timeGradeTarget||'world';
        if(target!==timeGradeTarget){filters[timeGradeTarget].set('timeGrade',null);filters[target].set('timeGrade',timeGradeFilter);timeGradeTarget=target;}
        state.layers.forEach(function (layer, index) {
            if (index === 2) {
                // The screen look fades on its own definition (stageLookFadeMs: 减少动态 / skipping at most 150 ms).
                const screen = desc.screenLook || null, key = screen ? screen.key : "";
                if (key === layer.key) return;
                const first = layer.key == null, entering = Boolean(screen);
                layer.key = key; layer.from = layer.look; layer.to = screen ? screen.look : GAL_LOOK_NEUTRAL; layer.start = now;
                layer.duration = first || desc.snap ? 0 : stageLookFadeMs(entering ? screen : layer.spec, entering, desc.safety, desc.skipping);
                layer.spec = screen;
                return;
            }
            const key = desc.packLayers ? JSON.stringify(index ? resolved.moodWorld : resolved.timeWorld) : registry.version + "|" + (index ? resolved.lighting.mood : resolved.grade);
            if (key === layer.key) return;
            const first = layer.key == null;
            layer.key = key; layer.from = layer.look; layer.to = index ? resolved.moodWorld : resolved.timeWorld; layer.start = now;
            // A mood look with its own fade [in, out] (s) enters and leaves on it.
            const moodMs = layer.to.fade ? 1000 * layer.to.fade[0] : layer.from && layer.from.fade ? 1000 * layer.from.fade[1] : 4000;
            layer.duration = first || desc.snap ? 0 : index ? moodMs : desc.timeFadeMs === 2500 ? 2500 : desc.skipping ? 150 : GAL_LOOK_MS;
        });
        const weather = weatherModule.kinds.includes(desc.weather) ? desc.weather : "";
        if (weather !== state.weatherKey) {
            const first = state.weatherKey == null;
            state.weatherKey = weather; state.weatherFrom = state.weather; state.weatherTo = weatherModule.matrix(weather); state.weatherStart = first ? now - GAL_LOOK_MS : now;
        }
    }
    function tick(desc, now, W, H, quality) {
        if(state.destroyed)return state.look;
        setTarget(desc, now);
        state.layers.forEach(function (layer) {
            const t = layer.duration > 0 ? galClamp01((now - layer.start) / layer.duration) : 1;
            layer.look = t >= 1 ? layer.to : galLookMix(layer.from, layer.to, galEase.inOutSine(t));
        });
        const timeLook = state.layers[0].look, moodLook = state.layers[1].look, screenLook = state.layers[2].look;
        state.look = galLookCompose(galLookCompose(timeLook, moodLook), screenLook);
        const reduced = Boolean(desc.safety && desc.safety.reducedMotion);
        const tw = galClamp01((now - state.weatherStart) / GAL_LOOK_MS);
        state.weather = tw >= 1 ? state.weatherTo : galMatrix.mix(state.weatherFrom, state.weatherTo, galEase.inOutSine(tw));
        const look = state.look, high = quality !== "low";
        const plan = state.plan = galLookPlan(look, quality, state.weather);
        const timePlan = galLookPlan(timeLook, quality), moodPlan = galLookPlan(moodLook, quality, state.weather), screenPlan = galLookPlan(screenLook, quality);
        state.matrix = galMatrix.multiply(screenPlan.matrix, galLookComposeMatrix(timePlan.matrix, moodPlan.matrix));
        // Preserve nonlinear time grading (gamma/LUT/etc.) before the mood pass; normally disabled.
        function grade(filter, gradeLook, gradePlan, target = "world") {
        if (gradePlan.grade) {
            const u = galGradeUniforms(gradeLook, gradePlan.matrix), uniforms = filter.uniforms;
            ["uR", "uG", "uB", "uGamma", "uShadows", "uHighlights", "uSplit", "uKeep", "uStyle"].forEach(name => setUniform(uniforms, name, u[name]));
            const lutA = u.lutA ? texture("url:" + u.lutA, now) : null, lutB = u.lutB ? texture("url:" + u.lutB, now) : null;
            uniforms.uLutA = lutA || PIXI.Texture.WHITE; uniforms.uLutB = lutB || PIXI.Texture.WHITE;
            setUniform(uniforms, "uLut", [lutA ? u.uLutAmount[0] : 0, lutB ? u.uLutAmount[1] : 0, lutA ? lutA.height : 16, lutB ? lutB.height : 16]);
        }
        if (filter.enabled !== gradePlan.grade) { filter.enabled = gradePlan.grade; filters[target].refresh(); }
        }
        grade(timeGradeFilter, timeLook, timePlan, timeGradeTarget);
        grade(gradeFilter, moodLook, moodPlan);
        grade(screenGradeFilter, screenLook, screenPlan);
        // bloom
        const bloom = use("world", "bloom", () => Object.assign(new PIXI.filters.AdvancedBloomFilter({ threshold: 0.72, bloomScale: 0, brightness: 1, blur: 7, quality: 4 }), { forkLowRes: true }), plan.bloom, now);
        if (bloom) { bloom.threshold = look.bloom.threshold; bloom.bloomScale = look.bloom.amount; bloom.brightness = 1; if (Math.abs(bloom.blur - look.bloom.blur) > 0.05) bloom.blur = look.bloom.blur; }
        // screen (lens + stylize + dirt)
        const screen = use("world", "screen", () => new PIXI.Filter(undefined, GAL_SCREEN_FRAG, { uLens: new Float32Array(4), uFx: new Float32Array(4), uWobble: new Float32Array(2), uDirtTex: PIXI.Texture.BLACK }), plan.screen, now);
        if (screen) {
            const dirtOn = high && look.dirt.amount > 0.005;
            const dirt = dirtOn ? texture(look.dirt.texture ? "url:" + look.dirt.texture : "dirt", now) : null;
            const u = screen.uniforms, wobble = high ? look.wobble : 0, secs = now / 1000;
            const distortion = high ? look.distortion * (1 + 0.35 * wobble * Math.sin(secs * 0.9)) : 0;
            setUniform(u, "uLens", [distortion, high ? look.chroma * (1 + 0.4 * wobble * Math.sin(secs * 1.3 + 1)) : 0, look.pixelate >= 1.5 ? look.pixelate : 0, high ? look.halftone : 0]);
            setUniform(u, "uFx", [look.scanlines, dirt ? look.dirt.amount : 0, secs % 1000, app.renderer.resolution]);
            setUniform(u, "uWobble", [wobble, secs]);
            u.uDirtTex = dirt || PIXI.Texture.BLACK;
        }
        // soften: a Gaussian of sigma .0015 x the stage height, mixed in by look.soften (the same feel at any size)
        const soften = use("world", "soften", () => new PIXI.Filter(undefined, GAL_SOFTEN_FRAG, { uSoften: new Float32Array([1, 0]) }), plan.soften, now);
        if (soften) setUniform(soften.uniforms, "uSoften", [GAL_SOFTEN_SIGMA * H * (soften.resolution || app.renderer.resolution), look.soften]);
        // film grain and scratches, re-seeded at 24 fps like a projector
        const film = use("world", "film", () => new PIXI.filters.OldFilmFilter({ sepia: 0, noise: 0, noiseSize: 1, scratch: 0, scratchDensity: 0.32, scratchWidth: 1.4, vignetting: 0, vignettingAlpha: 0, vignettingBlur: 0.3 }), plan.film, now);
        if (film) {
            film.noise = 0.16 * look.grain; film.scratch = 0.55 * look.grain * look.scratches; film.noiseSize = Math.max(1, app.renderer.resolution * 0.75);
            // 减少动态 freezes the grain (stage-effects.md: moving parts of a look hold still).
            if (!reduced && (now - state.grainAt > 42 || now < state.grainAt)) { state.grainAt = now; film.seed = Math.random(); }
        }
        // overlays
        const frameArt = plan.frame ? texture("url:" + look.frame.texture, now) : null;
        if (frameArt) { framePicture.texture = frameArt; framePicture.alpha = look.frame.amount; framePicture.visible = true; framePicture.width = W; framePicture.height = H; }
        else hide(framePicture);
        const pulse = look.vignette.pulse ? 1 + look.vignette.pulse * Math.sin(2 * Math.PI * now / 1700) : 1;
        if (plan.vignette) {
            const soft = Math.round(look.vignette.softness * 4);
            vignette.texture = texture("vignette:" + soft, now) || PIXI.Texture.EMPTY;
            vignette.tint = galLookHex(look.vignette.color); vignette.alpha = Math.min(1, look.vignette.amount * pulse); vignette.visible = true;
            vignette.width = W; vignette.height = H;
        } else hide(vignette);
        if (plan.haze) {
            haze.texture = texture("vignette:2", now) || PIXI.Texture.EMPTY;
            haze.tint = galLookHex(look.haze.color); haze.alpha = look.haze.amount; haze.visible = true; haze.width = W; haze.height = H;
        } else hide(haze);
        leaks.forEach(function (item, i) {
            const leak = plan.leaks[i], core = leakCores[i];
            if (!leak) { hide(item); hide(core); return; }
            const art = leak.texture ? texture("url:" + leak.texture, now) : texture("leak:" + leak.from, now);
            if (!art) { hide(item); hide(core); return; }
            const breathe = 0.86 + 0.14 * Math.sin(2 * Math.PI * now / 7300 + i * 2.1), drift = Math.sin(2 * Math.PI * now / 11000 + i) * 0.02;
            item.texture = art; item.tint = galLookHex(leak.color); item.alpha = Math.min(1, leak.amount * breathe);
            item.width = W * 1.06; item.height = H * 1.06; item.position.set(W * (drift - 0.03), H * -0.03); item.visible = true;
            core.texture = art; core.tint = galLookHex(leak.color.map(c => c + (1 - c) * 0.55)); core.alpha = Math.min(1, leak.amount * 0.45 * breathe);
            core.width = W * 0.8; core.height = H * 0.8;
            core.position.set(leak.from === "right" ? W * 0.2 : leak.from === "top" ? W * 0.1 : 0, leak.from === "top" ? 0 : leak.from === "corner" ? 0 : H * 0.1); core.visible = true;
        });
        if (plan.flare) tickFlare(look.flare, now, W, H); else flare.visible = false;
        sweep(now);
        return look;
    }
    // Lens flare: glow and hot core at the source, an anamorphic streak, a halo ring and ghosts along the
    // line from the source through the centre; a slow shimmer.
    function tickFlare(spec, now, W, H) {
        flare.visible = true;
        const sx = spec.x * W, sy = spec.y * H, cx = W / 2, cy = H / 2, shimmer = 0.9 + 0.1 * Math.sin(now / 430) * Math.sin(now / 1170 + 1);
        const color = galLookHex(spec.color), a = spec.amount * shimmer;
        const ghosts = [[-0.25, 0.05, 0.10, [0.6, 1, 0.8]], [0.45, 0.07, 0.07, [1, 0.8, 0.6]], [0.9, 0.12, 0.09, [0.7, 0.75, 1]], [1.35, 0.05, 0.12, [1, 0.6, 0.9]]];
        let ghost = 0;
        flareParts.forEach(function (item) {
            const art = texture("flare:" + item.art, now);
            item.texture = art || PIXI.Texture.EMPTY;
            if (item.art === "glow") { item.position.set(sx, sy); item.width = item.height = H * 1.1; item.tint = color; item.alpha = 0.75 * a; }
            else if (item.art === "core") { item.position.set(sx, sy); item.width = item.height = H * 0.22; item.tint = colors.mix(color, 0xffffff, 0.6); item.alpha = 0.9 * a; }
            else if (item.art === "streak") { item.position.set(sx, sy); item.width = W * 1.5; item.height = H * 0.035; item.tint = colors.mix(color, 0xbfd4ff, 0.35); item.alpha = 0.55 * a; }
            else if (item.art === "ring") { item.position.set(sx, sy); item.width = item.height = H * 0.75; item.tint = color; item.alpha = 0.22 * a; }
            else {
                const [k, size, alpha, tint] = ghosts[ghost++];
                item.position.set(cx + (cx - sx) * k, cy + (cy - sy) * k);
                item.width = item.height = H * size * 2.2; item.tint = colors.mix(color, galLookHex(tint), 0.5); item.alpha = alpha * a * 1.6;
            }
        });
    }
    instance={
        tick,
        look: () => state.look,
        plan: () => state.plan,
        matrix: () => state.matrix,
        resolved: () => state.resolved,
        // The DOM UI frame (galLookUi) for the current look; beats: { white, red, black, lightning, vignette, shake }.
        ui(grade, beats) {
            if(state.destroyed)return null;
            const look = state.look, pulse = look.vignette.pulse ? 1 + look.vignette.pulse * Math.sin(2 * Math.PI * (beats.now || 0) / 1700) : 1;
            let vig = [look.vignette.color, look.vignette.amount * pulse];
            if (beats.vignette > vig[1] * 0.8) vig = [[0.54, 0, 0.06], Math.max(vig[1], beats.vignette)];
            const M = galMatrix;
            function uiLayer(layer, matrix) {
                const identity = M.identity(), lut = identity.slice();
                for (const item of layer.luts) {
                    const fit = lutFit(item.url);
                    if (fit) fit.forEach((value, i) => { lut[i] += (value - identity[i]) * item.amount; });
                }
                return M.chain(matrix, M.saturate(1 - 0.75 * layer.keepHue.amount), lut);
            }
            const time = state.layers[0].look, mood = state.layers[1].look, screen = state.layers[2].look;
            const matrix = M.multiply(uiLayer(screen, galLookMatrix(screen)), galLookComposeMatrix(uiLayer(time, galLookMatrix(time)), uiLayer(mood, M.multiply(state.weather, galLookMatrix(mood)))));
            return galLookUi({ look: Object.assign({}, look, { keepHue: GAL_LOOK_NEUTRAL.keepHue }), matrix, grade, white: beats.white, red: beats.red, black: beats.black,
                lightning: beats.lightning, vignette: vig, haze: [look.haze.color, look.haze.amount], shake: beats.shake });
        },
        stats() {
            return { filters:Object.entries(slots).flatMap(([chain,store])=>Object.values(store).map(slot=>chain+":"+slot.name+(slot.filter.enabled===false?"(idle)":""))), look: state.resolved ? state.resolved.id : "", lighting: state.resolved ? state.resolved.lighting : null, fades: state.layers.map(layer => layer.duration), grade: state.resolved ? state.resolved.grade : "", textures: Array.from(state.textures.keys()),
                frame: Math.round((framePicture.visible ? framePicture.alpha : 0) * 100) / 100, vignette: Math.round(vignette.alpha * 100) / 100, haze: Math.round(haze.alpha * 100) / 100, leaks: leaks.filter(item => item.visible).length, flare: flare.visible };
        },
        destroy
    };
    instances.add(instance);return instance;
    }catch(error){try{destroy();}catch(cleanup){throw new AggregateError([error,cleanup],'Look renderer setup failed');}throw error;}
}
return {create:galCreateLookRenderer,dispose(){if(disposed)return;disposed=true;const errors=[];for(const instance of [...instances])try{instance.destroy();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Looks cleanup failed');}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageLooks};
