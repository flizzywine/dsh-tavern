// 舞台设置 › 设置向导 —
// a sub-page of 舞台设置
// (‹ / Esc back) with a step bar (1 挑选素材 · 2 自定义角色 · 3 开场画面), 上一步 and the step's one solid button. Every step
// is made of the page's usual controls:
//   1 one compact browser over the installed packs: a pack menu (全部素材包 or one), the kind tabs, the shared search box
//     (name / 触发词, across every kind while typing) and a dense grid of entries in pick mode (EntryItem; a large grid
//     mounts only the blocks near the viewport), one quiet head per pack with its round check and 素材包设置 ›. 创建本卡素材包
//     merge-copies the picks into the card's own pack at once (mergeStageSetupPack, card + library CAS from the status
//     read). With no 素材 at all, 「下载官方精选素材」 opens 获取素材包 on the official 精选 list;
//   2 the card's characters (v3): 「卡里的角色」 — the detected names no card-pack figure answers to yet
//     (detectStageSetupCharacters in the host's confidence order, never the card's own title) — and 「本卡人物」 as face
//     tiles with the dashed ＋ at the end (empty: only the ＋). A tile opens its character page (‹ back); a name or the ＋
//     opens the 新人物 page (NewFigurePage, the same page as 舞台设置 › 人物's ＋): 设定图, 人物介绍, 名称 · 触发词 · 身高 ·
//     声音, 「生成形象」 and 「创建人物」, with 「已有人物」 under it (a library figure takes the page's name and 触发词);
//   3 the 开场设置 section itself (StageOpenings), one greeting at a time; 完成 is always there, 下一段开场白 while more remain.
// The wizard writes only 素材 (the card pack, its figures) and the card's pack binding; no switch. Auto-open receipts live in the host asset library.
const STAGE_SETUP_STEPS=[['packs','挑选素材'],['cast','自定义角色'],['opening','开场画面']];
// The contract's Chinese messages; the transport often carries only the code.
const STAGE_SETUP_ERRORS={REVISION_CONFLICT:'卡片或素材刚刚被改过，请重新载入后再试。',NOT_FOUND:'找不到这张卡片。',ASSET_UNAVAILABLE:'素材或素材库暂时不可用，请重新载入。',
  INVALID_INPUT:'设置内容不正确，请检查后重试。',UNKNOWN_FIELD:'设置内容不正确，请检查后重试。',INVALID_PATH:'素材文件路径不安全，无法使用。',LIMIT_EXCEEDED:'素材太大或磁盘空间不足。',
  RECOVERY_REQUIRED:'上次素材保存尚未恢复，请重新启动后再试。',FORBIDDEN:'没有访问权限，请重新打开酒馆。',SETTINGS_UNAVAILABLE:'目录设置暂时不可用。',DOWNLOAD_FAILED:'下载失败，请重试或更换网址。',
  INTEGRITY_MISMATCH:'素材文件不完整，无法安装。',FILE_CLOSURE_MISMATCH:'素材文件不完整，无法安装。',SCRIPT_CONFIRMATION_REQUIRED:'请确认安装这个素材包。',
  INVALID_ASSET_PACK:'素材包校验没有通过，这次修改没有保存。'};
const stageSetupError=error=>playerErrorText(error,{codes:STAGE_SETUP_ERRORS});
const stageSetupReady=binding=>binding?.service?.apiVersion===2&&(binding.service.capabilities||[]).includes('stage-setup-v1')&&typeof binding.service.getStageSetupStatus==='function';
// Auto-open, once per card (host receipt; session memory avoids duplicate requests). Two ways in:
//   - entering 舞台模式 (the chat's 「舞台」 / F12: galEnter → enter()) on a card whose host status says shouldAutoOpen
//     (no pack bound): instead of the empty stage, 舞台设置 opens (the sidebar's openTab) straight on the wizard — the
//     request waits here until the page for that card takes it;
//   - 舞台设置 showing such a card while the global 舞台模式 is on (useStageSetupAutoOpen).
// enter() is null when the stage should just open, else a promise: true when the wizard opened instead.
const stageSetup=(()=>{
  const offered=new Set(),listeners=new Set();let pending='';
  return {
    offered:path=>offered.has(path),
    offer(path){offered.add(path);},
    enter({service,path,stageOn,open,current=()=>true}){
      if(!path||!stageOn||offered.has(path)||!stageSetupReady({service}))return null;
      offered.add(path);
      return service.getStageSetupStatus({path}).then(async status=>{
        if(!current()){offered.delete(path);return false;}
        if(!status?.shouldAutoOpen)return false;
        pending=path;for(const fn of [...listeners])fn();
        try{await open();return true;}catch(_){pending='';return false;}
      },()=>false);
    },
    take(path){if(!path||pending!==path)return false;pending='';return true;},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
})();
function useStageSetupAutoOpen({binding,path,ready,stageOn,open}) {
  const autoOpen=()=>binding.service.getStageSetupStatus({path,autoOpened:true}).then(()=>open(),()=>{});
  React.useEffect(()=>{const take=()=>{if(stageSetup.take(path))autoOpen();};take();return stageSetup.subscribe(take);},[path]);
  React.useEffect(()=>{
    if(!ready||!stageOn||!path||!stageSetupReady(binding)||stageSetup.offered(path))return;
    let live=true;
    binding.service.getStageSetupStatus({path}).then(status=>{if(live&&status?.shouldAutoOpen&&!stageSetup.offered(path)){stageSetup.offer(path);autoOpen();}},()=>{});
    return()=>{live=false;};
  },[binding,path,ready,stageOn]);
}
const setupKey=(packId,kind,id)=>packId+'\n'+kind+'\n'+id;
// selected keys → mergeStageSetupPack selections (one row per source pack).
function stageSetupSelections(keys) {
  const rows=new Map();
  for(const key of keys){const [packId,kind,id]=key.split('\n');if(!rows.has(packId))rows.set(packId,[]);rows.get(packId).push({kind,id});}
  return [...rows].map(([packId,itemRefs])=>({packId,itemRefs}));
}
const setupFigures=pack=>pack?(pack.manifest.figures||[]).map(id=>pack.figures?.[id]).filter(Boolean):[];
// Name → figure goes through the one figure resolver (AGENTS rule 10): does one of these figures answer to `name`?
const setupResolverRows=(packId,figures)=>figures.map(f=>({name:f.name,aliases:f.aliases||[],actorKey:packId+'/'+f.id,ref:{packId,figureId:f.id}}));
const setupAnswers=(rows,name)=>figureResolution.resolveFigureName(rows,name).status==='resolved';
// The suggestions for step 2: the host's detected names in its confidence order (best first), never
// the card's own title and never a name a card-pack figure already answers to (name or 触发词).
function stageSetupSuggestions(candidates,cardName,pack) {
  const rows=setupResolverRows(pack?.manifest.id||'',setupFigures(pack)),title=figureResolution.normalizeCatalogueText(cardName||'');
  return [...new Set(candidates.map(c=>c.name))].filter(name=>figureResolution.normalizeCatalogueText(name)!==title&&!setupAnswers(rows,name));
}
// The library figures a character could use (every pack but the card's own, figures that can reach the stage), read once
// per pack revision; step 2 and the character page share it.
function useSetupLibrary(ctx,packId) {
  const sources=ctx.packs.filter(row=>!row.error&&row.manifest&&row.manifest.id!==packId&&packCount(row,'figures')>0);
  const state=useLoad(ctx.binding,()=>Promise.all(sources.map(row=>loadPackDetail(ctx.binding,row))),[sources.map(row=>row.manifest.id+'@'+row.revision).join()]);
  // One groups array (and one lookup) per read, so a re-render never re-resolves every name chip against the whole library.
  const groups=React.useMemo(()=>(state.value||[]).filter(p=>p?.manifest).map(p=>({key:p.manifest.id,label:p.manifest.name||'未命名素材包',
    rows:setupFigures(p).filter(f=>f.enabled!==false).map(figure=>({packId:p.manifest.id,pack:p,figure}))})),[state.value]);
  const lookup=React.useMemo(()=>setupLookup(groups),[groups]);
  return {...state,groups,lookup};
}
// The library figures that answer to a name (the resolver's words), in library order.
const setupSameName=(groups,name)=>name.trim()?groups.flatMap(group=>group.rows.filter(row=>setupAnswers(setupResolverRows(row.packId,[row.figure]),name))):[];
// name → the first library figure answering to it (one resolver call over every library figure, once per name), for the chips' faces.
function setupLookup(groups) {
  const rows=groups.flatMap(group=>group.rows.map(row=>({...setupResolverRows(row.packId,[row.figure])[0],choice:row}))),seen=new Map();
  return name=>{if(!seen.has(name)){const found=figureResolution.resolveFigureName(rows,name);seen.set(name,found.status==='resolved'?found.row.choice:null);}return seen.get(name);};
}

function StageSetupWizard({ctx,onClose,onComplete=onClose}) {
  const {binding,path}=ctx;
  const [step,setStep]=React.useState(0),[picked,setPicked]=React.useState(()=>new Set()),[notice,setNotice]=React.useState('');
  const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[curated,setCurated]=React.useState(false);
  // 2: the character page on top of the step ({name} for a new character, {figureId} for a card-pack figure).
  const [person,setPerson]=React.useState(null),personFrom=React.useRef(null);
  // 3 开场画面: the card's greetings (as 开场设置 read them) and the one shown.
  const [greetings,setGreetings]=React.useState([]),[greetingId,setGreetingId]=React.useState(null);
  const status=useLoad(binding,()=>binding.service.getStageSetupStatus({path}),[path,ctx.packs.map(p=>p.manifest?.id+'@'+p.revision).join()]);
  const title=React.useRef(null);
  React.useEffect(()=>{title.current?.focus?.({preventScroll:true});},[]);
  React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),8000);return()=>clearTimeout(t);},[notice]);
  const value=status.value,packId=value?.wizardPack?.packId||null,pack=packId?ctx.writer.pack(packId):null;
  // 2: the detected names and the library's figures, read once for the step and its character pages (no reload flash).
  const found=useLoad(binding,()=>binding.rpc('detectStageSetupCharacters',{path}),[path]),library=useSetupLibrary(ctx,packId);
  const reload=async()=>{setError('');await Promise.all([status.reload(),ctx.writer.reload()]);};
  const run=async job=>{if(busy)return false;setBusy(true);setError('');try{await job();return true;}catch(e){setError(stageSetupError(e));return false;}finally{setBusy(false);}};
  // One merge: the status read is the CAS (card revision + library revision); a conflict keeps the picks and asks to reload.
  // The character page copies one figure on a click (`fresh`): its CAS is a status read right then, as the page's own
  // figure writes have moved the library revision since the step was shown.
  async function merge(selections,fresh=false){
    const base=fresh?await binding.service.getStageSetupStatus({path}):value;
    const done=await binding.service.mergeStageSetupPack({path,expectedCardRevision:base.cardRevision,expectedLibraryRevision:base.libraryRevision,selections});
    status.setValue(done);await ctx.writer.reload();
    return done;
  }
  const ensurePack=()=>stageSetupCardPack(ctx);
  const go=next=>{setError('');setPerson(null);setStep(next);if(next===0)status.reload();if(next===2)setGreetingId(null);};
  const openPerson=next=>{personFrom.current=typeof document==='undefined'?null:document.activeElement;setError('');setPerson(next);};
  const closePerson=()=>{setError('');setPerson(null);setTimeout(()=>{const back=personFrom.current;(back?.isConnected?back:title.current)?.focus?.({preventScroll:true});},0);};
  const last=step===STAGE_SETUP_STEPS.length-1;
  const at=Math.max(0,greetings.findIndex(g=>g.id===greetingId)),moreGreetings=last&&at<greetings.length-1;
  async function next(){
    if(step===0&&picked.size){
      const ok=await run(async()=>{const done=await merge(stageSetupSelections(picked));setPicked(new Set());setNotice((packId?'已加入「':'已创建「')+done.wizardPack.name+'」');});
      if(!ok)return;
    }
    if(moreGreetings)setGreetingId(greetings[at+1].id);else if(last)onComplete();else go(step+1);
  }
  const back=()=>{if(last&&at>0)setGreetingId(greetings[at-1].id);else go(step-1);};
  const primary=busy?'正在保存…':step===0&&picked.size?(packId?'加入本卡素材包':'创建本卡素材包'):moreGreetings?'下一段开场白':last?'完成':'下一步';
  const keys=e=>{if(person){if(e.key==='Escape'&&!e.defaultPrevented&&e.currentTarget.contains(e.target)){e.preventDefault();e.stopPropagation();closePerson();}return;}subpageKeys(onClose)(e);};
  const failure=error&&h(ErrorBox,{error,reload});
  // A new character (a name or the ＋) is the 新人物 page, with the figures it could use instead (已有人物) under it.
  if(person&&value)return h('div',{className:'ap-wizard',role:'region','aria-label':'设置向导',onKeyDown:keys},
    person.figureId?h(StageSetupPerson,{key:person.figureId,ctx,status:value,pack,library,person,merge,run,busy,failure,onBack:closePerson}):
    h(NewFigurePage,{key:'@new:'+(person.name||''),ctx,parent:'设置向导',initialName:person.name||'',ensurePack,onBack:closePerson,onCreated:closePerson,
      existing:{pack,packId,figures:setupFigures(pack),library,use:(choice,{name,triggers})=>setupUseFigure({ctx,packId,merge,choice,name,own:triggers})}}));
  const body=!value?(status.error?h(ErrorBox,{error:stageSetupError({code:status.error,message:status.error}),reload:status.reload}):h(Loading,{shape:'fields'})):
    step===0?h(StageSetupPacks,{ctx,status:value,packId,picked,setPicked,onCurated:()=>setCurated(true)}):
    step===1?h(StageSetupCast,{ctx,status:value,pack,found,library,run,busy,onPerson:openPerson}):
    h(StageOpenings,{ctx,embedded:true,pick:greetings[at]?.id||null,onPick:setGreetingId,onGreetings:setGreetings});
  return h('div',{className:'ap-wizard',role:'region','aria-label':'设置向导',onKeyDown:keys},
    h(SubpageHead,{parent:'舞台设置',title:'设置向导',onBack:onClose,titleRef:title,tools:busy&&h(Spinner,{label:'正在保存'})}),
    h(StageSetupSteps,{step,onStep:go}),
    notice&&h('p',{className:'ap-notice',role:'status'},h(Glyph,{name:'check'}),h('span',null,notice)),
    failure,
    h('div',{className:'ap-wizard-body'},body),
    // 上一步 · (完成 while more greetings remain) · the step's one solid button; nothing to go back to on step 1, where 已选 N
    // sits beside the button it feeds.
    h('footer',{className:'ap-wizard-foot'},
      step>0&&h(Button,{className:'ap-manage',disabled:busy,onClick:back},'上一步'),
      h('span',{className:'ap-wizard-foot-gap'}),
      step===0&&picked.size>0&&h('span',{className:'ap-select-count',role:'status'},'已选 ',h('b',null,picked.size)),
      moreGreetings&&h(Button,{className:'ap-manage',disabled:busy,onClick:onComplete},'完成'),
      h(Button,{primary:true,disabled:busy||!value,onClick:next},primary)),
    curated&&h(PackGetSheet,{binding,packs:ctx.packs,catalogueReady:true,curated:true,onClose:()=>setCurated(false),
      onInstalled:()=>{setCurated(false);reload();}}));
}
// The step bar: the shared underline tab line; every step can be opened directly (←→ Home End move).
function StageSetupSteps({step,onStep}) {
  const ref=React.useRef(null),n=STAGE_SETUP_STEPS.length;
  const keys=e=>{const delta={ArrowRight:1,ArrowLeft:-1,Home:-step,End:n-1-step}[e.key];if(delta===undefined)return;e.preventDefault();const next=(step+delta+n)%n;onStep(next);
    setTimeout(()=>ref.current?.querySelectorAll('[role=tab]')[next]?.focus?.(),0);};
  return h('div',{ref,className:'ap-pack-kinds ap-wizard-steps'},h('div',{role:'tablist','aria-label':'设置步骤',className:'ap-kind-tabs-line',onKeyDown:keys},
    STAGE_SETUP_STEPS.map(([key,label],index)=>h('button',{key,type:'button',role:'tab','data-step':key,'aria-selected':index===step,tabIndex:index===step?0:-1,onClick:()=>onStep(index)},
      h('span',{className:'ap-wizard-step-no'},index+1),h('span',null,label)))));
}

// ---------- 1 挑选素材 ----------
function StageSetupPacks({ctx,status,packId,picked,setPicked,onCurated}) {
  const {binding}=ctx;
  const sources=ctx.packs.filter(row=>!row.error&&row.manifest&&row.manifest.id!==packId&&packCount(row)>0);
  const [source,setSource]=React.useState(''),[query,setQuery]=React.useState(''),[choice,setKind]=React.useState(null);
  // Every source pack's entries, read once (the transport keeps each document by revision).
  const details=useLoad(binding,()=>Promise.all(sources.map(row=>loadPackDetail(binding,row))),[sources.map(row=>row.manifest.id+'@'+row.revision).join()]);
  const flip=key=>setPicked(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});
  if(!status.hasAssets)return h(EmptyState,{noun:'素材',action:catalogueReady(binding)&&h(Button,{className:'ap-manage',onClick:onCurated},h(Glyph,{name:'download'}),'下载官方精选素材')});
  if(!sources.length)return h(EmptyState,{text:'没有可挑选的素材包'});
  const packs=(details.value||[]).filter(pack=>pack?.manifest&&(!source||pack.manifest.id===source));
  const selectableKinds=KIND_ORDER.filter(kind=>kind!=='widgets');
  const present=selectableKinds.filter(kind=>packs.some(pack=>packItems(pack,kind).length>0)),kind=present.includes(choice)?choice:present[0];
  // While typing, the 素材库's own entry search (entryMatches) spans every kind of the packs shown (the tabs step aside).
  const needle=query.trim().toLowerCase();
  const groups=packs.map(pack=>({pack,rows:(needle?selectableKinds:kind?[kind]:[]).flatMap(k=>packItems(pack,k).filter(item=>entryMatches(item,k,needle))
    .map(item=>({kind:k,item,key:setupKey(pack.manifest.id,k,item.id)})))})).filter(group=>group.rows.length);
  return h('div',{className:'ap-wizard-browser'},
    h('div',{className:'ap-wizard-browse-tools'},
      h(InlineField,{kind:'menu',label:'素材包',hideLabel:true,className:'ap-wizard-source',value:source,
        options:[{value:'',label:'全部素材包'},...sources.map(row=>({value:row.manifest.id,label:row.manifest.name||'未命名素材包'}))],onCommit:setSource}),
      h(PackSearchBox,{label:'搜索素材',placeholder:'搜索名称或触发词',value:query,onChange:setQuery,className:'is-compact'})),
    !needle&&h(PackKindNav,{manifest:packs[0]?.manifest,present,current:kind,onSwitch:setKind}),
    !details.value?(details.error?h(ErrorBox,{error:stageSetupError({code:details.error,message:details.error}),reload:details.reload}):h(Loading,{shape:'fields'})):
    groups.length?groups.map(group=>h(StageSetupGroup,{key:group.pack.manifest.id,ctx,...group,kind,picked,flip,setPicked})):
    h(EmptyState,{noun:'素材',query,onClear:()=>setQuery('')}));
}
// One pack's part of the list: a quiet head (its round check covers what is shown of it; 素材包设置 › its full page) over a
// dense grid of entries in pick mode. A picture's thumbnail opens the large view (EntryPreview), stepping through the
// group's pictures.
function StageSetupGroup({ctx,pack,rows,kind,picked,flip,setPicked}) {
  const audio=useAudioPreview(ctx.binding,pack.manifest.id),name=pack.manifest.name||'未命名素材包';
  const [view,setView]=React.useState(null),shown=rows.filter(row=>entryPreviewable(row.kind,row.item)),at=view?shown.findIndex(row=>row.key===view):-1;
  const n=rows.filter(row=>picked.has(row.key)).length,checked=n===0?false:n===rows.length?true:'mixed';
  const all=()=>setPicked(current=>{const next=new Set(current);for(const row of rows)if(checked===true)next.delete(row.key);else next.add(row.key);return next;});
  return h('section',{className:'ap-wizard-group','aria-label':name},
    h('div',{className:'ap-wizard-group-head'},
      h('button',{type:'button',role:'checkbox',className:'ap-pack-check','aria-checked':checked,'aria-label':'全选 '+name,onClick:all},
        h('span',{className:'ap-check-mark','aria-hidden':true},checked===true?h(Glyph,{name:'check'}):checked==='mixed'?h('i',{className:'ap-check-dash'}):null)),
      h('span',{className:'ap-wizard-group-name',title:name},name),
      h(IconButton,{icon:'chevRight',label:'素材包设置 '+name,onClick:()=>ctx.openPack(pack.manifest.id,rows[0].kind||kind)})),
    h(WindowedItems,{className:'ap-items ap-wizard-items',label:name,multi:true,items:rows,
      render:row=>h(EntryItem,{key:row.key,binding:ctx.binding,pack,kind:row.kind,item:row.item,checked:picked.has(row.key),audio,ctx,onSelect:()=>flip(row.key),
        onPreview:entryPreviewable(row.kind,row.item)?()=>setView(row.key):undefined})}),
    at>=0&&h(EntryPreview,{binding:ctx.binding,pack,rows:shown,at,picked,onToggle:flip,onMove:i=>setView(shown[i].key),onClose:()=>setView(null)}));
}

// ---------- 2 自定义角色 ----------
// Two sections, no guide paragraph: the names (a capped strip of chips — a worldbook can yield
// dozens, never a row per name) and the card pack's figures as face tiles. Each opens the character page. A name the
// library already has a figure for wears that figure's face (its avatar thumbnail): one click away from using it.
// The strip is capped by rows, not by count: 2 rows, 3 in a container ≤ 480px; then a quiet 「更多」 chip
// ends the last row (expanded: 「收起」 ends the list). Nothing hides when everything fits.
const STAGE_SETUP_ROWS=2,STAGE_SETUP_ROWS_NARROW=3,STAGE_SETUP_NARROW=480;
// How many chips (boxes in order, left/right relative to the strip) fit in `rows` rows with room for the 更多 chip at the
// end of the last one; boxes.length when they all fit. A chip that starts left of its predecessor opened a new row.
function stageSetupChipCut(boxes,{width,rows,more,gap}){
  const rowOf=[];let row=0,k=0;
  for(;k<boxes.length;k++){if(k&&boxes[k].left<boxes[k-1].left-.5)row++;if(row>=rows)break;rowOf.push(row);}
  if(k>=boxes.length)return boxes.length;
  while(k>0&&rowOf[k-1]===rows-1&&boxes[k-1].right+gap+more>width+.5)k--;
  return k;
}
function measureStageSetupChips(el){
  const box=el.getBoundingClientRect(),width=el.clientWidth,gap=parseFloat(globalThis.getComputedStyle?.(el)?.columnGap)||0;
  const kids=[...el.children],toggle=kids.find(kid=>kid.dataset?.more),boxes=kids.filter(kid=>kid!==toggle).map(kid=>{const r=kid.getBoundingClientRect();return {left:r.left-box.left,right:r.right-box.left};});
  return {width:Math.round(width),cut:stageSetupChipCut(boxes,{width,rows:width<=STAGE_SETUP_NARROW?STAGE_SETUP_ROWS_NARROW:STAGE_SETUP_ROWS,more:toggle?toggle.getBoundingClientRect().width:0,gap})};
}
// fit.cut = null while unmeasured: every chip renders (and the 更多 chip, invisible, to be measured) and a layout effect
// counts the rows before paint. A width change (ResizeObserver) or a new list measures again.
function useStageSetupChipFit(names){
  const sig=names.join('\n'),[el,setEl]=React.useState(null),[fit,setFit]=React.useState({sig:null,width:0,cut:null});
  const cut=fit.sig===sig?fit.cut:null;
  React.useLayoutEffect(()=>{if(el&&cut==null&&names.length)setFit({sig,...measureStageSetupChips(el)});},[el,cut,sig]);
  React.useEffect(()=>{
    if(!el||typeof ResizeObserver!=='function')return undefined;
    const observer=new ResizeObserver(([entry])=>{const width=Math.round(entry?.contentRect?.width??el.clientWidth);setFit(f=>f.cut==null||f.width===width?f:{sig:null,width:0,cut:null});});
    observer.observe(el);return ()=>observer.disconnect();
  },[el]);
  return {ref:setEl,cut};
}
function StageSetupCast({ctx,status,pack,found,library,run,busy,onPerson}) {
  const {binding}=ctx;
  const select=useSelection(),[more,setMore]=React.useState(false);
  const packId=pack?.manifest.id||status.wizardPack?.packId||null,figures=setupFigures(pack);
  const names=stageSetupSuggestions(found.value?.candidates||[],ctx.cardName,pack),fit=useStageSetupChipFit(names);
  const over=fit.cut!=null&&fit.cut<names.length,shown=over&&!more?names.slice(0,fit.cut):names;
  const lookup=library.lookup;
  const chip=name=>{
    const match=lookup(name),avatar=match&&figureAvatar({...match.figure,enabled:true,outfits:(match.figure.outfits||[]).map(o=>({...o,enabled:true}))},match.pack.sprites);
    return h('button',{key:name,type:'button',className:'ap-chip-button ap-wizard-name','data-face':avatar?true:undefined,disabled:busy||select.on,onClick:()=>onPerson({name})},
      avatar&&h(Thumb,{binding,packId:match.packId,...avatar,label:match.figure.name,className:'ap-wizard-name-face'}),h('span',null,name));
  };
  const remove=()=>{const ids=[...select.ids];ctx.setConfirm({title:'移除人物',body:'从本卡素材包移除 '+ids.length+' 个人物？',confirmLabel:'移除',danger:true,
    onConfirm:()=>run(async()=>{for(const id of ids)await ctx.writer.packOp(packId,c=>binding.service.removeFigure({packId,expectedRevision:c.revision,figureId:id}));select.stop();})});};
  const action=select.on?h(SelectBar,{count:select.ids.size,action:'移除',danger:true,onAction:remove,onCancel:select.stop}):
    figures.length>0&&h(Popover,{label:'本卡人物 操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'更多操作 本卡人物','aria-expanded':open,onClick:toggle}),
      content:close=>h(MenuItem,{danger:true,onClick:()=>{close();select.start();}},'移除…')});
  // The names section shows while it loads or fails, and when there is a name to offer.
  const strip=found.error?h(ErrorBox,{error:stageSetupError({code:found.error,message:found.error}),reload:found.reload}):!found.value?h(Loading,{shape:'tiles',count:4}):
    h('div',{ref:fit.ref,className:'ap-wizard-names',role:'group','aria-label':'卡里的角色'},
      shown.map(chip),
      // Unmeasured, the 更多 chip is laid out invisibly (its width is reserved on the last row); then only when chips hide.
      names.length>0&&(over||fit.cut==null)&&h('button',{key:'@more',type:'button','data-more':'true',className:'ap-chip-button ap-wizard-more',
        'aria-expanded':over?more:undefined,'aria-hidden':over?undefined:true,tabIndex:over?undefined:-1,'data-measuring':over?undefined:true,
        onClick:()=>setMore(!more)},more&&over?'收起':'更多'));
  const tile=figure=>{
    const on=select.has(figure.id),face=h('span',{className:'ap-cast-face'},h(FigureCastFace,{binding,packId,figure,sprites:pack.sprites,avatar:figureAvatar(figure,pack.sprites),label:figure.name}));
    return h('li',{key:figure.id},select.on?
      h('button',{type:'button',role:'checkbox','aria-checked':on,className:'ap-cast-row is-picking',style:{'--figure-color':figureColor(figure)},onClick:()=>select.flip(figure.id)},
        h('span',{className:'ap-check-mark','aria-hidden':true},on&&h(Glyph,{name:'check'})),face,h('span',{className:'ap-cast-name'},figure.name)):
      h('button',{type:'button',className:'ap-cast-row',title:figure.name,style:{'--figure-color':figureColor(figure)},disabled:busy,onClick:()=>onPerson({figureId:figure.id})},
        face,h('span',{className:'ap-cast-name'},figure.name)));
  };
  return h('div',{className:'ap-wizard-cast',onKeyDown:e=>{if(select.on&&e.key==='Escape'){e.stopPropagation();select.stop();}}},
    (!found.value||names.length>0)&&h(StageSection,{title:'卡里的角色',foldKey:'向导 · 卡里的角色',meta:names.length||undefined,
      help:'从卡的设定里找到的人名。点一个名字，给这个角色配形象和声音。'},strip),
    h(StageSection,{title:'本卡人物',foldKey:'向导 · 本卡人物',meta:figures.length||undefined,action,
      help:'正文提到人物的名称或触发词时，人物就会上场。'},
      h('ul',{className:'ap-cast ap-wizard-people','aria-label':'本卡人物'},figures.map(tile),
        !select.on&&h('li',{key:'@add',className:'ap-wizard-people-add'},h(CatAddTile,{label:'添加角色',onClick:()=>onPerson({name:''})})))));
}

// ---------- the character page ----------
// One page per card-pack figure (no rename / new / generate menu). Head: the 形象 (the figure's face, or
// the dashed ✦ that opens the figure editor's 生图) beside 名称 · 触发词 · 声音. A new character (a name or the ＋) opens
// the 新人物 page instead (NewFigurePage). A card-pack figure still without a face (an older blank) also
// lists the figures it can use — the card pack's, then library figures the resolver says answer to the name, then each
// library pack's: a pick replaces the blank (setupUseFigure; its name and 触发词 move over), and a later pick undoes the
// earlier one first (its copy removed, a card-pack figure's name and 触发词 restored).
function StageSetupPerson({ctx,status,pack,library,person,merge,run,busy,failure,onBack}) {
  const {binding}=ctx;
  const [blank]=React.useState(()=>{const f=person.figureId&&pack?.figures?.[person.figureId];return f&&!figureHasFace(pack,f)?f:null;});
  const [bound,setBound]=React.useState(person.figureId||null),[origin,setOrigin]=React.useState(()=>blank?{kind:'created',packId:pack.manifest.id,figureId:blank.id}:null);
  const [draft,setDraft]=React.useState(person.name||''),[own,setOwn]=React.useState(()=>blank?figureNames(blank):[]),[query,setQuery]=React.useState('');
  const title=React.useRef(null);
  React.useEffect(()=>{title.current?.focus?.({preventScroll:true});},[]);
  const packId=pack?.manifest.id||status.wizardPack?.packId||null,figure=bound&&pack?.figures?.[bound]||null;
  const choosing=!!blank,name=figure?figure.name:draft,figures=setupFigures(pack);
  const patch=(target,figureId,change)=>ctx.writer.packOp(target,c=>binding.service.patchFigure({packId:target,expectedRevision:c.revision,figureId,patch:change}));
  // Undo this page's pick before another one. A figure that cannot be removed (the host refuses one with pictures today)
  // stops the change: the page keeps its pick and says so.
  async function release(){
    if(!origin)return;
    if(origin.kind==='renamed')await patch(origin.packId,origin.figureId,origin.before);
    else try{await ctx.writer.packOp(origin.packId,c=>binding.service.removeFigure({packId:origin.packId,expectedRevision:c.revision,figureId:origin.figureId}));}
      catch(error){if(error?.code==='REVISION_CONFLICT')throw error;throw new Error('没能从本卡素材包撤下「'+name+'」，角色还是用它。可以到素材库里处理。');}
    setOrigin(null);setBound(null);
  }
  async function bind(choice){
    await release();
    const made=await setupUseFigure({ctx,packId,merge,choice,name,own});
    setDraft(made.name);setBound(made.figureId);setOrigin({kind:made.local?'renamed':'copied',packId:made.packId,figureId:made.figureId,before:made.before,from:{packId:choice.packId,figureId:choice.figure.id}});
  }
  // Changing away from a blank figure that has pictures by now (生图) asks first: they go with it. The tile being applied
  // shows a spinner (a library copy takes a moment); the others stay as they are.
  const [applying,setApplying]=React.useState(null);
  const apply=choice=>{setApplying(choice.packId+'/'+choice.figure.id);return run(()=>bind(choice)).finally(()=>setApplying(null));};
  const use=choice=>{
    if(busy||origin?.from&&choice.packId===origin.from.packId&&choice.figure.id===origin.from.figureId)return;
    const lose=origin?.kind==='created'&&figure?[figureHasFace(pack,figure)&&'图片',figure.voice&&'声音'].filter(Boolean):[];
    if(lose.length)return ctx.setConfirm({title:'改用「'+choice.figure.name+'」？',body:'新建的「'+name+'」和它的'+lose.join('、')+'会被删除。',confirmLabel:'改用',danger:true,onConfirm:()=>apply(choice)});
    apply(choice);
  };
  // 触发词 typed on this page travel with the character when its pick changes.
  const track=(before,list)=>setOwn(current=>[...new Set([...current.filter(word=>list.includes(word)||!before.includes(word)),...list.filter(word=>!before.includes(word))])]);
  const openFigure=tab=>{if(figure)ctx.openPack(packId,'figures',figure.id,tab);};
  const art=figure&&figureHasFace(pack,figure);
  const hero=art?h('span',{className:'ap-cast-face ap-person-face',style:{'--figure-color':figureColor(figure)}},
      h(FigureCastFace,{binding,packId,figure,sprites:pack.sprites,avatar:figureAvatar(figure,pack.sprites),label:figure.name})):
    figure&&h('button',{type:'button',className:'ap-person-gen','aria-label':'生成形象',title:'生成形象',disabled:busy,onClick:()=>openFigure('gen')},h(SlotMissing,null));
  const validName=v=>!v.trim()?'名称不能为空':[...v].length>60?'名称太长':'';
  return h('div',{className:'ap-person'},
    h(SubpageHead,{parent:'设置向导',title:name.trim()||'新角色',onBack,titleRef:title,
      tools:h(React.Fragment,null,busy&&h(Spinner,{label:'正在保存'}),figure&&h(Button,{className:'ap-manage',onClick:()=>ctx.openPack(packId,'figures',figure.id)},'在素材库编辑'))}),
    failure,
    h('div',{className:'ap-person-top'},hero,
      h(InlineGrid,{label:name||'新角色',columns:1,className:'ap-person-fields'},
        h(InlineField,{kind:'text',label:'名称',value:name,placeholder:'角色名',disabled:busy,validate:v=>figure||v?validName(v):'',
          onCommit:next=>figure?run(()=>patch(packId,figure.id,{name:next})):setDraft(next)}),
        h(InlineField,{kind:'chips',label:'触发词',value:figure?figureNames(figure):own,addLabel:'添加触发词',split:splitAliases,validate:aliasProblem,disabled:busy,
          onCommit:list=>{if(!figure)return setOwn(list);track(figureNames(figure),list);run(()=>patch(packId,figure.id,namesPatch(figure,list)));}}),
        figure&&h(FigureVoiceField,{pack,figure,status:null,onOpen:()=>openFigure('voice')}))),
    choosing&&h(StagePersonChoices,{ctx,pack,packId,name,figures,library,query,setQuery,origin,applying,onUse:use}),
    h('footer',{className:'ap-wizard-foot'},h('span',{className:'ap-wizard-foot-gap'}),
      h(Button,{primary:true,disabled:busy,onClick:onBack},busy?'正在保存…':'完成')));
}
// A character takes a figure it can use (StagePersonChoices): a library figure is copied into the card pack first. A
// figure that already answers to the name (the resolver: its name or a 触发词) keeps both and gains the page's 触发词
// (`own`). Otherwise it becomes this character: the page's name, and its visible 触发词 (the old character's, an
// archetype's 「短发妹」) give way to the page's. Hidden actor codes always stay (namesPatch). The character page and the
// 新人物 page's 「已有人物」 both pick through here.
async function setupUseFigure({ctx,packId,merge,choice,name,own}){
  const local=choice.packId===packId,carry=name.trim()||choice.figure.name;
  let target=choice.packId,figureId=choice.figure.id;
  if(!local){const done=await merge([{packId:choice.packId,itemRefs:[{kind:'figures',id:choice.figure.id}]}],true);
    target=done.wizardPack.packId;figureId=done.copied.find(c=>c.kind==='figures'&&c.fromId===choice.figure.id).toId;}
  const before={name:choice.figure.name,aliases:choice.figure.aliases||[]},keep=!name.trim()||setupAnswers(setupResolverRows(choice.packId,[choice.figure]),carry);
  const next=keep?before.name:carry,norm=figureResolution.normalizeCatalogueText;
  const aliases=namesPatch(choice.figure,[...new Set([...(keep?figureNames(choice.figure):[]),...own])]).aliases.filter(word=>norm(word)!==norm(next));
  if(next!==before.name||JSON.stringify(aliases)!==JSON.stringify(before.aliases))
    await ctx.writer.packOp(target,c=>ctx.binding.service.patchFigure({packId:target,expectedRevision:c.revision,figureId,patch:{name:next,aliases}}));
  return {local,packId:target,figureId,name:next,before};
}
// The figures a new character can use, as face tiles in groups: 同名人物 (library figures the resolver matches to the name)
// first, then 本卡素材包 (what step 1 copied), then each library pack. Disabled library figures never reach the stage, so
// they are not offered. The pick shows its ✓ on the tile that was clicked (a library figure, not its copy); the page's own
// blank figure or copy is not offered again.
function StagePersonChoices({ctx,pack,packId,name,figures,library,query,setQuery,origin,applying,onUse}) {
  const needle=query.trim().toLowerCase(),match=row=>entryMatches(row.figure,'figures',needle);
  const own=origin&&origin.kind!=='renamed'?origin.figureId:null,picked=origin?.from||null;
  const same=setupSameName(library.groups,name);
  const groups=[{key:'@same',label:'同名人物',rows:same.filter(match)},
    {key:'@card',label:'本卡素材包',rows:figures.filter(figure=>figure.id!==own).map(figure=>({packId,pack,figure})).filter(match)},
    ...library.groups.map(group=>({...group,rows:group.rows.filter(row=>!same.includes(row)&&match(row))}))].filter(group=>group.rows.length);
  const total=figures.length+library.groups.reduce((n,group)=>n+group.rows.length,0);
  // Nothing anywhere to use (an empty library and card pack): no section, not an empty one.
  if(library.value&&!total&&!needle)return null;
  const tile=row=>{const key=row.packId+'/'+row.figure.id;
    return h('li',{key,role:'none'},h(PersonChoice,{binding:ctx.binding,row,on:!!picked&&row.packId===picked.packId&&row.figure.id===picked.figureId,applying:applying===key,onUse}));};
  return h(StageSection,{title:'已有人物',foldKey:'向导 · 已有人物',help:'选一个人物，这个角色就用它的形象和声音。',
      action:total>8&&h(PackSearchBox,{label:'搜索人物',placeholder:'搜索名称或触发词',value:query,onChange:setQuery,className:'is-compact'})},
    groups.map(group=>h('div',{key:group.key,className:'ap-person-group'},h('p',{className:'ap-person-group-name'},group.label),
      h(WindowedItems,{className:'ap-cast ap-person-choices',label:group.label,items:group.rows,render:tile}))),
    !library.value?(library.error?h(ErrorBox,{error:stageSetupError({code:library.error,message:library.error}),reload:library.reload}):h(Loading,{shape:'tiles'})):
    !groups.length&&h(EmptyState,{noun:'人物',query,icon:h(Glyph,{name:'figures'}),onClear:()=>setQuery('')}));
}
// One figure to use: its cast face (cut from the sprite, so only once the tile nears the view), its name, ✓ when picked.
function PersonChoice({binding,row,on,applying,onUse}) {
  const [ref,near]=useNearView(),shown={...row.figure,enabled:true,outfits:(row.figure.outfits||[]).map(o=>({...o,enabled:true}))};
  return h('button',{type:'button',role:'option','aria-selected':on,'aria-busy':applying||undefined,className:'ap-cast-choice',title:row.figure.name,
      style:{'--figure-color':figureColor(row.figure)},onClick:()=>onUse(row)},
    h('span',{ref,className:'ap-cast-face'},near&&h(FigureCastFace,{binding,packId:row.packId,figure:shown,sprites:row.pack.sprites,avatar:figureAvatar(shown,row.pack.sprites),label:row.figure.name}),
      applying?h('span',{className:'ap-cast-badge','aria-hidden':true},h(Spinner)):on&&h('span',{className:'ap-cast-badge is-check','aria-hidden':true},h(Glyph,{name:'check'}))),
    h('span',{className:'ap-cast-name'},row.figure.name));
}

// ---------- 新人物: the one new-figure page ----------
// 舞台设置 › 人物's ＋ and 设置向导 › 自定义角色's ＋ (and its names) open this
// one page. Everything on it: 设定图 (up to four pictures, uploaded or pasted), 人物介绍 (figure.description), 名称 · 触发词
// (the name's forms until edited) · 身高 (what the user types; else set silently when the draft is made, newFigureHeightCm) ·
// 声音 (the figure's voice page). 「生成形象」
// is the only paid step: one 立绘 request through the asset-generation RPCs from the
// pictures and the text, its 头像 as the request's follow-up. Those RPCs write into a figure, so the first press makes a
// hidden draft in the card pack (enabled:false — never on stage, not linted) and each picture is adopted into it as it
// arrives; the page shows the 立绘 and 头像, 「重新生成」 asks again. 「创建人物」 (only once both are there) checks the form
// once — plain Chinese on the field, focus moves there — and turns the draft into the figure in one patchFigure (the host's
// trigger lint runs there; its issues land on 触发词). Leaving without creating removes the draft. Nothing is checked or red
// before a press; there is no error code or 重新载入 here.
const NEW_FIGURE_OUTFIT='default',NEW_FIGURE_FACE='calm',NEW_FIGURE_NAME='新人物';
const NEW_FIGURE_FIELDS=['refs','name','triggers'];
// a height nobody typed is the median heightCm of the pack's enabled figures,
// leaving out the seated mascots (heightBasis 'seated', the figure-scale head rule's mascot) — a non-human opted out of a
// height (dsh.height heightSource 'none') has none to count. With no such figure: 150 cm, the figure-scale reference
// height a figure without heightCm already stands at (FIGURE_DISPLAY.REF_MIN_CM, the director's `heightCm ?? 150`).
// Worked out once, when the draft is made; no marker on the page.
function newFigureHeightCm(figures) {
  const cms=Object.values(figures||{}).filter(f=>f.enabled!==false&&f.heightBasis!=='seated'&&f.heightCm>0).map(f=>f.heightCm).sort((a,b)=>a-b);
  if(!cms.length)return 150;
  const mid=cms.length>>1;return cms.length%2?cms[mid]:Math.round((cms[mid-1]+cms[mid])/2*10)/10;
}
// The forms of a name the story will use: the name and its parts around a space / · (「晓美 焰」 → 晓美 焰、晓美、焰 is too
// short: parts of one character are left out).
const newFigureNameForms=name=>{const n=String(name||'').trim();return n?[...new Set([n,...n.split(/[\s·・]+/).filter(p=>p&&p!==n&&[...p].length>=2)])]:[];};
// An absent pack stays a CAS request until the first figure is committed with it.
async function stageSetupCardPack(ctx){
  const status=await ctx.binding.service.getStageSetupStatus({path:ctx.path});
  return status.wizardPack?.packId||{path:ctx.path,expectedCardRevision:status.cardRevision,expectedLibraryRevision:status.libraryRevision,selections:[]};
}
// The host's trigger lint (an issue per word and rule) said on the 触发词 field, in the player's words.
function newFigureLintText(issues){
  const issue=issues?.[0];if(!issue)return '';const word=issue.trigger?'「'+issue.trigger+'」':'';
  return {count:'触发词最多 6 个，留下正文里最常见的称呼',duplicate:word+'重复了',suffix:word+'不像称呼，去掉「声」「氛围」「场景」这样的后缀',
    'short-word':word+'太短或太长，用正文里会出现的 2–4 字称呼','group-generic':word+'很多素材都在用，换一个只属于这个人物的称呼'}[issue.rule]||word+'用不了，换一个正文里会出现的称呼';
}
// A failed save in a sentence through the shared playerErrorText (the contract's words for a code, else the host's
// plain Chinese reason); a failed generation is the shared genFailText.
const newFigureSaveText=e=>playerErrorText(e,{codes:STAGE_SETUP_ERRORS,fallback:'没能保存，请再试一次'});
function NewFigurePage({ctx,parent,initialName='',ensurePack,onBack,onCreated,existing}) {
  const {binding}=ctx;
  const [name,setNameState]=React.useState(initialName.trim()),[triggers,setTriggers]=React.useState(()=>newFigureNameForms(initialName)),typed=React.useRef(false);
  const [height,setHeight]=React.useState(null),autoHeight=React.useRef(null),[about,setAbout]=React.useState(''),[refs,setRefs]=React.useState([]);
  const [errors,setErrors]=React.useState({}),[problem,setProblem]=React.useState(''),[busy,setBusy]=React.useState(false),[request,setRequest]=React.useState(0);
  const [draft,setDraftState]=React.useState(null),draftRef=React.useRef(null),[query,setQuery]=React.useState(''),[drawing,setDrawing]=React.useState(false);
  const root=React.useRef(null),title=React.useRef(null),fileInput=React.useRef(null),sent=React.useRef(null);
  React.useEffect(()=>{title.current?.focus?.({preventScroll:true});},[]);
  const pack=draft?ctx.writer.pack(draft.packId):null,figure=draft&&pack?.figures?.[draft.figureId]||null;
  const outfit=figure?.outfits.find(o=>o.key===NEW_FIGURE_OUTFIT)||null,manifest=outfit?.sprite&&pack?.sprites?.[outfit.sprite.manifestKey];
  const sprite=outfit?genOwnSprite(outfit,manifest,NEW_FIGURE_FACE):null,avatar=outfit?.avatars?.[NEW_FIGURE_FACE]||null,done=!!sprite&&!!avatar;
  const clear=key=>setErrors(e=>{if(!e[key])return e;const next={...e};delete next[key];return next;});
  // The 触发词 follow the name until the user edits them.
  const setName=v=>{setNameState(v);clear('name');if(!typed.current)setTriggers(newFigureNameForms(v));};
  const focusField=key=>setTimeout(()=>{const box=root.current?.querySelector?.('.ap-nf-'+key);if(!box)return;
    (box.querySelector('.fork-inline-chip-add input')||box.querySelector('input:not([type=file]),textarea,button'))?.focus?.();box.scrollIntoView?.({block:'nearest'});},0);
  const run=job=>{if(busy)return;setBusy(true);setProblem('');Promise.resolve().then(job).catch(e=>setProblem(newFigureSaveText(e))).finally(()=>setBusy(false));};
  const write=(fn)=>ctx.writer.packOp(draftRef.current.packId,fn,{quiet:true});
  const addFiles=files=>{
    const room=GEN_REF_LIMIT-refs.length,list=[...files].filter(f=>/^image\//.test(f.type));if(!list.length)return;
    if(room<=0){setErrors(e=>({...e,refs:'设定图最多 '+GEN_REF_LIMIT+' 张'}));return;}
    Promise.all(list.slice(0,room).map(genReadUpload)).then(made=>{setRefs(r=>[...r,...made].slice(0,GEN_REF_LIMIT));clear('refs');},e=>setErrors(x=>({...x,refs:errorText(e)})));
  };
  const paste=e=>{const files=[...(e.clipboardData?.files||[])].filter(f=>/^image\//.test(f.type));if(!files.length)return;e.preventDefault();addFiles(files);};
  // The hidden draft: made by the first 生成形象 (or the 声音 page), brought up to the page before each request.
  const heightCm=()=>height??autoHeight.current;
  const draftDoc=()=>({schemaVersion:1,name:name.trim()||NEW_FIGURE_NAME,enabled:false,appearance:'sprite',recall:{mode:'keyword'},emotions:[{id:NEW_FIGURE_FACE}],heightCm:heightCm(),
    ...(about.trim()?{description:about.trim()}:{}),outfits:[{key:NEW_FIGURE_OUTFIT,label:'默认',enabled:true,defaultEmotion:NEW_FIGURE_FACE,recall:{mode:'keyword',keywords:[name.trim()||NEW_FIGURE_NAME]}}]});
  async function ensureDraft(){
    if(draftRef.current){const d=draftRef.current;await write(c=>binding.service.patchFigure({packId:d.packId,expectedRevision:c.revision,figureId:d.figureId,
      patch:{name:name.trim()||NEW_FIGURE_NAME,heightCm:heightCm(),description:about.trim()||null}}));return d;}
    const target=await ensurePack();
    let packId,made;
    if(typeof target==='string'){
      packId=target;
      made=await ctx.writer.packOp(packId,c=>{autoHeight.current=newFigureHeightCm(c.figures);
        return binding.service.createFigure({packId,expectedRevision:c.revision,figure:draftDoc()});},{quiet:true});
    }else{
      autoHeight.current=newFigureHeightCm({});
      made=await binding.service.mergeStageSetupPack({...target,figure:draftDoc()});
      packId=made.wizardPack.packId;
      await ctx.writer.reload();
    }
    draftRef.current={packId,figureId:made.figureId};setDraftState(draftRef.current);return draftRef.current;
  }
  async function discard(){
    const d=draftRef.current;if(!d)return;
    await ctx.writer.packOp(d.packId,c=>binding.service.removeFigure({packId:d.packId,expectedRevision:c.revision,figureId:d.figureId}),{quiet:true});
    draftRef.current=null;setDraftState(null);
  }
  // 生成形象 / 重新生成: what a request needs (a picture or some text) is the one check here.
  const generate=()=>{
    if(busy)return;
    if(!refs.length&&!about.trim()){setErrors({refs:'放一张设定图，或写几句人物介绍'});focusField('refs');return;}
    setErrors({});
    run(async()=>{const d=await ensureDraft();sent.current={references:refs.map(u=>({base64:u.base64,mediaType:u.mediaType,role:GEN_ART_ROLE})),userPrompt:about.trim()};setRequest(n=>n+1);return d;});
  };
  // 创建人物: the form is checked once, then the draft becomes the figure (one patchFigure; the lint runs in it).
  const create=()=>{
    if(busy)return;
    const next={},words=triggers.filter(Boolean);
    if(!name.trim())next.name='先给人物起个名字';else if([...name.trim()].length>60)next.name='名字太长了，60 个字以内';
    if(!words.length)next.triggers='至少填一个触发词，用正文里会出现的称呼';else if(aliasProblem(words))next.triggers=aliasProblem(words);
    setErrors(next);const first=NEW_FIGURE_FIELDS.find(key=>next[key]);if(first)return focusField(first);
    const finalName=name.trim(),norm=figureResolution.normalizeCatalogueText,shortest=[...words].sort((a,b)=>[...a].length-[...b].length)[0];
    setBusy(true);setProblem('');
    write(c=>{const f=c.figures[draftRef.current.figureId];
      return binding.service.patchFigure({packId:draftRef.current.packId,expectedRevision:c.revision,figureId:draftRef.current.figureId,patch:{
        name:finalName,enabled:true,aliases:namesPatch(f,words).aliases.filter(w=>norm(w)!==norm(finalName)),heightCm:heightCm(),description:about.trim()||null,
        outfits:f.outfits.map(o=>o.key===NEW_FIGURE_OUTFIT?{...o,recall:{mode:'keyword',keywords:[shortest]}}:o)}});})
      .then(async()=>{draftRef.current=null;await ctx.writer.reload();onCreated?.();},
        e=>{if(e?.code==='TRIGGER_LINT'){setErrors({triggers:newFigureLintText(e.issues)});focusField('triggers');}else setProblem(newFigureSaveText(e));})
      .finally(()=>setBusy(false));
  };
  // ‹ / Esc: a draft (and what was generated into it) goes, after asking when there are pictures to lose.
  const leave=()=>{
    if(busy&&!draftRef.current)return;
    const quit=()=>run(async()=>{await discard();onBack();});
    if(figure&&(sprite||avatar))return ctx.setConfirm({title:'放弃这个新人物？',body:'生成的立绘和头像会被删除。',confirmLabel:'放弃',danger:true,onConfirm:quit});
    quit();
  };
  const openVoice=()=>run(async()=>{const d=await ensureDraft();ctx.openPack(d.packId,'figures',d.figureId,'voice');});
  const keys=e=>{if(e.key!=='Escape'||e.defaultPrevented||!e.currentTarget.contains(e.target))return;e.preventDefault();e.stopPropagation();leave();};
  const refsRow=h(InlineRow,{label:'设定图',multiline:true,wide:true,className:'ap-nf-refs'+(errors.refs?' is-invalid':'')},
    h('div',{className:'ap-gd-refs ap-nf-ref-list',role:'group','aria-label':'设定图'},
      refs.map((u,i)=>h(GenRefChip,{key:u.id,url:u.url,name:'设定图 '+(i+1),bare:true,onRemove:()=>setRefs(list=>list.filter(x=>x!==u))})),
      refs.length<GEN_REF_LIMIT&&h(CatAddTile,{label:'添加设定图',className:'ap-gd-ref-add',onClick:()=>fileInput.current?.click?.()}),
      h('input',{ref:fileInput,type:'file',hidden:true,multiple:true,tabIndex:-1,accept:'image/png,image/webp,image/jpeg','aria-label':'添加设定图',
        onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';addFiles(files);}})),
    errors.refs&&h('span',{className:'fork-inline-error',role:'alert'},errors.refs));
  const voice=figure?h(FigureVoiceField,{pack,figure,status:null,onOpen:openVoice}):
    h(InlineField,{kind:'link',label:'声音',className:'is-voice',value:'',placeholder:'选择声音',controlClassName:'ap-voice-pill',disabled:busy,onOpen:openVoice});
  const primary=done?h(Button,{primary:true,className:'ap-primary ap-nf-go',disabled:busy||drawing,onClick:create},busy?'正在保存…':'创建人物'):
    h(Button,{primary:true,className:'ap-primary ap-nf-go',disabled:busy||drawing,onClick:generate},h(Glyph,{name:'spark'}),drawing?'正在生成…':'生成形象');
  return h('div',{ref:root,className:'ap-person ap-new-figure',role:'region','aria-label':'新人物',onKeyDown:keys,onPaste:paste},
    h(SubpageHead,{parent,title:name.trim()||NEW_FIGURE_NAME,onBack:leave,titleRef:title,tools:busy&&h(Spinner,{label:'正在保存'})}),
    h('div',{className:'ap-nf-body'},
      draft&&request>0&&h(NewFigureStudio,{key:draft.figureId,ctx,draft,pack,figure,sprite,avatar,request,input:()=>sent.current,onRetry:generate,onDrawing:setDrawing}),
      h(InlineGrid,{label:'新人物',columns:1,className:'ap-nf-fields'},
        refsRow,
        h(InlineField,{kind:'text',multiline:true,lines:true,count:true,maxLength:FIGURE_DESCRIPTION_MAX,label:'人物介绍',wide:true,className:'ap-nf-about',value:about,
          placeholder:'性格、外貌、常穿的衣服…',onCommit:v=>{setAbout(v);clear('refs');}}),
        h(InlineField,{kind:'text',label:'名称',className:'ap-nf-name',value:name,placeholder:'人物的名字',maxLength:80,error:errors.name,onCommit:setName}),
        h(InlineField,{kind:'chips',label:'触发词',controlLabel:'人物触发词',className:'ap-nf-triggers',wide:true,value:triggers,addLabel:'添加触发词',split:splitAliases,error:errors.triggers,
          onCommit:list=>{typed.current=true;setTriggers(list);clear('triggers');}}),
        h(InlineField,{kind:'number',label:'身高',className:'ap-nf-height ap-height',unit:'cm',integer:false,optional:true,min:1,max:400,value:heightCm(),onCommit:setHeight}),
        voice),
      existing&&h(StagePersonChoices,{ctx,pack:existing.pack,packId:existing.packId,name,figures:existing.figures,library:existing.library,query,setQuery,origin:null,applying:null,
        onUse:choice=>{if(busy)return;const go=()=>run(async()=>{await discard();await existing.use(choice,{name,triggers});onBack();});
          if(figure&&(sprite||avatar))return ctx.setConfirm({title:'改用「'+choice.figure.name+'」？',body:'生成的立绘和头像会被删除。',confirmLabel:'改用',danger:true,onConfirm:go});go();}})),
    h('footer',{className:'ap-wizard-foot ap-nf-foot'},
      problem&&h('p',{className:'ap-nf-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,problem)),
      h('span',{className:'ap-wizard-foot-gap'}),
      done&&h(Button,{className:'ap-manage',disabled:busy||drawing,onClick:generate},h(Glyph,{name:'reset'}),'重新生成'),
      primary));
}
// The request and its pictures (one per draft): 立绘 with its 头像 as follow-up through the pack's own generation
// controller (useAssetGen) on the card writer's queue; each picture is adopted into the hidden draft as it arrives (the
// draft is the confirmation step — nothing is on stage before 「创建人物」). Shows the request's state, the 立绘 and 头像.
function NewFigureStudio({ctx,draft,pack,figure,sprite,avatar,request,input,onRetry,onDrawing}) {
  const {binding}=ctx,packId=draft.packId;
  const enqueue=job=>ctx.writer.packOp(packId,job,{quiet:true}),importFigureImage=figureImageImporter({binding,packId,enqueue});
  const gen=useAssetGen({binding,packId,enqueue,importFigureImage});
  const at=kind=>({packId,figureId:draft.figureId,outfitKey:NEW_FIGURE_OUTFIT,kind,emotionId:NEW_FIGURE_FACE});
  const spriteCell=genCell(gen,at('sprite')),avatarCell=genCell(gen,at('avatar'));
  const [failed,setFailed]=React.useState(''),[adopting,setAdopting]=React.useState(''),asked=React.useRef(0),taken=React.useRef(new Set());
  React.useEffect(()=>{
    if(asked.current===request)return;asked.current=request;setFailed('');
    gen.start(at('sprite'),{...input().references.length?{references:input().references}:{},...(input().userPrompt?{userPrompt:input().userPrompt}:{}),
      followUp:[{kind:'avatar',emotionId:NEW_FIGURE_FACE}]}).catch(()=>{});
  },[request]);
  // A picture that arrives goes into the draft at once (useAssetGen.accept: the import, then its follow-up).
  React.useEffect(()=>{
    for(const cell of [spriteCell,avatarCell]){const job=cell.job;
      if(cell.state!=='candidate'||!job||taken.current.has(job.jobId))continue;taken.current.add(job.jobId);setAdopting(cell.target.kind);
      gen.accept(job).catch(e=>setFailed(newFigureSaveText(e))).finally(()=>setAdopting(''));}
  });
  const running=!failed&&([spriteCell,avatarCell].find(c=>['queued','running'].includes(c.state))||(adopting?{state:'running',target:{kind:adopting}}:null));
  const error=failed||spriteCell.state==='failed'&&genFailText(spriteCell.error)||avatarCell.state==='failed'&&genFailText(avatarCell.error)||'';
  const word=running?(running.target.kind==='sprite'?'正在生成立绘':'正在生成头像'):'';
  const elapsed=useElapsed(running?.since,!!running?.since);
  React.useEffect(()=>{onDrawing(!!running);},[!!running]);
  React.useEffect(()=>()=>onDrawing(false),[]);
  const art=sprite?h(StandArt,{key:sprite,binding,packId,hash:sprite,label:(figure?.name||'')+'立绘',heightCm:figure?.heightCm}):
    h('span',{className:'ap-nf-wait'},running?h(Spinner,{delay:0}):null);
  return h('section',{className:'ap-nf-result','aria-label':'生成的形象'},
    h('div',{className:'ap-nf-stand ap-stand-wrap',style:{'--figure-color':figure?figureColor(figure):undefined}},art),
    h('div',{className:'ap-nf-side'},
      h('span',{className:'ap-nf-avatar'},avatar?h(Thumb,{binding,packId,hash:avatar,label:(figure?.name||'')+'头像',className:'ap-avatar ap-nf-avatar-art'}):
        h('span',{className:'ap-nf-wait'},running&&sprite?h(Spinner,{delay:0}):null)),
      word&&h('p',{className:'ap-nf-status',role:'status'},h('span',null,word),running?.since&&h('span',{className:'ap-gen-time'},elapsed)),
      gen.problem&&h(HintLine,{text:GEN_PROBLEMS[gen.problem]}),
      error&&!gen.problem&&!running&&h('p',{className:'ap-nf-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,error)),
      error&&!running&&h(Button,{className:'ap-manage',onClick:onRetry},h(Glyph,{name:'reset'}),'重新生成')),
    gen.dialogs);
}

// ---------- 1 挑选素材 › the large view ----------
// 设置向导 › 挑选素材 — the row thumbnails
// are too small to judge, so a thumbnail (never the check or the name, never on hover) opens the shared large view
// (PackImageView → ImageViewer) on the entry's picture:
//   人物 — the shown outfit (the first enabled one first) in its calm 差分 (the name resolved through the figure's emotions,
//          AGENTS rule 10): its 立绘, else its avatar; 背景 / 物品 — the picture; CG — the shown 差分.
// Corner buttons: ‹ › step through the previewable entries of the same list (also ←→, wrapping); 换服装 / 换差分 step a
// figure's outfits and faces, or a CG's 差分, when there are several; ✓ 选择 toggles the same pick as the row's check. Audio
// has no preview and nothing ever plays by itself. The full picture is leased only while it shows.
const PREVIEW_IMAGE_KINDS=['backgrounds','cg','props'];
const cgPreviewVariants=item=>(item.variants?.entries||[]).filter(v=>v.content.media);
const entryPreviewable=(kind,item)=>kind==='figures'||PREVIEW_IMAGE_KINDS.includes(kind)&&!!(kind==='cg'?cgPreviewVariants(item).length:entryContent(item).media);
// What the large view shows of an entry at {outfit, face} (keys; empty = the default): {hash, outfits, faces}.
function entryPreviewShot(pack,kind,item,at) {
  if(kind==='cg'){const list=cgPreviewVariants(item),v=list.find(x=>x.id===at.face)||list.find(x=>x.id===item.variants.default)||list[0];
    return {hash:v?.content.media||null,outfits:[],faces:list.map(x=>x.id),face:v?.id};}
  if(kind!=='figures')return {hash:entryContent(item).media||null,outfits:[],faces:[]};
  const list=item.outfits||[],calm=matchBubbleMood('calm',item.emotions||[])?.id||'calm';
  const raw=list.find(o=>o.key===at.outfit)||list.find(o=>o.enabled)||list[0],outfit=raw&&figureOutfitView(item,raw),manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey];
  const view={...item,enabled:true,outfits:list.map(o=>({...o,enabled:true}))};
  const faces=outfit?figureEditorEmotions(item).filter(row=>emotionSlot(view,pack.sprites,row.id,{...outfit,enabled:true})?.hash).map(row=>row.id):[];
  const mood=faces.includes(at.face)?at.face:calm;
  const state=outfit?.sprite&&(emotionState(outfit,manifest,mood)||(mood===calm?emotionState(outfit,manifest,outfit.defaultEmotion):null));
  const hash=state&&outfit.sprite.assets?.[state.stage?.src||state.src];
  const avatar=!hash&&outfit?selectFigureAvatar(view,pack.sprites||{},{outfitKey:outfit.key,emotion:mood}):null;
  return {hash:hash||avatar?.hash||null,outfits:list.map(o=>o.key),outfit:outfit?.key,faces,face:mood};
}
function EntryPreview({binding,pack,rows,at,picked,onToggle,onMove,onClose}) {
  const row=rows[at],{kind,item}=row,n=rows.length,on=picked.has(row.key);
  const [pos,setPos]=React.useState({key:row.key}),where=pos.key===row.key?pos:{key:row.key},shot=entryPreviewShot(pack,kind,item,where);
  const move=d=>onMove((at+d+n)%n);
  const next=(list,now)=>list[(Math.max(0,list.indexOf(now))+1)%list.length];
  const keys=e=>{const d={ArrowLeft:-1,ArrowRight:1}[e.key];if(!d||n<2||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey)return;e.preventDefault();e.stopPropagation();move(d);};
  return h(PackImageView,{binding,packId:pack.manifest.id,hash:shot.hash,label:item.name,onClose,onKeyDown:keys,actions:[
    n>1&&{icon:'back',label:'上一个',onClick:()=>move(-1)},
    n>1&&{icon:'chevRight',label:'下一个',onClick:()=>move(1)},
    shot.outfits.length>1&&{icon:'outfit',label:'换服装',onClick:()=>setPos({key:row.key,outfit:next(shot.outfits,shot.outfit)})},
    shot.faces.length>1&&{icon:'swap',label:'换差分',onClick:()=>setPos({...where,face:next(shot.faces,shot.face)})},
    {icon:'check',label:on?'取消选择':'选择',pressed:on,onClick:()=>onToggle(row.key)}]});
}
