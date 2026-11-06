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
        openPromptEditor({ open: true, openRequestId: requestId, jobId: String(jobId), prompt: '', negative: '', rawPrompt: '', originalPrompt: '', rawPromptSource: '', submittedPromptSource: '', promptAssembly: null, finalPrompt: '', instruction: '', note: '正在读取提示词…', busy: '', loading: true, submitted: false, uncertain: false, mediaContext: validMediaContext(mediaContext) ? mediaContext : null, channelId: '', generationMode: 'text', sourceGenerationMode: '', sourceRequestedGenerationMode: '', sourceGenerationModeReason: '', refreshReferences: false, references: [], submittedPrompt: '', actualPositive: '', actualNegative: '', sourceBackend: '', providerError: '', inputsLoading: true, inputsError: '', inputsReload: 0, showInputs: false, channels: [], channelLoadFailed: false })
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
          const saved = await jsonFetch(BASE + '/definitions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ definitions: merged }),
          })
          if (!saved?.ok) throw new Error(saved?.error || '服务器没有确认保存')
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
            sourceGenerationMode: job.generationMode === 'reference' ? 'reference' : 'text', sourceRequestedGenerationMode: String(job.requestedGenerationMode || ''), sourceGenerationModeReason: String(job.generationModeReason || ''),
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
      const referenceAvailable = selectedReferenceChannel ? selectedReferenceChannel.referenceSupported === true : (backend === 'comfyui' ? view.referenceSupported === true : IMAGE_API_PROTOCOLS.includes(backend) && supportsImageReferences(backend))
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
          view.sourceGenerationMode ? React.createElement('div', { 'aria-label': '原任务生图模式', style: { fontSize: '12px', marginTop: '8px' } },
            '实际生图模式：' + (view.sourceGenerationMode === 'reference' ? '参考图生图' : '文生图')
              + (view.sourceRequestedGenerationMode === 'auto' ? (view.sourceGenerationMode === 'reference' ? '（自动：本张有参考图）' : view.sourceGenerationModeReason === 'unsupported-input' ? '（自动：当前渠道或工作流不支持参考图）' : '（自动：本张没有可用参考图）') : '')) : null,
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
                '\n用途：' + (reference.kind === 'character' ? '身份参考（面部、发型、固有体型比例；不继承服装和姿势）' : reference.kind === 'outfit' ? '服装参考（服饰设计；不继承模特身份）' : reference.kind === 'character-outfit' ? '角色×服装设定图（同时约束身份与这套服饰；不继承姿势和背景）' : '未记录'),
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
          const r = await jsonFetch(BASE + '/history?source=play')
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
      const dialogRef = React.useRef(null)
      const onWheel = React.useCallback(event => {
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
      openImageOverlay = (next) => setView(current => Object.assign({}, current, next && next.open ? Object.assign({ index: 0, versionAt: 0, versions: [], images: null, jobIds: [] }, next) : next))
      const close = () => openImageOverlay({ open: false, jobIds: [], versions: [], versionAt: 0, note: '', working: false, index: 0 })
      const total = (view.images ?? view.jobIds).length
      const at = total ? Math.max(0, Math.min(total - 1, Number(view.index) || 0)) : 0
      // 当前这张图自己的重画版本链（与整场翻页互不影响）
      const versions = Array.isArray(view.versions) ? view.versions : []
      const vTotal = versions.length
      const vAt = vTotal ? Math.max(0, Math.min(vTotal - 1, Number(view.versionAt) || 0)) : 0
      // 真正显示的那张：有版本链就用版本链的当前版，否则用主列表的当前张
      const shownImage = view.images?.[at]
      const shownId = vTotal ? versions[vAt] : (shownImage?.jobId || view.jobIds[at])
      const src = shownImage?.url || (shownId ? BASE + '/jobs?id=' + encodeURIComponent(shownId) + '&image=1' : '')
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
      React.useLayoutEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return
        dialog.showModal()
        return () => dialog.close()
      }, [view.open])
      const onKey = event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
        else if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
      }
      React.useEffect(() => { setZoom(1); setPos({ x: 0, y: 0 }); onDragEnd() }, [view.open, src, onDragEnd])
      if (!view.open) return null
      const controls = {
        ...buttonStyle, padding: '6px 9px', minWidth: 32, minHeight: 34, color: '#e6ecf5',
        borderColor: 'rgba(160,180,210,.45)', background: 'rgba(255,255,255,.08)',
      }
      return React.createElement('dialog', {
        ref: dialogRef, 'aria-label': view.note || '图片预览', onKeyDown: onKey,
        onCancel: event => { event.preventDefault(); close() },
        style: {
          position: 'fixed', inset: 0, margin: 0, border: 0, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none',
          background: '#14171c', overflow: 'hidden', padding: '12px clamp(8px, 2vw, 20px)', boxSizing: 'border-box',
        },
        onClick: close,
      }, React.createElement('div', {
        style: { maxWidth: '1440px', height: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 },
        onClick: event => event.stopPropagation(),
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          React.createElement('div', { style: { color: '#e6ecf5', fontSize: '15px', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            view.working ? '正在生成…' : (view.note || '插图')),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' } },
            total > 1 ? React.createElement('button', {
              type: 'button', onClick: () => go(-1), title: '上一张（←）',
              style: controls,
            }, '◀') : null,
            total > 1 ? React.createElement('span', { style: { fontSize: '12px', color: '#9aa3b2', minWidth: '44px', textAlign: 'center' } }, (at + 1) + ' / ' + total) : null,
            total > 1 ? React.createElement('button', {
              type: 'button', onClick: () => go(1), title: '下一张（→）',
              style: controls,
            }, '▶') : null,
            src ? React.createElement('button', { type: 'button', title: '缩小', style: controls, onClick: () => setZoom(z => Math.max(0.2, z / 1.25)) }, '−') : null,
            src ? React.createElement('button', { type: 'button', title: '重置缩放', style: controls,
              onClick: () => { setZoom(1); setPos({ x: 0, y: 0 }) } }, Math.round(zoom * 100) + '%') : null,
            src ? React.createElement('button', { type: 'button', title: '放大', style: controls, onClick: () => setZoom(z => Math.min(8, z * 1.25)) }, '+') : null,
            React.createElement('button', {
              type: 'button', onClick: close,
              style: controls,
            }, '关闭'),
          ),
        ),
        view.working ? React.createElement('div', { style: { color: '#9aa3b2', fontSize: '14px', padding: '30px 0', textAlign: 'center' } }, '规划中，通常十几秒…') : null,
        imageWarning ? React.createElement('div', { role: 'status', style: { color: '#e2b93b', fontSize: '12px', textAlign: 'center', padding: '8px 10px', marginBottom: '8px', background: 'rgba(226,185,59,.1)', borderRadius: '8px' } }, imageWarning) : null,
        React.createElement('div', {
          style: { flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', placeItems: 'center', overflow: 'hidden' },
          onClick: event => { if (event.target === event.currentTarget) close() },
        },
          src ? React.createElement('img', {
            key: src, src, alt: shownImage?.alt || view.note || '插图',
            draggable: false,
            onWheel: onWheel, onMouseDown: onDragStart, onMouseMove: onDragMove, onMouseUp: onDragEnd,
            onMouseLeave: onDragEnd, onTouchStart: onTouchStart, onTouchMove: onTouchMove, onTouchEnd: onDragEnd,
            style: {
              display: 'block', maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto',
              objectFit: 'contain', borderRadius: '12px', background: '#1a1d24',
              cursor: zoom > 1 ? 'grab' : 'default', userSelect: 'none', touchAction: 'none',
              transform: 'translate(' + pos.x + 'px,' + pos.y + 'px) scale(' + zoom + ')',
              transition: dragging ? 'none' : 'transform .12s',
            },
          }) : null,
        ),
          // 这张图自己的重画版本（跟上面"整场翻页"是两回事），只有多于 1 版才显示
          vTotal > 1 ? React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' },
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
        total ? React.createElement('div', { style: { color: '#8b95a5', fontSize: '12px', textAlign: 'center', paddingBottom: 2 } }, '点空白处关闭' + (total > 1 ? '　也可以点上方箭头或按 ← → 切换' : '')) : null,
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
