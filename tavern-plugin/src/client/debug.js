// shell helpers.
// Debug view: developer chrome (trajectory tabs, token stats, reasoning,
// version/update block) is hidden in play sessions unless this is on.
const DEBUG_KEY = "dsh-tavern-fork-debug";
// retain the legacy key only until its server write succeeds.
function createDebugMigration(win) {
    let pending;
    return function migrate(save) {
        if (!pending) pending = (async function () {
            let legacy;
            try { legacy = win.localStorage.getItem(DEBUG_KEY); } catch (_) { return; }
            if (legacy === "1") await save(false);
            try { win.localStorage.removeItem(DEBUG_KEY); } catch (_) {}
        })().catch(function (error) { pending = null; throw error; });
        return pending;
    };
}
// Developer diagnostics (provider English, ids, raw failures) render only while this is on.
function debugViewOn() {
    return typeof document !== "undefined" && !!document.body && document.body.classList.contains("dsh-fork-debug");
}
function applyDebug(doc, enabled) {
    if (doc && doc.body) doc.body.classList.toggle("dsh-fork-debug", Boolean(enabled));
}
// one server-backed switch drives both the host and fork display classes.
function DebugSetting() {
    const h = React.createElement;
    const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
    const hidden = preferences ? preferences.hideContextAndReasoning : null;
    const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
    async function change(next) {
        if (busy) return;
        setBusy(true); setNotice("");
        try { await displayPreferences.save({ hideContextAndReasoning: !next }); setNotice("已保存"); }
        catch (error) { setNotice("保存失败：" + String(error.message || error)); }
        finally { setBusy(false); }
    }
    // No grey description (panel-ui-design.md §一.5): the explanation sits behind a 「?」, which must stay outside
    // any <label> (a button would become the label's control), so the title and the switch are separate labels.
    const id = React.useId ? React.useId() : "fork-debug-setting";
    // a row of the 显示与交互 card, never a card itself — with the card class
    // (.dsh-tavern-settings-group) the page's card rule turned this row into a column (title on top, switch at the bottom).
    return h("div", { className: "dsh-tavern-settings-row dsh-fork-debug-setting" },
        h("span", { className: "dsh-tavern-settings-copy" },
            h("span", { className: "dsh-tavern-settings-title" }, h("label", { htmlFor: id }, "调试视图"),
                typeof HelpTip === "function" ? h(HelpTip, { label: "调试视图说明" }, "显示上下文、推理、轨迹、Token 统计、子代理入口与版本信息。设置保存在服务端，对所有对话生效。") : null)),
        h("span", { className: "dsh-tavern-settings-control" },
            notice ? h("span", { className: "dsh-tavern-settings-note", role: "status" }, notice) : null,
            // the one switch (inline-field.js Switch).
            h(Switch, { id, label: "调试视图", checked: hidden === false, disabled: hidden === null || busy, onChange: change })));
}


// Feature-owned dialogs use the host portal without depending on the shell plugin.
function bodyPortal(node) { return ReactDOM && document.body ? ReactDOM.createPortal(node, document.body) : node; }
