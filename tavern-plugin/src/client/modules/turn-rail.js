// 故事楼层的右侧快速跳转。
//
// 故事视图是唯一展示模式：每一层正文就是页面上的一个 [data-story-row]，楼层号写在
// data-floor 上（第 N 楼）。刻度直接照页面画，一层一根，点哪根就滚到哪一层：
//  - 不再经过宿主那列按 turn 画的目录：重试、撤回、被取代的尝试轮也各占一根，点了
//    要么落空、要么只滚一段；
//  - 已经滚过滚动区顶部的那一层就是当前层，随滚动跟着走；
//  - 宿主那列仍然收起来，免得两列刻度并排；
//  - 宽屏是右边居中的一列；窄屏（900px 以下）换成紧凑版：贴着右边，一层一根细线，
//    最多 14 根（层数再多就隔层取样），热区 24×12 且层间留缝 —— 缝隙和列外都让手势
//    落到正文上，滑正文不会被刻度抢走；
//  - 手指滑过（>8px）不算点：只有按稳了松开才跳，跳完给目标层闪一下浅底，并在下面
//    挂 1.8 秒「回到刚才」——误触可当场撤回。
function createStoryFloorRail(root, options) {
	const host = (options && options.window) || (typeof window !== "undefined" ? window : null);
	const doc = host && host.document || (root && root.ownerDocument) || (typeof document !== "undefined" ? document : null);
	const scope = (root && root.closest && root.closest("[data-conversation-scroll]")) || root || (doc && doc.body);
	const hiddenAttribute = "data-dsh-tavern-rail-hidden";
	const compactAttribute = "data-compact";
	const label = (options && options.label) || "楼层跳转";
	const jumpLabel = (options && options.jumpLabel) || "跳到第 {floor} 楼";
	const undoLabel = (options && options.undoLabel) || "回到刚才";
	const narrow = (options && options.narrow) || 900;
	// 手指移动超过这个距离就是「滑」不是「点」（触屏常见 8–10px）。
	const tapSlop = (options && options.tapSlop) || 8;
	// 紧凑版最多画几根刻度：14 根 × 18px ≈ 252px，手机上不会长成一列可滚动的东西。
	const compactTicks = (options && options.compactTicks) || 14;
	const flashMs = 700, undoMs = 1800;
	let rail = null, frame = 0, floorsKey = "", compact = false;
	let undoBox = null, undoTimer = 0, flashTimer = 0, undoFrom = 0, undoRow = null;
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
	// 跳到的楼层闪一层浅底：点歪了也立刻看出跳到哪，知道该不该撤回。
	function flash(row) {
		if (flashTimer) { host.clearTimeout(flashTimer); flashTimer = 0; }
		if (undoRow && undoRow !== row) undoRow.removeAttribute("data-floor-flash");
		undoRow = row;
		row.setAttribute("data-floor-flash", "");
		flashTimer = host.setTimeout(function () {
			flashTimer = 0;
			row.removeAttribute("data-floor-flash");
			if (undoRow === row) undoRow = null;
		}, flashMs);
	}
	function hideUndo() {
		if (undoTimer) { host.clearTimeout(undoTimer); undoTimer = 0; }
		if (undoBox) undoBox.remove();
		undoBox = null;
	}
	// 跳完在刻度列下面挂一个「回到刚才」：误触时一键回到原处的 scrollTop。
	function offerUndo(from) {
		hideUndo();
		undoFrom = from;
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "dsh-tavern-turn-rail-undo";
		button.textContent = undoLabel;
		button.addEventListener("click", function (event) {
			event.stopPropagation();
			if (typeof scope.scrollTo === "function") scope.scrollTo({ top: undoFrom, behavior: "smooth" });
			else scope.scrollTop = undoFrom;
			hideUndo();
		});
		undoBox = button;
		doc.body.appendChild(button);
		placeUndo();
		undoTimer = host.setTimeout(hideUndo, undoMs);
	}
	function jump(floor) {
		const row = rowOf(floor);
		if (!row) return;
		const from = scope.scrollTop || 0;
		flash(row);
		try { row.scrollIntoView({ block: "start", behavior: "smooth" }); }
		catch (error) { row.scrollIntoView(true); }
		offerUndo(from);
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
	// 紧凑版最多 14 根：层数多了隔层取样（首层与末层总在），列就不会长到需要自己滚 ——
	// 一列能滚的东西会把右边缘的上下滑吃掉，那是手机上最大的误触源。
	function sample(list) {
		if (!compact || list.length <= compactTicks) return list;
		const stride = Math.ceil(list.length / compactTicks);
		return list.filter((row, index) => index % stride === 0 || index === list.length - 1);
	}
	function build(list) {
		const box = doc.createElement("nav");
		box.className = "dsh-tavern-turn-rail";
		box.setAttribute("aria-label", label);
		ticks.clear();
		for (const row of sample(list)) {
			const floor = floorOf(row);
			if (ticks.has(floor)) continue;
			const button = doc.createElement("button");
			button.type = "button";
			button.className = "dsh-tavern-turn-rail-tick";
			button.setAttribute("data-floor", String(floor));
			button.setAttribute("aria-label", jumpLabel.replace("{floor}", String(floor)));
			button.setAttribute("title", jumpLabel.replace("{floor}", String(floor)));
			// 滑过不算点：右边缘起手上下滑正文时，手指常从刻度上掠过去 —— 那一下不跳。
			// 固定层里的按钮收不到宿主的滚动手势（固定定位不在滚动容器里，浏览器不会把这次
			// 滑动交给正文，等于一块吃手的死区），所以触屏滑动由我们自己按位移滚正文：
			// 手感还是跟着手指走，抬手也不跳。
			let startY = null, lastY = 0, dragged = false, panning = false;
			button.addEventListener("pointerdown", function (event) {
				startY = typeof event.clientY === "number" ? event.clientY : null;
				lastY = startY || 0;
				dragged = false;
			});
			button.addEventListener("pointermove", function (event) {
				if (startY === null || typeof event.clientY !== "number") return;
				if (Math.abs(event.clientY - startY) > tapSlop) dragged = true;
			});
			button.addEventListener("pointercancel", function () { startY = null; dragged = false; });
			button.addEventListener("touchstart", function (event) {
				const touch = event.touches && event.touches[0];
				startY = touch ? touch.clientY : null;
				lastY = startY || 0;
				dragged = false;
				panning = false;
			}, { passive: true });
			button.addEventListener("touchmove", function (event) {
				const touch = event.touches && event.touches[0];
				if (!touch || startY === null) return;
				if (!panning) {
					if (Math.abs(touch.clientY - startY) <= tapSlop) return;
					panning = true;
					dragged = true;
				}
				event.preventDefault();
				scope.scrollTop = (scope.scrollTop || 0) - (touch.clientY - lastY);
				lastY = touch.clientY;
			}, { passive: false });
			button.addEventListener("click", function () {
				if (dragged) { dragged = false; startY = null; return; }
				jump(floor);
			});
			ticks.set(floor, { button, row });
			box.appendChild(button);
		}
		return box;
	}
	// 当前层可能不在取样的刻度里：点亮「不超过当前层的最后一根」，就近示意你在哪。
	function mirror(list) {
		const at = current(list);
		let active = null;
		for (const [floor] of ticks) if (at !== null && floor <= at) active = floor;
		for (const [floor, tick] of ticks) {
			if (floor === active) tick.button.setAttribute("data-active", "");
			else tick.button.removeAttribute("data-active");
		}
	}
	function place() {
		if (!rail) return;
		const rect = scope.getBoundingClientRect();
		// 窄屏不收起，换紧凑版（data-compact）：贴右边一行细线，热区按手指放大。
		const roomy = rect.width > narrow;
		const visible = rect.width > 0 && rect.height > 96;
		rail.hidden = !visible;
		// `hidden` 只是 UA 的 display:none，class 上那条 display:flex 会把它压回去；
		// 二者一起写，没被定位的刻度才不会停在 body 末尾 —— 手机上的左下角。
		rail.style.display = visible ? "" : "none";
		if (!visible) { hideUndo(); return; }
		if (roomy) rail.removeAttribute(compactAttribute);
		else rail.setAttribute(compactAttribute, "");
		// 窄屏离边 10px：退出系统边缘手势区（iOS 右缘返回、安卓边缘返回），少一层误触来源。
		rail.style.right = Math.max(0, Math.round(host.innerWidth - rect.right)) + (roomy ? 12 : 10) + "px";
		rail.style.top = Math.round(rect.top + rect.height / 2) + "px";
		placeUndo();
	}
	// 「回到刚才」跟着刻度列走：挂在列的正下方，列一动它跟着动。
	function placeUndo() {
		if (!undoBox || !rail) return;
		const rect = rail.getBoundingClientRect();
		if (!rect.width) return;
		undoBox.style.right = Math.max(0, Math.round(host.innerWidth - rect.right)) + "px";
		undoBox.style.top = Math.round(rect.bottom + 10) + "px";
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
		// 宽/窄决定刻度怎么取样，所以也进 key：跨过 900px 时整列重画。
		const width = scope.getBoundingClientRect().width;
		compact = width > 0 && width <= narrow;
		const key = (compact ? "c|" : "r|") + list.map(floorOf).join(",");
		if (key !== floorsKey) {
			floorsKey = key;
			hideUndo();
			if (rail) rail.remove();
			rail = list.length ? build(list) : null;
			if (rail) doc.body.appendChild(rail);
		}
		if (rail) { mirror(list); place(); }
		else hideUndo();
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
			hideUndo();
			if (flashTimer) { host.clearTimeout(flashTimer); flashTimer = 0; }
			if (undoRow) { undoRow.removeAttribute("data-floor-flash"); undoRow = null; }
			for (const nav of Array.from(scope.querySelectorAll("[" + hiddenAttribute + "]"))) nav.removeAttribute(hiddenAttribute);
			if (rail) rail.remove();
			rail = null; ticks.clear(); floorsKey = "";
		}
	};
}
