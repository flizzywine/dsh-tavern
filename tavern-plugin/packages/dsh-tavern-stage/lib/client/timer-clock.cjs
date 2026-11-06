'use strict';

// Epoch timestamps measure stage-open time, independently of the presentation clock.
function timerClockRemaining(checkpoint, now) {
    if (!checkpoint) return 0;
    const clock = checkpoint.clock;
    return Math.max(0, clock ? clock.remainingMs - (clock.open ? Math.max(0, now - clock.atMs) : 0) : checkpoint.remainingMs);
}
function timerClockSample(timer, previous, now, {open, owner, playerPaused = (!timer || previous?.instanceId === timer.instanceId) && previous?.playerPaused === true} = {}) {
    const same = !!previous && (!timer || previous.instanceId === timer.instanceId);
    let remainingMs = same ? previous.clock?.owner === owner ? timerClockRemaining(previous, now) : previous.remainingMs : timer?.remainingMs || 0;
    // A different command revision is an explicit director event, never a UI hold.
    const durationMs = timer?.durationMs ?? previous?.durationMs ?? remainingMs;
    // A beat may contain several adds followed by pause/resume. Compare total budgets,
    // not only the final command's increment.
    const added = same && timer && previous.commandRevision !== timer.revision && durationMs > (previous.durationMs ?? durationMs);
    if (added) remainingMs += durationMs - previous.durationMs;
    const status = !timer ? 'stopped' : remainingMs <= 0 ? 'expired' : timer.status;
    const runs = !!timer && open && status === 'running' && !timer.suspended && !playerPaused;
    const unchanged = same && timer && previous.clock?.owner === owner && previous.commandRevision === timer.revision && previous.clock.open === runs;
    return {instanceId:timer?.instanceId || previous?.instanceId, commandRevision:timer?.revision ?? previous?.commandRevision ?? 0,
        remainingMs, durationMs, status, elapsedMs:Math.max(0, durationMs - remainingMs),
        event:same && !added ? previous.event : null, playerPaused,
        clock:unchanged ? previous.clock : {owner, atMs:now, remainingMs, open:runs}};
}
function timerClockFrozen(checkpoint, atMs) {
    if (!checkpoint) return null;
    const remainingMs = timerClockRemaining(checkpoint, atMs);
    return {...checkpoint,remainingMs,status:remainingMs <= 0 ? 'expired' : checkpoint.status,
        clock:checkpoint.clock ? {...checkpoint.clock,atMs,remainingMs,open:false} : undefined};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {timerClockRemaining,timerClockSample,timerClockFrozen};
