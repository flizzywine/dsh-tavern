
    // 两套世界书面板共用这组外壳：只放布局尺寸和颜色变量，两边引用同一份，
    // 以后改一处两边一起变，不再各长各的。
    const WB_ROW = {
      borderRadius: '10px',
      border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent)',
      background: 'var(--dsw-specific-input-major)',
      color: 'var(--dsw-alias-label-primary)',
      padding: '9px 11px',
    }
    const WB_PREVIEW = {
      marginTop: '8px',
      padding: '10px 12px',
      borderRadius: '8px',
      background: 'var(--dsw-specific-input-major)',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: '12px',
      lineHeight: '1.75',
      whiteSpace: 'pre-wrap',
      maxHeight: '340px',
      overflow: 'auto',
      border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)',
    }
    const WB_BOX = {
      marginTop: '10px',
      padding: '9px',
      borderRadius: '8px',
      background: 'var(--dsw-specific-input-major)',
      color: 'var(--dsw-alias-label-primary)',
      border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 24%, transparent)',
    }
    const WB_TEXTAREA = Object.assign({}, S.input, { width: '100%', minHeight: '130px', fontFamily: 'inherit', lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box' })
    const WB_EDIT_BUTTON = Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 10px' })
    const WB_DANGER_BUTTON = Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 10px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' })
    const wbPillStyle = on => Object.assign({}, buttonStyle, {
      fontSize: '12px',
      padding: '5px 12px',
      borderColor: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 85%, transparent)' : 'color-mix(in srgb, var(--dsw-alias-label-tertiary) 35%, transparent)',
      background: on ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)' : 'transparent',
      color: on ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-tertiary)',
    })
    const wbNoteStyle = text => ({ fontSize: '12px', color: /失败/.test(String(text || '')) ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' })

    // 卡片模式的世界书（原 dsh-tavern-gen）：分册 + 档位，数据在 /dsh-tavern-gen/api。
    // 和游玩模式的世界书是两份独立文件（card-worldbook.json），同一页里切换入口，互不覆盖。
    // 布局与交互和游玩那套对齐：分册 pill + 工具行 + 行式条目（预览 / 编辑两态），逐条即时保存；
    // 字段差异只在编辑态里体现——这里用档位（mode）替代触发方式和适用渠道。
    const CARD_WB_API = '/dsh-tavern-gen/api'
    const CARD_WB_MODES = [['always', 'always · 任何题材都读'], ['nsfw', 'nsfw · 性场景加读'], ['gore', 'gore · 猎奇加读'], ['lookup', 'lookup · 按词检索'], ['manual', 'manual · 改库时读'], ['prescan', 'prescan · 提交前扫']]
    const CARD_WB_HINT = {
      always: '任何题材都读：编写提示词前先套用。',
      nsfw: '只在性场景加读。',
      gore: '只在猎奇场景加读。',
      lookup: '不进常驻规则，工具按关键词查（素材表用这个）。',
      manual: '改人物库、服装库之前读。',
      prescan: '提交生成前扫一遍。',
    }

    function CardWorldbookPanel() {
      const [book, setBook] = React.useState(null)
      const [bucketId, setBucketId] = React.useState('')
      const [editing, setEditing] = React.useState('')
      const [open, setOpen] = React.useState({})
      const [drafts, setDrafts] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [error, setError] = React.useState('')
      const pending = React.useRef({})
      const timer = React.useRef(null)
      const flushing = React.useRef(null)

      const buckets = Array.isArray(book?.buckets) ? book.buckets : []
      const current = buckets.find(item => item.id === bucketId) || buckets[0] || null
      const entries = current && Array.isArray(current.entries) ? current.entries : []
      const keyOf = (bucket, id) => String(bucket || '') + '|' + String(id || '')
      const draftOf = entry => Object.assign(
        { title: entry.title || '', mode: entry.mode || 'always', enabled: entry.enabled !== false, content: entry.content || '' },
        drafts[keyOf(current?.id, entry.id)] || {},
      )
      const onCount = entries.filter(entry => entry.enabled !== false).length

      async function readBook() {
        const value = await jsonFetch(CARD_WB_API + '/worldbook', { cache: 'no-store' })
        if (!value?.worldbook) throw new Error('未返回卡片世界书')
        return value.worldbook
      }

      React.useEffect(() => {
        let live = true
        readBook()
          .then(value => { if (live) setBook(value) })
          .catch(reason => { if (live) setError('读不到卡片世界书：' + (reason?.message || reason)) })
        return () => { live = false }
      }, [])

      /** 本地草稿：打字时先显示，提交成功后再按字段值清掉，不和服务端回来的整本抢。 */
      function mergeDraft(bucket, id, patch) {
        const key = keyOf(bucket, id)
        setDrafts(all => Object.assign({}, all, { [key]: Object.assign({}, all[key] || {}, patch) }))
      }
      function dropDraft(bucket, id, patch) {
        const key = keyOf(bucket, id)
        setDrafts(all => {
          const here = all[key]
          if (!here) return all
          const next = Object.assign({}, here)
          let changed = false
          for (const field of Object.keys(patch)) if (next[field] === patch[field]) { delete next[field]; changed = true }
          if (!changed) return all
          const result = Object.assign({}, all)
          if (Object.keys(next).length) result[key] = next
          else delete result[key]
          return result
        })
      }

      async function sendPatch(bucket, id, patch, remove) {
        const value = await jsonFetch(CARD_WB_API + '/worldbook-entry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(remove ? { bucket, id, remove: true } : { bucket, id, patch }),
        })
        if (value?.book) setBook(value.book)
        return value
      }

      /** 把排队里的改动按顺序打完；返回 false 表示这批没写进去，草稿留在界面上。 */
      function flush() {
        if (timer.current) { clearTimeout(timer.current); timer.current = null }
        if (flushing.current) return flushing.current
        const task = (async () => {
          while (Object.keys(pending.current).length) {
            const batch = Object.entries(pending.current)
            pending.current = {}
            for (const [key, patch] of batch) {
              const cut = key.indexOf('|'), bucket = key.slice(0, cut), id = key.slice(cut + 1)
              try { await sendPatch(bucket, id, patch) }
              catch (reason) {
                pending.current[key] = Object.assign({}, patch, pending.current[key] || {})
                setError('保存失败：' + (reason?.message || reason))
                return false
              }
              dropDraft(bucket, id, patch)
            }
          }
          return true
        })()
        let wrapped = null
        wrapped = task.finally(() => { if (flushing.current === wrapped) flushing.current = null })
        flushing.current = wrapped
        return wrapped
      }

      /** 打字：先显示再排队，停 700ms 合并提交一次。空标题不提交，留在草稿里等补齐。 */
      function patchSoon(bucket, id, patch) {
        mergeDraft(bucket, id, patch)
        if (typeof patch.title === 'string' && !patch.title.trim()) { setNote('标题不能为空，先不保存'); return }
        const key = keyOf(bucket, id)
        pending.current[key] = Object.assign({}, pending.current[key] || {}, patch)
        setNote('输入中…')
        setError('')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { timer.current = null; flush().catch(() => {}) }, 700)
      }

      /** 勾选、档位这类点一下就落盘的动作：先打完排队，再单独提交这一次。 */
      async function patchNow(bucket, id, patch, tip) {
        mergeDraft(bucket, id, patch)
        try {
          if (!await flush()) return
          await sendPatch(bucket, id, patch)
          dropDraft(bucket, id, patch)
          setError('')
          setNote((tip || '改') + '已保存')
        } catch (reason) {
          setError((tip || '改') + '失败：' + (reason?.message || reason))
        }
      }

      async function addEntry() {
        if (!current || busy) return
        if (!await flush()) return
        setBusy(true); setError(''); setNote('')
        try {
          const value = await jsonFetch(CARD_WB_API + '/worldbook-add', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ bucket: current.id, entry: { title: '新条目', content: '', mode: 'always', enabled: true } }),
          })
          if (value?.book) setBook(value.book)
          if (value?.entry?.id) {
            setEditing(value.entry.id)
            setOpen(all => Object.assign({}, all, { [keyOf(current.id, value.entry.id)]: true }))
          }
          setNote('已新增条目')
        } catch (reason) { setError('加失败：' + (reason?.message || reason)) }
        finally { setBusy(false) }
      }

      async function removeEntry(id, label) {
        if (!current || busy) return
        if (!await flush()) return
        if (!window.confirm('删除「' + (label || '这条') + '」？删了找不回来。')) return
        setBusy(true); setError(''); setNote('')
        try {
          await sendPatch(current.id, id, null, true)
          if (editing === id) setEditing('')
          setNote('已删除')
        } catch (reason) { setError('删除失败：' + (reason?.message || reason)) }
        finally { setBusy(false) }
      }

      async function reloadBook() {
        if (!await flush()) return
        setBusy(true); setError(''); setNote('')
        try {
          setBook(await readBook())
          setDrafts({}); pending.current = {}; setEditing(''); setOpen({})
          setNote('已重新读取')
        } catch (reason) { setError('读不到卡片世界书：' + (reason?.message || reason)) }
        finally { setBusy(false) }
      }

      async function selectBucket(id) {
        if (!current || id === current.id) return
        if (!await flush()) return
        setBucketId(id); setEditing(''); setOpen({}); setNote(''); setError('')
      }

      /** 导出整本（不只当前分册）：复制到剪贴板；剪贴板不可用就下载成文件。 */
      async function exportBook() {
        if (!await flush()) return
        try {
          const text = JSON.stringify(await readBook(), null, 2)
          try {
            if (!navigator.clipboard?.writeText) throw new Error('浏览器未开放剪贴板权限')
            await navigator.clipboard.writeText(text)
            setNote('✓ 卡片世界书 JSON 已复制到剪贴板')
            if (typeof showToast === 'function') showToast('卡片世界书 JSON 已复制到剪贴板')
          } catch {
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = 'card-worldbook.json'
            document.body.appendChild(link)
            link.click()
            link.remove()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
            setNote('剪贴板不可用，已下载 card-worldbook.json')
          }
        } catch (reason) { setError('导出失败：' + (reason?.message || reason)) }
      }

      if (!book) {
        return h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } },
          error || '正在读取卡片世界书…',
          error ? h('button', { type: 'button', style: Object.assign({}, S.tab(false), { marginLeft: '10px' }), onClick: reloadBook }, '重试') : null)
      }
      if (!current) {
        return h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } },
          '这份世界书还没有分册。',
          error ? h('div', { role: 'alert', style: { marginTop: '8px', color: 'var(--dsw-alias-state-error-primary)' } }, error) : null)
      }

      return h('fieldset', { disabled: busy, 'aria-busy': busy, style: Object.assign({}, S.card, { minWidth: 0 }) },
        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '8px' } },
          '卡片工作台里的规则：always 写提示词前读，prescan 提交前扫，manual 改库前读，lookup 由工具按关键词查。'),
        h('div', { style: { fontSize: '13px', marginBottom: '8px' } },
          '卡片世界书（' + onCount + ' / ' + entries.length + ' 条启用）'),
        h('div', { style: { display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' } },
          buckets.map(bucket => h('button', {
            key: bucket.id,
            type: 'button',
            title: '分册 ' + bucket.id + '；点一下切到这一册',
            style: wbPillStyle(current.id === bucket.id),
            onClick: () => selectBucket(bucket.id),
          }, '📖 ' + (bucket.label || bucket.id) + '（' + (Array.isArray(bucket.entries) ? bucket.entries.length : 0) + ' 条）'))),
        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '10px' } },
          '启用的条目会写进卡片工作台的规则索引；停用的留在文件里但不生效。改一处存一处，不用记着点保存。'),
        h('div', { style: S.row },
          h('button', { style: buttonStyle, onClick: addEntry, disabled: busy }, '➕ 新条目'),
          h('button', { style: buttonStyle, onClick: exportBook }, '📤 导出（复制 JSON）'),
          h('button', { style: buttonStyle, onClick: reloadBook, disabled: busy }, '🔄 刷新'),
          busy ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, '处理中…') : null,
          note && !busy ? h('span', { style: wbNoteStyle(note) }, note) : null),
        error ? h('div', { role: 'alert', style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)', margin: '6px 0' } }, error) : null,
        h('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' } },
          entries.length ? entries.map((entry, index) => {
            const draft = draftOf(entry)
            const key = keyOf(current.id, entry.id)
            const isEditing = editing === entry.id
            return h('div', { key, style: WB_ROW },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                h('input', {
                  type: 'checkbox', checked: draft.enabled, title: '启用 / 停用这条', disabled: busy,
                  onChange: event => patchNow(current.id, entry.id, { enabled: event.target.checked }, '启用状态'),
                }),
                h('span', {
                  style: {
                    flex: 1, minWidth: 0, fontSize: '13px',
                    color: draft.enabled ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-tertiary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  },
                }, String(index + 1) + '. ' + (draft.title || '（未命名）')),
                h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 } }, draft.mode),
                h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 } }, String(draft.content).length + ' 字'),
                h('button', {
                  style: Object.assign({}, buttonStyle, { fontSize: '11px', padding: '2px 8px' }),
                  title: '只读预览这条内容，不影响编辑',
                  onClick: () => setOpen(all => Object.assign({}, all, { [key]: !all[key] })),
                }, open[key] ? '▾ 收起' : '▸ 内容'),
                h('button', { style: WB_EDIT_BUTTON, onClick: () => setEditing(isEditing ? '' : entry.id) }, isEditing ? '收起' : '编辑'),
                h('button', { style: WB_DANGER_BUTTON, onClick: () => removeEntry(entry.id, draft.title) }, '删'),
              ),
              open[key] && !isEditing ? h('div', { style: WB_PREVIEW }, String(draft.content).trim() || '（这条还没有内容）') : null,
              isEditing ? h('div', { style: { marginTop: '8px' } },
                h('input', {
                  type: 'text', value: draft.title, placeholder: '条目标题', disabled: busy,
                  style: Object.assign({}, S.input, { width: '100%', marginBottom: '6px' }),
                  onChange: event => patchSoon(current.id, entry.id, { title: event.target.value }),
                }),
                h('textarea', {
                  value: draft.content, placeholder: '条目内容（作为画图规则发给模型）', disabled: busy, style: WB_TEXTAREA,
                  onChange: event => patchSoon(current.id, entry.id, { content: event.target.value }),
                }),
                h('div', { style: WB_BOX },
                  h('div', { style: { fontSize: '12px', marginBottom: '6px' } }, '档位'),
                  h('select', {
                    value: draft.mode, 'aria-label': '档位 ' + entry.id, disabled: busy,
                    style: Object.assign({}, S.input, { width: '100%', maxWidth: '320px' }),
                    onChange: event => patchNow(current.id, entry.id, { mode: event.target.value }, '档位'),
                  }, CARD_WB_MODES.map(([mode, label]) => h('option', { key: mode, value: mode }, label))),
                  h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '6px' } }, CARD_WB_HINT[draft.mode] || ''),
                ),
                h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '4px' } }, '改动即时保存。'),
              ) : null,
            )
          }) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '12px' } }, '这一册还没有条目。点「➕ 新条目」自己写一条。'),
        ),
      )
    }
