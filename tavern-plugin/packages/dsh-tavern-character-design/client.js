window.__ModuleLoader__.load({
  id: 'dsh-tavern-character-design',
  factory(require) {
    const { createElement: h, useCallback, useEffect, useRef, useState } = require('react')
    const name = 'dsh-tavern-character-design'

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

      if (!gameId || archive === null) return h('p', { className: 'character-design-panel' }, '请先打开游玩会话。')
      if (archive === undefined) return h('div', { className: 'character-design-panel' },
        error ? h('p', { role: 'alert' }, error) : h('p', { role: 'status' }, '正在读取人物档案…'),
        error ? h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: refresh }, '重新读取') : null)

      const { characters, task, foregroundRunning } = archive
      const pending = task.status === 'running' || task.status === 'queued'
      const busy = working || pending || foregroundRunning
      const requestedGuidance = guidance ?? (task.status === 'failed' ? task.guidance || '' : '')
      return h('div', { className: 'character-design-panel' },
        h('form', { onSubmit: event => { event.preventDefault(); if (!busy) void change('start', { guidance: requestedGuidance }) } },
          h('label', null, '设计意见（选填）', h('textarea', {
            rows: 3, maxLength: 4000, disabled: busy, value: requestedGuidance,
            placeholder: '留空时根据当前剧情和已有档案选择人物',
            onChange: event => setGuidance(event.target.value)
          })),
          h('button', { type: 'submit', className: 'dsh-tavern-btn', disabled: busy },
            task.status === 'queued' ? '排队中…' : task.status === 'running' ? '设计中…' : task.status === 'failed' ? '重试设计' : '开始设计')),
        error || task.status === 'failed' ? h('p', { role: 'alert' }, error || task.error) : null,
        notice ? h('p', { role: 'status' }, notice) : null,
        task.status === 'done' && task.published?.length ? h('p', { role: 'status' }, '已写入世界书：' + task.published.join('、')) : null,
        task.status === 'done' && task.reused?.length ? h('p', { role: 'status' }, '已复用本局世界书：' + task.reused.join('、')) : null,
        h('section', { 'aria-label': '人物档案' },
          h('h3', null, '人物档案'),
          characters.length ? characters.map(character => h('details', { key: character.name },
            h('summary', null, h('b', null, character.name), character.identity ? h('span', null, ' · ' + character.identity) : null),
            character.aliases?.length ? h('p', null, h('b', null, '别名 '), character.aliases.join('、')) : null,
            character.sections.map(section => h('p', { key: section.key }, h('b', null, section.label + ' '), section.text)),
            confirm === character.name
              ? h('div', { role: 'group', 'aria-label': '确认删除人物档案' },
                h('p', null, '删除档案会移除本局自动生成且未被手动修改的世界书条目。'),
                h('button', { type: 'button', className: 'dsh-tavern-btn danger', disabled: busy,
                  onClick: () => void change('remove', { name: character.name }) }, '确认删除'),
                h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: () => setConfirm('') }, '取消'))
              : h('button', { type: 'button', className: 'dsh-tavern-btn danger', disabled: busy,
                onClick: () => setConfirm(character.name) }, '删除人物档案')
          )) : h('p', null, '本局还没有人物档案。')))
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
