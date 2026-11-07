    // 预设里的文本输入：非受控 + 防抖。
    // 原来是受控写法直接绑 config，而保存会整体替换 config —— 每敲一个字都被回写覆盖，
    // 光标弹到末尾。改成非受控后 DOM 值归输入框自己管，回写碰不到光标；
    // 顺带把「每个字符一次 POST」压成停手 400ms 才提交，失焦立刻提交。
    // 必须定义在 SettingsPanel 外面：定义在它内部的话，父组件每次重渲染都会产生新的函数引用，
    // React 视作换了一种组件类型，整棵子树卸载重建，光标一样丢。
    function PresetTextField({ value, multiline, placeholder, style, ariaLabel, onCommit }) {
      const ref = React.useRef(null)
      const timer = React.useRef(null)
      React.useEffect(() => {
        const el = ref.current
        // 只在外部值真的变了才改 DOM（切预设这类）；自己保存回来时两者相等，不碰光标。
        if (el && el.value !== (value ?? '')) el.value = value ?? ''
      }, [value])
      const change = event => {
        const next = event.target.value
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { timer.current = null; onCommit(next) }, 400)
      }
      // 失焦立刻落地，不用等那 400ms，也别在切页时把刚敲的字带走。
      const flush = event => {
        if (!timer.current) return
        clearTimeout(timer.current)
        timer.current = null
        onCommit(event.target.value)
      }
      const props = { ref, defaultValue: value ?? '', onChange: change, onBlur: flush, placeholder, style, 'aria-label': ariaLabel }
      return multiline ? h('textarea', props) : h('input', Object.assign({ type: 'text' }, props))
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
      function receiveState(next, requestRevision, savedRevision) {
        if (!next) return
        const current = dataRef.current
        setData((libraryDirty.current || (typeof requestRevision === 'number' && requestRevision !== libraryRevision.current)) && current
          ? Object.assign({}, next, { definitions: savedRevision && current.definitions?.revision === savedRevision ? Object.assign({}, current.definitions, { revision: next.definitions?.revision }) : current.definitions, outfits: current.outfits })
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
      // 画风预设每套默认收起，展开状态只活在界面上。必须放在组件顶层：stylePresetCard 是普通渲染
      // 函数并从 tab 分支里调用，在它内部用 Hook 会让钩子数量随切页变化。
      const [openStylePresets, setOpenStylePresets] = React.useState({})
      // 拖拽状态：{ from: 正在拖的 id, over: 当前悬停到的 id }。放这里是因为 stylePresetCard 是普通渲染函数，不能自己用 Hook。
      const [presetDrag, setPresetDrag] = React.useState(null)
      const [displayWidthDraft, setDisplayWidthDraft] = React.useState(null)
      const [displayWidthNote, setDisplayWidthNote] = React.useState('')
      // 宽度预览用的样例图：最近一张出好的插图。抓不到就退回示意图。
      const [widthSampleJob, setWidthSampleJob] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        jsonFetch(BASE + '/history?source=play').then(r => {
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
      const [libraryConflict, setLibraryConflict] = React.useState(false)
      // 历史图库
      const [historyJobs, setHistoryJobs] = React.useState([])
      const [legacyImages, setLegacyImages] = React.useState([])
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
      // 世界书页签顶部那排切换：play = 本插件（游玩模式），card = 原 dsh-tavern-gen（卡片模式）。
      const [wbSource, setWbSource] = React.useState('play')
      // 画廊页签的切换：默认游玩画廊，卡片画廊按需切过去。
      const [gallerySource, setGallerySource] = React.useState('play')

      const [cardToggleNote, setCardToggleNote] = React.useState('')
      const [cardToggleBusy, setCardToggleBusy] = React.useState(false)
      // 开关状态单独取：image 的 /state 里没有 enabled 字段，照着它渲染会一直弹回开启。
      const [cardEnabled, setCardEnabled] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        jsonFetch('/dsh-tavern-gen/api/tools-enabled')
          .then(value => { if (alive) setCardEnabled(value.enabled !== false) })
          .catch(() => { if (alive) setCardToggleNote('工作台生图暂不可用，请更新并重启插件') })
        return () => { alive = false }
      }, [])
      // 卡片工作台的工具开关：走专用接口，后端只改自己的开关文件。
      const toggleCardStudio = async next => {
        if (cardToggleBusy || cardEnabled === null) return
        setCardToggleBusy(true)
        setCardToggleNote('设置中…')
        try {
          const response = await fetch('/dsh-tavern-gen/api/tools-enabled', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
          })
          const value = await response.json()
          if (!response.ok || !value.ok) throw new Error(value?.error || ('HTTP ' + response.status))
          const enabled = value.enabled !== false
          setCardEnabled(enabled)
          setCardToggleNote(enabled ? '已启用，工作台生图可用' : '已关闭，工作台生图已撤下')
        } catch (error) {
          setCardToggleNote('没改成：' + (error?.message ?? error))
        } finally { setCardToggleBusy(false) }
      }
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
      // Poll only progress while a task runs. Load libraries/worldbooks/diagnostics
      // once on completion; slow requests never overlap and hidden pages stay idle.
      React.useEffect(() => {
        let alive = true
        let inFlight = false
        const poll = async () => {
          if (inFlight || document.hidden || !(dataRef.current?.tasks || []).some(t => t.state === 'running')) return
          inFlight = true
          try {
            const next = await jsonFetch(BASE + '/runtime', { cache: 'no-store' })
            if (!alive || !Array.isArray(next?.tasks)) return
            if (!next.tasks.some(t => t.state === 'running')) await refresh()
            else setData(current => current ? Object.assign({}, current, { tasks: next.tasks }) : current)
          } catch (error) {
            if (alive) setNote('读取任务进度失败：' + (error?.message ?? error))
          } finally { inFlight = false }
        }
        const timer = setInterval(poll, 3000)
        document.addEventListener('visibilitychange', poll)
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', poll) }
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
        jsonFetch(BASE + '/history?source=play', { cache: 'no-store' }).then(r => {
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
            url: BASE + '/history?source=play',
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
        const selectOptionField = (key, caption, items, fallback, hint) => {
          const stored = storedOption(key)
          const current = stored || fallback
          const known = items.some(([value]) => value === current)
          const list = known ? items : [[current, current + '（当前值，不在列表里）'], ...items]
          return h('div', { style: { marginBottom: '10px' } }, label(caption, hint),
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
            // 画质 only where the wire API has a quality tier (OpenAI Images, gpt-image models). 自动 saves an empty value, so requests stay exactly as before.
            protocolBackend === 'openai' ? selectOptionField('quality', '画质', [['', '自动（默认）'], ['low', '低（最快）'], ['medium', '中'], ['high', '高（最慢）']], '', '仅 gpt-image 模型生效；越高越慢') : null,
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
        const mode = ['reference', 'auto'].includes(config.generationMode) ? config.generationMode : 'text'
        const activeChannel = (Array.isArray(config.imageChannels) ? config.imageChannels : []).find(channel => channel.id === config.activeImageChannel)
        const activeDraft = activeChannel ? channelSecretDrafts[activeChannel.id]?.fields : null
        const effectiveChannel = activeChannel ? Object.assign({}, activeChannel, activeDraft || {}, { options: activeDraft?.options || activeChannel.options || {} }) : null
        const available = uiSupportsImageReferences(effectiveChannel || (imageBackend === 'comfyui' ? { provider: 'comfyui' } : { provider: imageBackend }), data)
        return h('div', { style: S.card },
          h('label', { style: S.row }, h('span', { style: S.label }, '默认生图模式'),
            h('select', { 'aria-label': '默认生图模式', value: mode, style: S.input, onChange: event => save({ generationMode: event.target.value }) },
              h('option', { value: 'text' }, '文生图'),
              h('option', { value: 'auto' }, '自动（有参考图就用）'),
              h('option', { value: 'reference', disabled: !available }, '参考图生图'))),
          !available ? h('div', { role: mode === 'reference' ? 'alert' : 'status', style: { fontSize: '12px', color: mode === 'reference' ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-tertiary)' } },
            mode === 'reference' ? '当前渠道不支持参考图输入；请明确切换到支持参考图的渠道或改为文生图，不会自动降级。'
              : mode === 'auto' ? '当前渠道不支持参考图输入；自动模式下每张都按文生图提交。' : '当前渠道不支持参考图输入；可在支持参考图的渠道中启用此模式。') : null,
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '6px' } }, '参考图模式使用人物库中的角色／服装参考图；有图用图、缺图用文字，整张无图时暂停提示。自动模式在整张无图时（如纯背景）改用文生图画这一张，提示词编辑器里可以看到每张的实际模式。单张重绘可覆盖模式。', imageBackend === 'comfyui' ? ' ComfyUI 工作流需要接入 LoadImage 节点；图片按本张参考图上传顺序对应节点。自动模式无图时需使用文生图工作流，插件不会绕过工作流中的图片输入。' : ''),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } }, '切换模式不会更换模型 ID，也不会自动删减参考图；参考图模式下，不支持的协议会在提交前明确阻止，不会静默降级。'))
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
            config.wardrobeHintsAvailable ? h('div', { style: S.row },
              h('label', { style: S.row },
                h('input', { type: 'checkbox', checked: config.wardrobeHints === true, disabled: config.imageEnabled === false || config.plannerEnabled === false, onChange: e => save({ wardrobeHints: e.target.checked }) }),
                h('span', { style: { fontSize: '13px' } }, '换装时参考本卡服装库（正文会收到简短服装提示）'),
              ),
            ) : null,
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
          delete copy.figureId
          delete copy.figurePackId
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
            if (!r?.ok || !r.state) throw Object.assign(new Error(r?.error || '服务器没有确认保存'), { code: r?.code })
            receiveState(r.state, undefined, defs.revision)
            setCharacters(nextChars)
            setPeoplePicked({})
            setPeopleBatchNote('已删除 ' + ids.length + ' 个角色')
            if (typeof showToast === 'function') showToast('已删除 ' + ids.length + ' 个角色')
          } catch (error) {
            if (error?.code === 'REVISION_CONFLICT') setLibraryConflict(true)
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

        async function reloadLibrary() {
          if (libraryDirty.current && typeof window !== 'undefined' && !window.confirm('重新载入会放弃当前未保存的人物库修改，继续吗？')) return
          try {
            const next = await jsonFetch(BASE + '/state')
            if (!next?.definitions) throw new Error('读取人物库失败')
            libraryDirty.current = false
            libraryRevision.current += 1
            setData(current => Object.assign({}, current, { definitions: next.definitions, outfits: next.outfits }))
            setLibraryConflict(false)
            setSaveState('')
            setNote('已载入最新人物库')
          } catch (error) { setNote('重新载入失败：' + error.message) }
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
              if (!r?.ok || !r.state) throw Object.assign(new Error(r?.error || '服务器没有确认保存'), { code: r?.code })
              reportHost('save-ok', { ok: true })
              setLibraryConflict(false)
              if (libraryRevision.current === revision) libraryDirty.current = false
              receiveState(r.state, undefined, defs.revision)
              libraryRevision.current += 1
              setSaveState(libraryDirty.current ? '' : 'saved')
              if (!silent) setNote(libraryDirty.current ? '已保存提交的内容；还有新修改，请再保存' : '人物库已保存')
              return true
            } catch (e) {
              if (e?.code === 'REVISION_CONFLICT') setLibraryConflict(true)
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
              // boxSizing 必须写：S.input 自带左右各 10px 内边距，width:100% 时会把框撑出容器。
              // maxHeight 兜住高度，内容再多也是框内滚动，不会把整页顶长。
              style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box', minHeight: ((rows || 2) * 17) + 'px', maxHeight: '140px', overflowY: 'auto', fontFamily: 'inherit', lineHeight: '1.5', resize: 'vertical' }) }),
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
                  h(ReferenceImageEditor, { key: 'outfit-sheet-' + c.id + '-' + o.id, value: o, field: 'characterOutfitImage', consistency: false, noun: '角色×服装设定图',
                    heading: '（可选：这个角色穿这套衣服的图；有它时只用它，不再叠加角色图和服装图）', label: '服装「' + (o.name || '未命名') + '」', onChange: changes => patchOutfit(i, j, changes) }),
                  h(ReferenceImageEditor, { key: 'outfit-reference-' + c.id + '-' + o.id, value: o, label: '服装「' + (o.name || '未命名') + '」', onChange: changes => patchOutfit(i, j, changes) }),
                  area('上衣', '', o.upper, v => patchOutfit(i, j, { upper: v }), 2),
                  area('下装', '', o.lower, v => patchOutfit(i, j, { lower: v }), 2),
                  h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } },
                    area('鞋袜', '', o.shoes, v => patchOutfit(i, j, { shoes: v }), 2),
                    area('配饰', '', o.accessory, v => patchOutfit(i, j, { accessory: v }), 2),
                    area('整体印象', '', o.full, v => patchOutfit(i, j, { full: v }), 2),
                    area('背面细节', '', o.back, v => patchOutfit(i, j, { back: v }), 2),
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
          // 第一行只放「找谁」：三个控件按 1:1:1 平分一行，不换行。
          // minWidth 必须是 0，否则 select 的内容宽度会把某一格撑大、把另一格挤到下一行。
          h('div', { style: Object.assign({}, S.row, { alignItems: 'stretch', flexWrap: 'nowrap' }) },
            h('input', { type: 'search', 'aria-label': '搜索角色', value: peopleSearch, placeholder: '搜索名称', style: Object.assign({}, S.input, { flex: '1 1 0', minWidth: '0' }), onChange: event => setPeopleSearch(event.target.value) }),
            h('select', { 'aria-label': '当前角色', value: activeCharacter?.id || '', style: Object.assign({}, S.input, { flex: '1 1 0', minWidth: '0' }), onChange: event => { setPeopleActiveId(event.target.value); setPeopleEditorOpen(true) } },
              activeCharacter ? sectionsOf(filteredCharacters).map(([section, list]) => h('optgroup', { key: section, label: section },
                list.map(character => h('option', { key: character.id, value: character.id, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, (character.group ? '[' + character.group + '] ' : '') + (character.name || '（未命名角色）') + (character.match ? ' · ' + character.match : ''))))) : h('option', { value: '', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '没有匹配的角色'),
            ),
            h('select', { 'aria-label': '按卡筛选人物', title: '只看某张卡能用到的人物（未绑定卡的人对所有卡都生效，总会列出来）', value: cardFilter, style: Object.assign({}, S.input, { flex: '1 1 0', minWidth: '0' }), onChange: event => setPeopleCardFilter(event.target.value) },
              h('option', { value: 'all', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '全部卡'),
              currentCardPath ? h('option', { value: currentCardPath, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '当前卡：' + cardTitle(currentCardPath)) : null,
              importCards.filter(item => item.path !== currentCardPath).map(item => h('option', { key: item.path, value: item.path, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, item.label)),
              h('option', { value: '__unbound', style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, '只看未绑定的'),
            ),
          ),
          // 按钮按用途分三段：左边造角色，中间是只看不改的视图开关，右边是主操作和状态。
          // 所有按钮文案保持原样，冒烟脚本按文本找按钮。
          (() => {
            const actBtn = Object.assign({}, buttonStyle, { fontSize: '12px', padding: '6px 12px' })
            const viewBtn = Object.assign({}, buttonStyle, {
              fontSize: '12px', padding: '6px 12px',
              borderColor: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 26%, transparent)',
              color: 'var(--dsw-alias-label-secondary)',
            })
            const group = { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }
            return h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '10px' } },
              h('div', { style: group },
                h('button', { style: actBtn, onClick: addCharacter }, '新增角色'),
                importCards.length ? h('select', {
                  'aria-label': '选择要导入的卡',
                  title: '选哪张卡，就导入哪张卡的人物',
                  value: importCard,
                  style: Object.assign({}, S.input, { maxWidth: '200px', fontSize: '12px', padding: '6px 8px' }),
                  onChange: event => setImportCard(event.target.value),
                }, importCards.map(item => h('option', { key: item.path, value: item.path, style: { color: 'CanvasText', backgroundColor: 'Canvas' } }, item.label))) : null,
                h('button', { style: actBtn, onClick: importFromCard }, '从选定的卡导入'),
                h('button', { style: actBtn, disabled: !activeCharacter, onClick: () => copyCharacter(activeCharacter) }, '复制当前角色'),
                h('button', { style: actBtn, disabled: !activeCharacter, onClick: () => activeCharacter && pickPhoto(activeCharacter) }, '从照片识别'),
                h('button', { style: actBtn, onClick: designPeople }, '让 agent 设计角色'),
              ),
              h('div', { style: group },
                h('button', { style: viewBtn, onClick: () => setPeopleOverviewOpen(open => !open) }, peopleOverviewOpen ? '收起概览' : '概览'),
                h('button', { style: viewBtn, onClick: () => setPeopleTidyOpen(open => !open) }, peopleTidyOpen ? '收起整理' : '整理'),
                h('button', { style: viewBtn, onClick: () => setPeopleBatchOpen(current => !current) }, peopleBatchOpen ? '收起批量编辑' : '批量编辑'),
              ),
              h('div', { style: Object.assign({}, group, { marginLeft: 'auto' }) },
                h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '已选 ' + picked.length + ' / ' + characters.length + ' 位'),
                libraryConflict ? h('button', { style: Object.assign({}, actBtn, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 70%, transparent)', color: 'var(--dsw-alias-state-warning-primary)' }), disabled: saveState === 'saving', onClick: reloadLibrary }, '重新载入最新人物库') : null,
                h('button', { style: actBtn, disabled: saveState === 'saving', onClick: () => commit(false) }, saveState === 'saving' ? '正在保存…' : '保存人物库'),
                // 展开/收起编辑放最右，跟保存一起收边，不占视图组的位置。
                h('button', { style: viewBtn, onClick: () => setPeopleEditorOpen(open => !open) }, peopleEditorOpen ? '收起编辑' : '展开编辑'),
              ),
            )
          })(),
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
                  // 通用服装库只有这五个字段（后端 OUTFIT_FIELDS 按这个白名单落库），
                  // 以前这里读写 upper/lower/shoes/accessory/back，保存时全被过滤掉，填了等于没填。
                  h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '6px' } },
                    area('正面 · 上身', '', o.body, v => patchLib({ body: v }), 3),
                    area('正面 · 整套', '', o.full, v => patchLib({ full: v }), 3),
                    area('背面 · 上身', '', o.bodyBack, v => patchLib({ bodyBack: v }), 3),
                    area('背面 · 整套', '', o.fullBack, v => patchLib({ fullBack: v }), 3),
                  ),
                  area('负面（可选，会并进负面提示词）', '', o.negative, v => patchLib({ negative: v }), 2),
                ),
              )
            })(),
            h('div', { style: S.row },
              h('button', { style: buttonStyle, onClick: () => setLibraryData(Object.assign({}, dataRef.current, { outfits: (data.outfits || []).concat([{ id: 'of' + Date.now(), name: '新套装', body: '', full: '', bodyBack: '', fullBack: '', negative: '', enabled: true }]) })) }, '新增套装'),
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
        const done = historyJobs.filter(function (job) { return job.hasImage && (job.source === 'play' || job.source !== 'card' && job.label !== '卡片工作台') })
        const preview = image => {
          const orderedImages = ordered.flatMap(group => group.items)
          if (!orderedImages.length) return
          const images = orderedImages.map(item => item.preview)
          const index = Math.max(0, orderedImages.findIndex(item => item.image === image))
          openImageOverlay?.({ open: true, images, note: '游玩画廊', index })
        }
        const tiles = done.map(function (job) {
          return h('div', {
            key: job.id,
            style: {
              ...GALLERY_TILE,
              border: gallerySelect && galleryPicked[job.id] ? '2px solid var(--dsw-alias-brand-primary)' : GALLERY_TILE.border,
              boxShadow: gallerySelect && galleryPicked[job.id] ? '0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 25%, transparent)' : 'none',
            },
          },
            h('img', {
              src: BASE + '/jobs?id=' + encodeURIComponent(job.id) + '&image=1',
              loading: 'lazy',
              decoding: 'async',
              alt: job.label || '图',
              title: '左键看大图　右键出菜单',
              style: { ...GALLERY_THUMB, cursor: 'zoom-in' },
              // 左键：批量模式下 = 勾选；平时 = 看大图（带上整库，能左右翻）
              onClick: function () {
                if (gallerySelect) { setGalleryPicked(cur => Object.assign({}, cur, { [job.id]: !cur[job.id] })); return }
                preview(job)
              },
              // 右键：出菜单
              onContextMenu: function (event) {
                event.preventDefault()
                if (typeof openContextMenu !== 'function') return
                openContextMenu({
                  x: event.clientX, y: event.clientY,
                  items: [
                    { icon: '🖼', label: '查看大图', onClick: function () {
                        preview(job)
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
            h('div', { style: GALLERY_CAPTION },
              (job.label || '未命名') + ' · ' + (job.size || '')),
          )
        })
        const legacyTiles = legacyImages.map(function (item) {
          return h('button', { key: item.url, type: 'button', title: item.description || '', onClick: () => preview(item),
            style: { ...GALLERY_TILE, padding: 0, textAlign: 'left', cursor: 'zoom-in', color: 'inherit' } },
            h('img', { src: item.url, loading: 'lazy', decoding: 'async', alt: item.description || '插图', style: GALLERY_THUMB }),
            h('div', { style: GALLERY_CAPTION },
              '第 ' + item.turn + ' 轮 · 早期插图'))
        })
        // 按局分组：插件图按出图时的局，早期插图按 Tavern 记录的局；组内与组间都是新的在前。
        const groups = new Map()
        const groupOf = key => { if (!groups.has(key)) groups.set(key, { key, items: [], legacyTitle: '', deleted: false }); return groups.get(key) }
        done.forEach((job, index) => groupOf(job.gameId || '').items.push({ at: Number(job.completedAt || job.createdAt) || 0, image: job, preview: { jobId: job.id, alt: job.label }, node: tiles[index] }))
        legacyImages.forEach((item, index) => {
          const group = groupOf(item.gameId || 'legacy:' + item.gameTitle)
          group.legacyTitle = group.legacyTitle || item.gameTitle
          group.deleted = group.deleted || item.gameDeleted
          group.items.push({ at: Number(item.createdAt) || 0, image: item, preview: { url: item.url, alt: item.description }, node: legacyTiles[index] })
        })
        for (const group of groups.values()) group.items.sort((a, b) => b.at - a.at)
        const ordered = [...groups.values()].sort((a, b) => (b.items[0]?.at || 0) - (a.items[0]?.at || 0))
        const groupTitle = group => group.key === '' ? '未归属对局（在设置里试画的图）'
          : (gameNames[group.key]?.title || gameNames[group.key]?.cardName || group.legacyTitle || '已删除的对局') + (group.deleted ? '（已删除）' : '')
        return h('div', { style: S.card },
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '画廊（插件 ' + done.length + ' 张' + (legacyImages.length ? ' · 早期 ' + legacyImages.length + ' 张' : '') + '）'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } }, '点缩略图查看原图，按页面顺序切图。右键插件图可查看操作。'),
          h('div', { style: S.row },
            h('button', { style: buttonStyle, onClick: function () { setHistoryNote('读取中…'); setHistoryTick(n => n + 1) } }, '🔄 刷新'),
            h('button', { style: buttonStyle, onClick: () => preview(), disabled: !ordered.length }, '浏览全部'),
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
            h('div', { style: GALLERY_GRID }, group.items.map(item => item.node))))
            : historyNote ? null : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '14px 0 0' } }, '还没有图片'),
          legacyTiles.length ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '14px' } }, '「早期插图」是换用插件之前 Tavern 自带生图画的，只读；要删除请到对应那局的「画廊」。') : null,

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

      function stylePresetCard(openPresets, setOpenPresets, dragState, setDragState) {
        const presets = Array.isArray(config.stylePresets) ? config.stylePresets : []
        const active = String(config.activePreset ?? '')
        const activeName = (presets.find(p => String(p.id) === active) || {}).name
        // 每套预设默认收起：条目一多全展开很占屏。展开状态由 SettingsPanel 传进来，不进配置。
        const presetKey = (item, index) => String(item.id || index)
        const anyPresetOpen = presets.some((item, index) => openPresets[presetKey(item, index)])
        const expandPreset = id => setOpenPresets(all => Object.assign({}, all, { [id]: !all[id] }))
        const toggleAllPresets = () => setOpenPresets(anyPresetOpen
          ? {}
          : Object.fromEntries(presets.map((item, index) => [presetKey(item, index), true])))

        const savePresets = (next) => save({ stylePresets: next })
        const patch = (i, patchObj) => {
          const next = presets.slice()
          next[i] = Object.assign({}, next[i], patchObj)
          savePresets(next)
        }
        const add = () => {
          const created = {
            id: 'p' + Date.now(), name: '画风 ' + (presets.length + 1),
            artist: '', negative: '', position: 'prefix', enabled: true,
          }
          savePresets(presets.concat([created]))
          save({ activePreset: created.id })
          setOpenPresets(all => Object.assign({}, all, { [created.id]: true }))
        }
        const remove = (i) => {
          if (!confirm('删除这套画风？')) return
          const next = presets.slice()
          const gone = next.splice(i, 1)[0]
          savePresets(next)
          if (gone && String(gone.id) === active) save({ activePreset: '' })
        }
        // Moving one preset keeps the relative order of all the others.
        const movePreset = (fromKey, toKey) => {
          const from = presets.findIndex((item, index) => presetKey(item, index) === fromKey)
          const to = presets.findIndex((item, index) => presetKey(item, index) === toKey)
          if (from < 0 || to < 0 || from === to) return
          const next = presets.slice()
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          savePresets(next)
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
            presets.length ? h('button', {
              style: Object.assign({}, buttonStyle, { fontSize: '12px' }),
              title: '展开或收起下面每一套的详细内容',
              onClick: toggleAllPresets,
            }, anyPresetOpen ? '▾ 收起全部' : '▸ 展开全部') : null,
          ),
          presets.length ? h('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' } },
            presets.map((p, i) => {
              const presetId = presetKey(p, i)
              const expanded = openPresets[presetId] === true
              const isDragging = Boolean(dragState && dragState.from === presetId)
              const isDropTarget = Boolean(dragState && dragState.over === presetId && dragState.from !== presetId)
              return h('div', {
                key: p.id || i,
                'data-preset-card': presetId,
                onDragOver: event => {
                  if (!dragState) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  // 只在目标变了才更新，否则每一帧都重渲染
                  setDragState(state => (!state || state.over === presetId) ? state : Object.assign({}, state, { over: presetId }))
                },
                onDrop: event => {
                  event.preventDefault()
                  const from = event.dataTransfer.getData('application/x-dsh-image-preset')
                  setDragState(null)
                  if (from && from === dragState?.from) movePreset(from, presetId)
                },
                style: {
                  borderRadius: '10px', padding: '10px 12px',
                  border: isDropTarget
                    ? '1px solid var(--dsw-alias-brand-primary)'
                    : String(p.id) === active ? '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 75%, transparent)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)',
                  background: String(p.id) === active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)',
                  // 拖起来的那张淡掉，目标那张亮起来 —— 松手就是这两张换位
                  opacity: isDragging ? 0.4 : 1,
                  boxShadow: isDropTarget ? '0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent)' : 'none',
                  transition: 'opacity .12s, box-shadow .12s',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: expanded ? '8px' : '0' } },
                  h('input', { type: 'radio', name: 'rphub-preset', checked: String(p.id) === active, title: '用这一套', onChange: () => save({ activePreset: String(p.id) }) }),
                  h(PresetTextField, {
                    value: p.name || '', placeholder: '这套叫什么（古风写实 / 二次元厚涂…）',
                    style: Object.assign({}, S.input, { flex: 1, minWidth: '140px' }),
                    ariaLabel: '这套画风的名字',
                    onCommit: value => patch(i, { name: value }),
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
                  h('button', {
                    style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 9px' }),
                    title: expanded ? '收起这套的详细内容' : '展开这套的详细内容',
                    onClick: () => expandPreset(presetId),
                  }, expanded ? '▾' : '▸'),
                  h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 10px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => remove(i) }, '删'),
                  h('button', {
                    type: 'button', title: '上移预设', 'aria-label': '上移 ' + (p.name || (i + 1)),
                    disabled: i === 0, style: Object.assign({}, buttonStyle, { padding: '3px 8px' }),
                    onClick: () => movePreset(presetId, presetKey(presets[i - 1], i - 1)),
                  }, '上移'),
                  h('button', {
                    type: 'button', title: '下移预设', 'aria-label': '下移 ' + (p.name || (i + 1)),
                    disabled: i === presets.length - 1, style: Object.assign({}, buttonStyle, { padding: '3px 8px' }),
                    onClick: () => movePreset(presetId, presetKey(presets[i + 1], i + 1)),
                  }, '下移'),
                  h('div', {
                    draggable: true,
                    title: '按住拖动，调整这套预设的位置',
                    'aria-label': '拖动排序 ' + (p.name || (i + 1)),
                    style: { cursor: 'grab', userSelect: 'none', padding: '2px 6px', fontSize: '15px', lineHeight: '1', letterSpacing: '-1px', color: 'var(--dsw-alias-label-tertiary)', borderRadius: '6px' },
                    onDragStart: event => {
                      event.dataTransfer.setData('application/x-dsh-image-preset', presetId)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragState({ from: presetId })
                      // 默认拖影就是这一个小方块，换成整张卡片
                      const card = event.currentTarget.closest('[data-preset-card]')
                      if (card) event.dataTransfer.setDragImage(card, 24, 18)
                    },
                    onDragEnd: () => setDragState(null),
                  }, '⠿'),
                ),
                expanded ? h('div', null,
                  h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '4px' } }, '正面：画师串 / 风格词'),
                  h(PresetTextField, {
                    multiline: true, value: p.artist || '', placeholder: '(@artist_a:1.1), (@artist_b:1.0), masterpiece, best quality',
                    style: ta('72px'),
                    ariaLabel: '这套画风的正面词',
                    onCommit: value => patch(i, { artist: value }),
                  }),
                  h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '6px 0 4px' } }, '这套的负面固定词（会并进负面）'),
                  h(PresetTextField, {
                    multiline: true, value: p.negative || '', placeholder: 'worst quality, low quality, bad hands',
                    style: ta('46px'),
                    ariaLabel: '这套画风的负面词',
                    onCommit: value => patch(i, { negative: value }),
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
                ) : null,
              )
            }),
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

      const tabs = [['plan', '设置'], ['style', '画风'], ['people', '人物库'], ['worldbook', '世界书'], ['gallery', '画廊']]
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
        // 卡片工作台的总开关，和「启用配图」并排：上面管游玩模式的配图，这一条管卡片工作台的工具。
        h('label', { style: Object.assign({}, S.card, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginTop: '0', cursor: 'pointer' }) },
          h('span', null,
            h('span', { style: { display: 'block', fontSize: '14px', fontWeight: 600 } }, '启用工作台生图'),
            h('span', { style: { display: 'block', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px' } },
              cardToggleNote || (cardEnabled === false
                ? '已关闭：工作台里不提供生图与查库工具'
                : '为卡片工作台提供生图与人物、服装查询工具；渠道、画风、尺寸与上面共用同一份配置'))),
          h('input', { type: 'checkbox', role: 'switch', className: 'dti-switch', 'aria-label': '启用工作台生图', disabled: cardToggleBusy || cardEnabled === null, checked: cardEnabled === true, onChange: e => toggleCardStudio(e.target.checked) })),
        taskPanel(),
        h('div', { style: S.row }, tabs.map(([key, label]) => h('button', { key, style: S.tab(tab === key), onClick: () => setTab(key) }, label))),
        // 设置页只留渠道和配图规则；画风单独一页。
        tab === 'plan' ? h('div', null,
          section('渠道'),
          ComfyBackendCard(),
          imageBackend === 'comfyui' ? workflowCard() : null,
          section('配图规则'),
          generationModeCard(),
          planTab(),
        ) : null,
        // 画风预设和专业提示词预设各自是一整排，挂在设置页末尾要一路滚到底才能碰到，单开一页。
        // 两张卡都自带标题，这里不再套一层「画风」小节。
        tab === 'style' ? h('div', null,
          stylePresetCard(openStylePresets, setOpenStylePresets, presetDrag, setPresetDrag),
          h(PromptPresetCard),
        ) : null,
        tab === 'people' ? peopleTab() : null,
        tab === 'gallery' ? h('div', null,
          // 画廊分两档：游玩画廊是配图链路自己的记录，卡片画廊是工作台出的图。默认落在游玩那档。
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
            [['play', '游玩画廊'], ['card', '卡片画廊']].map(([key, label]) =>
              h('button', { key, type: 'button', onClick: () => setGallerySource(key), style: S.tab(gallerySource === key) }, label)),
          ),
          gallerySource === 'card' ? h('div', { style: S.card }, h(CardGalleryPage)) : galleryTab(),
        ) : null,
        tab === 'worldbook' ? h('div', null,
          // 世界书分两套：游玩模式（本插件）与卡片模式（原 dsh-tavern-gen 的分册 + 档位）。
          // 两套数据各存各的文件，这里只决定下面渲染哪一套，不会互相覆盖。
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
            [['play', '游玩模式世界书'], ['card', '卡片模式世界书']].map(([key, label]) =>
              h('button', { key, type: 'button', onClick: () => setWbSource(key), style: S.tab(wbSource === key) }, label)),
          ),
          wbSource === 'card' ? h(CardWorldbookPanel) : worldbookTab(),
        ) : null,
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
