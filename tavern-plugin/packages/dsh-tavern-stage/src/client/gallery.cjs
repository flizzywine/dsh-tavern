function createStageGallery({React, window, document, ResizeObserver, IntersectionObserver, AbortController, clock:forkForeground, owner:getOwner, consumer:createCgConsumer, paint:cgPaintFrame, revision:usePackRevision, rpc, Spinner, EmptyState, openLibrary}) {
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
// 回想's line icons (24-unit grid, stroked by CSS).
const ICON = {
    edit:['M4 20h4L19 9l-4-4L4 16z','M13.5 6.5l4 4'],
    remove:['M4 7h16','M9 7V4.5h6V7','M6.5 7l1 13h9l1-13','M10 11v5.5M14 11v5.5'],
    close:['M6 6l12 12M18 6L6 18'],
    prev:['M15 5l-7 7 7 7'],
    next:['M9 5l7 7-7 7'],
    full:['M4 5.5h16v13H4z','M4 15.5l4.5-4.5 4 4 2.5-2.5 5 5'],
    zoom:['M10.5 4.5a6 6 0 1 0 0 12a6 6 0 1 0 0-12z','M15 15l5 5','M8 10.5h5M10.5 8v5'],
    lock:['M6.5 11h11v9h-11z','M9 11V8.5a3 3 0 0 1 6 0V11'],
    warn:['M12 4.5l8.5 15h-17z','M12 10v4.5','M12 17.3v.2'],
    check:['M5 12.5l4.5 4.5L19 7.5'],
};
const icon = name => React.createElement('svg',{className:'fork-cg-icon',viewBox:'0 0 24 24','aria-hidden':true},ICON[name].map((d,i)=>React.createElement('path',{key:i,d})));
// a glass icon button over the picture; its name is the hover tip.
const round = (k,label,onClick,props) => React.createElement('button',{type:'button',className:'fork-cg-round','data-k':k,'aria-label':label,'data-tip':label,onClick,...props},icon(k));
const refKey = item => JSON.stringify(item.ref);
// isolated gallery preview. No canonical state writes or played acknowledgements.
// onAspect hears the picture's width / height once it has loaded (the viewer fits its controls around it).
function CgGalleryImage({image,authority,focus,thumb=false,onAspect}) {
    const root=React.useRef(null),fill=React.useRef(null),[status,setStatus]=React.useState('loading');
    useEffect(()=>{
        const element=root.current,owner=getOwner();
        if (!element || !image || !owner) return;
        let active=true,pin=null,observer=null,visible=false,generation=0,pending=null,previewKey='';
        const consumer=createCgConsumer({clock:forkForeground,onFrame:frame=>cgPaintFrame(element,frame)});
        consumer.policy({reducedMotion:true});setStatus('loading');
        const preview=()=>{
            const rect=element.parentElement.getBoundingClientRect(),zoom=(focus||image.focus)?.zoom||1;
            return {width:rect.width*zoom,height:rect.height*zoom,dpr:window.devicePixelRatio||1};
        };
        const resize=new ResizeObserver(()=>{
            if (!active || disposed) return;
            consumer.redraw();
            if(thumb&&visible&&JSON.stringify(preview())!==previewKey)void load();
        });resize.observe(element.parentElement);if(!thumb)resize.observe(element);
        async function load() {
            if (!active || disposed) return;
            const token=++generation;pending?.abort();pending=new AbortController();
            const tier=thumb?preview():null;previewKey=JSON.stringify(tier);
            try {
                const prepared=await owner.prepare(image,authority,{usage:'cg-gallery',signal:pending.signal,...(tier?{preview:tier}:null)});
                if (!active || disposed || token!==generation) {prepared.release();return;}
                const previous=pin;pin=prepared;
                // the viewer's letterbox is the same picture, blurred (fill).
                if (fill.current) fill.current.src=prepared.value.media.url;
                try {await consumer.present({...prepared.value,focus:focus||image.focus},{snap:true});}
                finally {previous?.release();}
                if (active && !disposed && token===generation) setStatus('ready');
            } catch (_) {if(active&&!disposed&&token===generation)setStatus('error');}
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
    const h=React.createElement;
    return h('div',{className:'fork-cg-gallery-picture','data-status':status},
        thumb?null:h('img',{ref:fill,className:'fork-cg-gallery-fill',alt:'',draggable:false,onLoad:onAspect?event=>onAspect(event.currentTarget.naturalWidth/event.currentTarget.naturalHeight):undefined}),
        h('div',{ref:root,className:'fork-cg-stage'},h('img',{draggable:false}),h('img',{draggable:false})),
        status==='error'?h('span',{className:'fork-cg-gallery-missing',role:'status'},icon('warn'),thumb?null:'素材不可用'):
        status==='loading'&&!thumb&&Spinner?h('span',{className:'fork-cg-gallery-loading',role:'status','aria-label':'正在载入'},h(Spinner,null)):null);
}
function CgGallery({sessionId,store,onClose,onExit}) {
    const h=React.createElement,root=React.useRef(null),opener=React.useRef(null),lastCell=React.useRef(null),more=React.useRef(null);
    const [items,setItems]=React.useState([]),[cursor,setCursor]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(true);
    // the viewer shows the CG whose ref key is selected; the item itself is read from the latest list.
    const [selected,setSelected]=React.useState(null),[variant,setVariant]=React.useState(''),[focus,setFocus]=React.useState(null);
    const [uiOff,setUiOff]=React.useState(false),[active,setActive]=React.useState(false),[cropOpen,setCropOpen]=React.useState(false);
    // the viewer's size and the shown picture's aspect decide where its controls go (fork-cg-viewer data-fit).
    const viewerNode=React.useRef(null),[box,setBox]=React.useState(null),[aspect,setAspect]=React.useState(0);
    const revision=usePackRevision(),generation=React.useRef(0),lastIndex=React.useRef(0),idle=React.useRef(0),swipe=React.useRef(null),swiped=React.useRef(false);
    const wasViewer=React.useRef(false);
    // a 场景生图 CG (row.scene): 在素材库中编辑 opens its entry in the 素材库; 🗑 removes it everywhere at once (busy | failed).
    const [removing,setRemoving]=React.useState(null);
    const source=store.getSnapshot().source,authority=JSON.stringify([source.sessionId,source.authorityEpoch]);
    const viewable=items.filter(item=>item.unlocked&&item.available);
    const index=selected?viewable.findIndex(item=>refKey(item)===selected):-1,item=index>=0?viewable[index]:null;
    const shown=item&&(item.variants.find(v=>v.key===variant)||item.variants.find(v=>v.key===item.defaultVariant)||item.variants[0]);
    async function load(next=null) {
        if (disposed) return;
        const token=++generation.current;setBusy(true);setError('');
        try {
            const result=await rpc('getCgGallery',{...(next?{cursor:next}:{})},sessionId);
            if(disposed||token!==generation.current)return;
            setItems(old=>next?[...old,...result.items]:result.items);setCursor(result.nextCursor);
        } catch(e) {if(!disposed&&token===generation.current)setError(e.code==='REVISION_CONFLICT'?'素材目录已改变':'回想没能载入');}
        finally {if(!disposed&&token===generation.current)setBusy(false);}
    }
    // a new revision re-reads the list in place; the open CG stays open while it still exists.
    useEffect(()=>{void load();return()=>{generation.current++;};},[sessionId,revision]);
    useEffect(()=>{
        opener.current=document.activeElement;root.current?.focus();
        return ()=>{if(idle.current)window.clearTimeout(idle.current);if(opener.current?.isConnected)opener.current.focus();};
    },[]);
    // the open CG left the list (deleted here or elsewhere): show the one now at its place, else the one before, else the grid.
    React.useLayoutEffect(()=>{
        if (disposed || !selected) return;
        if (index>=0) {lastIndex.current=index;return;}
        const next=viewable[Math.min(lastIndex.current,viewable.length-1)];
        if (next) {lastCell.current=refKey(next);setSelected(refKey(next));setVariant(next.defaultVariant);} else setSelected(null);
        setFocus(null);setRemoving(null);setCropOpen(false);
    },[items,selected]);
    React.useLayoutEffect(()=>{
        if (disposed || !root.current) return;
        const viewer=!!item,left=wasViewer.current&&!viewer;wasViewer.current=viewer;
        if (viewer && !root.current.contains(document.activeElement)) root.current.focus();
        else if (left) ([...root.current.querySelectorAll('[data-cg-cell]')].find(node=>node.dataset.cgCell===lastCell.current)||root.current).focus();
    },[selected,!!item,removing,uiOff]);
    useEffect(()=>{
        const node=viewerNode.current;
        if (!node) return;
        const observer=new ResizeObserver(()=>{if(!disposed)setBox({width:node.clientWidth,height:node.clientHeight});});
        observer.observe(node);
        return ()=>observer.disconnect();
    },[!!item]);
    // more of the list loads when its end scrolls into view.
    useEffect(()=>{
        const node=more.current;
        if (!node || !cursor || busy || item) return;
        const observer=new IntersectionObserver(rows=>{if(!disposed&&rows.some(row=>row.isIntersecting))void load(cursor);},{root:node.parentElement});
        observer.observe(node);
        return ()=>observer.disconnect();
    },[cursor,busy,!!item]);
    function show(next) {
        if (disposed || !next) return;
        lastCell.current=refKey(next);setSelected(refKey(next));setVariant(next.defaultVariant);setFocus(null);setRemoving(null);setCropOpen(false);
    }
    const go=step=>{if(removing!=='busy')show(viewable[index+step]);};
    const cycle=step=>{if(!item||item.variants.length<2||removing==='busy')return;const list=item.variants,at=list.indexOf(shown);setVariant(list[(at+step+list.length)%list.length].key);};
    function leave() {if(disposed)return;setSelected(null);setFocus(null);setRemoving(null);setCropOpen(false);setUiOff(false);}
    function back() {if(disposed)return;if(cropOpen)setCropOpen(false);else if(item)leave();else onClose();}
    function edit() {if(disposed||!item||!openLibrary)return;const ref=item.ref;(onExit||onClose)();void openLibrary(sessionId,{packId:ref.packId,kind:'cg',figureId:ref.assetId});}
    async function remove() {
        if(disposed||!item||removing==='busy')return;
        setRemoving('busy');
        const gone=selected;
        try {await rpc('removeSceneCg',{ref:item.ref},sessionId);if(disposed)return;setRemoving(null);setItems(old=>old.filter(row=>refKey(row)!==gone));void load();}
        catch(_) {if(!disposed)setRemoving('failed');}
    }
    function key(event) {
        if (disposed) return;
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();back();return;}
        if(item && !cropOpen && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
            event.preventDefault();
            if(event.key==='ArrowLeft'||event.key==='ArrowRight')go(event.key==='ArrowRight'?1:-1);else cycle(event.key==='ArrowDown'?1:-1);
        }
        if(event.key==='Tab') {
            event.preventDefault();
            if(item&&uiOff){setUiOff(false);return;}
            const buttons=[...root.current.querySelectorAll('button:not(:disabled)')].filter(node=>node.checkVisibility({visibilityProperty:true}));
            const at=buttons.indexOf(document.activeElement);buttons[(at+(event.shiftKey?buttons.length-1:1))%buttons.length]?.focus();
        }
    }
    useEffect(()=>{window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[selected,variant,uiOff,removing,cropOpen,items,onClose]);
    // pointer over the viewer lights the controls; still for 3 s, they settle back.
    function wake(event) {
        if (event.pointerType!=='mouse') return;
        if (!active) setActive(true);
        if (idle.current) window.clearTimeout(idle.current);
        idle.current=window.setTimeout(()=>{idle.current=0;if(!disposed)setActive(false);},3000);
    }
    function tap(event) {
        if (swiped.current) {swiped.current=false;return;}
        if (event.target.closest('button, .fork-cg-crop-menu')) return;
        if (cropOpen) setCropOpen(false);
        else {if(!uiOff)root.current?.focus();setUiOff(!uiOff);}
    }
    // phones: a horizontal swipe changes the CG.
    const swipeStart=event=>{swiped.current=false;swipe.current=event.pointerType==='mouse'||event.target.closest('button')?null:{x:event.clientX,y:event.clientY};};
    function swipeEnd(event) {
        const start=swipe.current;swipe.current=null;
        if (!start) return;
        const dx=event.clientX-start.x,dy=event.clientY-start.y;
        if (Math.abs(dx)<48 || Math.abs(dx)<Math.abs(dy)*1.5) return;
        swiped.current=true;go(dx<0?1:-1);
    }
    function viewer() {
        // 构图 only when the CG has focus areas: 「完整」|「特写」, a labelled pair; several areas put them in a menu under 特写.
        const hints=item.focusHints,many=hints.length>1;
        const mode=(k,label,pressed,onClick,props)=>h('button',{type:'button',className:'fork-cg-compose-mode','data-k':k,'aria-pressed':pressed,onClick,...props},icon(k),h('span',null,label));
        // a picture narrower than the viewer leaves side bands; wide enough ones (side) hold the controls beside it.
        const band=aspect&&box?Math.floor((box.width-box.height*aspect)/2):0,fit=band>=280?'side':'over';
        return h('div',{ref:viewerNode,className:'fork-cg-viewer','data-ui':uiOff?'off':'on','data-active':active||undefined,'data-fit':fit,
                style:aspect?{'--cg-ar':aspect,'--cg-band':band+'px'}:undefined,
                onClick:tap,onPointerMove:wake,onPointerLeave:()=>setActive(false),onPointerDown:swipeStart,onPointerUp:swipeEnd,onPointerCancel:()=>{swipe.current=null;}},
            h(CgGalleryImage,{image:shown?.image,authority,focus,onAspect:setAspect}),
            h('div',{className:'fork-cg-viewer-ui'},
                h('div',{className:'fork-cg-viewer-scrim'}),
                h('header',{className:'fork-cg-viewer-top'},h('h2',null,item.label),
                    h('div',{className:'fork-cg-viewer-acts'},
                        item.scene&&openLibrary?round('edit','在素材库中编辑',edit):null,
                        item.scene?round('remove','删除这张 CG',remove,{'aria-busy':removing==='busy'||undefined}):null,
                        round('close','关闭',leave)),
                    removing==='failed'?h('p',{className:'fork-cg-remove-error',role:'alert'},icon('warn'),'没能删除，可以再试一次'):null),
                // the bottom row: on phones ‹ 差分 构图 › in one line; wider, its parts take their own places (display: contents).
                h('div',{className:'fork-cg-viewer-bottom'},
                index>0?round('prev','上一张',()=>go(-1),{className:'fork-cg-round fork-cg-nav is-prev'}):null,
                index<viewable.length-1?round('next','下一张',()=>go(1),{className:'fork-cg-round fork-cg-nav is-next'}):null,
                // 差分: a strip of mini pictures, bottom centre; the lit one is shown.
                item.variants.length>1?h('div',{className:'fork-cg-variants',role:'group','aria-label':'差分'},item.variants.map(v=>h('button',{key:v.key,type:'button',className:'fork-cg-variant','aria-label':v.label,'data-tip':v.label,'aria-pressed':v===shown,onClick:()=>setVariant(v.key)},
                    h(CgGalleryImage,{image:v.image,authority,thumb:true})))):null,
                hints.length?h('div',{className:'fork-cg-crop',role:'group','aria-label':'构图'},
                    mode('full','完整',!focus,()=>{setFocus(null);setCropOpen(false);}),
                    mode('zoom','特写',!!focus,()=>{if(many)setCropOpen(!cropOpen);else setFocus(hints[0]);},many?{'aria-haspopup':'menu','aria-expanded':cropOpen}:{}),
                    cropOpen?h('div',{className:'fork-cg-crop-menu',role:'menu','aria-label':'特写'},hints.map(choice=>h('button',{key:choice.key,type:'button',role:'menuitemradio','aria-checked':focus?.key===choice.key,
                        onClick:()=>{setFocus(choice);setCropOpen(false);}},icon('check'),choice.label))):null):null)));
    }
    function grid() {
        return h('div',{className:'fork-cg-grid-page'},
            h('header',{className:'fork-cg-grid-top'},h('h2',null,'回想'),round('close','关闭',onClose)),
            h('div',{className:'fork-cg-gallery-scroll'},
                !busy&&!error&&!items.length&&EmptyState?h(EmptyState,{text:'还没有 CG',icon:'empty'}):null,
                items.length?h('div',{className:'fork-cg-gallery-grid'},items.map(row=>{
                    const open=row.unlocked&&row.available,label=open?row.label:row.unlocked?'素材不可用':'尚未解锁';
                    return h('button',{key:refKey(row),'data-cg-cell':refKey(row),type:'button',className:'fork-cg-gallery-cell','data-state':open?'open':row.unlocked?'missing':'locked',
                            'aria-label':label,title:open?undefined:label,disabled:!open,onClick:()=>show(row)},
                        open?h(CgGalleryImage,{image:row.variants.find(v=>v.key===row.defaultVariant)?.image,authority,thumb:true}):icon(row.unlocked?'warn':'lock'),
                        open?h('span',{className:'fork-cg-cell-title'},row.label):null);
                })):null,
                cursor?h('div',{ref:more,className:'fork-cg-more'},busy&&Spinner?h(Spinner,null):null):null));
    }
    return h('section',{ref:root,tabIndex:-1,role:'dialog','aria-modal':true,'aria-label':'回想',className:'fork-cg-gallery'+(item?' is-viewing':''),
            onClick:e=>e.stopPropagation(),onWheel:e=>e.stopPropagation(),onContextMenu:e=>{e.preventDefault();e.stopPropagation();}},
        item?viewer():grid(),
        busy&&!items.length?h('p',{className:'fork-cg-gallery-wait',role:'status','aria-label':'正在读取回想'},Spinner?h(Spinner,null):null):null,
        error?h('p',{className:'fork-cg-gallery-error',role:'alert'},icon('warn'),error,h('button',{type:'button',onClick:()=>load()},'刷新')):null);
}

return {Gallery:CgGallery, Image:CgGalleryImage, dispose() {
    if (disposed) return;
    disposed = true;
    clean([...cleanups]);
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageGallery};
