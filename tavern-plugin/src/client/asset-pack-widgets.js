// Generic widgets of the asset-pack UI (included inside createAssetPackUI; shares h, Button, Glyph, Help, Modal, Actions, TopLayer,
// canPortal, errorText, useOverlay). Popover / MenuItem / ConfirmDialog / StageSection / SwitchRow / HintLine / cellMenuTrigger are used
// by the core pack pages and by the stage package pages (asset-pack-{gen,card,engine}-ui.js, mod-manager.js), which receive them
// through createStageAssetPackViews (stageScope.names). Moved verbatim from asset-pack-card-ui.js.
// which first-level sections are folded, in the
// panel's localStorage UI preferences: {[section title]: true (folded) | false (open)}; a missing entry is the default.
const STAGE_FOLD_KEY='dsh-tavern:stage-panel-folded';
function stageFoldRead() { try { const value=JSON.parse(localStorage.getItem(STAGE_FOLD_KEY)||'{}'); return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch(_) { return {}; } }
function useStageFold(key,fallback=false) {
  const [folded,setState]=React.useState(()=>{const stored=stageFoldRead()[key];return typeof stored==='boolean'?stored:fallback;});
  const set=value=>{setState(value);try{localStorage.setItem(STAGE_FOLD_KEY,JSON.stringify({...stageFoldRead(),[key]:!!value}));}catch(_){}};
  return [folded,set];
}
const STAGE_REQUIRES={dialogue:[],voice:['dialogue'],stage:['dialogue']};
const STAGE_NAMES={dialogue:'舞台',voice:'配音',stage:'舞台'};
function stageMissing(key,active) { return [...new Set([...STAGE_REQUIRES[key],key].filter(k=>!active[k]).map(k=>k==='dialogue'?'stage':k))]; }
// Section with the 「需要… · 去开启」 shortcut; a blocked body stays visible but inert. `help` is a 「?」 beside the title.
// `aside` (optional) is a node between the title and the action, for a section that lays its head out as a table (提示词).
// the title (with its count and a quiet chevron) is a button that folds the
// section; the 「?」 and the head's actions stay outside it and never fold. Expanded by default; `reveal` (e.g. 素材包 while
// managing or exporting) unfolds it. The folded state is remembered per section (useStageFold).
// `onFold(folded)` (optional) hears the heading's toggle; `focusToggle` focuses it on mount (a section that swaps its body
// in when opened, 提示词, keeps the focus on its heading).
function StageSection({title,meta,help,need,active,onEnable,children,className,action,aside,foldKey,reveal,level=1,defaultFolded=false,lead,onFold,focusToggle=false}) {
  const missing=need?stageMissing(need,active):[],blocked=missing.length>0;
  const [folded,setFolded]=useStageFold(foldKey||title,defaultFolded),bodyId=React.useId(),toggleRef=React.useRef(null);
  React.useEffect(()=>{if(reveal&&folded)setFolded(false);},[reveal]);
  React.useEffect(()=>{if(focusToggle)toggleRef.current?.focus?.({preventScroll:true});},[]);
  return h('section',{className:'ap-section'+(className?' '+className:''),'data-blocked':blocked||undefined,'data-folded':folded||undefined,'data-level':level},
    // title → count → 「?」, the 「?」 always last.
    h('header',{className:'ap-section-head'},lead,h(level===2?'h4':'h3',null,
        h('button',{type:'button',className:'ap-section-toggle','aria-expanded':!folded,'aria-controls':bodyId,ref:toggleRef,onClick:()=>{setFolded(!folded);onFold?.(!folded);}},
          h('span',{className:'ap-section-title'},title),meta!==undefined&&!blocked&&h('span',{className:'ap-section-meta'},meta),
          h('span',{className:'ap-section-chevron','aria-hidden':true},h(Glyph,{name:'chevDown'}))),
        help&&h(Help,{text:help,label:title+' 说明'})),
      !blocked&&aside||null,
      blocked?h('span',{className:'ap-need'},'需要'+STAGE_NAMES[need],' · ',h(Button,{className:'ap-inline-link',onClick:()=>onEnable(need)},'去开启')):action||null),
    // one section that fails to render shows its own ⚠ + 重试; the rest of the page keeps working.
    h('div',{className:'ap-section-body',id:bodyId,hidden:folded||undefined,inert:blocked||undefined},h(PanelBoundary,{name:foldKey||(typeof title==='string'?title:'section')},children)));
}
// Icon + short name + switch. No subtitle: a dependent switch is disabled and greyed while its upstream switch is
// off, and only then carries a 「?」 naming what it needs. `help` is an optional 「?」 for a truly unclear name.
// `ariaLabel` (optional) is a longer accessible name that still contains the visible label (「配音」 → 「为这个角色配音」).
// `status` is a compact HintLine shown on the row, between the name and the switch (no line under the row).
// a row with a detail page (`onOpen(rowElement)`, its 「›」 in `status`) opens
// it from anywhere but the switch — icon, name, empty space, ⚠; only the switch toggles (Space). The 「›」 is the keyboard
// route (Enter) and its focus ring is drawn around the row. A row without a page keeps the whole-row <label> toggle.
function SwitchRow({label,ariaLabel,icon,help,checked,disabled,onChange,status,onOpen}) {
  // The switch comes first in the DOM (CSS order puts it on the right) so the label's control is the switch, not the 「?」.
  const toggle=h(Switch,{bare:true,label:ariaLabel||label,checked,disabled,onChange}); // the one switch (inline-field.js)
  const name=h('span',{className:'ap-switch-name'},icon&&h(Glyph,{name:icon}),h('span',null,label),help&&h(Help,{text:help,label:label+' 说明'}));
  // no state tag beside the switch — the switch is the state; a row that needs an
  // action adds the ⚠ chip only.
  if(!onOpen)return h('div',{className:'ap-switch-row','data-disabled':disabled||undefined},h('label',{className:'ap-switch-main'},toggle,name,status||null));
  return h('div',{className:'ap-switch-row is-openable','data-disabled':disabled||undefined,onClick:switchRowClick(onOpen)},
    h('div',{className:'ap-switch-main'},h('label',{className:'ap-switch-hit'},toggle),name,status||null));
}
// A click on an openable row that is not on one of its own controls (switch, 「›」, 「?」, chips, menus — portalled ones
// bubble through React, hence the contains check) opens the row's page.
const switchRowClick=open=>e=>{const target=e.target;
  if(!e.currentTarget.contains(target)||target.closest?.('button,a,input,label,[role=menu],[role=menuitem],[role=dialog]'))return;open(e.currentTarget);};
// A state that needs an action (not an explanation, panel-ui-design.md §一.5): a warning mark + one link chip, never a
// grey note. Compact (on a switch row): the state is only the mark's tooltip / accessible name and the chip's
// accessible name; standalone: the short state stays beside the mark in normal ink.
function HintLine({text,action,onAction,compact}) {
  const chip=action&&h(Button,{className:'ap-hint-chip',...(compact?{'aria-label':action+'（'+text+'）',title:text}:{}),onClick:onAction},action);
  if(compact)return h('span',{className:'ap-hint-line is-compact'},h('span',{className:'ap-hint-mark',role:'img','aria-label':text,title:text},h(Glyph,{name:'warning'})),chip);
  return h('p',{className:'ap-hint-line'},h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),h('span',null,text),chip);
}
// Small anchored menu / popover; closes on outside pointer or Escape.
// packs-v3: inside a dialog the menu stays anchored in place (the dialog already sits in the top layer). Elsewhere (a
// panel row's state tag) it floats in the top layer, placed against the window: under the trigger, or above it when
// the window has more room there, kept inside the window edges. A short or clipped panel (the bottom dock) never cuts it.
// `fit` (a select-like trigger): the menu starts at the trigger's left edge and is at least as wide as the trigger;
// `limit` is the tallest the menu grows before it scrolls.
function popoverPlace(anchor,size,view,fit=false) {
  const gap=4,edge=8,below=view.height-anchor.bottom-gap-edge,above=anchor.top-gap-edge,up=size.height>below&&above>below;
  const maxHeight=Math.max(0,Math.floor(up?above:below)),height=Math.min(size.height,maxHeight),width=fit?Math.max(size.width,anchor.width):size.width;
  const top=up?Math.max(edge,anchor.top-gap-height):Math.max(edge,Math.min(anchor.bottom+gap,view.height-edge-height));
  const left=Math.max(edge,Math.min(fit?anchor.left:anchor.right-width,view.width-edge-width));
  return {top:Math.round(top),left:Math.round(left),maxHeight,up,...(fit?{minWidth:Math.round(Math.min(anchor.width,view.width-2*edge))}:{})};
}
// `stopClicks`: clicks on the trigger or in the menu (portalled menus bubble through React) stay inside the anchor, so a
// clickable row around it (PackRow) never also acts.
// `float` lets a menu inside a dialog float too — a 差分 tile's menu is wider than its tile and
// would be clipped by the scrolling figure column.
function Popover({label,trigger,className,content,fit=false,limit=320,stopClicks=false,float=false}) {
  const [open,setOpen]=React.useState(false),[floating,setFloating]=React.useState(false),[place,setPlace]=React.useState(null),root=React.useRef(null),menu=React.useRef(null);
  const close=()=>{setOpen(false);setPlace(null);};
  const toggle=()=>{if(open){close();return;}setFloating(canPortal()&&(float||!root.current?.closest?.('.ap-modal')));setOpen(true);};
  // outside press / Esc through the shared popup stack — only the topmost popup closes.
  useOverlay(open,()=>[root.current,menu.current],reason=>{close();if(reason==='escape')root.current?.querySelector?.('button')?.focus?.();});
  // packs-v3: a menu opened near the bottom of a scrolling modal scrolls itself into view instead of being clipped.
  React.useEffect(()=>{if(open&&!floating)root.current?.querySelector?.('.ap-popover')?.scrollIntoView?.({block:'nearest'});},[open,floating]);
  React.useLayoutEffect(()=>{
    if(!open||!floating||typeof window==='undefined')return;
    const update=()=>{const anchor=root.current?.getBoundingClientRect?.(),node=menu.current;if(!anchor||!node)return;
      const next=popoverPlace(anchor,{width:node.offsetWidth,height:Math.min(limit,Math.max(node.offsetHeight,node.scrollHeight))},{width:window.innerWidth,height:window.innerHeight},fit);
      setPlace(p=>p&&p.top===next.top&&p.left===next.left&&p.maxHeight===next.maxHeight&&p.minWidth===next.minWidth?p:next);};
    update();window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
    return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
  },[open,floating]);
  // Keyboard users land on the menu (it is no longer next to the trigger in the document): its search box, else the
  // checked item, else the first one. only once the menu is placed — until then it is
  // visibility:hidden and cannot take focus.
  const placed=!!place;
  React.useEffect(()=>{
    if(!open||!floating||!placed)return;
    const first=['input[type=search]','[aria-checked="true"]','button:not(:disabled),input'].reduce((found,selector)=>found||menu.current?.querySelector?.(selector),null);first?.focus?.({preventScroll:true});
  },[open,floating,placed]);
  const items=open&&content(close);
  const popover=open&&(floating?h(TopLayer,null,h('div',{className:'ap-popover-anchor is-floating'+(className?' '+className:'')},
      h('div',{ref:menu,className:'ap-popover is-floating','data-placement':place?.up?'top':'bottom',role:'menu','aria-label':label,
        style:place?{top:place.top+'px',left:place.left+'px',maxHeight:Math.min(limit,place.maxHeight)+'px',...(place.minWidth?{minWidth:place.minWidth+'px'}:{})}:{top:'0px',left:'0px',visibility:'hidden'}},items))):
    h('div',{className:'ap-popover',role:'menu','aria-label':label},items));
  return h('div',{className:'ap-popover-anchor'+(className?' '+className:''),ref:root,onClick:stopClicks?e=>e.stopPropagation():undefined,onKeyDown:e=>{if(e.key==='Escape'&&open){e.stopPropagation();close();root.current?.querySelector?.('button')?.focus?.();}}},
    trigger({open,toggle}),popover);
}
// the trigger of a picture cell's own menu (R9: 立绘 / 头像 差分 tiles,
// the 服装设定图 cell) — one implementation for every such grid. Touch (a coarse pointer): a tap opens the menu, as before.
// Mouse / keyboard (a fine pointer): click or Enter does the cell's primary thing (`onPrimary`: select / view), and the
// menu opens on right click, Shift+F10 or the context-menu key (aria-keyshortcuts); a cell without a primary thing opens
// its menu on click. The input is told by the click's own pointerType, else by (pointer: coarse) — never by width.
// `onMenu` runs whenever the menu is opened (the 差分 tile also selects itself then).
function cellTouchInput(event) {
  const type=event?.nativeEvent?.pointerType||event?.pointerType;
  if(type)return type==='touch';
  return typeof window!=='undefined'&&!!window.matchMedia?.('(pointer: coarse)')?.matches;
}
function cellMenuTrigger({open,toggle,onPrimary=null,onMenu=null}) {
  const show=()=>{onMenu?.();if(!open)toggle();};
  return {'aria-haspopup':'menu','aria-expanded':open,'aria-keyshortcuts':'Shift+F10 ContextMenu',
    onClick:event=>{if(!onPrimary||cellTouchInput(event)){onMenu?.();toggle();return;}if(open)toggle();onPrimary();},
    onContextMenu:event=>{event?.preventDefault?.();show();},
    onKeyDown:event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();show();}}};
}
function MenuItem({onClick,disabled,title,danger,children}) { return h('button',{type:'button',role:'menuitem',className:'ap-menu-item'+(danger?' is-danger':''),disabled,title,onClick},children); }
function ConfirmDialog({title,body,extra,confirmLabel,danger,onConfirm,onClose,children}) {
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[uncertain,setUncertain]=React.useState(false);
  async function run(){setBusy(true);setError('');let timer;
    // A pack write can outlive its response. Stop waiting, not the transaction; never offer a blind retry.
    try{await Promise.race([Promise.resolve().then(onConfirm),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('操作超时：素材包服务未及时返回，结果尚未确认；请关闭此提示并重新打开素材包检查，勿重复删除。'),{code:'CONFIRM_TIMEOUT'})),8000);})]);onClose();}
    catch(e){setError(errorText(e));setUncertain(e?.code==='CONFIRM_TIMEOUT');setBusy(false);}finally{clearTimeout(timer);}}
  return h(Modal,{title,onClose,busy,closable:false,className:'ap-confirm'},
    h('p',null,body),extra&&h('p',{className:'ap-confirm-extra'},extra),children,
    error&&h('p',{className:'ap-alert',role:'alert'},error),
    h(Actions,null,busy&&h('span',{className:'ap-busy'},h(Spinner),'正在处理…'),h(Button,{disabled:busy,onClick:onClose},uncertain?'关闭并检查':'取消'),h(Button,{className:danger?'ap-danger-text':'',disabled:busy||uncertain,onClick:run},confirmLabel)));
}
