// CG is an ordered image draft, not a top-level media entry.
// CG hides all stage figures; composition focus stays independent.
const CG_VARIANTS_MAX=16,CG_FOCUS_MAX=8;
const CG_IMAGE_TYPES='image/png,image/webp,image/jpeg';
const CG_VARIANT_HELP='同一张 CG 的几张差分图，导演按动作描述切换，带「默认」的那张最先显示。';
const CG_FOCUS_HELP='导演可以把镜头移到这些位置；在预览上点选或拖动取景框，滚轮、双指或拖右下角缩放，虚线框是对白框。';
// the reference stages of the check (电脑 / 手机) and their dialogue box
// (.fork-gal-box: bottom clamp(10px, 2.4vh, 24px), min-height clamp(120px, 22%, 190px), width min(94%, 980px)).
const CG_VIEWS={pc:{width:1600,height:900},phone:{width:375,height:812}},CG_FULL={x:0.5,y:0.5,zoom:1};
const cgClamp=(v,min,max)=>Math.min(max,Math.max(min,v)),cgRound=(v,n)=>Number(v.toFixed(n));
function cgTextbox(view) {
  const bottom=cgClamp(0.024*view.height,10,24),height=cgClamp(0.22*view.height,120,190),width=Math.min(0.94*view.width,980);
  return {x:(view.width-width)/2/view.width,y:(view.height-bottom-height)/view.height,w:width/view.width,h:height/view.height};
}
// The image inside the 16:9 preview (contain), and a part of the image clipped to it (null when nothing is left).
function cgContain(size) { const a=size.w/size.h,box=16/9; return a>box?{x:0,y:(1-box/a)/2,w:1,h:box/a}:{x:(1-a/box)/2,y:0,w:a/box,h:1}; }
function cgClip(r) { const x=Math.max(0,r.x),y=Math.max(0,r.y),right=Math.min(1,r.x+r.w),bottom=Math.min(1,r.y+r.h); return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null; }
// A focus as the view will really show it (cgTransform clamps the center at the image edges): stored like that, a drag
// past an edge has no dead zone. x / y to 0.001, zoom 1–3 to 0.01.
function cgSettle(view,size,focus) {
  const zoom=cgRound(cgClamp(Number(focus.zoom)||1,1,3),2),win=cgWindow(view,{width:size.w,height:size.h},{...focus,zoom});
  const axis=(c,span)=>span>=1?0.5:cgClamp(c,span/2,1-span/2);
  return {x:cgRound(axis(focus.x,win.w),3),y:cgRound(axis(focus.y,win.h),3),zoom};
}
const CG_ACTION_HELP='告诉导演这张差分里人物在做什么，最多 80 字。';
async function prepareCgFiles(files) {
  const updates=new Map(),blobs={},variants=[];
  if (!files.length || files.length>CG_VARIANTS_MAX) throw new Error('CG 需要 1 到 16 张差分');
  for (const file of files) {
    const media=await prepareImage(file,'background');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',media.bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    updates.set(`media/${hash}.${media.descriptor.ext}`,media.bytes);blobs[hash]=media.descriptor;
    variants.push({id:'v'+Date.now().toString(36)+(entrySerial++).toString(36),name:[...fileStem(file.name)].slice(0,32).join(''),content:{description:[...fileStem(file.name)].slice(0,80).join(''),media:hash}});
  }
  return {updates,blobs,variants};
}
// Key-order independent comparison of the draft and the stored entry (dirty state).
const cgStable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
// One variant's picture: a not yet saved upload is shown from the draft bytes, a stored one through the media lease.
function CgArt({binding,packId,variant,files,blobs,className}) {
  const [url,setUrl]=React.useState(null),descriptor=blobs[variant.content.media];
  const bytes=descriptor&&files.get(`media/${variant.content.media}.${descriptor.ext}`);
  React.useEffect(()=>{if(!bytes||typeof URL==='undefined'){setUrl(null);return;}const value=URL.createObjectURL(new Blob([bytes],{type:descriptor.mime}));setUrl(value);return()=>URL.revokeObjectURL(value);},[bytes]);
  return url?h('span',{className},h('img',{src:url,alt:'',decoding:'async'})):h(Thumb,{binding,packId,hash:variant.content.media,label:variant.name,className});
}
// 构图 over the static preview: the dialogue box of the chosen view and, for an open 构图焦点, the part that view shows
// (the rest dimmed). Click / drag moves it, the corner handle, wheel or two fingers zoom; keys on the frame do the same.
// A gesture previews locally and writes the draft once on release.
function CgComposer({view,size,focus,onChange}) {
  const root=React.useRef(null),gesture=React.useRef(null),[live,setLive]=React.useState(null),latest=React.useRef(null);
  const shown=live||focus||CG_FULL,image={width:size.w,height:size.h},box=cgContain(size),win=cgWindow(view,image,shown);
  const frame=cgClip(win),tb=cgTextbox(view),band=cgClip({x:win.x+tb.x*win.w,y:win.y+tb.y*win.h,w:tb.w*win.w,h:tb.h*win.h});
  latest.current={view,size,focus,onChange,frame};
  const place=r=>{const pct=v=>(100*v).toFixed(3)+'%';return {left:pct(box.x+r.x*box.w),top:pct(box.y+r.y*box.h),width:pct(r.w*box.w),height:pct(r.h*box.h)};};
  const point=e=>{const r=root.current.getBoundingClientRect(),b=cgContain(latest.current.size);return {x:((e.clientX-r.left)/r.width-b.x)/b.w,y:((e.clientY-r.top)/r.height-b.y)/b.h};};
  const settle=next=>cgSettle(view,size,next);
  const preview=next=>{gesture.current.last=next;setLive(next);};
  const write=next=>{const now=latest.current.focus;if(now&&['x','y','zoom'].some(k=>next[k]!==now[k]))latest.current.onChange(next);};
  // Wheel zooms around the pointer; a listener of our own, since React's wheel listeners are passive (no preventDefault).
  React.useEffect(()=>{const node=root.current;if(!node?.addEventListener||!focus)return;
    const wheel=e=>{const {view,size,focus}=latest.current;if(!focus||!e.deltaY)return;e.preventDefault();
      const p=point(e),image={width:size.w,height:size.h},before=cgWindow(view,image,focus),zoom=cgClamp(focus.zoom*Math.exp(-e.deltaY*0.0015),1,3),after=cgWindow(view,image,{...focus,zoom});
      const toward=(p,c,a,b)=>p+(c-p)*Math.min(1,b)/Math.min(1,a);
      write(cgSettle(view,size,{zoom,x:toward(p.x,before.x+before.w/2,before.w,after.w),y:toward(p.y,before.y+before.h/2,before.h,after.h)}));};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[!!focus]);
  const down=e=>{
    if(!focus||e.button>0)return;
    e.preventDefault();root.current.setPointerCapture?.(e.pointerId);
    const g=gesture.current||(gesture.current={pointers:new Map(),last:null});g.pointers.set(e.pointerId,point(e));
    const part=e.target?.dataset?.cgPart,start=g.last||shown;
    if(g.pointers.size>=2){const [a,b]=[...g.pointers.values()];Object.assign(g,{mode:'pinch',start,distance:Math.hypot(a.x-b.x,a.y-b.y)||1});}
    else if(part==='handle')Object.assign(g,{mode:'resize',start,origin:frame});
    else {const p=point(e),next=part==='frame'?start:settle({...start,x:p.x,y:p.y});Object.assign(g,{mode:'move',start:next,origin:p});if(next!==start)preview(next);}
    e.currentTarget.querySelector?.('.ap-cg-frame')?.focus?.({preventScroll:true});
  };
  const move=e=>{
    const g=gesture.current;if(!g?.pointers.has(e.pointerId))return;
    const p=point(e);g.pointers.set(e.pointerId,p);
    if(g.mode==='pinch'){const [a,b]=[...g.pointers.values()];if(b)preview(settle({...g.start,zoom:g.start.zoom*Math.hypot(a.x-b.x,a.y-b.y)/g.distance}));}
    else if(g.mode==='move')preview(settle({...g.start,x:g.start.x+p.x-g.origin.x,y:g.start.y+p.y-g.origin.y}));
    else if(g.mode==='resize'&&g.origin){const o=g.origin,cx=o.x+o.w/2,cy=o.y+o.h/2,ratio=Math.max(Math.abs(p.x-cx)/(o.w/2),Math.abs(p.y-cy)/(o.h/2),0.01);preview(settle({...g.start,zoom:g.start.zoom/ratio}));}
  };
  const up=e=>{
    const g=gesture.current;if(!g?.pointers.delete(e.pointerId))return;
    if(g.pointers.size){const [p]=[...g.pointers.values()];Object.assign(g,{mode:'move',start:g.last||g.start,origin:p});return;}
    gesture.current=null;setLive(null);if(g.last)write(g.last);
  };
  const keys=e=>{
    const step=e.shiftKey?0.05:0.01,f=focus,map={ArrowLeft:{x:f.x-step},ArrowRight:{x:f.x+step},ArrowUp:{y:f.y-step},ArrowDown:{y:f.y+step},PageUp:{zoom:f.zoom+0.1},PageDown:{zoom:f.zoom-0.1},'+':{zoom:f.zoom+0.1},'=':{zoom:f.zoom+0.1},'-':{zoom:f.zoom-0.1}}[e.key];
    if(!map)return;e.preventDefault();e.stopPropagation();write(settle({...f,...map}));
  };
  const pct=v=>Math.round(v*100)+'%';
  return h('div',{ref:root,className:'ap-cg-compose','data-active':focus?true:undefined,onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:up,onLostPointerCapture:up},
    band&&h('span',{className:'ap-cg-safe','aria-hidden':true,style:place(band)}),
    focus&&frame&&h('span',{className:'ap-cg-frame','data-cg-part':'frame',tabIndex:0,role:'slider','aria-roledescription':'取景框','aria-label':'取景框 '+focus.label,
      'aria-valuemin':1,'aria-valuemax':3,'aria-valuenow':shown.zoom,'aria-valuetext':'水平 '+pct(shown.x)+'，垂直 '+pct(shown.y)+'，'+shown.zoom.toFixed(2)+' 倍',onKeyDown:keys,style:place(frame)},
      h('span',{className:'ap-cg-frame-zoom','aria-hidden':true},shown.zoom.toFixed(1)+'×'),
      h('span',{className:'ap-cg-frame-handle','data-cg-part':'handle','aria-hidden':true})));
}
// 预览动效: the stage's own CG consumer and painter (createCgConsumer + cgPaintFrame) on this editor's draft media,
// in the chosen view. No session, no store, no played acknowledgement; the stage's reading policy (减少动态 / 光敏保护, the
// OS setting) applies. Enter on mount, 差分 tiles cross-fade, 构图 chips pan, `exiting` plays the exit. Unmount releases
// the media leases, Blob URLs, frames and observers.
function CgMotionSurface({binding,packId,assetId,variant,focus,files,blobs,view,exiting,onExited}) {
  const stage=React.useRef(null),consumer=React.useRef(null),media=React.useRef(new Map()),generation=React.useRef(0),done=React.useRef(onExited),[failed,setFailed]=React.useState(false);
  done.current=onExited;
  (React.useLayoutEffect||React.useEffect)(()=>{
    const element=stage.current;if(!element)return;
    const reading=typeof stageReading!=='undefined'?stageReading:null,os=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
    const c=createCgConsumer({clock:forkForeground,onFrame:frame=>cgPaintFrame(element,frame)});
    const policy=()=>c.policy(cgMotionPolicy(reading?.get(),os?.matches));
    policy();const off=reading?.subscribe(policy);os?.addEventListener?.('change',policy);
    const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>c.redraw()):null;resize?.observe(element);
    consumer.current=c;
    return ()=>{generation.current++;consumer.current=null;resize?.disconnect();off?.();os?.removeEventListener?.('change',policy);c.dispose();
      for(const entry of media.current.values())entry.then(m=>m.release(),()=>{});media.current.clear();};
  },[]);
  // One decoded picture per 差分 image: a draft upload from its bytes (Blob URL), a stored one through the pack media lease.
  const resolve=hash=>{
    let entry=media.current.get(hash);if(entry)return entry;
    const descriptor=blobs[hash],bytes=descriptor&&files.get(`media/${hash}.${descriptor.ext}`);
    const lease=bytes?Promise.resolve((url=>({url,release:()=>URL.revokeObjectURL(url)}))(URL.createObjectURL(new Blob([bytes],{type:descriptor.mime})))):holdMedia(binding,packId,hash);
    entry=lease.then(async m=>{if(typeof Image==='function'){const img=new Image();img.src=m.url;await img.decode?.().catch(()=>{});}return m;});
    media.current.set(hash,entry);return entry;
  };
  const target=focus?{x:focus.x,y:focus.y,zoom:focus.zoom}:CG_FULL;
  React.useEffect(()=>{
    const c=consumer.current,token=++generation.current;if(!c)return;
    if(exiting){void c.present(null).then(()=>{if(token===generation.current)done.current?.();});return;}
    resolve(variant.content.media).then(m=>{
      if(token!==generation.current||consumer.current!==c)return;setFailed(false);
      void c.present({ref:{packId,kind:'cg',assetId},variant:variant.id,label:variant.name,media:{identity:packId+'/'+variant.content.media,url:m.url},focus:target,transition:'fade'});
    },()=>{if(token===generation.current)setFailed(true);});
  },[exiting,variant.id,variant.content.media,target.x,target.y,target.zoom]);
  return h('div',{className:'ap-cg-play'},
    h('div',{className:'ap-cg-play-box',style:{aspectRatio:view.width+' / '+view.height}},
      h('div',{ref:stage,className:'fork-cg-stage','aria-hidden':true},h('img',{draggable:false}),h('img',{draggable:false}),h('div',{className:'fork-cg-white'}))),
    failed?h('span',{className:'ap-cg-play-error',role:'alert'},'⚠ 图片载入失败'):null);
}
// The preview: the selected 差分, contained, with the composition overlay; or, while 预览动效 runs, the motion surface.
// Its tools: the view of the check (电脑 / 手机) and 预览动效 / 结束预览.
function CgPreview({binding,packId,assetId,variant,files,blobs,focus,onFocus,view,setView,playing,exiting,onPlay,onExited}) {
  const [size,setSize]=React.useState(null),stage=CG_VIEWS[view];
  // The tools sit over the preview's corner; on a phone they are a row under it (the preview is too small to cover).
  return h('div',{className:'ap-cg-preview',role:'group','aria-label':'预览：'+variant.name},
    h('div',{className:'ap-cg-hero','data-mode':playing?'play':'compose',onLoad:e=>{const img=e.target;if(!playing&&img?.naturalWidth)setSize({w:img.naturalWidth,h:img.naturalHeight});}},
      h(CgArt,{key:variant.content.media,binding,packId,variant,files,blobs,className:'ap-cg-art'}),
      playing?h(CgMotionSurface,{binding,packId,assetId,variant,focus,files,blobs,view:stage,exiting,onExited}):size&&h(CgComposer,{view:stage,size,focus,onChange:onFocus}),
      h('span',{className:'ap-cg-hero-label'},variant.name)),
    h('div',{className:'ap-cg-hero-tools'},
      h(Segmented,{label:'预览视口',value:view,onChange:setView,className:'ap-cg-view',options:[['pc','电脑'],['phone','手机']]}),
      h(IconButton,{icon:playing&&!exiting?'stop':'play',label:playing&&!exiting?'结束预览':'预览动效','aria-pressed':playing,className:'ap-icon-button ap-cg-play-toggle',onClick:onPlay})));
}
// The selected tile's ⋯ — the fork's floating menu (useInlinePopup: kept inside the window, so a tile at the grid's
// edge never clips it). 替换图片… opens a file input that stays outside the menu.
// 查看大图 of a variant — a not yet saved upload from its draft bytes.
function CgVariantView({binding,packId,variant,files,blobs,onClose}) {
  const [url,setUrl]=React.useState(null),descriptor=blobs[variant.content.media];
  const bytes=descriptor&&files.get(`media/${variant.content.media}.${descriptor.ext}`);
  React.useEffect(()=>{if(!bytes||typeof URL==='undefined'){setUrl(null);return;}const value=URL.createObjectURL(new Blob([bytes],{type:descriptor.mime}));setUrl(value);return()=>URL.revokeObjectURL(value);},[bytes]);
  return h(PackImageView,{binding,packId,hash:bytes?null:variant.content.media,src:bytes?url:null,label:variant.name,onClose});
}
function CgVariantMenu({variant,first,last,isDefault,only,disabled,onView,onDownload,onDefault,onMove,onReplace,onRemove}) {
  const pop=useInlinePopup(),input=React.useRef(null),name='差分「'+variant.name+'」操作';
  const item=(label,onClick,{off=false,title,danger=false,checked}={})=>h('button',{key:label,type:'button',role:checked===undefined?'menuitem':'menuitemcheckbox','aria-checked':checked,className:'fork-inline-option'+(danger?' is-danger':''),disabled:off,title,
    onClick:()=>{pop.close(true);onClick();}},h('span',null,label),checked?h(InlineGlyph,{name:'check'}):null);
  return h('span',{className:'ap-cg-tile-menu',ref:pop.root,onKeyDown:pop.keys},
    h('button',{ref:pop.trigger,type:'button',className:'ap-cg-tile-more','aria-haspopup':'menu','aria-expanded':pop.open,'aria-label':name,title:'操作',disabled,
      onClick:()=>pop.setOpen(!pop.open),onKeyDown:e=>{if(e.key==='ArrowDown'&&!pop.open){e.preventDefault();pop.setOpen(true);}}},h(Glyph,{name:'more'})),
    h('input',{ref:input,type:'file',accept:CG_IMAGE_TYPES,hidden:true,tabIndex:-1,'aria-label':'替换「'+variant.name+'」的图片',onChange:e=>{const list=[...(e.target.files||[])];e.target.value='';if(list.length)onReplace(list);}}),
    pop.open?pop.layer({className:'fork-inline-pop ap-cg-menu',role:'menu','aria-label':name,onKeyDown:inlineMenuKeys},
      item('查看大图',onView),item('下载',onDownload),
      item('设为默认',onDefault,{checked:isDefault,off:isDefault,title:isDefault?'出场时先显示这张':undefined}),
      item('前移',()=>onMove(-1),{off:first}),item('后移',()=>onMove(1),{off:last}),
      item('替换图片…',()=>input.current?.click?.()),
      h('span',{key:'sep',className:'ap-cg-menu-sep',role:'separator'}),
      item('删除差分',onRemove,{off:only,danger:true,title:only?'至少保留一张差分':undefined})):null);
}
// @include-protocol asset-variant-table.cjs
const cgVariantTable=draft=>draft.variants;
const cgVariantFields=table=>({variants:table});
// 差分: the thumbnail tiles, the dashed ＋, and the selected tile's inline rows.
function CgVariants({binding,pack,packId,draft,variant,files,blobs,busy,onSelect,set,update,upload,onError}) {
  const add=React.useRef(null),list=draft.variants.entries,at=list.indexOf(variant),full=list.length>=CG_VARIANTS_MAX,[big,setBig]=React.useState(false);
  const edit=action=>cgVariantFields(editAssetVariantTable(cgVariantTable(draft),{id:variant.id,...action}));
  const move=delta=>set(edit({type:'move',delta}));
  // 下载: the variant's original file — a not yet saved upload from its draft bytes.
  const download=v=>{const hash=v.content.media,pending=blobs[hash],name=draft.name+'-'+v.name;
    Promise.resolve(pending?savePictureFile(new Blob([files.get(`media/${hash}.${pending.ext}`)],{type:pending.mime}),name+'.'+pending.ext):downloadPackMedia(binding,pack,hash,name)).catch(e=>onError(errorText(e)));};
  const remove=()=>{if(list.length<2)return;const patch=edit({type:'remove'});set(patch);onSelect((patch.variants.entries[at]||patch.variants.entries[at-1]).id);};
  return h('section',{className:'ap-fe-section ap-cg-section','aria-label':'差分'},
    h('h4',{className:'ap-sub'},'差分',h('span',null,list.length),h(Help,{text:CG_VARIANT_HELP,label:'差分 说明'})),
    h('div',{className:'ap-cg-tiles',role:'list'},
      list.map((v,i)=>{const selected=v.id===variant.id,isDefault=v.id===draft.variants.default;
        return h('div',{key:v.id,role:'listitem',className:'ap-cg-tile'},
          h('button',{type:'button',className:'ap-cg-tile-pick','aria-pressed':selected,'aria-label':v.name+(isDefault?'（默认）':''),title:v.content.description||v.name,onClick:()=>onSelect(v.id)},
            h('span',{className:'ap-cg-tile-art'},h(CgArt,{binding,packId,variant:v,files,blobs,className:'ap-cg-art'}),isDefault&&h('span',{className:'ap-tile-badge',title:'默认差分：出场时先显示'},'默认')),
            h('span',{className:'ap-cg-tile-name'},v.name)),
          selected&&h(CgVariantMenu,{variant:v,first:i===0,last:i===list.length-1,isDefault,only:list.length===1,disabled:busy,onView:()=>setBig(true),onDownload:()=>download(v),
            onDefault:()=>set(edit({type:'default'})),onMove:move,onReplace:files=>upload(files,true),onRemove:remove}));}),
      !full&&h('div',{role:'listitem',className:'ap-cg-tile'},
        h('button',{type:'button',className:'ap-cg-tile-add','aria-label':'添加差分',title:'添加差分（可多选）',disabled:busy,onClick:()=>add.current?.click?.()},
          h('span',{className:'ap-cg-tile-art'},busy?h(Spinner,{key:'upload'}):h(Glyph,{name:'plus'}))),
        h('input',{ref:add,type:'file',multiple:true,accept:CG_IMAGE_TYPES,hidden:true,tabIndex:-1,'aria-label':'选择差分图片',onChange:e=>{const picked=[...(e.target.files||[])];e.target.value='';if(picked.length)upload(picked);}}))),
    big&&h(CgVariantView,{binding,packId,variant,files,blobs,onClose:()=>setBig(false)}),
    h(InlineGrid,{label:'所选差分',columns:1,className:'ap-cg-variant-fields'},
      h(InlineField,{key:'label:'+variant.id,kind:'text',label:'差分名称',value:variant.name||'',placeholder:'未填写',maxLength:32,validate:v=>v.trim()?'':'请填写差分名称',onCommit:name=>update({name})}),
      h(InlineField,{key:'action:'+variant.id,kind:'text',multiline:true,label:'动作描述',help:h(Help,{text:CG_ACTION_HELP,label:'动作描述 说明'}),value:variant.content.description||'',placeholder:'例：低头扒饭',maxLength:80,onCommit:description=>update({content:{...variant.content,description}})})));
}
// 构图焦点: 「完整图」 (the built-in full view) and one chip per focus, a dashed ＋; the open focus is edited on the preview
// (CgComposer), its name and delete below. While 预览动效 runs a chip is where the camera moves.
function CgFocusHints({draft,open,setOpen,set}) {
  const selected=assetVariantRow(draft.variants,draft.editingVariant),list=selected.content.focusHints||[],focus=list.find(f=>f.key===open);
  const save=focusHints=>set({variants:{...draft.variants,entries:draft.variants.entries.map(row=>row.id===selected.id?{...row,content:{...row.content,focusHints}}:row)}});
  const patch=(key,value)=>save(list.map(f=>f.key===open?{...f,[key]:value}:f));
  const addFocus=()=>{const key='f'+Date.now().toString(36)+(entrySerial++).toString(36);save([...list,{key,label:'焦点',x:0.5,y:0.5,zoom:1.5}]);setOpen(key);};
  const removeFocus=()=>{save(list.filter(f=>f.key!==open));setOpen(null);};
  return h('section',{className:'ap-fe-section ap-cg-section','aria-label':'构图焦点'},
    h('h4',{className:'ap-sub'},'构图焦点',h('span',null,list.length),h(Help,{text:CG_FOCUS_HELP,label:'构图焦点 说明'})),
    h('div',{className:'ap-cg-chips'},
      h('button',{key:'full',type:'button',className:'ap-cg-focus-chip','aria-pressed':!focus,onClick:()=>setOpen(null)},'完整图'),
      list.map(f=>h('button',{key:f.key,type:'button',className:'ap-cg-focus-chip','aria-pressed':f.key===open,onClick:()=>setOpen(f.key)},f.label)),
      list.length<CG_FOCUS_MAX&&h('button',{type:'button',className:'ap-cg-add-chip','aria-label':'添加焦点',title:'添加焦点',onClick:addFocus},h(Glyph,{name:'plus'}))),
    focus&&h('div',{className:'ap-cg-focus-detail',role:'group','aria-label':focus.label+'设置'},
      h(InlineGrid,{label:'焦点设置',columns:1,className:'ap-cg-focus-fields'},
        h(InlineField,{key:'name:'+focus.key,kind:'text',label:'名称',controlLabel:'构图名称',value:focus.label||'',maxLength:32,validate:v=>v.trim()?'':'请填写名称',onCommit:label=>patch('label',label)})),
      h('span',{className:'ap-cg-focus-tools'},h(IconButton,{icon:'remove',label:'删除焦点 '+focus.label,onClick:removeFocus}))));
}
// `back` ({parent, onBack}, a phone's detail): like EntryDetail, the name row carries the sub-page ‹.
// as in EntryDetail the name row leads the pane on every size, above the preview.
const cgDraft=asset=>clone(entryWithVariants(asset,entryVariantTable(asset)));
function CgEntryEditor({binding,pack,asset,save,back=null}) {
  const [draft,setDraft]=React.useState(()=>cgDraft(asset)),[revision,setRevision]=React.useState(pack.revision);
  const [files,setFiles]=React.useState(()=>new Map()),[blobs,setBlobs]=React.useState({}),[selected,setSelected]=React.useState(entryVariantTable(asset).default);
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[focusOpen,setFocusOpen]=React.useState(null);
  const [view,setView]=React.useState('pc'),[playing,setPlaying]=React.useState(false),[exiting,setExiting]=React.useState(false),pane=React.useRef(null);
  // 预览动效 is the topmost layer while it runs: Esc (or a press outside this editor) plays the exit first.
  const endPlay=()=>{setPlaying(false);setExiting(false);};
  const stopPlay=()=>{if(exiting)endPlay();else setExiting(true);};
  useOverlay(playing,()=>[pane.current],()=>stopPlay());
  const set=patch=>setDraft(old=>({...old,...patch})),table=cgVariantTable(draft),row=assetVariantRow(table,selected)||assetVariantRow(table);
  const variant=row;
  const update=patch=>setDraft(old=>({...old,variants:{...old.variants,entries:old.variants.entries.map(v=>v.id===variant.id?{...v,...patch}:v)}}));
  const dirty=files.size>0||cgStable(draft)!==cgStable(cgDraft(asset));
  // A clean editor follows the stored entry (another surface, or this editor's own save); a dirty one keeps its draft.
  const seen=React.useRef(asset);
  React.useEffect(()=>{if(seen.current===asset)return;const was=seen.current;seen.current=asset;if(!files.size&&cgStable(draft)===cgStable(cgDraft(was))){setDraft(cgDraft(asset));setRevision(pack.revision);}},[asset]);
  async function upload(list,replace=false) {
    setBusy(true);setError('');
    try {
      if(!replace&&draft.variants.entries.length+list.length>CG_VARIANTS_MAX)throw new Error('差分最多 16 张');
      const prepared=await prepareCgFiles(replace?list.slice(0,1):list);
      setFiles(old=>new Map([...old,...prepared.updates]));setBlobs(old=>({...old,...prepared.blobs}));
      setDraft(current=>({...current,variants:{...current.variants,entries:replace?current.variants.entries.map(v=>v.id===variant.id?{...v,content:{...v.content,media:prepared.variants[0].content.media}}:v):[...current.variants.entries,...prepared.variants]}}));
      if(!replace)setSelected(prepared.variants[0].id);
    } catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  const discard=()=>{setDraft(cgDraft(asset));setRevision(pack.revision);setFiles(new Map());setBlobs({});setError('');if(!entryVariantTable(asset).entries.some(v=>v.id===selected))setSelected(entryVariantTable(asset).default);};
  const commit=async()=>{setBusy(true);setError('');try{const result=await save(draft,revision,files,blobs);setRevision(result.snapshot.revision);setFiles(new Map());setBlobs({});}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  const focus=(variant.content.focusHints||[]).find(f=>f.key===focusOpen)||null;
  const help=(label,text)=>h(Help,{text,label:label+' 说明'});
  const keywordSuggest=React.useMemo(()=>entryWordCandidates(pack,'cg',a=>a.recall?.keywords),[pack]);
  const title=h('div',{className:'ap-detail-title'+(back?' ap-subhead':'')},back&&h(SubpageBack,back),
    h(CommitInput,{className:'ap-title-input','aria-label':'名称',value:draft.name,validate:v=>!v.trim()?'名称不能为空':chars(v)>256?'名称最多 256 字':'',onCommit:v=>set({name:v.trim()})}));
  const setFocus=next=>setDraft(old=>({...old,variants:{...old.variants,entries:old.variants.entries.map(row=>row.id===variant.id?{...row,content:{...row.content,focusHints:(row.content.focusHints||[]).map(f=>f.key===focusOpen?{...f,...next}:f)}}:row)}}));
  return h('div',{ref:pane,className:'ap-detail-pane ap-cg-editor','data-disabled':draft.enabled===false||undefined},title,h(ErrorBox,{error}),
    h(CgPreview,{binding,packId:pack.manifest.id,assetId:asset.id,variant,files,blobs,focus,onFocus:setFocus,view,setView,playing,exiting,
      onPlay:()=>{if(!playing){setExiting(false);setPlaying(true);}else stopPlay();},onExited:endPlay}),
    // 启用 is part of 触发策略 (蓝灯 / 绿灯 / 关闭); the separate 启用 switch is gone.
    h(InlineGrid,{label:draft.name+' 设置',columns:1,className:'ap-entry-fields'},
      h(InlineRow,{label:'触发策略',help:help('触发策略',LAMP_HELP+' 关闭：这张 CG 不再用于舞台。')},h(LampMenu,{mode:entryLamp(draft,false),named:true,label:'触发策略',onChange:mode=>setDraft(current=>setEntryLamp(current,mode))})),
      h(InlineField,{kind:'chips',label:'触发词',hideEmpty:true,help:help('触发词','名称本身也算触发词。最多 16 个，每个 2–40 字。'),value:draft.recall.keywords,split:splitKeywords,validate:keywordProblem,suggest:keywordSuggest,onCommit:keywords=>setDraft(current=>applyEntryFields(current,{recall:{keywords},top:{}}))}),
      // 详情 is the inline multi-line field of the audio editors; it fills the draft on Enter / blur.
      // 导演说明 (was 详情), then the owner's 备注 (`remark`, never sent) in the same draft.
      h(InlineField,{kind:'text',multiline:true,label:'导演说明',className:'ap-note-field',hideEmpty:true,help:help('导演说明','会和名称一起发给导演，用来判断什么时候展示这张 CG。只写适用情景，最多 300 字。'),placeholder:'适用情景',value:draft.directorNote||'',
        validate:v=>chars(v)>300?'导演说明最多 300 字':'',onCommit:directorNote=>set({directorNote})}),
      remarkField({value:draft.remark,onCommit:v=>setDraft(current=>withRemark(current,v))})),
      // no 优先级 — nothing ordered by it; removed with the field itself.
    h(CgVariants,{binding,pack,packId:pack.manifest.id,draft,variant,files,blobs,busy,onSelect:setSelected,set,update,upload,onError:setError}),
    h(CgFocusHints,{draft:{...draft,editingVariant:variant.id},open:focusOpen,setOpen:setFocusOpen,set}),
    // Sticky while there is something to save (the engine settings page's foot); nothing when the draft is clean.
    dirty&&h('div',{className:'ap-cg-savebar'},h('span',{className:'ap-save-state',role:'status','data-state':'dirty'},'有未保存的修改'),
      h(Button,{disabled:busy,onClick:discard},'放弃修改'),h(Button,{primary:true,disabled:busy,onClick:commit},busy?'正在保存…':'保存')));
}
