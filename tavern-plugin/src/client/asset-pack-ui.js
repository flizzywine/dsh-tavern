// P5 workbench mounted through the authenticated v2 browser port.
// This file lives in the outer client factory; it never reaches into another feature closure.
// @include-shared figure-auto-color.cjs
// @include-shared asset-image-publication.cjs
// @include-shared figure-outfit-removal.cjs
// @include-domain pack-avatar.cjs
// @include-protocol director-commands.cjs
// @include-protocol asset-tags.cjs
// @include-protocol audio-categories.cjs
// @include widget-contracts.cjs
// one kind order — built-in kinds as listed, then mod-brought kinds grouped by mod id
// (stable: mods sorted by id, a mod's kinds in the order it lists them). modKinds rows are [kind, modId, label].
function kindOrder(builtin, modKinds) {
  const mods=[...new Set(modKinds.map(row=>row[1]))].sort();
  return [...builtin, ...mods.flatMap(mod=>modKinds.filter(row=>row[1]===mod&&!builtin.includes(row[0])).map(row=>row[0]))];
}
// the one error → player sentence. Every panel, the
// 舞台设置 alert, the catalogue, 生图 cells and the sidebar 最新错误 say errors through this. A known code gets its sentence
// (the caller's table first, then the shared one); a host message that is already plain Chinese keeps its reason, minus
// the 「（HTTP 401）：provider text」 tail; anything else (English, a bare code, a uuid) is the caller's fallback.
// The raw text goes to the console (and the 调试视图's 最新错误) only.
const PLAYER_ERRORS={REVISION_CONFLICT:'内容已被修改，请重新载入',
  LIMIT_EXCEEDED:'素材数据超过大小或数量限制，未能保存；请减少本次提交的内容后重试',
  TRIGGER_LINT:'触发词不符合要求，请填写能在正文中出现的简短词语，去掉重复或过于笼统的词后再保存',
  MISSING_DEPENDENCY:'素材引用不完整，请补齐所引用的图片、差分或资源后重试；无需安装额外程序',
  PACK_UNAVAILABLE:'这张卡用到的一个素材包找不到了，请在 舞台设置 › 素材包 里移除或重新安装它',
  AbortError:'保存超时，结果尚未确认；请重新载入后检查',TimeoutError:'保存超时，结果尚未确认；请重新载入后检查'};
// Names a player reads as words, not code: product names and short capitals (MP3、FLAC、CG、BGM — not HTTP or a CODE_NAME).
const PLAYER_TERMS=/Live2D|Spine|ComfyUI|Fish Audio|WebP|\b(?!HTTP\b)[A-Z][A-Z0-9]{1,4}\b(?!_)/g;
const playerErrorSeen=new Set();
function playerPlain(text){
  const t=String(text||'').replace(/（HTTP\s*\d+）[\s\S]*$/,'').replace(/[：:]\s*[A-Za-z][\s\S]*$/,'').trim();
  return t&&/\p{Script=Han}/u.test(t)&&!/[A-Za-z]/.test(t.replace(PLAYER_TERMS,''))?t:'';
}
function playerErrorText(error,{codes,fallback='出错了，请稍后再试'}={}){
  if(!error)return '';
  const message=typeof error==='string'?error:String(error.message||''),name=typeof error==='string'?'':String(error.name||'');
  const code=typeof error==='string'?'':String(error.code||'')||(['AbortError','TimeoutError'].includes(name)?name:'');
  const key=code||(/^[A-Z][A-Z0-9_]+$/.test(message)?message:'');
  const named=key&&(codes?.[key]||PLAYER_ERRORS[key]);
  const said=named?(key==='PACK_UNAVAILABLE'&&error.packName?'这张卡用到的素材包「'+error.packName+'」找不到了，请在 舞台设置 › 素材包 里移除或重新安装它':named):playerPlain(message)||fallback;
  const raw=[code,message].filter(Boolean).join(': ');
  if(raw&&said!==raw&&!playerErrorSeen.has(raw)&&typeof console!=='undefined'){if(playerErrorSeen.size>200)playerErrorSeen.clear();playerErrorSeen.add(raw);console.warn('dsh-tavern:',raw);}
  return said;
}
function createAssetPackUI(React, {VoicePicker, AvatarImage, HelpTip, emotions, prepareImage: prepareImageOverride, spine: spineKit, timeGrade, autoChoices} = {}) {
  const h = React.createElement;
  // autoChoices is the client's useAutoChoicesPreference hook (auto-choices-preference.js) —
  // the one reader/writer of tavern-settings candidateAutoGenerate — for the 基础设置 row 「自动生成选项」.
  // timeGrade(projection) is the stage's compensating background colour matrix for a time without its
  // variant (pack-playback.cjs createPackSceneLayers → backgroundGrade) or null; injected by the client.
  // shared fixed figure emotion rows; no retired card emotion writer.
  const emotionKit = {moods:emotions?.moods || [], colors:emotions?.colors};
  // one kind map and one order (人物 first) for tabs, counts and the add/copy menus.
  // the user-facing word for widgets is 「模组」 (ids and APIs stay `widgets`).
  // 演出风格 (`directions`) — text entries the director always receives
  // while their pack is lit (蓝灯 全局 / 绿灯 本卡) and the entry is 启用.
  // built-in kinds come first in their canonical order; kinds a mod brings (MOD_KINDS:
  // kind → owning mod id, e.g. the danmaku mod's 观众群) follow them — mod id order, then the order listed. KIND_ORDER is
  // the one order every kind list uses (library tabs + 更多, pack-row chips, pack window tabs, setup, add/copy menus).
  // 入场演出 (`entrances`, dsh.entrance/1) - what the stage plays as it opens; 蓝灯 or 关闭.
  const BUILTIN_KINDS = {figures:'人物', backgrounds:'背景', cg:'CG', props:'物品', performances:'演出组合', music:'音乐', sfx:'音效', ambience:'环境音', looks:'滤镜', skins:'舞台皮肤', entrances:'入场演出', videos:'视频', widgets:'模组', directions:'演出风格'};
  const MOD_KINDS = [['audience','dsh.danmaku','观众群'], ['timers','dsh.timer','计时器']];
  const KIND_ORDER = kindOrder(Object.keys(BUILTIN_KINDS), MOD_KINDS);
  const kinds = Object.fromEntries(KIND_ORDER.map(key => [key, BUILTIN_KINDS[key] ?? MOD_KINDS.find(row => row[0] === key)[2]]));
  // shorter labels for the library's one-row kind filter (full name stays the tab's name).
  const KIND_TAB_LABELS = {skins:'皮肤'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const errorText = (error, fallback) => playerErrorText(error, {fallback});
  // no grey helper text (panel-ui-design.md §一.5). Help is the one place explanations live: a small
  // 「?」 button whose tooltip shows on hover / keyboard focus and toggles on click or tap; Esc or an outside tap closes.
  // In the client the shared HelpTip is injected (viewport-placed popover, same look as the settings pages);
  // LocalHelp is the self-contained fallback (tests, standalone harnesses).
  const Help=HelpTip?({text,label='说明'})=>h(HelpTip,{label},text):LocalHelp;
  function LocalHelp({text,label='说明'}) {
    const [open,setOpen]=React.useState(false),root=React.useRef(null),id=React.useId();
    React.useEffect(()=>{if(!open||typeof document==='undefined')return;const out=e=>{if(root.current&&!root.current.contains(e.target))setOpen(false);};document.addEventListener('pointerdown',out,true);return()=>document.removeEventListener('pointerdown',out,true);},[open]);
    return h('span',{className:'ap-help-anchor',ref:root,'data-open':open||undefined,onKeyDown:e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);}}},
      h('button',{type:'button',className:'ap-help','aria-label':label,'aria-describedby':id,'aria-expanded':open,onClick:e=>{e.preventDefault();e.stopPropagation();setOpen(!open);}},'?'),
      h('span',{role:'tooltip',id,className:'ap-help-tip'},text));
  }
  function Actions({children}) { return h('div',{className:'ap-actions'},children); }
  function Button({children, primary, ...props}) { return h('button',{type:'button',className:primary?'ap-primary':'',...props},children); }
  function validDraft() { return typeof document==='undefined'||!document.querySelector?.('.ap-ui [aria-invalid="true"]'); }
  // the JSON box of the old 导演风格 library is gone (its only user).
  function useTask(binding, toText=errorText) {
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''), life=React.useRef(0);
    React.useEffect(()=>{const generation=++life.current;return()=>{if(life.current===generation)life.current++;};},[binding]);
    async function task(fn) { const generation=life.current;setBusy(true);setError('');try{const result=await fn();return generation===life.current?result:undefined;}catch(e){if(generation===life.current)setError(toText(e));return undefined;}finally{if(generation===life.current)setBusy(false);} }
    return {busy,error,task,life};
  }
  function ErrorBox({error, reload}) { return error && h('div',{role:'alert',className:'ap-alert ap-hint-chip'},'\u26a0 ',error,reload && h(Button,{onClick:reload},'重新载入')); }
  function useLoad(binding,loader,deps) {
    const [value,setValue]=React.useState(null), work=useTask(binding),sequence=React.useRef(0);
    async function reload(){const ticket=++sequence.current,result=await work.task(loader);if(ticket===sequence.current&&result!==undefined)setValue(result);}
    React.useEffect(()=>{reload();return()=>{sequence.current++;};},[binding,...deps]);
    return {...work,value,setValue,reload};
  }
  // dialogs and floating menus render in one top-level layer, a portal into <body> like LargeModal.
  // A host container may establish the containing block for position: fixed (the bottom dock is translated and has
  // contain: layout) and clip its content, so nothing that must cover or escape the window may stay inside a panel.
  // The wrapper is .ap-ui (panel tokens and component styles) with display: contents; it adds no box of its own.
  // Layers stack in mount order: a confirmation opened from the pack modal mounts later and sits above it.
  function canPortal() { return typeof ReactDOM!=='undefined'&&!!ReactDOM&&typeof ReactDOM.createPortal==='function'&&typeof document!=='undefined'&&!!document?.body; }
  function TopLayer({children}) { return canPortal()?ReactDOM.createPortal(h('div',{className:'ap-ui ap-layer'},children),document.body):h(React.Fragment,null,children); }
  // initialFocus 'dialog' focuses the dialog itself (no ring on its × or name field when it
  // opens; Tab enters the first control). Other dialogs keep focus on their first control, or on the control marked
  // data-autofocus (the safe choice of a question, e.g. 「不启用」).
  // `frame` adds props to the dialog element itself (获取素材包 takes a dropped ZIP anywhere on it).
  // every dialog is in the shared popup stack (useOverlay, inline-field.js): a press
  // outside the topmost dialog or Esc closes only that one (never while busy); a press during an unsaved text edit only ends the edit.
  // `headless` — the content draws its own title line (a mod page's ‹ head); `title` stays the
  // dialog's accessible name.
  // a `frame.onKeyDown` runs before the dialog's own keys (the preview's ←→).
  function Modal({title,children,onClose,busy=false,className='',head,foot,closable=true,initialFocus='control',frame,headless=false}) {
    const ref=React.useRef(null);
    useOverlay(true,()=>[ref.current],()=>{if(!busy)onClose();});
    React.useEffect(()=>{const previous=typeof document==='undefined'?null:document.activeElement;(initialFocus==='dialog'?ref.current:ref.current?.querySelector('[data-autofocus]')||ref.current?.querySelector('button,input,select,textarea'))?.focus?.({preventScroll:true});return()=>previous?.focus?.();},[]);
    function key(event){frame?.onKeyDown?.(event);if(event.key==='Escape'){if(!overlayEscape(event)){event.preventDefault();event.stopPropagation();if(!busy)onClose();}}if(event.key==='Tab'){const nodes=[...(ref.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[])];if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
    return h(TopLayer,null,h('div',{className:'ap-modal-scrim'},h('section',{className:('ap-modal '+className).trim(),role:'dialog','aria-modal':true,'aria-label':title,ref,...(initialFocus==='dialog'?{tabIndex:-1}:{}),...frame,onKeyDown:key},head||(headless?null:h('header',null,h('h2',null,title),closable&&h(Button,{'aria-label':'关闭',disabled:busy,onClick:onClose},'关闭'))),head?h('div',{className:'ap-modal-body'},children):children,foot)));
  }
  // a single pack (a download or a local ZIP) is installed
  // through PackInstallSheet — its 封面, what is inside in words, plain consequences. The chosen button is the decision; the
  // backend's acceptScriptRisk acknowledgement goes with 「安装 / 更新」 (execution still needs a card's 模组 switch and the
  // Engine grant). A card ZIP has its own sheet (CardImportSheet). onRetry: a CAS failure on a downloaded preview cancels it
  // and downloads again (no overwrite). origin: {url} of the download, shown under 「详情」.
  // `step` {index,count} — this pack's place in a 素材包合集 (PackSetInstall).
  function ConflictDialog({binding,preview,onDone,onClose:close,onRetry,origin,step}) {
    const [stale,setStale]=React.useState(false),work=useTask(binding,catErrorText);
    const cancel=()=>binding.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision:'cancel'});
    React.useEffect(()=>()=>{Promise.resolve().then(cancel).catch(()=>{});},[binding,preview.inspectionId]);
    async function onClose(){if(work.busy)return;await work.task(cancel);close();}
    // import is already committed if sampling fails; retry only the remaining colour fill.
    const publication=React.useRef(null);
    async function publish(decision){
      const result=await work.task(async()=>{
        if(!publication.current){
          let saved;
          try{saved=await binding.service.applyImport({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decision,acceptScriptRisk:decision!=='noop'&&(preview.scriptRisk||[]).length>0});}
          catch(error){if(error?.code==='REVISION_CONFLICT'&&onRetry){setStale(true);return undefined;}throw error;}
          publication.current={saved,packs:decision==='noop'?[]:[saved.snapshot?.manifest.id||preview.packId]};
        }
        const committed=publication.current;
        try{while(committed.packs.length){const pack=await binding.service.getPackSnapshot({packId:committed.packs[0]});const filled=await fillImportedFigureColors(binding,pack);committed.saved={...committed.saved,snapshot:filled.snapshot};committed.packs.shift();}}
        catch(error){throw new Error('素材包已导入，自动取色未完成：'+errorText(error)+'；请重试');}
        return committed.saved;
      });if(result)onDone(result);
    }
    async function retry(){if(work.busy)return;await work.task(cancel);onRetry();}
    return h(PackInstallSheet,{preview,origin,step,busy:work.busy,error:work.error,stale,onClose,onRetry:onRetry&&retry,onInstall:publish});
  }
  // ---------- 导入卡片: the card ZIP import (r3) ----------
  // one sheet from the picked file to the imported card, in the install sheet's language. Reading (Spinner and words
  // only after 150 ms) → what you get: the card's picture (its own PNG when the ZIP is this card's), its name and what comes
  // with it in words; one plain line when it replaces this card's content (⚠ only when it is another card); a row only for
  // a bundled pack that differs from an installed one (另存一份 by default — nothing installed changes — or 替换原来的,
  // each with its consequence); and, when the card uses 模组, the one risk sentence beside its two answers 「不启用」 /
  // 「启用」 — both import, only the card's 模组 switch differs (disableWidgets true / false); focus starts on 不启用.
  // A card exported with 模组 off keeps them off (the import cannot switch them on), so it asks nothing. New, identical and
  // id-clashing packs need no decision. Script files are acknowledged with the import (acceptScriptRisk) like a pack
  // install. Each pack and what happens to it, widget files and the values they read or change sit in 「详情」. Errors are
  // one plain line with one way out (换一个文件 / 重试). No checkbox, no ledger, no card count, no raw JSON.
  const RISK_SOURCES={mvu:'MVU 变量','helper-chat':'会话变量'},RISK_OPS={replace:'改写',insert:'新增',delta:'增减',remove:'删除'};
  const cardRawData=raw=>raw&&typeof raw==='object'&&(raw.spec==='chara_card_v2'||raw.spec==='chara_card_v3')&&raw.data&&typeof raw.data==='object'?raw.data:raw;
  const cardRawName=raw=>{const name=cardRawData(raw)?.name;return typeof name==='string'?name.trim():'';};
  // The card's exported 模组 switch (stage.widgets is on only when exactly true).
  const cardWidgetsOn=raw=>cardRawData(raw)?.extensions?.dsh_tavern?.stage?.widgets===true;
  // Same content → noop, new → install, an id clash → keep-both (the only choice); a different installed version starts
  // on 另存一份 until the user picks 替换原来的 (no default update).
  const cardPackDefault=choices=>['noop','install'].find(choice=>choices.includes(choice))||'keep-both';
  const cardPackAsks=row=>(row.choices||[]).includes('update');
  const cardPackAction=(row,decision)=>({noop:'已装过相同的',install:'新安装',update:'替换原来的','keep-both':cardPackAsks(row)?'另存一份':'和已安装的重复，另存一份'})[decision]||'';
  const CARD_IMPORT_FILE='这个文件不是卡片 ZIP，或者已经损坏。';
  const CARD_IMPORT_ERRORS={INVALID_INPUT:CARD_IMPORT_FILE,INVALID_PATH:CARD_IMPORT_FILE,FILE_CLOSURE_MISMATCH:CARD_IMPORT_FILE,LIMIT_EXCEEDED:'文件太大，或者磁盘空间不够。',
    DUPLICATE_ID:'里面的素材和已安装的冲突，不能导入。',REVISION_CONFLICT:'卡片或素材刚刚被改过，请重试。',ASSET_UNAVAILABLE:'暂时无法导入，请重试。',
    NOT_FOUND:'找不到这张卡，请重新打开后再试。',RECOVERY_REQUIRED:'舞台素材需要恢复，请重启后再试。'};
  const CARD_IMPORT_PICK=new Set(['INVALID_INPUT','INVALID_PATH','FILE_CLOSURE_MISMATCH','LIMIT_EXCEEDED','DUPLICATE_ID']);
  // reading a card from an address says what failed and what to do — the HTTP
  // status the host passes in `detail` (pack-transport.js), no network, not a card ZIP, too large. `file` here means
  // 「换一个网址」 (the address sheet again, address kept); `again` means 「重试」.
  function cardUrlFailure(error) {
    const code=error?.code||'',detail=String(error?.detail||'');
    if(['AbortError','TimeoutError'].includes(error?.name))return {text:'下载超时。请检查网络后重试。',again:true};
    if(code==='DOWNLOAD_FAILED'){
      const status=Number((detail.match(/HTTP (\d{3})/)||[])[1])||0;
      if(status===404||status===410)return {text:'这个网址找不到文件（'+status+'）。请检查地址是否完整、文件是否还在。',file:true};
      if(status===401||status===403)return {text:'这个网址不让下载（'+status+'）。请确认文件是公开的。',file:true};
      if(status>=500)return {text:'对方服务器出错了（'+status+'），请稍后重试。',again:true};
      if(status)return {text:'下载失败（HTTP '+status+'）。请检查地址是否正确。',file:true};
      if(/Private or reserved/i.test(detail))return {text:'这个网址指向本机或内网，不能下载。请用公开的 https:// 地址。',file:true};
      if(/redirect/i.test(detail))return {text:'这个网址跳转太多次，没能下载。请换成文件的直接下载地址。',file:true};
      if(/timed out|stalled/i.test(detail))return {text:'下载超时。请检查网络后重试。',again:true};
      return {text:'连不上这个网址。请检查网络，或确认地址能在浏览器里打开。',again:true};
    }
    if(code==='LIMIT_EXCEEDED')return {text:'文件太大（上限 256 MB），或者暂存空间不够。',file:true};
    if(['INVALID_INPUT','INVALID_PATH','FILE_CLOSURE_MISMATCH'].includes(code))return {text:'下载到的不是卡片 ZIP。请确认地址直接指向 .zip 文件，而不是网页。',file:true};
    if(code==='ASSET_UNAVAILABLE')return {text:'暂时下载不了（可能有另一张卡正在下载），请稍后重试。',again:true};
    return null;
  }
  // One plain line per failure. `file`: another file is the way out; `again`: reading the same file again is.
  function cardImportFailure(error,stage,url) {
    if(url&&stage==='read'){const failure=cardUrlFailure(error);if(failure)return failure;}
    const code=error?.code||(/^[A-Z_]+$/.test(String(error?.message||''))?error.message:'');
    if(error?.colour)return {text:'卡片已导入，但人物的颜色还没设置好，请重试。'};
    if(['AbortError','TimeoutError'].includes(error?.name))return stage==='read'?{text:'读取超时，请重试。',again:true}:{text:'等待超时。导入可能已经完成，请稍后查看这张卡。'};
    // A file problem is only told while reading; a refusal at import time is never blamed on the file.
    const file=stage==='read'&&CARD_IMPORT_PICK.has(code),known=stage==='read'||CARD_IMPORT_ERRORS[code]!==CARD_IMPORT_FILE?CARD_IMPORT_ERRORS[code]:'';
    const text=known||(!code&&/[\u3400-\u9fff]/.test(String(error?.message||''))?String(error.message):stage==='read'?'没能读取这个文件，请重试。':'没能导入，请重试。');
    return {text,file,again:stage==='read'||['REVISION_CONFLICT','ASSET_UNAVAILABLE'].includes(code)};
  }
  // MB sent of a card ZIP: whole MB, one decimal under 10 MB (so a small file still moves).
  const cardUploadMb=(bytes,total)=>{const mb=bytes/1048576;return total<10*1048576?mb.toFixed(1):String(Math.floor(mb));};
  // The card's picture: its own PNG (the card file it was imported from) when `path` is given, else its 封面 art — a card
  // shape on a tint picked from the name, with a second card peeking out behind it.
  function CardCover({path,name}) {
    const [failed,setFailed]=React.useState(false);
    return h('span',{className:'ap-card-cover',style:{'--ap-cat-tint':catTint(name)},'aria-hidden':true},h(Glyph,{name:'card'}),
      path&&!failed&&h(RevealImg,{key:path,src:'/api/dsh-tavern/card-image?path='+encodeURIComponent(path),alt:'',decoding:'async',onError:()=>setFailed(true)}));
  }
  function useLater(ms=typeof SPINNER_DELAY_MS==='number'?SPINNER_DELAY_MS:150) {
    const [late,setLate]=React.useState(false);
    React.useEffect(()=>{const timer=setTimeout(()=>setLate(true),ms);return()=>clearTimeout(timer);},[]);
    return late;
  }
  // One bundled pack that differs from an installed one: its name, the two choices and the one consequence line.
  function CardPackChoice({row,decision,disabled,onChange}) {
    const name=row.current?.manifest?.name||row.incoming?.manifest?.name||'素材包',replacing=decision==='update';
    const losses=replacing?catRemovedLocal({current:row.current,diff:row.diff}):[];
    return h('div',{className:'ap-card-pack'},
      h('div',{className:'ap-card-pack-head'},h('strong',null,name),
        h(Segmented,{className:'ap-cat-segment',label:name,value:replacing?'update':'keep-both',disabled,onChange,options:[['keep-both','另存一份'],['update','替换原来的']]})),
      h('p',{className:'ap-card-pack-line'},replacing?'你装过另一个版本。替换后，用到它的卡都会跟着变。':'你装过另一个版本。另存一份，原来的不变。'),
      losses.length>0&&h(CatBand,{list:h(CatItems,{items:losses})},'替换后，下面这些会被删除：'));
  }
  // 「详情」: each bundled pack with what is in it and what happens to it; each 模组 with its pack, files and values.
  function CardImportFacts({preview,plan,decisions}) {
    const widgets=new Map(),files=new Map();
    for(const row of [...(plan?.cardWidgetRisks||[]),...(plan?.scriptRisk||[])]){
      const file=row.path?String(row.path).replace(/^bundles\//,''):null;
      // Program files outside a 模组 are listed under their pack.
      if(!row.widgetName){if(file)files.set(row.packId,[...new Set([...(files.get(row.packId)||[]),file])]);continue;}
      const key=row.packId+'\n'+(row.widgetId||row.widgetName);
      if(!widgets.has(key))widgets.set(key,{name:row.widgetName,pack:row.packName||'',files:[],reads:[],writes:[]});
      const group=widgets.get(key);
      if(row.variables){group.reads.push(...(row.variables.reads||[]));group.writes.push(...(row.variables.writes||[]));}
      if(file&&!group.files.includes(file))group.files.push(file);}
    const line=(label,source,path,extra)=>h('span',{className:'ap-cat-risk-line'},label+' '+(RISK_SOURCES[source]||source)+' ',h('code',null,path),extra?'（'+extra+'）':null);
    // the facts show directly in the sheet (no 「详情」 disclosure), so a 模组 lists its pack
    // and the values it reads / changes, not its own program files (always its entry page and script).
    if(!(preview.packs||[]).length&&!widgets.size)return null;
    return h(CatFacts,null,
      (preview.packs||[]).map(row=>h(CatFact,{key:row.packId,label:row.incoming?.manifest?.name||'素材包'},
        h('span',{className:'ap-cat-risk-facts'},h('span',null,[catContents(row.incoming?.manifest),cardPackAction(row,decisions[row.packId])].filter(Boolean).join(' · ')),
          (files.get(row.packId)||[]).map(file=>h(CatUrl,{key:file,url:file}))))),
      [...widgets.values()].map((group,index)=>h(CatFact,{key:index,label:group.name},
        h('span',{className:'ap-cat-risk-facts'},group.pack&&h('span',{className:'ap-cat-risk-from'},'来自素材包「'+group.pack+'」'),
          group.reads.map((read,i)=>h(React.Fragment,{key:'r'+i},line('读取',read.source,read.path))),
          group.writes.map((write,i)=>h(React.Fragment,{key:'w'+i},line('改动',write.source,write.path,(write.ops||[]).map(op=>RISK_OPS[op]||op).join('、'))))))));
  }
  // file: the picked File (name + arrayBuffer). path: the card it imports into. onPick: choose another file (the caller's
  // hidden file input). onDone(result) after the import (also when the sheet is closed after the card was committed).
  function CardImportSheet({binding,path,file,url,cardName,onPick,onClose:close,onDone}) {
    const service=binding.service,[read,setRead]=React.useState({phase:'reading'}),[sent,setSent]=React.useState(null),[decisions,setDecisions]=React.useState({}),[attempt,setAttempt]=React.useState(0);
    const [busy,setBusy]=React.useState(null),[problem,setProblem]=React.useState(null),[committed,setCommitted]=React.useState(false);
    const live=React.useRef(null),publication=React.useRef(null),mounted=React.useRef(true),late=useLater();
    const cancel=id=>{if(id)Promise.resolve().then(()=>service.applyCardBundle({inspectionId:id,cancel:true})).catch(()=>{});};
    React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
    // Read: inspect the ZIP, then ask the host which 模组 the imported card would use (installed packs included).
    React.useEffect(()=>{
      let active=true;setRead({phase:'reading'});setProblem(null);setSent(null);
      // the picked file goes up as it is (no copy in memory first) and the reading
      // line counts the MB sent (「正在读取… 12 / 205 MB」) until the host has it all and inspects it.
      const onProgress=value=>{if(active)setSent(value.loaded<value.total?value:null);};
      (async()=>{
        try{
          const preview=url ? await service.inspectCardBundleUrl({path,url}) : await service.inspectCardBundle({path,bytes:file,onProgress});
          if(!active)return cancel(preview.inspectionId);
          live.current=preview.inspectionId;
          const chosen=Object.fromEntries((preview.packs||[]).map(row=>[row.packId,cardPackDefault(row.choices||[])]));
          const plan=await service.previewCardBundleDecisions({inspectionId:preview.inspectionId,decisions:chosen});
          if(!active)return;
          setDecisions(chosen);setRead({phase:'ready',preview,plan});
        }catch(error){if(active)setRead({phase:'error',failure:cardImportFailure(error,'read',url)});}
      })();
      return()=>{active=false;const id=live.current;live.current=null;if(!publication.current)cancel(id);};
    },[binding,file,url,attempt]);
    const ready=read.phase==='ready',preview=read.preview,plan=read.plan;
    const widgetsUsed=ready&&(plan.cardWidgetRisks||[]).length>0;
    const widgets=widgetsUsed&&cardWidgetsOn(preview.raw)?[...new Set(plan.cardWidgetRisks.map(w=>w.widgetName).filter(Boolean))]:[];
    const asksWidgets=widgets.length>0&&!committed;
    // The safe answer has the focus (owner): 不启用.
    React.useEffect(()=>{if(asksWidgets&&typeof document!=='undefined')document.querySelector?.('.ap-card-import-sheet [data-autofocus]')?.focus?.({preventScroll:true});},[asksWidgets]);
    async function commit(disableWidgets){
      if(busy!==null||!ready)return;
      setBusy(disableWidgets===true?'off':disableWidgets===false?'on':'import');setProblem(null);
      try{
        if(!publication.current){
          const acceptScriptRisk=(plan.scriptRisk||[]).length>0||(preview.packs||[]).some(row=>decisions[row.packId]!=='noop'&&(row.scriptRisk||[]).length>0);
          // A card that uses 模组 needs the switch decision; one that arrives with them off stays off.
          const saved=await service.applyCardBundle({inspectionId:preview.inspectionId,expectedRevision:preview.expectedRevision,decisions,acceptScriptRisk,...(widgetsUsed?{disableWidgets:disableWidgets!==false}:{})});
          publication.current={saved,packs:(preview.packs||[]).filter(row=>decisions[row.packId]!=='noop').map(row=>saved?.mappings?.find(m=>m.from===row.packId)?.packId||row.packId)};
          live.current=null;if(mounted.current)setCommitted(true);
        }
        const done=publication.current;
        try{while(done.packs.length){const pack=await service.getPackSnapshot({packId:done.packs[0]});await fillImportedFigureColors(binding,pack);done.packs.shift();}}
        catch(_){throw Object.assign(new Error('colour'),{colour:true});}
        if(mounted.current)onDone(done.saved);
      }catch(error){
        if(!mounted.current)return;
        const failure=cardImportFailure(error,'import');
        if(failure.again&&!publication.current)setRead({phase:'error',failure});else setProblem(failure.text);
      }finally{if(mounted.current)setBusy(null);}
    }
    function onClose(){if(busy!==null)return;if(publication.current)return onDone(publication.current.saved);const id=live.current;live.current=null;cancel(id);close();}
    const label=(key,text)=>catBusyLabel(busy===key,busy===key?'正在导入…':text);
    // The name before the card is read: the file's, or the last part of the address.
    const sourceName=file?.name||(url?catFileLabel(url):'');
    let body,foot;
    if(read.phase==='reading'){
      body=h('div',{className:'ap-cat-hero'},h(CardCover,{name:fileStem(sourceName)}),h('div',{className:'ap-cat-hero-text'},h('h3',{className:'ap-cat-hero-name'},fileStem(sourceName)),
        h('p',{className:'ap-cat-hero-sub ap-card-import-status',role:'status'},late&&h(React.Fragment,null,h(Spinner,{delay:0}),'正在读取…',
          sent&&h('span',{className:'ap-card-import-progress'},cardUploadMb(sent.loaded,sent.total)+' / '+cardUploadMb(sent.total,sent.total)+' MB')))));
      foot=h(Button,{onClick:onClose},'取消');
    } else if(read.phase==='error'){
      const failure=read.failure;
      body=h(React.Fragment,null,h('div',{className:'ap-cat-hero'},h(CardCover,{name:fileStem(sourceName)}),h('div',{className:'ap-cat-hero-text'},h('h3',{className:'ap-cat-hero-name'},fileStem(sourceName)))),
        h(CatBand,{role:'alert'},failure.text));
      foot=h(React.Fragment,null,h(Button,{onClick:onClose},'关闭'),
        failure.file&&onPick?h(Button,{primary:true,onClick:onPick},url?'换一个网址':'换一个文件'):h(Button,{primary:true,onClick:()=>setAttempt(n=>n+1)},'重试'));
    } else {
      const packs=preview.packs||[],name=cardRawName(preview.raw)||fileStem(sourceName),current=cardRawName(preview.currentRaw)||cardName||'';
      const other=!!preview.currentRaw&&!!current&&current!==name,asks=packs.filter(cardPackAsks);
      const contents=catContents({assets:packs.flatMap(row=>row.incoming?.manifest?.assets||[]),figures:packs.flatMap(row=>row.incoming?.manifest?.figures||[])});
      body=h(React.Fragment,null,
        h('div',{className:'ap-cat-hero'},h(CardCover,{name,path:other?null:path}),h('div',{className:'ap-cat-hero-text'},h('h3',{className:'ap-cat-hero-name'},name),contents&&h(CatSub,null,contents))),
        other?h(CatBand,null,'会用「'+name+'」替换「'+current+'」现在的内容。'):preview.currentRaw&&h('p',{className:'ap-cat-lead'},'会替换这张卡现在的内容。'),
        asks.length>0&&h('div',{className:'ap-card-packs'},asks.map(row=>h(CardPackChoice,{key:row.packId,row,decision:decisions[row.packId],disabled:busy!==null||committed,onChange:value=>setDecisions(d=>({...d,[row.packId]:value}))}))),
        problem&&h(CatBand,{role:'alert'},problem),
        h('div',{className:'ap-card-import-facts'},h(CardImportFacts,{preview,plan,decisions})));
      foot=committed?h(React.Fragment,null,h(Button,{disabled:busy!==null,onClick:onClose},'关闭'),h(Button,{primary:true,disabled:busy!==null,onClick:()=>commit()},label('import','重试'))):
        asksWidgets?h(React.Fragment,null,
          h('p',{className:'ap-card-import-ask'},h(Glyph,{name:'warning'}),h('span',null,'含模组'+widgets.map(w=>'「'+w+'」').join('')+'。'+CAT_TEXT.widgetRisk)),
          h(Button,{'data-autofocus':true,disabled:busy!==null,onClick:()=>commit(true)},label('off','不启用')),
          h(Button,{primary:true,disabled:busy!==null,onClick:()=>commit(false)},label('on','启用'))):
        h(React.Fragment,null,h(Button,{disabled:busy!==null,onClick:onClose},'取消'),h(Button,{primary:true,disabled:busy!==null,onClick:()=>commit()},label('import','导入')));
    }
    return h(CatSheet,{title:'导入卡片',className:'ap-card-import-sheet',onClose,busy:busy!==null,initialFocus:'dialog',foot},body);
  }
  // 「从网址导入卡」 — one address field and 「读取」 (Enter reads too). An address
  // that cannot be read says why here; the download and its failures happen in 导入卡片 (CardImportSheet), whose
  // 「换一个网址」 comes back here with the address kept. A #fragment is dropped (it never reaches the server).
  function cardUrlParse(text) {
    const value=String(text||'').trim();
    if(!value)return {problem:'请粘贴卡片的下载地址'};
    let url=null;try{url=new URL(value);}catch(_){}
    if(!url||!['http:','https:'].includes(url.protocol))return {problem:'这不是网址，请粘贴以 https:// 开头的下载地址'};
    if(url.protocol==='http:')return {problem:'只支持 https:// 开头的地址'};
    if(url.username||url.password)return {problem:'地址里不能带账号或密码'};
    url.hash='';return {url:url.href};
  }
  // autoRead (「导入示例卡」): read the initial address on open, as if 读取 had been pressed.
  function CardUrlSheet({initial='',busy,autoRead=false,onClose,onRead}) {
    const field=React.useRef(null),mounted=React.useRef(true),[problem,setProblem]=React.useState(''),[reading,setReading]=React.useState(false);
    React.useEffect(()=>{mounted.current=true;const node=field.current;node?.focus?.({preventScroll:true});node?.select?.();if(autoRead)read();return()=>{mounted.current=false;};},[]);
    async function read(){
      if(reading||busy)return;
      const parsed=cardUrlParse(field.current?.value);
      if(parsed.problem){setProblem(parsed.problem);field.current?.focus?.();return;}
      setProblem('');setReading(true);
      try{await onRead(parsed.url);}catch(error){if(mounted.current)setProblem(String(error?.message||error)||'没能开始读取，请重试。');}
      finally{if(mounted.current)setReading(false);}
    }
    const waiting=reading||!!busy;
    return h(CatSheet,{title:'从网址导入卡',className:'ap-card-url-sheet',onClose,busy:waiting,
        foot:h(React.Fragment,null,h(Button,{disabled:waiting,onClick:onClose},'取消'),h(Button,{primary:true,disabled:waiting,onClick:read},catBusyLabel(waiting,waiting?'正在准备…':'读取')))},
      h('div',{className:'ap-card-url',onKeyDown:event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();read();}}},
        h(InlineField,{kind:'text',label:'网址',controlLabel:'卡片下载地址',value:initial,placeholder:'https://…/card.zip',wide:true,controlRef:field,disabled:waiting,
          help:h(Help,{label:'网址 说明',text:'卡片 ZIP 的直接下载地址（如 GitHub Release 附件），只支持 https://。'}),
          onCommit:()=>setProblem('')}),
        problem&&h('p',{role:'alert',className:'ap-cat-problem'},problem)));
  }
  // the delete confirmation's one consequence, in plain words and without a card count (owner dislikes
  // counts). The dependency index only decides between 「有卡在用」 and 「没有卡在用」; unknown says the general rule.
  function Impact({binding,packId}) {
    const state=useLoad(binding,()=>binding.rpc('getAssetPackDependencies',{packId}),[packId]);
    const lose='删除后，用到它的卡会少掉里面的素材，不会自动换成别的。',used=state.value?.available?state.value.count>0:null;
    return h('p',{className:'ap-impact',role:'status'},binding.globalEnabledPackIds?.includes(packId)?'它现在对所有卡启用。'+lose:used===false?'现在没有卡在用它。':used?'有卡正在用它。'+lose:lose);
  }
  // panel language — hairlines instead of boxes. Neither 素材库 nor 舞台设置 has a
  // basic/advanced split (option A).
  function Section({title,meta,action,children}) { return h('section',{className:'ap-section'},h('header',{className:'ap-section-head'},h('h3',null,title,meta!==undefined&&h('span',{className:'ap-section-meta'},meta)),action),children); }
  function Loading(props) { return h(PanelLoading,props); }
  const kindCount=(manifest,kind)=>kind==='figures'?(manifest?.figures||[]).length:(manifest?.assets||[]).filter(a=>a.kind===kind).length;
  const totalCount=manifest=>(manifest?.assets||[]).length+(manifest?.figures||[]).length;
  // a list row (summary) carries its counts; a full snapshot counts its manifest.
  // list views read listPackSummaries (name, revision, counts, size, a few picture
  // refs; the full list was 19 MB). A row gets the {id,name} manifest stub the shared rows read; a broken pack stays
  // {packId,error}; a full snapshot passes through unchanged. A pack's full document is read per pack (loadPackDetail):
  // the transport keeps it by revision, so reopening asks only for packs that changed.
  const packSummaryRow=entry=>!entry||entry.error||entry.manifest?entry:{...entry,summary:true,manifest:{id:entry.packId,name:entry.name,...(entry.description?{description:entry.description}:{})}};
  const loadPackRows=async binding=>(await binding.service.listPackSummaries()).map(packSummaryRow);
  const loadPackDetail=(binding,row)=>{const packId=row?.manifest?.id||row?.packId;return binding.service.packDetail?binding.service.packDetail({packId,revision:row?.revision}):binding.service.getPackSnapshot({packId});};
  // The full documents of the packs (list rows or full snapshots) that hold entries of `kinds`: a summary row is read in full
  // (loadPackDetail, one read per pack, kept by revision in the transport) only when its counts show one of the kinds; a full
  // snapshot passes through. null while a read is still under way. Shared by the widget picture picker and the timer's
  // 时间到演出 menu — a list summary has no `manifest.assets`, so no form reads entries off a row.
  function useFullPacksOfKinds(binding,packs,kinds) {
    const need=kinds.length?packs.filter(p=>!p?.error&&p?.manifest&&(!p.summary||kinds.some(kind=>p.counts?.[kind]>0))):[],partial=need.some(p=>p.summary);
    const key=need.map(p=>p.manifest.id+'@'+p.revision).join(','),[full,setFull]=React.useState(null);
    React.useEffect(()=>{let live=true;if(!partial){setFull(null);return;}
      Promise.all(need.map(p=>p.summary?loadPackDetail(binding,p).catch(()=>null):p)).then(list=>{if(live)setFull(list.filter(Boolean));});
      return()=>{live=false;};},[key]);
    return partial?full:need;
  }
  const packCount=(pack,kind)=>pack?.counts?(kind?pack.counts[kind]||0:Object.values(pack.counts).reduce((sum,n)=>sum+n,0)):kind?kindCount(pack?.manifest,kind):totalCount(pack?.manifest);
  const kindCounts=manifest=>KIND_ORDER.map(key=>({key,label:kinds[key],count:kindCount(manifest,key)})).filter(c=>c.count);
  // The library's entry search (name, note, tag, text, a figure's aliases, an entry's trigger words); 设置向导 › 挑选素材 reuses it.
  const entryMatches=(a,kind,needle)=>!needle||[a.name,a.directorNote,...(a.kind==='sfx'?[audioCategories[a.category]]:assetTags.paths(a.category)),a.text,...(kind==='figures'?[]:a.recall?.keywords||[]),...(a.aliases||[])].some(v=>String(v||'').toLowerCase().includes(needle));
  const packItems=(pack,kind)=>kind==='figures'?(pack.manifest.figures||[]).map(id=>pack.figures?.[id]).filter(Boolean):pack.manifest.assets.filter(a=>a.kind===kind);
  const figureAvatar=(figure,sprites)=>selectFigureAvatar(figure,sprites);
  // First outfit with a sprite: its default state's standing image (layered `stage.src` or static `src`), resolved to a pack hash.
  const figureStanding=(figure,sprites)=>{for(const outfit of figure?.outfits||[]){const manifest=outfit.sprite&&sprites?.[outfit.sprite.manifestKey],state=emotionState(outfit,manifest,outfit.defaultEmotion || figure.emotions?.[0]?.id || 'calm'),path=state?.stage?.src||state?.src,hash=path&&outfit.sprite.assets?.[path];if(hash)return hash;}return null;};
  const packCover=pack=>{const background=pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.enabled&&entryContent(a).media);return background?{hash:entryContent(background).media}:Object.values(pack.figures||{}).map(figure=>figureAvatar(figure,pack.sprites)).find(Boolean);};
  // Leases media only once the thumbnail scrolls near view; a pack can hold hundreds of backgrounds.
  // A revoked lease (pack written meanwhile) gets one fresh lease before the tile reports failure.
  // No placeholder → image flash: while an image is on its way the box stays empty at its reserved size (no letter);
  // the picture fades in once decoded, and one already leased/decoded (shared lease, browser cache) paints at once.
  // Missing/failed media stays neutral; pending leases and image loads show the shared Spinner (only after 150ms;
  // keyed by the artwork, so new artwork restarts the delay; first child, so the image arriving never moves it).
  // the host keeps three longest-side tiers (THUMBNAIL_SIZES); a view
  // asks for the smallest that covers its box in device pixels (box × devicePixelRatio, ÷ the crop share for a face cut
  // from the picture). Past the largest tier the original is leased (null).
  function thumbUrl({packId,hash,size=256}) { return '/api/dsh-asset-library/v2/thumbnail?v=2&packId='+encodeURIComponent(packId)+'&hash='+encodeURIComponent(hash)+(size===256?'':'&size='+size); }
  const THUMB_SIZES=[256,512,1024],screenDpr=()=>globalThis.devicePixelRatio||1;
  const thumbTier=px=>THUMB_SIZES.find(size=>size>=px)||null;
  async function thumbManifest(packId) {
    const response=await fetch('/api/dsh-asset-library/v2/thumbnails?packId='+encodeURIComponent(packId));
    if(!response.ok)throw new Error('Thumbnail manifest unavailable');
    return new Set((await response.json()).hashes);
  }
  // The host warms installed packs even when no asset browser is mounted.
  function thumbWarmup(binding,pack) { return ()=>{}; }
  function Thumb({binding,packId,hash,crop,label,className='ap-thumb',style}) {
    const key=packId+'\n'+hash,cached=peekMedia(binding,packId,hash);
    const [visible,setVisible]=React.useState(typeof IntersectionObserver==='undefined'||!!cached),[lease,setLease]=React.useState(null),[failed,setFailed]=React.useState(false),[attempt,setAttempt]=React.useState(0);
    // The tier is picked once the box is laid out (an unmeasurable box gets the smallest); a crop shows only its share.
    const [need,setNeed]=React.useState(null),tier=need===null?0:thumbTier(need);
    const url=visible&&hash&&attempt===0&&tier?thumbUrl({packId,hash,size:tier}):lease?.key===key?lease.url:cached,reveal=useReveal(),ref=reveal.ref;
    React.useEffect(()=>{if(visible||!ref.current)return;const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);io.disconnect();}},{rootMargin:'240px'});io.observe(ref.current);return()=>io.disconnect();},[visible]);
    (React.useLayoutEffect||React.useEffect)(()=>{const el=ref.current;if(!visible||need!==null)return;
      const share=crop?.w>0&&crop?.h>0?Math.min(1,crop.w,crop.h):1;setNeed(Math.max(el?.offsetWidth||0,el?.offsetHeight||0)*screenDpr()/share);},[visible]);
    React.useEffect(()=>{if(!visible||!hash||!binding.previewMedia||need===null||attempt===0&&tier)return;let active=true,release=null;holdMedia(binding,packId,hash).then(media=>{if(!active)media.release();else{release=media.release;setLease({key,url:media.url});}}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;release?.();setFailed(false);};},[visible,binding,packId,hash,attempt,need===null,tier]);
    const loading=visible&&!!hash&&!!binding.previewMedia&&!failed&&(!url||reveal.phase==='loading');
    const onError=()=>{if(attempt>0||!tier)dropMedia(binding,packId,hash);setLease(null);if(attempt<2)setAttempt(attempt+1);else setFailed(true);};
    return h('span',{ref,className,style,'data-empty':url?undefined:true,'data-failed':failed||undefined,'data-ap-media':url?reveal.phase:undefined,onLoad:reveal.onLoad,title:failed?'图片载入失败':undefined},loading?h(Spinner,{key,fill:true}):null,url?(crop&&AvatarImage?h(AvatarImage,{key:url,identity:packId+':'+hash,src:url,crop,alt:'',decoding:'async',onError,style:{width:'100%',height:'100%'}}):h('img',{src:url,alt:'',decoding:'async',onError})):null);
  }
  // Reveal phase of an element's image: 'loading' (kept hidden, its box reserved) → 'in' (fades in once, on decode) or
  // 'shown' (already decoded when mounted: no animation). A later src change keeps showing the previous picture until
  // the new one has loaded (HTML pending-request semantics), so it never blanks. ref goes on the img or its wrapper.
  function useReveal(){
    const ref=React.useRef(null),[phase,setPhase]=React.useState('loading');
    (React.useLayoutEffect||React.useEffect)(()=>{const el=ref.current;if(!el)return;const img=el.tagName==='IMG'?el:el.querySelector?.('img');
      if(!img){if(phase!=='loading')setPhase('loading');return;}
      if(phase==='loading'&&img.complete&&img.naturalWidth>0)setPhase('shown');});
    const onLoad=()=>setPhase(p=>p==='loading'?'in':p);
    return {ref,phase,onLoad};
  }
  function RevealImg({onLoad,...props}) {
    const reveal=useReveal();
    return h('img',{...props,ref:reveal.ref,'data-ap-media':reveal.phase,onLoad:e=>{reveal.onLoad();onLoad?.(e);}});
  }
  // 查看大图 of a pack picture — the shared ImageViewer on the full picture,
  // leased while it shows. `src` instead: a picture not in the pack (a candidate, a
  // draft upload). `actions`: the corner icon buttons ({icon: glyph name, label, onClick, disabled, busy, pressed}).
  function PackImageView({binding,packId,hash,src,label,actions=[],onClose,onKeyDown}) {
    const full=useStillPicture(binding,packId,src?null:hash);
    return h(ImageViewer,{src:src||full.url||null,failed:!src&&(full.failed||src===undefined&&!hash),alt:label,onClose,onKeyDown,
      actions:actions.filter(Boolean).map(a=>({...a,icon:typeof a.icon==='string'?h(Glyph,{name:a.icon}):a.icon}))});
  }
  // line glyphs for the library's icon buttons (16px, currentColor stroke).
  const glyphs={bubble:'M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z',voice:'M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.2 3.8a6 6 0 0 1 0 8.4',voiceOff:'M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 6l3 4M13.5 6l-3 4',language:'M2.5 4h6M5.5 2.5V4M7.5 4c-.6 2.6-2.4 4.6-4.8 5.6M4.3 6c.7 1.5 1.9 2.8 3.4 3.6M8.5 13.5l2.5-6 2.5 6M9.3 11.7h3.4',stage:'M2 2.5h12M3 2.5v11M13 2.5v11M3 2.5c0 3.5 2 5 4 5.5M13 2.5c0 3.5-2 5-4 5.5M2 13.5h12',globe:'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM2.5 8h11M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5S9.6 11.9 8 13.5M8 2.5C6.4 4.1 5.7 6 5.7 8s.7 3.9 2.3 5.5',offstage:'M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3 13 13 3',outfit:'M5.5 2.5 8 4l2.5-1.5 3 2-1.5 2.5-1-.5v7h-6v-7l-1 .5L2.5 4.5z',back:'M10 3.5 5.5 8l4.5 4.5',export:'M8 2.5v7.5M5 7l3 3 3-3M3 11.5v2h10v-2',
    // 导出 in the 素材库 — an arrow up out of an open box (never the ⤓ of 获取素材包).
    share:'M8 9.5V2.5M5.5 5 8 2.5 10.5 5M6 7H4.5a1 1 0 0 0-1 1v4.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H10',copy:'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',remove:'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M7 7v4M9 7v4',card:'M4.5 2.5h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5.8 11.2c.4-1 1.2-1.6 2.2-1.6s1.8.6 2.2 1.6',
    // Character modal tools (panel-ui-design.md §六之二).
    plus:'M8 3v10M3 8h10',upload:'M8 10.5V3M5 6l3-3 3 3M3 10.5v2.5h10v-2.5',crop:'M4.5 1.5v10h10M1.5 4.5h10v10',ruler:'M2 10.5 10.5 2l3.5 3.5L5.5 14zM5.2 8.3l1.3 1.3M7.2 6.3l1.9 1.9M9.2 4.3l1.3 1.3',
    // 查看大图 and 调整后重试… in the 差分 tile menus and the 生图 records.
    eye:'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',sliders:'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3',
    openExternal:'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3',edit:'M10.6 2.9a1.4 1.4 0 0 1 2 2L5.5 12 2.8 12.7l.7-2.7zM9.4 4.1l2 2',reset:INLINE_GLYPHS.reset,warning:'M8 2.5 14 13H2zM8 6.5v3M8 11.4v.1',
    // Character modal v2 (panel-ui-design.md §六之三): row icons and the figure tool group.
    swap:'M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13',avatarUpload:'M6.5 7a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5zM2.5 13.5c.5-2.4 2-3.8 4-3.8.9 0 1.7.3 2.4.8M12.5 14V9.5M10.5 11.5l2-2 2 2',
    play:'M5.5 3.5v9l7-4.5z',mic:'M8 2.5a2 2 0 0 1 2 2V8a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2zM4.5 7.5a3.5 3.5 0 0 0 7 0M8 11v2.5M6 13.5h4',
    palette:'M8 2.5a5.5 5.5 0 1 0 0 11c.9 0 1.3-.7 1-1.4-.3-.8.2-1.6 1.1-1.6H12a1.5 1.5 0 0 0 1.5-1.5A5.5 5.5 0 0 0 8 2.5zM5.2 7.6h.01M6.8 5h.01M9.8 5.2h.01',
    note:'M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12M6 8h4M6 10.5h2.5',hash:'M6.5 2.5 5 13.5M11 2.5 9.5 13.5M3 6h10.5M2.5 10H13',
    // packs-v3: pack state (关闭 / 本卡使用 / 全局启用), menus and the pack modal tools.
    stateOff:'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z',stateCard:'M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM5.6 8.1l1.7 1.7 3.1-3.5',
    check:'M3.5 8.5l3 3 6-7',chevDown:'M5 6.5 8 9.5l3-3',chevRight:'M6 4l4 4-4 4',filter:'M2.5 4h11M4.5 8h7M6.5 12h3',close:'M4 4l8 8M12 4l-8 8',
    more:'M3.5 8h.01M8 8h.01M12.5 8h.01',select:'M2.5 4.6l1.3 1.3 2.2-2.4M2.5 10.6l1.3 1.3 2.2-2.4M8.5 5h5M8.5 11h5',search:'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.3 10.3 13.5 13.5',stop:'M5 5h6v6H5z',
    // the library sort icon; the image framer's zoom out.
    sort:'M4.5 2.5v11M2.5 11.5l2 2 2-2M8.5 4h5M8.5 8h3.5M8.5 12h2',minus:'M3 8h10',
    // ↩ — a 差分 this outfit does not need falls back to its default picture.
    fallback:'M6 3.5 3 6.5l3 3M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7',
    // ★ — the default variant's mark on its chip.
    star:'M8 2.3l1.75 3.55 3.9.57-2.83 2.76.67 3.89L8 11.23l-3.49 1.84.67-3.89L2.35 6.42l3.9-.57z',
    // 复原 — the preview's reset view (four corners).
    fit:'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
    // 智能判断 — a balance.
    judge:'M8 2.5v11M5.5 13.5h5M3.5 4.5h9M3.5 4.5 2 8.5a1.5 1.5 0 0 0 3 0zM12.5 4.5 11 8.5a1.5 1.5 0 0 0 3 0z',
    // ✦ — generation's mark inside the dashed add tile.
    spark:'M7 2.5c.5 2.7 1.3 3.5 4 4-2.7.5-3.5 1.3-4 4-.5-2.7-1.3-3.5-4-4 2.7-.5 3.5-1.3 4-4zM12.2 9.8c.2 1.1.6 1.5 1.7 1.7-1.1.2-1.5.6-1.7 1.7-.2-1.1-.6-1.5-1.7-1.7 1.1-.2 1.5-.6 1.7-1.7z',
    // the 舞台设置 › 模组 row icons of 物品 / 手机 / 文字演出 (MOD_GLYPHS).
    item:'M3.5 5.5h9l-.8 8h-7.4zM6 5.5v-1a2 2 0 0 1 4 0v1',phone:'M5 2h6a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM7 11.5h2',textcard:'M2.5 3.5h11v9h-11zM5.5 6h5M8 6v4'};
  function Glyph({name}) { return h('svg',{className:'ap-glyph',width:16,height:16,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},h('path',{d:glyphs[name]||kindGlyphs[name],stroke:'currentColor',strokeWidth:1.3,strokeLinecap:'round',strokeLinejoin:'round'})); }
  function IconButton({icon,label,danger,...props}) { return h(Button,{className:'ap-icon-button'+(danger?' is-danger':''),'aria-label':label,title:label,...props},h(Glyph,{name:icon})); }
  // the one multi-select mode. useSelection holds the checked
  // ids (null when the mode is off); SelectBar is the heading's action area while it is on — 「已选 N」 (role=status) ·
  // 取消 · the action (`danger`: the confirm dialog's red; disabled at N = 0). The tiles / rows draw the house check
  // (.ap-check-mark, role=checkbox) and hide their other controls; the caller confirms (ConfirmDialog), Esc cancels.
  function useSelection() {
    const [ids,setIds]=React.useState(null);
    return {on:!!ids,ids,has:id=>!!ids?.has(id),start:()=>setIds(new Set()),stop:()=>setIds(null),
      flip:id=>setIds(current=>{if(!current)return current;const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;})};
  }
  function SelectBar({count,action,danger=false,busy=false,onAction,onCancel}) {
    return h(React.Fragment,null,
      h('span',{className:'ap-select-count ap-lib-picked',role:'status'},'已选 ',h('b',null,count)),
      h(Button,{className:'ap-manage ap-pick-cancel',disabled:busy,onClick:onCancel},'取消'),
      h(Button,{className:'ap-manage ap-pick-action'+(danger?' ap-danger-text':' is-done'),disabled:busy||!count,onClick:onAction},action));
  }
  // the one 「back to parent」 header of every settings sub-page — 引擎设置,
  // a figure's 声音, an entry opened on a phone, a pack opened from a 基础设置 「›」. One row: a quiet ‹ icon button (its
  // accessible name and tooltip 「返回<parent>」) right before the page title, the 「?」 after the title, `tools` at the far
  // end. No breadcrumb line above the title. Esc on the page goes back as well (subpageKeys) unless something inside the
  // page handled it first (an open menu, a text edit being cancelled). Styles: .ap-subhead in theme.css.
  function SubpageBack({parent,onBack,disabled}) { const label='返回'+parent; return h('button',{type:'button',className:'ap-icon-button ap-subhead-back','aria-label':label,title:label,disabled,onClick:onBack},h(Glyph,{name:'back'})); }
  function SubpageHead({parent,title,onBack,level=2,titleRef,help,tools,className}) {
    return h('header',{className:'ap-subhead'+(className?' '+className:'')},h(SubpageBack,{parent,onBack}),
      h('h'+level,{className:'ap-subhead-title',ref:titleRef,tabIndex:titleRef?-1:undefined},h('span',{className:'ap-subhead-text'},title),help||null),
      tools?h('span',{className:'ap-subhead-tools'},tools):null);
  }
  // Esc inside a portalled popover (a settings editor, a picker) bubbles here through React;
  // it closes that popover only, never the page.
  const subpageKeys=onBack=>e=>{if(e.key!=='Escape'||e.defaultPrevented||!e.currentTarget.contains(e.target))return;e.preventDefault();e.stopPropagation();onBack();};
  // inspect the next selected volume only after the preceding preview has been consumed.
  function PackFileQueue({binding,queue,onDone}) {
    const [index,setIndex]=React.useState(0),[preview,setPreview]=React.useState(queue.current),work=useTask(binding);
    async function next() {
      setPreview(null);
      if(index+1===queue.files.length)return onDone();
      const at=index+1;setIndex(at);
      const result=await work.task(async()=>binding.service.inspectImport({bytes:new Uint8Array(await queue.files[at].arrayBuffer())}));
      if(result)setPreview(result);
    }
    if(preview)return preview.kind==='pack-set'?h(PackSetInstall,{key:index,binding,set:preview,onClose:next,onDone:next}):h(ConflictDialog,{key:index,binding,preview,onClose:next,onDone:next});
    return h(Modal,{title:'导入 '+queue.files[index].name,busy:work.busy,onClose:onDone},
      work.busy?h(Loading,{shape:'fields',count:3}):h(React.Fragment,null,h(ErrorBox,{error:work.error}),h(Actions,null,h(Button,{onClick:onDone},'结束导入'),h(Button,{onClick:next},'跳过此文件'))));
  }
  // Export / copy / delete shared by the list rows and the detail ⋯ menu; delete keeps its confirmation.
  function usePackActions(binding,{onChanged,onRemoved}={}) {
    const work=useTask(binding),[preview,setPreview]=React.useState(null),[remove,setRemove]=React.useState(null),[pendingExport,setPendingExport]=React.useState(null);
    const exportPack=pack=>work.task(async()=>{const result=await binding.service.exportPack({packId:pack.manifest.id,expectedRevision:pack.revision});if(result.warnings?.length)setPendingExport(result);else return binding.download(result);});
    // the 素材库's batch export — one download: a single pack is its own ZIP, two
    // or more one 素材包合集 ZIP (exportPacks) that 「获取素材包」 installs pack by pack. Same external-dependency warning.
    // Resolves true once the export is done (or waits on that warning), undefined on failure.
    const exportPacks=list=>work.task(async()=>{
      const result=list.length===1?await binding.service.exportPack({packId:list[0].manifest.id,expectedRevision:list[0].revision}):
        await binding.service.exportPacks({packs:list.map(pack=>({packId:pack.manifest.id,expectedRevision:pack.revision}))});
      if(result.warnings?.length)setPendingExport(result);else await binding.download(result);
      return true;
    });
    async function copyPack(pack){const result=await work.task(()=>binding.service.copyItems({sourcePackId:pack.manifest.id,itemRefs:[...pack.manifest.assets.map(a=>({kind:a.kind,id:a.id})),...pack.manifest.figures.map(id=>({kind:'figures',id}))],target:{newPackName:pack.manifest.name+' 副本'}}));if(result)onChanged?.();}
    async function confirmRemove(){const pack=remove,r=await work.task(()=>binding.service.removePack({packId:pack.manifest.id,expectedRevision:pack.revision}));if(r){setRemove(null);(onRemoved||onChanged)?.(pack);}}
    const dialogs=h(React.Fragment,null,
      pendingExport&&h(Modal,{title:'模组默认外观依赖其它素材包',className:'ap-export-warning',busy:work.busy,onClose:()=>setPendingExport(null)},
        h('p',{className:'ap-hint-line'},h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),h('span',null,'导出不自包含：以下外部图片只保留引用，不会暗中附带其它包'),h(Help,{text:'目标机器缺少或未使用这些素材时，模组显示默认外观。',label:'外部依赖 说明'})),
        h('ul',{className:'ap-dependency-list'},pendingExport.warnings.map((warning,index)=>h('li',{key:index,role:'status'},h(KindIcon,{kind:'widgets'}),h('span',{className:'ap-dependency-what'},h('strong',null,warning.widgetName),' · '+warning.settingLabel),
          h('span',{className:'ap-dependency-from','data-missing':!warning.packName||!warning.assetName||undefined},(!warning.packName||!warning.assetName)&&h(Glyph,{name:'warning'}),(warning.packName || '缺失的素材包')+' / '+(warning.assetName || '缺失的图片'))))),
        h(ErrorBox,{error:work.error}),h(Actions,null,h(Button,{disabled:work.busy,onClick:()=>setPendingExport(null)},'取消'),h(Button,{primary:true,disabled:work.busy,onClick:()=>work.task(async()=>{await binding.download(pendingExport);setPendingExport(null);})},'仍然导出'))),
      preview&&(preview.kind==='file-queue'?h(PackFileQueue,{binding,queue:preview,onDone:()=>{setPreview(null);onChanged?.();}}):preview.kind==='pack-set'?h(PackSetInstall,{binding,set:preview,onClose:changed=>{setPreview(null);if(changed)onChanged?.();},onDone:()=>{setPreview(null);onChanged?.();}}):
        h(ConflictDialog,{binding,preview,onClose:()=>setPreview(null),onDone:()=>{setPreview(null);onChanged?.();}})),
      remove&&h(Modal,{title:'删除「'+remove.manifest.name+'」？',onClose:()=>setRemove(null),busy:work.busy},h(Impact,{binding,packId:remove.manifest.id}),h(ErrorBox,{error:work.error}),
        h(Actions,null,h(Button,{onClick:()=>setRemove(null),disabled:work.busy},'取消'),h(Button,{primary:true,disabled:work.busy,onClick:confirmRemove},'确认删除'))));
    return {work,exportPack,exportPacks,copyPack,askRemove:setRemove,setPreview,dialogs};
  }
  // ---------- packs-v3: one pack row, one state control, one shared pack modal (proposal §9) ----------
  // State of a pack seen from a card, derived from the two stored fields only (no new field):
  //   全局启用 (blue)  id ∈ globalEnabledPackIds — one cross-card flag (a binding may sit underneath)
  //   本卡使用 (green) id ∈ card.boundPackIds, not global
  //   关闭 (grey)      neither
  // Without a card (素材库) the control offers 关闭 / 全局启用 only. Changes apply at once, with no confirmation and no undo
  // (关闭 too — 「直接关就行了」).
  // short, plain chips — green 本卡 / blue 全局; the meaning is the tooltip.
  const PACK_STATES={off:'关闭',card:'本卡',global:'全局'};
  // global (blue) is always shown before card (green), then 关闭.
  const PACK_STATE_ORDER=['global','card','off'];
  // Stable partition: the ids that are 全局 first, then the rest, each keeping its current order.
  const globalFirst=(ids,global)=>[...ids.filter(id=>global.includes(id)),...ids.filter(id=>!global.includes(id))];
  const STATE_TITLES={off:'关闭：不参与演出',card:'本卡：只在这张卡使用',global:'全局：所有卡都可使用'};
  // Re-render when the cross-card global flags change (this surface's write, or another surface via the change feed).
  function useGlobalPacks(binding) {
    const [,bump]=React.useState(0);
    React.useEffect(()=>binding?.onSettings?.(()=>bump(n=>n+1)),[binding]);
    return binding?.globalEnabledPackIds||[];
  }
  // the rows no longer show 「N 张卡」 (cross-card counts) — a row only shows this
  // card's view of the pack — so the client no longer reads getPackBindingCounts.
  // One controller per surface: state of each pack and its transitions (existing writes only).
  // card scope: ctx = the 舞台设置 page context (ext, writer); library scope: ctx = null.
  function usePackScope({binding,ctx,packs}) {
    useGlobalPacks(binding);
    const [pending,setPending]=React.useState({}),[error,setError]=React.useState(''),alive=React.useRef(true);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    const card=!!ctx,global=()=>binding.globalEnabledPackIds||[],bound=()=>card?ctx.ext.assetBindings.boundPackIds:[];
    const byId=id=>(packs||[]).find(p=>p?.manifest?.id===id);
    const stateOf=id=>global().includes(id)?'global':bound().includes(id)?'card':'off';
    const users=id=>card?stageFigureRows(ctx).filter(row=>row.ref.packId===id&&row.figure.enabled).map(row=>row.ref.packId+'/'+row.ref.figureId):[];
    // A deleted pack can only be switched off; otherwise every state is offered (two without a card).
    // menus list 全局 → 本卡 → 关闭, like every global / card choice.
    const options=id=>!byId(id)?PACK_STATE_ORDER.filter(s=>s==='off'||s===stateOf(id)):card?PACK_STATE_ORDER:PACK_STATE_ORDER.filter(s=>s!=='card');
    async function apply(id,plan){
      setPending(p=>({...p,[id]:true}));setError('');
      try{
        const writes=[];
        if(plan.bind===true)writes.push(ctx.writer.write(current=>({assetBindings:{...current.assetBindings,boundPackIds:[...current.assetBindings.boundPackIds.filter(x=>x!==id),id]}})));
        if(plan.bind===false)writes.push(ctx.writer.write(current=>unbindPatch(current,id)));
        if(plan.global!==undefined)writes.push(binding.setGlobalEnabled(id,plan.global));
        await Promise.all(writes);
      }catch(e){if(alive.current)setError(errorText(e));}
      finally{if(alive.current)setPending(p=>{const next={...p};delete next[id];return next;});}
    }
    function set(id,next){
      const from=stateOf(id);if(from===next)return;
      const wasGlobal=global().includes(id),wasBound=bound().includes(id),plan={};
      if(next==='global')plan.global=true;
      if(next==='card'){if(wasGlobal)plan.global=false;if(!wasBound)plan.bind=true;}
      if(next==='off'){if(wasGlobal)plan.global=false;if(card&&wasBound)plan.bind=false;}
      return apply(id,plan);
    }
    return {type:card?'card':'global',binding,ctx,options,stateOf,users,pending,set,error};
  }
  // the state only ever reads the current card's view — 全局 / 本卡 / 关闭. The r4
  // 「按卡使用」 (a pack some other card uses, seen without a card) is gone: without a card a pack that is not global is 关闭.
  const stateLabel=(scope,state)=>PACK_STATES[state];
  const userNames=(ctx,aliases)=>aliases.map(a=>stageFigure(ctx,a).figure?.name||a).join('、');
  // The state chip + styled menu (owner-approved).
  // one state control everywhere — 素材包 rows (舞台设置 included), 模组 rows and the
  // 模组库 pack rows. the one look is the small text-only tag — 「全局」
  // 「本卡」「关闭」, 24px, no lamp and no chevron (the larger lamp pill is gone); it still opens the same menu, whose
  // items keep their lamps (全局 blue dot, 本卡 green dot, 关闭 grey hollow dot).
  const StateLamp=({state})=>h('i',{className:'ap-state-lamp','data-state':state,'aria-hidden':true});
  function PackStateTag({scope,id,name}) {
    const state=scope.stateOf(id),busy=!!scope.pending[id],label=s=>stateLabel(scope,s);
    return h(Popover,{label:name+' 使用状态',className:'ap-state-anchor',stopClicks:true,trigger:({toggle,open})=>h('button',{type:'button',className:'ap-state-tag','data-state':state,'aria-haspopup':'menu','aria-expanded':open,'aria-busy':busy||undefined,'aria-label':name+'：'+label(state)+'，更改',title:STATE_TITLES[state],onClick:busy?undefined:toggle},
        busy&&h(Spinner,{key:'busy'}),h('span',null,label(state))),
      content:close=>scope.options(id).map(s=>h('button',{key:s,type:'button',role:'menuitemradio','aria-checked':state===s,className:'ap-state-opt','data-state':s,title:STATE_TITLES[s],
            'aria-label':label(s),onClick:()=>{close();scope.set(id,s);}},
          h('span',{className:'ap-state-dot'},h(StateLamp,{state:s})),h('span',{className:'ap-state-label'},label(s)),
          state===s&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
  }
  // One row everywhere. the title flexes and is followed directly by the
  // faces of the card's characters from this pack (1 whole, 2 with a hair gap, 3+ overlapping tighter the more there are,
  // at most PACK_FACES_MAX; only real pictures — a figure without one is named in the tooltip). 舞台设置's read-only rows
  // (`control: 'static'`) and the library / 管理 rows end with the same state tag (stage panel). (
  // v3.1 r2): no count cells any more (neither 「N 张卡」 nor the item count — 数量 is only a sort). The title only
  // ellipsizes when the row is really full.
  const PACK_FACES_MAX=5;
  // `badge` (library only) is the 「可更新」 chip of a pack installed from a catalogue.
  // `lead` (舞台设置's selection check) goes before the title, `tail`
  // (its size and 导出 icon) after the state tag.
  // `aside` (the 素材库's size and 导出 icon) sits right before the state tag.
  // `previews` (舞台设置) shows what the pack holds after the title
  // (PackPreviews: faces → pictures → kind icons) in place of the card's faces.
  // the whole row opens the pack (ui-design §19 「整行可点进入」) — the name,
  // the previews and the empty space up to the chip. The name stays the keyboard target (Enter / Space; its focus ring is drawn
  // around the row); the state chip keeps its menu (its Popover stops clicks), and the row's other controls (selection
  // check, 导出, 可更新) keep their own action.
  const packRowClick=open=>e=>{const target=e.target;
    if(!e.currentTarget.contains(target)||target.closest?.('button,a,input,label,[role=menu],[role=checkbox]'))return;open();};
  function PackRow({id,pack,scope,kind,onOpen,control,badge,lead,aside,tail,previews}) {
    // identify an uninstalled binding instead of hiding its identity behind a generic warning.
    // UI standard R2: never the raw id as a name — an unknown, uninstalled pack reads 「未知素材包」, its id only in the tooltip.
    const name=pack?.manifest.name||scope.ctx?.writer?.pack?.(id)?.manifest?.name||'未知素材包',users=previews?[]:scope.users(id),compact=control==='static';
    const faces=users.filter(a=>{const info=stageFigure(scope.ctx,a);return !!info.figure&&figureHasFace(info.pack,info.figure);}).slice(0,PACK_FACES_MAX);
    const open=()=>onOpen(id,kind||undefined);
    return h('li',{className:'ap-pack-row'+(pack?' is-openable':' is-missing')+(compact?' is-compact':''),'data-state':scope.stateOf(id),onClick:pack?packRowClick(open):undefined},
      lead||null,
      h('span',{className:'ap-pack-title'},
        pack?h('button',{type:'button',className:'ap-pack-name','aria-label':'打开 '+name,title:name,onClick:e=>{e?.stopPropagation?.();open();}},name):h('span',{className:'ap-pack-name is-missing',title:name==='未知素材包'?id:name},h(Glyph,{name:'warning'}),name),
        pack?.diagnostics?.length>0&&h('span',{className:'ap-hint-mark',role:'status',title:'有模组不可用；其它素材不受影响'},h(Glyph,{name:'warning'})),
        badge||null,
        previews&&pack&&h(PackPreviews,{binding:scope.ctx?.binding,pack,detail:scope.ctx?.writer?.pack?.(id)}),
        users.length>0&&h('span',{className:'ap-pack-users','data-count':faces.length,title:userNames(scope.ctx,users)},faces.map(a=>h(StageAvatar,{key:a,ctx:scope.ctx,alias:a,className:'ap-avatar is-mini'})),h('span',{className:'ap-pack-user-names'},userNames(scope.ctx,users)))),
      aside||null,
      pack?h(PackStateTag,{scope,id,name}):h(React.Fragment,null,
        h('span',{className:'ap-state-tag'},'未安装'),
        h(Button,{className:'ap-manage',disabled:!!scope.pending[id],'aria-label':'移除 '+name,onClick:()=>scope.set(id,'off')},'移除')),
      tail||null);
  }
  // Kind filter: 全部 + the kinds present in the listed packs. It filters the list and picks what 「按数量」 counts.
  // one compact menu button on the search row instead of a full line of
  // chips (used rarely). The button is the filter icon, plus the chosen kind's short name when it is not 全部.
  function PackKindFilter({packs,kind,setKind}) {
    const present=KIND_ORDER.filter(k=>k===kind||packs.some(p=>packCount(p,k)>0)),name=kind?kinds[kind]:'全部';
    return h(Popover,{label:'按种类筛选',className:'ap-kind-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-kind-menu','data-on':kind||undefined,'aria-haspopup':'menu','aria-expanded':open,'aria-label':'按种类筛选：'+name,title:'按种类筛选：'+name,onClick:toggle},
        h(Glyph,{name:'filter'}),kind&&h('span',null,KIND_TAB_LABELS[kind]||kinds[kind])),
      content:close=>['',...present].map(value=>h('button',{key:value||'all',type:'button',role:'menuitemradio','aria-checked':kind===value,className:'ap-menu-item ap-kind-option',onClick:()=>{close();if(kind!==value)setKind(value);}},
        value?h(KindIcon,{kind:value}):h(Glyph,{name:'filter'}),h('span',null,value?kinds[value]:'全部'),kind===value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
  }
  const packFilter=(byId,query,kind)=>id=>{const p=byId.get(id),q=query.trim().toLowerCase();return p?(!kind||packCount(p,kind)>0)&&(!q||p.manifest.name.toLowerCase().includes(q)):!kind&&!q;};
  // one flat list, no group heads. Whatever the sort, 全局 comes first,
  // then 本卡 (only with a card), then 关闭; the chosen sort orders each band. `rank` is frozen per load by the caller
  // so a row never jumps while its state changes. Sort: 名称 (default), 数量 (items of the selected kind), 时间 (latest commit).
  const PACK_SORTS=[['name','名称'],['count','数量'],['time','时间']],PACK_SORT_KEY='dsh-tavern:pack-sort';
  function usePackSort() {
    const read=()=>{try{const v=localStorage.getItem(PACK_SORT_KEY);return PACK_SORTS.some(([k])=>k===v)?v:'name';}catch(_){return 'name';}};
    const [sort,setSort]=React.useState(read);
    return [sort,value=>{try{localStorage.setItem(PACK_SORT_KEY,value);}catch(_){}setSort(value);}];
  }
  const packCollator=typeof Intl!=='undefined'?new Intl.Collator('zh-Hans-CN',{numeric:true}):null;
  function orderPacks(ids,{byId,rank,sort,kind}) {
    const name=id=>byId.get(id)?.manifest.name||'',count=id=>{const p=byId.get(id);return p?packCount(p,kind):-1;};
    const byName=(a,b)=>packCollator?packCollator.compare(name(a),name(b)):name(a).localeCompare(name(b));
    // commit time, newest first within each fixed state band; name breaks ties.
    return [...ids].sort((a,b)=>(rank(a)-rank(b))||(sort==='time'?byId.get(b).updatedAt-byId.get(a).updatedAt:sort==='count'?count(b)-count(a):0)||byName(a,b));
  }
  // `empty`: the caller's ListEmpty (it knows the search / kind filter and how to clear them).
  function PackList({ids,render,label='素材包',empty}) {
    if(!ids.length)return empty;
    return h('ul',{className:'ap-pack-list','aria-label':label},ids.map(render));
  }
  function SortMenu({sort,onSort}) {
    const current=PACK_SORTS.find(([k])=>k===sort)?.[1]||'名称';
    return h(Popover,{label:'排序',className:'ap-sort-anchor',trigger:({toggle,open})=>h(IconButton,{icon:'sort',label:'排序：'+current,'aria-expanded':open,'data-on':sort!=='name'||undefined,onClick:toggle}),
      content:close=>PACK_SORTS.map(([value,text])=>h('button',{key:value,type:'button',role:'menuitemradio','aria-checked':sort===value,className:'ap-menu-item',onClick:()=>{close();if(sort!==value)onSort(value);}},h('span',null,'按'+text),sort===value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
  }
  // The kind filter and the sort icon, placed on the search row (no line of their own).
  function KindSortTools({packs,kind,setKind,sort,onSort}) {
    return h(React.Fragment,null,h(PackKindFilter,{packs,kind,setKind}),h(SortMenu,{sort,onSort}));
  }
  function PackSearchBox({value,onChange,label,placeholder,className=''}) {
    return h(SearchBox,{className:('ap-search '+className).trim(),icon:h(Glyph,{name:'search'}),label,placeholder:placeholder||label,value,onChange});
  }
  // New pack: an inline row in edit state, right under the toolbar. Enter creates; Escape / ✕ cancels.
  function NewPackRow({onCreate,onCancel,busy}) {
    // InlineAdd, opened by the toolbar's ＋.
    const [name,setName]=React.useState('');
    const ok=()=>{if(name.trim()&&!busy)onCreate(name.trim());};
    return h(InlineAdd,{open:true,className:'ap-pack-row is-new',inputClassName:'ap-new-input',label:'新素材包名称',placeholder:'素材包名称',value:name,onChange:setName,busy,onConfirm:ok,onCancel},
      h(Button,{className:'ap-solid-pill',disabled:busy||!name.trim(),onClick:ok},'创建'),
      h(IconButton,{icon:'close',label:'取消新建',onClick:onCancel}));
  }
  // 素材库 tab: one toolbar (search · kind filter · sort · 获取素材包 · plus), one flat list, the shared modal.
  // the kind chips are a menu button beside search, so the list starts one
  // line higher. the ⤒ 导入素材包 (link / ZIP) and 📖 浏览素材目录 icons
  // are one ⤓ 「获取素材包」 dialog (PackGetSheet: link · ZIP · the catalogue list, one compact view); ＋ stays 新建素材包.
  // with a chat open the library reads that card's bindings (card scope: 本卡 / 全局 / 关闭,
  // the same writer as 舞台设置). no group heads; 全局 → 本卡 → 关闭 bands,
  // each ordered by the chosen sort, in every kind tab.
  function Home({binding,open,onOpen,sessionId,cardPath,cardStamp,filter}) {
    const state=useLoad(binding,async()=>{await binding.loadSettings?.();return loadPackRows(binding);},[]),[query,setQuery]=React.useState(''),[kind,setKind]=React.useState(''),[draft,setDraft]=React.useState(false),[sort,setSort]=usePackSort(),[getting,setGetting]=React.useState(false),[picking,setPicking]=React.useState(null);
    React.useEffect(()=>{if(filter)setKind(filter.kind||'');},[filter]);
    const list=state.value||[],packs=list.filter(p=>!p.error),broken=list.filter(p=>p.error);
    const cardState=useLoad(binding,async()=>cardPath&&binding.rpc?{card:await binding.rpc('getCardAssetBindings',{path:cardPath,metadataOnly:true}),packs:[]}:null,[cardPath,cardStamp]);
    const writer=useStageWriter(binding,cardPath,cardState,sessionId),ext=cardPath&&cardState.value?writer.extension:null;
    const cardCtx=ext?.assetBindings?{binding,ext,writer,packs,path:cardPath,sessionId}:null;
    const scope=usePackScope({binding,ctx:cardCtx,packs}),actions=usePackActions(binding,{onChanged:()=>state.reload()});
    // download tray · 可更新 chips · the sheets above 获取素材包 (null without the capability).
    const catalogue=useCatalogue(binding,{packs,reload:()=>state.reload(),openPack:packId=>onOpen({packId})});
    React.useEffect(()=>binding.service.subscribe?.(()=>{state.reload();cardState.reload();}),[binding,cardPath,cardStamp]);
    // Bands are fixed per load (packs and the card's bindings), so a row never jumps while its state changes.
    const bound=cardCtx?cardCtx.ext.assetBindings.boundPackIds:null;
    const frozen=React.useRef({value:null,card:null,global:null,bound:null});
    // Without a card there is no middle band (v3.1 r2: no 「按卡使用」): 全局, then 关闭.
    if(frozen.current.value!==state.value||frozen.current.card!==cardState.value){const global=new Set(binding.globalEnabledPackIds||[]);
      frozen.current={value:state.value,card:cardState.value,global,bound:new Set(cardCtx?(bound||[]).filter(id=>!global.has(id)):[])};}
    const ids=packs.map(p=>p.manifest.id),byId=new Map(packs.map(p=>[p.manifest.id,p])),pass=packFilter(byId,query,kind),on=frozen.current.global,mine=frozen.current.bound;
    const rank=id=>on.has(id)?0:mine.has(id)?1:2;
    async function create(name){const r=await state.task(()=>binding.service.createPack({name,expectedRevision:null}));if(!r)return;setDraft(false);await state.reload();onOpen({packId:r.snapshot.manifest.id});}
    // each row shows its size and a quiet 导出 icon (that pack alone, the same
    // exportPack as the pack's ⋯ menu) left of its state tag. The header's 导出 icon enters selection mode like 舞台设置's
    // 「导出」: a house-style check before each title (none checked), the header's icons become 「已选 N」 · 取消 · 导出, and
    // confirming downloads the checked packs as one file (actions.exportPacks), then leaves the mode. Esc leaves it too.
    const canBatch=(binding.service.capabilities||[]).includes('pack-set')&&packs.length>0,busy=actions.work.busy;
    const chosen=picking?orderPacks(ids,{byId,rank,sort,kind}).filter(id=>picking.has(id)).map(id=>byId.get(id)):[];
    const flip=id=>setPicking(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
    const exportChosen=async()=>{if(chosen.length&&await actions.exportPacks(chosen))setPicking(null);};
    const home=React.useRef(null),wasPicking=React.useRef(false);
    React.useEffect(()=>{if(wasPicking.current!==!!picking)home.current?.querySelector?.(picking?'.ap-lib-cancel':'.ap-lib-batch')?.focus?.({preventScroll:true});wasPicking.current=!!picking;},[!!picking]);
    const lead=(id,pack)=>picking&&h('button',{type:'button',role:'checkbox',className:'ap-pack-check','aria-checked':picking.has(id),'aria-label':pack.manifest.name,disabled:busy,onClick:()=>flip(id)},
      h('span',{className:'ap-check-mark','aria-hidden':true},picking.has(id)&&h(Glyph,{name:'check'})));
    const aside=(id,pack)=>{const size=stageBytesText(stagePackBytes(pack));
      return h('span',{className:'ap-lib-aside'},size&&h('span',{className:'ap-lib-size'},size),
        picking?h('span',{className:'ap-lib-export is-gap','aria-hidden':true}):h(Button,{className:'ap-icon-button ap-lib-export',title:'导出','aria-label':'导出 '+pack.manifest.name,disabled:busy,onClick:()=>actions.exportPack(pack)},h(Glyph,{name:'share'})));};
    const tools=picking?h(React.Fragment,null,
        h('span',{className:'ap-select-count ap-lib-picked',role:'status'},'已选 ',h('b',null,chosen.length)),
        h(Button,{className:'ap-manage ap-lib-cancel',disabled:busy,onClick:()=>setPicking(null)},'取消'),
        h(Button,{className:'ap-manage is-done ap-lib-confirm',disabled:busy||!chosen.length,onClick:exportChosen},busy?'正在导出…':'导出')):
      h(React.Fragment,null,
        canBatch&&h(IconButton,{icon:'share',label:'导出',className:'ap-icon-button ap-lib-batch',disabled:busy,onClick:()=>setPicking(new Set())}),
        h(IconButton,{icon:'download',label:'获取素材包','aria-haspopup':'dialog',disabled:state.busy,onClick:()=>setGetting(true)}),
        h(IconButton,{icon:'plus',label:'新建素材包',disabled:draft,onClick:()=>setDraft(true)}));
    return h('div',{ref:home,className:'ap-home'+(picking?' is-picking':''),onKeyDown:e=>{if(picking&&e.key==='Escape'&&!e.defaultPrevented&&!busy){e.preventDefault();setPicking(null);}}},
      h('div',{className:'ap-pack-toolbar'},
        h(PackSearchBox,{label:'搜索素材包',placeholder:'搜索',value:query,onChange:setQuery}),
        packs.length>0&&h(KindSortTools,{packs,kind,setKind,sort,onSort:setSort}),
        tools),
      h(ErrorBox,{error:state.error,reload:state.reload}),h(ErrorBox,{error:actions.work.error}),h(ErrorBox,{error:scope.error}),
      catalogue.tray,
      draft&&h(NewPackRow,{busy:state.busy,onCreate:create,onCancel:()=>setDraft(false)}),
      !state.value?(!state.error&&h(Loading,{count:8})):!list.length?h(EmptyState,{noun:'素材包'}):h(React.Fragment,null,
        h(PackList,{ids:orderPacks(ids.filter(pass),{byId,rank,sort,kind}),empty:h(EmptyState,{noun:'素材包',query,filter:kind&&kinds[kind],
          text:!query.trim()&&kind?'没有含「'+kinds[kind]+'」的素材包':undefined,onClear:()=>{setQuery('');setKind('');}}),
          render:id=>{const pack=byId.get(id);return h(PackRow,{key:id,id,pack,scope,kind,badge:catalogue.badge(id),lead:lead(id,pack),aside:aside(id,pack),onOpen:(packId,k)=>onOpen({packId,kind:k})});}}),
        broken.length>0&&h('ul',{className:'ap-pack-list is-broken'},broken.map(p=>h('li',{key:p.packId,className:'ap-pack-row is-broken'},h('span',{className:'ap-pack-name is-missing'},h(Glyph,{name:'warning'}),'无法读取的素材包'),h(ErrorBox,{error:errorText(p.error),reload:state.reload}))))),
      actions.dialogs,
      getting&&h(PackGetSheet,{binding,packs,catalogueReady:catalogue.ready,onClose:()=>setGetting(false),onSources:catalogue.openSources,onInstalled:catalogue.installed,
        onPreview:preview=>{setGetting(false);actions.setPreview(preview);}}),
      catalogue.layer,
      open&&h(PackModal,{key:open.packId+':'+(open.at||''),binding,packId:open.packId,initial:open,scope,packs,ctx:null,onPacksChanged:()=>state.reload(),onOpenPack:(id,k,item)=>onOpen({packId:id,kind:k,figureId:item}),onClose:changed=>{onOpen(null);if(changed)state.reload();}}));
  }
  // ---------- The shared pack modal (素材库 and 舞台设置; editable everywhere) ----------
  function useNarrow() {
    const query='(max-width: 720px)',has=typeof matchMedia==='function';
    const [narrow,setNarrow]=React.useState(()=>has&&matchMedia(query).matches);
    React.useEffect(()=>{if(!has)return;const list=matchMedia(query),fn=()=>setNarrow(list.matches);list.addEventListener?.('change',fn);return()=>list.removeEventListener?.('change',fn);},[]);
    return narrow;
  }
  // 「复制到…」 / upload target: 新建素材包 first (inline name), then the other packs (search above 8).
  function PackTargetMenu({packs,exclude,onPick,close,createLabel='创建并复制'}) {
    const [creating,setCreating]=React.useState(false),[name,setName]=React.useState(''),[query,setQuery]=React.useState('');
    const q=query.trim().toLowerCase(),list=packs.filter(p=>p?.manifest&&p.manifest.id!==exclude&&(!q||p.manifest.name.toLowerCase().includes(q)));
    const make=()=>{if(!name.trim())return;close();onPick({name:name.trim()});};
    return h('div',{className:'ap-target-menu'},
      h(InlineAdd,{open:creating,onOpen:()=>setCreating(true),onCancel:()=>{setCreating(false);setName('');},className:'ap-target-new',inputClassName:'ap-new-input',label:'新素材包名称',placeholder:'素材包名称',value:name,onChange:setName,onConfirm:make,
          tile:h('button',{type:'button',role:'menuitem',className:'ap-menu-item is-create'},h('span',{className:'ap-target-plus'},h(Glyph,{name:'plus'})),'新建素材包')},
        h(Button,{className:'ap-solid-pill',disabled:!name.trim(),onClick:make},createLabel)),
      packs.length>8&&h(PackSearchBox,{label:'搜索素材包',value:query,onChange:setQuery,className:'is-compact'}),
      list.length>0&&h('div',{className:'ap-target-list'},list.map(p=>h('button',{key:p.manifest.id,type:'button',role:'menuitem',className:'ap-menu-item',onClick:()=>{close();onPick({packId:p.manifest.id,name:p.manifest.name});}},p.manifest.name))));
  }
  const ADD_KINDS=[['backgrounds','image/png,image/webp,image/jpeg'],['cg','image/png,image/webp,image/jpeg'],['props','image/png,image/webp,image/jpeg'],['music','audio/*,.mp3,.ogg,.wav,.m4a,.flac'],['sfx','audio/*,.mp3,.ogg,.wav,.m4a,.flac'],['ambience','audio/*,.mp3,.ogg,.wav,.m4a,.flac'],['figures','image/png,image/webp,image/jpeg']];
  // 「添加文件」: one item per kind, each a styled multi-file picker (one file → one entry, named after the file).
  // after a hairline, 「生成背景」 opens the background sheet (the description comes first).
  // 「演出风格」 has no file — its item (`onStyle`) starts a new entry in place.
  // `onModel` opens the Live2D / Spine import sheet (a folder or ZIP, not single files).
  function AddFilesMenu({onFiles,onGenerate,onStyle,onModel,label,disabled}) {
    return h(Popover,{label:'添加文件',className:'ap-add-files',trigger:({toggle,open})=>label?h(Button,{className:'ap-solid-pill is-large','aria-expanded':open,disabled,onClick:toggle},h(Glyph,{name:'upload'}),label):
        h(IconButton,{icon:'upload',label:'添加文件','aria-expanded':open,disabled,onClick:toggle}),
      content:close=>h(React.Fragment,null,ADD_KINDS.map(([kind,accept])=>h('label',{key:kind,className:'ap-menu-item ap-file-item','data-kind':kind},h(KindIcon,{kind}),h('span',null,kinds[kind]),
        h('input',{type:'file',multiple:true,accept,'aria-label':'添加'+kinds[kind],onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';close();if(files.length)onFiles(kind,files);}}))),
        onModel&&h('button',{type:'button',role:'menuitem',className:'ap-menu-item ap-file-item','data-kind':'model',onClick:()=>{close();onModel();}},h(KindIcon,{kind:'figures'}),h('span',null,'导入模型…')),
        onStyle&&h('button',{type:'button',role:'menuitem',className:'ap-menu-item ap-file-item','data-kind':'directions',onClick:()=>{close();onStyle();}},h(KindIcon,{kind:'directions'}),h('span',null,kinds.directions)),
        onGenerate&&h('button',{type:'button',role:'menuitem',className:'ap-menu-item ap-file-item ap-gen-menu-item',onClick:()=>{close();onGenerate();}},h(Glyph,{name:'spark'}),h('span',null,'生成背景')))});
  }
  const AUDIO_MIME={mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',m4a:'audio/mp4',flac:'audio/flac'};
  // Same signatures the pack service checks (media.js audioKind); the descriptor must match the bytes exactly.
  function audioExt(bytes) {
    if(bytes.length<12)return '';
    const ascii=(from,to)=>String.fromCharCode(...bytes.slice(from,to));
    if(ascii(0,3)==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)return 'mp3';
    if(ascii(0,4)==='OggS')return 'ogg';
    if(ascii(0,4)==='fLaC')return 'flac';
    if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE')return 'wav';
    if(ascii(4,8)==='ftyp')return 'm4a';
    return '';
  }
  async function prepareAudio(file) {
    const bytes=new Uint8Array(await file.arrayBuffer()),ext=audioExt(bytes);
    if(!ext)throw new Error('请选择 MP3、OGG、WAV、M4A 或 FLAC 音频');
    if(bytes.length>60*1024*1024)throw new Error('音频过大（上限 60 MB）');
    return {bytes,descriptor:{ext,mime:AUDIO_MIME[ext],size:bytes.length}};
  }
  const fileStem=name=>[...String(name||'').replace(/\.[^.]+$/,'').trim()].slice(0,120).join('')||'未命名';
  let entrySerial=0;
  const newEntryId=(pack,kind)=>{let id;do{id='u'+Date.now().toString(36)+(entrySerial++).toString(36)+Math.random().toString(36).slice(2,5);}while(pack.manifest.assets.some(a=>a.kind===kind&&a.id===id));return id;};
  // One figure picture (立绘 / 头像) into a pack through its serialized writer `enqueue(job(snapshot) → {snapshot})`: the pack
  // modal's uploads and every generation 采用 (useAssetGen), also the 新人物 page's (asset-pack-setup-ui.js).
  function figureImageImporter({binding,packId,enqueue}) {
    return async(figureId,outfitKey,emotion,file,kind,{expectedPackId,expectedRevision,onImported,customEmotion,imageId}={})=>{
      const image=await prepareImage(file,kind,false),media=await assetImagePublication.closure(image),svc=binding.service;
      if(expectedRevision!==undefined&&image.hasAlpha===false)throw new Error('生成素材没有有效透明背景，请先处理后再导入');
      const committed=await enqueue(async c=>{
        if(expectedRevision!==undefined&&(expectedPackId!==packId||c.revision!==expectedRevision))throw Object.assign(new Error('原素材包或目标已变化，请刷新复核后再采用'),{code:'REVISION_CONFLICT'});
        return svc.patchPack(await imagePublisher.figure({snapshot:c,figureId,outfitKey,emotion,kind,image,media,customEmotion,imageId,
          auto:(...args)=>figureAutoPatch(binding,...args)}));
      });
      await onImported?.({hash:media.hash,revision:committed.snapshot.revision});return image.warnings;
    };
  }
  // initial: {kind?, figureId?, tab?: 'gen' | 'voice' (stage setup wizard: the figure opens on 生图 or its 声音 page)}. scope: the surface's usePackScope (its errors show in the foot; figure-editor r4:
  // no state tag in the header — the pack's 全局 / 本卡 / 关闭 is set in the library list, not inside the pack). ctx: card context or null.
  // onClose(changed): `changed` tells the caller its cached pack snapshots are stale.
  function PackModal({binding,packId,initial,scope,packs,ctx,onPacksChanged,onOpenPack,onClose}) {
    const state=useLoad(binding,()=>binding.service.getPackSnapshot({packId}),[packId]),pack=state.value,audio=useAudioPreview(binding,packId),narrow=useNarrow(),work=useTask(binding);
    // a list lamp choice is a quiet write of its own — no 正在处理…, only an error in the foot.
    const lampWork=useTask(binding);
    const [kind,setKind]=React.useState(initial?.kind||null),[sel,setSel]=React.useState(initial?.figureId||null),[query,setQuery]=React.useState(''),[filter,setFilter]=React.useState('all'),[detail,setDetail]=React.useState(!!initial?.figureId),[category,setCategory]=React.useState('');
    const [selecting,setSelecting]=React.useState(false),[picked,setPicked]=React.useState(()=>new Set()),[notice,setNotice]=React.useState(null),changed=React.useRef(false);
    // the figure page's tab (编辑 / 生图) stays put while the user walks the figure list.
    const [figureTab,setFigureTab]=React.useState(initial?.tab==='gen'?'gen':'edit');
    // a new 演出风格 is a local draft until its text is written (a style needs text).
    const [styleDraft,setStyleDraft]=React.useState(false);
    React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),8000);return()=>clearTimeout(t);},[notice]);
    const latest=React.useRef(null),queue=React.useRef(Promise.resolve());
    const seen=React.useRef(null);if(pack!==seen.current){seen.current=pack;latest.current=pack;}
    // Another surface wrote this pack: reload (own writes already carry the newest revision).
    React.useEffect(()=>binding.service.subscribe?.(event=>{if(event?.packId===packId&&event.revision&&event.revision!==latest.current?.revision)state.reload();}),[binding,packId]);
    // Every write is serialized on the newest revision (quick edits chain instead of conflicting).
    function enqueue(job){
      const run=queue.current.then(async()=>{const result=await job(latest.current);if(result?.status==='removed'){changed.current=true;onClose(true);}else if(result?.snapshot){latest.current=result.snapshot;state.setValue(result.snapshot);changed.current=true;}return result;});
      queue.current=run.catch(()=>{});return run;
    }
    const commit=(k,id,update)=>enqueue(async c=>{
      const attempt=snapshot=>binding.service.patchPack({packId,expectedRevision:snapshot.revision,patch:{assets:snapshot.manifest.assets.map(a=>a.kind===k&&a.id===id?update(a):a)}});
      try{return await attempt(c);}catch(error){if(error?.code!=='REVISION_CONFLICT')throw error;const fresh=await binding.service.getPackSnapshot({packId});latest.current=fresh;return attempt(fresh);}
    });
    // CG drafts publish their full media closure once; conflicts never auto-merge.
    const saveCg=(asset,expectedRevision,fileUpdates,blobs)=>enqueue(c=>binding.service.patchPack({packId,expectedRevision,fileUpdates,
      patch:{assets:c.manifest.assets.map(a=>a.kind==='cg'&&a.id===asset.id?asset:a),blobs:{...c.manifest.blobs,...blobs}}}));
    const commitFigure=(figureId,make)=>enqueue(async c=>{
      const attempt=snapshot=>binding.service.patchFigure({packId,expectedRevision:snapshot.revision,figureId,patch:make(snapshot.figures[figureId])});
      try{return await attempt(c);}catch(error){if(error?.code!=='REVISION_CONFLICT')throw error;const fresh=await binding.service.getPackSnapshot({packId});latest.current=fresh;state.setValue(fresh);return attempt(fresh);}
    });
    const assignFigureVoice=(figureId,choice)=>enqueue(c=>binding.rpc('assignFigureVoice',{packId,expectedRevision:c.revision,figureId,...choice}));
    // the voice page's pack writes (voice, binding, variants, templates, reference blobs) join the same CAS queue.
    const commitVoice=job=>enqueue(job);
    // an existing figure already owns its destination; imports never ask for a target pack again.
    // media identity is computed once for CAS addressing, not an integrity recheck.
    const imageClosure=assetImagePublication.closure;
    const jsonBytes=value=>new TextEncoder().encode(JSON.stringify(value));
    const importFigureImage=figureImageImporter({binding,packId,enqueue});
    // the import sheet's result. The bundle goes in first (the pack
    // service's validation is the one check), then the figure: a new figure with one outfit (createFigure), a new outfit, or
    // the outfit's live2d / spine block (a new rig drops the old one's anatomy / skin / frame: they are in its units; a
    // Spine outfit keeps bottomFade). Model textures are not a colour source. Resolves to the figure id.
    // an outfit has one model — a Live2D import replaces its Spine and vice versa.
    const importModel=({kind,prepared,config,target})=>enqueue(async c=>{
      const svc=binding.service,bundleKey=newResourceKey(kind==='spine'?'spine':'model');
      const figure=target.figureId?c.figures[target.figureId]:null,outfit=figure&&target.outfitKey?figure.outfits.find(o=>o.key===target.outfitKey):null;
      if(target.figureId&&!figure)throw new Error('人物已被删除，请重新载入');
      if(target.outfitKey&&!outfit)throw new Error('服装已被删除，请重新载入');
      const block=kind==='spine'?{bundleKey,...config,...(outfit?.spine?.bottomFade!==undefined?{bottomFade:outfit.spine.bottomFade}:{})}:
        {bundleKey,...(Object.keys(config.emotionMap).length?{emotionMap:config.emotionMap}:{})};
      try {
        c=(await svc.putBundle({packId,expectedRevision:c.revision,bundleKey,descriptor:prepared.descriptor,files:prepared.files})).snapshot;
        if(!figure)return await svc.createFigure({packId,expectedRevision:c.revision,figure:{schemaVersion:1,name:target.name,enabled:true,appearance:kind,recall:{mode:'keyword'},
          emotions:target.emotions,outfits:[{key:'default',label:target.outfitLabel,enabled:true,defaultEmotion:target.defaultEmotion,[kind]:block}]}});
        const known=(figure.emotions||[]).some(e=>e.id===target.defaultEmotion);
        const outfits=outfit?figure.outfits.map(o=>{if(o!==outfit)return o;const next={...o,[kind]:block};delete next[kind==='spine'?'live2d':'spine'];return next;}):
          [...figure.outfits,{key:newResourceKey('outfit'),label:target.outfitLabel,enabled:true,...(known?{defaultEmotion:target.defaultEmotion}:{}),[kind]:block}];
        return {...await svc.patchFigure({packId,expectedRevision:c.revision,figureId:figure.id,patch:{outfits}}),figureId:figure.id};
      } catch(error) { latest.current=c;state.setValue(c);throw error; }
    });
    // the Spine dialog's result — a new bundle when files were picked (the
    // service's validateSpineBundle checks it), then the outfit's spine block. A new rig drops the old rig's skin, frame
    // and anatomy (they are in its skeleton's units); editing without files keeps them.
    const importFigureSpine=(figureId,outfitKey,{prepared,config})=>enqueue(async c=>{
      const figure=c.figures[figureId],outfit=figure?.outfits.find(o=>o.key===outfitKey),svc=binding.service;
      if(!outfit)throw new Error('服装已被删除，请重新载入');
      const old=outfit.spine||{},keep=Object.fromEntries(Object.entries(old).filter(([k])=>(prepared?['bottomFade']:['skin','frame','anatomy','bottomFade']).includes(k)));
      try {
        const bundleKey=prepared?newResourceKey('spine'):old.bundleKey;
        if(prepared)c=(await svc.putBundle({packId,expectedRevision:c.revision,bundleKey,descriptor:prepared.descriptor,files:prepared.files})).snapshot;
        const spine={bundleKey,...config,...keep};
        return await svc.patchFigure({packId,expectedRevision:c.revision,figureId,patch:{outfits:figure.outfits.map(o=>o.key===outfitKey?{...o,spine}:o)}});
      } catch(error) { latest.current=c;state.setValue(c);throw error; }
    });
    // an uploaded 设定图 and a background picture use the same serialized CAS writer.
    const putThen=(file,kind,make)=>prepareImage(file,kind,false).then(async image=>{
      const media=await imageClosure(image);
      return enqueue(async c=>{const patch=await make(c,media.hash,media.files);return binding.service.patchPack(assetImagePublication.publish(c,media,patch));});
    });
    const importSettei=(figureId,outfitKey,file)=>putThen(file,'settei',(s,hash,files)=>{
      const figure=s.figures[figureId];files.set('figures/'+figureId+'.json',jsonBytes({...figure,outfits:figure.outfits.map(o=>o.key===outfitKey?{...o,settei:hash}:o)}));return {};
    });
    // the figure's 人物设定图 (Figure.identitySettei) takes the same full
    // resource write — image intake, then the figure document and its blob in one CAS patchPack (never the metadata fast
    // path). The palette described the old board, so it is cleared; the version is the backend accept's own rule
    // (SHA-256 of {board,palette}). Nothing is accepted or approved here.
    const importIdentitySettei=(figureId,file)=>putThen(file,'settei',async(s,hash,files)=>{
      const figure=s.figures[figureId];if(!figure)throw new Error('人物已被删除，请重新载入');
      const palette=[],digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({board:hash,palette})));
      const version=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      files.set('figures/'+figureId+'.json',jsonBytes({...figure,identitySettei:{board:hash,version,palette}}));return {};
    });
    // 删除: the same write without the field. (patchFigure {identitySettei:null} does not drop the board's blob, so a board
    // no other slot uses fails the closure check — 「Unused image cannot be installed」; patchPack trims it.)
    const removeIdentitySettei=figureId=>enqueue(c=>{
      const figure=c.figures[figureId];if(!figure)throw new Error('人物已被删除，请重新载入');if(!figure.identitySettei)return {snapshot:c};
      const next={...figure};delete next.identitySettei;
      return binding.service.patchPack({packId,expectedRevision:c.revision,patch:{},fileUpdates:new Map([['figures/'+figureId+'.json',jsonBytes(next)]])});
    });
    // a 差分 tile's 「删除立绘 / 头像…」 and the 设定图 tile's 「删除设定图…」 — the figure
    // document (and a rewritten simple 立绘) without that picture, in one CAS patchPack that trims the unused blob. The 差分
    // itself stays (its tile turns empty). a talking / blinking (动态) 立绘 is
    // deleted the same way — that 差分's entry with its mouth / blink frames (removeSpriteEmotion); every other 差分 keeps its
    // structure. A manifest another outfit also uses is not rewritten: this outfit gets its own copy without the 差分.
    const removeFigureImage=(figureId,outfitKey,emotion,kind)=>enqueue(c=>{
      const figure=c.figures[figureId],outfit=figure?.outfits.find(o=>o.key===outfitKey);if(!outfit)throw new Error('服装已被删除，请重新载入');
      const files=new Map(),patch={};let next;
      if(kind==='settei'){next={...outfit};delete next.settei;delete next.setteiParentVersion;}
      else if(kind==='avatar'){if(outfit.sprite?.imagePools)throw new Error('已发布头像保留在历史中；请上传新头像以创建新图片身份');const avatars={...(outfit.avatars||{})};delete avatars[emotion];next={...outfit,avatars};if(!Object.keys(avatars).length)delete next.avatars;}
      else{
        const spriteKey=outfit.sprite?.manifestKey,made=removeSpriteEmotion(outfit,spriteKey&&c.sprites[spriteKey],emotion);
        if(!made)return {snapshot:c};
        const spriteFile=c.manifest.sprites[spriteKey],shared=Object.values(c.figures).some(f=>f.outfits.some(o=>o.sprite?.manifestKey===spriteKey&&(f.id!==figureId||o.key!==outfitKey)));
        next=made.outfit;
        if(!made.manifest){if(!shared){patch.sprites=Object.fromEntries(Object.entries(c.manifest.sprites).filter(([k])=>k!==spriteKey));files.set(spriteFile,null);}}
        else if(shared){const key=newResourceKey('sprite'),file='sprites/'+key+'/manifest.json';patch.sprites={...c.manifest.sprites,[key]:file};files.set(file,jsonBytes(made.manifest));next={...next,sprite:{...next.sprite,manifestKey:key}};}
        else files.set(spriteFile,jsonBytes(made.manifest));
      }
      files.set('figures/'+figureId+'.json',jsonBytes({...figure,outfits:figure.outfits.map(o=>o.key===outfitKey?next:o)}));
      return binding.service.patchPack({packId,expectedRevision:c.revision,patch,fileUpdates:files});
    });
    const uploadVariant=async(kind,assetId,variantId,file)=>{
      const media=AUDIO_KINDS.includes(kind)?await prepareAudio(file):await prepareImage(file,'background');
      const closure=await imageClosure(media);
      return enqueue(snapshot=>binding.service.patchPack({packId,expectedRevision:snapshot.revision,fileUpdates:closure.files,patch:{blobs:{...snapshot.manifest.blobs,...closure.blobs},assets:snapshot.manifest.assets.map(asset=>{
        if(asset.kind!==kind||asset.id!==assetId)return asset;
        const change=content=>{const next={...content,media:closure.hash};delete next.pendingMedia;if(AUDIO_KINDS.includes(kind)){delete next.durationMs;delete next.loudness;}if(kind==='sfx')delete next.gainDb;return next;};
        return asset.variants?{...asset,variants:{...asset.variants,entries:asset.variants.entries.map(row=>row.id===variantId?{...row,content:change(row.content)}:row)}}:change(asset);
      })}}));
    };
    // the pack's 标签图标 (manifest.tagIcons, tag path → an image of this pack). An upload binds
    // its image and the row in one CAS patchPack; rename / delete rewrite the list (patchPack trims an image nobody uses).
    const [tagSheet,setTagSheet]=React.useState(false);
    const saveTagIcons=make=>enqueue(snapshot=>binding.service.patchPack({packId,expectedRevision:snapshot.revision,patch:{tagIcons:make(snapshot.manifest.tagIcons||[])}}));
    const uploadTagIcon=async(tag,file)=>{
      const closure=await imageClosure(await prepareImage(file,'background'));
      return enqueue(snapshot=>{const icons=snapshot.manifest.tagIcons||[],row={tag,media:closure.hash};
        return binding.service.patchPack({packId,expectedRevision:snapshot.revision,fileUpdates:closure.files,patch:{blobs:{...snapshot.manifest.blobs,...closure.blobs},
          tagIcons:icons.some(icon=>icon.tag===tag)?icons.map(icon=>icon.tag===tag?row:icon):[...icons,row]}});});
    };
    const uploadBackground=(assetId,file)=>putThen(file,'background',(s,hash)=>({assets:s.manifest.assets.map(a=>{if(a.kind!=='backgrounds'||a.id!==assetId)return a;const next={...a,media:hash};delete next.pendingMedia;return next;})}));
    const gen=useAssetGen({binding,packId,enqueue,importFigureImage,onPacksChanged});
    // the generation dialog's 「设为本包默认」 — the pack's default style preset.
    const saveStyle=style=>enqueue(c=>binding.service.patchPack({packId,expectedRevision:c.revision,patch:{genStyle:style}}));
    const generateBackground=()=>{stopSelect();setKind('backgrounds');setQuery('');setFilter('all');gen.openSheet({packId,kind:'background'});};
    // the sheet from 「添加文件」 (null pending) or a folder / ZIP dropped on the pack window.
    const [modelImport,setModelImport]=React.useState(null);
    const openModelImport=()=>{stopSelect();setModelImport({pending:null});};
    const packDrop=modelDropFrame(work.busy,(entries,name)=>{const read=entries();read.catch(()=>{});stopSelect();setModelImport({pending:{entries:read,name}});},'pack');
    const importModelHere=async result=>{const made=await importModel(result);
      setKind('figures');setQuery('');setFilter('all');setSel(made.figureId);setFigureTab('edit');if(narrow)setDetail(true);setNotice({text:'已导入模型'});onPacksChanged?.();};
    const close=()=>{audio.stop();onClose(changed.current);};
    // 演出风格 is the one kind added in place (no file), so its tab also shows while it is empty and asked for.
    const name=pack?.manifest.name||'素材包',present=pack?KIND_ORDER.filter(k=>kindCount(pack.manifest,k)>0||(k==='directions'&&kind==='directions')):[];
    const current=kind&&present.includes(kind)?kind:present[0]||null;
    // while a drop is being written the list already shows the new order.
    const [figureOrder,setFigureOrder]=React.useState(null),moving=React.useRef(0);
    const stored=pack&&current?packItems(pack,current):[],needle=query.trim().toLowerCase();
    const all=current==='figures'&&figureOrder?figureOrder.map(id=>stored.find(f=>f.id===id)).filter(Boolean):stored;
    const drafting=current==='directions'&&(styleDraft||!all.length);
    // the filter is the lamp model itself — 蓝灯 / 绿灯 / 关闭 (启用 / 关闭 for 演出风格),
    // read with the rows' own entryLamp, so a 关闭 entry never also counts as 蓝灯. (The old 已启用 / 已停用 were 蓝灯+绿灯 / 关闭.)
    // A stage skin has no state, so no filter.
    const lampless=LAMPLESS_KINDS.includes(current),filterModes=STATELESS_KINDS.includes(current)?[]:lampless?['on','off']:lampChoices(current)||['constant','keyword','off'];
    const lampFilter=filterModes.includes(filter)?filter:'all';
    const pass=a=>lampFilter==='all'||entryLamp(a,lampless)===lampFilter;
    // a 标签 (category) chip in the entry filters the list to that category level (and its children).
    const inCategory=a=>assetTags.matches(a.category,category);
    const shown=all.filter(a=>pass(a)&&inCategory(a)&&entryMatches(a,current,needle));
    const selected=all.find(a=>a.id===sel)||shown[0]||null;
    // figures reorder in the full list only (a filtered or searched list has gaps), never in 多选.
    // The drop is one CAS patchPack of manifest.figures, rebuilt on the newest snapshot — nothing else in the pack changes.
    const moveFigure=(id,before)=>{
      if(!sel&&selected)setSel(selected.id); // the open figure stays open (an unset selection would follow the new first row)
      const next=all.map(f=>f.id).filter(f=>f!==id);next.splice(before===null?next.length:next.indexOf(before),0,id);setFigureOrder(next);moving.current++;
      lampWork.task(()=>enqueue(c=>{
        const rest=c.manifest.figures.filter(f=>f!==id),at=before===null?rest.length:rest.indexOf(before);
        if(at<0)throw new Error('人物已被删除，请重新载入');rest.splice(at,0,id);
        return rest.join()===c.manifest.figures.join()?{snapshot:c}:binding.service.patchPack({packId,expectedRevision:c.revision,patch:{figures:rest}});
      })).finally(()=>{if(!--moving.current)setFigureOrder(null);});
    };
    const reorder=useListReorder({ids:all.map(f=>f.id),enabled:current==='figures'&&lampFilter==='all'&&!needle&&!category&&!selecting&&all.length>1,onMove:moveFigure});
    // A newly selected item starts at the top of the detail column.
    const rightRef=React.useRef(null);React.useEffect(()=>{if(rightRef.current)rightRef.current.scrollTop=0;},[current,selected?.id]);
    const toggle=id=>setPicked(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
    const stopSelect=()=>{setSelecting(false);setPicked(new Set());};
    const switchKind=k=>{audio.stop();setKind(k);setSel(null);setQuery('');setCategory('');setDetail(false);setPicked(new Set());setStyleDraft(false);};
    // 新建 (the dashed ＋, or 「演出风格」 in the add menu) opens a draft; the first write adds
    // the entry (启用, 蓝灯 recall as the contract requires). 删除 removes it in one CAS write.
    const addStyle=()=>{audio.stop();stopSelect();setKind('directions');setQuery('');setFilter('all');setCategory('');setStyleDraft(true);setDetail(true);};
    const createStyle=async({name:styleName,text,enabled})=>{
      const asset={kind:'directions',id:newEntryId(latest.current,'directions'),name:styleName,enabled,recall:{mode:'constant',keywords:[]},directorNote:'',text};
      await enqueue(c=>binding.service.patchPack({packId,expectedRevision:c.revision,patch:{assets:[...c.manifest.assets,asset]}}));
      setStyleDraft(false);setSel(asset.id);onPacksChanged?.();
    };
    const removeStyle=id=>work.task(async()=>{
      await enqueue(c=>binding.service.patchPack({packId,expectedRevision:c.revision,patch:{assets:c.manifest.assets.filter(a=>!(a.kind==='directions'&&a.id===id))}}));
      setSel(null);setDetail(false);setNotice({text:'已删除'});onPacksChanged?.();
    });
    // ⋯ › 删除 of a standalone 舞台皮肤 — the entry, its bundle (when no other entry
    // uses it) and the bundle's files leave in one CAS write.
    const removeEntry=(k,id)=>work.task(async()=>{
      await enqueue(c=>{
        const asset=c.manifest.assets.find(a=>a.kind===k&&a.id===id);if(!asset)throw new Error('条目已被删除，请重新载入');
        const assets=c.manifest.assets.filter(a=>a!==asset),shared=asset.bundleKey&&assets.some(a=>a.bundleKey===asset.bundleKey);
        const bundles={...c.manifest.bundles};if(asset.bundleKey&&!shared)delete bundles[asset.bundleKey];
        const gone=asset.bundleKey&&!shared?c.manifest.files.filter(f=>f.path.startsWith('bundles/'+asset.bundleKey+'/')).map(f=>[f.path,null]):[];
        return binding.service.patchPack({packId,expectedRevision:c.revision,patch:{assets,bundles},...(gone.length?{fileUpdates:new Map(gone)}:{})});
      });
      setSel(null);setDetail(false);setNotice({text:'已删除'});onPacksChanged?.();
    });
    // images and their complete owning figure/background publish atomically.
    const addFiles=(k,files)=>work.task(async()=>{
      const svc=binding.service,added=[],figures=[];
      if(k==='cg') {
        const revision=latest.current.revision,prepared=await prepareCgFiles(files);
        const asset={kind:'cg',id:newEntryId(latest.current,'cg'),name:fileStem(files[0].name),enabled:true,directorNote:'',recall:{mode:'keyword',keywords:[]},variants:{default:prepared.variants[0].id,entries:prepared.variants}};
        await enqueue(c=>svc.patchPack({packId,expectedRevision:revision,fileUpdates:prepared.updates,patch:{assets:[...c.manifest.assets,asset],blobs:{...c.manifest.blobs,...prepared.blobs}}}));
        stopSelect();setKind(k);setQuery('');setFilter('all');setSel(asset.id);onPacksChanged?.();return;
      }
      for(const file of files){
        const stem=fileStem(file.name),media=AUDIO_KINDS.includes(k)?await prepareAudio(file):await prepareImage(file,k==='figures'?'sprite':'background');
        if(AUDIO_KINDS.includes(k)){
          const blob=await enqueue(c=>svc.putBlob({packId,expectedRevision:c.revision,bytes:media.bytes,descriptor:media.descriptor}));
          added.push({kind:k,id:newEntryId(latest.current,k)+added.length,name:stem,enabled:true,recall:{mode:'keyword',keywords:[]},directorNote:'',media:blob.hash});continue;
        }
        const closure=await imageClosure(media);
        if(k==='figures'){
          const figureId=crypto.randomUUID(),spriteKey=newResourceKey('sprite'),spriteFile='sprites/'+spriteKey+'/manifest.json',made=ownSpriteDefinition({calm:{hash:closure.hash,width:media.width,height:media.height}},stem);
          const figure={schemaVersion:1,id:figureId,name:stem,enabled:true,appearance:'live2d',recall:{mode:'keyword'},autoColor:media.autoColor,emotions:[{id:'calm'}],outfits:[{key:'default',label:'默认',enabled:true,sprite:{manifestKey:spriteKey,assets:made.assets}}]};
          closure.files.set(spriteFile,jsonBytes(made.manifest));closure.files.set('figures/'+figureId+'.json',jsonBytes(figure));
          await enqueue(c=>svc.patchPack({packId,expectedRevision:c.revision,patch:{figures:[...c.manifest.figures,figureId],sprites:{...c.manifest.sprites,[spriteKey]:spriteFile},blobs:{...c.manifest.blobs,...closure.blobs}},fileUpdates:closure.files}));figures.push(figureId);
        }else{
          const asset={kind:k,id:newEntryId(latest.current,k)+added.length,name:stem,enabled:true,recall:{mode:'keyword',keywords:[]},directorNote:'',media:closure.hash};
          await enqueue(c=>svc.patchPack({packId,expectedRevision:c.revision,patch:{assets:[...c.manifest.assets,asset],blobs:{...c.manifest.blobs,...closure.blobs}},fileUpdates:closure.files}));added.push(asset);
        }
      }
      if(added.length&&AUDIO_KINDS.includes(k))await enqueue(c=>svc.patchPack({packId,expectedRevision:c.revision,patch:{assets:[...c.manifest.assets,...added]}}));
      stopSelect();setKind(k);setQuery('');setFilter('all');setSel(added[0]?.id||figures[0]||null);
      setNotice({text:'已添加 '+files.length+' 项'});onPacksChanged?.();
    });
    // 复制到…: copyItems (one publication with the same-pack closure); 新建素材包 creates the target in the same write.
    // `only`: one item (the figure page's ⋯ → 复制到…) instead of the multi-selection.
    const copyTo=(target,only)=>work.task(async()=>{
      const ids=only?[only]:all.filter(a=>picked.has(a.id)).map(a=>a.id),itemRefs=ids.map(id=>({kind:current,id}));
      let result;
      if(target.packId){
        const attempt=revision=>binding.service.copyItems({sourcePackId:packId,itemRefs,target:{packId:target.packId,expectedRevision:revision}});
        const known=packs?.find(p=>p?.manifest?.id===target.packId)?.revision;
        try{result=await attempt(known||(await binding.service.getPackSnapshot({packId:target.packId})).revision);}
        catch(e){if(e?.code!=='REVISION_CONFLICT')throw e;result=await attempt((await binding.service.getPackSnapshot({packId:target.packId})).revision);}
      } else result=await binding.service.copyItems({sourcePackId:packId,itemRefs,target:{newPackName:target.name}});
      stopSelect();setNotice({text:'已复制 '+ids.length+' 项到「'+target.name+'」',packId:result?.packId||target.packId});onPacksChanged?.();
    });
    // the figure page's ⋯ — 复制到… (copyItems) and 删除人物 (removeFigure, on the CAS queue).
    const figureActions=id=>({packs:packs||[],packId,copy:target=>copyTo(target,id),
      removeEmotion:emotionId=>enqueue(c=>binding.service.removeFigureEmotion({packId,expectedRevision:c.revision,figureId:id,emotionId})),
      // mark / unmark one outfit × 差分 as 「不需要（用默认图）」 on the CAS
      // queue. A conflict is not retried (the owner decides on what is current): the snapshot is reloaded and the error shown.
      // `use` names the 差分 that stands in (回退); none = the default 差分.
      setFallback:typeof binding.service.setFigureEmotionFallback==='function'?(outfitKey,emotionId,enabled,use)=>enqueue(async c=>{
        try{return await binding.service.setFigureEmotionFallback({packId,expectedRevision:c.revision,figureId:id,outfitKey,emotionId,enabled,...(enabled&&use?{use}:{})});}
        catch(error){if(error?.code==='REVISION_CONFLICT'){const fresh=await binding.service.getPackSnapshot({packId}).catch(()=>null);if(fresh){latest.current=fresh;state.setValue(fresh);}}throw error;}}):null,
      // the 模型 view's 「删除模型…」 — the outfit without its Live2D / Spine block, then the bundle
      // when no outfit of the pack uses it any more.
      removeModel:outfitKey=>enqueue(async c=>{
        const svc=binding.service,figure=c.figures[id],outfit=figure?.outfits.find(o=>o.key===outfitKey);if(!outfit)throw new Error('服装已被删除，请重新载入');
        const keys=[outfit.live2d?.bundleKey,outfit.spine?.bundleKey].filter(Boolean),next={...outfit};delete next.live2d;delete next.spine;
        try{
          c=(await svc.patchFigure({packId,expectedRevision:c.revision,figureId:id,patch:{outfits:figure.outfits.map(o=>o===outfit?next:o)}})).snapshot;
          const used=new Set(Object.values(c.figures).flatMap(f=>f.outfits.flatMap(o=>[o.live2d?.bundleKey,o.spine?.bundleKey])));
          for(const bundleKey of keys)if(!used.has(bundleKey))c=(await svc.removeBundle({packId,expectedRevision:c.revision,bundleKey})).snapshot;
          return {snapshot:c};
        } catch(error) { latest.current=c;state.setValue(c);throw error; }
      }),
      remove:()=>work.task(async()=>{await enqueue(c=>binding.service.removeFigure({packId,expectedRevision:c.revision,figureId:id}));setSel(null);setDetail(false);setNotice({text:'已删除人物'});onPacksChanged?.();})});
    const actions=usePackActions(binding,{onRemoved:()=>{changed.current=true;close();},onChanged:()=>onPacksChanged?.()});
    const menu=pack&&h(Popover,{label:name+' 操作',trigger:({toggle:t,open})=>h(IconButton,{icon:'more',label:'更多操作 '+name,'aria-expanded':open,disabled:actions.work.busy,onClick:t}),content:closeMenu=>h(React.Fragment,null,
      h(MenuItem,{onClick:()=>{closeMenu();audio.stop();setTagSheet(true);}},'标签图标'),
      h(MenuItem,{onClick:()=>{closeMenu();actions.exportPack(pack);}},'导出'),
      h(MenuItem,{onClick:()=>{closeMenu();actions.copyPack(pack);}},'复制'),
      h(MenuItem,{danger:true,onClick:()=>{closeMenu();actions.askRemove(pack);}},'删除'))});
    // a single-figure pack is usually named after its figure; then the title would repeat the
    // heading beside it (大肥鱼 × 3), so it names the container instead.
    const title=current==='figures'&&selected&&selected.name===name?'素材包':name;
    // a pack opened from a 基础设置 「›」 (BGM / 音效 / 环境音 / 模组) carries
    // `initial.back` ({label, open}); its head starts with the sub-page ‹ that closes the pack and returns there.
    const back=initial?.back&&typeof initial.back.open==='function'?initial.back:null;
    const head=h('header',{className:'ap-pack-head'+(back?' has-back':'')},back&&h(SubpageBack,{parent:back.label,onBack:()=>{close();back.open();}}),h('h2',{title:title===name?undefined:name},title),
      h('span',{className:'ap-pack-head-tools'},menu,h(IconButton,{icon:'close',label:'关闭',onClick:close})));
    // in 多选 a click toggles the row; Shift+click sets the rows between the
    // last clicked one and this one (in the shown order) to that row's state.
    const pickAnchor=React.useRef(null);
    const pick=(id,e)=>{setStyleDraft(false);
      if(selecting){const ids=shown.map(a=>a.id),from=pickAnchor.current,a=ids.indexOf(from),b=ids.indexOf(id);
        if(e?.shiftKey&&from!==id&&a>=0&&b>=0){const range=ids.slice(Math.min(a,b),Math.max(a,b)+1),on=picked.has(from);
          setPicked(p=>{const n=new Set(p);for(const r of range)on?n.add(r):n.delete(r);return n;});}
        else toggle(id);
        pickAnchor.current=id;setSel(id);return;}
      setSel(id);if(narrow)setDetail(true);};
    // The lamp items read like LampMenu's own (dot + the same word: ENTRY_LAMPS).
    const filterMenu=filterModes.length>0&&h(Popover,{label:'筛选条目',className:'ap-filter-anchor',trigger:({toggle:t,open})=>h(Button,{className:'ap-icon-button','data-on':lampFilter!=='all'||undefined,'aria-label':'筛选条目','aria-expanded':open,title:'筛选',onClick:t},h(Glyph,{name:'filter'})),
      content:closeMenu=>['all',...filterModes].map(v=>h('button',{key:v,type:'button',role:'menuitemradio','aria-checked':lampFilter===v,className:'ap-menu-item ap-lamp-opt','data-mode':v,onClick:()=>{setFilter(v);closeMenu();}},
        h('span',{className:'ap-lamp-dot'}),h('span',{className:'ap-lamp-opt-name'},v==='all'?'全部':ENTRY_LAMPS[v]),lampFilter===v&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
    // 多选 turns
    // the search row into the selection bar — the round check (全选 / 全不选 of what is shown, − when some are) · 「已选 N」 ……
    // 取消 · 复制到…, the house 「已选 N · 取消 · <action>」 of the library's other selection modes. Esc (the popup stack, so an
    // open menu closes first) or 取消 leaves it and focus returns to the 多选 button; Ctrl+A selects everything shown.
    const pickedShown=shown.filter(a=>picked.has(a.id)).length,allState=pickedShown===0?false:pickedShown===shown.length?true:'mixed';
    const pickAll=()=>setPicked(allState===true?new Set():new Set(shown.map(a=>a.id)));
    const leftRef=React.useRef(null),wasSelecting=React.useRef(false);
    useOverlay(selecting,()=>[leftRef.current?.closest?.('.ap-modal')],stopSelect);
    React.useEffect(()=>{if(wasSelecting.current!==selecting){const at=leftRef.current;
      if(at&&(!document.activeElement||document.activeElement===document.body||at.contains(document.activeElement)||!document.activeElement.isConnected))
        at.querySelector(selecting?'.ap-select-bar button':'.ap-select-toggle')?.focus?.({preventScroll:true});}
      wasSelecting.current=selecting;if(!selecting)pickAnchor.current=null;},[selecting]);
    const selectKeys=e=>{if(!selecting||!(e.ctrlKey||e.metaKey)||e.altKey||e.shiftKey||String(e.key).toLowerCase()!=='a'||e.target?.closest?.('input,textarea,[contenteditable=true]'))return;
      e.preventDefault();setPicked(new Set(shown.map(a=>a.id)));};
    const selbar=selecting&&h('div',{className:'ap-select-bar'},
      h('button',{type:'button',role:'checkbox',className:'ap-pack-check ap-select-all','aria-checked':allState,'aria-label':'全选',title:allState===true?'全不选':'全选',disabled:!shown.length,onClick:pickAll},
        h('span',{className:'ap-check-mark','aria-hidden':true},allState===true?h(Glyph,{name:'check'}):allState==='mixed'?h('i',{className:'ap-check-dash'}):null)),
      h('span',{className:'ap-select-count',role:'status'},'已选 ',h('b',null,picked.size)),
      h(Button,{className:'ap-manage',onClick:stopSelect},'取消'),
      h(Popover,{label:'复制到',className:'ap-copy-anchor',float:true,trigger:({toggle:t,open})=>h(Button,{className:'ap-manage is-done','aria-expanded':open,disabled:!picked.size||work.busy,onClick:t},'复制到…'),
        content:closeMenu=>h(PackTargetMenu,{packs:packs||[],exclude:packId,close:closeMenu,onPick:copyTo})}));
    const left=pack&&h('aside',{ref:leftRef,className:'ap-pack-left','data-selecting':selecting||undefined},
      h(PackKindNav,{manifest:pack.manifest,present,current,onSwitch:switchKind}),
      selbar||h('div',{className:'ap-pack-tools'},h(PackSearchBox,{label:'搜索条目',placeholder:'搜索',value:query,onChange:setQuery}),filterMenu,
        category&&h('span',{className:'ap-category-filter',role:'status'},h('span',null,'标签：'+category),h('button',{type:'button','aria-label':'清除标签筛选 '+category,title:'清除标签筛选',onClick:()=>setCategory('')},h(Glyph,{name:'close'}))),
        h(Button,{className:'ap-icon-button ap-select-toggle','aria-label':'多选',title:'多选',onClick:()=>setSelecting(true)},h(Glyph,{name:'select'})),
        h(AddFilesMenu,{onFiles:addFiles,onGenerate:generateBackground,onStyle:addStyle,onModel:openModelImport,disabled:work.busy})),
      // 演出风格 ends its list with the dashed ＋ (no label), the same row height as an entry.
      // a long list mounts only what is near view (WindowedItems, shared with 设置向导).
      // the list and the opened entry each fail alone (PanelBoundary, §三.38).
      h(PanelBoundary,{name:'entry-list',resetKey:current+'@'+pack.revision},
      shown.length||current==='directions'?h(WindowedItems,{className:'ap-items',blockClassName:'ap-items-block',multi:selecting,label:kinds[current],items:shown,
          render:item=>h(EntryItem,{key:item.id,binding,pack,kind:current,item,focused:!drafting&&selected?.id===item.id,checked:selecting?picked.has(item.id):null,audio,ctx,onSelect:e=>pick(item.id,e),reorder:reorder.row(item.id),
            onLamp:mode=>lampWork.task(()=>commit(current,item.id,c=>setEntryLamp(c,mode)))}),
          tail:current==='directions'&&!selecting&&h('li',{key:'@add',role:'none',className:'ap-item-add-row'},h('button',{type:'button',className:'ap-item-add','aria-label':'新建演出风格',title:'新建演出风格','aria-pressed':drafting,disabled:work.busy,onClick:addStyle},h('span',{className:'ap-item-add-mark'},h(Glyph,{name:'plus'}))))}):
        h(EmptyState,{noun:kinds[current],query,filter:lampFilter!=='all'?ENTRY_LAMPS[lampFilter]:category,onClear:()=>{setQuery('');setFilter('all');setCategory('');}})));
    const narrowBack=narrow?{parent:kinds[current],onBack:()=>setDetail(false)}:null;
    const right=pack&&h('section',{ref:rightRef,className:'ap-pack-right','aria-label':selected?.name||'条目'},
      // on a phone a figure carries its own top bar (‹ + its name + 启用) instead of this row.
      // on a phone the opened entry starts with the shared sub-page ‹ 「返回<kind>」 —
      // in the name row of an entry / style / CG (its name is the page title; cg-editor redesign: a CG has a name row now).
      h(PanelBoundary,{name:'entry-detail',lead:narrowBack&&h('div',{className:'ap-detail-title ap-subhead'},h(SubpageBack,narrowBack)),resetKey:current+'/'+(drafting?'@new':selected?.id||'')+'@'+pack.revision},
      current==='directions'&&(drafting||selected)?h(StyleDetail,{key:drafting?'@new':'directions/'+selected.id,pack,asset:drafting?null:selected,commit,create:createStyle,remove:removeStyle,busy:work.busy,back:narrowBack}):
      !selected?null:current==='figures'?h(FigureDetail,{key:selected.id,binding,pack,figure:selected,commitFigure,assignFigureVoice,commitVoice,importFigureImage,importModel,importFigureSpine,figureActions:figureActions(selected.id),ctx,narrow,onBack:()=>setDetail(false),onClose:close,backLabel:kinds[current],
          gen,importSettei,removeFigureImage,identityBoard:{upload:importIdentitySettei,remove:removeIdentitySettei},tab:figureTab,setTab:setFigureTab,voiceOpen:initial?.tab==='voice'&&selected.id===initial.figureId}):
        current==='cg'?h(CgEntryEditor,{key:current+'/'+selected.id,binding,pack,packs:packs||[],asset:selected,save:saveCg,card:ctx||scope?.ctx||null,back:narrowBack}):
        h(EntryDetail,{key:current+'/'+selected.id,binding,pack,packs,asset:selected,commit,audio,gen,uploadBackground,uploadVariant,card:ctx||scope?.ctx||null,remove:removeEntry,busy:work.busy,back:narrowBack,
          onCategory:path=>{setCategory(path);setSel(selected.id);if(narrow)setDetail(false);},
          onOpenPack:onOpenPack&&((id,k,item)=>{audio.stop();onPacksChanged?.();onOpenPack(id,k,item);})})));
    const empty=pack&&!present.length&&h(EmptyState,{text:'还没有内容',action:h(AddFilesMenu,{onFiles:addFiles,onGenerate:generateBackground,onStyle:addStyle,onModel:openModelImport,label:'添加文件',disabled:work.busy})});
    const busy=work.busy&&h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在处理…');
    const foot=(notice||work.error||lampWork.error||busy||actions.work.error||scope?.error||pack?.diagnostics?.length)&&h('div',{className:'ap-pack-foot'},busy,
      pack?.diagnostics?.map(row=>h('p',{key:JSON.stringify(row.ref),className:'ap-hint-line',role:'status'},h(Glyph,{name:'warning'}),'模组「'+(row.name||row.ref.assetId)+'」不可用：'+row.message+'。请安装新格式发行包；其它素材继续可用。')),
      notice&&h('p',{className:'ap-notice',role:'status'},h('span',null,notice.text),notice.packId&&onOpenPack&&h(Button,{className:'ap-hint-chip',onClick:()=>{audio.stop();onOpenPack(notice.packId);}},'打开')),
      h(ErrorBox,{error:work.error}),h(ErrorBox,{error:lampWork.error}),h(ErrorBox,{error:actions.work.error}),h(ErrorBox,{error:scope?.error}));
    return h(React.Fragment,null,h(Modal,{title:name,onClose:close,className:'ap-pack-modal',head,foot,initialFocus:'dialog',frame:pack?{...packDrop,onKeyDown:selectKeys}:undefined},
      !pack?(state.error?h(ErrorBox,{error:state.error,reload:state.reload}):h(Loading,{lead:true,count:8,className:'ap-pack-loading'})):empty||h('div',{className:'ap-pack-cols','data-kind':current||undefined,'data-detail':narrow&&detail&&!selecting||undefined},left,right)),
      actions.dialogs,
      pack&&gen.sheet&&h(GenSheet,{key:gen.sheet.id,gen,binding,pack,importSettei}),
      pack&&gen.dialog&&h(GenDialog,{key:gen.dialog.id,gen,binding,pack,commitFigure,importSettei,saveStyle}),gen.dialogs,
      pack&&modelImport&&h(ModelImportSheet,{binding,pack,pending:modelImport.pending,onClose:()=>setModelImport(null),onImport:importModelHere}),
      pack&&tagSheet&&h(TagIconsSheet,{binding,pack,save:saveTagIcons,upload:uploadTagIcon,onClose:()=>setTagSheet(false)}));
  }
  // 素材包 ⋯ › 标签图标. An 物品 without its own picture shows the icon of its deepest
  // tag from the same pack (assetTags.icon); the icons travel with the pack. The strip is one chip per icon (picture · tag)
  // and a dashed ＋ that picks an image first and names it after the pack's most used tag still without an icon; the
  // chosen chip's 标签 / 图标 rows sit under the strip; ⋯ › 删除… is the shared multi-select (§三.15).
  function packTagChoices(manifest) {
    const counts=new Map();
    for(const asset of manifest.assets||[])if(asset.kind!=='sfx')for(const tag of assetTags.ancestors(asset.category))counts.set(tag,(counts.get(tag)||0)+1);
    return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh')).map(([tag])=>tag);
  }
  function TagIconsSheet({binding,pack,save,upload,onClose}) {
    const packId=pack.manifest.id,icons=pack.manifest.tagIcons||[],[selected,setSelected]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    const [confirm,setConfirm]=React.useState(null),pick=useSelection(),input=React.useRef(null),target=React.useRef(null);
    const row=icons.find(icon=>icon.tag===selected),free=packTagChoices(pack.manifest).filter(tag=>!icons.some(icon=>icon.tag===tag));
    const run=async job=>{setBusy(true);setError('');try{return await job();}catch(e){setError(errorText(e));return null;}finally{setBusy(false);}};
    const newTag=()=>{if(free[0])return free[0];let name='新标签',n=2;while(icons.some(icon=>icon.tag===name))name='新标签 '+n++;return name;};
    const choose=tag=>{target.current=tag;input.current?.click?.();};
    const onFile=file=>{const tag=target.current;target.current=null;run(async()=>{await upload(tag,file);setSelected(tag);});};
    const rename=value=>{const tag=assetTags.normalize([value])[0]||'';if(!tag||tag===row.tag)return;run(()=>save(list=>list.map(icon=>icon.tag===row.tag?{...icon,tag}:icon))).then(done=>{if(done)setSelected(tag);});};
    const tagProblem=value=>{const tag=assetTags.normalize([value])[0]||'';return !tag?'请填写标签':[...tag].length>120?'标签最多 120 字':tag!==row?.tag&&icons.some(icon=>icon.tag===tag)?'这个标签已有图标':'';};
    const action=pick.on?h(SelectBar,{count:pick.ids.size,action:'删除',danger:true,busy,onCancel:pick.stop,
        onAction:()=>setConfirm({title:'删除所选标签图标？',body:'物品和它们的标签保留；没有自己图片的物品改用上一级标签的图标或只显示文字。',confirmLabel:'删除',danger:true,
          onConfirm:async()=>{const gone=pick.ids;await run(()=>save(list=>list.filter(icon=>!gone.has(icon.tag))));pick.stop();setSelected(null);}})}):
      h(Popover,{label:'标签图标操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'标签图标更多操作','aria-expanded':open,onClick:toggle}),
        content:close=>h(MenuItem,{disabled:!icons.length||busy,onClick:()=>{close();setSelected(null);pick.start();}},'删除…')});
    return h(CatSheet,{title:'标签图标',className:'ap-tag-icons-sheet',onClose:()=>{if(pick.on)pick.stop();else onClose();},busy,headTools:action},
      h('div',{className:'ap-tag-icons',role:'group','aria-label':'标签图标',onKeyDown:e=>{if(e.key==='Escape'&&pick.on){e.stopPropagation();pick.stop();}}},
        icons.map(icon=>h('button',{key:icon.tag,type:'button',className:'ap-mod-chip ap-tag-icon-chip',disabled:busy,'aria-pressed':pick.on?undefined:selected===icon.tag,
          role:pick.on?'checkbox':undefined,'aria-checked':pick.on?pick.has(icon.tag):undefined,title:icon.tag,
          onClick:()=>pick.on?pick.flip(icon.tag):setSelected(selected===icon.tag?null:icon.tag)},
          h(Thumb,{binding,packId,hash:icon.media,label:icon.tag,className:'ap-mod-chip-art'}),h('span',{className:'ap-tag-icon-name'},icon.tag))),
        !pick.on&&icons.length<256?h(CatAddTile,{label:'添加标签图标',className:'ap-mod-chip-add',onClick:()=>{if(!busy)choose(newTag());}}):null),
      !icons.length?h(EmptyState,{compact:true,text:'还没有标签图标'}):null,
      !pick.on&&row?h(InlineGrid,{key:row.tag,label:row.tag,columns:1,className:'ap-tag-icon-fields'},
        h(InlineField,{kind:'text',label:'标签',value:row.tag,maxLength:120,disabled:busy,validate:tagProblem,onCommit:rename}),
        h(InlineRow,{label:'图标'},h(Button,{className:'ap-inline-link',disabled:busy,onClick:()=>choose(row.tag)},h(Glyph,{name:'upload'}),'换图'))):null,
      busy?h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在保存…'):null,
      h(ErrorBox,{error}),
      h('input',{ref:input,type:'file',hidden:true,tabIndex:-1,accept:'image/png,image/webp,image/jpeg',onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file);else target.current=null;}}),
      confirm?h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)}):null);
  }
  // the kinds present in the pack as one underline tab strip. (figure-editor
  // r6): names only — no superscript counts on the tabs or in 「更多」 (the list itself shows how many).
  // Kinds that do not fit the column go into 「更多」; the current kind always shows (kept in order, so a late kind takes the
  // last slot). Every tab stays rendered so it can be measured; overflowed ones are invisible. Arrow keys / Home / End
  // walk all present kinds (automatic activation); the menu walks with ↑↓.
  const fitKinds=(present,current,box)=>{
    if(!box)return present;const w=k=>box.widths[k]||0;if(present.reduce((s,k)=>s+w(k),0)<=box.avail)return present;
    let used=w(current)+box.more;const keep=new Set([current]);
    for(const k of present){if(k===current)continue;if(used+w(k)>box.avail)break;keep.add(k);used+=w(k);}
    return present.filter(k=>keep.has(k));
  };
  function PackKindNav({manifest,present,current,onSwitch}) {
    const ref=React.useRef(null),refocus=React.useRef(false),[box,setBox]=React.useState(null),label=k=>kinds[k];
    (React.useLayoutEffect||React.useEffect)(()=>{const el=ref.current;if(!el||typeof ResizeObserver==='undefined')return;
      const measure=()=>{const widths={};for(const t of el.querySelectorAll('[data-kind]'))widths[t.dataset.kind]=t.offsetWidth;
        const next={avail:el.clientWidth,more:el.querySelector('.ap-kind-more')?.offsetWidth||60,widths};setBox(b=>JSON.stringify(b)===JSON.stringify(next)?b:next);};
      measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect();},[present.join()]);
    React.useEffect(()=>{if(refocus.current){refocus.current=false;ref.current?.querySelector('[role=tab][aria-selected=true]')?.focus();}},[current]);
    const go=k=>{refocus.current=true;onSwitch(k);};
    const keys=e=>{const i=present.indexOf(current),n=present.length,step={ArrowRight:1,ArrowLeft:-1,Home:-i,End:n-1-i}[e.key];if(step===undefined)return;e.preventDefault();go(present[(i+step+n)%n]);};
    const shown=fitKinds(present,current,box),hidden=present.filter(k=>!shown.includes(k));
    // a window with one tab has nothing to switch — no tab row, no divider;
    // the content starts right under the header.
    if(present.length<2)return null;
    return h('div',{ref,className:'ap-pack-kinds'},
      h('div',{role:'tablist','aria-label':'素材分类',className:'ap-kind-tabs-line',onKeyDown:keys},present.map(k=>h('button',{key:k,type:'button',role:'tab','data-kind':k,
        'data-overflow':hidden.includes(k)||undefined,'aria-selected':k===current,tabIndex:k===current?0:-1,'aria-label':label(k),onClick:()=>onSwitch(k)},h('span',null,kinds[k])))),
      h(Popover,{label:'更多分类',className:'ap-kind-more-anchor'+(hidden.length?'':' is-idle'),
        trigger:({toggle,open})=>h('button',{type:'button',className:'ap-kind-more','aria-haspopup':'menu','aria-expanded':open,tabIndex:hidden.length?0:-1,onClick:toggle},'更多',h(Glyph,{name:'chevDown'})),
        content:close=>h(KindMenu,{list:hidden,label,onPick:k=>{close();go(k);}})}));
  }
  function KindMenu({list,label,onPick}) {
    const ref=React.useRef(null);
    React.useEffect(()=>{ref.current?.querySelector('button')?.focus();},[]);
    const move=e=>{const items=[...ref.current.querySelectorAll('button')],i=items.indexOf(document.activeElement),n=items.length,next={ArrowDown:i+1,ArrowUp:i-1,Home:0,End:n-1}[e.key];if(next===undefined)return;e.preventDefault();items[(next+n)%n].focus();};
    return h('div',{ref,className:'ap-kind-menu',onKeyDown:move},list.map(k=>h('button',{key:k,type:'button',role:'menuitem','aria-label':label(k),className:'ap-menu-item ap-kind-option',onClick:()=>onPick(k)},
      h('span',null,kinds[k]))));
  }
  // Category glyphs for the pack navigation (the old 素材库 rail had one per kind).
  const kindGlyphs={timers:'M8 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM6.5 1.5h3M8 4V2M8 9V6.5M12 4.5l1-1',audience:'M2.5 3h11v8h-7l-3 2v-2h-1zM5 6h6M5 8h4',backgrounds:'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3',music:'M6 12.5V4l7-1.5V11M6 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM13 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',sfx:'M3 8h1.5M6 5v6M8.5 3v10M11 5.5v5M13.5 7v2',ambience:'M2 6.5c2-1.5 4-1.5 6 0s4 1.5 6 0M2 10c2-1.5 4-1.5 6 0s4 1.5 6 0',looks:'M8 2.5l1.4 3.6 3.6 1.4-3.6 1.4L8 12.5l-1.4-3.6L3 7.5l3.6-1.4z',widgets:'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z',figures:'M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.5 13.5c.6-2.6 2.3-4 4.5-4s3.9 1.4 4.5 4',
    // packs-v3: 舞台皮肤 (a screen with a dialogue box) and 演出 (a clapperboard) were missing.
    skins:'M3 2.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5zM4.5 9h7v3h-7zM4.5 5h3',performances:'M2.5 7h11v6.5h-11zM2.5 7 3.6 3.4l9.6 1.2L12.8 7M6.3 3.8 5.4 7M9.8 4.2 9 7',
    // 演出风格 — the director's megaphone.
    directions:'M2.5 6.2h2.2l6.3-3.2v10l-6.3-3.2H2.5zM4.7 9.8l1 3.4M13 6.5v3',
    // 入场演出: a point of light inside the rings of a tunnel.
    entrances:'M8 9.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zM8 12.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1',
    // 视频: a film frame with a play triangle.
    videos:'M2 3.5h12v9H2zM2 5.5h12M2 10.5h12M6.8 6.6v2.8L9.2 8z'};
  function KindIcon({kind}) { return h('svg',{className:'ap-kind-icon',width:16,height:16,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},h('path',{d:kindGlyphs[['cg','props'].includes(kind)?'backgrounds':kind],stroke:'currentColor',strokeWidth:1.2,strokeLinecap:'round',strokeLinejoin:'round'})); }
  // @include widget-settings-ui.js
  // @include asset-pack-entry-ui.js
  // @include-stage-source asset-pack-gen-ui.js
  // @include asset-pack-cg-ui.js
  // @include asset-pack-figure-ui.js
  // @include asset-pack-spine-ui.js
  // @include asset-pack-import-ui.js
  // @include asset-pack-voice-ui.js
  // @include-stage-source asset-pack-card-ui.js
  // @include asset-pack-opening-ui.js
  // @include asset-pack-catalogue-ui.js
  // @include asset-pack-setup-ui.js
  // @include asset-pack-character-ui.js
  const prepareImage = prepareImageOverride || browserPrepareImage;
  // @include-stage-source asset-pack-engine-ui.js
  // @include mod-library.js
  // 素材库 manages packs only; the per-card page lives in the Tavern 舞台 tab (StagePanel).
  // packs-v3: the tab is only the pack list; a pack opens the shared modal. A deep link from 舞台设置 or the character
  // window (props.nav.take()) opens the modal at that pack / kind / figure. No basic/advanced split.
  function App(props) {
    const [open,setOpen]=React.useState(null),[filter,setFilter]=React.useState(null),[available,setAvailable]=React.useState(true);
    const binding=props.binding;
    React.useEffect(()=>{setAvailable(true);if(props.enabled===true)return binding?.onUnavailable?.(()=>setAvailable(false));},[binding,props.enabled]);
    React.useEffect(()=>{if(props.enabled!==true||!props.nav)return;const consume=()=>{const next=props.nav.take();if(!next)return;setFilter({kind:next.kind||''});setOpen(next.packId?{...next,at:Date.now()}:null);};consume();return props.nav.subscribe(consume);},[props.nav,props.enabled]);
    if(props.enabled!==true)return null;
    if(!available||!binding?.service||binding.service.apiVersion!==2)return h('section',{className:'ap-ui',role:'status'},h('p',{className:'ap-empty'},'素材插件不可用'));
    return h('div',{className:'ap-ui ap-library'},
      h('header',{className:'ap-head'},h('h2',null,'舞台素材')),
      h(Home,{binding,open,onOpen:setOpen,sessionId:props.sessionId,cardPath:props.cardPath,cardStamp:props.cardStamp,filter}));
  }
  return {App,Home,StageSection,KIND_ORDER,kinds,ModDetail,StageModSection,StageModPage,ModManagerEntry,PackModal,PackRow,PackStateTag,EntryDetail,FigureDetail,applyEntryFields,splitKeywords,StagePanel,StagePage,EnginePage,ReadingsEditor,ConflictDialog,CardImportSheet,CardUrlSheet,
    // 设置 → 舞台 → 素材生图 (asset-launcher.js registers the section).
    GenPromptSettings,
    // the manager and the card's mod section, for tests and the offline screenshot harness.
    mods:{ModManager,ManagedModSection,modSwitchWord},
    // the sheets, for tests and the offline screenshot harness.
    catalogue:{PackGetSheet,CatalogueSourcesSheet,CatalogueUpdateSheet,CatalogueJobSheet,startCatalogueDownload},
    // entering 舞台模式 opens 设置向导 once per card (stageSetupGate).
    stageSetup,
    stage:{openingPatch,openingPreview,directorPromptRows,directorWire,directorPieceName,directorPromptRow,promptToolDefs,PromptOps,PromptPieces,PromptCatalogue,catalogueEntries,commandInfo,PromptTools,PromptAt,promptHeadClick,promptJson,promptJsonText,judgePromptRows,judgeWithProvider,judgeDraftProblem,promptTokenEstimate,storyPromptRows,promptSources,promptPackScope,stagePrefs,stageActive,stagePatch,stageEnable,stageMissing,unbindPatch,writeStageReturn,simpleSpriteImages,replaceOutfitSprite,emotionSlot,RETURN_KEY:STAGE_RETURN_KEY}};
}
