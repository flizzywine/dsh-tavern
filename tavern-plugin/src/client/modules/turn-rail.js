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
	// 滚动容器是宿主的 scrollBody（[data-conversation-scroll]）。切换会话或宿主重挂会话视图时，
	// 这一层会被整个换成新节点，而传进来的 root 还指着旧节点：旧节点脱离文档后量到的宽高全是
	// 0，刻度列就被判成「看不见」，并且再没有尺寸变化 / 滚动事件把它叫回来 —— 表现就是同一局
	// 里有刻度、下一次会话却一直没有。所以每次都重新解析一次，旧节点失效就回到当前会话的那个
	// 滚动容器。
	const resolveScope = (options && options.resolveScope) || null;
	const targetSessionId = options && typeof options.sessionId === "string" && options.sessionId ? options.sessionId : "";
	function isVisibleStyle(node) {
		if (!host || typeof host.getComputedStyle !== "function" || !node || node.nodeType !== 1) return true;
		const style = host.getComputedStyle(node);
		return !style || (style.display !== "none" && style.visibility !== "hidden");
	}
	function isVisibleBox(node) {
		if (!node || typeof node.getBoundingClientRect !== "function") return false;
		const rect = node.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 && isVisibleStyle(node);
	}
	function isRenderableScope(node) {
		if (!node || typeof node.getBoundingClientRect !== "function") return false;
		const rect = node.getBoundingClientRect();
		return rect.width > 0 && rect.height > 96 && isVisibleStyle(node);
	}
	function sessionOwnerOf(node) {
		if (!node || typeof node.closest !== "function") return null;
		const owner = node.closest("[data-conversation-session]");
		return owner ? (owner.getAttribute("data-conversation-session") || "") : null;
	}
	function isEmbeddedScope(node) {
		if (!node || typeof node.closest !== "function") return false;
		const content = node.closest("[data-conversation-content]");
		return !!(content && content.className && String(content.className).indexOf("embedded") >= 0);
	}
	function scopeMatchesTarget(node) {
		if (!node || node.isConnected === false) return false;
		if (!targetSessionId) return true;
		const owner = sessionOwnerOf(node);
		if (owner !== null) return owner === targetSessionId;
		return !(doc && typeof doc.querySelector === "function" && doc.querySelector("[data-conversation-session]"));
	}
	function pickScrollContainer() {
		if (!doc || typeof doc.querySelectorAll !== "function") return null;
		let list = Array.from(doc.querySelectorAll("[data-conversation-scroll]")).filter(node => node && node.isConnected !== false);
		if (!list.length) return null;
		if (targetSessionId) {
			const hasSessionMarkers = list.some(node => sessionOwnerOf(node) !== null);
			if (hasSessionMarkers) {
				const owned = list.filter(node => sessionOwnerOf(node) === targetSessionId);
				if (!owned.length) return null;
				const primaryOwned = owned.filter(node => !isEmbeddedScope(node));
				list = primaryOwned.length ? primaryOwned : owned;
			}
		} else {
			const primary = list.filter(node => !isEmbeddedScope(node));
			if (primary.length) list = primary;
		}
		const visible = list.filter(isVisibleBox);
		const visibleWithRows = visible.find(node => node.querySelector("[data-story-row][data-floor]"));
		if (visibleWithRows) return visibleWithRows;
		if (visible.length) return visible[0];
		return list.find(node => node.querySelector("[data-story-row][data-floor]")) || list[0];
	}
	function findScope() {
		const resolved = resolveScope ? resolveScope() : null;
		if (resolved && scopeMatchesTarget(resolved)) {
			if (isVisibleBox(resolved)) return resolved;
			return pickScrollContainer() || resolved;
		}
		const matched = root && root.isConnected !== false
			? (root.closest ? root.closest("[data-conversation-scroll]") : null)
			: null;
		if (matched && scopeMatchesTarget(matched)) {
			if (isVisibleBox(matched)) return matched;
			return pickScrollContainer() || matched;
		}
		const live = pickScrollContainer();
		if (live) return live;
		if (targetSessionId && doc && typeof doc.querySelector === "function" && doc.querySelector("[data-conversation-session]")) {
			return null;
		}
		if (root && scopeMatchesTarget(root)) return root;
		return targetSessionId ? null : ((doc && doc.body) || null);
	}
	let scope = findScope();
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
	// 窄屏要点两下才跳：第一下只是「选定这一层」，这个窗口内再点同一下才真的跳。
	// 1500ms 留够阅读「再点一下 · 第 N 楼」并落第二指的时间，不再因 350ms 过短导致反复只闪不跳。
	const armMs = (options && options.armMs) || 1500;
	const hintLabel = (options && options.hintLabel) || "再点一下 · 第 {floor} 楼";
	let rail = null, frame = 0, floorsKey = "", compact = false;
	let undoBox = null, undoTimer = 0, flashTimer = 0, undoFrom = 0, undoRow = null;
	let hintBox = null, armTimer = 0, armedFloor = null, armedScrollTop = 0;
	let retryTimer = 0, retries = 0;
	let jumpSeq = 0, settleRaf1 = 0, settleRaf2 = 0, settleTimer = 0;
	function cancelJumpSettle() {
		if (settleRaf1 && host && typeof host.cancelAnimationFrame === "function") host.cancelAnimationFrame(settleRaf1);
		if (settleRaf2 && host && typeof host.cancelAnimationFrame === "function") host.cancelAnimationFrame(settleRaf2);
		if (settleTimer && host) host.clearTimeout(settleTimer);
		settleRaf1 = 0; settleRaf2 = 0; settleTimer = 0;
	}
	// 刻度列挂在 body 上，不在 [data-conversation-scroll] 内，宿主的 READING_INTENTS 监听收不到这次点击：
	// 若宿主处于 followingTail 跟尾态，程序化滚动或楼层按需展开触发 ResizeObserver 时会被宿主拉回底部。
	// 主动向滚动容器派发 beforematch + scroll/scrollend，让宿主立即中断跟尾并落定新位置。
	function notifyHostScrollIntent(target) {
		if (!target || typeof target.dispatchEvent !== "function" || !host || typeof host.Event !== "function") return;
		try { target.dispatchEvent(new host.Event("beforematch")); } catch (_) {}
	}
	function flushHostScrollEnd(target) {
		if (!target || typeof target.dispatchEvent !== "function" || !host || typeof host.Event !== "function") return;
		try {
			target.dispatchEvent(new host.Event("scroll"));
			target.dispatchEvent(new host.Event("scrollend"));
		} catch (_) {}
	}
	function alignRowToScopeTop(targetScope, row) {
		if (!targetScope || !row || typeof row.getBoundingClientRect !== "function" || typeof targetScope.getBoundingClientRect !== "function") return false;
		const maxScroll = (Number(targetScope.scrollHeight) || 0) - (Number(targetScope.clientHeight) || 0);
		if (!(maxScroll > 0)) return false;
		const delta = row.getBoundingClientRect().top - targetScope.getBoundingClientRect().top;
		if (Math.abs(delta) < 1) return true;
		const nextTop = Math.max(0, Math.min(maxScroll, Math.round((targetScope.scrollTop || 0) + delta)));
		if (nextTop !== targetScope.scrollTop) {
			targetScope.scrollTop = nextTop;
			return true;
		}
		return false;
	}
	// 收到「暂时看不见」之后自己补几次迟到的复查：容器某一刻量到 0 宽、不到 96 高（切会话、
	// 开合面板、窗口一度藏起来）时先收起；这类状态未必带着新的尺寸变化或滚动事件，不复查就会
	// 一直藏着，等人滚一下才回来。
	function recheck() {
		if (!host || retryTimer || retries >= 6) return;
		retries++;
		retryTimer = host.setTimeout(function () { retryTimer = 0; sync(); }, 400);
	}
	const ticks = new Map(); // floor -> { button, row }
	const hiddenHostNavs = new Set(); // 被这一列收起来的宿主刻度列，卸下时还给宿主
	function floorOf(row) {
		const value = Number(row.getAttribute("data-floor"));
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	function rows() {
		if (!scope || typeof scope.querySelectorAll !== "function") return [];
		return Array.from(scope.querySelectorAll("[data-story-row][data-floor]")).filter(row => floorOf(row) !== null);
	}
	function rowOf(floor) {
		const tick = ticks.get(floor);
		if (tick && tick.row && tick.row.isConnected
			&& (!scope || typeof scope.contains !== "function" || scope.contains(tick.row))
			&& floorOf(tick.row) === floor) return tick.row;
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
			cancelJumpSettle();
			const live = findScope() || scope;
			if (live) {
				scope = live;
				if (typeof live.setAttribute === "function") live.setAttribute("data-story-jump-token", String(++jumpSeq));
				notifyHostScrollIntent(live);
				if (typeof live.scrollTo === "function") {
					try { live.scrollTo({ top: undoFrom, behavior: "instant" }); }
					catch (_) { live.scrollTop = undoFrom; }
				} else {
					live.scrollTop = undoFrom;
				}
				if ((Number(live.scrollHeight) || 0) > (Number(live.clientHeight) || 0)) {
					live.scrollTop = undoFrom;
					flushHostScrollEnd(live);
				}
			}
			hideUndo();
		});
		undoBox = button;
		doc.body.appendChild(button);
		placeUndo();
		undoTimer = host.setTimeout(hideUndo, undoMs);
	}
	// 双击的两步：先选定（刻度变粗 + 边上提示「再点一下」），窗口内再点同一下才跳。
	function disarm() {
		if (armTimer) { host.clearTimeout(armTimer); armTimer = 0; }
		armedFloor = null;
		for (const [, tick] of ticks) tick.button.removeAttribute("data-armed");
		if (hintBox) hintBox.remove();
		hintBox = null;
	}
	function arm(floor, button) {
		disarm();
		armedFloor = floor;
		armedScrollTop = scope ? (scope.scrollTop || 0) : 0;
		button.setAttribute("data-armed", "");
		const hint = doc.createElement("span");
		hint.className = "dsh-tavern-turn-rail-hint";
		hint.setAttribute("aria-hidden", "true");
		hint.textContent = hintLabel.replace("{floor}", String(floor));
		hintBox = hint;
		doc.body.appendChild(hint);
		placeHint();
		armTimer = host.setTimeout(disarm, armMs);
	}
	function jump(floor) {
		cancelJumpSettle();
		disarm();
		const next = findScope();
		if (next && next !== scope) { scope = next; floorsKey = ""; watch(scope); }
		const row = rowOf(floor);
		if (!row || !scope) return;
		const from = scope.scrollTop || 0;
		const token = String(++jumpSeq);
		if (typeof scope.setAttribute === "function") scope.setAttribute("data-story-jump-token", token);
		notifyHostScrollIntent(scope);
		flash(row);
		// 直接即时落位并对齐 scrollTop：smooth 平滑滚动跨越按需收起楼层时，第一帧就会触发
		// IntersectionObserver 锚点写 scrollTop 而被浏览器中途打断，且跟尾态下容易被拉回底部。
		try { row.scrollIntoView({ block: "start", behavior: "instant" }); }
		catch (error) { row.scrollIntoView(true); }
		if (alignRowToScopeTop(scope, row)) {
			flushHostScrollEnd(scope);
		} else if ((Number(scope.scrollHeight) || 0) > (Number(scope.clientHeight) || 0)) {
			flushHostScrollEnd(scope);
		}
		const settle = function () {
			if (!scope || (typeof scope.getAttribute === "function" && scope.getAttribute("data-story-jump-token") !== token)) return;
			const liveRow = rowOf(floor);
			if (liveRow && alignRowToScopeTop(scope, liveRow)) {
				flushHostScrollEnd(scope);
			}
			mirror(rows());
		};
		if (host && typeof host.requestAnimationFrame === "function") {
			settleRaf1 = host.requestAnimationFrame(function () {
				settleRaf1 = 0;
				settle();
				settleRaf2 = host.requestAnimationFrame(function () {
					settleRaf2 = 0;
					settle();
				});
			});
		}
		if (host && (Number(scope.scrollHeight) || 0) > (Number(scope.clientHeight) || 0)) {
			settleTimer = host.setTimeout(function () { settleTimer = 0; settle(); }, 60);
		}
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
			let startY = null, lastY = 0, dragged = false, panning = false, pressed = false, pressTouch = false, touchPending = false;
			// 手指（触屏、笔）要点两下；鼠标一下就到 —— 判断看输入方式，不看窗口宽度：
			// 手机上就算量到了宽布局，也不会退回单击跳。
			function activate(touch) {
				if (!touch) { jump(floor); return; }
				if (armedFloor === floor) { jump(floor); return; }
				arm(floor, button);
			}
			button.addEventListener("pointerdown", function (event) {
				pressed = true;
				pressTouch = event.pointerType === "touch" || event.pointerType === "pen";
				touchPending = pressTouch;
				startY = typeof event.clientY === "number" ? event.clientY : null;
				lastY = startY || 0;
				dragged = false;
				panning = false;
			});
			// 「点」以 pointerup 为准，不看 click：click 是浏览器合成的，个别手机内核一次抬手会
			// 发两下（detail 也不一定是 1），双击逻辑会在同一次点击里被自己喂饱 —— 表现就是
			// 单击也跳。一次抬手只算一次点。
			button.addEventListener("pointerup", function () {
				if (!pressed) return;
				pressed = false;
				touchPending = false;
				const moved = dragged;
				dragged = false;
				startY = null;
				if (moved) return;
				activate(pressTouch);
			});
			button.addEventListener("pointermove", function (event) {
				if (startY === null || typeof event.clientY !== "number") return;
				if (Math.abs(event.clientY - startY) > tapSlop) dragged = true;
			});
			// 移动端微小手抖（< tapSlop）有时会被内核抢发 pointercancel 吃掉 pointerup；
			// 保留 touchPending 由 touchend 兜底补救，不再出现按了有高亮却没算一次点击。
			button.addEventListener("pointercancel", function () { pressed = false; });
			// 键盘 / 读屏走 keydown：原生按钮的 Enter、空格会合成一个 click，这里直接跳，不等第二下。
			button.addEventListener("keydown", function (event) {
				if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") { event.preventDefault(); jump(floor); }
			});
			// 兜底：没有 Pointer Events 的老内核只能靠 click，那就按 click 次数数双击。
			if (!host || !host.PointerEvent) button.addEventListener("click", function () { if (!dragged) activate(true); dragged = false; });
			button.addEventListener("touchstart", function (event) {
				const next = findScope();
				if (next && next !== scope) { scope = next; floorsKey = ""; watch(scope); }
				const touch = event.touches && event.touches[0];
				touchPending = true;
				startY = touch ? touch.clientY : startY;
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
					touchPending = false;
					if (scope) notifyHostScrollIntent(scope);
				}
				event.preventDefault();
				if (scope) scope.scrollTop = (scope.scrollTop || 0) - (touch.clientY - lastY);
				lastY = touch.clientY;
			}, { passive: false });
			button.addEventListener("touchend", function () {
				if (touchPending && !pressed && !dragged && !panning) {
					touchPending = false;
					startY = null;
					activate(true);
					return;
				}
				touchPending = false;
				panning = false;
			}, { passive: true });
			button.addEventListener("touchcancel", function () {
				touchPending = false;
				panning = false;
				dragged = false;
				startY = null;
			}, { passive: true });
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
		if (!rail || !scope) return;
		const rect = scope.getBoundingClientRect();
		// 窄屏不收起，换紧凑版（data-compact）：贴右边一行细线，热区按手指放大。
		const roomy = rect.width > narrow;
		const visible = isRenderableScope(scope);
		rail.hidden = !visible;
		// `hidden` 只是 UA 的 display:none，class 上那条 display:flex 会把它压回去；
		// 二者一起写，没被定位的刻度才不会停在 body 末尾 —— 手机上的左下角。
		rail.style.display = visible ? "" : "none";
		if (!visible) { hideUndo(); disarm(); recheck(); return; }
		retries = 0;
		if (roomy) rail.removeAttribute(compactAttribute);
		else rail.setAttribute(compactAttribute, "");
		// 窄屏离边 10px：退出系统边缘手势区（iOS 右缘返回、安卓边缘返回），少一层误触来源。
		rail.style.right = Math.max(0, Math.round(host.innerWidth - rect.right)) + (roomy ? 12 : 10) + "px";
		rail.style.top = Math.round(rect.top + rect.height / 2) + "px";
		placeUndo();
		placeHint();
	}
	// 选定的那根旁边提示「再点一下」：提示自己不吃点击，第二下照样落在刻度上。
	function placeHint() {
		if (!hintBox || !rail) return;
		const tick = armedFloor === null ? null : ticks.get(armedFloor);
		const rect = tick ? tick.button.getBoundingClientRect() : rail.getBoundingClientRect();
		if (!rect.width) return;
		hintBox.style.right = Math.max(0, Math.round(host.innerWidth - rect.left)) + 8 + "px";
		hintBox.style.top = Math.round(rect.top + rect.height / 2) + "px";
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
		retries = 0;
		if (!host || frame) return;
		frame = host.setTimeout(function () { frame = 0; sync(); }, 120);
	}
	function sync() {
		if (frame && host) { host.clearTimeout(frame); frame = 0; }
		// 宿主换过滚动容器（或常驻容器切去了别的会话）就跟着切换观察对象。
		const next = findScope();
		if (next !== scope) {
			if (observer) observer.disconnect();
			if (resize) resize.disconnect();
			scope = next;
			floorsKey = "";
			if (scope) watch(scope);
		}
		if (!scope) {
			if (rail) { rail.remove(); rail = null; }
			hideUndo(); disarm();
			return;
		}
		const list = rows();
		// 宿主那列刻度还在 DOM 里（它按 turn 画，跟故事楼层对不上），继续收起来。
		const mark = typeof scope.querySelector === "function" ? scope.querySelector('[class*="_mark"][aria-label]') : null;
		const hostNav = mark ? mark.closest("nav") : null;
		if (hostNav && !hostNav.hasAttribute(hiddenAttribute)) { hostNav.setAttribute(hiddenAttribute, ""); hiddenHostNavs.add(hostNav); }
		// 宽/窄决定刻度怎么取样，所以也进 key：跨过 900px 时整列重画。
		const width = scope.getBoundingClientRect().width;
		if (width > 0) compact = width <= narrow;
		const key = (compact ? "c|" : "r|") + list.map(floorOf).join(",");
		if (key !== floorsKey) {
			floorsKey = key;
			hideUndo();
			disarm();
			if (rail) rail.remove();
			rail = list.length ? build(list) : null;
			if (rail && doc && doc.body) doc.body.appendChild(rail);
		} else if (rail) {
			// React 原地复用 <article> 或收起/挂回楼层时节点可能替换，保持 floor -> row 引用常新。
			for (const row of list) {
				const floor = floorOf(row);
				const tick = floor === null ? null : ticks.get(floor);
				if (tick && tick.row !== row) tick.row = row;
			}
		}
		if (rail) { mirror(list); place(); }
		else { hideUndo(); disarm(); }
	}
	function isOwnNode(node) {
		if (!node) return false;
		if (node === rail || node === undoBox || node === hintBox) return true;
		if (rail && typeof rail.contains === "function" && rail.contains(node)) return true;
		return false;
	}
	function hasScopeChange(mutations) {
		if (!doc || !mutations || !mutations.length) return false;
		// 已排了一次同步：sync() 会重新 findScope() 并读实时 DOM，不必再扫这批变更。
		if (frame) return false;
		const scopeAlive = !!(scope && scope !== doc.body && scope.isConnected !== false);
		// 刻度列显示着时，滚动容器外、又不是它祖先的变更不再量容器：容器尺寸变了有 ResizeObserver，祖先的
		// hidden/class/style 下面单独判断。getBoundingClientRect 会强制排版，舞台每帧改样式时每批变更都量一次，
		// 手机主线程被占满。没有 ResizeObserver 的环境照旧量。
		let scopeRenderable;
		const lost = function () {
			if (!scopeAlive) return true;
			if (resize) return false;
			if (scopeRenderable === undefined) scopeRenderable = isRenderableScope(scope);
			return !scopeRenderable;
		};
		const railHidden = !rail || rail.hidden || rail.style.display === "none";
		for (let i = 0; i < mutations.length; i++) {
			const m = mutations[i];
			if (isOwnNode(m.target)) continue;
			if (m.type === "attributes") {
				const attr = m.attributeName;
				if (attr === "data-conversation-session" || attr === "data-content-phase") return true;
				if (scopeAlive && m.target !== scope && typeof scope.contains === "function" && scope.contains(m.target)) continue;
				if (railHidden || lost()) return true;
				if (m.target === doc.documentElement || m.target === doc.body
					|| (scopeAlive && m.target && typeof m.target.contains === "function" && m.target.contains(scope))) return true;
				continue;
			}
			if (scopeAlive && typeof scope.contains === "function" && scope.contains(m.target)) continue;
			const touched = Array.from(m.addedNodes || []).concat(Array.from(m.removedNodes || []));
			for (let j = 0; j < touched.length; j++) {
				const node = touched[j];
				if (!node || isOwnNode(node)) continue;
				// MutationObserver 在 DOM 变更生效之后回调：抽屉/遮罩移除时 scope 可能刚刚恢复可见，
				// 但 rail 仍停在上一轮的 hidden，因此也要看 railHidden 而不能只看容器量不量得到。
				if (railHidden || lost()) return true;
				// 流式正文往气泡里塞的是文本和行内节点：文本永远匹配不到滚动容器。
				if (node.nodeType !== 1) continue;
				if (node.matches && (node.matches("[data-conversation-scroll]") || node.matches("[data-conversation-session]"))) return true;
				// 没有元素子树的节点，querySelector 必然落空。
				if (!node.childElementCount) continue;
				if (node.querySelector && node.querySelector("[data-conversation-scroll], [data-conversation-session]")) return true;
			}
		}
		return false;
	}
	const observer = host && typeof host.MutationObserver === "function" ? new host.MutationObserver(schedule) : null;
	const bodyObserver = host && typeof host.MutationObserver === "function"
		? new host.MutationObserver(function (mutations) {
			if (hasScopeChange(mutations)) schedule();
		})
		: null;
	const resize = host && typeof host.ResizeObserver === "function" ? new host.ResizeObserver(schedule) : null;
	function watch(target) {
		if (!target) return;
		if (observer) {
			observer.disconnect();
			observer.observe(target, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: ["data-floor", "data-story-row", "hidden"]
			});
		}
		if (resize) {
			resize.disconnect();
			resize.observe(target);
			if (target.parentElement) resize.observe(target.parentElement);
			if (doc && doc.documentElement && doc.documentElement !== target) resize.observe(doc.documentElement);
		}
	}
	watch(scope);
	const bodyRoot = doc && (doc.documentElement || doc.body);
	if (bodyObserver && bodyRoot) {
		bodyObserver.observe(bodyRoot, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-conversation-session", "data-content-phase", "hidden", "class", "style"]
		});
	}
	const onScroll = function (event) {
		if (armedFloor !== null && scope && (!event || event.target === scope)) {
			if (Math.abs((scope.scrollTop || 0) - armedScrollTop) > tapSlop) disarm();
		}
		schedule();
	};
	const onUserInterrupt = function (event) {
		if (scope && event && event.target && !isOwnNode(event.target) && typeof scope.contains === "function" && scope.contains(event.target)) {
			cancelJumpSettle();
		}
	};
	const onTransitionEnd = function () {
		if (!rail || rail.hidden || rail.style.display === "none") schedule();
	};
	const onStoryRendered = function (event) {
		const id = event && event.detail && event.detail.sessionId ? String(event.detail.sessionId) : "";
		if (!targetSessionId || !id || id === targetSessionId) schedule();
	};
	const onWake = function () { if (!doc || !doc.hidden) schedule(); };
	const viewport = host && host.visualViewport ? host.visualViewport : null;
	if (host) {
		host.addEventListener("scroll", onScroll, true);
		host.addEventListener("resize", onScroll);
		host.addEventListener("dsh-tavern-story-floors-rendered", onStoryRendered);
	}
	if (viewport && typeof viewport.addEventListener === "function") {
		viewport.addEventListener("resize", onScroll);
		viewport.addEventListener("scroll", onScroll);
	}
	if (doc && typeof doc.addEventListener === "function") {
		doc.addEventListener("visibilitychange", onWake);
		doc.addEventListener("transitionend", onTransitionEnd, true);
		doc.addEventListener("touchstart", onUserInterrupt, { passive: true, capture: true });
		doc.addEventListener("wheel", onUserInterrupt, { passive: true, capture: true });
	}
	return {
		apply: function () { retries = 0; floorsKey = ""; sync(); },
		sync: sync,
		dispose: function () {
			if (observer) observer.disconnect();
			if (bodyObserver) bodyObserver.disconnect();
			if (resize) resize.disconnect();
			if (host) {
				host.removeEventListener("scroll", onScroll, true);
				host.removeEventListener("resize", onScroll);
				host.removeEventListener("dsh-tavern-story-floors-rendered", onStoryRendered);
			}
			if (viewport && typeof viewport.removeEventListener === "function") {
				viewport.removeEventListener("resize", onScroll);
				viewport.removeEventListener("scroll", onScroll);
			}
			if (doc && typeof doc.removeEventListener === "function") {
				doc.removeEventListener("visibilitychange", onWake);
				doc.removeEventListener("transitionend", onTransitionEnd, true);
				doc.removeEventListener("touchstart", onUserInterrupt, true);
				doc.removeEventListener("wheel", onUserInterrupt, true);
			}
			if (frame) { host.clearTimeout(frame); frame = 0; }
			if (retryTimer) { host.clearTimeout(retryTimer); retryTimer = 0; }
			cancelJumpSettle();
			hideUndo();
			disarm();
			if (flashTimer) { host.clearTimeout(flashTimer); flashTimer = 0; }
			if (undoRow) { undoRow.removeAttribute("data-floor-flash"); undoRow = null; }
			for (const nav of hiddenHostNavs) {
				if (!targetSessionId || scopeMatchesTarget(nav)) nav.removeAttribute(hiddenAttribute);
			}
			hiddenHostNavs.clear();
			if (scope && typeof scope.querySelectorAll === "function" && (!targetSessionId || scopeMatchesTarget(scope))) {
				for (const nav of Array.from(scope.querySelectorAll("[" + hiddenAttribute + "]"))) nav.removeAttribute(hiddenAttribute);
			}
			if (rail) rail.remove();
			rail = null; ticks.clear(); floorsKey = "";
		}
	};
}

const storyFloorRailLeases = typeof WeakMap === "function" ? new WeakMap() : null;

function acquireStoryFloorRail(sessionId, options) {
	const id = String(sessionId || "");
	const win = (options && options.window) || (typeof window !== "undefined" ? window : null);
	const doc = (win && win.document) || (typeof document !== "undefined" ? document : null);
	if (!id || !doc || !storyFloorRailLeases) {
		const direct = createStoryFloorRail(null, Object.assign({}, options, id ? { sessionId: id } : {}));
		direct.apply();
		return { sync: direct.sync, apply: direct.apply, release: direct.dispose };
	}
	let bySession = storyFloorRailLeases.get(doc);
	if (!bySession) {
		bySession = new Map();
		storyFloorRailLeases.set(doc, bySession);
	}
	let entry = bySession.get(id);
	if (!entry) {
		const rail = createStoryFloorRail(null, Object.assign({}, options, { window: win, sessionId: id }));
		entry = { refs: 0, rail: rail };
		bySession.set(id, entry);
		rail.apply();
	} else {
		entry.rail.apply();
	}
	entry.refs += 1;
	let released = false;
	return {
		sync: entry.rail.sync,
		apply: entry.rail.apply,
		release: function () {
			if (released) return;
			released = true;
			entry.refs -= 1;
			if (entry.refs <= 0) {
				if (bySession.get(id) === entry) bySession.delete(id);
				entry.rail.dispose();
			}
		}
	};
}
