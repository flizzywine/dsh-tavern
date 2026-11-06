// 素材库 「获取素材包」 (one compact dialog: link · ZIP · the catalogue rows, get packs) · 目录来源 · 更新, plus the one install sheet every single-pack install uses
// (a download or a local ZIP; a card ZIP has CardImportSheet). Every call goes through the authenticated v2
// control port (binding.service); a finished download is only a preview, so nothing is bound or enabled automatically.
// Remote preview images are never loaded (there is no restricted image proxy yet): a pack's 「封面」 is its type icon on a
// soft tint picked from its name. Identity comes only from the host's `official` flag — catalogue titles are display text.
// r2 (owner review 「重点不突出，大量文字，文案也看不懂」): one focal point per screen, plain words for people without a
// technical background, expert facts behind a quiet 「详情」; no hashes, ids, paths, card counts or +/改/删 ledgers.
// Widget risk belongs to card import (owner decision), so a pack install never opens a blocking risk dialog.
// r3 brevity pass (owner: 「不要一件事重复说」): no sentence repeats another on the same screen — a list says no count of
// itself, a button does not repeat the warning above it, 「详情」 does not repeat what the hero already shows.
// Included inside createAssetPackUI (shares h, Modal, Button, Glyph, Popover, ConflictDialog, useTask, Row …).
Object.assign(glyphs,{
  link:'M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-1 1M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l1-1',
  catalogue:'M2.5 3.5h4a1.5 1.5 0 0 1 1.5 1.5v8.5a1.2 1.2 0 0 0-1.2-1.2H2.5zM13.5 3.5h-4A1.5 1.5 0 0 0 8 5v8.5a1.2 1.2 0 0 1 1.2-1.2h4.3z',
  refresh:'M12.8 6.2A5 5 0 1 0 13 9.5M13 3v3.2H9.8',sources:'M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 3v3M6 10v3',
  pause:'M5.5 3.5v9M10.5 3.5v9',arrow:'M3 8h10M9.5 4.5 13 8l-3.5 3.5',
  // 获取素材包 — an arrow into a tray.
  download:'M8 2.5v7.5M5 7l3 3 3-3M3 11.5v2h10v-2',
  // r2: the generic 「封面」 of a pack whose contents are not known yet (a link, a catalogue entry).
  package:'M2.5 5.2 8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7zM2.5 5.2 8 7.9l5.5-2.7M8 7.9v5.6M5.2 3.85l5.5 2.75'});
// The host exposes the catalogue only with its capability; older hosts keep the library exactly as before.
const catalogueReady=binding=>typeof binding?.service?.startPackDownload==='function'&&(binding.service.capabilities||[]).includes('url-install');
const catBytes=n=>{if(!Number.isFinite(n)||n<0)return '';const units=['B','KB','MB','GB'];let i=0,v=n;while(v>=1024&&i<units.length-1){v/=1024;i++;}return (i?v.toFixed(v<10?1:0):String(v))+' '+units[i];};
const catHost=url=>{try{return new URL(url).host;}catch(_){return '';}};
// The host accepts absolute HTTPS without credentials or a fragment; the fragment is dropped here so the confirmed URL
// is exactly the one the host downloads.
const catHttps=value=>{let url;try{url=new URL(String(value||'').trim());}catch(_){return null;}if(url.protocol!=='https:'||url.username||url.password)return null;url.hash='';return url.href;};
const catFileLabel=url=>{try{const name=decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()||'');return name||catHost(url);}catch(_){return catHost(url)||'素材包';}};
const catVersion=v=>/^(\d+)\.(\d+)\.(\d+)/.exec(String(v||''))?.slice(1).map(Number);
const catCompare=(a,b)=>{const x=catVersion(a),y=catVersion(b);if(!x||!y)return 0;for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;};
const catTime=ms=>{const d=new Date(ms);if(!Number.isFinite(d.getTime()))return '';const p=n=>String(n).padStart(2,'0');return (d.getMonth()+1)+'月'+d.getDate()+'日 '+p(d.getHours())+':'+p(d.getMinutes());};
// r2 copy: short sentences, no 摘要 / 校验 / SHA / 沙箱 wording. One place, so every screen says the same thing.
// The widget term is 模组 (owner); a risk sentence always ends in an explicit instruction (「请仅…」/「请只…」).
const CAT_TEXT={
  unofficial:'这个素材包来自非官方来源，无法确认作者。请只安装你信任的人分享的素材包。',
  unofficialCatalogue:'这是非官方目录，无法确认作者。请只安装你信任的人分享的素材包。',
  // Owner rule: risk copy states the risk and gives an explicit 「请仅…」/「请只…」 instruction.
  widgetRisk:'第三方模组可能有安全风险，请仅启用值得信赖的模组。',
  stale:'这个素材包刚在别处被改过。为了不覆盖那些改动，这次没有更新。',
  noFingerprint:'没有提供，只能检查文件本身是否完好'};
const CAT_ERRORS={DOWNLOAD_FAILED:'下载失败。请检查网络后重试，或换一个下载源',INTEGRITY_MISMATCH:'下载到的文件和发布的不一样，可能已损坏或被改动过，不能安装',
  LIMIT_EXCEEDED:'文件太大，或者磁盘空间不够',ASSET_UNAVAILABLE:'这个下载已经失效，请重新开始',INVALID_INPUT:'链接无效：只支持 https:// 开头的链接',
  INVALID_PATH:'这个文件不是有效的素材包，不能安装',FILE_CLOSURE_MISMATCH:'素材包里缺少文件，不能安装',SETTINGS_UNAVAILABLE:'设置暂时读不到，请稍后再试',
  REVISION_CONFLICT:'目录刚刚更新过，请再看一眼后安装',SCRIPT_CONFIRMATION_REQUIRED:'安装没有完成，请再试一次'};
// Through the shared playerErrorText (a transport message that is just the code counts as the code); the catalogue's
// tasks (useTask) say their failures with it too.
const catErrorText=error=>playerErrorText(error,{codes:CAT_ERRORS});
const JOB_LABELS={queued:'准备下载',downloading:'下载中',paused:'已暂停',verifying:'正在检查文件',ready:'下载完成',installing:'正在安装',completed:'已安装',failed:'下载失败',cancelled:'已取消'};
const JOB_ACTIVE=new Set(['queued','downloading','paused','verifying']);

// What is inside a pack, in words: 「3 张背景 · 1 段环境音 · 1 个模组」 (kind order of the library, at most four kinds).
const CAT_MEASURES={figures:['个','人物'],backgrounds:['张','背景'],cg:['张',' CG'],props:['张','物品'],music:['首','音乐'],sfx:['个','音效'],ambience:['段','环境音'],
  looks:['个','滤镜'],performances:['个','演出组合'],skins:['套','舞台皮肤'],entrances:['个','入场演出'],widgets:['个','模组'],directions:['条','演出风格']};
const catCounts=manifest=>KIND_ORDER.map(kind=>[kind,manifest?kindCount(manifest,kind):0]).filter(([,n])=>n>0);
function catContents(manifest) {
  const parts=catCounts(manifest).map(([kind,n])=>n+' '+CAT_MEASURES[kind][0]+CAT_MEASURES[kind][1]);
  return parts.slice(0,4).join(' · ')+(parts.length>4?' 等':'');
}
// The kind the 封面 shows: the most numerous one (人物 first on ties, the library's order).
const catLeadKind=manifest=>catCounts(manifest).reduce((best,row)=>!best||row[1]>best[1]?row:best,null)?.[0]||null;
// 详情 contents: item names per kind (never ids or file paths).
function catContentRows(manifest,figures) {
  return catCounts(manifest).map(([kind,n])=>{
    const names=kind==='figures'?(manifest.figures||[]).map(id=>figures?.[id]?.name).filter(Boolean):(manifest.assets||[]).filter(a=>a.kind===kind).map(a=>a.name).filter(Boolean);
    return [kind,names.length?names.slice(0,8).join('、')+(n>8?' 等 '+n+' 项':''):n+' 项'];
  });
}
// A soft tint per pack, picked from its name, so the same pack looks the same in the catalogue, the download and the install.
const CAT_TINTS=['#e2789b','#9a7ce0','#4f95e3','#35ad8f','#ec9152','#d6a326','#3aa5bf','#c46acc'];
const catTint=name=>{let x=7;for(const ch of String(name||''))x=(x*31+ch.codePointAt(0))>>>0;return CAT_TINTS[x%CAT_TINTS.length];};

// One small store per service (the transport outlives a library mount): settings, fetched catalogues, the update check
// and download jobs. A job keeps running when its sheet is closed; the library lists it until it is installed or dropped.
const catalogueStores=new WeakMap();
function catalogueStore(service) {
  let store=catalogueStores.get(service);if(store)return store;
  const listeners=new Set();
  store={settings:null,settingsError:null,catalogues:new Map(),updates:null,updatesAt:0,updating:null,jobs:new Map(),timer:null,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},emit(){for(const fn of [...listeners])fn();}};
  catalogueStores.set(service,store);return store;
}
function useCatalogueStore(binding) {
  const store=catalogueStore(binding.service),[,bump]=React.useState(0);
  React.useEffect(()=>store.subscribe(()=>bump(n=>n+1)),[store]);
  return store;
}
async function loadCatalogueSettings(binding) {
  const store=catalogueStore(binding.service);
  try{store.settings=await binding.service.catalogueSettings({});store.settingsError=null;}catch(error){store.settingsError=error;throw error;}finally{store.emit();}
  return store.settings;
}
// Every change is one CAS write of the whole section. A conflict reloads and asks for the action again (never merges).
async function saveCatalogueSettings(binding,make) {
  const store=catalogueStore(binding.service),current=store.settings||await loadCatalogueSettings(binding),next=make(current.values);
  try{
    store.settings=await binding.service.saveCatalogueSettings({expectedRevision:current.revision,
      sources:next.sources.map(s=>({...(s.sourceId?{sourceId:s.sourceId}:{}),url:s.url,enabled:s.enabled})),preferredDownloadId:next.preferredDownloadId||'',mirrorPrefix:next.mirrorPrefix||''});
    for(const id of [...store.catalogues.keys()])if(!store.settings.values.sources.some(s=>s.sourceId===id))store.catalogues.delete(id);
    store.emit();return store.settings;
  }catch(error){
    if(error?.code!=='REVISION_CONFLICT')throw error;
    await loadCatalogueSettings(binding).catch(()=>{});
    throw Object.assign(new Error('来源设置刚在别处改过，已重新载入；请再操作一次'),{code:'SETTINGS_CONFLICT'});
  }
}
// `curated` reads the official source's 精选 entries (same catalogue, same rows), kept apart.
const catalogueKey=(sourceId,curated)=>curated?sourceId+'\n精选':sourceId;
async function refreshCatalogueSource(binding,sourceId,curated=false) {
  const store=catalogueStore(binding.service),key=catalogueKey(sourceId,curated),prior=store.catalogues.get(key);
  store.catalogues.set(key,{...prior,loading:true});store.emit();
  try{store.catalogues.set(key,{value:await binding.service.refreshCatalogue(curated?{sourceId,curated:true}:{sourceId})});}
  catch(error){store.catalogues.set(key,{value:prior?.value,error});}
  finally{store.emit();}
  return store.catalogues.get(key);
}
// The update check refreshes every subscribed source on the host, so the library runs it at most every 30 minutes.
function checkCatalogueUpdates(binding,{force=false}={}) {
  const store=catalogueStore(binding.service);
  if(store.updating)return store.updating;
  if(!force&&store.updates&&Date.now()-store.updatesAt<30*60*1000)return Promise.resolve(store.updates);
  store.updating=binding.service.checkPackUpdates({}).then(value=>{store.updates=value;store.updatesAt=Date.now();return value;},()=>store.updates).finally(()=>{store.updating=null;store.emit();});
  store.emit();return store.updating;
}
// Jobs are polled every ~700 ms (contract: 500–1000 ms) until ready or terminal.
function pollCatalogueJobs(binding) {
  const store=catalogueStore(binding.service);if(store.timer)return;
  const live=()=>[...store.jobs.values()].filter(e=>JOB_ACTIVE.has(e.job?.state));
  const tick=async()=>{
    await Promise.all(live().map(async entry=>{try{entry.job=await binding.service.getPackDownload({jobId:entry.jobId});}
      catch(error){entry.job={...entry.job,state:'failed',error:{code:error?.code||'ASSET_UNAVAILABLE',message:''}};entry.lost=true;}}));
    store.emit();store.timer=live().length?setTimeout(tick,binding.downloadPollMs||700):null;store.timer?.unref?.();
  };
  store.timer=setTimeout(tick,0);store.timer?.unref?.();
}
async function startCatalogueDownload(binding,entry) {
  const {jobId}=await binding.service.startPackDownload(entry.input),store=catalogueStore(binding.service);
  store.jobs.set(jobId,{...entry,jobId,job:{jobId,state:'queued',receivedBytes:0,totalBytes:entry.size||null,speed:0}});
  store.emit();pollCatalogueJobs(binding);return jobId;
}
async function controlCatalogueDownload(binding,jobId,action) {
  const store=catalogueStore(binding.service),entry=store.jobs.get(jobId);
  const job=await binding.service.controlPackDownload({jobId,action});
  if(entry)entry.job=job;store.emit();if(action==='resume')pollCatalogueJobs(binding);
  return job;
}
function forgetCatalogueDownload(binding,jobId) { const store=catalogueStore(binding.service);if(store.jobs.delete(jobId))store.emit(); }

// ---------- small pieces ----------
// Chips: 官方 (blue) / 非官方 (neutral) / ⚠ real warnings / installed (green) / update (blue). No ids, no counts.
function CatChip({tone='plain',icon,title,children}) {
  return h('span',{className:'ap-cat-chip','data-tone':tone,title},icon&&h(Glyph,{name:icon}),h('span',null,children));
}
const CatWarn=({children,title})=>h(CatChip,{tone:'warn',icon:'warning',title},children);
function CatOrigin({official}) { return official?h(CatChip,{tone:'official',icon:'check',title:'应用内置的官方目录'},'官方'):h(CatChip,{tone:'unofficial',title:'不是官方目录，无法确认作者'},'非官方'); }
// The 「添加」 language of the editor: a dashed outline with ＋, no text (the name is the tooltip and the accessible label).
function CatAddTile({label,onClick,className=''}) { return h('button',{type:'button',className:('ap-cat-add '+className).trim(),'aria-label':label,title:label,onClick},h(Glyph,{name:'plus'})); }
// A styled single choice (button + menu of radios), the library's replacement for a native select.
function CatSelect({label,value,options,onChange,disabled}) {
  const current=options.find(o=>o.value===value)||options[0];
  return h(Popover,{label,fit:true,className:'ap-cat-select-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-cat-select','aria-haspopup':'menu','aria-expanded':open,'aria-label':label+'：'+(current?.label||''),disabled,onClick:toggle},
      h('span',{className:'ap-cat-select-text'},h('span',null,current?.label||''),current?.hint&&h('small',null,current.hint)),h(Glyph,{name:'chevDown'})),
    content:close=>options.map(o=>h('button',{key:o.value,type:'button',role:'menuitemradio','aria-checked':o.value===current?.value,className:'ap-menu-item ap-cat-option',onClick:()=>{close();if(o.value!==current?.value)onChange(o.value);}},
      h('span',{className:'ap-cat-select-text'},h('span',null,o.label),o.hint&&h('small',null,o.hint)),o.value===current?.value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// The shared sheet: a dialog on PC, a full-screen sheet with fixed bottom actions on phones (CSS). Header with title and ×.
function CatSheet({title,className='',onClose,busy,foot,children,initialFocus='control',headTools,frame}) {
  return h(Modal,{title,onClose,busy,className:('ap-cat-sheet '+className).trim(),initialFocus,frame,
    head:h('header',{className:'ap-cat-head'},h('h2',null,title),h('span',{className:'ap-cat-head-tools'},headTools,h(IconButton,{icon:'close',label:'关闭',disabled:busy,onClick:onClose}))),
    foot:foot&&h('footer',{className:'ap-cat-foot'},foot)},children);
}
// r2 focal point: the pack's 封面 (type icon on its tint, a second card peeking behind), its name and one plain line.
function CatArt({name,kind,size}) {
  return h('span',{className:'ap-cat-art','data-size':size||undefined,style:{'--ap-cat-tint':catTint(name)},'aria-hidden':true},
    kind&&kind!=='package'?h(KindIcon,{kind}):h(Glyph,{name:'package'}));
}
function CatHero({name,art,kind,row,children}) {
  return h('div',{className:'ap-cat-hero','data-row':row||undefined},h(CatArt,{name:art||name,kind,size:row?'row':undefined}),
    h('div',{className:'ap-cat-hero-text'},h('h3',{className:'ap-cat-hero-name'},name),children));
}
const CatSub=({className='',children})=>h('p',{className:('ap-cat-hero-sub '+className).trim()},children);
// The one warning surface: a soft amber band (no chip, no box inside it). `compact` drops the band for list headers.
function CatBand({children,list,compact,role}) {
  return h('div',{className:'ap-cat-band','data-compact':compact||undefined,role},h('span',{className:'ap-cat-band-mark','aria-hidden':true},h(Glyph,{name:'warning'})),
    h('div',{className:'ap-cat-band-text'},h('p',null,children),list||null));
}
function CatNote({icon,kind,children}) {
  return h('p',{className:'ap-cat-note'},h('span',{className:'ap-cat-note-mark','aria-hidden':true},kind?h(KindIcon,{kind}):h(Glyph,{name:icon||'check'})),h('span',null,children));
}
// A quiet disclosure for expert facts (exact link, catalogue 文件指纹, contents). Collapsed by default; the facts are not rendered
// until it opens, so nothing technical is in the way of a normal install.
function CatMore({label='详情',defaultOpen=false,children}) {
  const [open,setOpen]=React.useState(defaultOpen),id='ap-cat-more-'+React.useId();
  return h('div',{className:'ap-cat-more','data-open':open||undefined},
    h('button',{type:'button',className:'ap-cat-more-toggle','aria-expanded':open,'aria-controls':id,onClick:()=>setOpen(!open)},h('span',null,label),h(Glyph,{name:'chevDown'})),
    open&&h('div',{id,className:'ap-cat-more-body'},children));
}
const CatFacts=({children})=>h('dl',{className:'ap-cat-facts'},children);
const CatFact=({label,children})=>h('div',{className:'ap-cat-fact'},h('dt',null,label),h('dd',null,children));
const CatUrl=({url})=>h('code',{className:'ap-cat-url'},url);
// A short list of item names (kind icon + name) inside a band: only things the user would lose.
function CatItems({items}) {
  const shown=items.slice(0,10);
  return h('ul',{className:'ap-cat-items'},shown.map((item,i)=>h('li',{key:i},item.kind&&h(KindIcon,{kind:item.kind}),h('span',null,item.name))),
    items.length>shown.length&&h('li',{className:'is-more'},'等 '+items.length+' 项'));
}
const catBusyLabel=(busy,label)=>busy?h(React.Fragment,null,h(Spinner),label):label;

// ---------- library entry points (download tray, update chips, the sheets) ----------
// Home calls this once; without the capability every piece is null and the library is unchanged.
// the catalogue is listed inside the one 「获取素材包」 dialog (PackGetSheet,
// owned by Home); this hook keeps the layers on top of it — 目录来源, 更新, the download sheet — and the tray / chips.
// `installed` is the one place an install finishes (reload, update check, 「已安装」 notice); PackGetSheet reuses it.
function useCatalogue(binding,{packs,reload,openPack}) {
  const ready=catalogueReady(binding),[view,setView]=React.useState(null),[job,setJob]=React.useState(null),[notice,setNotice]=React.useState(null);
  const store=ready?catalogueStore(binding.service):null,[,bump]=React.useState(0);
  React.useEffect(()=>store?.subscribe(()=>bump(n=>n+1)),[store]);
  // Installed packs with a catalogue origin are checked quietly; the chip appears only for a newer version.
  const tracked=ready&&(packs||[]).some(p=>p.distribution?.sourceId);
  React.useEffect(()=>{if(tracked)checkCatalogueUpdates(binding);},[tracked,binding]);
  React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(null),8000);return()=>clearTimeout(t);},[notice]);
  if(!ready)return {ready:false,openJob:()=>{},openSources:()=>{},installed:()=>reload(),tray:null,badge:()=>null,layer:null};
  const updates=new Map((store.updates?.updates||[]).map(u=>[u.packId,u]));
  const installed=(result,entry)=>{setJob(null);setView(null);reload();checkCatalogueUpdates(binding,{force:true});
    const id=result?.snapshot?.manifest?.id;setNotice({text:'已安装「'+(result?.snapshot?.manifest?.name||entry?.label||'素材包')+'」',packId:id});};
  const entries=[...store.jobs.values()].filter(e=>e.jobId!==job);
  const tray=(entries.length>0||notice)&&h('div',{className:'ap-cat-tray'},
    entries.length>0&&h('ul',{className:'ap-cat-jobs','aria-label':'下载任务'},entries.map(e=>h(CatJobRow,{key:e.jobId,entry:e,onOpen:()=>setJob(e.jobId)}))),
    notice&&h('p',{className:'ap-notice',role:'status'},h(Glyph,{name:'check'}),h('span',null,notice.text),notice.packId&&openPack&&h(Button,{className:'ap-hint-chip',onClick:()=>{setNotice(null);openPack(notice.packId);}},'打开')));
  const badge=id=>{const u=updates.get(id);if(!u)return null;
    if(u.status==='update')return h(Button,{className:'ap-cat-update-chip',title:'有新版本 '+u.nextVersion,'aria-label':'更新 '+((packs||[]).find(p=>p.manifest.id===id)?.manifest.name||'素材包'),onClick:()=>setView({type:'update',packId:id,sourceId:u.sourceId})},h(Glyph,{name:'arrow'}),'可更新');
    if(u.status==='release-changed')return h('span',{className:'ap-hint-mark',role:'img','aria-label':'暂时无法更新',title:'发布者换了文件却没有改版本号，暂时无法更新'},h(Glyph,{name:'warning'}));
    return null;};
  const started=jobId=>{setView(null);setJob(jobId);};
  const layer=h(React.Fragment,null,
    view?.type==='sources'&&h(CatalogueSourcesSheet,{binding,adding:!!view.add,onClose:()=>setView(null)}),
    view?.type==='update'&&h(CatalogueUpdateSheet,{binding,packs,packId:view.packId,sourceId:view.sourceId,onClose:()=>setView(null),onStarted:started}),
    job&&h(CatalogueJobSheet,{key:job,binding,jobId:job,onClose:()=>setJob(null),onInstalled:installed,onRetry:next=>setJob(next)}));
  return {ready:true,openJob:setJob,openSources:add=>setView({type:'sources',add:!!add}),installed,tray,badge,layer};
}
function CatJobRow({entry,onOpen}) {
  const job=entry.job||{},state=job.state,pct=job.totalBytes?Math.min(100,Math.round(job.receivedBytes*100/job.totalBytes)):null;
  const status=state==='downloading'&&pct!==null?pct+'%':JOB_LABELS[state]||'';
  return h('li',{className:'ap-cat-job-row','data-state':state},
    h('span',{className:'ap-cat-job-icon'},state==='failed'?h(Glyph,{name:'warning'}):JOB_ACTIVE.has(state)&&state!=='paused'?h(Spinner):h(Glyph,{name:state==='paused'?'pause':'export'})),
    h('span',{className:'ap-cat-job-name',title:entry.label},entry.label),
    h('span',{className:'ap-cat-job-status'},status),
    h(Button,{className:'ap-hint-chip','aria-label':(state==='ready'?'继续安装 ':'查看 ')+entry.label,onClick:onOpen},state==='ready'?'继续安装':'查看'));
}

// ---------- 获取素材包 ----------
// one compact dialog behind the library's one
// 「获取素材包」 icon, sized to its content (≈560 px; a full-width bottom sheet on phones). No tabs, no foot — close with ✕ or
// Esc. Top row: the link field, an inline 「获取」 (enabled once the field holds a URL) and a small 「选择 ZIP」 icon; a ZIP
// dropped anywhere on the dialog imports too (a quiet full-dialog highlight while dragging). Below it, the catalogue list
// itself: compact rows (封面 · name · 「作者 · 大小」 · one action), only when the host has a catalogue with sources.
// Every flow keeps its checks and only moves in place, next to what started it: a link's 「确认下载」 (file, domain, the
// unofficial warning, the exact link under 「详情」) and its progress sit under the field; a pack's progress, pause /
// cancel and errors sit under its row; a row's name opens its facts and choices (下载源, 加速镜像, 使用许可, 文件指纹) in place.
// A finished download opens the one install sheet (ConflictDialog → PackInstallSheet) on top, exactly as before; a chosen
// or dropped ZIP is read and opens it from the library (onPreview). Downloads keep running when the dialog closes (the
// library's tray lists them). No user-supplied 文件指纹 for a link (owner: unnecessary); the host still checks archives.
const catZipName=file=>/\.zip$/i.test(String(file?.name||''));
const catUrlish=value=>{try{return !!new URL(String(value||'').trim()).protocol;}catch(_){return false;}};
const catDragFiles=e=>[...(e?.dataTransfer?.types||[])].includes('Files');
// One download, in place: {entry, controls (the row's action slot), line (progress · meta, or the plain failure)}.
function useCatJob(binding,jobId,{onInstall}={}) {
  const store=useCatalogueStore(binding),work=useTask(binding,catErrorText),entry=jobId?store.jobs.get(jobId):null;
  React.useEffect(()=>{if(entry&&JOB_ACTIVE.has(entry.job?.state))pollCatalogueJobs(binding);},[jobId]);
  if(!entry)return {entry:null,controls:null,line:null};
  const job=entry.job||{},state=job.state,label=entry.label||'素材包';
  const control=action=>work.task(()=>controlCatalogueDownload(binding,jobId,action));
  const drop=async()=>{if(!['cancelled','completed'].includes(state)&&!entry.lost)await control('cancel');forgetCatalogueDownload(binding,jobId);};
  const total=job.totalBytes||entry.size||null,pct=total?Math.min(100,(job.receivedBytes||0)*100/total):null,indeterminate=pct===null||['queued','verifying'].includes(state);
  const controls=h('span',{className:'ap-get-job-controls'},
    ['queued','downloading'].includes(state)&&h(IconButton,{icon:'pause',label:'暂停 '+label,title:'暂停',disabled:work.busy,onClick:()=>control('pause')}),
    state==='paused'&&h(IconButton,{icon:'play',label:'继续 '+label,title:'继续',disabled:work.busy,onClick:()=>control('resume')}),
    JOB_ACTIVE.has(state)&&h(IconButton,{icon:'close',label:'取消下载 '+label,title:'取消下载',disabled:work.busy,onClick:drop}),
    state==='ready'&&h(Button,{className:'ap-get-act',onClick:()=>onInstall?.(jobId)},'继续安装'));
  const line=state==='failed'||state==='cancelled'?h('div',{className:'ap-get-job','data-state':state},
      state==='failed'?h('p',{role:'alert',className:'ap-cat-problem'},catErrorText(job.error)):h('p',{className:'ap-get-job-meta'},JOB_LABELS.cancelled),
      h('span',{className:'ap-get-job-actions'},state==='failed'&&!entry.lost&&h(Button,{className:'ap-link',disabled:work.busy,onClick:()=>control('resume')},'重试'),
        h(Button,{className:'ap-link is-quiet',disabled:work.busy,onClick:drop},state==='failed'?'放弃':'关闭')),
      work.error&&h('p',{role:'alert',className:'ap-cat-problem'},work.error)):
    h('div',{className:'ap-get-job','data-state':state},
      h('div',{className:'ap-cat-progress','data-indeterminate':indeterminate||undefined,'data-state':state,role:'progressbar','aria-label':'下载进度 '+label,'aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':indeterminate?undefined:Math.round(pct)},h('span',{style:indeterminate?undefined:{width:pct+'%'}})),
      h('p',{className:'ap-get-job-meta'},
        h('span',null,catBytes(job.receivedBytes||0)+(total?' / '+catBytes(total):'')),
        state==='downloading'&&job.speed>0&&h('span',null,catBytes(job.speed)+'/s'),
        h('span',{className:'ap-cat-job-state','data-state':state},JOB_LABELS[state]||'')),
      work.error&&h('p',{role:'alert',className:'ap-cat-problem'},work.error));
  return {entry,controls,line};
}
// `curated` — 「下载官方精选素材」: the same sheet showing only the official source's 精选
// list (no link field, no ZIP, no 目录来源); an unpublished list is one phrase.
function PackGetSheet({binding,packs,catalogueReady:ready,onClose,onSources,onInstalled,onPreview,curated=false}) {
  const store=useCatalogueStore(binding),zip=useTask(binding,catErrorText),link=useTask(binding,catErrorText),picker=React.useRef(null),depth=React.useRef(0);
  const [url,setUrl]=React.useState(''),[confirm,setConfirm]=React.useState(null),[problem,setProblem]=React.useState(''),[reading,setReading]=React.useState(null),[over,setOver]=React.useState(false);
  // Downloads started here, by where they show: 'link' or 'pack:<source>:<pack>'. The finished one opens the install sheet.
  const [jobs,setJobs]=React.useState({}),[installing,setInstalling]=React.useState(null);
  const setJob=(key,id)=>setJobs(all=>{if(all[key]===id)return all;const next={...all};if(id)next[key]=id;else delete next[key];return next;});
  React.useEffect(()=>{
    const gone=Object.keys(jobs).filter(key=>!store.jobs.has(jobs[key]));
    if(gone.length)setJobs(all=>{const next={...all};for(const key of gone)delete next[key];return next;});
    if(!installing){const done=Object.values(jobs).find(id=>{const job=store.jobs.get(id)?.job;return job?.state==='ready'&&job.inspection;});if(done)setInstalling(done);}
  });
  const clean=catHttps(url),busy=zip.busy||link.busy;
  function get(){if(!catUrlish(url)||jobs.link||link.busy)return;if(!clean)return setProblem('请粘贴以 https:// 开头的链接');setProblem('');setConfirm(clean);}
  async function start(){
    const target=confirm,jobId=await link.task(()=>startCatalogueDownload(binding,{mode:'url',label:catFileLabel(target),input:{url:target}}));
    if(jobId){setConfirm(null);setUrl('');setJob('link',jobId);}
  }
  async function pick(selected){
    const files=Array.from(selected||[]),file=files[0];
    if(!file)return;if(files.some(item=>!catZipName(item)))return setProblem('请选择 .zip 格式的素材包');
    setProblem('');setReading(file);
    const preview=await zip.task(async()=>binding.service.inspectImport({bytes:new Uint8Array(await file.arrayBuffer())}));
    setReading(null);if(preview)onPreview(files.length===1?preview:{kind:'file-queue',files,current:preview});
  }
  const frame={'data-drop':over||undefined,
    onDragEnter:e=>{if(!catDragFiles(e))return;e.preventDefault();depth.current++;setOver(true);},
    onDragOver:e=>{if(!catDragFiles(e))return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect=zip.busy?'none':'copy';},
    onDragLeave:e=>{if(!catDragFiles(e))return;depth.current=Math.max(0,depth.current-1);if(!depth.current)setOver(false);},
    onDrop:e=>{if(!e.dataTransfer?.files?.length&&!catDragFiles(e))return;e.preventDefault();depth.current=0;setOver(false);if(!zip.busy)pick(e.dataTransfer?.files);}};
  const choose=()=>picker.current?.click?.();
  const bar=h('div',{className:'ap-get-bar'},
    ready&&h('input',{id:'ap-cat-url',className:'ap-get-url',type:'url',inputMode:'url',autoComplete:'off',spellCheck:false,'aria-label':'素材包链接',placeholder:'粘贴素材包链接','data-autofocus':true,
      value:url,disabled:link.busy,'aria-invalid':!!problem&&!!url&&!clean||undefined,
      onChange:e=>{setUrl(e.target.value);setConfirm(null);setProblem('');},onKeyDown:e=>{if(e.key==='Enter'){e.preventDefault();get();}}}),
    ready&&h(Button,{className:'ap-primary ap-get-go',disabled:!catUrlish(url)||!!confirm||!!jobs.link||link.busy,onClick:get},'获取'),
    ready?h(IconButton,{icon:'upload',label:'选择 ZIP',title:'选择 ZIP，或拖入此窗口',className:'ap-icon-button ap-get-zip',disabled:zip.busy,onClick:choose}):
      h(Button,{className:'ap-get-pick','data-autofocus':true,disabled:zip.busy,onClick:choose},h(Glyph,{name:'upload'}),'选择 ZIP 文件'),
    h('input',{ref:picker,type:'file',accept:'.zip',multiple:true,hidden:true,tabIndex:-1,'aria-hidden':true,onChange:e=>{const chosen=Array.from(e.target.files||[]);e.target.value='';pick(chosen);}}));
  const linkJob=useCatJob(binding,jobs.link,{onInstall:setInstalling});
  const confirmBlock=confirm&&h('div',{className:'ap-get-confirm','aria-label':'确认下载',role:'group'},
    h('p',{className:'ap-get-confirm-line'},h('span',{className:'ap-get-confirm-name'},catFileLabel(confirm)),h('span',null,'来自 '+catHost(confirm))),
    h(CatBand,{compact:true},CAT_TEXT.unofficial),
    h('div',{className:'ap-get-confirm-actions'},
      h(CatMore,null,h(CatFacts,null,h(CatFact,{label:'下载地址'},h(CatUrl,{url:confirm})))),
      h(Button,{className:'ap-get-quiet',disabled:link.busy,onClick:()=>setConfirm(null)},'取消'),
      h(Button,{className:'ap-primary ap-get-start',disabled:link.busy,onClick:start},catBusyLabel(link.busy,'开始下载'))),
    link.error&&h('p',{role:'alert',className:'ap-cat-problem'},link.error));
  return h(React.Fragment,null,
    curated?h(CatSheet,{title:'官方精选素材',className:'ap-get-sheet',onClose},h(GetCatalogue,{binding,packs,jobs,setJob,onInstall:setInstalling,curated:true})):
    h(CatSheet,{title:'获取素材包',className:'ap-get-sheet',onClose,busy,frame,
        headTools:ready&&h(IconButton,{icon:'sources',label:'目录来源',onClick:()=>onSources(false)})},
      bar,
      reading&&h('p',{className:'ap-get-status',role:'status'},h(Spinner),h('span',null,'正在读取 '+reading.name)),
      problem&&h('p',{role:'alert',className:'ap-cat-problem ap-get-problem'},problem),
      zip.error&&!reading&&h('p',{role:'alert',className:'ap-cat-problem ap-get-problem'},zip.error),
      confirmBlock,
      linkJob.entry&&h('div',{className:'ap-get-link-job'},h('p',{className:'ap-get-link-head'},h('span',{className:'ap-get-confirm-name'},linkJob.entry.label),linkJob.controls),linkJob.line),
      ready&&h(GetCatalogue,{binding,packs,jobs,setJob,onInstall:setInstalling,onSources}),
      over&&h('div',{className:'ap-get-drop','aria-hidden':true},h('span',null,h(Glyph,{name:'upload'}),'松开以导入 ZIP'))),
    installing&&h(CatalogueJobSheet,{key:installing,binding,jobId:installing,onClose:()=>setInstalling(null),
      onInstalled:(result,entry)=>{setInstalling(null);onInstalled?.(result,entry);},
      // CAS failure: the same choice downloads again and stays on the row (or under the field) that started it.
      onRetry:next=>{const key=Object.keys(jobs).find(k=>jobs[k]===installing);if(key)setJob(key,next);setInstalling(null);}}));
}
// The catalogue list: every enabled source (official first), one group each; a heading only when there is more than one
// source or the source is not official (its 非官方 line goes with it). Nothing at all without sources.
function GetCatalogue({binding,packs,jobs,setJob,onInstall,onSources,curated=false}) {
  const store=useCatalogueStore(binding),fetched=React.useRef(new Set());
  React.useEffect(()=>{loadCatalogueSettings(binding).catch(()=>{});},[binding]);
  const settings=store.settings,sources=settings?sourceOrder(settings.values.sources.filter(s=>s.enabled&&(!curated||s.official))):[];
  const ids=sources.map(s=>s.sourceId).join('\n');
  React.useEffect(()=>{for(const s of sources)if(!fetched.current.has(s.sourceId)){fetched.current.add(s.sourceId);refreshCatalogueSource(binding,s.sourceId,curated);}},[ids]);
  if(!settings)return store.settingsError?h(ErrorBox,{error:catErrorText(store.settingsError),reload:()=>loadCatalogueSettings(binding).catch(()=>{})}):h(Loading,{shape:'fields',count:4});
  if(!sources.length)return curated?h(EmptyState,{text:'精选素材还没有发布'}):null;
  const installed=new Map((packs||[]).map(p=>[p.manifest.id,p])),heads=sources.length>1||!sources[0].official;
  return h('div',{className:'ap-get-catalogue'},sources.map(source=>{
    const loaded=store.catalogues.get(catalogueKey(source.sourceId,curated)),catalogue=loaded?.value||null,name=sourceName(source,catalogue),reload=()=>refreshCatalogueSource(binding,source.sourceId,curated);
    return h('section',{key:source.sourceId,className:'ap-get-group','aria-label':name},
      heads&&h('header',{className:'ap-get-group-head'},h('h3',null,name),h(CatOrigin,{official:source.official})),
      !source.official&&h(CatBand,{compact:true},CAT_TEXT.unofficialCatalogue),
      catalogue?.stale&&h(CatBand,{compact:true},'暂时连不上这个目录，显示的是 '+catTime(catalogue.fetchedAt)+' 的内容'),
      loaded?.error&&!catalogue?h(ErrorBox,{error:'目录打不开：'+catErrorText(loaded.error),reload}):
      !catalogue?h(Loading):
      !catalogue.packs.length?h('p',{className:'ap-get-quiet-line'},curated?'精选素材还没有发布':'这个目录里还没有素材包'):
      h('ul',{className:'ap-get-rows','aria-label':'素材包'},catalogue.packs.map(pack=>{const key='pack:'+pack.sourceId+':'+pack.id;
        return h(CatalogueRow,{key:pack.id,binding,pack,catalogue,source,installed,jobKey:key,jobId:jobs[key],setJob,onInstall});})));
  }));
}
// A row: 封面 · name · 「作者 · 大小」 · one action (安装 / 更新 / 已安装 / ⚠ 暂不支持 / ⚠ 暂时无法更新). Its download runs in
// place (progress under the text, pause / cancel in the action slot); the name opens its facts and choices below it.
function CatalogueRow({binding,pack,catalogue,source,installed,jobKey,jobId,setJob,onInstall}) {
  const store=useCatalogueStore(binding),work=useTask(binding,catErrorText),settings=store.settings?.values||{};
  // A download of this pack that is still running (the dialog was closed and opened again) shows here too.
  const running=jobId?null:[...store.jobs.values()].find(e=>e.packId===pack.id&&e.input?.selection?.sourceId===pack.sourceId);
  React.useEffect(()=>{if(running)setJob(jobKey,running.jobId);},[running?.jobId]);
  const preferred=pack.downloads.some(d=>d.id===settings.preferredDownloadId)?settings.preferredDownloadId:pack.downloads[0]?.id;
  const [open,setOpen]=React.useState(false),[downloadId,setDownloadId]=React.useState(null),[mirror,setMirror]=React.useState('direct'),[failed,setFailed]=React.useState(null);
  const download=pack.downloads.find(d=>d.id===(downloadId||preferred))||pack.downloads[0],prefix=settings.mirrorPrefix||'',canMirror=!!prefix&&!!pack.sha256;
  const useMirror=canMirror&&mirror==='mirror',final=download?(useMirror?prefix+download.url:download.url):'';
  const state=catPackState(pack,installed),unsupported=pack.compatibility&&!pack.compatibility.supported,credits=pack.credits.map(c=>c.name).join('、');
  const job=useCatJob(binding,jobId||running?.jobId,{onInstall});
  async function start(){
    setFailed(null);
    const id=await work.task(async()=>{try{return await startCatalogueDownload(binding,{mode:state.kind==='none'?'catalogue':'update',label:pack.title,size:pack.size,version:pack.version,mirror:useMirror,packId:pack.id,
      input:{selection:{sourceId:pack.sourceId,catalogueRevision:catalogue.catalogueRevision,packId:pack.id,version:pack.version,downloadId:download.id},...(useMirror?{useMirrorPrefix:true}:{})}});}
      catch(error){setFailed(error);if(error?.code==='REVISION_CONFLICT')refreshCatalogueSource(binding,pack.sourceId);return undefined;}});
    if(id)setJob(jobKey,id);
  }
  const update=state.kind==='update';
  const action=job.entry?job.controls:
    unsupported?h(CatWarn,{title:'需要更新 DSH Tavern 后才能安装'},'暂不支持'):
    state.kind==='changed'?h(CatWarn,{title:'发布者换了文件却没有改版本号，请等发布者发布新版本'},'暂时无法更新'):
    ['current','ahead'].includes(state.kind)?h('span',{className:'ap-get-installed',title:state.kind==='ahead'?'已安装较新的版本':undefined},h(Glyph,{name:'check'}),'已安装'):
    h(Button,{className:'ap-get-act','aria-label':(update?'更新 ':'安装 ')+pack.title,title:update?'更新到 '+state.to:state.kind==='other'?'已安装另一个来源的版本':undefined,disabled:work.busy||!download,onClick:start},catBusyLabel(work.busy,update?'更新':'安装'));
  const line=[credits,catBytes(pack.size)].filter(Boolean).join(' · '),host=catHost(source?.url||''),moreId='ap-get-more-'+pack.sourceId+'-'+pack.id;
  return h('li',{className:'ap-get-row','data-state':state.kind,'data-open':open||undefined},
    h('button',{type:'button',className:'ap-get-row-main','aria-expanded':open,'aria-controls':moreId,'aria-label':pack.title+' 详情',onClick:()=>setOpen(!open)},
      h(CatArt,{name:pack.title,size:'mini'}),
      h('span',{className:'ap-get-row-text'},h('span',{className:'ap-get-row-name'},pack.title),
        h('span',{className:'ap-get-row-line'},update?h('span',{className:'ap-cat-versions'},state.from,h(Glyph,{name:'arrow'}),state.to):null,update&&line?' · ':null,line))),
    h('span',{className:'ap-get-row-action'},action),
    job.line&&h('div',{className:'ap-get-row-under'},job.line),
    (failed||work.error)&&h('div',{className:'ap-get-row-under'},h('p',{role:'alert',className:'ap-cat-problem'},failed?catErrorText(failed):work.error)),
    open&&h('div',{id:moreId,className:'ap-get-row-under ap-get-row-more'},
      state.kind==='changed'&&h(CatBand,{compact:true},'发布者换了文件却没有改版本号。请等发布者发布新版本。'),
      unsupported&&h(CatBand,{compact:true},'需要更新 DSH Tavern 后才能安装这个素材包。'),
      (pack.downloads.length>1||prefix)&&!job.entry&&h('div',{className:'ap-cat-choices'},
        pack.downloads.length>1&&h(Row,{label:'下载源'},h(CatSelect,{label:'下载源',value:download?.id,onChange:setDownloadId,options:pack.downloads.map(d=>({value:d.id,label:d.label,hint:catHost(d.url)}))})),
        prefix&&h(Row,{label:'加速镜像',help:'经你在「目录来源」里设置的第三方加速镜像下载，下载完会核对文件。'},
          h(Segmented,{className:'ap-cat-segment',label:'下载方式',value:useMirror?'mirror':'direct',onChange:setMirror,options:[['direct','直接下载'],['mirror','经加速镜像',!canMirror,!canMirror?'目录没有提供文件指纹':undefined]]}))),
      h(CatFacts,null,
        h(CatFact,{label:'版本'},pack.version),
        !credits&&h(CatFact,{label:'作者'},'未注明'),
        h(CatFact,{label:'使用许可'},pack.licence.id),
        h(CatFact,{label:'来源目录'},sourceName(source,catalogue)+(host?'（'+host+'）':'')),
        final&&h(CatFact,{label:'下载地址'},h(CatUrl,{url:final})),
        h(CatFact,{label:'文件指纹'},pack.sha256?'目录已提供，下载完会核对':CAT_TEXT.noFingerprint))));
}

// ---------- the download sheet: progress → the install sheet ----------
function CatalogueJobSheet({binding,jobId,onClose,onInstalled,onRetry}) {
  const store=useCatalogueStore(binding),work=useTask(binding,catErrorText),entry=store.jobs.get(jobId);
  React.useEffect(()=>{if(entry&&JOB_ACTIVE.has(entry.job?.state))pollCatalogueJobs(binding);},[jobId]);
  if(!entry)return null;
  const job=entry.job||{},state=job.state;
  // a link to a 素材包合集 installs its packs one by one (no re-download on a CAS failure).
  if(state==='ready'&&job.inspection?.kind==='pack-set')return h(PackSetInstall,{binding,set:job.inspection,origin:{url:job.downloadUrl||''},
    onClose:()=>{forgetCatalogueDownload(binding,jobId);onClose();},
    onDone:result=>{forgetCatalogueDownload(binding,jobId);onInstalled(result,entry);}});
  if(state==='ready'&&job.inspection)return h(ConflictDialog,{binding,preview:job.inspection,origin:{url:job.downloadUrl||''},
    onClose:()=>{forgetCatalogueDownload(binding,jobId);onClose();},
    onDone:result=>{forgetCatalogueDownload(binding,jobId);onInstalled(result,entry);},
    // CAS failure: the preview was cancelled; download and preview again from the same choice (never overwrite).
    onRetry:async()=>{forgetCatalogueDownload(binding,jobId);const {mode,label,size,mirror,packId,version,input}=entry;
      try{onRetry(await startCatalogueDownload(binding,{mode,label,size,mirror,packId,version,input}));}catch(_){onClose();}}});
  const control=action=>work.task(()=>controlCatalogueDownload(binding,jobId,action));
  const drop=async()=>{if(!['cancelled','completed'].includes(state)&&!entry.lost)await control('cancel');forgetCatalogueDownload(binding,jobId);onClose();};
  const total=job.totalBytes||entry.size||null,pct=total?Math.min(100,job.receivedBytes*100/total):null,indeterminate=pct===null||['queued','verifying'].includes(state);
  const url=job.downloadUrl||'';
  const foot=state==='failed'?h(React.Fragment,null,h(Button,{disabled:work.busy,onClick:drop},'放弃'),!entry.lost&&h(Button,{primary:true,disabled:work.busy,onClick:()=>control('resume')},'重试')):
    state==='cancelled'?h(Button,{onClick:drop},'关闭'):
    h(React.Fragment,null,
      ['queued','downloading'].includes(state)&&h(Button,{disabled:work.busy,onClick:()=>control('pause')},h(Glyph,{name:'pause'}),'暂停'),
      state==='paused'&&h(Button,{disabled:work.busy,onClick:()=>control('resume')},h(Glyph,{name:'play'}),'继续'),
      JOB_ACTIVE.has(state)&&h(Button,{className:'ap-danger-text',disabled:work.busy,onClick:drop},'取消下载'));
  return h(CatSheet,{title:entry.mode==='update'?'正在下载更新':'正在下载',className:'ap-cat-job-sheet',onClose,foot,initialFocus:'dialog'},
    h(CatHero,{name:entry.label},entry.mode==='update'&&entry.version&&h(CatSub,null,'新版本 '+entry.version)),
    h('div',{className:'ap-cat-progress','data-indeterminate':indeterminate||undefined,'data-state':state,role:'progressbar','aria-label':'下载进度','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':indeterminate?undefined:Math.round(pct)},h('span',{style:indeterminate?undefined:{width:pct+'%'}})),
    h('p',{className:'ap-cat-job-meta'},
      h('span',null,catBytes(job.receivedBytes||0)+(total?' / '+catBytes(total):'')),
      state==='downloading'&&job.speed>0&&h('span',null,catBytes(job.speed)+'/s'),
      h('span',{className:'ap-cat-job-state','data-state':state},JOB_LABELS[state]||'')),
    state==='failed'&&h(CatBand,{role:'alert'},catErrorText(job.error)),
    h(ErrorBox,{error:work.error}),
    url&&h(CatMore,null,h(CatFacts,null,h(CatFact,{label:'下载地址'},h(CatUrl,{url})),
      // a link install has no 文件指纹 of its own any more; only a catalogue's is named.
      job.integrity==='sha256'&&h(CatFact,{label:'文件指纹'},'下载完会核对'))));
}

// ---------- the install sheet (every single-pack install: download or local ZIP) ----------
// Rendered by ConflictDialog for a single pack; it owns only the presentation and the choice. Focal point: the pack's 封面,
// its name and what is inside in words. A real warning (unofficial source, edited items an update removes) is one amber
// band; a pack with widgets gets one plain note — widgets stay off until a card turns them on, so there is no risk step.
// Update / replace: the primary button is the explicit choice (no default segmented control); 「改为另存一份」 switches to
// keep-both. Expert facts (version, source, link, 文件指纹, item names) sit in 「详情」.
function catRemovedLocal(preview) {
  const current=preview.current,diff=preview.diff||{};
  const assets=(diff.assets?.removed||[]).map(key=>{const [kind,...id]=String(key).split('/'),asset=current?.manifest?.assets?.find(a=>a.kind===kind&&a.id===id.join('/'));return {kind:kinds[kind]?kind:'',name:asset?.name||'未命名条目'};});
  const figures=(diff.figures?.removed||[]).map(path=>{const id=String(path).replace(/^figures\//,'').replace(/\.json$/,'');return {kind:'figures',name:current?.figures?.[id]?.name||'未命名人物'};});
  return [...figures,...assets];
}
function catMergeItem(key,current) {
  const [type,...rest]=String(key).split('/');
  if(type==='asset'){const [kind,...id]=rest,asset=current?.manifest?.assets?.find(a=>a.kind===kind&&a.id===id.join('/'));return {kind:kinds[kind]?kind:'',name:asset?.name||'未命名条目'};}
  const figure=current?.figures?.[rest[0]];
  if(type==='figure')return {kind:'figures',name:figure?.name||'未命名人物'};
  if(type==='outfit'){const outfit=figure?.outfits?.find(o=>o.key===rest.slice(1).join('/'));return {kind:'figures',name:(figure?.name||'未命名人物')+' · '+(outfit?.label||'服装')};}
  return {kind:'',name:'未命名条目'};
}
// a 素材包合集 (a local ZIP or a link from the 素材库's batch export) installs
// pack by pack through this same sheet (ConflictDialog: every check, choice and confirmation unchanged); the title counts
// 「1/3」. 取消 (or ✕ / Esc) skips that pack only. Packs never reached are discarded when the walk ends early. onDone(the last
// result) once any pack went in, else onClose().
function PackSetInstall({binding,set,origin,onDone,onClose}) {
  const [members]=React.useState(()=>set.packs.filter(p=>!p.done)),[index,setIndex]=React.useState(0),last=React.useRef(null),reached=React.useRef(0);
  reached.current=Math.max(reached.current,index);
  React.useEffect(()=>()=>{for(const p of members.slice(reached.current+1))Promise.resolve(binding.service.applyImport({inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decision:'cancel'})).catch(()=>{});},[]);
  const next=result=>{if(result)last.current=result;if(index+1<members.length)setIndex(index+1);else if(last.current)onDone(last.current);else onClose();};
  const preview=members[index];
  React.useEffect(()=>{if(!preview)onClose();},[]);
  if(!preview)return null;
  return h(ConflictDialog,{key:preview.inspectionId,binding,preview,origin,step:members.length>1?{index,count:members.length}:null,onDone:next,onClose:()=>next(null)});
}
function PackInstallSheet({preview,origin,step,busy,error,stale,onClose,onInstall,onRetry}) {
  const choices=preview.choices||[],incoming=preview.incoming||{},manifest=incoming.manifest||{assets:[],figures:[]},name=manifest.name||'素材包';
  const d=preview.distribution||null,remote=!!d,merge=preview.merge||null,current=preview.current||null,currentName=current?.manifest?.name||name;
  const kind=choices.includes('noop')?'same':choices.includes('update')?'update':choices.includes('install')?'install':'copy';
  const [keep,setKeep]=React.useState(false);
  const decision={same:'noop',install:'install',copy:'keep-both',update:keep?'keep-both':'update'}[kind],replacing=decision==='update';
  const fromVersion=current?.distribution?.version,toVersion=d?.version;
  const title=(replacing?'更新素材包':kind==='same'?'已经安装过了':'安装素材包')+(step?' '+(step.index+1)+'/'+step.count:'');
  const action=kind==='same'?'完成':replacing?(remote?'更新':'替换'):keep?'另存一份':'安装';
  // Only what the user would lose is listed: edited items the author removed (catalogue) or items missing from the file (ZIP).
  const losses=!replacing?[]:merge?(merge.removedEdited||[]).map(key=>catMergeItem(key,current)):catRemovedLocal(preview);
  const widgets=[...new Set((preview.scriptRisk||[]).map(r=>r.widgetName).filter(Boolean))],scripts=decision!=='noop'&&(preview.scriptRisk||[]).length>0;
  const contents=catContents(manifest);
  const versions=replacing&&!!fromVersion&&!!toVersion&&fromVersion!==toVersion,unofficial=remote&&!d.official&&kind!=='same';
  const sub=versions?h(CatSub,{className:'ap-cat-versions'},fromVersion,h(Glyph,{name:'arrow'}),toVersion):contents?h(CatSub,null,contents):null;
  let lead=null;
  if(replacing)lead=merge?(merge.wholePackReplacement===false?'新版本会替换现在的内容，你开关过的条目和触发设置会保留。':'新版本会替换整个素材包。你开关过的条目和触发设置会保留，其它改动（比如改过的名字、备注）会换成作者的版本。'):
    '会用这个文件替换已安装的「'+currentName+'」，你对它做过的修改都不会保留。';
  else if(kind==='update')lead='会另存为一份新的素材包，原来的「'+currentName+'」保持不变。'+(remote?'新的一份不会再收到更新。':'');
  else if(kind==='copy')lead='里面的人物和已安装的素材包重复，会另存为一份新的素材包。';
  else if(kind==='same')lead='和已安装的内容完全相同。';
  const source=!remote?'本机文件':d.official?'官方素材目录':d.catalogueUrl?catHost(d.catalogueUrl)+'（非官方目录）':'网址（非官方）';
  // 「详情」 leaves out what the hero already says (the version change, 官方素材 · 文件完整); with nothing left it is not shown.
  const facts=[
    !!(fromVersion||toVersion)&&!versions&&h(CatFact,{key:'version',label:'版本'},toVersion||fromVersion),
    !(remote&&d.official)&&h(CatFact,{key:'source',label:'来源'},source),
    !!origin?.url&&h(CatFact,{key:'url',label:'下载地址'},h(CatUrl,{url:origin.url})),
    remote&&!!d.sourceId&&!(d.official&&d.integrity==='sha256')&&h(CatFact,{key:'sha',label:'文件指纹'},d.integrity==='sha256'?'已核对，文件完整':CAT_TEXT.noFingerprint),
    ...catContentRows(manifest,incoming.figures).map(([k,names])=>h(CatFact,{key:k,label:kinds[k]},names))].filter(Boolean);
  const foot=h(React.Fragment,null,h(Button,{disabled:busy,onClick:onClose},'取消'),
    h(Button,{primary:true,disabled:busy||stale,onClick:()=>onInstall(decision)},catBusyLabel(busy,busy?(replacing?'正在更新…':'正在安装…'):action)));
  return h(CatSheet,{title,className:'ap-cat-install-sheet',onClose,busy,foot,initialFocus:'dialog'},
    h(CatHero,{name:replacing?currentName:name,kind:catLeadKind(manifest)},sub,
      remote&&d.official&&h(CatNote,null,'官方素材'+(d.integrity==='sha256'?' · 文件完整':''))),
    unofficial&&h(CatBand,null,CAT_TEXT.unofficial),
    lead&&h('p',{className:'ap-cat-lead'},lead),
    // The list is the content (no count of it); the sentence only says what happens to it.
    losses.length>0&&h(CatBand,{list:h(CatItems,{items:losses})},merge&&!merge.withoutBaseline?'更新后，下面这些你改过的内容会消失：':merge?'更新后，下面这些会被删除：':'替换后，下面这些会被删除：'),
    kind==='update'&&!stale&&h('p',{className:'ap-cat-switch'},h(Button,{className:'ap-link',disabled:busy,onClick:()=>setKeep(!keep)},keep?(remote?'改回更新原来的':'改回替换原来的'):'改为另存一份')),
    // Program files outside a 模组: the 非官方来源 band already says 「请只安装…」, so the note only stands alone.
    scripts&&(widgets.length?h(CatNote,{kind:'widgets'},'含模组'+widgets.map(w=>'「'+w+'」').join('')+'。'+CAT_TEXT.widgetRisk):!unofficial&&h(CatNote,{icon:'note'},'含程序文件。第三方程序可能有安全风险，请只安装你信任的素材包。')),
    stale&&h(CatBand,{role:'alert'},CAT_TEXT.stale,onRetry&&h(Button,{className:'ap-link ap-cat-band-action',disabled:busy,onClick:onRetry},'重新下载')),
    h(ErrorBox,{error:error}),
    facts.length>0&&h(CatMore,null,h(CatFacts,null,facts)));
}

// ---------- 素材目录 (shared by the 获取素材包 list and the update sheet) ----------
const sourceOrder=sources=>[...sources.filter(s=>s.official),...sources.filter(s=>!s.official)];
const sourceName=(source,catalogue)=>catalogue?.catalogue?.title||(source.official?'官方素材目录':catHost(source.url)||'素材目录');
function catPackState(pack,installed) {
  const mine=installed.get(pack.id);if(!mine)return {kind:'none'};
  const d=mine.distribution;if(!d?.sourceId||d.sourceId!==pack.sourceId)return {kind:'other'};
  const c=catCompare(pack.version,d.version);
  if(c>0)return {kind:'update',from:d.version,to:pack.version};
  if(c<0)return {kind:'ahead'};
  if(pack.sha256&&d.archiveSha256&&pack.sha256!==d.archiveSha256)return {kind:'changed'};
  return {kind:'current'};
}
function CatStateChip({state}) {
  if(state.kind==='update')return h(CatChip,{tone:'update',icon:'arrow'},'可更新 '+state.to);
  if(state.kind==='changed')return h(CatWarn,{title:'发布者换了文件却没有改版本号'},'暂时无法更新');
  if(state.kind==='none')return null;
  return h(CatChip,{tone:'installed',icon:'check'},'已安装');
}
// Detail: 封面, name, one line of facts and the primary action; download source / 加速镜像 only when there is a choice;
// licence, source catalogue, exact link and 文件指纹 in 「详情」. `sheet` = inside the update sheet (centred, action at the foot).
function CatalogueDetail({binding,pack,catalogue,source,installed,onBack,onStarted,sheet}) {
  const store=useCatalogueStore(binding),work=useTask(binding,catErrorText),narrow=useNarrow(),settings=store.settings?.values||{};
  const preferred=pack.downloads.some(d=>d.id===settings.preferredDownloadId)?settings.preferredDownloadId:pack.downloads[0]?.id;
  const [downloadId,setDownloadId]=React.useState(preferred),[mirror,setMirror]=React.useState('direct'),[failed,setFailed]=React.useState(null);
  const download=pack.downloads.find(d=>d.id===downloadId)||pack.downloads[0],prefix=settings.mirrorPrefix||'',canMirror=!!prefix&&!!pack.sha256;
  const useMirror=canMirror&&mirror==='mirror',final=download?(useMirror?prefix+download.url:download.url):'';
  const state=catPackState(pack,installed),unsupported=pack.compatibility&&!pack.compatibility.supported,credits=pack.credits.map(c=>c.name).join('、');
  const blocked=unsupported||['ahead','changed','current'].includes(state.kind);
  const action={none:'安装',other:'安装这个版本',update:'更新到 '+state.to,current:catalogue?.stale?'已安装':'已是最新',ahead:'已安装较新的版本',changed:'暂时无法更新'}[state.kind];
  async function start(){
    setFailed(null);
    const jobId=await work.task(async()=>{try{return await startCatalogueDownload(binding,{mode:state.kind==='none'?'catalogue':'update',label:pack.title,size:pack.size,version:pack.version,mirror:useMirror,packId:pack.id,
      input:{selection:{sourceId:pack.sourceId,catalogueRevision:catalogue.catalogueRevision,packId:pack.id,version:pack.version,downloadId:download.id},...(useMirror?{useMirrorPrefix:true}:{})}});}
      catch(error){setFailed(error);if(error?.code==='REVISION_CONFLICT')refreshCatalogueSource(binding,pack.sourceId);return undefined;}});
    if(jobId)onStarted(jobId);
  }
  const host=catHost(source?.url||''),meta=[state.kind==='update'?'':'v'+pack.version,catBytes(pack.size),credits].filter(Boolean).join(' · ');
  const footAction=sheet||narrow;
  const actions=h('div',{className:'ap-actions ap-cat-detail-actions','data-foot':footAction||undefined},h(Button,{primary:!blocked,disabled:blocked||work.busy||!download,onClick:start},catBusyLabel(work.busy,action)));
  // 「详情」: only what the hero line (version · size · authors) does not already say.
  const more=h(CatMore,null,h(CatFacts,null,
    !credits&&h(CatFact,{label:'作者'},'未注明'),
    h(CatFact,{label:'使用许可'},pack.licence.id),
    h(CatFact,{label:'来源目录'},sourceName(source,catalogue)+(host?'（'+host+'）':'')),
    final&&h(CatFact,{label:'下载地址'},h(CatUrl,{url:final})),
    h(CatFact,{label:'文件指纹'},pack.sha256?'目录已提供，下载完会核对':CAT_TEXT.noFingerprint)));
  return h('div',{className:'ap-cat-detail','data-sheet':sheet||undefined},
    onBack&&h(Button,{className:'ap-back',onClick:onBack},h(Glyph,{name:'back'}),sourceName(source,catalogue)),
    h(CatHero,{name:pack.title,row:!sheet},
      state.kind==='update'&&h(CatSub,{className:'ap-cat-versions'},state.from,h(Glyph,{name:'arrow'}),state.to),
      meta?h(CatSub,null,meta):null),
    !pack.official&&h(CatBand,null,CAT_TEXT.unofficial),
    unsupported&&h(CatBand,null,'需要更新 DSH Tavern 后才能安装这个素材包。'),
    state.kind==='changed'&&h(CatBand,null,'发布者换了文件却没有改版本号。请等发布者发布新版本。'),
    (pack.downloads.length>1||prefix)&&h('div',{className:'ap-cat-choices'},
      pack.downloads.length>1&&h(Row,{label:'下载源'},h(CatSelect,{label:'下载源',value:download?.id,onChange:setDownloadId,options:pack.downloads.map(d=>({value:d.id,label:d.label,hint:catHost(d.url)}))})),
      prefix&&h(Row,{label:'加速镜像',help:'经你在「目录来源」里设置的第三方加速镜像下载，下载完会核对文件。'},
        h(Segmented,{className:'ap-cat-segment',label:'下载方式',value:useMirror?'mirror':'direct',onChange:setMirror,options:[['direct','直接下载'],['mirror','经加速镜像',!canMirror,!canMirror?'目录没有提供文件指纹':undefined]]}))),
    failed&&h(ErrorBox,{error:catErrorText(failed)}),h(ErrorBox,{error:!failed&&work.error}),
    footAction?h(React.Fragment,null,more,actions):h(React.Fragment,null,actions,more));
}

// ---------- 更新 (from the library's 「可更新」 chip) ----------
function CatalogueUpdateSheet({binding,packs,packId,sourceId,onClose,onStarted}) {
  const store=useCatalogueStore(binding),loaded=store.catalogues.get(sourceId);
  React.useEffect(()=>{if(!store.settings)loadCatalogueSettings(binding).catch(()=>{});refreshCatalogueSource(binding,sourceId);},[sourceId]);
  const catalogue=loaded?.value,pack=catalogue?.packs.find(p=>p.id===packId),mine=(packs||[]).find(p=>p.manifest.id===packId);
  const source=store.settings?.values.sources.find(s=>s.sourceId===sourceId)||{sourceId,url:'',official:!!catalogue?.official};
  const installed=new Map((packs||[]).map(p=>[p.manifest.id,p]));
  // The detail's own action row carries 「更新到 x」 (fixed at the bottom of the sheet).
  return h(CatSheet,{title:'有新版本',className:'ap-cat-update-sheet',onClose,initialFocus:'dialog'},
    loaded?.error&&!catalogue?h(ErrorBox,{error:'目录暂时打不开：'+catErrorText(loaded.error),reload:()=>refreshCatalogueSource(binding,sourceId)}):
    !catalogue?h(Loading):!pack?h('p',{className:'ap-cat-quiet'},'目录里已经没有「'+(mine?.manifest.name||'这个素材包')+'」了'):
    h(CatalogueDetail,{key:pack.version,binding,pack,catalogue,source,installed,onStarted,sheet:true}));
}

// ---------- 目录来源 ----------
function CatalogueSourcesSheet({binding,adding,onClose}) {
  const store=useCatalogueStore(binding),work=useTask(binding,catErrorText),[draft,setDraft]=React.useState(adding?'':null),[problem,setProblem]=React.useState(''),[removing,setRemoving]=React.useState(null),input=React.useRef(null);
  React.useEffect(()=>{loadCatalogueSettings(binding).catch(()=>{});},[binding]);
  React.useEffect(()=>{if(draft!==null)input.current?.focus?.();},[draft===null]);
  const settings=store.settings,values=settings?.values,sources=values?sourceOrder(values.sources):[];
  const save=make=>work.task(()=>saveCatalogueSettings(binding,make));
  async function add(){const url=catHttps(draft);if(!url)return setProblem('请输入以 https:// 开头的目录地址');if(sources.some(s=>s.url===url))return setProblem('这个目录已经添加过了');
    setProblem('');if(await save(v=>({...v,sources:[...v.sources,{url,enabled:true}]})))setDraft(null);}
  const known=new Map();for(const {value} of store.catalogues.values())for(const p of value?.packs||[])for(const d of p.downloads)if(!known.has(d.id))known.set(d.id,d.label);
  if(values?.preferredDownloadId&&!known.has(values.preferredDownloadId))known.set(values.preferredDownloadId,values.preferredDownloadId);
  const catalogueOf=id=>store.catalogues.get(id)?.value;
  return h(CatSheet,{title:'目录来源',className:'ap-cat-sources-sheet',onClose,busy:false,initialFocus:adding?'control':'dialog'},
    !settings?(store.settingsError?h(ErrorBox,{error:catErrorText(store.settingsError),reload:()=>loadCatalogueSettings(binding).catch(()=>{})}):h(Loading,{shape:'fields',count:4})):h(React.Fragment,null,
      h('section',{className:'ap-section ap-cat-section'},h('header',{className:'ap-section-head'},h('h3',null,'素材目录'),work.busy&&h(Spinner)),
        sources.length>0&&h('ul',{className:'ap-cat-source-list'},sources.map(s=>h('li',{key:s.sourceId,className:'ap-cat-source-row','data-off':!s.enabled||undefined},
          h('span',{className:'ap-cat-source-text'},h('strong',null,sourceName(s,catalogueOf(s.sourceId))),h('code',null,s.url)),
          h(CatOrigin,{official:s.official}),
          h('button',{type:'button',className:'ap-cat-toggle','aria-pressed':s.enabled,'aria-label':(s.enabled?'停用 ':'启用 ')+sourceName(s,catalogueOf(s.sourceId)),disabled:work.busy,
            onClick:()=>save(v=>({...v,sources:v.sources.map(x=>x.sourceId===s.sourceId?{...x,enabled:!s.enabled}:x)}))},h(Glyph,{name:s.enabled?'stateCard':'stateOff'}),s.enabled?'启用':'关闭'),
          s.official?h('span',{className:'ap-cat-remove-gap'}):h(IconButton,{icon:'remove',label:'移除 '+sourceName(s,catalogueOf(s.sourceId)),disabled:work.busy,onClick:()=>setRemoving(s)})))),
        // InlineAdd — the dashed ＋ becomes the address box in place.
        h(InlineAdd,{open:draft!==null,onOpen:()=>{setDraft('');setProblem('');},onCancel:()=>{setDraft(null);setProblem('');},onConfirm:add,
            value:draft||'',onChange:v=>{setDraft(v);setProblem('');},inputRef:input,className:'ap-pack-row is-new ap-cat-new-source',inputClassName:'ap-new-input',
            label:'目录地址',placeholder:'https://',spellCheck:false,busy:work.busy,tile:h(CatAddTile,{label:'添加目录来源',className:'ap-cat-add-row'})},
          h(Button,{className:'ap-solid-pill',disabled:work.busy||!(draft||'').trim(),onClick:add},'添加'),h(IconButton,{icon:'close',label:'取消添加',onClick:()=>{setDraft(null);setProblem('');}})),
        problem&&h('p',{role:'alert',className:'ap-cat-problem'},problem)),
      h('section',{className:'ap-section ap-cat-section'},h('header',{className:'ap-section-head'},h('h3',null,'下载')),
        h(Row,{label:'首选下载源',help:'同一个素材包有多个下载地址时，默认用这一个；安装时还可以换。'},
          h(CatSelect,{label:'首选下载源',value:values.preferredDownloadId||'',disabled:work.busy,onChange:id=>save(v=>({...v,preferredDownloadId:id})),options:[{value:'',label:'目录默认'},...[...known].map(([value,label])=>({value,label}))]})),
        h(Row,{label:'加速镜像',htmlFor:'ap-cat-mirror',help:'第三方加速下载地址，下载时加在原链接前面，下载完仍会核对文件。'},
          h(CommitInput,{id:'ap-cat-mirror',className:'ap-cat-mono',value:values.mirrorPrefix||'',placeholder:'https://',spellCheck:false,validate:v=>v.trim()&&!catHttps(v)?'请输入 https 地址':'',onCommit:v=>save(x=>({...x,mirrorPrefix:v.trim()?catHttps(v):''}))}),
          values.mirrorPrefix&&h(IconButton,{icon:'close',label:'清除加速镜像',disabled:work.busy,onClick:()=>save(v=>({...v,mirrorPrefix:''}))})),
        values.mirrorPrefix&&h('div',{className:'ap-cat-mirror-example'},h('span',null,'下载时的地址会像这样'),h(CatUrl,{url:values.mirrorPrefix+'https://github.com/example/packs/releases/download/v1.0.0/pack.zip'}))),
      h(ErrorBox,{error:work.error})),
    removing&&h(ConfirmDialog,{title:'移除「'+sourceName(removing,catalogueOf(removing.sourceId))+'」？',body:'已安装的素材包会保留，但不再从这个目录检查更新。',confirmLabel:'移除',danger:true,onClose:()=>setRemoving(null),
      onConfirm:()=>saveCatalogueSettings(binding,v=>({...v,sources:v.sources.filter(x=>x.sourceId!==removing.sourceId)}))}));
}
