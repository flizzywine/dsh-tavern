window.__ModuleLoader__.load({
  id: 'dsh-tavern-story-director',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const plugin = 'dsh-tavern-story-director'

    function DirectorPanel({ ui, sidebar, gameId, visible }) {
      const [state, setState] = React.useState(null)
      const [question, setQuestion] = React.useState('')
      const [sending, setSending] = React.useState(null)
      const [switching, setSwitching] = React.useState(false)
      const [error, setError] = React.useState('')
      const [loadAttempt, reload] = React.useState(0)
      const [guideOpen, setGuideOpen] = React.useState(false)
      const [models, setModels] = React.useState(null)
      const [modelLoadFailed, setModelLoadFailed] = React.useState(false)
      const [modelLoadAttempt, reloadModels] = React.useState(0)
      const retry = React.useRef(null)

      React.useEffect(() => {
        if (visible === false) return
        let disposed = false
        let observed = false
        ui.callHost(plugin + '/state', { gameId }).then(value => {
          if (!disposed && !observed) setState(value)
        }, failure => {
          if (!disposed && !observed) setError(failure.message || String(failure))
        })
        const unwatch = ui.watchState(gameId, 'director', value => {
          if (!disposed && value) {
            observed = true
            setState(value)
          }
        })
        return () => { disposed = true; unwatch() }
      }, [ui, gameId, visible, loadAttempt])

      React.useEffect(() => {
        if (visible === false) return
        let active = true
        setModelLoadFailed(false)
        ui.callHost(plugin + '/models', { gameId }).then(result => {
          if (active) setModels(result)
        }, () => {
          if (active) setModelLoadFailed(true)
        })
        return () => { active = false }
      }, [ui, gameId, visible, modelLoadAttempt])

      async function send() {
        const value = question.trim()
        if (!state || !value || sending || switching || state.phase === 'chat' || state.phase === 'switch') return
        if (retry.current?.question !== value) {
          retry.current = { question: value, requestId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) }
        }
        setError('')
        const request = retry.current
        setSending(request)
        try {
          const next = await ui.callHost(plugin + '/send', { gameId, ...request })
          setState(next)
          setQuestion(draft => draft.trim() === value ? '' : draft)
          retry.current = null
        } catch (failure) {
          setError(failure.message || String(failure))
        } finally {
          setSending(null)
        }
      }

      async function toggle() {
        setError('')
        setSwitching(true)
        try {
          setState(await ui.callHost(plugin + '/set-enabled', { gameId, enabled: !state.enabled }))
        } catch (failure) {
          setError(failure.message || String(failure))
        } finally {
          setSwitching(false)
        }
      }

      async function setModel(selection) {
        setError('')
        setSwitching(true)
        try {
          setState(await ui.callHost(plugin + '/set-model', { gameId, selection }))
        } catch (failure) {
          setError(failure.message || String(failure))
        } finally {
          setSwitching(false)
        }
      }

      const direction = state?.enabled ? state.guide?.direction : state?.plan?.direction
      const waiting = Boolean(sending) || state?.phase === 'chat'
      const review = state?.phase === 'review'
      const changingGuide = switching || state?.phase === 'switch'
      const busy = !state || waiting || changingGuide
      const modelKey = selection => selection ? JSON.stringify([selection.provider, selection.model]) : '$background'
      const effectiveModel = state?.model ?? models?.background
      const effectiveKey = modelKey(effectiveModel)
      const selections = new Map([['$background', null]])
      const modelItems = [{ id: '$background', label: '跟随后台模型' }]
      let modelLabel = effectiveModel?.model || '跟随后台模型'
      for (const group of models?.catalog ?? []) {
        modelItems.push({ type: 'label', id: 'group:' + group.provider, text: group.providerName || group.provider })
        for (const entry of group.models) {
          const selection = { provider: group.provider, model: entry.id }
          const id = modelKey(selection)
          const label = entry.name || entry.id
          if (id === effectiveKey) modelLabel = label
          selections.set(id, selection)
          modelItems.push({ id, label })
        }
      }
      if (modelLoadFailed) modelItems.push({ id: '$retry', label: '重新加载模型列表' })
      else if (!models) modelItems.push({ id: '$loading', label: '正在加载模型…', disabled: true })
      else if (!models.catalog.length) modelItems.push({ id: '$empty', label: '暂无可用模型', disabled: true })
      const selectedModel = modelKey(state?.model)
      const messages = state?.turns.flatMap(turn => [
        { id: turn.id + ':user', role: 'user', text: turn.question },
        { id: turn.id + ':director', role: 'assistant', text: turn.reply, detail: turn.applied ? '已更新 Guide' : undefined }
      ]) ?? []
      if (sending && state?.turns.at(-1)?.id !== sending.requestId) {
        messages.push({ id: sending.requestId + ':user', role: 'user', text: sending.question })
      }
      if (!sidebar.renderSideChat) return h('p', null, '更新 DSH Tavern 后可以打开导演对话。')

      const guideTitle = state?.enabled ? '当前 Guide' : 'Guide 已暂停'
      const guideButton = state?.plan && h('button', {
        type: 'button', className: 'tavern-director-guide-button', 'aria-expanded': guideOpen,
        onClick: () => setGuideOpen(open => !open)
      }, guideTitle)
      const guidePanel = state?.plan && guideOpen && h('div', { className: 'tavern-director-guide' },
        h('p', null, direction || '当前没有剧情方向。'),
        h('button', { type: 'button', className: 'tavern-director-guide-button', onClick: toggle, disabled: changingGuide },
          state.enabled ? '暂停' : '恢复'))
      return sidebar.renderSideChat({
        label: '剧情导演', visible, messages,
        value: question, onChange: setQuestion, onSend: send, busy, maxLength: 2000,
        inputLabel: '给剧情导演的想法',
        placeholder: messages.length ? '和导演聊聊接下来的剧情…' : '比如，我想让失踪案影响同伴之间的关系。',
        status: waiting ? '正在安排…' : review ? '正在复盘剧情…' : !state && !error ? '正在读取导演对话…' : undefined,
        error,
        onRetry: !state ? () => { setError(''); reload(value => value + 1) } : undefined,
        tools: guideButton,
        model: {
          label: modelLabel, title: '剧情导演模型', disabled: busy || review,
          items: modelItems, selectedIds: [selectedModel],
          onSelect: id => {
            if (id === '$retry') reloadModels(value => value + 1)
            else if (id !== selectedModel && selections.has(id)) void setModel(selections.get(id))
          }
        },
        feedback: guidePanel
      })
    }

    return {
      name: plugin,
      inject: ['tavernUi', 'betterSidebar'],
      apply(ctx) {
        const { tavernUi: ui, betterSidebar: sidebar } = ctx
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = `
            .tavern-director-guide { flex:none; max-height:32vh; overflow:auto; margin:0 8px; padding:8px; border:1px solid var(--dsw-alias-border-2); border-radius:10px; color:var(--dsw-alias-label-primary); font:var(--dsw-font-xxs-12); }
            .tavern-director-guide p { margin:0 0 6px; overflow-wrap:anywhere; }
            .tavern-director-guide-button { padding:4px 7px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:var(--dsw-font-xxs-12); cursor:pointer; }
            .tavern-director-guide-button:hover:not(:disabled), .tavern-director-guide-button[aria-expanded="true"] { background:var(--dsw-alias-fill-2); color:var(--dsw-alias-label-primary); }
            .tavern-director-guide-button:disabled { opacity:.45; cursor:default; }
          `
          document.head.append(style)
          return () => style.remove()
        })
        ui.registerPanel({
          id: 'director', title: '剧情导演',
          render: ({ gameId, visible }) => h(DirectorPanel, { key: gameId, ui, sidebar, gameId, visible })
        })
      }
    }
  }
})
