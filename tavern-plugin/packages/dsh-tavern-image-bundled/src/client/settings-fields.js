    const S = {
      surface: { background: 'transparent', color: 'var(--dsw-alias-label-primary)' },
      row: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' },
      label: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', minWidth: '92px' },
      input: { backgroundColor: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '7px 10px', fontSize: '13px', lineHeight: '18px' },
      card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '12px 14px', margin: '10px 0', background: 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 2%, transparent)' },
      tab: (on) => ({ padding: '5px 13px', borderRadius: '8px', border: '1px solid ' + (on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'), background: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 4%, transparent)', color: on ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '13px' }),
      badge: (ok) => ({ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)', marginRight: '6px' }),
    }

    // 设置页的原生控件统一外观：自画下拉箭头、焦点用强调色描边（行内样式管不到伪类和 appearance）。
    const SETTINGS_CSS = `
.dti-settings select { appearance: none; -webkit-appearance: none; padding-right: 30px !important; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%238a8f98' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center; text-overflow: ellipsis; }
.dti-settings select:disabled { cursor: default; opacity: .6; }
.dti-settings select:focus, .dti-settings input:focus, .dti-settings textarea:focus { outline: none;
  border-color: var(--dsw-alias-brand-primary) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.dti-settings input[type=checkbox] { accent-color: var(--dsw-alias-brand-primary); }
.dti-switch { appearance: none; -webkit-appearance: none; flex-shrink: 0; width: 36px; height: 20px; margin: 0; border-radius: 10px; cursor: pointer; position: relative;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 35%, transparent); transition: background .15s; }
.dti-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s; }
.dti-switch:checked { background: var(--dsw-alias-brand-primary); }
.dti-switch:checked::after { transform: translateX(16px); }
.dti-field-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.dti-field-label small { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
`

    function WorkflowGraphEditor(props) {
      const file = String(props?.file || '')
      const post = props?.post
      const [raw, setRaw] = React.useState(null)
      const [revision, setRevision] = React.useState('')
      const [draft, setDraft] = React.useState({})
      const [positions, setPositions] = React.useState({})
      const [selected, setSelected] = React.useState('')
      const [view, setView] = React.useState({ x: 36, y: 36, scale: 1 })
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [drag, setDrag] = React.useState(null)
      const canvasRef = React.useRef(null)
      const initialPositions = React.useRef({})
      const nodeWidth = 280
      const colors = { prompt: '#54c6eb', sampler: '#ec8c42', model: '#b87bec', image: '#59cf8a', decode: '#66a9f5', other: '#d5ac5b' }

      React.useEffect(() => {
        let alive = true
        setRaw(null); setError(''); setSelected(''); setDraft({}); setPositions({})
        Promise.resolve(post('/workflow-graph', { file })).then(result => {
          if (!alive) return
          if (!result?.ok || !result?.workflow?.prompt) throw new Error(result?.error || '工作流格式不正确')
          const workflow = result.workflow
          const ids = Object.keys(workflow.prompt)
          const stored = workflow.graphPositions && typeof workflow.graphPositions === 'object' ? workflow.graphPositions : {}
          const depth = Object.fromEntries(ids.map(id => [id, 0]))
          const indegree = Object.fromEntries(ids.map(id => [id, 0]))
          const outgoing = Object.fromEntries(ids.map(id => [id, []]))
          for (const target of ids) for (const value of Object.values(workflow.prompt[target]?.inputs || {})) {
            if (Array.isArray(value) && value.length >= 2 && Object.hasOwn(workflow.prompt, String(value[0]))) {
              const source = String(value[0]); outgoing[source].push(target); indegree[target] += 1
            }
          }
          const queue = ids.filter(id => indegree[id] === 0)
          for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const source = queue[cursor]
            for (const target of outgoing[source]) {
              depth[target] = Math.max(depth[target], depth[source] + 1)
              indegree[target] -= 1
              if (indegree[target] === 0) queue.push(target)
            }
          }
          const maxDepth = Math.max(0, ...Object.values(depth))
          const layerOrder = {}
          for (const id of ids) {
            const layer = indegree[id] > 0 ? maxDepth + 1 + (ids.indexOf(id) % 2) : depth[id]
            ;(layerOrder[layer] ||= []).push(id)
          }
          const layout = {}
          const defaultPositions = {}
          for (const [layer, layerIds] of Object.entries(layerOrder)) layerIds.forEach((id, row) => {
            defaultPositions[id] = { x: 80 + Number(layer) * 370, y: 70 + row * 245 }
          })
          ids.forEach(id => {
            const position = stored[id]
            layout[id] = position && Number.isFinite(position.x) && Number.isFinite(position.y)
              ? { x: position.x, y: position.y }
              : defaultPositions[id]
          })
          initialPositions.current = JSON.parse(JSON.stringify(layout))
          setPositions(layout)
          setRevision(String(result.revision || ''))
          setRaw(workflow)
          setView({ x: 36, y: 36, scale: 1 })
        }).catch(e => { if (alive) setError('工作流读取失败：' + String(e?.message ?? e)) })
        return () => { alive = false }
      }, [file])

      const nodes = raw?.prompt || {}
      const ids = Object.keys(nodes)
      const links = []
      ids.forEach(targetId => Object.entries(nodes[targetId]?.inputs || {}).forEach(([field, value]) => {
        if (Array.isArray(value) && value.length >= 2 && Object.hasOwn(nodes, String(value[0]))) links.push({ source: String(value[0]), target: targetId, field })
      }))
      function nodeColor(classType) {
        const name = String(classType || '').toLowerCase()
        if (/clip|text|prompt|conditioning/.test(name)) return colors.prompt
        if (/sampler|scheduler/.test(name)) return colors.sampler
        if (/checkpoint|lora|model/.test(name)) return colors.model
        if (/save|preview|image|latent/.test(name)) return colors.image
        if (/decode|vae/.test(name)) return colors.decode
        return colors.other
      }
      function inputValue(nodeId, field, value) {
        const draftValue = draft[nodeId]?.[field]
        return draftValue === undefined ? String(value ?? '') : String(draftValue)
      }
      function isDirty() {
        if (!raw) return false
        for (const id of ids) {
          for (const [field, value] of Object.entries(nodes[id]?.inputs || {})) {
            if (Array.isArray(value) || (value !== null && typeof value === 'object')) continue
            const changed = draft[id]?.[field]
            if (changed !== undefined && String(changed) !== String(value ?? '')) return true
          }
          const original = initialPositions.current[id]
          const current = positions[id]
          if (original && current && (original.x !== current.x || original.y !== current.y)) return true
        }
        return false
      }
      function close() {
        if (busy) return
        if (isDirty() && !confirm('有未保存的工作流修改，确定关闭吗？')) return
        props?.onClose?.()
      }
      function setField(nodeId, field, value) {
        if (busy) return
        setDraft(current => Object.assign({}, current, { [nodeId]: Object.assign({}, current[nodeId], { [field]: value }) }))
      }
      function changeZoom(amount) {
        setView(current => Object.assign({}, current, { scale: Math.max(0.2, Math.min(2.5, current.scale + amount)) }))
      }
      function resetView() {
        setView({ x: 36, y: 36, scale: 1 })
      }
      function fitView() {
        const box = canvasRef.current
        if (!box || !ids.length) { resetView(); return }
        const xs = ids.map(id => positions[id]?.x ?? 0), ys = ids.map(id => positions[id]?.y ?? 0)
        const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys)
        const scale = Math.max(0.2, Math.min(1.4, Math.min((box.clientWidth - 70) / (maxX - minX + nodeWidth + 80), (box.clientHeight - 70) / (maxY - minY + 180))))
        setView({ x: 35 - minX * scale, y: 35 - minY * scale, scale })
      }
      function beginDrag(event, id) {
        if (busy) return
        if (event.button !== undefined && event.button !== 0) return
        event.preventDefault?.()
        setSelected(id)
        setDrag({ kind: 'node', id, startX: event.clientX, startY: event.clientY, origin: positions[id] || { x: 0, y: 0 } })
      }
      function beginPan(event) {
        if (event.target !== event.currentTarget || (event.button !== undefined && event.button !== 0)) return
        setDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, origin: { x: view.x, y: view.y } })
      }
      function movePointer(event) {
        if (busy || !drag) return
        const dx = (event.clientX - drag.startX) / (drag.kind === 'node' ? view.scale : 1)
        const dy = (event.clientY - drag.startY) / (drag.kind === 'node' ? view.scale : 1)
        if (drag.kind === 'node') setPositions(current => Object.assign({}, current, { [drag.id]: { x: Math.max(-100000, Math.min(100000, drag.origin.x + dx)), y: Math.max(-100000, Math.min(100000, drag.origin.y + dy)) } }))
        else setView(current => Object.assign({}, current, { x: drag.origin.x + dx, y: drag.origin.y + dy }))
      }
      function save() {
        if (!raw || busy) return
        const inputs = {}
        for (const [id, fields] of Object.entries(draft)) {
          for (const [field, typed] of Object.entries(fields)) {
            const original = nodes[id]?.inputs?.[field]
            if (typeof original === 'string') {
              if (String(typed) !== original) (inputs[id] ||= {})[field] = String(typed)
            } else if (typeof original === 'number') {
              if (String(typed).trim() === '') { setError('数字参数不能为空。'); return }
              const number = Number(typed)
              if (Number.isFinite(number) && number !== original) (inputs[id] ||= {})[field] = number
              else if (!Number.isFinite(number)) { setError('请输入有效数字后再保存。'); return }
            } else if (typeof original === 'boolean') {
              const bool = typed === true || typed === 'true'
              if (bool !== original) (inputs[id] ||= {})[field] = bool
            }
          }
        }
        const moved = {}
        for (const [id, position] of Object.entries(positions)) {
          const before = initialPositions.current[id]
          if (!before || before.x !== position.x || before.y !== position.y) moved[id] = { x: position.x, y: position.y }
        }
        setBusy(true); setError('')
        Promise.resolve(post('/workflow-graph', { file, patch: { inputs, positions: moved }, revision })).then(result => {
          if (!result?.ok) throw new Error(result?.error || '保存失败')
          const workflow = result.workflow || raw
          setRaw(workflow); setRevision(String(result.revision || revision)); setDraft({})
          initialPositions.current = JSON.parse(JSON.stringify(positions))
          props?.onSaved?.(workflow)
        }).catch(e => setError('保存失败：' + String(e?.message ?? e))).finally(() => setBusy(false))
      }
      const chosen = nodes[selected]
      const primitiveFields = chosen ? Object.entries(chosen.inputs || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null) : []
      const typeStyle = type => ({ borderLeft: '4px solid ' + nodeColor(type) })
      const button = { background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px' }
      return h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '工作流可视化编辑器', style: { position: 'fixed', inset: 0, zIndex: 2147483200, display: 'flex', flexDirection: 'column', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'system-ui, sans-serif' } },
        h('header', { style: { minHeight: '58px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-specific-input-major)' } },
          h('strong', { style: { fontSize: '15px', flex: 1 } }, '节点工作流 · ' + file.split(/[\\/]/).pop()),
          h('span', { role: 'status', style: { color: isDirty() ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, isDirty() ? '● 有未保存修改' : (raw ? ids.length + ' 节点 · ' + links.length + ' 连线' : '读取中…')),
          h('button', { type: 'button', 'aria-label': '缩小', disabled: busy, style: button, onClick: () => changeZoom(-0.15) }, '−'),
          h('button', { type: 'button', 'aria-label': '放大', disabled: busy, style: button, onClick: () => changeZoom(0.15) }, '+'),
          h('button', { type: 'button', 'aria-label': '适配画布', disabled: busy, style: button, onClick: fitView }, '适配'),
          h('button', { type: 'button', 'aria-label': '重置视图', disabled: busy, style: button, onClick: resetView }, '重置'),
          h('button', { type: 'button', 'aria-label': '保存工作流图', disabled: !raw || !isDirty() || busy, style: Object.assign({}, button, { background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)', borderColor: 'var(--dsw-alias-state-success-primary)', opacity: !raw || !isDirty() || busy ? 0.55 : 1 }), onClick: save }, busy ? '保存中…' : '保存'),
          h('button', { type: 'button', 'aria-label': '关闭工作流图', disabled: busy, style: Object.assign({}, button, { borderColor: 'var(--dsw-alias-state-error-primary)', opacity: busy ? 0.55 : 1 }), onClick: close }, '关闭 ×'),
        ),
          h('div', { style: { minHeight: 0, flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 28vw)' } },
          h('div', { ref: canvasRef, role: 'application', 'aria-label': '工作流节点画布', onMouseDown: event => { if (!busy) beginPan(event) }, onMouseMove: movePointer, onMouseUp: () => setDrag(null), onMouseLeave: () => setDrag(null), onWheel: event => { event.preventDefault?.(); if (!busy) changeZoom(event.deltaY < 0 ? 0.08 : -0.08) }, style: { position: 'relative', overflow: 'hidden', cursor: drag?.kind === 'pan' ? 'grabbing' : 'grab', backgroundColor: 'var(--dsw-specific-input-major)', backgroundImage: 'radial-gradient(var(--dsw-specific-input-major) 1px, transparent 1px)', backgroundSize: '22px 22px' } },
            error ? h('div', { role: 'alert', style: { position: 'absolute', zIndex: 4, top: '12px', left: '12px', color: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-specific-input-major)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px', padding: '8px 12px', fontSize: '12px' } }, error) : null,
            raw ? h('div', { style: { position: 'absolute', left: 0, top: 0, transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')', transformOrigin: '0 0' } },
              h('svg', { 'aria-hidden': 'true', width: 1, height: 1, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' } },
                h('defs', null, h('marker', { id: 'workflow-graph-arrow', markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto', markerUnits: 'strokeWidth' }, h('path', { d: 'M0,0 L0,6 L7,3 z', fill: 'var(--dsw-alias-label-tertiary)' }))),
                links.map((link, index) => {
                  const from = positions[link.source] || { x: 0, y: 0 }, to = positions[link.target] || { x: 0, y: 0 }
                  const x1 = from.x + nodeWidth, y1 = from.y + 56, x2 = to.x, y2 = to.y + 56, curve = Math.max(50, Math.abs(x2 - x1) * 0.45)
                  return h('path', { key: index, d: 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + curve) + ' ' + y1 + ', ' + (x2 - curve) + ' ' + y2 + ', ' + x2 + ' ' + y2, fill: 'none', stroke: 'var(--dsw-alias-label-tertiary)', strokeWidth: 2.2, opacity: 0.9, markerEnd: 'url(#workflow-graph-arrow)' })
                })),
              ids.map((id, index) => {
                const node = nodes[id], position = positions[id] || { x: 0, y: 0 }, classType = node.class_type || '未知节点'
                const primitiveCount = Object.values(node.inputs || {}).filter(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)).length
                return h('div', { key: id, role: 'button', tabIndex: 0, 'aria-label': '节点 ' + id + ' ' + classType, onClick: () => setSelected(id), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); setSelected(id) } }, onMouseDown: event => { if (!busy) beginDrag(event, id) }, onMouseMove: movePointer, onMouseUp: () => setDrag(null), style: { position: 'absolute', left: position.x, top: position.y, width: nodeWidth, boxSizing: 'border-box', border: '1px solid ' + (selected === id ? 'var(--dsw-alias-label-primary)' : nodeColor(classType)), borderRadius: '9px', background: 'var(--dsw-specific-input-major)', boxShadow: selected === id ? '0 0 0 2px color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent), 0 8px 24px #0009' : '0 6px 18px #0008', overflow: 'hidden', cursor: drag?.id === id ? 'grabbing' : 'grab' } },
                  h('div', { style: Object.assign({ padding: '9px 11px', background: 'var(--dsw-specific-input-major)', fontWeight: 650, fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }, typeStyle(classType)) }, h('span', null, classType), h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontWeight: 400 } }, '#' + id)),
                  h('div', { style: { padding: '8px 11px', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', lineHeight: '1.5' } }, primitiveCount ? primitiveCount + ' 个可编辑参数' : '参数由连线提供', node._meta?.title ? h('div', { style: { marginTop: '3px', color: 'var(--dsw-alias-label-tertiary)' } }, node._meta.title) : null),
                )
              }),
            ) : h('div', { style: { padding: '24px', color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } }, error || '正在读取工作流…'),
          ),
          h('aside', { style: { overflowY: 'auto', borderLeft: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-specific-input-major)', padding: '16px', color: 'var(--dsw-alias-label-primary)' } },
            h('div', { style: { fontSize: '13px', fontWeight: 700, marginBottom: '12px' } }, chosen ? '节点检查器' : '选择一个节点'),
            chosen ? h('div', null,
              h('div', { style: { padding: '10px', borderRadius: '8px', background: 'var(--dsw-specific-input-major)', borderLeft: '4px solid ' + nodeColor(chosen.class_type), marginBottom: '12px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 650 } }, chosen._meta?.title || chosen.class_type || '未知节点'),
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '4px' } }, '节点 #' + selected + ' · ' + Object.keys(chosen.inputs || {}).length + ' 个输入')),
              h('div', { style: { fontSize: '11px', lineHeight: 1.5, color: 'var(--dsw-alias-state-warning-primary)', background: 'var(--dsw-specific-input-major)', padding: '8px', borderRadius: '7px', marginBottom: '12px' } }, '提示：绑定的正面、负面、种子和尺寸会被生成设置覆盖。'),
              primitiveFields.length ? primitiveFields.map(([field, value]) => h('label', { key: field, style: { display: 'block', margin: '0 0 12px', fontSize: '11px', color: 'var(--dsw-alias-label-primary)' } },
                h('span', { style: { display: 'block', marginBottom: '5px', color: 'var(--dsw-alias-label-secondary)' } }, field + ' · ' + (typeof value === 'boolean' ? '布尔' : typeof value === 'number' ? '数字' : '文本')),
                value === null ? h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontStyle: 'italic' } }, '空值（只读）') : typeof value === 'boolean'
                  ? h('input', { type: 'checkbox', disabled: busy, 'aria-label': field, checked: draft[selected]?.[field] === undefined ? value : (draft[selected][field] === true || draft[selected][field] === 'true'), onChange: event => setField(selected, field, event.target.checked) })
                  : h(typeof value === 'string' && value.length > 100 ? 'textarea' : 'input', { type: typeof value === 'number' ? 'number' : 'text', disabled: busy, 'aria-label': field, value: inputValue(selected, field, value), onChange: event => setField(selected, field, event.target.value), style: { width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: busy ? 'var(--dsw-specific-input-major)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', minHeight: typeof value === 'string' && value.length > 100 ? '84px' : '34px' } }),
              )) : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, '此节点没有可编辑的普通参数。'),
              h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: '12px', marginTop: '10px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                '已有连线（只读）',
                links.filter(link => link.target === selected || link.source === selected).map((link, i) => h('div', { key: i, style: { marginTop: '6px', color: 'var(--dsw-alias-label-primary)' } }, link.source + ' → ' + link.target + ' · ' + link.field))),
            ) : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: 1.6 } }, '点选画布中的节点查看参数。可拖动节点调整布局，滚轮缩放，拖动画布空白处平移。'),
            error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', marginTop: '12px' } }, error) : null,
          ),
        ),
      )
    }

    /** One local reference per library object; binding is saved with the existing draft.
     *  field='characterOutfitImage' edits a character's own outfit sheet (角色×服装设定图), sharing the outfit's 一致性补充. */
    function ReferenceImageEditor({ value = {}, label, onChange, field = 'referenceImage', noun = '参考图', heading = '（每个对象一张）', consistency = true }) {
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const epoch = React.useRef(0)
      React.useEffect(() => () => { epoch.current += 1 }, [])
      const image = value[field]
      const imageId = /^[a-f0-9]{64}$/i.test(String(image?.id || '')) ? image.id : ''
      const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '7px', background: 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', fontFamily: 'inherit', fontSize: '12px' }
      async function upload(event) {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        const request = ++epoch.current
        const mediaType = file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' })[String(file.name).split('.').pop().toLowerCase()]
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType)) { setBusy(false); setNote('请选择 PNG、JPEG 或 WebP 图片'); return }
        if (!file.size || file.size > 32 * 1024 * 1024) { setBusy(false); setNote('参考图不能为空，且每张不能超过 32 MiB'); return }
        setBusy(true)
        setNote('正在上传参考图…')
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result || ''))
            reader.onerror = () => reject(new Error('无法读取这张图片'))
            reader.readAsDataURL(file)
          })
          if (request !== epoch.current) return
          const result = await jsonFetch(BASE + '/reference-image', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data, mediaType, name: file.name }),
          })
          if (request !== epoch.current) return
          if (!result?.ok || !/^[a-f0-9]{64}$/i.test(String(result.referenceImage?.id || ''))) throw new Error(result?.error || '服务器没有返回有效的参考图')
          onChange({ [field]: result.referenceImage })
          setNote('参考图已加入草稿，请保存人物库／服装库')
        } catch (error) {
          if (request === epoch.current) setNote('上传失败：' + (error?.message || error))
        } finally { if (request === epoch.current) setBusy(false) }
      }
      return h('section', { 'aria-label': label + noun + '设置', style: { padding: '10px', margin: '10px 0', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '9px' } },
        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, label + noun + heading),
        imageId ? h('img', { src: BASE + '/reference-image?id=' + encodeURIComponent(imageId), alt: label + noun, style: { display: 'block', maxWidth: '180px', maxHeight: '160px', objectFit: 'contain', borderRadius: '7px', marginBottom: '7px' } }) : null,
        imageId ? h('div', { style: { fontSize: '11px', overflowWrap: 'anywhere', marginBottom: '6px' } }, image.name || '已上传参考图') : null,
        h('label', { style: { display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } }, busy ? '上传中…' : imageId ? '替换' + noun : '上传' + noun,
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': label + '上传' + noun, disabled: busy, onChange: upload, style: { maxWidth: '100%' } })),
        imageId || busy ? h('button', { type: 'button', 'aria-label': label + '移除' + noun, style: { marginLeft: '8px', fontSize: '12px' }, onClick: () => {
          epoch.current += 1
          setBusy(false)
          onChange({ [field]: null })
          setNote('已从草稿解绑，保存后生效；历史参考图不会删除')
        } }, '移除') : null,
        consistency ? h('label', { style: { display: 'block', fontSize: '12px', marginTop: '8px' } }, '一致性补充（可选）',
          h('textarea', { 'aria-label': label + '一致性补充', value: value.consistencyText || '', rows: 2, placeholder: '补充需要保持的特征；动作、背景及正文明确的变化仍以剧情为准', style: inputStyle, onChange: event => onChange({ consistencyText: event.target.value }) })) : null,
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '5px' } }, '参考图仅本机保存，不随导出迁移。上传和移除后请保存人物库／服装库。'),
        note ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '5px', overflowWrap: 'anywhere' } }, note) : null)
    }

    function WorldbookUpgradePanel({ book, request, onApplied }) {
      const [status, setStatus] = React.useState(null)
      const [selected, setSelected] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const live = React.useRef(true), running = React.useRef(false)
      React.useEffect(() => { live.current = true; return () => { live.current = false } }, [])
      const selectable = entry => ['update', 'customized', 'missing'].includes(entry.state)
      const labels = { current: '已是新版', update: '旧版默认，可更新', customized: '已自定义，更新会替换内容', missing: '当前不存在，勾选后重新加入', disabled: '已禁用，保持不变', ambiguous: '条目有歧义，请手动处理' }
      async function load(apply = false) {
        if (running.current || (apply && (!status || !selected.length))) return
        if (apply && !confirm('只更新勾选条目；其中自定义内容将被新版替换，缺失条目将重新加入。确认继续？')) return
        running.current = true; setBusy(true); setNote('')
        try {
          const result = await request(apply ? '/worldbook-upgrade' : '/worldbook-upgrade?book=' + encodeURIComponent(book),
            apply ? { book, expectedFingerprint: status.fingerprint, entryIds: selected } : undefined)
          if (!result?.ok || result.upgrade?.format !== 'structured' || result.upgrade?.key !== book || !Array.isArray(result.upgrade?.entries) || typeof result.upgrade?.fingerprint !== 'string') throw new Error(result?.error || '未收到有效升级预览')
          if (!live.current) return
          setStatus(result.upgrade); setSelected([])
          setNote(apply ? '所选规则已更新；其他条目保持不变。' : '请展开对比并勾选需要更新的条目；默认不选择任何条目。')
          if (apply) {
            try { await onApplied() } catch { if (live.current) setNote('规则已更新，但列表刷新失败；请手动刷新世界书。') }
          }
        } catch (error) { if (live.current) { setNote('未完成：' + (error?.message || error) + '。请重新读取预览后再试。'); setSelected([]); setStatus(null) } }
        finally { running.current = false; if (live.current) setBusy(false) }
      }
      return h('details', { 'aria-label': '结构化默认规则升级', style: { margin: '12px 0', padding: '8px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '7px' } },
        h('summary', { style: { cursor: 'pointer' } }, '检查结构化默认规则更新（保留用户选择）'),
        h('p', { style: { fontSize: '12px' } }, '先保存当前编辑并读取差异，再显式选择要更新的条目。禁用条目不启用；删除过的条目不会自动恢复。'),
        h('button', { type: 'button', disabled: busy, onClick: () => load() }, busy ? '处理中…' : '读取／刷新升级预览'),
        status ? h('div', null,
          status.entries.map(entry => h('details', { key: entry.id, style: { marginTop: '8px' } },
            h('summary', null, (entry.proposed?.comment || entry.current?.comment || '未命名条目') + ' · ' + (labels[entry.state] || '未知状态')),
            h('label', null, h('input', { type: 'checkbox', 'aria-label': '更新规则 ' + entry.id, disabled: busy || !selectable(entry), checked: selected.includes(entry.id), onChange: event => setSelected(old => event.target.checked ? [...new Set([...old, entry.id])] : old.filter(id => id !== entry.id)) }), '应用此条新版规则'),
            h('div', null, '当前内容'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '180px', overflowY: 'auto' } }, entry.current?.content ?? '（当前不存在）'),
            h('div', null, '新版内容'), h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '180px', overflowY: 'auto' } }, entry.proposed?.content ?? '（没有新版内容）'))),
          h('button', { type: 'button', disabled: busy || !selected.length, onClick: () => load(true) }, '确认更新所选 ' + selected.length + ' 条')) : null,
        note ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '8px' } }, note) : null)
    }

