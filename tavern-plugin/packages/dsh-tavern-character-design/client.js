window.__ModuleLoader__.load({
  id: 'dsh-tavern-character-design',
  factory(require) {
    const { createElement: h, Fragment, useCallback, useEffect, useRef, useState } = require('react')
    const name = 'dsh-tavern-character-design'

    function ArchiveEntry({ character, confirming, busy, onConfirm, onRemove }) {
      const { name, identity, aliases, sections } = character
      return h('details', { className: 'dsh-tavern-resource-row character-design-entry' },
        h('summary', null, h('span', { className: 'character-design-entry-heading' },
          h('strong', null, name),
          identity ? h('span', null, identity) : null)),
        h('div', { className: 'character-design-entry-body' },
          aliases?.length || sections.length ? h('dl', { className: 'character-design-fields' },
            aliases?.length ? h('div', null, h('dt', null, '别名'), h('dd', null, aliases.join('、'))) : null,
            sections.map(section => h('div', { key: section.key },
              h('dt', null, section.label), h('dd', null, section.text)))) : null,
          confirming
            ? h('div', { className: 'character-design-confirm', role: 'group', 'aria-label': '确认删除人物档案' },
              h('p', null, '删除档案会移除本局自动生成且未被手动修改的世界书条目。'),
              h('div', { className: 'character-design-actions' },
                h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: () => onConfirm('') }, '取消'),
                h('button', { type: 'button', className: 'dsh-tavern-btn danger', disabled: busy,
                  onClick: () => onRemove(name) }, '确认删除')))
            : h('div', { className: 'character-design-actions' },
              h('button', { type: 'button', className: 'dsh-tavern-btn danger', disabled: busy,
                onClick: () => onConfirm(name) }, '删除人物档案'))))
    }

    function Panel({ ui, gameId, visible }) {
      const [archive, setArchive] = useState(undefined)
      const [guidance, setGuidance] = useState(null)
      const [confirm, setConfirm] = useState('')
      const [working, setWorking] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const request = useRef(0)
      const call = useCallback((method, args) => ui.callHost(name + '/' + method, { gameId, ...args }), [ui, gameId])
      const refresh = useCallback(async () => {
        const revision = ++request.current
        try {
          const value = await call('read')
          if (revision === request.current) setArchive(value)
        } catch (cause) {
          if (revision === request.current) setError(cause.message || String(cause))
        }
      }, [call])

      useEffect(() => {
        if (!gameId || !visible) return
        void refresh()
        const stops = [ui.watchState(gameId, 'archive', refresh)]
        if (typeof ui.watchWorkStatus === 'function') stops.push(ui.watchWorkStatus(gameId, refresh))
        return () => {
          ++request.current
          for (const stop of stops) stop()
        }
      }, [ui, gameId, visible, refresh])

      const published = archive?.task?.published?.length > 0 ? archive.task.requestId : null
      useEffect(() => {
        if (published) ui.notifyResourceChanges?.(['cards', 'worldbooks'])
      }, [ui, published])

      async function change(method, args) {
        if (working) return
        setWorking(true)
        setError('')
        setNotice('')
        try {
          const result = await call(method, args)
          if (method === 'remove') {
            setConfirm('')
            setNotice(result.worldbookEdited ? '档案已删除。手动编辑过的世界书条目已保留。' : '档案已删除。')
          } else {
            setGuidance(null)
          }
          await refresh()
        } catch (cause) {
          setError(cause.message || String(cause))
        } finally {
          setWorking(false)
        }
      }

      let content
      if (!gameId || archive === null) {
        content = h('div', { className: 'dsh-tavern-empty-state' }, h('p', null, '请先打开游玩会话。'))
      } else if (archive === undefined) {
        content = h('div', { className: 'dsh-tavern-empty-state' },
          error ? h('p', { role: 'alert' }, error) : h('p', { role: 'status' }, '正在读取人物档案…'))
      } else {
        const { characters, task, foregroundRunning } = archive
        const pending = task.status === 'running' || task.status === 'queued'
        const busy = working || pending || foregroundRunning
        const requestedGuidance = guidance ?? (task.status === 'failed' ? task.guidance || '' : '')
        const startLabel = { queued: '排队中…', running: '设计中…', failed: '重试设计' }[task.status] || '开始设计'
        const editor = h('form', { className: 'character-design-editor', onSubmit: event => {
          event.preventDefault()
          if (!busy) void change('start', { guidance: requestedGuidance })
        } },
          h('label', null, '设计意见（选填）', h('textarea', {
            className: 'dsh-tavern-regen-input',
            rows: 3, maxLength: 4000, disabled: busy, value: requestedGuidance,
            placeholder: '留空时根据当前剧情和已有档案选择人物',
            onChange: event => setGuidance(event.target.value)
          })),
          h('div', { className: 'character-design-actions' },
            foregroundRunning && !pending ? h('p', { role: 'status' }, '请等待本轮生成完成') : null,
            h('button', { type: 'submit', className: 'dsh-tavern-btn primary', disabled: busy }, startLabel)),
          error || task.status === 'failed' ? h('p', { role: 'alert' }, error || task.error) : null,
          notice ? h('p', { role: 'status' }, notice) : null,
          task.status === 'done' && task.published?.length ? h('p', { role: 'status' }, '已写入世界书：' + task.published.join('、')) : null,
          task.status === 'done' && task.reused?.length ? h('p', { role: 'status' }, '已复用本局世界书：' + task.reused.join('、')) : null)
        content = h(Fragment, null, editor,
          h('section', { className: 'dsh-tavern-resource-group', 'aria-label': '人物档案' },
            h('h3', { className: 'dsh-tavern-resource-group-title' }, '人物档案', h('span', null, characters.length + ' 份')),
            characters.length ? characters.map(character => h(ArchiveEntry, {
              key: character.name, character, busy, confirming: confirm === character.name,
              onConfirm: setConfirm, onRemove: name => void change('remove', { name })
            })) : h('div', { className: 'dsh-tavern-empty-state' }, h('p', null, '本局还没有人物档案。'))))
      }

      return h('div', { className: 'dsh-tavern-resources character-design-panel' },
        h('header', { className: 'dsh-tavern-status-head' },
          h('h2', { className: 'dsh-tavern-status-title' }, '人物设计'),
          h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: !gameId || working,
            onClick: () => { setError(''); void refresh() } }, '刷新')),
        h('div', { className: 'dsh-tavern-resource-body character-design-body',
          tabIndex: 0, role: 'region', 'aria-label': '人物设计内容' }, content))
    }

    return { name, inject: ['tavernUi'], apply(ctx) {
      const ui = ctx.tavernUi
      ui.registerPanel({ id: 'character-design', title: '人物设计',
        render: ({ gameId, visible }) => h(Panel, { key: gameId, ui, gameId, visible }) })
      ctx.effect(() => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = ui.assetUrl('style.css')
        document.head.append(link)
        return () => link.remove()
      })
    } }
  }
})
