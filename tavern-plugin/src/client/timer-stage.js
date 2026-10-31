// @include-mod timer/clock.cjs
// @include timer-logic.cjs
// @include mod-options.js
// the dsh.timer countdown on the stage.
// Every request names the page on screen (turn/at/offset): a page behind the live frontier whose own countdown has since
// stopped shows it frozen at that page's floor (host tavern-plugin/mods/timer/stage-clock.js behind), not the live clock's later state.
// The host timestamps director events and stage-open/close boundaries. Display is arithmetic on that clock;
// playback, page responses and window visibility cannot pause it. History projects the first floor snapshot.
// Periodic durable samples recover an unclean host exit; they never establish display anchors.
// The look is the mod's resolved options (timerLook): the active skin's values, art and locks over the mod's preset.

// The mod's own built-in art (the pill's icon).
let timerBuiltinRead = null;
function timerBuiltin(sessionId) {
    return timerBuiltinRead ||= rpc('getStageTimerLooks', {}, sessionId).catch(error => { timerBuiltinRead = null; throw error; });
}
// Live events already handed to consumers / fallback offers already given to the input lock, by event id (this page only:
// a refresh never recovers an offer from the saved checkpoint).
const timerConsumedOffers = new Set();

function useStageTimer(...args) { return stageViews.timer.useTimer(...args); }
// The timeup's performance (asset onTimeup) through the ordinary performance admission and resource owner, drawn by the
// shared keyframe player on the stage root; nothing is played when the host says it is unavailable.
async function timerPlayReaction({root, sessionId, source, turn, at, token, event, safety}) {
    const answer = await rpc('getStageTimerReaction', {turn, at, expectedDirectionToken:token, eventId:event.id}, sessionId).catch(() => null);
    if (answer?.status !== 'ready' || !root?.isConnected) return;
    const owner = stageSessions.resourceOwner, value = answer.performance;
    const prepared = await owner.prepare(value, stageResourceAuthority(source), {usage:'timer-reaction'});
    const rects = createStageRects({root, schedule:fn => forkForeground.requestAnimationFrame(fn), cancel:id => forkForeground.cancelAnimationFrame(id)});
    const layer = createPerformanceKeyframeLayer({root, owner, foreground:forkForeground, rects, safety});
    const keyframes = prepared.value.dependencies.find(item => item.ref?.kind === 'performances')?.document?.keyframes;
    layer.apply({type:'layer', value:{...prepared.value, phase:'entry'}, token:{id:'timer:' + event.id}, descriptor:null, snap:false, handles:prepared.pins.map(pin => pin.handle)});
    forkForeground.setTimeout(() => { layer.dispose(); rects.dispose(); prepared.release(); }, (keyframes?.entry?.durationMs || 6000) + 600);
}

// Input and visibility guard the optional fallback action, not the clock.
function useStageTimerSlot({sessionId, rootRef, reading, source, token, turn, mode, visit, at, offset, waiting, sending, running, skinKey = ''}) {
    const [visible, setVisible] = React.useState(true);
    React.useEffect(() => forkForeground.subscribe(setVisible), []);
    const [inputStarted, setInputStarted] = React.useState(false);
    const fallbackRef = React.useRef(null), gate = React.useRef(null);
    const [notice, setNotice] = React.useState(null);
    gate.current = {consumed:timerConsumedOffers, live:mode === 'live', visible, waiting, inputStarted, sending, running, turn, source:token};
    const state = useStageTimer({sessionId, mode, visit, turn, at, offset, token,
        view:{waitingForInput:waiting, inputStarted},
        onEvent:event => {
            // The one stage event (skin / performance consumers): a DOM event on the stage, then the entry's own onTimeup.
            rootRef.current?.dispatchEvent(new CustomEvent('fork-stage-event', {detail:event}));
            if (event.onTimeup) timerPlayReaction({root:rootRef.current, sessionId, source, turn:event.turn, at:event.at, token:event.source, event,
                safety:() => performanceSafety(reading, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)}).catch(error => console.warn('Timer reaction unavailable', error));
        },
        onFallback:offer => {
            if (!timerFallbackAllowed(offer, gate.current)) return;
            timerConsumedOffers.add(offer.eventId);
            if (!fallbackRef.current?.(offer.action)) return;
            setNotice('时间到，已替你回应：' + offer.action);
            forkForeground.setTimeout(() => setNotice(null), 5000);
        }});
    const [builtin, setBuiltin] = React.useState(null);
    React.useEffect(() => { if (state.timer && !builtin) timerBuiltin(sessionId).then(setBuiltin, () => {}); }, [!!state.timer]);
    const look = timerLook(useModOptions(sessionId, 'dsh.timer', {enabled:!!state.timer, skinKey}), builtin);
    // shown: the timer is on the stage (StageTimer draws it) - the skin's hud.timer arrangement follows it.
    return {element:React.createElement(StageTimer, {state, look, reducedMotion:reading.reducedMotion === true, notice}),
        shown:Boolean(state.timer && look), onInputActivity:setInputStarted, fallbackRef};
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
        if (!root || !stage) return;
        let frame = 0;
        const rect = node => { const r = node.getBoundingClientRect(); return {l:r.left, t:r.top, r:r.right, b:r.bottom}; };
        const measure = () => {
            frame = 0;
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
        const schedule = () => { if (!frame) frame = forkForeground.requestAnimationFrame(measure); };
        measure();
        const size = new ResizeObserver(schedule), marks = new MutationObserver(schedule);
        size.observe(stage);
        for (const node of stage.querySelectorAll(TIMER_SKIN_ART + ', .fork-gal-topbar > *')) size.observe(node);
        marks.observe(stage, {attributes:true, childList:true});
        return () => { size.disconnect(); marks.disconnect(); if (frame) forkForeground.cancelAnimationFrame(frame); };
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
