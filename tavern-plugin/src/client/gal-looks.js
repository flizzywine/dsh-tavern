// data-driven stage looks. A look is a set of post-processing
// params (cinema grade, LUT, vignette, grain, bloom, lens, stylize, leaks, flares, dirt);
// ordinary bound packs supply looks, and the director selects explicit pack references. This file turns params into the world filter chain and the screen overlays
// of the stage scene (gal-scene.js / gal-effects.js), eases between looks, and computes how the
// DOM UI (text box, face window, choices, backlog) follows the scene at partial strength.
//
// World filter chain (only the passes a look needs; low quality skips the heavy ones):
//   grade   one custom shader: linear colour (exposure, white balance, mixer, saturation, gain, contrast,
//           lift and the weather tint, folded into one affine matrix) → gamma → split toning → keep-hue →
//           LUT (two slots, crossfading) → invert → posterize
//   bloom   AdvancedBloomFilter
//   screen  one custom shader: lens distortion (+ wobble) → pixelate → chromatic aberration → halftone →
//           scanlines → lens dirt (lit by the blurred scene brightness)
//   film    OldFilmFilter: grain and scratches
// Overlay (screen space, above world): vignette (tinted, softness, pulse), haze (bright edges), light
// leaks (up to two, crossfading), lens flare.

// ---------- Look helpers (pure; tests/fork-gal-looks.test.mjs) ----------
// @include-protocol stage-light.cjs
const GAL_LOOK_ID = /^[a-z][a-z0-9-]{0,31}$/;
const GAL_LOOK_MS = 800;
const GAL_LEAK_FROM = ["left", "right", "top", "corner"];
const GAL_MOTE_KINDS = ["bokeh", "sparkle"];
const GAL_LUMA = [0.2126, 0.7152, 0.0722];

function galLookNumber(value, fallback, min, max) {
    const n = typeof value === "number" && isFinite(value) ? value : fallback;
    return Math.max(min, Math.min(max, n));
}
// "#rgb" / "#rrggbb" / [r, g, b] (0..1) → [r, g, b] in 0..1.
function galLookRgb(value, fallback) {
    if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(v => typeof v === "number" && isFinite(v))) return value.slice(0, 3).map(v => Math.max(0, Math.min(1, v)));
    const text = typeof value === "string" ? value.trim() : "";
    let m = /^#?([0-9a-f]{6})$/i.exec(text);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
    m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
    if (m) return [1, 2, 3].map(i => parseInt(m[i] + m[i], 16) / 255);
    return fallback.slice();
}
function galLookHex(rgb) { return rgb.reduce((n, v) => (n << 8) | Math.round(Math.max(0, Math.min(1, v)) * 255), 0); }
// A number (all channels) or [r, g, b].
function galLookVec(value, fallback, min, max) {
    if (typeof value === "number" && isFinite(value)) return [0, 1, 2].map(() => Math.max(min, Math.min(max, value)));
    if (Array.isArray(value) && value.length >= 3) return [0, 1, 2].map(i => galLookNumber(value[i], fallback[i], min, max));
    return fallback.slice();
}
// Channel mixer: rows = output channels, [[rr, rg, rb], [gr, gg, gb], [br, bg, bb]] → 9 numbers.
function galLookMixer(value) {
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (!Array.isArray(value) || value.length < 3) return id;
    const out = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(Array.isArray(value[r]) ? galLookNumber(value[r][c], id[r * 3 + c], -2, 2) : id[r * 3 + c]);
    return out;
}
const galLookObject = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

// params (index.json, already structure-cleaned by the host) → a full, interpolation-ready look with every
// field present (neutral when omitted). Textures and LUTs become weighted lists so looks can crossfade.
function galLookNormalize(params) {
    const p = galLookObject(params), num = galLookNumber, rgb = galLookRgb;
    const vignette = galLookObject(p.vignette), haze = galLookObject(p.haze), split = galLookObject(p.split), bloom = galLookObject(p.bloom);
    const leak = galLookObject(p.leak), flare = galLookObject(p.flare), dirt = galLookObject(p.dirt), motes = galLookObject(p.motes), frame = galLookObject(p.frame);
    const fade = Array.isArray(p.fade) && p.fade.length === 2 && p.fade.every(v => typeof v === "number" && isFinite(v)) ? p.fade.map(v => Math.max(0, Math.min(8, v))) : null;
    const keep = p.keepHue && typeof p.keepHue === "object" ? p.keepHue : null;
    const levels = Math.round(num(p.posterize, 0, 0, 64));
    const leakAmount = num(leak.amount, 0, 0, 1), moteAmount = num(motes.amount, 0, 0, 1);
    return {
        exposure: num(p.exposure, 0, -4, 4), contrast: num(p.contrast, 1, 0, 3), saturation: num(p.saturation, 1, 0, 3),
        temperature: num(p.temperature, 0, -1, 1), tint: num(p.tint, 0, -1, 1),
        lift: galLookVec(p.lift, [0, 0, 0], -1, 1), gamma: galLookVec(p.gamma, [1, 1, 1], 0.1, 5), gain: galLookVec(p.gain, [1, 1, 1], 0, 4),
        mixer: galLookMixer(p.mixer),
        split: { amount: num(split.amount, 0, 0, 1), shadows: rgb(split.shadows, [0.5, 0.5, 0.5]), highlights: rgb(split.highlights, [0.5, 0.5, 0.5]), balance: num(split.balance, 0, -1, 1) },
        luts: typeof p.lut === "string" && p.lut ? [{ url: p.lut, amount: num(p.lutAmount, 1, 0, 1) }].filter(item => item.amount > 0) : [],
        invert: num(p.invert, 0, 0, 1),
        keepHue: { amount: keep ? num(keep.amount, 1, 0, 1) : 0, hue: keep ? num(keep.hue, 0, 0, 360) : 0, range: keep ? num(keep.range, 30, 1, 180) : 30 },
        posterize: { amount: levels >= 2 ? 1 : 0, levels: levels >= 2 ? levels : 0 },
        vignette: { amount: num(vignette.amount, 0, 0, 1), color: rgb(vignette.color, [0, 0, 0]), softness: num(vignette.softness, 0.5, 0, 1), pulse: num(vignette.pulse, 0, 0, 1) },
        haze: { amount: num(haze.amount, 0, 0, 1), color: rgb(haze.color, [1, 1, 1]) },
        grain: num(p.grain, 0, 0, 1), scratches: p.scratches === true ? 1 : 0,
        bloom: { amount: num(bloom.amount, 0, 0, 3), threshold: num(bloom.threshold, 0.72, 0, 1), blur: num(bloom.blur, 7, 0, 20) },
        chroma: num(p.chroma, 0, 0, 24), distortion: num(p.distortion, 0, -1, 1), wobble: num(p.wobble, 0, 0, 1),
        leaks: leakAmount > 0 ? [{ from: GAL_LEAK_FROM.includes(leak.from) ? leak.from : "left", texture: typeof leak.texture === "string" ? leak.texture : "", color: rgb(leak.color, [1, 0.62, 0.3]), amount: leakAmount }] : [],
        flare: { amount: num(flare.amount, 0, 0, 1), x: num(flare.x, 0.8, -0.5, 1.5), y: num(flare.y, 0.15, -0.5, 1.5), color: rgb(flare.color, [1, 0.88, 0.7]) },
        dirt: { amount: num(dirt.amount, 0, 0, 2), texture: typeof dirt.texture === "string" ? dirt.texture : "" },
        scanlines: num(p.scanlines, 0, 0, 1), pixelate: num(p.pixelate, 0, 0, 64), halftone: num(p.halftone, 0, 0, 1),
        motes: moteAmount > 0 && GAL_MOTE_KINDS.includes(motes.kind) ? [{ kind: motes.kind, amount: moteAmount }] : [],
        backBlur: num(p.backBlur, 0, 0, 20), ui: num(p.ui, 0.5, 0, 1),
        // soften = the share of our soft-focus Gaussian mixed over the scene;
        // frame = a picture stretched over the scene, under the flashes; fade = [in, out] s of this look (else the mood
        // layer's 4 s).
        soften: num(p.soften, 0, 0, 1),
        frame: { amount: num(frame.amount, 0, 0, 1), texture: typeof frame.texture === "string" ? frame.texture : "" },
        fade
    };
}
const GAL_LOOK_NEUTRAL = galLookNormalize({});
// The linear colour fields go into a time look's per-picture / per-figure grade; galLookExtras keeps
// everything else (vignette, grain, bloom, stylize …) for world.
const GAL_LOOK_LINEAR = ["exposure", "contrast", "saturation", "temperature", "tint", "lift", "gain", "mixer"];
function galLookExtras(look) {
    const out = Object.assign({}, look);
    GAL_LOOK_LINEAR.forEach(key => { out[key] = Array.isArray(GAL_LOOK_NEUTRAL[key]) ? GAL_LOOK_NEUTRAL[key].slice() : GAL_LOOK_NEUTRAL[key]; });
    return out;
}

// A look between a and b (t 0..1). Numbers lerp; a group whose amount is zero on one side takes its
// colours / positions from the other side (no sweep through black); weighted lists (LUTs, leaks, motes)
// fade their items out and in, keeping the two strongest.
function galLookMix(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const L = (x, y) => x + (y - x) * t;
    const V = (x, y) => x.map((v, i) => L(v, y[i]));
    const group = function (x, y) {
        const out = {}, xOff = x.amount <= 1e-4, yOff = y.amount <= 1e-4;
        Object.keys(y).forEach(function (key) {
            const u = x[key], v = y[key];
            if (key === "amount") out[key] = L(u, v);
            else if (xOff || yOff) out[key] = Array.isArray(v) ? (xOff ? v : u).slice() : xOff ? v : u;
            else if (Array.isArray(v)) out[key] = V(u, v);
            else if (typeof v === "number") out[key] = L(u, v);
            else out[key] = t < 0.5 ? u : v;
        });
        return out;
    };
    const list = function (x, y, keyOf) {
        const merged = new Map();
        [[x, 1 - t], [y, t]].forEach(function ([items, weight]) {
            items.forEach(function (item) {
                const key = keyOf(item), amount = item.amount * weight, hit = merged.get(key);
                if (!hit) { merged.set(key, Object.assign({}, item, { amount, color: item.color ? item.color.slice() : undefined })); return; }
                if (item.color && hit.color) { const w = amount / Math.max(1e-6, hit.amount + amount); hit.color = hit.color.map((c, i) => c + (item.color[i] - c) * w); }
                hit.amount += amount;
            });
        });
        return Array.from(merged.values()).filter(item => item.amount > 0.002).sort((p, q) => q.amount - p.amount).slice(0, 2)
            .map(item => { if (!item.color) delete item.color; return item; });
    };
    return {
        exposure: L(a.exposure, b.exposure), contrast: L(a.contrast, b.contrast), saturation: L(a.saturation, b.saturation),
        temperature: L(a.temperature, b.temperature), tint: L(a.tint, b.tint), lift: V(a.lift, b.lift), gamma: V(a.gamma, b.gamma), gain: V(a.gain, b.gain),
        mixer: V(a.mixer, b.mixer), split: group(a.split, b.split), luts: list(a.luts, b.luts, item => item.url), invert: L(a.invert, b.invert),
        keepHue: group(a.keepHue, b.keepHue), posterize: group(a.posterize, b.posterize), vignette: group(a.vignette, b.vignette), haze: group(a.haze, b.haze),
        grain: L(a.grain, b.grain), scratches: L(a.scratches, b.scratches), bloom: group(a.bloom, b.bloom),
        chroma: L(a.chroma, b.chroma), distortion: L(a.distortion, b.distortion), wobble: L(a.wobble, b.wobble),
        leaks: list(a.leaks, b.leaks, item => item.from + "|" + item.texture), flare: group(a.flare, b.flare), dirt: group(a.dirt, b.dirt),
        scanlines: L(a.scanlines, b.scanlines), pixelate: L(a.pixelate, b.pixelate), halftone: L(a.halftone, b.halftone),
        motes: list(a.motes, b.motes, item => item.kind), backBlur: L(a.backBlur, b.backBlur), ui: L(a.ui, b.ui),
        soften: L(a.soften, b.soften), frame: group(a.frame, b.frame), fade: b.fade
    };
}
// The linear colour part as a pixi colour matrix (4 × 5): exposure and white balance → mixer →
// saturation → gain → contrast → lift.
function galLookMatrix(look) {
    const M = galMatrix;
    const e = Math.pow(2, look.exposure), t = look.temperature, n = look.tint, m = look.mixer;
    const pre = M.scale(e * (1 + 0.16 * t + 0.05 * n), e * (1 + 0.02 * t - 0.14 * n), e * (1 - 0.16 * t + 0.05 * n));
    const mixer = [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0];
    return M.chain(pre, mixer, M.saturate(look.saturation), M.scale(look.gain[0], look.gain[1], look.gain[2]), M.contrast(look.contrast), M.offset(look.lift[0], look.lift[1], look.lift[2]));
}
// move the nonlinear time pass off variant backgrounds without changing the mood pass.
function galTimeGradeRoute(filters, filter, target, previous) {
    if (target === previous) return target;
    filters[previous].set("timeGrade", null);
    filters[target].set("timeGrade", filter);
    return target;
}
// Which passes and overlays a look needs at a quality. Low quality skips bloom, grain, chroma,
// distortion, dirt, halftone, backBlur and motes (stage-looks.md).
function galLookPlan(look, quality, extraMatrix) {
    const high = quality !== "low";
    const matrix = extraMatrix ? galMatrix.multiply(extraMatrix, galLookMatrix(look)) : galLookMatrix(look);
    const grade = !galMatrix.isIdentity(matrix) || look.gamma.some(v => Math.abs(v - 1) > 1e-3) || look.split.amount > 0.002 || look.keepHue.amount > 0.002 ||
        look.invert > 0.002 || look.posterize.amount > 0.002 || look.luts.length > 0;
    const lens = high && (Math.abs(look.distortion) > 0.002 || look.chroma > 0.05 || look.dirt.amount > 0.005 || look.halftone > 0.005);
    return {
        matrix, grade, bloom: high && look.bloom.amount > 0.005, screen: lens || look.pixelate >= 1.5 || look.scanlines > 0.005, film: high && look.grain > 0.005,
        backBlur: high ? look.backBlur : 0, motes: high ? look.motes : [],
        vignette: look.vignette.amount > 0.004, haze: look.haze.amount > 0.004, leaks: look.leaks, flare: look.flare.amount > 0.004,
        // Both kept at low quality: one 25-tap pass and one screen picture.
        soften: look.soften > 0.002, frame: look.frame.amount > 0.004 && Boolean(look.frame.texture)
    };
}
// our own soft focus - a 5 x 5 Gaussian at a tap spacing of one sigma
// (GAL_SOFTEN_SIGMA x the stage height, so it reads the same in a small window and at 3840 x 2160), normalized;
// edges repeat. look.soften mixes it over the scene.
const GAL_SOFTEN_SIGMA = 0.0015;
const GAL_SOFTEN_TAPS = (() => {
    const taps = [-2, -1, 0, 1, 2].flatMap(y => [-2, -1, 0, 1, 2].map(x => [x, y, Math.exp(-(x * x + y * y) / 2)]));
    const sum = taps.reduce((total, tap) => total + tap[2], 0);
    return taps.map(([x, y, w]) => [x, y, w / sum]);
})();
const GAL_SOFTEN_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 inputClamp;
uniform vec2 uSoften;
vec4 tap(float x, float y) { return texture2D(uSampler, clamp(vTextureCoord + vec2(x, y) * uSoften.x * inputSize.zw, inputClamp.xy, inputClamp.zw)); }
void main(void) {
    vec4 src = texture2D(uSampler, vTextureCoord);
    vec4 sum = vec4(0.0);
${GAL_SOFTEN_TAPS.map(([x, y, w]) => `    sum += tap(${x}.0, ${y}.0) * ${w.toFixed(5)};`).join("\n")}
    gl_FragColor = mix(src, sum, uSoften.y);
}`;
// The shader uniforms of the grade pass for a look (matrix already combined with the weather tint).
function galGradeUniforms(look, matrix) {
    const row = r => [matrix[r * 5], matrix[r * 5 + 1], matrix[r * 5 + 2], matrix[r * 5 + 4]];
    const luts = look.luts;
    return {
        uR: row(0), uG: row(1), uB: row(2), uGamma: look.gamma.map(g => 1 / g),
        uShadows: look.split.shadows, uHighlights: look.split.highlights, uSplit: [look.split.amount, look.split.balance],
        uKeep: [look.keepHue.hue / 360, look.keepHue.range / 360, look.keepHue.amount],
        uStyle: [look.invert, look.posterize.amount, look.posterize.levels || 2],
        lutA: luts[0] ? luts[0].url : "", lutB: luts[1] ? luts[1].url : "", uLutAmount: [luts[0] ? luts[0].amount : 0, luts[1] ? luts[1].amount : 0]
    };
}

// Registry of the loaded looks: { version, list, byId } (id → { id, label, meaning, time, params, source, look }).
function galLookRegistry(looks, version) {
    const list = [], byId = {};
    (Array.isArray(looks) ? looks : []).forEach(function (item) {
        if (!item || typeof item.id !== "string" || !GAL_LOOK_ID.test(item.id)) return;
        const entry = { id: item.id, label: String(item.label || item.id), meaning: String(item.meaning || ""), time: item.time === true, layer: stageLookLayer(item), params: galLookObject(item.params), source: item.source || "builtin", libraryId: String(item.libraryId || ""), directorNote: String(item.directorNote || "") };
        entry.look = galLookNormalize(entry.params);
        if (byId[entry.id]) list.splice(list.indexOf(byId[entry.id]), 1);
        byId[entry.id] = entry; list.push(entry);
    });
    return { version: version || 0, list, byId };
}
const GAL_LOOKS_EMPTY = galLookRegistry([], 0);
// Relative asset paths (the direct builtin fallback; the host RPC resolves them itself): every `lut` and
// `texture` string at any depth becomes base + path.
function galLookResolveAssets(params, base) {
    if (Array.isArray(params)) return params.map(value => galLookResolveAssets(value, base));
    if (!params || typeof params !== "object") return params;
    const out = {};
    Object.keys(params).forEach(function (key) {
        const value = params[key];
        if ((key === "lut" || key === "texture") && typeof value === "string") {
            if (value && !/^(?:[a-z]+:|\/)/i.test(value) && !value.includes("..")) out[key] = base + value.replace(/^\.\//, "");
            else if (/^\//.test(value)) out[key] = value;
        } else out[key] = galLookResolveAssets(value, base);
    });
    return out;
}
// What world shows and which time grade the figures / pictures get for a `light` value. A time look
// (dusk, night …) names the grade and gives world only its extras; any other look is the world look on top
// of the automatic time grade; `day` is plain; auto / unknown ids: the automatic grade (and its extras).
function galLookResolve(registry, light, autoGrade) {
    const byId = registry && registry.byId || {};
    const lighting = stageLighting(light, registry && registry.list || []);
    const grade = lighting.time === "day" ? "" : lighting.time === "auto" ? autoGrade || "" : lighting.time;
    const time = byId[grade], mood = byId[lighting.mood];
    const timeWorld = time && time.layer === "time" ? galLookExtras(time.look) : GAL_LOOK_NEUTRAL;
    const moodWorld = mood && mood.layer === "mood" ? galLookMix(GAL_LOOK_NEUTRAL, mood.look, 0.5) : GAL_LOOK_NEUTRAL;
    return { id: mood ? mood.id : lighting.time, grade, entry: mood || time || null, lighting, timeWorld, moodWorld, world: galLookCompose(timeWorld, moodWorld) };
}
// Time colour is applied per picture/figure first; mood is a world pass after it.
function galLookComposeMatrix(time, mood) { return galMatrix.multiply(mood, time); }
// Screen-space effects share their existing bounded passes. Alpha effects use source-over weights;
// nonlinear colour is NOT collapsed here: the renderer keeps an optional time grade before mood.
function galLookCompose(time, mood) {
    if (time === GAL_LOOK_NEUTRAL) return mood;
    if (mood === GAL_LOOK_NEUTRAL) return time;
    const out = Object.assign({}, mood);
    const group = (a, b) => {
        if (!a.amount) return b;
        if (!b.amount) return a;
        const amount = b.amount + a.amount * (1 - Math.min(1, b.amount));
        const result = Object.assign({}, b, { amount });
        for (const key of Object.keys(b)) {
            if (key === "amount") continue;
            const weight = b.amount / amount;
            if (Array.isArray(b[key])) result[key] = a[key].map((value, i) => value + (b[key][i] - value) * weight);
            else if (typeof b[key] === "number") result[key] = a[key] + (b[key] - a[key]) * weight;
        }
        return result;
    };
    for (const key of ["vignette", "haze", "bloom", "flare", "dirt"]) out[key] = group(time[key], mood[key]);
    out.frame = mood.frame.amount > 0 ? mood.frame : time.frame;
    for (const key of ["grain", "scratches", "chroma", "wobble", "scanlines", "pixelate", "halftone", "backBlur", "soften"]) out[key] = Math.max(time[key], mood[key]);
    out.distortion = Math.max(-1, Math.min(1, time.distortion + mood.distortion));
    for (const key of ["leaks", "motes"]) out[key] = mood[key].concat(time[key]).sort((a, b) => b.amount - a.amount).slice(0, 2);
    return out;
}
// Time grade of a time look: { grade, standIn } matrices (identity for unknown names / day). grade is
// paired (pictures and figures alike); standIn is the extra push of a picture that shows another time.
function galTimeGrade(registry, name) {
    const entry = name && registry && registry.byId ? registry.byId[name] : null;
    if (!entry || entry.layer !== "time") return { grade: galMatrix.identity(), standIn: galMatrix.identity() };
    const standIn = entry.params.standIn && typeof entry.params.standIn === "object" ? galLookNormalize(entry.params.standIn) : GAL_LOOK_NEUTRAL;
    return { grade: galLookMatrix(entry.look), standIn: galLookMatrix(standIn) };
}
// A picture already showing the grade's time stays as it is; a stand-in picture gets grade × standIn.
function galLayerCorrection(registry, grade, time) {
    if (!grade || grade === time) return galMatrix.identity();
    const g = galTimeGrade(registry, grade);
    return galMatrix.multiply(g.grade, g.standIn);
}

// Least-squares affine fit (3 × 4) of colour samples [[r, g, b], [r', g', b']] → a pixi colour matrix;
// approximates a LUT for the DOM UI (which can only take a colour matrix).
function galFitAffine(samples) {
    const m = galMatrix.identity();
    if (!samples || samples.length < 4) return m;
    const A = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    const B = [0, 1, 2].map(() => [0, 0, 0, 0]);
    samples.forEach(function ([x, y]) {
        const v = [x[0], x[1], x[2], 1];
        for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) A[i][j] += v[i] * v[j]; for (let c = 0; c < 3; c++) B[c][i] += v[i] * y[c]; }
    });
    const solve = function (M, b) {
        const a = M.map((row, i) => row.concat([b[i]]));
        for (let c = 0; c < 4; c++) {
            let p = c;
            for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
            if (Math.abs(a[p][c]) < 1e-9) return null;
            [a[c], a[p]] = [a[p], a[c]];
            for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k < 5; k++) a[r][k] -= f * a[c][k]; }
        }
        return a.map((row, i) => row[4] / row[i]);
    };
    for (let c = 0; c < 3; c++) {
        const x = solve(A, B[c]);
        if (!x) return galMatrix.identity();
        m[c * 5] = x[0]; m[c * 5 + 1] = x[1]; m[c * 5 + 2] = x[2]; m[c * 5 + 4] = x[3];
    }
    return m;
}
// How the DOM UI follows the scene this frame. input: { look (world, mixed), matrix (world linear incl.
// weather), grade (time grade on figures), lut (affine approximation or null), white, red, black,
// lightning, vignette: [rgb, alpha], haze: [rgb, alpha], shake: { x, y } } → { matrix (null = identity),
// vignette, haze, grain, shake }. Invert and posterize never reach the UI (text must stay readable);
// keep-hue only desaturates it; blackout only dims it.
function galLookUi(input) {
    const M = galMatrix, look = input.look, k = galClamp01(look.ui);
    let full = M.multiply(input.matrix || M.identity(), input.grade || M.identity());
    if (input.lut) full = M.multiply(M.mix(M.identity(), input.lut, input.lutAmount == null ? 1 : input.lutAmount), full);
    if (look.keepHue.amount > 0) full = M.multiply(M.saturate(1 - 0.75 * look.keepHue.amount), full);
    let m = M.mix(M.identity(), full, k);
    const flash = function (rgb, alpha) { if (alpha > 0.002) m = M.multiply([1 - alpha, 0, 0, 0, rgb[0] * alpha, 0, 1 - alpha, 0, 0, rgb[1] * alpha, 0, 0, 1 - alpha, 0, rgb[2] * alpha, 0, 0, 0, 1, 0], m); };
    const kf = Math.max(0.35, k);
    flash([0.78, 0, 0.12], (input.red || 0) * kf);
    flash([1, 1, 1], Math.min(0.85, ((input.white || 0) + (input.lightning || 0) * 0.5) * kf));
    const dim = 1 - 0.6 * galClamp01(input.black || 0);
    if (dim < 0.999) m = M.multiply(M.scale(dim, dim, dim), m);
    const pair = v => v && v[1] > 0.004 ? { color: v[0], alpha: galClamp01(v[1] * k) } : { color: [0, 0, 0], alpha: 0 };
    const shake = input.shake || { x: 0, y: 0 };
    return { matrix: M.isIdentity(m) ? null : m, vignette: pair(input.vignette || [look.vignette.color, look.vignette.amount]), haze: pair(input.haze || [look.haze.color, look.haze.amount]), grain: galClamp01(look.grain * k * 0.6), shake: { x: shake.x * k, y: shake.y * k } };
}
// ---------- Look runtime (pixi) ----------

const GAL_GRADE_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 uR;
uniform vec4 uG;
uniform vec4 uB;
uniform vec3 uGamma;
uniform vec3 uShadows;
uniform vec3 uHighlights;
uniform vec2 uSplit;
uniform vec3 uKeep;
uniform vec3 uStyle;
uniform sampler2D uLutA;
uniform sampler2D uLutB;
uniform vec4 uLut;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
vec3 lutSample(sampler2D lut, vec3 c, float size) {
    float b = c.b * (size - 1.0);
    float s0 = floor(b);
    float s1 = min(s0 + 1.0, size - 1.0);
    float x = (c.r * (size - 1.0) + 0.5) / (size * size);
    float y = (c.g * (size - 1.0) + 0.5) / size;
    vec3 a = texture2D(lut, vec2(x + s0 / size, y)).rgb;
    vec3 d = texture2D(lut, vec2(x + s1 / size, y)).rgb;
    return mix(a, d, b - s0);
}
vec3 softLight(vec3 b, vec3 s) {
    vec3 lo = 2.0 * b * s + b * b * (1.0 - 2.0 * s);
    vec3 hi = sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s);
    return mix(lo, hi, step(0.5, s));
}
vec3 hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
void main() {
    vec4 src = texture2D(uSampler, vTextureCoord);
    if (src.a <= 0.0) { gl_FragColor = src; return; }
    vec3 c = src.rgb / src.a;
    c = vec3(dot(uR.xyz, c) + uR.w, dot(uG.xyz, c) + uG.w, dot(uB.xyz, c) + uB.w);
    c = pow(max(c, 0.0), uGamma);
    if (uSplit.x > 0.0) {
        float l = clamp(dot(c, W), 0.0, 1.0);
        float w = smoothstep(0.0, 1.0, clamp(l + uSplit.y * 0.5, 0.0, 1.0));
        c = mix(c, softLight(clamp(c, 0.0, 1.0), uShadows), (1.0 - w) * uSplit.x);
        c = mix(c, softLight(clamp(c, 0.0, 1.0), uHighlights), w * uSplit.x);
    }
    if (uKeep.z > 0.0) {
        vec3 q = hsv(clamp(c, 0.0, 1.0));
        float d = abs(fract(q.x - uKeep.x + 0.5) - 0.5);
        float keep = (1.0 - smoothstep(uKeep.y * 0.55, uKeep.y, d)) * smoothstep(0.08, 0.28, q.y);
        c = mix(vec3(dot(c, W)), c, mix(1.0, keep, uKeep.z));
    }
    if (uLut.x + uLut.y > 0.0) {
        vec3 k = clamp(c, 0.0, 1.0);
        vec3 o = c * (1.0 - uLut.x - uLut.y);
        if (uLut.x > 0.0) o += lutSample(uLutA, k, uLut.z) * uLut.x;
        if (uLut.y > 0.0) o += lutSample(uLutB, k, uLut.w) * uLut.y;
        c = o;
    }
    if (uStyle.x > 0.0) c = mix(c, 1.0 - c, uStyle.x);
    if (uStyle.y > 0.0) { float n = max(uStyle.z - 1.0, 1.0); c = mix(c, floor(clamp(c, 0.0, 1.0) * n + 0.5) / n, uStyle.y); }
    gl_FragColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}`;
const GAL_SCREEN_FRAG = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform vec4 inputClamp;
uniform vec4 uLens;
uniform vec4 uFx;
uniform vec2 uWobble;
uniform sampler2D uDirtTex;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
vec2 tex(vec2 n) { return clamp(n * outputFrame.zw * inputSize.zw, inputClamp.xy, inputClamp.zw); }
float dots(vec2 p, float angle, float cell, float value) {
    float s = sin(angle), c = cos(angle);
    vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec2 f = mod(r, cell) - 0.5 * cell;
    float radius = sqrt(clamp(value, 0.0, 1.0)) * cell * 0.72;
    return 1.0 - smoothstep(radius - 0.7, radius + 0.7, length(f));
}
float lum(vec2 n) { return dot(texture2D(uSampler, tex(n)).rgb, W); }
void main() {
    vec2 size = outputFrame.zw;
    vec2 n0 = vTextureCoord * inputSize.xy / size;
    vec2 n = n0;
    vec2 aspect = vec2(size.x / size.y, 1.0);
    if (uLens.x != 0.0 || uWobble.x > 0.0) {
        vec2 d = (n - 0.5) * aspect;
        float r2 = dot(d, d) / dot(0.5 * aspect, 0.5 * aspect);
        float k = max(uLens.x, -0.3);
        n = 0.5 + (n - 0.5) * (1.0 + k * r2) / (1.0 + k);
        if (uWobble.x > 0.0) {
            float t = uWobble.y;
            vec2 wob = vec2(sin(n.y * 5.0 + t * 1.3) + 0.5 * sin(n.y * 11.0 - t * 2.1), cos(n.x * 4.0 + t * 1.1) + 0.5 * sin(n.x * 9.0 + t * 1.7));
            n += wob * uWobble.x * 0.006 * (0.4 + r2);
        }
    }
    if (uLens.z > 1.0) { vec2 cell = uLens.z / size; n = (floor(n / cell) + 0.5) * cell; }
    vec4 color = texture2D(uSampler, tex(n));
    if (uLens.y > 0.0) {
        vec2 dir = (n - 0.5) * size / (0.5 * length(size));
        vec2 off = (dir * uLens.y + vec2(uLens.y * 0.25, 0.0)) / size;
        color.r = texture2D(uSampler, tex(n + off)).r;
        color.b = texture2D(uSampler, tex(n - off)).b;
    }
    if (uLens.w > 0.0) {
        vec2 p = n * size;
        float cell = 5.5;
        vec3 cmy = 1.0 - clamp(color.rgb, 0.0, 1.0);
        float k = min(cmy.x, min(cmy.y, cmy.z));
        vec3 ink = (cmy - k) / max(1.0 - k, 1e-3);
        vec3 print = vec3(0.965, 0.945, 0.885);
        print *= 1.0 - dots(p, 0.2618, cell, ink.x) * vec3(0.88, 0.26, 0.06);
        print *= 1.0 - dots(p, 1.309, cell, ink.y) * vec3(0.1, 0.84, 0.3);
        print *= 1.0 - dots(p, 0.0, cell, ink.z) * vec3(0.02, 0.1, 0.84);
        print *= 1.0 - dots(p, 0.7854, cell, k) * 0.9;
        color.rgb = mix(color.rgb, print * color.a, uLens.w);
    }
    if (uFx.x > 0.0) {
        float y = n0.y * size.y;
        float line = 0.5 + 0.5 * cos(6.2831853 * y / 3.0);
        color.rgb *= 1.0 - uFx.x * 0.5 * (1.0 - line);
        float mx = mod(floor(n0.x * size.x * uFx.w), 3.0);
        vec3 mask = mx < 1.0 ? vec3(1.0, 0.78, 0.78) : mx < 2.0 ? vec3(0.78, 1.0, 0.78) : vec3(0.78, 0.78, 1.0);
        color.rgb *= mix(vec3(1.0), mask * 1.14, uFx.x * 0.4);
        float roll = fract(n0.y - uFx.z * 0.09) - 0.5;
        color.rgb *= 1.0 + uFx.x * 0.07 * exp(-roll * roll * 90.0);
    }
    if (uFx.y > 0.0) {
        vec2 r = vec2(0.07 / aspect.x, 0.07);
        float l = lum(n0) * 0.2;
        l += (lum(n0 + vec2(r.x, 0.0)) + lum(n0 - vec2(r.x, 0.0)) + lum(n0 + vec2(0.0, r.y)) + lum(n0 - vec2(0.0, r.y))) * 0.1;
        l += (lum(n0 + r * 1.4) + lum(n0 - r * 1.4) + lum(n0 + vec2(r.x, -r.y) * 1.4) + lum(n0 + vec2(-r.x, r.y) * 1.4)) * 0.1;
        float b = smoothstep(0.42, 0.95, l);
        vec3 dirt = texture2D(uDirtTex, n0).rgb;
        color.rgb += dirt * b * uFx.y * 1.8 * color.a * (1.0 - color.rgb * 0.5);
    }
    gl_FragColor = color;
}`;

// Generated overlay pictures: vignette (by softness), light leaks (by edge), flare parts, default lens dirt.
function galLookArt(PIXI, kind) {
    const soft = /^vignette:(\d)$/.exec(kind);
    if (soft) {
        const s = Number(soft[1]) / 4, inner = 0.32 - 0.28 * s;
        return galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
            ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(w / h, 1);
            const g = ctx.createRadialGradient(0, 0, h * inner, 0, 0, h * 0.62);
            g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.45, "rgba(255,255,255,.12)"); g.addColorStop(0.8, "rgba(255,255,255,.62)"); g.addColorStop(1, "rgba(255,255,255,1)");
            ctx.fillStyle = g; ctx.fillRect(-w, -h, w * 2, h * 2); ctx.restore();
        });
    }
    const leak = /^leak:(\w+)$/.exec(kind);
    if (leak) return galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
        // Soft overlapping blobs of light pouring in from one edge (drawn for the left edge, then turned).
        const from = leak[1];
        ctx.save();
        if (from === "right") { ctx.translate(w, 0); ctx.scale(-1, 1); }
        const blob = function (x, y, rx, ry, alpha) {
            ctx.save(); ctx.translate(x, y); ctx.scale(rx / ry, 1);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
            g.addColorStop(0, "rgba(255,255,255," + alpha + ")"); g.addColorStop(0.35, "rgba(255,255,255," + alpha * 0.55 + ")"); g.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        };
        if (from === "top") { blob(w * 0.3, -h * 0.05, w * 0.42, h * 0.42, 0.85); blob(w * 0.62, -h * 0.02, w * 0.3, h * 0.32, 0.6); blob(w * 0.85, h * 0.02, w * 0.22, h * 0.2, 0.4); }
        else if (from === "corner") { blob(-w * 0.02, -h * 0.04, w * 0.46, h * 0.6, 0.95); blob(w * 0.16, h * 0.12, w * 0.2, h * 0.3, 0.45); blob(w * 0.05, h * 0.5, w * 0.12, h * 0.26, 0.3); }
        else { blob(-w * 0.04, h * 0.42, w * 0.3, h * 0.72, 0.95); blob(w * 0.05, h * 0.12, w * 0.16, h * 0.34, 0.55); blob(w * 0.1, h * 0.86, w * 0.14, h * 0.3, 0.4); }
        ctx.restore();
    });
    if (kind === "flare:glow" || kind === "flare:ghost" || kind === "flare:ring" || kind === "flare:core") return galCanvasTexture(PIXI, 256, 256, function (ctx, w, h) {
        const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        if (kind === "flare:glow") { g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.12, "rgba(255,255,255,.45)"); g.addColorStop(0.4, "rgba(255,255,255,.12)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else if (kind === "flare:core") { g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.2, "rgba(255,255,255,.8)"); g.addColorStop(0.5, "rgba(255,255,255,.15)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else if (kind === "flare:ghost") { g.addColorStop(0, "rgba(255,255,255,.18)"); g.addColorStop(0.7, "rgba(255,255,255,.3)"); g.addColorStop(0.86, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        else { g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.8, "rgba(255,255,255,0)"); g.addColorStop(0.9, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); }
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
    if (kind === "flare:streak") return galCanvasTexture(PIXI, 512, 32, function (ctx, w, h) {
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
        const v = ctx.createLinearGradient(0, 0, 0, h);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(0.5, "rgba(0,0,0,1)"); v.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    });
    if (kind === "dirt") return galCanvasTexture(PIXI, 512, 288, function (ctx, w, h) {
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
        let seed = 11;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 18; i++) {
            const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 80;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, "rgba(255,245,230," + (0.08 + rnd() * 0.12) + ")"); g.addColorStop(1, "rgba(255,245,230,0)");
            ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        for (let i = 0; i < 160; i++) { ctx.fillStyle = "rgba(255,250,240," + (0.25 + rnd() * 0.5) + ")"; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 1.4, 0, Math.PI * 2); ctx.fill(); }
    });
    return null;
}

// The look renderer of one scene. env: { PIXI, app, filters (named chains), overlay (container for its
// sprites, below the beat flashes), tune(filter), use(chain, name, make, active, now) }.
function galCreateLookRenderer(env) {
    const { PIXI, app, filters } = env;
    // Layers: time, mood and the persistent screen look (screen.set) above them.
    const state = {
        layers: [0, 1, 2].map(() => ({ key: null, from: GAL_LOOK_NEUTRAL, to: GAL_LOOK_NEUTRAL, look: GAL_LOOK_NEUTRAL, start: 0, duration: 0 })),
        look: GAL_LOOK_NEUTRAL,
        weatherKey: null, weatherFrom: galMatrix.identity(), weatherTo: galMatrix.identity(), weather: galMatrix.identity(), weatherStart: 0,
        resolved: null, grainAt: 0, textures: new Map(), plan: null, matrix: galMatrix.identity(), lastSweep: 0, lutFits: new Map()
    };
    // ---- textures: URLs (LUTs, card leaks / dirt) and generated pictures, released after 3 s unused.
    function texture(key, now) {
        let record = state.textures.get(key);
        if (!record) {
            record = { key, texture: null, used: now, failed: false };
            state.textures.set(key, record);
            if (key.startsWith("url:")) {
                const url = key.slice(4), image = new Image();
                image.decoding = "async";
                image.src = url;
                (image.decode ? image.decode() : new Promise((ok, fail) => { image.onload = ok; image.onerror = fail; })).then(function () {
                    if (state.destroyed || state.textures.get(key) !== record) return;
                    record.texture = new PIXI.Texture(new PIXI.BaseTexture(image, { mipmap: PIXI.MIPMAP_MODES.OFF, scaleMode: PIXI.SCALE_MODES.LINEAR, wrapMode: PIXI.WRAP_MODES.CLAMP }));
                    record.image = image;
                }).catch(function (error) { record.failed = true; console.warn("[fork-gal-looks] texture failed", url, error); });
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
    const makeGrade = () => env.tune(new PIXI.Filter(undefined, GAL_GRADE_FRAG, {
        uR: new Float32Array([1, 0, 0, 0]), uG: new Float32Array([0, 1, 0, 0]), uB: new Float32Array([0, 0, 1, 0]), uGamma: new Float32Array([1, 1, 1]),
        uShadows: new Float32Array([0.5, 0.5, 0.5]), uHighlights: new Float32Array([0.5, 0.5, 0.5]), uSplit: new Float32Array([0, 0]), uKeep: new Float32Array([0, 0.1, 0]),
        uStyle: new Float32Array([0, 0, 2]), uLutA: PIXI.Texture.WHITE, uLutB: PIXI.Texture.WHITE, uLut: new Float32Array([0, 0, 16, 16])
    }));
    const timeGradeFilter = makeGrade(), gradeFilter = makeGrade(), screenGradeFilter = makeGrade();
    let timeGradeTarget = "world";
    timeGradeFilter.enabled = gradeFilter.enabled = screenGradeFilter.enabled = false;
    filters.world.set("timeGrade", timeGradeFilter);
    filters.world.set("grade", gradeFilter);
    filters.world.set("screenGrade", screenGradeFilter);
    const setUniform = (u, name, values) => { const target = u[name]; for (let i = 0; i < values.length; i++) target[i] = values[i]; };

    // ---- overlay sprites
    const sprite = function (blend) {
        const item = new PIXI.Sprite(PIXI.Texture.EMPTY);
        item.alpha = 0; item.visible = false;
        if (blend) item.blendMode = blend;
        env.overlay.addChild(item);
        return item;
    };
    // the look's frame picture lies under the other look overlays (the original's frame sprite, layout order 7).
    const framePicture = sprite();
    const vignette = sprite(), haze = sprite(PIXI.BLEND_MODES.SCREEN);
    const leaks = [sprite(PIXI.BLEND_MODES.SCREEN), sprite(PIXI.BLEND_MODES.SCREEN)], leakCores = [sprite(PIXI.BLEND_MODES.SCREEN), sprite(PIXI.BLEND_MODES.SCREEN)];
    const flare = new PIXI.Container();
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
        timeGradeTarget = galTimeGradeRoute(filters, timeGradeFilter, desc.packLayers?.timeGradeTarget || "world", timeGradeTarget);
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
        const weather = typeof GAL_WEATHERS !== "undefined" && GAL_WEATHERS.includes(desc.weather) ? desc.weather : "";
        if (weather !== state.weatherKey) {
            const first = state.weatherKey == null;
            state.weatherKey = weather; state.weatherFrom = state.weather; state.weatherTo = galWeatherMatrix(weather); state.weatherStart = first ? now - GAL_LOOK_MS : now;
        }
    }
    function tick(desc, now, W, H, quality) {
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
        const bloom = env.use("world", "bloom", () => Object.assign(new PIXI.filters.AdvancedBloomFilter({ threshold: 0.72, bloomScale: 0, brightness: 1, blur: 7, quality: 4 }), { forkLowRes: true }), plan.bloom, now);
        if (bloom) { bloom.threshold = look.bloom.threshold; bloom.bloomScale = look.bloom.amount; bloom.brightness = 1; if (Math.abs(bloom.blur - look.bloom.blur) > 0.05) bloom.blur = look.bloom.blur; }
        // screen (lens + stylize + dirt)
        const screen = env.use("world", "screen", () => new PIXI.Filter(undefined, GAL_SCREEN_FRAG, { uLens: new Float32Array(4), uFx: new Float32Array(4), uWobble: new Float32Array(2), uDirtTex: PIXI.Texture.BLACK }), plan.screen, now);
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
        const soften = env.use("world", "soften", () => new PIXI.Filter(undefined, GAL_SOFTEN_FRAG, { uSoften: new Float32Array([1, 0]) }), plan.soften, now);
        if (soften) setUniform(soften.uniforms, "uSoften", [GAL_SOFTEN_SIGMA * H * (soften.resolution || app.renderer.resolution), look.soften]);
        // film grain and scratches, re-seeded at 24 fps like a projector
        const film = env.use("world", "film", () => new PIXI.filters.OldFilmFilter({ sepia: 0, noise: 0, noiseSize: 1, scratch: 0, scratchDensity: 0.32, scratchWidth: 1.4, vignetting: 0, vignettingAlpha: 0, vignettingBlur: 0.3 }), plan.film, now);
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
            else if (item.art === "core") { item.position.set(sx, sy); item.width = item.height = H * 0.22; item.tint = galColorMix(color, 0xffffff, 0.6); item.alpha = 0.9 * a; }
            else if (item.art === "streak") { item.position.set(sx, sy); item.width = W * 1.5; item.height = H * 0.035; item.tint = galColorMix(color, 0xbfd4ff, 0.35); item.alpha = 0.55 * a; }
            else if (item.art === "ring") { item.position.set(sx, sy); item.width = item.height = H * 0.75; item.tint = color; item.alpha = 0.22 * a; }
            else {
                const [k, size, alpha, tint] = ghosts[ghost++];
                item.position.set(cx + (cx - sx) * k, cy + (cy - sy) * k);
                item.width = item.height = H * size * 2.2; item.tint = galColorMix(color, galLookHex(tint), 0.5); item.alpha = alpha * a * 1.6;
            }
        });
    }
    return {
        tick,
        look: () => state.look,
        plan: () => state.plan,
        matrix: () => state.matrix,
        resolved: () => state.resolved,
        // The DOM UI frame (galLookUi) for the current look; beats: { white, red, black, lightning, vignette, shake }.
        ui(grade, beats) {
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
            return { look: state.resolved ? state.resolved.id : "", lighting: state.resolved ? state.resolved.lighting : null, fades: state.layers.map(layer => layer.duration), grade: state.resolved ? state.resolved.grade : "", textures: Array.from(state.textures.keys()),
                frame: Math.round((framePicture.visible ? framePicture.alpha : 0) * 100) / 100, vignette: Math.round(vignette.alpha * 100) / 100, haze: Math.round(haze.alpha * 100) / 100, leaks: leaks.filter(item => item.visible).length, flare: flare.visible };
        },
        destroy() {
            state.destroyed = true;
            state.textures.forEach(record => { if (record.texture) record.texture.destroy(true); });
            state.textures.clear();
            filters[timeGradeTarget].set("timeGrade", null);
            filters.world.set("grade", null);
            timeGradeFilter.destroy(); gradeFilter.destroy();
        }
    };
}

// DOM side of the UI follow: writes the frame from galLookUi onto the stage root (CSS variables, the
// SVG colour matrix the text box / choices / backlog filter through) only when it changes. The paint-only overlay
// variables (vignette, haze, grain; read only by .fork-gal-frame .look/.grain) go on that frame instead: a pulsing
// vignette rewrites them every frame, and on the root each write restyled the whole stage.
const GAL_UI_FRAME_VARS = new Set(["--look-vig", "--look-vig-color", "--look-haze", "--look-haze-color", "--look-grain"]);
function galUiApplier() {
    let last = {}, paint = { node: null, values: {} };
    const fmt = v => Math.round(v * 1000) / 1000;
    const rgb = c => c.map(v => Math.round(v * 255)).join(" ");
    return function apply(root, frame) {
        if (!root) return;
        const matrix = frame && frame.matrix ? frame.matrix.map(fmt).join(" ") : "";
        if (matrix !== last.matrix) {
            last.matrix = matrix;
            const node = root.querySelector(".fork-gal-look-defs feColorMatrix");
            if (node && matrix) node.setAttribute("values", matrix);
            if (matrix) root.setAttribute("data-look-ui", ""); else root.removeAttribute("data-look-ui");
        }
        const vars = frame ? {
            "--look-shake-x": fmt(frame.shake.x) + "px", "--look-shake-y": fmt(frame.shake.y) + "px",
            "--look-vig": String(fmt(frame.vignette.alpha)), "--look-vig-color": rgb(frame.vignette.color),
            "--look-haze": String(fmt(frame.haze.alpha)), "--look-haze-color": rgb(frame.haze.color), "--look-grain": String(fmt(frame.grain))
        } : { "--look-shake-x": "0px", "--look-shake-y": "0px", "--look-vig": "0", "--look-vig-color": "0 0 0", "--look-haze": "0", "--look-haze-color": "255 255 255", "--look-grain": "0" };
        // Pack skins render no .fork-gal-frame, so nothing reads the paint variables: skip them rather than fall back to
        // the root, where every fade step restyled the whole stage (~2.5x the elements per recalc of classic). A frame
        // that mounts later starts with an empty cache and gets every value on the next scene frame.
        const frameNode = root.querySelector(".fork-gal-frame");
        if (frameNode !== paint.node) paint = { node: frameNode, values: {} };
        Object.keys(vars).forEach(function (name) {
            const cache = GAL_UI_FRAME_VARS.has(name) ? paint.values : last, node = cache === last ? root : frameNode;
            if (!node) return;
            if (cache[name] !== vars[name]) { cache[name] = vars[name]; node.style.setProperty(name, vars[name]); }
        });
        const grain = Boolean(frame && frame.grain > 0.01);
        if (grain !== last.grain) { last.grain = grain; if (grain) root.setAttribute("data-look-grain", ""); else root.removeAttribute("data-look-grain"); }
    };
}
