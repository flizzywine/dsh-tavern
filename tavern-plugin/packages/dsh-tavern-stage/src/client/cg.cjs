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
function useCgStage(sessionId, store, options) {
    const root = React.useRef(null), latest = React.useRef(options); latest.current=options;
    const [visible,setVisible]=React.useState(false), [notice,setNotice]=React.useState('');
    const lifetime=React.useMemo(()=>({live:true}),[sessionId,store]);
    const consumer=React.useMemo(()=>createCgConsumer({clock:forkForeground,onVisible:value=>{if(lifetime.live&&!disposed)setVisible(value);},
        onFrame(frame) {
            if (disposed || !lifetime.live) return false;
            const element=root.current;
            return cgPaintFrame(element,frame);
        },
        onPlayed(value,provenance) {
            if (disposed || !lifetime.live) return;
            const state=store.getSnapshot(), token=state.accepted.provenanceByChannel.cg?.token;
            if (!provenance || token !== provenance || JSON.stringify(provenance.source) !== JSON.stringify(state.source) || provenance.visitId !== state.cursor.visitId || JSON.stringify(provenance.anchor) !== JSON.stringify(state.cursor.anchor) || latest.current.paused) return;
            if (value.receipt) void rpc('ackCgPlayed',{turn:provenance.source.turn,receipt:value.receipt,ref:value.ref,variant:value.variant},sessionId)
                .then(()=>{if(!disposed&&lifetime.live)setNotice('');},error=>{if(!disposed&&lifetime.live&&error.code !== 'REVISION_CONFLICT') setNotice('回想进度未保存');});
            latest.current.onPlayed?.(value,provenance,state);
        }
    }),[sessionId,store]);
    React.useLayoutEffect(()=>{
        if (disposed) return;
        let active = true;
        const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const update=()=>{if(active&&!disposed&&lifetime.live)consumer.policy({pause:options.paused,snap:!options.forward,...cgMotionPolicy(options,media?.matches)});};
        update();media?.addEventListener?.('change',update);
        return own(()=>{active=false;media?.removeEventListener?.('change',update);});
    },[consumer,options.paused,options.reducedMotion,options.photosensitive,options.forward]);
    React.useLayoutEffect(()=>{
        if (disposed) return;
        const observer=new ResizeObserver(()=>{if(lifetime.live&&!disposed)consumer.redraw();});
        if (root.current) observer.observe(root.current);
        return own(()=>{lifetime.live=false;clean([()=>observer.disconnect(),()=>consumer.dispose()]);});
    },[consumer]);
    const accept=React.useCallback(intent=>{
        if (disposed || !lifetime.live) return Promise.resolve();
        if (intent.type === 'release-presentation' || intent.type === 'revoke-presentation') return consumer.present(null,{snap:true});
        return consumer.present(intent.accepted.cg,{snap:intent.transition === 'snap' || !latest.current.forward,provenance:intent.accepted.provenanceByChannel.cg?.token});
    },[consumer]);
    return {visible,accept,notice,node:React.createElement('div',{ref:root,className:'fork-cg-stage','aria-hidden':true},React.createElement('img',{draggable:false}),React.createElement('img',{draggable:false}),React.createElement('div',{className:'fork-cg-white'}))};
}
return {useStage:useCgStage, dispose() { if(disposed)return;disposed=true;clean([...cleanups]); }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageCg};
