// 开场画面, an advanced 舞台设置 section. Greetings are not AI
// replies, so the director never stages them: each greeting shows its own opening scene here, or the default the
// host derives (theme gradient, bound pack's first music, nobody on stage).
const OPENING_TIMES=[[null,'自动'],['day','白天'],['dusk','黄昏'],['night','夜晚']];
glyphs.forward='M6 3.5 10.5 8 6 12.5';
// Pickable assets: bound packs and globally enabled ones. the picker groups
// list 全局 packs first, then 本卡 packs (display order only; the scene stores explicit refs).
function openingAssets(ctx,kind) {
  const global=ctx.binding.globalEnabledPackIds||[],ids=globalFirst([...new Set([...ctx.ext.assetBindings.boundPackIds,...global])],global);
  // the lit packs' full documents (ctx.packs are list summaries).
  return ids.map(id=>ctx.writer.pack(id)).filter(Boolean)
    .map(pack=>({pack,assets:pack.manifest.assets.filter(a=>a.kind===kind&&a.enabled)})).filter(group=>group.assets.length);
}
// @include-protocol stage-time-params.cjs
// Preview uses the stage's global time palette, independent of recalled mood looks.
function openingTimeLook(ctx,timeOfDay) {
  const dims=ctx.engine?.values?.dimensions||{};
  if(!timeOfDay||dims.lighting===false||dims['lighting.time']===false)return null;
  return {params:CORE_TIME_PARAMS[timeOfDay]||CORE_TIME_PARAMS.day};
}
function openingPreview(ctx,background,timeOfDay) {
  const pack=background&&ctx.writer.pack(background.packId),asset=pack?.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id===background.assetId);
  if(!asset)return {asset:null,hash:null,grade:null};
  const time=timeOfDay||null,selected=asset.variants&&(assetVariantRow(asset.variants,time)||assetVariantRow(asset.variants));
  const matched=!!time&&selected?.id===time,look=time&&time!=='day'&&!matched?openingTimeLook(ctx,time):null;
  const grade=look&&typeof timeGrade==='function'?timeGrade({timeOfDay:time,compensateBackground:true,time:{params:look.params}}):null;
  return {asset,hash:(selected?.content||asset).media||null,grade:grade||null};
}
// the editor's pickers are the packs-v3 styled menu (Popover + menuitemradio, like 保存到 and the filter
// menu), never a native <select>. Keyboard: the trigger opens it, focus lands on the checked item, ↑/↓/Home/End move,
// Enter picks, Esc closes; focus then returns to the trigger. Long lists get the shared search box (above 8, like 复制到…).
function openingMenuKeys(event,back) {
  const items=[...event.currentTarget.querySelectorAll('[role=menuitemradio],[role=menuitem]')],at=items.indexOf(document.activeElement),typing=event.target?.tagName==='INPUT';
  const go=index=>{event.preventDefault();items[(index+items.length)%items.length]?.focus();};
  if(!items.length)return;
  if(event.key==='ArrowDown')go(at+1);
  else if(event.key==='ArrowUp')go(at<0?items.length-1:at-1);
  else if(event.key==='Home'&&!typing)go(0);
  else if(event.key==='End'&&!typing)go(items.length-1);
  else if(event.key==='Escape')back();
}
const openingMenuFocus=node=>{if(node&&typeof document!=='undefined'&&!node.contains(document.activeElement))(node.querySelector('[aria-checked="true"]')||node.querySelector('[role=menuitemradio],[role=menuitem]'))?.focus?.();};
// options: [{value,label,group?}]; value '' is 「无」. The trigger names the field and the current choice. art(option), when
// given, draws a small lazy picture before each label and in the trigger (the widget 壁纸 picker).
function OpeningPicker({label,value,options,onChange,compact,art}) {
  const trigger=React.useRef(null),[query,setQuery]=React.useState('');
  const current=options.find(o=>o.value===value)||options[0],back=()=>setTimeout(()=>trigger.current?.focus?.(),0);
  const q=query.trim().toLowerCase(),shown=q?options.filter(o=>!o.value||(o.label+' '+(o.group||'')).toLowerCase().includes(q)):options;
  const item=(o,close)=>h('button',{key:o.value||'none',type:'button',role:'menuitemradio','aria-checked':o.value===value,className:'ap-menu-item',
      onClick:()=>{close();if(o.value!==value)onChange(o.value);back();}},art&&art(o),h('span',{className:'ap-opening-menu-label'},o.label),o.value===value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})));
  const groups=[];for(const o of shown){const last=groups.at(-1);if(last&&last.name===(o.group||''))last.items.push(o);else groups.push({name:o.group||'',items:[o]});}
  // a select-like menu — floating in the top layer it starts at the trigger's left edge and is at least as
  // wide as the trigger (popoverPlace fit), never the window's width.
  return h(Popover,{label,fit:!compact,className:'ap-target-anchor ap-opening-picker'+(compact?' is-compact':'')+(art?' has-art':''),
    trigger:({toggle,open})=>h('button',{ref:trigger,type:'button',className:'ap-target-button','aria-haspopup':'menu','aria-expanded':open,'aria-label':label+'：'+(current?.label||'无'),
      onClick:()=>{setQuery('');toggle();}},art&&current&&art(current),h('span',{className:'ap-opening-picker-value'},current?.label||'无'),h(Glyph,{name:'chevDown'})),
    content:close=>h('div',{className:'ap-opening-menu',ref:openingMenuFocus,onKeyDown:e=>openingMenuKeys(e,back)},
      options.length>8&&h(PackSearchBox,{label:'搜索'+label,value:query,onChange:setQuery,className:'is-compact'}),
      groups.map((group,index)=>group.name?h('div',{key:'g'+index,role:'group','aria-label':group.name,className:'ap-opening-menu-group'},
        h('div',{className:'ap-opening-menu-head','aria-hidden':true},group.name),group.items.map(o=>item(o,close))):
        h(React.Fragment,{key:'g'+index},group.items.map(o=>item(o,close)))),
      !shown.length&&h(EmptyState,{compact:true,noun:'素材',query,onClear:()=>setQuery('')}))});
}
const openingRefKey=ref=>ref?ref.packId+'/'+ref.assetId:'';
// A scene patch replaces one greeting's entry; null removes it (back to the default).
function openingPatch(ext,id,scene) {
  const scenes={...(ext.openings?.scenes||{})};
  if(scene)scenes[id]=scene;else delete scenes[id];
  return {openings:{...(ext.openings||{}),scenes}};
}
// use the same downward appearance fallback as the runtime, never card offstage.
const openingFigureKey=ref=>ref?ref.packId+'/'+ref.figureId:'';
const openingStaged=ctx=>stageFigureRows(ctx).filter(row=>row.figure.enabled&&packAppearance(row.figure.outfits.find(o=>o.enabled),row.figure.appearance).form!=='avatar').map(row=>openingFigureKey(row.ref));
const greetingLabel=index=>index?'备选 '+index:'开场白';
// The grade is the stage's colour matrix through an SVG feColorMatrix, the way the stage's DOM layer follows its looks
// (gal-stage.js fork-gal-look-ui, galUiApplier's rounding).
function OpeningBackground({ctx,background,timeOfDay,className}) {
  const canvas=React.useRef(null),theme=typeof ctx.engine?.dialogueTheme==='string'?ctx.engine.dialogueTheme:'classic',filterId='ap-opening-grade-'+String(React.useId()).replace(/[^\w-]/g,'');
  React.useLayoutEffect(()=>{
    if(canvas.current)stagePaintEmpty(canvas.current.getContext('2d'),640,360,stageEmptyPalette(canvas.current));
  },[background,theme]);
  if(!background)return h('canvas',{ref:canvas,width:640,height:360,className:className+' fork-gal-theme-scope','data-theme':theme,role:'img','aria-label':'主题渐变背景'});
  const view=openingPreview(ctx,background,timeOfDay);
  const thumb=h(Thumb,{binding:ctx.binding,packId:background.packId,hash:view.hash||undefined,label:view.asset?.name||'',className,style:view.grade?{filter:'url(#'+filterId+')'}:undefined});
  if(!view.grade)return thumb;
  return h(React.Fragment,null,h('svg',{className:'ap-opening-grade',width:0,height:0,'aria-hidden':true,focusable:'false'},
    h('filter',{id:filterId,colorInterpolationFilters:'sRGB'},h('feColorMatrix',{type:'matrix',values:view.grade.map(v=>Math.round(v*1000)/1000).join(' ')}))),thumb);
}

// 开场设置 — what the stage opens with, as one section that opens in place. Closed, its head
// is the title and a compact summary of the current settings: 主角 (face + name), the first greeting's picture, its BGM and
// the skin; never the greeting text. Open: 主角 and 皮肤, then which greeting (开场白 / 备选 N, each marked 自定义 once it has
// its own scene) and that greeting's scene — picture, 背景, 时段, CG, 人物, BGM — every control saving at once like the rest
// of the page (使用默认 drops the greeting's own scene). The skin applies whenever bubbles are on; 主角 and the scenes need
// 舞台模式, so only that part greys out (the head names what it needs, as a blocked section does).
const openingDraft=scene=>({background:scene?.background||null,timeOfDay:scene?.timeOfDay??null,music:scene?.music||null,cast:clone(scene?.cast||[]),...(scene?.cg?{cg:clone(scene.cg)}:{})});
// a greeting without its own scene is edited from what the stage shows by default (WYSIWYG):
// theme gradient, 时段 自动, the host's default BGM and nobody on stage. Its first customisation starts from exactly that.
function openingSeed(ctx,value,scene) {
  if(!scene||scene.configured)return scene;
  return {...scene,cast:(scene.cast||[]).map(entry=>({...entry,emotion:entry.emotion||'calm'}))};
}
const openingAssetName=(ctx,ref)=>{if(!ref)return '';const pack=ctx.writer.pack(ref.packId);return pack?.manifest.assets.find(a=>a.kind===ref.kind&&a.id===ref.assetId)?.name||'';};
function OpeningSummary({ctx,value,scene}) {
  // Lead metadata is independent of the greeting's explicit onstage cast.
  const alias=value?.lead||openingStaged(ctx)[0],lead=alias&&stageFigure(ctx,alias),music=openingAssetName(ctx,scene?.music);
  return h('span',{className:'ap-opening-summary'},
    lead?.figure&&h('span',{className:'ap-opening-summary-item',title:'开场角色：'+lead.figure.name},h(StageAvatar,{ctx,alias,className:'ap-avatar is-mini'}),h('span',null,lead.figure.name)),
    scene&&h('span',{className:'ap-opening-summary-item is-picture',title:'背景：'+(openingAssetName(ctx,scene.background)||'主题渐变')},h(OpeningBackground,{ctx,background:scene.background,timeOfDay:scene.timeOfDay,className:'ap-thumb ap-opening-summary-thumb'})),
    music&&h('span',{className:'ap-opening-summary-item',title:'BGM：'+music},h(Glyph,{name:'music'}),h('span',null,music)));
}
// `embedded` — 设置向导 › 开场画面 shows this same section, always open (no fold toggle).
// v2: the wizard walks the greetings one by one — `pick` / `onPick` hold the shown greeting outside (the
// same picker still switches it) and `onGreetings` hands it the card's greetings; the title counts where the walk is.
function StageOpenings({ctx,embedded=false,pick:held,onPick,onGreetings}) {
  const data=useLoad(ctx.binding,()=>ctx.binding.rpc('getCardOpeningScenes',{path:ctx.path}),[ctx.path,ctx.writer.revision]);
  // folded by default (the summary shows), remembered like every section.
  const [folded,setFolded]=useStageFold('开场设置',true),open=embedded||!folded,setOpen=value=>setFolded(!value);
  const [own,setOwn]=React.useState(null),[drafts,setDrafts]=React.useState({}),bodyId=React.useId(),pick=onPick?held:own,setPick=onPick||setOwn;
  const value=data.value,staged=openingStaged(ctx),missing=stageMissing('stage',ctx.active),blocked=missing.length>0;
  const greetings=value?.greetings||[],index=Math.max(0,greetings.findIndex(g=>g.id===pick)),greeting=greetings[index];
  // A greeting the user edited keeps its local scene (the newest intent) until 使用默认; others show the server's scene.
  const sceneOf=g=>g&&(drafts[g.id]?{configured:true,...drafts[g.id]}:openingSeed(ctx,value,value.scenes[g.id]));
  const edit=(g,patch)=>{const next={...openingDraft(sceneOf(g)),...patch};for(const key of Object.keys(next))if(next[key]===undefined)delete next[key];setDrafts(current=>({...current,[g.id]:next}));
    return ctx.writer.write(c=>openingPatch(c,g.id,{greeting:g.key,...next}));};
  const reset=g=>{setDrafts(current=>{const next={...current};delete next[g.id];return next;});return ctx.writer.write(c=>openingPatch(c,g.id,null));};
  // each field is one 「label value」 row (InlineRow); the pickers read
  // as text with a chevron (no boxes), like InlineField's menus.
  const field=(label,control,help)=>h(InlineRow,{label,className:'ap-opening-field',help:help&&h(Help,{text:help,label:label+' 说明'})},control);
  const configured=g=>!!(drafts[g.id]||value?.scenes?.[g.id]?.configured);
  React.useEffect(()=>{if(value)onGreetings?.(value.greetings);},[value]);
  return h('section',{className:'ap-section ap-opening-section','data-open':open||undefined},
    h('header',{className:'ap-section-head ap-opening-head'},
      embedded?h('h3',{className:'ap-opening-title'},'开场设置',greetings.length>1&&h('span',{className:'ap-section-meta'},(index+1)+' / '+greetings.length)):h('h3',null,h('button',{type:'button',className:'ap-opening-toggle','aria-expanded':open,'aria-controls':bodyId,onClick:()=>setOpen(!open)},
        h('span',{className:'ap-opening-title'},'开场设置'),
        !open&&value&&h(OpeningSummary,{ctx,value,scene:greetings[0]&&sceneOf(greetings[0])}),
        h('span',{className:'ap-opening-chevron','aria-hidden':true},h(Glyph,{name:'chevDown'})))),
      open&&blocked&&h('span',{className:'ap-need'},'需要'+STAGE_NAMES.stage,' · ',h(Button,{className:'ap-inline-link',onClick:()=>ctx.enable('stage')},'去开启'))),
    open&&h('div',{className:'ap-section-body',id:bodyId},
      !value?(data.error?h(ErrorBox,{error:data.error,reload:data.reload}):h(Loading,{shape:'fields'})):h(React.Fragment,null,
        // the styled picker with each figure's face, never a native select.
        staged.length>0&&h('div',{className:'ap-section-part','data-blocked':blocked||undefined,inert:blocked||undefined},field('开场角色',h(OpeningPicker,{label:'开场角色',value:openingFigureKey(value.lead),
          options:staged.map(alias=>({value:alias,label:stageFigure(ctx,alias).figure?.name||'人物'})),art:o=>h(StageAvatar,{ctx,alias:o.value,className:'ap-avatar is-mini'}),
          onChange:alias=>{const lead=stageFigure(ctx,alias).ref;ctx.writer.write(c=>({openings:{...(c.openings||{}),lead}}));}}),'开场角色用于人物标识与模组取色，不是玩家身份，也不会自动登台；开场立绘请在下方「出场人物」中添加。')),
        h('div',{className:'ap-section-part','data-blocked':blocked||undefined,inert:blocked||undefined},
          !greetings.length?h(EmptyState,{compact:true,noun:'开场白'}):h(React.Fragment,null,
            field('编辑开场白',h('div',{className:'ap-opening-greeting'},
              h(OpeningPicker,{label:'开场白',value:greeting.id,options:greetings.map((g,i)=>({value:g.id,label:greetingLabel(i)+(configured(g)?' · 自定义':'')})),onChange:setPick}),
              h('div',{className:'ap-opening-greeting-meta'},h('p',{className:'ap-opening-line',title:greeting.preview},greeting.preview),
                configured(greeting)&&h('span',{className:'ap-opening-custom'},h(Button,{className:'ap-inline-link',onClick:()=>reset(greeting)},'使用默认')))),
              '这里只编辑所选开场白的画面，不会切换聊天正在使用的开场白；请选与聊天一致的备选，未设置的开场白使用主题渐变且不放人物。'),
            h(OpeningScene,{key:greeting.id,ctx,greeting,label:greetingLabel(index),scene:sceneOf(greeting),onEdit:patch=>edit(greeting,patch),field}))))));
}
// One greeting's scene, edited in place. `onEdit(patch)` saves the whole scene with the change.
function OpeningScene({ctx,greeting,label,scene,onEdit,field}) {
  const addTrigger=React.useRef(null),backToAdd=()=>setTimeout(()=>addTrigger.current?.focus?.(),0);
  const draft=openingDraft(scene),cast=draft.cast,staged=openingStaged(ctx);
  const name=alias=>stageFigure(ctx,alias).figure?.name||alias;
  const setCast=next=>onEdit({cast:next});
  const move=(index,delta)=>{const next=[...cast];[next[index],next[index+delta]]=[next[index+delta],next[index]];setCast(next);};
  const picker=(kind,label,value,onChange,art)=>{
    const groups=openingAssets(ctx,kind),known=value&&groups.some(g=>g.pack.manifest.id===value.packId&&g.assets.some(a=>a.id===value.assetId));
    const options=[{value:'',label:'无'},...(value&&!known?[{value:openingRefKey(value),label:'缺失的素材'}]:[]),
      ...groups.flatMap(group=>group.assets.map(a=>({value:group.pack.manifest.id+'/'+a.id,label:a.name,group:group.pack.manifest.name})))];
    return h(OpeningPicker,{label,value:openingRefKey(value),options,art,onChange:key=>{const [packId,assetId]=key.split('/');onChange(key?{packId,kind,assetId}:null);}});
  };
  const cgAsset=draft.cg&&openingAssets(ctx,'cg').flatMap(group=>group.pack.manifest.id===draft.cg.ref.packId?group.assets:[]).find(asset=>asset.id===draft.cg.ref.assetId);
  const free=staged.filter(alias=>!cast.some(entry=>openingFigureKey(entry.figure)===alias));
  // the picture is the 开场背景 row itself — a small thumbnail that opens the background
  // picker (the old 「背景 ⌄」 menu row is gone: one place per action, R13). 无 clears the background and its 时段.
  return h('div',{className:'ap-opening-scene',role:'group','aria-label':'开场画面 · '+label},
    field('开场背景',h(OpeningBackgroundField,{ctx,background:draft.background,timeOfDay:draft.timeOfDay,onPick:background=>onEdit({background,...(background?{}:{timeOfDay:null})})})),
    field('时段',h(Segmented,{label:'时段',value:draft.timeOfDay,disabled:!draft.background,onChange:timeOfDay=>onEdit({timeOfDay}),options:OPENING_TIMES})),
    // editor selection never calls the stage played acknowledgement.
    field('CG',picker('cg','CG',draft.cg?.ref,ref=>onEdit({cg:ref?{ref}:undefined}))),
    cgAsset?.variants&&field('差分',h(OpeningPicker,{label:'CG 差分',value:assetVariantRow(cgAsset.variants,draft.cg.variant)?.id,options:cgAsset.variants.entries.map(v=>({value:v.id,label:v.name})),onChange:variant=>onEdit({cg:{...draft.cg,variant}})})),
    h(InlineRow,{label:'出场人物',className:'ap-opening-field ap-opening-cast'},h('div',{className:'ap-control'},
      cast.map((entry,index)=>{const figure=stageFigure(ctx,entry.figure),outfits=(figure.figure?.outfits||[]).filter(o=>o.enabled),moods=figureEditorEmotions(figure.figure||{});
        return h('div',{key:openingFigureKey(entry.figure),className:'ap-opening-actor'},
          h(StageAvatar,{ctx,alias:entry.figure}),h('span',{className:'ap-opening-name'},name(entry.figure)),
          outfits.length>1&&h(OpeningPicker,{label:name(entry.figure)+' 服装',compact:true,value:entry.outfitKey||outfits[0].key,
            options:outfits.map(o=>({value:o.key,label:o.label||o.key})),onChange:outfitKey=>setCast(cast.map((e,i)=>i===index?{...e,outfitKey}:e))}),
          h(OpeningPicker,{label:name(entry.figure)+' 表情',compact:true,value:entry.emotion,
            options:[...(!moods.some(m=>m.id===entry.emotion)?[{value:entry.emotion,label:entry.emotion}]:[]),...moods.map(m=>({value:m.id,label:m.label}))],onChange:emotion=>setCast(cast.map((e,i)=>i===index?{...e,emotion}:e))}),
          h('span',{className:'ap-opening-moves'},
            h(IconButton,{icon:'back',label:'左移 '+name(entry.figure),disabled:index===0,onClick:()=>move(index,-1)}),
            h(IconButton,{icon:'forward',label:'右移 '+name(entry.figure),disabled:index===cast.length-1,onClick:()=>move(index,1)}),
            h(IconButton,{icon:'remove',label:'移除 '+name(entry.figure),onClick:()=>setCast(cast.filter((_,i)=>i!==index))})));}),
      free.length>0&&cast.length<3&&h(Popover,{label:'添加人物',className:'ap-target-anchor ap-opening-add',
        trigger:({toggle,open})=>h('button',{ref:addTrigger,type:'button',className:'ap-target-button is-empty','aria-haspopup':'menu','aria-expanded':open,'aria-label':'添加人物',onClick:toggle},h(Glyph,{name:'plus'}),h('span',null,'添加人物')),
        content:close=>h('div',{className:'ap-opening-menu',ref:openingMenuFocus,onKeyDown:e=>openingMenuKeys(e,backToAdd)},free.map(alias=>h('button',{key:alias,type:'button',role:'menuitem',className:'ap-menu-item',
          onClick:()=>{close();setCast([...cast,{figure:stageFigure(ctx,alias).ref,outfitKey:null,emotion:'calm'}]);backToAdd();}},h(StageAvatar,{ctx,alias,className:'ap-avatar is-mini'}),h('span',null,name(alias)))))}))),
    field('BGM',picker('music','BGM',draft.music,music=>onEdit({music}))));
}
// 开场背景 — the opening picture as one small thumbnail (its own aspect), named under it.
// A click (Enter / Space) opens OpeningBackgroundPicker; picking writes the scene's background like the old menu did.
function OpeningBackgroundField({ctx,background,timeOfDay,onPick}) {
  const [open,setOpen]=React.useState(false),name=background?(openingAssetName(ctx,{...background,kind:'backgrounds'})||'缺失的素材'):'无';
  return h(React.Fragment,null,
    h('button',{type:'button',className:'ap-opening-bg-button','aria-haspopup':'dialog','aria-expanded':open,'aria-label':'开场背景：'+name,title:'选择开场背景',onClick:()=>setOpen(true)},
      h(OpeningBackground,{ctx,background,timeOfDay,className:'ap-thumb ap-opening-stage'}),
      h('span',{className:'ap-opening-bg-name'},name)),
    open&&h(OpeningBackgroundPicker,{ctx,value:background,onPick:ref=>{setOpen(false);if(openingRefKey(ref)!==openingRefKey(background))onPick(ref);},onClose:()=>setOpen(false)}));
}
// The background picker is the 素材库's own background list (EntryItem rows: thumbnail · name · lamp, the library's search,
// lamp filter and 标签 filter), over the packs the opening can use (全局 first, one group per pack), with 「无」 on top.
// Only enabled entries are offered (the stage ignores a 关闭 one), so the lamp filter is 蓝灯 / 绿灯. A click or Enter picks.
function OpeningBackgroundPicker({ctx,value,onPick,onClose}) {
  const [query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all'),[category,setCategory]=React.useState(''),body=React.useRef(null);
  const groups=openingAssets(ctx,'backgrounds'),needle=query.trim().toLowerCase(),current=openingRefKey(value);
  // tags are full paths (several per entry) read through the one shared reader.
  const categories=[...new Set(groups.flatMap(g=>g.assets.flatMap(a=>assetTags.ancestors(a.category))))].sort((a,b)=>a.localeCompare(b,'zh-Hans-CN'));
  const inCategory=a=>assetTags.matches(a.category,category);
  const shown=groups.map(g=>({pack:g.pack,assets:g.assets.filter(a=>(filter==='all'||entryLamp(a,false)===filter)&&inCategory(a)&&entryMatches(a,'backgrounds',needle))})).filter(g=>g.assets.length);
  const filtering=!!needle||filter!=='all'||!!category,clear=()=>{setQuery('');setFilter('all');setCategory('');};
  // The current choice gets focus (and comes into view) once the dialog has placed its own focus.
  React.useEffect(()=>{const id=setTimeout(()=>{const at=body.current?.querySelector('[aria-selected=true] .ap-item-main');if(at){at.focus({preventScroll:true});at.scrollIntoView?.({block:'nearest'});}},0);return()=>clearTimeout(id);},[]);
  const filterMenu=h(Popover,{label:'筛选背景',className:'ap-filter-anchor',trigger:({toggle,open})=>h(Button,{className:'ap-icon-button','data-on':filter!=='all'||undefined,'aria-label':'筛选背景','aria-expanded':open,title:'筛选',onClick:toggle},h(Glyph,{name:'filter'})),
    content:close=>['all','constant','keyword'].map(v=>h('button',{key:v,type:'button',role:'menuitemradio','aria-checked':filter===v,className:'ap-menu-item ap-lamp-opt','data-mode':v,onClick:()=>{setFilter(v);close();}},
      h('span',{className:'ap-lamp-dot'}),h('span',{className:'ap-lamp-opt-name'},v==='all'?'全部':ENTRY_LAMPS[v]),filter===v&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
  const head=h('header',{className:'ap-pack-head'},h('h2',null,'选择开场背景'),h('span',{className:'ap-pack-head-tools'},h(IconButton,{icon:'close',label:'关闭',onClick:onClose})));
  const none=h('ul',{className:'ap-items ap-opening-bg-items',role:'listbox','aria-label':'无背景'},
    h('li',{role:'option','aria-selected':!value,className:'ap-item',onClick:()=>onPick(null)},
      h('span',{className:'ap-item-lead-box'},h(OpeningBackground,{ctx,background:null,className:'ap-item-thumb ap-opening-bg-none'})),
      h('button',{type:'button',className:'ap-item-main',onClick:e=>{e.stopPropagation();onPick(null);}},h('span',{className:'ap-item-name'},'无'))));
  return h(Modal,{title:'选择开场背景',onClose,className:'ap-opening-bg-modal',head},
    h('div',{className:'ap-pack-tools ap-opening-bg-tools'},h(PackSearchBox,{label:'搜索背景',placeholder:'搜索',value:query,onChange:setQuery}),filterMenu,
      categories.length>0&&h(InlineField,{kind:'menu',label:'标签',hideLabel:true,className:'ap-opening-bg-category',value:category,
        options:[{value:'',label:'全部标签'},...categories.map(c=>({value:c,label:c}))],onCommit:setCategory})),
    h('div',{ref:body,className:'ap-opening-bg-body'},
      !filtering&&none,
      shown.map(g=>h('section',{key:g.pack.manifest.id,className:'ap-opening-bg-group','aria-label':g.pack.manifest.name},
        h('div',{className:'ap-opening-bg-group-head'},g.pack.manifest.name),
        h(WindowedItems,{className:'ap-items ap-opening-bg-items',label:g.pack.manifest.name,items:g.assets,
          render:a=>{const key=g.pack.manifest.id+'/'+a.id;return h(EntryItem,{key,binding:ctx.binding,pack:g.pack,kind:'backgrounds',item:a,focused:key===current,checked:null,audio:null,ctx,
            onSelect:()=>onPick({packId:g.pack.manifest.id,kind:'backgrounds',assetId:a.id})});}}))),
      !shown.length&&(filtering?h(EmptyState,{noun:'背景',query,filter:filter!=='all'?ENTRY_LAMPS[filter]:category,onClear:clear}):h(EmptyState,{compact:true,noun:'背景'}))));
}
