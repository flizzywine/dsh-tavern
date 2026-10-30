// 舞台设置 — the per-card page of the 「Tavern 舞台」 tab.
// The page starts from the card: switches (基础设置, sounds included), the packs it uses, its characters; at the end, folded
// by default, the opening (skin, 主角, greetings) and the prompts of every stage. Every control saves at once through one serial queue (card CAS and pack
// CAS chained on the newest revision); there is no save bar.
// no 基础 / 高级 switch — one page; the old stored mode is ignored.
// which first-level sections are folded, in the
// panel's localStorage UI preferences: {[section title]: true (folded) | false (open)}; a missing entry is the default.
const STAGE_FOLD_KEY='dsh-tavern:stage-panel-folded';
function stageFoldRead() { try { const value=JSON.parse(localStorage.getItem(STAGE_FOLD_KEY)||'{}'); return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch(_) { return {}; } }
function useStageFold(key,fallback=false) {
  const [folded,setState]=React.useState(()=>{const stored=stageFoldRead()[key];return typeof stored==='boolean'?stored:fallback;});
  const set=value=>{setState(value);try{localStorage.setItem(STAGE_FOLD_KEY,JSON.stringify({...stageFoldRead(),[key]:!!value}));}catch(_){}};
  return [folded,set];
}
const STAGE_RETURN_KEY='dsh:settings-return', STAGE_TAB='dsh-tavern:bubbles', VOICE_TAB='dsh-tts:voice';
// no 「双语配音」 switch — a figure whose voice language differs from the text gets its
// second line automatically (cardBubbleConfig / bubbleInstructionPreview).
const STAGE_CORE=['dialogue','voice','stage'];
const STAGE_REQUIRES={dialogue:[],voice:['dialogue'],stage:['dialogue']};
const STAGE_NAMES={dialogue:'对话气泡',voice:'配音',stage:'舞台模式'};
const STAGE_ICONS={dialogue:'bubble',voice:'voice',stage:'stage'};
const VOICE_LANGUAGES=[['ja','日语'],['zh','中文'],['en','英语']];
// the director command toggles live only on 舞台模式 › 可用演出
// (asset-pack-engine-ui.js); a card has no command chips and its stored stage.dimensions is never read or written.

// ---------- Pure helpers (tests/card-centric-stage-ui.test.mjs) ----------
// Global switches share the backend defaults; card preferences remain card-owned.
function stagePrefs(ext,engine) {
  return {widgets:false,...(ext?.stage||{}),
    dialogue:false,voice:true,stage:false,music:true,sfx:true,ambience:true,items:true,performance:true,entrance:true,...engine?.values?.stageToggles};
}
// What actually runs: every switch needs its upstream switches on.
function stageActive(prefs) { const dialogue=prefs.dialogue!==false; return {dialogue,voice:dialogue&&!!prefs.voice,stage:dialogue&&!!prefs.stage}; }
// A stage patch replaces only card preferences; `undefined` removes an override.
function stagePatch(ext,changes) {
  const next={...(ext?.stage||{})};
  Object.assign(next,changes);
  for(const key of Object.keys(next))if(next[key]===undefined)delete next[key];
  return {stage:next};
}
function stageEnable(key) { return Object.fromEntries([...STAGE_REQUIRES[key],key].map(k=>[k,true])); }
function stageMissing(key,active) { return [...STAGE_REQUIRES[key],key].filter(k=>!active[k]); }
// cards select packs; figure policy is authored in the library.
function emptyExtension() { return {schemaVersion:1,assetBindings:{boundPackIds:[]}}; }
// the packs whose entries 舞台设置 reads in full — lit for this card (全局 / 本卡:
// figures, skins, the opening pickers) or holding 模组 (the 模组 section), and a mod's built-in pack (its page lists those
// entries; mod-page.js) — in list order. Every other row stays a summary.
function stageDetailRows(rows,global,bound) {
  const builtin=typeof MOD_BUILTIN_PACKS==='object'?Object.values(MOD_BUILTIN_PACKS):[];
  return rows.filter(row=>!row.error&&row.manifest&&(global.includes(row.manifest.id)||bound.includes(row.manifest.id)||builtin.includes(row.manifest.id)||packCount(row,'widgets')>0));
}
async function stageReadDetails(binding,rows) {
  return (await Promise.all(rows.map(row=>row.summary?loadPackDetail(binding,row).catch(()=>null):row))).filter(pack=>pack?.manifest);
}
function unbindPatch(ext,packId) { return {assetBindings:{...ext.assetBindings,boundPackIds:ext.assetBindings.boundPackIds.filter(id=>id!==packId)}}; }
// Return intent shared with the 配音 panel (dsh-tts reads the same key, marks consumedBy and opens toTab).
function writeStageReturn(storage,{label,payload},now=Date.now()) {
  try { storage?.setItem(STAGE_RETURN_KEY,JSON.stringify({toTab:STAGE_TAB,label,payload,createdAt:now})); return true; } catch(_) { return false; }
}
// Session storage can be absent or denied (opaque origins); the return intent is then simply unavailable.
function stageSession() { try { return typeof sessionStorage==='undefined'?null:sessionStorage; } catch(_) { return null; } }
// ---------- Panel ----------
function StagePanel({binding,sessionId,cardPath,cardName,loading,nav,prompts}) {
  const [available,setAvailable]=React.useState(true),[view,setView]=React.useState('page');
  React.useEffect(()=>{setAvailable(true);return binding?.onUnavailable?.(()=>setAvailable(false));},[binding]);
  const ready=available&&binding?.service?.apiVersion===2, name=cardName||cardPath&&cardPath.split(/[\\/]/).pop().replace(/\.[^.]+$/,'');
  // 引擎设置 is a sub-page with the shared header (‹ 「返回舞台设置」 beside its
  // title, Esc too); coming back puts the focus on the 「舞台模式 ›」 it was opened from (stage mode entry).
  const engineReturn=React.useRef(false),takeEngineFocus=()=>{const value=engineReturn.current;engineReturn.current=false;return value;};
  // 智能判断 is a section of the 舞台模式 page; 提示词's ✎ opens that page at it
  // (engineFocus 'judge'; back just shows the page).
  const [engineFocus,setEngineFocus]=React.useState(null);
  if(view==='engine')return h('div',{className:'ap-ui ap-stage'},
    h(EnginePage,{binding,focus:engineFocus,onBack:()=>{engineReturn.current=!engineFocus;setView('page');}}));
  return h('div',{className:'ap-ui ap-stage'},
    // no page title — the tab already says 「舞台设置」 (kept for screen
    // readers only), so the content starts at the top.
    h('h2',{className:'ap-sr-only'},'舞台设置'),
    loading?h(Loading,{shape:'fields'}):
    // the empty page's one phrase + its action (R18) — the card library, where cards
    // (and card ZIPs) are imported and opened.
    !cardPath?h('div',{className:'ap-stage-nocard'},h(EmptyState,{text:'未打开人物卡',icon:h(Glyph,{name:'card'})}),
      nav?.openTab&&h(Button,{className:'ap-manage',onClick:()=>nav.openTab('dsh-tavern:cards')},'打开人物卡库')):
    h(StagePage,{key:cardPath,binding,ready,sessionId,path:cardPath,cardName:name,nav,prompts,onEngine:()=>{setEngineFocus(null);setView('engine');},takeEngineFocus,onJudge:()=>{setEngineFocus('judge');setView('engine');},onCommands:()=>{setEngineFocus('commands');setView('engine');}}));
}

// Serial writer: card patches (functions of the newest saved extension) and pack mutations
// share one queue so quick edits chain on fresh revisions. Pending card patches are applied optimistically
// on top of the last saved extension; a revision conflict re-reads once and re-applies the same intent.
function useStageWriter(binding,path,state,sessionId) {
  const store=React.useRef(null),queue=React.useRef(Promise.resolve()),[,bump]=React.useState(0),[status,setStatus]=React.useState('idle');
  // `rows` are the list summaries (every installed pack); `packs` the full documents
  // of the packs this page reads entries of (lit for this card, or holding 模组: stageDetailRows), read per pack by revision.
  if(state.value&&store.current?.loadedFrom!==state.value)store.current={loadedFrom:state.value,server:state.value.card,engine:state.value.engine,pending:[],rows:state.value.packs.filter(p=>!p.error),
    packs:new Map((state.value.details||[]).map(p=>[p.manifest.id,p])),asked:new Map((state.value.details||[]).map(p=>[p.manifest.id,p.revision]))};
  const s=store.current,render=()=>bump(n=>n+1);
  const conflict=e=>e?.code==='REVISION_CONFLICT'||/REVISION_CONFLICT|Card changed/i.test(String(e?.message||''));
  const apply=(base,fn)=>({...base,...fn(base)});
  async function refetchCard(){const fresh=await binding.rpc('getCardAssetBindings',{path});s.server={...s.server,...fresh};render();return fresh;}
  async function refetchRows(){const list=await loadPackRows(binding);s.rows=list.filter(p=>!p.error);render();return list;}
  // Reads the full documents a row newly needs (a pack lit meanwhile, a changed revision): each row revision is asked once.
  async function ensureDetails(){
    if(!s)return;const rows=stageDetailRows(s.rows,binding.globalEnabledPackIds||[],(s.server.extension||emptyExtension()).assetBindings.boundPackIds)
      .filter(row=>row.summary?s.asked.get(row.manifest.id)!==row.revision:!s.packs.has(row.manifest.id));
    if(!rows.length)return;for(const row of rows)s.asked.set(row.manifest.id,row.revision);
    const details=await stageReadDetails(binding,rows);for(const pack of details)s.packs.set(pack.manifest.id,pack);if(details.length)render();
  }
  async function refetchPacks(){const list=await refetchRows();await ensureDetails();return list;}
  // quiet: the caller says what failed where it happened (the 新人物 page's fields); the page head keeps no error for it.
  function enqueue(job,quiet=false){
    const run=queue.current.then(async()=>{setStatus('saving');const result=await job();setStatus('saved');return result;});
    queue.current=run.catch(e=>{setStatus(quiet?'idle':{error:errorText(e)});return refetchCard().catch(()=>{});});
    return run;
  }
  return {status,
    get engine(){return s?.engine;},
    global(patch,key='stageToggles'){
      return enqueue(async()=>{
        const save=engine=>binding.rpc('saveAssetEngineSettings',{expectedRevision:engine.revision,patch:{[key]:patch}});
        try{s.engine=await save(s.engine);}catch(e){if(!conflict(e))throw e;s.engine=await save(await binding.rpc('getAssetEngineSettings'));}
        render();return s.engine;
      });
    },
    get extension(){if(!s)return null;const base=s.server.extension;return s.pending.length?s.pending.reduce(apply,base||emptyExtension()):base||null;},
    get revision(){return s?.server.revision;},
    get packs(){return s?s.rows:[];},
    pack(id){return s?.packs.get(id);},
    ensureDetails,
    write(makePatch,{retryConflict=true}={}){
      s.pending.push(makePatch);render();
      return enqueue(async()=>{
        const attempt=async()=>{const saved=await binding.rpc('saveCardAssetBindings',{path,expectedRevision:s.server.revision,patch:makePatch(s.server.extension||emptyExtension())});s.server={...s.server,...saved};return saved;};
        try{try{return await attempt();}catch(e){if(!retryConflict||!conflict(e))throw e;await refetchCard();return await attempt();}}
        finally{s.pending=s.pending.filter(fn=>fn!==makePatch);render();}
      });
    },
    // a card RPC of its own (setCardVariableBinding, copyWidgetToCardPack, …) on the same
    // queue: fn(expectedRevision) → result; a revision conflict re-reads once and retries when `retry(error)` allows it.
    // The card is re-read afterwards so the next write starts from the new revision.
    cardOp(fn,{retry=()=>true}={}){
      return enqueue(async()=>{
        let result;
        try{result=await fn(s.server.revision);}
        catch(e){if(!conflict(e)||!retry(e))throw e;await refetchCard();result=await fn(s.server.revision);}
        await refetchCard();return result;
      });
    },
    // fn(snapshot) → pack mutation {snapshot,...}; the newest snapshot is kept for the next write.
    packOp(packId,fn,{quiet=false}={}){
      return enqueue(async()=>{
        const attempt=async()=>{let snapshot=s.packs.get(packId);if(!snapshot){snapshot=await binding.service.getPackSnapshot({packId});s.packs.set(packId,snapshot);}const result=await fn(snapshot);if(result?.status==='removed'){s.packs.delete(packId);s.asked.delete(packId);await refetchCard();await refetchRows();render();}else if(result?.snapshot){s.packs.set(packId,result.snapshot);s.asked.set(packId,result.snapshot.revision);render();void refetchRows().catch(()=>{});}return result;};
        try{return await attempt();}catch(e){if(!conflict(e))throw e;s.packs.set(packId,await binding.service.getPackSnapshot({packId}));return attempt();}
      },quiet);
    },
    reload:async()=>{await refetchCard();await refetchPacks();}};
}

function StagePage({binding,ready,sessionId,path,cardName,nav,prompts,onEngine,takeEngineFocus,onJudge,onCommands}) {
  const state=useLoad(binding,async()=>{
    const card=await binding.rpc('getCardAssetBindings',{path});
    if(!ready)return {card,packs:[],details:[],engine:null};
    await binding.loadSettings?.();
    const [packs,engine]=await Promise.all([loadPackRows(binding),binding.rpc('getAssetEngineSettings').catch(()=>null)]);
    const details=await stageReadDetails(binding,stageDetailRows(packs,binding.globalEnabledPackIds||[],card.extension?.assetBindings?.boundPackIds||[]));
    return {card,packs,details,engine};
  },[path,ready]);
  // portable figure voices do not require any preset in the machine voice catalogue.
  const services=useLoad(binding,async()=>binding.tts?(await binding.rpc('getAssetVoiceServices')).services:null,[binding.tts]);
  React.useEffect(()=>binding.tts?.subscribe?.(()=>services.reload()),[binding.tts]);
  const writer=useStageWriter(binding,path,state,sessionId);
  // A pack lit after the load (or a changed revision) is read in full once; the page renders again when it arrives.
  React.useEffect(()=>{void writer.ensureDetails().catch(()=>{});});
  const [confirm,setConfirm]=React.useState(null),[layer,setLayer]=React.useState(null),[packModal,setPackModal]=React.useState(null),[modPage,setModPage]=React.useState(null),[itemsPage,setItemsPage]=React.useState(false),[performancePage,setPerformancePage]=React.useState(false),[entrancePage,setEntrancePage]=React.useState(false),[narratorPage,setNarratorPage]=React.useState(false);
  // 设置向导 is a sub-page of this page (‹ / Esc back).
  const [wizard,setWizard]=React.useState(false),wizardReturn=React.useRef(null),[setupComplete,setSetupComplete]=React.useState(0),basicRef=React.useRef(null);
  // 人物's ＋ opens the 新人物 page as a sub-page (‹ / Esc back to the ＋).
  const [newFigure,setNewFigure]=React.useState(false),newFigureReturn=React.useRef(null);
  React.useEffect(()=>{if(!wizard && setupComplete){const section=basicRef.current;section?.scrollIntoView?.({block:'start'});section?.querySelector('.ap-section-toggle')?.focus?.({preventScroll:true});}},[wizard,setupComplete]);
  // the mod whose page was just left, so its row's 「›」 takes the focus back.
  const modReturn=React.useRef(null),narratorReturn=React.useRef(false),itemsReturn=React.useRef(false),performanceReturn=React.useRef(false),entranceReturn=React.useRef(false);
  // the 演出规则 editor and its in-place engine writes are gone.
  const ext=writer.extension;
  useStageSetupAutoOpen({binding,path,ready,stageOn:!!state.value&&!!ext?.assetBindings&&stageActive(stagePrefs(ext,writer.engine)).stage,open:()=>setWizard(true)});
  if(!state.value)return h('div',{className:'ap-card'},state.error?h(ErrorBox,{error:'读取舞台设置失败（'+state.error+'）',reload:state.reload}):h(Loading,{shape:'fields'}));
  if(!ext?.assetBindings)return h(StageFirstRun,{writer,cardName});
  const engine=writer.engine,prefs=stagePrefs(ext,engine),active=stageActive(prefs),packs=writer.packs;
  const ttsState=!binding.tts?'off':services.value&&!services.value.length?'empty':'ok';
  // machine service settings return to the page, never to a retired card voice editor.
  const openVoice=()=>{writeStageReturn(stageSession(),{label:'返回舞台设置',payload:{cardPath:path}});return nav?.openTab?.(VOICE_TAB);};
  const enable=key=>writer.global(stageEnable(key));
  const status=writer.status;
  const saveState=h('span',{className:'ap-save-state',role:'status','data-state':typeof status==='object'?'error':status},status==='saving'?'正在保存…':status==='saved'?'已保存':'');
  const wizardButton=stageSetupReady(binding)&&h('button',{type:'button',className:'ap-manage ap-wizard-open',ref:wizardReturn,onClick:()=>setWizard(true)},'设置向导');
  const ctx={binding,path,sessionId,cardName,setupComplete,basicRef,cardId:state.value.card.cardId,onEngine,takeEngineFocus,onJudge,onCommands,headTools:h('span',{className:'ap-stage-head-tools'},saveState,wizardButton),writer,ext,prefs,active,packs,engine,ttsState,nav,openVoice,enable,setConfirm,openLayer:render=>setLayer(()=>render),
    // tab (optional): 'gen' opens the figure on 生图, 'voice' on its 声音 page (设置向导 › 配角色).
    openPack:(packId,kind,figureId,tab)=>setPackModal({packId,kind,figureId,tab,at:Date.now()}),
    openNewFigure:stageSetupReady(binding)?()=>{newFigureReturn.current=typeof document==='undefined'?null:document.activeElement;setNewFigure(true);}:undefined,
    // a mod's settings open in place as a sub-page of 舞台设置 (模组 rows and
    // 提示词 › 模组 labels); the separate 模组库 tab is gone.
    // 物品 is a built-in capability now — a request for the retired items mod opens its page.
    openMod:state.value.card.cardId&&binding.engineRpc?modId=>modId==='core.items'?setItemsPage(true):setModPage(modId):undefined,
    onPerformances:()=>setPerformancePage(true),takePerformanceFocus:()=>{const value=performanceReturn.current;performanceReturn.current=false;return value;},
    onNarrator:()=>setNarratorPage(true),takeNarratorFocus:()=>{const value=narratorReturn.current;narratorReturn.current=false;return value;},
    onEntrances:()=>setEntrancePage(true),takeEntranceFocus:()=>{const value=entranceReturn.current;entranceReturn.current=false;return value;},
    onItems:()=>setItemsPage(true),takeItemsFocus:()=>{const value=itemsReturn.current;itemsReturn.current=false;return value;},
    takeModFocus:modId=>{if(modReturn.current!==modId)return false;modReturn.current=null;return true;}};
  // Dialogs render outside the page's size container so they position against the viewport.
  const closeNewFigure=()=>{setNewFigure(false);setTimeout(()=>{const back=newFigureReturn.current;if(back?.isConnected)back.focus?.({preventScroll:true});},0);};
  return h(React.Fragment,null,newFigure&&!wizard?h('div',{className:'ap-card ap-stage-page'},
    h(NewFigurePage,{ctx,parent:'舞台设置',ensurePack:()=>stageSetupCardPack(ctx),onBack:closeNewFigure,onCreated:closeNewFigure})):
    wizard?h('div',{className:'ap-card ap-stage-page'},
    h(StageSetupWizard,{ctx,onComplete:()=>{setWizard(false);setSetupComplete(value=>value+1);},onClose:()=>{setWizard(false);setTimeout(()=>wizardReturn.current?.focus?.(),0);}})):
    performancePage?h('div',{className:'ap-card ap-stage-page'},
    h(StagePerformancePage,{ctx,onBack:()=>{performanceReturn.current=true;setPerformancePage(false);}})):
    narratorPage?h('div',{className:'ap-card ap-stage-page'},
    h(StageNarratorPage,{ctx,onBack:()=>{narratorReturn.current=true;setNarratorPage(false);}})):
    entrancePage?h('div',{className:'ap-card ap-stage-page'},
    h(StageEntrancePage,{ctx,onBack:()=>{entranceReturn.current=true;setEntrancePage(false);}})):
    itemsPage?h('div',{className:'ap-card ap-stage-page'},
    h(StageItemsPage,{ctx,onBack:()=>{itemsReturn.current=true;setItemsPage(false);}})):
    modPage?h('div',{className:'ap-card ap-stage-page'},
    h(StageModPage,{ctx,cardId:state.value.card.cardId,modId:modPage,onBack:()=>{modReturn.current=modPage;setModPage(null);}})):
    h('div',{className:'ap-card ap-stage-page'},
    typeof status==='object'&&h(ErrorBox,{error:status.error,reload:()=>writer.reload()}),
    !ready&&h('p',{className:'ap-alert',role:'status'},'素材插件不可用'),
    // 基础设置 (the card's switches) → 模组 → 素材包 (pack section merge: with 导入导出) →
    // 人物 → 开场设置 → 提示词 (the 读音词典 is global, in the 配音 page: ReadingsEditor). (prompt view complete) 导演指令 is a row of 提示词 › 2 导演, no section of its
    // own. no 变量对照 section — each mod reads card variables through its own
    // settings (自动 / 引用).
    // no 全局设置 section. the
    // 「舞台模式 ›」 row opens the 舞台模式 page (the former 舞台引擎 page); there is no separate engine row.
    // 模组 sits directly below 基础设置, above 素材包.
    h(StageSwitches,{ctx}),
    h(StageModSection,{ctx,cardId:ctx.cardId}),
    h(StagePackSection,{ctx,ready,state}),
    ready&&h(StageCastEntry,{ctx}),
    // 开场设置 and 提示词 always end the page, folded by default.
    h(StageOpenings,{ctx}),
    h(StagePrompts,{ctx,prompts})),
    // packs-v3: the pack modal and other layers sit under the shared confirmation, so it always shows on top.
    packModal&&ready&&h(StagePackModal,{key:packModal.packId+':'+packModal.at,ctx,packId:packModal.packId,kind:packModal.kind,figureId:packModal.figureId,tab:packModal.tab,onClose:()=>setPackModal(null)}),
    // The layer gets the live ctx as well, so a layer that stays open across saves renders the newest state.
    layer&&layer(()=>setLayer(null),ctx),
    confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)}));
}

// 默认舞台皮肤 is the CONFIG skin select in the panel's paint — the trigger shows the
// chosen skin's mini stage and name, the menu every skin with its own mini stage and a ✓; a search box once the list is
// long. The thumbnails are the CONFIG's (.fork-gal-config-theme-art): a built-in paints its theme scope, a pack skin the
// palette of its own document (default level), else its initial. Saves stage.defaultSkin at once.
const STAGE_BUILTIN_SKINS=[['classic','经典'],['gothic','哥特'],['magical','魔法少女'],['crt','显像管'],['aero','千禧晴空']];
const SKIN_SEARCH_MIN=8;
// pack skin refs compare by identity; this module owns its key (the widget page's refKey is function-local).
const stageSkinKey=value=>typeof value==='string'?value:JSON.stringify([value?.packId,value?.kind,value?.assetId]);
function stageSkinPalette(document) {
  const level=document?.levels?.[document.levels.default];
  if(level?.look==='theme')return null;
  const look=level?{...document,...Object.fromEntries(['textbox','textStyle','ui'].filter(key=>Object.hasOwn(level,key)).map(key=>[key,level[key]]))}:document;
  const paint={...look?.textbox?.paint,...look?.ui};
  if(!paint.bg)return null;
  const fg=paint.fg||paint.bg,radius=look.ui?.radius??look.textbox?.shape?.radius;
  return {bg:paint.bg,fg,accent:paint.accent||look.textStyle?.emphasis||fg,border:paint.border||paint.fgMuted||fg,radius:typeof radius==='number'?radius:10};
}
// packIds: the packs whose skins are offered (the global default offers the globally enabled packs').
function stageSkinChoices(ctx,packIds=ctx.ext.assetBindings.boundPackIds) {
  const choices=STAGE_BUILTIN_SKINS.map(([value,label])=>({value,label}));
  for(const row of ctx.packs) { const pack=packIds.includes(row.manifest.id)&&ctx.writer.pack(row.manifest.id); if(!pack)continue;
    for(const asset of pack.manifest.assets.filter(a=>a.kind==='skins')) {
      const document=pack.skins?.[asset.id];if(!document)continue;
      choices.push({value:{packId:pack.manifest.id,kind:'skins',assetId:asset.id},label:document.label,note:document.directorNote,palette:stageSkinPalette(document)});
    }
  }
  return choices;
}
function StageSkinArt({choice}) {
  const marks=[h('i',{key:'n',className:'art-name'}),h('i',{key:'l',className:'art-line'}),h('i',{key:'s',className:'art-line is-short'}),h('i',{key:'g',className:'art-gem'})];
  if(typeof choice.value==='string')return h('span',{className:'fork-gal-config-theme-art fork-gal-theme-scope','data-theme':choice.value,'aria-hidden':true},marks);
  const p=choice.palette;
  if(!p)return h('span',{className:'fork-gal-config-theme-art is-unknown','aria-hidden':true},h('b',null,Array.from(choice.label||'')[0]||'?'));
  return h('span',{className:'fork-gal-config-theme-art','aria-hidden':true,style:{'--gal-ui-surface-2':p.bg,'--gal-ui-surface':p.bg,'--gal-ui-ink':p.fg,'--gal-ui-accent':p.accent,'--gal-ui-line':p.border,
    '--gal-ui-gem':'polygon(0 0, 100% 0, 50% 100%)','--gal-ui-gem-width':'9px','--gal-ui-gem-height':'7px','--gal-ui-gem-fill':p.accent,'--gal-ui-radius':p.radius+'px'}},marks);
}
function StageSkinPicker({label,choices,value,onChange}) {
  const [query,setQuery]=React.useState(''),trigger=React.useRef(null),back=()=>setTimeout(()=>trigger.current?.focus?.(),0);
  const current=choices.find(choice=>stageSkinKey(choice.value)===stageSkinKey(value))||null,q=query.trim().toLowerCase();
  const shown=q?choices.filter(choice=>String(choice.label).toLowerCase().includes(q)):choices;
  return h(Popover,{label,fit:true,limit:440,className:'ap-skin-anchor',
    trigger:({toggle,open})=>h('button',{ref:trigger,type:'button',className:'ap-skin-trigger','aria-haspopup':'menu','aria-expanded':open,'aria-label':label+'：'+(current?.label||'未选择'),
      onClick:()=>{setQuery('');toggle();}},current&&h(StageSkinArt,{choice:current}),h('span',{className:'ap-skin-name'},current?.label||'未选择'),h(Glyph,{name:'chevDown'})),
    content:close=>h('div',{className:'ap-skin-menu',ref:openingMenuFocus,onKeyDown:e=>openingMenuKeys(e,back)},
      choices.length>SKIN_SEARCH_MIN&&h(PackSearchBox,{label:'搜索皮肤',value:query,onChange:setQuery,className:'is-compact'}),
      shown.map(choice=>{const on=choice===current;
        return h('button',{key:stageSkinKey(choice.value),type:'button',role:'menuitemradio','aria-checked':on,className:'ap-menu-item ap-skin-option',title:choice.note||undefined,
          onClick:()=>{close();if(!on)onChange(choice.value);back();}},h(StageSkinArt,{choice}),h('span',{className:'ap-skin-name'},choice.label),on&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})));}),
      !shown.length&&h(EmptyState,{compact:true,noun:'皮肤',query,onClear:()=>setQuery('')}))});
}
// 「默认皮肤」 in 基础设置 is the global default (engine
// dialogueTheme) - long-term, every card; a card's own skin and the player's 本卡皮肤 (stage CONFIG › 画面) come first. It works
// without 舞台模式 (the text box shows whenever bubbles are on).
const STAGE_SKIN_HELP='所有卡默认用这套皮肤；卡自带皮肤或在舞台 CONFIG › 画面 选了「本卡皮肤」的卡除外。';
function StageGlobalSkin({ctx}) {
  // The engine's custom dialogue themes (dsh-dialogue-theme presets) are global choices too.
  const engine=ctx.writer.engine,selected=engine?.values?.dialogueTheme;
  const choices=[...stageSkinChoices(ctx,ctx.binding?.globalEnabledPackIds||[]),...(engine?.values?.dialogueThemes||[]).map(theme=>({value:theme.id,label:theme.name}))];
  if(!engine?.values||engine.writable===false)return null;
  return h(InlineRow,{label:'默认皮肤',className:'ap-stage-skin-row',help:h(Help,{text:STAGE_SKIN_HELP,label:'默认皮肤 说明'})},
    h(StageSkinPicker,{label:'默认皮肤',choices,value:selected,onChange:value=>ctx.writer.global(value,'dialogueTheme')}),
    !choices.some(choice=>stageSkinKey(choice.value)===stageSkinKey(selected))&&h(HintLine,{compact:true,text:'所选皮肤不可用，请重新选择'}));
}

// 5.2: the only solid button on the page.
function StageFirstRun({writer,cardName}) {
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  async function start(){setBusy(true);setError('');try{await writer.write(()=>({assetBindings:{boundPackIds:[]},stage:{}}));}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  return h('div',{className:'ap-first-run'},
    h('p',{className:'ap-first-title'},'这张卡还没有舞台设置'),
    h('div',{className:'ap-inline-actions is-start'},h(Button,{primary:true,disabled:busy,onClick:start},h(Glyph,{name:'bubble'}),busy?'正在开启…':'启用舞台（对话气泡）'),
      // this is the stage's prerequisite, so the button names the stage, not only the bubbles.
      h(Help,{text:'开启后聊天顶栏出现「舞台」入口，正文按带头像的对话气泡显示；之后可以给角色配形象和声音。'})),
    error&&h('p',{className:'ap-alert',role:'alert'},error));
}

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
// The row's 「›」 does the opening (one library pack opens it, several list them).
const pressRowJump=row=>row.querySelector('.ap-kind-jump')?.click();
// A state that needs an action (not an explanation, panel-ui-design.md §一.5): a warning mark + one link chip, never a
// grey note. Compact (on a switch row): the state is only the mark's tooltip / accessible name and the chip's
// accessible name; standalone: the short state stays beside the mark in normal ink.
function HintLine({text,action,onAction,compact}) {
  const chip=action&&h(Button,{className:'ap-hint-chip',...(compact?{'aria-label':action+'（'+text+'）',title:text}:{}),onClick:onAction},action);
  if(compact)return h('span',{className:'ap-hint-line is-compact'},h('span',{className:'ap-hint-mark',role:'img','aria-label':text,title:text},h(Glyph,{name:'warning'})),chip);
  return h('p',{className:'ap-hint-line'},h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),h('span',null,text),chip);
}
// The bound figures' confirmed synthesis rejections (getFigureVoiceEditor: exact service/model/voice the figure uses now,
// never a provider list). a synthesis result or a pack/engine change re-reads it
// in place — the previous answer stays until the new one arrives, so the ⚠ never blinks between reads.
function useStageConfirmedVoiceWarnings(ctx) {
  const rows=stageFigureRows(ctx).filter(row=>row.figure?.enabled&&row.figure.voice&&row.figure.voice.source!==null);
  const key=JSON.stringify(rows.map(row=>[row.ref,row.pack.revision]));
  const state=useVoiceLoad(async()=>Promise.all(rows.map(async row=>{
    try {
      const result=await ctx.binding.rpc('getFigureVoiceEditor',row.ref);
      return (result.issues||[]).filter(issue=>['QWEN_MODEL_NOT_FOUND','QWEN_VOICE_UNSUPPORTED'].includes(issue.code)).map(issue=>row.figure.name+'：'+voiceIssueText(issue.code));
    } catch { return []; }
  })),[ctx.binding]);
  useVoiceRefresh(ctx.binding,state.reload,[key,ctx.engine?.revision]);
  return state.value?.flat()||[];
}
function stageVoiceWarning(ctx,confirmed) {
  if(ctx.ttsState==='off')return '配音插件未启用';
  if(ctx.ttsState==='empty')return '没有可用的语音服务';
  return confirmed.join('；');
}
// 「配音」 opens 声音设置 like BGM › — a quiet 「›」 right after the name (the
// whole row opens it too, see SwitchRow onOpen); a current problem is a ⚠ beside them (text in its tooltip), no pill.
function StageVoiceJump({ctx,warning}) {
  const jump=ctx.nav?.openTab&&h('button',{type:'button',className:'ap-kind-jump','aria-label':'声音设置'+(warning?'（'+warning+'）':''),title:'声音设置',onClick:()=>ctx.openVoice()},h(Glyph,{name:'chevRight'}));
  const mark=warning&&h('span',{className:'ap-hint-mark ap-switch-warn',role:'img','aria-label':warning,title:warning,onClick:e=>e.preventDefault()},h(Glyph,{name:'warning'}));
  return mark||jump?h(React.Fragment,null,jump,mark):null;
}
function StageVoiceRow({ctx,row}) {
  const warning=stageVoiceWarning(ctx,useStageConfirmedVoiceWarnings(ctx));
  return row('voice',h(StageVoiceJump,{ctx,warning}),ctx.nav?.openTab?()=>ctx.openVoice():undefined);
}
const stageNeedText=(key,active)=>'需要'+stageMissing(key,active).filter(k=>k!==key).map(k=>STAGE_NAMES[k]).join('和');

// 「基础设置」 — the card's switches in one list, the sounds (used far more often than
// 导演指令) right under 舞台模式. A sound on: this card plays that kind and the director may use it (stage.<key>
// follows the default); off: neither (stage.<key> = false; cardEngineSettings / the audio projection). The engine
// dimension of 环境音 is `soundscape`; a kind switched off for every card is the only warning.
const STAGE_BASIC_HELP='这些开关对所有卡生效；某张卡没有对应素材时，导演不会收到相关说明。';
const AUDIO_ROWS=[['music','BGM','music','music'],['sfx','音效','sfx','sfx'],['ambience','环境音','ambience','soundscape']];
function StageSwitches({ctx}) {
  const {prefs,active,writer}=ctx,set=(key,value)=>writer.global({[key]:value});
  const row=(key,status,onOpen)=>{const blocked=stageMissing(key,active).some(k=>k!==key);
    return h(SwitchRow,{key,label:STAGE_NAMES[key],icon:STAGE_ICONS[key],checked:prefs[key],disabled:blocked,help:blocked?(key==='stage'?'先打开对话气泡':stageNeedText(key,active)):undefined,onChange:v=>set(key,v),status,onOpen});};
  // Sounds play on the stage: greyed (stored value kept) while 舞台模式 is off, like a dependent switch.
  const sound=([key,label,icon])=>{const missing=stageMissing('stage',active);
    return h(SwitchRow,{key,label,icon,checked:prefs[key]!==false,disabled:missing.length>0,help:missing.length?'需要'+missing.map(k=>STAGE_NAMES[k]).join('和'):undefined,
      onChange:v=>set(key,v),status:h(StageKindJump,{ctx,kind:key,label}),onOpen:ctx.nav?.openLibrary&&stageKindPacks(ctx,key).length?pressRowJump:undefined});};
  return h('div',{ref:ctx.basicRef},h(StageSection,{title:'基础设置',help:STAGE_BASIC_HELP,action:ctx.headTools,reveal:ctx.setupComplete},
    row('dialogue'),
    active.voice?h(StageVoiceRow,{key:'voice',ctx,row}):row('voice'),
    h(StageNarratorRow,{key:'narrator',ctx}),
    row('stage',h(StageModeJump,{ctx}),ctx.onEngine?()=>ctx.onEngine():undefined),
    h(StageAutoChoicesRow,{key:'auto-choices'}),
    h(StageGlobalSkin,{key:'skin',ctx}),
    AUDIO_ROWS.map(sound),
    h(StageItemsRow,{key:'items',ctx,set}),
    h(StagePerformanceRow,{key:'performance',ctx,set}),
    h(StageEntranceRow,{key:'entrance',ctx,set})));
}
// 旁白配音 — 舞台设置 › 基础设置 「旁白配音 ›」 and its page. Two layers like a mod's settings
// (ui-design.md R8 / §三.25): the global layer (engine `narrator`, complete) and this card's (stage.narrator, only the keys it
// overrides). The host reads the same layers (card-stage-settings.js effectiveNarrator); the stage speaks with config.narrator.

const NARRATOR_DEFAULT=Object.freeze({enabled:false,voice:null});
function narratorLayers(ext,engine) {
  const global={...NARRATOR_DEFAULT,...engine?.values?.narrator},card=ext?.stage?.narrator||{};
  return {global,card,effective:{enabled:(card.enabled??global.enabled)===true,voice:card.voice!==undefined?card.voice:global.voice}};
}
const narratorVoiceKey=voice=>!voice?'':voice.browser?'browser:'+voice.browser:'figure:'+JSON.stringify([voice.packId,voice.figureId]);
function narratorVoiceFromKey(key) {
  if(!key)return null;
  if(key.startsWith('browser:'))return {browser:key.slice(8)};
  const [packId,figureId]=JSON.parse(key.slice(7));
  return {packId,figureId};
}
// The basic row's switch writes the layer that decides it now: this card's when it overrides the switch, else the global one.
const narratorSwitchScope=ext=>ext?.stage?.narrator?.enabled!==undefined?'card':'global';
// A card layer patch: `undefined` removes a key; an empty layer removes stage.narrator.
function narratorCardPatch(ext,changes) {
  const next={...(ext?.stage?.narrator||{}),...changes};
  for(const key of Object.keys(next))if(next[key]===undefined)delete next[key];
  return stagePatch(ext,{narrator:Object.keys(next).length?next:undefined});
}
// The voices a narrator can speak with: every figure voice of the packs this card uses, then the browser's system voices.
function narratorVoiceOptions(rows,browserVoices) {
  const figures=rows.filter(row=>row.figure&&row.figure.voice&&row.figure.voice.source!==null&&row.pack?.manifest.voiceLibrary?.voices[row.figure.voice.voice])
    .map(row=>({value:narratorVoiceKey(row.ref),label:row.figure.name,group:'人物'}));
  return [{value:'',label:'未选择'},...figures,...(browserVoices||[]).map(voice=>({value:narratorVoiceKey({browser:voice.id}),label:voice.label,group:'浏览器朗读'}))];
}

function narratorWrite(ctx,scope,changes) {
  if(scope==='card')return ctx.writer.write(ext=>narratorCardPatch(ext,changes));
  const reset=Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,value===undefined?NARRATOR_DEFAULT[key]:value]));
  return ctx.writer.global(reset,'narrator');
}
function StageNarratorRow({ctx}) {
  const jump=React.useRef(null),{effective}=narratorLayers(ctx.ext,ctx.engine),blocked=!ctx.active.voice;
  React.useEffect(()=>{if(ctx.takeNarratorFocus?.())jump.current?.focus?.();},[]);
  return h(SwitchRow,{label:'旁白配音',icon:'voice',checked:effective.enabled,disabled:blocked,help:blocked?stageNeedText('voice',ctx.active):undefined,
    onChange:v=>narratorWrite(ctx,narratorSwitchScope(ctx.ext),{enabled:v}),onOpen:ctx.onNarrator?pressRowJump:undefined,
    status:ctx.onNarrator?h('button',{type:'button',ref:jump,className:'ap-kind-jump','aria-label':'旁白配音设置',title:'旁白配音设置',onClick:()=>ctx.onNarrator()},h(Glyph,{name:'chevRight'})):null});
}
function StageNarratorPage({ctx,onBack}) {
  const root=React.useRef(null),[scope,setScope]=React.useState(()=>ctx.ext?.stage?.narrator?'card':'global');
  const browser=useVoiceLoad(()=>typeof window!=='undefined'&&window.speechSynthesis?browserSpeechVoiceList(window.speechSynthesis):[],[]);
  React.useEffect(()=>{root.current?.querySelector('button')?.focus();},[]);
  const {global,card,effective}=narratorLayers(ctx.ext,ctx.engine);
  const shown=scope==='card'?effective:global,blocked=!ctx.active.voice;
  const own=key=>scope==='card'?card[key]!==undefined:JSON.stringify(global[key])!==JSON.stringify(NARRATOR_DEFAULT[key]);
  const dot=key=>own(key)?h(OverrideDot,{layer:scope}):null;
  const reset=key=>own(key)?h(ResetButton,{key:'reset',label:scope==='card'?'恢复为全局':'恢复默认',onClick:()=>narratorWrite(ctx,scope,{[key]:undefined})}):null;
  const options=narratorVoiceOptions(stageFigureRows(ctx),browser.value);
  const value=narratorVoiceKey(shown.voice),missing=value&&!options.some(option=>option.value===value);
  return h('article',{ref:root,className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},
    h(SubpageHead,{parent:'舞台设置',title:'旁白配音',onBack}),
    h(StageSection,{title:'设置',foldKey:'narrator/settings',need:'voice',active:ctx.active,onEnable:ctx.enable,
      action:h(ScopeSwitch,{value:scope,onChange:setScope,cardName:ctx.cardName||'本卡',disabled:blocked})},
      h(InlineGrid,{columns:1,label:'旁白配音设置'},
        h(InlineRow,{label:'旁白配音',help:dot('enabled')},
          h(Switch,{bare:true,label:'旁白配音',checked:shown.enabled===true,onChange:v=>narratorWrite(ctx,scope,{enabled:v})}),reset('enabled')),
        h(InlineField,{kind:'menu',label:'声音',help:dot('voice'),value:missing?'':value,options,placeholder:'未选择',
          onCommit:key=>narratorWrite(ctx,scope,{voice:narratorVoiceFromKey(key)}),
          trail:[missing?h(HintLine,{key:'missing',compact:true,text:'所选声音不可用，请重新选择'}):null,reset('voice')]}))));
}
// 「入场演出 ›」 - the one global switch of the stage's opening
// performance (engine stageToggles.entrance, default on), placed like 演出组合; a card differs only by its packs' 入场演出
// entries (蓝灯 / 关闭). Its page lists this card's entries.
function StageEntranceRow({ctx,set}) {
  const jump=React.useRef(null),missing=stageMissing('stage',ctx.active);
  React.useEffect(()=>{if(ctx.takeEntranceFocus?.())jump.current?.focus?.();},[]);
  return h(SwitchRow,{label:'入场演出',icon:'entrances',checked:ctx.prefs.entrance!==false,disabled:missing.length>0,
    help:missing.length?'需要'+missing.map(k=>STAGE_NAMES[k]).join('和'):undefined,
    onChange:v=>set('entrance',v),onOpen:ctx.onEntrances?pressRowJump:undefined,
    status:ctx.onEntrances?h('button',{type:'button',ref:jump,className:'ap-kind-jump','aria-label':'入场演出素材',title:'入场演出素材',onClick:()=>ctx.onEntrances()},h(Glyph,{name:'chevRight'})):null});
}
function StageEntrancePage({ctx,onBack}) {
  const root=React.useRef(null);
  React.useEffect(()=>{root.current?.querySelector('button')?.focus();},[]);
  return h('article',{ref:root,className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},
    h(SubpageHead,{parent:'舞台设置',title:'入场演出',help:'进入舞台时代替「载入中」播放的开场演出；载入完成后单击可跳过。',onBack}),
    h(ModEntries,{ctx,modId:'core.entrance',kind:'entrances'}));
}
function StagePerformanceRow({ctx,set}) {
  const jump=React.useRef(null),missing=stageMissing('stage',ctx.active);
  React.useEffect(()=>{if(ctx.takePerformanceFocus?.())jump.current?.focus?.();},[]);
  return h(SwitchRow,{label:'演出组合',icon:'performances',checked:ctx.prefs.performance!==false,disabled:missing.length>0,
    help:missing.length?'需要'+missing.map(k=>STAGE_NAMES[k]).join('和'):undefined,
    onChange:v=>set('performance',v),onOpen:ctx.onPerformances?pressRowJump:undefined,
    status:ctx.onPerformances?h('button',{type:'button',ref:jump,className:'ap-kind-jump','aria-label':'演出组合素材',title:'演出组合素材',onClick:()=>ctx.onPerformances()},h(Glyph,{name:'chevRight'})):null});
}
function StagePerformancePage({ctx,onBack}) {
  const root=React.useRef(null);
  React.useEffect(()=>{root.current?.querySelector('button')?.focus();},[]);
  return h('article',{ref:root,className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},
    h(SubpageHead,{parent:'舞台设置',title:'演出组合',onBack}),
    h(ModEntries,{ctx,modId:'core.performance',kind:'performances'}));
}
// 「物品 ›」 — the built-in item capability's one global switch, placed like the sounds
// (it plays on the stage: greyed while 舞台模式 is off); the name and the quiet 「›」 open its page (StageItemsPage).
function StageItemsRow({ctx,set}) {
  const jump=React.useRef(null),missing=stageMissing('stage',ctx.active);
  React.useEffect(()=>{if(ctx.takeItemsFocus?.())jump.current?.focus?.();},[]);
  return h(SwitchRow,{label:'物品',icon:'item',checked:ctx.prefs.items!==false,disabled:missing.length>0,help:missing.length?'需要'+missing.map(k=>STAGE_NAMES[k]).join('和'):undefined,
    onChange:v=>set('items',v),onOpen:ctx.onItems?pressRowJump:undefined,
    status:ctx.onItems?h('button',{type:'button',ref:jump,className:'ap-kind-jump','aria-label':'物品设置',title:'物品设置',onClick:()=>ctx.onItems()},h(Glyph,{name:'chevRight'})):null});
}
// 「舞台模式 ›」 like 「配音 ›」 — the switch on the right, the name and the quiet
// 「›」 open the 舞台模式 page (导演模型 → 智能判断 → 可用演出 …; the director model is chosen there, default 跟随前台). Coming back
// from the page focuses the 「›」.
function StageModeJump({ctx}) {
  const jump=React.useRef(null);
  React.useEffect(()=>{if(ctx.takeEngineFocus?.())jump.current?.focus?.();},[]);
  return ctx.onEngine?h('button',{type:'button',ref:jump,className:'ap-kind-jump','aria-label':'舞台模式设置',title:'舞台模式设置',onClick:()=>ctx.onEngine()},h(Glyph,{name:'chevRight'})):null;
}
// 「自动生成选项」 is a basic, every-card setting and lives only here (moved out of 酒馆设置 ›
// 候选项 and the stage CONFIG): the global candidateAutoGenerate through the one hook (auto-choices-preference.js). Needs no stage
// switch: it also serves the chat view. A save failure is the row's ⚠.
const STAGE_AUTO_CHOICES_HELP='每轮正文完成后自动生成选项；不补生成旧回复，失败可手动重试。';
function StageAutoChoicesRow() {
  if(typeof autoChoices!=='function')return null;
  return h(StageAutoChoicesSwitch);
}
function StageAutoChoicesSwitch() {
  const {enabled,loading,busy,error,save}=autoChoices('getTavernSettings');
  return h(SwitchRow,{label:'自动生成选项',icon:'select',help:STAGE_AUTO_CHOICES_HELP,checked:enabled,disabled:loading||busy,onChange:v=>save(v),
    status:error?h(HintLine,{compact:true,text:error}):null});
}
// the quiet 「›」 on a 基础设置 row — the 素材库 at that kind's tab (nav.openLibrary, the same
// deep link the library consumes) for the packs this card uses (全局 first, then 本卡). One pack opens directly; several
// list their names. Nothing when no pack the card uses has that kind or the library cannot be reached.
// 入场演出 only ever come from the card's own packs (lib/domain/stage-entrance.js): a global pack's are not listed.
const CARD_ONLY_KINDS=['entrances'];
function stageKindPacks(ctx,kind) {
  const cardOnly=CARD_ONLY_KINDS.includes(kind),global=cardOnly?[]:ctx.binding?.globalEnabledPackIds||[];
  const bound=ctx.ext.assetBindings.boundPackIds.filter(id=>!cardOnly||id!==ctx.ext.modConfigPackId);
  // 人物 are the pack's figures, not assets (the 素材清单 group of 人物 jumps there too).
  const has=pack=>packCount(pack,kind)>0;
  const used=ctx.packs.filter(pack=>!pack.error&&pack.manifest&&(global.includes(pack.manifest.id)||bound.includes(pack.manifest.id))&&has(pack));
  return [...used.filter(pack=>global.includes(pack.manifest.id)),...used.filter(pack=>!global.includes(pack.manifest.id))];
}
function StageKindJump({ctx,kind,label,packIds}) {
  // packIds (optional) narrows the choice to the packs a prompt group actually comes from.
  const packs=ctx.nav?.openLibrary?stageKindPacks(ctx,kind).filter(pack=>!packIds?.length||packIds.includes(pack.manifest.id)):[];
  if(!packs.length)return null;
  const go=pack=>ctx.nav.openLibrary({packId:pack.manifest.id,kind});
  const name='在舞台素材查看'+label;
  if(packs.length===1)return h('button',{type:'button',className:'ap-kind-jump','aria-label':name,title:name,onClick:()=>go(packs[0])},h(Glyph,{name:'chevRight'}));
  return h(Popover,{label:name,className:'ap-kind-jump-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-kind-jump','aria-label':name,title:name,'aria-expanded':open,onClick:toggle},h(Glyph,{name:'chevRight'})),
    content:close=>packs.map(pack=>h(MenuItem,{key:pack.manifest.id,onClick:()=>{close();go(pack);}},pack.manifest.name))});
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

// 「当前素材包」 lists the packs this card uses as
// (global-first: 全局 rows first, then 本卡; each band keeps binding order, then global-only ones) the shared pack row with a read-only state tag. 「管理」 grows the same section in place into all
// installed packs with the state tag (search, kind tabs, 当前使用 frozen on top); 「完成」 shrinks it back. A pack name
// opens the shared pack modal. No undo; unbinding a pack that a character's figure comes from asks first.
// 当前素材包 and 导入导出 are one section, 「素材包 N (?)」. Its head
// holds 管理 · 导出 · 导入 (导入 = the 导入卡 ZIP flow). 导出 enters selection mode: a house-style check per row (本卡 on,
// 全局 off — the old 「一起导出」 defaults) with the pack's size, the head becomes 取消 · 导出, and confirming exports the
// card with exactly the checked packs (none checked → the card alone), then leaves the mode.
// a row is name, faces and the 全局 / 本卡 tag only — no size, no per-row
// 导出 icon (a single pack is exported from the 素材库). A pack that holds only 模组 is not listed: the 「模组」 section
// shows it; the card export still takes it along while one of its widgets is on for this card.
const STAGE_PACKS_HELP='这张卡用到的素材包，「导出」把人物卡连同勾选的素材包和开着的模组打成 ZIP，「导入」打开这样的 ZIP。';
function StagePackSection({ctx,ready,state}) {
  const {binding,ext}=ctx,scope=usePackScope({binding,ctx,packs:ctx.packs});
  const [manage,setManage]=React.useState(false),[query,setQuery]=React.useState(''),[kind,setKind]=React.useState(''),[sort,setSort]=usePackSort(),frozen=React.useRef(null);
  const [picking,setPicking]=React.useState(null),work=useTask(binding);
  const packs=ctx.packs.filter(p=>!stageWidgetOnlyPack(p)),hidden=new Set(ctx.packs.filter(stageWidgetOnlyPack).map(p=>p.manifest.id));
  // the private config carrier is deliberately absent from the public catalogue, not missing.
  if(ext.modConfigPackId)hidden.add(ext.modConfigPackId);
  const ids=packs.map(p=>p.manifest.id),byId=new Map(packs.map(p=>[p.manifest.id,p])),bound=ext.assetBindings.boundPackIds.filter(id=>!hidden.has(id)),global=binding.globalEnabledPackIds||[];
  const effective=globalFirst([...bound,...ids.filter(id=>global.includes(id)&&!bound.includes(id))],global);
  if(manage&&!frozen.current)frozen.current=new Map(effective.map(id=>[id,global.includes(id)?0:1]));if(!manage)frozen.current=null;
  // The card ZIP import: a picked file opens the 导入卡片 sheet (CardImportSheet, unchanged); 「换一个文件」 picks again.
  const picker=React.useRef(null),serial=React.useRef(0),pick=()=>picker.current?.click?.();
  const importFile=file=>{const key='card-import-'+(++serial.current);
    ctx.openLayer(close=>h(CardImportSheet,{key,binding,path:ctx.path,file,cardName:ctx.cardName,onPick:pick,onClose:close,onDone:()=>{close();ctx.writer.reload();state?.reload?.();}}));};
  const startPicking=()=>setPicking(new Set(effective.filter(id=>byId.has(id)&&!global.includes(id))));
  const flip=id=>setPicking(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  // The widget-only packs whose widgets are on for this card go along (the 模组 section is where they are chosen).
  const widgetPacks=picking?[...new Set(stageWidgetRows(ctx).filter(row=>row.state!=='off'&&hidden.has(row.packId)).map(row=>row.packId))]:[];
  const chosen=picking?[...effective.filter(id=>picking.has(id)),...widgetPacks]:[],missing=picking?stageExportMissing(chosen.map(id=>ctx.writer.pack(id)).filter(Boolean),new Set(chosen)):[];
  const exportCard=()=>work.task(async()=>{await binding.download(await binding.service.exportCardBundle({path:ctx.path,expectedRevision:ctx.writer.revision,packIds:chosen}));setPicking(null);});
  const name=id=>(byId.get(id)||ctx.packs.find(p=>p.manifest.id===id))?.manifest.name||'缺失的素材包',busy=work.busy;
  // Selection mode: the check, then the pack's size beside it (it only helps while choosing what goes with the card).
  const lead=id=>{if(!picking)return null;const pack=byId.get(id),size=pack?stageBytesText(stagePackBytes(pack)):'';
    return h(React.Fragment,null,h('button',{type:'button',role:'checkbox',className:'ap-pack-check','aria-checked':picking.has(id),'aria-label':name(id),disabled:!byId.has(id)||busy,onClick:()=>flip(id)},
      h('span',{className:'ap-check-mark','aria-hidden':true},picking.has(id)&&h(Glyph,{name:'check'}))),size&&h('span',{className:'ap-pack-size'},size));};
  // every row previews the pack's content after its name.
  const row=control=>id=>h(PackRow,{key:id,id,pack:byId.get(id),scope,kind:manage?kind:'',onOpen:(packId,k)=>ctx.openPack(packId,k),control,previews:true,
    ...(control==='static'?{lead:lead(id)}:{})});
  const pass=packFilter(byId,query,kind);
  const head=!ready?null:manage?h(Button,{className:'ap-manage is-done','aria-expanded':true,onClick:()=>{setManage(false);setQuery('');setKind('');}},'完成'):
    picking?h('span',{className:'ap-pack-head-actions'},
      h(Button,{className:'ap-manage',disabled:work.busy,onClick:()=>setPicking(null)},'取消'),
      h(Button,{className:'ap-manage is-done',disabled:work.busy,onClick:exportCard},work.busy?'正在导出…':'导出')):
    h('span',{className:'ap-pack-head-actions'},
      h(Button,{className:'ap-manage','aria-expanded':false,onClick:()=>{setManage(true);setQuery('');setKind('');}},'管理'),
      h(Button,{className:'ap-manage',disabled:busy,onClick:startPicking},'导出'),
      // UI standard §三.20 (acceptance U10): at most two .ap-manage buttons — 导入 (the card ZIP) moves into the heading's ⋯.
      h(Popover,{label:'素材包操作',className:'ap-pack-more',
        trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'素材包操作','aria-haspopup':'menu','aria-expanded':open,onClick:toggle}),
        content:close=>[h(MenuItem,{key:'import',onClick:()=>{close();pick();}},'导入')]}));
  return h(StageSection,{title:'素材包',meta:manage?ids.length:effective.length,help:STAGE_PACKS_HELP,className:'ap-pack-section'+(picking?' is-picking':''),action:head,reveal:manage||!!picking},
    ready&&h('input',{ref:picker,type:'file',accept:'.zip',hidden:true,tabIndex:-1,'aria-label':'导入卡 ZIP',onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)importFile(file);}}),
    !ready?h('p',{className:'ap-empty'},'素材插件不可用'):manage?h(React.Fragment,null,
      // the kind filter and sort sit on the search row, as in the library.
      h('div',{className:'ap-pack-toolbar'},h(PackSearchBox,{label:'搜索素材包',value:query,onChange:setQuery}),packs.length>0&&h(KindSortTools,{packs,kind,setKind,sort,onSort:setSort})),
      // one flat list like the library — 全局 → 本卡 → 关闭 (frozen while managing), sorted.
      h(PackList,{ids:orderPacks([...ids,...[...frozen.current.keys()].filter(id=>!byId.has(id)&&effective.includes(id))].filter(pass),{byId,sort,kind,rank:id=>frozen.current.get(id)??2}),render:row(),
        empty:h(EmptyState,{noun:'素材包',query,filter:kind&&kinds[kind],text:!query.trim()&&kind?'没有含「'+kinds[kind]+'」的素材包':undefined,onClear:()=>{setQuery('');setKind('');}})}),
      ctx.nav?.openLibrary&&h('p',{className:'ap-more-link'},h(Button,{className:'ap-inline-link',onClick:()=>ctx.nav.openLibrary({})},'去舞台素材安装或新建 ›'))):
    effective.length?h('ul',{className:'ap-pack-list is-current','aria-label':'当前素材包'},effective.map(row('static'))):h(EmptyState,{compact:true,text:picking?'这张卡没有用到素材包，只导出人物卡':'未使用素材包'}),
    missing.length>0&&h(HintLine,{text:'模组用到的图片包没有一起导出：'+missing.map(name).join('、')}),
    h(ErrorBox,{error:scope.error||work.error}));
}
// Legacy widget entries remain asset/export data, not registry mod switches.
function stageWidgetOnlyPack(pack) {
  // a list row answers from its counts (asset kinds plus figures).
  if(pack?.counts){const kinds=Object.keys(pack.counts).filter(kind=>pack.counts[kind]>0);return kinds.length>0&&kinds.every(kind=>kind==='widgets');}
  const manifest=pack?.manifest,assets=manifest?.assets||[];
  return !!manifest&&!(manifest.figures||[]).length&&assets.length>0&&assets.every(asset=>asset.kind==='widgets');
}
function stageWidgetRows(ctx) {
  const global=ctx.binding?.globalEnabledPackIds||[],bound=ctx.ext.assetBindings.boundPackIds,gate=ctx.ext.stage?.widgets===true;
  // the rows holding 模组 are read in full (stageDetailRows); list order is kept.
  return ctx.packs.filter(row=>!row.error&&row.manifest&&packCount(row,'widgets')>0).map(row=>ctx.writer.pack(row.manifest.id)).filter(Boolean).flatMap(pack=>{
    const packId=pack.manifest.id,packState=global.includes(packId)?'global':bound.includes(packId)?'card':'off';
    return pack.manifest.assets.filter(asset=>asset.kind==='widgets'&&pack.widgets?.[asset.id]).map(asset=>({key:packId+'/'+asset.id,packId,pack,asset,packState,
      state:gate&&asset.enabled!==false?packState:'off'}));
  });
}
// The pack modal opened from 舞台设置: card scope (three states), confirmations above it, characters link back.
function StagePackModal({ctx,packId,kind,figureId,tab,onClose}) {
  const scope=usePackScope({binding:ctx.binding,ctx,packs:ctx.packs});
  return h(PackModal,{binding:ctx.binding,packId,initial:{kind,figureId,tab},scope,packs:ctx.packs,ctx,onPacksChanged:()=>ctx.writer.reload(),onOpenPack:(id,k,item)=>ctx.openPack(id,k,item),
    onClose:changed=>{onClose();if(changed)ctx.writer.reload();}});
}
// the card figure grid edits library lamps, never cast bindings.
// figures from 全局 packs are listed before those from 本卡 packs.
function stageFigureRows(ctx) {
  const global=ctx.binding.globalEnabledPackIds||[],ids=globalFirst([...new Set([...ctx.ext.assetBindings.boundPackIds,...global])],global);
  return ids.flatMap(packId=>{const pack=ctx.writer.pack(packId);return (pack?.manifest.figures||[]).map(figureId=>({ref:{packId,figureId},pack,figure:pack.figures[figureId],sprites:pack.sprites}));});
}
function stageFigure(ctx,key) {
  return stageFigureRows(ctx).find(row=>typeof key==='object'?row.ref.packId===key.packId&&row.ref.figureId===key.figureId:row.ref.packId+'/'+row.ref.figureId===key)||{};
}
function StageAvatar({ctx,alias,className='ap-avatar'}) {
  const info=stageFigure(ctx,alias),figure=info.figure;
  return h(FigureCastFace,{binding:ctx.binding,packId:info.ref?.packId,pack:info.pack,figure,sprites:info.sprites,avatar:figure&&figureAvatar(figure,info.sprites),label:figure?.name||'',className,frame:'face'});
}
// the old 「人物」 section (lamps, ＋ new figure) is gone — figures are 素材
// and are edited in the 素材库 (a 素材包 row › its 人物, with their lamps and ＋); a card's characters are set up in 设置向导 › 配角色.
// 「人物 N」 is back as a quick entry only — one compact row of the enabled
// figures of the packs this card uses (全局 first), avatar + name; a click opens that figure in the pack window (人物 › it,
// 编辑 / 生图). No lamps, no ＋, no (?): it writes nothing. A figure's pack read in full is still on its way → the spinner.
// the row ends in the dashed ＋ (the 触发词 ＋'s look) that opens the 新人物
// page (asset-pack-setup-ui.js NewFigurePage, the same page as 设置向导 › 自定义角色's ＋); with no figure yet only the ＋.
function StageCastEntry({ctx}) {
  const global=ctx.binding.globalEnabledPackIds||[],installed=new Set(ctx.packs.filter(p=>!p.error&&p.manifest).map(p=>p.manifest.id));
  const waiting=[...new Set([...ctx.ext.assetBindings.boundPackIds,...global])].some(id=>installed.has(id)&&!ctx.writer.pack(id)&&packCount(ctx.packs.find(p=>p.manifest?.id===id),'figures')>0);
  const rows=stageFigureRows(ctx).filter(row=>row.figure?.enabled),add=ctx.openNewFigure;
  return h(StageSection,{title:'人物',meta:waiting||!rows.length?undefined:rows.length,className:'ap-cast-entry'},
    waiting&&!rows.length?h(Loading,{lead:true,count:4}):!rows.length&&!add?h(EmptyState,{noun:'人物',icon:h(Glyph,{name:'figures'})}):
    h('ul',{className:'ap-cast-strip','aria-label':'人物'},rows.map(({ref,pack,figure,sprites})=>h('li',{key:ref.packId+'/'+ref.figureId},
      h('button',{type:'button',className:'ap-cast-pill',title:figure.name,onClick:()=>ctx.openPack(ref.packId,'figures',ref.figureId)},
        h(FigureCastFace,{binding:ctx.binding,packId:ref.packId,pack,figure,sprites,avatar:figureAvatar(figure,sprites),label:'',className:'ap-avatar is-mini',frame:'face'}),
        h('span',{className:'ap-cast-pill-name'},figure.name)))),
      add&&h('li',{key:'@add',className:'ap-cast-strip-add'},h(CatAddTile,{label:'添加人物',onClick:add}))));
}
// The card's 绿灯 packs: installed packs bound to this card that are not globally enabled (全局 wins, like the pack state tag).
function stageGreenPackIds(ctx) {
  const global=ctx.binding.globalEnabledPackIds||[];
  return ctx.ext.assetBindings.boundPackIds.filter(id=>!global.includes(id)&&ctx.writer.pack(id)?.manifest);
}

// 演出风格 are pack entries (kind `directions`) — the
// old style library, its JSON box and the card's stage.directionStyle are gone. The 启用 entries of a 蓝灯 (全局) pack are
// the player's, those of a pack lit only green for this card are the card author's; the 提示词 row shows them as sent.
// Its pencil opens the 素材库 at 演出风格: the used packs that hold styles (全局 first); with none, the card's 绿灯 pack (the same
// rule as ＋人物: one opens, several ask, none → a pack named after the card is created and lit green for it), where the
// pack window starts a new style.
function stageStyleTargets(ctx) {
  const global=ctx.binding.globalEnabledPackIds||[],used=stageKindPacks(ctx,'directions');
  if(used.length)return used.map(pack=>({packId:pack.manifest.id,name:pack.manifest.name,mode:global.includes(pack.manifest.id)?'constant':'keyword'}));
  return stageGreenPackIds(ctx).map(id=>({packId:id,name:ctx.writer.pack(id).manifest.name,mode:'keyword'}));
}
async function stageStylePack(ctx) {
  const name=String(ctx.cardName||'').trim();
  if(!name)throw new Error('人物卡没有名字，无法新建本卡素材包');
  const made=await ctx.binding.service.createPack({name,expectedRevision:null}),packId=made.snapshot.manifest.id;
  await ctx.writer.write(current=>({assetBindings:{...current.assetBindings,boundPackIds:current.assetBindings.boundPackIds.includes(packId)?current.assetBindings.boundPackIds:[...current.assetBindings.boundPackIds,packId]}}));
  return packId;
}
function StageStyleEdit({ctx,onError}) {
  const [busy,setBusy]=React.useState(false),targets=stageStyleTargets(ctx),label='编辑演出风格';
  const go=packId=>ctx.openPack(packId,'directions');
  async function create(){if(busy)return;setBusy(true);onError?.('');try{go(await stageStylePack(ctx));}catch(e){onError?.(errorText(e));}finally{setBusy(false);}}
  if(targets.length>1)return h(Popover,{label:'在哪个素材包里编辑演出风格',className:'ap-style-edit-anchor',
    trigger:({toggle,open})=>h(IconButton,{icon:'edit',label,'aria-haspopup':'menu','aria-expanded':open,onClick:toggle}),
    content:close=>targets.map(target=>h('button',{key:target.packId,type:'button',role:'menuitem',className:'ap-menu-item ap-lamp-opt ap-cast-add-pack','data-mode':target.mode,title:target.name,onClick:()=>{close();go(target.packId);}},
      h('span',{className:'ap-lamp-dot','aria-hidden':true}),h('span',{className:'ap-lamp-opt-name'},target.name||'未命名素材包')))});
  return h(IconButton,{icon:'edit',label,disabled:busy,'aria-busy':busy||undefined,onClick:()=>targets.length?go(targets[0].packId):create()});
}
// the one 读音词典 — global, in the 配音 page (dsh-tts places
// it through the `ttsReadingsEditor` service and hands over its control RPC `call`). There is no per-card dictionary.
// Named presets, one active for every card: a preset menu with its ⋯ (新建 / 重命名 / 复制 / 导出 / 导入 / 删除…), the search
// box, the 写法 → 读音 rows and a dashed ＋ (InlineAdd). The list is windowed (fixed 36px rows, only the visible ones
// mount), a row edits in its own InlineField and saves alone (editReading: one row under the preset's revision), so a
// keystroke never re-renders or re-sends the list. Each entry's language shows as a small tag that is also its menu.
const READING_WARNINGS={LATIN_ASSUMED_EN:'已按英语处理；拼音或日语罗马字可修改语言',AMBIGUOUS_READING:'自动识别可能不准确，可修改语言'};
const READING_ERRORS={REVISION_CONFLICT:'内容已在别处修改，已重新载入',DUPLICATE_READING_FORM:'这个写法已经有读音了',INVALID_READINGS:'写法或读音无效',
  DUPLICATE_PRESET_NAME:'已有同名预设',INVALID_PRESET_NAME:'预设名称无效',LAST_PRESET:'至少保留一个预设',PRESET_LIMIT:'预设数量已达上限',PRESET_NOT_FOUND:'预设不存在，已重新载入',UNKNOWN_FIELD:'不是有效的读音预设文件',
  BODY_TOO_LARGE:'文件太大，无法导入',REQUEST_FAILED:'操作失败，请重试'};
const READING_ROW=36, READING_VIEW=12, READING_OVERSCAN=8;
const readingLanguageName=id=>VOICE_LANGUAGES.find(([k])=>k===id)?.[1]||id||'自动';
function readingWarning(entry) { return entry.languageOverride||!entry.warnings?.length?'':READING_WARNINGS[entry.warnings[0]]||READING_WARNINGS.AMBIGUOUS_READING; }
const readingForms=entry=>entry.forms.join('，');
// Input entries only: dsh-tts re-derives language / inferredLanguage / warnings from forms, reading and the override.
const readingInput=e=>({forms:e.forms,reading:e.reading,...(e.languageOverride?{languageOverride:e.languageOverride}:{})});
const readingErrorText=e=>e instanceof SyntaxError?'不是有效的读音预设文件':READING_ERRORS[e?.code||e?.message]||errorText(e);
// Rows keep their React identity while the list around them changes (entries are replaced, never mutated).
const readingKeys=new WeakMap();let readingKeySeq=0;
const readingKey=entry=>{let key=readingKeys.get(entry);if(!key){key='r'+(++readingKeySeq);readingKeys.set(entry,key);}return key;};
function ReadingLanguage({entry,label,onPick}) {
  const value=entry.languageOverride||'',warn=readingWarning(entry);
  return h(Popover,{label:'读音语言',className:'ap-reading-lang-anchor',
    trigger:({toggle,open})=>h('button',{type:'button',className:'ap-reading-lang'+(warn?' is-warn':'')+(value?' is-chosen':''),'aria-expanded':open,
      'aria-label':label+'的语言：'+readingLanguageName(entry.language)+(warn?'，'+warn:''),title:warn?'⚠ '+warn:undefined,onClick:toggle},
      warn&&h('span',{className:'ap-reading-warn','aria-hidden':true},'⚠'),h('span',null,readingLanguageName(entry.language))),
    content:close=>[['','自动（'+readingLanguageName(entry.inferredLanguage)+'）'],...VOICE_LANGUAGES].map(([id,name])=>
      h('button',{key:id||'auto',type:'button',role:'menuitemradio','aria-checked':value===id,className:'ap-menu-item',onClick:()=>{close();if(value!==id)onPick(id||null);}},
        h('span',null,name),value===id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// One line: 写法 → 读音 · language tag · ✕. Memoized on the entry object, so an edit elsewhere re-renders nothing here.
function ReadingRowView({entry,position,onSave,onRemove}) {
  const forms=readingForms(entry);
  const cell=(label,value,field,cls)=>h(InlineField,{kind:'text',label,hideLabel:true,value,title:value,className:'ap-reading-field'+cls,
    validate:v=>v?'':field==='forms'?'请填写写法':'请填写读音',onCommit:text=>onSave(entry,{...readingInput(entry),[field]:text})});
  return h('div',{className:'ap-readings-row',role:'row','aria-rowindex':position+1,style:{transform:'translateY('+position*READING_ROW+'px)'}},
    cell('写法 '+forms,forms,'forms',' is-form'),
    h('span',{className:'ap-reading-arrow','aria-hidden':true},'→'),
    cell('读音 '+forms,entry.reading,'reading',''),
    h(ReadingLanguage,{entry,label:forms,onPick:id=>{const next=readingInput(entry);if(id)next.languageOverride=id;else delete next.languageOverride;onSave(entry,next);}}),
    h(Button,{className:'ap-icon-button ap-reading-remove','aria-label':'删除读音 '+forms,title:'删除',onClick:()=>onRemove(entry)},'✕'));
}
const ReadingRow=typeof React.memo==='function'?React.memo(ReadingRowView):ReadingRowView;
// The window: a fixed-height scroller (12 rows) once the list is longer; only the rows in view (+ overscan) mount.
function ReadingList({entries,rows,onSave,onRemove,resetKey}) {
  const [top,setTop]=React.useState(0),box=React.useRef(null),frame=React.useRef(0);
  React.useEffect(()=>{setTop(0);if(box.current)box.current.scrollTop=0;},[resetKey]);
  const raf=typeof requestAnimationFrame==='function'?requestAnimationFrame:fn=>setTimeout(fn,16),caf=typeof cancelAnimationFrame==='function'?cancelAnimationFrame:clearTimeout;
  React.useEffect(()=>()=>caf(frame.current),[]);
  const windowed=rows.length>READING_VIEW;
  const first=windowed?Math.max(0,Math.floor(top/READING_ROW)-READING_OVERSCAN):0;
  const last=windowed?Math.min(rows.length,Math.ceil(top/READING_ROW)+READING_VIEW+READING_OVERSCAN):rows.length;
  const onScroll=e=>{const value=e.currentTarget.scrollTop;caf(frame.current);frame.current=raf(()=>setTop(value));};
  const shown=[];for(let n=first;n<last;n++){const entry=entries[rows[n]];shown.push(h(ReadingRow,{key:readingKey(entry),entry,position:n,onSave,onRemove}));}
  return h('div',{ref:box,className:'ap-readings'+(windowed?' is-windowed':''),role:'table','aria-label':'读音','aria-rowcount':rows.length,onScroll:windowed?onScroll:undefined,
    style:{height:(windowed?READING_VIEW:rows.length)*READING_ROW+'px'}},
    h('div',{className:'ap-readings-track',role:'rowgroup',style:{height:rows.length*READING_ROW+'px'}},shown));
}
// The control RPC `call(method,args)` (dsh-tts): readingPresets, readingPreset, editReading, create / rename / delete /
// setActive / export / importReadingPreset.
// one 「发音字典」 on the 配音 page — the reading
// presets' 写法 → 读音 rows and nothing else (the separate 「字母词」 list and its built-in readings are gone; a user adds a
// reading here instead).
function ReadingsEditor({call}) {
  return h(ReadingPresetsEditor,{call});
}
function ReadingPresetsEditor({call}) {
  const [list,setList]=React.useState(null),[preset,setPreset]=React.useState(null),[loadError,setLoadError]=React.useState('');
  const [error,setError]=React.useState(''),[saving,setSaving]=React.useState(''),[query,setQuery]=React.useState('');
  const [naming,setNaming]=React.useState(null),[confirm,setConfirm]=React.useState(false),[busy,setBusy]=React.useState(false);
  const [adding,setAdding]=React.useState(false),[draft,setDraft]=React.useState({forms:'',reading:''});
  const current=React.useRef(null),queue=React.useRef(Promise.resolve()),formsRef=React.useRef(null),readingRef=React.useRef(null),picker=React.useRef(null),live=React.useRef(true);
  React.useEffect(()=>()=>{live.current=false;},[]);
  const show=next=>{current.current=next;if(live.current)setPreset(next);};
  // Writes run one after another, each on the newest revision (a row commits while the previous save is in flight).
  const run=task=>{const next=queue.current.then(task,task);queue.current=next.catch(()=>{});return next;};
  const load=async()=>{
    // Both requests leave together (the active preset needs no id), so the large one is not queued behind the page's
    // first render; if the active preset changed in between, read it once more.
    let [summary,value]=await Promise.all([call('readingPresets'),call('readingPreset',{})]);
    if(value.id!==summary.active)value=await call('readingPreset',{id:summary.active});
    if(!live.current)return;setList(summary);show(value);setLoadError('');
  };
  React.useEffect(()=>{load().catch(e=>{if(live.current)setLoadError(readingErrorText(e));});},[call]);
  const fail=async e=>{if(!live.current)return;setSaving('');
    if(['REVISION_CONFLICT','PRESET_NOT_FOUND'].includes(e?.code||e?.message))await load().catch(()=>{});
    if(live.current)setError(readingErrorText(e));};
  const edit=(op,target,input)=>run(async()=>{
    const p=current.current,index=op==='add'?undefined:p.entries.indexOf(target);
    if(op!=='add'&&index<0)return false;
    setSaving('saving');
    try{
      const r=await call('editReading',{id:p.id,expectedRevision:p.revision,op,index,...(input?{entry:input}:{})});
      const entries=p.entries.slice();
      if(op==='add')entries.push(r.entry);else if(op==='set')entries[index]=r.entry;else entries.splice(index,1);
      show({...p,revision:r.revision,entries});
      if(live.current){setList(l=>l&&{...l,presets:l.presets.map(x=>x.id===p.id?{...x,count:entries.length,revision:r.revision}:x)});setSaving('saved');setError('');}
      return true;
    }catch(e){await fail(e);return false;}
  });
  // Stable row callbacks (the rows are memoized on their entry): created once, they only read refs.
  const rowActions=React.useRef(null);
  if(!rowActions.current)rowActions.current={onSave:(entry,input)=>{edit('set',entry,input);},onRemove:entry=>{edit('remove',entry);}};
  const {onSave,onRemove}=rowActions.current;
  // Preset operations answer with the new summary; the editor then shows the (possibly new) active preset.
  const presetOp=(method,args)=>run(async()=>{
    setBusy(true);setError('');
    try{const summary=await call(method,args),value=await call('readingPreset',{id:summary.active});if(live.current){setList(summary);show(value);setQuery('');}return true;}
    catch(e){await fail(e);return false;}finally{if(live.current)setBusy(false);}
  });
  async function exportPreset(){
    try{const doc=await call('exportReadingPreset',{id:current.current.id});
      const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');
      a.href=url;a.download=(doc.name||'读音')+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);setError('');}
    catch(e){setError(readingErrorText(e));}
  }
  async function importFile(file){
    let document;try{document=JSON.parse(await file.text());}catch(e){setError(readingErrorText(e));return;}
    await presetOp('importReadingPreset',{document});
  }
  async function addDraft(){
    const forms=draft.forms.trim(),reading=draft.reading.trim();
    if(!forms){formsRef.current?.focus?.();return false;}
    if(!reading){readingRef.current?.focus?.();return false;}
    if(await edit('add',null,{forms,reading})){setDraft({forms:'',reading:''});formsRef.current?.focus?.();}
    return false;
  }
  const entries=preset?.entries;
  // Search: one lower-cased line per entry, rebuilt only when the entries array changes; the filtered row list only when
  // the entries or the (deferred) term change.
  const term=(React.useDeferredValue||(v=>v))(query).trim().toLowerCase(),memo=React.useRef({});
  if(!memo.current.haystack||memo.current.entries!==entries){memo.current={entries,haystack:entries?entries.map(e=>(e.forms.join('\n')+'\n'+e.reading).toLowerCase()):[]};}
  if(memo.current.rowsFor!==memo.current.haystack||memo.current.term!==term){const haystack=memo.current.haystack,out=[];for(let i=0;i<haystack.length;i++)if(!term||haystack[i].includes(term))out.push(i);Object.assign(memo.current,{rowsFor:haystack,term,rows:out});}
  const rows=memo.current.rows;
  const save=h('span',{className:'ap-save-state',role:'status','data-state':saving},saving==='saving'?'正在保存…':saving==='saved'?'已保存':'');
  let body;
  if(loadError)body=h(ErrorBox,{error:loadError,reload:()=>{setLoadError('');load().catch(e=>setLoadError(readingErrorText(e)));}});
  else if(!preset||!list)body=h(Loading);
  else {
    const only=list.presets.length<=1;
    const menu=h(Popover,{label:'读音预设操作',className:'fork-readings-more',
      trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'预设操作','aria-haspopup':'menu','aria-expanded':open,disabled:busy,onClick:toggle}),
      content:close=>[
        h(MenuItem,{key:'new',onClick:()=>{close();setNaming({mode:'create',value:''});}},'新建'),
        h(MenuItem,{key:'rename',onClick:()=>{close();setNaming({mode:'rename',value:preset.name});}},'重命名'),
        h(MenuItem,{key:'copy',onClick:()=>{close();presetOp('createReadingPreset',{name:preset.name+' 副本',from:preset.id});}},'复制'),
        h(MenuItem,{key:'export',onClick:()=>{close();exportPreset();}},'导出'),
        h(MenuItem,{key:'import',onClick:()=>{close();picker.current?.click?.();}},'导入'),
        h(MenuItem,{key:'delete',danger:true,disabled:only,title:only?'至少保留一个预设':undefined,onClick:()=>{close();setConfirm(true);}},'删除…')]});
    const head=naming?h(InlineAdd,{open:true,className:'fork-readings-name',label:naming.mode==='create'?'新预设名称':'预设名称',placeholder:'预设名称',maxLength:40,busy,
        value:naming.value,onChange:value=>setNaming(n=>n&&{...n,value}),onCancel:()=>setNaming(null),
        onConfirm:async name=>{const ok=naming.mode==='create'?await presetOp('createReadingPreset',{name}):name===preset.name||await presetOp('renameReadingPreset',{id:preset.id,name});if(ok&&live.current)setNaming(null);return ok;}})
      :h(InlineField,{kind:'menu',label:'预设',value:list.active,disabled:busy,className:'fork-readings-preset',
        options:list.presets.map(p=>({value:p.id,label:p.name})),onCommit:id=>presetOp('setActiveReadingPreset',{id})});
    body=h(React.Fragment,null,
      h('div',{className:'fork-readings-bar'},head,!naming&&menu,
        h('input',{ref:picker,type:'file',accept:'.json,application/json',hidden:true,tabIndex:-1,'aria-label':'导入读音预设',onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)importFile(file);}})),
      (entries.length>8||query)&&h(PackSearchBox,{label:'搜索读音',placeholder:'搜索写法或读音',value:query,onChange:setQuery,className:'fork-readings-search'}),
      entries.length?rows.length?h(ReadingList,{entries,rows,onSave,onRemove,resetKey:preset.id+'\n'+term}):h(EmptyState,{noun:'读音',query,onClear:()=>setQuery('')})
        :h(EmptyState,{noun:'读音'}),
      h(InlineAdd,{open:adding,onOpen:()=>setAdding(true),onCancel:()=>{setAdding(false);setDraft({forms:'',reading:''});},
          className:'ap-readings-row is-new',tileClassName:'fork-readings-add',inputClassName:'fork-inline-add-input fork-readings-input',inputRef:formsRef,
          label:'新写法',addLabel:'添加读音',placeholder:'写法',value:draft.forms,onChange:forms=>setDraft(d=>({...d,forms})),
          onConfirm:()=>{if(draft.reading.trim())return addDraft();readingRef.current?.focus?.();return false;}},
        h('span',{className:'ap-reading-arrow','aria-hidden':true},'→'),
        h(InlineAdd,{open:true,bare:true,inputRef:readingRef,inputClassName:'fork-inline-add-input fork-readings-input',label:'新读音',placeholder:'读音',value:draft.reading,
          onChange:reading=>setDraft(d=>({...d,reading})),onConfirm:addDraft,onCancel:()=>{setAdding(false);setDraft({forms:'',reading:''});}})),
      error&&h('p',{className:'ap-field-error',role:'alert'},error));
  }
  return h('div',{className:'ap-ui fork-readings'},
    h(StageSection,{title:'发音字典',meta:entries?entries.length:undefined,foldKey:'tts-readings',action:save,
      help:'配音前把写法换成读音，所有人物卡通用；同一时间一个预设生效。写法可写几种，用逗号或顿号分开。'},body),
    confirm&&preset&&h(ConfirmDialog,{title:'删除预设',body:'删除「'+preset.name+'」及其 '+preset.entries.length+' 条读音？',confirmLabel:'删除',danger:true,
      onConfirm:async()=>{if(!await presetOp('deleteReadingPreset',{id:preset.id}))throw new Error('删除失败');},onClose:()=>setConfirm(false)}));
}
// the card export helpers of 「素材包」 — a pack's size,
// and the image packs a chosen pack's 模组 need but that stay behind. A 全局 pack that goes with the card is bound to
// the exported card (the asset library's bundle export), so it works on another machine.
// a list row carries the total of its file sizes (`bytes`); a full snapshot sums its files.
function stagePackBytes(pack) {
  if(Number.isFinite(pack?.bytes))return pack.bytes>0?pack.bytes:null;
  const files=pack?.manifest?.files;
  return Array.isArray(files)&&files.length?files.reduce((sum,file)=>sum+(Number.isFinite(file?.size)?file.size:0),0):null;
}
function stageBytesText(n) {
  if(!Number.isFinite(n)||n<0)return '';
  if(n<1024*1024)return Math.max(1,Math.round(n/1024))+' KB';
  const mb=n/1024/1024;return mb<1024?mb.toFixed(1)+' MB':(mb/1024).toFixed(1)+' GB';
}
// Image packs that the chosen packs' 模组 defaults point at but that are not exported with them.
function stageExportMissing(packs,chosen) {
  const needed=new Set();
  for(const pack of packs)if(chosen.has(pack.manifest.id))for(const asset of pack.manifest.assets)if(asset.kind==='widgets')
    for(const value of Object.values(asset.settingsDefaults||{}))if(value?.kind==='backgrounds'&&value.packId)needed.add(value.packId);
  return [...needed].filter(id=>!chosen.has(id));
}
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

// 「提示词」 — the one advanced place for prompts. It lists each stage in order and
// exactly what this plugin adds there, verbatim, with where it comes from (全局 / 本卡 / the pack by name / 本轮) and a local token estimate:
// 1. 正文模型 — the dialogue-format worldbook entries the host syncs (getDialogueBubbles `injection`): 对白格式 (global,
//    编辑 / 恢复默认; it carries the 双语 rules only while a figure's voice language differs from the text language),
//    then each figure's emotion entry (its figure owns it), then any other bubble entry the bound worldbooks still hold
//    (one another card left behind is sent as well: 「旧条目」);
// 2. 导演模型 — (prompt view complete) every byte of the real request (previewStageDirectorPrompt system,
//    messages, tools), cut into rows by kind and listed in the order they are sent: 职责与协议, 导演指令 (the command
//    guidance and frozen command schemas), 演出风格, 素材清单, 剧情, 演出指引, 临时要求, 工具定义, and
//    拼接与封装 last (the joins between the parts and the message envelope). The row bytes add up to the request.
// The host supplies `prompts`: usePrompts() → {story:{parts,custom,entries,userName}|null, director:{loading,error,result},
// refresh}, dialogueEditor(close) → its editor dialog, resetDialogue() → Promise. No internal keys reach the page.
// the 演出规则 row is now 演出风格 (style.* sections).
// what each mod adds sits in its own row 模组, every block named by its mod
// (the registered display name the preview carries) and what it is.
const DIRECTOR_PROMPT_ROWS=[['card','人物卡上下文'],['protocol','导演职责与协议'],['commands','导演指令'],['styles','演出风格'],['catalogue','素材清单'],['story','剧情'],['mods','模组'],['guidance','演出指引'],['request','临时要求'],['tool','工具定义'],['frame','拼接与封装']];
const MOD_PROMPT_ROLES={commands:'命令说明',candidates:'候选素材',state:'当前状态',context:'上下文',rules:'使用规则'};
const PROMPT_PIECE_NAMES={director:'导演职责与协议',role:'导演职责与协议',task:'导演协议','incremental-task':'本次任务参数','sound-rules':'声音规则','widget-rules':'模组规则','phone-rules':'手机短信规则',
  'command-guidance':'指令说明','allowed-commands':'本轮可用指令列表','stage-assets-lead':'素材清单说明','admission-command-guidance':'本轮可用指令',performances:'演出组合','performance-combinations':'演出组合','style.lead':'引导语','command-schema':'指令参数格式','tool-frame':'提交工具',
  'actors.constant':'常驻人物','actors.turn':'本轮人物',actors:'人物',outfits:'服装',roster:'人物','phone-roster':'手机联系人',contacts:'手机联系人','widget-catalogue':'模组',scenes:'背景',music:'BGM',sfx:'音效',looks:'滤镜',
  'cue-guidance':'场景提示','music-state':'音乐状态','state-hints':'状态提示',progress:'执行反馈',
  carried:'沿用的舞台状态',state:'沿用的舞台状态',reply:'本轮正文',paragraphs:'本轮正文',backlog:'前文',messages:'剧情与素材',guidance:'本次临时要求',tools:'提交工具的参数格式','tool-schema':'提交工具的参数格式',
  'stable-prefix':'角色设定与常驻世界书',worldbook:'本轮触发的世界书','foreground-reads':'正文查阅过的世界书',dynamic:'指南与当前变量','card-system':'人物卡系统指令','card-post-history':'人物卡后置指令'};
// the turn-local director inputs kept out of the cached system prefix (场景提示,
// 音乐状态, 状态提示) sit with the turn's other state in 剧情, not under 导演职责与协议.
const PROMPT_ROW_OF={'command-guidance':'commands','allowed-commands':'guidance','admission-command-guidance':'guidance',performances:'guidance','cue-guidance':'story','music-state':'story','state-hints':'story',carried:'story',state:'story',reply:'story',paragraphs:'story',backlog:'story',messages:'story',progress:'story',
  tools:'tool','tool-schema':'tool',guidance:'request',outfits:'catalogue',roster:'catalogue','phone-roster':'catalogue',contacts:'catalogue','widget-catalogue':'catalogue',scenes:'catalogue',music:'catalogue',sfx:'catalogue',looks:'catalogue',
  'stable-prefix':'card',worldbook:'card','foreground-reads':'card',dynamic:'card','card-system':'card','card-post-history':'card'};
const promptTokens=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const promptSum=items=>items.every(item=>item.tokens!==null)?items.reduce((sum,item)=>sum+item.tokens,0):null;
const promptTokenText=value=>value===null?'':'约 '+value.toLocaleString('en-US')+' tokens';
const promptBytes=text=>new TextEncoder().encode(String(text??'')).length;
// The director's local estimate (lib/domain/stage-director-tokens.js estimateDirectorTokens, same weights), for the parts
// the panel cuts out itself (the command schemas, the joins).
function promptTokenEstimate(text) {
  let half=0;
  for(const piece of String(text??'').match(/[A-Za-z]+|[0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\r?\n|[^\p{L}\p{N}\s]+|[^\s]/gu)||[]){
    if(/^[A-Za-z]+$/.test(piece))half+=2*Math.ceil(piece.length/4);
    else if(/^[0-9]+$/.test(piece))half+=2*Math.ceil(piece.length/3);
    else if(/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(piece))half+=3;
    else half+=2*Math.ceil([...piece].length/2);
  }
  return Math.ceil(half/2);
}
function directorPromptRow(key) {
  if(/^style\./.test(key))return 'styles';
  if(/^mod\./.test(key))return 'mods';
  if(/^catalogue[.-]/.test(key)||/^actors(\.|$)/.test(key))return 'catalogue';
  return PROMPT_ROW_OF[key]||'protocol';
}
// A piece of the director prompt is named by what it is; a catalogue entry carries no name of its own (its verbatim text
// is the content, shown inside its kind's group). A 演出风格 entry is named by its title (the entry's name).
function directorPieceName(key,text,title) {
  if(/^style\.(card|player)\./.test(key))return typeof title==='string'&&title?title:'演出风格';
  if(/^catalogue\./.test(key))return '';
  if(/^catalogue-digest-/.test(key))return '分类摘要';
  return PROMPT_PIECE_NAMES[key]||'其他内容';
}
// 素材清单 groups — one per asset kind, in the library's kind order (人物 first).
function catalogueGroup(key) {
  let m=/^catalogue\.([^.]+)\./.exec(key);if(m)return m[1];
  m=/^catalogue-digest-(.+)$/.exec(key);if(m)return kinds[m[1]]?m[1]:m[1]==='scenes'?'backgrounds':'other';
  if(/^actors(\.|$)/.test(key)||['outfits','roster','phone-roster'].includes(key))return 'figures';
  return {'widget-catalogue':'widgets',contacts:'widgets',scenes:'backgrounds',music:'music',sfx:'sfx',looks:'looks'}[key]||'other';
}
// The kind whose packs a pack-owned piece without explicit pack ids comes from (outfits, the turn's actors, performances).
const promptPieceKind=(row,key)=>row==='catalogue'?catalogueGroup(key):key==='performances'?'performances':null;
function directorSectionPieces(result) {
  return (Array.isArray(result?.sections)?result.sections:[]).filter(Boolean).flatMap(item=>{
    const key=String(item.key||''),text=typeof item.text==='string'?item.text:item.text==null?'':JSON.stringify(item.text),kind=item.source?.kind,row=directorPromptRow(key);
    const packIds=item.source?.packId?[item.source.packId]:Array.isArray(item.source?.packs)?item.source.packs.filter(id=>typeof id==='string'):[];
    // A mod section: 「物品演出 · 命令说明」 (an older host without the name or role still says 模组).
    const mod=kind==='mod'?{modId:typeof item.source.modId==='string'?item.source.modId:'',modName:typeof item.source.name==='string'&&item.source.name?item.source.name:'模组',role:MOD_PROMPT_ROLES[item.source.role]?item.source.role:''}:null;
    const piece={key,row,name:mod?[mod.modName,MOD_PROMPT_ROLES[mod.role]].filter(Boolean).join(' · '):directorPieceName(key,text,item.title),...mod,kind,packIds,assetId:typeof item.source?.assetId==='string'?item.source.assetId:undefined,packKind:promptPieceKind(row,key),placement:item.source?.placement,tokens:promptTokens(item.tokens),text};
    return [piece];
  });
}
const promptRowName=id=>DIRECTOR_PROMPT_ROWS.find(([key])=>key===id)?.[1]||'其他内容';
function promptRowsOf(pieces,order) {
  const rows=new Map();
  for(const piece of pieces){if(!rows.has(piece.row))rows.set(piece.row,[]);rows.get(piece.row).push(piece);}
  return [...rows].sort(([a,ap],[b,bp])=>order(a,ap)-order(b,bp)).map(([id,own])=>({id,name:promptRowName(id),kinds:own.map(piece=>piece.kind),tokens:promptSum(own),
    bytes:own.reduce((sum,piece)=>sum+(piece.bytes??promptBytes(piece.text)),0),pieces:own}));
}
// previewStageDirectorPrompt without the request itself (an older host) → its sections grouped in the rows' order.
function directorPromptRows(result) {
  const rank=id=>DIRECTOR_PROMPT_ROWS.findIndex(([key])=>key===id);
  return promptRowsOf(directorSectionPieces(result).filter(piece=>piece.text||piece.row!=='commands'),(id)=>rank(id));
}
// Every op schema list of the submit tool (the oneOf whose items each name one op).
function commandSchemaLists(value,found=[]) {
  if(Array.isArray(value)){for(const item of value)commandSchemaLists(item,found);return found;}
  if(!value||typeof value!=='object')return found;
  for(const [key,item] of Object.entries(value)){
    if((key==='oneOf'||key==='anyOf')&&Array.isArray(item)&&item.length&&item.every(entry=>typeof entry?.properties?.op?.const==='string'))found.push(item);
    else commandSchemaLists(item,found);
  }
  return found;
}
// the real director request, byte for byte. Each place the request
// carries text — the system prompt, every text part of the messages, the tools JSON — is cut at the preview sections
// (found verbatim; a turn section is anchored on its key in the user JSON) and the op schemas; what
// is left over (the joins: new lines, section tags, JSON keys and brackets) is a 拼接与封装 piece, and so is the
// message envelope (roles, part wrappers and the JSON escaping of the texts). The escaping is counted in bytes only: the
// provider decodes it, so the model never reads it as tokens. Rows come in the order the request first
// uses them; within a row the pieces keep the request's order and say where they go (at). Null without `system`.
const PROMPT_ANCHORS={'allowed-commands':'allowedCommands',carried:'carried',reply:'reply',outfits:'outfits','actors.turn':'actors',contacts:'contacts',progress:'progress'};
function directorWire(result) {
  if(typeof result?.system!=='string')return null;
  const places=[{at:'system',text:result.system}],messages=Array.isArray(result.messages)?result.messages:[];
  messages.forEach((message,index)=>{const parts=typeof message?.content==='string'?[{text:message.content}]:Array.isArray(message?.content)?message.content:[];
    for(const part of parts)if(typeof part?.text==='string')places.push({at:message.role==='system'?'system':'user',text:part.text,message:index});});
  if(Array.isArray(result.tools))places.push({at:'tools',text:JSON.stringify(result.tools)});
  for(const place of places)place.claims=[];
  const free=(place,start,end)=>place.claims.every(c=>end<=c.start||start>=c.end);
  const find=(place,text,anchor)=>{const needle=anchor?'"'+anchor+'":'+text:text,skip=needle.length-text.length;
    for(let i=place.text.indexOf(needle);i>=0;i=place.text.indexOf(needle,i+1))if(free(place,i+skip,i+skip+text.length))return i+skip;return -1;};
  const unplaced=[],pieces=directorSectionPieces(result).filter(piece=>piece.row!=='tool');
  // Longest first, so a short text never takes a place inside a longer one.
  for(const piece of [...pieces].sort((a,b)=>b.text.length-a.text.length)){
    if(!piece.text)continue;
    const turn=piece.placement==='turn'||piece.kind==='turn'||piece.kind==='request'||Object.hasOwn(PROMPT_ANCHORS,piece.key);
    let placed=false;
    for(const at of turn?['user','system']:['system','user'])for(const place of places)if(!placed&&place.at===at){
      const start=find(place,piece.text,PROMPT_ANCHORS[piece.key]);if(start>=0){place.claims.push({start,end:start+piece.text.length,piece});placed=true;}}
    if(!placed)unplaced.push(piece.key);
  }
  const tools=places.find(place=>place.at==='tools');
  // The sending mods (id, display name, each command's 命令说明 by its key) name the mod commands in the reference.
  const mods=[];for(const piece of directorSectionPieces(result))if(piece.kind==='mod'&&piece.modId){let mod=mods.find(row=>row.modId===piece.modId);if(!mod)mods.push(mod={modId:piece.modId,modName:piece.modName,commands:{}});if(piece.role==='commands')mod.commands[piece.key]=piece.text;}
  if(tools)for(const list of commandSchemaLists(result.tools)){const text=JSON.stringify(list),start=tools.text.indexOf(text);
    if(start>=0&&free(tools,start+1,start+text.length-1))tools.claims.push({start:start+1,end:start+text.length-1,piece:{key:'command-schema',row:'commands',name:PROMPT_PIECE_NAMES['command-schema'],kind:'engine',text:text.slice(1,-1),items:list.map(item=>JSON.stringify(item)),mods}});}
  const all=[],layout=[];
  places.forEach((place,index)=>{
    place.claims.sort((a,b)=>a.start-b.start);
    const segments=[];let at=0;
    const gap=end=>{if(end>at)segments.push({start:at,text:place.text.slice(at,end)});};
    for(const claim of place.claims){gap(claim.start);segments.push({start:claim.start,piece:claim.piece});at=claim.end;}
    gap(place.text.length);
    for(const segment of segments){
      const piece=segment.piece||(place.at==='tools'?{key:'tool-frame',row:'tool',name:PROMPT_PIECE_NAMES['tool-frame'],kind:'engine',text:segment.text}:{key:'frame',row:'frame',name:'',kind:'engine',text:segment.text});
      all.push({...piece,at:place.at,place:index,offset:segment.start,tokens:piece.items||!segment.piece?promptTokenEstimate(piece.text):piece.tokens??promptTokenEstimate(piece.text)});
    }
    if(place.at!=='tools'&&segments.some(segment=>!segment.piece))layout.push({at:place.at,place:index,segments:segments.map(segment=>segment.piece?{slot:promptRowName(segment.piece.row)}:{text:segment.text})});
  });
  // The message envelope: the messages JSON minus the texts it carries.
  const texts=places.filter(place=>place.message!==undefined),json=JSON.stringify(messages);
  const envelope=promptBytes(json)-texts.reduce((sum,place)=>sum+promptBytes(place.text),0);
  if(messages.length&&envelope>0){
    let n=0;const skeleton=JSON.stringify(messages.map(message=>({...message,content:typeof message?.content==='string'?'\u0000':Array.isArray(message?.content)?message.content.map(part=>typeof part?.text==='string'?{...part,text:'\u0000'}:part):message?.content})));
    const first=places.findIndex(place=>place.message!==undefined);
    const piece={key:'envelope',row:'frame',name:'消息封装',kind:'engine',at:'user',place:first,offset:-1,bytes:envelope,
      text:skeleton.split('"\\u0000"').join('\u0000').split('\u0000').map((part,i)=>i?'"⟨'+(++n)+'⟩"'+part:part).join(''),
      tokens:promptTokenEstimate(skeleton.split('"\\u0000"').join('""'))};
    all.push(piece);layout.push({at:'user',place:first,envelope:true,text:piece.text,bytes:envelope});
  }
  const order=(a,b)=>a.place-b.place||a.offset-b.offset;
  all.sort(order);
  const firstUse=new Map();all.forEach((piece,index)=>{if(!firstUse.has(piece.row))firstUse.set(piece.row,index);});
  const rows=promptRowsOf(all,id=>id==='frame'?Infinity:firstUse.get(id));
  // The tools as sent, for 工具定义's readable view (its pieces are the JSON around the op schemas).
  const toolRow=rows.find(row=>row.id==='tool');if(toolRow&&Array.isArray(result.tools))toolRow.tools=result.tools;
  const frame=rows.find(row=>row.id==='frame');if(frame){frame.layout=layout.sort((a,b)=>a.place-b.place||(a.envelope?-1:0)-(b.envelope?-1:0));frame.overview=promptOverview(places,all);}
  // 指令参数格式's chips: what this turn offers per kind, and the registry's own account of each command (describe()).
  const schema=all.find(piece=>piece.key==='command-schema');if(schema){schema.choices=promptChoices(all);schema.described=Array.isArray(result.commands)?result.commands:[];}
  const bytes={system:promptBytes(result.system),messages:promptBytes(json),tools:tools?promptBytes(tools.text):0};
  return {rows,unplaced,bytes:{...bytes,total:bytes.system+bytes.messages+bytes.tools},covered:rows.reduce((sum,row)=>sum+row.bytes,0)};
}
// 拼接与封装 as a map of the request — one block per place the request
// carries text (系统 / 本轮消息 / 工具), in order: the rows as runs (a join between two pieces of the same row folds into its
// run) and the joins between them; then the message envelope.
function promptOverview(places,all) {
  const blocks=[];
  places.forEach((place,index)=>{
    const own=all.filter(piece=>piece.place===index&&piece.key!=='envelope');if(!own.length)return;
    const items=[];
    own.forEach((piece,i)=>{const last=items[items.length-1];
      if(piece.row==='frame'){if(last?.row&&own[i+1]?.row===last.row)return;items.push({join:piece.text});return;}
      if(last?.row===piece.row)last.tokens+=piece.tokens||0;else items.push({row:piece.row,name:promptRowName(piece.row),tokens:piece.tokens||0});});
    blocks.push({at:place.at,tokens:own.reduce((sum,piece)=>sum+(piece.tokens||0),0),items});
  });
  const envelope=all.find(piece=>piece.key==='envelope');
  if(envelope)blocks.push({envelope:true,tokens:envelope.tokens,bytes:envelope.bytes});
  return blocks;
}
// What this turn offers per kind (素材清单, the cast and their outfits) as labels, for the chips of 指令参数格式; a kind
// whose text this view cannot read is left out (its chip then shows no count).
function promptChoices(pieces) {
  const out={},unread=new Set();
  const add=(kind,label)=>(out[kind]||(out[kind]=[])).push(label);
  for(const piece of pieces){
    if(piece.row!=='catalogue'&&piece.key!=='performances')continue;
    const kind=piece.key==='performances'?'performances':catalogueGroup(piece.key),entries=catalogueEntries(piece.text);
    if(!entries){unread.add(kind);continue;}
    for(const entry of entries){add(kind,entry.label||entry.ref);if(kind==='figures')for(const item of entry.variants)add('outfits',item.label||item.key);}
  }
  for(const kind of unread)delete out[kind];
  return {byKind:out,unread:[...unread]};
}
// A handle the director sees (素材清单, the cast, contacts) → its name, so 剧情 reads names where the text has handles.
function promptHandleNames(pieces) {
  const names={};
  for(const piece of pieces)if(piece.row==='catalogue')for(const entry of catalogueEntries(piece.text)||[])if(entry.ref&&entry.label)names[entry.ref]=entry.label;
  return names;
}
// the source column names where a part comes from — 全局, 本卡, the packs by name, 本轮 —
// never the bare word 素材包. A pack piece without its own pack ids falls back to the used packs that have its kind.
const stagePackName=(ctx,id)=>ctx?.packs?.find(pack=>pack.manifest?.id===id)?.manifest.name||'缺失的素材包';
// a pack-derived source counts its packs by lamp — 「全局素材包 2，本卡素材包 1」
// (蓝灯 packs are 全局, the card's other packs 本卡; a side with none is left out). The names (display names only,
// 「全局：A、B　本卡：C」) are only in the tooltip. → {owners,ownersTitle}
function promptPackScope(ctx,ids) {
  const global=ctx?.binding?.globalEnabledPackIds||[],unique=[...new Set(ids)],names=list=>[...new Set(list.map(id=>stagePackName(ctx,id)))].join('、');
  const lit=unique.filter(id=>global.includes(id)),card=unique.filter(id=>!global.includes(id));
  return {owners:[lit.length?'全局素材包 '+lit.length:'',card.length?'本卡素材包 '+card.length:''].filter(Boolean).join('，'),
    ownersTitle:[lit.length?'全局：'+names(lit):'',card.length?'本卡：'+names(card):''].filter(Boolean).join('　')};
}
function promptPackIds(ctx,pieces) {
  const ids=[];
  for(const piece of pieces)if(piece.kind==='pack')for(const id of piece.packIds?.length?piece.packIds:piece.packKind?stageKindPacks(ctx,piece.packKind).map(pack=>pack.manifest.id):[])if(!ids.includes(id))ids.push(id);
  return ids;
}
// → {owners,ownersTitle}: a row with pack pieces counts its packs by lamp; any other keeps its short scope.
function promptSources(ctx,pieces) {
  const ids=promptPackIds(ctx,pieces);
  if(ids.length)return promptPackScope(ctx,ids);
  const scopes=new Set(pieces.map(piece=>piece.kind==='request'?'turn':piece.kind));
  // a mod's part is owned by the mod, by its display name.
  const mods=[...new Set(pieces.filter(piece=>piece.kind==='mod').map(piece=>piece.modName||'模组'))];
  const owners=[...mods,...(scopes.has('engine')?['全局']:[]),...(scopes.has('card')?['本卡']:[]),...(scopes.has('pack')?['素材包']:[]),...(scopes.has('turn')?['本轮']:[])].join('、');
  return {owners,ownersTitle:owners};
}
// getDialogueBubbles `injection` → stage-1 rows: 对白格式, then one row per figure emotion entry (its pack by name).
// an emotion entry's source is its packs by lamp (the shared roster: the
// packs of the figures it covers); the sent text is untouched.
function storyPartOwners(part,ctx) {
  const ids=Array.isArray(part.packs)?part.packs.filter(id=>typeof id==='string'):part.figure&&part.figure!=='common-roster'?[String(part.figure).split('/')[0]]:[];
  if(ctx&&ids.length)return promptPackScope(ctx,ids);
  const owners='素材包';
  return {owners,ownersTitle:owners};
}
function storyPromptRows(story,ctx) {
  const rows=(story?.parts||[]).map((part,index)=>part.key==='figure'
    ?{id:'figure:'+(part.figure||index),name:'说话人名单',...storyPartOwners(part,ctx),tokens:promptTokens(part.tokens),figure:part.figure,recalled:!part.constant,pieces:[{text:part.text,tokens:promptTokens(part.tokens)}]}
    :{id:part.key,name:part.name||(part.key==='format'?'对白格式':part.key),owners:part.owners||'全局',tokens:promptTokens(part.tokens),voice:part.voice||null,pieces:[{text:part.text,tokens:promptTokens(part.tokens)}]});
  // a bubble entry the worldbook holds that the settings no longer produce (another
  // card's, left in a copied card's book) still reaches the story model: it is listed as it is sent ({{user}} filled in).
  const sent=new Set((story?.parts||[]).map(part=>part.text)),user=story?.userName||'你';
  for(const entry of story?.entries||[]){const text=String(entry.text||'').split('{{user}}').join(user);if(sent.has(text))continue;sent.add(text);
    rows.push({id:'entry:'+rows.length,name:String(entry.comment||'对白格式').replace(/（由「对话气泡」设置维护）$/,''),owners:entry.bookName||'本卡世界书',
      tokens:promptTokenEstimate(text),recalled:!entry.constant,leftover:true,pieces:[{text,tokens:promptTokenEstimate(text)}]});}
  return rows;
}

// The director rows with an empty 演出风格 row (its pencil opens the 素材库) and an empty 导演指令 row (holds the chips) when
// nothing of theirs is sent.
function promptWithStyles(rows) {
  const next=[...rows],after=(id,anchors)=>{if(next.some(row=>row.id===id))return;const at=anchors.map(key=>next.findIndex(row=>row.id===key)).find(index=>index>=0);
    next.splice(at===undefined?0:at+1,0,{id,name:promptRowName(id),kinds:[],tokens:0,bytes:0,pieces:[]});};
  after('commands',['protocol','card']);after('styles',['commands']);
  return next;
}
// 演出风格 opened — every piece verbatim, in the order sent: the lead-in
// (引导语), then equal entries, card first and global next: the entry's name · its pack,
// its tokens, a 「›」 to that entry in the 素材库, and the text.
function PromptStyles({ctx,row}) {
  if(!row.pieces.length)return h(EmptyState,{compact:true,text:'没有启用的演出风格，不加入内容'});
  return row.pieces.map((piece,index)=>{
    const place=piece.at&&(index===0||row.pieces[index-1].at!==piece.at)?h(PromptAt,{at:piece.at}):null;
    const packId=piece.packIds?.[0],entry=piece.key!=='style.lead'&&packId;
    const name=entry?piece.name+' · '+stagePackName(ctx,packId):piece.name;
    const jump=entry&&piece.assetId&&h('button',{type:'button',className:'ap-kind-jump','aria-label':'在舞台素材查看 '+piece.name,title:'在舞台素材查看',onClick:()=>ctx.openPack(packId,'directions',piece.assetId)},h(Glyph,{name:'chevRight'}));
    return h('div',{key:index,className:'ap-prompt-piece'+(entry?' is-style-entry':'')},
      h('div',{className:'ap-prompt-piece-head'},place,name&&h('span',null,name),
        piece.tokens!==null&&h('span',{className:'ap-prompt-tokens',title:promptBytesTitle(piece)},promptTokenText(piece.tokens)),jump||null),
      h('pre',null,piece.text||'（空）'));});
}
// One verbatim text. Long or multi-line texts start as one line and open in place (Enter / click); short ones just show.
function PromptRaw({text}) {
  const [open,setOpen]=React.useState(false),value=text||'（空）',long=value.length>72||value.includes('\n');
  if(!long)return h('div',{className:'ap-prompt-raw'},h('code',null,value));
  return h('button',{type:'button',className:'ap-prompt-raw is-long','aria-expanded':open,title:open?'收起':'展开全文',onClick:()=>setOpen(!open)},h('code',null,value));
}
// a JSON text reads structurally — values with their real line breaks, a
// long string as a text block, a run of like objects (the judge's questions, candidates) as a counted list that folds,
// one row per item — and 「原始」 shows the text exactly as sent. promptJson(text) is the ordered tree, and only when
// writing it back gives the text byte for byte (else null: the text shows as it is), so the structured view never
// drops or changes a byte; token and byte counts are the text's own.
const PJ_STR=/"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y,PJ_NUM=/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y,PJ_LIT=/true|false|null/y;
function promptJson(text) {
  if(typeof text!=='string'||!/^[[{]/.test(text))return null;
  let at=0;
  const token=re=>{re.lastIndex=at;const m=re.exec(text);if(!m)throw new SyntaxError('json');at=re.lastIndex;return m[0];};
  const eat=ch=>{if(text[at]!==ch)throw new SyntaxError('json');at++;};
  const value=()=>{
    const ch=text[at];
    if(ch==='{'){at++;const entries=[];if(text[at]!=='}')for(;;){const key=JSON.parse(token(PJ_STR));eat(':');entries.push([key,value()]);if(text[at]!==',')break;at++;}eat('}');return {type:'object',entries};}
    if(ch==='['){at++;const items=[];if(text[at]!==']')for(;;){items.push(value());if(text[at]!==',')break;at++;}eat(']');return {type:'array',items};}
    if(ch==='"')return {type:'string',value:JSON.parse(token(PJ_STR))};
    return {type:'raw',raw:token(ch==='t'||ch==='f'||ch==='n'?PJ_LIT:PJ_NUM)};
  };
  try{const tree=value();return at===text.length&&promptJsonText(tree)===text?tree:null;}catch(_){return null;}
}
function promptJsonText(node) {
  if(node.type==='object')return '{'+node.entries.map(([key,item])=>JSON.stringify(key)+':'+promptJsonText(item)).join(',')+'}';
  if(node.type==='array')return '['+node.items.map(promptJsonText).join(',')+']';
  return node.type==='string'?JSON.stringify(node.value):node.raw;
}
const PJ_LIST_MIN=3,PJ_OPEN_MAX=8,PJ_INLINE=40;
const pjNested=node=>node.type==='object'||node.type==='array';
const pjChildren=node=>node.type==='object'?node.entries:node.items.map((item,index)=>[String(index),item]);
const pjShort=node=>!pjNested(node)&&!(node.type==='string'&&(node.value.length>PJ_INLINE||node.value.includes('\n')));
const pjCompact=node=>pjNested(node)&&pjChildren(node).length<=6&&pjChildren(node).every(([,item])=>pjShort(item));
const pjList=node=>pjNested(node)&&pjChildren(node).length>=PJ_LIST_MIN&&pjChildren(node).every(([,item])=>item.type==='object');
// A list item's id: its key in an object, else its own id / name field (shown first, not repeated among the fields).
function pjItem(parent,[key,node]) {
  if(parent.type==='object')return {id:key,fields:node.entries};
  const own=node.entries.find(([name,item])=>['id','name'].includes(name)&&item.type==='string'&&pjShort(item));
  return own?{id:own[1].value,fields:node.entries.filter(entry=>entry!==own)}:{id:key,fields:node.entries};
}
function PromptJsonScalar({node}) {
  return node.type==='string'?h('span',{className:'ap-json-string'},node.value||'“”'):h('span',{className:'ap-json-raw-value'},node.raw);
}
function PromptJsonInline({node}) {
  return h('span',{className:'ap-json-inline'},(node.type==='array'&&!node.items.length)||(node.type==='object'&&!node.entries.length)?h('span',{className:'ap-json-raw-value'},node.type==='array'?'[]':'{}'):
    pjChildren(node).map(([key,item],index)=>h('span',{key:index,className:'ap-json-pair'},node.type==='object'&&h('span',{className:'ap-json-key'},key),h(PromptJsonScalar,{node:item}))));
}
function PromptJsonList({label,node}) {
  const items=pjChildren(node),[open,setOpen]=React.useState(items.length<=PJ_OPEN_MAX),id=React.useId();
  return h('div',{className:'ap-json-list'},
    h('div',{className:'ap-json-list-head'},h('button',{type:'button','aria-expanded':open,'aria-controls':id,onClick:()=>setOpen(!open)},h(Glyph,{name:'chevRight'}),
      label&&h('span',{className:'ap-json-key'},label),h('span',{className:'ap-prompt-group-count'},items.length))),
    open&&h('ol',{id,className:'ap-json-items'},items.map((entry,index)=>{const {id:itemId,fields}=pjItem(node,entry);
      return h('li',{key:index,className:'ap-json-item'},h('code',{className:'ap-json-id'},itemId),
        fields.map(([key,item],i)=>!pjNested(item)||pjCompact(item)?h('span',{key:i,className:'ap-json-pair'+(pjShort(item)?'':' is-long')},h('span',{className:'ap-json-key'},key),
            pjShort(item)?h(PromptJsonScalar,{node:item}):pjNested(item)?h(PromptJsonInline,{node:item}):h('span',{className:'ap-json-text'},item.value)):
          h('div',{key:i,className:'ap-json-field is-block'},h('span',{className:'ap-json-key'},key),h(PromptJsonNode,{node:item}))));})));
}
function PromptJsonNode({node,label}) {
  if(!pjNested(node))return pjShort(node)?h(PromptJsonScalar,{node}):h('div',{className:'ap-json-text'},node.value);
  if(pjList(node))return h(PromptJsonList,{label,node});
  if(pjCompact(node))return h(PromptJsonInline,{node});
  return h('div',{className:'ap-json-fields'},pjChildren(node).map(([key,item],index)=>pjList(item)?h(PromptJsonList,{key:index,label:key,node:item}):
    h('div',{key:index,className:'ap-json-field'+(pjShort(item)||pjCompact(item)?'':' is-block')},h('span',{className:'ap-json-key'},key),h(PromptJsonNode,{node:item}))));
}
// the text as sent is the row's 「查看原文」 (on its header), not a toggle here.
function PromptJson({tree}) {
  return h('div',{className:'ap-json'},h('div',{className:'ap-json-tree'},h(PromptJsonNode,{node:tree})));
}
// 指令参数格式 reads like the commands themselves. One row per command
// target (the command name minus its last word: cast, music, cg.focus…) in 可用演出's groups (the registry's), then mods,
// then the rest; under it one line per verb, each carrying its own arguments — the required ones, then one dashed box
// 「可选」 holding the optional ones, where arguments the registry marks mutually exclusive (`exclusive`) read 「a 或 b」.
// A value reads as what to give: an asset or an actor is a chip with how many this turn offers (it opens them), a value
// set one segmented chip, a number its range, a flag `true`, text its length. The argument's own name comes first
// (`name:`) only where the value alone does not say which argument it is. Hovering a verb shows its full command name
// with the registry's Chinese label and help; hovering an argument, its name and the description the model gets.
// Everything is derived from the schema shape and the registry, never from a command's name, so renamed or new
// commands still read. 「查看原文」 (on the header) shows the text exactly as sent; the view never changes what is sent.
const schemaObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const schemaChip=value=>value===null?'空':typeof value==='string'?value:JSON.stringify(value);
const schemaNum=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const schemaOp=s=>schemaObject(s)&&schemaObject(s.properties)&&schemaObject(s.properties.op)&&(typeof s.properties.op.const==='string'||typeof s.properties.op.pattern==='string');
const schemaOpName=s=>typeof s.properties.op.const==='string'?s.properties.op.const:s.properties.op.pattern;
const schemaVariants=s=>[...(Array.isArray(s.anyOf)?s.anyOf:[]),...(Array.isArray(s.oneOf)?s.oneOf:[])].filter(schemaObject);
const schemaOpList=s=>{const ops=schemaVariants(s);return ops.length&&ops.every(schemaOp)?ops:null;};
const schemaProps=(schema,skip)=>schemaObject(schema.properties)?Object.entries(schema.properties).filter(([name,s])=>name!==skip&&schemaObject(s)):[];
const schemaNote=s=>typeof s.description==='string'&&s.description?s.description:schemaObject(s.items)&&typeof s.items.description==='string'?s.items.description:'';
const hasHan=text=>/\p{Script=Han}/u.test(String(text||''));
const isActorRef=s=>schemaObject(s)&&typeof s.$ref==='string'&&/\/actor$/.test(s.$ref);
// The fields of a registered command that take an actor (its own schema, built with every dimension on).
function commandActorFields(def) {
  const fields=new Set();
  try{
    const all=new Proxy({},{get:()=>true});
    const walk=(s,name,depth)=>{if(!schemaObject(s)||depth>6)return;if(name&&(isActorRef(s)||isActorRef(s.items)))fields.add(name);
      for(const [key,item] of Object.entries(schemaObject(s.properties)?s.properties:{}))walk(item,key,depth+1);for(const variant of schemaVariants(s))walk(variant,'',depth+1);};
    walk(def.schema({dimensions:all,catalogue:{candidates:{},rows:[]},actors:{},items:{enabled:true}}),'',0);
  }catch(_){}
  return fields;
}
// `exclusive` (registry / describe()): one list of argument names, or a list of such lists.
const commandExclusive=value=>!Array.isArray(value)?[]:value.every(item=>typeof item==='string')?[value]:value.filter(item=>Array.isArray(item)&&item.every(name=>typeof name==='string'));
// → {title, help, group, rank, refs, actors, toggle, exclusive}: what the registry (its describe() rows from the preview,
// `described`, else its definitions) or the sending mod says about a command.
function commandInfo(name,mods,described) {
  const registry=typeof directorCommands!=='undefined'?directorCommands:null,def=registry?.byName?.[name];
  // `exclusive` comes from the preview's describe() row (context-aware: only groups the schema offers), else the definition.
  const about=(Array.isArray(described)?described:[]).find(row=>row?.name===name),exclusive=commandExclusive(about?about.exclusive:def?.exclusive);
  if(def){
    const group=registry.dimensionGroups?.find(([,items])=>items.some(([key])=>key===def.toggle));
    const groupName=group?(hasHan(group[0])?group[0]:group[1].map(([,label])=>label).join('、')):'其他演出';
    return {title:hasHan(def.label)?def.label:registry.dimensions?.[def.toggle]||'',help:hasHan(def.help)?def.help:typeof def.summary==='string'?def.summary:'',
      group:groupName,rank:group?registry.dimensionGroups.indexOf(group):100,refs:schemaObject(def.refs)?def.refs:{},actors:commandActorFields(def),toggle:def.toggle,exclusive};
  }
  // A mod command groups by the registry's ownership (describe() `mod`, named by the preview), not by whether its mod
  // also sent a prompt piece; the sending mod only adds its 命令说明.
  const list=Array.isArray(mods)?mods:[],owner=typeof about?.mod?.id==='string'&&about.mod.id?about.mod.id:'';
  const mod=list.find(row=>row.modId===owner)||(!owner?list.filter(row=>String(name).startsWith('mod.'+row.modId+'.')).sort((a,b)=>b.modId.length-a.modId.length)[0]:null);
  const summary=typeof about?.summary==='string'?about.summary:'';
  const modName=typeof about?.mod?.name==='string'&&about.mod.name.trim()?about.mod.name.trim():mod?.modName&&mod.modName!=='模组'?mod.modName:'';
  if(owner||mod)return {title:modName||'模组',help:mod?.commands?.[name]||mod?.commands?.['mod.'+mod.modId+'.'+about?.mod?.commandId]||summary,group:modName?'模组 · '+modName:'模组',rank:200,refs:{},actors:new Set(),exclusive};
  return {title:'',help:summary,group:'其他',rank:300,refs:{},actors:new Set(),exclusive};
}
const countText=(lo,hi)=>lo!==null&&hi!==null?(lo===hi?lo:lo+'–'+hi)+' 个':lo!==null?'≥'+lo+' 个':hi!==null?'≤'+hi+' 个':'多个';
// The asset kinds a command can take beyond the library's: a figure's outfits (listed with the cast).
const commandKinds={...kinds,outfits:'服装'};
const rangeText=(lo,hi,none)=>lo!==null&&hi!==null?lo+'–'+hi:lo!==null?'≥'+lo:hi!==null?'≤'+hi:none;
// What an argument takes: an asset of a kind (the registry's refs; a field named after its command's dimension when that
// is an asset kind, like an outfit), an actor, a value set, a flag, a number, text, or something else.
function commandArg(name,s,info) {
  const list=s.type==='array'&&schemaObject(s.items),item=list?s.items:s;
  const asset=info.refs?.[name]||(name===info.toggle&&commandKinds[name+'s']?name+'s':'');
  if(asset)return {type:'asset',kind:asset,list};
  if(info.actors?.has(name)||isActorRef(item))return {type:'asset',kind:'figures',actor:true,list};
  const variants=schemaVariants(item);
  if(Object.hasOwn(item,'const')||Array.isArray(item.enum)||variants.length&&!variants.some(variant=>schemaOpList(variant)||schemaOp(variant)))return {type:'set',list};
  const type=Array.isArray(item.type)?item.type.find(value=>value!=='null'):item.type;
  if(type==='boolean')return {type:'flag',list};
  if(type==='integer'||type==='number')return {type:'number',list};
  if(type==='string')return {type:'text',list};
  return {type:'other',list};
}
// The name goes first where the value alone does not say which argument it is: text, numbers, flags, anything else;
// a value set or an asset when the verb takes more than one argument (an asset only when another takes the same kind);
// never when the name repeats a word of the command (weather.set weather, cg.focus.set focus).
function commandArgNamed(op,arg,args) {
  if(arg.type!=='set'&&arg.type!=='asset')return true;
  if(op.split('.').includes(arg.name)||args.length<2)return false;
  return arg.type==='set'||args.filter(other=>other.type==='asset'&&other.kind===arg.kind).length>1;
}
// An asset / actor chip: 「背景 9」 (how many this turn offers), 「人物 · 多个」 for a list; it opens the real options.
function CommandAsset({arg,count,choices}) {
  const label=arg.actor?'人物':commandKinds[arg.kind]||arg.kind;
  const known=choices&&!choices.unread.includes(arg.kind),list=known?choices.byKind[arg.kind]||[]:null;
  const text=label+(list&&!arg.actor?' '+list.length:'')+(arg.list?' · '+count:'');
  if(!list)return h('span',{className:'ap-cmd-asset'},text);
  return h(Popover,{label:label+' 可选项',className:'ap-cmd-asset-anchor',limit:280,trigger:({open,toggle})=>h('button',{type:'button',className:'ap-cmd-asset','aria-haspopup':'menu','aria-expanded':open,onClick:toggle},text),
    content:()=>list.length?list.map((value,i)=>h('div',{key:i,role:'menuitem',tabIndex:-1,className:'ap-menu-item ap-cmd-choice'},value)):h('div',{className:'ap-menu-item ap-cmd-choice is-empty'},'本轮没有可选的'+label)});
}
// One value set as a segmented chip; an alternative that is an actor reads as an actor chip inside it.
function CommandSet({s,info}) {
  const parts=[];
  const add=item=>{
    if(Object.hasOwn(item,'const'))parts.push(schemaChip(item.const));
    else if(Array.isArray(item.enum))parts.push(...item.enum.map(schemaChip));
    else if(schemaOpList(item))parts.push({word:'导演指令 '+schemaOpList(item).length+' 条'});
    else if(schemaOp(item))parts.push(schemaOpName(item));
    else if(schemaVariants(item).length)schemaVariants(item).forEach(add);
    else{const props=schemaProps(item);parts.push(props.length===1&&(info.actors?.has(props[0][0])||isActorRef(props[0][1]))?{word:'人物',actor:true}:{word:commandWord(item)});}
  };
  add(s);
  return h('span',{className:'ap-cmd-set'},parts.map((part,i)=>typeof part==='string'?h('span',{key:i},part):h('span',{key:i,className:part.actor?'is-actor':'is-word'},part.word)));
}
const commandWord=s=>{const type=Array.isArray(s.type)?s.type.find(value=>value!=='null'):s.type;return type==='string'?'文字':type==='boolean'?'true':type==='integer'||type==='number'?'数字':type==='array'?'列表':'对象';};
function CommandValue({s,arg,info,choices}) {
  const item=arg.list?s.items:s,count=arg.list?countText(schemaNum(s.minItems),schemaNum(s.maxItems)):'';
  if(arg.type==='asset')return h(CommandAsset,{arg,count,choices});
  if(arg.type==='set')return arg.list?h(React.Fragment,null,h(CommandSet,{s:item,info}),h('span',{className:'ap-cmd-val is-word'},'× '+count)):h(CommandSet,{s,info});
  if(arg.type==='flag')return h('span',{className:'ap-cmd-val'},'true');
  if(arg.type==='number')return h('span',{className:'ap-cmd-val'},rangeText(schemaNum(item.minimum),schemaNum(item.maximum),'数字'));
  const length=schemaNum(item.maxLength);
  if(arg.type==='text')return h('span',{className:'ap-cmd-val is-word'},arg.list?'文字 × '+count+(length!==null?'，每条 ≤'+length+' 字':''):length!==null?'≤'+length+' 字':'文字');
  return h('span',{className:'ap-cmd-val is-word'},arg.list?'列表':commandWord(item));
}
// A verb's arguments: required first, then the dashed 「可选」 box.
function CommandArgs({op,schema,info,choices}) {
  const required=new Set(Array.isArray(schema.required)?schema.required:[]);
  const args=schemaProps(schema,'op').map(([name,s])=>({name,s,...commandArg(name,s,info)}));
  const one=arg=>{const note=schemaNote(arg.s);
    return h('span',{key:arg.name,className:'ap-cmd-arg',title:arg.name+(note?' — '+note:'')},commandArgNamed(op,arg,args)&&h('code',{className:'ap-cmd-key'},arg.name),h(CommandValue,{s:arg.s,arg,info,choices}));};
  const optional=args.filter(arg=>!required.has(arg.name)),groups=[],seen=new Set();
  for(const arg of optional){if(seen.has(arg.name))continue;const set=info.exclusive.find(names=>names.includes(arg.name));
    const members=set?optional.filter(other=>set.includes(other.name)):[arg];members.forEach(other=>seen.add(other.name));groups.push(members);}
  return h('span',{className:'ap-cmd-args'},args.filter(arg=>required.has(arg.name)).map(one),
    groups.length>0&&h('span',{className:'ap-cmd-optional'},h('span',{className:'ap-cmd-optional-label'},'可选'),
      groups.map((members,i)=>members.length>1?h('span',{key:i,className:'ap-cmd-alt'},members.flatMap((arg,j)=>j?[h('span',{key:'or'+j,className:'ap-cmd-or'},'或'),one(arg)]:[one(arg)])):one(members[0]))));
}
function CommandLine({schema,info,choices}) {
  const op=schemaOpName(schema),verb=op.includes('.')?op.slice(op.lastIndexOf('.')+1):op;
  const hover=[op,info.title].filter(Boolean).join(' · ')+(info.help?'\n'+info.help:'');
  return h('div',{className:'ap-cmd-line'},h('code',{className:'ap-cmd-verb',title:hover,'aria-label':hover},verb),h(CommandArgs,{op,schema,info,choices}));
}
const promptParse=text=>{try{return JSON.parse(text);}catch(_){return undefined;}};
// 「查看原文」: a quiet toggle that sits on the header row of what it switches.
function PromptRawToggle({raw,onChange}) {
  return h('button',{type:'button',className:'ap-schema-toggle','aria-pressed':raw,onClick:e=>{e.stopPropagation();onChange(!raw);}},'查看原文');
}
// 导演指令 · 指令参数格式 (`choices`: promptChoices; `described`: the preview's describe() rows); anything not an op schema
// keeps the raw lines.
function PromptOps({items,raw,mods,described,choices}) {
  const ops=items.map(promptParse);
  const lines=h('pre',{className:'ap-prompt-lines'},items.map((item,i)=>h('span',{key:i},item+(i<items.length-1?',':''))));
  if(raw||!ops.length||!ops.every(schemaOp))return lines;
  const groups=new Map();
  for(const schema of ops){const op=schemaOpName(schema),info=commandInfo(op,mods,described),target=op.includes('.')?op.slice(0,op.lastIndexOf('.')):op;
    let group=groups.get(info.group);if(!group)groups.set(info.group,group={rank:info.rank,targets:new Map()});
    let lines=group.targets.get(target);if(!lines)group.targets.set(target,lines=[]);lines.push({schema,info});}
  return h('div',{className:'ap-prompt-groups'},[...groups].sort(([,a],[,b])=>a.rank-b.rank).map(([group,{targets}])=>h('section',{key:group,className:'ap-prompt-group','aria-label':group},
    h('div',{className:'ap-prompt-group-head'},h('span',{className:'ap-prompt-group-name'},group)),
    h('ul',{className:'ap-cmd-rows'},[...targets].map(([target,own])=>h('li',{key:target,className:'ap-cmd-row'},h('code',{className:'ap-cmd-target'},target),
      h('div',{className:'ap-cmd-lines'},own.map(({schema,info})=>h(CommandLine,{key:schemaOpName(schema),schema,info,choices})))))))));
}
// 工具定义: each tool (name, description, parameters) when the tools JSON has that shape, else null (the raw pieces).
function promptToolDefs(row) {
  const tools=Array.isArray(row.tools)?row.tools:promptParse(row.pieces.find(piece=>piece.key==='tools')?.text??'');
  const defs=Array.isArray(tools)?tools.map(tool=>schemaObject(tool?.function)?tool.function:tool):[];
  return defs.length&&defs.every(def=>schemaObject(def)&&typeof def.name==='string'&&schemaObject(def.parameters))?defs:null;
}
// A tool's parameters in the same rows: the tool, then each nested object (`beats[]`), then each list of alternatives
// (`ops[]`: the commands are under 导演指令) — 「a 或 b」.
function toolRows(schema,path,out=[]) {
  out.push({path,schema});
  for(const [name,s] of schemaProps(schema)){
    const item=s.type==='array'&&schemaObject(s.items)?s.items:s,key=name+(item===s?'':'[]');
    if(schemaProps(item).length)toolRows(item,key,out);
    else if(schemaVariants(item).length&&!schemaVariants(item).every(variant=>Array.isArray(variant.enum)||Object.hasOwn(variant,'const')))out.push({path:key,variants:schemaVariants(item)});
  }
  return out;
}
const TOOL_INFO={refs:{},actors:new Set(),exclusive:[]};
function ToolVariant({s}) {
  const ops=schemaOpList(s);
  if(ops)return h('span',{className:'ap-cmd-val is-word'},'导演指令 '+ops.length+' 条之一');
  if(schemaOp(s))return h('span',{className:'ap-cmd-arg',title:schemaNote(s)},h('code',{className:'ap-cmd-verb'},schemaOpName(s)),h(CommandArgs,{op:'',schema:s,info:TOOL_INFO}));
  return h('span',{className:'ap-cmd-arg',title:schemaNote(s)},h(CommandValue,{s,arg:commandArg('',s,TOOL_INFO),info:TOOL_INFO}));
}
function PromptTools({row,defs,raw}) {
  if(raw)return h(PromptPieces,{pieces:row.pieces});
  return h('div',{className:'ap-prompt-groups'},defs.map((def,i)=>h('section',{key:i,className:'ap-prompt-group','aria-label':def.name},
    h('div',{className:'ap-prompt-group-head'},h('span',{className:'ap-prompt-group-name'},'提交工具'),h('code',{className:'ap-schema-name'},def.name),
      typeof def.description==='string'&&def.description&&h(Help,{text:def.description,label:def.name+' 说明'})),
    h('ul',{className:'ap-cmd-rows'},toolRows(def.parameters,def.name).map(item=>h('li',{key:item.path,className:'ap-cmd-row'},h('code',{className:'ap-cmd-target'},item.path),
      h('div',{className:'ap-cmd-lines'},h('div',{className:'ap-cmd-line is-bare'},item.variants?h('span',{className:'ap-cmd-args'},h('span',{className:'ap-cmd-alt'},
        item.variants.flatMap((variant,j)=>j?[h('span',{key:'or'+j,className:'ap-cmd-or'},'或'),h(ToolVariant,{key:j,s:variant})]:[h(ToolVariant,{key:j,s:variant})]))):
        h(CommandArgs,{op:'',schema:item.schema,info:TOOL_INFO})))))))));
}
// A piece's text: the op schemas as the command reference, a JSON text structurally, anything else verbatim; `raw`
// always verbatim.
function PromptText({text,items,raw}) {
  const tree=React.useMemo(()=>items||raw?null:promptJson(text),[text,items,raw]);
  if(items)return h(PromptOps,{items,raw});
  return tree?h(PromptJson,{tree}):h('pre',null,text||'（空）');
}
// where a piece goes, in words, with its one-sentence (?).
const PROMPT_AT={system:'系统',user:'本轮消息',tools:'工具'};
const PROMPT_AT_HELP={system:'系统：每轮不变的固定说明，放在缓存前缀里，可以命中缓存。',user:'本轮消息：每轮单独发给模型的当轮信息，放在缓存前缀之外，不影响缓存命中。',
  tools:'工具：模型可以调用的工具和参数格式，每轮不变，放在缓存前缀里。'};
function PromptAt({at}) {
  if(!PROMPT_AT[at])return null;
  return h('span',{className:'ap-prompt-at-tag'},h('span',{className:'ap-prompt-at'},PROMPT_AT[at]),h(Help,{text:PROMPT_AT_HELP[at],label:PROMPT_AT[at]+' 说明'}));
}
const promptBytesTitle=piece=>(piece.bytes??promptBytes(piece.text)).toLocaleString('en-US')+' B';
// 素材清单 opened — one region per kind (人物, 背景, 音乐, 音效, 环境音, CG, 模组…), each with its
// name, how many entries, the packs it comes from, its tokens and the 基础设置 「›」 jump to that kind in the 素材库; inside,
// each entry's text exactly as sent, marked with where it goes (system / 用户消息).
// the entries read as a list — the asset's name, its note beside, and its
// variants / outfits as chips with their own note; a run of entries going to the same place (系统 / 本轮消息) starts
// with that tag once. The handle (what the director copies) is only in the raw text: 「查看原文」 on the row's header
// swaps in every entry's text exactly as sent. An entry of another shape (or with nested fields this view does not
// know) stays verbatim.
const promptStr=value=>typeof value==='string'?value:undefined;
const CATALOGUE_FIELDS=new Set(['label','name','ref','id','directorNote','guidance','description','variants','outfits','focus']);
const CATALOGUE_VARIANT_FIELDS=new Set(['key','id','label','name','description','guidance','directorNote']);
function catalogueEntry(value,handle) {
  if(!schemaObject(value))return null;
  const label=promptStr(value.label)??promptStr(value.name),ref=handle??promptStr(value.ref)??promptStr(value.id);
  if(label===undefined&&ref===undefined)return null;
  if(Object.hasOwn(value,'defaultVariant'))return null;
  const table=value.variants;
  if(table!==undefined&&(!schemaObject(table)||Object.keys(table).some(key=>!['default','entries'].includes(key))||typeof table.default!=='string'||!Array.isArray(table.entries)||!table.entries.length||!table.entries.every(item=>schemaObject(item)&&typeof item.id==='string'&&typeof item.name==='string'&&Object.keys(item).every(key=>['id','name'].includes(key)))||new Set(table.entries.map(item=>item.id)).size!==table.entries.length||!table.entries.some(item=>item.id===table.default)))return null;
  if(table!==undefined&&value.outfits!==undefined)return null;
  const list=table?.entries??value.outfits;
  if(value.outfits!==undefined&&!(Array.isArray(value.outfits)&&value.outfits.every(item=>schemaObject(item)&&Object.entries(item).every(([key,field])=>CATALOGUE_VARIANT_FIELDS.has(key)&&typeof field==='string'))))return null;
  if(value.focus!==undefined&&!(Array.isArray(value.focus)&&value.focus.every(item=>schemaObject(item)&&typeof item.key==='string'&&typeof item.label==='string'&&Object.keys(item).every(key=>['key','label'].includes(key)))))return null;
  const extra=Object.entries(value).filter(([key])=>!CATALOGUE_FIELDS.has(key));
  if(extra.some(([,field])=>field&&typeof field==='object'))return null;
  const fallback=table?.default;
  return {label:label??'',ref:ref??'',note:promptStr(value.directorNote)??promptStr(value.guidance)??promptStr(value.description)??'',
    variants:(list||[]).map(item=>{const key=item.key??item.id??'';return {key,label:item.label??item.name??'',note:item.description??item.guidance??item.directorNote??'',fallback:fallback!==undefined&&key===fallback};}),
    extra:[...extra.map(([key,field])=>[key,typeof field==='string'?field:JSON.stringify(field)]),...(value.focus?.length?[['构图焦点',value.focus.map(item=>item.label).join('、')]]:[])]};
}
// An entry text → its entries (one asset, a handle → asset map like the cast, or a list like the contacts), else null.
function catalogueEntries(text) {
  const value=promptParse(text);
  if(Array.isArray(value)){const list=value.map(item=>catalogueEntry(item));return list.length&&list.every(Boolean)?list:null;}
  if(!schemaObject(value))return null;
  if(promptStr(value.ref)!==undefined||promptStr(value.label)!==undefined){const one=catalogueEntry(value);return one?[one]:null;}
  const map=Object.entries(value).map(([key,item])=>catalogueEntry(item,key));
  return map.length&&map.every(Boolean)?map:null;
}
function CatalogueEntry({entry}) {
  return h('li',{className:'ap-pcat-entry'},
    h('div',{className:'ap-pcat-id'},entry.label?h('span',{className:'ap-pcat-label'},entry.label):h('code',{className:'ap-pcat-label'},entry.ref)),
    h('div',{className:'ap-pcat-body'},entry.note&&h('p',{className:'ap-pcat-note'},entry.note),
      entry.variants.length>0&&h('ul',{className:'ap-pcat-variants'},entry.variants.map((item,i)=>h('li',{key:i,className:item.fallback?'is-default':undefined},
        h('span',{className:'ap-schema-chip'},item.key||item.label),item.key&&item.label&&h('span',{className:'ap-pcat-variant-label'},item.label),
        item.fallback&&h('span',{className:'ap-pcat-default','aria-label':'默认'},'★'),item.note&&h('span',{className:'ap-pcat-variant-note'},item.note)))),
      entry.extra.map(([key,field])=>h('span',{key,className:'ap-json-pair'},h('span',{className:'ap-json-key'},key),h('span',{className:'ap-json-string'},field)))));
}
// One kind's entries, readable: the place tag (and the piece's name, 常驻人物 / 手机联系人) once per run.
function CatalogueList({pieces}) {
  const items=[];
  pieces.forEach((piece,index)=>{
    const before=pieces[index-1];
    if(!before||before.at!==piece.at||before.name!==piece.name)items.push(h('li',{key:'at'+index,className:'ap-pcat-run'},h(PromptAt,{at:piece.at}),piece.name&&h('span',null,piece.name)));
    const entries=catalogueEntries(piece.text);
    if(entries)entries.forEach((entry,i)=>items.push(h(CatalogueEntry,{key:index+':'+i,entry})));
    else items.push(h('li',{key:index,className:'ap-pcat-entry is-raw'},h(PromptRaw,{text:piece.text})));
  });
  return h('ul',{className:'ap-pcat-list'},items);
}
function PromptCatalogue({ctx,pieces,raw}) {
  const groups=new Map();
  for(const piece of pieces){const kind=catalogueGroup(piece.key);if(!groups.has(kind))groups.set(kind,[]);groups.get(kind).push(piece);}
  const rank=kind=>{const at=KIND_ORDER.indexOf(kind);return at<0?KIND_ORDER.length:at;};
  const count=piece=>/^catalogue\./.test(piece.key)?1:/^actors(\.|$)/.test(piece.key)?(()=>{try{const value=JSON.parse(piece.text);return value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).length:1;}catch(_){return 1;}})():0;
  return h('div',{className:'ap-prompt-groups'},[...groups].sort(([a],[b])=>rank(a)-rank(b)).map(([kind,own])=>{
    const name=kinds[kind]||'其他',total=own.reduce((sum,piece)=>sum+count(piece),0),tokens=promptSum(own),packIds=promptPackIds(ctx,own.map(piece=>({...piece,packKind:piece.packKind||kind}))),sources=packIds.length?promptPackScope(ctx,packIds):null;
    return h('section',{key:kind,className:'ap-prompt-group','aria-label':name},
      h('div',{className:'ap-prompt-group-head'},
        h('span',{className:'ap-prompt-group-name'},name),total>0&&h('span',{className:'ap-prompt-group-count'},total),
        sources&&h('span',{className:'ap-prompt-owner',title:sources.ownersTitle},sources.owners),
        tokens!==null&&h('span',{className:'ap-prompt-tokens'},promptTokenText(tokens)),
        kinds[kind]&&h(StageKindJump,{ctx,kind,label:name,packIds})),
      raw?h('ul',{className:'ap-prompt-raw-list'},own.map((piece,index)=>{const label=[PROMPT_AT[piece.at],piece.name].filter(Boolean).join(' · ');
        return h('li',{key:index},label&&h('span',{className:'ap-prompt-raw-label',title:promptBytesTitle(piece)},label),h(PromptRaw,{text:piece.text}));})):
        h(CatalogueList,{pieces:own}));
  }));
}
// A row's pieces as sent: a run of pieces going to the same place starts with that place (system / 用户消息 / 工具).
// The op schemas show one op per line (the text itself is unchanged: the lines join back into it).
function PromptPieces({pieces,raw}) {
  const many=pieces.length>1;
  const head=(piece,place,name,tokens,end)=>(place||name||tokens!==null||end)&&h('div',{className:'ap-prompt-piece-head'},place,name&&h('span',null,name),
    tokens!==null&&h('span',{className:'ap-prompt-tokens',title:promptBytesTitle(piece)},promptTokenText(tokens)),end&&h('span',{className:'ap-prompt-head-end'},end));
  // the row head carries the row's tokens, so a lone piece has no token line
  // of its own; in a row of several, each piece's head is name · tokens on one line.
  return pieces.map((piece,index)=>{const place=piece.at&&PROMPT_AT[piece.at]&&(index===0||pieces[index-1].at!==piece.at)?h(PromptAt,{at:piece.at}):null,name=many?piece.name:'',tokens=many?piece.tokens??null:null;
    if(piece.items)return h(SchemaPiece,{key:index,piece,head:end=>head(piece,place,name,tokens,end)});
    return h('div',{key:index,className:'ap-prompt-piece'},head(piece,place,name,tokens,null),h(PromptText,{text:piece.text,raw}));});
}
// 指令参数格式: the command reference, with 「查看原文」 at the end of its header line.
function SchemaPiece({piece,head}) {
  const [raw,setRaw]=React.useState(false);
  return h('div',{className:'ap-prompt-piece'},head(h(PromptRawToggle,{raw,onChange:setRaw})),h(PromptOps,{items:piece.items,raw,mods:piece.mods,described:piece.described,choices:piece.choices}));
}
// 模组 opened — a block per mod and kind, in the order sent: 「物品演出 ·
// 命令说明」, 「物品演出 · 候选素材 3」… with its tokens; the label opens that mod's settings. Each text is as sent.
function PromptMods({ctx,row,raw}) {
  const groups=[];
  for(const piece of row.pieces){const last=groups[groups.length-1];if(last&&last.modId===piece.modId&&last.role===piece.role&&last.at===piece.at)last.pieces.push(piece);else groups.push({modId:piece.modId,modName:piece.modName,role:piece.role,at:piece.at,pieces:[piece]});}
  return groups.map((group,index)=>{
    const place=group.at&&(index===0||groups[index-1].at!==group.at)?h(PromptAt,{at:group.at}):null,label=group.pieces[0].name,tokens=promptSum(group.pieces);
    const bytes=group.pieces.reduce((sum,piece)=>sum+(piece.bytes??promptBytes(piece.text)),0);
    return h('div',{key:index,className:'ap-prompt-piece'},
      h('div',{className:'ap-prompt-piece-head'},place,
        ctx.openMod&&group.modId?h('button',{type:'button',className:'ap-prompt-mod-link',title:group.modName+' 设置',onClick:()=>ctx.openMod(group.modId)},h('span',null,label),h(Glyph,{name:'chevRight'})):h('span',null,label),
        group.pieces.length>1&&h('span',{className:'ap-prompt-group-count'},group.pieces.length),
        tokens!==null&&h('span',{className:'ap-prompt-tokens',title:bytes.toLocaleString('en-US')+' B'},promptTokenText(tokens))),
      group.pieces.map((piece,i)=>h(PromptText,{key:i,text:piece.text,raw})));
  });
}
// 拼接与封装 · 查看原文: each place that has joins, as its outline — the joins verbatim (a new line shows as ↵), every other part as
// ⟨its row⟩ — then the message envelope with its texts as ⟨1⟩, ⟨2⟩….
function PromptFrame({row}) {
  const line=text=>text.split('\n').flatMap((part,i)=>i?[h('span',{key:'n'+i,className:'ap-prompt-newline','aria-label':'换行'},'↵'),'\n',part]:[part]);
  return (row.layout||[]).map((item,index)=>h('div',{key:index,className:'ap-prompt-piece'},
    h('div',{className:'ap-prompt-piece-head'},h(PromptAt,{at:item.at}),item.envelope&&h('span',{title:item.bytes.toLocaleString('en-US')+' B'},'消息封装')),
    h('pre',{className:'ap-prompt-outline'},item.envelope?item.text:item.segments.map((segment,i)=>segment.slot?h('span',{key:i,className:'ap-prompt-slot'},'⟨'+segment.slot+'⟩'):h(React.Fragment,{key:i},line(segment.text))))));
}
// 拼接与封装 opened — the request as a map: one block per place (系统 /
// 本轮消息 / 工具, or the judge's `POST url`) with its tokens; inside, the parts in the order sent as solid chips (the row's
// name and tokens) and the joins between them (tags, new lines ↵, JSON keys and brackets) as dashed chips — the dashed
// ones are what this row counts; then the message envelope. 「查看原文」 shows the outline with the joins verbatim.
const PROMPT_ENVELOPE_HELP='把本轮消息包成 JSON 消息（role、content、type 和转义）所需的字符。';
function promptJoinText(text) {
  const shown=text.replace(/\n/g,'↵').replace(/\t/g,'⇥').replace(/^ +| +$/g,m=>'␠'.repeat(m.length));
  return shown.length>32?shown.slice(0,31)+'…':shown;
}
function PromptMap({blocks}) {
  return h('div',{className:'ap-prompt-groups'},blocks.map((block,index)=>h('section',{key:index,className:'ap-prompt-group','aria-label':block.envelope?'消息封装':block.head||PROMPT_AT[block.at]},
    h('div',{className:'ap-prompt-group-head'},
      block.envelope?h('span',{className:'ap-prompt-group-name'},'消息封装'):block.head?h('code',{className:'ap-map-head',title:block.head},block.head):h(PromptAt,{at:block.at}),
      block.envelope&&h(Help,{text:PROMPT_ENVELOPE_HELP,label:'消息封装 说明'}),
      Number.isFinite(block.tokens)&&h('span',{className:'ap-prompt-tokens',title:Number.isFinite(block.bytes)?block.bytes.toLocaleString('en-US')+' B':undefined},promptTokenText(block.tokens))),
    block.items&&h('div',{className:'ap-map'},block.items.map((item,i)=>item.join!==undefined?h('code',{key:i,className:'ap-map-join',title:JSON.stringify(item.join)},promptJoinText(item.join)):
      h('span',{key:i,className:'ap-map-part'},item.name,Number.isFinite(item.tokens)&&h('span',{className:'ap-map-tokens'},item.tokens.toLocaleString('en-US'))))))));
}
// 剧情 opened — the reply by paragraph (its number, the speaker's name, the
// text), a JSON object such as the carried state as rows (key | values; a handle reads as its name, the handle is its
// hover), other JSON structurally and prose as it is. 「查看原文」 on the row's header gives every piece as sent.
const promptParagraphs=value=>Array.isArray(value)&&value.length>0&&value.every(item=>schemaObject(item)&&typeof item.text==='string'&&Number.isFinite(item.at))?value:null;
const promptName=(names,value)=>typeof value==='string'&&names&&Object.hasOwn(names,value)?names[value]:null;
function PromptStory({row,raw,names}) {
  if(raw)return h(PromptPieces,{pieces:row.pieces,raw:true});
  return row.pieces.map((piece,index)=>{
    const place=piece.at&&PROMPT_AT[piece.at]&&(index===0||row.pieces[index-1].at!==piece.at)?h(PromptAt,{at:piece.at}):null;
    const value=promptParse(piece.text),paragraphs=promptParagraphs(value),state=!paragraphs&&schemaObject(value)&&promptJson(piece.text);
    return h('div',{key:index,className:'ap-prompt-piece'},
      h('div',{className:'ap-prompt-piece-head'},place,piece.name&&h('span',null,piece.name),paragraphs&&h('span',{className:'ap-prompt-group-count'},paragraphs.length),
        piece.tokens!=null&&h('span',{className:'ap-prompt-tokens',title:promptBytesTitle(piece)},promptTokenText(piece.tokens))),
      paragraphs?h(PromptParagraphs,{paragraphs,names}):state?h(PromptState,{value,names}):h(PromptText,{text:piece.text}));
  });
}
function PromptParagraphs({paragraphs,names}) {
  return h('ol',{className:'ap-story'},paragraphs.map((item,i)=>{
    const actor=typeof item.actor==='string'?item.actor:'',who=actor?promptName(names,actor)||actor:typeof item.speaker==='string'?item.speaker:'';
    return h('li',{key:i},h('span',{className:'ap-story-at'},item.at),h('span',{className:'ap-story-text'},who&&h('b',{title:actor||undefined},who),item.text));
  }));
}
function StateValue({value,names}) {
  if(value===null)return h('span',{className:'ap-cmd-val is-word'},'空');
  if(Array.isArray(value))return value.length?h(React.Fragment,null,value.map((item,i)=>h(StateValue,{key:i,value:item,names}))):h('span',{className:'ap-cmd-val is-word'},'无');
  if(schemaObject(value)&&!Object.keys(value).length)return h('span',{className:'ap-cmd-val is-word'},'无');
  if(schemaObject(value))return h(React.Fragment,null,Object.entries(value).map(([key,item])=>h('span',{key,className:'ap-cmd-arg'},h('code',{className:'ap-cmd-key'},key),h(StateValue,{value:item,names}))));
  const name=promptName(names,value);
  return h('span',{className:'ap-cmd-val'+(name?' is-name':''),title:name?String(value):undefined},name||String(value));
}
function PromptState({value,names}) {
  const nested=item=>schemaObject(item)&&Object.keys(item).length>0&&Object.values(item).every(schemaObject);
  return h('div',{className:'ap-prompt-group'},h('ul',{className:'ap-cmd-rows'},Object.entries(value).map(([key,item])=>h('li',{key,className:'ap-cmd-row'},h('code',{className:'ap-cmd-target'},key),
    h('div',{className:'ap-cmd-lines'},nested(item)?Object.entries(item).map(([inner,v])=>h('div',{key:inner,className:'ap-cmd-line'},
        h('span',{className:'ap-cmd-verb is-name',title:promptName(names,inner)?inner:undefined},promptName(names,inner)||inner),h('span',{className:'ap-cmd-args'},h(StateValue,{value:v,names})))):
      h('div',{className:'ap-cmd-line is-bare'},h('span',{className:'ap-cmd-args'},h(StateValue,{value:item,names}))))))));
}
// 提示词 is a table — the section head, the stage heads and every row share
// one grid (theme.css .ap-prompt-section): name (with its note right after it) | scope (全局 / 本卡 / 本轮, or the packs
// by lamp) | actions (the pencil at the far right). On a narrow pane the scope drops under the name.
// no per-row token count — the opened row shows its pieces' tokens and the
// headings (提示词, 正文模型, 导演) keep the totals.
// the whole row head opens the row — chevron, name, tokens, note, the empty
// space and the scope — with one hover tint; the pencil, reset and (?) stay their own controls (a click on any control,
// or inside a popover portalled out of the head, does not toggle). The chevron button is the row's only Tab stop
// (Enter / Space) and its focus ring is drawn around the whole head. A row may be opened from outside (`open` / `onOpen`: 演出指引's pencil opens 导演指令).
// the pencil (and its reset) sits right after the row's name — 「对白格式 ✎」 —
// then the note; a row without an action shows nothing there. The scope is right-aligned at the row's right edge.
// every row head is one line — name (✎), its tokens, (?), the note, and the
// scope at the right edge; an empty row shows no tokens.
function PromptRow({row,note,help,actions,extra,body,open:shown,onOpen}) {
  const [own,setOwn]=React.useState(false),id=React.useId(),noteId=React.useId(),open=shown??own,setOpen=onOpen||setOwn;
  const tokens=row.pieces.length&&Number.isSafeInteger(row.tokens)?row.tokens:null;
  return h('li',{className:'ap-prompt-row','data-open':open||undefined,'data-row':row.id},
    h('div',{className:'ap-prompt-row-head',onClick:e=>{if(promptHeadClick(e))setOpen(!open);}},
      h('span',{className:'ap-prompt-lead'},
        h('button',{type:'button',className:'ap-prompt-toggle','aria-expanded':open,'aria-controls':id,'aria-describedby':note?noteId:undefined,onClick:()=>setOpen(!open)},h(Glyph,{name:'chevRight'}),h('span',{className:'ap-prompt-name'},row.name)),
        // a quiet pencil on editable rows; generated rows have no action (the 「?」 says so).
        actions?h('span',{className:'ap-prompt-actions'},actions):null,
        Number.isSafeInteger(row.count)&&h('span',{className:'ap-prompt-count'},row.count),
        tokens!==null&&h('span',{className:'ap-prompt-tokens',title:(row.bytes??row.pieces.reduce((sum,piece)=>sum+(piece.bytes??promptBytes(piece.text)),0)).toLocaleString('en-US')+' B'},promptTokenText(tokens)),
        help&&h(Help,{text:help,label:row.name+' 说明'}),
        note&&h('span',{className:'ap-prompt-note',id:noteId},note),
        open&&extra?h('span',{className:'ap-prompt-head-end'},extra):null),
      row.owners&&h('span',{className:'ap-prompt-owner',title:row.ownersTitle||row.owners},row.owners)),
    open&&h('div',{id,className:'ap-prompt-body'},body||(row.pieces.length?h(PromptPieces,{pieces:row.pieces}):h(EmptyState,{compact:true,text:'不加入内容'}))));
}
// A click on the row head that is not on (or in) another control and not from a portalled popover.
const PROMPT_HEAD_CONTROLS='button,a[href],input,textarea,select,label,[role=button],[role=menu],[role=menuitem],[role=dialog],[role=tooltip],[tabindex]';
function promptHeadClick(e) {
  const target=e.target;
  if(!target||!e.currentTarget.contains(target))return false;
  const control=target.closest?.(PROMPT_HEAD_CONTROLS);
  return !control||!e.currentTarget.contains(control);
}
// a heading's total is a heading count, not a row value — title → count → 「?」,
// left-aligned in the muted heading-count style.
function PromptStage({title,help,tokens,action,children}) {
  return h('div',{className:'ap-prompt-stage'},
    h('h4',{className:'ap-prompt-stage-head'},h('span',{className:'ap-prompt-stage-title'},h('span',null,title),
      tokens!==null&&h('span',{className:'ap-section-meta ap-prompt-tokens'},promptTokenText(tokens)),h(Help,{text:help,label:title+' 说明'}),
      action?h('span',{className:'ap-prompt-actions'},action):null)),
    children);
}
const promptIcon=(icon,label,onClick)=>h(IconButton,{icon,label,onClick});
// the 说话人名单 snapshot lists the figures foregroundCapabilityEntries recalls
// (recallFigures over the latest reply or opening and the player's message, plus the last judge's picks).
const FIGURE_RECALL_HELP='只列蓝灯人物，和名字或触发词出现在最近一条回复或玩家消息里（或被判断模型选中）的绿灯人物。';
function StagePrompts({ctx,prompts}) {
  // the Tavern 舞台 tab always supplies the host adapter (stagePrompts); a host
  // without one (offline harnesses, other embeddings) has nothing to show, so the section is left out instead of saying 不可用.
  // folded by default at the end of the page; folded, it reads nothing (no story /
  // director preview), so the view and its reads mount only once the heading opens it.
  const [folded,setFolded]=useStageFold(STAGE_PROMPTS_TITLE,true),opened=React.useRef(false);
  if(!prompts?.usePrompts)return null;
  const onFold=value=>{opened.current=!value;setFolded(value);};
  if(folded)return h(StageSection,{title:STAGE_PROMPTS_TITLE,className:'ap-prompt-section',help:STAGE_PROMPTS_HELP,defaultFolded:true,onFold});
  return h(StagePromptsView,{ctx,prompts,onFold,focusToggle:opened.current});
}
const STAGE_PROMPTS_TITLE='提示词',STAGE_PROMPTS_HELP='按发送顺序原样列出舞台设置加进去的内容，带铅笔的可以修改。';
function StagePromptsView({ctx,prompts,onFold,focusToggle}) {
  const {story,director,refresh}=prompts.usePrompts(),[error,setError]=React.useState(''),[rawRows,setRawRows]=React.useState({});
  const wire=director.result?directorWire(director.result):null;
  const storyRows=storyPromptRows(story,ctx),directorRows=wire?wire.rows:director.result?directorPromptRows(director.result):[];
  // The 演出风格 row always shows (its pencil opens the 素材库); with no style it injects nothing. So does 导演指令,
  // even with every command off. 演出风格's scope is the packs its entries come from (the lead-in is fixed text, not a
  // setting). 导演指令 is 全局 — 舞台模式 › 可用演出, no card chips here.
  const directorShown=promptWithStyles(directorRows).map(row=>({...row,
    ...(row.id==='styles'?promptSources(ctx,row.pieces.filter(piece=>piece.kind==='pack')):row.id==='commands'?{owners:'全局'}:promptSources(ctx,row.pieces))}));
  const storyTokens=story?promptSum(storyRows):null,directorTokens=directorRows.length?promptSum(directorRows):ctx.active.stage?null:0;
  // 智能判断 — its own stage after 导演, only while the preview carries `judge` (a provider
  // is set and the judge is on); one row per batch with the body exactly as sent.
  const judge=ctx.active.stage&&director.result?.judge?director.result.judge:null,judgeRows=judgePromptRows(judge),judgeTokens=judge?promptSum(judgeRows)??0:0;
  const confirmReset=()=>ctx.setConfirm({title:'恢复默认对白格式',body:'自定义的对白格式和补充要求会被清除，所有卡都改用默认格式。',confirmLabel:'恢复默认',danger:true,onConfirm:()=>prompts.resetDialogue()});
  const storyActions=row=>row.leftover||row.figure==='common-roster'||(!row.figure&&row.id!=='format')?null:row.figure?promptIcon('edit','编辑 '+row.name,()=>{const [packId,figureId]=row.figure.split('/');ctx.openPack(packId,'figures',figureId);}):
    h(React.Fragment,null,story?.custom&&promptIcon('reset','对白格式恢复默认',confirmReset),promptIcon('edit','编辑对白格式',()=>ctx.openLayer(close=>prompts.dialogueEditor(close))));
  // 导演指令 and 演出指引 (which follows the commands): the pencil opens 舞台模式 at 可用演出, like 智能判断's.
  const directorActions=row=>row.id==='styles'?h(StageStyleEdit,{ctx,onError:setError}):
    ctx.onCommands&&(row.id==='commands'||row.id==='guidance'&&row.kinds.includes('engine'))?promptIcon('edit',row.id==='commands'?'编辑导演指令':'编辑演出指引',()=>ctx.onCommands()):null;
  // every row with a readable view — 工具定义, 素材清单, 剧情,
  // 拼接与封装, any row holding JSON — has 「查看原文」 on its opened header; rows of prose are already the text as sent.
  const rawOf=row=>!!rawRows[row.id],rawToggle=row=>h(PromptRawToggle,{raw:rawOf(row),onChange:value=>setRawRows(before=>({...before,[row.id]:value}))});
  const readable=row=>row.id==='tool'&&!!promptToolDefs(row)||row.id==='catalogue'&&row.pieces.length>0||row.id==='frame'&&!!row.overview||row.pieces.some(piece=>!piece.items&&promptJson(piece.text));
  const names=React.useMemo(()=>wire?promptHandleNames(wire.rows.flatMap(row=>row.pieces)):{},[director.result]);
  const directorExtra=row=>readable(row)?rawToggle(row):null;
  const directorBody=row=>row.id==='tool'&&promptToolDefs(row)?h(PromptTools,{row,defs:promptToolDefs(row),raw:rawOf(row)}):row.id==='catalogue'?h(PromptCatalogue,{ctx,pieces:row.pieces,raw:rawOf(row)}):
    row.id==='mods'?h(PromptMods,{ctx,row,raw:rawOf(row)}):row.id==='styles'?h(PromptStyles,{ctx,row}):row.id==='story'?h(PromptStory,{row,raw:rawOf(row),names}):
    row.id==='frame'&&row.overview?(rawOf(row)?h(PromptFrame,{row}):h(PromptMap,{blocks:row.overview})):row.pieces.length?h(PromptPieces,{pieces:row.pieces,raw:rawOf(row)}):null;
  const body=!ctx.active.stage?h(EmptyState,{compact:true,text:'舞台模式关闭，导演不运行',icon:'off'}):
    director.error?h(ErrorBox,{error:'读取导演提示词失败（'+director.error+'）',reload:refresh}):
    !director.result?h(Loading,{shape:'fields',count:4}):
    h(React.Fragment,null,h('ul',{className:'ap-prompt-rows','aria-label':'导演提示词'},directorShown.map(row=>h(PromptRow,{key:row.id,row,
        actions:directorActions(row),extra:directorExtra(row),body:directorBody(row)}))),
      !directorRows.length&&h(EmptyState,{compact:true,noun:'正文'}));
  // no combined total — 正文 / 导演 / 判断 are separate requests; each model shows its own.
  return h(StageSection,{title:STAGE_PROMPTS_TITLE,className:'ap-prompt-section',help:STAGE_PROMPTS_HELP,defaultFolded:true,onFold,focusToggle,
      action:h(IconButton,{icon:'refresh',label:'重新读取提示词',disabled:director.loading,onClick:refresh})},
    h(PromptStage,{title:'正文模型',tokens:storyTokens,help:'这里只列正文实际使用的舞台能力快照，会话开始和压缩后首轮更新，其余回合保持不变。'},
      !story?h(Loading,{shape:'fields',count:4}):!storyRows.length?h(EmptyState,{compact:true,text:'对话气泡关闭，不加入内容',icon:'off'}):
      h('ul',{className:'ap-prompt-rows','aria-label':'正文模型提示词'},storyRows.map(row=>h(PromptRow,{key:row.id,row,
        note:row.leftover?'旧条目':row.voice?'含双语台词规则':null,help:row.figure&&row.recalled&&!row.leftover?FIGURE_RECALL_HELP:undefined,actions:storyActions(row)})))),
    h(PromptStage,{title:'导演模型',tokens:ctx.active.stage?directorTokens:null,help:'正文写完后发给导演的全部内容，导演按它安排背景、人物、BGM 和演出。'},body),
    // the judge request in three rows (剧情 / 待判断素材 / 拼接与封装), its
    // pencil on the stage head.
    judge&&h(PromptStage,{title:'判断模型',tokens:judgeTokens,help:'导演之前，这些请求体原样发给判断模型，问哪些未命中的绿灯素材适合本轮。',
        action:ctx.onJudge&&promptIcon('edit','编辑判断模型',()=>ctx.onJudge())},
      judgeRows.length?h('ul',{className:'ap-prompt-rows','aria-label':'判断模型请求'},judgeRows.map(row=>h(PromptRow,{key:row.id,row,note:row.note,
        extra:row.pieces.length&&row.pieces[0].key!=='judge-body'?rawToggle(row):null,body:h(JudgePromptBody,{row,rows:judgeRows,raw:rawOf(row)})}))):
      h(EmptyState,{compact:true,text:'本轮没有要判断的素材'})),
    error&&h('p',{className:'ap-alert',role:'alert'},error));
}

// 舞台设置 › 素材包 — right after a pack's name, tiny previews of what it
// holds, in a fixed order: 人物 (one face per figure: its default outfit's 平和 avatar; a figure without one is skipped,
// never a placeholder) → pictures (背景 / CG / 物品, overlapping tighter the more there are) → one small icon per audio
// kind present (音乐 / 音效 / 环境音 / 配音) → one icon each for 舞台皮肤 / 滤镜 / 演出 / 演出风格 / 模组. No counts, no
// labels; the strip clips (with a fade) instead of wrapping. At most PV_MAX pictures per row.
// Caching, so a second open costs nothing:
//  - the per-pack list is derived once per pack revision (the snapshot's own `revision`; a pack edit, install or
//    reinstall brings a new one, a deleted pack's entry simply ages out of the bounded map);
//  - each picture is a tiny WebP (≈48 px, made once from the leased original off the main thread: createImageBitmap
//    → OffscreenCanvas), kept in memory and in localStorage keyed by the blob's content hash (+ crop and shape) —
//    content-addressed, so it never goes stale and needs no invalidation. A warm open reads it synchronously: no
//    lease RPC, no media request, no full-size decode. Lease URLs carry a one-off ticket, so the HTTP cache cannot
//    serve a later lease of the same blob; this layer is what makes repeat opens free.
const PV_MAX=8,PV_FACES_WITH_PICTURES=5,PV_PREFIX='dsh-tavern:pack-tiny:v1:',PV_INDEX='dsh-tavern:pack-tiny-index:v2',PV_INDEX_V1='dsh-tavern:pack-tiny-index:v1',PV_STORE_MAX=480,PV_STORE_CHARS=900000;
const PV_SIZES={face:[48,48],wide:[66,44],item:[48,48]},PV_PICTURE_KINDS=['backgrounds','cg','props'];
const PV_AUDIO=['music','sfx','ambience'],PV_OTHER=['skins','looks','performances','directions','widgets'];
const pvLists=new Map();
// The default outfit (first enabled, else first) and its calm avatar only; another outfit or state never stands in.
function pvFace(figure,sprites){
  const outfits=figure?.outfits||[],outfit=outfits.find(o=>o.enabled)||outfits[0];if(!outfit)return null;
  const view={...figure,enabled:true,outfits:outfits.map(o=>o===outfit?{...o,enabled:true}:o)};
  const avatar=selectFigureAvatar(view,sprites||{},{outfitKey:outfit.key,emotion:'calm'});
  return avatar?.hash&&avatar.stateId==='calm'&&avatar.outfitKey===outfit.key?{hash:avatar.hash,crop:avatar.crop||null,shape:'face'}:null;
}
const pvPictureHash=asset=>asset.variants?asset.variants.entries.find(row=>row.id===asset.variants.default)?.content.media:asset.media;
function buildPackPreview(pack){
  const manifest=pack.manifest||{},assets=manifest.assets||[],has=kind=>assets.some(a=>a.kind===kind);
  const faces=(manifest.figures||[]).map(id=>{const figure=pack.figures?.[id],face=figure&&pvFace(figure,pack.sprites);return face&&{key:'f:'+id,...face};}).filter(Boolean);
  // Pictures: enabled first, the three kinds interleaved so a pack of many backgrounds still shows its CG / items.
  const pools=PV_PICTURE_KINDS.map(kind=>assets.filter(a=>a.kind===kind&&pvPictureHash(a)).sort((a,b)=>(b.enabled!==false)-(a.enabled!==false))
    .map(a=>({key:kind+':'+a.id,hash:pvPictureHash(a),crop:null,shape:kind==='props'?'item':'wide'})));
  const pictures=[];for(let i=0;pictures.length<PV_MAX&&pools.some(p=>i<p.length);i++)for(const p of pools)if(i<p.length&&pictures.length<PV_MAX)pictures.push(p[i]);
  const shownFaces=faces.slice(0,pictures.length?PV_FACES_WITH_PICTURES:PV_MAX),shownPictures=pictures.slice(0,PV_MAX-shownFaces.length);
  const voices=Object.keys(manifest.voiceLibrary?.voices||{}).length>0;
  const icons=[...PV_AUDIO.filter(has),...(voices?['voice']:[]),...PV_OTHER.filter(has)];
  const names=[...((manifest.figures||[]).length?['figures']:[]),...PV_PICTURE_KINDS.filter(has),...icons].map(k=>k==='voice'?'配音':kinds[k]);
  return {faces:shownFaces,pictures:shownPictures,icons,names};
}
function packPreview(pack){
  const id=pack?.manifest?.id;if(!id)return null;
  const hit=pvLists.get(id);
  if(hit&&(hit.pack===pack||(pack.revision&&hit.revision===pack.revision)))return hit.value;
  const value=buildPackPreview(pack);
  if(!hit&&pvLists.size>=128)pvLists.delete(pvLists.keys().next().value);
  pvLists.set(id,{pack,revision:pack.revision,value});
  return value;
}
// ---- tiny pictures (content-addressed) ----
const pvMemory=new Map(),pvFailed=new Set(),pvPending=new Set(),pvListeners=new Map(),pvQueue=[];
let pvActive=0,pvIndexCache=null;
const pvKey=item=>item.hash+'|'+item.shape+(item.crop?'|'+[item.crop.x,item.crop.y,item.crop.w,item.crop.h].map(n=>Math.round(n*1e4)).join(','):'');
function pvStore(){try{return typeof localStorage==='undefined'?null:localStorage;}catch(_){return null;}}
// The stored tiny pictures are an LRU bounded twice: ≤ PV_STORE_MAX entries and ≤ PV_STORE_CHARS characters in total
// (localStorage counts UTF-16, so ≈ 1.8 MB), far under the origin quota. The index ([key, length] oldest first) lives
// in memory; a read moves its key to the end, and the next save writes the order back.
function pvPeek(key){
  const known=pvMemory.get(key);if(known)return known;
  const store=pvStore();let url=null;try{url=store?.getItem(PV_PREFIX+key)||null;}catch(_){}
  if(url){pvMemory.set(key,url);const index=pvIndex(store),at=index.findIndex(row=>row[0]===key);if(at>=0&&at<index.length-1)index.push(...index.splice(at,1));}
  return url;
}
function pvIndex(store){
  if(pvIndexCache)return pvIndexCache;
  let rows=[];
  try{const value=JSON.parse(store.getItem(PV_INDEX)||'null');
    if(Array.isArray(value))rows=value.filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&row[1]>0);
    else{const old=JSON.parse(store.getItem(PV_INDEX_V1)||'[]');if(Array.isArray(old))rows=old.map(key=>[key,(store.getItem(PV_PREFIX+key)||'').length]).filter(row=>row[1]>0);store.removeItem?.(PV_INDEX_V1);}}
  catch(_){rows=[];}
  return pvIndexCache=rows;
}
function pvSave(key,url){
  pvMemory.set(key,url);
  const store=pvStore();if(!store||url.length>PV_STORE_CHARS/64)return;
  const index=pvIndex(store),drop=row=>{try{store.removeItem(PV_PREFIX+row[0]);}catch(_){}};
  const at=index.findIndex(row=>row[0]===key);if(at>=0)index.splice(at,1);
  let chars=index.reduce((sum,row)=>sum+row[1],0)+url.length;
  while(index.length&&(index.length>=PV_STORE_MAX||chars>PV_STORE_CHARS)){const row=index.shift();chars-=row[1];drop(row);}
  for(let attempt=0;attempt<2;attempt++){
    try{store.setItem(PV_PREFIX+key,url);index.push([key,url.length]);store.setItem(PV_INDEX,JSON.stringify(index));return;}
    catch(_){for(const row of index.splice(0,Math.max(32,index.length>>2)))drop(row);}
  }
}function pvListen(key,fn){let set=pvListeners.get(key);if(!set){set=new Set();pvListeners.set(key,set);}set.add(fn);return()=>{set.delete(fn);if(!set.size&&pvListeners.get(key)===set)pvListeners.delete(key);};}
function pvNotify(key){for(const fn of [...(pvListeners.get(key)||[])])fn();}
const pvCan=()=>typeof createImageBitmap==='function'&&typeof OffscreenCanvas==='function'&&typeof fetch==='function'&&typeof FileReader==='function';
const pvIdle=()=>new Promise(resolve=>typeof requestIdleCallback==='function'?requestIdleCallback(()=>resolve(),{timeout:500}):setTimeout(resolve,16));
function pvRequest(binding,packId,item){
  const key=pvKey(item);
  if(pvMemory.has(key)||pvFailed.has(key)||pvPending.has(key))return;
  if(!pvCan()||!binding?.previewMedia){pvFailed.add(key);pvNotify(key);return;}
  pvPending.add(key);pvQueue.push({binding,packId,item,key});pvPump();
}
// Two at a time, each started in idle time, so a cold open never competes with the panel's own first paint.
function pvPump(){
  while(pvActive<2&&pvQueue.length){
    const job=pvQueue.shift();pvActive++;
    pvIdle().then(()=>pvMake(job)).then(url=>pvSave(job.key,url),()=>pvFailed.add(job.key))
      .finally(()=>{pvPending.delete(job.key);pvActive--;pvNotify(job.key);pvPump();});
  }
}
async function pvMake({binding,packId,item}){
  const media=await holdMedia(binding,packId,item.hash);let source;
  try{const response=await fetch(media.url,{credentials:'same-origin'});if(!response.ok)throw new Error('HTTP '+response.status);source=await createImageBitmap(await response.blob());}
  finally{media.release();}
  let small=null;
  try{
    const [W,H]=PV_SIZES[item.shape],c=item.crop||{x:0,y:0,w:1,h:1},iw=source.width,ih=source.height;
    let sx=Math.max(0,iw*c.x),sy=Math.max(0,ih*c.y),sw=Math.min(iw-sx,iw*c.w),sh=Math.min(ih-sy,ih*c.h),dw=W,dh=H;
    if(!(sw>=1&&sh>=1))throw new Error('empty picture');
    if(item.shape==='item'){const s=Math.min(W/sw,H/sh);dw=Math.max(1,Math.round(sw*s));dh=Math.max(1,Math.round(sh*s));}
    else if(sw/sh>W/H){const w=sh*W/H;sx+=(sw-w)/2;sw=w;}else{const hh=sw*H/W;sy+=item.shape==='face'?0:(sh-hh)/2;sh=hh;}
    small=await createImageBitmap(source,Math.round(sx),Math.round(sy),Math.max(1,Math.round(sw)),Math.max(1,Math.round(sh)),{resizeWidth:dw,resizeHeight:dh,resizeQuality:'high'});
    const canvas=new OffscreenCanvas(W,H);canvas.getContext('2d').drawImage(small,Math.round((W-dw)/2),Math.round((H-dh)/2));
    const blob=await canvas.convertToBlob({type:'image/webp',quality:.82});
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  }finally{source.close?.();small?.close?.();}
}
// One shared IntersectionObserver (start making a row's pictures once it nears view) and one shared ResizeObserver
// (mark a strip that overflows, so only then does its end fade).
let pvSeenObserver=null,pvClipObserver=null;const pvSeenCalls=new WeakMap();
function pvWatch(node,fn){
  if(typeof IntersectionObserver==='undefined'){fn();return()=>{};}
  if(!pvSeenObserver)pvSeenObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){const call=pvSeenCalls.get(entry.target);pvSeenCalls.delete(entry.target);pvSeenObserver.unobserve(entry.target);call?.();}},{rootMargin:'240px'});
  pvSeenCalls.set(node,fn);pvSeenObserver.observe(node);
  return()=>{pvSeenCalls.delete(node);pvSeenObserver.unobserve(node);};
}
function pvClip(node){
  if(typeof ResizeObserver==='undefined')return()=>{};
  if(!pvClipObserver)pvClipObserver=new ResizeObserver(entries=>{for(const {target} of entries){if(target.scrollWidth>target.clientWidth+1)target.setAttribute('data-clipped','');else target.removeAttribute('data-clipped');}});
  pvClipObserver.observe(node);
  return()=>pvClipObserver.unobserve(node);
}
// Overlap as a share of a tile's own width: 1 whole, 2 slightly, up to ~60% at the cap.
const pvOverlap=count=>count<=1?0:Math.min(.6,.1+.065*count).toFixed(3);
function PreviewTile({binding,packId,item,seen}) {
  const key=pvKey(item),[url,setUrl]=React.useState(()=>pvPeek(key)),[failed,setFailed]=React.useState(()=>pvFailed.has(key));
  React.useEffect(()=>{const sync=()=>{setUrl(pvPeek(key));setFailed(pvFailed.has(key));};sync();return pvListen(key,sync);},[key]);
  React.useEffect(()=>{if(seen&&!url&&!failed)pvRequest(binding,packId,item);},[key,seen,url,failed,binding,packId]);
  if(failed&&!url)return null;
  return h('span',{className:'ap-pv-tile is-'+item.shape,'data-empty':url?undefined:true},url&&h('img',{src:url,alt:'',decoding:'async',loading:'lazy',draggable:false}));
}
function PreviewIcon({kind}) {
  return h('svg',{className:'ap-pv-icon',width:14,height:14,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},
    h('path',{d:kind==='voice'?glyphs.mic:kindGlyphs[kind],stroke:'currentColor',strokeWidth:1.3,strokeLinecap:'round',strokeLinejoin:'round'}));
}
// a list row is a summary. Its pictures and kind icons come with it (summaryPreview);
// faces need the figures, so a row with figures whose full document the page does not hold (detail, the lit packs) reads it
// once the row is seen (one read per pack, kept by revision in the transport).
function summaryPreview(row){
  const counts=row.counts||{},has=kind=>counts[kind]>0;
  const pictures=(row.pictures||[]).slice(0,PV_MAX).map(p=>({key:p.kind+':'+p.id,hash:p.hash,crop:null,shape:p.kind==='props'?'item':'wide'}));
  const icons=[...PV_AUDIO.filter(has),...(row.voices>0?['voice']:[]),...PV_OTHER.filter(has)];
  const names=[...(has('figures')?['figures']:[]),...PV_PICTURE_KINDS.filter(has),...icons].map(k=>k==='voice'?'配音':kinds[k]);
  return {faces:[],pictures,icons,names};
}
function PackPreviews({binding,pack:row,detail}) {
  const [read,setRead]=React.useState(null),pack=detail||(row?.summary?read?.revision===row.revision?read:null:row);
  const preview=pack?packPreview(pack):row?.manifest?.id?summaryPreview(row):null,ref=React.useRef(null),[seen,setSeen]=React.useState(false),packId=row?.manifest?.id;
  React.useEffect(()=>{if(!seen||pack||!row?.summary||!(row.counts?.figures>0)||!binding?.service)return;let live=true;
    loadPackDetail(binding,row).then(full=>{if(live)setRead(full);},()=>{});return()=>{live=false;};},[seen,!!pack,packId,row?.revision]);
  React.useEffect(()=>{const node=ref.current;if(!node)return;const stopSeen=seen?null:pvWatch(node,()=>setSeen(true)),stopClip=pvClip(node);return()=>{stopSeen?.();stopClip();};},[seen,!!preview]);
  if(!preview||!preview.faces.length&&!preview.pictures.length&&!preview.icons.length)return null;
  const label=preview.names.join('、'),group=(name,items)=>items.length>0&&h('span',{className:'ap-pv-group is-'+name,style:{'--ap-pv-f':pvOverlap(items.length)}},
    items.map(item=>h(PreviewTile,{key:item.key,binding,packId,item,seen})));
  return h('span',{ref,className:'ap-pack-previews',role:'img','aria-label':'包含'+label,title:label},
    group('faces',preview.faces),group('pictures',preview.pictures),
    preview.icons.length>0&&h('span',{className:'ap-pv-group is-icons'},preview.icons.map(kind=>h(PreviewIcon,{key:kind,kind}))));
}
