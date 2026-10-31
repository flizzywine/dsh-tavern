// Mod performance cards, docked UI layers and their subscriptions belong to one stage activation.
function createStageModSurface({React,window,document,sessions,scene,runtime,renderers,timing,core,readMedia,readItems,readViews,subscribe,useLiveView,useFaces}) {
const {ResizeObserver,MutationObserver,URL,Blob}=window;
const setTimeout=(...args)=>window.setTimeout(...args),clearTimeout=id=>window.clearTimeout(id),atob=value=>window.atob(value);
let closed=false;const owned=new Set();
function clean(actions){const errors=[];for(const action of actions)try{action();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Stage Mod cleanup failed');}
function scope(start){
    if(closed)throw new Error('Stage Mod disposed');
    let live=true;const actions=[];
    const release=()=>{if(!live)return;live=false;owned.delete(release);clean(actions.reverse());};
    try{start(action=>actions.push(action));owned.add(release);return release;}
    catch(error){try{release();}catch(cleanup){throw new AggregateError([error,cleanup],'Stage Mod startup failed');}throw error;}
}
function useEffect(start,deps){React.useEffect(()=>{if(!closed)return scope(start);},deps);}
function createModStageSurface(options){
    let live=true;
    const value=rawModStageSurface(options);
    const dispose=scope(register=>register(()=>{live=false;value.dispose();}));
    return {...value,reset:enabled=>{if(live&&!closed)value.reset(enabled);},play:(...args)=>{if(live&&!closed)return value.play(...args);},dispose};
}
function createModUiLayerHost(options){
    let value;const dispose=scope(register=>{value=rawModUiLayerHost(options,register);});
    return {...value,dispose};
}

// P3 owns event consumption. This controller only owns the finite surface and its media URLs.
function rawModStageSurface({definitions,readMedia,createURL,revokeURL,onChange,clock={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}}) {
    const validate=timing.validate;
    const overlaps=timing.overlaps;
    const renderers=new Map(definitions.map(row=>[row.kind,validate(row)]));
    let rows=[],epoch=0,active=false;
    const emit=()=>onChange(rows.filter(row=>row.ready).map(row=>({id:row.id,performance:row.performance,definition:row.definition,media:{...row.media}})),
        {busy:rows.length>0,holds:rows.map(row=>({id:row.id,pending:true})),regions:[...new Set(rows.flatMap(row=>row.definition.regions))]});
    const release=row=>{const media=Object.values(row.media);row.media={};clean([()=>row.resolveReady?.(),()=>clock.clearTimeout(row.timer),...media.map(url=>()=>revokeURL(url))]);};
    function reset(enabled=false) {epoch++;active=enabled;const old=rows;rows=[];clean([...old.map(row=>()=>release(row)),emit]);}
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
function rawModUiLayerHost({root,renderers,geometry=()=>modStageViewport(root),dock=createModStageDock(root)},register) {
    const mounted=new Map(),doc=root.ownerDocument;
    let latest=null,refreshing=false,disposed=false;
    register(()=>{disposed=true;latest=null;});
    register(()=>dock.dispose());
    register(()=>clean([...mounted.keys()].map(key=>()=>remove(key))));
    const resize=typeof ResizeObserver==='function' ? new ResizeObserver(()=>{if(latest)sync(...latest);}) : null;
    register(()=>resize?.disconnect());
    if(root.parentElement)resize?.observe(root.parentElement);
    // Host UI can appear or expand without a new mod view or stage fact.
    let safeNodes=new Set();
    const observeRegions=()=>{
        if(disposed || closed)return;
        const next=new Set(root.querySelectorAll(MOD_STAGE_SAFE_REGIONS));
        const changed=next.size!==safeNodes.size || [...next].some(node=>!safeNodes.has(node));
        for(const node of safeNodes)if(!next.has(node))resize?.unobserve(node);
        for(const node of next)if(!safeNodes.has(node))resize?.observe(node);
        safeNodes=next;
        if(changed && latest)sync(...latest);
    };
    const mutations=typeof MutationObserver==='function' ? new MutationObserver(observeRegions) : null;
    register(()=>{mutations?.disconnect();safeNodes.clear();});
    mutations?.observe(root,{childList:true,subtree:true});observeRegions();
    function remove(key) {const row=mounted.get(key);if(!row)return;mounted.delete(key);clean([()=>row.view?.dispose?.(),()=>dock.request(key,null),()=>row.node.remove()]);}
    function sync(layers,context,views={}) {
        if(disposed || closed)return;
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
                mounted.set(key,row);
                try{row.view=render({root:node,context,viewport:geometry(),budget:layer.budget,dock:requestDock});}
                catch(error){try{remove(key);}catch(cleanup){throw new AggregateError([error,cleanup],'Mod renderer failed');}throw error;}
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
    register(()=>{disposed=true;latest=null;});
    return {sync};
}


// place the floating item showcase in front of the figures without
// covering a face. Pure geometry in stage CSS px: the item sits on the stage centre line at about 40 % height; it slides
// below the faces and steps down in size until the item (with its bob and the 出示 zoom) and its name fit between the
// faces, the textbox and the top chrome. The name tries above, then below, then beside the item (a group of two only
// above/below). The spotlight dim is returned only when the item lies over a figure, and starts just above the item.
function itemShowcasePlace({width, height, figures = [], blocked = [], boxTop, captions = [], show = false}) {
    const valid = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
    const inflate = (r, n) => ({x: r.x - n, y: r.y - n, width: r.width + n * 2, height: r.height + n * 2});
    const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const unit = Math.min(width, height * 16 / 9) / 100;
    const sMax = Math.max(17 * unit, 72), sMin = Math.max(8 * unit, 40), step = Math.max(0.5 * unit, 2);
    const zoom = show ? 1.14 : 1, bob = unit, gap = 1.6 * unit, edge = Math.max(unit, 4);
    const bottom = (Number.isFinite(boxTop) ? Math.min(boxTop, height) : height) - Math.max(0.8 * unit, 4);
    const heads = figures.filter(f => valid(f?.head)).map(f => f.head);
    const blocks = [...blocked.filter(valid).map(r => inflate(r, Math.max(0.6 * unit, 4))), ...heads.map(r => inflate(r, Math.max(0.8 * unit, 6)))];
    const fits = r => r.x >= edge && r.y >= edge && r.x + r.width <= width - edge && r.y + r.height <= bottom && !blocks.some(b => hit(r, b));
    const count = Math.max(1, captions.length), caps = Array.from({length: count}, (_, i) => captions[i] && captions[i].width > 0 && captions[i].height > 0 ? captions[i] : {width: 0, height: 0});
    const modes = count === 1 ? ['above', 'below', 'right', 'left'] : ['above', 'below'];
    function layout(s, cy, mode) {
        // A card without any image (no entry or genre icon) is its name alone, centred where the item would float.
        const column = i => caps[i].textOnly ? caps[i].width : mode === 'above' || mode === 'below' ? Math.max(s * zoom, caps[i].width) : s * zoom;
        const total = caps.reduce((sum, _, i) => sum + column(i), 0) + gap * (count - 1);
        let x = width / 2 - total / 2;
        const items = [], names = [];
        for (let i = 0; i < count; i++) {
            const cx = x + column(i) / 2, c = caps[i];x += column(i) + gap;
            if (c.textOnly) {items.push({cx, cy, box: {x: cx - c.width / 2, y: cy - c.height / 2, width: c.width, height: c.height}});names.push({x: cx, y: cy, width: 0, height: 0});continue;}
            items.push({cx, cy, box: {x: cx - s * zoom / 2, y: cy - s * zoom / 2 - bob, width: s * zoom, height: s * zoom + bob}});
            const half = s * zoom / 2;
            names.push(mode === 'above' ? {x: cx - c.width / 2, y: cy - half - bob - 0.7 * unit - c.height, width: c.width, height: c.height}
                : mode === 'below' ? {x: cx - c.width / 2, y: cy + half + 0.5 * unit, width: c.width, height: c.height}
                : mode === 'right' ? {x: cx + half + 1.4 * unit, y: cy - c.height / 2, width: c.width, height: c.height}
                : {x: cx - half - 1.4 * unit - c.width, y: cy - c.height / 2, width: c.width, height: c.height});
        }
        return {items, names};
    }
    function result(s, cy, mode, forced) {
        const {items, names} = layout(s, cy, mode);
        const over = items.some(item => figures.some(f => valid(f?.body) && hit(item.box, f.body)));
        let dim = null;
        if (over) {
            const all = [...items.map(item => item.box), ...names.filter(valid)];
            const left = Math.min(...all.map(r => r.x)), right = Math.max(...all.map(r => r.x + r.width));
            const x = (left + right) / 2 - (right - left + s * 1.3) / 2, w = right - left + s * 1.3, low = Math.max(...all.map(r => r.y + r.height));
            // The dim never reaches a face: it stops below every chin above the item and above every face below it.
            const itemTop = Math.min(...items.map(item => item.box.y)) + bob, itemLow = Math.max(...items.map(item => item.box.y + item.box.height));
            const across = heads.filter(r => r.x < x + w && x < r.x + r.width);
            const top = Math.max(itemTop - s * 0.25, ...across.filter(r => r.y + r.height <= itemTop).map(r => r.y + r.height + 1));
            const end = Math.min(low + s * 0.55, bottom, ...across.filter(r => r.y >= itemLow).map(r => r.y - 1));
            dim = {x, y: top, width: w, height: Math.max(0, end - top)};
        }
        return {size: s, caption: mode, items: items.map(({cx, cy}) => ({x: cx, y: cy})), names, dim, forced: !!forced};
    }
    // Slide below the faces first (every size), and only when nothing fits below rise above them.
    const prefer = height * 0.4, down = [], up = [];
    for (let d = 0; d <= height * 0.45; d += step) {down.push(d);if (d) up.push(-d);}
    for (const ladder of [down, up]) for (let s = sMax; s >= sMin - 1e-6; s -= step) for (const dy of ladder) for (const mode of modes) {
        const {items, names} = layout(s, prefer + dy, mode);
        if (items.every(item => fits(item.box)) && names.every(r => r.width === 0 || fits(r))) return result(s, prefer + dy, mode);
    }
    return result(sMin, Math.max(sMin, bottom - sMin * zoom / 2), count === 1 ? 'right' : 'above', true);
}


function coreItemPresentation() {
    const kinds=core;
    return {
        ...kinds.find(row=>row.kind==='core.items.item'),
        media:row=>row.payload?.media ? {image:{coreItem:true}} : {},
        render(React,row,media,{CutinCard}) {
            const value=row.payload;
            return React.createElement(CutinCard,{tone:value.action,
                // 获得 / 失去 tell the player what happened; a plain show needs no word (「展示」 is the director's op name, not news).
                label:{gain:'\u83b7\u5f97',lose:'\u5931\u53bb'}[value.action],
                // An item variant (灵魂宝石 清澈 / 浑浊) reads as the subtitle; the image is that variant's own (or the tag icon).
                title:value.name,subtitle:value.variantName || undefined,iconExpected:!!value.media,amount:value.action==='show' ? undefined : value.count,
                image:media.image ? React.createElement('img',{src:media.image,alt:'',onError:event=>{event.currentTarget.hidden=true;}}) : null});
        },
    };
}

// Application-owned renderers; release archives never contribute executable browser code.

// a page turn revokes the mod's view (the server publishes
// no views until the new page's arrives, and a late previous-page view is filtered out), which used to unmount the
// layer and mount a fresh one — the 直播中 · 观众 chip blinked and the renderer forgot what it had shown. A layer that
// leaves the visible set is held (mounted, no view update) until its mod's next view; only a mod change, the stage
// unmount or a long silence (MOD_LAYER_HOLD_MS) removes it.
const MOD_LAYER_HOLD_MS = 30000;
// a view with a host (view.streamer) and no face set in its settings
// shows the face of the figure its host name — view.streamer.name, else the player's name — resolves to, through the
// phone's card-figure lookup (useCardFaces: every enabled figure of the card's and global packs, on stage or not).
// The player renaming mid-chat re-resolves at once. No figure or no face: the renderer's neutral face.
// The live-room bar draws the face up to 64 CSS px: prepared at 96 it stays sharp on 1.5× screens.
const MOD_HOST_FACE_PX=96;
const modHostName=(view,player)=>String(view?.streamer?.name || '').trim() || (player && player!=='你' ? player : '');
function modHostFace(view,player,faces) {
    if (!view?.streamer || view.streamer.avatar) return view;
    const url=faces.get(modHostName(view,player));
    return url ? {...view,streamer:{...view.streamer,avatar:{src:url}}} : view;
}
function ModStageLayers({sessionId,sourceKey,stage:facts,config}) {
    // the player's display name joins the read-only stage facts (the live room's 粉丝牌 name).
    const session=useLiveView?.(sessionId,'mod-stage-layers'),player=String(session?.view?.playerName||'');
    const stage=React.useMemo(()=>({...facts,player}),[facts.title,facts.turn,facts.latestTurn,facts.scene,facts.bgm,player]);
    const marker=React.useRef(null),host=React.useRef(null),rows=React.useRef([]),current=React.useRef({sourceKey,stage}),held=React.useRef(new Map()),expiry=React.useRef(null);
    // Mods the reader just switched off (dsh-tavern-mod-scope): their layers leave at once, not after the save and reread.
    const presentation=React.useRef(new Map()),refresh=React.useRef(null),switchedOff=React.useRef(new Set());
    current.current={sourceKey,stage};
    const [hostNames,setHostNames]=React.useState(''),hostNamesRef=React.useRef('');
    const faceSource=sessions()?.get(sessionId)?.getSnapshot()?.source || null;
    const hostFaces=typeof useFaces==='function' ? useFaces({config,sessionId,source:faceSource,names:hostNames?hostNames.split('\n'):[],px:MOD_HOST_FACE_PX}) : new Map(),faces=React.useRef(hostFaces);
    faces.current=hostFaces;
    const facesKey=[...hostFaces].map(([name,url])=>name+'\u0000'+url).join('\n');
    const sync=()=>{
        if(closed || !host.current)return;
        const snapshot=sessions()?.get(sessionId)?.getSnapshot(),anchor=snapshot?.cursor?.anchor;
        const source=snapshot?.source,displayToken=source && JSON.stringify([source.sourceKey,source.generation,source.branchId,source.authorityEpoch]);
        const visible=rows.current.filter(row=>!switchedOff.current.has(row.modId) && (row.view?.displayTurn ?? row.context.settledTurn)===current.current.stage.turn &&
            (row.view?.displayToken?row.view.displayToken===displayToken:!current.current.sourceKey || row.context.sourceKey===current.current.sourceKey) &&
            (!anchor || !Number.isInteger(row.view?.anchor?.paragraph) || row.view.anchor.paragraph===anchor.para && row.view.anchor.charOffset===anchor.offset));
        const names=[...new Set(visible.map(row=>modHostName(row.view,current.current.stage.player)).filter(Boolean))].join('\n');
        if (names!==hostNamesRef.current) {hostNamesRef.current=names;setHostNames(names);}
        const now=Date.now(),layers=new Map();
        for(const row of visible){layers.set(row.modId,(row.manifest.uiLayers||[]).map(layer=>({...layer,modId:row.modId})));held.current.set(row.modId,{layers:layers.get(row.modId),at:now});}
        for(const [modId,hold] of held.current) {
            if(layers.has(modId))continue;
            if(switchedOff.current.has(modId)){held.current.delete(modId);continue;}
            if(snapshot?.visible!==false && now-hold.at>=MOD_LAYER_HOLD_MS){held.current.delete(modId);continue;}
            layers.set(modId,hold.layers);
        }
        clearTimeout(expiry.current);expiry.current=null;
        const waiting=[...held.current].filter(([modId])=>!visible.some(row=>row.modId===modId));
        if(waiting.length && snapshot?.visible!==false)expiry.current=setTimeout(sync,Math.max(16,Math.min(...waiting.map(([,hold])=>hold.at+MOD_LAYER_HOLD_MS-now))));
        host.current?.sync([...layers.values()].flat(),
            {sessionId,...visible[0]?.context,stage:current.current.stage},Object.fromEntries(visible.map(row=>{
                const values=presentation.current.get(row.modId);
                if(values && Object.entries(values).every(([key,value])=>row.view.settings?.[key]===value))presentation.current.delete(row.modId);
                const view=modHostFace(row.view,current.current.stage.player,faces.current);
                return [row.modId,values?{...view,...(values.view!==undefined?{view:values.view}:{}),settings:{...view.settings,...values}}:view];
            })));
    };
    useEffect(register=>{
        let live=true,reading=false,dirty=false,version=0;
        const sessionRuntime=runtime;
        const root=marker.current.closest('.fork-gal-stage');
        host.current=createModUiLayerHost({root,renderers});
        const layerHost=host.current;
        register(()=>layerHost.dispose());
        register(()=>{live=false;refresh.current=null;host.current=null;rows.current=[];held.current.clear();clearTimeout(expiry.current);expiry.current=null;});
        // Streaming lines can arrive faster than reads: show each result, then read the latest once.
        const page=()=>JSON.stringify(sessions()?.get(sessionId)?.getSnapshot()?.cursor?.anchor);
        const read=async()=>{
            if(!live || closed)return;dirty=true;if(reading)return;reading=true;
            try {while(live&&dirty){dirty=false;const anchor=page(),own=version;try{const result=await readViews(sessionId);if(live&&own===version&&anchor===page()){rows.current=result.views;sync();}else if(live&&own===version&&anchor!==page())dirty=true;}catch(error){if(live&&own===version&&anchor===page()){rows.current=[];sync();console.warn('Mod display read failed',error);}}}}
            finally{reading=false;}
        };
        const activity=()=>{if(!live)return;sessionRuntime.reannounce(sessionId);void read();};
        refresh.current=read;
        const visibility=()=>{if(!document.hidden)activity();else sync();};
        // A mod switched off or reconfigured: its held layer goes with the next read instead of waiting out the hold.
        const modsChanged=event=>{if(event.detail?.presentationOnly)return;presentation.current.clear();held.current.clear();activity();};
        const preview=event=>{const {modId,values}=event.detail;presentation.current.set(modId,{...presentation.current.get(modId),...values});sync();};
        const scope=event=>{const {modId,enabled}=event.detail;if(enabled)switchedOff.current.delete(modId);else switchedOff.current.add(modId);sync();};
        const changed=signal=>{if(live&&Array.isArray(signal?.snapshot?.views)){version++;rows.current=signal.snapshot.views;sync();}else void read();};
        register(subscribe(sessionId,changed,read,activity));
        const listen=(target,type,handler)=>{register(()=>target.removeEventListener(type,handler));target.addEventListener(type,handler);};
        listen(window,'dsh-tavern-mods-changed',modsChanged);listen(window,'dsh-tavern-mod-presentation',preview);listen(window,'dsh-tavern-mod-scope',scope);
        listen(document,'visibilitychange',visibility);listen(window,'focus',visibility);activity();
    },[sessionId]);
    React.useEffect(()=>{sync();void refresh.current?.();},[sourceKey,stage]);
    React.useEffect(()=>{if (host.current) sync();},[facesKey]);
    return React.createElement('span',{ref:marker,'aria-hidden':true,style:{display:'none'}});
}


// items float in front of the figures, no card. The showcase measures
// the stage (figure head/body boxes from the scene, textbox, top chrome) once per set of cards, places them with
// itemShowcasePlace and hands each card its slot through context. Shared by core and first-party
// mod presentations; no inventory behaviour here. Nothing in it takes pointer input: clicks reach the stage and advance.
let itemPlaceContext=null;
function itemPlaceSlot(){return itemPlaceContext || (itemPlaceContext=React.createContext(null));}
function itemStageGeometry(node) {
    const root=node.closest('.fork-gal-stage') || node.parentElement;if(!root)return null;
    // Stage units: a docked stage is only scaled (createModStageDock).
    const frame=root.getBoundingClientRect(),k=frame.width>0 && Math.abs(frame.width-root.offsetWidth)>=1 ? root.offsetWidth/frame.width : 1,rel=el=>{const r=el.getBoundingClientRect();return {x:(r.left-frame.left)*k,y:(r.top-frame.top)*k,width:r.width*k,height:r.height*k};};
    const blocked=[...root.querySelectorAll('.fork-gal-topbar,.fork-gal-side,.fork-gal-controls,.fork-gal-name,.fork-gal-letterbox i,.fork-widget-source-controls')].map(rel);
    const boxes=[...root.querySelectorAll('.fork-gal-box')].map(rel).filter(r=>r.width>0 && r.height>0);
    const figures=scene()?.rects(root) || [];
    return {width:frame.width*k,height:frame.height*k,scale:k,blocked,boxTop:boxes.length ? Math.min(...boxes.map(r=>r.y)) : undefined,figures};
}
// Reads the decoded icon once: an opaque light border means a baked white background (shown on a paper tile), and a
// 失去 card takes its dust colours from the item's own pixels. Owned blob URLs are same-origin; anything else stays plain.
function itemImageLook(image,dust) {
    try {
        const n=40,canvas=document.createElement('canvas');canvas.width=canvas.height=n;
        const context=canvas.getContext('2d',{willReadFrequently:true}),k=Math.min(n/image.naturalWidth,n/image.naturalHeight);
        const w=image.naturalWidth*k,h=image.naturalHeight*k,ox=(n-w)/2,oy=(n-h)/2;context.drawImage(image,ox,oy,w,h);
        const data=context.getImageData(0,0,n,n).data,at=(x,y)=>(Math.min(n-1,Math.max(0,Math.round(y)))*n+Math.min(n-1,Math.max(0,Math.round(x))))*4;
        let edge=0,light=0;
        for(let t=0;t<n;t++)for(const [x,y] of [[ox+t*w/n,oy],[ox+t*w/n,oy+h-1],[ox,oy+t*h/n],[ox+w-1,oy+t*h/n]]){const i=at(x,y);edge++;if(data[i+3]>=250 && Math.min(data[i],data[i+1],data[i+2])>=226)light++;}
        const tile=light/edge>0.8,specks=[];
        if(dust)for(let t=0;t<600 && specks.length<36;t++){const x=Math.random()*n,y=Math.random()*n,i=at(x,y);if(data[i+3]>200 && !(tile && Math.min(data[i],data[i+1],data[i+2])>=226))specks.push({x:x/n,y:y/n,color:'rgb('+data[i]+' '+data[i+1]+' '+data[i+2]+')',dx:(0.3+Math.random()*0.6).toFixed(3),dy:(-0.1-Math.random()*0.45).toFixed(3),delay:Math.round(950+x/n*900+Math.random()*120)+'ms'});}
        return {tile,dust:specks.length ? specks : null};
    } catch (_) {return {tile:false,dust:null};}
}
function StageCutinCard({tone,label,title,subtitle,amount,image,note,iconExpected}) {
    const h=React.createElement,slot=React.useContext(itemPlaceSlot()),ref=React.useRef(null);
    const place=slot?.place,spot=place?.items?.[slot.index],name=place?.names?.[slot.index],hasIcon=!!image || !!iconExpected;
    const [look,setLook]=React.useState({tile:false,dust:null});
    const sparks=React.useMemo(()=>Array.from({length:10},(_,i)=>{const a=i/10*Math.PI*2+Math.random()*0.4,d=0.5+Math.random()*0.25;
        return {'--fork-item-dx':(Math.cos(a)*d).toFixed(3),'--fork-item-dy':(Math.sin(a)*d*0.8).toFixed(3),'--fork-item-delay':Math.round((tone==='show' ? 900 : 330)+Math.random()*160)+'ms'};}),[tone]);
    useEffect(register=>{ // load does not bubble; a capturing listener also sees images that a child component mounts later
        const root=ref.current;if(!root)return undefined;
        let live=true;const read=img=>{if(live && img?.naturalWidth)setLook(itemImageLook(img,tone==='lose'));};
        const loaded=event=>{if(event.target.matches?.('.fork-item-ic img'))read(event.target);};
        register(()=>{live=false;root.removeEventListener('load',loaded,true);});
        root.addEventListener('load',loaded,true);
        const img=root.querySelector('.fork-item-ic img');if(img?.complete)read(img);
    },[tone]);
    const src=image?.props?.src,count=amount!==undefined && amount!==null ? ' \u00d7'+amount : '';
    return h('div',{ref,className:'fork-item-show fork-item-'+tone+(hasIcon ? '' : ' is-text'),'data-tone':tone,'data-caption':place?.caption || 'above',
        style:spot ? {left:spot.x+'px',top:spot.y+'px','--fork-item-size':place.size+'px'} : undefined},
        hasIcon && h('i',{className:'fork-item-light','aria-hidden':true}),
        hasIcon && tone!=='lose' && h('i',{className:'fork-item-rays','aria-hidden':true}),
        hasIcon && h('div',{className:'fork-item-pic'},
            h('div',{className:'fork-item-bob'},h('div',{className:'fork-item-ic'+(look.tile ? ' is-tile' : '')},image,
                src && !look.tile ? h('i',{className:'fork-item-glint','aria-hidden':true,style:{'--fork-item-mask':'url("'+src+'")'}}) : null)),
            tone==='lose' && look.dust ? look.dust.map((speck,i)=>h('i',{key:i,className:'fork-item-dust','aria-hidden':true,style:{left:speck.x*100+'%',top:speck.y*100+'%','--fork-item-dust':speck.color,
                '--fork-item-dx':speck.dx,'--fork-item-dy':speck.dy,'--fork-item-delay':speck.delay}})) : null),
        hasIcon && tone!=='lose' && h('div',{className:'fork-item-sparks','aria-hidden':true},sparks.map((style,i)=>h('i',{key:i,className:i%3===0 ? 'is-star' : undefined,style}))),
        h('div',{className:'fork-item-cap',style:spot && name && hasIcon ? {left:name.x-spot.x+'px',top:name.y-spot.y+'px'} : undefined},h('strong',null,title),
            // The second line only when it says something: 获得 / 失去, the variant (浑浊), the count.
            label || subtitle || count ? h('small',null,label ? h('b',null,label) : null,label && subtitle ? ' ' : '',subtitle || '',count) : null,
            note && h('small',null,note),slot?.extra && h('small',null,slot.extra)));
}
// a skin that declares art.item draws the card as the
// original's frame at its declared place - no caption, spotlight, zoom or face avoidance - with the same finite lifetime
// (createModStageSurface). Only the newest card shows, in the one frame; gain adds the skin's toast. `item` = stageSkinArt's.
function forkSkinItemLayout(item,width,height) {
    const [cx,cy,w,h]=item.box,u=Math.min(height/item.screen,width/item.width);
    if(item.narrow && width<=640){const k=width*item.narrow.width/w;return {k,frame:{x:width/2-w*k/2,y:height*item.narrow.y-h*k/2,width:w*k,height:h*k}};}
    return {k:u,frame:{x:width/2+(cx-w/2-item.width/2)*u,y:height/2+(cy-h/2-item.screen/2)*u,width:w*u,height:h*u}};
}
function SkinItemShowcase({card,item}) {
    const h=React.createElement,ref=React.useRef(null),[size,setSize]=React.useState(null);
    React.useLayoutEffect(()=>{const g=ref.current && itemStageGeometry(ref.current);if(g)setSize([g.width,g.height]);},[]);
    const props=card.element.props,layout=size && forkSkinItemLayout(item,size[0],size[1]);
    let toast=null;
    if(layout && props.tone==='gain' && item.toast){
        const t=item.toast,[x,y,w,th]=t.box,frame=layout.frame;
        // Narrow: the toast keeps its design proportions and stands on the frame's top edge, from the stage's left.
        const k=item.narrow && size[0]<=640 ? layout.k*.9 : layout.k,box=item.narrow && size[0]<=640 ? {x:0,y:frame.y-th*k-6,width:w*k,height:th*k}
            : {x:size[0]/2+(x-item.width/2)*k,y:size[1]/2+(y-item.screen/2)*k,width:w*k,height:th*k};
        toast=h('div',{className:'fork-skin-item-toast',style:{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px',backgroundImage:'url("'+t.image+'")',
            fontSize:t.font*k+'px',...(t.ink ? {'--fork-skin-item-ink':t.ink} : null),'--fork-skin-item-fade':t.fadeMs+'ms'}},t.text);
    }
    return h('aside',{ref,className:'fork-item-showcase is-skin','aria-live':'polite'},layout && h(React.Fragment,{key:card.key},
        h('div',{className:'fork-skin-item','data-tone':props.tone,'aria-label':props.title,style:{left:layout.frame.x+'px',top:layout.frame.y+'px',width:layout.frame.width+'px',height:layout.frame.height+'px',
            '--fork-skin-item-ms':item.enter.ms+'ms','--fork-skin-item-rise':item.enter.rise*layout.k+'px'}},
            h('img',{className:'fork-skin-item-frame',src:item.frame,alt:''}),
            props.image && h('div',{className:'fork-skin-item-media',style:{width:item.media[0]*layout.k+'px',height:item.media[1]*layout.k+'px'}},props.image)),
        toast));
}
// cards: [{key, element}] where element renders StageCutinCard. First pass renders hidden to measure the names.
function ItemShowcase({cards,extra,accent,skinItem}) {
    if(skinItem)return React.createElement(SkinItemShowcase,{card:cards.at(-1),item:skinItem});
    return React.createElement(ItemCardShowcase,{cards,extra,accent});
}
function ItemCardShowcase({cards,extra,accent}) {
    const h=React.createElement,ref=React.useRef(null),Slot=itemPlaceSlot();
    const signature=cards.map(card=>card.key).join('|')+'|'+(extra || '');
    const [state,setState]=React.useState({signature:null,place:null});
    const place=state.signature===signature ? state.place : null;
    React.useLayoutEffect(()=>{
        if(place || !ref.current)return;
        const node=ref.current,geometry=itemStageGeometry(node),shows=[...node.querySelectorAll('.fork-item-show')];
        const k=geometry?.scale || 1,captions=shows.map(show=>{const r=show.querySelector('.fork-item-cap').getBoundingClientRect();return {width:r.width*k,height:r.height*k,textOnly:show.classList.contains('is-text')};});
        setState({signature,place:itemShowcasePlace({...(geometry || {width:node.clientWidth,height:node.clientHeight}),captions,show:shows.some(show=>show.dataset.tone==='show')})});
    });
    return h('aside',{ref,className:'fork-item-showcase'+(place ? '' : ' is-measuring'),'aria-live':'polite',style:accent ? {'--fork-item-accent':accent} : undefined},
        place?.dim ? h('i',{className:'fork-item-dim','aria-hidden':true,style:{left:place.dim.x+'px',top:place.dim.y+'px',width:place.dim.width+'px',height:place.dim.height+'px'}}) : null,
        cards.map((card,index)=>h(Slot.Provider,{key:card.key,value:{place,index,extra:index===cards.length-1 ? extra : null}},card.element)));
}
function useModPerformances(sessionId,{live,overlay}) {
    const h=React.createElement,[surface,setSurface]=React.useState({rows:[],busy:false,holds:[],regions:[]}),rows=surface.rows;
    const controller=React.useMemo(()=>{
        const pins=new Map();
        return createModStageSurface({definitions:[coreItemPresentation()],
            readMedia:async args=>{
                if(!args.coreItem)return readMedia(sessionId,args);
                const view=await readItems(sessionId,args.turn),row=view.performances?.find(row=>row.id===args.performanceId);
                if(!row?.image || JSON.stringify(row.source)!==JSON.stringify(args.source))throw Error('Item source changed');
                const pin=await sessions().resourceOwner.acquire(row.image,sessionId);
                return {pin};
            },
            createURL:result=>{if(result.pin){const url=result.pin.handle.url;pins.set(url,[...(pins.get(url)||[]),result.pin]);return url;}
                return URL.createObjectURL(new Blob([Uint8Array.from(atob(result.data),character=>character.charCodeAt(0))],{type:result.mime}));},
            revokeURL:url=>{const values=pins.get(url);if(values){values.pop().release();if(!values.length)pins.delete(url);}else URL.revokeObjectURL(url);},onChange:(rows,status)=>setSurface({rows,...status}),
        });
    },[sessionId]);
    // The runtime cancels source/page/revocation changes before playing their events.
    // A later React render of the same accepted direction must not cancel its in-flight item image.
    React.useLayoutEffect(()=>{controller.reset(live && !overlay);return()=>controller.reset(false);},[controller,live,overlay]);
    React.useEffect(()=>()=>controller.dispose(),[controller]);
    // The stage passes the speaker's 形象色 as `accent` (React.cloneElement) once it knows who speaks.
    const visibleRows=live && !overlay ? rows.slice(0,2) : [];
    const node=visibleRows.length ? h(ItemShowcase,{
        cards:visibleRows.map(row=>({key:row.id,element:row.definition.render(React,row.performance,row.media,{CutinCard:StageCutinCard})})),
        extra:rows.length>2 ? '\u53e6\u6709 '+(rows.length-2)+' \u9879\u6f14\u51fa' : null}) : null;
    // Cancelling one page releases its cards; it must not disable later eligible events.
    return {play:controller.play,cancel:()=>controller.reset(live && !overlay),busy:surface.busy,holds:surface.holds,regions:surface.regions,node,visibleRows};
}

return {usePerformances:useModPerformances,Layers:ModStageLayers,createSurface:createModStageSurface,createLayerHost:createModUiLayerHost,dispose(){if(closed)return;closed=true;clean([...owned].reverse());}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageModSurface};
