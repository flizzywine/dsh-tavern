    const workflowFieldKey = ({ node, input }) => JSON.stringify([String(node), String(input)])
    const workflowFieldLabel = field => '#' + field.node + ' ' + field.title + ' · ' + field.input
    const workflowInputMatches = (field, query) => [field.node, field.title, field.classType, field.input, field.type]
      .some(value => String(value).toLowerCase().includes(query))

    function WorkflowInputPanel({ workflow, fields = [], onSave, onOpenGraph }) {
      const [query, setQuery] = React.useState('')
      const [selected, select] = React.useState('')
      const [text, setText] = React.useState('')
      const [manual, setManual] = React.useState(false)
      const [adding, setAdding] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const search = query.trim().toLowerCase()
      const strings = fields.filter(field => field.editable && typeof workflow.prompt[field.node]?.inputs?.[field.input] === 'string')
      const images = strings.filter(field => field.image)
      const textFields = strings.filter(field => field.text && !field.image)
      const current = strings.find(field => workflowFieldKey(field) === selected)
      const configured = workflow.bindings?.referenceImages || []
      const rows = configured.length ? configured : images.length === 1 ? [images[0]] : []
      const imageCandidates = strings.filter(field => manual || field.image || rows.some(item => workflowFieldKey(item) === workflowFieldKey(field)))
      const matches = fields.filter(field => workflowInputMatches(field, search))
      async function save(patch) {
        if (busy) return
        setBusy(true)
        setNote('')
        try {
          const result = await onSave(patch)
          if (!patch) setNote(result.discovery?.recognized
            ? '识别 ' + result.discovery.recognized + ' 种节点' + (result.discovery.unavailable.length ? '，' + result.discovery.unavailable.length + ' 种未返回定义' : '')
            : 'ComfyUI 未返回节点定义，可按工作流里的字段手动设置。')
          else setNote('已保存')
          return true
        } catch (error) {
          setNote(String(error?.message ?? error))
          return false
        } finally { setBusy(false) }
      }
      function addToken(token) {
        setText(currentText => currentText.includes(token) ? currentText : [currentText, token].filter(Boolean).join('\n'))
      }
      const available = imageCandidates.filter(field => !rows.some(item => workflowFieldKey(item) === workflowFieldKey(field)))
      async function changeReference(value, index) {
        const field = imageCandidates.find(item => workflowFieldKey(item) === value)
        if (!field) return
        const bindings = rows.map(({ node, input }) => ({ node, input }))
        bindings[index] = { node: field.node, input: field.input }
        if (await save({ bindings: { referenceImages: bindings } })) setAdding(false)
      }
      return h('section', { style: { ...PROMPT_FIELDS, marginBlock: 12 }, 'aria-label': '工作流节点输入' },
        h('div', { style: S.row },
          h('strong', null, '节点输入'),
          h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: () => save() }, busy ? '处理中…' : '自动识别'),
          h('button', { type: 'button', 'aria-label': '打开节点图', style: buttonStyle, onClick: onOpenGraph }, '可视化编辑')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12 } },
          h('span', null, '提示词：' + (workflow.bindings?.positive?.length ? '已接入' : '待识别')),
          h('span', null, '输入图片：' + (rows.length ? rows.length + ' 个入口' : '无')),
          h('span', null, 'LoRA：' + (workflow.bindings?.loras?.filter(item => item.enabled !== false).length || 0) + ' 个启用')),
        h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '手动调整接入'),
        h('input', { 'aria-label': '搜索节点或字段', placeholder: '搜索节点名称、编号或字段', style: S.input, value: query, onChange: event => setQuery(event.target.value) }),
        h('details', null,
          h('summary', { style: PROMPT_DISCLOSURE }, '提示词输入'),
          h('div', { style: PROMPT_FIELDS },
            promptField('提示词节点字段', h('select', { 'aria-label': '提示词节点字段', style: S.input, value: selected, disabled: busy, onChange: event => {
              const field = textFields.find(item => workflowFieldKey(item) === event.target.value)
              select(event.target.value)
              setText(field ? workflow.prompt[field.node].inputs[field.input] : '')
            } }, h('option', { value: '' }, '选择文字字段'),
            textFields.filter(field => workflowFieldKey(field) === selected || workflowInputMatches(field, search)).map(field =>
              h('option', { key: workflowFieldKey(field), value: workflowFieldKey(field) }, workflowFieldLabel(field))))),
            current ? h(React.Fragment, null,
              promptField('节点文字', h('textarea', { 'aria-label': '节点文字', style: promptArea(72), value: text, disabled: busy,
                maxLength: 100000, onChange: event => setText(event.target.value) })),
              h('div', { style: S.row },
                ['%prompt', '%negative'].map(token => h('button', { key: token, type: 'button', style: buttonStyle, disabled: busy, onClick: () => addToken(token) }, '插入 ' + token)),
                h('button', { type: 'button', style: S.tab(true), disabled: busy, onClick: () => save({ textFields: [{ node: current.node, input: current.input, text }] }) }, '保存节点文字'))) : null)),
        h('details', null,
          h('summary', { style: PROMPT_DISCLOSURE }, '参考图接入顺序'),
          h('div', { style: PROMPT_FIELDS },
            !configured.length && images.length > 1 ? h('div', { style: STRUCTURE_MUTED }, '尚未保存明确映射；多个接图节点时不会猜测参考图用途。') : null,
            [...rows, ...(adding ? [null] : [])].map((binding, index) => h('div', { key: index, style: S.row },
              promptField('参考图 ' + (index + 1), h('select', { 'aria-label': '参考图 ' + (index + 1) + ' 接入节点', style: S.input,
                value: binding ? workflowFieldKey(binding) : '', disabled: busy, onChange: event => changeReference(event.target.value, index) },
                !binding ? h('option', { value: '' }, '选择接图字段') : null,
                imageCandidates.filter(field => workflowInputMatches(field, search) || rows.some(item => workflowFieldKey(item) === workflowFieldKey(field)))
                  .map(field => h('option', { key: workflowFieldKey(field), value: workflowFieldKey(field),
                    disabled: rows.some((item, at) => at !== index && workflowFieldKey(item) === workflowFieldKey(field)) }, workflowFieldLabel(field))))),
              binding && configured.length ? h('button', { type: 'button', style: buttonStyle, disabled: busy,
                onClick: () => save({ bindings: { referenceImages: rows.filter((_, at) => at !== index).map(({ node, input }) => ({ node, input })) } }) }, '移除') : null)),
            h('div', { style: S.row },
              available.length ? h('button', { type: 'button', style: buttonStyle, disabled: busy || adding, onClick: () => setAdding(true) }, '＋ 添加接入节点') : null,
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: manual, onChange: event => setManual(event.target.checked) }), '显示手动接图字段')))),
        h('details', null,
          h('summary', { style: PROMPT_DISCLOSURE }, '输入清单 · ' + matches.length),
          h('ul', { style: { maxHeight: 240, overflow: 'auto', paddingInlineStart: 20 } }, matches.map(field =>
            h('li', { key: workflowFieldKey(field) }, workflowFieldLabel(field) + ' · ' + field.type
              + (field.linked ? ' ← #' + field.source + ' 输出 ' + field.output : field.image ? ' · 图片加载' : ''))))),
        ),
        note ? h('div', { role: 'status', style: STRUCTURE_MUTED }, note) : null)
    }
