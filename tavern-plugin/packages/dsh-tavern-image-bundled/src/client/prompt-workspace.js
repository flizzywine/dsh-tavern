    const PROMPT_MODES_UI = [
      ['auto', '自动'], ['tags', '标签'], ['natural', '自然语言'],
      ['mixed', '混合'], ['structured', '结构化自然语言'],
    ]
    const PROMPT_FIELDS = { display: 'grid', gap: 10, marginTop: 10, minWidth: 0 }
    const PROMPT_DISCLOSURE = { cursor: 'pointer', fontSize: 13, fontWeight: 600 }
    const promptArea = height => ({ ...S.input, display: 'block', width: '100%', minHeight: height,
      maxHeight: 'min(42vh, 360px)', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.55 })
    const promptField = (label, control) => h('label', { style: { display: 'grid', gap: 4, fontSize: 12, minWidth: 0 } }, label, control)

    function exposePromptGeneration(profile) {
      const structure = profile?.structure
      if (!Array.isArray(structure?.blocks) || structure.blocks.some(block => block.kind === 'output')) return profile
      const { generationRules, ...rest } = structure
      const rule = rest.blocks.find(block => block.kind === 'rule' && !block.usage)
      if (!rule && !generationRules?.trim() && (!structure.format || structure.format === 'auto')) return profile
      const output = { kind: 'output', title: '生成方式', format: structure.format || 'auto',
        text: [generationRules, rule?.text].filter(Boolean).join('\n').slice(0, 4000), ...(rule?.enabled === false ? { enabled: false } : {}) }
      return { ...profile, structure: { ...rest, blocks: rule ? rest.blocks.map(block => block === rule ? output : block) : [output, ...rest.blocks] } }
    }

    function PromptWorkspace({ config, workflows = [], definitions, save, editingTemplate, select, renderResource }) {
      const library = config.promptPresetLibrary || []
      const saved = config.promptPresets || []
      const limit = config.promptPresetLimit || 60
      const storageKey = 'dsh-tavern-image-prompt-draft-v1'
      const defaultKey = 'dsh-tavern-image-default-template-draft'
      const clearLegacyDrafts = () => {
        try {
          localStorage.removeItem(storageKey)
          localStorage.removeItem('dsh-tavern-comfy-prompt-draft-v1')
          localStorage.removeItem(defaultKey)
        } catch {}
      }
      const readProfile = item => {
        const { structure } = item
        const rest = { enabled: item.enabled !== false, ...(item.independent === true ? { independent: true } : {}) }
        for (const key of ['id', 'name', 'project', 'positive', 'negative', 'tagPositive', 'naturalPositive', 'mixedPositive', 'structuredPositive', 'structuredNegative']) {
          if (typeof item[key] === 'string') rest[key] = item[key]
        }
        if (!PROMPT_MODES_UI.some(([id]) => id === structure?.format) || !Array.isArray(structure?.blocks)) return rest
        const blocks = structure.blocks.filter(block => promptBlockLabel(block?.kind)).slice(0, PROMPT_BLOCK_LIMIT).map(block => ({
          kind: block.kind, title: String(block.title ?? '').slice(0, 60), text: String(block.text ?? '').slice(0, ['rule', 'library', 'output'].includes(block.kind) ? 4000 : 1000),
          ...(block.kind === 'output' ? { format: PROMPT_MODES_UI.some(([id]) => id === block.format) ? block.format : structure.format } : {}),
          ...(Array.isArray(block.modes) ? { modes: [...block.modes] } : {}),
          ...(typeof block.usage === 'string' ? { usage: block.usage.slice(0, 64) } : {}),
          ...(block.enabled === false ? { enabled: false } : {}),
          ...(block.kind === 'extension' ? { moduleId: block.moduleId || 'core.custom', values: JSON.parse(JSON.stringify(block.values || {})) } : {}),
          ...(block.kind === 'style' && typeof block.styleId === 'string' ? { styleId: block.styleId.slice(0, 120) } : {}),
          ...(block.kind === 'library' ? Object.fromEntries(['characterId', 'outfitId', 'angle', 'state'].filter(key => typeof block[key] === 'string').map(key => [key, block[key]])) : {}),
          ...(block.kind === 'library' && ['characters', 'outfits'].includes(block.librarySource) ? { librarySource: block.librarySource } : {}),
          ...(block.kind === 'entries' ? { entryGroup: String(block.entryGroup ?? '').slice(0, 60) } : {}),
          ...(block.kind === 'mechanism' ? Object.fromEntries(['mechanism', 'count', 'seed', 'weights'].map(key => [key, block[key]])) : {}),
          ...(['lora', 'mechanism'].includes(block.kind) ? Object.fromEntries(['workflowId', 'node', 'slot', 'strengthModel', 'strengthClip'].map(key => [key, block[key]])) : {}),
        }))
        const targets = Array.isArray(structure.targets) ? structure.targets.filter(target => ['channel', 'workflow'].includes(target?.kind) && typeof target.id === 'string').slice(0, 60) : []
        const generationRules = typeof structure.generationRules === 'string' ? structure.generationRules.slice(0, 4000) : ''
        return exposePromptGeneration({ ...rest, structure: { format: structure.format, purpose: structure.purpose || 'both', blocks, ...(structure.scenarios ? { scenarios: JSON.parse(JSON.stringify(structure.scenarios)) } : {}), ...(Array.isArray(structure.inputs) ? { inputs: JSON.parse(JSON.stringify(structure.inputs)) } : {}), targets, ...(generationRules ? { generationRules } : {}) } })
      }
      const [tryoutOpen, setTryoutOpen] = React.useState(false)
      const workspace = useImageDraft('templates' + (config.promptCatalogEpoch ? ':' + config.promptCatalogEpoch : ''), {
        presets: saved.map(exposePromptGeneration), defaultTemplate: exposePromptGeneration(config.promptDefault),
      }, config.promptRevision, () => {
        let presets = saved.map(exposePromptGeneration)
        let defaultTemplate = exposePromptGeneration(config.promptDefault)
        if (config.promptCatalogEpoch) return { presets, defaultTemplate }
        try {
          const cached = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem('dsh-tavern-comfy-prompt-draft-v1') || 'null')
          if (Array.isArray(cached) && cached.length <= limit) presets = cached.map(readProfile)
          const cachedDefault = JSON.parse(localStorage.getItem(defaultKey) || 'null')
          if (cachedDefault?.structure && config.promptDefault !== null) defaultTemplate = readProfile(cachedDefault)
        } catch {}
        return { presets, defaultTemplate }
      }, true)
      const draft = workspace.value.presets
      const defaultDraft = workspace.value.defaultTemplate
      const setDraft = presets => workspace.update(current => ({ ...current, presets }))
      const setDefaultDraft = defaultTemplate => workspace.update(current => ({ ...current, defaultTemplate }))
      const requestedTemplate = editingTemplate ?? (config.promptEffectivePreset || config.activePromptPreset || '')
      const selected = requestedTemplate !== 'structured-template' && [...library, ...draft].some(item => item.id === requestedTemplate) ? requestedTemplate : ''
      const [query, setQuery] = React.useState('')
      const [projectFilter, setProjectFilter] = React.useState('')
      const [importText, setImportText] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [deleteRequest, setDeleteRequest] = React.useState(null)
      const [deleteNote, setDeleteNote] = React.useState('')
      React.useEffect(() => setDeleteRequest(null), [selected])
      const projectListId = React.useId()
      const structureSupported = config.promptDefaultEditable === true
      const activeId = config.activePromptPreset || ''
      const starter = library.find(item => item.id === 'structured-template')
      const generationBlock = starter?.structure?.blocks.find(block => block.kind === 'output')
        || { kind: 'output', title: '生成方式', format: 'structured', text: '按正文的可见事实写一个定格画面，省略没有依据的内容。' }
      const defaultBlocks = [generationBlock, ...(config.promptDefaultSections || []).map(title => ({ kind: 'section', title, text: '' }))]
      const fallback = defaultDraft || config.promptDefaultTemplate || {
        name: '模块化模板', independent: true, structure: starter?.structure || { format: 'structured', blocks: defaultBlocks, targets: [] },
      }
      const isDefault = !selected
      const profile = isDefault ? fallback : [...library, ...draft].find(item => item.id === selected)
      const custom = draft.includes(profile)
      const editable = custom || isDefault
      const projects = [...new Set(draft.map(item => item.project?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'))
      const catalog = [
        ...(fallback ? [{ id: '', name: fallback.name || '模块化模板', scope: 'builtin' }] : []),
        ...library.filter(item => item.id !== 'structured-template').map(item => ({ ...item, scope: 'builtin' })),
        ...draft.map(item => ({ ...item, scope: item.project?.trim() ? 'project:' + item.project.trim() : 'unfiled' })),
      ].filter(item => (!projectFilter || item.scope === projectFilter) &&
        [item.name, item.project].some(text => String(text || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
      const requestedFormat = profile?.structure?.format || config.promptMode || 'auto'
      const format = requestedFormat === 'auto' ? config.promptEffectiveFormat || 'natural' : requestedFormat
      const structure = profile?.structure || { format: requestedFormat, blocks: profile && fallback ? defaultBlocks : [], targets: [] }
      const options = [
        ...(config.imageChannels || []).map(channel => ({ kind: 'channel', id: channel.id, label: channel.name || channel.id })),
        ...workflows.filter(workflow => !workflow.error && workflow.enabled !== false).map(workflow => ({ kind: 'workflow', id: workflow.id, label: workflow.label || workflow.id })),
      ]
      const claimed = new Set()
      const updateDraft = next => {
        setDraft(next)
        setMessage('有未保存的修改')
      }
      const edit = patch => {
        if (!isDefault) { updateDraft(draft.map(item => item === profile ? { ...item, ...patch } : item)); return }
        const next = { ...profile, ...patch }
        setDefaultDraft(next)
        setMessage('默认模板有未保存的修改')
      }
      const editStructure = patch => edit({ structure: { ...structure, ...patch } })
      const append = (source, blank = false) => {
        if (draft.length >= limit) return
        source = source ? JSON.parse(JSON.stringify(source)) : null
        const item = source
          ? { ...source, id: 'custom-' + Date.now(), name: source.name + ' 副本', enabled: true }
          : { id: 'custom-' + Date.now(), name: '新模板', positive: '', negative: '', enabled: true, independent: true }
        if (!source && projectFilter.startsWith('project:')) item.project = projectFilter.slice(8)
        item.structure = { ...source?.structure, format: source?.structure?.format || 'structured',
          blocks: blank ? [{ kind: 'scene', title: '场景', text: '' }, generationBlock] : source?.structure?.blocks || defaultBlocks, targets: source?.structure?.targets || [] }
        updateDraft([...draft, item])
        select(item.id)
        setQuery('')
        setProjectFilter(item.project ? 'project:' + item.project : '')
        setMessage('草稿已创建')
      }
      async function persist(next, activePromptPreset, nextDefault = defaultDraft) {
        for (const item of nextDefault ? [...next, nextDefault] : next) {
          const incomplete = item.structure?.blocks.find(block => block.kind === 'lora' && block.enabled !== false &&
            (!block.workflowId || !block.node || !block.text.trim()))
          if (incomplete) {
            setMessage('请为 LoRA 模块「' + incomplete.title + '」选择工作流、节点和文件。')
            return false
          }
          const inputs = item.structure?.inputs || []
          if (inputs.some(input => !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(input.key)) || new Set(inputs.map(input => input.key)).size !== inputs.length) {
            setMessage('输入标识必须以英文字母开头，只使用字母、数字和下划线，且不可重复。')
            return false
          }
          const sections = (item.structure?.blocks || []).filter(block => block.kind === 'section')
          const names = sections.map(block => block.title.trim())
          if ((item.structure?.blocks || []).some(block => !block.title.trim() || /[【】<>\r\n]/.test(block.title)) || new Set(names).size !== names.length) {
            setMessage('请填写分节名称。剧情分节名称不可重复，也不要使用括号【】或尖括号。')
            return false
          }
        }
        setBusy(true)
        try {
          const result = await save({ promptPresets: next, activePromptPreset, ...(workspace.revision ? { promptRevision: workspace.revision } : {}), promptDefault: nextDefault || fallback })
          if (!result) { setMessage('保存失败，草稿已保留'); return false }
          const updated = result.state?.config || {}
          workspace.reset({ presets: (updated.promptPresets || next).map(exposePromptGeneration),
            defaultTemplate: exposePromptGeneration(Object.hasOwn(updated, 'promptDefault') ? updated.promptDefault : nextDefault) }, updated.promptRevision)
          clearLegacyDrafts()
          setMessage('已保存')
          return true
        } finally { setBusy(false) }
      }
      async function removeTemplate() {
        const id = deleteRequest?.id
        if (!id || busy) return
        const remainingDrafts = draft.filter(item => item.id !== id)
        if (!saved.some(item => item.id === id)) {
          updateDraft(remainingDrafts)
          select(activeId === id ? '' : activeId)
          setDeleteRequest(null); setDeleteNote('已删除模板草稿')
          return
        }
        setBusy(true); setDeleteNote('删除中…')
        try {
          const remainingSaved = saved.filter(item => item.id !== id)
          const nextActive = activeId === id ? '' : activeId
          const result = await save({ promptPresets: remainingSaved, activePromptPreset: nextActive,
            ...(config.promptRevision ? { promptRevision: config.promptRevision } : {}),
            randomTemplateIds: (config.randomTemplateIds || []).filter(value => value !== id) })
          if (!result) { setDeleteNote('删除失败，模板仍保留，请重试'); return }
          const updated = result.state?.config || {}
          const baseline = { presets: (updated.promptPresets || remainingSaved).map(exposePromptGeneration),
            defaultTemplate: exposePromptGeneration(Object.hasOwn(updated, 'promptDefault') ? updated.promptDefault : config.promptDefault) }
          workspace.reset(baseline, updated.promptRevision, { ...workspace.value, presets: remainingDrafts })
          clearLegacyDrafts()
          select(nextActive); setDeleteRequest(null)
          setDeleteNote('已删除模板「' + deleteRequest.name + '」')
        } catch (error) { setDeleteNote('删除失败：' + error.message) }
        finally { setBusy(false) }
      }
      const importPresets = (source = importText) => {
        try {
          const parsed = JSON.parse(source)
          const incoming = Array.isArray(parsed) ? parsed : [parsed]
          if (!incoming.length || incoming.length + draft.length > limit || incoming.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
            throw new Error('请提供预设对象，导入后最多 ' + limit + ' 套')
          }
          const added = incoming.map((item, index) => {
            const profile = readProfile(item)
            if (profile.structure) profile.structure.targets = profile.structure.targets.filter(target => options.some(option => option.kind === target.kind && option.id === target.id))
            return { ...profile, id: 'import-' + Date.now() + '-' + index }
          })
          updateDraft([...draft, ...added])
          select(added[0].id)
          setQuery('')
          setProjectFilter('')
          setImportText('')
          setMessage('已导入草稿')
        } catch (error) { setMessage('导入失败：' + error.message) }
      }
      const exportPresets = (items = draft) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url
        link.download = 'dsh-prompt-presets.json'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      return h('div', { style: S.card },
        h('div', { style: { fontWeight: 600, fontSize: 16 } }, '生图工作台'),
        h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
          '当前渠道使用：' + (config.promptEffectiveName || [...library, ...saved].find(item => item.id === activeId)?.name || '模块化模板') + ' · '
          + (PROMPT_MODES_UI.find(([id]) => id === config.promptEffectiveFormat)?.[1] || '自动')),
        !structureSupported ? h('p', { role: 'status', style: STRUCTURE_MUTED }, '请重启 DSH NEXT 载入结构编辑器。') : null,
        structureSupported ? h('fieldset', { disabled: busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
          h('div', { className: 'dti-template-toolbar', style: S.row },
            promptField('正在编辑的模板', h('select', { 'aria-label': '正在编辑的模板', style: S.input, value: selected, onChange: event => { select(event.target.value); setMessage('') } },
              h('option', { value: '' }, fallback?.name || '模块化模板'),
              [...library.filter(item => item.id !== 'structured-template'), ...draft].map(item => h('option', { key: item.id, value: item.id }, item.project ? item.project + ' / ' + item.name : item.name || '未命名')))),
            editable ? h('button', { type: 'button', style: S.tab(true), onClick: () => persist(draft, activeId) }, '保存工作台') : null,
            profile && selected !== activeId ? h('button', { type: 'button', style: buttonStyle, onClick: () => persist(draft, selected) },
              selected ? '保存并设为默认' : '使用默认模板') : null,
            h('button', { type: 'button', style: buttonStyle, disabled: draft.length >= limit, onClick: () => append(null, true) }, '新建模板'),
            editable && profile ? h('button', { type: 'button', style: buttonStyle, disabled: draft.length >= limit, onClick: () => append(profile) }, '复制模板') : null,
            profile && !editable ? h('button', { type: 'button', style: buttonStyle, disabled: draft.length >= limit, onClick: () => append(profile) }, '复制并编辑') : null,
            h('button', { type: 'button', style: buttonStyle, disabled: !workspace.canUndo, onClick: () => { workspace.undo(); setMessage('') } }, '撤销模板修改'),
            workspace.dirty ? h('button', { type: 'button', style: buttonStyle, onClick: () => {
              if (window.confirm('放弃本地模板草稿，恢复已保存内容？')) {
                workspace.reset()
                clearLegacyDrafts()
                setMessage('')
              }
            } }, '放弃模板草稿') : null,
            h('span', { role: 'status', style: STRUCTURE_MUTED }, workspace.conflict ? '模板已在别处更新，请先保留或放弃本地草稿。'
              : message || (workspace.dirty ? '本地草稿已保留' : ''))),
          h('div', { style: S.row }, promptField('模板用途', h('select', { 'aria-label': '模板用途', style: S.input, value: structure.purpose || 'both', onChange: event => editStructure({ purpose: event.target.value }) },
            h('option', { value: 'both' }, '生成与改图'), h('option', { value: 'generate' }, '生成图片'), h('option', { value: 'edit' }, '编辑已有图片')))),
          h('details', { style: S.card }, h('summary', { style: PROMPT_DISCLOSURE }, '随机模板'),
            h('label', { style: S.row }, h('input', { type: 'checkbox', checked: config.randomPromptTemplates === true, onChange: event => save({ randomPromptTemplates: event.target.checked }) }), '每次生图随机选择模板'),
            config.randomPromptTemplates ? h('div', { style: PROMPT_FIELDS },
              [{ id: '__default__', name: fallback.name }, ...draft.filter(item => item.enabled !== false)].map(item => h('label', { key: item.id, style: S.row },
                h('input', { type: 'checkbox', checked: !config.randomTemplateIds?.length || config.randomTemplateIds.includes(item.id), onChange: event => {
                  const all = ['__default__', ...draft.filter(value => value.enabled !== false).map(value => value.id)]
                  const current = config.randomTemplateIds?.length ? config.randomTemplateIds : all
                  const next = event.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id)
                  if (!next.length) return
                  save({ randomTemplateIds: next })
                } }), item.name || '未命名模板'))) : null),
          h('section', { style: S.card, 'aria-label': '提示词模块' },
            !profile ? h('div', { style: STRUCTURE_MUTED }, '选择模板后可编辑模块。') : h(React.Fragment, null,
                h(PromptStructureEditor, { key: 'blocks-' + selected, structure: { ...structure, format }, editable, workflows, moduleTypes: config.promptModuleTypes || [], styles: config.stylePresets || [], entries: config.promptEntries || [], definitions, renderResource, onChange: editStructure })),
            profile ? h(PromptInputEditor, { inputs: structure.inputs || [], editable, onChange: inputs => editStructure({ inputs }) }) : null,
            h('div', { style: PROMPT_FIELDS }, h('strong', null, '渠道与工作流'),
              editable ? h(PromptStructureTargets, { key: 'targets-' + selected, targets: structure.targets, options, claimed,
                onChange: targets => editStructure({ targets }) })
                : h('p', { style: STRUCTURE_MUTED }, '复制此模板后可编辑生成接口。'))),
          h('details', { className: 'dti-template-library', 'aria-label': '模板库' },
            h('summary', { className: 'dti-structure-heading' }, h('strong', null, '管理模板'), h('span', { style: STRUCTURE_MUTED }, saved.length + ' 套已保存')),
            h('div', { style: S.row, className: 'dti-template-filters' },
              h('input', { 'aria-label': '搜索模板', placeholder: '搜索模板名或项目', style: S.input, value: query, onChange: event => setQuery(event.target.value) }),
              h('select', { 'aria-label': '筛选项目', style: S.input, value: projectFilter, onChange: event => setProjectFilter(event.target.value) },
                h('option', { value: '' }, '全部项目'), h('option', { value: 'builtin' }, '内置'), h('option', { value: 'unfiled' }, '未分组'),
                projects.map(project => h('option', { key: project, value: 'project:' + project }, project)))),
            h('ul', { className: 'dti-template-list' }, catalog.length ? catalog.map(item => h('li', { key: item.id },
              h('button', { type: 'button', style: S.tab(selected === item.id), 'aria-pressed': selected === item.id,
                onClick: () => { select(item.id); setMessage('') } },
                h('strong', null, item.name || '未命名'),
                h('small', null, !item.id ? '默认' : item.scope === 'builtin' ? item.source || '内置' : item.project || '未分组'))))
              : h('li', { style: STRUCTURE_MUTED }, '没有匹配的模板')),
            h('div', { style: S.row, className: 'dti-template-filters' },
              h('button', { type: 'button', style: buttonStyle, disabled: draft.length >= limit, onClick: () => append(null, true) }, '新建空白模板')),
          editable ? h('div', { style: S.row, className: 'dti-template-filters' },
            promptField('模板名称', h('input', { 'aria-label': '预设名称', style: S.input, value: profile.name || '', maxLength: 80, onChange: event => edit({ name: event.target.value }) })),
            !isDefault ? promptField('项目', h('input', { style: S.input, list: projectListId, value: profile.project || '', placeholder: '选择或新建项目', maxLength: 60,
              onChange: event => { if (projectFilter) setProjectFilter(''); edit({ project: event.target.value }) } })) : null,
            h('datalist', { id: projectListId }, projects.map(project => h('option', { key: project, value: project })))) : null,
          h('div', { style: S.row, className: 'dti-template-filters' },
            custom && deleteRequest?.id !== selected ? h('button', { type: 'button', style: buttonStyle, onClick: () => { setDeleteRequest({ id: profile.id, name: profile.name }); setDeleteNote('') } }, '删除模板') : null,
            custom && deleteRequest?.id === selected ? h('div', { role: 'group', 'aria-label': '确认删除模板', style: S.row },
              h('span', null, '删除「' + deleteRequest.name + '」？'),
              h('button', { type: 'button', style: buttonStyle, onClick: removeTemplate }, '确认删除'),
              h('button', { type: 'button', style: buttonStyle, onClick: () => setDeleteRequest(null) }, '取消')) : null,
            deleteNote ? h('div', { role: 'status', 'aria-live': 'polite', style: STRUCTURE_MUTED }, deleteNote) : null),
          h('details', { className: 'dti-template-filters' },
            h('summary', { style: PROMPT_DISCLOSURE }, '导入与导出'),
            h('textarea', { 'aria-label': '导入预设 JSON', value: importText, style: promptArea(64), onChange: event => setImportText(event.target.value) }),
            h('div', { style: S.row },
              h('button', { type: 'button', style: buttonStyle, disabled: !importText.trim(), onClick: () => importPresets() }, '导入 JSON'),
              h('label', { style: buttonStyle }, '导入文件', h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '导入模板文件', style: { maxWidth: 170 }, onChange: async event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (file) { try { importPresets(await file.text()) } catch (error) { setMessage('导入失败：' + error.message) } }
              } })),
              profile ? h('button', { type: 'button', style: buttonStyle, onClick: () => exportPresets([profile]) }, '导出当前模板') : null,
              h('button', { type: 'button', style: buttonStyle, disabled: !draft.length, onClick: () => exportPresets() }, '导出 JSON'))))) : null,
        structureSupported ? h('details', { style: S.card, onToggle: event => setTryoutOpen(event.currentTarget.open) },
          h('summary', { style: PROMPT_DISCLOSURE }, '试写台'),
          h(PromptTryout, { open: tryoutOpen, config, options, definitions, profile, format })) : null)
    }

    function PromptTryout({ open, config, options, definitions, profile, format }) {
      const [inputs, setInputs] = React.useState({})
      const [useSubject, setUseSubject] = React.useState(false)
      const [subject, setSubject] = React.useState({})
      const [scene, setScene] = React.useState('')
      const [scenePlan, setScenePlan] = React.useState(null)
      const [targetKey, setTarget] = React.useState('')
      const [generationMode, setGenerationMode] = React.useState('')
      const [compare, setCompare] = React.useState('')
      const [usage, setUsage] = React.useState('')
      const [planning, setPlanning] = React.useState(false)
      const [plan, setPlan] = React.useState(null)
      const planRequest = React.useRef(null)
      React.useEffect(() => () => planRequest.current?.abort(), [])
      const [preview, setPreview] = React.useState(null)
      const [copied, setCopied] = React.useState('')
      const [draw, setDraw] = React.useState(null)
      const [refresh, setRefresh] = React.useState(0)
      const submitting = React.useRef(false)
      const preferred = profile?.structure?.targets?.find(item => options.some(option => option.kind === item.kind && option.id === item.id))
      const target = options.find(item => item.kind + ':' + item.id === targetKey) || (preferred && options.find(item => item.kind === preferred.kind && item.id === preferred.id))
        || options.find(item => item.kind === (config.imageBackend === 'comfyui' ? 'workflow' : 'channel') && item.id === (config.imageBackend === 'comfyui' ? config.defaultWorkflow : config.activeImageChannel))
      const sourceKey = JSON.stringify([scene, target, generationMode, usage, profile, inputs, useSubject, subject])
      const adopted = scenePlan?.sourceKey === sourceKey ? scenePlan : null
      const payload = open && config.promptWorkbench && scene.trim() ? JSON.stringify({ text: adopted?.prompts || scene, target, generationMode: generationMode || config.generationMode || 'text',
        template: profile ?? null, usage, compare, inputs, ...(useSubject ? { subjects: [subject] } : {}),
        ...(adopted ? { referenceSubjects: adopted.subjects, negative: adopted.negative || '', characters: adopted.characters, size: adopted.size } : {}) }) : ''
      React.useEffect(() => {
        if (!payload) return
        const controller = new AbortController()
        const timer = setTimeout(async () => {
          try {
            const data = await jsonFetch(BASE + '/prompt-preview', { method: 'POST', headers: { 'content-type': 'application/json' },
              body: payload, signal: controller.signal })
            if (!controller.signal.aborted) setPreview({ payload, compare, ...data })
          } catch (error) {
            if (!controller.signal.aborted) setPreview({ payload, error: String(error?.message ?? error) })
          }
        }, 320)
        return () => { clearTimeout(timer); controller.abort() }
      }, [payload, config, compare, refresh])
      async function tryPlan(forceFresh = false) {
        if (!payload || planRequest.current) return
        const controller = new AbortController()
        planRequest.current = controller
        setPlan(null)
        setPlanning(true)
        const started = performance.now()
        try {
          const result = await jsonFetch(BASE + '/prompt-plan', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...JSON.parse(payload), text: scene, sessionId: String(lastSessionId || ''), forceFresh }), signal: controller.signal })
          if (!controller.signal.aborted) {
            setPlan({ sourceKey, plans: result.plans, entryMatches: result.entryMatches, entryTrace: result.entryTrace, assembly: result.assembly, cached: result.cached, elapsedMs: Math.round(performance.now() - started) })
            const first = result.plans?.find(item => item.prompts && !item.subjectsError)
            if (first) setScenePlan({ ...first, sourceKey })
          }
        } catch (error) {
          if (!controller.signal.aborted) setPlan({ sourceKey, error: String(error?.message ?? error) })
        } finally {
          planRequest.current = null
          if (!controller.signal.aborted) setPlanning(false)
        }
      }
      const job = draw?.job
      const running = job && ['pending', 'running'].includes(job.state)
      React.useEffect(() => {
        if (!running) return
        const controller = new AbortController()
        const timer = setTimeout(async () => {
          try {
            const data = await jsonFetch(BASE + '/jobs?id=' + encodeURIComponent(job.id), { signal: controller.signal })
            if (!controller.signal.aborted) setDraw(current => ({ ...current, job: data.job, error: '' }))
          } catch (error) {
            if (!controller.signal.aborted) setDraw(current => ({ ...current, job: { ...current.job }, error: String(error?.message ?? error) }))
          }
        }, 1800)
        return () => { clearTimeout(timer); controller.abort() }
      }, [job, running])
      const ready = payload && preview?.payload === payload ? preview : null
      const shown = payload && (ready || (preview?.result ? preview : null))
      async function drawOne(runMechanism = false) {
        if (submitting.current || running || !ready?.result?.token) return
        const requestId = draw?.error && !draw.job && draw.token === ready.result.token ? draw.requestId
          : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
        const token = ready.result.token
        submitting.current = true
        setDraw({ busy: true, token, requestId })
        try {
          const data = await jsonFetch(BASE + '/prompt-tryout', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...JSON.parse(payload), token, requestId, runMechanism }) })
          setDraw({ job: data.job, jobs: data.jobs, error: data.error, token, requestId })
        } catch (error) {
          setDraw({ error: String(error?.message ?? error), token, requestId })
          setRefresh(value => value + 1)
        } finally { submitting.current = false }
      }
      const blocks = (profile?.structure?.blocks || []).filter(block => block.kind === 'section' && block.title.trim() && !scene.includes('【' + block.title.trim() + '】'))
      const people = (definitions?.characters || []).filter(item => item.enabled !== false && item.name)
      const clothes = (definitions?.outfits || []).filter(item => item.enabled !== false && item.name)
      const append = value => setScene(current => [current.trimEnd(), value].filter(Boolean).join('\n').slice(0, 8000))
      const insert = (item, kind) => {
        if (!item) return
        const macro = JSON.stringify({ name: kind === 'person' ? item.id || item.name : item.name })
        append('$' + macro + '$')
      }
      async function copyResult(result, key) {
        try {
          await navigator.clipboard.writeText(result.combined ?? [result.positive, result.negative ? 'Negative:\n' + result.negative : ''].filter(Boolean).join('\n\n'))
          setCopied(payload + key)
        } catch { setCopied('') }
      }
      function output(title, result, key) {
        const formatLabel = PROMPT_MODES_UI.find(([id]) => id === result.promptMode)?.[1]
        return h('div', { className: 'dti-tryout-output', 'aria-label': title },
          h('div', { className: 'dti-structure-heading' },
            h('strong', null, title), h('button', { type: 'button', style: buttonStyle, disabled: !ready, onClick: () => copyResult(result, key) },
              copied === payload + key ? '已复制' : '复制提示词')),
          h('div', { className: 'dti-tryout-meta' }, [result.target, formatLabel, result.template || '无模板',
            result.referenceCount ? '参考图 ' + result.referenceCount + ' 张' : '文生图'].filter(Boolean).join(' · ')),
          h('div', { className: 'dti-tryout-text' },
            h('strong', null, '正面提示词'), h('pre', null, result.positive || '空'),
            result.negative ? h('details', null, h('summary', null, '负面提示词'), h('pre', null, result.negative)) : null),
          result.combined && result.combined !== result.positive ? h('details', { className: 'dti-tryout-meta' },
            h('summary', null, '查看渠道实际发送的单段文本'), h('pre', null, result.combined)) : null,
          h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '查看组装明细'),
            h(PromptEntryMatches, { matches: result.entryMatches }), h(PromptAssemblyTrace, { result })),
          result.hits?.length ? h('div', { className: 'dti-tryout-meta' }, '人物库匹配：' + [...new Set(result.hits)].join('、')) : null)
      }
      return h('section', { className: 'dti-prompt-tryout', 'aria-label': '提示词试写台' },
        h('div', { className: 'dti-tryout-header' },
          h('strong', null, '试写台'),
          h('span', { style: STRUCTURE_MUTED }, profile?.name || '模块化模板')),
        h('div', { className: 'dti-tryout-grid' },
          h('div', { className: 'dti-tryout-inputs' },
            (profile?.structure?.inputs || []).map(input => promptField(input.label || input.key,
              h('input', { 'aria-label': '试写输入 ' + input.key, style: S.input, value: inputs[input.key] ?? input.default ?? '', maxLength: 2000,
                required: input.required, onChange: event => setInputs(current => ({ ...current, [input.key]: event.target.value })) }))),

            promptField('测试场景', h('textarea', { 'aria-label': '测试场景', style: promptArea(112), value: scene, maxLength: 8000,
              placeholder: '贴一段正文试规划，或输入场景预览提示词', onChange: event => { setScene(event.target.value); setCopied('') } })),
            h('div', { className: 'dti-tryout-controls' },
              h('button', { type: 'button', style: S.tab(true), disabled: !payload || planning, onClick: () => tryPlan() }, planning ? '生成中…' : '生成提示词'),
              plan?.sourceKey === sourceKey && !plan.error ? h('small', { role: 'status' }, (plan.elapsedMs / 1000).toFixed(2) + ' 秒' + (plan.cached ? ' · 已复用结果' : '')) : null,
              !scene.trim() ? h('select', { 'aria-label': '填入试写案例', style: S.input, value: '', onChange: event => setScene(event.target.value) },
                h('option', { value: '', disabled: true }, '填入试写案例'),
                h('option', { value: 'A traveler in a rust-colored coat waits on a rain-soaked train platform at dusk.' }, '剧情插画 · 雨夜站台'),
                h('option', { value: 'A head-and-shoulders portrait with side lighting, a plain slate backdrop, and a clearly visible silhouette.' }, '人物立绘 · 侧光半身像'),
                h('option', { value: 'A quiet teahouse interior, warm window light across empty wooden tables, wide shot.' }, '舞台背景 · 午后茶馆')) : null,
              people.length ? h('select', { 'aria-label': '插入人物', style: S.input, value: '',
                onChange: event => insert(people[Number(event.target.value)], 'person') },
                h('option', { value: '', disabled: true }, '插入人物'), people.map((item, index) => h('option', { key: index, value: index }, item.name))) : null,
              clothes.length ? h('select', { 'aria-label': '插入通用服装', style: S.input, value: '',
                onChange: event => insert(clothes[Number(event.target.value)], 'outfit') },
                h('option', { value: '', disabled: true }, '插入通用服装'), clothes.map((item, index) => h('option', { key: index, value: index }, item.name))) : null,
              (ready?.result?.promptMode || format) === 'structured' && blocks.length ? h('button', { type: 'button', style: buttonStyle,
                onClick: () => append(blocks.map(block => '【' + block.title.trim() + '】\n').join('\n')) }, '插入分节标题') : null),
            h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '更多选项'),
            h('div', { className: 'dti-tryout-controls' },
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: useSubject, onChange: event => setUseSubject(event.target.checked) }), '本次改选角色与服装'),
              useSubject ? h(PromptSubjectFields, { value: subject, definitions, onChange: patch => setSubject(current => ({ ...current, ...patch })) }) : null,
              promptField('试写目标', h('select', { 'aria-label': '试写目标', style: S.input, value: targetKey, onChange: event => setTarget(event.target.value) },
                h('option', { value: '' }, '当前生图设置'),
                options.map(item => h('option', { key: item.kind + ':' + item.id, value: item.kind + ':' + item.id },
                  (item.kind === 'workflow' ? '工作流 · ' : '') + item.label)))),
              promptField('试写模式', h('select', { 'aria-label': '试写模式', style: S.input, value: generationMode, onChange: event => setGenerationMode(event.target.value) },
                h('option', { value: '' }, '跟随设置'), h('option', { value: 'text' }, '文生图'),
                h('option', { value: 'auto' }, '自动'), h('option', { value: 'reference' }, '参考图'))),
              promptField('对照', h('select', { 'aria-label': '对照', style: S.input, value: compare, onChange: event => setCompare(event.target.value) },
                h('option', { value: '' }, '不对照'), h('option', { value: 'saved' }, '该目标已保存配置'))),
              h(PromptUsageField, { label: '试写用途', value: usage, allowAll: false, onChange: setUsage })))),
          h('div', { className: 'dti-tryout-results', 'aria-busy': Boolean(payload && !ready) },
            !config.promptWorkbench ? h('div', { className: 'dti-tryout-empty' }, '重新打开 DSH NEXT 后可使用试写。')
              : !payload ? h('div', { className: 'dti-tryout-empty' }, '填写场景后，这里会显示拼接结果。')
                : ready?.error ? h('div', { className: 'dti-tryout-empty', role: 'status' }, ready.error)
                  : h(React.Fragment, null,
                    !ready ? h('div', { className: 'dti-tryout-meta', role: 'status' }, '正在更新提示词…') : null,
                    shown?.result ? output('最终提示词', shown.result, 'draft') : null,
                    shown?.comparison && shown.compare === compare ? h(React.Fragment, null,
                        shown.result.positive === shown.comparison.positive && shown.result.negative === shown.comparison.negative && shown.result.combined === shown.comparison.combined
                          ? h('div', { className: 'dti-tryout-meta', role: 'status' }, '两边的提示词一致') : null,
                        output('已保存配置', shown.comparison, 'compare')) : null))),
        plan?.sourceKey === sourceKey ? h('details', { className: 'dti-tryout-output', 'aria-label': '模型原稿' },
          h('summary', { style: PROMPT_DISCLOSURE }, '模型原稿'),
          h(PromptEntryMatches, { matches: plan.entryMatches }),
          h(PromptAssemblyTrace, { result: plan }),
          plan.cached ? h('div', { style: S.row },
            h('span', { style: STRUCTURE_MUTED }, '已复用相同输入的规划结果'),
            h('button', { type: 'button', style: buttonStyle, onClick: () => tryPlan(true) }, '重新规划')) : null,
          plan.error ? h('p', { role: 'status' }, plan.error) : plan.plans?.map((item, index) => h('div', { key: index, className: 'dti-tryout-text' },
            h('strong', null, item.title || '规划结果'),
            item.mount ? h('div', null, '挂载句：' + item.mount) : null,
            h('pre', null, item.prompts),
            item.characters?.map((person, i) => h('pre', { key: i }, person.prompt)),
            item.subjectsError ? h('div', { role: 'status' }, item.subjectsError) : null,
            item.prompts ? h('button', { type: 'button', style: buttonStyle, disabled: Boolean(item.subjectsError), onClick: () => setScenePlan({ ...item, sourceKey }) }, '采用这张') : null))) : null,
        config.promptWorkbenchDraw && (ready?.result?.token || draw) ? h('div', { className: 'dti-tryout-inputs' },
          h('div', { className: 'dti-tryout-controls' },
            h('button', { type: 'button', style: S.tab(true), disabled: !ready?.result?.token || Boolean(draw?.busy || running), onClick: () => drawOne(false) },
              draw?.busy || running ? '正在试出图…' : '试出图'),
            profile?.structure?.blocks?.some(block => block.kind === 'mechanism' && block.enabled !== false) ? h('button', { type: 'button', style: S.tab(true), disabled: !ready?.result?.token || Boolean(draw?.busy || running), onClick: () => drawOne(true) }, '运行生成机制') : null,
            draw?.jobs?.length > 1 ? h('span', { role: 'status', style: STRUCTURE_MUTED }, '已登记 ' + draw.jobs.length + ' 张，可在游玩画廊查看进度和结果') : null,
            h('span', { style: STRUCTURE_MUTED }, '使用所选渠道，可能计费。图片保存到游玩画廊。')),
          draw?.error || job?.error ? h('div', { role: 'status', style: STRUCTURE_MUTED }, draw?.error || job.error) : null,
          job?.state === 'done' ? h('img', { src: BASE + '/jobs?id=' + encodeURIComponent(job.id) + '&image=1', alt: '试出图结果',
            style: { maxWidth: '100%', maxHeight: 420, objectFit: 'contain', justifySelf: 'start' } }) : null) : null)
    }

    function ImageOutputSettings({ config, save }) {
      const [quality, setQuality] = React.useState(null)
      const [background, setBackground] = React.useState(null)
      return h('details', { style: S.card },
        h('summary', { style: PROMPT_DISCLOSURE }, '图片输出'),
        h('label', { style: S.row }, h('input', { type: 'checkbox', checked: config.jpegOutput === true,
          onChange: event => save({ jpegOutput: event.target.checked }) }), '将 PNG 转为 JPEG'),
        config.jpegOutput ? h('div', { style: S.row },
          promptField('JPEG 质量', h('input', { type: 'number', min: 50, max: 100, style: { ...S.input, width: 85 },
            value: quality ?? config.jpegQuality ?? 88, onChange: event => setQuality(event.target.value) })),
          promptField('透明底色', h('input', { type: 'color', value: background ?? config.jpegBackground ?? '#ffffff',
            onChange: event => setBackground(event.target.value) })),
          h('button', { type: 'button', style: buttonStyle, onClick: () => save({ jpegQuality: quality ?? config.jpegQuality, jpegBackground: background ?? config.jpegBackground }) }, '保存输出设置')) : null)
    }

    function PromptIntegrationPanel({ config, cardEnabled, cardToggleBusy, cardToggleNote, toggleCardStudio }) {
      const access = config.imageIntegration || {}
      return h('div', { style: PROMPT_FIELDS },
        h('div', { style: S.card },
          h('div', { style: { fontSize: 14, fontWeight: 600 } }, '舞台与第三方插件'),
          h('div', { style: { fontSize: 12, marginTop: 6 } }, access.ready ? '可用渠道：' + access.channelName : access.reason || '当前宿主未提供生图接口'),
          access.ready ? h('div', { style: { ...STRUCTURE_MUTED, marginTop: 4 } }, '舞台使用的模板：' + (access.templateName || '无模板')) : null,
          h('details', { style: { marginTop: 10 } },
            h('summary', { style: PROMPT_DISCLOSURE }, '接入方式'),
            h('p', null, '舞台和素材工具使用 stage 用途。插件可通过服务端接口传入自定义 usage，调用时按用途和渠道选择模块。'),
            h('pre', { style: { overflow: 'auto', whiteSpace: 'pre-wrap' } }, 'await tavern.listImageModels()\nawait tavern.generateImage({ prompt, width, height })'),
            h('p', null, '服务端插件可从 dsh-tavern-image/prompts 读取模板，从 dsh-tavern-image/generation 调用 composePluginImagePrompt 预览拼接结果。'),
            h('pre', { style: { overflow: 'auto', whiteSpace: 'pre-wrap' } }, "import { composePluginImagePrompt } from 'dsh-tavern-image/generation'\ncomposePluginImagePrompt(config, { channel, prompt, usage: 'my-plugin' })"))),
        h('label', { style: { ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 } },
          '启用卡片生图', h('input', { type: 'checkbox', role: 'switch', className: 'dti-switch', 'aria-label': '启用卡片生图',
            disabled: cardToggleBusy || cardEnabled === null, checked: cardEnabled === true, onChange: event => toggleCardStudio(event.target.checked) })),
        cardToggleNote ? h('div', { role: 'status', style: STRUCTURE_MUTED }, cardToggleNote) : null)
    }

    function GenerationTemplateSettings({ config, save, onEdit }) {
      const templates = (config.promptPresets || []).filter(item => item.enabled !== false && item.structure?.blocks?.length && item.structure.purpose !== 'edit')
        .concat((config.promptPresetLibrary || []).filter(item => item.registered))
      const selected = templates.some(item => item.id === config.activePromptPreset) ? config.activePromptPreset : ''
      return h('section', { style: S.card, 'aria-label': '生图模板绑定' },
        h('div', { style: S.row }, promptField('生图使用的模板', h('select', { 'aria-label': '生图使用的模板', style: S.input,
          value: config.randomPromptTemplates ? '__random__' : selected,
          onChange: event => event.target.value === '__random__' ? save({ randomPromptTemplates: true }) : save({ activePromptPreset: event.target.value, randomPromptTemplates: false }) },
          h('option', { value: '' }, config.promptDefault?.name || '模块化模板'),
          templates.map(item => h('option', { key: item.id, value: item.id }, (item.name || '未命名模板') + (item.registered ? ' · ' + item.source : ''))),
          h('option', { value: '__random__' }, '随机模板'))),
          h('button', { type: 'button', style: buttonStyle, onClick: () => onEdit(selected) }, '编辑模板')))
    }
