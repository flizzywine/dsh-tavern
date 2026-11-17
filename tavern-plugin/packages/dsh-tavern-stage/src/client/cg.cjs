function createStageCg({React, window, ResizeObserver, clock:forkForeground, consumer:createCgConsumer, paint:cgPaintFrame, policy:cgMotionPolicy, rpc}) {
let disposed = false;
const cleanups = new Set();
function own(cleanup) {
    let active = true;
    const release = () => { if (!active) return; active = false; cleanups.delete(release); cleanup(); };
    cleanups.add(release);
    return release;
}
function clean(actions) {
    const errors = [];
    for (const action of actions) { try { action(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Stage CG cleanup failed');
}
// 叠字: the shown CG's caption (title, one line) laid over the picture. It enters with the picture and leaves with it;
// its appearance (fade, type, rise) is CSS keyed to the caption, so a new caption restarts it and a snapped present
// (history, skip, reopen) shows it settled. Pause and reduced motion are CSS (data-paused, data-reduced-motion).
function paintCgCaption(element, frame, snap) {
    const box=element?.querySelector(':scope > .fork-cg-caption');
    if (!box) return;
    const shown=frame.current || frame.previous, caption=shown?.caption;
    const key=caption ? JSON.stringify([shown.media?.identity,caption]) : '';
    if (box.dataset.key === key) return;
    box.dataset.key=key;box.replaceChildren();
    if (!caption) {box.hidden=true;return;}
    const appear=caption.appear || 'fade', doc=box.ownerDocument;
    box.hidden=false;box.dataset.appear=appear;
    if (snap) box.dataset.snap='true'; else delete box.dataset.snap;
    let index=0;
    for (const [field,text] of [['title',caption.title],['line',caption.line]]) {
        if (!text) continue;
        const row=doc.createElement('div');
        row.className='fork-cg-caption-'+field;row.style.setProperty('--row',String(index ? 1 : 0));
        if (appear === 'type') for (const char of text) {
            const span=doc.createElement('span');span.textContent=char;span.style.setProperty('--i',String(index++));row.append(span);
        } else {row.textContent=text;index++;}
        box.append(row);
    }
}
function useCgStage(sessionId, store, options) {
    const root = React.useRef(null), latest = React.useRef(options); latest.current=options;
    const [visible,setVisible]=React.useState(false), [notice,setNotice]=React.useState(''), [holdTick,setHoldTick]=React.useState(0);
    const slot=React.useMemo(()=>({current:null}),[sessionId,store]);
    React.useLayoutEffect(()=>{
        if (disposed) return;
        const lease={live:true,consumer:null};
        slot.current=lease;
        const current=provenance=>{
            if (disposed || !lease.live || slot.current !== lease) return false;
            const state=store.getSnapshot();
            return provenance && state.accepted.provenanceByChannel.cg?.token === provenance
                && JSON.stringify(provenance.source) === JSON.stringify(state.source)
                && provenance.visitId === state.cursor.visitId
                && JSON.stringify(provenance.anchor) === JSON.stringify(state.cursor.anchor);
        };
        let observer=null;
        const release=own(()=>{
            lease.live=false;
            if(slot.current===lease)slot.current=null;
            clean([()=>observer?.disconnect(),()=>lease.consumer?.dispose()]);
        });
        try {
            lease.consumer=createCgConsumer({clock:forkForeground,
                onVisible:value=>{if(lease.live&&!disposed)setVisible(value);},
                onHold:()=>{if(lease.live&&!disposed)setHoldTick(tick=>tick+1);},
                onFrame:frame=>{
                    if (!lease.live || disposed) return false;
                    const painted=cgPaintFrame(root.current,frame);
                    paintCgCaption(root.current,frame,lease.snap);
                    return painted;
                },
                onPlayed(value,provenance) {
                    if(!current(provenance)||latest.current.paused)return;
                    if(value.receipt)void rpc('ackCgPlayed',{turn:provenance.source.turn,receipt:value.receipt,ref:value.ref,variant:value.variant},sessionId)
                        .then(()=>{if(current(provenance))setNotice('');},error=>{if(current(provenance)&&error.code!=='REVISION_CONFLICT')setNotice('回想进度未保存');});
                    latest.current.onPlayed?.(value,provenance,store.getSnapshot());
                }
            });
            observer=new ResizeObserver(()=>{if(lease.live&&!disposed)lease.consumer.redraw();});
            if(root.current)observer.observe(root.current);
            return release;
        } catch(error) {
            try {release();} catch(cleanupError) {throw new AggregateError([error,cleanupError],'Stage CG mount failed');}
            throw error;
        }
    },[slot]);
    React.useLayoutEffect(()=>{
        if (disposed) return;
        let active=true;
        const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const update=()=>{if(active&&!disposed)slot.current?.consumer.policy({pause:options.paused,snap:!options.forward,...cgMotionPolicy(options,media?.matches)});};
        const release=own(()=>{active=false;media?.removeEventListener?.('change',update);});
        try {update();media?.addEventListener?.('change',update);return release;}
        catch(error) {try {release();} catch(cleanupError) {throw new AggregateError([error,cleanupError],'Stage CG policy mount failed');}throw error;}
    },[slot,options.paused,options.reducedMotion,options.photosensitive,options.forward]);
    const accept=React.useCallback(intent=>{
        const consumer=slot.current?.consumer;
        if(disposed||!consumer)return Promise.resolve();
        if(intent.type==='release-presentation'||intent.type==='revoke-presentation'){slot.current.snap=true;return consumer.present(null,{snap:true});}
        const snap=intent.transition==='snap'||!latest.current.forward;
        slot.current.snap=snap;
        return consumer.present(intent.accepted.cg,{snap,provenance:intent.accepted.provenanceByChannel.cg?.token});
    },[slot]);
    const holdMs=()=>slot.current?.consumer?.holdMs() ?? 0;
    return {visible,accept,notice,holdTick,holdMs,node:React.createElement('div',{ref:root,className:'fork-cg-stage','aria-hidden':true,'data-paused':options.paused ? 'true' : undefined},React.createElement('img',{draggable:false}),React.createElement('img',{draggable:false}),React.createElement('div',{className:'fork-cg-caption',hidden:true}),React.createElement('div',{className:'fork-cg-white'}))};
}
return {useStage:useCgStage, dispose() { if(disposed)return;disposed=true;clean([...cleanups]); }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageCg};
