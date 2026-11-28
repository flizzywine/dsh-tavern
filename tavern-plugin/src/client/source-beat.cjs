'use strict';

// A source mod's beat (its client/core.js part `source`, mod-clients.js): beat(direction, para) gives the params of the accepted
// director mark that shows that page on the mod's own surface (the phone's message), or null.
function stageSourceBeat(direction,para) {
    for (const {value} of typeof tavernModClients === 'undefined' ? [] : tavernModClients.slot('source')) {
        const beat=value.beat(direction,para);
        if (beat) return beat;
    }
    return null;
}
// Automatic voice never speaks a page a source mod shows; with the director on it does not start before a sealed prefix can
// choose that surface - unless `waited`: the stage's runtime already waited (at most a moment) for a direction that was coming
// or knows none is (runtime-kernel.cjs stageVoiceDirectionComing), so the line speaks whatever the director did.
function stageAutoVoiceAllowed(direction,para,directorEnabled,waited=false,beat=stageSourceBeat) {
    if (beat(direction,para)) return false;
    return waited || !directorEnabled || ['off','error'].includes(direction.phase) || direction.through>=para;
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={stageSourceBeat,stageAutoVoiceAllowed};