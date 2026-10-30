// @include-mod timer/activity.cjs
const timerOwner = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../mods/timer/activity.cjs') : {timerIsActive:(timer, activity) => timerActivityRuns(timer, activity)};
// the stage timer's pure client rules - which interval is charged,
// what the plate reads and when the reply fallback may be offered to the input lock. The host owns the remaining time.

// The activity sent with one measured interval (the host re-checks it: tavern-plugin/mods/timer/stage-service.js timerIsActive).
function timerActivity(view) {
    return {live:view.stageOpen !== false && view.mode !== 'history' && view.mode !== 'replay', visible:view.visible === true, waitingForInput:view.waitingForInput === true, inputStarted:view.inputStarted === true,
        menuOpen:view.menuOpen === true, backlogOpen:view.backlogOpen === true, caption:view.caption === true, playerPaused:false,
        ...(view.presentation?{presentation:view.presentation,countdownReady:view.presentation.phase==='rest'}:{})};
}
function timerPresentation(control, playback) {
    if (!control) return null;
    const value = playback?.value;
    const matches = value && ['packId','assetId'].every(key => value.ref?.[key] === control.performanceRef[key]) &&
        value.topic === control.topic && (control.exiting || JSON.stringify(value.startedAt) === JSON.stringify(control.startedAt));
    const phase = matches ? control.exiting && playback.phase === 'rest' ? 'exit' : playback.phase : control.exiting && !playback ? 'released' : 'pending';
    return {epoch:control.epoch, phase};
}
// Projection visibility is separate from the stage-open clock; UI holds do not pause a live timer.
function timerRuns(timer, checkpoint, view) {
    return !!timer && !!checkpoint && timerOwner.timerIsActive({...timer, status:checkpoint.status},
        {...timerActivity(view), playerPaused:checkpoint.playerPaused === true});
}
// The plate's digits in the resolved `format` option: 'mm:ss:mmm' (milliseconds floored; 15:00:000 → 14:59:999), or
// 'm:ss' (h:mm:ss from an hour), seconds rounded up so 0:00 is shown only at expiry.
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

// The plate's clearance from the skin's drawn art (a skin's menu gear covered the clock's last digits).
// plate / boxes / bounds are {l, t, r, b} screen rects: the plate where its look puts it, every art box the skin declares on
// the stage (art.buttons, art.decor) and the stage. Returns the smallest shift {dx, dy} that keeps the plate `gap` px clear
// of every box and inside the stage: past the box's left or right edge, or under it; the first box that still touches the
// shifted plate decides the next step. Should the steps run out (boxes on both sides), the plate goes under every box above
// or beside it in its own column.
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

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {timerActivity, timerPresentation, timerRuns, timerFormat, timerGlyphs, timerLook, timerFallbackAllowed, timerClearance};
