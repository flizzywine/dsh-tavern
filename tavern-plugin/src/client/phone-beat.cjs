'use strict';

// Only accepted director marks choose a surface; story text is never parsed for phone tags.
function phoneModBeat(direction,para) {
    if (!direction || !['partial','done'].includes(direction.phase) || para>direction.through) return null;
    for (const entry of direction.entries || []) {
        if (entry.at!==para) continue;
        const mark=entry.ops?.find(op=>op.op==='mod.command' && op.modId==='dsh.phone' && op.commandId==='mark')?.params;
        if (mark && ['in','out'].includes(mark.side) && typeof mark.contact==='string') return {...mark,form:mark.form || 'text'};
    }
    return null;
}
// once a phone line has been read the phone stays in hand through the narration between
// its lines. The run ends after the director's last sealed phone mark of the turn or when the scene (background) moves
// on; no new director command is involved. An unsealed tail keeps the run open until the director decides.
function phoneModRun(direction,para) {
    if (!direction || !['partial','done'].includes(direction.phase) || !(para>0)) return null;
    const through=Number.isFinite(direction.through) ? direction.through : 0;
    const entries=(direction.entries || []).filter(entry=>entry.at<=through).slice().sort((a,b)=>a.at-b.at);
    const sceneOf=op=>op.op==='scene.set' ? JSON.stringify(op.value?.background ?? op.value ?? null) : op.op==='scene.clear' ? 'clear' : undefined;
    let scene=direction.baseline?.scene===undefined ? undefined : JSON.stringify(direction.baseline.scene?.background ?? direction.baseline.scene);
    const marks=[],breaks=[];
    for (const entry of entries) {
        for (const op of entry.ops || []) {
            const next=sceneOf(op);
            if (next===undefined) continue;
            if (next!==scene) breaks.push(entry.at);
            scene=next;
        }
        if (phoneModBeat(direction,entry.at)) marks.push(entry.at);
    }
    // The run starts at its first phone line after the latest scene change (a line in the changing beat counts).
    const since=Math.max(0,...breaks.filter(at=>at<=para)),start=marks.find(at=>at>=since && at<=para);
    if (start===undefined) return null;
    // It continues while a later phone line of the same scene follows (a line in a changing beat starts a new run).
    const open=marks.some(at=>at>=para && !breaks.some(b=>b>para && b<=at)) || direction.phase!=='done' && para>=through;
    return open ? {start,key:JSON.stringify([direction.token?.sourceKey || '',direction.token?.generation ?? '',start])} : null;
}
function phoneModAutoVoiceAllowed(direction,para,directorEnabled) {
    if (phoneModBeat(direction,para)) return false;
    // Do not start speech before a sealed prefix can choose the phone-only surface.
    return !directorEnabled || ['off','error'].includes(direction.phase) || direction.through>=para;
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports={phoneModBeat,phoneModRun,phoneModAutoVoiceAllowed};
