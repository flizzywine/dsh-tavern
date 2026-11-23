function tavernCardUpdateMetadata(document) {
    const raw = document && (document.raw || document);
    const card = raw && (raw.data || raw) || {};
    return { name: String(card.name || ''), version: String(card.character_version || '').trim() };
}

// A PNG or JSON card's name and version, read in the browser. A card archive is read by the server
// (previewCardUpload), which also lists the installed packs it carries another version of.
async function readTavernCardUpdateMetadata(file) {
    const limit = 2 * 1024 * 1024;
    if (file.size > (/\.png$/i.test(file.name) ? 16 * limit : limit)) throw new Error('此文件将在更新时读取版本');
    const payload = await parseCardFile(file);
    const text = payload.kind === 'png' ? new TextDecoder().decode(Uint8Array.from(atob(payload.b64), c => c.charCodeAt(0))) : payload.text;
    return tavernCardUpdateMetadata(JSON.parse(text));
}

// The installed packs of one decision all go the same way: 'update' (完全替换) or 'merge' (增量更新).
function tavernCardPackDecisions(packs, way) {
    return Object.fromEntries(packs.map(pack => [pack.packId, way]));
}

// 「素材包 N」: the packs the card carries another version of. The asset library's choices decide what is offered:
// 增量更新 only when every pack offers merge. 完全替换 lists what it removes from the installed versions.
function TavernCardPacks(props) {
    const h = React.createElement, packs = props.packs;
    const merge = packs.every(pack => pack.choices.includes('merge'));
    const removed = props.way === 'update' ? packs.flatMap(pack => pack.removed || []) : [];
    return h('section', { className: 'fork-card-update-packs' },
        h('h3', null, '素材包', h('span', { className: 'fork-card-update-count' }, packs.length)),
        merge ? h(Segmented, { label: '素材包更新方式', value: props.way, onChange: props.onWay, disabled: props.busy, className: 'fork-card-update-way', options: [['update', '完全替换'], ['merge', '增量更新']] }) : null,
        h(TavernCardPackList, { packs }),
        removed.length ? h('div', { className: 'fork-card-update-removed' },
            h('p', null, h('span', { className: 'fork-card-update-warn', 'aria-hidden': true }, '⚠'), '以下旧版素材将被删除'),
            h('ul', null, removed.map((item, index) => h('li', { key: index }, item.name)))) : null);
}

// The packs as 舞台设置 lists them: name and what each holds (packUi.PackPreviewList, read from the installed version).
function TavernCardPackList(props) {
    const h = React.createElement;
    usePackRevision(cardZipServiceReady);
    React.useEffect(() => galStageHold(), []);
    const staged = packUi.stageScope.use(), binding = useCardPackBinding(null, cardZipServiceReady() ? packClient() : null, '', true);
    return staged && binding ? h(packUi.PackPreviewList, { binding, packs: props.packs })
        : h('ul', { className: 'ap-pack-list' }, props.packs.map(pack => h('li', { key: pack.packId, className: 'ap-pack-row' }, pack.title)));
}

// The card being updated or imported: cover, name, 「旧版本 → 新版本」 (character_version; none, none shown) and the file.
function TavernCardUpdateCard(props) {
    const h = React.createElement, [failed, setFailed] = React.useState('');
    const cover = props.cover && failed !== props.cover ? props.cover : '';
    return h('div', { className: 'fork-card-update-card' },
        h('div', { className: 'fork-card-update-cover' }, cover ? h('img', { src: cover, alt: '', onError: () => setFailed(cover) }) : null),
        h('strong', { className: 'fork-card-update-name' }, props.name),
        props.to ? h('div', { className: 'fork-card-update-ver' },
            props.from && props.from !== props.to ? [h('span', { key: 'from', className: 'is-old' }, props.from), h('span', { key: 'arrow', className: 'is-arrow', 'aria-label': '更新到' }, '→')] : null,
            h('span', null, props.to)) : null,
        props.file ? h('div', { className: 'fork-card-update-file' },
            h('span', null, props.file.name + ' · ' + (props.file.size / 1024 / 1024).toFixed(1) + ' MB'),
            props.pick ? h('button', { type: 'button', className: 'ap-inline-link', disabled: props.busy, onClick: props.pick }, '更换') : null) : null);
}

// 更新人物卡 (card library › 批量管理 › 更新) and 导入人物卡 (mode 'import',
// only when the card carries another version of an installed pack). The asset library's Modal; no explanatory text.
//   current {name, version, cover}, incoming {name, version, cover} (null while the file is read: loading),
//   packs [{packId, title, choices, removed}], way / onWay, file / pick, result (after the update) / revert.
//   request {source, changes[], current, incoming} instead of a file: the card's own script asks for this update (script-card-update.js).
function TavernCardUpdateDialog(props) {
    const h = React.createElement, p = props, ui = packUi;
    const importing = p.mode === 'import', title = importing ? '导入人物卡' : '更新人物卡';
    const head = h('header', { className: 'fork-card-update-head' }, h('h2', null, title), h(ui.IconButton, { icon: 'close', label: '关闭', disabled: p.busy, onClick: p.close }));
    const error = p.error ? h('p', { role: 'alert', className: 'fork-card-update-error' }, '⚠ ', p.error) : null;
    if (p.result) {
        const name = p.result.name || p.current?.name || '', version = p.result.version;
        const notes = [...(p.result.plugins?.length ? ['卡内插件已替换，重启桌面版或刷新页面后生效'] : []), ...(p.result.libraryNotices || [])];
        return h(ui.Modal, { title, head, busy: p.busy, onClose: p.close, className: 'fork-card-update',
            foot: h('div', { className: 'ap-actions fork-card-update-foot' },
                p.result.updateId && p.revert ? h(ui.Button, { className: 'fork-card-update-quiet', disabled: p.busy, onClick: p.revert }, p.busy ? '正在撤回…' : '撤回') : null,
                h(ui.Button, { primary: true, disabled: p.busy, onClick: p.close }, '完成')) },
            h('div', { className: 'fork-card-update-done', role: 'status' },
                h('span', { className: 'fork-card-update-check', 'aria-hidden': true }, '✓'),
                h('strong', null, name + (version ? ' 已更新到 ' + version : ' 已更新')),
                notes.length ? h('ul', null, notes.map((note, index) => h('li', { key: index }, note))) : null),
            error);
    }
    const request = p.request, incoming = request ? request.incoming : p.incoming, loading = Boolean(p.file) && !incoming && !p.error;
    const packs = p.packs || [];
    return h(ui.Modal, { title, head, busy: p.busy, onClose: p.close, className: 'fork-card-update',
        foot: h('div', { className: 'ap-actions fork-card-update-foot' },
            h(ui.Button, { disabled: p.busy, onClick: p.close }, '取消'),
            h(ui.Button, { primary: true, disabled: p.busy || !p.ready, onClick: p.replace }, p.busy ? (importing ? '正在导入…' : '正在更新…') : importing ? '导入' : '更新')) },
        h(TavernCardUpdateCard, { cover: incoming?.cover || p.current?.cover, name: incoming?.name || p.current?.name || p.name || '',
            from: importing ? '' : p.current?.version, to: incoming?.version, file: p.file, pick: importing ? null : p.pick, busy: p.busy }),
        request ? h('div', { className: 'fork-card-update-request' }, h('span', null, '来源'), h('code', null, request.source || '这张卡的脚本'), h('span', null, '会改动'),
            h('ul', null, request.changes.map((change, index) => h('li', { key: index }, change)))) : null,
        loading ? h('p', { className: 'fork-card-update-loading', role: 'status' }, h(Spinner), '正在读取…') : null,
        packs.length ? h(TavernCardPacks, { packs, way: p.way, onWay: p.onWay, busy: p.busy }) : null,
        error);
}

// 人物卡库 › 批量管理 › 更新: open(path, name) picks the new file; the dialog shows once a file is chosen. An archive is
// uploaded and read at once (previewTavernCardArchive) so its packs show before 更新; 撤回 takes the update back
// (revertCardUpdate). onChanged(path) after an update or 撤回. `input` is the hidden file picker, `element` the dialog.
function useTavernCardUpdate({ call, onChanged }) {
    const h = React.createElement, [state, setState] = React.useState(null), picker = React.useRef(null), latest = React.useRef(null), ticket = React.useRef(0);
    latest.current = state;
    const patch = next => setState(value => value && { ...value, ...next });
    const message = error => String(error?.message || error);
    const discard = stage => { if (stage?.uploadId) call('discardCardUpload', { uploadId: stage.uploadId }).catch(() => {}); };
    async function choose(file) {
        const mine = ++ticket.current, before = latest.current;
        discard(before?.stage);
        setState(value => ({ target: value.target, name: value.name, current: value.current, file, stage: null, way: 'update', error: '', result: null, busy: false }));
        try {
            const stage = isTavernCardPackArchive(file) ? await previewTavernCardArchive(file, call)
                : { card: await readTavernCardUpdateMetadata(file).catch(() => ({ name: '', version: '' })), packs: [] };
            if (mine === ticket.current) patch({ stage }); else discard(stage);
        } catch (error) {
            if (mine !== ticket.current) return;
            if (error?.code === 'TAVERN_CARD_IMPORT_CANCELLED') setState(null); else patch({ error: message(error) });
        }
    }
    async function replace() {
        const s = latest.current;
        patch({ busy: true, error: '' });
        try {
            const reply = await commitTavernCardFile(s.file, s.stage.uploadId ? s.stage : null, call, { replacePath: s.target, packDecisions: tavernCardPackDecisions(s.stage.packs, s.way) });
            await onChanged(s.target);
            const updated = await call('getCard', { path: s.target }).catch(() => null);
            patch({ busy: false, result: { ...reply.card, version: updated ? tavernCardUpdateMetadata(updated.card).version : '' } });
        } catch (error) { patch({ busy: false, error: message(error) }); }
    }
    async function revert() {
        const s = latest.current;
        patch({ busy: true, error: '' });
        try { await call('revertCardUpdate', { updateId: s.result.updateId }); await onChanged(s.target); setState(null); }
        catch (error) { patch({ busy: false, error: message(error) }); }
    }
    function close() {
        const s = latest.current;
        if (s?.busy) return;
        ticket.current++;
        if (s && !s.result) discard(s.stage);
        setState(null);
    }
    const open = Boolean(state && (state.file || state.result));
    return {
        open,
        start(target, name) {
            const cover = '/api/dsh-tavern/card-image?path=' + encodeURIComponent(target);
            setState({ target, name, current: null, file: null, stage: null, way: 'update', error: '', result: null, busy: false });
            picker.current?.click();
            call('getCard', { path: target }).then(reply => tavernCardUpdateMetadata(reply.card), () => ({ name, version: '' }))
                .then(current => setState(value => value && value.target === target ? { ...value, current: { ...current, cover } } : value));
        },
        input: h('input', { ref: picker, type: 'file', accept: '.json,.png,.charx,.dshcard', style: { display: 'none' }, onChange: event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file && latest.current) void choose(file);
        } }),
        element: open ? h(TavernCardUpdateDialog, { current: state.current || { name: state.name, version: '' }, incoming: state.stage?.card || null, packs: state.stage?.packs || [],
            way: state.way, onWay: way => patch({ way }), file: state.file, pick: () => picker.current?.click(), error: state.error, result: state.result, busy: state.busy,
            ready: Boolean(state.stage && state.current), close, replace, revert }) : null
    };
}

// 导入人物卡 when the card carries another version of an installed pack: resolves to 'update' or 'merge', or null (取消).
function askTavernCardPackWay(file, staged) {
    return new Promise(resolve => {
        const container = document.createElement('div');
        document.body.append(container);
        const root = require('react-dom/client').createRoot(container);
        function Dialog() {
            const [way, setWay] = React.useState('update');
            function settle(value) { root.unmount(); container.remove(); resolve(value); }
            return React.createElement(TavernCardUpdateDialog, { mode: 'import', file, incoming: staged.card, packs: staged.packs, way, onWay: setWay, ready: true,
                close: () => settle(null), replace: () => settle(way) });
        }
        root.render(React.createElement(Dialog));
    });
}
