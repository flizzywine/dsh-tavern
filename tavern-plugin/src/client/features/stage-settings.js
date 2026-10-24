// The stage has three right-panel pages, one home per concern, listed on the start page under 「其他」:
// 舞台设置 (基础设置: the switches), 舞台素材 (the card's cast material) and 配音 (the voicing service, the same page as
// 设置 › 配音). 酒馆状态 only opens the stage; the fullscreen stage has no settings of its own.
const TAVERN_STAGE_TABS = Object.freeze({ settings: "dsh-tavern:stage-settings", materials: "dsh-tavern:stage-materials", voice: "dsh-tavern:voice" });
const TAVERN_STAGE_NAMES = Object.freeze({ dialogue: "对话气泡", voice: "配音", stage: "舞台模式", music: "BGM", sfx: "音效", ambience: "环境音", items: "物品", entrance: "入场演出" });
// Every switch needs its upstream switches on, as in the reference design: 配音 and 舞台模式 need 对话气泡; sounds play on the stage.
const TAVERN_STAGE_REQUIRES = Object.freeze({ dialogue: [], voice: ["dialogue"], stage: ["dialogue"], music: ["dialogue", "stage"], sfx: ["dialogue", "stage"], ambience: ["dialogue", "stage"], items: ["dialogue", "stage"], entrance: ["dialogue", "stage"] });
const TAVERN_STAGE_GLYPHS = Object.freeze({
	bubble: "M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z",
	voice: "M2.5 6h2.5l3-2.5v9L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.2 3.8a6 6 0 0 1 0 8.4",
	stage: "M2 2.5h12M3 2.5v11M13 2.5v11M3 2.5c0 3.5 2 5 4 5.5M13 2.5c0 3.5-2 5-4 5.5M2 13.5h12",
	chevRight: "M6 4l4 4-4 4", back: "M10 4 6 8l4 4",
	music: "M6 12V3.5l7-1.5v8.5M6 12a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0zM13 10.5a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z",
	sfx: "M2.5 8h1.5M5.5 5.5v5M8 3v10M10.5 5v6M13 7v2",
	ambience: "M3.5 9.5a2.5 2.5 0 0 1 .3-5 3.5 3.5 0 0 1 6.7-.6 2.5 2.5 0 0 1 1.5 5.6zM5.5 11.5l-.75 2M8.5 11.5l-.75 2M11.5 11.5l-.75 2",
	item: "M3.5 5.5h9l-.8 8h-7.4zM6 5.5v-1a2 2 0 0 1 4 0v1",
	entrance: "M8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4",
	prev: "M4 3.5v9M12.5 3.5 6 8l6.5 4.5z", next: "M12 3.5v9M3.5 3.5 10 8l-6.5 4.5z", play: "M5 3.5v9l7.5-4.5z", pause: "M5.5 3.5v9M10.5 3.5v9"
});
function TavernStageGlyph(props) {
	return React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
		React.createElement("path", { d: TAVERN_STAGE_GLYPHS[props.name], stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" }));
}
// Panel icons take `icon(size)` (the tab chip) or `{ size }` (the start page).
function tavernStageTabIcon(draw) {
	return function (input) { const size = typeof input === "number" ? input : input && input.size || 16; return draw(size); };
}
const TAVERN_STAGE_TAB_ICONS = {
	settings: tavernStageTabIcon(s => React.createElement("svg", { width: s, height: s, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
		React.createElement("rect", { x: 1.5, y: 2.5, width: 4, height: 4, rx: 1.2, stroke: "currentColor", strokeWidth: 1.2 }),
		React.createElement("path", { d: "M7.5 3.5h6.5M7.5 6h4.5M1.5 10.5h13M1.5 13h9", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" }))),
	materials: DshUi && DshUi.IconArchiveOutlineRegular ? tavernStageTabIcon(s => React.createElement(DshUi.IconArchiveOutlineRegular, { size: s, width: s, height: s })) : undefined,
	voice: tavernStageTabIcon(s => React.createElement("svg", { width: s, height: s, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
		React.createElement("path", { d: "M2.5 6.5v3M5.25 4.5v7M8 2.5v11M10.75 5v6M13.5 6.5v3", stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" })))
};

// Icon + short name + switch. A dependent switch is disabled while what it needs is off and only then carries a 「?」.
// A row with a page of its own (`onOpen`) opens it from anywhere but the switch; its 「›」 (`status`) is the keyboard route.
function tavernStageRowClick(open) {
	return function (event) {
		const target = event.target;
		if (!event.currentTarget.contains(target) || target.closest && target.closest("button,a,input,select,label")) return;
		open(event.currentTarget);
	};
}
function TavernStageSwitchRow(props) {
	const h = React.createElement;
	const toggle = h("input", { type: "checkbox", role: "switch", "aria-label": props.label, checked: props.checked === true, disabled: props.disabled === true, onChange: event => props.onChange(event.target.checked) });
	const name = h("span", { className: "dsh-tavern-switch-name" }, props.icon ? h(TavernStageGlyph, { name: props.icon }) : null, h("span", null, props.label),
		props.help ? h("span", { className: "dsh-tavern-switch-help", role: "img", "aria-label": props.label + " 说明：" + props.help, title: props.help }, "?") : null);
	if (!props.onOpen) return h("div", { className: "dsh-tavern-switch-row", "data-disabled": props.disabled || undefined }, h("label", { className: "dsh-tavern-switch-main" }, toggle, name, props.status || null));
	return h("div", { className: "dsh-tavern-switch-row is-openable", "data-disabled": props.disabled || undefined, onClick: tavernStageRowClick(props.onOpen) },
		h("div", { className: "dsh-tavern-switch-main" }, h("label", { className: "dsh-tavern-switch-hit" }, toggle), name, props.status || null));
}
function tavernStageJump(label, onClick, ref) {
	return React.createElement("button", { type: "button", ref, className: "dsh-tavern-switch-jump", "aria-label": label, title: label, onClick }, React.createElement(TavernStageGlyph, { name: "chevRight" }));
}

// The way back from 配音 to the 舞台设置 that opened it (kept ten minutes, like the reference design's return intent).
const tavernStageReturn = (function () {
	let value = null;
	const listeners = new Set();
	return {
		set(next) { value = next ? { ...next, at: Date.now() } : null; listeners.forEach(listener => listener()); },
		get() { return value && Date.now() - value.at < 600000 ? value : null; },
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
	};
})();

// The global switches: 对话气泡 is the tavern setting castPresentation, 配音 the voicing service's own switch and
// 舞台模式 the tavern setting stageToggles.stage. All of them apply to every card.
function useTavernStageGlobals() {
	const [settings, setSettings] = React.useState(null);
	React.useEffect(() => {
		let live = true;
		const load = () => rpc("getTavernSettings").then(result => { if (live) setSettings(result.settings); }, () => {});
		load();
		window.addEventListener("dsh-tavern-settings-changed", load);
		return () => { live = false; window.removeEventListener("dsh-tavern-settings-changed", load); };
	}, []);
	return [settings, setSettings];
}

// 舞台设置 › 基础设置 in the reference order: 对话气泡, 配音 ›, 舞台模式, 默认皮肤 (本卡皮肤), BGM, 音效, 环境音, 物品, 入场演出; 舞台样式 joins when a plugin offers stage views.
// Every switch saves at once; the section head says 正在保存… / 已保存.
function TavernStageSwitches(props) {
	const h = React.createElement;
	const [settings, setSettings] = useTavernStageGlobals();
	const speech = useTavernSpeechSettings();
	const choice = useTavernStageView(props.sessionId);
	const [status, setStatus] = React.useState("idle"), [error, setError] = React.useState("");
	async function save(job) {
		setStatus("saving"); setError("");
		try { await job(); setStatus("saved"); }
		catch (err) { setStatus("idle"); setError(String(err && err.message || err)); }
	}
	const prefs = { dialogue: settings ? settings.castPresentation === true : false, voice: Boolean(speech && speech.enabled), stage: settings ? settings.stageToggles?.stage !== false : false,
		music: settings ? settings.stageToggles?.music !== false : true, sfx: settings ? settings.stageToggles?.sfx !== false : true,
		ambience: settings ? settings.stageToggles?.ambience !== false : true, items: settings ? settings.stageToggles?.items !== false : true,
		entrance: settings ? settings.stageToggles?.entrance !== false : true };
	const busy = status === "saving", blocked = key => TAVERN_STAGE_REQUIRES[key].filter(need => !prefs[need]);
	const help = key => blocked(key).length ? "需要" + blocked(key).map(need => TAVERN_STAGE_NAMES[need]).join("和") : undefined;
	const setTavern = patch => save(async () => {
		const result = await rpc("updateTavernSettings", { patch });
		setSettings(result.settings);
		window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
		await tavernStageRuntime.refresh(props.sessionId);
	});
	const setDialogue = on => setTavern({ castPresentation: on });
	const setVoice = on => save(async () => {
		tavernSpeechSettings.set(await rpc("updateSpeechSettings", { enabled: on }));
		window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
	});
	const setStage = on => setTavern({ stageToggles: { stage: on } });
	// BGM on: the stage plays music and the director may choose it; off: neither, for every card.
	const setMusic = on => setTavern({ stageToggles: { music: on } });
	// 音效 on: the director may play a sound of the card's packs on its page; off: none is offered or played, for every card.
	const setSfx = on => setTavern({ stageToggles: { sfx: on } });
	// 环境音 on: the director may keep a loop of the card's packs for the place or weather; off: none is offered or played, for every card.
	const setAmbience = on => setTavern({ stageToggles: { ambience: on } });
	// 物品 on: the director may show an item of the card's packs on its page; off: none is offered or shown, for every card.
	const setItems = on => setTavern({ stageToggles: { items: on } });
	// 入场演出 on: a card whose own packs hold an entrance (蓝灯) opens its stage with it; off: no stage opens with one.
	const setEntrance = on => setTavern({ stageToggles: { entrance: on } });
	const openVoice = props.openTab ? () => { tavernStageReturn.set({ toTab: TAVERN_STAGE_TABS.settings, label: "返回舞台设置" }); props.openTab(TAVERN_STAGE_TABS.voice); } : null;
	// 舞台模式 › opens its page in this panel; coming back puts the focus on this 「›」.
	const modeJump = React.useRef(null);
	React.useEffect(() => { if (props.returned && props.returned.current) { props.returned.current = false; modeJump.current?.focus?.(); } }, []);
	// BGM ›: the music of this card's packs, opened in 舞台素材 (‹ comes back here).
	const musicPacks = useTavernKindPacks(props.path, "music");
	const openMusic = props.openTab ? pack => tavernStageOpenPack(props.openTab, pack.manifest.id, "music") : null;
	// 音效 ›: the sound effects of this card's packs, the same way.
	const sfxPacks = useTavernKindPacks(props.path, "sfx");
	const openSfx = props.openTab ? pack => tavernStageOpenPack(props.openTab, pack.manifest.id, "sfx") : null;
	// 环境音 ›: the ambience of this card's packs, the same way.
	const ambiencePacks = useTavernKindPacks(props.path, "ambience");
	const openAmbience = props.openTab ? pack => tavernStageOpenPack(props.openTab, pack.manifest.id, "ambience") : null;
	// 物品 ›: the items of this card's packs, the same way.
	const itemPacks = useTavernKindPacks(props.path, "props");
	const openItems = props.openTab ? pack => tavernStageOpenPack(props.openTab, pack.manifest.id, "props") : null;
	// 入场演出 ›: the entrances of this card's own packs.
	const entrancePacks = useTavernKindPacks(props.path, "entrances", true);
	const openEntrances = props.openTab ? pack => tavernStageOpenPack(props.openTab, pack.manifest.id, "entrances") : null;
	return h("section", { className: "dsh-tavern-stage-section", "aria-label": "基础设置" },
		h("header", { className: "dsh-tavern-stage-section-head" }, h("h3", null, "基础设置"),
			h("span", { className: "dsh-tavern-switch-help", role: "img", "aria-label": "基础设置 说明：这些开关对所有卡生效。", title: "这些开关对所有卡生效。" }, "?"),
			h("span", { className: "dsh-tavern-stage-save-state", role: "status" }, status === "saving" ? "正在保存…" : status === "saved" ? "已保存" : "")),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.dialogue, icon: "bubble", checked: prefs.dialogue, disabled: !settings || busy, onChange: setDialogue }),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.voice, icon: "voice", checked: prefs.voice, disabled: !speech || busy || blocked("voice").length > 0,
			help: help("voice"), onChange: setVoice,
			status: openVoice ? tavernStageJump("声音设置", openVoice) : null, onOpen: openVoice || undefined }),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.stage, icon: "stage", checked: prefs.stage, disabled: !settings || busy || blocked("stage").length > 0, help: help("stage"), onChange: setStage,
			status: props.onMode ? tavernStageJump("舞台模式设置", props.onMode, modeJump) : null, onOpen: props.onMode || undefined }),
		// 默认皮肤 and, with a card open, 本卡皮肤 (stage-skins.js), in the reference order after 舞台模式.
		h(TavernStageSkinRows, { path: props.path, sessionId: props.sessionId, save, busy }),
		// Sounds play on the stage: greyed (the stored value kept) while 舞台模式 is off.
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.music, icon: "music", checked: prefs.music, disabled: !settings || busy || blocked("music").length > 0, help: help("music"), onChange: setMusic,
			status: openMusic ? h(TavernStageKindJump, { label: TAVERN_STAGE_NAMES.music, packs: musicPacks, onPick: openMusic }) : null }),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.sfx, icon: "sfx", checked: prefs.sfx, disabled: !settings || busy || blocked("sfx").length > 0, help: help("sfx"), onChange: setSfx,
			status: openSfx ? h(TavernStageKindJump, { label: TAVERN_STAGE_NAMES.sfx, packs: sfxPacks, onPick: openSfx }) : null }),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.ambience, icon: "ambience", checked: prefs.ambience, disabled: !settings || busy || blocked("ambience").length > 0, help: help("ambience"), onChange: setAmbience,
			status: openAmbience ? h(TavernStageKindJump, { label: TAVERN_STAGE_NAMES.ambience, packs: ambiencePacks, onPick: openAmbience }) : null }),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.items, icon: "item", checked: prefs.items, disabled: !settings || busy || blocked("items").length > 0, help: help("items"), onChange: setItems,
			status: openItems ? h(TavernStageKindJump, { label: TAVERN_STAGE_NAMES.items, packs: itemPacks, onPick: openItems }) : null }),
		h(TavernStageSwitchRow, { label: TAVERN_STAGE_NAMES.entrance, icon: "entrance", checked: prefs.entrance, disabled: !settings || busy || blocked("entrance").length > 0, help: help("entrance"), onChange: setEntrance,
			status: openEntrances ? h(TavernStageKindJump, { label: TAVERN_STAGE_NAMES.entrance, packs: entrancePacks, onPick: openEntrances }) : null }),
		choice.views.length ? h("div", { className: "dsh-tavern-switch-row" }, h("label", { className: "dsh-tavern-switch-main" },
			h("span", { className: "dsh-tavern-switch-name" }, h("span", null, "舞台样式")), h(TavernStageViewSwitch, { choice }))) : null,
		error ? h("p", { role: "alert", className: "dsh-tavern-prompt-error" }, "保存失败：" + error) : null);
}

// The game a page belongs to: a subagent's panel shows its parent game; `path` is its card (the packs' states).
function useTavernStagePage(props, name) {
	const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
	const mode = useTavernSessionMode(owner);
	const stage = useTavernStageRuntime(owner);
	const path = useScopedLiveTavernView(owner, name, [["card", "path"]]).view?.card?.path || "";
	return { owner, play: isPlayMode(mode), stage, path };
}
function tavernStagePageBody(page, props, render) {
	const h = React.createElement;
	if (!page.play) return h("div", { className: "dsh-tavern-stage-nocard" }, h("p", null, "未打开人物卡"),
		props.openTab ? h("button", { type: "button", className: "dsh-tavern-btn", onClick: () => props.openTab("dsh-tavern:cards") }, "打开人物卡库") : null);
	if (!page.stage.data) return h("p", { role: page.stage.error ? "alert" : "status" }, page.stage.error ? "读取舞台设置失败：" + page.stage.error : "正在读取…");
	return render();
}
// `extra`: a sub-page's 「?」 (`help`), its title ref (focused on open) and its keys.
function tavernStagePanel(label, body, back, extra = {}) {
	const h = React.createElement;
	return h("aside", { className: "dsh-tavern-status dsh-local-settings dsh-tavern-stage-panel", "aria-label": label, onKeyDown: extra.onKeyDown },
		h("div", { className: "dsh-tavern-status-head" }, back || null, h("strong", extra.titleRef ? { ref: extra.titleRef, tabIndex: -1 } : null, label, extra.help || null)),
		h("div", { className: "dsh-tavern-status-body" }, body));
}

// A pack opened in 舞台素材 from 舞台设置 (BGM ›, …): its window starts at `kind`, with ‹ back to 舞台设置.
function tavernStageOpenPack(openTab, packId, kind) {
	tavernAssetNav.go({ packId, kind, back: { label: "舞台设置", open: () => openTab(TAVERN_STAGE_TABS.settings) } });
	openTab(TAVERN_STAGE_TABS.materials);
}

function TavernStageSettingsTab(props) {
	const h = React.createElement, page = useTavernStagePage(props, "stage-settings");
	// 舞台模式 ›: the page of the settings every card's director shares, in this panel with ‹ back (Esc too).
	const [view, setView] = React.useState("page"), returned = React.useRef(false), dirty = React.useRef(false), title = React.useRef(null);
	React.useEffect(() => { if (view === "mode") title.current?.focus?.({ preventScroll: true }); }, [view]);
	if (view === "mode") {
		const leave = () => { returned.current = true; dirty.current = false; setView("page"); };
		const keys = event => { if (event.key === "Escape" && !event.defaultPrevented && !dirty.current) { event.preventDefault(); leave(); } };
		const back = h("button", { type: "button", className: "dsh-tavern-stage-back", "aria-label": "返回舞台设置", title: "返回舞台设置", onClick: leave }, h(TavernStageGlyph, { name: "back" }));
		return tavernStagePanel("舞台模式", h(TavernStageModePage, { dirty }), back,
			{ help: h(TavernAssetHelp, { label: "舞台模式", text: TAVERN_STAGE_MODE_HELP.page }), titleRef: title, onKeyDown: keys });
	}
	return tavernStagePanel("舞台设置", tavernStagePageBody(page, props, () => React.createElement(React.Fragment, null,
		React.createElement(TavernStageSwitches, { sessionId: page.owner, path: page.path, openTab: props.openTab, onMode: () => setView("mode"), returned }),
		page.path ? React.createElement(TavernStagePacks, { path: page.path, openLibrary: props.openTab ? () => props.openTab(TAVERN_STAGE_TABS.materials) : null }) : null)));
}

// 舞台素材: the asset library (every pack: backgrounds and music; the states are the open card's, or 全局 / 关闭 without
// one), then the card's cast material (portraits, avatars, each figure's voice, sprite packs). The cast material also
// feeds the chat's avatars, so it is editable while the stage is off.
function TavernStageMaterialsTab(props) {
	const h = React.createElement, page = useTavernStagePage(props, "stage-materials");
	return tavernStagePanel("舞台素材", h(React.Fragment, null,
		h(TavernPackLibrary, { cardPath: page.play ? page.path : "" }),
		page.play && page.stage.data ? h("div", { className: "dsh-tavern-stage-materials-cast" },
			h(TavernCastManager, { sessionId: page.owner, data: page.stage.data, onCast: () => tavernStageRuntime.refresh(page.owner) })) : null));
}

// 配音: the voicing service (channel, default and narrator voices, its switch). Opened from 舞台设置 › 配音 ›, the
// head carries a ‹ back to it.
function TavernVoiceTab(props) {
	const h = React.createElement;
	const back = React.useSyncExternalStore(tavernStageReturn.subscribe, tavernStageReturn.get, tavernStageReturn.get);
	const button = back && props.openTab ? h("button", { type: "button", className: "dsh-tavern-stage-back", "aria-label": back.label, title: back.label,
		onClick: () => { tavernStageReturn.set(null); props.openTab(back.toTab); } }, h(TavernStageGlyph, { name: "back" })) : null;
	return tavernStagePanel("配音", h(TavernSpeechSettings, null), button);
}

function registerTavernStagePanels(ctx) {
	const tabs = [
		["settings", "舞台设置", 9, TavernStageSettingsTab],
		["materials", "舞台素材", 9.5, TavernStageMaterialsTab],
		["voice", "配音", 10, TavernVoiceTab]
	];
	for (const [key, title, order, Panel] of tabs) ctx.effect(() => ctx.betterSidebar.registerTab({
		id: TAVERN_STAGE_TABS[key], title, order, single: true, icon: TAVERN_STAGE_TAB_ICONS[key],
		component: props => React.createElement(Panel, { sessionId: props.scope.sessionId, sessions: ctx.sessions,
			openTab: type => openTavernSidebarTab(ctx, { type }, { sessionId: props.scope.sessionId }) })
	}), "dsh-tavern: " + title + " panel");
}
