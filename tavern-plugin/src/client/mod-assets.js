// a mod's own asset library. Packs are level-2 sections (thumb strip · name ·
// count · 全局/本卡/关 chip); image entries are tiles with a detail block below the grid (ui-design §三.13), sound
// entries are rows with ▶. Only directorSelectable kinds carry the 蓝/绿/关 lamp and trigger words. Pack lists (genres)
// are chip rows that filter the grid (see ModPack).
// Media: bytes go to the host media store first (putModMedia), then one CAS pack save references them.
const modMediaBindings=new WeakMap();
function modMediaBinding(rpc,modId) {
  let map=modMediaBindings.get(rpc);if(!map){map=new Map();modMediaBindings.set(rpc,map);}
  if(!map.has(modId))map.set(modId,{previewMedia:async({packId,hash})=>{
    const media=await rpc('readModMedia',{modId,packId,path:hash}),raw=atob(media.data),bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:media.mime}));let done=false;
    return {url,release:()=>{if(!done){done=true;URL.revokeObjectURL(url);}}};
  }});
  return map.get(modId);
}
const MOD_MEDIA_MAX=512*1024;
const modRandom=bytes=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const modUuid=()=>crypto.randomUUID?crypto.randomUUID():(r=>r.slice(0,8)+'-'+r.slice(8,12)+'-4'+r.slice(13,16)+'-'+'89ab'[parseInt(r[16],16)&3]+r.slice(17,20)+'-'+r.slice(20,32))(modRandom(16));
const modDefaults=schema=>Object.fromEntries((schema?.fields||[]).map(field=>[field.key,structuredClone(field.default)]));
async function modBase64(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());let text='';
  for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
// Icons and entry art: at most 512 px, WebP (PNG where the browser cannot encode WebP).
async function modImageMedia(file) {
  if(!/^image\/(png|webp|jpeg)$/.test(file?.type||''))throw new Error('请选择 PNG、WebP 或 JPEG 图片');
  const bitmap=await createImageBitmap(file);
  try {
    const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9));
    if(!blob||blob.type!=='image/webp')blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob||blob.size>MOD_MEDIA_MAX)throw new Error('图片过大');
    return {mime:blob.type,data:await modBase64(blob)};
  } finally { bitmap.close?.(); }
}
async function modAudioMedia(file) {
  const mime={'audio/mpeg':'audio/mpeg','audio/mp3':'audio/mpeg','audio/ogg':'audio/ogg','audio/wav':'audio/wav','audio/x-wav':'audio/wav','audio/wave':'audio/wav'}[file?.type||''];
  if(!mime)throw new Error('请选择 MP3、OGG 或 WAV 音频');
  if(file.size>MOD_MEDIA_MAX)throw new Error('音频过大（上限 512 KB）');
  return {mime,data:await modBase64(file)};
}
const modLamp=entry=>entry.enabled===false?'off':entry.recall?.mode==='constant'?'constant':'keyword';
function ModPlay({binding,pack,entry,slot}) {
  const audio=useAudioPreview(binding,pack.id);
  return h(PlayButton,{audio,asset:{kind:entry.kind,id:entry.id,name:entry.name,media:entry.media[slot]}});
}
function ModUpload({type,label,onFile}) {
  return h('label',{className:'ap-file-button',title:label},h(Glyph,{name:'upload'}),label,
    h('input',{type:'file',accept:type==='image'?'image/png,image/webp,image/jpeg':'audio/mpeg,audio/ogg,audio/wav','aria-label':label,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)onFile(file);}}));
}
function ModAssets({rpc,cardId,modId,data,title,help}) {
  const packsView=useModView(rpc,cardId,modId,'packs'),binding=modMediaBinding(rpc,modId),manifest=data.manifest;
  const [problem,setProblem]=React.useState(''),[fresh,setFresh]=React.useState(null);
  // One serialized CAS write per change; files list exactly the media the entries still use (plus release files).
  function packWrite(packId,transform,uploads=[]) {
    setProblem('');
    return packsView.write(async()=>{
      const current=await rpc('getMod',{modId}),before=current.packs.find(pack=>pack.id===packId)||null;
      const next=transform(before?structuredClone(before):null);
      const used=new Set(next.entries.flatMap(entry=>Object.values(entry.media))),old=before?.files||[];
      next.files=[...old.filter(file=>!file.path.startsWith('media/')||used.has(file.path)),...uploads.filter(file=>used.has(file.path)&&!old.some(row=>row.path===file.path))];
      await rpc('saveModPack',{modId,pack:next,expectedRevision:current.revision});
    });
  }
  // Media bytes first (host store), then one CAS pack save; `apply(pack, stored)` places the new file.
  async function upload(packId,type,file,apply) {
    setProblem('');
    try {
      const media=type==='image'?await modImageMedia(file):await modAudioMedia(file),stored=await rpc('putModMedia',{modId,packId,...media});
      await packWrite(packId,pack=>{if(!pack)throw new Error('素材包已被删除');apply(pack,stored);return pack;},[stored]);
    } catch(error) { setProblem(error?.code?modFailure(error):error?.message||'上传失败'); }
  }
  function createPack() {
    const id=modUuid(),major=Number(manifest.version.split('.')[0]);
    packWrite(id,()=>({format:'dsh-mod-pack',schemaVersion:1,id,modId,requiresModVersion:'>='+manifest.version+' <'+(major+1)+'.0.0',name:'新素材包',fields:modDefaults(manifest.packSchema),entries:[],files:[]}))
      .then(()=>setFresh(id),()=>{});
  }
  const scopes=packsView.data?.packs||[];
  return h(StageSection,{title,help,meta:data.packs.length||undefined,foldKey:'mod:'+modId+'/assets',className:'ap-mod-assets'},
    h(ErrorBox,{error:problem||packsView.error,reload:problem?undefined:packsView.reload}),
    // Pack scopes decide the default fold (关 starts folded), so the rows wait for them.
    !packsView.data?(!packsView.error&&h(Loading,{count:3})):data.packs.map(pack=>h(ModPack,{key:pack.id,rpc,cardId,modId,manifest,pack,packs:data.packs,binding,packsView,packWrite,upload,reveal:fresh===pack.id,
      scope:scopes.find(row=>row.id===pack.id)?.scope||'off'})),
    packsView.data&&h(CatAddTile,{label:'新建素材包',className:'ap-mod-add-pack',onClick:createPack}));
}
// Pack lists (CONTRACT-P4-PREP): a packSchema `list` of `object` rows such as genres:[{id,label,icon}] is edited as a chip
// row. `id` is a generated stable key (never shown); the row's name is its `label` text; a `reference` child to an owned
// image kind is the row's icon, an ordinary entry of that kind that this editor creates, replaces and removes. Entries
// point at a row with a `reference` field whose target is {library:'pack', field}; they store only the row id.
const modListFields=manifest=>(manifest.packSchema?.fields||[]).filter(field=>field.type==='list'&&field.item?.type==='object');
const modListIdKey=field=>field.item.fields.find(child=>child.key==='id'&&child.type==='text')?.key;
const modListLabelKey=field=>(field.item.fields.find(child=>child.key==='label'&&child.type==='text')||field.item.fields.find(child=>child.type==='text'&&child.key!=='id'))?.key;
const modListIconKey=(manifest,field)=>field.item.fields.find(child=>child.type==='reference'&&child.target.library==='mod'&&child.target.modId===manifest.id&&child.target.kinds.some(kind=>modImageSlot(manifest,kind)))?.key;
const modListKey=(field,id)=>'list:'+field.key+':'+id;
function modFindRef(packs,ref) {const pack=ref&&packs.find(row=>row.id===ref.packId),entry=pack?.entries.find(row=>row.id===ref.entryId&&row.kind===ref.kind);return entry?{pack,entry}:null;}
function ModRefArt({manifest,packs,binding,refValue,label,className}) {
  const found=modFindRef(packs,refValue),slot=found&&modImageSlot(manifest,found.entry.kind),hash=slot&&found.entry.media[slot];
  return hash?h(Thumb,{binding,packId:found.pack.id,hash,label,className}):h('span',{className,'data-empty':true});
}
function ModPack({rpc,cardId,modId,manifest,pack,packs,binding,packsView,packWrite,upload,reveal,scope}) {
  const [selected,setSelected]=React.useState(null),[filter,setFilter]=React.useState(null),[confirm,setConfirm]=React.useState(null),pick=useSelection();
  const kindName=kind=>modText(manifest,kind.label),lists=modListFields(manifest);
  // Icon kinds that only exist as pack-list icons are edited through the list, not shown as a second grid.
  const listKinds=new Set(lists.flatMap(field=>field.item.fields.filter(child=>child.key===modListIconKey(manifest,field)).flatMap(child=>child.target.kinds)));
  const gridKinds=manifest.assetKinds.filter(kind=>kind.directorSelectable||!listKinds.has(kind.id));
  const strip=pack.entries.filter(entry=>entry.media[modImageSlot(manifest,entry.kind)]).sort((a,b)=>listKinds.has(a.kind)-listKinds.has(b.kind)).slice(0,3);
  const entry=pack.entries.find(row=>row.id===selected)||null;
  const listRow=lists.map(field=>{const idKey=modListIdKey(field),row=(pack.fields[field.key]||[]).find(item=>selected===modListKey(field,item[idKey]));return row&&{field,row};}).find(Boolean);
  const write=change=>packWrite(pack.id,current=>{if(!current)throw new Error('素材包已被删除');change(current);return current;}).catch(()=>{});
  const edit=(id,change)=>write(current=>{const row=current.entries.find(item=>item.id===id);if(!row)throw new Error('条目已被删除');change(row);});
  const editRow=(field,id,change)=>write(current=>{const idKey=modListIdKey(field),row=(current.fields[field.key]||[]).find(item=>item[idKey]===id);if(!row)throw new Error('分类已被删除');change(row,current);});
  // An entry field pointing at a pack list; a new entry made while that list filters the grid starts in that row.
  const packRefs=kind=>kind.fields.fields.filter(field=>field.type==='reference'&&field.target.library==='pack');
  function add(kind) {
    const id='e'+modRandom(6),name='新'+kindName(kind),fields=modDefaults(kind.fields);
    if(filter)for(const field of packRefs(kind))if(field.target.field===filter.field)fields[field.key]=filter.id;
    packWrite(pack.id,current=>({...current,entries:[...current.entries,{id,kind:kind.id,name,enabled:true,fields,media:{},...(kind.directorSelectable?{recall:{mode:'keyword',keywords:[]}}:{})}]}))
      .then(()=>setSelected(id),()=>{});
  }
  function addRow(field) {
    const idKey=modListIdKey(field),labelKey=modListLabelKey(field),rows=pack.fields[field.key]||[];
    if(!idKey||rows.length>=field.maxItems)return;
    const id='g'+modRandom(4),row={...modDefaults({fields:field.item.fields}),[idKey]:id,...(labelKey?{[labelKey]:'新'+modText(manifest,field.item.label||field.label)}:{})};
    write(current=>{current.fields={...current.fields,[field.key]:[...(current.fields[field.key]||[]),row]};}).then(()=>setSelected(modListKey(field,id)));
  }
  function lamp(row,mode) {
    return edit(row.id,item=>{if(mode==='off')item.enabled=false;else{item.enabled=true;item.recall={...(item.recall||{keywords:[]}),mode};}});
  }
  // Removing list rows clears entry references to them and drops icon entries no remaining row uses.
  function remove(ids) {
    return write(current=>{
      const iconIds=new Set();
      for(const field of lists){const idKey=modListIdKey(field),iconKey=modListIconKey(manifest,field),rows=current.fields[field.key]||[];
        for(const row of rows)if(ids.has(modListKey(field,row[idKey]))&&row[iconKey]?.packId===pack.id)iconIds.add(row[iconKey].entryId);
        current.fields={...current.fields,[field.key]:rows.filter(row=>!ids.has(modListKey(field,row[idKey])))};}
      for(const field of lists){const iconKey=modListIconKey(manifest,field);for(const row of current.fields[field.key]||[])if(row[iconKey]?.packId===pack.id)iconIds.delete(row[iconKey].entryId);}
      current.entries=current.entries.filter(row=>!ids.has(row.id)&&!iconIds.has(row.id)).map(row=>{
        const kind=manifest.assetKinds.find(item=>item.id===row.kind),fields={...row.fields};
        for(const field of kind.fields.fields){const value=fields[field.key];
          if(field.type==='reference'&&field.target.library==='pack'&&value!=null&&ids.has('list:'+field.target.field+':'+value))fields[field.key]=null;
          if(field.type==='reference'&&field.target.library!=='pack'&&value?.packId===pack.id&&(ids.has(value.entryId)||iconIds.has(value.entryId)))fields[field.key]=null;}
        return {...row,fields};});
    }).then(()=>{pick.stop();if(ids.has(selected))setSelected(null);if(filter&&ids.has('list:'+filter.field+':'+filter.id))setFilter(null);});
  }
  const choose=id=>pick.on?pick.flip(id):setSelected(selected===id?null:id);
  const tile=(kind,row)=>{
    const slot=modImageSlot(manifest,kind.id),hash=slot&&row.media[slot],checked=pick.has(row.id);
    return h('span',{key:row.id,className:'ap-outfit-cell','data-selected':!pick.on&&selected===row.id||undefined},
      h('button',{type:'button',role:pick.on?'checkbox':'radio','aria-checked':pick.on?checked:selected===row.id,className:'ap-outfit-face','data-disabled':row.enabled===false||undefined,title:row.name,onClick:()=>choose(row.id)},
        h('span',{className:'ap-outfit-art ap-mod-art','data-empty':hash?undefined:true},hash?h(Thumb,{binding,packId:pack.id,hash,label:row.name,className:'ap-outfit-face-art'}):null,pick.on&&h(TileCheck,{checked})),
        h('span',{className:'ap-outfit-name'},row.name)),
      !pick.on&&kind.directorSelectable&&h(LampMenu,{mode:modLamp(row),label:row.name+' 的触发策略',anchorClassName:'ap-outfit-lamp-anchor',className:'ap-cast-lamp ap-outfit-lamp-button',onChange:mode=>lamp(row,mode)}));
  };
  const sound=(kind,row)=>{
    const slot=modAudioSlot(manifest,kind.id),checked=pick.has(row.id);
    return h('li',{key:row.id,className:'ap-mod-sound','data-selected':!pick.on&&selected===row.id||undefined,'data-disabled':row.enabled===false||undefined},
      pick.on?h('span',{className:'ap-check-mark','aria-hidden':true},checked&&h(Glyph,{name:'check'})):slot&&row.media[slot]?h(ModPlay,{binding,pack,entry:row,slot}):null,
      h('button',{type:'button',className:'ap-mod-sound-name',role:pick.on?'checkbox':undefined,'aria-checked':pick.on?checked:undefined,'aria-pressed':pick.on?undefined:selected===row.id,onClick:()=>choose(row.id)},row.name),
      !pick.on&&kind.directorSelectable&&h(LampMenu,{mode:modLamp(row),label:row.name+' 的触发策略',onChange:mode=>lamp(row,mode)}));
  };
  // A pack list as chips: icon + label; a click filters the entries that point at it and opens its detail.
  const chips=field=>{
    const idKey=modListIdKey(field),labelKey=modListLabelKey(field),iconKey=modListIconKey(manifest,field),rows=pack.fields[field.key]||[],name=modText(manifest,field.label);
    if(!idKey)return null;
    return h(InlineRow,{key:'list:'+field.key,label:name,help:field.help&&h(Help,{text:modText(manifest,field.help),label:name+' 说明'}),className:'ap-mod-chip-row'},h('span',{className:'ap-mod-chips',role:'group','aria-label':name},
      rows.map(row=>{const key=modListKey(field,row[idKey]),checked=pick.has(key),on=pick.on?checked:filter?.field===field.key&&filter.id===row[idKey],label=(labelKey&&row[labelKey])||name;
        return h('button',{key,type:'button',className:'ap-mod-chip',role:pick.on?'checkbox':undefined,'aria-checked':pick.on?checked:undefined,'aria-pressed':pick.on?undefined:on,'data-selected':!pick.on&&selected===key||undefined,
            onClick:()=>{if(pick.on){pick.flip(key);return;}setFilter(on?null:{field:field.key,id:row[idKey]});setSelected(on?null:key);}},
          iconKey&&h(ModRefArt,{manifest,packs,binding,refValue:row[iconKey],label,className:'ap-mod-chip-art'}),h('span',null,label));}),
      !pick.on&&rows.length<field.maxItems&&h(CatAddTile,{label:'添加'+name,className:'ap-mod-chip-add',onClick:()=>addRow(field)})));
  };
  const grid=kind=>{
    const refs=packRefs(kind),filtered=pack.entries.filter(row=>row.kind===kind.id&&(!filter||(!refs.some(field=>field.target.field===filter.field)||refs.some(field=>field.target.field===filter.field&&row.fields[field.key]===filter.id))));
    const image=!!modImageSlot(manifest,kind.id),add_=!pick.on&&h(CatAddTile,{label:'添加'+kindName(kind),className:image?'ap-mod-add-tile':'ap-mod-chip-add',onClick:()=>add(kind)});
    return h('div',{key:'kind:'+kind.id,className:'ap-mod-kind-block'},gridKinds.length>1&&h('div',{className:'ap-mod-kind'},kindName(kind)),
      image?h('div',{className:'ap-mod-tiles',role:pick.on?'group':'radiogroup','aria-label':kindName(kind)},filtered.map(row=>tile(kind,row)),add_):
        h('ul',{className:'ap-mod-sounds','aria-label':kindName(kind)},filtered.map(row=>sound(kind,row)),add_&&h('li',{className:'ap-mod-sound'},add_)));
  };
  const name=pack.name,count=pack.entries.filter(row=>!listKinds.has(row.kind)||manifest.assetKinds.find(kind=>kind.id===row.kind)?.directorSelectable).length;
  const removable=count+lists.reduce((sum,field)=>sum+(pack.fields[field.key]||[]).length,0);
  const action=pick.on?h(SelectBar,{count:pick.ids.size,action:'删除',danger:true,busy:packsView.saving,onCancel:pick.stop,
      onAction:()=>setConfirm({title:'删除 '+pick.ids.size+' 项？',body:'删除后无法恢复，历史记录不受影响。',confirmLabel:'删除',danger:true,onConfirm:()=>remove(new Set(pick.ids))})}):
    h(Popover,{label:name+' 操作',className:'ap-mod-pack-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:name+' 更多操作','aria-expanded':open,onClick:toggle}),
      content:close=>[h(MenuItem,{key:'entries',disabled:!removable,onClick:()=>{close();setSelected(null);pick.start();}},'删除…'),
        h(MenuItem,{key:'pack',danger:true,onClick:()=>{close();setConfirm({title:'删除「'+name+'」？',body:'素材包和里面的图片会一起删除，历史记录不受影响。',confirmLabel:'删除',danger:true,
          onConfirm:()=>packsView.write(current=>rpc('deleteModPack',{modId,packId:pack.id,confirmed:true,expectedRevision:current.revision})).catch(()=>{})});}},'删除素材包…')]});
  return h('div',{className:'ap-mod-pack',onKeyDown:e=>{if(e.key==='Escape'&&pick.on){e.preventDefault();e.stopPropagation();pick.stop();}}},
    h(StageSection,{level:2,title:name,meta:count||undefined,foldKey:'mod:'+modId+'/assets/'+pack.id,defaultFolded:scope==='off',reveal,
        lead:strip.length?h('span',{className:'ap-mod-strip','aria-hidden':true},strip.map(row=>h(Thumb,{key:row.id,binding,packId:pack.id,hash:row.media[modImageSlot(manifest,row.kind)],label:row.name,className:'ap-mod-strip-art'}))):null,
        aside:h(ModScope,{rpc,view:packsView,row:{id:pack.id,name,scope,authorized:true},cardId,packId:pack.id,modId}),action},
      h(InlineGrid,{label:name,columns:1,className:'ap-mod-pack-fields'},
        h(InlineField,{kind:'text',label:'名称',controlLabel:'素材包名称',value:name,maxLength:240,validate:v=>v.trim()?'':'请填写名称',onCommit:v=>write(current=>{current.name=v.trim();})}),
        (manifest.packSchema?.fields||[]).map(field=>lists.includes(field)?chips(field):h(ModField,{key:field.key,field,manifest,value:pack.fields[field.key],values:pack.fields,packs,pack,binding,
          onCommit:value=>write(current=>{current.fields={...current.fields,[field.key]:value};})}))),
      gridKinds.map(grid),
      !pick.on&&entry&&h(ModEntryDetail,{key:entry.id,manifest,pack,packs,entry,binding,edit,upload}),
      !pick.on&&listRow&&h(ModListRowDetail,{key:selected,manifest,pack,packs,binding,...listRow,editRow,upload}),
      confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)})));
}
function ModListRowDetail({manifest,pack,packs,binding,field,row,editRow,upload}) {
  const idKey=modListIdKey(field),labelKey=modListLabelKey(field),iconKey=modListIconKey(manifest,field),id=row[idKey],label=(labelKey&&row[labelKey])||modText(manifest,field.label);
  const iconField=iconKey&&field.item.fields.find(child=>child.key===iconKey),iconKind=iconField?.target.kinds.find(kind=>modImageSlot(manifest,kind));
  // Uploading makes (or replaces the media of) this row's own icon entry, named after the row.
  const uploadIcon=file=>upload(pack.id,'image',file,(current,stored)=>{
    const rows=current.fields[field.key]||[],target=rows.find(item=>item[idKey]===id);if(!target)throw new Error('分类已被删除');
    const slot=modImageSlot(manifest,iconKind),old=target[iconKey]?.packId===pack.id&&current.entries.find(entry=>entry.id===target[iconKey].entryId&&entry.kind===iconKind);
    const shared=old&&rows.some(item=>item!==target&&item[iconKey]?.entryId===old.id);
    if(old&&!shared)old.media={...old.media,[slot]:stored.path};
    else {const entryId='e'+modRandom(6);current.entries=[...current.entries,{id:entryId,kind:iconKind,name:label,enabled:true,fields:modDefaults(manifest.assetKinds.find(kind=>kind.id===iconKind).fields),media:{[slot]:stored.path}}];
      target[iconKey]={modId:manifest.id,packId:pack.id,kind:iconKind,entryId};}
  });
  return h('div',{className:'ap-mod-entry'},
    iconKey&&h('div',{className:'ap-mod-hero'},h(ModRefArt,{manifest,packs,binding,refValue:row[iconKey],label,className:'ap-mod-hero-art'})),
    h(InlineGrid,{label,columns:1},
      field.item.fields.filter(child=>child.key!==idKey).map(child=>child.key===labelKey?
        h(InlineField,{key:child.key,kind:'text',label:modText(manifest,child.label),controlLabel:label+' '+modText(manifest,child.label),value:row[child.key],maxLength:child.maxLength,validate:v=>v.trim()?'':'请填写名称',onCommit:v=>editRow(field,id,item=>{item[child.key]=v.trim();})}):
        // A row's icon comes from its own pack, so an off or deleted pack never lends this row an image.
        h(ModField,{key:child.key,field:child,manifest,value:row[child.key],values:row,packs:child.type==='reference'?[pack]:packs,pack,binding,onCommit:value=>editRow(field,id,item=>{item[child.key]=value;})})),
      iconKind&&h(InlineRow,{label:'图片'},h(ModUpload,{type:'image',label:modFindRef(packs,row[iconKey])?'换图':'上传图片',onFile:uploadIcon}))));
}
function ModEntryDetail({manifest,pack,packs,entry,binding,edit,upload}) {
  const kind=manifest.assetKinds.find(row=>row.id===entry.kind),image=modImageSlot(manifest,kind.id),mode=modLamp(entry);
  const set=change=>edit(entry.id,change);
  return h('div',{className:'ap-mod-entry'},
    image&&h('div',{className:'ap-mod-hero'},entry.media[image]?h(Thumb,{key:entry.media[image],binding,packId:pack.id,hash:entry.media[image],label:entry.name,className:'ap-mod-hero-art'}):h('span',{className:'ap-mod-hero-art','data-empty':true})),
    h(InlineGrid,{label:entry.name,columns:1},
      h(InlineField,{kind:'text',label:'名称',controlLabel:entry.name+' 名称',value:entry.name,maxLength:240,validate:v=>v.trim()?'':'请填写名称',onCommit:v=>set(row=>{row.name=v.trim();})}),
      kind.directorSelectable&&h(InlineRow,{label:'触发策略',help:h(Help,{text:'蓝灯每轮都给导演；绿灯在正文提到触发词时给导演。',label:'触发策略 说明'})},
        h(LampMenu,{named:true,mode,label:'触发策略',onChange:next=>set(row=>{if(next==='off')row.enabled=false;else{row.enabled=true;row.recall={...(row.recall||{keywords:[]}),mode:next};}})})),
      kind.directorSelectable&&mode==='keyword'&&h(InlineField,{kind:'chips',label:'触发词',controlLabel:entry.name+' 触发词',value:entry.recall?.keywords||[],split:splitKeywords,validate:keywordProblem,
        onCommit:words=>set(row=>{const synonyms=Object.fromEntries(Object.entries(row.recall?.synonyms||{}).filter(([key])=>words.includes(key)));row.recall={mode:'keyword',keywords:words,...(Object.keys(synonyms).length?{synonyms}:{})};})}),
      kind.fields.fields.map(field=>
        h(ModField,{key:field.key,field,manifest,value:entry.fields[field.key],values:entry.fields,packs,pack,binding,onCommit:value=>set(row=>{row.fields={...row.fields,[field.key]:value};})})),
      kind.mediaSlots.filter(slot=>slot.type!=='bundle').map(slot=>h(InlineRow,{key:slot.id,label:slot.type==='image'?'图片':'声音'},
        h(ModUpload,{type:slot.type,label:entry.media[slot.id]?(slot.type==='image'?'换图':'换声音'):(slot.type==='image'?'上传图片':'上传声音'),
          onFile:file=>upload(pack.id,slot.type,file,(current,stored)=>{const row=current.entries.find(item=>item.id===entry.id);if(!row)throw new Error('条目已被删除');row.media={...row.media,[slot.id]:stored.path};})})))));
}
