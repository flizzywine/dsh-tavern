function TavernCardMemoryTab(props) {
    const h = React.createElement;
    const [memory, setMemory] = React.useState(null);
    const [query, setQuery] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [draft, setDraft] = React.useState(null);
    const askConfirm = useTavernConfirm(props.sessionId);
    const statuses = { unverified: "待验证", "static-validated": "静态校验通过", "runtime-verified": "运行实测通过", "user-confirmed": "用户确认" };
    const owner = React.useRef(props.sessionId);
    owner.current = props.sessionId;
    async function refresh() {
        const sessionId = props.sessionId;
        const result = await rpc("getCardMemory", { query: query }, sessionId);
        if (owner.current === sessionId) setMemory(result);
    }
    async function run(action) {
        setBusy(true); setError("");
        try { await action(); } catch (err) { setError(String(err.message || err)); }
        finally { setBusy(false); }
    }
    React.useEffect(function () {
        setMemory(null); setDraft(null); setError("");
        run(refresh);
    }, [props.sessionId]);
    async function editPreference(oldText) {
        const content = await askTavernText({ title: oldText ? "修改改卡偏好" : "添加改卡偏好", initialValue: oldText || "", maxLength: 1000 });
        if (content === null || !content.trim()) return;
        await rpc("changeCardMemoryPreference", { action: oldText ? "replace" : "add", oldText: oldText, content: content }, props.sessionId);
        await refresh();
    }
    function field(label, key) {
        return h("label", { className: "dsh-tavern-memory-field" }, label, h("textarea", { value: draft[key] || "", maxLength: key === "title" ? 160 : 2000, rows: key === "title" ? 1 : 3, onChange: event => setDraft(Object.assign({}, draft, { [key]: event.target.value })) }));
    }
    return h("div", { className: "dsh-tavern-card-memory" },
        h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "改卡记忆"), h("div", { className: "dsh-tavern-question-sub" }, "记录改卡偏好和错误修复经验，卡片 Agent 改卡时会自动参考。")),
        error ? h("p", { role: "alert" }, error) : null,
        !memory ? h("p", null, "正在读取…") : !memory.enabled ? h("div", { className: "dsh-tavern-empty-state" }, h("div", { className: "dsh-tavern-empty-icon", "aria-hidden": "true" }, "✎"), h("strong", null, "还没有打开对话"), h("p", null, "打开任意对话后即可查看和管理改卡记忆。")) : h(React.Fragment, null,
            h("div", { className: "dsh-tavern-memory-actions" },
                h("input", { "aria-label": "检索改卡记忆", placeholder: "输入错误或关键词", value: query, onChange: event => setQuery(event.target.value), onKeyDown: event => { if (event.key === "Enter") run(refresh); } }),
                h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(refresh) }, "检索 / 刷新")),
            h("h4", null, "改卡偏好"),
            (memory.preferences || []).map(content => h("div", { className: "dsh-tavern-memory-entry", key: content },
                h("p", null, content), h("div", { className: "dsh-tavern-memory-actions" },
                    h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(() => editPreference(content)) }, "修改"),
                    h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(async () => { if (await askConfirm("移除这条改卡偏好？")) { await rpc("changeCardMemoryPreference", { action: "remove", oldText: content }, props.sessionId); await refresh(); } }) }, "移除")))),
            h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(() => editPreference()) }, "添加偏好"),
            h("h4", null, "错误与修复经验"),
            h("p", null, "显示当前卡片和通用经验的检索结果。待验证记录不代表已有可靠解决方案。"),
            !(memory.experiences || []).length ? h(EmptyState, { compact: true, text: "没有匹配的经验" }) : null,
            (memory.experiences || []).map(entry => {
                let record;
                try { record = JSON.parse(entry.content); } catch (_error) { record = { problem: entry.content }; }
                return h("details", { className: "dsh-tavern-memory-entry", key: entry.scope + entry.id },
                    h("summary", null, entry.title + " · " + (entry.scope === "shared" ? "通用" : "当前卡片")),
                    h("p", null, statuses[record.status] || "待验证"),
                    [ ["问题", "problem"], ["尝试", "attempts"], ["修复方法", "solution"], ["验证依据", "evidence"] ].map(([label, key]) => record[key] ? h("p", { key: key }, h("strong", null, label + "："), record[key]) : null),
                    h("div", { className: "dsh-tavern-memory-actions" },
                        h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => setDraft(Object.assign({}, record, { id: entry.id, scope: entry.scope, title: entry.title })) }, "修改"),
                        h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(async () => { if (await askConfirm("删除这条改卡经验？删除后不再检索或用于改卡，底层记录仍保留。")) { await rpc("changeCardMemoryExperience", { action: "archive", id: entry.id, scope: entry.scope }, props.sessionId); await refresh(); } }) }, "删除")));
            }),
            draft ? h("form", { className: "dsh-tavern-memory-entry", onSubmit: event => { event.preventDefault(); run(async () => { await rpc("changeCardMemoryExperience", Object.assign({}, draft, { action: "save" }), props.sessionId); setDraft(null); await refresh(); }); } },
                field("标题", "title"), field("问题", "problem"), field("失败或修复尝试", "attempts"), field("修复方法", "solution"), field("验证依据", "evidence"),
                h("label", { className: "dsh-tavern-memory-field" }, "验证状态", h("select", { value: draft.status || "unverified", onChange: event => setDraft(Object.assign({}, draft, { status: event.target.value })) }, Object.entries(statuses).map(([value, label]) => h("option", { value: value, key: value }, label)))),
                h("div", { className: "dsh-tavern-memory-actions" }, h("button", { className: "dsh-tavern-btn", type: "submit", disabled: busy }, "保存"), h("button", { className: "dsh-tavern-btn", type: "button", onClick: () => setDraft(null) }, "取消"))) : null
        ));
}
