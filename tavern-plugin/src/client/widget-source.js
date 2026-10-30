// @include widget-source.cjs
// @include widget-presentation.cjs
// @include-mod phone/stage-phone.cjs
// @include widget-thread.cjs
// @include card-faces.js
// @include widget-setting-images.js
// where the reader dragged a widget, per card and per view (open / compact). A browser UI preference only —
// never the chat, the card or the director — kept as fractions of the free stage so a resize always clamps it inside.
// face thumbnails handed to source widgets, per encoded [url,crop,px], page-session wide
// (LRU). A thumbnail made once is there at once on every later render, phone mount and chat return.
const STAGE_WIDGET_THUMBS=160,stageWidgetThumbs=new Map();
const STAGE_WIDGET_PLACE_PAD=8;
const stageWidgetPlaces=(()=>{
    const KEY='fork-widget-places',CARDS=48;let cache=null;
    const load=()=>{
        if (cache) return cache;
        try {const value=JSON.parse(localStorage.getItem(KEY) || 'null');cache=value && typeof value==='object' && !Array.isArray(value) ? value : {};} catch (_) {cache={};}
        return cache;
    };
    const valid=value=>Array.isArray(value) && value.length===2 && value.every(n=>Number.isFinite(n) && n>=0 && n<=1);
    return {
        get(scope,key,view) {const value=load()[scope]?.[key]?.[view];return valid(value) ? value : null;},
        // A null view forgets every view of that widget (reset); the most recently touched cards are kept.
        set(scope,key,view,value) {
            const all=load(),card={...(all[scope] || {})};
            if (view && value) card[key]={...(card[key] || {}),[view]:value}; else delete card[key];
            delete all[scope];if (Object.keys(card).length) all[scope]=card;
            for (const old of Object.keys(all).slice(0,Math.max(0,Object.keys(all).length-CARDS))) delete all[old];
            try {localStorage.setItem(KEY,JSON.stringify(all));} catch (_) {}
        }};
})();
// the last-read place of each phone conversation, per chat branch, in this browser, so unread
// counts survive a refresh or remount (refresh is not a reset). A browser reading mark, never chat or director state.
const phoneModReads=(()=>{
    const KEY='fork-phone-read',CHATS=48;let cache=null;
    const load=()=>{
        if (cache) return cache;
        try {const value=JSON.parse(localStorage.getItem(KEY) || 'null');cache=value && typeof value==='object' && !Array.isArray(value) ? value : {};} catch (_) {cache={};}
        return cache;
    };
    return {
        get(scope) {const value=load()[scope];return value && typeof value==='object' && !Array.isArray(value) ? value : {};},
        set(scope,marks) {
            const all=load();delete all[scope];all[scope]=marks;
            for (const old of Object.keys(all).slice(0,Math.max(0,Object.keys(all).length-CHATS))) delete all[old];
            try {localStorage.setItem(KEY,JSON.stringify(all));} catch (_) {}
        }};
})();
function stageWidgetPlaceFraction(viewport,size,point) {
    const free=[viewport.width-size.width,viewport.height-size.height].map(n=>n-2*STAGE_WIDGET_PLACE_PAD);
    return [point.x-viewport.x,point.y-viewport.y].map((n,i)=>free[i]>0 ? Math.min(1,Math.max(0,(n-STAGE_WIDGET_PLACE_PAD)/free[i])) : .5);
}
function stageWidgetPlacePoint(viewport,size,fraction) {
    return {x:viewport.x+STAGE_WIDGET_PLACE_PAD+Math.max(0,viewport.width-size.width-2*STAGE_WIDGET_PLACE_PAD)*fraction[0],
        y:viewport.y+STAGE_WIDGET_PLACE_PAD+Math.max(0,viewport.height-size.height-2*STAGE_WIDGET_PLACE_PAD)*fraction[1]};
}
// the phone is centred in the band between the top bar and the dialogue box and fills its
// height with minimal margins, never over the box (stage units),
// keeping its proportions; the
// incoming banner is exactly as wide as that phone's screen. The view zooms to match and is told the dialogue box's body
// size, so its message text reads at least as large as the box's at every window size.
const PHONE_KEY=JSON.stringify(['dsh.phone','source']),PHONE_BANNER_MS=3500,PHONE_GAP=4,PHONE_MIN_WIDTH=160;
const PHONE_BEZEL=15,PHONE_SCREEN=265,PHONE_BANNER_HEIGHT=78,PHONE_MAX_ZOOM=3;
// on a stage this narrow the open phone is the
// full-bleed sheet - the reader's own phone is the device - and the dialogue box stays hidden under it until it is put away.
// Wider stages keep the PC rule: the phone never covers the dialogue box.
// only a real phone - a touch screen (coarse pointer) AND this narrow, never a narrow desktop
// window - holds the phone mod as the device itself: the full-bleed sheet with no frame or Dynamic Island and without our status
// bar (the device shows its own); our home bar stays, lifted clear of the system's gesture zone by the safe-area insets
// (presentation.device). A desktop keeps the framed phone at any window size.
const PHONE_FULL_WIDTH=640;
const phoneModHandheld=viewport=>viewport.width<=PHONE_FULL_WIDTH && matchMedia('(pointer: coarse)').matches;
// The device's safe-area insets (CSS px) that still reach into the stage: the page around it (the play shell) may already stand
// clear of the status bar or the gesture zone, so only the overlap is the sheet's to keep free - never a second band (owner
// 2026-10-27 「灵动岛那一片儿…纯纯空白浪费空间」). A sandboxed frame reads none of its own.
let safeAreaProbe=null;
function safeAreaInsets(root) {
    if (!safeAreaProbe) {
        safeAreaProbe=document.createElement('div');
        safeAreaProbe.setAttribute('aria-hidden','true');
        safeAreaProbe.style.cssText='position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)';
        document.body.append(safeAreaProbe);
    }
    const style=getComputedStyle(safeAreaProbe),frame=root.getBoundingClientRect();
    return {top:Math.round(Math.max(0,(parseFloat(style.paddingTop) || 0)-Math.max(0,frame.top))),bottom:Math.round(Math.max(0,(parseFloat(style.paddingBottom) || 0)-Math.max(0,innerHeight-frame.bottom)))};
}
const phoneModStageScale=viewport=>Math.min(1.5,Math.max(.85,viewport.height/1080));
// the band is measured against the dialogue box as the skin
// draws it at its tallest, never against this page. A skin whose box height follows its lines (art.textbox.height fit lines:
// data-fit-lines and --art-fit-block on the box, --art-fit-max on the stage) is read at its max lines — the box and what rides
// its top edge (name tab, portrait, frame) lifted by the lines this page leaves out — and the band is held while that height
// eases. What a page adds or takes away (a narration page without the name tab, a hidden box, the name tab's entrance
// motion) never widens the band again: within one layout (viewport, letterbox, skin, text size: geometry.layoutKey) the
// band only narrows (memory), so the phone keeps one size while the story turns pages; a viewport or skin change starts
// afresh. The input page's label (13px over the box) is not part of the box.
function stageWidgetFitRise(box) {
    const count=parseInt(box.dataset.fitLines,10),block=parseFloat(box.style.getPropertyValue('--art-fit-block')),max=parseInt(getComputedStyle(box).getPropertyValue('--art-fit-max'),10);
    return count>0 && block>0 && max>count ? block/count*(max-count) : 0;
}
// The centred reading sheet's size: the declared open box within the stage, kept to its aspect ratio.
function stageWidgetSheetSize(viewport,box) {
    let width=Math.max(box.minWidth,Math.min(box.width,viewport.width-16)),height=Math.max(box.minHeight,Math.min(box.height,viewport.height-72));
    if (box.aspectRatio) {width=Math.max(box.minWidth,box.minHeight*box.aspectRatio,Math.min(width,height*box.aspectRatio));height=width/box.aspectRatio;}
    return {width,height};
}
function phoneModStageSize(geometry,box,memory) {
    const v=geometry.viewport,band=geometry.band || {top:v.y,bottom:v.y+v.height},ratio=box.aspectRatio || box.width/box.height;
    // Minimal margins: the free band is the phone. Its top is the bottom of the
    // top chrome actually drawn above the phone's column (a top bar whose controls sit in the corners reserves nothing), its
    // bottom the top of the dialogue box as the active skin draws it (name tab, frame) in that column; the letterbox bounds both.
    const gap=Math.max(PHONE_GAP,v.height*.004),stageTop=Math.max(v.y,band.top),stageBottom=Math.min(v.y+v.height,band.bottom);
    let top=stageTop+gap,bottom=stageBottom-gap,height=0,width=0,x=0;
    for (let pass=0;pass<4;pass++) {
        height=bottom-top;width=height*ratio;
        if (width>v.width-24) {width=v.width-24;height=width/ratio;}
        x=v.x+(v.width-width)/2;
        const over=r=>r.x<x+width+gap && r.x+r.width>x-gap;
        const nextTop=Math.max(top,Math.max(stageTop,...(geometry.chrome || []).filter(over).map(r=>r.y+r.height))+gap);
        const nextBottom=Math.min(bottom,Math.min(stageBottom,...(geometry.floor || []).filter(over).map(r=>r.y))-gap);
        if (nextTop===top && nextBottom===bottom) break;
        top=nextTop;bottom=nextBottom;
    }
    if (memory && memory.key===geometry.layoutKey) {top=Math.max(top,memory.top);bottom=Math.min(bottom,memory.bottom);}
    height=bottom-top;width=height*ratio;
    if (width>v.width-24) {width=v.width-24;height=width/ratio;}
    x=v.x+(v.width-width)/2;
    if (!(width>=PHONE_MIN_WIDTH) || !(height>0)) return null;
    if (memory) Object.assign(memory,{key:geometry.layoutKey,top,bottom});
    return {x,y:top+(bottom-top-height)/2,width,height,zoom:Math.min(PHONE_MAX_ZOOM,Math.max(.7,width/box.width))};
}
// The stage as the widgets see it (stage units), from the DOM: the viewport, the letterbox band, the top chrome and the dialogue
// box's floor (see phoneModStageSize), the figures, and the box text's reading size. previous: the last geometry, whose floor is
// kept while the box's height eases.
function stageWidgetStageGeometry(root,previous) {
    const frame=root.getBoundingClientRect(),rect=node=>{const r=node.getBoundingClientRect();return {x:r.left-frame.left,y:r.top-frame.top,width:r.width,height:r.height};};
    const blocked=[],caption=[],band={top:0,bottom:frame.height};
    for (const node of root.querySelectorAll('.fork-gal-topbar,.fork-gal-letterbox i,.fork-gal-box,.fork-gal-side,.fork-gal-controls')) {
        const r=rect(node);if (!r.width || !r.height) continue;
        if (node.matches('.fork-gal-box')) caption.push(r);else blocked.push(r);
        // The free reading band: inside the letterbox; the top chrome and the dialogue box are measured piece by piece below.
        if (node.matches('.fork-gal-letterbox i') && r.y+r.height/2<frame.height/2) band.top=Math.max(band.top,r.y+r.height);
        else if (node.matches('.fork-gal-letterbox i')) band.bottom=Math.min(band.bottom,r.y);
    }
    // what is actually drawn, so a skin without a top bar, or one whose controls sit in the
    // corners, gives the phone the whole height: the top bar's visible pieces, and the dialogue box with its visible parts
    // (a name tab or frame that rises above the box).
    const shown=node=>{const style=getComputedStyle(node);return style.visibility!=='hidden' && style.display!=='none' && Number(style.opacity)>.05;};
    const chrome=[],floor=[];
    for (const node of root.querySelectorAll('.fork-gal-topbar > *')) {const r=rect(node);if (r.width && r.height && r.y+r.height/2<frame.height/2 && shown(node)) chrome.push(r);}
    for (const node of root.querySelectorAll('.fork-gal-box:not(.is-hidden), .fork-gal-box:not(.is-hidden) > :not(.fork-gal-transition-label), .fork-gal-box:not(.is-hidden) :is(.fork-gal-name,.fork-skin-frame)')) {const r=rect(node);if (r.width && r.height && r.y+r.height/2>frame.height/2 && shown(node)) floor.push(r);}
    // The box at its max lines (stageWidgetFitRise), and held while its height eases to this page's lines.
    const box=root.querySelector('.fork-gal-box:not(.is-hidden)'),rise=box && box.hasAttribute('data-fit-lines') ? stageWidgetFitRise(box) : 0;
    const easing=Boolean(box && typeof box.getAnimations==='function' && box.getAnimations({subtree:true}).some(animation=>animation.transitionProperty==='height' || animation.transitionProperty==='bottom'));
    const visual=window.visualViewport,x=Math.max(0,(visual?.offsetLeft || 0)-frame.left),y=Math.max(0,(visual?.offsetTop || 0)-frame.top);
    const width=Math.max(0,Math.min(frame.width,(visual?.offsetLeft || 0)+(visual?.width || innerWidth)-frame.left)),height=Math.max(0,Math.min(frame.height,(visual?.offsetTop || 0)+(visual?.height || innerHeight)-frame.top));
    if (x) blocked.push({x:0,y:0,width:x,height});if (y) blocked.push({x:0,y:0,width,height:y});
    blocked.push({x:0,y:height-64,width,height:64});
    const figures=typeof galFigureSources!=='undefined' ? galFigureSources.get(root)?.() || [] : [];
    // Stage units: a docked stage is only scaled (createModStageDock); rounded so its move settles at once.
    const k=frame.width>0 && Math.abs(frame.width-root.offsetWidth)>=1 ? root.offsetWidth/frame.width : 1,u=v=>k===1 ? v : Math.round(v*k*100)/100;
    const local=r=>({x:u(r.x),y:u(r.y),width:u(r.width),height:u(r.height)});
    // The dialogue box's body size (computed style: already in stage units), which the phone's message text matches.
    const text=root.querySelector('.fork-gal-box .fork-gal-text'),reading=text ? Math.round(parseFloat(getComputedStyle(text).fontSize)*10)/10 : 0;
    // The layout the box is placed by: theme, skin marks, a skin's narration layout (screen / band), film.
    const marks=Object.entries(root.dataset).filter(([name])=>name==='theme' || name==='narrationLayout' || name.startsWith('fkSkin')).sort();
    const next={width:u(width),height:u(height),viewport:local({x,y,width:Math.max(0,width-x),height:Math.max(0,height-y)}),blocked:blocked.map(local),caption:caption.map(local),figures,band:{top:u(band.top),bottom:u(band.bottom)},chrome:chrome.map(local),
        floor:easing && previous ? previous.floor : floor.map(r=>{const l=local(r);return rise ? {...l,y:l.y-rise} : l;}),reading:reading>0 ? reading : null};
    next.layoutKey=JSON.stringify([next.width,next.height,next.viewport,next.band,next.reading,marks,root.classList.contains('is-film')]);
    return next;
}
// One stage owner measures and allocates all state/source/performance instances.
const NO_PHONE_CALL=Object.freeze({subscribe:()=>()=>{},get:()=>null,command:()=>{}});
function useWidgetStage(props) {
    const local=React.useRef({state:null,refs:new Map()}), context=props.context || (typeof stageSessions!=='undefined' && stageSessions.owner?.getWidgetContext(props.sessionId)) || local.current;
    context.transcripts ||= new Set();
    const [,redraw]=React.useState(0), [geometry,setGeometry]=React.useState(null), [ready,setReady]=React.useState({}), [failed,setFailed]=React.useState({});
    // The phone's band in this layout (phoneModStageSize memory) and the last measured geometry (held while the box eases).
    const phoneBand=React.useRef({key:'',top:0,bottom:0}),measured=React.useRef(null);
    // the reader's phone size and place on this device, and whether it may be dragged.
    const phonePrefs=React.useSyncExternalStore(typeof phoneModPrefs!=='undefined' ? phoneModPrefs.subscribe : ()=>()=>{},typeof phoneModPrefs!=='undefined' ? phoneModPrefs.get : ()=>null,typeof phoneModPrefs!=='undefined' ? phoneModPrefs.get : ()=>null);
    const [visible,setVisible]=React.useState({key:'',text:''}), [grants,setGrants]=React.useState({key:'',items:[]}), [history,setHistory]=React.useState(null), [sheet,setSheet]=React.useState(null);
    // the conversation directory (every contact and group) and
    // the reader's own choices in the phone: which phone (「谁的手机」) and, per phone, which conversation. The phone only reads
    // history; it never sends. `phoneFollow` is the phone the latest phone line took the reader to, kept through its run.
    const [phoneDirectory,setPhoneDirectory]=React.useState(null),[phoneView,setPhoneView]=React.useState({choice:null,threads:{}}),phoneFollow=React.useRef(null);
    // How many messages of each conversation the phone has scrolled back to (80 more per request, per chat branch).
    const [phoneLimits,setPhoneLimits]=React.useState({scope:'',values:{}});
    // the call lives in the page (the sandboxed phone has no
    // microphone); the phone draws its screen from this state and asks for start / mute / end.
    const calls=props.phoneCall || NO_PHONE_CALL,phoneCall=React.useSyncExternalStore(calls.subscribe,calls.get);
    React.useEffect(()=>{if (props.sessionId) calls.command({sessionId:props.sessionId,action:'threads'});},[calls,props.sessionId]);
    // How many earlier turns the stage reads for the phone (20 more each time its conversation scrolls past the loaded ones).
    const [historyDepth,setHistoryDepth]=React.useState({scope:'',value:19});
    const readScope=JSON.stringify([props.sessionId,props.source?.branchId || '']);
    const [phoneReads,setPhoneReads]=React.useState(()=>({scope:readScope,marks:phoneModReads.get(readScope)}));
    const reads=phoneReads.scope===readScope ? phoneReads.marks : phoneModReads.get(readScope);
    const markRead=(updates)=>{
        const next={...reads};let changed=false;
        for (const [id,order] of Object.entries(updates)) if (Array.isArray(order) && JSON.stringify(next[id])!==JSON.stringify(order)) {next[id]=order;changed=true;}
        if (!changed) return;
        while (Object.keys(next).length>128) delete next[Object.keys(next)[0]];
        phoneModReads.set(readScope,next);setPhoneReads({scope:readScope,marks:next});
    };
    const [foreground,setForeground]=React.useState(!document.hidden);
    const motionQuery=React.useMemo(()=>matchMedia('(prefers-reduced-motion: reduce)'),[]);
    React.useEffect(()=>{const change=()=>redraw(n=>n+1);motionQuery.addEventListener?.('change',change);return()=>motionQuery.removeEventListener?.('change',change);},[motionQuery]);
    const audioEvents=React.useRef(new Map());
    const lastPositions=React.useRef(new Map()), previousInput=React.useRef(''), focusReturn=React.useRef(null), enabledBefore=React.useRef(props.enabled);
    React.useEffect(()=>{const wake=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',wake);return()=>document.removeEventListener('visibilitychange',wake);},[]);
    const paused=props.paused || !foreground, cursor={turn:props.turn,page:props.page,para:props.pages[props.page]?.para || 0,generation:JSON.stringify([props.sessionId,props.source?.authorityEpoch,props.source?.branchId,props.source?.generation])};
    // the phone stays in hand across a mixed run of narration and phone lines.
    const phoneRun=props.enabled && props.record?.token?.bindingKey && typeof phoneModRun==='function' ? phoneModRun(props.record,cursor.para) : null;
    if (phoneRun) cursor.holdRef=PHONE_KEY;else phoneFollow.current=null;
    // The calls the phone's conversations show at this page (a call made later in the story is not there yet).
    const shownCall=React.useMemo(()=>typeof phoneModCallsAt==='function' ? phoneModCallsAt(phoneCall,cursor.turn,cursor.para) : phoneCall,[phoneCall,cursor.turn,cursor.para]);
    const phoneClosed=React.useRef(null);
    const readingKey=JSON.stringify([props.sessionId,props.source,props.turn,props.page,props.card]);
    const text=visible.key===readingKey ? visible.text : '';
    const currentRow={turn:props.turn,sourceKey:props.record?.binding?.stream?.operationId || props.record?.token?.sourceKey,record:props.record,pages:props.pages};
    const scope=JSON.stringify([props.sessionId,props.source?.authorityEpoch,props.source?.branchId,props.source?.generation]), held=React.useRef({scope,items:new Map()});
    const phoneDepth=historyDepth.scope===scope ? historyDepth.value : 19,historyKeyOf=(key,phone)=>JSON.stringify([scope,props.source,key,phone ? phoneDepth : 19]);
    if (held.current.scope!==scope || !props.enabled) held.current={scope,items:new Map()};
    const currentRefs=new Set((props.record?.token?.bindingKey && ['partial','done'].includes(props.record.phase) ? props.record.entries : []).filter(entry=>entry.at<=Math.min(cursor.para,props.record.through)).flatMap(entry=>entry.ops.filter(op=>op.op==='widget.source').map(op=>stageWidgetRefKey(op.ref))));
    // a first-party mod source (the phone) is a
    // built-in capability. Projected means globally on for this card, so it is in hand from the first page, before any
    // phone line; marks only add messages and attention, they no longer admit the device.
    const available=(props.enabled ? props.widgets : []).filter(item=>item.definition?.document?.presentation && (item.modSource || item.ref?.kind==='widgets' && (!item.sourceOnly || currentRefs.has(stageWidgetRefKey(item.ref)))));
    for (const widget of available) if (widget.sourceOnly) {const key=stageWidgetRefKey(widget.ref);context.refs.set(key,widget.ref);held.current.items.set(key,widget);}
    while (context.refs.size>64) context.refs.delete(context.refs.keys().next().value);
    for (const key of held.current.items.keys()) if (!context.refs.has(key)) held.current.items.delete(key);
    const known=[...context.refs.values()];
    const grantKey=JSON.stringify([scope,props.source,props.record?.token,props.record?.assetRevision,props.assetRevision,cursor.para,props.enabled,known,history?.key]);
    React.useEffect(()=>{
        let live=true;
        const missing=known.filter(ref=>!available.some(item=>stageWidgetRefKey(item.ref)===stageWidgetRefKey(ref)) || history?.scope===scope && history.rows.some(row=>row.turn<props.turn));
        if (!props.enabled || !props.record?.token || !missing.length) return;
        (async()=>{
            const items=[];
            for (const ref of missing) {
                const result=await (props.readWindow || ((args)=>rpc(ref.modId==='dsh.phone'?'getStagePhonePresentation':'getAssetPackPresentation',args,props.sessionId)))({sessionId:props.sessionId,turn:props.turn,at:cursor.para,expectedDirectionToken:props.record.token,...(ref.modId?{}:{widgetWindow:{ref}})}).catch(()=>null);
                if (!live) return;
                if (result?.status==='ready') items.push(...result.widgets);
            }
            if (live) {
                for (const ref of missing) held.current.items.delete(stageWidgetRefKey(ref));
                for (const widget of items) held.current.items.set(stageWidgetRefKey(widget.ref),widget);
                setGrants({key:grantKey,scope,items});
            }
        })();
        return()=>{live=false;};
    },[grantKey]);
    const byRef=new Map();
    // Keep only the mounted descriptor while checking a new window; it cannot authorize actions, claims or media.
    const checked=grants.scope===scope && grants.key===grantKey;
    const historical=props.enabled ? (checked ? grants.items : [...held.current.items.values()].map(item=>({...item,checking:true}))) : [];
    for (const widget of [...available,...historical]) {if (!byRef.has(stageWidgetRefKey(widget.ref))) byRef.set(stageWidgetRefKey(widget.ref),{...widget,historyAvatars:checked?grants.items.find(item=>stageWidgetRefKey(item.ref)===stageWidgetRefKey(widget.ref))?.historyAvatars:{}});}
    const rows=[...(history?.scope===scope ? history.rows.filter(row=>row.turn<props.turn) : []),currentRow];
    const hasPhone=[...byRef.values()].some(value=>value.ref?.modId==='dsh.phone' && value.sourceOnly);
    const directoryKey=JSON.stringify([scope,props.turn,props.record?.phase,hasPhone]);
    React.useEffect(()=>{
        if (!hasPhone || !props.sessionId) return;
        let live=true;
        // The thread directory is read when the phone is used, not by the entry page: it waits for the entry's connections.
        (typeof galEntryShown==='undefined' ? Promise.resolve() : galEntryShown.settled()).then(()=>live ? (props.phoneThreadsRpc || (args=>rpc('getStagePhoneThreads',args,props.sessionId)))({sessionId:props.sessionId}) : null).then(value=>{if (live) setPhoneDirectory(value?.enabled ? {scope,value} : null);},()=>{});
        return()=>{live=false;};
    },[directoryKey]);
    const directory=phoneDirectory?.scope===scope ? phoneDirectory.value : null;
    const items=[...byRef].slice(0,64).map(([key,value])=>{
        const phone=value.ref?.modId==='dsh.phone';
        const source=value.sourceOnly ? stageWidgetThread({rows,ref:value.ref,cursor,characters:props.config?.characters,visibleText:text,revealed:props.revealed,limited:history?.limited,unavailable:history?.unavailable,
            ...(phone ? {phoneView:{...phoneView,follow:phoneFollow.current},directory,reads,limits:phoneLimits.scope===readScope ? phoneLimits.values : null} : {})}) : null;
        if (phone && source?.current && source.livePhoneId) phoneFollow.current=source.livePhoneId;
        // The player's phone contacts in the directory's (manifest) order, for the phone's 电话 app.
        // Every contact is listed: the phone's 通讯录 has no cap (the prompt's contacts are not read from here).
        if (phone && source && directory) source.contacts=directory.contacts.map(({id,name})=>({id,name}));
        if (source && context.state?.entries.get(key)?.requestedState==='open' && history?.key!==historyKeyOf(key,phone)) source.historyStatus='loading';
        const voiceHandles=new Map();
        if (source) source.messages=source.messages.map(row=>{
            const line=(row.turn===props.turn ? props.pages : rows.find(value=>value.turn===row.turn)?.pages)?.find(line=>line.para===row.para);
            const voice=(!value.modSource || row.form==='voice') && row.revealed
                ? row.turn===props.turn ? line?.voice : value.modSource && row.form==='voice' && line ? props.historyVoice?.(line) : null
                : null;
            const handle=voice ? 'voice:'+row.turn+':'+row.para : null;
            if (handle) voiceHandles.set(handle,()=>{props.onPause?.();voice.click?.();});
            return {...row,...(handle?{voice:handle}:{}),...(value.modSource?{transcript:context.transcripts.has(row.id)}:{})};
        });
        const mark=props.record?.entries?.find(entry=>entry.at===cursor.para)?.ops.map(op=>sourceMark(op,value.ref)).find(Boolean);
        const token=mark ? JSON.stringify([currentRow.sourceKey,props.record.token.generation,props.turn,cursor.para]) : value.eventToken;
        // phone.view {threadId|null, phoneId?}: a phone id switches phones (null: back to the reader's own phone, every choice
        // dropped, as when the phone is put away); without one the thread choice is for the phone on screen.
        const phoneHandlers=phone && source ? {onPhoneView:(threadId,phoneId)=>{
                const after=source.current?.id || null;
                setPhoneView(old=>{
                    if (phoneId===null) return {choice:null,threads:{}};
                    const target=typeof phoneId==='string' ? phoneId : source.phoneId,threads={...old.threads};
                    if (threadId) threads[target]={id:threadId,after};else delete threads[target];
                    return {choice:typeof phoneId==='string' ? {id:phoneId,after} : old.choice,threads};
                });
            },
            onPhoneEarlier:()=>{
                const id=source.threadId;if (!id || !source.hasEarlier) return;
                if (source.windowed) setPhoneLimits(old=>{const values=old.scope===readScope ? old.values : {};return {scope:readScope,values:{...values,[id]:(values[id] || 80)+80}};});
                else setHistoryDepth(old=>({scope,value:(old.scope===scope ? old.value : 19)+20}));
            },
            // The conversation on the open phone's screen is read up to its latest message.
            onPhoneRead:(threadId,phoneId)=>{if (phoneId && phoneId!==source.phoneId) return;const row=source.threads?.find(thread=>thread.id===threadId);if (row?.latest) markRead({[phoneModReadKey(source.phoneId || PHONE_PLAYER,threadId)]:row.latest});}} : {};
        // the phone's own Settings app reads and saves its settings through
        // the stage's adapter (phone-settings.js) — 保存到本卡 / 保存为全局, ↺ clears this card's value.
        const settingsBridge=phone && props.phoneSettings ? {phoneConfig:props.phoneSettings.view,onPhoneSettings:props.phoneSettings.request} : {};
        if (phone && props.phoneCall) {settingsBridge.phoneCall=shownCall;settingsBridge.onPhoneCall=data=>{
            // FaceTime's shutter: the frame the player sees goes into this phone's 照片 (本卡), through the one Photos write.
            if (data.action==='snapshot') {if (props.phoneSettings && calls.snapshot) void phoneModTakePhoto(()=>calls.snapshot(),props.phoneSettings.request,{chatId:props.chatId,branchId:props.source?.branchId || 'main',turn:cursor.turn,...(cursor.para>0?{para:cursor.para}:{})}).catch(error=>console.warn('[phone] FaceTime snapshot',error));return;}
            calls.command({...data,sessionId:props.sessionId,at:{turn:cursor.turn,para:cursor.para},name:source?.threads?.flatMap(thread=>thread.participants).find(person=>person.id===data.contactId)?.name});};
            settingsBridge.onPhoneVideo=(video,frame)=>calls.layout?.(video ? {...video,frame} : null);}
        return {...value,key,source,voiceHandles,...phoneHandlers,...settingsBridge,onTranscript:id=>{if(!source?.messages.some(row=>row.id===id && row.form==='voice'))return;if(context.transcripts.has(id))context.transcripts.delete(id);else context.transcripts.add(id);redraw(n=>n+1);},event:token ? {token,para:mark?cursor.para:value.eventAt,side:mark?.side} : null,
            identity:props.sessionId+':'+(props.source?.authorityEpoch || 0)+':'+(props.source?.branchId || '')+':'+key+':'+value.definition.contentIdentity,notifications:value.definition.document.presentation.notifications,
            fingerprint:JSON.stringify(value.state),performance:Boolean(value.performance)};
    });
    const avatarInputs=[...new Map(items.flatMap(item=>item.source?.messages.map(row=>{
        const id=row.turn+':'+row.para, avatar=item.historyAvatars?.[id];
        const line=row.turn===props.turn ? props.pages.find(line=>line.para===row.para) : null;
        const character=line && bubbleCharacter(props.config,line);
        const mood=character && bubbleMood(line.mood,bubbleMoodList(props.config,character.alias))?.id;
        return [id,[id,character?{alias:character.alias,mood}:null,avatar]];
    }).concat([...(item.source?.threads || []).flatMap(thread=>thread.participants),...(item.source?.phones || []),...(item.source?.contacts || [])].flatMap(person=>{
        // Every listed person's face, and each phone owner's, the player's own included (their persona figure): it is the
        // face on the phone's Settings account card.
        const alias=person.id==='$player' ? directory?.playerId : person.id;
        return alias ? [['p:'+person.id,['p:'+person.id,{alias},null]]] : [];
    })) || [])).values()];
    // a listed person's face is their card figure's own face — the identity
    // resolver's avatar of the card character (config.characters[].avatarMedia.default, the face the transcript shows),
    // prepared in the session avatar cache whether or not the figure is on stage. The stage only hands over the faces of
    // its visible cast and speaker until it is idle (stage-resource-runner visibleAvatars), so a contact who is not on
    // stage used to stay an initial while reading. The stage portrait remains the fallback for a person without a card face.
    // A contact id is a stage actor key (the mark's canonical contact); a carried key (chat copy, pack merge) is not its card
    // character's alias, so it names that character through the roster's figure ref (stageActorCharacter, the one
    // resolver the speaker tint uses; 2026-10-21: a three-glyph name showed as its initial).
    const actorFigures=React.useMemo(()=>Object.entries(props.actors || {}).flatMap(([alias,actor])=>actor?.figure?.figureId ? [{alias,ref:actor.figure}] : []),[props.actors]);
    const cardAlias=alias=>(typeof stageActorCharacter==='function' ? stageActorCharacter(props.config,actorFigures,alias)?.alias : null) || alias;
    const personAliases=[...new Set(avatarInputs.flatMap(([id,current])=>id.startsWith('p:') && current ? [cardAlias(current.alias)] : []))];
    // every face is drawn at the size the phone shows it
    // (stageWidgetFacePx: the phone's widest width so far on this stage x the screen's pixel ratio), and the card face is asked
    // of the session avatar cache at that size, so her 512 px library face reaches the 200 pt card and the 132 pt call
    // screen sharp instead of as a 64 px thumbnail scaled up four to six times.
    const phoneOpenWidth=items.find(item=>item.ref.modId==='dsh.phone')?.definition.document.presentation.open.width;
    const [phoneFaceWidth,setPhoneFaceWidth]=React.useState(0),dpr=window.devicePixelRatio || 1;
    const facePx=phoneOpenWidth ? stageWidgetFacePx(Math.max(phoneOpenWidth,phoneFaceWidth),dpr) : {person:64,message:64};
    const cardUrls=useCardFaces({config:props.config,sessionId:props.sessionId,source:props.source,names:personAliases,px:facePx.person/dpr});
    const avatarInputsResolved=avatarInputs.map(([id,current,history])=>{
        const card=id.startsWith('p:') && current ? cardUrls.get(cardAlias(current.alias)) : null;
        if (card) return [id,JSON.stringify([card,null,facePx.person]),'person'];
        const face=current?props.avatarOf?.(current.alias,current.mood):history;const url=current?face?.src:face?.url;
        const kind=id.startsWith('p:')?'person':'message';
        return [id,url?JSON.stringify([url,face?.crop || null,facePx[kind]]):null,kind];
    });
    // Independent image budget (stageWidgetAvatarBudget): every listed person's face, then a few mood variants (lossy
    // WebP at the shown size); missing decoration never delays reading. Thumbnails are kept per image (stageWidgetThumbs),
    // so a new message, page or history read never drops the faces already shown while the new set is prepared.
    const avatarBudget=stageWidgetAvatarBudget(avatarInputsResolved);
    const avatarKey=JSON.stringify(avatarBudget.urls);
    const [,thumbsLoaded]=React.useState(0),[avatarsFailed,setAvatarsFailed]=React.useState({key:'',urls:[]});
    React.useEffect(()=>{
        let live=true;const urls=avatarBudget.urls.filter(url=>!stageWidgetThumbs.has(url));
        if (!urls.length) return;
        const load=encoded=>new Promise(resolve=>{
            const [url,crop,px]=JSON.parse(encoded);
            const image=new Image();image.onerror=()=>resolve(null);
            image.onload=()=>{try {
                const canvas=document.createElement('canvas');canvas.width=canvas.height=px;
                const c=stageWidgetAvatarSquare(image.naturalWidth,image.naturalHeight,crop || undefined),context2d=canvas.getContext('2d');
                // Cover the square thumbnail before transfer; CSS cannot undo a stretched canvas.
                context2d.imageSmoothingQuality='high';context2d.drawImage(image,c.x,c.y,c.width,c.height,0,0,px,px);
                resolve(canvas.toDataURL('image/webp',.9));
            } catch {resolve(null);}};
            image.src=url;
        });
        Promise.all(urls.map(load)).then(values=>{
            // A failed image is not remembered: the next set (or a later pack refresh) tries it again.
            values.forEach((value,i)=>{if (value) stageWidgetThumbs.set(urls[i],value);});
            while (stageWidgetThumbs.size>STAGE_WIDGET_THUMBS) stageWidgetThumbs.delete(stageWidgetThumbs.keys().next().value);
            // Even a superseded set repaints: the newer set may already be waiting for these very thumbnails.
            thumbsLoaded(n=>n+1);if (live) setAvatarsFailed({key:avatarKey,urls:urls.filter((url,i)=>!values[i])});
        });
        return()=>{live=false;};
    },[avatarKey]);
    const failedUrls=new Set(avatarsFailed.key===avatarKey ? avatarsFailed.urls : []);
    // A person whose face is known but still being prepared shows a quiet placeholder (no initial), and the face
    // arrives in place; an initial is only for a person without any face.
    // A person's face already shown stays while a sharper one of the same person is prepared (a wider phone, the card face
    // arriving at the phone's size).
    const shownFaces=React.useRef(new Map()).current;
    const pendingPerson=new Set(avatarInputsResolved.filter(([id,url])=>id.startsWith('p:') && url && !stageWidgetThumbs.has(url) && !failedUrls.has(url)).map(([id])=>id));
    for (const item of items) if (item.source) {
        item.source.avatars={};
        const face=(id,row)=>{
            const key=avatarBudget.rows[id];let value=key && stageWidgetThumbs.get(avatarBudget.urls[Number(key.slice(1))]);
            if (value && id.startsWith('p:')) shownFaces.set(id,value);
            else if (key && pendingPerson.has(id) && shownFaces.has(id)) value=shownFaces.get(id);
            if (!value) return pendingPerson.has(id) ? {...row,avatarPending:true} : row;
            item.source.avatars[key]=value;return {...row,avatar:key};
        };
        item.source.messages=item.source.messages.map(row=>face(row.turn+':'+row.para,row));
        if (item.source.threads) item.source.threads=item.source.threads.map(thread=>({...thread,participants:thread.participants.map(person=>face('p:'+person.id,person))}));
        if (item.source.phones) item.source.phones=item.source.phones.map(row=>face('p:'+row.id,row));
        if (item.source.contacts) item.source.contacts=item.source.contacts.map(row=>face('p:'+row.id,row));
    }
    cursor.currentRef=items.find(item=>item.source?.current)?.key || null;
    // A phone's first look (per chat branch) takes what is already there as read; later messages count as unread.
    const looked=new Set(Object.keys(reads).map(phoneModReadOwner));
    const unseen=(items.find(item=>item.ref?.modId==='dsh.phone')?.source?.phones || []).filter(row=>!looked.has(row.id) && row.threads.some(thread=>thread.latest));
    const firstLook=unseen.length ? JSON.stringify([readScope,unseen.map(row=>row.id)]) : '';
    React.useEffect(()=>{if (firstLook) markRead(Object.fromEntries(unseen.flatMap(row=>row.threads.filter(thread=>thread.latest).map(thread=>[phoneModReadKey(row.id,thread.id),thread.latest]))));},[firstLook]);
    const mountedIdentities=items.map(item=>item.identity).sort().join('|');
    React.useEffect(()=>{
        const active=new Set(items.map(item=>item.identity)),keep=values=>Object.fromEntries(Object.entries(values).filter(([identity])=>active.has(identity)));
        setReady(keep);setFailed(keep);
        for (const map of [audioEvents.current,lastPositions.current]) for (const key of map.keys()) if (!byRef.has(key)) map.delete(key);
    },[mountedIdentities]);
    const signature=JSON.stringify([cursor,items.map(item=>[item.key,item.identity,item.event,item.fingerprint]),props.enabled,paused,props.mode]);
    // The session owner can clear this state before the mounted hook unmounts.
    if (!context.state) {context.state=stageWidgetPresentationState();previousInput.current='';}
    // skip is silent - a widget SE event reached while skipping is consumed unplayed, and
    // one still sounding when it starts stops (widget music is persistent and plays on).
    for (const [key,event] of audioEvents.current) if (!byRef.has(key) || paused || props.skipping || props.mode!=='live' && !event.replay) event.fresh=false;
    React.useLayoutEffect(()=>{if (props.skipping) stageWidgetMediaOwner?.stopSfx();},[props.skipping]);
    if (previousInput.current!==signature) {
        context.state=reduceWidgetPresentation(context.state,{type:'content',cursor,items:items.map(item=>({...item,source:item.sourceOnly})),live:props.mode==='live',suspended:paused,restoring:!enabledBefore.current && props.enabled});
        enabledBefore.current=props.enabled;
        previousInput.current=signature;
    }
    // a portrait phone reads the widget as the phone itself, so opening goes straight to the full-bleed sheet.
    const portrait=Boolean(geometry && geometry.viewport.width<700 && geometry.viewport.height>geometry.viewport.width);
    // The phone is the device only on a real phone; a narrow desktop window keeps the framed phone.
    const handheld=Boolean(geometry && phoneModHandheld(geometry.viewport));
    const action=(key,type)=>{
        if (key===PHONE_KEY) phoneClosed.current=['collapse','hide'].includes(type) && phoneRun ? phoneRun.key : null;
        if (type==='open' && portrait && (key!==PHONE_KEY || handheld)) type='sheet';
        if (['open','sheet'].includes(type)) {focusReturn.current=document.activeElement;props.onPause?.();}
        if (['collapse','hide'].includes(type)) requestAnimationFrame(()=>{const panel=[...(props.rootRef.current?.querySelectorAll('.fork-widget-panel') || [])].find(node=>node.dataset.widgetRef===key && node.dataset.presentation!=='hidden');const target=focusReturn.current?.isConnected && focusReturn.current!==document.body ? focusReturn.current : (type==='collapse'?panel:null) || props.rootRef.current?.querySelector('.fork-widget-menu>button');target?.focus();});
        if (type==='sheet') {setSheet(key);type='open';} else if (['collapse','hide','open'].includes(type)) setSheet(null);
        context.state=reduceWidgetPresentation(context.state,{type,key});redraw(n=>n+1);
    };
    // the phone's earlier conversations (previous turns) are read while it
    // is still in the pocket, so the first open paints the finished list at once instead of 「还没有对话」 for a second and a
    // half. Other source widgets still read their history when opened. The read is shared and cached per session source.
    const opened=items.find(item=>item.sourceOnly && context.state.entries.get(item.key)?.requestedState==='open');
    const pocket=opened ? null : items.find(item=>item.sourceOnly && item.ref?.modId==='dsh.phone');
    const historyFor=opened || pocket;
    const depth=historyFor?.ref?.modId==='dsh.phone' ? phoneDepth : 19;
    const historyKey=historyFor ? historyKeyOf(historyFor.key,historyFor.ref?.modId==='dsh.phone') : '';
    React.useEffect(()=>{
        // Opening reads again (the session's cached read, rechecked against the turn index), as before.
        if (!historyFor) return;
        let live=true;
        const read=()=>(props.readHistory || ((source,turns)=>stageSessions.owner?.readWidgetHistory(props.sessionId,source,turns)))(props.source,depth)?.then(value=>{if (live && value) setHistory({...value,scope,key:historyKey});});
        // In the pocket it waits for a quiet moment, never ahead of the page the reader is on.
        if (opened || typeof requestIdleCallback!=='function') {read();return()=>{live=false;};}
        const task=requestIdleCallback(()=>{if (live) read();},{timeout:1500});
        return()=>{live=false;cancelIdleCallback(task);};
    },[historyKey,Boolean(opened)]);
    React.useLayoutEffect(()=>{
        const root=props.rootRef.current;if (!root) return;
        const measure=()=>{
            const next=stageWidgetStageGeometry(root,measured.current);
            measured.current=next;
            setGeometry(old=>JSON.stringify(old)===JSON.stringify(next) ? old : next);
        };
        measure();const observer=new ResizeObserver(measure);observer.observe(root);
        const timer=forkForeground.setInterval(measure,100);window.visualViewport?.addEventListener('resize',measure);
        return()=>{observer.disconnect();forkForeground.clearInterval(timer);window.visualViewport?.removeEventListener('resize',measure);};
    },[props.rootRef,props.film]);
    const phone=items.find(item=>item.ref.modId==='dsh.phone'),notice=phone?.source?.messages.find(row=>row.id===phone.source.current?.id && row.side==='in');
    const phoneEntry=phone && context.state.entries.get(phone.key),userClosed=Boolean(phoneRun && phoneClosed.current===phoneRun.key);
    // a real phone's banner — only for an incoming message that reaches a closed phone (the
    // first line of a run, or after the reader put the phone away). It slides down, stays ~3.5 s, slides back up and then
    // the phone is taken out, while skipping too. Every other line of a run goes straight into the open phone.
    const noticeId=notice && phoneEntry?.requestedState==='compact' && (!phoneRun || userClosed || phoneRun.start===cursor.para) ? notice.id : null;
    const [noticeClock,setNoticeClock]=React.useState({id:null,phase:null});
    const noticePhase=noticeClock.id===noticeId ? noticeClock.phase : null;
    const calmBanner=Boolean(props.reducedMotion);
    React.useEffect(()=>{
        if(!noticeId || paused || noticePhase==='done')return;
        const leave=setTimeout(()=>setNoticeClock({id:noticeId,phase:'leaving'}),noticePhase==='leaving'?0:PHONE_BANNER_MS);
        const done=setTimeout(()=>setNoticeClock({id:noticeId,phase:'done'}),(noticePhase==='leaving'?0:PHONE_BANNER_MS)+(calmBanner?140:300));
        return()=>{clearTimeout(leave);clearTimeout(done);};
    },[noticeId,paused]);
    // Taking the phone out never pauses AUTO or moves focus; only the reader's own open/close does. A sent line always
    // takes it out again (it has no banner), even after the reader put the phone away.
    const outgoing=phone?.source?.messages.some(row=>row.id===phone.source.current?.id && row.side==='out');
    // Leaving the run (or a sent line taking the phone out) forgets that the reader put it away.
    if (!phoneRun) phoneClosed.current=null;
    if (phone && phoneRun && phoneEntry?.requestedState==='compact' && (!userClosed || outgoing) && (!noticeId || noticePhase==='done') && phone.source?.messages.length) {
        context.state=reduceWidgetPresentation(context.state,{type:'open',key:phone.key});
        if (outgoing) phoneClosed.current=null;
    }
    const ordered=items.slice().sort((a,b)=>(context.state.entries.get(b.key)?.requestedState==='open')-(context.state.entries.get(a.key)?.requestedState==='open') || a.key.localeCompare(b.key));
    const placeScope=String(props.placeKey || props.sessionId || '');
    const occupied=[],layouts=new Map();let compacts=0;
    for (const item of ordered) {
        const entry=context.state.entries.get(item.key),declaration=item.definition.document.presentation;
        let state=entry.requestedState,bounds=null,surface='stage',fill=false,placed=false,phoneZoom=null,phoneBase=null,device=null;
        const headsUp=item.ref.modId==='dsh.phone' && state==='compact';
        // The reader's size and place for the phone on this device (phone-layout.js).
        const phoneLayout=item.ref.modId==='dsh.phone' && geometry && phonePrefs ? phonePrefs[phoneModPrefs.current(geometry.viewport.width)] : null;
        if(headsUp && (!noticeId || noticePhase==='done'))state='hidden';
        if (geometry && state!=='hidden') {
            const viewport=geometry.viewport;
            const fullPhone=item.ref.modId==='dsh.phone' && state==='open' && handheld;
            if (fullPhone) device={kind:'phone',safe:safeAreaInsets(props.rootRef.current)};
            // A phone the reader placed (long press or CONFIG) stays that stage phone even where the band above the box is too
            // small for it - then its 100% size is the sheet's (design: on a 1707x960 screen with a tall box the phone
            // only ever opened as the sheet, so the long press never reached adjust mode).
            if (state==='open' && (sheet===item.key && !(phoneLayout?.place && !fullPhone) || fullPhone)) {
                surface='sheet';const box=declaration.open;
                // Portrait or narrow phone: the view fills the reading area edge to edge (the bundle paints screen only). Elsewhere
                // the sheet keeps the declared proportions, centred on the dimmed stage.
                if (fullPhone || portrait && item.ref.modId!=='dsh.phone') {fill=true;bounds={x:viewport.x,y:viewport.y,width:Math.max(box.minWidth,viewport.width),height:Math.max(box.minHeight,viewport.height)};}
                else {
                    const size=stageWidgetSheetSize(viewport,box);
                    bounds={x:viewport.x+Math.max(8,(viewport.width-size.width)/2),y:viewport.y+Math.max(8,(viewport.height-size.height)/2),...size};
                    // The phone sheet is adjusted like the stage phone: its 100% is the sheet size, and the first gesture places it on stage.
                    if (phoneLayout) phoneBase={...size,size:phoneLayout.size,min:phoneModSizeMin(phoneModPrefs.current(viewport.width))};
                }
            }
            if(headsUp){
                // As wide as the phone's own screen at this stage size, at the top centre.
                const size=phoneModStageSize(geometry,declaration.open,phoneBand.current),zoom=size?.zoom || phoneModStageScale(viewport);
                const width=Math.min(viewport.width-24,size ? size.width-PHONE_BEZEL*zoom : PHONE_SCREEN*zoom),height=PHONE_BANNER_HEIGHT*zoom;
                bounds={x:viewport.x+(viewport.width-width)/2,y:viewport.y+10*zoom,width,height};phoneZoom=zoom;
            } else if (item.ref.modId==='dsh.phone' && state==='open' && !bounds) {
                // Centred between the top bar and the dialogue box, which stays readable underneath.
                const size=phoneModStageSize(geometry,declaration.open,phoneBand.current) || (phoneLayout?.place ? stageWidgetSheetSize(viewport,declaration.open) : null);
                if (size) {
                    // The reader's size (percent of that band size) and place on this device (phone-layout.js): a smaller phone
                    // stays centred in the band; one too tall for the band is centred on the stage; a dragged phone keeps its spot.
                    const layout=phoneLayout,scale=layout ? layout.size/100 : 1,ratio=declaration.open.aspectRatio || declaration.open.width/declaration.open.height;
                    let width=size.width*scale,height=size.height*scale;
                    if (width>viewport.width-2*STAGE_WIDGET_PLACE_PAD) {width=viewport.width-2*STAGE_WIDGET_PLACE_PAD;height=width/ratio;}
                    if (height>viewport.height-2*STAGE_WIDGET_PLACE_PAD) {height=viewport.height-2*STAGE_WIDGET_PLACE_PAD;width=height*ratio;}
                    let x=size.x+(size.width-width)/2,y=height>size.height ? viewport.y+(viewport.height-height)/2 : size.y+(size.height-height)/2;
                    if (layout?.place) {({x,y}=stageWidgetPlacePoint(viewport,{width,height},layout.place));placed=true;}
                    bounds={x,y,width,height};phoneZoom=Math.min(PHONE_MAX_ZOOM,Math.max(.7,width/declaration.open.width));phoneBase=layout ? {width:size.width,height:size.height,size:layout.size,min:phoneModSizeMin(phoneModPrefs.current(viewport.width))} : null;
                }
            }
            for (const candidate of state==='open' && !bounds ? (item.ref.modId==='dsh.phone' ? ['compact'] : ['open','compact']) : !bounds ? ['compact'] : []) {
                const box=declaration[candidate] || {width:220,height:44,minWidth:120,minHeight:44,anchor:'corner-right'};
                if (candidate==='compact' && compacts>=(viewport.width<700?1:3)) continue;
                const sizes=[false,true].map(small=>{
                    let width=small?box.minWidth:box.width,height=small?box.minHeight:box.height;
                    if (box.aspectRatio) {height=Math.max(height,width/box.aspectRatio);width=height*box.aspectRatio;}
                    return {width,height};
                });
                // The reader's own spot wins over automatic avoidance; it is only kept inside the stage.
                const saved=stageWidgetPlaces.get(placeScope,item.key,candidate),fits=sizes.find(size=>size.width+2*STAGE_WIDGET_PLACE_PAD<=viewport.width && size.height+2*STAGE_WIDGET_PLACE_PAD<=viewport.height);
                if (saved && fits) {bounds={...stageWidgetPlacePoint(viewport,fits,saved),...fits};state=candidate;placed=true;break;}
                const obstacles=[...geometry.blocked,...(candidate==='open' && item.source?.current ? [] : geometry.caption),...occupied];
                for (const size of sizes) {
                    bounds=stageWidgetSourcePlace({...geometry,blocked:obstacles,size,previous:lastPositions.current.get(item.key),anchor:box.anchor});
                    if (bounds) {state=candidate;break;}
                }
                if (bounds) break;
            }
            if (!bounds) state='hidden';
        } else state='hidden';
        const banner=headsUp && state==='compact' ? noticePhase==='leaving' ? 'leaving' : 'in' : null;
        if (state==='compact') compacts++;
        if (bounds) {if (surface==='stage') lastPositions.current.set(item.key,bounds);occupied.push({...bounds,height:bounds.height+8});}
        const suspended=paused || item.checking || state==='hidden' || state==='compact' && !declaration.compact;
        const reducedMotion=props.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        const presentation={state,bounds:{width:bounds?.width || declaration.open.width,height:bounds?.height || declaration.open.height},surface,...(device ? {device} : {}),pinned:entry.pinned,attention:stageWidgetAttention(entry,cursor),suspended,
            reducedMotion,transitionMs:props.mode!=='live' || paused || state!==entry.requestedState ? 0 : reducedMotion ? 100 : 160};
        const isReady=ready[item.identity]===true && !failed[item.identity];
        // a settled history page replays the line its own mark puts on this page, when the
        // dwell replays a kind this widget's mod owns (props.replays, stageHistoryModPlays): the widget hears its current message
        // as a fresh event under the dwell's key, once (replay = that message id; the widget decides what sounds, e.g. the phone's
        // incoming tone).
        const replay=item.source?.current && item.ref.modId && item.event?.para===cursor.para ? (props.replays || []).find(row=>row.kind.startsWith(item.ref.modId+'.')) : null;
        const eventToken=replay ? replay.key : item.event?.token;
        // One audio event is one arrival of the event on the reader's page: reading the same line again later (after a 履历
        // jump or paging back) is a new arrival, which the widget and the media owner hear under its own playback token.
        let audio=audioEvents.current.get(item.key);
        if (!audio || audio.token!==eventToken) {context.arrival=(context.arrival || 0)+1;audio={token:eventToken,arrival:eventToken ? eventToken+'#'+context.arrival : eventToken,identity:item.identity,replay:replay ? item.source.current.id : null,fresh:Boolean(!suspended && (replay || entry.pending.some(event=>event.token===eventToken)))};audioEvents.current.set(item.key,audio);}
        if (suspended || props.skipping || audio.identity!==item.identity) audio.fresh=false;
        const playback={mode:props.mode,paused:suspended,eventToken:audio.arrival,fresh:audio.fresh,...(audio.replay ? {replay:audio.replay} : {})};
        // The open stage phone can be adjusted directly (phone-layout.js usePhoneAdjust): phoneBase is its 100% band size
        // and the reader's size percent; unlocked is the one adjust state (CONFIG 「解锁手机位置」 or a long press).
        const adjustable=Boolean(phoneBase && state==='open' && !fill);
        layouts.set(item.key,{...item,presentation,bounds,fill,placed,isReady,failed:failed[item.identity],requestedState:entry.requestedState,playback,banner,phoneZoom,
            phoneBase:adjustable ? phoneBase : null,unlocked:Boolean(adjustable && phonePrefs.unlocked)});
    }
    // The faces follow the open phone's widest width (stageWidgetFacePx): a larger phone or the full-bleed sheet redraws them.
    const phoneShownWidth=[...layouts.values()].find(layout=>layout.ref.modId==='dsh.phone' && layout.presentation.state==='open')?.presentation.bounds.width || 0;
    React.useEffect(()=>{if (phoneShownWidth>phoneFaceWidth) setPhoneFaceWidth(phoneShownWidth);},[phoneShownWidth]);
    // A drag or arrow key stores the reader's spot for this view; a null point forgets the widget's spots (reset).
    const place=(key,view,point)=>{
        const layout=layouts.get(key);
        // The phone's spot is a device preference per layout (phone-layout.js), not a card's.
        if (layout?.ref.modId==='dsh.phone' && phonePrefs) {
            if (!point) phoneModPrefs.update(phoneModPrefs.current(geometry?.viewport.width),{place:null});
            else if (geometry && layout.bounds && layout.presentation.surface==='stage') phoneModPrefs.update(phoneModPrefs.current(geometry.viewport.width),{place:stageWidgetPlaceFraction(geometry.viewport,layout.bounds,point)});
            return;
        }
        if (!point) {stageWidgetPlaces.set(placeScope,key,null,null);lastPositions.current.delete(key);}
        else if (geometry && layout?.bounds && layout.presentation.surface==='stage') stageWidgetPlaces.set(placeScope,key,view,stageWidgetPlaceFraction(geometry.viewport,layout.bounds,point));
        else return;
        redraw(n=>n+1);
    };
    const clampPlace=(key,point)=>{const box=layouts.get(key)?.bounds;return geometry && box ? stageWidgetPlacePoint(geometry.viewport,box,stageWidgetPlaceFraction(geometry.viewport,box,point)) : point;};
    // The phone's direct adjust (phone-layout.js): the one unlocked state, and a size percent with, when the phone moved,
    // its new rect (stage units) stored as the place for that size; without a rect an unplaced phone stays centred in its band.
    const adjust=on=>{if (phonePrefs && phonePrefs.unlocked!==on) phoneModPrefs.set({unlocked:on});};
    const resize=(key,size,rect)=>{
        if (!phonePrefs || !geometry || layouts.get(key)?.ref.modId!=='dsh.phone') return;
        phoneModPrefs.update(phoneModPrefs.current(geometry.viewport.width),{size,...(rect ? {place:stageWidgetPlaceFraction(geometry.viewport,rect,rect)} : {})});
    };
    // Moving an existing iframe DOM node reloads its browsing context; allocation priority must not reorder mounts.
    const projected=[...layouts.values()].sort((a,b)=>a.key.localeCompare(b.key));
    useWidgetVariables(props,projected);
    useWidgetSettingImages(projected);
    useWidgetSettingsFeedback(props,projected,context);
    const phoneBeat=projected.some(item=>item.ref.modId==='dsh.phone' && item.source?.current);
    // phone lines are read in the phone (or its banner) while the dialogue box stays up with
    // the last line from outside the phone; only a failed phone gives its line back to the box.
    const phoneLine=projected.some(item=>item.ref.modId==='dsh.phone' && item.source?.current && !item.failed);
    const phoneOpen=!paused && projected.some(item=>item.ref.modId==='dsh.phone' && item.presentation.state==='open' && item.presentation.surface==='stage' && !item.failed);
    // a phone the reader moved off its default spot is read
    // alongside the story, so the stage is not shaded behind it (gal-scene.js phoneShade); the default spot keeps the shade.
    const phoneShade=phoneOpen && !projected.some(item=>item.ref.modId==='dsh.phone' && item.phoneBase && item.placed);
    // The phone is in hand (asked open, before its place is measured): a skin's boxless narration then takes its image band
    // under the phone, as under a shown picture, instead of the centre the phone needs (2026-10-21 「阅读」 chip).
    const phoneHeld=!paused && projected.some(item=>item.ref.modId==='dsh.phone' && item.requestedState==='open' && !item.failed);
    const claimed=projected.find(item=>item.source?.current && item.ref.modId!=='dsh.phone' && item.presentation.state==='open' && !item.presentation.suspended && item.isReady && !item.checking);
    // an open overlay that owns scroll input — a sheet (modal reader)
    // or a held mod device (the phone, which dims the stage behind it). While one is open the stage's wheel gestures (up =
    // 履历, down = next page) stand down; a wheel that lands on the stage around it scrolls that overlay's view instead.
    const scrollOwner=paused ? null : projected.find(item=>item.presentation.state==='open' && !item.failed && (item.presentation.surface==='sheet' || item.modSource)) || null;
    React.useLayoutEffect(()=>{
        let changed=false;
        for (const item of projected) {
            if (!item.isReady || item.presentation.suspended || item.presentation.state!=='open') continue;
            const entry=context.state.entries.get(item.key);
            const tokens=item.source ? entry.pending.filter(event=>item.source.messages.some(row=>row.turn===event.turn && row.para===event.para && row.revealed)).map(event=>event.token) : [];
            if (!tokens.length && (!entry.changed || entry.changed!==item.event?.token)) continue;
            context.state=reduceWidgetPresentation(context.state,{type:'presented',key:item.key,ready:true,effectiveState:'open',tokens,version:item.event?.token});changed=true;
        }
        if (changed) redraw(n=>n+1);
    });
    return {items:projected,readingKey,claim:Boolean(claimed),phoneBeat,phoneLine,phoneOpen,phoneShade,phoneHeld,paused,scrollOwner:scrollOwner?.key || null,
        scroll:event=>{if (scrollOwner && typeof stageWidgetScrollTargets!=='undefined') stageWidgetScrollTargets.get(scrollOwner.identity)?.wheel(event.deltaY,event.deltaMode);},viewport:geometry?.viewport,narrow:geometry?.viewport.width<700,portrait,action,place,clampPlace,adjust,resize,openKey:projected.find(item=>item.requestedState==='open')?.key,
        onVisible:value=>setVisible(old=>old.key===readingKey && old.text===value ? old : {key:readingKey,text:value}),
        onReady:(identity,value)=>setReady(old=>old[identity]===value?old:{...old,[identity]:value}),onFailure:identity=>setFailed(old=>({...old,[identity]:true}))};
}

// One ephemeral snapshot on the existing session owner, shared by the card renderer; never persisted.
function useWidgetSettingsFeedback(props,items,context) {
    const snapshot={sessionId:props.sessionId,turn:props.turn,page:props.page,items:items.map(item=>({ref:item.ref,
        signature:JSON.stringify([item.definition.settingsDefaults || {},item.definition.settingsOverride?.settings || {},item.definition.settingsOverride?.bindings || {}]),
        fields:item.settingsFeedback, snapshot:item.settingsSnapshot, suspended:item.presentation.suspended}))};
    React.useLayoutEffect(()=>{
        const root=props.rootRef.current;
        const publish=()=>{context.settingsFeedback={...snapshot,theme:typeof stageWidgetThemeOwners==='undefined'?null:stageWidgetThemeOwners.get(root)};document.dispatchEvent(new CustomEvent('widget-settings-feedback',{detail:{sessionId:props.sessionId}}));};
        publish();root?.addEventListener('widget-theme',publish);
        return()=>{root?.removeEventListener('widget-theme',publish);context.settingsFeedback=null;document.dispatchEvent(new CustomEvent('widget-settings-feedback',{detail:{sessionId:props.sessionId}}));};
    },[context,props.rootRef,JSON.stringify(snapshot)]);
}
// Committed signals wake bounded reads; navigation clears values synchronously, never by polling.
function useWidgetVariables(props,items) {
    const owner=React.useRef(null), [values,setValues]=React.useState({key:'',items:{}});
    if (!owner.current) owner.current={id:crypto.randomUUID(),epoch:0,key:'',busy:new Map(),requests:new Map(),proposals:new Map()};
    const state=owner.current, hasReads=item=>item.definition.document.variables || Object.keys(item.definition.settingsOverride?.bindings || {}).length,
        active=items.filter(item=>hasReads(item) && !item.presentation.suspended);
    const key=JSON.stringify([props.sessionId,props.source,props.turn,props.page,props.revealed,props.mode,active.map(item=>[item.identity,item.presentation.state,item.definition.settingsOverride,item.definition.settingsDefaults])]);
    if (state.key!==key) {state.key=key;state.epoch++;}
    const epoch=state.epoch, view={sessionId:props.sessionId,viewId:state.id,viewEpoch:epoch};
    const call=(method,args)=>(props.variableRpc || rpc)(method,args,args.sessionId || props.sessionId);
    React.useLayoutEffect(()=>{
        if (!active.length) return;
        let live=true,timer=null,dirty=false,last=0;
        const busy=()=>[...state.busy.values()].some(work=>work.sessionId===props.sessionId);
        const refresh=()=>{
            dirty=true;
            if (!live || busy() || timer) return;
            timer=setTimeout(async()=>{
                timer=null;if(!live || busy())return;dirty=false;last=performance.now();
                const next={};
                const coordinate=props.record?.pageIndex?.pages?.[props.page];
                for (const item of active) {
                    const input={...view,turn:props.turn,at:props.pages[props.page]?.para,expectedDirectionToken:props.record?.token,
                        page:coordinate ? {version:1,index:coordinate.page,para:coordinate.para,offset:coordinate.offset} : undefined,
                        ref:item.ref,identity:item.definition.contentIdentity,revealed:props.revealed===true,live:props.mode==='live'};
                    const result=await call('readWidgetVariables',input).catch(()=>null);
                    if (!live || state.epoch!==epoch)return;
                    next[item.identity]=result || {status:'unavailable',reason:'unavailable'};
                }
                if(live && !busy())setValues({key,items:next});
                if(dirty)refresh();
            },Math.max(0,200-(performance.now()-last)));
        };
        state.refresh=refresh;refresh();
        const stop=typeof tavernSessionSignals!=='undefined' ? tavernSessionSignals.subscribe(props.sessionId,'tavern-state',refresh,refresh,refresh) : ()=>{};
        return()=>{live=false;clearTimeout(timer);stop();if(state.refresh===refresh)state.refresh=null;
            void call('invalidateWidgetVariables',{...view,active:false}).then(async()=>{
                for(const [operationId,input] of state.busy) if(input.sessionId===view.sessionId) {
                    const result=await call('widgetVariableStatus',{...input,operationId}).catch(()=>({status:'unknown'}));
                    if(!['running','unknown'].includes(result.status))state.busy.delete(operationId);
                }
            }).catch(()=>{});};
    },[key]);
    for (const item of items) {
        item.settings={...(item.definition.settings || {})};
        item.settingsFeedback={...item.definition.settingsFeedback};
        const response=values.key===key ? values.items[item.identity] : null;
        item.settingsSnapshot=response?.snapshot || {kind:'unavailable',turn:null};
        for (const field of Object.keys(item.definition.settingsOverride?.bindings || {})) {
            if (response?.settings && Object.hasOwn(response.settings,field)) item.settings[field]=response.settings[field];
            item.settingsFeedback[field]=response?.settingsFeedback?.[field] || {value:item.settings[field],source:'binding',status:item.presentation.suspended?'suspended':response?.reason || 'loading'};
        }
        if (!item.definition.document.variables)continue;
        const projection=response?.contextKey && Object.fromEntries(Object.entries(response).filter(([name])=>!['settings','settingsDiagnostics','settingsFeedback'].includes(name)));
        item.variables=projection || {
            contextKey:'loading:'+state.id+':'+epoch,revision:'',sequence:0,position:{turn:props.turn,swipeId:0},snapshot:{kind:'unavailable',turn:null},
            settlement:'idle',writable:{allowed:false,reason:'loading'},values:Object.fromEntries(Object.keys(item.definition.document.variables.reads || {}).map(id=>[id,{status:'unavailable'}]))};
        item.onVariableRequest=async request=>{
            const input={sessionId:props.sessionId,ref:item.ref,identity:item.definition.contentIdentity};
            if(state.epoch!==epoch || item.presentation.suspended)return {status:'cancelled',reason:'position-changed'};
            if(request.type==='variables.status') {
                const previous=state.requests.get(request.operationId);
                if(previous?.mount!==item.identity)return {status:'unknown'};
                const result=await call('widgetVariableStatus',{...previous.input,operationId:request.operationId});
                if(!['running','unknown'].includes(result.status)){state.busy.delete(request.operationId);state.refresh?.();}
                return result;
            }
            const requestKey=item.identity+':'+request.requestId,digest=JSON.stringify([request.contextKey,request.revision,request.operations]),previous=state.proposals.get(requestKey);
            if(previous)return previous.digest===digest ? call('widgetVariableStatus',{...state.requests.get(previous.operationId)?.input,operationId:previous.operationId}) : {status:'rejected',reason:'request-id-reused'};
            if([...state.busy.values()].some(work=>work.sessionId===props.sessionId))return {status:'rejected',reason:'operation-pending'};
            const operationId=crypto.randomUUID(),query={...input,contextKey:request.contextKey,revision:request.revision};
            state.requests.set(operationId,{mount:item.identity,input:query});state.busy.set(operationId,query);
            state.proposals.set(requestKey,{digest,operationId});while(state.proposals.size>16)state.proposals.delete(state.proposals.keys().next().value);
            while(state.requests.size>16)state.requests.delete(state.requests.keys().next().value);
            let result;
            try { result=await call('proposeWidgetVariables',{...input,operationId,contextKey:request.contextKey,revision:request.revision,operations:request.operations}); }
            catch { result=await call('widgetVariableStatus',{...query,operationId}).catch(()=>({status:'unknown',operationId})); }
            if(!['running','unknown'].includes(result.status))state.busy.delete(operationId);
            // Let the bridge publish the receipt before the committed projection replaces its revision.
            setTimeout(()=>state.refresh?.(),0);
            return result;
        };
    }
}
