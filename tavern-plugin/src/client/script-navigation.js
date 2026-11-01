function ScriptNavigation(props) {
    const h = React.createElement;
    const [page, setPage] = React.useState(null);
    const [chunkSize, setChunkSize] = React.useState("500");
    const [position, setPosition] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [notice, setNotice] = React.useState("");
    const [error, setError] = React.useState("");
    const generation = React.useRef(0);
    const activeSession = React.useRef(null);
    if (activeSession.current?.id !== props.sessionId) activeSession.current = { id: props.sessionId };
    const previousSession = React.useRef(null);
    function currentBlock(value) {
        return value?.totalChunks ? String(Math.min(value.totalChunks, value.cursor + 1)) : "";
    }
    async function load(target) {
        const ticket = ++generation.current;
        setLoading(true); setError("");
        try {
            const result = await rpc("browseScript", target === undefined ? {} : { position: target }, props.sessionId);
            if (ticket === generation.current) {
                setPage(result);
                setChunkSize(String(result.chunkSize || 500));
                setPosition(value => value.trim() === "" ? currentBlock(result) : value);
            }
        } catch (err) { if (ticket === generation.current) setError(String(err.message || err)); }
        finally { if (ticket === generation.current) setLoading(false); }
    }
    React.useEffect(() => {
        if (previousSession.current !== props.sessionId) {
            setPage(null); setPosition(""); setChunkSize("500"); setNotice(""); setSaving(false);
            previousSession.current = props.sessionId;
        }
        load();
        return () => { generation.current++; };
    }, [props.sessionId, props.cursor, props.total, props.chunkSize]);
    async function point(number) {
        if (props.busy || saving || loading || !page) return;
        const session = activeSession.current;
        setSaving(true); setError(""); setNotice("");
        try {
            const result = await rpc("pointScript", { position: number, revision: page.revision, cardPath: page.cardPath, scriptVersion: page.scriptVersion }, props.sessionId);
            if (session !== activeSession.current) return;
            setPage(current => current ? { ...current, cursor: result.cursor } : current);
            setNotice("下一轮从第 " + (result.cursor + 1) + " 块继续。");
            liveTavernView.invalidate(props.sessionId);
            setSaving(false);
            await load(number);
        } catch (err) { if (session === activeSession.current) setError(String(err.message || err)); }
        finally { if (session === activeSession.current) setSaving(false); }
    }
    async function saveChunkSize(event) {
        event.preventDefault();
        if (props.busy || saving || loading || !page) return;
        const value = Number(chunkSize);
        if (!Number.isSafeInteger(value) || value < 100 || value > 10000) { setError("请输入 100–10000 的整数"); return; }
        const session = activeSession.current;
        setSaving(true); setError(""); setNotice("");
        try {
            await rpc("setScriptChunkSize", { chunkSize: value, revision: page.revision, cardPath: page.cardPath, scriptVersion: page.scriptVersion }, props.sessionId);
            if (session !== activeSession.current) return;
            setPosition("");
            setNotice("已保存为用户默认值，下一轮生效。");
            liveTavernView.invalidate(props.sessionId);
            await load();
        } catch (err) { if (session === activeSession.current) setError(String(err.message || err)); }
        finally { if (session === activeSession.current) setSaving(false); }
    }
    function jump(event) {
        event.preventDefault();
        const value = position.trim() === "" ? currentBlock(page) : position;
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number < 1 || number > (page?.totalChunks || 0)) { setError("请输入 1–" + (page?.totalChunks || 1) + " 的块号"); return; }
        setPosition(value);
        load(number);
    }
    function preview(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }
    const current = page ? page.cursor + 1 : 0;
    const ended = !!page && page.totalChunks > 0 && page.cursor >= page.totalChunks;
    const locked = props.busy || loading || saving;
    return h("section", { className: "dsh-tavern-status-section dsh-script-nav", "aria-label": "剧本块列表" },
        h("div", { className: "dsh-script-nav-head" },
            h("div", { className: "dsh-tavern-status-label" }, "剧本进度"),
            page ? h("span", { className: "dsh-script-nav-count" }, ended ? "剧本已结束" : "第 " + current + " / " + page.totalChunks + " 块") : null),
        page && page.totalChunks ? h("div", { className: "dsh-script-nav-progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": page.totalChunks, "aria-valuenow": Math.min(page.cursor, page.totalChunks) },
            h("span", { style: { width: Math.round(Math.min(page.cursor, page.totalChunks) / page.totalChunks * 100) + "%" } })) : null,
        error ? h("p", { role: "alert" }, error) : null,
        notice ? h("p", { role: "status", className: "dsh-script-nav-notice" }, notice) : null,
        props.busy ? h("p", null, "正在生成，暂时不能更改起点或推进字数。") : null,
        loading && !page ? h("p", { role: "status" }, "读取中…") : null,
        page ? h("div", { className: "dsh-script-nav-list" },
            page.chunks.map(chunk => {
                const isCurrent = chunk.number === current;
                return h("details", { key: chunk.number, className: "dsh-script-nav-item", "aria-current": isCurrent ? "step" : undefined },
                    h("summary", null,
                        h("span", { className: "dsh-script-nav-number" }, String(chunk.number).padStart(2, "0")),
                        isCurrent ? h("span", { className: "dsh-script-nav-badge" }, "当前") : null,
                        h("span", { className: "dsh-script-nav-preview" }, preview(chunk.text))),
                    h("div", { className: "dsh-tavern-script-chunk-text" }, chunk.text),
                    isCurrent ? h("p", { className: "dsh-script-nav-here" }, "下一轮从这里继续") : h("button", { type: "button", className: "dsh-script-nav-choose", disabled: locked, onClick: () => point(chunk.number), "aria-label": "从第 " + chunk.number + " 块继续" }, "从这里继续"));
            })) : null,
        page ? h("div", { className: "dsh-script-nav-pages" },
            h("button", { type: "button", disabled: loading || saving || page.from <= 1, onClick: () => load(Math.max(1, page.from - 4)) }, "‹ 上一页"),
            h("form", { className: "dsh-script-nav-jump", onSubmit: jump },
                h("label", null, "跳到第", h("input", { type: "number", min: 1, max: page.totalChunks || 1, step: 1, "aria-label": "剧本块号", value: position, disabled: saving,
                    onChange: event => setPosition(event.target.value) }), "块"),
                h("button", { type: "button", disabled: loading || saving, onClick: () => { setPosition(""); load(); } }, "回到当前")),
            h("button", { type: "button", disabled: loading || saving || page.to >= page.totalChunks, onClick: () => load(Math.min(page.totalChunks, page.to + 4)) }, "下一页 ›")) : null,
        page ? h("details", { className: "dsh-script-nav-settings" },
            h("summary", null, "每轮推进字数：" + (page.chunkSize || 500)),
            h("form", { className: "dsh-script-nav-toolbar", onSubmit: saveChunkSize },
                h("input", { type: "number", min: 100, max: 10000, step: 1, "aria-label": "每轮推进字数", value: chunkSize, disabled: locked,
                    onChange: event => setChunkSize(event.target.value) }),
                h("button", { type: "submit", disabled: locked || Number(chunkSize) === (page.chunkSize || 500) }, saving ? "保存中…" : "保存")),
            h("p", { className: "dsh-script-nav-hint" }, "可填 100–10000。保存后当前局下一轮生效，新建剧本会话也会沿用，已读到的位置不变。")) : null);
}
