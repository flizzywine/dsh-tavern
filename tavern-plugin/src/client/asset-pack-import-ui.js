// ---------- 导入模型 ----------
// one importer for raw Live2D and Spine models. Files come from 选择文件夹 / 选择 ZIP or a
// drop anywhere on the sheet (or on the pack window); the kind is what the files declare (a model3.json → Live2D, a
// .skel / .json beside a same-named .atlas → Spine). From the pack it makes a new figure + outfit or adds / replaces an
// outfit of an existing figure; from a figure's outfit it imports into that outfit. Live2D: the model's own expressions
// and motion groups fill the menus (exact names only, never guessed), the chosen 待机 becomes the model's Idle group
// when it is not one already. The pack service validates the bundle once, at import (validation.js).

// begin model-import-core
// A picked folder, a dropped folder or a ZIP becomes entries {path, read()} with '/'-separated relative paths.
const MODEL_ENTRY_LIMIT=4096;
const modelFileEntries=files=>files.map(file=>({path:(file.webkitRelativePath||file.name).replace(/\\/g,'/'),read:async()=>new Uint8Array(await file.arrayBuffer())}));
// Stored / deflated entries of a plain ZIP (no ZIP64), inflated by the browser.
async function modelZipEntries(file) {
  const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];
  let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('不是有效的 ZIP 文件');
  let at=view.getUint32(end+16,true);
  for(let n=view.getUint16(end+10,true);n>0;n--){
    if(at+46>bytes.length||view.getUint32(at,true)!==0x02014b50)throw new Error('ZIP 目录损坏');
    const method=view.getUint16(at+10,true),size=view.getUint32(at+20,true),nameLength=view.getUint16(at+28,true),local=view.getUint32(at+42,true);
    // Windows PowerShell 5 writes backslash-separated names.
    const path=new TextDecoder().decode(bytes.subarray(at+46,at+46+nameLength)).replace(/\\/g,'/');
    at+=46+nameLength+view.getUint16(at+30,true)+view.getUint16(at+32,true);
    if(path.endsWith('/'))continue;
    if(method!==0&&method!==8)throw new Error('ZIP 里有不支持的压缩方式：'+path);
    const start=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true),data=bytes.subarray(start,start+size);
    out.push({path,read:async()=>method===0?data:new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())});
  }
  return out;
}
// Must start inside the drop event: the items are read synchronously before the first await.
async function modelDropEntries(transfer) {
  const roots=[...(transfer?.items||[])].map(item=>item.webkitGetAsEntry?.()).filter(Boolean),files=[...(transfer?.files||[])];
  if(!roots.length)return files.length===1&&/\.zip$/i.test(files[0].name)?modelZipEntries(files[0]):modelFileEntries(files);
  const fileOf=entry=>new Promise((resolve,reject)=>entry.file(resolve,reject));
  if(roots.length===1&&roots[0].isFile&&/\.zip$/i.test(roots[0].name))return modelZipEntries(await fileOf(roots[0]));
  const out=[];
  async function walk(entry,prefix){
    if(out.length>MODEL_ENTRY_LIMIT)throw new Error('文件太多，请只拖入这个模型的文件夹');
    if(entry.isFile){const file=await fileOf(entry);out.push({path:prefix+entry.name,read:async()=>new Uint8Array(await file.arrayBuffer())});return;}
    const reader=entry.createReader();
    for(let batch;(batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject))).length;)for(const child of batch)await walk(child,prefix+entry.name+'/');
  }
  for(const root of roots)await walk(root,'');
  return out;
}
// Hidden files and macOS resource forks are never part of a model.
const modelVisibleEntries=entries=>entries.filter(e=>!/(^|\/)(__MACOSX\/|\.)/.test(e.path));
// Spine skeletons at any depth: a .skel (else a .json) in a folder that holds an .atlas. The atlas need not share the
// skeleton's name (spineboy-pro.skel + spineboy.atlas); prepareFigureSpine picks it.
const modelDirOf=p=>p.slice(0,p.lastIndexOf('/')+1);
function spineSkeletonCandidates(files) {
  const dirs=new Set(files.filter(e=>/\.atlas$/i.test(e.path)).map(e=>modelDirOf(e.path))),near=files.filter(e=>dirs.has(modelDirOf(e.path)));
  const skel=near.filter(e=>/\.skel$/i.test(e.path));
  return skel.length?skel:near.filter(e=>/\.json$/i.test(e.path));
}
// What the files are: a Live2D model3.json, else a Spine skeleton, else a clear refusal (Cubism 2 is not supported).
function modelKindOf(entries) {
  const files=modelVisibleEntries(entries);
  const models=files.filter(e=>/\.model3\.json$/i.test(e.path));
  if(models.length>1)throw new Error('找到多个 model3.json，一次只导入一个模型');
  if(models.length)return 'live2d';
  if(spineSkeletonCandidates(files).length)return 'spine';
  if(files.some(e=>/\.moc$/i.test(e.path)||/(^|\/)[^/]*\.?model\.json$/i.test(e.path)))throw new Error('这是 Cubism 2 模型（.moc / model.json），暂不支持；需要 Cubism 3 或更新版本导出的 model3.json 和 .moc3');
  throw new Error('没有找到模型：需要 Live2D 的 model3.json，或 Spine 的 .skel / .json 和同一文件夹里的 .atlas');
}
// The model3.json and only the files it references, rebased so the model3.json is at the bundle root (the same closure
// the pack service checks: modelReferences in pack-v2/model.js).
async function prepareLive2dEntries(entries) {
  const files=modelVisibleEntries(entries),models=files.filter(e=>/\.model3\.json$/i.test(e.path));
  if(models.length!==1)throw new Error(models.length?'找到多个 model3.json，一次只导入一个模型':'没有找到 model3.json');
  const model=models[0],slash=model.path.lastIndexOf('/'),base=model.path.slice(0,slash+1),entry=model.path.slice(slash+1),byPath=new Map(files.map(e=>[e.path,e]));
  const raw=await model.read();
  if(raw.length>1024*1024)throw new Error('model3.json 过大（上限 1 MB）');
  let document;try{document=JSON.parse(new TextDecoder().decode(raw));}catch(_){throw new Error('model3.json 不是有效的 JSON');}
  const refs=document?.FileReferences;
  if(document?.Version!==3||!refs||typeof refs!=='object')throw new Error('不是 Cubism 3 及以上的 model3.json');
  if(!refs.Moc||!Array.isArray(refs.Textures)||!refs.Textures.length)throw new Error('model3.json 缺少 .moc3 或纹理');
  const extra=Object.keys(refs).find(k=>!['Moc','Textures','Physics','Pose','UserData','DisplayInfo','Expressions','Motions'].includes(k));
  if(extra)throw new Error('model3.json 里有不支持的引用「'+extra+'」');
  const names=[refs.Moc,...refs.Textures,...['Physics','Pose','UserData','DisplayInfo'].map(k=>refs[k]),
    ...(Array.isArray(refs.Expressions)?refs.Expressions:[]).map(e=>e?.File),
    ...Object.values(refs.Motions&&typeof refs.Motions==='object'?refs.Motions:{}).flatMap(group=>Array.isArray(group)?group.flatMap(m=>[m?.File,m?.Sound]):[])].filter(v=>v!==undefined);
  const paths=[...new Set(names)];
  if(paths.length>511)throw new Error('模型引用的文件太多（上限 512 个）');
  const unsafe=paths.find(name=>typeof name!=='string'||name.split('/').some(part=>!/^[A-Za-z0-9_@.-]{1,120}$/.test(part)||part==='.'||part==='..'));
  if(unsafe!==undefined)throw new Error('模型引用的路径不受支持：'+String(unsafe)+'（只能是模型文件夹内、由英文字母、数字和 _ @ . - 组成的相对路径）');
  const odd=paths.find(name=>!/\.(json|moc3|png|webp|jpe?g|wav|mp3|ogg|m4a|flac)$/i.test(name));
  if(odd)throw new Error('模型引用了不支持的文件类型：'+odd);
  // A model3.json saved by pixi-live2d-display carries `url`, its own path: no Cubism key, and on the stage a reference
  // back to itself (RESOURCE_BUNDLE_CYCLE, stage-resources.cjs). The installed model3.json leaves it out.
  let bytes=raw;
  if(Object.hasOwn(document,'url')){document={...document};delete document.url;bytes=new TextEncoder().encode(JSON.stringify(document,null,2));}
  const out=new Map([[entry,bytes]]);
  for(const name of paths){const found=byPath.get(base+name);if(!found)throw new Error('缺少模型文件：'+name);out.set(name,await found.read());}
  const moc=out.get(refs.Moc);
  if(String.fromCharCode(...moc.subarray(0,4))!=='MOC3')throw new Error('「'+refs.Moc+'」不是 Cubism 3 及以上的 .moc3 文件');
  if([...out.values()].reduce((n,b)=>n+b.length,0)>256*1024*1024)throw new Error('模型文件过大（上限 256 MB）');
  return {kind:'live2d',entry,document,files:out,descriptor:{kind:'live2d',entry},folder:base.replace(/\/$/,'').split('/').pop()||''};
}
// The names the model declares: expression Names and motion groups with their clips (a clip's label is its declared
// Name, else its file name).
function live2dDeclared(document) {
  const refs=document?.FileReferences||{},motions=refs.Motions&&typeof refs.Motions==='object'?refs.Motions:{};
  const stem=file=>String(file||'').split('/').pop().replace(/\.motion3\.json$/i,'');
  return {expressions:(Array.isArray(refs.Expressions)?refs.Expressions:[]).map(e=>e?.Name).filter(n=>typeof n==='string'&&n),
    groups:Object.entries(motions).filter(([,clips])=>Array.isArray(clips)&&clips.length).map(([name,clips])=>({name,clips:clips.map((clip,index)=>({index,label:typeof clip?.Name==='string'&&clip.Name?clip.Name:stem(clip?.File)}))}))};
}
// A motion choice is a menu value: a whole group ([group]: the stage plays one of its clips) or one clip ([group, index]).
const live2dRef=(group,index)=>JSON.stringify(index===undefined?[group]:[group,index]);
function live2dRefOf(value) { try{const [group,index]=JSON.parse(value);return typeof group==='string'?{group,index:Number.isInteger(index)?index:undefined}:null;}catch(_){return null;} }
function live2dMotionOptions(declared) {
  return declared.groups.flatMap(g=>g.clips.length===1?[{value:live2dRef(g.name),label:g.name}]:
    [{value:live2dRef(g.name),label:g.name+'（随机）'},...g.clips.map(c=>({value:live2dRef(g.name,c.index),label:g.name+' · '+c.label}))]);
}
// The stage's own Idle rule (gal-scene.js): the first group named Idle, any case.
const live2dIdleGroup=document=>Object.keys(document?.FileReferences?.Motions||{}).find(name=>/^idle$/i.test(name));
// Initial choices from the model's declarations only: an expression or group whose name is exactly an emotion's key;
// 待机 is the model's Idle group, else its first declared clip.
function live2dPrefill(document,rows) {
  const declared=live2dDeclared(document),groups=new Set(declared.groups.map(g=>g.name)),idle=live2dIdleGroup(document),first=declared.groups[0],map={};
  for(const row of rows){
    const entry={};
    if(declared.expressions.includes(row.id))entry.expression=row.id;
    if(groups.has(row.id))entry.motion=live2dRef(row.id);
    if(Object.keys(entry).length)map[row.id]=entry;
  }
  return {idle:idle?live2dRef(idle):first?live2dRef(first.name,first.clips.length>1?0:undefined):'',map};
}
// The installed model3.json and the outfit's emotionMap. 待机 other than the model's own Idle group becomes that group
// (named Idle when the model has none); one clip of a several-clip group gets a group of its own, Mood_<key>, because
// the stage plays a whole group. Original groups stay. `changed`: whether the model3.json differs from the source.
function live2dImportResult(document,{idle,map}) {
  const doc=JSON.parse(JSON.stringify(document)),source=document.FileReferences.Motions||{},motions={...(doc.FileReferences.Motions||{})};
  const clip=(group,index)=>JSON.parse(JSON.stringify(source[group][index]));
  const idleKey=live2dIdleGroup(document),want=live2dRefOf(idle);
  let changed=false;
  if(want&&Array.isArray(source[want.group])&&!(want.index===undefined&&want.group===idleKey)){
    const clips=want.index===undefined?source[want.group].map((_,i)=>clip(want.group,i)):[clip(want.group,want.index)];
    if(!(idleKey&&JSON.stringify(motions[idleKey])===JSON.stringify(clips))){motions[idleKey||'Idle']=clips;changed=true;}
  }
  const emotionMap={};
  for(const [id,choice] of Object.entries(map||{})){
    const entry={};
    if(typeof choice?.expression==='string'&&choice.expression)entry.expression=choice.expression;
    const ref=live2dRefOf(choice?.motion||'');
    if(ref&&Array.isArray(source[ref.group])){
      if(ref.index===undefined||source[ref.group].length===1)entry.motion=ref.group;
      else{
        const clips=[clip(ref.group,ref.index)],same=name=>JSON.stringify(motions[name])===JSON.stringify(clips);
        let name='Mood_'+id;for(let n=2;motions[name]&&!same(name);n++)name='Mood_'+id+'_'+n;
        if(!motions[name]){motions[name]=clips;changed=true;}
        entry.motion=name;
      }
    }
    if(Object.keys(entry).length)emotionMap[id]=entry;
  }
  if(changed)doc.FileReferences.Motions=motions;
  return {document:changed?doc:document,changed,emotionMap};
}
// What the preview loads: the installed document's Idle plus one private group per clip of a several-clip group, so
// trying a clip never reloads the model. `motion` maps a choice to the group the preview plays.
const LIVE2D_PREVIEW_CLIP='__fork_clip_';
function live2dPreviewDocument(document,idle) {
  const doc=JSON.parse(JSON.stringify(live2dImportResult(document,{idle,map:{}}).document)),motions=doc.FileReferences.Motions||(doc.FileReferences.Motions={});
  live2dDeclared(document).groups.forEach((g,gi)=>{if(g.clips.length>1)for(const c of g.clips)motions[LIVE2D_PREVIEW_CLIP+gi+'_'+c.index]=[JSON.parse(JSON.stringify(document.FileReferences.Motions[g.name][c.index]))];});
  return doc;
}
function live2dPreviewMotion(document,value) {
  const ref=live2dRefOf(value||''),groups=live2dDeclared(document).groups,gi=ref?groups.findIndex(g=>g.name===ref.group):-1;
  if(gi<0)return '';
  return ref.index===undefined||groups[gi].clips.length===1?ref.group:LIVE2D_PREVIEW_CLIP+gi+'_'+ref.index;
}
// The emotion list a new figure starts with: the same nine 差分 the installed packs use; 平和 is the outfit's default.
const MODEL_FIGURE_EMOTIONS=[['joy','喜悦'],['anger','愤怒'],['sad','悲伤'],['anxious','紧张'],['calm','平和'],['shy','害羞'],['disgust','嫌弃'],['love','爱恋'],['crying','哭泣']].map(([id,label])=>({id,label}));
// end model-import-core

// 选择文件夹… / 选择 ZIP… (hidden inputs out of the tab order) and the sheet-wide drop target.
function ModelPickers({busy,load}) {
  const folder=React.useRef(null),zip=React.useRef(null);
  return h('span',{className:'ap-model-pickers'},
    h(Button,{disabled:busy,onClick:()=>folder.current?.click?.()},'选择文件夹…'),h(Button,{disabled:busy,onClick:()=>zip.current?.click?.()},'选择 ZIP…'),
    h('input',{ref:folder,type:'file',multiple:true,webkitdirectory:'',hidden:true,tabIndex:-1,'aria-hidden':true,'data-for':'模型文件夹',onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';if(files.length)load(async()=>modelFileEntries(files),files[0]?.webkitRelativePath?.split('/')[0]||'');}}),
    h('input',{ref:zip,type:'file',accept:'.zip,application/zip',hidden:true,tabIndex:-1,'aria-hidden':true,'data-for':'模型 ZIP',onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)load(()=>modelZipEntries(file),file.name.replace(/\.zip$/i,''));}}));
}
const modelDragHasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
// Drop props for a sheet / window: `load(entries, name)` gets the dropped folder or ZIP. The innermost target takes it (a
// sheet opened inside the pack window: React events bubble through the portal). File drags stop here: the host composer
// listens on document and would otherwise also store the dropped files as chat attachments (and show its drop overlay).
function modelDropFrame(busy,load,name='model') {
  const own=e=>{if(!modelDragHasFiles(e))return false;e.stopPropagation();return true;};
  return {'data-drop':name,onDragEnter:own,onDragLeave:own,
    onDragOver:e=>{if(!own(e)||e.defaultPrevented)return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect=busy?'none':'copy';},
    onDrop:e=>{if(!own(e)||e.defaultPrevented)return;e.preventDefault();if(busy)return;const transfer=e.dataTransfer,first=[...(transfer?.files||[])][0];load(()=>modelDropEntries(transfer),first?.name?.replace(/\.zip$/i,'')||'');}};
}
// The pack service's refusal of a bundle (its one check, validation.js), in Chinese; the host's reason rides along.
const MODEL_IMPORT_ERRORS={INVALID_ASSET_PACK:'模型文件没有通过校验：贴图、动作、表情或骨骼文件可能损坏或格式不对',INVALID_JSON:'模型里有无效的 JSON 文件',
  INVALID_PATH:'模型里有不受支持的文件路径',FILE_CLOSURE_MISMATCH:'模型文件不完整，请重新选择整个模型文件夹',LIMIT_EXCEEDED:'模型文件过大或数量过多'};
// The detail rides along only when it is plain Chinese (shared playerErrorText; a file path or validator English stays in the console).
const modelImportError=e=>{if(!MODEL_IMPORT_ERRORS[e?.code])return errorText(e);const why=typeof e.detail==='string'&&e.detail?playerErrorText(e.detail,{fallback:''}):'';return MODEL_IMPORT_ERRORS[e.code]+(why?'（'+why+'）':'');};
// Read entries into a prepared model of either kind.
let modelPreparedSerial=0;
async function prepareModelEntries(entries) {
  const kind=modelKindOf(entries);
  const prepared=kind==='live2d'?await prepareLive2dEntries(entries):{kind:'spine',...await prepareFigureSpine(modelVisibleEntries(entries))};
  return {...prepared,serial:++modelPreparedSerial};
}
// the per-差分 table of either kind, folded by default behind 「按差分细调（可选）」
// with no inline text: its 「?」 says what is set (`help`). Every column stays; one the model offers nothing for
// (`empty`) shows its menus disabled and its head 「?」 says why. No grey explanatory lines in the pane.
// Column {field, label, help, empty, options(entry, row), commit(row, value)}; the column labels and their 「?」 are one
// head line, each row's menus keep their names for assistive tech.
function ModelEmotionTable({rows,columns,shown,setShown,map,help}) {
  return h(StageSection,{level:2,title:'按差分细调（可选）',foldKey:'model-import:emotions',defaultFolded:true,className:'ap-model-tune',help},
    h('div',{className:'ap-model-row ap-model-head','data-cols':columns.length},h('span',{className:'ap-model-head-name'},'差分'),
      columns.map(c=>h('span',{key:c.field,className:'ap-model-col','data-disabled':c.empty||undefined},c.label,h(Help,{label:c.label+' 说明',text:c.help})))),
    h('div',{className:'ap-model-rows',role:'list'},rows.map(r=>{const entry=map[r.id]||{};
      return h('div',{key:r.id,role:'listitem',className:'ap-model-row','data-cols':columns.length,'data-selected':shown===r.id||undefined},
        h('button',{type:'button',className:'ap-model-row-name','aria-pressed':shown===r.id,title:'预览「'+r.label+'」',onClick:()=>setShown(r.id)},r.label),
        columns.map(c=>h(InlineField,{key:c.field,kind:'menu',label:c.label,hideLabel:true,controlLabel:r.label+' '+c.label,value:entry[c.field]||'',disabled:!!c.empty,options:c.options(entry,r),onCommit:v=>c.commit(r,v)})));})));
}
// The disclosure's 「?」: what is set (「已设置 N 项」 or what every 差分 falls back to), then what the table is for.
const modelTuneHelp=(map,fields,none,what)=>{const n=Object.values(map||{}).reduce((sum,entry)=>sum+fields.filter(f=>entry?.[f]).length,0);return (n?'已设置 '+n+' 项':none)+'；'+what+'，点差分名预览。';};
// The Live2D mapping: 待机, then the folded per-差分 table — 表情 and 开场动作 menus of the model's declared names. A column
// is disabled when the model offers nothing for it: 表情 without declared expressions, 开场动作 without motions outside the
// 待机 group (a choice already made keeps it enabled).
function Live2dImportFields({document,choice,setChoice,rows,defaultEmotion,shown,setShown}) {
  const declared=live2dDeclared(document),motions=live2dMotionOptions(declared);
  const defaultLabel=rows.find(r=>r.id===defaultEmotion)?.label||'默认';
  const set=(id,field,value)=>{setShown(id);setChoice(c=>{const map={...c.map},next={...map[id]};if(value)next[field]=value;else delete next[field];if(Object.keys(next).length)map[id]=next;else delete map[id];return {...c,map};});};
  const expressions=declared.expressions.map(n=>({value:n,label:n})),idleGroup=live2dRefOf(choice.idle||'')?.group;
  const used=field=>Object.values(choice.map).some(entry=>entry?.[field]);
  const hasExpressions=expressions.length>0||used('expression'),hasMotions=motions.some(o=>live2dRefOf(o.value)?.group!==idleGroup)||used('motion');
  const columns=[
    {field:'expression',label:'表情',empty:!hasExpressions,help:hasExpressions?'这个差分用模型自带的哪个表情，比如喜悦选 Smile。':'这个模型没有自带表情，各差分都显示'+defaultLabel+'。',
      options:(entry,r)=>[{value:'',label:r.id===defaultEmotion||entry.motion?'模型原样':'同'+defaultLabel},...expressions],commit:(r,v)=>set(r.id,'expression',v)},
    {field:'motion',label:'开场动作',empty:!hasMotions,help:hasMotions?'切到这个差分时播一次的动作，比如害羞时低头，播完回到待机。':'这个模型除了待机没有别的动作，各差分都只播待机。',
      options:()=>[{value:'',label:'无'},...motions],commit:(r,v)=>set(r.id,'motion',v)}];
  return h(React.Fragment,null,
    h(InlineGrid,{label:'Live2D 动作',columns:1},
      h(InlineField,{kind:'menu',label:'待机',controlLabel:'待机动作',value:choice.idle,disabled:!motions.length,placeholder:'模型没有动作',options:motions,onCommit:v=>setChoice(c=>({...c,idle:v})),
        help:h(Help,{label:'待机 说明',text:'舞台上一直循环的动作，比如轻轻呼吸摇摆；不是模型自己的 Idle 组时导入会把它设为 Idle。'})})),
    h(ModelEmotionTable,{rows,columns,shown,setShown,map:choice.map,
      help:modelTuneHelp(choice.map,['expression','motion'],'全部沿用'+defaultLabel+' / 待机','可以给某个差分换表情或加开场动作')}));
}
// Where the model goes (from the pack window): a new figure, or a new / existing outfit of a figure in this pack.
const NEW_TARGET='@new';
// A new outfit's starting name: 默认 on a new figure; on an existing figure (which has its own 默认) the model's name, until
// the name is edited.
const modelOutfitLabel=(t,figure)=>t.outfitEdited?t.outfitLabel:figure===NEW_TARGET?'默认':t.suggested||'新服装';
// an outfit has one model, so importing into one that has a model (either kind) replaces it.
// The line names the picked model's kind and the current one's (outfitModelKind), e.g. 「Spine 模型会替换「女仆装」现有的模型
// （Live2D）」; an outfit without a model shows no line (no explanatory text in the pane).
const MODEL_KIND_NAMES={live2d:'Live2D',spine:'Spine'};
const modelReplaceNote=(outfit,kind)=>{
  if(!outfit||!(outfit.live2d||outfit.spine)||!MODEL_KIND_NAMES[kind])return null;
  return h('p',{className:'ap-notice',role:'status'},MODEL_KIND_NAMES[kind]+' 模型会替换「'+outfit.label+'」现有的模型（'+MODEL_KIND_NAMES[outfitModelKind(outfit)]+'）');
};
function ModelTargetFields({pack,target,setTarget,kind}) {
  const figures=pack.manifest.figures.map(id=>pack.figures[id]).filter(Boolean),figure=target.figure===NEW_TARGET?null:pack.figures[target.figure];
  const outfit=figure?.outfits.find(o=>o.key===target.outfit)||null;
  const named=(v,max)=>v.trim()?[...v.trim()].length<=max?'':'最多 '+max+' 字':'请填写名称';
  return h(React.Fragment,null,h(InlineGrid,{label:'导入到',columns:1},
      h(InlineField,{kind:'menu',label:'人物',controlLabel:'导入到人物',value:target.figure,options:[{value:NEW_TARGET,label:'新人物'},...figures.map(f=>({value:f.id,label:f.name}))],
        onCommit:v=>setTarget(t=>({...t,figure:v,outfit:NEW_TARGET,outfitLabel:modelOutfitLabel(t,v)}))}),
      !figure&&h(InlineField,{key:'name',kind:'text',label:'名称',controlLabel:'新人物名称',value:target.name,maxLength:40,validate:v=>named(v,40),onCommit:v=>setTarget(t=>({...t,name:v.trim()}))}),
      figure&&h(InlineField,{key:'outfit',kind:'menu',label:'服装',controlLabel:'导入到服装',value:target.outfit,options:[{value:NEW_TARGET,label:'新服装'},...figure.outfits.map(o=>({value:o.key,label:o.label}))],
        onCommit:v=>setTarget(t=>({...t,outfit:v}))}),
      (!figure||target.outfit===NEW_TARGET)&&h(InlineField,{key:'outfit-name',kind:'text',label:'服装名',controlLabel:'新服装名称',value:target.outfitLabel,maxLength:40,validate:v=>named(v,40),onCommit:v=>setTarget(t=>({...t,outfitLabel:v.trim(),outfitEdited:true}))})),
    modelReplaceNote(outfit,kind));
}
// The sheet. `fixed` ({figureId, outfitKey}): import into that outfit (from the figure editor); else the target fields
// show. `pending`: entries already being read (a drop on the pack window). onImport({kind, prepared, config, target}).
function ModelImportSheet({binding,pack,fixed=null,pending=null,onClose,onImport}) {
  const [picked,setPicked]=React.useState(null),[reading,setReading]=React.useState(false),[saving,setSaving]=React.useState(false),[error,setError]=React.useState('');
  const [target,setTarget]=React.useState({figure:NEW_TARGET,name:'',outfit:NEW_TARGET,outfitLabel:'默认'});
  const figureId=fixed?fixed.figureId:target.figure===NEW_TARGET?null:target.figure,figure=figureId?pack.figures[figureId]:null;
  const outfitKey=fixed?fixed.outfitKey:target.outfit===NEW_TARGET?null:target.outfit,outfit=figure?.outfits.find(o=>o.key===outfitKey)||null;
  const rows=figure?figureEditorEmotions(figure):MODEL_FIGURE_EMOTIONS;
  const defaultEmotion=outfit?.defaultEmotion||(figure?figure.outfits.find(o=>o.defaultEmotion)?.defaultEmotion||(rows.some(r=>r.id==='calm')?'calm':rows[0]?.id):'calm')||'';
  const [shown,setShown]=React.useState(defaultEmotion);
  // Live2D choices; Spine keeps the Spine dialog's block.
  const [choice,setChoice]=React.useState({idle:'',map:{}});
  const [spine,setSpine]=React.useState({defaultAnimation:'',talkAnimation:'',emotionMap:{},hideSlots:[]}),[talking,setTalking]=React.useState(false);
  const busy=reading||saving,kind=picked?.kind||null;
  const load=async(entries,name)=>{setReading(true);setError('');
    try{const prepared=await prepareModelEntries(await entries());
      if(prepared.kind==='spine'&&!spineKit)throw new Error('这里没有 Spine 运行库，不能导入 Spine 模型');
      setPicked({...prepared,source:prepared.kind==='spine'?spineLocalSource(prepared):null});
      if(prepared.kind==='live2d')setChoice(live2dPrefill(prepared.document,rows));
      else setSpine({defaultAnimation:'',talkAnimation:'',emotionMap:{},hideSlots:[]});
      const suggested=(prepared.folder||name||'').trim()||prepared.entry.replace(/(\.model3)?\.[^.]+$/i,'');
      setTarget(t=>{const next={...t,suggested:[...suggested].slice(0,40).join('')};if(!t.name)next.name=next.suggested;next.outfitLabel=modelOutfitLabel(next,t.figure);return next;});}
    catch(e){setError(errorText(e));}finally{setReading(false);}};
  React.useEffect(()=>{if(pending)load(()=>pending.entries,pending.name);},[]);
  // A different target figure has its own 差分: Live2D choices restart from the model's declarations.
  React.useEffect(()=>{if(picked?.kind==='live2d')setChoice(c=>({idle:c.idle,map:live2dPrefill(picked.document,rows).map}));if(!rows.some(r=>r.id===shown))setShown(defaultEmotion);},[figureId]);
  const spineRead=useSpineInfo(kind==='spine'?picked.source:null),names=spineRead.info?.animations||null,spineRuntime=useSpineRuntime(binding);
  React.useEffect(()=>{if(names)setSpine(s=>spineDefaults(s,names));},[names]);
  const block=spineBlock(spine),play=spineEmotionAnimation(block,shown,defaultEmotion);
  const result=kind==='live2d'?live2dImportResult(picked.document,choice):null;
  const ready=kind==='live2d'||kind==='spine'&&!!names&&!!spine.defaultAnimation;
  const targetOk=fixed||(figure?true:!!target.name.trim())&&(figure&&target.outfit!==NEW_TARGET||!!target.outfitLabel.trim());
  const save=async()=>{setSaving(true);setError('');
    try{
      const prepared=kind==='live2d'?{...picked,files:result.changed?new Map([...picked.files,[picked.entry,new TextEncoder().encode(JSON.stringify(result.document,null,2))]]):picked.files}:picked;
      await onImport({kind,prepared,config:kind==='live2d'?{emotionMap:result.emotionMap}:block,
        target:{figureId,outfitKey,name:target.name.trim(),outfitLabel:target.outfitLabel.trim()||'默认',emotions:figure?null:MODEL_FIGURE_EMOTIONS,defaultEmotion}});
      onClose();
    }catch(e){setError(modelImportError(e));}finally{setSaving(false);}};
  const entry=kind==='live2d'?choice.map[shown]||choice.map[defaultEmotion]||{}:null;
  const stage=    kind==='spine'?h(SpineStage,{source:picked.source,config:{...block},play,talking,setTalking,names,label:'Spine 预览'}):h('span',{className:'ap-empty'},'拖入文件夹或 ZIP');
  const version=kind==='spine'&&spineRead.info?.version?' · Spine '+spineRead.info.version:kind==='live2d'?' · Live2D':'';
  return h(CatSheet,{title:'导入模型',className:'ap-model-sheet',onClose,busy,frame:modelDropFrame(busy,load),
      foot:h(React.Fragment,null,h(Button,{disabled:busy,onClick:onClose},'取消'),h(Button,{primary:true,disabled:busy||!picked||!ready||!targetOk,onClick:save},saving?'正在导入…':'导入'))},
    h('div',{className:'ap-model-import'},
      h('div',{className:'ap-model-stage','data-empty':!picked||undefined},stage),
      h('div',{className:'ap-model-form'},
        h('div',{className:'ap-model-file'},h('span',{className:'ap-model-file-name'},picked?picked.entry:'未选择模型',version&&h('span',{className:'ap-model-version'},version)),h(ModelPickers,{busy,load})),
        reading&&h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在读取…'),
        error&&h('p',{className:'ap-alert',role:'alert'},'\u26a0 ',error),
        kind==='spine'&&picked.renamed.length>0&&h('p',{className:'ap-notice',role:'status'},picked.renamed.length+' 个图集页的扩展名与内容不符，已改名并同步图集'),
        kind==='spine'&&spineRead.status==='loading'&&h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在读取骨骼…'),
        kind==='spine'&&h(SpineRuntimeLine,{runtime:spineRuntime}),
        kind==='spine'&&spineRead.error&&!spineRuntime.missing&&h('p',{className:'ap-alert',role:'alert'},'\u26a0 ',spineRead.error),
        picked&&(fixed?modelReplaceNote(outfit,kind):h(ModelTargetFields,{pack,target,setTarget,kind})),
        kind==='live2d'&&h(Live2dImportFields,{document:picked.document,choice,setChoice,rows,defaultEmotion,shown,setShown}),
        kind==='spine'&&names&&h(SpineFields,{names,spine,setSpine,rows,shown,setShown}))));
}
