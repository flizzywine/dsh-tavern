window.__ModuleLoader__.load({
  id: 'dsh-tavern-style-recall',
  factory(require) {
    const name = 'dsh-tavern-style-recall'
    const { createElement: h, useEffect, useId, useState } = require('react')
    const modes = [['novel', '从剧本库选段'], ['background', '后台自行联想']]

    function BookList({ components, sources, selected, missing, disabled, onSelect }) {
      const { EmptyState, Icon, SearchBox } = components
      const titleId = useId()
      const choiceName = useId()
      const [query, setQuery] = useState('')
      const search = query.trim().toLowerCase()
      const matches = sources.filter(book => book.title.toLowerCase().includes(search))

      return h('section', { className: 'style-recall-section', 'aria-labelledby': titleId },
        h('div', { className: 'style-recall-section-head' },
          h('h3', { id: titleId }, '参考小说'),
          selected && h('button', { type: 'button', className: 'style-recall-text-button', disabled,
            onClick: () => onSelect('') }, '解除绑定')),
        missing && h('p', { className: 'style-recall-notice' }, selected.split('/').pop() + ' 已从剧本库移除。'),
        sources.length ? h(SearchBox, { label: '搜索小说', value: query, onChange: setQuery, disabled,
          className: 'style-recall-search', icon: h(Icon, { name: 'search', size: 15 }), spellCheck: false,
          onKeyDown: event => { if (event.key === 'Enter') event.preventDefault() } }) : null,
        matches.length ? h('ul', { className: 'style-recall-books', role: 'radiogroup', 'aria-labelledby': titleId },
          matches.map(book => h('li', { key: book.path, role: 'presentation' },
            h('label', { className: 'style-recall-book', 'data-selected': book.path === selected || undefined },
              h('input', { type: 'radio', name: choiceName, value: book.path, checked: book.path === selected, disabled,
                onChange: () => onSelect(book.path) }),
              h('span', { className: 'style-recall-book-icon', 'aria-hidden': true }, h(Icon, { name: 'backlog', size: 17 })),
              h('span', { className: 'style-recall-book-title', title: book.title }, book.title),
              h('span', { className: 'style-recall-book-mark', 'aria-hidden': true },
                book.path === selected ? h(Icon, { name: 'check', size: 12 }) : null)))))
          : h(EmptyState, { compact: true, query: sources.length ? query : '', onClear: () => setQuery(''),
            text: sources.length ? undefined : '可在右侧栏「剧本库」导入参考小说。' }))
    }

    function Panel({ ui, gameId }) {
      const components = ui.components
      const [settings, setSettings] = useState(null)
      const [draft, setDraft] = useState(null)
      const [reference, setReference] = useState(null)
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(false)
      const [error, setError] = useState('')
      const [attempt, retry] = useState(0)
      const wayId = useId()
      const switchId = useId()

      useEffect(() => {
        if (!components) return
        let active = true
        let unwatch
        ui.callHost(name + '/settings', { gameId }).then(result => {
          if (!active) return
          setSettings(result)
          setDraft(result.settings)
          setReference(result.reference)
          if (result.backgroundAvailable && gameId) unwatch = ui.watchState(gameId, 'background-reference', next => {
            if (active && next) setReference(next)
          })
        }).catch(reason => {
          if (active) setError(reason.message || String(reason))
        })
        return () => { active = false; unwatch?.() }
      }, [ui, gameId, attempt, Boolean(components)])

      if (!components) return h('p', { className: 'style-recall' }, '请更新酒馆以使用文风联想面板。')
      const { Icon, Segmented, Spinner, Switch } = components
      if (!settings) return h('div', { className: 'style-recall' },
        error ? h('p', { className: 'style-recall-notice', role: 'alert' }, error, ' ',
          h('button', { type: 'button', className: 'style-recall-text-button', onClick: () => { setError(''); retry(at => at + 1) } }, '重试'))
          : h('p', { className: 'style-recall-feedback', role: 'status' }, h(Spinner), '正在读取剧本库…'))
      const available = settings.sources.some(item => item.path === draft.source)
      const missing = Boolean(draft.source) && !available
      const background = draft.mode === 'background'
      const { mode, source, guidance } = draft
      const configuration = { source, mode, guidance }
      const dirty = Object.keys(configuration).some(key => configuration[key] !== settings.settings[key])

      async function save(patch, { keepDraft = false } = {}) {
        setSaving(true)
        setSaved(false)
        setError('')
        try {
          const result = await ui.callHost(name + '/save', patch)
          setSettings({ ...settings, settings: result })
          if (!keepDraft) setDraft(result)
          setSaved(true)
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setSaving(false)
        }
      }

      return h('form', { className: 'style-recall', 'aria-busy': saving, onSubmit: event => {
        event.preventDefault()
        if (dirty && !saving) void save(configuration)
      } },
        h('header', { className: 'style-recall-head' },
          h('div', null, h('h2', null, '文风联想'), h('p', { className: 'style-recall-meta' }, '所有人物卡共用')),
          h('div', { className: 'style-recall-toggle' },
            h('label', { htmlFor: switchId }, '启用'),
            h(Switch, { id: switchId, label: '开启文风联想', checked: settings.settings.enabled,
              disabled: saving || (!settings.settings.enabled && (background ? !settings.backgroundAvailable : !available)),
              onChange: enabled => {
                if (enabled) void save({ ...configuration, enabled })
                else void save({ enabled }, { keepDraft: dirty })
              } }))),
        h('section', { className: 'style-recall-section', 'aria-labelledby': wayId },
          h('h3', { id: wayId }, '联想方式'),
          (settings.backgroundAvailable || background) && h(Segmented, { base: 'style-recall-mode', label: '联想方式', value: draft.mode,
            options: settings.backgroundAvailable ? modes : [modes[0], [...modes[1], true]], disabled: saving,
            onChange: mode => setDraft({ ...draft, mode }) }),
          h('p', { className: 'style-recall-meta' }, background ? '每轮由本局后台模型联想范文，正文生成时参考。' : '每轮按关键词匹配一段小说原文，同分时随机抽取。')),
        background ? h('label', { className: 'style-recall-section style-recall-guidance' },
          h('span', null, '文风偏好', h('small', null, '可选')),
          h('textarea', { rows: 3, value: draft.guidance, maxLength: 500, disabled: saving,
            placeholder: '例如：对白简短，描写多留白', onChange: event => setDraft({ ...draft, guidance: event.target.value }) }))
          : h(BookList, { components, sources: settings.sources, selected: draft.source, missing, disabled: saving,
            onSelect: source => setDraft({ ...draft, source }) }),
        background && reference?.quote && h('details', { className: 'style-recall-reference' }, h('summary', null, '本局最近一次后台联想'),
          h('blockquote', null, reference.quote)),
        error && h('p', { className: 'style-recall-notice', role: 'alert' }, error),
        h('footer', { className: 'style-recall-footer' },
          h('span', { className: 'style-recall-feedback', role: 'status' },
            saved && !dirty ? h(Icon, { name: 'check', size: 15 }) : null,
            saving ? '正在保存…' : dirty ? '有未保存的修改' : saved ? '已保存'
              : !background && !available && settings.sources.length ? '选好参考小说后即可开启' : null),
          h('button', { type: 'submit', className: 'style-recall-save', disabled: !dirty || saving }, '保存全局设置')))
    }

    return { name, inject: ['tavernUi', 'slots'], apply(ctx) {
      try {
        ctx.effect(() => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = ctx.tavernUi.assetUrl('style.css')
          document.head.append(link)
          return () => link.remove()
        })
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 样式加载失败', error.message)
      }
      try {
        ctx.effect(() => ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: name, order: 116, label: () => '文风联想'
        }, ({ view }) => view === 'summary'
          ? '从小说中选段，或用后台模型联想范文。'
          : h(Panel, { ui: ctx.tavernUi }))))
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 插件管理页注册失败', error.message)
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
