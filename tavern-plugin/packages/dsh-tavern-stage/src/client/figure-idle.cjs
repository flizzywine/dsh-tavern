function createStageFigureIdle({spring:galSpring,springValue:galSpringValue}) {
let disposed=false;const releases=new Set();
const FIGURE_LIFE = Object.freeze({ live2dGain: 0.6, stillMs: 2200, expressionMs: 2600, animationMs: 2400 });

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
    if(disposed)return;
    const restore=[];
    const breath = internal.breath;
    if (breath && typeof breath.getParameters === "function" && typeof breath.setParameters === "function" && !breath.forkDesynced) {
        const params = breath.getParameters() || [];
        const beforeTime=breath._currentTime;
        restore.push(()=>{breath.setParameters(params);breath._currentTime=beforeTime;delete breath.forkDesynced;});
        breath.setParameters(params.map(p => Object.assign(Object.create(Object.getPrototypeOf(p)), p, { cycle: p.cycle * jitter.period })));
        const longest = params.reduce((max, p) => Math.max(max, Math.abs(p.cycle) || 0), 0) * jitter.period;
        if (typeof breath._currentTime === "number") breath._currentTime += jitter.phase * longest;
        breath.forkDesynced = true;
    }
    const blink = internal.eyeBlink;
    if (blink && typeof blink.setBlinkingInterval === "function" && !blink.forkDesynced) {
        const interval = Number.isFinite(blink._blinkingIntervalSeconds) ? blink._blinkingIntervalSeconds : 4;
        restore.push(()=>{blink.setBlinkingInterval(interval);delete blink.forkDesynced;});
        blink.setBlinkingInterval(interval * jitter.blink);
        blink.forkDesynced = true;
    }
    if(restore.length){const release=()=>{if(!releases.delete(release))return;const errors=[];try{internal.off?.('destroy',release);}catch(error){errors.push(error);}for(const fn of restore)try{fn();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure rhythm cleanup failed');};releases.add(release);internal.once?.('destroy',release);}
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

function dispose(){if(disposed)return;disposed=true;const errors=[];for(const release of [...releases])try{release();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Figure idle cleanup failed');}

return {FIGURE_LIFE, galIdleSeed, galIdleJitter, galIdleState, galStaticIdleStep, galLive2dIdleStep, galLive2dDesync, dispose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageFigureIdle};
