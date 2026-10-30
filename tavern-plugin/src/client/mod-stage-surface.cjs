'use strict';

// P3 owns event consumption. This controller only owns the finite surface and its media URLs.
function createModStageSurface({definitions,readMedia,createURL,revokeURL,onChange,clock={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}}) {
    const validate=typeof module!=='undefined' && typeof window==='undefined' ? require('./stage-auto-timing.cjs').validateStagePerformanceTiming : validateStagePerformanceTiming;
    const overlaps=typeof module!=='undefined' && typeof window==='undefined' ? require('./stage-auto-timing.cjs').stagePerformanceRegionsOverlap : stagePerformanceRegionsOverlap;
    const renderers=new Map(definitions.map(row=>[row.kind,validate(row)]));
    let rows=[],epoch=0,active=false;
    const emit=()=>onChange(rows.filter(row=>row.ready).map(row=>({id:row.id,performance:row.performance,definition:row.definition,media:{...row.media}})),
        {busy:rows.length>0,holds:rows.map(row=>({id:row.id,pending:true})),regions:[...new Set(rows.flatMap(row=>row.definition.regions))]});
    const release=row=>{row.resolveReady?.();clock.clearTimeout(row.timer);Object.values(row.media).forEach(revokeURL);row.media={};};
    function reset(enabled=false) {epoch++;active=enabled;rows.forEach(release);rows=[];emit();}
    function pump() {
        // Earlier queued claims also reserve their regions: no overtaking and no priority numbers.
        for(let index=0;index<rows.length;index++) {
            const row=rows[index];
            if(!row.started && !rows.slice(0,index).some(earlier=>overlaps(earlier.definition.regions,row.definition.regions))) {row.started=true;void row.start();}
        }
    }
    function finish(row) {
        const until=row.definition.autoHold.until;
        if(!rows.includes(row) || !row.ready || !row.minimumDone || until==='complete' && !row.completed || until==='dismiss' && !row.dismissed)return;
        rows=rows.filter(value=>value!==row);release(row);pump();emit();
    }
    const signal=(id,key)=>{const row=rows.find(row=>row.id===id);if(row){row[key]=true;finish(row);}};
    return Object.freeze({reset,complete:id=>signal(id,'completed'),dismiss:id=>signal(id,'dismissed'),
        async play(descriptor,token) {
            const performance=descriptor.performance,definition=renderers.get(performance?.kind);
            if(!active || descriptor.kind!=='mod-performance' || !definition)return;
            const ownEpoch=epoch,row={id:token.id,performance,definition,media:{}};
            const ready=new Promise(resolve=>{row.resolveReady=resolve;});
            const current=()=>active && epoch===ownEpoch && rows.includes(row);
            row.start=async()=>{
            // Media preparation must not consume the finite presentation's visible lifetime.
            await Promise.all(Object.entries(definition.media(performance)).map(async([slot,media])=>{
                try {
                    const result=await readMedia({turn:token.source.turn,source:performance.source,performanceId:performance.id,...media});
                    if(!current()){result.pin?.release();return;}
                    row.media[slot]=createURL(result);
                } catch (_) { /* An unavailable image still permits a text-only presentation. */ }
            }));
            if(!current())return;
            row.ready=true;
            row.timer=clock.setTimeout(()=>{if(current()){row.minimumDone=true;finish(row);}},definition.autoHold.minMs);
            emit();row.resolveReady();
            };
            rows.push(row);emit();pump();
            return ready;
        },
        dispose:()=>reset(false),
    });
}
// Logical bands stay below host dialogue and controls, including fullscreen presentation.
const MOD_UI_BANDS=Object.freeze({'stage-overlay':2,presentation:4,audience:5});
const MOD_STAGE_SAFE_REGIONS='.fork-gal-box,.fork-gal-topbar,.fork-gal-choices,.fork-widget-source-controls,.fork-gal-notices';
// Stage-local units: a docked stage is scaled (createModStageDock), and the mod layers live inside it.
function modStageScale(root,frame=root.getBoundingClientRect()) {
    return frame.width>0 && Math.abs(frame.width-root.offsetWidth)>=1 ? root.offsetWidth/frame.width : 1;
}
function modStageViewport(root) {
    const frame=root.getBoundingClientRect(),k=modStageScale(root,frame),safeRegions=[...root.querySelectorAll(MOD_STAGE_SAFE_REGIONS)].map(node=>{
        const rect=node.getBoundingClientRect();return {x:(rect.left-frame.left)*k,y:(rect.top-frame.top)*k,width:rect.width*k,height:rect.height*k};
    }).filter(rect=>rect.width>0 && rect.height>0);
    return k===1 ? {width:frame.width,height:frame.height,safeRegions} : {width:root.offsetWidth,height:root.offsetHeight,safeRegions};
}
// Longest transition on the stage while it moves (theme.css: ~300 ms, 0 with 减少动态).
function modDockMs(root) {
    const value=root.ownerDocument.defaultView?.getComputedStyle?.(root).transitionDuration || '0s';
    return Math.max(0,...value.split(',').map(part=>(parseFloat(part) || 0)*(/ms\s*$/.test(part)?1:1000)));
}
// docking never resizes the stage. The stage keeps its own size
// (no new viewport, so the scene is not re-laid out and figures are not re-parked) and is scaled and moved into the rect
// left of the column (transform, origin top-left); a room band takes the height left under it (≥120px), otherwise the
// stage is centred and the rest is the room's dark backdrop (letterbox). Docking and release move ~300 ms both ways
// (theme.css [data-mod-dock="moving"]; instant with 减少动态); a resize while docked follows at once.
function createModStageDock(root) {
    let owner=null, slots=null, original=null, moving=null, leaving=false;
    // The column slides in from the right edge and the band up from the bottom while the stage moves (and back out).
    const slide=(nodes,out)=>{const ms=modDockMs(root);for(const node of nodes){
        node.getAnimations?.().forEach(a=>a.cancel());
        const away=node.dataset.slot==='below'?'translateY(100%)':'translateX(100%)';
        if(ms)node.animate?.([{transform:out?'none':away},{transform:out?away:'none'}],{duration:ms,easing:'ease',fill:out?'forwards':'backwards'});
    }};
    // The transition applies only while the stage moves between docked and full; afterwards it is plain state.
    function move() {
        clearTimeout(moving);root.dataset.modDock='moving';
        const ms=modDockMs(root);
        moving=setTimeout(()=>{moving=null;if(leaving)teardown();else if(slots)root.dataset.modDock='right';},ms+34);
    }
    function teardown() {
        clearTimeout(moving);moving=null;leaving=false;
        if (!slots) return;
        // A throttled compositor can still be mid-transition when the cleanup timer fires.
        // Remove the owned transition before restoring layout; never leave its interpolated transform.
        delete root.dataset.modDock;
        for (const animation of root.getAnimations?.() || []) if (animation.transitionProperty==='transform') animation.cancel();
        for (const [key,value] of Object.entries(original)) root.style[key]=value;
        for (const node of [slots.column,slots.below,slots.backdrop]) node?.remove();
        owner=null; slots=null; original=null;
    }
    function release() {
        if (!slots || leaving) return;
        owner=null; leaving=true;
        root.dataset.modDock='moving';
        root.style.transform=original.transform;
        slide([slots.column,slots.below].filter(Boolean),true);
        if (!modDockMs(root)) teardown(); else move();
    }
    const slot=(name,before)=>{
        const node=root.ownerDocument.createElement('aside');node.dataset.slot=name;
        root.parentElement.insertBefore(node,before || null);
        if (name!=='backdrop') slide([node],false);
        return node;
    };
    return Object.freeze({
        request(key, request) {
            if (!request) { if (owner===key) release(); return null; }
            if (request.side!=='right' || owner && owner!==key || !root.parentElement) return null;
            const frame=root.parentElement.getBoundingClientRect();
            if (frame.width<900) { if (owner===key) release(); return null; }
            const columnWidth=Math.min(380,Math.max(280,frame.width*0.28)),room=frame.width-columnWidth;
            const width=root.offsetWidth || frame.width,height=root.offsetHeight || frame.height,scale=Math.min(room/width,frame.height/height);
            const shown={width:width*scale,height:height*scale},remaining=frame.height-shown.height,banded=remaining>=120;
            const enter=!slots || leaving;
            if (enter) move();
            if (!slots) {
                original=Object.fromEntries(['transform','transformOrigin'].map(key=>[key,root.style[key]]));
                slots={column:null,below:null,backdrop:slot('backdrop',root)};
                slots.column=slot('column');
            } else if (leaving) { leaving=false; slide([slots.column,slots.below].filter(Boolean),false); }
            owner=key;
            if (banded && !slots.below) slots.below=slot('below');
            if (!banded && slots.below) { slots.below.remove();slots.below=null; }
            for (const node of [slots.backdrop,slots.column,slots.below].filter(Boolean)) {
                // Identical class/data writes still invalidate the entire dock subtree in Chromium.
                if(node.className!=='fork-gal-theme-scope fork-mod-dock')node.className='fork-gal-theme-scope fork-mod-dock';
                if(node.dataset.theme!==root.dataset.theme)node.dataset.theme=root.dataset.theme;
                if(node.dataset.fkContext!==root.dataset.fkContext)node.dataset.fkContext=root.dataset.fkContext;
                for (const property of root.style) if (property.startsWith('--')) node.style.setProperty(property,root.style.getPropertyValue(property));
                Object.assign(node.style,{position:'absolute',overflow:'hidden',pointerEvents:'auto'});
                // The backdrop sits under the stage (DOM order); the slots in the audience band above it.
                if (node!==slots.backdrop) node.style.zIndex=String(MOD_UI_BANDS.audience);
            }
            const x=(room-shown.width)/2,y=banded?0:remaining/2;
            root.style.transformOrigin='0 0';
            root.style.transform='translate('+x+'px, '+y+'px) scale('+scale+')';
            Object.assign(slots.backdrop.style,{left:'0px',top:'0px',width:frame.width+'px',height:frame.height+'px'});
            Object.assign(slots.column.style,{left:room+'px',top:'0px',width:columnWidth+'px',height:frame.height+'px'});
            if(slots.below)Object.assign(slots.below.style,{left:'0px',top:shown.height+'px',width:room+'px',height:remaining+'px'});
            return {column:slots.column,below:slots.below};
        },dispose:teardown,
    });
}
function createModUiLayerHost({root,renderers,geometry=()=>modStageViewport(root),dock=createModStageDock(root)}) {
    const mounted=new Map(),doc=root.ownerDocument;
    let latest=null,refreshing=false;
    const resize=typeof ResizeObserver==='function' ? new ResizeObserver(()=>{if(latest)sync(...latest);}) : null;
    if(root.parentElement)resize?.observe(root.parentElement);
    // Host UI can appear or expand without a new mod view or stage fact.
    let safeNodes=new Set();
    const observeRegions=()=>{
        const next=new Set(root.querySelectorAll(MOD_STAGE_SAFE_REGIONS));
        const changed=next.size!==safeNodes.size || [...next].some(node=>!safeNodes.has(node));
        for(const node of safeNodes)if(!next.has(node))resize?.unobserve(node);
        for(const node of next)if(!safeNodes.has(node))resize?.observe(node);
        safeNodes=next;
        if(changed && latest)sync(...latest);
    };
    const mutations=typeof MutationObserver==='function' ? new MutationObserver(observeRegions) : null;
    mutations?.observe(root,{childList:true,subtree:true});observeRegions();
    function remove(key) {const row=mounted.get(key);if(!row)return;row.view.dispose?.();dock.request(key,null);row.node.remove();mounted.delete(key);}
    function sync(layers,context,views={}) {
        latest=[layers,context,views];
        const before=geometry();
        const ordered=[...layers].sort((a,b)=>MOD_UI_BANDS[a.band]-MOD_UI_BANDS[b.band] || a.order-b.order || (a.modId<b.modId?-1:a.modId>b.modId?1:0) || (a.id<b.id?-1:a.id>b.id?1:0));
        const wanted=new Set(ordered.map(row=>row.modId+'/'+row.id));
        for(const key of mounted.keys())if(!wanted.has(key))remove(key);
        const placed=[];
        for(const layer of ordered) {
            const key=layer.modId+'/'+layer.id,render=renderers[layer.modId+'/'+layer.entry];
            if(!render || !Object.hasOwn(MOD_UI_BANDS,layer.band))continue;
            const signature=JSON.stringify(layer);
            let row=mounted.get(key);
            if(row && row.signature!==signature){remove(key);row=null;}
            if(!row) {
                const node=doc.createElement('div');node.className='fork-mod-ui-layer';node.dataset.band=layer.band;node.dataset.input=layer.input;
                row={node,signature,slots:null};
                const requestDock=request=>{
                    row.slots=layer.input==='regions' ? dock.request(key,request) : null;
                    return row.slots;
                };
                row.view=render({root:node,context,viewport:geometry(),budget:layer.budget,dock:requestDock});
                mounted.set(key,row);
            }
            if(views[layer.modId])row.view.update?.(views[layer.modId]);
            row.view.update?.({context,viewport:geometry()});
            const surfaces=[row.node,...(row.slots?[row.slots.column,row.slots.below].filter(Boolean):[])];
            if(surfaces.reduce((n,node)=>n+node.querySelectorAll('*').length,0)>layer.budget.maxNodes || surfaces.reduce((n,node)=>n+node.children.length,0)>layer.budget.maxVisible){remove(key);continue;}
            placed.push(row.node);
        }
        // DOM order resolves same-band ties; the mod never receives a global z-index. Re-append only when the order changed:
        // moving a layer re-parents its subtree, which resets every scroll position inside it (the floating 直播风格 chat).
        const tail=[...root.children].slice(-placed.length);
        if(placed.some((node,i)=>tail[i]!==node))for(const node of placed)root.appendChild(node);
        const after=geometry();
        if(!refreshing && (before.width!==after.width || before.height!==after.height)) {
            refreshing=true;
            try {sync(layers,context,views);} finally {refreshing=false;}
        }
    }
    return Object.freeze({sync,dispose(){latest=null;mutations?.disconnect();resize?.disconnect();safeNodes.clear();for(const key of [...mounted.keys()])remove(key);dock.dispose();}});
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createModStageSurface,createModUiLayerHost,createModStageDock,modStageViewport,modStageScale,MOD_UI_BANDS};
