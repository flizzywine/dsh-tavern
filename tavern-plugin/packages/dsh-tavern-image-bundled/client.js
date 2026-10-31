/* dsh-tavern-image 浏览器半边。
 *
 * 正文里的图**不再由插件接管渲染**。Tavern 开放官方插件接口后，宿主侧的
 * tavern.attach 已经能把图片和正文版本绑在一起（回退自动隐藏、切回来又出现），
 * 浏览器这边只负责注册与画界面：
 *   1. tavernUi.registerMediaRenderer  画自定义媒体类型（大图 / 右键改提示词 / 查看器）
 *   2. tavernUi.registerMessageAction  消息下方那颗「🎨 生图」按钮
 *   3. tavernUi.registerTextMarker     正文里模型自己写的 image###...### 标记
 *   4. 设置面板（设置 → 配图）/ 历史图库 / 人物库 / 世界书 —— 插件自己的界面
 *
 * 配置读取失败时安静退化成纯文本，绝不在宿主启动阶段抛错。 */
window.__ModuleLoader__.load({
  // DSH resolves browser registrations by package.json.name.
  id: 'dsh-tavern-image',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    let React = null
    try { React = require('react') } catch (error) {
      try { console.warn('[dsh-tavern-image] React 不可用，浏览器界面已禁用:', error?.message) } catch {}
      exports.apply = () => {}
      exports.inject = []
      return module.exports
    }

    const h = React.createElement
    const { useEffect, useState } = React
    // Tavern 的浏览器接口（tavernUi），注入后填上；设置页的画廊用它读 Tavern 原生生图的旧图。
    let tavernUiService = null

    // 插件接口前缀。正文渲染跑在 Tavern 的渲染上下文里（不一定等于插件页面的 base），
// 用相对路径会被解析到错误地址、图片直接加载失败，所以这里必须拼成绝对地址。
const absoluteBase = (() => {
  const candidates = []
  try { if (window.top && window.top.location && window.top.location.origin) candidates.push(window.top.location.origin) } catch {}
  try { if (location.origin) candidates.push(location.origin) } catch {}
  try { if (document.baseURI) candidates.push(new URL(document.baseURI).origin) } catch {}
  const origin = candidates.find(o => o && o !== 'null' && /^https?:/i.test(o))
  return (origin || '') + '/plugins/dsh-tavern-image'
})()
const BASE = absoluteBase
const IMAGE_REFERENCE_PROTOCOLS = new Set(['openai', 'gemini', 'gemini-chat', 'atlascloud', 'seedream', 'grok', 'qwen', 'sdwebui'])
function uiSupportsImageReferences(channel, state) {
  if (!channel) return state?.referenceSupported === true
  const provider = String(channel.provider || '')
  if (provider === 'comfyui') return state?.referenceSupported === true && state?.config?.imageBackend === 'comfyui'
  const protocol = provider === 'custom' ? String(channel.options?.apiProtocol || 'openai') : provider
  return IMAGE_REFERENCE_PROTOCOLS.has(protocol)
}

function createHistoryRequestEpoch() {
  let activeGameId = ''
  let generation = 0
  let gameGeneration = 0
  return {
    activate(gameId) {
      const next = String(gameId ?? '')
      if (next !== activeGameId) { activeGameId = next; generation++; gameGeneration++ }
    },
    begin(gameId) { this.activate(gameId); return ++generation },
    isActive(gameId) { return String(gameId ?? '') === activeGameId },
    isCurrent(gameId, token) { return String(gameId ?? '') === activeGameId && token === generation },
    captureGame(gameId) { this.activate(gameId); return gameGeneration },
    isGameCurrent(gameId, token) { return String(gameId ?? '') === activeGameId && token === gameGeneration },
    invalidate(gameId) { if (String(gameId ?? '') === activeGameId) { generation++; gameGeneration++ } },
  }
}

function indexedHistoryChanges(changes) {
  return (Array.isArray(changes) ? changes : []).map((change, index) => ({ change, index })).reverse()
}

function createMessageDrawRunner(send, onStart) {
  const inFlight = new Map()
  return context => {
    const gameId = String(context && context.gameId || '')
    const turn = Number(context && context.turn)
    if (!gameId || !Number.isSafeInteger(turn) || turn < 1) return Promise.resolve(null)
    const instruction = typeof (context && context.instruction) === 'string' ? context.instruction.trim() : ''
    const key = JSON.stringify([gameId, turn, instruction])
    if (inFlight.has(key)) return inFlight.get(key)
    try { onStart?.(context) } catch {}
    const request = Promise.resolve().then(() => send(context))
    inFlight.set(key, request)
    request.finally(() => { if (inFlight.get(key) === request) inFlight.delete(key) }).catch(() => {})
    return request
  }
}

// 图像查看器的开启函数：由查看器组件挂载时赋值（见下面的 openImageOverlay = ...）。
// 必须在这里显式声明 —— 它以前是「不带声明的赋值」，靠非严格模式在 window 上造一个
// 隐式全局变量。一旦 bundle 被包进严格模式，那行赋值会直接 ReferenceError，而周围
// 十几处 `if (typeof openImageOverlay === 'function')` 守卫会静默放过，
// 表现成「查看器永远打不开、也没有任何报错」。
let openImageOverlay = null

    // 把浏览器里发生的事发回宿主：前端到底跑没跑、有没有抛错，宿主的 /state 里看得到
    //
    // ⚠ 性能守卫（2026-10-07 加入）：本函数被放在**渲染热路径**上调用
    //   （renderAssistantText 每次渲染 → 'renderer-takeover'；
    //     register 的渲染器每次被调 → 'renderer-calls'）。
    //   原来每次调用都发一个 POST，一个几千条消息的会话每轮重渲染就会打出几千个请求，
    //   连接池打满、事件循环被 fetch/JSON 反复占用 —— 实测导致渲染进程被 DSH 看门狗判为
    //   「页面无响应」并反复终止（minidump 显示主线程持续在 V8 中执行、不 yield）。
    //   现在：按 stage+data 指纹去重，同一指纹只在首次发送；并发与总量各有上限；
    //   热路径上的指纹超预算直接丢弃。冷路径（错误、注册结果等）不受影响。
    const REPORT_CONCURRENCY = 6
    const REPORT_TOTAL_BUDGET = 60
    const seenReports = new Set()
    let reportInFlight = 0
    let reportSent = 0
    // 这些 stage 出现在渲染热路径上，指纹超预算时必须丢弃，不能积压
    const HOT_REPORT_STAGES = new Set(['renderer-takeover', 'renderer-called', 'plannedbody-mounted'])
    // 这些是低频且关键的取证上报：不受总量与并发限制，必须发出去。
    // 2026-10-07：history-fail 曾经一条都收不到 —— 因为聊天渲染的 renderer-called
    // 把 6 个并发槽占满，非热路径的失败上报被静默丢弃，导致无法定位真因。
    const CRITICAL_REPORT_STAGES = new Set([
      'history-fail', 'history-ok', 'fetch-retry', 'state-fail',
      'window-error', 'unhandled-rejection',
      // Tavern 官方接口的注册结果：一次会话只会报一次，而且必须能看到（否则没法判断渲染器到底装没装）
      'tavernui-attached', 'tavernui-missing', 'tavernui-marker-registered', 'tavernui-marker-failed',
      'tavernui-media-registered', 'tavernui-media-failed', 'tavernui-action-failed',
      'apply-start', 'seat-registered', 'seat-failed',
    ])

    function reportFingerprint(stage, data) {
      try { return stage + '|' + JSON.stringify(data ?? null) } catch { return stage + '|' }
    }

    function reportHost(stage, data) {
      try {
        const key = reportFingerprint(stage, data)
        // 同一指纹只报一次（去重：这是原来请求量爆炸的主因）
        if (seenReports.has(key)) return
        if (!CRITICAL_REPORT_STAGES.has(stage)) {
          if (reportSent >= REPORT_TOTAL_BUDGET) {
            if (HOT_REPORT_STAGES.has(stage)) return   // 热路径：直接丢弃
            if (seenReports.size > 2000) seenReports.clear()
          }
          if (reportInFlight >= REPORT_CONCURRENCY) {
            if (HOT_REPORT_STAGES.has(stage)) return   // 热路径：宁可丢也不排队
            return
          }
        }
        seenReports.add(key)
        reportSent += 1
        reportInFlight += 1
        fetch(BASE + '/report', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stage, data }),
        }).catch(() => {}).finally(() => { reportInFlight -= 1 })
      } catch { /* 报告本身绝不能影响功能 */ }
    }
    // 客户端版本戳：重启 DSH 后可以在 /state 的 clientReports 里确认加载的是哪一版
    const CLIENT_BUILD = 'client-2026-10-09-multi-provider-graph'
    reportHost('bundle-evaluated', { at: Date.now(), href: String(location?.href ?? '').slice(0, 120), build: CLIENT_BUILD, features: 'character-picker,batch-select,safe-design-save,single-caption,plugin-update,system-option-colors,readable-panel,multi-provider-channels,workflow-graph' })

    try {
      window.addEventListener('error', event => {
        reportHost('window-error', {
          message: String(event?.message ?? '').slice(0, 300),
          source: String(event?.filename ?? '').slice(0, 160),
          line: event?.lineno ?? 0,
          stack: String(event?.error?.stack ?? '').slice(0, 900),
        })
      })
      window.addEventListener('unhandledrejection', event => {
        reportHost('unhandled-rejection', { reason: String(event?.reason?.message ?? event?.reason ?? '').slice(0, 500) })
      })
    } catch { /* 老环境没有这些事件就算了 */ }
    // 当前会话 id：设置页里点「让 agent 设计角色」时要拿它去读卡片设定
    let lastSessionId = ''
    // 每条助手消息的正文（消息下方那个「生图」按钮要用它）
    const textByMessage = new Map()
    const IMAGE_TAG = /image###((?:(?!image###|###)[^\r\n])*?)(?:###|(?=\r?\n)|$)/gi

    function usablePrompt(raw) {
      const prompt = String(raw ?? '').trim()
      return /[^#]/.test(prompt) ? prompt : ''
    }

    /** 把正文切成 text / image 两种段落。
     *  ⚠ 记忆化（2026-10-07）：本函数在渲染热路径上每条消息每次渲染都会被调用，
     *  且正文可能上万字符。按 text 缓存最近一次结果（渲染是顺序的，命中率很高），
     *  避免重复做正则扫描与切片。 */
    let segmentCacheText = null
    let segmentCacheValue = null
    function splitSegments(text) {
      const source = String(text ?? '')
      if (source === segmentCacheText && segmentCacheValue) return segmentCacheValue
      const segments = []
      const regex = new RegExp(IMAGE_TAG.source, IMAGE_TAG.flags)
      let cursor = 0
      for (const match of source.matchAll(regex)) {
        const index = match.index ?? 0
        const prompt = usablePrompt(match[1])
        if (index > cursor) segments.push({ type: 'text', value: source.slice(cursor, index) })
        if (prompt) segments.push({ type: 'image', prompt })
        cursor = index + match[0].length
      }
      if (cursor < source.length) segments.push({ type: 'text', value: source.slice(cursor) })
      segmentCacheText = source
      segmentCacheValue = segments
      return segments
    }

    /** 正文指纹（和 host 侧一致），用来认领"模型主动调工具生成的那一批图"。 */
    function textHash(value) {
      let a = 2166136261
      const source = String(value ?? '')
      for (let i = 0; i < source.length; i++) a = Math.imul(a ^ source.charCodeAt(i), 16777619)
      return (a >>> 0).toString(36)
    }

    /** 内容键：同一段提示词在同一位置只画一次，翻历史、刷新页面都复用。 */
    function contentKey(messageId, turn, index, prompt) {
      const text = `${messageId ?? ''}|${turn ?? ''}|${index}|${prompt}`
      let a = 2166136261
      for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619)
      return 'k' + (a >>> 0).toString(36)
    }

    // 单次请求，不做任何兜底
    function jsonFetchOnce(url, init) {
      return fetch(url, init).then(async response => {
        let data = null
        try { data = await response.json() } catch { data = null }
        if (!response.ok || (data && data.ok === false)) {
          throw Object.assign(new Error((data && data.error) || `HTTP ${response.status}`), {
            code: data && data.code,
            submissionNotStarted: data && data.submissionNotStarted === true,
          })
        }
        return data
      })
    }

    /**
     * 带自愈的请求：默认带 cache:'no-store'（避免中间层缓存住状态），
     * 若在网络层直接失败（TypeError: Failed to fetch），退回不带任何 cache 选项重发一次。
     * 2026-10-07 加入：/state 正常而 /history 报 Failed to fetch，用重试兜底并上报取证。
     */
    async function jsonFetch(url, init) {
      // 仅自动重试无副作用的读取请求。POST 等写请求若服务端已执行、但响应丢失，
      // 重发可能重复扣费或重复创建任务，因此网络错误也必须交给调用者处理。
      const method = String(init?.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') return jsonFetchOnce(url, init)
      // 三次尝试：原样 → 去掉 cache 选项 → 再去掉 cache 选项（间隔退避）。
      const attempts = [{ cache: 'no-store', ...(init ?? {}) }, init ?? undefined, init ?? undefined]
      let lastError
      for (let i = 0; i < attempts.length; i += 1) {
        try {
          return await jsonFetchOnce(url, attempts[i])
        } catch (error) {
          lastError = error
          if (!(error instanceof TypeError)) throw error
          if (i === 0) reportHost('fetch-retry', { tail: String(url).slice(-40), msg: String(error.message || '') })
          if (i < attempts.length - 1) await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)))
        }
      }
      throw lastError
    }

    // 正文兜底渲染：模块级常量，保证引用稳定（见 renderAssistantText 里的说明）
    const FALLBACK_RENDER_TEXT = (value, key) => h('span', { key }, String(value ?? ''))

    // 注意：Tavern 的 .dsh-tavern-illustration 是 flex 列容器且 align-items:flex-start，
    // 子元素默认宽度由内容决定（图片多宽就多宽）。显式撑满，宽度设置与容器测量才有参照。
    // 不能写 width:100%：Tavern 插图容器是 flex 列容器且 align-items:flex-start，子元素宽度由内容决定，
    // 写 100% 会让「我的宽度依赖父容器、父容器又由我决定」形成循环，
    // 浏览器只能按最小内容解析，图会塔缩成缩略图大小（实测设 2000 只显示 95px）。
    const wrapStyle = { margin: '14px 0', textAlign: 'center' }
    const imgStyle = { maxWidth: '100%', borderRadius: '10px', cursor: 'zoom-in', background: '#111' }
    const noteStyle = { display: 'inline-block', padding: '10px 16px', borderRadius: '10px', fontSize: '13px',
      color: 'var(--dsw-alias-label-tertiary)', border: '1px dashed var(--dsw-alias-border-l2)', background: 'transparent' }
    const buttonStyle = { padding: '8px 16px', borderRadius: '9px', border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: '13px' }

    // ---- 正文插图的统一显示宽度（全局设置）---------------------------------
    // 只改正文里的显示宽度：不重采样原图、不改生成分辨率，点开后的全屏看图也不受影响。
    // 启动时从 /state 读一次（刷新/重启后依然生效），设置里保存成功后立刻更新。
    // 正文渲染只读这个变量 —— 每张图都不再单独发请求（渲染热路径上不允许有网络请求）。
    const IMAGE_WIDTH_LIMIT = { min: 160, max: 2000, fallback: 660 }
    let bodyImageWidth = 0   // 0 = 没设置过，沿用正文原来的显示样式
    // 说明：显示上限固定用视口宽度（最多铺满屏幕），不再去测「聊天区有多宽」——
    // 那个值随面板变化（正文 873、图库 647），怎么量都会让人怀疑数字，不如直接不测。
    const imageWidthListeners = new Set()

    /** 归一化显示宽度：空值 / 非数字 / <= 0 一律当 0（默认）；其余夹进 160–1200 的整数。 */
    function normalizeImageWidth(value) {
      if (value === null || value === undefined || value === '') return 0
      const width = Number(value)
      if (!Number.isFinite(width) || width <= 0) return 0
      return Math.min(IMAGE_WIDTH_LIMIT.max, Math.max(IMAGE_WIDTH_LIMIT.min, Math.round(width)))
    }

    /** 配置变化时通知已挂载的正文图片，不用等宿主再次渲染消息。 */
    function applyImageWidth(value) {
      const next = normalizeImageWidth(value)
      if (next === bodyImageWidth) return
      bodyImageWidth = next
      for (const notify of imageWidthListeners) notify(next)
    }

    function useImageWidth() {
      const [width, setWidth] = useState(bodyImageWidth)
      useEffect(() => {
        imageWidthListeners.add(setWidth)
        setWidth(bodyImageWidth)
        return () => imageWidthListeners.delete(setWidth)
      }, [])
      return width
    }

    /**
     * 正文插图统一的宽度样式。没设置过（0）时原样返回调用方原来的默认样式，
     * 保证"不设置"和现在的显示效果一模一样；设置后限制到正文容器的 96%，
     * 高度仍由浏览器按原比例算，窄聊天栏也不会溢出。
     */
    function imageWidthStyle(defaults, configuredWidth) {
      if (!configuredWidth) return defaults
      // 展开 defaults：以后给默认样式加键（objectFit / aspectRatio 之类）不会在这里被悄悄丢掉。
      // 上限固定用视口宽度：设多大就显示多大，最多铺满屏幕，再大也不加。
      // 不用百分比（图片的父容器宽度由图片自己撑开，会形成循环把图锁死），也不去猜聊天区有多宽。
      return { ...defaults, width: configuredWidth + 'px', maxWidth: '96vw' }
    }

    /**
     * 手机端兜底：把宽度算成确定的像素值，用 !important 直接写到 <img> 上。
     * 行内 style 在手机上会被挤小（实测设 2000 只显示 95 px）：宿主 tavern.css 给插图加了
     * max-height: min(240px, 35svh)，部分 WebView 还不认 min()/svh，整条声明作废后
     * 只剩 flex 收缩 + 高度上限在起作用。行内 !important 压得过任何样式表规则，
     * 宽度也不再依赖 vw / min() 的支持情况，每次窗口变化（转屏、键盘）重新算一次。
     * restore 是没设置宽度（0）时要还原的行内值，必须和 render 里的默认样式一致。
     */
    const FORCED_IMAGE_PROPS = ['width', 'min-width', 'max-width', 'height', 'max-height', 'flex-shrink']
    function forceImageWidth(el, configuredWidth, restore) {
      if (!el || !el.style) return
      if (!configuredWidth) {
        for (const prop of FORCED_IMAGE_PROPS) {
          el.style.removeProperty(prop)
          if (restore && restore[prop]) el.style.setProperty(prop, restore[prop])
        }
        return
      }
      const viewport = Math.max(window.innerWidth || 0, (document.documentElement && document.documentElement.clientWidth) || 0)
      const px = Math.max(1, Math.round(Math.min(configuredWidth, viewport ? viewport * 0.96 : configuredWidth)))
      el.style.setProperty('width', px + 'px', 'important')
      el.style.setProperty('min-width', px + 'px', 'important')
      el.style.setProperty('max-width', px + 'px', 'important')
      el.style.setProperty('height', 'auto', 'important')
      el.style.setProperty('max-height', 'none', 'important')
      el.style.setProperty('flex-shrink', '0', 'important')
    }

    /** 返回一个 ref 回调，挂到 <img> 上即可：宽度设置变化、图片重新挂载、窗口尺寸变化时都重新落一次。 */
    function useForcedImageWidth(configuredWidth, restore) {
      const [el, setEl] = useState(null)
      const restoreKey = JSON.stringify(restore || {})
      useEffect(() => {
        if (!el) return undefined
        forceImageWidth(el, configuredWidth, restore)
        if (!configuredWidth) return undefined
        const onResize = () => forceImageWidth(el, configuredWidth, restore)
        window.addEventListener('resize', onResize)
        window.addEventListener('orientationchange', onResize)
        return () => {
          window.removeEventListener('resize', onResize)
          window.removeEventListener('orientationchange', onResize)
        }
      }, [el, configuredWidth, restoreKey])
      return setEl
    }

    /** 单张图：占位 → 轮询 → <img>。 */
    function InlineImage(props) {
      const { prompt, imageKey, auto } = props
      const displayWidth = useImageWidth()
      const forcedWidthRef = useForcedImageWidth(displayWidth, { width: '100%', 'max-width': 'min(660px, 96vw)' })
      const [state, setState] = useState(auto ? 'pending' : 'idle')
      const [error, setError] = useState('')
      const [jobId, setJobId] = useState('')
      const [attempt, setAttempt] = useState(0)

      useEffect(() => {
        if (!auto && attempt === 0) { setState('idle'); return undefined }
        let cancelled = false
        let timer = null

        function poll(id) {
          jsonFetch(`${BASE}/jobs?id=${encodeURIComponent(id)}`).then(data => {
            if (cancelled) return
            const job = data?.job
            if (!job) { setState('failed'); setError('作业已丢失'); return }
            if (job.status === 'failed') { setState('failed'); setError(job.error || '画失败了'); return }
            if (job.status === 'done') { setJobId(id); setState('done'); return }
            setState(job.status === 'running' ? 'running' : 'pending')
            timer = setTimeout(() => poll(id), 1500)
          }).catch(err => {
            if (cancelled) return
            setState('failed')
            setError(err?.message ?? String(err))
          })
        }

        async function run() {
          setState('pending')
          setError('')
          try {
            const found = await jsonFetch(`${BASE}/jobs?key=${encodeURIComponent(imageKey)}`).catch(() => null)
            if (cancelled) return
            if (found?.job) {
              if (found.job.status === 'done') { setJobId(found.job.id); setState('done'); return }
              // A terminal failure is safe to retry with the same key. The
              // server replaces failed jobs on POST while retaining dedupe for
              // active and completed jobs.
              if (found.job.status === 'failed') {
                if (attempt === 0) { setState('failed'); setError(found.job.error || '画失败了'); return }
                // An explicit retry click increments attempt and submits fresh.
              } else {
                poll(found.job.id)
                return
              }
            }
            const created = await jsonFetch(`${BASE}/jobs`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tag: prompt, key: imageKey, origin: 'inline' }),
            })
            if (cancelled) return
            if (created?.id) poll(created.id)
            else { setState('failed'); setError(created?.error || '提交失败') }
          } catch (err) {
            if (!cancelled) { setState('failed'); setError(err?.message ?? String(err)) }
          }
        }

        void run()
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
      }, [imageKey, prompt, auto, attempt])

      if (state === 'done' && jobId) {
        const src = `${BASE}/jobs?id=${encodeURIComponent(jobId)}&image=1`
        return h('div', { style: wrapStyle },
          h('img', { ref: forcedWidthRef, src, loading: 'lazy', decoding: 'async', alt: '插图', title: '点一下在 DSH 里看大图', style: { display: 'block', ...imageWidthStyle({ width: '100%', maxWidth: 'min(660px, 96vw)' }, displayWidth), borderRadius: '10px', cursor: 'zoom-in', background: '#1a1d24', margin: '10px auto' }, onClick: () => viewImage(jobId, '') }))
      }
      if (state === 'failed') {
        return h('div', { style: wrapStyle },
          h('span', { style: noteStyle }, '画这张失败：' + error + ' '),
          h('button', { style: buttonStyle, onClick: () => { setError(''); setAttempt(v => v + 1) } }, '重试'))
      }
      if (state === 'idle') {
        return h('div', { style: wrapStyle },
          h('button', { style: buttonStyle, title: prompt, onClick: () => setAttempt(v => v + 1) }, '🖼 画这张图'))
      }
      return h('div', { style: wrapStyle },
        h('span', { style: noteStyle }, (state === 'running' ? '正在画…' : '排队中…') + ' ' + prompt.slice(0, 40)))
    }

    /** 计划里的一张图：jobId 由 host 建好了，这里只负责等它画完。 */
    function PlanImage(props) {
      const { plan, index } = props
      const displayWidth = useImageWidth()
      const forcedWidthRef = useForcedImageWidth(displayWidth, { width: '100%', 'max-width': 'min(660px, 96vw)' })
      // 一律先当 pending：宿主给的 status 可能已经过时（图还没真画好），靠轮询拿真实状态
      const [state, setState] = useState('pending')
      const [error, setError] = useState('')
      // 图片自身加载失败 —— 最常见的原因是「作业已报 done，但文件还没写完」，这一小段窗口里
      // 取图会返回 404。所以这里**自动重试**，别一失败就给用户看"取不到"。
      const [imgError, setImgError] = useState('')
      const [imgNonce, setImgNonce] = useState(0)
      const [imgRetry, setImgRetry] = useState(0)

      useEffect(() => {
        if (!plan.jobId || state === 'done') return undefined
        let cancelled = false
        let timer = null
        function poll() {
          jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(plan.jobId)).then(data => {
            if (cancelled) return
            const job = data?.job
            if (!job) { timer = setTimeout(poll, 2000); return }
            if (job.status === 'failed') { setState('failed'); setError(job.error || '画失败了'); return }
            if (job.status === 'done') { setState('done'); return }
            timer = setTimeout(poll, 1500)
          }).catch(err => { if (!cancelled) { setState('failed'); setError(err?.message ?? String(err)) } })
        }
        poll()
        return () => { cancelled = true; if (timer) clearTimeout(timer) }
      }, [plan.jobId])

      // 取图失败自动重试：最多 20 次 / 约 30 秒，之后才把「重试」按钮交给用户
      useEffect(() => {
        if (!imgError || imgRetry >= 20) return undefined
        const timer = setTimeout(() => { setImgError(''); setImgRetry(n => n + 1); setImgNonce(x => x + 1) }, 1500)
        return () => clearTimeout(timer)
      }, [imgError, imgRetry])

      if (state === 'done') {
        const src = BASE + '/jobs?id=' + encodeURIComponent(plan.jobId) + '&image=1'
        // 自动重试用尽后才显示"取不到"
        if (imgError && imgRetry >= 20) {
          return h('div', { style: wrapStyle },
            h('span', { style: noteStyle }, '第 ' + (index + 1) + ' 张图取不到（' + imgError + '）　'),
            h('button', {
              type: 'button',
              style: { fontSize: '12px', padding: '3px 12px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'transparent', color: '#dbe3ee', cursor: 'pointer' },
              onClick: () => { setImgError(''); setImgRetry(0); setImgNonce(x => x + 1) },
            }, '重试'),
          )
        }
        // 正在自动重试中：给个安静的状态，不要露出破图
        if (imgError) {
          return h('div', { style: wrapStyle },
            h('span', { style: noteStyle }, '🎨 第 ' + (index + 1) + ' 张正在取回…（第 ' + imgRetry + ' 次）'))
        }
        return h('div', { style: wrapStyle },
          h('img', { ref: forcedWidthRef, key: 'img-' + imgNonce, src, loading: 'lazy', decoding: 'async', alt: plan.title || '插图',
            onError: () => setImgError('加载失败'), title: '点一下在 DSH 里看大图', style: { display: 'block', ...imageWidthStyle({ width: '100%', maxWidth: 'min(660px, 96vw)' }, displayWidth), borderRadius: '10px', cursor: 'zoom-in', background: '#1a1d24', margin: '10px auto' }, onClick: () => viewImage(plan.jobId, plan.title), onContextMenu: (event) => { event.preventDefault(); openEditorFor(plan.jobId, plan.title) }, onMouseDown: () => beginPress(plan.jobId, plan.title), onMouseUp: cancelPress, onMouseLeave: cancelPress, onTouchStart: () => beginPress(plan.jobId, plan.title), onTouchEnd: cancelPress, onTouchMove: cancelPress }))
      }
      if (state === 'failed') {
        return h('div', { style: wrapStyle },
          h('span', { style: noteStyle }, '第 ' + (index + 1) + ' 张画失败：' + error + ' '))
      }
      return h('div', { style: wrapStyle },
        h('span', { style: noteStyle }, '🎨 正在画第 ' + (index + 1) + ' 张…' + (plan.title ? '「' + plan.title + '」' : '')))
    }


    /** 官方接口下的插图（kind = dsh-tavern-image/image）。
     *  item.data 里带着 jobId —— 所以放大、右键看提示词、长按、重画全都照用。
     *  官方内置的 image 类型做不到这些（尺寸和交互由 Tavern 固定，插件插不进手）。 */
    function OfficialImage(props) {
      const { item } = props
      const displayWidth = useImageWidth()
      const jobId = String(item && item.data && item.data.jobId || '')
      const replacement = item && item.data && item.data.replacement && typeof item.data.replacement === 'object' ? item.data.replacement : null
      const activeJobId = String(replacement && replacement.jobId || jobId)
      const mediaContext = {
        gameId: String(props.gameId || ''), turn: props.turn,
        textVersion: String(item && item.textVersion || ''), mediaId: String(item && item.id || ''), jobId,
      }
      const title = String(item && item.caption || '')
      // 双击插图 → 底部弹出「显示大小」控制条：拖滑块时这张图立刻变，看准了再保存。
      // 草稿只作用于本地显示（applyImageWidth 不发请求），点保存才写 /config。
      const [widthBarOpen, setWidthBarOpen] = React.useState(false)
      const [widthDraft, setWidthDraft] = React.useState(0)
      const [widthBarNote, setWidthBarNote] = React.useState('')
      // 图片当前实际显示宽度：直接读元素自身，不推断容器，也就不存在「测不准」。
      const imgRef = React.useRef(null)
      const forcedWidthRef = useForcedImageWidth(displayWidth, { width: 'auto', 'max-width': 'min(660px, 96vw)', height: 'auto', 'max-height': 'none' })
      // ref 回调必须稳定：每次渲染换新函数会让 React 先传 null 再传元素，反复触发 setState。
      const setImgElBox = React.useRef(null)
      if (!setImgElBox.current) setImgElBox.current = el => { imgRef.current = el; forcedWidthRef(el) }
      const setImgEl = setImgElBox.current
      const [actualWidth, setActualWidth] = React.useState(0)
      const widthBarStart = React.useRef(0)
      // 手机适配：触屏上 dblclick 不可靠，自己认「两次快速轻点」；并短暂屏蔽随后合成的 click。
      const lastTapAt = React.useRef(0)
      const suppressTapUntil = React.useRef(0)

      const openWidthBar = () => {
        widthBarStart.current = normalizeImageWidth(displayWidth || 0)
        setWidthDraft(displayWidth || IMAGE_WIDTH_LIMIT.fallback)
        setWidthBarNote('')
        setWidthBarOpen(true)
      }
      const closeWidthBar = () => {
        applyImageWidth(normalizeImageWidth(widthBarStart.current))
        setWidthBarOpen(false)
        setWidthBarNote('')
      }
      const saveWidthBar = async (value) => {
        setWidthBarNote('保存中…')
        try {
          await jsonFetch(BASE + '/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: { imageDisplayWidth: value } }),
          })
          applyImageWidth(value)
          setWidthBarNote(value ? ('已保存：正文插图统一按 ' + value + ' px') : '已恢复默认大小')
          setTimeout(() => setWidthBarOpen(false), 800)
        } catch (error) {
          setWidthBarNote('保存失败：' + String((error && error.message) || error))
        }
      }
      React.useEffect(() => {
        if (!widthBarOpen) return undefined
        const read = () => {
          const el = imgRef.current
          if (el && el.getBoundingClientRect) setActualWidth(Math.round(el.getBoundingClientRect().width || 0))
        }
        read()
        const timer = setTimeout(read, 180)   // 等宽度的过渡动画走完再读一次
        return () => clearTimeout(timer)
      }, [widthBarOpen, widthDraft, displayWidth])
      React.useEffect(() => {
        if (!widthBarOpen) return undefined
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          applyImageWidth(normalizeImageWidth(widthBarStart.current))
          setWidthBarOpen(false)
          setWidthBarNote('')
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [widthBarOpen])
      const [imgError, setImgError] = useState('')
      const [imgNonce, setImgNonce] = useState(0)
      const [imgRetry, setImgRetry] = useState(0)
      const [actionBusy, setActionBusy] = useState(false)
      const [polledJob, setPolledJob] = useState(null)
      const [actionJobId, setActionJobId] = useState('')
      const activeActionJobId = React.useRef('')

      useEffect(() => { activeActionJobId.current = ''; setPolledJob(null); setActionJobId('') }, [item && item.id])
      const effectiveJobId = String(actionJobId || activeJobId)

      // Poll only this media item's active job. GET is safe to retry; paid POSTs below are single-flight.
      useEffect(() => {
        const jobState = polledJob && String(polledJob.id || '') === effectiveJobId ? String(polledJob.state || '') : ''
        const state = String(jobState || replacement && replacement.state || item && item.status || '')
        if (!effectiveJobId || !['pending', 'running', 'queued', 'processing', 'uncertain', 'failed', 'cancelled'].includes(state)) return undefined
        let live = true
        const poll = () => jsonFetch(BASE + '/job-detail?id=' + encodeURIComponent(effectiveJobId), { cache: 'no-store' })
          .then(result => {
            if (!live || (activeActionJobId.current && activeActionJobId.current !== effectiveJobId) || !result || !result.job) return
            setPolledJob(result.job)
            const providerMayStillBeWorking = result.job.requestMayHaveSucceeded === true || (result.job.state === 'cancelled' && (result.job.requestStarted === true || result.job.cancelMayHaveContinued === true))
            if (String(result.job.id || '') === effectiveJobId && ['done', 'ready', 'failed', 'cancelled'].includes(result.job.state) && !providerMayStillBeWorking) mediaUncertainActions.delete(mediaContext.mediaId)
          })
          .catch(() => {})
        poll()
        if (state === 'failed' || state === 'cancelled' || state === 'uncertain') return () => { live = false }
        const timer = setInterval(poll, 1800)
        return () => { live = false; clearInterval(timer) }
      }, [effectiveJobId, replacement && replacement.state, item && item.status, polledJob && polledJob.state])

      async function mediaAction(operation, extra = {}) {
        const lock = mediaContext.mediaId
        const readOnlyRecovery = operation === 'recover'
        if (actionBusy || mediaPostLocks.has(lock) || (!readOnlyRecovery && mediaUncertainActions.has(lock)) || !validMediaContext(mediaContext)) return
        mediaPostLocks.add(lock)
        setActionBusy(true)
        try {
          const result = await jsonFetch(BASE + '/media-action', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ operation, ...mediaContext, jobId: effectiveJobId, ...extra }),
          })
          if (!result?.ok) throw new Error(result?.error || '请求未确认')
          const nextJobId = String(result.jobId || effectiveJobId)
          activeActionJobId.current = nextJobId
          setActionJobId(nextJobId)
          setPolledJob({ ...(polledJob || {}), ...result, id: nextJobId, state: result.state || (operation === 'cancel' ? 'cancelled' : 'pending') })
          const providerMayStillBeWorking = result.requestMayHaveSucceeded === true || (result.state === 'cancelled' && (result.cancelMayHaveContinued === true || result.requestStarted === true))
          if (result.state === 'uncertain' || providerMayStillBeWorking) mediaUncertainActions.add(lock)
          else if (readOnlyRecovery && ['ready', 'done', 'failed', 'cancelled'].includes(result.state)) mediaUncertainActions.delete(lock)
          if (typeof showToast === 'function') {
            if (readOnlyRecovery) showToast(({ ready: '已找回这张图', done: '已找回这张图', pending: '已重新查询，任务仍在处理中', running: '已重新查询，任务仍在处理中', failed: '已确认这张图失败', uncertain: '状态仍待确认，请到生图平台检查' })[result.state] || '已重新查询这张图的状态', result.state === 'uncertain' ? 'fail' : 'ok')
            else if (operation !== 'cancel') showToast('已提交这张图的任务', 'ok')
            else if (result.state === 'uncertain' || result.requestMayHaveSucceeded === true) showToast('取消状态待确认，请到生图平台检查；不会自动重试', 'fail')
            else if (result.state === 'cancelled' && (result.cancelMayHaveContinued === true || result.requestStarted === true)) showToast('已停止本地等待，但平台可能继续生成；请检查平台用量', 'fail')
            else if (result.state === 'cancelled') showToast('已取消这张图的任务', 'ok')
            else if (result.state === 'done') showToast('这张图已完成，未取消', 'ok')
            else showToast('取消状态：' + String(result.state || '待确认') + '；请检查这张图的任务', 'fail')
          }
        } catch (error) {
          if (error && error.submissionNotStarted === true) {
            mediaUncertainActions.delete(lock)
            if (typeof showToast === 'function') showToast(String(error.message || '请求未提交'), 'fail')
            setPolledJob({ ...(polledJob || {}), state: 'failed', error: String(error.message || error), id: effectiveJobId })
            return
          }
          // Network errors are ambiguous: never repeat a possibly accepted paid request.
          if (!readOnlyRecovery) mediaUncertainActions.add(lock)
          setPolledJob({ ...(polledJob || {}), state: 'uncertain', error: String(error?.message || error), id: effectiveJobId })
        } finally { mediaPostLocks.delete(lock); setActionBusy(false) }
      }

      // 取图失败自动重试：宿主报 ready 之后文件可能还在写，这段窗口会 404
      useEffect(() => {
        if (!imgError || imgRetry >= 20) return undefined
        const timer = setTimeout(() => { setImgError(''); setImgRetry(n => n + 1); setImgNonce(x => x + 1) }, 1500)
        return () => clearTimeout(timer)
      }, [imgError, imgRetry])

      const currentPolledJob = polledJob && String(polledJob.id || '') === effectiveJobId ? polledJob : null
      const recoveredReady = Boolean(currentPolledJob && ['ready', 'done'].includes(currentPolledJob.state))
      const displayJobId = recoveredReady ? effectiveJobId : jobId
      const displayMediaContext = { ...mediaContext, jobId: displayJobId }
      const activeReplacement = replacement && !recoveredReady
      const cachedImageReady = ['done', 'ready'].includes(String(currentPolledJob && currentPolledJob.state || replacement && replacement.state || ''))
        || String(item && item.status || '') === 'ready'
      const src = recoveredReady
        ? BASE + '/jobs?id=' + encodeURIComponent(effectiveJobId) + '&image=1'
        : String(item && item.url || '') || (cachedImageReady && jobId && !(item && item.status === 'failed') && !(item && item.data && item.data.cancelled === true) ? BASE + '/jobs?id=' + encodeURIComponent(jobId) + '&image=1' : '')
      const jobMayHaveReachedProvider = Boolean(currentPolledJob && (currentPolledJob.requestMayHaveSucceeded === true || currentPolledJob.state === 'uncertain'))
      const isUncertain = Boolean((currentPolledJob && currentPolledJob.state === 'uncertain') || jobMayHaveReachedProvider || (replacement && replacement.state === 'uncertain' && !recoveredReady))
      const isCancelled = !recoveredReady && (Boolean(item && item.data && item.data.cancelled === true) || Boolean(currentPolledJob && currentPolledJob.state === 'cancelled') || Boolean(replacement && replacement.state === 'cancelled'))
      const taskState = recoveredReady ? 'done' : isUncertain ? 'uncertain' : isCancelled ? 'cancelled' : String(currentPolledJob && currentPolledJob.state || replacement && replacement.state || (item && item.status === 'failed' ? 'failed' : item && item.status === 'pending' ? 'pending' : 'done'))
      const cancellationMayContinue = Boolean((item && item.data && item.data.cancelMayHaveContinued === true) || (replacement && (replacement.cancelMayHaveContinued === true || replacement.requestStarted === true)) || (currentPolledJob && currentPolledJob.state === 'cancelled' && currentPolledJob.requestStarted === true))
      const queryUnavailable = Boolean(currentPolledJob && currentPolledJob.state === 'uncertain' && currentPolledJob.backend === 'comfyui' && !currentPolledJob.comfyId)
      const statusLabel = ({ queued: '排队中', pending: '排队中', running: '生成中', processing: '生成中', done: '完成', ready: '完成', failed: '失败', cancelled: '已取消', uncertain: '状态待确认' })[taskState] || '状态待确认'
      // 顺利出图时不再挂一行「完成」文案：图本身就是结果，状态行只在需要说明时出现。
      const quietStatus = taskState === 'done' && !activeReplacement && !(item && item.status === 'failed')
      // 没有画面可看时（生成中／失败／已取消／待确认）也要给一块能点的占位：点一下、右键或长按
      // 都能打开提示词编辑器，改完重画。否则这些状态下页面只剩一行文字，用户没有任何出路
      //（失败后点重试、再马上取消，就会掉进这个死角）。
      const showImage = Boolean(src) && (!imgError || imgRetry < 20)
      const placeholderText = taskState === 'failed' ? '配图失败 · 点这里改提示词重画'
        : taskState === 'cancelled' ? '这张图已取消 · 点这里改提示词重画'
          : taskState === 'uncertain' ? '等待平台确认 · 点这里改提示词重画'
            : '正在生成…'
      const placeholder = h('div', {
        key: 'illustration-placeholder',
        title: '点一下或右键改提示词 / 重画',
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '110px', maxWidth: 'min(660px, 96vw)', borderRadius: '10px', background: '#1a1d24', border: '1px dashed #2c313c', color: '#8b93a1', fontSize: '12px', cursor: 'pointer', margin: '10px 0', userSelect: 'none' },
        onClick: () => openEditorFor(displayJobId, title, displayMediaContext),
        onContextMenu: event => {
          cancelPress()
          event.preventDefault()
          event.stopPropagation()
          openEditorFor(displayJobId, title, displayMediaContext)
        },
        onMouseDown: event => { if (event.button === 0) beginPress(displayJobId, title, displayMediaContext) },
        onMouseUp: cancelPress, onMouseLeave: cancelPress,
        onTouchStart: () => beginPress(displayJobId, title, displayMediaContext),
        onTouchEnd: cancelPress, onTouchMove: cancelPress,
      }, placeholderText)
      // TavernPluginMediaItem 会统一追加 figcaption；这里保留 alt 和预览标题即可。
      // 手机上手指出得准才行：按钮给足触控高度（38px 起），滑块在小屏上占更多宽度。
      const barBtn = { padding: '8px 14px', minHeight: '38px', fontSize: '12px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'transparent', color: '#dbe3ee', cursor: 'pointer' }
      return h('div', { style: wrapStyle },
        widthBarOpen ? h('div', {
          style: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: '12px', zIndex: 2147483002, display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', borderRadius: '12px', background: 'rgba(23,26,33,.97)', border: '1px solid rgba(120,140,170,.4)', boxShadow: '0 12px 32px rgba(0,0,0,.5)', color: '#dbe3ee', fontSize: '12px', maxWidth: '96vw', flexWrap: 'wrap', boxSizing: 'border-box' },
        },
          h('span', { style: { opacity: .75 } }, '显示大小'),
          h('input', {
            type: 'range', 'aria-label': '正文图片显示大小',
            min: String(IMAGE_WIDTH_LIMIT.min), max: String(IMAGE_WIDTH_LIMIT.max), step: '10',
            value: String(widthDraft),
            style: { width: 'min(220px, 52vw)', accentColor: '#8fb4ff', cursor: 'pointer' },
            onChange: event => { const next = Number(event.target.value); setWidthDraft(next); setWidthBarNote(''); applyImageWidth(next) },
          }),
          h('span', { style: { minWidth: '56px' } }, widthDraft + ' px'),
          h('span', { style: { opacity: .7 } }, '实际 ' + (actualWidth || widthDraft) + ' px'),
          h('button', { type: 'button', style: barBtn, onClick: () => { void saveWidthBar(widthDraft) } }, '保存'),
          h('button', { type: 'button', style: barBtn, onClick: closeWidthBar }, '取消'),
          h('button', { type: 'button', style: barBtn, onClick: () => { void saveWidthBar(0) } }, '恢复默认'),
          widthBarNote ? h('span', { role: 'status', 'aria-live': 'polite', style: { color: /失败/.test(widthBarNote) ? '#f2686b' : '#8bd48b' } }, widthBarNote) : null,
          h('span', { style: { opacity: .5 } }, 'Esc 取消'),
        ) : null,
        showImage ? h('img', {
          ref: setImgEl,
          key: 'official-img-' + imgNonce, src, loading: 'lazy', decoding: 'async', alt: title || '插图',
          onError: () => setImgError('加载失败'),
          title: '点一下看大图 · 右键或长按改提示词 / 重画 · 双击调显示大小',
          // 覆盖 tavern.css 的 .dsh-tavern-illustration img 限制（320x240）：
          // 行内 style 优先级高于 CSS 类，所以这里写死 width/maxWidth/maxHeight 三件套。
          style: { display: 'block', ...imageWidthStyle({ width: 'auto', maxWidth: 'min(660px, 96vw)' }, displayWidth), height: 'auto', maxHeight: 'none', borderRadius: '10px', cursor: 'zoom-in', background: '#1a1d24', margin: '10px 0', touchAction: 'manipulation' },
          onClick: () => { if (Date.now() < suppressTapUntil.current) return; viewImage(displayJobId, title) },
          onDoubleClick: () => { cancelPress(); openWidthBar() },
          onContextMenu: event => {
            cancelPress()
            event.preventDefault()
            event.stopPropagation()
            openEditorFor(displayJobId, title, displayMediaContext)
          },
          onMouseDown: event => { if (event.button === 0) beginPress(displayJobId, title, displayMediaContext) },
          onMouseUp: cancelPress, onMouseLeave: cancelPress,
          onTouchStart: () => beginPress(displayJobId, title, displayMediaContext),
          // 手机上 dblclick 不可靠：认两次快速轻点（≤320ms）打开宽度控制条，
          // 并短暂屏蔽随后合成的 click，免得同时又弹出全屏大图。
          onTouchEnd: event => {
            cancelPress()
            const now = Date.now()
            if (now - lastTapAt.current <= 320) {
              lastTapAt.current = 0
              suppressTapUntil.current = now + 600
              if (event.cancelable) event.preventDefault()
              openWidthBar()
              return
            }
            lastTapAt.current = now
          },
          onTouchMove: cancelPress,
        }) : placeholder,
        imgError ? h('div', { style: noteStyle }, imgRetry >= 20 ? '图取不到（' + imgError + '）　' : '正在取回…（第 ' + imgRetry + ' 次）', imgRetry >= 20 ? h('button', { type: 'button', onClick: () => { setImgError(''); setImgRetry(0); setImgNonce(x => x + 1) } }, '重新读取') : null) : null,
        quietStatus ? null : h('div', { style: { ...noteStyle, marginTop: '4px' }, role: 'status', 'aria-live': 'polite' },
          taskState === 'uncertain' ? (queryUnavailable
            ? '状态待确认：旧作业没有保存 ComfyUI 任务号，无法查询找回；若 ComfyUI 未收到任务，请从正文末重新生图。'
            : '状态待确认：任务号 ' + effectiveJobId + (currentPolledJob?.comfyId ? '（ComfyUI ' + String(currentPolledJob.comfyId) + '）' : currentPolledJob?.providerTaskId ? '（平台任务 ' + String(currentPolledJob.providerTaskId) + '）' : '') + '；请到生图平台检查，暂不自动重试。') :
          taskState === 'cancelled' && cancellationMayContinue ? '已停止本地等待，但平台请求可能已发出并继续生成；请到生图平台检查用量。' + (replacement?.error ? ' ' + String(replacement.error).slice(0, 140) : '') :
          taskState === 'cancelled' ? '已取消' :
          (activeReplacement ? '替换任务' + statusLabel + (replacement.error || currentPolledJob?.error ? '：' + String(replacement.error || currentPolledJob.error).slice(0, 100) : '') :
           item && item.status === 'failed' ? '配图失败：' + String(item.error || currentPolledJob?.error || '未知原因').slice(0, 120) : statusLabel)),
        validMediaContext(mediaContext) && (Boolean(replacement) || item && item.status === 'pending' || ['pending', 'running', 'queued', 'processing'].includes(currentPolledJob?.state)) && !actionBusy && ['pending', 'running', 'queued', 'processing'].includes(taskState)
          ? h('button', { type: 'button', onClick: () => mediaAction('cancel'), disabled: actionBusy }, '取消这张图') : null,
        validMediaContext(mediaContext) && !actionBusy && taskState === 'failed' && !jobMayHaveReachedProvider
          ? h('button', { type: 'button', onClick: () => mediaAction('retry'), disabled: actionBusy }, '重试这张图') : null,
        validMediaContext(mediaContext) && !queryUnavailable && (taskState === 'uncertain' || (taskState === 'cancelled' && cancellationMayContinue))
          ? h('button', { type: 'button', onClick: () => mediaAction('recover'), disabled: actionBusy }, actionBusy ? '查询中…' : '重新查询状态') : null)
    }

    function validMediaContext(context) {
      return Boolean(context && context.gameId && context.mediaId && context.jobId && context.textVersion && Number.isFinite(Number(context.turn)))
    }
    const mediaPostLocks = new Set()
    const mediaUncertainActions = new Set()

    /** 段落：只渲染正文，不再带「画这段」按钮（生图入口统一在消息下方）。 */
    function Segment(props) {
      try {
        return props.renderText(props.value, props.keyName || ('seg-' + props.index))
      } catch (error) {
        return h('span', null, String(props.value ?? ''))
      }
    }

    /** 切段：每个非空行当成一段。 */
    function paragraphsOf(text) {
      return String(text ?? '').split(/\n+/).filter(line => line.trim())
    }

    /** 按 agent 给的挂载句把正文切开，在每句之后插一张图；每一段都带"画这段"按钮。 */
    function splitByPlan(text, plans, renderText, info) {
      const source = String(text ?? '')
      const points = []
      for (const plan of plans) {
        const mount = String(plan.mount ?? '').trim()
        if (!mount) continue
        const at = source.indexOf(mount)
        points.push({ plan, at: at < 0 ? source.length : at + mount.length })
      }
      points.sort((a, b) => a.at - b.at)
      const nodes = []
      let cursor = 0
      points.forEach((point, i) => {
        if (point.at > cursor) {
          nodes.push(h(Segment, {
            key: 'plan-seg-' + i, value: source.slice(cursor, point.at), index: i,
            renderText, keyName: 'plan-text-' + i, ...info,
          }))
          cursor = point.at
        }
        nodes.push(h(PlanImage, { key: 'plan-img-' + i, plan: point.plan, index: i }))
      })
      if (cursor < source.length) {
        nodes.push(h(Segment, { key: 'plan-tail', value: source.slice(cursor), index: points.length, renderText, keyName: 'plan-tail', ...info }))
      }
      return nodes
    }

    /**
     * 正文渲染：默认什么都不做，只在末尾放一个「生图」按钮。
     * 点了才去规划 —— 这样不会因为你翻历史就一排后台任务堆起来。
     */
    /**
     * 整段正文 + 末尾一个「生图」按钮。正文整段交给宿主渲染一次（切段会让界面卡死）。
     */
    /**
     * 长按 / 右键图片：打开编辑器，并把这张图的提示词读出来。
     */
    function openEditorFor(jobId, title, mediaContext) {
      try {
        if (!jobId || typeof openPromptEditor !== 'function') return
        const requestId = openEditorFor.requestId = (openEditorFor.requestId || 0) + 1
        openPromptEditor({ open: true, openRequestId: requestId, jobId: String(jobId), prompt: '', negative: '', rawPrompt: '', originalPrompt: '', rawPromptSource: '', submittedPromptSource: '', promptAssembly: null, finalPrompt: '', instruction: '', note: '正在读取提示词…', busy: '', loading: true, submitted: false, uncertain: false, mediaContext: validMediaContext(mediaContext) ? mediaContext : null, channelId: '', generationMode: 'text', refreshReferences: false, references: [], submittedPrompt: '', actualPositive: '', actualNegative: '', sourceBackend: '', providerError: '', inputsLoading: true, inputsError: '', inputsReload: 0, showInputs: false, channels: [], channelLoadFailed: false })
        jsonFetch(BASE + '/job-detail?id=' + encodeURIComponent(String(jobId)), { cache: 'no-store' })
          .then(r => {
            if (!r?.ok || !r.job) { openPromptEditor({ forJobId: String(jobId), forRequestId: requestId, loading: false, note: '读不到提示词：' + (r?.error || '') }); return }
            const sceneText = String(r.job.rawPrompt || r.job.tag || r.job.prompt || '')
            const blocksText = String(r.job.promptText || '')
            openPromptEditor({
              forJobId: String(jobId), forRequestId: requestId, loading: false,
              prompt: blocksText || sceneText,
              negative: String(r.job.negative || ''),
              note: blocksText ? '场景与角色块一起显示；改完重画会按角色分区重新发送' : '',
              rawPrompt: String(r.job.rawPrompt || ''),
               originalPrompt: String(r.job.promptText || r.job.rawPrompt || ''),
               rawPromptSource: String(r.job.rawPromptSource || ''),
               submittedPromptSource: String(r.job.submittedPromptSource || ''),
               promptAssembly: r.job.promptAssembly?.version === 2 ? r.job.promptAssembly : null,
              finalPrompt: String(r.job.prompt || ''),
            })
          })
          .catch(error => openPromptEditor({ forJobId: String(jobId), forRequestId: requestId, loading: false, note: '读取失败：' + (error?.message ?? error) }))
      } catch (error) {
        reportHost('editor-open-failed', { message: String(error?.message ?? error).slice(0, 200) })
      }
    }

    /** 长按计时器（按住 0.55 秒算长按） */
    let pressTimer = null
    function beginPress(jobId, title, mediaContext) {
      cancelPress()
      pressTimer = setTimeout(() => { pressTimer = null; openEditorFor(jobId, title, mediaContext) }, 550)
    }
    function cancelPress() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null }
    }

    /** 显示一条浮层提示（z-index 拉满，盖在设置面板上面） */
    let showToast = null

    function Toast() {
      const [msg, setMsg] = React.useState(null)
      showToast = (text, kind) => {
        setMsg({ text: String(text ?? ''), kind: kind || 'ok', at: Date.now() })
        setTimeout(() => setMsg(cur => (cur && Date.now() - cur.at >= 3000 ? null : cur)), 3200)
      }
      if (!msg) return null
      const ok = msg.kind !== 'fail'
      return React.createElement('div', {
        style: {
          position: 'fixed', left: '50%', bottom: '64px', transform: 'translateX(-50%)',
          zIndex: 2147483004, padding: '14px 26px', borderRadius: '12px',
          background: ok ? 'linear-gradient(180deg,#2a9d63,#1f7d4c)' : 'linear-gradient(180deg,#c9484b,#a53a3d)',
          color: '#fff', fontSize: '15px', fontWeight: 600, letterSpacing: '.3px',
          boxShadow: '0 12px 40px rgba(0,0,0,.55)', border: '1px solid rgba(255,255,255,.22)',
          pointerEvents: 'none', maxWidth: '80vw', textAlign: 'center',
        },
      }, (ok ? '✅ ' : '❌ ') + msg.text)
    }

    /** 右键菜单：跟着鼠标出现的小浮层。z-index 拉满，盖在设置面板上面。 */
    let openContextMenu = null

    function ContextMenu() {
      const [menu, setMenu] = React.useState(null)
      openContextMenu = (next) => setMenu(next)
      React.useEffect(() => {
        if (!menu) return undefined
        const close = () => setMenu(null)
        const onKey = (e) => { if (e.key === 'Escape') close() }
        window.addEventListener('mousedown', close)
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey) }
      }, [menu])
      if (!menu) return null
      const items = Array.isArray(menu.items) ? menu.items : []
      const w = 176
      const left = Math.min(menu.x, Math.max(8, (window.innerWidth || 1200) - w - 8))
      const top = Math.min(menu.y, Math.max(8, (window.innerHeight || 800) - items.length * 36 - 16))
      return h('div', {
        style: {
          position: 'fixed', left: left + 'px', top: top + 'px', width: w + 'px',
          zIndex: 2147483005, padding: '6px', borderRadius: '10px',
          background: '#1d222b', border: '1px solid rgba(150,170,200,.3)',
          boxShadow: '0 12px 36px rgba(0,0,0,.6)', fontSize: '13px',
        },
        onMouseDown: (e) => e.stopPropagation(),
      },
        items.map((item, i) => h('div', {
          key: i,
          onClick: () => { setMenu(null); try { item.onClick?.() } catch {} },
          style: {
            padding: '8px 10px', borderRadius: '7px', cursor: 'pointer',
            color: item.danger ? '#f2686b' : '#dbe3ee',
            display: 'flex', alignItems: 'center', gap: '8px',
          },
          onMouseEnter: (e) => { e.currentTarget.style.background = 'rgba(255,255,255,.08)' },
          onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
        }, h('span', null, item.icon || ''), h('span', null, item.label || ''))),
      )
    }

    /** 打开卡片选择弹窗（人物库里的"绑定卡片"用） */
    let openCardPicker = null

    function CardPicker() {
      const [view, setView] = React.useState({ open: false, all: [], picked: [], index: -1, loading: false })
      openCardPicker = (next) => setView(cur => Object.assign({}, cur, next))
      if (!view.open) return null
      const close = () => openCardPicker({ open: false })
      const toggle = (path) => {
        const picked = view.picked.includes(path) ? view.picked.filter(x => x !== path) : view.picked.concat([path])
        openCardPicker({ picked })
      }
      const confirm = () => {
        try { if (typeof onCardPick === 'function') onCardPick(view.picked, view.index) } catch {}
        close()
      }
      return React.createElement('div', {
        style: { position: 'fixed', inset: '0', zIndex: 2147483003, background: 'rgba(0,0,0,.72)', overflowY: 'auto', padding: '52px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' },
        onClick: close,
      }, React.createElement('div', {
        style: { width: '520px', maxWidth: '100%', background: 'linear-gradient(180deg,#1b2029,#161a21)', border: '1px solid rgba(120,140,170,.3)', borderRadius: '16px', padding: '22px 24px', boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
        onClick: (e) => e.stopPropagation(),
      },
        React.createElement('div', { style: { fontSize: '16px', fontWeight: 600, color: '#e8eef8', marginBottom: '4px' } }, '🔗 绑定卡片'),
        React.createElement('div', { style: { fontSize: '12px', color: '#9aa3b2', marginBottom: '14px' } }, '选中的卡片才会用这个角色的设定。都不选 = 所有卡都能用。'),
        React.createElement('div', { style: { maxHeight: '46vh', overflowY: 'auto', border: '1px solid rgba(120,140,170,.2)', borderRadius: '12px', padding: '6px' } },
          view.all.length
            ? view.all.map(item => React.createElement('label', {
                key: item.path,
                style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '9px', cursor: 'pointer', background: view.picked.includes(item.path) ? 'rgba(106,168,255,.14)' : 'transparent' },
              },
                React.createElement('input', { type: 'checkbox', checked: view.picked.includes(item.path), onChange: () => toggle(item.path) }),
                React.createElement('span', { style: { fontSize: '13px', color: '#dbe3ee' } }, item.name),
              ))
            : React.createElement('div', { style: { padding: '18px', fontSize: '13px', color: '#6b7480', textAlign: 'center' } }, '没读到卡片'),
        ),
        React.createElement('div', { style: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '18px' } },
          React.createElement('button', { type: 'button', onClick: () => openCardPicker({ picked: [] }), style: { padding: '8px 18px', fontSize: '13px', borderRadius: '9px', border: '1px solid rgba(120,140,170,.45)', background: 'transparent', color: '#9aa3b2', cursor: 'pointer' } }, '清空'),
          React.createElement('button', { type: 'button', onClick: close, style: { padding: '8px 22px', fontSize: '13px', borderRadius: '9px', border: '1px solid rgba(120,140,170,.45)', background: 'transparent', color: '#dbe3ee', cursor: 'pointer' } }, '取消'),
          React.createElement('button', { type: 'button', onClick: confirm, style: { padding: '8px 22px', fontSize: '13px', borderRadius: '9px', border: '1px solid rgba(230,160,60,.7)', background: 'linear-gradient(180deg,#f0a63c,#e0861f)', color: '#1a1206', fontWeight: 600, cursor: 'pointer' } }, '确定'),
        ),
      ))
    }

    /** 设计完成后通知设置页刷新 */
    let onCardPick = null

    /** 打开设计角色弹窗 */
    let openDesignDialog = null
    /** 设计完成后通知设置页刷新（peopleTab 挂载时设置） */
    let onDesignResult = null

    /**
     * 角色与服装设计：说需求、给一张参考图，让后台按规范设计。
     */
    function DesignDialog(props) {
      const [view, setView] = React.useState({ open: false, brief: '', photo: '', photoName: '', preview: '', busy: '', note: '' })
      openDesignDialog = (next) => setView(cur => Object.assign({}, cur, next))
      if (!view.open) return null

      const close = () => openDesignDialog({ open: false, busy: '', note: '', brief: '', photo: '', preview: '', photoName: '' })

      function pickFile(event) {
        const file = event?.target?.files && event.target.files[0]
        if (!file) return
        if (file.size > 12 * 1024 * 1024) { openDesignDialog({ note: '图片太大了（上限 12MB）' }); return }
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result || '')
          const base64 = result.includes(',') ? result.split(',')[1] : result
          openDesignDialog({ photo: base64, photoName: file.name, preview: result, note: '' })
        }
        reader.onerror = () => openDesignDialog({ note: '读图失败' })
        reader.readAsDataURL(file)
      }

      async function run() {
        if (view.busy) return
        const brief = String(view.brief || '').trim()
        if (!brief) { openDesignDialog({ note: '先说说想要什么角色或服装' }); return }
        openDesignDialog({ busy: 'working', note: '设计需要十几秒，请稍等…' })
        try {
          const payload = { brief, sessionId: String(lastSessionId || '') }
          if (view.photo) { payload.data = view.photo; payload.mediaType = 'image/png'; payload.name = view.photoName || 'ref.png' }
          const r = await jsonFetch(BASE + '/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
          if (!r?.ok) { openDesignDialog({ note: '设计失败：' + (r?.error || ''), busy: '' }); return }
          const people = r.people || []
          if (!people.length) { openDesignDialog({ note: '模型没产出可用的人物，换个说法再试', busy: '' }); return }
          // 宿主需要完整的 definitions（不是增量），所以先取当前的再合并
          const cur = await jsonFetch(BASE + '/state').catch(() => null)
          const defs = cur?.definitions ?? { characters: [], outfits: [] }
          const merged = Object.assign({}, defs, {
            characters: (defs.characters ?? []).concat(people),
            outfits: defs.outfits ?? [],
          })
          await jsonFetch(BASE + '/definitions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ definitions: merged }),
          })
          try { if (typeof onDesignResult === 'function') onDesignResult(people) } catch {}
          openDesignDialog({ note: '已加入 ' + people.length + ' 位角色', busy: '' })
          setTimeout(close, 1200)
        } catch (error) {
          openDesignDialog({ note: '失败：' + (error?.message ?? error), busy: '' })
        }
      }

      const label = { fontSize: '12px', color: '#9aa3b2', marginBottom: '8px' }
      const area = {
        width: '100%', minHeight: '110px', boxSizing: 'border-box', background: '#11141a',
        color: '#dbe3ee', border: '1px solid rgba(200,140,60,.55)', borderRadius: '12px',
        padding: '12px 14px', fontSize: '13px', lineHeight: '1.6', fontFamily: 'inherit', resize: 'vertical',
      }
      const btn = (text, onClick, primary, extra) => React.createElement('button', {
        type: 'button', onClick, disabled: Boolean(view.busy),
        style: Object.assign({
          padding: '9px 26px', fontSize: '14px', borderRadius: '10px', cursor: view.busy ? 'default' : 'pointer',
          border: primary ? '1px solid rgba(230,160,60,.7)' : '1px solid rgba(120,140,170,.45)',
          background: primary ? 'linear-gradient(180deg,#f0a63c,#e0861f)' : 'transparent',
          color: primary ? '#1a1206' : '#dbe3ee', fontWeight: primary ? 600 : 400,
        }, extra || {}),
      }, view.busy && primary ? '设计中…' : text)

      return React.createElement('div', {
        style: { position: 'fixed', inset: '0', zIndex: 2147483002, background: 'rgba(0,0,0,.72)', overflowY: 'auto', padding: '40px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' },
        onClick: close,
      }, React.createElement('div', {
        style: { width: '520px', maxWidth: '100%', background: 'linear-gradient(180deg,#1b2029,#161a21)', border: '1px solid rgba(120,140,170,.3)', borderRadius: '16px', padding: '24px 26px', boxShadow: '0 20px 60px rgba(0,0,0,.5)' },
        onClick: (event) => event.stopPropagation(),
      },
        React.createElement('div', { style: { textAlign: 'center', fontSize: '17px', fontWeight: 600, color: '#e8eef8', marginBottom: '6px' } }, '🎨 输入生成需求'),
        React.createElement('div', { style: { height: '1px', background: 'rgba(120,140,170,.2)', margin: '14px 0 18px' } }),
        React.createElement('div', { style: { textAlign: 'center', fontSize: '13px', color: '#9aa3b2', marginBottom: '12px' } }, '请描述您希望生成的角色或服装的具体需求'),
        React.createElement('textarea', {
          value: view.brief,
          placeholder: '例如：生成一个穿着古风汉服的少女角色，温柔可爱…',
          style: area,
          onChange: (e) => openDesignDialog({ brief: e.target.value }),
        }),
        React.createElement('div', { style: { marginTop: '18px', padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(120,140,170,.18)' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            React.createElement('span', { style: Object.assign({}, label, { marginBottom: 0 }) }, '📎 参考图片（可选）'),
            React.createElement('label', {
              style: { padding: '7px 16px', fontSize: '13px', borderRadius: '9px', border: '1px solid rgba(230,160,60,.6)', color: '#f0b45c', cursor: 'pointer', background: 'rgba(240,166,60,.08)' },
            },
              '＋ 添加图片',
              React.createElement('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: pickFile }),
            ),
          ),
          view.preview
            ? React.createElement('img', { src: view.preview, style: { display: 'block', maxWidth: '150px', borderRadius: '10px', margin: '12px auto 0' } })
            : React.createElement('div', { style: { textAlign: 'center', fontSize: '12px', color: '#6b7480', marginTop: '12px' } }, '点击上方按钮添加参考图片'),
        ),
        view.note ? React.createElement('div', { style: { fontSize: '12px', color: view.note.indexOf('失败') >= 0 || view.note.indexOf('太大') >= 0 ? '#f2686b' : '#9aa3b2', marginTop: '14px', textAlign: 'center' } }, view.note) : null,
        React.createElement('div', { style: { display: 'flex', gap: '14px', justifyContent: 'center', marginTop: '22px' } },
          btn('取消', close),
          btn('确定生成', run, true),
        ),
        React.createElement('div', { style: { fontSize: '11px', color: '#6b7480', marginTop: '14px', textAlign: 'center' } }, '会按「角色与服装设计规范」产出人物与服装，并自动加进人物库'),
      ))
    }

    /** 重画后：旧作业 id → 新作业 id（同一条消息里就地换图） */
    // 重画版本链：旧 jobId → 新 jobId。持久化到 localStorage，刷新后还能翻历史版本。
const REDRAW_KEY = 'dsh-tavern-image-redraw-versions'
const LEGACY_REDRAW_KEY = 'rphub-comfy-redraw-versions'
const redrawnJobs = (() => {
  const map = new Map()
  try {
    const raw = localStorage.getItem(REDRAW_KEY) || localStorage.getItem(LEGACY_REDRAW_KEY)
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) map.set(String(k), String(v))
  } catch {}
  return map
})()
function persistRedraw() {
  try {
    localStorage.setItem(REDRAW_KEY, JSON.stringify(Object.fromEntries([...redrawnJobs].slice(-200))))
  } catch {}
}
/** 给定某个 jobId，返回它所在的整条版本链（最旧 → 最新）。 */
function versionsOf(jobId) {
  const id = String(jobId)
  const ids = [id]
  const guard = new Set([id])
  let cur = id
  while (redrawnJobs.has(cur)) {
    const next = redrawnJobs.get(cur)
    if (!next || guard.has(next)) break
    guard.add(next)
    ids.push(next)
    cur = next
  }
  cur = id
  while (true) {
    let prev = null
    for (const [k, v] of redrawnJobs) { if (v === cur) { prev = k; break } }
    if (!prev || guard.has(prev)) break
    guard.add(prev)
    ids.unshift(prev)
    cur = prev
  }
  return ids
}
    /** 打开提示词编辑器（由长按触发） */
    let openPromptEditor = null

    /**
     * 长按 / 右键图片 → 打开编辑器：看提示词、改、让后台改、用新提示词重画。
     */
    function PromptEditor() {
      const [view, setView] = React.useState({ open: false, jobId: '', prompt: '', negative: '', instruction: '', note: '', busy: '', loading: false })
      openPromptEditor = (next) => setView(cur => {
        if (next.forJobId && (!cur.open || cur.jobId !== next.forJobId)) return cur
        if (next.forRequestId && cur.openRequestId !== next.forRequestId) return cur
        const { forJobId, forRequestId, ...patch } = next
        return Object.assign({}, cur, patch)
      })
      useEffect(() => {
        if (!view.open || !view.jobId) return undefined
        let live = true
        openPromptEditor({ inputsLoading: true, inputsError: '' })
        jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(view.jobId), { cache: 'no-store' }).then(result => {
          if (!live) return
          if (!result?.ok || !result.job) throw new Error(result?.error || '无法读取作业输入')
          const job = result.job
          openPromptEditor({ forJobId: view.jobId, inputsLoading: false, inputsError: '',
            generationMode: job.generationMode === 'reference' ? 'reference' : 'text',
            sourceBackend: String(job.backend || ''), sourceChannelId: String(job.channelId || ''),
            references: Array.isArray(job.references) ? job.references : [],
            submittedPrompt: typeof job.submittedPrompt === 'string' ? job.submittedPrompt : '',
            actualPositive: String(job.positive || ''), actualNegative: String(job.negative || ''), providerError: String(job.error || ''),
          })
        }).catch(error => { if (live) openPromptEditor({ forJobId: view.jobId, inputsLoading: false, inputsError: '读取实际输入失败：' + (error?.message || error) }) })
        return () => { live = false }
      }, [view.open, view.jobId, view.openRequestId, view.inputsReload])
      useEffect(() => {
        if (!view.open) return undefined
        let live = true
        jsonFetch(BASE + '/state', { cache: 'no-store' }).then(result => {
          if (!live) return
          const config = result?.config || {}
          const channels = (Array.isArray(config.imageChannels) ? config.imageChannels : []).map(channel => ({ id: String(channel.id || ''), name: String(channel.name || channel.id || ''), provider: String(channel.provider || ''), options: channel.options || {}, referenceSupported: uiSupportsImageReferences(channel, result) })).filter(channel => channel.id)
          const sourceChannel = channels.find(channel => channel.id === view.sourceChannelId)
          openPromptEditor({ channels, referenceSupported: sourceChannel?.referenceSupported ?? (result?.referenceSupported === true), comfyAvailable: Boolean(config.comfyUrl || config.comfyHost || config.comfyEnabled) })
        }).catch(() => { if (live) openPromptEditor({ channels: [], channelLoadFailed: true }) })
        return () => { live = false }
      }, [view.open, view.mediaContext])
      if (!view.open) return null

      const close = () => openPromptEditor({ open: false, busy: '', note: '', instruction: '' })
      const say = (text) => openPromptEditor({ forJobId: view.jobId, note: text })
      const backend = view.channelId === 'comfyui' ? 'comfyui' : view.channelId ? (view.channels || []).find(channel => channel.id === view.channelId)?.provider : view.sourceBackend
      const selectedReferenceChannel = (view.channels || []).find(channel => channel.id === (view.channelId || view.sourceChannelId))
      const referenceAvailable = selectedReferenceChannel ? selectedReferenceChannel.referenceSupported === true : (backend === 'comfyui' ? view.referenceSupported === true : IMAGE_REFERENCE_PROTOCOLS.has(backend))
      const referenceUnavailable = view.generationMode === 'reference' && !referenceAvailable
      const controlsDisabled = Boolean(view.loading || view.inputsLoading || view.busy || view.submitted || view.uncertain)
      // Strip only known legacy metadata decorations from captions, never alter recorded prompts.
      const referenceLabel = reference => String(reference.label || '').replace(/\s*\[(?:characterId|outfitId)=[^\]]*\]/g, '').trim() || '未记录名称（详见调试信息）'
      const referenceOwner = reference => {
        const label = referenceLabel(reference)
        if (reference.kind === 'character') return '所属人物：' + label
        if (!reference.characterId) return '所属：公共服装；' + (label.includes('本图穿着者：') ? label : '原记录未标明穿着者')
        const slash = label.indexOf('／')
        return slash > 0 ? '所属人物：' + label.slice(0, slash) : '所属人物：原记录未提供可读姓名（详见调试信息）'
      }

      async function improve() {
        openPromptEditor({ busy: 'improve', note: '后台正在改…' })
        try {
          const r = await jsonFetch(BASE + '/improve-prompt', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jobId: view.jobId, prompt: view.prompt, instruction: view.instruction }),
          })
          if (!r?.ok || !r.prompt) { say('没改成：' + (r?.error || '模型没返回')); return }
          openPromptEditor({ prompt: r.prompt, note: '已按你的要求改写，可以直接重画', busy: '' })
        } catch (error) {
          say('失败：' + (error?.message ?? error))
        } finally {
          openPromptEditor({ busy: '' })
        }
      }

      async function redraw() {
        if (controlsDisabled || view.inputsError) return
        if (referenceUnavailable) { say('当前渠道不支持参考图输入；请明确选择支持参考图的渠道或改为文生图，不会自动降级。'); return }
        const lock = String(view.mediaContext && view.mediaContext.mediaId || '')
        if (view.mediaContext && (mediaPostLocks.has(lock) || mediaUncertainActions.has(lock) || !validMediaContext(view.mediaContext))) return
        if (view.mediaContext) mediaPostLocks.add(lock)
        openPromptEditor({ busy: 'redraw', note: '正在重画…' })
        try {
          if (view.mediaContext) {
            if (!validMediaContext(view.mediaContext)) { say('当前图片上下文不完整，无法提交单图重画'); return }
            const body = { operation: 'redraw', ...view.mediaContext, jobId: view.mediaContext.jobId, prompt: view.prompt, negative: view.negative,
              generationMode: view.generationMode === 'reference' ? 'reference' : 'text', refreshReferences: view.generationMode === 'reference' && view.refreshReferences === true }
            if (view.channelId) body.channelId = view.channelId
            const result = await jsonFetch(BASE + '/media-action', {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
            })
            if (!result?.ok || !result.jobId) { say('重画状态待确认：' + (result?.error || '请检查生图平台，暂不自动重试')); return }
            mediaUncertainActions.delete(lock)
            openPromptEditor({ busy: '', submitted: true, note: '已提交重画，任务号 ' + String(result.jobId) + '；完成后会替换这张图。' })
            return
          }
          const r = await jsonFetch(BASE + '/redraw', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jobId: view.jobId, prompt: view.prompt, negative: view.negative,
              generationMode: view.generationMode === 'reference' ? 'reference' : 'text', refreshReferences: view.generationMode === 'reference' && view.refreshReferences === true }),
          })
          if (!r?.ok || !r.jobId) { say('重画失败：' + (r?.error || '没拿到新作业')); return }
          redrawnJobs.set(view.jobId, r.jobId)
          persistRedraw()
          try { window.dispatchEvent(new CustomEvent('dsh-tavern-image:planned', { detail: { messageId: String(lastSessionId || '') } })) } catch {}
          close()
          if (typeof openImageOverlay === 'function') (() => {
                  const chain = versionsOf(r.jobId)
                  openImageOverlay({ open: true, jobIds: chain, versions: chain, versionAt: chain.length - 1, note: '重画完成（下方可对比历史版本）', working: false, index: chain.length - 1 })
                })()
        } catch (error) {
          const uncertain = Boolean(view.mediaContext) && error?.submissionNotStarted !== true
          if (uncertain) mediaUncertainActions.add(lock)
          openPromptEditor({ forJobId: view.jobId, uncertain })
          say(uncertain ? '状态待确认（来源任务 ' + view.mediaContext.jobId + '）；请求可能已提交，请检查生图平台，暂不自动重试。原因：' + (error?.message ?? error) : '失败：' + (error?.message ?? error))
        } finally {
          if (view.mediaContext) mediaPostLocks.delete(lock)
          openPromptEditor({ forJobId: view.jobId, busy: '' })
        }
      }

      const area = {
        width: '100%', minHeight: '110px', boxSizing: 'border-box',
        background: '#12151b', color: '#dbe3ee', border: '1px solid rgba(120,140,170,.4)',
        borderRadius: '10px', padding: '10px 12px', fontSize: '13px', lineHeight: '1.5',
        fontFamily: 'inherit', resize: 'vertical',
      }
      const btn = (label, onClick, primary) => React.createElement('button', {
        type: 'button', onClick, disabled: controlsDisabled || Boolean(primary && (referenceUnavailable || view.inputsError)) || Boolean(view.mediaContext && mediaUncertainActions.has(String(view.mediaContext.mediaId || ''))),
        style: {
          padding: '6px 16px', fontSize: '13px', borderRadius: '9px', cursor: view.busy ? 'default' : 'pointer',
          border: '1px solid ' + (primary ? 'rgba(106,168,255,.6)' : 'rgba(120,140,170,.45)'),
          background: primary ? 'rgba(106,168,255,.18)' : 'transparent',
          color: '#dbe3ee',
        },
      }, label)

      return React.createElement('div', {
        style: { position: 'fixed', inset: '0', zIndex: 2147483001, background: 'rgba(0,0,0,.78)', overflowY: 'auto', padding: '48px 24px', backdropFilter: 'blur(3px)' },
        onClick: close,
      }, React.createElement('div', {
        style: { maxWidth: '760px', margin: '0 auto', background: '#171a21', border: '1px solid rgba(120,140,170,.25)', borderRadius: '14px', padding: '20px 22px' },
        onClick: (event) => event.stopPropagation(),
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' } },
          React.createElement('div', { style: { color: '#e6ecf5', fontSize: '15px' } }, '🖼 这张图的提示词'),
          React.createElement('button', { type: 'button', onClick: close, style: { padding: '5px 14px', fontSize: '13px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'transparent', color: '#dbe3ee', cursor: 'pointer' } }, '关闭'),
        ),
        React.createElement('img', { src: BASE + '/jobs?id=' + encodeURIComponent(view.jobId) + '&image=1', style: { display: 'block', maxWidth: '260px', borderRadius: '10px', margin: '0 auto 16px', background: '#1a1d24' } }),
        React.createElement('div', { style: { fontSize: '12px', color: '#9aa3b2', marginBottom: '6px' } }, '本次重画草稿（可编辑；不会改动下方原任务记录）'),
        React.createElement('textarea', {
          value: view.prompt,
          style: area,
          onChange: (e) => openPromptEditor({ prompt: e.target.value }),
        }),
        React.createElement('div', { style: { fontSize: '12px', color: '#9aa3b2', margin: '12px 0 6px' } }, '反向提示词'),
        React.createElement('textarea', {
          value: view.negative,
          style: Object.assign({}, area, { minHeight: '54px' }),
          onChange: (e) => openPromptEditor({ negative: e.target.value }),
        }),
        React.createElement('div', { style: { fontSize: '12px', color: '#9aa3b2', margin: '12px 0 6px' } }, '让后台帮你改（说要求，例如「她自己头发」/「改成白天」/「多加细节」）'),
        React.createElement('input', {
          value: view.instruction,
          placeholder: '想怎么改？',
          style: Object.assign({}, area, { minHeight: '0', height: '36px' }),
          onChange: (e) => openPromptEditor({ instruction: e.target.value }),
        }),
        view.mediaContext ? React.createElement('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', color: '#9aa3b2', marginTop: '12px' } },
          '本次渠道', React.createElement('select', {
            'aria-label': '本次生图渠道', value: view.channelId || '', disabled: Boolean(view.busy),
            onChange: event => openPromptEditor({ channelId: event.target.value }),
            style: { background: '#12151b', color: '#dbe3ee', border: '1px solid rgba(120,140,170,.4)', borderRadius: '7px', padding: '5px' },
          },
            React.createElement('option', { value: '' }, '沿用原渠道'),
            ...(view.channels || []).map(channel => React.createElement('option', { key: channel.id, value: channel.id }, channel.name)),
            view.comfyAvailable ? React.createElement('option', { value: 'comfyui' }, '当前 ComfyUI 设置') : null)) : null,
        React.createElement('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', color: '#9aa3b2', marginTop: '12px' } },
          '本次生图模式', React.createElement('select', { 'aria-label': '本次生图模式', value: view.generationMode || 'text', disabled: controlsDisabled || Boolean(view.inputsError),
            onChange: event => openPromptEditor({ generationMode: event.target.value, refreshReferences: false }), style: { background: '#12151b', color: '#dbe3ee', padding: '5px', borderRadius: '7px' } },
          React.createElement('option', { value: 'text' }, '文生图'),
          React.createElement('option', { value: 'reference', disabled: !referenceAvailable }, '参考图生图'))),
        referenceUnavailable ? React.createElement('div', { role: 'alert', style: { color: '#f0bf76', fontSize: '12px', marginTop: '6px' } }, '当前渠道不支持参考图输入；请明确选择支持参考图的渠道或改为文生图，不会自动降级。') : null,
        React.createElement('label', { style: { display: 'flex', gap: '8px', color: '#9aa3b2', fontSize: '12px', marginTop: '10px' } },
          React.createElement('input', { type: 'checkbox', 'aria-label': '使用最新人物库参考图快照', checked: view.refreshReferences === true,
            disabled: controlsDisabled || Boolean(view.inputsError) || view.generationMode !== 'reference', onChange: event => openPromptEditor({ refreshReferences: event.target.checked }) }),
          '明确改用最新人物库的参考图与一致性文本（不勾选则保留原任务快照）'),
        React.createElement('div', { style: { color: '#9aa3b2', fontSize: '11px', marginTop: '5px' } }, '切换模式不更换模型 ID。参考图在人物库中管理，本张不能临时换图；参考图仅本机保存，不随导出迁移。'),
        React.createElement('details', { open: Boolean(view.showInputs), onToggle: event => { const open = event.currentTarget.open; if (open !== Boolean(view.showInputs)) openPromptEditor({ showInputs: open }) }, style: { marginTop: '14px', color: '#dbe3ee', borderTop: '1px solid #3a4150', paddingTop: '10px' } },
          React.createElement('summary', { style: { cursor: 'pointer', fontSize: '13px' } }, '实际提交输入（原任务，只读）'),
          view.inputsLoading ? React.createElement('div', { role: 'status' }, '正在读取实际输入…') : null,
          view.inputsError ? React.createElement('div', { role: 'alert', style: { fontSize: '12px', color: '#f0bf76' } }, view.inputsError,
            React.createElement('button', { type: 'button', disabled: Boolean(view.inputsLoading || view.busy), onClick: () => openPromptEditor({ inputsReload: (view.inputsReload || 0) + 1 }) }, '重新读取输入')) : null,
          React.createElement('div', { style: { fontSize: '11px', color: '#9aa3b2', marginTop: '8px' } }, '下列为原任务记录，不会随上方编辑或模式切换而改写。'),
          React.createElement('div', { style: { fontSize: '12px', marginTop: '8px' } }, view.rawPromptSource && view.rawPromptSource !== 'rawTag' ? '原始输入回退记录（原文缺失）' : '规划原文／原始输入（原任务）'),
          React.createElement('pre', { 'aria-label': '规划原文', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '220px', overflowY: 'auto', fontSize: '12px' } }, view.loading ? '正在读取原文…' : view.originalPrompt || view.rawPrompt || '未记录原始输入'),
          React.createElement('div', { style: { fontSize: '11px', color: '#9aa3b2' } }, '这里展示原任务保存的场景与角色块，不是完整规划会话；手动任务可能是用户输入，旧任务可能由后端回退为已处理文本。'),
          view.promptAssembly?.version === 2 ? React.createElement('div', { 'aria-label': '提示词组装来源' },
            React.createElement('details', null, React.createElement('summary', null, '人物／服装／场景库自动补充'),
              React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '220px', overflowY: 'auto' } }, Array.isArray(view.promptAssembly.definitionAdditions) && view.promptAssembly.definitionAdditions.length ? view.promptAssembly.definitionAdditions.join('\n\n') : '本张没有自动补充')),
            React.createElement('details', null, React.createElement('summary', null, '插件生成的参考图绑定文本'),
              React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '220px', overflowY: 'auto' } }, String(view.promptAssembly.referenceText || '本张没有参考图绑定文本'))))
            : React.createElement('div', { style: { fontSize: '11px', color: '#9aa3b2' } }, '原任务未记录分层组装来源；不从最终文本反推资料补充或参考图绑定。'),
          React.createElement('div', { style: { fontSize: '12px', marginTop: '8px' } }, view.submittedPrompt && view.submittedPromptSource !== 'positive' ? '最终提交文本（原任务记录）' : '记录的最终正向提示词（旧任务可能没有完整提交文本）'),
          React.createElement('pre', { 'aria-label': '实际提交提示词', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '260px', overflowY: 'auto', fontSize: '12px' } }, view.submittedPrompt || view.actualPositive || view.finalPrompt || '暂无记录'),
          view.actualNegative ? React.createElement('pre', { 'aria-label': '实际负向提示词', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px' } }, '负向：' + view.actualNegative) : null,
          React.createElement('div', { style: { fontSize: '11px', color: '#9aa3b2', margin: '8px 0' } }, '参考图按原任务上传顺序展示，不按图库顺序；用途与归属取自原任务快照。旧任务的最终文本可能只有正向记录；此处不推测或重建。'),
          (view.references || []).length ? React.createElement('div', { 'aria-label': '原任务参考图', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' } },
            view.references.map((reference, position) => React.createElement('figure', { key: String(position), style: { margin: 0, padding: '8px', border: '1px solid #3a4150', borderRadius: '7px' } },
              /^[a-f0-9]{64}$/i.test(String(reference.image?.id || '')) ? React.createElement('img', { src: BASE + '/reference-image?id=' + encodeURIComponent(reference.image.id), alt: '参考图 ' + (reference.index ?? position + 1) + ' ' + referenceLabel(reference), style: { maxWidth: '100%', height: '120px', objectFit: 'contain' } }) : null,
              React.createElement('figcaption', { style: { fontSize: '12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
                '上传顺序 ' + (position + 1) + ' · 参考图 ' + (reference.index ?? position + 1) + ' · ' + referenceLabel(reference),
                '\n用途：' + (reference.kind === 'character' ? '身份参考（面部、发型、固有体型比例；不继承服装和姿势）' : reference.kind === 'outfit' ? '服装参考（服饰设计；不继承模特身份）' : '未记录'),
                '\n' + referenceOwner(reference),
                reference.consistencyText ? '\n一致性补充：' + String(reference.consistencyText) : ''),
              React.createElement('details', { 'aria-label': '参考图调试信息' },
                React.createElement('summary', { style: { fontSize: '11px', cursor: 'pointer' } }, '调试信息（内部 ID）'),
                React.createElement('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '11px' } }, JSON.stringify({ characterId: reference.characterId, outfitId: reference.outfitId, imageId: reference.image?.id, originalLabel: reference.label }, null, 2))))))
            : React.createElement('div', { style: { fontSize: '12px', color: '#9aa3b2' } }, '原任务未记录参考图。'),
          view.providerError ? React.createElement('div', { role: 'alert', 'aria-label': '平台错误', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px', color: '#f0bf76', marginTop: '8px' } }, '平台／任务错误：' + view.providerError) : null),
        view.inputsError && !view.showInputs ? React.createElement('div', { role: 'alert', style: { color: '#f0bf76', fontSize: '12px', marginTop: '8px' } }, view.inputsError + '，请展开实际提交输入重试。') : null,
        React.createElement('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap' } },
          btn('🤖 让后台改', improve),
          btn('👁 看展开结果', () => openPromptEditor({ showInputs: true })),
          btn(view.busy === 'redraw' ? '🎨 提交中…' : '🎨 用这段重画', redraw, true),
          view.note ? React.createElement('span', { style: { fontSize: '12px', color: '#9aa3b2' } }, view.note) : null,
        ),
        React.createElement('div', { style: { fontSize: '11px', color: '#6b7480', marginTop: '14px' } }, '提示：改完提示词点「用这段重画」，会在同一条消息里换成新图。'),
      ))
    }

    /**
     * 在 DSH 内部的全屏浮层里看某张图（不开浏览器标签）。
     */
    async function viewImage(jobId, title) {
      try {
        if (!jobId) return
        if (typeof openImageOverlay !== 'function') return
        const id = String(jobId)
        const label = String(title || '插图')
        // 这张图自己的重画版本链（独立于整场翻页）
        const chain = versionsOf(id)

        // 主翻页列表：整场对话里出过图的作业（旧 → 新）。拿不到就退回版本链。
        let list = []
        try {
          const r = await jsonFetch(BASE + '/history')
          const history = (r && Array.isArray(r.jobs)) ? r.jobs : []
          list = history
            .filter(job => job && job.id && (job.hasImage || job.byteLength))
            .map(job => String(job.id))
            .reverse()
        } catch { /* 拿不到历史就退回版本链 */ }
        if (!list.includes(id)) list = chain

        const at = Math.max(0, list.indexOf(id))
        const versionAt = Math.max(0, chain.indexOf(id))
        openImageOverlay({
          open: true,
          jobIds: list,
          index: at,
          versions: chain,
          versionAt: versionAt,
          working: false,
          note: label
            + (list.length > 1 ? '　第 ' + (at + 1) + ' / ' + list.length + ' 张' : '')
            + (chain.length > 1 ? '　（这张有 ' + chain.length + ' 个重画版本）' : ''),
        })
      } catch { /* 看图失败不影响正文 */ }
    }

    function PlannedBody(props) {
      const { text, messageId, turn, sessionId, renderText } = props
      const [plans, setPlans] = React.useState(null)
      const [jobIds, setJobIds] = React.useState([])
      const [state, setState] = React.useState('idle')
      const [note, setNote] = React.useState('')
      const [hover, setHover] = React.useState(false)
      const [progress, setProgress] = React.useState(0)

      React.useEffect(() => {
        // 恢复已有计划：切换页面 / 重新渲染 / 滚动回来时，宿主里可能早就存过这条的计划了。
        // 之前只在"收到事件"时才查，所以一离开页面图就没了。
        if (messageId) {
          jsonFetch(BASE + '/plans?messageId=' + encodeURIComponent(String(messageId)))
            .then(found => {
              const list = found?.plans ?? []
              if (!list.length) return
              reportHost('inline-restored', { messageId: String(messageId).slice(0, 14), plans: list.length })
              setPlans(list)
              setJobIds(list.map(p => p.jobId).filter(Boolean))
              setState('done')
            })
            .catch(() => {})
        }

        const handler = (event) => {
          const target = event && event.detail ? String(event.detail.messageId ?? '') : ''
          reportHost('inline-event', { target, mine: String(messageId ?? ''), match: target === String(messageId ?? '') })
          // 只有被点的那一条才处理（广播会给所有消息，这里必须筛掉）
          if (!messageId || !target || target !== String(messageId)) return
          jsonFetch(BASE + '/plans?messageId=' + encodeURIComponent(String(messageId)))
            .then(found => {
              const list = found?.plans ?? []
              reportHost('inline-fetched', { messageId: String(messageId ?? ''), got: list.length, mounts: list.map(p => String(p.mount ?? '').slice(0, 20)) })
              if (list.length) { setPlans(list); setJobIds(list.map(p => p.jobId).filter(Boolean)); setState('done') }
            })
            .catch(() => {})
        }
        window.addEventListener('dsh-tavern-image:planned', handler)
        return () => window.removeEventListener('dsh-tavern-image:planned', handler)
      }, [messageId])

      // 只有出过图才轮询进度，平时一声不响
      React.useEffect(() => {
        if (!jobIds.length) return
        let alive = true
        const timer = setInterval(async () => {
          if (!alive) return
          let done = 0
          for (const id of jobIds) {
            const r = await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(id)).catch(() => null)
            if (r?.job?.status === 'done') done += 1
          }
          if (!alive) return
          setProgress(done)
          if (done >= jobIds.length) clearInterval(timer)
        }, 4000)
        return () => { alive = false; clearInterval(timer) }
      }, [jobIds])

      async function generate() {
        if (state === 'working') return
        setState('working')
        setNote('')
        setJobIds([])
        try {
          const r = await jsonFetch(BASE + '/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId, turn, text, sessionId, manual: true }),
          })
          const list = r.plans ?? []
          if (!list.length) { setState('failed'); setNote(r.error || '没有产出画面'); return }
          setState('done')
          setPlans(list)
          setJobIds(list.map(item => item.jobId).filter(Boolean))
        } catch (error) {
          setState('failed')
          setNote(error && error.message ? error.message : String(error))
        }
      }

      // 已经有图：按 host 给的「挂载句」把图插进正文对应位置
      if (plans && plans.length) {
        reportHost('inline-splitting', { messageId: String(messageId ?? ''), plans: plans.length, textLen: String(text ?? '').length })
        return h(React.Fragment, null,
          splitByPlan(text, plans, renderText, { messageId, turn, sessionId }),
        )
      }

      // 没有计划：先看正文里有没有模型自己写的 image###Tag### 标记（自动生图开的那个通道）。
      // 有就按标记切段、就地出图 —— 只按标记切（通常 4 段以内），不是按行切，不会把 markdown 渲染几十次。
      // 宿主按 key 去重，同一条消息的同一个位置永远只画一次，翻历史、刷新页面都复用同一张。
      const segments = splitSegments(text)
      let markerCount = 0
      for (const segment of segments) if (segment.type === 'image') markerCount += 1
      if (markerCount) {
        const owner = String(messageId ?? 'x')
        reportHost('inline-markers', { messageId: owner.slice(0, 14), markers: markerCount, textLen: String(text ?? '').length })
        return h(React.Fragment, null, segments.map((segment, index) => (
          segment.type === 'image'
            ? h(InlineImage, {
              key: 'marker-img-' + index,
              prompt: segment.prompt,
              imageKey: contentKey(messageId, turn, index, segment.prompt),
              auto: true,
            })
            : h(Segment, {
              key: 'marker-text-' + index,
              value: segment.value,
              index,
              renderText,
              keyName: 'marker-text-' + owner + '-' + index,
              messageId, turn, sessionId,
            })
        )))
      }

      // 没有计划、也没有待显示的图：正文照常渲染出来，不要返回 null。
      // ⚠️ 宿主（message-frame.js 的 renderTavernProjection）只检查渲染器**函数**的返回值：
      //    不是 null/undefined 就直接采用，不会再回落原生渲染。所以"返回 null 交回宿主"
      //    只在 renderAssistantText 那一层成立，在 PlannedBody 这一层不成立 —— 在这里
      //    返回 null 会让整段正文空白（2026-10-07 踩过）。
      if (!jobIds.length) {
        return h(Segment, {
          key: 'rphub-plain',
          value: text,
          index: 0,
          renderText,
          keyName: 'rphub-plain-' + String(messageId ?? 'x'),
          messageId, turn, sessionId,
        })
      }
      const body = renderText(text, 'rphub-body-' + String(messageId ?? 'x'))
      return h(React.Fragment, null,
        body,
        h('div', { style: { margin: '6px 0 12px' } },
          jobIds.map(id => h('img', {
            key: id,
            src: BASE + '/jobs?id=' + encodeURIComponent(id) + '&image=1',
            style: { display: 'block', width: '100%', maxWidth: '520px', borderRadius: '10px', margin: '8px 0' },
            onClick: () => viewImage(id, ''),
          })),
          progress < jobIds.length ? h('div', { style: { fontSize: '11px', color: '#9aa3b2' } }, '画好了 ' + progress + ' / ' + jobIds.length) : null,
        ),
      )
    }

    /** 渲染器：有 image### 标记就走标记；没有就用 agent 规划。都没命中就返回 null。 */
    /** 已经主动规划过的消息，避免重复调模型 */
    const planEnsured = new Set()
    /**
     * 「自动生图」只认最新一轮，而且**要等渲染稳定下来**再动手。
     *
     * 为什么必须防抖：打开一个长会话时，历史消息是逐条渲染的，每一步的 turn 都比上一步大。
     * 如果"见到更大的 turn 就规划"，一屏历史能一口气排出一串后台任务 —— 这个坑第一次上线就踩了
     * （重启后冒出几十张图）。所以这里只记下见过的最大轮次，等 1.2 秒不再有更新的轮次出现，
     * 它才真的是"最新一轮"，那时才去规划。
     * turn 拿不到就什么都不做：宁可不自动，也不要乱触发。
     */
    let autoPlanSession = ''
    let autoPlanTurn = -1
    let autoPlanTimer = null
    let autoPlanPending = null
    function scheduleAutoPlan(sessionId, turn, messageId, text) {
      const sid = String(sessionId ?? '')
      if (sid !== autoPlanSession) { autoPlanSession = sid; autoPlanTurn = -1 }
      const t = Number(turn)
      if (!Number.isFinite(t) || t <= 0) return
      if (t <= autoPlanTurn) return        // 比已见过的更旧：一定是历史消息，不规划
      autoPlanTurn = t
      autoPlanPending = { messageId, text, sessionId: sid, turn: t }
      if (autoPlanTimer) clearTimeout(autoPlanTimer)
      autoPlanTimer = setTimeout(() => {
        autoPlanTimer = null
        const job = autoPlanPending
        autoPlanPending = null
        // 期间又出现了更新的轮次 → 那一次会重新排，这次作废
        if (!job || job.turn !== autoPlanTurn) return
        ensurePlanFor(job.messageId, job.text, job.sessionId, job.turn)
      }, 1200)
    }
    /**
     * 渲染器一被调用就主动去要计划 —— 不等 React 组件挂载。
     * （React 那边会不会挂载取决于宿主，不能把规划押在它身上。）
     */
    function ensurePlanFor(messageId, text, sessionId, turn) {
      try {
        if (!messageId) return
        if (planEnsured.has(messageId)) return
        planEnsured.add(messageId)
        jsonFetch(BASE + '/plans?messageId=' + encodeURIComponent(messageId)).then(found => {
          if (found?.plans?.length) return null
          reportHost('plan-request', { messageId, textLen: String(text ?? '').length, source: 'renderer' })
          return jsonFetch(BASE + '/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId, turn, text, sessionId }),
          }).then(response => {
            const got = (response?.plans ?? []).length
            reportHost('plan-response', { ok: response?.ok, plans: got, error: response?.error ?? '' })
            if (got) {
              try { window.dispatchEvent(new CustomEvent('dsh-tavern-image:planned', { detail: { messageId } })) } catch {}
            }
            return null
          })
        }).catch(error => {
          reportHost('plan-threw', { messageId, message: String(error?.message ?? error).slice(0, 400) })
        })
      } catch (error) {
        reportHost('plan-ensure-failed', { message: String(error?.message ?? error).slice(0, 300) })
      }
    }

    /**
     * 正文渲染：整段交给宿主的渲染器（**不切段** —— 切段会让 markdown 渲染几十次、界面卡死），
     * 末尾跟一个「生图」按钮。只在游玩时的回复里出现（那种消息带着 turn）。
     */
    function renderAssistantText(text, context, options) {
      try {
        if (context?.sessionId) lastSessionId = String(context.sessionId)
        // ⚠️ 这是 v1.0「打补丁时代」的遗留函数，**当前没有任何地方注册它**，留着只为备查。
        //    正文渲染已经交回 Tavern 原生：图由宿主侧 tavern.attach 按 anchor 挂上，
        //    Tavern 自己渲染、自己跟 textVersion 绑定。
        //    不要再注册它 —— 一旦注册，会和 attach 挂的图重复渲染。
        if (context?.streaming) return null
        const renderText = typeof context?.renderText === 'function' ? context.renderText : null
        if (!renderText) return null
        // 卡片工作台（Tavern 的 mode === "card"）不生成插图、也不接管正文：
        // 这里是"改卡"的地方，正文里出现的 image### 标记不该在这里被画成图。
        // 判定来自 Tavern 侧渲染补丁给出的 cardBench 字段（见 message-frame.js）。
        // 注意：Tavern 宿主已经对"消息级动作"做了 isPlayMode 判定，所以「🎨 生图」按钮
        // 本来就不在工作台出现，这里补的是正文渲染这一条路径。
        if (context?.cardBench) {
          // 卡片工作台：绝不出图。
          // 正常情况这里没有任何标记，直接返回 null 让 Tavern 原生渲染，零影响；
          // 万一模型还是写了 image### 标记（自动生图规则会跟到所有请求），就把它清掉再渲染，
          // 免得工作台的正文里露出一串标记。
          const original = String(text ?? '')
          const cleaned = original.replace(new RegExp(IMAGE_TAG.source, 'gi'), '').replace(/\n{3,}/g, '\n\n').trim()
          if (cleaned === original.trim()) return null
          reportHost('cardbench-stripped', { messageId: String(context?.messageId ?? '').slice(0, 14), removed: original.length - cleaned.length })
          return h(React.Fragment, null, renderText(cleaned, 'card-bench-' + String(context?.messageId ?? 'x')))
        }
        // 不再依赖 turn：Tavern 的渲染链路只服务游玩对话，工作台/设置页不走这里，
        // 所以"只在游玩时出现"是天然成立的（之前按 turn 判定导致按钮永不出现）。
        reportHost('renderer-takeover', { messageId: String(context?.messageId ?? ''), turn: context?.turn, cardBench: Boolean(context?.cardBench), textLen: String(text ?? '').length })
        // 「自动生图」：生图规划开着时，正文渲染稳定后替**最新一轮**要一次计划，不用点按钮。
        //   短消息（工具回执、寒暄）不配图；历史消息不规划；连续渲染时只认最后停下来的那一轮。
        // 「🎨 生图」按钮完全不受影响 —— 点它依然是对那一条消息单独生图、重新生图。
        // 自动配图已由**宿主侧**的 Tavern 官方接口桥接管（tavern.onTurnSettled → 规划 → attach），
        // 图由 Tavern 自己按 anchor 渲染并与正文版本绑定。前端不再在渲染时发起规划 ——
        // 否则同一条正文会被规划两次、出两批图。手动按钮不受影响，仍然可用。
        return h(PlannedBody, {
          text: String(text ?? ''),
          messageId: context?.messageId,
          turn: context?.turn,
          sessionId: context?.sessionId,
          renderText,
        })
      } catch (error) {
        reportHost('render-error', { message: String(error?.message ?? error).slice(0, 300) })
        return null
      }
    }

    /**
     * 消息级生图：挂在整条消息容器里（Tavern 的 extensionActions 通道），
     * 不管这条消息是纯文本还是 HTML 面板卡，都能看到。图直接显示在消息下方。
     */
    function MessageImageButton(props) {
      const { text, messageId, turn, sessionId } = props
      const [plans, setPlans] = React.useState(null)
      const [state, setState] = React.useState('idle')
      const [note, setNote] = React.useState('')
      const [hover, setHover] = React.useState(false)
      const [progress, setProgress] = React.useState(0)

      React.useEffect(() => {
        if (!plans || !plans.length) return
        let alive = true
        const timer = setInterval(async () => {
          if (!alive) return
          let done = 0
          for (const p of plans) {
            const r = await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(p.jobId)).catch(() => null)
            if (r?.job?.status === 'done') done += 1
          }
          if (!alive) return
          setProgress(done)
          if (done >= plans.length) clearInterval(timer)
        }, 4000)
        return () => { alive = false; clearInterval(timer) }
      }, [plans])

      async function generate() {
        if (state === 'working') return
        setState('working')
        setNote('')
        setPlans(null)
        reportHost('plan-request', { messageId: String(messageId ?? ''), textLen: String(text ?? '').length, source: 'message-action' })
        try {
          const r = await jsonFetch(BASE + '/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId, turn, text, sessionId, manual: true }),
          })
          const list = r.plans ?? []
          reportHost('plan-response', { ok: r?.ok, plans: list.length, error: r?.error ?? '' })
          if (!list.length) { setState('failed'); setNote(r.error || '没有产出画面'); return }
          setState('done')
          setPlans(list)
          try {
            reportHost('inline-dispatch', { messageId: String(messageId ?? ''), textLen: String(text ?? '').length, plans: list.length })
            window.dispatchEvent(new CustomEvent('dsh-tavern-image:planned', { detail: { messageId: String(messageId ?? '') } }))
          } catch (error) { reportHost('inline-dispatch-failed', { message: String(error?.message ?? error) }) }
        } catch (error) {
          reportHost('plan-threw', { message: String(error?.message ?? error).slice(0, 300) })
          setState('failed')
          setNote(error && error.message ? error.message : String(error))
        }
      }

      const busy = state === 'working'
      return React.createElement('div', { style: { margin: '6px 0 10px' } },
        React.createElement('div', { style: { textAlign: 'right' } },
          React.createElement('button', {
            type: 'button',
            disabled: busy,
            onClick: generate,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            title: '按这一整段回复生成插图',
            style: {
              padding: '3px 12px', fontSize: '12px', borderRadius: '8px',
              border: '1px solid rgba(120,140,170,.5)',
              background: hover ? 'rgba(106,168,255,.16)' : 'rgba(106,168,255,.06)',
              color: state === 'failed' ? '#f2686b' : '#b9c3d1',
              cursor: busy ? 'default' : 'pointer',
            },
          }, busy ? '🎨 生成中…' : state === 'failed' ? '🎨 重试' : state === 'done' ? '🎨 重新生图' : '🎨 生图'),
          note ? React.createElement('span', { style: { fontSize: '11px', color: '#f2686b', marginLeft: '8px' } }, note) : null,
        ),
        // 图只显示在正文里（这里不再重复显示），按钮留着触发
      )
    }

    function ImageOverlay() {
      const [view, setView] = React.useState({ open: false, jobIds: [], note: '', working: false, index: 0 })
      // 缩放与平移：滚轮缩放、按住拖动（触摸同样支持）
      const [zoom, setZoom] = React.useState(1)
      const [pos, setPos] = React.useState({ x: 0, y: 0 })
      const [dragging, setDragging] = React.useState(false)
      const [imageWarning, setImageWarning] = React.useState('')
      const dragRef = React.useRef(null)
      const onWheel = React.useCallback(event => {
        event.preventDefault()
        setZoom(z => Math.max(0.2, Math.min(8, z * (event.deltaY > 0 ? 0.9 : 1.1))))
      }, [])
      const onDragStart = React.useCallback(event => {
        event.preventDefault()
        dragRef.current = { x: event.clientX - pos.x, y: event.clientY - pos.y }
        setDragging(true)
      }, [pos.x, pos.y])
      const onDragMove = React.useCallback(event => {
        if (!dragRef.current) return
        setPos({ x: event.clientX - dragRef.current.x, y: event.clientY - dragRef.current.y })
      }, [])
      const onDragEnd = React.useCallback(() => { dragRef.current = null; setDragging(false) }, [])
      const onTouchStart = React.useCallback(event => {
        const touch = event.touches && event.touches[0]
        if (!touch) return
        dragRef.current = { x: touch.clientX - pos.x, y: touch.clientY - pos.y }
        setDragging(true)
      }, [pos.x, pos.y])
      const onTouchMove = React.useCallback(event => {
        const touch = event.touches && event.touches[0]
        if (!dragRef.current || !touch) return
        event.preventDefault()
        setPos({ x: touch.clientX - dragRef.current.x, y: touch.clientY - dragRef.current.y })
      }, [])
      openImageOverlay = (next) => setView(current => Object.assign({}, current, next && next.open ? Object.assign({ index: 0, versionAt: 0 }, next) : next))
      const close = () => openImageOverlay({ open: false, jobIds: [], versions: [], versionAt: 0, note: '', working: false, index: 0 })
      const total = view.jobIds.length
      const at = total ? Math.max(0, Math.min(total - 1, Number(view.index) || 0)) : 0
      // 当前这张图自己的重画版本链（与整场翻页互不影响）
      const versions = Array.isArray(view.versions) ? view.versions : []
      const vTotal = versions.length
      const vAt = vTotal ? Math.max(0, Math.min(vTotal - 1, Number(view.versionAt) || 0)) : 0
      // 真正显示的那张：有版本链就用版本链的当前版，否则用主列表的当前张
      const shownId = vTotal ? versions[vAt] : view.jobIds[at]
      React.useEffect(() => {
        let alive = true
        setImageWarning('')
        if (view.open && shownId) jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(shownId)).then(result => {
          if (alive) setImageWarning(String(result?.job?.imageOutputWarning || ''))
        }).catch(() => {})
        return () => { alive = false }
      }, [view.open, shownId])
      const go = (delta) => {
        if (total < 2) return
        // 翻整场的时候把版本链清掉，免得两张图的版本串在一起
        openImageOverlay({ index: (at + delta + total) % total, versions: [], versionAt: 0 })
      }
      const goVersion = (delta) => {
        if (vTotal < 2) return
        openImageOverlay({ versionAt: (vAt + delta + vTotal) % vTotal })
      }
      React.useEffect(() => {
        if (!view.open || total < 2) return undefined
        const onKey = (event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
          else if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
          else if (event.key === 'Escape') close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [view.open, at, total])
      // 切图或重新打开时复位缩放与位移
      React.useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }); dragRef.current = null }, [view.open, at])
      if (!view.open) return null
      const goPrev = () => go(-1)
      const goNext = () => go(1)
      return React.createElement('div', {
        style: {
          position: 'fixed', inset: '0', zIndex: 2147483000, background: 'rgba(0,0,0,.82)',
          overflowY: 'auto', padding: '16px 20px 40px', boxSizing: 'border-box', backdropFilter: 'blur(3px)',
        },
        onClick: close,
      }, React.createElement('div', {
        style: { maxWidth: '1240px', margin: '0 auto' },
        onClick: event => event.stopPropagation(),
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' } },
          React.createElement('div', { style: { color: '#e6ecf5', fontSize: '15px', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            view.working ? '正在生成…' : (view.note || '插图')),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
            total > 1 ? React.createElement('button', {
              type: 'button', onClick: goPrev, title: '上一张（←）',
              style: { padding: '5px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'rgba(255,255,255,.06)', color: '#dbe3ee', cursor: 'pointer' },
            }, '◀') : null,
            total > 1 ? React.createElement('span', { style: { fontSize: '12px', color: '#9aa3b2', minWidth: '44px', textAlign: 'center' } }, (at + 1) + ' / ' + total) : null,
            total > 1 ? React.createElement('button', {
              type: 'button', onClick: goNext, title: '下一张（→）',
              style: { padding: '5px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'rgba(255,255,255,.06)', color: '#dbe3ee', cursor: 'pointer' },
            }, '▶') : null,
            React.createElement('button', {
              type: 'button', onClick: close,
              style: { padding: '5px 16px', fontSize: '13px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'transparent', color: '#dbe3ee', cursor: 'pointer' },
            }, '关闭'),
          ),
        ),
        view.working ? React.createElement('div', { style: { color: '#9aa3b2', fontSize: '14px', padding: '30px 0', textAlign: 'center' } }, '规划中，通常十几秒…') : null,
        imageWarning ? React.createElement('div', { role: 'status', style: { color: '#e2b93b', fontSize: '12px', textAlign: 'center', padding: '8px 10px', marginBottom: '8px', background: 'rgba(226,185,59,.1)', borderRadius: '8px' } }, imageWarning) : null,
        React.createElement('div', {
          style: view.jobIds.length > 1
            ? { display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', alignItems: 'flex-start' }
            : { display: 'flex', justifyContent: 'center' },
        },
          // 左右两侧的大按钮（图很大时也好点）
          total > 1 ? React.createElement('button', {
            type: 'button', onClick: (e) => { e.stopPropagation(); goPrev() }, title: '上一张（←）',
            style: {
              position: 'fixed', left: '18px', top: '50%', transform: 'translateY(-50%)',
              zIndex: 2147483006, width: '64px', height: '120px', borderRadius: '14px',
              border: '1px solid rgba(255,255,255,.22)', background: 'rgba(20,24,30,.72)',
              color: '#e9eef6', fontSize: '34px', lineHeight: 1, cursor: 'pointer',
              backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            },
          }, '‹') : null,
          total > 1 ? React.createElement('button', {
            type: 'button', onClick: (e) => { e.stopPropagation(); goNext() }, title: '下一张（→）',
            style: {
              position: 'fixed', right: '18px', top: '50%', transform: 'translateY(-50%)',
              zIndex: 2147483006, width: '64px', height: '120px', borderRadius: '14px',
              border: '1px solid rgba(255,255,255,.22)', background: 'rgba(20,24,30,.72)',
              color: '#e9eef6', fontSize: '34px', lineHeight: 1, cursor: 'pointer',
              backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            },
          }, '›') : null,
          // 一次只显示当前这张，左右按钮切换
          // 一次只显示当前这张；可拖动平移、滚轮缩放
          // 只显示当前这一张（shownId：有重画版本就用版本里的当前版）
          [shownId].filter(Boolean).map(id => React.createElement('img', {
            key: id,
            src: BASE + '/jobs?id=' + encodeURIComponent(id) + '&image=1',
            alt: view.note || '插图',
            draggable: false,
            onWheel: onWheel, onMouseDown: onDragStart, onMouseMove: onDragMove, onMouseUp: onDragEnd,
            onMouseLeave: onDragEnd, onTouchStart: onTouchStart, onTouchMove: onTouchMove, onTouchEnd: onDragEnd,
            style: {
              display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 200px)', width: 'auto', height: 'auto',
              objectFit: 'contain', borderRadius: '12px', background: '#1a1d24',
              cursor: zoom > 1 ? 'grab' : 'default', userSelect: 'none', touchAction: 'none',
              transform: 'translate(' + pos.x + 'px,' + pos.y + 'px) scale(' + zoom + ')',
              transition: dragging ? 'none' : 'transform .12s',
            },
          })),
          // 这张图自己的重画版本（跟上面"整场翻页"是两回事），只有多于 1 版才显示
          vTotal > 1 ? React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '12px', position: 'relative', zIndex: 2147483006 },
            onClick: event => event.stopPropagation(),
          },
            React.createElement('span', { style: { fontSize: '12px', color: '#9aa3b2' } }, '重画版本'),
            React.createElement('button', {
              type: 'button', onClick: () => goVersion(-1), title: '上一个版本',
              style: { padding: '3px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'rgba(255,255,255,.06)', color: '#dbe3ee', cursor: 'pointer' },
            }, '◀'),
            React.createElement('span', { style: { fontSize: '12px', color: '#c8d2e0', minWidth: '40px', textAlign: 'center' } }, (vAt + 1) + ' / ' + vTotal),
            React.createElement('button', {
              type: 'button', onClick: () => goVersion(1), title: '下一个版本',
              style: { padding: '3px 12px', fontSize: '13px', borderRadius: '8px', border: '1px solid rgba(160,180,210,.5)', background: 'rgba(255,255,255,.06)', color: '#dbe3ee', cursor: 'pointer' },
            }, '▶'),
          ) : null,
        ),
        view.jobIds.length ? React.createElement('div', { style: { color: '#8b95a5', fontSize: '12px', textAlign: 'center', paddingBottom: '20px' } }, '点空白处关闭' + (total > 1 ? '　也可以点两侧的 ‹ › 或按 ← → 切换' : '')) : null,
      ))
    }

    function DockImageButton(props) {
      const [working, setWorking] = React.useState(false)
      const [hover, setHover] = React.useState(false)
      async function run() {
        if (working) return
        setWorking(true)
        try {
          if (openImageOverlay) openImageOverlay({ open: true, jobIds: [], note: '', working: true })
          const r = await jsonFetch(BASE + '/plan', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: String(props?.sessionId ?? lastSessionId ?? ''), turn: 0, manual: true }),
          })
          const ids = (r.plans || []).map(p => p.jobId).filter(Boolean)
          if (openImageOverlay) openImageOverlay({ open: true, jobIds: ids, note: ids.length ? ('本轮 ' + ids.length + ' 张') : (r.error || '没产出画面'), working: false })
        } catch (error) {
          if (openImageOverlay) openImageOverlay({ open: true, jobIds: [], note: '生成失败：' + (error && error.message ? error.message : error), working: false })
        } finally {
          setWorking(false)
        }
      }
      return React.createElement('button', {
        type: 'button',
        title: '按最新一段正文生成插图',
        disabled: working,
        onClick: run,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          padding: '4px 12px', fontSize: '13px', borderRadius: '8px',
          border: '1px solid rgba(120,140,170,.55)',
          background: hover ? 'rgba(106,168,255,.16)' : 'rgba(106,168,255,.07)',
          color: '#dbe3ee', cursor: working ? 'default' : 'pointer', whiteSpace: 'nowrap',
        },
      }, working ? '🎨 生成中…' : '🎨 生图')
    }

    // ================= 助手消息下方的「生图」按钮（保留，万一以后能用） =================
    /** 点了之后就地规划这一条消息的正文，并通知正文里的图重新取一次计划。 */
    function ImageActionButton(props) {
      const messageId = String(props?.messageId ?? '')
      const sessionId = String(props?.sessionId ?? '')
      const [state, setState] = React.useState('idle')
      const [note, setNote] = React.useState('')
      // 正文由宿主自己从会话里读（不依赖前端的渲染钩子）；这里只在已知太短时藏掉按钮
      const cached = textByMessage.get(messageId)
      const usable = cached === undefined ? true : cached.trim().length >= 12
      const [jobIds, setJobIds] = React.useState([])

      async function generate() {
        if (state === 'working' || !usable) return
        setState('working')
        setNote('')
        try {
          const r = await jsonFetch(BASE + '/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageId, turn: props?.turn, sessionId, manual: true }),
          })
          const list = r.plans || []
          if (!list.length) {
            setState('failed')
            setNote(r.error || '规划没产出画面')
            return
          }
          setState('done')
          setNote('已生成 ' + list.length + ' 张')
          setJobIds(list.map(item => item.jobId).filter(Boolean))
          // 正文里那套渲染是另一个组件，靠这个事件让它去取新计划并插图
          try { window.dispatchEvent(new CustomEvent('dsh-tavern-image:planned', { detail: { messageId } })) } catch {}
        } catch (error) {
          setState('failed')
          setNote(error && error.message ? error.message : String(error))
        }
      }

      if (!usable) return null
      const label = state === 'working' ? '🎨 生成中…' : state === 'done' ? '🎨 重新生图' : state === 'failed' ? '🎨 重试生图' : '🎨 生图'
      const images = state === 'done' && jobIds.length
        ? React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px', width: '100%' } },
          jobIds.map(id => React.createElement('img', {
            key: id,
            src: BASE + '/jobs?id=' + encodeURIComponent(id) + '&image=1',
            title: '点开看大图',
            style: { width: '150px', borderRadius: '10px', cursor: 'pointer', display: 'block' },
            onClick: () => viewImage(id, ''),
          })))
        : null
      return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
        React.createElement('button', {
          type: 'button',
          title: '按这条正文生成插图（插在正文对应句子后面）',
          disabled: state === 'working',
          onClick: generate,
          style: {
            padding: '4px 14px', fontSize: '13px', borderRadius: '8px',
            border: '1px solid rgba(120,140,170,.6)',
            background: state === 'done' ? 'rgba(78,201,138,.16)' : 'rgba(106,168,255,.1)',
            color: state === 'failed' ? '#f2686b' : '#dbe3ee',
            cursor: state === 'working' ? 'default' : 'pointer',
            whiteSpace: 'nowrap',
          },
        }, label),
        note ? React.createElement('span', { style: { fontSize: '11px', color: state === 'failed' ? '#f2686b' : '#9aa3b2' } }, note) : null,
        images,
      )
    }

    // ================= 设置面板（设置 → 配图） =================
    const S = {
      surface: { background: 'transparent', color: 'var(--dsw-alias-label-primary)' },
      row: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' },
      label: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', minWidth: '92px' },
      input: { backgroundColor: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '7px 10px', fontSize: '13px', lineHeight: '18px' },
      card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '12px 14px', margin: '10px 0', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 2%, transparent)' },
      tab: (on) => ({ padding: '5px 13px', borderRadius: '8px', border: '1px solid ' + (on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'), background: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 4%, transparent)', color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '13px' }),
      badge: (ok) => ({ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', marginRight: '6px' }),
    }

    // 设置页的原生控件统一外观：自画下拉箭头、焦点用强调色描边（行内样式管不到伪类和 appearance）。
    const SETTINGS_CSS = `
.dti-settings select { appearance: none; -webkit-appearance: none; padding-right: 30px !important; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%238a8f98' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center; text-overflow: ellipsis; }
.dti-settings select:disabled { cursor: default; opacity: .6; }
.dti-settings select:focus, .dti-settings input:focus, .dti-settings textarea:focus { outline: none;
  border-color: var(--dsw-alias-brand-primary) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.dti-settings input[type=checkbox] { accent-color: var(--dsw-alias-brand-primary); }
.dti-switch { appearance: none; -webkit-appearance: none; flex-shrink: 0; width: 36px; height: 20px; margin: 0; border-radius: 10px; cursor: pointer; position: relative;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 35%, transparent); transition: background .15s; }
.dti-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s; }
.dti-switch:checked { background: var(--dsw-alias-brand-primary); }
.dti-switch:checked::after { transform: translateX(16px); }
.dti-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.dti-field-label small { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
`

    function WorkflowGraphEditor(props) {
      const file = String(props?.file || '')
      const post = props?.post
      const [raw, setRaw] = React.useState(null)
      const [revision, setRevision] = React.useState('')
      const [draft, setDraft] = React.useState({})
      const [positions, setPositions] = React.useState({})
      const [selected, setSelected] = React.useState('')
      const [view, setView] = React.useState({ x: 36, y: 36, scale: 1 })
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [drag, setDrag] = React.useState(null)
      const canvasRef = React.useRef(null)
      const initialPositions = React.useRef({})
      const nodeWidth = 280
      const colors = { prompt: '#54c6eb', sampler: '#ec8c42', model: '#b87bec', image: '#59cf8a', decode: '#66a9f5', other: '#d5ac5b' }

      React.useEffect(() => {
        let alive = true
        setRaw(null); setError(''); setSelected(''); setDraft({}); setPositions({})
        Promise.resolve(post('/workflow-graph', { file })).then(result => {
          if (!alive) return
          if (!result?.ok || !result?.workflow?.prompt) throw new Error(result?.error || '工作流格式不正确')
          const workflow = result.workflow
          const ids = Object.keys(workflow.prompt)
          const stored = workflow.graphPositions && typeof workflow.graphPositions === 'object' ? workflow.graphPositions : {}
          const depth = Object.fromEntries(ids.map(id => [id, 0]))
          const indegree = Object.fromEntries(ids.map(id => [id, 0]))
          const outgoing = Object.fromEntries(ids.map(id => [id, []]))
          for (const target of ids) for (const value of Object.values(workflow.prompt[target]?.inputs || {})) {
            if (Array.isArray(value) && value.length >= 2 && Object.hasOwn(workflow.prompt, String(value[0]))) {
              const source = String(value[0]); outgoing[source].push(target); indegree[target] += 1
            }
          }
          const queue = ids.filter(id => indegree[id] === 0)
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const source = queue[cursor]
            for (const target of outgoing[source]) {
              depth[target] = Math.max(depth[target], depth[source] + 1)
              indegree[target] -= 1
              if (indegree[target] === 0) queue.push(target)
            }
          }
          const maxDepth = Math.max(0, ...Object.values(depth))
          const layerOrder = {}
          for (const id of ids) {
            const layer = indegree[id] > 0 ? maxDepth + 1 + (ids.indexOf(id) % 2) : depth[id]
            ;(layerOrder[layer] ||= []).push(id)
          }
          const layout = {}
          const defaultPositions = {}
          for (const [layer, layerIds] of Object.entries(layerOrder)) layerIds.forEach((id, row) => {
            defaultPositions[id] = { x: 80 + Number(layer) * 370, y: 70 + row * 245 }
          })
          ids.forEach(id => {
            const position = stored[id]
            layout[id] = position && Number.isFinite(position.x) && Number.isFinite(position.y)
              ? { x: position.x, y: position.y }
              : defaultPositions[id]
          })
          initialPositions.current = JSON.parse(JSON.stringify(layout))
          setPositions(layout)
          setRevision(String(result.revision || ''))
          setRaw(workflow)
          setView({ x: 36, y: 36, scale: 1 })
        }).catch(e => { if (alive) setError('工作流读取失败：' + String(e?.message ?? e)) })
        return () => { alive = false }
      }, [file])

      const nodes = raw?.prompt || {}
      const ids = Object.keys(nodes)
      const links = []
      ids.forEach(targetId => Object.entries(nodes[targetId]?.inputs || {}).forEach(([field, value]) => {
        if (Array.isArray(value) && value.length >= 2 && Object.hasOwn(nodes, String(value[0]))) links.push({ source: String(value[0]), target: targetId, field })
      }))
      function nodeColor(classType) {
        const name = String(classType || '').toLowerCase()
        if (/clip|text|prompt|conditioning/.test(name)) return colors.prompt
        if (/sampler|scheduler/.test(name)) return colors.sampler
        if (/checkpoint|lora|model/.test(name)) return colors.model
        if (/save|preview|image|latent/.test(name)) return colors.image
        if (/decode|vae/.test(name)) return colors.decode
        return colors.other
      }
      function inputValue(nodeId, field, value) {
        const draftValue = draft[nodeId]?.[field]
        return draftValue === undefined ? String(value ?? '') : String(draftValue)
      }
      function isDirty() {
        if (!raw) return false
        for (const id of ids) {
          for (const [field, value] of Object.entries(nodes[id]?.inputs || {})) {
            if (Array.isArray(value) || (value !== null && typeof value === 'object')) continue
            const changed = draft[id]?.[field]
            if (changed !== undefined && String(changed) !== String(value ?? '')) return true
          }
          const original = initialPositions.current[id]
          const current = positions[id]
          if (original && current && (original.x !== current.x || original.y !== current.y)) return true
        }
        return false
      }
      function close() {
        if (busy) return
        if (isDirty() && !confirm('有未保存的工作流修改，确定关闭吗？')) return
        props?.onClose?.()
      }
      function setField(nodeId, field, value) {
        if (busy) return
        setDraft(current => Object.assign({}, current, { [nodeId]: Object.assign({}, current[nodeId], { [field]: value }) }))
      }
      function changeZoom(amount) {
        setView(current => Object.assign({}, current, { scale: Math.max(0.2, Math.min(2.5, current.scale + amount)) }))
      }
      function resetView() {
        setView({ x: 36, y: 36, scale: 1 })
      }
      function fitView() {
        const box = canvasRef.current
        if (!box || !ids.length) { resetView(); return }
        const xs = ids.map(id => positions[id]?.x ?? 0), ys = ids.map(id => positions[id]?.y ?? 0)
        const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys)
        const scale = Math.max(0.2, Math.min(1.4, Math.min((box.clientWidth - 70) / (maxX - minX + nodeWidth + 80), (box.clientHeight - 70) / (maxY - minY + 180))))
        setView({ x: 35 - minX * scale, y: 35 - minY * scale, scale })
      }
      function beginDrag(event, id) {
        if (busy) return
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault?.()
        setSelected(id)
        setDrag({ kind: 'node', id, startX: event.clientX, startY: event.clientY, origin: positions[id] || { x: 0, y: 0 } })
      }
      function beginPan(event) {
        if (event.target !== event.currentTarget || (event.button !== undefined && event.button !== 0)) return
        setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, origin: { x: view.x, y: view.y } })
      }
      function movePointer(event) {
        if (busy || !drag) return
        const dx = (event.clientX - drag.startX) / (drag.kind === 'node' ? view.scale : 1)
        const dy = (event.clientY - drag.startY) / (drag.kind === 'node' ? view.scale : 1)
        if (drag.kind === 'node') setPositions(current => Object.assign({}, current, { [drag.id]: { x: Math.max(-100000, Math.min(100000, drag.origin.x + dx)), y: Math.max(-100000, Math.min(100000, drag.origin.y + dy)) } }))
        else setView(current => Object.assign({}, current, { x: drag.origin.x + dx, y: drag.origin.y + dy }))
      }
      function save() {
        if (!raw || busy) return
        const inputs = {}
        for (const [id, fields] of Object.entries(draft)) {
          for (const [field, typed] of Object.entries(fields)) {
            const original = nodes[id]?.inputs?.[field]
            if (typeof original === 'string') {
              if (String(typed) !== original) (inputs[id] ||= {})[field] = String(typed)
            } else if (typeof original === 'number') {
              if (String(typed).trim() === '') { setError('数字参数不能为空。'); return }
              const number = Number(typed)
              if (Number.isFinite(number) && number !== original) (inputs[id] ||= {})[field] = number
              else if (!Number.isFinite(number)) { setError('请输入有效数字后再保存。'); return }
            } else if (typeof original === 'boolean') {
              const bool = typed === true || typed === 'true'
              if (bool !== original) (inputs[id] ||= {})[field] = bool
            }
          }
        }
        const moved = {}
        for (const [id, position] of Object.entries(positions)) {
          const before = initialPositions.current[id]
          if (!before || before.x !== position.x || before.y !== position.y) moved[id] = { x: position.x, y: position.y }
        }
        setBusy(true); setError('')
        Promise.resolve(post('/workflow-graph', { file, patch: { inputs, positions: moved }, revision })).then(result => {
          if (!result?.ok) throw new Error(result?.error || '保存失败')
          const workflow = result.workflow || raw
          setRaw(workflow); setRevision(String(result.revision || revision)); setDraft({})
          initialPositions.current = JSON.parse(JSON.stringify(positions))
          props?.onSaved?.(workflow)
        }).catch(e => setError('保存失败：' + String(e?.message ?? e))).finally(() => setBusy(false))
      }
      const chosen = nodes[selected]
      const primitiveFields = chosen ? Object.entries(chosen.inputs || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null) : []
      const typeStyle = type => ({ borderLeft: '4px solid ' + nodeColor(type) })
      const button = { background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px' }
      return h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '工作流可视化编辑器', style: { position: 'fixed', inset: 0, zIndex: 2147483200, display: 'flex', flexDirection: 'column', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'system-ui, sans-serif' } },
        h('header', { style: { minHeight: '58px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-specific-input-major)' } },
          h('strong', { style: { fontSize: '15px', flex: 1 } }, '节点工作流 · ' + file.split(/[\\/]/).pop()),
          h('span', { role: 'status', style: { color: isDirty() ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, isDirty() ? '● 有未保存修改' : (raw ? ids.length + ' 节点 · ' + links.length + ' 连线' : '读取中…')),
          h('button', { type: 'button', 'aria-label': '缩小', disabled: busy, style: button, onClick: () => changeZoom(-0.15) }, '−'),
          h('button', { type: 'button', 'aria-label': '放大', disabled: busy, style: button, onClick: () => changeZoom(0.15) }, '+'),
          h('button', { type: 'button', 'aria-label': '适配画布', disabled: busy, style: button, onClick: fitView }, '适配'),
          h('button', { type: 'button', 'aria-label': '重置视图', disabled: busy, style: button, onClick: resetView }, '重置'),
          h('button', { type: 'button', 'aria-label': '保存工作流图', disabled: !raw || !isDirty() || busy, style: Object.assign({}, button, { background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)', borderColor: 'var(--dsw-alias-state-success-primary)', opacity: !raw || !isDirty() || busy ? 0.55 : 1 }), onClick: save }, busy ? '保存中…' : '保存'),
          h('button', { type: 'button', 'aria-label': '关闭工作流图', disabled: busy, style: Object.assign({}, button, { borderColor: 'var(--dsw-alias-state-error-primary)', opacity: busy ? 0.55 : 1 }), onClick: close }, '关闭 ×'),
        ),
          h('div', { style: { minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 28vw)' } },
          h('div', { ref: canvasRef, role: 'application', 'aria-label': '工作流节点画布', onMouseDown: event => { if (!busy) beginPan(event) }, onMouseMove: movePointer, onMouseUp: () => setDrag(null), onMouseLeave: () => setDrag(null), onWheel: event => { event.preventDefault?.(); if (!busy) changeZoom(event.deltaY < 0 ? 0.08 : -0.08) }, style: { position: 'relative', overflow: 'hidden', cursor: drag?.kind === 'pan' ? 'grabbing' : 'grab', backgroundColor: 'var(--dsw-specific-input-major)', backgroundImage: 'radial-gradient(var(--dsw-specific-input-major) 1px, transparent 1px)', backgroundSize: '22px 22px' } },
            error ? h('div', { role: 'alert', style: { position: 'absolute', zIndex: 4, top: '12px', left: '12px', color: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-specific-input-major)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '8px 12px', fontSize: '12px' } }, error) : null,
            raw ? h('div', { style: { position: 'absolute', left: 0, top: 0, transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')', transformOrigin: '0 0' } },
              h('svg', { 'aria-hidden': 'true', width: 1, height: 1, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' } },
                h('defs', null, h('marker', { id: 'workflow-graph-arrow', markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto', markerUnits: 'strokeWidth' }, h('path', { d: 'M0,0 L0,6 L7,3 z', fill: 'var(--dsw-alias-label-tertiary)' }))),
                links.map((link, index) => {
                  const from = positions[link.source] || { x: 0, y: 0 }, to = positions[link.target] || { x: 0, y: 0 }
                  const x1 = from.x + nodeWidth, y1 = from.y + 56, x2 = to.x, y2 = to.y + 56, curve = Math.max(50, Math.abs(x2 - x1) * 0.45)
                  return h('path', { key: index, d: 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + curve) + ' ' + y1 + ', ' + (x2 - curve) + ' ' + y2 + ', ' + x2 + ' ' + y2, fill: 'none', stroke: 'var(--dsw-alias-label-tertiary)', strokeWidth: 2.2, opacity: 0.9, markerEnd: 'url(#workflow-graph-arrow)' })
                })),
              ids.map((id, index) => {
                const node = nodes[id], position = positions[id] || { x: 0, y: 0 }, classType = node.class_type || '未知节点'
                const primitiveCount = Object.values(node.inputs || {}).filter(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)).length
                return h('div', { key: id, role: 'button', tabIndex: 0, 'aria-label': '节点 ' + id + ' ' + classType, onClick: () => setSelected(id), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); setSelected(id) } }, onMouseDown: event => { if (!busy) beginDrag(event, id) }, onMouseMove: movePointer, onMouseUp: () => setDrag(null), style: { position: 'absolute', left: position.x, top: position.y, width: nodeWidth, boxSizing: 'border-box', border: '1px solid ' + (selected === id ? 'var(--dsw-alias-label-primary)' : nodeColor(classType)), borderRadius: '9px', background: 'var(--dsw-specific-input-major)', boxShadow: selected === id ? '0 0 0 2px color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent), 0 8px 24px #0009' : '0 6px 18px #0008', overflow: 'hidden', cursor: drag?.id === id ? 'grabbing' : 'grab' } },
                  h('div', { style: Object.assign({ padding: '9px 11px', background: 'var(--dsw-specific-input-major)', fontWeight: 650, fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }, typeStyle(classType)) }, h('span', null, classType), h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 } }, '#' + id)),
                  h('div', { style: { padding: '8px 11px', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', lineHeight: '1.5' } }, primitiveCount ? primitiveCount + ' 个可编辑参数' : '参数由连线提供', node._meta?.title ? h('div', { style: { marginTop: '3px', color: 'var(--dsw-alias-label-tertiary)' } }, node._meta.title) : null),
                )
              }),
            ) : h('div', { style: { padding: '24px', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, error || '正在读取工作流…'),
          ),
          h('aside', { style: { overflowY: 'auto', borderLeft: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-specific-input-major)', padding: '16px', color: 'var(--dsw-alias-label-primary)' } },
            h('div', { style: { fontSize: '13px', fontWeight: 700, marginBottom: '12px' } }, chosen ? '节点检查器' : '选择一个节点'),
            chosen ? h('div', null,
              h('div', { style: { padding: '10px', borderRadius: '8px', background: 'var(--dsw-specific-input-major)', borderLeft: '4px solid ' + nodeColor(chosen.class_type), marginBottom: '12px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 650 } }, chosen._meta?.title || chosen.class_type || '未知节点'),
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '4px' } }, '节点 #' + selected + ' · ' + Object.keys(chosen.inputs || {}).length + ' 个输入')),
              h('div', { style: { fontSize: '11px', lineHeight: 1.5, color: 'var(--dsw-alias-state-warning-primary)', background: 'var(--dsw-specific-input-major)', padding: '8px', borderRadius: '7px', marginBottom: '12px' } }, '提示：绑定的正面、负面、种子和尺寸会被生成设置覆盖。'),
              primitiveFields.length ? primitiveFields.map(([field, value]) => h('label', { key: field, style: { display: 'block', margin: '0 0 12px', fontSize: '11px', color: 'var(--dsw-alias-label-primary)' } },
                h('span', { style: { display: 'block', marginBottom: '5px', color: 'var(--dsw-alias-label-secondary)' } }, field + ' · ' + (typeof value === 'boolean' ? '布尔' : typeof value === 'number' ? '数字' : '文本')),
                value === null ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontStyle: 'italic' } }, '空值（只读）') : typeof value === 'boolean'
                  ? h('input', { type: 'checkbox', disabled: busy, 'aria-label': field, checked: draft[selected]?.[field] === undefined ? value : (draft[selected][field] === true || draft[selected][field] === 'true'), onChange: event => setField(selected, field, event.target.checked) })
                  : h(typeof value === 'string' && value.length > 100 ? 'textarea' : 'input', { type: typeof value === 'number' ? 'number' : 'text', disabled: busy, 'aria-label': field, value: inputValue(selected, field, value), onChange: event => setField(selected, field, event.target.value), style: { width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: busy ? 'var(--dsw-specific-input-major)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', minHeight: typeof value === 'string' && value.length > 100 ? '84px' : '34px' } }),
              )) : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, '此节点没有可编辑的普通参数。'),
              h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: '12px', marginTop: '10px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                '已有连线（只读）',
                links.filter(link => link.target === selected || link.source === selected).map((link, i) => h('div', { key: i, style: { marginTop: '6px', color: 'var(--dsw-alias-label-primary)' } }, link.source + ' → ' + link.target + ' · ' + link.field))),
            ) : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: 1.6 } }, '点选画布中的节点查看参数。可拖动节点调整布局，滚轮缩放，拖动画布空白处平移。'),
            error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', marginTop: '12px' } }, error) : null,
          ),
        ),
      )
    }

    /** One local reference per library object; binding is saved with the existing draft. */
    function ReferenceImageEditor({ value = {}, label, onChange }) {
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const epoch = React.useRef(0)
      React.useEffect(() => () => { epoch.current += 1 }, [])
      const image = value.referenceImage
      const imageId = /^[a-f0-9]{64}$/i.test(String(image?.id || '')) ? image.id : ''
      const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '7px', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', fontFamily: 'inherit', fontSize: '12px' }
      async function upload(event) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const request = ++epoch.current
        const mediaType = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[String(file.name).split('.').pop().toLowerCase()]
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) { setBusy(false); setNote('请选择 PNG、JPEG 或 WebP 图片'); return }
        if (!file.size || file.size > 32 * 1024 * 1024) { setBusy(false); setNote('参考图不能为空，且每张不能超过 32 MiB'); return }
        setBusy(true)
        setNote('正在上传参考图…')
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => reject(new Error('无法读取这张图片'))
            reader.readAsDataURL(file)
          })
          if (request !== epoch.current) return
          const result = await jsonFetch(BASE + '/reference-image', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data, mediaType, name: file.name }),
          })
          if (request !== epoch.current) return
          if (!result?.ok || !/^[a-f0-9]{64}$/i.test(String(result.referenceImage?.id || ''))) throw new Error(result?.error || '服务器没有返回有效的参考图')
          onChange({ referenceImage: result.referenceImage })
          setNote('参考图已加入草稿，请保存人物库／服装库')
        } catch (error) {
          if (request === epoch.current) setNote('上传失败：' + (error?.message || error))
        } finally { if (request === epoch.current) setBusy(false) }
      }
      return h('section', { 'aria-label': label + '参考图设置', style: { padding: '10px', margin: '10px 0', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '9px' } },
        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, label + '参考图（每个对象一张）'),
        imageId ? h('img', { src: BASE + '/reference-image?id=' + encodeURIComponent(imageId), alt: label + '参考图', style: { display: 'block', maxWidth: '180px', maxHeight: '160px', objectFit: 'contain', borderRadius: '7px', marginBottom: '7px' } }) : null,
        imageId ? h('div', { style: { fontSize: '11px', overflowWrap: 'anywhere', marginBottom: '6px' } }, image.name || '已上传参考图') : null,
        h('label', { style: { display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } }, busy ? '上传中…' : imageId ? '替换参考图' : '上传参考图',
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': label + '上传参考图', disabled: busy, onChange: upload, style: { maxWidth: '100%' } })),
        imageId || busy ? h('button', { type: 'button', 'aria-label': label + '移除参考图', style: { marginLeft: '8px', fontSize: '12px' }, onClick: () => {
          epoch.current += 1
          setBusy(false)
          onChange({ referenceImage: null })
          setNote('已从草稿解绑，保存后生效；历史参考图不会删除')
        } }, '移除') : null,
        h('label', { style: { display: 'block', fontSize: '12px', marginTop: '8px' } }, '一致性补充（可选）',
          h('textarea', { 'aria-label': label + '一致性补充', value: value.consistencyText || '', rows: 2, placeholder: '补充需要保持的特征；动作、背景及正文明确的变化仍以剧情为准', style: inputStyle, onChange: event => onChange({ consistencyText: event.target.value }) })),
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '5px' } }, '参考图仅本机保存，不随导出迁移。上传和移除后请保存人物库／服装库。'),
        note ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '5px', overflowWrap: 'anywhere' } }, note) : null)
    }

    function WorldbookUpgradePanel({ book, request, onApplied }) {
      const [status, setStatus] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const live = React.useRef(true), running = React.useRef(false)
      React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])
      const selectable = entry => ['update', 'customized', 'missing'].includes(entry.state)
      const labels = { current: '已是新版', update: '旧版默认，可更新', customized: '已自定义，更新会替换内容', missing: '当前不存在，勾选后重新加入', disabled: '已禁用，保持不变', ambiguous: '条目有歧义，请手动处理' }
      async function load(apply = false) {
        if (running.current || (apply && (!status || !selected.length))) return
        if (apply && !confirm('只更新勾选条目；其中自定义内容将被新版替换，缺失条目将重新加入。确认继续？')) return
        running.current = true; setBusy(true); setNote('')
        try {
          const result = await request(apply ? '/worldbook-upgrade' : '/worldbook-upgrade?book=' + encodeURIComponent(book),
            apply ? { book, expectedFingerprint: status.fingerprint, entryIds: selected } : undefined)
          if (!result?.ok || result.upgrade?.format !== 'structured' || result.upgrade?.key !== book || !Array.isArray(result.upgrade?.entries) || typeof result.upgrade?.fingerprint !== 'string') throw new Error(result?.error || '未收到有效升级预览')
          if (!live.current) return
          setStatus(result.upgrade); setSelected([])
          setNote(apply ? '所选规则已更新；其他条目保持不变。' : '请展开对比并勾选需要更新的条目；默认不选择任何条目。')
          if (apply) {
            try { await onApplied() } catch { if (live.current) setNote('规则已更新，但列表刷新失败；请手动刷新世界书。') }
          }
        } catch (error) { if (live.current) { setNote('未完成：' + (error?.message || error) + '。请重新读取预览后再试。'); setSelected([]); setStatus(null) } }
        finally { running.current = false; if (live.current) setBusy(false) }
      }
      return h('details', { 'aria-label': '结构化默认规则升级', style: { margin: '12px 0', padding: '8px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px' } },
        h('summary', { style: { cursor: 'pointer' } }, '检查结构化默认规则更新（保留用户选择）'),
        h('p', { style: { fontSize: '12px' } }, '先保存当前编辑并读取差异，再显式选择要更新的条目。禁用条目不启用；删除过的条目不会自动恢复。'),
        h('button', { type: 'button', disabled: busy, onClick: () => load() }, busy ? '处理中…' : '读取／刷新升级预览'),
        status ? h('div', null,
          status.entries.map(entry => h('details', { key: entry.id, style: { marginTop: '8px' } },
            h('summary', null, (entry.proposed?.comment || entry.current?.comment || '未命名条目') + ' · ' + (labels[entry.state] || '未知状态')),
            h('label', null, h('input', { type: 'checkbox', 'aria-label': '更新规则 ' + entry.id, disabled: busy || !selectable(entry), checked: selected.includes(entry.id), onChange: event => setSelected(old => event.target.checked ? [...new Set([...old, entry.id])] : old.filter(id => id !== entry.id)) }), '应用此条新版规则'),
            h('div', null, '当前内容'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '180px', overflowY: 'auto' } }, entry.current?.content ?? '（当前不存在）'),
            h('div', null, '新版内容'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '180px', overflowY: 'auto' } }, entry.proposed?.content ?? '（没有新版内容）'))),
          h('button', { type: 'button', disabled: busy || !selected.length, onClick: () => load(true) }, '确认更新所选 ' + selected.length + ' 条')) : null,
        note ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '8px' } }, note) : null)
    }

    function SettingsPanel() {
      const [data, setDataState] = React.useState(null)
      // 让定时器/异步回调读到"最新的" data，而不用把它写进 effect 依赖
      const dataRef = React.useRef(null)
      dataRef.current = data
      const libraryDirty = React.useRef(false)
      const libraryRevision = React.useRef(0)
      const librarySaveQueue = React.useRef(Promise.resolve())
      const configSaveQueue = React.useRef(Promise.resolve())
      function setData(update) {
        const next = typeof update === 'function' ? update(dataRef.current) : update
        dataRef.current = next
        setDataState(next)
      }
      function receiveState(next, requestRevision) {
        if (!next) return
        const current = dataRef.current
        setData((libraryDirty.current || (typeof requestRevision === 'number' && requestRevision !== libraryRevision.current)) && current
          ? Object.assign({}, next, { definitions: current.definitions, outfits: current.outfits })
          : next)
      }
      function setLibraryData(update) {
        libraryDirty.current = true
        libraryRevision.current += 1
        setData(update)
        setSaveState('')
      }
      const [tab, setTab] = React.useState('plan')
      const promptFormatFocus = React.useRef(false)
      const [updateOpen, setUpdateOpen] = React.useState(false)
      const [pluginUpdateLocal, setPluginUpdateLocal] = React.useState(null)
      const [pluginUpdateCheck, setPluginUpdateCheck] = React.useState(null)
      const [pluginUpdateNote, setPluginUpdateNote] = React.useState('')
      const [pluginUpdatePending, setPluginUpdatePending] = React.useState('')
      const pluginUpdateLocalAttempted = React.useRef(false)
      const pluginUpdateLocalInFlight = React.useRef(false)
      const pluginUpdatePendingRef = React.useRef('')
      const pluginUpdateView = React.useRef(0)
      const pluginUpdateTabRef = React.useRef(updateOpen)
      const pluginUpdateMounted = React.useRef(true)
      pluginUpdateTabRef.current = updateOpen
      const [note, setNote] = React.useState('')
      // 正文图片显示大小：输入过程只改草稿（绝不边输边发请求），点「保存」才发一次 /config。
      // null = 跟随已保存的配置；保存成功后回到 null，输入框显示服务端确认过的值。
      const [displayWidthDraft, setDisplayWidthDraft] = React.useState(null)
      const [displayWidthNote, setDisplayWidthNote] = React.useState('')
      // 宽度预览用的样例图：最近一张出好的插图。抓不到就退回示意图。
      const [widthSampleJob, setWidthSampleJob] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        jsonFetch(BASE + '/history').then(r => {
          if (!alive) return
          const jobs = Array.isArray(r && r.jobs) ? r.jobs : []
          const hit = jobs.find(j => j && j.hasImage && ['done', 'ready'].includes(String(j.state)))
          if (hit) setWidthSampleJob({ id: String(hit.id), title: String(hit.tag || hit.label || '插图') })
        }).catch(() => {})
        return () => { alive = false }
      }, [])
      const [planText, setPlanText] = React.useState('')
      const [planRows, setPlanRows] = React.useState(null)
      // 哪一行正在展开"选择绑定卡片"（-1 = 都没展开）；内联展开，不用浮层
      const [cardPickerFor, setCardPickerFor] = React.useState(-1)
      const [cardList, setCardList] = React.useState([])
      const [peopleSearch, setPeopleSearch] = React.useState('')
      const [peopleActiveId, setPeopleActiveId] = React.useState('')
      const [peopleEditorOpen, setPeopleEditorOpen] = React.useState(true)
      const [peoplePicked, setPeoplePicked] = React.useState({})
      // 从卡导入：卡列表 + 当前选中的卡
      const [importCards, setImportCards] = React.useState([])
      const [importCard, setImportCard] = React.useState('')
      // 正在玩的卡（cards/x.json）；人物库默认只看这张卡
      const [currentCardPath, setCurrentCardPath] = React.useState('')
      // 人物库按卡筛选：'' = 跟随当前卡，'all' = 全部，'__unbound' = 只看未绑定，否则是卡路径
      const [peopleCardFilter, setPeopleCardFilter] = React.useState('')
      // 导入预览：{ card, cardName, items: [{ action, person, pick }] }
      const [importPreview, setImportPreview] = React.useState(null)
      const [peopleOverviewOpen, setPeopleOverviewOpen] = React.useState(false)
      const [peopleTidyOpen, setPeopleTidyOpen] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const r = await post('/cards', { sessionId: String(lastSessionId || '') })
            if (!alive) return
            const list = (r?.cards || []).map(item => ({
              path: item.path,
              label: item.title || item.name,
            }))
            setImportCards(list)
            const current = typeof r?.current === 'string' && list.some(item => item.path === r.current) ? r.current : ''
            setCurrentCardPath(current)
            setImportCard(existing => existing || current || (list[0]?.path ?? ''))
          } catch {}
        })()
        return () => { alive = false }
      }, [])
      const [peopleBatchOpen, setPeopleBatchOpen] = React.useState(false)
      const [peopleBatchField, setPeopleBatchField] = React.useState('feature')
      const [peopleBatchMode, setPeopleBatchMode] = React.useState('replace')
      const [peopleBatchValue, setPeopleBatchValue] = React.useState('')
      const [peopleBatchCards, setPeopleBatchCards] = React.useState([])
      const [peopleBatchNote, setPeopleBatchNote] = React.useState('')
      // 设计角色：内联展开（不用浮层，设置面板层级更高会挡住）
      const [designOpen, setDesignOpen] = React.useState(false)
      const [designBrief, setDesignBrief] = React.useState('')
      const [designPhoto, setDesignPhoto] = React.useState('')
      const [designPreview, setDesignPreview] = React.useState('')
      const [designName, setDesignName] = React.useState('')
      const [designNote, setDesignNote] = React.useState('')
      const [designBusy, setDesignBusy] = React.useState(false)
      const [designPanelBusy, setDesignPanelBusy] = React.useState(false)
      const designInFlight = React.useRef(false)
      // 改进模式：记录角色 id（空 = 新建），不受删除、排序影响。
      const [improveTarget, setImproveTarget] = React.useState('')
      // 设计完成后的醒目提醒（未保存）
      const [designDone, setDesignDone] = React.useState('')
      // 用稳定 id 保存改进草稿；删除前面的角色不会让草稿移到另一位身上。
      const [improveDraft, setImproveDraft] = React.useState({})
      // 从别的角色复制服装：{ target: 目标角色 id, source: 来源角色 id, picked: 选中的服装 id }
      const [outfitCopy, setOutfitCopy] = React.useState({ target: '', source: '', picked: [] })
      // 通用服装库当前选中哪一套（只编辑这一套，不再全部铺开）
      const [libraryActive, setLibraryActive] = React.useState('')
      // 角色服装：每个角色记住当前编辑的是哪一套（角色 id → 服装 id）
      const [outfitPick, setOutfitPick] = React.useState({})
      // 正在跑的改进任务（按角色 id 去重，不妨碍连续生成别的）
      const improveInFlight = React.useRef({})
      // 保存状态：'' 空闲 / 'saving' / 'saved' / 'failed:原因'
      const [saveState, setSaveState] = React.useState('')
      // 历史图库
      const [historyJobs, setHistoryJobs] = React.useState([])
      const [legacyImages, setLegacyImages] = React.useState([])
      const [legacyViewer, setLegacyViewer] = React.useState(null)
      const [gameNames, setGameNames] = React.useState({})
      const [historyNote, setHistoryNote] = React.useState('')
      // 历史图的重载信号：切 tab 与点「刷新」都靠它真正重跑一次拉取。
      // 原来「刷新」是 setTab('plan') + setTimeout(setTab('gallery'))，依赖 [tab] 时
      // 在 React 批处理下常常不产生两次真实变化，effect 不重跑 —— 界面就一直停在
      // 上次失败的「读不到: Failed to fetch」，点多少次刷新都不会更新。
      const [historyTick, setHistoryTick] = React.useState(0)
      // 历史图：批量选择模式
      const [gallerySelect, setGallerySelect] = React.useState(false)
      const [galleryPicked, setGalleryPicked] = React.useState({})
      // 世界书：正在编辑的条目（-1 = 没在编辑）/ 导入面板 / 粘贴内容
      const [wbEditing, setWbEditing] = React.useState(-1)
      // 世界书分两本（生图规则 / 角色与服装库），编辑必须落在选中的那一本上
      const [wbBook, setWbBook] = React.useState('main')
      // 条目默认折叠：只显示标题行，点标题展开只读预览，点「编辑」才进编辑态
      const [wbOpen, setWbOpen] = React.useState({})
      const [wbImportOpen, setWbImportOpen] = React.useState(false)
      const [wbPaste, setWbPaste] = React.useState('')
      const [wbNote, setWbNote] = React.useState('')
      const [wbDrafts, setWbDrafts] = React.useState({})
      const [wbFormat, setWbFormat] = React.useState('')
      const [wbView, setWbView] = React.useState(null)
      const [wbLoading, setWbLoading] = React.useState(false)
      const wbTransition = React.useRef(false)
      const wbReadEpoch = React.useRef(0)
      const wbScope = React.useRef('')
      const wbFlushing = React.useRef(null)
      const wbActions = React.useRef(new Set())
      React.useEffect(() => {
        const effective = data?.worldbookFormat || data?.config?.promptEffectiveFormat
        if (tab === 'worldbook' && ['tags', 'natural', 'mixed', 'structured'].includes(effective)) setWbFormat(current => current || effective)
      }, [tab, data?.worldbookFormat, data?.config?.promptEffectiveFormat])
      // 工作流：展开哪张 / 它的详情 / 导入面板 / ComfyUI 已装的 LoRA
      const [wfOpen, setWfOpen] = React.useState('')
      const [wfGraphFile, setWfGraphFile] = React.useState('')
      const [wfDetail, setWfDetail] = React.useState(null)
      const [wfImportOpen, setWfImportOpen] = React.useState(false)
      const [wfPaste, setWfPaste] = React.useState('')
      const [wfNote, setWfNote] = React.useState('')
      const [loraList, setLoraList] = React.useState([])
      // 可选的 provider / model（从 DSH 的 llm 服务拉）
      const [llmProviders, setLlmProviders] = React.useState([])
      const [llmModels, setLlmModels] = React.useState({})     // provider → [{id,name,vision}]
      const [llmReasoning, setLlmReasoning] = React.useState({}) // provider/model → {efforts,defaultEffort}
      const [llmNote, setLlmNote] = React.useState('')
      const [comfyStatus, setComfyStatus] = React.useState(null)
      // API secrets stay in local input drafts; /state returns only hasApiKey/hasPassword flags.
      const [channelSecretDrafts, setChannelSecretDrafts] = React.useState({})
      // ComfyUI credentials follow the same rule: state exposes only presence flags.
      const [comfySecretDrafts, setComfySecretDrafts] = React.useState({ token: '', pass: '' })
      const [channelTestStatuses, setChannelTestStatuses] = React.useState({})
      const channelDraftRevisions = React.useRef({})
      const [wfTestNote, setWfTestNote] = React.useState('')
      const [wfTestJob, setWfTestJob] = React.useState('')
      const [wfNoop, setWfNoop] = React.useState(false)
      // 简单编辑：这张工作流的参数值（打开详情时读一次）
      const [wfValues, setWfValues] = React.useState(null)
      // 世界书编辑防抖：别每敲一个字就写一次盘（会和上一次写入撞车，报 EPERM）
      const wbTimer = React.useRef(null)
      const wbPending = React.useRef({})
      const wbWriteQueue = React.useRef(Promise.resolve())
      const wbDraftRevisions = React.useRef({})

      // 防重入：上一轮 /state 还没回来就不再发（慢网络下会堆请求）
      const refreshInFlight = React.useRef(false)
      function refresh() {
        if (refreshInFlight.current) return Promise.resolve()
        refreshInFlight.current = true
        const revision = libraryRevision.current
        return jsonFetch(BASE + '/state').then(next => receiveState(next, revision)).catch(e => {
          setNote('读不到状态：' + (e && e.message ? e.message : e))
          reportHost('state-fail', { msg: String(e?.message ?? e), base: BASE })
        }).finally(() => { refreshInFlight.current = false })
      }
      React.useEffect(() => { refresh() }, [])
      React.useEffect(() => { loadProviders() }, [])
      React.useEffect(() => {
        const current = data?.config
        if (!current) return
        void loadReasoning(current.plannerProvider, current.plannerModel)
        void loadReasoning(current.visionProvider, current.visionModel)
      }, [data?.config?.plannerProvider, data?.config?.plannerModel, data?.config?.visionProvider, data?.config?.visionModel])
      // 等 /state 到位再测 ComfyUI：那时才拿得到 comfyUrl，也避开首次渲染的 config TDZ
      React.useEffect(() => { if (data?.config?.imageBackend === 'comfyui') loadComfyStatus() }, [data?.config?.imageBackend])
      const channelTestsInFlight = React.useRef({})
      React.useEffect(() => {
        const view = ++pluginUpdateView.current
        if (updateOpen && !pluginUpdateLocalAttempted.current) {
          pluginUpdateLocalAttempted.current = true
          void loadPluginUpdateLocal()
        }
        return () => {
          if (pluginUpdateView.current === view) pluginUpdateView.current += 1
        }
      }, [updateOpen])
      React.useEffect(() => {
        pluginUpdateMounted.current = true
        return () => { pluginUpdateMounted.current = false; pluginUpdateView.current += 1 }
      }, [])
      // 任务轮询：依赖写成 [] 并在内部读最新数据（原来依赖 data，
      // 每轮 refresh 都会让 effect 重建，慢的时候会叠起一堆请求）
      React.useEffect(() => {
        const timer = setInterval(() => {
          const tasks = (dataRef.current?.tasks || [])
          if (tasks.some(t => t.state === 'running')) refresh()
        }, 3000)
        return () => clearInterval(timer)
      }, [])
      // 画廊也列出 Tavern 原生生图画过的旧图（tavernUi 第 4 版起提供，只读）。
      React.useEffect(() => {
        if (tab !== 'gallery' || typeof tavernUiService?.listIllustrations !== 'function') return undefined
        let alive = true
        tavernUiService.listIllustrations().then(items => { if (alive) setLegacyImages(Array.isArray(items) ? items : []) }, () => { if (alive) setLegacyImages([]) })
        return () => { alive = false }
      }, [tab, historyTick])
      // 画廊按局分组：用 tavernUi.getGames 查各局名称。
      const galleryGameIds = tab === 'gallery' ? [...new Set(historyJobs.map(job => job.gameId).concat(legacyImages.map(item => item.gameId)).filter(Boolean))].sort().join(',') : ''
      React.useEffect(() => {
        if (!galleryGameIds || typeof tavernUiService?.getGames !== 'function') return undefined
        let alive = true
        tavernUiService.getGames(galleryGameIds.split(',')).then(games => { if (alive) setGameNames(games || {}) }, () => {})
        return () => { alive = false }
      }, [galleryGameIds])
      React.useEffect(() => {
        if (tab !== 'gallery') return undefined
        let alive = true
        setHistoryNote('读取中…')
        jsonFetch(BASE + '/history', { cache: 'no-store' }).then(r => {
          if (!alive) return
          const list = r?.jobs ?? []
          setHistoryJobs(list)
          setHistoryNote(list.length ? '' : '还没有生成过图片')
          reportHost('history-ok', { jobs: list.length })
        }).catch(error => {
          if (!alive) return
          setHistoryNote('读不到：' + (error?.message ?? error))
          reportHost('history-fail', {
            name: String(error?.name ?? ''),
            msg: String(error?.message ?? error),
            stack: String(error?.stack ?? '').slice(0, 400),
            url: BASE + '/history',
          })
        })
        return () => { alive = false }
      }, [tab, historyTick])

      function post(pathname, body) {
        return jsonFetch(BASE + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      }
      function mergePluginUpdateLocalStatus(status) {
        setPluginUpdateLocal(current => {
          const next = Object.assign({}, current, {
            currentVersion: status?.currentVersion ?? current?.currentVersion,
            restartRequired: status?.restartRequired ?? current?.restartRequired,
            directoryMigrationRequired: status?.directoryMigrationRequired ?? current?.directoryMigrationRequired,
            directoryMigrationMessage: status?.directoryMigrationMessage ?? current?.directoryMigrationMessage,
          })
          if (typeof status?.supported === 'boolean') {
            next.supported = status.supported
            next.reason = status.reason || ''
          } else if (status?.reason) next.reason = status.reason
          return next
        })
      }
      async function loadPluginUpdateLocal() {
        if (pluginUpdatePendingRef.current || pluginUpdateLocalInFlight.current) return
        pluginUpdateLocalInFlight.current = true
        pluginUpdatePendingRef.current = 'local'
        setPluginUpdatePending('local')
        setPluginUpdateNote('读取本地插件状态…')
        const view = pluginUpdateView.current
        try {
          const status = await jsonFetch(BASE + '/plugin-update')
          if (view !== pluginUpdateView.current || !pluginUpdateTabRef.current) return
          setPluginUpdateLocal(status)
          setPluginUpdateNote(status?.supported === false
            ? (status.reason || '当前安装方式暂不支持自动更新。')
            : status?.restartRequired
              ? '插件需要完整重启 DSH 后生效。'
              : status?.directoryMigrationRequired ? status.directoryMigrationMessage : '')
        } catch (error) {
          if (view !== pluginUpdateView.current || !pluginUpdateTabRef.current) return
          setPluginUpdateNote('读取本地插件状态失败：' + (error?.message ?? error))
        } finally {
          pluginUpdateLocalInFlight.current = false
          if (pluginUpdatePendingRef.current === 'local') {
            pluginUpdatePendingRef.current = ''
            if (pluginUpdateMounted.current) setPluginUpdatePending('')
          }
        }
      }
      async function checkPluginUpdate() {
        if (pluginUpdatePendingRef.current || !(pluginUpdateLocal?.mode === 'release' || pluginUpdateLocal?.supported === true) || pluginUpdateLocal?.compatibility?.compatible === false) return
        pluginUpdatePendingRef.current = 'check'
        setPluginUpdatePending('check')
        setPluginUpdateNote('正在检查插件更新…')
        const view = pluginUpdateView.current
        try {
          const status = await post('/plugin-update/check', {})
          if (view !== pluginUpdateView.current || !pluginUpdateTabRef.current) return
          setPluginUpdateCheck(status)
          mergePluginUpdateLocalStatus(status)
          const supported = status?.supported ?? pluginUpdateLocal?.supported
          const reason = status?.reason ?? (status?.supported === false ? '' : pluginUpdateLocal?.reason)
          setPluginUpdateNote(supported === false
            ? (reason || '当前安装方式暂不支持自动更新。')
            : status?.restartRequired
              ? (status.message && status.message.includes('完整重启 DSH') ? status.message : [status.message, '插件已更新，需要完整重启 DSH 才会生效。'].filter(Boolean).join(' '))
              : status?.directoryMigrationRequired
                ? [status?.available ? '发现可用更新。' : '', status.directoryMigrationMessage].filter(Boolean).join(' ')
                : reason
                  ? reason
                  : status?.available
                    ? (status?.canUpdate ? '发现可用更新。' : (status?.reason || '发现新版本，但当前无法自动更新。'))
                    : '当前已是最新版本。')
        } catch (error) {
          if (view !== pluginUpdateView.current || !pluginUpdateTabRef.current) return
          setPluginUpdateNote('检查更新失败：' + (error?.message ?? error))
        } finally {
          if (pluginUpdatePendingRef.current === 'check') {
            pluginUpdatePendingRef.current = ''
            if (pluginUpdateMounted.current) setPluginUpdatePending('')
          }
        }
      }
      async function applyPluginUpdate() {
        if (pluginUpdatePendingRef.current || (!(pluginUpdateLocal?.mode === 'release' || pluginUpdateLocal?.supported) ) || !pluginUpdateCheck?.available || !pluginUpdateCheck?.canUpdate || pluginUpdateCheck?.restartRequired || pluginUpdateLocal?.restartRequired) return
        if (libraryDirty.current) {
          setPluginUpdateNote('请先保存人物库，再更新插件。')
          return
        }
        pluginUpdatePendingRef.current = 'apply'
        setPluginUpdatePending('apply')
        setPluginUpdateNote('正在更新插件…')
        const view = pluginUpdateView.current
        try {
          const status = await post('/plugin-update/apply', { target: pluginUpdateCheck.target })
          if (!pluginUpdateMounted.current) return
          const completedStatus = Object.assign({}, status, { restartRequired: true })
          setPluginUpdateCheck(completedStatus)
          mergePluginUpdateLocalStatus(completedStatus)
          setPluginUpdateNote(status?.message && status.message.includes('完整重启 DSH')
            ? status.message
            : [status?.message, '插件更新完成，请完整重启 DSH 后生效。'].filter(Boolean).join(' '))
        } catch (error) {
          if (view !== pluginUpdateView.current || !pluginUpdateTabRef.current) return
          setPluginUpdateNote('更新插件失败：' + (error?.message ?? error))
        } finally {
          if (pluginUpdatePendingRef.current === 'apply') {
            pluginUpdatePendingRef.current = ''
            if (pluginUpdateMounted.current) setPluginUpdatePending('')
          }
        }
      }
      async function save(patch) {
        const operation = configSaveQueue.current.catch(() => {}).then(async () => {
          setNote('保存中…')
          const revision = libraryRevision.current
          try {
            const r = await post('/config', { config: patch })
            receiveState(r.state, revision)
            try { window.dispatchEvent(new CustomEvent('dsh-tavern-image:config', { detail: { imageEnabled: r.state?.config?.imageEnabled } })) } catch {}
            setNote('已保存')
            return r
          } catch (e) { setNote('保存失败：' + (e && e.message ? e.message : e)); return null }
        })
        configSaveQueue.current = operation.catch(() => {})
        return operation
      }

      /**
       * 保存「正文图片显示大小」。草稿是输入框里的原始文本：留空 = 恢复默认（0），
       * 超出范围按 160–1200 收窄后再提交，非法输入在前端就被挡住。
       * 保存成功后立刻作用于本会话的正文插图（不用等刷新）；失败时保留草稿，方便重试。
       */
      async function saveDisplayWidth(override) {
        const value = normalizeImageWidth(override === undefined ? displayWidthDraft : override)
        setDisplayWidthNote('保存中…')
        const saved = await save({ imageDisplayWidth: value })
        if (!saved) { setDisplayWidthNote('保存失败，请重试'); return }
        applyImageWidth(value)
        setDisplayWidthDraft(null)
        setDisplayWidthNote(value ? ('已保存：正文插图统一按 ' + value + ' px 显示') : '已恢复默认大小')
      }

      if (!data) return h('div', { style: Object.assign({}, S.surface, { padding: '18px', fontSize: '13px' }) }, note || '正在读取…')
      const config = data.config || {}
      const workflows = data.workflows || []
      const effective = config.plannerEffective || {}

      // ---- 当前渠道 ----
      const imageBackend = String(config.imageBackend || 'comfyui')
      const providers = Array.isArray(data.imageProviders) ? data.imageProviders : []
      const selectedChannel = (Array.isArray(config.imageChannels) ? config.imageChannels : []).find(channel => channel.id === config.activeImageChannel && channel.provider === imageBackend)

      // ---- 后台任务（正在跑什么、能不能取消）----
      function taskPanel() {
        const list = data.tasks || []
        const running = list.filter(t => t.state === 'running')
        if (!list.length) return null
        const rows = list.slice(0, 6).map(t => {
          const seconds = Math.round(((t.finishedAt || Date.now()) - t.startedAt) / 1000)
          const label = t.kind + '：' + t.label
          if (t.state === 'running') {
            return h('div', { key: t.id, style: { fontSize: '12px', margin: '3px 0' } },
              h('span', { style: { color: 'var(--dsw-alias-brand-primary)' } }, '● ' + label + '（后台进行中，' + seconds + 's）'),
              h('button', { style: Object.assign({}, buttonStyle, { marginLeft: '8px', padding: '1px 9px', fontSize: '11px' }), onClick: async () => { await post('/cancel', { id: t.id }); refresh() } }, '取消'),
            )
          }
          return h('div', { key: t.id, style: { fontSize: '12px', margin: '3px 0', color: 'var(--dsw-alias-label-tertiary)' } },
            (t.state === 'done' ? '✓ ' : t.state === 'cancelled' ? '⊗ ' : '✗ ') + label + '　' + seconds + 's' + (t.error ? '　' + t.error : ''))
        })
        return h('div', { style: S.card },
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '后台任务' + (running.length ? '（' + running.length + ' 个在跑）' : '')),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '6px' } }, '规划、设计、看图都在后台跑，不占用前台写作；这里能看到进度，卡住可以取消。'),
          rows,
        )
      }

      // ---- 规划页 ----
      /** 生图后端（ComfyUI 地址与鉴权）—— 标签在上、控件全宽。 */
      function ComfyBackendCard() {
        const optStyle = {}
        const providerOptions = (providers.length ? providers : [
          ['novelai', 'NovelAI'], ['openai', 'OpenAI 兼容'], ['gemini', 'Gemini'], ['gemini-chat', 'Gemini Chat'],
          ['grok', 'Grok'], ['seedream', 'Seedream'], ['qwen', 'Qwen'], ['custom', '自定义 API'], ['sdwebui', 'Stable Diffusion WebUI'],
        ].map(([id, label]) => ({ id, label }))).filter(item => item.id !== 'atlascloud')
        const backend = imageBackend
        const channels = Array.isArray(config.imageChannels) ? config.imageChannels : []
        const channel = selectedChannel
        const channelDraft = channel ? (channelSecretDrafts[channel.id] || { apiKey: '', password: '' }) : { apiKey: '', password: '' }
        const localFields = channel ? (channelDraft.fields || channel) : {}
        const full = (extra) => Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }, extra || {})
        const label = (text, hint) => h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '5px' } },
          text, hint ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: '6px' } }, hint) : null)
        const setCfg = (patch) => setData(current => Object.assign({}, current, { config: Object.assign({}, current?.config || {}, patch) }))
        const nextId = (provider) => provider + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
        const defaultChannel = provider => {
          const preset = providerOptions.find(item => item.id === provider) || {}
          return { id: nextId(provider), name: (preset.label || provider) + ' 渠道', provider, baseUrl: preset.baseUrl || '', model: preset.model || '', authMode: 'bearer', username: '', options: provider === 'custom' ? { apiProtocol: 'openai' } : {}, hasApiKey: false, hasPassword: false }
        }
        const persistChannelSelection = (nextChannels, provider, activeId) => {
          setCfg({ imageChannels: nextChannels, imageBackend: provider, activeImageChannel: activeId })
          save({ imageChannels: nextChannels, imageBackend: provider, activeImageChannel: activeId })
        }
        const editChannel = patch => {
          if (!channel) return
          const next = Object.assign({}, localFields, patch)
          setChannelSecretDrafts(current => Object.assign({}, current, { [channel.id]: Object.assign({}, current[channel.id], { fields: next }) }))
          channelDraftRevisions.current[channel.id] = (channelDraftRevisions.current[channel.id] || 0) + 1
          setChannelTestStatuses(current => { const statuses = Object.assign({}, current); delete statuses[channel.id]; return statuses })
        }
        const markSecretEdited = id => {
          channelDraftRevisions.current[id] = (channelDraftRevisions.current[id] || 0) + 1
          setChannelTestStatuses(current => { const statuses = Object.assign({}, current); delete statuses[id]; return statuses })
        }
        const updateOption = (key, value) => editChannel({ options: Object.assign({}, localFields.options || {}, { [key]: value }) })
        const field = (fieldName, caption, placeholder, type = 'text') => h('div', { style: { marginBottom: '10px' } },
          label(caption), h('input', { 'aria-label': caption, type, value: String(localFields[fieldName] ?? ''), placeholder: placeholder || '', style: full(), onChange: e => editChannel({ [fieldName]: e.target.value }) }))
        const optionField = (key, caption, placeholder, type = 'text') => h('div', { style: { marginBottom: '10px' } },
          label(caption), h('input', { 'aria-label': caption, type, value: String((localFields.options || {})[key] ?? ''), placeholder: placeholder || '', style: full(), onChange: e => updateOption(key, type === 'number' ? Number(e.target.value) : e.target.value) }))
        // NovelAI 常用模型 / 采样器 / 噪点表（下拉候选；不在表里的旧值会作为「当前值」保留）
        const NAI_MODEL_OPTIONS = [
          ['nai-diffusion-5-full', 'V5 Full'],
          ['nai-diffusion-5-curated', 'V5 Curated'],
          ['nai-diffusion-4-5-full', 'V4.5 Full（默认）'],
          ['nai-diffusion-4-5-curated', 'V4.5 Curated'],
          ['nai-diffusion-4-5-full-inpainting', 'V4.5 Full · 重绘'],
          ['nai-diffusion-4-5-curated-inpainting', 'V4.5 Curated · 重绘'],
          ['nai-diffusion-4-full', 'V4 Full'],
          ['nai-diffusion-4-curated-preview', 'V4 Curated'],
          ['nai-diffusion-4-full-inpainting', 'V4 Full · 重绘'],
          ['nai-diffusion-4-curated-inpainting', 'V4 Curated · 重绘'],
          ['nai-diffusion-3-full', 'V3 Full'],
          ['nai-diffusion-3-curated', 'V3 Curated'],
          ['nai-diffusion-3', 'V3 Anime'],
          ['nai-diffusion-3-inpainting', 'V3 · 重绘'],
          ['nai-diffusion-furry-3', 'V3 Furry'],
          ['nai-diffusion-furry-3-inpainting', 'V3 Furry · 重绘'],
        ]
        const NAI_SAMPLER_OPTIONS = [
          ['k_euler_ancestral', 'Euler Ancestral（常用）'],
          ['k_euler', 'Euler'],
          ['k_dpmpp_2m', 'DPM++ 2M'],
          ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
          ['k_dpmpp_sde', 'DPM++ SDE'],
          ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'],
          ['ddim_v3', 'DDIM'],
          ['k_lms', 'LMS（V3 及以前）'],
          ['k_heun', 'Heun（V3 及以前）'],
          ['k_dpm_2', 'DPM2（V3 及以前）'],
          ['k_dpm_2_ancestral', 'DPM2 Ancestral（V3 及以前）'],
        ]
        const NAI_NOISE_OPTIONS = [
          ['karras', 'Karras（常用）'],
          ['native', 'Native'],
          ['exponential', 'Exponential'],
          ['polyexponential', 'Polyexponential'],
        ]
        const storedOption = key => String((localFields.options || {})[key] ?? '')
        const selectOptionField = (key, caption, items, fallback) => {
          const stored = storedOption(key)
          const current = stored || fallback
          const known = items.some(([value]) => value === current)
          const list = known ? items : [[current, current + '（当前值，不在列表里）'], ...items]
          return h('div', { style: { marginBottom: '10px' } }, label(caption),
            h('select', { 'aria-label': caption, value: current, style: full(), onChange: e => updateOption(key, e.target.value) },
              list.map(([value, text]) => h('option', { key: value, value, style: optStyle }, text))))
        }
        // 宽 / 高分开填（NovelAI）：两个都填才覆盖，留空回落到旧的 size 文本或规划给的分辨率
        const legacySize = (() => {
          const m = String((localFields.options || {}).size ?? '').match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i)
          return m ? { width: m[1], height: m[2] } : { width: '', height: '' }
        })()
        const sizeValue = (key, fallback) => {
          const raw = (localFields.options || {})[key]
          const text = raw === undefined || raw === null ? '' : String(raw).trim()
          return text && Number(text) > 0 ? text : String(fallback ?? '')
        }
        const setSizeValue = (key, value) => {
          const next = Object.assign({}, localFields.options || {})
          next.sizeWidth = sizeValue('sizeWidth', legacySize.width)
          next.sizeHeight = sizeValue('sizeHeight', legacySize.height)
          next[key] = String(value)
          editChannel({ options: next })
        }
        const sizeField = (key, caption, placeholder, fallback) => h('div', { style: { marginBottom: '10px' } }, label(caption),
          h('input', { 'aria-label': caption, type: 'number', min: '64', max: '8192', step: '64', value: sizeValue(key, fallback), placeholder, style: full(), onChange: e => setSizeValue(key, e.target.value) }))
        const modelSuggestions = channel ? [...new Set([
          providers.find(item => item.id === backend)?.model,
          ...(channelTestStatuses[channel.id]?.models || []),
        ].filter(Boolean).map(String))] : []
        const modelInput = channel ? h('div', { style: { marginBottom: '10px' } },
          label('模型'), h('input', { 'aria-label': '模型', list: 'image-models-' + channel.id, type: 'text', value: String(localFields.model ?? ''), placeholder: '选择建议模型或填写自定义模型 ID', style: full(), onChange: e => editChannel({ model: e.target.value }) }),
          modelSuggestions.length ? h('datalist', { id: 'image-models-' + channel.id }, modelSuggestions.map(model => h('option', { key: model, value: model }))) : null) : null
        // NovelAI：模型用下拉选，不在候选表里的自定义 ID 仍可手填
        const naiModelField = channel ? (() => {
          const current = String(localFields.model ?? '')
          const known = NAI_MODEL_OPTIONS.some(([value]) => value === current)
          return h('div', { style: { marginBottom: '10px' } },
            label('模型'),
            h('select', { 'aria-label': '模型', value: known ? current : '__custom__', style: full(), onChange: e => editChannel({ model: e.target.value === '__custom__' ? '' : e.target.value }) },
              NAI_MODEL_OPTIONS.map(([value, text]) => h('option', { key: value, value, style: optStyle }, text)),
              h('option', { key: '__custom__', value: '__custom__', style: optStyle }, '自定义 / 未列出的模型 ID…')),
            known ? null : h('input', { 'aria-label': '自定义模型 ID', type: 'text', value: current, placeholder: '填 NovelAI 模型 ID，例如 nai-diffusion-4-5-full；留空 = 用默认 V4.5 Full', style: Object.assign({}, full(), { marginTop: '6px' }), onChange: e => editChannel({ model: e.target.value }) }))
        })() : null
        const apiProtocol = String((localFields.options || {}).apiProtocol || 'openai').toLowerCase()
        const protocolBackend = backend === 'custom' ? (apiProtocol === 'nai' ? 'novelai' : apiProtocol) : backend
        const naiChat = protocolBackend === 'novelai' && storedOption('protocol') === 'chat'
        const generatePathPlaceholder = ({ novelai: naiChat ? '/v1/chat/completions' : '/ai/generate-image', openai: '/images/generations', 'gemini-chat': '/chat/completions', grok: '/images/generations', seedream: '/images/generations', qwen: '/services/aigc/multimodal-generation/generation', atlascloud: '/model/generateImage', sdwebui: '/sdapi/v1/txt2img' })[protocolBackend]
        const authMode = String(config.comfyAuthMode ?? 'none')
        const saveComfy = async () => {
          const patch = {
            comfyUrl: config.comfyUrl || '', comfyAuthMode: authMode,
            comfyAuthUser: config.comfyAuthUser || '',
          }
          if (comfySecretDrafts.token) patch.comfyAuthToken = comfySecretDrafts.token
          if (comfySecretDrafts.pass) patch.comfyAuthPass = comfySecretDrafts.pass
          const saved = await save(patch)
          if (saved) setComfySecretDrafts({ token: '', pass: '' })
          return saved
        }
        // 先分「在线服务 / 本地部署」，再选具体服务商：本地程序要自己开着，在线服务要 Key，填的东西不一样。
        const LOCAL_PROVIDERS = ['comfyui', 'sdwebui']
        const isLocal = LOCAL_PROVIDERS.includes(backend)
        const onlineOptions = providerOptions.filter(item => !LOCAL_PROVIDERS.includes(item.id))
        const localOptions = [{ id: 'comfyui', label: 'ComfyUI' }].concat(providerOptions.filter(item => item.id === 'sdwebui'))
        const chooseProvider = provider => {
          if (provider === 'comfyui') { save({ imageBackend: provider }); setCfg({ imageBackend: provider }); return }
          let selected = channels.find(item => item.provider === provider)
          let next = channels
          if (!selected) { selected = defaultChannel(provider); next = channels.concat(selected) }
          persistChannelSelection(next, provider, selected.id)
        }
        const chooseKind = local => {
          if (local === isLocal) return
          if (local) { chooseProvider('comfyui'); return }
          const used = onlineOptions.find(item => channels.some(channel => channel.provider === item.id))
          if (used || onlineOptions[0]) chooseProvider((used || onlineOptions[0]).id)
        }
        const kindOptions = isLocal ? localOptions : onlineOptions
        return h('div', { style: S.card },
          h('div', { style: Object.assign({}, S.row, { margin: '0 0 12px' }) },
            h('button', { type: 'button', 'aria-pressed': !isLocal, style: S.tab(!isLocal), onClick: () => chooseKind(false) }, '在线服务'),
            h('button', { type: 'button', 'aria-pressed': isLocal, style: S.tab(isLocal), onClick: () => chooseKind(true) }, '本地部署'),
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, isLocal ? '在自己电脑上运行的出图程序，需要先把它开起来' : '填服务商的 API Key 即可，按张计费'),
          ),
          h('div', { style: { marginBottom: '12px' } },
            label(isLocal ? '本地程序' : '服务商'),
            h('select', { 'aria-label': '生图提供商', value: backend, style: full(), onChange: e => chooseProvider(e.target.value) },
              kindOptions.map(item => h('option', { key: item.id, value: item.id, style: optStyle }, item.label)),
            ),
          ),
          backend === 'comfyui' ? h('div', null,
            h('div', { style: { marginBottom: '12px' } },
              label('API 根地址'),
              h('input', { type: 'text', value: config.comfyUrl || '', placeholder: 'http://127.0.0.1:8188', style: full(), onChange: e => setCfg({ comfyUrl: e.target.value }) }),
            ),
            h('div', { style: { marginBottom: '12px' } },
              label('服务鉴权'),
              h('select', { value: authMode, style: full(), onChange: e => { const v = e.target.value; setCfg({ comfyAuthMode: v }); save({ comfyAuthMode: v }) } },
                h('option', { value: 'none', style: optStyle }, '无需鉴权'), h('option', { value: 'bearer', style: optStyle }, 'Bearer Token'), h('option', { value: 'basic', style: optStyle }, 'Basic（用户名 / 密码）')),
            ),
            authMode === 'bearer' ? h('div', { style: { marginBottom: '12px' } },
              label('Token', config.comfyHasAuthToken ? '已保存；留空保留原 Token' : ''),
              h('input', { type: 'password', value: comfySecretDrafts.token, placeholder: config.comfyHasAuthToken ? '已保存，输入新 Token 可替换' : '粘贴 Token', style: full(), onChange: e => setComfySecretDrafts(current => Object.assign({}, current, { token: e.target.value })) }),
              config.comfyHasAuthToken ? h('button', { type: 'button', style: buttonStyle, onClick: async () => {
                const saved = await save({ clearComfyAuthToken: true })
                if (saved) setComfySecretDrafts(current => Object.assign({}, current, { token: '' }))
              } }, '清除已保存 Token') : null) : null,
            authMode === 'basic' ? h('div', { style: { marginBottom: '12px' } },
              label('用户名'), h('input', { type: 'text', value: config.comfyAuthUser || '', style: Object.assign(full(), { marginBottom: '8px' }), onChange: e => setCfg({ comfyAuthUser: e.target.value }) }),
              label('密码', config.comfyHasAuthPass ? '已保存；留空保留原密码' : ''),
              h('input', { type: 'password', value: comfySecretDrafts.pass, placeholder: config.comfyHasAuthPass ? '已保存，输入新密码可替换' : '输入密码', style: full(), onChange: e => setComfySecretDrafts(current => Object.assign({}, current, { pass: e.target.value })) }),
              config.comfyHasAuthPass ? h('button', { type: 'button', style: buttonStyle, onClick: async () => {
                const saved = await save({ clearComfyAuthPass: true })
                if (saved) setComfySecretDrafts(current => Object.assign({}, current, { pass: '' }))
              } }, '清除已保存密码') : null) : null,
            h('button', { style: Object.assign({}, buttonStyle, { fontWeight: 600 }), onClick: async () => {
              const saved = await saveComfy()
              if (!saved) return
              setComfyStatus({ checking: true })
              const r = await post('/comfy-test', { url: saved.state?.config?.comfyUrl || config.comfyUrl || '' }).catch(e => ({ ok: false, error: String(e?.message ?? e) }))
              setComfyStatus(r)
            } }, comfyStatus?.checking ? '测试中…' : '测试连接与鉴权'),
            comfyStatus?.checking ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginLeft: '10px' } }, '正在连接…') : null,
            comfyStatus && !comfyStatus.checking ? h('span', { style: { fontSize: '12px', color: comfyStatus.ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', marginLeft: '10px' } }, comfyStatus.ok ? ('● 在线' + (comfyStatus.version ? ' ' + comfyStatus.version : '') + (comfyStatus.device ? '　' + comfyStatus.device : '') + (comfyStatus.vram ? '　' + comfyStatus.vram : '') + '　✓ ' + (comfyStatus.ms || 0) + 'ms') : ('● 离线：' + String(comfyStatus.error || '未知原因'))) : null,
          ) : channel ? h('div', null,
            h('div', { style: S.row },
              h('select', { 'aria-label': '生图渠道', value: channel.id, style: Object.assign({}, full(), { flex: 1, minWidth: '180px' }), onChange: e => { setCfg({ activeImageChannel: e.target.value }); save({ activeImageChannel: e.target.value }) } },
                channels.filter(item => item.provider === backend).map(item => h('option', { key: item.id, value: item.id, style: optStyle }, item.name))),
              h('button', { style: buttonStyle, onClick: () => { const created = defaultChannel(backend); persistChannelSelection(channels.concat(created), backend, created.id) } }, '新增渠道'),
              h('button', { style: buttonStyle, onClick: () => { const created = Object.assign({}, channel, localFields, { id: nextId(backend), name: localFields.name + ' 副本', hasApiKey: false, hasPassword: false }); delete created.apiKey; delete created.password; persistChannelSelection(channels.concat(created), backend, created.id) } }, '复制渠道'),
              h('button', { style: Object.assign({}, buttonStyle, { color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => {
                if (!confirm('删除渠道「' + channel.name + '」？已保存的密钥也会删除。')) return
                const next = channels.filter(item => item.id !== channel.id)
                const fallback = next.find(item => item.provider === backend)
                if (fallback) persistChannelSelection(next, backend, fallback.id)
                else { setChannelSecretDrafts(current => { const drafts = Object.assign({}, current); delete drafts[channel.id]; return drafts }); persistChannelSelection(next, 'comfyui', '') }
              } }, '删除渠道'),
            ),
            field('name', '渠道名称', '例如：个人 API / 公司中转'),
            field('baseUrl', 'API 根地址', 'https://api.example.com/v1'),
            backend === 'custom' ? selectOptionField('apiProtocol', 'API 协议', [['openai', 'OpenAI 图片 API'], ['atlascloud', 'AtlasCloud'], ['gemini', 'Gemini'], ['gemini-chat', 'Gemini Chat'], ['sdwebui', 'Stable Diffusion WebUI'], ['seedream', 'Seedream'], ['grok', 'Grok'], ['qwen', 'Qwen'], ['novelai', 'NovelAI（NAI）']], 'openai') : null,
            protocolBackend === 'novelai' ? selectOptionField('protocol', '接口格式', [['native', '官方格式（NovelAI 官方或同协议中转）'], ['chat', '对话格式（chat/completions 中转站）']], 'native') : null,
            protocolBackend === 'novelai' ? naiModelField : modelInput,
            h('div', { style: { marginBottom: '10px' } }, label('鉴权方式'), h('select', { 'aria-label': '鉴权方式', value: localFields.authMode || 'bearer', style: full(), onChange: e => editChannel({ authMode: e.target.value }) },
              h('option', { value: 'bearer', style: optStyle }, 'Bearer API Key'), h('option', { value: 'none', style: optStyle }, '无需鉴权'), h('option', { value: 'basic', style: optStyle }, 'Basic 用户名 / 密码'))),
            localFields.authMode === 'basic' ? h('div', null,
              field('username', '用户名', '用户名'),
              h('div', { style: { marginBottom: '10px' } }, label('密码', channel.hasPassword ? '已保存；留空保留原密码' : ''),
                h('input', { 'aria-label': '渠道密码', type: 'password', value: channelDraft.password || '', placeholder: channel.hasPassword ? '已保存，留空可保留' : '输入密码', style: full(), onChange: e => { setChannelSecretDrafts(current => Object.assign({}, current, { [channel.id]: Object.assign({}, current[channel.id], { password: e.target.value, clearPassword: false }) })); markSecretEdited(channel.id) } }),
                channel.hasPassword ? h('button', { style: buttonStyle, onClick: () => { setChannelSecretDrafts(current => Object.assign({}, current, { [channel.id]: Object.assign({}, current[channel.id], { clearPassword: true, password: '' }) })); markSecretEdited(channel.id) } }, '清除已保存密码') : null)) : null,
            localFields.authMode !== 'none' && localFields.authMode !== 'basic' ? h('div', { style: { marginBottom: '10px' } },
              label('API Key', channel.hasApiKey ? '已保存；留空保留原 Key' : ''),
              h('input', { 'aria-label': '渠道 API Key', type: 'password', value: channelDraft.apiKey || '', placeholder: channel.hasApiKey ? '已保存，留空可保留' : '粘贴 API Key', style: full(), onChange: e => { setChannelSecretDrafts(current => Object.assign({}, current, { [channel.id]: Object.assign({}, current[channel.id], { apiKey: e.target.value, clearApiKey: false }) })); markSecretEdited(channel.id) } }),
              channel.hasApiKey ? h('button', { style: buttonStyle, onClick: () => { setChannelSecretDrafts(current => Object.assign({}, current, { [channel.id]: Object.assign({}, current[channel.id], { clearApiKey: true, apiKey: '' }) })); markSecretEdited(channel.id) } }, '清除已保存 Key') : null) : null,
            protocolBackend === 'sdwebui' ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '8px' } },
              optionField('steps', '步数', '20', 'number'), optionField('cfg', 'CFG', '7', 'number'), optionField('sampler', '采样器', 'Euler a')) : null,
            protocolBackend === 'novelai' ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px 12px' } },
              selectOptionField('sampler', '采样器', NAI_SAMPLER_OPTIONS, 'k_euler_ancestral'),
              selectOptionField('noiseSchedule', '噪点表（Noise Schedule）', NAI_NOISE_OPTIONS, 'karras')) : null,
            protocolBackend === 'novelai' ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(128px,1fr))', gap: '10px 12px' } },
              naiChat ? null : optionField('steps', '步数', '28', 'number'),
              optionField('cfg', 'CFG', '5', 'number'),
              h('div', { style: { marginBottom: '10px' } }, label('CFG Rescale'), h('input', { 'aria-label': 'CFG Rescale', type: 'number', step: '0.01', min: '0', max: '1', value: String((localFields.options || {}).cfgRescale ?? 0), placeholder: '0 ~ 1，0 = 关', style: full(), onChange: e => updateOption('cfgRescale', Number(e.target.value)) })),
              naiChat ? null : h('div', { style: { marginBottom: '10px' } }, label('Uncond Scale'), h('input', { 'aria-label': 'Uncond Scale', type: 'number', step: '0.1', min: '0', value: String((localFields.options || {}).uncondScale ?? 0), placeholder: '0 = 不改动', style: full(), onChange: e => updateOption('uncondScale', Number(e.target.value)) })),
              naiChat ? null : h('div', { style: { marginBottom: '10px' } }, label('Skip CFG Sigma'), h('input', { 'aria-label': 'Skip CFG Above Sigma', type: 'number', step: '0.1', min: '0', value: String((localFields.options || {}).skipCfgAboveSigma ?? 0), placeholder: '0 = 不改动，常用 19', style: full(), onChange: e => updateOption('skipCfgAboveSigma', Number(e.target.value)) }))) : null,
            protocolBackend === 'novelai' && !naiChat ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px 12px' } },
              h('div', { style: { marginBottom: '10px' } }, label('官方负面预设（ucPreset）'),
                h('select', { 'aria-label': '官方负面预设', value: String((localFields.options || {}).ucPreset ?? 3), style: full(), onChange: e => updateOption('ucPreset', Number(e.target.value)) },
                  h('option', { value: '0', style: optStyle }, '0 · 强（Heavy）'),
                  h('option', { value: '1', style: optStyle }, '1 · 弱（Light）'),
                  h('option', { value: '2', style: optStyle }, '2 · Furry 侧重'),
                  h('option', { value: '3', style: optStyle }, '3 · Human 侧重（默认）'),
                  h('option', { value: '4', style: optStyle }, '4 · 不指定'))),
              h('div', { style: { marginBottom: '10px' } }, label('官方质量词（qualityToggle）'),
                h('select', { 'aria-label': '官方质量词', value: String((localFields.options || {}).qualityToggle ?? true), style: full(), onChange: e => updateOption('qualityToggle', e.target.value === 'true') },
                  h('option', { value: 'true', style: optStyle }, '开（默认）'),
                  h('option', { value: 'false', style: optStyle }, '关'))),
              h('div', { style: { marginBottom: '10px' } }, label('多样性（variety_boost）'),
                h('select', { 'aria-label': '多样性', value: String((localFields.options || {}).varietyBoost ?? false), style: full(), onChange: e => updateOption('varietyBoost', e.target.value === 'true') },
                  h('option', { value: 'false', style: optStyle }, '关（默认）'),
                  h('option', { value: 'true', style: optStyle }, '开（Variety Boost）')))) : null,
            protocolBackend === 'openai' ? optionField('quality', '质量', 'auto') : null,
            protocolBackend === 'novelai' ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px 12px' } },
              sizeField('sizeWidth', '宽（像素）', '如 832', legacySize.width),
              sizeField('sizeHeight', '高（像素）', '如 1216', legacySize.height),
              (sizeValue('sizeWidth', legacySize.width) && sizeValue('sizeHeight', legacySize.height)) ? null
                : h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px', alignSelf: 'end', paddingBottom: '8px' } }, '宽高都填才覆盖；留空跟随规划给的分辨率')) : null,
            protocolBackend === 'atlascloud' ? h('div', null,
              selectOptionField('sizeMode', '尺寸参数格式', [['size', 'size（宽×高，Flux / Seedream）'], ['aspect_ratio', 'aspect_ratio（比例，Nano Banana）'], ['none', '不发送尺寸参数（使用模型默认值）']], 'size'),
              !storedOption('sizeMode') || storedOption('sizeMode') === 'size' ? optionField('size', '尺寸覆盖（可选）', '例如：1024x1536；留空跟随规划') : null,
              storedOption('sizeMode') === 'aspect_ratio' ? optionField('aspectRatio', '画面比例覆盖（可选）', '例如：2:3；留空跟随规划') : null) : null,
            ['openai', 'sdwebui', 'qwen'].includes(protocolBackend) ? optionField('size', '尺寸覆盖（可选）', '例如：1024x1536') : null,
            protocolBackend === 'seedream' ? optionField('size', '输出尺寸（可选）', '1K、1.5K、2K 或 2048x2048') : null,
            protocolBackend === 'gemini' ? optionField('imageSize', '输出分辨率（可选）', '1K、2K 或 4K') : null,
            ['gemini', 'novelai', 'sdwebui', 'qwen'].includes(protocolBackend) ? optionField('aspectRatio', '画面比例覆盖（可选）', '例如：2:3') : null,
            generatePathPlaceholder ? optionField('generatePath', '生成接口路径（高级）', generatePathPlaceholder) : null,
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '12px' } },
              h('button', { style: Object.assign({}, buttonStyle, { fontWeight: 600 }), disabled: Boolean(channelTestsInFlight.current[channel.id]), onClick: async () => {
                if (channelTestsInFlight.current[channel.id]) return
                channelTestsInFlight.current[channel.id] = true
                const editRevision = channelDraftRevisions.current[channel.id] || 0
                const secrets = channelSecretDrafts[channel.id] || {}
                const payload = Object.assign({}, localFields, { id: channel.id, provider: backend,
                  ...(secrets.apiKey ? { apiKey: secrets.apiKey } : {}), ...(secrets.password ? { password: secrets.password } : {}),
                  ...(secrets.clearApiKey ? { clearApiKey: true } : {}), ...(secrets.clearPassword ? { clearPassword: true } : {}),
                })
                const nextChannels = channels.map(item => item.id === channel.id ? payload : item)
                if (!nextChannels.some(item => item.id === channel.id)) nextChannels.push(payload)
                try {
                  const saved = await save({ imageBackend: backend, activeImageChannel: channel.id, imageChannels: nextChannels })
                  if (!saved) return
                  setChannelSecretDrafts(current => {
                    const latest = current[channel.id] || {}
                    const cleaned = Object.assign({}, latest)
                    if (latest.apiKey === secrets.apiKey) { cleaned.apiKey = ''; delete cleaned.clearApiKey }
                    if (latest.password === secrets.password) { cleaned.password = ''; delete cleaned.clearPassword }
                    return Object.assign({}, current, { [channel.id]: cleaned })
                  })
                  setChannelTestStatuses(current => Object.assign({}, current, { [channel.id]: { checking: true } }))
                  const result = await post('/image-channel-test', { id: channel.id }).catch(error => ({ ok: false, status: 0, message: String(error?.message ?? error) }))
                  if ((channelDraftRevisions.current[channel.id] || 0) === editRevision) setChannelTestStatuses(current => Object.assign({}, current, { [channel.id]: result }))
                  else setChannelTestStatuses(current => { const statuses = Object.assign({}, current); delete statuses[channel.id]; return statuses })
                } finally { delete channelTestsInFlight.current[channel.id] }
              } }, channelTestStatuses[channel.id]?.checking ? '测试中…' : '保存并测试连接'),
              h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', color: channelTestStatuses[channel.id]?.status === 'reachable' && channelTestStatuses[channel.id]?.ok ? 'var(--dsw-alias-state-success-primary)' : channelTestStatuses[channel.id]?.status === 'configured' ? 'var(--dsw-alias-label-tertiary)' : channelTestStatuses[channel.id] ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' } },
                channelTestStatuses[channel.id]?.checking ? '正在探测渠道…' : channelTestStatuses[channel.id]?.status === 'reachable' && channelTestStatuses[channel.id]?.ok ? ('连接可用' + (channelTestStatuses[channel.id].message ? '：' + channelTestStatuses[channel.id].message : '')) : channelTestStatuses[channel.id]?.status === 'configured' ? ('已配置，尚未验证：' + (channelTestStatuses[channel.id].message || '此服务没有可安全探测的接口。')) : channelTestStatuses[channel.id] ? ('无法连接：' + (channelTestStatuses[channel.id].message || channelTestStatuses[channel.id].error || '检查地址与鉴权')) : (channel.hasApiKey || channel.hasPassword ? '已配置，尚未验证' : '填写地址和鉴权后保存并测试')),
            ),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '8px', lineHeight: 1.55 } },
              protocolBackend === 'novelai' ? (naiChat ? '对话格式用于把 NovelAI 包成 chat/completions 的中转站：地址填中转站根地址，模型选 NovelAI 模型，采样器会自动拼进模型名。' : 'NovelAI 使用 API Key，不需要账户 OAuth 登录；密钥可从官方账户获取。') : protocolBackend === 'openai' ? '支持 OpenAI 图片 API 和兼容中转；建议模型 ID 来自服务端模型列表，兼容中转可修改生成路径。' : protocolBackend === 'grok' ? 'Grok 当前由服务端模型决定尺寸和比例；插件不会发送尺寸覆盖参数。' : protocolBackend === 'qwen' ? '百炼 API 根地址必须匹配账号所在地域和控制台提供的工作空间地址；请从平台控制台复制完整区域端点。' : protocolBackend === 'atlascloud' ? 'atlas cloud 使用原生异步接口，不需要安装 MCP。默认 Flux Schnell；更换文生图模型时请按模型文档选择尺寸参数格式和有效尺寸，或使用模型默认值。负面词以 Avoid 描述合入提示词，不发送原生 negative_prompt。测试只读取任务历史和模型目录，不会生成图片。' : '可填写服务商或自建中转的完整 API 根地址；测试只检查连接与模型信息，不会付费生成图片。复制渠道会复制参数，但需要重新填写密钥。'),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' } },
              h('label', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '同时生成', h('input', { 'aria-label': '同时生成', type: 'number', min: 1, max: 4, value: Number(config.imageConcurrency || 2), style: Object.assign({}, S.input, { width: '70px', marginLeft: '8px' }), onChange: e => setCfg({ imageConcurrency: Math.max(1, Math.min(4, Number(e.target.value) || 1)) }) })),
              h('button', { style: buttonStyle, onClick: () => save({ imageConcurrency: Math.max(1, Math.min(4, Number(config.imageConcurrency || 2))) }) }, '保存并发设置'),
              h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, '1–4 个任务；并发提高速度，也会增加服务端额度消耗。'),
            ),
          ) : h('div', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' } }, '此提供商还没有渠道。'),
        )
      }


      /**
       * 正文图片显示大小（全局）：设一个宽度，正文里所有插件插图 —— 已有的和新生成的 ——
       * 都按它显示。只改显示宽度：不重采样原图、不改生成分辨率，点开后的全屏大图也不受影响。
       */
      function imageDisplayCard() {
        const saved = normalizeImageWidth(config.imageDisplayWidth)
        const draftText = displayWidthDraft === null ? (saved ? String(saved) : '') : displayWidthDraft
        // 只收数字（空 = 默认）：数字输入框里手打的内容也走这里，非法值不给保存，
        // 免得把 NaN 发到服务端。
        const valid = /^\s*\d*\s*$/.test(draftText)
        const draftValue = normalizeImageWidth(draftText)
        const busy = displayWidthNote === '保存中…'
        const previewWidth = draftValue || saved || IMAGE_WIDTH_LIMIT.fallback
        // 有没保存的改动 = 正在预览：此时正文插图已经按草稿宽度显示了，只是还没写盘。
        const dirty = displayWidthDraft !== null && draftValue !== saved
        const sampleSrc = widthSampleJob ? BASE + '/jobs?id=' + encodeURIComponent(widthSampleJob.id) + '&image=1' : ''
        /**
         * 宽度对比：每条横条的长度 = 该数值的真实像素（1 : 1），共用同一把刻度尺，超宽横向滚动。
         * 不看图内容，只看长短 —— 这样一眼能看出「你设的宽度」「默认」「正文栏」谁宽谁窄。
         */
        // 只列两个**确定**的值：设置值和默认值。聊天区宽度因面板不同而变，放进来只会让人怀疑数字。
        const compareRows = [
          { key: 'mine', label: '你设的宽度', width: previewWidth, color: 'var(--dsw-alias-brand-primary)', image: sampleSrc },
          { key: 'default', label: '默认', width: IMAGE_WIDTH_LIMIT.fallback, color: 'var(--dsw-alias-label-tertiary)', dashed: true },
        ]
        const rulerBg = 'repeating-linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent) 0 1px, transparent 1px 100px)'
        const compareBar = row => h('div', { key: row.key, style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' } },
          h('div', { style: { flex: '0 0 auto', width: '74px', fontSize: '10px', color: row.color, lineHeight: 1.3 } }, row.label),
          h('div', { style: { position: 'relative', flex: '1 1 auto', height: '42px', overflowX: 'auto', overflowY: 'hidden', borderRadius: '6px', background: 'var(--dsw-specific-input-major)', border: '1px solid var(--dsw-alias-border-l2)', backgroundImage: rulerBg } },
            h('div', {
              title: row.width + ' px',
              style: Object.assign({
                height: '100%', width: row.width + 'px', minWidth: '10px', borderRadius: '5px', overflow: 'hidden',
                transition: 'width .12s ease-out', boxSizing: 'border-box',
              }, row.image
                ? { border: '1px solid ' + row.color }
                : (row.dashed ? { border: '1px dashed ' + row.color, background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent)' } : { border: '1px solid ' + row.color, background: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 14%, transparent)' })),
            },
              row.image ? h('img', { key: 'shot', src: row.image, alt: '插图', loading: 'lazy', decoding: 'async', style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' } }) : null,
            ),
          ),
          h('div', { style: { flex: '0 0 auto', width: '58px', fontSize: '10px', color: row.color, textAlign: 'right' } }, row.width + ' px'),
        )
        return h('div', { style: S.card },
          h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '正文图片显示大小'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.6 } },
            '正文里所有插件插图（已存在的和新生成的）统一按这个宽度显示，高度按原比例，窄屏不会溢出。',
            '只改显示大小：不重采样原图、不改生成分辨率，点开后的全屏大图也不受影响。',
            '拖动滑块时，正文里的插图会立刻跟着变 —— 看准了再保存。'),
          h('div', { style: { marginTop: '10px' } },
            compareRows.map(compareBar),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '7px', lineHeight: 1.6 } },
              '最大只到铺满屏幕，再大也不会超出；实际显示多宽以正文为准 —— 双击插图，控制条会给出「设定 X px · 实际 Y px」。'),
          ),
          h('div', { style: Object.assign({}, S.row, { marginTop: '10px' }) },
            h('input', {
              'aria-label': '正文图片显示宽度', type: 'range',
              min: String(IMAGE_WIDTH_LIMIT.min), max: String(IMAGE_WIDTH_LIMIT.max), step: '10',
              value: String(draftValue || IMAGE_WIDTH_LIMIT.fallback), disabled: busy,
              style: { width: 'min(240px, 52vw)', accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
              onChange: e => { setDisplayWidthNote(''); setDisplayWidthDraft(String(e.target.value)); applyImageWidth(e.target.value) },
            }),
            h('input', {
              'aria-label': '正文图片显示宽度（像素）', type: 'number',
              min: String(IMAGE_WIDTH_LIMIT.min), max: String(IMAGE_WIDTH_LIMIT.max),
              value: draftText, placeholder: '默认', disabled: busy,
              style: Object.assign({}, S.input, { width: '92px' }),
              onChange: e => { setDisplayWidthNote(''); setDisplayWidthDraft(e.target.value); applyImageWidth(e.target.value) },
            }),
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, draftValue ? draftValue + ' px' : '默认'),
            h('button', { style: buttonStyle, disabled: busy || !valid || draftValue === saved, onClick: () => { void saveDisplayWidth() } }, busy ? '保存中…' : '保存'),
            dirty ? h('button', { style: buttonStyle, disabled: busy, onClick: () => { setDisplayWidthDraft(null); setDisplayWidthNote(''); applyImageWidth(saved) } }, '取消预览') : null,
            h('button', { style: buttonStyle, disabled: busy || !saved, onClick: () => { void saveDisplayWidth('') } }, '恢复默认'),
            !valid ? h('span', { role: 'alert', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, '宽度只能是数字') : null,
            dirty
              ? h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', color: 'var(--dsw-alias-state-warning-primary)' } }, '预览中（未保存）：正文已临时按 ' + (draftValue ? draftValue + ' px' : '默认') + ' 显示')
              : (displayWidthNote ? h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', color: /失败/.test(displayWidthNote) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' } }, displayWidthNote) : null),
          ),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '6px' } },
            '可填 ' + IMAGE_WIDTH_LIMIT.min + '–' + IMAGE_WIDTH_LIMIT.max + ' 像素；留空 = 默认。超出范围会自动收窄到区间内。',
            '保存后刷新或重启依然有效。拖完可以直接切回正文看效果，不满意点「取消预览」。'),
        )
      }

      function generationModeCard() {
        const mode = config.generationMode === 'reference' ? 'reference' : 'text'
        const activeChannel = (Array.isArray(config.imageChannels) ? config.imageChannels : []).find(channel => channel.id === config.activeImageChannel)
        const activeDraft = activeChannel ? channelSecretDrafts[activeChannel.id]?.fields : null
        const effectiveChannel = activeChannel ? Object.assign({}, activeChannel, activeDraft || {}, { options: activeDraft?.options || activeChannel.options || {} }) : null
        const available = uiSupportsImageReferences(effectiveChannel || (imageBackend === 'comfyui' ? { provider: 'comfyui' } : { provider: imageBackend }), data)
        return h('div', { style: S.card },
          h('label', { style: S.row }, h('span', { style: S.label }, '默认生图模式'),
            h('select', { 'aria-label': '默认生图模式', value: mode, style: S.input, onChange: event => save({ generationMode: event.target.value }) },
              h('option', { value: 'text' }, '文生图'),
              h('option', { value: 'reference', disabled: !available }, '参考图生图'))),
          !available ? h('div', { role: mode === 'reference' ? 'alert' : 'status', style: { fontSize: '12px', color: mode === 'reference' ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-tertiary)' } },
            mode === 'reference' ? '当前渠道不支持参考图输入；请明确切换到支持参考图的渠道或改为文生图，不会自动降级。' : '当前渠道不支持参考图输入；可在支持参考图的渠道中启用此模式。') : null,
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '6px' } }, '参考图模式使用人物库中的角色／服装参考图；有图用图、缺图用文字，整张无图时暂停提示。单张重绘可覆盖模式。', imageBackend === 'comfyui' ? ' ComfyUI 工作流需要接入 LoadImage 节点；图片按本张参考图上传顺序对应节点。' : ''),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } }, '切换模式不会更换模型 ID，也不会自动删减参考图；不支持的协议会在提交前明确阻止，不会静默降级。'))
      }

      function planTab() {
        const entries = data.worldbook || []
        const chosen = Array.isArray(config.plannerEntries) ? config.plannerEntries : []
        const active = new Set(chosen.length ? chosen : entries.filter(e => e.index <= 19 || e.index === 142).map(e => e.index))
        return h('div', null,
          h('div', { style: S.card },
            h('div', { style: S.row },
              h('label', { style: S.row },
                h('input', { type: 'checkbox', disabled: config.imageEnabled === false, checked: config.plannerEnabled !== false, onChange: e => save({ plannerEnabled: e.target.checked, ...(e.target.checked ? { autoImageGen: false } : {}) }) }),
                h('span', { style: { fontSize: '13px' } }, '① 每轮自动规划配图　（插件另请模型写提示词，边解析边提交）'),
              ),
            ),
            h('div', { style: S.row },
              h('label', { style: S.row },
                h('input', { type: 'checkbox', checked: config.smartImageSelection !== false, onChange: e => save({ smartImageSelection: e.target.checked }) }),
                h('span', { style: { fontSize: '13px' } }, '智能决定是否配图（不合适时跳过并说明原因）'),
              ),
            ),
            h('div', { style: S.row },
              h('label', { style: S.row },
                h('input', { type: 'checkbox', checked: config.characterAutoUpdate !== false, disabled: Number(config.tavernApi?.apiVersion) < 2, onChange: e => save({ characterAutoUpdate: e.target.checked }) }),
                h('span', { style: { fontSize: '13px', opacity: Number(config.tavernApi?.apiVersion) < 2 ? .65 : 1 } }, Number(config.tavernApi?.apiVersion) < 2 ? '自动记录明确的永久外貌变化（需要 Tavern API v2）' : '自动记录明确的永久外貌变化'),
              ),
            ),
            h('div', { style: S.row },
              h('label', { style: S.row },
                h('input', { type: 'checkbox', checked: config.autoImageGen === true, onChange: e => save({ autoImageGen: e.target.checked, ...(e.target.checked ? { plannerEnabled: false } : {}) }) }),
                h('span', { style: { fontSize: '13px' } }, '② 自动生图规则　（前台模型自己写提示词，省一次调用，正文写完才出图）'),
              ),
            ),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: '8px 12px', marginTop: '14px' } },
              h('div', null,
                h('div', { className: 'dti-field-label' }, '一轮几张', ['comfyui', 'sdwebui'].includes(imageBackend) ? h('small', null, '本地出图慢，建议 2–3') : null),
                h('input', { 'aria-label': '一轮几张', type: 'number', min: 1, max: 8, value: config.plannerCount || 3, style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => save({ plannerCount: Number(e.target.value) || 3 }) })),
              h('div', null,
                h('div', { className: 'dti-field-label' }, '人物块'),
                h('select', { 'aria-label': '人物块', value: config.traitMode || 'auto', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => save({ traitMode: e.target.value }) },
                  h('option', { value: 'auto' }, '自动（画面露才带露出版本）'),
                  h('option', { value: 'sfw' }, '只带常规版本'),
                  h('option', { value: 'all' }, '全都带上'),
                ))),
            h(ModelPicker, {
              label: '规划模型', providerKey: 'plannerProvider', modelKey: 'plannerModel', effortKey: 'plannerEffort',
              hint: '写每张图的画面和提示词；不选就跟随 Tavern 后台模型',
            }),
            h(ModelPicker, {
              label: '看图模型', providerKey: 'visionProvider', modelKey: 'visionModel', effortKey: 'visionEffort',
              onlyVision: true, hint: '设计角色时读参考图用，只列支持看图的模型',
            }),
          ),
          imageDisplayCard(),
          h('div', { style: S.card },
            h('div', { style: { fontSize: '13px', marginBottom: '4px' } },
              (function () {
                const all = data.worldbook || []
                // 自己算，不依赖宿主新加的字段（避免"没重启就显示 0"）
                const on = all.filter(e => e.enabled !== false && String(e.content ?? '').trim()).length
                return '世界书（' + all.length + ' 条，已启用 ' + on + ' 条）'
              })()),
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
              '启用的常驻条目每轮发送；关键词条目仅在正文命中时发送，并按适用渠道筛选。旧条目默认常驻。触发方式和内容可在「世界书」标签页里改。'),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, onClick: () => setTab('worldbook') }, '📖 去世界书里勾选 / 编辑'),
              h('button', { style: buttonStyle, onClick: () => { setTab('worldbook'); setWbImportOpen(true) } }, '📥 导入世界书'),
            ),
          ),
          h('details', { style: S.card },
            h('summary', { style: { fontSize: '13px', cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)' } }, '试规划（贴一段正文，看 agent 产出）'),
            h('textarea', { value: planText, onChange: e => setPlanText(e.target.value), placeholder: '把一段正文贴在这里…', style: Object.assign({}, S.input, { width: '100%', minHeight: '80px', fontFamily: 'inherit' }) }),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, onClick: async () => {
                if (!planText.trim()) { setNote('先贴一段正文'); return }
                setNote('规划中…（要读规则 + 写提示词）')
                setPlanRows(null)
                try {
                  const r = await post('/plan', { messageId: 'panel-' + Date.now(), turn: 0, text: planText, manual: true })
                  setPlanRows(r.plans || [])
                  setNote(r.plans && r.plans.length ? ('规划出 ' + r.plans.length + ' 张，正在画…') : ('没产出：' + (r.error || '模型没按格式返回')))
                } catch (e) { setNote('失败：' + (e && e.message ? e.message : e)) }
              } }, '让 agent 规划'),
            ),
            planRows ? planRows.map((p, i) => h('div', { key: i, style: { marginTop: '8px', fontSize: '12px' } },
              h('div', { style: { fontWeight: 600 } }, (i + 1) + '. ' + (p.title || '(无标题)') + '　' + (p.sizeText || p.size || '')),
              h('div', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '插在这句之后：' + (p.mount || '（没给挂载句）')),
              h('div', { style: { color: 'var(--dsw-alias-label-tertiary)', wordBreak: 'break-all' } }, String(p.prompts || '').slice(0, 260)),
              p.jobId ? h('img', { src: BASE + '/jobs?id=' + encodeURIComponent(p.jobId) + '&image=1', style: { maxWidth: '300px', borderRadius: '8px', marginTop: '6px' } }) : null,
            )) : null,
          ),
        )
      }

      // ---- 人物库（人物设计）----
      function peopleTab() {
        const characters = (data.definitions && data.definitions.characters) || []
        const picked = characters.filter(character => peoplePicked[character.id])
        const search = peopleSearch.trim().toLocaleLowerCase()
        // —— 按卡归类 ——
        const bareCard = value => String(value || '').replace(/^.*[\\/]/, '').replace(/\.json$/i, '')
        const cardTitle = path => (importCards.find(item => bareCard(item.path) === bareCard(path))?.label) || bareCard(path)
        const boundTo = (person, path) => (person.cards || []).some(entry => bareCard(entry) === bareCard(path))
        const cardFilter = peopleCardFilter || (currentCardPath ? currentCardPath : 'all')
        const onFilter = person => cardFilter === 'all' ? true
          : cardFilter === '__unbound' ? !(person.cards || []).length
          : (!(person.cards || []).length || boundTo(person, cardFilter))
        const sectionOf = person => {
          const cards = person.cards || []
          if (!cards.length) return '未绑定（所有卡通用）'
          if (cardFilter !== 'all' && cardFilter !== '__unbound') return '「' + cardTitle(cardFilter) + '」的人物'
          return cards.length === 1 ? '「' + cardTitle(cards[0]) + '」的人物' : '多张卡共用'
        }
        // 「绑定到当前卡」用的目标：筛选选中的卡，其次正在玩的卡
        const bindTarget = cardFilter !== 'all' && cardFilter !== '__unbound' ? cardFilter : currentCardPath
        const filteredCharacters = characters.filter(onFilter).filter(character => !search || [character.name, character.match, character.group].some(value => String(value || '').toLocaleLowerCase().includes(search)))
          .slice().sort((a, b) => {
            const sa = sectionOf(a), sb = sectionOf(b)
            if (sa !== sb) {
              const rank = name => name.startsWith('未绑定') ? 2 : name === '多张卡共用' ? 1 : 0
              return (rank(sa) - rank(sb)) || sa.localeCompare(sb, 'zh-CN')
            }
            const ga = String(a.group || '').trim()
            const gb = String(b.group || '').trim()
            if (ga !== gb) {
              if (!ga) return 1
              if (!gb) return -1
              return ga.localeCompare(gb, 'zh-CN')
            }
            return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
          })
        const activeCharacter = filteredCharacters.find(character => character.id === peopleActiveId) || filteredCharacters[0] || null
        const activeIndex = activeCharacter ? characters.findIndex(character => character.id === activeCharacter.id) : -1
        const batchFields = [
          ['feature', '性格气质'], ['face', '五官外貌'], ['faceBack', '五官外貌背面'],
          ['bodySFW', '上半身SFW'], ['bodySFWBack', '上半身SFW背面'], ['lowerSFW', '下半身SFW'], ['lowerSFWBack', '下半身SFW背面'],
          ['bodyNSFW', '上半身NSFW'], ['bodyNSFWBack', '上半身NSFW背面'], ['lowerNSFW', '下半身NSFW'], ['lowerNSFWBack', '下半身NSFW背面'],
          ['negative', '负面'], ['match', '英文触发名'], ['group', '分组'], ['continuity', '状态与变化'], ['note', '备注'], ['enabled', '启用状态'], ['cards', '绑定卡片'],
        ]

        function applyBatch() {
          const selected = new Set(picked.map(character => character.id))
          if (!selected.size) { setPeopleBatchNote('请先选择角色'); return }
          if (peopleBatchMode === 'append' && peopleBatchField !== 'enabled' && !peopleBatchValue.trim() && (peopleBatchField !== 'cards' || !peopleBatchCards.length)) {
            setPeopleBatchNote('先填写要追加的内容'); return
          }
          setCharacters(current => current.map(character => {
            if (!selected.has(character.id)) return character
            if (peopleBatchField === 'enabled') return Object.assign({}, character, { enabled: peopleBatchValue !== 'false' })
            if (peopleBatchField === 'cards') return Object.assign({}, character, { cards: peopleBatchMode === 'append' ? [...new Set([...(character.cards || []), ...peopleBatchCards])] : peopleBatchCards.slice() })
            const topLevel = ['match', 'group', 'continuity', 'note'].includes(peopleBatchField)
            const previous = String((topLevel ? character[peopleBatchField] : character.traits?.[peopleBatchField]) || '')
            const value = peopleBatchMode === 'append' && previous.trim()
              ? previous + (['continuity', 'note'].includes(peopleBatchField) ? '\n' : ', ') + peopleBatchValue.trim()
              : peopleBatchValue
            return topLevel
              ? Object.assign({}, character, { [peopleBatchField]: value })
              : Object.assign({}, character, { traits: Object.assign({}, character.traits, { [peopleBatchField]: value }) })
          }))
          setPeopleBatchNote('已修改 ' + selected.size + ' 位角色，请点「保存人物库」')
        }

        function batchPanel() {
          if (!peopleBatchOpen) return null
          return h('div', { style: Object.assign({}, S.card, { margin: '8px 0 12px', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 4%, transparent)' }) },
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '6px' } }, '选择要批量修改的角色（列表按上方搜索筛选；已选 ' + picked.length + ' 位，包含隐藏角色）'),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, disabled: !filteredCharacters.length, onClick: () => setPeoplePicked(current => Object.assign({}, current, Object.fromEntries(filteredCharacters.map(character => [character.id, true])))) }, '全选当前筛选'),
              h('button', { style: buttonStyle, onClick: () => setPeoplePicked({}) }, '清除选择'),
            ),
            h('div', { style: { maxHeight: '150px', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: '10px' } },
              filteredCharacters.length ? filteredCharacters.map(character => h('label', { key: character.id, style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' } },
                h('input', { type: 'checkbox', 'aria-label': '批量选择角色 ' + (character.name || '未命名'), checked: Boolean(peoplePicked[character.id]), onChange: event => { const checked = event.target.checked; setPeoplePicked(current => Object.assign({}, current, { [character.id]: checked })) } }),
                character.name || '（未命名角色）',
              )) : h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '没有匹配的角色')),
            h('div', { style: S.row },
              h('span', { style: S.label }, '批量编辑'),
              h('select', { 'aria-label': '批量编辑字段', value: peopleBatchField, style: S.input, onChange: async event => {
                const field = event.target.value
                setPeopleBatchField(field)
                setPeopleBatchValue(field === 'enabled' ? 'true' : '')
                setPeopleBatchNote('')
                if (field === 'cards') {
                  try { const r = await jsonFetch(BASE + '/cards'); setCardList(r?.cards || []) } catch { setPeopleBatchNote('读取卡片失败，请重新选择「绑定卡片」') }
                }
              } }, batchFields.map(([key, label]) => h('option', { key, value: key }, label))),
              peopleBatchField === 'enabled' ? null : h('select', { 'aria-label': '批量编辑方式', value: peopleBatchMode, style: S.input, onChange: event => setPeopleBatchMode(event.target.value) },
                h('option', { value: 'replace' }, '覆盖'), h('option', { value: 'append' }, '追加')),
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '只修改选中的 ' + picked.length + ' 位角色'),
            ),
            peopleBatchField === 'enabled'
              ? h('select', { 'aria-label': '批量启用状态', value: peopleBatchValue === 'false' ? 'false' : 'true', style: S.input, onChange: event => setPeopleBatchValue(event.target.value) }, h('option', { value: 'true' }, '启用'), h('option', { value: 'false' }, '禁用'))
              : peopleBatchField === 'cards'
                ? h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', maxHeight: '180px', overflowY: 'auto' } },
                  cardList.length ? cardList.map(card => h('label', { key: card.path, style: { fontSize: '12px' } },
                    h('input', { type: 'checkbox', checked: peopleBatchCards.includes(card.path), onChange: event => { const checked = event.target.checked; setPeopleBatchCards(current => checked ? [...new Set([...current, card.path])] : current.filter(path => path !== card.path)) } }), ' ' + card.name))
                    : h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '暂无卡片可选'),
                )
                : h('textarea', { 'aria-label': '批量编辑内容', value: peopleBatchValue, placeholder: '填写要应用到所选角色的内容', rows: 3, style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }), onChange: event => setPeopleBatchValue(event.target.value) }),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, disabled: !picked.length, onClick: applyBatch }, '应用到所选角色'),
              h('button', { style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 65%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }), disabled: !picked.length, onClick: deletePicked }, '删除所选'),
              h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, peopleBatchField === 'cards' && peopleBatchMode === 'replace' && !peopleBatchCards.length ? '未选卡片时清除绑定，所有卡片都能使用' : peopleBatchMode === 'replace' && peopleBatchField !== 'enabled' ? '覆盖会替换原内容；文本留空会清空该字段' : '应用后点保存即可写入人物库'),
            ),
            peopleBatchNote ? h('div', { role: 'status', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, peopleBatchNote) : null,
          )
        }

        function blankCharacter() {
          const traits = {}
          for (const key of ["feature","face","faceBack","bodySFW","bodySFWBack","lowerSFW","lowerSFWBack","bodyNSFW","bodyNSFWBack","lowerNSFW","lowerNSFWBack","negative"]) traits[key] = ''
          return { id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6), name: '', match: '', group: '', formCues: '', enabled: true, continuity: '', note: '', inject: {}, cards: [], outfitRefs: [], traits,
            outfits: [{ id: 'o' + Date.now(), name: '常服', upper: '', lower: '', shoes: '', accessory: '', full: '', back: '', negative: '', enabled: true, default: true }] }
        }
        function addCharacter() {
          const person = blankCharacter()
          setCharacters(current => current.concat([person]))
          setPeopleSearch('')
          setPeopleActiveId(person.id)
          setPeopleEditorOpen(true)
        }
        function copyCharacter(person) {
          if (!person) return
          const copy = Object.assign({}, person, {
            id: 'c' + Date.now() + Math.random().toString(36).slice(2, 8),
            name: (person.name || '未命名角色') + '（副本）',
            traits: Object.assign({}, person.traits),
            inject: Object.assign({}, person.inject),
            cards: (person.cards || []).slice(),
            outfitRefs: (person.outfitRefs || []).slice(),
            outfits: (person.outfits || []).map(outfit => Object.assign({}, outfit, { id: 'o' + Date.now() + Math.random().toString(36).slice(2, 8) })),
          })
          setCharacters(current => current.concat([copy]))
          setPeopleSearch('')
          setPeopleActiveId(copy.id)
          setPeopleEditorOpen(true)
        }
        function patchIdentity(index, changes) {
          const person = characters[index]
          if (!person) return
          const next = Object.assign({}, person, changes)
          const query = peopleSearch.trim().toLocaleLowerCase()
          const stillMatches = [next.name, next.match, next.group].some(value => String(value || '').toLocaleLowerCase().includes(query))
          setPeopleActiveId(person.id)
          if (query && !stillMatches) setPeopleSearch('')
          patch(index, changes)
        }
        // 注意：peopleTab 是被调用的普通函数，不能用 hooks（会让 SettingsPanel 的 hooks 数不稳定）
        onDesignResult = () => { refresh() }
        function setCharacters(update) {
          const current = dataRef.current
          const before = current?.definitions?.characters || []
          const next = typeof update === 'function' ? update(before) : update
          setLibraryData(Object.assign({}, current, { definitions: Object.assign({}, current.definitions, { characters: next }) }))
          return next
        }
        function patch(index, changes) {
          const id = characters[index]?.id
          setCharacters(current => current.map(person => person.id === id ? Object.assign({}, person, typeof changes === 'function' ? changes(person) : changes) : person))
        }
        function patchTraits(index, key, value) {
          patch(index, person => ({ traits: Object.assign({}, person.traits, { [key]: value }) }))
        }
        function patchOutfit(index, position, changes) {
          const outfitId = characters[index]?.outfits?.[position]?.id
          patch(index, person => ({ outfits: (person.outfits || []).map(outfit => outfit.id === outfitId ? Object.assign({}, outfit, changes) : outfit) }))
        }
        /** 批量删除所选角色（直接算好新列表再写盘，避免读到旧的 React 状态） */
        async function deletePicked() {
          const ids = picked.map(person => person.id)
          if (!ids.length) { setPeopleBatchNote('请先选择角色'); return }
          const names = picked.map(person => person.name || '未命名角色').join('、')
          if (typeof window !== 'undefined' && !window.confirm('确定删除这 ' + ids.length + ' 个角色？\n' + names)) return
          const current = dataRef.current || {}
          const defs = Object.assign({}, current.definitions || {})
          const nextChars = (defs.characters || []).filter(person => !ids.includes(person.id))
          defs.characters = nextChars
          defs.outfits = current.outfits ?? defs.outfits ?? []
          setPeopleBatchNote('正在保存删除…')
          try {
            const r = await post('/definitions', { definitions: defs })
            if (!r?.ok || !r.state) throw new Error(r?.error || '服务器没有确认保存')
            receiveState(r.state)
            setCharacters(nextChars)
            setPeoplePicked({})
            setPeopleBatchNote('已删除 ' + ids.length + ' 个角色')
            if (typeof showToast === 'function') showToast('已删除 ' + ids.length + ' 个角色')
          } catch (error) {
            const message = '删除失败：' + (error?.message ?? error)
            setPeopleBatchNote(message)
            if (typeof showToast === 'function') showToast(message)
          }
        }

        /** 从当前会话的世界书导入成年角色 */
        /** 从选定的卡导入：先预览候选，勾选确认后才写入人物库 */
        async function importFromCard() {
          try {
            setNote('正在读取这张卡里的角色…')
            const result = await post('/import-characters', { sessionId: String(lastSessionId || ''), card: importCard, dryRun: true })
            if (!result?.ok) throw new Error(result?.error || '读取失败')
            const items = (result.candidates || []).map(item => ({ action: item.action, person: item.person, pick: item.action !== 'same' }))
            setImportPreview({ card: importCard, cardName: result.cardName || cardTitleOf(importCard), items })
            setNote(items.length ? '先看一下要导入的人，勾选后点「确认导入」' : ('这张卡里没有可导入的角色' + (result?.llmError ? '（' + String(result.llmError).slice(0, 140) + '）' : '')))
            return result
            const added = result?.added || []
            const updated = result?.updated || []
            const parts = []
            if (added.length) parts.push('新增 ' + added.join('、'))
            if (updated.length) parts.push('补全 ' + updated.join('、'))
            const why = result?.llmError ? ('（' + String(result.llmError).slice(0, 140) + '）') : ''
            const message = parts.length ? ('从选定的卡导入：' + parts.join('；')) : ('这张卡里没有可导入的角色' + why)
            setNote(message)
            if (typeof showToast === 'function') showToast(message)
            return result
          } catch (error) {
            const message = '导入失败：' + (error?.message ?? error)
            setNote(message)
            if (typeof showToast === 'function') showToast(message)
            return null
          }
        }

        /** 卡文件 → 显示名（预览面板标题用） */
        function cardTitleOf(path) {
          return (importCards.find(item => item.path === path)?.label)
            || String(path || '').replace(/^.*[\/\\]/, '').replace(/\.json$/i, '')
        }

        /** 预览面板点「确认导入」：把勾选的人原样送回去，后端不再重新抽取 */
        async function confirmImport() {
          const preview = importPreview
          if (!preview) return null
          const picked = preview.items.filter(item => item.pick).map(item => item.person)
          if (!picked.length) { setNote('没有勾选要导入的人'); return null }
          try {
            setNote('正在导入…')
            const result = await post('/import-characters', { sessionId: String(lastSessionId || ''), card: preview.card, apply: picked })
            if (!result?.ok) throw new Error(result?.error || '导入失败')
            setImportPreview(null)
            if (result?.state) receiveState(result.state)
            const added = result?.added || []
            const updated = result?.updated || []
            const parts = []
            if (added.length) parts.push('新增 ' + added.join('、'))
            if (updated.length) parts.push('补全 ' + updated.join('、'))
            const message = parts.length ? ('从选定的卡导入：' + parts.join('；')) : '勾选的人和人物库里已有的一样，没有变化'
            setNote(message)
            if (typeof showToast === 'function') showToast(message)
            const fresh = await post('/state', {}).catch(() => null)
            if (fresh) receiveState(fresh)
            return result
          } catch (error) {
            const message = '导入失败：' + (error?.message ?? error)
            setNote(message)
            if (typeof showToast === 'function') showToast(message)
            return null
          }
        }

        function commit(silent) {
          // 排队写入，并在真正开始时读取最新草稿；并行设计完成不会互相覆盖整库。
          const pending = librarySaveQueue.current.then(async () => {
            const current = dataRef.current
            const revision = libraryRevision.current
            const defs = Object.assign({}, current.definitions, { outfits: current.outfits ?? current.definitions?.outfits ?? [] })
            setSaveState('saving')
            if (!silent) setNote('保存中…')
            reportHost('save-start', { characters: (defs.characters || []).length, outfits: defs.outfits.length })
            try {
              const r = await post('/definitions', { definitions: defs })
              if (!r?.ok || !r.state) throw new Error(r?.error || '服务器没有确认保存')
              reportHost('save-ok', { ok: true })
              if (libraryRevision.current === revision) libraryDirty.current = false
              receiveState(r.state)
              libraryRevision.current += 1
              setSaveState(libraryDirty.current ? '' : 'saved')
              if (!silent) setNote(libraryDirty.current ? '已保存提交的内容；还有新修改，请再保存' : '人物库已保存')
              return true
            } catch (e) {
              const msg = e && e.message ? e.message : String(e)
              reportHost('save-failed', { message: msg.slice(0, 200) })
              if (typeof showToast === 'function') showToast('写入角色库失败：' + msg.slice(0, 60), 'fail')
              setNote('保存失败：' + msg)
              setSaveState('failed:' + msg.slice(0, 60))
              return false
            }
          })
          librarySaveQueue.current = pending.then(() => undefined, () => undefined)
          return pending
        }

        function mergeDesign(original, designed, current) {
          const next = Object.assign({}, current)
          for (const key of ['name', 'match', 'note']) {
            if (current[key] === original[key] && designed[key]) next[key] = designed[key]
          }
          next.traits = Object.assign({}, current.traits)
          for (const [key, value] of Object.entries(designed.traits || {})) {
            if (current.traits?.[key] === original.traits?.[key]) next.traits[key] = value
          }
          if ((designed.outfits || []).length && JSON.stringify(current.outfits) === JSON.stringify(original.outfits)) {
            next.outfits = designed.outfits.map(outfit => Object.assign({ id: 'o' + Date.now() + Math.random().toString(36).slice(2, 6), enabled: true, default: false }, outfit))
          }
          return next
        }

        /** 让 agent 按「角色与服装设计规范」产出人物（可以顺带读当前卡片的设定）。 */
        async function designPeople() {
          // 展开内联的设计面板（不再弹浮层）
          setDesignOpen(true)
          setDesignNote('')
          setDesignDone('')
          setImproveTarget('')
          return
        }

        /** 直接改进某个角色：不开面板，拿当前这条输入框的要求跑一次改进 */
        async function sendImprove(index) {
          const person = characters[index]
          if (!person) return
          const id = person.id
          const draft = String(improveDraft[id] || '')
          const ask = draft.trim()
          if (!ask) { setDesignNote('先写要改什么'); return }
          // 不锁：生成完一个可以接着生成下一个（同一条防重复点）
          if (improveInFlight.current[id]) return
          improveInFlight.current[id] = true
          setDesignBusy(true)
          setDesignNote('正在改进「' + (person.name || '未命名') + '」…')
          reportHost('improve-click', { index, name: String(person.name || ''), via: 'inline' })
          try {
            const payload = { brief: ask, sessionId: String(lastSessionId || ''), current: person }
            const r = await post('/design', payload)
            if (!r?.ok) { setDesignNote('改进失败：' + (r?.error || '')); return }
            const people = r.people || []
            if (!people.length) { setDesignNote('没产出人物。模型原文：' + String(r.raw || '').slice(0, 140)); return }
            const current = dataRef.current?.definitions?.characters || []
            if (!current.some(character => character.id === id)) { setDesignNote('角色已删除，已忽略改进结果'); return }
            const next = setCharacters(current.map(character => character.id === id ? mergeDesign(person, people[0], character) : character))
            setImproveDraft(drafts => drafts[id] === draft ? Object.assign({}, drafts, { [id]: '' }) : drafts)
            setDesignDone('')
            const saved = await commit(true)
            if (saved && typeof showToast === 'function') showToast('已改进「' + next.find(character => character.id === id).name + '」，并写入角色库')
            setDesignNote(saved ? '' : '改进结果已保留，请点「保存人物库」重试保存')
          } catch (error) {
            setDesignNote('改进失败：' + (error?.message ?? error))
          } finally {
            delete improveInFlight.current[id]
            setDesignBusy(Object.keys(improveInFlight.current).length > 0)
          }
        }

        /** 内联的设计面板：需求 + 参考图 + 确定生成 */
        function designPanel() {
          if (!designOpen) return null
          function pickDesignFile(event) {
            const file = event?.target?.files && event.target.files[0]
            if (!file) return
            if (file.size > 12 * 1024 * 1024) { setDesignNote('图片太大了（上限 12MB）'); return }
            const reader = new FileReader()
            reader.onload = () => {
              const result = String(reader.result || '')
              setDesignPhoto(result.includes(',') ? result.split(',')[1] : result)
              setDesignPreview(result)
              setDesignName(file.name)
              setDesignNote('')
            }
            reader.onerror = () => setDesignNote('读图失败')
            reader.readAsDataURL(file)
          }
          async function runDesign() {
            if (designInFlight.current) return
            const brief = String(designBrief || '').trim()
            if (!brief) { setDesignNote('先说说想要什么角色或服装'); return }
            const target = characters.find(character => character.id === improveTarget)
            designInFlight.current = true
            setDesignPanelBusy(true)
            setDesignNote('设计需要十几秒，请稍等…')
            try {
              const payload = { brief, sessionId: String(lastSessionId || '') }
              reportHost('improve-run', { improveTarget, hasChar: Boolean(target) })
              if (target) payload.current = target
              if (designPhoto) { payload.data = designPhoto; payload.mediaType = 'image/png'; payload.name = designName || 'ref.png' }
              const r = await post('/design', payload)
              if (!r?.ok) { setDesignNote('设计失败：' + (r?.error || '')); return }
              const people = r.people || []
              if (!people.length) { setDesignNote('没产出人物。模型原文：' + String(r.raw || '').slice(0, 160)); return }
              const next = (dataRef.current?.definitions?.characters || []).slice()
              // 改进模式：原地替换那个角色；新建模式：追加
              if (target) {
                const index = next.findIndex(character => character.id === target.id)
                if (index < 0) { setDesignNote('角色已删除，已忽略改进结果'); return }
                next[index] = mergeDesign(target, people[0], next[index])
                setCharacters(next)
                setDesignDone('')
                const saved = await commit(true)
                if (saved && typeof showToast === 'function') showToast('已改进「' + next[index].name + '」，并写入角色库')
                setDesignNote(saved ? '改进完成，已保存' : '改进结果已保留，请点「保存人物库」重试保存')
                // 面板保持打开
                setDesignBrief(current => current === designBrief ? '' : current)
                setDesignPhoto(current => current === designPhoto ? '' : current)
                setDesignPreview(current => current === designPreview ? '' : current)
                setDesignName(current => current === designName ? '' : current)
                setImproveTarget(current => current === improveTarget ? '' : current)
                return
              }
              for (const person of people) {
                next.push({
                  id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
                  name: person.name || '未命名', match: person.match || '', enabled: true,
                  continuity: '', note: person.note || '', inject: {}, cards: [], outfitRefs: [],
                  traits: Object.assign({ feature: '', face: '', faceBack: '', bodySFW: '', bodySFWBack: '', lowerSFW: '', lowerSFWBack: '', bodyNSFW: '', bodyNSFWBack: '', lowerNSFW: '', lowerNSFWBack: '', negative: '' }, person.traits || {}),
                  outfits: (person.outfits || []).map(o => Object.assign({ id: 'o' + Date.now() + Math.random().toString(36).slice(2, 6), enabled: true, default: false }, o)),
                })
              }
              setCharacters(next)
              setPeopleSearch('')
              setPeopleActiveId(next[next.length - people.length]?.id || '')
              setPeopleEditorOpen(true)
              setDesignDone('')
              const saved = await commit(true)
              if (saved && typeof showToast === 'function') showToast('已生成 ' + people.length + ' 个角色，并写入角色库')
              setDesignNote(saved ? '已生成 ' + people.length + ' 位角色并保存' : '生成结果已保留，请点「保存人物库」重试保存')
              // 面板保持打开，让「保存人物库」提醒可见
              setDesignBrief(current => current === designBrief ? '' : current)
              setDesignPhoto(current => current === designPhoto ? '' : current)
              setDesignPreview(current => current === designPreview ? '' : current)
              setDesignName(current => current === designName ? '' : current)
            } catch (error) {
              setDesignNote('失败：' + (error?.message ?? error))
            } finally {
              designInFlight.current = false
              setDesignPanelBusy(false)
            }
          }
          const area = { width: '100%', minHeight: '96px', boxSizing: 'border-box', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 55%, transparent)', borderRadius: '12px', padding: '12px 14px', fontSize: '13px', lineHeight: '1.6', fontFamily: 'inherit', resize: 'vertical' }
          return h('div', { style: { margin: '10px 0 4px', padding: '16px', borderRadius: '12px', background: 'linear-gradient(180deg,var(--dsw-specific-input-major),var(--dsw-specific-input-major))', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 40%, transparent)' } },
            h('div', { style: { fontSize: '15px', fontWeight: 600, marginBottom: '4px' } },
              characters.find(character => character.id === improveTarget)
                ? ('✏️ 改进「' + (characters.find(character => character.id === improveTarget).name || '未命名') + '」')
                : '🎨 输入生成需求'),
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } }, '请描述您希望生成的角色或服装的具体需求'),
            h('textarea', { value: designBrief, placeholder: '例如：生成一个穿着古风汉服的少女角色，温柔可爱…', style: area, onChange: e => setDesignBrief(e.target.value) }),
            h('div', { style: { marginTop: '12px', padding: '12px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '📎 参考图片（可选）'),
                h('label', { style: { padding: '6px 14px', fontSize: '12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 60%, transparent)', color: 'var(--dsw-alias-state-warning-primary)', cursor: 'pointer', background: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 8%, transparent)' } },
                  '＋ 添加图片',
                  h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: pickDesignFile }),
                ),
              ),
              designPreview ? h('img', { src: designPreview, style: { display: 'block', maxWidth: '140px', borderRadius: '10px', margin: '10px auto 0' } }) : h('div', { style: { textAlign: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '10px' } }, '点击上方按钮添加参考图片'),
            ),
            designNote ? h('div', { style: { fontSize: '12px', color: /失败|太大|没产出/.test(designNote) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)', marginTop: '10px' } }, designNote) : null,
            h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
              h('button', { style: buttonStyle, onClick: () => { setDesignOpen(false); setDesignNote(''); setDesignDone(''); setImproveTarget('') } }, '收起'),
              h('button', { disabled: designPanelBusy, style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 70%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 15%, transparent)', color: 'var(--dsw-alias-state-warning-primary)' }), onClick: runDesign }, designPanelBusy ? '正在生成…' : '确定生成'),
            ),
          )
        }

        /** 选一张本地图片，交给模型拆成各个可见块。 */
        function pickPhoto(person) {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'image/png,image/jpeg,image/webp,image/gif'
          input.onchange = () => {
            const file = input.files && input.files[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = async () => {
              setNote('正在看图…（要几十秒）')
              try {
                const r = await post('/vision', {
                  data: String(reader.result),
                  mediaType: file.type,
                  name: file.name,
                })
                if (!r.traits) { setNote('模型没按格式返回，原文：' + String(r.raw || '').slice(0, 200)); return }
                const current = dataRef.current?.definitions?.characters || []
                if (!current.some(character => character.id === person.id)) { setNote('角色已删除，已忽略识图结果'); return }
                const traits = Object.assign({}, r.traits, { lowerSFW: r.traits.fullSFW || r.traits.lowerSFW, lowerNSFW: r.traits.fullNSFW || r.traits.lowerNSFW })
                for (const key of Object.keys(traits)) if (!traits[key]) delete traits[key]
                setCharacters(current.map(character => character.id === person.id ? mergeDesign(person, { traits }, character) : character))
                setNote('已按照片填好各块（' + (r.size || '') + '），核对一下再保存')
              } catch (e) {
                setNote('看图失败：' + (e && e.message ? e.message : e))
              }
            }
            reader.readAsDataURL(file)
          }
          input.click()
        }

        function area(label, why, value, onChange, rows) {
          return h('div', { style: { margin: '6px 0' } },
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '2px' } }, label + (why ? '　' + why : '')),
            h('textarea', { value: value || '', onChange: e => onChange(e.target.value),
              style: Object.assign({}, S.input, { width: '100%', minHeight: ((rows || 2) * 20) + 'px', fontFamily: 'inherit', lineHeight: '1.5' }) }),
          )
        }

        /** 把人物按「属于哪张卡」分段，段内保持原排序 */
        function sectionsOf(list) {
          const out = []
          for (const person of list) {
            const key = sectionOf(person)
            const hit = out.find(([name]) => name === key)
            if (hit) hit[1].push(person); else out.push([key, [person]])
          }
          return out
        }
        function bindToCard(person, path) {
          if (!person || !path) return
          setCharacters(current => current.map(item => item.id === person.id ? Object.assign({}, item, { cards: [...new Set([...(item.cards || []), path])] }) : item))
          setNote('已把「' + (person.name || '未命名角色') + '」绑定到「' + cardTitle(path) + '」，记得点「保存人物库」')
        }
        function traitCount(person) {
          const traits = person.traits || {}
          return ["feature","face","faceBack","bodySFW","bodySFWBack","lowerSFW","lowerSFWBack","bodyNSFW","bodyNSFWBack","lowerNSFW","lowerNSFWBack","negative"].filter(k => String(traits[k] || '').trim()).length
        }
        function jumpTo(person) {
          setPeopleSearch('')
          if (!onFilter(person)) setPeopleCardFilter('all')
          setPeopleActiveId(person.id)
          setPeopleEditorOpen(true)
        }

        function importPreviewPanel() {
          const preview = importPreview
          if (!preview) return null
          const label = { add: '新增', update: '补全空白项', same: '已有，无变化' }
          const toggle = (index, pick) => setImportPreview(current => current && Object.assign({}, current, { items: current.items.map((item, k) => k === index ? Object.assign({}, item, { pick }) : item) }))
          const count = preview.items.filter(item => item.pick).length
          return h('div', { 'aria-label': '导入预览', style: Object.assign({}, S.card, { margin: '8px 0 12px', background: 'rgba(106,168,255,.05)' }) },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, '从「' + preview.cardName + '」导入：先确认要哪些人'),
            h('div', { style: { fontSize: '12px', color: '#9aa3b2', marginBottom: '6px' } }, '新增的人会自动绑定到这张卡；「补全」只填人物库里空着的项，不覆盖你改过的内容。'),
            preview.items.length ? preview.items.map((item, index) => h('label', { key: index, style: { display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', padding: '4px 0', borderTop: index ? '1px solid #2c3240' : 'none' } },
              h('input', { type: 'checkbox', 'aria-label': '导入 ' + item.person.name, checked: item.pick, onChange: event => toggle(index, event.target.checked) }),
              h('span', { style: { minWidth: '72px', color: item.action === 'add' ? '#7fd17f' : item.action === 'update' ? '#f5c078' : '#9aa3b2' } }, label[item.action] || item.action),
              h('span', { style: { fontWeight: 600, minWidth: '70px' } }, item.person.name),
              h('span', { style: { color: '#9aa3b2' } }, String(item.person?.traits?.feature || item.person?.traits?.face || '').slice(0, 80)),
            )) : h('div', { style: { fontSize: '12px', color: '#9aa3b2' } }, '这张卡里没有认出可导入的人物。'),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, disabled: !count, onClick: confirmImport }, count ? '确认导入 ' + count + ' 位' : '没有勾选'),
              h('button', { style: buttonStyle, onClick: () => { setImportPreview(null); setNote('已取消导入') } }, '取消'),
            ),
          )
        }

        function overviewPanel() {
          const list = filteredCharacters
          return h('div', { 'aria-label': '人物概览', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px', margin: '8px 0 12px' } },
            list.length ? list.map(person => {
              const n = traitCount(person)
              const outfits = (person.outfits || []).length
              const cards = person.cards || []
              const active = activeCharacter && activeCharacter.id === person.id
              return h('button', { key: person.id, 'aria-label': '概览 ' + (person.name || '未命名角色'), onClick: () => { jumpTo(person); setPeopleOverviewOpen(false) },
                style: { textAlign: 'left', padding: '8px 10px', borderRadius: '10px', cursor: 'pointer', color: 'inherit', background: active ? 'rgba(106,168,255,.14)' : 'rgba(255,255,255,.03)', border: '1px solid ' + (cards.length ? 'rgba(120,140,170,.25)' : 'rgba(240,166,60,.55)'), opacity: person.enabled === false ? 0.55 : 1 } },
                h('div', { style: { fontSize: '13px', fontWeight: 600 } }, (person.name || '（未命名角色）') + (person.enabled === false ? '（停用）' : '')),
                h('div', { style: { fontSize: '11px', color: n >= 6 ? '#9aa3b2' : '#f5c078', marginTop: '3px' } }, '外貌 ' + n + '/12 块 · ' + (outfits ? outfits + ' 套服装' : '没有服装')),
                h('div', { style: { fontSize: '11px', color: cards.length ? '#9aa3b2' : '#f5c078', marginTop: '2px' } }, cards.length ? '绑定：' + cards.map(cardTitle).join('、').slice(0, 40) : '未绑定卡：所有卡都会用到'),
              )
            }) : h('div', { style: { fontSize: '12px', color: '#9aa3b2' } }, '当前筛选下没有人物'),
          )
        }

        /** 整理：列出可能出问题的人物，可直接跳过去改或一键处理 */
        function tidyPanel() {
          const PLAYER = /^(你|我|玩家|主角|男主|女主|主人公|user|\{\{user\}\})$/i
          const issues = []
          const byName = new Map()
          for (const person of characters) {
            const name = String(person.name || '').trim()
            if (name) byName.set(name, (byName.get(name) || 0) + 1)
          }
          for (const person of characters) {
            const name = String(person.name || '').trim()
            if (!name || PLAYER.test(name) || name.includes('{{user}}')) issues.push({ person, kind: 'player', text: name ? '像是玩家角色，不需要建生图设定' : '没有名字' })
            if (!(person.cards || []).length) issues.push({ person, kind: 'unbound', text: '没绑定卡：所有卡的图里都可能出现' })
            if (name && byName.get(name) > 1) issues.push({ person, kind: 'dup', text: '和另一位重名，生图时可能互相顶替' })
            if (traitCount(person) < 3) issues.push({ person, kind: 'sparse', text: '外貌只填了 ' + traitCount(person) + ' 块，出图会不稳定' })
          }
          const remove = person => {
            if (typeof confirm === 'function' && !confirm('删掉「' + (person.name || '未命名') + '」？')) return
            setCharacters(current => current.filter(item => item.id !== person.id))
          }
          return h('div', { 'aria-label': '整理人物库', style: Object.assign({}, S.card, { margin: '8px 0 12px' }) },
            h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '6px' } }, issues.length ? '发现 ' + issues.length + ' 处可以整理的地方（看全部卡）' : '人物库很整齐，没有发现问题'),
            issues.map((issue, index) => h('div', { key: issue.person.id + issue.kind, style: Object.assign({}, S.row, { borderTop: index ? '1px solid #2c3240' : 'none', paddingTop: '4px' }) },
              h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', minWidth: '90px' }), onClick: () => jumpTo(issue.person) }, issue.person.name || '（未命名角色）'),
              h('span', { style: { fontSize: '12px', color: '#9aa3b2', flex: 1 } }, issue.text),
              issue.kind === 'unbound' && bindTarget ? h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: () => bindToCard(issue.person, bindTarget) }, '绑定到「' + cardTitle(bindTarget) + '」') : null,
              issue.kind === 'player' ? h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', borderColor: 'rgba(242,104,107,.65)', color: '#f2686b' }), onClick: () => remove(issue.person) }, '删除') : null,
            )),
            issues.length ? h('div', { style: { fontSize: '11px', color: '#9aa3b2', marginTop: '6px' } }, '处理完记得点「保存人物库」') : null,
          )
        }

        function characterBlock(c, i) {
          const traits = c.traits || {}
          const outfits = c.outfits || []
          const filled = ["feature","face","faceBack","bodySFW","bodySFWBack","lowerSFW","lowerSFWBack","bodyNSFW","bodyNSFWBack","lowerNSFW","lowerNSFWBack","negative"].filter(k => String(traits[k] || '').trim()).length
          const title = (c.name || '（未命名角色）') + '　' + filled + '/12 块　' + (outfits.length ? outfits.length + ' 套服装' : '没有服装') + ((c.cards || []).length ? '' : '　⚠ 未绑定卡（所有卡都会用到）')
          const grouped = (list) => list.map(([key, label, why, rows, folded]) => area(label, why, traits[key], v => patchTraits(i, key, v), rows))
          return h('details', { key: c.id, open: peopleEditorOpen, onToggle: event => {
            const open = event.currentTarget.open
            setPeopleEditorOpen(current => current === open ? current : open)
          }, style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '10px 12px', margin: '8px 0' } },
            h('summary', { style: { cursor: 'pointer', fontSize: '13px', fontWeight: 600 } }, title),
            h('div', { style: S.row },
              h('input', { type: 'text', placeholder: '分组（只影响排序）', title: '只用于人物库列表的分组排序和搜索，不参与关键词触发', value: c.group || '', style: Object.assign({}, S.input, { width: '130px' }), onChange: e => patchIdentity(i, { group: e.target.value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) }) }),
              h('input', { type: 'text', placeholder: '角色名', value: c.name || '', style: Object.assign({}, S.input, { width: '140px' }), onChange: e => patchIdentity(i, { name: e.target.value }) }),
              h('input', { type: 'text', placeholder: '英文名（逗号分隔，用来触发）', value: c.match || '', style: Object.assign({}, S.input, { flex: 1, minWidth: '180px' }), onChange: e => patchIdentity(i, { match: e.target.value }) }),
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: c.enabled !== false, onChange: e => patch(i, { enabled: e.target.checked }) }), h('span', { style: { fontSize: '12px' } }, '启用')),
              h('button', { style: buttonStyle, onClick: () => { if (!confirm('删掉「' + (c.name || '未命名') + '」？')) return; setCharacters(current => current.filter(character => character.id !== c.id)) } }, '删除角色'),
            ),
            h(ReferenceImageEditor, { key: 'character-reference-' + c.id, value: c, label: '角色「' + (c.name || '未命名') + '」', onChange: changes => patch(i, changes) }),
            // 常驻的改进行：直接写要求 → 点改进，不用先展开面板
            h('div', { style: S.row },
              h('span', { style: S.label }, '改这个角色'),
              h('input', {
                type: 'text',
                placeholder: '要改什么？例如：头发改成银白 / 加一套睡衣 / 胸再大一点',
                value: improveDraft[c.id] || '',
                style: Object.assign({}, S.input, { flex: 1, minWidth: '220px' }),
                onChange: e => { const value = e.target.value; setImproveDraft(current => Object.assign({}, current, { [c.id]: value })) },
                onKeyDown: e => { if (e.key === 'Enter' && (improveDraft[c.id] || '').trim()) sendImprove(i) },
              }),
              h('button', { style: buttonStyle, disabled: designBusy && Boolean(improveInFlight.current[c.id]), onClick: () => sendImprove(i) }, improveInFlight.current[c.id] ? '正在改进…' : '✏️ 改进'),
            ),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '-4px' } }, '直接写要求点改进即可（回车也行），不用先打开面板'),

            h('div', { style: S.row },
              h('span', { style: S.label }, '绑定卡片'),
              h('button', {
                style: Object.assign({}, buttonStyle, { flex: 1, minWidth: '200px', textAlign: 'left' }),
                onClick: async () => {
                  const open = cardPickerFor === c.id
                  setCardPickerFor(open ? -1 : c.id)
                  if (open) return
                  try {
                    const r = await jsonFetch(BASE + '/cards', { cache: 'no-store' })
                    setCardList(r?.cards ?? [])
                  } catch { setCardList([]) }
                },
              }, (c.cards || []).length ? ('已绑定 ' + (c.cards || []).length + ' 张：' + (c.cards || []).map(p => String(p).replace(/^cards\//, '').replace(/\.json$/, '')).join('、').slice(0, 26) + '（点击修改）') : '点这里选择要绑定的卡片（不选 = 所有卡都能用）'),
            ),
            cardPickerFor === c.id ? h('div', { style: { marginTop: '8px', padding: '10px 12px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)' } },
              h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } }, '勾选要绑定的卡片（可多选）'),
              h('div', { style: { maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' } },
                cardList.length
                  ? cardList.map(item => h('label', {
                      key: item.path,
                      style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', background: (c.cards || []).includes(item.path) ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent)' : 'transparent' },
                    },
                      h('input', {
                        type: 'checkbox',
                        checked: (c.cards || []).includes(item.path),
                        onChange: (e) => {
                          const set = new Set(c.cards || [])
                          if (e.target.checked) set.add(item.path); else set.delete(item.path)
                          patch(i, { cards: [...set] })
                        },
                      }),
                      h('span', { style: { fontSize: '13px' } }, item.name),
                    ))
                  : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '8px' } }, '没读到卡片（检查设置页顶部的 ComfyUI 状态）'),
              ),
              h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } },
                h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: () => patch(i, { cards: [] }) }, '清空'),
                h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: () => setCardPickerFor(-1) }, '收起'),
              ),
            ) : null,
            (data.outfits || []).length ? h('div', { style: S.row },
              h('span', { style: S.label }, '可穿通用'),
              (data.outfits || []).map(o => h('label', { key: o.id, style: { fontSize: '12px', marginRight: '10px' } },
                h('input', { type: 'checkbox', checked: (c.outfitRefs || []).includes(o.id), onChange: e => {
                  const refs = new Set(c.outfitRefs || [])
                  if (e.target.checked) refs.add(o.id); else refs.delete(o.id)
                  patch(i, { outfitRefs: [...refs] })
                } }),
                ' ' + (o.name || o.id),
              )),
            ) : null,
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '10px' } }, '外貌（正面与背面互斥：背面不放眼睛/胸部；SFW 块不放裸露词，否则衣服画不出来）'),
            grouped([["feature","性格气质","性格与气质（proud / gentle / tsundere），只给规划挑表情动作，不写进画图提示词",2,false],["face","五官外貌","【正面】发型、发色、瞳色、脸型、肤色、年龄段 —— 不写表情",3,false],["faceBack","五官外貌背面","【背面】发型背面、后脑勺、脖子后面、耳背 —— 不能写眼睛鼻子嘴巴",2,true]]),
            h('details', { style: { marginTop: '4px' } }, h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '穿衣身体块（上半身 / 下半身，正背面）'),
              grouped([["bodySFW","上半身SFW","穿衣可见的上半身正面：体型、胸部轮廓、肩宽 —— 禁裸露词",2,false],["bodySFWBack","上半身SFW背面","穿衣可见的背面：肩膀轮廓、腰部线条 —— 不写胸部",2,true],["lowerSFW","下半身SFW","穿衣可见的下半身正面：腿型 —— 禁裸露词",2,true],["lowerSFWBack","下半身SFW背面","臀部轮廓、腿部背面",2,true]]),
            ),
            h('details', { style: { marginTop: '4px' } }, h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '赤裸身体块（只在 NSFW 画面用）'),
              grouped([["bodyNSFW","上半身NSFW","赤裸才可见：胸部详细、乳头、正面纹身伤疤",2,true],["bodyNSFWBack","上半身NSFW背面","bare back、背部线条、肩胛骨 —— 不写胸和乳头",2,true],["lowerNSFW","下半身NSFW","赤裸才可见：生殖器官、正面纹身痣",2,true],["lowerNSFWBack","下半身NSFW背面","臀部详细、肛门 —— 不写正面生殖器",2,true]]),
            ),
            h('details', { style: { marginTop: '4px' } }, h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '负面 / 状态'),
              grouped([["negative","负面","这张脸/身体不该出现的特征（进负向提示词）",2,true]]),
              area('状态与变化', '随剧情改，默认不注入', c.continuity, v => patch(i, { continuity: v }), 2),
              area('形态线索', '同一角色有多个形态时（名字互为前缀，如「阿梅」与「阿梅（狐形）」）填在形态条目上，逗号分隔，如 fox ears, fox tail, 狐耳。画面写着这些时，规划写的基础名字会自动换成这个形态', c.formCues || '', v => patch(i, { formCues: v }), 1),
            ),
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '12px', fontWeight: 600 } }, '服装库'),
            // 下拉选一套来编辑：服装多时不再每套铺一张卡
            (() => {
              if (!outfits.length) return h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', margin: '8px 0' } }, '还没添加服装，点下面「新增服装」。')
              const activeId = outfitPick[c.id] && outfits.some((o, j) => String(o.id || j) === outfitPick[c.id]) ? outfitPick[c.id] : String(outfits[0].id || 0)
              const j = outfits.findIndex((o, k) => String(o.id || k) === activeId)
              const o = outfits[j] || outfits[0]
              return h('div', null,
                h('div', { style: Object.assign({}, S.row, { marginTop: '6px' }) },
                  h('select', {
                    'aria-label': '选择服装',
                    title: '选一套来编辑；字段只在下面显示',
                    value: activeId,
                    style: Object.assign({}, S.input, { maxWidth: '220px' }),
                    onChange: e => setOutfitPick(cur => Object.assign({}, cur, { [c.id]: e.target.value })),
                  }, outfits.map((item, k) => h('option', { key: item.id || k, value: String(item.id || k), style: { color: 'CanvasText', backgroundColor: 'Canvas' } },
                    (item.name || '（未命名服装）') + (item.default === true ? '（常穿）' : '') + (item.enabled === false ? '（已停用）' : '')))),
                  h('label', { style: S.row }, h('input', { type: 'radio', name: 'default-outfit-' + i, checked: o.default === true, onChange: () => patch(i, { outfits: outfits.map((x, k) => Object.assign({}, x, { default: k === j })) }) }), h('span', { style: { fontSize: '12px' } }, '常穿')),
                  h('label', { style: S.row }, h('input', { type: 'checkbox', checked: o.enabled !== false, onChange: e => patchOutfit(i, j, { enabled: e.target.checked }) }), h('span', { style: { fontSize: '12px' } }, '启用')),
                  h('button', { style: buttonStyle, onClick: () => { const next = outfits.slice(); next.splice(j, 1); setOutfitPick(cur => Object.assign({}, cur, { [c.id]: '' })); patch(i, { outfits: next }) } }, '删除这一套'),
                ),
                h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
                  h('input', { type: 'text', placeholder: '服装名（常服 / 居家 / 内衣…）', value: o.name || '', style: Object.assign({}, S.input, { width: '220px' }), onChange: e => patchOutfit(i, j, { name: e.target.value }) }),
                  h(ReferenceImageEditor, { key: 'outfit-reference-' + c.id + '-' + o.id, value: o, label: '服装「' + (o.name || '未命名') + '」', onChange: changes => patchOutfit(i, j, changes) }),
                  area('上衣', '', o.upper, v => patchOutfit(i, j, { upper: v }), 2),
                  area('下装', '', o.lower, v => patchOutfit(i, j, { lower: v }), 2),
                  h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
                    h('input', { type: 'text', placeholder: '鞋袜', value: o.shoes || '', style: S.input, onChange: e => patchOutfit(i, j, { shoes: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '配饰', value: o.accessory || '', style: S.input, onChange: e => patchOutfit(i, j, { accessory: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '整体印象（formal / casual…）', value: o.full || '', style: S.input, onChange: e => patchOutfit(i, j, { full: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '背面细节', value: o.back || '', style: S.input, onChange: e => patchOutfit(i, j, { back: e.target.value }) }),
                  ),
                  area('负面', '', o.negative, v => patchOutfit(i, j, { negative: v }), 2),
                ),
              )
            })(),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, onClick: () => patch(i, { outfits: outfits.concat([{ id: 'o' + Date.now(), name: '新服装', upper: '', lower: '', shoes: '', accessory: '', full: '', back: '', negative: '', enabled: true, default: outfits.length === 0 }]) }) }, '新增服装'),
              h('button', { style: buttonStyle, onClick: () => setOutfitCopy(current => current.target === c.id ? { target: '', source: '', picked: [] } : { target: c.id, source: '', picked: [], mode: 'whole', parts: {} }) }, outfitCopy.target === c.id ? '收起复制' : '从其他角色复制服装'),
            ),
            outfitCopy.target === c.id ? outfitCopyPanel(c, i) : null,
          )
        }
        /**
         * 从另一位角色复制服装到当前角色，两种方式：
         * - 整套：勾一套、几套或全选，复制成新服装（新编号、不抢常穿，同名加「（复制）」）。
         * - 按部位：从一套或几套里勾上衣/下装/鞋袜等部位，拼成一套新服装，或放进当前角色已有的某一套（覆盖或追加）。
         * 复制品都是独立的一份；改完要点「保存人物库」。
         */
        function outfitCopyPanel(c, i) {
          const PARTS = [['upper', '上衣'], ['lower', '下装'], ['shoes', '鞋袜'], ['accessory', '配饰'], ['full', '整体'], ['back', '背面'], ['negative', '负面']]
          const cp = outfitCopy
          const sources = characters.filter(person => person.id !== c.id && (person.outfits || []).length)
          const source = sources.find(person => person.id === cp.source) || null
          const list = source ? (source.outfits || []) : []
          const mode = cp.mode === 'parts' ? 'parts' : 'whole'
          const set = changes => setOutfitCopy(current => Object.assign({}, current, changes))
          const close = () => setOutfitCopy({ target: '', source: '', picked: [] })
          const own = c.outfits || []
          const small = Object.assign({}, buttonStyle, { fontSize: '12px' })
          const valueOf = (o, key) => String((key === 'upper' ? (o.upper || o.body) : o[key]) || '').trim()

          // —— 整套 ——
          const picked = new Set(cp.picked || [])
          const chosen = list.filter(o => picked.has(o.id))
          const copyWhole = () => {
            if (!chosen.length) return
            patch(i, person => {
              const mine = person.outfits || []
              const names = new Set(mine.map(o => String(o.name || '')))
              const stamp = Date.now()
              const added = chosen.map((o, k) => {
                let name = String(o.name || '服装')
                while (names.has(name)) name += '（复制）'
                names.add(name)
                return Object.assign({}, o, { id: 'o' + stamp + k + Math.random().toString(36).slice(2, 6), name, default: mine.length === 0 && k === 0 })
              })
              return { outfits: mine.concat(added) }
            })
            close()
          }

          // —— 按部位 ——
          const parts = cp.parts || {}
          const partOn = (oid, key) => (parts[oid] || []).includes(key)
          const togglePart = (oid, key, on) => {
            const next = new Set(parts[oid] || [])
            if (on) next.add(key); else next.delete(key)
            set({ parts: Object.assign({}, parts, { [oid]: PARTS.map(([k]) => k).filter(k => next.has(k)) }) })
          }
          const setOutfitParts = (o, on) => set({ parts: Object.assign({}, parts, { [o.id]: on ? PARTS.map(([k]) => k).filter(k => valueOf(o, k)) : [] }) })
          // 收集选中的部位：同一部位从几套里都勾了，就按套的顺序用逗号拼起来
          const gathered = {}
          for (const o of list) for (const [key] of PARTS) if (partOn(o.id, key) && valueOf(o, key)) (gathered[key] = gathered[key] || []).push(valueOf(o, key))
          const gatheredKeys = PARTS.map(([k]) => k).filter(k => gathered[k])
          const dest = own.some(o => o.id === cp.dest) ? cp.dest : 'new'
          const merge = cp.merge === 'append' ? 'append' : 'replace'
          const copyParts = () => {
            if (!gatheredKeys.length) return
            const values = {}
            for (const key of gatheredKeys) values[key] = gathered[key].join(', ')
            patch(i, person => {
              const mine = person.outfits || []
              if (dest === 'new') {
                const names = new Set(mine.map(o => String(o.name || '')))
                let name = String(cp.newName || '').trim() || '拼搭服装'
                while (names.has(name)) name += '（复制）'
                const blank = { name, upper: '', lower: '', shoes: '', accessory: '', full: '', back: '', negative: '', enabled: true, default: mine.length === 0 }
                return { outfits: mine.concat([Object.assign(blank, values, { id: 'o' + Date.now() + Math.random().toString(36).slice(2, 6) })]) }
              }
              return { outfits: mine.map(o => {
                if (o.id !== dest) return o
                const next = Object.assign({}, o)
                for (const key of gatheredKeys) {
                  const old = valueOf(o, key)
                  next[key] = merge === 'append' && old ? old + ', ' + values[key] : values[key]
                }
                return next
              }) }
            })
            close()
          }

          const tab = (value, label) => h('button', { style: Object.assign({}, small, mode === value ? { borderColor: '#6aa8ff', color: '#cfe1ff' } : {}), 'aria-pressed': mode === value, onClick: () => set({ mode: value }) }, label)
          return h('div', { 'aria-label': '复制服装', style: { marginTop: '8px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(120,140,170,.2)' } },
            h('div', { style: S.row },
              h('span', { style: S.label }, '从谁那里复制'),
              h('select', {
                'aria-label': '复制服装的来源角色',
                value: cp.source,
                style: Object.assign({}, S.input, { maxWidth: '220px' }),
                onChange: e => set({ source: e.target.value, picked: [], parts: {} }),
              }, [h('option', { key: '', value: '', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, sources.length ? '选择角色' : '没有其他带服装的角色')].concat(
                sources.map(person => h('option', { key: person.id, value: person.id, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, (person.name || '未命名角色') + '（' + (person.outfits || []).length + ' 套）')))),
              tab('whole', '整套复制'),
              tab('parts', '按部位复制'),
            ),
            source && mode === 'whole' ? h('div', null,
              h('div', { style: S.row },
                h('button', { style: small, onClick: () => set({ picked: list.map(o => o.id) }) }, '全选'),
                h('button', { style: small, onClick: () => set({ picked: [] }) }, '全不选'),
              ),
              h('div', { style: { maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' } },
                list.map(o => h('label', { key: o.id, style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', padding: '4px 6px', borderRadius: '6px', cursor: 'pointer', background: picked.has(o.id) ? 'rgba(106,168,255,.14)' : 'transparent' } },
                  h('input', { type: 'checkbox', checked: picked.has(o.id), onChange: e => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(o.id); else next.delete(o.id)
                    set({ picked: list.filter(x => next.has(x.id)).map(x => x.id) })
                  } }),
                  h('span', null, o.name || '未命名服装'),
                  h('span', { style: { color: '#9aa3b2' } }, [valueOf(o, 'upper'), valueOf(o, 'lower')].filter(Boolean).join(' / ').slice(0, 60)),
                )),
              ),
              h('div', { style: S.row },
                h('button', { style: buttonStyle, disabled: !chosen.length, onClick: copyWhole }, chosen.length ? '复制这 ' + chosen.length + ' 套到「' + (c.name || '当前角色') + '」' : '先勾选要复制的服装'),
              ),
            ) : null,
            source && mode === 'parts' ? h('div', null,
              h('div', { style: { maxHeight: '320px', overflowY: 'auto', marginTop: '6px' } },
                list.map(o => {
                  const filled = PARTS.filter(([k]) => valueOf(o, k))
                  const all = filled.length && filled.every(([k]) => partOn(o.id, k))
                  return h('div', { key: o.id, 'aria-label': '部位-' + (o.name || o.id), style: { padding: '6px', borderTop: '1px solid #3a4150' } },
                    h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 600 } },
                      h('input', { type: 'checkbox', 'aria-label': '整套部位-' + (o.name || o.id), checked: Boolean(all), onChange: e => setOutfitParts(o, e.target.checked) }),
                      h('span', null, o.name || '未命名服装'),
                    ),
                    filled.map(([key, label]) => h('label', { key, style: { display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', padding: '2px 0 2px 22px' } },
                      h('input', { type: 'checkbox', 'aria-label': (o.name || o.id) + '-' + label, checked: partOn(o.id, key), onChange: e => togglePart(o.id, key, e.target.checked) }),
                      h('span', { style: { minWidth: '34px', color: '#9aa3b2' } }, label),
                      h('span', null, valueOf(o, key).slice(0, 90)),
                    )),
                  )
                }),
              ),
              h('div', { style: S.row },
                h('span', { style: S.label }, '放到哪里'),
                h('select', {
                  'aria-label': '部位复制的目标服装',
                  value: dest,
                  style: Object.assign({}, S.input, { maxWidth: '220px' }),
                  onChange: e => set({ dest: e.target.value }),
                }, [h('option', { key: 'new', value: 'new', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '新建一套')].concat(
                  own.map(o => h('option', { key: o.id, value: o.id, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '放进「' + (o.name || '未命名服装') + '」')))),
                dest === 'new'
                  ? h('input', { type: 'text', 'aria-label': '新服装名', placeholder: '新服装名（默认：拼搭服装）', value: cp.newName || '', style: Object.assign({}, S.input, { width: '180px' }), onChange: e => set({ newName: e.target.value }) })
                  : h('select', { 'aria-label': '部位合并方式', value: merge, style: Object.assign({}, S.input, { maxWidth: '200px' }), onChange: e => set({ merge: e.target.value }) },
                      h('option', { value: 'replace', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '覆盖这些部位'),
                      h('option', { value: 'append', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '追加在原内容后面')),
              ),
              h('div', { style: S.row },
                h('button', { style: buttonStyle, disabled: !gatheredKeys.length, onClick: copyParts },
                  gatheredKeys.length ? '复制 ' + gatheredKeys.length + ' 个部位' + (dest === 'new' ? '为新服装' : '到这套') : '先勾选要复制的部位'),
              ),
            ) : null,
            h('div', { style: { fontSize: '11px', color: '#9aa3b2', marginTop: '6px' } }, '复制后是各自独立的一份，改这边不影响原来那位；记得点「保存人物库」'),
          )
        }
        return h('div', null,
          // 设计完成的提醒：放在 tab 顶部，面板关着也看得见
          designDone ? h('div', { style: { margin: '0 0 10px', padding: '14px 16px', borderRadius: '12px', background: 'linear-gradient(180deg,color-mix(in srgb, var(--dsw-alias-state-warning-primary) 22%, transparent),color-mix(in srgb, var(--dsw-alias-state-warning-primary) 12%, transparent))', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 65%, transparent)', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
            h('div', { style: { fontSize: '14px', color: saveState.startsWith('failed') ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warning-primary)', fontWeight: 600, flex: 1, minWidth: '180px' } },
              saveState === 'saving' ? '⏳ 正在保存…'
                : saveState === 'saved' ? '💾 已保存到 definitions.json'
                : saveState.startsWith('failed') ? ('❌ 保存失败：' + saveState.slice(7))
                : ('✅ ' + designDone)),
            h('button', { style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 80%, transparent)', background: 'linear-gradient(180deg,var(--dsw-alias-state-warning-primary),var(--dsw-alias-state-warning-primary))', color: 'var(--dsw-alias-label-primary)', fontWeight: 600, padding: '8px 22px', fontSize: '14px' }), onClick: () => { commit(true).then(saved => { if (saved) setDesignDone('') }) } }, '💾 保存人物库'),
            h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: () => setDesignDone('') }, '知道了'),
        ) : null,
          h('div', { style: S.card },
            h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '人物设计（' + characters.length + ' 个角色）'),
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } }, '填了名字 + 五官 + 体态的角色，会作为「可用角色清单」交给规划模型；正文里出现这个名字时，这些内容会自动补齐，所以不会换脸。'),
          h('div', { style: Object.assign({}, S.row, { alignItems: 'stretch' }) },
            h('input', { type: 'search', 'aria-label': '搜索角色', value: peopleSearch, placeholder: '搜索中文名或英文触发名', style: Object.assign({}, S.input, { flex: '1 1 220px', minWidth: '180px' }), onChange: event => setPeopleSearch(event.target.value) }),
            h('select', { 'aria-label': '当前角色', value: activeCharacter?.id || '', style: Object.assign({}, S.input, { flex: '1 1 220px', minWidth: '180px' }), onChange: event => { setPeopleActiveId(event.target.value); setPeopleEditorOpen(true) } },
              activeCharacter ? sectionsOf(filteredCharacters).map(([section, list]) => h('optgroup', { key: section, label: section },
                list.map(character => h('option', { key: character.id, value: character.id, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, (character.group ? '[' + character.group + '] ' : '') + (character.name || '（未命名角色）') + (character.match ? ' · ' + character.match : ''))))) : h('option', { value: '', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '没有匹配的角色'),
            ),
            h('select', { 'aria-label': '按卡筛选人物', title: '只看某张卡能用到的人物（未绑定卡的人对所有卡都生效，总会列出来）', value: cardFilter, style: Object.assign({}, S.input, { flex: '0 1 200px', minWidth: '150px' }), onChange: event => setPeopleCardFilter(event.target.value) },
              h('option', { value: 'all', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '全部卡'),
              currentCardPath ? h('option', { value: currentCardPath, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '当前卡：' + cardTitle(currentCardPath)) : null,
              importCards.filter(item => item.path !== currentCardPath).map(item => h('option', { key: item.path, value: item.path, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, item.label)),
              h('option', { value: '__unbound', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '只看未绑定的'),
            ),
            h('button', { style: buttonStyle, onClick: () => setPeopleEditorOpen(open => !open) }, peopleEditorOpen ? '收起编辑' : '展开编辑'),
          ),
          h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
            h('button', { style: buttonStyle, onClick: addCharacter }, '新增角色'),
            importCards.length ? h('select', {
              'aria-label': '选择要导入的卡',
              title: '选哪张卡，就导入哪张卡的人物',
              value: importCard,
              style: Object.assign({}, S.input, { maxWidth: '200px' }),
              onChange: event => setImportCard(event.target.value),
            }, importCards.map(item => h('option', { key: item.path, value: item.path, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, item.label))) : null,
            h('button', { style: buttonStyle, onClick: importFromCard }, '从选定的卡导入'),
            h('button', { style: buttonStyle, disabled: !activeCharacter, onClick: () => copyCharacter(activeCharacter) }, '复制当前角色'),
            h('button', { style: buttonStyle, disabled: !activeCharacter, onClick: () => activeCharacter && pickPhoto(activeCharacter) }, '从照片识别'),
            h('button', { style: buttonStyle, onClick: designPeople }, '让 agent 设计角色'),
            h('button', { style: buttonStyle, onClick: () => setPeopleOverviewOpen(open => !open) }, peopleOverviewOpen ? '收起概览' : '概览'),
            h('button', { style: buttonStyle, onClick: () => setPeopleTidyOpen(open => !open) }, peopleTidyOpen ? '收起整理' : '整理'),
            h('button', { style: buttonStyle, disabled: saveState === 'saving', onClick: () => commit(false) }, saveState === 'saving' ? '正在保存…' : '保存人物库'),
            h('button', { style: buttonStyle, onClick: () => setPeopleBatchOpen(current => !current) }, peopleBatchOpen ? '收起批量编辑' : '批量编辑'),
            h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '已选 ' + picked.length + ' / ' + characters.length + ' 位'),
          ),
          importPreviewPanel(),
          peopleTidyOpen ? tidyPanel() : null,
          peopleOverviewOpen ? overviewPanel() : null,
          designPanel(),
          batchPanel(),
          !designOpen && designNote ? h('div', { role: 'status', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } }, designNote) : null,
          characters.length && !activeCharacter ? h('div', { role: 'status', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '10px 0' } }, '没有匹配的角色，请调整搜索词。') : null,
          !characters.length ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '还没有角色，点上方「新增角色」。') : null,
          activeCharacter ? characterBlock(activeCharacter, activeIndex) : null,
          h('div', { style: S.row },
            h('span', { role: 'status', style: { fontSize: '12px', color: saveState.startsWith('failed') ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' } }, saveState.startsWith('failed') ? '保存失败，请重试' : libraryDirty.current ? '有未保存修改' : saveState === 'saved' ? '人物库已保存' : '改完记得点保存'),
          ),
          ),
          h('div', { style: S.card },
            h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '通用服装库（可跨角色复用）'),
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } }, '这里放"办公室职业装""居家睡衣"这类通用套装；在角色那边勾上，他就能穿。'),
            // 下拉选一套来编辑：套装多时不再每套铺一张卡
            (() => {
              const list = data.outfits || []
              if (!list.length) return h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', margin: '8px 0' } }, '还没有套装，点下面「新增套装」。')
              const activeId = libraryActive && list.some((o, j) => String(o.id || j) === libraryActive) ? libraryActive : String(list[0].id || 0)
              const idx = list.findIndex((o, j) => String(o.id || j) === activeId)
              const o = list[idx] || list[0]
              const patchLib = (changes) => {
                const current = dataRef.current
                const next = (current.outfits || []).map(item => item.id === o.id ? Object.assign({}, item, changes) : item)
                setLibraryData(Object.assign({}, current, { outfits: next }))
              }
              return h('div', null,
                h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
                  h('select', {
                    'aria-label': '选择套装',
                    title: '选一套来编辑；字段只在下面这一块显示',
                    value: activeId,
                    style: Object.assign({}, S.input, { maxWidth: '240px' }),
                    onChange: e => setLibraryActive(e.target.value),
                  }, list.map((item, k) => h('option', { key: item.id || k, value: String(item.id || k), style: { color: 'CanvasText', backgroundColor: 'Canvas' } },
                    (item.name || '（未命名套装）') + (item.enabled === false ? '（已停用）' : '')))),
                  h('label', { style: S.row }, h('input', { type: 'checkbox', checked: o.enabled !== false, onChange: e => patchLib({ enabled: e.target.checked }) }), h('span', { style: { fontSize: '12px' } }, '启用')),
                  h('button', { style: buttonStyle, onClick: () => { const next = list.slice(); next.splice(idx, 1); setLibraryActive(''); setLibraryData(Object.assign({}, dataRef.current, { outfits: next })) } }, '删除这一套'),
                ),
                h('div', { style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
                  h('input', { type: 'text', placeholder: '套装名（办公室职业装 / 居家睡衣…）', value: o.name || '', style: Object.assign({}, S.input, { width: '240px' }), onChange: e => patchLib({ name: e.target.value }) }),
                  h(ReferenceImageEditor, { key: 'shared-reference-' + o.id, value: o, label: '通用服装「' + (o.name || '未命名') + '」', onChange: patchLib }),
                  h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' } },
                    h('input', { type: 'text', placeholder: '上衣', value: o.upper || o.body || '', style: S.input, onChange: e => patchLib({ upper: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '下装', value: o.lower || '', style: S.input, onChange: e => patchLib({ lower: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '鞋袜', value: o.shoes || '', style: S.input, onChange: e => patchLib({ shoes: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '整体（formal / casual…）', value: o.full || '', style: S.input, onChange: e => patchLib({ full: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '配饰', value: o.accessory || '', style: S.input, onChange: e => patchLib({ accessory: e.target.value }) }),
                    h('input', { type: 'text', placeholder: '背面细节', value: o.back || '', style: S.input, onChange: e => patchLib({ back: e.target.value }) }),
                  ),
                ),
              )
            })(),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, onClick: () => setLibraryData(Object.assign({}, dataRef.current, { outfits: (data.outfits || []).concat([{ id: 'of' + Date.now(), name: '新套装', upper: '', lower: '', shoes: '', accessory: '', full: '', back: '', negative: '', enabled: true }]) })) }, '新增套装'),
              h('button', { style: buttonStyle, onClick: () => commit() }, '保存服装库'),
              h('button', { style: buttonStyle, title: '把角色库、两本世界书、渠道配置、历史记录打包成一个 JSON', onClick: exportAllData }, '导出全部数据'),
              h('button', { style: buttonStyle, title: '从备份 JSON 恢复；会先自动备份当前数据', onClick: importAllData }, '导入全部数据'),
            ),
          ),
        )
      }
      /** 把全部数据导出成一个 JSON 文件（六份数据，含渠道配置） */
      async function exportAllData() {
        try {
          setNote('正在打包数据…')
          const r = await post('/export-all', {})
          if (!r?.ok || !r.bundle) throw new Error(r?.error || '导出失败')
          const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
          const url = URL.createObjectURL(new Blob([JSON.stringify(r.bundle, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a')
          link.href = url
          link.download = 'dsh-tavern-image-' + stamp + '.json'
          link.click()
          URL.revokeObjectURL(url)
          const c = r.bundle.counts || {}
          const msg = '已导出：角色 ' + (c.characters || 0) + ' 个、服装 ' + (c.outfits || 0) + ' 套、规则 ' + (c.worldbook || 0) + ' 条、服装规则 ' + (c.worldbookOutfits || 0) + ' 条'
          setNote(msg + '（图片本体不在包里）')
          if (typeof showToast === 'function') showToast(msg)
        } catch (error) {
          const msg = '导出失败：' + (error?.message ?? error)
          setNote(msg)
          if (typeof showToast === 'function') showToast(msg, 'fail')
        }
      }

      /** 选一个备份 JSON 导入，写回六份数据（不碰任何代码） */
      async function importAllData() {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = async () => {
          const file = input.files && input.files[0]
          if (!file) return
          if (!confirm('导入会用备份里的数据覆盖当前的角色库、两本世界书、渠道配置与历史记录。\n当前数据会先自动备份一份。要继续吗？')) return
          try {
            setNote('正在导入…')
            const text = await file.text()
            let bundle = null
            try { bundle = JSON.parse(text) } catch { throw new Error('文件不是合法 JSON') }
            const r = await post('/import-all', { bundle })
            if (!r?.ok) throw new Error(r?.error || r?.refused || '导入失败')
            if (r?.state) receiveState(r.state)
            const msg = '已导入：' + (r.written || []).join('、') + (r.skipped && r.skipped.length ? '（跳过：' + r.skipped.join('、') + '）' : '')
            setNote(msg + (r.note ? '。' + r.note : ''))
            if (typeof showToast === 'function') showToast(msg)
            const fresh = await post('/state', {}).catch(() => null)
            if (fresh) receiveState(fresh)
          } catch (error) {
            const msg = '导入失败：' + (error?.message ?? error)
            setNote(msg)
            if (typeof showToast === 'function') showToast(msg, 'fail')
          }
        }
        input.click()
      }

      /** 批量删除历史图。 */
      async function deleteJobBatch(ids) {
        const list = (Array.isArray(ids) ? ids : []).filter(Boolean)
        if (!list.length) { if (typeof showToast === 'function') showToast('没有选中任何图', 'fail'); return }
        if (!confirm('删除选中的 ' + list.length + ' 张图？对话里挂着的同一张也会一起删掉。')) return
        let ok = 0
        for (const id of list) {
          try {
            const r = await post('/delete-job', { jobId: String(id) })
            if (r?.ok) ok++
          } catch {}
        }
        const gone = new Set(list)
        setHistoryJobs(cur => (cur || []).filter(j => !gone.has(String(j.id))))
        setGalleryPicked({})
        if (typeof showToast === 'function') showToast('已删除 ' + ok + ' / ' + list.length + ' 张' + (ok === list.length ? '' : '（有些没删掉）'), ok === list.length ? 'ok' : 'fail')
      }

      /** 删除一张历史图（连带缓存文件、计划里的引用和对话里挂着的那张）。 */
      async function deleteJob(jobId) {
        if (!jobId) return
        if (!confirm('删除这张图？对话里挂着的同一张也会一起删掉。')) return
        try {
          const r = await post('/delete-job', { jobId: String(jobId) })
          if (!r?.ok) { if (typeof showToast === 'function') showToast('删除失败：' + (r?.error || ''), 'fail'); return }
          setHistoryJobs(list => (list || []).filter(j => String(j.id) !== String(jobId)))
          if (typeof showToast === 'function') showToast('已删除')
        } catch (error) {
          if (typeof showToast === 'function') showToast('删除失败：' + (error?.message ?? error), 'fail')
        }
      }

      /** 工作流：导入、查看、LoRA 管理。 */
      function workflowCard() {
        const list = data.workflows || []
        // 判定"读到的详情是不是当前这张"：file 或 id 任一匹配即可（file 由前端补进来）
        const detail = (wfDetail && (String(wfDetail.file ?? '') === String(wfOpen) || String(wfDetail.__id ?? '') === String(wfOpen))) ? wfDetail : null

        async function openWorkflow(file, force = false) {
          if (!force && wfOpen === file) { setWfOpen(''); setWfDetail(null); return }
          setWfOpen(file); setWfDetail(null); setWfNote('读取中…')
          try {
            const r = await post('/workflow-bindings', { file })
            if (!r?.ok) { setWfNote('读失败：' + (r?.error || '')); return }
            // 工作流对象本身没有 file 字段，判定"读的是哪张"要靠它，补进来
            setWfDetail(Object.assign({}, r.workflow, { file }))
            setWfNote('')
            // 读出这张工作流的可编辑参数（失败要把原因显示出来，不能静默）
            const baseName = String(file).split(/[\\/]/).pop()
            try {
              const v = await post('/workflow-values', { file: baseName })
              if (v?.ok) setWfValues(Object.assign({}, v.values, { __file: baseName }))
              else setWfValues({ __file: baseName, __error: String(v?.error || '接口没返回数据') })
            } catch (e) {
              setWfValues({ __file: baseName, __error: String(e?.message ?? e) })
            }
            // 顺手把 ComfyUI 的 LoRA 名单拉一次，展开后下拉框直接可选
            jsonFetch(BASE + '/loras-available', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
              .then(x => { if (x?.ok && (x.loras || []).length) setLoraList(x.loras) })
              .catch(() => {})
          } catch (e) { setWfNote('读失败：' + (e?.message ?? e)) }
        }

        async function patchLora(node, patch) {
          if (!detail) return
          const loras = (detail.bindings?.loras ?? []).map(x => String(x.node) === String(node) ? Object.assign({}, x, patch) : x)
          setWfDetail(Object.assign({}, detail, { file: detail.file, bindings: Object.assign({}, detail.bindings, { loras }) }))
          try {
            const r = await post('/workflow-bindings', { file: detail.file ?? wfOpen, patch: { loras: [{ node, ...patch }] } })
            if (!r?.ok) setWfNote('保存失败：' + (r?.error || ''))
            else setWfNote('已保存')
          } catch (e) { setWfNote('保存失败：' + (e?.message ?? e)) }
        }

        /** 保存简单编辑的参数值。 */
        async function saveWfValues() {
          if (!wfValues) return
          const v = wfValues
          const payload = {}
          if (v.positive !== undefined) payload.positive = String(v.positive)
          if (v.negative !== undefined) payload.negative = String(v.negative)
          const w = Number(v.width), hgt = Number(v.height), st = Number(v.steps), cf = Number(v.cfg)
          if (Number.isFinite(w)) payload.width = w
          if (Number.isFinite(hgt)) payload.height = hgt
          if (Number.isFinite(st)) payload.steps = st
          if (Number.isFinite(cf)) payload.cfg = cf
          if (v.model !== undefined) payload.model = String(v.model)
          try {
            const r = await post('/workflow-values', { file: v.__file, values: payload })
            if (!r?.ok) { setWfNote('保存失败：' + (r?.error || '')); return }
            setWfNote('✓ 已保存（' + (r.changed || []).join('、') + '）')
            if (typeof showToast === 'function') showToast('工作流参数已保存')
            const st2 = await jsonFetch(BASE + '/state', { cache: 'no-store' }).catch(() => null)
            if (st2) receiveState(st2)
          } catch (e) { setWfNote('保存失败：' + (e?.message ?? e)) }
        }

        /** 试跑一张：真正调 ComfyUI 跑一次，这是"能不能用"最直接的验证。 */
        async function testWorkflow(wf) {
          setWfTestNote('正在跑…（大约 10~60 秒）')
          setWfTestJob('')
          try {
            const r = await post('/workflow-test', { file: wf.file, id: wf.id })
            if (!r?.ok) { setWfTestNote('✗ 跑不了：' + (r?.error || '')); return }
            setWfTestJob(r.jobId)
            setWfTestNote('已提交，正在等出图…')
            // 轮询到出图为止
            const t0 = Date.now()
            while (Date.now() - t0 < 180000) {
              await new Promise(res => setTimeout(res, 2500))
              const s = await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(r.jobId), { cache: 'no-store' }).catch(() => null)
              const st = s?.job?.status
              if (st === 'done') {
                setWfTestNote('✓ 这张工作流可用！')
                if (typeof showToast === 'function') showToast('✓ 工作流可用，已出图')
                if (typeof openImageOverlay === 'function') openImageOverlay({ open: true, jobIds: [r.jobId], note: '试跑：' + (wf.label || wf.id), working: false })
                break
              }
              if (st === 'failed') { setWfTestNote('✗ 出图失败：' + String(s?.job?.error || '未知原因').slice(0, 300)); return }
              setWfTestNote('正在画… ' + String(s?.job?.percent ?? '') + '%')
            }
          } catch (e) { setWfTestNote('✗ 出错：' + (e?.message ?? e)) }
        }

        /** 改一条绑定（正面/负面/尺寸/步数/底模 用哪个节点）。 */
        async function patchBind(key, node, input) {
          if (!detail) return
          const next = Object.assign({}, detail.bindings, { [key]: node ? [{ node: String(node), input: String(input ?? 'text') }] : [] })
          setWfDetail(Object.assign({}, detail, { file: detail.file, bindings: next }))
          try {
            const r = await post('/workflow-bindings', { file: detail.file ?? wfOpen, patch: { bindings: { [key]: node ? [{ node: String(node), input: String(input ?? 'text') }] : [] } } })
            setWfNote(r?.ok ? '绑定已保存' : ('保存失败：' + (r?.error || '')))
          } catch (e) { setWfNote('保存失败：' + (e?.message ?? e)) }
        }

        async function patchReferenceBindings(bindings) {
          if (!detail) return
          const next = Object.assign({}, detail.bindings || {}, { referenceImages: bindings })
          setWfDetail(Object.assign({}, detail, { bindings: next }))
          try {
            const r = await post('/workflow-bindings', { file: detail.file ?? wfOpen, patch: { bindings: { referenceImages: bindings } } })
            setWfNote(r?.ok ? '参考图接入顺序已保存' : ('保存失败：' + (r?.error || '')))
          } catch (e) { setWfNote('保存失败：' + (e?.message ?? e)) }
        }

        async function loadLoraNames() {
          const r = await jsonFetch(BASE + '/loras-available', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
          if (r?.ok) { setLoraList(r.loras ?? []); setWfNote(r.loras?.length ? ('读到 ' + r.loras.length + ' 个已安装的 LoRA') : '没读到 LoRA 列表（ComfyUI 开了吗）') }
        }

        async function doImport(text) {
          try {
            let payload = text
            try { payload = JSON.parse(text) } catch { setWfNote('不是合法 JSON'); return }
            const r = await post('/workflow-import', { workflow: payload, name: '' })
            if (!r?.ok) { setWfNote('导入失败：' + (r?.error || '')); return }
            setWfNote('✓ 已导入《' + r.name + '》节点 ' + r.nodes + ' 个，识别到：正面 ' + r.bindings.positive + ' / 负面 ' + r.bindings.negative + ' / 尺寸 ' + r.bindings.size + ' / 步数 ' + r.bindings.steps + ' / 底模 ' + r.bindings.model + ' / LoRA ' + r.bindings.loras)
            setWfImportOpen(false); setWfPaste('')
            const st = await jsonFetch(BASE + '/state', { cache: 'no-store' }).catch(() => null)
            if (st) receiveState(st)
            if (typeof showToast === 'function') showToast('已导入工作流《' + r.name + '》，识别到 ' + r.bindings.loras + ' 个 LoRA')
          } catch (e) { setWfNote('导入失败：' + (e?.message ?? e)) }
        }
        function pickWfFile(event) {
          const file = event?.target?.files && event.target.files[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => doImport(String(reader.result || ''))
          reader.onerror = () => setWfNote('读文件失败')
          reader.readAsText(file)
        }

        const ta = Object.assign({}, S.input, { width: '100%', minHeight: '110px', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '11px', lineHeight: '1.5', resize: 'vertical', boxSizing: 'border-box' })

        return h('div', { style: S.card },
          (config.comfyMode === 'simple' || data.configurationWarning) ? h('div', { role: 'status', style: { padding: '10px 12px', marginBottom: '12px', borderRadius: '9px', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary) 45%, transparent)', color: 'var(--dsw-alias-state-warning-primary)' } },
            h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, data.configurationWarning || '旧版简易模式已停止；原设置数据仍保留。'),
            h('div', { style: { fontSize: '12px', marginBottom: '8px' } }, '导入完整 ComfyUI API 工作流或先选择一张可用工作流，再启用工作流模式。旧的简易模式参数不会删除。'),
            h('button', { type: 'button', disabled: !list.some(wf => !wf.error && wf.enabled !== false), onClick: async () => {
              const chosen = list.find(wf => wf.id === config.defaultWorkflow && !wf.error && wf.enabled !== false) || list.find(wf => !wf.error && wf.enabled !== false)
              if (!chosen) return
              await save({ comfyMode: 'workflow', defaultWorkflow: chosen.id })
            } }, '启用选定的完整工作流')) : null,
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '工作流（' + list.length + ' 张）'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } },
            '从 ComfyUI 导出「API 格式」的 JSON 就能导进来，插件会自动认出正负面提示词、尺寸、步数、底模和 LoRA。',
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-brand-primary)', marginBottom: '10px' } },
              '导入后点它右边的「设为默认」，之后生成就用这张了。当前：' + (function () {
                const cur = (data.workflows || []).find(w => w.current)
                return cur ? '《' + (cur.label || cur.id) + '》' : '（没选，用第一张可用的）'
              })())),
          h('div', { style: S.row },
            h('button', { style: buttonStyle, onClick: () => setWfImportOpen(v => !v) }, wfImportOpen ? '✖ 收起导入' : '📥 导入工作流'),
            h('button', { style: buttonStyle, onClick: async () => { const r = await post('/reload', {}); if (r?.state) receiveState(r.state); setWfNote('已重新扫描') } }, '🔄 重新扫描'),
            h('button', { style: buttonStyle, onClick: loadLoraNames }, '🧩 读 ComfyUI 的 LoRA 列表'),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } },
              h('input', { type: 'checkbox', checked: Boolean(config.lockWorkflow), onChange: e => save({ lockWorkflow: e.target.checked }) }),
              '锁定（不管别处选什么都用这张）'),
            wfNote ? h('span', { style: { fontSize: '12px', color: /失败|不是/.test(wfNote) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-tertiary)' } }, wfNote) : null,
          ),

          wfImportOpen ? h('div', { style: { marginTop: '10px', padding: '12px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)' } },
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
              '在 ComfyUI 里用「工作流 → 导出（API）」，或用 Save (API Format) 得到 JSON；也可以直接把 JSON 粘在下面。'),
            h('div', { style: S.row },
              h('label', { style: { padding: '6px 14px', fontSize: '12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent)', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' } },
                '📁 选 JSON 文件',
                h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: pickWfFile }),
              ),
            ),
            h('textarea', { value: wfPaste, placeholder: '粘贴 ComfyUI 的 API 格式 JSON…', style: Object.assign({}, ta, { marginTop: '8px' }), onChange: e => setWfPaste(e.target.value) }),
            h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
              h('button', { style: buttonStyle, onClick: () => doImport(wfPaste) }, '导入这段 JSON'),
              h('button', { style: buttonStyle, onClick: () => { setWfPaste(''); setWfNote('') } }, '清空'),
            ),
          ) : null,

          h('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
            list.length ? list.map(wf => {
              const isOpen = String(wf.file ?? '') === String(wfOpen)
              const sum = wf.summary || {}
              return h('div', { key: wf.id, style: { borderRadius: '10px', border: isOpen ? '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', padding: '10px 12px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: '13px', fontWeight: 600, flex: 1, minWidth: '140px' } },
                    wf.label || wf.id || '(无名)',
                    wf.current ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-success-primary)', marginLeft: '8px' } }, '← 正在使用') : null,
                    wf.error ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)', marginLeft: '8px' } }, '（不可用）') : null),
                  wf.current
                    ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-success-primary)', padding: '3px 8px', borderRadius: '7px', background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)' } }, '✓ 正在用这张')
                    : h('button', {
                        style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 12px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, transparent)', color: 'var(--dsw-alias-state-success-primary)' }),
                        title: '之后的生成都用这张工作流',
                        onClick: async () => {
                          if (wf.error) { if (typeof showToast === 'function') showToast('这张工作流不可用：' + wf.error, 'fail'); return }
                          await save({ defaultWorkflow: wf.id, lockWorkflow: true })
                          if (typeof showToast === 'function') showToast('已切换：之后的生成用《' + (wf.label || wf.id) + '》')
                        },
                      }, '设为默认'),
                  h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 12px' }), onClick: () => openWorkflow(wf.file) }, isOpen ? '△ 收起' : '✏️ 编辑 / LoRA'),
                  h('button', { type: 'button', 'aria-label': '可视化编辑 ' + (wf.label || wf.id), style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 12px', borderColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent)', color: 'var(--dsw-alias-brand-primary)' }), onClick: () => setWfGraphFile(wf.file) }, '可视化编辑'),
                  h('button', {
                    style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 12px' }),
                    title: '重命名这张',
                    onClick: async () => {
                      const name = prompt('这张工作流叫什么？', wf.label || wf.id)
                      if (name === null) return
                      try {
                        const r = await post('/workflow', { id: wf.id, label: String(name).slice(0, 80) })
                        if (r?.state) receiveState(r.state)
                        if (typeof showToast === 'function') showToast('已改名')
                      } catch (e) { if (typeof showToast === 'function') showToast('改名失败：' + (e?.message ?? e), 'fail') }
                    },
                  }, '改名'),
                  h('button', {
                    style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 12px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }),
                    title: '删除工作流及磁盘文件',
                    onClick: async () => {
                      if (!confirm('删除《' + (wf.label || wf.id) + '》？这会同时删除工作流列表项和 workflows/ 中的 JSON 文件。')) return
                      try {
                        const r = await post('/workflow', { id: wf.id, remove: true })
                        if (r?.state) receiveState(r.state)
                        if (typeof showToast === 'function') showToast('已删除')
                      } catch (e) { if (typeof showToast === 'function') showToast('删除失败：' + (e?.message ?? e), 'fail') }
                    },
                  }, '移除'),
                ),
                h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } },
                  (sum.model ? '底模 ' + sum.model + '　' : '') +
                  (sum.base ? '尺寸 ' + sum.base + '　' : '') +
                  (sum.nodeCount ? sum.nodeCount + ' 节点　' : '') +
                  ((sum.loras || []).length ? (sum.loras || []).length + ' 个 LoRA' : '')),
                (sum.positivePeek || sum.negativePeek) ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '3px', fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  (sum.positivePeek ? '＋ ' + sum.positivePeek : '') + (sum.negativePeek ? '　－ ' + sum.negativePeek : '')) : null,
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '3px' } },
                  '点右边的「✏️ 编辑 / LoRA」可以改提示词、尺寸、步数、底模和 LoRA。'),
                wf.error ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', marginTop: '4px' } }, wf.error) : null,

                isOpen ? h('div', { style: { marginTop: '10px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent)', paddingTop: '10px' } },
                  !detail
                    ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '读取中…')
                    : h('div', null,
                        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
                          '输出节点 ' + (detail.outputNode || '?') +
                          '　正面 ' + (detail.bindings?.positive?.length ?? 0) +
                          '　负面 ' + (detail.bindings?.negative?.length ?? 0) +
                          '　尺寸 ' + (detail.bindings?.size?.length ?? 0) +
                          '　步数 ' + (detail.bindings?.steps?.length ?? 0)),

                        // 试跑 + 编辑绑定
                        h('div', { style: Object.assign({}, S.row, { marginBottom: '10px' }) },
                          h('button', {
                            style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, transparent)', color: 'var(--dsw-alias-state-success-primary)', fontWeight: 600 }),
                            onClick: () => testWorkflow(wf),
                            title: '用这张工作流真的画一张，验证它能不能跑通',
                          }, '⚡ 试跑一张'),

                          wfTestNote ? h('span', { style: { fontSize: '12px', color: /✗/.test(wfTestNote) ? 'var(--dsw-alias-state-error-primary)' : (/✓/.test(wfTestNote) ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)') } }, wfTestNote) : null,
                        ),

                        // 简单编辑：直接改参数值（不用理解节点）
                        wfValues && !wfValues.__error ? h('div', { style: { marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)' } },
                          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
                            '这张工作流的参数。改完点「💾 保存参数」立刻生效，之后生成就用这些值。'),
                          h('div', { style: Object.assign({}, S.row, { alignItems: 'flex-start' }) },
                            h('span', { style: Object.assign({}, S.label, { minWidth: '74px', paddingTop: '6px' }) }, '正面提示词'),
                            h('textarea', {
                              value: wfValues.positive ?? '', style: Object.assign({}, S.input, { flex: 1, minWidth: '200px', minHeight: '54px', fontSize: '12px', fontFamily: 'ui-monospace, Consolas, monospace', resize: 'vertical', boxSizing: 'border-box' }),
                              onChange: e => setWfValues(Object.assign({}, wfValues, { positive: e.target.value })),
                            }),
                          ),
                          h('div', { style: Object.assign({}, S.row, { alignItems: 'flex-start' }) },
                            h('span', { style: Object.assign({}, S.label, { minWidth: '74px', paddingTop: '6px' }) }, '负面提示词'),
                            h('textarea', {
                              value: wfValues.negative ?? '', style: Object.assign({}, S.input, { flex: 1, minWidth: '200px', minHeight: '54px', fontSize: '12px', fontFamily: 'ui-monospace, Consolas, monospace', resize: 'vertical', boxSizing: 'border-box' }),
                              onChange: e => setWfValues(Object.assign({}, wfValues, { negative: e.target.value })),
                            }),
                          ),
                          h('div', { style: S.row },
                            h('span', { style: Object.assign({}, S.label, { minWidth: '74px' }) }, '尺寸'),
                            h('input', { type: 'number', value: wfValues.width ?? '', placeholder: '宽', style: Object.assign({}, S.input, { width: '88px' }), onChange: e => setWfValues(Object.assign({}, wfValues, { width: e.target.value })) }),
                            h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '×'),
                            h('input', { type: 'number', value: wfValues.height ?? '', placeholder: '高', style: Object.assign({}, S.input, { width: '88px' }), onChange: e => setWfValues(Object.assign({}, wfValues, { height: e.target.value })) }),
                            h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginLeft: '8px' } }, '这里只是这张工作流的上限参考，实际尺寸由生成时的画幅决定'),
                          ),
                          h('div', { style: S.row },
                            h('span', { style: Object.assign({}, S.label, { minWidth: '74px' }) }, '步数'),
                            h('input', { type: 'number', value: wfValues.steps ?? '', placeholder: '步数', style: Object.assign({}, S.input, { width: '88px' }), onChange: e => setWfValues(Object.assign({}, wfValues, { steps: e.target.value })) }),
                            h('span', { style: Object.assign({}, S.label, { minWidth: '46px', marginLeft: '12px' }) }, 'CFG'),
                            h('input', { type: 'number', step: '0.1', value: wfValues.cfg ?? '', placeholder: 'CFG', style: Object.assign({}, S.input, { width: '88px' }), onChange: e => setWfValues(Object.assign({}, wfValues, { cfg: e.target.value })) }),
                          ),
                          h('div', { style: S.row },
                            h('span', { style: Object.assign({}, S.label, { minWidth: '74px' }) }, '底模'),
                            h('input', {
                              type: 'text', value: wfValues.model ?? '', placeholder: '比如 anima-turbo-v1.safetensors',
                              style: Object.assign({}, S.input, { flex: 1, minWidth: '200px' }),
                              onChange: e => setWfValues(Object.assign({}, wfValues, { model: e.target.value })),
                            }),
                          ),
                          h('div', { style: S.row },
                            h('button', { style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent)', color: 'var(--dsw-alias-brand-primary)', fontWeight: 600 }), onClick: saveWfValues }, '💾 保存参数'),
                            h('button', { style: buttonStyle, onClick: async () => {
                              const v = await post('/workflow-values', { file: wfValues.__file }).catch(() => null)
                              if (v?.ok) setWfValues(Object.assign({}, v.values, { __file: wfValues.__file }))
                              setWfNote('已重新读取')
                            } }, '↻ 重新读取'),
                          ),
                        ) : wfValues && wfValues.__error
                          ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', marginBottom: '10px' } },
                              '读参数失败：' + wfValues.__error + '　（多半是宿主没重启，重启 DSH 后再试）')
                          : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } }, '读取参数中…'),

                        (() => {
                          const loadImageNodes = Object.entries(detail.prompt || {}).filter(([, node]) => node?.class_type === 'LoadImage')
                          if (!loadImageNodes.length) return null
                          const selected = Array.isArray(detail.bindings?.referenceImages) ? detail.bindings.referenceImages : []
                          const rows = selected.length ? selected : (loadImageNodes.length === 1 ? [{ node: loadImageNodes[0][0], input: 'image' }] : [])
                          const nodeLabel = (id, node) => String(node?._meta?.title || node?.title || ('LoadImage ' + id))
                          return h('div', { style: { margin: '12px 0', padding: '10px 12px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent)', borderRadius: '9px' } },
                            h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, '参考图接入顺序'),
                            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px', lineHeight: 1.5 } }, loadImageNodes.length === 1
                              ? '本工作流只有一个 LoadImage 接图节点，参考图 1 会自动接入。'
                              : '本工作流有多个 LoadImage 节点，可能用于姿势、蒙版或背景。请明确选择角色／服装参考图对应的节点；参考图按下方顺序逐张对应。'),
                            rows.map((binding, index) => h('div', { key: index, style: Object.assign({}, S.row, { marginBottom: '6px' }) },
                              h('span', { style: { minWidth: '82px', fontSize: '12px' } }, '参考图 ' + (index + 1)),
                              h('select', { 'aria-label': '参考图 ' + (index + 1) + ' 接入节点', value: String(binding.node || ''), style: Object.assign({}, S.input, { flex: 1, minWidth: '180px' }), onChange: e => {
                                if (!e.target.value) return
                                const next = rows.map((item, i) => i === index ? { node: e.target.value, input: 'image' } : item)
                                void patchReferenceBindings(next)
                              } },
                                !binding.node ? h('option', { value: '' }, '选择接图节点') : null,
                                loadImageNodes.map(([id, node]) => h('option', { key: id, value: id, disabled: rows.some((item, i) => i !== index && String(item.node) === String(id)) }, nodeLabel(id, node)))),
                              rows.length > 1 ? h('button', { type: 'button', 'aria-label': '移除参考图 ' + (index + 1) + ' 接入', onClick: () => void patchReferenceBindings(rows.filter((_, i) => i !== index)) }, '移除') : null)),
                            loadImageNodes.length > 1 && rows.length < loadImageNodes.length ? h('button', { type: 'button', onClick: () => {
                              const next = rows.concat({ node: '', input: 'image' })
                              setWfDetail(Object.assign({}, detail, { bindings: Object.assign({}, detail.bindings || {}, { referenceImages: next }) }))
                            } }, '＋ 添加接入节点') : null,
                            loadImageNodes.length > 1 && !selected.length ? h('div', { role: 'note', style: { color: 'var(--dsw-alias-state-warning-primary)', fontSize: '11px', marginTop: '6px' } }, '尚未保存明确映射；存在多个接图节点时不会猜测参考图用途。') : null)
                        })(),
                        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } },
                          'LoRA（' + (detail.bindings?.loras?.length ?? 0) + ' 个）'),
                        (detail.bindings?.loras ?? []).length
                          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                              (detail.bindings.loras).map(lora => h('div', { key: lora.node, style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 8px', borderRadius: '8px', background: lora.enabled === false ? 'rgba(0,0,0,.2)' : 'color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent)' } },
                                h('input', { type: 'checkbox', checked: lora.enabled !== false, title: '启用 / 停用这个 LoRA', onChange: e => patchLora(lora.node, { enabled: e.target.checked }) }),
                                loraList.length
                                  ? h('select', { value: lora.name || '', style: Object.assign({}, S.input, { flex: 1, minWidth: '170px', fontSize: '12px' }), onChange: e => patchLora(lora.node, { name: e.target.value }) },
                                      h('option', { value: lora.name || '' }, lora.name || '（未选）'),
                                      loraList.filter(n => n !== lora.name).map(n => h('option', { key: n, value: n }, n)))
                                  : h('input', { type: 'text', value: lora.name || '', placeholder: 'lora 文件名', style: Object.assign({}, S.input, { flex: 1, minWidth: '170px', fontSize: '12px' }), onChange: e => patchLora(lora.node, { name: e.target.value }) }),
                                h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, '权重'),
                                h('input', { type: 'number', step: '0.05', value: lora.strengthModel ?? 1, style: Object.assign({}, S.input, { width: '76px', fontSize: '12px' }), onChange: e => patchLora(lora.node, { strengthModel: Number(e.target.value), strengthClip: Number(e.target.value) }) }),
                                h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, '节点 ' + lora.node),
                              )))
                          : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '这张工作流里没有 LoRA 节点（没有 LoraLoader）'),
                      ),
                ) : null,
              )
            }) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } }, '还没有工作流。点「📥 导入工作流」或往插件目录的 workflows/ 里丢 JSON 再点重新扫描。'),
          ),
        )
      }

      // ---- 世界书 ----
      function worldbookTab() {
        // 每种提示词格式有独立的两本书；浏览其他格式不改全局 promptMode。
        const formats = [['tags', '标签'], ['natural', '自然语言'], ['mixed', '混合'], ['structured', '结构化自然语言']]
        const activeFormat = wbFormat || data.worldbookFormat || config.promptEffectiveFormat || 'tags'
        const formatLabel = value => formats.find(([key]) => key === value)?.[1] || '尚未解析'
        const effectiveFormat = config.promptEffectiveFormat || (formats.some(([key]) => key === config.promptMode) ? config.promptMode : '')
        const bookData = wbView?.worldbookFormat === activeFormat ? wbView
          : !data.worldbookFormat || data.worldbookFormat === activeFormat ? data : { worldbook: [], worldbookBooks: [] }
        const books = Array.isArray(bookData.worldbookBooks) && bookData.worldbookBooks.length
          ? bookData.worldbookBooks
          : [{ key: 'main', name: String(bookData.worldbookName || '生图世界书'), count: (bookData.worldbook || []).length, entries: bookData.worldbook || [] }]
        const activeBook = books.find(book => book.key === wbBook) || books[0]
        const activeKey = activeBook?.key || 'main'
        const scope = activeFormat + '|' + activeKey
        wbScope.current = scope
        const list = Array.isArray(activeBook?.entries) ? activeBook.entries : (bookData.worldbook || [])
        const onCount = list.filter(e => e.enabled !== false).length
        const context = data.plannerContext || null
        const providers = [
          ['comfyui', 'ComfyUI'], ['novelai', 'NovelAI'], ['openai', 'OpenAI'], ['gemini', 'Gemini'],
          ['gemini-chat', 'Gemini Chat'], ['grok', 'Grok'], ['seedream', 'Seedream'], ['qwen', 'Qwen'], ['atlascloud', 'Atlas兼容（自定义）'], ['sdwebui', 'SD WebUI'],
        ]

        async function readWorldbook(format) {
          const r = await jsonFetch(BASE + '/worldbook?format=' + encodeURIComponent(format), { cache: 'no-store' })
          if (!r || r.ok === false) throw new Error(r?.error || '无法读取世界书')
          if (r.worldbookFormat && r.worldbookFormat !== format) throw new Error('服务器返回了其他格式的世界书，未覆盖当前编辑内容')
          const doc = r.worldbook || {}
          const entries = Array.isArray(doc) ? doc : Array.isArray(doc.entries) ? doc.entries : []
          return { worldbookFormat: format, worldbook: entries, worldbookName: r.worldbookName || doc.name || '', worldbookBooks: Array.isArray(r.worldbookBooks) ? r.worldbookBooks : [] }
        }
        async function refreshWb() {
          const request = ++wbReadEpoch.current
          const next = await readWorldbook(activeFormat)
          if (request === wbReadEpoch.current && wbScope.current === scope) setWbView(next)
        }
        async function changeWorldbook(format, book) {
          if (wbTransition.current) return
          wbTransition.current = true
          setWbLoading(true)
          try {
            if (!await flushWbPending()) { setWbNote('有未保存的输入，切换已取消；请重试保存'); return }
            await Promise.all([...wbActions.current])
            await wbWriteQueue.current
            if (Object.keys(wbPending.current).length) { setWbNote('有未保存的输入，切换已取消'); return }
            const request = ++wbReadEpoch.current
            const next = format !== activeFormat ? await readWorldbook(format) : null
            if (request !== wbReadEpoch.current) return
            wbScope.current = format + '|' + book
            if (next) setWbView(next)
            setWbFormat(format)
            setWbBook(book)
            setWbEditing(-1)
            setWbOpen({})
            setWbDrafts({})
            wbDraftRevisions.current = {}
            setWbImportOpen(false)
            setWbPaste('')
            setWbNote('')
          } catch (error) { setWbNote('切换失败，已保留当前内容：' + (error?.message || error)) }
          finally { wbTransition.current = false; setWbLoading(false) }
        }
        function trackWbAction(action) {
          const task = action()
          wbActions.current.add(task)
          task.finally(() => wbActions.current.delete(task)).catch(() => {})
          return task
        }
        function queueWbWrite(write) {
          const task = wbWriteQueue.current.then(write, write)
          wbWriteQueue.current = task.catch(() => {})
          return task
        }
        async function sendEntryPatch(index, patch, remove, tip) {
          return queueWbWrite(async () => {
            const r = await post('/worldbook-entry', remove ? { format: activeFormat, book: activeKey, index, remove: true } : { format: activeFormat, book: activeKey, index, patch })
            if (!r?.ok) { setWbNote((tip || '改') + '失败：' + (r?.error || '')); return false }
            setWbNote(tip ? (tip + '已保存') : '')
            await refreshWb()
            return true
          })
        }
        function setWbDraft(index, displayPatch) {
          const revisions = { ...(wbDraftRevisions.current[index] || {}) }
          for (const field of Object.keys(displayPatch)) revisions[field] = (revisions[field] || 0) + 1
          wbDraftRevisions.current[index] = revisions
          setWbDrafts(current => ({ ...current, [index]: { ...(current[index] || {}), ...displayPatch } }))
          return Object.fromEntries(Object.keys(displayPatch).map(field => [field, revisions[field]]))
        }
        function clearSavedDrafts(index, fields, sentRevisions) {
          if (wbScope.current !== scope) return
          setWbDrafts(current => {
            const next = { ...current }
            const entry = { ...(next[index] || {}) }
            const latestRevisions = wbDraftRevisions.current[index] || {}
            for (const field of fields) if (latestRevisions[field] === sentRevisions[field]) delete entry[field]
            if (Object.keys(entry).length) next[index] = entry
            else delete next[index]
            return next
          })
        }
        function restorePending(entries, startAt) {
          const restored = { ...wbPending.current }
          for (const [rawIndex, patch] of entries.slice(startAt)) {
            restored[rawIndex] = { ...patch, ...(restored[rawIndex] || {}) }
          }
          wbPending.current = restored
        }
        function flushWbPending() {
          if (wbTimer.current) { clearTimeout(wbTimer.current); wbTimer.current = null }
          if (wbFlushing.current) return wbFlushing.current
          const flush = async () => {
            while (Object.keys(wbPending.current).length) {
              const batch = wbPending.current
              wbPending.current = {}
              const entries = Object.entries(batch)
              for (let i = 0; i < entries.length; i++) {
                const [rawIndex, patch] = entries[i]
                const index = Number(rawIndex)
                const sentRevisions = Object.fromEntries(Object.keys(patch).map(field => [field, wbDraftRevisions.current[index]?.[field]]))
                let saved
                try { saved = await sendEntryPatch(index, patch, false, '条目') }
                catch (error) {
                  restorePending(entries, i)
                  setWbNote('保存失败：' + (error?.message ?? error))
                  return false
                }
                if (!saved) { restorePending(entries, i); return false }
                clearSavedDrafts(index, Object.keys(patch), sentRevisions)
              }
            }
            return true
          }
          const task = flush().finally(() => { if (wbFlushing.current === task) wbFlushing.current = null })
          wbFlushing.current = task
          return task
        }
        function patchEntry(index, patch, remove, tip) {
          if (wbTransition.current || wbScope.current !== scope) return
          return trackWbAction(async () => {
            try {
              const sentRevisions = patch ? setWbDraft(index, patch) : {}
              const flushed = await flushWbPending()
              if (!flushed) {
                if (patch) restorePending([[String(index), patch]], 0)
                setWbNote('有未保存的输入，请检查网络后重试')
                return
              }
              const saved = await sendEntryPatch(index, patch, remove, tip)
              if (saved && patch) clearSavedDrafts(index, Object.keys(patch), sentRevisions)
              else if (!saved && patch) restorePending([[String(index), patch]], 0)
            } catch (e) {
              if (patch) restorePending([[String(index), patch]], 0)
              setWbNote((tip || '改') + '失败：' + (e?.message ?? e))
            }
          })
        }
        /** 打字时保留本地值；停 700ms 后合并提交，避免丢掉相邻字段的改动。 */
        function patchEntrySoon(index, patch, tip, displayPatch = patch) {
          if (wbTransition.current || wbScope.current !== scope) return
          setWbDraft(index, displayPatch)
          wbPending.current[index] = { ...(wbPending.current[index] || {}), ...patch }
          setWbNote('输入中…')
          if (wbTimer.current) clearTimeout(wbTimer.current)
          wbTimer.current = setTimeout(() => {
            wbTimer.current = null
            flushWbPending().catch(e => setWbNote('保存失败：' + (e?.message ?? e)))
          }, 700)
        }
        function keywordValues(entry) {
          return Array.isArray(entry.keywords) ? entry.keywords : []
        }
        function andKeywordValues(entry) {
          return Array.isArray(entry.andKeywords) ? entry.andKeywords : []
        }
        /** 草稿里可能是字符串（正在打字）也可能是数组（刚提交），统一成输入框文本。 */
        function draftKeywordText(drafts, index, entry, field) {
          const draft = drafts?.[index]?.[field]
          if (Array.isArray(draft)) return draft.join('，')
          if (typeof draft === 'string') return draft
          return (field === 'andKeywords' ? andKeywordValues(entry) : keywordValues(entry)).join('，')
        }
        function backendValues(entry) {
          const draft = wbDrafts[entry.index]?.backends
          return Array.isArray(draft) ? draft : Array.isArray(entry.backends) ? entry.backends : []
        }
        function diagnosticText(value) {
          if (typeof value === 'string') return value
          if (value && typeof value === 'object') {
            const reasons = {
              always: '常驻规则', 'keyword-match': '正文命中关键词', 'keyword-and-match': '正文命中关键词 + 附加条件', 'keyword-miss': '正文未命中关键词',
              'and-miss': '命中关键词但没命中附加条件（AND）',
              'empty-keywords': '未设置关键词', 'empty-content': '条目内容为空', disabled: '条目已停用', 'backend-mismatch': '不适用于当前渠道',
              'not-selected': '本次规划未选择', 'name-match': '正文提及角色',
              'fallback-no-name-match': '没有匹配到角色名称，使用角色回退列表', 'not-mentioned': '正文未提及角色',
            }
            const label = value.name || value.label || value.id || ''
            const reason = reasons[value.reason] || value.reason || ''
            return [label, reason].filter(Boolean).join(' — ') || '无名称记录'
          }
          return String(value ?? '')
        }
        function addEntry() {
          if (wbTransition.current || wbScope.current !== scope) return
          return trackWbAction(async () => {
          try {
            if (!await flushWbPending()) return
            await queueWbWrite(async () => {
              const r = await post('/worldbook-add', { format: activeFormat, book: activeKey, comment: '新条目', content: '' })
              if (!r?.ok) { setWbNote('加失败：' + (r?.error || '')); return }
              await refreshWb()
              if (wbScope.current === scope) setWbEditing(typeof r.index === 'number' ? r.index : -1)
            })
          } catch (e) { setWbNote('加失败：' + (e?.message ?? e)) }
          })
        }
        function importFrom(text, label) {
          if (wbTransition.current || wbScope.current !== scope) return
          return trackWbAction(async () => {
          try {
            if (!await flushWbPending()) return
            let payload = text
            try { payload = JSON.parse(text) } catch { /* 当纯文本 */ }
            await queueWbWrite(async () => {
              const r = await post('/worldbook-import', { format: activeFormat, book: activeKey, worldbook: payload })
              if (!r?.ok) { setWbNote('导入失败：' + (r?.error || '没读出条目')); return }
              setWbNote('✓ 已导入《' + r.name + '》' + r.count + ' 条')
              setWbImportOpen(false)
              setWbPaste('')
              setWbEditing(-1)
              setWbDrafts({})
              wbDraftRevisions.current = {}
              await refreshWb()
              if (typeof showToast === 'function') showToast('已导入 ' + r.count + ' 条世界书条目')
            })
          } catch (e) { setWbNote('导入失败：' + (e?.message ?? e)) }
          })
        }
        function pickWbFile(event) {
          const file = event?.target?.files && event.target.files[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => importFrom(String(reader.result || ''), file.name)
          reader.onerror = () => setWbNote('读文件失败')
          reader.readAsText(file)
        }
        async function exportWb() {
          if (wbTransition.current || wbScope.current !== scope || !await flushWbPending()) return
          const r = await jsonFetch(BASE + '/worldbook-export?format=' + encodeURIComponent(activeFormat) + '&book=' + encodeURIComponent(activeKey), { cache: 'no-store' }).catch(error => ({ ok: false, error: String(error?.message ?? error) }))
          if (!r?.ok) { setWbNote('导出失败：' + (r?.error || '无法从服务器读取世界书，请检查插件连接后重试')); return }
          const text = JSON.stringify(r.worldbook, null, 2)
          try {
            if (!navigator.clipboard?.writeText) throw new Error('浏览器未开放剪贴板权限')
            await navigator.clipboard.writeText(text)
            setWbNote('✓ 世界书 JSON 已复制到剪贴板')
            if (typeof showToast === 'function') showToast('世界书 JSON 已复制到剪贴板，粘给别人就能导入')
          } catch (error) {
            setWbPaste(text)
            setWbImportOpen(true)
            try {
              const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = 'worldbook-' + activeFormat + '-' + activeKey + '.json'
              document.body.appendChild(link)
              link.click()
              link.remove()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
              setWbNote('剪贴板不可用，已下载 JSON；内容也放在下方文本框，可手动复制。')
            } catch {
              setWbNote('剪贴板不可用；内容已放到下方文本框，请手动复制。')
            }
            if (typeof showToast === 'function') showToast('剪贴板不可用，已准备世界书 JSON 下载与手动复制内容')
          }
        }

        const ta = Object.assign({}, S.input, { width: '100%', minHeight: '130px', fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box' })

        return h('fieldset', { disabled: wbLoading, 'aria-busy': wbLoading, style: Object.assign({}, S.card, { minWidth: 0 }) },
          h('label', { style: S.row }, h('span', { style: S.label }, '世界书格式'),
            h('select', { 'aria-label': '世界书格式', value: activeFormat, style: S.input, onChange: event => changeWorldbook(event.target.value, 'main') },
              formats.map(([value, label]) => h('option', { key: value, value }, label)))),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } }, '只编辑所选格式的独立世界书，不改变当前生图格式。切换前会保存未完成的输入；失败时留在原格式。'),
          h('div', { 'aria-label': '世界书格式状态', style: { fontSize: '12px', marginBottom: '8px' } },
            '正在编辑：' + formatLabel(activeFormat) + '；实际生图：' + formatLabel(effectiveFormat) + ((config.promptMode || 'auto') === 'auto' ? '（自动选择）' : ''),
            effectiveFormat && effectiveFormat !== activeFormat ? '。当前编辑的规则不会用于实际生图，除非切换提示词格式。' : ''),
          h('button', { type: 'button', style: buttonStyle, onClick: async () => {
            if (!await flushWbPending()) { setWbNote('有未保存的输入，请重试保存后再前往设置'); return }
            await Promise.all([...wbActions.current]); await wbWriteQueue.current
            if (Object.keys(wbPending.current).length) { setWbNote('有未保存的输入，请重试保存后再前往设置'); return }
            promptFormatFocus.current = true; setTab('plan')
          } }, '前往提示词格式设置'),
          activeFormat === 'structured' ? h(WorldbookUpgradePanel, { key: scope, book: activeKey,
            request: (path, body) => trackWbAction(async () => {
              if (!await flushWbPending()) throw new Error('请先保存当前世界书输入')
              return queueWbWrite(() => body === undefined ? jsonFetch(BASE + path, { cache: 'no-store' }) : post(path, body))
            }), onApplied: refreshWb }) : null,
          wbLoading ? h('div', { role: 'status' }, '正在保存并切换世界书…') : null,
          h('div', { style: { fontSize: '13px', marginBottom: '8px' } },
            '世界书：' + (activeBook?.name ? '《' + activeBook.name + '》' : '') + '（' + onCount + ' / ' + list.length + ' 条启用）'),
          // 书选择器：两本并列，切换后下方列表与所有编辑动作都作用在选中的那一本
          h('div', { style: { display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } },
            books.map(book => {
              const on = book.key === activeKey
              return h('button', {
                key: book.key,
                title: book.file ? ('保存到 ' + book.file) : '',
                style: Object.assign({}, buttonStyle, {
                  fontSize: '12px',
                  padding: '5px 12px',
                  borderColor: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 85%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 35%, transparent)',
                  background: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)' : 'transparent',
                  color: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)',
                }),
                onClick: () => changeWorldbook(activeFormat, book.key),
              }, '📖 ' + (book.name || book.key) + '（' + (book.count ?? 0) + ' 条）')
            }),
          ),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } },
            '启用的常驻条目会作为画图规则发送给规划模型；关键词条目仅在正文命中关键词时发送。旧条目默认常驻。可逐条调整触发方式和适用渠道。'),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } },
            '固定规则会前置，方便服务端复用；规划仍通过 DSH 模型接口完成。'),
          h('div', { style: S.row },
            h('button', { style: buttonStyle, onClick: () => setWbImportOpen(v => !v) }, wbImportOpen ? '✖ 收起导入' : '📥 导入世界书'),
            h('button', { style: buttonStyle, onClick: addEntry }, '➕ 新条目'),
            h('button', { style: buttonStyle, onClick: exportWb }, '📤 导出（复制 JSON）'),
            h('button', { style: buttonStyle, onClick: async () => { try { if (await flushWbPending()) await refreshWb() } catch (error) { setWbNote('刷新失败：' + (error?.message || error)) } } }, '🔄 刷新'),
            wbNote ? h('span', { style: { fontSize: '12px', color: /失败/.test(wbNote) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' } }, wbNote) : null,
          ),

          wbImportOpen ? h('div', { style: { marginTop: '10px', padding: '12px', borderRadius: '10px', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)' } },
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
              '可以直接导入 SillyTavern 的世界书 JSON（选文件），也可以把 JSON / 纯文本粘在下面。纯文本会按空行切成条目。'),
            h('div', { style: S.row },
              h('label', { style: { padding: '6px 14px', fontSize: '12px', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 60%, transparent)', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', background: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent)' } },
                '📁 选文件（.json / .txt）',
                h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', style: { display: 'none' }, onChange: pickWbFile }),
              ),
            ),
            h('textarea', { value: wbPaste, placeholder: '把世界书 JSON 或纯文本粘在这里…', style: Object.assign({}, ta, { marginTop: '8px' }), onChange: e => setWbPaste(e.target.value) }),
            h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
              h('button', { style: buttonStyle, onClick: () => importFrom(wbPaste) }, '导入这段内容'),
              h('button', { style: buttonStyle, onClick: () => { setWbPaste(''); setWbNote('') } }, '清空'),
            ),
          ) : null,

          h('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' } },
            list.length ? list.map(entry => h('div', {
              key: entry.index,
              style: { borderRadius: '10px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent)', background: entry.enabled === false ? 'var(--dsw-specific-input-major)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', padding: '9px 11px' },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                h('input', {
                  type: 'checkbox', checked: entry.enabled !== false,
                  title: '启用 / 停用这条',
                  onChange: e => patchEntry(entry.index, { enabled: e.target.checked }),
                }),
                h('span', { style: { flex: 1, minWidth: 0, fontSize: '13px', color: entry.enabled === false ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  String(entry.index + 1) + '. ' + (entry.comment || '未命名')),
                h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 } },
                  (entry.length ?? String(entry.content ?? '').length) + ' 字'),
                h('button', {
                  style: Object.assign({}, buttonStyle, { fontSize: '11px', padding: '2px 8px' }),
                  title: '只读预览这条内容，不影响编辑',
                  onClick: () => setWbOpen(current => ({ ...current, [entry.index]: !current[entry.index] })),
                }, wbOpen[entry.index] ? '▾ 收起' : '▸ 内容'),
                h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 10px' }), onClick: () => setWbEditing(wbEditing === entry.index ? -1 : entry.index) }, wbEditing === entry.index ? '收起' : '编辑'),
                h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 10px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => { if (confirm('删除这条世界书条目？')) patchEntry(entry.index, null, true) } }, '删'),
              ),
              wbOpen[entry.index] && wbEditing !== entry.index ? h('div', {
                style: {
                  marginTop: '8px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  background: 'var(--dsw-specific-input-major)',
                  color: 'var(--dsw-alias-label-primary)',
                  fontSize: '12px',
                  lineHeight: '1.75',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '340px',
                  overflow: 'auto',
                  border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)',
                },
              }, String(entry.content ?? '').trim() || '（这条还没有内容）') : null,
              wbEditing === entry.index ? h('div', { style: { marginTop: '8px' } },
                h('input', {
                  type: 'text', value: wbDrafts[entry.index]?.comment ?? entry.comment ?? '', placeholder: '条目标题',
                  style: Object.assign({}, S.input, { width: '100%', marginBottom: '6px' }),
                  onChange: e => patchEntrySoon(entry.index, { comment: e.target.value }, '标题'),
                }),
                h('textarea', {
                  value: wbDrafts[entry.index]?.content ?? entry.content ?? '', placeholder: '条目内容（作为画图规则发给模型）',
                  style: ta,
                  onChange: e => patchEntrySoon(entry.index, { content: e.target.value }, '内容'),
                }),
                h('div', { style: { marginTop: '10px', padding: '9px', borderRadius: '8px', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 24%, transparent)' } },
                  h('div', { style: { fontSize: '12px', marginBottom: '6px' } }, '触发方式'),
                  h('label', { style: Object.assign({}, S.row, { fontSize: '12px', marginBottom: '6px' }) },
                    h('input', { type: 'radio', name: 'wb-activation-' + entry.index, value: 'always', checked: (wbDrafts[entry.index]?.activation ?? entry.activation ?? 'always') === 'always', onChange: () => patchEntry(entry.index, { activation: 'always' }, false, '触发方式') }),
                    '常驻：每轮都作为画图规则发送'),
                  h('label', { style: Object.assign({}, S.row, { fontSize: '12px' }) },
                    h('input', { type: 'radio', name: 'wb-activation-' + entry.index, value: 'keywords', checked: (wbDrafts[entry.index]?.activation ?? entry.activation) === 'keywords', onChange: () => patchEntry(entry.index, { activation: 'keywords' }, false, '触发方式') }),
                    '关键词触发：正文命中下方任一词时发送（填了附加条件就还要再命中一个）'),
                  (wbDrafts[entry.index]?.activation ?? entry.activation) === 'keywords' ? h('div', { style: { marginTop: '6px' } },
                    h('textarea', { 'aria-label': '触发关键词 ' + entry.index, value: wbDrafts[entry.index]?.keywords ?? keywordValues(entry).join('，'), placeholder: '例如：雨夜，咖啡馆（逗号、中文逗号或换行分隔）', style: Object.assign({}, ta, { minHeight: '54px' }), onChange: e => patchEntrySoon(entry.index, { keywords: e.target.value.split(/[，,\n\r]+/).map(value => value.trim()).filter(Boolean) }, '关键词', { keywords: e.target.value }) }),
                    (wbDrafts[entry.index]?.keywords ?? keywordValues(entry).join('，')).split(/[，,\n\r]+/).map(value => value.trim()).filter(Boolean).length === 0 ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-warning-primary)', fontSize: '11px', marginTop: '4px' } }, '没有关键词：此条目不会注入。请填写至少一个词，或改为常驻。') : null,
                    h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '8px 0 3px' } }, '附加条件 AND（可留空）：主关键词命中后，还要命中这里的任意一个词，才注入这条'),
                    h('textarea', { 'aria-label': '附加条件 ' + entry.index, value: draftKeywordText(wbDrafts, entry.index, entry, 'andKeywords'), placeholder: '例如：精液，射精（留空 = 主关键词命中就注入）', style: Object.assign({}, ta, { minHeight: '44px' }), onChange: e => patchEntrySoon(entry.index, { andKeywords: e.target.value.split(/[，,\n\r]+/).map(value => value.trim()).filter(Boolean) }, '附加条件', { andKeywords: e.target.value }) }),
                    andKeywordValues(entry).length ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-brand-primary)', marginTop: '4px' } }, '已设 ' + andKeywordValues(entry).length + ' 个附加条件：命中主关键词但没有命中它们时，这条不会注入。') : null,
                  ) : null,
                  h('div', { style: { fontSize: '12px', margin: '10px 0 4px' } }, '适用生图渠道'),
                  h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '5px' } }, '未勾选任何渠道表示全部渠道。'),
                  h('div', { style: Object.assign({}, S.row, { gap: '8px 14px' }) }, providers.map(([id, label]) => h('label', { key: id, style: { display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px' } },
                    h('input', { type: 'checkbox', checked: backendValues(entry).includes(id), onChange: e => {
                      const next = new Set(backendValues(entry))
                      if (e.target.checked) next.add(id); else next.delete(id)
                      const backends = [...next]
                      patchEntry(entry.index, { backends }, false, '适用渠道')
                    } }), label))),
                  h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } }, 'Atlas兼容（自定义）适用于协议为 AtlasCloud 且后端支持的自定义渠道；它不是独立渠道。'),
                ),
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } }, '改动即时保存。'),
              ) : null,
            )) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } },
              '还没有条目。可以点「📥 导入世界书」，或「➕ 新条目」自己写。'),
          ),
          h('details', { style: { marginTop: '14px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)', paddingTop: '10px', color: 'var(--dsw-alias-label-primary)' } },
            h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, '上次规划的诊断'),
            context ? h('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
              h('div', { style: { marginBottom: '8px' } }, '轮次 ' + (context.turn ?? '—') + ' · 渠道 ' + (providers.find(([id]) => id === context.backend)?.[1] || context.backend || '—') + ' · 时间 ' + (context.at || '—')),
              h('div', {}, '字符统计：固定 ' + (context.staticChars ?? '—') + ' · 动态 ' + (context.dynamicChars ?? '—') + ' · 正文 ' + (context.bodyChars ?? '—')),
              h('div', { style: { marginTop: '8px' } }, '已纳入条目'),
              Array.isArray(context.includedEntries) && context.includedEntries.length ? context.includedEntries.map((item, i) => h('div', { key: 'included-' + i },
                '第 ' + ((item.index ?? 0) + 1) + ' 条 · ' + (item.comment || '未命名') + (item.reason ? ' — ' + diagnosticText({ reason: item.reason }) : '')))
                : h('div', {}, '本轮没有纳入条目。'),
              h('div', { style: { marginTop: '8px' } }, '未纳入条目'),
              Array.isArray(context.omittedEntries) && context.omittedEntries.length ? context.omittedEntries.map((item, i) => h('div', { key: 'omitted-' + i },
                '第 ' + ((item.index ?? 0) + 1) + ' 条 · ' + (item.comment || '未命名') + (item.reason ? ' — ' + diagnosticText({ reason: item.reason }) : '')))
                : h('div', {}, '没有未纳入条目。'),
              h('div', { style: { marginTop: '8px' } }, '本轮识别角色'),
              Array.isArray(context.includedCharacters) && context.includedCharacters.length ? context.includedCharacters.map((item, i) => h('div', { key: 'character-' + i }, diagnosticText(item))) : h('div', {}, '无角色。'),
            ) : h('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, '暂无诊断记录。完成一轮规划后，这里会显示实际纳入和排除的规则及原因。'),
          ),
        )
      }

      // ---- 历史图 ----
      function galleryTab() {
        const done = historyJobs.filter(function (job) { return job.hasImage })
        const tiles = done.map(function (job) {
          return h('div', {
            key: job.id,
            style: {
              position: 'relative', borderRadius: '10px', overflow: 'hidden',
              background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)',
              border: gallerySelect && galleryPicked[job.id] ? '2px solid var(--dsw-alias-brand-primary)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)',
              boxShadow: gallerySelect && galleryPicked[job.id] ? '0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 25%, transparent)' : 'none',
            },
          },
            h('img', {
              src: BASE + '/jobs?id=' + encodeURIComponent(job.id) + '&image=1',
              loading: 'lazy',
              decoding: 'async',
              alt: job.label || '图',
              title: '左键看大图　右键出菜单',
              style: { display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', cursor: 'zoom-in', background: 'var(--dsw-specific-input-major)' },
              // 左键：批量模式下 = 勾选；平时 = 看大图（带上整库，能左右翻）
              onClick: function () {
                if (gallerySelect) { setGalleryPicked(cur => Object.assign({}, cur, { [job.id]: !cur[job.id] })); return }
                if (typeof openImageOverlay !== 'function') return
                // 用「所有历史图」作为翻页列表，并定位到点的这一张 —— 这样打开第一张就能一路翻到最后
                const all = done.map(function (j) { return j.id })
                const at = Math.max(0, all.indexOf(job.id))
                openImageOverlay({ open: true, jobIds: all.length ? all : [job.id], note: '画廊（' + (at + 1) + '/' + all.length + '）', working: false, index: at })
              },
              // 右键：出菜单
              onContextMenu: function (event) {
                event.preventDefault()
                if (typeof openContextMenu !== 'function') return
                openContextMenu({
                  x: event.clientX, y: event.clientY,
                  items: [
                    { icon: '🖼', label: '查看大图', onClick: function () {
                        const all = done.map(function (j) { return j.id })
                        const at = Math.max(0, all.indexOf(job.id))
                        openImageOverlay({ open: true, jobIds: all.length ? all : [job.id], note: '画廊（' + (at + 1) + '/' + all.length + '）', working: false, index: at })
                      } },
                    { icon: '✏️', label: '改提示词重画', onClick: function () {
                        if (typeof openEditorFor === 'function') openEditorFor(job.id, job.label)
                      } },
                    { icon: '📋', label: '复制提示词', onClick: async function () {
                        const r = await jsonFetch(BASE + '/job-detail?id=' + encodeURIComponent(job.id), { cache: 'no-store' }).catch(function () { return null })
                        const text = String(r?.job?.rawPrompt || r?.job?.prompt || '')
                        if (!text) { if (typeof showToast === 'function') showToast('这张图没记录提示词', 'fail'); return }
                        try { await navigator.clipboard.writeText(text); if (typeof showToast === 'function') showToast('提示词已复制') }
                        catch { if (typeof showToast === 'function') showToast('复制失败', 'fail') }
                      } },
                    { icon: '🗑', label: '删除这张', danger: true, onClick: function () { deleteJob(job.id) } },
                  ],
                })
              },
            }),
            gallerySelect ? h('div', {
              style: { position: 'absolute', top: '6px', left: '6px', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 50%, transparent)', background: galleryPicked[job.id] ? 'var(--dsw-alias-brand-primary)' : 'rgba(0,0,0,.5)', color: 'var(--dsw-alias-label-primary)', fontSize: '15px', lineHeight: '22px', textAlign: 'center' },
            }, galleryPicked[job.id] ? '✓' : '') : null,
            !gallerySelect ? h('button', {
              type: 'button',
              title: '删除这张（对话里的也一起删）',
              onClick: function (e) { e.stopPropagation(); deleteJob(job.id) },
              style: {
                position: 'absolute', top: '6px', right: '6px', width: '26px', height: '26px',
                borderRadius: '7px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent)',
                background: 'rgba(0,0,0,.55)', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer',
                fontSize: '13px', lineHeight: 1, padding: 0,
              },
            }, '🗑') : null,
            h('div', { style: { padding: '6px 8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              (job.label || '未命名') + ' · ' + (job.size || '')),
          )
        })
        const legacyTiles = legacyImages.map(function (item, index) {
          return h('button', { key: item.url, type: 'button', title: item.description || '', onClick: function () { setLegacyViewer(index) },
            style: { padding: 0, textAlign: 'left', cursor: 'zoom-in', borderRadius: '10px', overflow: 'hidden', background: 'transparent', color: 'inherit', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)' } },
            h('img', { src: item.url, loading: 'lazy', decoding: 'async', alt: item.description || '插图', style: { display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', background: 'var(--dsw-specific-input-major)' } }),
            h('div', { style: { padding: '6px 8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              '第 ' + item.turn + ' 轮 · 早期插图'))
        })
        // 按局分组：插件图按出图时的局，早期插图按 Tavern 记录的局；组内与组间都是新的在前。
        const groups = new Map()
        const groupOf = key => { if (!groups.has(key)) groups.set(key, { key, items: [], legacyTitle: '', deleted: false }); return groups.get(key) }
        done.forEach((job, index) => groupOf(job.gameId || '').items.push({ at: Number(job.completedAt || job.createdAt) || 0, node: tiles[index] }))
        legacyImages.forEach((item, index) => {
          const group = groupOf(item.gameId || 'legacy:' + item.gameTitle)
          group.legacyTitle = group.legacyTitle || item.gameTitle
          group.deleted = group.deleted || item.gameDeleted
          group.items.push({ at: Number(item.createdAt) || 0, node: legacyTiles[index] })
        })
        for (const group of groups.values()) group.items.sort((a, b) => b.at - a.at)
        const ordered = [...groups.values()].sort((a, b) => (b.items[0]?.at || 0) - (a.items[0]?.at || 0))
        const groupTitle = group => group.key === '' ? '未归属对局（在设置里试画的图）'
          : (gameNames[group.key]?.title || gameNames[group.key]?.cardName || group.legacyTitle || '已删除的对局') + (group.deleted ? '（已删除）' : '')
        const viewing = legacyViewer === null ? null : legacyImages[legacyViewer]
        const step = delta => setLegacyViewer(index => (index + delta + legacyImages.length) % legacyImages.length)
        return h('div', { style: S.card },
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '画廊（插件 ' + done.length + ' 张' + (legacyImages.length ? ' · 早期 ' + legacyImages.length + ' 张' : '') + '）'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } }, '左键看大图（可以左右翻整个历史库），右键出菜单，鼠标移到图上右上角能直接删。'),
          h('div', { style: S.row },
            h('button', { style: buttonStyle, onClick: function () { setHistoryNote('读取中…'); setHistoryTick(n => n + 1) } }, '🔄 刷新'),
            h('button', { style: buttonStyle, onClick: function () {
              if (typeof openImageOverlay === 'function' && done.length) openImageOverlay({ open: true, jobIds: done.map(function (job) { return job.id }), note: '全部插件图（◀ ▶ 翻页）', working: false, index: 0 })
            } }, '🖼 全部打开'),
            h('button', { style: buttonStyle, onClick: function () {
              setGallerySelect(v => !v); setGalleryPicked({})
            } }, gallerySelect ? '✖ 退出批量' : '☑ 批量选择'),
            gallerySelect ? h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: function () {
              const next = {}
              for (const job of done) next[job.id] = true
              setGalleryPicked(next)
            } }, '全选') : null,
            gallerySelect ? h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: function () { setGalleryPicked({}) } }, '取消全选') : null,
            gallerySelect ? h('button', {
              style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 70%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }),
              onClick: function () { deleteJobBatch(Object.keys(galleryPicked).filter(k => galleryPicked[k])) },
            }, '🗑 删除选中（' + Object.keys(galleryPicked).filter(k => galleryPicked[k]).length + '）') : null,
            historyNote ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, historyNote) : null,
          ),
          ordered.length ? ordered.map(group => h('details', { key: group.key, open: true, style: { marginTop: '14px' } },
            h('summary', { style: { cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
              groupTitle(group), h('span', { style: { fontWeight: 400, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginLeft: '8px' } }, group.items.length + ' 张')),
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginTop: '10px' } }, group.items.map(item => item.node))))
            : historyNote ? null : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '14px 0 0' } }, '还没有图片'),
          legacyTiles.length ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '14px' } }, '「早期插图」是换用插件之前 Tavern 自带生图画的，只读；要删除请到对应那局的「画廊」。') : null,
          viewing ? h('div', { role: 'dialog', 'aria-label': '查看早期插图', tabIndex: -1,
            ref: node => { if (node) node.focus() },
            onKeyDown: e => { if (e.key === 'Escape') setLegacyViewer(null); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1) },
            onClick: e => { if (e.target === e.currentTarget) setLegacyViewer(null) },
            style: { position: 'fixed', inset: 0, zIndex: 2147483000, background: 'rgba(0,0,0,.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', outline: 'none' } },
            h('img', { src: viewing.url, alt: viewing.description || '插图', style: { maxWidth: '92vw', maxHeight: '84vh', objectFit: 'contain', borderRadius: '8px' } }),
            h('div', { style: { color: '#eee', fontSize: '12px', maxWidth: '80vw', textAlign: 'center' } },
              (legacyViewer + 1) + ' / ' + legacyImages.length + ' · ' + (viewing.gameTitle || '未命名的局') + ' · 第 ' + viewing.turn + ' 轮' + (viewing.description ? ' · ' + viewing.description : '') + '　（← → 翻页，Esc 关闭）')) : null,
        )
      }

      /**
       * 画风预设（参考 st-chatu8 的「提示词预设」）。
       * 一套 = 名字 + 正面画师串/风格词 + 这套自带的负面固定词 + 放前面还是后面。
       * 选中的那套生成时自动拼进提示词；不选就用下面的默认值。
       */
      /** 测 ComfyUI 连接。 */
      async function loadComfyStatus() {
        setComfyStatus({ checking: true })
        // ⚠ 这里不能用 config：data 为空时组件在第 1346 行提前 return，同作用域的
        //   `const config = data.config || {}` 从未执行，直接读会抛
        //   ReferenceError: Cannot access 'config' before initialization（TDZ）。
        //   走 dataRef 取最新值，既避开 TDZ，也拿到真正加载完的配置。
        const url = String(dataRef.current?.config?.comfyUrl ?? '')
        const r = await post('/comfy-test', { url }).catch(e => ({ ok: false, error: String(e?.message ?? e) }))
        setComfyStatus(r)
      }

      /** 拉 provider 列表（和某个 provider 的模型列表）。 */
      async function loadProviders() {
        const r = await post('/llm-models', {}).catch(() => null)
        if (r?.providers?.length) { setLlmProviders(r.providers); setLlmNote('') }
        else setLlmNote('读不到 provider 列表（DSH 的 llm 服务不可用？可以先手动填）')
      }
      async function loadModels(provider) {
        if (!provider) return
        const r = await post('/llm-models', { provider }).catch(() => null)
        if (r?.models?.length) {
          setLlmModels(m => Object.assign({}, m, { [provider]: r.models }))
          if (r.error) setLlmNote(r.error)
          else setLlmNote('')
        } else setLlmNote(r?.error || '这个 provider 下列不出模型')
      }
      async function loadReasoning(provider, model) {
        if (!provider || !model) return
        const key = provider + '/' + model
        if (llmReasoning[key]) return
        const r = await post('/llm-models', { provider, model }).catch(() => null)
        if (r?.reasoning) setLlmReasoning(m => Object.assign({}, m, { [key]: r.reasoning }))
      }
      /**
       * 模型选择器：provider 下拉 → model 下拉 → 推理等级下拉。
       * onlyVision=true 时只列能看图的模型（看图模型用）。
       */
      function ModelPicker(props) {
        const { label, providerKey, modelKey, effortKey, onlyVision, hint } = props
        const pv = String(config[providerKey] || '')
        const md = String(config[modelKey] || '')
        const ef = String(config[effortKey] || '')
        const allModels = llmModels[pv] || []
        const visionModels = allModels.filter(m => m.vision)
        // 看图模型只列能看图的；但如果这个服务商一个都没标记（比如 opencode 渠道没有
        // inputModalities 里的 image），不能因此变成空下拉 —— 退回全部并提示。
        const noVisionMarked = Boolean(onlyVision) && Boolean(pv) && allModels.length > 0 && visionModels.length === 0
        const models = !onlyVision ? allModels : (visionModels.length ? visionModels : allModels)
        const reason = llmReasoning[pv + '/' + md]
        const optStyle = {}
        const set = (patch) => setData(current => Object.assign({}, current, { config: Object.assign({}, current?.config || {}, patch) }))
        const select = extra => Object.assign({}, S.input, { width: '100%', minWidth: 0, boxSizing: 'border-box' }, extra || {})
        return h('div', { style: { marginTop: '14px' } },
          h('div', { className: 'dti-field-label' }, label, hint ? h('small', null, hint) : null),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr) minmax(88px, .6fr)', gap: '8px' } },
            h('select', {
              'aria-label': label + ' 服务商', value: pv, style: select(),
              onChange: e => { const v = e.target.value; set({ [providerKey]: v, [modelKey]: '' }); save({ [providerKey]: v, [modelKey]: '' }); loadModels(v) },
            },
              h('option', { value: '', style: optStyle }, '跟随 Tavern'),
              llmProviders.map(p => h('option', { key: p.id, value: p.id, style: optStyle }, p.name)),
              pv && !llmProviders.some(p => p.id === pv) ? h('option', { value: pv, style: optStyle }, pv + '（当前值）') : null,
            ),
            h('select', {
              'aria-label': label + ' 模型', value: md, style: select(),
              onChange: e => { const v = e.target.value; set({ [modelKey]: v }); save({ [modelKey]: v }); if (v) loadReasoning(pv, v) },
              disabled: !pv,
            },
              h('option', { value: '', style: optStyle }, pv ? '选择模型' : '跟随 Tavern 后台模型'),
              models.map(m => h('option', { key: m.id, value: m.id, style: optStyle }, m.name + (onlyVision && m.vision ? '　👁' : ''))),
              md && !models.some(m => m.id === md) ? h('option', { value: md, style: optStyle }, md + '（当前值）') : null,
            ),
              noVisionMarked ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } },
                '「' + pv + '」没有标记支持看图的模型，这里列出它的全部模型；能不能读图取决于该服务商是否真的支持图像输入。'
              ) : null,
            h('select', {
              'aria-label': label + ' 推理等级', title: '推理等级', value: ef, style: select(),
              onChange: e => { set({ [effortKey]: e.target.value }); save({ [effortKey]: e.target.value }) },
              disabled: !reason,
            },
              h('option', { value: '', style: optStyle }, '默认推理'),
              (reason?.efforts || []).map(x => h('option', { key: x.id, value: x.id, style: optStyle }, x.name)),
            ),
          ),
        )
      }

      function stylePresetCard() {
        const presets = Array.isArray(config.stylePresets) ? config.stylePresets : []
        const active = String(config.activePreset ?? '')
        const activeName = (presets.find(p => String(p.id) === active) || {}).name

        const savePresets = (next) => save({ stylePresets: next })
        const patch = (i, patchObj) => {
          const next = presets.slice()
          next[i] = Object.assign({}, next[i], patchObj)
          savePresets(next)
        }
        const add = () => {
          const next = presets.concat([{
            id: 'p' + Date.now(), name: '画风 ' + (presets.length + 1),
            artist: '', negative: '', position: 'prefix', enabled: true,
          }])
          savePresets(next)
          save({ activePreset: next[next.length - 1].id })
        }
        const remove = (i) => {
          if (!confirm('删除这套画风？')) return
          const next = presets.slice()
          const gone = next.splice(i, 1)[0]
          savePresets(next)
          if (gone && String(gone.id) === active) save({ activePreset: '' })
        }
        const ta = (hgt) => Object.assign({}, S.input, {
          width: '100%', minHeight: hgt, fontFamily: 'ui-monospace, Consolas, monospace',
          lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box', fontSize: '12px',
        })
        const optStyle = {}
        // 每套画风预设自己的生成参数（空 = 跟渠道设置）
        const PRESET_SAMPLERS = [['k_euler_ancestral', 'Euler Ancestral'], ['k_euler', 'Euler'], ['k_dpmpp_2m', 'DPM++ 2M'], ['k_dpmpp_2s_ancestral', 'DPM++ 2S Anc'], ['k_dpmpp_sde', 'DPM++ SDE'], ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'], ['ddim_v3', 'DDIM'], ['k_lms', 'LMS'], ['k_heun', 'Heun'], ['k_dpm_2', 'DPM2'], ['k_dpm_2_ancestral', 'DPM2 Anc']]
        const PRESET_NOISE = [['karras', 'Karras'], ['native', 'Native'], ['exponential', 'Exponential'], ['polyexponential', 'Polyexponential']]
        const PRESET_UC = [['0', '0 · 强（Heavy）'], ['1', '1 · 弱（Light）'], ['2', '2 · Furry'], ['3', '3 · Human（默认）'], ['4', '4 · 不指定']]
        const paramValue = (p, key) => (p.params && p.params[key] !== undefined && p.params[key] !== null ? String(p.params[key]) : '')
        const setParam = (i, p, key, value) => {
          const next = Object.assign({}, p.params || {})
          if (value === undefined) delete next[key]
          else next[key] = value
          patch(i, { params: next })
        }
        const PARAM_ROW = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px 12px' }
        const paramGroupTitle = (text, first) => h('div', {
          style: { fontSize: '11px', letterSpacing: '.02em', color: 'var(--dsw-alias-label-tertiary)', margin: first ? '0 0 6px' : '12px 0 6px', paddingTop: first ? '0' : '10px', borderTop: first ? 'none' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent)' },
        }, text)
        const paramField = (caption, control) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '0' } },
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, caption), control)
        const paramSelect = (i, p, key, caption, items) => paramField(caption,
          h('select', { value: paramValue(p, key), title: caption + '：留空表示沿用渠道设置', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => setParam(i, p, key, e.target.value === '' ? undefined : e.target.value) },
            h('option', { value: '', style: optStyle }, '跟随渠道'),
            items.map(([value, text]) => h('option', { key: value, value, style: optStyle }, text))))
        const paramNumber = (i, p, key, caption, step) => paramField(caption,
          h('input', { type: 'number', step: step || '1', value: paramValue(p, key), placeholder: '跟随渠道', title: caption + '：留空表示沿用渠道设置', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => setParam(i, p, key, e.target.value.trim() === '' ? undefined : Number(e.target.value)) }))
        const paramBool = (i, p, key, caption) => paramField(caption,
          h('select', { value: paramValue(p, key), title: caption + '：跟随渠道表示沿用渠道设置', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => setParam(i, p, key, e.target.value === '' ? undefined : e.target.value === 'true') },
            h('option', { value: '', style: optStyle }, '跟随渠道'),
            h('option', { value: 'true', style: optStyle }, '开'),
            h('option', { value: 'false', style: optStyle }, '关')))

        return h('div', { style: S.card },
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } },
            '画风预设（' + presets.length + ' 套）' + (activeName ? '　当前：' + activeName : '　当前：默认')),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } },
            '每套可以带自己的画师串、风格词和负面词。点左边圆点选中，生成时就用那套；一套都不选就用下面的默认。'),
          h('div', { style: S.row },
            h('button', { style: buttonStyle, onClick: add }, '➕ 新增一套'),
            h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: () => save({ activePreset: '' }) }, '不用预设（回默认）'),
          ),
          presets.length ? h('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' } },
            presets.map((p, i) => h('div', {
              key: p.id || i,
              style: {
                borderRadius: '10px', padding: '10px 12px',
                border: String(p.id) === active ? '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 75%, transparent)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)',
                background: String(p.id) === active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)',
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' } },
                h('input', { type: 'radio', name: 'rphub-preset', checked: String(p.id) === active, title: '用这一套', onChange: () => save({ activePreset: String(p.id) }) }),
                h('input', {
                  type: 'text', value: p.name || '', placeholder: '这套叫什么（古风写实 / 二次元厚涂…）',
                  style: Object.assign({}, S.input, { flex: 1, minWidth: '140px' }),
                  onChange: e => patch(i, { name: e.target.value }),
                }),
                h('select', {
                  value: p.position === 'suffix' ? 'suffix' : 'prefix',
                  style: Object.assign({}, S.input, { width: '126px' }),
                  onChange: e => patch(i, { position: e.target.value }),
                  title: '这套词放在提示词的最前还是最后',
                },
                  h('option', { value: 'prefix', style: optStyle }, '放在最前面'),
                  h('option', { value: 'suffix', style: optStyle }, '放在最后面'),
                ),
                h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 10px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => remove(i) }, '删'),
              ),
              h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '4px' } }, '正面：画师串 / 风格词'),
              h('textarea', {
                value: p.artist || '', placeholder: '(@artist_a:1.1), (@artist_b:1.0), masterpiece, best quality',
                style: ta('72px'),
                onChange: e => patch(i, { artist: e.target.value }),
              }),
              h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '6px 0 4px' } }, '这套的负面固定词（会并进负面）'),
              h('textarea', {
                value: p.negative || '', placeholder: 'worst quality, low quality, bad hands',
                style: ta('46px'),
                onChange: e => patch(i, { negative: e.target.value }),
              }),
              h('details', { style: { marginTop: '10px' } },
                h('summary', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', padding: '2px 0' } }, '这套自己的生成参数（采样 / 步数 / CFG / NovelAI 高级…；留空 = 跟随渠道）'),
                h('div', { style: { marginTop: '8px', padding: '12px 14px', borderRadius: '8px', background: 'var(--dsw-specific-input-major)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent)' } },
                  paramGroupTitle('采样', true),
                  h('div', { style: PARAM_ROW },
                    paramSelect(i, p, 'sampler', '采样器', PRESET_SAMPLERS),
                    paramSelect(i, p, 'noiseSchedule', '噪点表', PRESET_NOISE)),
                  paramGroupTitle('步数与 CFG'),
                  h('div', { style: PARAM_ROW },
                    paramNumber(i, p, 'steps', '步数', '1'),
                    paramNumber(i, p, 'cfg', 'CFG', '0.1'),
                    paramNumber(i, p, 'cfgRescale', 'CFG Rescale', '0.01')),
                  paramGroupTitle('NovelAI 高级'),
                  h('div', { style: PARAM_ROW },
                    paramNumber(i, p, 'uncondScale', 'Uncond Scale', '0.1'),
                    paramNumber(i, p, 'skipCfgAboveSigma', 'Skip CFG Sigma', '0.1')),
                  paramGroupTitle('官方预设（NovelAI）'),
                  h('div', { style: PARAM_ROW },
                    paramSelect(i, p, 'ucPreset', '负面预设（ucPreset）', PRESET_UC),
                    paramBool(i, p, 'qualityToggle', '质量词（qualityToggle）'),
                    paramBool(i, p, 'varietyBoost', '多样性（variety_boost）'))),
              ),
            )),
          ) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '10px 0' } }, '还没有画风预设。点「➕ 新增一套」开始。'),

          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '14px', borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)', paddingTop: '12px', marginBottom: '6px' } }, '没选预设时用的默认值'),
          h('div', { style: S.row },
            h('span', { style: Object.assign({}, S.label, { minWidth: '86px' }) }, '默认画师串'),
            h('input', {
              type: 'text', value: config.styleArtists || '', placeholder: '比如 (@artist_x:1.1), masterpiece',
              style: Object.assign({}, S.input, { flex: 1, minWidth: '180px' }),
              onChange: e => setData(Object.assign({}, data, { config: Object.assign({}, config, { styleArtists: e.target.value }) })),
            }),
          ),
          h('div', { style: S.row },
            h('span', { style: Object.assign({}, S.label, { minWidth: '86px' }) }, '默认负面'),
            h('input', {
              type: 'text', value: config.styleNegative || '', placeholder: 'worst quality, low quality',
              style: Object.assign({}, S.input, { flex: 1, minWidth: '180px' }),
              onChange: e => setData(Object.assign({}, data, { config: Object.assign({}, config, { styleNegative: e.target.value }) })),
            }),
            h('button', { style: buttonStyle, onClick: () => save({ styleArtists: config.styleArtists || '', styleNegative: config.styleNegative || '' }) }, '保存'),
          ),
        )
      }

      function PromptPresetCard() {
        const optStyle = {}
        const library = Array.isArray(config.promptPresetLibrary) ? config.promptPresetLibrary : []
        const saved = Array.isArray(config.promptPresets) ? config.promptPresets : []
        const draftStorageKey = 'dsh-tavern-image-prompt-draft-v1'
        const legacyDraftStorageKey = 'dsh-tavern-comfy-prompt-draft-v1'
        const readDraft = () => {
          try {
            const cached = JSON.parse(window.localStorage?.getItem(draftStorageKey) || window.localStorage?.getItem(legacyDraftStorageKey) || 'null')
            return Array.isArray(cached) && cached.length <= 60 ? cached : saved
          } catch { return saved }
        }
        const [draft, setDraftState] = React.useState(readDraft)
        const [characterRequirements, setCharacterRequirements] = React.useState(String(config.characterDesignRequirements || ''))
        const [outfitRequirements, setOutfitRequirements] = React.useState(String(config.outfitDesignRequirements || ''))
        const setDraft = next => {
          const value = typeof next === 'function' ? next(draft) : next
          setDraftState(value)
          try { window.localStorage?.setItem(draftStorageKey, JSON.stringify(value)) } catch {}
        }
        const [importText, setImportText] = React.useState('')
        const [message, setMessage] = React.useState('')
        const [manualPositive, setManualPositive] = React.useState(config.promptManualPositive || '')
        const [manualNegative, setManualNegative] = React.useState(config.promptManualNegative || '')
        const [quality, setQuality] = React.useState(Number(config.jpegQuality || 88))
        const [background, setBackground] = React.useState(config.jpegBackground || '#ffffff')
        const activeId = String(config.activePromptPreset || '')
        const active = library.concat(draft).find(item => String(item.id) === activeId)
        const edit = (i, key, value) => setDraft(draft.map((item, n) => n === i ? Object.assign({}, item, { [key]: value }) : item))
        const addCopy = profile => {
          const next = draft.concat([{ id: 'custom-' + Date.now(), name: (profile?.name || '提示词预设') + ' 副本', positive: profile?.positive || '', negative: profile?.negative || '', enabled: true }])
          setDraft(next); save({ promptPresets: next, activePromptPreset: next[next.length - 1].id }); setMessage('副本已创建，可继续编辑。')
        }
        const addBlank = () => {
          const next = draft.concat([{ id: 'custom-' + Date.now(), name: '自定义提示词', positive: '', negative: '', enabled: true }])
          setDraft(next); save({ promptPresets: next, activePromptPreset: next[next.length - 1].id }); setMessage('已创建空白预设。')
        }
        const importPresets = () => {
          try {
            const parsed = JSON.parse(importText), incoming = Array.isArray(parsed) ? parsed : [parsed]
            if (!incoming.length || incoming.length > 60 || incoming.some(p => !p || typeof p !== 'object' || Array.isArray(p))) throw new Error('需提供 1–60 个预设对象')
            const next = draft.concat(incoming.map((p, i) => Object.assign({}, p, { id: 'import-' + Date.now() + '-' + i }))).slice(0, 60)
            setDraft(next); setImportText(''); setMessage('导入完成，请保存预设。')
          } catch (error) { setMessage('导入失败：' + (error?.message || 'JSON 格式不正确')) }
        }
        const exportPresets = () => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a'); link.href = url; link.download = 'dsh-prompt-presets.json'; link.click(); URL.revokeObjectURL(url)
        }
        const area = height => Object.assign({}, S.input, { width: '100%', minHeight: height, boxSizing: 'border-box', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', lineHeight: '1.5', resize: 'vertical' })
        return h('div', { style: S.card },
          h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '5px' } }, '专业提示词预设'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '9px' } }, '可选标签、自然语言、混合或结构化自然语言；各格式使用独立世界书。结构化格式默认中文分节，文生图与参考图模式均可用。预设本身不保证跨图一致。'),
          h('div', { style: S.row },
            h('label', { style: S.label }, '提示词格式'),
            h('select', { 'aria-label': '提示词格式', ref: node => { if (node && promptFormatFocus.current) { promptFormatFocus.current = false; node.focus(); node.scrollIntoView?.({ block: 'center' }) } }, value: config.promptMode || 'auto', style: S.input, onChange: e => save({ promptMode: e.target.value }) },
              h('option', { value: 'auto', style: optStyle }, '自动'), h('option', { value: 'tags', style: optStyle }, '标签'), h('option', { value: 'natural', style: optStyle }, '自然语言'), h('option', { value: 'mixed', style: optStyle }, '混合'), h('option', { value: 'structured', style: optStyle }, '结构化自然语言')),
            h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, '当前：' + (config.promptEffectiveFormat || 'mixed')),
          ),
          h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
            h('label', { style: S.label }, '角色与服装生成写法'),
            h('select', { 'aria-label': '角色与服装生成写法', value: config.designPromptMode || 'auto', style: S.input, onChange: e => save({ designPromptMode: e.target.value }) },
              h('option', { value: 'auto', style: optStyle }, '自动'),
              h('option', { value: 'chinese', style: optStyle }, '中文整句'),
              h('option', { value: 'tags', style: optStyle }, '英文 Tag')),
          ),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '4px 0 7px' } }, '自动参考现有角色资料；角色设计缺少现有资料时参考绘图模型。已有条目不会被自动翻译。'),
          h('label', { style: Object.assign({}, S.row, { marginTop: '7px' }) },
            h('input', { type: 'checkbox', 'aria-label': '挂载句单字错字容错', checked: config.closestMountTolerance === true, onChange: e => save({ closestMountTolerance: e.target.checked }) }),
            h('span', null, '挂载句单字错字容错（默认关闭）')),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '2px 0 7px' } }, '开启后只接受唯一、长度足够且仅差一个非动作/颜色/方向/否定字的句子；其他情况仍跳过该图。'),
          h('label', { style: { display: 'block', fontSize: '12px', margin: '7px 0 3px' } }, '角色生成要求'),
          h('textarea', { 'aria-label': '角色生成要求', value: characterRequirements, placeholder: '补充角色外貌、字段写法或其他生成偏好', style: area('55px'), onChange: e => setCharacterRequirements(e.target.value) }),
          h('label', { style: { display: 'block', fontSize: '12px', margin: '7px 0 3px' } }, '服装生成要求'),
          h('textarea', { 'aria-label': '服装生成要求', value: outfitRequirements, placeholder: '补充服装款式、命名或字段写法要求', style: area('55px'), onChange: e => setOutfitRequirements(e.target.value) }),
          h('button', { style: Object.assign({}, buttonStyle, { marginTop: '5px' }), onClick: async () => {
            const result = await save({ characterDesignRequirements: characterRequirements, outfitDesignRequirements: outfitRequirements })
            setMessage(result ? '角色与服装生成要求已保存。' : '保存失败。')
          } }, '保存角色与服装要求'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' } }, library.map(profile => h('button', { key: profile.id, style: Object.assign({}, buttonStyle, { borderColor: activeId === profile.id ? 'var(--dsw-alias-brand-primary)' : undefined }), onClick: () => save({ activePromptPreset: profile.id }) }, (activeId === profile.id ? '● ' : '○ ') + profile.name))),
          h('div', { style: Object.assign({}, S.row, { marginTop: '7px' }) }, h('button', { style: buttonStyle, disabled: draft.length >= 60, onClick: addBlank }, '新建空白预设'), h('button', { style: buttonStyle, onClick: () => save({ activePromptPreset: '' }) }, '不使用预设')),
          draft.map((p, i) => h('div', { key: p.id || i, style: { padding: '9px', marginTop: '8px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent)', borderRadius: '8px' } },
            h('div', { style: S.row }, h('input', { type: 'radio', name: 'dsh-prompt-preset', checked: activeId === String(p.id), onChange: () => save({ activePromptPreset: String(p.id) }) }), h('input', { value: p.name || '', style: Object.assign({}, S.input, { flex: 1 }), onChange: e => edit(i, 'name', e.target.value) }), h('button', { style: buttonStyle, onClick: () => { const next = draft.filter((_, n) => n !== i); setDraft(next); save({ promptPresets: next, activePromptPreset: activeId === String(p.id) ? '' : activeId }) } }, '删除')),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '5px 0 3px' } }, '正面指导'), h('textarea', { 'aria-label': '预设正面指导 ' + (p.name || i + 1), value: p.positive || '', style: area('60px'), onChange: e => edit(i, 'positive', e.target.value) }),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '5px 0 3px' } }, '负面指导'), h('textarea', { 'aria-label': '预设负面指导 ' + (p.name || i + 1), value: p.negative || '', style: area('42px'), onChange: e => edit(i, 'negative', e.target.value) }),
          )),
          h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
            h('button', { style: buttonStyle, onClick: () => addCopy(active || library[1]) }, '复制当前预设'),
            h('button', { style: buttonStyle, onClick: async () => {
              const result = await save({ promptPresets: draft })
              if (result) { try { window.localStorage?.removeItem(draftStorageKey) } catch {}; setMessage('预设已保存。') }
              else setMessage('保存失败。')
            } }, '保存预设'),
            h('button', { style: buttonStyle, onClick: exportPresets }, '导出 JSON')),
          h('textarea', { value: importText, placeholder: '粘贴单个预设对象或 JSON 数组', style: Object.assign({}, area('48px'), { marginTop: '7px' }), onChange: e => setImportText(e.target.value) }),
          h('button', { style: Object.assign({}, buttonStyle, { marginTop: '5px' }), onClick: importPresets }, '导入 JSON'),
          active ? h('div', { style: { marginTop: '8px', padding: '8px', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 4%, transparent)', borderRadius: '7px', fontSize: '12px' } },
            h('div', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '正面预览'), h('div', { style: { whiteSpace: 'pre-wrap' } }, config.promptPreviewPositive || active.positive || ''),
            h('div', { style: { color: 'var(--dsw-alias-label-tertiary)', marginTop: '5px' } }, '负面预览'), h('div', { style: { whiteSpace: 'pre-wrap' } }, config.promptPreviewNegative || active.negative || '')) : null,
          h('div', { style: { borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)', marginTop: '10px', paddingTop: '9px' } },
            h('div', { style: { fontSize: '12px', marginBottom: '4px' } }, '手动提示词覆盖'),
            h('textarea', { value: manualPositive, placeholder: '附加到所有正面提示词', style: area('42px'), onChange: e => setManualPositive(e.target.value) }),
            h('textarea', { value: manualNegative, placeholder: '附加到所有负面提示词', style: Object.assign({}, area('38px'), { marginTop: '4px' }), onChange: e => setManualNegative(e.target.value) }),
            h('button', { style: Object.assign({}, buttonStyle, { marginTop: '5px' }), onClick: () => save({ promptManualPositive: manualPositive, promptManualNegative: manualNegative }) }, '保存手动覆盖')),
          h('div', { style: { borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)', marginTop: '10px', paddingTop: '9px' } },
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' } }, h('input', { type: 'checkbox', checked: config.jpegOutput === true, onChange: e => save({ jpegOutput: e.target.checked }) }), '将 PNG 转为 JPEG（有损压缩）'),
            h('div', { style: S.row }, h('label', { style: S.label }, '质量 50–100'), h('input', { type: 'number', min: 50, max: 100, value: quality, style: Object.assign({}, S.input, { width: '75px' }), onChange: e => setQuality(e.target.value) }), h('label', { style: S.label }, '透明底色'), h('input', { type: 'color', value: background, onChange: e => setBackground(e.target.value) }), h('button', { style: buttonStyle, onClick: () => save({ jpegQuality: quality, jpegBackground: background }) }, '保存')),
            h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, '仅转换 PNG；GIF/WebP 或转换失败时保留原图并显示提示。')),
          message ? h('div', { style: { fontSize: '12px', marginTop: '7px', color: 'var(--dsw-alias-brand-primary)' } }, message) : null,
        )
      }

      // ---- 工作流 ----
      function pluginUpdateTab() {
        const releaseMode = pluginUpdateLocal?.mode === 'release'
        const supported = releaseMode || pluginUpdateLocal?.supported === true
        const canCheck = (releaseMode || pluginUpdateLocal?.supported === true) && pluginUpdateLocal?.compatibility?.compatible !== false
        const version = value => value ? String(value) : '暂无结果'
        const restartNeeded = pluginUpdateCheck?.restartRequired === true || pluginUpdateLocal?.restartRequired === true
        const canUpdate = supported && pluginUpdateCheck?.available === true && pluginUpdateCheck?.canUpdate === true && !restartNeeded
        const latestConfirmed = pluginUpdateCheck?.available === false && pluginUpdateCheck?.restartRequired !== true && pluginUpdateCheck?.supported !== false && pluginUpdateLocal?.supported !== false && !pluginUpdateCheck?.reason && !pluginUpdateLocal?.reason
        const migrationNeeded = pluginUpdateLocal?.directoryMigrationRequired === true && pluginUpdateLocal?.supported !== false
        const downloads = data.pluginDownloads && typeof data.pluginDownloads === 'object' ? data.pluginDownloads : {}
        const externalDownload = (key, hostname, pathname) => {
          try {
            const url = new URL(String(downloads[key] ?? ''))
            if (url.protocol !== 'https:' || url.hostname !== hostname || url.port || url.username || url.password || url.search || url.hash || url.pathname !== pathname) return ''
            return url.href
          } catch { return '' }
        }
        const localDownloadPath = (() => {
          try {
            const value = String(downloads.local ?? '')
            if (!value.startsWith('/') || value.startsWith('//')) return ''
            const url = new URL(value, window.location.origin)
            const validPath = ['/api/dsh-tavern-image/plugin-download', '/api/dsh-tavern-comfy/plugin-download', '/plugins/dsh-tavern-image/plugin-download', '/plugins/dsh-tavern-comfy/plugin-download'].includes(url.pathname)
            return url.origin === window.location.origin && validPath && !url.username && !url.password && !url.search && !url.hash ? url.pathname : ''
          } catch { return '' }
        })()
        const sourceUrl = externalDownload('source', 'github.com', '/weixinlll/dsh-tavern-image/archive/refs/heads/master.zip')
        const alternateUrl = externalDownload('alternate', 'codeload.github.com', '/weixinlll/dsh-tavern-image/zip/refs/heads/master')
        const releasesUrl = externalDownload('releases', 'github.com', '/weixinlll/dsh-tavern-image/releases')
        const repositoryUrl = externalDownload('repository', 'github.com', '/weixinlll/dsh-tavern-image.git')
        async function downloadLocalPackage() {
          if (!localDownloadPath) return
          setPluginUpdateNote('正在生成本机安装包…')
          try {
            const response = await fetch(localDownloadPath, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
            if (!response.ok) {
              let detail = ''
              try { detail = (await response.json())?.error || '' } catch {}
              throw new Error(detail || ('HTTP ' + response.status))
            }
            const type = String(response.headers.get('content-type') || '').toLowerCase()
            if (!type.includes('application/zip')) throw new Error('服务没有返回 ZIP 安装包')
            const blobUrl = URL.createObjectURL(await response.blob())
            const anchor = document.createElement('a')
            anchor.href = blobUrl
            anchor.download = 'dsh-tavern-image-local.zip'
            document.body.appendChild(anchor)
            anchor.click()
            anchor.remove()
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
            setPluginUpdateNote('✓ 本机安装包已开始下载。它包含当前本机插件代码和测试改动。')
          } catch (error) {
            setPluginUpdateNote('本机安装包下载失败：' + String(error?.message ?? error))
          }
        }
        const linkStyle = Object.assign({}, buttonStyle, { display: 'inline-block', textDecoration: 'none' })
        return h('div', null,
          h('div', { style: S.card },
            h('div', { style: { fontSize: '14px', fontWeight: 600, marginBottom: '8px' } }, '插件更新'),
            h('div', { role: 'note', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } }, releaseMode ? 'Release 更新：下载官方发布包并校验 SHA-256。' : 'Git 更新：仅对官方、干净的 master checkout 执行 fast-forward。'),
            pluginUpdateLocal?.compatibility?.compatible === false ? h('div', { role: 'alert', style: { fontSize: '12px', color: 'var(--dsw-alias-state-warning-primary)', marginBottom: '8px' } }, pluginUpdateLocal.compatibility.reason || '当前 Tavern 版本不兼容，请先更新 Tavern。') : null,
            h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', gap: '6px 12px', fontSize: '13px' } },
              h('span', { style: S.label }, '当前版本'), h('span', null, version(pluginUpdateLocal?.currentVersion)),
              h('span', { style: S.label }, '远端版本'), h('span', null, version(pluginUpdateCheck?.latestVersion)),
            ),
            latestConfirmed ? h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '8px' } }, '当前已是最新版本。') : null,
            pluginUpdateLocal?.supported === false && repositoryUrl ? h('a', { href: repositoryUrl.slice(0, -4), target: '_blank', rel: 'noopener noreferrer', style: { display: 'inline-block', marginTop: '8px', color: 'var(--dsw-alias-brand-primary)' } }, '打开插件 GitHub 页面手动下载') : null,
            h('div', { style: S.row },
              h('button', { style: buttonStyle, disabled: !canCheck || Boolean(pluginUpdatePending), onClick: () => { setPluginUpdateCheck(null); void checkPluginUpdate() } }, pluginUpdatePending === 'check' ? '正在检查…' : '检查更新'),
              h('button', { style: buttonStyle, disabled: !canUpdate || Boolean(pluginUpdatePending), onClick: applyPluginUpdate }, pluginUpdatePending === 'apply' ? '正在更新…' : '更新插件'),
              !pluginUpdateLocal && pluginUpdatePending !== 'local' ? h('button', { style: buttonStyle, disabled: Boolean(pluginUpdatePending), onClick: () => { pluginUpdateLocalAttempted.current = true; void loadPluginUpdateLocal() } }, '重试读取本地状态') : null,
            ),
            h('div', { role: 'status', 'aria-live': 'polite', style: { minHeight: '18px', fontSize: '12px', color: restartNeeded || migrationNeeded ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-tertiary)', marginTop: '8px' } },
              pluginUpdateNote || (pluginUpdatePending === 'local' ? '读取本地插件状态…' : ''),
            ),
            migrationNeeded ? h('div', { role: 'note', style: { fontSize: '12px', color: 'var(--dsw-alias-state-warning-primary)', marginTop: '8px', lineHeight: 1.55 } }, pluginUpdateLocal.directoryMigrationMessage) : null,
            h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '8px', lineHeight: 1.55 } }, releaseMode ? 'Release 更新使用发布 metadata 中的版本和 SHA-256 校验；只更新插件代码，更新后请完整重启 DSH。' : 'Git 更新仅允许官方干净 master checkout 快进；只更新插件代码，更新后请完整重启 DSH。'),
            h('div', { style: { borderTop: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent)', marginTop: '12px', paddingTop: '10px' } },
              h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', marginBottom: '6px' } }, '手动下载插件包'),
              h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '9px', lineHeight: 1.55 } }, '本机安装包包含当前本机代码（包括未发布测试改动）；GitHub ZIP 与备用下载是公开仓库 master 版本，不包含本机测试改动。若公开 ZIP 下载较慢，可试备用下载；它也由 GitHub codeload 提供。历史发布可选稳定版本。'),
              h('div', { style: S.row },
                h('button', { type: 'button', style: buttonStyle, disabled: !localDownloadPath, onClick: downloadLocalPackage }, '本机安装包'),
                sourceUrl ? h('a', { href: sourceUrl, target: '_blank', rel: 'noopener noreferrer', style: linkStyle }, 'GitHub 源码ZIP') : null,
                alternateUrl ? h('a', { href: alternateUrl, target: '_blank', rel: 'noopener noreferrer', style: linkStyle }, '备用下载') : null,
                releasesUrl ? h('a', { href: releasesUrl, target: '_blank', rel: 'noopener noreferrer', style: linkStyle }, '历史发布') : null,
              ),
              !localDownloadPath && !sourceUrl && !alternateUrl && !releasesUrl ? h('div', { role: 'status', style: { fontSize: '11px', color: 'var(--dsw-alias-state-warning-primary)', marginTop: '6px' } }, '下载地址尚不可用，请刷新控制台状态后重试。') : null,
            ),
          ),
        )
      }

      const tabs = [['plan', '设置'], ['people', '人物库'], ['worldbook', '世界书'], ['gallery', '画廊']]
      const section = text => h('div', { style: { fontSize: '14px', fontWeight: 600, margin: '18px 0 2px', color: 'var(--dsw-alias-label-primary)' } }, text)
      return h('div', { className: 'dti-settings', style: Object.assign({}, S.surface, { padding: '4px 2px 20px', fontSize: '13px' }) },
        h('style', null, SETTINGS_CSS),
        // 连接状态就在「渠道」里的测试按钮旁边，顶部不再单放一个状态框；这里只留保存等操作的提示。
        note ? h('div', { role: 'status', style: { fontSize: '12px', margin: '0 0 8px', color: 'var(--dsw-alias-brand-primary)' } }, note) : null,
        // 总开关放在最上面：关掉后不再自动或手动配图，正文里不显示配图按钮，已有插图照常显示。
        h('label', { style: Object.assign({}, S.card, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginTop: 0, cursor: 'pointer' }) },
          h('span', null,
            h('span', { style: { display: 'block', fontSize: '14px', fontWeight: 600 } }, '启用配图'),
            h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px' } },
              config.imageEnabled === false ? '已关闭：不再自动或手动配图，正文里不显示配图按钮；已有插图照常显示' : '为剧情自动或手动配图；关掉后正文里不显示配图按钮，已有插图照常显示')),
          h('input', { type: 'checkbox', role: 'switch', className: 'dti-switch', 'aria-label': '启用配图', checked: config.imageEnabled !== false, onChange: e => save({ imageEnabled: e.target.checked }) })),
        taskPanel(),
        h('div', { style: S.row }, tabs.map(([key, label]) => h('button', { key, style: S.tab(tab === key), onClick: () => setTab(key) }, label))),
        // 设置页按第一次配置的顺序排：先接渠道，再定每轮怎么配图，最后是画风。
        tab === 'plan' ? h('div', null,
          section('渠道'),
          ComfyBackendCard(),
          imageBackend === 'comfyui' ? workflowCard() : null,
          section('配图规则'),
          generationModeCard(),
          planTab(),
          section('画风'),
          stylePresetCard(),
          h(PromptPresetCard),
        ) : null,
        tab === 'people' ? peopleTab() : null,
        tab === 'gallery' ? galleryTab() : null,
        tab === 'worldbook' ? worldbookTab() : null,
        tab === 'people' ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '14px' } }, '人物与服装修改后请点「保存人物库」。') : null,
        // 注意：openWorkflow 定义在 workflow 标签页函数内部，这里跨作用域调用会 ReferenceError。
        // 保存后只做本层能做的收尾：关掉编辑器、清掉旧详情，让用户重新点开时读到新数据。
        wfGraphFile ? h(WorkflowGraphEditor, {
          file: wfGraphFile,
          post,
          onClose: () => setWfGraphFile(''),
          onSaved: () => {
            setWfGraphFile('')
            setWfDetail(null)
            setWfNote('工作流已保存，重新点开即可看到新参数')
          },
        }) : null,
      )
    }
    function apply(ctx) {
      // 诊断：证明 apply 被调到，并看清 ctx 上到底有什么
      try {
        let keys = null
        try { keys = Object.keys(ctx ?? {}).slice(0, 40) } catch { keys = null }
        // 只探测公开服务。不再去问 Tavern 的补丁服务在不在 —— 补丁方案已废弃，
        // 那个字段既没有意义，也把插件和 Tavern 的内部实现绑在一起。
        let hasTavernUi = null
        try { hasTavernUi = Boolean(ctx && typeof ctx.get === 'function' && ctx.get('tavernUi')) } catch { hasTavernUi = 'threw' }
        reportHost('apply-start', {
          hasSlots: Boolean(ctx && ctx.slots),
          hasGet: Boolean(ctx && typeof ctx.get === 'function'),
          hasEffect: Boolean(ctx && typeof ctx.effect === 'function'),
          hasTavernUi,
          ctxKeys: keys,
        })
      } catch (error) { reportHost('apply-report-failed', { message: String(error && error.message) }) }
      try {
        // 默认：标记通道按配置走；规划通道读不到配置就先不开（免得每轮白跑一次模型）
        // 默认先按「开」处理：渲染器可能在配置读回来之前就被调用，第一次太保守会整条消息都不接管
        const settings = { autoImageGen: true, plannerEnabled: true, smartImageSelection: true, imageEnabled: true }
        // 配图总开关变化时重新登记 illustrator（关掉时不给 draw，Tavern 就不显示配图按钮）。
        let refreshIllustrator = null
        const applyImageEnabled = value => {
          const next = value !== false
          if (next === settings.imageEnabled) return
          settings.imageEnabled = next
          refreshIllustrator?.()
        }
        window.addEventListener('dsh-tavern-image:config', event => applyImageEnabled(event?.detail?.imageEnabled))
        jsonFetch(`${BASE}/state`).then(state => {
          if (state?.config) {
            settings.autoImageGen = state.config.autoImageGen !== false
            settings.plannerEnabled = state.config.plannerEnabled !== false
            settings.smartImageSelection = state.config.smartImageSelection !== false
            applyImageEnabled(state.config.imageEnabled)
            // 正文插图统一宽度：每次启动都从 /state 读回来，所以刷新 / 重启之后依然生效。
            applyImageWidth(state.config.imageDisplayWidth)
          }
        }).catch(() => { /* 拿不到配置就安静退化成只在有标记时出图 */ })

        // 全屏看图浮层
        try {
          ctx.slots?.inject?.('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-tavern-image-overlay',
            order: 90,
          }, ImageOverlay))
          reportHost('seat-registered', { seat: 'shell.overlay' })
        } catch (error) {
          reportHost('seat-failed', { seat: 'shell.overlay', error: String(error?.message ?? error) })
        }

        // 提示词编辑浮层（长按图片打开）
        try {
          ctx.slots?.inject?.('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-tavern-image-prompt-editor',
            order: 91,
          }, PromptEditor))
          reportHost('seat-registered', { seat: 'shell.overlay.prompt-editor' })
        } catch (error) {
          reportHost('seat-failed', { seat: 'prompt-editor', error: String(error?.message ?? error) })
        }


        // 卡片选择弹窗
        try {
          ctx.slots?.inject?.('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-tavern-image-cardpicker',
            order: 93,
          }, CardPicker))
          reportHost('seat-registered', { seat: 'shell.overlay.cardpicker' })
        } catch (error) {
          reportHost('seat-failed', { seat: 'cardpicker', error: String(error?.message ?? error) })
        }

        // 浮层提示
        try {
          ctx.slots?.inject?.('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-tavern-image-toast',
            order: 99,
          }, Toast))
          reportHost('seat-registered', { seat: 'shell.overlay.toast' })
        } catch (error) {
          reportHost('seat-failed', { seat: 'toast', error: String(error?.message ?? error) })
        }

        // 右键菜单
        try {
          ctx.slots?.inject?.('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-tavern-image-contextmenu',
            order: 100,
          }, ContextMenu))
          reportHost('seat-registered', { seat: 'shell.overlay.contextmenu' })
        } catch (error) {
          reportHost('seat-failed', { seat: 'design', error: String(error?.message ?? error) })
        }

        // 助手消息下方的动作（和 Tavern 的分叉、场景生图同一排）
        try {
          const ok = ctx.slots?.inject?.('conversation.chat.assistant-actions', () => ctx.slots.register({
            name: 'conversation.chat.assistant-actions',
            id: 'dsh-tavern-image',
            order: 30,
            inject: (sessionId) => ({ sessionId }),
            // Tavern 第 5 版有自己的配图按钮（由本插件出图），这颗就不再显示。
          }, props => typeof tavernUiService?.registerIllustrator === 'function' ? null : h(ImageActionButton, props)))
          reportHost('seat-registered', { seat: 'assistant-actions', injectReturned: ok !== undefined })
        } catch (error) {
          reportHost('seat-failed', { seat: 'assistant-actions', error: String(error?.message ?? error) })
          console.warn('[dsh-tavern-image] 生图按钮未注册:', error?.message)
        }

        // 设置 → 配图：插件唯一的配置入口（不再有侧栏按钮和控制台弹窗）
        try {
          reportHost('seat-registered', { seat: 'settings.section' })
          ctx.slots?.inject?.('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'dsh-tavern-image',
            order: 111,
            label: () => '配图',
          }, SettingsPanel))
        } catch (error) {
          console.warn('[dsh-tavern-image] 设置页面未注册:', error?.message)
        }

        // ===== Tavern 官方浏览器接口（tavernUi，接口版本 1）=====
        // 以前这里是打在 Tavern 上的补丁造出来的 tavernAssistantTextRenderer / registerActions，
        // Tavern 一更新补丁被冲掉，正文里的图和按钮就会一起消失。
        // 现在全部走正门：
        //   · 正文 —— 不再接管，交回 Tavern 原生渲染
        //   · 图   —— 由宿主侧用 tavern.attach 挂到正文的挂载句后面（Tavern 自己渲染、自己管版本）
        //   · 按钮 —— tavernUi.registerMessageAction
        ctx.inject?.(['tavernUi'], owner => {
          const ui = owner.tavernUi
          tavernUiService = ui || null
          if (!ui || ui.apiVersion < 1) {
            reportHost('tavernui-missing', { got: Boolean(ui) })
            try { console.warn('[dsh-tavern-image] 当前 Tavern 没有 tavernUi 接口，生图按钮不可用') } catch {}
            return
          }
          reportHost('tavernui-attached', { apiVersion: ui.apiVersion })
          if (ui.apiVersion >= 2 && typeof ui.registerPanel === 'function') {
            function CharacterHistoryPanel({ gameId }) {
              const [history, setHistory] = React.useState({ loading: true, snapshot: null })
              const [busy, setBusy] = React.useState(false)
              const [notice, setNotice] = React.useState('')
              const requestEpoch = React.useRef(null)
              if (!requestEpoch.current) requestEpoch.current = createHistoryRequestEpoch()
              requestEpoch.current.activate(gameId)
              React.useEffect(() => { setBusy(false); setNotice('') }, [gameId])
              const refresh = React.useCallback(async () => {
                if (!requestEpoch.current.isActive(gameId)) return
                if (!gameId) { setHistory({ loading: false, snapshot: null, loadedGameId: '' }); return }
                const token = requestEpoch.current.begin(gameId)
                setHistory(current => Object.assign({}, current, { loading: true }))
                try {
                  const result = await jsonFetch(BASE + '/character-history?gameId=' + encodeURIComponent(gameId))
                  if (requestEpoch.current.isCurrent(gameId, token)) setHistory(Object.assign({}, result, { loading: false, loadedGameId: gameId }))
                } catch (error) {
                  if (requestEpoch.current.isCurrent(gameId, token)) setHistory({ loading: false, error: String(error?.message ?? error), loadedGameId: gameId })
                }
              }, [gameId])
              React.useEffect(() => {
                void refresh()
                return () => requestEpoch.current.invalidate(gameId)
              }, [refresh, gameId])
              const historyMatchesGame = history.loadedGameId === String(gameId ?? '')
              const canRestore = historyMatchesGame && Number(history.currentTurn) > 0
              const restore = async (index, expectedChange) => {
                if (!canRestore || !requestEpoch.current.isActive(gameId)) return
                const gameToken = requestEpoch.current.captureGame(gameId)
                requestEpoch.current.begin(gameId)
                setBusy(true); setNotice('')
                try {
                  await jsonFetch(BASE + '/character-history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId, changeIndex: index, expectedChange }) })
                  if (!requestEpoch.current.isGameCurrent(gameId, gameToken)) return
                  setNotice('已在当前正文版本记录恢复结果。')
                  await refresh()
                } catch (error) {
                  if (requestEpoch.current.isGameCurrent(gameId, gameToken)) setNotice(String(error?.message ?? error))
                } finally {
                  if (requestEpoch.current.isGameCurrent(gameId, gameToken)) setBusy(false)
                }
              }
              if (history.loading || !historyMatchesGame) return h('div', { style: { padding: '16px', color: '#9aa3b2' } }, '正在读取当前剧情线的角色历史…')
              if (history.available === false) return h('div', { style: { padding: '16px', color: '#9aa3b2', lineHeight: 1.6 } }, history.reason || '角色历史需要 Tavern 插件接口 v2。')
              const changes = Array.isArray(history.snapshot?.changes) ? history.snapshot.changes : []
              return h('div', { style: { padding: '14px', color: '#e8edf5', overflowY: 'auto', height: '100%', boxSizing: 'border-box' } },
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '12px' } },
                  h('div', null,
                    h('div', { style: { fontWeight: 600, fontSize: '14px' } }, '角色视觉历史'),
                    h('div', { style: { fontSize: '11px', color: '#9aa3b2', marginTop: '4px' } }, '当前剧情线 · 最新快照' + (history.turn ? ' · 第 ' + history.turn + ' 轮' : '')),
                  ),
                  h('button', { type: 'button', onClick: refresh, style: { background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,.2)', borderRadius: '7px', padding: '5px 9px', cursor: 'pointer' } }, '刷新'),
                ),
                notice ? h('div', { role: 'status', style: { padding: '8px', marginBottom: '10px', borderRadius: '7px', background: 'rgba(84,198,235,.1)', color: '#bfeafa', fontSize: '12px' } }, notice) : null,
                history.error ? h('div', { role: 'alert', style: { color: '#ff9b9b', fontSize: '12px' } }, history.error) : null,
                !canRestore ? h('div', { style: { padding: '8px', marginBottom: '10px', borderRadius: '7px', background: 'rgba(255,212,128,.08)', color: '#ffd480', fontSize: '12px', lineHeight: 1.5 } }, '请先完成一轮结算或点击当前消息的生图按钮，确认轮次后再恢复。') : null,
                !changes.length ? h('div', { style: { color: '#9aa3b2', fontSize: '12px', lineHeight: 1.6 } }, '当前剧情线还没有明确的永久外貌变化记录。') : indexedHistoryChanges(changes).map(({ change, index }) => {
                  return h('article', { key: change.id + ':' + change.turn + ':' + index, style: { padding: '10px', marginBottom: '8px', border: '1px solid rgba(255,255,255,.12)', borderRadius: '9px', background: 'rgba(255,255,255,.025)' } },
                    h('div', { style: { fontSize: '12px', fontWeight: 600 } }, (change.name || '角色') + ' · ' + (change.field || '外貌') + ' · 第 ' + (change.turn || '?') + ' 轮'),
                    change.before ? h('div', { style: { fontSize: '12px', color: '#9aa3b2', marginTop: '6px' } }, '之前：' + change.before) : null,
                    h('div', { style: { fontSize: '12px', marginTop: '5px' } }, '之后：' + (change.after || '已清除')),
                    h('div', { style: { fontSize: '11px', color: '#9aa3b2', marginTop: '6px', lineHeight: 1.5 } }, (change.reason || '剧情明确变化') + (change.at ? ' · ' + new Date(change.at).toLocaleString() : '')),
                    h('button', { type: 'button', disabled: busy || !canRestore, onClick: () => restore(index, change), style: { marginTop: '8px', background: 'transparent', color: '#bfeafa', border: '1px solid rgba(84,198,235,.35)', borderRadius: '7px', padding: '5px 9px', cursor: busy || !canRestore ? 'default' : 'pointer', opacity: busy || !canRestore ? .45 : 1 } }, '恢复到变化前'),
                  )
                }),
                history.snapshot?.warning ? h('div', { style: { marginTop: '10px', color: '#ffd480', fontSize: '11px' } }, history.snapshot.warning) : null,
              )
            }
            try {
              const off = ui.registerPanel({ id: 'character-history', title: '角色历史', render: ({ gameId }) => h(CharacterHistoryPanel, { gameId }) })
              owner.effect?.(() => off, 'dsh-tavern-image: character history panel')
            } catch (error) { reportHost('character-history-panel-failed', { error: String(error?.message ?? error).slice(0, 160) }) }
          }
          try {
            const drawTurn = async context => {
              const body = { gameId: context.gameId, turn: context.turn }
              if (context.instruction !== undefined) {
                if (typeof context.instruction !== 'string') throw new TypeError('配图要求必须是文本')
                const instruction = context.instruction.trim()
                if (instruction.length > 2000) throw new RangeError('配图要求不能超过 2000 字')
                if (instruction) body.instruction = instruction
              }
              const r = await jsonFetch(BASE + '/draw-turn', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              }).catch(error => ({ ok: false, error: String(error && error.message || error) }))
              reportHost('attach-turn', {
                gameId: String(context && context.gameId || '').slice(0, 12), turn: context && context.turn,
                ok: Boolean(r && r.ok), attached: r && r.attached, error: String(r && r.error || '').slice(0, 160),
              })
              return r
            }
            const runMessageDraw = createMessageDrawRunner(async context => {
              const r = await drawTurn(context)
              if (typeof showToast === 'function') {
                if (r && r.ok && r.attached) showToast('已提交 ' + r.attached + ' 张，出图后自动插进正文' + (Array.isArray(r.warnings) && r.warnings.length ? '。' + r.warnings.join('；') : ''))
                else if (r && r.ok && r.skipped) showToast('本轮自动跳过配图：' + (r.reason || '没有合适的画面'))
                else showToast('生图没出画面：' + ((r && r.error) || '规划没有产出画面'))
              }
              return r
            }, () => { if (typeof showToast === 'function') showToast('正在提交，等待本轮正文数据…') })
            // Tavern 第 5 版起提供配图按钮和插图卡：本插件只负责出图，界面交给 Tavern。
            const illustrates = typeof ui.registerIllustrator === 'function'
            if (illustrates) {
              const mediaAction = (operation, context, extra = {}) => {
                const data = context.item && context.item.data || {}
                return jsonFetch(BASE + '/media-action', {
                  method: 'POST', headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ operation, gameId: context.gameId, turn: context.turn, textVersion: context.textVersion,
                    mediaId: context.item.id, jobId: String(data.replacement && data.replacement.jobId || data.jobId || ''), ...extra }),
                }).then(result => { if (!result || !result.ok) throw new Error(result && result.error || '请求未确认'); return result })
              }
              // 进度和结果由 Tavern 显示在这一轮正文里：成功不提示，跳过返回说明，失败抛错。
              const draw = createMessageDrawRunner(async context => {
                const r = await drawTurn(context)
                if (r && r.ok && r.attached) return Array.isArray(r.warnings) && r.warnings.length ? { notice: '已配图。' + r.warnings.join('；') } : {}
                if (r && r.ok && r.skipped) return { notice: '本轮跳过配图：' + (r.reason || '没有合适的画面') }
                throw new Error('没出画面：' + ((r && r.error) || '规划没有产出画面'))
              })
              let offIllustrator = null
              refreshIllustrator = () => {
                try { offIllustrator?.() } catch {}
                offIllustrator = ui.registerIllustrator({
                  kinds: ['dsh-tavern-image/image', 'dsh-tavern-comfy/image'],
                  ...(settings.imageEnabled ? { draw } : {}),
                  redraw: context => mediaAction('redraw', context),
                  revise: context => mediaAction('revise', context, { instruction: context.instruction || '' }),
                  editPrompt: context => mediaAction('redraw', context, { prompt: context.prompt }),
                  cancel: context => mediaAction('cancel', context),
                  // 图上的「重试」「查询结果」：由宿主侧按任务状态写进 item.actions。
                  action: context => context.actionId === 'force-redraw'
                    ? mediaAction('redraw', context, { confirmUncertain: true })
                    : mediaAction(context.actionId, context),
                })
              }
              refreshIllustrator()
              owner.effect?.(() => () => { refreshIllustrator = null; offIllustrator?.() }, 'dsh-tavern-image: illustrator')
            } else {
              const off = ui.registerMessageAction({
                id: 'dsh-tavern-image-draw',
                label: '🎨 生图',
                when: context => Boolean(context && context.gameId) && Number(context.turn) > 0,
                run: runMessageDraw,
              })
              owner.effect?.(() => off, 'dsh-tavern-image: message action')
            }

          // 正文里的 image###英文Tag### 标记：就地画一张图。
          // 自动配图走的是宿主侧 tavern.attach（Tavern 自己渲染、跟正文版本绑定）；
          // 这一条是"模型自己在正文里写了标记"时的通道，两条互不干扰。
          try {
            const offMarker = ui.registerTextMarker({
              // 传一份**新的**正则实例：IMAGE_TAG 带 /g，共享同一个对象时 lastIndex
              // 会被上一次匹配带着走，容易漏掉标记。
              pattern: new RegExp(IMAGE_TAG.source, IMAGE_TAG.flags),
              render: ({ groups, gameId, turn, streaming }) => {
                try {
                  if (streaming) return null            // 生成中不画，免得画出半句话
                  if (settings.smartImageSelection) return h('span', { style: { display: 'none' } })
                  const prompt = String((groups && groups[0]) || '').trim()
                  if (!prompt) return null
                  return h(InlineImage, {
                    prompt,
                    imageKey: contentKey(String(gameId || ''), turn, 0, prompt),
                    auto: true,
                  })
                } catch (error) {
                  reportHost('marker-render-failed', { message: String(error && error.message || error).slice(0, 200) })
                  return null
                }
              },
            })
            owner.effect?.(() => offMarker, 'dsh-tavern-image: text marker')
            reportHost('tavernui-marker-registered', { ok: true })

          // 给自己的媒体类型定显示方式：大图 + 点开放大 + 右键/长按改提示词重画（Tavern 有插图卡时由它显示）
          for (const mediaKind of illustrates ? [] : ['dsh-tavern-image/image', 'dsh-tavern-comfy/image']) {
            try {
              const offMedia = ui.registerMediaRenderer(mediaKind, args => h(OfficialImage, {
                item: args && args.item, gameId: args && args.gameId, turn: args && args.turn,
              }))
              owner.effect?.(() => offMedia, 'dsh-tavern-image: media renderer ' + mediaKind)
              reportHost('tavernui-media-registered', { ok: true, mediaKind })
            } catch (error) {
              reportHost('tavernui-media-failed', { mediaKind, message: String(error && error.message || error).slice(0, 200) })
            }
          }
          } catch (error) {
            reportHost('tavernui-marker-failed', { message: String(error && error.message || error).slice(0, 200) })
          }
          } catch (error) {
            reportHost('tavernui-action-failed', { message: String(error && error.message || error).slice(0, 200) })
          }
        })
      } catch (error) {
        console.warn('[dsh-tavern-image] 浏览器半边启动失败:', error?.message)
      }
    }

    exports.name = 'dsh-tavern-image'
    exports.inject = ['slots']
    exports.apply = apply; exports.__test = Object.assign(exports.__test || {}, { OfficialImage, PromptEditor, validMediaContext, createMessageDrawRunner, setToastForTest: fn => { showToast = fn }, hasUncertainMediaAction: mediaId => mediaUncertainActions.has(String(mediaId)) })
    return module.exports
  },
})
