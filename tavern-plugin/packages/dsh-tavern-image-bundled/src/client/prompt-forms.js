    function PromptSubjectFields({ value, onChange, definitions = {}, editable = true, inputs = [] }) {
      const people = (definitions.characters || []).filter(item => item.enabled !== false)
      const person = people.find(item => item.id === value.characterId)
      const outfits = [...(person?.outfits || []), ...(definitions.outfits || [])].filter(item => item.enabled !== false)
      const options = (list, id) => h(React.Fragment, null,
        h('option', { value: '' }, '自动'),
        id && !list.some(item => item.id === id) && !inputs.some(input => '{{' + input.key + '}}' === id)
          ? h('option', { value: id }, '已不可用 · ' + id) : null,
        list.map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)),
        inputs.filter(input => input.key).map(input => h('option', { key: 'input-' + input.key, value: '{{' + input.key + '}}' }, '模板输入 · ' + (input.label || input.key))))
      return h('div', { style: PROMPT_FIELDS },
        h('div', { className: 'dti-inline-block-title' },
          promptField('指定角色', h('select', { 'aria-label': '指定角色', style: S.input, disabled: !editable, value: value.characterId || '',
            onChange: event => onChange({ characterId: event.target.value, outfitId: '' }) }, options(people, value.characterId))),
          promptField('指定服装', h('select', { 'aria-label': '指定服装', style: S.input, disabled: !editable, value: value.outfitId || '',
            onChange: event => onChange({ outfitId: event.target.value }) }, options(outfits, value.outfitId))),
          promptField('人物朝向', h('select', { 'aria-label': '人物朝向', style: S.input, disabled: !editable, value: value.angle || 'front',
            onChange: event => onChange({ angle: event.target.value }) },
            h('option', { value: 'front' }, '正面'), h('option', { value: 'back' }, '背影')))),
        promptField('本次状态', h('textarea', { 'aria-label': '本次状态', style: promptArea(54), value: value.state || '', maxLength: 1000,
          readOnly: !editable, placeholder: '例如：袖口卷起，衣服被雨淋湿', onChange: event => onChange({ state: event.target.value }) })))
    }

    function PromptInputEditor({ inputs = [], onChange, editable }) {
      const patch = (index, change) => onChange(inputs.map((input, at) => at === index ? { ...input, ...change } : input))
      return h('details', { className: 'dti-template-library' },
        h('summary', { className: 'dti-structure-heading' }, h('strong', null, '模板输入'), h('span', { style: STRUCTURE_MUTED }, inputs.length + ' 项')),
        h('div', { className: 'dti-entry-library' },
          h('p', { style: STRUCTURE_MUTED }, '在模块内容中使用 {{标识}}，试写时填入本次的地点、动作等内容。'),
          inputs.map((input, index) => h('div', { key: index, className: 'dti-entry-editor' },
            h('div', { className: 'dti-inline-block-title' },
              promptField('输入名称', h('input', { 'aria-label': '输入名称', style: S.input, value: input.label, readOnly: !editable, maxLength: 60,
                onChange: event => patch(index, { label: event.target.value }) })),
              promptField('输入标识', h('input', { 'aria-label': '输入标识', style: S.input, value: input.key, readOnly: !editable, maxLength: 40,
                placeholder: 'location', onChange: event => patch(index, { key: event.target.value }) }))),
            promptField('默认内容', h('textarea', { 'aria-label': '默认内容', style: promptArea(54), value: input.default || '', readOnly: !editable, maxLength: 2000,
              onChange: event => patch(index, { default: event.target.value }) })),
            h('div', { style: S.row },
              h('label', { style: S.row }, h('input', { type: 'checkbox', checked: input.required === true, disabled: !editable,
                onChange: event => patch(index, { required: event.target.checked }) }), '必填'),
              editable ? h('button', { type: 'button', style: buttonStyle, onClick: () => onChange(inputs.filter((_, at) => at !== index)) }, '删除输入') : null))),
          editable ? h('button', { type: 'button', style: buttonStyle, disabled: inputs.length >= 12, onClick: () => {
            let suffix = inputs.length + 1
            while (inputs.some(input => input.key === 'input' + suffix)) suffix++
            onChange([...inputs, { key: 'input' + suffix, label: '新输入', default: '', required: false }])
          } }, '添加模板输入') : null))
    }

    function PromptAssemblyTrace({ result }) {
      const trace = result?.assembly
      const entries = result?.entryTrace
      if (!trace && !entries) return null
      const reasons = { disabled: '已停用', group: '分组不符', 'no-trigger': '未设置触发词', excluded: '排除词命中', 'all-miss': '缺少必须同时出现的词',
        'keyword-miss': '关键词未命中', limit: '超过条数限制', budget: '超过文本预算', always: '始终候选', matched: '关键词命中' }
      const skipped = (entries?.decisions || []).filter(item => !['always', 'matched'].includes(item.reason))
      return h('details', { className: 'dti-tryout-meta' },
        h('summary', null, '查看组装过程'),
        trace ? h('div', { className: 'dti-tryout-text' },
          h('div', null, '用途 · ' + (trace.usage || 'story')),
          trace.contextChars ? h('div', null, '本次模型输入约 ' + trace.contextChars + ' 字符') : null,
          trace.modules?.length ? h('div', null, '模块顺序 · ' + trace.modules.map(item => item.title).join(' → ')) : null,
          Object.entries(trace.inputs || {}).map(([key, value]) => h('div', { key }, key + ' · ' + (value || '空'))),
          trace.materials?.map((item, index) => h('div', { key: index },
            h('strong', null, [item.characterName, item.outfitName, item.angle === 'back' ? '背影' : '正面'].filter(Boolean).join(' · ')),
            h('pre', null, item.positive), item.referenceCount ? h('div', null, '参考图 ' + item.referenceCount + ' 张') : null))) : null,
        entries ? h('div', null,
          h('div', null, '词条 ' + entries.matches.length + ' / ' + entries.maxEntries + ' 条，资料文本 ' + entries.usedChars + ' / ' + entries.maxChars + ' 字符'),
          entries.reason === 'no-module' ? h('div', null, '当前用途没有启用词条模块') : null,
          skipped.length ? h('details', null, h('summary', null, '未采用的词条 · ' + skipped.length),
            skipped.map(item => h('div', { key: item.id }, item.title + ' · ' + (reasons[item.reason] || item.reason)))) : null) : null)
    }
