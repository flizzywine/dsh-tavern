function createStageWidgets({React:react, window, document, sandbox:WidgetSandbox, adjust:usePhoneAdjust, sounds:forkUiSfx, report:useStageEntryState, entries:stageEntries, setTimeout:hostSetTimeout, clearTimeout:hostClearTimeout, requestAnimationFrame:hostRequestFrame, cancelAnimationFrame:hostCancelFrame}) {
let disposed=false;
const cleanups=new Set(),timers=new Map(),frames=new Map();
function own(cleanup){let active=true;const release=()=>{if(!active)return;active=false;cleanups.delete(release);cleanup();};cleanups.add(release);return release;}
const effect=hook=>(setup,deps)=>hook(()=>{
    if(disposed)return;
    const cleanup=setup();return typeof cleanup==='function'?own(cleanup):undefined;
},deps);
const React={...react,useEffect:effect(react.useEffect),useLayoutEffect:effect(react.useLayoutEffect),createElement(type,props,...children){
    const guarded=props&&Object.fromEntries(Object.entries(props).map(([name,value])=>[name,/^on[A-Z]/.test(name)&&typeof value==='function'?(...args)=>{if(!disposed)return value(...args);}:value]));
    return react.createElement(type,guarded,...children);
}};
function schedule(map,start,callback,delay){
    if(disposed)return 0;
    const token={};const id=start((...args)=>{if(disposed||map.get(id)!==token)return;map.delete(id);callback(...args);},delay);map.set(id,token);return id;
}
const setTimeout=(fn,ms)=>schedule(timers,hostSetTimeout,fn,ms),clearTimeout=id=>{timers.delete(id);hostClearTimeout(id);};
const requestAnimationFrame=fn=>schedule(frames,hostRequestFrame,fn),cancelAnimationFrame=id=>{frames.delete(id);hostCancelFrame(id);};
// Read-only widget containers; presentation preferences live in the session owner.
const stageWidgetRuntime = { mounted: 0, mounts: 0, errors: 0, suppressed: 0, navigations: 0, timeouts: 0, floods: 0 };
function stageWidgetCount(name) { stageWidgetRuntime[name] = Math.min(1000000, stageWidgetRuntime[name] + 1); }
let stageWidgetBoundaryType;
function getWidgetBoundary() {
    // Non-UI consumers can load the bundle without React's component runtime.
    if (!stageWidgetBoundaryType) stageWidgetBoundaryType = class WidgetBoundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { stageWidgetCount('errors'); if (this.props.onError) this.props.onError(); }
        render() { return this.state.failed ? null : this.props.children; }
    };
    return stageWidgetBoundaryType;
}
function WidgetIcon({ name }) {
    const h = React.createElement;
    // host chrome glyphs (line icons, currentColor) for the widget windows and their entry chips.
    const paths = { alarm: 'M8 3 4 6m12-3 4 3M7 19l-2 3m12-3 2 3M12 8v5l3 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0', clock: 'M12 7v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', message: 'M3 4h18v13H9l-6 4V4z', letter: 'M2 5h20v14H2zM2 5l10 8L22 5',
        widget: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', phone: 'M8.5 2.5h7A1.5 1.5 0 0 1 17 4v16a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V4a1.5 1.5 0 0 1 1.5-1.5zM10.5 18.5h3', collapse: 'M6 10l6 6 6-6', open: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7', hide: 'M6 6l12 12M18 6 6 18',
        pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6', reset: 'M12 3v4M12 17v4M3 12h4M17 12h4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', sheet: 'M4 5h16v14H4zM8 9h8M8 13h5', history: 'M4 6h12M4 11h16M4 16h9', warning: 'M12 4 21 19H3zM12 10v4M12 16.5v.1' };
    return paths[name] ? h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] })) : null;
}
function WidgetContent({widget,seconds}) {
    if (!widget.definition?.thirdParty) return null;
    return React.createElement(WidgetSandbox,{key:widget.definition.contentIdentity,widget,seconds});
}
function WidgetCard({widget}) {
    const box=widget.definition.document.presentation.open;
    const presentation=widget.presentation || {state:'open',bounds:{width:box.width,height:box.height},surface:'stage',pinned:false,attention:{count:0,changed:false},suspended:false,reducedMotion:true,transitionMs:0};
    return React.createElement('article',{className:'fork-widget-preview-card'},React.createElement(WidgetContent,{widget:{...widget,presentation}}));
}
// chromeless widget windows. A self-drawn view (open device, phone island) and the
// generic entry chip carry no host chrome; the host only adds invisible hit areas that never cover the widget's own
// interactive content — a ring over the device edge (drag to move, double-click resets), a cover over compact views (tap
// opens, drag moves) and, on the full-bleed portrait sheet, a strip over the top edge. Right-click, a touch long-press,
// Shift+F10 or the ContextMenu key open one galgame menu with the presentation actions.
const STAGE_WIDGET_HOLD_MS=500,STAGE_WIDGET_SLOP=6;
let stageWidgetHintSerial=0;
function stageWidgetMenuEntries(item,owner) {
    const p=item.presentation,open=p.state==='open',entries=[open?{type:'collapse',icon:'collapse',label:'收起'}:{type:'open',icon:'open',label:'打开'}];
    if (open) entries.push({type:'pin',icon:'pin',label:'固定',hint:'翻页后保持打开',checked:p.pinned});
    if (open && p.surface==='stage' && owner.narrow && !owner.portrait) entries.push({type:'sheet',icon:'sheet',label:'阅读面板'});
    if (item.placed && p.surface==='stage') entries.push({type:'reset',icon:'reset',label:'复位位置'});
    entries.push({type:'hide',icon:'hide',label:'关闭',hint:'可从模组列表重新打开',parted:true});
    return entries;
}
function WidgetPanel({item,owner,onBacklog,onMenu,onAdvance,onWheel}) {
    const h=React.createElement,loaded=React.useRef(false),panel=React.useRef(null),previousPresentation=React.useRef(null),gesture=React.useRef(null),hint=React.useRef(null);
    if (!hint.current) hint.current='fork-widget-hint-'+(++stageWidgetHintSerial);
    const p=item.presentation,shown=!owner.paused && p.state!=='hidden',custom=p.state==='open' || p.state==='compact' && item.definition.document.presentation.compact;
    // the phone keeps its centred place and the banner its top-centre slot - unless the reader
    // unlocked it (CONFIG 「解锁手机位置」, phone-layout.js): then its edge ring drags it like any widget.
    const movable=p.surface==='stage' && Boolean(item.bounds) && (!item.modSource || item.unlocked);
    if (custom && shown && !item.failed) loaded.current=true;
    React.useEffect(()=>{
        const previous=previousPresentation.current;previousPresentation.current={state:p.state,surface:p.surface,shown:previous?.shown || shown};
        // text-bearing windows keep their opaque paint throughout entry; reduced motion snaps.
        if (!previous?.shown || previous.state===p.state && previous.surface===p.surface || !shown || !p.transitionMs || p.reducedMotion) return;
        const animation=panel.current?.animate([{transform:'translateY(4px)'},{transform:'translateY(0)'}],{duration:p.transitionMs,easing:'ease-out'});
        return()=>animation?.cancel();
    },[p.state,p.surface,owner.paused,p.reducedMotion,p.transitionMs]);
    React.useEffect(()=>{
        if (p.state!=='open' || p.surface!=='sheet' || owner.paused) return;
        const before=document.activeElement,root=panel.current?.closest('.fork-gal-stage');
        const masked=[...(root?.children || [])].filter(node=>!node.contains(panel.current)).map(node=>[node,node.inert]);
        for (const [node] of masked) node.inert=true;
        const focus=()=>panel.current?.focus({preventScroll:true}),guard=event=>{if(!disposed&&!panel.current?.parentNode?.contains(event.target))focus();};
        document.addEventListener('focusin',guard);focus();
        return()=>{document.removeEventListener('focusin',guard);for(const [node,inert] of masked)node.inert=inert;if(before?.isConnected)before.focus();};
    },[p.state,p.surface,owner.paused]);
    React.useEffect(()=>()=>{const g=gesture.current;if(g){clearTimeout(g.timer);cancelAnimationFrame(g.frame);}},[]);
    const open=()=>owner.action(item.key,item.requestedState==='open' && p.state!=='open'?'sheet':'open');
    const menu=(x,y,touch)=>onMenu?.({key:item.key,x,y,touch,panel:panel.current});
    // the open stage phone's direct adjust mode - a long press on its frame or status bar.
    const adjust=typeof usePhoneAdjust==='function' ? usePhoneAdjust(item,owner,panel,menu) : null;
    const widget={...item,scopeKey:item.identity,
        onAdvance:item.modSource?onAdvance:undefined,onWheel:item.modSource?onWheel:undefined,
        onReady:value=>owner.onReady(item.identity,value),onFailure:()=>owner.onFailure(item.identity),onAction:type=>owner.action(item.key,type)};
    // One pointer at a time: a touch hold opens the menu unless it moves first; past the slop a drag follows the pointer
    // (clamped by the owner) on a paint-only translate and is stored once, on release.
    const down=(event,kind)=>{
        panel.current?.setAttribute('data-pointer','');
        if (event.button!==0 || !shown) return;
        event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);
        // Stage units per screen pixel: a docked stage is only scaled (createModStageDock).
        const stage=panel.current?.closest('.fork-gal-stage'),outer=stage?.getBoundingClientRect(),k=outer && outer.width>0 && Math.abs(outer.width-stage.offsetWidth)>=1 ? stage.offsetWidth/outer.width : 1;
        const g={id:event.pointerId,kind,touch:event.pointerType!=='mouse',x:event.clientX,y:event.clientY,k,origin:item.bounds,to:null,moved:false,held:false,cancelled:false,timer:0,frame:0};
        if (g.touch) g.timer=setTimeout(()=>{g.held=true;menu(g.x,g.y,true);},STAGE_WIDGET_HOLD_MS);
        gesture.current=g;
    };
    const move=event=>{
        const g=gesture.current;if (!g || g.id!==event.pointerId || g.held || g.cancelled) return;
        const dx=(event.clientX-g.x)*g.k,dy=(event.clientY-g.y)*g.k;
        if (!g.moved && Math.hypot(dx,dy)<STAGE_WIDGET_SLOP) return;
        clearTimeout(g.timer);
        if (!movable || g.kind==='edge' || !g.origin) {g.cancelled=true;return;}
        g.moved=true;g.to=owner.clampPlace(item.key,{x:g.origin.x+dx,y:g.origin.y+dy});
        if (!g.frame) g.frame=requestAnimationFrame(()=>{g.frame=0;const node=panel.current;if(node && g.to){node.classList.add('is-dragging');node.style.translate=(g.to.x-g.origin.x)+'px '+(g.to.y-g.origin.y)+'px';}});
    };
    const up=(event,cancelled)=>{
        const g=gesture.current;if (!g || g.id!==event.pointerId) return;
        gesture.current=null;clearTimeout(g.timer);cancelAnimationFrame(g.frame);
        const node=panel.current;
        if (g.moved) {
            node?.classList.remove('is-dragging');
            if (node) {node.style.translate='';if(!cancelled && g.to){node.style.left=g.to.x+'px';node.style.top=g.to.y+'px';}}
            if (!cancelled && g.to) owner.place(item.key,p.state,g.to);
            return;
        }
        if (!cancelled && !g.held && !g.cancelled && g.kind==='cover') open();
    };
    const reset=event=>{event.stopPropagation();if (item.placed) owner.place(item.key,null,null);};
    const grip=(kind,side)=>h('div',{key:kind+(side || ''),className:'fork-widget-grip is-'+kind+(side?' is-'+side:''),'aria-hidden':true,
        onPointerDown:event=>down(event,kind),onPointerMove:move,onPointerUp:event=>up(event,false),onPointerCancel:event=>up(event,true),onDoubleClick:kind==='ring'?reset:undefined});
    const grips=!shown ? null : item.fill ? [grip('edge')] : adjust ? adjust.grips : p.state==='open' ? ['top','right','bottom','left'].map(side=>grip('ring',side)) : [grip('cover')];
    const chip=(text,label,type)=>h('button',{type:'button',className:'fork-widget-chip','aria-label':label,onClick:()=>type==='backlog'?onBacklog?.():owner.action(item.key,type)},h(WidgetIcon,{name:type==='backlog'?'history':'sheet'}),text);
    const caption=item.definition.title,count=p.attention.count,attention=count ? (count>99?'99+':count)+' 待查看' : p.attention.changed?'有更新':'';
    const notes=[
        item.failed?h('p',{key:'failed',role:'status',className:'fork-widget-warning'},h(WidgetIcon,{name:'warning'}),'模组不可用；正文已恢复'):null,
        item.requestedState==='open' && p.state!=='open'?h(React.Fragment,{key:'read'},chip('阅读','空间不足，打开阅读面板','sheet')):null,
        // the phone shows its whole conversation itself (earlier messages load as it
        // scrolls up, real limits are stated inside it), so only other source widgets point to 履历 — and only for text they
        // really cannot show, never while history is still loading.
        item.sourceOnly && !item.modSource && p.state==='open' && (['limited','unavailable'].includes(item.source?.historyStatus) || item.source?.hasEarlier || item.source?.messages.some(row=>row.truncated))?h(React.Fragment,{key:'backlog'},chip('在履历查看','长消息或更早内容，请在履历查看全文','backlog')):null].filter(Boolean);
    const help=adjust ? (item.unlocked ? '拖动移动，右下角、滚轮、双指或加减号缩放，方向键微调；Esc 锁定' : '长按边框或状态栏调整位置和大小；Esc 收起')+'；右键或 Shift+F10 打开菜单'
        : (p.state==='open' ? (movable?'拖动边缘移动，方向键微调；':'')+'Esc 收起' : '回车打开；拖动移动，方向键微调')+'；右键、长按或 Shift+F10 打开菜单';
    return h('section',{ref:panel,tabIndex:shown?0:-1,className:'fork-widget-panel'+(p.surface==='sheet'?' is-sheet':'')+(item.fill?' is-fill':'')+(custom?' is-custom':' is-chip')+(item.banner && shown?' is-banner':'')+(item.ref?.modId==='dsh.phone'?' is-phone':''),'data-widget-ref':item.key,'data-presentation':p.state,'data-banner':item.banner && shown?item.banner:undefined,'data-unlocked':item.unlocked?'':undefined,
        role:p.surface==='sheet'?'dialog':'group','aria-modal':p.surface==='sheet'?'true':undefined,'aria-label':caption+(attention?'，'+attention:''),'aria-describedby':hint.current,'aria-haspopup':'menu','aria-keyshortcuts':'Shift+F10 ContextMenu',
        style:{left:item.bounds?.x || 0,top:item.bounds?.y || 0,width:item.fill?owner.viewport.width:p.bounds.width,height:item.fill?owner.viewport.height:undefined,maxHeight:p.surface==='sheet' && !item.fill?Math.max(0,owner.viewport.height-16):undefined,visibility:shown?'visible':'hidden',pointerEvents:shown?'auto':'none','--widget-transition':p.transitionMs+'ms','--phone-zoom':item.phoneZoom || undefined},
        inert:!shown?true:undefined,onClick:e=>{e.stopPropagation();if(item.modSource && !e.target.closest('button,a,input,textarea,select,[role="button"],.fork-widget-grip'))onAdvance?.();},onWheel:e=>{e.stopPropagation();if(adjust?.wheel(e))return;if(item.modSource)onWheel?.(e);},
        onContextMenu:e=>{e.preventDefault();e.stopPropagation();if(adjust?.holding())return;const g=gesture.current;if(!shown || g?.held)return;if(g){clearTimeout(g.timer);g.held=true;}menu(e.clientX,e.clientY,Boolean(g?.touch) || e.nativeEvent.pointerType==='touch');},
        onKeyDown:e=>{
            e.stopPropagation();e.currentTarget.removeAttribute('data-pointer');
            if (adjust?.key(e)) return;
            if (e.key==='ContextMenu' || e.key==='F10' && e.shiftKey) {e.preventDefault();const r=e.currentTarget.getBoundingClientRect();menu(r.left+Math.min(24,r.width/2),r.top+Math.min(24,r.height/2),false);return;}
            if (e.key==='Escape') {e.preventDefault();owner.action(item.key,'collapse');return;}
            if(item.modSource && p.state==='open' && e.target===e.currentTarget && (e.key==='Enter' || e.key===' ')){e.preventDefault();onAdvance?.();return;}
            if (e.target===e.currentTarget) {
                if ((e.key==='Enter' || e.key===' ') && p.state!=='open') {e.preventDefault();open();return;}
                const step=e.shiftKey?40:10,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
                if (delta && movable) {e.preventDefault();owner.place(item.key,p.state,{x:item.bounds.x+delta[0],y:item.bounds.y+delta[1]});return;}
            }
            if (e.key==='Tab' && p.surface==='sheet') {const nodes=[e.currentTarget,...e.currentTarget.querySelectorAll('button,iframe')];const index=nodes.indexOf(document.activeElement);if(e.shiftKey&&index<=0 || !e.shiftKey&&index===nodes.length-1){e.preventDefault();nodes[e.shiftKey?nodes.length-1:0]?.focus();}}
        }},
        // Only the generic chip paints a caption (its glyph, title and unread bead); self-drawn views explain themselves.
        custom?null:h('span',{className:'fork-widget-caption'},h('span',{className:'fork-widget-glyph'},h(WidgetIcon,{name:item.sourceOnly?'message':'widget'})),h('strong',null,caption),
            attention?h('span',{className:'fork-widget-attention'+(count?'':' is-dot'),role:'status','aria-label':attention},count?(count>99?'99+':String(count)):null):null),
        // A compact view is read through the host cover (tap opens), so its frame takes no focus or pointer of its own.
        h('div',{className:'fork-widget-panel-body',style:{display:custom?'block':'none',minWidth:p.bounds.width,height:p.bounds.height,visibility:item.checking || p.state==='open' && item.source?.current && !item.isReady?'hidden':undefined},inert:p.suspended || p.state==='compact'?true:undefined},loaded.current&&!item.failed?h(WidgetContent,{widget}):null),
        notes.length?h('div',{className:'fork-widget-notes'},notes):null,
        grips,
        h('span',{id:hint.current,hidden:true},help));
}
// The single widget menu: an opaque galgame card at the pointer, or a bottom sheet for touch, with roving focus.
function WidgetContextMenu({item,owner,request,layer,onClose}) {
    const h=React.createElement,list=React.useRef(null),armed=React.useRef(false),[at,setAt]=React.useState(null),entries=stageWidgetMenuEntries(item,owner);
    React.useLayoutEffect(()=>{
        const frame=layer.current?.getBoundingClientRect(),box=list.current?.getBoundingClientRect();
        if (!frame || !box) return;
        if (request.touch) {setAt({});return;}
        const x=Math.max(8,Math.min(request.x,window.innerWidth-box.width-8)),y=request.y+box.height+8>window.innerHeight ? Math.max(8,request.y-box.height) : request.y;
        // Stage units: a docked stage is only scaled (createModStageDock).
        const k=frame.width>0 && Math.abs(frame.width-layer.current.offsetWidth)>=1 ? layer.current.offsetWidth/frame.width : 1;
        setAt({left:(x-frame.left)*k,top:(y-frame.top)*k});
    },[request]);
    React.useEffect(()=>{if (at) list.current?.querySelector('[role^=menuitem]')?.focus({preventScroll:true});},[at]);
    React.useEffect(()=>{const away=()=>{if(!disposed)onClose(false);};window.addEventListener('blur',away);window.addEventListener('resize',away);return()=>{window.removeEventListener('blur',away);window.removeEventListener('resize',away);};},[request]);
    const keys=event=>{
        event.stopPropagation();
        const rows=[...list.current.querySelectorAll('[role^=menuitem]')],index=rows.indexOf(document.activeElement);
        const go=next=>{event.preventDefault();rows[(next+rows.length)%rows.length]?.focus();};
        if (['Escape','Tab','ContextMenu'].includes(event.key) || event.key==='F10' && event.shiftKey) {event.preventDefault();onClose(true);}
        else if (event.key==='ArrowDown') go(index+1);
        else if (event.key==='ArrowUp') go(index-1);
        else if (event.key==='Home') go(0);
        else if (event.key==='End') go(rows.length-1);
    };
    // Releasing the long-press that opened the menu can land a click on the veil or a row under the finger; only a press
    // that started inside the menu layer (or a keyboard click, detail 0) acts.
    const arm=event=>{event.stopPropagation();armed.current=true;};
    const run=(event,entry)=>{
        if (event.detail && !armed.current) return;
        onClose(entry.type==='pin' || entry.type==='reset');
        if (entry.type==='reset') owner.place(item.key,null,null);else owner.action(item.key,entry.type);
    };
    return h(React.Fragment,null,
        h('div',{className:'fork-widget-context-veil'+(request.touch?' is-dim':''),'aria-hidden':true,onPointerDown:arm,onClick:()=>{if (armed.current) onClose(false);},onContextMenu:()=>onClose(false)}),
        h('div',{ref:list,role:'menu','aria-label':item.definition.title,className:'fork-widget-context'+(request.touch?' is-sheet':''),style:at || {visibility:'hidden'},onKeyDown:keys,onPointerDown:arm},
            request.touch?h('i',{className:'fork-widget-context-grab','aria-hidden':true}):null,
            entries.map(entry=>h('button',{key:entry.type,type:'button',tabIndex:-1,role:entry.type==='pin'?'menuitemcheckbox':'menuitem','aria-checked':entry.type==='pin'?String(Boolean(entry.checked)):undefined,
                className:'fork-widget-context-row'+(entry.parted?' is-parted':''),onClick:event=>run(event,entry)},
                h(WidgetIcon,{name:entry.icon}),h('span',null,entry.label,entry.hint?h('small',null,entry.hint):null),
                entry.type==='pin'?h('i',{className:'fork-widget-context-check','aria-hidden':true}):null))));
}
// the top-right mod launcher is one HUD icon button, the
// same 30px glyph as 弹幕 / 电影模式 (no label, no count - R4). One mod: the button IS that mod (its glyph and name) and
// opens / collapses it directly. Several: a grid glyph opening one flat stage menu, the 弹幕 menu's sheet (one opaque
// surface, rows with a hover fill, no inner boxes). Unread / changed mods put an accent dot on the button.
function WidgetMenu({owner}) {
    const h=React.createElement,[open,setOpen]=React.useState(false),[left,setLeft]=React.useState(null),trigger=React.useRef(null),list=React.useRef(null);
    const items=owner.paused?[]:owner.items,single=items.length===1?items[0]:null,shown=open && items.length>1;
    const glyph=item=>item?.ref?.modId==='dsh.phone'?'phone':item?.sourceOnly?'message':'widget';
    const sfx=name=>{if (typeof forkUiSfx==='object' && forkUiSfx) forkUiSfx.play(name);};
    const close=refocus=>{if(disposed)return;sfx('close');setOpen(false);if (refocus) trigger.current?.focus({preventScroll:true});};
    const launch=item=>{if(disposed)return;trigger.current?.focus({preventScroll:true});owner.action(item.key,item.requestedState==='open' && item.presentation.state!=='open'?'sheet':'open');};
    // Right-aligned under the button, kept inside the stage (a 375px top bar has the button left of four others).
    React.useLayoutEffect(()=>{
        if (!shown) {setLeft(null);return;}
        const anchor=trigger.current?.parentElement?.getBoundingClientRect(),button=trigger.current?.getBoundingClientRect(),width=list.current?.offsetWidth || 0;
        if (!anchor || !button) return;
        const frame=trigger.current.closest('.fork-gal-stage')?.getBoundingClientRect() || {left:0,right:window.innerWidth};
        // `width` is in stage units, the rects are on screen: a docked stage is only scaled (createModStageDock).
        const host=trigger.current.parentElement,k=anchor.width>0 && Math.abs(anchor.width-host.offsetWidth)>=1 ? host.offsetWidth/anchor.width : 1,listWidth=width/k;
        setLeft((Math.max(frame.left+8,Math.min(button.right+4-listWidth,frame.right-8-listWidth))-anchor.left)*k);
    },[shown,items.length]);
    React.useEffect(()=>{
        if (!shown) return undefined;
        // Esc closes the menu before the stage sees it (the stage opens its system menu on Esc).
        const onKey=event=>{if(disposed)return;if (event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();close(true);}};
        let timer=0;
        const swallow=event=>{event.stopPropagation();event.preventDefault();};
        const outside=event=>{
            if(disposed)return;
            if (list.current?.contains(event.target) || trigger.current?.contains(event.target)) return;
            close(false);
            // A press on the bare stage only dismisses; it does not also turn the page.
            if (!event.target?.closest?.('button, input, select, textarea, a')) {
                document.addEventListener('click',swallow,{capture:true,once:true});
                timer=setTimeout(()=>document.removeEventListener('click',swallow,true),600);
            }
        };
        window.addEventListener('keydown',onKey,true);
        document.addEventListener('pointerdown',outside,true);
        return ()=>{window.removeEventListener('keydown',onKey,true);document.removeEventListener('pointerdown',outside,true);document.removeEventListener('click',swallow,true);clearTimeout(timer);};
    },[shown]);
    // Focus the first row once the placed menu is visible (a hidden row cannot take focus).
    React.useEffect(()=>{if (shown && left!==null) list.current?.querySelector('[role=menuitem]')?.focus({preventScroll:true});},[shown,left===null]);
    // the launcher's state for the skin's menu (one mod is that mod itself).
    const counted=items.reduce((sum,item)=>sum+(item.presentation.attention.count || 0),0);
    if (typeof useStageEntryState==='function') useStageEntryState('widgets',{available:items.length>0,icon:single?glyph(single):'widget',label:single?single.definition.title:'模组',
        on:single?single.presentation.state==='open':undefined,badge:counted || (items.some(item=>item.presentation.attention.changed) ? true : 0)});
    if (!items.length) return null;
    const attention=item=>item.presentation.attention.count || item.presentation.attention.changed;
    const unread=items.some(attention);
    const dot=unread?h('span',{className:'fork-widget-attention is-dot','aria-hidden':true}):null;
    const status=item=>item.failed?'不可用':item.presentation.attention.count?Math.min(99,item.presentation.attention.count)+' 条待查看':item.presentation.attention.changed?'有更新':'';
    const keys=event=>{
        event.stopPropagation();
        if (!shown) return;
        const rows=[...list.current.querySelectorAll('[role=menuitem]')],index=rows.indexOf(document.activeElement),n=rows.length;
        const next={ArrowDown:index+1,ArrowUp:index-1,Home:0,End:n-1}[event.key];
        if (next!==undefined && n && list.current.contains(document.activeElement)) {event.preventDefault();rows[(next+n)%n].focus();}
        if (event.key==='Tab') setOpen(false);
    };
    const wrap=(...children)=>h('div',{className:'fork-widget-menu',onWheel:e=>e.stopPropagation(),onClick:e=>e.stopPropagation(),onContextMenu:e=>e.stopPropagation(),onKeyDown:keys},...children);
    if (single) {
        const isOpen=single.presentation.state==='open',name=single.definition.title,note=status(single);
        return wrap(h('button',{ref:trigger,type:'button',className:'fork-widget-menu-trigger','data-glyph':glyph(single),'aria-pressed':isOpen,'data-warn':single.failed?true:undefined,
            title:single.failed?name+'（不可用）':name,'aria-label':note?name+'，'+note:name,
            onClick:()=>isOpen?owner.action(single.key,'collapse'):launch(single)},h(WidgetIcon,{name:glyph(single)}),dot));
    }
    return wrap(
        h('button',{ref:trigger,type:'button',className:'fork-widget-menu-trigger','data-glyph':'widget','aria-haspopup':'menu','aria-expanded':shown,title:'模组','aria-label':unread?'模组，有更新':'模组',
            onKeyDown:event=>{if (event.key==='ArrowDown' && !shown) {event.preventDefault();sfx('open');setOpen(true);}},
            onClick:()=>{sfx(shown?'close':'open');setOpen(!shown);}},h(WidgetIcon,{name:'widget'}),dot),
        shown?h('div',{ref:list,className:'fork-widget-menu-list',role:'menu','aria-label':'模组',style:left===null?{visibility:'hidden'}:{left,right:'auto'}},items.map(item=>{
            const count=item.presentation.attention.count,note=status(item);
            return h('button',{key:item.key,type:'button',role:'menuitem',tabIndex:-1,'data-state':item.presentation.state,'aria-label':note?item.definition.title+'，'+note:undefined,
                onClick:()=>{sfx('confirm');setOpen(false);launch(item);}},
                h(WidgetIcon,{name:glyph(item)}),h('span',null,item.definition.title),
                item.failed?h('span',{className:'fork-widget-menu-warn','aria-hidden':true},h(WidgetIcon,{name:'warning'}),'不可用')
                    :count?h('span',{className:'fork-widget-attention','aria-hidden':true},count>99?'99+':String(count))
                    :item.presentation.attention.changed?h('span',{className:'fork-widget-attention is-dot','aria-hidden':true}):null);})):null);
}
function GalWidgets({owner,onBacklog,onAdvance,onWheel}) {
    const h=React.createElement,[request,setRequest]=React.useState(null),layer=React.useRef(null);
    const target=request && !owner.paused ? owner.items.find(item=>item.key===request.key && item.presentation.state!=='hidden') : null;
    React.useEffect(()=>{if (request && !target) setRequest(null);},[request,target]);
    const close=refocus=>{if(disposed)return;const panel=request?.panel;setRequest(null);if (refocus && panel?.isConnected) panel.focus({preventScroll:true});};
    const reading=!owner.paused && owner.items.some(item=>item.presentation.surface==='sheet' && item.presentation.state==='open');
    return h('div',{ref:layer,onClick:event=>{event.stopPropagation();if(event.target===event.currentTarget && !target)onAdvance?.();},onWheel:event=>{event.stopPropagation();if(!target)onWheel?.(event);},onContextMenu:event=>{event.preventDefault();event.stopPropagation();},
        // while the phone is adjusted its layer rises over the dialogue box, so the corner
        // handle and a phone dragged over the box stay in reach; a phone the reader placed stays over the box once locked
        //, only the default spot keeps it under.
        className:'fork-widget-layer'+(reading?' is-reading':'')+(target?' has-menu':'')+(!owner.paused && owner.items.some(item=>item.unlocked || item.phoneBase && item.placed)?' is-adjusting':''),'aria-label':'剧情模组'},
        owner.items.map(item=>h(getWidgetBoundary(),{key:item.identity,onError:()=>owner.onFailure(item.identity)},h(WidgetPanel,{item,owner,onBacklog,onAdvance,onWheel,onMenu:setRequest}))),
        target?h(WidgetContextMenu,{item:target,owner,request,layer,onClose:close}):null);
}

// the mod launcher is one registered stage entry.
const unregister=stageEntries?.register({id:'widgets',priority:90,group:'feature',icon:'widget',label:'模组',render:ctx=>React.createElement(WidgetMenu,{owner:ctx.widgets})});

return {Widgets:GalWidgets, Card:WidgetCard, boundary:getWidgetBoundary, count:stageWidgetCount, menuEntries:stageWidgetMenuEntries, dispose(){
    if(disposed)return;disposed=true;
    const errors=[];
    for(const cleanup of [...cleanups,()=>unregister?.(),...[...timers.keys()].map(id=>()=>clearTimeout(id)),...[...frames.keys()].map(id=>()=>cancelAnimationFrame(id))]){
        try{cleanup();}catch(error){errors.push(error);}
    }
    if(errors.length)throw new AggregateError(errors,'Stage widget cleanup failed');
}};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageWidgets};
