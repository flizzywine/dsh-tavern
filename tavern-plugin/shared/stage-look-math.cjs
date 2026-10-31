function createStageLookMath({matrix:galMatrix,clamp:galClamp01,lighting:stageLighting,layer:stageLookLayer}) {
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

return {GAL_LOOK_ID, GAL_LOOK_MS, GAL_LEAK_FROM, GAL_MOTE_KINDS, GAL_LUMA, galLookNumber, galLookRgb, galLookHex, galLookVec, galLookMixer, galLookObject, galLookNormalize, GAL_LOOK_NEUTRAL, GAL_LOOK_LINEAR, galLookExtras, galLookMix, galLookMatrix, galLookPlan, galGradeUniforms, galLookRegistry, GAL_LOOKS_EMPTY, galLookResolveAssets, galLookResolve, galLookComposeMatrix, galLookCompose, galTimeGrade, galLayerCorrection, galFitAffine, galLookUi};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageLookMath};
