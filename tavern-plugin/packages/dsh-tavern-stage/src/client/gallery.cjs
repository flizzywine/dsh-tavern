function createStageGallery({React, window, document, ResizeObserver, IntersectionObserver, AbortController, clock:forkForeground, owner:getOwner, consumer:createCgConsumer, paint:cgPaintFrame, revision:usePackRevision, rpc, Spinner}) {
let disposed = false;
const cleanups = new Set();
function useEffect(setup, deps) {
    React.useEffect(() => {
        if (disposed) return;
        const cleanup = setup();
        if (typeof cleanup !== 'function') return;
        let active = true;
        const release = () => {
            if (!active) return;
            active = false;
            cleanups.delete(release);
            cleanup();
        };
        cleanups.add(release);
        return release;
    }, deps);
}
function clean(actions) {
    const errors = [];
    for (const action of actions) { try { action(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Stage gallery cleanup failed');
}
// isolated gallery preview. No canonical state writes or played acknowledgements.
function CgGalleryImage({image,authority,focus,thumb=false}) {
    const root=React.useRef(null),[error,setError]=React.useState(false);
    useEffect(()=>{
        const element=root.current,owner=getOwner();
        if (!element || !image || !owner) return;
        let active=true,pin=null,observer=null,visible=false,generation=0,pending=null,previewKey='';
        const consumer=createCgConsumer({clock:forkForeground,onFrame:frame=>cgPaintFrame(element,frame)});
        consumer.policy({reducedMotion:true});setError(false);
        const preview=()=>{
            const rect=element.parentElement.getBoundingClientRect(),zoom=(focus||image.focus)?.zoom||1;
            return {width:rect.width*zoom,height:rect.height*zoom,dpr:window.devicePixelRatio||1};
        };
        const resize=new ResizeObserver(()=>{
            if (!active || disposed) return;
            consumer.redraw();
            if(thumb&&visible&&JSON.stringify(preview())!==previewKey)void load();
        });resize.observe(element.parentElement);
        async function load() {
            if (!active || disposed) return;
            const token=++generation;pending?.abort();pending=new AbortController();setError(false);
            const tier=thumb?preview():null;previewKey=JSON.stringify(tier);
            try {
                const prepared=await owner.prepare(image,authority,{usage:'cg-gallery',signal:pending.signal,...(tier?{preview:tier}:null)});
                if (!active || disposed || token!==generation) {prepared.release();return;}
                const previous=pin;pin=prepared;
                try {await consumer.present({...prepared.value,focus:focus||image.focus},{snap:true});}
                finally {previous?.release();}
            } catch (_) {if(active&&!disposed&&token===generation)setError(true);}
        }
        if (thumb) {
            // observe the laid-out shell, and retire decoded images on viewport exit.
            observer=new IntersectionObserver(rows=>{
                if (!active || disposed) return;
                const next=rows.some(row=>row.isIntersecting);
                if(next===visible)return;visible=next;
                if(next)void load();
                else {generation++;pending?.abort();void consumer.present(null,{snap:true});pin?.release();pin=null;}
            });observer.observe(element.parentElement);
        } else void load();
        return ()=>{active=false;generation++;clean([()=>pending?.abort(),()=>observer?.disconnect(),()=>resize.disconnect(),()=>consumer.dispose(),()=>pin?.release()]);};
    },[image,authority,focus,thumb]);
    return React.createElement('div',{className:'fork-cg-gallery-picture'},React.createElement('div',{ref:root,className:'fork-cg-stage'},React.createElement('img',{draggable:false}),React.createElement('img',{draggable:false})),error?React.createElement('span',{role:'status'},'素材不可用'):null);
}
function CgGallery({sessionId,store,onClose}) {
    const h=React.createElement,root=React.useRef(null),opener=React.useRef(null),lastCell=React.useRef(null);
    const [items,setItems]=React.useState([]),[cursor,setCursor]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(true);
    const [selected,setSelected]=React.useState(null),[variant,setVariant]=React.useState(''),[focus,setFocus]=React.useState(null),[hidden,setHidden]=React.useState(false);
    const revision=usePackRevision(),generation=React.useRef(0);
    const source=store.getSnapshot().source,authority=JSON.stringify([source.sessionId,source.authorityEpoch]);
    async function load(next=null) {
        if (disposed) return;
        const token=++generation.current;setBusy(true);setError('');
        try {
            const result=await rpc('getCgGallery',{...(next?{cursor:next}:{})},sessionId);
            if(disposed||token!==generation.current)return;
            setItems(old=>next?[...old,...result.items]:result.items);setCursor(result.nextCursor);
        } catch(e) {if(!disposed&&token===generation.current)setError(e.code==='REVISION_CONFLICT'?'素材目录已改变，请刷新':String(e.message||e));}
        finally {if(!disposed&&token===generation.current)setBusy(false);}
    }
    useEffect(()=>{setSelected(null);setItems([]);void load();return()=>{generation.current++;};},[sessionId,revision]);
    useEffect(()=>{
        opener.current=document.activeElement;root.current?.focus();
        return ()=>opener.current?.isConnected&&opener.current.focus();
    },[]);
    React.useLayoutEffect(()=>{
        if (disposed) return;
        const target=selected ? root.current?.querySelector(hidden?'.fork-cg-gallery-reveal':'header button')
            : [...(root.current?.querySelectorAll('[data-cg-cell]')||[])].find(node=>node.dataset.cgCell===lastCell.current);
        target?.focus();
    },[selected,hidden]);
    const active=selected?.variants.find(item=>item.key===variant);
    function back() {if(disposed)return;if(hidden)setHidden(false);else if(selected){setSelected(null);setFocus(null);}else onClose();}
    const choose=item=>{if(disposed)return;lastCell.current=JSON.stringify(item.ref);setSelected(item);setVariant(item.defaultVariant);setFocus(null);};
    function key(event) {
        if (disposed) return;
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();back();}
        if(selected && ['ArrowLeft','ArrowRight'].includes(event.key)) {
            event.preventDefault();const list=selected.variants,index=list.findIndex(v=>v.key===variant);
            setVariant(list[(index+(event.key==='ArrowRight'?1:list.length-1))%list.length].key);
        }
        if(event.key==='Tab') {
            const buttons=[...root.current.querySelectorAll('button:not(:disabled)')].filter(node=>node.getClientRects().length);
            const index=buttons.indexOf(document.activeElement);event.preventDefault();buttons[(index+(event.shiftKey?buttons.length-1:1))%buttons.length]?.focus();
        }
    }
    useEffect(()=>{window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[selected,variant,hidden,onClose]);
    return h('section',{ref:root,tabIndex:-1,role:'dialog','aria-modal':true,'aria-label':'回想',className:'fork-cg-gallery',onClick:e=>e.stopPropagation(),onWheel:e=>e.stopPropagation(),onContextMenu:e=>{e.preventDefault();e.stopPropagation();if(selected)setHidden(!hidden);}},
        selected?h(CgGalleryImage,{image:active?.image,authority,focus}):null,
        hidden?h('button',{type:'button',className:'fork-cg-gallery-reveal',onClick:()=>setHidden(false)},'显示控件'):
        h(React.Fragment,null,h('header',null,h('h2',null,selected?.label||'回想'),h('button',{type:'button',onClick:back},selected?'返回图库':'关闭')),
            selected?h('footer',null,h('div',{className:'fork-cg-gallery-strip',role:'group','aria-label':'差分'},selected.variants.map(v=>h('button',{key:v.key,type:'button','aria-pressed':v.key===variant,onClick:()=>setVariant(v.key)},v.label))),
                h('div',{className:'fork-cg-gallery-strip',role:'group','aria-label':'构图'},h('button',{type:'button','aria-pressed':!focus,onClick:()=>setFocus(null)},'完整图'),selected.focusHints.map(f=>h('button',{key:f.key,type:'button','aria-pressed':focus?.key===f.key,onClick:()=>setFocus(f)},f.label))),h('button',{type:'button',onClick:()=>setHidden(true)},'隐藏控件')):
            h('div',{className:'fork-cg-gallery-scroll'},!busy&&!items.length?h('p',null,'暂无 CG 素材'):null,
                h('div',{className:'fork-cg-gallery-grid'},items.map(item=>h('button',{key:JSON.stringify(item.ref),'data-cg-cell':JSON.stringify(item.ref),type:'button',className:'fork-cg-gallery-cell','aria-label':item.unlocked?(item.available?item.label:'素材不可用'):'尚未解锁',disabled:!item.unlocked||!item.available,onClick:()=>choose(item)},
                    item.unlocked&&item.available?h(CgGalleryImage,{image:item.variants.find(v=>v.key===item.defaultVariant)?.image,authority,thumb:true}):h('span',null,item.unlocked?'素材不可用':'尚未解锁'),item.unlocked&&item.available?h('span',null,item.label):null))),
                cursor?h('button',{type:'button',disabled:busy,onClick:()=>load(cursor)},'加载更多'):null)),
        busy?h('p',{role:'status','aria-label':'正在读取回想'},h(Spinner,null)):null,error?h('p',{role:'alert'},error,h('button',{type:'button',onClick:()=>load()},'刷新')):null);
}

return {Gallery:CgGallery, Image:CgGalleryImage, dispose() {
    if (disposed) return;
    disposed = true;
    clean([...cleanups]);
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageGallery};
