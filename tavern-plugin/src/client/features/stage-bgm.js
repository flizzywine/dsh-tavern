// The BGM player in the page (docs/design/cast-presentation.md「背景音乐」): one panel, two placements. In the
// fullscreen stage the 「♪ 曲名」 chip on the control bar opens it; in chat a header chip does (only for a game whose
// stage is on). State: tavernBgm (modules/stage-bgm.js); transport: tavernStageMusic (modules/stage-music.js).
// The panel has no volume slider: a track sounds at its entry's 音量, then the 背景音乐 layer and 总音量 (features/stage-audio.js).
const tavernStageMusic = createStageMusic({ context: () => tavernStageAudio.context(), fetch: (url, init) => window.fetch(url, init), output: ctx => tavernStageAudio.output(ctx, "music"),
	clock: { now: () => performance.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: id => window.clearTimeout(id) } });
const tavernBgm = createStageBgm({ music: tavernStageMusic, sessions: tavernStageRuntime, read: id => rpc("getStageMusicTracks", {}, id),
	storage: (() => { try { return localStorage; } catch (_) { return null; } })() });
// The player follows the game the main view shows; with no game open nothing plays.
function startTavernBgm(sessions) {
	const follow = () => tavernBgm.activate(selectedStageSession(sessions.list.getSnapshot()));
	const stop = sessions.list.subscribe(follow);
	follow();
	const wake = () => tavernStageAudio.wake();
	document.addEventListener("pointerdown", wake, true);
	document.addEventListener("keydown", wake, true);
	return () => {
		stop(); tavernBgm.dispose();
		document.removeEventListener("pointerdown", wake, true);
		document.removeEventListener("keydown", wake, true);
	};
}
function useTavernBgm() { return React.useSyncExternalStore(tavernBgm.subscribe, tavernBgm.get, tavernBgm.get); }

// Focus moves in on open; Esc or a click outside closes. On the stage that click only dismisses: it does not
// also turn the page.
function useTavernBgmPopover(open, close, chip, panel, stage) {
	React.useEffect(function () {
		if (!open) return undefined;
		const first = panel.current && panel.current.querySelector(".dsh-tavern-bgm-play:not(:disabled), input, button");
		if (first) first.focus({ preventScroll: true });
		function done(refocus) { close(); if (refocus && chip.current) chip.current.focus(); }
		function onKey(event) { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); done(true); } }
		function swallow(event) { event.stopPropagation(); event.preventDefault(); }
		let timer = 0;
		function outside(event) {
			if ((panel.current && panel.current.contains(event.target)) || (chip.current && chip.current.contains(event.target))) return;
			done(false);
			if (stage && !(event.target && event.target.closest && event.target.closest("button, input, select, textarea, a"))) {
				document.addEventListener("click", swallow, { capture: true, once: true });
				timer = setTimeout(() => document.removeEventListener("click", swallow, true), 600);
			}
		}
		window.addEventListener("keydown", onKey, true);
		document.addEventListener("pointerdown", outside, true);
		return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", outside, true); clearTimeout(timer); };
	}, [open]);
}

// The player: now playing + 导演选曲, transport, a searchable list (the card's packs, in order).
function TavernBgmPanel(props) {
	const h = React.createElement, s = useTavernBgm();
	const [query, setQuery] = React.useState("");
	React.useEffect(() => { tavernBgm.invalidate(); }, []);
	const list = stageBgmSearch(s.tracks, query), playing = Boolean(s.current && !s.paused);
	const stop = event => event.stopPropagation();
	const control = (icon, label, action, disabled, className) => h("button", { type: "button", className: "dsh-tavern-bgm-button" + (className ? " " + className : ""),
		title: label, "aria-label": label, disabled: Boolean(disabled), onClick: action }, h(TavernStageGlyph, { name: icon }));
	function arrows(event) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const rows = Array.from(event.currentTarget.querySelectorAll("button")), at = rows.indexOf(document.activeElement);
		const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
		if (next) { event.preventDefault(); next.focus(); }
	}
	return h("div", { ref: props.panelRef, className: "dsh-tavern-bgm-panel" + (props.chat ? " is-chat" : ""), style: props.style, role: "dialog", "aria-label": "BGM",
		onClick: stop, onWheel: stop, onContextMenu: stop, onKeyDown: stop },
		h("div", { className: "dsh-tavern-bgm-head" },
			h("b", { className: "dsh-tavern-bgm-title", title: s.current ? s.current.name : "" }, s.current ? s.current.name : "BGM"),
			h("label", { className: "dsh-tavern-bgm-follow", title: "导演选曲" },
				h("input", { type: "checkbox", role: "switch", checked: s.follow, disabled: !s.enabled, onChange: event => tavernBgm.follow(event.target.checked) }),
				h(TavernStageGlyph, { name: "stage" }), h("span", null, "导演选曲"))),
		!s.enabled ? h("div", { className: "dsh-tavern-bgm-off" }, h("span", null, "BGM 已关闭"),
			h("span", { className: "dsh-tavern-bgm-hint" }, "在 舞台设置 › 基础设置 打开")) :
		h(React.Fragment, null,
			h("div", { className: "dsh-tavern-bgm-controls" },
				control("prev", "上一首", () => tavernBgm.step(-1), !s.tracks.length),
				control(playing ? "pause" : "play", playing ? "暂停" : "播放", () => tavernBgm.pause(playing), !s.current, "dsh-tavern-bgm-play"),
				control("next", "下一首", () => tavernBgm.step(1), !s.tracks.length)),
			h("input", { type: "search", className: "dsh-tavern-bgm-search", value: query, placeholder: "搜索", "aria-label": "搜索曲目", onChange: event => setQuery(event.target.value) }),
			s.error ? h("p", { className: "dsh-tavern-bgm-error", role: "alert" }, "载入失败") : null,
			list.length ? h("ul", { className: "dsh-tavern-bgm-list", "aria-label": "曲目", onKeyDown: arrows },
				list.map(track => h("li", { key: track.key },
					h("button", { type: "button", className: "dsh-tavern-bgm-track", "aria-current": s.current && s.current.key === track.key ? "true" : undefined,
						title: track.pack || track.name, onClick: () => tavernBgm.pick(track.key) },
						h("span", null, track.name),
						s.cue && s.cue.key === track.key ? h("span", { className: "dsh-tavern-bgm-cue", role: "img", title: "导演选曲", "aria-label": "导演选曲" }, h(TavernStageGlyph, { name: "stage" })) : null))))
				: h("p", { className: "dsh-tavern-bgm-empty" }, s.loading ? "正在载入…" : query ? "无匹配" : "暂无曲目")));
}

// The chip: ♪ and the track's name (only ♪ with no track); faded while paused or switched off.
function tavernBgmChip(h, s, ref, open, onClick, className) {
	return h("button", { ref, type: "button", className: "dsh-tavern-bgm-chip" + (className ? " " + className : "") + (s.paused || !s.enabled || !s.current ? " is-paused" : ""),
		title: "BGM", "aria-label": "BGM" + (s.current ? "：" + s.current.name : ""), "aria-haspopup": "dialog", "aria-expanded": open, onClick },
		h(TavernStageGlyph, { name: "music" }), s.current ? h("span", null, s.current.name) : null);
}

// Stage placement: the chip on the control bar; the panel opens above it.
function TavernBgmStage(props) {
	const h = React.createElement, s = useTavernBgm();
	const [open, setOpen] = React.useState(false);
	const chip = React.useRef(null), panel = React.useRef(null);
	useTavernBgmPopover(open, () => setOpen(false), chip, panel, true);
	if (s.sessionId !== props.sessionId) return null;
	return h("span", { className: "dsh-tavern-bgm-anchor" }, tavernBgmChip(h, s, chip, open, () => setOpen(!open)),
		open ? h(TavernBgmPanel, { panelRef: panel }) : null);
}

// Chat placement: a header chip (only for a game whose stage is on) and the same panel, anchored under it.
function TavernBgmChat(props) {
	const h = React.createElement, s = useTavernBgm();
	const [open, setOpen] = React.useState(false), [place, setPlace] = React.useState(null);
	const chip = React.useRef(null), panel = React.useRef(null);
	useTavernBgmPopover(open, () => setOpen(false), chip, panel, false);
	React.useLayoutEffect(function () {
		if (!open || !chip.current) { setPlace(null); return; }
		const rect = chip.current.getBoundingClientRect(), width = Math.min(340, window.innerWidth - 16);
		setPlace({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + 6, width, maxHeight: window.innerHeight - rect.bottom - 18 });
	}, [open]);
	if (s.sessionId !== props.sessionId || !s.available) return null;
	return h(React.Fragment, null, tavernBgmChip(h, s, chip, open, () => setOpen(!open), "dsh-tavern-btn is-chat"),
		open && place ? require("react-dom").createPortal(h(TavernBgmPanel, { chat: true, panelRef: panel, style: place }), document.body) : null);
}
