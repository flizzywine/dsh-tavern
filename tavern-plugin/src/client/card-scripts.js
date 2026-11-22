// The current game’s helper scripts, with read-only source and machine-local runtime switches.

// Shared read-only viewer for the card workspace and the current game's script snapshot.
function TavernScriptCode({ label, content, collapsible }) {
    const h = React.createElement;
    const text = String(content || "（空）");
    const lineCount = text.split(/\r\n|\r|\n/).length;
    function render() {
        return h("div", { className: "dsh-tavern-script-code-scroll", tabIndex: 0, role: "region", "aria-label": label },
            h("div", { className: "dsh-tavern-script-code-lines", "aria-hidden": true }, Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")),
            h("pre", null, h("code", null, text)));
    }
    if (!collapsible) return h("div", { className: "dsh-tavern-script-code" }, render());
    return h(TavernLazyDetails, { className: "dsh-tavern-script-code", render,
        summary: h("summary", null, label, h("span", { className: "dsh-tavern-script-code-count" }, lineCount + " 行 · 只读")) });
}

function CardScriptSource({ sessionId, script }) {
    const h = React.createElement;
    const [result, setResult] = React.useState(null);
    const [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
        const controller = new AbortController();
        rpc("getCardScriptSource", { ref: script.ref, id: script.id }, sessionId, { signal: controller.signal }).then(
            data => { if (!controller.signal.aborted) setResult(data); },
            error => { if (!controller.signal.aborted) setResult({ error: String(error?.message || error) }); });
        return () => controller.abort();
    }, [sessionId, script.ref, script.id, retry]);
    if (!result) return h("p", { role: "status", className: "fork-bubble-hint" }, "正在读取代码…");
    if (result.error) return h("div", { className: "fork-scripts-source-error" },
        h("p", { role: "alert", className: "fork-bubble-note is-error" }, result.error),
        h("button", { type: "button", className: "dsh-tavern-btn", onClick: () => { setResult(null); setRetry(value => value + 1); } }, "重试"));
    return h(TavernScriptCode, { label: (script.name || "未命名脚本") + " 代码", content: result.content });
}

function CardScriptRow({ sessionId, script, busy, onToggle }) {
    const h = React.createElement;
    const [expanded, setExpanded] = React.useState(false);
    const running = script.enabled && !script.muted;
    const name = script.name || "未命名脚本";
    return h("li", { className: "fork-scripts-row" + (running ? "" : " is-off") },
        h("span", { className: "fork-scripts-icon", "aria-hidden": true }, h(Icon, { name: script.audio ? (running ? "speaker" : "speaker-off") : "card", size: 15 })),
        h("span", { className: "fork-scripts-name" },
            h("button", { type: "button", className: "fork-scripts-open", title: expanded ? "收起代码" : "查看代码",
                "aria-expanded": expanded, "aria-label": name + (expanded ? " · 收起代码" : " · 查看代码"), onClick: () => setExpanded(value => !value) },
                h("b", null, name), h(Icon, { name: "chevron", size: 14 })),
            h("small", null, !script.enabled ? "卡片里已关闭" : script.muted ? "本机已停用" : script.audio ? "运行中 · 会播放声音" : "运行中")),
        h(Switch, { title: !script.enabled ? "卡片里已关闭" : running ? "停用这个脚本" : "恢复运行", label: (script.name || "脚本") + " 运行",
            checked: running, disabled: !script.enabled || busy, onChange: onToggle }),
        expanded ? h("div", { className: "fork-scripts-source" }, h(CardScriptSource, { sessionId, script })) : null);
}

function CardScriptsTab(props) {
    const h = React.createElement;
    const sessionId = props.scope && props.scope.sessionId || "";
    const [state, setState] = React.useState({ sessionId: "", data: null, error: "", busy: "" });
    React.useEffect(function () {
        if (!sessionId) return;
        let live = true;
        setState({ sessionId, data: null, error: "", busy: "" });
        rpc("getCardScripts", {}, sessionId).then(data => { if (live) setState({ sessionId, data, error: "", busy: "" }); },
            error => { if (live) setState({ sessionId, data: null, error: String(error && error.message || error), busy: "" }); });
        return () => { live = false; };
    }, [sessionId]);
    if (!sessionId) return h("div", { className: "fork-scripts-tab" }, h("p", { className: "fork-bubble-hint" }, "打开一局游戏后，这里列出它的人物卡脚本。"));
    const data = state.sessionId === sessionId ? state.data : null;
    async function toggle(script) {
        setState(value => ({ ...value, busy: script.id, error: "" }));
        try {
            const next = await rpc("setCardScriptMuted", { id: script.id, muted: !script.muted }, sessionId);
            setState(value => value.sessionId === sessionId ? { sessionId, data: next, error: "", busy: "" } : value);
            if (typeof liveTavernView !== "undefined" && liveTavernView.invalidate) liveTavernView.invalidate(sessionId);
        } catch (error) { setState(value => value.sessionId === sessionId ? { ...value, busy: "", error: String(error && error.message || error) } : value); }
    }
    const scripts = data ? data.scripts || [] : [];
    return h("div", { className: "fork-scripts-tab" },
        h("header", { className: "fork-scripts-head" },
            h("strong", null, "卡片脚本"), data && data.cardName ? h("span", { title: data.cardName }, data.cardName) : null,
            h(HelpTip, { label: "卡片脚本说明" },
                h("span", null, "人物卡自带的脚本（酒馆助手脚本），比如 MVU 变量、状态栏、BGM 播放器。"),
                h("span", null, "关掉某个脚本只影响这台电脑上玩这张卡，不会修改卡片；刷新游戏画面后生效。卡片自己标为关闭的脚本不能在这里打开。"))),
        state.error ? h("p", { className: "fork-bubble-note is-error", role: "alert" }, state.error) : null,
        !data && !state.error ? h("p", { className: "fork-bubble-hint" }, "正在读取…") : null,
        data && !scripts.length ? h("p", { className: "fork-bubble-hint" }, "这张卡没有脚本。") : null,
        scripts.length ? h("ul", { className: "fork-scripts-list" }, scripts.map(script =>
            h(CardScriptRow, { key: JSON.stringify([sessionId, data.cardId, script.ref]), sessionId, script,
                busy: state.busy === script.id, onToggle: () => toggle(script) }))) : null);
}
