    function CharacterDesignSettings({ config, save }) {
      const [draft, setDraft] = React.useState({})
      const textField = (key, label) => promptField(label, h('textarea', { 'aria-label': label,
        value: draft[key] ?? config[key] ?? '', maxLength: 4000, style: promptArea(62),
        onChange: event => setDraft(current => ({ ...current, [key]: event.target.value })) }))
      const saveRequirements = () => save({
        characterDesignRequirements: draft.characterDesignRequirements ?? config.characterDesignRequirements ?? '',
        outfitDesignRequirements: draft.outfitDesignRequirements ?? config.outfitDesignRequirements ?? '',
      })
      return h('details', { style: S.card },
        h('summary', { style: PROMPT_DISCLOSURE }, '角色与服装生成规则'),
        h('div', { style: PROMPT_FIELDS },
          promptField('角色与服装生成写法', h('select', { 'aria-label': '角色与服装生成写法', value: config.designPromptMode || 'auto', style: S.input,
            onChange: event => save({ designPromptMode: event.target.value }) },
            h('option', { value: 'auto' }, '自动'), h('option', { value: 'chinese' }, '中文整句'), h('option', { value: 'tags' }, '英文 Tag'))),
          textField('characterDesignRequirements', '角色生成要求'), textField('outfitDesignRequirements', '服装生成要求'),
          h('div', null, h('button', { type: 'button', style: buttonStyle, onClick: saveRequirements }, '保存角色与服装要求'))))
    }

    function SettingsPanel() {
      const [data, setDataState] = React.useState(null)
      // 让定时器/异步回调读到"最新的" data，而不用把它写进 effect 依赖
      const dataRef = React.useRef(null)
      dataRef.current = data
      const libraryDraft = useImageDraft('people', null)
      const librarySaved = React.useRef(null)
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
        librarySaved.current = { definitions: next.definitions, outfits: next.outfits }
        const current = dataRef.current
        if (!current && libraryDraft.value) {
          libraryDirty.current = true
          next = { ...next, definitions: libraryDraft.value.definitions, outfits: libraryDraft.value.outfits }
          setNote('已恢复人物与服装的本地草稿。')
        }
        setData((libraryDirty.current || (typeof requestRevision === 'number' && requestRevision !== libraryRevision.current)) && current
          ? Object.assign({}, next, { definitions: savedRevision && current.definitions?.revision === savedRevision ? Object.assign({}, current.definitions, { revision: next.definitions?.revision }) : current.definitions, outfits: current.outfits })
          : next)
      }
      function setLibraryData(update) {
        libraryDirty.current = true
        libraryRevision.current += 1
        const next = typeof update === 'function' ? update(dataRef.current) : update
        libraryDraft.update({ definitions: next.definitions, outfits: next.outfits })
        setData(next)
        setSaveState('')
      }
      function undoLibraryEdit() {
        const previous = libraryDraft.undo()
        if (previous === undefined) return
        libraryDirty.current = Boolean(previous)
        libraryRevision.current += 1
        setData(current => ({ ...current, ...(previous ?? librarySaved.current) }))
        setSaveState('')
      }
      const [tab, setTab] = React.useState('plan')
      const [editingTemplate, selectEditingTemplate] = React.useState(null)
      const [rulesOpen, setRulesOpen] = React.useState(false)
      const [note, setNote] = React.useState('')
      // 正文图片显示大小：输入过程只改草稿（绝不边输边发请求），点「保存」才发一次 /config。
      // null = 跟随已保存的配置；保存成功后回到 null，输入框显示服务端确认过的值。
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
      // 哪一行正在展开"选择绑定卡片"（-1 = 都没展开）；内联展开，不用浮层
      const [cardPickerFor, setCardPickerFor] = React.useState(-1)
      const [cardList, setCardList] = React.useState([])
      const [peopleSearch, setPeopleSearch] = React.useState('')
      const [peopleActiveId, setPeopleActiveId] = React.useState('')
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
      const [designMode, setDesignMode] = React.useState('')
      const [designBrief, setDesignBrief] = React.useState('')
      const [designMediaType, setDesignMediaType] = React.useState('')
      const [designPreview, setDesignPreview] = React.useState('')
      const [designName, setDesignName] = React.useState('')
      const [designNote, setDesignNote] = React.useState('')
      const [designPanelBusy, setDesignPanelBusy] = React.useState(false)
      const designInFlight = React.useRef(false)

      // 从别的角色复制服装：{ target: 目标角色 id, source: 来源角色 id, picked: 选中的服装 id }
      const [outfitCopy, setOutfitCopy] = React.useState({ target: '', source: '', picked: [] })
      // 通用服装库当前选中哪一套（只编辑这一套，不再全部铺开）
      const [libraryActive, setLibraryActive] = React.useState('')
      // 角色服装：每个角色记住当前编辑的是哪一套（角色 id → 服装 id）
      const [outfitPick, setOutfitPick] = React.useState({})
      // 保存状态：'' 空闲 / 'saving' / 'saved' / 'failed:原因'
      const [saveState, setSaveState] = React.useState('')
      const [libraryConflict, setLibraryConflict] = React.useState(false)
      // 历史图库
      const [historyJobs, setHistoryJobs] = React.useState([])
      const [galleryPrompt, setGalleryPrompt] = React.useState(null)
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
      const [galleryDeletion, setGalleryDeletion] = React.useState(null)
      const [galleryDeleting, setGalleryDeleting] = React.useState(false)
      const galleryDeleteBusy = React.useRef(false)
      const [galleryDeleteNote, setGalleryDeleteNote] = React.useState('')
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
          .catch(() => { if (alive) setCardToggleNote('卡片生图暂不可用，请更新并重启插件') })
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
          if (!enabled) setTab(current => current === 'card-worldbook' ? 'plan' : current)
          setCardToggleNote(enabled ? '已启用卡片生图' : '已关闭卡片生图')
        } catch (error) {
          setCardToggleNote('没改成：' + (error?.message ?? error))
        } finally { setCardToggleBusy(false) }
      }
      // 工作流：展开哪张 / 它的详情 / 导入面板 / ComfyUI 已装的 LoRA
      const [wfOpen, setWfOpen] = React.useState('')
      const [wfGraphFile, setWfGraphFile] = React.useState('')
      const [imageEditSource, setImageEditSource] = React.useState(null)
      const [wfDetail, setWfDetail] = React.useState(null)
      const [wfImportOpen, setWfImportOpen] = React.useState(false)
      const [wfPaste, setWfPaste] = React.useState('')
      const [wfImportPreview, setWfImportPreview] = React.useState(null)
      const [wfImportBusy, setWfImportBusy] = React.useState(false)
      const [galleryMode, setGalleryMode] = React.useState('')
      const loraWrites = React.useRef(Promise.resolve())
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
      }, [tab, historyTick, galleryMode])
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
        jsonFetch(BASE + '/history?source=play&gallery=' + galleryMode, { cache: 'no-store' }).then(r => {
          if (!alive) return
          const list = r?.jobs ?? []
          setHistoryJobs(list)
          setHistoryNote(list.length || galleryMode === 'trash' ? '' : '还没有生成过图片')
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
      }, [tab, historyTick, galleryMode])

      React.useEffect(() => {
        const receive = event => {
          if (!event.detail) return
          setDisplayWidthDraft(null)
          setDisplayWidthNote('')
          setData(current => current ? { ...current, config: { ...current.config, ...event.detail } } : current)
        }
        window.addEventListener('dsh-tavern-image:config', receive)
        return () => window.removeEventListener('dsh-tavern-image:config', receive)
      }, [])

      function post(pathname, body) {
        return jsonFetch(BASE + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      }
      async function save(patch) {
        const operation = configSaveQueue.current.catch(() => {}).then(async () => {
          setNote('保存中…')
          const revision = libraryRevision.current
          try {
            const r = await post('/config', { config: patch })
            receiveState(r.state, revision)
            try { window.dispatchEvent(new CustomEvent('dsh-tavern-image:config', { detail: r.state?.config })) } catch {}
            setNote('已保存')
            return r
          } catch (e) {
            if (e?.code === 'REVISION_CONFLICT') {
              const fresh = await post('/state', {}).catch(() => null)
              if (fresh) receiveState(fresh)
            }
            setNote('保存失败：' + (e && e.message ? e.message : e))
            return null
          }
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
        setDisplayWidthNote(value ? ('已保存：图片统一按 ' + value + ' px 显示') : '已恢复默认大小')
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
                h('select', { 'aria-label': '多样性', value: String((localFields.options || {}).varietyBoost ?? false), style: full(), onChange: e => updateOption('varietyBoost', e.target.value === 'omit' ? 'omit' : e.target.value === 'true') },
                  h('option', { value: 'false', style: optStyle }, '关（默认）'),
                  h('option', { value: 'true', style: optStyle }, '开（Variety Boost）'),
                  // 有些第三方站点把 variety_boost 当未知字段直接 422，选这个就整条不发
                  h('option', { value: 'omit', style: optStyle }, '不传（站点不认这条参数）')))) : null,
            protocolBackend === 'openai' ? selectOptionField('quality', '画质', [
              ['', '服务端默认（不传）'], ['auto', '自动（auto）'], ['low', '低'], ['medium', '中'], ['high', '高'],
              ['xhigh', '超高（xhigh）'], ['max', '最高（max）'],
            ], '', '画质档位取决于模型和中转服务，尤其是 xhigh 和 max。') : null,
            protocolBackend === 'openai' ? selectOptionField('moderation', '内容审核级别', [
              ['', '服务端默认（不传）'], ['auto', '自动（auto）'], ['low', '较宽松（low）'],
            ], '', '实际支持情况取决于模型和中转服务。') : null,
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
        const defaultWidth = config.imageDisplayPosition === 'floating' ? 420 : ['left', 'right'].includes(config.imageDisplayPosition) ? 300 : IMAGE_WIDTH_LIMIT.fallback
        const previewWidth = draftValue || defaultWidth
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
          { key: 'default', label: '默认', width: defaultWidth, color: 'var(--dsw-alias-label-tertiary)', dashed: true },
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
        return h('details', { style: S.card },
          h('summary', { style: PROMPT_DISCLOSURE }, '生图位置和大小', ' · ', IMAGE_POSITIONS.find(([key]) => key === config.imageDisplayPosition)?.[1] || '正文', saved ? ' · ' + saved + ' px' : ''),
          h('div', { style: S.row },
            promptField('显示位置', h('select', { style: S.input, 'aria-label': '生图显示位置', value: config.imageDisplayPosition || 'inline',
              onChange: event => save({ imageDisplayPosition: event.target.value }) },
              IMAGE_POSITIONS.map(([key, label]) => h('option', { key, value: key }, label)))),
            config.imageDisplayPosition && config.imageDisplayPosition !== 'inline' ? promptField('切换图片', h('select', { style: S.input,
              'aria-label': '正文跟图方式', value: config.imageDisplayFollow || 'scroll',
              onChange: event => save({ imageDisplayFollow: event.target.value }) },
              IMAGE_FOLLOW_MODES.map(([key, label]) => h('option', { key, value: key }, label)))) : null),
          h('div', { style: { marginTop: '10px' } },
            compareRows.map(compareBar),
          ),
          h('div', { style: Object.assign({}, S.row, { marginTop: '10px' }) },
            h('input', {
              'aria-label': '正文图片显示宽度', type: 'range',
              min: String(IMAGE_WIDTH_LIMIT.min), max: String(IMAGE_WIDTH_LIMIT.max), step: '10',
              value: String(draftValue || defaultWidth), disabled: busy,
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
              ? h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', color: 'var(--dsw-alias-state-warning-primary)' } }, '预览中（未保存）：图片已临时按 ' + (draftValue ? draftValue + ' px' : '默认') + ' 显示')
              : (displayWidthNote ? h('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', color: /失败/.test(displayWidthNote) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' } }, displayWidthNote) : null),
          ),
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '6px' } },
            '宽度只影响显示。留空恢复该位置的默认宽度。'),
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
              : mode === 'auto' ? '当前渠道不支持参考图输入；自动模式下每张都按文生图提交。' : '当前渠道不支持参考图输入；可在支持参考图的渠道中启用此模式。') : null)
      }

      function planTab() {
        return h('div', null,
          h('details', { style: S.card, open: rulesOpen, onToggle: event => setRulesOpen(event.currentTarget.open) },
            h('summary', { style: PROMPT_DISCLOSURE }, '生成设置'),
            generationModeCard(),
            config.promptSystem === 'worldbook' ? h('div', { style: PROMPT_FIELDS },
              [['plannerEnabled', '每轮自动规划配图', config.plannerEnabled !== false],
                ['smartImageSelection', '智能决定是否配图', config.smartImageSelection !== false],
                ['autoImageGen', '自动生图规则', config.autoImageGen === true],
                ['wardrobeHints', '换装时参考服装库', config.wardrobeHints === true]].map(([key, label, checked]) =>
                h('label', { key, style: S.row }, h('input', { type: 'checkbox', checked, onChange: event => save({ [key]: event.target.checked }) }), label))) : null,
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
        )
      }

      // ---- 人物库（人物设计）----
      function peopleTab(focus) {
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
        const activeCharacter = filteredCharacters.find(character => character.id === peopleActiveId) || null
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
            libraryDraft.reset(null)
            librarySaved.current = { definitions: next.definitions, outfits: next.outfits }
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
              if (libraryRevision.current === revision) {
                libraryDirty.current = false
                libraryDraft.reset(null)
              }
              receiveState(r.state, undefined, defs.revision)
              if (libraryDirty.current) libraryDraft.update({ definitions: dataRef.current.definitions, outfits: dataRef.current.outfits }, false)
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

        /** 内联的设计面板：需求 + 参考图 + 确定生成 */
        function designPanel() {
          if (!designMode) return null
          const target = activeCharacter
          const isNew = designMode === 'new'
          const isPhoto = designMode === 'photo'
          function pickDesignFile(event) {
            const file = event?.target?.files && event.target.files[0]
            if (!file) return
            if (file.size > 12 * 1024 * 1024) { setDesignNote('图片太大了（上限 12MB）'); return }
            const reader = new FileReader()
            reader.onload = () => {
              const result = String(reader.result || '')
              setDesignMediaType(file.type || 'image/png')
              setDesignPreview(result)
              setDesignName(file.name)
              setDesignNote('')
            }
            reader.onerror = () => { setDesignNote('读图失败'); setDesignMediaType(''); setDesignPreview(''); setDesignName('') }
            reader.readAsDataURL(file)
          }
          async function runDesign() {
            if (designInFlight.current) return
            const brief = String(designBrief || '').trim()
            if (!isNew && !target) { setDesignNote('请先选择角色'); return }
            if (isPhoto ? !designPreview : !brief) { setDesignNote(isPhoto ? '请先选择照片' : '请填写需求'); return }
            designInFlight.current = true
            setDesignPanelBusy(true)
            setDesignNote(isPhoto ? '正在识别照片…' : '正在设计…')
            try {
              const payload = { brief, sessionId: String(lastSessionId || '') }
              if (!isNew) payload.current = target
              if (designPreview) Object.assign(payload, { data: designPreview, mediaType: designMediaType, name: designName })
              const r = await post(isPhoto ? '/vision' : '/design', payload)
              if (isPhoto) {
                if (!r?.traits) throw new Error('模型没有返回角色资料')
                const characters = dataRef.current?.definitions?.characters || []
                if (!characters.some(character => character.id === target.id)) throw new Error('角色已删除')
                const traits = Object.fromEntries(Object.entries({ ...r.traits,
                  lowerSFW: r.traits.fullSFW || r.traits.lowerSFW, lowerNSFW: r.traits.fullNSFW || r.traits.lowerNSFW,
                }).filter(([, value]) => value))
                setCharacters(characters.map(character => character.id === target.id ? mergeDesign(target, { traits }, character) : character))
                setDesignNote('已填入识别结果，核对后保存人物库。')
                return
              }
              if (!r?.ok) { setDesignNote('设计失败：' + (r?.error || '')); return }
              const people = r.people || []
              if (!people.length) { setDesignNote('没产出人物。模型原文：' + String(r.raw || '').slice(0, 160)); return }
              const next = (dataRef.current?.definitions?.characters || []).slice()
              // 改进模式：原地替换那个角色；新建模式：追加
              if (!isNew) {
                const index = next.findIndex(character => character.id === target.id)
                if (index < 0) { setDesignNote('角色已删除，已忽略改进结果'); return }
                next[index] = mergeDesign(target, people[0], next[index])
                setCharacters(next)
                const saved = await commit(true)
                if (saved && typeof showToast === 'function') showToast('已改进「' + next[index].name + '」，并写入角色库')
                setDesignNote(saved ? '改进完成，已保存' : '改进结果已保留，请点「保存人物库」重试保存')
                // 面板保持打开
                setDesignBrief(current => current === designBrief ? '' : current)
                setDesignMediaType(current => current === designMediaType ? '' : current)
                setDesignPreview(current => current === designPreview ? '' : current)
                setDesignName(current => current === designName ? '' : current)
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
                const saved = await commit(true)
              if (saved && typeof showToast === 'function') showToast('已生成 ' + people.length + ' 个角色，并写入角色库')
              setDesignNote(saved ? '已生成 ' + people.length + ' 位角色并保存' : '生成结果已保留，请点「保存人物库」重试保存')
              // 面板保持打开，让「保存人物库」提醒可见
              setDesignBrief(current => current === designBrief ? '' : current)
              setDesignMediaType(current => current === designMediaType ? '' : current)
              setDesignPreview(current => current === designPreview ? '' : current)
              setDesignName(current => current === designName ? '' : current)
            } catch (error) {
              setDesignNote('失败：' + (error?.message ?? error))
            } finally {
              designInFlight.current = false
              setDesignPanelBusy(false)
            }
          }
          return h('section', { 'aria-label': 'Agent 角色工具', style: { ...S.card, margin: '10px 0' } },
            h('div', { style: S.row }, [
              ['photo', '从照片识别'], ['new', '设计新角色'], ['edit', '改这个角色'],
            ].map(([mode, label]) => h('button', { key: mode, type: 'button', style: S.tab(designMode === mode),
              'aria-pressed': designMode === mode, disabled: designPanelBusy || (mode !== 'new' && !target),
              onClick: () => { setDesignMode(mode); setDesignBrief(''); setDesignNote('') } }, label))),
            !isNew && target ? h('p', { style: STRUCTURE_MUTED }, '当前角色：' + (target.name || '未命名角色')) : null,
            !isPhoto ? promptField(isNew ? '设计需求' : '修改要求', h('textarea', { value: designBrief,
              disabled: designPanelBusy, style: promptArea(72), onChange: event => setDesignBrief(event.target.value) })) : null,
            h('div', { style: S.row },
              promptField(isPhoto ? '识别照片' : '参考照片（可选）', h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif',
                disabled: designPanelBusy, onChange: pickDesignFile, style: { maxWidth: '100%' } })),
              designPreview ? h('button', { type: 'button', style: buttonStyle, disabled: designPanelBusy,
                onClick: () => { setDesignPreview(''); setDesignMediaType(''); setDesignName('') } }, '清除照片') : null),
            designPreview ? h('img', { src: designPreview, alt: '待处理照片', style: { display: 'block', maxWidth: '100%', maxHeight: 96, marginTop: 6 } }) : null,
            h('div', { style: S.row },
              h('button', { type: 'button', style: S.tab(true), disabled: designPanelBusy, onClick: runDesign },
                designPanelBusy ? '处理中…' : isPhoto ? '识别并填入资料' : isNew ? '生成角色' : '应用修改')),
            designNote ? h('div', { role: 'status', style: STRUCTURE_MUTED }, designNote) : null)
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
          const groups = new Map()
          for (const person of filteredCharacters) {
            const key = sectionOf(person)
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key).push(person)
          }
          return h('div', { 'aria-label': '人物概览', className: 'dti-roster' },
            groups.size ? [...groups].map(([name, people]) => h('section', { key: name },
              h('div', { className: 'dti-roster-group' }, h('strong', null, name), h('span', null, people.length + ' 位')),
              h('div', { className: 'dti-roster-grid' }, people.map(person => {
                const name = person.name || '未命名角色'
                const id = person.referenceImage?.id
                const hasImage = /^[a-f0-9]{64}$/i.test(id || '')
                return h('button', { key: person.id, type: 'button', className: 'dti-roster-tile',
                  'aria-label': '查看角色 ' + name, onClick: () => setPeopleActiveId(person.id) },
                  hasImage ? h('img', { src: BASE + '/reference-image?id=' + encodeURIComponent(id), alt: '', loading: 'lazy',
                    decoding: 'async', onError: event => { event.currentTarget.hidden = true } }) : null,
                  h('span', { className: 'dti-roster-caption', title: name }, name),
                  person.enabled === false ? h('small', { className: 'dti-roster-disabled' }, '停用') : null)
              }))))
              : h('p', { style: STRUCTURE_MUTED }, characters.length ? '当前筛选没有角色。' : '还没有角色。'))
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
            if (!libraryPromptOverride(person) && !traitCount(person)) issues.push({ person, kind: 'sparse', text: '提示词未填写' })
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
          const outfits = c.outfits || []
          const mode = config.promptEffectiveFormat
          return h('section', { key: c.id, 'aria-label': '角色详情', className: 'dti-roster-detail' },
            h('section', { 'aria-label': '角色与参考图设置', className: 'dti-roster-settings' },
              h('strong', null, '角色与参考图设置'),
              h('div', { className: 'dti-roster-identity' },
                h('input', { type: 'text', 'aria-label': '角色名', placeholder: '角色名', value: c.name || '',
                  style: S.input, onChange: event => patchIdentity(i, { name: event.target.value }) }),
                h('label', { style: S.row }, h('input', { type: 'checkbox', checked: c.enabled !== false,
                  onChange: event => patch(i, { enabled: event.target.checked }) }), '启用'),
                h('input', { type: 'text', placeholder: '分组', 'aria-label': '分组', value: c.group || '', style: S.input, onChange: e => patchIdentity(i, { group: e.target.value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) }) }),
                h('input', { type: 'text', placeholder: '触发别名', 'aria-label': '触发别名', value: c.match || '', style: S.input, onChange: e => patchIdentity(i, { match: e.target.value }) }),
              ),
              h(ReferenceImageEditor, { key: 'character-reference-' + c.id, value: c, compact: true, label: '角色「' + (c.name || '未命名') + '」', onChange: changes => patch(i, changes) }),
              h(CharacterComfyLoras, { value: c.comfyLoras || [], workflows: data.workflows || [], onChange: comfyLoras => patch(i, { comfyLoras }) }),
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
                    : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '8px' } }, '没有可绑定的卡片'),
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
              h('details', { style: { marginTop: 6 } },
                h('summary', { style: PROMPT_DISCLOSURE }, '状态与形态'),
                area('状态与变化', '', c.continuity, v => patch(i, { continuity: v }), 2),
                area('形态线索', '', c.formCues || '', v => patch(i, { formCues: v }), 1)),
              h('div', { style: S.row },
                h('button', { type: 'button', style: buttonStyle, onClick: () => copyCharacter(c) }, '复制角色'),
                h('button', { type: 'button', style: buttonStyle, onClick: () => {
                  if (!confirm('删掉「' + (c.name || '未命名') + '」？')) return
                  setCharacters(current => current.filter(character => character.id !== c.id))
                  setPeopleActiveId('')
                } }, '删除角色')),
            ),
            h('details', { style: { margin: '8px 0' } },
              h('summary', { style: PROMPT_DISCLOSURE }, '角色生图提示词'),
              h(LibraryPromptEditor, { key: c.id, record: c, kind: '角色', mode, traitMode: config.traitMode, editable: config.libraryPromptEditing === true,
                detailsEditable: config.libraryDetailsEditing === true, onChange: changes => patch(i, changes) })),
            h('details', { style: { margin: '8px 0' } },
              h('summary', { style: PROMPT_DISCLOSURE }, '角色服装（' + outfits.length + '）'),
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
                    h(LibraryPromptEditor, { key: o.id, record: o, kind: '服装', mode, editable: config.libraryPromptEditing === true,
                      detailsEditable: config.libraryDetailsEditing === true,
                      onChange: changes => patchOutfit(i, j, changes) }),
                    h('details', { key: 'outfit-extra-' + o.id },
                      h('summary', { style: PROMPT_DISCLOSURE }, '服装参考图'),
                      h(ReferenceImageEditor, { key: 'outfit-sheet-' + c.id + '-' + o.id, value: o, field: 'characterOutfitImage', consistency: false, noun: '角色×服装设定图',
                        heading: '（可选：这个角色穿这套衣服的图；有它时只用它，不再叠加角色图和服装图）', label: '服装「' + (o.name || '未命名') + '」', onChange: changes => patchOutfit(i, j, changes) }),
                      h(ReferenceImageEditor, { key: 'outfit-reference-' + c.id + '-' + o.id, value: o, label: '服装「' + (o.name || '未命名') + '」', onChange: changes => patchOutfit(i, j, changes) }),
                    ),
                  ),
                )
              })(),
              h('div', { style: S.row },
                h('button', { style: buttonStyle, onClick: () => patch(i, { outfits: outfits.concat([{ id: 'o' + Date.now(), name: '新服装', upper: '', lower: '', shoes: '', accessory: '', full: '', back: '', negative: '', enabled: true, default: outfits.length === 0 }]) }) }, '新增服装'),
                h('button', { style: buttonStyle, onClick: () => setOutfitCopy(current => current.target === c.id ? { target: '', source: '', picked: [] } : { target: c.id, source: '', picked: [], mode: 'whole', parts: {} }) }, outfitCopy.target === c.id ? '收起复制' : '从其他角色复制服装'),
              ),
              outfitCopy.target === c.id ? outfitCopyPanel(c, i) : null,
            ),
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
        if (focus) {
          const personIndex = characters.findIndex(person => person.id === focus.characterId)
          const person = characters[personIndex]
          const ownOutfit = person?.outfits?.find(outfit => outfit.id === focus.outfitId)
          const sharedOutfit = (data.outfits || []).find(outfit => outfit.id === focus.outfitId)
          const outfit = ownOutfit || sharedOutfit
          const changeOutfit = changes => {
            if (ownOutfit) patchOutfit(personIndex, person.outfits.indexOf(ownOutfit), changes)
            else setLibraryData(current => ({ ...current, outfits: current.outfits.map(item => item.id === outfit.id ? { ...item, ...changes } : item) }))
          }
          return h('div', { 'aria-label': '引用人物资料', style: PROMPT_FIELDS },
            !person && !outfit ? h('p', { style: STRUCTURE_MUTED }, '先在模块中指定角色或服装，再编辑引用资料。') : null,
            person ? h('div', null, h('strong', null, person.name),
              h(LibraryPromptEditor, { key: person.id, record: person, kind: '角色', mode: config.promptEffectiveFormat,
                traitMode: config.traitMode, editable: config.libraryPromptEditing === true, detailsEditable: config.libraryDetailsEditing === true,
                onChange: changes => patch(personIndex, changes) })) : null,
            outfit ? h('div', null, h('strong', null, outfit.name),
              h(LibraryPromptEditor, { key: outfit.id, record: outfit, kind: '服装', mode: config.promptEffectiveFormat,
                editable: config.libraryPromptEditing === true, detailsEditable: config.libraryDetailsEditing === true, onChange: changeOutfit })) : null,
            person || outfit ? h('div', { style: S.row },
              h('button', { type: 'button', style: buttonStyle, disabled: saveState === 'saving', onClick: () => commit(false) }, '保存人物资料'),
              h('span', { role: 'status', style: STRUCTURE_MUTED }, libraryDirty.current ? '有未保存修改' : saveState === 'saved' ? '人物资料已保存' : '')) : null)
        }
        return h('div', { className: 'dti-people' },
          h('div', { className: 'dti-roster-panel' },
            h('div', { className: 'dti-roster-bar' },
              h('div', null, h('strong', null, activeCharacter ? activeCharacter.name || '未命名角色' : '角色库'),
                !activeCharacter ? h('small', null, ' · ' + characters.length + ' 位') : null),
              h('div', { style: S.row },
                activeCharacter ? h('button', { type: 'button', style: buttonStyle, disabled: designPanelBusy,
                  onClick: () => { setPeopleActiveId(''); setDesignMode('') } }, '返回概览')
                  : h('button', { type: 'button', style: buttonStyle, onClick: addCharacter }, '新增角色'),
                h('button', { type: 'button', style: buttonStyle, 'aria-expanded': Boolean(designMode), disabled: designPanelBusy,
                  onClick: () => {
                    setDesignMode(designMode ? '' : activeCharacter ? 'edit' : 'new')
                    setDesignBrief('')
                    setDesignNote('')
                    setDesignPreview('')
                    setDesignMediaType('')
                    setDesignName('')
                  } }, 'Agent 角色工具'),
                libraryConflict ? h('button', { type: 'button', style: buttonStyle, disabled: saveState === 'saving',
                  onClick: reloadLibrary }, '重新载入最新人物库') : null,
                h('button', { type: 'button', style: S.tab(true), disabled: saveState === 'saving',
                  onClick: () => commit(false) }, saveState === 'saving' ? '正在保存…' : '保存人物库'))),
            h('details', null,
              h('summary', { style: PROMPT_DISCLOSURE }, '从世界书生成角色'),
              h('div', { style: S.row },
                importCards.length ? h('select', { 'aria-label': '选择要导入的卡', value: importCard, style: S.input,
                  onChange: event => setImportCard(event.target.value) },
                  importCards.map(item => h('option', { key: item.path, value: item.path }, item.label))) : null,
                h('button', { type: 'button', style: buttonStyle, disabled: !importCard, onClick: importFromCard }, '读取世界书并生成')),
              importPreviewPanel()),
            libraryDraft.value ? h('div', { style: S.row },
              h('span', { style: STRUCTURE_MUTED }, '本地草稿已保留'),
              h('button', { type: 'button', style: buttonStyle, disabled: !libraryDraft.canUndo, onClick: undoLibraryEdit }, '撤销人物修改'),
              h('button', { type: 'button', style: buttonStyle, onClick: reloadLibrary }, '放弃人物草稿')) : null,
            designPanel(),
            activeCharacter ? characterBlock(activeCharacter, activeIndex) : h(React.Fragment, null,
              h('div', { className: 'dti-roster-filters' },
                h('input', { type: 'search', 'aria-label': '搜索角色', value: peopleSearch, placeholder: '搜索角色或别名',
                  style: S.input, onChange: event => setPeopleSearch(event.target.value) }),
                h('select', { 'aria-label': '按卡筛选人物', value: cardFilter, style: S.input, onChange: event => setPeopleCardFilter(event.target.value) },
                  h('option', { value: 'all' }, '全部卡片'),
                  currentCardPath ? h('option', { value: currentCardPath }, '当前卡：' + cardTitle(currentCardPath)) : null,
                  importCards.filter(item => item.path !== currentCardPath).map(item => h('option', { key: item.path, value: item.path }, item.label)),
                  h('option', { value: '__unbound' }, '只看未绑定的'))),
              overviewPanel(),
              h('details', null,
                h('summary', { style: PROMPT_DISCLOSURE }, '库管理'),
                h('div', { style: S.row },
                  h('button', { style: buttonStyle, onClick: () => setPeopleTidyOpen(open => !open) }, peopleTidyOpen ? '收起整理' : '整理'),
                  h('button', { style: buttonStyle, onClick: () => setPeopleBatchOpen(open => !open) }, peopleBatchOpen ? '收起批量编辑' : '批量编辑')),
                peopleTidyOpen ? tidyPanel() : null, batchPanel())),
            h('div', { role: 'status', style: STRUCTURE_MUTED }, saveState.startsWith('failed') ? '保存失败，请重试'
              : libraryDirty.current ? '有未保存修改' : saveState === 'saved' ? '人物库已保存' : '')),
          h('details', { style: S.card },
            h('summary', { style: PROMPT_DISCLOSURE }, '通用服装库'),
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
                  h(LibraryPromptEditor, { key: o.id, record: o, kind: '通用服装', mode: config.promptEffectiveFormat, editable: config.libraryPromptEditing === true,
                    detailsEditable: config.libraryDetailsEditing === true,
                    onChange: patchLib }),
                  h('details', { key: 'shared-extra-' + o.id },
                    h('summary', { style: PROMPT_DISCLOSURE }, '通用服装参考图'),
                    h(ReferenceImageEditor, { key: 'shared-reference-' + o.id, value: o, label: '通用服装「' + (o.name || '未命名') + '」', onChange: patchLib }),
                  ),
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

      async function updateGalleryItem(id, operation) {
        if (galleryDeleteBusy.current) return false
        try {
          const response = await post('/gallery-item', { id, operation })
          if (!response?.job) throw new Error('未收到画廊操作结果')
          setHistoryJobs(list => list.flatMap(job => {
            if (job.id !== id) return [job]
            const updated = response.job
            if (galleryMode === 'trash') return updated.trashedAt ? [updated] : []
            if (updated.trashedAt || galleryMode === 'favorite' && !updated.favorite) return []
            return [updated]
          }))
          return true
        } catch (error) {
          showToast?.('画廊操作失败：' + (error?.message ?? error), 'fail')
          return false
        }
      }

      async function trashSelected(ids) {
        if (!ids.length || !confirm('将 ' + ids.length + ' 张图移到回收站？')) return
        for (const id of ids) await updateGalleryItem(id, 'trash')
        setGalleryPicked({})
      }

      function requestGalleryDeletion(ids, all = false) {
        if (galleryDeleteBusy.current || !all && !ids.length) return
        setGalleryDeleteNote('')
        setGalleryDeletion({ ids, all })
      }

      async function deleteGalleryImages() {
        if (!galleryDeletion || galleryDeleteBusy.current) return
        galleryDeleteBusy.current = true
        setGalleryDeleting(true)
        setGalleryDeleteNote('')
        try {
          const response = await post('/gallery-delete', galleryDeletion)
          if (!Array.isArray(response.deleted)) throw new Error('未收到删除结果')
          const deleted = new Set(response.deleted)
          setHistoryJobs(list => list.filter(job => !deleted.has(job.id)))
          setGalleryPicked(current => Object.fromEntries(Object.entries(current).filter(([id]) => !deleted.has(id))))
          setGalleryPrompt(current => deleted.has(current?.id) ? null : current)
          setGalleryDeletion(null)
          setHistoryTick(n => n + 1)
          const failed = response.failed || []
          setGalleryDeleteNote('已彻底删除 ' + deleted.size + ' 张图' + (failed.length ? '，' + failed.length + ' 张删除失败：' + failed[0].error : ''))
        } catch (error) {
          setGalleryDeleteNote('删除失败：' + (error?.message ?? error))
        } finally {
          galleryDeleteBusy.current = false
          setGalleryDeleting(false)
        }
      }

      /** 工作流：导入、查看、LoRA 管理。 */
      function workflowCard() {
        const list = data.workflows || []
        const legacySelection = config.promptSystem === 'worldbook'
        // 判定"读到的详情是不是当前这张"：file 或 id 任一匹配即可（file 由前端补进来）
        const detail = (wfDetail && (String(wfDetail.file ?? '') === String(wfOpen) || String(wfDetail.__id ?? '') === String(wfOpen))) ? wfDetail : null

        async function openWorkflow(file, force = false) {
          if (!force && wfOpen === file) { setWfOpen(''); setWfDetail(null); return }
          setWfOpen(file); setWfDetail(null); setWfNote('读取中…')
          try {
            const r = await post('/workflow-bindings', { file })
            if (!r?.ok) { setWfNote('读失败：' + (r?.error || '')); return }
            // 工作流对象本身没有 file 字段，判定"读的是哪张"要靠它，补进来
            setWfDetail(Object.assign({}, r.workflow, { file, fields: r.fields || [], loraOrderPairs: r.loraOrderPairs || [] }))
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

        function patchLora(lora, patch) {
          if (!detail) return
          const file = detail.file
          const key = imageLoraKey(lora)
          setWfDetail(current => current?.file !== file ? current : { ...current, bindings: { ...current.bindings,
            loras: (current.bindings?.loras || []).map(item => imageLoraKey(item) === key ? { ...item, ...patch } : item) } })
          const write = async () => {
            try {
              await post('/workflow-bindings', { file, patch: { loras: [{ node: lora.node, slot: lora.slot, ...patch }] } })
              setWfNote('已保存')
            } catch (error) {
              setWfNote('LoRA 保存失败：' + (error?.message ?? error))
              throw error
            }
          }
          loraWrites.current = loraWrites.current.catch(() => {}).then(write)
          loraWrites.current.catch(() => {})
        }

        function swapLoras(first, second) {
          const file = detail.file
          const write = async () => {
            try {
              const result = await post('/workflow-bindings', { file, patch: { loraSwap: [imageLoraKey(first), imageLoraKey(second)] } })
              setWfDetail(current => current?.file !== file ? current : { ...result.workflow, file, loraOrderPairs: result.loraOrderPairs })
              setWfNote('已调整 LoRA 顺序')
            } catch (error) { setWfNote('排序失败：' + (error?.message ?? error)) }
          }
          loraWrites.current = loraWrites.current.then(write, write)
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

        async function saveWorkflowInputs(patch) {
          const file = detail.file
          try {
            const result = await post('/workflow-bindings', { file, ...(patch ? { patch } : { refreshNodes: true }) })
            setWfDetail(current => current?.file !== file ? current : {
              ...result.workflow, file, fields: result.fields || [], loraOrderPairs: result.loraOrderPairs || [],
            })
            setWfNote(patch ? '节点输入已保存' : '已读取 ' + (result.discovery?.recognized || 0) + ' 种节点定义')
            return result
          } catch (error) {
            setWfNote(String(error?.message ?? error))
            throw error
          }
        }

        async function loadLoraNames() {
          const r = await jsonFetch(BASE + '/loras-available', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
          if (r?.ok) { setLoraList(r.loras ?? []); setWfNote(r.loras?.length ? ('读到 ' + r.loras.length + ' 个已安装的 LoRA') : '没读到 LoRA 列表（ComfyUI 开了吗）') }
        }

        async function previewImport(text, filename) {
          if (wfImportBusy) return
          setWfImportBusy(true)
          setWfImportPreview(null)
          try {
            const payload = JSON.parse(text)
            const result = await post('/workflow-import', { workflow: payload, filename, preview: true })
            setWfImportPreview({ ...result, payload })
            setWfNote('')
          } catch (error) { setWfNote('预检失败：' + (error?.message ?? error)) }
          finally { setWfImportBusy(false) }
        }

        async function doImport() {
          if (wfImportBusy || !wfImportPreview?.outputNode) return
          setWfImportBusy(true)
          try {
            const r = await post('/workflow-import', { workflow: wfImportPreview.payload, name: wfImportPreview.name, outputNode: wfImportPreview.outputNode })
            setWfNote('已导入《' + r.name + '》')
            setWfImportOpen(false); setWfPaste(''); setWfImportPreview(null)
            const state = await jsonFetch(BASE + '/state', { cache: 'no-store' }).catch(() => null)
            if (state) receiveState(state)
          } catch (error) { setWfNote('导入失败：' + (error?.message ?? error)) }
          finally { setWfImportBusy(false) }
        }
        async function pickWfFile(event) {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          try { const text = await file.text(); setWfPaste(text); await previewImport(text, file.name) }
          catch { setWfNote('读文件失败') }
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
              legacySelection ? '导入后点它右边的「设为默认」，之后生成就用这张了。当前：' + (function () {
                const cur = (data.workflows || []).find(w => w.current)
                return cur ? '《' + (cur.label || cur.id) + '》' : '（没选，用第一张可用的）'
              })() : '工作流是模板使用的生图接口，请在模板里绑定。')),
          h('div', { style: S.row },
            h('button', { style: buttonStyle, onClick: () => setWfImportOpen(v => !v) }, wfImportOpen ? '✖ 收起导入' : '📥 导入工作流'),
            h('button', { style: buttonStyle, onClick: async () => { const r = await post('/reload', {}); if (r?.state) receiveState(r.state); setWfNote('已重新扫描') } }, '🔄 重新扫描'),
            h('button', { type: 'button', style: buttonStyle, onClick: () => setImageEditSource({}) }, '图片编辑'),
            h('button', { style: buttonStyle, onClick: loadLoraNames }, '🧩 读 ComfyUI 的 LoRA 列表'),
            legacySelection ? h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } },
              h('input', { type: 'checkbox', checked: Boolean(config.lockWorkflow), onChange: e => save({ lockWorkflow: e.target.checked }) }),
              '锁定（不管别处选什么都用这张）') : null,
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
            h('textarea', { value: wfPaste, placeholder: '粘贴 ComfyUI 的 API 格式 JSON…', style: Object.assign({}, ta, { marginTop: '8px' }), onChange: e => { setWfPaste(e.target.value); setWfImportPreview(null) } }),
            h('div', { style: Object.assign({}, S.row, { marginTop: '8px' }) },
              h('button', { type: 'button', style: buttonStyle, disabled: wfImportBusy || !wfPaste.trim(), onClick: () => previewImport(wfPaste) }, '解析预览'),
              h('button', { type: 'button', style: buttonStyle, onClick: () => { setWfPaste(''); setWfNote(''); setWfImportPreview(null) } }, '清空'),
            ),
            wfImportPreview ? h('section', { style: S.card, 'aria-label': '工作流导入预检' },
              promptField('工作流名称', h('input', { style: S.input, 'aria-label': '工作流名称', value: wfImportPreview.name,
                maxLength: 80, disabled: wfImportBusy, onChange: event => setWfImportPreview(value => ({ ...value, name: event.target.value })) })),
              h('div', null, wfImportPreview.nodes + ' 个节点'),
              h('dl', null, [['positive', '正面'], ['negative', '负面'], ['size', '尺寸'], ['seed', '种子'], ['loras', 'LoRA']].map(([key, label]) =>
                h('div', { key, style: S.row }, h('dt', null, label),
                  h('dd', { style: { margin: 0 } }, (wfImportPreview.bindings?.[key] || []).map(item => item.node + ' · ' + (item.name || item.input)).join('、') || '未识别')))),
              promptField('图片输出节点', h('select', { style: S.input, 'aria-label': '图片输出节点', value: wfImportPreview.outputNode || '',
                onChange: event => setWfImportPreview(value => ({ ...value, outputNode: event.target.value })) },
                h('option', { value: '' }, '选择输出节点'),
                wfImportPreview.outputs?.map(item => h('option', { key: item.id, value: item.id }, item.id + ' · ' + item.label)))),
              h('button', { type: 'button', style: S.tab(true), disabled: wfImportBusy || !wfImportPreview.outputNode ||
                (!wfImportPreview.bindings?.positive?.length && !wfImportPreview.hasImageInput), onClick: doImport }, '确认导入')) : null,
          ) : null,

          h('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } },
            list.length ? list.map(wf => {
              const isOpen = String(wf.file ?? '') === String(wfOpen)
              const sum = wf.summary || {}
              return h('div', { key: wf.id, style: { borderRadius: '10px', border: isOpen ? '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)', padding: '10px 12px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: '13px', fontWeight: 600, flex: 1, minWidth: '140px' } },
                    wf.label || wf.id || '(无名)',
                    legacySelection && wf.current ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-success-primary)', marginLeft: '8px' } }, '← 正在使用') : null,
                    wf.error ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-error-primary)', marginLeft: '8px' } }, '（不可用）') : null),
                  legacySelection ? (wf.current
                    ? h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-state-success-primary)', padding: '3px 8px', borderRadius: '7px', background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent)' } }, '✓ 正在用这张')
                    : h('button', {
                        style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 12px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, transparent)', color: 'var(--dsw-alias-state-success-primary)' }),
                        title: '之后的生成都用这张工作流',
                        onClick: async () => {
                          if (wf.error) { if (typeof showToast === 'function') showToast('这张工作流不可用：' + wf.error, 'fail'); return }
                          await save({ defaultWorkflow: wf.id, lockWorkflow: true })
                          if (typeof showToast === 'function') showToast('已切换：之后的生成用《' + (wf.label || wf.id) + '》')
                        },
                      }, '设为默认')) : null,
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
                  '提示词和生成机制在模板中编辑，节点图用于调整工作流。'),
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

                        h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '快捷参数'),
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
                          : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } }, '读取参数中…')),

                        h(WorkflowInputPanel, { key: detail.file, workflow: detail, fields: detail.fields,
                          onSave: saveWorkflowInputs, onOpenGraph: () => setWfGraphFile(detail.file) }),
                        h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '工作流基础 LoRA'),
                        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } },
                          'LoRA（' + (detail.bindings?.loras?.length ?? 0) + ' 个）'),
                        (detail.bindings?.loras ?? []).length
                          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                              (detail.bindings.loras).map((lora, index, entries) => h('div', { key: imageLoraKey(lora), style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 8px', borderRadius: '8px', background: lora.enabled === false ? 'rgba(0,0,0,.2)' : 'color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent)' } },
                                h('input', { type: 'checkbox', checked: lora.enabled !== false, title: '启用 / 停用这个 LoRA', onChange: e => patchLora(lora, { enabled: e.target.checked }) }),
                                loraList.length
                                  ? h('select', { value: lora.name || '', style: Object.assign({}, S.input, { flex: 1, minWidth: '170px', fontSize: '12px' }), onChange: e => patchLora(lora, { name: e.target.value }) },
                                      h('option', { value: lora.name || '' }, lora.name || '（未选）'),
                                      loraList.filter(n => n !== lora.name).map(n => h('option', { key: n, value: n }, n)))
                                  : h(PresetTextField, { value: lora.name || '', placeholder: 'lora 文件名', style: Object.assign({}, S.input, { flex: 1, minWidth: '170px', fontSize: '12px' }), onCommit: value => patchLora(lora, { name: value }) }),
                                h(WorkflowLoraWeight, { label: '模型权重', value: lora.strengthModel, onSave: value => patchLora(lora, { strengthModel: value }) }),
                                lora.strengthClip !== undefined ? h(WorkflowLoraWeight, { label: 'CLIP 权重', value: lora.strengthClip, onSave: value => patchLora(lora, { strengthClip: value }) }) : null,
                                h('span', { style: STRUCTURE_MUTED }, '槽位 ' + imageLoraKey(lora)),
                                [-1, 1].map(direction => {
                                  const other = entries[index + direction]
                                  if (!other || !detail.loraOrderPairs?.some(pair => pair.includes(imageLoraKey(lora)) && pair.includes(imageLoraKey(other)))) return null
                                  return h('button', { key: direction, type: 'button', style: buttonStyle, onClick: () => swapLoras(lora, other) }, direction < 0 ? '上移' : '下移')
                                }),
                              )))
                          : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '这张工作流里没有 LoRA 节点（没有 LoraLoader）')),
                        h('button', { type: 'button', style: buttonStyle, onClick: () => setImageEditSource({}) }, '打开图片编辑'),
                      ),
                ) : null,
              )
            }) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } }, '还没有工作流。点「📥 导入工作流」或往插件目录的 workflows/ 里丢 JSON 再点重新扫描。'),
          ),
        )
      }

      // ---- 历史图 ----
      function galleryTab() {
        const nativeImages = galleryMode ? [] : legacyImages
        const done = historyJobs.filter(function (job) { return job.hasImage && (job.source === 'play' || job.source !== 'card' && job.label !== '卡片工作台') })
        const preview = image => {
          const orderedImages = ordered.flatMap(group => group.items)
          if (!orderedImages.length) return
          const images = orderedImages.map(item => item.preview)
          const index = Math.max(0, orderedImages.findIndex(item => item.image === image))
          openImageOverlay?.({ open: true, images, note: '游玩画廊', index })
        }
        async function showGalleryPrompt(job, field) {
          const keys = field === 'negative' ? ['negative'] : ['positive', 'prompt', 'submittedPrompt', 'rawPrompt']
          setGalleryPrompt({ id: job.id, field, text: '', loading: true, note: '' })
          try {
            const detail = keys.some(key => typeof job[key] === 'string') ? job
              : (await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(job.id), { cache: 'no-store' })).job
            if (!detail) throw new Error('没有找到这张图的记录')
            const text = String(keys.map(key => detail[key]).find(value => typeof value === 'string' && value) || '')
            setGalleryPrompt(current => current?.id === job.id && current.field === field ? { ...current, text, loading: false } : current)
          } catch (error) {
            setGalleryPrompt(current => current?.id === job.id && current.field === field ? { ...current, loading: false, note: '读取失败：' + error.message } : current)
          }
        }
        async function copyGalleryPrompt() {
          const current = galleryPrompt
          if (!current?.text) return
          try {
            await navigator.clipboard.writeText(current.text)
            setGalleryPrompt(value => value === current ? { ...value, note: '已复制完整提示词' } : value)
          } catch {
            setGalleryPrompt(value => value === current ? { ...value, note: '复制失败，请选中下方内容手动复制' } : value)
          }
        }
        const tiles = done.map(function (job) {
          return h('div', {
            key: job.id,
            'data-play-job-id': job.id,
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
                    { icon: '📋', label: '查看完整提示词', onClick: () => showGalleryPrompt(job, 'positive') },
                    { label: '查看负面提示词', onClick: () => showGalleryPrompt(job, 'negative') },
                    ...(galleryMode === 'trash' ? [
                      { label: '恢复到画廊', onClick: () => updateGalleryItem(job.id, 'restore') },
                      { label: '彻底删除', onClick: () => requestGalleryDeletion([job.id]) },
                    ] : [
                      { label: '用这张图编辑', onClick: () => setImageEditSource({ url: BASE + '/jobs?id=' + encodeURIComponent(job.id) + '&image=1', name: job.label || '已有图片' }) },
                      { label: job.favorite ? '取消收藏' : '收藏', onClick: () => updateGalleryItem(job.id, job.favorite ? 'unfavorite' : 'favorite') },
                      { label: '移到回收站', onClick: () => updateGalleryItem(job.id, 'trash') },
                    ]),
                  ],
                })
              },
            }),
            gallerySelect ? h('div', {
              style: { position: 'absolute', top: '6px', left: '6px', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 50%, transparent)', background: galleryPicked[job.id] ? 'var(--dsw-alias-brand-primary)' : 'rgba(0,0,0,.5)', color: 'var(--dsw-alias-label-primary)', fontSize: '15px', lineHeight: '22px', textAlign: 'center' },
            }, galleryPicked[job.id] ? '✓' : '') : null,
            !gallerySelect ? h('button', {
              type: 'button',
              title: galleryMode === 'trash' ? '恢复到画廊' : '移到回收站',
              disabled: galleryDeleting,
              'aria-label': (galleryMode === 'trash' ? '恢复 ' : '回收 ') + (job.label || job.id),
              onClick: function (e) { e.stopPropagation(); updateGalleryItem(job.id, galleryMode === 'trash' ? 'restore' : 'trash') },
              style: {
                position: 'absolute', top: '6px', right: '6px', width: '26px', height: '26px',
                borderRadius: '7px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent)',
                background: 'rgba(0,0,0,.55)', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer',
                fontSize: '13px', lineHeight: 1, padding: 0,
              },
            }, galleryMode === 'trash' ? '恢复' : '🗑') : null,
            h('div', { style: { ...GALLERY_CAPTION, display: 'flex', alignItems: 'center', gap: 6 } },
              h('span', { style: { flex: 1 } }, (job.label || '未命名') + ' · ' + (job.size || '')),
              !gallerySelect && galleryMode !== 'trash' ? h('button', { type: 'button', 'aria-label': (job.favorite ? '取消收藏 ' : '收藏 ') + (job.label || job.id),
                style: { ...S.tab(job.favorite), padding: '2px 5px', fontSize: 11 }, onClick: () => updateGalleryItem(job.id, job.favorite ? 'unfavorite' : 'favorite') },
                job.favorite ? '已收藏' : '收藏') : null),
            !gallerySelect ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 6px 6px' } },
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px', flex: '1 0 auto' }, 'aria-label': '查看提示词 ' + (job.label || job.id), onClick: () => showGalleryPrompt(job, 'positive') }, '提示词'),
              h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px', flex: '1 0 auto' }, 'aria-label': '查看负面词 ' + (job.label || job.id), onClick: () => showGalleryPrompt(job, 'negative') }, '负面'),
              galleryMode === 'trash' ? h('button', { type: 'button', disabled: galleryDeleting, style: { ...buttonStyle, padding: '3px 5px', color: 'var(--dsw-alias-state-error-primary)' }, 'aria-label': '彻底删除 ' + (job.label || job.id), onClick: () => requestGalleryDeletion([job.id]) }, '彻底删除') : null,
              galleryMode !== 'trash' ? h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px' }, 'aria-label': '图生图 ' + (job.label || job.id), onClick: () => setImageEditSource({ url: BASE + '/jobs?id=' + encodeURIComponent(job.id) + '&image=1', name: job.label || '已有图片' }) }, '图生图') : null) : null,
            !gallerySelect && galleryPrompt?.id === job.id ? h('section', { 'aria-label': '图片提示词详情', style: { padding: 6, minWidth: 0 } },
              h('div', { style: { ...S.row, justifyContent: 'space-between' } }, h('strong', { style: { fontSize: 12 } }, galleryPrompt.field === 'negative' ? '完整负面提示词' : '完整正面提示词'),
                h('button', { type: 'button', style: { ...buttonStyle, padding: '2px 5px' }, onClick: () => setGalleryPrompt(null) }, '收起提示词')),
              galleryPrompt.loading ? h('p', { role: 'status', style: STRUCTURE_MUTED }, '正在读取提示词…')
                : galleryPrompt.text ? h(React.Fragment, null,
                  h('textarea', { 'aria-label': galleryPrompt.field === 'negative' ? '完整负面提示词' : '完整正面提示词', readOnly: true, value: galleryPrompt.text, style: promptArea(100) }),
                  h('button', { type: 'button', style: { ...buttonStyle, marginTop: 4 }, onClick: copyGalleryPrompt }, '复制完整内容'))
                : !galleryPrompt.note ? h('p', { role: 'status', style: STRUCTURE_MUTED }, galleryPrompt.field === 'negative' ? '这张图没有记录负面提示词' : '这张图没有记录正面提示词') : null,
              galleryPrompt.note ? h('p', { role: 'status', style: STRUCTURE_MUTED }, galleryPrompt.note) : null) : null,
          )
        })
        const legacyTiles = nativeImages.map(function (item) {
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
        nativeImages.forEach((item, index) => {
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
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } }, '画廊（插件 ' + done.length + ' 张' + (nativeImages.length ? ' · 早期 ' + nativeImages.length + ' 张' : '') + '）'),
          h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } }, '点缩略图查看原图，按页面顺序切图。右键插件图可查看操作。'),
          h('div', { style: S.row },
            [['', '全部图片'], ['favorite', '收藏'], ['trash', '回收站']].map(([key, label]) =>
              h('button', { key, type: 'button', style: S.tab(galleryMode === key), 'aria-pressed': galleryMode === key, disabled: galleryDeleting, onClick: () => {
                if (galleryMode === key) return
                setGalleryMode(key); setHistoryJobs([]); setGalleryPicked({}); setGallerySelect(false); setGalleryDeletion(null); setGalleryDeleteNote('')
              } }, label)),
            h('button', { style: buttonStyle, onClick: function () { setHistoryNote('读取中…'); setHistoryTick(n => n + 1) } }, '🔄 刷新'),
            h('button', { style: buttonStyle, onClick: () => preview(), disabled: !ordered.length }, '浏览全部'),
            h('button', { style: buttonStyle, disabled: galleryDeleting, onClick: function () {
              setGallerySelect(v => !v); setGalleryPicked({}); setGalleryDeletion(null)
            } }, gallerySelect ? '✖ 退出批量' : '☑ 批量选择'),
            galleryMode === 'trash' ? h('button', { style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary)' }, disabled: galleryDeleting || !done.length, onClick: () => requestGalleryDeletion([], true) }, '清空回收站') : null,
            gallerySelect ? h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: function () {
              const next = {}
              for (const job of done) next[job.id] = true
              setGalleryPicked(next)
            } }, '全选') : null,
            gallerySelect ? h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px' }), onClick: function () { setGalleryPicked({}) } }, '取消全选') : null,
            gallerySelect ? h('button', {
              style: Object.assign({}, buttonStyle, { borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 70%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }),
              disabled: galleryDeleting || !Object.values(galleryPicked).some(Boolean),
              onClick: function () {
                const ids = Object.keys(galleryPicked).filter(k => galleryPicked[k])
                if (galleryMode === 'trash') requestGalleryDeletion(ids)
                else trashSelected(ids)
              },
            }, (galleryMode === 'trash' ? '彻底删除（' : '移到回收站（') + Object.keys(galleryPicked).filter(k => galleryPicked[k]).length + '）') : null,
            historyNote ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, historyNote) : null,
          ),
          galleryMode === 'trash' && galleryDeletion ? h('div', { role: 'group', 'aria-label': '确认彻底删除图片', style: { ...S.card, marginTop: 10 } },
            h('p', { style: { margin: '0 0 8px', fontSize: 13 } }, galleryDeletion.all ? '清空回收站中的全部图片？删除后无法恢复。' : '彻底删除这 ' + galleryDeletion.ids.length + ' 张图片？删除后无法恢复。'),
            h('div', { style: S.row },
              h('button', { type: 'button', style: buttonStyle, disabled: galleryDeleting, onClick: () => setGalleryDeletion(null) }, '取消'),
              h('button', { type: 'button', style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary)' }, disabled: galleryDeleting, onClick: deleteGalleryImages }, galleryDeleting ? '正在删除…' : '确认彻底删除'))) : null,
          galleryDeleteNote ? h('p', { role: 'status', style: { fontSize: 12 } }, galleryDeleteNote) : null,
          ordered.length ? ordered.map(group => h('details', { key: group.key, open: true, style: { marginTop: '14px' } },
            h('summary', { style: { cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
              groupTitle(group), h('span', { style: { fontWeight: 400, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginLeft: '8px' } }, group.items.length + ' 张')),
            h('div', { style: GALLERY_GRID }, group.items.map(item => item.node))))
            : historyNote ? null : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '14px 0 0' } }, galleryMode === 'trash' ? '回收站是空的' : '还没有图片'),
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

      // ---- 工作流 ----
      function renderPromptResource(block, close) {
        if (block.kind === 'style') return h(InlineStyleEditor, { config, save, styleId: block.styleId })
        if (block.kind === 'entries') return h(PromptEntryLibrary, { entries: config.promptEntries || [], limit: config.promptEntryLimit,
          revision: config.promptRevision, save, compact: true, group: block.entryGroup })
        if (block.kind === 'library') return peopleTab(block)
        const workflow = (data.workflows || []).find(item => item.id === block.workflowId)
        return workflow ? h(WorkflowGraphEditor, { key: workflow.file, file: workflow.file, post, embedded: true, onClose: close })
          : h('p', { style: STRUCTURE_MUTED }, '先选择此模块使用的工作流。')
      }
      const worldbookMode = config.promptSystem !== 'workbench'
      const tabs = [['plan', '设置'], ...(!worldbookMode ? [['style', '生图工作台']] : [['worldbook', '世界书']]), ...(cardEnabled === true ? [['card-worldbook', '卡片世界书']] : []), ['library', '资料库'], ['people', '人物库'], ['gallery', '画廊']]
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
        h('div', { style: S.row }, promptField('生图模式', h('select', { 'aria-label': '生图系统模式', style: S.input, value: config.promptSystem || 'worldbook', onChange: async event => { const mode = event.target.value; if (await save({ promptSystem: mode })) setTab(mode === 'worldbook' ? 'worldbook' : 'style') } },
          h('option', { value: 'worldbook' }, '世界书模式（默认）'), h('option', { value: 'workbench' }, '生图工作台（高级模式）')))),
        taskPanel(),
        h('div', { style: S.row }, tabs.map(([key, label]) => h('button', { key, style: S.tab(tab === key), onClick: () => setTab(key) }, label))),
        tab === 'plan' ? h('div', null,
          !worldbookMode ? h(GenerationTemplateSettings, { config, save, onEdit: id => { selectEditingTemplate(id); setTab('style') } }) : null,
          h('details', { open: worldbookMode }, h('summary', { style: PROMPT_DISCLOSURE }, worldbookMode ? '渠道与工作流' : '管理生图接口'),
            ComfyBackendCard(), imageBackend === 'comfyui' ? workflowCard() : null),
          planTab(),
          h(ImageOutputSettings, { config, save }),
          h(PromptIntegrationPanel, { config, cardEnabled, cardToggleBusy, cardToggleNote, toggleCardStudio }),
        ) : null,
        !worldbookMode && tab === 'style' ? h(PromptWorkspace, { config, workflows: data.workflows, definitions: data.definitions, save,
          editingTemplate, select: selectEditingTemplate, renderResource: renderPromptResource }) : null,
        tab === 'library' ? h('section', { 'aria-label': '生图资料库' },
          h('details', { style: S.card },
            h('summary', { style: PROMPT_DISCLOSURE }, '画风库' + (config.stylePresets?.length ? ' · ' + config.stylePresets.length + ' 套' : '')),
            h(ImageStylePanel, { config, save })),
          !worldbookMode && config.promptEntryLimit ? h(PromptEntryLibrary, { entries: config.promptEntries || [], limit: config.promptEntryLimit, revision: config.promptRevision, save }) : null) : null,
        tab === 'people' ? h(React.Fragment, null, peopleTab(), h(CharacterDesignSettings, { config, save })) : null,
        tab === 'gallery' ? h('div', null,
          // 画廊分两档：游玩画廊是配图链路自己的记录，卡片画廊是工作台出的图。默认落在游玩那档。
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
            [['play', '游玩画廊'], ['card', '卡片画廊']].map(([key, label]) =>
              h('button', { key, type: 'button', onClick: () => setGallerySource(key), style: S.tab(gallerySource === key) }, label)),
          ),
          gallerySource === 'card' ? h('div', { style: S.card }, h(CardGalleryPage, { onEdit: item => setImageEditSource({ url: item.url, name: item.prompt?.slice(0, 60) || '卡片图片' }) })) : galleryTab(),
        ) : null,
        worldbookMode && tab === 'worldbook' ? h(LegacyWorldbookPanel, { initialFormat: config.worldbookEditorFormat || data.worldbookFormat || 'tags', save, providers: data.imageProviders || [] }) : null,
        cardEnabled === true && tab === 'card-worldbook' ? h('section', { 'aria-label': '卡片模式世界书' }, h(CardWorldbookPanel)) : null,
        wfGraphFile ? h(WorkflowGraphEditor, { key: wfGraphFile, file: wfGraphFile, post,
          onClose: () => setWfGraphFile(''),
          onSaved: () => { setWfGraphFile(''); setWfOpen(''); setWfDetail(null); setWfNote('工作流已保存') },
        }) : null,
        imageEditSource ? h(ImageEditWorkbench, { workflows: data.workflows || [], config, source: imageEditSource, onClose: () => { setImageEditSource(null); setHistoryTick(value => value + 1) } }) : null,
      )
    }
