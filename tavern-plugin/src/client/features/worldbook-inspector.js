function TavernWorldbookInspector(props) {
    const h = React.createElement;
    const [data, setData] = React.useState(null), [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false), [query, setQuery] = React.useState('');
    const [page, setPage] = React.useState(0), [mode, setMode] = React.useState('catalog');
    const [source, setSource] = React.useState(null);
    const generation = React.useRef(0);
    async function refresh() {
        const request = ++generation.current;
        setBusy(true); setError(''); setSource(null);
        try { const result = await rpc('inspectWorldbookSkills', { offset: page }, props.sessionId); if (request === generation.current) setData(result); }
        catch (e) { if (request === generation.current) setError(e.message || String(e)); }
        finally { if (request === generation.current) setBusy(false); }
    }
    React.useEffect(() => { refresh(); return () => { generation.current++; }; }, [page]);
    async function read(entry) {
        const request = ++generation.current;
        setBusy(true); setError(''); setSource(null);
        try { const result = await rpc('readWorldbookSkillSource', { path: entry.path, ref: entry.ref }, props.sessionId); if (request === generation.current) setSource({ title: entry.title, content: result.content }); }
        catch (e) { if (request === generation.current) setError(e.message || String(e)); }
        finally { if (request === generation.current) setBusy(false); }
    }
    const button = (label, onClick, disabled) => h('button', { className: 'dsh-tavern-btn', onClick, disabled }, label);
    const files = data?.catalog?.files || [];
    const matches = value => String(value || '').toLowerCase().includes(query.toLowerCase());
    return h('aside', { className: 'dsh-tavern-status dsh-wb-inspector', 'aria-label': '世界书文件 排查' },
        h('header', null, h('strong', null, '世界书文件'), button(busy ? '加载中…' : '刷新', refresh, busy)),
        h('p', { className: 'dsh-wb-muted' }, '本局静态世界书生成的 Markdown 文件。只读查看不会计入模型调用。'),
        error && h('p', { role: 'alert' }, error),
        data && h(React.Fragment, null,
            h('div', { className: 'dsh-wb-stats' }, `${files.length} 条原文`, h('br'), `成功读取 ${data.counts.entries} 次 · 错误 ${data.counts.errors} 次`),
            data.catalog?.directory && h('details', null, h('summary', null, '实体文件夹'), h('code', null, data.catalog.directory), h('p', { className: 'dsh-wb-muted' }, '由世界书自动同步；修改生成文件不会修改世界书。')),
            h('nav', null, button('文件与内容', () => { setMode('catalog'); setSource(null); }), button(`调用记录 (${data.total})`, () => { setMode('history'); setSource(null); })),
            h('input', { type: 'search', placeholder: '搜索条目或本页调用', 'aria-label': '搜索世界书文件', value: query, onChange: e => setQuery(e.target.value) }),
            source ? h('section', null, button('← 返回目录', () => setSource(null)), h('h3', null, source.title), h('pre', null, source.content)) : mode === 'catalog' ? h('section', null,
                !data.catalog && h('p', null, '当前对局未启用世界书文件，或原生读取工具不可用。'),
                data.catalog && !files.length && h('p', null, '当前没有可用的静态条目；预处理尚未完成或条目被排除时，目录也可能为空。'),
                h('p', { className: 'dsh-wb-muted' }, '仅收录可见、启用的静态非常驻条目；动态模板、常驻条目和 MVU 不在此目录。'),
                files.filter(e => matches(e.title)).map(e => h('div', { key: e.ref, className: 'dsh-wb-entry' }, button(e.title + ' · 读取 ' + e.readCount + ' 次', () => read(e), busy), h('small', null, e.path)))) : h('section', null,
                h('p', { className: 'dsh-wb-muted' }, '原生调用历史（含重试／回退前记录）。成功读取不代表正文一定采用；轮次为原生会话轮次。'),
                !data.historyLoaded && h('p', null, '会话事件尚未加载，统计暂不可用。'),
                data.records.filter(r => matches(r.target) || matches(r.title)).map(r => h('details', { key: r.id }, h('summary', null, `第 ${r.turn} 轮 · ${r.kind === 'skill' ? '历史 Skill' : r.kind === 'worldbook_grep' ? '搜索原文' : r.kind === 'worldbook_list' ? '浏览目录' : '读取原文'} · ${{ success: '成功', error: '失败', pending: '等待结果' }[r.status]}`), h('p', null, r.title), h('code', null, r.target), h('p', null, `步骤 ${r.step}${r.offset ? ' · 起始行 ' + r.offset : ''}${r.totalLines !== undefined ? ' · 共 ' + r.totalLines + ' 行' : ''}`), h('pre', null, r.result || '暂无返回内容'))),
                h('nav', null, button('上一页', () => setPage(Math.max(0, page - 40)), busy || page === 0), h('small', null, `${data.total ? page + 1 : 0}–${Math.min(page + 40, data.total)} / ${data.total}`), button('下一页', () => setPage(page + 40), busy || page + 40 >= data.total)))));
}
