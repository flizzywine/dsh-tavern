		// 顶部视图标签（对话 / 轨迹 / 完整上下文 / 画廊 / 精修）：设置决定
		// 显示哪些、按什么顺序。「对话」由宿主注册，始终保留在最前，不能移除。
		// 标签行由宿主渲染，这里只给每个标签按钮设置 order / display。
		const TAVERN_VIEW_TAB_RESIDENT = "chat";
		const TAVERN_VIEW_TAB_ITEM_LIMIT = 24;
		const TAVERN_VIEW_TABS_DEFAULT = Object.freeze({ items: Object.freeze(["chat", "trajectory", "dsh-tavern:gallery", "dsh-tavern:polish"]) });
		// 槽位就绪前设置页也能列出这些标签；就绪后用槽位里的实际名称覆盖。
		const TAVERN_VIEW_TAB_KNOWN = Object.freeze([
			Object.freeze({ id: "chat", label: "对话", locked: true }),
			Object.freeze({ id: "trajectory", label: "轨迹" }),
			Object.freeze({ id: "dsh-tavern:full-context", label: "完整上下文" }),
			Object.freeze({ id: "dsh-tavern:gallery", label: "画廊" }),
			Object.freeze({ id: "dsh-tavern:polish", label: "精修" })
		]);

		// 读取统一的可见清单：「对话」缺失时补上，排在后面时挪回首位。
		function tavernViewTabItems(value) {
			const source = value && Array.isArray(value.items) ? value.items : null;
			if (!source) return TAVERN_VIEW_TABS_DEFAULT.items.slice();
			const items = [];
			for (const id of source) {
				if (typeof id !== "string" || id === "" || items.includes(id)) continue;
				items.push(id);
			}
			const resident = items.indexOf(TAVERN_VIEW_TAB_RESIDENT);
			if (resident > 0) items.splice(resident, 1);
			if (resident !== 0) items.unshift(TAVERN_VIEW_TAB_RESIDENT);
			return items.slice(0, TAVERN_VIEW_TAB_ITEM_LIMIT);
		}

		// 宿主的标签是 () => t("view.chat") 形式，读的时候才解析成本地化文字。
		function tavernViewTabLabel(label) {
			if (typeof label === "function") {
				try { return String(label() || "").trim(); } catch (_) { return ""; }
			}
			return String(label || "").trim();
		}

		function tavernViewTabEntries(slots) {
			const list = [];
			if (!slots || typeof slots.entries !== "function") return list;
			for (const entry of slots.entries("conversation.view")) {
				const options = entry && entry.options;
				const id = options && options.id;
				if (!id || list.some(item => item.id === id)) continue;
				list.push({ id: String(id), label: tavernViewTabLabel(options.label) || String(id).replace(/^[^:]+:/, "") });
			}
			return list;
		}

		// 标签按钮没有 data 属性，按文字与槽位条目对齐。宿主只在开发者工具
		// 关闭时藏掉「轨迹」，所以文字对不上且少一个时再试一次去掉「轨迹」。
		function tavernViewTabPlan(buttons, entries, items) {
			const order = new Map();
			(items || []).forEach(function (id, index) { if (!order.has(id)) order.set(id, index); });
			const list = Array.isArray(entries) ? entries.slice() : [];
			const textOf = button => String(button.textContent || "").trim();
			const byLabel = function (candidates) {
				const remaining = candidates.slice();
				const pairs = [];
				for (const button of buttons) {
					const index = remaining.findIndex(entry => entry.label === textOf(button));
					if (index < 0) return null;
					pairs.push({ button: button, entry: remaining.splice(index, 1)[0] });
				}
				return pairs;
			};
			let pairs = byLabel(list);
			if (!pairs && buttons.length === list.length - 1) {
				const withoutTrajectory = list.filter(entry => entry.id !== "trajectory");
				if (withoutTrajectory.length === list.length - 1) pairs = byLabel(withoutTrajectory);
			}
			// 宿主改版、本地化取不到时按顺序兜底；数量对不上就不猜，免得隐藏错标签。
			if (!pairs) {
				if (buttons.length !== list.length) return [];
				pairs = buttons.map((button, index) => ({ button: button, entry: list[index] || null }));
			}
			return pairs.map(function (pair) {
				const id = pair.entry ? pair.entry.id : "";
				const position = order.has(id) ? order.get(id) : -1;
				return { button: pair.button, id: id, visible: position >= 0, order: position };
			});
		}

		function applyTavernViewTabRow(row, entries, items) {
			const buttons = Array.from(row.querySelectorAll('button[role="tab"]'));
			const plan = tavernViewTabPlan(buttons, entries, items);
			if (!plan.length) return 0;
			let visible = 0;
			for (const item of plan) {
				if (item.id) item.button.setAttribute("data-tavern-view-tab", item.id);
				item.button.style.display = item.visible ? "" : "none";
				item.button.style.order = item.visible ? String(item.order) : "";
				if (item.visible) visible += 1;
			}
			row.setAttribute("data-tavern-view-tabs", String(visible));
			// 当前视图被隐藏时切到第一个可见标签，否则页面会停在一个没有入口的标签上。
			const active = plan.find(item => item.button.getAttribute("aria-selected") === "true");
			const fallback = plan.find(item => item.visible);
			if (active && !active.visible && fallback) fallback.button.click();
			return visible;
		}

		function installTavernViewTabLayout(options) {
			const doc = options && options.document;
			const slots = options && options.slots;
			if (!doc || !doc.body || typeof doc.querySelectorAll !== "function") return function () { };
			const view = doc.defaultView;
			const Observer = view && view.MutationObserver;
			if (!Observer) return function () { };
			const rows = new Map();
			let frame = 0;
			function items() {
				const preferences = displayPreferences.snapshot();
				return tavernViewTabItems(preferences && preferences.viewTabs);
			}
			function apply() {
				frame = 0;
				for (const [row, observer] of Array.from(rows)) {
					if (row.isConnected) continue;
					observer.disconnect();
					rows.delete(row);
				}
				if (!rows.size) return;
				const entries = tavernViewTabEntries(slots), current = items();
				rows.forEach(function (_observer, row) { applyTavernViewTabRow(row, entries, current); });
			}
			function schedule() {
				if (frame) return;
				frame = view.requestAnimationFrame ? view.requestAnimationFrame(apply) : view.setTimeout(apply, 0);
			}
			function watch(row) {
				if (rows.has(row)) return;
				// 一个标签行内部的增删与选中变化就够了；正文流式更新不会进来。
				const observer = new Observer(function (records) {
					if (records.some(record => record.type === "childList" || record.attributeName === "aria-selected")) schedule();
				});
				observer.observe(row, { childList: true, attributes: true, attributeFilter: ["aria-selected"] });
				rows.set(row, observer);
				schedule();
			}
			function discover() {
				for (const row of doc.querySelectorAll("[data-conversation-tabs]")) watch(row);
				schedule();
			}
			// 空会话切到有内容、换会话或重挂布局时，标签行会被整体增删。
			const observer = new Observer(function (records) {
				for (const record of records) {
					if (record.type !== "childList") continue;
					for (const node of [...record.addedNodes, ...record.removedNodes]) {
						if (node.nodeType !== 1) continue;
						if (node.matches("[data-conversation-tabs]") || node.querySelector("[data-conversation-tabs]")) { discover(); return; }
					}
				}
			});
			observer.observe(doc.body, { childList: true, subtree: true });
			discover();
			const stopPreferences = typeof displayPreferences.subscribe === "function" ? displayPreferences.subscribe(schedule) : function () { };
			return function () {
				stopPreferences();
				observer.disconnect();
				rows.forEach(item => item.disconnect());
				rows.clear();
				if (frame) {
					if (view.cancelAnimationFrame) view.cancelAnimationFrame(frame);
					else view.clearTimeout(frame);
				}
				frame = 0;
			};
		}

		// 设置页用的标签目录：槽位注册什么就列什么。
		function createTavernViewTabCatalog() {
			let entries = [];
			const listeners = new Set();
			return {
				subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
				snapshot() { return entries; },
				publish(next) {
					const list = (Array.isArray(next) ? next : []).map(entry => ({ id: entry.id, label: entry.label, locked: entry.id === TAVERN_VIEW_TAB_RESIDENT }));
					if (list.length === entries.length && list.every((entry, index) => entry.id === entries[index].id && entry.label === entries[index].label)) return;
					entries = list;
					listeners.forEach(listener => listener());
				}
			};
		}
		const tavernViewTabCatalog = createTavernViewTabCatalog();

		function TavernViewTabsSettings() {
			const h = React.createElement;
			const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
			const catalog = React.useSyncExternalStore(tavernViewTabCatalog.subscribe, tavernViewTabCatalog.snapshot, tavernViewTabCatalog.snapshot);
			const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
			const [dragging, setDragging] = React.useState("");
			const dragRef = React.useRef("");
			const items = tavernViewTabItems(preferences && preferences.viewTabs);
			const known = React.useMemo(function () {
				const list = [], seen = new Set();
				function push(entry) {
					if (!entry || !entry.id || seen.has(entry.id)) return;
					seen.add(entry.id);
					list.push({ id: entry.id, label: entry.label || entry.id, locked: entry.id === TAVERN_VIEW_TAB_RESIDENT });
				}
				// 槽位里的实际名称优先；槽位还没就绪时用内置名称占位。
				catalog.forEach(push);
				TAVERN_VIEW_TAB_KNOWN.forEach(push);
				return list;
			}, [catalog]);
			const byId = function (id) {
				return known.find(entry => entry.id === id) || { id: id, label: String(id).replace(/^[^:]+:/, ""), locked: id === TAVERN_VIEW_TAB_RESIDENT };
			};
			async function save(next) {
				setBusy(true); setNotice("");
				try {
					await displayPreferences.save({ viewTabs: { items: next } });
					setNotice("已保存，对所有对话立即生效");
				} catch (error) { setNotice("保存失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			function toggle(id) {
				if (busy || id === TAVERN_VIEW_TAB_RESIDENT) return undefined;
				return save(items.includes(id) ? items.filter(value => value !== id) : items.concat([id]));
			}
			function move(id, delta) {
				if (busy || id === TAVERN_VIEW_TAB_RESIDENT) return undefined;
				const index = items.indexOf(id), target = index + delta;
				// 对话固定在第 1 位：第二位不能再往上换。
				if (index < 0 || target < 1 || target >= items.length) return undefined;
				const next = items.slice();
				[next[index], next[target]] = [next[target], next[index]];
				return save(next);
			}
			function drop(target) {
				const source = dragRef.current;
				dragRef.current = ""; setDragging("");
				if (busy || !source || source === target) return undefined;
				const next = items.filter(value => value !== source);
				const at = next.indexOf(target);
				if (at < 0) return undefined;
				// 拖到「对话」上表示紧跟在它后面；其余按拖动方向插到目标前后。
				if (target === TAVERN_VIEW_TAB_RESIDENT) next.splice(1, 0, source);
				else next.splice(at + (items.indexOf(source) < items.indexOf(target) ? 1 : 0), 0, source);
				return save(next);
			}
			function row(id, index) {
				const entry = byId(id);
				const locked = id === TAVERN_VIEW_TAB_RESIDENT;
				return h("li", {
					key: id,
					className: "dsh-tavern-view-tab-row" + (dragging === id ? " is-dragging" : ""),
					onDragOver: function (event) { if (dragRef.current && dragRef.current !== id) event.preventDefault(); },
					onDrop: function (event) { event.preventDefault(); void drop(id); }
				},
					locked
						? h("span", { className: "dsh-tavern-view-tab-grip is-locked", "aria-hidden": true }, "•")
						: h("span", {
							className: "dsh-tavern-view-tab-grip", title: "拖动排序", "aria-hidden": true, draggable: !busy,
							onDragStart: function (event) {
								dragRef.current = id; setDragging(id);
								if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; try { event.dataTransfer.setData("text/plain", id); } catch (_) { } }
							},
							onDragEnd: function () { dragRef.current = ""; setDragging(""); }
						}, "⋮⋮"),
					h("span", { className: "dsh-tavern-view-tab-name" },
						h("strong", null, entry.label),
						locked ? h("small", null, "始终显示，不能移除") : null),
					locked
						? h("span", { className: "dsh-tavern-view-tab-lock" }, "固定")
						: h("span", { className: "dsh-tavern-view-tab-ops" },
							h("button", { type: "button", className: "dsh-tavern-view-tab-op", "aria-label": "上移", title: "上移", disabled: busy || index <= 1, onClick: function () { void move(id, -1); } }, "↑"),
							h("button", { type: "button", className: "dsh-tavern-view-tab-op", "aria-label": "下移", title: "下移", disabled: busy || index >= items.length - 1, onClick: function () { void move(id, 1); } }, "↓"),
							h("button", { type: "button", className: "dsh-tavern-view-tab-op is-danger", "aria-label": "移除", title: "移除", disabled: busy, onClick: function () { void toggle(id); } }, "×")));
			}
			const addable = known.filter(entry => !items.includes(entry.id));
			return h("section", { className: "dsh-tavern-view-tabs", "aria-label": "顶部标签" },
				h("div", { className: "dsh-tavern-settings-copy" },
					h("strong", { className: "dsh-tavern-settings-title" }, "顶部标签"),
					h("p", { className: "dsh-tavern-settings-desc" }, "决定会话上方「对话 / 轨迹 / 完整上下文 / 画廊 / 精修」这排标签显示哪些、按什么顺序。「对话」始终显示并排在最前，不能移除。")),
				h("ul", { className: "dsh-tavern-view-tab-list" }, items.map(row)),
				h("div", { className: "dsh-tavern-view-tab-catalog" },
					h("strong", { className: "dsh-tavern-settings-title" }, "可添加的标签"),
					h("p", { className: "dsh-tavern-settings-desc" }, "移除的标签会到这里，点一下加回末尾；默认显示对话、轨迹、画廊和精修；完整上下文可按需添加。手机端放不下时可左右滑动。"),
					h("div", { className: "dsh-tavern-view-tab-chips" },
						addable.length
							? addable.map(entry => h("button", { key: entry.id, type: "button", className: "dsh-tavern-view-tab-chip", disabled: busy, onClick: function () { void toggle(entry.id); } },
								h("span", { className: "dsh-tavern-view-tab-chip-plus", "aria-hidden": true }, "＋"), entry.label))
							: h("span", { className: "dsh-tavern-settings-desc" }, "所有标签都已显示。"))),
				h("div", { className: "dsh-tavern-view-tab-foot" },
					h("p", { className: "dsh-tavern-settings-desc" }, "改动立即保存，对所有对话生效。"),
					h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { void save(TAVERN_VIEW_TABS_DEFAULT.items.slice()); } }, "恢复默认标签")),
				notice ? h("p", { className: "dsh-tavern-settings-desc", role: "status" }, notice) : null);
		}
