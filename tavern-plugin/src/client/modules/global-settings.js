// Settings owns its initial snapshot; each editor saves only its own resource.
function createGlobalSettingsModule({ React, rpc, notifySettingsChanged, TavernDefaultModelSetting, TavernConversationWritingSkills, DisplayPreferencesSettings, HeaderItemsSettings, CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, TavernUserPluginsSettings }) {
    function GlobalPlayDefaults({ settings }) {
        const h = React.createElement;
        const [data, setData] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        React.useEffect(() => {
            let active = true;
            Promise.all([rpc("listPresets"), rpc("getUserPreferenceProfile", { globalDefaults: true })]).then(([presets, profile]) => {
                if (active) setData({ ...settings.defaultPlaySettings, presets: presets.presets || [], preset: presets.activePresetPath || "", profile: profile.userProfile });
            }, err => { if (active) setMessage("读取失败：" + err.message); });
            return () => { active = false; };
        }, []);
        async function save(patch, method, args) {
            setBusy(true); setMessage("");
            try {
                const result = await rpc(method || "updateTavernSettings", args || { patch: { defaultPlaySettings: patch } });
                if (method === "selectPreset") setData(current => ({ ...current, preset: args.path }));
                else if (method === "manageUserPreferenceProfile") {
                    const profile = await rpc("getUserPreferenceProfile", { globalDefaults: true });
                    setData(current => ({ ...current, profile: profile.userProfile }));
                } else setData(current => ({ ...current, ...result.settings.defaultPlaySettings }));
                setMessage("已保存，新游戏继承此设置，已有游戏保持不变。");
            } catch (err) { setMessage("保存失败：" + err.message); }
            finally { setBusy(false); }
        }
        const disabled = !data || busy;
        function toggle(key, title, help, task) {
            return h("label", { key, className: "dsh-tavern-settings-row dsh-tavern-background-task" },
                h("span", { className: "dsh-tavern-settings-copy" }, h("strong", { className: "dsh-tavern-settings-title" }, title), h("span", { className: "dsh-tavern-settings-desc" }, help)),
                h("input", { type: "checkbox", role: "switch", "aria-label": title, disabled, checked: task ? data?.backgroundTasks[key] === true : data?.[key] === true, onChange: event => save(task ? { backgroundTasks: { [key]: event.target.checked } } : { [key]: event.target.checked }) }));
        }
        return h("div", { className: "dsh-tavern-settings-section dsh-local-settings dsh-tavern-global-defaults" },
            h("section", { className: "dsh-local-section" }, h("h3", null, "游玩"),
                h("label", { className: "dsh-local-field" }, "默认玩家称呼", h("input", { key: data?.playerName, defaultValue: data?.playerName || "", disabled, maxLength: 80, onBlur: event => { if (event.target.value !== data.playerName) save({ playerName: event.target.value }); } })),
                h("label", { className: "dsh-local-field" }, "默认状态栏位置", h("select", { disabled, value: data?.statusBarPlacement || "sidebar", onChange: event => save({ statusBarPlacement: event.target.value }) }, h("option", { value: "sidebar" }, "侧边栏"), h("option", { value: "body" }, "正文下方"))),
                h("label", { className: "dsh-local-field" }, "默认预设", h("select", { disabled, value: data?.preset || "", onChange: event => save(null, "selectPreset", { path: event.target.value }) }, h("option", { value: "" }, "不使用酒馆预设"), (data?.presets || []).filter(item => item.valid && item.recognized).map(item => h("option", { key: item.path, value: item.path }, item.title)))),
                h("label", { className: "dsh-local-field" }, "默认长期偏好", h("select", { disabled, value: data?.profile.defaultProfileId || "", onChange: event => save(null, "manageUserPreferenceProfile", { action: "default", profileId: event.target.value }) }, h("option", { value: "" }, "不启用"), (data?.profile.profiles || []).filter(item => item.hasConfirmed).map(item => h("option", { key: item.id, value: item.id }, item.name))))),
            // Same names and order as 功能 in 本局设置, where each game changes them later.
            h("section", { className: "dsh-local-section" }, h("h3", null, "功能"),
                toggle("variables", "变量结算", "MVU 卡建议开启；普通卡不执行此任务。", true), toggle("posture", "人物姿势", "总结本轮结束时人物的位置、动作和姿势。", true),
                toggle("styleReference", "文风联想", "仅自由模式。每轮后台凭记忆摘一段风格相近的小说原文，供下一轮正文借鉴笔调。多一次后台请求。", true),
                toggle("webSearchEnabled", "联网搜索", "允许新游戏的前台和后台按需搜索。")),
            message ? h("p", { role: "status" }, message) : null);
    }

    // Global switches: they apply to every game from its next turn, not per-game preferences.
    function SettingSwitch({ settings, name, title, description }) {
        const h = React.createElement;
        const [enabled, setEnabled] = React.useState(settings[name] === true), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        async function save(value) {
            setBusy(true); setMessage("");
            try {
                const result = await rpc("updateTavernSettings", { patch: { [name]: value } });
                setEnabled(result.settings[name] === true);
                notifySettingsChanged();
                setMessage("已保存，所有游戏下一轮生效");
            } catch (err) { setMessage("保存失败：" + String(err.message || err)); }
            finally { setBusy(false); }
        }
        return h("section", { className: "dsh-tavern-settings-group" },
            h("label", { className: "dsh-tavern-settings-row dsh-tavern-background-task" },
                h("span", { className: "dsh-tavern-settings-copy" },
                    h("strong", null, title),
                    h("p", { className: "dsh-tavern-settings-desc" }, description)),
                h("input", { type: "checkbox", role: "switch", "aria-label": title, checked: enabled, disabled: busy, onChange: event => save(event.target.checked) })),
            message ? h("div", { className: "dsh-tavern-settings-row", role: "status" }, h("span", { className: "dsh-tavern-settings-desc" }, message)) : null);
    }

    function TavernSettingsSection() {
        const [state, setState] = React.useState({ loading: true, busy: false, defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null, notice: "", settings: null, modelCatalog: [], error: "" });
        React.useEffect(function () {
            let active = true;
            rpc("getTavernSettings").then(function (result) {
                if (active) setState({ loading: false, busy: false, defaultForegroundModel: result.settings?.defaultForegroundModel || null, defaultBackgroundModel: result.settings?.defaultBackgroundModel || null, defaultWorkbenchModel: result.settings?.defaultWorkbenchModel || null, notice: "", settings: result.settings, modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], error: "" });
            }, function (error) {
                if (active) setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); });
            });
            return function () { active = false; };
        }, []);
        async function saveDefault(name, selection) {
            if (state.loading || state.busy) return;
            setState(current => ({ ...current, busy: true, error: "", notice: "" }));
            try {
                const result = await rpc("updateTavernSettings", { patch: { [name]: selection } });
                notifySettingsChanged();
                setState(current => ({ ...current, [name]: result.settings[name], busy: false, notice: name === "defaultWorkbenchModel" ? "已保存，下次新建工作台对话生效" : "已保存，下次新游戏生效" }));
            } catch (err) { setState(current => ({ ...current, busy: false, error: String(err.message || err) })); }
        }
        const h = React.createElement;
        function group(title, desc, ...children) {
            return h("section", { className: "dsh-tavern-gs-group", "aria-label": title },
                h("header", { className: "dsh-tavern-gs-head" }, h("h2", null, title), desc ? h("p", null, desc) : null),
                ...children);
        }
        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings" },
            h("p", { className: "dsh-tavern-gs-notice" }, "遇到问题或想交流玩法，欢迎加入 ",
                h("a", { href: "https://discord.gg/hYAEjKnpra", target: "_blank", rel: "noopener noreferrer" }, "Discord 交流群"),
                "。本项目没有官方的 QQ 群、微信群。"),
            group("默认模型", "用于新游戏和新的卡片工作台对话，已有对话保持当前配置。建议使用 High 推理强度；Max 容易过度思考、增加等待。",
            h("div", { className: "dsh-tavern-gs-card" },
            React.createElement(TavernDefaultModelSetting, { label: "默认前台模型", title: "前台模型", description: "写正文、扮演角色，直接决定剧情质量", fallback: "使用 DSH 默认模型", selection: state.defaultForegroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultForegroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "默认后台模型", title: "后台模型", description: "变量结算、世界书筛选、候选回复、手机消息等幕后任务", fallback: "跟随前台", selection: state.defaultBackgroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultBackgroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "卡片工作台默认模型", title: "工作台模型", description: "卡片工作台里创建和修改人物卡", fallback: "跟随前台", selection: state.defaultWorkbenchModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultWorkbenchModel", selection) })),
            state.notice ? h("p", { className: "dsh-tavern-gs-notice", role: "status" }, state.notice) : null),
            // Grouped by what a setting governs; each group's note says when it takes effect.
            group("开局默认", "新游戏开局时继承，开局后可在本局设置中单独修改；已有游戏不受影响。",
                state.settings ? h(GlobalPlayDefaults, { settings: state.settings }) : null,
                h(TavernConversationWritingSkills, { globalDefaults: true })),
            // 对话气泡 (castPresentation) lives in 舞台设置 › 基础设置 with the other stage switches.
            group("剧情", "所有游戏都按这些设置，下一轮生效。",
                h(ContextCompactionSettings)),
            group("显示与交互", "对所有游戏生效，只改界面，不影响正文和存档。",
                state.settings ? h(SettingSwitch, { settings: state.settings, name: "autoOpenStatusPanel", title: "进入游戏时打开酒馆状态",
                    description: "进入或切换到一局游戏时，右侧面板自动展开并显示本局设置和酒馆状态。关闭后右侧面板保持你上次的样子。" }) : null,
                h(DisplayPreferencesSettings),
                h(CandidatePreferencesSettings),
                // Most players never need this; it sits last, folded.
                h(HeaderItemsSettings)),
            group("高级", "",
                state.settings ? h(SettingSwitch, { settings: state.settings, name: "storyInputToolCall", title: "输入走工具调用",
                    description: "把发给模型的历史（此前的玩家消息和正文）以 submit_story 工具参数的形式回放，而不是普通对话文字；可降低续写被拒答。只影响请求，本轮输入、存档和界面保持不变。需要模型支持工具调用。" }) : null,
                state.settings ? h(SettingSwitch, { settings: state.settings, name: "storyOutputToolCall", title: "输出走工具调用",
                    description: "让模型通过 submit_story 提交本轮正文，可缓解 Gemini 等模型在正文中途截断或拒答。需要模型支持工具调用；正文生成完成后一次性显示。" }) : null,
                h(PromptTemplateSettingsEntry)),
            state.error ? React.createElement("div", { className: "dsh-tavern-settings-error", role: "alert" }, "保存失败：" + state.error) : null
        );
    }

    // Installing and updating plugins is management, not a setting: it gets its own page.
    function TavernPluginsSettingsSection() {
        const h = React.createElement;
        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings" },
            h("section", { className: "dsh-tavern-gs-group", "aria-label": "酒馆插件" },
                h("header", { className: "dsh-tavern-gs-head" }, h("h2", null, "酒馆插件"), h("p", null, "给酒馆加功能：粘贴插件作者的 GitHub 地址即可安装。")),
                h(TavernUserPluginsSettings)));
    }

    return { TavernSettingsSection, TavernPluginsSettingsSection };
}
