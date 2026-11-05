// Shared voice catalogue picker for core and stage settings.
const voiceKey=voice=>!voice?'':voice.silent?'silent':voice.browser?'browser:'+voice.browser:voice.serviceId?'service:'+JSON.stringify([voice.serviceId,voice.voice])
  :voice.templateId?'template:'+voice.templateId:voice.voiceId?'pack:'+JSON.stringify([voice.packId,voice.voiceId]):'figure:'+JSON.stringify([voice.packId,voice.figureId]);
function voiceFromKey(key) {
  if(!key)return null;
  if(key==='silent')return {silent:true};
  if(key.startsWith('template:'))return {templateId:key.slice(9)};
  if(key.startsWith('pack:')){const [packId,voiceId]=JSON.parse(key.slice(5));return {packId,voiceId};}
  if(key.startsWith('browser:'))return {browser:key.slice(8)};
  if(key.startsWith('service:')){const [serviceId,voice]=JSON.parse(key.slice(8));return {serviceId,voice};}
  const [packId,figureId]=JSON.parse(key.slice(7));
  return {packId,figureId};
}
function generalServiceVoices(tts,s) {
  if(s.voiceList==='preset')return tts.call('listOnlinePresetVoices',{provider:s.kind,serviceId:s.id});
  if(s.voiceList==='fish-recommended')return tts.call('listRecommendedFishVoices',{serviceId:s.id});
  return tts.call('providerVoices',{serviceId:s.id});
}
async function generalVoiceOptions(binding) {
  const browser=typeof window!=='undefined'&&window.speechSynthesis?await browserSpeechVoiceList(window.speechSynthesis):[];
  const services=binding.tts?(await binding.tts.call('voiceServices')).services.filter(s=>s.kind!=='browser'&&s.state!=='needs-key'):[];
  const groups=await Promise.all(services.map(s=>generalServiceVoices(binding.tts,s).then(r=>({s,voices:r?.status==='error'?[]:r?.voices||[]}),()=>({s,voices:[]}))));
  const catalogue=await binding.service.listVoiceCatalogue();
  const seen=new Set();
  return [...catalogue.voices.map(v=>({value:voiceKey(v.ref),label:v.name,group:v.packName||'我的模板'})),...browser.map(v=>({value:voiceKey({browser:v.id}),label:v.label||v.id,group:'浏览器朗读'})),
    ...groups.flatMap(({s,voices})=>voices.map(v=>({value:voiceKey({serviceId:s.id,voice:v.voiceId||v.id}),label:v.name||v.label||v.voiceId||v.id,group:s.label})))]
    .filter(o=>!seen.has(o.value)&&seen.add(o.value));
}
const GENERAL_DEFAULT='浏览器 · 系统默认';
function VoiceCataloguePicker({binding,value,onPick,label,leading=[]}) {
  const [wanted,setWanted]=React.useState(false),[query,setQuery]=React.useState('');
  const list=useVoiceLoad(()=>wanted?generalVoiceOptions(binding):null,[binding,wanted]);
  const voice=voiceFromKey(value),options=list.value||[];
  const found=options.find(o=>o.value===value);
  const shown=leading.find(o=>o.value===value)?.label||(!voice?GENERAL_DEFAULT:found?found.group+' · '+found.label:voice.browser?'浏览器 · '+voice.browser:voice.voice||voice.voiceId||voice.templateId);
  const needle=voiceNeedle(query.trim()),filtered=options.filter(o=>voiceMatches(needle,[o.label,o.group]));
  const pick=(close,key)=>{close();setQuery('');if(key!==value)onPick(key);};
  const item=(close,o)=>h('button',{key:o.value||'default',type:'button',role:'menuitemradio','aria-checked':o.value===value,className:'ap-menu-item',onClick:()=>pick(close,o.value)},
    h('span',null,o.label),o.value===value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})));
  const content=close=>[
    h(PackSearchBox,{key:'search',label:'搜索声音',placeholder:'搜索声音',value:query,onChange:setQuery,className:'is-compact'}),
    ...(!needle?leading.map(o=>item(close,o)):[]),
    ...filtered.flatMap((o,i)=>[o.group&&(i===0||filtered[i-1].group!==o.group)?h('div',{key:'g:'+o.group,role:'presentation',className:'fork-inline-group'},o.group):null,item(close,o)]),
    !list.value?h(Spinner,{key:'loading'}):needle&&!filtered.length?h(EmptyState,{key:'empty',compact:true,text:'没有找到「'+query.trim()+'」'}):null];
  return h(Popover,{label,className:'ap-general-voice',fit:true,limit:360,content,
      trigger:({open,toggle})=>h('button',{type:'button',className:'fork-inline-trigger','aria-haspopup':'menu','aria-expanded':open,'aria-label':label+'：'+shown,
        onClick:()=>{setWanted(true);toggle();}},h('span',{className:'fork-inline-text'},shown),h(Glyph,{name:'chevDown'}))});
}
