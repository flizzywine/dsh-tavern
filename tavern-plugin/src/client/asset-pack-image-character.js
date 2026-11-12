// 配图人物库 in the figure's 「生图」 tab. The 配图 plugin's 人物库 is the one store of a figure's per-view 外貌, its
// outfits' text and its reference images (registerImageLibrary records, schema 4): every edit here writes that record,
// never a copy in the pack. Each write carries the record it was read from; a record changed elsewhere is reloaded.
const IMAGE_TRAIT_FIELDS=[['feature','身份特征'],['face','五官外貌'],['faceBack','五官外貌背面'],['bodySFW','上半身SFW'],['bodySFWBack','上半身SFW背面'],['lowerSFW','下半身SFW'],['lowerSFWBack','下半身SFW背面'],
  ['bodyNSFW','上半身NSFW'],['bodyNSFWBack','上半身NSFW背面'],['lowerNSFW','下半身NSFW'],['lowerNSFWBack','下半身NSFW背面'],['negative','负面']];
const IMAGE_OUTFIT_FIELDS=[['upper','上衣'],['lower','下装'],['shoes','鞋袜'],['accessory','配饰'],['full','全身'],['back','背面'],['negative','负面']];
const IMAGE_CHARACTER_HELP='外貌按配图人物库的分视角写法，写在这里就是写进配图人物库；素材库生图读正面的五官外貌、上半身与下半身。';
function ImageCharacterSection({binding,pack,figure,outfit}) {
  const packId=pack.manifest.id,snapshot=React.useRef(null),active=React.useRef(true),epoch=React.useRef(0);
  const state=useLoad(binding,async()=>{const next=await binding.rpc('getFigureImageCharacter',{packId,figureId:figure.id});snapshot.current=next;return next;},[packId,figure.id]);
  const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false),[source,setSource]=React.useState(''),queue=React.useRef(Promise.resolve());
  React.useEffect(()=>{active.current=true;return()=>{active.current=false;epoch.current++;};},[]);
  const value=state.value,character=value?.status==='linked'?value.character:null;
  const target={packId,figureId:figure.id};
  // Read the returned snapshot from a ref, even before React has rendered the previous write.
  const run=(label,call)=>{const ticket=epoch.current;setBusy(true);queue.current=queue.current.catch(()=>{}).then(async()=>{
    if(!active.current||ticket!==epoch.current)return;
    setError('');
    try{const next=await call(snapshot.current);if(active.current&&ticket===epoch.current&&next?.character){snapshot.current={...next,status:'linked'};state.setValue(snapshot.current);}}
    catch(e){if(active.current){epoch.current++;if(e?.code==='REVISION_CONFLICT'){setError('配图人物库刚在别处改过，已重新载入，请再改一次');await state.reload();}else setError(label+'：'+errorText(e));}}
    finally{if(active.current)setBusy(false);}});return queue.current;};
  const patch=(label,body)=>run(label,current=>binding.rpc('patchImageCharacter',{...target,providerId:current.providerId,characterId:current.character.id,expected:current.character,patch:body(current.character)}));
  if(!value)return state.error?h(ErrorBox,{error:state.error,reload:state.reload}):h(Loading,null);
  const head=h('h4',{className:'ap-sub'},'配图人物库',h(Help,{text:IMAGE_CHARACTER_HELP,label:'配图人物库 说明'}));
  if(value.status==='unavailable')return h('section',{className:'ap-fe-section','aria-label':'配图人物库'},head,h(HintLine,{text:'启用支持共用人物记录的配图插件后，可在这里编辑外貌与设定图'}));
  if(!character){
    const libraries=value.libraries||[],providerId=source||(libraries.length===1?libraries[0].providerId:'');
    const link=choice=>run('关联配图人物库',()=>binding.rpc('linkFigureImageCharacter',{...target,...(choice?JSON.parse(choice):{providerId})}));
    const options=(value.candidates||[]).map(c=>({value:JSON.stringify({providerId:c.providerId,characterId:c.id}),label:(c.name||c.id)+(libraries.length>1?' · '+(c.providerLabel||c.providerId):'')}));
    return h('section',{className:'ap-fe-section','aria-label':'配图人物库'},head,h(ErrorBox,{error}),
      libraries.length>1?h(InlineGrid,{label:'人物库来源'},h(InlineField,{kind:'menu',label:'新建记录的来源',disabled:busy,placeholder:'选择…',options:libraries.map(item=>({value:item.providerId,label:item.label})),value:providerId,onCommit:setSource})):null,
      h(HintLine,{text:'这个人物还没有配图人物库记录',action:providerId&&!busy?'新建记录':undefined,onAction:()=>link('')}),
      options.length?h(InlineGrid,{label:'关联已有记录'},h(InlineField,{kind:'menu',label:'关联已有人物',disabled:busy,placeholder:'选择…',options,value:'',onCommit:id=>id&&link(id)})):null);
  }
  const own=outfit&&character.outfits.find(o=>o.id===outfit.key);
  const writeOutfit=(key,v)=>patch('保存服装',c=>({outfits:[{id:outfit.key,[key]:v,...(c.outfits.some(o=>o.id===outfit.key)?{}:{name:outfit.label})}]}));
  const copy=outfitKey=>run('写入设定图',current=>binding.rpc('copyFigureSetteiToImageCharacter',{...target,providerId:current.providerId,characterId:current.character.id,expected:current.character,...(outfitKey?{outfitKey}:{})}));
  const sheetState=(has,text)=>h('span',{className:'ap-meta'},has?'人物库已有'+text:'人物库还没有'+text);
  return h('section',{className:'ap-fe-section','aria-label':'配图人物库','aria-busy':busy||undefined},head,h(ErrorBox,{error}),
    h(InlineGrid,{label:'人物库外貌'},
      h(InlineField,{kind:'text',label:'名字',controlLabel:'人物库名字',value:character.name,disabled:busy,validate:v=>v.trim()?'':'名字不能为空',onCommit:v=>patch('保存名字',()=>({name:v}))}),
      h(InlineField,{kind:'text',label:'别名',controlLabel:'人物库别名',hideEmpty:true,placeholder:'用逗号分隔',value:character.match||'',disabled:busy,onCommit:v=>patch('保存别名',()=>({match:v}))}),
      IMAGE_TRAIT_FIELDS.map(([key,label])=>h(InlineField,{key,kind:'text',multiline:true,wide:true,label,controlLabel:'人物库'+label,hideEmpty:key!=='face',maxLength:8000,value:character.traits?.[key]||'',disabled:busy,
        onCommit:v=>patch('保存'+label,()=>({traits:{[key]:v}}))}))),
    outfit&&h(InlineGrid,{label:'服装「'+outfit.label+'」'},
      IMAGE_OUTFIT_FIELDS.map(([key,label])=>h(InlineField,{key:outfit.key+key,kind:'text',multiline:true,wide:true,label,controlLabel:'人物库服装'+label,hideEmpty:key!=='upper',maxLength:8000,value:own?.[key]||'',disabled:busy,
        onCommit:v=>writeOutfit(key,v)}))),
    h('div',{className:'ap-actions'},
      sheetState(!!character.referenceImage,'角色设定图'),
      figure.identitySettei?.board&&h(Button,{disabled:busy,onClick:()=>copy('')},character.referenceImage?'用人物设定图替换':'写入人物设定图'),
      outfit&&sheetState(!!own?.characterOutfitImage,'「'+outfit.label+'」的角色×服装设定图'),
      outfit?.settei&&h(Button,{disabled:busy,onClick:()=>copy(outfit.key)},own?.characterOutfitImage?'用服装设定图替换':'写入服装设定图')));
}
