// Settings owns its initial snapshot; each editor saves only its own resource.
function createGlobalSettingsModule({ React, rpc, notifySettingsChanged, TavernDefaultModelSetting, TavernModelSlotGroups, TavernConversationWritingSkills, DisplayPreferencesSettings, CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, HeaderItemsSettings, TavernUserPluginsSettings, DebugSetting, SpineRuntimeEntry, ForkModManagerEntry, TavernSettingRow, InlineField, Switch, HelpTip }) {
    // explanations live in a 「?」 beside the name (ui-design R3), never as grey lines.
    const help = (label, text) => HelpTip && text ? React.createElement(HelpTip, { label: label + "说明" }, text) : null;
    // the one place that brings back every confirmation hidden with 「以后不再显示」 (confirm-dialog.js hiddenConfirms).
    function HiddenConfirmsSetting() {
        const h = React.createElement;
        const hidden = React.useSyncExternalStore(hiddenConfirms.subscribe, hiddenConfirms.snapshot, hiddenConfirms.snapshot) !== "[]";
        const [notice, setNotice] = React.useState("");
        return h(TavernSettingRow, { title: "恢复所有已隐藏的确认", help: "在删除等确认框里勾过「以后不再显示」的那几类操作会直接执行；恢复后它们重新先问一次。", note: notice },
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: !hidden, onClick: () => { hiddenConfirms.restoreAll(); setNotice("已恢复"); } }, "恢复"));
    }
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
                if (patch && Object.hasOwn(patch, "statusBarPlacement")) notifySettingsChanged();
                setMessage("已保存");
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
        function menu(title, value, options, commit) {
            return h(TavernSettingRow, { title },
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
                toggle("foregroundCandidates", "前台生成候选项", "仅自由模式。让主模型在正文结尾后直接生成本轮候选项，写完即显示，不等待后台任务。", true),
                toggle("preset", "后台任务附加预设", "默认关闭。开启后，新游戏的全部后台 Agent 任务在生成时也会附加当前对局的三段预设提示词，不执行预设正则。", true),
                toggle("webSearchEnabled", "联网搜索", "允许新游戏的前台和后台按需搜索。")),
            message ? h("p", { role: "status", className: "dsh-tavern-gs-notice" }, message) : null);
    }

    function TavernSettingsSection({ renderSlot }) {
        const [state, setState] = React.useState({ loading: true, busy: false, defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null, defaultCompactionModel: null, notice: "", settings: null, modelCatalog: [], modModelSlots: [], error: "" });
        React.useEffect(function () {
            let active = true;
            rpc("getTavernSettings").then(function (result) {
                if (active) setState({ loading: false, busy: false, defaultForegroundModel: result.settings?.defaultForegroundModel || null, defaultBackgroundModel: result.settings?.defaultBackgroundModel || null, defaultWorkbenchModel: result.settings?.defaultWorkbenchModel || null, defaultCompactionModel: result.settings?.defaultCompactionModel || null, notice: "", bodyGenerationProviders: result.bodyGenerationProviders || [], settings: result.settings, modModelSlots: result.modModelSlots || [], scoringCatalog: result.scoringCatalog || [], modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], error: "" });
            }, function (error) {
                if (active) setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); });
            });
            return function () { active = false; };
        }, []);
        React.useEffect(() => {
            let active=true;
            const refresh=()=>rpc('getTavernSettings').then(result=>{if(active)setState(current=>({...current,modModelSlots:result.modModelSlots || [],settings:result.settings,bodyGenerationProviders:result.bodyGenerationProviders || []}));},error=>{if(active)setState(current=>({...current,error:String(error.message || error)}));});
            window.addEventListener('dsh-tavern-mods-changed',refresh);
            return ()=>{active=false;window.removeEventListener('dsh-tavern-mods-changed',refresh);};
        },[]);
        async function saveDefault(name, selection) {
            if (state.loading || state.busy) return;
            setState(current => ({ ...current, busy: true, error: "", notice: "" }));
            try {
                const result = await rpc("updateTavernSettings", { patch: { [name]: selection } });
                notifySettingsChanged();
                setState(current => ({ ...current, [name]: result.settings[name], settings: result.settings, busy: false, notice: "已保存" }));
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
            React.createElement(TavernDefaultModelSetting, { label: "前台对话压缩模型", title: "压缩模型", description: "用于整理较早的前台对话内容（手动 /compact 与自动压缩）；设为「跟随前台」时使用当前对话的前台模型", fallback: "跟随前台", selection: state.defaultCompactionModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultCompactionModel", selection) }),
            null),
                // the core's own slots; the stage's and its mods' (手机 · 通话模型) are on 设置 › 舞台 › 舞台模型.
                h(TavernModelSlotGroups,{slots:state.modModelSlots.filter(slot=>slot.owner === 'core'),values:state.settings?.modModels,catalog:state.modelCatalog,scoringCatalog:state.scoringCatalog,disabled:state.loading || state.busy,onChange:saveSlot})),
            group("开局默认", "开局时继承，开局后可在本局设置中单独修改。",
                state.settings ? h(GlobalPlayDefaults, { settings: state.settings }) : null,
                h(TavernConversationWritingSkills, { globalDefaults: true })),
            group("剧情", "所有游戏都按这些设置，下一轮生效。",
                card(
                    h(TavernSettingRow, { title: "正文生成插件", help: "先选择插件，再启用插件生成。插件需已加载并完成自身配置。" },
                        h(InlineField, { kind: "menu", label: "正文生成插件", hideLabel: true, disabled: state.loading || state.busy,
                            value: state.settings?.storyGenerationProvider || "", options: [{ value: "", label: "未选择" },
                                ...(state.settings?.storyGenerationProvider && !(state.bodyGenerationProviders || []).some(item => item.id === state.settings.storyGenerationProvider)
                                    ? [{ value: state.settings.storyGenerationProvider, label: "已选插件不可用" }] : []),
                                ...(state.bodyGenerationProviders || []).map(item => ({ value: item.id, label: item.title + "（" + item.owner + "）" }))],
                            onCommit: value => saveDefault("storyGenerationProvider", value) })),
                    h(TavernSettingRow, { title: "正文生成方式", help: "直接生成由插件组织上下文并请求正文；检索模式先由前台收集资料。正文完成后一次性显示。本局设置可覆盖此选择。" },
                        h(InlineField, { kind: "menu", label: "正文生成方式", hideLabel: true, disabled: state.loading || state.busy,
                            value: state.settings?.storyGenerationMode || "host", options: [{ value: "host", label: "宿主生成" }, { value: "plugin-direct", label: "插件直接生成" }, { value: "plugin-tool-call", label: "前台检索后由插件生成" }],
                            onCommit: value => saveDefault("storyGenerationMode", value) })),
                    sw("storyPluginOutputRegex", "插件生成正文后仍应用宿主正则", "插件处理完成后，继续应用全局、预设和人物卡正则。若两边配置相同规则，可能先后执行。", false),
                    sw("candidateAutoGenerate", "自动生成候选项", "正文写完后自动生成候选项；关闭后仍可手动生成。只对之后的新回复生效。", false))),
            // one card per group; each entry (incl. the UI plugin's 界面大小 slot) is a row of it.
            group("显示与交互", "",
                card(sw("autoOpenStatusPanel", "进入游戏时打开酒馆状态", "进入或切换到一局游戏时，右侧面板自动展开并显示本局设置和酒馆状态。关闭后右侧面板保持你上次的样子。", true),
                    h(DisplayPreferencesSettings),
                    renderSlot("settings.tavern.appearance", {}),
                    DebugSetting ? h(DebugSetting) : null,
                    h(CandidatePreferencesSettings), h(HiddenConfirmsSetting), h(HeaderItemsSettings))),
            // the anti-truncation block: the tool-call plumbing that keeps long outputs from being
            // cut mid-body on channels that support tool calls (Gemini especially), grouped out of 高级.
            group("防截断", "本区域可以帮助支持工具调用的渠道改善 Gemini 模型输出截断问题。",
                card(sw("retryOnFailure", "请求失败自动重试", "模型请求因网络中断、服务端错误或限流失败时，自动再发一次（一轮最多两次请求）。关闭后失败即停在这一步，等你手动重发；DSH 自身的重试也不会介入。下一轮生效。", true),
                    sw("storyInputToolCall", "输入走工具调用", "把发给模型的历史以工具记录形式回放，而不是普通对话文字；可降低续写被退回概率。只影响请求，存档和界面保持不变。需要模型支持工具调用。", false),
                    sw("storyOutputToolCall", "输出走工具调用", "仅用于宿主生成方式。通过协议级 tool_choice 强制模型调用 submit_story 提交本轮正文，并在 Gemini 渠道自动维护 thoughtSignature 签名链。需要模型支持工具调用。", false),
                    sw("storyToolThinking", "工具内思考槽", "开启「输出走工具调用」时，在 submit_story 参数首位增加必填 think 思考字段并锁定生成顺序（先构思再写正文），结算后自动归入思维链折叠行。遇到强制工具与原生思考互斥的渠道时也会自动启用。", false),
                    h(TavernSettingRow, { title: "工具回放结构", help: "开启「输入走工具调用」时生效。双端转调用把历史玩家消息与正文都作为 submit_story 参数；仅正文保留玩家消息为 user；全信封模式将系统设定下沉进只读上下文工具回执，并把玩家输入装入上一轮工具返回 JSON。" },
                        h(InlineField, { kind: "menu", label: "工具回放结构", hideLabel: true, disabled: state.loading || state.busy,
                            value: state.settings?.storyToolHistoryMode || "story",
                            options: [
                                { value: "story", label: "双端转调用（默认）" },
                                { value: "bodies", label: "仅历史正文转调用" },
                                { value: "envelope", label: "全信封模式（设定+输入全入工具）" }
                            ],
                            onCommit: value => saveDefault("storyToolHistoryMode", value) })))),
            group("高级", "",
                card(sw("reasoningStreamOnly", "流式显示思维链", "思考内容在生成过程中自动铺开，本次思考写完立即收起；不改变宿主「工作步骤展示」的档位。关闭后宿主怎么显示就怎么显示。", true),
                    sw("longPressSendRegenerate", "长按 1 秒发送键重新生成", "按住输入框右侧的发送键 1 秒，直接重新生成本轮正文，不打开「重新生成正文」的意见面板；触发前松开或移开即取消。默认关闭。", false),
                    sw("recentReplyFirst", "对话按最新回复排序", "关闭时左侧对话按创建时间固定排列（默认），打开或继续一个对话都不改变它的位置。打开后改成最近回复优先：只有生成出新回复的对话才会排到最前，单纯切换/打开对话不会把它顶上去，一行右侧的时间也换成最近回复时间。只改变列表顺序，不改动存档。", false),
                    h(TavernSettingRow, { title: "候选项数量", help: "少量候选生成 4 条行动和 1 条场景切换，直接平铺。大量候选按角色和全局事件分组，另生成精选组合。下次生成或重新生成候选项时生效。剧本模式仍生成 1 条。" },
                        h(InlineField, { kind: "menu", label: "候选项数量", hideLabel: true, disabled: state.loading || state.busy,
                            value: state.settings?.candidateTabs === true ? "expanded" : "compact",
                            options: [{ value: "compact", label: "少量候选" }, { value: "expanded", label: "大量候选" }],
                            onCommit: value => saveDefault("candidateTabs", value === "expanded") })),
                    h(PromptTemplateSettingsEntry),
                    h(ContextCompactionSettings)))
        );
    }

    function SettingsGroup({title, children}) {
        const h = React.createElement;
        return h("section", {className:"dsh-tavern-gs-group", "aria-label":title},
            h("header", {className:"dsh-tavern-gs-head"}, h("h2", null, title)),
            h("div", {className:"dsh-tavern-gs-card"}, children));
    }
    function TavernPluginsSettingsSection() {
        const h = React.createElement;
        return h("div", {className:"dsh-tavern-settings-section dsh-tavern-global-settings"},
            h(SettingsGroup, {title:"酒馆插件"},
                h("p", null, "插件获取：前往 ",
                    h("a", { href: "https://discord.gg/hYAEjKnpra", target: "_blank", rel: "noopener noreferrer" }, "Discord 交流群"),
                    "的插件分享，查找社区作者发布的插件及使用说明。"),
                h("p", null, "给酒馆加功能：粘贴插件作者的 GitHub 地址，或上传 ZIP 安装包。不支持 SillyTavern 插件。"),
                h(TavernUserPluginsSettings)));
    }
    // 设置 › 舞台 is the stage package's page (global-settings.js in dsh-tavern-stage, stageViews.GlobalSettings): opening it holds the
    // stage client (stage-client-loader.cjs hold) so the page loads for any card; the core only draws the wait. The names the
    // page needs from the core travel as the stage view options (gal-stage.js bindStageViews, globalSettings);
    const stageGlobalSettingsOptions = {rpc, notifySettingsChanged, TavernModelSlotGroups, SettingsGroup, SpineRuntimeEntry, ForkModManagerEntry};
    function TavernStageSettingsSection() {
        const h = React.createElement;
        React.useEffect(() => galStageHold(), []);
        const enabled = React.useSyncExternalStore(galStageAvailable.subscribe, galStageAvailable.get);
        const [runtime, setRuntime] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
        React.useEffect(() => {
            let active = true, timer;
            async function refresh() {
                try {
                    const value = await rpc("getStageRuntimeStatus", {});
                    if (!active) return;
                    setRuntime(value);
                    if (["loading", "loaded"].includes(value.status)) timer = setTimeout(refresh, 500);
                } catch (err) { if (active) setError(err.message); }
            }
            if (!busy) void refresh();
            return () => { active = false; clearTimeout(timer); };
        }, [enabled, busy]);
        async function set(method, value) {
            setBusy(true); setError("");
            try { setRuntime(await rpc(method, {enabled:value})); }
            catch (err) { setError(err.message); }
            finally { setBusy(false); }
        }
        const Page = enabled && stageViews ? stageViews.GlobalSettings : null;
        return h(React.Fragment, null,
            h("div", {className:"dsh-tavern-settings-section dsh-tavern-global-settings"},
                h(SettingsGroup, {title:"舞台启动"},
                    runtime?.installed ? h(TavernSettingRow, {title:"启动时加载舞台", help:"关闭后，下次启动会跳过舞台。需要时可以在这里为本次运行加载舞台。"},
                        h(Switch, {label:"启动时加载舞台", checked:runtime.loadOnStartup !== false, disabled:busy, onChange:value => set("setStageLoadOnStartup", value)})) : null,
                    !Page && runtime?.installed && (!runtime.enabled || runtime.status === "failed") ?
                        h("button", {type:"button", className:"dsh-tavern-btn", disabled:busy, onClick:() => set("setStageEnabled", true)}, "本次加载舞台") : null,
                    !Page && (!runtime || runtime.installed && runtime.enabled && runtime.status !== "failed") ?
                        h("p", {className:"dsh-tavern-settings-desc", role:"status"}, "正在加载舞台…") : null,
                    runtime?.installed === false ? h("p", {role:"status"}, "舞台插件不可用") : null,
                    error ? h("p", {role:"alert"}, error) : null)),
            Page ? h(Page) : null);
    }
    return { TavernSettingsSection, TavernPluginsSettingsSection, TavernStageSettingsSection, stageGlobalSettingsOptions };
}
