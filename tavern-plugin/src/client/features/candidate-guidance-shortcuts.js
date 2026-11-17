// A guide can be dismissed while a save is still writing to the profile.
const candidateGuidanceSaves = new Map();

function CandidateGuidanceShortcuts({ mode, guidance, onPick }) {
    const h = React.createElement;
    const [items, setItems] = React.useState(null);
    const [readAttempt, setReadAttempt] = React.useState(0);
    const [readFailed, setReadFailed] = React.useState(false);
    const [managing, setManaging] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    const chipList = React.useRef(null);
    const revealLast = React.useRef(false);

    async function readItems() {
        const saving = candidateGuidanceSaves.get(mode);
        if (saving) await saving.catch(() => {});
        const reply = await rpc("getCandidateGuidanceShortcuts");
        const list = reply?.shortcuts?.[mode];
        if (!Array.isArray(list)) throw new Error("快捷提示列表无效");
        return list;
    }

    React.useEffect(function () {
        let active = true;
        readItems().then(list => { if (active) setItems(list); }, () => { if (active) setReadFailed(true); });
        return () => { active = false; };
    }, [mode, readAttempt]);

    React.useLayoutEffect(function () {
        if (revealLast.current && chipList.current) chipList.current.scrollTop = chipList.current.scrollHeight;
        revealLast.current = false;
    }, [items]);

    async function save(next, reveal = false) {
        if (candidateGuidanceSaves.has(mode) || items === null) return false;
        setBusy(true);
        setNotice(null);
        try {
            const saving = rpc("saveCandidateGuidanceShortcuts", { mode, items: next, expected: items })
                .finally(() => candidateGuidanceSaves.delete(mode));
            candidateGuidanceSaves.set(mode, saving);
            const reply = await saving;
            revealLast.current = reveal;
            setItems(reply.shortcuts[mode]);
            setNotice({ text: next === null ? "已恢复默认" : "已保存快捷提示" });
            return true;
        } catch (error) {
            let message = error?.message || "请重试。";
            if (error?.code === "CANDIDATE_SHORTCUTS_CHANGED") {
                try { setItems(await readItems()); }
                catch (_) { message = "请重新打开候选项面板后重试。"; }
            }
            setNotice({ error: true, text: "无法保存快捷提示。" + message });
            return false;
        } finally {
            setBusy(false);
        }
    }

    if (items === null) {
        return readFailed
            ? h("div", { className: "dsh-tavern-candidate-shortcuts" },
                h("span", { className: "dsh-tavern-candidate-shortcut-note", role: "alert" }, "快捷提示读取失败"),
                h("button", { type: "button", className: "dsh-tavern-candidate-shortcut-action", "aria-label": "重试读取快捷提示", onClick: () => { setReadFailed(false); setReadAttempt(n => n + 1); } }, "重试"))
            : h("span", { className: "dsh-tavern-candidate-shortcut-note", role: "status" }, "正在读取快捷提示…");
    }

    const draft = guidance.trim();
    const savedDraft = items.includes(draft);
    const feedback = busy || notice ? h("div", { className: "dsh-tavern-candidate-shortcut-note", role: notice?.error ? "alert" : "status" },
        busy ? "正在保存快捷提示…" : notice.text) : null;
    return h("div", { className: "dsh-tavern-candidate-shortcuts", role: "group", "aria-label": "快捷提示" },
        items.length ? h("div", { className: "dsh-tavern-candidate-shortcut-chips", ref: chipList }, items.map(text =>
            h("button", { key: text, type: "button", className: "dsh-tavern-regen-example dsh-tavern-candidate-shortcut-chip", title: text, onClick: () => onPick(text) }, text))) : null,
        h("div", { className: "dsh-tavern-candidate-shortcut-actions" },
            h("button", { type: "button", className: "dsh-tavern-candidate-shortcut-action", title: savedDraft ? "这条快捷提示已保存" : undefined,
                disabled: busy || !draft || savedDraft, onClick: () => void save([...items, draft], true) }, "保存为快捷提示"),
            h("button", { type: "button", className: "dsh-tavern-candidate-shortcut-action", "aria-haspopup": "dialog", onClick: () => { setNotice(null); setManaging(true); } }, "管理")),
        managing ? h(CandidateGuidanceShortcutManager, {
            mode, items, busy, feedback, onSave: save, clearNotice: () => setNotice(null), onClose: () => { setNotice(null); setManaging(false); }
        }) : feedback);
}

function CandidateGuidanceShortcutManager({ mode, items, busy, feedback, onSave, clearNotice, onClose }) {
    const h = React.createElement;
    const [editor, setEditor] = React.useState(null);
    const addButton = React.useRef(null);
    const editorInput = React.useRef(null);
    const restoreFocus = React.useRef(null);
    const value = editor?.value.trim() || "";
    const editIndex = editor ? items.indexOf(editor.original) : -1;
    const duplicate = items.includes(value) && value !== editor?.original;

    React.useEffect(function () {
        if (busy || editor || !restoreFocus.current) return;
        const { dialog, button } = restoreFocus.current;
        restoreFocus.current = null;
        if (dialog && document.activeElement !== dialog) return;
        const target = button?.isConnected && !button.disabled ? button : addButton.current;
        target?.focus({ preventScroll: true });
    }, [busy, editor, items]);

    function startEdit(original) {
        clearNotice();
        setEditor({ original, value: original || "" });
    }

    function closeEditor() {
        restoreFocus.current = {};
        setEditor(null);
    }

    async function saveEditor() {
        const next = items.slice();
        if (editIndex < 0) next.push(value);
        else next[editIndex] = value;
        // The save button is disabled during the request. The draft stays focusable.
        editorInput.current?.focus({ preventScroll: true });
        if (await onSave(next)) closeEditor();
    }

    function saveList(event, next) {
        const button = event.currentTarget;
        const dialog = button.closest('[role="dialog"]');
        // The row's button may be disabled or removed by the save.
        if (dialog) {
            restoreFocus.current = { dialog, button };
            dialog.focus({ preventScroll: true });
        }
        void onSave(next);
    }

    function move(event, index, direction) {
        const next = items.slice();
        const other = index + direction;
        [next[index], next[other]] = [next[other], next[index]];
        saveList(event, next);
    }

    return h(LargeModal, { open: true, title: "管理快捷提示", subtitle: mode === "script" ? "剧本模式" : "普通模式",
        className: "dsh-tavern-candidate-shortcut-modal", onClose },
        h("div", { className: "dsh-tavern-candidate-shortcut-actions" },
            h("button", { type: "button", className: "dsh-tavern-btn", ref: addButton, "data-autofocus": busy ? undefined : "", disabled: busy || Boolean(editor), onClick: () => startEdit(null) }, "新增快捷提示"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || Boolean(editor), onClick: event => saveList(event, null) }, "恢复默认")),
        feedback,
        editor ? h("div", { className: "dsh-tavern-candidate-shortcut-editor" },
            h(TextArea, { className: "dsh-tavern-regen-input", rows: 3, autoFocus: true, inputRef: editorInput, label: "快捷提示内容", placeholder: "输入生成要求", value: editor.value, readOnly: busy,
                "data-fork-draft": editor.value !== (editor.original || "") ? "" : undefined,
                onChange: text => { clearNotice(); setEditor({ ...editor, value: text }); },
                onKeyDown: event => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    if (event.nativeEvent?.isComposing || busy) return;
                    event.preventDefault();
                    clearNotice();
                    closeEditor();
                } }),
            duplicate ? h("div", { className: "dsh-tavern-candidate-shortcut-note", role: "status" }, "已有相同的快捷提示") : null,
            editor.original !== null && editIndex < 0 ? h("div", { className: "dsh-tavern-candidate-shortcut-note" }, "原提示已变更，可以把这段内容另存为新提示。") : null,
            h("div", { className: "dsh-tavern-candidate-shortcut-actions" },
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !value || duplicate || value === editor.original, onClick: () => void saveEditor() }, editor.original !== null && editIndex < 0 ? "另存为新提示" : "保存"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: () => { clearNotice(); closeEditor(); } }, "取消编辑"))) : null,
        items.length ? h("ul", { className: "dsh-tavern-candidate-shortcut-list", "aria-label": "快捷提示顺序" }, items.map((text, index) => {
            function action(label, caption, click, disabled, danger) {
                return h("button", { type: "button", className: "dsh-tavern-header-op" + (danger ? " is-danger" : ""), disabled: busy || Boolean(editor) || disabled,
                    title: label, "aria-label": label + "第 " + (index + 1) + " 条快捷提示", onClick: click }, caption);
            }
            return h("li", { key: text },
                h("span", { className: "dsh-tavern-candidate-shortcut-text", title: text }, text),
                h("div", { className: "dsh-tavern-candidate-shortcut-ops" },
                    action("上移", "↑", event => move(event, index, -1), index === 0),
                    action("下移", "↓", event => move(event, index, 1), index === items.length - 1),
                    action("编辑", "编辑", () => startEdit(text)),
                    action("删除", "删除", event => saveList(event, items.filter(item => item !== text)), false, true)));
        })) : h("p", { className: "dsh-tavern-candidate-shortcut-note" }, "还没有快捷提示。"));
}
