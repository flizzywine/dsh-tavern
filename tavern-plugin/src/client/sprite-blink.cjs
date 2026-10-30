// automatic blinking for static sprites that carry an authored blink patch.
// Timers only: nothing runs per display frame. The caller owns the overlay; the scheduler only
// reports 'open' | 'half' | 'closed'. No patch, no blink (there is no procedural fallback).
const BLINK_TIMING = Object.freeze({ minGap: 2500, maxGap: 6000, minClosed: 100, maxClosed: 140, half: 40, doubleChance: 0.15, minDoubleGap: 90, maxDoubleGap: 150 });
function blinkPlan(random, hasHalf, timing = BLINK_TIMING) {
    const between = (lo, hi) => Math.round(lo + (hi - lo) * random());
    const one = () => hasHalf ? [['half', timing.half], ['closed', between(timing.minClosed, timing.maxClosed)], ['half', timing.half]] : [['closed', between(timing.minClosed, timing.maxClosed)]];
    const steps = one();
    if (random() < timing.doubleChance) steps.push(['open', between(timing.minDoubleGap, timing.maxDoubleGap)], ...one());
    return steps;
}
// Per-figure blink rhythm (galIdleJitter): the gap between blinks scaled by the figure's own factor
// (about 0.8–1.2), so figures on one stage do not share an interval distribution; blink length is unchanged.
function blinkTimingFor(scale, timing = BLINK_TIMING) {
    const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return k === 1 ? timing : Object.freeze({ ...timing, minGap: Math.round(timing.minGap * k), maxGap: Math.round(timing.maxGap * k) });
}
function blinkGap(random, timing = BLINK_TIMING) { return Math.round(timing.minGap + (timing.maxGap - timing.minGap) * random()); }
// allowed() is consulted at every wake: reduced motion, hidden figure or stage keep the eyes open.
function createBlinkScheduler({ setTimeout: arm, clearTimeout: disarm, random = Math.random, apply, allowed = () => true, hasHalf = false, timing = BLINK_TIMING }) {
    let timer = null, phase = 'open', running = false;
    const set = next => { if (next !== phase) { phase = next; apply(next); } };
    const wait = () => { timer = arm(fire, blinkGap(random, timing)); };
    function step(steps, index) {
        timer = null;
        if (!running) return;
        if (index >= steps.length || !allowed()) { set('open'); wait(); return; }
        set(steps[index][0]);
        timer = arm(() => step(steps, index + 1), steps[index][1]);
    }
    function fire() {
        timer = null;
        if (!running) return;
        if (!allowed()) { set('open'); wait(); return; }
        step(blinkPlan(random, hasHalf, timing), 0);
    }
    function halt() { if (timer !== null) disarm(timer); timer = null; set('open'); }
    return {
        start() { if (running) return; running = true; set('open'); wait(); },
        // Realign: a new state/emotion starts a fresh interval with the eyes open.
        restart() { halt(); if (running) wait(); },
        stop() { running = false; halt(); },
        phase: () => phase,
        running: () => running
    };
}
// Base-canvas rect → child position under a sprite with the given anchor (same rule as mouth covers).
function blinkPlacement(bundle, width, height, anchor) {
    const [x, y, w, h] = bundle.rect;
    if (!(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= width && y + h <= height)) return null;
    if (bundle.canvas && (bundle.canvas[0] !== width || bundle.canvas[1] !== height)) return null;
    return { x: x - width * anchor.x, y: y - height * anchor.y, w, h };
}
function blinkUrls(bundle) { return bundle ? [bundle.closed, bundle.half].filter(Boolean) : []; }
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = { BLINK_TIMING, blinkTimingFor, blinkPlan, blinkGap, createBlinkScheduler, blinkPlacement, blinkUrls };
