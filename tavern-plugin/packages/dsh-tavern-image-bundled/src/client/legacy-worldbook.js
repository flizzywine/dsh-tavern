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

    function LegacyWorldbookPanel({ initialFormat = 'tags', providers = [] }) {
      const [format, setFormat] = React.useState(initialFormat)
      const [book, setBook] = React.useState('main')
      const [books, setBooks] = React.useState([])
      const [drafts, setDrafts] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const current = books.find(item => item.key === book)
      const keyOf = index => format + ':' + book + ':' + index
      const dropBookDrafts = () => setDrafts(all => Object.fromEntries(Object.entries(all).filter(([key]) => !key.startsWith(format + ':' + book + ':'))))
      async function refresh() {
        const result = await jsonFetch(BASE + '/worldbook?format=' + encodeURIComponent(format))
        setBooks(result.worldbookBooks || [])
      }
      React.useEffect(() => { let alive = true; jsonFetch(BASE + '/worldbook?format=' + encodeURIComponent(format)).then(result => { if (alive) setBooks(result.worldbookBooks || []) }).catch(error => { if (alive) setNote(error.message) }); return () => { alive = false } }, [format])
      async function write(action, body) {
        if (busy) return
        setBusy(true); setNote('')
        try {
          const result = await jsonFetch(BASE + '/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format, book, ...body }) })
          await refresh(); setNote('已保存'); return result
        } catch (error) { setNote(error.message) } finally { setBusy(false) }
      }
      return h('section', { 'aria-label': '生图世界书', style: S.card },
        h('div', { style: S.row }, promptField('世界书格式', h('select', { 'aria-label': '世界书格式', style: S.input, value: format, disabled: busy, onChange: event => setFormat(event.target.value) },
          PROMPT_MODES_UI.filter(([key]) => key !== 'auto').map(([key, label]) => h('option', { key, value: key }, label)))),
          h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: () => write('worldbook-add', {}) }, '新增条目'),
          h('a', { style: buttonStyle, href: BASE + '/worldbook-export?format=' + encodeURIComponent(format) + '&book=' + book, download: 'image-worldbook.json' }, '导出世界书'),
          h('label', { style: buttonStyle }, '导入世界书', h('input', { type: 'file', accept: '.json,.txt', disabled: busy, style: { maxWidth: 180 }, onChange: async event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file && await write('worldbook-import', { worldbook: await file.text() })) dropBookDrafts()
          } }))),
        h('div', { style: S.row }, books.map(item => h('button', { key: item.key, type: 'button', style: S.tab(item.key === book), onClick: () => setBook(item.key) }, item.name + ' · ' + (item.entries?.length ?? item.count ?? 0)))),
        h('details', { style: S.card }, h('summary', { style: PROMPT_DISCLOSURE }, '更新内置规则'),
          h(WorldbookUpgradePanel, { key: format + ':' + book, book, onApplied: refresh, request: (path, body) => jsonFetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, format }) }) })),
        (current?.entries || []).map((entry, at) => {
          const index = entry.index ?? at, key = keyOf(index), value = drafts[key] || entry
          const change = patch => setDrafts(all => ({ ...all, [key]: { ...(all[key] || entry), ...patch } }))
          return h('details', { key, style: S.card }, h('summary', { style: PROMPT_DISCLOSURE }, value.comment || '未命名条目'),
            h('div', { style: PROMPT_FIELDS },
              promptField('条目名称', h('input', { style: S.input, value: value.comment, onChange: event => change({ comment: event.target.value }) })),
              promptField('内容', h('textarea', { 'aria-label': '世界书条目内容', style: promptArea(100), value: value.content || '', onChange: event => change({ content: event.target.value }) })),
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: value.enabled !== false, onChange: event => change({ enabled: event.target.checked }) }), '启用'),
              promptField('触发方式', h('select', { style: S.input, value: value.activation || 'always', onChange: event => change({ activation: event.target.value }) }, h('option', { value: 'always' }, '常驻'), h('option', { value: 'keywords' }, '关键词'))),
              value.activation === 'keywords' ? h(React.Fragment, null,
                promptField('关键词', h('input', { style: S.input, value: (value.keywords || []).join(', '), onChange: event => change({ keywords: event.target.value.split(/[,，]/) }) })),
                promptField('附加关键词', h('input', { style: S.input, value: (value.andKeywords || []).join(', '), onChange: event => change({ andKeywords: event.target.value.split(/[,，]/) }) }))) : null,
              h('details', null, h('summary', { style: PROMPT_DISCLOSURE }, '适用渠道'),
                h('div', { style: S.row }, [{ id: 'comfyui', label: 'ComfyUI' }, ...providers.filter(item => item.id !== 'comfyui')].map(provider =>
                  h('label', { key: provider.id, style: S.row }, h('input', { type: 'checkbox', checked: (value.backends || []).includes(provider.id), onChange: event => change({ backends: event.target.checked ? [...new Set([...(value.backends || []), provider.id])] : (value.backends || []).filter(id => id !== provider.id) }) }), provider.id === 'atlascloud' ? 'Atlas兼容（自定义）' : provider.label || provider.id)))),
              h('div', { style: S.row }, h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: async () => { if (await write('worldbook-entry', { index, patch: value })) setDrafts(all => { const next = { ...all }; delete next[key]; return next }) } }, '保存条目'),
                h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: async () => { if (await write('worldbook-entry', { index, remove: true })) dropBookDrafts() } }, '删除条目'))))
        }), note ? h('div', { role: 'status', style: STRUCTURE_MUTED }, note) : null)
    }
