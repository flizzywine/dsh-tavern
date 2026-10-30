'use strict';
const skinOverlayPhaseMotion = typeof module !== 'undefined' && typeof window === 'undefined' ? require('./skin-overlay-motion.cjs') : null;
function createPhasedSkinOverlayMotion({id,pieces,intensity=2,reducedMotion=false,snap=false,tempo=1}) {
    const make=skinOverlayPhaseMotion?.createSkinOverlayMotion || createSkinOverlayMotion;
    let phase='entry',level=intensity,states=[];
    function reset() {states=pieces.map(piece => ({piece,key:null,motion:null}));}
    reset();
    return {
        setPhase(options) {phase=options.phase;level=options.level ?? level;snap=!!options.snap;reset();},
        turn(time) {this.setPhase({phase:'turn',level:3});},
        exit(time) {this.setPhase({phase:'exit',level});},
        sample(time,rects,sizes) {
            const output=[];
            for (const state of states) {
                const original=state.piece, high=level >= 3, cue=original.enter?.cue || 'entry';
                if (cue === 'turn' && (!high || phase === 'entry')) continue;
                const current=phase === 'idle' ? (high ? 'turn' : 'entry') : phase;
                const phaseTime=snap || phase === 'idle' ? Infinity : time;
                const exited=original.exit?.cue;
                if (exited && exited !== 'exit' && (exited === current || high && exited === 'turn' && phase === 'exit') && phaseTime >= (original.exit.at || 0)) continue;
                const changes=(original.phases || []).filter(change => change.cue === 'entry' || high && change.cue === 'turn');
                const eligible=changes.filter(change => change.cue !== 'turn' || current !== 'entry').filter(change => change.cue !== current || change.at <= phaseTime);
                const change=eligible.at(-1), key=change ? changes.indexOf(change) : -1;
                if (!state.motion || state.key !== key) {
                    const piece={...original,...change,img:change?.frame || original.frame || original.img,at:change?.anchor || original.at};
                    if (change?.frames) piece.frames=change.frames;
                    if (phase !== 'entry' && cue === 'entry' || change) piece.enter={from:'pop',steps:1,at:0};
                    if (change?.leave) piece.exit=change.leave;
                    state.motion=make({id,pieces:[piece],intensity:level,reducedMotion,tempo,snap:snap || phase === 'idle' || phase === 'turn' && cue === 'entry' && !change});
                    state.key=key;
                    if (phase === 'exit' || change?.leave) state.motion.exit(0);
                }
                const local=change?.cue === current ? Math.max(0,time-change.at) : time;
                const sample=state.motion.sample(local,rects,sizes);
                if ((snap || phase === 'idle') && change?.frames) {
                    const swap=change.idle?.find(motion => motion.op === 'swap' && motion.once);
                    if (swap) for (const pose of sample) pose.pose.frame=swap.seq.at(-1);
                }
                output.push(...sample);
            }
            return output;
        }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={createPhasedSkinOverlayMotion};
