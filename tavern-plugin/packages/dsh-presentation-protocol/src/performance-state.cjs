'use strict';

// one pure sustained reducer for host projection and client seek.
function compilePerformance(document) {
    const blocks = {};
    for (const name of ['entry', 'turn', 'idle', 'exit']) {
        const source = document.timeline[name], keyframes = document.keyframes?.[name];
        if (!source && !keyframes) continue;
        const events = (source?.events || []).map((event, ordinal) => ({...event, block:name, ordinal}))
            .sort((a,b) => a.at - b.at || a.ordinal - b.ordinal);
        // Keyframe phases own their duration, not the last event's start.
        blocks[name] = {name, events, durationMs:Math.max(keyframes?.durationMs || 0, ...events.map(event => event.at + (['flash','shake'].includes(event.do) ? event.ms : 0)))};
    }
    return {blocks, bgm:document.bgm || null, sfxMap:document.sfxMap || {},
        onLevel:document.timeline.turn?.onLevel ?? 3, idleEvery:document.timeline.idle?.every || null};
}
function performanceBoundary(previous, {ref, level, topic, off = false}, {turn, page}, document) {
    if (off) return !previous || previous.phase === 'exit' ? previous : {...previous, startedAt:{turn,page}, phase:'exit'};
    const same = previous && previous.phase !== 'exit' && previous.ref.packId === ref.packId && previous.ref.assetId === ref.assetId && previous.topic === topic;
    if (same && previous.level === level) return previous;
    const threshold = document.timeline.turn?.onLevel ?? 3;
    return {ref, level, ...(topic === undefined ? {} : {topic}), startedAt:{turn,page}, phase:!same ? 'entry' : previous.level < threshold && level >= threshold ? 'turn' : 'idle'};
}
function emptyPerformanceLayer() { return {skin:null, bgm:null, look:null, ambience:null, widgets:{}}; }
function reducePerformanceEvent(layer, event) {
    const next = {...layer, widgets:{...layer.widgets}};
    switch (event.do) {
    case 'skin': next.skin = {ref:event.ref, ...(event.level === undefined ? {} : {level:event.level})}; break;
    case 'skin-off': next.skin = null; break;
    case 'bgm': next.bgm = {...layer.bgm, ref:event.ref, fadeMs:event.fadeMs ?? 0}; break;
    case 'bgm-restore': next.bgm = null; break;
    case 'look': next.look = {ref:event.ref}; break;
    case 'look-off': next.look = null; break;
    case 'ambience': next.ambience = {ref:event.ref, gainDb:event.gainDb ?? 0}; break;
    case 'ambience-off': next.ambience = null; break;
    case 'widget': next.widgets[event.slot || 'default'] = {ref:event.ref, ...(event.state ? {state:event.state} : {})}; break;
    case 'widget-off': if (event.slot) delete next.widgets[event.slot]; else next.widgets = {}; break;
    }
    return next;
}
function performanceSustained(plan) {
    if (!plan || plan.phase === 'exit') return emptyPerformanceLayer();
    let layer = emptyPerformanceLayer();
    if (plan.bgm) layer.bgm = {...plan.bgm};
    for (const event of plan.sustainedEvents || plan.events) layer = reducePerformanceEvent(layer,event);
    return layer;
}
// The compiler keeps source ordinals, even when two events share media or a timestamp.
// resolveEvent supplies only already validated reference/skin timing metadata, never IO.
function performancePlan(compiled, {phase, level, resolveEvent = event => event} = {}) {
    const high = level >= compiled.onLevel;
    const names = phase === 'entry' ? ['entry', ...(high ? ['turn'] : [])] : [phase];
    const base = ['entry', ...(high ? ['turn'] : []), ...(phase === 'idle' ? ['idle'] : [])];
    let durationMs = 0;
    const blocks = [], events = [];
    for (const name of names) {
        const block = compiled.blocks[name];
        if (!block) continue;
        const resolved = block.events.map(resolveEvent);
        const duration = Math.max(block.durationMs, ...resolved.map(event => event.at + (event.completionMs || 0)));
        blocks.push({name, startMs:durationMs, durationMs:duration});
        events.push(...resolved.map(event => ({...event, at:durationMs + event.at})));
        durationMs += duration;
    }
    return {phase, level, blocks, events, durationMs, idleEvery:compiled.idleEvery,
        bgm:compiled.bgm ? resolveEvent({do:'bgm',...compiled.bgm}) : null,
        sustainedEvents:(phase === 'exit' ? [] : base.flatMap(name => compiled.blocks[name]?.events || [])).map(resolveEvent),
        idleEvents:(compiled.blocks.idle?.events || []).map(resolveEvent), sfxMap:compiled.sfxMap};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {compilePerformance, reducePerformanceEvent, performanceSustained, performancePlan, performanceBoundary};
