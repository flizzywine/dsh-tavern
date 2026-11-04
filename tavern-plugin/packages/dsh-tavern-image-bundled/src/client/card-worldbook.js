    const CARD_WB_MODES = [['always', 'always · 任何题材都读'], ['nsfw', 'nsfw · 性场景加读'], ['gore', 'gore · 猎奇加读'], ['lookup', 'lookup · 按词检索'], ['manual', 'manual · 改库时读'], ['prescan', 'prescan · 提交前扫']]
    function CardWorldbookPanel() {
      const [book, setBook] = React.useState(null)
      const [bucketId, setBucketId] = React.useState('')
      const [drafts, setDrafts] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const [reloadKey, setReloadKey] = React.useState(0)
      const saving = React.useRef(false)

      React.useEffect(() => {
        let alive = true
        setError(''); setNote(''); setDrafts({})
        jsonFetch('/dsh-tavern-gen/api/worldbook')
          .then(value => { if (!value?.worldbook) throw new Error('未返回卡片世界书'); if (alive) setBook(value.worldbook) })
          .catch(reason => { if (alive) setError('读不到卡片世界书：' + (reason && reason.message ? reason.message : reason)) })
        return () => { alive = false }
      }, [reloadKey])

      if (!book) {
        return h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } },
          error || '正在读取卡片世界书…',
          error ? h('button', { type: 'button', style: Object.assign({}, S.tab(false), { marginLeft: '10px' }), onClick: () => setReloadKey(key => key + 1) }, '重试') : null)
      }

      const buckets = Array.isArray(book.buckets) ? book.buckets : []
      const current = buckets.find(item => item.id === bucketId) || buckets[0]
      const entries = current && Array.isArray(current.entries) ? current.entries : []
      const draftKey = (bucket, id) => JSON.stringify([bucket, id])
      const draftOf = entry => Object.assign({ title: entry.title || '', mode: entry.mode || 'always', enabled: entry.enabled !== false, content: entry.content || '' }, drafts[draftKey(current.id, entry.id)] || {})
      const patchDraft = (id, patch) => { const key = draftKey(current.id, id); setDrafts(all => Object.assign({}, all, { [key]: Object.assign({}, all[key] || {}, patch) })) }
      const dirty = Object.keys(drafts).length > 0

      const save = async () => {
        if (!current || saving.current) return
        saving.current = true
        setBusy(true); setError(''); setNote('')
        try {
          const nextBuckets = buckets.map(item => Object.assign({}, item, { entries: item.entries.map(entry => Object.assign({}, entry, drafts[draftKey(item.id, entry.id)] || {})) }))
          const value = await jsonFetch('/dsh-tavern-gen/api/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ target: 'worldbook', content: Object.assign({}, book, { buckets: nextBuckets }) }),
          })
          setBook(value.worldbook || Object.assign({}, book, { buckets: nextBuckets }))
          setDrafts(all => Object.fromEntries(Object.entries(all).filter(([id, value]) => JSON.stringify(value) !== JSON.stringify(drafts[id]))))
          setNote('卡片世界书已保存')
        } catch (reason) {
          setError('保存失败：' + (reason && reason.message ? reason.message : reason))
        } finally {
          saving.current = false
          setBusy(false)
        }
      }

      const tabRow = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' } },
        buckets.map(bucket => h('button', {
          key: bucket.id, type: 'button', disabled: busy, onClick: () => setBucketId(bucket.id),
          style: S.tab(current && current.id === bucket.id),
        }, (bucket.label || bucket.id) + ' · ' + (Array.isArray(bucket.entries) ? bucket.entries.length : 0))))

      const list = entries.map(entry => {
        const draft = draftOf(entry)
        const changed = Object.prototype.hasOwnProperty.call(drafts, draftKey(current.id, entry.id))
        return h('details', { key: draftKey(current.id, entry.id), style: Object.assign({}, S.card, { margin: '8px 0' }) },
          h('summary', { style: { cursor: 'pointer', fontSize: '12px', color: 'var(--dsw-alias-label-primary)' } },
            (draft.enabled ? '' : '（停用）') + (draft.title || entry.id) + ' · ' + draft.mode + (changed ? ' · 未保存' : '')),
          h('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('input', {
              type: 'text', value: draft.title, disabled: busy, 'aria-label': '卡片条目标题 ' + entry.id, placeholder: '条目标题',
              style: Object.assign({}, S.input, { width: '100%' }),
              onChange: event => patchDraft(entry.id, { title: event.target.value }),
            }),
            h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
              h('select', {
                value: draft.mode, disabled: busy, 'aria-label': '卡片条目档位 ' + entry.id, style: S.input,
                onChange: event => patchDraft(entry.id, { mode: event.target.value }),
              }, CARD_WB_MODES.map(([key, label]) => h('option', { key, value: key }, label))),
              h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px' } },
                h('input', { type: 'checkbox', checked: draft.enabled, disabled: busy, onChange: event => patchDraft(entry.id, { enabled: event.target.checked }) }),
                '启用')),
            h('textarea', {
              value: draft.content, disabled: busy, 'aria-label': '卡片条目内容 ' + entry.id, rows: 8, spellCheck: false,
              style: Object.assign({}, S.input, { width: '100%', fontFamily: 'ui-monospace, Consolas, monospace', lineHeight: 1.6 }),
              onChange: event => patchDraft(entry.id, { content: event.target.value }),
            }),
          ))
      })

      return h('div', null,
        tabRow,
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px' } },
          h('button', { type: 'button', onClick: save, disabled: busy || !dirty, style: Object.assign({}, S.tab(true), { opacity: busy || !dirty ? 0.55 : 1 }) }, busy ? '保存中…' : '保存卡片世界书'),
          h('span', { style: { fontSize: '12px', color: dirty ? 'var(--dsw-alias-state-warning-primary)' : 'var(--dsw-alias-label-tertiary)' } },
            dirty ? '有未保存的修改' : '改动要先保存才生效'),
          note ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, note) : null,
          error ? h('span', { role: 'alert', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } }, error, h('button', { type: 'button', onClick: () => { if (!dirty || window.confirm('重新载入会放弃尚未保存的卡片世界书修改，继续吗？')) { setBook(null); setReloadKey(key => key + 1) } } }, '重新载入卡片世界书')) : null,
        ),
        h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
          '规则用于卡片工作台；素材条目标记 lookup 后可按关键词查找。'),
        list.length ? h('div', null, list) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } }, '这一册还没有条目。'))
    }
