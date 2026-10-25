// The stage's audio layers (docs/design/cast-presentation.md「舞台 core（23/N）：CONFIG」): the page's one AudioContext and its
// mixer. Every stage sound ends in its layer's bus, then 总音量: the BGM (modules/stage-music.js), 音效 (modules/stage-sfx.js) and
// 环境音 on Web Audio; a voice is an <audio> (or the system's speech, features/speech.js) set to 配音 × 总音量.
// State: the player's level per layer and a mute per layer, kept apart - a mute keeps the level and unmuting restores it;
// moving a slider unmutes its layer. This browser's (localStorage), not a save's, card's or Tavern setting; at the defaults
// every sound plays as before (each at its entry's 音量). CONFIG › 声音 (features/stage-mixer.js) lists every layer.
const STAGE_AUDIO_LAYERS = Object.freeze(["master", "voice", "music", "sfx", "ambience"]);
const STAGE_AUDIO_KEY = "dsh-tavern-stage-audio";
// What was saved, as far as it still fits: each level within 0..1, the mutes as flags.
function stageAudioPreferences(saved) {
	const prefs = { v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {} };
	if (!saved || typeof saved !== "object") return prefs;
	for (const layer of STAGE_AUDIO_LAYERS) {
		if (Number.isFinite(saved[layer])) prefs[layer] = Math.max(0, Math.min(1, saved[layer]));
		if (saved.muted && saved.muted[layer] === true) prefs.muted[layer] = true;
	}
	return prefs;
}
const tavernStageAudio = (function () {
	let storage = null;
	// Even reading the getter throws on opaque origins.
	try { storage = localStorage; } catch (_) {}
	let prefs;
	try { prefs = stageAudioPreferences(JSON.parse(storage && storage.getItem(STAGE_AUDIO_KEY) || "null")); } catch (_) { prefs = stageAudioPreferences(null); }
	const listeners = new Set();
	let context = null, master = null, buses = {};
	const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
	const volume = layer => prefs.muted[layer] ? 0 : prefs[layer];
	function ensure() {
		if (context) return context;
		const Constructor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
		if (!Constructor) return null;
		try {
			context = new Constructor(); master = context.createGain(); master.gain.value = volume("master"); master.connect(context.destination);
			buses = {};
			for (const layer of ["music", "sfx", "ambience"]) { const gain = buses[layer] = context.createGain(); gain.gain.value = volume(layer); gain.connect(master); }
		} catch (_) { context = null; }
		return context;
	}
	// A change glides over a few ms, so a slider never clicks; what is already sounding follows at once.
	function save() {
		try { storage && storage.setItem(STAGE_AUDIO_KEY, JSON.stringify(prefs)); } catch (_) {}
		if (context) {
			master.gain.setTargetAtTime(volume("master"), context.currentTime, 0.015);
			for (const layer of Object.keys(buses)) buses[layer].gain.setTargetAtTime(volume(layer), context.currentTime, 0.015);
		}
		tune();
		listeners.forEach(fn => fn());
	}
	const tune = () => tavernSpeech.tune({ level: volume("voice") * volume("master") });
	tune();
	return {
		context: ensure,
		// Autoplay can refuse the first play; any later gesture resumes the audio.
		wake() { if (context && context.state === "suspended") context.resume().catch(() => {}); },
		// Where a transport's sounds go on `ctx` (the context above): its layer's bus.
		output(ctx, layer) { return ctx === ensure() ? buses[layer] : ctx.destination; },
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		get() { return { ...prefs, muted: { ...prefs.muted } }; },
		setVolume(layer, value) { if (!STAGE_AUDIO_LAYERS.includes(layer)) return; prefs[layer] = clamp(value); delete prefs.muted[layer]; save(); },
		toggleMute(layer) { if (!STAGE_AUDIO_LAYERS.includes(layer)) return; if (prefs.muted[layer]) delete prefs.muted[layer]; else prefs.muted[layer] = true; save(); }
	};
})();
function useTavernStageAudioState() {
	const [, redraw] = React.useState(0);
	React.useEffect(() => tavernStageAudio.subscribe(() => redraw(n => n + 1)), []);
	return tavernStageAudio.get();
}
