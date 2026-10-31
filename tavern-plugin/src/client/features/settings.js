        // the one row of 设置 › DSH Tavern — the name and its
        // 「?」 on the left (explanations only in the 「?」, ui-design R3), the control on the right; `note` is a short status beside the
        // control (已保存 / 保存失败…). A row is never a card (.dsh-tavern-settings-group): the card is its group's.
        function TavernSettingRow(props) {
            const h = React.createElement, title = props.title;
            return h("div", { className: "dsh-tavern-settings-row" + (props.className ? " " + props.className : "") },
                h("span", { className: "dsh-tavern-settings-copy" },
                    h("span", { className: "dsh-tavern-settings-title" }, props.labelFor ? h("label", { htmlFor: props.labelFor }, title) : title,
                        props.help && typeof HelpTip === "function" ? h(HelpTip, { label: (props.helpLabel || title) + "说明" }, props.help) : null)),
                h("span", { className: "dsh-tavern-settings-control" },
                    // noteRole null: a standing condition (「需要…」), not an announcement; noteTone "warn" colours a real warning.
                    props.note ? h("span", { className: "dsh-tavern-settings-note", role: props.noteRole === null ? undefined : props.noteRole || "status", "data-tone": props.noteTone || undefined }, props.note) : null,
                    props.children));
        }

        function ContextCompactionSettings() {
            const h = React.createElement;
            const [policy, setPolicy] = React.useState(null), [saved, setSaved] = React.useState(null), [notice, setNotice] = React.useState(""), [busy, setBusy] = React.useState(false);
            React.useEffect(function () { let active = true; rpc("getTavernSettings").then(function (result) { if (active) { const value = result.settings.contextCompaction || { mode: "manual", rounds: 20, percent: 80 }; setPolicy(value); setSaved(value); } }, function (error) { if (active) setNotice(error.message); }); return function () { active = false; }; }, []);
            async function save() {
                setBusy(true); setNotice("");
                try { const result = await rpc("updateTavernSettings", { patch: { contextCompaction: { mode: policy.mode, rounds: Number(policy.rounds), percent: Number(policy.percent), retainRounds: Number(policy.retainRounds ?? 10) } } }); setPolicy(result.settings.contextCompaction); setSaved(result.settings.contextCompaction); setNotice("已保存，下一个安全边界生效"); }
                catch (error) { setNotice(String(error.message || error)); } finally { setBusy(false); }
            }
            // a draft page (R17) — rows like the rest of the page, the explanations
            // in 「?」, one 保存 with 「有未保存的修改」 beside it.
            const field = (key, value) => { setNotice(""); setPolicy(Object.assign({}, policy, { [key]: value })); };
            const same = (a, b) => !a || !b || ["mode", "rounds", "percent", "retainRounds"].every(key => String(a[key] ?? "") === String(b[key] ?? ""));
            const dirty = !same(policy, saved);
            const rounds = policy && policy.mode === "rounds";
            return h("div", { className: "dsh-tavern-compaction-settings", role: "group", "aria-label": "上下文压缩" },
                h("h3", { className: "dsh-tavern-gs-subhead" }, "上下文压缩",
                    typeof HelpTip === "function" ? h(HelpTip, { label: "上下文压缩说明" }, "把较早的剧情压成摘要，前后台都适用；接近容量或请求超限时总会自动保护，原始剧情记录不删。") : null),
                policy ? h(TavernSettingRow, { title: "压缩模式", help: "手动（默认）、每 N 轮或上下文达到一定比例时自动压缩。" },
                    h(InlineField, { kind: "menu", label: "压缩模式", hideLabel: true, value: policy.mode, disabled: busy, onCommit: value => field("mode", value),
                        options: [{ value: "manual", label: "手动压缩（默认）" }, { value: "rounds", label: "每 N 轮自动压缩" }, { value: "percent", label: "上下文达到 X% 自动压缩" }] })) : null,
                policy && policy.mode !== "manual" ? h(TavernSettingRow, { title: rounds ? "剧情轮数" : "上下文占用",
                        help: rounds ? "1–1000 轮；重写同一轮、工具调用和生图不计轮数。" : "10–95%，按估算；模型窗口未知时会提示，可改用轮数模式。" },
                    h(InlineField, { kind: "number", label: rounds ? "剧情轮数" : "上下文占用百分比", hideLabel: true, integer: true, min: rounds ? 1 : 10, max: rounds ? 1000 : 95, unit: rounds ? "轮" : "%",
                        value: policy[policy.mode], disabled: busy, onCommit: value => field(policy.mode, value) })) : null,
                policy ? h(TavernSettingRow, { title: "保留最近原文", help: "压缩后保留最近几轮原文（0–100，默认 10，0 表示全部压缩）；原文太长时按模型窗口少留，超限保护不保留。" },
                    h(InlineField, { kind: "number", label: "压缩后保留最近几轮原文", hideLabel: true, integer: true, min: 0, max: 100, unit: "轮", value: policy.retainRounds ?? 10, disabled: busy,
                        onCommit: value => field("retainRounds", value) })) : null,
                h("div", { className: "dsh-tavern-settings-actions" },
                    notice ? h("span", { role: "status", className: "dsh-tavern-settings-note" }, notice) : dirty ? h("span", { className: "dsh-tavern-settings-note" }, "有未保存的修改") : null,
                    h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !policy, onClick: save }, busy ? "保存中…" : "保存压缩设置")));
        }
		const EMPTY_PROJECTION_FACE = Object.freeze({ subscribe: function () { return function () {}; }, getSnapshot: function () { return null; } });

		function backgroundModelLabel(selection, catalog) {
			if (!selection || !selection.provider || !selection.model) return "";
			const groups = Array.isArray(catalog) ? catalog : [];
			const group = groups.find(function (item) { return item && item.provider === selection.provider; });
			const model = group && Array.isArray(group.models) ? group.models.find(function (item) { return item && item.id === selection.model; }) : null;
			return (group && (group.providerName || group.provider) || selection.provider) + ": " + (model && (model.name || model.id) || selection.model);
		}

		function TavernBackgroundModelLabel(props) {
			const sessionId = String(props.sessionId || "");
			const binding = sessionId && props.sessions ? props.sessions.binding(sessionId) : null;
			const subagentFace = binding ? binding.session.projections.faceOf("subagent") : EMPTY_PROJECTION_FACE;
			const modelFace = binding ? binding.session.projections.faceOf("modelSelection") : EMPTY_PROJECTION_FACE;
			const identity = React.useSyncExternalStore(
				function (listener) { return subagentFace.subscribe(listener); },
				function () { return subagentFace.getSnapshot(); },
				function () { return subagentFace.getSnapshot(); }
			);
			const modelState = React.useSyncExternalStore(
				function (listener) { return modelFace.subscribe(listener); },
				function () { return modelFace.getSnapshot(); },
				function () { return modelFace.getSnapshot(); }
			);
			const [catalog, setCatalog] = React.useState([]);
			const isTavernBackground = Boolean(props.sessions && props.sessions.subagentAddress(sessionId)) && identity && identity.label === "酒馆后台 Agent";
			React.useEffect(function () {
				let active = true;
				if (!isTavernBackground) return function () { active = false; };
				rpc("getTavernSettings").then(function (result) {
					if (active) setCatalog(Array.isArray(result.modelCatalog) ? result.modelCatalog : []);
				}, function () {});
				return function () { active = false; };
			}, [isTavernBackground]);
			if (!isTavernBackground) return null;
			const selection = modelState && (modelState.next || modelState.lastUsed);
			const label = backgroundModelLabel(selection, catalog);
			if (!label) return null;
			return React.createElement("div", {
				className: "dsh-tavern-background-model",
				title: label + "（可在本局设置中修改）",
				"aria-label": "后台模型：" + label
			}, React.createElement("span", null, label));
		}

        function TavernConversationWritingSkills(props) {
            const h = React.createElement;
            const [skills, setSkills] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [notice, setNotice] = React.useState("");
            async function load() { try { const result = await rpc(props.globalDefaults ? "getDefaultWritingSkills" : "getConversationWritingSkills", { sessionId: props.sessionId }, props.sessionId); setSkills(result.skills); setError(""); } catch (err) { setError(String(err.message || err)); } }
            React.useEffect(() => { void load(); }, []);
            async function change(name, enabled) {
                if (busy) return;
                setBusy(true); setError(""); setNotice("");
                try { await rpc(props.globalDefaults ? "setDefaultWritingSkill" : "setConversationWritingSkill", { sessionId: props.sessionId, name, enabled }, props.sessionId); setSkills(skills.map(skill => skill.name === name ? { ...skill, enabled } : skill)); setNotice(props.globalDefaults ? "已保存，下次新游戏生效" : "已生效，后续请求采用新设置"); }
                catch (err) { setError(String(err.message || err)); } finally { setBusy(false); }
            }
            // on 设置 › DSH Tavern the defaults are a card of switch rows, each skill's
            // description behind its 「?」; the 本局 panel keeps its own layout below.
            if (props.globalDefaults) return h("section", { className: "dsh-local-section dsh-tavern-default-skills", "aria-label": "默认写作 Skill" },
                h("h3", null, "默认写作 Skill", typeof HelpTip === "function" ? h(HelpTip, { label: "默认写作 Skill 说明" }, "新游戏默认启用哪些写作 Skill；已有游戏不变，可在本局设置里逐项调整。") : null),
                (skills || []).map(skill => h(TavernSettingRow, { key: skill.name, title: skill.name, help: skill.description, className: "dsh-tavern-writing-skill" },
                    h(Switch, { label: skill.name, checked: skill.enabled, disabled: busy, onChange: enabled => change(skill.name, enabled) }))),
                skills && !skills.length ? h(EmptyState, { compact: true, noun: "写作 Skill" }) : null,
                !skills && !error ? h("div", { className: "dsh-tavern-settings-loading" }, h(Spinner)) : null,
                error ? h("p", { role: "alert", className: "dsh-tavern-settings-alert" }, "⚠ " + error, " ", h("button", { type: "button", className: "dsh-tavern-text-btn", onClick: load }, "重新加载")) : null,
                !error && (busy || notice) ? h("p", { role: "status", className: "dsh-tavern-gs-notice" }, busy ? "保存中…" : "已保存") : null);
            return h(props.globalDefaults ? "details" : "section", { className: "dsh-local-section" + (props.globalDefaults ? " dsh-tavern-default-skills" : ""), "aria-label": props.globalDefaults ? "默认写作 Skill" : "写作 Skill" },
                props.globalDefaults ? h("summary", null, "默认写作 Skill") : h("h3", null, "写作 Skill"),
                h("p", { className: "dsh-local-help" }, props.globalDefaults ? "设置新游戏默认启用的写作 Skill。已有游戏不变，可在本局设置中逐项调整。" : "开局采用全局默认配置，可在此逐项调整本局后续加载；前台按场景选用。"),
                (skills || []).map(skill => h("div", { key: skill.name, className: "dsh-tavern-background-task dsh-tavern-writing-skill" },
                    h("label", { className: "dsh-tavern-writing-skill-heading" }, h("span", null, skill.name), h("input", { type: "checkbox", role: "switch", "aria-label": skill.name, checked: skill.enabled, disabled: busy, onChange: event => change(skill.name, event.target.checked) })),
                    h("p", { className: "dsh-tavern-settings-desc" }, skill.description))),
                skills && !skills.length ? h(EmptyState, { compact: true, noun: "写作 Skill" }) : null,
                !props.globalDefaults ? h("p", { className: "dsh-local-help" }, "开关立即更新，后续模型请求生效；已发出的请求不受影响。通过追加通知保留已有缓存前缀，关闭后停止沿用该 Skill，历史内容保留。") : null,
                error ? h("p", { role: "alert" }, error) : h("span", { role: "status" }, busy ? "保存中…" : skills ? notice : "正在读取…"),
                error ? h("button", { className: "dsh-tavern-btn", onClick: load }, "重新加载") : null);
        }

        function TavernDefaultModelSetting(props) {
            const h = React.createElement;
            const selection = props.selection;
            const key = selection ? JSON.stringify({ provider: selection.provider, model: selection.model }) : "";
            const [reasoning, setReasoning] = React.useState({ key: "", value: null, error: "" });
            React.useEffect(() => {
                let active = true;
                if (key && props.kind !== "scoring") rpc("getBackgroundModelReasoning", JSON.parse(key)).then(result => {
                    if (active) setReasoning({ key, value: result.reasoning, error: "" });
                }, err => { if (active) setReasoning({ key, value: null, error: String(err.message || err) }); });
                return () => { active = false; };
            }, [key]);
            const efforts = reasoning.key === key ? reasoning.value?.efforts || [] : [];
            const known = !selection || props.catalog.some(group => group.provider === selection.provider && group.models.some(model => model.id === selection.model));
            // one row — the name and its 「?」, then model · reasoning as the shared
            // inline menus (no native select, ui-design §三.5); the provider is the menu's group heading.
            const models = [{ value: "", label: props.fallback }]
                .concat(!known ? [{ value: key, label: backgroundModelLabel(selection, props.catalog) + "（当前不可用）" }] : [])
                .concat(props.catalog.flatMap(group => group.models.map(model => ({ value: JSON.stringify({ provider: group.provider, model: model.id }), label: model.name || model.id, group: group.providerName || group.provider }))));
            // Every slot offers the same choices; a slot's declared initial effort (the phone call: off) is the
            // value shown until this slot stores its own, where the model offers it (model-slots.js resolves the same way).
            // 模型默认 is stored as null so it stays chosen over that initial value.
            const initial = props.initialEffort && efforts.some(item => item.id === props.initialEffort) ? props.initialEffort : "";
            const effort = selection && Object.hasOwn(selection, "reasoningEffort") ? selection.reasoningEffort || "" : initial;
            return h(TavernSettingRow, { title: props.title || props.label, help: props.description, className: "dsh-tavern-model-row",
                    note: key && reasoning.key === key && reasoning.error ? "⚠ " + reasoning.error : "", noteRole: "alert" },
                h(InlineField, { kind: "menu", label: props.label, hideLabel: true, value: key, disabled: props.disabled, options: models, className: "dsh-tavern-model-pick",
                    onCommit: value => props.onChange(value ? JSON.parse(value) : null) }),
                props.kind === "scoring" ? null : h(InlineField, { kind: "menu", label: props.label + "推理强度", hideLabel: true, value: effort, disabled: props.disabled || !key || !efforts.length, className: "dsh-tavern-effort-pick",
                    options: [{ value: "", label: "模型默认" }].concat(effort && !efforts.some(item => item.id === effort) ? [{ value: effort, label: effort }] : [], efforts.map(item => ({ value: item.id, label: item.name || item.id }))),
                    onCommit: value => props.onChange({ ...selection, reasoningEffort: value || null }) }));
        }

        function TavernModelSlotGroups({slots = [], values = {}, catalog = [], scoringCatalog = [], disabled, local = false, onChange}) {
            const h = React.createElement;
            const groups = Map.groupBy(slots, slot => slot.modId);
            return Array.from(groups, ([modId, rows]) => h(packUi.StageSection, {key:modId,title:rows[0].modName,foldKey:"model-slots/"+(local?"chat":"global")+"/"+modId,className:"dsh-local-section"},
                rows.map(slot => h(TavernDefaultModelSetting, {key:slot.id,label:slot.label,title:slot.label,description:slot.purpose,kind:slot.kind,initialEffort:slot.reasoning,
                    fallback:local ? "跟随全局" : slot.kind === "scoring" ? "使用判断接口默认模型" : slot.fallback === "background" ? "跟随后台" : "跟随前台",
                    selection:values[modId]?.[slot.id] || null,disabled,
                    catalog:slot.kind === "scoring" ? scoringCatalog.map(row=>({provider:row.provider,models:[{id:row.model}]})) : catalog,
                    onChange:selection=>onChange({modId,slotId:slot.id,selection})}))));
        }

        function PromptTemplateSettingsEntry({ sessionId } = {}) {
            const [error, setError] = React.useState("");
            const request = React.useRef(null);
            React.useEffect(() => () => { request.current?.close?.(); }, [sessionId]);
            function open() {
                setError(""); request.current?.close?.();
                if (!sessionId) {
                    const panel = createServerTemplatePanel({ window, rpc, globalSettings: true });
                    request.current = panel; panel.open(); return;
                }
                const detail = { handled: false, sessionId };
                request.current = detail;
                window.dispatchEvent(new CustomEvent("dsh-template-settings", { detail }));
                if (!detail.handled) setError("请等待本局加载完成后重试。");
            }
            const h = React.createElement;
            // on 设置 › DSH Tavern a plain row of the 高级 card (explanation in 「?」).
            if (!sessionId) return h(TavernSettingRow, { title: "提示词模板", help: "调整 EJS 模板运行、兼容性与性能选项，对所有游戏生效。", className: "dsh-tavern-template-entry",
                    note: error, noteRole: "alert" },
                h("button", { type: "button", className: "dsh-tavern-btn", onClick: open }, "提示词模板设置"));
            return h("section", { className: sessionId ? "dsh-local-section" : "dsh-tavern-settings-group" },
                h("div", { className: "dsh-tavern-settings-row" },
                    h("div", { className: "dsh-tavern-settings-copy" },
                        h("strong", null, sessionId ? "本局模板调试" : "提示词模板"),
                        h("p", { className: "dsh-tavern-settings-desc" }, sessionId ? "执行 EJS 命令，查看或调整本局变量。" : "调整 EJS 模板运行、兼容性与性能选项，对所有游戏生效。")),
                    h("button", { type: "button", className: "dsh-tavern-btn", onClick: open }, sessionId ? "本局模板命令" : "提示词模板设置")),
                error ? h("p", { className: "dsh-tavern-settings-error", role: "alert" }, error) : null);
        }

        const displayPreferences = (() => {
            let value = null, revision = 0;
            const listeners = new Set();
            const key = "dsh-tavern:display-preferences-changed";
            const migrateDebug = createDebugMigration(window);
            // The top bar reads this before the first read lands; the shipped
            // default keeps it from flashing an empty row.
            function headerItemsOf(settings) {
                const input = settings && settings.headerItems;
                if (!input || typeof input !== "object" || !Array.isArray(input.items)) return { display: TAVERN_HEADER_DEFAULT.display, items: [...TAVERN_HEADER_DEFAULT.items] };
                return { display: input.display === "icon" ? "icon" : "icon-text", items: input.items.filter(item => typeof item === "string").slice(0, 24) };
            }
            // 对话始终在首位；旧配置或手改配置里缺了它、或排到后面，都在读取时纠正。
            function viewTabsOf(settings) {
                const input = settings && settings.viewTabs;
                return { items: tavernViewTabItems(input && typeof input === "object" && Array.isArray(input.items) ? input : null) };
            }
            function apply(settings) {
                value = { hideContextAndReasoning: settings.hideContextAndReasoning === true, headerItems: headerItemsOf(settings), viewTabs: viewTabsOf(settings) };
                document.documentElement.classList.toggle("dsh-tavern-hide-process", value.hideContextAndReasoning);
                applyDebug(document, !value.hideContextAndReasoning); // derive developer chrome from the same setting
                listeners.forEach(listener => listener());
            }
            async function refresh() {
                const request = ++revision;
                // retry a failed migration on focus; never discard an unsaved legacy opt-in.
                try { await migrateDebug(hidden => displayPreferences.save({ hideContextAndReasoning: hidden })); } catch (_) {}
                try { const result = await rpc("getDisplayPreferences"); if (request === revision) apply(result); } catch (_) {}
            }
            return {
                subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
                snapshot: () => value,
                async save(patch) {
                    ++revision;
                    const result = await rpc("updateTavernSettings", { patch });
                    ++revision; apply(result.settings);
                    try { window.localStorage.setItem(key, String(Date.now())); } catch (_) {}
                },
                start() {
                    // hide developer/process content before the first server response.
                    const hidden = value ? value.hideContextAndReasoning : true;
                    document.documentElement.classList.toggle("dsh-tavern-hide-process", hidden);
                    applyDebug(document, !hidden);
                    refresh();
                    const onStorage = event => { if (event.key === key) refresh(); };
                    window.addEventListener("focus", refresh);
                    window.addEventListener("storage", onStorage);
                    return () => { ++revision; window.removeEventListener("focus", refresh); window.removeEventListener("storage", onStorage); document.documentElement.classList.remove("dsh-tavern-hide-process"); applyDebug(document, false); };
                }
            };
        })();
        // 隐藏上下文注入和思考过程 is the 调试视图 switch (debug.js DebugSetting); this keeps upstream's
        // 渲染深度 as a row of the 显示与交互 card (ui-design §三.5 inline menu, explanation in the 「?」).
        function DisplayPreferencesSettings() {
            const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
            const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
            async function save(patch) {
                setBusy(true); setNotice("");
                try { await displayPreferences.save(patch); setNotice("已保存"); }
                catch (error) { setNotice("保存失败：" + String(error.message || error)); }
                finally { setBusy(false); }
            }
            const h = React.createElement;
            return h(TavernSettingRow, { title: "隐藏上下文注入和思考过程", help: "仅影响显示，正文、模型请求和存档内容不变。", note: notice, className: "dsh-tavern-display-preferences" },
                h(Switch, { label: "隐藏上下文注入和思考过程", checked: preferences?.hideContextAndReasoning === true, disabled: preferences === null || busy,
                    onChange: value => save({ hideContextAndReasoning: value }) }));
        }
        function HeaderItemsSettings(props) {
            const h = React.createElement;
            // The settings page folds this block; the 顶栏设置 dialog is already
            // that one block, so folding there would hide everything behind a
            // title that repeats the dialog's own heading.
            const collapsible = !(props && props.collapsible === false);
            const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
            const catalog = React.useSyncExternalStore(tavernHeaderCatalog.subscribe, tavernHeaderCatalog.snapshot, tavernHeaderCatalog.snapshot);
            const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
            const [dragging, setDragging] = React.useState("");
            const dragRef = React.useRef("");
            const config = preferences && preferences.headerItems ? preferences.headerItems : TAVERN_HEADER_DEFAULT;
            const items = Array.isArray(config.items) ? config.items : [];
            const known = React.useMemo(function () {
                const list = [], seen = new Set();
                function push(entry) { if (!entry || !entry.id || seen.has(entry.id)) return; seen.add(entry.id); list.push(entry); }
                push({ id: "header:export", label: "导出" });
                push({ id: "dsh-tavern:status", label: "酒馆状态" });
                catalog.forEach(push);
                return list;
            }, [catalog]);
            const byId = React.useMemo(function () {
                const map = new Map(known.map(entry => [entry.id, entry]));
                return id => map.get(id) || { id: id, label: String(id).replace(/^[^:]+:/, "") };
            }, [known]);
            const groups = React.useMemo(function () {
                const headerTools = known.filter(entry => entry.id === "header:export");
                return [["顶栏工具", headerTools]].concat(tavernStartGroups(known.filter(entry => entry.id !== "header:export"), tavernUiExtensions.startGroups()));
            }, [known]);
            async function save(next) {
                setBusy(true); setNotice("");
                try { await displayPreferences.save({ headerItems: { display: next.display, items: next.items } }); setNotice("已保存，对所有对话立即生效"); }
                catch (error) { setNotice("保存失败：" + String(error.message || error)); }
                finally { setBusy(false); }
            }
            function changeItems(next) { return save({ display: config.display, items: next }); }
            function toggle(id) {
                if (busy) return;
                return changeItems(items.includes(id) ? items.filter(value => value !== id) : [...items, id]);
            }
            function move(id, delta) {
                if (busy) return;
                const index = items.indexOf(id), target = index + delta;
                if (index < 0 || target < 0 || target >= items.length) return;
                const next = items.slice();
                [next[index], next[target]] = [next[target], next[index]];
                return changeItems(next);
            }
            function drop(target) {
                const source = dragRef.current;
                dragRef.current = ""; setDragging("");
                if (busy || !source || source === target) return;
                const next = items.filter(value => value !== source);
                next.splice(next.indexOf(target) + (items.indexOf(source) < items.indexOf(target) ? 1 : 0), 0, source);
                return changeItems(next);
            }
            const mode = (value, title, description, preview) => h("button", {
                type: "button", className: "dsh-tavern-header-mode", role: "radio", "aria-checked": config.display === value, disabled: busy || preferences === null,
                onClick: function () { if (config.display !== value) save({ display: value, items: items }); }
            },
                h("span", { className: "dsh-tavern-header-mode-preview" }, preview),
                h("span", { className: "dsh-tavern-header-mode-name" }, h("span", { className: "dsh-tavern-header-radio" }), title),
                h("small", null, description));
            const chip = option => {
                const on = items.includes(option.id);
                return h("button", { key: option.id, type: "button", className: "dsh-tavern-header-chip" + (on ? " is-on" : ""), "aria-pressed": on, disabled: busy, onClick: function () { void toggle(option.id); } },
                    h("span", { className: "dsh-tavern-header-chip-icon", "aria-hidden": true }, tavernStartIcon(option.id, option, 13)),
                    option.label,
                    h("span", { className: "dsh-tavern-header-chip-state", "aria-hidden": true }, on ? "✓" : "＋"));
            };
            const headerSummary = (config.display === "icon" ? "只显示图标" : "图标 + 文字") + " · " + items.length + " 个按钮 · " + tavernViewTabItems(preferences && preferences.viewTabs).length + " 个标签";
            const heading = h("strong", { className: "dsh-tavern-settings-title", key: "title" }, "自定义顶栏");
            return h(collapsible ? "details" : "section", { className: "dsh-tavern-settings-group dsh-tavern-header-settings-group" + (collapsible ? "" : " is-expanded") },
                collapsible ? h("summary", { className: "dsh-tavern-header-summary" },
                    heading,
                    h("span", { className: "dsh-tavern-header-summary-meta" }, headerSummary),
                    h("span", { className: "dsh-tavern-header-summary-chevron", "aria-hidden": true }, "▾")) : null,
                h("div", { className: "dsh-tavern-settings-copy" },
                    collapsible ? null : heading,
                    h("p", { className: "dsh-tavern-settings-desc" }, "决定会话顶栏显示哪些按钮、按什么顺序、要不要文字。改动立即保存，对所有对话生效。全屏和右侧栏按钮由宿主提供，始终保留在最右。")),
                h("div", { className: "dsh-tavern-header-modes", role: "radiogroup", "aria-label": "顶栏显示方式" },
                    mode("icon", "只显示图标", "最省空间，悬停显示名称",
                        h(React.Fragment, null, h("span", { className: "dsh-tavern-header-mode-chip is-square" }, tavernStartIcon("dsh-tavern:worldbooks", null, 13)), h("span", { className: "dsh-tavern-header-mode-chip is-square" }, tavernStartIcon("dsh-tavern:cards", null, 13)))),
                    mode("icon-text", "图标 + 文字", "一眼认出，适合宽屏",
                        h(React.Fragment, null, h("span", { className: "dsh-tavern-header-mode-chip" }, tavernStartIcon("dsh-tavern:worldbooks", null, 13), "世界书"), h("span", { className: "dsh-tavern-header-mode-chip" }, tavernStartIcon("dsh-tavern:cards", null, 13), "人物卡")))),
                items.length ? h("ul", { className: "dsh-tavern-header-list" }, items.map(function (id, index) {
                    const entry = byId(id);
                    return h("li", {
                        key: id, className: "dsh-tavern-header-list-row" + (dragging === id ? " is-dragging" : ""),
                        onDragOver: function (event) { if (dragRef.current && dragRef.current !== id) event.preventDefault(); },
                        onDrop: function (event) { event.preventDefault(); void drop(id); }
                    },
                        h("span", {
                            className: "dsh-tavern-header-grip", title: "拖动排序", "aria-hidden": true, draggable: !busy,
                            onDragStart: function (event) { dragRef.current = id; setDragging(id); if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; try { event.dataTransfer.setData("text/plain", id); } catch (_) {} } },
                            onDragEnd: function () { dragRef.current = ""; setDragging(""); }
                        }, "⋮⋮"),
                        h("span", { className: "dsh-tavern-header-list-icon", "aria-hidden": true }, tavernStartIcon(id, entry, 16)),
                        h("span", { className: "dsh-tavern-header-list-name" }, h("strong", null, entry.label), h("small", null, id === "header:export" || id === "dsh-tavern:status" ? "原有按钮" : "侧栏页面")),
                        h("span", { className: "dsh-tavern-header-list-ops" },
                            h("button", { type: "button", className: "dsh-tavern-header-op", "aria-label": "上移", title: "上移", disabled: busy || index === 0, onClick: function () { void move(id, -1); } }, "↑"),
                            h("button", { type: "button", className: "dsh-tavern-header-op", "aria-label": "下移", title: "下移", disabled: busy || index === items.length - 1, onClick: function () { void move(id, 1); } }, "↓"),
                            h("button", { type: "button", className: "dsh-tavern-header-op is-danger", "aria-label": "移除", title: "移除", disabled: busy, onClick: function () { void toggle(id); } }, "×")));
                })) : h("p", { className: "dsh-tavern-header-empty" }, "顶栏上没有可编辑的按钮了。从下方添加，或点「恢复默认」找回导出。"),
                h("div", { className: "dsh-tavern-header-catalog" },
                    h("strong", { className: "dsh-tavern-settings-title" }, "可添加的按钮"),
                    h("p", { className: "dsh-tavern-settings-desc" }, "「顶栏工具」是顶栏自带的按钮；其余与侧栏开始页一致，插件注册的页面也会出现在这里。"),
                    groups.filter(group => group[1].length).map(function ([title, options]) {
                        return h("div", { key: title, className: "dsh-tavern-header-catalog-group" },
                            h("div", { className: "dsh-tavern-header-catalog-title" }, title),
                            h("div", { className: "dsh-tavern-header-chips" }, options.map(chip)));
                    })),
                h("div", { className: "dsh-tavern-header-foot" },
                    h("p", { className: "dsh-tavern-settings-desc" }, "手机和窄窗口上统一只显示图标；放不下的页面会收进顶栏末尾的「⋯」菜单。酒馆状态和导出不会收起。"),
                    h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void save({ display: TAVERN_HEADER_DEFAULT.display, items: [...TAVERN_HEADER_DEFAULT.items] }); } }, "恢复默认")),
                notice ? h("p", { className: "dsh-tavern-settings-desc", role: "status" }, notice) : null,
                h(TavernViewTabsSettings));
        }

        function useCandidatePreferences() {
            const [mode, setMode] = React.useState("after-send");
            React.useEffect(function () {
                let active = true;
                let changed = false;
                function update(event) { changed = true; setMode(event.detail); }
                window.addEventListener("dsh-tavern-candidate-preferences", update);
                rpc("getCandidatePreferences").then(result => {
                    if (active && !changed) setMode(result.candidateDismissMode);
                }, () => {});
                return () => { active = false; window.removeEventListener("dsh-tavern-candidate-preferences", update); };
            }, []);
            return mode;
        }

        // the automatic candidate preference hook (its switch lives in 舞台设置 › 基础设置); no stage/bubble dependency.
        // @include auto-choices-preference.js

        function CandidatePreferencesSettings() {
            const mode = useCandidatePreferences();
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState("");
            async function save(value) {
                if (busy) return;
                setBusy(true); setNotice("");
                try {
                    const result = await rpc("updateTavernSettings", { patch: { candidateDismissMode: value } });
                    window.dispatchEvent(new CustomEvent("dsh-tavern-candidate-preferences", { detail: result.settings.candidateDismissMode }));
                    setNotice("已保存");
                } catch (error) { setNotice("保存失败：" + String(error.message || error)); }
                finally { setBusy(false); }
            }
            const h = React.createElement;
            // a plain row of the 显示与交互 card, not a card of its own.
            return h(TavernSettingRow, { title: "候选项", help: "候选项什么时候收起，对所有游戏生效。", note: notice, className: "dsh-tavern-candidate-setting" },
                h(InlineField, { kind: "menu", label: "候选项收起时机", hideLabel: true, value: mode, disabled: busy, onCommit: value => save(value),
                    options: [{ value: "after-fill", label: "选择一项后即隐藏" }, { value: "after-send", label: "可选择多项发送后才隐藏" }] }));
        }

        // 设置 → DSH Tavern → 插件：粘贴 GitHub 地址或上传 ZIP 安装，列出已装插件与加载情况。
        function TavernUserPluginsSettings(props = {}) {
            const h = React.createElement;
            const [data, setData] = React.useState(null);
            const [legacy, setLegacy] = React.useState(null);
            const [updates, setUpdates] = React.useState(null);
            const [checking, setChecking] = React.useState(false);
            const [url, setUrl] = React.useState("");
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState("");
            const [error, setError] = React.useState("");
            const zipInput = React.useRef(null);
            function updateSummary(next) {
                const items = Object.keys(next).map(function (folder) { return next[folder]; });
                const available = items.filter(function (item) { return item.status === "available"; }).length;
                const failed = items.filter(function (item) { return item.status === "error"; }).length;
                if (!items.length) return { text: "没有从 GitHub 安装的插件，无需检查更新。", failed: false };
                return {
                    failed: failed > 0,
                    text: failed
                        ? "检查完成：" + (available ? available + " 个插件有新版，" : "") + failed + " 个插件检查失败。"
                        : available ? "检查完成：有 " + available + " 个插件可以更新。" : "检查完成：没有发现新版本。"
                };
            }
            async function checkUpdates(announce) {
                setChecking(true);
                if (announce) { setNotice(""); setError(""); }
                try {
                    // 点「检查更新」是明确的重查，跳过 5 分钟的 Release 缓存。
                    const result = await rpc("checkUserPluginUpdates", announce ? { fresh: true } : undefined);
                    const next = {};
                    (result && result.plugins || []).forEach(function (item) { next[item.folder] = item; });
                    setUpdates(next);
                    if (announce) {
                        const summary = updateSummary(next);
                        if (summary.failed) setError(summary.text);
                        else setNotice(summary.text);
                    }
                } catch (err) {
                    setUpdates({});
                    if (announce) setError("检查更新失败：" + String(err && err.message || err));
                }
                finally { setChecking(false); }
            }
            async function refresh() {
                try {
                    const next = await rpc("listUserPlugins");
                    setData(next);
                    if ((next.plugins || []).some(function (plugin) { return plugin.source && plugin.source.kind === "github"; })) await checkUpdates();
                    else setUpdates({});
                } catch (err) { setError(String(err && err.message || err)); }
            }
            async function refreshLegacy() {
                try { setLegacy(await rpc("listLegacyPlugins")); }
                catch (_error) { setLegacy(null); }
            }
            React.useEffect(function () { void refresh(); void refreshLegacy(); }, []);
            async function run(work, done) {
                setBusy(true); setError(""); setNotice("");
                try { const result = await work(); setNotice(done(result)); await refresh(); }
                catch (err) { setError(String(err && err.message || err)); }
                finally { setBusy(false); }
            }
            const installed = function (result) {
                const plugin = result.plugin;
                return (plugin.replaced ? "已更新 " : "已安装 ") + plugin.name + (plugin.version ? " " + plugin.version : "") + (plugin.replaced ? "，重启 DSH 后生效。" : "，刷新页面后生效。");
            };
            function installUrl() {
                if (!url.trim()) return;
                void run(function () { return rpc("installUserPlugin", { url: url.trim() }); }, function (result) { setUrl(""); return installed(result); });
            }
            function installZip(event) {
                const file = event.target.files && event.target.files[0];
                event.target.value = "";
                if (!file) return;
                void run(async function () {
                    const response = await fetch("/api/dsh-tavern/card-upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
                    let reply = null;
                    try { reply = await response.json(); } catch (_error) {}
                    if (!reply || !reply.ok) throw new Error(reply && reply.error || "上传失败（HTTP " + response.status + "）");
                    return rpc("installUserPluginUpload", { uploadId: reply.uploadId, name: file.name });
                }, installed);
            }
            async function remove(plugin) {
                const ok = await askTavernConfirm("删除插件 " + plugin.name + "？插件文件夹会移到 plugin-backups 备份目录，可以手动找回。", { confirmText: "删除" });
                if (!ok) return;
                void run(function () { return rpc("removeUserPlugin", { folder: plugin.folder }); }, function () { return "已删除 " + plugin.name + "，刷新页面后生效。"; });
            }
            function toggle(plugin) {
                const enable = plugin.enabled === false;
                void run(function () { return rpc(enable ? "enableUserPlugin" : "disableUserPlugin", { folder: plugin.folder }); }, function () { return (enable ? "已启用 " : "已停用 ") + plugin.name + "，刷新页面后生效。"; });
            }
            // 「已是最新」是插件状态，放在名称和「已加载」旁边，不占按钮区。
            function updateBadge(plugin) {
                const info = updates && updates[plugin.folder];
                if (checking && !info) return h("span", { className: "dsh-tavern-user-plugin-update is-checking" }, "检查更新…");
                if (info && info.status === "latest") return h("span", { className: "dsh-tavern-user-plugin-update is-latest", title: "已安装最新版本" + (info.current ? " " + info.current : "") }, "已是最新");
                return null;
            }
            // Only offer an update when the latest Release is actually newer than what is installed.
            function updateAction(plugin) {
                const info = updates && updates[plugin.folder];
                if (checking && !info) return null;
                if (info && info.status === "latest") return null;
                const latest = info && info.status === "available" ? String(info.latest || "").replace(/^v(?=\d)/i, "") : "";
                const title = info && info.status === "branch" ? "这个插件没有 Release，更新会重新下载默认分支的最新代码"
                    : info && info.status === "ref" ? "这个插件固定在分支或标签上，更新会重新下载同一个分支或标签"
                        : info && info.status === "error" ? "检查更新失败：" + info.reason
                            : info && info.status === "unknown" ? "无法比较版本号（最新 Release：" + (info.latest || "未标注") + "），仍可手动更新" : undefined;
                return h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, title: title, onClick: function () { void run(function () { return rpc("updateUserPlugin", { folder: plugin.folder }); }, installed); } }, latest ? "更新到 " + latest : "更新");
            }
            const stateLabel = { loaded: "已加载", pending: "刷新后生效", restart: "重启 DSH 后生效", failed: "加载失败", skipped: "未加载", disabled: "已停用" };
            const sourceLabel = function (source) { return source.kind === "github" ? "GitHub · " + source.repo + (source.resolved ? " · " + source.resolved : "") : source.kind === "zip" ? "ZIP 上传" : source.kind === "card" ? "人物卡自带" : "手动放入"; };
            const plugins = data ? data.plugins || [] : [];
            return h("div", { className: "dsh-tavern-settings-group dsh-tavern-user-plugins" },
                h("div", { className: "dsh-tavern-user-plugins-install" },
                    // the shared inline text field; Enter keeps the address, 安装 installs it.
                    h(InlineField, { kind: "text", label: "插件地址", hideLabel: true, value: url, disabled: busy, placeholder: "粘贴插件的 GitHub 地址，例如 https://github.com/作者/仓库",
                        onCommit: function (value) { setUrl(value); } }),
                    h("button", { type: "button", className: "dsh-tavern-btn primary", disabled: busy, onClick: installUrl }, busy ? "处理中…" : "安装"),
                    h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { if (zipInput.current) zipInput.current.click(); } }, "上传 ZIP"),
                    h("input", { ref: zipInput, type: "file", accept: ".zip,application/zip", style: { display: "none" }, onChange: installZip })),
                h("p", { className: "dsh-tavern-settings-desc" }, "插件会运行在你的电脑上，只装信任的作者发布的插件。有 Release 时安装最新 Release，否则安装默认分支；连不上 GitHub 时，可以在仓库页面下载 ZIP 后上传。"),
                notice ? h("p", { className: "dsh-tavern-user-plugins-notice", role: "status" }, notice) : null,
                error ? h("p", { className: "dsh-tavern-settings-error", role: "alert" }, error) : null,
                plugins.length || props.builtinEntry ? h("div", { className: "dsh-tavern-user-plugins-head" },
                    h("span", { className: "dsh-tavern-user-plugins-head-title" }, "已装的插件"),
                    plugins.some(function (plugin) { return plugin.source.kind === "github"; })
                        ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || checking, onClick: function () { void checkUpdates(true); } }, checking ? "检查中…" : "检查更新")
                        : null) : null,
                data && plugins.length === 0 && !props.builtinEntry ? h(EmptyState, { compact: true, noun: "插件" }) : null,
                plugins.length || props.builtinEntry ? h("ul", { className: "dsh-tavern-user-plugins-list" }, props.builtinEntry, plugins.map(function (plugin) {
                    const canToggle = plugin.source.kind !== "card" || plugin.enabled === false;
                    return h("li", { key: plugin.folder, className: "dsh-tavern-user-plugin is-" + plugin.state },
                        h("div", { className: "dsh-tavern-user-plugin-copy" },
                            h("strong", null, plugin.name, plugin.version ? h("small", null, " " + plugin.version) : null,
                                h("span", { className: "dsh-tavern-user-plugin-state", title: plugin.state === "restart" ? "插件文件已更新，重启 DSH 后会加载新版本，这里自动变回「已加载」" : undefined }, stateLabel[plugin.state] || plugin.state),
                                plugin.source.kind === "github" ? updateBadge(plugin) : null),
                            plugin.description ? h("span", null, plugin.description) : null,
                            h("span", { className: "dsh-tavern-user-plugin-source" }, sourceLabel(plugin.source)),
                            plugin.reason ? h("span", { className: "dsh-tavern-settings-error" }, plugin.reason) : null),
                        h("div", { className: "dsh-tavern-user-plugin-actions" },
                            canToggle ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { toggle(plugin); } }, plugin.enabled === false ? "启用" : "停用") : null,
                            plugin.source.kind === "github" ? updateAction(plugin) : null,
                            plugin.source.kind === "card" ? null : h("button", { type: "button", className: "dsh-tavern-btn danger", disabled: busy, onClick: function () { void remove(plugin); } }, "删除")));
                })) : null,
                legacy && legacy.plugins && legacy.plugins.length ? h("div", { className: "dsh-tavern-legacy-plugins" },
                    h("div", { className: "dsh-tavern-settings-row" },
                        h("span", { className: "dsh-tavern-settings-copy" },
                            h("strong", null, "已装的旧版插件"),
                            h("p", { className: "dsh-tavern-settings-desc", title: legacy.profile }, "由 Profile 加载，此处只读；安装、更新请走各插件自己的入口。"))),
                    h("ul", { className: "dsh-tavern-user-plugins-list" }, legacy.plugins.map(function (plugin) {
                        const status = plugin.status === "bundle" ? "Profile bundle" : plugin.status === "dependency" ? "仅依赖" : "缺失";
                        return h("li", { key: plugin.name, className: "dsh-tavern-user-plugin" },
                            h("div", { className: "dsh-tavern-user-plugin-copy" },
                                h("strong", null, plugin.name, plugin.version ? h("small", null, " " + plugin.version) : null,
                                    h("span", { className: "dsh-tavern-user-plugin-state", title: plugin.status === "bundle" ? "已登记在 dsh.profile.bundles 中，由 Profile 加载" : plugin.status === "dependency" ? "已安装，但不在 dsh.profile.bundles 中" : "Profile 里找不到这个已安装的包" }, status)),
                                plugin.description ? h("span", null, plugin.description) : null,
                                plugin.kind ? h("span", { className: "dsh-tavern-user-plugin-source" }, plugin.kind) : null));
                    }))) : null,
                h("div", { className: "dsh-tavern-user-plugins-folder" },
                    h("span", { className: "dsh-tavern-settings-desc", title: data ? data.dir : "" }, data ? "插件文件夹：" + data.dir : ""),
                    h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void rpc("openUserPluginsFolder").catch(function (err) { setError(String(err && err.message || err)); }); } }, "打开插件文件夹")));
        }

        // @include modules/global-settings.js
        const { TavernSettingsSection, TavernPluginsSettingsSection, TavernStageSettingsSection } = createGlobalSettingsModule({
            React, rpc, notifySettingsChanged: () => { window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed")); notifyTavernDataChanged(["sessions"], "global-settings"); },
            // 隐藏上下文 is the 调试视图 row (DebugSetting); 配音 has its own settings page (main.js).
            TavernDefaultModelSetting, TavernModelSlotGroups, TavernConversationWritingSkills, DisplayPreferencesSettings: () => null, HeaderItemsSettings,
            CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, TavernUserPluginsSettings, DebugSetting, SpineRuntimeEntry,
            StageGenerationSettings: () => React.createElement(packUi.GenPromptSettings, { call: engineRpc }),
            // 设置 › 舞台 › 模组管理 (mod-manager.js, in the asset-pack UI factory).
            ForkModManagerEntry: () => React.createElement(packUi.ModManagerEntry, { rpc, Row: TavernSettingRow }),
            // the shared row and controls of the page.
            TavernSettingRow, InlineField, Switch, HelpTip: typeof HelpTip === "function" ? HelpTip : null
        });
