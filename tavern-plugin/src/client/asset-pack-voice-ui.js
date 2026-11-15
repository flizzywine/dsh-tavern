// a figure's 声音: the figure page's 「声音」 tab (编辑｜生图｜声音; the preview card stays beside it and speaks with it).
// One thing to choose — a voice: one already in a pack (or 我的模板), or a voice of a service set up in 语音后端 (built from
// the TTS voice services catalog, tts.call('voiceServices')); then that voice's settings and 「调音」 (VoiceTab).
// Editing a voice that other figures share asks first (copy, or all).
// Opening, choosing or saving never synthesizes; ▶ does, and a paid or unknown-cost preview asks first (billing confirm).
// Missing service / key / voice → ⚠ chip, the figure stays silent (不配音); nothing silently switches service.
// @include-protocol tts-messages.cjs
// @include-protocol voice-auto-cast.cjs
const VOICE_PROVIDERS={'fish-audio':'Fish Audio',qwen:'通义千问',azure:'Azure',volcengine:'火山引擎',minimax:'MiniMax','openai-compatible':'自定义语音服务',browser:'浏览器朗读'};
const FIGURE_VOICE_LANGUAGES=[['ja','日语'],['zh','中文'],['en','英语'],['ko','韩语'],['yue','粤语']];
const VOICE_SAMPLES={ja:'こんにちは。今日もよろしくお願いします。',zh:'你好，今天也请多关照。',en:'Hello. It is good to see you today.',ko:'안녕하세요. 오늘도 잘 부탁해요.',yue:'你好，今日都請多多指教。'};
const VOICE_GENDERS={female:'女声',male:'男声',neutral:'中性'};
const VOICE_LANGUAGE_TAG=/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const VOICE_CLIP_ACCEPT='.wav,.mp3,audio/wav,audio/x-wav,audio/mpeg';
// Tunable parameters per provider (native parameter names). Ranges follow the
// adapters' own validators (providers/params.js); Fish has no pitch.
const VOICE_TUNING={
  'fish-audio':[{key:'speed',label:'语速',min:0.5,max:2,step:0.05,base:1,unit:'x'}],
  azure:[{key:'rate',label:'语速',min:-50,max:100,step:5,base:0,unit:'%'},{key:'pitch',label:'音高',min:-50,max:50,step:5,base:0,unit:'%'},{key:'style',label:'风格',kind:'style'}],
  qwen:[{key:'instructions',label:'风格指令',kind:'text'}],
  'openai-compatible':[{key:'speed',label:'语速',min:0.5,max:2,step:0.05,base:1,unit:'x'}]};
const voiceFailure=(code,message)=>Object.assign(new Error(message||code),{code});
const voiceCode=e=>typeof e?.code==='string'?e.code:e?.name==='TimeoutError'?'TIMEOUT':e?.name==='AbortError'?'ABORTED':/^[A-Z][A-Z0-9_]+$/.test(e?.message||'')?e.message:'';
const VOICE_ERRORS={ENOENT:'找不到配音所需的本地文件或程序，请检查语音服务的安装路径和参考音频。',ENOTDIR:'配音所需的本地路径不是文件夹，请检查语音服务的安装路径。',TTS_DISABLED:'配音插件未启用',PLUGIN_UNAVAILABLE:'配音插件未启用',SERVICE_REQUIRED:'这个声音绑定的语音服务还没设置；请到语音后端设置，或重新选择已设置服务的音色',CREDENTIALS_REQUIRED:'语音服务缺少 API Key',
  QWEN_MODEL_NOT_FOUND:'当前服务上次合成无法访问此模型（404），请核对模型开通状态与区域',QWEN_VOICE_UNSUPPORTED:'上次合成返回此模型不支持该音色，请重新选择音色',
  MISSING_REFERENCE:'这个差分没有参考录音，「默认」里也没有',PREVIEW_CONFIRMATION_REQUIRED:'付费确认已过期，请重新试听',PAID_PREVIEW_DISABLED:'这个服务不能免费试听',
  FISH_AUTH_FAILED:'Fish Audio API Key 无效',FISH_BILLING_REQUIRED:'Fish Audio 额度不足：去充值，或换回免费模型',FISH_RATE_LIMITED:'Fish Audio 请求太频繁，请稍后再试',FISH_REQUEST_FAILED:'Fish Audio 请求失败，请稍后再试',
  VOICE_NOT_FOUND:'找不到这个声音',VOICE_VARIANT_IN_USE:'还有别的人物在用这个预设，先给他们换一个预设',SHARED_VOICE_CONFIRMATION_REQUIRED:'这个声音还有别的人物在用，请重新确认',
  REFERENCE_LIMIT_EXCEEDED:'参考音频超过了服务的限制',LIMIT_EXCEEDED:'素材包空间不够了',QUEUE_FULL:'试听太多，请稍后再试',TIMEOUT:'试听超时，请稍后再试',AUDIO_GONE:'试听音频已失效，请重新试听',
  ABORTED:'试听请求已中断，请重新试听；若反复发生，请重新载入声音页。',REQUEST_TIMEOUT:'声音页面请求超时，请重新载入页面；若仍失败，请检查语音服务连接。',
  REVISION_CONFLICT:'内容已被修改，请重新载入',INVALID_INPUT:'内容不符合格式，没有保存',REQUEST_FAILED:'请求失败，请稍后再试',FORBIDDEN:'没有权限'};
// no code on the page — this page's sentence for a code, else the shared playerErrorText
// (the host's plain Chinese sentence, Tavern `error` / TTS `message`); the code goes to the console.
function voiceErrorText(e){const code=voiceCode(e);
  if(code.startsWith('MINIMAX_'))return describeTtsError(code);
  return /^(?:AUDIO_|MEDIA_)/.test(code)&&!VOICE_ERRORS[code]||e?.name==='NotAllowedError'?previewErrorText(e):playerErrorText({code,message:String(e?.message||e||'')},{codes:VOICE_ERRORS,fallback:'声音请求失败，请检查语音后端后重试。'});}
// What the 试听 failure line offers: the 配音 page for a service problem, this source's settings for a voice problem.
const VOICE_SERVICE_CODES=new Set(['SERVICE_REQUIRED','CREDENTIALS_REQUIRED','FISH_AUTH_FAILED','FISH_BILLING_REQUIRED','SERVICE_OFFLINE','INVALID_PATH','INVALID_CONFIG','PORT_OCCUPIED','PROCESS_EXITED','SERVICE_START_FAILED','TTS_DISABLED','QWEN_MODEL_NOT_FOUND']);
// a source not set up yet (older data: a reference list without clips, a voice-id or preset without its voice): what it lacks,
// said once by the voice's ⚠ (the host answers MISSING_REFERENCE / VOICE_NOT_FOUND for it).
const VOICE_UNSET_TEXT={'reference-list':'还没有参考音频','voice-id':'还没选声音',preset:'还没选在线声音'};
// 浏览器朗读 without a voiceName is the system default voice: set up, never unset.
const voiceSourceUnset=s=>s&&(s.kind==='reference-list'?!s.references.length:s.kind==='voice-id'?!s.voiceId:s.provider!=='browser'&&!s.voiceName)?VOICE_UNSET_TEXT[s.kind]:'';
const VOICE_EDIT_CODES=new Set(['MISSING_REFERENCE','LANGUAGE_UNSUPPORTED','QWEN_VOICE_UNSUPPORTED','VOICE_NOT_FOUND']);
const providerName=kind=>VOICE_PROVIDERS[kind]||'语音服务';
// The one line that says why a voice is silent (⚠ chips, the 声音 property's tooltip).
// A Latin service name gets spaces around it inside a Chinese sentence (缺少 Fish Audio API Key / 我的 MiniMax API Key 无效).
const spacedName=name=>(/^[A-Za-z]/.test(name)?' ':'')+name+(/[A-Za-z0-9]$/.test(name)?' ':'');
function voiceIssueText(code,source){
  if(code.startsWith('MINIMAX_'))return describeTtsError(code);
  const name=spacedName(providerName(source?.provider));
  if(code==='SERVICE_REQUIRED')return VOICE_ERRORS.SERVICE_REQUIRED;
  if(code==='CREDENTIALS_REQUIRED')return name.trimStart()+'缺少 API Key';
  // a chosen source not set up yet says what to add, never a code.
  if(VOICE_EDIT_CODES.has(code)&&voiceSourceUnset(source))return voiceSourceUnset(source);
  return VOICE_ERRORS[code]||'暂时不能发声';
}
const voiceLanguageName=tag=>FIGURE_VOICE_LANGUAGES.find(([id])=>id===tag||id===String(tag).split('-')[0])?.[1]||tag;
// which languages a voice source can speak, from the provider and the voice
// itself (the adapters' own lists in dsh-tts core.js / providers). null = not known here (no ⚠ is shown).
const VOICE_SOURCE_LANGUAGES={'fish-audio':['ja','zh','en','ko','fr','de','ru','it','es','pt','ar','nl','pl'],qwen:['zh','en','fr','de','ru','it','es','pt','ja','ko'],
  'openai-compatible':['ja','zh','en','ko','yue']};
const primaryLanguage=tag=>{const p=String(tag||'').split('-')[0].toLowerCase();return p==='all_ja'?'ja':p;};
function voiceSourceLanguages(source){
  if(!source)return null;
  if(source.provider==='azure'){const name=String(source.voiceName||'');if(/multilingual/i.test(name))return null;const locale=name.split('-').slice(0,2).join('-');
    return /^(zh-HK|yue-)/i.test(locale)?['yue']:locale?[primaryLanguage(locale)]:null;}
  return VOICE_SOURCE_LANGUAGES[source.provider]||null;
}
const voiceSpeaks=(source,language)=>{const list=voiceSourceLanguages(source);return !list||list.includes(primaryLanguage(language));};
// one rule (bubble-line.cjs), the same words as upstream's 配音语言 control.
// The voice tab's (?) (调音, 按差分调音) and the one link to 语音后端.
const VOICE_TUNING_HELP='调音预设是这个声音的一套说话参数（语速、音高、风格等，视服务而定）。「原声」是不加调整的原本声音；＋ 复制当前预设做一个新预设，接着就能改名、调参数。点哪个预设，这个人物平时就用哪个。';
const VOICE_MOOD_TUNING_HELP='让不同的表情差分自动换用不同的调音预设。例如把「生气」设为预设「急促」：台词带生气差分时用「急促」说，没设的差分跟随上面选中的预设。';
const VOICE_BACKEND_LINK='去语音后端设置 ›';
const VOICE_AUTO_CAST_HELP='打开后，自动素材助手给新人物配声音时会考虑这个声音；在使用情景里写它适合什么人（如「适合中年男性」），助手挑得更准。';
const VOICE_GUIDANCE_MAX=60,VOICE_GUIDANCE_HELP='自动素材的舞台助手给人物找声音时，会在所有已安装素材包的声音里，按「名称」和这句话搜关键词。写这个声音适合什么样的人，如「适合中年男性」「毒舌少女」，助手才搜得到、挑得对。';
const VOICE_LANGUAGE_HELP='不是中文时，AI 会为这个角色额外写一句这门语言的台词用来配音，画面上仍显示中文。';
const pickVoiceLanguage=(list,fallback='zh')=>(list||[]).map(l=>String(l).toLowerCase()).find(l=>VOICE_LANGUAGE_TAG.test(l))||fallback;
const figureVoiceSpec=(pack,figure)=>figure.voice?pack.manifest.voiceLibrary?.voices?.[figure.voice.voice]||null:null;
const voiceSourceId=(spec,binding)=>binding?.source===null?null:binding?.source??spec.defaultSource;
const voiceUsers=(pack,voiceId)=>Object.values(pack.figures||{}).filter(f=>f.voice?.voice===voiceId);
// 选声音's services — one tab per service set up in 语音后端, in its order and by its own name, then 浏览器朗读. A tab lists
// what its provider offers (the catalog's `sources` and `models`, one declaration per provider kind in dsh-tts params.js):
// Fish Audio — 声音库 and / or 参考音频克隆 (生成方式, when its service has both); an online service — 模型 · 音色; 浏览器朗读 — 音色.
// With several services of one kind a pick under one writes that service's id into the source (`bind`), since a source
// without one is ambiguous among them.
const FISH_WAYS=[{id:'library',name:'声音库',kind:'voice-id'},{id:'clone',name:'参考音频克隆',kind:'reference-list'}];
const BROWSER_ROW={id:'browser',key:'browser',kind:'browser',provider:'browser',title:'浏览器朗读',name:'浏览器朗读',ways:[]};
// The catalog's set-up services (浏览器朗读 is its own tab); a service that offers no source kind is not listed.
const catalogServices=catalog=>(catalog?.services||[]).filter(s=>s.kind!=='browser'&&s.sources.length);
function voiceSourceRows(catalog){
  const services=catalogServices(catalog),count=kind=>services.filter(s=>s.kind===kind).length;
  const rows=services.map(s=>{const name=s.label||providerName(s.kind);
    return {id:'service:'+s.id,key:'service:'+s.id,title:name,name,kind:s.kind,provider:s.kind,service:s,serviceId:s.id,bind:count(s.kind)>1,custom:s.voiceList==='provider',
      ways:s.kind==='fish-audio'?FISH_WAYS.filter(w=>s.sources.includes(w.kind)):[]};});
  return [...rows,BROWSER_ROW];
}
// Does a row speak with this source: its provider, and for a row of one of several services, that service.
const rowHolds=(row,source)=>!!source&&!!row.provider&&source.provider===row.provider&&(!row.bind||source.serviceId===row.serviceId);
// A source as a row writes it: a row of one of several services names that service.
const rowSource=(row,source)=>row.bind?{...source,serviceId:row.serviceId}:source;
const voiceSourceLabel=source=>source.provider==='browser'?'浏览器朗读':providerName(source.provider)+(source.kind==='reference-list'?' · 参考音频克隆':source.kind==='voice-id'?' · 声音库':'');
// The state of a row, in the words of 语音后端 (one set for every service): 可用, or ⚠ and why. A service not checked yet
// is 可用 (a local server that idles starts when used). 浏览器朗读: ⚠ when this device cannot speak, or has no voice in the
// figure's 配音语言 (`browserVoices`, once read).
const SERVICE_STATE_WORDS={'needs-key':'缺少 API Key','invalid-key':'API Key 无效',stopped:'未启动',rejected:'访问被拒绝',offline:'连不上'};
function voiceRowState(row,language,browserVoices){
  if(row.kind==='browser'){
    if(typeof window==='undefined'||!window.speechSynthesis)return {warn:true,text:'这台设备不支持'};
    if(browserVoices&&!browserVoices.some(v=>(v.languages||[]).some(l=>primaryLanguage(l)===primaryLanguage(language))))return {warn:true,text:'这台设备没有'+voiceLanguageName(primaryLanguage(language))+'声音'};
    return {text:'可用'};
  }
  const word=SERVICE_STATE_WORDS[row.service.state];
  return word?{warn:true,setup:true,text:word}:{text:'可用'};
}
// Azure voice names read as the voice (en-US-AshleyNeural → Ashley), not as an internal id.
const voiceDisplayName=name=>String(name||'').replace(/^[a-z]{2,3}-[A-Z]{2}-/,'').replace(/(?:Multilingual)?Neural$/,'')||name;
const sampleText=language=>VOICE_SAMPLES[String(language).split('-')[0]]||VOICE_SAMPLES.en;
const voiceBytes=n=>!Number.isFinite(n)?'':n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(n<10*1024*1024?1:0)+' MB';
const voiceSeconds=s=>!Number.isFinite(s)?'':s<60?(Math.round(s*10)/10)+' 秒':Math.floor(s/60)+' 分 '+Math.round(s%60)+' 秒';
const tuneText=(def,v)=>def.unit==='x'?Number(v).toFixed(2)+'×':(v>0?'+':'')+v+'%';
// a 声音预设 is one pack voice × one of its variants (原声 = the implicit 'normal'). The UI lists
// them flat; the data stays voice v4 (voiceLibrary voices + variants, the figure binding's voice / variant).
const voicePresets=spec=>{const v=spec.variants||{};return {normal:{name:'原声',...(v.normal||{})},...Object.fromEntries(Object.entries(v).filter(([k])=>k!=='normal'))};};
const presetName=(spec,id)=>id==='normal'?(spec.variants?.normal?.name||'原声'):spec.variants?.[id]?.name||'未命名预设';
const cleanBinding=b=>{const next={...b};for(const k of Object.keys(next))if(next[k]===undefined)delete next[k];return next;};
const cloneSpec=(figure,language,references)=>({name:figure.name+'的声音',language,defaultSource:'fish',sources:{fish:{kind:'reference-list',provider:'fish-audio',references}}});
// `row`: the 声音库 row picked under (a row of one of several Fish services names it).
const fishVoiceSpec=(v,fallbackName,row)=>({name:v?.name||fallbackName,language:pickVoiceLanguage(v?.languages),defaultSource:'fish',sources:{fish:rowSource(row||{},{kind:'voice-id',provider:'fish-audio',voiceId:v.voiceId})}});

// ---------- data + preview plumbing ----------
// `keep`: a re-read after a dependency change keeps showing the last answer (no spinner, the rows and their focus stay).
function useVoiceLoad(loader,deps,{keep=false}={}){
  const [state,setState]=React.useState({value:null,error:''}),seq=React.useRef(0);
  const load=()=>{const n=++seq.current;setState(s=>({value:s.value,error:''}));previewWait(Promise.resolve().then(loader),15000,'REQUEST_TIMEOUT').then(value=>{if(n===seq.current&&(value!==null||!keep))setState({value,error:value?.message||''});},e=>{if(n===seq.current)setState(s=>({value:s.value,error:voiceErrorText(e)}));});};
  React.useEffect(()=>{if(!keep)setState({value:null,error:''});load();return()=>{seq.current++;};},deps);
  React.useEffect(()=>{if(!state.value?.refreshing)return;const timer=setTimeout(load,1000);return()=>clearTimeout(timer);},[state.value]);
  return {...state,reload:load};
}
function voiceTts(binding){if(!binding.tts?.call)throw voiceFailure('TTS_DISABLED');return binding.tts;}
// can a provider speak now — read from the TTS voice services catalog (each set-up service's
// state from its last check; no request). null = nothing wrong known; {warn,setup} = a problem fixed in 语音后端
// (`missing`: no such service is set up there). `serviceId`: one service of several of that kind (a row of its own).
function voiceReadiness(catalog,provider,serviceId){
  // Browser speech needs no service; a device without it says so.
  if(provider==='browser')return typeof window!=='undefined'&&window.speechSynthesis?null:{warn:true,text:'这台设备不支持浏览器朗读'};
  if(!catalog||!provider)return null;
  const name=providerName(provider),mine=catalog.services.filter(s=>s.kind===provider&&(!serviceId||s.id===serviceId));
  if(!mine.length)return {warn:true,setup:true,missing:true,text:'还没有在语音后端设置'+spacedName(name).trimEnd()};
  if(mine.some(s=>!SERVICE_STATE_WORDS[s.state]))return null;
  const label=spacedName(mine[0].label||name).trimStart();
  return {warn:true,setup:true,text:label+SERVICE_STATE_WORDS[mine[0].state]};
}
// The catalog (`.services`, null until read or without the TTS plugin), re-read after any TTS event.
function useVoiceReadiness(binding){
  const state=useVoiceLoad(()=>binding.tts?.call?binding.tts.call('voiceServices'):null,[binding]),value=state.value;
  useVoiceRefresh(binding,state.reload);
  return Object.assign((provider,serviceId)=>voiceReadiness(value,provider,serviceId),{services:value,loaded:!!value||!binding.tts?.call,error:state.error,reload:state.reload});
}
// 「去设置」: the 配音 page (right sidebar) opens with that service's row open (dsh-tts reads the same session key once);
// `id` opens that saved service, `add` opens 添加语音服务 with the kind chosen.
const VOICE_FOCUS_KEY='dsh-tts:focus-service';
// 「付费试听」 can be told 「不再提示」 — one machine-wide UI
// preference (localStorage like the panel's other UI preferences, never per card); the voice's ⋯ 「付费试听前确认」 turns it back on.
const VOICE_PAID_ASK_KEY='dsh-tavern:voice-paid-preview-ask';
const voicePaidAsk={
  get(){try{return localStorage.getItem(VOICE_PAID_ASK_KEY)!=='off';}catch(_){return true;}},
  set(on){try{if(on)localStorage.removeItem(VOICE_PAID_ASK_KEY);else localStorage.setItem(VOICE_PAID_ASK_KEY,'off');}catch(_){}}};
// 「语音后端 ›」 with no provider opens the page as it is (its unset service kinds are rows to set up). The pack window's nav
// closes the window first (PackModal tabNav); once the tab is open, the same event tells an already-mounted page to take
// the request and move the keyboard focus there.
function openVoiceSettings(nav,provider,{id,add}={}){
  try{sessionStorage.setItem(VOICE_FOCUS_KEY,JSON.stringify({kind:provider||'',...(id?{id}:{}),...(add?{add:true}:{}),at:Date.now()}));}catch(_){}
  return Promise.resolve(nav.openTab('dsh-tts:voice')).then(()=>{if(typeof window!=='undefined')window.dispatchEvent(new window.Event(VOICE_FOCUS_KEY));});
}
// re-read a useVoiceLoad in place (value kept until the new one arrives) after any
// TTS event (a synthesis finished, presets changed) or when `deps` change after mount — a refresh never blanks the ⚠.
function useVoiceRefresh(binding,reload,deps){
  const latest=React.useRef(reload),mounted=React.useRef(false);latest.current=reload;
  React.useEffect(()=>binding?.tts?.subscribe?.(()=>latest.current()),[binding]);
  React.useEffect(()=>{if(mounted.current)latest.current();mounted.current=true;},deps||[]);
}
function useVoiceModelStatus(binding,source,version) {
  const state=useVoiceLoad(()=>binding.tts?.call('voiceModelStatus',{provider:source?.provider,model:source?.model,voiceName:source?.voiceName})||null,
    [binding,source?.provider,source?.model,source?.voiceName]);
  useVoiceRefresh(binding,state.reload,[version]);
  return state;
}
function VoiceConfirmedWarning({issues,field}) {
  const issue=issues?.find(i=>(!field||i.field===field)&&['QWEN_MODEL_NOT_FOUND','QWEN_VOICE_UNSUPPORTED'].includes(i.code));
  if(!issue)return null;
  const text=voiceIssueText(issue.code);
  return h('span',{className:'ap-hint-line is-compact'},h('span',{className:'ap-hint-mark',role:'img','aria-label':text},'⚠'),h(Help,{text,label:'配音警告说明'}));
}
// The saved figure's effective state (⚠ issues) from getFigureVoiceEditor; never synthesizes or calls a provider.
function useFigureVoiceStatus(binding,pack,figure){
  const [status,setStatus]=React.useState(null),[tick,setTick]=React.useState(0),key=pack.manifest.id+'/'+figure.id+'@'+pack.revision+'#'+tick;
  React.useEffect(()=>binding.tts?.subscribe?.(()=>setTick(n=>n+1)),[binding]);
  React.useEffect(()=>{
    let live=true;if(!figure.voice||!binding.rpc){setStatus(null);return;}
    binding.rpc('getFigureVoiceEditor',{packId:pack.manifest.id,figureId:figure.id}).then(r=>{if(live)setStatus({key,effective:r.effective||null,issues:r.issues||[]});},()=>{if(live)setStatus(null);});
    return()=>{live=false;};
  },[binding,key]);
  return status;
}
// A preview job already submitted by previewFigureVoice: poll the TTS job, then fetch through its audio ticket.
async function voiceJobWait(tts,requestId,timeoutMs,live,signal){
  const deadline=Date.now()+(timeoutMs||125000);
  while(live()&&Date.now()<deadline){
    const status=await previewWait(tts.jobStatus(requestId,{signal}),Math.min(15000,Math.max(1,deadline-Date.now())),'REQUEST_TIMEOUT',signal);
    if(status.state==='ready')return status.result;
    if(status.state==='error')throw voiceFailure(status.error,status.message);
    if(status.state==='cancelled')throw voiceFailure('ABORTED');
    await new Promise(r=>setTimeout(r,200));
  }
  throw voiceFailure(live()?'TIMEOUT':'ABORTED');
}
// the figure editor's preview card speaks with whatever voice the
// editor plays — 试听, a reference clip, a list's ▶ — one audio element at a time, and the 差分 it speaks in ('' = the 差分
// on show). Players call speak(audio, mood) once it plays and hush(audio) when it ends or stops; the card reads `audio` /
// `mood` and moves its mouth through the stage's own driver (forkLipSync on that element). A finished element leaves the
// stage mixer it was routed into for its analyser (forkStageAudio.release; previews never reuse an element).
function usePreviewSpeech(){
  const [now,setNow]=React.useState(null),api=React.useRef(null);
  if(!api.current)api.current={
    // Auditions use the non-ducking preview bus and respect master volume and mute.
    route:(audio,loudness)=>{if(typeof forkStageAudio!=='undefined'){forkStageAudio.wake();forkStageAudio.preview(audio,loudness);}},
    speak:(audio,mood)=>setNow({audio,mood:mood||''}),
    hush:audio=>{setNow(s=>s?.audio===audio?null:s);if(typeof forkStageAudio!=='undefined')forkStageAudio.release(audio);}};
  return {...api.current,audio:now?.audio||null,mood:now?.mood||''};
}
// One voice preview at a time per figure editor. A paid / unknown-cost service answers `confirmation-required`: the
// billing dialog asks once; only then the same request is resent with its one-time token. Cancel never resends.
// `speech` (usePreviewSpeech) hears the playing element, so the preview card lip-syncs to it.
function useVoicePreview(binding,speech){
  const [state,setState]=React.useState(null),[ask,setAsk]=React.useState(null),current=React.useRef(null),kinds=React.useRef(null);
  const finish=run=>{if(run.requestId&&!run.done)binding.tts?.cancelJob(run.requestId);if(run.scope){const scope=run.scope;run.scope=null;binding.rpc('closeFigureVoicePreview',{scope}).catch(()=>{});}};
  function stop(){const run=current.current;current.current=null;if(run){run.cancelled=true;run.abort.abort(voiceFailure('ABORTED'));run.resolve?.(false);try{clearPreviewAudio(run.audio);}catch(_){}if(run.audio)speech?.hush(run.audio);finish(run);}setAsk(null);setState(null);}
  React.useEffect(()=>stop,[binding]);
  // The billed service and the model this figure's source speaks with (the host's billing.modelLabel, e.g. Fish 「Drama 3」),
  // for the dialog's sentence.
  async function serviceName(id,modelLabel){
    try{kinds.current||=binding.rpc('getAssetVoiceServices').then(r=>r.services||[]);const s=(await kinds.current).find(x=>x.id===id);
      return s?providerName(s.kind)+(modelLabel?' · '+modelLabel+'（计费）':''):'付费语音服务';}catch(_){return '付费语音服务';}
  }
  async function play(key,request,{label='',mood='',notice=''}={}){
    if(current.current?.key===key){stop();return;}
    stop();
    const run={key,abort:new AbortController()};current.current=run;setState({key,phase:'loading'});
    const live=()=>current.current===run&&!run.cancelled;
    const failed=e=>{if(current.current===run){stop();setState({key,phase:'error',error:voiceErrorText(e),code:voiceCode(e)});}};
    const submit=input=>previewWait(binding.rpc('previewFigureVoice',input).then(result=>{if(!live()&&result.scope)finish({scope:result.scope,requestId:result.requestId});return result;}),15000,'REQUEST_TIMEOUT',run.abort.signal);
    try{
      if(!binding.tts)throw voiceFailure('TTS_DISABLED');
      let result=await submit(request);
      if(result.status==='confirmation-required'){
        if(!live())return;
        // 「不再提示」 once chosen: the same one-time token is sent back at once (the host still gates every paid preview).
        let ok=!voicePaidAsk.get();
        if(!ok){
          const service=await previewWait(serviceName(result.billing?.serviceId,result.billing?.modelLabel),15000,'REQUEST_TIMEOUT',run.abort.signal);
          const answer=live()&&await new Promise(resolve=>{run.resolve=resolve;setAsk({label,service,notice,resolve});});
          ok=!!answer;if(answer?.quiet)voicePaidAsk.set(false);
        }
        run.resolve=null;setAsk(null);
        if(!ok||!live()){if(current.current===run){current.current=null;setState(null);}return;}
        result=await submit({...request,confirmToken:result.confirmToken});
        if(result.status!=='submitted')throw voiceFailure('PREVIEW_CONFIRMATION_REQUIRED');
      }
      run.scope=result.scope;run.requestId=result.requestId;
      if(!live()){finish(run);return;}
      if(result.status!=='submitted')throw voiceFailure('REQUEST_FAILED');
      const done=await voiceJobWait(binding.tts,result.requestId,result.timeoutMs,live,run.abort.signal);run.done=true;
      if(!live())return;
      if(typeof Audio==='undefined')throw voiceFailure('AUDIO_GONE');
      const audio=new Audio(binding.tts.audioUrl(done.ticket));
      run.audio=audio;forkStageAudio.preview(audio,done.loudness);
      audio.onended=()=>{if(current.current===run)stop();};
      audio.onerror=()=>failed(previewAudioError(audio));
      await playPreviewAudio(run.audio,run.abort.signal);
      if(live()){setState({key,phase:'playing'});speech?.speak(run.audio,mood);}
    }catch(e){failed(e);}
  }
  // a catalogue voice's official sample plays
  // without synthesis or billing. The TTS host downloads a sample its discovery listed once into its own cache, measures
  // it there and serves it same-origin (no browser CORS); it plays on the mixer's preview bus like every audition.
  // allback ({request,label}): a sample the host cannot fetch (SAMPLE_UNAVAILABLE) is not left as an error — the voice is
  // synthesised for one short line instead, through the paid-preview gate, whose dialog says so.
  async function playSample(key,sample,fallback){
    if(current.current?.key===key){stop();return;}
    stop();
    const run={key,abort:new AbortController()};current.current=run;setState({key,phase:'loading'});
    const live=()=>current.current===run&&!run.cancelled;
    const failed=e=>{if(current.current===run){stop();setState({key,phase:'error',error:voiceErrorText(e),code:voiceCode(e)});}};
    try{
      const clip=await previewWait(voiceTts(binding).call('fishSample',sample),30000,'REQUEST_TIMEOUT',run.abort.signal);
      if(!live())return;
      if(typeof Audio==='undefined')throw voiceFailure('AUDIO_GONE');
      const audio=new Audio(clip.url);run.audio=audio;
      forkStageAudio.preview(audio,clip.loudness);
      audio.onended=()=>{if(current.current===run)stop();};
      audio.onerror=()=>failed(previewAudioError(audio));
      await playPreviewAudio(run.audio,run.abort.signal);
      if(current.current===run&&!run.cancelled)setState({key,phase:'playing'});
    }catch(e){
      if(fallback&&voiceCode(e)==='SAMPLE_UNAVAILABLE'&&current.current===run){stop();play(key,fallback.request,{label:fallback.label,notice:'这个声音的官方样例暂时取不到，改为合成一句短句试听。'});}
      else failed(e);}
  }
  // Browser speech: the system speaks the sample itself — free, no job, outside the mixer
  // (master volume only); the preview card's mouth follows it.
  function playBrowser(key,line,{mood=''}={}){
    if(current.current?.key===key){stop();return;}
    stop();
    const run={key,abort:new AbortController()},audio=browserSpeechClip(line,true);run.audio=audio;current.current=run;
    audio.onended=audio.onpause=()=>{if(current.current===run)stop();};
    audio.play().then(()=>{if(current.current===run){setState({key,phase:'playing'});speech?.speak(audio,mood);}},
      ()=>{if(current.current===run){stop();setState({key,phase:'error',error:'这台设备不支持浏览器朗读',code:''});}});
  }
  const dialog=ask&&h(VoiceBillingDialog,{...ask,onCancel:()=>ask.resolve(false),onConfirm:quiet=>ask.resolve({quiet})});
  return {state,play,playSample,playBrowser,stop,dialog,of:key=>state?.key===key?state:null};
}
// `service`: the billed service and model (「Fish Audio · Drama 3（计费）」). 「不再提示」 applies on 确认试听 only.
function VoiceBillingDialog({label,service,notice,onConfirm,onCancel}) {
  const [quiet,setQuiet]=React.useState(false);
  return h(Modal,{title:'付费试听',onClose:onCancel,closable:false,className:'ap-confirm ap-voice-dialog'},
    h('p',null,(notice?notice+' ':'')+'试听'+(label?'「'+label+'」':'')+'会用'+spacedName(service)+'合成一句短句，按服务价格计费一次。'),
    h('button',{type:'button',role:'checkbox','aria-checked':quiet,className:'ap-check-row ap-voice-quiet',onClick:()=>setQuiet(v=>!v)},
      h('span',{className:'ap-check-mark','aria-hidden':true},quiet&&h(Glyph,{name:'check'})),h('span',null,'不再提示')),
    h(Actions,null,h(Button,{onClick:onCancel},'取消'),h(Button,{primary:true,onClick:()=>onConfirm(quiet)},'确认试听')));
}
function VoiceSharedDialog({figure,others,onPick}) {
  const names=others.map(f=>f.name).join('、');
  return h(Modal,{title:'这个声音还有别的人物在用',onClose:()=>onPick(null),closable:false,className:'ap-confirm ap-voice-dialog'},
    h('p',null,'「'+names+'」也在用这个声音。只改「'+figure.name+'」会复制一份给它单独用；一起修改会影响所有在用的人物。'),
    h(Actions,null,h(Button,{onClick:()=>onPick(null)},'取消'),h(Button,{onClick:()=>onPick('all')},'一起修改'),h(Button,{primary:true,onClick:()=>onPick('copy')},'只改「'+figure.name+'」')));
}
// Reference clips are WAV / MP3 only (the TTS reference contract); the bytes are checked here once, the pack checks again.
async function prepareVoiceClip(file,limit){
  const bytes=new Uint8Array(await file.arrayBuffer()),ext=audioExt(bytes);
  if(ext!=='wav'&&ext!=='mp3')throw new Error('参考音频只能是 WAV 或 MP3');
  if(bytes.length>(limit||60*1024*1024))throw new Error(limit?'这里的单段参考音频不能超过 '+voiceBytes(limit):'音频过大（上限 60 MB）');
  return {bytes,descriptor:{ext,mime:AUDIO_MIME[ext],size:bytes.length}};
}
// Every pack write of the page goes through the modal's serialized CAS queue (commitVoice). An edit of the figure's
// voice: only this figure uses it → write it; other figures too → ask (copy for this figure, or everyone).
function useVoiceWriter({binding,pack,figure,commitVoice,setError,askShared}) {
  const svc=binding.service,packId=pack.manifest.id,figureId=figure.id,everyone=React.useRef(null),[busy,setBusy]=React.useState(0);
  React.useEffect(()=>{everyone.current=null;},[figure.voice?.voice]);
  const run=async job=>{setBusy(n=>n+1);setError('');try{return await commitVoice(job);}catch(e){setError(voiceErrorText(e));return null;}finally{setBusy(n=>n-1);}};
  const setBinding=next=>run(c=>svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:next}));
  const patchBinding=patch=>run(c=>svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:cleanBinding({...c.figures[figureId].voice,...patch})}));
  const createVoice=spec=>run(c=>svc.createAndAssignPackVoice({packId,figureId,expectedRevision:c.revision,voiceSpec:spec}));
  async function scope(){
    const id=figure.voice?.voice,others=voiceUsers(pack,id).filter(f=>f.id!==figureId);
    if(!others.length)return 'own';
    if(everyone.current===id)return 'all';
    const pick=await askShared(others);if(pick==='all')everyone.current=id;return pick;
  }
  const copyFor=async(c,spec,b)=>{const made=await svc.createAndAssignPackVoice({packId,figureId,expectedRevision:c.revision,voiceSpec:spec});return svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:made.snapshot.revision,binding:{...b,voice:made.voiceId}});};
  // `variant`: {id} saves one tuning through savePackVoiceVariant; otherwise the whole voice through savePackVoice.
  const apply=(how,make,variant)=>run(async c=>{
    const b=c.figures[figureId].voice,id=b.voice,spec=make(structuredClone(c.manifest.voiceLibrary.voices[id])),used=voiceUsers(c,id).some(f=>f.id!==figureId);
    if(how==='copy')return copyFor(c,spec,b);
    if(variant)return svc.savePackVoiceVariant({packId,figureId,expectedRevision:c.revision,voiceId:id,variantId:variant.id,variant:spec.variants[variant.id],...(used?{confirmShared:true}:{})});
    return svc.savePackVoice({packId,figureId,expectedRevision:c.revision,voiceId:id,voiceSpec:spec,...(used?{confirmShared:true}:{})});
  });
  const editVoice=async(make,variant)=>{const how=await scope();return how?apply(how,make,variant):null;};
  async function deleteVariant(variantId){
    const how=await scope();if(!how)return null;
    return run(async c=>{
      const b=c.figures[figureId].voice,id=b.voice,spec=structuredClone(c.manifest.voiceLibrary.voices[id]),clean={...b};
      if(clean.variant===variantId)delete clean.variant;
      if(clean.emotionVariants){const map=Object.fromEntries(Object.entries(clean.emotionVariants).filter(([,v])=>v!==variantId));if(Object.keys(map).length)clean.emotionVariants=map;else delete clean.emotionVariants;}
      if(spec.variants){delete spec.variants[variantId];if(!Object.keys(spec.variants).length)delete spec.variants;}
      if(how==='copy')return copyFor(c,spec,clean);
      let s=c;if(JSON.stringify(clean)!==JSON.stringify(b))s=(await svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:s.revision,binding:clean})).snapshot;
      return svc.deletePackVoiceVariant({packId,figureId,expectedRevision:s.revision,voiceId:id,variantId,...(voiceUsers(s,id).some(f=>f.id!==figureId)?{confirmShared:true}:{})});
    });
  }
  async function upload(files,language,limit){
    const refs=[];
    for(const file of files){
      let media;try{media=await prepareVoiceClip(file,limit);}catch(e){setError(errorText(e));return null;}
      const blob=await run(c=>svc.putBlob({packId,expectedRevision:c.revision,bytes:media.bytes,descriptor:media.descriptor}));
      if(!blob)return null;refs.push({media:blob.hash,text:'',language});
    }
    return refs;
  }
  // New clips for the figure's voice (声音设置 › 参考音频): `place(spec, refs)` puts them in its reference list.
  async function addClips(files,{language,limit,place}){
    const how=await scope();if(!how)return null;
    const refs=await upload(files,language,limit);if(!refs)return null;
    return apply(how,spec=>{place(spec,refs);return spec;});
  }
  // 参考音频克隆 under a Fish service (`row`): the clips make a new voice of the pack, and the figure speaks with it.
  async function cloneVoice(files,{language,row}){
    const refs=await upload(files,language);if(!refs)return null;
    const made=cloneSpec(figure,language,refs);made.sources.fish=rowSource(row,made.sources.fish);
    return createVoice(made);
  }
  // Another pack's voice: copied into this pack (its clips too) for the figure.
  const copyPackVoice=ref=>run(c=>svc.assignPackVoiceCopy({sourcePackId:ref.packId,voiceId:ref.voiceId,packId,figureId,expectedRevision:c.revision}));
  // A voice of this pack renamed from its row (it is the same voice for everyone who speaks with it).
  const renameVoice=(voiceId,name)=>run(c=>svc.savePackVoice({packId,figureId,expectedRevision:c.revision,voiceId,voiceSpec:{...c.manifest.voiceLibrary.voices[voiceId],name},
    ...(voiceUsers(c,voiceId).some(f=>f.id!==figureId)?{confirmShared:true}:{})}));
  // `place` edits a copy of the figure's voice and returns the source id the figure then speaks with.
  async function placeSource(place){
    const how=await scope();if(!how)return null;
    return run(async c=>{
      const b=c.figures[figureId].voice,id=b.voice,next=structuredClone(c.manifest.voiceLibrary.voices[id]),sid=place(next);
      const bound=cleanBinding({...b,source:sid===next.defaultSource?undefined:sid});
      if(how==='copy')return copyFor(c,next,bound);
      const m=await svc.savePackVoice({packId,figureId,expectedRevision:c.revision,voiceId:id,voiceSpec:next,...(voiceUsers(c,id).some(f=>f.id!==figureId)?{confirmShared:true}:{})});
      return JSON.stringify(bound)===JSON.stringify(b)?m:svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:m.snapshot.revision,binding:bound});
    });
  }
  // A row of another service of the same kind: the source keeps its clips / voice and names that service; its model stays
  // only where that service offers it (`models`, the catalog's list; none listed keeps it).
  const useSourceService=(sid,serviceId,models=[])=>placeSource(next=>{const s={...next.sources[sid],serviceId};
    if(s.model&&models.length&&!models.some(m=>m.id===s.model))delete s.model;next.sources[sid]=s;return sid;});
  // 模型 of one source (a Fish row's own choice).
  const setSourceModel=(sid,model)=>editVoice(s=>{s.sources[sid]={...s.sources[sid],model};return s;});
  // Use a source id of the figure's voice (the way's row), or null for 不配音.
  const useSourceId=sid=>run(c=>{const b=c.figures[figureId].voice,spec=c.manifest.voiceLibrary.voices[b.voice],next=cleanBinding({...b,source:sid===null?null:sid===spec.defaultSource?undefined:sid});
    return JSON.stringify(next)===JSON.stringify(b)?{status:'noop'}:svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:next});});
  const assignTemplate=t=>run(c=>svc.assignVoiceTemplate({templateId:t.templateId,templateRevision:t.revision,packId,figureId,expectedRevision:c.revision}));
  // `voiceId`: a voice of the pack's list; none = the figure's own, with its binding (variant, 配音语言, 按差分调音).
  const saveTemplate=voiceId=>run(c=>{const own=c.figures[figureId].voice,id=voiceId||own.voice;
    return svc.saveVoiceTemplate({expectedRevision:null,packId,packRevision:c.revision,voiceId:id,binding:own?.voice===id?own:{voice:id}});});
  return {busy,run,setBinding,patchBinding,createVoice,editVoice,deleteVariant,addClips,cloneVoice,copyPackVoice,renameVoice,useSourceId,useSourceService,setSourceModel,assignTemplate,saveTemplate};
}

// ---------- small pieces ----------
function VoicePlay({state,label,onClick,disabled,title,className=''}) {
  const on=!!state&&state.phase!=='error';
  return h('button',{type:'button',className:'ap-icon-button ap-voice-play'+(className?' '+className:''),'aria-label':on?'停止试听':label,'aria-pressed':on,'data-state':state?.phase,
      title:state?.phase==='error'?state.error:on?'停止试听':title||label,disabled:!!disabled&&!on,onClick},
    state?.phase==='loading'?h(Spinner,{key:'voice'}):h(Glyph,{name:state?.phase==='error'?'warning':on?'stop':'play'}));
}
function VoiceWarn({children,action}) { return h('span',{className:'ap-voice-warn',role:'status'},h(Glyph,{name:'warning'}),h('span',null,children),action||null); }
function VoiceLoading(props) { return h(PanelLoading,{count:4,...props}); }
function VoiceLoadError({error,retry}) { return h('p',{className:'ap-voice-line-warn',role:'alert'},h(VoiceWarn,null,error),retry&&h(Button,{className:'ap-link',onClick:retry},'重试')); }
// The 声音 pill's disc: the figure's colour, a still waveform that moves while this voice is speaking.
function VoiceDisc({playing,empty}) {
  return h('span',{className:'ap-voice-disc','data-playing':playing||undefined,'data-empty':empty||undefined,'aria-hidden':true},[0,1,2,3,4].map(i=>h('i',{key:i})));
}
function VoiceMoodPick({rows,value,onPick}) {
  const row=rows.find(r=>r.id===value)||rows[0];
  if(!row)return null;
  return h(Popover,{label:'试听差分',float:true,fit:true,className:'ap-voice-mood-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-mood','aria-label':'试听差分：'+row.label,'aria-expanded':open,onClick:toggle},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,row.label),h(Glyph,{name:'chevDown'})),
    content:close=>rows.map(r=>h('button',{key:r.id,type:'button',role:'menuitemradio','aria-checked':r.id===row.id,className:'ap-menu-item',onClick:()=>{close();onPick(r.id);}},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,r.label),r.id===row.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// A 配音语言 as one short square in a voice row (中 / 日 / 英 …); the full name is its tooltip.
const VOICE_LANGUAGE_SHORT={zh:'中',ja:'日',en:'英',ko:'韩',yue:'粤',fr:'法',de:'德',es:'西',it:'意',pt:'葡',ru:'俄'};
function VoiceLangChip({tag}) {
  const p=primaryLanguage(tag),name=voiceLanguageName(p);
  return h('span',{className:'ap-voice-lang-chip',title:name,'aria-label':name},VOICE_LANGUAGE_SHORT[p]||p.toUpperCase());
}
// Who speaks with a voice: up to three faces (this pack's figures by their face; another pack's by colour). None: nothing.
function VoiceFaces({binding,pack,figures,users}) {
  const list=figures?figures.map(f=>({key:f.id,name:f.name,el:h(FigureCastFace,{binding,packId:pack.manifest.id,figure:f,sprites:pack.sprites,avatar:figureAvatar(f,pack.sprites),label:f.name,className:'ap-voice-face'})})):
    (users||[]).map(u=>({key:u.id,name:u.name,el:h(Silhouette,{figure:u,className:'ap-voice-face'})}));
  if(!list.length)return null;
  const names=list.map(x=>x.name).join('、')+' 在用';
  return h('span',{className:'ap-voice-faces',role:'img','aria-label':names,title:names},list.slice(0,3).map(x=>h(React.Fragment,{key:x.key},x.el)));
}
// One row of every voice list (已有声音, a service's voices): name · 语言 square (✦ `mark`), the 使用情景 or what the service says
// of it on a second line; then who speaks with it (`faces`) · ▶ · 使用 · ⋯ (`menu`; null keeps its column empty).
// The row in use shows ✓ in 使用's place, on the same (inert, still focusable) button: a pick never drops the focus.
function VoiceRow({name,lang,mark,meta,tags,current,faces,play,onUse,useLabel='使用',menu,warn,title}) {
  const line=[meta,tags].filter(Boolean).join(' · ');
  return h('li',{className:'ap-voice-row','data-current':current||undefined,title},
    h('div',{className:'ap-voice-row-main'},h('span',{className:'ap-voice-row-name'},h('span',{className:'ap-voice-row-label'},name),mark||null,lang&&h(VoiceLangChip,{tag:lang})),
      line&&h('span',{className:'ap-voice-row-meta'},line),warn),
    faces||null,
    play===undefined?null:play||h('span',{className:'ap-voice-row-pad','aria-hidden':true}),
    onUse&&h(Button,{className:'ap-chip-button ap-voice-use','aria-label':(current?'正在使用 ':useLabel+' ')+name,'aria-disabled':current||undefined,title:current?'使用中':undefined,onClick:current?undefined:onUse},
      current?h(Glyph,{name:'check'}):useLabel),
    menu===undefined?null:menu||h('span',{className:'ap-voice-row-pad','aria-hidden':true}));
}
// ---------- the 声音 property on the figure page ----------
// one inline row 「声音 大肥鱼（萌宝）›」 (InlineField link) that opens the
// voice page; no ▷ beside it (试听 lives on the voice page).
function FigureVoiceField({pack,figure,status,pillRef,onOpen}) {
  const spec=figureVoiceSpec(pack,figure),voice=figure.voice,muted=!!spec&&voice.source===null,source=spec&&!muted?spec.sources[voiceSourceId(spec,voice)]:null;
  const issue=source?status?.issues?.[0]:null,warn=issue&&voiceIssueText(issue.code,source),name=spec?spec.name:'选择声音';
  // a chosen source not set up yet is the voice page's amber radio here too (no ⚠, no
  // words); a real problem keeps ⚠. The reason is read out, the tooltip only names the control (R19).
  const unset=!!voiceSourceUnset(source);
  return h(InlineField,{kind:'link',label:'声音',className:'is-voice',controlRef:pillRef,controlClassName:'ap-voice-pill',value:spec?spec.name:'',placeholder:name,onOpen,
    ariaLabel:'声音：'+name+(muted?'，不配音':'')+(warn?'，'+warn+'，暂不配音':''),title:'声音设置',
    before:unset?h('span',{className:'ap-voice-pending','aria-hidden':true}):warn&&h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),after:muted&&h('span',{className:'ap-voice-pill-muted'},'不配音')});
}

// 舞台设置 › 配音 › 角色声音: one row per figure of the card — face · name · what it speaks with (来源 · 音色 · 配音语言, or
// 用通用声音 / 不配音) · ▶ · ›. The row opens that figure's 声音 page in the 素材库 (`onOpen(ref)`). `rows`: [{ref, pack, figure,
// face}] in the stage's cast order, or a row with no figure ({key, name, text, face, onOpen}: 通用声音 / 旁白 pointing at none or
// at one gone). `unvoiced`: what a figure without a voice speaks with. Why one cannot speak is the page's own ⚠ list above
// (StageVoiceProblems), not repeated here. 通用声音 · 旁白声音 · 角色声音 (`label`) all use it.
function figureVoiceSummary(pack,figure,unvoiced='用通用声音'){
  const spec=figureVoiceSpec(pack,figure),voice=figure.voice;
  if(!spec)return {quiet:true,text:unvoiced};
  const source=voice.source===null?null:spec.sources[voiceSourceId(spec,voice)];
  if(!source)return {quiet:true,text:'不配音'};
  const name=source.kind==='preset'?(source.voiceName?voiceDisplayName(source.voiceName):''):source.kind==='voice-id'?spec.name:'';
  return {source,text:[voiceSourceLabel(source),name,voiceLanguageName(primaryLanguage(effectiveVoiceLanguage(voice.language,spec.language)))].filter(Boolean).join(' · ')};
}
function CastVoiceList({binding,rows,label,unvoiced,onOpen}) {
  const preview=useVoicePreview(binding,null);
  if(!rows.length)return h(EmptyState,{compact:true,noun:'人物',icon:h(Glyph,{name:'figures'})});
  return h(React.Fragment,null,h('ul',{className:'ap-cast-voices','aria-label':label},rows.map(row=>{
    if(!row.figure)return h('li',{key:row.key,className:'ap-cast-voice'},
      h('button',{type:'button',className:'ap-cast-voice-main','aria-label':row.name+'：'+row.text,onClick:row.onOpen},
        row.face,h('span',{className:'ap-cast-voice-name'},row.name),h('span',{className:'ap-cast-voice-sum is-quiet'},row.text)),
      h('span',{className:'ap-cast-voice-go','aria-hidden':true,onClick:row.onOpen},h(Glyph,{name:'chevRight'})));
    const {ref,pack,figure,face}=row,id=ref.packId+'/'+ref.figureId,summary=figureVoiceSummary(pack,figure,unvoiced),key='cast:'+id,source=summary.source;
    const spec=source&&figureVoiceSpec(pack,figure),language=spec&&effectiveVoiceLanguage(figure.voice.language,spec.language);
    const play=()=>source.provider==='browser'?preview.playBrowser(key,{voice:source.voiceName,language,text:sampleText(language)}):
      preview.play(key,{packId:ref.packId,figureId:ref.figureId,expectedRevision:pack.revision},{label:figure.name});
    const open=()=>{preview.stop();onOpen(ref);};
    return h('li',{key:id,className:'ap-cast-voice'},
      h('button',{type:'button',className:'ap-cast-voice-main','aria-label':figure.name+'：'+summary.text,title:'声音设置',onClick:open},
        face,h('span',{className:'ap-cast-voice-name'},figure.name),
        h('span',{className:'ap-cast-voice-sum'+(summary.quiet?' is-quiet':'')},summary.text)),
      source&&!voiceSourceUnset(source)&&h(VoicePlay,{state:preview.of(key),label:'试听「'+figure.name+'」',disabled:!binding.tts,onClick:play}),
      h('span',{className:'ap-cast-voice-go','aria-hidden':true,onClick:open},h(Glyph,{name:'chevRight'})));})),
    preview.dialog);
}

// ---------- the 声音 tab ----------
// Top to bottom: the voice the figure speaks with (name edited in place; 服务 · 配音语言 · who else speaks with it; 配音
// on / off and ⋯), 试听; 「选声音」 — 已有声音 (every pack's voices and 我的模板) and one tab per service set up in 语音后端;
// then, for a voice, 「声音设置」 (使用情景, 来源, 服务, 模型, 参考音频) and 「调音」.
// 使用: a voice of this pack is pointed at (shared); another pack's voice or a template is copied into the pack first; a
// service's voice becomes a new voice of the pack, named after it.
function VoiceTab({binding,pack,figure,rows,status,preview,speech,commitVoice,nav}) {
  const packId=pack.manifest.id,voice=figure.voice||null,spec=figureVoiceSpec(pack,figure),sourceId=spec?voiceSourceId(spec,voice):null;
  const active=spec&&sourceId?spec.sources[sourceId]||null:null,language=effectiveVoiceLanguage(voice?.language,spec?.language);
  const readiness=useVoiceReadiness(binding),clips=useAudioPreview(binding,packId,speech);
  const [error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[shared,setShared]=React.useState(null),[removing,setRemoving]=React.useState(null);
  const askShared=others=>new Promise(resolve=>setShared({others,resolve}));
  const writer=useVoiceWriter({binding,pack,figure,commitVoice,setError,askShared});
  const player={...preview,play:(...args)=>{clips.stop();return preview.play(...args);},playSample:(...args)=>{clips.stop();return preview.playSample(...args);}};
  React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t);},[notice]);
  // Every pack's voices and 我的模板 (this pack's own are read from `pack`, always current).
  const catalogue=useVoiceLoad(()=>binding.service.listVoiceCatalogue(),[binding],{keep:true});
  const openSettings=nav?.openTab?(provider,options)=>openVoiceSettings(nav,provider,options):null;
  const candidate=voiceSpec=>({packId,figureId:figure.id,expectedRevision:pack.revision,voiceSpec});
  const used=(done,label)=>{if(done)setNotice('已换成「'+label+'」');return done;};
  const choose=async(made,label)=>{preview.stop();return used(await writer.createVoice(made),label);};
  const remove=voiceId=>{preview.stop();return commitVoice(c=>binding.service.deletePackVoice({packId,expectedRevision:c.revision,voiceId}));};
  const common={binding,pack,figure,spec,voice,sourceId,active,language,writer,preview:player,readiness,openSettings,candidate,choose,used,setNotice,setError,clips};
  return h('div',{className:'ap-voice-page',role:'region','aria-label':figure.name+'的声音'},
    error&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 ',error),
    // A candidate preview (a list's ▶) that failed says why here too; the saved voice's own failure sits under 试听.
    preview.state?.phase==='error'&&preview.state.key!=='saved:'+figure.id&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 试听失败：',preview.state.error),
    h(VoiceHero,{...common,rows,status,notice,onDelete:()=>setRemoving(voice.voice)}),
    h(StageSection,{title:'选声音',foldKey:'voice-pick',className:'ap-voice-pick-section'},h(VoiceChooser,{...common,catalogue,onDelete:setRemoving})),
    spec&&h(StageSection,{title:'声音设置',foldKey:'voice-settings',defaultFolded:true,className:'ap-voice-settings'},h(VoiceSettings,common)),
    spec&&h(StageSection,{title:'调音',help:VOICE_TUNING_HELP,meta:Object.keys(voicePresets(spec)).length,foldKey:'voice-tuning',defaultFolded:true,className:'ap-voice-tuning'},
      h(VoicePresets,{...common,rows})),
    removing&&h(VoiceDeleteDialog,{pack,voiceId:removing,onConfirm:()=>remove(removing),onClose:()=>setRemoving(null)}),
    shared&&h(VoiceSharedDialog,{figure,others:shared.others,onPick:pick=>{shared.resolve(pick);setShared(null);}}));
}
// ⋯ › 删除声音…: who speaks with it goes back to the 通用声音; what goes with it is said once.
function VoiceDeleteDialog({pack,voiceId,onConfirm,onClose}) {
  const spec=pack.manifest.voiceLibrary?.voices?.[voiceId];
  if(!spec)return null;
  const users=voiceUsers(pack,voiceId).map(f=>f.name),clips=Object.values(spec.sources).some(s=>s.kind==='reference-list'&&s.references.length);
  return h(ConfirmDialog,{title:'删除声音「'+spec.name+'」？',confirmLabel:'删除',danger:true,onConfirm,onClose,
    body:(users.length?'「'+users.join('、')+'」正在用它，删除后改用通用声音。':'没有人物在用它。')+(clips?'只有它用的参考音频会一起删除。':'')+'删除后不能恢复。'});
}
// The name of the service a source speaks through (its own name in 语音后端).
function voiceServiceName(catalog,source){
  if(source.provider==='browser')return '浏览器朗读';
  const services=catalogServices(catalog).filter(s=>s.kind===source.provider),s=services.find(x=>x.id===source.serviceId)||(services.length===1?services[0]:null);
  return s?.label||providerName(source.provider);
}
// The current voice — one focal point: disc · name (edited in place) · 服务 · 配音语言 · who else speaks with it; 配音 on / off
// and ⋯ on the right; then 试听, and ⚠ with what to do when it cannot speak. No voice: 「用通用声音」 in 中文 (a 配音语言 is
// part of a figure's voice, so there is none to choose without one).
function VoiceHero({binding,pack,figure,spec,voice,sourceId,status,preview,rows,writer,notice,setNotice,readiness,openSettings,language,onDelete}) {
  const [text,setText]=React.useState(null),[mood,setMood]=React.useState('calm');
  const pointers=useReadingPointers(binding),self={packId:pack.manifest.id,figureId:figure.id};
  const uses=READING_ROLES.filter(r=>samePointer(pointers.value?.[r.id]?.figure,self));
  const saving=writer.busy>0&&h('span',{className:'ap-voice-saving'},h(Spinner,{key:'saving',label:'正在保存'}));
  const noticeLine=notice&&h('p',{className:'ap-notice',role:'status'},notice);
  if(!spec)return h('div',{className:'ap-voice-hero is-empty'},h(VoiceDisc,{empty:true}),
    h('div',{className:'ap-voice-id'},h('div',{className:'ap-voice-name-row'},h('strong',{className:'ap-voice-name'},'用通用声音')),
      h('div',{className:'ap-voice-sub'},h('span',{className:'ap-voice-lang',title:VOICE_LANGUAGE_HELP},h(Glyph,{name:'globe'}),voiceLanguageName(primaryLanguage(language))))),
    h('span',{className:'ap-voice-hero-tools'},saving),noticeLine);
  // 通用声音 / 旁白 point at one figure each (tts.reading, set in 舞台设置 › 配音's ? and here): ✓ = this one; unticking = none.
  const roleItem=(role,close)=>{const on=uses.includes(role);return h('button',{key:role.id,type:'button',role:'menuitemcheckbox','aria-checked':on,className:'ap-menu-item',disabled:!pointers.value,
    onClick:()=>{close();pointers.point(role.id,on?null:self).then(()=>setNotice(on?role.label+'已改回浏览器默认声音':role.label+'现在用这个声音'),e=>setNotice('设置失败：'+voiceErrorText(e)));}},
    h('span',null,'用作'+role.label),on&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})));};
  // The machine-wide 「付费试听」 prompt (voicePaidAsk): ✓ while it asks; 「不再提示」 in that dialog clears it.
  const askItem=close=>{const on=voicePaidAsk.get();return h('button',{type:'button',role:'menuitemcheckbox','aria-checked':on,className:'ap-menu-item',onClick:()=>{close();voicePaidAsk.set(!on);}},
    h('span',null,'付费试听前确认'),on&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})));};
  const muted=sourceId===null,source=muted?null:spec.sources[sourceId],shown=source||spec.sources[spec.defaultSource],issue=source?status?.issues?.[0]:null;
  const key='saved:'+figure.id,state=preview.of(key),sample=sampleText(language),said=text??sample;
  const unset=voiceSourceUnset(source),ready=source&&!issue&&!unset?readiness(source.provider,source.serviceId):null;
  const speaks=!source||!!unset||voiceSpeaks(source,language);
  const warn=unset||(issue?voiceIssueText(issue.code,source):ready?.warn?ready.text:!speaks?'这个声音不支持'+voiceLanguageName(primaryLanguage(language)):'');
  // 去设置 for a service problem (the 配音 page of 语音后端).
  const serviceFix=issue?['SERVICE_REQUIRED','CREDENTIALS_REQUIRED'].includes(issue.code):ready?.setup;
  const goSet=()=>openSettings(source.provider,source.serviceId?{id:source.serviceId}:undefined);
  const action=serviceFix&&openSettings?h(Button,{className:'ap-link',onClick:goSet},issue?.code==='SERVICE_REQUIRED'||ready?.missing?VOICE_BACKEND_LINK:'去设置'):null;
  const play=()=>source?.provider==='browser'?preview.playBrowser(key,{voice:source.voiceName,language,text:text!==null&&text.trim()?text.trim():sample},{mood}):preview.play(key,{packId:pack.manifest.id,figureId:figure.id,expectedRevision:pack.revision,...(text!==null&&text.trim()&&text!==sample?{text:text.trim()}:{}),mood},{label:spec.name,mood});
  const others=voiceUsers(pack,voice.voice).filter(f=>f.id!==figure.id),auto=figure.extensions?.['dsh.automatic-write']?.fields?.includes('voice');
  const menu=h(Popover,{label:'声音操作',className:'ap-voice-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'声音操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
    h(MenuItem,{onClick:async()=>{close();if(await writer.saveTemplate())setNotice('已存为我的模板「'+spec.name+'」');}},'另存为我的模板'),
    binding.tts?.call&&READING_ROLES.map(role=>roleItem(role,close)),
    askItem(close),
    h('div',{className:'ap-menu-sep',role:'separator'}),
    h(MenuItem,{danger:true,onClick:()=>{close();onDelete();}},'删除声音…'))});
  // 配音 on / off: off keeps the voice and its settings (the binding's source null); on speaks with the voice's own source.
  const speak=h('button',{type:'button',className:'ap-icon-button ap-voice-speak','aria-pressed':!muted,'aria-label':'配音',title:'配音',
    onClick:()=>{preview.stop();writer.useSourceId(muted?spec.defaultSource:null);}},h(Glyph,{name:muted?'voiceOff':'voice'}));
  return h('div',{className:'ap-voice-hero','data-muted':muted||undefined},
    h(VoiceDisc,{playing:state?.phase==='playing',empty:muted||!!unset}),
    h('div',{className:'ap-voice-id'},
      h('div',{className:'ap-voice-name-row'},
        h(CommitInput,{key:voice.voice,className:'ap-voice-name-input','aria-label':'声音名称',value:spec.name,maxLength:60,validate:v=>v.trim()?'':'名称不能为空',
          onCommit:v=>{if(v.trim()!==spec.name)writer.editVoice(s=>({...s,name:v.trim()}));}}),
        auto&&h('span',{className:'ap-voice-auto',role:'img','aria-label':'自动素材分配',title:'自动素材分配'},h(Glyph,{name:'spark'}))),
      h('div',{className:'ap-voice-sub'},
        h('span',{className:'ap-voice-service'},voiceServiceName(readiness.services,shown)),
        h(VoiceLanguagePick,{value:language,defaultValue:effectiveVoiceLanguage('',spec.language),label:'配音语言',icon:'globe',title:VOICE_LANGUAGE_HELP,className:'ap-voice-lang-pick',
          onPick:l=>writer.patchBinding({language:l===effectiveVoiceLanguage('',spec.language)?undefined:l})}),
        h(VoiceFaces,{binding,pack,figures:others}),
        uses.length>0&&h('span',{className:'ap-voice-uses'},uses.map(r=>r.label).join('、')))),
    h('span',{className:'ap-voice-hero-tools'},saving,speak,menu),
    warn&&h('p',{className:'ap-voice-hero-warn'},h(VoiceWarn,{action},warn)),
    h(VoiceTry,{said,setText,state,binding,onPlay:play,disabled:!source||!!unset||(!!warn&&!issue?.field&&speaks)},h(VoiceMoodPick,{rows,value:mood,onPick:setMood})),
    state?.phase==='error'&&h('p',{className:'ap-voice-try-error',role:'alert'},h(VoiceWarn,{action:VOICE_SERVICE_CODES.has(state.code)&&openSettings&&source?h(Button,{className:'ap-link',onClick:goSet},'去设置'):
      h(Button,{className:'ap-link',onClick:play},'重试')},'试听失败：'+state.error)),
    noticeLine);
}
// The 试听 line: the line to say, `children` (the 差分 pick), and 试听 / 停止 (`disabled`: nothing to play; stopping never is).
function VoiceTry({said,setText,state,binding,onPlay,disabled,children}) {
  const on=!!state&&state.phase!=='error';
  return h('div',{className:'ap-voice-try',role:'group','aria-label':'试听'},
    h('input',{className:'ap-voice-try-text fork-edit','aria-label':'试听台词',value:said,maxLength:200,onChange:e=>setText(e.target.value)}),
    children||null,
    h('button',{type:'button',className:'ap-voice-go','aria-pressed':on,disabled:(disabled||!binding.tts)&&!on,title:!binding.tts?'配音插件未启用':undefined,onClick:onPlay},
      state?.phase==='loading'?h(Spinner,{key:'go'}):h(Glyph,{name:on?'stop':'play'}),on?'停止':'试听'));
}
// 通用声音 / 旁白: which figure each speaks with (tts.reading().general / .narrator .figure), read from the TTS plugin and
// re-read on its events; point(role, ref|null) writes one through setReading (the plugin checks it once there).
const READING_ROLES=[{id:'general',label:'通用声音'},{id:'narrator',label:'旁白声音'}];
const samePointer=(a,b)=>!!a&&!!b&&a.packId===b.packId&&a.figureId===b.figureId;
function useReadingPointers(binding){
  const tts=binding?.tts?.call?binding.tts:null,[tick,setTick]=React.useState(0);
  React.useEffect(()=>tts?.subscribe?.(()=>setTick(n=>n+1)),[tts]);
  const state=useVoiceLoad(()=>tts?tts.call('reading'):null,[tts,tick],{keep:true});
  const point=async(role,figure)=>{await tts.call('setReading',{[role]:{figure}});setTick(n=>n+1);};
  return {value:state.value||null,error:state.error,point};
}

// 「选声音」: one strip of tabs — 已有声音, then each service set up in 语音后端 (its order and name), 浏览器朗读 — and the
// 语音后端 gear at its right end; under it the tab's search and list. A service that cannot speak now carries ⚠ on its tab
// and says why (and 去设置) in the list's place. Fish's tab picks 声音库 or 参考音频克隆 (`modes`, also set by 已有声音's ＋).
function VoiceChooser(props) {
  const {readiness,language,openSettings,catalogue,pack}=props;
  const services=voiceSourceRows(readiness.services);
  const browserVoices=useVoiceLoad(()=>typeof window!=='undefined'&&window.speechSynthesis?browserSpeechVoiceList(window.speechSynthesis):null,[]).value;
  const states=Object.fromEntries(services.map(row=>[row.id,voiceRowState(row,language,browserVoices)]));
  const [tab,setTab]=React.useState('library'),[modes,setModes]=React.useState({});
  const present=['library',...services.map(r=>r.id)],current=present.includes(tab)?tab:'library',row=services.find(r=>r.id===current);
  const count=Object.keys(pack.manifest.voiceLibrary?.voices||{}).length+(catalogue.value?.voices||[]).filter(v=>v.ref.templateId||v.ref.packId!==pack.manifest.id).length;
  const names={library:'已有声音',...Object.fromEntries(services.map(r=>[r.id,r.title]))};
  const marks={library:h('span',{className:'ap-kind-count'},count),...Object.fromEntries(services.filter(r=>states[r.id]?.warn).map(r=>[r.id,h('span',{className:'ap-kind-warn',role:'img','aria-label':states[r.id].text},h(Glyph,{name:'warning'}))]))};
  const clone=services.find(r=>r.ways.some(w=>w.id==='clone'));
  const start=kind=>{if(kind==='clone'){setModes(m=>({...m,[clone.id]:'clone'}));setTab(clone.id);}else setTab(services[0].id);};
  const gear=openSettings&&h('span',{className:'ap-kind-new-anchor ap-voice-backend'},h(IconButton,{icon:'sliders',label:'语音后端',onClick:()=>openSettings(null)}));
  return h('div',{className:'ap-voice-chooser'},
    h(PackKindNav,{present,current,onSwitch:setTab,names,marks,label:'选声音',newMenu:gear}),
    current==='library'?h(VoiceLibraryList,{...props,onStart:start,canClone:!!clone}):
    h(VoiceServiceTab,{...props,key:row.id,row,state:states[row.id],mode:modes[row.id]||row.ways[0]?.id,setMode:id=>setModes(m=>({...m,[row.id]:id}))}));
}
// 已有声音: one search box (name, 使用情景, pack, who speaks with it), the dashed ＋ (克隆 / 从语音服务里挑), then the groups —
// this pack (first row 「用通用声音」), every other pack by name, 我的模板. Each group folds (remembered); this pack and
// the packs on for every card start open. A search shows every group with a match, open.
function VoiceLibraryList({binding,pack,figure,voice,writer,preview,candidate,used,setNotice,setError,catalogue,onDelete,onStart,canClone}) {
  const [query,setQuery]=React.useState(''),[renaming,setRenaming]=React.useState(null),[dropping,setDropping]=React.useState(null);
  const q=query.trim(),needle=voiceNeedle(q),clear=()=>setQuery('');
  const packId=pack.manifest.id,mine=voice?.voice||null,global=binding.globalEnabledPackIds||[];
  const entries=catalogue.value?.voices||[];
  const own=Object.entries(pack.manifest.voiceLibrary?.voices||{}).map(([id,spec])=>({id,spec,users:voiceUsers(pack,id)}));
  const byPack=new Map();
  for(const v of entries)if(v.ref.packId&&v.ref.packId!==packId){if(!byPack.has(v.ref.packId))byPack.set(v.ref.packId,{id:v.ref.packId,name:v.packName||'',items:[]});byPack.get(v.ref.packId).items.push(v);}
  const others=[...byPack.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh'));
  const templates=entries.filter(v=>v.ref.templateId);
  const hit=(group,name,spec,users)=>voiceMatches(needle,[name,spec?.guidance,group,...users.map(u=>u.name)]);
  const playFor=(spec,key,request)=>{
    const src=spec.sources?.[spec.defaultSource];
    if(!src||voiceSourceUnset(src)||!request)return null;
    const label='试听「'+spec.name+'」';
    if(src.provider==='browser')return h(VoicePlay,{state:preview.of(key),label,onClick:()=>preview.playBrowser(key,{voice:src.voiceName,language:spec.language,text:sampleText(spec.language)})});
    return h(VoicePlay,{state:preview.of(key),label,disabled:!binding.tts,onClick:()=>preview.play(key,request,{label:spec.name})});
  };
  const stop=()=>preview.stop();
  const ownRow=({id,spec,users})=>{
    const menu=h(Popover,{label:'声音操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'声音操作 '+spec.name,'aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
      h(MenuItem,{onClick:()=>{close();setRenaming(id);}},'重命名'),
      h(MenuItem,{onClick:async()=>{close();if(await writer.saveTemplate(id)){setNotice('已存为我的模板「'+spec.name+'」');catalogue.reload();}}},'另存为我的模板'),
      h('div',{className:'ap-menu-sep',role:'separator'}),
      h(MenuItem,{danger:true,onClick:()=>{close();onDelete(id);}},'删除声音…'))});
    const name=renaming===id?h(CommitInput,{className:'ap-voice-row-input','aria-label':'声音名称',autoFocus:true,value:spec.name,maxLength:60,validate:v=>v.trim()?'':'名称不能为空',
      onCommit:v=>{setRenaming(null);if(v.trim()!==spec.name)writer.renameVoice(id,v.trim());},onBlur:()=>setRenaming(null)}):spec.name;
    return h(VoiceRow,{key:'p:'+id,name,lang:spec.language,meta:spec.guidance||'',current:id===mine,faces:h(VoiceFaces,{binding,pack,figures:users}),
      play:playFor(spec,'lib:'+packId+':'+id,candidate(spec)),
      onUse:async()=>{stop();used(await writer.setBinding({voice:id,...(voice?.language?{language:voice.language}:{})}),spec.name);},menu});
  };
  const otherRow=v=>h(VoiceRow,{key:v.ref.packId+'/'+v.ref.voiceId,name:v.name,lang:v.voiceSpec.language,meta:v.voiceSpec.guidance||'',faces:h(VoiceFaces,{users:v.users}),
    play:playFor(v.voiceSpec,'lib:'+v.ref.packId+':'+v.ref.voiceId,v.previewFigureId&&{packId:v.ref.packId,figureId:v.previewFigureId,expectedRevision:v.revision,voiceSpec:v.voiceSpec}),
    onUse:async()=>{stop();used(await writer.copyPackVoice(v.ref),v.name);},menu:null});
  // A template's clips are not in any pack until it is copied in: only one without clips can be heard first.
  const templateRow=t=>h(VoiceRow,{key:'t:'+t.ref.templateId,name:t.name,lang:t.voiceSpec?.language,meta:t.voiceSpec?.guidance||'',
    play:Object.values(t.voiceSpec?.sources||{}).some(s=>s.kind==='reference-list')?null:playFor(t.voiceSpec,'tpl:'+t.ref.templateId,candidate(t.voiceSpec)),
    onUse:async()=>{stop();used(await writer.assignTemplate({templateId:t.ref.templateId,revision:t.revision}),t.name);},
    menu:h(Popover,{label:'模板操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'模板操作 '+t.name,'aria-expanded':open,onClick:toggle}),content:close=>h(MenuItem,{danger:true,onClick:()=>{close();setDropping(t);}},'删除模板…')})});
  const general=!q&&h(VoiceRow,{key:'general',name:'用通用声音',current:!mine,play:null,onUse:async()=>{stop();used(await writer.setBinding(null),'通用声音');},menu:null});
  const groups=[
    {id:'pack:'+packId,name:'本包',open:true,rows:own.filter(v=>hit(pack.manifest.name,v.spec.name,v.spec,v.users)).map(ownRow),lead:general},
    ...others.map(g=>({id:'pack:'+g.id,name:g.name,open:global.includes(g.id),rows:g.items.filter(v=>hit(g.name,v.name,v.voiceSpec,v.users||[])).map(otherRow)})),
    {id:'templates',name:'我的模板',open:false,rows:templates.filter(t=>hit('我的模板',t.name,t.voiceSpec,[])).map(templateRow)}];
  const shown=groups.filter(g=>g.rows.length||g.lead&&!q);
  const add=h(Popover,{label:'新建声音',className:'ap-voice-add',trigger:({toggle})=>h(CatAddTile,{label:'新建声音',onClick:toggle}),content:close=>h(React.Fragment,null,
    canClone&&h(MenuItem,{onClick:()=>{close();onStart('clone');}},'上传参考音频，克隆一个声音'),
    h(MenuItem,{onClick:()=>{close();onStart('service');}},'从语音服务里挑音色'))});
  return h('div',{className:'ap-voice-library ap-voice-existing'},
    h('div',{className:'ap-voice-search',role:'search'},h(SearchBox,{bare:true,label:'搜索声音',value:query,placeholder:'搜名字、使用情景、素材包或人物',spellCheck:false,onChange:setQuery,onKeyDown:voiceSearchKeys(query,clear)})),
    !q&&add,
    shown.map(g=>h(VoiceGroup,{key:g.id,id:g.id,name:g.name,count:g.rows.length,defaultOpen:g.open,forced:!!q,lead:g.lead,rows:g.rows,paging:g.id+':'+needle})),
    catalogue.error&&!catalogue.value?h(VoiceLoadError,{error:catalogue.error,retry:catalogue.reload}):!catalogue.value&&h(VoiceLoading,{count:3}),
    q&&!shown.length&&catalogue.value&&h(EmptyState,{compact:true,noun:'声音',query:q,plain:true,onClear:clear}),
    dropping&&h(ConfirmDialog,{title:'删除模板「'+dropping.name+'」？',body:'只删除这台电脑上的模板；已经用过它的素材包不受影响。',confirmLabel:'删除',danger:true,
      onConfirm:async()=>{try{await binding.service.deleteVoiceTemplate({templateId:dropping.ref.templateId,expectedRevision:dropping.revision});catalogue.reload();}catch(e){setError(voiceErrorText(e));}},onClose:()=>setDropping(null)}));
}
// One group of 已有声音: its heading folds it (remembered per group); a long group shows 5 rows and 「显示更多」.
function VoiceGroup({id,name,count,defaultOpen,forced,lead,rows,paging:pageKey}) {
  const [folded,setFolded]=useStageFold('voice-group:'+id,!defaultOpen),paging=useVoicePaging(pageKey),open=forced||!folded;
  return h('div',{className:'ap-voice-group-block'},
    h('button',{type:'button',className:'ap-voice-group','aria-expanded':open,onClick:()=>setFolded(!folded)},h(Glyph,{name:'chevDown'}),h('span',{className:'ap-voice-group-name'},name),h('span',{className:'ap-voice-group-count'},count)),
    open&&h('ul',{className:'ap-voice-rows','aria-label':name},lead||null,rows.slice(0,paging.n)),
    open&&rows.length>paging.n&&h(VoiceMore,{onClick:paging.more}));
}
// A service's tab: what it cannot do now (⚠ · why · 去设置), else its voices. Fish: 声音库 or 参考音频克隆 (a new voice from
// clips); the others: 模型 and their voices (VoiceProviderVoices).
function VoiceServiceTab(props) {
  const {row,state,openSettings,mode,setMode}=props;
  if(state?.warn){
    const go=state.setup&&openSettings&&h(Button,{className:'ap-link',onClick:()=>openSettings(row.provider,row.bind||row.custom?{id:row.serviceId}:undefined)},'去设置');
    return h('p',{className:'ap-voice-line-warn'},h(VoiceWarn,{action:go},state.text));
  }
  if(row.kind!=='fish-audio')return h(VoiceProviderVoices,props);
  return h('div',{className:'ap-voice-fish-tab'},
    row.ways.length>1&&h(Segmented,{label:'生成方式',value:mode,options:row.ways.map(w=>[w.id,w.name]),onChange:setMode}),
    mode==='clone'?h(VoiceCloneNew,props):h(VoiceFishTab,props));
}
// Fish 声音库: the popular voices in the figure's 配音语言 (zh / ja; other languages read both), with the voice in use kept in
// the list; shown at once, re-read while it says `refreshing`.
function VoiceFishTab({binding,figure,spec,active,row,language,preview,candidate,choose}) {
  const fishId=active&&rowHolds(row,active)&&active.kind==='voice-id'?active.voiceId||null:null;
  const speakLang=primaryLanguage(language),catalogLang=['zh','ja'].includes(speakLang)?speakLang:undefined;
  const recommended=useVoiceLoad(()=>binding.tts?.call?voiceTts(binding).call('listRecommendedFishVoices',{...(catalogLang?{language:catalogLang}:{}),serviceId:row.serviceId,...(fishId?{selectedVoiceId:fishId}:{})}):null,
    [binding,row.serviceId,catalogLang,fishId],{keep:true});
  return h(VoiceFishLibrary,{binding,figure,spec,way:row,preview,candidate,choose,state:recommended,currentId:fishId,language});
}
// 参考音频克隆: a dashed ＋ takes WAV / MP3 clips of one person speaking; they become a new voice the figure speaks with.
function VoiceCloneNew({row,writer,language,used,figure}) {
  const busy=writer.busy>0;
  return h('div',{className:'ap-voice-clone'},
    h('label',{className:'ap-clip-add','data-needed':true,'data-disabled':busy||undefined,title:'上传参考音频'},h(Glyph,{name:'plus'}),
      h('input',{type:'file',multiple:true,accept:VOICE_CLIP_ACCEPT,'aria-label':'上传参考音频',disabled:busy,
        onChange:async e=>{const files=[...(e.target.files||[])];e.target.value='';if(files.length)used(await writer.cloneVoice(files,{language,row}),figure.name+'的声音');}})));
}
// 声音设置 of the figure's voice: 使用情景 (what the casting assistant reads), 来源 (a pick when the voice keeps several),
// 服务 (one of several of its kind), 模型, and a clone's 参考音频.
function VoiceSettings({binding,pack,figure,spec,voice,sourceId,writer,preview,readiness,clips,language}) {
  const sid=sourceId??spec.defaultSource,source=spec.sources[sid],sources=Object.entries(spec.sources);
  const services=catalogServices(readiness.services).filter(s=>s.kind===source.provider);
  const service=services.find(s=>s.id===source.serviceId)||(services.length===1?services[0]:null),models=service?.models||[];
  const modelStatus=useVoiceModelStatus(binding,source,preview.state?.phase);
  const label=s=>voiceSourceLabel(s)+(s.kind==='preset'&&s.voiceName?' · '+voiceDisplayName(s.voiceName):'');
  const autoCast=voiceAutoCast(spec);
  return h(React.Fragment,null,
    h(InlineGrid,{label:'声音设置',columns:1,className:'ap-voice-props'},
      // 是否通用 (spec.autoCast, voiceAutoCast): whether the 自动素材 assistant may pick this voice; 使用情景 is written only
      // while it is on, and turning it off keeps the text (greyed).
      h(InlineRow,{label:'是否通用',help:h(Help,{text:VOICE_AUTO_CAST_HELP,label:'是否通用 说明'})},
        h('span',{className:'ap-voice-auto-cast'},h(Switch,{bare:true,label:'是否通用',checked:autoCast,onChange:on=>writer.editVoice(s=>({...s,autoCast:on}))}))),
      // 使用情景 (spec.guidance, ≤ 60 字): the line the casting assistant reads when it picks a voice for a figure.
      h(InlineField,{kind:'text',multiline:true,disabled:!autoCast,label:'使用情景',controlLabel:'声音使用情景',className:'is-usage',maxLength:VOICE_GUIDANCE_MAX,
        help:h(Help,{text:VOICE_GUIDANCE_HELP,label:'声音使用情景 说明'}),placeholder:'例：适合中年男性',value:spec.guidance||'',
        validate:v=>[...v.trim()].length<=VOICE_GUIDANCE_MAX?'':'使用情景最多 '+VOICE_GUIDANCE_MAX+' 字',
        onCommit:v=>writer.editVoice(({guidance,...rest})=>v.trim()?{...rest,guidance:v.trim()}:rest)}),
      h(InlineRow,{label:'来源'},sources.length>1?h(VoiceFilterPick,{label:'来源',value:sid,options:sources.map(([id,s])=>({id,label:label(s)})),onPick:id=>{preview.stop();writer.useSourceId(id);}}):
        h('span',{className:'ap-voice-value'},label(source))),
      services.length>1&&h(InlineRow,{label:'服务'},h(VoiceFilterPick,{label:'服务',value:source.serviceId||'',placeholder:'选择服务',options:services.map(s=>({id:s.id,label:s.label||providerName(s.kind)})),
        onPick:id=>writer.useSourceService(sid,id,services.find(s=>s.id===id)?.models||[])})),
      models.length>0&&h(InlineRow,{label:'模型'},h(VoiceOptionPick,{label:'模型',value:source.model||models[0].id,options:models.map(m=>({id:m.id,label:m.label||m.id})),onPick:id=>writer.setSourceModel(sid,id)}),
        h(VoiceConfirmedWarning,{issues:modelStatus.value?.issues,field:'model'}))),
    source.kind==='reference-list'&&h('div',{className:'ap-voice-refs-block'},h('h5',{className:'ap-voice-subhead-title'},'参考音频'),
      h(VoiceReferences,{binding,pack,figure,spec,voice,writer,preview,clips,entry:[sid,source]})));
}
// (1) Fish Audio · 声音库 — name · gender / languages · heat · tone tags · ▶ · 使用, one row each like every other voice list of
// the page.
// Heat as a short count (1.2万); an unknown count is not shown (never 0).
const voiceCount=n=>!Number.isFinite(n)||n<0?'':n>=10000?(Math.round(n/1000)/10).toString().replace(/\.0$/,'')+'万':String(Math.round(n));
// a long voice list shows 5 rows; 「显示更多」 adds 5. `key`
// names the list on show (a new search or filter starts again at 5).
const VOICE_PAGE=5;
function useVoicePaging(key){
  const [state,setState]=React.useState({key,n:VOICE_PAGE});
  if(state.key!==key)setState({key,n:VOICE_PAGE});
  const n=state.key===key?state.n:VOICE_PAGE;
  return {n,more:()=>setState({key,n:n+VOICE_PAGE})};
}
function VoiceMore({onClick,busy}) {
  return h(Button,{className:'ap-link ap-voice-more',disabled:busy,onClick},busy&&h(Spinner,{key:'more'}),'显示更多');
}
// A search box's text matched against a row's words, in the catalogue's normal form (case, width, 繁/简).
const voiceNeedle=q=>figureResolution.normalizeCatalogueText(q);
const voiceMatches=(needle,words)=>!needle||words.some(w=>w&&figureResolution.normalizeCatalogueText(w).includes(needle));
// Esc in a search box with text clears it first (the voice page's Esc goes back only from an empty box).
const voiceSearchKeys=(query,clear,onEnter)=>e=>{
  if(e.key==='Escape'&&query){e.preventDefault();e.stopPropagation();clear();}
  else if(e.key==='Enter'&&onEnter){e.preventDefault();onEnter();}
};
// the search box sits on top of the one list. Typing filters the
// popular voices (name / tone tags / language / gender) at once; Enter or 「搜索」 asks Fish by name (its later pages load as
// 「显示更多」 runs out); a pasted voice ID is looked up instead (private / unlisted IDs can still be used). Popular rows play the
// voice's official sample (never a synthesis); search rows preview through the billing-aware synthesis. Nothing autoplays.
// Every Fish call and every pick of a row goes to that row's own service (`way.serviceId`).
function VoiceFishLibrary({binding,figure,spec:boundSpec,way,preview,candidate,choose,state,currentId,language}) {
  const [query,setQuery]=React.useState(''),[result,setResult]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),asked=React.useRef(0);
  // Fish's search answers in one language (it assumes Japanese when none is named): the figure's 配音语言.
  const speakLang=primaryLanguage(language);
  const fish=way.serviceId,q=query.trim(),idLike=/^[A-Za-z0-9_-]{24,160}$/.test(q)&&!/\s/.test(q),needle=voiceNeedle(q);
  const answer=result&&result.query===q?result:null;
  const paging=useVoicePaging(answer?'fish:'+answer.ask:'popular:'+needle);
  const clear=()=>{setQuery('');setError('');};
  async function find(page=1){
    if(!q||busy)return;setBusy(true);setError('');
    const ask=page===1?++asked.current:asked.current;
    try{
      if(idLike){
        if(!fish){setResult({kind:'id',query:q,ask,voice:null,unchecked:true});return;}
        try{setResult({kind:'id',query:q,ask,voice:await voiceTts(binding).call('validateFishVoice',{serviceId:fish,voiceId:q})});}
        catch(e){if(voiceCode(e)!=='VOICE_NOT_FOUND')throw e;setResult({kind:'id',query:q,ask,voice:null,missing:true});}
      }else{
        if(!fish)throw voiceFailure('SERVICE_REQUIRED');
        const r=await voiceTts(binding).call('searchFishVoices',{serviceId:fish,query:q,language:speakLang,page});
        setResult(prev=>({kind:'search',query:q,ask,page:r.page,hasMore:!!r.hasMore,windowLimited:!!r.windowLimited,voices:page>1&&prev?.kind==='search'?[...prev.voices,...(r.voices||[])]:r.voices||[]}));
      }
    }catch(e){setError(voiceCode(e)==='SERVICE_REQUIRED'?'还没有配置 Fish Audio 服务，不能搜索':voiceErrorText(e));}finally{setBusy(false);}
  }
  const meta=v=>[v.mine?'我的音色':'',VOICE_GENDERS[v.gender],(v.languages||[]).map(voiceLanguageName).join(' / ')].filter(Boolean).join(' · ');
  // ▶ plays the voice model's own official sample (Fish samples[].audio →
  // sampleUrl) — free, no synthesis, no billing question; only a voice without one is synthesised (the paid-preview gate).
  const play=(v,key,spec,name)=>h(VoicePlay,{state:preview.of(key),label:'试听「'+name+'」',
    onClick:()=>v.sampleUrl&&fish?preview.playSample(key,{serviceId:fish,voiceId:v.voiceId},{request:candidate(spec),label:name}):preview.play(key,candidate(spec),{label:name})});
  const popularRow=v=>{
    const key='fish:'+v.voiceId,name=v.name&&v.name!==v.voiceId?v.name:v.voiceId===currentId?boundSpec.name:'Fish 声音',spec=fishVoiceSpec({...v,name},name,way);
    const heat=[voiceCount(v.likeCount)&&voiceCount(v.likeCount)+' 赞',voiceCount(v.taskCount)&&voiceCount(v.taskCount)+' 次使用'].filter(Boolean).join(' · ');
    return h(VoiceRow,{key:v.voiceId,name,meta:meta(v),tags:[heat,(v.toneTags||[]).slice(0,4).join(' · ')].filter(Boolean).join(' · '),
      current:v.voiceId===currentId,title:v.licenseNote||undefined,
      play:play(v,key,spec,name),onUse:()=>choose(spec,name)});
  };
  const foundRow=(v,i)=>{const id=v.voiceId,key='fish:'+id,spec=fishVoiceSpec(v,figure.name+'的声音',way),name=v.name||'Fish 声音';
    return h(VoiceRow,{key:id+':'+i,name,meta:meta(v),tags:(v.toneTags||[]).slice(0,3).join(' · '),current:id===currentId,title:v.licenseNote||undefined,
      play:play(v,key,spec,name),onUse:()=>choose(spec,spec.name)});};
  // The list under the box: Fish's answer for these words, else the popular voices this text matches.
  let list=null;
  if(answer?.kind==='id')list=answer.missing?h('p',{className:'ap-voice-line-warn',role:'alert'},h(VoiceWarn,null,'没有找到这个编号，请检查是否复制完整')):
    h('ul',{className:'ap-voice-rows','aria-label':'编号查找结果'},answer.voice?foundRow(answer.voice,0):
      h(VoiceRow,{name:'Fish 声音',meta:'还没有配置 Fish Audio 服务，暂时不能核对这个编号',onUse:()=>choose(fishVoiceSpec({voiceId:answer.query,name:'',languages:[]},figure.name+'的声音',way),figure.name+'的声音')}));
  else if(answer?.kind==='search'){
    const voices=answer.voices,more=voices.length>paging.n||answer.hasMore;
    list=voices.length?h(React.Fragment,null,h('ul',{className:'ap-voice-rows','aria-label':'搜索结果'},voices.slice(0,paging.n).map(foundRow)),
        more?h(VoiceMore,{busy,onClick:()=>{if(paging.n+VOICE_PAGE>voices.length&&answer.hasMore)find(answer.page+1);paging.more();}}):answer.windowLimited&&h('p',{className:'ap-voice-empty'},'只能看到前面的结果，换个关键词试试')):
      h(EmptyState,{noun:'声音',query:q,plain:true,onClear:clear});
  }else if(state.error&&!state.value)list=h(VoiceLoadError,{error:state.error,retry:state.reload});
  else if(!state.value)list=h(VoiceLoading);
  else{
    const all=state.value.voices||[],shown=idLike?all.filter(v=>v.voiceId===q):all.filter(v=>voiceMatches(needle,[v.name,...(v.toneTags||[]),...(v.languages||[]),...(v.languages||[]).map(voiceLanguageName),VOICE_GENDERS[v.gender]]));
    list=shown.length?h(React.Fragment,null,h('ul',{className:'ap-voice-rows','aria-label':'推荐声音'},shown.slice(0,paging.n).map(popularRow)),shown.length>paging.n&&h(VoiceMore,{onClick:paging.more})):
      idLike?null:q?h(EmptyState,{compact:true,noun:'声音',query:q,plain:true,onClear:clear}):h(EmptyState,{compact:true,noun:'推荐声音'});
  }
  return h(VoiceLibraryBox,{label:'搜索 Fish 声音',placeholder:'在'+voiceLanguageName(speakLang)+'声音里搜名字或标签，或粘贴声音编号',query,onQuery:v=>{setQuery(v);setError('');},clear,
    onFind:()=>find(),findLabel:idLike?'查找编号':'搜索',canFind:!!q,busy,error},list);
}
// The 声音库 box every voice library shares (Fish 声音库, MiniMax 音色): one search box on top of one list of VoiceRow —
// typing filters at once; Enter or the button asks the service (`onFind`: a Fish search; a list read whole has none). `help` is a (?) after it.
function VoiceLibraryBox({label,placeholder,query,onQuery,clear,onFind,findLabel,canFind,busy,error,help,children}) {
  return h('div',{className:'ap-voice-fish ap-voice-library'},
    h('div',{className:'ap-voice-search',role:'search'},
      h(SearchBox,{bare:true,label,value:query,placeholder,spellCheck:false,onChange:onQuery,onKeyDown:voiceSearchKeys(query,clear,canFind?onFind:null)}),
      onFind&&h(Button,{className:'ap-chip-button ap-voice-find',disabled:!canFind||busy,onClick:onFind},busy?h(Spinner,{key:'find'}):h(Glyph,{name:'search'}),findLabel),
      help||null),
    error&&h(VoiceLoadError,{error}),
    children);
}
// A service's voices as one list (owner 11-15: the same rows as 已有声音): the one in use first, then the account's own (我的
// 音色), then the rest by name — only those in the figure's 配音语言 until 「显示所有语言」 at the list's foot. Typing filters by
// name, language, description or ID. MiniMax (`typedId`): a pasted ID that no listed voice matches is offered as its own
// row (使用这个编号) — a voice made minutes ago is not listed until its first synthesis; MiniMax has no official samples, so
// ▶ synthesises one short line (the billed preview, said in its (?)).
const MINIMAX_VOICE_ID=/^[\x21-\x7e](?:[\x20-\x7e]{0,158}[\x21-\x7e])?$/;
function VoiceServiceVoices({name,voices,current,lang,speaks,play,onUse,meta,typedId,help}) {
  const [query,setQuery]=React.useState(''),[every,setEvery]=React.useState(false);
  const q=query.trim(),needle=voiceNeedle(q),clear=()=>setQuery('');
  const words=v=>[v.label,v.id,v.description,v.mine?'我的音色':'',...(v.styles||[]),...(v.languages||[]),...(v.languages||[]).map(voiceLanguageName)];
  const byName=list=>[...list].sort((a,b)=>(a.label||a.id).localeCompare(b.label||b.id,'zh'));
  const inLanguage=voices.filter(speaks),all=every||!inLanguage.length;
  const matched=voices.filter(v=>v.id!==current&&(all||speaks(v))&&voiceMatches(needle,words(v)));
  const rows=[...voices.filter(v=>v.id===current&&voiceMatches(needle,words(v))),...byName(matched.filter(v=>v.mine)),...byName(matched.filter(v=>!v.mine))];
  const typed=typedId&&q&&!rows.length&&typedId.test(q)?{id:q,label:q,languages:[],mine:true}:null;
  const paging=useVoicePaging(name+':'+needle+':'+all);
  const row=v=>h(VoiceRow,{key:v.id,name:v.label||v.id,lang:(v.languages||[])[0],meta:meta(v),current:v.id===current,title:v.description||undefined,
    warn:v.id===current&&!speaks(v)?h(VoiceWarn,null,'这个音色不支持'+voiceLanguageName(lang)):null,play:play(v),onUse:()=>onUse(v)});
  const foot=voices.length>inLanguage.length&&inLanguage.length>0&&h(Button,{className:'ap-link ap-voice-more','aria-pressed':every,onClick:()=>setEvery(!every)},every?'只看'+voiceLanguageName(lang):'显示所有语言');
  return h(VoiceLibraryBox,{label:'搜索'+name+'的音色',placeholder:'在'+(all?'':voiceLanguageName(lang))+'音色里搜名字或标签'+(typedId?'，或粘贴音色 ID':''),query,onQuery:setQuery,clear,help},
    typed?h('ul',{className:'ap-voice-rows','aria-label':name+'的音色'},h(VoiceRow,{name:q,meta:'列表里没有这个编号：刚做好、还没用过的音色也是这样',useLabel:'使用这个编号',onUse:()=>onUse(typed)})):
    rows.length?h(React.Fragment,null,h('ul',{className:'ap-voice-rows','aria-label':name+'的音色'},rows.slice(0,paging.n).map(row)),rows.length>paging.n&&h(VoiceMore,{onClick:paging.more})):
      q?h(EmptyState,{compact:true,noun:'音色',query:q,plain:true,onClear:clear}):h(EmptyState,{compact:true,text:'这个服务没有可用的音色',icon:h(Glyph,{name:'voice'})}),
    foot||null);
}
// A filterable pick (owner 11-08: 配音语言, 模型 and 来源 are type-to-filter dropdowns): the trigger reads the value (`icon`
// before it); the menu opens with its search box focused (Popover), the options below it. `options` [{id,label,meta,words,extra}]
// — `words` are what typing also matches (English name, code), `extra` an element at the option's end (▶). `limit` shows that
// many until 显示全部; `foot` sits under the list. `free` (text → id or '') offers what was typed as its own option.
// `title`: the trigger's tooltip (配音语言: what the choice does).
function VoiceFilterPick({label,value,valueText,placeholder,options,onPick,className='',limit=60,foot,free,filterLabel,searchAt=8,icon,title}) {
  const [query,setQuery]=React.useState(''),[all,setAll]=React.useState(false);
  const needle=query.trim().toLowerCase(),shown=options.filter(o=>!needle||[o.label,o.id,o.meta,...(o.words||[])].some(x=>String(x||'').toLowerCase().includes(needle)));
  const typed=free&&needle?free(query.trim()):'',offer=typed&&!options.some(o=>o.id===typed);
  const item=(o,close)=>h('div',{key:o.id||'default',className:'ap-voice-pick-option'},
    h('button',{type:'button',role:'menuitemradio','aria-checked':value===o.id,className:'ap-menu-item',onClick:()=>{close();setQuery('');if(value!==o.id)onPick(o.id);}},
      h('span',null,o.label),o.meta&&h('span',{className:'ap-voice-pick-meta'},o.meta),value===o.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))),
    o.extra||null);
  const current=valueText??options.find(o=>o.id===value)?.label;
  return h(Popover,{label,float:true,fit:true,limit:420,className:'ap-voice-pick-anchor'+(className?' '+className:''),
    trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-pick','aria-label':label+'：'+(current||placeholder||''),'aria-expanded':open,title,onClick:()=>{setQuery('');setAll(false);toggle();}},
      icon&&h(Glyph,{name:icon}),h('span',{className:current?undefined:'ap-voice-pick-placeholder'},current||placeholder||''),h(Glyph,{name:'chevDown'})),
    content:close=>h(React.Fragment,null,
      (options.length>searchAt||free)&&h('div',{className:'ap-voice-pick-search'},h(SearchBox,{bare:true,label:filterLabel||'筛选'+label,value:query,placeholder:'输入以筛选',spellCheck:false,onChange:v=>{setQuery(v);setAll(false);},
        onKeyDown:e=>{if(e.key==='Enter'){const first=offer?{id:typed}:shown[0];if(first){e.preventDefault();close();setQuery('');if(first.id!==value)onPick(first.id);}}}})),
      offer&&h('button',{type:'button',role:'menuitem',className:'ap-menu-item',onClick:()=>{close();setQuery('');onPick(typed);}},'使用「'+typed+'」'),
      !shown.length&&!offer&&h(EmptyState,{compact:true,plain:true,noun:label,query}),
      (all?shown:shown.slice(0,limit)).map(o=>item(o,close)),
      !all&&shown.length>limit&&h(Button,{className:'ap-link ap-voice-more',onClick:()=>setAll(true)},'显示全部 '+shown.length+' 个'),
      foot||null)});
}
// 配音语言 and a clip's language: the common languages by their Chinese name, also found by English name or code; any other
// language tag can be typed and used as it is.
const VOICE_LANGUAGE_CHOICES=[['ja','日语','Japanese'],['zh','中文','Chinese Mandarin'],['en','英语','English'],['ko','韩语','Korean'],['yue','粤语','Cantonese'],
  ['fr','法语','French'],['de','德语','German'],['es','西班牙语','Spanish'],['it','意大利语','Italian'],['pt','葡萄牙语','Portuguese'],['ru','俄语','Russian'],
  ['ar','阿拉伯语','Arabic'],['nl','荷兰语','Dutch'],['pl','波兰语','Polish'],['th','泰语','Thai'],['vi','越南语','Vietnamese'],['id','印尼语','Indonesian']];
function VoiceLanguagePick({value,label,onPick,className='',defaultValue,icon,title}) {
  const options=VOICE_LANGUAGE_CHOICES.map(([id,name,en])=>({id,label:name,meta:defaultValue===id?'声音默认':'',words:[en]}));
  return h(VoiceFilterPick,{label,value,valueText:voiceLanguageName(value),options,onPick,icon,title,className:'ap-voice-lang-anchor'+(className?' '+className:''),
    free:v=>VOICE_LANGUAGE_TAG.test(v)?v:''});
}
// A provider's own list (模型 of a Fish or online service).
function VoiceOptionPick({label,value,options,onPick}) {
  return h(VoiceFilterPick,{label,value,options,onPick,className:'ap-voice-model-anchor'});
}
// An online service or 浏览器朗读 (a 选声音 tab): 模型 (where the service has a choice; it is the model of the voice picked here)
// and the service's voices, each with ▶ and 使用 — a new voice of the pack named after it. The voices are read when the tab
// opens. A custom service without a voice list takes 模型 and 音色 by name.
function VoiceProviderVoices({binding,figure,writer,preview,candidate,choose,active,row,openSettings,language}) {
  const provider=row.kind,name=row.name,custom=!!row.custom,serviceId=row.serviceId,browser=provider==='browser';
  const own=active&&rowHolds(row,active)?active:null;
  const [model,setModel]=React.useState(own?.model||''),[typed,setTyped]=React.useState('');
  const modelStatus=useVoiceModelStatus(binding,{provider,model,voiceName:own?.voiceName||''},preview.state?.phase);
  // How the voices are listed is the catalog's (voiceList).
  const list=useVoiceLoad(()=>browser?browserSpeechVoiceList(window.speechSynthesis).then(voices=>({voices})):row.service.voiceList==='provider'?voiceTts(binding).call('providerVoices',{serviceId}):voiceTts(binding).call('listOnlinePresetVoices',{provider,...(serviceId?{serviceId}:{})}),[binding,provider,serviceId]);
  const failed=list.value?.status==='error',voices=failed?[]:list.value?.voices||[],models=(failed?[]:list.value?.models||[]).map(m=>typeof m==='string'?{id:m,label:m}:{id:m.id,label:m.label||m.id});
  // A custom service needs a 模型 (OpenAI speech `model`): the listed first one unless another is picked or typed.
  const useModel=model||(custom?models[0]?.id||'':'');
  const lang=primaryLanguage(language),speaks=v=>!(v.languages||[]).length||v.languages.some(l=>primaryLanguage(l)===lang);
  const sid=custom?'custom':provider;
  const spec1=v=>({name:v.label||v.id,language:pickVoiceLanguage(browser?(v.languages||[]).map(primaryLanguage):v.languages),defaultSource:sid,sources:{[sid]:rowSource(row,{kind:'preset',provider,voiceName:v.id,...(useModel?{model:useModel}:{})})}});
  const goSet=openSettings&&h(Button,{className:'ap-link',onClick:()=>openSettings(provider,custom||row.bind?{id:serviceId}:undefined)},'去设置');
  const warn=list.value?.status==='credentials-required'?h('p',{className:'ap-voice-line-warn'},h(VoiceWarn,{action:goSet},name+' 缺少 API Key')):null;
  const keyOf=v=>provider+':'+(serviceId||'')+':'+v.id+':'+useModel;
  const listen=v=>browser?preview.playBrowser(keyOf(v),{voice:v.id,language:v.languages?.[0],text:sampleText(primaryLanguage(v.languages?.[0]||'zh'))}):preview.play(keyOf(v),candidate(spec1(v)),{label:v.label||v.id});
  const play=v=>h(VoicePlay,{state:preview.of(keyOf(v)),label:'试听「'+(v.label||v.id)+'」',disabled:custom&&!useModel,title:custom&&!useModel?'先填写模型':undefined,onClick:()=>listen(v)});
  const meta=v=>[v.mine?'我的音色':'',VOICE_GENDERS[v.gender],v.description||'',v.styles?.length?v.styles.length+' 种风格':''].filter(Boolean).join(' · ');
  const modelPick=models.length>0&&h(InlineRow,{label:'模型'},
    h(VoiceOptionPick,{label:'模型',value:useModel,options:[...(custom?[]:[{id:'',label:'默认'}]),...models],onPick:setModel}),
    h(VoiceConfirmedWarning,{issues:modelStatus.value?.issues,field:'model'}));
  // A custom service without a voice list: 模型 and 音色 by name (the endpoint's own words, e.g. tts-1 / alloy).
  const manual=custom&&!!list.value&&!failed&&!voices.length;
  // The voice in use stays listed when the list lacks it (an id the account checked when it was picked).
  const byId=new Map(voices.map(v=>[v.id,v])),mine=own?.voiceName&&!byId.has(own.voiceName)?{id:own.voiceName,label:voiceDisplayName(own.voiceName),languages:[],mine:provider==='minimax'}:null;
  const minimax=provider==='minimax';
  return h('div',{className:'ap-voice-service'},
    warn,
    (list.error||failed)&&h(VoiceLoadError,{error:list.error||'读不到这个服务的声音列表',retry:list.reload}),
    // A service whose voices are the account's (MiniMax) lists none until its first read lands: still loading, not empty.
    !list.value||list.value.refreshing&&!voices.length?(list.error?null:h(VoiceLoading,{count:2})):failed?null:
    h(React.Fragment,null,
      (modelPick||manual)&&h(InlineGrid,{label:name+'的设置',columns:1,className:'ap-voice-source-props'},
        modelPick,
        manual&&!models.length&&h(InlineField,{kind:'text',label:'模型',value:model,placeholder:'例：tts-1',maxLength:160,onCommit:v=>setModel(v.trim())}),
        manual&&h(InlineField,{kind:'text',label:'音色',value:typed,placeholder:'例：alloy',maxLength:160,onCommit:v=>{const id=v.trim();setTyped(id);if(id)choose(spec1({id,label:id,languages:[]}),id);}})),
      !manual&&h(VoiceServiceVoices,{name,voices:mine?[mine,...voices]:voices,current:own?.voiceName||'',lang,speaks,play,meta,onUse:v=>choose(spec1(v),v.label||v.id),
        typedId:minimax?MINIMAX_VOICE_ID:null,
        help:minimax?h(Help,{text:'MiniMax 没有官方样音：▶ 会用这个音色合成一句短句，按 MiniMax 价格计费；合成结果会缓存，同一人物再听同一音色不会再扣费。',label:'MiniMax 试听 说明'}):null})));
}
// One reference clip: № · ▶ original · what it says · language · length / size · ⋯ (上移 / 下移 / 删除). Alt+↑/↓ moves it.
function VoiceClipRow({index,count,clip,size,duration,playing,onPlay,onEdit,onMove,onRemove,reorder}) {
  const no=index+1,on=playing==='playing'||playing==='loading';
  return h('li',{className:'ap-clip',onKeyDown:e=>{if(reorder&&e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();onMove(e.key==='ArrowUp'?-1:1);}}},
    h('span',{className:'ap-clip-no','aria-hidden':true},String(no).padStart(2,'0')),
    h('button',{type:'button',className:'ap-icon-button ap-clip-play','aria-label':(on?'停止':'播放')+'第 '+no+' 段原音','aria-pressed':on,'data-state':playing||undefined,onClick:onPlay},playing==='loading'?h(Spinner,{key:'clip'}):h(Glyph,{name:on?'stop':'play'})),
    h(CommitInput,{className:'ap-clip-text','aria-label':'第 '+no+' 段原文',value:clip.text,placeholder:'填写这段音频说的话',maxLength:1500,onCommit:v=>onEdit({text:v.trim()})}),
    h(VoiceLanguagePick,{value:clip.language,label:'第 '+no+' 段语言',className:'ap-clip-lang',onPick:language=>onEdit({language})}),
    h('span',{className:'ap-clip-meta'},[voiceSeconds(duration),voiceBytes(size)].filter(Boolean).join(' · ')),
    h(Popover,{label:'第 '+no+' 段操作',className:'ap-clip-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'第 '+no+' 段操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
      reorder&&h(MenuItem,{disabled:index===0,onClick:()=>{close();onMove(-1);}},'上移'),reorder&&h(MenuItem,{disabled:index===count-1,onClick:()=>{close();onMove(1);}},'下移'),
      h(MenuItem,{danger:true,onClick:()=>{close();onRemove();}},'删除'))}));
}
const clipDurations=new Map();
function useClipDurations(binding,packId,hashes){
  const [,bump]=React.useState(0),key=hashes.join(',');
  React.useEffect(()=>{
    let live=true;const abort=new AbortController();if(typeof Audio==='undefined'||!binding.previewMedia)return;
    const todo=[...new Set(hashes)].filter(hash=>!clipDurations.has(packId+'/'+hash)).slice(0,60);
    (async()=>{for(const hash of todo){
      if(!live)return;const k=packId+'/'+hash;
      let media,a,expired=false;
      try{media=await previewWait(leaseMedia(binding,{packId,hash}).then(value=>{if(!live||expired)value.release();return value;}),15000,'MEDIA_TIMEOUT',abort.signal);
        if(!live)continue;
        a=new Audio();a.preload='metadata';
        const seconds=await previewWait(new Promise((resolve,reject)=>{a.onloadedmetadata=()=>resolve(a.duration);a.onerror=()=>reject(previewAudioError(a));a.src=media.url;}),5000,'AUDIO_TIMEOUT',abort.signal);
        if(Number.isFinite(seconds))clipDurations.set(k,seconds);
      }catch(_){}finally{expired=true;if(a){a.onloadedmetadata=null;clearPreviewAudio(a);}media?.release();}
      if(live)bump(n=>n+1);}})();
    return()=>{live=false;abort.abort(previewFailure('ABORTED'));};
  },[binding,packId,key]);
  return hashes.map(hash=>clipDurations.get(packId+'/'+hash)??null);
}
// An ordered clip list (Fish) with its dashed ＋ upload tile at the end.
// `mood`: the 差分 these clips speak in, so the preview card shows that face while one plays.
// `needed`: with no clip here the voice cannot speak — the empty list's ＋ is the highlighted next step, nothing is written (R25).
function VoiceClipList({binding,pack,refs,label,clips,preview,onChange,onAdd,reorder=true,disabled,needed,mood=''}) {
  const packId=pack.manifest.id,durations=useClipDurations(binding,packId,refs.map(r=>r.media)),sizes=refs.map(r=>pack.manifest.blobs?.[r.media]?.size);
  const total=sizes.reduce((n,s)=>n+(s||0),0),seconds=durations.every(Number.isFinite)&&refs.length?durations.reduce((n,s)=>n+s,0):null;
  const edit=(i,patch)=>onChange(refs.map((r,j)=>j===i?{...r,...patch}:r));
  const move=(i,d)=>{const j=i+d;if(j<0||j>=refs.length)return;const next=[...refs];[next[i],next[j]]=[next[j],next[i]];onChange(next);};
  return h('div',{className:'ap-clips-wrap'},
    refs.length>0&&h('p',{className:'ap-clips-sum'},[refs.length+' 段',voiceSeconds(seconds),voiceBytes(total)].filter(Boolean).join(' · ')),
    clips.state?.status==='error'&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'⚠ ',clips.state.error),
    h('ol',{className:'ap-clips','aria-label':label},
      refs.map((r,i)=>{const id='ref'+i+'/'+r.media,state=clips.state?.id==='voice-ref/'+id?clips.state.status:null;
        return h(VoiceClipRow,{key:i+':'+r.media,index:i,count:refs.length,clip:r,size:sizes[i],duration:durations[i],playing:state,reorder,
          onPlay:()=>{preview.stop();clips.toggle({kind:'voice-ref',id,media:r.media,name:'',mood});},onEdit:patch=>edit(i,patch),onMove:d=>move(i,d),onRemove:()=>onChange(refs.filter((_,j)=>j!==i))});}),
      h('li',{className:'ap-clip-add-row'},h('label',{className:'ap-clip-add','data-disabled':disabled||undefined,'data-needed':needed&&!refs.length||undefined,title:'添加'+label},h(Glyph,{name:'plus'}),
        h('input',{type:'file',multiple:true,accept:VOICE_CLIP_ACCEPT,'aria-label':'添加'+label,disabled,onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';if(files.length)onAdd(files);}})))));
}
// 声音设置 › 参考音频 of a clone: Fish's ordered reference list — the whole list, in this order, is sent with every line.
// With no clips the dashed ＋ is highlighted as the next step.
function VoiceReferences({binding,pack,figure,spec,voice,writer,preview,entry,clips}) {
  const [sid,source]=entry,language=effectiveVoiceLanguage(voice?.language,spec?.language),refs=source.references;
  const add=files=>writer.addClips(files,{language,place:(s,clips)=>{s.sources[sid].references=[...s.sources[sid].references,...clips];}});
  return h('div',{className:'ap-voice-refs'},
    h(VoiceClipList,{binding,pack,refs,label:'参考音频',clips,preview,disabled:writer.busy>0,needed:true,onAdd:add,
      onChange:next=>writer.editVoice(s=>{s.sources[sid].references=next;return s;})}));
}
// the shared Slider; double click returns to the voice's own value.
function TuneSlider({def,value,label,onCommit}) {
  return h(Slider,{className:'ap-tune',label,min:def.min,max:def.max,step:def.step,value,reset:def.base,valueText:v=>tuneText(def,v),output:v=>tuneText(def,v),outputClassName:'ap-tune-value',onCommit});
}
// 调音: the tunings of the figure's own voice as tiles (原声, then the author's). A click uses one (the binding's variant); the
// one in use carries ⋯ (重命名 / 删除) and its parameters show under the tiles; the dashed ＋ saves the current settings as a
// new tuning. 按差分调音 maps emotions to tunings (the v4 binding's emotionVariants).
function VoicePresets({binding,pack,figure,spec,voice,sourceId,writer,rows,active}) {
  const currentVoice=voice.voice,currentPreset=voice.variant||'normal';
  const [renaming,setRenaming]=React.useState(false),[byMood,setByMood]=React.useState(!!voice.emotionVariants);
  const presetNames=Object.keys(voicePresets(spec));
  const entries=presetNames.map(pid=>({presetId:pid,name:presetName(spec,pid),current:pid===currentPreset}));
  const pick=e=>{if(e.current)return;setRenaming(false);return writer.patchBinding({variant:e.presetId==='normal'?undefined:e.presetId});};
  const save=(id,next)=>writer.editVoice(s=>{s.variants={...(s.variants||{}),[id]:next};return s;},{id});
  const own=voicePresets(spec)[currentPreset]||voicePresets(spec).normal;
  const add=async()=>{const id='t'+Date.now().toString(36),n=Object.keys(spec.variants||{}).filter(k=>k!=='normal').length+1;
    if(await save(id,{name:'预设 '+n,...(own.tuning?{tuning:structuredClone(own.tuning)}:{})})){await writer.patchBinding({variant:id});setRenaming(true);}};
  const rename=v=>{setRenaming(false);const base=currentPreset==='normal'?(spec.variants?.normal||{}):spec.variants[currentPreset];save(currentPreset,{...base,name:v.trim()});};
  return h('div',{className:'ap-voice-presets-wrap'},
    h('ul',{className:'ap-voice-tiles ap-voice-presets',role:'radiogroup','aria-label':'调音'},
      entries.map(e=>{const users=voiceUsers(pack,currentVoice).filter(f=>f.id!==figure.id&&(f.voice.variant||'normal')===e.presetId).map(f=>f.name);
        return h('li',{key:e.presetId,className:'ap-voice-tile ap-voice-preset','data-current':e.current||undefined},
          e.current&&renaming?h('div',{className:'ap-voice-preset-rename'},
            h(CommitInput,{className:'ap-voice-preset-name-input','aria-label':'预设名称',autoFocus:true,value:e.name,maxLength:20,validate:v=>v.trim()?'':'名称不能为空',onCommit:rename,onBlur:()=>setRenaming(false)})):
          h('button',{type:'button',role:'radio','aria-checked':e.current,'aria-label':e.name,className:'ap-voice-tile-main',onClick:()=>pick(e)},
            h('span',{className:'ap-voice-tile-name'},e.name),
            users.length>0&&h('span',{className:'ap-voice-tile-meta'},users.join('、')+' 在用')),
          e.current&&!renaming&&h(Popover,{label:'预设操作',className:'ap-voice-tile-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'预设操作 '+e.name,'aria-expanded':open,onClick:toggle}),
            content:close=>h(React.Fragment,null,h(MenuItem,{onClick:()=>{close();setRenaming(true);}},'重命名'),
              h(MenuItem,{danger:true,disabled:e.presetId==='normal',title:e.presetId==='normal'?'原声不能删除':undefined,onClick:()=>{close();writer.deleteVariant(e.presetId);}},'删除'))}));}),
      h('li',{className:'ap-voice-preset-add-row'},h('button',{type:'button',className:'ap-voice-preset-add','aria-label':'把当前设置存为新预设',title:'把当前设置存为新预设',onClick:add},h(Glyph,{name:'plus'})))),
    h(VoicePresetParams,{binding,spec,voice,sourceId,active,save,preset:currentPreset}),
    h('div',{className:'ap-voice-bymood'},
      h('div',{className:'ap-voice-subhead-row'},
        h('button',{type:'button',className:'ap-voice-subhead','aria-expanded':byMood,onClick:()=>setByMood(v=>!v)},h('span',null,'按差分调音'),h('span',{className:'ap-voice-way-sum'},voice.emotionVariants?Object.keys(voice.emotionVariants).length+' 种差分':''),h(Glyph,{name:'chevDown'})),
        h(Help,{text:VOICE_MOOD_TUNING_HELP,label:'按差分调音 说明'})),
      byMood&&h('ul',{className:'ap-voice-moods','aria-label':'按差分调音'},rows.map(r=>{const value=voice.emotionVariants?.[r.id]||'';
        return h('li',{key:r.id,className:'ap-voice-mood-row'},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',{className:'ap-voice-mood-name'},r.label),
          h(Popover,{label:r.label+'调音',trigger:({toggle,open:o})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick','aria-label':r.label+'调音：'+(value?presetName(spec,value):'跟随默认'),'aria-expanded':o,onClick:toggle},h('span',null,value?presetName(spec,value):'跟随默认'),h(Glyph,{name:'chevDown'})),
            content:close=>[['','跟随默认'],...presetNames.map(id=>[id,presetName(spec,id)])].map(([id,label])=>h('button',{key:id||'follow',type:'button',role:'menuitemradio','aria-checked':value===id,className:'ap-menu-item',
              onClick:()=>{close();if(value===id)return;const map={...(voice.emotionVariants||{})};if(id)map[r.id]=id;else delete map[r.id];writer.patchBinding({emotionVariants:Object.keys(map).length?map:undefined});}},label))}));}))));
}
// The current preset's parameters, shown under its tiles: the source in use's own (Fish: 语速; Azure: 语速 / 音高 / 风格; Qwen: 风格指令).
function VoicePresetParams({binding,spec,sourceId,active,save,preset}) {
  const sid=sourceId??spec.defaultSource,source=active||spec.sources[sid],variant=voicePresets(spec)[preset]||voicePresets(spec).normal,tuning=variant.tuning?.[sid]||{},name=presetName(spec,preset);
  const defs=VOICE_TUNING[source.provider]||[];
  const azure=useVoiceLoad(()=>source.provider==='azure'&&binding.tts?.call?binding.tts.call('listOnlinePresetVoices',{provider:'azure'}):null,[binding,source.provider]);
  const styles=azure.value?.voices?.find(v=>v.id===source.voiceName)?.styles||[];
  const setParam=(key,value)=>{const t={...(variant.tuning||{})},own={...(t[sid]||{})};if(value===null||value===''||value===undefined)delete own[key];else own[key]=value;if(Object.keys(own).length)t[sid]=own;else delete t[sid];
    const next={...(preset==='normal'?(spec.variants?.normal||{}):spec.variants[preset])};if(Object.keys(t).length)next.tuning=t;else delete next.tuning;if(preset==='normal'&&!next.name)next.name='原声';return save(preset,next);};
  const modelStatus=useVoiceModelStatus(binding,source);
  const instruct=modelStatus.value?.modelInstructions!==false;
  const control=def=>{
    // 风格指令 and 风格 are inline fields (value read as text, edited in place).
    if(def.kind==='text')return instruct?h(InlineField,{key:def.key,kind:'text',label:def.label,wide:true,className:'ap-voice-instructions',value:tuning[def.key]||'',placeholder:'例：语气轻快，带一点撒娇',maxLength:200,onCommit:v=>setParam(def.key,v)}):
      h(InlineRow,{key:def.key,label:def.label},h('span',{className:'ap-voice-na'},'未使用',h(Help,{text:'当前模型不支持风格或情绪指令，已保存的指令不会发送。',label:'风格指令未使用说明'})));
    if(def.kind==='style')return styles.length?h(InlineField,{key:def.key,kind:'menu',label:def.label,controlLabel:'风格',value:tuning.style||'',options:['',...styles].map(st=>({value:st,label:st||'默认'})),onCommit:st=>setParam('style',st||null)}):null;
    return h(InlineRow,{key:def.key,label:def.label,className:'ap-voice-tune-row'},h(TuneSlider,{def,value:Number.isFinite(tuning[def.key])?tuning[def.key]:def.base,label:name+def.label,onCommit:v=>setParam(def.key,v===def.base?null:v)}));
  };
  // One label column for every parameter (sliders, 风格, 风格指令, the not-supported lines): InlineGrid rows.
  return h(InlineGrid,{label:name+'的参数',columns:1,className:'ap-voice-tune-props'},
    defs.map(control),
    !defs.length&&h(InlineRow,{label:'参数'},h('span',{className:'ap-voice-na'},'这个声音使用原声参数')));
}