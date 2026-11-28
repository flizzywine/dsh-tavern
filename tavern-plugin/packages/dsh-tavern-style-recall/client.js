window.__ModuleLoader__.load({
  id: 'dsh-tavern-style-recall',
  factory(require) {
    const name = 'dsh-tavern-style-recall'
    const { createElement: h, useEffect, useId, useState } = require('react')

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
        h('p', { className: 'style-recall-meta' }, '每轮按关键词匹配一段小说原文，供正文写作参考。'),
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

    function Panel({ ui }) {
      const components = ui.components
      const [settings, setSettings] = useState(null)
      const [source, setSource] = useState('')
      const [saving, setSaving] = useState(false)
      const [saved, setSaved] = useState(false)
      const [error, setError] = useState('')
      const [attempt, retry] = useState(0)
      const switchId = useId()

      useEffect(() => {
        if (!components) return
        let active = true
        ui.callHost(name + '/settings', {}).then(result => {
          if (!active) return
          setSettings(result)
          setSource(result.settings.source)
        }).catch(reason => {
          if (active) setError(reason.message || String(reason))
        })
        return () => { active = false }
      }, [ui, attempt, Boolean(components)])

      if (!components) return h('p', { className: 'style-recall' }, '请更新酒馆以使用文风参考面板。')
      const { Icon, Spinner, Switch } = components
      if (!settings) return h('div', { className: 'style-recall' },
        error ? h('p', { className: 'style-recall-notice', role: 'alert' }, error, ' ',
          h('button', { type: 'button', className: 'style-recall-text-button', onClick: () => { setError(''); retry(at => at + 1) } }, '重试'))
          : h('p', { className: 'style-recall-feedback', role: 'status' }, h(Spinner), '正在读取剧本库…'))
      const available = settings.sources.some(item => item.path === source)
      const dirty = source !== settings.settings.source

      async function save(patch, { keepDraft = false } = {}) {
        setSaving(true)
        setSaved(false)
        setError('')
        try {
          const result = await ui.callHost(name + '/save', patch)
          setSettings({ ...settings, settings: result })
          if (!keepDraft) setSource(result.source)
          setSaved(true)
        } catch (reason) {
          setError(reason.message || String(reason))
        } finally {
          setSaving(false)
        }
      }

      return h('form', { className: 'style-recall', 'aria-busy': saving, onSubmit: event => {
        event.preventDefault()
        if (dirty && !saving) void save({ source })
      } },
        h('header', { className: 'style-recall-head' },
          h('div', null, h('h2', null, '文风参考'), h('p', { className: 'style-recall-meta' }, '所有人物卡共用')),
          h('div', { className: 'style-recall-toggle' },
            h('label', { htmlFor: switchId }, '启用'),
            h(Switch, { id: switchId, label: '开启文风参考', checked: settings.settings.enabled,
              disabled: saving || (!settings.settings.enabled && !available),
              onChange: enabled => {
                if (enabled) void save({ source, enabled })
                else void save({ enabled }, { keepDraft: dirty })
              } }))),
        h(BookList, { components, sources: settings.sources, selected: source, missing: Boolean(source) && !available,
          disabled: saving, onSelect: setSource }),
        error && h('p', { className: 'style-recall-notice', role: 'alert' }, error),
        h('footer', { className: 'style-recall-footer' },
          h('span', { className: 'style-recall-feedback', role: 'status' },
            saved && !dirty ? h(Icon, { name: 'check', size: 15 }) : null,
            saving ? '正在保存…' : dirty ? '有未保存的修改' : saved ? '已保存'
              : !available && settings.sources.length ? '选好参考小说后即可开启' : null),
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
          name: 'plugins.item', id: name, order: 116, label: () => '文风参考'
        }, ({ view }) => view === 'summary'
          ? '从剧本库选取小说原文，供正文写作参考。'
          : h(Panel, { ui: ctx.tavernUi }))))
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 插件管理页注册失败', error.message)
      }
      try {
        ctx.tavernUi.registerPanel({ id: 'style-recall', title: '文风参考', render: () => h(Panel, { ui: ctx.tavernUi }) })
      } catch (error) {
        console.warn('[dsh-tavern-style-recall] 面板注册失败', error.message)
      }
    } }
  }
})
