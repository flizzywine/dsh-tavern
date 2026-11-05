function tavernCardUpdateMetadata(document) {
    const raw = document && (document.raw || document);
    const card = raw && (raw.data || raw) || {};
    return { name: String(card.name || ''), version: String(card.character_version || '').trim() };
}

// Read only the ZIP directory and card.json; preview must not upload or install a card.
async function readTavernCardUpdateMetadata(file) {
    const limit = 2 * 1024 * 1024;
    if (!/\.(dshcard|charx)$/i.test(file.name)) {
        if (file.size > (/\.png$/i.test(file.name) ? 16 * limit : limit)) throw new Error('此文件将在更新时读取版本');
        const payload = await parseCardFile(file);
        const text = payload.kind === 'png' ? new TextDecoder().decode(Uint8Array.from(atob(payload.b64), c => c.charCodeAt(0))) : payload.text;
        return tavernCardUpdateMetadata(JSON.parse(text));
    }
    const read = async (offset, size) => {
        if (offset < 0 || offset + size > file.size) throw new Error('卡包目录不完整');
        return new DataView(await file.slice(offset, offset + size).arrayBuffer());
    };
    const tail = await read(Math.max(0, file.size - 65557), Math.min(file.size, 65557));
    let end = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { end = i; break; }
    if (end < 0) throw new Error('无法预览此卡包');
    const size = tail.getUint32(end + 12, true), offset = tail.getUint32(end + 16, true);
    if (size > 8 * 1024 * 1024 || offset === 0xffffffff) throw new Error('此卡包将在更新时读取版本');
    const directory = await read(offset, size);
    for (let i = 0; i + 46 <= directory.byteLength;) {
        if (directory.getUint32(i, true) !== 0x02014b50) break;
        const nameLength = directory.getUint16(i + 28, true), extra = directory.getUint16(i + 30, true), comment = directory.getUint16(i + 32, true);
        if (i + 46 + nameLength + extra + comment > directory.byteLength) break;
        const name = new TextDecoder().decode(new Uint8Array(directory.buffer, i + 46, nameLength));
        if (name === 'card.json') {
            if (directory.getUint16(i + 8, true) & 1) throw new Error('加密卡包将在更新时读取版本');
            const compressed = directory.getUint32(i + 20, true), expanded = directory.getUint32(i + 24, true), method = directory.getUint16(i + 10, true);
            if (compressed > limit || expanded > limit) throw new Error('人物卡信息过大，更新时将完整校验');
            const start = directory.getUint32(i + 42, true), header = await read(start, 30);
            if (header.getUint32(0, true) !== 0x04034b50) throw new Error('卡包文件头不完整');
            const content = await read(start + 30 + header.getUint16(26, true) + header.getUint16(28, true), compressed);
            let bytes = new Uint8Array(content.buffer);
            if (method === 8) {
                const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
                const chunks = []; let total = 0;
                try {
                    while (true) {
                        const part = await reader.read(); if (part.done) break;
                        total += part.value.length;
                        if (total > limit) throw new Error('人物卡信息过大');
                        chunks.push(part.value);
                    }
                } finally { await reader.cancel().catch(() => {}); }
                bytes = new Uint8Array(total); let at = 0;
                for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
            } else if (method !== 0) throw new Error('此压缩格式将在更新时读取版本');
            return tavernCardUpdateMetadata(JSON.parse(new TextDecoder().decode(bytes)));
        }
        i += 46 + nameLength + extra + comment;
    }
    throw new Error('卡包未找到 card.json，更新时将完整校验');
}

function TavernCardUpdateDialog(props) {
    const h = React.createElement;
    const [current, setCurrent] = React.useState(null), [incoming, setIncoming] = React.useState(null), [previewing, setPreviewing] = React.useState(false);
    React.useEffect(() => {
        if (props.result) return;
        let cancelled = false;
        setCurrent(null);
        props.call('getCard', { path: props.target }).then(reply => { if (!cancelled) setCurrent(tavernCardUpdateMetadata(reply.card)); }, () => { if (!cancelled) setCurrent({ name: props.name, version: '' }); });
        return () => { cancelled = true; };
    }, [props.target, props.file, props.result]);
    React.useEffect(() => {
        if (!props.file) return;
        let cancelled = false;
        setIncoming(null); setPreviewing(true);
        readTavernCardUpdateMetadata(props.file).then(value => { if (!cancelled) setIncoming(value); }, () => { if (!cancelled) setIncoming({ name: '', version: '', unavailable: true }); }).finally(() => { if (!cancelled) setPreviewing(false); });
        return () => { cancelled = true; };
    }, [props.file]);
    const complete = Boolean(props.result), nextVersion = complete ? props.result.version || incoming?.version : incoming?.version;
    const version = (label, name, value, pending) => h('section', { className: 'dsh-tavern-card-update-version' }, h('span', { className: 'dsh-tavern-card-update-label' }, label), h('strong', null, pending ? '读取中…' : value || '未标注'), h('span', { className: 'dsh-tavern-card-update-name' }, name || '等待选择新版文件'));
    return h('div', { className: 'dsh-tavern-picker-overlay' }, h('div', { className: 'dsh-tavern-card-update', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-tavern-card-update-title' },
        h('header', { className: 'dsh-tavern-card-update-head' }, h('div', null, h('span', { className: 'dsh-tavern-card-update-label' }, '人物卡管理'), h('h2', { id: 'dsh-tavern-card-update-title' }, complete ? '人物卡已更新' : '更新人物卡')), h('button', { className: 'dsh-tavern-btn', disabled: props.busy, onClick: props.close, 'aria-label': '关闭更新人物卡' }, '关闭')),
        h('div', { className: 'dsh-tavern-card-update-body' },
            h('p', { className: 'dsh-tavern-card-update-description' }, complete ? '新版已替换原卡，历史会话、收藏和分组均已保留。' : '选择新版文件，确认版本后原位更新。历史会话、收藏和分组会保留，旧卡自动备份。'),
            h('div', { className: 'dsh-tavern-card-update-versions' }, version(complete ? '更新前' : '当前版本', current?.name || props.name, current?.version, !current), h('span', { className: 'dsh-tavern-card-update-arrow', 'aria-hidden': 'true' }, '→'), version(complete ? '已更新至' : '新版版本', incoming?.name || (complete ? props.result.name : ''), nextVersion || (incoming?.unavailable ? '待校验' : !props.file && !complete ? '待选择' : ''), previewing)),
            !complete && h('div', { className: 'dsh-tavern-card-update-file' }, h('div', null, h('strong', null, props.file?.name || '选择新版人物卡'), h('span', null, props.file ? '已选择 · ' + (props.file.size / 1024 / 1024).toFixed(1) + ' MB' : '支持 JSON、PNG、CHARX、DSHCARD')), h('button', { className: 'dsh-tavern-btn', disabled: props.busy, onClick: props.pick }, props.file ? '更换文件' : '选择文件')),
            incoming?.unavailable && !complete && h('p', { className: 'dsh-tavern-card-update-description' }, '此文件暂时无法预览版本，更新时会完整校验。'),
            props.error && h('p', { role: 'alert', className: 'dsh-tavern-dock-error' }, props.error),
            props.notice && !complete && h('p', { role: 'status', className: 'dsh-tavern-card-update-description' }, props.notice),
            complete && h('div', { className: 'dsh-tavern-card-update-success', role: 'status' }, h('strong', null, '✓ 更新完成'), h('p', null, props.result.plugins?.length ? '卡内插件已替换。请重启桌面版或刷新页面，让新版插件生效。' : '已有对局不会重置，可以继续使用这张卡。')),
            complete && props.result.libraryNotices?.length ? h('ul', null, ...props.result.libraryNotices.map((notice, i) => h('li', { key: i }, notice))) : null,
            complete && props.result.backupPath && h('details', { className: 'dsh-tavern-card-update-backup' }, h('summary', null, '查看旧卡备份位置'), h('code', null, props.result.backupPath))),
        h('footer', { className: 'dsh-tavern-card-update-foot' }, h('span', null, complete ? '旧卡已备份' : '更新前会自动备份原卡'), !complete && h('button', { className: 'dsh-tavern-btn', disabled: props.busy, onClick: props.close }, '取消'), h('button', { className: 'dsh-tavern-question-primary', disabled: props.busy || (!complete && (!props.file || !current || previewing)), onClick: complete ? props.close : props.replace }, complete ? '完成' : props.busy ? '正在更新…' : '确认更新'))));
}
