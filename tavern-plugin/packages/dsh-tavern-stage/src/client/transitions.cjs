"use strict";
function createStageTransitions({React, window, getComputedStyle, DOMMatrixReadOnly, ease:stageSkinTxEase, setTimeout, clearTimeout}) {
let disposed = false;
const timers = new Set(), animations = new Set();
function schedule(callback, ms) {
    let active = true;
    const cancel = () => {
        if (!active) return;
        active = false;
        timers.delete(cancel);
        clearTimeout(timer);
    };
    const timer = setTimeout(() => {
        if (!active || disposed) return;
        active = false;
        timers.delete(cancel);
        callback();
    }, ms);
    timers.add(cancel);
    return cancel;
}
function releaseAll(items) {
    const errors = [];
    for (const release of [...items]) { try { release(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Stage transition cleanup failed');
}
function ownAnimation(animation, owner) {
    let active = true;
    const release = () => {
        if (!active) return;
        active = false;
        animations.delete(release);
        owner?.delete(release);
        animation.cancel();
    };
    animations.add(release);
    owner?.add(release);
    return release;
}
function dispose() {
    if (disposed) return;
    disposed = true;
    releaseAll(new Set([...timers, ...animations]));
}
// skin transitions. The system's reduced-motion preference (a
// short fade instead, theme.css «stage skin: transitions») and CONFIG 减少动态 (no transition) as one value.
const SKIN_TX_REDUCED_MS = 150;
function skinTxSystemReduced() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
// How long a surface's leave keeps it mounted: 0 = it goes at once (no leave declared, or CONFIG 减少动态).
function skinTxLeaveMs(skin, surface, reducedMotion) {
    const leave = skin?.transitions?.[surface]?.leave;
    if (!leave || reducedMotion) return 0;
    return skinTxSystemReduced() ? SKIN_TX_REDUCED_MS : (leave.delay || 0) + leave.ms;
}
// A surface that closes keeps rendering (data-leaving, inert) for its leave: derived in render, so the same instance stays
// mounted (its scroll and focus state) and reopening during the leave simply plays the enter again.
function useSkinLeave(open, skin, surface, reducedMotion) {
    const [state, setState] = React.useState({open, leaving: false});
    if (state.open !== open) {
        const leaving = !open && skinTxLeaveMs(skin, surface, reducedMotion) > 0;
        setState({open, leaving});
    }
    React.useEffect(() => {
        if (disposed || !state.leaving) return undefined;
        return schedule(() => setState(current => current.leaving ? {...current, leaving: false} : current), skinTxLeaveMs(skin, surface, reducedMotion) || 0);
    }, [state.leaving]);
    return state.leaving && !open;
}
// The flat shapes of a transition sweeping across the stage (transitions.<surface>.<phase>.shapes). events: per surface its
// open flag (or, for page, a key that changes per page); a change plays that phase's shapes once. Off under either reduced
// motion and before the first change. speaker: the page's speaker ('' = narration) - page.enter.sameSpeaker (§18 N14) plays the
// page's shapes only when it is the previous page's.
function useSkinSweep(skin, events, reducedMotion, speaker) {
    const previous = React.useRef(null), spoke = React.useRef(speaker);
    const [sweep, setSweep] = React.useState(null);
    const transitions = skin?.transitions;
    React.useEffect(() => {
        const before = previous.current, said = spoke.current; previous.current = events; spoke.current = speaker;
        if (disposed || !before || !transitions || reducedMotion || skinTxSystemReduced()) return;
        for (const [surface, value] of Object.entries(events)) {
            if (before[surface] === value) continue;
            const phase = surface === 'page' ? 'enter' : value ? 'enter' : 'leave';
            const t = transitions[surface]?.[phase];
            if (!t?.shapes || t.sameSpeaker && said !== speaker) continue;
            setSweep(current => ({serial: (current?.serial || 0) + 1, surface, phase, t}));
        }
    });
    React.useEffect(() => {
        if (disposed || !sweep) return undefined;
        const longest = Math.max(...sweep.t.shapes.map(shape => shape.delay || 0));
        return schedule(() => setSweep(current => current === sweep ? null : current), Math.ceil(sweep.t.ms * (1 + longest)) + 32);
    }, [sweep]);
    return sweep;
}
// anchor portrait (§18 N9): the shown speaker portrait's centre at rest (its entrance translate taken out), in fractions of the
// sweep, set before paint as --ax / --ay, and its scale --ak (size and offsets follow the portrait as shown, so on a phone the
// rings stay round the small sun); with no portrait shown the anchored shapes stay hidden.
function skinSweepAnchor(sweep) {
    const stage = sweep.closest('.fork-gal-stage'), side = stage && [...stage.querySelectorAll('.fork-gal-side.is-on')].pop();
    const box = sweep.getBoundingClientRect(), rect = side?.getBoundingClientRect();
    if (!rect || !rect.width || !box.width) return null;
    const moved = getComputedStyle(side).transform, m = moved && moved !== 'none' ? new DOMMatrixReadOnly(moved) : null;
    // and its scale: the portrait as shown over the portrait at the design size on this stage (a phone's small sun keeps its rings)
    const css = getComputedStyle(stage), size = parseFloat(css.getPropertyValue('--art-face-s')), screen = parseFloat(css.getPropertyValue('--art-screen'));
    const scale = size > 0 && screen > 0 ? rect.height / (size / screen * box.height) : 1;
    return [(rect.left + rect.width / 2 - (m ? m.m41 : 0) - box.left) / box.width, (rect.top + rect.height / 2 - (m ? m.m42 : 0) - box.top) / box.height, Math.round(scale * 1000) / 1000];
}
// anchor box (skin-interface.md §9.1): the text box's top edge where it comes to rest - a box whose height is still easing
// (art.textbox.height fit lines; its bottom stays) counts from its transition's end - in fractions of the sweep, as --by.
function skinSweepBoxTop(sweep) {
    const box = sweep.closest('.fork-gal-stage')?.querySelector('.fork-gal-box'), area = sweep.getBoundingClientRect(), rect = box?.getBoundingClientRect();
    if (!rect || !rect.height || !area.height) return null;
    const frames = box.getAnimations().find(animation => animation.transitionProperty === 'height')?.effect?.getKeyframes();
    const height = frames?.length ? parseFloat(frames[frames.length - 1].height) * rect.height / box.offsetHeight : rect.height;
    return (rect.bottom - height - area.top) / area.height;
}
function SkinSweep({sweep}) {
    const ref = React.useRef(null);
    const anchors = sweep ? [...new Set(sweep.t.shapes.map(shape => shape.anchor).filter(Boolean))].join() : '';
    React.useLayoutEffect(() => {
        const node = ref.current;
        if (disposed || !node || !anchors) return;
        const at = anchors.includes('portrait') && skinSweepAnchor(node);
        if (at) { node.style.setProperty('--ax', at[0]); node.style.setProperty('--ay', at[1]); node.style.setProperty('--ak', at[2]); node.dataset.anchor = 'portrait'; }
        const top = anchors.includes('box') ? skinSweepBoxTop(node) : null;
        if (top !== null) { node.style.setProperty('--by', top); node.dataset.anchorBox = ''; }
    }, [sweep?.serial, anchors]);
    if (!sweep) return null;
    const h = React.createElement, t = sweep.t;
    return h('div', {key: sweep.serial, ref, className: 'fork-skin-sweep', 'data-fk-layer': '', 'aria-hidden': true, 'data-surface': sweep.surface, 'data-phase': sweep.phase,
        style: {'--sw-ms': t.ms + 'ms', '--sw-ease': stageSkinTxEase(t.ease)}},
        t.shapes.map((shape, i) => h('i', {key: i, 'data-anchor': shape.anchor, style: {'--fx': shape.from[0], '--fy': shape.from[1], '--tx': shape.to[0], '--ty': shape.to[1], '--d': shape.delay || 0}},
            // grow / fade (§18 N9): its scale from -> to on the way (a ripple spreading) and fading out on the way
            h('b', {'data-shape': shape.shape, style: {'--sz': shape.size, '--rot': (shape.rot || 0) + 'deg', '--c': shape.color, ...(shape.grow ? {'--g0': shape.grow[0], '--g1': shape.grow[1]} : {}), ...(shape.fade ? {'--fo': 0} : {})}}))));
}
// The second layer of a transition (transitions.<surface>.<phase>.parts, bauhaus v2): the surface's direct children, in
// order, each moving from its pose / 32 px below (slide) to rest (enter) or from rest away (leave), delay ms after the
// transition starts and stagger ms after the one before (the eighth and later together). Web Animations, transform composited
// onto the part's own (so a part's own CSS motion and placement stay), both ends written; the parts' opacity is never touched
// (design: the text stays opaque). A menu / CONFIG / backlog's own slide (no parts) is the same layer: its panels
// slide with the surface's ms, ease and delay. The surface's own wipe / pose is CSS (data-fk-tx); a surface that re-enters
// cancels what its leave left. Off under either reduced motion.
const SKIN_TX_PART_SURFACES = Object.freeze({loading: '.fork-gal-entry-overlay', stage: '.fork-gal-box', menu: '.fork-gal-menu', config: '.fork-gal-config', backlog: '.fork-gal-backlog'});
const SKIN_TX_SLIDE = 'translateY(32px)', SKIN_TX_SLID = 'translateY(0px)';
const skinPartAnimations = new WeakMap();
// The layer a phase plays on its parts: its parts, or its own slide moving them (null: none).
function skinPartLayer(t) {
    if (t?.parts) return {...t.parts, ms: t.parts.ms || t.ms, ease: t.parts.ease || t.ease};
    return t?.slide ? {ms: t.ms, ease: t.ease, delay: t.delay, slide: true} : null;
}
function skinPlayParts(surface, p, phase, owner) {
    if (disposed) return;
    const pose = p.pose, enter = phase === 'enter';
    const moved = pose ? `translate(${pose.dx || 0}%, ${pose.dy || 0}%) rotate(${pose.rot || 0}deg) scale(${pose.scale ?? 1})` : null, rest = 'translate(0%, 0%) rotate(0deg) scale(1)';
    // A part without a box of its own (display: contents, the art backlog's head) stands for its children.
    const parts = node => Array.from(node.children).flatMap(part => getComputedStyle(part).display === 'contents' ? parts(part) : [part]);
    parts(surface).filter(part => part.getClientRects().length).forEach((part, i) => {
        releaseAll(skinPartAnimations.get(part) || []);
        const timing = {duration: p.ms, delay: (p.delay || 0) + Math.min(i, 7) * (p.stagger || 0), easing: stageSkinTxEase(p.ease), fill: enter ? 'backwards' : 'forwards', composite: 'add'};
        const played = [];
        if (moved) played.push(ownAnimation(part.animate(enter ? [{transform: moved}, {transform: rest}] : [{transform: rest}, {transform: moved}], timing), owner));
        if (p.slide) played.push(ownAnimation(part.animate(enter ? [{transform: SKIN_TX_SLIDE}, {transform: SKIN_TX_SLID}] : [{transform: SKIN_TX_SLID}, {transform: SKIN_TX_SLIDE}], timing), owner));
        skinPartAnimations.set(part, played);
    });
}
// events: per surface whether it is open (stage: revealed and not leaving); a change plays that phase's parts once, on the
// surface as it is mounted then (a leaving surface stays mounted, inert, for its leave). A layout effect: the parts stand at
// their start (32 px below, their pose) before the surface's first frame is painted.
function useSkinParts(rootRef, skin, events, reducedMotion) {
    const previous = React.useRef({}), owned = React.useRef(new Set());
    React.useLayoutEffect(() => () => releaseAll(owned.current), []);
    React.useLayoutEffect(() => {
        const before = previous.current; previous.current = events;
        const root = rootRef.current, transitions = skin?.transitions;
        if (disposed || !root || !transitions || reducedMotion || skinTxSystemReduced()) return;
        for (const [surface, selector] of Object.entries(SKIN_TX_PART_SURFACES)) {
            const open = Boolean(events[surface]);
            if (open === Boolean(before[surface])) continue;
            const layer = skinPartLayer(transitions[surface]?.[open ? 'enter' : 'leave']);
            const element = layer && root.querySelector(selector);
            if (element) skinPlayParts(element, layer, open ? 'enter' : 'leave', owned.current);
        }
    });
}
return {useLeave:useSkinLeave, useSweep:useSkinSweep, useParts:useSkinParts, Sweep:SkinSweep, leaveMs:skinTxLeaveMs, playParts:skinPlayParts, dispose};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageTransitions};
