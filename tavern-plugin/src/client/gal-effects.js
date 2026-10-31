// cinematic effects of the
// stage scene (gal-scene.js). Stage looks (data-driven post-processing, gal-looks.js, included
// at the end of this file) with the persistent screen look, weather particles, the core one-shot effects
// (shake, flashes, blackout, glitch, shock, heartbeat; their definitions and the one safety policy are
// stage-effects.cjs) and manpu above a figure's head. Everything here is drawn in code at
// runtime; pixi-filters 4 (vendored, MIT) supplies the post filters and is loaded lazily after pixi.
// @include stage-effects.cjs
//
// Placement in the scene's display tree:
//   world filters   look passes: grade (look × weather) → bloom → screen (lens / stylize) → film,
//                   then beats: blur / glitch / shock
//   backdrop        blur (depth of field, look backBlur)
//   backFx, frontFx weather particles behind / in front of the figures (and look motes)
//   emotes          emote stickers, following their figure's head
//   overlay         look overlays (vignette, haze, leaks, flare), red / white flashes, lightning, blackout

// Camera shots (persistent). The world point (fx, fy) (fractions of the stage) sits at the screen point
// (ax, ay); zoom and rotation turn around it. head: { x, y } of the close-up target, fractions.
const GAL_SHOTS = {
    "": { zoom: 1, ms: 900, ease: "inOutCubic" },
    push: { zoom: 1.12, ms: 8000, ease: "inOutSine" },
    close: { zoom: 1.35, ms: 700, ease: "inOutCubic" },
    "pan-left": { zoom: 1.1, panX: -0.06, ms: 4000, ease: "inOutSine" },
    "pan-right": { zoom: 1.1, panX: 0.06, ms: 4000, ease: "inOutSine" },
    dutch: { zoom: 1.08, rotation: 3.5 * Math.PI / 180, ms: 1000, ease: "inOutCubic" }
};
function galShotTarget(shot, head) {
    let spec = GAL_SHOTS[shot] || GAL_SHOTS[""];
    if (shot === "close" && !head) spec = GAL_SHOTS[""];
    const target = { zoom: spec.zoom, fx: 0.5 + (spec.panX || 0), fy: 0.42, ax: 0.5, ay: 0.42, rotation: spec.rotation || 0 };
    if (shot === "close" && head) {
        target.fx = head.x; target.fy = head.y; target.ax = 0.5;
        target.zoom = head.zoom ?? spec.zoom; target.ay = head.ay ?? 0.36;
    }
    return { target, ms: spec.ms, ease: spec.ease };
}
// Keeps the camera inside the backdrop (which overscans the stage by margin on each side): zooms in just
// enough for rotations, then slides the focus so no corner of the screen shows past the picture.
function galCameraClamp(cam, W, H, margin) {
    const m = margin == null ? 0.018 : margin;
    const cos = Math.cos(cam.rotation || 0), sin = Math.sin(cam.rotation || 0);
    let zoom = Math.max(0.2, cam.zoom || 1);
    const corners = z => [[0, 0], [W, 0], [0, H], [W, H]].map(function ([sx, sy]) {
        const dx = (sx - cam.ax * W) / z, dy = (sy - cam.ay * H) / z;
        return [dx * cos + dy * sin, -dx * sin + dy * cos];
    });
    const span = list => [Math.min(...list), Math.max(...list)];
    let c = corners(zoom);
    let [x0, x1] = span(c.map(p => p[0])), [y0, y1] = span(c.map(p => p[1]));
    const need = Math.max(1, (x1 - x0) / (W * (1 + 2 * m)), (y1 - y0) / (H * (1 + 2 * m)));
    if (need > 1) { zoom *= need * 1.0001; c = corners(zoom); [x0, x1] = span(c.map(p => p[0])); [y0, y1] = span(c.map(p => p[1])); }
    let fx = cam.fx * W, fy = cam.fy * H;
    if (fx + x0 < -m * W) fx = -m * W - x0; else if (fx + x1 > (1 + m) * W) fx = (1 + m) * W - x1;
    if (fy + y0 < -m * H) fy = -m * H - y0; else if (fy + y1 > (1 + m) * H) fy = (1 + m) * H - y1;
    return Object.assign({}, cam, { zoom, fx: fx / W, fy: fy / H });
}

// ---------- Effect runtime (pixi) ----------

let pixiFilters = null;
function loadPixiFilters() {
    if (window.PIXI && window.PIXI.filters && window.PIXI.filters.KawaseBlurFilter) return Promise.resolve(window.PIXI.filters);
    if (pixiFilters) return pixiFilters;
    pixiFilters = forkLoadScript(PIXI_VENDOR + "pixi-filters.js")
        .then(() => { if (!window.PIXI.filters.KawaseBlurFilter) throw new Error("pixi-filters 不可用"); return window.PIXI.filters; })
        .catch(error => { pixiFilters = null; throw error; });
    return pixiFilters;
}
// The effects runtime of one scene. env: { PIXI, app, world, backdrop, backFx, frontFx, emotes, overlay,
// filters (named chains), tune(filter), quality(), headOf(alias) → { x, top, chin, width } | null }.
function galCreateEffects(env) {
    const { PIXI, app, filters } = env;
    const rand = Math.random;
    const textures = [];
    const own = texture => { textures.push(texture); return texture; };
    const vignetteTexture = own(galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
        ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(w / h, 1);
        const g = ctx.createRadialGradient(0, 0, h * 0.18, 0, 0, h * 0.62);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.45, "rgba(255,255,255,.12)"); g.addColorStop(0.8, "rgba(255,255,255,.62)"); g.addColorStop(1, "rgba(255,255,255,1)");
        ctx.fillStyle = g; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
    }));
    const sprite = function (texture, blend, tint) {
        const item = new PIXI.Sprite(texture);
        item.alpha = 0; item.visible = false; item.tint = tint == null ? 0xffffff : tint;
        if (blend) item.blendMode = blend;
        env.overlay.addChild(item);
        return item;
    };
    // The look overlays (vignette, haze, leaks, flare) sit below the beat flashes.
    const lookLayer = new PIXI.Container();
    env.overlay.addChild(lookLayer);
    const beatVignette = sprite(vignetteTexture, null, 0x8a0010);
    const lightning = sprite(PIXI.Texture.WHITE, PIXI.BLEND_MODES.ADD, 0xdfe8ff);
    // The one full-screen flash cover (stage-effects.cjs flash / blackout / the shock's burst), in the flash's own colour.
    const cover = sprite(PIXI.Texture.WHITE);
    const state = {
        weathers: [], weatherKey: null, motes: {}, lightningAt: 0, shake: { x: 0, y: 0 }, beatFrame: { white: 0, red: 0, black: 0, lightning: 0, vignette: 0 },
        beats: [], shakes: [], slots: {}, stats: { particles: 0 }, policy: stageSafety(null, false), tables: null, screenKey: "", screenLook: null
    };

    // Filters used by effects are created on first use, disabled when idle and destroyed after 3 s idle.
    function use(chainName, name, make, active, now) {
        const store = state.slots[chainName] || (state.slots[chainName] = {});
        return galUseFilter(store, filters[chainName], name, () => PIXI.filters.KawaseBlurFilter ? make() : null, active, now, env.tune);
    }
    const lowRes = filter => { filter.forkLowRes = true; return filter; };
    // ---- stage looks (world passes and overlays; gal-looks.js)
    const looks = stageViews.looks.create({ PIXI, app, filters, overlay: lookLayer, tune: env.tune });

    // ---- depth of field and the look's background softness: one blur on the backdrop.
    function tickBackdrop(desc, now, dof, high) {
        const plan = looks.plan();
        const strength = high ? Math.max(4 * dof, plan ? plan.backBlur : 0) : 0;
        const blur = use("backdrop", "blur", () => lowRes(new PIXI.filters.KawaseBlurFilter(0, 4, true)), strength > 0.05, now);
        if (blur) blur.blur = strength;
    }

    // ---- weather particles (and the dream light motes).
    const weather=stageViews.weather.create(env);
    const createWeather=weather.create,destroyWeather=weather.destroy;
    const stepWeather=(...args)=>{state.stats.particles+=weather.step(...args);};
    function tickWeather(desc, now, dt, W, H, quality) {
        const kind = stageViews.weather.kinds.includes(desc.weather) ? desc.weather : "";
        const key = kind ? kind + ":" + quality : "";
        if (key !== state.weatherKey) {
            state.weatherKey = key;
            state.weathers.forEach(system => { system.target = 0; });
            const system = kind ? createWeather(kind, quality) : null;
            if (system) { if (desc.skipping) system.alpha = 1; state.weathers.push(system); }
            state.lightningAt = now + 1800 + rand() * 2500;
        }
        // Look motes (bokeh / sparkle): one system per kind, faded to the look's amount.
        const wanted = {};
        const plan = looks.plan();
        (plan ? plan.motes : []).forEach(item => { wanted[item.kind] = item.amount; });
        Object.keys(wanted).forEach(function (kind) { if (!state.motes[kind]) { const system = createWeather(kind === "bokeh" ? "motes" : kind, quality); if (system) { system.target = 0; state.motes[kind] = system; } } });
        Object.keys(state.motes).forEach(kind => { state.motes[kind].target = wanted[kind] || 0; });
        state.stats.particles = 0;
        state.weathers = state.weathers.filter(function (system) {
            stepWeather(system, now, dt, W, H);
            if (!system.target && system.alpha < 0.01) { destroyWeather(system); return false; }
            return true;
        });
        Object.keys(state.motes).forEach(function (kind) {
            const system = state.motes[kind];
            stepWeather(system, now, dt, W, H);
            if (!system.target && system.alpha < 0.01) { destroyWeather(system); delete state.motes[kind]; }
        });
        // Storm: lightning now and then (and a rumble of the camera on the brightest strikes). A strike is a flash: it
        // passes the stage-wide gate under 光敏保护 (its thunder still sounds).
        let flashAlpha = 0;
        if (kind === "storm") {
            if (now >= state.lightningAt && !desc.skipping) {
                state.strike = stageFlashGate.admit(state.policy) ? { start: now, strength: (0.7 + rand() * 0.3) * (state.policy.photosensitive ? 0.6 : 1) } : null;
                state.lightningAt = now + 5500 + rand() * 6500; if (typeof stageSfx !== "undefined") stageSfx.thunder(0.7 + rand() * 0.3);
            }
            if (state.strike) { flashAlpha = stageViews.weather.lightning(now - state.strike.start) * state.strike.strength; if (now - state.strike.start > 900) state.strike = null; }
        } else state.strike = null;
        return flashAlpha;
    }

    // ---- one-shot effects. Each name resolves once, when it plays, through the one resolver
    // (stage-effects.cjs: card-local > skin > engine) and the one safety policy; the record holds the id only.
    // tables: { skin, local, screen } - the effects tables and the skin's design screen height (shake paths).
    function resolved(name, tables) { return stageEffectResolve(name, tables && tables.skin, tables && tables.local); }
    function addShake(spec, now, tables) {
        if (state.policy.reducedMotion || !spec || spec.kind !== "shake") return;
        state.shakes.push(Object.assign({}, spec, { screen: spec.path ? spec.screen || tables && tables.screen || 576 : undefined, seed: rand() * 6.283, start: now }));
    }
    function trigger(effect, now, tables) {
        if (effect.op === "emote") return addEmote(effect, now);
        if (effect.op !== "beat" || !STAGE_EFFECT_BEATS.includes(effect.value)) return false;
        const spec = resolved(effect.value, tables), policy = state.policy;
        if (!spec) return false;
        if (spec.kind === "shake") { addShake(spec, now, tables); return true; }
        // 减少动态: a glitch does not play; a shock keeps only its burst; a heartbeat keeps its vignette.
        if (spec.kind === "glitch" && policy.reducedMotion) return true;
        const beat = { name: effect.value, spec, start: now, seed: rand(), flash: null };
        const flash = spec.kind === "flash" ? spec : spec.kind === "shock" ? spec.flash : null;
        // A flash passes the stage-wide gate (a dark cover never counts) and is softened under 光敏保护.
        if (flash && (stageFlashDark(flash) || stageFlashGate.admit(policy))) beat.flash = stageFlashSafe(flash, policy);
        if (spec.kind === "flash" && !beat.flash) return true;
        if (spec.kind === "shock" && !policy.reducedMotion) {
            if (spec.shake) addShake(resolved(spec.shake, tables), now, tables);
            const head = effect.id ? env.headOf(effect.id) : null;
            beat.origin = head ? env.world.toGlobal(new PIXI.Point(head.x, (head.top + head.chin) / 2)) : null;
            beat.wave = spec.wave !== false;
        }
        state.beats.push(beat);
        return true;
    }
    function beatFrame(beat, ms) {
        const spec = beat.spec, frame = { cover: 0, color: STAGE_EFFECTS.flash.color, zoom: 0, vignette: 0, vignetteColor: "", glitch: 0, shock: -1, done: true };
        if (beat.flash) { const a = stageFlashAt(beat.flash, ms); if (a >= 0) { frame.cover = a; frame.color = beat.flash.color; frame.done = false; } }
        if (spec.kind === "shock" && beat.wave) { const t = ms / spec.waveMs; if (t < 1) { frame.shock = Math.max(0, t); frame.done = false; } }
        if (spec.kind === "glitch") { const g = stageGlitchAt(spec, ms); frame.glitch = g.strength; frame.done = g.done; }
        if (spec.kind === "pulse") { const p = stagePulseAt(spec, ms, state.policy.reducedMotion); frame.zoom = p.zoom; frame.vignette = p.vignette; frame.vignetteColor = spec.color; frame.done = p.done; }
        return frame;
    }
    function tickBeats(now, W, H, lightningAlpha) {
        let own = 0, ownColor = STAGE_EFFECTS.flash.color, v = 0, vColor = STAGE_EFFECTS.heartbeat.color, glitch = 0, shock = null;
        state.beats = state.beats.filter(function (beat) {
            const f = beatFrame(beat, now - beat.start);
            if (f.cover > own) { own = f.cover; ownColor = f.color; }
            if (f.vignette > v) { v = f.vignette; vColor = f.vignetteColor || vColor; }
            glitch = Math.max(glitch, f.glitch);
            if (f.shock >= 0) shock = { beat, t: f.shock };
            beat.frame = f;
            return !f.done;
        });
        cover.tint = parseInt(ownColor.slice(1), 16); cover.alpha = own; cover.visible = own > 0.002; cover.width = W; cover.height = H;
        // The DOM UI follows the cover as the nearest of white / red / black (galLookUi).
        let uw = 0, ur = 0, ub = 0;
        if (own > 0) { if (stageEffectRed(ownColor)) ur = own; else if (stageEffectLuma(ownColor) >= 0.5) uw = own; else ub = own; }
        state.beatFrame = { white: uw, red: ur, black: ub, lightning: lightningAlpha, vignette: v, skinFlash: own };
        beatVignette.tint = parseInt(vColor.slice(1), 16);
        [[lightning, lightningAlpha * 0.55], [beatVignette, v]].forEach(function ([item, alpha]) {
            item.alpha = alpha; item.visible = alpha > 0.002; item.width = W; item.height = H;
        });
        const glitchFilter = use("world", "glitch", () => new PIXI.filters.GlitchFilter({ slices: 8, offset: 0, direction: 0, fillMode: 2, average: false }), glitch > 0, now);
        if (glitchFilter) {
            const beat = state.beats.find(item => item.spec.kind === "glitch");
            if (beat && (!beat.at || now - beat.at > 45)) { beat.at = now; glitchFilter.seed = rand(); glitchFilter.slices = 6 + Math.floor(rand() * 8); glitchFilter.direction = rand() < 0.8 ? 0 : 90; glitchFilter.refresh(); }
            const px = 9 * glitch * H / 720;
            glitchFilter.offset = 34 * glitch * H / 720; glitchFilter.red = [-px, 0]; glitchFilter.green = [0, px * 0.35]; glitchFilter.blue = [px, 0];
        }
        const shockFilter = use("world", "shock", () => new PIXI.filters.ShockwaveFilter([W / 2, H * 0.42], { amplitude: 0, wavelength: 150, speed: 1, brightness: 1, radius: -1 }, 0), Boolean(shock), now);
        if (shockFilter && shock) {
            const origin = shock.beat.origin || { x: W / 2, y: H * 0.42 }, k = H / 720;
            const reach = Math.hypot(Math.max(origin.x, W - origin.x), Math.max(origin.y, H - origin.y)) + 160 * k;
            shockFilter.center = [origin.x, origin.y];
            shockFilter.time = shock.t; shockFilter.speed = reach;
            shockFilter.amplitude = 30 * k * Math.pow(1 - shock.t, 1.4);
            shockFilter.wavelength = (120 + 90 * shock.t) * k;
            shockFilter.brightness = 1 + 0.22 * (1 - shock.t);
        }
    }
    function zoomKick(now) {
        let kick = 0;
        state.beats.forEach(beat => { if (beat.frame) kick += beat.frame.zoom; });
        return kick;
    }
    // { x, y }: the whole screen's offset; bx, by: the background's own (a shake with target background, e.g. an ADV engine's
    // StoryBgUnit shake). The DOM UI follows the screen's only.
    function shakeOffset(now) {
        let x = 0, y = 0, bx = 0, by = 0;
        const H = app.screen.height;
        state.shakes = state.shakes.filter(function (item) {
            const s = stageShakeAt(item, H, item.seed, now - item.start);
            if (item.target === "background") { bx += s.x; by += s.y; } else { x += s.x; y += s.y; }
            return !s.done;
        });
        if (state.strike) { const k = stageViews.weather.lightning(now - state.strike.start); x += 2 * k * Math.sin(now / 9) * H / 720; }
        state.shake = { x, y };
        return { x, y, bx, by };
    }
    // The persistent screen look (screen.set): its resolved definition as a normalized look and its fades, for the look
    // renderer's screen layer (gal-looks.js); null when none.
    function screenLook(name, tables) {
        const key = name ? JSON.stringify([name, tables && tables.skin && tables.skin[name] || null, tables && tables.local && tables.local[name] || null]) : "";
        if (key !== state.screenKey) {
            state.screenKey = key;
            const spec = name && STAGE_EFFECT_LOOKS.includes(name) ? resolved(name, tables) : null;
            state.screenLook = spec ? { key, id: name, look: Object.assign(galLookNormalize(spec.params), { fade: spec.fade }), fade: spec.fade } : null;
        }
        return state.screenLook;
    }

    // ---- emotes
    const emotes=stageViews.emotes.create(env);
    const addEmote=emotes.add,tickEmotes=emotes.tick;

    return {
        trigger, zoomKick, shakeOffset,
        // dof: 0..1 eased depth-of-field strength of the backdrop. desc.safety: the stage's one safety policy
        // (stage-effects.cjs stageSafety); desc.effectTables: the effects tables; desc.screen: the screen look id.
        tick(desc, now, dt, dof) {
            const W = app.screen.width, H = app.screen.height, quality = env.quality(), high = quality !== "low";
            state.now = now;
            state.policy = desc.safety || stageSafety(null, false);
            const screen = screenLook(desc.screen, desc.effectTables);
            looks.tick(screen ? Object.assign({}, desc, { screenLook: screen }) : desc, now, W, H, quality);
            tickBackdrop(desc, now, dof, high);
            const strike = tickWeather(desc, now, dt, W, H, quality);
            tickBeats(now, W, H, strike);
            tickEmotes(now, W);
        },

        // How the DOM UI follows the scene this frame (galLookUi); grade: the figures' time grade matrix.
        ui(grade) { return looks.ui(grade, Object.assign({ now: state.now, shake: state.shake }, state.beatFrame)); },
        looks,
        stats() {
            return { light: looks.stats(), particles: state.stats.particles, weathers: state.weathers.map(system => system.kind + (system.target ? "" : "(out)")), motes: Object.keys(state.motes),
                beats: state.beats.map(beat => beat.name), shakes: state.shakes.length, emotes: emotes.stats().emotes,
                filters: [].concat(...Object.entries(state.slots).map(([chain, store]) => Object.values(store).map(slot => chain + ":" + slot.name + (slot.filter.enabled === false ? "(idle)" : "")))), emoteTextures: emotes.stats().textures };
        },
        destroy() {
            state.weathers.forEach(destroyWeather); state.weathers = [];
            Object.values(state.motes).forEach(destroyWeather); state.motes = {};
            looks.destroy();
            emotes.dispose();weather.dispose();
            Object.values(state.slots).forEach(store => Object.values(store).forEach(slot => { slot.chain.set(slot.name, null); slot.filter.destroy(); }));
            state.slots = {};
            textures.forEach(texture => texture.destroy(true));
        }
    };
}

// @include gal-looks.js
