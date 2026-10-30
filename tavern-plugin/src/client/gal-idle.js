// 「人物待机与点触」, core stage behaviour (no mod, no
// switch). Richer idle for every stage figure (static sprites and layered sprites: S1 transform + S2 warp; Live2D: drift,
// attention shifts and saccades as offsets before physics; Spine keeps its own idle animation) and purely visual tap
// feedback (squash, emote and the figure's own emotionMap 差分 / expression / animation for a moment). Generic: no
// per-figure data. It never sends a message, calls a model, writes story state or plays a voice. Taps arm a figure
// (galTapArm): a single tap on a figure is a plain page turn; a double tap on its visible body reacts
// and arms it for a few seconds, while every tap on it reacts instead of turning the page. Reduced motion
// (galBlinkCalm) keeps today's idle, drops every squash and head flinch and shows the armed cue without a fade.
// S1+S2 motion with emotionMap reactions.
const FIGURE_LIFE = Object.freeze({ live2dGain: 0.6, stillMs: 2200, expressionMs: 2600, animationMs: 2400 });

// ---- deliberate tap (mobile mis-taps): one primary pointer, primary button, no second finger, no
// pointercancel (the browser took it for a scroll / pan), at most `slopPx` CSS px from the press at any time (no drag,
// swipe) and released within `maxMs` (no long press). Mouse, pen and touch share the rule; the click that follows the
// release is the one judged. Pure: the scene feeds it the stage's pointer events (capture phase, never consumed).
const GAL_TAP_RULE = Object.freeze({ slopPx: 8, maxMs: 300, clickMs: 800 });
function galTapTracker() { return { down: null, pointers: new Set() }; }
function galTapPointer(tracker, event) {
    const id = event.pointerId, down = tracker.down, own = down && down.id === id;
    const moved = own ? Math.hypot(event.clientX - down.x, event.clientY - down.y) : 0;
    if (event.type === "pointerdown") {
        if (tracker.pointers.size || !event.isPrimary) { if (down) down.multi = true; tracker.pointers.add(id); return; }
        tracker.pointers.add(id);
        tracker.down = { id, type: event.pointerType || "mouse", button: event.button, x: event.clientX, y: event.clientY, at: event.timeStamp, moved: 0, multi: false, cancelled: false, upAt: 0 };
        return;
    }
    if (event.type === "pointerup" || event.type === "pointercancel") tracker.pointers.delete(id);
    if (!own) return;
    down.moved = Math.max(down.moved, moved);
    if (event.type === "pointerup") down.upAt = event.timeStamp;
    else if (event.type === "pointercancel") down.cancelled = true;
}
// The click judged once: true only for a deliberate tap that just ended.
function galTapDeliberate(tracker, click) {
    const down = tracker.down;
    tracker.down = null;
    if (!down || click.button !== 0 || down.button !== 0 || down.multi || down.cancelled || !down.upAt) return false;
    return down.moved <= GAL_TAP_RULE.slopPx && down.upAt - down.at <= GAL_TAP_RULE.maxMs && click.timeStamp - down.upAt <= GAL_TAP_RULE.clickMs;
}

function galIdleHash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
function galIdleNoise(t, seed) {
    const i = Math.floor(t), f = t - i, u = f * f * f * (f * (f * 6 - 15) + 10);
    return galIdleHash(i + seed) * (1 - u) + galIdleHash(i + 1 + seed) * u;
}
// Fractal value noise in [-1, 1]: decoupled, non-repeating slow drift instead of one sine.
function galIdleFbm(t, seed, octaves = 3) {
    let sum = 0, amp = 1, norm = 0, freq = 1;
    for (let k = 0; k < octaves; k++) { sum += amp * galIdleNoise(t * freq, seed + k * 17.31); norm += amp; amp *= 0.5; freq *= 2.03; }
    return sum / norm;
}
function galIdleRandom(state) { state.rng = (state.rng * 16807) % 2147483647; return (state.rng - 1) / 2147483646; }
// ---- per-figure phase desync (three figures breathed, swayed and blinked in lockstep). Every figure
// instance draws its own seed from its key and a per-mount salt, so figures created together (a page turn, a scene
// change, a remount, a replay) never start in step and a remount never snaps back into the old relationship. The seed
// fixes the figure's whole idle rhythm: breath phase and period (±10 %), blink interval (±20 %), which Live2D idle clip
// it starts on and where in that clip, and its Cubism breath phase. Amplitudes are untouched: each figure still moves
// as before, only out of step with the others.
const GAL_IDLE_JITTER = Object.freeze({ period: 0.1, blink: 0.2 });
function galIdleSeed(key, salt = Math.random()) {
    let hash = 2166136261;
    const text = String(key == null ? "" : key);
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    const seed = ((hash >>> 0) / 4294967296 + salt * 0.6180339887) % 1;
    return seed > 1e-6 ? seed : 0.5;
}
function galIdleJitter(seed) {
    const s = { rng: Math.max(1, Math.floor(((seed * 7919.123) % 1) * 2147483000)) }, r = () => galIdleRandom(s);
    r();
    return Object.freeze({ phase: r(), period: 1 + (r() * 2 - 1) * GAL_IDLE_JITTER.period,
        blink: 1 + (r() * 2 - 1) * GAL_IDLE_JITTER.blink, pick: r(), offset: r() });
}
// Live2D: the runtime's breath is sin(2π t / cycle) on a clock that starts at 0 for every model, and the blink interval
// is the same 4 s everywhere — so models of one rig loaded together breathe in step. Stretch this figure's breath
// cycles by its period factor, start its breath clock somewhere in its longest cycle and scale its blink interval.
// Called once per model, before the first update.
function galLive2dDesync(internal, jitter) {
    if (!internal || !jitter) return;
    const breath = internal.breath;
    if (breath && typeof breath.getParameters === "function" && typeof breath.setParameters === "function" && !breath.forkDesynced) {
        const params = breath.getParameters() || [];
        breath.setParameters(params.map(p => Object.assign(Object.create(Object.getPrototypeOf(p)), p, { cycle: p.cycle * jitter.period })));
        const longest = params.reduce((max, p) => Math.max(max, Math.abs(p.cycle) || 0), 0) * jitter.period;
        if (typeof breath._currentTime === "number") breath._currentTime += jitter.phase * longest;
        breath.forkDesynced = true;
    }
    const blink = internal.eyeBlink;
    if (blink && typeof blink.setBlinkingInterval === "function" && !blink.forkDesynced) {
        const interval = Number.isFinite(blink._blinkingIntervalSeconds) ? blink._blinkingIntervalSeconds : 4;
        blink.setBlinkingInterval(interval * jitter.blink);
        blink.forkDesynced = true;
    }
}
function galIdleState(seed) {
    const jitter = galIdleJitter(seed);
    return { seed: seed * 997, rng: Math.max(1, Math.floor(seed * 2147483000)), time: 0, phase: jitter.phase * Math.PI * 2, jitter,
        shift: galSpringValue(0), shiftTarget: 0, nextShift: 2 + seed * 4, tilt: galSpringValue(0), tiltTarget: 0, nextTilt: 4 + seed * 6,
        lag: galSpringValue(0),
        // Live2D attention: eyes jump first, the head follows; micro-saccades while fixating.
        gaze: { x: 0, y: 0 }, eye: { x: galSpringValue(0), y: galSpringValue(0) }, head: { x: galSpringValue(0), y: galSpringValue(0) },
        headTarget: { x: 0, y: 0 }, headGoal: null, headAt: Infinity, nextAttention: 3 + seed * 5, nextSaccade: 1, micro: { x: 0, y: 0 } };
}
// Static idle. S1 (transform): breathing with a drifting period, event-driven weight shifts that settle like a damped
// spring (most of the time the figure is still), a tiny layered-noise sway; rotation pivots on the feet. With the warp
// (S2) the breath moves into the shoulders/chest and the head gets its own lagging tilt.
function galStaticIdleStep(s, dt, warp) {
    s.time += dt;
    const period = (3.8 + 0.5 * galIdleFbm(s.time * 0.05, s.seed + 3, 2)) * (s.jitter ? s.jitter.period : 1);
    s.phase += 2 * Math.PI * dt / period;
    // Inhale slightly faster than exhale.
    const breath = Math.pow((1 - Math.cos(s.phase)) / 2, 1.15);
    if (s.time >= s.nextShift) {
        s.shiftTarget = galIdleRandom(s) < 0.3 ? 0 : galIdleRandom(s) * 2 - 1;
        s.nextShift = s.time + 5 + galIdleRandom(s) * 7;
    }
    galSpring(s.shift, s.shiftTarget, 1.5, dt);
    const sway = galIdleFbm(s.time * 0.13, s.seed + 11, 2);
    const rotation = (s.shift.v * 0.32 + sway * 0.1) * Math.PI / 180;
    // Secondary motion for the warp: the head lags the body lean (slower spring) and has its own occasional tilt.
    galSpring(s.lag, rotation, 2.2, dt);
    if (s.time >= s.nextTilt) {
        s.tiltTarget = galIdleRandom(s) < 0.45 ? 0 : (galIdleRandom(s) < 0.5 ? -1 : 1) * (0.5 + galIdleRandom(s) * 0.5);
        s.nextTilt = s.time + 6 + galIdleRandom(s) * 9;
    }
    galSpring(s.tilt, s.tiltTarget, 2.6, dt);
    const headTilt = (s.lag.v - rotation) * 1.4 + (s.tilt.v * 0.7 + galIdleFbm(s.time * 0.09, s.seed + 29, 2) * 0.15) * Math.PI / 180;
    if (warp) return { scaleY: 1 + 0.003 * breath, scaleX: 1, rotation, dx: s.shift.v * 0.0016, breath, headTilt };
    return { scaleY: 1 + 0.009 * breath, scaleX: 1 + 0.0018 * breath, rotation, dx: s.shift.v * 0.0016, breath, headTilt: 0 };
}
// S2: one-pass warp filter on the figure container (sprite + mouth/blink children deform together): shoulders/chest
// rise with the breath and fade out by the waist, the chest widens a little, the head tilts around the neck with a
// smooth falloff (hair at head height follows; hair below the chin bends slightly — the secondary lag).
// The globals are shared with Pixi's highp filter vertex shader: their precision must match or the program fails to link.
const GAL_WARP_FRAGMENT = `precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform highp vec4 inputSize;
uniform highp vec4 outputFrame;
uniform vec4 inputClamp;
uniform vec3 uInvX;
uniform vec3 uInvY;
uniform vec4 uFwd;
uniform vec4 uBody;
uniform vec4 uMotion;
uniform float uAspect;
void main(void) {
    vec2 q = vTextureCoord * inputSize.xy + outputFrame.xy;
    vec3 h = vec3(q, 1.0);
    vec2 uv = vec2(dot(uInvX, h), dot(uInvY, h));
    float rise = (1.0 - smoothstep(uBody.z, uBody.w, uv.y)) * uMotion.x;
    float cy = (uv.y - uBody.z) / 0.09;
    float chestBand = exp(-cy * cy);
    vec2 d = vec2((uv.x - uMotion.w) * uMotion.y * chestBand, -rise);
    float headW = 1.0 - smoothstep(uBody.y - 0.015, uBody.y + 0.08, uv.y);
    float a = uMotion.z * headW;
    vec2 r = vec2((uv.x - uMotion.w) * uAspect, uv.y - uBody.y);
    vec2 rr = vec2(cos(a) * r.x + sin(a) * r.y, -sin(a) * r.x + cos(a) * r.y);
    d += vec2((r.x - rr.x) / uAspect, r.y - rr.y);
    vec2 src = q - vec2(uFwd.x * d.x + uFwd.z * d.y, uFwd.y * d.x + uFwd.w * d.y);
    vec2 coord = clamp((src - outputFrame.xy) * inputSize.zw, inputClamp.xy, inputClamp.zw);
    gl_FragColor = texture2D(uSampler, coord);
}`;
function galWarpFilter(PIXI) {
    const filter = new PIXI.Filter(undefined, GAL_WARP_FRAGMENT, {
        uInvX: new Float32Array([1, 0, 0]), uInvY: new Float32Array([0, 1, 0]), uFwd: new Float32Array([1, 0, 0, 1]),
        uBody: new Float32Array([0.05, 0.2, 0.32, 0.6]), uMotion: new Float32Array([0, 0, 0, 0.5]), uAspect: 1 });
    filter.forkSprite = null; filter.forkBody = null; filter.forkMotion = null;
    const apply = filter.apply;
    // Matrices from the sprite's world transform at render time (after this frame's transforms), not last frame's.
    filter.apply = function (manager, input, output, clear, state) {
        const sprite = this.forkSprite, texture = sprite && sprite.texture;
        if (sprite && texture && !sprite.destroyed && this.forkMotion) {
            const m = sprite.worldTransform, w = texture.width, hgt = texture.height;
            const fa = m.a * w, fb = m.b * w, fc = m.c * hgt, fd = m.d * hgt, det = fa * fd - fc * fb || 1;
            const i00 = fd / det, i01 = -fc / det, i10 = -fb / det, i11 = fa / det, ax = sprite.anchor.x, ay = sprite.anchor.y;
            const u = this.uniforms;
            u.uInvX[0] = i00; u.uInvX[1] = i01; u.uInvX[2] = -i00 * m.tx - i01 * m.ty + ax;
            u.uInvY[0] = i10; u.uInvY[1] = i11; u.uInvY[2] = -i10 * m.tx - i11 * m.ty + ay;
            u.uFwd[0] = fa; u.uFwd[1] = fb; u.uFwd[2] = fc; u.uFwd[3] = fd;
            u.uAspect = w / (hgt || 1);
            u.uBody.set(this.forkBody);
            u.uMotion.set(this.forkMotion);
        }
        apply.call(this, manager, input, output, clear, state);
    };
    return filter;
}
// Head / chest landmarks in texture-normalized v (0 = top). Pack anatomy when present, else the measured head top.
function galStaticBody(sprite) {
    const anatomy = sprite.figureInput && sprite.figureInput.anatomy;
    const top = anatomy && Number.isFinite(anatomy.headTop) ? anatomy.headTop : sprite.forkHeadTop || 0;
    const chin = anatomy && Number.isFinite(anatomy.chin) && anatomy.chin > top ? anatomy.chin : top + 0.14;
    const span = chin - top;
    return [top, chin, chin + span * 0.9, chin + span * 2.6];
}
function galStaticCenterU(sprite) {
    const anatomy = sprite.figureInput && sprite.figureInput.anatomy;
    return anatomy && Number.isFinite(anatomy.centerX) ? anatomy.centerX : sprite.anchor.x || 0.5;
}
// The warp bends a standing body around its neck; a seated, lying or otherwise posed figure keeps S1 only.
function galStaticWarps(figure) {
    const sizing = figure && figure.figureSizing;
    return !sizing || !sizing.heightBasis || sizing.heightBasis === "standing";
}
// Live2D idle offsets: multi-octave drift on head/body angles, attention shifts (eyes lead, head follows) and
// micro-saccades while fixating. Added after the motion layers and the director's head offsets, before physics.
// While the director aims the gaze the eyes stay on its target: no attention shift, no saccade, a quieter drift.
function galLive2dIdleStep(s, dt, speaking, looking) {
    s.time += dt;
    const k = looking ? 0.6 : speaking ? 0.85 : 1;
    if (s.time >= s.nextAttention) {
        const back = looking || galIdleRandom(s) < (speaking ? 0.6 : 0.35);
        s.gaze = back ? { x: 0, y: 0 } : { x: (galIdleRandom(s) * 2 - 1) * (speaking ? 0.35 : 0.65), y: (galIdleRandom(s) * 2 - 1) * 0.35 - 0.05 };
        s.headTarget = { x: s.gaze.x * (0.5 + galIdleRandom(s) * 0.4), y: s.gaze.y * 0.6 };
        s.headAt = s.time + 0.12 + galIdleRandom(s) * 0.12;
        s.micro = { x: 0, y: 0 };
        s.nextAttention = s.time + 4 + galIdleRandom(s) * 8;
        s.nextSaccade = s.time + 0.8 + galIdleRandom(s) * 1.5;
    }
    if (looking) { s.gaze = { x: 0, y: 0 }; s.headTarget = { x: 0, y: 0 }; s.micro = { x: 0, y: 0 }; }
    if (s.time >= s.headAt) { s.headAt = Infinity; s.headGoal = s.headTarget; }
    if (s.time >= s.nextSaccade) {
        s.micro = looking ? { x: 0, y: 0 } : { x: (galIdleRandom(s) * 2 - 1) * 0.09, y: (galIdleRandom(s) * 2 - 1) * 0.06 };
        // Fixations of 1–3 s (skewed short); no continuous eye drift.
        s.nextSaccade = s.time + 0.9 + Math.pow(galIdleRandom(s), 1.6) * 2.2;
    }
    const goal = looking ? { x: 0, y: 0 } : s.headGoal || { x: 0, y: 0 };
    galSpring(s.eye.x, s.gaze.x + s.micro.x, 42, dt);
    galSpring(s.eye.y, s.gaze.y + s.micro.y, 42, dt);
    galSpring(s.head.x, goal.x, 4.2, dt);
    galSpring(s.head.y, goal.y, 4.2, dt);
    const t = s.time, seed = s.seed;
    return {
        ParamAngleX: (4 * galIdleFbm(t * 0.09, seed + 1) + 11 * s.head.x.v) * k,
        ParamAngleY: (2.6 * galIdleFbm(t * 0.07, seed + 5) + 9 * s.head.y.v) * k,
        ParamAngleZ: (2.2 * galIdleFbm(t * 0.06, seed + 9) - 3 * s.head.x.v) * k,
        ParamBodyAngleX: (1.8 * galIdleFbm(t * 0.05, seed + 13) + 3 * s.head.x.v) * k,
        ParamBodyAngleZ: 1.2 * galIdleFbm(t * 0.045, seed + 21) * k,
        ParamEyeBallX: looking ? 0 : s.eye.x.v * k,
        ParamEyeBallY: looking ? 0 : s.eye.y.v * k
    };
}
// Arming (the common mis-tap is a page turn that lands on a figure). A deliberate tap on a figure is a
// page turn, unless it is the second tap of a double tap on that figure (≤ doubleMs after the first, ≤ doublePx away)
// or the figure is armed: then it reacts, does not turn the page and (re)arms the figure for armedMs. The first tap of
// a double tap has already turned the page; no page turn ever waits for a possible second tap. `key` is the figure the
// tap hit (null: none; undefined: not tested — the scene resolves a first tap's figure after the page turn).
const GAL_TAP_ARM = Object.freeze({ doubleMs: 350, doublePx: 24, armedMs: 5000 });
function galTapArmState() { return { first: null, until: {} }; }
function galTapArmed(arm, key, at) { return (arm.until[key] || 0) > at; }
// Whether this tap needs a hit test now: some figure is armed, or it may finish a double tap.
function galTapNeedsHit(arm, x, y, at) {
    const first = arm.first;
    return Object.values(arm.until).some(until => until > at) || Boolean(first && at - first.at <= GAL_TAP_ARM.doubleMs && Math.hypot(x - first.x, y - first.y) <= GAL_TAP_ARM.doublePx);
}
function galTapArm(arm, key, x, y, at) {
    const first = arm.first, near = first && at - first.at <= GAL_TAP_ARM.doubleMs && Math.hypot(x - first.x, y - first.y) <= GAL_TAP_ARM.doublePx;
    arm.first = null;
    for (const name in arm.until) if (arm.until[name] <= at) delete arm.until[name];
    if (key) {
        const armed = galTapArmed(arm, key, at);
        if (armed || near && first.key === key) { arm.until[key] = at + GAL_TAP_ARM.armedMs; return { claim: true, armed: !armed }; }
    }
    arm.first = { x, y, at, key };
    return { claim: false, armed: false };
}// A tap counts only on the bare scene: the Pixi canvas itself or a passive node of the scene host; never a control, the
// text box, choices, chips, the phone or any other stage UI above it (those clicks keep their own meaning).
const GAL_TAP_UI = "button, a, input, textarea, select, label, summary, [role], [tabindex], [contenteditable], .fork-gal-box";
function galTapBareTarget(target, canvas, host) {
    if (!target || target === canvas) return Boolean(target);
    if (!host || typeof host.contains !== "function" || !host.contains(target)) return false;
    for (let node = target; node && node !== host; node = node.parentElement) if (node.matches && node.matches(GAL_TAP_UI)) return false;
    return true;
}
// Live2D fallback gesture when the figure's emotionMap has none: the model's own Tap motion group (Cubism sample
// convention TapHead / TapBody / Tap, any case or separator), matched to the tapped region.
function galTapMotionGroup(motions, region) {
    const groups = Object.keys(motions || {}).filter(name => Array.isArray(motions[name]) && motions[name].length);
    const find = pattern => groups.find(name => pattern.test(name.replace(/[\s_-]/g, "")));
    return find(region === "head" ? /^taphead$/i : /^tapbody$/i) || find(/^tap$/i) || null;
}
// ---- tap feedback (purely visual: never sends, never calls a model, never changes story state, never plays a voice)
const GAL_TAP_BAGS = { head: ["happy", "shy", "happy-note"], body: ["surprised", "question", "sweat"] };
// shy has no mark: the shy emotion blushes with the model's own cheek.
const GAL_TAP_EMOTES = { happy: "heart", "happy-note": "note", surprised: "!", question: "?", sweat: "sweat", annoyed: "anger" };
// The emotion each reaction asks the figure's own emotion list for (resolved by matchBubbleMood, packFigureReactions).
const GAL_TAP_EMOTION = { happy: "joy", shy: "shy", "happy-note": "joy", surprised: "anxious", question: "anxious", sweat: "shy", annoyed: "anger" };
function galTapState() { return { bags: {}, serial: 0 }; }
// Shuffle bag per figure and region; a 3.5 s cooldown per figure between full reactions (taps inside it only squash);
// ≥4 taps on one figure within 5 s escalate to "annoyed" once, then not again for 6 s.
function galTapPlan(tap, entry, region, now, random = Math.random) {
    const cooldown = 3500, key = entry.key + ":" + region;
    entry.tapTimes = (entry.tapTimes || []).filter(at => now - at < 5000);
    entry.tapTimes.push(now);
    const escalate = entry.tapTimes.length >= 4 && !(entry.tapAnnoyedAt > now - 6000);
    if (escalate) { entry.tapAnnoyedAt = now; entry.tapLast = now; return { kind: "annoyed", full: true }; }
    if (now - (entry.tapLast ?? -Infinity) < cooldown) return { kind: region === "head" ? "pat" : "poke", full: false };
    let bag = tap.bags[key];
    if (!bag || !bag.length) {
        bag = GAL_TAP_BAGS[region].slice();
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        tap.bags[key] = bag;
    }
    entry.tapLast = now;
    return { kind: bag.pop(), full: true };
}
// Damped squash-and-stretch about the feet (volume-preserving), a small shake when annoyed, and the head flinch.
// Reduced motion: none of it (the emote and the 差分 still show).
function galTapFrame(reaction, now, reduced) {
    const frame = { scaleX: 1, scaleY: 1, dx: 0, tilt: 0, flinch: 0 };
    if (!reaction || reduced) return frame;
    const t = (now - reaction.start) / 1000;
    if (t < 0 || t > 1.2) return frame;
    const pat = reaction.region === "head";
    const amp = reaction.kind === "annoyed" ? 0.03 : pat ? 0.022 : 0.032;
    const wave = Math.exp(-5.5 * t) * Math.cos(2 * Math.PI * 2.8 * t);
    frame.scaleY = 1 - amp * wave;
    frame.scaleX = 1 + amp * 0.55 * wave;
    if (reaction.kind === "annoyed") frame.dx = 0.006 * Math.sin(2 * Math.PI * 7 * t) * Math.exp(-3.5 * t);
    frame.flinch = Math.exp(-4 * t) * Math.sin(Math.PI * Math.min(1, t / 0.12));
    frame.tilt = (reaction.side || 1) * frame.flinch;
    return frame;
}
// Alpha mask of a static texture, 1/4 resolution, built on the first tap only.
function galTapAlpha(texture) {
    if (texture.forkTapMask !== undefined) return texture.forkTapMask;
    texture.forkTapMask = null;
    try {
        const source = texture.baseTexture.resource && texture.baseTexture.resource.source, frame = texture.frame;
        if (!source) return null;
        const w = Math.max(1, Math.round(frame.width / 4)), h = Math.max(1, Math.round(frame.height / 4));
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, w, h);
        texture.forkTapMask = { w, h, data: ctx.getImageData(0, 0, w, h).data };
    } catch (_) { texture.forkTapMask = null; }
    return texture.forkTapMask;
}
// Static (flat or layered) sprite, or a Spine body (sprite-like container): the point's texture-normalized u/v.
function galTapUv(sprite, point) {
    if (!sprite || sprite.destroyed || !sprite.worldVisible || !sprite.texture || !sprite.texture.width || !sprite.texture.height) return null;
    const local = sprite.toLocal(point), tex = sprite.texture;
    const u = local.x / tex.width + sprite.anchor.x, v = local.y / tex.height + sprite.anchor.y;
    return u < 0 || u > 1 || v < 0 || v > 1 ? null : { u, v };
}
function galTapRegion(sprite, uv) {
    return { region: uv.v < galStaticBody(sprite)[1] ? "head" : "body", side: uv.u < galStaticCenterU(sprite) ? -1 : 1 };
}
// Only the visible body counts: the pixel must be solid (not a soft edge, shadow or glow) and so must
// its four neighbours in the 1/4 mask (±4 texels), so a tap grazing hair wisps or a transparent margin is a page turn.
function galTapHitStatic(sprite, point) {
    const uv = sprite && sprite.texture && sprite.texture.orig ? galTapUv(sprite, point) : null;
    if (!uv) return null;
    const mask = galTapAlpha(sprite.texture);
    if (mask) {
        const x = Math.min(mask.w - 1, Math.floor(uv.u * mask.w)), y = Math.min(mask.h - 1, Math.floor(uv.v * mask.h));
        const alpha = (dx, dy) => { const px = x + dx, py = y + dy; return px < 0 || py < 0 || px >= mask.w || py >= mask.h ? 0 : mask.data[(py * mask.w + px) * 4 + 3]; };
        if (alpha(0, 0) < 128 || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => alpha(dx, dy) < 40)) return null;
    }
    return galTapRegion(sprite, uv);
}
// The largest alpha of a 3×3 px render of `target` under the point (stage coordinates; the target has a parent).
function galTapProbe(target, point, renderer, PIXI) {
    const texture = renderer.generateTexture(target, { region: new PIXI.Rectangle(Math.floor(point.x) - 1, Math.floor(point.y) - 1, 3, 3), resolution: 1 });
    try {
        const pixels = renderer.plugins.extract.pixels(texture);
        let alpha = 0;
        for (let i = 3; i < pixels.length; i += 4) alpha = Math.max(alpha, pixels[i]);
        return alpha;
    } finally { texture.destroy(true); }
}
// Spine: the rendered skeleton under the point.
function galTapHitSpine(body, spine, point, renderer, PIXI) {
    const uv = galTapUv(body, point);
    if (!uv || !spine || spine.destroyed) return null;
    return galTapProbe(spine, point, renderer, PIXI) < 96 ? null : galTapRegion(body, uv);
}
// Live2D, for any model without per-figure data: a visible art-mesh triangle must contain the point, then the rendered
// model must be solid there (meshes carry transparent texels; model3 HitAreas are bounding boxes, so they only name the
// region: a head/face area → head). Otherwise head = above the head frame's chin (0.3 of the canvas).
function galTapHitLive2d(model, point, headFrame, renderer, PIXI) {
    if (!model || model.destroyed || !model.worldVisible) return null;
    const im = model.internalModel, p = model.toModelPosition(point);
    if (p.x < 0 || p.y < 0 || p.x > im.originalWidth || p.y > im.originalHeight) return null;
    const core = im.coreModel, count = core.getDrawableCount();
    let mesh = false;
    for (let i = count - 1; i >= 0 && !mesh; i--) {
        if (core.getDrawableOpacity(i) < 0.1 || (core.getDrawableDynamicFlagIsVisible && !core.getDrawableDynamicFlagIsVisible(i))) continue;
        const v = im.getDrawableVertices(i), idx = core.getDrawableVertexIndices(i);
        for (let j = 0; j + 2 < idx.length; j += 3) {
            const a = idx[j] * 2, b = idx[j + 1] * 2, c = idx[j + 2] * 2;
            const d1 = (p.x - v[b]) * (v[a + 1] - v[b + 1]) - (v[a] - v[b]) * (p.y - v[b + 1]);
            const d2 = (p.x - v[c]) * (v[b + 1] - v[c + 1]) - (v[b] - v[c]) * (p.y - v[c + 1]);
            const d3 = (p.x - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (p.y - v[a + 1]);
            if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { mesh = true; break; }
        }
    }
    if (!mesh || (renderer && galTapProbe(model, point, renderer, PIXI) < 96)) return null;
    const side = p.x < im.originalWidth / 2 ? -1 : 1, areas = Object.keys(im.hitAreas || {}).length ? im.hitTest(p.x, p.y) : [];
    const region = areas.some(name => /head|face/i.test(name)) || p.y / im.originalHeight < (headFrame ? headFrame.Chin : 0.3) ? "head" : "body";
    return { region, side };
}