// 画面效果 (cast-presentation.md 35/N): screen.play on the built-in scene. The effect's look is the engine's default merged
// with the skin's `effects` (stage-effects.cjs), its tracks come from modules/stage-effects.js and play on the scene's
// layers as one animation the page's playback owns (cancelled together with the page). A flash passes the stage-wide gate
// (a dark cover never counts); an effect left with nothing to play is consumed silently. Flashes are always photosensitive-safe
// (TAVERN_STAGE_FX_POLICY, modules/stage-effects.js).
const TAVERN_STAGE_FX_LAYERS = {
	world: [".dsh-tavern-stage-backdrop", ".dsh-tavern-stage-figures", ".dsh-tavern-stage-item", ".dsh-tavern-stage-fx"], box: [".dsh-tavern-stage-textbox"],
	backdrop: [".dsh-tavern-stage-backdrop"], zoom: [".dsh-tavern-stage-backdrop", ".dsh-tavern-stage-figures"], tear: [".dsh-tavern-stage-figures", ".dsh-tavern-stage-item"], split: [".dsh-tavern-stage-figures"],
	cover: [".dsh-tavern-stage-fx-cover"], vignette: [".dsh-tavern-stage-fx-vignette"], wave: [".dsh-tavern-stage-fx-wave"]
};
function playTavernStageScreenEffect(root, event, id, skin, reduced) {
	const effects = skin && skin.effects, spec = stageEffectResolve(event.effect, effects, null);
	if (!root || !spec || !root.querySelector(".dsh-tavern-stage-fx")) return null;
	const flash = spec.kind === "flash" ? spec : spec.kind === "shock" ? spec.flash : null, size = root.getBoundingClientRect();
	const tracks = stageScreenEffectTracks(spec, { W: size.width, H: size.height, reduced, screen: skin && skin.art && skin.art.screen || 576,
		flash: Boolean(flash) && (stageFlashDark(flash) || stageFlashGate.admit(TAVERN_STAGE_FX_POLICY, performance.now())),
		shake: spec.kind === "shock" && spec.shake ? stageEffectResolve(spec.shake, effects, null) : null });
	const played = [];
	tracks.forEach(track => TAVERN_STAGE_FX_LAYERS[track.layer].forEach(selector => {
		const node = root.querySelector(selector);
		// The first carries the playback's id; the rest are its parts.
		if (node) played.push(node.animate(track.frames, { id: (played.length ? "stage-fx:" : "stage:") + id, duration: track.ms }));
	}));
	return played.length ? { cancel: () => played.forEach(animation => animation.cancel()), finished: Promise.all(played.map(animation => animation.finished)) } : null;
}
