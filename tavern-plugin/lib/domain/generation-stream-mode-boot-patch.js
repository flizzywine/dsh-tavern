// Add the generation-mode switch (and on mobile viewports, the compact session stats
// footer) to DSH 0.2.1's native model menu without replacing its React bundle. The menu
// is portaled, so a small observer installs the rows whenever the root Model/Effort pane
// opens; drilled model and effort panes are left untouched.
export function generationStreamModeBootScript() {
  return `(function () {
  if (window.__dshTavernGenerationStreamMode) return
  var state = { stream: true, busy: false, loaded: false, pending: null }
  var contextVisual = { triggerState: null }
  const rows = new Map()
  const MOBILE_STATS_QUERY = '(max-width: 1023px)'
  const mobileMedia = typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_STATS_QUERY) : null
  const CONTEXT_BUCKET_COLORS = {
    worldbook: 'var(--dsh-ctx-wb,#6f9d8c)',
    card: 'var(--dsh-ctx-card,#c97a63)',
    system: 'var(--dsh-ctx-sys,#7f8a96)',
    state: 'var(--dsh-ctx-state,#c89b45)',
    tool: 'var(--dsh-ctx-tool,#7886b8)',
    story: 'var(--dsh-ctx-story,#5c82c4)'
  }
  const styleText = [
    '[data-dsh-tavern-mobile-stats]{display:flex;flex-wrap:wrap;align-items:center;gap:3px 8px;box-sizing:border-box;min-width:0;max-width:100%;margin-top:2px;padding:5px 8px 4px;border-top:1px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2,rgba(127,127,127,.16)));color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:10.5px;line-height:15px;font-variant-numeric:tabular-nums;user-select:none}',
    '[data-dsh-tavern-mobile-stats][data-dsh-tavern-stats-clickable="1"]{cursor:pointer;border-radius:6px;transition:background-color .15s ease}',
    '[data-dsh-tavern-mobile-stats][data-dsh-tavern-stats-clickable="1"]:hover,[data-dsh-tavern-mobile-stats][data-dsh-tavern-stats-clickable="1"]:active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08))}',
    '[data-dsh-tavern-mobile-stats][data-dsh-tavern-stats-clickable="1"]:focus-visible{outline:2px solid var(--dsh-tavern-accent,var(--dsw-alias-button-info-fill,#4176e6));outline-offset:-1px}',
    '[data-dsh-tavern-mobile-stats][hidden]{display:none!important}',
    '@media (min-width:1024px){[data-dsh-tavern-mobile-stats]{display:none!important}}',
    '[data-dsh-tavern-menu-stat]{display:inline-flex;align-items:center;gap:3px;min-width:0;white-space:nowrap}',
    '[data-dsh-tavern-menu-stat] svg{flex:none;width:11px!important;height:11px!important}',
    '[data-dsh-tavern-menu-stat] [class*="_sep"]{margin:0 2.5px!important}',
    '[data-dsh-tavern-stats-more]{margin-left:auto;font-weight:600;color:var(--dsh-tavern-accent,var(--dsw-alias-button-info-fill,#4176e6));white-space:nowrap}',
    '[data-dsh-tavern-stats-bar]{display:flex;flex:1 0 100%;width:100%;height:2.5px;border-radius:999px;overflow:hidden;gap:1px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.14));margin-top:2px}',
    '[data-dsh-tavern-stats-seg]{height:100%;border-radius:1px;min-width:2px}',
    '@media (max-width:1023px){',
    '[data-dsh-tavern-ctx-trigger="scheme-c"]{position:relative!important;overflow:visible!important;--dsh-ctx-fill:rgba(90,143,123,.2);--dsh-ctx-line:rgba(79,131,111,.72);background-image:linear-gradient(to top,var(--dsh-ctx-fill) 0%,var(--dsh-ctx-fill) var(--dsh-ctx-level,0%),var(--dsh-ctx-line) var(--dsh-ctx-level,0%),var(--dsh-ctx-line) calc(var(--dsh-ctx-level,0%) + 1.5px),transparent calc(var(--dsh-ctx-level,0%) + 1.5px))!important;transition:background-image .25s ease,box-shadow .2s ease}',
    '[data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="warn"]{--dsh-ctx-fill:rgba(217,119,6,.22);--dsh-ctx-line:rgba(217,119,6,.76)}',
    '[data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="cache-break"]{--dsh-ctx-fill:rgba(217,119,6,.24);--dsh-ctx-line:rgba(217,119,6,.82)}',
    '[data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="danger"]{--dsh-ctx-fill:rgba(209,73,59,.24);--dsh-ctx-line:rgba(209,73,59,.86);box-shadow:inset 0 0 0 1px rgba(209,73,59,.42)!important}',
    'body[data-ds-dark-theme] [data-dsh-tavern-ctx-trigger="scheme-c"]{--dsh-ctx-fill:rgba(111,179,154,.24);--dsh-ctx-line:rgba(126,200,173,.78)}',
    'body[data-ds-dark-theme] [data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="warn"],body[data-ds-dark-theme] [data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="cache-break"]{--dsh-ctx-fill:rgba(245,158,11,.24);--dsh-ctx-line:rgba(251,191,36,.84)}',
    'body[data-ds-dark-theme] [data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="danger"]{--dsh-ctx-fill:rgba(248,113,113,.26);--dsh-ctx-line:rgba(248,113,113,.88);box-shadow:inset 0 0 0 1px rgba(248,113,113,.5)!important}',
    '[data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-alert="1"]::after{content:attr(data-ctx-pill);position:absolute;top:-5px;right:-5px;min-width:16px;height:13px;padding:0 3.5px;border-radius:999px;font-size:9px;font-weight:700;line-height:13px;text-align:center;font-variant-numeric:tabular-nums;color:#fff;background:#d97706;box-shadow:0 0 0 1.5px var(--dsw-specific-input-major,#fff);pointer-events:none;z-index:2;letter-spacing:-.02em}',
    '[data-dsh-tavern-ctx-trigger="scheme-c"][data-ctx-tone="danger"][data-ctx-alert="1"]::after{background:#d1493b}',
    '}',
    '@media (prefers-reduced-motion:reduce){[data-dsh-tavern-ctx-trigger="scheme-c"],[data-dsh-tavern-mobile-stats][data-dsh-tavern-stats-clickable="1"]{transition:none!important}}'
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
  function resolveTriggerVisualForDock(dock) {
    if (contextVisual.triggerState) return contextVisual.triggerState
    if (!dock) return null
    const triggerEl = dock.querySelector('.JObwrW_trigger, button[aria-label*="上下文"], [data-composer-stat="context"]')
    const pctText = triggerEl ? (triggerEl.textContent || triggerEl.getAttribute('aria-label') || '') : ''
    const pctMatch = pctText.match(/(\\d+(?:\\.\\d+)?)\\s*%/)
    const percent = pctMatch ? Math.max(0, Math.min(100, Math.round(Number(pctMatch[1])))) : null
    const usageEl = dock.querySelector('[data-composer-stat="usage"]')
    const activityEl = dock.querySelector('[data-composer-stat="activity"]')
    const usageText = usageEl ? (usageEl.textContent || '') : ''
    const activityText = activityEl ? (activityEl.textContent || '') : ''
    const turnMatch = activityText.match(/(\\d+)\\s*轮/)
    const stepMatch = activityText.match(/(\\d+)\\s*步/)
    const hasHistory = (turnMatch && Number(turnMatch[1]) > 1) || (stepMatch && Number(stepMatch[1]) > 1)
    const hasCacheBreak = /缓存命中\\s*0\\s*%/.test(usageText) && Boolean(hasHistory)
    if (percent === null && !hasCacheBreak) return null
    let tone = 'normal'
    if (percent !== null && percent >= 80) tone = 'danger'
    else if (hasCacheBreak) tone = 'cache-break'
    else if (percent !== null && percent >= 65) tone = 'warn'
    const level = percent !== null ? (percent > 0 ? Math.max(6, Math.min(100, percent)) : 0) : (hasCacheBreak ? 8 : 0)
    const alertPill = tone === 'danger' && percent !== null ? (percent + '%') : (tone === 'cache-break' ? '0%' : '')
    return {
      percent,
      level,
      tone,
      alertPill,
      bucketShares: []
    }
  }
  function clearTriggerSchemeC(btn) {
    btn.removeAttribute('data-dsh-tavern-ctx-trigger')
    btn.removeAttribute('data-ctx-tone')
    btn.removeAttribute('data-ctx-alert')
    btn.removeAttribute('data-ctx-pill')
    btn.style.removeProperty('--dsh-ctx-level')
  }
  function collectModelTriggers() {
    return Array.from(document.querySelectorAll('button[class*="_7KE1Ra_trigger"], [data-composer-card] button[aria-controls]:not([class*="_primary"])'))
  }
  const dockWatchers = new Map()
  function watchDock(dock) {
    if (!dock || dockWatchers.has(dock)) return
    const watcher = new MutationObserver(function () { syncTriggerBadges() })
    watcher.observe(dock, { childList: true, subtree: true, characterData: true, attributes: true })
    dockWatchers.set(dock, watcher)
  }
  function syncTriggerBadges() {
    for (const [dock, watcher] of dockWatchers) {
      if (!dock.isConnected) {
        watcher.disconnect()
        dockWatchers.delete(dock)
      }
    }
    const mobile = isMobileViewport()
    const triggers = collectModelTriggers()
    for (const btn of triggers) {
      if (!mobile) {
        clearTriggerSchemeC(btn)
        continue
      }
      const scope = btn.closest('[data-composer-seat], [data-conversation-content]') || document
      const dock = scope.querySelector('[data-composer-dock]') || document.querySelector('[data-composer-dock]')
      if (dock) watchDock(dock)
      const visual = resolveTriggerVisualForDock(dock)
      if (!visual || (visual.percent === null && !visual.alertPill)) {
        clearTriggerSchemeC(btn)
        continue
      }
      btn.setAttribute('data-dsh-tavern-ctx-trigger', 'scheme-c')
      btn.setAttribute('data-ctx-tone', visual.tone || 'normal')
      btn.style.setProperty('--dsh-ctx-level', String(visual.level || 0) + '%')
      if (visual.alertPill) {
        btn.setAttribute('data-ctx-alert', '1')
        btn.setAttribute('data-ctx-pill', visual.alertPill)
      } else {
        btn.removeAttribute('data-ctx-alert')
        btn.removeAttribute('data-ctx-pill')
      }
    }
  }
  function buildStatsExtras(dock) {
    const more = document.createElement('span')
    more.setAttribute('data-dsh-tavern-stats-more', '')
    more.setAttribute('aria-hidden', 'true')
    more.textContent = '分布 ›'
    const bar = document.createElement('span')
    bar.setAttribute('data-dsh-tavern-stats-bar', '')
    bar.setAttribute('aria-hidden', 'true')
    const visual = resolveTriggerVisualForDock(dock)
    const shares = visual && Array.isArray(visual.bucketShares) ? visual.bucketShares : []
    if (shares.length > 0) {
      for (const part of shares) {
        const pct = Math.max(0, Number(part.share) || 0) * 100
        if (pct <= 0) continue
        const seg = document.createElement('span')
        seg.setAttribute('data-dsh-tavern-stats-seg', part.key)
        seg.style.width = Math.max(2, Math.round(pct * 10) / 10) + '%'
        seg.style.background = CONTEXT_BUCKET_COLORS[part.key] || CONTEXT_BUCKET_COLORS.system
        bar.appendChild(seg)
      }
    } else if (visual && visual.percent !== null && visual.percent > 0) {
      const seg = document.createElement('span')
      seg.setAttribute('data-dsh-tavern-stats-seg', 'used')
      seg.style.width = Math.max(3, Math.min(100, visual.percent)) + '%'
      seg.style.background = visual.tone === 'danger' ? '#d1493b' : (visual.tone === 'warn' || visual.tone === 'cache-break' ? '#d97706' : CONTEXT_BUCKET_COLORS.worldbook)
      bar.appendChild(seg)
    }
    return [more, bar]
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
        record.dockObserver = new MutationObserver(function () {
          syncMenuStats(record)
          syncTriggerBadges()
        })
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
    const nodes = items.concat(buildStatsExtras(dock))
    const nextHtml = nodes.map(function (item) { return item.outerHTML }).join('')
    if (record.signature === nextHtml && !statsRow.hidden) return
    record.signature = nextHtml
    statsRow.replaceChildren(...nodes)
    statsRow.hidden = false
  }
  function syncAllMenuStats() {
    for (const record of rows.values()) syncMenuStats(record)
    syncTriggerBadges()
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
    statsRow.setAttribute('role', 'button')
    statsRow.setAttribute('tabindex', '0')
    statsRow.setAttribute('data-dsh-tavern-stats-clickable', '1')
    statsRow.setAttribute('aria-label', '运行信息 · 点击查看上下文分布')
    statsRow.hidden = true
    statsRow.addEventListener('mousedown', function (event) { event.preventDefault(); event.stopPropagation() })
    function openContextWindowFromStats(event) {
      event.preventDefault()
      event.stopPropagation()
      try {
        const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
        menu.dispatchEvent(esc)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('dsh-tavern:open-context-window', {
          detail: { source: 'mobile-menu-stats', menuId: menu.id || '' }
        }))
      } catch {}
    }
    statsRow.addEventListener('click', openContextWindowFromStats)
    statsRow.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      openContextWindowFromStats(event)
    })
    menu.appendChild(row)
    menu.appendChild(statsRow)
    const record = { modelRow: modelRow, menu: menu, statsRow: statsRow, dock: null, dockObserver: null, signature: '' }
    rows.set(row, record)
    render()
    syncMenuStats(record)
    syncTriggerBadges()
    refresh()
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return
    if (node.matches('[role="menu"]')) install(node)
    for (const menu of node.querySelectorAll('[role="menu"]')) install(menu)
    syncTriggerBadges()
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
    setContextVisual: function (payload) {
      contextVisual.triggerState = payload && payload.triggerState ? payload.triggerState : null
      syncAllMenuStats()
    },
    snapshot: function () { return { stream: state.stream, busy: state.busy, loaded: state.loaded } },
    dispose: function () {
      observer.disconnect()
      window.removeEventListener('resize', syncAllMenuStats)
      if (mobileMedia && typeof mobileMedia.removeEventListener === 'function') mobileMedia.removeEventListener('change', syncAllMenuStats)
      for (const btn of collectModelTriggers()) clearTriggerSchemeC(btn)
      for (const watcher of dockWatchers.values()) watcher.disconnect()
      dockWatchers.clear()
      for (const [row, record] of rows) {
        disconnectStatsObserver(record)
        row.remove()
        record.statsRow.remove()
      }
      rows.clear()
      contextVisual.triggerState = null
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
