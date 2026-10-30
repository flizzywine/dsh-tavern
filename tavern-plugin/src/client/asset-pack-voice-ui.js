// a figure's 声音. The figure page keeps one compact 「声音」 property — the
// voice's name (⚠ when it cannot speak), ▶ and the way into the voice page. The voice page replaces the figure column
// (desktop: the preview card stays pinned beside it; phone: a full-screen sub-page with its own top bar).
// one 「配音来源」 list — Fish Audio 声音克隆 / 声音库 · 在线 TTS · 不配音 — each with its
// state and its settings in place; then 「调音」.
// A way picked for a voice gets added to that voice (VoicePage / useVoiceWriter.useSource); a
// figure without a voice gets a new pack voice; editing a voice that other figures share asks first (copy, or all).
// Opening, choosing or saving never synthesizes; ▶ does, and a paid or unknown-cost preview asks first (billing confirm).
// Missing service / key / voice → ⚠ chip, the figure stays silent (不配音); nothing silently switches service.
const VOICE_TTS_ROOT='/api/dsh-tts/v1/';
const VOICE_PROVIDERS={'fish-audio':'Fish Audio',qwen:'通义千问',azure:'Azure',volcengine:'火山引擎','openai-compatible':'自定义语音服务',browser:'浏览器朗读'};
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
const VOICE_ERRORS={TTS_DISABLED:'配音插件未启用',PLUGIN_UNAVAILABLE:'配音插件未启用',SERVICE_REQUIRED:'还没有可用的语音服务',CREDENTIALS_REQUIRED:'语音服务缺少密钥',
  QWEN_MODEL_NOT_FOUND:'当前服务上次合成无法访问此模型（404），请核对模型开通状态与区域',QWEN_VOICE_UNSUPPORTED:'上次合成返回此模型不支持该音色，请重新选择音色',
  MISSING_REFERENCE:'这个差分没有参考录音，「默认」里也没有',PREVIEW_CONFIRMATION_REQUIRED:'付费确认已过期，请重新试听',PAID_PREVIEW_DISABLED:'这个服务不能免费试听',
  FISH_AUTH_FAILED:'Fish Audio 密钥无效',FISH_BILLING_REQUIRED:'Fish Audio 额度不足：去充值，或在配音设置里换回免费型号',FISH_RATE_LIMITED:'Fish Audio 请求太频繁，请稍后再试',FISH_REQUEST_FAILED:'Fish Audio 请求失败，请稍后再试',
  VOICE_NOT_FOUND:'找不到这个声音',VOICE_VARIANT_IN_USE:'还有别的人物在用这个预设，先给他们换一个预设',SHARED_VOICE_CONFIRMATION_REQUIRED:'这个声音还有别的人物在用，请重新确认',
  REFERENCE_LIMIT_EXCEEDED:'参考音频超过了服务的限制',LIMIT_EXCEEDED:'素材包空间不够了',QUEUE_FULL:'试听太多，请稍后再试',TIMEOUT:'试听超时，请稍后再试',AUDIO_GONE:'试听音频已失效，请重新试听',
  ABORTED:'试听请求已中断，请重新试听；若反复发生，请重新载入声音页。',REQUEST_TIMEOUT:'声音页面请求超时，请重新载入页面；若仍失败，请检查配音服务连接。',
  REVISION_CONFLICT:'内容已被修改，请重新载入',INVALID_INPUT:'内容不符合格式，没有保存',REQUEST_FAILED:'请求失败，请稍后再试',FORBIDDEN:'没有权限'};
// no code on the page — this page's sentence for a code, else the shared playerErrorText
// (the host's plain Chinese sentence, Tavern `error` / TTS `message`); the code goes to the console.
function voiceErrorText(e){const code=voiceCode(e);
  return /^(?:AUDIO_|MEDIA_)/.test(code)&&!VOICE_ERRORS[code]||e?.name==='NotAllowedError'?previewErrorText(e):playerErrorText({code,message:String(e?.message||e||'')},{codes:VOICE_ERRORS,fallback:'声音请求失败，请检查配音设置后重试。'});}
// What the 试听 failure line offers: the 配音 page for a service problem, this source's settings for a voice problem.
const VOICE_SERVICE_CODES=new Set(['SERVICE_REQUIRED','CREDENTIALS_REQUIRED','FISH_AUTH_FAILED','FISH_BILLING_REQUIRED','SERVICE_OFFLINE','INVALID_PATH','INVALID_CONFIG','PORT_OCCUPIED','PROCESS_EXITED','SERVICE_START_FAILED','TTS_DISABLED','QWEN_MODEL_NOT_FOUND']);
// every 配音来源 can be chosen before it is set up; what a chosen source still
// lacks, in plain words for screen readers only (R25: on screen the page shows it — an amber radio, the
// empty field highlighted, 试听 off; the host answers MISSING_REFERENCE / VOICE_NOT_FOUND for it).
const VOICE_UNSET_TEXT={'reference-list':'还没有参考音频','voice-id':'还没选声音',preset:'还没选在线声音'};
const voiceSourceUnset=s=>s&&(s.kind==='reference-list'?!s.references.length:s.kind==='voice-id'?!s.voiceId:!s.voiceName)?VOICE_UNSET_TEXT[s.kind]:'';
const VOICE_EDIT_CODES=new Set(['MISSING_REFERENCE','LANGUAGE_UNSUPPORTED','QWEN_VOICE_UNSUPPORTED','VOICE_NOT_FOUND']);
const providerName=kind=>VOICE_PROVIDERS[kind]||'语音服务';
// The one line that says why a voice is silent (⚠ chips, the 声音 property's tooltip).
// A Latin service name gets spaces around it inside a Chinese sentence (缺少 Fish Audio 密钥 / 缺少通义千问密钥).
const spacedName=name=>(/^[A-Za-z]/.test(name)?' ':'')+name+(/[A-Za-z0-9]$/.test(name)?' ':'');
function voiceIssueText(code,source){
  const name=spacedName(providerName(source?.provider));
  if(code==='SERVICE_REQUIRED')return '还没有配置'+name+'服务';
  if(code==='CREDENTIALS_REQUIRED')return '缺少'+name+'密钥';
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
const VOICE_LANGUAGE_HELP='不是中文时，AI 会为这个角色额外写一句这门语言的台词用来配音，画面上仍显示中文。';
const pickVoiceLanguage=(list,fallback='ja')=>(list||[]).map(l=>String(l).toLowerCase()).find(l=>VOICE_LANGUAGE_TAG.test(l))||fallback;
const figureVoiceSpec=(pack,figure)=>figure.voice?pack.manifest.voiceLibrary?.voices?.[figure.voice.voice]||null:null;
const voiceSourceId=(spec,binding)=>binding?.source===null?null:binding?.source??spec.defaultSource;
const voiceUsers=(pack,voiceId)=>Object.values(pack.figures||{}).filter(f=>f.voice?.voice===voiceId);
// the 配音来源 of a figure — one choice, in this order, named by the
// service that speaks (never by mechanism). A source is the kind of one source of the figure's pack voice
// (source ids are free).
// `unset`: the source a choice records before anything is picked (its id and its data). No (?) per way (
// R25): the service names and the settings that open under them do the explaining.
const VOICE_WAYS=[
  {id:'clone',title:'Fish Audio · 声音克隆',kind:'reference-list',provider:'fish-audio',
    unset:{id:'fish',source:()=>({kind:'reference-list',provider:'fish-audio',references:[]})}},
  {id:'library',title:'Fish Audio · 声音库',kind:'voice-id',provider:'fish-audio',
    unset:{id:'fish',source:()=>({kind:'voice-id',provider:'fish-audio'})}},
  // An online choice names no service until a voice is picked; it records the first built-in service (any online voice
  // picked later replaces it, service and all).
  {id:'online',title:'在线 TTS',kind:'preset',
    unset:{id:'online',source:()=>({kind:'preset',provider:'qwen'})}},
  {id:'off',title:'不配音'}];
const VOICE_WAY=id=>VOICE_WAYS.find(w=>w.id===id);
const voiceWayOf=source=>VOICE_WAYS.find(w=>w.kind&&w.kind===source?.kind)||null;
const voiceWayEntry=(spec,way)=>spec&&way.kind?Object.entries(spec.sources).find(([,s])=>s.kind===way.kind)||null:null;
const voiceSourceLabel=source=>source.kind==='preset'?'在线 TTS · '+providerName(source.provider):voiceWayOf(source)?.title||'声音';
const voiceSourceShort=voiceSourceLabel;
// Azure voice names read as the voice (en-US-AshleyNeural → Ashley), not as an internal id.
const voiceDisplayName=name=>String(name||'').replace(/^[a-z]{2,3}-[A-Z]{2}-/,'').replace(/(?:Multilingual)?Neural$/,'')||name;
const sampleText=language=>VOICE_SAMPLES[String(language).split('-')[0]]||VOICE_SAMPLES.en;
const freeSourceId=(spec,...names)=>{for(const n of names)if(!spec.sources[n])return n;let i=2;while(spec.sources[names[0]+i])i++;return names[0]+i;};
const voiceBytes=n=>!Number.isFinite(n)?'':n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(n<10*1024*1024?1:0)+' MB';
const voiceSeconds=s=>!Number.isFinite(s)?'':s<60?(Math.round(s*10)/10)+' 秒':Math.floor(s/60)+' 分 '+Math.round(s%60)+' 秒';
const tuneText=(def,v)=>def.unit==='x'?Number(v).toFixed(2)+'×':(v>0?'+':'')+v+'%';
// a 声音预设 is one pack voice × one of its variants (原声 = the implicit 'normal'). The UI lists
// them flat; the data stays voice v4 (voiceLibrary voices + variants, the figure binding's voice / variant).
const voicePresets=spec=>{const v=spec.variants||{};return {normal:{name:'原声',...(v.normal||{})},...Object.fromEntries(Object.entries(v).filter(([k])=>k!=='normal'))};};
const presetName=(spec,id)=>id==='normal'?(spec.variants?.normal?.name||'原声'):spec.variants?.[id]?.name||'未命名预设';
const cleanBinding=b=>{const next={...b};for(const k of Object.keys(next))if(next[k]===undefined)delete next[k];return next;};
const cloneSpec=(figure,language,references)=>({name:figure.name+'的声音',language,defaultSource:'fish',sources:{fish:{kind:'reference-list',provider:'fish-audio',references}}});
const fishVoiceSpec=(v,fallbackName)=>({name:v?.name||fallbackName,language:pickVoiceLanguage(v?.languages),defaultSource:'fish',sources:{fish:{kind:'voice-id',provider:'fish-audio',voiceId:v.voiceId}}});

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
function useVoiceServices(binding){
  const state=useVoiceLoad(()=>binding.rpc('getAssetVoiceServices').then(r=>r.services||[]),[binding]),list=state.value||[];
  return {list,loaded:!!state.value,first:kind=>list.find(s=>s.kind===kind)};
}
// can a provider speak now — read from the TTS `services` list (configured connections
// with their secret flags and last check; running services with status). null = nothing wrong
// known; {warn,setup} = a problem fixed in the 配音 page. Polls once a second while a service still says `checking`.
function voiceReadiness(services,provider){
  // Browser speech needs no service; a device without it says so.
  if(provider==='browser')return typeof window!=='undefined'&&window.speechSynthesis?null:{warn:true,text:'这台设备不支持浏览器朗读'};
  if(!services||!provider)return null;
  const configured=services.configured||[],running=services.running||[];
  const name=providerName(provider),mine=configured.filter(c=>c.kind===provider),live=running.filter(r=>r.kind===provider);
  if(!mine.length&&!live.length)return {warn:true,setup:true,text:'还没有设置'+spacedName(name).trimEnd()};
  // A custom (OpenAI 兼容) service may run without a key (its key field is optional).
  const keyed=c=>provider==='openai-compatible'||!Object.values(c.secrets||{}).some(x=>x&&x.configured===false);
  if(mine.length&&!mine.some(keyed)||live.some(r=>r.status?.state==='credentials-required'))return {warn:true,setup:true,text:'需要'+spacedName(name)+'密钥'};
  const failed=mine.find(c=>c.check?.status==='error')||live.find(r=>['offline','error'].includes(r.status?.state));
  if(failed&&!live.some(r=>r.status?.state==='ready'))return {warn:true,setup:true,text:spacedName(name).trimStart()+'连不上',title:failed.check?.message||failed.status?.error};
  if(live.some(r=>r.status?.state==='checking'))return {text:'正在检查…'};
  return null;
}
function useVoiceReadiness(binding){
  const state=useVoiceLoad(()=>binding.tts?.call?binding.tts.call('services'):null,[binding]),value=state.value;
  useVoiceRefresh(binding,state.reload);
  const checking=!!value?.running?.some?.(s=>s.status?.state==='checking');
  React.useEffect(()=>{if(!checking)return;const t=setTimeout(state.reload,1000);return()=>clearTimeout(t);},[value]);
  // `.services`: the raw snapshot (null until read) for the 在线 TTS rows (one per configured service).
  return Object.assign(provider=>voiceReadiness(value,provider),{services:value});
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
function openVoiceSettings(ctx,provider,{id,add}={}){
  try{if(provider)sessionStorage.setItem(VOICE_FOCUS_KEY,JSON.stringify({kind:provider,...(id?{id}:{}),...(add?{add:true}:{}),at:Date.now()}));}catch(_){}
  return ctx.nav.openTab('dsh-tts:voice');
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
async function voiceJobWait(requestId,timeoutMs,live,signal){
  const deadline=Date.now()+(timeoutMs||125000);
  while(live()&&Date.now()<deadline){
    const {response,status}=await previewWait((async()=>{const response=await fetch(VOICE_TTS_ROOT+'synthesis/status?requestId='+encodeURIComponent(requestId),{credentials:'same-origin',signal});return {response,status:await response.json()};})(),Math.min(15000,Math.max(1,deadline-Date.now())),'REQUEST_TIMEOUT',signal);
    if(!response.ok)throw voiceFailure(status.error||'REQUEST_FAILED',status.message);
    if(status.state==='ready')return status.result;
    if(status.state==='error')throw voiceFailure(status.error,status.message);
    if(status.state==='cancelled')throw voiceFailure('ABORTED');
    await new Promise(r=>setTimeout(r,200));
  }
  throw voiceFailure(live()?'TIMEOUT':'ABORTED');
}
const voiceJobCancel=requestId=>{if(typeof fetch==='function')fetch(VOICE_TTS_ROOT+'synthesis/status?requestId='+encodeURIComponent(requestId),{method:'DELETE',credentials:'same-origin'}).catch(()=>{});};
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
  const finish=run=>{if(run.requestId&&!run.done)voiceJobCancel(run.requestId);if(run.scope){const scope=run.scope;run.scope=null;binding.rpc('closeFigureVoicePreview',{scope}).catch(()=>{});}};
  function stop(){const run=current.current;current.current=null;if(run){run.cancelled=true;run.abort.abort(voiceFailure('ABORTED'));run.resolve?.(false);try{clearPreviewAudio(run.audio);}catch(_){}if(run.audio)speech?.hush(run.audio);finish(run);}setAsk(null);setState(null);}
  React.useEffect(()=>stop,[binding]);
  // The billed service and its configured model (TTS capabilities.modelLabel, e.g. Fish 「Drama 3」), for the dialog's sentence.
  async function serviceName(id){
    try{kinds.current||=binding.rpc('getAssetVoiceServices').then(r=>r.services||[]);const s=(await kinds.current).find(x=>x.id===id);
      return s?providerName(s.kind)+(s.capabilities?.modelLabel?' · '+s.capabilities.modelLabel+'（计费）':''):'付费语音服务';}catch(_){return '付费语音服务';}
  }
  async function play(key,request,{label='',mood=''}={}){
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
          const service=await previewWait(serviceName(result.billing?.serviceId),15000,'REQUEST_TIMEOUT',run.abort.signal);
          const answer=live()&&await new Promise(resolve=>{run.resolve=resolve;setAsk({label,service,resolve});});
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
      const done=await voiceJobWait(result.requestId,result.timeoutMs,live,run.abort.signal);run.done=true;
      if(!live())return;
      if(typeof Audio==='undefined')throw voiceFailure('AUDIO_GONE');
      const audio=new Audio(binding.tts.audioUrl?binding.tts.audioUrl(done.ticket):VOICE_TTS_ROOT+'audio?ticket='+encodeURIComponent(done.ticket));
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
  async function playSample(key,sample){
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
    }catch(e){failed(e);}
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
function VoiceBillingDialog({label,service,onConfirm,onCancel}) {
  const [quiet,setQuiet]=React.useState(false);
  return h(Modal,{title:'付费试听',onClose:onCancel,closable:false,className:'ap-confirm ap-voice-dialog'},
    h('p',null,'试听'+(label?'「'+label+'」':'')+'会用'+spacedName(service)+'合成一句短句，按服务价格计费一次。'),
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
  // New clips for a source: the figure's voice gains them (a missing source is added); a figure without a voice gets a new one.
  // clips never change what the figure speaks with — a new voice made for them
  // stays 不配音 until its radio is chosen.
  async function addClips(files,{language,limit,create,place}){
    if(!figure.voice){const refs=await upload(files,language,limit);return refs&&await createVoice(create(refs))&&useSourceId(null);}
    const how=await scope();if(!how)return null;
    const refs=await upload(files,language,limit);if(!refs)return null;
    return apply(how,spec=>{place(spec,refs);return spec;});
  }
  // a way chosen for a figure that already has a voice joins that voice (its other sources, clips and
  // model stay) and becomes the figure's source; a figure without a voice, or whose voice is only this one way, gets the
  // ready-made voice as its own new pack voice (the old one stays in the pack) — unless that one way was only chosen, not
  // set up yet: then the pick fills it in, name and all.
  async function useSource(made){
    const [hint,src]=Object.entries(made.sources)[0],spec=figure.voice?pack.manifest.voiceLibrary?.voices?.[figure.voice.voice]:null;
    const only=!!spec&&Object.values(spec.sources).every(s=>s.kind===src.kind),fill=only&&Object.values(spec.sources).some(voiceSourceUnset);
    if(!spec||only&&!fill)return createVoice(made);
    const how=await scope();if(!how)return null;
    return run(async c=>{
      const b=c.figures[figureId].voice,id=b.voice,next=structuredClone(c.manifest.voiceLibrary.voices[id]),found=Object.entries(next.sources).find(([,s])=>s.kind===src.kind);
      const sid=found?found[0]:freeSourceId(next,hint);next.sources[sid]=src;if(fill)next.name=made.name;
      const bound=cleanBinding({...b,source:sid===next.defaultSource?undefined:sid});
      if(how==='copy')return copyFor(c,next,bound);
      const m=await svc.savePackVoice({packId,figureId,expectedRevision:c.revision,voiceId:id,voiceSpec:next,...(voiceUsers(c,id).some(f=>f.id!==figureId)?{confirmShared:true}:{})});
      return JSON.stringify(bound)===JSON.stringify(b)?m:svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:m.snapshot.revision,binding:bound});
    });
  }
  // Use a source id of the figure's voice (the way's row), or null for 不配音.
  const useSourceId=sid=>run(c=>{const b=c.figures[figureId].voice,spec=c.manifest.voiceLibrary.voices[b.voice],next=cleanBinding({...b,source:sid===null?null:sid===spec.defaultSource?undefined:sid});
    return JSON.stringify(next)===JSON.stringify(b)?{status:'noop'}:svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:next});});
  const assignTemplate=t=>run(c=>svc.assignVoiceTemplate({templateId:t.templateId,templateRevision:t.revision,packId,figureId,expectedRevision:c.revision}));
  const saveTemplate=()=>run(c=>svc.saveVoiceTemplate({expectedRevision:null,packId,packRevision:c.revision,voiceId:c.figures[figureId].voice.voice,binding:c.figures[figureId].voice}));
  return {busy,setBinding,patchBinding,createVoice,editVoice,deleteVariant,addClips,useSource,useSourceId,assignTemplate,saveTemplate};
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
function VoiceLanguagePick({value,label,onPick,className='',defaultValue}) {
  const [other,setOther]=React.useState(false);
  // float + fit: a select-like menu placed against the window (starts at the trigger, flips / keeps inside the edges); in the
  // dialog it was anchored to the trigger's right edge and ran off a 375 px screen.
  return h(Popover,{label,float:true,fit:true,className:'ap-voice-lang-anchor'+(className?' '+className:''),trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-lang','aria-label':label+'：'+voiceLanguageName(value),'aria-expanded':open,onClick:()=>{setOther(false);toggle();}},h('span',null,voiceLanguageName(value)),h(Glyph,{name:'chevDown'})),
    content:close=>h(React.Fragment,null,FIGURE_VOICE_LANGUAGES.map(([id,name])=>h('button',{key:id,type:'button',role:'menuitemradio','aria-checked':value===id,className:'ap-menu-item',onClick:()=>{close();if(value!==id)onPick(id);}},h('span',null,name),defaultValue===id&&h('span',{className:'ap-voice-lang-default'},'声音默认'),value===id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})))),
      other?h('div',{className:'ap-voice-lang-other'},h(CommitInput,{className:'ap-voice-lang-input','aria-label':'其他语言代码',autoFocus:true,value:FIGURE_VOICE_LANGUAGES.some(([id])=>id===value)?'':value,placeholder:'例：de-DE',maxLength:35,validate:v=>VOICE_LANGUAGE_TAG.test(v.trim())?'':'请填写语言代码，如 de 或 pt-BR',onCommit:v=>{close();onPick(v.trim());}})):
        h('button',{type:'button',className:'ap-menu-item',onClick:()=>setOther(true)},'其他语言…'))});
}
function VoiceMoodPick({rows,value,onPick}) {
  const row=rows.find(r=>r.id===value)||rows[0];
  if(!row)return null;
  return h(Popover,{label:'试听差分',float:true,fit:true,className:'ap-voice-mood-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-mood','aria-label':'试听差分：'+row.label,'aria-expanded':open,onClick:toggle},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,row.label),h(Glyph,{name:'chevDown'})),
    content:close=>rows.map(r=>h('button',{key:r.id,type:'button',role:'menuitemradio','aria-checked':r.id===row.id,className:'ap-menu-item',onClick:()=>{close();onPick(r.id);}},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,r.label),r.id===row.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// One 配音来源: a row — radio · name · its summary (or ⚠ and why) · chevron — that opens its settings in place.
// choosing and opening are two controls. The radio (filled for the way
// the figure speaks with now) is the only one that switches; the rest of the row only opens / closes the settings. Every way
// can be chosen before it is set up: it is then chosen and silent. `incomplete` (what it lacks, read only
// by screen readers; R25): its radio turns amber and its title too, nothing is written — its settings open with the missing
// field highlighted. A way not set up and not chosen shows nothing on the right. 不配音 has no settings: its whole row is
// its radio. A row whose provider cannot speak shows ⚠ and why. `count` (在线 TTS: how many services are listed) follows
// the title, as a heading count (R4 / R5).
function VoiceWay({way,current,incomplete,needed,open,onUse,onToggle,state,summary,count,children}) {
  const body='ap-voice-way-'+way.id,warn=!!state?.warn,text=warn?state.text:summary||'';
  const dot=h('span',{className:'ap-voice-way-dot','aria-hidden':true});
  return h('section',{className:'ap-voice-way','data-open':open||undefined,'data-current':current||undefined,'data-incomplete':current&&incomplete?true:undefined,'aria-label':way.title},
    h('div',{className:'ap-voice-way-heading has-help'},
      children&&h('button',{type:'button',role:'radio',className:'ap-voice-way-radio','aria-checked':!!current,'aria-label':way.title,
        title:current?'使用中':'用这个配音',onClick:current?undefined:onUse},dot),
      h('button',{type:'button',className:'ap-voice-way-head',...(children?{'aria-expanded':!!open,'aria-controls':open?body:undefined,onClick:onToggle}:{role:'radio','aria-checked':!!current,onClick:current?undefined:onUse}),
          'aria-label':way.title+(children&&current?'，使用中':'')+(current&&incomplete?'，'+incomplete:'')+(text?'，'+text:'')},
        !children&&dot,h('span',{className:'ap-voice-way-title'},way.title),
        count>0&&h('span',{className:'ap-voice-way-count','aria-hidden':true},count)),
      h('span',{className:'ap-voice-way-sum'+(warn?' is-warn':''),title:state?.title||undefined},warn&&h(Glyph,{name:'warning'}),text),
      children?h(Glyph,{name:'chevDown'}):h('span',{className:'ap-voice-way-pad','aria-hidden':true})),
    open&&children&&h('div',{id:body,className:'ap-voice-way-body','data-needed':needed||undefined},children));
}
// A chosen-from-a-list row (search results, online voices, pack voices, templates): name · meta · ▶ · 使用. The row in use
// says so once, in the button's place (「使用中」, inert; R13 — no second chip after the name).
function VoiceRow({name,meta,tags,current,play,onUse,useLabel='使用',menu,warn,title}) {
  return h('li',{className:'ap-voice-row','data-current':current||undefined,title},
    h('div',{className:'ap-voice-row-main'},h('span',{className:'ap-voice-row-name'},name),
      (meta||tags)&&h('span',{className:'ap-voice-row-meta'},[meta,tags].filter(Boolean).join(' · ')),warn),
    play||null,
    // The row in use keeps its (inert) button focusable: a pick must not drop focus to the page (Esc still goes back).
    onUse&&h(Button,{className:'ap-chip-button ap-voice-use','aria-label':(current?'正在使用 ':useLabel+' ')+name,'aria-disabled':current||undefined,onClick:current?undefined:onUse},current?'使用中':useLabel),menu||null);
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

// ---------- the voice page ----------
// top to bottom — the voice (name, how it speaks now or ⚠ and
// what to do, 配音语言, 试听), then 「配音来源」: the five sources in one list (the one place to choose; a way already set up in the
// voice switches at once, one not set up yet is chosen unset and opens its settings), then
// 「调音」 (this voice's tunings). Other pack voices and 我的模板 are in the voice's ⋯.
function VoicePage({binding,pack,figure,rows,status,preview,speech,commitVoice,ctx,onClose}) {
  const packId=pack.manifest.id,voice=figure.voice||null,spec=figureVoiceSpec(pack,figure),sourceId=spec?voiceSourceId(spec,voice):null;
  const active=spec&&sourceId?spec.sources[sourceId]||null:null,activeWay=!spec?null:sourceId===null?'off':voiceWayOf(active)?.id||null;
  const [open,setOpen]=React.useState(()=>spec?activeWay!=='off'?activeWay:null:'library'),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[shared,setShared]=React.useState(null),[others,setOthers]=React.useState(false);
  const head=React.useRef(null),services=useVoiceServices(binding),readiness=useVoiceReadiness(binding),clips=useAudioPreview(binding,packId,speech);
  const askShared=others=>new Promise(resolve=>setShared({others,resolve}));
  const writer=useVoiceWriter({binding,pack,figure,commitVoice,setError,askShared});
  const player={...preview,play:(...args)=>{clips.stop();return preview.play(...args);},playSample:(...args)=>{clips.stop();return preview.playSample(...args);}};
  React.useEffect(()=>{head.current?.focus?.({preventScroll:true});const page=head.current?.closest?.('.ap-pack-right');if(page)page.scrollTop=0;},[]);
  React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t);},[notice]);
  const choose=async(made,label)=>{preview.stop();const done=await writer.useSource(made);if(done)setNotice('已换成「'+label+'」');};
  const candidate=voiceSpec=>({packId,figureId:figure.id,expectedRevision:pack.revision,voiceSpec});
  const entry=way=>voiceWayEntry(spec,way),fishId=entry(VOICE_WAY('library'))?.[1].voiceId||null;
  // the popular Fish voices in the figure's
  // 配音语言 (zh / ja; other languages read both), from the first Fish service, with the voice in use kept in the list. The
  // answer is shown at once (curated picks) and re-read each second while it says `refreshing`.
  const speakLang=primaryLanguage(spec?effectiveVoiceLanguage(voice.language,spec.language):'ja'),catalogLang=['zh','ja'].includes(speakLang)?speakLang:undefined,fishService=services.first('fish-audio')?.id;
  const recommended=useVoiceLoad(()=>services.loaded?voiceTts(binding).call('listRecommendedFishVoices',{...(catalogLang?{language:catalogLang}:{}),...(fishService?{serviceId:fishService}:{}),...(fishId?{selectedVoiceId:fishId}:{})}):null,
    [binding,services.loaded,catalogLang,fishService,fishId],{keep:true});
  const common={binding,pack,figure,spec,voice,sourceId,writer,preview:player,services,candidate,choose,setError};
  const openSettings=ctx?.nav?.openTab?(provider,options)=>openVoiceSettings(ctx,provider,options):null;
  const provider=way=>way.provider||(way.id==='online'?entry(way)?.[1].provider:null);
  // Only the radio switches (a binding write); opening a way never does.
  const use=way=>{
    if(way.id==='off'){if(spec&&sourceId!==null){preview.stop();writer.useSourceId(null);}return;}
    const found=entry(way);
    if(found&&found[0]!==sourceId){preview.stop();writer.useSourceId(found[0]);}
    // A way not set up yet: it is recorded unset and chosen, and its settings open for what it still needs.
    if(!found){preview.stop();setOpen(way.id);
      writer.useSource({name:figure.name+'的声音',language:spec?effectiveVoiceLanguage(voice.language,spec.language):'ja',defaultSource:way.unset.id,sources:{[way.unset.id]:way.unset.source()}});}
  };
  const toggle=way=>setOpen(o=>o===way.id?null:way.id);
  // What a way shows on the right: its value (a way not set up, or chosen but not set up, shows nothing R25).
  const summary=way=>{const found=entry(way),s=found?.[1];if(!s||voiceSourceUnset(s))return '';
    if(way.id==='clone')return s.references.length+' 段录音';
    if(way.id==='library'){const name=recommended.value?.voices?.find(v=>v.voiceId===s.voiceId)?.name;return name&&name!==s.voiceId?name:spec.name;}
    return onlineSourceName(s,readiness.services)+' · '+voiceDisplayName(s.voiceName);};
  // What the way in use still lacks (screen readers only). Shown as the amber radio and the highlighted field in its settings.
  const incomplete=way=>{const s=entry(way)?.[1];return s?voiceSourceUnset(s):'';};
  const needed=way=>activeWay===way.id&&!!incomplete(way);
  // The way's provider problem, once, at the top of its settings (with 去设置 when the 配音 page fixes it).
  const fix=way=>{const state=way.id==='online'?null:readiness(provider(way));
    return state?.warn?h(VoiceWarn,{action:state.setup&&openSettings&&h(Button,{className:'ap-link',onClick:()=>openSettings(provider(way))},'去设置')},state.text):null;};
  const bodies={
    clone:()=>h(VoiceReferences,{...common,entry:entry(VOICE_WAY('clone')),clips}),
    library:()=>h(VoiceFishLibrary,{...common,state:recommended,currentId:fishId}),
    online:()=>{const set=s=>s&&!voiceSourceUnset(s)?s:null,own=set(active?.kind==='preset'?active:entry(VOICE_WAY('online'))?.[1]);
      return h(VoiceOnline,{...common,readiness,openSettings,active:own,inUse:!!own&&active===own,needed:needed(VOICE_WAY('online'))});}};
  return h('div',{className:'ap-voice-page',role:'region','aria-label':figure.name+'的声音',onKeyDown:e=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();e.stopPropagation();onClose();}}},
    // the shared sub-page header (‹ 「返回人物」 beside 「声音」).
    h(SubpageHead,{parent:'人物',title:'声音',level:3,titleRef:head,onBack:onClose,className:'ap-voice-head',
      tools:writer.busy>0&&h('span',{className:'ap-voice-saving'},h(Spinner,{key:'saving',label:'正在保存'}))}),
    error&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 ',error),
    // A candidate preview (a list's ▶) that failed says why here too; the saved voice's own failure sits under 试听.
    preview.state?.phase==='error'&&preview.state.key!=='saved:'+figure.id&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 试听失败：',preview.state.error),
    h(VoiceHero,{...common,rows,status,notice,ctx,setNotice,readiness,openSettings,activeWay,summary,onOthers:()=>setOthers(true),onFix:id=>setOpen(id)}),
    // No (?) on 配音来源 or 调音 (R25): a radio switches, a name with ⌄ opens, the tiles are the tunings.
    h(StageSection,{title:'配音来源',foldKey:'voice-ways',className:'ap-voice-ways-section'},
      h('div',{className:'ap-voice-ways',role:'radiogroup','aria-label':'配音来源'},VOICE_WAYS.map(way=>h(VoiceWay,{key:way.id,way,current:activeWay===way.id||way.id==='off'&&!spec,
        incomplete:way.id==='off'?'':incomplete(way),open:open===way.id,onUse:()=>use(way),onToggle:()=>toggle(way),
        count:way.id==='online'?onlineProviders(readiness.services).length:0,
        // Only a service that cannot speak says so (⚠ and why); the usual states (待机 / 运行中) are not written.
        state:way.id==='off'?null:(r=>r?.warn?r:null)(readiness(provider(way))),summary:way.id==='off'?'':summary(way),needed:needed(way),
        children:bodies[way.id]&&open===way.id?h(React.Fragment,null,fix(way),bodies[way.id]()):bodies[way.id]?true:null})))),
    spec&&h(StageSection,{title:'调音',meta:Object.keys(voicePresets(spec)).length,foldKey:'voice-tuning',className:'ap-voice-tuning'},
      h(VoicePresets,{...common,rows,active})),
    others&&h(VoiceOthers,{...common,onClose:()=>setOthers(false),setNotice}),
    shared&&h(VoiceSharedDialog,{figure,others:shared.others,onPick:pick=>{shared.resolve(pick);setShared(null);}}));
}
// The current voice — one focal point: its name and ⋯, how it speaks now (or ⚠ + what to do), 配音语言, and the 试听 line.
function VoiceHero({binding,pack,figure,spec,voice,sourceId,status,preview,rows,writer,notice,setNotice,readiness,openSettings,activeWay,summary,onOthers,onFix}) {
  const [renaming,setRenaming]=React.useState(false),language=spec?effectiveVoiceLanguage(voice.language,spec.language):'ja',[text,setText]=React.useState(null),[mood,setMood]=React.useState('calm');
  const othersItem=close=>h(MenuItem,{onClick:()=>{close();onOthers();}},'换成本包其他声音或模板…');
  // The machine-wide 「付费试听」 prompt (voicePaidAsk): ✓ while it asks; 「不再提示」 in that dialog clears it.
  const askItem=close=>{const on=voicePaidAsk.get();return h('button',{type:'button',role:'menuitemcheckbox','aria-checked':on,className:'ap-menu-item',onClick:()=>{close();voicePaidAsk.set(!on);}},
    h('span',null,'付费试听前确认'),on&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})));};
  if(!spec)return h('div',{className:'ap-voice-hero is-empty'},h(VoiceDisc,{empty:true}),h('div',{className:'ap-voice-id'},
      h('div',{className:'ap-voice-name-row'},h('strong',{className:'ap-voice-name'},'还没有声音'),
        h(Popover,{label:'声音操作',className:'ap-voice-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'声音操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,othersItem(close),askItem(close))}))),
    notice&&h('p',{className:'ap-notice',role:'status'},notice));
  const source=sourceId?spec.sources[sourceId]:null,issue=source?status?.issues?.[0]:null,way=VOICE_WAYS.find(w=>w.id===activeWay);
  const users=voiceUsers(pack,voice.voice).filter(f=>f.id!==figure.id),key='saved:'+figure.id,state=preview.of(key),sample=sampleText(language),said=text??sample;
  // A source chosen but not set up writes nothing here (R25): the disc is empty, 试听 is off, and its way
  // below has the amber radio with its settings open — before the host's status arrives too.
  const unset=!!voiceSourceUnset(source);
  const ready=source&&!issue&&!unset?readiness(way?.provider||source.provider):null,warn=unset?'':issue?voiceIssueText(issue.code,source):ready?.warn?ready.text:'';
  // 去设置 for a service problem (the 配音 page); 去修改 for a problem of this voice (its way opens below).
  const serviceFix=issue?['SERVICE_REQUIRED','CREDENTIALS_REQUIRED'].includes(issue.code):ready?.setup;
  const action=serviceFix&&openSettings?h(Button,{className:'ap-link',onClick:()=>openSettings(way?.provider||source.provider)},'去设置'):
    issue?.code==='MISSING_REFERENCE'&&way?h(Button,{className:'ap-link',onClick:()=>onFix(way.id)},'去修改'):null;
  const play=()=>source?.provider==='browser'?preview.playBrowser(key,{voice:source.voiceName,language,text:text!==null&&text.trim()?text.trim():sample},{mood}):preview.play(key,{packId:pack.manifest.id,figureId:figure.id,expectedRevision:pack.revision,...(text!==null&&text.trim()&&text!==sample?{text:text.trim()}:{}),mood},{label:spec.name,mood});
  const menu=h(Popover,{label:'声音操作',className:'ap-voice-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'声音操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
    h(MenuItem,{onClick:()=>{close();setRenaming(true);}},'重命名'),
    othersItem(close),
    h(MenuItem,{onClick:async()=>{close();if(await writer.saveTemplate())setNotice('已存为我的模板「'+spec.name+'」');}},'另存为我的模板'),
    askItem(close),
    h(MenuItem,{danger:true,onClick:()=>{close();preview.stop();writer.setBinding(null);}},'不用这个声音'))});
  return h('div',{className:'ap-voice-hero'},
    h(VoiceDisc,{playing:state?.phase==='playing',empty:unset}),
    h('div',{className:'ap-voice-id'},
      h('div',{className:'ap-voice-name-row'},renaming?h(CommitInput,{className:'ap-voice-name-input','aria-label':'声音名称',autoFocus:true,value:spec.name,maxLength:60,validate:v=>v.trim()?'':'名称不能为空',
          onCommit:v=>{setRenaming(false);writer.editVoice(s=>({...s,name:v.trim()}));},onBlur:()=>setRenaming(false)}):h('strong',{className:'ap-voice-name'},spec.name),menu),
      warn?h(VoiceWarn,{action},warn):h('span',{className:'ap-voice-line ap-voice-how'},!source?'不配音':way?.id==='online'&&!unset?'在线 TTS · '+summary(way):[way?.title||voiceSourceShort(source),way&&summary(way)].filter(Boolean).join(' · ')),
      users.length>0&&h('span',{className:'ap-voice-line'},users.map(f=>f.name).join('、')+' 也在用')),
    // 配音语言 is a one-line 「label (?) value」 row (InlineRow), like the
    // figure editor's 基础设定 and the 调音 parameters.
    h(InlineGrid,{label:'声音设置',columns:1,className:'ap-voice-props'},
      h(InlineRow,{label:'配音语言',help:h(Help,{text:VOICE_LANGUAGE_HELP,label:'配音语言 说明'}),className:'ap-voice-lang-row'},
        h(VoiceLanguagePick,{value:language,defaultValue:effectiveVoiceLanguage('',spec.language),label:'配音语言',onPick:l=>writer.patchBinding({language:l===effectiveVoiceLanguage('',spec.language)?undefined:l})}),
        source&&!unset&&!voiceSpeaks(source,language)&&h(VoiceWarn,null,'这个声音不会说'+voiceLanguageName(primaryLanguage(language))))),
    h('div',{className:'ap-voice-try',role:'group','aria-label':'试听'},
      h('input',{className:'ap-voice-try-text fork-edit','aria-label':'试听台词',value:said,maxLength:200,onChange:e=>setText(e.target.value)}),
      h(VoiceMoodPick,{rows,value:mood,onPick:setMood}),
      h('button',{type:'button',className:'ap-voice-go','aria-pressed':!!state&&state.phase!=='error',disabled:(!source||unset||(!!warn&&!issue?.field)||!binding.tts)&&!(state&&state.phase!=='error'),
          title:!binding.tts?'配音插件未启用':undefined,onClick:play},
        state?.phase==='loading'?h(Spinner,{key:'go'}):h(Glyph,{name:state&&state.phase!=='error'?'stop':'play'}),state&&state.phase!=='error'?'停止':'试听')),
    state?.phase==='error'&&h('p',{className:'ap-voice-try-error',role:'alert'},h(VoiceWarn,{action:VOICE_SERVICE_CODES.has(state.code)&&openSettings?h(Button,{className:'ap-link',onClick:()=>openSettings(way?.provider||source?.provider)},'去设置'):
      VOICE_EDIT_CODES.has(state.code)&&way?h(Button,{className:'ap-link',onClick:()=>onFix(way.id)},'去修改'):h(Button,{className:'ap-link',onClick:play},'重试')},'试听失败：'+state.error)),
    notice&&h('p',{className:'ap-notice',role:'status'},notice));
}
// ⋯ → 换成本包其他声音或模板…: the pack's other voices (a pick shares that voice) and 我的模板 (copied into the pack on use).
function VoiceOthers({binding,pack,figure,voice,writer,setError,setNotice,onClose}) {
  const library=pack.manifest.voiceLibrary?.voices||{},mine=voice?.voice||null,[removing,setRemoving]=React.useState(null);
  const templates=useVoiceLoad(()=>binding.service?.listVoiceTemplates?binding.service.listVoiceTemplates({}).then(r=>r.templates||[]):[],[binding]);
  const describe=s=>{const src=s?.sources?.[s.defaultSource];return src?voiceSourceLabel(src):'';};
  const use=async(job,label)=>{const done=await job();if(done){setNotice('已换成「'+label+'」');onClose();}};
  const remove=async t=>{try{await binding.service.deleteVoiceTemplate({templateId:t.templateId,expectedRevision:t.revision});templates.reload();}catch(e){setError(voiceErrorText(e));}};
  const voices=Object.entries(library).filter(([id])=>id!==mine);
  return h(Modal,{title:'换成其他声音',onClose,className:'ap-voice-dialog ap-voice-others'},
    h('h5',{className:'ap-voice-group'},'本包的声音'),
    voices.length?h('ul',{className:'ap-voice-rows'},voices.map(([id,s])=>{const users=voiceUsers(pack,id).map(f=>f.name);
      return h(VoiceRow,{key:id,name:s.name,meta:[describe(s),users.length?users.join('、')+' 在用':''].filter(Boolean).join(' · '),onUse:()=>use(()=>writer.setBinding({voice:id}),s.name)});})):
      h(EmptyState,{compact:true,text:'本包里没有别的声音'}),
    h('h5',{className:'ap-voice-group'},'我的模板',h(Help,{text:'模板存在这台电脑上，选用时整套复制进素材包，之后改模板不影响素材包。',label:'我的模板 说明'})),
    templates.error&&!templates.value?h(VoiceLoadError,{error:templates.error,retry:templates.reload}):!templates.value?h(VoiceLoading):
      templates.value.length?h('ul',{className:'ap-voice-rows'},templates.value.map(t=>h(VoiceRow,{key:'t:'+t.templateId,name:t.name,meta:t.voiceSpec?.sources?.[t.voiceSpec.defaultSource]?voiceSourceLabel(t.voiceSpec.sources[t.voiceSpec.defaultSource]):'',useLabel:'复制使用',onUse:()=>use(()=>writer.assignTemplate(t),t.name),
        menu:h(Popover,{label:'模板操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'模板操作 '+t.name,'aria-expanded':open,onClick:toggle}),content:close=>h(MenuItem,{danger:true,onClick:()=>{close();setRemoving(t);}},'删除模板…')})}))):
      h(EmptyState,{compact:true,noun:'模板'}),
    removing&&h(ConfirmDialog,{title:'删除模板「'+removing.name+'」？',body:'只删除这台电脑上的模板；已经用过它的素材包不受影响。',confirmLabel:'删除',danger:true,onConfirm:()=>remove(removing),onClose:()=>setRemoving(null)}));
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
function VoiceFishLibrary({binding,figure,spec:boundSpec,services,preview,candidate,choose,state,currentId}) {
  const [query,setQuery]=React.useState(''),[result,setResult]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),asked=React.useRef(0);
  const fish=services.first('fish-audio'),q=query.trim(),idLike=/^[A-Za-z0-9_-]{24,160}$/.test(q)&&!/\s/.test(q),needle=voiceNeedle(q);
  const answer=result&&result.query===q?result:null;
  const paging=useVoicePaging(answer?'fish:'+answer.ask:'popular:'+needle);
  const clear=()=>{setQuery('');setError('');};
  async function find(page=1){
    if(!q||busy)return;setBusy(true);setError('');
    const ask=page===1?++asked.current:asked.current;
    try{
      if(idLike){
        if(!fish){setResult({kind:'id',query:q,ask,voice:null,unchecked:true});return;}
        try{setResult({kind:'id',query:q,ask,voice:await voiceTts(binding).call('validateFishVoice',{serviceId:fish.id,voiceId:q})});}
        catch(e){if(voiceCode(e)!=='VOICE_NOT_FOUND')throw e;setResult({kind:'id',query:q,ask,voice:null,missing:true});}
      }else{
        if(!fish)throw voiceFailure('SERVICE_REQUIRED');
        const r=await voiceTts(binding).call('searchFishVoices',{serviceId:fish.id,query:q,page});
        setResult(prev=>({kind:'search',query:q,ask,page:r.page,hasMore:!!r.hasMore,windowLimited:!!r.windowLimited,voices:page>1&&prev?.kind==='search'?[...prev.voices,...(r.voices||[])]:r.voices||[]}));
      }
    }catch(e){setError(voiceCode(e)==='SERVICE_REQUIRED'?'还没有配置 Fish Audio 服务，不能搜索':voiceErrorText(e));}finally{setBusy(false);}
  }
  const meta=v=>[VOICE_GENDERS[v.gender],(v.languages||[]).map(voiceLanguageName).join(' / ')].filter(Boolean).join(' · ');
  // ▶ plays the voice model's own official sample (Fish samples[].audio →
  // sampleUrl) — free, no synthesis, no billing question; only a voice without one is synthesised (the paid-preview gate).
  const play=(v,key,spec,name)=>h(VoicePlay,{state:preview.of(key),label:'试听「'+name+'」',
    onClick:()=>v.sampleUrl&&fish?preview.playSample(key,{serviceId:fish.id,voiceId:v.voiceId}):preview.play(key,candidate(spec),{label:name})});
  const popularRow=v=>{
    const key='fish:'+v.voiceId,name=v.name&&v.name!==v.voiceId?v.name:v.voiceId===currentId?boundSpec.name:'Fish 声音',spec=fishVoiceSpec({...v,name},name);
    const heat=[voiceCount(v.likeCount)&&voiceCount(v.likeCount)+' 赞',voiceCount(v.taskCount)&&voiceCount(v.taskCount)+' 次使用'].filter(Boolean).join(' · ');
    return h(VoiceRow,{key:v.voiceId,name,meta:meta(v),tags:[heat,(v.toneTags||[]).slice(0,4).join(' · ')].filter(Boolean).join(' · '),
      current:v.voiceId===currentId,title:v.licenseNote||undefined,warn:v.verification?.status==='failed'&&h(VoiceWarn,null,'试合成失败'),
      play:play(v,key,spec,name),onUse:()=>choose(spec,name)});
  };
  const foundRow=(v,i)=>{const id=v.voiceId,key='fish:'+id,spec=fishVoiceSpec(v,figure.name+'的声音'),name=v.name||'Fish 声音';
    return h(VoiceRow,{key:id+':'+i,name,meta:meta(v),tags:(v.toneTags||[]).slice(0,3).join(' · '),current:id===currentId,title:v.licenseNote||undefined,
      play:play(v,key,spec,name),onUse:()=>choose(spec,spec.name)});};
  // The list under the box: Fish's answer for these words, else the popular voices this text matches.
  let list=null;
  if(answer?.kind==='id')list=answer.missing?h('p',{className:'ap-voice-line-warn',role:'alert'},h(VoiceWarn,null,'没有找到这个编号，请检查是否复制完整')):
    h('ul',{className:'ap-voice-rows','aria-label':'编号查找结果'},answer.voice?foundRow(answer.voice,0):
      h(VoiceRow,{name:'Fish 声音',meta:'还没有配置 Fish Audio 服务，暂时不能核对这个编号',onUse:()=>choose(fishVoiceSpec({voiceId:answer.query,name:'',languages:[]},figure.name+'的声音'),figure.name+'的声音')}));
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
  return h('div',{className:'ap-voice-fish'},
    h('div',{className:'ap-voice-search',role:'search'},
      h(SearchBox,{bare:true,label:'搜索 Fish 声音',value:query,placeholder:'搜名字、标签或语言，或粘贴声音编号',spellCheck:false,onChange:v=>{setQuery(v);setError('');},onKeyDown:voiceSearchKeys(query,clear,()=>find())}),
      h(Button,{className:'ap-chip-button ap-voice-find',disabled:!q||busy,onClick:()=>find()},busy?h(Spinner,{key:'find'}):h(Glyph,{name:'search'}),idLike?'查找编号':'搜索')),
    error&&h(VoiceLoadError,{error}),
    list);
}
// (3) 在线 TTS: one row per online service — 通义千问 / Azure / 火山引擎 (listed
// before they are set up), then every custom (OpenAI 兼容) service added in 配音 settings, under its own name. A row says its
// state at once from the TTS `services` snapshot (未设置 / 已设置 / 就绪 / 正在检查… / ⚠ 需要密钥 / ⚠ 连不上); its voices are read
// only when it is opened (▶ previews, 使用 picks). The dashed ＋ adds a custom service in 配音 settings. A preset source names the
// provider kind, not the service: with several custom services the figure speaks with the default one (引擎设置 › 配音服务),
// so the others say so instead of offering voices.
// 浏览器朗读: the system's own voices, free and always set up.
const ONLINE_BUILTIN=['qwen','azure','volcengine','browser'];
const customServices=raw=>(raw?.configured||[]).filter(c=>c.kind==='openai-compatible');
function onlineProviders(raw){
  return [...ONLINE_BUILTIN.map(kind=>({key:kind,kind,name:providerName(kind)})),
    ...customServices(raw).map(c=>({key:'service:'+c.id,kind:'openai-compatible',name:c.label||providerName('openai-compatible'),serviceId:c.id,custom:true}))];
}
// The name a saved online source reads as: the built-in service, or the one custom service's own name.
function onlineSourceName(source,raw){
  if(source?.provider!=='openai-compatible')return providerName(source?.provider);
  const custom=customServices(raw);
  return custom.length===1&&custom[0].label||providerName('openai-compatible');
}
// A row's state (null while the snapshot is read): plain words; ⚠ only when something must be fixed (with the reason).
function onlineRowState(raw,row){
  if(row.kind==='browser')return voiceReadiness(raw,'browser')||{text:'免费'};
  if(!raw)return null;
  const mine=(raw.configured||[]).filter(c=>row.custom?c.id===row.serviceId:c.kind===row.kind),ids=mine.map(c=>c.id);
  const live=(raw.running||[]).filter(r=>ids.includes(r.id)||!row.custom&&r.kind===row.kind),is=s=>live.some(r=>r.status?.state===s);
  if(!mine.length&&!live.length)return {setup:true,missing:true,text:'未设置'};
  if(is('ready'))return {text:'就绪'};
  if(is('credentials-required')||!row.custom&&mine.length>0&&mine.every(c=>Object.values(c.secrets||{}).some(x=>x&&x.configured===false)))return {warn:true,setup:true,key:true,text:'需要密钥'};
  const failed=mine.find(c=>c.check?.status==='error')||live.find(r=>['offline','error'].includes(r.status?.state));
  if(failed)return {warn:true,setup:true,text:'连不上',reason:failed.check?.message||failed.status?.error||''};
  if(is('checking'))return {checking:true,text:'正在检查…'};
  return {text:'已设置'};
}
function VoiceOnline(props) {
  const {binding,active,inUse,needed,readiness,openSettings}=props,raw=readiness.services,rows=onlineProviders(raw),several=customServices(raw).length>1;
  // Several custom services: only the default one (引擎设置 › 配音服务) can speak for a figure. Read only in that case.
  const engine=useVoiceLoad(()=>several&&binding.rpc?binding.rpc('getAssetEngineSettings'):null,[binding,several]);
  const chosen=engine.value?.values?.voiceServices?.['openai-compatible']||null;
  const blocked=row=>row.custom&&several&&!!(engine.value||engine.error)&&row.serviceId!==chosen;
  const mine=row=>!!active&&active.provider===row.kind&&(!row.custom||!several||row.serviceId===chosen);
  // The service in use opens; chosen but no voice picked yet (`needed`), the first service that can speak opens with its
  // voices to pick from (R25: the next step is on screen, not written); any other row opens only when asked.
  const usable=row=>{const s=onlineRowState(raw,row);return !!s&&!s.warn&&!s.missing&&!blocked(row);};
  // '@auto' until a row is opened or closed by hand.
  const [open,setOpen]=React.useState('@auto');
  const openKey=open==='@auto'?(active?rows.find(mine):needed?rows.find(usable):null)?.key||null:open;
  return h('div',{className:'ap-voice-online'},
    h('ul',{className:'ap-voice-providers','aria-label':'在线语音服务'},
      rows.map(row=>{
        const isOpen=openKey===row.key,here=inUse&&mine(row),stop=blocked(row),word=stop?{warn:true,text:'未设为默认'}:onlineRowState(raw,row);
        // Written: the voice in use, ⚠ and why, or 正在检查…; a service not set up reads dimmed instead of 「未设置」, and
        // 已设置 / 就绪 are the normal case, not written (R25).
        const text=word?.warn?word.text:[here&&active.voiceName?voiceDisplayName(active.voiceName):'',word?.checking?word.text:''].filter(Boolean).join(' · ');
        const body='ap-voice-provider-'+row.key.replace(/[^A-Za-z0-9_-]/g,'-');
        return h('li',{key:row.key,className:'ap-voice-provider','data-open':isOpen||undefined,'data-current':here||undefined,'data-missing':word?.missing||undefined},
          h('button',{type:'button',className:'ap-voice-provider-head','aria-expanded':isOpen,'aria-controls':isOpen?body:undefined,
              'aria-label':row.name+(here?'，使用中':'')+(word?.text?'，'+word.text:''),onClick:()=>setOpen(isOpen?null:row.key)},
            h('span',{className:'ap-voice-provider-name'},row.name),
            h('span',{className:'ap-voice-provider-state'+(word?.warn?' is-warn':''),title:word?.reason||undefined},word?.warn&&h(Glyph,{name:'warning'}),text),
            h(Glyph,{name:'chevDown'})),
          isOpen&&h('div',{id:body,className:'ap-voice-provider-body'},h(VoiceProviderVoices,{...props,row,state:word,blocked:stop,current:mine(row)})));
      }),
      openSettings&&h('li',{className:'ap-voice-provider-add-row'},
        h(CatAddTile,{label:'添加在线语音服务',className:'ap-cat-add-row ap-voice-provider-add',onClick:()=>openSettings('openai-compatible',{add:true})}))));
}
// One opened service: what stops it (⚠ + 去设置), its 型号, the voice list (▶ · 使用) — or, for a custom service that lists no
// voices, the 型号 / 音色 typed in by name.
function VoiceProviderVoices({binding,figure,services,preview,candidate,choose,active,row,state,blocked,current,openSettings}) {
  const provider=row.kind,name=row.name,custom=!!row.custom,serviceId=custom?row.serviceId:services.first(provider)?.id;
  const own=current&&active?.provider===provider?active:null;
  const [filter,setFilter]=React.useState(''),[lang,setLang]=React.useState('all'),[model,setModel]=React.useState(own?.model||''),[all,setAll]=React.useState(false),[typed,setTyped]=React.useState('');
  const [inspectedVoice,setInspectedVoice]=React.useState('');
  const modelStatus=useVoiceModelStatus(binding,{provider,model,voiceName:inspectedVoice||own?.voiceName||''},preview.state?.phase);
  const browser=provider==='browser';
  const list=useVoiceLoad(()=>blocked?null:browser?browserSpeechVoiceList(window.speechSynthesis).then(voices=>({voices})):custom?voiceTts(binding).call('providerVoices',{serviceId}):voiceTts(binding).call('listOnlinePresetVoices',{provider,...(serviceId?{serviceId}:{})}),[binding,provider,serviceId,blocked]);
  const failed=list.value?.status==='error',voices=failed?[]:list.value?.voices||[],models=(failed?[]:list.value?.models||[]).map(m=>typeof m==='string'?{id:m,label:m}:{id:m.id,label:m.label||m.id});
  // A custom service needs a 型号 (OpenAI speech `model`): the listed first one unless another is picked or typed.
  const useModel=model||(custom?models[0]?.id||'':'');
  const needle=filter.trim().toLowerCase(),shown=voices.filter(v=>(lang==='all'||(v.languages||[]).some(l=>String(l).split('-')[0]===lang))&&(!needle||[v.label,v.id,...(v.styles||[])].some(x=>String(x||'').toLowerCase().includes(needle))));
  const sid=custom?'custom':provider;
  const spec=v=>({name:v.label||v.id,language:pickVoiceLanguage(browser?(v.languages||[]).map(primaryLanguage):v.languages,figure.voice?'ja':'zh'),defaultSource:sid,sources:{[sid]:{kind:'preset',provider,voiceName:v.id,...(useModel?{model:useModel}:{})}}});
  const on=v=>!!own&&own.voiceName===v.id;
  const goSet=openSettings&&h(Button,{className:'ap-link',onClick:()=>openSettings(provider,custom?{id:serviceId}:undefined)},'去设置');
  const warn=browser&&state?.warn?h(VoiceWarn,null,state.text):blocked?h(VoiceWarn,null,'有多个自定义服务时，人物只用默认的那个；在引擎设置的「配音服务」里选默认'):
    state?.missing?h(VoiceWarn,{action:goSet},('还没有配置'+spacedName(name)+'服务').trimEnd()):
    state?.key||list.value?.status==='credentials-required'?h(VoiceWarn,{action:goSet},('缺少'+spacedName(name)+'密钥').trimEnd()):
    state?.warn?h(VoiceWarn,{action:goSet},spacedName(name).trimStart()+'连不上'+(state.reason?'：'+state.reason:'')):null;
  if(blocked)return warn;
  const row1=v=>{const key=provider+':'+(serviceId||'')+':'+v.id+':'+useModel;
    return h(VoiceRow,{key:v.id,name:v.label||v.id,warn:(inspectedVoice||own?.voiceName)===v.id&&h(VoiceConfirmedWarning,{issues:modelStatus.value?.issues,field:'voice'}),meta:[VOICE_GENDERS[v.gender],(v.languages||[]).map(voiceLanguageName).filter((x,i,a)=>a.indexOf(x)===i).slice(0,3).join(' / ')].filter(Boolean).join(' · '),tags:v.styles?.length?v.styles.length+' 种风格':'',current:on(v),
      play:h(VoicePlay,{state:preview.of(key),label:'试听「'+(v.label||v.id)+'」',disabled:custom&&!useModel,title:custom&&!useModel?'先填写型号':undefined,onClick:()=>{setInspectedVoice(v.id);if(browser)preview.playBrowser(key,{voice:v.id,language:v.languages?.[0],text:sampleText(primaryLanguage(v.languages?.[0]||'zh'))});else preview.play(key,candidate(spec(v)),{label:v.label||v.id});}}),
      onUse:custom&&!useModel?null:()=>choose(spec(v),v.label||v.id)});};
  const modelPick=models.length>0&&(provider==='qwen'||custom)&&h(Popover,{label:name+'型号',className:'ap-voice-model-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick','aria-label':'型号：'+(useModel||'服务默认'),'aria-expanded':open,onClick:toggle},h('span',null,useModel?models.find(m=>m.id===useModel)?.label||useModel:'服务默认型号'),h(Glyph,{name:'chevDown'})),
    content:close=>[...(custom?[]:[{id:'',label:'服务默认型号'}]),...models].map(m=>h('button',{key:m.id||'default',type:'button',role:'menuitemradio','aria-checked':useModel===m.id,className:'ap-menu-item',onClick:()=>{close();setModel(m.id);}},h('span',null,m.label),useModel===m.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
  // A custom service without a voice list: 型号 and 音色 by name (the endpoint's own words, e.g. tts-1 / alloy).
  const manual=custom&&!!list.value&&!failed&&!voices.length;
  return h(React.Fragment,null,
    warn,
    (modelPick||voices.length>12)&&h('div',{className:'ap-voice-tools'},
      modelPick,
      h(VoiceConfirmedWarning,{issues:modelStatus.value?.issues,field:'model'}),
      voices.length>12&&h(SearchBox,{bare:true,inputClassName:'ap-voice-filter',label:'筛选'+name+'声音',value:filter,placeholder:'筛选',onChange:v=>{setFilter(v);setAll(false);}}),
      voices.length>12&&h(Segmented,{className:'ap-voice-langs',label:'按语言筛选',value:lang,onChange:id=>{setLang(id);setAll(false);},options:[['all','全部'],['zh','中文'],['ja','日语'],['en','英语']]})),
    // A failed read (or a refresh that kept the built-in catalogue, \message\) says so above whatever list there is.
    (list.error||failed)&&h(VoiceLoadError,{error:list.error||'读不到这个服务的声音列表',retry:list.reload}),
    !list.value?(list.error?null:h(VoiceLoading)):failed?null:
    manual?h(React.Fragment,null,
        h(InlineGrid,{label:name+'的声音',columns:1},
          !models.length&&h(InlineField,{kind:'text',label:'型号',value:model,placeholder:'例：tts-1',maxLength:160,onCommit:v=>setModel(v.trim())}),
          h(InlineField,{kind:'text',label:'音色',value:typed,placeholder:'例：alloy',maxLength:160,onCommit:v=>setTyped(v.trim())})),
        typed&&h('ul',{className:'ap-voice-rows'},row1({id:typed,label:typed,languages:[]}))):
    !shown.length?(voices.length?h(EmptyState,{noun:'声音',query:filter,filter:lang!=='all'?{zh:'中文',ja:'日语',en:'英语'}[lang]:'',onClear:()=>{setFilter('');setLang('all');setAll(false);}}):h(EmptyState,{text:'这个服务没有可选的声音',icon:h(Glyph,{name:'voice'})})):
      h(React.Fragment,null,h('ul',{className:'ap-voice-rows'},(all?shown:shown.slice(0,30)).map(row1)),
        !all&&shown.length>30&&h(Button,{className:'ap-link ap-voice-more',onClick:()=>setAll(true)},'显示全部 '+shown.length+' 个')));
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
// (4) Fish 克隆: Fish's ordered reference list — the whole list, in this order, is sent with every line. Clips never switch
// the figure to it and deleting the last one never switches it away (the way's radio is the only 「使用」).
// With no clips the dashed ＋ is highlighted as the next step.
function VoiceReferences({binding,pack,figure,spec,voice,writer,preview,entry,clips}) {
  const [sid,source]=entry||[],language=spec?effectiveVoiceLanguage(voice?.language,spec.language):'ja',refs=source?.references||[];
  const add=files=>writer.addClips(files,{language,create:refs=>cloneSpec(figure,language,refs),
    place:(s,refs)=>{const found=Object.entries(s.sources).find(([,x])=>x.kind==='reference-list');if(found){found[1].references=[...found[1].references,...refs];return;}
      s.sources[freeSourceId(s,'fish','reference')]={kind:'reference-list',provider:'fish-audio',references:refs};}});
  return h('div',{className:'ap-voice-refs'},
    h(VoiceClipList,{binding,pack,refs,label:'参考音频',clips,preview,disabled:writer.busy>0,needed:true,onAdd:add,
      onChange:next=>writer.editVoice(s=>{s.sources[sid].references=next;return s;})}));
}
// the shared Slider; double click returns to the voice's own value.
function TuneSlider({def,value,label,onCommit}) {
  return h(Slider,{className:'ap-tune',label,min:def.min,max:def.max,step:def.step,value,reset:def.base,valueText:v=>tuneText(def,v),output:v=>tuneText(def,v),outputClassName:'ap-tune-value',onCommit});
}
// 调音: the tunings of the figure's own voice as tiles (原声, then the author's). A click uses one (the binding's variant); the
// one in use carries ⋯ (调整参数 / 重命名 / 删除); the dashed ＋ saves the current settings as a new tuning. 按差分调音 maps
// emotions to tunings (the v4 binding's emotionVariants). Other pack voices and 我的模板 are in the voice's ⋯ (VoiceOthers).
function VoicePresets({binding,pack,figure,spec,voice,sourceId,writer,rows,active}) {
  const currentVoice=voice.voice,currentPreset=voice.variant||'normal';
  const [editing,setEditing]=React.useState(false),[renaming,setRenaming]=React.useState(false),[byMood,setByMood]=React.useState(!!voice.emotionVariants);
  const presetNames=Object.keys(voicePresets(spec));
  const entries=presetNames.map(pid=>({presetId:pid,name:presetName(spec,pid),current:pid===currentPreset}));
  const pick=e=>{if(e.current)return;setEditing(false);setRenaming(false);return writer.patchBinding({variant:e.presetId==='normal'?undefined:e.presetId});};
  const save=(id,next)=>writer.editVoice(s=>{s.variants={...(s.variants||{}),[id]:next};return s;},{id});
  const own=voicePresets(spec)[currentPreset]||voicePresets(spec).normal;
  const add=async()=>{const id='t'+Date.now().toString(36),n=Object.keys(spec.variants||{}).filter(k=>k!=='normal').length+1;
    if(await save(id,{name:'预设 '+n,...(own.tuning?{tuning:structuredClone(own.tuning)}:{})})){await writer.patchBinding({variant:id});setEditing(true);setRenaming(true);}};
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
            content:close=>h(React.Fragment,null,h(MenuItem,{onClick:()=>{close();setEditing(v=>!v);}},editing?'收起参数':'调整参数'),h(MenuItem,{onClick:()=>{close();setRenaming(true);}},'重命名'),
              h(MenuItem,{danger:true,disabled:e.presetId==='normal',title:e.presetId==='normal'?'原声不能删除':undefined,onClick:()=>{close();setEditing(false);writer.deleteVariant(e.presetId);}},'删除'))}));}),
      h('li',{className:'ap-voice-preset-add-row'},h('button',{type:'button',className:'ap-voice-preset-add','aria-label':'把当前设置存为新预设',title:'把当前设置存为新预设',onClick:add},h(Glyph,{name:'plus'})))),
    editing&&h(VoicePresetParams,{binding,spec,voice,sourceId,active,save,preset:currentPreset}),
    h('div',{className:'ap-voice-bymood'},
      h('button',{type:'button',className:'ap-voice-subhead','aria-expanded':byMood,onClick:()=>setByMood(v=>!v)},h('span',null,'按差分调音'),h('span',{className:'ap-voice-way-sum'},voice.emotionVariants?Object.keys(voice.emotionVariants).length+' 种差分':''),h(Glyph,{name:'chevDown'})),
      byMood&&h('ul',{className:'ap-voice-moods','aria-label':'按差分调音'},rows.map(r=>{const value=voice.emotionVariants?.[r.id]||'';
        return h('li',{key:r.id,className:'ap-voice-mood-row'},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',{className:'ap-voice-mood-name'},r.label),
          h(Popover,{label:r.label+'调音',trigger:({toggle,open:o})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick','aria-label':r.label+'调音：'+(value?presetName(spec,value):'跟随默认'),'aria-expanded':o,onClick:toggle},h('span',null,value?presetName(spec,value):'跟随默认'),h(Glyph,{name:'chevDown'})),
            content:close=>[['','跟随默认'],...presetNames.map(id=>[id,presetName(spec,id)])].map(([id,label])=>h('button',{key:id||'follow',type:'button',role:'menuitemradio','aria-checked':value===id,className:'ap-menu-item',
              onClick:()=>{close();if(value===id)return;const map={...(voice.emotionVariants||{})};if(id)map[r.id]=id;else delete map[r.id];writer.patchBinding({emotionVariants:Object.keys(map).length?map:undefined});}},label))}));}))));
}
// The figure's preset parameters (⋯ → 调整参数): the current 配音来源's own (Fish: 语速; Azure: 语速 / 音高 / 风格; Qwen: 风格指令).
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
      h(InlineRow,{key:def.key,label:def.label},h('span',{className:'ap-voice-na'},'未使用',h(Help,{text:'当前型号不支持风格或情绪指令，已保存的指令不会发送。',label:'风格指令未使用说明'})));
    if(def.kind==='style')return styles.length?h(InlineField,{key:def.key,kind:'menu',label:def.label,controlLabel:'风格',value:tuning.style||'',options:['',...styles].map(st=>({value:st,label:st||'默认'})),onCommit:st=>setParam('style',st||null)}):null;
    return h(InlineRow,{key:def.key,label:def.label,className:'ap-voice-tune-row'},h(TuneSlider,{def,value:Number.isFinite(tuning[def.key])?tuning[def.key]:def.base,label:name+def.label,onCommit:v=>setParam(def.key,v===def.base?null:v)}));
  };
  // One label column for every parameter (sliders, 风格, 风格指令, the not-supported lines): InlineGrid rows.
  return h(InlineGrid,{label:name+'的参数',columns:1,className:'ap-voice-tune-props'},
    defs.map(control),
    !defs.length&&h(InlineRow,{label:'参数'},h('span',{className:'ap-voice-na'},'这个配音来源使用原声参数')));
}