// 语音后端 › 语音识别: the recognition services this machine offers (speech-recognition-host.js), drawn on the
// dsh-tavern-tts page with that page's own parts (ttsPanelSections), right under 语音合成. A service is an API by its
// address — a cloud one or a model on this machine (本地模型 page) alike; its models are the ones it reports itself.
// Users (the phone's 通话) pick from this list; nothing here knows who uses it. Saved rows save each field as it is left.
const RECOGNITION_LANGUAGES = [['zh', '中文'], ['ja', '日语'], ['en', '英语']];
const RECOGNITION_ERRORS = {ASR_SETTINGS_CONFLICT: '识别设置已在别处修改，已重新读取', ASR_SERVICE_ID_TAKEN: '这个名称已被占用', ASR_URL_INVALID: '接口地址无效', ASR_MODEL_INVALID: '模型名无效',
    ASR_LABEL_INVALID: '请填写 1–30 字的名称', ASR_KEY_INVALID: 'API Key 无效', ASR_CREDENTIALS_UNAVAILABLE: '凭据库不可写'};
const recognitionFail = error => RECOGNITION_ERRORS[error?.code] || error?.message || '请求失败';
const recognitionSlug = label => (String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'asr');
function RecognitionSection({Section, Field, Line, Confirm, Button, Menu, AddRow, StateWord, Status}) {
    const h = React.createElement;
    const [data, setData] = React.useState(null), [states, setStates] = React.useState({}), [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
    const [open, setOpen] = React.useState(''), [draft, setDraft] = React.useState(null), [models, setModels] = React.useState({}), [confirm, setConfirm] = React.useState(''), [busy, setBusy] = React.useState(false);
    const readStates = () => rpc('listSpeechRecognitionServices', {}).then(({services}) => setStates(Object.fromEntries(services.map(row => [row.id, row.available]))), () => {});
    const read = () => rpc('getSpeechRecognitionConfig', {}).then(value => { setData(value); setError(''); void readStates(); }, e => setError(recognitionFail(e)));
    React.useEffect(() => { void read(); }, []);
    // A service's models as it reports them (GET {base}/info), read when its row opens.
    const describe = (service, key) => rpc('describeSpeechRecognitionService', {service, ...(key ? {key} : {})}).then(info => { setModels(all => ({...all, [service.id]: info})); return info; });
    const run = work => async () => { setBusy(true); setMessage(''); try { await work(); } catch (e) { setMessage(recognitionFail(e)); if (e?.code === 'ASR_SETTINGS_CONFLICT') void read(); } finally { setBusy(false); } };
    const save = (service, key) => run(async () => { setData(await rpc('saveSpeechRecognitionService', {service, ...(key !== undefined ? {key} : {}), expectedRevision: data.revision})); void readStates(); })();
    if (!data) return h(Section, {title: '语音识别'}, h('p', {className: 'dtts-muted dtts-loading', role: error ? 'alert' : undefined}, error ? '⚠ ' + error : h('span', {className: 'dtts-spinner', 'aria-label': '正在载入'})));
    const kinds = Object.fromEntries(data.kinds.map(row => [row.kind, row]));
    const stateOf = row => states[row.id] === undefined ? ['busy', '正在检查…'] : states[row.id] ? ['ready', '可用'] : kinds[row.kind]?.keyRequired && !row.key?.configured ? ['warn', '缺少 API Key'] : ['warn', '连不上'];
    const strip = ({key, ...row}) => row;
    // The fields of one service; `change(patch)` is a saved row's save or a draft's edit.
    function fields(row, change, keyed) {
        const info = models[row.id], listed = info?.available ? info.models.map(model => model.id) : [];
        const modelOptions = [...new Set([...listed, row.model].filter(Boolean))].map(id => ({value: id, label: id}));
        const finals = [{value: '', label: '不用'}, ...data.services.filter(other => other.id !== row.id).map(other => ({value: other.id, label: other.label}))];
        return [
            h(Field, {key: 'label', label: '名称'}, h(InlineField, {label: '名称', hideLabel: true, value: row.label, maxLength: 30, onCommit: label => label.trim() && change({label: label.trim()})})),
            !kinds[row.kind].url && h(Field, {key: 'url', label: '接口地址'}, h(InlineField, {label: '接口地址', hideLabel: true, value: row.url || '', placeholder: 'http://127.0.0.1:9887/v1', trim: true, onCommit: url => change({url})})),
            h(Field, {key: 'key', label: 'API Key', help: 'API Key 交给 DSH 凭据存储，不写进设置；保存后不再显示。'}, h(InlineField, {label: 'API Key', hideLabel: true, secret: true, value: keyed ?? '',
                placeholder: row.key?.configured ? '•••••••••• 已保存' : kinds[row.kind].keyRequired ? '' : '选填', onCommit: key => change({}, key || null)})),
            h(Field, {key: 'model', label: '模型'}, modelOptions.length > 1 || listed.length ? h(InlineField, {kind: 'menu', label: '模型', hideLabel: true, value: row.model, options: modelOptions, onCommit: model => change({model})})
                : h(InlineField, {label: '模型', hideLabel: true, value: row.model || '', trim: true, onCommit: model => change({model})})),
            h(Field, {key: 'final', label: '定稿用', help: '你说完一句时，用这个服务再认一遍这一句（更准的模型）；说话时的实时字幕仍用本服务。'},
                h(InlineField, {kind: 'menu', label: '定稿用', hideLabel: true, value: row.final || '', options: finals, onCommit: final => change({final: final || undefined})})),
            h(Field, {key: 'language', label: '识别语言'}, h(InlineField, {kind: 'menu', label: '识别语言', hideLabel: true, value: row.language, options: RECOGNITION_LANGUAGES.map(([value, label]) => ({value, label})), onCommit: language => change({language})})),
        ];
    }
    const toggle = row => { setConfirm(''); if (open === row.id) { setOpen(''); return; } setOpen(row.id); setDraft(null); void describe(strip(row)).catch(() => {}); };
    const startAdd = kind => { setOpen(''); const base = kinds[kind]; setDraft({kind, label: kind === 'openai' ? 'OpenAI' : '', url: '', model: base.model, language: 'zh', key: ''}); };
    const freeId = base => { let id = base, n = 2; while (data.services.some(row => row.id === id) || data.external.some(row => row.id === id)) id = base + '-' + n++; return id; };
    const draftRow = draft && {id: freeId(recognitionSlug(draft.label || draft.kind)), label: draft.label, kind: draft.kind, ...(kinds[draft.kind].url ? {} : {url: draft.url}), model: draft.model, language: draft.language, ...(draft.final ? {final: draft.final} : {})};
    const editDraft = (patch, key) => {
        const next = {...draft, ...patch, ...(key !== undefined ? {key: key || ''} : {})};
        setDraft(next);
        // A typed address (or key) asks the server for its models, so 模型 becomes its list.
        if ((patch.url || key !== undefined) && next.url) void describe({id: draftRow.id, label: next.label || 'x', kind: next.kind, url: next.url, model: next.model || 'x', language: next.language}, next.key || undefined)
            .then(info => { if (info.available && !next.model && info.models[0]) setDraft(d => d && {...d, model: info.models[0].id}); }, () => {});
    };
    const add = run(async () => {
        if (!draftRow.label.trim()) throw new Error('请填写名称');
        setData(await rpc('saveSpeechRecognitionService', {service: draftRow, ...(draft.key ? {key: draft.key} : {}), expectedRevision: data.revision}));
        setDraft(null); setMessage('已添加「' + draftRow.label + '」'); void readStates();
    });
    const remove = row => run(async () => { setData(await rpc('deleteSpeechRecognitionService', {id: row.id, expectedRevision: data.revision})); setConfirm(''); setOpen(''); setMessage('已删除「' + row.label + '」'); });
    const count = data.services.length + data.external.length;
    return h(Section, {title: '语音识别', meta: count, help: '把说话听成文字的服务，这台电脑设一次。手机通话用排在最前的那个。'},
        h('ul', {className: 'dtts-list'},
            data.services.map(row => h('li', {key: row.id, 'data-open': open === row.id || undefined},
                h(Line, {title: row.label, open: open === row.id, onOpen: () => toggle(row), warn: StateWord(stateOf(row))},
                    h(Menu, {label: row.label + ' 更多操作', items: [{label: '删除…', danger: true, disabled: busy, onSelect: () => setConfirm(row.id)}]})),
                confirm === row.id && h(Confirm, {text: '删除「' + row.label + '」？', onYes: remove(row), onNo: () => setConfirm('')}),
                open === row.id && h('div', {className: 'dtts-form', role: 'group', 'aria-label': '编辑 ' + row.label},
                    fields(row, (patch, key) => save({...strip(row), ...patch}, key))))),
            data.external.map(row => h('li', {key: row.id}, h(Line, {title: row.label, warn: StateWord(states[row.id] === false ? ['warn', '连不上'] : ['ready', '可用'])})))),
        draft ? h('div', {className: 'dtts-adding'},
            h('div', {className: 'dtts-adding-head'}, h('span', {className: 'dtts-label'}, '选择协议类型'), h(Button, {link: true, onClick: () => setDraft(null)}, '取消')),
            h('div', {className: 'dtts-kinds', role: 'radiogroup', 'aria-label': '协议类型'}, data.kinds.map(row => h('button', {key: row.kind, type: 'button', role: 'radio', className: 'dtts-kind', 'aria-checked': draft.kind === row.kind, onClick: () => startAdd(row.kind)}, row.label))),
            h('div', {className: 'dtts-form', role: 'group', 'aria-label': '添加识别服务'}, fields({...draftRow, key: {configured: false}}, editDraft, draft.key),
                h('div', {className: 'dtts-actions'}, h('span', {className: 'dtts-actions-start'}), h(Button, {onClick: () => setDraft(null)}, '取消'), h(Button, {primary: true, disabled: busy, onClick: add}, '添加'))))
            : h(AddRow, {label: '添加识别服务', disabled: busy, onClick: () => startAdd('openai-compatible')}),
        h(Status, {label: '识别服务状态'}, message));
}
