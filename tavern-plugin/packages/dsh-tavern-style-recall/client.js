window.__ModuleLoader__.load({
  id: 'dsh-tavern-style-recall',
  factory(require) {
    const name = 'dsh-tavern-style-recall'
    const { createElement: h, useEffect, useState } = require('react')

    function Panel({ ui, gameId }) {
      const [settings, setSettings] = useState(null)
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')

      useEffect(() => {
        let active = true
        ui.callHost(name + '/settings', { gameId }).then(result => {
          if (!active) return
          setSettings(result)
          setDraft(result.binding)
        }).catch(reason => {
          if (active) setError(reason.message || String(reason))
        })
        return () => { active = false }
      }, [ui, gameId])

      if (!settings) return h('p', { role: error ? 'alert' : 'status' }, error || '正在读取剧本库…')
      if (!draft) return h('p', null, '请打开已绑定人物卡的游玩对话。')
      const available = settings.sources.some(item => item.path === draft.source)
      const missing = Boolean(draft.source) && !available
      const dirty = draft.source !== settings.binding.source || draft.enabled !== settings.binding.enabled

      async function save(event) {
        event.preventDefault()
        if (!dirty || saving) return
        setSaving(true)
        setError('')
        try {
          const binding = await ui.callHost(name + '/save', { gameId, ...draft })
          setSettings({ ...settings, binding })
          setDraft(binding)
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setSaving(false)
        }
      }

      return h('form', { onSubmit: save, style: { padding: '1rem', display: 'grid', gap: '0.75rem' } },
        h('p', { style: { margin: 0 } }, '这张卡的所有游玩记录共用设置。开启后，每轮会用后台模型从小说中挑选写法参考。'),
        h('label', { style: { display: 'grid', gap: '0.35rem' } }, '参考小说',
          h('select', { value: draft.source, disabled: saving, style: { width: '100%' }, onChange: event => {
            const source = event.target.value
            setDraft({ source, enabled: Boolean(source) && !missing && draft.enabled })
          } },
          h('option', { value: '' }, '未绑定'),
          missing && h('option', { value: draft.source }, draft.source.split('/').pop() + '（已移除）'),
          settings.sources.map(item => h('option', { key: item.path, value: item.path }, item.title)))),
        settings.sources.length === 0 && h('small', null, '可先在卡片工作台的「剧本库」导入小说。'),
        h('label', null, h('input', { type: 'checkbox', checked: draft.enabled, disabled: saving || (!available && !draft.enabled),
          onChange: event => setDraft({ ...draft, enabled: event.target.checked }) }), ' 开启文风联想'),
        h('button', { type: 'submit', disabled: saving || !dirty || (missing && draft.enabled) }, saving ? '保存中…' : '保存到人物卡'),
        error && h('small', { role: 'alert' }, error))
    }

    return { name, inject: ['tavernUi'], apply(ctx) {
      try {
        ctx.tavernUi.registerPanel({ id: 'style-recall', title: '文风联想',
          render: ({ gameId }) => h(Panel, { key: gameId, gameId, ui: ctx.tavernUi }) })
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 面板注册失败', error.message)
      }
    } }
  }
})
