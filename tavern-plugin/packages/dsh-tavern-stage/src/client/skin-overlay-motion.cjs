'use strict';
// format-independent, deterministic collage motion. No DOM or wall clock.
function skinOverlaySeed(text) {
    let n = 2166136261;
    for (const c of String(text)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
    return n >>> 0;
}
function skinOverlayRandom(seed, step) {
    let n = (seed + Math.imul(step + 1, 0x6d2b79f5)) | 0;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
function createSkinOverlayClock(seed, fps = 7, intensity = 2) {
    const rate = Math.min(12, fps * (intensity === 3 ? 1.5 : 1)), interval = 1000 / rate;
    let step = 0, at = -skinOverlayRandom(seed, -1) * interval;
    let next = at + interval * (0.82 + 0.36 * skinOverlayRandom(seed, 0));
    return {
        sample(time) {
            while (time >= next) { at = next; step++; next += interval * (0.82 + 0.36 * skinOverlayRandom(seed, step)); }
            return {step, at, next};
        }
    };
}
function skinOverlayAnchor(rects, anchor, alternate) {
    const a = rects[anchor?.r] ? anchor : alternate;
    const rect = a && rects[a.r];
    if (!rect) return null;
    const unit = rects.screen.h / 900;
    return {x:rect.x + rect.w * (a.u || 0) + (a.dx || 0) * unit,
        y:rect.y + rect.h * (a.v || 0) + (a.dy || 0) * unit, rect, anchor:a};
}
function skinOverlayCorners(pose, width, height, pivot = [0.5,0.5]) {
    const angle = pose.rot * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    return [[0,0],[1,0],[1,1],[0,1]].map(([u,v]) => {
        const x = (u - pivot[0]) * width * pose.s * pose.sx, y = (v - pivot[1]) * height * pose.s * pose.sy;
        return {x:pose.x + x*c - y*s, y:pose.y + x*s + y*c};
    });
}
function skinOverlayIntersects(points, rect) {
    if (!rect || rect.w <= 0 || rect.h <= 0) return false;
    const box = [{x:rect.x,y:rect.y},{x:rect.x+rect.w,y:rect.y},{x:rect.x+rect.w,y:rect.y+rect.h},{x:rect.x,y:rect.y+rect.h}];
    const axes = [{x:1,y:0},{x:0,y:1}];
    for (let i = 0; i < 2; i++) axes.push({x:points[i+1].y-points[i].y,y:points[i].x-points[i+1].x});
    return axes.every(axis => {
        if (!axis.x && !axis.y) return true;
        const a = points.map(p => p.x*axis.x+p.y*axis.y), b = box.map(p => p.x*axis.x+p.y*axis.y);
        return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a);
    });
}
function skinOverlayForbidden(rects) {
    return [rects.text,rects.qm,rects.side,rects.choices,...(rects.widgets || [])].filter(Boolean);
}
function skinOverlayPoseSafe(pose, size, pivot, rects) {
    const corners = skinOverlayCorners(pose,size.w,size.h,pivot);
    return !skinOverlayForbidden(rects).some(rect => skinOverlayIntersects(corners,rect));
}
function skinOverlayIdle(piece, step, pose, point, unit, phase) {
    for (const m of piece.idle || []) {
        const k = step + phase + (m.phase || 0), period = m.period || 8;
        const cycle = ((k % period) + period) % period;
        if (m.op === 'spin') pose.rot += m.deg * step;
        if (m.op === 'sway') pose.rot += m.deg * Math.sin(Math.PI*2*k/period);
        if (m.op === 'bob') pose.y += m.px * unit * Math.sin(Math.PI*2*k/period);
        if (m.op === 'hop') {
            pose.y -= m.px * unit * Math.max(0,Math.sin(Math.PI*cycle/Math.max(1,period-1)));
            if (cycle === 0) {pose.sx *= 1.08; pose.sy *= 0.86;}
        }
        if (m.op === 'pulse') pose.s *= 1 + (cycle < period/2 ? m.amt || 0.05 : 0);
        if (m.op === 'flap') {const seq = m.seq || [1,0.6,0.25,0.6]; pose[m.axis === 'x' ? 'sx' : 'sy'] *= seq[((k%seq.length)+seq.length)%seq.length];}
        if (m.op === 'crawl') {
            const span = Math.max(1,(m.u1-m.u0)*point.rect.w), d = ((k*m.px*unit)%(2*span)+2*span)%(2*span), forward = d < span;
            pose.x = point.rect.x + point.rect.w*m.u0 + (forward ? d : 2*span-d) + (point.anchor.dx || 0)*unit;
            if (m.face) pose.sx *= forward ? m.face : -m.face;
            pose.rot += m.wiggle ? (step%2 ? 1 : -1)*m.wiggle : 0;
        }
        if (m.op === 'swap') {const i = Math.floor(step/(m.hold || 1)); pose.frame = m.seq[m.once ? Math.min(m.seq.length-1,i) : i%m.seq.length];}
        if (m.op === 'blink') pose.alpha = cycle === 0 ? 0 : 1;
        if (m.op === 'flip') pose.sx *= cycle < period/2 ? 1 : -1;
    }
}
function skinOverlayTransition(pose, transition, progress, unit, entering) {
    if (progress >= 1) return;
    const t = entering ? 1 + 2.9*Math.pow(progress-1,3) + 1.9*Math.pow(progress-1,2) : 1-progress*progress;
    const f = 1-t, distance = (transition.dist || 520)*unit, edge = transition.from || transition.to || 'pop';
    if (edge === 'left') pose.x -= distance*f;
    else if (edge === 'right') pose.x += distance*f;
    else if (edge === 'top') pose.y -= distance*f;
    else if (edge === 'bottom') pose.y += distance*f;
    else pose.s *= Math.max(0.01,t);
    pose.rot += (transition.spin ?? 25)*f;
}
// snap skips one-shot transitions only (history/seek): the idle step loop keeps running on every page.
// reducedMotion is the explicit in-app choice (static); tempo < 1 is the softened OS preference.
function createSkinOverlayMotion({id, pieces, intensity = 2, reducedMotion = false, snap = false, tempo = 1}) {
    const states = pieces.map(piece => {
        const seed = skinOverlaySeed(id + ':' + piece.id);
        return {piece,seed,phase:Math.floor(skinOverlayRandom(seed,1)*16),clock:createSkinOverlayClock(seed,piece.fps || 6+Math.round(skinOverlayRandom(seed,2)*4)/2,intensity),lastStep:-1,pose:null,anchor:null,hop:0};
    });
    let exitAt = null, turnAt = null;
    return {
        exit(time) {exitAt ??= time;}, turn(time) {turnAt = time;},
        sample(time, rects, sizes) {
            const unit = rects.screen.h/900, drawn = [];
            for (const state of states) {
                const p = state.piece;
                if ((p.intensity || 1) > intensity) continue;
                const point = skinOverlayAnchor(rects,p.at,p.alt);
                if (!point) {state.pose = null; continue;}
                const clock = state.clock.sample(reducedMotion ? 0 : time*tempo), k = clock.step;
                const enter = p.enter || {from:'pop',steps:4}, elapsed = Math.max(0,time-(enter.at || 0));
                if (!snap && !reducedMotion && time < (enter.at || 0)) continue;
                const over = p.layer === 'over' || p.layer === 'front';
                const anchorChanged = !state.anchor || state.anchor.x !== point.x || state.anchor.y !== point.y || state.anchor.w !== point.rect.w;
                if (k !== state.lastStep || !state.pose || over && anchorChanged || snap) {
                    const pose = {x:point.x,y:point.y,rot:p.rot || 0,s:1,sx:p.flip ? -1 : 1,sy:1,alpha:1,frame:0,variant:0,k};
                    if (!reducedMotion) skinOverlayIdle(p,k,pose,point,unit,state.phase);
                    if (!over && !snap && !reducedMotion && state.anchor && anchorChanged && !state.hop) state.hop = 2;
                    if (state.hop && state.pose) {
                        if (state.hop === 2) {pose.x = state.pose.x+(pose.x-state.pose.x)*0.55; pose.y = state.pose.y+(pose.y-state.pose.y)*0.55-6*unit;}
                        state.hop--;
                    }
                    if (!snap && !reducedMotion) {
                        const enterStep = Math.floor(elapsed*(p.fps || 7)/1000);
                        skinOverlayTransition(pose,enter,Math.min(1,(enterStep+1)/(enter.steps || 4)),unit,true);
                        // Turn pulses are explicit presentation events, not persisted clocks.
                        if (turnAt !== null && time-turnAt < 400) pose.s *= 1.04;
                    }
                    if (!reducedMotion) {
                        pose.variant = (k + (skinOverlayRandom(state.seed,3) > 0.5 ? 1 : 0))%4;
                        pose.rot += (skinOverlayRandom(state.seed,k+5)-0.5)*1.4;
                        pose.x = Math.round((pose.x+(skinOverlayRandom(state.seed,k+9)-0.5)*2*unit)/(2*unit))*2*unit;
                        pose.y = Math.round((pose.y+(skinOverlayRandom(state.seed,k+11)-0.5)*2*unit)/(2*unit))*2*unit;
                    }
                    state.pose = pose; state.lastStep = k; state.anchor = {x:point.x,y:point.y,w:point.rect.w};
                }
                const pose = {...state.pose}, size = sizes[p.frames ? p.frames[pose.frame] : p.img];
                if (!size) continue;
                if (exitAt !== null) {
                    if (snap || reducedMotion) continue;
                    const leave = p.exit || {to:enter.from,steps:enter.steps || 4};
                    const progress = Math.floor(Math.max(0,clock.at-exitAt)*(p.fps || 7)/1000)/(leave.steps || 4);
                    if (progress >= 1) continue;
                    skinOverlayTransition(pose,leave,progress,unit,false);
                }
                const h = p.h*unit, w = h*size.w/size.h;
                if (over && !skinOverlayPoseSafe(pose,{w,h},p.pivot,rects)) continue;
                drawn.push({piece:p,pose,w,h});
            }
            return drawn;
        }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined' && module.exports) module.exports = {skinOverlaySeed,skinOverlayRandom,createSkinOverlayClock,skinOverlayAnchor,skinOverlayCorners,skinOverlayIntersects,skinOverlayPoseSafe,createSkinOverlayMotion};
