// minimal production overlay; artwork stays outside scene grading and camera transforms.
// @include cg-consumer.cjs
function cgPaintFrame(element,frame) {
    if (!element) return false;
    element.style.display=frame.visible ? 'block' : 'none';
    element.style.opacity=String(frame.white > 0 || frame.current && frame.previous ? 1 : frame.alpha);
    const flash=element.querySelector('.fork-cg-white');
    if (flash) flash.style.opacity=String(frame.white || 0);
    const images=element.querySelectorAll('img'), view={width:element.clientWidth,height:element.clientHeight};
    [frame.previous,frame.current].forEach((value,index)=>{
        const image=images[index];
        if (!value) {image.style.display='none';image.removeAttribute('src');return;}
        if (image.getAttribute('src') !== value.media.url) image.src=value.media.url;
        image.alt=value.label || 'CG';image.style.display='block';
        image.style.opacity=String(frame.current && frame.previous ? index ? frame.alpha : 1-frame.alpha : 1);
        if (image.naturalWidth && view.width) {
            const transform=cgTransform(view,{width:image.naturalWidth,height:image.naturalHeight},frame.focus);
            image.style.transform=`translate(${transform.x}px,${transform.y}px) scale(${transform.zoom})`;
        }
    });
    return !!frame.current && images[1].complete && images[1].naturalWidth > 0 && view.width > 0 && view.height > 0 && element.isConnected && !document.hidden && element.checkVisibility?.({checkVisibilityCSS:true,checkOpacity:true}) !== false;
}
function CgGallery(props) { return stageViews ? React.createElement(stageViews.gallery.Gallery, props) : null; }
function useCgStage(sessionId, store, options) {
    const root = React.useRef(null), latest = React.useRef(options); latest.current=options;
    const [visible,setVisible]=React.useState(false), [notice,setNotice]=React.useState('');
    const consumer=React.useMemo(()=>createCgConsumer({clock:forkForeground,onVisible:setVisible,
        onFrame(frame) {
            const element=root.current;
            return cgPaintFrame(element,frame);
        },
        onPlayed(value,provenance) {
            const state=store.getSnapshot(), token=state.accepted.provenanceByChannel.cg?.token;
            if (!provenance || token !== provenance || JSON.stringify(provenance.source) !== JSON.stringify(state.source) || provenance.visitId !== state.cursor.visitId || JSON.stringify(provenance.anchor) !== JSON.stringify(state.cursor.anchor) || latest.current.paused) return;
            if (value.receipt) void rpc('ackCgPlayed',{turn:provenance.source.turn,receipt:value.receipt,ref:value.ref,variant:value.variant},sessionId)
                .then(()=>setNotice(''),error=>{if(error.code !== 'REVISION_CONFLICT') setNotice('回想进度未保存');});
            latest.current.onPlayed?.(value,provenance,state);
        }
    }),[sessionId,store]);
    React.useLayoutEffect(()=>{
        const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const update=()=>consumer.policy({pause:options.paused,snap:!options.forward,...cgMotionPolicy(options,media?.matches)});
        update();media?.addEventListener?.('change',update);
        return ()=>media?.removeEventListener?.('change',update);
    },[consumer,options.paused,options.reducedMotion,options.photosensitive,options.forward]);
    React.useLayoutEffect(()=>{
        const observer=new ResizeObserver(()=>consumer.redraw());
        if (root.current) observer.observe(root.current);
        return ()=>{observer.disconnect();consumer.dispose();};
    },[consumer]);
    const accept=React.useCallback(intent=>{
        if (intent.type === 'release-presentation' || intent.type === 'revoke-presentation') return consumer.present(null,{snap:true});
        return consumer.present(intent.accepted.cg,{snap:intent.transition === 'snap' || !latest.current.forward,provenance:intent.accepted.provenanceByChannel.cg?.token});
    },[consumer]);
    return {visible,accept,notice,node:React.createElement('div',{ref:root,className:'fork-cg-stage','aria-hidden':true},React.createElement('img',{draggable:false}),React.createElement('img',{draggable:false}),React.createElement('div',{className:'fork-cg-white'}))};
}
