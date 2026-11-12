    function PromptEntryLibrary({ entries, limit, revision, save, compact = false, group = '' }) {
      const editor = useImageDraft('entry-editor', null, revision)
      const draft = editor.value
      const setDraft = editor.update
      const [query, setQuery] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const groups = [...new Set(entries.map(entry => entry.group).filter(Boolean))]
      const groupList = React.useId()
      const needle = query.trim().toLowerCase()
      const visible = entries.filter(entry => !compact || !group || entry.group === group).filter(entry => [entry.title, entry.group].some(value => value.toLowerCase().includes(needle)))
      const shownDraft = draft && (!compact || !group || draft.group === group) ? draft : null
      const existing = entries.some(entry => entry.id === draft?.id)
      const edit = entry => { setDraft(entry); setNote('') }
      const patch = change => setDraft(current => ({ ...current, ...change }))
      const parseTerms = value => [...new Set(value.split(/[,，\n]/).map(term => term.trim().slice(0, 80)).filter(Boolean))].slice(0, 16)
      async function persist(remove = false) {
        if (!draft || busy) return
        const entry = { ...draft, title: draft.title.trim(), content: draft.content.trim(), group: draft.group.trim(),
          any: parseTerms(draft.any), all: parseTerms(draft.all), exclude: parseTerms(draft.exclude) }
        if (!remove && (!entry.title || !entry.content || (entry.enabled && !entry.always && !entry.any.length && !entry.all.length))) {
          setNote('请填写名称、视觉资料和至少一个触发词，或选择始终候选。')
          return
        }
        if (remove && !window.confirm('删除词条「' + entry.title + '」？')) return
        setBusy(true)
        setNote('')
        try {
          const next = remove ? entries.filter(item => item.id !== entry.id)
            : existing ? entries.map(item => item.id === entry.id ? entry : item) : [...entries, entry]
          if (await save({ promptEntries: next, ...(editor.revision ? { promptRevision: editor.revision } : {}) })) { editor.reset(null); setNote(remove ? '词条已删除' : '词条已保存') }
          else setNote('词条保存失败，可重试。')
        } finally { setBusy(false) }
      }
      const field = (key, label, maxLength, placeholder) => promptField(label, h('input', { style: S.input,
        value: draft[key], maxLength, placeholder, onChange: event => patch({ [key]: event.target.value }) }))
      return h(compact ? 'div' : 'details', { className: 'dti-template-library', 'aria-label': compact ? '引用词条编辑' : '生图词条库' },
        !compact ? h('summary', { className: 'dti-structure-heading' }, h('strong', null, '生图词条库'),
          h('span', { style: STRUCTURE_MUTED }, entries.length + ' / ' + limit)) : null,
        h('fieldset', { className: 'dti-entry-library', disabled: busy },
          !compact ? h('p', { style: STRUCTURE_MUTED }, '给地点、道具或画面设定写一份视觉资料，再用模板中的「词条库」模块引用。只有命中本轮正文的词条会交给规划模型。') : null,
          !compact ? h('div', { style: S.row },
            h('input', { style: S.input, 'aria-label': '搜索词条', placeholder: '搜索名称或分组', value: query, onChange: event => setQuery(event.target.value) }),
            h('button', { type: 'button', style: buttonStyle, disabled: entries.length >= limit, onClick: () => edit({
              id: 'entry-' + Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), title: '', group: '', content: '', any: '', all: '', exclude: '', priority: 0, enabled: true, always: false,
            }) }, '新建词条')) : null,
          compact ? promptField('编辑引用词条', h('select', { 'aria-label': '编辑引用词条', style: S.input, value: shownDraft?.id || '', onChange: event => {
            const entry = visible.find(item => item.id === event.target.value)
            if (entry) edit({ ...entry, any: entry.any.join('，'), all: entry.all.join('，'), exclude: entry.exclude.join('，') })
          } }, h('option', { value: '' }, '选择此模块引用的词条'), visible.map(entry => h('option', { key: entry.id, value: entry.id }, entry.title)))) :
          visible.length ? h('ul', { className: 'dti-template-list' }, visible.map(entry => h('li', { key: entry.id },
            h('button', { type: 'button', style: S.tab(entry.id === draft?.id), 'aria-pressed': entry.id === draft?.id,
              onClick: () => edit({ ...entry, any: entry.any.join('，'), all: entry.all.join('，'), exclude: entry.exclude.join('，') }) },
              h('strong', null, entry.title),
              h('small', null, [entry.group, entry.enabled ? entry.always ? '始终候选' : entry.any[0] || entry.all[0] : '已停用'].filter(Boolean).join(' · '))))))
            : h('p', { style: STRUCTURE_MUTED }, entries.length ? '没有匹配的词条' : '还没有词条'),
          shownDraft ? h('section', { className: 'dti-entry-editor', 'aria-label': '编辑生图词条' },
            h('div', { className: 'dti-inline-block-title' },
              field('title', '词条名称', 80, '例如：旧车站'),
              promptField('分组', h('input', { style: S.input, list: groupList, value: draft.group, maxLength: 60,
                placeholder: '例如：城镇地点', onChange: event => patch({ group: event.target.value }) }))),
            h('datalist', { id: groupList }, groups.map(group => h('option', { key: group, value: group }))),
            promptField('视觉资料', h('textarea', { 'aria-label': '视觉资料', style: promptArea(96), value: draft.content, maxLength: 1200,
              placeholder: '例如：候车厅有墨绿瓷砖、黄铜吊灯，站牌是深蓝色珐琅。',
              onChange: event => patch({ content: event.target.value }) })),
            h('label', { style: S.row }, h('input', { type: 'checkbox', checked: draft.always, onChange: event => patch({ always: event.target.checked }) }), '始终候选'),
            !draft.always ? field('any', '命中任一词', 1328, '例如：旧车站，北站，候车厅') : null,
            h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '更多条件与优先级'),
              h('div', { style: PROMPT_FIELDS },
                !draft.always ? field('all', '同时命中全部词', 1328, '例如：冬天，停电') : null,
                field('exclude', '出现任一词时排除', 1328, '例如：照片，梦境'),
                promptField('优先级', h('input', { type: 'number', style: S.input, min: -100, max: 100, value: draft.priority,
                  onChange: event => patch({ priority: event.target.value }) })),
                h('span', { style: STRUCTURE_MUTED }, '词用逗号分隔。任一词与全部词都填写时，两组条件必须同时满足。优先级越大越靠前。'))),
            h('div', { style: S.row },
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: draft.enabled, onChange: event => patch({ enabled: event.target.checked }) }), '启用词条'),
              h('button', { type: 'button', style: S.tab(true), onClick: () => persist() }, '保存词条'),
              h('button', { type: 'button', style: buttonStyle, onClick: () => editor.reset(null) }, '取消'),
              h('button', { type: 'button', style: buttonStyle, disabled: !editor.canUndo, onClick: editor.undo }, '撤销词条修改'),
              existing ? h('button', { type: 'button', style: buttonStyle, onClick: () => persist(true) }, '删除词条') : null)) : null,
          editor.conflict ? h('p', { role: 'status', style: STRUCTURE_MUTED }, '词条库已在别处更新，请取消后重新选择词条。') : null,
          note ? h('p', { role: 'status', style: STRUCTURE_MUTED }, note) : null))
    }

    function PromptEntryMatches({ matches }) {
      if (!matches?.length) return null
      return h('details', { className: 'dti-tryout-meta' },
        h('summary', null, '规划词条命中 ' + matches.length + ' 条'),
        matches.map(entry => h('div', { key: entry.id, className: 'dti-tryout-text' },
          h('strong', null, [entry.group, entry.title].filter(Boolean).join(' / ')),
          h('div', null, entry.terms.length ? '命中：' + entry.terms.join('、') : '始终候选'),
          h('pre', null, entry.content))))
    }
