// a figure's 声音: the figure page's 「声音」 tab — 「配音」 on / off, the voice it speaks with
// (the 通用声音 until it has one of its own) with ▶, its name ⌄ (选择声音: one list — 通用声音, this pack, the other packs,
// ＋ 添加声音) and where it comes from, the 试听 line; for a voice that clones, its 参考音频. 舞台设置 › 配音 uses the same
// 选择声音 and 添加声音 for the 通用声音 / 旁白 rows.
// Opening, choosing or saving never synthesizes; ▶ does, and a paid or unknown-cost preview asks first (billing confirm).
// Missing service / key / voice → ⚠ and why, with the way to 语音后端; nothing silently switches service.
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
// every 配音来源 can be chosen before it is set up; what a chosen source still
// lacks, in plain words for screen readers only (R25: on screen the page shows it — an amber radio, the
// empty field highlighted, 试听 off; the host answers MISSING_REFERENCE / VOICE_NOT_FOUND for it).
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
const VOICE_BACKEND_LINK='去语音后端设置 ›';
const VOICE_GUIDANCE_MAX=60,VOICE_GUIDANCE_HELP='自动素材的舞台助手给人物找声音时，会在所有已安装素材包的声音里，按「名称」和这句话搜关键词。写这个声音适合什么样的人，如「适合中年男性」「毒舌少女」，助手才搜得到、挑得对。';
const VOICE_LANGUAGE_HELP='不是中文时，AI 会为这个角色额外写一句这门语言的台词用来配音，画面上仍显示中文。';
const pickVoiceLanguage=(list,fallback='zh')=>(list||[]).map(l=>String(l).toLowerCase()).find(l=>VOICE_LANGUAGE_TAG.test(l))||fallback;
const figureVoiceSpec=(pack,figure)=>figure.voice?pack.manifest.voiceLibrary?.voices?.[figure.voice.voice]||null:null;
// The language a figure's voice speaks (effectiveVoiceLanguage: its own choice, else the voice's).
const figureVoiceLanguage=(spec,voice)=>effectiveVoiceLanguage(voice?.language,spec?.language);
// 可选声音 preset 「默认」 of a voice catalogue (listVoiceCatalogue): the installed pack voices voiceAutoCast offers.
const defaultCastVoices=catalogue=>(catalogue?.voices||[]).filter(v=>v.ref.packId&&voiceAutoCast(v.voiceSpec));
const voiceSourceId=(spec,binding)=>binding?.source===null?null:binding?.source??spec.defaultSource;
const voiceUsers=(pack,voiceId)=>Object.values(pack.figures||{}).filter(f=>f.voice?.voice===voiceId);
// The catalog's set-up services (浏览器朗读 is its own); a service that offers no source kind is not listed.
const catalogServices=catalog=>(catalog?.services||[]).filter(s=>s.kind!=='browser'&&s.sources.length);
const voiceSourceLabel=source=>source.provider==='browser'?'浏览器朗读':providerName(source.provider)+(source.kind==='reference-list'?' · 参考音频克隆':source.kind==='voice-id'?' · 声音库':'');
// The state of a service in 添加声音, in the words of 语音后端 (one set for every service): null, or ⚠ and why. A service not
// checked yet is fine (a local server that idles starts when used). 浏览器朗读: ⚠ only on a device that cannot speak.
const SERVICE_STATE_WORDS={'needs-key':'缺少 API Key','invalid-key':'API Key 无效',stopped:'未启动',rejected:'访问被拒绝',offline:'连不上'};
function voiceServiceState(service){
  if(service.kind==='browser')return typeof window==='undefined'||!window.speechSynthesis?{warn:true,text:'这台设备不支持'}:null;
  const word=SERVICE_STATE_WORDS[service.state];
  return word?{warn:true,setup:true,text:word}:null;
}
// Azure voice names read as the voice (en-US-AshleyNeural → Ashley), not as an internal id.
const voiceDisplayName=name=>String(name||'').replace(/^[a-z]{2,3}-[A-Z]{2}-/,'').replace(/(?:Multilingual)?Neural$/,'')||name;
const sampleText=language=>VOICE_SAMPLES[String(language).split('-')[0]]||VOICE_SAMPLES.en;
const freeSourceId=(spec,...names)=>{for(const n of names)if(!spec.sources[n])return n;let i=2;while(spec.sources[names[0]+i])i++;return names[0]+i;};
const voiceBytes=n=>!Number.isFinite(n)?'':n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(n<10*1024*1024?1:0)+' MB';
const voiceSeconds=s=>!Number.isFinite(s)?'':s<60?(Math.round(s*10)/10)+' 秒':Math.floor(s/60)+' 分 '+Math.round(s%60)+' 秒';
const tuneText=(def,v)=>def.unit==='x'?Number(v).toFixed(2)+'×':(v>0?'+':'')+v+'%';
const cleanBinding=b=>{const next={...b};for(const k of Object.keys(next))if(next[k]===undefined)delete next[k];return next;};
const cloneSpec=(figure,language,references)=>({name:figure.name+'的声音',language,defaultSource:'fish',sources:{fish:{kind:'reference-list',provider:'fish-audio',references}}});
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
// 「付费试听」 asks before the first paid preview; 「今后不再显示」 there is one machine-wide UI preference (localStorage like the
// panel's other UI preferences, never per card). No menu item to turn it back on.
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
        // 「今后不再显示」 once chosen: the same one-time token is sent back at once (the host still gates every paid preview).
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
// `service`: the billed service and model (「Fish Audio · Drama 3（计费）」). 「今后不再显示」 applies on 确认试听 only.
function VoiceBillingDialog({label,service,notice,onConfirm,onCancel}) {
  const [quiet,setQuiet]=React.useState(false);
  return h(Modal,{title:'付费试听',onClose:onCancel,closable:false,className:'ap-confirm ap-voice-dialog'},
    h('p',null,(notice?notice+' ':'')+'试听'+(label?'「'+label+'」':'')+'会用'+spacedName(service)+'合成一句短句，按服务价格计费一次。'),
    h('button',{type:'button',role:'checkbox','aria-checked':quiet,className:'ap-check-row ap-voice-quiet',onClick:()=>setQuiet(v=>!v)},
      h('span',{className:'ap-check-mark','aria-hidden':true},quiet&&h(Glyph,{name:'check'})),h('span',null,'今后不再显示')),
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
    const apply=(how,make)=>run(async c=>{
    const b=c.figures[figureId].voice,id=b.voice,spec=make(structuredClone(c.manifest.voiceLibrary.voices[id])),used=voiceUsers(c,id).some(f=>f.id!==figureId);
    if(how==='copy')return copyFor(c,spec,b);
    return svc.savePackVoice({packId,figureId,expectedRevision:c.revision,voiceId:id,voiceSpec:spec,...(used?{confirmShared:true}:{})});
  });
  const editVoice=async make=>{const how=await scope();return how?apply(how,make):null;};
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
  // Another pack's voice: copied into this pack (its clips too) for the figure.
  const copyPackVoice=ref=>run(c=>svc.assignPackVoiceCopy({sourcePackId:ref.packId,voiceId:ref.voiceId,packId,figureId,expectedRevision:c.revision}));
  // 模型 of one source (a Fish row's own choice).
  const setSourceModel=(sid,model)=>editVoice(s=>{s.sources[sid]={...s.sources[sid],model};return s;});
  // 语音服务 of one source: the same voice spoken by another service of its kind; a 模型 that service does not offer goes.
  const setSourceService=(sid,service)=>editVoice(s=>{const src={...s.sources[sid],serviceId:service.id};
    if(src.model&&!(service.models||[]).some(m=>m.id===src.model))delete src.model;s.sources[sid]=src;return s;});
  // 配音 on / off: a voice of its own keeps it (source null = silent); a figure on the 通用声音 is {source:null} while off.
  const setVoiced=on=>run(c=>{const b=c.figures[figureId].voice||null;
    const next=b?.voice?cleanBinding({...b,source:on?undefined:null}):on?null:{source:null};
    return JSON.stringify(next)===JSON.stringify(b)?{status:'noop'}:svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:next});});
  // 选择声音: the 通用声音 drops the figure's own voice; a voice of this pack is pointed at; another pack's voice
  // is copied into the pack first. (No 我的模板: another pack's voice is that already.)
  const pick=choice=>choice.kind==='general'?setBinding(null):choice.kind==='own'?setBinding({voice:choice.id}):copyPackVoice(choice.ref);
  // 录音克隆's clips (prepareVoiceClip results), each with what it says: into the pack, in order → its reference list.
  async function uploadClips(medias,meta){
    const refs=[];
    for(const [i,media] of medias.entries()){
      const blob=await run(c=>svc.putBlob({packId,expectedRevision:c.revision,bytes:media.bytes,descriptor:media.descriptor}));
      if(!blob)return null;refs.push({media:blob.hash,text:meta[i].text||'',language:meta[i].language});
    }
    return refs;
  }
  return {busy,run,setBinding,patchBinding,createVoice,editVoice,addClips,copyPackVoice,setSourceModel,setSourceService,setVoiced,pick,uploadClips};
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
function VoiceMoodPick({rows,value,onPick,prefix}) {
  const row=rows.find(r=>r.id===value)||rows[0];
  if(!row)return null;
  return h(Popover,{label:'试听差分',float:true,fit:true,className:'ap-voice-mood-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-mood','aria-label':'试听差分：'+row.label,'aria-expanded':open,onClick:toggle},prefix&&h('span',{className:'ap-voice-mood-prefix'},prefix),h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,row.label),h(Glyph,{name:'chevDown'})),
    content:close=>rows.map(r=>h('button',{key:r.id,type:'button',role:'menuitemradio','aria-checked':r.id===row.id,className:'ap-menu-item',onClick:()=>{close();onPick(r.id);}},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,r.label),r.id===row.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// A 配音语言 as one short square in a voice row (中 / 日 / 英 …); the full name is its tooltip.
const VOICE_LANGUAGE_SHORT={zh:'中',ja:'日',en:'英',ko:'韩',yue:'粤',fr:'法',de:'德',es:'西',it:'意',pt:'葡',ru:'俄'};
function VoiceLangChip({tag}) {
  const p=primaryLanguage(tag),name=voiceLanguageName(p);
  return h('span',{className:'ap-vx-lang',title:name,'aria-label':name},VOICE_LANGUAGE_SHORT[p]||p.toUpperCase());
}
// Who speaks with a voice: up to three faces (this pack's figures by their face; another pack's by colour). None: nothing.
function VoiceFaces({binding,pack,figures,users}) {
  const list=figures?figures.map(f=>({key:f.id,name:f.name,el:h(FigureCastFace,{binding,packId:pack.manifest.id,figure:f,sprites:pack.sprites,avatar:figureAvatar(f,pack.sprites),label:f.name,className:'ap-vx-face',frame:'face'})})):
    (users||[]).map(u=>({key:u.id,name:u.name,el:h(Silhouette,{figure:u,className:'ap-vx-face'})}));
  if(!list.length)return null;
  const names=list.map(x=>x.name).join('、')+' 在用';
  return h('span',{className:'ap-vx-faces',role:'img','aria-label':names,title:names},list.slice(0,3).map(x=>h(React.Fragment,{key:x.key},x.el)));
}
// The part of a name a search matched, in the accent colour (a plain substring; a width / 繁简 match is found but not marked).
function VoiceMarked({text,query}) {
  const at=query?String(text).toLowerCase().indexOf(query.toLowerCase()):-1;
  if(at<0)return text;
  return h(React.Fragment,null,text.slice(0,at),h('mark',null,text.slice(at,at+query.length)),text.slice(at+query.length));
}
// The one voice row (选择声音, 添加声音, 可选声音): ▶ · name · 语言 square · meta · end (heat, faces, ✓). A click on the row
// picks it (`onPick`); ▶ only plays. `menu` (R9): the row's own menu — right click, Shift+F10, or a long press on touch
// (useContextMenu, the library's one row menu).
function VoiceListRow({name,query,lang,meta,end,current,picked,play,onPick,menu,label}) {
  const rowMenu=useContextMenu({label:name+' 操作',content:menu||null});
  return h('li',{className:'ap-vx-row','data-current':current||undefined,'data-picked':picked||undefined},
    play||h('span',{className:'ap-vx-row-pad','aria-hidden':true}),
    h('button',{type:'button',className:'ap-vx-row-main','aria-label':label||name,'aria-current':current||undefined,'aria-pressed':picked===undefined?undefined:!!picked,
      ...mergeProps(rowMenu.target,rowMenu.trigger),onClick:()=>onPick?.()},
      // ✓ follows the name, so the faces at the end line up row to row.
      h('span',{className:'ap-vx-row-name'},h(VoiceMarked,{text:name,query})),current&&h('span',{className:'ap-vx-row-check','aria-hidden':true},h(Glyph,{name:'check'})),
      lang&&h(VoiceLangChip,{tag:lang}),meta&&h('span',{className:'ap-vx-row-meta'},meta),
      h('span',{className:'ap-vx-row-end'},end||null)),
    rowMenu.layer);
}
// ▶ in a row: a small round button (the row's play, not the hero's).
function VoiceRowPlay({state,label,onClick,disabled}) {
  const on=!!state&&state.phase!=='error';
  return h('button',{type:'button',className:'ap-vx-row-play','aria-label':on?'停止试听':label,'aria-pressed':on,'data-state':state?.phase,title:state?.phase==='error'?state.error:on?'停止试听':label,disabled:!!disabled&&!on,onClick},
    state?.phase==='loading'?h(Spinner,{key:'p'}):h(Glyph,{name:state?.phase==='error'?'warning':on?'stop':'play'}));
}

// ---------- the 声音 property (设置向导) ----------
// one inline row 「声音 凛的声线 ›」 (InlineField link) that opens the figure on its 声音 tab.
function FigureVoiceField({pack,figure,status,pillRef,onOpen}) {
  const spec=figureVoiceSpec(pack,figure),voice=figure.voice,muted=voice?.source===null,source=spec&&!muted?spec.sources[voiceSourceId(spec,voice)]:null;
  const issue=source?status?.issues?.[0]:null,warn=issue&&voiceIssueText(issue.code,source),name=spec?spec.name:'通用声音';
  return h(InlineField,{kind:'link',label:'声音',className:'is-voice',controlRef:pillRef,controlClassName:'ap-voice-pill',value:name,onOpen,
    ariaLabel:'声音：'+name+(muted?'，不配音':'')+(warn?'，'+warn+'，暂不配音':''),title:'声音设置',
    before:warn&&h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),after:muted&&h('span',{className:'ap-voice-pill-muted'},'不配音')});
}

// 舞台设置 › 配音 › 角色声音: one row per figure of the card — face · name · what it speaks with (来源 · 音色 · 配音语言, or
// 通用声音 / 不配音) · ▶ · ›. The row opens that figure's 声音 tab in the 素材库 (`onOpen(ref)`). `rows`: [{ref, pack, figure,
// face}] in the stage's cast order. Why one cannot speak is the page's own ⚠ list above (StageVoiceProblems).
function figureVoiceSummary(pack,figure,unvoiced='通用声音'){
  const spec=figureVoiceSpec(pack,figure),voice=figure.voice;
  if(voice?.source===null)return {quiet:true,text:'不配音'};
  if(!spec)return {quiet:true,text:unvoiced};
  const source=spec.sources[voiceSourceId(spec,voice)];
  const name=source.kind==='preset'?(source.voiceName?voiceDisplayName(source.voiceName):''):spec.name;
  return {source,text:[voiceSourceLabel(source),name,voiceLanguageName(primaryLanguage(effectiveVoiceLanguage(voice.language,spec.language)))].filter(Boolean).join(' · ')};
}
function CastVoiceList({binding,rows,label,unvoiced,onOpen}) {
  const preview=useVoicePreview(binding,null);
  if(!rows.length)return h(EmptyState,{compact:true,noun:'人物',icon:h(Glyph,{name:'figures'})});
  return h(React.Fragment,null,h('ul',{className:'ap-cast-voices','aria-label':label},rows.map(row=>{
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
// tts.reading — which figure 通用声音 / 旁白 point at (舞台设置 › 配音 and the 声音 tab's 「通用声音」 read it).
function useReadingPointers(binding){
  const tts=binding?.tts?.call?binding.tts:null,[tick,setTick]=React.useState(0);
  React.useEffect(()=>tts?.subscribe?.(()=>setTick(n=>n+1)),[tts]);
  const state=useVoiceLoad(()=>tts?tts.call('reading'):null,[tts,tick],{keep:true});
  const point=async(role,figure)=>{await tts.call('setReading',{[role]:{figure}});setTick(n=>n+1);};
  return {value:state.value||null,error:state.error,point};
}
// The figure 通用声音 points at, read once per pointer: {ref, pack, figure, spec} (spec null: it has no voice of its own),
// null while unread, {ref:null} when it points at none (the browser's default voice).
function useGeneralVoice(binding,revision){
  const pointers=useReadingPointers(binding),ref=pointers.value?.general?.figure||null;
  const state=useVoiceLoad(async()=>{
    if(!pointers.value)return null;
    if(!ref)return {ref:null};
    const pack=await binding.service.getPackSnapshot({packId:ref.packId}).catch(()=>null),figure=pack?.figures[ref.figureId]||null;
    return {ref,pack,figure,spec:figure&&figureVoiceSpec(pack,figure)};
  },[binding,JSON.stringify(ref),!!pointers.value,revision],{keep:true});
  return state.value;
}
// What a voice speaks with, in one line: its service's own name (語音后端) and the parameters saved in it.
function voiceServiceName(catalog,source){
  if(source.provider==='browser')return '浏览器朗读';
  const services=catalogServices(catalog).filter(s=>s.kind===source.provider),s=services.find(x=>x.id===source.serviceId)||(services.length===1?services[0]:null);
  return s?.label||providerName(source.provider);
}
// The parameters saved in a voice (variants.normal.tuning of its source), read-only: 「语速 +10% · 音高 +25%」.
function voiceParamsText(spec,sourceId){
  const source=spec.sources[sourceId],tuning=spec.variants?.normal?.tuning?.[sourceId]||{};
  return (VOICE_TUNING[source?.provider]||[]).filter(def=>tuning[def.key]!==undefined&&tuning[def.key]!==null&&tuning[def.key]!==''&&tuning[def.key]!==def.base)
    .map(def=>def.kind?def.label+' '+tuning[def.key]:def.label+' '+tuneText(def,tuning[def.key])).join(' · ');
}
// A new voice with the parameters chosen while adding it: they are its 原声 tuning of that source.
function voiceWithParams(spec,params){
  const own=Object.fromEntries(Object.entries(params||{}).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
  return Object.keys(own).length?{...spec,variants:{normal:{name:'原声',tuning:{[spec.defaultSource]:own}}}}:spec;
}

// ---------- the 声音 tab ----------
// Top to bottom: 「配音」 on / off; the voice the figure speaks with — ▶, its name ⌄
// (选择声音), one line of where it comes from (服务 · 模型 · its saved parameters · 配音语言), the 试听 line and 差分; then, for a
// voice of its own that clones, its 参考音频. A figure without a voice of its own speaks with the 通用声音 (舞台设置 › 配音).
function VoiceTab({binding,pack,figure,rows,status,preview,speech,commitVoice,nav}) {
  const packId=pack.manifest.id,voice=figure.voice||null,spec=figureVoiceSpec(pack,figure),muted=voice?.source===null;
  const sourceId=spec?voice.source??spec.defaultSource:null,language=effectiveVoiceLanguage(voice?.language,spec?.language);
  const readiness=useVoiceReadiness(binding),clips=useAudioPreview(binding,packId,speech),general=useGeneralVoice(binding);
  const [error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[shared,setShared]=React.useState(null),[removing,setRemoving]=React.useState(null),[adding,setAdding]=React.useState(false);
  const askShared=others=>new Promise(resolve=>setShared({others,resolve}));
  const writer=useVoiceWriter({binding,pack,figure,commitVoice,setError,askShared});
  const player={...preview,play:(...args)=>{clips.stop();return preview.play(...args);},playSample:(...args)=>{clips.stop();return preview.playSample(...args);}};
  React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t);},[notice]);
  const openSettings=nav?.openTab?(provider,options)=>openVoiceSettings(nav,provider,options):null;
  const candidate=voiceSpec=>({packId,figureId:figure.id,expectedRevision:pack.revision,voiceSpec});
  const remove=voiceId=>{preview.stop();return commitVoice(c=>binding.service.deletePackVoice({packId,expectedRevision:c.revision,voiceId}));};
  const source=spec?spec.sources[sourceId]:null;
  const picker=trigger=>h(VoicePicker,{binding,pack,figure,current:spec?voice.voice:null,general:true,preview:player,candidate,generalVoice:general,trigger,services:readiness.services,
    onPick:async pick=>{preview.stop();const done=await writer.pick(pick);if(done)setNotice('已换成「'+pick.name+'」');},
    onAdd:()=>setAdding(true),onDelete:setRemoving,setError});
  return h('div',{className:'ap-voice-page ap-vx-tab',role:'region','aria-label':figure.name+'的声音'},
    error&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 ',error),
    // A row's ▶ that failed says why here too; the hero's own failure sits under its 试听 line.
    preview.state?.phase==='error'&&preview.state.key!=='saved:'+figure.id&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 试听失败：',preview.state.error),
    // 配音 off keeps the voice (greyed below); on again speaks with it.
    h('div',{className:'ap-vx-onoff'},h(SwitchRow,{label:'配音',checked:!muted,disabled:writer.busy>0,onChange:on=>{preview.stop();writer.setVoiced(on);}})),
    h(VoiceCurrent,{binding,pack,figure,spec,voice,sourceId,muted,status,preview:player,rows,writer,readiness,openSettings,general,picker,setNotice,language,onDelete:()=>setRemoving(voice.voice),onAdd:()=>setAdding(true)}),
    notice&&h('p',{className:'ap-notice',role:'status'},notice),
    // 不配音 hides the 参考音频 (kept; back with 配音 on).
    !muted&&source?.kind==='reference-list'&&h(StageSection,{title:'参考音频',meta:source.references.length,foldKey:'voice-refs',className:'ap-vx-refs'},
      h(VoiceReferences,{binding,pack,figure,spec,voice,writer,preview:player,clips,entry:[sourceId,source]})),
    adding&&h(VoiceAddDialog,{binding,pack,figure,language,readiness,preview:player,candidate,writer,openSettings,onClose:()=>{preview.stop();setAdding(false);},onDone:name=>{setAdding(false);setNotice('已换成「'+name+'」');}}),
    removing&&h(VoiceDeleteDialog,{pack,voiceId:removing,onConfirm:()=>remove(removing),onClose:()=>setRemoving(null)}),
    shared&&h(VoiceSharedDialog,{figure,others:shared.others,onPick:pick=>{shared.resolve(pick);setShared(null);}}));
}
// 删除声音…: who speaks with it goes back to the 通用声音; the reference audio goes with it — one sentence.
function VoiceDeleteDialog({pack,voiceId,onConfirm,onClose}) {
  const spec=pack.manifest.voiceLibrary?.voices?.[voiceId];
  if(!spec)return null;
  const users=voiceUsers(pack,voiceId).map(f=>f.name),clips=Object.values(spec.sources).reduce((n,s)=>n+(s.kind==='reference-list'?s.references.length:0),0);
  const who=users.length?'删除后'+users.join('、')+'改用通用声音':'没有人物在用它';
  return h(ConfirmDialog,{title:'删除声音「'+spec.name+'」？',confirmLabel:'删除',danger:true,onConfirm,onClose,
    body:who+(clips?'，'+clips+' 段参考音频一起删除。':'。')});
}
// The voice the figure speaks with — the one focal point of the tab. `spec` null: the 通用声音 (`general`, read-only here:
// it is chosen in 舞台设置 › 配音). `muted`: 配音 off — the block is greyed and inert, nothing in it is lost.
function VoiceCurrent({binding,pack,figure,spec,voice,sourceId,muted,status,preview,rows,writer,readiness,openSettings,general,picker,setNotice,language,onDelete,onAdd}) {
  const [text,setText]=React.useState(null),[mood,setMood]=React.useState('calm'),[renaming,setRenaming]=React.useState(false);
  const own=!!spec,g=!own&&general?.spec?general:null,gSource=g?g.spec.sources[voiceSourceId(g.spec,g.figure.voice)]:null;
  const speakLanguage=own?language:g?effectiveVoiceLanguage(g.figure.voice.language,g.spec.language):'zh';
  const source=own?spec.sources[sourceId]:gSource,issue=own&&!muted?status?.issues?.[0]:null;
  const key='saved:'+figure.id,state=preview.of(key),sample=sampleText(speakLanguage),said=text??sample;
  const unset=!muted&&voiceSourceUnset(source),ready=source&&!muted&&!issue&&!unset?readiness(source.provider,source.serviceId):null;
  const speaks=!own||!source||!!unset||voiceSpeaks(source,speakLanguage);
  const warn=muted?'':unset||(issue?voiceIssueText(issue.code,source):ready?.warn?ready.text:!speaks?'这个声音不支持'+voiceLanguageName(primaryLanguage(speakLanguage)):'');
  const serviceFix=issue?['SERVICE_REQUIRED','CREDENTIALS_REQUIRED'].includes(issue.code):ready?.setup;
  const goSet=()=>openSettings(source.provider,source.serviceId?{id:source.serviceId}:undefined);
  const action=serviceFix&&openSettings&&h(Button,{className:'ap-hint-chip',onClick:goSet},issue?.code==='SERVICE_REQUIRED'||ready?.missing?VOICE_BACKEND_LINK:'去设置');
  const typed=text!==null&&text.trim()&&text!==sample?text.trim():'';
  const play=()=>{
    if(source?.provider==='browser')return preview.playBrowser(key,{voice:source.voiceName,language:speakLanguage,text:typed||sample},{mood});
    if(own)return preview.play(key,{packId:pack.manifest.id,figureId:figure.id,expectedRevision:pack.revision,...(typed?{text:typed}:{}),mood},{label:spec.name,mood});
    if(g)return preview.play(key,{packId:g.ref.packId,figureId:g.ref.figureId,expectedRevision:g.pack.revision,...(typed?{text:typed}:{}),mood},{label:'通用声音',mood});
    return preview.playBrowser(key,{voice:'',language:'zh',text:typed||sample},{mood});
  };
  const cannot=muted||!!warn&&!issue?.field&&speaks;
  const disc=muted||cannot?'off':state?.phase,playing=!!state&&state.phase!=='error';
  const services=source&&own?catalogServices(readiness.services).filter(s=>s.kind===source.provider):[];
  const service=services.find(s=>s.id===source?.serviceId)||(services.length===1?services[0]:null),models=service?.models||[];
  // 服务 ⌄: the same voice spoken by another service of its kind that serves its way of speaking (the same reference audio
  // cloned by 本地 Drama 3 or Fish Audio online); at its foot, 「换成其他服务的声音…」 opens 添加声音 for any service's voice.
  const movable=services.filter(s=>s.sources.includes(source.kind));
  const serviceOptions=movable.length?movable.map(s=>{const st=voiceServiceState(s);return {id:s.id,label:s.label||providerName(s.kind),meta:st?.warn?'⚠ '+st.text:''};}):
    [{id:'',label:source?voiceServiceName(readiness.services,source):''}];
  const params=own?voiceParamsText(spec,sourceId):'';
  const name=own?spec.name:'通用声音';
  const menu=own&&h(Popover,{label:'声音操作',className:'ap-voice-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'声音操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
    h(MenuItem,{onClick:()=>{close();setRenaming(true);}},'重命名'),
    h(MenuItem,{danger:true,onClick:()=>{close();preview.stop();onDelete();}},'删除声音…'))});
  const nameControl=renaming?h(CommitInput,{className:'ap-vx-name-input','aria-label':'声音名称',autoFocus:true,value:spec.name,maxLength:60,validate:v=>v.trim()?'':'名称不能为空',
      onCommit:v=>{setRenaming(false);if(v.trim()!==spec.name)writer.editVoice(s=>({...s,name:v.trim()}));},onBlur:()=>setRenaming(false)}):
    picker(({open,toggle})=>h('button',{type:'button',className:'ap-vx-name','aria-label':'选择声音：'+name,'aria-expanded':open,onClick:toggle},h('span',null,name),h(Glyph,{name:'chevDown'})));
  const auto=own&&figure.extensions?.['dsh.automatic-write']?.fields?.includes('voice');
  const sep=h('i',{'aria-hidden':true},'·');
  const meta=own?h('div',{className:'ap-vx-meta'},
      h(VoiceFilterPick,{label:'语音服务',value:service?.id||'',valueText:voiceServiceName(readiness.services,source),options:serviceOptions,className:'ap-vx-service-anchor',
        onPick:id=>writer.setSourceService(sourceId,movable.find(s=>s.id===id)),
        foot:onAdd&&(close=>h(React.Fragment,null,h('div',{className:'ap-menu-sep',role:'separator'}),h(MenuItem,{onClick:()=>{close();preview.stop();onAdd();}},'换成其他服务的声音…')))}),
      models.length>1&&h(VoiceOptionPick,{label:'模型',value:source.model||models[0].id,options:models.map(m=>({id:m.id,label:m.label||m.id})),onPick:id=>writer.setSourceModel(sourceId,id)}),
      params&&h(React.Fragment,null,sep,h('span',null,params)),
      h(VoiceLanguagePick,{value:language,defaultValue:effectiveVoiceLanguage('',spec.language),label:'配音语言',icon:'language',title:VOICE_LANGUAGE_HELP,
        onPick:l=>writer.patchBinding({language:l===effectiveVoiceLanguage('',spec.language)?undefined:l})})):
    h('div',{className:'ap-vx-meta'},gSource?[voiceServiceName(readiness.services,gSource),voiceLanguageName(primaryLanguage(speakLanguage))].join(' · '):'浏览器朗读 · 中文');
  return h('div',{className:'ap-vx-hero','data-off':muted||undefined,inert:muted||undefined},
    // the disc is the voice itself (配音 on / off), not a button: 试听 is its own bar below.
    h('span',{className:'ap-vx-disc','data-state':muted?'off':undefined,'aria-hidden':true},h(Glyph,{name:muted?'voiceOff':'voice'})),
    h('div',{className:'ap-vx-hero-main'},
      h('div',{className:'ap-vx-hero-line'},nameControl,
        auto&&h('span',{className:'ap-vx-spark',role:'img','aria-label':'自动素材分配',title:'自动素材分配'},h(Glyph,{name:'spark'})),
        !own&&h('span',{className:'ap-vx-tag'},'默认'),
        h('span',{className:'ap-vx-hero-tools'},writer.busy>0&&h(Spinner,{key:'saving',label:'正在保存'}),menu)),
      // a service that cannot speak replaces the line (fixed in 语音后端); a 配音语言 the voice cannot speak keeps it, to change it.
      // the 通用声音's line gives way to a ⚠ (fixed in 语音后端); a voice of its own keeps its line, where 语音服务 ⌄ moves it
      // to a service that can speak.
      warn&&speaks&&!own?null:meta,warn&&h('p',{className:'ap-vx-warn',role:'status'},h(Glyph,{name:'warning'}),h('span',null,warn),action||null)),
    // 试听: one field — ▶ 试听 · the line it reads (editable; Enter plays) · 语气 (which 差分 speaks it).
    h('div',{className:'ap-vx-say',role:'group','aria-label':'试听'},
      h('button',{type:'button',className:'ap-vx-say-play','data-state':disc,'aria-pressed':playing,disabled:(cannot||!binding.tts)&&!playing,title:!binding.tts?'配音插件未启用':undefined,onClick:play},
        state?.phase==='loading'?h(Spinner,{key:'go'}):h(Glyph,{name:playing?'stop':'play'}),h('span',null,playing?'停止':'试听')),
      h('input',{className:'ap-vx-say-text','aria-label':'试听台词',placeholder:'写一句台词来试听',value:said,maxLength:200,onChange:e=>setText(e.target.value),
        onKeyDown:e=>{if(e.key==='Enter'&&!e.nativeEvent?.isComposing){e.preventDefault();if(!cannot&&binding.tts)play();}}}),
      h(VoiceMoodPick,{rows,value:mood,onPick:setMood,prefix:'语气'})),
    state?.phase==='error'&&h('p',{className:'ap-vx-try-error',role:'alert'},h(VoiceWarn,{action:VOICE_SERVICE_CODES.has(state.code)&&openSettings&&source?h(Button,{className:'ap-link',onClick:goSet},'去设置'):
      h(Button,{className:'ap-link',onClick:play},'重试')},'试听失败：'+state.error)));
}

// ---------- 选择声音 ----------
// One floating list (a bottom sheet on a phone): a search box, the list, a dashed ＋ (添加声音). The first row is the 通用声音
// (`general`: the 声音 tab; 舞台设置's own pickers have none). Then 本包; 其他素材包 N › stays folded until opened
// or searched (a search lists every pack, by pack). A row: ▶ (plays, never picks) · name · 语言 · who
// speaks with it; a click picks at once. This pack's voices carry their own menu (right click / long press,
// R9) with 删除声音…. `onPick({kind, name, …})`: general · own {id} · other {ref}.
function VoicePicker({binding,pack,figure,current,general=false,generalVoice,preview,candidate,trigger,onPick,onAdd,onDelete,setError,services,label='选择声音'}) {
  const [query,setQuery]=React.useState(''),[open,setOpen]=React.useState({}),[wanted,setWanted]=React.useState(false);
  const catalogue=useVoiceLoad(()=>wanted?binding.service.listVoiceCatalogue():null,[binding,wanted,pack.revision],{keep:true});
  const q=query.trim(),needle=voiceNeedle(q),packId=pack.manifest.id;
  const entries=catalogue.value?.voices||[];
  const own=Object.entries(pack.manifest.voiceLibrary?.voices||{}).map(([id,spec])=>({id,spec,users:voiceUsers(pack,id)}));
  const byPack=new Map();
  for(const v of entries)if(v.ref.packId&&v.ref.packId!==packId){if(!byPack.has(v.ref.packId))byPack.set(v.ref.packId,{id:v.ref.packId,name:v.packName||'',items:[]});byPack.get(v.ref.packId).items.push(v);}
  const others=[...byPack.values()];
  const hit=(name,spec)=>voiceMatches(needle,[name,spec?.guidance]);
  const rowPlay=(spec,key,request,name)=>{
    const src=spec?.sources?.[spec.defaultSource];
    if(!src||voiceSourceUnset(src)||!request&&src.provider!=='browser')return null;
    const label='试听「'+name+'」';
    if(src.provider==='browser')return h(VoiceRowPlay,{state:preview.of(key),label,onClick:()=>preview.playBrowser(key,{voice:src.voiceName,language:spec.language,text:sampleText(spec.language)})});
    return h(VoiceRowPlay,{state:preview.of(key),label,disabled:!binding.tts,onClick:()=>preview.play(key,request,{label:name})});
  };
  const pick=(close,choice)=>{close();setQuery('');onPick(choice);};
  // which service speaks a row (`services`: the voice services catalog), so voices of every service read apart.
  const served=spec=>{const src=services&&spec?.sources?.[spec.defaultSource];return src?voiceServiceName(services,src):'';};
  const ownRow=close=>({id,spec,users})=>h(VoiceListRow,{key:'p:'+id,name:spec.name,query:q,lang:spec.language,meta:served(spec),current:id===current,
    end:h(VoiceFaces,{binding,pack,figures:users}),play:rowPlay(spec,'pick:'+packId+':'+id,candidate(spec),spec.name),
    onPick:()=>id===current?close():pick(close,{kind:'own',id,name:spec.name}),
    menu:onDelete&&(closeMenu=>h(MenuItem,{danger:true,onClick:()=>{closeMenu();close();onDelete(id);}},'删除声音…'))});
  const otherRow=close=>v=>h(VoiceListRow,{key:v.ref.packId+'/'+v.ref.voiceId,name:v.name,query:q,lang:v.voiceSpec.language,meta:served(v.voiceSpec),end:h(VoiceFaces,{users:v.users}),
    play:rowPlay(v.voiceSpec,'pick:'+v.ref.packId+':'+v.ref.voiceId,v.previewFigureId&&{packId:v.ref.packId,figureId:v.previewFigureId,expectedRevision:v.revision,voiceSpec:v.voiceSpec},v.name),
    onPick:()=>pick(close,{kind:'other',ref:v.ref,name:v.name})});
  const generalRow=close=>{
    const g=generalVoice?.spec?generalVoice:null,src=g&&g.spec.sources[voiceSourceId(g.spec,g.figure.voice)];
    const play=g?rowPlay(g.spec,'pick:general',{packId:g.ref.packId,figureId:g.ref.figureId,expectedRevision:g.pack.revision},'通用声音'):null;
    return h(VoiceListRow,{key:'general',name:'通用声音',current:current===null,end:h('span',{className:'ap-vx-tag'},'默认'),play:src&&play,
      onPick:()=>current===null?close():pick(close,{kind:'general',name:'通用声音'})});
  };
  const group=(name,rows,key)=>rows.length?h(React.Fragment,{key},h('h5',{className:'ap-vx-group'},name),h('ul',{className:'ap-vx-rows','aria-label':name},rows)):null;
  const fold=(id,name,count)=>h('button',{type:'button',key:id,className:'ap-vx-group is-fold','aria-expanded':!!open[id],onClick:()=>setOpen(o=>({...o,[id]:!o[id]}))},
    h('span',{className:'ap-vx-fold-name'},name),h('span',{className:'ap-vx-fold-count'},count),h(Glyph,{name:open[id]?'chevDown':'chevRight'}));
  const otherCount=others.reduce((n,g)=>n+g.items.length,0);
  const body=close=>{
    if(q){
      const groups=[group(general?'本包':pack.manifest.name,own.filter(v=>hit(v.spec.name,v.spec)).map(ownRow(close)),'own'),
        ...others.map(g=>group(g.name,g.items.filter(v=>hit(v.name,v.voiceSpec)).map(otherRow(close)),g.id))].filter(Boolean);
      return groups.length?groups:catalogue.value?h(EmptyState,{compact:true,noun:'声音',query:q,plain:true}):h(VoiceLoading,{count:3});
    }
    return h(React.Fragment,null,
      general&&h('ul',{className:'ap-vx-rows','aria-label':'默认'},generalRow(close)),
      own.length>0&&group(general?'本包':pack.manifest.name,own.map(ownRow(close)),'own'),
      catalogue.error&&!catalogue.value?h(VoiceLoadError,{error:catalogue.error,retry:catalogue.reload}):!catalogue.value?h(VoiceLoading,{count:2}):h(React.Fragment,null,
        otherCount>0&&fold('others','其他素材包',otherCount),
        open.others&&others.map(g=>group(g.name,g.items.map(otherRow(close)),g.id))));
  };
  return h(React.Fragment,null,
    h(Popover,{label,float:true,fit:true,limit:560,className:'ap-vx-pick-anchor',
      trigger:({open:shown,toggle})=>trigger({open:shown,toggle:()=>{if(!shown){setWanted(true);setQuery('');}toggle();}}),
      content:close=>h('div',{className:'ap-vx-pick'},
        h(PackSearchBox,{label:'搜索声音',value:query,placeholder:'搜索声音',onChange:setQuery,onKeyDown:voiceSearchKeys(query,()=>setQuery(''))}),
        h('div',{className:'ap-vx-pick-list'},body(close)),
        onAdd&&h('div',{className:'ap-vx-pick-foot'},h(CatAddTile,{label:'添加声音',className:'ap-vx-add',onClick:()=>{close();onAdd();}})))}));
}

// ---------- 添加声音 ----------
// One dialog (full screen on a phone): the services set up in 语音后端 on the left (their order and names; ⚠ when one cannot
// speak now, 「语音后端 ›」 at its foot; on a phone one 「服务名 ⌄」 at the top), on the right what that service offers —
// Fish Audio 「声音库｜录音克隆」, the others their voices — and under it the parameters that service allows (VOICE_TUNING; the parameters are
// chosen here and saved in the new voice). 「使用」 makes a new voice of the pack, named after the voice picked, and the
// figure speaks with it.
const BROWSER_SERVICE={id:'browser',kind:'browser',label:'浏览器朗读',sources:['preset']};
function VoiceAddDialog({binding,pack,figure,language,readiness,preview,candidate,writer,openSettings,onClose,onDone}) {
  const services=[...catalogServices(readiness.services),BROWSER_SERVICE];
  // what a service lacks now (浏览器朗读: only a device without speech; its voices are filtered by language below).
  const states=Object.fromEntries(services.map(s=>[s.id,voiceServiceState(s)]));
  const [serviceId,setServiceId]=React.useState(()=>(services.find(s=>!states[s.id]?.warn)||services[0]).id);
  const service=services.find(s=>s.id===serviceId)||services[0],kind=service.kind,state=states[service.id];
  const ways=kind==='fish-audio'?[['library','声音库'],['clone','录音克隆']].filter(([id])=>service.sources.includes(id==='library'?'voice-id':'reference-list')):[];
  const [modes,setModes]=React.useState({}),mode=ways.length?modes[service.id]||ways[0][0]:'library';
  const [picked,setPicked]=React.useState(null),[params,setParams]=React.useState({}),[clipSet,setClipSet]=React.useState(null),[busy,setBusy]=React.useState(false);
  React.useEffect(()=>{setPicked(null);setParams({});},[serviceId,mode]);
  const bind=s=>catalogServices(readiness.services).filter(x=>x.kind===s.kind).length>1?{serviceId:s.id}:{};
  const withParams=spec=>voiceWithParams(spec,params);
  const use=async()=>{
    setBusy(true);preview.stop();
    try{
      if(mode==='clone'){const made=await clipSet.make();if(made&&await writer.createVoice(withParams(made)))onDone(made.name);return;}
      const spec=withParams(picked.spec);
      if(await writer.createVoice(spec))onDone(spec.name);
    }finally{setBusy(false);}
  };
  const ready=mode==='clone'?!!clipSet?.ready:!!picked;
  const go=state?.setup&&openSettings&&h(Button,{className:'ap-hint-chip',onClick:()=>openSettings(kind,{id:service.id})},'去设置');
  const servicePick=h(VoiceFilterPick,{label:'语音服务',value:service.id,className:'ap-vx-service-pick',options:services.map(s=>({id:s.id,label:s.label||providerName(s.kind),meta:states[s.id]?.warn?'⚠':''})),onPick:setServiceId});
  const common={binding,figure,service,serviceKind:kind,bind:bind(service),language,preview,candidate,picked,onPick:setPicked,withParams,params};
  const pane=state?.warn?h('p',{className:'ap-vx-warn'},h(Glyph,{name:'warning'}),h('span',null,state.text),go||null):
    mode==='clone'?h(VoiceAddClone,{...common,writer,pack,onState:setClipSet}):
    kind==='fish-audio'?h(VoiceAddFish,{...common,key:service.id}):h(VoiceAddVoices,{...common,key:service.id});
  const defs=VOICE_TUNING[kind]||[];
  return h(Modal,{title:'添加声音',onClose,busy,className:'ap-vx-add-modal',head:h('header',null,h('h2',null,'添加声音'),h(IconButton,{icon:'close',label:'关闭',disabled:busy,onClick:onClose})),
    foot:h('div',{className:'ap-vx-add-foot'},h(Button,{primary:true,disabled:!ready||busy||!!state?.warn,onClick:use},busy?'正在添加…':'使用'))},
    h('div',{className:'ap-vx-add-cols'},
      h('nav',{className:'ap-vx-nav','aria-label':'语音服务'},
        h('div',{role:'tablist','aria-orientation':'vertical','aria-label':'语音服务',className:'ap-vx-nav-list'},services.map(s=>h('button',{key:s.id,type:'button',role:'tab','aria-selected':s.id===service.id,className:'ap-vx-nav-item','data-current':s.id===service.id||undefined,onClick:()=>setServiceId(s.id)},
          h('span',null,s.label||providerName(s.kind)),states[s.id]?.warn&&h('span',{className:'ap-vx-nav-warn',role:'img','aria-label':states[s.id].text,title:states[s.id].text},h(Glyph,{name:'warning'}))))),
        openSettings&&h(Button,{className:'ap-link ap-vx-nav-foot',onClick:()=>openSettings(null)},'语音后端 ›')),
      h('div',{className:'ap-vx-pane'},
        h('div',{className:'ap-vx-pane-tools is-head'},servicePick,ways.length>1&&h(Segmented,{label:'方式',className:'ap-vx-ways',value:mode,options:ways,onChange:id=>setModes(m=>({...m,[service.id]:id}))})),
        pane,
        !state?.warn&&defs.length>0&&h(VoiceParams,{binding,kind,defs,params,setParams,voiceName:picked?.spec?.sources?.[picked.spec.defaultSource]?.voiceName,clone:mode==='clone'}))));
}
// The parameters a service allows (VOICE_TUNING, the adapters' own ranges): sliders, 风格 (Azure, the picked voice's styles),
// 风格指令 (通义千问). `params` is what the new voice will keep; a value at its base is not kept.
function VoiceParams({binding,kind,defs,params,setParams,voiceName,clone}) {
  const azure=useVoiceLoad(()=>kind==='azure'&&binding.tts?.call?binding.tts.call('listOnlinePresetVoices',{provider:'azure'}):null,[binding,kind]);
  const styles=azure.value?.voices?.find(v=>v.id===voiceName)?.styles||[];
  const set=(key,value)=>setParams(p=>{const next={...p};if(value===null||value===undefined||value==='')delete next[key];else next[key]=value;return next;});
  const control=def=>{
    if(def.kind==='text')return h(React.Fragment,{key:def.key},h('span',{className:'ap-vx-param-label'},def.label),h(InlineField,{kind:'text',label:def.label,hideLabel:true,className:'ap-vx-param-text',value:params[def.key]||'',placeholder:'例：语气轻快，带一点撒娇',maxLength:200,onCommit:v=>set(def.key,v.trim())}));
    if(def.kind==='style')return h(React.Fragment,{key:def.key},h('span',{className:'ap-vx-param-label'},def.label),
      h(VoiceOptionPick,{label:def.label,value:params.style||'',options:[{id:'',label:'默认'},...styles.map(s=>({id:s,label:s}))],onPick:id=>set('style',id||null)}));
    const value=Number.isFinite(params[def.key])?params[def.key]:def.base;
    return h(React.Fragment,{key:def.key},h('span',{className:'ap-vx-param-label'},def.label),
      h(Slider,{className:'ap-tune',label:def.label,min:def.min,max:def.max,step:def.step,value,reset:def.base,valueText:v=>tuneText(def,v),output:v=>tuneText(def,v),outputClassName:'ap-tune-value',onCommit:v=>set(def.key,v===def.base?null:v)}));
  };
  return h('div',{className:'ap-vx-params'+(clone?' is-form':''),role:'group','aria-label':'参数'},defs.map(control));
}
// The voice list of 添加声音: tools (search · 配音语言) on top, the rows, one picked (`picked.key`). `rows` [{key, name, meta,
// end, spec, play}].
function VoiceAddList({tools,rows,picked,onPick,empty,label}) {
  return h(React.Fragment,null,h('div',{className:'ap-vx-pane-tools'},tools),
    rows===null?h(VoiceLoading,{count:4}):rows.length?h('ul',{className:'ap-vx-rows ap-vx-pane-list','aria-label':label},rows.map(r=>h(VoiceListRow,{key:r.key,name:r.name,meta:r.meta,end:r.end,picked:picked?.key===r.key,play:r.play,
      onPick:()=>onPick(picked?.key===r.key?null:{key:r.key,spec:r.spec,name:r.name})}))):empty);
}
// 配音语言 filter of a voice list: the figure's language first, 「所有语言」 lists every voice.
function VoiceLangFilter({value,onPick}) {
  return h(VoiceFilterPick,{label:'配音语言',value,icon:'language',options:[{id:'',label:'所有语言'},...VOICE_LANGUAGE_CHOICES.map(([id,name,en])=>({id,label:name,words:[en]}))],onPick,className:'ap-vx-lang-filter'});
}
const VOICE_GENDER_SHORT={female:'女',male:'男',neutral:'中性'};
// Fish 声音库 filters and sorts: one radio group each for 性别 and 年龄, 风格 any of;
// the ids are Fish's tags (all must match). The sort '' is the popular list (task count) this dialog opens on.
const FISH_FILTERS=[
  {id:'gender',label:'性别',one:true,tags:[['female','女性'],['male','男性']]},
  {id:'age',label:'年龄',one:true,tags:[['young','年轻'],['middle-aged','中年'],['old','年长']]},
  {id:'style',label:'风格',tags:[['anime','动漫'],['gentle','温柔'],['cheerful','开朗'],['calm','沉稳'],['deep','低沉'],['cute','可爱']]}];
const FISH_SORTS=[['','最常用'],['score','推荐'],['created_at','最新']];
const fishTagName=new Map(FISH_FILTERS.flatMap(g=>g.tags));
function FishFilterMenu({tags,onChange}) {
  const on=tags.length>0,text=tags.map(t=>fishTagName.get(t)).join('·');
  const flip=(g,tag)=>{const has=tags.includes(tag),others=g.one?tags.filter(t=>!g.tags.some(([id])=>id===t)):tags.filter(t=>t!==tag);onChange(has?tags.filter(t=>t!==tag):[...others,tag]);};
  return h(Popover,{label:'筛选声音',className:'ap-kind-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-kind-menu','data-on':on||undefined,'aria-haspopup':'menu','aria-expanded':open,'aria-label':'筛选声音'+(on?'：'+text:''),title:'筛选声音'+(on?'：'+text:''),onClick:toggle},
      h(Glyph,{name:'filter'}),on&&h('span',null,text)),
    content:()=>h(React.Fragment,null,FISH_FILTERS.map((g,i)=>h(React.Fragment,{key:g.id},i>0&&h('div',{className:'ap-menu-sep',role:'separator'}),
        h('div',{className:'ap-vx-filter-head',role:'presentation'},g.label),
        g.tags.map(([tag,name])=>h('button',{key:tag,type:'button',role:g.one?'menuitemradio':'menuitemcheckbox','aria-checked':tags.includes(tag),className:'ap-menu-item',onClick:()=>flip(g,tag)},
          h('span',null,name),tags.includes(tag)&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})))))),
      on&&h(React.Fragment,null,h('div',{className:'ap-menu-sep',role:'separator'}),h(MenuItem,{onClick:()=>onChange([])},'清除筛选')))});
}
function FishSortMenu({sort,onSort}) {
  const current=FISH_SORTS.find(([k])=>k===sort)[1];
  return h(Popover,{label:'排序',className:'ap-sort-anchor',trigger:({toggle,open})=>h(IconButton,{icon:'sort',label:'排序：'+current,'aria-expanded':open,'data-on':sort||undefined,onClick:toggle}),
    content:close=>FISH_SORTS.map(([value,text])=>h('button',{key:value||'used',type:'button',role:'menuitemradio','aria-checked':sort===value,className:'ap-menu-item',onClick:()=>{close();if(sort!==value)onSort(value);}},h('span',null,'按'+text),sort===value&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// Fish Audio 声音库: the popular voices in the chosen language (zh / ja; the others list both), typing filters them; Enter asks
// Fish by name, a pasted voice ID is looked up. ▶ plays a voice's official sample (no synthesis) unless parameters are set:
// then the picked voice is synthesised with them (the paid-preview gate asks first).
function VoiceAddFish({binding,figure,service,bind,language,preview,candidate,picked,onPick,withParams,params}) {
  const [lang,setLang]=React.useState(['zh','ja'].includes(primaryLanguage(language))?primaryLanguage(language):''),[query,setQuery]=React.useState(''),[found,setFound]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const [tags,setTags]=React.useState([]),[sort,setSort]=React.useState(''),[asked,setAsked]=React.useState('');
  // a filter or a sort asks Fish (20 voices; typing then Enter narrows by name); none: the popular list, typing filters it.
  const sifted=tags.length>0||!!sort;
  const remote=useVoiceLoad(()=>sifted&&binding.tts?.call?voiceTts(binding).call('searchFishVoices',{serviceId:service.id,query:asked,tags,...(sort?{sort}:{}),...(lang?{language:lang}:{}),page:1}):null,[binding,service.id,lang,sifted,tags.join(','),sort,asked],{keep:true});
  const recommended=useVoiceLoad(()=>binding.tts?.call?voiceTts(binding).call('listRecommendedFishVoices',{...(lang?{language:lang}:{}),serviceId:service.id}):null,[binding,service.id,lang],{keep:true});
  const q=query.trim(),idLike=/^[A-Za-z0-9_-]{24,160}$/.test(q)&&!/\s/.test(q),needle=voiceNeedle(q);
  async function find(){
    if(sifted&&!idLike){setAsked(q);return;}
    if(!q||busy)return;setBusy(true);setError('');
    try{
      if(idLike){try{setFound({query:q,voices:[await voiceTts(binding).call('validateFishVoice',{serviceId:service.id,voiceId:q})]});}catch(e){if(voiceCode(e)!=='VOICE_NOT_FOUND')throw e;setFound({query:q,voices:[],missing:true});}}
      else{const r=await voiceTts(binding).call('searchFishVoices',{serviceId:service.id,query:q,...(lang?{language:lang}:{}),page:1});setFound({query:q,voices:r.voices||[]});}
    }catch(e){setError(voiceErrorText(e));}finally{setBusy(false);}
  }
  const tuned=Object.keys(params).length>0;
  const row=v=>{const name=v.name||'Fish 声音',key='fish:'+v.voiceId,spec={name,language:pickVoiceLanguage(v.languages,lang||'zh'),defaultSource:'fish',sources:{fish:{kind:'voice-id',provider:'fish-audio',voiceId:v.voiceId,...bind}}};
    const heat=voiceCount(v.likeCount);
    const play=h(VoiceRowPlay,{state:preview.of(key),label:'试听「'+name+'」',onClick:()=>v.sampleUrl&&!(tuned&&picked?.key===key)?preview.playSample(key,{serviceId:service.id,voiceId:v.voiceId},{request:candidate(withParams(spec)),label:name}):preview.play(key,candidate(withParams(spec)),{label:name})});
    return {key,name,spec,play,meta:[VOICE_GENDER_SHORT[v.gender],...(v.toneTags||[]).slice(0,3)].filter(Boolean).join(' · '),end:heat&&h('span',{className:'ap-vx-heat'},heat+' ♥')};};
  const answer=found&&found.query===q?found:null;
  const list=answer?answer.voices:sifted?(remote.value?remote.value.voices||[]:null):recommended.value?(recommended.value.voices||[]).filter(v=>voiceMatches(needle,[v.name,...(v.toneTags||[]),VOICE_GENDERS[v.gender]])):null;
  const tools=h(React.Fragment,null,
    h(PackSearchBox,{label:'搜索 Fish 声音',value:query,placeholder:'搜名字或标签，或粘贴声音编号',onChange:v=>{setQuery(v);setError('');},onKeyDown:voiceSearchKeys(query,()=>setQuery(''),q?find:null)}),
    busy&&h(Spinner,{key:'find'}),
    h(VoiceLangFilter,{value:lang,onPick:setLang}),
    h(FishFilterMenu,{tags,onChange:setTags}),
    h(FishSortMenu,{sort,onSort:setSort}));
  return h(React.Fragment,null,
    error&&h(VoiceLoadError,{error}),
    recommended.error&&!recommended.value&&!sifted&&h(VoiceLoadError,{error:recommended.error,retry:recommended.reload}),
    remote.error&&sifted&&h(VoiceLoadError,{error:remote.error,retry:remote.reload}),
    h(VoiceAddList,{label:'Fish 声音',tools,rows:list&&list.map(row),picked,onPick,
      empty:answer?.missing?h(EmptyState,{compact:true,text:'没有找到这个编号'}):sifted&&tags.length?h(EmptyState,{compact:true,noun:'声音',filter:tags.map(x=>fishTagName.get(x)).join('·'),query:asked,onClear:()=>{setTags([]);setAsked('');}}):q?h(EmptyState,{compact:true,noun:'声音',query:q,plain:true,onClear:()=>setQuery('')}):h(EmptyState,{compact:true,noun:'声音'})}));
}
// Any other service (and 浏览器朗读): its voices in the chosen language, typing filters; 模型 where the service offers several.
// A service that lists no voices (a custom endpoint) takes the voice by name.
function VoiceAddVoices({binding,service,serviceKind:kind,bind,language,preview,candidate,picked,onPick,withParams}) {
  const browser=kind==='browser',custom=service.voiceList==='provider';
  const [lang,setLang]=React.useState(primaryLanguage(language)),[query,setQuery]=React.useState(''),[model,setModel]=React.useState(''),[typed,setTyped]=React.useState('');
  const list=useVoiceLoad(()=>browser?browserSpeechVoiceList(window.speechSynthesis).then(voices=>({voices})):custom?voiceTts(binding).call('providerVoices',{serviceId:service.id}):voiceTts(binding).call('listOnlinePresetVoices',{provider:kind,serviceId:service.id}),[binding,kind,service.id]);
  const failed=list.value?.status==='error',voices=failed?[]:list.value?.voices||[];
  const models=(failed?[]:list.value?.models||service.models||[]).map(m=>typeof m==='string'?{id:m,label:m}:{id:m.id,label:m.label||m.id});
  const useModel=model||(custom?models[0]?.id||'':'');
  const needle=voiceNeedle(query.trim()),speaks=v=>!lang||!(v.languages||[]).length||v.languages.some(l=>primaryLanguage(l)===lang);
  const sid=custom?'custom':kind;
  const specOf=v=>({name:v.label||v.id,language:pickVoiceLanguage(browser?(v.languages||[]).map(primaryLanguage):v.languages,lang||'zh'),defaultSource:sid,sources:{[sid]:{kind:'preset',provider:kind,voiceName:v.id,...(useModel?{model:useModel}:{}),...bind}}});
  const row=v=>{const key=kind+':'+service.id+':'+v.id+':'+useModel,name=v.label||v.id,spec=specOf(v);
    const play=h(VoiceRowPlay,{state:preview.of(key),label:'试听「'+name+'」',disabled:custom&&!useModel,onClick:()=>browser?preview.playBrowser(key,{voice:v.id,language:v.languages?.[0],text:sampleText(primaryLanguage(v.languages?.[0]||'zh'))}):preview.play(key,candidate(withParams(spec)),{label:name})});
    return {key,name,spec,play,meta:[v.mine?'我的音色':'',VOICE_GENDER_SHORT[v.gender],v.description||''].filter(Boolean).join(' · ')};};
  const shown=list.value?voices.filter(v=>speaks(v)&&voiceMatches(needle,[v.label,v.id,v.description,...(v.styles||[])])):null;
  const tools=h(React.Fragment,null,
    h(PackSearchBox,{label:'搜索音色',value:query,placeholder:'搜名字',onChange:setQuery,onKeyDown:voiceSearchKeys(query,()=>setQuery(''))}),
    models.length>1&&h(VoiceOptionPick,{label:'模型',value:useModel,options:[...(custom?[]:[{id:'',label:'默认模型'}]),...models],onPick:setModel}),
    !browser||voices.some(v=>(v.languages||[]).length)?h(VoiceLangFilter,{value:lang,onPick:setLang}):null);
  if(list.error||failed)return h(VoiceLoadError,{error:list.error||'读不到这个服务的声音列表',retry:list.reload});
  if(custom&&list.value&&!voices.length)return h(InlineGrid,{label:'音色',columns:1,className:'ap-vx-fields'},
    !models.length&&h(InlineField,{kind:'text',label:'模型',value:model,placeholder:'例：tts-1',maxLength:160,onCommit:v=>setModel(v.trim())}),
    h(InlineField,{kind:'text',label:'音色',value:typed,placeholder:'例：alloy',maxLength:160,onCommit:v=>{const id=v.trim();setTyped(id);onPick(id?{key:'typed:'+id,spec:specOf({id,label:id,languages:[]}),name:id}:null);}}));
  return h(VoiceAddList,{label:service.label||providerName(kind),tools,rows:shown&&shown.map(row),picked,onPick,
    empty:needle?h(EmptyState,{compact:true,noun:'音色',query,plain:true,onClear:()=>setQuery('')}):h(EmptyState,{compact:true,text:'这个服务没有'+(lang?voiceLanguageName(lang):'')+'音色',icon:h(Glyph,{name:'voice'})})});
}
// 录音克隆: clips of one person speaking (WAV / MP3; the reference rows of a voice: ▶ · what it says · language), a 名称 and
// 模型. Nothing is written until 「使用」: then the clips go into the pack and make the new voice (`onState({ready, make})`).
function VoiceAddClone({binding,figure,pack,service,bind,language,writer,onState}) {
  const [items,setItems]=React.useState([]),[name,setName]=React.useState(figure.name+'的声音'),[model,setModel]=React.useState(''),[playing,setPlaying]=React.useState(null),[error,setError]=React.useState('');
  const audio=React.useRef(null),models=service.models||[];
  React.useEffect(()=>()=>{audio.current?.pause?.();for(const it of items)URL.revokeObjectURL(it.url);},[]);
  const add=async files=>{setError('');const next=[];
    for(const file of files){try{const media=await prepareVoiceClip(file);const url=URL.createObjectURL(new Blob([media.bytes],{type:media.descriptor.mime}));
      const duration=await new Promise(resolve=>{const a=new Audio();a.preload='metadata';a.onloadedmetadata=()=>resolve(a.duration);a.onerror=()=>resolve(null);a.src=url;});
      next.push({id:url,url,media,text:'',language:primaryLanguage(language),size:media.bytes.length,duration});}catch(e){setError(errorText(e));}}
    setItems(list=>[...list,...next]);};
  const toggle=it=>{audio.current?.pause?.();if(playing===it.id){setPlaying(null);return;}const a=new Audio(it.url);audio.current=a;forkStageAudio?.preview?.(a);a.onended=()=>setPlaying(p=>p===it.id?null:p);a.play().then(()=>setPlaying(it.id),()=>setPlaying(null));};
  const edit=(i,patch)=>setItems(list=>list.map((x,j)=>j===i?{...x,...patch}:x));
  const move=(i,d)=>setItems(list=>{const j=i+d;if(j<0||j>=list.length)return list;const next=[...list];[next[i],next[j]]=[next[j],next[i]];return next;});
  React.useEffect(()=>{onState({ready:items.length>0&&!!name.trim(),make:async()=>{
    const refs=await writer.uploadClips(items.map(it=>it.media),items.map(it=>({text:it.text,language:it.language})));
    if(!refs)return null;
    const made=cloneSpec(figure,primaryLanguage(language),refs);made.name=name.trim();made.sources.fish={...made.sources.fish,...bind,...(model?{model}:{})};return made;}});},[items,name,model]);
  return h('div',{className:'ap-vx-clone'},
    error&&h(VoiceLoadError,{error}),
    h('ol',{className:'ap-clips','aria-label':'录音'},
      items.map((it,i)=>h(VoiceClipRow,{key:it.id,index:i,count:items.length,clip:{text:it.text,language:it.language},size:it.size,duration:it.duration,playing:playing===it.id?'playing':null,reorder:true,
        onPlay:()=>toggle(it),onEdit:patch=>edit(i,patch),onMove:d=>move(i,d),onRemove:()=>setItems(list=>list.filter(x=>x!==it))})),
      h('li',{className:'ap-clip-add-row'},h('label',{className:'ap-clip-add','data-needed':!items.length||undefined,title:'添加录音'},h(Glyph,{name:'plus'}),
        h('input',{type:'file',multiple:true,accept:VOICE_CLIP_ACCEPT,'aria-label':'添加录音',onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';if(files.length)add(files);}})))),
    h(InlineGrid,{label:'新声音',columns:1,className:'ap-vx-fields'},
      h(InlineField,{kind:'text',label:'名称',value:name,maxLength:60,validate:v=>v.trim()?'':'名称不能为空',onCommit:v=>setName(v.trim())}),
      models.length>1&&h(InlineRow,{label:'模型'},h(VoiceOptionPick,{label:'模型',value:model||models[0].id,options:models.map(m=>({id:m.id,label:m.label||m.id})),onPick:setModel}))));
}

// Heat as a short count (1.2万); an unknown count is not shown (never 0).
const voiceCount=n=>!Number.isFinite(n)||n<0?'':n>=10000?(Math.round(n/1000)/10).toString().replace(/\.0$/,'')+'万':String(Math.round(n));
// A search box's text matched against a row's words, in the catalogue's normal form (case, width, 繁/简).
const voiceNeedle=q=>figureResolution.normalizeCatalogueText(q);
const voiceMatches=(needle,words)=>!needle||words.some(w=>w&&figureResolution.normalizeCatalogueText(w).includes(needle));
// Esc in a search box with text clears it first (the page's Esc goes back only from an empty box).
const voiceSearchKeys=(query,clear,onEnter)=>e=>{
  if(e.key==='Escape'&&query){e.preventDefault();e.stopPropagation();clear();}
  else if(e.key==='Enter'&&onEnter){e.preventDefault();onEnter();}
};
// A filterable pick: the trigger reads the value; the menu
// opens with its search box focused (Popover), the options below it. `options` [{id,label,meta,words,extra}] — `words` are
// what typing also matches (English name, code), `extra` an element at the option's end (▶). `limit` shows that many until
// 显示全部; `foot` sits under the list (显示所有语言). `free` (text → id or '') offers what was typed as its own option.
// `icon`: a glyph before the value (配音语言's 文A); `title`: the trigger's tooltip.
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
      (typeof foot==='function'?foot(close):foot)||null)});
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
// One reference clip: № · ▶ original · what it says · language · length / size · ⋯ (上移 / 下移 / 删除). Alt+↑/↓ moves it.
function VoiceClipRow({index,count,clip,size,duration,playing,onPlay,onEdit,onMove,onRemove,reorder}) {
  const no=index+1,on=playing==='playing'||playing==='loading';
  return h('li',{className:'ap-clip',onKeyDown:e=>{if(reorder&&e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();onMove(e.key==='ArrowUp'?-1:1);}}},
    h('span',{className:'ap-clip-no','aria-hidden':true},String(no).padStart(2,'0')),
    h('button',{type:'button',className:'ap-icon-button ap-clip-play','aria-label':(on?'停止':'播放')+'第 '+no+' 段原音','aria-pressed':on,'data-state':playing||undefined,onClick:onPlay},playing==='loading'?h(Spinner,{key:'clip'}):h(Glyph,{name:on?'stop':'play'})),
    h(CommitInput,{className:'ap-clip-text','aria-label':'第 '+no+' 段原文',value:clip.text,placeholder:'请填写这段音频对应的文字',maxLength:1500,onCommit:v=>onEdit({text:v.trim()})}),
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
  const edit=(i,patch)=>onChange(refs.map((r,j)=>j===i?{...r,...patch}:r));
  const move=(i,d)=>{const j=i+d;if(j<0||j>=refs.length)return;const next=[...refs];[next[i],next[j]]=[next[j],next[i]];onChange(next);};
  return h('div',{className:'ap-clips-wrap'},
    clips.state?.status==='error'&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'⚠ ',clips.state.error),
    h('ol',{className:'ap-clips','aria-label':label},
      refs.map((r,i)=>{const id='ref'+i+'/'+r.media,state=clips.state?.id==='voice-ref/'+id?clips.state.status:null;
        return h(VoiceClipRow,{key:i+':'+r.media,index:i,count:refs.length,clip:r,size:sizes[i],duration:durations[i],playing:state,reorder,
          onPlay:()=>{preview.stop();clips.toggle({kind:'voice-ref',id,media:r.media,name:'',mood});},onEdit:patch=>edit(i,patch),onMove:d=>move(i,d),onRemove:()=>onChange(refs.filter((_,j)=>j!==i))});}),
      h('li',{className:'ap-clip-add-row'},h('label',{className:'ap-clip-add','data-disabled':disabled||undefined,'data-needed':needed&&!refs.length||undefined,title:'添加'+label},h(Glyph,{name:'plus'}),
        h('input',{type:'file',multiple:true,accept:VOICE_CLIP_ACCEPT,'aria-label':'添加'+label,disabled,onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';if(files.length)onAdd(files);}})))));
}
// 参考音频 of a voice that clones: Fish's ordered reference list — the whole list, in this order, is sent with every line.
function VoiceReferences({binding,pack,spec,voice,writer,preview,entry,clips}) {
  const [sid,source]=entry||[],language=effectiveVoiceLanguage(voice?.language,spec?.language),refs=source?.references||[];
  const add=files=>writer.addClips(files,{language,place:(s,more)=>{s.sources[sid].references=[...s.sources[sid].references,...more];}});
  return h('div',{className:'ap-voice-refs'},
    h(VoiceClipList,{binding,pack,refs,label:'参考音频',clips,preview,disabled:writer.busy>0,needed:true,onAdd:add,
      onChange:next=>writer.editVoice(s=>{s.sources[sid].references=next;return s;})}));
}
