// 舞台设置 › 舞台模式 ›: the optional judge that recalls green entries (tavern settings stageJudge, 「判断模型」), what every
// card's director may use (stageDimensions, 「可用演出」) and how often one reply may use it (stageActionCaps, 「每轮上限」).
// The director reads them when a turn starts (stage-director.js). 可用演出 chips and the API Key save at once; 判断模型 and
// 每轮上限 are one draft saved by 「保存」, and Esc never drops an unsaved draft.
const TAVERN_STAGE_COMMAND_GROUPS = Object.freeze([
	["场景与转场", [["scene", "场景"]]],
	["人物", [["cast", "出场"], ["acts", "动作"]]],
	["效果", [["screenEffects", "画面效果"]]]
]);
const TAVERN_STAGE_CAPS = Object.freeze([["beat", "画面效果", "次"]]);
const TAVERN_STAGE_MODE_HELP = Object.freeze({
	page: "这一页的设置所有卡共用。",
	commands: "导演可以用哪些演出，所有卡通用，点选立即保存。",
	caps: "每轮回复里最多用几次，免得画面一直闪。",
	judge: "可选：配置后可减轻导演负担、更精准地挑选素材；未设置时蓝灯与触发词照常生效。"
});
// 判断模型 (engine-judge.js): picking a provider fills in its model and credential name and turns the judge on; only a
// compatible endpoint keeps a URL.
const TAVERN_JUDGE_PROVIDERS = Object.freeze({ jev: { label: "Jev", model: "jev-1.13.0", keyName: "TYPESAFE_API_KEY" }, openai: { label: "OpenAI", model: "gpt-6-luna", keyName: "OPENAI_API_KEY" },
	"openai-compatible": { label: "OpenAI 兼容", model: "gpt-6-luna", keyName: "OPENAI_API_KEY" } });
// A failed test or key save shows a short reason, never the provider's or host's raw text.
const TAVERN_JUDGE_ERRORS = Object.freeze({ JUDGE_INACTIVE: "未设置提供方", JUDGE_NO_KEY: "没有 API Key", JUDGE_TIMEOUT: "超时", JUDGE_HTTP_ERROR: "服务返回错误",
	JUDGE_INVALID_RESPONSE: "返回内容不对", JUDGE_ERROR: "连接失败", JUDGE_KEY_URL_MISMATCH: "请先保存此服务地址与密钥名称，再测试连接", JUDGE_KEY_STORE_UNAVAILABLE: "无法保存 API Key" });
const TAVERN_JUDGE_HELP = Object.freeze({
	provider: "用哪家的服务；OpenAI 按用量另外计费，不含在 ChatGPT / Codex 订阅里。",
	baseUrl: "服务的网址，填根地址或以 /v1 结尾的地址。",
	key: "这里支持两种填法：1. 直接粘贴 API Key，最直观；2. 填环境变量的准确名称，从这个环境变量读取。",
	threshold: "判断的把握达到这个值才补进，越高补得越少。",
	capPerKind: "每类最多补进几条；蓝灯和触发词命中的不算。",
	timeoutMs: "等这么久还没结果，这一轮就只按触发词。",
	preamble: "随剧情一起发给判断模型的说明；一般留空效果更好。"
});
function tavernJudgeWithProvider(config, provider) {
	const preset = TAVERN_JUDGE_PROVIDERS[provider];
	return { ...config, provider, enabled: preset ? true : config.enabled, model: preset ? preset.model : "", keyName: preset ? preset.keyName : "", baseUrl: provider === "openai-compatible" ? config.baseUrl : "" };
}
function tavernJudgeUrlProblem(text) {
	if (!text) return "请填写接口地址";
	let url = null; try { url = new URL(text); } catch (_) {}
	if (!url || !["http:", "https:"].includes(url.protocol)) return "请填写 http(s) 地址";
	return url.username || url.password || url.search || url.hash ? "地址里不能带账号、参数或 #" : "";
}
// What keeps the draft from being saved or tested.
function tavernJudgeProblem(config) {
	if (config.provider === "unset") return "";
	if (config.provider === "openai-compatible" && tavernJudgeUrlProblem(config.baseUrl)) return tavernJudgeUrlProblem(config.baseUrl);
	return config.model.trim() ? "" : "请填写模型";
}
const tavernJudgeErrorText = (error, fallback) => TAVERN_JUDGE_ERRORS[error && error.code] || TAVERN_JUDGE_ERRORS[error && error.message] || tavernAssetErrorText(error, fallback);
const tavernSameValues = (a, b) => !!a && !!b && Object.keys({ ...a, ...b }).every(key => a[key] === b[key]);
// Draft parsers: { value } or { problem }.
const tavernNumberIn = (min, max, integer, problem) => text => {
	const value = Number(text.trim());
	return text.trim() && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? { value } : { problem };
};
const tavernTextValue = check => text => (problem => problem ? { problem } : { value: text.trim() })(check ? check(text.trim()) : "");
const tavernStageGroupState = (on, total) => on === total ? "全部" : on === 0 ? "全部关闭" : "部分 " + on + "/" + total;
const tavernStageCapProblem = text => /^\d{1,3}$/.test(text) && Number(text) >= 1 && Number(text) <= 256 ? "" : "请填写 1–256 的整数";

// One row per group: its name in the label column, 「全部 ⌄」 as the value, unfolding to its chips. A chip saves at once.
function TavernStageCommandGroup(props) {
	const h = React.createElement, [open, setOpen] = React.useState(false);
	const on = props.items.filter(([key]) => props.isOn(key)).length, state = tavernStageGroupState(on, props.items.length);
	return h("div", { className: "dsh-tavern-mode-group", "data-open": open || undefined },
		h("button", { type: "button", className: "dsh-tavern-mode-group-toggle", "aria-expanded": open, "aria-controls": props.bodyId, onClick: () => setOpen(!open) },
			h("span", { className: "dsh-tavern-mode-group-name" }, props.group),
			h("span", { className: "dsh-tavern-mode-group-value" },
				h("span", { className: "dsh-tavern-mode-group-state", "data-partial": on < props.items.length || undefined }, state),
				h(TavernAssetGlyph, { name: "chevDown" }))),
		// The chips stay in the tree while folded (hidden).
		h("div", { className: "dsh-tavern-mode-chips", id: props.bodyId, role: "group", "aria-label": props.group, hidden: !open || undefined },
			props.items.map(([key, label]) => {
				const checked = props.isOn(key);
				return h("button", { key, type: "button", role: "checkbox", "aria-checked": checked, className: "dsh-tavern-mode-chip", disabled: props.disabled, onClick: () => props.onToggle(key, !checked) },
					checked ? h(TavernAssetGlyph, { name: "check" }) : null, h("span", null, label));
			})));
}

// A field of the page draft: a valid value joins the draft as it is typed (`parse` → { value } or { problem }); a bad one
// shows its reason on Enter or blur, and Esc on a bad value puts the draft's value back.
function TavernStageModeField(props) {
	const h = React.createElement, shown = String(props.value ?? ""), [text, setText] = React.useState(shown), [problem, setProblem] = React.useState("");
	React.useEffect(() => { if (props.parse(text).value !== props.value) setText(shown); setProblem(""); }, [props.value]);
	const change = value => { setText(value); const parsed = props.parse(value); if (!parsed.problem) { setProblem(""); if (parsed.value !== props.value) props.onCommit(parsed.value); } };
	const commit = () => setProblem(props.parse(text).problem || "");
	return h("div", { className: "dsh-tavern-mode-field" + (props.multiline ? " is-wide" : "") },
		h("span", { className: "dsh-tavern-mode-label" }, h("label", { htmlFor: props.id }, props.label), props.help ? h(TavernAssetHelp, { label: props.label, text: props.help }) : null),
		h("span", { className: "dsh-tavern-mode-value" },
			h(props.multiline ? "textarea" : "input", { id: props.id, className: props.multiline ? "dsh-tavern-mode-textarea" : props.wide ? "dsh-tavern-mode-text" : "dsh-tavern-mode-number",
				type: props.multiline ? undefined : "text", rows: props.multiline ? 3 : undefined, inputMode: props.inputMode, "aria-label": props.controlLabel || props.label, "aria-invalid": problem ? true : undefined,
				value: text, placeholder: props.placeholder, maxLength: props.maxLength, spellCheck: props.wide ? false : undefined, disabled: props.disabled, onChange: event => change(event.target.value), onBlur: commit,
				onKeyDown: event => { if (event.key === "Enter" && !props.multiline) { event.preventDefault(); commit(); } else if (event.key === "Escape" && problem) { event.preventDefault(); event.stopPropagation(); setText(shown); setProblem(""); } } }),
			props.unit ? h("span", { className: "dsh-tavern-mode-unit" }, props.unit) : null,
			problem ? h("span", { className: "dsh-tavern-mode-problem", role: "alert" }, h(TavernAssetGlyph, { name: "warning" }), problem) : null));
}
const tavernCapValue = text => tavernStageCapProblem(text.trim()) ? { problem: tavernStageCapProblem(text.trim()) } : { value: Number(text) };

// 「提供方」: a menu of 未设置 and the providers.
function TavernJudgeProvider(props) {
	const h = React.createElement, options = [["unset", "未设置"], ...Object.entries(TAVERN_JUDGE_PROVIDERS).map(([value, preset]) => [value, preset.label])];
	const label = (options.find(([value]) => value === props.value) || options[0])[1];
	return h("div", { className: "dsh-tavern-mode-field" },
		h("span", { className: "dsh-tavern-mode-label" }, h("span", null, "提供方"), h(TavernAssetHelp, { label: "提供方", text: TAVERN_JUDGE_HELP.provider })),
		h("span", { className: "dsh-tavern-mode-value" }, h(TavernAssetMenu, { label: "提供方", alignLeft: true,
			trigger: menu => h("button", { type: "button", className: "dsh-tavern-mode-pick", "aria-haspopup": "menu", "aria-expanded": menu.open, "aria-label": "提供方：" + label, disabled: props.disabled, onClick: menu.toggle },
				h("span", null, label), h(TavernAssetGlyph, { name: "chevDown" })),
			content: close => options.map(([value, text]) => h(TavernAssetMenuItem, { key: value, checked: props.value === value, onClick: () => { close(); if (value !== props.value) props.onChange(value); } }, text)) })));
}
// 「API Key」: one masked box for either form; the host tells them apart and saves at once (never through the draft).
// Configured: 「已配置」 (a stored key: 更换 / 清除) or 「已配置 · 环境变量 NAME」 (更换). The key never comes back; a failed
// save keeps the typed text with its reason. `trail` is the row's 测试连接.
function TavernJudgeKey(props) {
	const h = React.createElement, [status, setStatus] = React.useState(null), [loadError, setLoadError] = React.useState("");
	const [editing, setEditing] = React.useState(false), [saving, setSaving] = React.useState(false), [error, setError] = React.useState(""), [text, setText] = React.useState("");
	React.useEffect(() => {
		let live = true;
		setStatus(null); setLoadError("");
		rpc("getJudgeCredentialStatus", { provider: props.provider, keyName: props.keyName }).then(value => { if (live) setStatus(value); },
			err => { if (live) setLoadError(tavernJudgeErrorText(err, "读取 API Key 状态失败")); });
		return () => { live = false; };
	}, [props.provider, props.keyName]);
	async function save(value) {
		if (value !== null && !/^[\x21-\x7e]{1,4096}$/.test(value)) { setError(value ? "API Key 不能含空格或中文" : ""); return; }
		setSaving(true); setError("");
		try { setStatus(await props.onSave(value)); setEditing(false); setText(""); }
		catch (err) { setError(tavernJudgeErrorText(err, "保存失败")); }
		finally { setSaving(false); }
	}
	const head = h("span", { className: "dsh-tavern-mode-label" }, h("label", { htmlFor: "dsh-tavern-judge-key" }, "API Key"), h(TavernAssetHelp, { label: "API Key", text: TAVERN_JUDGE_HELP.key }));
	const problem = error || loadError ? h("span", { className: "dsh-tavern-mode-problem", role: "alert" }, h(TavernAssetGlyph, { name: "warning" }), error || loadError) : null;
	const row = children => h("div", { className: "dsh-tavern-mode-field" }, head, h("span", { className: "dsh-tavern-mode-value" }, ...children, problem, props.trail));
	if (!status && !loadError) return row([h("span", { className: "dsh-tavern-mode-hint", role: "status" }, "正在读取…")]);
	if (status && status.configured && !editing) return row([
		h("span", { className: "dsh-tavern-mode-key" }, status.source === "stored" ? "已配置" : "已配置 · 环境变量 " + (status.keyName || "")),
		h("button", { type: "button", className: "dsh-tavern-mode-link", disabled: props.disabled || saving, onClick: () => setEditing(true) }, "更换"),
		status.source === "stored" ? h("button", { type: "button", className: "dsh-tavern-mode-link", disabled: props.disabled || saving, onClick: () => save(null) }, "清除") : null]);
	return row([
		h("input", { id: "dsh-tavern-judge-key", className: "dsh-tavern-mode-text", type: "password", autoComplete: "off", spellCheck: false, maxLength: 4096, placeholder: "粘贴 API Key 或环境变量名",
			"aria-label": "API Key", "aria-invalid": error ? true : undefined, value: text, disabled: props.disabled || saving,
			onChange: event => { setText(event.target.value); setError(""); }, onBlur: () => { if (text) save(text); },
			onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); if (text) save(text); } } }),
		saving ? h("span", { className: "dsh-tavern-mode-hint", role: "status" }, "正在保存…") : null,
		editing ? h("button", { type: "button", className: "dsh-tavern-mode-link", onMouseDown: event => event.preventDefault(), onClick: () => { setEditing(false); setError(""); setText(""); } }, "取消") : null]);
}
function TavernJudgeTestResult(props) {
	const h = React.createElement, result = props.result;
	if (!result) return null;
	if (result.running) return h("span", { className: "dsh-tavern-mode-hint", role: "status" }, "正在测试…");
	const ms = Number.isFinite(result.latencyMs) ? " · " + Math.round(result.latencyMs) + " 毫秒" : "";
	if (result.ok) return h("span", { className: "dsh-tavern-mode-test is-ok", role: "status" }, h(TavernAssetGlyph, { name: "check" }), "连接成功" + ms);
	return h("span", { className: "dsh-tavern-mode-problem", role: "alert" }, h(TavernAssetGlyph, { name: "warning" }),
		(result.failure || TAVERN_JUDGE_ERRORS[result.error && result.error.code] || "连接失败") + ms);
}
// 舞台模式 › 判断模型: 提供方 → (接口地址) → 模型 → API Key with 测试连接 at the end of its row, then 门槛 / 每类上限 / 超时 /
// 附加说明. `onPatch` merges into the draft's judge and clears the last test; 测试连接 sends the unsaved draft.
function TavernJudgeFields(props) {
	const h = React.createElement, config = props.config, set = config.provider !== "unset", problem = tavernJudgeProblem(config);
	const [test, setTest] = React.useState(null), run = React.useRef(0);
	const patch = value => { run.current++; setTest(null); props.onPatch(value); };
	async function runTest() {
		if (problem) return;
		const mine = ++run.current; setTest({ running: true });
		let result; try { result = await rpc("testJudgeConnection", { config }); } catch (err) { result = { ok: false, failure: tavernJudgeErrorText(err, "连接失败") }; }
		if (mine === run.current) setTest(result);
	}
	const field = (key, label, parse, extra) => h(TavernStageModeField, { key, id: "dsh-tavern-judge-" + key, label, help: TAVERN_JUDGE_HELP[key], value: config[key], parse, disabled: props.disabled,
		onCommit: value => patch({ [key]: value }), ...extra });
	return h("div", { className: "dsh-tavern-mode-fields" },
		h(TavernJudgeProvider, { value: config.provider, disabled: props.disabled, onChange: value => patch(tavernJudgeWithProvider(config, value)) }),
		set && config.provider === "openai-compatible" ? field("baseUrl", "接口地址", tavernTextValue(tavernJudgeUrlProblem), { wide: true, placeholder: "https://…/v1" }) : null,
		set ? field("model", "模型", tavernTextValue(value => value ? "" : "请填写模型"), { wide: true, help: undefined }) : null,
		set ? h(TavernJudgeKey, { key: config.provider, provider: config.provider, keyName: config.keyName, disabled: props.disabled, onSave: props.onSaveKey,
			trail: h("span", { className: "dsh-tavern-mode-trail" },
				h("button", { type: "button", className: "dsh-tavern-mode-secondary", disabled: props.disabled || (test && test.running) || !!problem, onClick: runTest }, "测试连接"),
				h(TavernJudgeTestResult, { result: test })) }) : null,
		field("threshold", "门槛", tavernNumberIn(0, 1, false, "请填写 0–1 之间的数"), { inputMode: "decimal" }),
		field("capPerKind", "每类上限", tavernNumberIn(0, 300, true, "请填写 0–300 的整数"), { inputMode: "numeric", unit: "条" }),
		field("timeoutMs", "超时", tavernNumberIn(1, 120000, true, "请填写 1–120000 的整数"), { inputMode: "numeric", unit: "毫秒" }),
		field("preamble", "附加说明", text => ({ value: text }), { multiline: true, maxLength: 4000, placeholder: "无" }));
}

function TavernStageModeSection(props) {
	const h = React.createElement;
	return h("section", { className: "dsh-tavern-mode-section", "aria-label": props.title },
		h("header", { className: "dsh-tavern-stage-section-head" }, h("h3", null, props.title), h(TavernAssetHelp, { label: props.title, text: props.help }),
			props.meta ? h("span", { className: "dsh-tavern-mode-meta" }, props.meta) : null,
			props.status ? h("span", { className: "dsh-tavern-stage-save-state", role: "status" }, props.status) : null),
		props.children);
}

function TavernStageModePage(props) {
	const h = React.createElement;
	const [settings, setSettings] = React.useState(null), [error, setError] = React.useState(""), [attempt, setAttempt] = React.useState(0);
	const [caps, setCaps] = React.useState(null), [judge, setJudge] = React.useState(null), [busy, setBusy] = React.useState(false), [chipState, setChipState] = React.useState("");
	// A saved draft disables 「保存」; the focus stays on the page so Esc still leaves.
	const root = React.useRef(null);
	React.useEffect(() => {
		let live = true;
		setError("");
		rpc("getTavernSettings").then(result => { if (live) { setSettings(result.settings); setCaps(result.settings.stageActionCaps); setJudge(result.settings.stageJudge); } },
			err => { if (live) setError(tavernAssetErrorText(err, "读取舞台模式设置失败")); });
		return () => { live = false; };
	}, [attempt]);
	const dirty = !!settings && !!caps && !!judge && (!tavernSameValues(caps, settings.stageActionCaps) || !tavernSameValues(judge, settings.stageJudge));
	const judgeProblem = judge ? tavernJudgeProblem(judge) : "";
	// The panel's Esc leaves like ‹, but never drops an unsaved draft.
	if (props.dirty) props.dirty.current = dirty;
	async function write(patch) {
		const result = await rpc("updateTavernSettings", { patch });
		window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
		return result.settings;
	}
	// A chip keeps the unsaved draft.
	async function toggle(key, value) {
		setBusy(true); setChipState("正在保存…"); setError("");
		try { setSettings(await write({ stageDimensions: { [key]: value } })); setChipState("已保存"); }
		catch (err) { setChipState(""); setError(tavernAssetErrorText(err, "保存失败")); }
		finally { setBusy(false); }
	}
	// The API Key saves at once. A variable-name reference also saved the judge's keyName: the draft takes it and keeps the rest.
	async function saveKey(value) {
		const result = await rpc("setJudgeKey", { provider: judge.provider, value });
		if (result.settings) { setSettings(result.settings); setJudge(current => ({ ...current, keyName: result.settings.stageJudge.keyName })); window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed")); }
		return result.status;
	}
	async function save() {
		if (judgeProblem) return;
		setBusy(true); setError("");
		try { const next = await write({ stageActionCaps: caps, stageJudge: judge }); setSettings(next); setCaps(next.stageActionCaps); setJudge(next.stageJudge); root.current?.focus?.({ preventScroll: true }); }
		catch (err) { setError(tavernAssetErrorText(err, "保存失败")); }
		finally { setBusy(false); }
	}
	const alert = h(TavernAssetAlert, { error, onReload: settings ? null : () => setAttempt(attempt + 1) });
	if (!settings) return h("div", { className: "dsh-tavern-mode" }, error ? alert : h(TavernAssetLoading, { count: 4 }));
	const dims = settings.stageDimensions || {}, shown = TAVERN_STAGE_COMMAND_GROUPS.flatMap(([, items]) => items.map(([key]) => key));
	const onCount = shown.filter(key => dims[key] !== false).length;
	return h("div", { className: "dsh-tavern-mode", ref: root, tabIndex: -1 },
		h(TavernStageModeSection, { title: "判断模型", help: TAVERN_STAGE_MODE_HELP.judge },
			h(TavernJudgeFields, { config: judge, disabled: busy, onSaveKey: saveKey, onPatch: value => setJudge(current => ({ ...current, ...value })) })),
		h(TavernStageModeSection, { title: "可用演出", help: TAVERN_STAGE_MODE_HELP.commands, meta: onCount + " / " + shown.length, status: chipState },
			h("div", { className: "dsh-tavern-mode-groups" }, TAVERN_STAGE_COMMAND_GROUPS.map(([group, items], index) => h(TavernStageCommandGroup,
				{ key: group, group, items, bodyId: "dsh-tavern-mode-group-" + index, isOn: key => dims[key] !== false, disabled: busy, onToggle: toggle })))),
		h(TavernStageModeSection, { title: "每轮上限", help: TAVERN_STAGE_MODE_HELP.caps },
			TAVERN_STAGE_CAPS.map(([key, label, unit]) => h(TavernStageModeField, { key, id: "dsh-tavern-mode-cap-" + key, label, unit, value: caps[key], disabled: busy,
				controlLabel: label + " 每轮上限", inputMode: "numeric", parse: tavernCapValue, onCommit: value => setCaps({ ...caps, [key]: value }) }))),
		alert,
		// Sticky while there is something to save, so 「保存」 is reachable from anywhere on the page.
		h("div", { className: "dsh-tavern-mode-foot", "data-dirty": dirty || undefined },
			h("span", { className: "dsh-tavern-mode-save-state", role: "status", "data-problem": dirty && judgeProblem ? true : undefined },
				dirty && judgeProblem ? [h(TavernAssetGlyph, { key: "mark", name: "warning" }), judgeProblem] : dirty ? "有未保存的修改" : ""),
			h("button", { type: "button", className: "dsh-tavern-asset-primary", disabled: busy || !dirty || !!judgeProblem, onClick: save }, "保存")));
}
