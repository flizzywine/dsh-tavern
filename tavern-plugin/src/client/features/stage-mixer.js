// The stage's audio layers in CONFIG › 声音 (docs/design/cast-presentation.md「舞台 core（23/N）：CONFIG」): one row per layer
// (TavernStageMixerRows); the control bar's 「声音」 entry opens it. State: tavernStageAudio (features/stage-audio.js). Drawn
// only in the stage's UI tokens (--gal-ui-*).
const STAGE_MIX_LAYERS = Object.freeze([["master", "总音量"], ["voice", "配音"], ["music", "背景音乐"], ["sfx", "音效"], ["ambience", "环境音"]]);
// The whole mix at a glance: "muted" when nothing can be heard (master muted / zero, or every layer muted / zero), "partial"
// when some layer is silenced, else "normal".
function stageMixLevel(state) {
	const heard = layer => !(state && state.muted && state.muted[layer]) && Number(state && state[layer]) > 0;
	if (!heard("master")) return "muted";
	const on = ["voice", "music", "sfx", "ambience"].filter(heard).length;
	return on === 0 ? "muted" : on < 4 ? "partial" : "normal";
}
function stageMixIcon(level) { return level === "muted" ? "speakerOff" : level === "partial" ? "speakerLow" : "voice"; }

// One row per layer: mute toggle, label, slider and value, then a ▶ preview where the layer has one (tests: { voice() } -
// null while there is nothing to preview). A mute keeps the slider's value and unmuting restores it (tavernStageAudio keeps
// volume and mute apart; moving the slider unmutes). props: { state (tavernStageAudio.get()), tests }.
function TavernStageMixerRows(props) {
	const h = React.createElement;
	const state = props.state, tests = props.tests || {};
	return h("div", { className: "dsh-tavern-stage-mix is-large", role: "group", "aria-label": "各层音量" },
		STAGE_MIX_LAYERS.map(function ([layer, label]) {
			const muted = Boolean(state.muted && state.muted[layer]);
			const value = Number(state[layer]) || 0, percent = Math.round(value * 100);
			const previews = Object.hasOwn(tests, layer), test = previews ? tests[layer] : null;
			return h("div", { key: layer, className: "dsh-tavern-stage-mix-row" + (layer === "master" ? " is-master" : "") + (muted ? " is-muted" : ""), "data-layer": layer },
				h("button", { type: "button", className: "dsh-tavern-stage-mix-mute", "aria-pressed": muted, "aria-label": muted ? "取消" + label + "静音" : label + "静音", title: muted ? "取消静音" : "静音",
					onClick: () => tavernStageAudio.toggleMute(layer) }, h(TavernStageGlyph, { name: muted ? "speakerOff" : "voice" })),
				h("span", { className: "dsh-tavern-stage-mix-label" }, h("b", null, label)),
				h("input", { type: "range", className: "dsh-tavern-stage-slider dsh-tavern-stage-mix-slider", min: 0, max: 1, step: 0.01, value, style: { "--fill": percent + "%" },
					"aria-label": layer === "master" ? label : label + "音量", "aria-valuetext": muted ? "静音（" + percent + "）" : String(percent),
					onChange: event => tavernStageAudio.setVolume(layer, Number(event.target.value)) }),
				h("output", { className: "dsh-tavern-stage-mix-value", "aria-hidden": true }, percent),
				previews ? h("button", { type: "button", className: "dsh-tavern-stage-mix-test", disabled: !test, title: test ? "试听本句配音" : "这一页没有配音", "aria-label": "试听配音",
					onClick: () => { if (test) test(); } }, h(TavernStageGlyph, { name: "play" }))
					: h("span", { className: "dsh-tavern-stage-mix-test is-none", "aria-hidden": true }));
		}));
}

// The control bar's 「声音」 opens CONFIG › 声音 - the one set of sliders; its glyph still says muted / partial / normal at a glance.
function TavernStageSoundEntry({ openConfig }) {
	const h = React.createElement;
	const level = stageMixLevel(useTavernStageAudioState());
	const said = level === "muted" ? "已静音" : level === "partial" ? "部分静音" : "";
	return h("button", { type: "button", className: "dsh-tavern-stage-sound", "data-action": "sound", "data-level": level, "aria-haspopup": "dialog",
		"aria-label": "声音" + (said ? "（" + said + "）" : ""), title: "声音" + (said ? " · " + said : ""),
		onClick: event => { event.stopPropagation(); openConfig("sound", event.currentTarget); } }, h(TavernStageGlyph, { name: stageMixIcon(level) }));
}
