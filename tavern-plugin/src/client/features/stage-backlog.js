// The stage's backlog (履历, docs/design/cast-presentation.md「舞台 core（24/N）：履历」): a sheet over the dimmed stage
// listing what the reader has already seen - every earlier turn the stage holds (read-only) and the latest turn up to and
// including the current page (modules/stage-backlog.js stageBacklogEntries). A row of the latest turn jumps the stage back to
// its page; a spoken line has its speaker's avatar, name and the chat's 朗读 control. It reads the stage's own data and never
// writes story, variables or prompts. Drawn only in the stage's UI tokens (--gal-ui-*).

// props: { sessionId, data (the stage's castStage data), page (the reader's index), onJump(page, turn), onClose() }.
// Mounted only while open.
function TavernStageBacklog(props) {
	const h = React.createElement;
	const scroller = React.useRef(null);
	const openedAt = React.useRef(Date.now());
	const movedAt = React.useRef(0);
	const [, redraw] = React.useState(0);
	const data = props.data;
	const entries = React.useMemo(() => stageBacklogEntries(data.turns, props.page), [data.turns, props.page]);
	const heights = React.useRef(new Map());
	const nodes = React.useRef(new Map());
	const pendingFocus = React.useRef(null);
	const pendingScroll = React.useRef(null);
	const anchorRow = React.useRef(null);
	const [viewport, setViewport] = React.useState({ top: Infinity, height: 800 });
	const estimate = entry => entry.type === "turn" ? 54 : 100;
	const offsets = [0];
	entries.forEach(entry => offsets.push(offsets[offsets.length - 1] + (heights.current.get(entry.key) || estimate(entry))));
	const range = stageBacklogWindow(offsets, viewport.top, viewport.height, 20);
	function readViewport() {
		const box = scroller.current;
		if (!box) return;
		const top = box.scrollTop, height = box.clientHeight;
		// Layout corrections, scroll events and ResizeObserver can report the same viewport.
		setViewport(previous => previous.top === top && previous.height === height ? previous : { top, height });
	}
	// Rows inserted or dropped above the first visible row (a new turn arriving moves the stage's window of turns) keep that
	// row where the reader sees it, instead of pushing the page.
	React.useLayoutEffect(function () {
		const box = scroller.current, previous = anchorRow.current;
		if (!box) return;
		if (previous && previous.entries !== entries && viewport.top !== Infinity && pendingScroll.current == null) {
			const index = entries.findIndex(entry => entry.key === previous.key);
			const shift = index >= 0 ? offsets[index] - previous.offset : 0;
			if (Math.abs(shift) > 0.5) { box.scrollTop += shift; readViewport(); }
		}
		const first = stageBacklogWindow(offsets, box.scrollTop, box.clientHeight, 0).start;
		anchorRow.current = { entries, key: entries[first]?.key, offset: offsets[first] || 0 };
	});
	// The measuring pass: rendered rows replace their estimates; rows above the first visible one keep it in place.
	React.useLayoutEffect(function () {
		const box = scroller.current;
		if (!box) return;
		if (pendingScroll.current != null) {
			const target = pendingScroll.current;
			pendingScroll.current = null;
			box.scrollTop = target === Infinity ? box.scrollHeight : target;
			readViewport();
		}
		const atEnd = viewport.top === Infinity || box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
		const anchor = stageBacklogWindow(offsets, viewport.top, viewport.height, 0).start;
		let changed = false, shift = 0;
		for (let i = range.start; i < range.end; i++) {
			const node = nodes.current.get(i), next = nodes.current.get(i + 1);
			if (!node) continue;
			const height = next ? next.offsetTop - node.offsetTop : node.getBoundingClientRect().height + parseFloat(getComputedStyle(node).marginBottom);
			const previous = heights.current.get(entries[i].key) || estimate(entries[i]);
			// offsetTop rounds each edge separately: a spacer shift can change their difference by one pixel without
			// resizing the row. Do not feed that jitter back into anchoring.
			if (height > 0 && Math.abs(height - previous) > 1) {
				heights.current.set(entries[i].key, height); changed = true;
				if (i < anchor) shift += height - previous;
			}
		}
		if (changed) {
			// Apply the anchor correction after React replaces the two spacer heights.
			pendingScroll.current = atEnd ? Infinity : box.scrollTop + shift;
			redraw(n => n + 1);
		} else if (pendingFocus.current != null) {
			const node = nodes.current.get(pendingFocus.current.index);
			if (node) {
				const focus = pendingFocus.current, buttons = node.querySelectorAll("button:not([disabled])");
				(focus.last ? buttons[buttons.length - 1] || node : node).focus({ preventScroll: true });
				pendingFocus.current = null;
			}
		}
	});
	React.useEffect(function () {
		const box = scroller.current;
		if (!box || typeof ResizeObserver !== "function") return undefined;
		let width = box.clientWidth, frame = 0;
		const observer = new ResizeObserver(function () {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(function () {
				if (width !== box.clientWidth) { width = box.clientWidth; heights.current.clear(); }
				readViewport();
			});
		});
		observer.observe(box);
		nodes.current.forEach(node => observer.observe(node));
		return () => { cancelAnimationFrame(frame); observer.disconnect(); };
	}, [range.start, range.end]);
	// Tab past the last rendered row (or Shift+Tab before the first) scrolls the next row in and focuses it.
	function onListKey(event) {
		if (event.key !== "Tab") return;
		const box = scroller.current, active = document.activeElement;
		const items = Array.from(box.querySelectorAll('[tabindex="0"], button:not([disabled])'));
		if (active !== (event.shiftKey ? items[0] : items[items.length - 1])) return;
		const step = event.shiftKey ? -1 : 1;
		let index = event.shiftKey ? range.start - 1 : range.end;
		while (index >= 0 && index < entries.length && entries[index].type !== "page") index += step;
		if (index < 0 || index >= entries.length) return;
		event.preventDefault(); event.stopPropagation();
		pendingFocus.current = { index, last: event.shiftKey };
		box.scrollTop = offsets[index];
		readViewport();
	}
	// Opens with the current page (the last row) at the bottom, keyboard scrolling ready.
	React.useLayoutEffect(function () {
		const box = scroller.current;
		if (!box) return;
		box.scrollTop = box.scrollHeight;
		box.focus({ preventScroll: true });
		readViewport();
	}, []);
	// Wheel down past the end closes (galgame convention); a gesture still scrolling does not.
	function onWheel(event) {
		event.stopPropagation();
		const box = scroller.current;
		if (!box || !Number.isFinite(event.deltaY) || event.deltaY <= 0) return;
		const now = Date.now();
		const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
		if (atEnd && now - movedAt.current > 220 && now - openedAt.current > 300) props.onClose();
	}
	function row(entry, index) {
		const ref = node => { if (node) nodes.current.set(index, node); else nodes.current.delete(index); };
		if (entry.type === "turn") return h("div", { key: entry.key, ref, className: "dsh-tavern-stage-backlog-turn" + (entry.current ? " is-current" : ""), role: "separator" },
			h("span", null, "第 " + entry.turn + " 轮" + (entry.current ? " · 本轮" : "")));
		const line = entry.kind === "line", jump = entry.current;
		const avatar = line ? tavernCastAvatar(data, entry.speaker, entry.emotion) : "";
		const go = () => props.onJump(entry.page, entry.turn);
		// The voice control follows the speaker's name when the line has words to say; narration has no name and no voice.
		const speech = line ? tavernPageSpeech(entry, data) : "";
		const nameRow = line ? h("div", { className: "dsh-tavern-stage-backlog-name" }, h("b", null, entry.speaker),
			speech ? h(TavernCastSpeak, { sessionId: props.sessionId, speaker: entry.speaker, text: speech, emotion: entry.emotion }) : null) : null;
		const face = h("div", { className: "dsh-tavern-stage-backlog-face" }, line && avatar ? h(TavernStageBacklogFace, { key: avatar, src: avatar }) : null);
		return h("div", { key: entry.key, ref, className: "dsh-tavern-stage-backlog-row" + (line ? " is-line" : " is-narration") + (jump ? " is-jump" : " is-past") + (entry.here ? " is-here" : ""),
			style: line ? { "--dsh-cast-hue": tavernCastHue(entry.speaker) } : undefined,
			role: jump ? "button" : undefined, tabIndex: jump ? 0 : undefined, title: jump ? (entry.here ? "当前这一页（点击回到舞台）" : "回到这一页") : undefined,
			"aria-current": entry.here ? "true" : undefined, "data-turn": entry.turn, "data-page": entry.page + 1,
			onClick: jump ? go : undefined,
			onKeyDown: jump ? event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); go(); } } : undefined },
			face, h("div", { className: "dsh-tavern-stage-backlog-body" }, nameRow, h("p", { className: "dsh-tavern-stage-backlog-text" }, entry.text)));
	}
	return h("div", { className: "dsh-tavern-stage-backlog", role: "dialog", "aria-modal": "true", "aria-label": "履历",
		onClick: event => event.stopPropagation(),
		onContextMenu: event => { event.preventDefault(); event.stopPropagation(); props.onClose(); },
		onWheel },
		h("div", { className: "dsh-tavern-stage-backlog-head" },
			h("div", { className: "dsh-tavern-stage-backlog-title", title: "点击本轮的句子回到那一页；滚轮向下到底、右键或 Esc 关闭" },
				h("i", { className: "dsh-tavern-stage-backlog-gem", "aria-hidden": true }), h("b", null, "履历"), h("small", null, "BACKLOG")),
			h("button", { type: "button", className: "dsh-tavern-stage-backlog-close", title: "关闭（Esc / 右键）", "aria-label": "关闭履历", onClick: props.onClose }, h(TavernStageGlyph, { name: "close" }))),
		// The measuring pass owns anchoring; native anchoring can undo it as spacer margins change.
		h("div", { className: "dsh-tavern-stage-backlog-list", ref: scroller, style: { overflowAnchor: "none" }, tabIndex: 0, "aria-label": "已读内容",
			onKeyDown: onListKey, onScroll: () => { movedAt.current = Date.now(); readViewport(); } },
			h("div", { className: "dsh-tavern-stage-backlog-col" },
				h("div", { "aria-hidden": true, style: { height: offsets[range.start] } }),
				entries.length ? entries.slice(range.start, range.end).map((entry, index) => row(entry, range.start + index)) : h("p", { className: "dsh-tavern-stage-backlog-empty" }, "还没有可以回看的内容"),
				h("div", { "aria-hidden": true, style: { height: offsets[entries.length] - offsets[range.end] } }))));
}

// A row's face: the speaker's avatar for this line's emotion; none when it fails to load.
function TavernStageBacklogFace(props) {
	const [failed, setFailed] = React.useState(false);
	return failed ? null : React.createElement("img", { src: props.src, alt: "", loading: "lazy", draggable: false, onError: () => setFailed(true) });
}
