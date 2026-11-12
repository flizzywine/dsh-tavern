    const IMAGE_POSITIONS = [['inline', '正文'], ['left', '左侧栏'], ['right', '右侧栏'], ['floating', '悬浮窗']]
    const IMAGE_FOLLOW_MODES = [['scroll', '随正文滚动'], ['pointer', '随光标位置'], ['off', '手动切换']]
    const DISPLAY_FIGURES = '.dsh-tavern-illustration:is([data-kind="dsh-tavern-image/image"],[data-kind="dsh-tavern-comfy/image"]),[data-dti-inline-picture]'
    let imagePlacement = { position: 'inline', follow: 'scroll', width: 0 }
    const placementListeners = new Set()

    function applyImagePlacement(config) {
      const next = {
        position: IMAGE_POSITIONS.some(([key]) => key === config.imageDisplayPosition) ? config.imageDisplayPosition : 'inline',
        follow: IMAGE_FOLLOW_MODES.some(([key]) => key === config.imageDisplayFollow) ? config.imageDisplayFollow : 'scroll',
        width: normalizeImageWidth(config.imageDisplayWidth),
      }
      if (next.position === imagePlacement.position && next.follow === imagePlacement.follow && next.width === imagePlacement.width) return
      imagePlacement = next
      for (const listener of placementListeners) listener(next)
    }

    function ImagePlacementPanel() {
      const [settings, setSettings] = React.useState(imagePlacement)
      const [pictures, setPictures] = React.useState([])
      const [selected, select] = React.useState('')
      const [collapsed, setCollapsed] = React.useState(false)
      const [offset, setOffset] = React.useState(null)
      const [sizeNote, setSizeNote] = React.useState('')
      const drag = React.useRef(null)
      const resize = React.useRef(null)
      const saveTimer = React.useRef(null)
      const pendingWidth = React.useRef(null)
      const savingWidth = React.useRef(false)
      React.useEffect(() => () => clearTimeout(saveTimer.current), [])
      async function saveWidth(value) {
        clearTimeout(saveTimer.current)
        pendingWidth.current = normalizeImageWidth(value)
        if (savingWidth.current) return
        savingWidth.current = true
        try {
          while (pendingWidth.current !== null) {
            const width = pendingWidth.current
            pendingWidth.current = null
            try {
              const response = await jsonFetch(BASE + '/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { imageDisplayWidth: width } }) })
              // A completed request must not reset a newer live preview.
              if (pendingWidth.current === null && !resize.current && imagePlacement.width === width) {
                window.dispatchEvent(new CustomEvent('dsh-tavern-image:config', { detail: response.state?.config }))
                setSizeNote('')
              }
            } catch {
              if (pendingWidth.current === null) setSizeNote('大小保存失败，请重新调节重试')
            }
          }
        } finally { savingWidth.current = false }
      }
      function previewWidth(value) {
        applyImageWidth(value)
        setSizeNote('')
        clearTimeout(saveTimer.current)
        if (!resize.current) saveTimer.current = setTimeout(() => saveWidth(imagePlacement.width), 300)
      }
      function finishResize() {
        if (!resize.current) return
        resize.current = null
        saveWidth(imagePlacement.width)
      }
      React.useEffect(() => {
        placementListeners.add(setSettings)
        setSettings(imagePlacement)
        return () => placementListeners.delete(setSettings)
      }, [])
      React.useEffect(() => { setCollapsed(false); setOffset(null) }, [settings.position])

      React.useEffect(() => {
        if (settings.position === 'inline') { setPictures([]); return }
        let records = []
        let frame = 0
        let needsScan = true
        let pointer = null
        function sample() {
          frame = 0
          if (document.hidden) return
          if (needsScan) {
            needsScan = false
            records = [...document.querySelectorAll(DISPLAY_FIGURES)].flatMap(element => {
              if (element.parentElement?.closest(DISPLAY_FIGURES)) return []
              const img = element.querySelector('img')
              const src = img?.getAttribute('src')
              if (!src) return []
              const anchor = element.closest('[data-chat-turn]') || element
              return [{ src, title: img.alt || '正文插图', element, anchor }]
            })
            setPictures(previous => previous.length === records.length && previous.every((item, index) =>
              item.src === records[index].src && item.title === records[index].title) ? previous : records)
          }
          if (!records.length) { select(''); return }
          if (settings.follow === 'off') {
            select(current => records.some(record => record.src === current) ? current : records.at(-1).src)
            return
          }
          if (settings.follow === 'pointer' && !pointer) {
            select(current => records.some(record => record.src === current) ? current : records.at(-1).src)
            return
          }
          const line = settings.follow === 'pointer' ? pointer.y : window.innerHeight * 0.46
          const inTurn = pointer?.target?.closest?.('[data-chat-turn]')
          const sameTurn = settings.follow === 'pointer' && inTurn ? records.filter(record => record.anchor === inTurn) : []
          const candidates = sameTurn.length ? sameTurn : records
          let closest = null
          let distance = Infinity
          for (const record of candidates) {
            const rect = record.element.getBoundingClientRect()
            if (!rect.width || !rect.height) continue
            const current = Math.abs((rect.top + rect.bottom) / 2 - line)
            if (current < distance) { distance = current; closest = record }
          }
          if (closest) select(closest.src)
        }
        const schedule = () => { if (!frame) frame = requestAnimationFrame(sample) }
        const observe = new MutationObserver(changes => {
          if (!changes.some(change => {
            if (change.type === 'attributes') return change.target.closest?.(DISPLAY_FIGURES)
            return [...change.addedNodes, ...change.removedNodes].some(node =>
              node.nodeType === 1 && (node.matches(DISPLAY_FIGURES) || node.querySelector(DISPLAY_FIGURES)))
                || change.target.closest?.(DISPLAY_FIGURES)
          })) return
          needsScan = true
          schedule()
        })
        const trackPointer = event => {
          if (!event.target.closest?.('[data-chat-turn], [data-chat-flow-kind]') || event.target.closest?.('[data-dti-placement]')) return
          pointer = { y: event.clientY, target: event.target }
          schedule()
        }
        const trackCaret = () => {
          const selection = window.getSelection()
          const anchor = selection?.anchorNode?.parentElement
          if (!anchor?.closest('[data-chat-turn]') || !selection.rangeCount) return
          const rect = selection.getRangeAt(0).getBoundingClientRect()
          pointer = { y: rect.top + rect.height / 2, target: anchor }
          schedule()
        }
        document.addEventListener('visibilitychange', schedule)
        observe.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] })
        if (settings.follow !== 'off') {
          window.addEventListener('scroll', schedule, { capture: true, passive: true })
          window.addEventListener('resize', schedule, { passive: true })
        }
        if (settings.follow === 'pointer') {
          window.addEventListener('pointermove', trackPointer, { passive: true })
          document.addEventListener('selectionchange', trackCaret)
        }
        schedule()
        return () => {
          observe.disconnect()
          document.removeEventListener('visibilitychange', schedule)
          document.removeEventListener('selectionchange', trackCaret)
          if (frame) cancelAnimationFrame(frame)
          window.removeEventListener('scroll', schedule, true)
          window.removeEventListener('resize', schedule)
          window.removeEventListener('pointermove', trackPointer)
        }
      }, [settings.position, settings.follow])

      const widthRule = settings.width && settings.position === 'inline' ? `:is(${DISPLAY_FIGURES}) img { width: min(${settings.width}px, 100%, 96vw) !important; max-height: none !important; height: auto !important; }` : ''
      if (settings.position === 'inline') return widthRule ? h('style', null, widthRule) : null
      const index = Math.max(0, pictures.findIndex(item => item.src === selected))
      const picture = pictures[index]
      const btn = { ...buttonStyle, padding: '3px 7px', fontSize: 12 }
      const side = settings.position === 'left' ? { left: 12 } : { right: 12 }
      const floating = settings.position === 'floating'
      const position = floating ? (offset || { right: 16, bottom: 18 }) : { ...side, top: 72 }
      const width = collapsed ? 'auto' : `min(${settings.width || (floating ? 420 : 300)}px, 88vw)`
      const startDrag = event => {
        if (!floating || event.target.closest('button') || event.button !== 0) return
        const rect = event.currentTarget.parentElement.getBoundingClientRect()
        drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      return h(React.Fragment, null,
        h('style', null, widthRule, `:is(${DISPLAY_FIGURES}) { min-height: 1px; min-width: 1px; } :is(${DISPLAY_FIGURES}) img { display: none !important; }`),
        picture ? h('aside', { 'data-dti-placement': settings.position, 'aria-label': '正文图片查看器',
          style: { position: 'fixed', ...position, zIndex: 110, width, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box',
            border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: 8, boxShadow: '0 8px 24px #0003',
            background: 'var(--dsw-specific-input-major, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)' } },
          h('div', { style: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 4, cursor: floating ? 'move' : 'default', touchAction: floating ? 'none' : 'auto' },
            onPointerDown: startDrag, onPointerUp: () => { drag.current = null }, onLostPointerCapture: () => { drag.current = null },
            onPointerMove: event => {
              if (!drag.current) return
              const { dx, dy, width } = drag.current
              setOffset({ left: Math.max(0, Math.min(window.innerWidth - width, event.clientX - dx)),
                top: Math.max(0, Math.min(window.innerHeight - 40, event.clientY - dy)) })
            } },
            h('strong', { style: { fontSize: 12, flex: 1 } }, '插图 ' + (index + 1) + ' / ' + pictures.length),
            collapsed ? null : h('button', { type: 'button', style: btn, 'aria-label': '上一张正文图片', disabled: index < 1, onClick: () => select(pictures[index - 1].src) }, '‹'),
            collapsed ? null : h('button', { type: 'button', style: btn, 'aria-label': '下一张正文图片', disabled: index + 1 >= pictures.length, onClick: () => select(pictures[index + 1].src) }, '›'),
            h('button', { type: 'button', style: btn, onClick: () => setCollapsed(value => !value) }, collapsed ? '展开' : '收起')),
          collapsed ? null : h('button', { type: 'button', style: { display: 'flex', flex: '0 1 auto', minHeight: 0, width: '100%', overflow: 'hidden', border: 0, background: 'transparent', padding: 0, marginTop: 6, cursor: 'zoom-in' },
            onClick: () => openImageOverlay?.({ open: true, images: pictures.map(item => ({ url: item.src, alt: item.title })), index, note: '正文插图' }) },
            h('img', { src: picture.src, alt: picture.title, style: { display: 'block', width: '100%', minHeight: 0, objectFit: 'contain', borderRadius: 6 } })),
          collapsed ? null : h('div', { style: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8, marginTop: 8 } },
            h('input', { type: 'range', min: IMAGE_WIDTH_LIMIT.min, max: IMAGE_WIDTH_LIMIT.max, step: 1,
              'aria-label': '悬浮图片宽度', value: settings.width || (floating ? 420 : 300), style: { flex: 1, minWidth: 0, touchAction: 'none' },
              onPointerDown: event => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.focus()
                const rect = event.currentTarget.getBoundingClientRect()
                const span = IMAGE_WIDTH_LIMIT.max - IMAGE_WIDTH_LIMIT.min
                const track = Math.max(1, rect.width - 16)
                const value = imagePlacement.width || (floating ? 420 : 300)
                const thumbX = rect.left + 8 + (value - IMAGE_WIDTH_LIMIT.min) / span * track
                const start = Math.abs(event.clientX - thumbX) <= 12 ? value : normalizeImageWidth(IMAGE_WIDTH_LIMIT.min + (event.clientX - rect.left - 8) / track * span)
                // Keep the initial track as the ruler: the viewer itself changes width while dragging.
                resize.current = { x: event.clientX, value: start, scale: span / track }
                event.currentTarget.setPointerCapture(event.pointerId)
                previewWidth(start)
              },
              onPointerMove: event => {
                if (!resize.current) return
                previewWidth(resize.current.value + (event.clientX - resize.current.x) * resize.current.scale)
              },
              onPointerUp: finishResize, onPointerCancel: finishResize, onLostPointerCapture: finishResize,
              onChange: event => { if (!resize.current) previewWidth(event.target.value) },
              onBlur: () => { if (!resize.current) saveWidth(imagePlacement.width) } }),
            h('span', { style: { fontSize: 12, minWidth: '7ch', textAlign: 'right', whiteSpace: 'nowrap' } }, (settings.width || (floating ? 420 : 300)) + ' px')),
          sizeNote && !collapsed ? h('small', { role: 'status' }, sizeNote) : null) : null)
    }
