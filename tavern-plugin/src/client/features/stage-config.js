// The stage's CONFIG screen, visual-novel style (docs/design/cast-presentation.md「舞台 core（23/N）：CONFIG」) - the one home of
// the player's lasting stage preferences on this machine. The control bar's 「声音」 opens it over the dimmed stage with left
// tabs: 声音 (every audio layer, features/stage-mixer.js, and 配音倍速) and 文字 (文字速度 and the auto mode's pace). The stage owns the open
// state: auto paging waits while it is open and the stage's keys are its own. Drawn only in the stage's UI tokens (--gal-ui-*).
const STAGE_CONFIG_TABS = Object.freeze([["sound", "声音", "SOUND"], ["text", "文字", "TEXT"]]);
// The last tab stays selected while the page lives (reopening returns to it; the 「声音」 entry opens sound).
let stageConfigLastTab = "sound";

// Phones get a compact layout: a full-bleed sheet, a one-line title with the ✕ inside the header, the tabs as a horizontal
// bar and the rows stacked (label above control). Narrow viewports, and short touch screens (a phone held sideways).
const STAGE_CONFIG_COMPACT = "(max-width: 640px), (max-height: 520px) and (pointer: coarse)";
function useTavernStageConfigCompact() {
	const has = typeof matchMedia === "function";
	const [compact, setCompact] = React.useState(() => has && matchMedia(STAGE_CONFIG_COMPACT).matches);
	React.useEffect(function () {
		if (!has) return undefined;
		const list = matchMedia(STAGE_CONFIG_COMPACT), changed = () => setCompact(list.matches);
		changed();
		list.addEventListener("change", changed);
		return () => list.removeEventListener("change", changed);
	}, []);
	return compact;
}

// Full-screen CONFIG. props: { tab, tests: { voice() }, onClose() }. Esc, right click or the ✕ close it; focus stays inside
// while open and goes back to the opener afterwards (the stage).
function TavernStageConfigScreen(props) {
	const h = React.createElement;
	const compact = useTavernStageConfigCompact();
	const [tab, setTab] = React.useState(() => props.tab || stageConfigLastTab);
	const root = React.useRef(null), tabRefs = React.useRef({});
	function choose(id, focus) { stageConfigLastTab = id; setTab(id); if (focus && tabRefs.current[id]) tabRefs.current[id].focus(); }
	React.useEffect(function () {
		stageConfigLastTab = tab;
		const active = tabRefs.current[tab];
		if (active) active.focus({ preventScroll: true });
		// Esc closes before the stage sees it; a held Esc (auto-repeat) is not a new press.
		function onKey(event) {
			if (event.key !== "Escape") return;
			event.preventDefault(); event.stopImmediatePropagation();
			if (!event.repeat) props.onClose();
		}
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);
	// Tab cycles inside the screen; the stage never sees keys typed here.
	function onKeyDown(event) {
		event.stopPropagation();
		if (event.key !== "Tab" || !root.current) return;
		const items = Array.from(root.current.querySelectorAll("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter(node => node.offsetParent !== null || node === document.activeElement);
		if (!items.length) return;
		const first = items[0], last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
		else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
	}
	function onTabKey(event) {
		const at = STAGE_CONFIG_TABS.findIndex(([id]) => id === tab), count = STAGE_CONFIG_TABS.length;
		const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? at + 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? count - 1 : null;
		if (next === null) return;
		event.preventDefault();
		choose(STAGE_CONFIG_TABS[(next + count) % count][0], true);
	}
	const page = tab === "sound" ? h(TavernStageConfigSound, props) : h(TavernStageConfigText, props);
	const close = h("button", { type: "button", className: "dsh-tavern-stage-config-close", title: "关闭（Esc / 右键）", "aria-label": "关闭设置", onClick: props.onClose }, h(TavernStageGlyph, { name: "close" }));
	return h("div", { ref: root, className: "dsh-tavern-stage-config", "data-layout": compact ? "compact" : "wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "dsh-tavern-stage-config-title",
		onClick: event => event.stopPropagation(), onWheel: event => event.stopPropagation(), onKeyDown,
		onContextMenu: event => { event.preventDefault(); event.stopPropagation(); props.onClose(); } },
		h("div", { className: "dsh-tavern-stage-config-sheet" },
			h("header", { className: "dsh-tavern-stage-config-head" },
				h("h2", { id: "dsh-tavern-stage-config-title", className: "dsh-tavern-stage-config-title" }, h("i", { className: "dsh-tavern-stage-config-gem", "aria-hidden": true }), h("b", null, "CONFIG"), h("span", null, "设置")),
				close),
			h("nav", { className: "dsh-tavern-stage-config-tabs", role: "tablist", "aria-orientation": compact ? "horizontal" : "vertical", "aria-label": "设置分类" },
				STAGE_CONFIG_TABS.map(([id, label, en]) => h("button", { key: id, ref: node => { tabRefs.current[id] = node; }, type: "button", role: "tab", id: "dsh-tavern-stage-config-tab-" + id,
					"aria-selected": tab === id, "aria-controls": "dsh-tavern-stage-config-page", tabIndex: tab === id ? 0 : -1, className: "dsh-tavern-stage-config-tab" + (tab === id ? " is-on" : ""),
					onClick: () => choose(id), onKeyDown: onTabKey },
					h("i", { className: "dsh-tavern-stage-config-gem", "aria-hidden": true }), h("b", null, label), h("span", null, en)))),
			h("section", { id: "dsh-tavern-stage-config-page", className: "dsh-tavern-stage-config-page", role: "tabpanel", "aria-labelledby": "dsh-tavern-stage-config-tab-" + tab, "data-tab": tab }, page)));
}

// Building blocks: a titled group and a label / control row, each with its note under it.
function stageConfigNote(note) { return note ? React.createElement("p", { className: "dsh-tavern-stage-config-note" }, note) : null; }
function stageConfigGroup(title, note, ...children) {
	const h = React.createElement;
	return h("div", { className: "dsh-tavern-stage-config-group" }, h("div", { className: "dsh-tavern-stage-config-caption" }, h("b", null, title)), stageConfigNote(note), ...children);
}
function stageConfigRow(label, control, note) {
	const h = React.createElement;
	return h("div", { className: "dsh-tavern-stage-config-row" },
		h("div", { className: "dsh-tavern-stage-config-label" }, h("b", null, label)),
		h("div", { className: "dsh-tavern-stage-config-control" }, control, stageConfigNote(note)));
}
// A slider with its two ends named and its value after them.
function stageConfigSlider(ends, slider) {
	const h = React.createElement, fill = (slider.value - slider.min) / (slider.max - slider.min) * 100;
	return h("div", { className: "dsh-tavern-stage-config-slider" },
		h("span", { className: "dsh-tavern-stage-config-end" }, ends[0]),
		h("input", { type: "range", className: "dsh-tavern-stage-slider", min: slider.min, max: slider.max, step: slider.step, value: slider.value, style: { "--fill": fill + "%" },
			"aria-label": slider.label, "aria-valuetext": slider.valueText, onChange: event => slider.onChange(Number(event.target.value)) }),
		h("span", { className: "dsh-tavern-stage-config-end" }, ends[1]),
		h("output", { className: "dsh-tavern-stage-config-value" }, slider.output));
}

// 声音: the mixer rows, with ▶ for the current line's voice; 避让 (stage-audio.js); 配音倍速.
function TavernStageConfigSound(props) {
	const h = React.createElement;
	const state = useTavernStageAudioState(), reading = useTavernStageReadingPrefs();
	const [rateMin, rateMax, rateStep] = STAGE_READING_LIMITS.voiceRate;
	const ducking = state.duck !== false;
	return h(React.Fragment, null,
		stageConfigGroup("音量", "每层各自静音，静音时滑块保留原值。▶ 试听：配音播放当前这一句。",
			h(TavernStageMixerRows, { state, tests: props.tests })),
		stageConfigGroup("混音", null,
			stageConfigRow("自动混音", h("button", { type: "button", role: "switch", className: "dsh-tavern-stage-config-switch", "aria-checked": ducking, "aria-label": "自动混音",
					onClick: () => tavernStageAudio.setDucking(!ducking) }, h("i", { "aria-hidden": true }), h("span", null, ducking ? "开" : "关")))),
		stageConfigGroup("配音", null,
			stageConfigRow("配音倍速", stageConfigSlider(["慢", "快"], { min: rateMin, max: rateMax, step: rateStep, value: reading.voiceRate, label: "配音倍速",
					valueText: reading.voiceRate.toFixed(1) + " 倍", output: reading.voiceRate.toFixed(1) + "×", onChange: value => tavernStageReadingPrefs.set({ voiceRate: value }) }),
				"所有配音按这个倍率播放，音调不变；舞台和聊天里的朗读都生效，正在播放的这一句也立即变速。默认 1.0 倍。")));
}

// 文字: text speed and the auto mode's pace, and a live preview that types and waits like the stage (stage-typewriter.js).
function TavernStageConfigText() {
	const reading = useTavernStageReadingPrefs();
	const [typeMin, typeMax, typeStep] = STAGE_READING_LIMITS.textSpeed;
	const [speedMin, speedMax, speedStep] = STAGE_READING_LIMITS.autoSpeed, [waitMin, waitMax, waitStep] = STAGE_READING_LIMITS.autoWait;
	const seconds = ms => (ms / 1000).toFixed(1) + " 秒";
	return stageConfigGroup("阅读", null,
		// Speed reads left = slow, right = fast (instant at the far right); stored as milliseconds per glyph.
		stageConfigRow("文字速度", stageConfigSlider(["慢", "快"], { min: 0, max: typeMax - typeMin, step: typeStep, value: typeMax - reading.textSpeed, label: "文字速度",
				valueText: reading.textSpeed === 0 ? "瞬间显示" : reading.textSpeed + " 毫秒每字", output: reading.textSpeed === 0 ? "瞬间" : reading.textSpeed + " ms/字",
				onChange: value => tavernStageReadingPrefs.set({ textSpeed: typeMax - value }) }),
			"打字机效果每个字的间隔；拉到最右边整句直接出现。默认 " + STAGE_READING_DEFAULTS.textSpeed + " 毫秒。"),
		stageConfigRow("自动阅读速度", stageConfigSlider(["慢", "快"], { min: speedMin, max: speedMax, step: speedStep, value: reading.autoSpeed, label: "自动阅读速度",
				valueText: reading.autoSpeed.toFixed(1) + " 倍", output: reading.autoSpeed.toFixed(1) + "×", onChange: value => tavernStageReadingPrefs.set({ autoSpeed: value }) }),
			"按倍率缩放无配音页的阅读时间和配音结束后的等待；不会截断正在播放的配音。默认 1.0 倍。立即生效。"),
		stageConfigRow("自动模式等待", stageConfigSlider(["短", "长"], { min: waitMin, max: waitMax, step: waitStep, value: reading.autoWait, label: "自动模式等待",
				valueText: seconds(reading.autoWait), output: seconds(reading.autoWait), onChange: value => tavernStageReadingPrefs.set({ autoWait: value }) }),
			"配音结束后的基础停顿，再除以自动阅读速度；不会截断配音。无配音页按字数阅读，再加上相对默认 " + seconds(STAGE_READING_DEFAULTS.autoWait) + " 的增减，最后按速度缩放。"),
		React.createElement(TavernStageConfigPreview, { reading }));
}
