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
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {timerActivity, timerPresentation, timerRuns, timerLook, timerFallbackAllowed};
