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

    const PRESET_SAMPLE_LIMIT = 8
    const PRESET_SAMPLE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

    /** 画风示例图：字节存在本机 reference-images/，画风预设里只记 descriptor（id / mediaType / name / byteLength）。 */
    function PresetSampleEditor({ samples, label, onChange }) {
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const epoch = React.useRef(0)
      React.useEffect(() => () => { epoch.current += 1 }, [])
      const list = (Array.isArray(samples) ? samples : [])
        .filter(item => item && /^[a-f0-9]{64}$/i.test(String(item.id || '')))
        .slice(0, PRESET_SAMPLE_LIMIT)
      const imageUrl = id => BASE + '/reference-image?id=' + encodeURIComponent(id)
      const readAsDataUrl = file => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('无法读取 ' + file.name))
        reader.readAsDataURL(file)
      })
      async function upload(event) {
        const files = Array.from(event.target.files || [])
        event.target.value = ''
        if (!files.length) return
        const request = ++epoch.current
        const added = []
        let skipped = 0
        setBusy(true)
        setNote('')
        try {
          for (const file of files) {
            const mediaType = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[String(file.name).split('.').pop().toLowerCase()]
            if (list.length + added.length >= PRESET_SAMPLE_LIMIT || !PRESET_SAMPLE_TYPES.includes(mediaType) || !file.size || file.size > 32 * 1024 * 1024) { skipped += 1; continue }
            const data = await readAsDataUrl(file)
            if (request !== epoch.current) return
            const result = await jsonFetch(BASE + '/reference-image', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ data, mediaType, name: file.name }),
            })
            if (request !== epoch.current) return
            const image = result?.referenceImage
            if (!result?.ok || !/^[a-f0-9]{64}$/i.test(String(image?.id || ''))) throw new Error(result?.error || ('服务器没有返回有效的图片：' + file.name))
            if (!added.some(item => item.id === image.id)) added.push({ id: image.id, mediaType: image.mediaType, name: image.name, byteLength: image.byteLength })
          }
          if (added.length) onChange([...list, ...added])
          setNote([
            added.length ? '已加入 ' + added.length + ' 张示例图' : '',
            skipped ? '跳过 ' + skipped + ' 张（只收 PNG / JPEG / WebP，单张 32 MiB 以内，每套最多 ' + PRESET_SAMPLE_LIMIT + ' 张）' : '',
          ].filter(Boolean).join('；') || '没有可用的图片')
        } catch (error) {
          if (request === epoch.current) setNote('上传失败：' + (error?.message || error))
        } finally { if (request === epoch.current) setBusy(false) }
      }
      const remove = id => {
        epoch.current += 1
        setBusy(false)
        onChange(list.filter(item => item.id !== id))
        setNote('已移除这张示例图；图片文件仍留在本机')
      }
      // 复用插件自带的全屏看图浮层（游玩画廊点开大图用的同一个）：自带 ←→ 翻页、滚轮缩放、Esc 关闭。
      const previewAt = at => {
        const open = typeof openImageOverlay === 'function' ? openImageOverlay : null
        if (!open) { window.open(imageUrl(list[at].id), '_blank', 'noopener'); return }
        open({
          open: true,
          images: list.map(item => ({ url: imageUrl(item.id), alt: item.name || '画风示例图' })),
          index: at,
          note: (label || '画风') + ' · 画风示例图',
          working: false,
        })
      }
      return h('div', { 'aria-label': (label || '画风') + '示例图' },
        list.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' } },
          list.map((item, at) => h('div', { key: item.id, style: { position: 'relative', width: '104px' } },
            h('button', {
              type: 'button', onClick: () => previewAt(at),
              title: '点开看大图（← → 翻页，滚轮缩放）', 'aria-label': '查看示例图 ' + (item.name || (at + 1)),
              style: { display: 'block', width: '104px', height: '104px', padding: 0, border: 0, borderRadius: '7px', background: 'transparent', cursor: 'zoom-in' },
            },
              h('img', {
                src: imageUrl(item.id), alt: item.name || '画风示例图', loading: 'lazy',
                style: { display: 'block', width: '100%', height: '100%', objectFit: 'cover', borderRadius: '7px', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)' },
              })),
            h('button', {
              type: 'button', 'aria-label': '移除示例图 ' + (item.name || ''), title: '移除这张',
              style: Object.assign({}, buttonStyle, { position: 'absolute', top: '3px', right: '3px', padding: '0 5px', fontSize: '11px', lineHeight: '18px' }),
              onClick: () => remove(item.id),
            }, '×'))))
          : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '还没有示例图。'),
        h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px', cursor: busy ? 'default' : 'pointer' } },
          busy ? '上传中…' : '上传示例图（可多选）',
          h('input', {
            type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, disabled: busy,
            'aria-label': (label || '画风') + '上传示例图', onChange: upload, style: { maxWidth: '100%', fontSize: 12 },
          })),
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '5px' } },
          '示例图只在本机保存，用来辨认这套画风；图片文件不随配置导出或迁移，每套最多 ' + PRESET_SAMPLE_LIMIT + ' 张。'),
        note ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '4px', overflowWrap: 'anywhere' } }, note) : null,
      )
    }

    /** 折叠时完全不挂载缩略图：img 一进 DOM 就会发请求，折叠只是视觉隐藏，指望浏览器懒加载兜不住。 */
    function PresetSampleDetails({ samples, label, onChange }) {
      const [open, setOpen] = React.useState(false)
      const count = (Array.isArray(samples) ? samples : []).length
      return h('details', {
        style: { marginTop: '8px' },
        // 不用受控 open，只跟随原生开合；state 只决定要不要渲染内容。
        onToggle: event => setOpen(event.currentTarget.open === true),
      },
        h('summary', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', padding: '2px 0' } },
          '这套的画风示例图' + (count ? '（' + count + ' 张）' : '（未上传）')),
        open ? h('div', { style: { marginTop: '8px', padding: '12px 14px', borderRadius: '8px', background: 'var(--dsw-specific-input-major)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent)' } },
          h(PresetSampleEditor, { samples, label, onChange })) : null,
      )
    }

    function ImageStylePanel({ config, save }) {
        const [editing, setEditing] = React.useState(null)
        const [importNote, setImportNote] = React.useState('')
        const [importing, setImporting] = React.useState(false)
        const latest = React.useRef(config)
        latest.current = config
        const [dragState, setDragState] = React.useState(null)
        const presets = Array.isArray(config.stylePresets) ? config.stylePresets : []
        const active = String(config.activePreset ?? '')
        const activeName = (presets.find(p => String(p.id) === active) || {}).name
        const presetKey = (item, index) => String(item.id || index)
        const expandPreset = id => setEditing(current => current === id ? null : id)

        const savePresets = (next) => save({ stylePresets: next })
        const patch = (i, patchObj) => {
          const next = presets.slice()
          next[i] = Object.assign({}, next[i], patchObj)
          savePresets(next)
        }
        const add = async () => {
          const created = {
            id: 'p' + Date.now(), name: '画风 ' + (presets.length + 1),
            artist: '', negative: '', position: 'prefix', enabled: true,
          }
          if (await save({ stylePresets: [...presets, created] })) setEditing(created.id)
        }
        async function importStyles(event) {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || importing) return
          setImporting(true)
          setImportNote('')
          try {
            const payload = JSON.parse((await file.text()).replace(/^\uFEFF/, ''))
            const data = payload?.data?.config ?? payload
            const incoming = Array.isArray(data) ? data : [
              ...(Array.isArray(data?.stylePresets) ? data.stylePresets : []),
              ...(Array.isArray(data?.artistSets) ? data.artistSets : []),
              ...(data?.styleArtists || data?.styleNegative ? [{ id: 'imported-default-style', name: '备份中的默认画风',
                artist: data.styleArtists, negative: data.styleNegative }] : []),
            ]
            const current = latest.current.stylePresets || []
            const ids = new Set(current.map(style => String(style.id)))
            const added = []
            for (const [index, style] of incoming.entries()) {
              if (current.length + added.length >= 60) break
              if (!style || typeof style !== 'object' || !['artist', 'text', 'negative', 'params'].some(key => Object.hasOwn(style, key))) continue
              const id = String(style.id ?? 'imported-style-' + (index + 1)).trim().slice(0, 60) || 'imported-style-' + (index + 1)
              if (ids.has(id)) continue
              ids.add(id)
              added.push({ id, name: String(style.name || '画风 ' + (index + 1)), artist: String(style.artist ?? style.text ?? ''),
                negative: String(style.negative ?? ''), position: style.position, enabled: style.enabled !== false, params: style.params })
            }
            if (!added.length) { setImportNote('没有可新增的画风。相同 ID 会保留库里的版本，画风库最多 60 套。'); return }
            const saved = await save({ stylePresets: [...current, ...added] })
            setImportNote(saved ? '已导入 ' + added.length + ' 套画风' : '画风保存失败')
          } catch {
            setImportNote('无法读取画风。请选择旧配置或生图备份 JSON。')
          } finally {
            setImporting(false)
          }
        }
        const remove = (i) => {
          if (!confirm('删除这套画风？')) return
          const next = presets.slice()
          const gone = next.splice(i, 1)[0]
          save({ stylePresets: next, ...(gone && String(gone.id) === active ? { activePreset: '' } : {}) })
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
        // ——— 拖拽排序：拖到某条的上半 / 下半，松手就插到那一格，其余条目相对顺序不动 ———
        const listRef = React.useRef(null)
        const pointerRef = React.useRef(null)
        const scrollRef = React.useRef({ raf: 0, speed: 0 })
        const movePresetTo = (fromKey, toKey, edge) => {
          const from = presets.findIndex((item, index) => presetKey(item, index) === fromKey)
          const to = presets.findIndex((item, index) => presetKey(item, index) === toKey)
          if (from < 0 || to < 0 || from === to) return
          const next = presets.slice()
          const [moved] = next.splice(from, 1)
          const at = to - (from < to ? 1 : 0) + (edge === 'after' ? 1 : 0)
          if (at === from) return
          next.splice(Math.max(0, Math.min(next.length, at)), 0, moved)
          savePresets(next)
        }
        // 指针落在哪张卡片、落在它的上半还是下半；离开列表本体就算没有落点。
        const resolveDrop = clientY => {
          const list = listRef.current
          if (!list) return null
          const rect = list.getBoundingClientRect()
          if (clientY < rect.top - 12 || clientY > rect.bottom + 12) return null
          const cards = Array.from(list.querySelectorAll('[data-preset-card]')).filter(card => {
            const box = card.getBoundingClientRect()
            return box.bottom > rect.top - 12 && box.top < rect.bottom + 12
          })
          if (!cards.length) return null
          for (const card of cards) {
            const box = card.getBoundingClientRect()
            const key = card.getAttribute('data-preset-card')
            if (clientY < box.top) return { over: key, edge: 'before' }
            if (clientY <= box.bottom) return { over: key, edge: clientY < box.top + box.height / 2 ? 'before' : 'after' }
          }
          return { over: cards[cards.length - 1].getAttribute('data-preset-card'), edge: 'after' }
        }
        const updateDrop = clientY => {
          const found = resolveDrop(clientY)
          // 只有落点真的换了才改 state，否则每个 pointermove 都要重渲染整份列表。
          setDragState(state => {
            if (!state) return state
            const over = found ? found.over : null
            const edge = found ? found.edge : 'after'
            return state.over === over && state.edge === edge ? state : Object.assign({}, state, { over, edge })
          })
        }
        const stopAutoScroll = () => {
          const scroll = scrollRef.current
          if (scroll.raf) { cancelAnimationFrame(scroll.raf); scroll.raf = 0 }
          scroll.speed = 0
        }
        const tickAutoScroll = () => {
          const scroll = scrollRef.current
          const list = listRef.current
          const pointer = pointerRef.current
          scroll.raf = 0
          if (!list || !pointer || !scroll.speed) return
          const before = list.scrollTop
          list.scrollTop = before + scroll.speed
          // 滚到头就停，指针回到中间区域再重新起转。
          if (list.scrollTop === before) { scroll.speed = 0; return }
          updateDrop(pointer.lastY)
          scroll.raf = requestAnimationFrame(tickAutoScroll)
        }
        const setAutoScroll = speed => {
          const scroll = scrollRef.current
          scroll.speed = speed
          if (!speed) { stopAutoScroll(); return }
          if (!scroll.raf) scroll.raf = requestAnimationFrame(tickAutoScroll)
        }
        const DROP_EDGE_ZONE = 46
        const edgeSpeed = distance => Math.min(10, Math.max(2, Math.round(distance / 6)))
        const updateAutoScroll = clientY => {
          const list = listRef.current
          if (!list) return
          const rect = list.getBoundingClientRect()
          const fromTop = clientY - rect.top
          const fromBottom = rect.bottom - clientY
          if (fromTop < DROP_EDGE_ZONE) setAutoScroll(-edgeSpeed(DROP_EDGE_ZONE - fromTop))
          else if (fromBottom < DROP_EDGE_ZONE) setAutoScroll(edgeSpeed(DROP_EDGE_ZONE - fromBottom))
          else setAutoScroll(0)
        }
        const finishDrag = (commit, clientY) => {
          const pointer = pointerRef.current
          pointerRef.current = null
          stopAutoScroll()
          setDragState(null)
          if (!commit || !pointer || !pointer.started) return
          const list = listRef.current
          if (list) {
            const rect = list.getBoundingClientRect()
            if (clientY < rect.top - 12 || clientY > rect.bottom + 12) return
          }
          // 松手位置现算一次，不沿用上一帧的 state，免得拖太快落在旧目标上。
          const found = resolveDrop(clientY)
          if (!found || !found.over || found.over === pointer.from) return
          movePresetTo(pointer.from, found.over, found.edge)
        }
        React.useEffect(() => () => stopAutoScroll(), [])
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
          h('div', { style: S.row },
            h('button', { type: 'button', style: buttonStyle, onClick: add, disabled: presets.length >= 60 }, '新增一套'),
            h('button', { type: 'button', style: buttonStyle, onClick: () => save({ activePreset: '' }), disabled: !active }, '使用默认画风'),
            h('label', { style: { ...buttonStyle, cursor: 'pointer' } }, '导入旧画风',
              h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '导入旧画风', disabled: importing,
                style: { position: 'absolute', width: 1, height: 1, opacity: 0 }, onChange: importStyles })),
          ),
          importNote ? h('div', { role: 'status', style: STRUCTURE_MUTED }, importNote) : null,
          h('p', { style: STRUCTURE_MUTED }, '在画风模块的「画风来源」选用库里的预设。'),
          presets.length ? h('div', {
            ref: listRef,
            'data-preset-list': '',
            // 拖拽中滚轮照常滚；滚动会改变卡片位置，落点跟着重算（平滑滚动要多等一拍）。
            onWheel: () => {
              const pointer = pointerRef.current
              if (!pointer || !pointer.started) return
              const refresh = () => { if (pointerRef.current) updateDrop(pointer.lastY) }
              requestAnimationFrame(refresh)
              setTimeout(refresh, 90)
            },
            style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: 'min(56vh, 520px)', overflowY: 'auto', padding: '2px 4px 2px 2px' },
          },
            presets.map((p, i) => {
              const presetId = presetKey(p, i)
              const expanded = editing === presetId
              const isDragging = Boolean(dragState && dragState.from === presetId)
              const isDropTarget = Boolean(dragState && dragState.over === presetId && dragState.from !== presetId)
              const dropEdge = isDropTarget ? (dragState.edge === 'before' ? 'before' : 'after') : null
              return h('div', {
                key: p.id || i,
                'data-preset-card': presetId,
                style: {
                  position: 'relative', borderRadius: '10px', padding: '10px 12px',
                  border: String(p.id) === active ? '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 75%, transparent)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)',
                  background: String(p.id) === active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)',
                  // 拖起来的那张淡掉；落点只用一条插入位置横线提示，边框保持原样免得晃眼。
                  opacity: isDragging ? 0.45 : 1,
                  boxShadow: 'none',
                  transition: 'opacity .12s',
                },
              },
                // 插入位置提示：目标上半 = 插到它前面，下半 = 插到它后面。
                dropEdge ? h('div', {
                  key: 'drop-edge', 'data-drop-edge': dropEdge, 'aria-hidden': 'true',
                  style: {
                    position: 'absolute', left: '6px', right: '6px', height: '3px', borderRadius: '2px',
                    background: 'var(--dsw-alias-brand-primary)', opacity: 0.9, pointerEvents: 'none', zIndex: 2,
                    ...(dropEdge === 'before' ? { top: '-2px' } : { bottom: '-2px' }),
                  },
                }) : null,

                h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: expanded ? '8px' : '0' } },
                  h('input', { type: 'radio', name: 'rphub-preset', checked: String(p.id) === active, title: '用这一套', onChange: () => save({ activePreset: String(p.id) }) }),
                  h(PresetTextField, {
                    value: p.name || '', placeholder: '这套叫什么（古风写实 / 二次元厚涂…）',
                    style: Object.assign({}, S.input, { flex: 1, minWidth: '100px' }),
                    ariaLabel: '这套画风的名字',
                    onCommit: value => patch(i, { name: value }),
                  }),
                  h('select', {
                    value: p.position === 'suffix' ? 'suffix' : 'prefix',
                    style: Object.assign({}, S.input, { width: '78px', padding: '3px 4px' }),
                    onChange: e => patch(i, { position: e.target.value }),
                    title: '这套词放在提示词的最前还是最后',
                  },
                    h('option', { value: 'prefix', style: optStyle }, '最前'),
                    h('option', { value: 'suffix', style: optStyle }, '最后'),
                  ),
                  h('button', {
                    style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 6px' }),
                    title: expanded ? '收起这套的详细内容' : '展开这套的详细内容',
                    'aria-expanded': expanded, 'aria-label': (expanded ? '收起 ' : '编辑 ') + (p.name || (i + 1)),
                    onClick: () => expandPreset(presetId),
                  }, expanded ? '▾' : '▸'),
                  h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 8px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => remove(i) }, '删'),
                  h('button', {
                    type: 'button', title: '上移预设', 'aria-label': '上移 ' + (p.name || (i + 1)),
                    disabled: i === 0, style: Object.assign({}, buttonStyle, { padding: '3px 6px' }),
                    onClick: () => movePreset(presetId, presetKey(presets[i - 1], i - 1)),
                  }, '上移'),
                  h('button', {
                    type: 'button', title: '下移预设', 'aria-label': '下移 ' + (p.name || (i + 1)),
                    disabled: i === presets.length - 1, style: Object.assign({}, buttonStyle, { padding: '3px 6px' }),
                    onClick: () => movePreset(presetId, presetKey(presets[i + 1], i + 1)),
                  }, '下移'),
                  h('div', {
                    title: '按住拖动，放到目标条目的上方或下方',
                    'aria-label': '拖动排序 ' + (p.name || (i + 1)),
                    // 用指针事件而非 HTML5 拖拽：原生拖拽会把滚轮吞掉，也画不出插入位置。
                    style: { cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none', padding: '2px 6px', fontSize: '15px', lineHeight: '1', letterSpacing: '-1px', color: isDragging ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)', borderRadius: '6px' },
                    onPointerDown: event => {
                      if (event.button > 0) return
                      event.preventDefault()
                      try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
                      pointerRef.current = { pointerId: event.pointerId, from: presetId, startY: event.clientY, lastY: event.clientY, started: false }
                    },
                    onPointerMove: event => {
                      const pointer = pointerRef.current
                      if (!pointer || pointer.pointerId !== event.pointerId) return
                      pointer.lastY = event.clientY
                      if (!pointer.started) {
                        // 先动够 4px 才算拖拽，免得点一下手柄就把整列点亮。
                        if (Math.abs(event.clientY - pointer.startY) < 4) return
                        pointer.started = true
                        setDragState({ from: pointer.from, over: null, edge: 'after' })
                      }
                      updateDrop(event.clientY)
                      updateAutoScroll(event.clientY)
                    },
                    onPointerUp: event => {
                      const pointer = pointerRef.current
                      if (!pointer || pointer.pointerId !== event.pointerId) return
                      finishDrag(true, event.clientY)
                    },
                    onPointerCancel: () => finishDrag(false),
                    onLostPointerCapture: () => { if (pointerRef.current) finishDrag(false) },
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
                  h(PresetSampleDetails, {
                    samples: p.samples || [], label: p.name || (i + 1),
                    onChange: samples => patch(i, { samples }),
                  }),
                ) : null,
              )
            }),
          ) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '10px 0' } }, '还没有画风预设。点「新增一套」开始。'),

          h('details', { style: { marginTop: 12 } },
            h('summary', { style: PROMPT_DISCLOSURE }, '默认画风'),
            h('div', { style: PROMPT_FIELDS },
              h('label', null, '默认画师串', h(PresetTextField, {
                value: config.styleArtists || '', multiline: true, ariaLabel: '默认画师串',
                style: promptArea(64), onCommit: value => save({ styleArtists: value }),
              })),
              h('label', null, '默认负面', h(PresetTextField, {
                value: config.styleNegative || '', multiline: true, ariaLabel: '默认负面',
                style: promptArea(64), onCommit: value => save({ styleNegative: value }),
              })))),
        )
    }

    function InlineStyleEditor({ config, save, styleId }) {
      const style = (config.stylePresets || []).find(item => item.id === styleId)
      const latest = React.useRef(config)
      latest.current = config
      const patch = change => save({ stylePresets: (latest.current.stylePresets || []).map(item => item.id === styleId ? { ...item, ...change } : item) })
      return h('div', { style: PROMPT_FIELDS, 'aria-label': '引用画风编辑' },
        style ? h(React.Fragment, null,
          h('strong', null, style.name),
          promptField('画风正面词', h(PresetTextField, { multiline: true, value: style.artist || '', style: promptArea(72), ariaLabel: '引用画风正面词', onCommit: artist => patch({ artist }) })),
          promptField('画风排除词', h(PresetTextField, { multiline: true, value: style.negative || '', style: promptArea(54), ariaLabel: '引用画风排除词', onCommit: negative => patch({ negative }) })),
          h('span', { style: STRUCTURE_MUTED }, '修改会保存到资料库，并用于其他引用这套画风的模板。'))
          : h('p', { style: STRUCTURE_MUTED }, '先在画风来源中选择资料库里的画风。'))
    }
