window.__ModuleLoader__.load({
  id: 'dsh-tavern-style-recall',
  factory(require) {
    const name = 'dsh-tavern-style-recall'
    const { createElement: h, useEffect, useState } = require('react')

    function Panel({ ui, gameId }) {
      const [settings, setSettings] = useState(null)
      const [draft, setDraft] = useState(null)
      const [reference, setReference] = useState(null)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')

      useEffect(() => {
        let active = true
        let unwatch
        ui.callHost(name + '/settings', { gameId }).then(result => {
          if (!active) return
          setSettings(result)
          setDraft(result.settings)
          setReference(result.reference)
          if (result.foregroundAvailable && gameId) unwatch = ui.watchState(gameId, 'foreground-reference', next => {
            if (active && next) setReference(next)
          })
        }).catch(reason => {
          if (active) setError(reason.message || String(reason))
        })
        return () => { active = false; unwatch?.() }
      }, [ui, gameId])

      if (!settings) return h('p', { role: error ? 'alert' : 'status' }, error || '正在读取剧本库…')
      const available = settings.sources.some(item => item.path === draft.source)
      const missing = Boolean(draft.source) && !available
      const foreground = draft.mode === 'foreground'
      const dirty = Object.keys(draft).some(key => draft[key] !== settings.settings[key])

      async function save(event) {
        event.preventDefault()
        if (!dirty || saving) return
        setSaving(true)
        setError('')
        try {
          const saved = await ui.callHost(name + '/save', draft)
          setSettings({ ...settings, settings: saved })
          setDraft(saved)
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setSaving(false)
        }
      }

      const labelStyle = { display: 'grid', gap: '0.35rem' }
      return h('form', { onSubmit: save, style: { padding: '1rem', display: 'grid', gap: '0.75rem' } },
        h('p', { style: { margin: 0 } }, '此设置适用于所有人物卡。'),
        settings.foregroundAvailable && h('label', { style: labelStyle }, '联想方式',
          h('select', { value: draft.mode, disabled: saving, onChange: event => {
            const mode = event.target.value
            setDraft({ ...draft, mode, enabled: draft.enabled && (mode === 'foreground' || available) })
          } },
          h('option', { value: 'novel' }, '从剧本库选段'),
          h('option', { value: 'foreground' }, '前台自行联想'))),
        foreground ? h('small', null, '仅用于自由游玩。正文模型在同一轮自行联想范文。')
          : h('small', null, '后台 Agent 为本轮从小说原文中选段。'),
        !foreground && h('label', { style: labelStyle }, '参考小说',
          h('select', { value: draft.source, disabled: saving, style: { width: '100%' }, onChange: event => {
            const source = event.target.value
            setDraft({ ...draft, source, enabled: Boolean(source) && !missing && draft.enabled })
          } },
          h('option', { value: '' }, '未绑定'),
          missing && h('option', { value: draft.source }, draft.source.split('/').pop() + '（已移除）'),
          settings.sources.map(item => h('option', { key: item.path, value: item.path }, item.title)))),
        !foreground && settings.sources.length === 0 && h('small', null, '可先在卡片工作台的「剧本库」导入小说。'),
        foreground && h('label', { style: labelStyle }, '文风偏好（可选）',
          h('textarea', { rows: 2, value: draft.guidance, maxLength: 500, disabled: saving,
            onChange: event => setDraft({ ...draft, guidance: event.target.value }) })),
        h('label', null, h('input', { type: 'checkbox', checked: draft.enabled, disabled: saving || (!foreground && !available && !draft.enabled),
          onChange: event => setDraft({ ...draft, enabled: event.target.checked }) }), ' 开启文风联想'),
        h('button', { type: 'submit', disabled: saving || !dirty || (!foreground && missing && draft.enabled) }, saving ? '保存中…' : '保存全局设置'),
        foreground && reference?.quote && h('details', null, h('summary', null, '本局最近一次前台联想'),
          reference.book && h('small', null, '《' + reference.book + '》' + reference.author),
          h('blockquote', { style: { margin: '0.5rem 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, reference.quote)),
        error && h('small', { role: 'alert' }, error))
    }

    return { name, inject: ['tavernUi', 'slots'], apply(ctx) {
      try {
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: name, order: 116, label: () => '文风联想'
        }, () => h(Panel, { ui: ctx.tavernUi }))))
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 全局设置注册失败', error.message)
      }
      try {
        ctx.tavernUi.registerPanel({ id: 'style-recall', title: '文风联想',
          render: ({ gameId }) => h(Panel, { key: gameId, gameId, ui: ctx.tavernUi }) })
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 面板注册失败', error.message)
      }
    } }
  }
})
