function createStageMixer({React, Icon, Slider, audio:forkStageAudio, sounds:forkUiSfx, entries:stageEntries, report:useStageEntryState, icons:ICON_PATHS, fields, reading:readingStore, voiceRateLimits}) {
let disposed = false;
const lowIcon = "M4 9.5v5h3.5l4.5 3.5v-12L7.5 9.5H4zM15.5 9a4.2 4.2 0 0 1 0 6";
const ownsIcon = ICON_PATHS && !ICON_PATHS['speaker-low'];
if (ownsIcon) ICON_PATHS['speaker-low'] = lowIcon;
function useStageAudioState() { return React.useSyncExternalStore(forkStageAudio.subscribe, forkStageAudio.get); }
// the stage's audio layers. CONFIG › 声音 lists every layer
// (GalMixerRows); the top bar's 「声音」 entry opens it. State: forkStageAudio (stage-audio.js). Styled only through the
// stage UI tokens (--gal-ui-*).

// ui (界面音效, ui-sfx.js) is listed but stays out of galMixLevel: the icon speaks for the story's sound.
const GAL_MIX_LAYERS = [["master", "总音量"], ["voice", "配音"], ["music", "背景音乐"], ["sfx", "音效"], ["ambience", "环境音"], ["ui", "界面音效"]];
// The whole mix at a glance: "muted" when nothing can be heard (master muted / zero, or every layer muted /
// zero), "partial" when some layer is silenced, else "normal". Pure; tests/fork-gal-config.test.mjs.
function galMixLevel(state) {
    const heard = layer => !(state && state.muted && state.muted[layer]) && Number(state && state[layer]) > 0;
    if (!heard("master")) return "muted";
    const on = ["voice", "music", "sfx", "ambience"].filter(heard).length;
    return on === 0 ? "muted" : on < 4 ? "partial" : "normal";
}
function galMixIcon(level) { return level === "muted" ? "speaker-off" : level === "partial" ? "speaker-low" : "speaker"; }

// One row per layer: mute toggle, label, slider and value; a mute keeps the slider's value, unmuting restores it
// (forkStageAudio keeps volume and mute apart; moving the slider unmutes). No now-playing names here (
// the skin's sound panel shows no track or ambience titles; those live in the HUD only).
// props: { state (forkStageAudio.get()), tests: { voice(), sfx() } }.
function GalMixerRows(props) {
    const h = React.createElement;
    const state = props.state, tests = props.tests || {};
    return h("div", { className: "fork-gal-mix is-large", role: "group", "aria-label": "各层音量" },
        GAL_MIX_LAYERS.map(function ([layer, label]) {
            const muted = Boolean(state.muted && state.muted[layer]);
            const value = Number(state[layer]) || 0, percent = Math.round(value * 100);
            const test = layer !== "master" && layer !== "music" && layer !== "ambience" ? layer === "ui" ? () => forkUiSfx.play("confirm") : tests[layer] || null : null;
            return h("div", { key: layer, className: "fork-gal-mix-row" + (layer === "master" ? " is-master" : "") + (muted ? " is-muted" : ""), "data-layer": layer },
                h("button", { type: "button", className: "fork-gal-mix-mute", "aria-pressed": muted, "aria-label": muted ? "取消" + label + "静音" : label + "静音", title: muted ? "取消静音" : "静音",
                    onClick: () => { if (!disposed) forkStageAudio.toggleMute(layer); } }, h(Icon, { name: muted ? "speaker-off" : "speaker", size: 20 })),
                h("span", { className: "fork-gal-mix-label" }, h("b", null, label)),
                // the shared Slider (inline-field.js) in the stage skin.
                h(Slider, { skin: "fork-gal-slider", className: "fork-gal-mix-slider", min: 0, max: 1, step: 0.01, value,
                    label: layer === "master" ? label : label + "音量", valueText: muted ? "静音（" + percent + "）" : String(percent),
                    onChange: next => { if (!disposed) forkStageAudio.setVolume(layer, next); } }),
                h("output", { className: "fork-gal-mix-value", "aria-hidden": true }, percent),
                (layer === "master" || layer === "music" || layer === "ambience" ? h("span", { className: "fork-gal-mix-test is-none", "aria-hidden": true })
                    : h("button", { type: "button", className: "fork-gal-mix-test", disabled: !test, title: test ? (layer === "voice" ? "试听本句配音" : layer === "ui" ? "试听界面音效" : "试听音效") : layer === "voice" ? "这一页没有配音" : "没有可试听的音效",
                        "aria-label": layer === "voice" ? "试听配音" : layer === "ui" ? "试听界面音效" : "试听音效", onClick: () => { if (!disposed && test) test(); } }, h(Icon, { name: "play", size: 18 }))));
        }));
}

// the top bar's 「声音」 entry opens CONFIG › 声音 - the one set of sliders; its glyph
// still says muted / partial / normal at a glance.
function GalSoundEntry({ openConfig }) {
    const h = React.createElement;
    const level = galMixLevel(useStageAudioState());
    const said = level === "muted" ? "已静音" : level === "partial" ? "部分静音" : "";
    useStageEntryState("sound", { available: true, icon: galMixIcon(level), detail: said });
    return h("button", { type: "button", className: "fork-gal-mixer-toggle", "data-level": level, "aria-haspopup": "dialog",
        "aria-label": "声音" + (said ? "（" + said + "）" : ""), title: "声音" + (said ? " · " + said : ""),
        onClick: event => { event.stopPropagation(); if (!disposed) openConfig("sound", event.currentTarget); } }, h(Icon, { name: galMixIcon(level), size: 16 }));
}
const unregister = stageEntries?.register({ id: "sound", priority: 70, group: "scene", icon: "speaker", label: "声音",
    render: ctx => React.createElement(GalSoundEntry, { openConfig: ctx.openConfig }) });
function GalConfigSound(props) {
    const h = React.createElement;
    const state = useStageAudioState();
    const reading = React.useSyncExternalStore(readingStore.subscribe, readingStore.get);
    const [rateMin, rateMax, rateStep] = voiceRateLimits;
    return h(React.Fragment, null,
        fields.group("音量",
            h(React.Fragment, null, h("span", null, "每层各自静音，静音时滑块保留原值。"), h("span", null, "▶ 试听：配音播放当前这一句，音效播放一个短提示音。")),
            h(GalMixerRows, { state, tests: props.tests }),
            // Upstream stage core 37: off = no ducking (stage-audio.js); sliders and 总音量 are unchanged.
            fields.row("自动混音", h(fields.Switch, { label: "自动混音", checked: state.duck !== false, onChange: on => {if(!disposed)forkStageAudio.setDucking(on);} }))),
        fields.group("配音", null,
            fields.row("配音倍速", fields.slider(["慢", "快"], { min: rateMin, max: rateMax, step: rateStep, value: reading.voiceRate, label: "配音倍速",
                    valueText: reading.voiceRate.toFixed(1) + " 倍", output: reading.voiceRate.toFixed(1) + "×", onChange: value => {if(!disposed)readingStore.set({ voiceRate: value });} }),
                "所有配音按这个倍率播放，音调不变；舞台和聊天气泡都生效，正在播放的这一句也立即变速。默认 1.0 倍。")));
}

return {Sound:GalConfigSound, Rows:GalMixerRows, level:galMixLevel, icon:galMixIcon, dispose() {
    if (disposed) return;
    disposed = true;
    try { unregister?.(); } finally { if (ownsIcon && ICON_PATHS['speaker-low'] === lowIcon) delete ICON_PATHS['speaker-low']; }
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageMixer};
