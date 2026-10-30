// Session settings own their loading/saving UI; host services and sibling
// settings panels are supplied explicitly rather than read from play-controls.
function createConversationSettingsModule({
    React, rpc, useLiveTavernView, useTavernSessionMode, isPlayMode,
    invalidateView, notifyTavernDataChanged,
    UserPreferenceProfileTab, TavernConversationWritingSkills, backgroundModelLabel
}) {
    const tavernSettingsSessionReads = new Map();
    function readTavernSettingsSession(sessionId) {
            const pending = tavernSettingsSessionReads.get(sessionId);
            if (pending) return pending;
            const read = rpc("getSession", {}, sessionId).finally(() => { if (tavernSettingsSessionReads.get(sessionId) === read) tavernSettingsSessionReads.delete(sessionId); });
            tavernSettingsSessionReads.set(sessionId, read);
            return read;
        }
    function TavernConversationPreset(props) {
        const h = React.createElement;
        const [data, setData] = React.useState(null);
        const [error, setError] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        const [notice, setNotice] = React.useState("");
        async function refresh(mount) {
            const [catalog, session] = await Promise.all([rpc("listPresets", {}, props.sessionId), mount ? readTavernSettingsSession(props.sessionId) : rpc("getSession", {}, props.sessionId)]);
            setData({ presets: catalog.presets || [], current: session.view?.runtimePreset });
        }
        React.useEffect(() => { refresh(true).catch(err => setError(String(err.message || err))); }, []);
        async function change(path) {
            setBusy(true); setError(""); setNotice("");
            try { await rpc("applyConversationPreset", { sessionId: props.sessionId, path }, props.sessionId); await refresh(); setNotice("已保存"); invalidateView(props.sessionId); notifyTavernDataChanged(["presets", "sessions"], "presets"); }
            catch (err) { setError(String(err.message || err)); }
            finally { setBusy(false); }
        }
        return h("div", { className: "dsh-local-field" }, h(InlineField, { kind: "menu", label: "本局预设", value: data?.current?.id || "", disabled: busy || !data, onCommit: change,
                    options: [{ value: "", label: "不使用酒馆预设" },
                        ...(data?.current?.id && !data.presets.some(p => p.path === data.current.id) ? [{ value: data.current.id, label: data.current.name + "（源文件已移除）" }] : []),
                        ...(data?.presets || []).filter(p => p.valid && p.recognized).map(p => ({ value: p.path, label: p.title }))] }),
            h("p", { className: "dsh-tavern-settings-desc" }, "用于后续正文，选择后自动保存。"), error ? h("p", { role: "alert" }, "保存失败：" + error) : h("span", { role: "status", className: "dsh-local-feedback" }, busy ? "保存中…" : notice));
    }

    function TavernLocalPlayerName(props) {
        const [name, setName] = React.useState(null), [busy, setBusy] = React.useState(false), [status, setStatus] = React.useState("");
        React.useEffect(() => { let active = true; readTavernSettingsSession(props.sessionId).then(result => { if (active) setName(result.view?.playerName || "你"); }, err => { if (active) setStatus("读取失败：" + err.message); }); return () => { active = false; }; }, []);
        async function save(value) {
            if (busy || value === name) return;
            setBusy(true); setStatus("保存中…");
            try { const result = await rpc("setPlayerName", { userName: value }, props.sessionId); setName(result.playerName || "你"); setStatus("已保存"); invalidateView(props.sessionId); notifyTavernDataChanged(["sessions"], "play-controls"); }
            catch (err) { setStatus("保存失败：" + err.message); }
            finally { setBusy(false); }
        }
        return React.createElement("div", { className: "dsh-local-field" },
            React.createElement(InlineField, { label: "玩家称呼", value: name || "", placeholder: "你", maxLength: 80, disabled: name === null || busy, onCommit: save }),
            React.createElement("p", { className: "dsh-local-help" }, "离开输入框后保存，仅用于后续内容。"), React.createElement("span", { role: "status", className: "dsh-local-feedback" }, status));
    }


    function TavernConversationPluginSettings(props) {
        const h = React.createElement;
        const [data, setData] = React.useState(null);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState("");
        const load = React.useCallback(async function () {
                try { setData((await rpc("listGamePlugins", {}, props.sessionId)).plugins); setError(""); }
                catch (err) { setError(String(err.message || err)); }
            }, [props.sessionId]);
        React.useEffect(function () { void load(); }, [load]);
        async function change(payload) {
            setBusy(true); setError("");
            try { setData((await rpc("setGamePlugin", payload, props.sessionId)).plugins); }
            catch (err) { setError(String(err.message || err)); }
            finally { setBusy(false); }
        }
        const pluginSettings = data && data.settings || [];
        const settingsBlock = pluginSettings.map(entry => h("section", { key: entry.plugin, className: "dsh-local-section dsh-tavern-plugin-settings", "aria-label": entry.title },
            h("h3", null, entry.title),
            entry.fields.map(field => h(TavernPluginSettingField, { key: field.key, field: field, value: entry.values[field.key], busy: busy,
                onChange: value => change({ setting: { plugin: entry.plugin, key: field.key, value: value } }) }))));
        if (!pluginSettings.length) return null;
        return h(React.Fragment, null, settingsBlock, error ? h("p", { role: "alert" }, "保存失败：" + error) : null);
    }

    // One option a plugin added to this game's settings (tavern.gameSettings), drawn like Tavern's own.
    function TavernPluginSettingField(props) {
        const h = React.createElement;
        const field = props.field;
        // the shared switch / inline field; a plugin's description is the 「?」.
        const help = field.description && typeof HelpTip === "function" ? h(HelpTip, { label: field.label + "说明" }, field.description) : null;
        if (field.type === "boolean") return h(InlineRow, { label: field.label, help },
            h(Switch, { label: field.label, checked: props.value === true, disabled: props.busy, onChange: value => props.onChange(value) }));
        if (field.type === "select") return h(InlineField, { kind: "menu", label: field.label, help, value: props.value, disabled: props.busy,
                options: field.options.map(option => ({ value: option.value, label: option.label })), onCommit: value => props.onChange(value) });
        // Numbers and text are saved when the field loses focus or on Enter; an empty number keeps the saved value.
        const number = field.type === "number";
        return h(InlineField, { kind: number ? "number" : "text", label: field.label, help, value: props.value ?? "", disabled: props.busy,
                min: field.min, max: field.max, step: field.step, maxLength: field.maxLength, validate: number ? value => value === null ? "请输入数字" : "" : undefined,
                onCommit: value => { if (value !== props.value) props.onChange(value); } });
    }

    // Per-game foreground tools: one switch per tool, stored as the disabled
    // names so a newly added tool starts enabled. Background settlement keeps
    // its own tools and is not part of this list.
    function TavernConversationTools(props) {
        const h = React.createElement;
        const [catalog, setCatalog] = React.useState([]);
        const [disabled, setDisabled] = React.useState([]);
        const [loaded, setLoaded] = React.useState(false);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState("");
        const [notice, setNotice] = React.useState("");
        const mounted = React.useRef(true);
        async function load() {
            try {
                const result = await rpc("getConversationBackgroundConfig", { sessionId: props.sessionId }, props.sessionId);
                if (!mounted.current) return;
                setCatalog(Array.isArray(result.foregroundTools) ? result.foregroundTools : []);
                setDisabled(Array.isArray(result.disabledForegroundTools) ? result.disabledForegroundTools : []);
                setLoaded(true); setError("");
            } catch (err) { if (mounted.current) setError(String(err.message || err)); }
        }
        React.useEffect(() => {
            mounted.current = true;
            void load();
            return () => { mounted.current = false; };
        }, [props.sessionId]);
        async function save(next) {
            if (busy || !loaded) return;
            const previous = disabled;
            setDisabled(next); setBusy(true); setError(""); setNotice("");
            try {
                const result = await rpc("setConversationBackgroundConfig", { sessionId: props.sessionId, disabledForegroundTools: next }, props.sessionId);
                setDisabled(Array.isArray(result.disabledForegroundTools) ? result.disabledForegroundTools : next);
                setNotice("已保存，下一轮生效");
                invalidateView(props.sessionId);
                notifyTavernDataChanged(["sessions"], "play-controls");
            } catch (err) { setDisabled(previous); setError(String(err.message || err)); }
            finally { setBusy(false); }
        }
        function toggle(name, enabled) {
            void save(enabled ? disabled.filter(value => value !== name) : [...new Set([...disabled, name])]);
        }
        const allNames = catalog.map(tool => tool.name);
        return h("section", { className: "dsh-local-section", "aria-label": "前台工具" },
            h("h3", null, "前台工具"),
            h("p", { className: "dsh-local-help" }, "逐项控制本轮正文能看到的工具；关闭后下一轮生效。后台结算的工具不在此列表。"),
            h("p", { className: "dsh-local-help" }, "插件/扩展工具来自宿主工具目录，本局生成一次后会按实际请求校正；列表里的「插件/扩展」就是这类工具。"),
            h("div", { style: { display: "flex", gap: "8px", margin: "4px 0 8px" } },
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: !loaded || busy || disabled.length === 0, onClick: () => void save([]) }, "全部开启"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: !loaded || busy || disabled.length === allNames.length, onClick: () => void save(allNames) }, "全部关闭"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: () => void load() }, "刷新")),
            catalog.map(tool => h("label", { key: tool.name, className: "dsh-tavern-background-task" },
                h("span", null, (tool.source === "plugin" ? "插件/扩展 · " : "") + tool.label, h("span", { className: "dsh-tavern-settings-desc" }, tool.description)),
                h("input", { type: "checkbox", role: "switch", "aria-label": tool.label, checked: !disabled.includes(tool.name), disabled: !loaded || busy, onChange: event => toggle(tool.name, event.target.checked) }))),
            error ? h("p", { role: "alert" }, "保存失败：" + error) : h("span", { role: "status", className: "dsh-local-feedback" }, busy ? "保存中…" : (loaded ? notice : "正在读取…")));
    }

    function TavernConversationSettingsTab(props) {
        const h = React.createElement;
        const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
        const mode = useTavernSessionMode(owner);
        return h("aside", { className: "dsh-tavern-status dsh-local-settings", "aria-label": "本局设置" },
            h("div", { className: "dsh-tavern-status-head" }, h("strong", null, "本局设置")),
            h("div", { className: "dsh-tavern-status-body" }, isPlayMode(mode) ? h(React.Fragment, null,
                h("p", { className: "dsh-local-intro" }, "仅影响本局，修改后自动保存，已有对话和变量会保留。"),
                h("p", { className: "dsh-local-warning dsh-local-intro" }, "切换预设、长期偏好、模型、结算或联网搜索后，下一次请求要重建缓存，耗时和费用会增加。"),
                h("section", { className: "dsh-local-section" }, h("h3", null, "游玩"),
                    h(TavernLocalPlayerName, { key: owner + ":name", sessionId: owner }),
                    h(TavernConversationPreset, { key: owner + ":preset", sessionId: owner }),
                    h(UserPreferenceProfileTab, { key: owner + ":profile", scope: { sessionId: owner }, conversationOnly: true })),
                h(TavernConversationBackgroundModel, { key: owner, sessionId: owner }),
                h(TavernConversationPluginSettings, { key: owner + ":plugin-settings", sessionId: owner }),
                h("details", { className: "dsh-local-advanced" }, h("summary", null, "高级"),
                    h(TavernConversationTools, { key: owner + ":tools", sessionId: owner }),
                    h(TavernConversationWritingSkills, { key: owner + ":skills", sessionId: owner }))) : h("p", null, "请选择一个游玩对话。")));
    }

    function TavernConversationSettingsAction(props) {
        const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
        const mode = useTavernSessionMode(owner);
        if (!isPlayMode(mode)) return null;
        return React.createElement("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-header-settings", "aria-label": "酒馆状态", title: "查看本局酒馆状态", onClick: () => props.open(owner) },
            React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": "true" },
                React.createElement("path", { d: "M4 7h3m4 0h9M4 17h9m4 0h3" }),
                React.createElement("circle", { cx: 9, cy: 7, r: 2 }), React.createElement("circle", { cx: 15, cy: 17, r: 2 })),
            React.createElement("span", { className: "dsh-tavern-header-action-label" }, "酒馆状态"));
    }

    function TavernConversationBackgroundModel(props) {
        const h = React.createElement;
        const [catalog, setCatalog] = React.useState([]);
        const [selection, setSelection] = React.useState(null);
        const [tasks, setTasks] = React.useState({ variables: true, posture: true });
        const [features, setFeatures] = React.useState({ webSearchEnabled: false, mvuCard: false });
        const [loaded, setLoaded] = React.useState(false);
        const [busy, setBusy] = React.useState(false);
        const [error, setError] = React.useState("");
        const [notice, setNotice] = React.useState("");
        const [reasoning, setReasoning] = React.useState({ key: "", value: null, error: "" });
        const [slotState, setSlotState] = React.useState({slots:[],values:{},scoringCatalog:[]});
        const key = selection ? JSON.stringify({ provider: selection.provider, model: selection.model }) : "";
        async function load() {
            setError("");
            try {
                const result = await rpc("getConversationBackgroundConfig", { sessionId: props.sessionId }, props.sessionId);
                setSlotState({slots:result.modModelSlots || [],values:result.modModels || {},scoringCatalog:result.scoringCatalog || []});
                setCatalog(result.modelCatalog || []); setSelection(result.backgroundModel);
                setTasks(result.backgroundTasks); setFeatures({ webSearchEnabled: result.webSearchEnabled === true, mvuCard: result.mvuCard === true }); setLoaded(true);
            } catch (err) { setError(String(err.message || err)); }
        }
        React.useEffect(() => { void load(); }, []);
        React.useEffect(() => {
            let active = true;
            if (key) rpc("getBackgroundModelReasoning", JSON.parse(key), props.sessionId).then(result => {
                if (active) setReasoning({ key, value: result.reasoning, error: "" });
            }, err => { if (active) setReasoning({ key, value: null, error: String(err.message || err) }); });
            return () => { active = false; };
        }, [key]);
        async function save(patch) {
            if (busy || !loaded) return;
            setBusy(true); setError(""); setNotice("");
            try {
                const result = await rpc("setConversationBackgroundConfig", Object.assign({ sessionId: props.sessionId, backgroundModel: selection }, patch), props.sessionId);
                setSlotState(current=>({...current,values:result.modModels || {}}));
                setSelection(result.backgroundModel); setTasks(result.backgroundTasks); setFeatures({ ...features, webSearchEnabled: result.webSearchEnabled });
                setNotice("已保存");
                invalidateView(props.sessionId);
            } catch (err) { setError(String(err.message || err)); }
            finally { setBusy(false); }
        }
        const efforts = reasoning.key === key ? reasoning.value?.efforts || [] : [];
        const modelOptions = () => catalog.flatMap(group => group.models.map(model => ({ value: JSON.stringify({ provider: group.provider, model: model.id }), label: (group.providerName || group.provider) + " · " + (model.name || model.id) })));
        const known = !selection || catalog.some(group => group.provider === selection.provider && group.models.some(model => model.id === selection.model));
        const toggle = (name, title, description, checked, patch, disabled = false) => h("label", { key: name, className: "dsh-tavern-background-task" },
            h("span", null, title, h("span", { className: "dsh-tavern-settings-desc" }, description)),
            h(Switch, { label: title, checked, disabled: !loaded || busy || disabled, onChange: value => save(patch(value)) }));
        return h("div", { className: "dsh-local-runtime" },
            h(TavernModelSlotGroups,{slots:slotState.slots,values:slotState.values,catalog,scoringCatalog:slotState.scoringCatalog,local:true,disabled:!loaded || busy,onChange:modModelSelection=>save({modModelSelection})}),
            h("section", { className: "dsh-local-section" }, h("h3", null, "后台模型"),
                h("p", { className: "dsh-tavern-settings-desc" }, "仅影响本局，下一次后台任务生效。正在运行的任务不变，保留原后台 Agent 和历史。"),
                h("p", { className: "dsh-tavern-settings-desc" }, "建议前台和后台使用 High 推理强度，优先保证正文输出和后台任务的质量。不推荐 Max，以免过度思考、增加等待。若更在意响应速度，可按需降低。"),
                h("p", { className: "dsh-local-warning" }, "切换模型或推理强度会使缓存失效，首次请求会增加耗时和费用。"),
                h(InlineField, { kind: "menu", label: "本局后台模型", value: key, disabled: !loaded || busy,
                        onCommit: value => save({ backgroundModel: value ? JSON.parse(value) : null }),
                        options: [{ value: "", label: "跟随前台" }, ...(!known ? [{ value: key, label: backgroundModelLabel(selection, catalog) + "（当前不可用）" }] : []), ...modelOptions()] }),
                h(InlineField, { kind: "menu", label: "本局后台推理强度", value: selection?.reasoningEffort || "", disabled: !key || !efforts.length || busy,
                        onCommit: value => { const next = { ...selection }; if (value) next.reasoningEffort = value; else delete next.reasoningEffort; return save({ backgroundModel: next }); },
                        options: [{ value: "", label: key ? "模型默认" : "跟随前台" }, ...efforts.map(item => ({ value: item.id, label: item.name || item.id }))] })),
            h("section", { className: "dsh-local-section" }, h("h3", null, "功能"),
                toggle("posture", "人物姿势", "每轮总结人物的位置、动作和姿势，供前台保持一致。", tasks.posture, checked => ({ backgroundTasks: { posture: checked } })),
                toggle("styleReference", "文风联想", "仅自由模式。前台写正文前，结合本轮场景联想一段笔调参考；与写作共享上下文，不另开后台任务。", tasks.styleReference === true, checked => ({ backgroundTasks: { styleReference: checked } })),
                toggle("webSearchEnabled", "联网搜索", "前台和后台可按需搜索。", features.webSearchEnabled, checked => ({ webSearchEnabled: checked }))),
            error || key && reasoning.key === key && reasoning.error ? h("p", { role: "alert", className: "dsh-tavern-prompt-error" }, error || reasoning.error) : null,
            notice ? h("p", { role: "status" }, notice) : null,
            !loaded && error ? h("button", { className: "dsh-tavern-btn", onClick: load }, "重试") : null,
            h("div", { role: "status", className: "dsh-local-feedback" }, busy ? "保存中…" : ""));
    }

    return { TavernConversationSettingsTab, TavernConversationSettingsAction };
}
