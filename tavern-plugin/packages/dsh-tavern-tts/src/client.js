const React = require('react')
const h = React.createElement
exports.name = 'dsh-tts-client'
exports.inject = ['slots']
const READING_METHODS = new Set(['editReading','mergeReadings','createReadingPreset','deleteReadingPreset','setActiveReadingPreset','importReadingPreset'])
exports.apply = function(ctx) {
  let active = true, enabled = null, unprovide, removing = Promise.resolve()
  const stateListeners = new Set(), managementListeners = new Set()
  async function call(method,args = {}) {
    if (!active) throw new Error('PLUGIN_UNAVAILABLE')
    const result = await request('control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})},['probeService','testService'].includes(method) ? 125000 : 15000)
    // a change to the active reading preset changes every line's identity; players drop their decoded audio.
    if (READING_METHODS.has(method) && !args.dryRun) for (const fn of listeners) fn({type:'readingsChanged'})
    if (['saveVoicePreset','deleteVoicePreset','importVoicePresets','saveService','deleteService'].includes(method)) {
      for (const fn of listeners) fn({type:'voicesChanged'})
      for (const fn of managementListeners) fn()
    }
    // the voice services catalog (`voiceServices`) changed: a service saved, removed or checked.
    if (['saveService','deleteService','testService','probeService'].includes(method)) for (const fn of listeners) fn({type:'servicesChanged'})
    return result
  }
  const listeners = new Set(), jobs = new Set()
  const audioUrl = ticket => '/api/dsh-tts/v1/audio?ticket=' + encodeURIComponent(ticket)
  const failure = (code, status, message) => Object.assign(new Error(message || code), {code,status})
  async function request(path, options = {}, timeoutMs = 15000) {
    if (!active) throw failure('PLUGIN_UNAVAILABLE')
    const controller = new AbortController(), abort = () => controller.abort(failure('ABORTED'))
    const timer = setTimeout(() => controller.abort(failure('TIMEOUT',undefined,'语音请求超时，请检查服务连接并重新载入声音页。')),timeoutMs)
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort',abort,{once:true})
    try {
      const response = await fetch('/api/dsh-tts/v1/' + path,{credentials:'same-origin',...options,signal:controller.signal})
      const result = await response.json()
      if (!response.ok) throw failure(result.error || 'REQUEST_FAILED',response.status,result.message)
      return result
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort',abort) }
  }
  const cancel = requestId => fetch('/api/dsh-tts/v1/synthesis/status?requestId=' + encodeURIComponent(requestId),{method:'DELETE',credentials:'same-origin'}).catch(() => {})
  const client = Object.freeze({
    apiVersion:1, call, audioUrl, available:() => active && enabled === true,
    jobStatus:(requestId,{signal} = {}) => request('synthesis/status?requestId=' + encodeURIComponent(requestId),{signal}),
    cancelJob:requestId => { void cancel(requestId) },
    listVoices:() => call('voices'),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    // onStream({ticket,url,mime,loudness?}) is called once if the line becomes playable while it is still being spoken; the
    // promise still resolves with the complete, cached line.
    async synthesize(input, {scope,signal,onStream,priority} = {}) {
      if (!active) throw failure('PLUGIN_UNAVAILABLE')
      if (!enabled) throw failure('TTS_DISABLED')
      if (signal?.aborted) throw failure('ABORTED')
      const job = {id:null, cancelled:false}, abort = () => { job.cancelled = true; if (job.id) void cancel(job.id) }
      jobs.add(job); signal?.addEventListener('abort',abort,{once:true})
      try {
        // Keep the POST alive long enough to obtain its id, then cancel even a late acknowledgement.
        const submitted = await request('synthesis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,scope,priority})})
        job.id = submitted.requestId
        const deadline = Date.now() + (submitted.timeoutMs || 125000)
        let streamed = !onStream
        while (active && !job.cancelled && Date.now() < deadline) {
          const status = await request('synthesis/status?requestId=' + encodeURIComponent(job.id) + '&wait=1' + (streamed ? '' : '&stream=1'),{signal})
          if (!active || job.cancelled) break
          if (status.stream && !streamed) { streamed = true; onStream({...status.stream,url:audioUrl(status.stream.ticket)}) }
          if (status.state === 'ready') return status.result
          if (status.state === 'error') throw failure(status.error,status.status,status.message)
          if (status.state === 'cancelled') throw failure('ABORTED')
        }
        throw failure(active && !job.cancelled ? 'TIMEOUT' : 'ABORTED')
      } finally {
        signal?.removeEventListener('abort',abort); jobs.delete(job)
        if (job.id) void cancel(job.id)
        for (const fn of listeners) fn({type:'modelValidationChanged'})
      }
    },
    async audio(ticket, {signal} = {}) {
      if (!active) throw failure('PLUGIN_UNAVAILABLE')
      if (!enabled) throw failure('TTS_DISABLED')
      const response = await fetch(audioUrl(ticket),{credentials:'same-origin',signal})
      if (!response.ok) throw failure('AUDIO_GONE',response.status)
      const blob = await response.blob()
      if (!active || !enabled || signal?.aborted) throw failure('ABORTED')
      return blob
    }
  })
  async function setEnabled(value) {
    if (!active || enabled === value) return
    enabled = value
    if (!enabled) {
      for (const job of jobs) { job.cancelled = true; if (job.id) void cancel(job.id) }
      for (const fn of listeners) fn({type:'unavailable'})
      listeners.clear()
      if (unprovide) { const stop = unprovide; unprovide = undefined; removing = stop() }
    }
    for (const fn of stateListeners) fn()
    await removing
    if (active && enabled && !unprovide) unprovide = ctx.provide('ttsClient',client)
  }
  ctx.effect(() => {
    const events = new EventSource('/api/dsh-tts/v1/enabled')
    events.onmessage = event => { void setEnabled(JSON.parse(event.data).enabled) }
    events.onerror = () => { void setEnabled(false) }
    return () => {
      events.close(); void setEnabled(false); active = false; stateListeners.clear(); managementListeners.clear()
    }
  })
  // panel UI. one page — no
  // 基础 / 高级 switch (it hid essentials); internal ids (服务 ID / 预设 ID) are never shown.
  const STYLES = '/* client.css is inlined by build.mjs */'
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const style = document.createElement('style'); style.id = 'dsh-tts-styles'; style.textContent = STYLES
    // Native module/HMR ownership must not depend on which factory runs next.
    style.dataset.plugin = 'dsh-tavern-tts'; style.dataset.pluginCss = 'dsh-tavern-tts/client.css'
    document.head.appendChild(style)
    return () => style.remove()
  })
  // 语音服务 → 发音字典 → 合成缓存. Rows are click-to-edit
  // with the form opening right under its row; actions are a quiet trash icon or ⋯; a dashed ＋ adds. No grey subtitles:
  // a row shows its name and, only when something is wrong, a ⚠ chip. Explanations live behind a 「?」.
  // services are named by what they are (never by mechanism): the kind's label from providerKinds (params.js PROVIDER_KINDS).
  const KIND_NOTES = {qwen:'阿里云百炼，按字数计费','fish-audio':'模型在人物「声音」里选','openai-compatible':'任何语音接口：OpenAI 兼容、火山方舟 Agent Plan，或自己填请求和返回格式',azure:'微软 Azure 语音，按字符计费',volcengine:'豆包语音，按字数计费',minimax:'MiniMax 语音，按字符计费；模型在人物「声音」里选'}
  const COMMON_KINDS = ['fish-audio','qwen','azure']
  // async synthesis jobs expose safe codes, never upstream response bodies.
  const FISH_ERRORS = {FISH_AUTH_FAILED:'服务要求鉴权，请填写或检查 API Key 与访问权限',FISH_BILLING_REQUIRED:'Fish Audio 额度或余额不足（402），未切换付费模型',FISH_RATE_LIMITED:'Fish Audio 请求受限（429），请稍后重试',FISH_REQUEST_FAILED:'Fish Audio 请求失败，请检查声音模型 ID 与服务状态'}
  const CODES = {SERVICE_IN_USE:'还有人物在用这个服务',REVISION_CONFLICT:'内容已在别处修改，请重新打开',CREDENTIALS_READ_ONLY:'这个 API Key 由环境变量提供，不能在这里修改',INVALID_PARAMS:'参数超出范围（INVALID_PARAMS）'}
  const failText = e => FISH_ERRORS[e.code || e.message] || CODES[e.code || e.message] || (e instanceof SyntaxError ? 'JSON 格式有误' : /^[A-Z_]+$/.test(e.message) ? '操作失败（' + e.message + '）' : e.message)
  const sizeText = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1024 ** 2 ? (bytes / 1024).toFixed(1) + ' KB' : bytes < 1024 ** 3 ? (bytes / 1024 ** 2).toFixed(1) + ' MB' : (bytes / 1024 ** 3).toFixed(2) + ' GB'
  // Line icons (16 px, currentColor).
  const PATHS = {plus:['M8 3.5v9M3.5 8h9'],trash:['M3 4.5h10','M6.5 4.5V3h3v1.5','M4.5 4.5l.6 8.5h5.8l.6-8.5','M6.8 7v4','M9.2 7v4'],
    warn:['M8 2.5l6 10.5H2z','M8 6.5v3','M8 11.4v.1'],refresh:['M12.8 7.2A4.9 4.9 0 1 0 12 10.6','M13 3.2v3.6H9.4'],check:['M3.5 8.5l3 3 6-6.5'],chevron:['M6 4l4 4-4 4'],close:['M4.5 4.5l7 7','M11.5 4.5l-7 7'],back:['M10 3.5 5.5 8l4.5 4.5']}
  const Icon = ({name,size = 16}) => h('svg',{className:'dtts-icon',width:size,height:size,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},
    name === 'more' ? [3.5,8,12.5].map(x => h('circle',{key:x,cx:x,cy:8,r:1.25,fill:'currentColor'})) :
      PATHS[name].map((d,i) => h('path',{key:i,d,stroke:'currentColor',strokeWidth:1.3,strokeLinecap:'round',strokeLinejoin:'round'})))
  // no grey helper text. Explanations sit behind a small 「?」. Inside Tavern it is Tavern's HelpTip (one 「?」 for every
  // panel): its text floats in <body>, flipped and clamped to the viewport, so the narrow sidebar's edge never cuts it.
  function Help({text,label = '说明'}) {
    const HelpTip = ctx.get('tavernPresentation')?.getHelpTip?.()
    return HelpTip ? h('span',{className:'dtts-help-anchor'},h(HelpTip,{label},text)) : h(StandaloneHelp,{text,label})
  }
  // Without Tavern: the tooltip shows on hover / keyboard focus and toggles on click or tap; Esc or an outside tap closes it.
  function StandaloneHelp({text,label}) {
    const [open,setOpen] = React.useState(false), root = React.useRef(null), id = React.useId()
    React.useEffect(() => {
      if (!open) return
      const out = e => { if (root.current && !root.current.contains(e.target)) setOpen(false) }
      document.addEventListener('pointerdown',out,true); return () => document.removeEventListener('pointerdown',out,true)
    },[open])
    return h('span',{className:'dtts-help-anchor',ref:root,'data-open':open || undefined,onKeyDown:e => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }},
      h('button',{type:'button',className:'dtts-help','aria-label':label,'aria-describedby':id,'aria-expanded':open,onClick:e => { e.preventDefault(); e.stopPropagation(); setOpen(!open) }},'?'),
      h('span',{role:'tooltip',id,className:'dtts-help-tip'},text))
  }
  // ⋯ menu: items {label, onSelect, danger?, disabled?}; Esc / outside tap closes; arrow keys move between items.
  function Menu({label,items}) {
    const [open,setOpen] = React.useState(false), root = React.useRef(null)
    React.useEffect(() => {
      if (!open) return
      const out = e => { if (root.current && !root.current.contains(e.target)) setOpen(false) }
      const key = e => { if (e.key === 'Escape') setOpen(false) }
      const doc = root.current.ownerDocument; doc.addEventListener('pointerdown',out,true); doc.addEventListener('keydown',key,true)
      root.current?.querySelector('[role=menuitem]:not(:disabled)')?.focus?.()
      return () => { doc.removeEventListener('pointerdown',out,true); doc.removeEventListener('keydown',key,true) }
    },[open])
    const move = e => {
      if (!['ArrowDown','ArrowUp'].includes(e.key)) return
      e.preventDefault(); const list = [...root.current.querySelectorAll('[role=menuitem]:not(:disabled)')], i = list.indexOf(root.current.ownerDocument.activeElement)
      list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus()
    }
    return h('span',{className:'dtts-menu-anchor',ref:root},
      h('button',{type:'button',className:'dtts-icon-button','aria-label':label,title:label,'aria-haspopup':'menu','aria-expanded':open,onClick:e => { e.stopPropagation(); setOpen(!open) }},h(Icon,{name:'more'})),
      open && h('div',{className:'dtts-menu',role:'menu','aria-label':label,onKeyDown:move},items.filter(Boolean).map(item => h('button',{key:item.label,type:'button',role:'menuitem',disabled:item.disabled,
        className:item.danger ? 'is-danger' : undefined,onClick:e => { e.stopPropagation(); setOpen(false); item.onSelect() }},item.label))))
  }
  function Section({title,meta,help,action,children,className}) {
    // heading order title → count → 「?」; no accent bar.
    return h('section',{className:'dtts-section' + (className ? ' ' + className : '')},h('header',{className:'dtts-section-head'},h('h3',null,h('span',null,title),meta !== undefined && h('span',{className:'dtts-section-count'},meta),help && h(Help,{text:help,label:title + ' 说明'})),action),children)
  }
  // The 「?」 is a labelable button: with help the row is a div and the text a <label for> the first native control
  // (re-created with an id; child.children covers hook renderers that keep children outside props).
  const FIELD_CONTROLS = new Set(['input','textarea'])
  function Field({label,help,children,top,warning}) {
    const id = React.useId()
    if (!help && !warning) return h('label',{className:'dtts-field' + (top ? ' dtts-field-top' : '')},h('span',{className:'dtts-label'},label),children)
    let target = null
    const items = (Array.isArray(children) ? children : [children]).map(child => { if (!target && child && typeof child === 'object' && FIELD_CONTROLS.has(child.type)) { target = child.props?.id || id; const {children:own,...rest} = child.props, inner = own !== undefined ? own : child.children; return inner === undefined ? h(child.type,{...rest,key:child.key ?? undefined,id:target}) : h(child.type,{...rest,key:child.key ?? undefined,id:target},...(Array.isArray(inner) ? inner : [inner])) } return child })
    return h('div',{className:'dtts-field' + (top ? ' dtts-field-top' : '')},h('span',{className:'dtts-label'},target ? h('label',{htmlFor:target},label) : label,warning,help && h(Help,{text:help,label:label + ' 说明'})),items)
  }
  // Custom single choice (no native <select>): chips in a radiogroup, arrow keys move the choice.
  function Choices({label,value,options,onChange,disabled}) {
    const keys = e => {
      if (!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key) || !options.length) return
      e.preventDefault(); const i = Math.max(0,options.findIndex(o => o[0] === value)), next = options[(i + (/Right|Down/.test(e.key) ? 1 : options.length - 1)) % options.length]
      onChange(next[0]); e.currentTarget.querySelectorAll('[role=radio]')[options.indexOf(next)]?.focus()
    }
    return h('div',{className:'dtts-chips',role:'radiogroup','aria-label':label,onKeyDown:keys},options.map(([key,text,note]) => h('button',{key,type:'button',role:'radio',className:'dtts-chip','aria-checked':value === key,
      tabIndex:value === key || !options.some(o => o[0] === value) && key === options[0][0] ? 0 : -1,disabled,title:note || undefined,onClick:() => onChange(key)},text)))
  }
  const Status = ({label,children}) => children ? h('p',{className:'dtts-status',role:'status','aria-label':label},children) : null
  const Button = ({primary,link,danger,...props}) => h('button',{type:'button',className:primary ? 'dtts-primary' : link ? 'dtts-link' + (danger ? ' is-danger' : '') : 'dtts-button',...props})
  const Warn = ({children,title}) => h('span',{className:'dtts-warn',title:title || undefined,'aria-label':'⚠ ' + (title || children)},h(Icon,{name:'warn',size:13}),children)
  const AddRow = ({label,onClick,disabled}) => h('button',{type:'button',className:'dtts-add','aria-label':label,title:label,disabled,onClick},h(Icon,{name:'plus'}))
  function Confirm({text,yes = '删除',onYes,onNo}) {
    const ref = React.useRef(null)
    React.useEffect(() => { ref.current?.focus?.() },[])
    return h('div',{className:'dtts-confirm',role:'alertdialog','aria-label':text,onKeyDown:e => { if (e.key === 'Escape') onNo() }},h('span',null,text),
      h('span',{className:'dtts-confirm-actions'},h(Button,{onClick:onNo},'取消'),h('button',{ref,type:'button',className:'dtts-button is-danger',onClick:onYes},yes)))
  }
  // A clickable row: the name opens the editor in place; the ⚠ chip and actions stay beside it.
  function Line({title,code,open,onOpen,warn,children,current}) {
    return h('div',{className:'dtts-line','data-open':open || undefined},
      onOpen ? h('button',{type:'button',className:'dtts-line-main','aria-expanded':open,onClick:onOpen},h('span',{className:'dtts-line-caret'},h(Icon,{name:'chevron',size:12})),h('span',{className:'dtts-line-title'},title),code && h('code',null,code))
        : h('span',{className:'dtts-line-main is-static'},h('span',{className:'dtts-line-title'},title),code && h('code',null,code)),
      current, warn, children && h('span',{className:'dtts-line-actions'},children))
  }
  const voiceName = v => v.label && v.label !== v.id ? v.label + ' ' + v.id : v.id
  // `services` answers from a status snapshot; a service still
  // `checking` is read again once a second while the panel is mounted (it never blocks the forms).
  function useServiceData() {
    const [state,setState] = React.useState(null), [error,setError] = React.useState('')
    React.useEffect(() => {
      let mounted = true, timer
      const reload = () => { clearTimeout(timer); call('services').then(value => { if (!mounted) return; setState(value); setError('')
        // a self-hosted server starts and stops by itself: its row asks it again every 15 s while the page is open
        if ((value?.running || []).some(p => p.status?.state === 'checking')) timer = setTimeout(reload,1000)
        else if ((value?.configured || []).some(p => p.selfHosted)) timer = setTimeout(() => { void Promise.allSettled(value.configured.filter(p => p.selfHosted).map(p => call('testService',{id:p.id}))).then(reload) },15000) }).catch(e => { if (mounted) setError(failText(e)) }) }
      reload(); managementListeners.add(reload)
      return () => { mounted = false; clearTimeout(timer); managementListeners.delete(reload) }
    },[])
    return [state,error]
  }
  // One set of state words for every service (浏览器朗读 too; the figure voice page reads the same catalog state):
  // 可用 · 缺少 API Key · API Key 无效 · 连不上 (⚠, the reason in its title) · 正在检查… [tone, word, detail]. A self-hosted server
  // (a local worker) has no key to be wrong: it says 未启动 (nothing answers) or 访问被拒绝 (its token differs). A free connection check
  // runs by itself when the page opens (AutoCheck); a service whose only check costs money (it synthesizes) says 未测试
  // until 测试 is pressed. A local server that idles counts as 可用: it starts when used.
  const costlyCheck = (kind, config = {}) => kind === 'volcengine' || kind === 'openai-compatible' && !config.modelsPath && !config.voicesPath && !config.testPath
  function serviceState(p, kind, live) {
    const missing = (kind?.fields || []).some(f => f.secret && f.required && !p.secrets?.[f.key]?.configured)
    if (missing || p.check?.status === 'credentials-required' || live?.status?.state === 'credentials-required') return ['warn','缺少 API Key']
    if (p.check?.status === 'invalid-key') return ['warn','API Key 无效',p.check.message]
    if (p.check?.status === 'rejected') return ['warn','访问被拒绝',p.check.message]
    if (p.check?.status === 'offline' && p.selfHosted) return ['warn','未启动',p.check.message]
    if (['offline','error'].includes(p.check?.status)) return ['warn','连不上',p.check.message]
    if (live?.status?.state === 'checking') return ['busy','正在检查…']
    if (live && ['offline','error'].includes(live.status?.state)) return ['warn','连不上',live.status.error]
    if (['connected','reachable'].includes(p.check?.status) || live?.status?.state === 'ready') return ['ready','可用']
    return costlyCheck(p.kind, p.config) ? ['idle','未测试'] : ['busy','正在检查…']
  }
  function runningState(p) {
    const state = p.status?.state
    if (state === 'checking') return ['busy','正在检查…']
    return state === 'ready' ? ['ready','可用'] : state === 'credentials-required' ? ['warn','缺少 API Key'] : ['warn','连不上',p.status?.error]
  }
  const StateWord = ([tone,text,title]) => tone === 'warn' ? h(Warn,{title},text) :
    h('span',{className:'dtts-state','data-tone':tone,title:title || undefined},h('span',{className:'dtts-dot','data-state':tone === 'busy' ? 'starting' : tone,'aria-hidden':true}),text)
  // 「去设置」 from a figure's voice page: open that provider's row once (asset-pack-voice-ui.js openVoiceSettings);
  // `id` opens that saved service, `add` opens 添加语音服务 with the kind chosen (the 在线 TTS list's dashed ＋).
  const FOCUS_KEY = 'dsh-tts:focus-service'
  function takeFocus() {
    try { const v = JSON.parse(window.sessionStorage.getItem(FOCUS_KEY)); window.sessionStorage.removeItem(FOCUS_KEY); return v && typeof v.kind === 'string' && Date.now() - v.at < 60000 ? v : null } catch { return null }
  }
  function resultView(r) {
    const count = r.voices?.length ? ' · ' + r.voices.length + ' 个音色' : ''
    const [tone,text] = r.status === 'connected' ? ['ready',(r.message || '可用') + count] : r.status === 'reachable' ? ['ready',r.message || '可用'] :
      r.status === 'credentials-required' ? ['warn','缺少 API Key'] : r.status === 'invalid' ? ['error','配置有误：' + (r.message || '')] : ['error',r.message || '连接失败']
    return h('p',{className:'dtts-result','data-state':tone,role:'status','aria-label':'测试结果'},h(Icon,{name:tone === 'ready' ? 'check' : 'warn',size:14}),text)
  }
  // The browser's own speech is a provider in this list — free, nothing
  // to set up. The Tavern plugin speaks it (ttsBrowserSpeech: voices, speak, stop); without Tavern the row is absent.
  let BrowserSpeech = null
  const browserSpeechListeners = new Set()
  ctx.inject(['ttsBrowserSpeech'], child => child.effect(() => {
    BrowserSpeech = child.get('ttsBrowserSpeech')
    for (const fn of browserSpeechListeners) fn()
    return () => { BrowserSpeech = null; for (const fn of browserSpeechListeners) fn() }
  }))
  const useBrowserSpeech = () => React.useSyncExternalStore(fn => { browserSpeechListeners.add(fn); return () => browserSpeechListeners.delete(fn) },() => BrowserSpeech)
  const BROWSER_SAMPLES = {zh:'你好，这是浏览器朗读的试听。',ja:'こんにちは。ブラウザの読み上げの試聴です。',en:'Hello. This is a browser speech sample.'}
  const browserSample = language => BROWSER_SAMPLES[String(language || '').toLowerCase().split(/[-_]/)[0]] || BROWSER_SAMPLES.en
  // The system voices with ▶ 试听 each; one plays at a time, a second press stops it.
  function BrowserSpeechVoices({service}) {
    const [voices,setVoices] = React.useState(null), [playing,setPlaying] = React.useState('')
    React.useEffect(() => { let mounted = true; service.voices().then(list => { if (mounted) setVoices(list) },() => { if (mounted) setVoices([]) }); return () => { mounted = false; service.stop() } },[service])
    const listen = v => {
      if (playing === v.id) { service.stop(); setPlaying(''); return }
      setPlaying(v.id)
      service.speak({voice:v.id,language:v.languages[0],text:browserSample(v.languages[0])}).finally(() => setPlaying(current => current === v.id ? '' : current))
    }
    return h('div',{className:'dtts-form',role:'group','aria-label':'浏览器朗读的声音'},
      h(Field,{label:'系统声音',help:'这台设备自带的声音，免费，不用设置。给人物用：素材编辑器的人物「声音」→ 配音来源 → 浏览器朗读。由系统直接朗读，不进混音器：音量只跟「总音量 × 语音」，没有响度均衡；电话和片段导出里没有这种声音。'},
        voices === null ? h('span',{className:'dtts-spinner','aria-label':'正在读取'}) : h('span',{className:'dtts-value'},voices.length ? voices.length + ' 个' : '没有系统声音')),
      voices?.length > 0 && h('ul',{className:'dtts-list','aria-label':'系统声音'},voices.map(v => h('li',{key:v.id},h('div',{className:'dtts-item'},
        h('span',{className:'dtts-item-main'},h('span',{className:'dtts-item-title'},v.label),v.languages[0] && h('span',{className:'dtts-item-meta'},v.languages[0])),
        h('span',{className:'dtts-item-actions'},h(Button,{'aria-label':(playing === v.id ? '停止' : '试听') + '「' + v.label + '」','aria-pressed':playing === v.id,onClick:() => listen(v)},playing === v.id ? '停止' : '试听')))))))
  }
  // 浏览器朗读 is the fixed first row — free, nothing to set up, always available; it has no ⋯ (it cannot be removed).
  function ServicesSection({data}) {
    const browserSpeech = useBrowserSpeech(), [browserOpen,setBrowserOpen] = React.useState(false)
    const InlineField = ctx.get('tavernPresentation')?.getInlineField?.()
    const textField = ({label,value,onCommit,secret=false,placeholder='',lines=false}) => InlineField
      ? h(InlineField,{label,hideLabel:true,value,onCommit,secret,placeholder,trim:!secret,...(lines ? {multiline:true,lines:true} : {})})
      : h(lines ? 'textarea' : 'input',{'aria-label':label,value,placeholder,...(lines ? {rows:4} : {type:secret ? 'password' : 'text',autoComplete:secret ? 'new-password' : 'off'}),spellCheck:false,onChange:e => onCommit(e.target.value)})
    const menu = props => InlineField ? h(InlineField,{kind:'menu',hideLabel:true,...props,options:props.options.map(([value,label]) => ({value,label})),onCommit:props.onChange}) : h(Choices,props)
    const cloudFish = config => (config?.url || '').replace(/\/+$/, '') === 'https://api.fish.audio'
    const customKind = kind => kind === 'openai-compatible'
    const [state,loadError] = data
    const [kinds,setKinds] = React.useState([]), [editor,setEditor] = React.useState(null), [message,setMessage] = React.useState(''), [busy,setBusy] = React.useState(false),
      [testing,setTesting] = React.useState(false), [confirm,setConfirm] = React.useState(null)
    React.useEffect(() => { let mounted = true; call('providerKinds').then(k => { if (mounted) setKinds(Array.isArray(k) ? k : []) }).catch(() => {}); return () => { mounted = false } },[])
    const configured = state?.configured || [], external = (state?.running || []).filter(p => !configured.some(c => c.id === p.id))
    const run = fn => async () => { setBusy(true); setMessage(''); try { await fn() } catch(e) { setMessage(failText(e)) } finally { setBusy(false) } }
    const patch = values => setEditor(e => ({...e,...values}))
    const descriptor = kind => kinds.find(k => k.kind === kind)
    const kindLabel = kind => descriptor(kind)?.label || kind
    // a new service starts from its fields' defaults; 自定义语音服务 from its default preset's whole connection.
    const defaults = kind => { const d = descriptor(kind), fields = Object.fromEntries((d?.fields || []).filter(f => !f.secret && f.default !== undefined).map(f => [f.key,f.default]))
      return d?.presets ? {...d.presets[fields.preset]} : fields }
    function uniqueId(kind) {
      const base = {azure:'azure',qwen:'qwen',volcengine:'volc','openai-compatible':'custom','fish-audio':'fish'}[kind] || kind, taken = new Set([...configured,...external].map(p => p.id))
      if (!taken.has(base)) return base
      for (let n = 2; ; n++) if (!taken.has(base + '-' + n)) return base + '-' + n
    }
    function uniqueLabel(kind) {
      const base = kindLabel(kind), taken = new Set(configured.map(p => p.label))
      if (!taken.has(base)) return base
      for (let n = 2; ; n++) if (!taken.has(base + ' ' + n)) return base + ' ' + n
    }
    function chooseKind(kind, custom = false) {
      const config = defaults(kind)
      if (custom && kind === 'fish-audio') config.url = ''
      patch({kind,id:uniqueId(kind),label:custom ? '自定义语音服务' : uniqueLabel(kind),config,secrets:{},probe:null,custom:custom || customKind(kind)})
    }
    const close = () => { setEditor(null); setTesting(false) }
    const startAdd = () => { setMessage(''); setConfirm(null); setEditor({mode:'add',kind:'',id:'',label:'',config:{},secrets:{},probe:null}) }
    const toggleEdit = p => { setMessage(''); setConfirm(null); if (editor?.mode === 'edit' && editor.id === p.id) return close()
      setEditor({mode:'edit',kind:p.kind,id:p.id,label:p.label,config:{...defaults(p.kind),...p.config},originalUrl:p.config.url,secrets:{},stored:p.secrets || {},expectedRevision:p.revision,probe:null,custom:p.category === 'custom' || customKind(p.kind) || p.kind === 'fish-audio' && !cloudFish(p.config)}) }
    const typedSecrets = () => ({...(editor.originalUrl !== undefined && editor.originalUrl !== editor.config.url ? {key:''} : {}),...editor.secrets})
    // 测试 (the API Key row): one real minimal request (see settings.js check()); the saved row picks up the result.
    const probe = async () => {
      setTesting(true); patch({probe:null})
      try { patch({probe:await call('probeService',{id:editor.id,kind:editor.kind,config:editor.config,secrets:typedSecrets()})}) }
      catch(e) { patch({probe:{status:'error',message:failText(e)}}) }
      finally { setTesting(false); for (const fn of managementListeners) fn() }
    }
    // Opening the page checks every saved service whose check is free (a list request: no synthesis, no charge) and that
    // has not been checked since it last changed, so each row says 可用 / 缺少 API Key / API Key 无效 / 连不上 on its own.
    const checked = React.useRef(new Map())
    React.useEffect(() => {
      if (!kinds.length) return
      const due = configured.filter(p => !p.check && !costlyCheck(p.kind,p.config) && !(Date.now() - (checked.current.get(p.id + '@' + p.revision) || 0) < 15000)
        && !(state?.running || []).some(r => r.id === p.id && r.status?.state === 'credentials-required'))
      if (!due.length) return
      for (const p of due) checked.current.set(p.id + '@' + p.revision,Date.now())
      void Promise.allSettled(due.map(p => call('testService',{id:p.id}))).then(() => { for (const fn of managementListeners) fn() })
    },[kinds.length,configured.map(p => p.id + '@' + p.revision + (p.check ? '+' : '')).join()])
    const save = run(async () => {
      if (!editor.label.trim()) throw new Error('请填写名称')
      const secrets = typedSecrets(), saved = await call('saveService',{id:editor.id,kind:editor.kind,label:editor.label.trim(),config:editor.config,
        ...(editor.expectedRevision ? {expectedRevision:editor.expectedRevision} : {}),...(Object.keys(secrets).length ? {secrets} : {})})
      close(); setMessage('已保存「' + saved.label + '」')
    })
    // A saved service saves each field when it is left, like every other setting (owner 11-08: no 取消 / 保存 row); the
    // row's state then checks the new connection by itself (a free check) or says 未测试.
    const commit = values => {
      const next = {...editor,...values,probe:null}
      setEditor(next)
      if (next.mode !== 'edit') return
      if (!next.label.trim()) { setMessage('请填写名称'); return }
      const secrets = {...(next.originalUrl !== undefined && next.originalUrl !== next.config.url ? {key:''} : {}),...next.secrets}
      run(async () => {
        const saved = await call('saveService',{id:next.id,kind:next.kind,label:next.label.trim(),config:next.config,expectedRevision:next.expectedRevision,...(Object.keys(secrets).length ? {secrets} : {})})
        setEditor(e => e?.mode === 'edit' && e.id === saved.id ? {...e,label:saved.label,config:{...defaults(saved.kind),...saved.config},originalUrl:saved.config.url,secrets:{},stored:saved.secrets || {},expectedRevision:saved.revision} : e)
        setMessage('已保存')
        for (const fn of managementListeners) fn()
      })()
    }
    // The state word of a saved service is its 测试: pressing it checks the connection again.
    const [retesting,setRetesting] = React.useState('')
    const retest = p => async () => {
      setRetesting(p.id); setMessage('')
      try { await call('testService',{id:p.id}) } catch(e) { setMessage(failText(e)) } finally { setRetesting(''); for (const fn of managementListeners) fn() }
    }
    const remove = (p,force) => run(async () => {
      try { await call('deleteService',{id:p.id,expectedRevision:p.revision,...(force ? {force:true} : {})}) }
      // without a registered usage source nobody can tell whether a voice uses the service: ask, never hard-fail.
      catch(e) { if (!force && ['SERVICE_IN_USE','USAGE_UNKNOWN'].includes(e.code)) { setConfirm({id:p.id,force:e.code,...(e.code === 'SERVICE_IN_USE' ? await call('serviceUsage',{id:p.id}) : {})}); return } throw e }
      setConfirm(null); if (editor?.id === p.id) close(); setMessage('已删除「' + p.label + '」')
    })
    const fieldView = f => {
      const value = editor.config[f.key] ?? '', set = v => commit({config:{...editor.config,[f.key]:v},
        ...(f.key === 'url' ? {custom:editor.kind === 'fish-audio' ? !cloudFish({url:v}) : editor.custom} : {})})
      // a preset is a starting point: picking one fills the whole connection (the typed address stays when it has none).
      if (f.type === 'preset') { const presets = descriptor(editor.kind).presets
        return h(Field,{key:f.key,label:f.label},menu({label:f.label,value,options:f.options,onChange:v => commit({config:{...presets[v],url:presets[v].url || editor.config.url || ''}})})) }
      if (f.type === 'select') return h(Field,{key:f.key,label:f.label,help:f.help},menu({label:f.label,value,options:f.options,onChange:set}))
      return h(Field,{key:f.key,label:f.label,help:f.help,top:f.type === 'lines'},textField({label:f.label,value:String(value),placeholder:f.placeholder || (f.required ? '' : '选填'),lines:f.type === 'lines',onCommit:set}))
    }
    // The API Key field: a stored key shows as dots; × at the field's end clears it (owner 11-08). A new service tests
    // from the field's end before it is added; a saved one tests from its state word.
    const costly = editor ? costlyCheck(editor.kind,editor.config) : false
    const secretField = (f,last) => { const stored = editor.stored?.[f.key]?.configured && !Object.hasOwn(editor.secrets,f.key)
      return h(Field,{key:f.key,label:f.label,help:'API Key 交给 DSH 凭据存储，不写进设置、预设或卡片；保存后不再显示。'},
        h('span',{className:'dtts-key-row'},h('span',{className:'dtts-key-field'},textField({secret:true,label:f.label,value:editor.secrets[f.key] || '',
          placeholder:stored ? '•••••••••• 已保存' : editor.custom ? '选填' : '',onCommit:value => commit({secrets:{...editor.secrets,[f.key]:value}})})),
          // × sits beside the box, not inside it: the box's own end holds the shared edit ✎ (ui-design R23).
          stored && h('button',{type:'button',className:'dtts-key-clear','aria-label':'清除 ' + f.label,title:'清除已保存的 ' + f.label,disabled:busy,onClick:() => commit({secrets:{...editor.secrets,[f.key]:''}})},h(Icon,{name:'close',size:14})),
          last && editor.mode !== 'edit' && h(Button,{link:true,disabled:testing || busy,title:costly ? '会真的合成一个字来验证 API Key，可能产生极少费用' : undefined,onClick:probe},'测试'))) }
    function Form() {
      const kind = descriptor(editor.kind)
      if (!kind) return null
      return h('div',{className:'dtts-form',role:'group','aria-label':editor.mode === 'add' ? '添加语音服务' : '编辑 ' + editor.label},
        h(Field,{label:'协议类型'},editor.custom && editor.kind === 'fish-audio' ? '自定义 Fish 协议' : kind.label),
        h(Field,{label:'显示名称'},textField({label:'显示名称',value:editor.label,onCommit:label => commit({label})})),
        kind.fields.filter(f => !f.secret && !f.more).map(fieldView),
        kind.fields.filter(f => f.secret).map((f,i,all) => secretField(f,i === all.length - 1)),
        // 自定义语音服务: the preset fills the request and response; they sit under 高级.
        kind.fields.some(f => f.more) && h('details',{className:'dtts-details'},h('summary',null,'高级：请求与返回格式'),kind.fields.filter(f => f.more).map(fieldView)),
        // a new service with no key field (a local server) tests from its own row before it is added.
        editor.mode !== 'edit' && !kind.fields.some(f => f.secret) && h(Field,{label:'连接'},h('span',{className:'dtts-key-row'},h('span',{className:'dtts-value'}),h(Button,{link:true,disabled:testing || busy,onClick:probe},'测试'))),
        editor.mode !== 'edit' && h('div',{className:'dtts-actions'},
          h('span',{className:'dtts-actions-start'},(testing || editor.probe) && (testing ? h('p',{className:'dtts-result',role:'status','aria-label':'测试结果'},h('span',{className:'dtts-spinner','aria-hidden':true}),'正在连接…') : resultView(editor.probe))),
          h(Button,{onClick:close},'取消'),
          h(Button,{primary:true,disabled:busy,onClick:save},'添加')))
    }
    const editing = id => editor?.mode === 'edit' && editor.id === id
    // Fish Audio / 通义千问 / Azure are listed before they are set up (the row opens its key form); a registered local engine row opens
    // the engine's own controls in place (no second section).
    const unset = state ? COMMON_KINDS.filter(k => !configured.some(c => c.kind === k) && kinds.some(d => d.kind === k)) : []
    const startKind = kind => { if (editor?.mode === 'add' && editor.fixed && editor.kind === kind) return close(); setMessage(''); setConfirm(null)
      setEditor({mode:'add',kind:'',id:'',label:'',config:{},secrets:{},probe:null,fixed:true}); chooseKind(kind) }
    const root = React.useRef(null)
    // A request also arrives while this page is already mounted (the same key's window event, after the tab opened).
    const [focusAsked,setFocusAsked] = React.useState(0)
    React.useEffect(() => { const ask = () => setFocusAsked(n => n + 1); window.addEventListener(FOCUS_KEY,ask); return () => window.removeEventListener(FOCUS_KEY,ask) },[])
    React.useEffect(() => {
      if (!state || !kinds.length) return
      const focus = takeFocus(); if (!focus) return
      // kind '' (「语音后端 ›」): the page as it is, with the keyboard focus on its first service.
      const kind = focus.kind, own = !kind || kind === 'local' ? null : configured.find(c => focus.id ? c.id === focus.id : c.kind === kind)
      if (!kind) {} else if (focus.add && descriptor(kind)) { startAdd(); chooseKind(kind) } else if (kind === 'local') setLocalOpen(true); else if (own) { if (!editing(own.id)) toggleEdit(own) } else startKind(kind)
      setTimeout(() => {
        const target = kind ? root.current?.querySelector('[data-open] .dtts-line-main, .dtts-adding-fixed') || root.current?.parentElement?.querySelector('.dtts-adding') : root.current?.querySelector('.dtts-line-main')
        target?.scrollIntoView?.({block:'center'}); target?.focus?.({preventScroll:true})
      },50)
    },[!!state,kinds.length,focusAsked])
    const count = state ? configured.length + external.length + unset.length + (browserSpeech ? 1 : 0) : undefined
    return h(Section,{title:'语音合成',meta:count,help:'合成声音的服务，这台电脑设一次，所有卡通用。人物用哪一个，在素材编辑器的人物「声音」里选。'},
      !state ? h('p',{className:'dtts-muted dtts-loading',role:loadError ? 'alert' : undefined},loadError ? h(Warn,null,loadError) : h('span',{className:'dtts-spinner','aria-label':'正在载入'})) :
      h('ul',{className:'dtts-list',ref:root},
        browserSpeech && h('li',{key:'browser','data-open':browserOpen || undefined},
          h(Line,{title:'浏览器朗读',open:browserOpen,onOpen:() => setBrowserOpen(!browserOpen),warn:StateWord(!browserSpeech.available() ? ['warn','这台设备不支持'] : ['ready','可用'])}),
          browserOpen && h(BrowserSpeechVoices,{service:browserSpeech})),
        configured.map(p => { const live = (state.running || []).find(r => r.id === p.id); return h('li',{key:p.id,'data-open':editing(p.id) || undefined},
          h(Line,{title:p.label,open:editing(p.id),onOpen:() => toggleEdit(p),warn:h('button',{type:'button',className:'dtts-state-test',disabled:retesting === p.id || busy,onClick:retest(p),
              'aria-label':'重新测试 ' + p.label,title:costlyCheck(p.kind,p.config) ? '点一下重新测试（会真的合成一个字，可能产生极少费用）' : '点一下重新测试'},
              StateWord(retesting === p.id ? ['busy','正在检查…'] : serviceState(p,descriptor(p.kind),live)))},
            // no resident delete on the row — 删除… sits in the row's ⋯.
            h(Menu,{label:p.label + ' 更多操作',items:[{label:'删除…',danger:true,disabled:busy,onSelect:() => { setConfirm({id:p.id}) }}]})),
          confirm?.id === p.id && h(Confirm,{text:{SERVICE_IN_USE:'还有 ' + confirm.count + ' 个人物在用「' + p.label + '」，仍要删除？',USAGE_UNKNOWN:'不确定有没有人物在用「' + p.label + '」，仍要删除？'}[confirm.force] || '删除「' + p.label + '」？',
            yes:confirm.force ? '仍要删除' : '删除',onYes:remove(p,!!confirm.force),onNo:() => setConfirm(null)}),
          editing(p.id) && Form()) }),
        unset.map(kind => { const open = editor?.mode === 'add' && editor.fixed && editor.kind === kind; return h('li',{key:'+' + kind,'data-open':open || undefined},
          h(Line,{title:kindLabel(kind),open,onOpen:() => startKind(kind),warn:StateWord(['idle','未设置'])}),open && h('div',{className:'dtts-adding-fixed'},Form())) }),
        external.map(p => h('li',{key:p.id},h(Line,{title:p.label || kindLabel(p.kind),warn:StateWord(runningState(p))})))),
      editor?.mode === 'add' && !editor.fixed ? h('div',{className:'dtts-adding'},
          h('div',{className:'dtts-adding-head'},h('span',{className:'dtts-label'},'选择协议类型'),!editor.kind && h(Button,{link:true,onClick:close},'取消')),
          h('div',{className:'dtts-kinds',role:'radiogroup','aria-label':'协议类型'},h('button',{type:'button',role:'radio',className:'dtts-kind','aria-checked':!!editor.custom && editor.kind === 'fish-audio',onClick:() => chooseKind('fish-audio',true)},'自定义 Fish 协议'),kinds.map(k => h('button',{key:k.kind,type:'button',role:'radio',className:'dtts-kind','aria-checked':editor.kind === k.kind && !(editor.custom && k.kind === 'fish-audio'),
            title:KIND_NOTES[k.kind] || undefined,onClick:() => chooseKind(k.kind)},k.label))),
          editor.kind && Form())
        : state && h(AddRow,{label:'添加其他语音服务',disabled:busy,onClick:startAdd}),
      h(Status,{label:'服务状态'},message))
  }
  // 上限 / 保留天数 save when a field is left (R17 即改即存; no 「保存缓存设置」). `loading` is a cold
  // snapshot, not the final total: read again until it is done (CONTRACT).
  function CacheSection() {
    const [cache,setCache] = React.useState(null), [message,setMessage] = React.useState(''), [limits,setLimits] = React.useState({cacheMaxGB:1,cacheMaxAgeDays:30}), [confirm,setConfirm] = React.useState(false)
    const update = stats => { setCache(stats); setLimits({cacheMaxGB:stats.maxBytes / 1024 ** 3,cacheMaxAgeDays:stats.maxAgeDays}) }
    React.useEffect(() => {
      let mounted = true, timer
      const read = () => call('cache').then(stats => { if (!mounted) return; update(stats); if (stats.loading) timer = setTimeout(read,1000) }).catch(e => { if (mounted) setMessage(failText(e)) })
      read(); return () => { mounted = false; clearTimeout(timer) }
    },[])
    const run = (fn,done) => async () => { try { await fn(); update(await call('cache')); setMessage(done) } catch(e) { setMessage(failText(e)) } }
    const commit = (key,value) => { if (!cache || !Number.isFinite(value) || value <= 0) return; const next = {...limits,[key]:value}; setLimits(next)
      if ((key === 'cacheMaxGB' ? cache.maxBytes / 1024 ** 3 : cache.maxAgeDays) !== value) run(() => call('saveCacheSettings',next),'已保存')() }
    return h(Section,{title:'合成缓存',help:'合成过的台词存在这台电脑上，重播不再花钱。超过保留天数的先删，再按上限删最久没用的；不动卡片里的参考录音。'},
      h('div',{className:'dtts-line'},h('output',{'aria-label':'缓存用量',className:'dtts-line-main is-static dtts-value'},cache?.error ? h(Warn,null,'读不到缓存目录') : !cache || cache.loading ? h('span',{className:'dtts-spinner','aria-label':'正在统计'}) : sizeText(cache.bytes) + ' · ' + cache.count + ' 条'),
        h('span',{className:'dtts-line-actions'},h(Button,{onClick:() => setConfirm(true),disabled:!cache},'清空…'))),
      confirm && h(Confirm,{text:'清空全部合成缓存？重播时会重新合成。',yes:'清空',onYes:() => { setConfirm(false); run(() => call('clearCache',{all:true}),'缓存已清空')() },onNo:() => setConfirm(false)}),
      [['cacheMaxGB','上限（GB）',0.1,100,'any'],['cacheMaxAgeDays','保留天数',1,3650,1]].map(([key,label,min,max,step]) => h(Field,{key,label},
        h('input',{name:key,'aria-label':label,type:'number',min,max,step,className:'dtts-number fork-edit',value:limits[key],disabled:!cache,onChange:e => setLimits({...limits,[key]:e.target.value}),
          onBlur:e => commit(key,Number(e.target.value)),onKeyDown:e => { if (e.key === 'Enter') e.currentTarget.blur() }}))),
      h(Status,{label:'缓存状态'},message))
  }
  // the 读音词典 (named presets, one active, a windowed 写法 → 读音 list) is
  // drawn by the Tavern plugin with the shared panel components (ttsReadingsEditor); this page only places it and hands
  // over the control RPC. Without Tavern the section is absent.
  let ReadingsEditor = null
  const readingsListeners = new Set()
  ctx.inject(['ttsReadingsEditor'], child => child.effect(() => {
    ReadingsEditor = child.get('ttsReadingsEditor').render
    for (const fn of readingsListeners) fn()
    return () => { ReadingsEditor = null; for (const fn of readingsListeners) fn() }
  }))
  function ReadingsSection() {
    const render = React.useSyncExternalStore(fn => { readingsListeners.add(fn); return () => readingsListeners.delete(fn) },() => ReadingsEditor)
    return render ? h('section',{className:'dtts-section dtts-readings'},render({call})) : null
  }
  let sidebar = null
  // generic, short-lived return intent; the destination owns payload consumption.
  const returnKey = 'dsh:settings-return'
  const openSettingsTab = toTab => { if (!sidebar) throw new Error('当前页面无法切换设置标签'); return sidebar.openTab({type:toTab}) }
  function readReturnIntent() {
    try {
      const intent = JSON.parse(window.sessionStorage.getItem(returnKey))
      if (!intent || typeof intent.toTab !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{0,159}$/i.test(intent.toTab) || intent.toTab === 'dsh-tts:voice' || typeof intent.label !== 'string' || !intent.label.trim() || intent.label.length > 80 || !intent.payload || typeof intent.payload !== 'object' || Array.isArray(intent.payload) || !Number.isFinite(intent.createdAt) || Date.now() < intent.createdAt || Date.now() - intent.createdAt >= 600000 || intent.consumedBy) return null
      return intent
    } catch { return null }
  }
  // Optional plugin-owned sections; the voice backend does not manage their services.
  const panelSections = new Map(), panelListeners = new Set()
  let panelSnapshot = []
  const publishSections = () => { panelSnapshot = [...panelSections.values()]; for (const notify of panelListeners) notify() }
  ctx.provide('ttsPanelSections', Object.freeze({
    register(id, component) {
      if (panelSections.has(id)) throw new Error('Duplicate TTS panel section: ' + id)
      const entry = { id, component }
      panelSections.set(id, entry); publishSections()
      return () => { if (panelSections.get(id) === entry) { panelSections.delete(id); publishSections() } }
    },
  }))
  function PluginSections() {
    const sections = React.useSyncExternalStore(notify => { panelListeners.add(notify); return () => panelListeners.delete(notify) }, () => panelSnapshot)
    return sections.map(({ id, component }) => h(component, { key: id, Section, Field, Line, Confirm, Help, Button, Menu, AddRow, StateWord, Status, Warn }))
  }
  function VoicePanel() {
    const current = React.useSyncExternalStore(fn => {stateListeners.add(fn);return () => stateListeners.delete(fn)},() => enabled)
    const [message,setMessage] = React.useState(''), services = useServiceData()
    const [returnIntent,setReturnIntent] = React.useState(readReturnIntent), root = React.useRef(null)
    React.useEffect(() => {
      if (!returnIntent) return
      const timer = setTimeout(() => setReturnIntent(null),Math.max(0,600000 - (Date.now() - returnIntent.createdAt)))
      return () => clearTimeout(timer)
    },[returnIntent])
    const returnToSettings = async () => {
      const current = readReturnIntent()
      if (!current || JSON.stringify(current) !== JSON.stringify(returnIntent)) { setReturnIntent(null); return }
      const marked = JSON.stringify({...current,consumedBy:'dsh-tavern-tts'})
      try {
        window.sessionStorage.setItem(returnKey,marked)
        await openSettingsTab(current.toTab)
        setReturnIntent(null)
      } catch {
        try { if (window.sessionStorage.getItem(returnKey) === marked) window.sessionStorage.setItem(returnKey,JSON.stringify(current)) } catch {}
        setMessage('暂时无法返回，请重试')
      }
    }
    return h('div',{className:'dtts',ref:root},
      // opened from 舞台设置 › 配音, the page shows the shared sub-page header —
      // a quiet ‹ (its name and tooltip are the return label) right before the title, no separate link line.
      h('header',{className:'dtts-head'},h('div',{className:'dtts-title'},returnIntent && sidebar && h('button',{type:'button',className:'dtts-back','aria-label':returnIntent.label,title:returnIntent.label,onClick:returnToSettings},h(Icon,{name:'back',size:18})),h('h2',null,'语音后端'),h(Help,{label:'语音后端 说明',text:'这台电脑能用的语音合成与语音识别服务，每个单独设置。谁用什么声音在「舞台设置 › 配音」里选，手机通话用哪个识别在手机模组的设置里选。'})),
        // the master switch sits on the title row (no 基础 / 高级 switch any more).
        h('label',{className:'dtts-head-switch',title:'启用配音'},h('input',{type:'checkbox',role:'switch',className:'dtts-switch','aria-label':'启用配音',checked:current === true,disabled:current === null,onChange:async e => {
          try { await call('setEnabled',{enabled:e.target.checked}); setMessage('') } catch (error) {setMessage(failText(error))}
        }}))),
      h(Status,{label:'配音状态'},message),
      // 语音服务 → 发音字典 → 合成缓存. Who speaks with which voice is chosen in 舞台设置 › 配音 (tts.reading through setReading).
      h(ServicesSection,{data:services}),h(PluginSections),h(ReadingsSection),h(CacheSection))
  }
  const icon = size => h('svg',{width:size || 16,height:size || 16,viewBox:'0 0 16 16',fill:'none','aria-hidden':true},
    h('path',{d:'M2.5 6.5v3M5.25 4.5v7M8 2.5v11M10.75 5v6M13.5 6.5v3',stroke:'currentColor',strokeWidth:1.2,strokeLinecap:'round'}))
  ctx.slots.inject('settings.section',() => ctx.slots.register({name:'settings.section',id:'tts',order:70,label:() => '语音后端'},VoicePanel))
  ctx.inject(['betterSidebar'], child => child.effect(() => {
    sidebar = child.get('betterSidebar')
    const dispose = sidebar.registerTab({id:'dsh-tts:voice',title:'语音后端',order:10,single:true,icon,component:VoicePanel})
    return () => { dispose(); sidebar = null }
  }))
  ctx.inject(['tavernUi'], child => { child.get('tavernUi').registerStartGroup({title:'舞台装置',tabs:['dsh-tts:voice']}) })
}
