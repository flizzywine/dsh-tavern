// 故事楼层的右侧快速跳转。
//
// 故事视图是唯一展示模式：每一层正文就是页面上的一个 [data-story-row]，楼层号写在
// data-floor 上（第 N 楼）。刻度直接照页面画，一层一根，点哪根就滚到哪一层：
//  - 不再经过宿主那列按 turn 画的目录：重试、撤回、被取代的尝试轮也各占一根，点了
//    要么落空、要么只滚一段；
//  - 已经滚过滚动区顶部的那一层就是当前层，随滚动跟着走；
//  - 宿主那列仍然收起来，免得两列刻度并排；窄屏（900px 以下）不占地方。
function createStoryFloorRail(root, options) {
	const host = (options && options.window) || (typeof window !== "undefined" ? window : null);
	const doc = host && host.document || (root && root.ownerDocument) || (typeof document !== "undefined" ? document : null);
	const scope = (root && root.closest && root.closest("[data-conversation-scroll]")) || root || (doc && doc.body);
	const hiddenAttribute = "data-dsh-tavern-rail-hidden";
	const label = (options && options.label) || "楼层跳转";
	const jumpLabel = (options && options.jumpLabel) || "跳到第 {floor} 楼";
	const narrow = (options && options.narrow) || 900;
	let rail = null, frame = 0, floorsKey = "";
	const ticks = new Map(); // floor -> { button, row }
	function floorOf(row) {
		const value = Number(row.getAttribute("data-floor"));
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	function rows() {
		return Array.from(scope.querySelectorAll("[data-story-row][data-floor]")).filter(row => floorOf(row) !== null);
	}
	function rowOf(floor) {
		const tick = ticks.get(floor);
		if (tick && tick.row && tick.row.isConnected) return tick.row;
		return rows().find(row => floorOf(row) === floor) || null;
	}
	function jump(floor) {
		const row = rowOf(floor);
		if (!row) return;
		try { row.scrollIntoView({ block: "start", behavior: "smooth" }); }
		catch (error) { row.scrollIntoView(true); }
	}
	// 当前层：最后一个已经滚过顶部（或正好在顶部）的楼层。行按楼层顺序排，第一根落在
	// 顶部以下的就停，不必整页扫完。
	function current(list) {
		if (!list.length) return null;
		const top = scope.getBoundingClientRect().top;
		let found = null;
		for (const row of list) {
			if (row.getBoundingClientRect().top - top <= 8) found = floorOf(row);
			else break;
		}
		return found === null ? floorOf(list[0]) : found;
	}
	function build(list) {
		const box = doc.createElement("nav");
		box.className = "dsh-tavern-turn-rail";
		box.setAttribute("aria-label", label);
		ticks.clear();
		for (const row of list) {
			const floor = floorOf(row);
			if (ticks.has(floor)) continue;
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "dsh-tavern-turn-rail-tick";
			button.setAttribute("data-floor", String(floor));
			button.setAttribute("aria-label", jumpLabel.replace("{floor}", String(floor)));
			button.setAttribute("title", jumpLabel.replace("{floor}", String(floor)));
			button.addEventListener("click", function () { jump(floor); });
			ticks.set(floor, { button, row });
			box.appendChild(button);
		}
		return box;
	}
	function mirror(list) {
		const active = current(list);
		for (const [floor, tick] of ticks) {
			if (floor === active) tick.button.setAttribute("data-active", "");
			else tick.button.removeAttribute("data-active");
		}
	}
	function place() {
		if (!rail) return;
		const rect = scope.getBoundingClientRect();
		const visible = rect.width > narrow && rect.height > 96;
		rail.hidden = !visible;
		if (!visible) return;
		rail.style.right = Math.max(0, Math.round(host.innerWidth - rect.right)) + 12 + "px";
		rail.style.top = Math.round(rect.top + rect.height / 2) + "px";
	}
	function schedule() {
		if (frame) return;
		frame = host.setTimeout(function () { frame = 0; sync(); }, 120);
	}
	function sync() {
		if (frame) { host.clearTimeout(frame); frame = 0; }
		const list = rows();
		// 宿主那列刻度还在 DOM 里（它按 turn 画，跟故事楼层对不上），继续收起来。
		const mark = scope.querySelector('[class*="_mark"][aria-label]');
		const hostNav = mark ? mark.closest("nav") : null;
		if (hostNav && !hostNav.hasAttribute(hiddenAttribute)) hostNav.setAttribute(hiddenAttribute, "");
		const key = list.map(floorOf).join(",");
		if (key !== floorsKey) {
			floorsKey = key;
			if (rail) rail.remove();
			rail = list.length ? build(list) : null;
			if (rail) doc.body.appendChild(rail);
		}
		if (rail) { mirror(list); place(); }
	}
	const observer = host && typeof host.MutationObserver === "function" ? new host.MutationObserver(schedule) : null;
	if (observer) observer.observe(scope, { subtree: true, childList: true });
	const resize = host && typeof host.ResizeObserver === "function" ? new host.ResizeObserver(schedule) : null;
	if (resize) resize.observe(scope);
	const onScroll = function () { schedule(); };
	if (host) {
		host.addEventListener("scroll", onScroll, true);
		host.addEventListener("resize", onScroll);
	}
	return {
		apply: function () { floorsKey = ""; sync(); },
		sync: sync,
		dispose: function () {
			if (observer) observer.disconnect();
			if (resize) resize.disconnect();
			if (host) {
				host.removeEventListener("scroll", onScroll, true);
				host.removeEventListener("resize", onScroll);
			}
			if (frame) { host.clearTimeout(frame); frame = 0; }
			for (const nav of Array.from(scope.querySelectorAll("[" + hiddenAttribute + "]"))) nav.removeAttribute(hiddenAttribute);
			if (rail) rail.remove();
			rail = null; ticks.clear(); floorsKey = "";
		}
	};
}
