'use strict';
// Closed finite cue timing is shared by the host plan and the renderer. Idle never extends a phase.
function skinOverlayTiming(overlay, phase) {
    if (!overlay) return {durationMs:0,cues:[],effects:[],skinSwapAt:null};
    const bound=value => Math.max(0,Math.min(4000,Number(value)||0)), cue=overlay.cues?.[phase] || {}, ritual=cue.ritual;
    const end=[];
    if (ritual) end.push(bound(ritual.revealAt)+(ritual.reveal.steps || 5)*125);
    for (const piece of overlay.pieces || []) {
        const transition=phase === 'exit' ? piece.exit : piece.enter;
        if (transition && (transition.cue || (phase === 'exit' ? 'exit' : 'entry')) === phase) end.push(bound(transition.at)+(transition.steps || 4)*1000/(piece.fps || 8));
        for (const change of piece.phases || []) if (change.cue === phase) {
            const swap=change.idle?.find(motion => motion.op === 'swap' && motion.once);
            end.push(bound(change.at)+Math.max(swap ? swap.seq.length*(swap.hold || 1)*1000/(piece.fps || 8) : 0,change.leave ? (change.leave.steps || 4)*1000/(piece.fps || 8) : 0));
        }
    }
    const effects=(cue.shake || []).map((effect,ordinal) => ({...effect,at:bound(effect.at),do:'shake',ordinal}));
    end.push(...effects.map(effect => effect.at+effect.ms),cue.ms || 0);
    return {durationMs:bound(Math.max(0,...end)),skinSwapAt:ritual?.skinSwapAt === undefined ? null : bound(ritual.skinSwapAt),
        cues:cue.sfx ? [{cueId:cue.sfx,at:0,ordinal:0}] : [],effects};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={skinOverlayTiming};
