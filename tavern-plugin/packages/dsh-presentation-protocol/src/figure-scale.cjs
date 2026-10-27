// shared, IO-free figure contract. Included in the client and imported by the host.
const FIGURE_DISPLAY = Object.freeze({ version: 6, FILL: 1.24, HEAD_TOP: 0.13, REF_MIN_CM: 150, curve: "log-gap", gapCap: 0.035, gapSlope: 0.45, tailSlope: 0.65, transitionMs: 1200, headLimit: 0.97 });
const FIGURE_ALGORITHM = 1;
function figureRatio(r) {
    if (r <= 0) return 0;
    const c = FIGURE_DISPLAY, x = -Math.log(r);
    // odd C1 extension lets taller late entrants exceed the locked ruler
    // (and trigger headLimit), without exponential blow-up or clamping their order.
    const gap = Math.sign(x) * c.gapCap * -Math.expm1(-c.gapSlope * Math.abs(x) / c.gapCap) + c.tailSlope * x;
    return Math.exp(-gap);
}
function figureDisplayCm(heightCm, hMax = heightCm, spread = 1) {
    // Small bodies use real centimetres, not the human readability curve (30 cm became 51 cm).
    // Blend only across 80..100 cm; metre-tall and taller figures retain the exact existing ruler.
    if (heightCm <= 80) return heightCm;
    const hRef = Math.max(hMax, FIGURE_DISPLAY.REF_MIN_CM), ratio = figureRatio(heightCm / hRef);
    // a skin shows only this share of the curve's (log) gap to the
    // ruler, as its original draws heights closer together; small bodies above keep their real centimetres.
    const human = hRef * (spread === 1 ? ratio : Math.pow(ratio, spread));
    if (heightCm >= 100) return human;
    const t = (heightCm - 80) / 20, mix = t * t * (3 - 2 * t);
    return heightCm + (human - heightCm) * mix;
}
function figurePixelsPerCm(H, hMax) {
    const c = FIGURE_DISPLAY;
    return c.FILL * H / Math.max(hMax, c.REF_MIN_CM);
}
function figureGroundY(H, groundRatio = 1) {
    return H * (FIGURE_DISPLAY.HEAD_TOP + FIGURE_DISPLAY.FILL * groundRatio);
}
function figureInput(character, model, mood) {
    const slot = figureSlot(model, mood), extension = model.figure;
    return { heightCm: character?.heightCm, heightBasis: character?.heightBasis || "standing", elevationCm: character?.placement?.elevationCm || 0,
        assetScale: model.scale ?? 1, version: extension?.version,
        metrics: model.kind === "static" ? extension?.slots?.[slot] : extension,
        source: model.kind === "static" ? (/^[a-f0-9]{64}$/.test(model.imageSources?.[slot] || "") ? model.imageSources[slot] : figureSource(model.images?.[slot])) : model.modelRevision,
        ...(model.kind === "static" ? {sourceUrl:model.images?.[slot] || ""} : {}) };
}
// Snapshot only validated measurements, not URLs or GPU objects. Each direction record owns its
// catalogue so later calibration edits cannot retroactively change historical scene decisions.
function figureCatalog(characters, models) {
    const catalog = {};
    for (const character of characters || []) {
        if (character.offstage) continue;
        const variants = {};
        for (const [outfit, id] of [["", character.portrait], ...(character.outfits || []).map(o => [o.label, o.model])]) {
            const model = (models || []).find(m => m.id === id && !m.retired);
            if (!model) continue;
            const measurements = [];
            for (const mood of model.kind === "static" ? Object.keys(model.images || {}) : [""]) {
                const input = figureInput(character, model, mood);
                const sized = resolveFigureSizing({ ...input, canvas: input.metrics?.canvas, W: 1, H: 1, sceneHMax: character.heightCm });
                if (sized.mode !== "physical") continue;
                const m = { ...(input.metrics.auto?.algorithmVersion === FIGURE_ALGORITHM ? input.metrics.auto : {}), ...input.metrics.override };
                const g = figureGeometry(m, input.heightBasis);
                measurements.push({ heightCm: character.heightCm, elevationCm: input.elevationCm,
                    headRatio: (g.feet - (m.headTop ?? m.faceRect?.[1] ?? m.figureTop)) / g.bodySpan * g.ratio * input.assetScale });
            }
            if (measurements.length) variants[outfit] = measurements;
        }
        if (Object.keys(variants).length) catalog[character.alias] = variants;
    }
    return catalog;
}
function figureSceneCut(entry) {
    return Boolean(entry.scene || (entry.commands || []).some(c => c.op === "trans"));
}
// prefix-only replay; future beats and display timing never own the ruler.
function figureDirection(start = {}, entries = [], catalog = {}, para = Infinity) {
    const c = FIGURE_DISPLAY, carried = start.figureScale;
    let state = carried?.version === c.version ? { ...carried } : null;
    let cast = [...(start.cast || [])], outfits = { ...start.outfits }, event = null;
    const measurements = (ids, clothes) => ids.flatMap(id => catalog[id]?.[clothes[id] || ""] || []);
    const apply = (entry, ids, clothes) => {
        Object.assign(clothes, entry.outfits || {});
        if (entry.cast) ids = [...entry.cast];
        else for (const command of entry.commands || []) {
            if (command.op === "enter" && !ids.includes(command.id)) ids = [...ids, command.id];
            if (command.op === "exit") ids = ids.filter(id => id !== command.id);
        }
        return ids;
    };
    function reference(ids, clothes) {
        const all = measurements(ids, clothes);
        const hMax = Math.max(0, ...all.map(m => m.heightCm)) || c.REF_MIN_CM;
        const groundRatio = Math.max(0, ...all.filter(m => m.heightCm === hMax).map(m => m.headRatio)) || 1;
        return { hMax, ...(groundRatio !== 1 ? { groundRatio } : {}) };
    }
    if (!state) state = { version: c.version, scene: 0, ...reference(cast, outfits), rescales: 0 };
    for (let i = 0; i < entries.length && entries[i].at <= para; i++) {
        const entry = entries[i], previousCast = cast;
        cast = apply(entry, cast, outfits);
        if (figureSceneCut(entry)) {
            state = { version: c.version, scene: state.scene + 1, ...reference(cast, outfits), rescales: 0 };
            event = { kind: "cut", at: entry.at };
        } else {
            const entrants = measurements(cast.filter(id => !previousCast.includes(id)), outfits);
            const taller = entrants.filter(m => m.heightCm > state.hMax);
            const clipped = taller.some(m => {
                const px = figurePixelsPerCm(1, state.hMax), displayed = figureDisplayCm(m.heightCm, state.hMax) * px;
                const available = figureGroundY(1, state.groundRatio) - (1 - c.headLimit);
                return displayed * m.headRatio + m.elevationCm * px > available;
            });
            if (clipped) {
                const ruler = reference(cast, outfits);
                event = { kind: "rescale", at: entry.at, from: state.hMax, warning: "mid-scene rescale" };
                state = { ...state, ...ruler, groundRatio: ruler.groundRatio ?? 1, rescales: state.rescales + 1 };
            }
        }
    }
    return { ...state, event };
}
function figureCarry(scale) {
    if (!scale) return undefined;
    const { event, ...state } = scale;
    return state;
}
// Wall-clock time belongs only to the renderer, never the persisted replay snapshot.
function figureSceneFrame(state, now) {
    if (!state) return { state: null, hMax: FIGURE_DISPLAY.REF_MIN_CM };
    const t = Math.min(1, Math.max(0, (now - state.start) / FIGURE_DISPLAY.transitionMs));
    const mix = t * t * (3 - 2 * t);
    return { state, hMax: state.from + (state.to - state.from) * mix,
        groundRatio: (state.groundFrom ?? 1) + ((state.groundTo ?? 1) - (state.groundFrom ?? 1)) * mix };
}
function figureSceneUpdate(state, snapshot, now, snap = false) {
    const key = JSON.stringify(figureCarry(snapshot));
    if (state?.key === key && !snap) return state;
    const animate = !snap && state && state.scene === snapshot.scene && snapshot.rescales > state.rescales && snapshot.event?.kind === "rescale";
    return { key, scene: snapshot.scene, rescales: snapshot.rescales, from: animate ? figureSceneFrame(state, now).hMax : snapshot.hMax,
        to: snapshot.hMax, groundFrom: animate ? figureSceneFrame(state, now).groundRatio : snapshot.groundRatio ?? 1,
        groundTo: snapshot.groundRatio ?? 1, start: now, warning: animate ? "mid-scene rescale" : null };
}
function figureNumber(value, lo, hi) { return typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi; }
function figureObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function figureCharacter(raw) {
    const out = {};
    if (raw.heightCm != null) {
        if (!figureNumber(raw.heightCm, 1, 1000)) throw new Error("heightCm must be 1..1000 cm");
        out.heightCm = Math.round(raw.heightCm * 10) / 10;
    }
    if (raw.heightBasis != null) {
        if (!["standing", "seated"].includes(raw.heightBasis)) throw new Error("Invalid heightBasis");
        out.heightBasis = raw.heightBasis;
    }
    if (raw.heightNote != null) {
        if (typeof raw.heightNote !== "string" || [...raw.heightNote].length > 160) throw new Error("heightNote exceeds 160 characters");
        out.heightNote = raw.heightNote.trim();
    }
    if (raw.placement != null) {
        if (!figureObject(raw.placement) || !figureNumber(raw.placement.elevationCm, 0, 500)) throw new Error("elevationCm must be 0..500 cm");
        out.placement = { elevationCm: Math.round(raw.placement.elevationCm * 10) / 10 };
    }
    return out;
}
function figureMetrics(raw) {
    if (!figureObject(raw) || Object.keys(raw).length > 32) throw new Error("Invalid figure metrics");
    const out = {};
    for (const key of ["figureTop", "visibleBottom", "supportX", "feet", "headTop", "chin"]) if (raw[key] != null) {
        if (!figureNumber(raw[key], -65536, 65536)) throw new Error("Invalid figure coordinate: " + key);
        out[key] = raw[key];
    }
    for (const [key, lo, hi] of [["poseHeightRatio", 0.01, 4], ["visibleFraction", 0.001, 1], ["headsPerBody", 1, 20], ["confidence", 0, 1]]) if (raw[key] != null) {
        if (!figureNumber(raw[key], lo, hi)) throw new Error("Invalid figure ratio: " + key);
        out[key] = raw[key];
    }
    for (const [key, values] of [["posture", ["standing", "seated", "crouching", "other"]], ["heightBasis", ["standing", "seated"]], ["crop", ["full", "thigh", "waist", "chest", "custom"]]]) if (raw[key] != null) {
        if (!values.includes(raw[key])) throw new Error("Invalid figure " + key);
        out[key] = raw[key];
    }
    if (raw.cheeks != null) {
        const c = raw.cheeks;
        if (!figureObject(c) || !["left", "right"].every(k => Array.isArray(c[k]) && c[k].length === 2 && c[k].every(n => figureNumber(n, -65536, 65536))) || !figureNumber(c.size, Number.MIN_VALUE, 65536)) throw new Error("Invalid figure cheeks");
        out.cheeks = { left: [...c.left], right: [...c.right], size: c.size };
    }
    for (const key of ["faceRect", "inkBounds", "bodyBounds"]) if (raw[key] != null) {
        if (!Array.isArray(raw[key]) || raw[key].length !== 4 || !raw[key].every(n => figureNumber(n, -65536, 65536)) || raw[key][2] <= 0 || raw[key][3] <= 0) throw new Error("Invalid figure rectangle");
        out[key] = [...raw[key]];
    }
    for (const key of ["method", "restPosePolicy", "coreVersion"]) if (raw[key] != null) {
        if (typeof raw[key] !== "string" || raw[key].length > 100) throw new Error("Invalid figure provenance");
        out[key] = raw[key];
    }
    if (raw.algorithmVersion != null) {
        if (!Number.isInteger(raw.algorithmVersion) || raw.algorithmVersion < 1) throw new Error("Invalid figure algorithmVersion");
        out.algorithmVersion = raw.algorithmVersion;
    }
    for (const key of ["cropSuspected", "invalid", "estimated"]) if (raw[key] === true) out[key] = true;
    if (raw.warnings != null) {
        if (!Array.isArray(raw.warnings) || raw.warnings.length > 16 || raw.warnings.some(s => typeof s !== "string" || s.length > 100)) throw new Error("Invalid figure warnings");
        out.warnings = [...raw.warnings];
    }
    return out;
}
function figureGeometry(metrics, basis) {
    const m = metrics || {}, span = m.visibleBottom - m.figureTop;
    if (m.invalid || !Number.isFinite(span) || span <= 0) return { reason: "invalid-span" };
    if (!["standing", "seated"].includes(m.posture) || m.heightBasis !== basis) return { reason: "unconfirmed-posture" };
    const ratio = m.poseHeightRatio == null && m.posture === basis ? 1 : m.poseHeightRatio;
    if (!figureNumber(ratio, 0.01, 4)) return { reason: "missing-pose-ratio" };
    let feet = m.feet;
    if (feet == null && m.visibleFraction != null) feet = m.figureTop + span / m.visibleFraction;
    if (feet == null && m.headsPerBody && m.chin > m.headTop) feet = m.figureTop + (m.chin - m.headTop) * m.headsPerBody;
    if (!Number.isFinite(feet) || feet < m.visibleBottom || feet <= m.figureTop) return { reason: "missing-support" };
    const fraction = span / (feet - m.figureTop);
    if (m.visibleFraction != null && Math.abs(fraction - m.visibleFraction) > 1e-6) return { reason: "conflicting-fraction" };
    if (!m.crop || m.crop === "full" && Math.abs(fraction - 1) > 1e-6) return { reason: "unconfirmed-crop" };
    return { feet, fraction, ratio, span, bodySpan: feet - m.figureTop };
}
function figureRecord(raw, source, key = "sourceSha", strict = false) {
    if (!figureObject(raw) || Object.keys(raw).length > 12 || !/^[0-9a-f]{64}$/.test(raw[key] || "") || !Array.isArray(raw.canvas) || raw.canvas.length !== 2 || !raw.canvas.every(n => Number.isInteger(n) && n > 0 && n <= 16384) || !["pending", "confirmed", "stale"].includes(raw.status)) throw new Error("Invalid figure record");
    const out = { [key]: raw[key], canvas: [...raw.canvas], status: raw.status };
    for (const field of ["auto", "override"]) if (raw[field] != null) out[field] = figureMetrics(raw[field]);
    if (source !== raw[key]) {
        if (strict) throw new Error("Stale figure source");
        out.status = "stale";
    }
    if (strict && out.status === "confirmed") {
        const m = { ...(out.auto?.algorithmVersion === FIGURE_ALGORITHM ? out.auto : {}), ...out.override };
        const geometry = figureGeometry(m, m.heightBasis);
        if (geometry.reason) throw new Error("Invalid confirmed figure: " + geometry.reason);
    }
    return out;
}
function normalizeFigureExtension(raw, sources, model = false, strict = false) {
    if (raw == null) return undefined;
    if (!figureObject(raw) || JSON.stringify(raw).length > 65536) throw new Error("Invalid figure extension");
    // Unknown versions survive round-trips, but can never enter physical mode.
    if (raw.version !== 1) return JSON.parse(JSON.stringify(raw));
    if (model) return { version: 1, ...figureRecord(raw, sources, "modelRevision", strict) };
    if (!figureObject(raw.slots) || Object.keys(raw.slots).length > 32) throw new Error("Invalid figure slots");
    const slots = {};
    for (const [slot, record] of Object.entries(raw.slots)) {
        if (!/^[a-z][a-z0-9_-]{0,23}$/.test(slot)) throw new Error("Invalid figure slot");
        slots[slot] = figureRecord(record, sources?.[slot], "sourceSha", strict);
    }
    const defaults = {};
    if (raw.defaults) {
        const m = figureMetrics(raw.defaults);
        for (const key of ["posture", "crop"]) if (m[key]) defaults[key] = m[key];
    }
    return { version: 1, ...(Object.keys(defaults).length ? { defaults } : {}), slots };
}
function figurePatch(current, patch) {
    if (patch == null) return undefined;
    if (patch.version !== 1 || current?.version !== 1 || !patch.slots) return patch;
    const slots = { ...current.slots };
    for (const [key, value] of Object.entries(patch.slots)) { if (value === null) delete slots[key]; else slots[key] = value; }
    return { ...current, ...patch, slots };
}
function resolveFigureSizing(input = {}) {
    const legacy = reason => ({ mode: "legacy", reason, warnings: reason === "no-height" ? [] : [reason] });
    const { metrics: record, source, canvas, W, H } = input;
    // a pack figure without a height stands on the ruler like any other, at the height the
    // director's ruler already gives it (stage-asset-pack-director.js: heightCm ?? 150) - the same head as everyone else.
    const heightCm = input.heightCm ?? (input.pack ? FIGURE_DISPLAY.REF_MIN_CM : null);
    if (heightCm == null) return legacy("no-height");
    if (!figureNumber(heightCm, 1, 1000)) return legacy("invalid-height");
    if (input.version !== 1) return legacy("unknown-figure-version");
    if (!record || record.status !== "confirmed") return legacy("unconfirmed-metrics");
    if (!source || (record.sourceSha || record.modelRevision) !== source) return legacy("stale-source");
    if (!Array.isArray(canvas) || canvas.length !== 2 || !canvas.every(n => figureNumber(n, 1, 16384)) || String(canvas) !== String(record.canvas)) return legacy("canvas-mismatch");
    let m;
    try { m = figureMetrics({ ...(record.auto?.algorithmVersion === FIGURE_ALGORITHM ? record.auto : {}), ...record.override }); }
    catch (_) { return legacy("invalid-metrics"); }
    const geometry = figureGeometry(m, input.heightBasis || "standing");
    if (geometry.reason) return legacy(geometry.reason);
    if (!(W > 0 && H > 0 && Number.isFinite(W + H))) return legacy("invalid-stage");
    const assetScale = input.assetScale ?? 1, flip = input.flip ?? 1, elevation = input.elevationCm ?? 0;
    if (!figureNumber(assetScale, 0.25, 2) || !figureNumber(flip, -1, 1) || !figureNumber(elevation, 0, 500)) return legacy("invalid-placement");
    const hMax = input.sceneHMax ?? heightCm, c = FIGURE_DISPLAY;
    if (!figureNumber(hMax, 1, 1000) || input.groundHMax != null && !figureNumber(input.groundHMax, 1, 1000)) return legacy("invalid-scene-height");
    if ([input.sceneGroundRatio, input.groundRatio].some(r => r != null && !figureNumber(r, 0.001, 1000))) return legacy("invalid-placement");
    // a viewport fit shrinks the whole cast about the ruler's head line and may lower
    // it (fitDrop px) so a shrunk cast still stands behind the text box. Renderer-only input; the ruler is unchanged.
    // a skin's framing scales the same way (fit > 1 frames closer) and moves the
    // head line to fitTop px - one transform for the whole cast, so the ruler's relative heights stay.
    const fit = input.fit ?? 1, fitDrop = input.fitDrop ?? 0, fitTop = input.fitTop ?? H * c.HEAD_TOP, spread = input.spread ?? 1;
    if (!figureNumber(fit, 0.05, 6) || !figureNumber(fitDrop, 0, H) || !figureNumber(fitTop, -H, H) || !figureNumber(spread, 0.2, 1)) return legacy("invalid-placement");
    const fitY = fit === 1 && !fitDrop && fitTop === H * c.HEAD_TOP ? y => y : y => fitTop + (y - H * c.HEAD_TOP) * fit + fitDrop;
    const pxPerCm = figurePixelsPerCm(H, hMax) * fit;
    const displayCm = figureDisplayCm(heightCm, hMax, spread);
    const baseScale = displayCm * geometry.ratio * pxPerCm / geometry.bodySpan;
    const scale = baseScale * assetScale * (input.speaking ? 1.03 : 1);
    if (input.stageX != null && !Number.isFinite(input.stageX)) return legacy("invalid-placement");
    const sharedGroundY = fitY(figureGroundY(H, input.sceneGroundRatio));
    const headTop = m.headTop ?? m.faceRect?.[1], chin = m.chin ?? (m.faceRect && m.faceRect[1] + m.faceRect[3]);
    // choose the short figure's ground from REST, never speech/animation.
    // During a rescale use the locked destination ruler for the discrete ground decision.
    const restPx = figurePixelsPerCm(H, input.groundHMax ?? hMax) * fit;
    const restScale = figureDisplayCm(heightCm, input.groundHMax ?? hMax, spread) * geometry.ratio * restPx / geometry.bodySpan * assetScale;
    const restChin = fitY(figureGroundY(H, input.groundRatio ?? input.sceneGroundRatio)) - elevation * restPx - (geometry.feet - chin) * restScale;
    // keep the shared ground unless the REST chin needs a minimal lift.
    // 40px at 900px high; speech and camera safety remain renderer-owned.
    const faceMargin = H * (40 / 900);
    const groundLift = chin > headTop && Number.isFinite(input.occluderTop) ? Math.max(0, restChin - (input.occluderTop - faceMargin)) : 0;
    const ownGround = groundLift > 0;
    const groundY = sharedGroundY - groundLift;
    const support = { x: input.stageX ?? W / 2, y: groundY - elevation * pxPerCm };
    const supportX = m.supportX ?? canvas[0] / 2, x = support.x - supportX * scale * flip;
    const y = support.y - geometry.feet * scale;
    const warnings = [];
    if (displayCm > heightCm) warnings.push("small-figure-display-enlargement");
    if (assetScale !== 1) warnings.push("artistic-scale");
    if (canvas[0] * scale > W * 0.4) warnings.push("width-overflow");
    if (geometry.fraction < 1 && elevation > 0) warnings.push("exposed-crop");
    const restHead = chin > headTop ? { x: x + (m.faceRect ? m.faceRect[0] + m.faceRect[2] / 2 : canvas[0] / 2) * scale * flip, top: y + headTop * scale, chin: y + chin * scale, width: (m.faceRect ? m.faceRect[2] : chin - headTop) * scale } : null;
    if (restHead && Number.isFinite(input.occluderTop) && restHead.chin >= input.occluderTop) warnings.push("face-occluded");
    return { mode: "physical", heightCm, hMax, hRef: Math.max(hMax, c.REF_MIN_CM), displayCm, displayPx: displayCm * pxPerCm, effectivePxPerCm: displayCm * pxPerCm / heightCm, displayVersion: FIGURE_DISPLAY.version, scale, baseScale, x, y, support, supportX, feet: geometry.feet, restHead, restBounds: { top: y + m.figureTop * scale, bottom: y + Math.max(geometry.feet, m.visibleBottom) * scale }, pxPerCm, groundY, sharedGroundY, ownGround, poseSpan: geometry.bodySpan * scale, visibleSpan: geometry.span * scale, warnings };
}
function figureMixedWarning(results) { return results.some(r => r.mode === "physical") && results.some(r => r.mode !== "physical") ? ["mixed-uncalibrated-scene"] : []; }
function figureSlot(model, mood) {
    const images = model?.images || {};
    return images[mood] ? mood : "default";
}
function figureSource(url) { return String(url || "").match(/(?:\/|^)([a-f0-9]{64})\.webp(?:\?|$)/)?.[1] || ""; }
// Connected components reject isolated noise; the result remains ink, not anatomical truth.
function measureFigureAlpha(data, width, height, original = [width, height]) {
    const invalid = reason => ({ invalid: true, method: "alpha-components", algorithmVersion: FIGURE_ALGORITHM, confidence: 0, warnings: [reason] });
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4194304 || data?.length !== width * height * 4) return invalid("invalid-pixels");
    const mask = new Uint8Array(width * height), queue = new Int32Array(width * height);
    let count = 0, ink = [width, height, -1, -1];
    for (let i = 0; i < mask.length; i++) if (data[i * 4 + 3] >= 64) { mask[i] = 1; count++; const x = i % width, y = Math.floor(i / width); ink = [Math.min(ink[0], x), Math.min(ink[1], y), Math.max(ink[2], x), Math.max(ink[3], y)]; }
    if (!count) return invalid("transparent-image");
    if (count === mask.length) return invalid("opaque-background");
    const components = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) {
        let read = 0, end = 1, left = width, top = height, right = 0, bottom = 0;
        queue[0] = i; mask[i] = 0;
        while (read < end) {
            const p = queue[read++], x = p % width, y = Math.floor(p / width);
            left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
            for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) if (n >= 0 && mask[n]) { mask[n] = 0; queue[end++] = n; }
        }
        if (end >= Math.max(4, count * 0.001)) components.push({ count: end, bounds: [left, top, right, bottom] });
    }
    components.sort((a, b) => b.count - a.count);
    if (!components.length || components[0].count < 16) return invalid("tiny-bounds");
    const b = components[0].bounds, sx = original[0] / width, sy = original[1] / height;
    const rect = a => [a[0] * sx, a[1] * sy, (a[2] - a[0] + 1) * sx, (a[3] - a[1] + 1) * sy];
    let edgeRows = 0;
    for (let y = Math.max(0, height - 4); y < height; y++) {
        let run = 0, longest = 0;
        for (let x = 0; x < width; x++) { run = data[(y * width + x) * 4 + 3] >= 64 ? run + 1 : 0; longest = Math.max(longest, run); }
        if (longest >= Math.max(2, (b[2] - b[0] + 1) * 0.08)) edgeRows++;
    }
    const warnings = ["ink-not-anatomy"];
    if (components[1]?.count > components[0].count * 0.08) warnings.push("multiple-components");
    if ((b[2] - b[0]) > (b[3] - b[1]) * 1.8) warnings.push("wide-ink-or-shadow");
    if (edgeRows) warnings.push("bottom-edge-contact");
    return { method: "alpha-components", algorithmVersion: FIGURE_ALGORITHM, confidence: warnings.length > 1 ? 0.3 : 0.6, inkBounds: rect(ink), bodyBounds: rect(b), figureTop: b[1] * sy, visibleBottom: (b[3] + 1) * sy, supportX: (b[0] + b[2] + 1) * sx / 2, cropSuspected: edgeRows > 0, warnings };
}
// Pack anatomy is canvas-normalized, including virtual support below the image.
function packAnatomy(metrics, canvas, heightBasis = "standing", source = "calibrated", assetScale = 1) {
    const g = figureGeometry(metrics, heightBasis);
    if (g.reason) throw new Error("Invalid pack anatomy: " + g.reason);
    const out = { source, posture: metrics.posture, crop: metrics.crop, poseHeightRatio: g.ratio, assetScale };
    for (const key of ["figureTop", "headTop", "chin", "visibleBottom"]) if (metrics[key] != null) out[key] = metrics[key] / canvas[1];
    out.headTop ??= (metrics.faceRect?.[1] ?? metrics.figureTop) / canvas[1];
    out.chin ??= metrics.faceRect ? (metrics.faceRect[1] + metrics.faceRect[3]) / canvas[1] : out.headTop + (g.bodySpan / canvas[1]) * figureHeadShare(heightBasis);
    if (metrics.cheeks) out.cheeks = { left: metrics.cheeks.left.map((v, i) => v / canvas[i]), right: metrics.cheeks.right.map((v, i) => v / canvas[i]), size: metrics.cheeks.size / canvas[1] };
    if (metrics.faceRect) out.faceRect = metrics.faceRect.map((v, i) => v / canvas[i % 2]);
    for (const key of ["visibleFraction", "headsPerBody"]) if (metrics[key] != null) out[key] = metrics[key];
    out.feet = g.feet / canvas[1];
    out.supportX = (metrics.supportX ?? canvas[0] / 2) / canvas[0];
    out.headRatio = (g.feet - (metrics.headTop ?? metrics.faceRect?.[1] ?? metrics.figureTop)) / g.bodySpan * g.ratio * assetScale;
    return out;
}
function packEstimatedAnatomy(metrics, canvas, heightBasis = "standing") {
    if (!metrics || metrics.invalid) return null;
    const top = metrics.figureTop, bottom = metrics.visibleBottom;
    // Same explicit estimates as the pre-refactor calibration: seated mascot or 6.5 heads.
    return packAnatomy({...metrics, headTop: top, chin: top + (bottom - top) * figureHeadShare(heightBasis),
        feet: bottom, posture: heightBasis, heightBasis, crop: "full", poseHeightRatio: 1}, canvas, heightBasis, "estimated");
}
// The reference body's head (hair → chin) as a share of its height: 6.5 heads standing; a seated mascot's head is 65% of it.
function figureHeadShare(heightBasis) { return heightBasis === "seated" ? 0.65 : 1 / 6.5; }
// An anatomy whose head only restates its body - estimated from the picture's bounds, or headTop = figureTop with one head
// of headsPerBody - knows neither where the head is nor how long the body really is.
function figureDerivedHead(a) {
    const per = Number(a.headsPerBody), feet = Number.isFinite(a.feet) ? a.feet : a.visibleBottom;
    return a.source === "estimated" || (per > 0 && Number.isFinite(feet) && Number.isFinite(a.figureTop) && Math.abs(a.headTop - a.figureTop) < 0.002 && Math.abs((a.chin - a.headTop) - (feet - a.figureTop) / per) < 0.004);
}
// Feet below the drawn picture are a virtual support, not a measurement . Only an anatomy whose head is located and whose feet are drawn knows the body
// (or one this rule already sized by its head).
function figureKnowsBody(a) {
    return a.source === "head" || !figureDerivedHead(a) && !(Number.isFinite(a.feet) && Number.isFinite(a.visibleBottom) && a.feet > a.visibleBottom + 0.01);
}
// every pack figure is sized by its HEAD on one ruler. A body the
// pack does not really know (no anatomy, an estimated one, a head derived from the body) is the longer of what is drawn
// and figureHeadShare heads of the figure's measured head - `input.head` {top, chin}, canvas fractions: a sprite's
// avatar crop, a Live2D model's head hit area. A cut picture  gets its
// feet virtual below the frame, so its head matches a full-length figure's; a full-length picture keeps the drawn
// figure as its body (the bounds estimate) - a head box that would make it longer than 6.5 heads is not trusted (a
// tight crop under long hair). A calibrated anatomy with a real head and real feet keeps its proportions (a chibi stays
// a chibi).
function packFigureAnatomy(input, canvas, candidate) {
    const anatomy = input.anatomy, head = input.head, basis = input.heightBasis || "standing";
    const drawn = () => anatomy || packEstimatedAnatomy(candidate?.auto, canvas, basis);
    if (anatomy && figureKnowsBody(anatomy) || !(head?.chin > head?.top)) return drawn();
    const auto = candidate?.auto && !candidate.auto.invalid ? candidate.auto : null;
    const visibleBottom = anatomy?.visibleBottom ?? (auto ? auto.visibleBottom / canvas[1] : 1);
    const feet = head.top + (head.chin - head.top) / figureHeadShare(basis);
    if (feet <= visibleBottom) return drawn();
    return { source: "head", posture: basis, crop: "custom", poseHeightRatio: 1, assetScale: anatomy?.assetScale ?? 1,
        figureTop: head.top, headTop: head.top, chin: head.chin, visibleBottom, feet, supportX: anatomy?.supportX ?? (auto ? auto.supportX / canvas[0] : 0.5), headRatio: 1,
        ...(anatomy?.cheeks ? { cheeks: anatomy.cheeks } : {}) };
}
function packFigureRecord(input, canvas, candidate) {
    const anatomy = packFigureAnatomy(input, canvas, candidate);
    if (!anatomy) return candidate;
    const m = {...anatomy, heightBasis: input.heightBasis || "standing"};
    for (const key of ["figureTop", "headTop", "chin", "feet", "visibleBottom"]) if (m[key] != null) m[key] *= canvas[1];
    m.supportX *= canvas[0];
    if (m.cheeks) m.cheeks = { left: m.cheeks.left.map((v, i) => v * canvas[i]), right: m.cheeks.right.map((v, i) => v * canvas[i]), size: m.cheeks.size * canvas[1] };
    if (m.faceRect) m.faceRect = m.faceRect.map((v, i) => v * canvas[i % 2]);
    return {sourceSha: input.source, canvas, status: "confirmed", override: m};
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { packAnatomy, packEstimatedAnatomy, packFigureAnatomy, packFigureRecord, figureHeadShare, figureDerivedHead, figureKnowsBody, FIGURE_ALGORITHM, FIGURE_DISPLAY, figurePixelsPerCm, figureGroundY, figureInput, figureCatalog, figureDirection, figureCarry, figureSceneCut, figureRatio, figureDisplayCm, figureSceneFrame, figureSceneUpdate, figureCharacter, figureMetrics, figureGeometry, normalizeFigureExtension, figurePatch, resolveFigureSizing, figureMixedWarning, figureSlot, figureSource, measureFigureAlpha };
