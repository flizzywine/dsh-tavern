// one renderer for every manifest — no branch on a mod ID.
// A reference field (pack / entry data) offers the mod's own entries of its target kinds; a main-library target has no
// editor here yet (P4+), so it renders nothing rather than a fake picker.
const modEntryRef=(modId,pack,entry)=>({modId,packId:pack.id,kind:entry.kind,entryId:entry.id});
const modRefKey=ref=>ref?JSON.stringify([ref.packId,ref.kind,ref.entryId]):'';
const modImageSlot=(manifest,kind)=>manifest.assetKinds.find(row=>row.id===kind)?.mediaSlots.find(slot=>slot.type==='image')?.id;
const modAudioSlot=(manifest,kind)=>manifest.assetKinds.find(row=>row.id===kind)?.mediaSlots.find(slot=>slot.type==='audio')?.id;
function modEntryChoices(manifest,packs,kinds) {
  const choices=[{value:'',label:'默认'}];
  for(const pack of packs)for(const entry of pack.entries.filter(entry=>kinds.includes(entry.kind)))choices.push({value:modRefKey(modEntryRef(manifest.id,pack,entry)),label:entry.name,ref:modEntryRef(manifest.id,pack,entry),pack,entry,...(packs.length>1?{group:pack.name}:{})});
  return choices;
}
function ModField({field,manifest,value,values,packs,pack,binding,onCommit,onDraft,onReset}) {
  const label=modText(manifest,field.label),help=field.help?h(Help,{text:modText(manifest,field.help),label:label+' 说明'}):null;
  const condition=field.dependsOn,blocked=condition&&(Object.hasOwn(condition,'equals')?JSON.stringify(values[condition.key])!==JSON.stringify(condition.equals):!values[condition.key]);
  let control=null;
  if(field.type==='text')control=h(InlineField,{kind:'text',label,help,value,maxLength:field.maxLength,placeholder:field.placeholder&&modText(manifest,field.placeholder),trim:false,onCommit});
  if(field.type==='toggle')control=h(SwitchRow,{label,help:field.help&&modText(manifest,field.help),checked:value,onChange:onCommit});
  // The shared Slider; values snap to the declared grid, so End on an off-grid max picks the last legal step.
  if(field.type==='slider') {
    const last=Math.floor((field.max-field.min)/field.step+1e-7),legal=v=>Number((field.min+Math.max(0,Math.min(last,Math.round((v-field.min)/field.step)))*field.step).toPrecision(15));
    const text=v=>String(v)+(field.unit||'');
    control=h(InlineRow,{label,help},h(Slider,{label,value,min:field.min,max:field.min+last*field.step,step:field.step,valueText:text,output:text,onChange:v=>onDraft?.(legal(v)),onCommit:v=>{const next=legal(v);if(next!==value)onCommit(next);}}));
  }
  if(field.type==='segmented')control=field.choices.length<=3?h(InlineRow,{label,help},h(Segmented,{label,value,options:field.choices.map(option=>[option.value,modText(manifest,option.label)]),onChange:onCommit})):
    h(InlineField,{kind:'menu',label,help,value,options:field.choices.map(option=>({value:option.value,label:modText(manifest,option.label)})),onCommit});
  if(field.type==='colour')control=h(InlineField,{kind:'color',label,help,value:value==='auto'?'':value,palette:field.palette,allowAuto:!!field.stageToken,autoLabel:'跟随舞台',auto:field.stageToken?'var('+field.stageToken+',var(--fork-accent))':undefined,onCommit:next=>onCommit(next===null?'auto':next)});
  const kinds=['asset-picker','sound-picker'].includes(field.type)?[field.kind]:field.type==='reference'&&field.target.library==='mod'&&field.target.modId===manifest.id?field.target.kinds:null;
  if(kinds) {
    const choices=modEntryChoices(manifest,packs,kinds),picked=choices.find(choice=>choice.value===modRefKey(value));
    const image=picked?.entry&&modImageSlot(manifest,picked.entry.kind),audio=picked?.entry&&modAudioSlot(manifest,picked.entry.kind);
    const trail=picked?.entry&&binding?(image&&picked.entry.media[image]?h(Thumb,{binding,packId:picked.pack.id,hash:picked.entry.media[image],label:picked.entry.name,className:'ap-mod-pick-thumb'}):
      audio&&picked.entry.media[audio]?h(ModPlay,{binding,pack:picked.pack,entry:picked.entry,slot:audio}):null):null;
    control=h(InlineField,{kind:'menu',label,help,value:modRefKey(value),options:choices.map(({value,label,group})=>({value,label,...(group?{group}:{})})),trail,onCommit:next=>onCommit(choices.find(choice=>choice.value===next)?.ref||null)});
  }
  // A pack-list reference (e.g. an item's 分类): the rows of that list in this pack, label + icon; stores only the row id.
  if(field.type==='reference'&&field.target.library==='pack'&&pack) {
    const list=modListFields(manifest).find(row=>row.key===field.target.field);
    if(list) {
      const idKey=modListIdKey(list),labelKey=modListLabelKey(list),iconKey=modListIconKey(manifest,list),rows=pack.fields[list.key]||[],picked=rows.find(row=>row[idKey]===value);
      const trail=picked&&iconKey&&picked[iconKey]?h(ModRefArt,{manifest,packs,binding,refValue:picked[iconKey],label:picked[labelKey]||'',className:'ap-mod-pick-thumb'}):null;
      control=h(InlineField,{kind:'menu',label,help,value:picked?value:'',trail,options:[{value:'',label:'无'},...rows.map(row=>({value:row[idKey],label:(labelKey&&row[labelKey])||modText(manifest,list.label)}))],onCommit:next=>onCommit(next||null)});
    }
  }
  if(!control)return null;
  return h('div',{className:'ap-mod-field','data-blocked':blocked||undefined,inert:blocked||undefined},control,
    onReset&&h(IconButton,{icon:'reset',label:'恢复默认',onClick:onReset}));
}
// Settings have one global owner; card scope belongs only to the mod's asset packs.
// no default 「高级 › 版本」 section (an internal detail); a manifest may still declare it.
function modLayout(manifest) {
  const declared=manifest.ui?.layout;
  if(declared)return declared;
  return [...(manifest.assetKinds.length?[{host:'assets'}]:[]),...manifest.settingsSchema.sections.map(section=>({section:section.id}))];
}
// the page opens only in 舞台设置 (no 模组库 tab), so ‹ always reads 舞台设置.
// every page is ModPageHead (name, its (?) description, the global
// switch) over sections; `ctx` (the 舞台设置 page) gives the entry sections of the mod's admission kinds (ModEntries).
function ModDetail({rpc,cardId,cardName,sessionId,modId,onBack,faceOf,ctx}) {
  const [draft,setDraft]=React.useState({});
  const view=useModView(rpc,undefined,modId),data=view.data;
  React.useEffect(()=>setDraft({}),[data]);
  function edit(fields,change) {
    const presentationOnly=fields.every(field=>field.presentation);
    const preview=values=>window.dispatchEvent(new CustomEvent('dsh-tavern-mod-presentation',{detail:{modId,values}}));
    if(presentationOnly)preview(Object.fromEntries(fields.map(field=>[field.key,change===undefined?field.default:change])));
    return view.write(async current=>{
      const values={...current.settings.storedValues};
      for(const field of fields){if(change===undefined)delete values[field.key];else values[field.key]=change;}
      await rpc('saveModSettings',{modId,values,expectedRevision:current.revision});
    },{modId,presentationOnly}).catch(()=>{if(presentationOnly)preview(Object.fromEntries(fields.map(field=>[field.key,data.settings.values[field.key]])));setDraft({});});
  }
  const name=data?modText(data.manifest,data.manifest.name):'模组';
  // the head's text switch (全局 / 本卡) and this card's dependency notices.
  const managed=useManagedModControls({rpc,cardId,modId,name});
  const head=h(React.Fragment,null,h(ModPageHead,{modId,manifest:data?.manifest,name,onBack,toggle:managed.toggle}),managed.dialog);
  if(!data)return h('article',{className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},head,view.error?h(ErrorBox,{error:view.error,reload:view.reload}):h(Loading,{shape:'fields'}));
  const entries=ctx?h(ModEntrySections,{ctx,modId,manifest:data.manifest}):null;
  const dependencies=managed.notices;
  // the phone and items mods keep their settings in the two-layer config (mod-config-pages.js);
  // their page replaces the manifest renderer (no pack editor for the phone, no saveModSettings).
  const ConfigPage=MOD_CONFIG_PAGES[modId];
  // no summary line under the title (mod-pages-ui: it is the head's (?)).
  // A config page places `entries` itself (last). One that also has manifest settings (弹幕's call cadence) renders them
  // with ModField over `modSettings`: the values (with this page's drafts) and this page's one saveModSettings writer.
  const modSettings={values:{...data.settings.values,...draft},stored:data.settings.storedValues,edit,setDraft,saving:view.saving};
  if(ConfigPage)return h('article',{className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},head,
    h(ErrorBox,{error:view.error,reload:view.reload}),dependencies,
    h(ConfigPage,{rpc,cardId,cardName,sessionId,manifest:data.manifest,data,faceOf,entries,modSettings,ctx}));
  const manifest=data.manifest,values={...data.settings.values,...draft},fields=manifest.settingsSchema.fields,stored=data.settings.storedValues;
  const changed=keys=>keys.filter(key=>Object.hasOwn(stored,key));
  const fieldRows=keys=>keys.map(key=>{const field=fields.find(field=>field.key===key);return h(ModField,{key,field,manifest,value:values[key],values,packs:data.packs,binding:modMediaBinding(rpc,modId),
    onCommit:value=>{setDraft(current=>({...current,[key]:value}));return edit([field],value);},onDraft:value=>setDraft(current=>({...current,[key]:value})),onReset:changed([key]).length?()=>edit([field],undefined):undefined});});
  const sectionOf=section=>{
    const keys=section.groups?section.groups.flatMap(group=>group.fields):section.fields,edited=changed(keys);
    return h(StageSection,{key:'section:'+section.id,title:modText(manifest,section.title),help:section.help&&modText(manifest,section.help),foldKey:'mod:'+modId+'/'+section.id,defaultFolded:section.folded,
        meta:edited.length?'已改 '+edited.length:undefined,action:edited.length?h(IconButton,{icon:'reset',label:'全部恢复默认',onClick:()=>edit(edited.map(key=>fields.find(field=>field.key===key)),undefined)}):null},
      section.groups?section.groups.map(group=>h(StageSection,{key:group.id,level:2,title:modText(manifest,group.title),help:group.help&&modText(manifest,group.help),foldKey:'mod:'+modId+'/'+section.id+'/'+group.id,defaultFolded:group.folded},fieldRows(group.fields))):fieldRows(section.fields));
  };
  const parts=modLayout(manifest).map(item=>{
    if(item.section)return sectionOf(manifest.settingsSchema.sections.find(section=>section.id===item.section));
    if(item.host==='assets')return h(ModAssets,{key:'assets',rpc,cardId,modId,data,title:item.title?modText(manifest,item.title):'素材包',help:item.help&&modText(manifest,item.help)});
    if(item.host==='advanced')return h(StageSection,{key:'advanced',title:item.title?modText(manifest,item.title):'高级',foldKey:'mod:'+modId+'/advanced',defaultFolded:true},h(InlineRow,{label:'版本'},manifest.version));
    return null;
  });
  return h('article',{className:'ap-mod-detail',onKeyDown:subpageKeys(onBack)},head,
    view.saving&&h('div',{className:'ap-mod-tools'},h('span',{className:'ap-save-state',role:'status'},'正在保存…')),
    h(ErrorBox,{error:view.error,reload:view.reload}),dependencies,parts,entries);
}
