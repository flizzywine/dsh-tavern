// 本局设置 — the per-game page of the right panel, drawn in the panel language of 舞台设置 (the tab beside it): caption
// sections on a hairline, one row per setting with its name on the left and its value or switch on the right edge,
// explanations only in the 「?」. The stage keeps its own options: here it is one row that opens 舞台设置. Host services and
// sibling pieces are supplied explicitly rather than read from play-controls.
function createConversationSettingsModule({
    React, rpc, useLiveTavernView, useTavernSessionMode, isPlayMode,
    invalidateView, notifyTavernDataChanged, openTab, packUi,
    UserPreferenceProfileTab, backgroundModelLabel
}) {
    const h = React.createElement;
    const errorText = err => String(err && err.message || err);
    const FOLD = title => "本局设置 › " + title;
    const help = (label, text) => h(HelpTip, { label: label + "说明" }, text);

    // Every write of this page goes through here: the page head says 「正在保存… / 已保存」 for the session, and the template
    // actions wait for writes still in flight (a name typed and the menu clicked at once).
    const tavernSettingsSessionReads = new Map();
    const tavernSettingsPendingWrites = new Map();
    const saveListeners = new Map();
    function emitSaveState(sessionId, state) { for (const listener of [...(saveListeners.get(sessionId) || [])]) listener(state); }
    function trackTavernSettingsWrite(sessionId, promise) {
        let pending = tavernSettingsPendingWrites.get(sessionId);
        if (!pending) {
            pending = new Set();
            tavernSettingsPendingWrites.set(sessionId, pending);
        }
        const settle = ok => {
            pending.delete(promise);
            if (pending.size) return;
            if (tavernSettingsPendingWrites.get(sessionId) === pending) tavernSettingsPendingWrites.delete(sessionId);
            emitSaveState(sessionId, ok ? "saved" : "idle");
        };
        pending.add(promise);
        emitSaveState(sessionId, "saving");
        promise.then(() => settle(true), () => settle(false));
        return promise;
    }
    async function flushTavernSettingsWrites(sessionId) {
        await new Promise(resolve => setTimeout(resolve, 0));
        const pending = tavernSettingsPendingWrites.get(sessionId);
        if (pending && pending.size) await Promise.allSettled([...pending]);
    }
    function useSaveState(sessionId) {
        const [state, setState] = React.useState("idle");
        React.useEffect(() => {
            let timer = 0;
            const listener = next => { clearTimeout(timer); setState(next); if (next === "saved") timer = setTimeout(() => setState("idle"), 1800); };
            if (!saveListeners.has(sessionId)) saveListeners.set(sessionId, new Set());
            saveListeners.get(sessionId).add(listener);
            return () => { clearTimeout(timer); saveListeners.get(sessionId)?.delete(listener); };
        }, [sessionId]);
        return state;
    }
    function readTavernSettingsSession(sessionId) {
        const pending = tavernSettingsSessionReads.get(sessionId);
        if (pending) return pending;
        const read = rpc("getSession", {}, sessionId).finally(() => { if (tavernSettingsSessionReads.get(sessionId) === read) tavernSettingsSessionReads.delete(sessionId); });
        tavernSettingsSessionReads.set(sessionId, read);
        return read;
    }
    // A section's rows: one hairline between rows, nothing around them.
    const rows = (...children) => h("div", { className: "dsh-session-rows" }, ...children);
    // ⚠ + one sentence (+ 重试 for a failed read), announced where it happened.
    const problemLine = (text, retry) => text ? h("div", { role: "alert", className: "dsh-session-problem" }, h(packUi.HintLine, { text, action: retry ? "重试" : undefined, onAction: retry })) : null;

    // ---------- 玩法 ----------
    function SessionPlayerName({ sessionId }) {
        const [name, setName] = React.useState(null), [error, setError] = React.useState("");
        React.useEffect(() => {
            let active = true;
            readTavernSettingsSession(sessionId).then(result => { if (active) setName(result.view?.playerName || "你"); }, err => { if (active) setError("读取失败：" + errorText(err)); });
            return () => { active = false; };
        }, [sessionId]);
        async function save(value) {
            if (value === name) return;
            setError("");
            try {
                const result = await trackTavernSettingsWrite(sessionId, rpc("setPlayerName", { userName: value }, sessionId));
                setName(result.playerName || "你");
                invalidateView(sessionId);
                notifyTavernDataChanged(["sessions"], "play-controls");
            } catch (err) { setError("保存失败：" + errorText(err)); }
        }
        return h(InlineField, { kind: "text", label: "玩家称呼", value: name || "", placeholder: name === null ? "正在读取…" : "你", maxLength: 80,
            help: help("玩家称呼", "设置本局故事中使用的玩家称呼。留空时使用「你」。"),
            disabled: name === null, error, onCommit: save });
    }
    function SessionPreset({ sessionId }) {
        const [data, setData] = React.useState(null), [error, setError] = React.useState(""), [busy, setBusy] = React.useState(false);
        async function refresh(mount) {
            const [catalog, session] = await Promise.all([rpc("listPresets", {}, sessionId), mount ? readTavernSettingsSession(sessionId) : rpc("getSession", {}, sessionId)]);
            setData({ presets: catalog.presets || [], current: session.view?.runtimePreset });
        }
        React.useEffect(() => { refresh(true).catch(err => setError("读取失败：" + errorText(err))); }, []);
        async function change(path) {
            setBusy(true); setError("");
            try {
                await trackTavernSettingsWrite(sessionId, rpc("applyConversationPreset", { sessionId, path }, sessionId));
                await refresh();
                invalidateView(sessionId);
                notifyTavernDataChanged(["presets", "sessions"], "presets");
            } catch (err) { setError("保存失败：" + errorText(err)); }
            finally { setBusy(false); }
        }
        const current = data?.current;
        return h(InlineField, { kind: "menu", label: "预设", controlLabel: "本局预设", value: current?.id || "", disabled: busy || !data, error, onCommit: change,
            help: help("预设", "为本局选择一套酒馆预设，应用其中的提示词和正则。"),
            placeholder: data ? undefined : "正在读取…",
            options: [{ value: "", label: "不使用酒馆预设" },
                ...(current?.id && !data.presets.some(p => p.path === current.id) ? [{ value: current.id, label: current.name + "（源文件已移除）" }] : []),
                ...(data?.presets || []).filter(p => p.valid && p.recognized).map(p => ({ value: p.path, label: p.title }))] });
    }

    // ---------- 后台配置 (模型 · 功能 · 前台工具 · the stage row's leftovers): one read, one writer ----------
    // `preview` is shown at once and put back if the write fails (a switch that flips back); the write's result is merged.
    // One read of a settings record, read again when a Tavern module (the stage, a plugin) turns on or off so its rows come
    // and go; a write holds those re-reads until it settles, then reconciles with one more read.
    const settingsEvents = ["dsh-tavern-mods-changed", "dsh-tavern-settings-changed"];
    function useSessionSettings(sessionId, { readMethod, writeMethod, signalId, signalKinds }) {
        const [data, setData] = React.useState(null), [error, setError] = React.useState(""), [busy, setBusy] = React.useState(false);
        const active = React.useRef(null);
        React.useEffect(() => {
            const reader = createSessionRefreshController({
                load: ({ signal }) => rpc(readMethod, { sessionId }, sessionId, { signal }),
                loadTimeoutMs: 10000,
                onResult: result => { setData(result); setError(""); },
                onError: err => setError(errorText(err))
            });
            const state = { reader, writing: false };
            active.current = state;
            const refresh = () => { if (!state.writing) reader.request(); };
            reader.start();
            const stops = signalKinds.map(kind => tavernSessionSignals?.subscribe(signalId, kind, refresh));
            for (const event of settingsEvents) window.addEventListener(event, refresh);
            refresh();
            return () => {
                active.current = null;
                reader.stop();
                for (const stop of stops) stop?.();
                for (const event of settingsEvents) window.removeEventListener(event, refresh);
            };
        }, [sessionId, readMethod, signalId]);
        // `preview` is shown at once and put back if the write fails (a switch that flips back); the write's result is merged.
        async function save(patch, preview) {
            const state = active.current;
            if (!state || state.writing || !data) return "";
            const before = data;
            if (preview) setData({ ...data, ...preview });
            state.writing = true;
            setBusy(true);
            state.reader.replace();
            try {
                const result = await trackTavernSettingsWrite(sessionId, rpc(writeMethod, { sessionId, ...patch }, sessionId));
                if (active.current === state) { setData(current => ({ ...current, ...result })); setError(""); }
                invalidateView(sessionId);
                return "";
            } catch (err) { if (active.current === state) setData(before); return "保存失败：" + errorText(err); }
            finally {
                if (active.current === state) { state.writing = false; setBusy(false); state.reader.request(); }
            }
        }
        const load = () => { const state = active.current; if (state && !state.writing) state.reader.request(); };
        return { data, error, busy, load, save };
    }
    const useSessionConfig = sessionId => useSessionSettings(sessionId, { readMethod: "getConversationBackgroundConfig", writeMethod: "setConversationBackgroundConfig",
        signalId: "plugin:dsh-tavern-stage", signalKinds: ["plugin-lifecycle", "stage-settings"] });
    function useSectionWriter(config) {
        const [problem, setProblem] = React.useState("");
        return [problem, async (patch, preview) => { setProblem(""); const failed = await config.save(patch, preview); setProblem(failed); return !failed; }];
    }

    // One model row: name (?) …… model ⌄ · effort ⌄. The provider is the menu's group heading; the effort the menu offers
    // for the chosen model, 推荐 beside High. `scoring` (a probability interface) has no effort.
    function SessionModelRow({ sessionId, label, helpText, controlLabel, effortLabel, selection, catalog, fallback, disabled, scoring, onModel, onEffort, onProblem }) {
        const key = selection ? JSON.stringify({ provider: selection.provider, model: selection.model }) : "";
        const [reasoning, setReasoning] = React.useState({ key: "", efforts: [] });
        React.useEffect(() => {
            let active = true;
            if (key && !scoring) rpc("getBackgroundModelReasoning", JSON.parse(key), sessionId).then(result => {
                if (active) { setReasoning({ key, efforts: result.reasoning?.efforts || [] }); onProblem(""); }
            }, err => { if (active) { setReasoning({ key, efforts: [] }); onProblem("读取推理强度失败：" + errorText(err)); } });
            return () => { active = false; };
        }, [key]);
        const efforts = reasoning.key === key ? reasoning.efforts : [];
        const known = !selection || catalog.some(group => group.provider === selection.provider && group.models.some(model => model.id === selection.model));
        const models = [{ value: "", label: fallback },
            ...(!known ? [{ value: key, label: backgroundModelLabel(selection, catalog) + "（当前不可用）" }] : []),
            ...catalog.flatMap(group => group.models.map(model => ({ value: JSON.stringify({ provider: group.provider, model: model.id }), label: model.name || model.id, group: group.providerName || group.provider })))];
        const effort = selection?.reasoningEffort || "";
        return h(InlineRow, { label, help: helpText ? help(label, helpText) : null, className: "dsh-session-model" },
            h("span", { className: "dsh-session-model-picks" },
                h(InlineField, { kind: "menu", label: controlLabel, hideLabel: true, value: key, disabled, options: models, onCommit: value => onModel(value ? JSON.parse(value) : null) }),
                scoring ? null : h(InlineField, { kind: "menu", label: effortLabel, hideLabel: true, value: effort, disabled: disabled || !key || !efforts.length,
                    options: [{ value: "", label: key ? "模型默认" : fallback },
                        ...(effort && !efforts.some(item => item.id === effort) ? [{ value: effort, label: effort }] : []),
                        ...efforts.map(item => ({ value: item.id, label: item.name || item.id, note: item.id === "high" ? "推荐" : undefined }))],
                    onCommit: onEffort })));
    }
    function SessionModelSection({ sessionId, config }) {
        const [problem, write] = useSectionWriter(config);
        const [reasonProblem, setReasonProblem] = React.useState("");
        const data = config.data, disabled = !data || config.busy, catalog = data?.modelCatalog || [];
        const selection = data?.backgroundModel || null;
        // the core's own slots stay per game here; stage and mod slots live in 舞台配置 › 舞台模型.
        const slots = (data?.modModelSlots || []).filter(slot => slot.owner === "core");
        const slotCatalog = slot => slot.kind === "scoring" ? (data.scoringCatalog || []).map(row => ({ provider: row.provider, models: [{ id: row.model }] })) : catalog;
        return h(packUi.StageSection, { title: "模型", foldKey: FOLD("模型"),
                help: "只影响这一局，下一次后台任务生效；正在运行的任务不变。建议 High 推理强度，Max 容易过度思考、增加等待。切换会让缓存失效，下一次请求更慢、费用更高。" },
            !data && !config.error ? h(PanelLoading, { shape: "fields", count: 1 }) : null,
            data ? rows(
                h(SessionModelRow, { sessionId, label: "后台模型", helpText: "结算、候选、精修、导演等幕后任务用的模型。",
                    controlLabel: "本局后台模型", effortLabel: "本局后台推理强度", selection, catalog, fallback: "跟随前台", disabled, onProblem: setReasonProblem,
                    onModel: value => write({ backgroundModel: value }),
                    onEffort: value => { const next = { ...selection }; if (value) next.reasoningEffort = value; else delete next.reasoningEffort; return write({ backgroundModel: next }); } }),
                ...slots.map(slot => {
                    const current = data.modModels?.[slot.modId]?.[slot.id] || null;
                    const put = value => write({ modModelSelection: { modId: slot.modId, slotId: slot.id, selection: value } });
                    return h(SessionModelRow, { key: slot.modId + "/" + slot.id, sessionId, label: slot.label, helpText: slot.purpose, controlLabel: slot.label, effortLabel: slot.label + "推理强度",
                        selection: current, catalog: slotCatalog(slot), fallback: "跟随全局", scoring: slot.kind === "scoring", disabled, onProblem: setReasonProblem,
                        onModel: put, onEffort: value => put({ ...current, reasoningEffort: value || null }) });
                })) : null,
            problemLine(config.error ? "读取失败：" + config.error : "", config.error ? config.load : null),
            problemLine(problem || reasonProblem));
    }

    // ---------- 舞台: one row into 舞台设置 ----------
    // Opening 舞台设置 holds the stage client until this page closes, including first-time setup for ordinary cards.
    function waitStageClient() {
        if (galStageAvailable.get()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const off = galStageAvailable.subscribe(() => { if (galStageAvailable.get()) { clearTimeout(timer); off(); resolve(); } });
            const timer = setTimeout(() => { off(); reject(new Error("舞台暂时无法加载，请稍后重试")); }, 15000);
        });
    }
    function SessionStageSection({ sessionId, config, stage }) {
        const [opening, setOpening] = React.useState(false), [problem, setProblem] = React.useState("");
        const [writeProblem, write] = useSectionWriter(config);
        const hold = React.useRef(null);
        React.useEffect(() => () => { if (hold.current) hold.current(); }, []);
        async function open() {
            if (opening) return;
            setOpening(true); setProblem("");
            try {
                if (!hold.current) hold.current = galStageHold();
                await waitStageClient();
                await openTab("dsh-tavern:bubbles", sessionId);
            } catch (err) { setProblem(errorText(err)); }
            finally { setOpening(false); }
        }
        const word = stage.stage ? "舞台模式已开启" : stage.dialogue ? "仅对话气泡" : "未开启";
        // A model this game chose for a stage slot before the stage kept them: still used, so it is named here, with the way back.
        const data = config.data;
        const chosen = (data?.modModelSlots || []).filter(slot => slot.owner !== "core" && data.modModels?.[slot.modId]?.[slot.id]);
        async function followGlobal() {
            for (const slot of chosen) if (!await write({ modModelSelection: { modId: slot.modId, slotId: slot.id, selection: null } })) return;
        }
        return h(packUi.StageSection, { title: "舞台", foldKey: FOLD("舞台"),
                help: "可在「舞台设置」为这张卡启用舞台，或调整对话气泡、配音等功能。舞台模型在侧栏首页的「舞台装置 → 舞台配置」里。" },
            rows(h(packUi.SwitchRow, { label: "舞台设置", icon: "stage", onOpen: () => void open(),
                tag: h("span", { className: "dsh-session-stage-state" }, opening ? h(Spinner, { label: "正在打开舞台设置" }) : word),
                status: h("button", { type: "button", className: "ap-kind-jump", "aria-label": "打开舞台设置", title: "打开舞台设置", onClick: () => void open() }, h(packUi.Glyph, { name: "chevRight" })) })),
            chosen.length ? h(packUi.HintLine, { text: "这一局另选了" + chosen.map(slot => slot.label).join("、"), action: "改为跟随全局", onAction: () => void followGlobal() }) : null,
            problemLine(problem || writeProblem));
    }

    // How many choices a round offers (a script card brings its own).
    function SessionCandidateCount({ sessionId, config }) {
        const mode = useTavernSessionMode(sessionId);
        const [problem, write] = useSectionWriter(config);
        if (mode === "script") return null;
        const data = config.data;
        return h(InlineField, { kind: "menu", label: "候选项数量", value: data?.candidateTabs === true ? "expanded" : "compact", disabled: !data || config.busy, error: problem,
            help: help("候选项数量", "少量候选提供 4 条行动和 1 条场景切换。大量候选按角色和全局事件分组，并提供精选。"),
            placeholder: data ? undefined : "正在读取…",
            options: [{ value: "compact", label: "少量候选" }, { value: "expanded", label: "大量候选" }],
            onCommit: value => write({ candidateTabs: value === "expanded" }, { candidateTabs: value === "expanded" }) });
    }

    // ---------- 功能 ----------
    const FEATURES = [
        ["posture", "人物姿势", "每轮总结人物的位置、动作和姿势，供前台保持一致。"],
        ["styleReference", "文风联想", "仅自由模式。前台写正文前，结合本轮场景联想一段笔调参考；与写作共享上下文，不另开后台任务。"],
        ["foregroundCandidates", "前台生成候选项", "仅自由模式。让主模型在正文结尾后直接生成本轮候选项，写完即显示，不等待后台任务。"],
        ["preset", "后台任务附加预设", "开启后，全部后台 Agent 任务（结算、候选、精修、导演等）生成时也附加本局的三段预设提示词，不执行预设正则。"]
    ];
    function SessionFeatureSection({ config }) {
        const [problem, write] = useSectionWriter(config);
        const data = config.data, tasks = data?.backgroundTasks || {}, disabled = !data || config.busy;
        const task = (key, checked) => write({ backgroundTasks: { [key]: checked } }, { backgroundTasks: { ...tasks, [key]: checked } });
        return h(packUi.StageSection, { title: "功能", foldKey: FOLD("功能") },
            !data && !config.error ? h(PanelLoading, { shape: "fields", count: 5 }) : null,
            data ? rows(
                ...FEATURES.map(([key, label, text]) => h(packUi.SwitchRow, { key, label, help: text, disabled,
                    checked: tasks[key] === true, onChange: checked => void task(key, checked) })),
                h(packUi.SwitchRow, { key: "webSearch", label: "联网搜索", help: "前台和后台可按需搜索。", disabled, checked: data.webSearchEnabled === true,
                    onChange: checked => void write({ webSearchEnabled: checked }, { webSearchEnabled: checked }) })) : null,
            problemLine(problem));
    }

    // ---------- the options plugins add to this game (tavern.gameSettings), one section per plugin ----------
    // Plugins themselves are switched on and off globally, on the 酒馆插件 page.
    function SessionPluginSettings({ sessionId }) {
        const settings = useSessionSettings(sessionId, { readMethod: "listGamePlugins", writeMethod: "setGamePlugin", signalId: sessionId, signalKinds: ["plugin-settings"] });
        const [problem, write] = useSectionWriter(settings);
        const entries = settings.data?.plugins?.settings || [];
        return h(React.Fragment, null,
            entries.map(entry => h(packUi.StageSection, { key: entry.plugin, title: entry.title, foldKey: FOLD("插件 " + entry.plugin), className: "dsh-tavern-plugin-settings" },
                rows(...entry.fields.map(field => h(SessionPluginField, { key: field.key, field, value: entry.values[field.key], busy: settings.busy,
                    onChange: value => void write({ setting: { plugin: entry.plugin, key: field.key, value } }) }))))),
            problemLine(problem || (settings.error ? "读取插件配置失败：" + settings.error : ""), settings.error ? settings.load : null));
    }
    // One option a plugin added, drawn like Tavern's own; a plugin's description is the 「?」.
    function SessionPluginField({ field, value, busy, onChange }) {
        if (field.type === "boolean") return h(packUi.SwitchRow, { label: field.label, help: field.description || undefined, checked: value === true, disabled: busy, onChange });
        const tip = field.description ? help(field.label, field.description) : null;
        if (field.type === "select") return h(InlineField, { kind: "menu", label: field.label, help: tip, value, disabled: busy,
            options: field.options.map(option => ({ value: option.value, label: option.label })), onCommit: onChange });
        // Numbers and text are saved when the field loses focus or on Enter; an empty number keeps the saved value.
        const number = field.type === "number";
        return h(InlineField, { kind: number ? "number" : "text", label: field.label, help: tip, value: value ?? "", disabled: busy,
            min: field.min, max: field.max, step: field.step, maxLength: field.maxLength, validate: number ? next => next === null ? "请输入数字" : "" : undefined,
            onCommit: next => { if (next !== value) onChange(next); } });
    }

    // ---------- 前台工具: one switch per tool, stored as the disabled names so a newly added tool starts enabled ----------
    // Background settlement keeps its own tools and is not part of this list.
    function SessionToolsSection({ config }) {
        const [problem, write] = useSectionWriter(config);
        const data = config.data, catalog = data?.foregroundTools || [], disabled = data?.disabledForegroundTools || [];
        const off = !data || config.busy, names = catalog.map(tool => tool.name);
        async function save(next) {
            if (await write({ disabledForegroundTools: next }, { disabledForegroundTools: next })) notifyTavernDataChanged(["sessions"], "play-controls");
        }
        const toggle = (name, enabled) => void save(enabled ? disabled.filter(value => value !== name) : [...new Set([...disabled, name])]);
        const on = names.filter(name => !disabled.includes(name)).length;
        const menu = h(packUi.Popover, { label: "前台工具", trigger: ({ open, toggle: flip }) => h(packUi.IconButton, { icon: "more", label: "前台工具操作", "aria-haspopup": "menu", "aria-expanded": open, onClick: flip }),
            content: close => [
                h(packUi.MenuItem, { key: "on", disabled: off || disabled.length === 0, onClick: () => { close(); void save([]); } }, "全部开启"),
                h(packUi.MenuItem, { key: "off", disabled: off || on === 0, onClick: () => { close(); void save(names); } }, "全部关闭"),
                h(packUi.MenuItem, { key: "reload", disabled: config.busy, onClick: () => { close(); void config.load(); } }, "刷新")] });
        return h(packUi.StageSection, { title: "前台工具", meta: data ? on + " / " + names.length : undefined, foldKey: FOLD("前台工具"), defaultFolded: true, action: menu,
                help: "逐项决定正文能用哪些工具，关闭后下一轮生效；后台结算的工具不在这里。标「插件」的来自宿主工具目录，本局生成一次后会按实际请求校正。" },
            !data && !config.error ? h(PanelLoading, { shape: "fields", count: 4 }) : null,
            data && !catalog.length ? h(EmptyState, { compact: true, noun: "前台工具" }) : null,
            catalog.length ? rows(...catalog.map(tool => h(packUi.SwitchRow, { key: tool.name, label: tool.label, help: tool.description || undefined, disabled: off,
                status: tool.source === "plugin" ? h("span", { className: "ap-section-meta dsh-session-tool-source" }, "插件") : null,
                checked: !disabled.includes(tool.name), onChange: checked => toggle(tool.name, checked) }))) : null,
            problemLine(problem));
    }

    // ---------- 写作 Skill ----------
    function SessionWritingSkills({ sessionId }) {
        const [skills, setSkills] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
        const load = React.useCallback(async () => {
            try { setSkills((await rpc("getConversationWritingSkills", { sessionId }, sessionId)).skills); setError(""); }
            catch (err) { setError("读取失败：" + errorText(err)); }
        }, [sessionId]);
        React.useEffect(() => { void load(); }, [load]);
        async function change(name, enabled) {
            if (busy) return;
            setBusy(true); setError("");
            try {
                await trackTavernSettingsWrite(sessionId, rpc("setConversationWritingSkill", { sessionId, name, enabled }, sessionId));
                setSkills(current => current.map(skill => skill.name === name ? { ...skill, enabled } : skill));
            } catch (err) { setError("保存失败：" + errorText(err)); }
            finally { setBusy(false); }
        }
        const meta = skills && skills.length ? skills.filter(skill => skill.enabled).length + " / " + skills.length : undefined;
        return h(packUi.StageSection, { title: "写作 Skill", meta, foldKey: FOLD("写作 Skill"), defaultFolded: true,
                help: "开局沿用全局默认，可以逐项调整这一局，前台按场景选用。开关从后续请求生效，已发出的请求不受影响；关闭后历史内容保留。" },
            !skills && !error ? h(PanelLoading, { shape: "fields", count: 3 }) : null,
            skills && !skills.length ? h(EmptyState, { compact: true, noun: "写作 Skill" }) : null,
            skills && skills.length ? rows(...skills.map(skill => h(packUi.SwitchRow, { key: skill.name, label: skill.name, help: skill.description || undefined,
                checked: skill.enabled, disabled: busy, onChange: enabled => void change(skill.name, enabled) }))) : null,
            problemLine(error, error.startsWith("读取") ? load : null));
    }

    // The sections that share the background config: keyed by the page so 恢复默认模板 reads them again.
    function SessionConfigSections({ sessionId }) {
        const config = useSessionConfig(sessionId);
        const stage = useLiveTavernView(sessionId, undefined, [["stage"]])?.view?.stage;
        return h(React.Fragment, null,
            h(packUi.StageSection, { title: "玩法", foldKey: FOLD("玩法") },
                rows(
                    h(SessionPlayerName, { sessionId }),
                    h(SessionPreset, { sessionId }),
                    h(UserPreferenceProfileTab, { scope: { sessionId }, conversationOnly: true, Field: InlineField,
                        track: promise => trackTavernSettingsWrite(sessionId, promise) }),
                    h(SessionCandidateCount, { sessionId, config }))),
            stage ? h(SessionStageSection, { sessionId, config, stage }) : null,
            h(SessionModelSection, { sessionId, config }),
            h(SessionFeatureSection, { config }),
            h(SessionPluginSettings, { sessionId }),
            h(SessionToolsSection, { config }),
            h(SessionWritingSkills, { sessionId }));
    }

    function TavernConversationSettingsTab(props) {
        const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
        const mode = useTavernSessionMode(owner);
        const playable = isPlayMode(mode);
        const saveState = useSaveState(owner);
        const [templateAction, setTemplateAction] = React.useState("");
        const [templateNotice, setTemplateNotice] = React.useState("");
        const [templateError, setTemplateError] = React.useState("");
        const [reloadKey, setReloadKey] = React.useState(0);
        React.useEffect(() => {
            setTemplateAction("");
            setTemplateNotice("");
            setTemplateError("");
        }, [owner]);
        const warningsOf = result => Array.isArray(result?.warnings) && result.warnings.length ? "（" + result.warnings.join("；") + "）" : "";
        async function saveAsDefaultTemplate() {
            if (templateAction || !playable) return;
            setTemplateAction("save"); setTemplateNotice(""); setTemplateError("");
            try {
                await flushTavernSettingsWrites(owner);
                const result = await rpc("saveConversationSettingsAsDefaultTemplate", { sessionId: owner }, owner);
                setTemplateNotice("已保存目前设置为默认模板" + warningsOf(result));
                if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
                notifyTavernDataChanged(["presets", "user-profile", "sessions"], "conversation-settings");
            } catch (err) { setTemplateError(errorText(err)); }
            finally { setTemplateAction(""); }
        }
        async function restoreDefaultTemplate() {
            if (templateAction || !playable) return;
            setTemplateAction("restore"); setTemplateNotice(""); setTemplateError("");
            try {
                await flushTavernSettingsWrites(owner);
                const result = await rpc("restoreConversationSettingsFromDefaultTemplate", { sessionId: owner }, owner);
                tavernSettingsSessionReads.delete(owner);
                setReloadKey(value => value + 1);
                invalidateView(owner);
                notifyTavernDataChanged(["presets", "user-profile", "sessions"], "conversation-settings");
                setTemplateNotice("已恢复默认模板" + warningsOf(result));
            } catch (err) { setTemplateError(errorText(err)); }
            finally { setTemplateAction(""); }
        }
        const page = children => h("div", { className: "fork-tab-scroll" }, h("div", { className: "ap-ui ap-stage dsh-session-settings", role: "region", "aria-label": "本局设置" }, children));
        if (!playable) return page(h(EmptyState, { text: "请选择一个游玩对话" }));
        const scopeKey = owner + (reloadKey ? ":r" + reloadKey : "");
        const template = h(packUi.Popover, { label: "模板", className: "dsh-session-template",
            trigger: ({ open, toggle }) => h(packUi.Button, { className: "dsh-session-template-trigger", "aria-haspopup": "menu", "aria-expanded": open, disabled: Boolean(templateAction), onClick: toggle },
                templateAction === "save" ? "保存中…" : templateAction === "restore" ? "恢复中…" : "模板", h(packUi.Glyph, { name: "chevDown" })),
            content: close => [
                h(packUi.MenuItem, { key: "save", onClick: () => { close(); void saveAsDefaultTemplate(); } }, "保存目前设置为默认模板"),
                h(packUi.MenuItem, { key: "restore", onClick: () => { close(); void restoreDefaultTemplate(); } }, "恢复默认模板")] });
        return page(h(React.Fragment, null,
            h("div", { className: "dsh-session-bar" },
                h("span", { className: "dsh-session-scope" }, "只影响这一局，改动自动保存",
                    help("本局设置", "已有对话和变量都会保留。切换预设、长期偏好、模型、结算或联网搜索后，下一次请求要重建缓存，耗时和费用会增加。")),
                h("span", { className: "ap-save-state", role: "status", "data-state": saveState }, saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已保存" : ""),
                template),
            templateError ? problemLine("操作失败：" + templateError)
                : templateNotice ? h("p", { role: "status", className: "ap-notice dsh-session-notice" }, templateNotice) : null,
            h(SessionConfigSections, { key: scopeKey, sessionId: owner })));
    }

    function TavernConversationSettingsAction(props) {
        const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
        const mode = useTavernSessionMode(owner);
        if (!isPlayMode(mode)) return null;
        return h("button", { type: "button", className: "dsh-tavern-btn dsh-tavern-header-settings", "aria-label": "酒馆状态", title: "查看本局酒馆状态", onClick: () => props.open(owner) },
            h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", "aria-hidden": "true" },
                h("path", { d: "M4 7h3m4 0h9M4 17h9m4 0h3" }),
                h("circle", { cx: 9, cy: 7, r: 2 }), h("circle", { cx: 15, cy: 17, r: 2 })),
            h("span", { className: "dsh-tavern-header-action-label" }, "酒馆状态"));
    }

    return { TavernConversationSettingsTab, TavernConversationSettingsAction };
}
