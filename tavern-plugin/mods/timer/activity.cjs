'use strict';

// Explicit timer suspension and stage lifetime are the only holds, never presentation activity.
function timerActivityRuns(timer, activity) {
    return !!timer && timer.status === 'running' && !timer.suspended && activity.live === true &&
        activity.stageOpen !== false && !activity.playerPaused;
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {timerIsActive:timerActivityRuns};
