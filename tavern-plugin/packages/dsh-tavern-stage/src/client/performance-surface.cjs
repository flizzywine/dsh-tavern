// Complete performance surface: keyframe model/compositor, overlay preparation and display lifetime.
function createStagePerformanceSurface({React,window,document,clock,fonts,resolution,subscribeResolution,policy,sessions,runtime}) {
let closed=false;
const owned=new Set();
const forkForeground=clock,tavernFonts=fonts,galResolution=resolution,galResolutionSubscribe=subscribeResolution;
const {stageFlashAt,stageFlashDark,stageFlashGate,stageFlashSafe,stageSafety}=policy || {};
function cleanupAll(cleanups){const errors=[];for(const cleanup of cleanups)try{cleanup();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage performance cleanup failed');}
function createScope(start){
    if(closed)throw new Error('Stage performance disposed');
    let active=true;const cleanups=[];
    const release=()=>{if(!active)return;active=false;owned.delete(release);cleanupAll(cleanups.reverse());};
    try{start(cleanup=>cleanups.push(cleanup));owned.add(release);return release;}
    catch(error){try{release();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage performance startup failed');}throw error;}
}
function construct(factory,args){
    let value;
    const release=createScope(register=>{value=factory(args,register);register(()=>valueDispose());});
    const valueDispose=value.dispose.bind(value);value.dispose=release;return value;
}
const createStageRects=args=>construct(rawStageRects,args);
const createPerformanceKeyframeLayer=args=>construct(rawKeyframeLayer,args);
const createPerformanceSkinLayer=args=>construct(rawSkinLayer,args);
// shared read-only geometry. Consumers never measure in their animation tick.
function rawStageRects({root, host = globalThis, document:doc = root.ownerDocument, schedule = fn => host.requestAnimationFrame(fn), cancel = id => host.cancelAnimationFrame(id)}) {
    const selectors = {box:'.fork-gal-box:not(.is-awaiting)',text:'.fork-gal-text',name:'.fork-gal-name',qm:'.fork-gal-controls',side:'.fork-gal-side',choices:'.fork-gal-choices'};
    const widgetSelector = '.fork-widget,.fork-widget-reader,.fork-gal-widget-chip';
    const listeners = new Set();
    let disposed = false, pending = null, snapshot = Object.freeze({revision:0,screen:Object.freeze({x:0,y:0,w:0,h:0}),widgets:Object.freeze([])}), elements = {};
    const observer = host.ResizeObserver ? new host.ResizeObserver(invalidate) : null;
    function bind() {
        observer?.disconnect(); observer?.observe(root);
        elements = Object.fromEntries(Object.entries(selectors).map(([key,selector]) => [key,root.querySelector(selector)]));
        elements.widgets = [...root.querySelectorAll(widgetSelector)];
        for (const element of [...Object.values(elements).filter(value => value && !Array.isArray(value)),...elements.widgets]) observer?.observe(element);
    }
    function measure() {
        pending = null;
        if (disposed) return;
        const outer = root.getBoundingClientRect(), width = root.clientWidth || root.offsetWidth, height = root.clientHeight || root.offsetHeight;
        if (!(outer.width > 0 && outer.height > 0)) return;
        const sx = width/outer.width, sy = height/outer.height;
        const relative = element => {
            if (!element || !element.isConnected || !element.getClientRects().length || element.closest?.('.is-hidden,[hidden]') || host.getComputedStyle?.(element).visibility === 'hidden' || element === elements.side && !element.classList.contains('is-on')) return null;
            const r = element.getBoundingClientRect();
            return {x:(r.left-outer.left)*sx,y:(r.top-outer.top)*sy,w:r.width*sx,h:r.height*sy};
        };
        const next = {revision:snapshot.revision+1,screen:{x:0,y:0,w:width,h:height},...Object.fromEntries(Object.entries(elements).filter(([key]) => key !== 'widgets').map(([key,element]) => [key,relative(element)])),widgets:elements.widgets.map(relative).filter(Boolean),nameText:elements.name?.querySelector('b')?.textContent.replace(/^[\u3010]|[\u3011]$/g,'') || ''};
        if (root.classList.contains('is-film')) {next.box = null; next.name = null;}
        const close = (a,b) => a === null || b === null || !a || !b ? a === b : ['x','y','w','h'].every(key => Math.abs(a[key]-b[key]) <= 1);
        if (snapshot.nameText === next.nameText && Object.keys(selectors).concat('screen').every(key => close(snapshot[key],next[key])) && snapshot.widgets.length === next.widgets.length && snapshot.widgets.every((r,i) => close(r,next.widgets[i]))) return;
        for (const item of Object.values(next)) if (item && typeof item === 'object') {if (Array.isArray(item)) item.forEach(Object.freeze); Object.freeze(item);}
        snapshot = Object.freeze(next); for (const fn of listeners) fn();
    }
    function invalidate() {if (!disposed && pending === null) pending = schedule(measure);}
    // The scene may rewrite paint-only look variables every frame while a vignette/haze/grain eases or pulses
    // (galUiApplier); they never move a box, so a style change that only touches them is not a layout change.
    const paintOnly = /--look-(?:vig|vig-color|haze|haze-color|grain)\s*:[^;]*;?\s*/g;
    const geometric = record => !(record.attributeName === 'style' && (record.oldValue || '').replace(paintOnly, '').trim() === (record.target.getAttribute('style') || '').replace(paintOnly, '').trim());
    const mutations = host.MutationObserver ? new host.MutationObserver(records => {
        let rebind = false, changed = false;
        for (const record of records) {
            if (record.type === 'attributes') changed ||= (record.target === root || Object.values(elements).includes(record.target) || elements.widgets.includes(record.target)) && geometric(record);
            else if(record.type === 'characterData') changed = true;
            else rebind ||= [...record.addedNodes,...record.removedNodes].some(node => node.nodeType === 1 && (Object.values(selectors).some(selector => node.matches?.(selector) || node.querySelector?.(selector)) || node.matches?.(widgetSelector) || node.querySelector?.(widgetSelector)));
        }
        if (rebind) bind(); if (changed || rebind) invalidate();
    }) : null;
    mutations?.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['class','style','aria-hidden']});
    doc.fonts?.addEventListener('loadingdone',invalidate); host.addEventListener?.('resize',invalidate);
    root.addEventListener('stage-layout',invalidate);
    bind(); invalidate();
    return {getSnapshot:() => snapshot,subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},invalidate,
        dispose() {disposed = true; if (pending !== null) cancel(pending); pending = null; observer?.disconnect(); mutations?.disconnect(); doc.fonts?.removeEventListener('loadingdone',invalidate); host.removeEventListener?.('resize',invalidate); root.removeEventListener('stage-layout',invalidate); listeners.clear();}};
}
// Plain skins never request or evaluate the optional first-party renderer chunk.
function createSkinOverlayLoader(load = () => import('/api/dsh-tavern/client-assets/skin-overlay.mjs')) {
    let pending;
    return document => {
        if (!document?.overlay) return Promise.resolve(null);
        if (!pending) pending = Promise.resolve().then(load).catch(error => {pending=null;throw error;});
        return pending;
    };
}
// Atlas frames are views of the owner's decoded image, not independently decoded copies.
function borrowSkinOverlayTextures({definition,handle,entry='skin.json'}) {
    const base=entry.slice(0,entry.lastIndexOf('/')+1), textures={};
    for (const name of definition.atlases) {
        const atlas=handle.files[base+name]?.json;
        const image=atlas && handle.files[base+atlas.meta.image]?.image;
        if (!atlas || !image) throw new Error('Prepared overlay atlas is missing');
        for (const [id,value] of Object.entries(atlas.frames)) {
            const match=id.match(/^(.*)@(\d+)$/), key=match ? match[1] : id, variant=match ? Number(match[2]) : 0;
            (textures[key] ||= [])[variant]={image,frame:value.frame,width:value.sourceSize?.w || value.frame.w,height:value.sourceSize?.h || value.frame.h};
        }
    }
    return textures;
}
function prepareSkinOverlayTextures({definition,handle,entry,owner,createScript,canvas:makeCanvas=() => document.createElement('canvas')}) {
    const textures=borrowSkinOverlayTextures({definition,handle,entry}), allocated=[];
    const base=(entry || 'skin.json').slice(0,(entry || 'skin.json').lastIndexOf('/')+1);
    const glyphs=handle.files[base+'glyphs/'+definition.glyphs+'.json']?.json;
    const script=glyphs && createScript(glyphs,{normalize:text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'')});
    const allocate=(w,h) => {
        const allocation=owner.reserveBytes(Math.ceil(w)*Math.ceil(h)*4), canvas=makeCanvas();
        canvas.width=Math.ceil(w);canvas.height=Math.ceil(h);allocated.push({canvas,allocation});return canvas;
    };
    const dispose=() => {for(const {canvas,allocation} of allocated) {canvas.width=canvas.height=0;allocation.release();}allocated.length=0;};
    try {
        for(const [id,label] of Object.entries(definition.labels || {})) {
            if(!script) throw new Error('Prepared overlay glyph set is missing');
            const size=label.size || 30, image=allocate(script.measure(label.text,size)+size,size*1.8), context=image.getContext('2d');
            context.fillStyle=label.paper || '#ffffff';context.fillRect(0,0,image.width,image.height);
            script.draw(context,label.text,size/2,size*1.2,{size,color:label.ink || '#111111'});
            textures['label:'+id]=[image];
        }
        for(const [id,decal] of Object.entries(definition.decals || {})) {
            const original=textures[decal.frame]?.[0];if(!original) throw new Error('Prepared overlay decal frame is missing');
            const image=allocate(original.width,original.height),context=image.getContext('2d'),f=original.frame;
            context.drawImage(original.image,f.x,f.y,f.w,f.h,0,0,image.width,image.height);
            if(decal.kind==='runes' && script) script.draw(context,decal.text,(decal.u || .5)*image.width,(decal.v || .5)*image.height,{align:'center',size:(decal.size || .08)*image.height,color:decal.ink || '#111111'});
            textures['decal:'+id]=[image];
        }
        return {textures,script,dispose};
    } catch(error) {dispose();throw error;}
}
// pure keyframe model for dsh.performance/1 `keyframes`.
// The host validated the document once at ingress; this module only compiles and samples it. No DOM, no clock.
// The stage's effect definitions and safety policy: the bundle's (stage-effects.cjs, included earlier), else Node's.
const keyframeEffects=policy;
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
// fixed first-party WebGL2 compositor for keyframe layers. One canvas per
// placement; textures are uploaded once from the owner's decoded images. Pack data never reaches a shader as code.
const KEYFRAME_VERTEX = `#version 300 es
in vec2 aPos;
uniform mat3 uMatrix;
uniform mat3 uView;
out vec2 vUv;
out vec2 vRef;
void main() {
  vec3 ref = uMatrix * vec3(aPos, 1.0);
  vUv = aPos; vRef = ref.xy;
  gl_Position = vec4((uView * vec3(ref.xy, 1.0)).xy, 0.0, 1.0);
}`;
const KEYFRAME_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec2 vRef;
uniform sampler2D uTex;
uniform sampler2D uDissolveTex;
uniform sampler2D uMaskTex;
uniform int uSolid;
uniform vec3 uColor;
uniform float uAlpha;
uniform int uDissolve;
uniform int uChannel;
uniform int uInvert;
uniform float uThreshold;
uniform float uSoftness;
uniform int uMask;
uniform mat3 uMaskInverse;
uniform float uMaskAlpha;
uniform float uGain;
uniform vec4 uWave;
uniform float uTime;
out vec4 outColor;
void main() {
  vec4 source = uSolid == 1 ? vec4(1.0) : texture(uTex, vUv);
  if (uSolid == 2) source = vec4(source.a); // text: glyph coverage, coloured by the layer tint
  float alpha = uAlpha;
  if (uDissolve == 1) {
    vec4 d = texture(uDissolveTex, vUv);
    float m = uChannel == 1 ? d.a : d.r;
    if (uInvert == 1) m = 1.0 - m;
    alpha *= uThreshold <= 0.0 ? 1.0 : uThreshold >= 1.0 ? 0.0 :
      uSoftness > 0.0 ? smoothstep(uThreshold - uSoftness * 0.5, uThreshold + uSoftness * 0.5, m) : step(uThreshold, m);
  }
  if (uMask == 1) {
    vec2 mu = (uMaskInverse * vec3(vRef, 1.0)).xy;
    alpha *= any(lessThan(mu, vec2(0.0))) || any(greaterThan(mu, vec2(1.0))) ? 0.0 : texture(uMaskTex, mu).a * uMaskAlpha;
  }
  outColor = vec4(source.rgb * uColor, source.a) * alpha;
  // Additive glow: gain (may exceed 1) and an optional travelling sine across u (cycles, Hz, phase), negative half dropped.
  float glow = uGain * (uWave.x > 0.5 ? max(0.0, sin(6.2831853 * (uWave.y * vUv.x + uWave.z * uTime + uWave.w))) : 1.0);
  outColor.rgb *= glow;
}`;
function createKeyframeCompositor(canvas) {
    const gl = canvas.getContext('webgl2', {alpha:true, premultipliedAlpha:true, antialias:true, depth:false, stencil:false, preserveDrawingBuffer:false});
    if (!gl) throw new Error('WebGL2 is unavailable for keyframe layers');
    const shader = (type, text) => {
        const value = gl.createShader(type); gl.shaderSource(value, text); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
        return value;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, KEYFRAME_VERTEX)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, KEYFRAME_FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const u = Object.fromEntries(['uMatrix','uView','uTex','uDissolveTex','uMaskTex','uSolid','uColor','uAlpha','uDissolve','uChannel','uInvert','uThreshold','uSoftness','uMask','uMaskInverse','uMaskAlpha','uGain','uWave','uTime']
        .map(name => [name, gl.getUniformLocation(program, name)]));
    gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uDissolveTex, 1); gl.uniform1i(u.uMaskTex, 2);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    const textures = new Map();
    // Colour layers are premultiplied; dissolve maps keep their raw channel values.
    function texture(source, premultiplied) {
        const key = premultiplied ? 'p' : 'r';
        let entry = textures.get(source);
        if (entry?.[key]) return entry[key];
        const value = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, wrap, gl.CLAMP_TO_EDGE);
        entry ||= {}; entry[key] = value; textures.set(source, entry);
        return value;
    }
    // Multiply keeps the destination alpha: it darkens the composite below it and never paints over empty canvas.
    // Add keeps it too: light is added (Unity Blend SrcAlpha One) and never occludes the stage under the canvas.
    const blends = {normal:[gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA], add:[gl.ONE, gl.ONE, gl.ZERO, gl.ONE],
        multiply:[gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE], screen:[gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA]};
    return {
        prepare(sources) { for (const [source, premultiplied] of sources) texture(source, premultiplied); },
        // view: {width, height} in device px; the 1600×900 reference canvas is contained and centred.
        draw(draws, {width, height}) {
            if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
            gl.viewport(0, 0, width, height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            const scale = Math.min(width / 1600, height / 900), ox = (width - 1600 * scale) / 2, oy = (height - 900 * scale) / 2;
            gl.uniformMatrix3fv(u.uView, false, [2 * scale / width, 0, 0, 0, -2 * scale / height, 0, 2 * ox / width - 1, 1 - 2 * oy / height, 1]);
            for (const draw of draws) {
                const {layer} = draw;
                gl.blendFuncSeparate(...blends[layer.blend]);
                gl.uniformMatrix3fv(u.uMatrix, false, draw.matrix);
                gl.uniform1i(u.uSolid, layer.kind === 'solid' ? 1 : layer.kind === 'text' ? 2 : 0);
                if (layer.kind !== 'solid') { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture(draw.images.layer(layer), true)); }
                gl.uniform3fv(u.uColor, draw.color); gl.uniform1f(u.uAlpha, draw.alpha);
                const wave = layer.glow?.wave;
                gl.uniform1f(u.uGain, layer.glow ? draw.gain : 1); gl.uniform1f(u.uTime, draw.time || 0);
                gl.uniform4f(u.uWave, wave ? 1 : 0, wave?.cycles || 0, wave?.hz || 0, wave?.phase || 0);
                gl.uniform1i(u.uDissolve, layer.dissolve ? 1 : 0);
                if (layer.dissolve) {
                    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texture(draw.images.file(layer.dissolve.image), false));
                    gl.uniform1i(u.uChannel, layer.dissolve.channel === 'alpha' ? 1 : 0); gl.uniform1i(u.uInvert, layer.dissolve.invert ? 1 : 0);
                    gl.uniform1f(u.uThreshold, draw.threshold); gl.uniform1f(u.uSoftness, layer.dissolve.softness || 0);
                }
                gl.uniform1i(u.uMask, draw.mask ? 1 : 0);
                if (draw.mask) {
                    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texture(draw.images.layer(draw.mask.layer), true));
                    gl.uniformMatrix3fv(u.uMaskInverse, false, draw.mask.inverse); gl.uniform1f(u.uMaskAlpha, draw.mask.alpha);
                }
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        },
        clear() { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
        release(sources) {
            for (const source of sources) { const entry = textures.get(source); if (!entry) continue; for (const value of Object.values(entry)) gl.deleteTexture(value); textures.delete(source); }
        },
        dispose() {
            for (const entry of textures.values()) for (const value of Object.values(entry)) gl.deleteTexture(value);
            textures.clear(); gl.deleteBuffer(buffer); gl.deleteProgram(program);
            gl.getExtension('WEBGL_lose_context')?.loseContext(); canvas.width = canvas.height = 0;
        }
    };
}
// plays a performance's keyframe layers on the runtime's
// tokens. A non-snap phase start (descriptor null) runs the clock from the same foreground time as the performance timeline;
// snaps, skips, history and remounts only show the resting frame (persistent entry end, else nothing). No frame state is
// stored anywhere: the resting frame is derived from the document.
const KEYFRAME_STILL_FADE_MS = 400;
function keyframeDependency(value) {
    const ref = value?.ref;
    return ref && value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === ref.packId && item.ref.assetId === ref.assetId && item.document?.keyframes) || null;
}
// The performance's own document (dsh.performance/1), keyframes or not: its presentation-only fields (shot, holdDialogue).
function performanceOwnDocument(value) {
    const ref = value?.ref;
    return ref && value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === ref.packId && item.ref.assetId === ref.assetId)?.document || null;
}
function keyframeFontFamily(id) {
    const font = typeof tavernFonts !== 'undefined' ? tavernFonts.get(id) : null;
    return (font ? JSON.stringify(font.family) + ', ' : '') + '"Noto Serif SC", "Noto Serif JP", serif';
}
// Text layers are typeset once at 2.5x the reference size (a 3840 px wide stage draws the 1600 px reference at 2.4x, so glyphs
// stay crisp at 4K); the compositor uses only glyph coverage, coloured by the tint.
function keyframeTextCanvas(layer, make = () => document.createElement('canvas')) {
    const k = Math.min(2.5, 4096 / Math.max(layer.width, layer.height)), canvas = make();
    canvas.width = Math.max(1, Math.ceil(layer.width * k)); canvas.height = Math.max(1, Math.ceil(layer.height * k));
    const context = canvas.getContext('2d'), text = layer.text, size = text.size * k, line = size * (text.lineHeight ?? 1.2);
    const rows = text.value.split('\n'), align = text.align || 'center';
    context.font = size + 'px ' + keyframeFontFamily(text.font);
    context.letterSpacing = (text.letterSpacing || 0) * k + 'px';
    context.textAlign = align; context.textBaseline = 'middle';
    const x = align === 'left' ? 0 : align === 'right' ? canvas.width : canvas.width / 2, top = canvas.height / 2 - line * (rows.length - 1) / 2;
    rows.forEach((row, index) => context.fillText(row, x, top + index * line));
    return canvas;
}
// Fonts are prepared before the performance group is accepted, i.e. before the clock starts.
function keyframeFonts(value) {
    const layers = (value?.dependencies || []).flatMap(item => item.document?.keyframes?.layers || []).filter(layer => layer.text);
    return Promise.all(layers.map(async layer => {
        if(closed)return;
        if (typeof tavernFonts !== 'undefined') await tavernFonts.ensure(layer.text.font).catch(() => null);
        if(closed)return;
        await document.fonts?.load(layer.text.size + 'px ' + keyframeFontFamily(layer.text.font), layer.text.value).catch(() => null);
    }));
}
// onPlayback: what the stage's presentation follows -
// {document, value, phase: 'entry' | 'exit' (a keyframe phase is playing) | 'rest' (the performance holds, nothing plays)}
// or null (no performance holds). Reported on change only; history, skip and remounts report 'rest' at once.
function rawKeyframeLayer({root, owner, foreground, rects, safety = () => ({}), onPresentation = () => {}, onPlayback = () => {}, canvas: makeCanvas = () => document.createElement('canvas')}) {
    const surfaces = {}, prepared = new Map();
    let shown = null, frame = null, disposed = false, policy = safety(), presentation = null, playbackKey = 'null';
    function playback(value, phase) {
        const document = value && performanceOwnDocument(value), next = document ? {document, value, phase} : null;
        const key = JSON.stringify(next && [next.value.instanceKey, next.value.ref, next.value.startedAt, next.value.topic, phase]);
        if (key !== playbackKey) { playbackKey = key; onPlayback(next); }
    }
    function present(entry) {
        const next = entry?.presentation || null;
        if (next !== presentation) { presentation = next; onPresentation(next); }
    }
    const tokenKey = token => JSON.stringify(token || null);
    function prepare(value, handles) {
        const dependency = keyframeDependency(value);
        if (!dependency) return null;
        if (prepared.has(dependency.identity)) { const entry=prepared.get(dependency.identity); entry.presentation=value; return entry; }
        const handle = handles.find(item => item.identity === dependency.identity);
        const model = compilePerformanceKeyframes(dependency.document), base = (dependency.entry || 'performance.json').replace(/[^/]*$/, '');
        const file = name => {
            const image = handle?.files[base + name]?.image;
            if (!image) throw new Error('Keyframe image is missing: ' + name);
            return image;
        };
        const texts = new Map(model.layers.filter(layer => layer.text).map(layer => [layer.id, keyframeTextCanvas(layer, makeCanvas)]));
        const images = {file, layer:layer => layer.kind === 'text' ? texts.get(layer.id) : file(layer.image)};
        const sources = new Map();
        for (const layer of model.layers) {
            if (layer.kind !== 'solid') sources.set(images.layer(layer), true);
            if (layer.dissolve) sources.set(file(layer.dissolve.image), sources.get(file(layer.dissolve.image)) || false);
        }
        let bytes = 0;
        for (const source of sources.keys()) bytes += Math.ceil((source.naturalWidth || source.width) * (source.naturalHeight || source.height) * 4 * 4 / 3);
        const entry = {identity:dependency.identity, presentation:value, document:dependency.document, model, images, sources, allocation:owner.reserveBytes(bytes), placements:new Set(model.layers.map(layer => layer.placement))};
        prepared.set(dependency.identity, entry);
        return entry;
    }
    function surface(placement) {
        if (surfaces[placement]) return surfaces[placement];
        const node = makeCanvas();
        node.className = 'fork-performance-keyframes ' + (placement === 'above-dialogue' ? 'is-above' : 'is-below');
        node.setAttribute('aria-hidden', 'true'); root.appendChild(node);
        try{return surfaces[placement] = {node, compositor:createKeyframeCompositor(node), allocation:null, uploaded:new Set()};}
        catch(error){node.remove();throw error;}
    }
    function view(target) {
        const screen = rects.getSnapshot().screen, ratio = galResolution("high");
        const width = Math.max(1, Math.round(screen.w * ratio)), height = Math.max(1, Math.round(screen.h * ratio));
        if (target.allocation?.bytes !== width * height * 4) { target.allocation?.release(); target.allocation = owner.reserveBytes(width * height * 4); }
        return {width, height};
    }
    function draw(entries, opacity = 1) {
        present(entries[0]?.entry);
        const used = new Set();
        for (const {entry, states} of entries) for (const placement of entry.placements) {
            const target = surface(placement);
            if (!target.uploaded.has(entry)) { target.compositor.prepare(entry.sources); target.uploaded.add(entry); }
            used.add(placement);
        }
        for (const [placement, target] of Object.entries(surfaces)) {
            if (!used.has(placement)) { target.compositor.clear(); continue; }
            const draws = entries.flatMap(({entry, states, still, t}) => keyframeDrawList(entry.model, states, placement, {still, t, photosensitive:policy.photosensitive !== false || !!policy.calm})
                .map(item => ({...item, alpha:item.alpha * opacity, images:entry.images})));
            target.compositor.draw(draws, view(target));
        }
    }
    // Drops GPU textures and allocations no longer needed by the shown performance (and its retiring exit).
    function retain(keep) {
        for (const [identity, entry] of prepared) {
            if (keep.has(entry)) continue;
            for (const target of Object.values(surfaces)) if (target.uploaded.delete(entry)) target.compositor.release(entry.sources.keys());
            entry.allocation.release(); prepared.delete(identity);
        }
        if (!prepared.size) for (const [placement, target] of Object.entries(surfaces)) {
            target.compositor.dispose(); target.allocation?.release(); target.node.remove(); delete surfaces[placement];
        }
    }
    function stopClock() {const old=frame;frame=null;if(old!==null)foreground.cancelAnimationFrame(old);}
    // Resting frame: a persistent performance outside its exit holds the entry end; everything else leaves no layer.
    function rest(value, entry) {
        stopClock();
        const holding = entry && entry.model.playback === 'persistent' && value.phase !== 'exit';
        // A performance without keyframes holds from its start to its exit (phase-free).
        playback(holding || !entry && value.phase !== 'exit' ? value : null, 'rest');
        shown = holding ? {entry, instanceKey:JSON.stringify(value.instanceKey), token:null} : null;
        retain(new Set(holding ? [entry] : []));
        if (holding) draw([{entry, states:entry.model.entryEnd}]);
        else present(null);
    }
    function tick() {
        frame = null;
        if (disposed || !shown?.segments) return;
        const t = foreground.now() - shown.startedAt, segment = shown.segments.find(item => t < item.from + item.duration);
        if (!segment) { rest(shown.value, shown.entry); return; }
        const local = Math.max(0, t - segment.from), still = !!policy.reducedMotion;
        playback(segment.entry === shown.entry ? shown.value : segment.entry.presentation, segment.phase);
        if (!still) { shown.still = null; draw([{entry:segment.entry, states:sampleKeyframePhase(segment.entry.model, segment.phase, local), t:local}]); }
        else {
            // 减少动态: one static composite (entry end for a persistent entry, else the phase midpoint), opacity-only fades.
            const persistentEntry = segment.phase === 'entry' && segment.entry.model.playback === 'persistent';
            const states = persistentEntry ? segment.entry.model.entryEnd : sampleKeyframePhase(segment.entry.model, segment.phase, segment.duration / 2);
            const fade = Math.min(KEYFRAME_STILL_FADE_MS, segment.duration / 2);
            const opacity = Math.min(1, local / fade, persistentEntry ? 1 : (segment.duration - local) / fade);
            // The held composite is drawn once; only the fades redraw.
            if (opacity < 1 || shown.still !== segment) draw([{entry:segment.entry, states, still:true, t:persistentEntry ? segment.duration : segment.duration / 2}], Math.max(0, opacity));
            shown.still = opacity < 1 ? null : segment;
        }
        frame = foreground.requestAnimationFrame(tick);
    }
    function start(intent, entry) {
        stopClock();
        const value = intent.value, segments = [], retiring = value.retiring;
        let offset = 0;
        if (retiring) {
            offset = retiring.plan?.durationMs || 0;
            const old = shown?.entry;
            if (old && old.model.exit && shown.instanceKey === JSON.stringify(retiring.instanceKey))
                segments.push({entry:old, phase:'exit', from:0, duration:old.model.exit.durationMs});
        }
        if (entry && value.phase === 'entry') segments.push({entry, phase:'entry', from:offset, duration:entry.model.entry.durationMs});
        if (entry && value.phase === 'exit' && entry.model.exit) segments.push({entry, phase:'exit', from:offset, duration:entry.model.exit.durationMs});
        if (!segments.length) { rest(value, entry); return; }
        retain(new Set(segments.map(item => item.entry)));
        for (const target of Object.values(surfaces)) root.appendChild(target.node); // stay after a re-created text box
        shown = {entry, value, instanceKey:JSON.stringify(value.instanceKey), token:tokenKey(intent.token), segments, startedAt:foreground.now()};
        tick();
    }
    return {
        apply(intent) {
            if (disposed) return;
            if (intent.type === 'clear') { stopClock(); shown = null; retain(new Set()); present(null); playback(null); return; }
            if (intent.type === 'cancel') {
                if (shown?.segments && shown.token === tokenKey(intent.token)) rest(shown.value, shown.entry);
                return;
            }
            if (intent.type !== 'layer') return;
            const playing = shown?.segments && shown.token === tokenKey(intent.token);
            if (intent.descriptor && intent.descriptor.do !== 'phase-end') return;
            if (playing && !intent.descriptor && intent.snap) return; // the same playback re-presented ('keep')
            let entry = null;
            try { entry = prepare(intent.value, intent.handles || []); }
            catch (error) { console.warn('Keyframe performance rejected', error); rest(intent.value, null); return; }
            if (!intent.snap && !intent.descriptor) {
                if (playing) return;
                start(intent, entry); return;
            }
            // Phase end or a snap (seek, skip, history, cancel): the resting frame for the accepted value.
            if (playing && intent.descriptor && !intent.snap && foreground.now() - shown.startedAt < shown.segments.at(-1).from + shown.segments.at(-1).duration) {
                shown.value = intent.value; return; // the clock ends the last frame itself
            }
            rest(intent.value, entry);
        },
        refreshPolicy() {
            policy = safety();
            if (shown && !shown.segments) draw([{entry:shown.entry, states:shown.entry.model.entryEnd}]);
        },
        redraw() { if (shown && !shown.segments) draw([{entry:shown.entry, states:shown.entry.model.entryEnd}]); },
        dispose() { if (disposed) return; disposed = true;shown=null;cleanupAll([stopClock,()=>retain(new Set())]); }
    };
}
// presentation-only layers borrow the session owner's handles; no leases or playback owner.
function rawSkinLayer({root,owner,foreground,rects,onChange,onCue=()=>{},onPresented=()=>{},onPresentation=()=>{},onPlayback=()=>{},safety=()=>({}),load=createSkinOverlayLoader()},register) {
    let epoch=0,disposed=false,player=null,prepared=null,skinPin=null,skinKey='',phaseKey='',current=null,frame=null,flash=null,loading=null,phaseIntent=null,visibleSkin=null,loadingKey='';
    const under=document.createElement('canvas'),over=document.createElement('canvas'),pulse=document.createElement('div');
    under.className='fork-performance-under';over.className='fork-performance-over';pulse.className='fork-performance-flash';
    for(const node of [under,over,pulse]) {register(()=>node.remove());node.setAttribute('aria-hidden','true');root.appendChild(node);}
    // Keyframe layers (dsh.performance/1 `keyframes`) follow the same intents; their canvases exist only while shown.
    const keyframes=createPerformanceKeyframeLayer({root,owner,foreground,rects,safety,onPresentation,onPlayback});
    register(()=>keyframes.dispose());
    register(rects.subscribe(()=>keyframes.redraw()));
    register(galResolutionSubscribe(()=>keyframes.redraw()));
    const key=ref=>JSON.stringify([ref?.packId,ref?.kind,ref?.assetId]);
    const empty=()=>({skin:null,look:null,ambience:null,widgets:[],snap:true,skinMode:null});
    function stopTransient() {
        const oldFrame=frame,oldFlash=flash;frame=flash=null;
        cleanupAll([()=>foreground.cancelAnimationFrame(oldFrame),()=>foreground.cancelAnimationFrame(oldFlash)]);
        pulse.style.opacity='0';root.style.removeProperty('--performance-shake-x');root.style.removeProperty('--performance-shake-y');
    }
    function clearSkin() {epoch++;const oldPlayer=player,oldPrepared=prepared,oldPin=skinPin;player=prepared=skinPin=null;skinKey=phaseKey='';loading=null;cleanupAll([()=>oldPlayer?.dispose(),()=>oldPrepared?.dispose(),()=>oldPin?.release()]);}
    function event(descriptor) {
        if(!descriptor) return;
        // The stage's one safety policy (stage-effects.cjs): a timeline flash keeps its colour, passes the stage-wide
        // three-a-second gate and is softened under 光敏保护 (OS reduced motion counts as it); a shake waits for 减少动态 only.
        const policy=safety();
        if(descriptor.do==='flash') {
            const raw={color:descriptor.color,peak:descriptor.alpha ?? .5,in:0,hold:descriptor.ms/1000,out:0,tail:0,cycles:1};
            if(stageFlashDark(raw) || stageFlashGate.admit(policy)) {
                const spec=stageFlashSafe(raw,policy),start=foreground.now();
                pulse.style.background=spec.color;foreground.cancelAnimationFrame(flash);
                const step=()=>{if(disposed)return;const alpha=stageFlashAt(spec,foreground.now()-start);if(alpha<0){pulse.style.opacity='0';flash=null;return;}pulse.style.opacity=String(alpha);flash=foreground.requestAnimationFrame(step);};step();
            }
        }
        if(descriptor.do==='shake' && !policy.reducedMotion) {
            foreground.cancelAnimationFrame(frame);const start=foreground.now();
            const step=()=>{if(disposed)return;const t=(foreground.now()-start)/descriptor.ms;if(t>=1){root.style.removeProperty('--performance-shake-x');root.style.removeProperty('--performance-shake-y');frame=null;return;}
                root.style.setProperty('--performance-shake-x',Math.sin(t*51)*descriptor.amp*(1-t)+'px');root.style.setProperty('--performance-shake-y',Math.cos(t*37)*descriptor.amp*(1-t)+'px');frame=foreground.requestAnimationFrame(step);};step();
        }
    }
    let presentedKey='';
    const receiptFrames=new Set();
    register(()=>{const ids=[...receiptFrames];receiptFrames.clear();cleanupAll(ids.map(id=>()=>foreground.cancelAnimationFrame(id)));});
    function receiptFrame(callback){if(disposed)return;const id=foreground.requestAnimationFrame(()=>{receiptFrames.delete(id);if(!disposed)callback();});receiptFrames.add(id);}
    function presented(intent) {
        const key=JSON.stringify([intent.value.instanceKey,intent.token?.phaseKey]);
        if(key===presentedKey)return;
        // Wait through a rendered frame; accepting a director prefix is not presentation.
        receiptFrame(()=>receiptFrame(()=>{
            if(!disposed && current===intent && root.isConnected && key!==presentedKey) {presentedKey=key;onPresented(intent);}
        }));
    }
    function output(intent) {
        const {value,layer,snap}=intent,dependency=ref=>value.dependencies.find(item=>key(item.ref)===key(ref));
        const skin=layer.skin && dependency(layer.skin.ref),look=layer.look && dependency(layer.look.ref),ambience=layer.ambience && dependency(layer.ambience.ref);
        const widgets=Object.entries(layer.widgets || {}).flatMap(([slot,widget],index)=>{
            const grant=value.executionDependencies?.find(item=>key(item.ref)===key(widget.ref));
            return grant?.definition ? [{widgetId:JSON.stringify([value.instanceKey,slot]),originKey:JSON.stringify(value.instanceKey),instanceId:grant.definition.revision,mediaPolicy:grant.mediaPolicy,
                ref:widget.ref,state:widget.state || grant.state,slot,slotExplicit:true,bornAt:0,order:index,definition:grant.definition,lifetime:{until:'explicit'}}] : [];
        });
        // skinMode: the mode the current performance's document declares - the stage skin's modes.<skinMode> (stage-skin-adv.md「modes」).
        const own=value.dependencies?.find(item => item.ref?.kind === 'performances' && item.ref.packId === value.ref?.packId && item.ref.assetId === value.ref?.assetId);
        return {skin:skin ? {...skin,level:layer.skin.level ?? value.level} : null,look,ambience:ambience ? {...ambience,gain:10**((layer.ambience.gainDb || 0)/20)} : null,widgets,snap:!!snap,skinMode:own?.document?.skinMode || null};
    }
    async function apply(intent) {
        if(disposed) return;
        keyframes.apply(intent);
        if(intent.type==='cancel') {stopTransient();return;}
        if(intent.type==='clear') {stopTransient();clearSkin();current=null;visibleSkin=null;onChange(empty());return;}
        current=intent;
        const next=output(intent),desired=next.skin;
        onChange({...next,skin:desired?.document.overlay && desired.identity!==skinKey ? visibleSkin : desired});event(intent.descriptor);
        if(intent.descriptor?.do==='skin-off' && player && !intent.snap) {
            visibleSkin=null;phaseIntent=intent;player.setPhase({phase:'exit',level:intent.value.level,ordinal:intent.descriptor.ordinal});return;
        }
        if(!desired?.document.overlay) {clearSkin();visibleSkin=desired;presented(intent);return;}
        const phase=intent.snap || intent.descriptor?.do === 'phase-end' ? 'idle' : intent.descriptor?.block === 'turn' ? 'turn' : intent.value.phase;
        const nextSkinKey=desired.identity, nextPhaseKey=JSON.stringify([intent.token?.phaseKey,desired.level,intent.snap,phase]);
        const setPhase=()=>{
            if(phaseKey===nextPhaseKey) return;
            phaseKey=nextPhaseKey;phaseIntent=intent;
            player.setPhase({phase,level:desired.level,snap:intent.snap,ordinal:intent.descriptor?.ordinal ?? 0});
        };
        if(player && skinKey===nextSkinKey) {if(intent.descriptor?.do === 'skin' || intent.descriptor?.do === 'phase-end' || intent.snap) setPhase();presented(intent);return;}
        if(loading && loadingKey===nextSkinKey) return loading;
        const version=++epoch;loadingKey=nextSkinKey;
        let candidate=null,candidatePin=null;
        try {
            loading=load(desired.document);
            const renderer=await loading;
            if(disposed || version!==epoch) return;
            const handle=intent.handles.find(item=>item.identity===desired.identity);
            if(!handle) throw new Error('Prepared performance skin handle is missing');
            candidate=prepareSkinOverlayTextures({definition:desired.document.overlay,handle,entry:desired.entry,owner,createScript:renderer.createDecorativeScript});
            const screen=rects.getSnapshot().screen;
            // Budget the new pair while the old pair is still held; refusal preserves last-good.
            const probe=owner.reserveBytes(Math.ceil(screen.w)*Math.ceil(screen.h)*8);probe.release();
            if(intent.authority!==undefined) {candidatePin=owner.retain(desired.identity,intent.authority);if(!candidatePin)throw new Error('Performance skin was revoked');}
            player?.dispose();prepared?.dispose();skinPin?.release();skinPin=candidatePin;candidatePin=null;prepared=candidate;candidate=null;
            skinKey=nextSkinKey;phaseKey='';visibleSkin=desired;onChange(next);
            player=renderer.createSkinOverlayPlayer({definition:{id:desired.document.id,...desired.document.overlay},intensity:desired.level,textures:prepared.textures,script:prepared.script,rects,foreground,owner,under,over,
                reducedMotion:!!safety().reducedMotion,calm:!!safety().calm,snap:intent.snap,
                onCue:cue=>onCue({...cue,atMs:(phaseIntent?.descriptor?.at || 0)+cue.atMs,token:phaseIntent?.token}),
                onSkinSwap:()=>{if(version===epoch && current) onChange({...output(current),snap:true});},onError:error=>console.warn('Performance overlay rejected',error)});
            setPhase();presented(intent);
        } catch(error) {candidate?.dispose();candidatePin?.release();if(version===epoch){onChange({...next,skin:visibleSkin});console.warn('Performance overlay rejected',error);}}
        finally {if(version===epoch){loading=null;loadingKey='';}}
    }
    return {apply,refreshPolicy(){keyframes.refreshPolicy();const policy=safety();player?.setSafety({reducedMotion:!!policy.reducedMotion,calm:!!policy.calm});if(policy.reducedMotion)stopTransient();},dispose(){if(disposed)return;disposed=true;cleanupAll([stopTransient,clearSkin]);}};
}
// The one safety policy (stage-effects.cjs stageSafety); the name stays for the performance layer's callers.
function performanceSafety(reading,osReduced) {return stageSafety(reading,osReduced);}
function usePerformanceLayer(rootRef,sessionId,reading) {
    const [value,setValue]=React.useState({skin:null,look:null,ambience:null,widgets:[],snap:true,skinMode:null});
    const [performance,setPerformance]=React.useState(null),[playback,setPlayback]=React.useState(null);
    const ref=React.useRef(null),policy=React.useRef(reading),cue=React.useRef(null);policy.current=reading;
    const accept=React.useCallback(intent=>{if(intent.cue)cue.current=intent.cue;return ref.current?.apply(intent);},[]);
    React.useLayoutEffect(()=>{
        const root=rootRef.current;if(closed||!root)return;
        const sessionRuntime=runtime;
        setPerformance(null);setPlayback(null);
        const release=createScope(register=>{
        const rects=createStageRects({root,schedule:fn=>forkForeground.requestAnimationFrame(fn),cancel:id=>forkForeground.cancelAnimationFrame(id)});
        register(()=>rects.dispose());
        ref.current=createPerformanceSkinLayer({root,rects,owner:sessions().resourceOwner,foreground:forkForeground,onChange:setValue,onPresentation:setPerformance,onPlayback:setPlayback,onCue:event=>cue.current?.(event),
            onPresented:intent=>sessionRuntime.presented(sessionId,{performanceId:JSON.stringify(intent.value.instanceKey),phase:intent.value.phase || 'idle'}),
            // only the explicit CONFIG choice freezes; the OS preference (e.g. Windows
            // "show animations" off) is calm: rituals and idle stepping stay, softened.
            safety:()=>performanceSafety(policy.current,window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)});
        const layer=ref.current;register(()=>{if(ref.current===layer)ref.current=null;layer.dispose();});
        const media=window.matchMedia?.('(prefers-reduced-motion: reduce)'),changed=()=>ref.current?.refreshPolicy();
        register(()=>media?.removeEventListener?.('change',changed));
        media?.addEventListener?.('change',changed);
        register(()=>{cue.current=null;});
        });
        return release;
    },[sessionId]);
    React.useEffect(()=>{ref.current?.refreshPolicy();},[reading.reducedMotion,reading.photosensitive]);
    return {...value,performance,playback,accept,cue:event=>cue.current?.(event)};
}
const overlay=createSkinOverlayLoader();
return {useLayer:usePerformanceLayer,createKeyframeLayer:createPerformanceKeyframeLayer,createSkinLayer:createPerformanceSkinLayer,createRects:createStageRects,safety:performanceSafety,
    prepare(value){if(closed)return Promise.reject(new Error('Stage performance disposed'));return Promise.all([keyframeFonts(value),...value.dependencies.filter(item=>item.document?.overlay).map(item=>overlay(item.document))]);},
    dispose(){if(closed)return;closed=true;cleanupAll([...owned].reverse());}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStagePerformanceSurface};
