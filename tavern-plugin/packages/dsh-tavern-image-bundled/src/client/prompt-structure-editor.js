    const PROMPT_BLOCK_KINDS = [['output', '生成方式'], ['section', '模型填写'], ['positive', '原样加入'], ['negative', '排除词'], ['scene', '插入场景'], ['rule', '提示词生成'], ['style', '画风'], ['entries', '词条库'], ['library', '角色与服装引用'], ['lora', 'ComfyUI LoRA'], ['mechanism', '生成机制'], ['extension', '自制 / 插件模块']]
    const PROMPT_BLOCK_LIMIT = 31
    const promptBlockLabel = kind => PROMPT_BLOCK_KINDS.find(([id]) => id === kind)?.[1]
    const STRUCTURE_MUTED = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }

    const PROMPT_USAGES = [
      ['story', '剧情与卡片配图'], ['stage', '舞台与宿主素材'], ['plugin', '直接调用生图 SDK'],
    ]

    function PromptUsageField({ label, value = '', allowAll = true, editable = true, onChange }) {
      const [customDraft, setCustomDraft] = React.useState(false)
      const custom = customDraft || (value && !PROMPT_USAGES.some(([key]) => key === value))
      return h('div', { style: { display: 'grid', gap: 4, minWidth: 0 } },
        promptField(label, h('select', { 'aria-label': label, style: S.input, value: custom ? '__custom__' : value || (allowAll ? '' : 'story'),
          disabled: !editable, onChange: event => {
            const choice = event.target.value
            setCustomDraft(choice === '__custom__')
            onChange(choice === '__custom__' ? '' : choice)
          } },
          allowAll ? h('option', { value: '' }, '所有用途') : null,
          PROMPT_USAGES.map(([key, name]) => h('option', { key, value: key }, name)),
          h('option', { value: '__custom__' }, '自定义用途'))),
        custom ? promptField('自定义用途标识', h('input', { 'aria-label': label + '标识', style: S.input, value, maxLength: 64,
          placeholder: '例如 custom-expand', readOnly: !editable, onChange: event => onChange(event.target.value) })) : null)
    }

    function PromptStyleFields({ block, styles, editable, edit }) {
      const choices = styles.filter(style => style?.enabled !== false && style?.id != null)
      const linked = choices.find(style => String(style.id) === block.styleId)
      const label = block.styleId ? '补充画风' : '画风内容'
      return h('div', { style: PROMPT_FIELDS },
        promptField('画风来源', h('select', { 'aria-label': '画风来源', style: S.input, disabled: !editable, value: block.styleId || '',
          onChange: event => edit({ styleId: event.target.value }) },
          h('option', { value: '' }, '手动填写'),
          block.styleId && !linked ? h('option', { value: block.styleId }, '原画风已不可用') : null,
          choices.map(style => h('option', { key: style.id, value: String(style.id) }, style.name || String(style.id))))),
        linked ? h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '查看原画风'),
          linked.artist ? h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, linked.artist) : null,
          linked.negative ? h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, '排除词：' + linked.negative) : null) : null,
        promptField(label, h('textarea', { 'aria-label': label, style: promptArea(64), value: block.text, readOnly: !editable, maxLength: 1000,
          onChange: event => edit({ text: event.target.value }) })))
    }

    function PromptStructureEditor({ structure, editable, workflows, styles, entries, definitions, moduleTypes = [], renderResource, onChange }) {
      const [kind, setKind] = React.useState('section')
      const [openBlock, setOpenBlock] = React.useState(null)
      const [resourceOpen, setResourceOpen] = React.useState(null)
      const [moduleNote, setModuleNote] = React.useState('')
      const drag = React.useRef(null)
      const blocks = structure.blocks
      const writeBlocks = next => {
        const output = next.find(block => block.kind === 'output')
        onChange({ blocks: next, format: output ? output.enabled === false ? 'auto' : output.format || structure.format : 'auto' })
      }
      const patchBlock = (index, patch) => writeBlocks(blocks.map((block, at) => at === index ? { ...block, ...patch } : block))
      const move = (index, destination) => {
        if (index === null || index === destination) return
        const next = [...blocks]
        const [block] = next.splice(index, 1)
        next.splice(destination, 0, block)
        writeBlocks(next)
        setOpenBlock(current => current === null ? null : next.indexOf(blocks[current]))
        setResourceOpen(null)
      }
      function exportBlock(block) {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'dsh-image-module-v1', block, inputs: structure.inputs || [] }, null, 2)], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = 'dsh-image-module.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      async function importBlock(event) {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        try {
          const data = JSON.parse(await file.text())
          if (data.format !== 'dsh-image-module-v1' || !promptBlockLabel(data.block?.kind) || !data.block.title) throw new Error('请选择导出的模块文件')
          if (blocks.length >= PROMPT_BLOCK_LIMIT) throw new Error('模块数量已达上限')
          if (['scene', 'output'].includes(data.block.kind) && blocks.some(block => block.kind === data.block.kind)) throw new Error('当前模板已有这个基础模块，请先移除再导入')
          const originalTitle = data.block.title
          for (let count = 2; blocks.some(block => block.title === data.block.title); count++) data.block.title = originalTitle.slice(0, 45) + ' ' + count
          const inputs = new Map((structure.inputs || []).map(input => [input.key, input]))
          for (const input of data.inputs || []) if (!inputs.has(input.key)) inputs.set(input.key, input)
          onChange({ blocks: [...blocks, data.block], inputs: [...inputs.values()], ...(data.block.kind === 'output' ? { format: data.block.enabled === false ? 'auto' : data.block.format || structure.format } : {}) }); setOpenBlock(blocks.length); setModuleNote('已导入模块')
        } catch (error) { setModuleNote('导入失败：' + error.message) }
      }
      const groups = [...new Set(entries.map(entry => entry.group).filter(Boolean))]
      const hasOutput = blocks.some(block => block.kind === 'output')
      const hasScene = blocks.some(block => block.kind === 'scene')
      const add = type => {
        const names = new Set(blocks.map(block => block.title))
        const base = promptBlockLabel(type)
        let title = base
        for (let suffix = 2; names.has(title); suffix++) title = base + ' ' + suffix
        const block = { kind: type, title, text: '', ...(type === 'extension' ? { moduleId: 'core.custom', values: {} } : {}), ...(type === 'output' ? { format: structure.format || 'auto' } : {}) }
        writeBlocks([...blocks, block])
        setOpenBlock(blocks.length)
      }
      return h('div', { className: 'dti-inline-structure' },
        h(PromptScenarioEditor, { structure, editable, onChange }),
        h('div', { className: 'dti-structure-heading' }, h('strong', null, '模块清单'),
          h('span', { style: STRUCTURE_MUTED }, blocks.length + ' 个模块')),
        h('ol', { className: 'dti-inline-blocks', 'aria-label': '提示词分节顺序' },
          blocks.map((block, index) => {
            const textLabel = block.kind === 'section' ? '给模型的填写要求' : ['rule', 'output'].includes(block.kind) ? '生成规则' : '固定内容'
            return h('li', { key: index, 'data-prompt-block': block.title, className: 'dti-inline-block',
            draggable: editable, onDragStart: event => {
              if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) { event.preventDefault(); return }
              drag.current = index
              event.dataTransfer.setData('text/plain', block.title)
            }, onDragEnd: () => { drag.current = null },
            onDragOver: event => { if (drag.current !== null) event.preventDefault() },
            onDrop: event => { if (drag.current !== null) { event.preventDefault(); move(drag.current, index); drag.current = null } } },
            h('details', { className: 'dti-module-disclosure', open: openBlock === index },
            h('summary', { className: 'dti-module-summary', onClick: event => { event.preventDefault(); setOpenBlock(current => current === index ? null : index); setResourceOpen(null) } },
              h('span', { className: 'dti-structure-number' }, String(index + 1).padStart(2, '0')),
              h('strong', null, block.title || '未命名模块'),
              h('span', { style: STRUCTURE_MUTED }, promptBlockLabel(block.kind) + (block.enabled === false ? ' · 已停用' : ''))),
            h('div', { className: 'dti-module-body' },
            renderResource && ['style', 'entries', 'library', 'lora', 'mechanism'].includes(block.kind)
              ? h('div', null,
                h('button', { type: 'button', style: buttonStyle, 'aria-expanded': resourceOpen === index,
                  onClick: () => setResourceOpen(current => current === index ? null : index) },
                  resourceOpen === index ? '收起引用编辑' : ['lora', 'mechanism'].includes(block.kind) ? '就地编辑工作流' : '就地编辑引用资料'),
                resourceOpen === index && openBlock === index ? h('section', { 'aria-label': '模块引用编辑', style: { ...S.card, margin: '8px 0', maxHeight: '65vh', overflow: 'auto' } },
                  renderResource(block, () => setResourceOpen(null))) : null) : null,
            h('div', { className: 'dti-inline-block-title' },
              promptField('分节名称', h('input', { style: S.input, value: block.title, readOnly: !editable, maxLength: 60,
                onChange: event => patchBlock(index, { title: event.target.value }) })),
              promptField('分节类型', h('select', { style: S.input, value: block.kind, disabled: !editable,
                onChange: event => patchBlock(index, { kind: event.target.value, ...(event.target.value === 'output' ? { format: structure.format || 'auto' } : {}), ...(event.target.value === 'scene' ? { text: '' } : {}) }) },
                PROMPT_BLOCK_KINDS.map(([key, label]) => h('option', { key, value: key, disabled: (key === 'scene' && hasScene && block.kind !== 'scene') || (key === 'output' && hasOutput && block.kind !== 'output') }, label))))),
            block.kind === 'output' ? h('div', { style: PROMPT_FIELDS },
              promptField('输出写法', h('select', { 'aria-label': '输出写法', style: S.input, value: block.format || structure.format, disabled: !editable,
                onChange: event => patchBlock(index, { format: event.target.value }) },
                PROMPT_MODES_UI.map(([id, label]) => h('option', { key: id, value: id }, label)))),
              promptField('生成规则', h('textarea', { 'aria-label': '生成规则', style: promptArea(100), value: block.text, readOnly: !editable, maxLength: 4000,
                onChange: event => patchBlock(index, { text: event.target.value }) })))
              : block.kind === 'scene' ? h('p', { style: STRUCTURE_MUTED }, '把画面描述放在这里。已有同名模块的分节按模块顺序排列。')
              : block.kind === 'mechanism' ? h('div', { style: PROMPT_FIELDS },
                promptField('生成机制', h('select', { 'aria-label': '生成机制', style: S.input, value: block.mechanism || 'fixed_seed', disabled: !editable, onChange: event => patchBlock(index, { mechanism: event.target.value }) },
                  h('option', { value: 'fixed_seed' }, '固定种子复现'), h('option', { value: 'seed_series' }, '递增种子连续出图'), h('option', { value: 'lora_sweep' }, 'LoRA 强度对照'))),
                promptField('种子', h('input', { type: 'number', 'aria-label': '机制种子', style: S.input, value: block.seed ?? '', min: 0, step: 1, placeholder: '留空随机一次', disabled: !editable, onChange: event => patchBlock(index, { seed: event.target.value === '' ? undefined : Number(event.target.value) }) })),
                block.mechanism === 'lora_sweep' ? h(React.Fragment, null,
                  h(PromptLoraFields, { block, workflows, editable, edit: patch => patchBlock(index, patch) }),
                  promptField('强度列表', h('input', { 'aria-label': '机制强度列表', style: S.input, value: block.weights ?? '0.4, 0.7, 1', disabled: !editable, onChange: event => patchBlock(index, { weights: event.target.value }) })))
                  : promptField('图片数量', h('input', { type: 'number', 'aria-label': '机制图片数量', style: S.input, value: block.count ?? 1, min: 1, max: 8, disabled: !editable, onChange: event => patchBlock(index, { count: Number(event.target.value) }) })),
                h('small', { style: STRUCTURE_MUTED }, '在试写台点“运行生成机制”执行；普通生图不会自动多出图片。'))
              : block.kind === 'extension' ? h(PromptExtensionFields, { block, moduleTypes, editable, edit: patch => patchBlock(index, patch) })
              : block.kind === 'lora' ? h(PromptLoraFields, { block, workflows, editable, edit: patch => patchBlock(index, patch) })
              : block.kind === 'style' ? h(PromptStyleFields, { block, styles, editable, edit: patch => patchBlock(index, patch) })
              : block.kind === 'library' ? h('div', { style: PROMPT_FIELDS },
                h(PromptSubjectFields, { value: block, definitions, inputs: structure.inputs || [], editable, onChange: patch => patchBlock(index, patch) }),
                promptField('引用对象', h('select', { 'aria-label': '引用对象', style: S.input, disabled: !editable, value: block.librarySource || '',
                  onChange: event => patchBlock(index, { librarySource: event.target.value }) },
                  h('option', { value: '' }, '角色和服装'),
                  h('option', { value: 'characters' }, '角色库'),
                  h('option', { value: 'outfits' }, '服装库'))),
                promptField('引用规则', h('textarea', { 'aria-label': '引用规则', style: promptArea(64), value: block.text, readOnly: !editable, maxLength: 4000,
                  placeholder: '例如：先按正文识别出场角色，再引用本场实际穿着的套装。',
                  onChange: event => patchBlock(index, { text: event.target.value }) })))
              : block.kind === 'entries' ? h('div', { style: PROMPT_FIELDS },
                promptField('引用词条分组', h('select', { 'aria-label': '引用词条分组', style: S.input, value: block.entryGroup || '', disabled: !editable,
                  onChange: event => patchBlock(index, { entryGroup: event.target.value }) },
                  h('option', { value: '' }, '所有分组'),
                  block.entryGroup && !groups.includes(block.entryGroup) ? h('option', { value: block.entryGroup }, block.entryGroup + '（当前无词条）') : null,
                  groups.map(group => h('option', { key: group, value: group }, group)))),
                h('span', { style: STRUCTURE_MUTED }, '规划时按正文匹配；直接加入提示词的词条在出图时也会匹配，保留标签串。每轮最多 32 条、16000 字符。'))
              : promptField(textLabel,
              h('textarea', { 'aria-label': textLabel, style: promptArea(64), value: block.text, readOnly: !editable, maxLength: block.kind === 'rule' ? 4000 : 1000,
                placeholder: block.kind === 'rule' ? '例如：先写人物动作，再补镜头和光线。' : undefined,
                onChange: event => patchBlock(index, { text: event.target.value }) })),
            structure.scenarios?.modes?.length ? h('fieldset', { disabled: !editable, style: { border: 0, padding: '8px 0', margin: 0 } },
              h('legend', { style: STRUCTURE_MUTED }, '在哪些模式启用（全不选表示所有模式）'),
              h('div', { style: S.row }, structure.scenarios.modes.map(mode => h('label', { key: mode.id, style: S.row },
                h('input', { type: 'checkbox', checked: block.modes?.includes(mode.id) || false, onChange: event => patchBlock(index, { modes: event.target.checked ? [...(block.modes || []), mode.id] : (block.modes || []).filter(id => id !== mode.id) }) }), mode.name)))) : null,
            h('div', { style: S.row },
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: block.enabled !== false, disabled: !editable,
                onChange: event => patchBlock(index, { enabled: event.target.checked }) }), '启用'),
              block.kind !== 'output' ? h(PromptUsageField, { key: block.title, label: '限定用途', value: block.usage, editable, onChange: usage => patchBlock(index, { usage }) }) : null),
            editable ? h('div', { style: S.row },
              h('button', { type: 'button', style: buttonStyle, disabled: index === 0, onClick: () => move(index, index - 1) }, '上移分节'),
              h('button', { type: 'button', style: buttonStyle, disabled: index === blocks.length - 1, onClick: () => move(index, index + 1) }, '下移分节'),
              h('button', { type: 'button', style: buttonStyle, onClick: () => { writeBlocks(blocks.filter((_, at) => at !== index)); setOpenBlock(null) } }, '删除分节'),
              h('button', { type: 'button', style: buttonStyle, disabled: blocks.length >= PROMPT_BLOCK_LIMIT || ['scene', 'output'].includes(block.kind), onClick: () => {
                const copy = JSON.parse(JSON.stringify(block)); copy.title = block.title.slice(0, 45) + ' 副本'; let count = 2
                while (blocks.some(item => item.title === copy.title)) copy.title = block.title.slice(0, 45) + ' 副本 ' + count++
                const next = [...blocks]; next.splice(index + 1, 0, copy); writeBlocks(next); setOpenBlock(index + 1)
              } }, '复制模块'),
              h('button', { type: 'button', style: buttonStyle, onClick: () => exportBlock(block) }, '导出模块')) : null)))
          })),
        editable ? h('div', { style: S.row },
          h('select', { 'aria-label': '新增分节类型', style: S.input, value: kind, onChange: event => setKind(event.target.value) },
            PROMPT_BLOCK_KINDS.map(([value, label]) => h('option', { key: value, value, disabled: (value === 'scene' && hasScene) || (value === 'output' && hasOutput) }, label))),
          h('button', { type: 'button', style: buttonStyle, disabled: blocks.length >= PROMPT_BLOCK_LIMIT || ((kind === 'scene' && hasScene) || (kind === 'output' && hasOutput)), onClick: () => add(kind) }, '添加分节'),
          h('label', { style: buttonStyle }, '导入模块', h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '导入模块文件', style: { maxWidth: 160 }, onChange: importBlock })),
          moduleNote ? h('span', { role: 'status', style: STRUCTURE_MUTED }, moduleNote) : null) : null)
    }

    function PromptLoraFields({ block, workflows, editable, edit }) {
      const [nodes, setNodes] = React.useState(null)
      const [names, setNames] = React.useState([])
      const [note, setNote] = React.useState('')
      const listId = React.useId()
      const workflow = workflows.find(item => item.id === block.workflowId)
      React.useEffect(() => {
        if (!workflow?.file) return
        const controller = new AbortController()
        jsonFetch(BASE + '/workflow-bindings', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: workflow.file }), signal: controller.signal }).then(data => {
          if (controller.signal.aborted) return
          const loaders = data.workflow?.bindings?.loras?.length ? data.workflow.bindings.loras : Object.entries(data.workflow?.prompt || {}).flatMap(([node, value]) =>
            typeof value.inputs?.lora_name === 'string' && typeof value.inputs?.strength_model === 'number'
              ? [{ node, name: value.inputs.lora_name }] : [])
          setNodes({ file: workflow.file, loaders })
        }).catch(error => {
          if (!controller.signal.aborted) setNodes({ file: workflow.file, error: String(error?.message || error) })
        })
        return () => controller.abort()
      }, [workflow?.file])
      const loaders = nodes?.file === workflow?.file ? nodes?.loaders : null
      const selected = block.node ? imageLoraKey(block) : ''
      const chosen = loaders?.some(item => imageLoraKey(item) === selected)
      const weight = (label, key) => promptField(label, h('input', { type: 'number', step: 0.05,
        style: S.input, value: block[key] ?? '', readOnly: !editable, placeholder: '沿用节点',
        onChange: event => edit({ [key]: event.target.value === '' ? '' : Number(event.target.value) }) }))
      async function fetchNames() {
        setNote('读取 LoRA 列表…')
        try {
          const data = await jsonFetch(BASE + '/loras-available', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          setNames(data.loras || [])
          setNote(data.loras?.length ? '' : '未读到 LoRA 列表，可以手动输入文件名。')
        } catch { setNote('无法连接 ComfyUI，可以手动输入文件名。') }
      }
      return h('div', { style: PROMPT_FIELDS },
        h('div', { style: S.row },
          promptField('LoRA 工作流', h('select', { 'aria-label': 'LoRA 工作流', style: S.input, value: block.workflowId || '', disabled: !editable,
            onChange: event => edit({ workflowId: event.target.value, node: '', slot: '' }) },
            h('option', { value: '' }, '选择工作流'),
            block.workflowId && !workflow ? h('option', { value: block.workflowId }, '原工作流已不可用') : null,
            workflows.filter(item => !item.error && item.enabled !== false).map(item => h('option', { key: item.id, value: item.id }, item.label || item.id)))),
          promptField('LoRA 节点', h('select', { 'aria-label': 'LoRA 节点', style: S.input, value: selected, disabled: !editable || !workflow,
            onChange: event => {
              const entry = loaders.find(item => imageLoraKey(item) === event.target.value)
              edit({ node: event.target.value === '__auto__' ? '__auto__' : entry?.node || '', slot: entry?.slot || '', text: block.text || entry?.name || '' })
            } },
            h('option', { value: '' }, '选择 LoRA 加载节点'),
            block.kind !== 'mechanism' ? h('option', { value: '__auto__' }, '按需添加 LoRA 节点') : null,
            selected && selected !== '__auto__' && !chosen ? h('option', { value: selected }, '槽位 ' + selected) : null,
            loaders?.map(item => h('option', { key: imageLoraKey(item), value: imageLoraKey(item) }, imageLoraKey(item) + ' · ' + item.name))))),
        workflow && (loaders?.length === 0 || nodes?.file === workflow.file && nodes?.error) ?
          h('span', { role: 'status', style: STRUCTURE_MUTED }, nodes?.error || '请先在该工作流中连接 LoRA 加载节点。') : null,
        h('div', { style: S.row },
          promptField('LoRA 文件', h('input', { 'aria-label': 'LoRA 文件', list: listId, style: S.input, value: block.text, readOnly: !editable,
            onChange: event => edit({ text: event.target.value }) })),
          editable ? h('button', { type: 'button', style: buttonStyle, onClick: fetchNames }, '读取已安装 LoRA') : null,
          h('datalist', { id: listId }, names.map(name => h('option', { key: name, value: name })))),
        note ? h('span', { role: 'status', style: STRUCTURE_MUTED }, note) : null,
        h('div', { style: S.row }, weight('模型权重', 'strengthModel'), weight('CLIP 权重', 'strengthClip')))
    }

    function PromptStructureTargets({ targets, options, claimed, onChange }) {
      const [choice, choose] = React.useState('')
      const keyOf = target => target.kind + ':' + target.id
      const current = new Set(targets.map(keyOf))
      const option = options.find(item => keyOf(item) === choice)
      const available = option && !current.has(choice) && !claimed.has(choice) && targets.length < 60
      return h('div', { className: 'dti-structure-targets' },
        h('strong', null, '绑定渠道或工作流'),
        targets.length ? h('ul', { className: 'dti-structure-target-list' }, targets.map(target => {
          const key = keyOf(target)
          const item = options.find(value => keyOf(value) === key)
          const label = item?.label || target.id + '（已不可用）'
          return h('li', { key }, h('span', null, label),
            h('button', { type: 'button', style: buttonStyle, 'aria-label': '解绑 ' + label, onClick: () => onChange(targets.filter(value => keyOf(value) !== key)) }, '解绑'))
        })) : null,
        h('div', { style: S.row },
          h('select', { 'aria-label': '绑定目标', style: { ...S.input, maxWidth: '100%' }, value: choice, onChange: event => choose(event.target.value) },
            h('option', { value: '' }, '选择渠道或工作流'),
            [['channel', '生图渠道'], ['workflow', 'ComfyUI 工作流']].map(([kind, label]) =>
              h('optgroup', { key: kind, label }, options.filter(item => item.kind === kind).map(item => {
                const key = keyOf(item)
                return h('option', { key, value: key, disabled: current.has(key) || claimed.has(key) }, item.label + (claimed.has(key) ? '（已绑定其他模板）' : ''))
              })))),
          h('button', { type: 'button', style: buttonStyle, disabled: !available, onClick: () => {
            onChange([...targets, { kind: option.kind, id: option.id }]); choose('')
          } }, '添加绑定')))
    }

    function PromptExtensionFields({ block, moduleTypes = [], editable, edit }) {
      const id = block.moduleId || 'core.custom'
      const definition = moduleTypes.find(item => item.id === id)
      const values = block.values || {}
      const change = (key, value) => edit({ values: { ...values, [key]: value } })
      function fieldControl(field) {
        const value = values[field.key] ?? field.default ?? ''
        const common = { 'aria-label': field.label, style: S.input, disabled: !editable }
        if (field.type === 'boolean') return h('label', { key: field.key, style: S.row }, h('input', { type: 'checkbox', checked: value === true, disabled: !editable, onChange: event => change(field.key, event.target.checked) }), field.label)
        const control = field.type === 'select' ? h('select', { ...common, value, onChange: event => change(field.key, event.target.value) },
          h('option', { value: '' }, '请选择'), (field.options || []).map(option => h('option', { key: option.value, value: option.value }, option.label)))
          : ['textarea', 'json'].includes(field.type) ? h('textarea', { ...common, style: promptArea(field.type === 'json' ? 64 : 80), value: typeof value === 'object' ? JSON.stringify(value, null, 2) : value,
            onChange: event => change(field.key, event.target.value) })
          : h('input', { ...common, type: field.type === 'number' ? 'number' : 'text', value, min: field.min, max: field.max, step: field.step || 'any',
            onChange: event => change(field.key, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value) })
        return h('div', { key: field.key }, promptField(field.label, control))
      }
      return h('div', { style: PROMPT_FIELDS },
        promptField('模块功能', h('select', { 'aria-label': '模块功能', style: S.input, value: id, disabled: !editable,
          onChange: event => edit({ moduleId: event.target.value, values: {} }) },
          !definition ? h('option', { value: id }, '原模块未加载') : null,
          moduleTypes.map(item => h('option', { key: item.id, value: item.id }, item.name)))),
        !definition ? h('p', { role: 'status', style: STRUCTURE_MUTED }, '请启用提供此模块的插件，原有设置会保留。') : null,
        (definition?.fields || []).filter(field => field.type !== 'json').map(fieldControl),
        definition?.fields?.some(field => field.type === 'json') ? h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '高级参数'), definition.fields.filter(field => field.type === 'json').map(fieldControl)) : null)
    }

    function PromptScenarioEditor({ structure, editable, onChange }) {
      const settings = structure.scenarios
      const update = patch => onChange({ scenarios: { ...settings, ...patch } })
      const setMode = (id, patch) => update({ modes: settings.modes.map(mode => mode.id === id ? { ...mode, ...patch } : mode) })
      return h('details', { style: S.card, 'aria-label': '场景模式设置' },
        h('summary', { style: PROMPT_DISCLOSURE }, '场景模式', settings ? ' · ' + ({ model: '模型判断', keywords: '关键词判断', fixed: '固定模式' }[settings.policy]) : ' · 未启用'),
        h('p', { style: STRUCTURE_MUTED }, '先判断本次场景，再启用对应模块。画风、词条、角色引用、排除词与插件模块均可限定模式。'),
        h('label', { style: S.row }, h('input', { type: 'checkbox', 'aria-label': '启用场景模式', disabled: !editable, checked: !!settings,
          onChange: event => onChange({ scenarios: event.target.checked ? { policy: 'keywords', fallback: 'normal', fixed: 'normal', modes: [
            { id: 'normal', name: '普通', description: '日常、对话、冒险等普通画面。', keywords: [] },
            { id: 'nsfw', name: 'NSFW', description: '正文当前画面明确涉及成人裸露或性内容。', keywords: ['nsfw', 'NSFW场景'] },
          ] } : null }) }), '启用场景模式'),
        settings ? h('div', { style: PROMPT_FIELDS },
          promptField('判断方式', h('select', { 'aria-label': '场景判断方式', style: S.input, disabled: !editable, value: settings.policy, onChange: event => update({ policy: event.target.value }) },
            h('option', { value: 'keywords' }, '关键词规则（按列表顺序匹配）'), h('option', { value: 'model' }, '模型自行判断'), h('option', { value: 'fixed' }, '固定使用指定模式'))),
          promptField(settings.policy === 'fixed' ? '固定场景模式' : '未命中时使用', h('select', { 'aria-label': '默认场景模式', style: S.input, disabled: !editable, value: settings.policy === 'fixed' ? settings.fixed : settings.fallback,
            onChange: event => update({ [settings.policy === 'fixed' ? 'fixed' : 'fallback']: event.target.value }) }, settings.modes.map(mode => h('option', { key: mode.id, value: mode.id }, mode.name)))),
          settings.policy === 'model' ? h('small', { style: STRUCTURE_MUTED }, '每次规划前调用当前后台文字模型判断一次；同批出图沿用判断结果。') : null,
          settings.modes.map(mode => h('fieldset', { key: mode.id, disabled: !editable, style: { ...S.card, margin: 0 } },
            promptField('模式名称', h('input', { 'aria-label': '模式名称 ' + mode.id, style: S.input, maxLength: 60, value: mode.name, onChange: event => setMode(mode.id, { name: event.target.value }) })),
            promptField('判断说明', h('textarea', { 'aria-label': '模式判断说明 ' + mode.id, style: promptArea(60), maxLength: 1000, value: mode.description || '', placeholder: '告诉模型什么画面属于这个模式', onChange: event => setMode(mode.id, { description: event.target.value }) })),
            promptField('触发词（逗号分隔）', h('input', { 'aria-label': '模式触发词 ' + mode.id, style: S.input, value: (mode.keywords || []).join('，'), placeholder: '例如：nsfw，成人场景', onChange: event => setMode(mode.id, { keywords: event.target.value.split(/[,，\n]/) }) })),
            h('button', { type: 'button', style: buttonStyle, disabled: settings.modes.length < 2, onClick: () => {
              const modes = settings.modes.filter(item => item.id !== mode.id)
              onChange({ scenarios: { ...settings, modes, fallback: settings.fallback === mode.id ? modes[0].id : settings.fallback, fixed: settings.fixed === mode.id ? modes[0].id : settings.fixed },
                blocks: structure.blocks.map(block => ({ ...block, modes: block.modes?.filter(id => id !== mode.id) })) })
            } }, '删除模式'))),
          h('button', { type: 'button', style: buttonStyle, disabled: !editable || settings.modes.length >= 20, onClick: () => update({ modes: [...settings.modes, { id: 'mode-' + crypto.randomUUID().slice(0, 8), name: '自定义模式', description: '', keywords: [] }] }) }, '添加场景模式')) : null)
    }
