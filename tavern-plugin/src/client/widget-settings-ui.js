// one declaration-driven renderer for a widget's shared pack defaults (its only appearance settings).
// Galgame panel language: hairline rows, no boxes inside the dialog, no grey notes —
// explanations live in 「?」 tips, states that need attention are ⚠ chips beside the field they belong to.
function WidgetSettingRange({field,value,onCommit,label}) {
  const [draft,setDraft]=React.useState(value),dragging=React.useRef(false);
  React.useEffect(()=>{if(!dragging.current)setDraft(value);},[value]);
  const clamp=n=>Math.max(field.min,Math.min(field.max,Number((field.min+Math.round((n-field.min)/field.step)*field.step).toFixed(3))));
  const move=e=>{const r=e.currentTarget.getBoundingClientRect();const next=clamp(field.min+(e.clientX-r.left)/r.width*(field.max-field.min));setDraft(next);return next;};
  const ratio=Math.max(0,Math.min(1,(draft-field.min)/(field.max-field.min)));
  return h('div',{className:'ap-widget-range'},h('div',{className:'ap-widget-slider',role:'slider',tabIndex:0,'aria-label':label,'aria-valuemin':field.min,'aria-valuemax':field.max,'aria-valuenow':draft,'aria-valuetext':draft+(field.unit||''),style:{'--ratio':ratio},
    onPointerDown:e=>{dragging.current=true;e.currentTarget.setPointerCapture(e.pointerId);move(e);},onPointerMove:e=>{if(dragging.current)move(e);},onPointerUp:e=>{if(dragging.current){const next=move(e);dragging.current=false;onCommit(next);}},onPointerCancel:()=>{dragging.current=false;setDraft(value);},
    onKeyDown:e=>{const n=({ArrowLeft:draft-field.step,ArrowDown:draft-field.step,ArrowRight:draft+field.step,ArrowUp:draft+field.step,Home:field.min,End:field.max})[e.key];if(n!==undefined){e.preventDefault();const next=clamp(n);setDraft(next);onCommit(next);}}},
    h('span',{className:'ap-widget-slider-fill'}),h('span',{className:'ap-widget-slider-thumb'})),
    // the exact value is an inline number beside the slider (no box).
    h(InlineField,{kind:'number',label:label+' 数值',hideLabel:true,className:'ap-widget-number',unit:field.unit||undefined,min:field.min,max:field.max,step:field.step,value,
      validate:n=>stageWidgetSettingValue(field,n)?'':'数值不符合范围或步长',onCommit:onCommit}));
}
const widgetSettingStatus={ready:'已解析',truncated:'文字过长，已截断',missing:'变量路径没有值',unavailable:'此阅读点没有可用快照','type-mismatch':'变量类型不符，使用固定默认值','invalid-setting':'保存值已不适用','invalid-binding':'绑定已不适用','asset-unavailable':'图片未授权、已停用或缺失','image-format':'图片格式不支持','image-bytes':'图片超过 8 MiB 限额','image-pixels':'图片尺寸或像素超过限额','image-projection':'图片压缩后仍超过限额','image-decode':'图片解码失败',loading:'正在读取',suspended:'模组暂停，未读取',revoked:'模组授权已失效','position-changed':'阅读位置已变化'};
const widgetSnapshotLabels={exact:'本轮已保存',inherited:'前轮已保存','saved-unverified':'已保存但未验证','live-only':'仅当前会话',unavailable:'无可用快照'};
// Ready values read as plain information; anything else is a ⚠ chip. A loading read shows the shared spinner (150ms).
function WidgetSettingFeedback({feedback}) {
  const shown=feedback.value===null?'模组默认':typeof feedback.value==='object'?'素材图片':String(feedback.value);
  const snapshot=feedback.snapshot&&(widgetSnapshotLabels[feedback.snapshot.kind]+(feedback.snapshot.turn==null?'':'（第 '+feedback.snapshot.turn+' 轮）'));
  const ok=feedback.status==='ready',loading=feedback.status==='loading';
  return h('p',{className:'ap-widget-feedback'+(ok?' is-ready':loading?' is-loading':' is-warning'),role:'status','data-setting-status':feedback.status},
    loading?h(Spinner,{key:'loading'}):!ok&&h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),
    h('span',null,(widgetSettingStatus[feedback.status] || '当前不可用')+'；当前显示：'+shown),
    snapshot&&h('span',{className:'ap-widget-snapshot','data-kind':feedback.snapshot.kind},snapshot));
}
// appearance lives only in the pack (settingsDefaults). A field that
// uses the widget's own default shows nothing; a field the pack changed shows a quiet 「已修改」 and its reset. Which card
// variable a slot reads is the card's 变量对照 (舞台设置), never this form.
function WidgetSettingField({document:declaration,field,value,changed,binding,packs,boundPackIds=[],feedback,stageColor,onChange,onReset}) {
  const label=stageWidgetSettingLabel(declaration,field.label),help=field.help&&stageWidgetSettingLabel(declaration,field.help);
  const validate=next=>stageWidgetSettingValue(field,next)?'':'值不符合模组声明';
  const choices=(rows,current,change,groupLabel=label)=>h('div',{className:'ap-segmented',role:'group','aria-label':groupLabel,onKeyDown:e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const nodes=[...e.currentTarget.querySelectorAll('button')],at=nodes.indexOf(document.activeElement);e.preventDefault();nodes[(at+(e.key==='ArrowRight'?1:nodes.length-1))%nodes.length]?.focus();}},rows.map(([key,text])=>h(Button,{key,'aria-pressed':current===key,onClick:()=>change(key)},text)));
  const marker=changed&&h('span',{className:'ap-widget-modified'},'已修改');
  const reset=changed&&h(Button,{className:'ap-icon-button ap-widget-reset','aria-label':'恢复默认 '+label,title:'恢复默认',onClick:onReset},h(Glyph,{name:'reset'}));
  let control=null;
  if(field.type==='toggle')control=h(Button,{className:'ap-widget-switch',role:'switch','aria-label':label,'aria-checked':value,onClick:()=>onChange(!value)},h('span',{className:'ap-widget-knob','aria-hidden':true}),h('span',{className:'ap-widget-switch-text'},value?'开启':'关闭'));
  else if(field.type==='choice')control=choices(field.choices.map(item=>[item.value,stageWidgetSettingLabel(declaration,item.label)]),value,onChange);
  else if(field.type==='range')control=h(WidgetSettingRange,{field,value,onCommit:onChange,label});
  else if(field.type==='pack-asset'){
    // One control showing the current choice; it opens the shared background picker (the opening editor's: search,
    // pack groups, lazy thumbnails). Groups: 全局启用 → 本卡使用 → other installed packs; 「模组默认」 comes first.
    // 全局 (blue) before 本卡 (green), like every global / card list.
    const usable=packs.filter(pack=>!pack.error&&pack.manifest.assets.some(asset=>asset.kind===field.kind&&asset.enabled&&asset.media));
    const rank=pack=>binding?.globalEnabledPackIds?.includes(pack.manifest.id)?0:boundPackIds.includes(pack.manifest.id)?1:2;
    const ordered=usable.map((pack,i)=>[rank(pack),i,pack]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(row=>row[2]);
    const options=[{value:'',label:'模组默认'},...ordered.flatMap(pack=>pack.manifest.assets.filter(asset=>asset.kind===field.kind&&asset.enabled&&asset.media)
      .map(asset=>({value:openingRefKey({packId:pack.manifest.id,assetId:asset.id}),label:asset.name,group:pack.manifest.name,packId:pack.manifest.id,hash:asset.media})))];
    const current=openingRefKey(value);
    if(value&&!options.some(o=>o.value===current))options.splice(1,0,{value:current,label:'所选图片不可用'});
    control=h(OpeningPicker,{label,value:current,options,
      art:o=>o.hash?h(Thumb,{binding,packId:o.packId,hash:o.hash,label:o.label,className:'ap-thumb ap-picker-art'}):h('span',{className:'ap-picker-art','data-default':!o.value||undefined,'aria-hidden':true},!o.value&&h(Glyph,{name:'palette'})),
      onChange:key=>{const [packId,assetId]=key.split('/');onChange(key?{packId,kind:field.kind,assetId}:null);}});
  }
  const selectedPack=field.type==='pack-asset'&&value&&packs.find(pack=>pack.manifest.id===value.packId),selectedImage=selectedPack?.manifest?.assets.find(asset=>asset.kind==='backgrounds'&&asset.id===value.assetId);
  // every field is one 「label value」 row — a text / colour / long choice
  // is a InlineField (value read as text, edited in place; the colour's palette and hex in its popup, 自动 = 跟随舞台),
  // a switch, a short choice, a slider or the picture picker sits in the same row (InlineRow). 已修改 and the reset follow
  // the value.
  const trail=changed?h(React.Fragment,null,marker,reset):null,helpTip=help?h(Help,{text:help,label:label+' 说明'}):null;
  const hexDefault=typeof field.default==='string'&&/^#[0-9a-f]{6}$/i.test(field.default)?field.default:undefined;
  const row=field.type==='colour'?h(InlineField,{kind:'color',label,help:helpTip,trail,auto:stageColor||hexDefault,value:value==='stage'?'':value||'',
      onCommit:next=>next?onChange(next.toLowerCase()):field.stageToken?onChange('stage'):onReset()}):
    field.type==='choice'&&field.choices.length>4?h(InlineField,{kind:'menu',label,help:helpTip,trail,value,options:field.choices.map(item=>({value:item.value,label:stageWidgetSettingLabel(declaration,item.label)})),onCommit:onChange}):
    control?h(InlineRow,{label,help:helpTip},control,trail):
    h(InlineField,{kind:'text',label,help:helpTip,trail,value:value??'',placeholder:'未填写',trim:false,validate,onCommit:onChange});
  return h('section',{className:'ap-widget-setting','data-type':field.type,'data-changed':changed||undefined},row,
    feedback&&h(WidgetSettingFeedback,{feedback}),
    field.type==='pack-asset'&&value&&(!selectedImage?.enabled||!selectedImage.media?
      h(HintLine,{text:'所选图片不可用；保留选择，运行时使用模组默认',action:'改用模组默认',onAction:()=>onChange(null)}):
      h('p',{className:'ap-widget-dependency',role:'status'},h(Glyph,{name:'stage'}),h('span',null,'图片来自「'+selectedPack.manifest.name+'」'),h(Help,{text:'跨包引用不会随本包导出；目标卡未使用此素材包时显示模组默认。',label:'图片依赖 说明'}))));
}
// The pack's shared look of a widget: one heading (外观 + 「?」), the declared fields, 全部恢复默认 once anything changed.
// the list rows are summaries; the picture picker reads entries, so the packs that hold
// pictures of a picker's kind are read in full (useFullPacksOfKinds); the picker lists nothing until they arrive.
const useWidgetPickerPacks=(binding,packs,kinds)=>useFullPacksOfKinds(binding,packs,kinds)||[];
function WidgetSettingsForm({declaration,defaults={},binding,packs:rows=[],boundPackIds=[],feedback,themeFeedback,onChange,onReset}) {
  const resetLabel='全部恢复默认';
  const packs=useWidgetPickerPacks(binding,rows,[...new Set((declaration?.settingsSchema?.fields||[]).filter(field=>field.type==='pack-asset').map(field=>field.kind))]);
  if(!declaration?.settingsSchema?.fields.length)return h(EmptyState,{compact:true,text:'此模组没有可调设置'});
  const nativeItems=declaration.runtime==='items';
  const head=h('div',{className:'ap-widget-settings-head'},h('strong',{className:'ap-widget-settings-title'},nativeItems?'设置':'外观'),
    h(Help,{text:nativeItems?'所有用到这个模组的卡共享这里的设置；只改当前卡时，先复制到本卡素材包。库存映射使用卡片的变量对照。':'所有用到这个模组的卡都按这里显示。想让某张卡换个样子：打开那张卡，在 ⋯ 里选「复制到本卡素材包」，再改副本。',label:nativeItems?'设置 说明':'外观 说明'}));
  let effective;
  try {effective=stageWidgetResolveSettings(declaration,defaults);}
  catch {return h('div',{className:'ap-widget-settings'},head,h(HintLine,{text:'模组设置合并后超出预算，此模组不可用；其它舞台功能不受影响',action:resetLabel,onAction:onReset}));}
  const stageTheme=themeFeedback?.theme || {};
  const changedCount=declaration.settingsSchema.fields.filter(field=>effective.sources[field.key]==='shared').length;
  return h('div',{className:'ap-widget-settings'},head,
    themeFeedback?.corrected?.length>0&&h('p',{className:'ap-hint-line',role:'status','data-theme-correction':true},h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),
      h('span',null,'舞台文字对比度已修正：'+themeFeedback.corrected.map(key=>({surfaceText:'正文颜色',muted:'次要文字',accentText:'强调色上的文字'})[key]).join('、')),h(Help,{text:'只改变显示，不改写设置或素材包。',label:'对比度修正 说明'})),
    Object.values(effective.diagnostics).some(status=>/^invalid-/.test(status))&&h(HintLine,{text:'有设置已不适用，当前使用合法默认值',action:resetLabel,onAction:onReset}),
    h('div',{className:'ap-widget-fields'},declaration.settingsSchema.fields.map(field=>h(WidgetSettingField,{key:field.key,document:declaration,field,value:effective.settings[field.key],changed:effective.sources[field.key]==='shared',binding,packs,boundPackIds,
      stageColor:field.stageToken?stageTheme[field.stageToken]:null,feedback:feedback?.fields?.[field.key] || (effective.diagnostics[field.key]?{value:effective.settings[field.key],status:effective.diagnostics[field.key]}:null),
      onChange:value=>onChange(field.key,'settings',value),onReset:()=>onChange(field.key,null)}))),
    changedCount>0&&h('div',{className:'ap-inline-actions ap-widget-reset-all'},h(Button,{className:'ap-link',onClick:onReset},h(Glyph,{name:'reset'}),resetLabel)));
}
function BackgroundStageTheme({asset,onCommit}) {
  const [fonts,setFonts]=React.useState([]);
  React.useEffect(()=>{let live=true;globalThis.tavernFonts?.list().then(rows=>{if(live)setFonts(rows);}).catch(()=>{});return()=>{live=false;};},[]);
  const labels={accent:'强调色',accentText:'强调色上的文字',surface:'内容底色',surfaceText:'正文颜色',muted:'次要文字',border:'边框颜色',radius:'面板圆角',fontFamily:'正文字体',headingFont:'标题字体'};
  const values=asset.stageTheme || {};
  const commit=(key,value)=>onCommit(current=>{const stageTheme={...current.stageTheme};if(value===undefined)delete stageTheme[key];else stageTheme[key]=value;const next={...current};if(Object.keys(stageTheme).length)next.stageTheme=stageTheme;else delete next.stageTheme;return next;});
  return h('details',{className:'ap-widget-settings ap-stage-theme'},h('summary',null,'舞台配色（可选）',h(Help,{text:'未指定的值由活动皮肤、背景自动配色和内置主题依次提供。文字对比度不足时仅修正显示，不改写本包。',label:'舞台配色 说明'})),
    // one inline row per value — colours (自动 = 跟随舞台), the radius as a
    // number in px, the fonts as menus whose first item is 跟随舞台.
    h('div',{className:'ap-widget-fields ap-stage-theme-fields'},Object.entries(labels).map(([key,label])=>{const set=values[key]!==undefined;
      // A colour returns to the stage with its popup's 自动; the radius and the fonts have a reset beside the value.
      const reset=set&&['radius','fontFamily','headingFont'].includes(key)&&h(Button,{className:'ap-icon-button ap-widget-reset','aria-label':'恢复跟随 '+label,title:'恢复跟随',onClick:()=>commit(key,undefined)},h(Glyph,{name:'reset'}));
      const field=key==='fontFamily'||key==='headingFont'?h(InlineField,{kind:'menu',label,controlLabel:'舞台'+label,trail:reset,value:values[key]||'',
          options:[{value:'',label:'跟随舞台'},...(values[key]&&!fonts.some(font=>font.id===values[key])?[{value:values[key],label:'字体不可用'}]:[]),...fonts.map(font=>({value:font.id,label:font.family}))],onCommit:v=>commit(key,v||undefined)}):
        key==='radius'?h(InlineField,{kind:'number',label,controlLabel:'舞台'+label,trail:reset,unit:'px',integer:false,min:0,max:40,optional:true,placeholder:'跟随舞台',value:values[key]??null,onCommit:v=>commit(key,v===null?undefined:v)}):
        h(InlineField,{kind:'color',label,controlLabel:'舞台'+label,value:values[key]||'',onCommit:v=>commit(key,v?v.toLowerCase():undefined)});
      return h(React.Fragment,{key},field);})));
}
