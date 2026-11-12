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
.dti-workflow-editor { container: dti-workflow / inline-size; }
.dti-workflow-body { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) clamp(240px, 32vw, 400px); }
@container dti-workflow (max-width: 650px) {
  .dti-workflow-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(250px, 1fr) minmax(180px, .8fr); }
}
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
.dti-template-library, .dti-structure-editor, .dti-structure-inspector { min-width: 0; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-specific-input-major); border-radius: 8px; overflow: hidden; }
.dti-template-library { margin: 12px 0; }
.dti-inline-blocks { list-style: none; display: grid; gap: 10px; margin: 0; padding: 10px 0; }
.dti-inline-block { min-width: 0; border-top: 1px solid var(--dsw-alias-border-l2); padding: 12px 0 0; display: grid; gap: 8px; }
.dti-module-summary { display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 10px 4px; }
.dti-module-summary::before { content: ''; width: 6px; height: 6px; border-right: 1px solid currentColor; border-top: 1px solid currentColor; transform: rotate(45deg); flex-shrink: 0; margin-right: 3px; }
.dti-module-disclosure[open] > .dti-module-summary::before { transform: rotate(135deg); }
.dti-module-summary > strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.dti-module-summary > span:last-child { flex-shrink: 0; }
.dti-module-summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; border-radius: 6px; }
.dti-module-body { display: grid; gap: 8px; padding: 4px 4px 12px; }
.dti-inline-block-title { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
.dti-inline-block-title label { flex: 1 1 140px; }
.dti-inline-block :is(input, select) { min-width: 0; max-width: 100%; box-sizing: border-box; }
.dti-template-toolbar { position: sticky; top: 0; z-index: 2; background: var(--dsw-specific-input-major); padding-block: 8px; }
.dti-entry-library { min-width: 0; border: 0; margin: 0; padding: 8px 12px 12px; display: grid; gap: 10px; }
.dti-entry-library p { margin: 0; }
.dti-entry-library .dti-template-list { max-height: 220px; overflow: auto; }
.dti-entry-editor { display: grid; gap: 10px; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.dti-entry-editor :is(input, textarea) { min-width: 0; max-width: 100%; box-sizing: border-box; }
.dti-template-library > summary { cursor: pointer; }
.dti-template-library:not([open]) > summary { border-bottom: 0; }
.dti-template-library > details:last-child { padding-block: 8px; }
.dti-template-toolbar { align-items: end !important; }
.dti-template-toolbar select { width: min(100%, 330px); }
.dti-prompt-tryout { container: dti-tryout / inline-size; min-width: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; background: var(--dsw-specific-input-major); }
.dti-tryout-header { padding: 9px 12px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dti-tryout-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr); }
.dti-tryout-inputs { display: grid; align-content: start; gap: 8px; padding: 12px; min-width: 0; }
.dti-tryout-controls { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; }
.dti-tryout-controls :is(label, select) { max-width: 100%; }
.dti-tryout-fixed { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 120px), 1fr)); gap: 8px; }
.dti-tryout-fixed > span { grid-column: 1 / -1; }
.dti-tryout-results { min-width: 0; min-height: 150px; border-inline-start: 1px solid var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-label-primary) 3%, var(--dsw-specific-input-major)); }
.dti-tryout-empty { padding: 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dti-tryout-output + .dti-tryout-output { border-top: 1px solid var(--dsw-alias-border-l2); }
.dti-tryout-output .dti-structure-heading { align-items: center; }
.dti-tryout-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; padding: 6px 10px; overflow-wrap: anywhere; }
.dti-tryout-text { padding: 4px 10px 8px; font-size: 12px; }
.dti-tryout-output pre { margin: 4px 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: min(38vh, 300px); overflow: auto; font: inherit; line-height: 1.55; color: var(--dsw-alias-label-primary); }
@container dti-tryout (max-width: 650px) {
  .dti-tryout-grid { grid-template-columns: minmax(0, 1fr); }
  .dti-tryout-results { border-inline-start: 0; border-top: 1px solid var(--dsw-alias-border-l2); min-height: 68px; }
}
.dti-template-filters { padding-inline: 10px; }
.dti-template-filters input { flex: 1 1 140px; min-width: 0; }
.dti-template-filters select { min-width: 0; max-width: 100%; }
.dti-template-list, .dti-structure-list { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); gap: 6px; margin: 0; padding: 8px 10px; overflow-y: auto; max-height: 132px; }
.dti-template-list button { width: 100%; min-height: 40px; text-align: left; overflow-wrap: anywhere; }
.dti-template-list small { display: block; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dti-structure-workspace { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 8px; margin: 12px 0; min-width: 0; align-items: start; }
.dti-structure-heading { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dti-structure-block-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 6px; width: 100%; height: 100%; align-items: center; text-align: left; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dti-structure-block-head strong { overflow-wrap: anywhere; }
.dti-structure-block-head:hover, .dti-structure-block-head[aria-pressed=true] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
.dti-structure-block-head[aria-pressed=true] { border-color: var(--dsw-alias-brand-primary); }
.dti-structure-number { font: 12px ui-monospace, monospace; color: var(--dsw-alias-brand-primary); }
.dti-structure-kind { grid-column: 2; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dti-structure-excerpt { grid-column: 1 / -1; font-size: 11px; color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.dti-prompt-source-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 8px; }
.dti-roster-panel { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; }
.dti-roster-bar, .dti-roster-group { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.dti-roster-bar > div:last-child { margin: 0; gap: 5px; }
.dti-roster-bar button { min-height: 30px; padding: 4px 9px; font-size: 12px; }
.dti-roster-filters { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 6px; margin: 8px 0; }
.dti-roster-filters > *, .dti-roster-identity > input { min-width: 0; width: 100%; box-sizing: border-box; padding-block: 5px; font-size: 12px; }
.dti-roster { display: grid; gap: 10px; margin: 8px 0 10px; }
.dti-roster-group { border-bottom: 1px solid var(--dsw-alias-border-l2); padding-bottom: 4px; margin-bottom: 6px; font-size: 12px; }
.dti-roster-group span { color: var(--dsw-alias-label-secondary); }
.dti-roster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 72px), 92px)); gap: 6px; }
.dti-roster-tile { position: relative; display: grid; place-items: center; min-width: 0; aspect-ratio: 1; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, var(--dsw-specific-input-major)); padding: 5px; color: inherit; font: inherit; cursor: pointer; }
.dti-roster-tile:hover { border-color: var(--dsw-alias-brand-primary); }
.dti-roster-tile:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dti-roster-tile img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 28%; }
.dti-roster-caption { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; font-size: 12px; line-height: 1.3; font-weight: 600; }
.dti-roster-tile:has(img:not([hidden])) .dti-roster-caption { position: absolute; inset: auto 0 0; display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 9px 5px 4px; color: white; background: linear-gradient(transparent, rgba(0,0,0,.84)); }
.dti-roster-disabled { position: absolute; top: 3px; right: 3px; border-radius: 4px; padding: 1px 3px; font-size: 10px; background: var(--dsw-specific-input-major); }
.dti-roster-detail { margin: 8px 0; }
.dti-roster-settings { padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.dti-roster-identity { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, .8fr) minmax(0, 1.2fr); align-items: center; gap: 6px; margin: 6px 0; }
.dti-roster-identity > label { margin: 0 !important; gap: 4px !important; font-size: 12px; }
.dti-roster-reference { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 186px), 1fr)); align-items: start; gap: 8px; margin: 8px 0; padding-block: 7px; border-block: 1px solid var(--dsw-alias-border-l2); }
.dti-roster-reference-media { display: flex; gap: 7px; align-items: start; min-width: 0; }
.dti-roster-reference-media img { width: 48px; height: 48px; object-fit: cover; border-radius: 6px; }
.dti-roster-reference-media > div { flex: 1; min-width: 0; }
@media (max-width: 500px) { .dti-roster-identity { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
.dti-library-parts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 6px; padding: 2px; max-height: min(38vh, 280px); overflow: auto; }
.dti-library-parts button { text-align: left; min-width: 0; overflow-wrap: anywhere; }
.dti-library-parts strong { display: block; margin-bottom: 4px; }
.dti-library-parts span { display: block; white-space: pre-wrap; font-size: 12px; }
.dti-structure-block-head[data-kind=positive] .dti-structure-number { color: var(--dsw-alias-state-success-primary); }
.dti-structure-block-head[data-kind=negative] .dti-structure-number { color: var(--dsw-alias-state-error-primary); }
.dti-structure-block-body { padding: 8px 10px; display: grid; gap: 8px; }
.dti-structure-block-body :is(input, select) { min-width: 0; width: 100%; box-sizing: border-box; }
.dti-structure-add { padding-inline: 10px; }
.dti-structure-targets { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }
.dti-structure-target-list { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding: 0; }
.dti-structure-target-list li { display: flex; align-items: center; gap: 6px; padding: 2px 2px 2px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow-wrap: anywhere; }
`

    function WorkflowGraphEditor(props) {
      const embedded = props?.embedded === true
      const editorRef = React.useRef(null)
      const file = String(props?.file || '')
      const post = props?.post
      const [raw, setRaw] = React.useState(null)
      const [revision, setRevision] = React.useState('')
      const [draft, setDraft] = React.useState({})
      const [positions, setPositions] = React.useState({})
      const [selected, setSelected] = React.useState('')
      const [nodeSearch, setNodeSearch] = React.useState('')
      const [referenceDraft, setReferenceDraft] = React.useState(null)
      const [outputDraft, setOutputDraft] = React.useState('')
      const [connections, setConnections] = React.useState([])
      const [loraDraft, setLoraDraft] = React.useState({})
      const [filter, setFilter] = React.useState('all')
      const [dynamicDraft, setDynamicDraft] = React.useState(null)
      const [fields, setFields] = React.useState([])
      const [recognition, setRecognition] = React.useState('')
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
          setFields(result.fields || [])
          const first = workflow.bindings?.positive?.[0]?.node || ids[0]
          if (first && layout[first]) { setSelected(String(first)); setView({ x: 24 - layout[first].x, y: 24 - layout[first].y, scale: 1 }) }
          else setView({ x: 36, y: 36, scale: 1 })
        }).catch(e => { if (alive) setError('工作流读取失败：' + String(e?.message ?? e)) })
        return () => { alive = false }
      }, [file])

      const nodes = raw?.prompt || {}
      const ids = Object.keys(nodes)
      const displayNodes = JSON.parse(JSON.stringify(nodes))
      connections.forEach(item => { if (displayNodes[item.node]) displayNodes[item.node].inputs[item.input] = [item.source, item.output] })
      const links = []
      ids.forEach(targetId => Object.entries(displayNodes[targetId]?.inputs || {}).forEach(([field, value]) => {
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
        if (referenceDraft || outputDraft || connections.length || Object.keys(loraDraft).length || dynamicDraft !== null) return true
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
      function focusNode(id) {
        setSelected(id)
        const position = positions[id]
        if (position) setView(current => { const scale = Math.max(0.85, current.scale); return { scale, x: 24 - position.x * scale, y: 24 - position.y * scale } })
      }
      async function recognizeNodes() {
        if (busy || !raw) return
        setBusy(true)
        setError('')
        try {
          const result = await post('/workflow-bindings', { file, refreshNodes: true, revision })
          setRaw(result.workflow)
          setFields(result.fields || [])
          setRevision(result.revision)
          const count = result.discovery?.recognized || 0
          setRecognition(count ? '已识别 ' + count + ' 种节点' : 'ComfyUI 未返回节点定义，可继续编辑工作流参数。')
        } catch (e) { setError(String(e?.message ?? e)) }
        finally { setBusy(false) }
      }
      React.useEffect(() => {
        const key = event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save() }
        }
        const target = embedded ? editorRef.current : document
        target?.addEventListener('keydown', key, true)
        return () => target?.removeEventListener('keydown', key, true)
      })
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
        const patch = { inputs, positions: moved, connections, loras: Object.values(loraDraft),
          ...(dynamicDraft !== null ? { dynamicImages: dynamicDraft } : {}), ...(referenceDraft ? { referenceImages: referenceDraft } : {}),
          ...(outputDraft ? { outputNode: outputDraft } : {}) }
        Promise.resolve(post('/workflow-graph', { file, patch, revision })).then(result => {
          if (!result?.ok) throw new Error(result?.error || '保存失败')
          const workflow = result.workflow || raw
          setRaw(workflow); setRevision(String(result.revision || revision)); setDraft({})
          setFields(result.fields || []); setReferenceDraft(null); setOutputDraft(''); setConnections([]); setLoraDraft({}); setDynamicDraft(null)
          initialPositions.current = JSON.parse(JSON.stringify(positions))
          props?.onSaved?.(workflow)
        }).catch(e => setError('保存失败：' + String(e?.message ?? e))).finally(() => setBusy(false))
      }
      const chosen = nodes[selected]
      const primitiveFields = chosen ? Object.entries(chosen.inputs || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null) : []
      const chosenFields = new Map(fields.filter(field => field.node === selected).map(field => [field.input, field]))
      const schema = raw?.nodeSchemas?.[chosen?.class_type]
      const referenceFields = referenceDraft ?? raw?.bindings?.referenceImages ?? []
      const results = ids.filter(id => {
        const category = nodeColor(nodes[id].class_type)
        return filter === 'all' || filter === 'text' && category === colors.prompt || filter === 'image' && fields.some(field => field.node === id && field.image) || filter === 'lora' && /lora/i.test(nodes[id].class_type)
      }).filter(id => {
        const query = nodeSearch.trim().toLowerCase()
        const node = nodes[id]
        return [id, node.class_type, node._meta?.title, ...Object.keys(node.inputs || {})].some(value => String(value || '').toLowerCase().includes(query))
      })
      function referenceBinding(field) {
        const key = workflowFieldKey({ node: selected, input: field })
        const index = referenceFields.findIndex(item => workflowFieldKey(item) === key)
        setReferenceDraft(index >= 0 ? referenceFields.filter((_, at) => index !== at) : [...referenceFields, { node: selected, input: field }])
      }
      function insertPromptToken(field, value, token) {
        const text = inputValue(selected, field, value)
        if (!text.includes(token)) setField(selected, field, [text, token].filter(Boolean).join('\n'))
      }
      const typeStyle = type => ({ borderLeft: '4px solid ' + nodeColor(type) })
      const button = { background: 'var(--dsw-specific-input-major, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)', border: '1px solid var(--dsw-alias-border-l2, ButtonBorder)', borderRadius: '7px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px' }
      return h('div', { ref: editorRef, tabIndex: -1, 'data-workflow-editor': true, className: 'dti-workflow-editor', role: embedded ? 'region' : 'dialog', 'aria-modal': embedded ? undefined : 'true', 'aria-label': '工作流可视化编辑器', style: { ...(embedded ? { position: 'relative', height: 'min(80vh, 900px)', minHeight: 560 } : { position: 'fixed', inset: '48px 12px 12px', zIndex: 2147483200 }), display: 'flex', flexDirection: 'column', background: 'var(--dsw-specific-input-major, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)', fontFamily: 'system-ui, sans-serif', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2, ButtonBorder)', overflow: 'hidden', boxShadow: '0 12px 60px #0005' } },
        h('header', { style: { minHeight: '58px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', flexWrap: 'wrap', borderBottom: '1px solid var(--dsw-alias-border-l2, ButtonBorder)', background: 'var(--dsw-specific-input-major, Canvas)' } },
          h('button', { type: 'button', 'aria-label': '关闭工作流图', disabled: busy, style: button, onClick: close }, embedded ? '收起节点图' : '返回设置'),
          h('strong', { style: { fontSize: '15px', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '节点工作流 · ' + file.split(/[\\/]/).pop()),
          h('span', { role: 'status', style: { color: isDirty() ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-secondary, GrayText)', fontSize: '12px' } }, isDirty() ? '● 有未保存修改' : (raw ? ids.length + ' 节点 · ' + links.length + ' 连线' : '读取中…')),
          h('button', { type: 'button', 'aria-label': '缩小', disabled: busy, style: button, onClick: () => changeZoom(-0.15) }, '−'),
          h('button', { type: 'button', 'aria-label': '放大', disabled: busy, style: button, onClick: () => changeZoom(0.15) }, '+'),
          h('button', { type: 'button', 'aria-label': '适配画布', disabled: busy, style: button, onClick: fitView }, '适配'),
          h('button', { type: 'button', 'aria-label': '重置视图', disabled: busy, style: button, onClick: resetView }, '重置'),
          h('button', { type: 'button', 'aria-label': '保存工作流图', disabled: !raw || !isDirty() || busy, style: Object.assign({}, button, { background: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent)', borderColor: 'var(--dsw-alias-state-success-primary)', opacity: !raw || !isDirty() || busy ? 0.55 : 1 }), onClick: save }, busy ? '保存中…' : '保存'),
        ),
          h('div', { className: 'dti-workflow-body' },
          h('div', { ref: canvasRef, role: 'application', 'aria-label': '工作流节点画布', onMouseDown: event => { if (!busy) beginPan(event) }, onMouseMove: movePointer, onMouseUp: () => setDrag(null), onMouseLeave: () => setDrag(null), onWheel: event => { event.preventDefault?.(); if (!busy) changeZoom(event.deltaY < 0 ? 0.08 : -0.08) }, style: { position: 'relative', overflow: 'hidden', cursor: drag?.kind === 'pan' ? 'grabbing' : 'grab', backgroundColor: 'var(--dsw-specific-input-major, Canvas)', backgroundImage: 'radial-gradient(color-mix(in srgb, var(--dsw-alias-label-tertiary, GrayText) 20%, transparent) 1px, transparent 1px)', backgroundSize: '22px 22px' } },
            error ? h('div', { role: 'alert', style: { position: 'absolute', zIndex: 4, top: '12px', left: '12px', color: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-specific-input-major, Canvas)', border: '1px solid var(--dsw-alias-border-l2, ButtonBorder)', borderRadius: '7px', padding: '8px 12px', fontSize: '12px' } }, error) : null,
            raw ? h('div', { style: { position: 'absolute', left: 0, top: 0, transform: 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.scale + ')', transformOrigin: '0 0' } },
              h('svg', { 'aria-hidden': 'true', width: 1, height: 1, style: { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' } },
                h('defs', null, h('marker', { id: 'workflow-graph-arrow', markerWidth: 8, markerHeight: 8, refX: 6, refY: 3, orient: 'auto', markerUnits: 'strokeWidth' }, h('path', { d: 'M0,0 L0,6 L7,3 z', fill: 'var(--dsw-alias-label-tertiary, GrayText)' }))),
                links.map((link, index) => {
                  const from = positions[link.source] || { x: 0, y: 0 }, to = positions[link.target] || { x: 0, y: 0 }
                  const x1 = from.x + nodeWidth, y1 = from.y + 56, x2 = to.x, y2 = to.y + 56, curve = Math.max(50, Math.abs(x2 - x1) * 0.45)
                  return h('path', { key: index, d: 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + curve) + ' ' + y1 + ', ' + (x2 - curve) + ' ' + y2 + ', ' + x2 + ' ' + y2, fill: 'none', stroke: 'var(--dsw-alias-label-tertiary, GrayText)', strokeWidth: selected === link.source || selected === link.target ? 3.5 : 1.6, opacity: !selected || selected === link.source || selected === link.target ? 0.95 : 0.22, markerEnd: 'url(#workflow-graph-arrow)' })
                })),
              ids.map((id, index) => {
                const node = nodes[id], position = positions[id] || { x: 0, y: 0 }, classType = node.class_type || '未知节点'
                const primitiveCount = Object.values(node.inputs || {}).filter(value => value === null || ['string', 'number', 'boolean'].includes(typeof value)).length
                return h('div', { key: id, role: 'button', tabIndex: 0, 'aria-label': '节点 ' + id + ' ' + classType, onClick: () => setSelected(id), onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault?.(); setSelected(id) } }, onMouseDown: event => { if (!busy) beginDrag(event, id) }, onMouseMove: movePointer, onMouseUp: () => setDrag(null), style: { position: 'absolute', left: position.x, top: position.y, width: nodeWidth, boxSizing: 'border-box', border: '1px solid ' + (selected === id ? 'var(--dsw-alias-label-primary, CanvasText)' : nodeColor(classType)), borderRadius: '9px', background: 'var(--dsw-specific-input-major, Canvas)', boxShadow: selected === id ? '0 0 0 2px color-mix(in srgb, var(--dsw-alias-label-tertiary, GrayText) 28%, transparent), 0 8px 24px #0009' : '0 6px 18px #0008', overflow: 'hidden', cursor: drag?.id === id ? 'grabbing' : 'grab' } },
                  h('div', { style: Object.assign({ padding: '9px 11px', background: 'var(--dsw-specific-input-major, Canvas)', fontWeight: 650, fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }, typeStyle(classType)) }, h('span', null, classType), h('span', { style: { color: 'var(--dsw-alias-label-secondary, GrayText)', fontWeight: 400 } }, '#' + id)),
                  h('div', { style: { padding: '8px 11px', color: 'var(--dsw-alias-label-secondary, GrayText)', fontSize: '11px', lineHeight: '1.5' } }, primitiveCount ? primitiveCount + ' 个可编辑参数' : '参数由连线提供', node._meta?.title ? h('div', { style: { marginTop: '3px', color: 'var(--dsw-alias-label-tertiary, GrayText)' } }, node._meta.title) : null,
                    referenceFields.some(item => String(item.node) === id) ? h('strong', null, '输入图片 ' + (referenceFields.findIndex(item => String(item.node) === id) + 1)) : null,
                    Object.entries(node.inputs || {}).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 2).map(([field, value]) => h('div', { key: field, title: String(value), style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, field + ': ' + inputValue(id, field, value)))),
                )
              }),
            ) : h('div', { style: { padding: '24px', color: 'var(--dsw-alias-label-secondary, GrayText)', fontSize: '13px' } }, error || '正在读取工作流…'),
          ),
          h('aside', { style: { overflowY: 'auto', borderLeft: '1px solid var(--dsw-alias-border-l2, ButtonBorder)', background: 'var(--dsw-specific-input-major, Canvas)', padding: '16px', color: 'var(--dsw-alias-label-primary, CanvasText)' } },
            h('input', { 'aria-label': '查找工作流节点', placeholder: '查找节点或字段', value: nodeSearch, style: { ...S.input, width: '100%', boxSizing: 'border-box' },
              onChange: event => setNodeSearch(event.target.value) }),
            nodeSearch.trim() ? h('div', { style: { ...PROMPT_FIELDS, maxHeight: 160, overflow: 'auto' } }, results.length
              ? results.map(id => h('button', { key: id, type: 'button', style: button, onClick: () => focusNode(id) }, '#' + id + ' ' + (nodes[id]._meta?.title || nodes[id].class_type)))
              : h('small', null, '没有匹配节点')) : null,
            recognition ? h('p', { role: 'status', style: STRUCTURE_MUTED }, recognition) : null,
            h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '查找其他节点'),
            h('button', { type: 'button', style: button, disabled: busy, onClick: recognizeNodes }, '重新识别节点'),
            h('div', { style: S.row }, [['all', '全部'], ['text', '提示词'], ['image', '图片'], ['lora', 'LoRA']].map(([key, label]) =>
              h('button', { key, type: 'button', style: { ...button, fontWeight: filter === key ? 700 : 400 }, onClick: () => setFilter(key) }, label))),
            !nodeSearch.trim() ? h('div', { style: { display: 'grid', gap: 4, maxHeight: 160, overflow: 'auto', margin: '8px 0' } }, results.map(id =>
              h('button', { key: id, type: 'button', style: { ...button, textAlign: 'left' }, onClick: () => focusNode(id) }, '#' + id + ' · ' + (nodes[id]._meta?.title || nodes[id].class_type)))) : null,
            ),
            fields.some(field => field.image) ? h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '图生图设置'),
            h('label', { style: { ...STRUCTURE_MUTED, display: 'flex', gap: 6, margin: '8px 0' } },
              h('input', { type: 'checkbox', checked: (dynamicDraft ?? raw?.dynamicImages) !== false, disabled: busy,
                onChange: event => setDynamicDraft(event.target.checked) }), '按输入数量展开多图节点')) : null,
            chosen ? h('div', null,
              h('div', { style: { padding: '10px', borderRadius: '8px', background: 'var(--dsw-specific-input-major, Canvas)', borderLeft: '4px solid ' + nodeColor(chosen.class_type), marginBottom: '12px' } },
                h('div', { style: { fontSize: '13px', fontWeight: 650 } }, chosen._meta?.title || chosen.class_type || '未知节点'),
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, GrayText)', marginTop: '4px' } }, '节点 #' + selected + ' · ' + Object.keys(chosen.inputs || {}).length + ' 个输入')),
              (/SaveImage|PreviewImage/i.test(chosen.class_type) || schema?.outputNode && Object.values(schema.inputs || {}).some(input => input.type === 'IMAGE'))
                ? h('button', { type: 'button', style: button, disabled: busy || (outputDraft || raw.outputNode) === selected,
                  onClick: () => setOutputDraft(selected === raw.outputNode ? '' : selected) },
                  (outputDraft || raw.outputNode) === selected ? '当前图片输出' : '设为图片输出') : null,
              primitiveFields.map(([field, value]) => {
                const info = chosenFields.get(field)
                const contract = schema?.inputs?.[field]
                const text = typeof value === 'string' && info?.text === true && !info.image
                const fieldValue = inputValue(selected, field, value)
                const common = { disabled: busy || info?.editable === false, 'aria-label': field,
                  style: { ...S.input, width: '100%', boxSizing: 'border-box' } }
                const choices = contract?.choices || []
                const large = text && (contract?.multiline || fieldValue.length > 100)
                const write = event => setField(selected, field, event.target.value)
                const control = value === null ? h('small', null, '空值')
                  : typeof value === 'boolean' ? h('input', { ...common, type: 'checkbox',
                    checked: fieldValue === 'true', onChange: event => setField(selected, field, event.target.checked) })
                  : choices.length ? h('select', { ...common, value: fieldValue, onChange: write },
                    [...new Set([fieldValue, ...choices])].map(option => h('option', { key: option, value: option }, option)))
                  : h(large ? 'textarea' : 'input', { ...common, type: typeof value === 'number' ? 'number' : 'text',
                    min: contract?.min, max: contract?.max, step: contract?.step || 'any', value: fieldValue, onChange: write });
                const slot = referenceFields.findIndex(item => String(item.node) === selected && item.input === field)
                return h('div', { key: field, style: { marginBottom: 12 } },
                  promptField(field + ' · ' + (info?.image ? '图片加载' : contract?.type || typeof value), control),
                  text && info?.editable !== false ? h('div', { style: S.row }, ['%prompt', '%negative'].map(token =>
                    h('button', { key: token, type: 'button', style: button, disabled: busy, onClick: () => insertPromptToken(field, value, token) }, '插入 ' + token))) : null,
                  (info?.image || slot >= 0) && typeof value === 'string' ? h('button', { type: 'button', style: button, disabled: busy,
                    onClick: () => referenceBinding(field) }, slot >= 0 ? '移除参考图 ' + (slot + 1) + ' 接入' : '接入参考图 ' + (referenceFields.length + 1)) : null)
              }),
              (raw.bindings?.loras || []).filter(item => String(item.node) === selected).map(item => {
                const key = imageLoraKey(item), value = loraDraft[key] || item
                const change = patch => setLoraDraft(current => ({ ...current, [key]: { ...(current[key] || item), ...patch } }))
                return h('details', { key, style: { ...S.card, padding: 8 } }, h('summary', null, value.name || 'LoRA 槽位'),
                  promptField('LoRA 文件', h('input', { style: S.input, value: value.name, onChange: event => change({ name: event.target.value }) })),
                  h('label', null, h('input', { type: 'checkbox', checked: value.enabled !== false, onChange: event => change({ enabled: event.target.checked }) }), '启用'),
                  ...['strengthModel', ...(value.strengthClip !== undefined ? ['strengthClip'] : [])].map(field => promptField(field === 'strengthModel' ? '模型强度' : 'CLIP 强度',
                    h('input', { type: 'number', step: 0.05, style: S.input, value: value[field] ?? 1, onChange: event => change({ [field]: Number(event.target.value) }) }))))
              }),
              schema ? h('details', { style: S.card }, h('summary', null, '输入连线'),
                Object.entries(schema.inputs || {}).filter(([, contract]) => contract.type !== 'COMFY_AUTOGROW_V3').map(([field, contract]) => {
                  const current = displayNodes[selected].inputs[field]
                  const selectedLink = Array.isArray(current) ? JSON.stringify(current) : ''
                  const options = ids.filter(id => id !== selected).flatMap(id => (raw.nodeSchemas?.[nodes[id].class_type]?.outputs || []).flatMap((type, output) =>
                    type === contract.type || type === '*' || contract.type === '*' ? [{ id, output, type }] : []))
                  if (!options.length && !selectedLink) return null
                  return promptField(field + ' · ' + contract.type, h('select', { key: field, style: { ...S.input, width: '100%' }, value: selectedLink, disabled: busy,
                    'aria-label': '连线 ' + field, onChange: event => {
                      if (!event.target.value) return
                      const [source, output] = JSON.parse(event.target.value)
                      setConnections(items => [...items.filter(item => item.node !== selected || item.input !== field), { node: selected, input: field, source: String(source), output }])
                    } }, h('option', { value: '' }, Object.hasOwn(chosen.inputs, field) ? '使用当前参数' : '未连接'),
                    selectedLink && !options.some(item => JSON.stringify([item.id, item.output]) === selectedLink) ? h('option', { value: selectedLink }, '当前连接') : null,
                    options.map(item => h('option', { key: item.id + ':' + item.output, value: JSON.stringify([item.id, item.output]) }, '#' + item.id + ' · ' + (nodes[item.id]._meta?.title || nodes[item.id].class_type) + ' [' + item.output + ']'))))
                })) : null,
              h('div', { style: PROMPT_FIELDS },
                links.filter(link => link.target === selected || link.source === selected).map(link => {
                  const incoming = link.target === selected
                  const other = incoming ? link.source : link.target
                  const type = incoming ? chosenFields.get(link.field)?.type : raw.nodeSchemas?.[nodes[other].class_type]?.inputs?.[link.field]?.type
                  return h('button', { key: link.target + ':' + link.field, type: 'button', style: button, onClick: () => focusNode(other) },
                    (incoming ? '来自 #' : '连到 #') + other + ' · ' + link.field + (type ? ' · ' + type : ''))
                })),
            ) : h('div', { style: { color: 'var(--dsw-alias-label-secondary, GrayText)', fontSize: '12px', lineHeight: 1.6 } }, '点选画布中的节点查看参数。可拖动节点调整布局，滚轮缩放，拖动画布空白处平移。'),
            error ? h('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', marginTop: '12px' } }, error) : null,
          ),
        ),
      )
    }

    /** One local reference per library object; binding is saved with the existing draft.
     *  field='characterOutfitImage' edits a character's own outfit sheet (角色×服装设定图), sharing the outfit's 一致性补充. */
    function ReferenceImageEditor({ value = {}, label, onChange, field = 'referenceImage', noun = '参考图', heading = '（每个对象一张）', consistency = true, compact = false }) {
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
      const preview = imageId ? h('img', { src: BASE + '/reference-image?id=' + encodeURIComponent(imageId), alt: label + noun,
        style: compact ? undefined : { display: 'block', maxWidth: '180px', maxHeight: '160px', objectFit: 'contain', borderRadius: '7px', marginBottom: '7px' } }) : null
      const controls = h('div', null,
        h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '4px' } }, compact ? noun : label + noun + heading),
        compact ? null : preview,
        imageId ? h('div', { style: { fontSize: '11px', overflowWrap: 'anywhere', marginBottom: '4px' } }, image.name || '已上传参考图') : null,
        h('label', { style: { display: 'inline-flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px' } },
          compact && !busy ? null : busy ? '上传中…' : imageId ? '替换' + noun : '上传' + noun,
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': label + '上传' + noun,
            disabled: busy, onChange: upload, style: { maxWidth: '100%', fontSize: 12 } })),
        imageId || busy ? h('button', { type: 'button', 'aria-label': label + '移除' + noun, style: { marginLeft: '5px', fontSize: '12px' }, onClick: () => {
          epoch.current += 1
          setBusy(false)
          onChange({ [field]: null })
          setNote('已从草稿解绑，保存后生效；历史参考图不会删除')
        } }, '移除') : null,
        note ? h('div', { role: 'status', style: { fontSize: '12px', marginTop: '4px', overflowWrap: 'anywhere' } }, note) : null)
      return h('section', { 'aria-label': label + noun + '设置', className: compact ? 'dti-roster-reference' : undefined,
        style: compact ? undefined : { padding: '10px', margin: '10px 0', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '9px' } },
        compact ? h('div', { className: 'dti-roster-reference-media' }, preview, controls) : controls,
        consistency ? h('label', { style: { display: 'block', fontSize: '12px', marginTop: compact ? 0 : '8px' } }, '一致性补充（可选）',
          h('textarea', { 'aria-label': label + '一致性补充', value: value.consistencyText || '', rows: 2,
            placeholder: compact ? '需要保持的角色特征' : '补充需要保持的特征；动作、背景及正文明确的变化仍以剧情为准',
            style: inputStyle, onChange: event => onChange({ consistencyText: event.target.value }) })) : null,
        !compact ? h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '5px' } },
          '参考图仅本机保存，不随导出迁移。上传和移除后请保存人物库／服装库。') : null)

    }

    const LIBRARY_PROMPT_PARTS = {
      '角色': [['face', '外貌正面'], ['faceBack', '外貌背面'], ['bodySFW', '穿衣上身正面'], ['bodySFWBack', '穿衣上身背面'],
        ['lowerSFW', '穿衣下身正面'], ['lowerSFWBack', '穿衣下身背面'], ['bodyNSFW', '裸露上身正面'], ['bodyNSFWBack', '裸露上身背面'],
        ['lowerNSFW', '裸露下身正面'], ['lowerNSFWBack', '裸露下身背面'], ['feature', '性格（规划用）']],
      '服装': [['upper', '上衣'], ['lower', '下装'], ['shoes', '鞋袜'], ['accessory', '配饰'], ['full', '整套'], ['back', '背面']],
      '通用服装': [['body', '正面上身'], ['full', '正面整套'], ['bodyBack', '背面上身'], ['fullBack', '背面整套']],
    }

    function LibraryPromptEditor({ record, kind, mode, traitMode, editable, detailsEditable, onChange }) {
      const custom = libraryPromptOverride(record) !== null
      const character = kind === '角色'
      const parts = character ? record.traits || {} : record
      const fields = LIBRARY_PROMPT_PARTS[kind]
      const filled = fields.filter(([key]) => String(parts[key] || '').trim())
      const [view, setView] = React.useState(() => !custom && filled.length > 1 ? 'all' : 'prompt')
      const [selected, select] = React.useState('')
      const updatePart = (key, value) => onChange(character ? { traits: { ...parts, [key]: value } } : { [key]: value })
      const fallback = character ? characterLibraryPrompt(record, { mode, traitMode })
        : outfitLibraryPrompt(record, { mode, shared: kind === '通用服装' })
      const imageDetails = libraryImageDetails(record)
      const editor = (label, value, onEdit, rows, readOnly = false) => h('label', { style: { display: 'grid', gap: 4, margin: '8px 0', minWidth: 0 } },
        h('span', { style: { fontSize: 12, fontWeight: 600 } }, label),
        h('textarea', { 'aria-label': kind + label, value, rows, maxLength: 8000, readOnly,
          onChange: event => onEdit(event.target.value),
          style: { ...S.input, width: '100%', boxSizing: 'border-box', resize: 'vertical', maxHeight: 'min(42vh, 300px)', fontFamily: 'inherit' } }))
      return h('div', { 'aria-label': kind + '提示词' },
        h('div', { style: S.row },
          [['prompt', '生图原文'], ['all', '全部资料']].map(([key, label]) => h('button', { key, type: 'button',
            style: S.tab(view === key), 'aria-pressed': view === key, onClick: () => setView(key) }, label))),
        view === 'prompt' ? h(React.Fragment, null,
          editor('正面提示词', custom ? record.imagePrompt : fallback, imagePrompt => onChange({ imagePrompt }), 4, !editable),
          h('div', { style: { ...S.row, justifyContent: 'space-between', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            h('span', null, !editable ? '重启后可编辑整段提示词' : custom ? '自定义原文' : '默认片段 · 直接编辑即可替换'),
            editable && custom ? h('button', { type: 'button', style: buttonStyle, onClick: () => onChange({ imagePrompt: undefined }) }, '恢复默认片段') : null),
          editor('负面提示词', parts.negative || '', value => updatePart('negative', value), 2))
          : h('section', { 'aria-label': kind + '全部资料' },
            h('div', { className: 'dti-library-parts' },
              custom ? h('button', { type: 'button', style: S.tab(false), onClick: () => setView('prompt') },
                h('strong', null, '自定义正面 · 当前使用'), h('span', null, record.imagePrompt || '空白')) : null,
              [...filled, ...(parts.negative ? [['negative', '负面']] : [])].map(([key, label]) => h('button', { key, type: 'button',
                style: S.tab(selected === key), 'aria-pressed': selected === key, onClick: () => select(key) },
                h('strong', null, label), h('span', null, parts[key])))),
            h('div', { style: S.row },
              h('select', { 'aria-label': kind + '资料分节', style: S.input, value: selected, onChange: event => select(event.target.value) },
                h('option', { value: '' }, '选择要编辑的资料'),
                [...fields, ['negative', '负面']].map(([key, label]) => h('option', { key, value: key }, label)))),
            selected ? editor('资料原文', parts[selected] || '', value => updatePart(selected, value), 4) : null),
        view === 'prompt' && imageDetails.length ? h('div', { style: { ...STRUCTURE_MUTED, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
          '生图还会加入：\n' + imageDetails.join('\n')) : null,
        h(LibraryCustomDetails, { record, editable: detailsEditable, onChange }))
    }

    function LibraryCustomDetails({ record, editable, onChange }) {
      const [selected, select] = React.useState(-1)
      const details = Array.isArray(record.imageDetails) ? record.imageDetails : []
      const current = details[selected]
      const write = imageDetails => onChange({ imageDetails })
      const edit = patch => write(details.map((item, index) => index === selected ? { ...item, ...patch } : item))
      const add = () => {
        write([...details, { name: '新资料', text: '', useForImage: false }])
        select(details.length)
      }
      return h('section', { 'aria-label': '自定义资料', style: { ...S.card, marginTop: 10 } },
        h('div', { style: { ...S.row, justifyContent: 'space-between', marginTop: 0 } },
          h('strong', null, '自定义资料'),
          h('button', { type: 'button', style: buttonStyle, disabled: !editable || details.length >= 24, onClick: add }, '添加资料')),
        details.length ? h('div', { className: 'dti-library-parts' }, details.map((item, index) =>
          h('button', { key: index, type: 'button', style: S.tab(index === selected), 'aria-pressed': index === selected, onClick: () => select(index) },
            h('strong', null, item.name || '未命名'),
            h('small', null, item.useForImage ? '用于生图' : '仅资料'),
            item.text ? h('span', null, item.text) : null))) : null,
        current ? h('fieldset', { disabled: !editable, style: { border: 0, minWidth: 0, padding: 0, margin: 0 } },
          promptField('资料名称', h('input', { style: S.input, value: current.name, maxLength: 60, onChange: event => edit({ name: event.target.value }) })),
          promptField('资料内容', h('textarea', { style: promptArea(72), value: current.text, maxLength: 2000, onChange: event => edit({ text: event.target.value }) })),
          h('div', { style: S.row },
            h('label', { style: S.row }, h('input', { type: 'checkbox', checked: current.useForImage, onChange: event => edit({ useForImage: event.target.checked }) }), '用于生图'),
            h('button', { type: 'button', style: buttonStyle, onClick: () => { write(details.filter((_, index) => index !== selected)); select(-1) } }, '删除资料'))) : null)
    }

    // 卡片模式的世界书（原 dsh-tavern-gen）：分册 + 档位，数据在 /dsh-tavern-gen/api。
    // 和游玩模式的世界书是两份独立文件（card-worldbook.json），同一页里切换入口，互不覆盖。

    function CharacterComfyLoras({ value = [], workflows, onChange }) {
      const [names, setNames] = React.useState([])
      const [note, setNote] = React.useState('')
      const listId = React.useId()
      const update = (index, patch) => onChange(value.map((item, at) => at === index ? { ...item, ...patch } : item))
      return h('details', { style: { ...S.card, padding: 8 } }, h('summary', { style: PROMPT_DISCLOSURE }, 'ComfyUI 人物 LoRA' + (value.length ? ' · ' + value.length : '')),
        value.map((item, index) => h('div', { key: index, style: S.card },
          h('div', { style: S.row },
            h('select', { 'aria-label': '人物 LoRA 工作流', style: S.input, value: item.workflowId || '', onChange: event => update(index, { workflowId: event.target.value, node: '' }) },
              h('option', { value: '' }, '选择工作流'), workflows.filter(workflow => !workflow.error).map(workflow => h('option', { key: workflow.id, value: workflow.id }, workflow.label || workflow.id))),
            h('label', null, h('input', { type: 'checkbox', checked: item.enabled !== false, onChange: event => update(index, { enabled: event.target.checked }) }), '启用'),
            h('button', { type: 'button', style: buttonStyle, onClick: () => onChange(value.filter((_, at) => at !== index)) }, '移除')),
          h('input', { 'aria-label': '人物 LoRA 文件', list: listId, style: { ...S.input, width: '100%', boxSizing: 'border-box' }, value: item.name || '', placeholder: 'LoRA 文件名', onChange: event => update(index, { name: event.target.value }) }),
          h('div', { style: S.row }, ...['strengthModel', 'strengthClip'].map(field => promptField(field === 'strengthModel' ? '模型强度' : 'CLIP 强度', h('input', {
            type: 'number', min: -10, max: 10, step: 0.05, style: { ...S.input, width: 80 }, value: item[field] ?? 1, onChange: event => update(index, { [field]: Number(event.target.value) }) })))),
          h('details', null, h('summary', null, '指定加载节点'), h('input', { 'aria-label': '人物 LoRA 节点', style: S.input, value: item.node || '', placeholder: '留空使用唯一 LoRA 链末端', onChange: event => update(index, { node: event.target.value }) })))),
        h('div', { style: S.row }, h('button', { type: 'button', style: buttonStyle, disabled: value.length >= 12, onClick: () => onChange([...value, { workflowId: workflows.find(item => item.current)?.id || workflows[0]?.id || '', name: '', strengthModel: 1, strengthClip: 1 }]) }, '绑定 LoRA'),
          h('button', { type: 'button', style: buttonStyle, onClick: async () => {
            try { const result = await jsonFetch(BASE + '/loras-available', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); setNames(result.loras || []); setNote('已读取 ' + (result.loras?.length || 0) + ' 个 LoRA') }
            catch (error) { setNote(error.message) }
          } }, '读取已安装 LoRA')),
        h('datalist', { id: listId }, names.map(name => h('option', { key: name, value: name }))),
        note ? h('small', { role: 'status' }, note) : null)
    }
