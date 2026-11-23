    // ── 画廊（游玩画廊 / 卡片画廊 / 收藏 / 回收站）──────────────────────
    // 两档来源、四个视图，图块只有一套：右上角是移入回收站（回收站里是恢复），
    // 说明行右侧是收藏，底部是提示词 / 负面 / 图生图。
    // 游玩来源走本插件的 /history，卡片来源走工作台的 /dsh-tavern-gen/api/gallery。
    const CARD_GALLERY_API = '/dsh-tavern-gen/api'
    let cardGalleryCtx = null
    // 每行固定三张：面板宽度变化时列数不再跟着 3/4 来回跳。
    const GALLERY_GRID = {
      display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 10, marginTop: 10,
    }
    const GALLERY_TILE = {
      position: 'relative', minWidth: 0, borderRadius: 10, overflow: 'hidden',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 3%, transparent)',
    }
    const GALLERY_THUMB = {
      display: 'block', width: '100%', aspectRatio: '3 / 4', objectFit: 'cover',
      background: 'var(--dsw-specific-input-major)',
    }
    const GALLERY_CAPTION = {
      padding: '6px 8px', fontSize: 11, color: 'var(--dsw-alias-label-tertiary)',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }
    const GALLERY_VIEWS = [['play', '游玩画廊'], ['card', '卡片画廊'], ['favorite', '收藏'], ['trash', '回收站']]
    const GALLERY_HINT = '点缩略图查看原图，按页面顺序切图。右键可查看操作，点组标题收起或展开。'
    // 标题行那排按钮沿用卡片工作台原来的尺寸（刷新 / 清空全部那一套），紧跟标题，不推到右端。
    const GALLERY_BUTTON = { ...buttonStyle, padding: '5px 10px', fontSize: 12 }
    const GALLERY_ROW = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }
    // 移入回收站的图标自己画：字体里的垃圾桶太细，各端字形还不一样，SVG 才能把描边定死。
    // 16px 显示 / 24 视框 = 0.667 缩放，strokeWidth 2.4 正好落成 1.6px 实际描边。
    const GALLERY_TRASH_ICON = h('svg', {
      viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none',
      stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true', focusable: 'false', style: { display: 'block' },
    },
      h('path', { d: 'M4.6 7.2h14.8' }),
      h('path', { d: 'M9.4 4.6h5.2' }),
      h('path', { d: 'M6.7 7.2l.8 12h9l.8-12' }),
      h('path', { d: 'M10.1 10.9v5.4M13.9 10.9v5.4' }))

    /** 收藏与回收站跨两个来源，游玩和卡片两个视图只看自己那档。 */
    function galleryMode(view) { return view === 'favorite' || view === 'trash' ? view : '' }
    function galleryVisible(view) {
      const mode = galleryMode(view)
      return item => Boolean(item) && (mode === 'trash'
        ? Boolean(item.trashedAt)
        : !item.trashedAt && (mode !== 'favorite' || item.favorite === true))
    }
    /** 画廊要用的 tavernUi：取不到就退化成会话短码，不能让整页白屏。 */
    function galleryTavernUi() {
      try { const ui = cardGalleryCtx?.get?.('tavernUi'); if (ui) return ui } catch { /* 没声明依赖的服务会当场抛 */ }
      return typeof tavernUiService === 'object' && tavernUiService ? tavernUiService : null
    }
    const galleryPad = value => String(value).padStart(2, '0')
    function galleryStamp(at) {
      const date = new Date(at)
      return galleryPad(date.getMonth() + 1) + '-' + galleryPad(date.getDate()) + ' ' + galleryPad(date.getHours()) + ':' + galleryPad(date.getMinutes())
    }

    function GalleryPanel({ revision = 0, onEditImage } = {}) {
      const [view, setView] = useState('play')
      // null = 这份来源还没拉到；空数组 = 拉到了但没有图。
      const [jobs, setJobs] = useState(null)
      const [cards, setCards] = useState(null)
      const [legacy, setLegacy] = useState([])
      const [games, setGames] = useState({})
      const [note, setNote] = useState('读取中…')
      const [tick, setTick] = useState(0)
      const [select, setSelect] = useState(false)
      const [picked, setPicked] = useState({})
      const [prompt, setPrompt] = useState(null)
      const [deletion, setDeletion] = useState(null)
      const [deleting, setDeleting] = useState(false)
      const [deleteNote, setDeleteNote] = useState('')
      const [exporting, setExporting] = useState(null)
      const [closedGroups, setClosedGroups] = useState({})
      const deleteBusy = React.useRef(false)

      const mode = galleryMode(view)
      const visible = galleryVisible(view)

      // 游玩来源：服务端按收藏 / 回收站筛过一遍，前端再按同一套规则兜底。
      React.useEffect(() => {
        if (view === 'card') return undefined
        let alive = true
        setNote('读取中…')
        jsonFetch(BASE + '/history?source=play&gallery=' + galleryMode(view)).then(result => {
          if (!alive) return
          const list = Array.isArray(result?.jobs) ? result.jobs : []
          setJobs(list)
          setNote(current => current === '读取中…' ? '' : current)
          reportHost('history-ok', { jobs: list.length })
        }, error => {
          if (!alive) return
          setJobs([])
          setNote('读不到：' + (error?.message ?? error))
          reportHost('history-fail', {
            name: String(error?.name ?? ''),
            msg: String(error?.message ?? error),
            stack: String(error?.stack ?? '').slice(0, 400),
            url: BASE + '/history?source=play',
          })
        })
        return () => { alive = false }
      }, [view, tick, revision])

      // 卡片来源：工作台自己记的画廊，收藏和回收站标记跟着记录走。
      React.useEffect(() => {
        if (view === 'play') return undefined
        let alive = true
        setNote('读取中…')
        jsonFetch(CARD_GALLERY_API + '/gallery').then(value => {
          if (!alive) return
          setCards(Array.isArray(value?.items) ? value.items : [])
          setNote(current => current === '读取中…' ? '' : current)
        }, error => {
          if (!alive) return
          setCards([])
          setNote('读不到卡片画廊：' + (error?.message ?? error))
        })
        return () => { alive = false }
      }, [view, tick, revision])

      // Tavern 自带生图画的旧图，只读，只在游玩画廊出现。
      React.useEffect(() => {
        if (view !== 'play') { setLegacy([]); return undefined }
        const service = galleryTavernUi()
        if (!service || typeof service.listIllustrations !== 'function') { setLegacy([]); return undefined }
        let alive = true
        service.listIllustrations().then(items => { if (alive) setLegacy(Array.isArray(items) ? items : []) }, () => { if (alive) setLegacy([]) })
        return () => { alive = false }
      }, [view, tick, revision])

      // 按局 / 按会话查标题，两个来源共用同一个查询。
      const gameIds = [...new Set([
        ...(jobs ?? []).map(job => job.gameId),
        ...(cards ?? []).map(item => item.session),
        ...legacy.map(item => item.gameId),
      ].filter(Boolean))].sort().join(',')
      React.useEffect(() => {
        if (!gameIds) return undefined
        const service = galleryTavernUi()
        if (!service || typeof service.getGames !== 'function') return undefined
        let alive = true
        service.getGames(gameIds.split(',')).then(value => { if (alive) setGames(value || {}) }, () => {})
        return () => { alive = false }
      }, [gameIds])

      // 每个视图只认自己的来源：卡片画廊里不该混进游玩图，反之亦然。
      const playEntries = (view === 'card' ? [] : (jobs ?? []).filter(job => job && job.hasImage && visible(job)
        && (job.source === 'play' || job.source !== 'card' && job.label !== '卡片工作台')))
        .map(job => ({
          key: 'play:' + job.id, source: 'play', id: job.id, job,
          url: galleryImageUrl(job.id),
          label: job.label || '未命名',
          alt: job.label || '图',
          caption: (job.label || '未命名') + ' · ' + (job.size || ''),
          captionTitle: '',
          favorite: job.favorite === true, trashedAt: job.trashedAt || null,
          at: Number(job.completedAt || job.createdAt) || 0,
          group: 'play:' + (job.gameId || ''),
          readOnly: false,
        }))
      const cardEntries = (view === 'play' ? [] : (cards ?? []).filter(item => item && item.id && visible(item))).map(item => {
        // 说明行和游玩画廊一样是「名字 · 尺寸」，渠道和 Seed 放进悬浮提示，别把这一行挤爆。
        const label = [item.preset || '默认画风', item.size].filter(Boolean).join(' · ')
        return {
          key: 'card:' + item.id, source: 'card', id: item.id, item,
          url: item.url,
          label,
          // 图片的可读描述用提示词（和卡片工作台原来一致），按钮说明用「画风 · 尺寸」。
          alt: String(item.prompt || item.file || label),
          caption: label,
          captionTitle: [item.preset || '默认画风', item.channel, item.size, Number.isSafeInteger(item.seed) ? 'Seed ' + item.seed : ''].filter(Boolean).join(' · '),
          favorite: item.favorite === true, trashedAt: item.trashedAt || null,
          at: Number(item.at) || 0,
          group: 'card:' + (item.session || ''),
          readOnly: false,
        }
      })
      const legacyEntries = (view === 'play' ? legacy : []).map(item => ({
        key: 'legacy:' + item.url, source: 'legacy', id: String(item.url),
        url: item.url,
        label: item.description || '插图',
        alt: item.description || '插图',
        caption: '第 ' + item.turn + ' 轮 · 早期插图',
        captionTitle: item.description || '',
        favorite: false, trashedAt: null,
        at: Number(item.createdAt) || 0,
        group: item.gameId ? 'play:' + item.gameId : 'legacy:' + (item.gameTitle || ''),
        legacyTitle: item.gameTitle || '',
        gameDeleted: item.gameDeleted === true,
        readOnly: true,
      }))
      const entries = [...playEntries, ...legacyEntries, ...cardEntries]

      // 分组：游玩按局、卡片按会话；组内与组间都是新的在前。
      const groups = new Map()
      for (const entry of entries) {
        if (!groups.has(entry.group)) {
          groups.set(entry.group, { key: entry.group, source: entry.group.startsWith('card:') ? 'card' : 'play', items: [] })
        }
        const group = groups.get(entry.group)
        if (entry.legacyTitle) group.legacyTitle = group.legacyTitle || entry.legacyTitle
        if (entry.gameDeleted) group.deleted = true
        group.items.push(entry)
      }
      for (const group of groups.values()) group.items.sort((a, b) => b.at - a.at)
      const ordered = [...groups.values()].sort((a, b) => (b.items[0]?.at || 0) - (a.items[0]?.at || 0))
      const flat = ordered.flatMap(group => group.items)
      // 收藏 / 回收站里两档来源混在一起，组标题要带上来源，否则分不清是哪个画廊的图。
      const mixed = view === 'favorite' || view === 'trash'

      function groupLabel(group) {
        const latest = group.items[0]?.at || 0
        const tail = latest ? ' · ' + galleryStamp(latest) : ''
        const head = group.key.slice(group.key.indexOf(':') + 1)
        if (group.source === 'card') {
          const raw = games[head]
          const text = typeof raw === 'string' ? raw : String(raw?.title || raw?.cardName || raw?.name || '')
          return (mixed ? '卡片 · ' : '') + (text || '会话 ' + head.replace(/^session-/, '').slice(0, 8)) + tail
        }
        const prefix = mixed ? '游玩 · ' : ''
        if (group.key.startsWith('legacy:')) return prefix + (group.legacyTitle || '早期插图') + tail
        if (!head) return prefix + '未归属对局（在设置里试画的图）' + tail
        const raw = games[head]
        const text = typeof raw === 'string' ? raw : String(raw?.title || raw?.cardName || raw?.name || '')
        return prefix + (text || group.legacyTitle || '已删除的对局') + (group.deleted ? '（已删除）' : '') + tail
      }

      const switchView = next => {
        if (next === view) return
        setView(next)
        setSelect(false); setPicked({}); setDeletion(null); setDeleteNote('')
        setPrompt(null); setClosedGroups({}); setExporting(null)
        setNote('读取中…')
      }
      const toggleGroup = key => setClosedGroups(current => Object.assign({}, current, { [key]: !current[key] }))

      function preview(entry) {
        if (!flat.length) return
        const images = flat.map(item => ({ url: item.url, alt: item.alt || item.label }))
        const index = entry ? Math.max(0, flat.findIndex(item => item.key === entry.key)) : 0
        const title = view === 'card' ? '卡片画廊' : view === 'favorite' ? '收藏' : view === 'trash' ? '回收站' : '游玩画廊'
        openImageOverlay?.({ open: true, images, note: title, index })
      }

      function openInEditor(entry) {
        if (typeof onEditImage !== 'function') return
        onEditImage(entry)
      }

      async function readPrompt(entry, field) {
        if (entry.source === 'card') return String((field === 'negative' ? entry.item?.negative : entry.item?.prompt) || '')
        if (entry.source === 'legacy') return ''
        const keys = field === 'negative' ? ['negative'] : ['positive', 'prompt', 'submittedPrompt', 'rawPrompt']
        const job = entry.job || {}
        const detail = keys.some(key => typeof job[key] === 'string' && job[key]) ? job
          : (await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(entry.id), { cache: 'no-store' })).job
        if (!detail) throw new Error('没有找到这张图的记录')
        return String(keys.map(key => detail[key]).find(value => typeof value === 'string' && value) || '')
      }

      async function showPrompt(entry, field) {
        setPrompt({ key: entry.key, field, text: '', loading: true, note: '' })
        try {
          const text = await readPrompt(entry, field)
          setPrompt(current => current?.key === entry.key && current.field === field ? { ...current, text, loading: false } : current)
        } catch (error) {
          setPrompt(current => current?.key === entry.key && current.field === field ? { ...current, loading: false, note: '读取失败：' + (error?.message ?? error) } : current)
        }
      }

      async function copyPrompt() {
        const current = prompt
        if (!current?.text) return
        try {
          await navigator.clipboard.writeText(current.text)
          setPrompt(value => value === current ? { ...value, note: '已复制完整提示词' } : value)
        } catch {
          setPrompt(value => value === current ? { ...value, note: '复制失败，请选中下方内容手动复制' } : value)
        }
      }

      function absorb(entry, updated) {
        if (!updated) return
        if (entry.source === 'card') setCards(list => list && list.map(item => item.id === entry.id ? { ...item, ...updated } : item).filter(visible))
        else setJobs(list => list && list.map(job => job.id === entry.id ? { ...job, ...updated } : job).filter(visible))
      }

      async function updateEntry(entry, operation) {
        try {
          const response = entry.source === 'card'
            ? await jsonFetch(CARD_GALLERY_API + '/gallery-item', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: entry.id, operation }),
            })
            : await jsonFetch(BASE + '/gallery-item', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: entry.id, operation }),
            })
          const updated = entry.source === 'card' ? response?.item : response?.job
          if (!updated) throw new Error('未收到画廊操作结果')
          absorb(entry, updated)
          return true
        } catch (error) {
          showToast?.('画廊操作失败：' + (error?.message ?? error), 'fail')
          return false
        }
      }

      const pickedEntries = () => flat.filter(entry => picked[entry.key] && !entry.readOnly)

      // 导出：两档来源各用自己的地址，选中几张就存几张。
      async function exportEntries(targets) {
        if (!targets.length || exporting?.busy) return
        setExporting({ busy: true, note: '正在准备导出…' })
        try {
          const saver = await createGalleryImageSaver()
          const failed = []
          const action = saver.directory ? '保存' : '发起下载'
          for (const [index, entry] of targets.entries()) {
            setExporting({ busy: true, note: '正在' + action + '第 ' + (index + 1) + ' / ' + targets.length + ' 张图片…' })
            try { await saver.save({ url: entry.url, label: entry.label }) } catch (error) { failed.push({ entry, reason: error?.message ?? String(error) }) }
          }
          const count = targets.length - failed.length
          const completed = saver.directory ? '已保存 ' + count + ' 张图片' : '已发起 ' + count + ' 张图片的下载'
          const failure = failed.length ? '，' + failed.length + ' 张失败' : ''
          const hint = !saver.directory && count ? '。请在浏览器下载列表查看，如有提示请允许多文件下载。' : ''
          setExporting({ note: completed + failure + hint, failed })
        } catch (error) {
          if (error?.name === 'AbortError') setExporting(current => ({ ...current, busy: false, note: '已取消导出' }))
          else setExporting({ note: '导出失败：' + (error?.message ?? error) })
        }
      }

      async function trashPicked() {
        const targets = pickedEntries()
        if (!targets.length) return
        const ask = typeof window !== 'undefined' && typeof window.confirm === 'function'
        if (ask && !window.confirm('将 ' + targets.length + ' 张图移到回收站？')) return
        for (const entry of targets) await updateEntry(entry, 'trash')
        setPicked({})
      }

      function requestDeletion(keys, all = false) {
        if (deleteBusy.current || !all && !keys.length) return
        setDeleteNote('')
        setDeletion({ keys, all })
      }

      // 彻底删除：按来源分两批走，各自只认自己回收站里的图。
      async function confirmDeletion() {
        if (!deletion || deleteBusy.current) return
        deleteBusy.current = true
        setDeleting(true)
        setDeleteNote('')
        const playIds = [], cardIds = []
        for (const entry of flat) {
          if (entry.source === 'legacy') continue
          if (!deletion.all && !deletion.keys.includes(entry.key)) continue
          ;(entry.source === 'card' ? cardIds : playIds).push(entry.id)
        }
        let removed = 0
        const failures = []
        try {
          if (playIds.length) {
            const response = await jsonFetch(BASE + '/gallery-delete', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(deletion.all ? { all: true } : { ids: playIds, all: false }),
            })
            const deleted = new Set(response?.deleted || [])
            removed += deleted.size
            setJobs(list => list && list.filter(job => !deleted.has(job.id)))
            for (const failure of response?.failed || []) failures.push(String(failure?.error || '删除失败'))
          }
          if (cardIds.length) {
            const response = await jsonFetch(CARD_GALLERY_API + '/gallery-delete', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(deletion.all ? { all: true } : { ids: cardIds, all: false }),
            })
            const deleted = new Set(response?.deleted || [])
            removed += deleted.size
            setCards(list => list && list.filter(item => !deleted.has(item.id)))
            for (const failure of response?.failed || []) failures.push(String(failure?.error || '删除失败'))
          }
          setPicked({})
          setDeletion(null)
          setDeleteNote('已彻底删除 ' + removed + ' 张图' + (failures.length ? '，' + failures.length + ' 张删除失败：' + failures[0] : ''))
        } catch (error) {
          setDeleteNote('删除失败：' + (error?.message ?? error))
        } finally {
          setTick(n => n + 1)
          deleteBusy.current = false
          setDeleting(false)
        }
      }

      function openMenu(event, entry) {
        if (typeof openContextMenu !== 'function' || entry.readOnly) return
        const items = [
          { icon: '🖼', label: '查看大图', onClick: () => preview(entry) },
          entry.source === 'play' ? { icon: '✏️', label: '改提示词重画', onClick: () => { if (typeof openEditorFor === 'function') openEditorFor(entry.id, entry.label) } } : null,
          { icon: '📋', label: '查看完整提示词', onClick: () => showPrompt(entry, 'positive') },
          { label: '查看负面提示词', onClick: () => showPrompt(entry, 'negative') },
        ]
        if (mode === 'trash') items.push(
          { label: '恢复到画廊', onClick: () => updateEntry(entry, 'restore') },
          { label: '彻底删除', onClick: () => requestDeletion([entry.key]) },
        )
        else items.push(
          { label: '用这张图编辑', onClick: () => openInEditor(entry) },
          { label: entry.favorite ? '取消收藏' : '收藏', onClick: () => updateEntry(entry, entry.favorite ? 'unfavorite' : 'favorite') },
          { label: '移到回收站', onClick: () => updateEntry(entry, 'trash') },
        )
        openContextMenu({ x: event.clientX, y: event.clientY, items: items.filter(Boolean) })
      }

      function tile(entry) {
        // 早期插图是 Tavern 原生画的，只读，不给任何操作按钮。
        if (entry.readOnly) {
          return h('div', { key: entry.key, style: GALLERY_TILE },
            h('button', { type: 'button', onClick: () => preview(entry), title: entry.captionTitle || '查看大图',
              style: { display: 'block', width: '100%', padding: 0, border: 0, background: 'none', cursor: 'zoom-in' } },
              h('img', { src: entry.url, alt: entry.alt || entry.label, loading: 'lazy', decoding: 'async', style: GALLERY_THUMB })),
            h('div', { style: GALLERY_CAPTION }, entry.caption),
          )
        }
        const on = Boolean(picked[entry.key])
        return h('div', {
          key: entry.key,
          'data-gallery-key': entry.key,
          // 游玩图保留原来的作业锚点，宿主/脚本按它定位单张图。
          'data-play-job-id': entry.source === 'play' ? entry.id : undefined,
          style: {
            ...GALLERY_TILE,
            border: select && on ? '2px solid var(--dsw-alias-brand-primary)' : GALLERY_TILE.border,
            boxShadow: select && on ? '0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 25%, transparent)' : 'none',
          },
        },
          h('img', {
            src: entry.url, alt: entry.alt || entry.label, loading: 'lazy', decoding: 'async',
            title: '左键看大图　右键出菜单',
            style: { ...GALLERY_THUMB, cursor: 'zoom-in' },
            onClick: () => {
              if (select) { setPicked(current => Object.assign({}, current, { [entry.key]: !current[entry.key] })); return }
              preview(entry)
            },
            onContextMenu: event => { event.preventDefault(); openMenu(event, entry) },
          }),
          select ? h('div', {
            style: { position: 'absolute', top: '6px', left: '6px', width: '24px', height: '24px', borderRadius: '6px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 50%, transparent)', background: on ? 'var(--dsw-alias-brand-primary)' : 'rgba(0,0,0,.5)', color: 'var(--dsw-alias-label-primary)', fontSize: '15px', lineHeight: '22px', textAlign: 'center' },
          }, on ? '✓' : '') : null,
          !select ? h('button', {
            type: 'button',
            title: mode === 'trash' ? '恢复到画廊' : '移到回收站',
            disabled: deleting,
            'aria-label': (mode === 'trash' ? '恢复 ' : '回收 ') + entry.label,
            onClick: event => { event.stopPropagation(); updateEntry(entry, mode === 'trash' ? 'restore' : 'trash') },
            style: {
              position: 'absolute', top: '6px', right: '6px', width: '26px', height: '26px',
              borderRadius: '7px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 25%, transparent)',
              background: 'rgba(0,0,0,.55)', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer',
              fontSize: '14px', lineHeight: 1, padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            },
          }, mode === 'trash' ? '↩' : GALLERY_TRASH_ICON) : null,
          h('div', { style: { ...GALLERY_CAPTION, display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { title: entry.captionTitle || entry.caption, style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.caption),
            !select && mode !== 'trash' ? h('button', {
              type: 'button',
              'aria-label': (entry.favorite ? '取消收藏 ' : '收藏 ') + entry.label,
              style: { ...S.tab(entry.favorite), padding: '2px 5px', fontSize: 11, flex: '0 0 auto' },
              onClick: () => updateEntry(entry, entry.favorite ? 'unfavorite' : 'favorite'),
            }, entry.favorite ? '已收藏' : '收藏') : null),
          !select ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 6px 6px' } },
            h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px', flex: '1 0 auto' }, 'aria-label': '查看提示词 ' + entry.label, onClick: () => showPrompt(entry, 'positive') }, '提示词'),
            h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px', flex: '1 0 auto' }, 'aria-label': '查看负面词 ' + entry.label, onClick: () => showPrompt(entry, 'negative') }, '负面'),
            mode === 'trash'
              ? h('button', { type: 'button', disabled: deleting, style: { ...buttonStyle, padding: '3px 5px', color: 'var(--dsw-alias-state-error-primary)' }, 'aria-label': '彻底删除 ' + entry.label, onClick: () => requestDeletion([entry.key]) }, '彻底删除')
              : h('button', { type: 'button', style: { ...buttonStyle, padding: '3px 5px' }, 'aria-label': '图生图 ' + entry.label, onClick: () => openInEditor(entry) }, '图生图')) : null,
          !select && prompt?.key === entry.key ? h('section', { 'aria-label': '图片提示词详情', style: { padding: 6, minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('strong', { style: { fontSize: 12 } }, prompt.field === 'negative' ? '完整负面提示词' : '完整正面提示词'),
              h('button', { type: 'button', style: { ...buttonStyle, padding: '2px 5px' }, onClick: () => setPrompt(null) }, '收起提示词')),
            prompt.loading ? h('p', { role: 'status', style: STRUCTURE_MUTED }, '正在读取提示词…')
              : prompt.text ? h(React.Fragment, null,
                h('textarea', { 'aria-label': prompt.field === 'negative' ? '完整负面提示词' : '完整正面提示词', readOnly: true, value: prompt.text, style: promptArea(100) }),
                h('button', { type: 'button', style: { ...buttonStyle, marginTop: 4 }, onClick: copyPrompt }, '复制完整内容'))
                : !prompt.note ? h('p', { role: 'status', style: STRUCTURE_MUTED }, prompt.field === 'negative' ? '这张图没有记录负面提示词' : '这张图没有记录正面提示词') : null,
            prompt.note ? h('p', { role: 'status', style: STRUCTURE_MUTED }, prompt.note) : null) : null,
        )
      }

      const title = view === 'play'
        ? '画廊（插件 ' + playEntries.length + ' 张' + (legacyEntries.length ? ' · 早期 ' + legacyEntries.length + ' 张' : '') + '）'
        : (view === 'card' ? '卡片画廊（' : view === 'favorite' ? '收藏（' : '回收站（') + flat.length + ' 张）'
      const pickedCount = pickedEntries().length
      // 只有当前视图真正用到的来源才算「还没拉到」，否则另一个来源的 null 会让按钮一直卡在读取中。
      const loading = view === 'card' ? cards === null : view === 'play' ? jobs === null : jobs === null || cards === null

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 } },
        // 一级切换：两个来源 + 收藏 + 回收站，四条平级。
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          GALLERY_VIEWS.map(([key, label]) =>
            h('button', { key, type: 'button', style: S.tab(view === key), 'aria-pressed': view === key, disabled: deleting, onClick: () => switchView(key) }, label)),
        ),
        // 标题 + 刷新 / 浏览全部 / 批量选择：尺寸和排布沿用卡片工作台原来的「刷新 / 清空全部」那一排。
        h('div', { style: GALLERY_ROW },
          h('span', { 'data-gallery-title': '', style: { fontSize: 13, fontWeight: 600, marginRight: 6 } }, title),
          h('button', { type: 'button', 'data-gallery-action': 'refresh', style: GALLERY_BUTTON, disabled: loading && !flat.length, onClick: () => { setNote('读取中…'); setTick(n => n + 1) } }, loading && !flat.length ? '读取中…' : '刷新'),
          h('button', { type: 'button', 'data-gallery-action': 'preview-all', style: GALLERY_BUTTON, onClick: () => preview(), disabled: !flat.length }, '浏览全部'),
          h('button', { type: 'button', 'data-gallery-action': 'select', style: GALLERY_BUTTON, disabled: deleting, onClick: () => { setSelect(value => !value); setPicked({}); setDeletion(null) } }, select ? '退出批量' : '批量选择'),
          mode === 'trash' ? h('button', { type: 'button', style: { ...GALLERY_BUTTON, color: 'var(--dsw-alias-state-error-primary)' }, disabled: deleting || !flat.length, onClick: () => requestDeletion([], true) }, '清空回收站') : null,
          select ? h('button', { type: 'button', style: GALLERY_BUTTON, onClick: () => setPicked(Object.fromEntries(flat.filter(entry => !entry.readOnly).map(entry => [entry.key, true]))) }, '全选') : null,
          select ? h('button', { type: 'button', style: GALLERY_BUTTON, onClick: () => setPicked({}) }, '取消全选') : null,
          select ? h('button', { type: 'button', style: GALLERY_BUTTON, disabled: deleting || Boolean(exporting?.busy) || !pickedCount, onClick: () => void exportEntries(pickedEntries()) }, '导出选中图片（' + pickedCount + '）') : null,
          select ? h('button', {
            type: 'button',
            style: { ...GALLERY_BUTTON, borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 70%, transparent)', color: 'var(--dsw-alias-state-error-primary)' },
            disabled: deleting || !pickedCount,
            onClick: () => { const keys = pickedEntries().map(entry => entry.key); if (mode === 'trash') requestDeletion(keys); else void trashPicked() },
          }, (mode === 'trash' ? '彻底删除（' : '移到回收站（') + pickedCount + '）') : null,
          note ? h('span', { role: 'status', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, note) : null,
        ),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, GALLERY_HINT),
        exporting ? h('div', { style: { fontSize: 12 } },
          h('p', { role: 'status', style: { margin: 0 } }, exporting.note),
          exporting.failed?.length ? h(React.Fragment, null,
            h('ul', { style: { margin: '4px 0 0 18px', padding: 0 } }, exporting.failed.map(item => h('li', { key: item.entry.key }, (item.entry.label || item.entry.id) + '：' + item.reason))),
            h('button', { type: 'button', style: { ...buttonStyle, marginTop: 4 }, disabled: Boolean(exporting.busy) || deleting, onClick: () => void exportEntries(exporting.failed.map(item => item.entry)) }, '重试失败项')) : null) : null,
        mode === 'trash' && deletion ? h('div', { role: 'group', 'aria-label': '确认彻底删除图片', style: S.card },
          h('p', { style: { margin: '0 0 8px', fontSize: 13 } }, deletion.all ? '清空回收站中的全部图片？删除后无法恢复。' : '彻底删除这 ' + deletion.keys.length + ' 张图片？删除后无法恢复。'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { type: 'button', style: buttonStyle, disabled: deleting, onClick: () => setDeletion(null) }, '取消'),
            h('button', { type: 'button', style: { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary)' }, disabled: deleting, onClick: confirmDeletion }, deleting ? '正在删除…' : '确认彻底删除'))) : null,
        deleteNote ? h('p', { role: 'status', style: { fontSize: 12, margin: 0 } }, deleteNote) : null,
        flat.length
          ? ordered.map(group => {
            const open = !closedGroups[group.key]
            return h('div', { key: group.key, style: { minWidth: 0 } },
              h('button', {
                type: 'button',
                onClick: () => toggleGroup(group.key),
                'aria-expanded': open,
                title: open ? '收起这一组' : '展开这一组',
                style: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', cursor: 'pointer', background: 'transparent', border: 'none', padding: '2px 0', color: 'inherit', textAlign: 'left' },
              },
                h('span', { style: { fontSize: 11, opacity: 0.6, width: 12 } }, open ? '▾' : '▸'),
                h('span', { 'data-gallery-group': '', style: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, groupLabel(group)),
                h('span', { style: { fontSize: 11, opacity: 0.55, flex: '0 0 auto' } }, group.items.length + ' 张'),
              ),
              open ? h('div', { style: GALLERY_GRID }, group.items.map(tile)) : null,
            )
          })
          : note ? null : h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '14px 0 0' } },
            mode === 'trash' ? '回收站是空的' : mode === 'favorite' ? '还没有收藏的图片' : '还没有图片。让 Agent 出一张就会出现在这里。'),
      )
    }
