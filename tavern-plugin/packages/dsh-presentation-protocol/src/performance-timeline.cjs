'use strict';

// One foreground clock per session; the runtime reducer, not this scheduler, owns consumption.
function createPerformanceTimeline({foreground, ledger, sinks, isCurrent}) {
    let active = null, timer = null, pausedAt = null, queue = [], serial = 0;
    const reasons = new Set();
    const key = token => JSON.stringify([token.source,token.instanceKey,token.phaseKey,token.visitId,token.playbackEpoch]);
    const valid = () => active && isCurrent(active.token);
    const elapsed = () => active ? (pausedAt ?? foreground.now()) - active.started : 0;
    function clear() { foreground.clearTimeout(timer); timer = null; }
    function schedule(at, fn) { queue.push({at,fn,ordinal:serial++}); queue.sort((a,b) => a.at-b.at || a.ordinal-b.ordinal); }
    function arm() {
        clear();
        if (!valid() || reasons.size || !queue.length) return;
        timer = foreground.setTimeout(() => {
            timer = null;
            if (!valid()) return;
            const item = queue.shift(); item.fn(); arm();
        },Math.max(0,queue[0].at-elapsed()));
    }
    function eventKey(event, cycle) {
        const t=active.token, s=t.source;
        return JSON.stringify([s.sourceKey,s.branchId,s.generation,t.instanceKey,t.phaseKey,event.block,event.cueId === undefined ? event.ordinal : [event.cueId,event.ordinal],cycle,t.visitId]);
    }
    function due(event, cycle) {
        if (!valid()) return;
        ledger.due({token:active.token,key:eventKey(event,cycle),atMs:foreground.now(),descriptor:{...event,cycle}});
    }
    function cues(events, cycle, start) {
        for (const event of events) {
            if (event.do !== 'cue') schedule(start+event.at,() => due(event,cycle));
            const timing=event.overlayTiming;
            if (timing) {
                const effects=(timing.effects || []).map(effect => ({...effect,retiring:event.retiring,block:event.block,at:event.at+effect.at,ordinal:[event.ordinal,'overlay',effect.ordinal]}));
                const planned=(timing.cues || []).map(cue => ({...cue,retiring:event.retiring,do:'cue',at:event.at+cue.at,ordinal:[event.ordinal,'cue',cue.ordinal]}));
                cues([...effects,...planned],cycle,start);
            }
            // Finite cues are known before playback, so negative offsets really play early.
            if (event.do !== 'cue') continue;
            const binding=(event.retiring ? active.retiring?.plan : active.plan)?.sfxMap?.[event.cueId];
            if (binding) schedule(Math.max(start,start+event.at+(binding.offsetMs || 0)),() => due({...event,...binding,do:'sfx',block:'overlay',cueId:event.cueId},cycle));
        }
    }
    function delay(cycle) {
        let hash=2166136261;
        for (const char of JSON.stringify([active.token.instanceKey,active.token.phaseKey,'idle',cycle])) hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
        const every=active.plan.idleEvery, min=Array.isArray(every) ? every[0] : every?.minMs ?? every?.min ?? every;
        const max=Array.isArray(every) ? every[1] : every?.maxMs ?? every?.max ?? min;
        return Math.max(1,Number(min)||1)+(hash/4294967296)*Math.max(0,(Number(max)||0)-(Number(min)||0));
    }
    function idle(cycle, after) {
        if (!active.plan.idleEvery || !active.plan.idleEvents?.length) return;
        const start=after+delay(cycle), events=active.plan.idleEvents;
        const duration=Math.max(0,...events.map(e => e.at+(['flash','shake'].includes(e.do) ? e.ms : Math.max(e.completionMs || 0,active.plan.sfxMap?.[e.cueId]?.offsetMs || 0))));
        cues(events,cycle,start);
        schedule(start+duration,() => { ledger.cycle({token:active.token,cycle}); idle(cycle+1,elapsed()); });
    }
    function cancel(reason) {
        clear(); queue=[]; serial=0;
        if (active) sinks.cancel?.({token:active.token,reason});
    }
    function set(options) {
        cancel('replace'); active={...options,started:foreground.now()}; pausedAt=reasons.size ? active.started : null;
    }
    return {
        start(options) {
            if (active && key(active.token)===key(options.token)) return;
            set(options);
            const retiring=active.retiring?.plan, offset=retiring?.durationMs || 0;
            if (retiring) cues((retiring.events || []).map(event => ({...event,retiring:true,block:'retiring:'+event.block})),0,0);
            cues(active.plan.events || [],0,offset);
            schedule(offset+(active.plan.durationMs || 0),() => {
                ledger.consumed({token:active.token});
                idle(1,elapsed());
            });
            arm();
        },
        seek(options) {
            set(options);
            sinks.sustained?.(options);
            ledger.consumed({token:active.token,skipped:true});
        },
        cue({token,cueId,ordinal=0,cycle=0,atMs}) {
            if (!valid() || key(token)!==key(active.token)) return;
            const binding=active.plan.sfxMap?.[cueId];
            if (!binding) return;
            const event={...binding,do:'sfx',block:'overlay',cueId,ordinal};
            schedule(Math.max(elapsed(),(atMs ?? elapsed())+(binding.offsetMs || 0)),() => due(event,cycle)); arm();
        },
        pause(reason) {
            if (!reasons.size) { pausedAt=foreground.now(); clear(); }
            reasons.add(reason);
        },
        resume(reason) {
            if (!reasons.delete(reason) || reasons.size) return;
            if (active && pausedAt !== null) active.started+=foreground.now()-pausedAt;
            pausedAt=null; arm();
        },
        dispose(reason='dispose') { cancel(reason); active=null; reasons.clear(); pausedAt=null; }
    };
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={createPerformanceTimeline};
