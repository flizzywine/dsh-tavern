// Player-only MVU variable inspector for the current story floor. Editing is a
// direct card-side write; it never reaches the foreground model or reruns MVU.
function TavernMvuVariables(props) {
  const h = React.createElement;
  const view = props.view || {};
  const helper = view.tavernHelper || null;
  const floor = React.useMemo(function () { return readMvuVariableFloor(helper, view.latestAssistantTurn); }, [helper, view.latestAssistantTurn]);
  const floorKey = floor ? floor.messageId + ':' + floor.swipeId : '';
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState('fields');
  const [draft, setDraft] = React.useState(null);
  const [jsonText, setJsonText] = React.useState('');
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const loadedRef = React.useRef('');
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;

  React.useEffect(function () {
    if (!open) return;
    if (!floor) { loadedRef.current = ''; return; }
    const changedFloor = loadedRef.current !== floorKey;
    if (dirtyRef.current && !changedFloor) return;
    const statData = floor.statData || {};
    setDraft(mvuCloneJson(statData));
    setJsonText(serializeMvuStatData(statData));
    setDirty(false);
    loadedRef.current = floorKey;
    if (changedFloor) { setError(''); setNotice(''); }
  }, [open, floorKey, floor && floor.variables]);

  function toggle() {
    if (open) setOpen(false);
    else { loadedRef.current = ''; setTab('fields'); setError(''); setNotice(''); setOpen(true); }
  }
  function editPath(path, value) {
    if (path.some(function (key) { return key === '__proto__' || key === 'constructor' || key === 'prototype'; })) {
      setError('不支持的变量名：' + String(path.at(-1)));
      return;
    }
    setDraft(function (current) { return mvuSetAtPath(current, path, value); });
    setDirty(true); setNotice(''); setError('');
  }
  function switchTab(next) {
    if (next === tab) return;
    if (next === 'fields') {
      try { setDraft(parseMvuStatData(jsonText)); }
      catch (e) { setError(String(e.message || e)); return; }
    } else {
      setJsonText(serializeMvuStatData(draft));
    }
    setError(''); setTab(next);
  }
  function reset() {
    if (!floor) return;
    setDraft(mvuCloneJson(floor.statData || {}));
    setJsonText(serializeMvuStatData(floor.statData || {}));
    setDirty(false); setError(''); setNotice('');
  }
  async function save() {
    if (busy || !floor || !floor.statData) return;
    let statData = draft;
    if (tab === 'json') {
      try { statData = parseMvuStatData(jsonText); }
      catch (e) { setError(String(e.message || e)); return; }
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await rpc('updateTavernHelperVariables', Object.assign(mvuVariablesUpdateRequest({
        sessionId: props.sessionId,
        floor: floor,
        statData: statData,
        lifecycleRevision: helper && helper.lifecycleRevision
      }), { variableUpdate: { afterTurn: floor.turn, before: floor.statData } }), props.sessionId);
      if (result && result.stale) {
        setError('对话已变化，变量未保存。请刷新后再试。');
        liveTavernView.invalidate(props.sessionId);
        return;
      }
      setDraft(mvuCloneJson(statData));
      setJsonText(serializeMvuStatData(statData));
      setDirty(false);
      setNotice('已保存到当前楼层' + (floor.turn ? '（第 ' + floor.turn + ' 轮）' : ' #' + floor.messageId) + '。下一轮生成会读取新变量。');
      liveTavernView.invalidate(props.sessionId);
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  }

  // a leaf is one shared inline field (text / number commit on Enter or blur into the
  // draft; 保存修改 still writes the floor), a yes/no leaf the shared switch.
  function leaf(value, path, label, key) {
    if (typeof value === 'boolean') {
      return h(InlineRow, { key: key, className: 'dsh-mvu-field', label: label },
        h('span', { className: 'dsh-mvu-check' },
          h(Switch, { label: label, checked: value, disabled: busy, onChange: function (next) { editPath(path, next); } }),
          value ? '是' : '否'));
    }
    if (typeof value === 'number' || typeof value === 'string') {
      const number = typeof value === 'number';
      return h(InlineField, { key: key, className: 'dsh-mvu-field', kind: number ? 'number' : 'text', label: label, trim: false, disabled: busy,
        value: number ? (Number.isFinite(value) ? value : 0) : value, validate: number ? function (next) { return next === null ? '请输入数字' : ''; } : undefined,
        onCommit: function (next) { editPath(path, next); } });
    }
    return h(InlineRow, { key: key, className: 'dsh-mvu-field', label: label }, h('span', { className: 'dsh-mvu-null' }, 'null'));
  }

  function node(value, path, label, depth) {
    const key = JSON.stringify(path);
    if (Array.isArray(value)) {
      return h('details', { key: key, className: 'dsh-mvu-node', open: depth < 1 },
        h('summary', null, h('span', { className: 'dsh-mvu-node-label' }, label), h('span', { className: 'dsh-mvu-kind' }, '数组 · ' + value.length)),
        value.length ? value.map(function (item, index) { return node(item, path.concat(index), String(index), depth + 1); }) : h('span', { className: 'dsh-mvu-empty' }, '空'));
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      return h('details', { key: key, className: 'dsh-mvu-node', open: depth < 1 },
        h('summary', null, h('span', { className: 'dsh-mvu-node-label' }, label), h('span', { className: 'dsh-mvu-kind' }, entries.length + ' 项')),
        entries.length ? entries.map(function ([childKey, child]) { return node(child, path.concat(childKey), childKey, depth + 1); }) : h('span', { className: 'dsh-mvu-empty' }, '空'));
    }
    return leaf(value, path, label, key);
  }
  const editable = Boolean(floor && floor.statData);
  const badge = floor ? (floor.turn ? '第 ' + floor.turn + ' 轮' : '楼层 #' + floor.messageId) : '暂无';
  return h('section', { className: 'dsh-tavern-status-section dsh-mvu-variables', 'aria-label': 'MVU 变量' },
    h('div', { className: 'dsh-tavern-character-design-head' },
      h('button', { type: 'button', className: 'dsh-ledger-toggle', 'aria-expanded': open, onClick: toggle },
        'MVU 变量', h('span', null, open ? '收起' : '查看')),
      h('span', { className: 'dsh-mvu-floor' }, badge)),
    h('p', { className: 'dsh-tavern-status-empty' },
      !helper ? '当前会话没有可用的酒馆变量上下文。'
        : helper.mvuEnabled === false ? '本局没有启用 MVU 兼容运行时。'
          : !floor ? '还没有可编辑的楼层。'
            : editable ? (floor.turn ? '第 ' + floor.turn + ' 轮楼层 #' + floor.messageId : '楼层 #' + floor.messageId) + ' 的 MVU 状态数据。保存后下一轮从这些值接着走；更早的楼层不变，也不会重新结算。'
              : '当前楼层还没有 MVU 状态数据。首次变量结算后会出现。'),
    open && floor && editable ? h('div', null,
      h('div', { className: 'dsh-ledger-tabs dsh-mvu-tabs', role: 'tablist', 'aria-label': 'MVU 变量编辑方式' },
        [['fields', '字段'], ['json', 'JSON']].map(function ([id, label]) {
          return h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, onClick: function () { switchTab(id); } }, label);
        })),
      tab === 'fields'
        ? h('div', { className: 'dsh-mvu-tree' },
          Object.keys(draft || {}).length
            ? Object.entries(draft || {}).map(function ([key, value]) { return node(value, [key], key, 0); })
            : h('p', { className: 'dsh-tavern-status-empty' }, '状态数据还是空的。可以在 JSON 里添加字段。'))
        : h('div', null,
          h('p', { className: 'dsh-tavern-status-empty' }, '直接编辑 stat_data。schema、display_data 和其他变量字段会原样保留。'),
          // the shared draft text area.
          h(TextArea, { className: 'dsh-mvu-json', value: jsonText, spellCheck: false, disabled: busy, label: 'MVU 状态数据 JSON', rows: 12,
            onChange: function (next) { setJsonText(next); setDirty(true); setNotice(''); } })),
      error ? h('div', { className: 'dsh-card-error', role: 'alert' }, error) : null,
      notice ? h('p', { className: 'dsh-tavern-status-empty', role: 'status' }, notice) : null,
      h('div', { className: 'dsh-mvu-actions' },
        dirty ? h('span', { className: 'dsh-mvu-dirty' }, '有未保存的修改') : null,
        h('button', { type: 'button', className: 'dsh-mvu-reset', disabled: busy || !dirty, onClick: reset }, '还原'),
        h('button', { type: 'button', className: 'dsh-mvu-save', disabled: busy || !dirty, onClick: save }, busy ? '保存中…' : '保存修改'))
    ) : null);
}

function mvuCloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// @include-domain mvu-variable-editor.js
