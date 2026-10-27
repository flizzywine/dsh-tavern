// 画面效果 (cast-presentation.md 35/N): one resolved effect (stage-effects.cjs) as keyframe tracks on the stage's layers,
// sampled at 60 per second; features/stage-effects.js plays them with Element.animate. Layers: world (the backdrop, the figures,
// the item and the effect layer), box (the text box, which follows the world's shake at half), backdrop, zoom (backdrop and
// figures), tear (the figures and the item), split (the figures), cover, vignette and wave (in the effect layer).
// env: W, H (the stage in px); reduced (the system's reduced motion: no shake, zoom, glitch or wave - the shock keeps its burst,
// the heartbeat its vignette); flash (the stage-wide gate admitted this flash); shake (the shock's own shake, resolved);
// screen (the skin's design screen height, for a shake path); random.
const STAGE_FX_BOX_SHARE = 0.5;
// The built-in scene's safety: flashes are always photosensitive-safe (stage-effects.cjs stageFlashSafe / stageFlashGate).
const TAVERN_STAGE_FX_POLICY = Object.freeze({ reducedMotion: false, calm: false, photosensitive: true });
// Track lengths in ms: a flash's cycles without its last tail; a shake's sines or its skin path.
const stageFxFlashMs = flash => 1000 * ((flash.in || 0) + (flash.hold || 0) + (flash.out || 0) + (flash.tail || 0)) * Math.max(1, Math.min(3, Math.round(flash.cycles || 1))) - 1000 * (flash.tail || 0);
const stageFxShakeMs = shake => shake.path ? 1000 * shake.step * shake.path.length : shake.ms;
function stageScreenEffectTracks(spec, env) {
	const tracks = [], H = env.H, random = env.random || Math.random;
	const sample = (ms, at) => { const n = Math.max(1, Math.ceil(ms * 60 / 1000)); return Array.from({ length: n + 1 }, (_, i) => ({ ...at(i * ms / n), offset: i / n })); };
	const add = (layer, ms, at) => { if (ms > 0) tracks.push({ layer, ms, frames: sample(ms, at) }); };
	const flash = spec.kind === "flash" ? spec : spec.kind === "shock" ? spec.flash : null;
	if (flash && env.flash) {
		const safe = stageFlashSafe(flash, TAVERN_STAGE_FX_POLICY);
		add("cover", stageFxFlashMs(safe), t => ({ opacity: +Math.max(0, stageFlashAt(safe, t)).toFixed(3), backgroundColor: safe.color }));
	}
	const shake = env.reduced ? null : spec.kind === "shake" ? spec : spec.kind === "shock" ? env.shake : null;
	if (shake) {
		const seed = random() * 6.283, path = { ...shake, screen: env.screen }, ms = stageFxShakeMs(shake);
		const at = share => t => { const o = stageShakeAt(path, H, seed, t); return { translate: (share * o.x).toFixed(2) + "px " + (share * o.y).toFixed(2) + "px" }; };
		if (shake.target === "background") add("backdrop", ms, at(1));
		else { add("world", ms, at(1)); add("box", ms, at(STAGE_FX_BOX_SHARE)); }
	}
	if (spec.kind === "pulse") {
		add("vignette", spec.ms, t => ({ opacity: +stagePulseAt(spec, t).vignette.toFixed(3), color: spec.color }));
		if (!env.reduced && spec.zoom > 0) add("zoom", spec.ms, t => ({ scale: String(+(1 + stagePulseAt(spec, t).zoom).toFixed(4)) }));
	}
	// The glitch: the figures torn sideways and their colours split, re-cut every 45 ms (the backdrop stays: a tear that wide
	// would show its edge).
	if (spec.kind === "glitch" && !env.reduced) {
		let cut = -Infinity, dx = 0;
		add("tear", spec.ms, t => {
			const strength = stageGlitchAt(spec, t).strength;
			if (t - cut >= 45) { cut = t; dx = random() * 2 - 1; }
			return { translate: (dx * 34 * strength * H / 720).toFixed(2) + "px 0px" };
		});
		add("split", spec.ms, t => { const px = (9 * stageGlitchAt(spec, t).strength * H / 720).toFixed(2); return { filter: "drop-shadow(" + px + "px 0 0 rgba(255,0,64,.75)) drop-shadow(-" + px + "px 0 0 rgba(0,224,255,.75))" }; });
	}
	// The shock's wave: a ring out from the centre past the farthest corner, drawn at its size (a scaled small ring rasterizes badly).
	if (spec.kind === "shock" && spec.wave !== false && !env.reduced) {
		const reach = Math.hypot(env.W / 2, H * 0.58) + 160 * H / 720;
		add("wave", spec.waveMs, t => { const u = t / spec.waveMs, size = (2 * u * reach).toFixed(1) + "px"; return { width: size, height: size, opacity: +(0.6 * Math.pow(1 - u, 1.4)).toFixed(3) }; });
	}
	return tracks;
}
