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
// @include capabilities.js
function uiSupportsImageReferences(channel, state) {
  if (!channel) return state?.referenceSupported === true
  if (channel.provider === 'comfyui') return state?.referenceSupported === true && state?.config?.imageBackend === 'comfyui'
  try { return supportsImageReferences(channel) } catch { return false }
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

    // @include transport.js
    const jsonFetch = createJsonTransport({ onRetry: ({ url, error }) => reportHost('fetch-retry', { tail: String(url).slice(-40), msg: String(error.message || '') }) })

    // @include media.js
    // @include settings-fields.js
    // @include card-worldbook.js
    // @include settings.js
    // @include card-gallery.js

    function apply(ctx) {
      // 卡片工作台不再单独占一个设置页：启用开关、公共服装库、卡片世界书都并进了「配图」设置。
      // 卡片画廊要用 tavernUi 查会话标题，取不到就退化成会话短码。
      cardGalleryCtx = ctx
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
