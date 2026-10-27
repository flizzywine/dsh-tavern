// The stage's audio layers (docs/design/cast-presentation.md「舞台 core（23/N）：CONFIG」): the page's one AudioContext and its
// mixer. Every stage sound ends in its layer's bus, its dip (避让, below) and then 总音量: the BGM (modules/stage-music.js), 音效 (modules/stage-sfx.js) and
// 环境音 on Web Audio; a voice is an <audio> (or the system's speech, features/speech.js) set to 配音 × 总音量.
// State: the player's level per layer and a mute per layer, kept apart - a mute keeps the level and unmuting restores it;
// moving a slider unmutes its layer. This browser's (localStorage), not a save's, card's or Tavern setting; at the defaults
// every sound plays as before (each at its entry's 音量). CONFIG › 声音 (features/stage-mixer.js) lists every layer.
const STAGE_AUDIO_LAYERS = Object.freeze(["master", "voice", "music", "sfx", "ambience"]);
const STAGE_AUDIO_KEY = "dsh-tavern-stage-audio";
// 避让 (core 37/N): while a voice or a sound effect sounds, the layers below it dip (dB), each after its slider: priority
// 配音 > 音效 > 环境音 > BGM, a trigger only lowers the layers below it, and with both sounding a layer takes the deeper dip
// (never the sum). The amounts and time constants are stage-audio-math.js AUDIO_DUCK / AUDIO_DUCK_TIME (audioDuckDb,
// audioDuckMatrix); the open stage's skin may set any of them (its `duck`, merged over them); the player's CONFIG › 声音
// switch turns ducking off (saved as duck: false). Sliders and 总音量 are not touched.
// What was saved, as far as it still fits: each level within 0..1, the mutes as flags, ducking off only as duck: false.
function stageAudioPreferences(saved) {
	const prefs = { v: 1, master: 1, voice: 1, music: 1, sfx: 1, ambience: 1, muted: {} };
	if (!saved || typeof saved !== "object") return prefs;
	for (const layer of STAGE_AUDIO_LAYERS) {
		if (Number.isFinite(saved[layer])) prefs[layer] = Math.max(0, Math.min(1, saved[layer]));
		if (saved.muted && saved.muted[layer] === true) prefs.muted[layer] = true;
	}
	if (saved.duck === false) prefs.duck = false;
	return prefs;
}
const tavernStageAudio = (function () {
	let storage = null;
	// Even reading the getter throws on opaque origins.
	try { storage = localStorage; } catch (_) {}
	let prefs;
	try { prefs = stageAudioPreferences(JSON.parse(storage && storage.getItem(STAGE_AUDIO_KEY) || "null")); } catch (_) { prefs = stageAudioPreferences(null); }
	const listeners = new Set();
	let context = null, master = null, buses = {}, dips = {};
	const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
	const volume = layer => prefs.muted[layer] ? 0 : prefs[layer];
	// 避让: which triggers sound now (the voice from features/speech.js, 音效 from its player) and the amounts in force.
	const triggers = { voice: false, sfx: false };
	let matrix = AUDIO_DUCK;
	const dipOf = layer => prefs.duck === false ? { db: 0, by: null } : audioDuckDb(layer, triggers, matrix);
	const level = db => Math.pow(10, db / 20);
	function ensure() {
		if (context) return context;
		const Constructor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
		if (!Constructor) return null;
		try {
			context = new Constructor(); master = context.createGain(); master.gain.value = volume("master"); master.connect(context.destination);
			buses = {}; dips = {};
			// Each layer: its slider's gain, then its dip, then 总音量.
			for (const layer of ["music", "sfx", "ambience"]) {
				const gain = buses[layer] = context.createGain(), dip = dipOf(layer), duck = context.createGain();
				gain.gain.value = volume(layer); duck.gain.value = level(dip.db);
				gain.connect(duck); duck.connect(master); dips[layer] = { node: duck, db: dip.db, by: dip.by };
			}
		} catch (_) { context = null; }
		return context;
	}
	// Each layer glides to its new dip: down at the attack of the trigger now setting it, up after the hold at the release of
	// the one that set it. Holding the value where it is first keeps a glide that turns midway continuous.
	function retarget() {
		if (!context) return;
		for (const layer of Object.keys(dips)) {
			const dip = dips[layer], next = dipOf(layer);
			if (next.db === dip.db) { dip.by = next.by; continue; }
			const deeper = next.db < dip.db, time = AUDIO_DUCK_TIME[deeper ? next.by : dip.by], param = dip.node.gain, now = context.currentTime;
			(param.cancelAndHoldAtTime || param.cancelScheduledValues).call(param, now);
			param.setTargetAtTime(level(next.db), deeper ? now : now + time.hold, deeper ? time.attack : time.release);
			dip.db = next.db; dip.by = next.by;
		}
	}
	function duck(trigger, on) { if (triggers[trigger] === on) return; triggers[trigger] = on; retarget(); }
	// A change glides over a few ms, so a slider never clicks; what is already sounding follows at once.
	function save() {
		try { storage && storage.setItem(STAGE_AUDIO_KEY, JSON.stringify(prefs)); } catch (_) {}
		if (context) {
			master.gain.setTargetAtTime(volume("master"), context.currentTime, 0.015);
			for (const layer of Object.keys(buses)) buses[layer].gain.setTargetAtTime(volume(layer), context.currentTime, 0.015);
		}
		retarget();
		tune();
		listeners.forEach(fn => fn());
	}
	const tune = () => tavernSpeech.tune({ level: volume("voice") * volume("master") });
	tune();
	tavernSpeech.watch(on => duck("voice", on));
	return {
		context: ensure,
		// Autoplay can refuse the first play; any later gesture resumes the audio.
		wake() { if (context && context.state === "suspended") context.resume().catch(() => {}); },
		// Where a transport's sounds go on `ctx` (the context above): its layer's bus.
		output(ctx, layer) { return ctx === ensure() ? buses[layer] : ctx.destination; },
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		get() { return { ...prefs, muted: { ...prefs.muted } }; },
		setVolume(layer, value) { if (!STAGE_AUDIO_LAYERS.includes(layer)) return; prefs[layer] = clamp(value); delete prefs.muted[layer]; save(); },
		toggleMute(layer) { if (!STAGE_AUDIO_LAYERS.includes(layer)) return; if (prefs.muted[layer]) delete prefs.muted[layer]; else prefs.muted[layer] = true; save(); },
		// 避让: the player's switch; a trigger starting or ending ("voice", "sfx"); the open stage's skin `duck` (null: the engine's).
		setDucking(on) { if (on) delete prefs.duck; else prefs.duck = false; save(); },
		duck,
		duckBy(skin) { matrix = audioDuckMatrix(skin); retarget(); }
	};
})();
function useTavernStageAudioState() {
	const [, redraw] = React.useState(0);
	React.useEffect(() => tavernStageAudio.subscribe(() => redraw(n => n + 1)), []);
	return tavernStageAudio.get();
}
