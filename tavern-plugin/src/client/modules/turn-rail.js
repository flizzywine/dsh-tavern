// 对话右侧的轮次导航。
//
// 宿主的刻度按整档目录画：重试、撤回、被取代的尝试轮也各占一根，点了要么落空、要么只滚一段。
// 这里把宿主那列收起来，只给「正文行计划说这一轮画了正文」的轮次画刻度：
//  - 点刻度：这一轮的行已经在页面里就滚到它的开头；
//  - 不在页面里：自动按「加载更早」往前翻（每次等它真的加载完），翻到了再滚过去；
//  - 当前所在的那一轮始终保留；悬浮预览仍用宿主那份（输入 + 正文）。
function createTurnRailFilter(root, options) {
	const host = (options && options.window) || window;
	const doc = host.document || (root && root.ownerDocument) || document;
	const scope = (root && root.closest && root.closest("[data-conversation-scroll]")) || doc.body || doc.documentElement;
	const hiddenAttribute = "data-dsh-tavern-rail-hidden";
	const markSelector = '[class*="_mark"][aria-label]';
	const label = (options && options.label) || "轮次导航";
	const jumpLabel = (options && options.jumpLabel) || "跳转到第 {turn} 轮";
	const narrow = (options && options.narrow) || 900;
	const STEP_MS = 1200;
	const MAX_LOADS = 20;
	let rail = null, frame = 0, accept = null, turnsKey = "", jumping = null;
	const ticks = new Map(); // turn -> { button, mark }
	function turnOf(mark) {
		const match = /第\s*(\d+)\s*轮/.exec(mark.getAttribute("aria-label") || "");
		return match ? Number(match[1]) : null;
	}
	function marks() {
		return Array.from(scope.querySelectorAll(markSelector)).filter(mark => turnOf(mark) !== null);
	}
	function rowsOf(turn) {
		return scope.querySelectorAll('[data-chat-turn="' + turn + '"], [data-turn="' + turn + '"]');
	}
	function rowStart(turn) {
		for (const row of rowsOf(turn)) {
			if (row.getBoundingClientRect().height <= 0) continue;
			return row;
		}
		return null;
	}
	function scrollToTurn(turn) {
		const row = rowStart(turn);
		if (!row) return false;
		try { row.scrollIntoView({ block: "start", behavior: "smooth" }); }
		catch (error) { row.scrollIntoView(true); }
		return true;
	}
	function loadEarlier() {
		const box = scope.querySelector('[class*="_older"]');
		const button = box ? box.querySelector("button") : null;
		if (!button || button.disabled) return false;
		button.click();
		return true;
	}
	function wait(ms) { return new Promise(resolve => host.setTimeout(resolve, ms)); }
	function setBusy(turn, busy) {
		const tick = ticks.get(turn);
		if (!tick) return;
		if (busy) tick.button.setAttribute("data-busy", "");
		else tick.button.removeAttribute("data-busy");
	}
	// 翻历史很慢（一次一两秒），要等它加载完再判断，不能按固定次数数拍子就放弃。
	async function jump(turn, mark) {
		if (jumping === turn) return;
		jumping = turn;
		setBusy(turn, true);
		try {
			if (scrollToTurn(turn)) return;
			mark.click();
			for (let load = 0; load < MAX_LOADS; load++) {
				await wait(STEP_MS);
				if (scrollToTurn(turn)) return;
				if (!loadEarlier()) await wait(STEP_MS);
			}
		} finally {
			setBusy(turn, false);
			jumping = null;
		}
	}
	function preview(mark, on) {
		try {
			if (on) {
				if (typeof host.PointerEvent === "function") mark.dispatchEvent(new host.PointerEvent("pointermove", { bubbles: true }));
				if (typeof host.FocusEvent === "function") mark.dispatchEvent(new host.FocusEvent("focusin", { bubbles: true }));
			} else if (typeof host.PointerEvent === "function") {
				mark.dispatchEvent(new host.PointerEvent("pointerout", { bubbles: true, relatedTarget: doc.body }));
			}
		} catch (error) { /* 预览只是锦上添花，不能挡住跳转 */ }
	}
	function build(turns, marks) {
		const box = doc.createElement("nav");
		box.className = "dsh-tavern-turn-rail";
		box.setAttribute("aria-label", label);
		ticks.clear();
		for (const turn of turns) {
			const mark = marks.find(item => turnOf(item) === turn);
			if (!mark) continue;
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "dsh-tavern-turn-rail-tick";
			button.setAttribute("data-turn", String(turn));
			button.setAttribute("aria-label", jumpLabel.replace("{turn}", String(turn)));
			button.addEventListener("click", function () { void jump(turn, mark); });
			button.addEventListener("pointerenter", function () { preview(mark, true); });
			button.addEventListener("pointerleave", function () { preview(mark, false); });
			button.addEventListener("focus", function () { preview(mark, true); });
			button.addEventListener("blur", function () { preview(mark, false); });
			ticks.set(turn, { button, mark });
			box.appendChild(button);
		}
		return box;
	}
	function mirror(marks) {
		let active = null;
		for (const mark of marks) if (mark.getAttribute("aria-current") === "true") { active = turnOf(mark); break; }
		for (const [turn, tick] of ticks) {
			if (turn === active) tick.button.setAttribute("data-active", "");
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
		const list = marks();
		const hostNav = list.length ? list[0].closest("nav") : null;
		if (hostNav && !hostNav.hasAttribute(hiddenAttribute)) hostNav.setAttribute(hiddenAttribute, "");
		const decided = list.map(mark => ({ mark, turn: turnOf(mark) })).filter(pair => {
			if (pair.mark.getAttribute("aria-current") === "true") return true;
			return accept === null ? true : Boolean(accept(pair.turn));
		});
		const key = decided.map(pair => pair.turn).join(",");
		if (key !== turnsKey) {
			turnsKey = key;
			if (rail) rail.remove();
			rail = decided.length ? build(decided.map(pair => pair.turn), decided.map(pair => pair.mark)) : null;
			if (rail) doc.body.appendChild(rail);
		}
		if (rail) { mirror(list); place(); }
	}
	// 正文行计划决定哪几轮该有刻度（重试/撤回的尝试轮不在其中）。
	function apply(options) {
		accept = options && typeof options.accept === "function" ? options.accept : null;
		turnsKey = "";
		sync();
	}
	const observer = typeof host.MutationObserver === "function" ? new host.MutationObserver(schedule) : null;
	if (observer) observer.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label", "aria-current"] });
	const resize = typeof host.ResizeObserver === "function" ? new host.ResizeObserver(schedule) : null;
	if (resize) resize.observe(scope);
	const onScroll = function () { schedule(); };
	host.addEventListener("scroll", onScroll, true);
	host.addEventListener("resize", onScroll);
	return {
		apply: apply,
		sync: sync,
		dispose: function () {
			if (observer) observer.disconnect();
			if (resize) resize.disconnect();
			host.removeEventListener("scroll", onScroll, true);
			host.removeEventListener("resize", onScroll);
			if (frame) { host.clearTimeout(frame); frame = 0; }
			for (const nav of Array.from(scope.querySelectorAll("[" + hiddenAttribute + "]"))) nav.removeAttribute(hiddenAttribute);
			if (rail) rail.remove();
			rail = null; ticks.clear(); accept = null; turnsKey = "";
		}
	};
}
