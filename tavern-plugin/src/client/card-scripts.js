// a sidebar tab listing the current game's card helper
// scripts (Tavern Helper), with a per-card switch to keep one from running during play — e.g. a card's
// own BGM player when the stage music is in use. The card itself is never edited; upstream's card
// detail page shows the scripts read-only. Host: lib/card-scripts.js (getCardScripts,
// setCardScriptMuted); a change reaches the game on the next session view refresh.

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
            setState({ sessionId, data: next, error: "", busy: "" });
            if (typeof liveTavernView !== "undefined" && liveTavernView.invalidate) liveTavernView.invalidate(sessionId);
        } catch (error) { setState(value => ({ ...value, busy: "", error: String(error && error.message || error) })); }
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
        scripts.length ? h("ul", { className: "fork-scripts-list" }, scripts.map(function (script) {
            const running = script.enabled && !script.muted;
            return h("li", { key: script.id, className: "fork-scripts-row" + (running ? "" : " is-off") },
                h("span", { className: "fork-scripts-icon", "aria-hidden": true }, h(Icon, { name: script.audio ? (running ? "speaker" : "speaker-off") : "card", size: 15 })),
                h("span", { className: "fork-scripts-name" }, h("b", null, script.name || "未命名脚本"),
                    h("small", null, !script.enabled ? "卡片里已关闭" : script.muted ? "本机已停用" : script.audio ? "运行中 · 会播放声音" : "运行中")),
                // the one switch (inline-field.js Switch).
                h(Switch, { title: !script.enabled ? "卡片里已关闭" : running ? "停用这个脚本" : "恢复运行", label: (script.name || "脚本") + " 运行",
                    checked: running, disabled: !script.enabled || state.busy === script.id, onChange: () => toggle(script) }));
        })) : null);
}
