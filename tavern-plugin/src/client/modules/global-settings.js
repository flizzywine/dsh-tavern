// Settings owns its initial snapshot; each editor saves only its own resource.
function createGlobalSettingsModule({ React, rpc, notifySettingsChanged, TavernDefaultModelSetting, TavernModelSlotGroups, TavernConversationWritingSkills, DisplayPreferencesSettings, CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, HeaderItemsSettings, TavernUserPluginsSettings, DebugSetting, SpineRuntimeEntry, ForkModManagerEntry, TavernSettingRow, InlineField, Switch, HelpTip }) {
    // explanations live in a 「?」 beside the name (ui-design R3), never as grey lines.
    const help = (label, text) => HelpTip && text ? React.createElement(HelpTip, { label: label + "说明" }, text) : null;
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
                if (patch && Object.hasOwn(patch, "statusBarPlacement")) { notifySettingsChanged(); setMessage("已保存，所有对局使用此状态栏位置。"); }
                else setMessage("已保存，新游戏继承此设置，已有游戏保持不变。");
            } catch (err) { setMessage("保存失败：" + err.message); }
            finally { setBusy(false); }
        }
        const disabled = !data || busy;
        // the shared rows — name + 「?」 left, the inline control right; switches
        // and menus are the fork's one implementations (Switch / InlineField), no native select or checkbox.
        function toggle(key, title, text, task) {
            return h(TavernSettingRow, { key, title, help: text, className: "dsh-tavern-background-task" },
                h(Switch, { label: title, disabled, checked: task ? data?.backgroundTasks[key] === true : data?.[key] === true, onChange: checked => save(task ? { backgroundTasks: { [key]: checked } } : { [key]: checked }) }));
        }
        function menu(title, value, options, commit, text) {
            return h(TavernSettingRow, { title, help: text },
                h(InlineField, { kind: "menu", label: title, hideLabel: true, disabled, value, options, onCommit: commit }));
        }
        const loading = !data && !message;
        return h("div", { className: "dsh-tavern-settings-section dsh-local-settings dsh-tavern-global-defaults", "aria-busy": loading || undefined },
            h("section", { className: "dsh-local-section" }, h("h3", null, "基本信息"),
                h(TavernSettingRow, { title: "默认玩家称呼" },
                    h(InlineField, { kind: "text", label: "默认玩家称呼", hideLabel: true, disabled, maxLength: 80, value: data?.playerName || "", placeholder: "你", onCommit: value => save({ playerName: value }) })),
                menu("状态栏位置（所有对局）", data?.statusBarPlacement || "sidebar", [{ value: "sidebar", label: "侧边栏" }, { value: "body", label: "正文下方" }], value => save({ statusBarPlacement: value })),
                menu("默认预设", data?.preset || "", [{ value: "", label: "不使用酒馆预设" }].concat((data?.presets || []).filter(item => item.valid && item.recognized).map(item => ({ value: item.path, label: item.title }))),
                    value => save(null, "selectPreset", { path: value })),
                menu("默认长期偏好", data?.profile.defaultProfileId || "", [{ value: "", label: "不启用" }].concat((data?.profile.profiles || []).filter(item => item.hasConfirmed).map(item => ({ value: item.id, label: item.name }))),
                    value => save(null, "manageUserPreferenceProfile", { action: "default", profileId: value }))),
            h("section", { className: "dsh-local-section" }, h("h3", null, "功能"),
                toggle("posture", "人物姿势", "总结本轮结束时人物的位置、动作和姿势。", true),
                toggle("styleReference", "文风联想", "仅自由模式。前台写正文前，结合本轮场景联想一段笔调参考；与写作共享上下文，不另开后台任务。", true),
                toggle("webSearchEnabled", "联网搜索", "允许新游戏的前台和后台按需搜索。")),
            message ? h("p", { role: "status", className: "dsh-tavern-gs-notice" }, message) : null);
    }

    function TavernSettingsSection({ renderSlot }) {
        const [state, setState] = React.useState({ loading: true, busy: false, defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null, notice: "", settings: null, modelCatalog: [], modModelSlots: [], error: "" });
        React.useEffect(function () {
            let active = true;
            rpc("getTavernSettings").then(function (result) {
                if (active) setState({ loading: false, busy: false, defaultForegroundModel: result.settings?.defaultForegroundModel || null, defaultBackgroundModel: result.settings?.defaultBackgroundModel || null, defaultWorkbenchModel: result.settings?.defaultWorkbenchModel || null, notice: "", settings: result.settings, modModelSlots: result.modModelSlots || [], scoringCatalog: result.scoringCatalog || [], modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], error: "" });
            }, function (error) {
                if (active) setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); });
            });
            return function () { active = false; };
        }, []);
        React.useEffect(() => {
            let active=true;
            const refresh=()=>rpc('getTavernSettings').then(result=>{if(active)setState(current=>({...current,modModelSlots:result.modModelSlots || [],settings:result.settings}));},error=>{if(active)setState(current=>({...current,error:String(error.message || error)}));});
            window.addEventListener('dsh-tavern-mods-changed',refresh);
            return ()=>{active=false;window.removeEventListener('dsh-tavern-mods-changed',refresh);};
        },[]);
        async function saveDefault(name, selection) {
            if (state.loading || state.busy) return;
            setState(current => ({ ...current, busy: true, error: "", notice: "" }));
            try {
                const result = await rpc("updateTavernSettings", { patch: { [name]: selection } });
                notifySettingsChanged();
                setState(current => ({ ...current, [name]: result.settings[name], busy: false, notice: "已保存" }));
            } catch (err) { setState(current => ({ ...current, busy: false, error: String(err.message || err) })); }
        }
        async function saveSlot(modModelSelection) {
            setState(current=>({...current,busy:true,error:"",notice:""}));
            try { const result = await rpc("updateTavernSettings", {patch:{modModelSelection}}); notifySettingsChanged(); setState(current=>({...current,settings:result.settings,busy:false,notice:"已保存"})); }
            catch(error) { setState(current=>({...current,busy:false,error:String(error.message || error)})); }
        }
        const h = React.createElement;
        // a group is its heading (+ 「?」, a save state on the right) over one card
        // of rows; the heading's explanation never prints as a grey paragraph.
        // `head` is the 「?」 text, or { help, status } with a short state at the heading's right end.
        function group(title, head, ...children) {
            const desc = typeof head === "string" ? head : head && head.help, status = head && typeof head === "object" ? head.status : null;
            return h("section", { className: "dsh-tavern-gs-group", "aria-label": title },
                h("header", { className: "dsh-tavern-gs-head" }, h("h2", null, title), help(title, desc), status || null),
                ...children);
        }
        const card = (...rows) => h("div", { className: "dsh-tavern-gs-card" }, ...rows);
        // a switch row of the page (Switch, explanation in the 「?」); `on` is the shipped default.
        const sw = (name, title, text, on) => h(TavernSettingRow, { key: name, title, help: text },
            h(Switch, { label: title, disabled: state.loading || state.busy, checked: on ? (state[name] ?? state.settings?.[name]) !== false : (state[name] ?? state.settings?.[name]) === true, onChange: value => saveDefault(name, value) }));
        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings", "aria-busy": state.loading || undefined },
            group("默认模型", { help: "用于新游戏和新的卡片工作台对话，已有对话保持当前配置。建议使用 High 推理强度；Max 容易过度思考、增加等待。",
                status: state.error ? h("span", { className: "dsh-tavern-gs-notice is-alert", role: "alert" }, "⚠ 保存失败：" + state.error)
                    : state.notice ? h("span", { className: "dsh-tavern-gs-notice", role: "status" }, state.notice) : null },
            h("div", { className: "dsh-tavern-gs-card" },
            React.createElement(TavernDefaultModelSetting, { label: "默认前台模型", title: "前台模型", description: "写正文、扮演角色，直接决定剧情质量", fallback: "使用 DSH 默认模型", selection: state.defaultForegroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultForegroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "默认后台模型", title: "后台模型", description: "变量结算、世界书筛选、候选回复、手机消息等幕后任务", fallback: "跟随前台", selection: state.defaultBackgroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultBackgroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "卡片工作台默认模型", title: "工作台模型", description: "卡片工作台里创建和修改人物卡", fallback: "跟随前台", selection: state.defaultWorkbenchModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultWorkbenchModel", selection) }),
            null),
                h(TavernModelSlotGroups,{slots:state.modModelSlots,values:state.settings?.modModels,catalog:state.modelCatalog,scoringCatalog:state.scoringCatalog,disabled:state.loading || state.busy,onChange:saveSlot})),
            group("新游戏默认", "开局时继承，开局后可在本局设置中单独修改。",
                state.settings ? h(GlobalPlayDefaults, { settings: state.settings }) : null,
                h(TavernConversationWritingSkills, { globalDefaults: true })),
            // one card per group; each entry (incl. the UI plugin's 界面大小 slot) is a row of it.
            group("显示与交互", "",
                card(sw("autoOpenStatusPanel", "进入游戏时打开酒馆状态", "进入或切换到一局游戏时，右侧面板自动展开并显示本局设置和酒馆状态。关闭后右侧面板保持你上次的样子。", true),
                    h(DisplayPreferencesSettings),
                    renderSlot("settings.tavern.appearance", {}),
                    DebugSetting ? h(DebugSetting) : null,
                    h(CandidatePreferencesSettings))),
            group("插件", "给酒馆加功能：粘贴插件作者的 GitHub 地址即可安装。不支持 SillyTavern 插件，仅支持 DSH 插件和 DSH Tavern 插件。", card(h(TavernUserPluginsSettings))),
            // the optional runtimes, the same entries as the model previews: official page, then import.
            group("运行库", "", card(h("div", { className: "fork-runtime-list" }, SpineRuntimeEntry ? h(SpineRuntimeEntry, { request: rpc }) : null))),
            group("高级", "",
                card(sw("storyInputToolCall", "输入走工具调用", "把发给模型的历史（此前的玩家消息和正文）以 submit_story 工具参数的形式回放，而不是普通对话文字；可降低续写被拒答。只影响请求，本轮输入、存档和界面保持不变。需要模型支持工具调用。", false),
                    sw("storyOutputToolCall", "输出走工具调用", "让模型通过 submit_story 提交本轮正文，可缓解 Gemini 等模型在正文中途截断或拒答。需要模型支持工具调用；正文生成完成后一次性显示。", false),
                    h(PromptTemplateSettingsEntry),
                    // 模组管理 — install, uninstall, versions, dependencies.
                    ForkModManagerEntry ? h(ForkModManagerEntry) : null,
                    h(ContextCompactionSettings), h(HeaderItemsSettings)))
        );
    }

    return { TavernSettingsSection };
}
