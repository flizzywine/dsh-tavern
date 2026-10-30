// ---------- Spine ----------
// the figure editor's Spine view and its dialog (替换 / 调整). The injected kit (client:
// spine-preview.js, `spineKit`) reads skeletons and draws the live preview; without it (tests, public builds) the
// Spine view and the import entry are absent. The folder / ZIP / drop readers and the 导入模型 sheet are shared with Live2D
// (asset-pack-import-ui.js).

function spineImageKind(b) {
  const ascii=(i,j)=>String.fromCharCode(...b.subarray(i,j));
  return b[0]===0x89&&ascii(1,4)==='PNG'?'png':b[0]===0xff&&b[1]===0xd8&&b[2]===0xff?'jpg':ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'?'webp':'';
}
// Atlas pages are the first line of each blank-line separated block (asset-packs/spine.js spineAtlasPages); `rename`
// rewrites those lines only.
function spineAtlasEdit(text,rename={}) {
  let expect=true;const pages=[];
  const lines=text.split(/\r?\n/).map(raw=>{const line=raw.trim();if(!line){expect=true;return raw;}if(!expect)return raw;expect=false;pages.push(line);return rename[line]??raw;});
  return {pages,text:lines.join('\n')};
}
// The one skeleton (.skel / .json at any depth, an .atlas in its folder: spineSkeletonCandidates), its atlas and the
// atlas pages, rebased so the skeleton is at the bundle root. The atlas is the folder's only one, else the one whose pages
// are all there, else the skeleton's namesake; it is stored as <skeleton>.atlas (the pack service's rule). A page whose
// bytes are another image type than its extension says (BA ships WebP named *.png) is renamed and the atlas line fixed;
// everything else in the folder stays behind.
async function prepareFigureSpine(entries) {
  const files=entries.filter(e=>!/(^|\/)(__MACOSX\/|\.)/.test(e.path)),byPath=new Map(files.map(e=>[e.path,e]));
  const skeletons=spineSkeletonCandidates(files);
  if(skeletons.length!==1)throw new Error(skeletons.length?'找到多个 Spine 骨骼，一次只导入一个':'没有找到 Spine 骨骼：需要 .skel 或 .json，同一文件夹里有 .atlas');
  const skeleton=skeletons[0],slash=skeleton.path.lastIndexOf('/'),dir=skeleton.path.slice(0,slash+1),entry=skeleton.path.slice(slash+1);
  const atlases=await Promise.all(files.filter(e=>modelDirOf(e.path)===dir&&/\.atlas$/i.test(e.path)).map(async e=>{const bytes=await e.read(),text=new TextDecoder().decode(bytes);
    return {path:e.path,bytes,text,complete:spineAtlasEdit(text).pages.every(page=>byPath.has(dir+page))};}));
  const complete=atlases.filter(a=>a.complete),stem=skeleton.path.replace(/\.(skel|json)$/i,'.atlas');
  const atlas=atlases.length===1?atlases[0]:complete.length===1?complete[0]:atlases.find(a=>a.path===stem);
  if(!atlas)throw new Error('这个文件夹里有多个 .atlas，分不出哪个属于「'+entry+'」');
  const atlasOf=path=>path.replace(/\.(skel|json)$/i,'.atlas');
  const atlasBytes=atlas.bytes,atlasText=atlas.text,{pages}=spineAtlasEdit(atlasText);
  if(!pages.length)throw new Error('图集里没有图片页');
  const out=new Map([[entry,await skeleton.read()]]),rename={};
  for(const page of pages){
    const found=byPath.get(dir+page);if(!found)throw new Error('缺少图集页：'+page);
    const bytes=await found.read(),kind=spineImageKind(bytes),ext=/\.([^./]+)$/.exec(page)?.[1]?.toLowerCase()||'';
    if(!kind)throw new Error('图集页不是 PNG、WebP 或 JPEG 图片：'+page);
    const name=ext===kind||kind==='jpg'&&ext==='jpeg'?page:page.replace(/(\.[^./]*)?$/,'.'+kind);
    if(name!==page)rename[page]=name;
    if(out.has(name))throw new Error('图集页重名：'+name);
    out.set(name,bytes);
  }
  const renamed=Object.keys(rename);
  out.set(atlasOf(entry),renamed.length?new TextEncoder().encode(spineAtlasEdit(atlasText,rename).text):atlasBytes);
  if([...out.values()].reduce((n,b)=>n+b.length,0)>256*1024*1024)throw new Error('模型文件过大（上限 256 MB）');
  return {entry,files:out,renamed,descriptor:{kind:'spine',entry}};
}
const spineBundleIdentity=(pack,outfit)=>JSON.stringify([pack?.manifest.id,outfit?.spine?.bundleKey,pack?.manifest.bundles?.[outfit?.spine?.bundleKey]?.contentHash]);
// The outfit's installed rig, leased through the pack transport; one source object per bundle identity.
function useSpineBundleSource(binding,pack,outfit) {
  const identity=outfit?.spine?spineBundleIdentity(pack,outfit):'',ref=React.useRef(null),svc=binding.service;
  if(!ref.current||ref.current.identity!==identity){
    const bundleKey=outfit?.spine?.bundleKey,packId=pack?.manifest.id;
    ref.current={identity,source:spineKit&&identity&&typeof svc?.leaseBundle==='function'?{identity,async open(){
      const lease=await svc.leaseBundle({packId,bundleKey});return {source:spineKit.leaseSource(lease.url),close:()=>{svc.releaseLease?.(lease.ticket);}};}}:null};
  }
  return ref.current.source;
}
let spineLocalSerial=0;
const spineLocalSource=prepared=>({identity:'local:'+(++spineLocalSerial),open:async()=>{const source=spineKit.localSource(prepared.files,prepared.entry);return {source,close:()=>source.close()};}});
// the Spine runtime is imported by the user (cubism-core.js SpineRuntimeEntry: the
// licence page, the pixi-spine download page, then import). Without it nothing can read a rig, so the sheets show that
// entry instead of the read error and read again once it is in. Absent in standalone harnesses.
const spineRuntimeKit=typeof SpineRuntimeEntry==='function'&&typeof useRuntimeStatus==='function';
const useSpineRuntimeRevision=()=>spineRuntimeKit?React.useSyncExternalStore(spineRuntimeState.subscribe,spineRuntimeState.snapshot):0;
const spineRuntimeRequest=binding=>(method,args)=>binding.rpc(method,args);
function useSpineRuntime(binding) {
  const request=React.useMemo(()=>spineRuntimeKit&&typeof binding?.rpc==='function'?spineRuntimeRequest(binding):null,[binding]);
  const read=spineRuntimeKit?useRuntimeStatus('spine',request||spineRuntimeIdle):null;
  return {missing:!!request&&!!read.status&&!read.installed,request};
}
const spineRuntimeIdle=()=>new Promise(()=>{});
function SpineRuntimeLine({runtime}) {
  return runtime.missing?h('div',{className:'ap-model-runtime'},h(SpineRuntimeEntry,{request:runtime.request})):null;
}
// The skeleton's names: {status: idle | loading | ready | error, info: {version, animations, skins, slots}, error}.
function useSpineInfo(source) {
  const identity=source?.identity||'',[state,setState]=React.useState({identity:'',status:'idle',info:null,error:''}),runtimeRevision=useSpineRuntimeRevision();
  React.useEffect(()=>{
    if(!source||!spineKit)return;
    let live=true;setState({identity,status:'loading',info:null,error:''});
    spineKit.inspect(source).then(info=>{if(live)setState({identity,status:'ready',info,error:''});},error=>{if(live)setState({identity,status:'error',info:null,error:'无法读取这个骨骼（支持 Spine 3.8 / 4.0 / 4.1）：'+errorText(error)});});
    return()=>{live=false;};
  },[identity,runtimeRevision]);
  return state.identity===identity?state:{status:source?'loading':'idle',info:null,error:''};
}
// Track 0 for an emotion, the stage's own rule (selectPackFigure + packSpineInputs): its mapping, else the default
// emotion's, else 待机.
function spineEmotionAnimation(spine,id,defaultEmotion) {
  const map=spine?.emotionMap||{};
  return {animation:map[id]?.animation||map[defaultEmotion]?.animation||spine?.defaultAnimation||'',talk:map[id]?.talk||map[defaultEmotion]?.talk||spine?.talkAnimation||''};
}
// Menu options: an empty choice, the skeleton's animations, and a mapped name the skeleton lacks (marked).
function spineOptions(names,value,empty) {
  return [...(empty?[{value:'',label:empty}]:[]),...(names||[]).map(n=>({value:n,label:n})),...(value&&names&&!names.includes(value)?[{value,label:value,note:'骨骼里没有'}]:[])];
}
// Mapped animations the skeleton lacks — on stage each falls back to 待机 (the runtime only warns once in the console).
function spineMissing(spine,names,rows) {
  if(!names)return [];
  const label=Object.fromEntries(rows.map(r=>[r.id,r.label])),out=[];
  const want=(name,where)=>{if(name&&!names.includes(name))out.push({name,where});};
  want(spine.defaultAnimation,'待机');want(spine.talkAnimation,'说话');
  for(const [id,entry] of Object.entries(spine.emotionMap||{})){want(entry.animation,(label[id]||id)+' 循环动画');want(entry.talk,(label[id]||id)+' 说话动画');}
  return out;
}
function SpineMissingLines({missing}) {
  return missing.map(m=>h('p',{key:m.where+m.name,className:'ap-warn',role:'status'},'\u26a0 骨骼里没有「'+m.name+'」（'+m.where+'），舞台上会改用待机'));
}
// The opened 差分's Spine mapping in the editor's detail block (the Live2D 表情 / 动作 rows' place).
function SpineEmotionMap({binding,pack,outfit,row,writeOutfit}) {
  const source=useSpineBundleSource(binding,pack,outfit),names=useSpineInfo(source).info?.animations||null,entry=outfit.spine.emotionMap?.[row.id]||{};
  const set=(field,value)=>writeOutfit(o=>{
    const map={...(o.spine.emotionMap||{})},next={...map[row.id]};if(value)next[field]=value;else delete next[field];
    if(Object.keys(next).length)map[row.id]=next;else delete map[row.id];
    const spine={...o.spine,emotionMap:map};if(!Object.keys(map).length)delete spine.emotionMap;return {...o,spine};
  });
  const missing=names?[entry.animation,entry.talk].filter(n=>n&&!names.includes(n)):[];
  return h('div',{className:'ap-map-panel',role:'group','aria-label':'Spine'},
    [['animation','循环动画','同待机'],['talk','说话动画','同说话']].map(([field,label,empty])=>h(InlineField,{key:field,kind:'menu',label,controlLabel:row.label+' '+label,value:entry[field]||'',disabled:!names,
      options:spineOptions(names,entry[field],empty),onCommit:v=>set(field,v)})),
    missing.map(n=>h('p',{key:n,className:'ap-warn',role:'status'},'\u26a0 骨骼里没有「'+n+'」，舞台上会改用待机')));
}
// The skeleton's first defaults (owner-approved Spine rule, spine-figures.md §10.3): 待机 its first Idle* (else its first
// animation), 说话 its Talk*_M (else any Talk*). An existing choice stays.
const spineDefaults=(s,names)=>s.defaultAnimation?s:{...s,defaultAnimation:names.find(n=>/^idle/i.test(n))||names[0]||'',talkAnimation:s.talkAnimation||names.find(n=>/^talk.*_m$/i.test(n))||names.find(n=>/^talk/i.test(n))||''};
// The block the outfit stores: empty choices are left out (validateSpineOutfit wants no empty maps).
const spineBlock=spine=>({defaultAnimation:spine.defaultAnimation,...(spine.talkAnimation?{talkAnimation:spine.talkAnimation}:{}),...(Object.keys(spine.emotionMap).length?{emotionMap:spine.emotionMap}:{}),...(spine.hideSlots.length?{hideSlots:spine.hideSlots}:{})});
// The live preview box's content: the rig playing the chosen 差分, and the button that adds the talk track.
function SpineStage({source,config,play,talking,setTalking,names,label}) {
  return h(React.Fragment,null,source&&spineKit?h(spineKit.Preview,{source,config,animation:play.animation,talk:play.talk,talking,label}):h('span',{className:'ap-empty'},'拖入文件夹或 ZIP'),
    source&&names&&play.talk&&h('span',{className:'ap-spine-talk'},h(IconButton,{icon:'voice',label:talking?'停止说话动画':'试播说话动画','aria-pressed':talking,onClick:()=>setTalking(!talking)})));
}
// 待机 / 说话 / 隐藏插槽, then the folded per-差分 table (循环动画, 说话动画: ModelEmotionTable, asset-pack-import-ui.js), and
// the ⚠ lines for mapped names the skeleton lacks. Both columns are disabled when the skeleton has no animation besides
// 待机 (a choice already made keeps them enabled).
function SpineFields({names,spine,setSpine,rows,shown,setShown}) {
  const setMap=(id,field,value)=>setSpine(s=>{const map={...s.emotionMap},next={...map[id]};if(value)next[field]=value;else delete next[field];if(Object.keys(next).length)map[id]=next;else delete map[id];return {...s,emotionMap:map};});
  const empty=names.every(n=>n===spine.defaultAnimation)&&!Object.keys(spine.emotionMap).length,only='这个模型除了待机没有别的动画，各差分都播待机。';
  const columns=[
    {field:'animation',label:'循环动画',empty,help:empty?only:'这个差分代替待机一直循环的动画，比如愤怒时跺脚。',
      options:entry=>spineOptions(names,entry.animation,'同待机'),commit:(r,v)=>{setShown(r.id);setMap(r.id,'animation',v);}},
    {field:'talk',label:'说话动画',empty,help:empty?only:'这个差分说话时播放的动画，比如生气时大声喘。',
      options:entry=>spineOptions(names,entry.talk,'同说话'),commit:(r,v)=>{setShown(r.id);setMap(r.id,'talk',v);}}];
  return h(React.Fragment,null,
    h(InlineGrid,{label:'Spine 动画',columns:1},
      h(InlineField,{kind:'menu',label:'待机',controlLabel:'待机动画',value:spine.defaultAnimation,options:spineOptions(names,spine.defaultAnimation,''),onCommit:v=>setSpine(s=>({...s,defaultAnimation:v})),
        help:h(Help,{label:'待机 说明',text:'角色平时一直循环的动画，比如呼吸的 idle；没设循环动画的差分都播它。'})}),
      h(InlineField,{kind:'menu',label:'说话',controlLabel:'说话动画',value:spine.talkAnimation,options:spineOptions(names,spine.talkAnimation,'无'),onCommit:v=>setSpine(s=>({...s,talkAnimation:v})),
        help:h(Help,{label:'说话 说明',text:'角色说话时播放的动画，比如配音响起时嘴巴开合的 talk。'})}),
      h(InlineField,{kind:'chips',label:'隐藏插槽',controlLabel:'隐藏插槽',value:spine.hideSlots,onCommit:v=>setSpine(s=>({...s,hideSlots:v})),
        help:h(Help,{label:'隐藏插槽 说明',text:'隐藏模型里不需要的部件，比如武器或大厅背景；填插槽名，末尾 * 表示前缀。'})})),
    h(ModelEmotionTable,{rows,columns,shown,setShown,map:spine.emotionMap,
      help:modelTuneHelp(spine.emotionMap,['animation','talk'],'全部沿用待机 / 说话','可以给某个差分换循环动画或说话动画')}),
    h(SpineMissingLines,{missing:spineMissing(spineBlock(spine),names,rows)}));
}
// 替换 / 调整 an outfit's Spine model (a new rig comes in through 导入模型). Files come from 选择文件夹 / 选择 ZIP or a drop
// anywhere on the sheet; without new files the sheet edits the outfit's current rig. The preview plays the chosen 差分;
// the voice button adds the talk track.
function SpineDialog({binding,pack,figure,outfit,onClose,onSave}) {
  const current=outfit.spine||null,rows=figureEditorEmotions(figure),defaultEmotion=outfit.defaultEmotion||rows[0]?.id||'';
  const [picked,setPicked]=React.useState(null),[reading,setReading]=React.useState(false),[saving,setSaving]=React.useState(false),[error,setError]=React.useState('');
  const [spine,setSpine]=React.useState(()=>({defaultAnimation:current?.defaultAnimation||'',talkAnimation:current?.talkAnimation||'',emotionMap:current?.emotionMap||{},hideSlots:current?.hideSlots||[]}));
  const [shown,setShown]=React.useState(defaultEmotion),[talking,setTalking]=React.useState(false);
  const installed=useSpineBundleSource(binding,pack,outfit),source=picked?picked.source:installed;
  const read=useSpineInfo(source),names=read.info?.animations||null,runtime=useSpineRuntime(binding);
  React.useEffect(()=>{if(names)setSpine(s=>spineDefaults(s,names));},[names]);
  const busy=reading||saving;
  const load=async entries=>{setReading(true);setError('');try{const prepared=await prepareFigureSpine(await entries());setPicked({...prepared,source:spineLocalSource(prepared)});}catch(e){setError(errorText(e));}finally{setReading(false);}};
  const block=spineBlock(spine),play=spineEmotionAnimation(block,shown,defaultEmotion);
  const save=async()=>{setSaving(true);setError('');try{await onSave({prepared:picked,config:block});onClose();}catch(e){setError(errorText(e));setSaving(false);}};
  const config={...block,...(picked?{bottomFade:current?.bottomFade}:{skin:current?.skin,frame:current?.frame,anatomy:current?.anatomy,bottomFade:current?.bottomFade})};
  const ready=!!source&&!!names&&!!spine.defaultAnimation;
  return h(CatSheet,{title:'Spine 模型',className:'ap-model-sheet',onClose,busy,frame:modelDropFrame(busy,load,'spine'),
      foot:h(React.Fragment,null,h(Button,{disabled:busy,onClick:onClose},'取消'),h(Button,{primary:true,disabled:busy||!ready,onClick:save},saving?'正在保存…':picked?'导入':'保存'))},
    h('div',{className:'ap-model-import'},
      h('div',{className:'ap-model-stage','data-empty':!source||undefined},h(SpineStage,{source,config,play,talking,setTalking,names,label:figure.name})),
      h('div',{className:'ap-model-form'},
        h('div',{className:'ap-model-file'},
          h('span',{className:'ap-model-file-name'},picked?picked.entry:current?'当前模型':'拖入文件夹或 ZIP',read.info?.version?h('span',{className:'ap-model-version'},' · Spine '+read.info.version):null),h(ModelPickers,{busy,load})),
        h(SpineRuntimeLine,{runtime}),
        reading&&h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在读取…'),
        picked?.renamed.length>0&&h('p',{className:'ap-notice',role:'status'},picked.renamed.length+' 个图集页的扩展名与内容不符，已改名并同步图集'),
        read.status==='loading'&&!reading&&h('p',{className:'ap-loading',role:'status'},h(Spinner),'正在读取骨骼…'),
        read.error&&!runtime.missing&&h('p',{className:'ap-alert',role:'alert'},'\u26a0 ',read.error),
        error&&h('p',{className:'ap-alert',role:'alert'},'\u26a0 ',error),
        names&&h(SpineFields,{names,spine,setSpine,rows,shown,setShown}))));
}
