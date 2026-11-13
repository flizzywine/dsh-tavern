// Settings owns its initial snapshot; each editor saves only its own resource.
function createGlobalSettingsModule({ React, rpc, notifySettingsChanged, TavernDefaultModelSetting, TavernModelSlotGroups, TavernConversationWritingSkills, DisplayPreferencesSettings, CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, HeaderItemsSettings, TavernUserPluginsSettings, DebugSetting, SpineRuntimeEntry, ForkModManagerEntry, StageGenerationSettings, TavernSettingRow, InlineField, Switch, HelpTip, VoiceCataloguePicker, voiceKey, voiceFromKey, useReadingBinding }) {
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
                toggle("foregroundCandidates", "前台生成候选项", "仅自由模式。让主模型在正文结尾后直接生成本轮候选项，写完即显示，不等待后台任务。", true),
                toggle("webSearchEnabled", "联网搜索", "允许新游戏的前台和后台按需搜索。")),
            message ? h("p", { role: "status", className: "dsh-tavern-gs-notice" }, message) : null);
    }

    function TavernSettingsSection({ renderSlot }) {
        const [state, setState] = React.useState({ loading: true, busy: false, defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null, notice: "", settings: null, modelCatalog: [], modModelSlots: [], error: "" });
        React.useEffect(function () {
            let active = true;
            rpc("getTavernSettings").then(function (result) {
                if (active) setState({ loading: false, busy: false, defaultForegroundModel: result.settings?.defaultForegroundModel || null, defaultBackgroundModel: result.settings?.defaultBackgroundModel || null, defaultWorkbenchModel: result.settings?.defaultWorkbenchModel || null, notice: "", bodyGenerationProviders: result.bodyGenerationProviders || [], settings: result.settings, modModelSlots: result.modModelSlots || [], scoringCatalog: result.scoringCatalog || [], modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], error: "" });
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
            null),
                h(TavernModelSlotGroups,{slots:state.modModelSlots.filter(slot=>slot.modId !== 'dsh.stage'),values:state.settings?.modModels,catalog:state.modelCatalog,scoringCatalog:state.scoringCatalog,disabled:state.loading || state.busy,onChange:saveSlot})),
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
                    h(CandidatePreferencesSettings), h(HeaderItemsSettings))),
            group("高级", "",
                card(sw("reasoningStreamOnly", "流式显示思维链", "思考内容在生成过程中自动铺开，本次思考写完立即收起；不改变宿主「工作步骤展示」的档位。关闭后宿主怎么显示就怎么显示。", true),
                    sw("retryOnFailure", "请求失败自动重试", "模型请求因网络中断、服务端错误或限流失败时，自动再发一次（一轮最多两次请求）。关闭后失败即停在这一步，等你手动重发；DSH 自身的重试也不会介入。下一轮生效。", true),
                    sw("storyInputToolCall", "输入走工具调用", "把发给模型的历史（此前的玩家消息和正文）以 submit_story 工具参数的形式回放，而不是普通对话文字；可降低续写被拒答。只影响请求，本轮输入、存档和界面保持不变。需要模型支持工具调用。", false),
                    sw("storyOutputToolCall", "输出走工具调用", "仅用于宿主生成方式。让模型通过 submit_story 提交本轮正文，可缓解 Gemini 等模型在正文中途截断或拒答。需要模型支持工具调用；正文生成完成后一次性显示。", false),
                    sw("longPressSendRegenerate", "长按 1 秒发送键重新生成", "按住输入框右侧的发送键 1 秒，直接重新生成本轮正文，不打开「重新生成正文」的意见面板；触发前松开或移开即取消。默认关闭。", false),
                    sw("recentReplyFirst", "对话按最新回复排序", "关闭时左侧对话按创建时间固定排列（默认），打开或继续一个对话都不改变它的位置。打开后改成最近回复优先：刚生成过新回复、或最近打开的对话排到最前，一行右侧的时间也换成最近活动时间。只改变列表顺序，不改动存档。", false),
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
    function ReadAloudSettings() {
        const h = React.createElement, binding = useReadingBinding();
        const [reading, setReading] = React.useState(null), [notice, setNotice] = React.useState(''), [busy, setBusy] = React.useState(false);
        React.useEffect(() => {
            let active = true;
            const refresh = () => binding.tts.call('reading').then(value => { if (active) setReading(value.readAloud); }, () => { if (active) setNotice('无法读取朗读设置'); });
            if (!binding.tts?.available()) { setReading(null); return; }
            void refresh();
            const off = binding.tts.subscribe(event => { if (event.type === 'readingChanged') void refresh(); });
            return () => { active = false; off(); };
        }, [binding]);
        async function save(patch) {
            setBusy(true); setNotice('');
            try { const value = await binding.tts.call('setReading', {readAloud:patch}); setReading(value.readAloud); }
            catch (_) { setNotice('保存失败，请重试'); }
            finally { setBusy(false); }
        }
        return h(SettingsGroup, {title:'朗读'},
            !binding.tts?.available() ? h('p', {role:'status'}, '配音服务未启用') : reading ? h(React.Fragment, null,
                h(TavernSettingRow, {title:'朗读声音'}, h(VoiceCataloguePicker, {binding, value:voiceKey(reading.voice), label:'朗读声音', leading:[{value:'',label:'浏览器 · 系统默认'}], onPick:key => save({voice:voiceFromKey(key)})})),
                h(TavernSettingRow, {title:'自动朗读',help:'每条新回复用朗读声音读一次；本卡舞台配音开启时让位于角色配音。'}, h(Switch, {label:'自动朗读',checked:reading.auto,disabled:busy,onChange:auto => save({auto})}))) : h('p', {role:'status'}, '正在读取…'),
            notice ? h('p', {role:'status'}, notice) : null);
    }
    function TavernPluginsSettingsSection() {
        const h = React.createElement;
        return h("div", {className:"dsh-tavern-settings-section dsh-tavern-global-settings"},
            h(SettingsGroup, {title:"酒馆插件"},
                h("p", null, "插件获取：前往 ",
                    h("a", { href: "https://discord.gg/hYAEjKnpra", target: "_blank", rel: "noopener noreferrer" }, "Discord 交流群"),
                    "的插件分享，查找社区作者发布的插件及使用说明。"),
                h("p", null, "给酒馆加功能：粘贴插件作者的 GitHub 地址，或上传 ZIP 安装包。不支持 SillyTavern 插件。"),
                h(TavernUserPluginsSettings)), h(ReadAloudSettings));
    }
    // 设置 › 舞台 is the stage package's page (global-settings.js in dsh-tavern-stage, stageViews.GlobalSettings): opening it holds the
    // stage client (stage-client-loader.cjs hold) so the page loads for any card; the core only draws the wait. The names the
    // page needs from the core travel as the stage view options (gal-stage.js bindStageViews, globalSettings);
    // TavernSettingRow and Switch draw the four-state 基础设置 switches.
    const stageGlobalSettingsOptions = {rpc, notifySettingsChanged, TavernModelSlotGroups, SettingsGroup, StageGenerationSettings, SpineRuntimeEntry, ForkModManagerEntry, TavernSettingRow, Switch};
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
    const DAMPER_PROVIDER_OPTIONS = [
        { value: "gemini", label: "Google Gemini Decisions", defaultModel: "gemini-decision-1", defaultKeyName: "GEMINI_API_KEY" },
        { value: "gemini-compatible", label: "Gemini Decisions 兼容接口", defaultModel: "gemini-decision-1", defaultKeyName: "GEMINI_API_KEY", customUrl: true },
        { value: "jev", label: "Typesafe JEV", defaultModel: "jev-1.13.0", defaultKeyName: "TYPESAFE_API_KEY" },
        { value: "openai", label: "OpenAI Decisions", defaultModel: "gpt-6-luna", defaultKeyName: "OPENAI_API_KEY" },
        { value: "openai-compatible", label: "OpenAI Decisions 兼容接口", defaultModel: "gpt-6-luna", defaultKeyName: "OPENAI_API_KEY", customUrl: true }
    ];
    const damperKeyValidate = value => /^[\x21-\x7e]{1,4096}$/.test(value) ? "" : "API Key 须为不含空格或中文的可见字符";

    function TavernNarrativeDamperSettingsSection() {
        const h = React.createElement;
        const [state, setState] = React.useState({ loading: true, busy: false, config: null, credential: null, editingKey: false, notice: "", error: "", test: null });
        const testSeq = React.useRef(0);

        React.useEffect(() => {
            let active = true;
            rpc("getNarrativeDamperSettings").then(result => {
                if (active) setState(current => ({ ...current, loading: false, config: result.config, credential: result.credential, error: "" }));
            }, err => {
                if (active) setState(current => ({ ...current, loading: false, error: String(err && err.message || err) }));
            });
            return () => { active = false; };
        }, []);

        async function savePatch(patch) {
            if (state.loading || state.busy || !state.config) return;
            testSeq.current += 1;
            setState(current => ({ ...current, busy: true, error: "", notice: "", test: null }));
            try {
                const result = await rpc("updateNarrativeDamperSettings", { patch });
                notifySettingsChanged();
                setState(current => ({ ...current, busy: false, config: result.config, credential: result.credential, editingKey: false, notice: "已保存" }));
            } catch (err) {
                setState(current => ({ ...current, busy: false, error: String(err && err.message || err) }));
            }
        }

        function handleProviderChange(nextProvider) {
            const meta = DAMPER_PROVIDER_OPTIONS.find(item => item.value === nextProvider) || DAMPER_PROVIDER_OPTIONS[0];
            const patch = {
                provider: nextProvider,
                model: meta.defaultModel,
                keyName: meta.defaultKeyName,
                baseUrl: meta.customUrl ? (state.config?.baseUrl || "") : ""
            };
            void savePatch(patch);
        }

        async function saveApiKey(value) {
            if (!state.config || state.busy) return;
            testSeq.current += 1;
            setState(current => ({ ...current, busy: true, error: "", notice: "", test: null }));
            try {
                const result = await rpc("setNarrativeDamperKey", { provider: state.config.provider, value });
                setState(current => ({
                    ...current,
                    busy: false,
                    config: result.config || current.config,
                    credential: result.credential,
                    editingKey: false,
                    notice: value === null ? "已清除密钥" : "密钥已保存"
                }));
            } catch (err) {
                setState(current => ({ ...current, busy: false, error: String(err && err.message || err) }));
            }
        }

        async function runTestConnection() {
            if (!state.config || state.busy || state.test?.running) return;
            const seq = ++testSeq.current;
            setState(current => ({ ...current, test: { running: true }, error: "" }));
            try {
                const result = await rpc("testNarrativeDamperConnection", { config: state.config });
                if (seq === testSeq.current) setState(current => ({ ...current, test: result }));
            } catch (err) {
                if (seq === testSeq.current) {
                    setState(current => ({ ...current, test: { ok: false, latencyMs: 0, error: { message: String(err && err.message || err) } } }));
                }
            }
        }

        const config = state.config;
        const disabled = state.loading || state.busy || !config;
        const providerMeta = DAMPER_PROVIDER_OPTIONS.find(item => item.value === config?.provider) || DAMPER_PROVIDER_OPTIONS[0];
        const statusEl = state.error
            ? h("span", { className: "dsh-tavern-gs-notice is-alert", role: "alert" }, "⚠ " + state.error)
            : state.notice ? h("span", { className: "dsh-tavern-gs-notice", role: "status" }, state.notice) : null;

        const testControls = h("span", { className: "dsh-tavern-damper-test" },
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: disabled || state.test?.running, onClick: runTestConnection },
                state.test?.running ? "测试中…" : "测试连接"),
            state.test && !state.test.running ? h("span", {
                className: "dsh-tavern-damper-test-badge " + (state.test.ok ? "is-ok" : "is-error"),
                role: state.test.ok ? "status" : "alert"
            }, state.test.ok
                ? "✓ 连接正常" + (Number.isFinite(state.test.latencyMs) ? " · " + Math.round(state.test.latencyMs) + " ms" : "")
                : "✕ " + (state.test.error?.message || "连接失败")) : null);

        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings dsh-tavern-narrative-damper", "aria-busy": state.loading || undefined },
            h("section", { className: "dsh-tavern-gs-group", "aria-label": "叙事阻尼器" },
                h("header", { className: "dsh-tavern-gs-head" },
                    h("h2", null, "叙事阻尼器"),
                    help("叙事阻尼器", "独立于舞台模块的通用防口胡与状态惯性引擎。每轮正文生成前由轻量决策模型结合 MVU 状态并发评估玩家意图，保留角色言行自由度的同时剥离越权结果，并在后台结算层钳制单轮数值突变。"),
                    statusEl),
                h("div", { className: "dsh-tavern-gs-card" },
                    h(TavernSettingRow, { title: "启用叙事阻尼器", help: "开启后对所有游玩对话（普通故事模式与剧本模式）生效，下一轮消息立即介入裁定。" },
                        h(Switch, { label: "启用叙事阻尼器", disabled, checked: config?.enabled === true, onChange: value => savePatch({ enabled: value }) })),
                    h(TavernSettingRow, { title: "阻尼模式", help: "标准拉扯适合大多数恋爱、NTR 与剧情向游玩（常规变动 ±5 / 突破 ±12）；慢热严苛提高破防筹码要求并收紧单轮状态上限（常规 ±3 / 突破 ±8）。" },
                        h(InlineField, { kind: "menu", label: "阻尼模式", hideLabel: true, disabled,
                            value: config?.mode || "balanced",
                            options: [
                                { value: "balanced", label: "标准拉扯（推荐）" },
                                { value: "strict", label: "慢热严苛" }
                            ],
                            onCommit: value => savePatch({ mode: value }) })),
                    h(TavernSettingRow, { title: "R18 送审语义分级脱敏", help: "仅对发往决策模型的临时评估副本将露骨词汇映射为强度等级标签，防止触发云端决策接口的内容拦截；发给主写作模型的提示词保留完整原文。" },
                        h(Switch, { label: "R18 送审语义分级脱敏", disabled, checked: config?.desensitizeR18 !== false, onChange: value => savePatch({ desensitizeR18: value }) })),
                    h(TavernSettingRow, { title: "后台 MVU 数值涨跌钳制", help: "根据本轮决策配额（反弹 / 冻结 / 微调 / 突破），在后台 MVU 结算落盘前硬性限制好感、信任、沦陷、防线等指标的单轮跳变幅度。" },
                        h(Switch, { label: "后台 MVU 数值涨跌钳制", disabled, checked: config?.clampMvuDelta !== false, onChange: value => savePatch({ clampMvuDelta: value }) })),
                    h(TavernSettingRow, { title: "无 MVU 卡自动维护四维状态", help: "遇到未自带 MVU 变量表的人物卡时，随楼层自动维护亲密信任、心理防线、情绪张力与筹码深度四项惯性锚点，支持回退与分叉。" },
                        h(Switch, { label: "无 MVU 卡自动维护四维状态", disabled, checked: config?.fallbackStateForPlainCards !== false, onChange: value => savePatch({ fallbackStateForPlainCards: value }) })))),
            h("section", { className: "dsh-tavern-gs-group", "aria-label": "决策模型与连接" },
                h("header", { className: "dsh-tavern-gs-head" },
                    h("h2", null, "决策模型与连接"),
                    help("决策模型与连接", "推荐使用 Google Gemini Decisions（gemini-decision-1，单次 Prefill 零输出 Token 并发返回校准概率）。API Key 保存在宿主安全凭据库中，不会明文写入设置文件。")),
                h("div", { className: "dsh-tavern-gs-card" },
                    h(TavernSettingRow, { title: "决策服务提供方" },
                        h(InlineField, { kind: "menu", label: "决策服务提供方", hideLabel: true, disabled,
                            value: config?.provider || "gemini",
                            options: DAMPER_PROVIDER_OPTIONS.map(item => ({ value: item.value, label: item.label })),
                            onCommit: handleProviderChange })),
                    providerMeta.customUrl ? h(TavernSettingRow, { title: "自定义接口地址", help: "填写 HTTPS 反代根地址或本地 127.0.0.1 地址（会自动拼接 /v1beta/decisions 或 /v1/decisions）。" },
                        h(InlineField, { kind: "text", label: "自定义接口地址", hideLabel: true, disabled, maxLength: 512,
                            value: config?.baseUrl || "", placeholder: "https://example.com",
                            onCommit: value => savePatch({ baseUrl: value.trim() }) })) : null,
                    h(TavernSettingRow, { title: "决策模型名称" },
                        h(InlineField, { kind: "text", label: "决策模型名称", hideLabel: true, disabled, maxLength: 160,
                            value: config?.model || providerMeta.defaultModel, placeholder: providerMeta.defaultModel,
                            onCommit: value => savePatch({ model: value.trim() || providerMeta.defaultModel }) })),
                    h(TavernSettingRow, { title: "API Key", help: "直接粘贴密钥保存到本机安全凭据库，或输入已生效的环境变量名（如 GEMINI_API_KEY）作为引用。" },
                        state.credential?.configured && !state.editingKey
                            ? h("div", { className: "dsh-tavern-damper-key-actions" },
                                h("span", { className: "dsh-tavern-damper-status" },
                                    state.credential.source === "stored" ? "已配置（安全存储）" : "已配置 · 环境变量 " + (state.credential.keyName || "")),
                                h("button", { type: "button", className: "dsh-tavern-btn", disabled, onClick: () => setState(current => ({ ...current, editingKey: true })) }, "更换"),
                                state.credential.source === "stored"
                                    ? h("button", { type: "button", className: "dsh-tavern-btn", disabled, onClick: () => saveApiKey(null) }, "清除")
                                    : null,
                                testControls)
                            : h("div", { className: "dsh-tavern-damper-key-edit" },
                                h(InlineField, { kind: "text", secret: true, label: "API Key", hideLabel: true, disabled, maxLength: 4096,
                                    value: "", placeholder: "粘贴 API Key 或环境变量名（回车保存）",
                                    validate: damperKeyValidate,
                                    onCommit: value => saveApiKey(value),
                                    trail: h(React.Fragment, null,
                                        state.editingKey ? h("button", { type: "button", className: "dsh-tavern-btn", disabled, onClick: () => setState(current => ({ ...current, editingKey: false })) }, "取消") : null,
                                        testControls) }))),
                    h(TavernSettingRow, { title: "越权判定阈值", help: "越权代笔、无依据篡改或天眼概率达到此阈值时强制触发剥离（0.50–0.95，数值越低越严格，默认 0.72）。" },
                        h(InlineField, { kind: "number", label: "越权判定阈值", hideLabel: true, disabled,
                            min: 0.5, max: 0.95, step: 0.01, value: config?.godmodeThreshold ?? 0.72,
                            onCommit: value => savePatch({ godmodeThreshold: Number(value) }) })),
                    h(TavernSettingRow, { title: "请求超时上限", help: "决策请求超过此时长仍未返回时自动静默放行，不阻塞本轮正文生成。" },
                        h(InlineField, { kind: "number", label: "请求超时上限", hideLabel: true, disabled,
                            integer: true, min: 300, max: 30000, step: 100, unit: "毫秒", value: config?.timeoutMs ?? 2500,
                            onCommit: value => savePatch({ timeoutMs: Number(value) }) })),
                    h(TavernSettingRow, { title: "附加裁判准则", help: "可选：随状态快照一同发给决策模型的补充说明（如特殊世界观法则），一般留空即可。" },
                        h(InlineField, { kind: "text", label: "附加裁判准则", hideLabel: true, multiline: true, wide: true, disabled, maxLength: 2000,
                            value: config?.preamble || "", placeholder: "留空使用内置通用规则",
                            onCommit: value => savePatch({ preamble: value }) }))))
        );
    }

    return { TavernSettingsSection, TavernPluginsSettingsSection, TavernStageSettingsSection, TavernNarrativeDamperSettingsSection, stageGlobalSettingsOptions };
}
