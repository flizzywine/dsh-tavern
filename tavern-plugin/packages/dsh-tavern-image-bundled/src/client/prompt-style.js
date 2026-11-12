    function PresetTextField({ value, multiline, placeholder, style, ariaLabel, onCommit }) {
      const ref = React.useRef(null)
      const timer = React.useRef(null)
      React.useEffect(() => {
        const el = ref.current
        // 只在外部值真的变了才改 DOM（切预设这类）；自己保存回来时两者相等，不碰光标。
        if (el && el.value !== (value ?? '')) el.value = value ?? ''
      }, [value])
      const change = event => {
        const next = event.target.value
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { timer.current = null; onCommit(next) }, 400)
      }
      // 失焦立刻落地，不用等那 400ms，也别在切页时把刚敲的字带走。
      const flush = event => {
        if (!timer.current) return
        clearTimeout(timer.current)
        timer.current = null
        onCommit(event.target.value)
      }
      const props = { ref, defaultValue: value ?? '', onChange: change, onBlur: flush, placeholder, style, 'aria-label': ariaLabel }
      return multiline ? h('textarea', props) : h('input', Object.assign({ type: 'text' }, props))
    }

    function ImageStylePanel({ config, save }) {
        const [editing, setEditing] = React.useState(null)
        const [importNote, setImportNote] = React.useState('')
        const [importing, setImporting] = React.useState(false)
        const latest = React.useRef(config)
        latest.current = config
        const [dragState, setDragState] = React.useState(null)
        const presets = Array.isArray(config.stylePresets) ? config.stylePresets : []
        const active = String(config.activePreset ?? '')
        const activeName = (presets.find(p => String(p.id) === active) || {}).name
        const presetKey = (item, index) => String(item.id || index)
        const expandPreset = id => setEditing(current => current === id ? null : id)

        const savePresets = (next) => save({ stylePresets: next })
        const patch = (i, patchObj) => {
          const next = presets.slice()
          next[i] = Object.assign({}, next[i], patchObj)
          savePresets(next)
        }
        const add = async () => {
          const created = {
            id: 'p' + Date.now(), name: '画风 ' + (presets.length + 1),
            artist: '', negative: '', position: 'prefix', enabled: true,
          }
          if (await save({ stylePresets: [...presets, created] })) setEditing(created.id)
        }
        async function importStyles(event) {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file || importing) return
          setImporting(true)
          setImportNote('')
          try {
            const payload = JSON.parse((await file.text()).replace(/^\uFEFF/, ''))
            const data = payload?.data?.config ?? payload
            const incoming = Array.isArray(data) ? data : [
              ...(Array.isArray(data?.stylePresets) ? data.stylePresets : []),
              ...(Array.isArray(data?.artistSets) ? data.artistSets : []),
              ...(data?.styleArtists || data?.styleNegative ? [{ id: 'imported-default-style', name: '备份中的默认画风',
                artist: data.styleArtists, negative: data.styleNegative }] : []),
            ]
            const current = latest.current.stylePresets || []
            const ids = new Set(current.map(style => String(style.id)))
            const added = []
            for (const [index, style] of incoming.entries()) {
              if (current.length + added.length >= 60) break
              if (!style || typeof style !== 'object' || !['artist', 'text', 'negative', 'params'].some(key => Object.hasOwn(style, key))) continue
              const id = String(style.id ?? 'imported-style-' + (index + 1)).trim().slice(0, 60) || 'imported-style-' + (index + 1)
              if (ids.has(id)) continue
              ids.add(id)
              added.push({ id, name: String(style.name || '画风 ' + (index + 1)), artist: String(style.artist ?? style.text ?? ''),
                negative: String(style.negative ?? ''), position: style.position, enabled: style.enabled !== false, params: style.params })
            }
            if (!added.length) { setImportNote('没有可新增的画风。相同 ID 会保留库里的版本，画风库最多 60 套。'); return }
            const saved = await save({ stylePresets: [...current, ...added] })
            setImportNote(saved ? '已导入 ' + added.length + ' 套画风' : '画风保存失败')
          } catch {
            setImportNote('无法读取画风。请选择旧配置或生图备份 JSON。')
          } finally {
            setImporting(false)
          }
        }
        const remove = (i) => {
          if (!confirm('删除这套画风？')) return
          const next = presets.slice()
          const gone = next.splice(i, 1)[0]
          save({ stylePresets: next, ...(gone && String(gone.id) === active ? { activePreset: '' } : {}) })
        }
        // Moving one preset keeps the relative order of all the others.
        const movePreset = (fromKey, toKey) => {
          const from = presets.findIndex((item, index) => presetKey(item, index) === fromKey)
          const to = presets.findIndex((item, index) => presetKey(item, index) === toKey)
          if (from < 0 || to < 0 || from === to) return
          const next = presets.slice()
          const [moved] = next.splice(from, 1)
          next.splice(to, 0, moved)
          savePresets(next)
        }
        const ta = (hgt) => Object.assign({}, S.input, {
          width: '100%', minHeight: hgt, fontFamily: 'ui-monospace, Consolas, monospace',
          lineHeight: '1.6', resize: 'vertical', boxSizing: 'border-box', fontSize: '12px',
        })
        const optStyle = {}
        // 每套画风预设自己的生成参数（空 = 跟渠道设置）
        const PRESET_SAMPLERS = [['k_euler_ancestral', 'Euler Ancestral'], ['k_euler', 'Euler'], ['k_dpmpp_2m', 'DPM++ 2M'], ['k_dpmpp_2s_ancestral', 'DPM++ 2S Anc'], ['k_dpmpp_sde', 'DPM++ SDE'], ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'], ['ddim_v3', 'DDIM'], ['k_lms', 'LMS'], ['k_heun', 'Heun'], ['k_dpm_2', 'DPM2'], ['k_dpm_2_ancestral', 'DPM2 Anc']]
        const PRESET_NOISE = [['karras', 'Karras'], ['native', 'Native'], ['exponential', 'Exponential'], ['polyexponential', 'Polyexponential']]
        const PRESET_UC = [['0', '0 · 强（Heavy）'], ['1', '1 · 弱（Light）'], ['2', '2 · Furry'], ['3', '3 · Human（默认）'], ['4', '4 · 不指定']]
        const paramValue = (p, key) => (p.params && p.params[key] !== undefined && p.params[key] !== null ? String(p.params[key]) : '')
        const setParam = (i, p, key, value) => {
          const next = Object.assign({}, p.params || {})
          if (value === undefined) delete next[key]
          else next[key] = value
          patch(i, { params: next })
        }
        const PARAM_ROW = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px 12px' }
        const paramGroupTitle = (text, first) => h('div', {
          style: { fontSize: '11px', letterSpacing: '.02em', color: 'var(--dsw-alias-label-tertiary)', margin: first ? '0 0 6px' : '12px 0 6px', paddingTop: first ? '0' : '10px', borderTop: first ? 'none' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent)' },
        }, text)
        const paramField = (caption, control) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '0' } },
          h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, caption), control)
        const paramSelect = (i, p, key, caption, items) => paramField(caption,
          h('select', { value: paramValue(p, key), title: caption + '：留空表示沿用渠道设置', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => setParam(i, p, key, e.target.value === '' ? undefined : e.target.value) },
            h('option', { value: '', style: optStyle }, '跟随渠道'),
            items.map(([value, text]) => h('option', { key: value, value, style: optStyle }, text))))
        const paramNumber = (i, p, key, caption, step) => paramField(caption,
          h('input', { type: 'number', step: step || '1', value: paramValue(p, key), placeholder: '跟随渠道', title: caption + '：留空表示沿用渠道设置', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => setParam(i, p, key, e.target.value.trim() === '' ? undefined : Number(e.target.value)) }))
        const paramBool = (i, p, key, caption) => paramField(caption,
          h('select', { value: paramValue(p, key), title: caption + '：跟随渠道表示沿用渠道设置', style: Object.assign({}, S.input, { width: '100%', boxSizing: 'border-box' }), onChange: e => setParam(i, p, key, e.target.value === '' ? undefined : e.target.value === 'true') },
            h('option', { value: '', style: optStyle }, '跟随渠道'),
            h('option', { value: 'true', style: optStyle }, '开'),
            h('option', { value: 'false', style: optStyle }, '关')))

        return h('div', { style: S.card },
          h('div', { style: { fontSize: '13px', marginBottom: '4px' } },
            '画风预设（' + presets.length + ' 套）' + (activeName ? '　当前：' + activeName : '　当前：默认')),
          h('div', { style: S.row },
            h('button', { type: 'button', style: buttonStyle, onClick: add, disabled: presets.length >= 60 }, '新增一套'),
            h('button', { type: 'button', style: buttonStyle, onClick: () => save({ activePreset: '' }), disabled: !active }, '使用默认画风'),
            h('label', { style: { ...buttonStyle, cursor: 'pointer' } }, '导入旧画风',
              h('input', { type: 'file', accept: '.json,application/json', 'aria-label': '导入旧画风', disabled: importing,
                style: { position: 'absolute', width: 1, height: 1, opacity: 0 }, onChange: importStyles })),
          ),
          importNote ? h('div', { role: 'status', style: STRUCTURE_MUTED }, importNote) : null,
          h('p', { style: STRUCTURE_MUTED }, '在画风模块的「画风来源」选用库里的预设。'),
          presets.length ? h('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: 'min(56vh, 520px)', overflowY: 'auto', padding: '2px 4px 2px 2px' } },
            presets.map((p, i) => {
              const presetId = presetKey(p, i)
              const expanded = editing === presetId
              const isDragging = Boolean(dragState && dragState.from === presetId)
              const isDropTarget = Boolean(dragState && dragState.over === presetId && dragState.from !== presetId)
              return h('div', {
                key: p.id || i,
                'data-preset-card': presetId,
                onDragOver: event => {
                  if (!dragState) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  // 只在目标变了才更新，否则每一帧都重渲染
                  setDragState(state => (!state || state.over === presetId) ? state : Object.assign({}, state, { over: presetId }))
                },
                onDrop: event => {
                  event.preventDefault()
                  const from = event.dataTransfer.getData('application/x-dsh-image-preset')
                  setDragState(null)
                  if (from) movePreset(from, presetId)
                },
                style: {
                  borderRadius: '10px', padding: '10px 12px',
                  border: isDropTarget
                    ? '1px solid var(--dsw-alias-brand-primary)'
                    : String(p.id) === active ? '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 75%, transparent)' : '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 22%, transparent)',
                  background: String(p.id) === active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent)' : 'var(--dsw-specific-input-major)', color: 'var(--dsw-alias-label-primary)',
                  // 拖起来的那张淡掉，目标那张亮起来 —— 松手就是这两张换位
                  opacity: isDragging ? 0.4 : 1,
                  boxShadow: isDropTarget ? '0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent)' : 'none',
                  transition: 'opacity .12s, box-shadow .12s',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: expanded ? '8px' : '0' } },
                  h('input', { type: 'radio', name: 'rphub-preset', checked: String(p.id) === active, title: '用这一套', onChange: () => save({ activePreset: String(p.id) }) }),
                  h(PresetTextField, {
                    value: p.name || '', placeholder: '这套叫什么（古风写实 / 二次元厚涂…）',
                    style: Object.assign({}, S.input, { flex: 1, minWidth: '100px' }),
                    ariaLabel: '这套画风的名字',
                    onCommit: value => patch(i, { name: value }),
                  }),
                  h('select', {
                    value: p.position === 'suffix' ? 'suffix' : 'prefix',
                    style: Object.assign({}, S.input, { width: '78px', padding: '3px 4px' }),
                    onChange: e => patch(i, { position: e.target.value }),
                    title: '这套词放在提示词的最前还是最后',
                  },
                    h('option', { value: 'prefix', style: optStyle }, '最前'),
                    h('option', { value: 'suffix', style: optStyle }, '最后'),
                  ),
                  h('button', {
                    style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 6px' }),
                    title: expanded ? '收起这套的详细内容' : '展开这套的详细内容',
                    'aria-expanded': expanded, 'aria-label': (expanded ? '收起 ' : '编辑 ') + (p.name || (i + 1)),
                    onClick: () => expandPreset(presetId),
                  }, expanded ? '▾' : '▸'),
                  h('button', { style: Object.assign({}, buttonStyle, { fontSize: '12px', padding: '3px 8px', borderColor: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 60%, transparent)', color: 'var(--dsw-alias-state-error-primary)' }), onClick: () => remove(i) }, '删'),
                  h('button', {
                    type: 'button', title: '上移预设', 'aria-label': '上移 ' + (p.name || (i + 1)),
                    disabled: i === 0, style: Object.assign({}, buttonStyle, { padding: '3px 6px' }),
                    onClick: () => movePreset(presetId, presetKey(presets[i - 1], i - 1)),
                  }, '上移'),
                  h('button', {
                    type: 'button', title: '下移预设', 'aria-label': '下移 ' + (p.name || (i + 1)),
                    disabled: i === presets.length - 1, style: Object.assign({}, buttonStyle, { padding: '3px 6px' }),
                    onClick: () => movePreset(presetId, presetKey(presets[i + 1], i + 1)),
                  }, '下移'),
                  h('div', {
                    draggable: true,
                    title: '按住拖动，调整这套预设的位置',
                    'aria-label': '拖动排序 ' + (p.name || (i + 1)),
                    style: { cursor: 'grab', userSelect: 'none', padding: '2px 6px', fontSize: '15px', lineHeight: '1', letterSpacing: '-1px', color: 'var(--dsw-alias-label-tertiary)', borderRadius: '6px' },
                    onDragStart: event => {
                      event.dataTransfer.setData('application/x-dsh-image-preset', presetId)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragState({ from: presetId })
                      // 默认拖影就是这一个小方块，换成整张卡片
                      const card = event.currentTarget.closest('[data-preset-card]')
                      if (card) event.dataTransfer.setDragImage(card, 24, 18)
                    },
                    onDragEnd: () => setDragState(null),
                  }, '⠿'),
                ),
                expanded ? h('div', null,
                  h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', marginBottom: '4px' } }, '正面：画师串 / 风格词'),
                  h(PresetTextField, {
                    multiline: true, value: p.artist || '', placeholder: '(@artist_a:1.1), (@artist_b:1.0), masterpiece, best quality',
                    style: ta('72px'),
                    ariaLabel: '这套画风的正面词',
                    onCommit: value => patch(i, { artist: value }),
                  }),
                  h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', margin: '6px 0 4px' } }, '这套的负面固定词（会并进负面）'),
                  h(PresetTextField, {
                    multiline: true, value: p.negative || '', placeholder: 'worst quality, low quality, bad hands',
                    style: ta('46px'),
                    ariaLabel: '这套画风的负面词',
                    onCommit: value => patch(i, { negative: value }),
                  }),
                  h('details', { style: { marginTop: '10px' } },
                    h('summary', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', padding: '2px 0' } }, '这套自己的生成参数（采样 / 步数 / CFG / NovelAI 高级…；留空 = 跟随渠道）'),
                    h('div', { style: { marginTop: '8px', padding: '12px 14px', borderRadius: '8px', background: 'var(--dsw-specific-input-major)', border: '1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent)' } },
                      paramGroupTitle('采样', true),
                      h('div', { style: PARAM_ROW },
                        paramSelect(i, p, 'sampler', '采样器', PRESET_SAMPLERS),
                        paramSelect(i, p, 'noiseSchedule', '噪点表', PRESET_NOISE)),
                      paramGroupTitle('步数与 CFG'),
                      h('div', { style: PARAM_ROW },
                        paramNumber(i, p, 'steps', '步数', '1'),
                        paramNumber(i, p, 'cfg', 'CFG', '0.1'),
                        paramNumber(i, p, 'cfgRescale', 'CFG Rescale', '0.01')),
                      paramGroupTitle('NovelAI 高级'),
                      h('div', { style: PARAM_ROW },
                        paramNumber(i, p, 'uncondScale', 'Uncond Scale', '0.1'),
                        paramNumber(i, p, 'skipCfgAboveSigma', 'Skip CFG Sigma', '0.1')),
                      paramGroupTitle('官方预设（NovelAI）'),
                      h('div', { style: PARAM_ROW },
                        paramSelect(i, p, 'ucPreset', '负面预设（ucPreset）', PRESET_UC),
                        paramBool(i, p, 'qualityToggle', '质量词（qualityToggle）'),
                        paramBool(i, p, 'varietyBoost', '多样性（variety_boost）'))),
                  ),
                ) : null,
              )
            }),
          ) : h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', padding: '10px 0' } }, '还没有画风预设。点「新增一套」开始。'),

          h('details', { style: { marginTop: 12 } },
            h('summary', { style: PROMPT_DISCLOSURE }, '默认画风'),
            h('div', { style: PROMPT_FIELDS },
              h('label', null, '默认画师串', h(PresetTextField, {
                value: config.styleArtists || '', multiline: true, ariaLabel: '默认画师串',
                style: promptArea(64), onCommit: value => save({ styleArtists: value }),
              })),
              h('label', null, '默认负面', h(PresetTextField, {
                value: config.styleNegative || '', multiline: true, ariaLabel: '默认负面',
                style: promptArea(64), onCommit: value => save({ styleNegative: value }),
              })))),
        )
    }

    function InlineStyleEditor({ config, save, styleId }) {
      const style = (config.stylePresets || []).find(item => item.id === styleId)
      const latest = React.useRef(config)
      latest.current = config
      const patch = change => save({ stylePresets: (latest.current.stylePresets || []).map(item => item.id === styleId ? { ...item, ...change } : item) })
      return h('div', { style: PROMPT_FIELDS, 'aria-label': '引用画风编辑' },
        style ? h(React.Fragment, null,
          h('strong', null, style.name),
          promptField('画风正面词', h(PresetTextField, { multiline: true, value: style.artist || '', style: promptArea(72), ariaLabel: '引用画风正面词', onCommit: artist => patch({ artist }) })),
          promptField('画风排除词', h(PresetTextField, { multiline: true, value: style.negative || '', style: promptArea(54), ariaLabel: '引用画风排除词', onCommit: negative => patch({ negative }) })),
          h('span', { style: STRUCTURE_MUTED }, '修改会保存到资料库，并用于其他引用这套画风的模板。'))
          : h('p', { style: STRUCTURE_MUTED }, '先在画风来源中选择资料库里的画风。'))
    }
