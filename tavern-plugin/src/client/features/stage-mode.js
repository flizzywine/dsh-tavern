// 舞台设置 › 舞台模式 ›: what every card's director may use (tavern settings stageDimensions, 「可用演出」) and how often
// one reply may use it (stageActionCaps, 「每轮上限」). The director reads both when a turn starts (stage-director.js).
// 可用演出 chips save at once; 每轮上限 is a draft saved by 「保存」, and Esc never drops an unsaved draft.
const TAVERN_STAGE_COMMAND_GROUPS = Object.freeze([
	["场景与转场", [["scene", "场景"]]],
	["人物", [["cast", "出场"], ["acts", "动作"]]],
	["效果", [["screenEffects", "画面效果"]]]
]);
const TAVERN_STAGE_CAPS = Object.freeze([["beat", "画面效果", "次"]]);
const TAVERN_STAGE_MODE_HELP = Object.freeze({
	page: "这一页的设置所有卡共用。",
	commands: "导演可以用哪些演出，所有卡通用，点选立即保存。",
	caps: "每轮回复里最多用几次，免得画面一直闪。"
});
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

// A whole number with its unit: a valid value joins the draft as it is typed; a bad one shows its reason on Enter or blur.
function TavernStageCapField(props) {
	const h = React.createElement, [text, setText] = React.useState(String(props.value)), [problem, setProblem] = React.useState("");
	React.useEffect(() => { if (Number(text) !== props.value) setText(String(props.value)); setProblem(""); }, [props.value]);
	const change = value => { setText(value); if (!tavernStageCapProblem(value.trim())) { setProblem(""); if (Number(value) !== props.value) props.onCommit(Number(value)); } };
	const commit = () => setProblem(tavernStageCapProblem(text.trim()));
	return h("div", { className: "dsh-tavern-mode-field" },
		h("label", { className: "dsh-tavern-mode-label", htmlFor: props.id }, props.label),
		h("span", { className: "dsh-tavern-mode-value" },
			h("input", { id: props.id, className: "dsh-tavern-mode-number", type: "text", inputMode: "numeric", "aria-label": props.label + " 每轮上限", "aria-invalid": problem ? true : undefined,
				value: text, disabled: props.disabled, onChange: event => change(event.target.value), onBlur: commit,
				onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); commit(); } else if (event.key === "Escape" && problem) { event.preventDefault(); setText(String(props.value)); setProblem(""); } } }),
			h("span", { className: "dsh-tavern-mode-unit" }, props.unit),
			problem ? h("span", { className: "dsh-tavern-mode-problem", role: "alert" }, h(TavernAssetGlyph, { name: "warning" }), problem) : null));
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
	const [caps, setCaps] = React.useState(null), [busy, setBusy] = React.useState(false), [chipState, setChipState] = React.useState("");
	// A saved draft disables 「保存」; the focus stays on the page so Esc still leaves.
	const root = React.useRef(null);
	React.useEffect(() => {
		let live = true;
		setError("");
		rpc("getTavernSettings").then(result => { if (live) { setSettings(result.settings); setCaps(result.settings.stageActionCaps); } },
			err => { if (live) setError(tavernAssetErrorText(err, "读取舞台模式设置失败")); });
		return () => { live = false; };
	}, [attempt]);
	const dirty = !!settings && !!caps && JSON.stringify(caps) !== JSON.stringify(settings.stageActionCaps);
	// The panel's Esc leaves like ‹, but never drops an unsaved draft.
	if (props.dirty) props.dirty.current = dirty;
	async function write(patch) {
		const result = await rpc("updateTavernSettings", { patch });
		window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
		return result.settings;
	}
	// A chip keeps the unsaved 每轮上限 draft.
	async function toggle(key, value) {
		setBusy(true); setChipState("正在保存…"); setError("");
		try { setSettings(await write({ stageDimensions: { [key]: value } })); setChipState("已保存"); }
		catch (err) { setChipState(""); setError(tavernAssetErrorText(err, "保存失败")); }
		finally { setBusy(false); }
	}
	async function save() {
		setBusy(true); setError("");
		try { const next = await write({ stageActionCaps: caps }); setSettings(next); setCaps(next.stageActionCaps); root.current?.focus?.({ preventScroll: true }); }
		catch (err) { setError(tavernAssetErrorText(err, "保存失败")); }
		finally { setBusy(false); }
	}
	const alert = h(TavernAssetAlert, { error, onReload: settings ? null : () => setAttempt(attempt + 1) });
	if (!settings) return h("div", { className: "dsh-tavern-mode" }, error ? alert : h(TavernAssetLoading, { count: 4 }));
	const dims = settings.stageDimensions || {}, shown = TAVERN_STAGE_COMMAND_GROUPS.flatMap(([, items]) => items.map(([key]) => key));
	const onCount = shown.filter(key => dims[key] !== false).length;
	return h("div", { className: "dsh-tavern-mode", ref: root, tabIndex: -1 },
		h(TavernStageModeSection, { title: "可用演出", help: TAVERN_STAGE_MODE_HELP.commands, meta: onCount + " / " + shown.length, status: chipState },
			h("div", { className: "dsh-tavern-mode-groups" }, TAVERN_STAGE_COMMAND_GROUPS.map(([group, items], index) => h(TavernStageCommandGroup,
				{ key: group, group, items, bodyId: "dsh-tavern-mode-group-" + index, isOn: key => dims[key] !== false, disabled: busy, onToggle: toggle })))),
		h(TavernStageModeSection, { title: "每轮上限", help: TAVERN_STAGE_MODE_HELP.caps },
			TAVERN_STAGE_CAPS.map(([key, label, unit]) => h(TavernStageCapField, { key, id: "dsh-tavern-mode-cap-" + key, label, unit, value: caps[key], disabled: busy,
				onCommit: value => setCaps({ ...caps, [key]: value }) }))),
		alert,
		// Sticky while there is something to save, so 「保存」 is reachable from anywhere on the page.
		h("div", { className: "dsh-tavern-mode-foot", "data-dirty": dirty || undefined },
			h("span", { className: "dsh-tavern-mode-save-state", role: "status" }, dirty ? "有未保存的修改" : ""),
			h("button", { type: "button", className: "dsh-tavern-asset-primary", disabled: busy || !dirty, onClick: save }, "保存")));
}
