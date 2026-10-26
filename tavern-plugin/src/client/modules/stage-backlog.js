// The stage's backlog (履历), pure helpers (features/stage-backlog.js draws it; tests/stage-backlog.test.mjs).
// The rows are what the reader has already seen: every earlier turn the stage holds (castStage `turns`, read-only) and the
// latest turn up to and including the current page. Rows of the latest turn jump the stage back to their page.

// The rows of the panel: a separator per turn, then its pages. The latest turn stops at the current page (never shows pages
// the reader has not reached). turns: castStage `turns` ({ turn, pages }), oldest first; page: the reader's index.
function stageBacklogEntries(turns, page) {
	const out = [];
	const list = turns || [], latest = list.length ? list[list.length - 1] : null;
	const at = latest ? Math.min(Math.max(0, page), Math.max(0, latest.pages.length - 1)) : 0;
	list.forEach(function (item) {
		const current = item === latest, pages = current ? item.pages.slice(0, at + 1) : item.pages;
		if (!pages.length) return;
		out.push({ type: "turn", key: "t" + item.turn, turn: item.turn, current });
		pages.forEach(function (p, index) {
			out.push({ type: "page", key: "p" + item.turn + ":" + index, turn: item.turn, page: index, current, here: current && index === at,
				kind: p.kind, speaker: p.speaker || "", emotion: p.emotion || "", text: p.text, quotes: p.quotes || [], ...(p.voice !== undefined ? { voice: p.voice } : {}) });
		});
	});
	return out;
}

// The rendered window of a long list: prefix offsets include estimated heights for unvisited rows; measured rows replace them.
function stageBacklogWindow(offsets, scrollTop, height, overscan) {
	const count = offsets.length - 1;
	if (count <= 0) return { start: 0, end: 0 };
	const top = Math.max(0, Math.min(scrollTop, Math.max(0, offsets[count] - height)));
	function at(value) {
		let lo = 0, hi = count;
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid + 1] <= value) lo = mid + 1; else hi = mid; }
		return lo;
	}
	return { start: Math.max(0, at(top) - overscan), end: Math.min(count, at(Math.max(top, top + height - 0.001)) + 1 + overscan) };
}

// The stage's wheel: up opens the backlog, down turns a page - or, while the page's line is still typing (event.typed false),
// finishes it, as a click does. Consume wheel notches, never queue a burst for later: a gesture is quiet for 300 ms, and its
// first downward step locks the rest of that gesture.
function stageWheelDecision(previous, event) {
	const now = event.now, dy = Number(event.deltaY);
	if (!Number.isFinite(dy) || !dy) return { state: previous, action: "none" };
	const direction = Math.sign(dy);
	const fresh = !previous || previous.direction !== direction || now - previous.lastEvent >= 300 || now < previous.lastEvent;
	const state = fresh ? { direction, lastEvent: now, delta: 0, used: false } : { ...previous, lastEvent: now };
	const pixels = Math.abs(dy) * (event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? 100 : 1);
	state.delta += pixels;
	if (state.delta < 100) return { state, action: "none" };
	state.delta %= 100;
	if (direction < 0) return { state, action: "backlog" };
	if (state.used) return { state, action: "none" };
	state.used = true;
	return { state, action: event.typed ? "advance" : "finish" };
}
