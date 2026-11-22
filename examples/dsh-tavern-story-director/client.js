window.__ModuleLoader__.load({
  id: 'dsh-tavern-story-director',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const plugin = 'dsh-tavern-story-director'
    const fields = { intent: '玩家意图', story: '剧情', pacing: '节奏', style: '文风' }

    function DirectorPanel({ ui, gameId, visible }) {
      const [state, setState] = React.useState(null)
      const [question, setQuestion] = React.useState('')
      const [sending, setSending] = React.useState('')
      const [switching, setSwitching] = React.useState(false)
      const [error, setError] = React.useState('')
      const [loadAttempt, reload] = React.useState(0)
      const log = React.useRef(null)
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

      const last = state?.turns.at(-1)?.id
      React.useEffect(() => {
        if (log.current) log.current.scrollTop = log.current.scrollHeight
      }, [last, sending, visible])

      async function send(event) {
        event?.preventDefault()
        const value = question.trim()
        if (!state || !value || sending || switching || state.phase === 'chat' || state.phase === 'switch') return
        if (retry.current?.question !== value) {
          retry.current = { question: value, requestId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) }
        }
        setError('')
        setSending(value)
        try {
          const next = await ui.callHost(plugin + '/send', { gameId, ...retry.current })
          setState(next)
          setQuestion('')
          retry.current = null
        } catch (failure) {
          setError(failure.message || String(failure))
        } finally {
          setSending('')
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

      const waiting = sending || state?.phase === 'chat'
      const review = !waiting && state?.phase === 'review'
      const disabled = !state || Boolean(waiting) || switching || state.phase === 'switch'
      return h('section', { className: 'tavern-story-director', 'aria-label': '剧情导演' },
        state?.plan ? h('div', { className: 'tavern-story-director-controls' },
          h('details', null,
            h('summary', null, state.enabled ? '当前 Guide' : '导演已暂停'),
            h('dl', null, Object.entries(fields).map(([key, label]) =>
              h('div', { key }, h('dt', null, label), h('dd', null, state.plan[key]))))),
          h('button', { type: 'button', onClick: toggle, disabled: switching || state.phase === 'switch' }, state.enabled ? '暂停' : '恢复')) : null,
        h('div', { className: 'tavern-story-director-log', role: 'log', ref: log },
          state ? state.turns.map(turn => h(React.Fragment, { key: turn.id },
            h('p', { className: 'tavern-story-director-player' }, turn.question),
            h('p', null, turn.reply),
            turn.applied ? h('small', null, '已更新 Guide') : null)) : null,
          state && !state.turns.length && !sending ? h('p', { className: 'tavern-story-director-hint' },
            '说说你想要的感觉。导演会安排接下来的剧情、节奏和写法，应用 Guide 后，随剧情调用本局后台模型复盘。') : null,
          sending ? h('p', { className: 'tavern-story-director-player' }, sending) : null,
          waiting || review || (!state && !error) ? h('p', { role: 'status', className: 'tavern-story-director-hint' },
            waiting ? '正在安排…' : review ? '正在复盘剧情…' : '正在读取导演对话…') : null),
        error ? h('div', { className: 'tavern-story-director-error', role: 'alert' }, error,
          !state ? h('button', { type: 'button', onClick: () => { setError(''); reload(value => value + 1) } }, '重试') : null) : null,
        h('form', { onSubmit: send },
          h('textarea', {
            value: question, onChange: event => setQuestion(event.target.value), rows: 2, maxLength: 2000, disabled,
            'aria-label': '给剧情导演的想法', placeholder: '比如，让场面慢慢紧起来，少一点对白。',
            onKeyDown: event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) void send(event)
            }
          }),
          h('button', { type: 'submit', disabled: disabled || !question.trim() }, '发送')))
    }

    return {
      name: plugin,
      inject: ['tavernUi'],
      apply(ctx) {
        const { tavernUi: ui } = ctx
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = `
            .tavern-story-director { display:flex; flex-direction:column; height:100%; min-height:0; padding:12px; gap:10px; box-sizing:border-box; font-size:14px; color:var(--dsw-alias-label-primary); }
            .tavern-story-director-controls { display:flex; align-items:flex-start; gap:8px; }
            .tavern-story-director details { flex:1; min-width:0; max-height:32vh; overflow:auto; padding:7px 9px; border:1px solid var(--dsw-alias-border-2, #8885); border-radius:8px; }
            .tavern-story-director summary { cursor:pointer; }
            .tavern-story-director dl { margin:8px 0 0; }
            .tavern-story-director dl div + div { margin-top:8px; }
            .tavern-story-director dt { font-weight:600; }
            .tavern-story-director dd { margin:2px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; }
            .tavern-story-director-log { flex:1 1 auto; min-height:0; overflow:auto; overscroll-behavior:contain; }
            .tavern-story-director-log p { margin:0 0 8px; padding:6px 2px; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.6; }
            .tavern-story-director-log .tavern-story-director-player { width:fit-content; max-width:86%; margin-left:auto; padding:7px 10px; border-radius:10px; background:var(--dsw-alias-fill-2, #8882); }
            .tavern-story-director small { display:block; margin:0 2px 12px; }
            .tavern-story-director-hint, .tavern-story-director small { color:var(--dsw-alias-label-secondary, inherit); }
            .tavern-story-director form { display:flex; gap:8px; align-items:flex-end; margin:0; }
            .tavern-story-director textarea, .tavern-story-director button { border:1px solid var(--dsw-alias-border-2, #8885); border-radius:8px; color:inherit; font:inherit; }
            .tavern-story-director textarea { flex:1; min-width:0; resize:none; padding:8px; background:transparent; }
            .tavern-story-director button { padding:6px 10px; background:var(--dsw-alias-fill-2, #8882); cursor:pointer; }
            .tavern-story-director button:disabled { opacity:.45; cursor:default; }
            .tavern-story-director-error { color:var(--dsh-tavern-accent-error, #b64134); overflow-wrap:anywhere; }
            .tavern-story-director-error button { margin-inline-start:8px; }
          `
          document.head.append(style)
          return () => style.remove()
        })
        ui.registerPanel({
          id: 'director', title: '剧情导演',
          render: ({ gameId, visible }) => h(DirectorPanel, { key: gameId, ui, gameId, visible })
        })
      }
    }
  }
})
