    // ── 卡片画廊（原 dsh-tavern-gen 的出图记录）────────────────────────
    // 卡片工作台的设置页已经并进「配图」，这里只保留还在用的两样东西：
    // 画廊页本身；会话画廊由宿主的公开接口展示。
    const CARD_GALLERY_API = '/dsh-tavern-gen/api'
    let cardGalleryCtx = null
    const CARD_GALLERY_S = {
      hint: { fontSize: 12, lineHeight: 1.6, opacity: 0.72 },
      group: { display: 'flex', flexDirection: 'column', gap: 10 },
      card: {
        border: '1px solid rgba(128,128,128,.28)', borderRadius: 10,
        background: 'rgba(128,128,128,.05)', padding: 10,
        display: 'flex', flexDirection: 'column', gap: 8,
      },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      status: { fontSize: 12, opacity: 0.78 },
      ghost: {
        padding: '5px 12px', fontSize: 12, cursor: 'pointer', borderRadius: 7, flexShrink: 0,
        border: '1px solid rgba(128,128,128,.4)', background: 'transparent',
        color: 'inherit', fontFamily: 'inherit', whiteSpace: 'nowrap',
      },
      danger: {
        padding: '5px 11px', fontSize: 12, cursor: 'pointer', borderRadius: 7, flexShrink: 0,
        border: '1px solid rgba(217,83,79,.55)', background: 'transparent',
        color: '#d9534f', fontFamily: 'inherit', whiteSpace: 'nowrap',
      },
      off: { opacity: 0.5, cursor: 'default' },
    }
    const CardGhost = props => h('button', {
      type: 'button', onClick: props.onClick, disabled: props.disabled,
      style: { ...CARD_GALLERY_S.ghost, ...(props.disabled ? CARD_GALLERY_S.off : {}), ...(props.style || {}) },
    }, props.children)
    const CardDanger = props => h('button', {
      type: 'button', onClick: props.onClick, disabled: props.disabled,
      style: { ...CARD_GALLERY_S.danger, ...(props.disabled ? CARD_GALLERY_S.off : {}), ...(props.style || {}) },
    }, props.children)

    function CardGalleryPage() {
      const S = CARD_GALLERY_S
      const API = CARD_GALLERY_API
      const [items, setItems] = useState(null)
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState(false)
      const [titles, setTitles] = useState({})
      const [closed, setClosed] = useState({})

      async function pull() {
        setBusy(true)
        try {
          const response = await fetch(API + '/gallery', { headers: { accept: 'application/json' } })
          const value = await response.json()
          if (!response.ok) throw new Error(value?.error || 'HTTP ' + response.status)
          setItems(value.items ?? [])
          setStatus('')
        } catch (error) {
          setStatus('读取失败：' + (error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      useEffect(() => { pull() }, [])

      // 会话标题：tavernUi.getGames 返回「会话 id → 标题」，和 Tavern 会话列表上显示的一致。
      // 拿不到就退回会话 id 前 8 位，不影响分组和展开。
      // ctx.get 取没声明依赖的服务会当场抛，必须自己接住：effect 里抛出去会把整个设置面板卸成白屏。
      useEffect(() => {
        let ui = null
        try { ui = cardGalleryCtx?.get?.('tavernUi') ?? null } catch { ui = null }
        if (!items || !ui || typeof ui.getGames !== 'function') return undefined
        const ids = [...new Set(items.map(item => String(item.session || '')).filter(Boolean))]
        if (!ids.length) return undefined
        let alive = true
        Promise.resolve(ui.getGames(ids)).then(map => { if (alive) setTitles(map || {}) }, () => {})
        return () => { alive = false }
      }, [items])

      async function remove(id) {
        try {
          const response = await fetch(API + '/gallery-delete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
          const value = await response.json()
          if (!response.ok || !value.ok) throw new Error(value?.error || 'HTTP ' + response.status)
          setStatus('已删除（记录和图片文件一起删了）')
          await pull()
        } catch (error) {
          setStatus('删除失败：' + (error?.message ?? error))
        }
      }

      async function clearAll() {
        const ask = typeof window !== 'undefined' && typeof window.confirm === 'function'
        if (ask && !window.confirm('会删掉全部图片文件和记录，删了找不回来。确定？')) return
        setBusy(true)
        try {
          const response = await fetch(API + '/gallery-clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          const value = await response.json()
          if (!response.ok || !value.ok) throw new Error(value?.error || 'HTTP ' + response.status)
          setStatus(`已清空 ${value.removed ?? 0} 张`)
          await pull()
        } catch (error) {
          await pull()
          setStatus('清空失败：' + (error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }

      // 复制到剪贴板。navigator.clipboard 在非安全上下文或权限被拒时会抛，
      // 这时退回 textarea + execCommand，老办法但到处都能用。
      async function copyText(text, label) {
        const value = String(text || '')
        if (!value) { setStatus(`这张图没有存 ${label}`); return }
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value)
          } else throw new Error('no clipboard api')
          setStatus(`已复制 ${label}（${value.length} 字）`)
        } catch {
          try {
            const ta = document.createElement('textarea')
            ta.value = value
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            const ok = document.execCommand('copy')
            document.body.removeChild(ta)
            setStatus(ok ? `已复制 ${label}（${value.length} 字）` : `复制失败，${label} 需要手动选中`)
          } catch {
            setStatus(`复制失败，${label} 需要手动选中`)
          }
        }
      }

      const list = items ?? []
      // 按出图会话分组：组名用会话标题，没有就退回会话 id 前 8 位。
      const groupKeys = []
      const bySession = new Map()
      for (const item of list) {
        const key = String(item.session || '')
        if (!bySession.has(key)) { bySession.set(key, []); groupKeys.push(key) }
        bySession.get(key).push(item)
      }
      // getGames 给的不是裸字符串：每条是会话对象，标题在 .title 里（还带 cardName 之类）。
      // 原样塞进 children 就是 React #31，所以这里一律取成字符串再显示。
      // 卡片工作台的会话没有自己的标题，宿主会回落到卡片名，几个会话就都叫同一个名字；
      // 后面补上这一组最新一张图的时间，至少能分清是哪一次。
      const pad = value => String(value).padStart(2, '0')
      const groupTitle = (key, group) => {
        let head = '未分类'
        if (key) {
          const raw = titles[key]
          const text = typeof raw === 'string' ? raw : String(raw?.title || raw?.cardName || raw?.name || '')
          head = text || '会话 ' + key.replace(/^session-/, '').slice(0, 8)
        }
        const stamps = group.map(item => Number(item.at) || 0).filter(Boolean)
        if (!stamps.length) return head
        const latest = new Date(Math.max(...stamps))
        return head + ' · ' + pad(latest.getMonth() + 1) + '-' + pad(latest.getDate()) + ' ' + pad(latest.getHours()) + ':' + pad(latest.getMinutes())
      }
      const toggle = key => setClosed(current => ({ ...current, [key]: !current[key] }))

      const tile = item => h('div', { key: item.id, style: { ...S.card, padding: 6, gap: 5 } },
        h('img', {
          src: item.url, alt: item.prompt || item.file, loading: 'lazy', decoding: 'async',
          onClick: () => openImageOverlay?.({ open: true, note: '卡片画廊',
            images: list.map(entry => ({ url: entry.url, alt: entry.prompt || entry.file })), index: list.indexOf(item) }),
          style: { width: '100%', borderRadius: 6, cursor: 'zoom-in', display: 'block', background: 'rgba(0,0,0,.15)' },
        }),
        h('div', { style: { fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          item.preset || '默认画风'),
        h('div', { style: { fontSize: 10, opacity: 0.55 } },
          new Date(item.at || Date.now()).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
        // 三个按钮一行：两个复制平分宽度，删除窄且红，避免误点。
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'stretch' } },
          h(CardGhost, {
            onClick: () => copyText(item.prompt, 'prompt'), title: '复制这一张的完整 prompt',
            style: { flex: '1 1 0', minWidth: 0, padding: '3px 3px', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' },
          }, '提示词'),
          h(CardGhost, {
            onClick: () => copyText(item.negative, 'negative'), title: '复制这一张的 negative',
            style: { flex: '1 1 0', minWidth: 0, padding: '3px 3px', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' },
          }, '负面'),
          h(CardDanger, {
            onClick: () => remove(item.id), title: '删除记录和图片文件',
            style: { flex: '0 0 auto', padding: '3px 7px', fontSize: 10 },
          }, '×'),
        ),
      )

      return h('div', { style: S.group },
        h('div', { style: S.row },
          h('span', { style: { fontSize: 13, fontWeight: 600, marginRight: 6 } }, `卡片画廊（${list.length} 张）`),
          h(CardGhost, { onClick: pull, disabled: busy }, busy ? '读取中…' : '重新读取'),
          list.length ? h(CardDanger, { onClick: clearAll, disabled: busy }, '清空全部') : null,
          status ? h('span', { style: S.status }, status) : null,
        ),
        h('div', { style: S.hint }, '按出图会话分组，点组标题收起或展开。删除会同时删掉记录和图片文件，删了找不回来。'),
        items === null
          ? h('div', { style: S.hint }, '正在读取…')
          : list.length === 0
            ? h('div', { style: S.hint }, '还没有图。让 Agent 出一张就会出现在这里。')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
              groupKeys.map(key => {
                const group = bySession.get(key) || []
                const open = !closed[key]
                return h('div', { key: key || 'none', style: { ...S.card, padding: 8, gap: 8 } },
                  h('button', {
                    type: 'button',
                    onClick: () => toggle(key),
                    title: open ? '收起这一组' : '展开这一组',
                    style: {
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', cursor: 'pointer',
                      background: 'transparent', border: 'none', padding: '2px 0', color: 'inherit', textAlign: 'left',
                    },
                  },
                    h('span', { style: { fontSize: 11, opacity: 0.6, width: 12 } }, open ? '▾' : '▸'),
                    h('span', { style: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, groupTitle(key, group)),
                    h('span', { style: { fontSize: 11, opacity: 0.55, flex: '0 0 auto' } }, `${group.length} 张`),
                  ),
                  // 展开后自动铺列：宽屏 5 列，窄了自己降。
                  open ? h('div', {
                    style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 110px), 1fr))', gap: 8 },
                  }, group.map(tile)) : null,
                )
              }),
            ),

      )
    }
