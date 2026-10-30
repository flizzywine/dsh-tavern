'use strict';
// pure keyframe model for dsh.performance/1 `keyframes`.
// The host validated the document once at ingress; this module only compiles and samples it. No DOM, no clock.
// The stage's effect definitions and safety policy: the bundle's (stage-effects.cjs, included earlier), else Node's.
const keyframeEffects = typeof stageFlashSafe === 'function' ? {stageFlashSafe,stageEffectHex:value => stageEffectHex(value),stageEffectRgb:value => stageEffectRgb(value)} : require('./stage-effects.cjs');
const KEYFRAME_PROPS = ['x','y','scaleX','scaleY','rotation','alpha','red','green','blue','threshold','gain'];
const KEYFRAME_UNIT = new Set(['alpha','red','green','blue','threshold']);
function keyframeColor(hex) {
    if (!hex) return [1,1,1];
    const value = parseInt(hex.slice(1),16);
    return [(value >> 16 & 255) / 255,(value >> 8 & 255) / 255,(value & 255) / 255];
}
// cubic-bezier(x1,y1,x2,y2) with x clamped to 0..1 and y free (overshoot), solved for the time fraction.
function keyframeBezier([x1,y1,x2,y2], p) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const x = s => ((ax * s + bx) * s + cx) * s;
    let s = p;
    for (let i = 0; i < 8; i++) {
        const error = x(s) - p, slope = (3 * ax * s + 2 * bx) * s + cx;
        if (Math.abs(error) < 1e-6) return ((ay * s + by) * s + cy) * s;
        if (Math.abs(slope) < 1e-6) break;
        s -= error / slope;
    }
    let lo = 0, hi = 1; s = p;
    for (let i = 0; i < 32; i++) {
        const value = x(s);
        if (Math.abs(value - p) < 1e-7) break;
        if (value < p) lo = s; else hi = s;
        s = (lo + hi) / 2;
    }
    return ((ay * s + by) * s + cy) * s;
}
function sampleKeyframeTrack(keys, t, base) {
    if (t < keys[0].at) return base;
    const last = keys.length - 1;
    if (t >= keys[last].at) return keys[last].value;
    let lo = 0, hi = last;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].at <= t) lo = mid; else hi = mid; }
    const a = keys[lo], b = keys[hi], ease = a.ease || 'linear';
    if (ease === 'step') return a.value;
    const p = (t - a.at) / (b.at - a.at);
    return a.value + (b.value - a.value) * (ease === 'linear' ? p : keyframeBezier(ease,p));
}
function compileKeyframePhase(phase) {
    if (!phase) return null;
    const tracks = new Map();
    for (const track of phase.tracks) {
        if (!tracks.has(track.layer)) tracks.set(track.layer,[]);
        tracks.get(track.layer).push([track.property,track.keys]);
    }
    return {durationMs:phase.durationMs, tracks};
}
function compilePerformanceKeyframes(document) {
    const source = document?.keyframes;
    if (!source) return null;
    const layers = source.layers.map((layer,index) => {
        const [red,green,blue] = keyframeColor(layer.color);
        return {...layer,index,placement:layer.placement || 'below-dialogue',blend:layer.blend || 'normal',pivot:layer.pivot || [.5,.5],
            base:{x:layer.x,y:layer.y,scaleX:layer.scaleX ?? 1,scaleY:layer.scaleY ?? 1,rotation:layer.rotation ?? 0,alpha:layer.alpha ?? 1,red,green,blue,threshold:layer.threshold ?? 0,gain:layer.gain ?? 1},
            emitter:layer.particles ? compileKeyframeEmitter(layer) : null};
    });
    const model = {id:document.id,playback:source.playback,layers,byId:new Map(layers.map(layer => [layer.id,layer])),
        entry:compileKeyframePhase(source.entry),exit:compileKeyframePhase(source.exit)};
    model.entryEnd = sampleKeyframePhase(model,'entry',model.entry.durationMs);
    return model;
}
// One frame: every layer's resolved properties. `bases` defaults to the layer base values (entry); exit starts from
// the entry end frame.
function sampleKeyframePhase(model, name, t, bases = name === 'exit' ? model.entryEnd : null) {
    const phase = model[name];
    return model.layers.map((layer,index) => {
        const base = bases ? bases[index] : layer.base, state = {...base};
        for (const [property,keys] of phase?.tracks.get(layer.id) || []) {
            const value = sampleKeyframeTrack(keys,t,base[property]);
            state[property] = KEYFRAME_UNIT.has(property) ? Math.min(1,Math.max(0,value)) : property === 'gain' ? Math.min(8,Math.max(0,value)) : value;
        }
        return state;
    });
}
// Unit quad (u,v in 0..1) → 1600×900 reference px, as a column-major 3×3 affine [a,b,0,c,d,0,e,f,1].
function keyframeLayerMatrix(layer, state) {
    const r = state.rotation * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    const w = layer.width * state.scaleX, h = layer.height * state.scaleY, [px,py] = layer.pivot;
    const a = cos * w, b = sin * w, c = -sin * h, d = cos * h;
    return [a,b,0,c,d,0,state.x - a * px - c * py,state.y - b * px - d * py,1];
}
function invertKeyframeMatrix(m) {
    const det = m[0] * m[4] - m[3] * m[1];
    if (Math.abs(det) < 1e-12) return null;
    const a = m[4] / det, b = -m[1] / det, c = -m[3] / det, d = m[0] / det;
    return [a,b,0,c,d,0,-(a * m[6] + c * m[7]),-(b * m[6] + d * m[7]),1];
}
// Particle emitter: every particle's birth, life and random draws are fixed at compile time from the seed, so a frame is
// a pure function of the phase time (no simulation state, seek-safe). Units are the layer's own reference px.
function keyframeRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value = value + 0x6D2B79F5 >>> 0;
        let t = Math.imul(value ^ value >>> 15, value | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
function compileKeyframeEmitter(layer) {
    const p = layer.particles, random = keyframeRandom(p.seed), births = [];
    if (p.rate) for (let k = 1, at; (at = p.emitMs[0] + k * 1000 / p.rate) <= p.emitMs[1] + 1e-9; k++) births.push(at);
    for (const burst of p.bursts || []) for (let k = 0; k < burst.count; k++) births.push(burst.at);
    births.sort((a,b) => a - b);
    const between = ([lo,hi] = [0,0]) => lo + (hi - lo) * random(), deaths = [], particles = [], max = p.max ?? 256;
    const w = layer.width, h = layer.height, [px,py] = layer.pivot || [.5,.5];
    for (const birth of births) {
        const life = between(p.lifeMs);
        for (let i = deaths.length - 1; i >= 0; i--) if (deaths[i] <= birth) deaths.splice(i,1);
        const draws = [random(),random(),random(),random(),random(),random(),random(),random(),random()];
        if (deaths.length >= max) continue;
        deaths.push(birth + life);
        let x = px * w, y = py * h, angle;
        const shape = p.shape || 'box', a = draws[0] * 2 * Math.PI;
        if (shape === 'box') { x = draws[0] * w; y = draws[1] * h; }
        else if (shape === 'ellipse' || shape === 'ellipse-edge') {
            const r = shape === 'ellipse' ? Math.sqrt(draws[1]) : 1;
            x = w / 2 + Math.cos(a) * r * w / 2; y = h / 2 + Math.sin(a) * r * h / 2;
        }
        const dx = x - (shape === 'point' ? x : w / 2), dy = y - (shape === 'point' ? y : h / 2);
        if ((p.direction ?? 'radial') === 'radial') angle = Math.hypot(dx,dy) > 1e-6 ? Math.atan2(dy,dx) : a;
        else angle = p.direction * Math.PI / 180;
        angle += ((draws[2] - .5) * (p.spread || 0)) * Math.PI / 180;
        const speed = between(p.speed);
        particles.push({birth, life, x, y, vx:Math.cos(angle) * speed, vy:Math.sin(angle) * speed,
            size:between(p.size), rotation:between(p.rotation), spin:between(p.spin), phase:[draws[6] * 2 * Math.PI, draws[7] * 2 * Math.PI]});
    }
    const curve = keys => keys && keys.map(key => [key.t, key.value ?? keyframeColor(key.color)]);
    return {particles, size:curve(p.sizeOverLife), alpha:curve(p.alphaOverLife), color:curve(p.colorOverLife)};
}
function sampleKeyframeLifeCurve(keys, t) {
    if (!keys) return 1;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
        const [t0,a] = keys[i - 1], [t1,b] = keys[i], f = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
        return Array.isArray(a) ? a.map((value,k) => value + (b[k] - value) * f) : a + (b - a) * f;
    }
    return keys.at(-1)[1];
}
// Alive particles at phase time t (ms): position/velocity in layer px, quad size, rotation (deg), alpha and colour factors.
function sampleKeyframeParticles(layer, t) {
    const p = layer.particles, emitter = layer.emitter, out = [];
    const [gx,gy] = p.gravity || [0,0], k = p.limit?.damping || 0, limit = p.limit?.speed ?? Infinity;
    for (const item of emitter.particles) {
        const age = (t - item.birth) / 1000;
        if (age < 0 || age * 1000 >= item.life) continue;
        let x, y, vx, vy;
        if (k > 0) {
            // Unity Limit Velocity (dampen per frame) as exponential relaxation of the excess over the limit; under gravity
            // the velocity tends to limit·ĝ + gravity/damping (the per-frame equilibrium).
            const speed = Math.hypot(item.vx,item.vy), scale = speed > limit ? limit / speed : 1, lx = item.vx * scale, ly = item.vy * scale;
            const g = Math.hypot(gx,gy), tx = g ? gx / k + Math.min(limit,1e6) * gx / g : 0, ty = g ? gy / k + Math.min(limit,1e6) * gy / g : 0;
            const e = Math.exp(-k * age), f = (1 - e) / k;
            x = item.x + lx * age + (item.vx - lx) * f + tx * (age - f); y = item.y + ly * age + (item.vy - ly) * f + ty * (age - f);
            vx = lx + (item.vx - lx) * e + tx * (1 - e); vy = ly + (item.vy - ly) * e + ty * (1 - e);
        } else {
            x = item.x + item.vx * age + gx * age * age / 2; y = item.y + item.vy * age + gy * age * age / 2;
            vx = item.vx + gx * age; vy = item.vy + gy * age;
        }
        if (p.noise) {
            const w = 2 * Math.PI * p.noise.hz * age;
            x += p.noise.amplitude * (Math.sin(w + item.phase[0]) - Math.sin(item.phase[0]));
            y += p.noise.amplitude * (Math.sin(w * 1.37 + item.phase[1]) - Math.sin(item.phase[1]));
        }
        const life = age * 1000 / item.life, size = item.size * sampleKeyframeLifeCurve(emitter.size,life);
        out.push({x, y, vx, vy, size, rotation:item.rotation + item.spin * age, alpha:sampleKeyframeLifeCurve(emitter.alpha,life),
            color:emitter.color ? sampleKeyframeLifeCurve(emitter.color,life) : [1,1,1]});
    }
    return out;
}
function multiplyKeyframeMatrix(m, n) {
    return [m[0] * n[0] + m[3] * n[1],m[1] * n[0] + m[4] * n[1],0,m[0] * n[3] + m[3] * n[4],m[1] * n[3] + m[4] * n[4],0,
        m[0] * n[6] + m[3] * n[7] + m[6],m[1] * n[6] + m[4] * n[7] + m[7],1];
}
// One draw per alive particle: the layer transform (in its own px frame) times the particle quad.
function keyframeParticleDraws(layer, state, t, alpha, color) {
    const frame = multiplyKeyframeMatrix(keyframeLayerMatrix(layer,state),[1 / layer.width,0,0,0,1 / layer.height,0,0,0,1]), p = layer.particles, draws = [];
    for (const item of sampleKeyframeParticles(layer,t)) {
        if (item.size <= 0 || item.alpha <= 0) continue;
        let width = item.size, height = item.size * (p.aspect ?? 1), angle = item.rotation * Math.PI / 180;
        if (p.stretch) {
            const speed = Math.hypot(item.vx,item.vy);
            width = item.size * p.stretch.length + speed * (p.stretch.velocity || 0); height = item.size;
            angle = speed > 1e-6 ? Math.atan2(item.vy,item.vx) : 0;
        }
        const cos = Math.cos(angle), sin = Math.sin(angle), a = cos * width, b = sin * width, c = -sin * height, d = cos * height;
        const quad = [a,b,0,c,d,0,item.x - (a + c) / 2,item.y - (b + d) / 2,1];
        draws.push({layer,matrix:multiplyKeyframeMatrix(frame,quad),alpha:alpha * item.alpha,color:color.map((value,k) => value * item.color[k]),threshold:0,mask:null,gain:state.gain,time:t / 1000});
    }
    return draws;
}
// Draw list for one placement. Safety: `still` drops flash layers (减少动态); `photosensitive` caps a flash layer's
// peak (its colour kept). Mask-only layers never draw; a target with a hidden mask draws nothing.
// `t` is the running phase time (ms): it drives glow waves and particles; resting and still frames draw no particles.
function keyframeDrawList(model, states, placement, {still = false, photosensitive = true, t} = {}) {
    const draws = [];
    for (const layer of model.layers) {
        if (layer.maskOnly || layer.placement !== placement || still && layer.flash) continue;
        const state = states[layer.index];
        let alpha = state.alpha, color = [state.red,state.green,state.blue];
        // 光敏保护: the stage's one flash policy (stage-effects.cjs stageFlashSafe) - the colour kept at a lower peak.
        if (layer.flash && photosensitive) {
            const safe = keyframeEffects.stageFlashSafe({color:keyframeEffects.stageEffectHex(color),peak:alpha,in:0,out:0}, {photosensitive:true});
            color = keyframeEffects.stageEffectRgb(safe.color); alpha = safe.peak;
        }
        if (alpha <= 0 || layer.dissolve && state.threshold >= 1 || !state.scaleX || !state.scaleY || layer.glow && state.gain <= 0) continue;
        if (layer.particles) { if (!still && t !== undefined) draws.push(...keyframeParticleDraws(layer,state,t,alpha,color)); continue; }
        let mask = null;
        if (layer.mask) {
            const source = model.byId.get(layer.mask), maskState = states[source.index];
            const inverse = maskState.alpha > 0 && invertKeyframeMatrix(keyframeLayerMatrix(source,maskState));
            if (!inverse) continue;
            mask = {layer:source,inverse,alpha:maskState.alpha};
        }
        draws.push({layer,matrix:keyframeLayerMatrix(layer,state),alpha,color,threshold:state.threshold,mask,gain:state.gain,time:(t || 0) / 1000});
    }
    return draws;
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {KEYFRAME_PROPS,keyframeBezier,sampleKeyframeTrack,compilePerformanceKeyframes,sampleKeyframePhase,keyframeLayerMatrix,invertKeyframeMatrix,keyframeDrawList,sampleKeyframeParticles};
