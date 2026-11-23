// Add the generation-mode switch (and on mobile viewports, the compact session stats
// footer) to DSH 0.2.1's native model menu without replacing its React bundle. The menu
// is portaled, so a small observer installs the rows whenever the root Model/Effort pane
// opens; drilled model and effort panes are left untouched.
export function generationStreamModeBootScript() {
  return `(function () {
  if (window.__dshTavernGenerationStreamMode) return
  var state = { stream: true, busy: false, loaded: false, pending: null }
  const rows = new Map()
  const MOBILE_STATS_QUERY = '(max-width: 1023px)'
  const mobileMedia = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_STATS_QUERY) : null
  const styleText = [
    '[data-dsh-tavern-mobile-stats]{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;box-sizing:border-box;min-width:0;margin-top:2px;padding:5px 8px 3px;border-top:1px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2,rgba(127,127,127,.16)));color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:10.5px;line-height:15px;font-variant-numeric:tabular-nums;user-select:none}',
    '[data-dsh-tavern-mobile-stats][hidden]{display:none!important}',
    '@media (min-width:1024px){[data-dsh-tavern-mobile-stats]{display:none!important}}',
    '[data-dsh-tavern-menu-stat]{display:inline-flex;align-items:center;gap:3px;min-width:0;white-space:nowrap}',
    '[data-dsh-tavern-menu-stat] svg{flex:none;width:11px!important;height:11px!important}',
    '[data-dsh-tavern-menu-stat] [class*="_sep"]{margin:0 2.5px!important}'
  ].join('')
  let styleNode = document.querySelector('style[data-dsh-tavern-stream-mode-style]')
  if (!styleNode && (document.head || document.documentElement)) {
    styleNode = document.createElement('style')
    styleNode.setAttribute('data-dsh-tavern-stream-mode-style', '')
    styleNode.textContent = styleText
    ;(document.head || document.documentElement).appendChild(styleNode)
  }
  function isMobileViewport() {
    if (mobileMedia) return mobileMedia.matches
    return typeof window.innerWidth === 'number' && window.innerWidth > 0 && window.innerWidth <= 1023
  }
  function findDockForMenu(menu) {
    if (menu && menu.id) {
      const triggers = document.querySelectorAll('[aria-controls]')
      for (const trigger of triggers) {
        if (trigger.getAttribute('aria-controls') !== menu.id) continue
        const scope = trigger.closest('[data-composer-seat], [data-conversation-content]')
        const scopedDock = scope && scope.querySelector('[data-composer-dock]')
        if (scopedDock) return scopedDock
      }
    }
    const docks = document.querySelectorAll('[data-composer-seat] [data-composer-dock], [data-composer-dock]')
    return docks.length ? docks[docks.length - 1] : null
  }
  function collectStatEntries(container, out) {
    if (!container || !container.children) return
    for (const child of container.children) {
      if (child.hasAttribute('data-slot')) collectStatEntries(child, out)
      else out.push(child)
    }
  }
  function buildStatItems(dock) {
    const entries = []
    collectStatEntries(dock, entries)
    const items = []
    for (const entry of entries) {
      const source = entry.querySelector('[class*="_pill"], [class*="_trigger"], button') || entry
      const text = (source.textContent || '').trim()
      if (!text) continue
      const statCarrier = entry.hasAttribute('data-composer-stat') ? entry : entry.querySelector('[data-composer-stat]')
      const statId = (statCarrier && statCarrier.getAttribute('data-composer-stat')) || 'context'
      const item = document.createElement('span')
      item.setAttribute('data-dsh-tavern-menu-stat', statId)
      const ariaLabel = source.getAttribute('aria-label') || entry.getAttribute('aria-label')
      if (ariaLabel) item.title = ariaLabel
      for (const child of source.childNodes) {
        const copy = child.cloneNode(true)
        if (copy.nodeType === 1) {
          copy.removeAttribute('id')
          if (copy.tagName && copy.tagName.toLowerCase() === 'svg') copy.setAttribute('aria-hidden', 'true')
        }
        item.appendChild(copy)
      }
      items.push(item)
    }
    return items
  }
  function disconnectStatsObserver(record) {
    if (record.dockObserver) {
      record.dockObserver.disconnect()
      record.dockObserver = null
    }
    record.dock = null
  }
  function syncMenuStats(record) {
    const statsRow = record.statsRow
    if (!statsRow) return
    if (!isMobileViewport()) {
      disconnectStatsObserver(record)
      statsRow.hidden = true
      statsRow.textContent = ''
      record.signature = ''
      return
    }
    const dock = findDockForMenu(record.menu)
    if (record.dock !== dock) {
      disconnectStatsObserver(record)
      record.dock = dock
      if (dock) {
        record.dockObserver = new MutationObserver(function () { syncMenuStats(record) })
        record.dockObserver.observe(dock, { childList: true, subtree: true, characterData: true, attributes: true })
      }
    }
    const items = dock ? buildStatItems(dock) : []
    if (!items.length) {
      statsRow.hidden = true
      statsRow.textContent = ''
      record.signature = ''
      return
    }
    const nextHtml = items.map(function (item) { return item.outerHTML }).join('')
    if (record.signature === nextHtml && !statsRow.hidden) return
    record.signature = nextHtml
    statsRow.replaceChildren(...items)
    statsRow.hidden = false
  }
  function syncAllMenuStats() {
    for (const record of rows.values()) syncMenuStats(record)
  }
  function call(method, args) {
    return fetch('/api/dsh-tavern/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    }).then(function (response) { return response.json() }).then(function (result) {
      if (!result || result.ok !== true) throw new Error(result && result.error || '流式设置读取失败')
      return result
    })
  }
  function render() {
    for (const row of rows.keys()) {
      row.setAttribute('data-stream', String(state.stream))
      row.setAttribute('aria-busy', String(state.busy))
      const options = row.querySelectorAll('[data-dsh-tavern-stream-option]')
      for (const option of options) {
        const selected = (option.getAttribute('data-dsh-tavern-stream-option') === 'stream') === state.stream
        option.setAttribute('aria-checked', String(selected))
        option.disabled = state.busy
        option.style.background = selected ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent'
        option.style.color = selected ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'
      }
    }
  }
  function refresh() {
    if (state.loaded || state.pending) return state.pending || Promise.resolve(state.stream)
    state.pending = call('getGenerationStreamMode').then(function (result) {
      state.stream = result.stream !== false
      state.loaded = true
      render()
      return state.stream
    }).catch(function (error) {
      console.warn('[dsh-tavern] 流式设置读取失败，使用默认流式：', error)
      state.stream = true
      render()
      return true
    }).finally(function () { state.pending = null })
    return state.pending
  }
  function choose(stream) {
    if (state.busy || state.stream === stream) return
    const previous = state.stream
    state.stream = stream
    state.busy = true
    render()
    call('setGenerationStreamMode', { stream: stream }).then(function (result) {
      state.stream = result.stream !== false
      state.loaded = true
    }).catch(function (error) {
      state.stream = previous
      console.warn('[dsh-tavern] 流式设置保存失败：', error)
    }).finally(function () { state.busy = false; render() })
  }
  function install(menu) {
    const existing = menu.querySelector('[data-dsh-tavern-stream-mode]')
    if (existing) {
      const existingRecord = rows.get(existing)
      if (existingRecord) {
        if (existingRecord.statsRow.previousElementSibling !== existing || menu.lastElementChild !== existingRecord.statsRow) {
          menu.appendChild(existing)
          menu.appendChild(existingRecord.statsRow)
        }
        syncMenuStats(existingRecord)
      }
      return
    }
    const modelLabel = Array.from(menu.querySelectorAll('button[role="menuitem"] [class*="cellLabel"]')).find(function (label) {
      return label.textContent.trim() === '模型' || label.textContent.trim() === 'Model'
    })
    if (!modelLabel) return
    const modelRow = modelLabel.closest('button')
    if (modelRow.closest('[role="menu"]') !== menu) return
    const row = document.createElement('div')
    row.className = modelRow.className
    row.setAttribute('data-dsh-tavern-stream-mode', '')
    row.setAttribute('role', 'radiogroup')
    row.setAttribute('aria-label', '所有模型输出方式')
    row.title = '所有模型请求使用流式或非流式输出，默认流式；设置持续生效'
    const label = modelLabel.cloneNode(false)
    label.textContent = '输出方式'
    const value = document.createElement('span')
    const valueClass = modelRow.querySelector('[class*="cellValue"]')
    value.className = valueClass ? valueClass.className : ''
    value.style.display = 'inline-flex'
    value.style.gap = '2px'
    for (const item of [{ key: 'stream', text: '流式', stream: true }, { key: 'non-stream', text: '非流式', stream: false }]) {
      const option = document.createElement('button')
      option.type = 'button'
      option.setAttribute('data-dsh-tavern-stream-option', item.key)
      option.setAttribute('role', 'radio')
      option.textContent = item.text
      option.style.border = '0'
      option.style.borderRadius = 'var(--dsw-radius-sm)'
      option.style.padding = '2px 6px'
      option.style.font = 'inherit'
      option.style.fontSize = '12px'
      option.style.lineHeight = '20px'
      option.style.cursor = 'pointer'
      option.addEventListener('mousedown', function (event) { event.preventDefault(); event.stopPropagation() })
      option.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); choose(item.stream) })
      option.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault(); event.stopPropagation()
        const other = row.querySelector('[data-dsh-tavern-stream-option="' + (item.stream ? 'non-stream' : 'stream') + '"]')
        if (other) other.focus()
      })
      value.appendChild(option)
    }
    row.appendChild(label)
    row.appendChild(value)
    const statsRow = document.createElement('div')
    statsRow.setAttribute('data-dsh-tavern-mobile-stats', '')
    statsRow.setAttribute('aria-label', '运行信息')
    statsRow.hidden = true
    statsRow.addEventListener('mousedown', function (event) { event.preventDefault(); event.stopPropagation() })
    statsRow.addEventListener('click', function (event) { event.stopPropagation() })
    menu.appendChild(row)
    menu.appendChild(statsRow)
    const record = { modelRow: modelRow, menu: menu, statsRow: statsRow, dock: null, dockObserver: null, signature: '' }
    rows.set(row, record)
    render()
    syncMenuStats(record)
    refresh()
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return
    if (node.matches('[role="menu"]')) install(node)
    for (const menu of node.querySelectorAll('[role="menu"]')) install(menu)
  }
  // The observer sits on the whole document, so one conversation re-render can
  // arrive as hundreds of records for the same container. Scanning per record
  // re-queries that subtree just as many times; collapse a batch into one pass
  // per microtask, and drop nodes an already queued ancestor will cover.
  let scanQueue = new Set()
  let scanScheduled = false
  function queueScan(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 9)) return
    for (const queued of scanQueue) if (queued === node || queued.contains(node)) return
    for (const queued of [...scanQueue]) if (node.contains(queued)) scanQueue.delete(queued)
    scanQueue.add(node)
    if (scanScheduled) return
    scanScheduled = true
    ;(typeof queueMicrotask === 'function' ? queueMicrotask : function (run) { Promise.resolve().then(run) })(function () {
      scanScheduled = false
      const queued = [...scanQueue]
      scanQueue = new Set()
      // DSH reuses the portal when drilling into model or effort choices.
      for (const [row, record] of rows) {
        const hostMenu = record.modelRow.closest('[role="menu"]')
        if (row.isConnected && row.parentElement === hostMenu && record.statsRow.isConnected && record.statsRow.parentElement === hostMenu) continue
        disconnectStatsObserver(record)
        row.remove()
        record.statsRow.remove()
        rows.delete(row)
      }
      for (const item of queued) scan(item)
    })
  }
  const observer = new MutationObserver(function (records) {
    for (const record of records) {
      queueScan(record.target)
      for (const node of record.addedNodes) queueScan(node)
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] })
  window.addEventListener('resize', syncAllMenuStats)
  if (mobileMedia && typeof mobileMedia.addEventListener === 'function') mobileMedia.addEventListener('change', syncAllMenuStats)
  scan(document.documentElement)
  window.__dshTavernGenerationStreamMode = {
    choose: choose,
    refresh: refresh,
    syncStats: syncAllMenuStats,
    snapshot: function () { return { stream: state.stream, busy: state.busy, loaded: state.loaded } },
    dispose: function () {
      observer.disconnect()
      window.removeEventListener('resize', syncAllMenuStats)
      if (mobileMedia && typeof mobileMedia.removeEventListener === 'function') mobileMedia.removeEventListener('change', syncAllMenuStats)
      for (const [row, record] of rows) {
        disconnectStatsObserver(record)
        row.remove()
        record.statsRow.remove()
      }
      rows.clear()
      if (styleNode) styleNode.remove()
    }
  }
})()`
}

export function installGenerationStreamModeBootPatch(ctx) {
  ctx.inject(['webServer'], webCtx => {
    webCtx.on('webserver/index-inject', table => {
      if (!Array.isArray(table) || table.some(row => row?.dshTavernGenerationStreamMode)) return
      table.unshift({ kind: 'script', placement: 'head', text: generationStreamModeBootScript(), dshTavernGenerationStreamMode: true })
    })
  })
}
