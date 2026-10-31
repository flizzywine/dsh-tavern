// Scene helpers: pure functions of the galgame scene (gal-scene.js includes this source inside its module factory;
// Node tests require it). Runtime neighbours (motion layers, idle desync, stage reading) are read only when called.
function galFigureRects(figures, camera, W, H) {
    if (!camera) return [];
    const c = Math.cos(camera.rotation || 0), s = Math.sin(camera.rotation || 0), z = camera.zoom || 1;
    function project(rect, shift) {
        const points = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]].map(([x, y]) => {
            x -= camera.fx * W; y += shift - camera.fy * H;
            return { x: camera.ax * W + z * (c * x - s * y), y: camera.ay * H + z * (s * x + c * y) };
        });
        const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
        return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y };
    }
    return figures.filter(f => f.visible && f.body && f.head).map(f => ({ id: f.id,
        body: project(f.body, f.shift || 0), head: project({ x: f.head.x - f.head.width / 2, y: f.head.top, width: f.head.width, height: f.head.chin - f.head.top }, f.shift || 0) }));
}
// under a close-up, a non-subject figure left mostly outside the frame (a sliver at the
// edge) fades out instead of reading as a framing error. Fully visible figures stay.
function galCropHidden(body, camera, W, H, minVisible = 0.75) {
    if (!body || !camera || !(body.width > 0)) return false;
    const [rect] = galFigureRects([{ id: "", visible: true, body, head: { x: body.x + body.width / 2, width: 1, top: body.y, chin: body.y + 1 } }], camera, W, H);
    const visible = Math.max(0, Math.min(W, rect.body.x + rect.body.width) - Math.max(0, rect.body.x));
    return visible / rect.body.width < minVisible;
}

// where a figure's body sits across its own picture (canvas / model px):
// the calibrated support, else the measured candidate's; null when neither knows (the caller measures the picture).
function galBodyX(record, candidate) {
    const m = { ...candidate?.auto, ...record?.auto, ...record?.override };
    return Number.isFinite(m.supportX) ? m.supportX : null;
}
// The drawn body centres (stage-width fractions under the settled camera) are sampled four times a second. A figure is
// settled when two samples agree within 1% of the width, and its reported place moves only when a settled place moves by
// 1% or more: walking in, a gesture or idle sway never reach the box, a new standing place does, once. null = unchanged.
function galBodyReport(shown, last, now, tolerance = 0.01) {
    const next = {};
    let changed = Object.keys(shown || {}).some(id => !(id in now));
    for (const id in now) {
        const old = shown?.[id], settled = last?.[id] != null && Math.abs(last[id] - now[id]) < tolerance;
        if (settled && (old == null || Math.abs(old - now[id]) >= tolerance)) { next[id] = now[id]; changed = true; }
        else if (old != null) next[id] = old;
    }
    return changed ? next : null;
}
function sceneFigureScale() {
    return typeof FIGURE_DISPLAY !== 'undefined' ? {FIGURE_DISPLAY, figureDisplayCm, figurePixelsPerCm, figureGroundY} : require('../../packages/dsh-presentation-protocol/src/figure-scale.cjs');
}
function galFrameRate(quality, animated, refreshRate, frameCap = 60) {
    const display = Number.isFinite(refreshRate) && refreshRate > 0 ? refreshRate : Infinity;
    const cap = [0, 30, 60, 120].includes(frameCap) ? frameCap : 60;
    if (quality === "low" || !animated) return Math.min(display, 30);
    // Zero bypasses software pacing: requestAnimationFrame follows the actual display refresh.
    return cap === 0 ? 0 : Math.min(display, cap);
}
// Round to the nearest available vsync without Pixi 6's integer-ms truncation/drift.
function galFrameDue(pace, now, fps) {
    const gap = now - pace.last;
    pace.last = now;
    if (gap > 0 && gap < 50) pace.vsync = pace.vsync ? Math.min(pace.vsync * 0.95 + gap * 0.05, gap * 1.1) : gap;
    if (fps === 0) { pace.fps = 0; pace.next = now; return true; }
    const period = 1000 / fps, tolerance = Math.min(period * 0.45, (pace.vsync || 0) / 2);
    if (pace.fps !== fps || now - pace.next > period * 2) { pace.fps = fps; pace.next = now; }
    if (now + tolerance < pace.next) return false;
    pace.next += period;
    return true;
}
// URL ownership spans scene instances and in-flight loads (outfit crossfades can share a cache entry).
function galTextureOwners() {
    const records = new Map();
    let pending = 0;
    function sweep() {
        if (pending) return;
        records.forEach((record, key) => {
            if (record.count) return;
            records.delete(key);
            const bases = new Set();
            record.textures.forEach(texture => { if (texture.baseTexture) bases.add(texture.baseTexture); texture.destroy(false); });
            bases.forEach(base => { if (!base.destroyed) base.destroy(); });
        });
    }
    return {
        begin() { pending++; },
        end() { pending--; sweep(); },
        retain(textures) {
            const keys = new Set();
            (textures || []).forEach(texture => {
                const base = texture.baseTexture, resource = base && base.resource;
                const key = resource && (resource.url || resource.source && resource.source.src) || base || texture;
                let record = records.get(key);
                if (!record) { record = { count: 0, textures: new Set() }; records.set(key, record); }
                record.textures.add(texture);
                if (!keys.has(key)) { record.count++; keys.add(key); }
            });
            let released = false;
            return () => { if (released) return; released = true; keys.forEach(key => records.get(key).count--); sweep(); };
        }
    };
}
// A line token changes only on paging, not on typing/audio rerenders. Consume blocked attempts
// too: finishing a higher-priority act must not start a delayed mood motion halfway into a line.
function galMoodMotionPlan(previous, figure, groups, now, random, suppressed = false) {
    const state = previous || { line: null, mood: null, lastAt: -Infinity };
    const line = figure.visible !== false && figure.speaking ? figure.moodLine : null;
    if (line == null) return { state: Object.assign({}, state, { line: null, waiting: false }), motion: null };
    const mood = figure.mood || "calm", changed = mood !== state.mood;
    const fresh = line !== state.line || changed, pending = !fresh && state.waiting;
    if (!fresh && !pending) return { state, motion: null };
    const next = { line, mood, lastAt: state.lastAt, lineAt: fresh ? now : state.lineAt, waiting: false };
    // history/skip keeps expressions, but consumes rather than replays mood gestures.
    if (suppressed) return { state: next, motion: null };
    // pack outfits name their gesture (emotionMap motion, projected as moodMotion; null = none)
    // and play it once per emotion change; card models keep Mood_<id> with the 8 s repeat.
    const explicit = figure.moodMotion !== undefined;
    const group = explicit ? figure.moodMotion : "Mood_" + mood, clips = group && groups && groups[group];
    if (!Array.isArray(clips) || !clips.length || (!pending && !changed && (explicit || now - state.lastAt < 8000))) return { state: next, motion: null };
    // Expressions change immediately; only the gesture waits for the matching line's voice.
    if (figure.voiced && !figure.voiceStarted && now - next.lineAt < 1200) {
        next.waiting = true;
        return { state: next, motion: null };
    }
    next.lastAt = now;
    return { state: next, motion: { group, index: Math.min(clips.length - 1, Math.floor((random == null ? 0 : random) * clips.length)), priority: 2 } };
}
function galPlayMoodMotion(entry, figure, now, suppressed) {
    const internal = entry.model.internalModel, manager = internal.motionManager;
    const groups = internal.settings.motions, group = figure.moodMotion;
    // Sustained poses are appearance, not historical one-shots; they also apply to listeners. A looping pose repeats its
    // clip; a held pose (ForkStageHold) plays its gesture once when the emotion changes and keeps the last frame.
    const declared = groups?.[group]?.[0];
    const loop = figure.visible !== false && (declared?.ForkStageLoop === true || declared?.ForkStageHold === true);
    if (loop) {
        const layers = manager?.forkMotionLayers;
        if (layers?.gesture?.priority > 2 || layers?.pending?.priority > 2) { if (entry.loopMoodGroup) entry.loopMoodResume = true; entry.loopMoodGroup = null; return; }
        if (entry.loopMoodGroup !== group) {
            // History, skips, reduced motion and the return after a preempting act land on the held pose without replaying it.
            if (suppressed || entry.reducedMotion || entry.loopMoodResume) manager?.settleMoodMotion?.();
            entry.loopMoodGroup = group; entry.loopMoodResume = false;
            Promise.resolve(entry.model.motion(group, 0, 2)).catch(error => console.warn("[fork-gal-scene] mood loop failed", error));
        }
        return;
    }
    entry.loopMoodResume = false;
    if (entry.loopMoodGroup) { manager?.stopMoodMotion?.(); entry.loopMoodGroup = null; }
    const plan = galMoodMotionPlan(entry.moodMotion, figure, groups, now, Math.random(), suppressed || entry.reducedMotion);
    entry.moodMotion = plan.state;
    if (plan.motion) {
        const motion = plan.motion;
        // NORMAL (2) can crossfade another mood, but cannot interrupt a FORCE director act.
        Promise.resolve(entry.model.motion(motion.group, motion.index, motion.priority)).catch(error => console.warn("[fork-gal-scene] mood motion failed", error));
    }
}
function galMotionFade(seconds) { return Number.isFinite(seconds) && seconds >= 0.45 ? seconds : 0.45; }
function galMotionTransitions(internal) { stageViews.figureMotion.install(internal); }
function galShouldBlink(eyeOpen) { return !Number.isFinite(eyeOpen) || eyeOpen >= 0.2; }
function forkGalOwnBlink(internal, seconds) {
    const blink = internal.eyeBlink;
    if (!blink) return;
    // Layered motion/springs -> blink -> saveParameters -> expressions -> physics -> lip sync.
    internal.eyeBlink = undefined;
    const ids = blink.getParameterIds();
    internal.on("afterMotionUpdate", function () {
        const core = internal.coreModel, open = ids.map(id => core.getParameterValueById(id));
        // Advance the blink clock even under a closed-eye pose; never force that pose open.
        blink.updateParameters(core, seconds());
        ids.forEach((id, i) => core.setParameterValueById(id, galShouldBlink(open[i]) ? Math.min(open[i], core.getParameterValueById(id)) : open[i]));
    });
}
// the one Live2D idle, shared by the stage and the figure editor's preview — layered motions (the Idle group
// loops uninterrupted, 开场动作 gestures blend over it), the blink running under it, and the Idle group started. The
// import dialog names the chosen 待机 group Idle. seconds(): the blink clock (default: the motion layers' own step).
// jitter (stage figures, galIdleJitter): this figure's own idle phase — which Idle clip it starts on, where in that
// clip, its breath phase / period and blink interval — so figures loaded together never idle in lockstep.
function live2dStartIdle(model, seconds, jitter) {
    const internal = model.internalModel, groups = internal.settings.motions || {};
    galMotionTransitions(internal);
    const layers = internal.motionManager.forkMotionLayers;
    stageViews.figureIdle.galLive2dDesync(internal, jitter);
    forkGalOwnBlink(internal, seconds || (() => layers ? layers.dt : 0));
    const idle = Object.keys(groups).find(name => /^idle$/i.test(name));
    if (!idle) return;
    const count = Array.isArray(groups[idle]) ? groups[idle].length : 0;
    const index = jitter && count > 1 ? Math.min(count - 1, Math.floor(jitter.pick * count)) : 0;
    if (jitter && layers) layers.idleLead = jitter.offset;
    internal.motionManager.groups.idle = idle; model.motion(idle, index, 1);
}
// Mesh points are Cubism units (Y up), not model canvas pixels. The caller supplies
// the complete affine transform into the emote layer, excluding the shared camera.
function galMeshHead(arrays, transform, rotation) {
    const angle = rotation || 0, c = Math.cos(angle), s = Math.sin(angle);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const vertices of arrays) for (let i = 0; i + 1 < vertices.length; i += 2) {
        const x = transform.a * vertices[i] + transform.c * vertices[i + 1] + transform.tx;
        const y = transform.b * vertices[i] + transform.d * vertices[i + 1] + transform.ty;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const u = c * x + s * y, v = -s * x + c * y;
        left = Math.min(left, u); right = Math.max(right, u); top = Math.min(top, v); bottom = Math.max(bottom, v);
    }
    if (!(right > left && bottom > top)) return null;
    const u = (left + right) / 2, v = (top + bottom) / 2, y = s * u + c * v, h = bottom - top;
    return { x: c * u - s * v, top: y - h / 2, chin: y + h / 2, width: right - left, rotation: angle };
}
function galFaceDrawables(ids, parts, parents) {
    // Older converted MOCs can expose invalid parent indices. Do not interpret those
    // as Parts: some models provide an explicitly named, deforming head hit mesh.
    const head = ids.findIndex(id => /^(?:HitAreaHead|HeadHitArea)$/i.test(id));
    if (head >= 0) return [head];
    const validParents = parents && parents.length === ids.length && Array.from(parents).every(i => i >= -1 && i < parts.length);
    const labels = ids.map((id, i) => id + " " + (validParents && parts[parents[i]] || ""));
    let indices = labels.map((label, i) => /face/i.test(label) ? i : -1).filter(i => i >= 0);
    if (!indices.length) indices = labels.map((label, i) => /cheek|eye|mouth/i.test(label) ? i : -1).filter(i => i >= 0);
    return indices;
}
function galCheekIndex(core) {
    const index = core.getParameterIndex("ParamCheek");
    // Cubism allocates a virtual index for unknown IDs instead of returning -1.
    return index >= 0 && index < core.getParameterCount() ? index : -1;
}
// shyness blushes with the model's own ParamCheek, driven by
// the emotion (emotion -> expression / param), never by a manpu. An expression that already raises the cheek keeps its
// own value; otherwise (unmapped, or an expression that leaves it at rest or lowers it) the cheek eases to its maximum.
function galCheekValue(current, amount, rest, max) {
    if (!(amount > 0) || current > rest + 0.05) return current;
    return rest + (max - rest) * Math.min(1, amount);
}
// The shy blush's envelope: eases to the figure's target over .35 s (in) / .5 s (out); snaps under 减少动态.
function galBlushStep(amount, target, dt, reduced) {
    if (reduced) return target;
    const rate = dt / (target > amount ? 0.35 : 0.5);
    return target > amount ? Math.min(target, amount + rate) : Math.max(target, amount - rate);
}
function galFlushFace(model) {
    // pixi-live2d-display defers model.update() until _render. Consume that queued
    // CPU update before sampling vertices; _render then draws without advancing twice.
    if (model.deltaTime) {
        model.internalModel.update(model.deltaTime, model.elapsedTime);
        model.deltaTime = 0;
    }
}
function galInitFace(model) {
    const im = model.internalModel, core = im.coreModel, raw = core.getModel ? core.getModel() : core._model;
    const indices = galFaceDrawables(core.getDrawableIds(), raw && raw.parts.ids || [], raw && raw.drawables.parentPartIndices);
    return { indices, reference: indices.map(i => core.getDrawableVertices(i).slice()), cheek: galCheekIndex(core) };
}
// Least-squares rigid rotation of the same vertices, independent of face translation.
// Unlike eye bounding boxes this stays stable while blinking or changing expression.
function galMeshRotation(reference, arrays) {
    let ax = 0, ay = 0, bx = 0, by = 0, n = 0;
    for (let j = 0; j < arrays.length; j++) for (let i = 0; i < arrays[j].length; i += 2) {
        ax += reference[j][i]; ay += reference[j][i + 1]; bx += arrays[j][i]; by += arrays[j][i + 1]; n++;
    }
    if (!n) return 0;
    ax /= n; ay /= n; bx /= n; by /= n;
    let dot = 0, cross = 0;
    for (let j = 0; j < arrays.length; j++) for (let i = 0; i < arrays[j].length; i += 2) {
        const x = reference[j][i] - ax, y = reference[j][i + 1] - ay;
        const u = arrays[j][i] - bx, v = arrays[j][i + 1] - by;
        dot += x * u + y * v; cross += x * v - y * u;
    }
    return Math.atan2(cross, dot);
}
function galFallbackHead(head, params) {
    const h = head.chin - head.top, p = params || {};
    const rotation = -((p.ParamAngleZ || 0) + (p.ParamBodyAngleZ || 0) * 0.7) * Math.PI / 180;
    const pivot = head.chin + h * 0.12, dy = (head.top + head.chin) / 2 - pivot;
    const x = head.x - Math.sin(rotation) * dy + head.width * ((p.ParamAngleX || 0) * 0.12 + (p.ParamBodyAngleX || 0) * 0.2) / 30;
    const y = pivot + Math.cos(rotation) * dy - h * (p.ParamAngleY || 0) / 30 * 0.08;
    return { x, top: y - h / 2, chin: y + h / 2, width: head.width, rotation };
}
function galDisplayMatrix(display, target, local) {
    const point = (x, y) => target.toLocal(display.toGlobal({ x: local.a * x + local.c * y + local.tx, y: local.b * x + local.d * y + local.ty }));
    const o = point(0, 0), x = point(1, 0), y = point(0, 1);
    return { a: x.x - o.x, b: x.y - o.y, c: y.x - o.x, d: y.y - o.y, tx: o.x, ty: o.y };
}
function galSmoothHead(face, head, now) {
    const keys = ["x", "top", "chin", "width", "rotation"], dt = Math.max(0, Math.min(0.05, (now - face.at) / 1000));
    if (!face.spring) face.spring = Object.fromEntries(keys.map(key => [key, galSpringValue(head[key] || 0)]));
    else if (dt > 0) keys.forEach(key => galSpring(face.spring[key], head[key] || 0, 100, dt));
    face.at = now;
    return Object.fromEntries(keys.map(key => [key, face.spring[key].v]));
}
function galLipSyncIds(settings) {
    const groups = settings && settings.json && settings.json.Groups || [];
    const ids = groups.filter(group => group.Target === "Parameter" && group.Name === "LipSync").flatMap(group => group.Ids || []);
    return ids.length ? ids : ["ParamMouthOpenY"];
}
function galApplyLipSync(core, ids, entry) {
    if (entry.mouthActive) ids.forEach(id => core.setParameterValueById(id, entry.mouth));
}
// Director head moves (gaze, nod/shake/bow acts) are offsets on the model's own pose, like Cubism's look-at: idle and
// gesture head motion keep playing while a figure looks aside. Applied on afterMotionUpdate, i.e. before physics, so the
// inputs the model's physics3 declares (head angles driving hair, ribbons) follow them. The core clamps to the model's range.
function galApplyStageHead(core, look, param) {
    const p = param || {}, x = look * 20 + (p.angleX || 0);
    if (x) core.addParameterValueById("ParamAngleX", x);
    if (look) core.addParameterValueById("ParamEyeBallX", look * 0.8);
    if (p.angleY) core.addParameterValueById("ParamAngleY", p.angleY);
}
const galEase = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    inOutSine: t => (1 - Math.cos(Math.PI * t)) / 2
};
function galClamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
// Critically damped spring, exact for any time step: starts smoothly, never overshoots from rest and
// keeps its velocity when the target changes mid-move. s = { v: value, d: velocity }; dt in seconds.
function galSpring(s, target, omega, dt) {
    const x = s.v - target, e = Math.exp(-omega * dt), temp = (s.d + omega * x) * dt;
    s.v = target + (x + temp) * e;
    s.d = (s.d - omega * temp) * e;
    if (Math.abs(s.v - target) < 1e-5 && Math.abs(s.d) < 1e-4) { s.v = target; s.d = 0; }
    return s.v;
}
function galSpringValue(v) { return { v, d: 0 }; }
// A timed move between two values (camera push, grade): { from, to, start, duration, ease }.
function galTween(from, to, start, duration, ease) { return { from, to, start, duration: Math.max(0, duration), ease: ease || "inOutCubic" }; }
function galTweenAt(tween, now) {
    if (!tween) return 0;
    const t = tween.duration > 0 ? galClamp01((now - tween.start) / tween.duration) : 1;
    return tween.from + (tween.to - tween.from) * galEase[tween.ease](t);
}
// Cover-fit of a picture to the screen (overscan > 1 leaves room for camera shake).
// the scene's call view from the phone call's video state
// (phone-call.js video()): the page's boxes ({role, rect, radius, head} fractions of its frame), each with the party's
// stage figure as a scene figure kept off stage (key call:<role>, never laid out, tapped or ranked). Her mouth follows the call's
// voice; the player's figure never talks. `inputs` is packFigureRenderInputs (the stage's one figure → render input mapping).
function galCallView(video, inputs, { skipping = false, sessionId } = {}) {
    const party = (role, figure, audio) => {
        const input = figure ? inputs(figure, { audio, speaking: Boolean(audio), skipping, voiceKey: "facetime:" + role, sessionId }).stage : null;
        return input ? { ...input, key: "call:" + role, alias: figure.alias, offstage: true, x: 0.5, visible: true, enter: "none", exit: "none", shade: 1, speaking: Boolean(audio),
            figureSizing: { pack: true, heightCm: figure.heightCm, version: 1, source: figure.geometry?.stage, sourceUrl: input.src, heightBasis: figure.heightBasis, outfitKey: figure.outfitKey,
                anatomy: figure.anatomy, head: figure.head, assetScale: figure.anatomy?.assetScale ?? 1, elevationCm: figure.elevationCm } } : null;
    };
    return { frame: video.layout.frame, backdrop: video.layout.backdrop, glass: video.layout.glass || null, frozen: video.frozen === true,
        views: video.layout.views.map(view => ({ ...view, figure: view.role === "remote" ? party("remote", video.remote, video.audio) : party("self", video.self, null) })) };
}
function galCover(texW, texH, W, H, overscan) {
    const scale = Math.max(W / (texW || 1), H / (texH || 1)) * (overscan || 1);
    return { scale, x: (W - texW * scale) / 2, y: (H - texH * scale) / 2 };
}

// Background transitions. The director may pick one per scene change later; the default is a cross-fade.
// blink: two eyelids close (.18 s), stay shut (.08 s) and open (.22 s); a skin's out / hold / in retime it.
// slash: four slanted bars sweep in from the right one after another, the picture changes behind them, they
// sweep on out to the left (.5 s).
const GAL_TRANSITIONS = { cut: 0, fade: 600, black: 1200, white: 1000, wipe: 900, iris: 1000, blink: 480, slash: 500 };
// decoded RGBA bytes of off-stage figure textures kept for this round (pruneTextures).
const GAL_TEXTURE_KEEP_BYTES = 256 * 1024 * 1024;
function galBackgroundTransition(kind, desc, previous) {
    const background = desc.background || {};
    const plan = galTransitionPlan(kind, { skipping: desc.skipping, first: !previous, direction: background.direction, timing: background.timing, reducedMotion: desc.reducedMotion === true });
    if (!desc.snap && previous && background.scene && previous.scene === background.scene && desc.timeFadeMs === 2500) {
        return { ...plan, kind: "fade", duration: 2500 };
    }
    return plan;
}
function galTransitionPlan(kind, options) {
    options = options || {};
    let name = Object.prototype.hasOwnProperty.call(GAL_TRANSITIONS, kind) ? kind : "fade";
    // The very first picture rises out of the dark stage; skipping pages keeps changes short and plain.
    if (options.first && name !== "cut") name = "fade";
    let duration = GAL_TRANSITIONS[name];
    if (options.skipping && name !== "cut") { name = "fade"; duration = 180; }
    // 减少动态 (stage-effects.md): a moving wipe / iris becomes a 300 ms fade; black / white covers stay.
    if (options.reducedMotion && (name === "wipe" || name === "iris" || name === "blink" || name === "slash")) { name = "fade"; duration = 300; }
    const plan = { kind: name, duration, direction: options.direction === "right" ? "right" : "left" };
    // a resolved black / white change with its own linear out, hold and in
    // (s; a skin's effects.transition); split = where the cover is full and where it starts to lift.
    const timing = options.timing;
    if (name === "blink") Object.assign(plan, { split: [0.375, 0.542] });
    if (name === "slash") Object.assign(plan, { split: [0.44, 0.56] });
    if (timing && (name === "black" || name === "white" || name === "blink" || name === "slash") && typeof timing.out === "number" && typeof timing.in === "number") {
        const out = 1000 * (timing.out ?? 0.4), hold = 1000 * (timing.hold ?? 0), back = 1000 * (timing.in ?? 0.4), total = out + hold + back;
        if (total > 0) Object.assign(plan, { duration: total, split: [out / total, (out + hold) / total], linear: true });
    }
    return plan;
}
// State of a transition at t (0..1): incoming layer alpha, full-screen cover (black/white), mask progress
// (wipe/iris, -1 = no mask). When done the incoming layer is plain and the layers below can go.
function galTransitionFrame(plan, t) {
    const p = plan.duration > 0 ? galClamp01(t) : 1;
    const frame = { incoming: 1, cover: 0, color: 0x000000, mask: -1, lids: 0, bars: 0, out: false, done: p >= 1 };
    if (frame.done) return frame;
    if (plan.kind === "fade") frame.incoming = galEase.inOutSine(p);
    else if (plan.kind === "blink") {
        // lids: how far the eyelids have closed (1 = shut); the picture swaps while they are shut
        const [shut, open] = plan.split;
        frame.lids = p < shut ? galEase.inOutSine(p / shut) : p < open ? 1 : galEase.inOutSine(1 - (p - open) / (1 - open));
        frame.incoming = p < shut ? 0 : 1;
    } else if (plan.kind === "slash") {
        // bars: how far the bars cover the stage (1 = all in); out: they leave to the left
        const [shut, open] = plan.split;
        frame.bars = p < shut ? p / shut : p < open ? 1 : 1 - (p - open) / (1 - open);
        frame.out = p >= open; frame.incoming = p < shut ? 0 : 1;
    }
    else if (plan.kind === "black" || plan.kind === "white") {
        const out = plan.split ? plan.split[0] : plan.kind === "black" ? 0.42 : 0.36, hold = plan.split ? plan.split[1] : plan.kind === "black" ? 0.58 : 0.46;
        const curve = plan.linear ? v => v : galEase.inOutSine;
        frame.color = plan.kind === "black" ? 0x000000 : 0xffffff;
        frame.cover = p < out ? curve(p / out) : p < hold ? 1 : hold >= 1 ? 1 : curve(1 - (p - hold) / (1 - hold));
        frame.incoming = p < out ? 0 : 1; // swapped under the full cover
    } else if (plan.kind === "wipe" || plan.kind === "iris") frame.mask = galEase.inOutCubic(p);
    return frame;
}
// The blink's two eyelids at closure c (0 open .. 1 shut) on a W x H stage, as flat polygons: each lid's edge an arc, the
// opening an almond (an eye's: its corners close first, its middle last), meeting straight across the middle when shut. Pure.
function galBlinkLids(c, W, H) {
    const steps = 24, mid = H / 2, reach = c * mid, lift = (1 - c) * H * 0.22, lids = [[], []];
    for (let i = 0; i <= steps; i++) {
        const x = (W * i) / steps, u = (2 * i) / steps - 1, edge = reach - lift * (1 - u * u);
        lids[0].push(x, Math.max(0, edge) + 0.5);
        lids[1].push(x, Math.min(H, H - edge) - 0.5);
    }
    lids[0].push(W, 0, 0, 0); lids[1].push(W, H, 0, H);
    return lids;
}
// The slash's four bars at cover c (0 none .. 1 all in) on a W x H stage: parallelograms slanted by a third of H, each
// sliding in from the right a fifth of the way after the one before (out: on to the left, the last in the first out). Pure.
function galSlashBars(c, W, H, out) {
    const slant = H * 0.35, step = 0.2, travel = W + slant + 4, bars = [];
    for (let k = 0; k < 4; k++) {
        const t = Math.max(0, Math.min(1, c * (1 + 3 * step) - (out ? 3 - k : k) * step)), shift = (1 - t) * travel * (out ? -1 : 1);
        if (t <= 0) continue;
        const a = (k * W) / 4 - slant - 2 + shift, b = ((k + 1) * W) / 4 + 2 + shift;
        bars.push([a + slant, 0, b + slant, 0, b, H, a, H]);
    }
    return bars;
}
// switch scale only while the existing scene transition conceals the figures.
// Black/white already cover the whole stage; the other transitions fade the figure layer at the cut.
function galFigureCutFrame(plan, progress) {
    if (!plan || plan.kind === "cut" || progress >= 1) return { swap: true, alpha: 1 };
    if (plan.kind === "black" || plan.kind === "white" || plan.kind === "blink" || plan.kind === "slash") return { swap: galTransitionFrame(plan, progress).incoming === 1, alpha: 1 };
    const p = galClamp01(progress);
    return { swap: p >= 0.5, alpha: Math.abs(2 * p - 1) };
}
// Wipe mask: a white strip (opaque part = screen width, then a soft edge of soft × width) slides across.
function galWipeRect(progress, W, soft, direction) {
    const width = W * (1 + soft), x = -width * (1 - progress);
    return direction === "right" ? { x: W - x, width, flip: -1 } : { x, width, flip: 1 };
}
// Iris mask: a soft disc (opaque up to inner × radius) centred at (cx, cy) growing until it covers the screen.
function galIrisSize(progress, W, H, cx, cy, inner) {
    const reach = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    return progress * 2 * reach / (inner || 1);
}

// Colour matrices (pixi ColorMatrixFilter layout: 4 rows × 5, offsets in 0..1). multiply(a, b) = apply b, then a.
const galMatrix = {
    identity: () => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    multiply(a, b) {
        const out = new Array(20);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
            let sum = c === 4 ? a[r * 5 + 4] : 0;
            for (let k = 0; k < 4; k++) sum += a[r * 5 + k] * b[k * 5 + c];
            out[r * 5 + c] = sum;
        }
        return out;
    },
    chain(...list) { return list.reduce((acc, m) => galMatrix.multiply(m, acc), galMatrix.identity()); },
    saturate(s) {
        const r = 0.2126 * (1 - s), g = 0.7152 * (1 - s), b = 0.0722 * (1 - s);
        return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
    },
    scale(r, g, b) { return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0]; },
    contrast(c) { const o = 0.5 * (1 - c); return [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0]; },
    offset(r, g, b) { return [1, 0, 0, 0, r, 0, 1, 0, 0, g, 0, 0, 1, 0, b, 0, 0, 0, 1, 0]; },
    mix(a, b, t) { return a.map((value, i) => value + (b[i] - value) * t); },
    isIdentity(m) { const id = galMatrix.identity(); return m.every((value, i) => Math.abs(value - id[i]) < 1e-3); }
};
// The time of day is graded per picture and per figure (not on world, where the mood looks live), from
// the `time` stage looks (galTimeGrade / galLayerCorrection, gal-looks.js): the paired grade
// on every picture and figure alike (so nobody looks pasted on) and, for a stand-in picture that shows
// another time, a "day-for-night" correction on the backdrop only. A picture already showing that time
// (its own name says so) stays as it is while the figures still get the paired grade, so they match it.
// Figure light: glow (warm lift; the rim / aura is a glow filter on top) and shadow (a near-black
// silhouette with a navy cast; a faint cool edge glow outlines it).
const GAL_GLOW_MATRIX = galMatrix.chain(galMatrix.scale(1.07, 1.03, 0.94), galMatrix.offset(0.035, 0.022, 0.004));
const GAL_SHADOW_MATRIX = [0.06, 0.03, 0.01, 0, 0.012, 0.02, 0.07, 0.02, 0, 0.02, 0.02, 0.04, 0.11, 0, 0.045, 0, 0, 0, 1, 0];
// One colour matrix per figure: time grade, then figure light, then the speaker lighting (shade), with
// the figure's alpha in the alpha row.
function galFigureMatrix(shade, alpha, glow, shadow, grade) {
    const M = galMatrix;
    const lit = M.mix(M.mix(M.identity(), GAL_GLOW_MATRIX, glow || 0), GAL_SHADOW_MATRIX, shadow || 0);
    const m = M.multiply(M.scale(shade, shade, shade), M.multiply(lit, grade || M.identity()));
    m[15] = 0; m[16] = 0; m[17] = 0; m[18] = alpha; m[19] = 0;
    return m;
}

// Camera: the persistent state (zoom in → slow push to 1.12; pan and rotation reserved) and one-shots.
const GAL_ZOOM_IN = 1.12;
const GAL_ZOOM_MS = 1200;
function galCameraTarget(camera) {
    camera = camera || {};
    const number = (value, fallback) => typeof value === "number" && isFinite(value) ? value : fallback;
    return { zoom: Math.max(0.5, number(camera.zoom, 1)), panX: number(camera.panX, 0), panY: number(camera.panY, 0), rotation: number(camera.rotation, 0) };
}
// figures fade at their slot; horizontal travel would cross the stage axis.
// Reflow still eases; "none" (skipping) reveals instantly.
const GAL_SCENE_DIP_MS = 480;
// Add / replace / retire decisions for the figures on stage. current: [{ key, kind, url, leaving }].
function galFigurePlan(current, figures) {
    const plan = { add: [], replace: [], retire: [], revive: [] };
    const wanted = new Map(figures.map(figure => [figure.key, figure]));
    current.forEach(function (entry) {
        const figure = wanted.get(entry.key);
        if (!figure) { if (!entry.leaving) plan.retire.push(entry.key); return; }
        if (figure.kind !== entry.kind || ((figure.kind === "live2d" || figure.kind === "spine") && figure.identity !== entry.identity)) plan.replace.push(entry.key);
        else if (entry.leaving) plan.revive.push(entry.key);
    });
    figures.forEach(function (figure) { if (!current.some(entry => entry.key === figure.key)) plan.add.push(figure); });
    return plan;
}
// First frame of a figure whose picture has just become ready.
function galFigureInit(entry, figure) {
    const base = figure.x != null ? figure.x : 0.5;
    // insertion is not travel across the stage; fade at the assigned slot.
    entry.cx = galSpringValue(base);
    // a figure parked by the viewport layout starts transparent.
    entry.alpha = galSpringValue(figure.enter === "none" && !figure.parked ? 1 : 0);
    entry.away = Boolean(figure.parked);
    entry.shade = galSpringValue(figure.shade != null ? figure.shade : 1);
    entry.flip = galSpringValue(figure.gaze === -1 ? -1 : 1);
    entry.lift = galSpringValue(figure.close ? 1 : 0);
    entry.look = 0; entry.lookOn = false;
    entry.scene = figure.scene; entry.hideUntil = 0; entry.exitFrom = null;
    entry.started = true;
    return entry;
}
// One eased step towards the description. now in ms, dt in seconds.
function galFigureStep(entry, figure, now, dt) {
    if (!entry.started) galFigureInit(entry, figure);
    const base = figure.x != null ? figure.x : entry.cx.v;
    // A new scene: figures dip out with the old background and come back with the new one.
    if (figure.scene !== entry.scene) { entry.scene = figure.scene; if (figure.enter !== "none") entry.hideUntil = now + GAL_SCENE_DIP_MS; }
    const hiding = entry.hideUntil > now;
    if (hiding && entry.alpha.v < 0.04) { entry.cx.v = base; entry.cx.d = 0; }
    const gone = figure.visible === false;
    // a fully faded figure comes back at its new slot (fade, no travel).
    if (gone && entry.alpha.v < 0.04) entry.away = true;
    else if (!gone && entry.away) { entry.away = false; if (entry.alpha.v < 0.04) { entry.cx.v = base; entry.cx.d = 0; } }
    // exits fade in place, even when old records request a crossing sweep.
    let tx;
    if (gone) {
        if (entry.exitFrom == null) entry.exitFrom = entry.cx.v;
        tx = entry.exitFrom;
    } else { entry.exitFrom = null; tx = hiding ? entry.cx.v : base; }
    galSpring(entry.cx, tx, 7.5, dt);
    galSpring(entry.alpha, gone || hiding || entry.cropped ? 0 : 1, hiding ? 18 : gone ? 10 : 8, dt);
    entry.alpha.v = galClamp01(entry.alpha.v);
    galSpring(entry.shade, figure.shade != null ? figure.shade : 1, 10, dt);
    galSpring(entry.flip, figure.gaze === -1 ? -1 : 1, 9, dt);
    galSpring(entry.lift, figure.close ? 1 : 0, 7, dt);
    entry.look += ((figure.gaze == null ? 0 : figure.gaze) - entry.look) * (1 - Math.exp(-5.4 * dt));
    entry.lookOn = figure.gaze != null || Math.abs(entry.look) > 0.02;
    return entry;
}
// A leaving figure can be destroyed once it is transparent or off screen.
function galFigureGone(entry) { return !entry.started || entry.alpha.v < 0.01 || entry.cx.v < -0.25 || entry.cx.v > 1.25; }
// how many of the directed cast the viewport shows,
// at what size and where. A display projection: the cast, stage order and ruler are never rewritten; a parked figure
// stays loaded and comes back when there is room again (rotation, resize, another speaker).
// Criterion, in stage CSS px: neighbours' nominal bodies (bodyHeads head spans wide, at the ruler's head span) overlap
// by at most maxOverlap. Past that the whole cast shrinks together about the ruler's head line, but a head span never
// below minHeadPx; when even that cannot make room, the lowest-priority figure is parked. A shrunk cast stands lower
// (never lower than unshrunk) so its feet - and a cropped picture's bottom edge - stay behind the text box. Desktop /
// landscape casts fit at 1 and are unchanged.
const GAL_FIGURE_FIT = Object.freeze({ headShare: 0.155, bodyHeads: 2.2, maxOverlap: 0.3, minHeadPx: 72, feetBelow: 0.04 });
// where n figures stand, as fractions of the stage width. The
// active skin may declare its own per count (dsh.skin/1 figureSlots); otherwise n + 1 equal gaps.
function galSlots(count, skinSlots) {
    return skinSlots?.[count] || Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
}
// { W, H, boxTop, hMax, groundRatio, cast: ids in stage order, priority: ids, most important first,
//   crops: { id: share of the head-to-feet span missing below the picture }, slots: the skin's figureSlots,
//   max: the skin's maxFigures, framing: the skin's figures {scale, top} }
// -> { count, fit, drop, top (head line px), framed, head (shown head span px), x: { id: 0..1 }, visible: ids in stage order }
// The skin's maxFigures  and the viewport are one cap - the smaller wins - and
// one rule picks who stays: the priority ranking. Size and drop are the viewport fit of the drawn count; the scene ruler
// (hMax) stays the whole present cast's, so a hidden tall figure still sets the head line.
// a skin frames the cast like its original - the
// shared ruler times `scale`, its head line (the tallest figure's head top) moved to `top` x H. One zoom for the whole
// cast: relative heights stay the ruler's. The viewport fit then works on the framed size, so a phone never gets larger
// or more figures than the shown head allows.
// a skin with a fixed
// ruler frames like the original's fixed camera - the cast is sized on `ruler` cm (not the scene's tallest figure) and a
// figure of that height has its head top at `top`, so a 192 cm or a 40 cm figure never moves or shrinks the others; and
// the size is the drawn count's (min(cast, maxFigures)), so how many are present off screen never shrinks the shown ones.
// That last rule holds for every skin with maxFigures, ruler or not (「人物比原作小很多」: five present,
// three drawn were sized for five and sank to full length; 8467ed19c had made the whole present cast size them).
// `spread` (figures.spread) is passed on to the sizing: the share of the ruler curve's height gap the skin shows.
function galFigureLayout(input) {
    const {FIGURE_DISPLAY, figureDisplayCm, figurePixelsPerCm, figureGroundY} = sceneFigureScale();
    const c = GAL_FIGURE_FIT, W = input.W, H = input.H, cast = input.cast || [], framing = input.framing, ruler = framing?.ruler ?? null;
    const hMax = ruler ?? (input.hMax || FIGURE_DISPLAY.REF_MIN_CM), headLine = H * FIGURE_DISPLAY.HEAD_TOP;
    const head = figureDisplayCm(hMax, hMax) * figurePixelsPerCm(H, hMax) * c.headShare;
    const zoom = framing?.scale ?? 1, top = framing?.top != null ? framing.top * H : headLine;
    const floor = Math.min(1, c.minHeadPx / (head * zoom));
    let count = Math.min(cast.length, input.max || Infinity), fit = 1;
    for (; count > 1; count--) {
        // A skin's slots never fit more or larger figures than the equal gaps (portrait: 「竖屏三个人太挤」); closer ones shrink more.
        const slots = galSlots(count, input.slots), gap = Math.min(1 / (count + 1), ...slots.slice(1).map((x, i) => x - slots[i]));
        fit = Math.min(1, W * gap / (head * zoom * c.bodyHeads * (1 - c.maxOverlap)));
        if (fit >= floor) break;
    }
    // A framed single figure still fits the stage's width (its nominal body, bodyHeads heads wide).
    if (count <= 1) fit = zoom > 1 ? Math.min(1, W / (head * zoom * c.bodyHeads)) : 1;
    const ranked = [];
    for (const id of (input.priority || []).concat(cast)) if (cast.includes(id) && !ranked.includes(id)) ranked.push(id);
    const shown = new Set(ranked.slice(0, Math.min(count, input.max || Infinity))), visible = cast.filter(id => shown.has(id)), x = {};
    const ground = figureGroundY(H, ruler ? 1 : input.groundRatio), framedGround = top + (ground - headLine) * zoom, fitGround = top + (ground - headLine) * zoom * fit;
    // Over the whole cast, so a speaker swap never moves the figures that stay.
    const crop = Math.max(0, ...cast.map(id => input.crops && input.crops[id] || 0));
    const drop = Math.min(framedGround - fitGround, Math.max(0, input.boxTop + H * c.feetBelow + crop * (fitGround - top) - fitGround));
    const slots = galSlots(visible.length, input.slots);
    visible.forEach((id, i) => { x[id] = slots[i]; });
    return { count: visible.length, fit: fit * zoom, drop, top, framed: framing?.scale != null || framing?.top != null || ruler != null, ...(ruler != null ? { ruler, shrunk: fit < 1 } : null), ...(framing?.spread != null ? { spread: framing.spread } : null), head: head * zoom * fit, x, visible };
}
// a performance's speaker shot on a W x H
// stage. shot = {head: [centre x, top, height] (stage fractions), roll (degrees, counter-clockwise)} for the subject's side.
// The whole world (background and figure) turns by roll about the stage centre and zooms just enough to stay covering;
// head = where the subject's rest head box goes in the world's own (unturned) space so that on screen its top centre lands
// on (x W, top H) at height x H. Narrow stages (<= 640 px) centre the head and keep it within 45% of the stage width.
function galShotFrame(shot, W, H) {
    const narrow = W <= 640, [hx, top, height] = shot.head, r = -(shot.roll || 0) * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r), zoom = Math.abs(cos) + Math.abs(sin) * Math.max(W / H, H / W);
    const px = (narrow ? 0.5 : hx) * W - W / 2, py = top * H - H / 2, size = narrow ? Math.min(height * H, 0.45 * W) : height * H;
    // Screen = centre + R(r) zoom (local - centre); the inverse turn puts the screen target back into the world.
    return { zoom, rotation: r, head: { x: W / 2 + (cos * px + sin * py) / zoom, top: H / 2 + (-sin * px + cos * py) / zoom, height: size / zoom } };
}
// Visibility only: film bars and the normal topbar never change figure size or the ground line.
function galVisibleFrame(W, H, film, uiTop) {
    // Same as the CSS --film-bar: the cinema bar, but never shorter than two subtitle lines plus the name.
    const filmFont = Math.min(22, Math.max(16, W * 0.015));
    const bar = Math.max(Math.min(H * 0.16, Math.max(H * 0.08, (H - W / 2.35) / 2)), filmFont * 3.4 + 58.25);
    const mix = galClamp01(Number(film) || 0), ui = Math.min(H * 0.2, uiTop == null ? 52 : uiTop);
    const top = ui * (1 - mix) + bar * mix, bottom = H - bar * mix;
    return { top, bottom, height: Math.max(1, bottom - top), margin: (bottom - top) * (0.015 + 0.015 * mix) };
}
// Ease the frame itself, not a lagging safety clamp: every intermediate layout remains safe.
function galFrameMix(from, to, elapsed) {
    const t = galClamp01(elapsed / 700);
    if (t === 0 || t === 1) return t === 0 ? from : to;
    // Invert CSS cubic-bezier(.65, 0, .35, 1), shared with the 700ms letterbox transition.
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
        const p = (lo + hi) / 2, x = 3 * (1 - p) * (1 - p) * p * 0.65 + 3 * (1 - p) * p * p * 0.35 + p * p * p;
        if (x < t) lo = p; else hi = p;
    }
    const p = (lo + hi) / 2;
    return from + (to - from) * p * p * (3 - 2 * p);
}
// a close shot frames a face and upper body, not a fixed enlargement of the ruler.
// safeBottom is a FIXED line - the top of the choice menu with its
// full ribbons reserved, or the text box when that is higher (faceEnvironment) - so the face (hair → chin) sits above the
// choices from the first frame and nothing re-frames when they appear. The head takes 60% of the band (8% headroom), at
// least 1.35x and never past 90% of the band; zoomMax caps any camera kick so the chin stays above it. A band too short
// for the head at 1x (a phone with the menu reserved) keeps the normal shot (null).
// the zoom never treats a head as smaller than half the scene
// ruler's head span (rulerHead: galFigureLayout's head, stage px at 1x). A short or non-human figure - a 40 cm owl, a
// 30 cm mascot, a picture whose head is only estimated - is magnified like a small head, not 5-6x onto one eye; every human
// head (children included) is larger than the floor, so their close-ups are unchanged. Placement and the kick cap still use
// the real head, so it sits at the top of the band with the rest of the figure below it.
// the one rule for every framing that enlarges a head box to a
// size - the close-up, a performance's speaker shot (tickShot) and a skin's bust (tickBust): galFramedHead.
const GAL_CLOSE_MIN_HEAD = 0.5;
function galFramedHead(span, rulerHead) {
    return Math.max(span, (rulerHead || 0) * GAL_CLOSE_MIN_HEAD);
}
function galCloseFrame(head, frame, safeBottom, W, H, rulerHead) {
    const top = frame.top + frame.margin, available = safeBottom - H * 0.02 - top, span = Math.max(1, head.chin - head.top);
    if (available * 0.9 < span) return null;
    const sized = galFramedHead(span, rulerHead);
    const zoom = Math.max(1, Math.min(Math.max(1.35, available * 0.6 / sized), available * 0.9 / sized));
    const centre = top + Math.min(available * 0.08 + span * zoom / 2, available - span * zoom / 2);
    return { x: head.x / W, y: ((head.top + head.chin) / 2 - frame.top) / frame.height, zoom,
        ay: (centre - frame.top) / frame.height, zoomMax: Math.max(zoom, 2 * (top + available - centre) / span) };
}
// The top of the choice menu at its full height - the candidate contract's five choices (4 actions + 1 scene, about 40
// characters each, prompts/candidate-story.md), 自由输入 with its 重新生成 badge (one row) - measured once per stage size / theme / skin from a
// hidden copy with the real stage CSS, in stage units. null when the stage has none.
const GAL_CHOICE_PROBE = "字".repeat(40);
function galChoiceReserveTop(stageHost, k) {
    const probe = document.createElement("div");
    probe.className = "fork-gal-choices fork-gal-endpanel";
    probe.dataset.settled = "";
    probe.setAttribute("aria-hidden", "true");
    probe.style.visibility = "hidden";
    const row = (extra, text, tail = '') => '<div class="fork-gal-choice' + extra + '"><button type="button" class="fork-gal-choice-main"><span class="fork-gal-choice-text">' + text + '</span></button>' + tail + '</div>';
    probe.innerHTML = row("", GAL_CHOICE_PROBE).repeat(5) + row(" is-free", "自由输入", '<button type="button" class="fork-gal-choice-tool"><span>重新生成</span></button>');
    stageHost.appendChild(probe);
    // A skin's bar menu (art.choices) stands over the scene in the middle of the screen, as in its original: no reservation.
    if (getComputedStyle(probe).getPropertyValue("--gal-choices-over-scene").trim() === "1") { probe.remove(); return null; }
    const outer = stageHost.getBoundingClientRect(), tops = Array.from(probe.children, node => node.getBoundingClientRect()).filter(rect => rect.height > 0).map(rect => rect.top);
    probe.remove();
    return tops.length ? (Math.min(...tops) - outer.top) * k : null;
}
function galFrameCameraTarget(target, frame, H) {
    return Object.assign({}, target, { fy: (frame.top + target.fy * frame.height) / H, ay: (frame.top + target.ay * frame.height) / H });
}
// Alpha bbox in the central third. A short, opaque run keeps real ahoge but rejects isolated noise.
function galEstimateHeadTop(rgba, width, height) {
    const left = Math.floor(width / 3), right = Math.ceil(width * 2 / 3);
    const needed = Math.max(2, Math.ceil(width * 0.003));
    let previous = false;
    for (let y = 0; y < height; y++) {
        let count = 0;
        for (let x = left; x < right; x++) if (rgba[(y * width + x) * 4 + 3] >= 64) count++;
        const opaque = count >= needed;
        if (opaque && previous) return (y - 1) / height;
        previous = opaque;
    }
    return 0; // Empty, tainted or unavailable images must not invent transparent headroom.
}
// Rest head endpoints transformed through the final camera, before transient act offsets.
// Return a WORLD-space downward shift; scale and head matching are never changed here.
function galHeadroomShift(head, camera, frame, W, H) {
    const z = camera.zoom || 1, r = camera.rotation || 0, cos = Math.cos(r), sin = Math.sin(r);
    const screenTop = camera.ay * H + z * ((head.top - camera.fy * H) * cos +
        (head.x - camera.fx * W) * sin - Math.abs(sin) * (head.width || 0) / 2);
    return Math.max(0, (frame.top + frame.margin - screenTop) / (z * Math.max(0.1, cos)));
}
// Face visibility is a REST placement decision, independent of focus, speech and acts.
function galFaceRest(head, supportY, safeTop, occluderTop, H, body) {
    // small figures get an independent presentation ledge, never a new ruler.
    // Include visible ink below the feet; never shrink a figure to qualify for full-body framing.
    const ledge = occluderTop - H * 12 / 900;
    if (body && Number.isFinite(body.top + body.bottom) && body.bottom > body.top) {
        const lift = Math.max(0, body.bottom - ledge);
        if (body.top - lift >= safeTop + H * 20 / 900) return { lift, scale: 1, warning: null, fullBody: true };
    }
    const bottom = occluderTop - H * 0.02, span = head.chin - head.top;
    const scale = Math.min(1, Math.max(0.001, bottom - safeTop) / Math.max(0.001, span));
    const top = supportY + (head.top - supportY) * scale;
    const chin = supportY + (head.chin - supportY) * scale;
    const lift = Math.max(0, chin - bottom);
    // A pre-existing top overflow belongs to headroom; a lift must not introduce one.
    return { lift: Math.min(lift, Math.max(0, top - safeTop)), scale, warning: scale < 1 ? "face-visibility-shrink" : null };
}
function galFaceRestFrame(state, now) {
    const mix = galFrameMix(0, 1, now - state.start);
    return { lift: state.from.lift + (state.to.lift - state.from.lift) * mix,
        scale: state.from.scale + (state.to.scale - state.from.scale) * mix };
}
function galFaceRestUpdate(state, key, head, supportY, safeTop, occluderTop, H, now, snap, body) {
    if (state?.key === key) return state;
    const to = galFaceRest(head, supportY, safeTop, occluderTop, H, body);
    return { key, from: !state || snap ? to : galFaceRestFrame(state, now), to, start: now, computations: (state?.computations || 0) + 1 };
}
function galFaceUnion(heads) {
    const points = [];
    for (const head of heads.filter(Boolean)) {
        const cy = (head.top + head.chin) / 2, c = Math.cos(head.rotation || 0), s = Math.sin(head.rotation || 0);
        for (const x of [-head.width / 2, head.width / 2]) for (const y of [head.top - cy, head.chin - cy]) points.push(head.x + c * x - s * y, cy + s * x + c * y);
    }
    return galMeshHead([points], { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 0);
}
// C1 soft hinge anticipates contact instead of easing an unsafe correction behind the chin.
function galFaceClamp(head, camera, W, H, occluderTop, previous = 0, dt = 0) {
    const z = camera.zoom || 1, r = camera.rotation || 0, angle = r + (head.rotation || 0);
    const cy = (head.top + head.chin) / 2;
    const chin = camera.ay * H + (camera.shakeY || 0) + z * ((cy - camera.fy * H) * Math.cos(r) +
        (head.x - camera.fx * W) * Math.sin(r) + Math.abs(Math.cos(angle)) * (head.chin - head.top) / 2 + Math.abs(Math.sin(angle)) * head.width / 2);
    const needed = chin - (occluderTop - H * 0.02), band = H * 0.005;
    const soft = needed <= -band ? 0 : needed >= band ? needed : (needed + band) ** 2 / (4 * band);
    const target = soft / (z * Math.max(0.1, Math.cos(r)));
    const lift = Math.max(target, previous * Math.exp(-12 * Math.max(0, dt)));
    return { lift, active: needed > 0, chin, needed };
}
const galHeadTopCache = new Map();
function galTextureHeadTop(url, texture) {
    if (galHeadTopCache.has(url)) return galHeadTopCache.get(url);
    let top = 0;
    try {
        const image = texture.baseTexture.resource.source, canvas = document.createElement("canvas");
        const ratio = Math.min(1, 2048 / Math.max(texture.width, texture.height));
        canvas.width = Math.max(1, Math.round(texture.width * ratio)); canvas.height = Math.max(1, Math.round(texture.height * ratio));
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        top = galEstimateHeadTop(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    } catch (_) { /* Cross-origin textures use the conservative canvas-top fallback. */ }
    if (galHeadTopCache.size >= 256) galHeadTopCache.delete(galHeadTopCache.keys().next().value);
    galHeadTopCache.set(url, top);
    return top;
}
// Static portrait placement (bottom-anchored): up to 88% of the stage tall and 40% wide (× size, for
// small card pictures used as stand-ins); action zoom scales from the feet
// so the face comes into frame (lift 0..1).
// ground: the feet stand this fraction of the stage above the bottom (small full-body pictures stand on
// the floor line above the text box instead of sinking behind it).
function galFlatLayout(texW, texH, W, H, cx, focus, lift, size, ground) {
    const base = Math.min(H * 0.88 / (texH || 1), W * 0.4 / (texW || 1)) * (size || 1);
    return { x: W * cx, y: H * (1 - (ground || 0)) + (lift || 0) * 0.3 * 0.88 * H, scale: base * (focus || 1), width: texW * base * (focus || 1), height: texH * base * (focus || 1) };
}
// Staged actions of a static portrait: dx/dy as fractions of the picture, px in pixels, flip the mirror factor.
const GAL_HOP_MS = 740;
const GAL_FLAT_ACTS = { nod: 650, shake: 850, jump: GAL_HOP_MS, tremble: 1000, turn: 1300, bow: 1300, lean: 1400, "step-back": 1300 };
// Normalized act time; displacement is a fraction of the un-stretched figure height.
function galHopAt(t, reduced) {
    const rest = { dy: 0, scaleX: 1, scaleY: 1 };
    if (!Number.isFinite(t) || t <= 0 || t >= 1) return rest;
    const ms = t * GAL_HOP_MS;
    const arc = s => 4 * s * (1 - s);
    if (reduced) return ms < 360 ? { dy: -0.015 * arc(ms / 360), scaleX: 1, scaleY: 1 } : rest;
    const squash = (s, depth) => {
        const k = s < 0.35 ? s / 0.35 : (1 - s) / 0.65;
        const eased = k * k * (3 - 2 * k);
        return { dy: 0, scaleX: 1 + depth * 0.75 * eased, scaleY: 1 - depth * eased };
    };
    const air = (s, height) => {
        const k = arc(s);
        return { dy: -height * k, scaleX: 1 - 0.01 * k, scaleY: 1 + 0.02 * k };
    };
    // Crouch, ballistic hop, rebound, smaller hop, then a soft landing.
    if (ms < 70) return squash(ms / 70, 0.04);
    if (ms < 350) return air((ms - 70) / 280, 0.045);
    if (ms < 440) return squash((ms - 350) / 90, 0.035);
    if (ms < 660) return air((ms - 440) / 220, 0.027);
    return squash((ms - 660) / 80, 0.025);
}
function galHopReduced(quality) {
    return quality === "low" || galBlinkCalm();
}
// Stage CONFIG is authoritative; OS animation preferences do not control stage motion (R20).
function galBlinkCalm() {
    return typeof stageReading !== "undefined" && stageReading.get().reducedMotion === true;
}
function galShiverAt(t) { return 1.25 * Math.sin(12 * Math.PI * t) * Math.pow(Math.sin(Math.PI * t), 2); }
// bow / lean / step-back (shared with Live2D, live2d.js): dy and zoom over t (0..1).
function galBodyActAt(name, t) {
    const E = galEase, frame = { dy: 0, zoom: 1, angleY: 0, dx: 0 };
    const hold = (a, b) => t < a ? E.inOutSine(t / a) : t < b ? 1 : 1 - E.inOutSine((t - b) / (1 - b));
    if (name === "bow") { const k = hold(0.32, 0.6); frame.dy = 0.035 * k; frame.angleY = -24 * k; frame.zoom = 1 - 0.01 * k; }
    else if (name === "lean") { const k = hold(0.28, 0.7); frame.zoom = 1 + 0.045 * k; frame.dy = 0.012 * k; frame.angleY = -6 * k; }
    else if (name === "step-back") { const k = t < 0.22 ? E.outCubic(t / 0.22) : t < 0.5 ? 1 : 1 - E.inOutSine((t - 0.5) / 0.5); frame.zoom = 1 - 0.06 * k; frame.dy = -0.012 * k; }
    return frame;
}
function galFlatActAt(name, ms, reduced) {
    const frame = { dx: 0, dy: 0, px: 0, flip: 1, zoom: 1, scaleX: 1, scaleY: 1, done: true };
    const duration = GAL_FLAT_ACTS[name];
    if (!duration || ms < 0 || ms >= duration) return frame;
    const t = ms / duration;
    frame.done = false;
    if (name === "nod") frame.dy = t < 0.5 ? 0.016 * Math.sin(Math.PI * t / 0.5) : 0.01 * Math.sin(Math.PI * (t - 0.5) / 0.5);
    else if (name === "shake") frame.dx = -0.01 * Math.sin(4 * Math.PI * t) * Math.pow(Math.sin(Math.PI * t), 2);
    else if (name === "jump") Object.assign(frame, galHopAt(t, reduced));
    else if (name === "tremble") frame.px = galShiverAt(t);
    else if (name === "turn") frame.flip = t < 0.25 ? Math.cos(Math.PI * t / 0.25) : t < 0.75 ? -1 : -Math.cos(Math.PI * (t - 0.75) / 0.25);
    else { const body = galBodyActAt(name, t); frame.dy = body.dy; frame.zoom = body.zoom; }
    return frame;
}
// Debug override (window.forkGalDebug.override): objects merge one level deep, arrays replace.
function galSceneMerge(base, patch) {
    if (!patch) return base;
    const out = Object.assign({}, base, patch);
    ["background", "camera", "figureLight"].forEach(function (key) { if (patch[key] && base[key] && typeof patch[key] === "object") out[key] = Object.assign({}, base[key], patch[key]); });
    return out;
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { galFigureRects, galCropHidden, galBodyX, galBodyReport, sceneFigureScale, galFrameRate, galFrameDue, galTextureOwners, galMoodMotionPlan, galPlayMoodMotion, galMotionFade, galMotionTransitions, galShouldBlink, forkGalOwnBlink, live2dStartIdle, galMeshHead, galFaceDrawables, galCheekIndex, galCheekValue, galBlushStep, galFlushFace, galInitFace, galMeshRotation, galFallbackHead, galDisplayMatrix, galSmoothHead, galLipSyncIds, galApplyLipSync, galApplyStageHead, galEase, galClamp01, galSpring, galSpringValue, galTween, galTweenAt, galCallView, galCover, GAL_TRANSITIONS, GAL_TEXTURE_KEEP_BYTES, galBackgroundTransition, galTransitionPlan, galTransitionFrame, galBlinkLids, galSlashBars, galFigureCutFrame, galWipeRect, galIrisSize, galMatrix, GAL_GLOW_MATRIX, GAL_SHADOW_MATRIX, galFigureMatrix, GAL_ZOOM_IN, GAL_ZOOM_MS, galCameraTarget, GAL_SCENE_DIP_MS, galFigurePlan, galFigureInit, galFigureStep, galFigureGone, GAL_FIGURE_FIT, galSlots, galFigureLayout, galShotFrame, galVisibleFrame, galFrameMix, GAL_CLOSE_MIN_HEAD, galFramedHead, galCloseFrame, GAL_CHOICE_PROBE, galChoiceReserveTop, galFrameCameraTarget, galEstimateHeadTop, galHeadroomShift, galFaceRest, galFaceRestFrame, galFaceRestUpdate, galFaceUnion, galFaceClamp, galHeadTopCache, galTextureHeadTop, galFlatLayout, GAL_HOP_MS, GAL_FLAT_ACTS, galHopAt, galHopReduced, galBlinkCalm, galShiverAt, galBodyActAt, galFlatActAt, galSceneMerge };
