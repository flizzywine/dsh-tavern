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
// choose that surface.
function stageAutoVoiceAllowed(direction,para,directorEnabled,beat=stageSourceBeat) {
    if (beat(direction,para)) return false;
    return !directorEnabled || ['off','error'].includes(direction.phase) || direction.through>=para;
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={stageSourceBeat,stageAutoVoiceAllowed};