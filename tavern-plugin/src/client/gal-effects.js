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

// ---------- Effect helpers (pure; tests/fork-gal-scene.test.mjs) ----------
const GAL_WEATHERS = ["rain", "storm", "snow", "sakura", "leaves", "sparkle"];
// Manpu: comic marks drawn over the figure (tear = a comic drop from the eye's corner). Body changes - blush, real
// tears - are the emotion's expression (stage-effects.md), never a mark. Names are canonical ids only: the submit tool
// is the one place a name is read tolerantly.
const GAL_EMOTES = ["!", "?", "...", "sweat", "anger", "heart", "note", "gloom", "sparkle", "tear"];

// Light presets are data now: stage looks (gal-looks.js, lib/vendor/runtime-assets/stage-looks/).
// Weather also darkens and cools the whole picture a little (rain, storm) or lifts it (snow).
function galWeatherMatrix(kind) {
    const M = galMatrix;
    if (kind === "rain") return M.chain(M.saturate(0.82), M.scale(0.9, 0.93, 0.98));
    if (kind === "storm") return M.chain(M.saturate(0.7), M.scale(0.74, 0.78, 0.88), M.contrast(1.05));
    if (kind === "snow") return M.chain(M.saturate(0.9), M.scale(0.98, 1.0, 1.03), M.offset(0.015, 0.02, 0.03));
    return M.identity();
}
// Two 0xRRGGBB colours blended per channel (t 0..1).
function galColorMix(a, b, t) {
    const ch = (c, s) => (c >> s) & 255;
    const one = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
    return (one(16) << 16) | (one(8) << 8) | one(0);
}

// Weather layers: sizes and speeds in stage heights (per second), wind in stage heights per second.
// texture: generated particle picture; orient: aligned with its motion (rain streaks); thick: extra width of a streak; sway: sideways
// sine drift; spin: turns per second (±); flutter: 3-D tumble (scale.x); twinkle: alpha breathing.
const GAL_WEATHER = {
    rain: [
        { layer: "back", texture: "streak", count: 150, size: [0.04, 0.064], speed: [1.0, 1.35], wind: 0.1, alpha: [0.2, 0.36], orient: true, thick: 2.2 },
        { layer: "front", texture: "streak", count: 64, size: [0.1, 0.16], speed: [1.9, 2.5], wind: 0.18, alpha: [0.24, 0.42], orient: true, thick: 1.8 }],
    storm: [
        { layer: "back", texture: "streak", count: 250, size: [0.04, 0.062], speed: [1.35, 1.75], wind: 0.34, alpha: [0.2, 0.36], orient: true, thick: 2 },
        { layer: "front", texture: "streak", count: 110, size: [0.11, 0.17], speed: [2.4, 3.1], wind: 0.55, alpha: [0.24, 0.44], orient: true, thick: 1.7 }],
    snow: [
        { layer: "back", texture: "flake", count: 130, size: [0.004, 0.009], speed: [0.03, 0.07], wind: 0.012, sway: [0.008, 0.022], swayHz: [0.12, 0.3], alpha: [0.5, 0.85] },
        { layer: "front", texture: "flake", count: 36, size: [0.014, 0.026], speed: [0.08, 0.14], wind: 0.02, sway: [0.02, 0.04], swayHz: [0.1, 0.22], alpha: [0.6, 0.9] }],
    sakura: [
        { layer: "back", texture: "petal", count: 40, size: [0.011, 0.017], speed: [0.06, 0.1], wind: 0.06, sway: [0.01, 0.025], swayHz: [0.2, 0.4], spin: [0.2, 0.7], flutter: [0.5, 1.2], alpha: [0.75, 0.95], tints: [0xffffff, 0xfff2f6, 0xffe6ee] },
        { layer: "front", texture: "petal", count: 16, size: [0.024, 0.036], speed: [0.1, 0.16], wind: 0.09, sway: [0.02, 0.04], swayHz: [0.15, 0.3], spin: [0.2, 0.6], flutter: [0.4, 1.0], alpha: [0.85, 1], tints: [0xffffff, 0xfff2f6] }],
    leaves: [
        { layer: "back", texture: "leaf", count: 22, size: [0.015, 0.024], speed: [0.07, 0.12], wind: 0.07, sway: [0.015, 0.03], swayHz: [0.15, 0.3], spin: [0.2, 0.6], flutter: [0.3, 0.8], alpha: [0.8, 0.95], tints: [0xe0892f, 0xc4452a, 0xe8b24a, 0xa8642a] },
        { layer: "front", texture: "leaf", count: 9, size: [0.032, 0.046], speed: [0.12, 0.18], wind: 0.1, sway: [0.03, 0.05], swayHz: [0.12, 0.25], spin: [0.2, 0.5], flutter: [0.3, 0.7], alpha: [0.9, 1], tints: [0xe0892f, 0xc4452a, 0xe8b24a] }],
    sparkle: [
        { layer: "back", texture: "star", count: 26, size: [0.012, 0.022], speed: [-0.025, -0.006], wind: 0, drift: 0.006, twinkle: [0.5, 1.3], spin: [0.05, 0.2], alpha: [0.55, 1], tint: 0xfff6dc, blend: "add" },
        { layer: "front", texture: "star", count: 10, size: [0.024, 0.036], speed: [-0.03, -0.01], wind: 0, drift: 0.008, twinkle: [0.4, 1.0], spin: [0.05, 0.15], alpha: [0.6, 1], tint: 0xfff6dc, blend: "add" }],
    // Light motes of a look (motes: { kind: "bokeh" }, the dream look), not a weather.
    motes: [
        { layer: "back", texture: "mote", count: 14, size: [0.014, 0.03], speed: [-0.03, -0.012], wind: 0.004, drift: 0.01, sway: [0.01, 0.02], swayHz: [0.06, 0.14], twinkle: [0.15, 0.4], alpha: [0.25, 0.55], tints: [0xffe0f4, 0xf2e2ff, 0xfff4fb], blend: "add" },
        { layer: "front", texture: "mote", count: 8, size: [0.03, 0.055], speed: [-0.035, -0.015], wind: 0.004, drift: 0.01, sway: [0.015, 0.03], swayHz: [0.05, 0.1], twinkle: [0.1, 0.3], alpha: [0.18, 0.36], tints: [0xffe0f4, 0xf2e2ff], blend: "add" }]
};
// Layers of a weather at a quality: low keeps about a third of the particles.
function galWeatherLayers(kind, quality) {
    const layers = GAL_WEATHER[kind] || [];
    return layers.map(spec => Object.assign({}, spec, { count: quality === "low" ? Math.max(3, Math.round(spec.count / 3)) : spec.count }));
}
function galPick(range, rand) { return Array.isArray(range) ? range[0] + (range[1] - range[0]) * rand() : (range || 0); }
// (Re)spawns a particle. Coordinates in stage heights (x runs 0..aspect). fresh: anywhere on screen
// (a weather that starts already falls everywhere); otherwise just outside the edge it enters from.
function galParticleSeed(p, spec, rand, fresh, aspect) {
    p.size = galPick(spec.size, rand); p.speed = galPick(spec.speed, rand);
    p.wind = (spec.wind || 0) * (0.75 + 0.5 * rand()); p.drift = spec.drift ? (rand() * 2 - 1) * spec.drift : 0;
    p.alpha = galPick(spec.alpha, rand); p.phase = rand() * Math.PI * 2;
    p.sway = galPick(spec.sway, rand); p.swayHz = galPick(spec.swayHz, rand);
    p.spin = galPick(spec.spin, rand) * Math.PI * 2 * (rand() < 0.5 ? -1 : 1); p.rot = rand() * Math.PI * 2;
    p.flutterHz = galPick(spec.flutter, rand); p.twinkleHz = galPick(spec.twinkle, rand);
    p.tint = spec.tints ? spec.tints[Math.floor(rand() * spec.tints.length) % spec.tints.length] : spec.tint != null ? spec.tint : 0xffffff;
    const upwind = p.speed > 0.2 ? (p.wind + p.drift) / p.speed * 1.2 : 0;
    if (fresh) { p.x = -0.1 * aspect + rand() * 1.2 * aspect; p.y = -0.1 + rand() * 1.2; }
    else if (p.speed > 0.002) { p.y = -0.06 - p.size - rand() * 0.08; p.x = -0.1 * aspect - upwind + rand() * (1.2 * aspect + upwind); }
    else if (p.speed < -0.002) { p.y = 1.06 + p.size + rand() * 0.08; p.x = -0.1 * aspect + rand() * 1.2 * aspect; }
    else { p.x = -0.1 * aspect + rand() * 1.2 * aspect; p.y = -0.1 + rand() * 1.2; }
    return p;
}
function galParticleStep(p, spec, dt, rand, aspect) {
    p.y += p.speed * dt; p.x += (p.wind + p.drift) * dt; p.rot += p.spin * dt;
    if ((p.speed > 0.002 && p.y > 1.1 + p.size) || (p.speed < -0.002 && p.y < -0.1 - p.size)) galParticleSeed(p, spec, rand, false, aspect);
    else if (Math.abs(p.speed) <= 0.002) { if (p.y > 1.12) p.y -= 1.24; else if (p.y < -0.12) p.y += 1.24; }
    if (p.x > 1.14 * aspect) p.x -= 1.28 * aspect; else if (p.x < -0.14 * aspect) p.x += 1.28 * aspect;
    return p;
}
// What a particle looks like at time t (seconds): position (stage heights), rotation, scale factors, alpha.
function galParticleView(p, spec, t) {
    const view = { x: p.x, y: p.y, rotation: p.rot, sx: 1, sy: 1, alpha: p.alpha };
    if (p.sway) view.x += p.sway * Math.sin(2 * Math.PI * p.swayHz * t + p.phase);
    if (spec.orient) view.rotation = -Math.atan2(p.wind + p.drift, p.speed);
    else if (p.sway) view.rotation = p.rot + 0.35 * Math.cos(2 * Math.PI * p.swayHz * t + p.phase);
    if (p.flutterHz) view.sx = 0.22 + 0.78 * Math.abs(Math.cos(2 * Math.PI * p.flutterHz * t + p.phase));
    if (p.twinkleHz) {
        const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * p.twinkleHz * t + p.phase);
        view.alpha = p.alpha * (0.3 + 0.7 * k);
        if (spec.texture === "star") { view.sx = view.sy = 0.55 + 0.45 * k; }
    }
    return view;
}
// Lightning (storm): a bright strike, a dark gap, a second flicker and a slow fade; ~0.9 s.
function galLightningAt(ms) {
    if (ms < 0 || ms >= 900) return 0;
    if (ms < 50) return 0.9 * ms / 50;
    if (ms < 110) return 0.9 - 0.75 * (ms - 50) / 60;
    if (ms < 150) return 0.15 + 0.6 * (ms - 110) / 40;
    return 0.75 * Math.pow(1 - (ms - 150) / 750, 2.2);
}

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

// Emotes: parts of each (relative offsets and sizes in emote units, staggered delays).
function galEmoteParts(kind) {
    if (kind === "...") return [{ art: "dot", x: -0.34, y: 0, size: 0.34, delay: 0 }, { art: "dot", x: 0, y: 0, size: 0.34, delay: 150 }, { art: "dot", x: 0.34, y: 0, size: 0.34, delay: 300 }];
    if (kind === "sparkle") return [{ art: "star", x: 0, y: 0, size: 1, delay: 0 }, { art: "star", x: 0.62, y: -0.42, size: 0.55, delay: 110 }, { art: "star", x: -0.5, y: 0.36, size: 0.42, delay: 220 }];
    if (kind === "note") return [{ art: "note", x: 0, y: 0, size: 1, delay: 0 }, { art: "note", x: 0.62, y: -0.38, size: 0.66, delay: 200 }];
    // The comic tear: a drop from the eye's corner, a smaller one after it.
    if (kind === "tear") return [{ art: "tear", x: 0, y: 0, size: 1, delay: 0 }, { art: "tear", x: 0.12, y: -0.08, size: 0.68, delay: 520 }];
    const art = { "!": "bang", "?": "question", sweat: "drop", anger: "vein", heart: "heart", gloom: "gloom" }[kind];
    return art ? [{ art, x: 0, y: 0, size: 1, delay: 0 }] : [];
}
// Where an emote sits for a head { x, top, chin, width } (pixels): { x, y, size, spread }; spread is the
// part offset unit.
function galEmoteAnchor(kind, head, W) {
    const hh = Math.max(1, head.chin - head.top), side = head.x > W * 0.78 ? -1 : 1;
    const at = (dx, dy, size) => ({ x: head.x + side * head.width * dx, y: head.top + hh * dy, size: hh * size, spread: hh * size, side });
    if (kind === "anger") return at(0.46, 0.14, 0.46);
    if (kind === "sweat") return at(0.52, 0.32, 0.4);
    // The tear starts at the outer corner of the eye on the open side and runs down the cheek.
    if (kind === "tear") return at(0.3, 0.5, 0.3);
    if (kind === "gloom") return Object.assign(at(0, 0.02, 0.78), { x: head.x });
    if (kind === "...") return at(0.5, -0.16, 0.62);
    return at(0.62, -0.04, 0.6);
}
// An emote part at ms (after its delay): scale, alpha, dy (emote units, + is down), rotation.
const GAL_EMOTE_MS = 1800;
function galEmoteAt(kind, ms) {
    const frame = { scale: 0, alpha: 0, dy: 0, rotation: 0, done: ms >= GAL_EMOTE_MS };
    if (ms < 0 || frame.done) return frame;
    const t = ms / 1000, E = galEase;
    // Springy pop: overshoots to ~1.2, settles by ~0.45 s.
    frame.scale = 1 - Math.exp(-t * 9) * Math.cos(t * 17);
    frame.alpha = ms < 1400 ? Math.min(1, t / 0.06) : 1 - E.inOutSine((ms - 1400) / 400);
    frame.dy = -0.22 * E.outCubic(Math.min(1, t / 1.8));
    if (kind === "sweat") { frame.scale = Math.min(1, frame.scale); frame.dy = 0.4 * E.inQuad(Math.min(1, t / 1.8)); }
    else if (kind === "tear") { frame.scale = Math.min(1, frame.scale); frame.dy = 1.1 * E.inQuad(Math.min(1, t / 1.3)); }
    else if (kind === "gloom") { frame.scale = 1; frame.alpha *= Math.min(1, t / 0.35); frame.dy = 0.12 * E.outCubic(Math.min(1, t / 1.8)); }
    else if (kind === "heart") { if (t > 0.45) frame.scale *= 1 + 0.09 * Math.max(0, Math.sin(2 * Math.PI * 2.2 * (t - 0.45))); }
    else if (kind === "anger") { if (t > 0.4) frame.scale *= 1 + 0.1 * Math.max(0, Math.sin(2 * Math.PI * 3 * (t - 0.4))); }
    else if (kind === "note") { frame.rotation = 0.2 * Math.sin(2 * Math.PI * 1.4 * t); frame.dy = -0.42 * Math.min(1, t / 1.8); }
    else if (kind === "sparkle") { frame.scale *= 0.82 + 0.18 * Math.sin(2 * Math.PI * 3 * t); frame.rotation = 0.3 * t; }
    else if (kind === "!") frame.rotation = 0.14 * Math.exp(-t * 7) * Math.sin(t * 42);
    else if (kind === "?") frame.rotation = -0.1 + 0.08 * Math.sin(2 * Math.PI * 0.8 * t);
    return frame;
}
function galEmotePlacement(kind, head, anchor, part, frame) {
    // Marks on the face (anger, sweat, tear) turn with the head.
    const attached = kind === "anger" || kind === "sweat" || kind === "tear";
    const rotation = attached ? head.rotation || 0 : 0, c = Math.cos(rotation), s = Math.sin(rotation);
    const cx = head.x, cy = (head.top + head.chin) / 2;
    const x = anchor.x + part.x * anchor.spread * anchor.side - cx;
    const y = anchor.y + part.y * anchor.spread + frame.dy * anchor.size - cy;
    return { x: cx + x * c - y * s, y: cy + x * s + y * c, rotation: rotation + frame.rotation * anchor.side };
}
// Canonical hue an emote leans towards when tinted with the character colour (sweat and tear stay watery,
// anger red); null: the character colour itself.
const GAL_EMOTE_HUES = { sweat: [0x6fb8ff, 0.7], tear: [0x7cc8ff, 0.82], anger: [0xff3048, 0.72], heart: [0xff5a8c, 0.45], gloom: [0x3c2c58, 0.7] };
function galEmoteColor(kind, color) {
    const hue = GAL_EMOTE_HUES[kind];
    const base = typeof color === "number" && isFinite(color) ? color : 0xf06aa0;
    return hue ? galColorMix(base, hue[0], hue[1]) : base;
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
// Any CSS colour → 0xRRGGBB (the browser parses it).
function galCssColor(value, fallback) {
    if (typeof value === "number") return value;
    try {
        const ctx = galCssColor.ctx || (galCssColor.ctx = document.createElement("canvas").getContext("2d"));
        ctx.fillStyle = "#000"; ctx.fillStyle = String(value || "");
        const text = ctx.fillStyle;
        if (/^#[0-9a-f]{6}$/i.test(text)) return parseInt(text.slice(1), 16);
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(text);
        if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
    } catch (_) {}
    return fallback == null ? 0xf06aa0 : fallback;
}
function galHex(color) { return "#" + (color & 0xffffff).toString(16).padStart(6, "0"); }

// Particle pictures, drawn once per weather (white or natural colours; tint varies them).
function galParticleArt(ctx, kind, w, h) {
    if (kind === "streak") {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, "rgba(220,232,255,0)"); g.addColorStop(0.7, "rgba(230,240,255,.75)"); g.addColorStop(1, "rgba(255,255,255,.95)");
        ctx.fillStyle = g; ctx.fillRect(w / 2 - 1.5, 0, 3, h);
        ctx.globalAlpha = 0.35; ctx.fillRect(w / 2 - 3, h * 0.35, 6, h * 0.65);
    } else if (kind === "flake" || kind === "mote") {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        if (kind === "mote") { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,.85)"); g.addColorStop(0.45, "rgba(255,255,255,.28)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,.9)"); g.addColorStop(0.75, "rgba(255,255,255,.35)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (kind === "petal") {
        ctx.translate(w / 2, h / 2);
        const g = ctx.createLinearGradient(0, -h * 0.42, 0, h * 0.42);
        g.addColorStop(0, "#ffd9e4"); g.addColorStop(0.6, "#ffc0d3"); g.addColorStop(1, "#f29ab8");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.42);
        ctx.bezierCurveTo(-w * 0.44, h * 0.12, -w * 0.36, -h * 0.34, -w * 0.08, -h * 0.4);
        ctx.lineTo(0, -h * 0.3);
        ctx.lineTo(w * 0.08, -h * 0.4);
        ctx.bezierCurveTo(w * 0.36, -h * 0.34, w * 0.44, h * 0.12, 0, h * 0.42);
        ctx.fill();
        ctx.strokeStyle = "rgba(230,120,160,.35)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, h * 0.38); ctx.lineTo(0, -h * 0.1); ctx.stroke();
    } else if (kind === "leaf") {
        ctx.translate(w / 2, h / 2); ctx.rotate(-0.5);
        const g = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
        g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#c9c9c9");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.44);
        ctx.bezierCurveTo(w * 0.34, -h * 0.2, w * 0.3, h * 0.24, 0, h * 0.4);
        ctx.bezierCurveTo(-w * 0.3, h * 0.24, -w * 0.34, -h * 0.2, 0, -h * 0.44); ctx.fill();
        ctx.strokeStyle = "rgba(90,50,20,.45)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, -h * 0.4); ctx.lineTo(0, h * 0.46); ctx.stroke();
        ctx.lineWidth = 0.9;
        [-0.2, 0, 0.2].forEach(y => { ctx.beginPath(); ctx.moveTo(0, h * y); ctx.lineTo(w * 0.18, h * (y - 0.12)); ctx.moveTo(0, h * y); ctx.lineTo(-w * 0.18, h * (y - 0.12)); ctx.stroke(); });
    } else if (kind === "star") {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.2, "rgba(255,255,255,.25)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.translate(w / 2, h / 2); ctx.fillStyle = "#fff";
        [[w * 0.48, w * 0.05], [w * 0.05, w * 0.48]].forEach(function ([rx, ry]) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); });
        ctx.rotate(Math.PI / 4); ctx.globalAlpha = 0.6;
        [[w * 0.22, w * 0.03], [w * 0.03, w * 0.22]].forEach(function ([rx, ry]) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); });
    }
}
const GAL_PARTICLE_SIZE = { streak: [8, 160], flake: [48, 48], mote: [64, 64], petal: [48, 48], leaf: [56, 56], star: [64, 64] };

// Emote art: sticker style (soft shadow, thick white outline, colour fill, highlight) on a square canvas
// of side S. color: 0xRRGGBB.
function galEmoteArt(ctx, art, color, S) {
    const fill = galHex(color);
    const deep = galHex(galColorMix(color, 0x000000, 0.35));
    const outline = S * 0.075;
    const sticker = function (path, options) {
        options = options || {};
        ctx.save();
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.shadowColor = "rgba(20,10,30,.35)"; ctx.shadowBlur = S * 0.05; ctx.shadowOffsetY = S * 0.02;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = outline * 2 + (options.stroke || 0);
        path(); ctx.stroke();
        ctx.shadowColor = "transparent";
        if (options.stroke) { ctx.strokeStyle = fill; ctx.lineWidth = options.stroke; path(); ctx.stroke(); }
        else {
            const g = ctx.createLinearGradient(0, S * 0.1, 0, S * 0.9);
            g.addColorStop(0, galHex(galColorMix(color, 0xffffff, 0.22))); g.addColorStop(1, deep);
            ctx.fillStyle = g; path(); ctx.fill();
        }
        ctx.restore();
    };
    if (art === "bang" || art === "question") {
        ctx.save();
        ctx.translate(S / 2, S / 2); ctx.rotate(art === "bang" ? -0.12 : 0.08); ctx.translate(-S / 2, -S / 2);
        ctx.font = "900 " + Math.round(S * 0.8) + "px \"Segoe UI Black\", \"Arial Black\", \"Microsoft YaHei\", sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const glyph = art === "bang" ? "!" : "?";
        ctx.lineJoin = "round";
        ctx.shadowColor = "rgba(20,10,30,.35)"; ctx.shadowBlur = S * 0.05; ctx.shadowOffsetY = S * 0.02;
        ctx.strokeStyle = "#fff"; ctx.lineWidth = outline * 2.2; ctx.strokeText(glyph, S / 2, S * 0.54);
        ctx.shadowColor = "transparent";
        const g = ctx.createLinearGradient(0, S * 0.15, 0, S * 0.9);
        g.addColorStop(0, galHex(galColorMix(color, 0xffffff, 0.2))); g.addColorStop(1, deep);
        ctx.fillStyle = g; ctx.fillText(glyph, S / 2, S * 0.54);
        ctx.restore();
    } else if (art === "dot") {
        sticker(() => { ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.26, 0, Math.PI * 2); });
    } else if (art === "drop") {
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.12);
            ctx.bezierCurveTo(S * 0.56, S * 0.3, S * 0.76, S * 0.46, S * 0.76, S * 0.64);
            ctx.arc(S * 0.5, S * 0.64, S * 0.26, 0, Math.PI, false);
            ctx.bezierCurveTo(S * 0.24, S * 0.46, S * 0.44, S * 0.3, S * 0.5, S * 0.12);
            ctx.closePath();
        });
        ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.beginPath(); ctx.ellipse(S * 0.4, S * 0.62, S * 0.05, S * 0.1, -0.4, 0, Math.PI * 2); ctx.fill();
    } else if (art === "vein") {
        sticker(function () {
            ctx.beginPath();
            for (let q = 0; q < 4; q++) {
                const a = q * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
                const p = (x, y) => [S / 2 + (x * c - y * s) * S, S / 2 + (x * s + y * c) * S];
                const [x0, y0] = p(-0.38, -0.1), [cx, cy] = p(-0.1, -0.1), [x1, y1] = p(-0.1, -0.38);
                ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1);
            }
        }, { stroke: S * 0.11 });
    } else if (art === "heart") {
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.84);
            ctx.bezierCurveTo(S * 0.12, S * 0.6, S * 0.08, S * 0.34, S * 0.22, S * 0.24);
            ctx.bezierCurveTo(S * 0.36, S * 0.14, S * 0.48, S * 0.22, S * 0.5, S * 0.34);
            ctx.bezierCurveTo(S * 0.52, S * 0.22, S * 0.64, S * 0.14, S * 0.78, S * 0.24);
            ctx.bezierCurveTo(S * 0.92, S * 0.34, S * 0.88, S * 0.6, S * 0.5, S * 0.84);
            ctx.closePath();
        });
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.ellipse(S * 0.3, S * 0.34, S * 0.06, S * 0.035, -0.6, 0, Math.PI * 2); ctx.fill();
    } else if (art === "note") {
        sticker(function () {
            ctx.beginPath();
            ctx.ellipse(S * 0.38, S * 0.72, S * 0.16, S * 0.115, -0.45, 0, Math.PI * 2);
            ctx.moveTo(S * 0.5, S * 0.7); ctx.lineTo(S * 0.52, S * 0.14);
            ctx.lineTo(S * 0.56, S * 0.14);
            ctx.bezierCurveTo(S * 0.6, S * 0.26, S * 0.82, S * 0.28, S * 0.74, S * 0.5);
            ctx.bezierCurveTo(S * 0.72, S * 0.36, S * 0.62, S * 0.32, S * 0.56, S * 0.3);
            ctx.lineTo(S * 0.55, S * 0.7); ctx.closePath();
        });
    } else if (art === "gloom") {
        ctx.save(); ctx.lineCap = "round";
        const lines = [[0.2, 0.52], [0.34, 0.74], [0.5, 0.86], [0.66, 0.72], [0.8, 0.5]];
        [["rgba(255,255,255,.55)", S * 0.075], [fill, S * 0.035]].forEach(function ([style, width]) {
            ctx.strokeStyle = style; ctx.lineWidth = width;
            lines.forEach(function ([x, len]) {
                ctx.beginPath(); ctx.moveTo(S * x, S * 0.08);
                for (let y = 0.08; y <= len; y += 0.04) ctx.lineTo(S * (x + 0.018 * Math.sin(y * 28)), S * y);
                ctx.stroke();
            });
        });
        ctx.restore();
    } else if (art === "star") {
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.06);
            ctx.quadraticCurveTo(S * 0.56, S * 0.44, S * 0.94, S * 0.5);
            ctx.quadraticCurveTo(S * 0.56, S * 0.56, S * 0.5, S * 0.94);
            ctx.quadraticCurveTo(S * 0.44, S * 0.56, S * 0.06, S * 0.5);
            ctx.quadraticCurveTo(S * 0.44, S * 0.44, S * 0.5, S * 0.06);
            ctx.closePath();
        });
    } else if (art === "tear") {
        // A slim comic drop (narrower and longer than sweat) with a bright glint.
        sticker(function () {
            ctx.beginPath(); ctx.moveTo(S * 0.5, S * 0.08);
            ctx.bezierCurveTo(S * 0.54, S * 0.3, S * 0.68, S * 0.5, S * 0.68, S * 0.68);
            ctx.arc(S * 0.5, S * 0.68, S * 0.18, 0, Math.PI, false);
            ctx.bezierCurveTo(S * 0.32, S * 0.5, S * 0.46, S * 0.3, S * 0.5, S * 0.08);
            ctx.closePath();
        });
        ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.ellipse(S * 0.44, S * 0.66, S * 0.035, S * 0.075, -0.35, 0, Math.PI * 2); ctx.fill();
    }
}
// The whole emote composed on one canvas (face window, DOM): data URL, cached per kind and colour.
const galEmoteUrls = new Map();
function galEmoteDataUrl(kind, color) {
    const key = kind + ":" + color;
    if (galEmoteUrls.has(key)) return galEmoteUrls.get(key);
    // 512 px: crisp in the face window at 4K (stage-effects.md §6).
    const S = 512, canvas = document.createElement("canvas");
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext("2d");
    const tint = galEmoteColor(kind, color);
    galEmoteParts(kind).forEach(function (part) {
        const size = S * 0.62 * part.size;
        const sub = document.createElement("canvas");
        sub.width = sub.height = Math.round(size);
        galEmoteArt(sub.getContext("2d"), part.art, tint, sub.width);
        const spread = S * 0.62;
        ctx.drawImage(sub, S / 2 + part.x * spread - size / 2, S / 2 + part.y * spread - size / 2, size, size);
    });
    const url = canvas.toDataURL("image/png");
    if (galEmoteUrls.size > 40) galEmoteUrls.clear();
    galEmoteUrls.set(key, url);
    return url;
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
        beats: [], shakes: [], emotes: [], slots: {}, emoteTextures: new Map(), stats: { particles: 0 }, policy: stageSafety(null, false), tables: null, screenKey: "", screenLook: null
    };

    // Filters used by effects are created on first use, disabled when idle and destroyed after 3 s idle.
    function use(chainName, name, make, active, now) {
        const store = state.slots[chainName] || (state.slots[chainName] = {});
        return galUseFilter(store, filters[chainName], name, () => PIXI.filters.KawaseBlurFilter ? make() : null, active, now, env.tune);
    }
    const lowRes = filter => { filter.forkLowRes = true; return filter; };
    // ---- stage looks (world passes and overlays; gal-looks.js)
    const looks = galCreateLookRenderer({ PIXI, app, filters, overlay: lookLayer, tune: env.tune, use });

    // ---- depth of field and the look's background softness: one blur on the backdrop.
    function tickBackdrop(desc, now, dof, high) {
        const plan = looks.plan();
        const strength = high ? Math.max(4 * dof, plan ? plan.backBlur : 0) : 0;
        const blur = use("backdrop", "blur", () => lowRes(new PIXI.filters.KawaseBlurFilter(0, 4, true)), strength > 0.05, now);
        if (blur) blur.blur = strength;
    }

    // ---- weather particles (and the dream light motes).
    function particleTexture(kind) {
        const [w, h] = GAL_PARTICLE_SIZE[kind];
        return galCanvasTexture(PIXI, w, h, (ctx, cw, ch) => galParticleArt(ctx, kind, cw, ch));
    }
    function createWeather(kind, quality) {
        const specs = galWeatherLayers(kind, quality);
        if (!specs.length) return null;
        const aspect = app.screen.width / Math.max(1, app.screen.height);
        const system = { kind, key: kind + ":" + quality, alpha: 0, target: 1, layers: [], textures: {} };
        specs.forEach(function (spec) {
            const texture = system.textures[spec.texture] || (system.textures[spec.texture] = particleTexture(spec.texture));
            const box = new PIXI.ParticleContainer(spec.count, { vertices: true, position: true, rotation: true, tint: true, uvs: false });
            box.blendMode = spec.blend === "add" ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
            box.alpha = 0;
            (spec.layer === "front" ? env.frontFx : env.backFx).addChild(box);
            const items = [];
            for (let i = 0; i < spec.count; i++) {
                const item = new PIXI.Sprite(texture);
                item.anchor.set(0.5);
                const p = galParticleSeed({ sprite: item }, spec, rand, true, aspect);
                item.tint = p.tint;
                box.addChild(item); items.push(p);
            }
            system.layers.push({ spec, box, items, texture });
        });
        return system;
    }
    function destroyWeather(system) {
        system.layers.forEach(layer => layer.box.destroy({ children: true }));
        Object.values(system.textures).forEach(texture => texture.destroy(true));
    }
    function stepWeather(system, now, dt, W, H) {
        system.alpha += (system.target - system.alpha) * (1 - Math.exp(-dt * (system.target ? 1.8 : 2.6)));
        if (system.target && Math.abs(system.target - system.alpha) < 0.005) system.alpha = system.target;
        const aspect = W / Math.max(1, H), t = now / 1000;
        system.layers.forEach(function (layer) {
            layer.box.alpha = system.alpha;
            const texH = layer.texture.height || 1, texW = layer.texture.width || 1;
            layer.items.forEach(function (p) {
                galParticleStep(p, layer.spec, dt, rand, aspect);
                const view = galParticleView(p, layer.spec, t);
                const s = p.size * H / (layer.spec.texture === "streak" ? texH : Math.max(texW, texH));
                p.sprite.position.set(view.x * H, view.y * H);
                p.sprite.rotation = view.rotation;
                p.sprite.scale.set(s * view.sx * (layer.spec.thick || 1), s * view.sy);
                p.sprite.alpha = view.alpha;
            });
            state.stats.particles += layer.items.length;
        });
    }
    function tickWeather(desc, now, dt, W, H, quality) {
        const kind = GAL_WEATHERS.includes(desc.weather) ? desc.weather : "";
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
            if (state.strike) { flashAlpha = galLightningAt(now - state.strike.start) * state.strike.strength; if (now - state.strike.start > 900) state.strike = null; }
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
        if (state.strike) { const k = galLightningAt(now - state.strike.start); x += 2 * k * Math.sin(now / 9) * H / 720; }
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
    function emoteTexture(art, color) {
        const key = art + ":" + color;
        let texture = state.emoteTextures.get(key);
        if (!texture) {
            // 512 px: a manpu stays crisp at 4K (stage-effects.md §6).
            texture = galCanvasTexture(PIXI, 512, 512, (ctx, w) => galEmoteArt(ctx, art, color, w));
            state.emoteTextures.set(key, texture);
        }
        return texture;
    }
    function addEmote(effect, now) {
        const kind = GAL_EMOTES.includes(effect.value) ? effect.value : "";
        if (!kind || !effect.id) return false;
        const head = env.headOf(effect.id);
        if (!head) return false;
        const color = galEmoteColor(kind, galCssColor(effect.color));
        const box = new PIXI.Container();
        const parts = galEmoteParts(kind).map(function (part) {
            const item = new PIXI.Sprite(emoteTexture(part.art, color));
            item.anchor.set(0.5); item.alpha = 0;
            box.addChild(item);
            return Object.assign({ sprite: item }, part);
        });
        // A second emote on the same figure replaces the first.
        state.emotes.filter(item => item.id === effect.id).forEach(item => { item.fadeFrom = now; });
        env.emotes.addChild(box);
        state.emotes.push({ id: effect.id, kind, start: now, box, parts, fadeFrom: null });
        return true;
    }
    function tickEmotes(now, W) {
        state.emotes = state.emotes.filter(function (emote) {
            const head = env.headOf(emote.id);
            if (head) emote.head = head;
            if (!head && emote.fadeFrom == null) emote.fadeFrom = now;
            const fade = emote.fadeFrom != null ? 1 - galClamp01((now - emote.fadeFrom) / 180) : 1;
            if (!emote.head || fade <= 0) { emote.box.destroy({ children: true }); return false; }
            const anchor = galEmoteAnchor(emote.kind, emote.head, W);
            let done = true;
            emote.parts.forEach(function (part) {
                const f = galEmoteAt(emote.kind, now - emote.start - part.delay);
                if (!f.done) done = false;
                const size = anchor.size * part.size;
                const texture = part.sprite.texture;
                const placement = galEmotePlacement(emote.kind, emote.head, anchor, part, f);
                part.sprite.position.set(placement.x, placement.y);
                part.sprite.scale.set(size / texture.width * f.scale * (emote.kind === "note" && anchor.side < 0 ? -1 : 1), size / texture.height * f.scale);
                part.sprite.rotation = placement.rotation;
                part.sprite.alpha = f.alpha * fade;
            });
            if (done) { emote.box.destroy({ children: true }); return false; }
            return true;
        });
    }

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
                beats: state.beats.map(beat => beat.name), shakes: state.shakes.length, emotes: state.emotes.map(emote => emote.id + ":" + emote.kind),
                filters: [].concat(...Object.entries(state.slots).map(([chain, store]) => Object.values(store).map(slot => chain + ":" + slot.name + (slot.filter.enabled === false ? "(idle)" : "")))), emoteTextures: state.emoteTextures.size };
        },
        destroy() {
            state.weathers.forEach(destroyWeather); state.weathers = [];
            Object.values(state.motes).forEach(destroyWeather); state.motes = {};
            looks.destroy();
            state.emotes.forEach(emote => emote.box.destroy({ children: true })); state.emotes = [];
            Object.values(state.slots).forEach(store => Object.values(store).forEach(slot => { slot.chain.set(slot.name, null); slot.filter.destroy(); }));
            state.slots = {};
            state.emoteTextures.forEach(texture => texture.destroy(true)); state.emoteTextures.clear();
            textures.forEach(texture => texture.destroy(true));
        }
    };
}

// @include gal-looks.js
