// 入场演出: the stage's opening performance (castStage `entrance`, a dsh.entrance/1 document of the card's own packs, shown
// while 舞台设置 › 基础设置「入场演出」 is on). It plays over the stage each time the stage opens and never holds it: the stage is
// drawn under it from the start; a click or a page key once the stage is ready skips to the cover; reduced motion shows one
// still frame and fades it; no canvas, no first frame in time, no cover in time or no end after the cover drops it at once.
// The engine draws only the generic primitives of the contract (domain/stage-entrance.js) with a 2D canvas; the timeline
// decides what shows when. Nothing is written: the entrance is not part of the story or of a page's playback.
const TAVERN_ENTRANCE_START_MS = 3000, TAVERN_ENTRANCE_AFTER_COVER_MS = 8000, TAVERN_ENTRANCE_SLACK_MS = 4000;
// The keys that turn a page skip the entrance; the stage's other keys wait until it is shown. Browser shortcuts pass.
const TAVERN_ENTRANCE_KEYS = new Set(["Enter", " ", "ArrowRight", "ArrowDown", "PageDown"]);
const TAVERN_ENTRANCE_HELD = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "Escape", "Home", "End"]);

// Draws one frame of the shown values on a 2D context (w x h device px). Throws when the canvas has no 2D context.
function tavernEntrancePainter(canvas, doc) {
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2D canvas unavailable");
	const color = name => doc.palette[name];
	const rgba = (name, alpha) => { const hex = color(name), n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + Math.max(0, Math.min(1, alpha)) + ")"; };
	const hash = k => { const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
	return function draw(shown) {
		const w = canvas.width, hgt = canvas.height, v = shown.values, layers = doc.layers;
		const fx = doc.focus[0] * w, fy = doc.focus[1] * hgt, zoom = 1 + Math.max(-0.9, v.zoom), reach = Math.hypot(Math.max(fx, w - fx), Math.max(fy, hgt - fy));
		ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
		ctx.fillStyle = color(doc.background); ctx.fillRect(0, 0, w, hgt);
		ctx.globalCompositeOperation = "lighter";
		if (layers.streams && v.streams > 0) {
			// Streams fly out of the focus along fixed rays: log-radius travel, faster and longer the further out.
			const s = layers.streams, n = s.count, len = s.length === undefined ? 0.5 : s.length;
			ctx.lineCap = "round"; ctx.lineWidth = (s.width || 1) * hgt / 1080; ctx.strokeStyle = color(s.color);
			for (let k = 0; k < n; k++) {
				const at = (hash(k) + shown.travel * (0.08 + 0.05 * hash(k + 7))) % 1, r0 = reach * at * at * zoom, r1 = r0 * (1 + len * at);
				const angle = hash(k + 3) * Math.PI * 2 + shown.turn, cos = Math.cos(angle), sin = Math.sin(angle);
				ctx.globalAlpha = Math.min(1, v.streams * at * 0.6);
				ctx.beginPath(); ctx.moveTo(fx + cos * r0, fy + sin * r0); ctx.lineTo(fx + cos * r1, fy + sin * r1); ctx.stroke();
			}
		}
		if (layers.rings && v.rings > 0) {
			const r = layers.rings, count = r.count || 1;
			ctx.lineWidth = Math.max(1, r.width * hgt); ctx.strokeStyle = color(r.color);
			for (let i = 0; i < count; i++) {
				const grow = (i / count + shown.travel * 0.12) % 1, radius = r.radius * hgt * v.ringSize * zoom * (0.4 + grow * 1.6);
				ctx.globalAlpha = Math.min(1, v.rings * (1 - grow) * 0.7);
				ctx.beginPath(); ctx.arc(fx, fy, radius, 0, Math.PI * 2); ctx.stroke();
			}
		}
		if (layers.light && v.light > 0) {
			const l = layers.light, core = l.radius * hgt * Math.max(0.05, v.lightSize) * zoom, halo = core * (1 + (l.halo === undefined ? 1 : l.halo) * 6);
			const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, halo);
			glow.addColorStop(0, rgba(l.core || l.color, Math.min(1, v.light))); glow.addColorStop(Math.min(0.99, core / halo), rgba(l.color, Math.min(1, v.light * 0.8))); glow.addColorStop(1, rgba(l.color, 0));
			ctx.globalAlpha = 1; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(fx, fy, halo, 0, Math.PI * 2); ctx.fill();
		}
		if (layers.flare && v.flare > 0) {
			const f = layers.flare, rays = f.rays || 0, length = hgt * 0.35 * Math.min(4, v.flare);
			ctx.strokeStyle = color(f.color); ctx.lineWidth = Math.max(1, hgt / 540);
			for (let i = 0; i < rays; i++) {
				const angle = i / rays * Math.PI * 2 + shown.turn * 0.5;
				ctx.globalAlpha = Math.min(1, v.flare * 0.25);
				ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.cos(angle) * length, fy + Math.sin(angle) * length); ctx.stroke();
			}
		}
		ctx.globalCompositeOperation = "source-over";
		if (layers.vignette && v.vignette > 0) {
			const edge = ctx.createRadialGradient(fx, fy, reach * 0.35, fx, fy, reach);
			edge.addColorStop(0, rgba(layers.vignette.color, 0)); edge.addColorStop(1, rgba(layers.vignette.color, v.vignette));
			ctx.globalAlpha = 1; ctx.fillStyle = edge; ctx.fillRect(0, 0, w, hgt);
		}
		if (v.flash > 0) { ctx.globalAlpha = Math.min(1, v.flash); ctx.fillStyle = color(layers.flash.color); ctx.fillRect(0, 0, w, hgt); }
		ctx.globalAlpha = 1;
	};
}

// The stage's one entrance hook: { element, active }. `entrance` is castStage's (null: none); `ready` the stage has its data.
// One run per stage opening, fixed as it opens; a later settings change waits for the next opening.
function useTavernStageEntrance(entrance, ready) {
	const run = React.useMemo(() => entrance && entrance.document ? { doc: entrance.document, name: entrance.name,
		reduced: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches } : null, []);
	const [status, setStatus] = React.useState({ started: false, covered: false, done: false, failed: false });
	const patch = React.useCallback(change => setStatus(current => ({ ...current, ...change })), []);
	const active = !!run && !status.done && !status.failed;
	// Never a held stage: no first frame, no cover once ready, or no end after the cover drops the entrance.
	React.useEffect(() => {
		if (!active) return undefined;
		const left = !status.started ? TAVERN_ENTRANCE_START_MS : ready && !status.covered ? stageEntranceDuration(run.doc) + TAVERN_ENTRANCE_SLACK_MS
			: status.covered ? TAVERN_ENTRANCE_AFTER_COVER_MS : 0;
		if (!left) return undefined;
		const timer = setTimeout(() => patch(status.covered ? { done: true } : { failed: true }), left);
		return () => clearTimeout(timer);
	}, [active, status.started, status.covered, ready]);
	const onEvent = React.useCallback(event => {
		if (event.type === "started") patch({ started: true });
		else if (event.type === "cover") patch({ covered: true });
		else if (event.type === "done") patch({ done: true });
		else if (event.type === "error") { console.warn("入场演出不可用：", event.message); patch({ failed: true }); }
	}, []);
	return { active, element: active ? React.createElement(TavernStageEntrance, { key: "entrance", run, ready, covered: status.covered, started: status.started, onEvent }) : null };
}

function TavernStageEntrance(props) {
	const h = React.createElement, { run, covered, onEvent } = props;
	const root = React.useRef(null), canvas = React.useRef(null), input = React.useRef({ ready: false, skip: false, revealed: false });
	if (props.ready) input.current.ready = true;
	React.useLayoutEffect(() => {
		let stopped = false, frame = 0, last = null, state, draw;
		// Resizing clears a canvas: only a real size change does (the observer's first call is the same size).
		const fit = () => {
			const box = root.current.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1), c = canvas.current;
			const w = Math.max(1, Math.round(box.width * ratio)), hgt = Math.max(1, Math.round(box.height * ratio));
			if (c.width !== w || c.height !== hgt) { c.width = w; c.height = hgt; }
		};
		try { fit(); draw = tavernEntrancePainter(canvas.current, run.doc); state = stageEntranceStart(run.doc, { reduced: run.reduced }); }
		catch (error) { onEvent({ type: "error", message: String(error && error.message || error) }); return undefined; }
		const observer = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
		observer?.observe(root.current);
		let started = false;
		const tick = now => {
			if (stopped) return;
			const dt = last === null ? 0 : Math.min(100, now - last);
			last = now;
			try {
				const result = stageEntranceStep(run.doc, state, dt, input.current);
				input.current.skip = false;
				state = result.state;
				const shown = stageEntranceValues(run.doc, state);
				draw(shown);
				canvas.current.style.opacity = String(shown.values.fade);
				if (!started) { started = true; onEvent({ type: "started" }); }
				result.events.forEach(onEvent);
			} catch (error) { stopped = true; onEvent({ type: "error", message: String(error && error.message || error) }); return; }
			if (!state.done) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => { stopped = true; cancelAnimationFrame(frame); observer?.disconnect(); };
	}, [run]);
	// The stage is shown under the cover: once that frame has painted, the cover may hand off.
	React.useEffect(() => {
		if (!covered) return undefined;
		let second = 0;
		const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { input.current.revealed = true; }); });
		return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
	}, [covered]);
	const skip = () => { if (!covered && input.current.ready) input.current.skip = true; };
	// After the cover the stage is shown: its keys and clicks are its own again.
	React.useEffect(() => {
		if (covered) return undefined;
		const onKey = event => {
			if (event.ctrlKey || event.altKey || event.metaKey) return;
			const page = TAVERN_ENTRANCE_KEYS.has(event.key);
			if (!page && !TAVERN_ENTRANCE_HELD.has(event.key)) return;
			event.preventDefault(); event.stopPropagation();
			if (page && !event.repeat) skip();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [covered]);
	const swallow = event => event.stopPropagation();
	// Until its first frame the element is the document's backdrop colour; after the cover it no longer takes clicks.
	return h("div", { ref: root, className: "dsh-tavern-stage-entrance", "aria-hidden": true, "data-started": props.started || undefined, "data-covered": covered || undefined,
		style: props.started ? undefined : { backgroundColor: run.doc.palette[run.doc.background] },
		onClick: event => { event.stopPropagation(); skip(); }, onWheel: swallow, onPointerDown: swallow },
		h("canvas", { ref: canvas, className: "dsh-tavern-stage-entrance-canvas" }));
}

// 舞台素材: an entrance has no file to show; its list row shows its colours, its page a still frame drawn by the stage's painter.
const TAVERN_ENTRANCE_LAMPS = Object.freeze(["constant", "off"]);
function TavernEntranceSwatch(props) {
	const doc = props.document, light = doc && doc.layers.light, x = doc ? doc.focus[0] * 100 : 50, y = doc ? doc.focus[1] * 100 : 50;
	const style = doc ? { background: "radial-gradient(circle at " + x + "% " + y + "%, " + doc.palette[light ? light.core || light.color : doc.layers.flash.color] + " 0, "
		+ doc.palette[light ? light.color : doc.layers.flash.color] + " 12%, " + doc.palette[doc.background] + " 62%)" } : undefined;
	return React.createElement("span", { className: "dsh-tavern-entrance-art", style, "aria-hidden": true });
}
function TavernEntranceStill(props) {
	const ref = React.useRef(null), doc = props.document;
	React.useEffect(() => {
		try { tavernEntrancePainter(ref.current, doc)(stageEntranceStill(doc)); } catch (error) { console.warn("入场演出预览不可用：", error); }
	}, [JSON.stringify(doc)]);
	return React.createElement("canvas", { ref, className: "dsh-tavern-entrance-still", width: 640, height: 360, "aria-hidden": true });
}
function TavernEntranceDetail(props) {
	const h = React.createElement, asset = props.asset, pack = props.pack;
	const [error, setError] = React.useState(""), [confirm, setConfirm] = React.useState(false);
	const write = update => { setError(""); return props.commit("entrances", asset.id, update).catch(err => setError(tavernAssetErrorText(err))); };
	const menu = h(TavernAssetMenu, { label: asset.name + " 操作", trigger: m => h(TavernAssetIconButton, { icon: "more", label: "更多操作 " + asset.name, "aria-expanded": m.open, disabled: props.busy, onClick: m.toggle }),
		content: close => h(TavernAssetMenuItem, { danger: true, onClick: () => { close(); setConfirm(true); } }, "删除…") });
	const seconds = Math.round(stageEntranceDuration(asset.entrance) / 100) / 10;
	return h("div", { className: "dsh-tavern-entry-detail", "data-disabled": asset.enabled === false || undefined },
		h("div", { className: "dsh-tavern-entry-title" },
			props.back ? h("button", { type: "button", className: "dsh-tavern-asset-icon dsh-tavern-asset-back", "aria-label": "返回" + props.back.parent, title: "返回" + props.back.parent, onClick: props.back.onBack }, h(TavernAssetGlyph, { name: "back" })) : null,
			h(TavernAssetText, { key: asset.name, className: "is-title", label: "名称", value: asset.name, validate: value => !value ? "名称不能为空" : tavernAssetChars(value) > 256 ? "名称最多 256 字" : "", onCommit: value => write(current => ({ ...current, name: value })) }),
			menu),
		h(TavernAssetAlert, { error }),
		h("div", { className: "dsh-tavern-entrance-hero" }, h(TavernEntranceStill, { document: asset.entrance })),
		h("div", { className: "dsh-tavern-asset-fields", role: "group", "aria-label": asset.name + " 设置" },
			h(TavernAssetField, { label: "触发策略", help: TAVERN_ASSET_HELP.entrance },
				h(TavernLampMenu, { named: true, modes: TAVERN_ENTRANCE_LAMPS, mode: tavernEntryLamp(asset), label: "触发策略", onChange: mode => write(current => tavernSetEntryLamp(current, mode)) })),
			h(TavernAssetField, { label: "时长" }, h("span", null, "约 " + seconds + " 秒"))),
		confirm ? h(TavernAssetConfirm, { title: "删除入场演出「" + asset.name + "」？", body: "从素材包「" + pack.manifest.name + "」中删除，用到这个素材包的卡打开舞台时不再播放它。",
			confirmLabel: "删除", danger: true, onConfirm: () => props.remove(asset), onClose: () => setConfirm(false) }) : null);
}