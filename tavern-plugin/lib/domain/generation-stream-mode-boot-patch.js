// Add the generation-mode switch to DSH 0.2.1's native model menu without replacing
// its React bundle. The menu is portaled, so a small observer installs one row whenever
// the root Model/Effort pane opens; drilled model and effort panes are left untouched.
export function generationStreamModeBootScript() {
  return `(function () {
  if (window.__dshTavernGenerationStreamMode) return
  var state = { stream: true, busy: false, loaded: false, pending: null }
  var rows = []
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
    rows = rows.filter(function (row) { return row.isConnected })
    for (const row of rows) {
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
    if (!menu || menu.querySelector('[data-dsh-tavern-stream-mode]')) return
    const modelLabel = Array.from(menu.querySelectorAll('button[role="menuitem"] [class*="cellLabel"]')).find(function (label) {
      return label.textContent.trim() === '模型' || label.textContent.trim() === 'Model'
    })
    if (!modelLabel) return
    const modelRow = modelLabel.closest('button')
    const row = document.createElement('div')
    row.className = modelRow.className
    row.setAttribute('data-dsh-tavern-stream-mode', '')
    row.setAttribute('role', 'group')
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
      option.setAttribute('role', 'menuitemradio')
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
    menu.appendChild(row)
    rows.push(row)
    render()
    refresh()
  }
  function scan(node) {
    if (!node || node.nodeType !== 1) return
    if (node.matches && node.matches('[role="menu"]')) install(node)
    if (node.querySelectorAll) for (const menu of node.querySelectorAll('[role="menu"]')) install(menu)
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
      for (const item of queued) scan(item)
    })
  }
  const observer = new MutationObserver(function (records) {
    for (const record of records) {
      queueScan(record.target)
      for (const node of record.addedNodes) queueScan(node)
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  scan(document.documentElement)
  window.__dshTavernGenerationStreamMode = {
    choose: choose,
    refresh: refresh,
    snapshot: function () { return { stream: state.stream, busy: state.busy, loaded: state.loaded } },
    dispose: function () { observer.disconnect(); rows = [] }
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
