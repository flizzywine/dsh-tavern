'use strict';
function createStageTimer({React, rpc, window, crypto, performance, setInterval, clearInterval, timerClockRemaining, Icon, foreground:forkForeground, ResizeObserver, MutationObserver, getResourceOwner, resourceAuthority, createRects, createKeyframeLayer, useModOptions, performanceSafety}) {
let disposed = false;
const cleanups = new Set(), timerSeenEvents = new Set();
function ownCleanup(release) {
    let live = true;
    const stop = () => {if (!live) return; live = false; cleanups.delete(stop); release();};
    if (disposed) stop(); else cleanups.add(stop);
    return stop;
}
function timerLook(answer, builtin) {
    if (!answer || !builtin) return null;
    const v = answer.values, media = name => name && answer.media?.[name] || null;
    return {kind:v.look === 'plate' ? 'plate' : 'pill', format:v.format, plate:media(v.plate), digits:media(v.digits),
        glyphs:v.digits && media(v.digits) ? v.glyphs : null, placement:v.placement, icon:builtin.default,
        pause:v.pauseButton === true, urgent:v.urgentPulse === true, hideExpired:v.hideWhenExpired === true};
}
// The input lock's last word on a fallback offer (contract「Reply fallback UX」): the same live round, still waiting, no
// draft or submission, the window shown, and this event not offered before. Anything else suppresses it (at most once).
function timerFallbackAllowed(offer, now) {
    if (!offer || !offer.action || now.consumed.has(offer.eventId)) return false;
    return now.live === true && now.visible === true && now.waiting === true && now.inputStarted !== true && now.sending !== true &&
        now.running !== true && now.turn === offer.turn && JSON.stringify(now.source) === JSON.stringify(offer.source);
}

// The mod's own built-in art (the pill's icon).
let timerBuiltinRead = null;
function timerBuiltin(sessionId) {
    return timerBuiltinRead ||= rpc('getStageTimerLooks', {}, sessionId).catch(error => { timerBuiltinRead = null; throw error; });
}
// Live events already handed to consumers / fallback offers already given to the input lock, by event id (this page only:
// a refresh never recovers an offer from the saved checkpoint).
const timerConsumedOffers = new Set();

// Input and visibility guard the optional fallback action, not the clock.
function useStageTimerSlot({sessionId, rootRef, reading, source, token, turn, mode, visit, at, offset, waiting, sending, running, skinKey = ''}) {
    const reaction = React.useMemo(() => createReactionScope(), [sessionId,token,turn,at,offset,mode,visit]);
    React.useEffect(() => () => reaction.dispose(), [reaction]);
    const [visible, setVisible] = React.useState(true);
    React.useEffect(() => ownCleanup(forkForeground.subscribe(value => {if (!disposed) setVisible(value);})), []);
    const [inputStarted, setInputStarted] = React.useState(false);
    const fallbackRef = React.useRef(null), gate = React.useRef(null);
    const [notice, setNotice] = React.useState(null);
    const noticeTimer = React.useRef(null);
    React.useEffect(() => ownCleanup(() => {
        if (noticeTimer.current !== null) forkForeground.clearTimeout(noticeTimer.current);
        noticeTimer.current = null;
    }), []);
    gate.current = {consumed:timerConsumedOffers, live:mode === 'live', visible, waiting, inputStarted, sending, running, turn, source:token};
    const state = useStageTimer({sessionId, mode, visit, turn, at, offset, token,
        view:{waitingForInput:waiting, inputStarted},
        onEvent:event => {
            // The one stage event (skin / performance consumers): a DOM event on the stage, then the entry's own onTimeup.
            rootRef.current?.dispatchEvent(new CustomEvent('fork-stage-event', {detail:event}));
            if (event.onTimeup) reaction.play({root:rootRef.current, sessionId, source, turn:event.turn, at:event.at, token:event.source, event,
                safety:() => performanceSafety(reading, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)}).catch(error => console.warn('Timer reaction unavailable', error));
        },
        onFallback:offer => {
            if (!timerFallbackAllowed(offer, gate.current)) return;
            timerConsumedOffers.add(offer.eventId);
            if (!fallbackRef.current?.(offer.action)) return;
            setNotice('时间到，已替你回应：' + offer.action);
            if (noticeTimer.current !== null) forkForeground.clearTimeout(noticeTimer.current);
            noticeTimer.current = forkForeground.setTimeout(() => {noticeTimer.current = null; if (!disposed) setNotice(null);}, 5000);
        }});
    const [builtin, setBuiltin] = React.useState(null);
    React.useEffect(() => {
        let live = true;
        if (!disposed && state.timer && !builtin) timerBuiltin(sessionId).then(value => {if (live && !disposed) setBuiltin(value);}, () => {});
        return () => {live = false;};
    }, [sessionId,!!state.timer]);
    const look = timerLook(useModOptions(sessionId, 'dsh.timer', {enabled:!!state.timer, skinKey}), builtin);
    // shown: the timer is on the stage (StageTimer draws it) - the skin's hud.timer arrangement follows it.
    return {element:React.createElement(StageTimer, {state, look, reducedMotion:reading.reducedMotion === true, notice}),
        shown:Boolean(state.timer && look), onInputActivity:setInputStarted, fallbackRef};
}

// mode: 'live' (writer) | 'history' (saved frame) | 'replay' (private clock); view: the stage's holds right now.
function useStageTimer({sessionId, mode, visit, turn, at, offset = 0, token, view, onEvent, onFallback}) {
    const [data,setData] = React.useState(null), [,tick] = React.useState(0);
    const clock = React.useRef(null);
    if (!clock.current || clock.current.sessionId !== sessionId) clock.current = {sessionId,lease:null,serial:0,applied:0,epoch:0,origin:null,alive:true,replay:new Map()};
    const owner = clock.current, key = JSON.stringify([sessionId,turn,at,offset,token,mode,visit]);
    const latest = React.useRef(null); latest.current = {mode,key,onEvent,onFallback,view,page:mode === 'live' && turn && at ? {turn,at,offset} : {}};
    const wallNow = () => owner.origin === null ? Date.now() : owner.origin + performance.now();
    function accept(value, requestedKey, serial, epoch) {
        if (disposed || !owner.alive || epoch !== owner.epoch) return value;
        if (owner.origin === null && Number.isFinite(value.now)) owner.origin = value.now - performance.now();
        if ((!requestedKey || latest.current.mode === 'live' && latest.current.key === requestedKey) && serial >= owner.applied) {
            owner.liveData = value; owner.applied = serial;
        }
        if (owner.alive && (requestedKey ? latest.current.key === requestedKey : latest.current.mode === 'live')) setData({...value,projectionKey:requestedKey});
        if (value.event && !timerSeenEvents.has(value.event.id)) {
            timerSeenEvents.add(value.event.id);
            if (owner.alive && latest.current.mode === 'live') {
                latest.current.onEvent?.(value.event);
                if (value.fallbackAction) latest.current.onFallback?.({eventId:value.event.id,action:value.fallbackAction,turn:value.event.turn,source:value.event.source});
            }
        }
        return value;
    }
    function update(action, extra = {}, requestedKey) {
        if (disposed || !owner.alive) return Promise.resolve(null);
        const serial = ++owner.serial, epoch = owner.epoch;
        const task = rpc('updateStageTimer', {action,lease:owner.lease,
            waitingForInput:latest.current.view.waitingForInput,inputStarted:latest.current.view.inputStarted,...latest.current.page,...extra}, sessionId).then(value=>accept(value,requestedKey,serial,epoch));
        task.catch(()=>{});
        return task;
    }
    // The lease follows the open stage, not the displayed floor, visibility or playback.
    React.useEffect(() => {
        if (disposed) return;
        owner.alive = true; owner.epoch++;
        if (mode === 'replay') return () => { owner.alive = false; };
        owner.lease = crypto.randomUUID?.() || 'timer-'+Date.now()+'-'+Math.random().toString(36).slice(2);
        update('open');
        const sample = setInterval(() => update('sample'), 10000);
        // Closing must not wait behind a slow page response; keepalive survives page teardown.
        const close = () => rpc('updateStageTimer',{action:'close',lease:owner.lease},sessionId,{keepalive:true}).catch(()=>{});
        window.addEventListener('pagehide', close);
        const stop = () => {
            if (!owner.alive) return;
            cleanups.delete(stop);
            owner.alive = false;
            clearInterval(sample);
            window.removeEventListener('pagehide', close);
            close();
        };
        cleanups.add(stop);
        return stop;
    }, [sessionId,mode === 'replay']);
    React.useEffect(() => {
        if (!token || !turn || !at) return;
        if (mode === 'live') update('visit', {turn,at,offset,mode:'live',expectedDirectionToken:token}, key);
        else { const epoch = owner.epoch; rpc('getStageTimer',{turn,at,offset,mode,expectedDirectionToken:token},sessionId).then(value=>accept(value,key,++owner.serial,epoch)).catch(()=>{}); }
    }, [key]);
    const display = mode === 'live' ? owner.liveData : data?.projectionKey === key ? data : null;
    const checkpoint = display?.checkpoint, timer = display?.timer;
    let remaining = checkpoint?.remainingMs || 0;
    if (mode === 'live' && checkpoint?.clock) remaining = timerClockRemaining(checkpoint,wallNow());
    // Clip export is a private playback clock, never a writer of the live deadline.
    if (mode === 'replay' && timer) {
        const id = JSON.stringify([visit,timer.instanceId]);
        if (!owner.replay.has(id)) owner.replay.set(id,wallNow());
        remaining = Math.max(0,remaining - (wallNow() - owner.replay.get(id)));
    }
    const runs = !!timer && mode !== 'history' && (mode === 'replay' || checkpoint?.clock?.open === true) && remaining > 0;
    React.useEffect(() => {
        if (!runs || disposed) return;
        const frame = setInterval(() => tick(n => n + 1), 40);
        const stop = () => {clearInterval(frame); cleanups.delete(stop);};
        cleanups.add(stop);
        return stop;
    }, [runs,owner]);
    React.useEffect(() => {
        if (mode === 'live' && timer && remaining <= 0 && checkpoint?.status !== 'expired') update('sample');
    }, [mode,timer?.instanceId,remaining <= 0,checkpoint?.status]);
    return {timer:timer || null,status:timer ? remaining <= 0 ? 'expired' : checkpoint.status : null,remaining,
        playerPaused:checkpoint?.playerPaused === true,runs,ticking:runs,live:mode === 'live',
        togglePause() { if (mode === 'live' && timer) update('pause',{playerPaused:checkpoint?.playerPaused !== true}); }};
}

function timerFormat(ms, format) {
    const left = Math.max(0, Math.floor(ms));
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    if (format === 'mm:ss:mmm') return pad(Math.floor(left / 60000)) + ':' + pad(Math.floor(left / 1000) % 60) + ':' + pad(left % 1000, 3);
    const seconds = Math.ceil(left / 1000), h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}
// A sprite-font label laid out like a TMP line (the `glyphs` option a skin carries with its digit sheet): every char is
// [cell, advance, bearing] in font units, `scale` turns font units into px of the placement canvas, `spacing` is the extra
// px per advance, `top` the quad's top above the baseline (font units). The line is centred in the `label` box
// [dx, dy, w, h] (offset from the plate centre), top-aligned at `ascent` px. x / y: each quad's top-left from the plate's.
function timerGlyphs(text, glyphs, [pw, ph]) {
    const k = glyphs.scale, [lx, ly, lw, lh] = glyphs.label, gap = glyphs.spacing;
    const chars = Array.from(text).filter(char => Object.hasOwn(glyphs.chars, char));
    const width = chars.reduce((sum, char) => sum + glyphs.chars[char][1] * k + gap, 0);
    const baseline = ph / 2 + ly - lh / 2 + glyphs.ascent;
    let pen = pw / 2 + lx - width / 2;
    return chars.map(char => {
        const [cell, advance, bearing] = glyphs.chars[char], glyph = {char, cell, x:pen + bearing * k, y:baseline - glyphs.top * k};
        pen += advance * k + gap;
        return glyph;
    });
}
// The timer's look from its resolved options (mod-options.js: skin lock > 本卡 > 全局 > skin > the mod's preset) and
// the mod's own built-in icon. x-skin-asset options name the active skin's media (`media` maps a name to its URL; the
// resolver already put an unavailable one back to its preset ''). Without an answer there is nothing to draw yet. Pure.
function timerClearance(plate, boxes, bounds, gap = 8) {
    const solid = boxes.filter(box => box.r > box.l && box.b > box.t);
    const at = (dx, dy) => ({l:plate.l + dx, t:plate.t + dy, r:plate.r + dx, b:plate.b + dy});
    const inside = p => p.l >= bounds.l && p.r <= bounds.r && p.t >= bounds.t && p.b <= bounds.b;
    const touching = p => solid.find(box => p.l < box.r + gap && p.r > box.l - gap && p.t < box.b + gap && p.b > box.t - gap);
    let dx = 0, dy = 0;
    for (let step = 0; step <= solid.length; step++) {
        const p = at(dx, dy), box = touching(p);
        if (!box) return {dx, dy};
        const moves = [[dx + box.l - gap - p.r, dy], [dx + box.r + gap - p.l, dy], [dx, dy + box.b + gap - p.t]];
        const fit = moves.filter(([x, y]) => inside(at(x, y))).sort((a, b) => Math.abs(a[0] - dx) + Math.abs(a[1] - dy) - Math.abs(b[0] - dx) - Math.abs(b[1] - dy));
        [dx, dy] = fit[0] || moves[2];
    }
    if (!touching(at(dx, dy))) return {dx, dy};
    const above = solid.filter(box => box.l < plate.r + gap && box.r > plate.l - gap && box.t < plate.b + gap);
    return {dx:0, dy:Math.max(0, ...above.map(box => box.b + gap - plate.t))};
}


// The skin's drawn art on the stage (art.buttons, art.decor: stage-skin-buttons.js) the plate keeps clear of.
// A skin mode's own buttons are drawn beside the plate as one HUD group (the debate's fast-forward): not avoided.
// The shared top bar's controls too (the scene chips stand at the top centre, where the pill is): hidden by a
// clip, never removed, so the boxes - and the timer's place - stay put while the bar reveals and hides.
const TIMER_SKIN_ART = '.fork-stage-skin-button:not([data-fk-mode-button]), .fork-stage-skin-decor, .fork-gal-topbar button';
// Keeps the plate clear of the skin's art and the top bar at every window shape: measured when the stage's size, skin tokens
// (its style and marks), layers or the bar's groups (an entry added) change, never per frame; the shift is the layer's
// --tm-dx / --tm-dy (timerClearance).
function useTimerClearance(look) {
    const ref = React.useRef(null);
    React.useLayoutEffect(() => {
        const root = ref.current, stage = root?.closest('.fork-gal-stage') || root?.parentElement;
        if (disposed || !root || !stage) return;
        let live = true;
        let frame = 0;
        const rect = node => { const r = node.getBoundingClientRect(); return {l:r.left, t:r.top, r:r.right, b:r.bottom}; };
        const measure = () => {
            frame = 0;
            if (!live || disposed) return;
            const plate = root.querySelector('.fork-timer-plate, .fork-timer-pill');
            if (!plate) return;
            const ox = parseFloat(root.style.getPropertyValue('--tm-dx')) || 0, oy = parseFloat(root.style.getPropertyValue('--tm-dy')) || 0, p = rect(plate);
            const boxes = [...stage.querySelectorAll(TIMER_SKIN_ART)].filter(node => !root.contains(node)).map(rect);
            // Bounds: the layer itself (the game area under the title strip) where it stands unshifted.
            const area = rect(root);
            const shift = timerClearance({l:p.l - ox, t:p.t - oy, r:p.r - ox, b:p.b - oy}, boxes, {l:area.l - ox, t:area.t - oy, r:area.r - ox, b:area.b - oy});
            root.style.setProperty('--tm-dx', Math.round(shift.dx) + 'px');
            root.style.setProperty('--tm-dy', Math.round(shift.dy) + 'px');
        };
        const schedule = () => { if (live && !disposed && !frame) frame = forkForeground.requestAnimationFrame(measure); };
        measure();
        const size = new ResizeObserver(schedule), marks = new MutationObserver(schedule);
        size.observe(stage);
        for (const node of stage.querySelectorAll(TIMER_SKIN_ART + ', .fork-gal-topbar > *')) size.observe(node);
        marks.observe(stage, {attributes:true, childList:true});
        const stop = () => {live = false; cleanups.delete(stop); size.disconnect(); marks.disconnect(); if (frame) forkForeground.cancelAnimationFrame(frame);};
        cleanups.add(stop);
        return stop;
    }, [look]);
    return ref;
}
// look: timerLook - kind 'pill' (the mod's preset: a HUD capsule in the skin's colours) or 'plate' (an image plate at
// `placement` {canvas:[w, h], box:[x, y, w, h]}, letterboxed like the game area, with sprite digits when `glyphs` come
// with a digit sheet, else text); `pause` / `urgent` / `hideExpired` are the features the options turn on.
function StageTimer({state, look, reducedMotion, notice}) {
    const h = React.createElement, timer = state.timer;
    const clearance = useTimerClearance(timer && look ? JSON.stringify([look.kind, look.placement]) : null);
    if (!timer || !look) return null;
    const text = timerFormat(state.remaining, look.format);
    const expired = state.status === 'expired', held = state.playerPaused ? 'player' : state.status === 'paused' ? 'director' : null;
    const urgent = look.urgent && !expired && !held && state.ticking && timer.mode === 'reply' && state.remaining <= 10000;
    const name = (timer.label || (timer.mode === 'reply' ? '回应时限' : '倒计时'));
    const pause = look.pause && state.live && !expired && state.status === 'running' ? h('button', {type:'button', className:'fork-timer-pause', 'data-action':'timer-pause', 'aria-pressed':state.playerPaused,
        title:state.playerPaused ? '继续计时' : '暂停计时', 'aria-label':state.playerPaused ? '继续计时' : '暂停计时',
        onClick:event => { event.stopPropagation(); state.togglePause(); }, onKeyDown:event => event.stopPropagation()},
        h(Icon, {name:state.playerPaused ? 'play' : 'pause', size:14})) : null;
    const status = expired ? '时间到' : held === 'player' ? '已暂停' : held === 'director' ? '暂停中' : '';
    const label = name + ' ' + text + (status ? '，' + status : '');
    const url = value => 'url("' + value + '")', style = {'--tm-icon':url(look.icon)};
    if (look.kind === 'plate') {
        const {canvas:[cw, ch], box:[x, y, w, hgt]} = look.placement;
        Object.assign(style, {'--tm-cw':cw, '--tm-ch':ch, '--tm-x':x, '--tm-y':y, '--tm-w':w, '--tm-h':hgt}, look.plate ? {'--tm-plate':url(look.plate)} : null,
            look.glyphs ? {'--tm-digits':url(look.digits), '--tm-cell':look.glyphs.cell, '--tm-cols':look.glyphs.columns, '--tm-rows':look.glyphs.rows} : null);
    }
    const root = {ref:clearance, className:'fork-timer', 'data-look':look.kind, 'data-mode':timer.mode, 'data-status':expired ? 'expired' : held ? 'paused' : 'running', 'data-held':held || undefined,
        'data-urgent':urgent || undefined, 'data-ticking':state.ticking || undefined, 'data-calm':reducedMotion || undefined,
        'data-art':look.kind === 'plate' && !look.plate ? 'none' : undefined, 'data-hide-expired':look.hideExpired || undefined, style};
    const said = notice ? h('div', {className:'fork-timer-notice', role:'status'}, notice) : null;
    if (look.kind === 'plate') {
        const {box:[, , w, hgt]} = look.placement, columns = look.glyphs?.columns;
        return h('div', root,
            h('div', {className:'fork-timer-plate', role:'timer', 'aria-label':label},
                look.glyphs ? timerGlyphs(text, look.glyphs, [w, hgt]).map((glyph, index) => h('i', {key:index, className:'fork-timer-glyph', 'aria-hidden':true,
                    style:{'--gx':glyph.x, '--gy':glyph.y, '--gc':glyph.cell % columns, '--gr':Math.floor(glyph.cell / columns)}}))
                    : h('span', {className:'fork-timer-digits', 'aria-hidden':true}, text)),
            pause, said);
    }
    return h('div', root,
        h('div', {className:'fork-timer-pill', role:'timer', 'aria-label':label},
            h('i', {className:'fork-timer-icon', 'aria-hidden':true}),
            timer.label ? h('span', {className:'fork-timer-label'}, timer.label) : null,
            h('span', {className:'fork-timer-digits', 'aria-hidden':true}, text),
            status ? h('span', {className:'fork-timer-state'}, status) : null, pause),
        said);
}

// Each displayed page owns its asynchronous reaction and all acquired resources.
function createReactionScope() {
    let closed = false;
    const releases = new Set();
    const stop = () => {
        if (closed) return;
        closed = true; cleanups.delete(stop);
        const errors = [];
        for (const release of [...releases]) {try {release();} catch (error) {errors.push(error);}}
        if (errors.length) throw new AggregateError(errors, 'Timer reaction cleanup failed');
    };
    if (disposed) closed = true; else cleanups.add(stop);
    return {dispose:stop, async play({root, sessionId, source, turn, at, token, event, safety}) {
        const active = () => !closed && !disposed && root?.isConnected;
        if (!active()) return;
        const owner = getResourceOwner();
        const answer = await rpc('getStageTimerReaction', {turn, at, expectedDirectionToken:token, eventId:event.id}, sessionId).catch(() => null);
        if (!active() || answer?.status !== 'ready') return;
        const prepared = await owner.prepare(answer.performance, resourceAuthority(source), {usage:'timer-reaction'});
        if (!active()) {prepared.release(); return;}
        let rects, layer, timer = null, released = false;
        const release = () => {
            if (released) return;
            released = true; releases.delete(release);
            const errors = [];
            for (const cleanup of [
                () => {if (timer !== null) forkForeground.clearTimeout(timer);},
                () => layer?.dispose(), () => rects?.dispose(), () => prepared.release()
            ]) {try {cleanup();} catch (error) {errors.push(error);}}
            if (errors.length) throw new AggregateError(errors, 'Timer reaction resources cleanup failed');
        };
        releases.add(release);
        try {
            rects = createRects({root, schedule:fn => forkForeground.requestAnimationFrame(fn), cancel:id => forkForeground.cancelAnimationFrame(id)});
            layer = createKeyframeLayer({root, owner, foreground:forkForeground, rects, safety});
            const keyframes = prepared.value.dependencies.find(item => item.ref?.kind === 'performances')?.document?.keyframes;
            layer.apply({type:'layer', value:{...prepared.value, phase:'entry'}, token:{id:'timer:' + event.id}, descriptor:null, snap:false, handles:prepared.pins.map(pin => pin.handle)});
            timer = forkForeground.setTimeout(release, (keyframes?.entry?.durationMs || 6000) + 600);
        } catch (error) {
            try {release();} catch (cleanup) {throw new AggregateError([error,cleanup], 'Timer reaction failed');}
            throw error;
        }
    }};
}
return {useSlot:useStageTimerSlot, createReactionScope, useTimer:useStageTimer, Component:StageTimer, dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const stop of [...cleanups]) {try {stop();} catch (error) {errors.push(error);}}
    timerSeenEvents.clear(); timerConsumedOffers.clear(); timerBuiltinRead = null;
    if (errors.length) throw new AggregateError(errors, 'Stage timer cleanup failed');
}};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageTimer};
