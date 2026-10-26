// 画面效果 (cast-presentation.md 35/N): one resolved effect (domain/stage-effects.js) as keyframe tracks on the stage's layers,
// sampled at 60 per second; features/stage-effects.js plays them with Element.animate. Layers: world (the backdrop, the figures,
// the item and the effect layer), box (the text box, which follows the world's shake at half), backdrop, zoom (backdrop and
// figures), tear (the figures and the item), split (the figures), cover, vignette and wave (in the effect layer).
// env: W, H (the stage in px); reduced (the system's reduced motion: no shake, zoom, glitch or wave - the shock keeps its burst,
// the heartbeat its vignette); flash (the stage-wide gate admitted this flash); shake (the shock's own shake, resolved);
// screen (the skin's design screen height, for a shake path); random.
const STAGE_FX_BOX_SHARE = 0.5;
function stageScreenEffectTracks(spec, env) {
	const tracks = [], H = env.H, random = env.random || Math.random;
	const sample = (ms, at) => { const n = Math.max(1, Math.ceil(ms * 60 / 1000)); return Array.from({ length: n + 1 }, (_, i) => ({ ...at(i * ms / n), offset: i / n })); };
	const add = (layer, ms, at) => { if (ms > 0) tracks.push({ layer, ms, frames: sample(ms, at) }); };
	const flash = spec.kind === "flash" ? spec : spec.kind === "shock" ? spec.flash : null;
	if (flash && env.flash) {
		const safe = stageFlashSafe(flash);
		add("cover", stageFlashMs(safe), t => ({ opacity: +stageFlashAt(safe, t).toFixed(3), backgroundColor: safe.color }));
	}
	const shake = env.reduced ? null : spec.kind === "shake" ? spec : spec.kind === "shock" ? env.shake : null;
	if (shake) {
		const seed = random() * 6.283, path = { ...shake, screen: env.screen }, ms = stageShakeMs(shake);
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
			const strength = stageGlitchAt(spec, t);
			if (t - cut >= 45) { cut = t; dx = random() * 2 - 1; }
			return { translate: (dx * 34 * strength * H / 720).toFixed(2) + "px 0px" };
		});
		add("split", spec.ms, t => { const px = (9 * stageGlitchAt(spec, t) * H / 720).toFixed(2); return { filter: "drop-shadow(" + px + "px 0 0 rgba(255,0,64,.75)) drop-shadow(-" + px + "px 0 0 rgba(0,224,255,.75))" }; });
	}
	// The shock's wave: a ring out from the centre past the farthest corner, drawn at its size (a scaled small ring rasterizes badly).
	if (spec.kind === "shock" && spec.wave !== false && !env.reduced) {
		const reach = Math.hypot(env.W / 2, H * 0.58) + 160 * H / 720;
		add("wave", spec.waveMs, t => { const u = t / spec.waveMs, size = (2 * u * reach).toFixed(1) + "px"; return { width: size, height: size, opacity: +(0.6 * Math.pow(1 - u, 1.4)).toFixed(3) }; });
	}
	return tracks;
}
