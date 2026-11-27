		function createTavernShellFeatureModule() {
		// @include modules/host-compatibility.js
		// @include modules/auto-open-tabs.js
		// Entering a game opens its settings and status tabs (the 「进入游戏时打开酒馆状态」 setting, on by default).
		// Only a switch to another game reopens them: readiness flickers while the session list refreshes
		// (after the first turn, when the sidebar remounts), and reopening then would cover the tab the
		// player brought forward, such as the stage.
		let tavernSettingsTabsShownFor = "";
		// Hosts that open a tab without expanding a collapsed right column still show the panel.
		function expandTavernRightColumn(ctx) {
			try {
				const column = typeof ctx.get === "function" ? ctx.get("sidebarRight") : null;
				if (column && typeof column.isExpanded === "function" && column.isExpanded() === false && typeof column.toggleExpanded === "function") column.toggleExpanded();
			} catch (_) {}
		}
		const tavernAutoOpenStatus = (function () {
			let enabled = true, loaded = null;
			function load() { loaded = rpc("getTavernSettings").then(function (result) { enabled = !(result && result.settings && result.settings.autoOpenStatusPanel === false); }, function () {}); return loaded; }
			if (typeof window.addEventListener === "function") window.addEventListener("dsh-tavern-settings-changed", function () { void load(); });
			return { read: function () { return (loaded || load()).then(function () { return enabled; }); } };
		})();

		// 设置 › 高级 › 对话按最新回复排序（tavern-settings.json 的 recentReplyFirst）。
		// 关闭时按创建时间固定排列（默认）；打开后按最近一次回复排序，切换/打开对话不改变位置。
		const tavernHistoryOrderPreference = (function () {
			let order = "created", loaded = null;
			function load() {
				loaded = rpc("getTavernSettings").then(function (result) {
					order = result && result.settings && result.settings.recentReplyFirst === true ? "recent" : "created";
					return order;
				}, function () { return order; });
				return loaded;
			}
			if (typeof window.addEventListener === "function") window.addEventListener("dsh-tavern-settings-changed", function () { void load(); });
			return { read: function () { return (loaded || load()).then(function () { return order; }); }, refresh: load };
		})();

		// The Tavern sidebar occupies `sidebar.workspaces`, so the host's session tree — and with it the live
		// 「进行中」 StateDot — is not on screen. `useSessionStatus` is a standard prop of that slot: a Map of
		// sessionId -> { running, pendingInteraction, completionUnread }, updated by api-session/status events.
		// A host without that seat still gets one stable hook per render (hook order must not change).
		const emptySessionStatus = new Map();
		function noSessionStatus() { return emptySessionStatus; }
		function useTavernSessionStatus(props) {
			const hook = props && typeof props.useSessionStatus === "function" ? props.useSessionStatus : noSessionStatus;
			return hook(function (statuses) { return statuses; });
		}

		// 历史列表一次只挂一屏多的行。抽屉展开那一帧的排版量随行数线性增长：4x CPU
		// 节流下 40 条约 15ms、120 条约 60ms、300 条约 150ms，正好压在 .24s 滑入动画上。
		// 窗口随滚动变大，行是按屏追加的，展开永远只排第一屏。
		const SIDE_HISTORY_WINDOW = 24;
		const SIDE_HISTORY_WINDOW_STEP = 12;

		const historyStatusOptions = [
			{ value: "all", label: "全部状态" }, { value: "dialogue", label: "有交互" },
			{ value: "opening", label: "仅开场" }, { value: "archived", label: "已归档" }
		];

		// The fork's self-drawn tick (.ap-check-mark, ui-design §三.15): role=checkbox, "mixed" for a partly selected list.
		function HistoryManagerCheck({ checked, label, disabled, onToggle, className, children }) {
			const h = React.createElement;
			return h("button", { type: "button", role: "checkbox", className: "ap-pack-check dsh-tavern-history-manager-check" + (className ? " " + className : ""), "aria-checked": checked, "aria-label": label, disabled, onClick: onToggle },
				h("span", { className: "ap-check-mark", "aria-hidden": "true" }, checked === "mixed" ? h("i", { className: "ap-check-dash" }) : checked ? h(InlineGlyph, { name: "check" }) : null),
				children);
		}

		// The head of one card's group in 游玩历史: its click folds / unfolds the group; right click, Shift+F10 / the menu key or a
		// touch long press opens the card's menu (useContextMenu, ui-design 右键 / 长按菜单). Items are entries that exist elsewhere:
		// the card list's 新开游玩, the group's own fold, and the 存档管理 filtered to this card.
		function HistoryGroupHead({ group, expanded, busy, onToggle, onNewPlay, onManage, children }) {
			const h = React.createElement;
			const menu = packUi.useContextMenu({
				label: group.name + " 操作",
				content: function (close) {
					return h(React.Fragment, null,
						group.path ? h(packUi.MenuItem, { disabled: busy, onClick: function () { close(); onNewPlay(); } }, "新建游戏") : null,
						h(packUi.MenuItem, { onClick: function () { close(); onToggle(); } }, expanded ? "折叠" : "展开"),
						h(packUi.MenuItem, { onClick: function () { close(); onManage(); } }, "管理存档…"));
				}
			});
			return h(React.Fragment, null,
				h("button", Object.assign({ className: "dsh-tavern-history-group-toggle", "aria-expanded": expanded, title: group.path || group.name, onClick: onToggle }, menu.target, menu.trigger), children),
				menu.layer);
		}

		function HistoryCardFilter({ options, value, onChange }) {
			const h = React.createElement;
			const popup = useInlinePopup({ focusSelector: "input" });
			const popupId = React.useId();
			const [query, setQuery] = React.useState("");
			const all = { value: "all", label: "全部人物卡" };
			const current = options.find(option => option.value === value) || all;
			const needle = query.trim().toLowerCase();
			const matches = needle ? options.filter(option => option.label.toLowerCase().includes(needle) || option.path.toLowerCase().includes(needle)) : [all, ...options];
			function choose(next) {
				onChange(next);
				popup.close(true);
			}
			function open() {
				setQuery("");
				popup.setOpen(true);
			}
			function searchKeys(event) {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					const buttons = popup.pop.current.querySelectorAll('[role="menuitemradio"]');
					event.preventDefault();
					buttons[event.key === "ArrowDown" ? 0 : buttons.length - 1]?.focus();
				} else if (event.key === "Enter" && needle && matches.length) {
					event.preventDefault();
					choose(matches[0].value);
				}
			}
			return h("div", { className: "dsh-tavern-history-manager-select fork-inline-anchor", ref: popup.root, onKeyDown: event => {
				if (!event.nativeEvent.isComposing) popup.keys(event);
				else if (event.key === "Escape") event.stopPropagation();
			} },
				h("button", { type: "button", className: "dsh-tavern-history-card-trigger",
					ref: popup.trigger, title: current.label, "aria-label": "按人物卡筛选：" + current.label,
					"aria-haspopup": "dialog", "aria-expanded": popup.open, "aria-controls": popup.open ? popupId : undefined,
					onClick: () => popup.open ? popup.close(false) : open(),
					onKeyDown: event => { if (!popup.open && event.key === "ArrowDown") { event.preventDefault(); open(); } } },
					h("span", { className: "fork-inline-text" }, current.label), h(InlineGlyph, { name: "chevDown" })),
				popup.open ? popup.layer({ id: popupId, className: "fork-inline-pop dsh-tavern-history-card-popup", role: "dialog", "aria-label": "筛选人物卡" },
					h(SearchBox, { bare: true, inputClassName: "dsh-tavern-library-search", label: "搜索人物卡", value: query, onChange: setQuery, onKeyDown: searchKeys, inputProps: { autoComplete: "off" } }),
					matches.length ? h("div", { className: "dsh-tavern-history-card-options", role: "menu", "aria-label": "人物卡", onKeyDown: inlineMenuKeys },
						matches.map(option => h("button", { key: option.value, type: "button", className: "fork-inline-option", role: "menuitemradio",
							"aria-checked": option.value === current.value, title: option.path || option.label, onClick: () => choose(option.value) },
							h("span", { className: "dsh-tavern-history-card-option-text" }, option.label,
								option.duplicate ? h("small", { className: "fork-inline-text" }, option.path) : null),
							option.value === current.value ? h(InlineGlyph, { name: "check" }) : null)))
						: h("p", { className: "dsh-tavern-history-card-empty", role: "status" }, "没有匹配的人物卡")) : null);
		}

		function TavernSidebar(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const collapsed = props.collapsed;
			// 0.2 hosts dropped the snapshot's top-level current; the main view's retain names it now.
			const current = props.useSessions(function (state) { return mainSessionId(state) || ""; });
			const summaries = props.useSessions(function (state) { return state.byId; });
			const liveStatus = useTavernSessionStatus(props);
			const workspaceId = props.useWorkspaces(function (state) { return props.conversationHost.workspaceId(state, current); });
			const archivedSessionIds = props.useWorkspaces(function (state) { return state.archivedSessionIds; });
			const archivedSessions = React.useMemo(() => new Set(archivedSessionIds), [archivedSessionIds]);
			const [cards, setCards] = React.useState([]);
			const [initialResources, setInitialResources] = React.useState([]);
			const [selectedInitialResources, setSelectedInitialResources] = React.useState({});
			const [history, setHistory] = React.useState([]);
			// "created"（默认，按创建时间固定排列）或 "recent"（最近回复优先）。
			const [historyOrder, setHistoryOrder] = React.useState("created");
			function reloadHistoryOrder(stillWanted) {
				return tavernHistoryOrderPreference.refresh().then(function (order) {
					if (typeof stillWanted === "function" ? stillWanted() : true) setHistoryOrder(tavernHistoryOrder(order));
					return order;
				});
			}
			const removingChats = React.useSyncExternalStore(tavernChatRemovals.subscribe, tavernChatRemovals.getSnapshot);
			const listedHistory = React.useMemo(() => removingChats.size ? history.filter(item => !removingChats.has(item.chatId)) : history, [history, removingChats]);
			const unarchivedHistory = React.useMemo(() => listedHistory.filter(item => !archivedSessions.has(item.sessionId)), [listedHistory, archivedSessions]);
			const [historyGroupState, setHistoryGroupState] = React.useState(function () {
				try { const value = JSON.parse(window.localStorage.getItem("dsh-tavern-history-groups") || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch (_) { return {}; }
			});
			const activeHistoryItem = history.find(item => item.sessionId === current && isPlayMode(item.mode));
			const activeHistoryGroup = activeHistoryItem ? tavernHistoryCardKey(activeHistoryItem) : "";
			React.useEffect(function () {
				if (activeHistoryGroup) setHistoryGroupState(previous => ({ ...previous, [activeHistoryGroup]: true }));
			}, [current, activeHistoryGroup]);
			React.useEffect(function () {
				try { window.localStorage.setItem("dsh-tavern-history-groups", JSON.stringify(historyGroupState)); } catch (_) {}
			}, [historyGroupState]);
			const [picking, setPicking] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			// 选卡到开局准备页之间要读人物卡、预热脚本、问舞台设置，这几秒面板一直停在卡片列表上，
			// 看不出点中了什么。openingCardName 记住正在打开的那张卡，列表区换成带转轮的进度提示。
			const [openingCardName, setOpeningCardName] = React.useState("");
			// 第一次打开选卡面板时 listCards 还没回来，原先直接画「还没有人物卡」的空态。
			const [cardsLoading, setCardsLoading] = React.useState(false);
			const [cardImportStatus, setCardImportStatus] = React.useState("");
			const cardImporting = React.useRef(false);
			const cardBatch = useCardBatchDeletion(cards, busy, setBusy, refresh, props.archiveSession);
			const organization = useCardOrganization(cards, busy, refresh, error => setError(error), cardBatch, "play");
			const workbenchOrganization = useCardOrganization(cards, busy, refresh, error => setError(error), {}, "workbench");
			const playExport = useDshCardExport({ sessionId: "" });
			const [error, setError] = usePersistentError("左侧栏操作");
			const [uiMode, setUiMode] = React.useState("play");
			const [trustedCardMode, setTrustedCardMode] = React.useState(true);
			const [cardEntry, setCardEntry] = React.useState("");
			const [openingPicker, setOpeningPicker] = React.useState(null);
			// 选卡/开局准备页展开时收起卡片自带的悬浮应用（外置小手机挂在宿主 body 上，
			// 会盖住开场白预览和 letter 列表）；进入对局后由「人物卡应用」面板停靠显示。
			const [expandedPreviews, setExpandedPreviews] = React.useState({});
			const [historyManagerOpen, setHistoryManagerOpen] = React.useState(false);
			// the card picker and the history manager cover the window: full screen on the Windows Desktop while shown (inline-field.js)
			useWindowFullscreen((!collapsed && picking) || historyManagerOpen);
			const [managerQuery, setManagerQuery] = React.useState("");
			const [managerCardFilter, setManagerCardFilter] = React.useState("all");
			const [managerStatusFilter, setManagerStatusFilter] = React.useState("all");
			const [managerFoldedGroups, setManagerFoldedGroups] = React.useState(() => new Set());
			const [managerArchiveExpanded, setManagerArchiveExpanded] = React.useState(false);
			const [managerRenaming, setManagerRenaming] = React.useState(null);
			const managerMenu = useInlinePopup({ alignEnd: true });
			const [managerMenuSession, setManagerMenuSession] = React.useState(null);
			React.useEffect(function () {
				if (!historyManagerOpen) managerMenu.setOpen(false);
			}, [historyManagerOpen]);
			const attemptedPreviewIds = React.useRef(new Set());
			// 批量管理 › 更新 (card-update-dialog.js): a card replaced or put back is read again, and an opening prepared from it dropped.
			const cardUpdate = useTavernCardUpdate({ call, onChanged: async path => {
				await refresh(); notifyDataChanged(['cards']);
				if (openingPicker?.card?.path === path) { setOpeningPicker(null); playPrewarmRef.current.cancel(); }
			} });
			// The card picker's tiles carry the card menu of 人物卡库 (card-actions.js).
			const playActions = useTavernCardActions({ busy, setBusy, refresh, onError: setError, onNotice: setCardImportStatus, archiveSession: props.archiveSession, update: cardUpdate,
				exportCard: function (item) { if (playExport.open) playExport.open(item, { hasImage: item.hasImage }); },
				select: function (path) { cardBatch.begin([path]); } });
			const playCardMenu = function (item) { return function (close) { return h(TavernCardMenu, { card: item, actions: playActions, organization, close }); }; };
			const pickerOpen = !collapsed && (picking || historyManagerOpen || cardUpdate.open);
			function portalOverlay(node) {
				return node && typeof ReactDOM !== "undefined" && ReactDOM && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && document.body ? ReactDOM.createPortal(node, document.body) : node;
			}
			React.useEffect(function () {
				if (!pickerOpen) return;
				document.body.classList.add("dsh-tavern-picker-open");
				return function () { document.body.classList.remove("dsh-tavern-picker-open"); };
			}, [pickerOpen]);
			// 手机端侧栏整屏 fixed（见 tavern.css），宿主的侧栏底部还留着「设置」那一行
			// （宿主 footArea 排在 regionArea 之后），整屏侧栏的版本行和更新状态会压到它上面。
			// 宿主底栏高度随宿主版本和账号状态变化，量出来写进变量，让侧栏底部自己让位。
			// 基准全在宿主自己的坐标系里：手机上布局视口常比外壳可视区高一截（系统手势条、
			// 浏览器工具栏），fixed 侧栏又被外壳的 transform 收进更矮的包含块，拿
			// window.innerHeight 减底栏上沿就会多让出那段差值，底部留出一整块空白。
			// 量的也不是「regionArea 下沿」：宿主底栏里「设置」上面还排着一条 footerActions
			// （整屏侧栏铺开后被画在侧栏之下，看不见；空着时也占 34px），按 regionArea 下沿算
			// 会连它一起让出来，版本行和「设置」之间就空出一块。只让到「设置」那一行的上沿。
			React.useEffect(function () {
				return function () {
					if (typeof document !== "undefined" && document.documentElement) {
						document.documentElement.style.removeProperty("--dsh-tavern-host-foot-inset");
					}
				};
			}, []);
			React.useEffect(function () {
				if (collapsed || typeof document === "undefined" || typeof window === "undefined") return function () {};
				const root = document.documentElement;
				let frame = 0;
				let watching = null;
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(function () { schedule(); }) : null;
				function settle(inset) {
					if (inset > 0) {
						const next = inset + "px";
						if (root.style.getPropertyValue("--dsh-tavern-host-foot-inset") !== next) {
							root.style.setProperty("--dsh-tavern-host-foot-inset", next);
						}
					} else if (root.style.getPropertyValue("--dsh-tavern-host-foot-inset") !== "") {
						root.style.removeProperty("--dsh-tavern-host-foot-inset");
					}
				}
				function measure() {
					frame = 0;
					const own = document.querySelector(".dsh-tavern-sidebar:not(.collapsed)");
					const region = own && own.closest ? own.closest('[data-slot="sidebar.workspaces"]') : null;
					const area = region ? region.parentElement : null;
					const column = area ? area.parentElement : null;
					// 桌面端侧栏不是 fixed（宿主 regionArea 自己让出了底栏），这时不需要让位。
					if (!own || !area || !column || window.getComputedStyle(own).position !== "fixed") { settle(0); return; }
					const ownBox = own.getBoundingClientRect();
					const areaBox = area.getBoundingClientRect();
					// 抽屉在屏外挂载帧（content-visibility: hidden）尚无几何尺寸，保留上次缓存的让位高度，避免误删根变量触发整页样式重算与动画中途跳动。
					if (ownBox.height <= 0 || areaBox.height <= 0) {
						if (observer && watching !== column) {
							if (watching) observer.unobserve(watching);
							watching = column;
							observer.observe(column);
						}
						return;
					}
					const areaBottom = areaBox.bottom;
					// 要避开的是底栏里的「设置」那一行（宿主的 sidebar.settings 槽，槽是空盒子，
					// 取它第一个有高度的祖先）。它上面那条 footerActions 在整屏侧栏铺开时画在
					// 侧栏之下、看不见，也跟着一起让就会空出一块。找不到那一行时退回 regionArea 下沿。
					let anchor = null;
					const settingsSlot = column.querySelector('[data-slot="sidebar.settings"]');
					for (let node = settingsSlot; node && node !== column; node = node.parentElement) {
						const box = node.getBoundingClientRect();
						if (box.height > 0 && box.top >= areaBottom - 1) { anchor = box.top; break; }
					}
					settle(Math.max(0, Math.round(ownBox.bottom - (anchor === null ? areaBottom : anchor))));
					if (observer && watching !== column) {
						if (watching) observer.unobserve(watching);
						watching = column;
						observer.observe(column);
					}
				}
				function schedule() { if (!frame) frame = window.requestAnimationFrame(measure); }
				// 延后到下一帧合并测量，并保留上次打开缓存的让位高度，避免点击展开第 0 帧强制同步布局与根样式重算。
				schedule();
				window.addEventListener("resize", schedule);
				if (window.visualViewport) window.visualViewport.addEventListener("resize", schedule);
				return function () {
					window.removeEventListener("resize", schedule);
					if (window.visualViewport) window.visualViewport.removeEventListener("resize", schedule);
					if (observer) observer.disconnect();
					if (frame) window.cancelAnimationFrame(frame);
				};
			}, [collapsed]);

			const [chatImport, setChatImport] = React.useState(null);
			// 批量导入逐份进行，用它告诉用户停在第几份。
			const [importProgress, setImportProgress] = React.useState("");
			const chatImportFile = React.useRef(null);
			const [pendingOpen, setPendingOpen] = React.useState(null);
			const historyMenu = useInlinePopup({ alignEnd: true });
			const [menuSessionId, setMenuSessionId] = React.useState(null);
			const menuSession = historyMenu.open ? menuSessionId : null;
			function setMenuSession(sessionId) {
				setMenuSessionId(sessionId);
				historyMenu.setOpen(sessionId !== null);
			}
			const [archiveExpanded, setArchiveExpanded] = React.useState(false);
			const [selectedChats, setSelectedChats] = React.useState([]);
			const [deleteNotice, setDeleteNotice] = React.useState("");
			// 侧栏历史已渲染的行数（窗口），以及列表容器本身（滚动到底部时追加）。
			const [historyWindow, setHistoryWindow] = React.useState(SIDE_HISTORY_WINDOW);
			const sideListRef = React.useRef(null);
			React.useEffect(function () {
				// 收起来就收回一屏窗口：下次展开仍然只排第一屏。
				if (collapsed) {
					setHistoryWindow(SIDE_HISTORY_WINDOW);
					setMenuSession(null);
				}
			}, [collapsed]);
			React.useEffect(function () {
				setSelectedChats([]);
				setMenuSession(null);
				setDeleteNotice("");
				setArchiveExpanded(false);
				setHistoryManagerOpen(false);
				setManagerQuery("");
				setManagerCardFilter("all");
				setManagerStatusFilter("all");
				setManagerRenaming(null);
			}, [uiMode]);
			// 弹窗管理面板铺满主区域，Esc 收起来，别让玩家非去找关闭按钮。
			React.useEffect(function () {
				if (!historyManagerOpen) return;
				function onKey(event) {
					if (event.key !== "Escape" || event.isComposing || managerRenaming || overlayEscape(event)) return;
					event.stopPropagation();
					setHistoryManagerOpen(false);
					setMenuSession(null);
				}
				window.addEventListener("keydown", onKey, true);
				return function () { window.removeEventListener("keydown", onKey, true); };
			}, [historyManagerOpen, managerRenaming]);
			// 缺少楼号的旧预览分批刷新。
			const previewBackfillMounted = React.useRef(true);
			React.useEffect(function () {
				return function () { previewBackfillMounted.current = false; };
			}, []);
			React.useEffect(function () {
				const missing = history.filter(function (item) {
					return item && item.chatId && !Number.isSafeInteger(item.preview?.floorNo) && !attemptedPreviewIds.current.has(item.chatId);
				});
				if (!missing.length) return;
				// 已展开的分组和打开的管理器里的会话优先，用户正在看的那几行先补齐。
				const prioritized = missing.slice().sort(function (a, b) {
					const aVisible = historyManagerOpen || historyGroupState[tavernHistoryCardKey(a)] === true ? 1 : 0;
					const bVisible = historyManagerOpen || historyGroupState[tavernHistoryCardKey(b)] === true ? 1 : 0;
					return bVisible - aVisible;
				});
				const batch = prioritized.slice(0, 40).map(function (item) { return item.chatId; });
				batch.forEach(function (id) { attemptedPreviewIds.current.add(id); });
				call("loadSessionPreviews", { chatIds: batch, limit: 40 }).then(function (result) {
					if (!previewBackfillMounted.current) return;
					const map = result && result.previews && typeof result.previews === "object" ? result.previews : {};
					if (!Object.keys(map).length) return;
					setHistory(function (prev) {
						let changed = false;
						const next = prev.map(function (item) {
							if (!item || Number.isSafeInteger(item.preview?.floorNo) || !Number.isSafeInteger(map[item.chatId]?.floorNo)) return item;
							changed = true;
							return Object.assign({}, item, { preview: map[item.chatId] });
						});
						return changed ? next : prev;
					});
				}, function () {
					// 宿主还没有这个接口或这轮读盘失败：放开标记，下次展开分组时再试。
					batch.forEach(function (id) { attemptedPreviewIds.current.delete(id); });
				});
			}, [history, historyGroupState, historyManagerOpen]);
			const unavailableSessionsHandler = React.useRef(null);
			React.useEffect(function () {
				function onUnavailable(event) { if (unavailableSessionsHandler.current) unavailableSessionsHandler.current(event.detail?.sessionIds || []); }
				window.addEventListener("dsh-tavern-sessions-unavailable", onUnavailable);
				return function () { window.removeEventListener("dsh-tavern-sessions-unavailable", onUnavailable); };
			}, []);
			function toggleChatSelection(chatId) {
				if (busy) return;
				setSelectedChats(function (ids) { return ids.includes(chatId) ? ids.filter(function (id) { return id !== chatId; }) : ids.concat(chatId); });
			}
			async function deleteSelectedConversations(pool) {
				const items = pool.filter(function (item) { return selectedChats.includes(item.chatId); });
				if (busy || !items.length || !await askConfirm("此操作不可撤销，人物卡和世界书会保留。", { title: "彻底删除这 " + items.length + " 个对话？", confirmText: "彻底删除", danger: true, hide: "chat-bulk" })) return;
				setBusy(true); setError(""); setDeleteNotice("");
				try {
					const outcome = await deleteTavernChats(items, props.archiveSession);
					const failures = outcome.failures;
					const removed = outcome.removed;
					setSelectedChats(failures.map(function (result) { return result.chatId; }));
					setDeleteNotice("已删除 " + removed.length + " 个" + (failures.length ? "，" + failures.length + " 个失败，可重试" : ""));
					await leaveUnavailableConversation(outcome.unavailableSessionIds, true);
					if (failures.length) setError(failures.map(function (result) { const item = items.find(function (item) { return item.chatId === result.chatId; }); return (item && (item.title || item.cardName) || result.chatId) + "：" + result.error; }).join("\n"));
					// Deleting a chat never touches cards, so reload only the history list.
					await refresh(["sessions"]);
				} catch (error) { setError(String(error.message || error)); await refresh(); }
				finally { setBusy(false); }
			}
			// 归档/恢复按小并发走：一次选中几十个存档时串行会等到用户以为卡死。
			async function archiveSelectedConversations(archive, customItems) {
				const pool = Array.isArray(customItems) ? customItems : activeHistory.concat(archivedHistory);
				const items = pool.filter(function (item) {
					return selectedChats.includes(item.chatId) && archivedSessions.has(item.sessionId) !== Boolean(archive);
				});
				if (busy || !items.length) return;
				setBusy(true); setError(""); setDeleteNotice("");
				const failures = [];
				let next = 0;
				const changedSessionIds = [];
				async function worker() {
					for (;;) {
						const index = next++;
						if (index >= items.length) return;
						const item = items[index];
						try {
							if (archive) await props.archiveSession(item.sessionId);
							else await props.workspaces.unarchiveSession(item.sessionId);
							changedSessionIds.push(item.sessionId);
						} catch (err) { failures.push({ chatId: item.chatId, message: (item.title || item.cardName || item.chatId) + "：" + String(err && err.message || err) }); }
					}
				}
				try {
					await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
					setSelectedChats(failures.map(result => result.chatId));
					setDeleteNotice((archive ? "已归档 " : "已恢复 ") + changedSessionIds.length + " 个对话" + (failures.length ? "，" + failures.length + " 个失败" : ""));
					if (archive) await leaveUnavailableConversation(changedSessionIds);
					if (failures.length) setError(failures.slice(0, 10).map(result => result.message).join("\n"));
					await refresh(["sessions"]);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function openHistoryManager() {
				setMenuSession(null);
				setManagerRenaming(null);
				setSelectedChats([]);
				setDeleteNotice("");
				setManagerArchiveExpanded(false);
				setHistoryManagerOpen(true);
			}
			function closeHistoryManager() {
				setHistoryManagerOpen(false);
				setManagerRenaming(null);
				setSelectedChats([]);
			}
			// 面板里直接改名：存档改的是 chat.title，卡片工作台改的是会话名。
			async function commitManagerRename(item) {
				const pending = managerRenaming;
				if (!pending || pending.chatId !== item.chatId) return;
				setManagerRenaming(null);
				const play = isPlayMode(item.mode || "story");
				const previous = play ? (item.title || "") : historyTitle(item, summaries[item.sessionId]);
				const title = String(pending.value || "").trim();
				if (title === previous) return;
				setBusy(true); setError("");
				try {
					await (play ? props.renameChat : props.renameSession)(item.sessionId, title);
					await refresh(["sessions"]);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function openManagerSession(item) {
				try { await openSessionWhenReady(item.sessionId); setHistoryManagerOpen(false); if (narrowLayout() && typeof props.closeNarrowSidebar === "function") props.closeNarrowSidebar(); }
				catch (err) { setError(String(err && err.message || err)); }
			}
            const [updateStatus, setUpdateStatus] = React.useState({ phase: "loading", host: "cli" });
            const updater = React.useRef(null);
            React.useEffect(function () {
                const controller = createUpdateStatusController({ call, confirm: askConfirm, errors: tavernErrorHub, browser: window });
                updater.current = controller;
                const unsubscribe = controller.subscribe(() => {
                    const status = controller.getSnapshot();
                    setUpdateStatus(status);
                    // Desktop builds manage updates through their launcher settings.
                    if (status.host === 'desktop' || status.pluginManaged) controller.stop();
                });
                controller.start();
                return () => { unsubscribe(); controller.stop(); updater.current = null; };
            }, []);
            const checkUpdate = () => updater.current?.check();
            const performUpdate = () => updater.current?.perform();
            const cancelUpdate = () => updater.current?.cancel();
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
			// the picker's 「导入人物卡」 also takes a card ZIP (the 导入卡片 sheet, card-zip-entry.js),
			// and the empty list offers 「导入示例卡：大肥鱼」 (primary) and 「从网址导入卡」.
			const cardZipImport = typeof useCardZipImport === "function" ? useCardZipImport({ sessionId: props.sessionId || "", pickFile: function () { if (fileRef.current) fileRef.current.click(); }, onDone: function () { void refresh(["cards"]); } }) : null;
			const cardZip = cardZipImport && cardZipImport.api.available ? cardZipImport.api : null;
			const saveImportFile = React.useRef(null);
			const sillyTavernChatFile = React.useRef(null);
			const saveImportMenu = React.useRef(null);
			const [saveImportMenuOpen, setSaveImportMenuOpen] = React.useState(false);
			// A SillyTavern chat chosen before its card: held until that card's opening page is ready.
			const [pendingChatImport, setPendingChatImport] = React.useState(null);
			const initialImportRef = React.useRef(null);
			const initialImportKindRef = React.useRef("source");
			const playWorkspaceIdRef = React.useRef(workspaceId);
			const playWorkspaceResolverRef = React.useRef(null);
			const playPrewarmRef = React.useRef(null);
            const startAttemptsRef = React.useRef(null);
            if (!startAttemptsRef.current) startAttemptsRef.current = createConversationAttemptStore(window.localStorage);
			const sessionListRecoveryRef = React.useRef(null);
			playWorkspaceIdRef.current = workspaceId;
			if (playWorkspaceResolverRef.current === null) {
				playWorkspaceResolverRef.current = createPlayWorkspaceResolver({
					currentWorkspaceId: function () { return playWorkspaceIdRef.current; },
					resourceRoot: function (workspaceId) { return call("getResourceWorkspace", { workspaceId: workspaceId }); },
					createWorkspace: function (input) { return props.workspaces.create(input); }
				});
			}
            if (playPrewarmRef.current === null) {
                playPrewarmRef.current = createConversationPrewarmModule({ resolveWorkspace: playWorkspaceResolverRef.current });
            }
			if (sessionListRecoveryRef.current === null) {
				sessionListRecoveryRef.current = createSessionListRecoveryModule(Object.assign(sessionListAdapters(props.sessions), {
					explainMissing: async function (sessionId) {
						const state = await rpc("getSaveUpgrade", {}, sessionId);
						if (!state || state.sessions?.ready) return "";
						return "这局存档的旧会话日志无法升级到新版，原档已保留。" + (state.sessions?.error || state.error || "")
							+ "\n可在左侧对话菜单「⋯」里点「导出诊断文件」发给开发者（不含剧情正文），或用「存档救援」把剧情转到新对话继续玩。请不要删除这条记录。";
					}
				}));
			}
			const currentSummary = current ? summaries[current] : null;
			const readyTavernSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); }) ? current : "";
			const readyCardSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && entry.mode === "card"; }) ? current : "";

			React.useEffect(function () {
				if (!current || !summaries[current] || !props.sessions.binding(current)) return;
				const latest = tavernErrorHub.getSnapshot()[0];
				if (!latest || latest.source !== "左侧栏操作") return;
				if (latest.message === "DSH Session 列表同步超时，请刷新页面后重试：" + current
					|| (latest.message && latest.message.indexOf("已不在宿主列表中") >= 0 && latest.message.indexOf(current) >= 0)) setError("");
			}, [current, summaries]);
			function call(method, args, requestOptions) { return rpc(method, args, undefined, requestOptions); }
			function notifyDataChanged(kinds) {
				notifyTavernDataChanged(kinds, "sidebar");
			}
			// 打开会话、tavern 数据变更事件、设置变更会几乎同时触发侧栏刷新，原来每次
			// 各发一份 listCards/listSessions 并整表重建一次。这里按 kinds 合并并发调用，
			// 期间到达的请求排一次尾随刷新：既不吃掉变更后的新数据，也不再重复重建整张表。
			const refreshStateRef = React.useRef({ inFlight: Object.create(null), trailing: Object.create(null) });
			function refresh(kinds) {
				const key = Array.isArray(kinds) && kinds.length ? kinds.slice().sort().join(",") : "*";
				const state = refreshStateRef.current;
				const running = state.inFlight[key];
				if (running) {
					if (!state.trailing[key]) {
						const chain = function () { delete state.trailing[key]; return refresh(kinds); };
						state.trailing[key] = running.then(chain, chain);
					}
					return state.trailing[key];
				}
				const settle = function (value) { if (state.inFlight[key] === task) delete state.inFlight[key]; return value; };
				const task = refreshNow(kinds).then(settle, function (error) { settle(undefined); throw error; });
				state.inFlight[key] = task;
				return task;
			}
			function refreshNow(kinds) {
                if (!Array.isArray(kinds) || !kinds.length || kinds.indexOf("*") >= 0) kinds = null;
				return Promise.all([
					(!kinds || kinds.indexOf("cards") >= 0) && call("listCards").then(function (result) {
						setCards(result.cards || []); tavernErrorHub.resolve("左侧栏人物卡");
					}, function (err) { tavernErrorHub.report("左侧栏人物卡", err); }),
					// History rows carry their card's name, so a card change (a rename) reloads them too.
					(!kinds || kinds.indexOf("sessions") >= 0 || kinds.indexOf("cards") >= 0) && call("listSessions").then(function (result) {
						const sessions = result.sessions || [];
						setHistory(sessions); setTrustedCardMode(!result.capabilities || result.capabilities.trustedCardMode !== false); publishSessionModes(sessions);
						tavernErrorHub.resolve("左侧栏历史");
					}, function (err) { tavernErrorHub.report("左侧栏历史", err); })
				]);
			}
			React.useEffect(function () {
				function refreshSettings() { void refresh(); void reloadHistoryOrder(); }
				window.addEventListener("dsh-tavern-settings-changed", refreshSettings);
				return function () { window.removeEventListener("dsh-tavern-settings-changed", refreshSettings); };
			}, [props.sessionId]);
			// 对话排序偏好：保存后立即生效，不用刷新页面。
			React.useEffect(function () {
				let active = true;
				void reloadHistoryOrder(function () { return active; });
				return function () { active = false; };
			}, []);
			React.useEffect(function () {
				refresh();
				function onData(event) { if (tavernDataChangeAffects(event, ["cards", "sessions"], "sidebar")) refresh(event && event.detail && event.detail.kinds); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, []);
			React.useEffect(function () {
				if (!current) return;
				const stopCoordination = tavernCoordination.subscribe(current, function () {});
				const stopPreview = tavernSessionSignals.subscribe(current, "conversation-preview", () => { void refresh(["sessions"]); });
				return function () { stopCoordination(); stopPreview(); };
			}, [current]);
			React.useEffect(function () {
				return function () { playPrewarmRef.current.cancel(); };
			}, []);
			React.useEffect(function () {
				if (!currentSummary || currentSummary.blank) return;
				notifyDataChanged(["sessions"]);
			}, [current, currentSummary && currentSummary.blank]);
			React.useEffect(function () {
				if (!current || lastModeSession.current === current) return;
				const item = history.filter(function (entry) { return entry.sessionId === current; })[0];
				if (!item) return;
				lastModeSession.current = current;
				setUiMode(groupOfMode(item.mode));
			}, [current, history]);
			// Leaving the game (for another game, a card-design chat or the start page) lets coming back open the tabs again.
			// An empty `current` is not a leave: the session list is refreshing or the sidebar remounted, and the
			// mark would be cleared on that flicker — the next snapshot then reopens the panel over the story.
			// Only a blank that outlives the flicker means the player really left (start page, another workspace).
			React.useEffect(function () {
				if (current) {
					if (tavernAutoOpenClearedBy(tavernSettingsTabsShownFor, current)) tavernSettingsTabsShownFor = "";
					return;
				}
				const timer = window.setTimeout(function () { tavernSettingsTabsShownFor = ""; }, TAVERN_AUTO_OPEN_BLANK_MS);
				return function () { window.clearTimeout(timer); };
			}, [current]);
			React.useEffect(function () {
				if (!readyTavernSession || typeof props.openConversationSettingsTab !== "function") return;
				props.openConversationSettingsTab(readyTavernSession);
			}, [readyTavernSession]);
			React.useEffect(function () {
				if (!readyCardSession) return;
				if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(readyCardSession);
				if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(readyCardSession);
				if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(readyCardSession);
				if (typeof props.openResourcesTab === "function") props.openResourcesTab(readyCardSession);
			}, [readyCardSession]);
			React.useEffect(function () {
				if (current && history.some(entry => entry.sessionId === current && entry.mode === "card") && props.cleanWorkspaceDraft) return props.cleanWorkspaceDraft(current);
			}, [current, history]);
			React.useEffect(function () {
				if (!openingPicker || !openingPicker.preparationId) return;
				return retainOpeningPreparation(openingPicker.preparationId, {
					window: window, call: call,
					onError: function (error) { tavernErrorHub.report("开局准备", error); }
				});
			}, [openingPicker && openingPicker.preparationId]);
			function openPicker() {
				setMenuSession(null);
				setCardEntry("");
				setError("");
				setCardImportStatus("");
				setPicking(true);
				setCardsLoading(true);
				// Agent tools and external file edits do not emit browser-local data events.
				void call("listCards").then(function (result) {
					setCards(result.cards || []); tavernErrorHub.resolve("左侧栏人物卡");
				}, function (error) { tavernErrorHub.report("左侧栏人物卡", error); })
					.finally(function () { setCardsLoading(false); });
				void call("preparePlayStart").catch(function (error) { console.warn("dsh-tavern: 游戏启动资源预热失败，将在开始时读取", error); });
			}
			function closePicker() {
				if (busy) return;
				cardBatch.reset();
				setPendingChatImport(null);
				if (openingPicker?.importOnly) {
					setOpeningPicker(null);
					setChatImport(null);
				}
				setPicking(false);
				setCardEntry("");
			}
			async function discardOpening() {
				if (busy || !await askConfirm("放弃本次开局？已填写的选项将被清除。")) return;
				const id = openingPicker && openingPicker.preparationId;
				playPrewarmRef.current.cancel();
				setChatImport(null);
				setOpeningPicker(null);
				if (id) void call("releaseOpeningPreparation", { id: id }).catch(function () {});
			}
			async function loadWorldBookInitialResources() {
				const response = await call("listWorldBooks");
				return (response.standalone || []).concat(response.embedded || []).map(function (item) {
					return { kind: "worldbook", path: item.kind === "card" ? item.cardPath : item.path, title: item.name, detail: item.kind === "card" ? "人物卡内置 · " + item.cardName : "独立世界书" };
				});
			}
			async function loadPresetInitialResources() {
				const response = await call("listPresets");
				return (response.presets || []).map(function (item) { return { kind: "preset", path: item.path, title: item.title, detail: "作为编辑目标引用，不会在当前 Agent 中运行" }; });
			}
			async function loadSourceInitialResources() {
				const response = await call("listResources");
				return (response.resources || []).map(function (item) { return Object.assign({}, item, { kind: "source" }); });
			}
			async function loadInitialResources(task) {
				if (task === "resource-edit") {
					const groups = await Promise.all([loadSourceInitialResources(), loadWorldBookInitialResources(), loadPresetInitialResources()]);
					return groups[0].concat(groups[1], groups[2]);
				}
				if (task === "worldbook") return await loadWorldBookInitialResources();
				if (task === "preset") return await loadPresetInitialResources();
				return await loadSourceInitialResources();
			}
			async function openResourcePicker(task) {
				setBusy(true); setError("");
				try {
					setInitialResources(await loadInitialResources(task));
					setSelectedInitialResources({});
					setCardEntry(task);
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function importInitialResource(file, task) {
				if (!file || !task) return;
				setBusy(true); setError("");
				try {
					const payload = await parseTextResourceFile(file);
					if (task === "worldbook") await call("importWorldBook", { payload: payload });
					else if (task === "preset") await call("importPreset", { payload: payload });
					else await call("importSource", { payload: payload });
					notifyDataChanged([task === "worldbook" ? "worldbooks" : (task === "preset" ? "presets" : "scripts")]);
					setInitialResources(await loadInitialResources(cardEntry === "resource-edit" ? "resource-edit" : task));
					setSelectedInitialResources({});
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function toggleInitialResource(item) {
				const key = item.kind + ":" + item.path;
				setSelectedInitialResources(function (current) {
					const next = cardEntry === "resource-edit" ? {} : Object.assign({}, current);
					if (next[key]) delete next[key];
					else next[key] = { kind: item.kind, path: item.path, title: item.title };
					return next;
				});
			}
			async function ensureTavernPreset(sessionId, request) {
				await props.conversationHost.ensurePreset(sessionId, request);
			}
			async function archiveCurrentBlankSession(protectedSessionId) {
				const currentSummary = current ? summaries[current] : null;
				if (!current || !currentSummary || !currentSummary.blank) return;
				if (current === protectedSessionId) return;
				// DSH's blank flag does not mean an existing Tavern opening can be discarded.
				if (history.some(function (entry) { return entry.sessionId === current; })) return;
				try { await props.workspaces.archiveSession(current); }
				catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
			}
			async function waitForSessionSummary(sessionId) {
				await sessionListRecoveryRef.current.wait(sessionId);
			}
			// 点会话的那一瞬间就把这一局的故事正文读起来。否则要等 getSession（手机实测
			// 2.4s 量级）落地、列表挂载后才发出第一次 getStoryTranscript（1.4s），两段
			// 串成一条瀑布，界面上就一直停在「正在读取故事…」。预取只写缓存、不改可见
			// 状态；模块未包含或预取失败时静默跳过，绝不影响切换本身。
			function prefetchStoryOnSwitch(sessionId) {
				try {
					const id = String(sessionId || "");
					if (id === "" || typeof prefetchTavernStoryTranscript !== "function") return;
					const row = history.find(function (entry) { return entry.sessionId === id; });
					if (row && !isPlayMode(row.mode || "story")) return;
					void prefetchTavernStoryTranscript(sessionId);
				} catch (_) { /* 预取是加速，不是切换的前提 */ }
			}
			async function openSessionWhenReady(sessionId) {
				prefetchStoryOnSwitch(sessionId);
				await sessionListRecoveryRef.current.open(sessionId);
				// 切过来就立刻把这一局的视图读出来。不这么做的话，按钮先拿着切换前那份
				// 视图（多半是空会话的）判定，要等它自己重试或者玩家点开「更多」——那里的
				// 菜单项一挂载就 invalidate——才恢复。等一个渲染周期，让订阅先挂上。
				window.setTimeout(function () {
					try { if (liveTavernView && typeof liveTavernView.invalidate === "function") liveTavernView.invalidate(sessionId); } catch (_) { /* 订阅方自己会重试 */ }
					try { if (tavernCoordination && typeof tavernCoordination.invalidate === "function") tavernCoordination.invalidate(sessionId); } catch (_) { /* 同上 */ }
				}, 80);
				// Last-opened ordering is bookkeeping, not a first-paint dependency. Keep its
				// write → list refresh order off the critical path to mounting the transcript.
				void Promise.resolve().then(function () { return call("markConversationOpened", { sessionId: sessionId }); })
					.then(function () { return refresh(["sessions"]); })
					.catch(function (error) { setError("更新最近打开顺序失败：" + String(error && error.message || error)); });
				setError("");
			}
			// clearMain() leaves no Session for the host's blank-session entries
			// (including better-sidebar's bottom-panel toggle) to mount into.
			async function openBlankConversation() {
				try {
					const targetWorkspaceId = await playWorkspaceResolverRef.current();
					await openSessionWhenReady(await props.conversationHost.connectWorkspace(targetWorkspaceId));
				} catch (err) {
					props.sessions.clear();
					setError("创建新对话失败：" + String(err && err.message || err));
				}
			}
			async function finishPendingOpen(pending) {
				await openSessionWhenReady(pending.sessionId);
				setPendingOpen(null);
				setUiMode(groupOfMode(pending.targetMode));
				publishSessionMode(pending.sessionId, pending.targetMode);
				window.dispatchEvent(new CustomEvent("dsh-tavern-session-changed", { detail: { sessionId: pending.sessionId } }));
				if (pending.targetMode === "card") {
					if (pending.debugSource) {
						const attached = await call("attachPlayChatDebug", { targetSessionId: pending.sessionId, sourceSessionId: pending.debugSource.sourceSessionId, turn: pending.debugSource.turn });
						const reference = attached && attached.reference;
						if (!reference || !reference.path) throw new Error("游玩记录关联失败，请重试");
						pending.taskSupplement = "<linked_play_chat>\n" + String(reference.label || "游玩记录") + "\nref: " + String(reference.path) + "\n使用 tavern_read_play_chat 读取，先查看 overview。\n</linked_play_chat>";
					}
					if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(pending.sessionId);
					if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(pending.sessionId);
					if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(pending.sessionId);
					if (typeof props.openResourcesTab === "function") props.openResourcesTab(pending.sessionId);
					if (pending.task) await props.injectTaskPrompt(pending.sessionId, pending.task, pending.label, pending.card, pending.selectedResources || [], pending.taskSupplement);
					else (pending.selectedResources || []).forEach(function (resource) { props.appendMention(pending.sessionId, resource.kind, resource.path, resource.title); });
				} else if (typeof props.openConversationSettingsTab === "function") props.openConversationSettingsTab(pending.sessionId);
				if (pending.targetMode !== "card") {
                    const id = openingPicker && openingPicker.preparationId;
                    setOpeningPicker(null);
                    if (id) void call("releaseOpeningPreparation", { id: id }).catch(function () {});
                }
                setPicking(false); setCardEntry("");
			}
			const conversationLifecycle = createConversationLifecycleModule({
                attempts: startAttemptsRef.current,
                trace: stage => openingPerformance.begin(stage),
				archiveCurrent: archiveCurrentBlankSession,
				resolveWorkspace: async function (request) {
					if (request.kind !== "card") return playWorkspaceResolverRef.current();
					const resourceRoot = await call("getResourceWorkspace");
					const resourceWorkspace = await props.workspaces.create({ path: resourceRoot.path });
					return resourceWorkspace.workspaceId;
				},
				connectWorkspace: function (targetWorkspaceId) { return props.conversationHost.connectWorkspace(targetWorkspaceId); },
				waitForSession: waitForSessionSummary,
				ensurePreset: ensureTavernPreset,
				createChat: async function (request, sessionId) {
					const result = await call("startChat", {
						path: request.card && request.card.path ? request.card.path : "",
						sessionId: sessionId,
						mode: request.targetMode,
						cardTask: request.task || "",
						openingId: request.openingId || "",
						preparationId: request.preparationId || "",
						userName: request.userName || (request.targetMode === "card" ? "你" : ""),
						requestMode: "dsh"
					});
					// startChat already returned the new chat's complete first view. The
					// conversation consumes it on first subscribe instead of projecting it twice.
					if (result && result.view && typeof liveTavernView.seed === "function") liveTavernView.seed(sessionId, result.view);
					return result;
				},
				rememberPending: setPendingOpen,
				finishOpen: finishPendingOpen
			});
			// The stage's new game action uses the same entry as the card list. fresh: the chat has no player message yet
			// a card with an opening setup opens its 游戏准备 and the new game replaces this
			// never-played chat; any other card has nothing to prepare, and respond(false) lets the stage start this chat.
			const newGameFrom = React.useRef(null);
			newGameFrom.current = function (sessionId, fresh, respond) {
				const item = history.find(function (row) { return row.sessionId === sessionId; });
				if (!item || !item.cardPath || busy) return respond(false);
				if (!fresh) openPicker();
				void call("listCards").then(function (result) {
					const card = (result.cards || []).find(function (row) { return row.path === item.cardPath && !row.readError; });
					if (fresh && !(card && card.hasOpeningForm)) return respond(false);
					respond(true);
					if (fresh) { openPicker(); return preparePlayConversation(card, item); }
					if (card) return openPlayCard(card, true);
				}).catch(function (err) { respond(false); setError(String(err && err.message || err)); });
			};
			React.useEffect(function () {
				const listener = function (event) {
					const detail = event.detail || {};
					detail.handled = true;
					newGameFrom.current(detail.sessionId, detail.fresh === true, typeof detail.respond === "function" ? detail.respond : function () {});
				};
				window.addEventListener("dsh-tavern-new-game", listener);
				return function () { window.removeEventListener("dsh-tavern-new-game", listener); };
			}, []);
			// A card's opening page on the stage (card page opening:true, presets/tavern/skills/stage/references/page-contract.md「开局页」) starts the game
			// with its choice: the card's openingSetup resolved by the host (prepareOpeningPage, the 游戏准备 form's own authority),
			// then the same start as every game. The game replaces the never-played chat the page stood on, and the stage enters
			// it at its first act (no entry page).
			const stageOpeningFrom = React.useRef(null);
			stageOpeningFrom.current = async function (sessionId, choice) {
				const item = history.find(function (row) { return row.sessionId === sessionId; });
				if (!item || !item.cardPath) throw new Error("找不到这局游戏");
				if (busy) throw new Error("正在处理别的操作，请稍候再开始");
				const card = ((await call("listCards")).cards || []).find(function (row) { return row.path === item.cardPath && !row.readError; });
				if (!card) throw new Error("人物卡不存在");
				const draft = await call("createOpeningPreparation", { path: card.path, brief: true });
				try {
					const prepared = await call("callOpeningRuntime", { id: draft.id, method: "prepareOpeningPage", args: choice });
					await newConversation(card, null, choice.openingId, prepared.playerName, prepared.input || undefined, { preparationId: draft.id, replaces: item,
						onCreated: function (created) { galHandover(); galEnter(created.sessionId, { page: "" }); } });
				} catch (error) { galHandoverEnd(); throw error; } finally { void call("releaseOpeningPreparation", { id: draft.id }).catch(function () {}); }
			};
			React.useEffect(function () {
				const listener = function (event) {
					const detail = event.detail || {};
					detail.handled = true;
					stageOpeningFrom.current(detail.sessionId, detail.choice || {}).then(detail.respond, detail.fail);
				};
				window.addEventListener("dsh-tavern-stage-opening", listener);
				return function () { window.removeEventListener("dsh-tavern-stage-opening", listener); };
			}, []);
			async function retryPendingOpen() {
				if (!pendingOpen) return;
				setBusy(true); setError("");
				try { await finishPendingOpen(pendingOpen); startAttemptsRef.current.complete(pendingOpen.sessionId); }
				catch (err) { setError("重新连接 Session 失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function readChatImportFile(file) {
				if (file.size > 24 * 1024 * 1024) throw new Error("聊天文件最大支持 24 MiB");
				return await file.text();
			}
			// 多份记录共用这张人物卡与同一个玩家称呼，预览合并成一次确认。
			async function loadChatImportPreview(card, sources) {
				setBusy(true); setError(""); setImportProgress("");
				try {
					const entries = [];
					for (const source of sources) {
						setImportProgress(sources.length > 1 ? "正在读取 " + (entries.length + 1) + "/" + sources.length + "：" + source.fileName : "");
						// 一份读不了就整批停下：这一批共用人物卡，先让用户改选文件再来。
						let preview;
						try { preview = await call("previewChatImport", { cardPath: card.path, text: source.text }); }
						catch (error) { throw new Error(sources.length > 1 ? source.fileName + "：" + String(error.message || error) : String(error.message || error)); }
						entries.push({ fileName: source.fileName, text: source.text, preview: preview });
					}
					const merged = chatImportMergedPreview(entries);
					setChatImport({ cardPath: card.path, entries: entries, preview: merged, userName: merged.userName, textOnly: false });
				} catch (error) { setError(String(error.message || error)); }
				finally { setImportProgress(""); setBusy(false); }
			}
			async function previewChatImport(files) {
				const chosen = Array.prototype.slice.call(files || []);
				if (!chosen.length || !openingPicker) return;
				const sources = [];
				for (const file of chosen) {
					try { sources.push({ fileName: file.name, text: await readChatImportFile(file) }); }
					catch (error) { setError((chosen.length > 1 ? file.name + "：" : "") + String(error.message || error)); return; }
				}
				await loadChatImportPreview(openingPicker.card, sources);
			}
			// From the card list: the chat names its character, so a single same-named card is opened directly.
			async function chooseSillyTavernChat(file) {
				if (!file || busy) return;
				setError("");
				let text;
				try { text = await readChatImportFile(file); } catch (error) { setError(String(error.message || error)); return; }
				let characterName = "";
				try { characterName = String(JSON.parse(text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length)).character_name || "").trim(); } catch (error) {}
				setPendingChatImport({ text: text, fileName: file.name, characterName: characterName });
				const matches = characterName ? cards.filter(function (card) { return !card.readError && String(card.name || "").trim() === characterName; }) : [];
				if (matches.length === 1) setOpeningPicker({ card: matches[0], openings: [], importOnly: true });
			}
			React.useEffect(function () {
				if (!pendingChatImport || !openingPicker || openingPicker.preparing || busy) return;
				const pending = pendingChatImport;
				setPendingChatImport(null);
				void loadChatImportPreview(openingPicker.card, [{ text: pending.text, fileName: pending.fileName }]);
			}, [pendingChatImport, openingPicker, busy]);
			React.useEffect(function () {
				if (!saveImportMenuOpen) return;
				function outside(event) { if (!saveImportMenu.current || !saveImportMenu.current.contains(event.target)) setSaveImportMenuOpen(false); }
				function escape(event) { if (event.key === "Escape") setSaveImportMenuOpen(false); }
				document.addEventListener("pointerdown", outside, true);
				document.addEventListener("keydown", escape);
				return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
			}, [saveImportMenuOpen]);
			// A save from another install becomes a new game here; the card comes with it.
			async function importGameSave(file) {
				if (busy) return;
				setBusy(true); setError("");
				try {
					const hint = misplacedFileHint(file, true);
					if (hint) throw new Error(hint);
					if (file.size > 256 * 1024 * 1024) throw new Error("存档文件太大（上限 256 MB）。");
					const uploadId = await uploadTavernCardFile(file, () => {});
					const imported = await call("importGameSave", { uploadId });
					notifyDataChanged(["cards", "sessions"]);
					closePicker();
					await finishPendingOpen({ sessionId: imported.sessionId, targetMode: "story" });
				} catch (error) { setError("没能导入存档：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			// 一份记录一个新对话。“仅导入正文”只作用于变量不兼容的那几份，其余照常恢复 MVU 状态；
			// 称呼留空时由服务端沿用每份记录自己的称呼。
			async function importConversationEntry(request, entry) {
				request = Object.assign({}, request, { textOnly: request.textOnly && Boolean(entry.preview.incompatible) });
				const key = "dsh-tavern:chat-import:" + JSON.stringify([entry.preview.digest, request.cardPath, request.userName, request.textOnly]);
				let attempt;
				try { attempt = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
				if (!attempt || !/^[a-zA-Z0-9-]{8,100}$/.test(attempt.operationId || "") || !attempt.sessionId) {
					const targetWorkspaceId = await playWorkspaceResolverRef.current();
					attempt = { operationId: window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : "op-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12), sessionId: await props.conversationHost.connectWorkspace(targetWorkspaceId) };
					localStorage.setItem(key, JSON.stringify(attempt));
				}
				await waitForSessionSummary(attempt.sessionId);
				await ensureTavernPreset(attempt.sessionId, { kind: "play" });
				const imported = await call("importChatHistory", Object.assign({}, attempt, { cardPath: request.cardPath, text: entry.text, fileName: entry.fileName, userName: request.userName, textOnly: request.textOnly }));
				localStorage.removeItem(key);
				return { sessionId: attempt.sessionId, targetMode: imported.mode || "story" };
			}
			async function importConversation() {
				if (busy || !chatImport || !openingPicker || chatImport.cardPath !== openingPicker.card.path) return;
				setBusy(true); setError(""); setImportProgress("");
				const request = { cardPath: chatImport.cardPath, userName: chatImport.userName, textOnly: chatImport.textOnly };
				const entries = chatImport.entries;
				try {
					await playPrewarmRef.current.cancel();
					const batch = await chatImportBatchRun(entries, function (entry) { return importConversationEntry(request, entry); }, function (step) {
						setImportProgress(step.total > 1 ? "正在导入 " + (step.index + 1) + "/" + step.total + "：" + step.entry.fileName : "");
					});
					setImportProgress("");
					notifyDataChanged(["sessions"]);
					const summary = chatImportBatchSummary(batch);
					// 批量导入不抢走当前视图：只有单份导入才直接打开那个对话。
					if (entries.length === 1 && batch.succeeded.length === 1) {
						const pending = batch.succeeded[0].result;
						setPendingOpen(pending);
						setChatImport(null);
						await finishPendingOpen(pending);
					} else {
						setChatImport(null);
						closePicker();
					}
					if (summary) setError(summary);
				} catch (error) { setError("导入失败：" + String(error.message || error)); }
				finally { setImportProgress(""); setBusy(false); }
			}
			// from: a start that is not the 游戏准备 page's ({preparationId, replaces, onCreated(created)}: a card's opening page on the
			// stage); its failure is thrown to the caller and the page stays where it is.
			async function newConversation(card, requestedMode, openingId, userName, initialMessage, from) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "card");
				const startedAt = Date.now();
                const timing = openingPerformance.begin("startClick");
                let successful = false;
				const previousOpeningPicker = from || openingPicker;
                let created = null;
				const transitionOpening = previousOpeningPicker && previousOpeningPicker.openings ? previousOpeningPicker.openings.filter(function (item) { return item.id === openingId; })[0] : null;
				tavernSessionTransition.begin({ projection: transitionOpening && transitionOpening.projection, trustedCardMode: previousOpeningPicker && previousOpeningPicker.trustedCardMode === true });
				setBusy(true); setError("");
				try {
					const resolvedUserName = String(userName || "").trim();
					let preparedWorkspaceId = "";
					try {
						try { preparedWorkspaceId = await timing.measure("claimPrewarm", () => playPrewarmRef.current.claim(card && card.path)); }
						catch (prewarmError) { console.warn("dsh-tavern: 工作区预热不可用，改为正常创建", prewarmError); }
						created = await conversationLifecycle.start({ kind: "play", targetMode: targetMode, card: card, preparationId: previousOpeningPicker && previousOpeningPicker.preparationId || "", openingId: openingId || "", userName: resolvedUserName, preparedWorkspaceId: preparedWorkspaceId });
					} finally {
						// Release the script owner before /trigger waits for its MVU initialization.
						tavernSessionTransition.end();
					}
					if (from && from.onCreated) from.onCreated(created);
					if (initialMessage) {
						const playerName = liveTavernView.getSnapshot(created.sessionId).view?.playerName || resolvedUserName || previousOpeningPicker?.defaultPlayerName;
						await timing.measure("submitInitialMessage", () => props.executeSlash("/send " + substituteTavernIdentityMacros(initialMessage, { playerName, characterName: card && card.name }) + "|/trigger", created.sessionId));
					}
					// the never-played chat this game replaces (newGameFrom) goes once the new one stands
					const replaces = previousOpeningPicker && previousOpeningPicker.replaces;
					if (replaces && replaces.sessionId !== created.sessionId) {
						try { await removeChat(replaces); await refresh(["sessions"]); }
						catch (removeError) { setError("旧的空白开局没有删掉，可以在游玩历史里手动删除：" + String(removeError && removeError.message || removeError)); }
					}
					successful = true;
					console.info("dsh-tavern: 开始游戏完成", (Date.now() - startedAt) + "ms", preparedWorkspaceId ? "工作区已就绪" : "即时创建");
				} catch (err) { if (!created && !from) setOpeningPicker(previousOpeningPicker); setError((created ? "游戏已创建，开局消息发送失败：" : String(err && err.phase || "创建对话") + "失败：") + String(err && err.message || err)); if (initialMessage || (from && from.preparationId)) throw err; }
				finally { timing.finish(successful); setBusy(false); }
			}
			// toOpening: the player asked for a new game on the stage (its title page's 新游戏 on a saved chat), so a card with an
			// opening page enters it at once instead of at its title page.
			// card.entryStart: the card's own initial entry page opens each new game and the 游戏准备 has nothing to ask (no opening
			// setup, one greeting): the game starts at that greeting at once, on the stage when it is on, else in text mode.
			async function openPlayCard(card, toOpening) {
				if (busy) return;
				if (pendingChatImport) {
					setOpeningPicker({ card: card, openings: [], importOnly: true });
					return;
				}
				// 点中卡片就立刻给反馈：读卡、问舞台设置、预热脚本都在下面的 await 里，之前这段时间面板
				// 一动不动，看起来像点了没反应。busy 也一起举起来，避免这中间被重复点选或关掉面板。
				setOpeningCardName(card.name || "这张人物卡");
				setBusy(true);
				setError("");
				try {
					const startsItself = card.entryStart === true || (card.hasOpeningForm && Boolean(card.openingPage));
					if (startsItself && await stageOpens(card)) {
						// the card's own opening page on the stage takes the place of the 游戏准备: the chat made here is the
						// never-played game the page completes (and replaces). The stage client loads only while an open session
						// needs it (none may be open yet, e.g. a fresh install): it is held until the new game is entered.
						const release = galStageHold();
						let entering = false;
						try {
							return await newConversation(card, null, undefined, undefined, undefined, { onCreated: function (created) {
								entering = true;
								whenStageAvailable(function () { release(); galEnter(created.sessionId, toOpening && card.openingPage ? { page: card.openingPage } : undefined); });
							} });
						} finally { if (!entering) release(); }
					}
					if (card.hasOpeningForm) return await preparePlayConversation(card);
					return await newConversation(card, null, undefined, undefined, undefined, {});
				} finally { setOpeningCardName(""); setBusy(false); }
			}
			// The server stage is ready and the card's 舞台模式 is effective.
			async function stageOpens(card) {
				try {
					return (await call("prepareCardStage", { path: card.path }))?.stage === true;
				} catch (error) { console.warn("dsh-tavern: 读不到舞台设置，按舞台关闭开局", error); return false; }
			}
			function whenStageAvailable(run) {
				if (galStageAvailable.get()) return run();
				const stop = galStageAvailable.subscribe(function () { if (galStageAvailable.get()) { stop(); run(); } });
			}
			// replaces: a never-played chat of this card (newGameFrom) that the game started here takes the place of.
			async function preparePlayConversation(card, replaces) {
				setBusy(true); setError("");
                const timing = typeof openingPerformance !== "undefined" ? openingPerformance.begin("preparePreview") : null;
                let successful = false;
				playPrewarmRef.current.begin({ key: card.path, kind: "play" });
				try {
					setOpeningPicker({ card: card, openings: [], index: 0, preparing: true, replaces: replaces || null });
					const response = await initializeFullOpeningTemplate(await call("getCardOpenings", { previewTransport: "deferred-v1", path: card.path }));
					const openings = response.openings || [];
					setOpeningPicker({ card: card, replaces: replaces || null, preparing: false, preparationId: response.preparationId || "", defaultPlayerName: response.defaultPlayerName, openings: openings, index: 0, trustedCardMode: response.trustedCardMode });
				successful = true;
				} catch (err) { setOpeningPicker(null); playPrewarmRef.current.cancel(); setError(String(err && err.message || err)); }
				finally { if (timing) timing.finish(successful); setBusy(false); }
			}
			async function refreshImportedCards() {
				await refresh(["cards"]);
				notifyDataChanged(["cards"]);
			}
			async function importPickedCards(files) {
				if (!files.length || busy || cardImporting.current) return;
				cardImporting.current = true;
				setBusy(true); setError(""); setCardImportStatus("正在准备导入…");
				try {
					const result = await importTavernCardSelection(files, call, { cardZip, onProgress: setCardImportStatus });
					if (result.lastPath) await refreshImportedCards();
					setCardImportStatus(result.summary);
					if (result.failures.length) setError(result.failures.join("\n"));
				} catch (error) {
					setCardImportStatus("");
					setError(String(error?.message || error));
				} finally {
					cardImporting.current = false;
					setBusy(false);
				}
			}
			async function newCardConversation(card, task, label, selectedResources, debugSource, taskSupplement) {
				setBusy(true); setError("");
				try {
					await conversationLifecycle.start({
						kind: "card", targetMode: "card", card: card, task: task,
						pending: { task: task, label: label, card: card, selectedResources: selectedResources || [], debugSource: debugSource || null, taskSupplement: taskSupplement || "" }
					});
				} catch (err) { setError(String(err && err.phase || "创建对话") + "失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				function onAdjustCardStyle(event) {
					const detail = event.detail || {};
					if (busy || !detail.card || !detail.card.path) return;
					newCardConversation(detail.card, "edit", "调整人物卡文风", [], null, "我想调整这张人物卡的文风。请先询问我想改变哪些写法，再根据我的要求修改卡片。");
				}
				window.addEventListener("dsh-tavern-adjust-card-style", onAdjustCardStyle);
				return function () { window.removeEventListener("dsh-tavern-adjust-card-style", onAdjustCardStyle); };
			});
			React.useEffect(function () {
				function onOpenUserProfileTask() {
					newCardConversation(null, "user-profile", "建立长期偏好");
				}
				window.addEventListener("dsh-tavern-open-user-profile-task", onOpenUserProfileTask);
				return function () { window.removeEventListener("dsh-tavern-open-user-profile-task", onOpenUserProfileTask); };
			});
			React.useEffect(function () {
				function onDebugPlayChat(event) {
					const detail = event && event.detail ? event.detail : {};
					Promise.resolve().then(async function () {
						const target = await call("getPlayChatDebugTarget", { sessionId: detail.sourceSessionId });
						await newCardConversation(target.card, "debug-play", "调试游玩对话", [], { sourceSessionId: detail.sourceSessionId, turn: detail.turn });
						if (typeof detail.resolve === "function") detail.resolve();
					}).catch(function (error) {
						setError("打开卡片调试失败：" + String(error && error.message || error));
						if (typeof detail.reject === "function") detail.reject(error);
					});
				}
				window.addEventListener("dsh-tavern-debug-play-chat", onDebugPlayChat);
				return function () { window.removeEventListener("dsh-tavern-debug-play-chat", onDebugPlayChat); };
			});
			React.useEffect(function () {
				function onEditPreset(event) {
					const detail = event && event.detail ? event.detail : {};
					if (!detail.path) return;
					newCardConversation(null, "preset", "修改预设", [{ kind: "preset", path: detail.path, title: detail.title || detail.path }]);
				}
				window.addEventListener("dsh-tavern-edit-preset", onEditPreset);
				return function () { window.removeEventListener("dsh-tavern-edit-preset", onEditPreset); };
			});
			function formatTime(ts) {
				if (!ts) return "";
				const d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
			}
			// a play save shows its own name, or its start time when unnamed;
			// the card name is already the group heading and the conversation title.
			function playCreatedAt(item) {
				const stored = Number(item.createdAt);
				if (stored > 0) return stored;
				const match = /^chat-([0-9a-z]+)-/.exec(String(item.chatId || ""));
				const parsed = match ? parseInt(match[1], 36) : 0;
				return parsed > 0 ? parsed : Number(item.updatedAt) || 0;
			}
			function historyTitle(item, summary) {
				if (item.title) return item.title;
				if (isPlayMode(item.mode || "story")) return formatTime(playCreatedAt(item)) + " 开局";
				return summary && summary.displayTitle ? summary.displayTitle : item.cardName + "的新对话";
			}
			async function switchMode(nextMode) {
				playPrewarmRef.current.cancel();
				setUiMode(nextMode); setPicking(false); setMenuSession(null);
				// Back to the conversation last used in that mode, not the newest created (#220).
				const first = unarchivedHistory.filter(function (item) {
					if (groupOfMode(item.mode) !== nextMode) return false;
					if (nextMode !== "play") return true;
					return item.requestMode !== "sillytavern";
				}).reduce(function (best, item) { return !best || tavernHistoryActivity(item, summaries) > tavernHistoryActivity(best, summaries) ? item : best; }, null);
				if (first) {
					try { await openSessionWhenReady(first.sessionId); }
					catch (err) { setError("打开 Session 失败：" + String(err && err.message || err)); }
				}
				else if (nextMode === "card") openPicker();
				else openPicker();
			}
			// 页面一打开常常落在 DSH 刚新建的空会话上：那里没有存档，getSession 只会
			// 回 {view:null, emptyReason:'no-session'}，按钮也就无从谈起「重新生成正文」。
			// 只在首屏、且不在新建/待打开流程里时，直接打开最近游玩的那一局。
			const bootstrapRedirected = React.useRef(false);
			React.useEffect(function () {
				if (bootstrapRedirected.current) return;
				if (!unarchivedHistory.length || !current) return;
				if (busy || picking || pendingOpen) return;
				if (history.some(function (item) { return item.sessionId === current; })) { bootstrapRedirected.current = true; return; }
				const fallback = unarchivedHistory.reduce(function (best, item) {
					if (groupOfMode(item.mode) !== "play" || item.requestMode === "sillytavern") return best;
					return !best || tavernHistoryActivity(item, summaries) > tavernHistoryActivity(best, summaries) ? item : best;
				}, null);
				if (!fallback) return;
				bootstrapRedirected.current = true;
				openSessionWhenReady(fallback.sessionId).catch(function (err) { setError("打开上一局失败：" + String(err && err.message || err)); });
			}, [history, unarchivedHistory, current, busy, picking, pendingOpen]);

			async function switchToPlay() {
				playPrewarmRef.current.cancel();
				setUiMode("play"); setPicking(false); setMenuSession(null); setBusy(true); setError("");
                if (openingPicker) {
                    setPicking(true); setBusy(false); return;
                }
				try {
					const target = unarchivedHistory.find(function (item) {
						return isPlayMode(item.mode) && item.requestMode !== "sillytavern";
					});
					if (!target) { props.sessions.clear(); openPicker(); return; }
					if (target.sessionId !== current) await openSessionWhenReady(target.sessionId);
				} catch (err) { setError("切换对话列表失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
            async function rescueConversation(item) {
                if (busy || !await askConfirm("存档救援：仅在旧对话无法继续使用时操作。\n\n迁移玩家输入和剧情正文，并携带最后可用的 MVU 快照继续更新状态。快照可能落后于正文，迁移后请核对数值；MVU 卡缺少有效快照时会停止救援。新对话按故事模式继续，不恢复旧剧本进度。导入的历史不能回退；重新生成只重写最后一楼正文，生成后那一楼即属于新对话。原存档保留。\n\n确定迁移剧情到新对话？")) return;
                setBusy(true); setError(""); setMenuSession(null);
                const key = "dsh-tavern:rescue:" + item.chatId;
                try {
                    await playPrewarmRef.current.cancel();
                    let attempt;
                    try { attempt = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
                    if (!attempt || !/^[a-zA-Z0-9-]{8,100}$/.test(attempt.operationId || "") || !attempt.sessionId) {
                        const workspaceId = await playWorkspaceResolverRef.current();
                        attempt = { operationId: window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : "op-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12), sessionId: await props.conversationHost.connectWorkspace(workspaceId) };
                        localStorage.setItem(key, JSON.stringify(attempt));
                    }
                    await waitForSessionSummary(attempt.sessionId);
                    await ensureTavernPreset(attempt.sessionId, { kind: "play" });
                    const result = await call("rescueChatHistory", { ...attempt, sourceChatId: item.chatId });
                    const pending = { sessionId: result.sessionId, targetMode: result.mode || "story" };
                    setPendingOpen(pending); localStorage.removeItem(key);
                    await finishPendingOpen(pending);
                } catch (err) { setError("存档救援未完成，旧存档未修改：" + String(err.message || err)); }
                finally { setBusy(false); }
            }
			async function renameConversation(item, currentTitle) {
				setMenuSession(null);
				const play = isPlayMode(item.mode || "story");
				const title = play
					? await askTavernText({ title: "重命名存档", initialValue: item.title || "", placeholder: "留空则显示开局时间", allowEmpty: true, maxLength: 80 })
					: await askTavernText({ title: "重命名对话", initialValue: currentTitle || item.cardName + "的新对话", maxLength: 80 });
				if (title === null || title === (play ? item.title || "" : currentTitle)) return;
				setBusy(true); setError("");
				try { await (play ? props.renameChat : props.renameSession)(item.sessionId, title); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function changeConversationArchive(item, archive) {
				setMenuSession(null); setBusy(true); setError("");
				try {
					if (archive) {
						await props.archiveSession(item.sessionId);
						await leaveUnavailableConversation([item.sessionId]);
					} else {
						await props.workspaces.unarchiveSession(item.sessionId);
					}
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function removeChat(item) {
				const outcome = await deleteTavernChats([item], props.archiveSession);
				await leaveUnavailableConversation(outcome.unavailableSessionIds, true);
				if (outcome.failures.length) throw new Error(outcome.failures[0].error);
			}
			async function deleteConversation(item, currentTitle) {
				setMenuSession(null);
				if (!await askConfirm("此操作不可撤销，人物卡和世界书会保留。", { title: "彻底删除对话“" + (currentTitle || item.cardName + "的新对话") + "”？", confirmText: "彻底删除", danger: true, hide: "chat" })) return;
				setBusy(true); setError("");
				try {
					await removeChat(item);
				} catch (err) { setError(String(err && err.message || err)); }
				// Deleting a chat never touches cards, so reload only the history list; a failed
				// deletion reloads it too, or the row would stay listed as it was before.
				finally { await refresh(["sessions"]); setBusy(false); }
			}
			async function forkConversation(item, currentTitle, turn, target) {
				setMenuSession(null);
				setBusy(true); setError("");
				let targetSessionId = "";
				let forkCreated = false;
				try {
					const direct = Number.isSafeInteger(target && target.messageIndex);
					const plan = await call("prepareConversationFork", direct
						? { chatId: item.chatId, sessionId: item.sessionId, messageIndex: target.messageIndex, revision: target.revision, messageUid: target.messageUid }
						: { chatId: item.chatId, sessionId: item.sessionId, turn: Number(turn) || 0 });
					if (plan.storyDirect) {
						const targetWorkspaceId = await playWorkspaceResolverRef.current();
						targetSessionId = await props.conversationHost.connectWorkspace(targetWorkspaceId);
						await ensureTavernPreset(targetSessionId, {});
					} else targetSessionId = await props.conversationHost.forkSession(item.sessionId, plan.atSeq);
					await call("forkChat", {
						chatId: item.chatId,
						sessionId: item.sessionId,
						targetSessionId: targetSessionId,
						turn: plan.turn, sourceRevision: plan.sourceRevision, atSeq: plan.atSeq,
						messageIndex: plan.messageIndex, messageUid: plan.messageUid
					});
					forkCreated = true;
					const titleSuffix = target && typeof target.titleSuffix === "string" && target.titleSuffix ? target.titleSuffix : " · 分支";
					const forkTitle = (currentTitle || item.cardName + "的新对话") + titleSuffix;
					try { await (isPlayMode(item.mode || "story") ? props.renameChat : props.renameSession)(targetSessionId, forkTitle); }
					catch (renameError) { console.warn("dsh-tavern: 分叉已创建，但自动命名失败", renameError); }
					const pending = { sessionId: targetSessionId, targetMode: item.mode };
					setPendingOpen(pending);
					await finishPendingOpen(pending);
					return targetSessionId;
				} catch (err) {
					if (targetSessionId && !forkCreated) {
						try { await props.archiveSession(targetSessionId); }
						catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) console.warn("dsh-tavern: 清理分叉目标 Session 失败", archiveError); }
					}
					setError("分叉对话失败：" + String(err && err.message || err));
					throw err;
				} finally { setBusy(false); }
			}
			React.useEffect(function () {
				return tavernConversationForkRequests.bind(function (request) {
					if (busy) throw new Error("当前有其他操作正在进行，请稍后再分叉");
					const item = history.find(function (entry) { return entry.sessionId === request.sessionId && isPlayMode(entry.mode); });
					if (!item) throw new Error("找不到当前游玩存档");
					return forkConversation(item, historyTitle(item, summaries[item.sessionId]), request.turn, request);
				});
			}, [history, summaries, busy]);
			// the host titles a session after its first message (Tavern's internal
			// opening prompt). Play saves show the card name in the conversation header instead.
			const hostTitleSynced = React.useRef(new Set());
			const currentHostTitle = current && summaries[current] ? String(summaries[current].title || "") : null;
			React.useEffect(function () {
				if (!current || currentHostTitle === null || typeof props.syncHostTitle !== "function") return;
				const item = history.find(function (entry) { return entry.sessionId === current; });
				if (!item || !isPlayMode(item.mode || "story") || !item.cardName || currentHostTitle === item.cardName) return;
				const key = current + "\n" + currentHostTitle;
				if (hostTitleSynced.current.has(key)) return;
				hostTitleSynced.current.add(key);
				props.syncHostTitle(current, item.cardName).catch(function (error) { console.warn("dsh-tavern: 同步会话标题失败", error); });
			}, [current, currentHostTitle, history]);
			const h = React.createElement;
			const collapsedSidebar = collapsed ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-sidebar collapsed" },
					h("button", { className: "dsh-tavern-side-icon", title: "新建对话（跟随当前模式）", onClick: function () { props.toggleSidebar(); window.setTimeout(function () { openPicker("cards"); }, 180); } }, "＋")
				)
			) : null;
			const activeHistory = React.useMemo(function () {
				return unarchivedHistory.filter(function (item) { return groupOfMode(item.mode) === uiMode && (uiMode !== "play" || item.requestMode !== "sillytavern"); });
			}, [unarchivedHistory, uiMode]);
			const archivedHistory = React.useMemo(function () {
				return listedHistory.filter(function (item) { return archivedSessions.has(item.sessionId) && groupOfMode(item.mode) === uiMode && (uiMode !== "play" || item.requestMode !== "sillytavern"); });
			}, [listedHistory, archivedSessions, uiMode]);
			// 最新回复序下整张列表按活动重排；创建序保持注册表的固定位置。
			const orderedActiveHistory = React.useMemo(function () {
				return orderTavernHistory(activeHistory, summaries, historyOrder);
			}, [activeHistory, summaries, historyOrder]);
			const orderedArchivedHistory = React.useMemo(function () {
				return orderTavernHistory(archivedHistory, summaries, historyOrder);
			}, [archivedHistory, summaries, historyOrder]);
			const groupedActiveHistory = React.useMemo(function () {
				return uiMode === "play" ? groupTavernHistory(orderedActiveHistory, summaries, historyOrder) : [];
			}, [uiMode, orderedActiveHistory, summaries, historyOrder]);
			async function leaveUnavailableConversation(sessionIds, showPicker) {
				// A deletion can take long enough for the host to switch views on its own.
				const openSession = tavernMainSessionId(props.sessions);
				if (!sessionIds.includes(openSession || current)) return;
				if (openSession) props.sessions.clear();
				const removing = tavernChatRemovals.getSnapshot();
				const next = activeHistory.find(item => !sessionIds.includes(item.sessionId) && !removing.has(item.chatId));
				if (next) await openSessionWhenReady(next.sessionId);
				else {
					await openBlankConversation();
					if (showPicker) openPicker("cards");
				}
			}
			unavailableSessionsHandler.current = function (sessionIds) {
				void leaveUnavailableConversation(sessionIds, true).catch(err => setError(String(err && err.message || err)));
			};
			// The host writes a reply (or a workbench task) through the native chat, so `sessionStatus` knows a
			// conversation is generating. The Tavern sidebar replaced the host's session tree, so this row is the
			// only place that can carry the 「生成中」 mark the host's StateDot used to show.
			function sessionGenerating(sessionId) {
				const live = liveStatus && typeof liveStatus.get === "function" ? liveStatus.get(sessionId) : null;
				return !!(live && live.running);
			}
			// 先展示索引里已有的预览，旧数据在后台补齐后就地替换。
			function historyPreview(item, summary) {
				return formatTavernHistoryPreview(item && item.preview !== undefined ? item.preview : (summary && summary.preview));
			}
			function togglePreview(item) {
				setMenuSession(null);
				setExpandedPreviews(function (previous) {
					const next = Object.assign({}, previous);
					if (previous[item.sessionId] === true) delete next[item.sessionId];
					else next[item.sessionId] = true;
					return next;
				});
			}
			function renderHistoryRow(item, groupName) {
				const archived = archivedSessions.has(item.sessionId);
				const summary = summaries[item.sessionId];
				// 分组标题已经是角色名，行内再重复一遍只会挤掉真正有区分度的尾部。
				const title = groupName ? compactTavernHistoryTitle(historyTitle(item, summary), groupName) : historyTitle(item, summary);
				const generating = sessionGenerating(item.sessionId);
				const preview = historyPreview(item, summary);
				const expanded = preview.hasPreview && expandedPreviews[item.sessionId] === true;
				const stamp = tavernHistoryStamp(item, summary, summaries, historyOrder);
				const stampIsInTitle = !item.title && isPlayMode(item.mode || "story") && Boolean(formatTime(stamp)) && title.indexOf(formatTime(stamp)) >= 0;
				const menuOpen = menuSession === item.sessionId;
				return h("div", { key: item.sessionId, ref: menuOpen ? historyMenu.root : undefined, onKeyDown: menuOpen ? historyMenu.keys : undefined,
					className: "dsh-tavern-side-row" + (current === item.sessionId ? " active" : "") + (generating ? " is-generating" : "") + (preview.hasPreview ? " has-preview" : "") },
					h("button", { className: "dsh-tavern-side-row-main", disabled: busy, title: preview.hasPreview && !expanded ? preview.detailText : undefined, onClick: async function () {
						if (archived) { setMenuSession(menuOpen ? null : item.sessionId); return; }
						setMenuSession(null);
						try {
							if (summary && summary.blank) await call("ensureOpening", { sessionId: item.sessionId });
							await openSessionWhenReady(item.sessionId);
							if (narrowLayout() && typeof props.closeNarrowSidebar === "function") props.closeNarrowSidebar();
						} catch (err) { setError(String(err && err.message || err)); }
					} },
						h("div", { className: "dsh-tavern-side-row-name" },
							generating ? h("span", { className: "dsh-tavern-side-row-spinner", role: "status", "aria-label": "正在生成" }, h(Spinner, {})) : null,
							h("span", { className: "dsh-tavern-side-row-title" }, title)),
						preview.hasPreview ? h("div", { className: "dsh-tavern-side-row-preview" + (expanded ? " expanded" : ""), "aria-hidden": "true" }, expanded ? preview.detailText : preview.compactText) : null,
						h("div", { className: "dsh-tavern-side-row-meta" },
							h("span", null, item.mode === "card" ? (item.cardPath ? ("已创建：" + item.cardName) : "尚未创建正式人物卡") : modeLabel(item.mode || "story")),
							preview.hasPreview || preview.messageCount ? h("span", { className: "dsh-tavern-side-row-turns" }, preview.floorBadge) : null,
							// 自动标题本身就是「11/7 20:25 开局」，再重复一次时间只是占宽度。
							generating || !stampIsInTitle ? h("span", null, generating ? "生成中" : formatTime(stamp)) : null)),
					preview.hasPreview ? h("button", { className: "dsh-tavern-side-row-expand", title: expanded ? "收起预览" : "展开预览", "aria-label": (expanded ? "收起预览：" : "展开预览：") + title, "aria-expanded": expanded ? "true" : "false", onClick: function (event) { event.stopPropagation(); togglePreview(item); } }, expanded ? "▴" : "▾") : null,
					h("button", { type: "button", ref: menuOpen ? historyMenu.trigger : undefined, className: "dsh-tavern-side-row-more", title: "对话操作", "aria-label": "对话操作", "aria-haspopup": "menu", "aria-expanded": menuOpen,
						onClick: () => setMenuSession(menuOpen ? null : item.sessionId) }, "⋯"),
					menuOpen ? historyMenu.layer({ className: "fork-inline-pop dsh-tavern-side-row-menu", role: "menu", "aria-label": "对话操作", onKeyDown: inlineMenuKeys },
						!archived ? h("button", { type: "button", role: "menuitem", disabled: busy, onClick: () => renameConversation(item, title) }, "重命名") : null,
						!archived && isPlayMode(item.mode || "story") ? h("button", { type: "button", role: "menuitem", disabled: busy, onClick: () => { setMenuSession(null); void rescueConversation(item); } }, "存档救援") : null,
						h("button", { type: "button", role: "menuitem", className: "danger", disabled: busy, onClick: () => deleteConversation(item, title) }, "彻底删除")
					) : null
				);
			}
			// 游玩历史里卡名菜单的「新建游戏」：和人物卡列表里点这张卡是同一个入口（openPlayCard）。
			function newPlayFromGroup(group) {
				if (busy || !group.path) return;
				openPicker();
				void call("listCards").then(function (result) {
					const card = (result.cards || []).find(function (row) { return row.path === group.path && !row.readError; });
					if (!card) { setError("找不到这张人物卡，可能已被删除或移动"); return; }
					return openPlayCard(card);
				}).catch(function (err) { setError(String(err && err.message || err)); });
			}
			// 人物卡库's card page reaches two entries of this list by window events (detail.path): its cover ▶ is 新建游戏
			// (dsh-tavern-play-card) and its ⋯ › 管理存档… is the 存档管理 filtered to the card (dsh-tavern-manage-saves).
			const cardEntryRef = React.useRef(null);
			cardEntryRef.current = { play: newPlayFromGroup, manage: function (path) { openHistoryManager(); setManagerCardFilter(tavernHistoryCardKey({ cardPath: path })); } };
			React.useEffect(function () {
				function onPlayCard(event) { const path = event.detail && event.detail.path; if (path) cardEntryRef.current.play({ path: path }); }
				function onManageSaves(event) { const path = event.detail && event.detail.path; if (path) cardEntryRef.current.manage(path); }
				window.addEventListener("dsh-tavern-play-card", onPlayCard);
				window.addEventListener("dsh-tavern-manage-saves", onManageSaves);
				return function () { window.removeEventListener("dsh-tavern-play-card", onPlayCard); window.removeEventListener("dsh-tavern-manage-saves", onManageSaves); };
			}, []);
			function renderHistoryGroup(group, expanded, toggle) {
				return h("section", { key: group.key, className: "dsh-tavern-history-group" },
					h(HistoryGroupHead, { group: group, expanded: expanded, busy: busy,
						onToggle: function () { toggle(); setMenuSession(null); },
						onNewPlay: function () { newPlayFromGroup(group); },
						onManage: function () { openHistoryManager(); setManagerCardFilter(group.key); }
					}, h("span", { "aria-hidden": true }, expanded ? "▾" : "▸"),
						// A collapsed group hides its rows, so its head carries the same mark when one of them generates.
						group.items.some(function (item) { return sessionGenerating(item.sessionId); }) ? h("span", { className: "dsh-tavern-history-group-spinner", role: "status", "aria-label": "有对话正在生成" }, h(Spinner, {})) : null,
						h("span", { className: "dsh-tavern-history-group-name" }, group.name), h("span", { className: "dsh-tavern-history-group-count" }, group.items.length)),
					
					expanded ? h("div", { className: "dsh-tavern-history-group-items" }, group.items.slice(0, historyWindow).map(function (item) { return renderHistoryRow(item, group.name); })) : null);
			}
			// 窗口上限：当前模式下最多要渲染多少行，决定还要不要继续追加。
			// 分组模式按「最大一组」算，因为每组共用同一个窗口。
			const historyCeiling = collapsed ? 0 : Math.max(
				uiMode !== "play" ? orderedActiveHistory.length : groupedActiveHistory.reduce(function (max, group) { return Math.max(max, group.items.length); }, 0),
				archiveExpanded ? orderedArchivedHistory.length : 0);
			// 滚到窗口底部就把窗口拉大一屏；行按屏追加，不会再有整表排版压在展开动画上。
			function growHistoryWindow() {
				if (historyWindow >= historyCeiling) return;
				setHistoryWindow(function (previous) { return Math.min(historyCeiling, previous + SIDE_HISTORY_WINDOW_STEP); });
			}
			function onSideListScroll(event) {
				const el = event && event.currentTarget;
				if (!el) return;
				if (menuSession) setMenuSession(null);
				if (el.scrollHeight - el.scrollTop - el.clientHeight > 240) return;
				growHistoryWindow();
			}
			// 窗口还没填满容器时列表不滚动，滚动事件永远不来：补一次成屏。
			// 抽屉在屏外挂载帧（content-visibility: hidden）里 clientHeight 为 0，不能误判为未填满而把全部历史一次性灌进 DOM。
			React.useEffect(function () {
				if (collapsed) return;
				const el = sideListRef.current;
				if (!el || historyWindow >= historyCeiling) return;
				if (el.clientHeight <= 0 || el.scrollHeight > el.clientHeight + 4) return;
				growHistoryWindow();
			}, [collapsed, historyWindow, historyCeiling, uiMode, archiveExpanded, historyGroupState, history.length]);
			// 侧栏收起时不构建整张历史 VDOM 树，避免流式输出期间每次状态变化都白算全部会话行。
			const rows = collapsed ? [] : (uiMode !== "play" ? orderedActiveHistory.slice(0, historyWindow).map(function (item) { return renderHistoryRow(item, ""); }) : groupedActiveHistory.map(function (group) {
				const expanded = historyGroupState[group.key] === true;
				return renderHistoryGroup(group, expanded, () => setHistoryGroupState(previous => ({ ...previous, [group.key]: !expanded })));
			}));
			const archiveHistoryGroup = { key: "archived", name: "已归档", items: orderedArchivedHistory };
			const archiveGroup = collapsed || !orderedArchivedHistory.length ? null : renderHistoryGroup(archiveHistoryGroup, archiveExpanded, () => setArchiveExpanded(!archiveExpanded));
			// ---------- 宽屏会话管理器 ----------
			// 侧边栏一行放不下最近一轮的输入、回复和轮数，批量整理 200+ 个
			// 同前缀的导入存档要靠这一层：宽列表、搜标题和正文、按卡/轮数筛选、批量归档。
			const hasHistoryInMode = activeHistory.length + archivedHistory.length > 0;
			const managerPool = React.useMemo(function () {
				if (!historyManagerOpen) return [];
				const active = uiMode === "play" ? groupedActiveHistory.flatMap(group => group.items) : orderedActiveHistory;
				return active.concat(orderedArchivedHistory);
			}, [historyManagerOpen, uiMode, groupedActiveHistory, orderedActiveHistory, orderedArchivedHistory]);
			const managerCardOptions = React.useMemo(function () {
				const cards = new Map();
				for (const item of managerPool) {
					if (!item.cardPath) continue;
					const value = tavernHistoryCardKey(item);
					cards.set(value, { value, label: item.cardName || item.cardPath, path: item.cardPath });
				}
				const labelCounts = new Map();
				for (const card of cards.values()) labelCounts.set(card.label, (labelCounts.get(card.label) || 0) + 1);
				return Array.from(cards.values(), card => ({ ...card, duplicate: labelCounts.get(card.label) > 1 }));
			}, [managerPool]);
			const managerQueryText = managerQuery.trim().toLowerCase();
			function matchesManagerFilters(item) {
				if (managerCardFilter !== "all" && tavernHistoryCardKey(item) !== managerCardFilter) return false;
				if (managerStatusFilter === "opening" || managerStatusFilter === "dialogue" || managerQueryText) {
					const preview = historyPreview(item, summaries[item.sessionId]);
					if (managerStatusFilter === "opening" && !preview.isOpeningOnly) return false;
					if (managerStatusFilter === "dialogue" && !(preview.turnCount > 0)) return false;
					if (managerQueryText) return [historyTitle(item, summaries[item.sessionId]), item.cardName, preview.searchText].filter(Boolean).join("\n").toLowerCase().includes(managerQueryText);
				}
				return true;
			}
			// Filter the sidebar's groups in place so hiding a recent reply never moves its card.
			const managerGroups = [];
			if (historyManagerOpen) {
				if (managerStatusFilter !== "archived") {
					const groups = uiMode === "play" ? groupedActiveHistory : [{ key: "workbench", items: orderedActiveHistory }];
					managerGroups.push(...groups.map(group => ({ ...group, items: group.items.filter(matchesManagerFilters) })));
				}
				if (managerStatusFilter === "all" || managerStatusFilter === "archived") {
					managerGroups.push({ ...archiveHistoryGroup, items: archiveHistoryGroup.items.filter(matchesManagerFilters) });
				}
			}
			function isManagerGroupFolded(group) {
				if (group.key === archiveHistoryGroup.key) return managerStatusFilter === "all" && !managerArchiveExpanded;
				return managerFoldedGroups.has(group.key);
			}
			const managerVisible = managerGroups.flatMap(group => isManagerGroupFolded(group) ? [] : group.items);
			const managerSelectedItems = managerPool.filter(function (item) { return selectedChats.includes(item.chatId); });
			const managerSelectedActive = managerSelectedItems.filter(function (item) { return !archivedSessions.has(item.sessionId); }).length;
			const managerSelectedArchived = managerSelectedItems.length - managerSelectedActive;
			const allVisibleSelected = managerVisible.length > 0 && managerVisible.every(item => selectedChats.includes(item.chatId));
			const someVisibleSelected = !allVisibleSelected && managerVisible.some(item => selectedChats.includes(item.chatId));
			function renderManagerRow(item, groupName) {
				const archived = archivedSessions.has(item.sessionId);
				const summary = summaries[item.sessionId];
				const fullTitle = historyTitle(item, summary);
				const title = groupName ? compactTavernHistoryTitle(fullTitle, groupName) : fullTitle;
				const preview = historyPreview(item, summary);
				const selected = selectedChats.includes(item.chatId);
				const renaming = Boolean(managerRenaming) && managerRenaming.chatId === item.chatId;
				const play = isPlayMode(item.mode || "story");
				const time = formatTime(tavernHistoryStamp(item, summary, summaries, historyOrder));
				const menuOpen = managerMenu.open && managerMenuSession === item.sessionId;
				return h("div", {
					key: item.sessionId,
					onKeyDown: menuOpen ? managerMenu.keys : undefined,
					className: "dsh-tavern-history-manager-row" + (selected ? " selected" : "") + (current === item.sessionId ? " current" : ""),
					onClick: function (event) {
						if (!event.currentTarget.contains(event.target) || event.target.closest("input, button")) return;
						const selection = window.getSelection();
						if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
						toggleChatSelection(item.chatId);
					}
				},
					h(HistoryManagerCheck, { checked: selected, disabled: busy, label: "选择对话：" + title, onToggle: function () { toggleChatSelection(item.chatId); } }),
					h("div", { className: "dsh-tavern-history-manager-body" },
						h("div", { className: "dsh-tavern-history-manager-headline" },
							renaming ? h("input", {
								className: "dsh-tavern-history-manager-rename", value: managerRenaming.value, maxLength: 80, disabled: busy, autoFocus: true, "aria-label": "对话标题",
								onChange: function (event) { setManagerRenaming({ chatId: item.chatId, value: event.target.value }); },
								onBlur: function () { void commitManagerRename(item); },
								onKeyDown: function (event) {
									if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
									else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setManagerRenaming(null); }
								}
							}) : h("span", { className: "dsh-tavern-history-manager-title", "aria-current": current === item.sessionId ? "true" : undefined }, title),
							preview.floorBadge ? h("span", { className: "dsh-tavern-history-manager-turn" }, preview.floorBadge) : null,
							time && !title.includes(time) ? h("span", { className: "dsh-tavern-history-manager-time" }, time) : null),
						groupName ? null : h("div", { className: "dsh-tavern-history-manager-card" }, (item.cardName || "未绑定人物卡") + (play ? "" : " · 卡片工作台")),
						preview.hasPreview ? h("div", { className: "dsh-tavern-history-manager-preview", title: preview.detailText }, preview.detailText) : null),
					h("button", { type: "button", className: "dsh-tavern-history-manager-icon dsh-tavern-history-manager-more", disabled: busy,
						ref: menuOpen ? node => { managerMenu.root.current = node; managerMenu.trigger.current = node; } : undefined,
						"aria-label": "对话操作：" + title, title: "对话操作", "aria-haspopup": "menu", "aria-expanded": menuOpen,
						onClick: () => { setManagerMenuSession(item.sessionId); managerMenu.setOpen(!menuOpen); } },
						h("span", { "aria-hidden": "true" }, "⋯")),
					menuOpen ? managerMenu.layer({ className: "fork-inline-pop dsh-tavern-side-row-menu", role: "menu", "aria-label": "对话操作：" + title, onKeyDown: inlineMenuKeys },
						h("button", { type: "button", role: "menuitem", disabled: busy, onClick: () => { managerMenu.close(false); void openManagerSession(item); } }, "打开"),
						h("button", { type: "button", role: "menuitem", disabled: busy, onClick: () => { managerMenu.close(false); setManagerRenaming({ chatId: item.chatId, value: play ? (item.title || "") : title }); } }, "重命名"),
						h("button", { type: "button", role: "menuitem", disabled: busy, onClick: () => { managerMenu.close(true); void changeConversationArchive(item, !archived); } }, archived ? "恢复" : "归档"),
						h("button", { type: "button", role: "menuitem", className: "danger", disabled: busy, onClick: () => { managerMenu.close(false); void deleteConversation(item, fullTitle); } }, "彻底删除")
					) : null);
			}
			function renderManagerGroup(group) {
				if (!group.items.length) return null;
				if (!group.name) return group.items.map(item => renderManagerRow(item));
				const archived = group.key === archiveHistoryGroup.key;
				const folded = isManagerGroupFolded(group);
				const label = h(React.Fragment, null, h("span", { className: "dsh-tavern-history-manager-group-name" }, group.name),
					h("span", { className: "dsh-tavern-history-group-count" }, group.items.length));
				const header = archived && managerStatusFilter === "archived"
					? h("h3", { className: "dsh-tavern-history-manager-group-head" }, label)
					: h("h3", { className: "dsh-tavern-history-manager-group-heading" },
						h("button", { type: "button", className: "dsh-tavern-history-manager-group-head", "aria-expanded": !folded, title: group.path || group.name, onClick: function () {
							managerMenu.setOpen(false);
							if (archived) setManagerArchiveExpanded(value => !value);
							else setManagerFoldedGroups(function (previous) {
								const next = new Set(previous);
								if (previous.has(group.key)) next.delete(group.key);
								else next.add(group.key);
								return next;
							});
						} }, h(Icon, { name: "chevron", size: 14 }), label));
				return h("section", { key: group.key, className: "dsh-tavern-history-manager-group", "aria-label": group.name }, header,
					folded ? null : group.items.map(item => renderManagerRow(item, archived ? "" : group.name)));
			}
			const historyManagerPanel = historyManagerOpen ? h("div", { key: "history-manager", className: "dsh-tavern-picker-overlay dsh-tavern-history-manager-overlay", onMouseDown: function (event) { if (event.target === event.currentTarget) closeHistoryManager(); } },
				h("div", { className: "dsh-tavern-history-manager", role: "dialog", "aria-modal": "true", "aria-label": "会话管理" },
					h("div", { className: "dsh-tavern-history-manager-head" },
						h("h2", null, uiMode === "play" ? "游玩历史" : "卡片历史"),
						h("button", { type: "button", className: "dsh-tavern-history-manager-icon", title: "关闭", "aria-label": "关闭", onClick: closeHistoryManager }, h(Icon, { name: "close", size: 20 }))),
					h("div", { className: "dsh-tavern-history-manager-toolbar" },
						h(HistoryManagerCheck, { className: "dsh-tavern-history-manager-select-all", label: "全选筛选结果", disabled: busy || !managerVisible.length, checked: allVisibleSelected ? true : someVisibleSelected ? "mixed" : false,
							onToggle: () => setSelectedChats(allVisibleSelected ? [] : managerVisible.map(item => item.chatId)) },
							"全选"),
						h(SearchBox, { bare: true, inputClassName: "dsh-tavern-library-search dsh-tavern-history-manager-search", value: managerQuery, placeholder: "搜索对话", label: "搜索会话", onChange: setManagerQuery }),
						h("div", { className: "dsh-tavern-history-manager-filters" },
							managerCardOptions.length ? h(HistoryCardFilter, { options: managerCardOptions, value: managerCardFilter, onChange: setManagerCardFilter }) : null,
							h(InlineMenu, { name: "按状态筛选", controlClassName: "dsh-tavern-history-card-trigger", options: historyStatusOptions, value: managerStatusFilter, onCommit: setManagerStatusFilter }))),
					h("div", { className: "dsh-tavern-history-manager-list", onScroll: () => { if (managerMenu.open) managerMenu.setOpen(false); } },
						managerGroups.some(group => group.items.length) ? managerGroups.map(renderManagerGroup) : h("div", { className: "dsh-tavern-history-manager-empty" }, managerQueryText ? "没有匹配的会话" : "没有会话")),
					managerSelectedItems.length ? h("div", { className: "dsh-tavern-history-manager-foot" },
						h("span", { className: "dsh-tavern-history-manager-selected", role: "status" }, "已选 " + managerSelectedItems.length + " 个"),
						h("button", { type: "button", className: "dsh-tavern-history-manager-bulk", disabled: busy, onClick: () => setSelectedChats([]) }, "取消选择"),
						h("span", { className: "dsh-tavern-spacer" }),
						managerSelectedActive ? h("button", { type: "button", className: "dsh-tavern-history-manager-bulk", disabled: busy, onClick: () => void archiveSelectedConversations(true, managerPool) }, "归档所选（" + managerSelectedActive + "）") : null,
						managerSelectedArchived ? h("button", { type: "button", className: "dsh-tavern-history-manager-bulk", disabled: busy, onClick: () => void archiveSelectedConversations(false, managerPool) }, "恢复所选（" + managerSelectedArchived + "）") : null,
						h("button", { type: "button", className: "dsh-tavern-history-manager-bulk danger", disabled: busy, onClick: () => void deleteSelectedConversations(managerPool) }, busy ? "处理中…" : "彻底删除（" + managerSelectedItems.length + "）")) : null,
					deleteNotice ? h("div", { className: "dsh-tavern-history-manager-notice", role: "status" }, deleteNotice) : null)) : null;
			const selectedOpening = openingPicker && openingPicker.openings[openingPicker.index];
			const pickerError = error ? h("div", { className: "dsh-tavern-picker-error", role: "alert" },
				h("div", null, error),
				pendingOpen ? h("button", { className: "dsh-tavern-btn", disabled: busy, style: { marginTop: "8px" }, onClick: retryPendingOpen }, "重新连接已创建的 Session") : null
			) : null;
			const cardImportNotice = cardImportStatus ? h("div", { className: "dsh-tavern-question-sub dsh-tavern-card-import-hint",
				role: "status", style: { whiteSpace: "pre-line", overflowWrap: "anywhere" } }, cardImportStatus) : null;
			const importChoice = chatImport && openingPicker && chatImport.cardPath === openingPicker.card.path ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "导入到：" + openingPicker.card.name)),
				h("div", { className: "dsh-tavern-greeting-preview" },
					chatImport.entries.length === 1
						? h("p", null, "文件：" + chatImport.entries[0].fileName)
						: h("p", null, "共 " + chatImport.entries.length + " 份记录，各自成为独立对话：" + chatImport.entries.map(function (entry) { return entry.fileName + "（" + entry.preview.count + " 条）"; }).join("、")),
					h("p", null, "共 " + chatImport.preview.count + " 条消息"),
					h("label", null, "玩家称呼", h("input", { value: chatImport.userName, maxLength: 80, disabled: busy, placeholder: chatImport.entries.length > 1 ? "沿用各份记录里的称呼" : undefined, onChange: function (event) { setChatImport(Object.assign({}, chatImport, { userName: event.target.value })); } })),
					chatImport.preview.lastMessage ? h(React.Fragment, null, h("p", null, "最后一条消息："), h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, chatImport.preview.lastMessage)) : null,
					h("p", null, chatImport.entries.length === 1 ? "将创建独立对话，使用这张人物卡及其关联世界书。" : "每份记录各创建一个独立对话，都使用这张人物卡及其关联世界书；导入后不会自动打开，请在左侧列表中选择。"),
					chatImport.preview.warnings.map(function (warning, index) { return h("p", { key: index }, warning); }),
					chatImport.preview.incompatible ? h("label", null, h("input", { type: "checkbox", checked: chatImport.textOnly, disabled: busy, onChange: function (event) { setChatImport(Object.assign({}, chatImport, { textOnly: event.target.checked })); } }), chatImport.entries.length === 1 ? "变量结构不兼容：仅导入正文，使用人物卡初值（也可返回换卡）" : "变量结构不兼容（" + chatImport.entries.filter(function (entry) { return entry.preview.incompatible; }).map(function (entry) { return entry.fileName; }).join("、") + "）：这几份仅导入正文，使用人物卡初值；其余照常导入") : h("p", null, chatImport.preview.hasMvu ? "将恢复 MVU 状态" : "将导入聊天正文")),
				h("div", { className: "dsh-tavern-picker-foot" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setChatImport(null); if (openingPicker.importOnly) setOpeningPicker(null); setError(""); } }, "返回"),
					h("button", { className: "dsh-tavern-question-primary", disabled: busy || Boolean(pendingOpen) || (chatImport.preview.incompatible && !chatImport.textOnly), onClick: importConversation },
						busy ? (importProgress || "正在导入…") : (chatImport.entries.length === 1 ? "导入并打开" : "导入这 " + chatImport.entries.length + " 份")))) : null;
			const openingChoice = openingPicker && !openingPicker.importOnly ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: discardOpening }, "放弃开局"), h("span", null, openingPicker.card.name + " · 游戏准备"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: closePicker }, "暂时收起")),
				busy ? h("div", { className: "dsh-tavern-session-switching", role: "status", "aria-live": "polite" },
					h("span", { className: "dsh-tavern-loading-line" }, h(Spinner, {}), h("span", null, openingPicker.preparing ? "正在准备开场与脚本资源…" : "正在完成游戏初始化…")),
					openingPicker.preparing ? h("div", { style: { marginTop: "8px", fontSize: "13px" } }, "首次打开可能需要下载资源，请稍候；后续打开通常更快。") : null) : null,
				openingPicker.openings.length > 1 ? h("div", { className: "dsh-tavern-greeting-nav" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "上一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index - 1 + openingPicker.openings.length) % openingPicker.openings.length })); } }, "←"),
					h("div", { className: "dsh-tavern-greeting-count" }, (openingPicker.index + 1) + " / " + openingPicker.openings.length),
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "下一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index + 1) % openingPicker.openings.length })); } }, "→")
				) : (!openingPicker.preparing && openingPicker.openings.length === 0 ? h("div", { className: "dsh-tavern-side-empty" }, "这张人物卡没有开场白，将从空白场景开始。") : null),
				selectedOpening ? h("div", {
					key: selectedOpening.id,
					className: "dsh-tavern-greeting-preview",
                    "data-dsh-tavern-preview-busy": busy ? "true" : undefined,
                    style: { pointerEvents: busy ? "none" : undefined },
					role: "region",
					"aria-label": openingPicker.card.name + "开场白预览"
				}, selectedOpening.text === '' && !selectedOpening.openingSetup ? h("p", null, "空白开场") : (function (frame) {
					// v2 opening setup: the card's form in front, the greeting frame mounted behind it (docs/specs/opening-setup-v2.md §6).
					return selectedOpening.setup ? h(OpeningSetupForm, { key: selectedOpening.id, setup: selectedOpening.setup, card: openingPicker.card, disabled: busy || openingPicker.preparing }, frame) : frame;
				})(renderTavernProjection(selectedOpening.projection, {
					eagerFrame: Boolean(selectedOpening.setup),
					streaming: false,
					codeLabels: { copyLabel: "复制", copiedLabel: "已复制" },
					mentions: undefined,
					sessionId: "",
					turn: 1,
					helperContext: selectedOpening.helperContext,
                    frameSizing: selectedOpening.frameSizing,
					openingPreview: selectedOpening.openingPreview,
                    onSubmitOpening: function (text, options) { if (busy || !picking || uiMode !== "play" || collapsed) throw new Error("请返回开局准备页后继续"); return newConversation(openingPicker.card, null, selectedOpening.id, options?.playerName, text); },
					onSelectOpening: function (id) {
						if (busy || !picking || uiMode !== "play" || collapsed) throw new Error("请返回开局准备页后继续");
						const index = openingPicker.openings.findIndex(function (opening) { return opening.id === id; });
						if (index < 0) throw new Error("人物卡开场白不存在");
						setOpeningPicker(Object.assign({}, openingPicker, { index: index }));
					},
					trustedCardMode: openingPicker.trustedCardMode
				}))) : null,
				h("div", { className: "dsh-tavern-picker-foot", style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px", flexWrap: "wrap" } }, h("input", { ref: chatImportFile, type: "file", accept: TAVERN_CARD_FILE_ACCEPT, multiple: true, style: { display: "none" }, onChange: function (event) { const files = Array.prototype.slice.call(event.target.files || []); event.target.value = ""; void previewChatImport(files); } }), h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" } }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { chatImportFile.current.click(); } }, busy && importProgress ? importProgress : "导入 SillyTavern 聊天记录"), h("small", null, "（可多选，必须都和这张人物卡匹配）")), h("button", { className: selectedOpening && selectedOpening.openingSetup ? "dsh-tavern-btn" : "dsh-tavern-question-primary", disabled: busy || openingPicker.preparing || (openingPicker.openings.length > 0 && !selectedOpening), onClick: function () { newConversation(openingPicker.card, null, selectedOpening ? selectedOpening.id : ""); } }, selectedOpening && selectedOpening.openingSetup ? "跳过设定，直接开始" : "开始新游戏"))
			) : null;
			const playPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": openingPicker && !openingPicker.importOnly ? "游戏准备" : "选择人物卡开始游玩", ...(!openingChoice && !importChoice ? tavernCardDropHandlers(importPickedCards) : {}) }, pickerError, (openingChoice || importChoice) ? h(React.Fragment, null, importChoice, h("div", { style: { display: importChoice ? "none" : "contents" } }, openingChoice)) : h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "选择人物卡 · 开始游玩"), h("span", { className: "dsh-tavern-spacer" }), h(MobileCardImportButton, { inputRef: fileRef, batch: cardBatch.managing, disabled: busy, onImported: refreshImportedCards }),
					// No accept list: Android's storage framework filters by MIME type, and
					// `.dshsave`/`.jsonl` have no registered type, so a list would hide the very
					// file being imported. The import validates the extension instead.
					h("input", { ref: saveImportFile, type: "file", accept: TAVERN_CARD_FILE_ACCEPT, style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; event.target.value = ""; if (file) importGameSave(file); } }),
					h("input", { ref: sillyTavernChatFile, type: "file", accept: TAVERN_CARD_FILE_ACCEPT, style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; event.target.value = ""; void chooseSillyTavernChat(file); } }),
					h("div", { className: "dsh-tavern-more-actions dsh-tavern-save-import-menu", ref: saveImportMenu },
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, "aria-haspopup": "menu", "aria-expanded": saveImportMenuOpen, onClick: function () { setSaveImportMenuOpen(function (value) { return !value; }); } }, "导入存档"),
						h("div", { className: "dsh-tavern-more-menu", role: "menu", "aria-label": "导入存档", hidden: !saveImportMenuOpen, onClick: function (event) { if (event.target.closest("button:not(:disabled)")) setSaveImportMenuOpen(false); } },
							h("button", { type: "button", role: "menuitem", disabled: busy, title: "在其他电脑的 DSH Tavern 导出的存档，作为一局新游戏继续玩", onClick: function () { if (saveImportFile.current) saveImportFile.current.click(); } }, "DSH Tavern 存档（.dshsave）"),
							h("button", { type: "button", role: "menuitem", disabled: busy, title: "SillyTavern 导出的聊天记录，需要对应的人物卡", onClick: function () { if (sillyTavernChatFile.current) sillyTavernChatFile.current.click(); } }, "SillyTavern 聊天记录（.jsonl）"))),
					h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				cardImportNotice,
				pendingChatImport ? h("div", { className: "dsh-tavern-side-empty", role: "status", style: { padding: "4px 6px", display: "flex", alignItems: "center", gap: "8px" } }, h("span", null, "选择这份 SillyTavern 聊天记录对应的人物卡" + (pendingChatImport.characterName ? "（记录里的角色：" + pendingChatImport.characterName + "）" : "")), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setPendingChatImport(null); } }, "取消")) : null,
				organization.toolbar(),
				(openingCardName || cardsLoading) ? h("div", { className: "dsh-tavern-picker-loading", role: "status", "aria-live": "polite" },
					h(Spinner, {}),
					h("div", null,
						h("div", null, openingCardName ? "正在打开「" + openingCardName + "」…" : "正在读取人物卡…"),
						h("small", null, openingCardName ? "正在准备开场白、脚本与世界书；首次打开可能还需要下载资源，后续通常会快很多。" : "人物卡较多时首次载入需要几秒，请稍候。"))) : organization.visible.length ? h(React.Fragment, null, h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。"), h(TavernCardList, { place: "play", cards: organization.visible, columns: organization.columns, batch: cardBatch, busy: busy, menu: playCardMenu, open: function (card) { if (!card.readError) openPlayCard(card); } }), organization.batchBar()) : h(EmptyState, cards.length ? { text: "没有匹配的人物卡", icon: "search" } : { noun: "人物卡",
					action: cardZip ? h("div", { className: "dsh-tavern-empty-actions" }, h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || cardZip.busy, onClick: cardZip.openUrl }, "从网址导入卡")) : null })
			));

			const workbenchCards = h(React.Fragment, null, workbenchOrganization.toolbar(),
				cards.length ? h(TavernCardList, { place: "workbench", cards: workbenchOrganization.visible, columns: workbenchOrganization.columns, busy: busy,
					open: function (card) {
						newCardConversation(card, cardEntry, cardEntry === "mvu" ? "把人物卡转成 MVU 版" : cardEntry === "gentle" ? "人物卡温和改写" : "修改人物卡");
					} }) : h(EmptyState, { noun: "人物卡" }));
			const chosenInitialResources = Object.keys(selectedInitialResources).map(function (key) { return selectedInitialResources[key]; });
			function initialResourceGroup(title, items) {
				return h(React.Fragment, null,
					h("div", { className: "dsh-tavern-picker-group" }, title + " · " + items.length),
					items.length ? items.map(function (item) {
						const key = item.kind + ":" + item.path;
						const selected = !!selectedInitialResources[key];
						return h("button", { key: item.kind + ":" + item.path, className: "dsh-tavern-card-pick" + (selected ? " selected" : ""), "aria-pressed": selected ? "true" : "false", disabled: busy, onClick: function () { toggleInitialResource(item); } }, h("b", null, (selected ? "✓ " : "") + item.title), h("span", null, item.detail || (item.chunkCount ? item.chunkCount + " 块" : "可作为人物卡参考资料")));
					}) : h(EmptyState, { compact: true, text: "暂无" })
				);
			}
			function startResourceEditConversation() {
				const chosen = chosenInitialResources[0];
				if (!chosen) return;
				if (chosen.kind === "worldbook") newCardConversation(null, "worldbook", "修改世界书", chosenInitialResources);
				else if (chosen.kind === "preset") newCardConversation(null, "preset", "修改预设", chosenInitialResources);
				else newCardConversation(null, "script", "修改剧本", chosenInitialResources);
			}
			function startInitialImport(kind) {
				initialImportKindRef.current = kind;
				const input = initialImportRef.current;
				if (!input) return;
				input.accept = kind === "worldbook" || kind === "preset" ? ".json,application/json" : "";
				input.click();
			}
			const initialResourceTitle = "剧本";
			const resourceEditPicker = h(React.Fragment, null,
				initialResourceGroup("剧本", initialResources.filter(function (item) { return item.kind === "source"; })),
				initialResourceGroup("世界书", initialResources.filter(function (item) { return item.kind === "worldbook"; })),
				initialResourceGroup("预设", initialResources.filter(function (item) { return item.kind === "preset"; })),
				h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || chosenInitialResources.length !== 1, onClick: startResourceEditConversation }, "用已选目标开始"))
			);
			const initialResourcePicker = cardEntry === "resource-edit"
				? resourceEditPicker
				: (initialResources.length ? h(React.Fragment, null,
					initialResourceGroup(initialResourceTitle, initialResources),
					h("div", { className: "dsh-tavern-picker-foot" }, h("button", { className: "dsh-tavern-question-primary", disabled: busy || !chosenInitialResources.length, onClick: function () {
						if (cardEntry === "writing-skill") newCardConversation(null, "writing-skill", "创建写作 Skill", chosenInitialResources);
						else newCardConversation(null, "extract", "从剧本新建人物卡", chosenInitialResources);
					} }, "用已选 " + chosenInitialResources.length + (cardEntry === "extract" ? " 份剧本开始" : " 项开始")))
				) : h(EmptyState, { noun: initialResourceTitle }));
			const initialImportButtons = cardEntry === "resource-edit"
				? h(React.Fragment, null,
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("source"); } }, "导入剧本"),
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("worldbook"); } }, "导入世界书"),
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("preset"); } }, "导入预设")
				)
				: (cardEntry === "writing-skill" || cardEntry === "extract"
					? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("source"); } }, "导入剧本")
					: null);
			const cardPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": "选择卡片工作台起始任务" }, pickerError,
				h("div", { className: "dsh-tavern-card-picker-head" }, cardEntry ? h("button", { className: "dsh-tavern-btn", onClick: function () { setCardEntry(""); } }, "← 返回") : h("span", null, "选择起始任务"), cardEntry === "writing-skill" ? h("span", null, "选择参考素材（至少 1 份）") : cardEntry === "extract" ? h("span", null, "选择初始剧本（至少 1 份）") : cardEntry === "mvu" ? h("span", null, "选择要转换的人物卡") : cardEntry === "resource-edit" ? h("span", null, "选择一个编辑目标") : null, h("span", { className: "dsh-tavern-spacer" }), cardEntry === "edit" || cardEntry === "gentle" || cardEntry === "mvu" ? h(MobileCardImportButton, { inputRef: fileRef, disabled: busy, onImported: refreshImportedCards }) : null, initialImportButtons, h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				cardImportNotice,
				h("input", { ref: initialImportRef, type: "file", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importInitialResource(f, initialImportKindRef.current); e.target.value = ""; } }),
					(cardEntry === "edit" || cardEntry === "gentle" || cardEntry === "mvu") ? workbenchCards : cardEntry === "writing-skill" || cardEntry === "extract" || cardEntry === "resource-edit" ? initialResourcePicker : h(React.Fragment, null,
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(null, "create", "新建人物卡"); } }, h("b", null, "新建人物卡"), h("span", null, "逐题问答确定角色与开场，可选 MVU 变量和前端美化，先看草图再建卡")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("edit"); } }, h("b", null, "修改人物卡"), h("span", null, "先选择人物卡，再追加修改任务提示词")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("gentle"); } }, h("b", null, "人物卡温和改写"), h("span", null, "人物卡被模型拒绝输出时，适当改写为温和版本，减少拒绝并实测效果")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { setCardEntry("mvu"); } }, h("b", null, "把人物卡转成 MVU 版"), h("span", null, "转换为 MVU 后，状态栏绝对不会掉格式")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("writing-skill"); } }, h("b", null, "创建写作 Skill"), h("span", null, "从素材中提炼写作提示词，明确适用与禁用场景，用于前台正文写作")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("extract"); } }, h("b", null, "从剧本新建人物卡"), h("span", null, "先选择至少一份剧本，再进入工作台")),
						h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { openResourcePicker("resource-edit"); } }, h("b", null, "修改剧本 / 世界书 / 预设"), h("span", null, "先选择一个目标，再进入工作台修改")),
					h("button", { className: "dsh-tavern-card-pick", disabled: busy, onClick: function () { newCardConversation(null); } }, h("b", null, "空白开始"), h("span", null, "不追加任务提示词，自由使用完整卡片 Agent"))
				)
			);
			const updateMessage = updateStatus.phase === "checking"
				? "正在向 GitHub 核实最新构建…"
				: updateStatus.phase === "up-to-date"
					? "✓ 未发现更新构建" + (updateStatus.checkWarning ? " · " + updateStatus.checkWarning : "")
				: updateStatus.phase === "update-available"
					? "发现新构建 " + ((updateStatus.latestCommit || "").slice(0, 7) || updateStatus.latestVersion || "") + (updateStatus.checkWarning ? " · " + updateStatus.checkWarning : "")
				: updateStatus.phase === "repair-required"
					? "当前构建需要修复安装" + (updateStatus.error ? "：" + updateStatus.error : "，没有发现更新构建。")
				: updateStatus.phase === "running"
					? (updateStatus.stage ? "当前阶段：" + updateStatus.stage + "。" : "") + (updateStatus.error || (updateStatus.stalled ? "更新暂时没有新进展，安装进程仍在运行。请等待安全停止后再重试。" : "正在下载并安装，期间页面可能暂时断开…"))
				: updateStatus.phase === "cancelling"
					? (updateStatus.error || "正在取消更新并等待安装进程停止，请勿同时重新安装。")
				: updateStatus.phase === "blocked"
					? (updateStatus.error || "安装进程尚未确认停止，暂时不能重试。请等待安全停止后再操作。")
				: updateStatus.phase === "installed-restart-required"
					? (updateStatus.error || "程序文件已更新，但自动重启失败。请手动重启 DSH Tavern。")
				: updateStatus.phase === "restart-required"
					? "请重启 DeepSeek Harness 以加载新版插件。"
				: updateStatus.phase === "completed"
					? (updateStatus.host === "desktop"
						? "更新完成，请重启 DeepSeek Harness。"
						: updateStatus.host === "android"
							? "Android 更新完成，3088 服务已加载新版；界面仍是旧版时请关闭并重开酒馆工作台。"
							: "更新完成，请刷新页面。")
					: updateStatus.phase === "failed" || updateStatus.phase === "check-failed"
						? (updateStatus.error || "更新失败，请稍后重试。")
						: "尚未检查更新";
			const currentVersionLabel = updateStatus.currentVersion && updateStatus.currentVersion !== "unknown" ? "v" + updateStatus.currentVersion : "版本未知";
			const currentCommitLabel = (updateStatus.currentCommit || "").slice(0, 7) || "构建未知";
			const updateHostLabel = { desktop: "Desktop 版", next: "Next 版", android: "Android 版" }[updateStatus.host] || "命令行版";
			// 状态还没回来就整块不画，会让版本行和「检查更新」在每次页面重载、切对话后先
			// 消失再出现；读到慢（后端忙、请求超时前重试）时会缺好几秒。行留在原地，只把
			// 状态行交给下面的加载态。
			const updateStatusLoading = updateStatus.phase === "loading";
			// 已是最新且无警告时，结果直接写在按钮上，不再单占一行（手机侧栏高度紧张）。
			const upToDateQuiet = updateStatus.phase === "up-to-date" && !updateStatus.checkWarning;
			// 发现更新时同理：目标构建直接挂在版本行末尾，「发现新构建 ×××」不再单占一行。
			// 手机侧栏放不下「DSH Tavern · DSH 0.2.1」那一串，改用缩短版（CSS 按断点切换）。
			const latestBuildLabel = (updateStatus.latestCommit || "").slice(0, 7) || updateStatus.latestVersion || "";
			const updateAvailableQuiet = updateStatus.phase === "update-available" && !updateStatus.checkWarning && Boolean(latestBuildLabel);
			const updateTargetLabel = updateAvailableQuiet ? " → " + latestBuildLabel : "";
			// 移动端详情行仅在更新过程/结果态显示，非更新态（含带 checkWarning 的检查结果）隐藏；
			// 发现新构建时缩短版版本行始终附带目标构建，避免隐藏详情行后看不到目标构建。
			const updateTargetCompactLabel = updateStatus.phase === "update-available" && Boolean(latestBuildLabel) ? " → " + latestBuildLabel : "";
			const mobileUpdateDetailVisible = ["running", "cancelling", "blocked", "completed", "failed", "repair-required", "installed-restart-required", "restart-required"].includes(updateStatus.phase);
			const updateIdentityText = updateStatusLoading ? "DSH Tavern · DSH 0.2.1" : "DSH Tavern " + currentVersionLabel + " · DSH 0.2.1 · " + currentCommitLabel + updateTargetLabel;
			const updateIdentityCompactText = updateStatusLoading ? "DSH Tavern · DSH 0.2.1" : currentVersionLabel + " · " + currentCommitLabel + updateTargetCompactLabel;
			const checkingOrRunning = updater.current?.isBusy(updateStatus) ?? false;
			const awaitingDesktopRestart = updateStatus.phase === "completed" && updateStatus.host === "desktop" && updateStatus.requiresRestart;
			const cancelSupported = ["running", "cancelling"].includes(updateStatus.phase) && updateStatus.cancellable === true;
			const updateActions = updateStatus.phase === "update-available" || updateStatus.phase === "repair-required"
				? h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", onClick: checkUpdate }, "检查更新"),
					h("button", { className: "dsh-tavern-update-button primary", onClick: performUpdate }, updateStatus.phase === "repair-required" ? "修复安装" : "进行更新"))
				: h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", disabled: checkingOrRunning || awaitingDesktopRestart || updateStatus.phase === "restart-required" || updateStatus.phase === "installed-restart-required", onClick: checkUpdate }, awaitingDesktopRestart ? "请重启 Desktop" : updateStatus.phase === "checking" ? "正在检查…" : (updateStatus.phase === "running" ? "正在更新…" : (updateStatus.phase === "cancelling" ? "正在取消…" : (updateStatus.phase === "blocked" ? "等待安全停止" : (updateStatus.phase === "installed-restart-required" ? "请手动重启" : (updateStatus.phase === "restart-required" ? "重启 Desktop 后可用" : (upToDateQuiet ? "✓ 已是最新" : "检查更新"))))))),
					cancelSupported ? h("button", { className: "dsh-tavern-update-button", disabled: updateStatus.phase === "cancelling", onClick: cancelUpdate }, updateStatus.phase === "cancelling" ? "正在取消…" : "取消更新") : null);
			return h(React.Fragment, null, h(TavernErrorCenter), collapsedSidebar, h("div", { className: "dsh-tavern-sidebar", style: { display: collapsed ? "none" : undefined, position: "relative", width: props.embedded ? "100%" : props.width + "px" } },
				h("div", { className: "dsh-tavern-side-top" },
					// 手机宽度整屏铺开时宿主的抽屉把手被盖住，右上角留酒馆自己的收回按钮（桌面端由 CSS 隐藏）。
					collapsed ? null : h("button", { className: "dsh-tavern-side-collapse", title: "收起侧栏", "aria-label": "收起侧栏", onClick: function () { props.toggleSidebar(); } }, h("span", { "aria-hidden": "true" }, "‹"), h("span", null, "收起")),
					h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand dsh-tavern-lockup", role: "img", "aria-label": "DSH Tavern" }), props.embedded ? null : h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
					h("div", { className: "dsh-tavern-mode-switch" },
						h("button", { className: uiMode === "play" ? "active" : "", disabled: busy, onClick: function () { switchToPlay(); } }, "游玩"),
						h("button", { className: uiMode === "card" ? "active" : "", disabled: busy, onClick: function () { switchMode("card"); } }, "卡片")
					),
					h("button", { className: "dsh-tavern-side-new", disabled: busy, onClick: function () { openPicker(); } }, uiMode === "play" ? (openingPicker ? "继续开局 · " + openingPicker.card.name : "＋ 选择人物卡 · 新开游玩") : "＋ 新建卡片工作台对话")
				),
				h("input", { ref: fileRef, type: "file", multiple: true, accept: TAVERN_CARD_FILE_ACCEPT, style: { display: "none" }, onChange: function (event) {
					const files = Array.from(event.target.files || []);
					event.target.value = "";
					void importPickedCards(files);
				} }),
				cardUpdate.input,
				// the dialog is its own layer (Modal): a window narrow enough to fold the sidebar keeps it
				cardUpdate.element,
				playExport.element,
				h("div", { className: "dsh-tavern-side-title dsh-tavern-history-heading" },
					h("span", null, uiMode === "play" ? "游玩历史" : "卡片历史"),
					h("button", { type: "button", className: "dsh-tavern-history-action", "aria-haspopup": "dialog", disabled: busy || !hasHistoryInMode, onClick: openHistoryManager }, "管理")),
				h("div", { ref: sideListRef, className: "dsh-tavern-side-list", onScroll: onSideListScroll }, rows.length || archiveGroup ? rows : h(EmptyState, { noun: uiMode === "play" ? "游玩对话" : "卡片工作台对话" }), archiveGroup),
				deleteNotice ? h("div", { role: "status", style: { padding: "4px 12px" } }, deleteNotice) : null,
				!picking && error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
				collapsed ? null : props.renderSlot("tavern.sidebar.chrome", {}),
				updateStatus.host === "desktop" ? h(TavernHostCompatibility) : updateStatus.pluginManaged ? null : h("div", { className: "dsh-tavern-update" },
					h("div", { className: "dsh-tavern-update-row" },
						h("div", { className: "dsh-tavern-update-identity", title: updateStatusLoading ? "DSH Tavern · " + updateHostLabel : "DSH Tavern " + currentVersionLabel + " · " + updateHostLabel },
							h("span", { className: "dsh-tavern-update-identity-wide" }, updateIdentityText),
							h("span", { className: "dsh-tavern-update-identity-compact" }, updateIdentityCompactText)),
						updateActions),
                    h(TavernHostCompatibility),
					!updateMessage || updateStatus.phase === "idle" || updateStatus.phase === "loading" || upToDateQuiet || updateAvailableQuiet ? null : h("div", { className: "dsh-tavern-update-status" + (updateStatus.phase === "failed" || updateStatus.phase === "check-failed" || updateStatus.phase === "blocked" || updateStatus.stalled ? " error" : ""), role: "status", "data-mobile-update-detail": mobileUpdateDetailVisible ? "visible" : "hidden" }, updateMessage)
				),
				!collapsed ? portalOverlay(historyManagerPanel) : null,
				!collapsed && (openingPicker || (picking && uiMode === "play")) ? portalOverlay(h("div", { key: "play-picker", className: "dsh-tavern-picker-overlay", style: { display: picking && uiMode === "play" && !cardUpdate.open ? undefined : "none" }, onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, playPicker)) : null,
                !collapsed && picking && uiMode === "card" ? portalOverlay(h("div", { key: "card-picker", className: "dsh-tavern-picker-overlay", onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, cardPicker)) : null,
				cardZipImport ? cardZipImport.element : null
			));
		}

		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			const uiConversation = ctx.get("uiConversation") || ctx.get("conversation");
			// uiWorkspace 由 dsh-client-ui-workspace 提供；缺失时（老宿主/未加载）退化为 sessions.retain。
			function resolveUiWorkspace() {
				try { return ctx.get("uiWorkspace") || null; } catch (_) { return null; }
			}
			ctx.effect(function () {
				// Seed the host layout once so its grid, panel and drag handle share the same width.
				ctx.layout?.panels?.setRightbar?.(Math.round(window.innerWidth * 0.3));
			}, "dsh-tavern: default right sidebar width");
			ctx.effect(function () {
				document.body.classList.add("dsh-tavern-shell-active");
				const releaseLandingStyles = installTavernLandingStyles(document);
				const releaseViewport = installVisualViewportPin(document);
				const releaseBrand = installTavernBrand(document, __TAVERN_BRAND_URLS__);
				const releaseHScroll = installHScroll(window, "capture"); // hidden scrollbars, no sideways-only scrolling on PC
				return function () {
					releaseHScroll();
					releaseBrand();
					releaseViewport();
					releaseLandingStyles();
					document.body.classList.remove("dsh-tavern-shell-active");
				};
			}, "dsh-tavern: shell marker");
			// Keep the native account menu, but present its launcher as Settings.
			ctx.effect(function () {
				const originals = new Map();
				const selector = '[data-slot="settings.launcher"] button[data-signed-out]';
				function sync() {
					for (const button of document.querySelectorAll(selector)) {
						if (!originals.has(button)) originals.set(button, button.getAttribute("aria-label"));
						if (button.getAttribute("aria-label") !== "设置") button.setAttribute("aria-label", "设置");
					}
				}
				const observer = new MutationObserver(function (records) {
					for (const record of records) {
						if (record.type === "attributes") {
							const target = record.target;
							if (target && target.nodeType === 1 && target.matches && target.matches(selector)) { sync(); return; }
							continue;
						}
						for (const node of record.addedNodes) {
							if (node && node.nodeType === 1 && ((node.matches && node.matches(selector)) || (node.querySelector && node.querySelector(selector)))) { sync(); return; }
						}
					}
				});
				observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
				sync();
				return function () {
					observer.disconnect();
					for (const [button, label] of originals) {
						if (label === null) button.removeAttribute("aria-label");
						else button.setAttribute("aria-label", label);
					}
				};
			}, "dsh-tavern: settings launcher label");
			// Until the session list first loads, the host cannot tell whether it will
			// restore the last conversation, so it paints the hero and then jumps away.
			// Keep the hero blank while the list is pending.
			ctx.effect(function () {
				const list = ctx.sessions && ctx.sessions.list;
				if (!list) return function () {};
				function sync() { document.body.classList.toggle("dsh-tavern-sessions-pending", list.getSnapshot().phase === "pending"); }
				const unsubscribe = list.subscribe(sync);
				sync();
				return function () { unsubscribe(); document.body.classList.remove("dsh-tavern-sessions-pending"); };
			}, "dsh-tavern: hide hero until sessions load");
			// The host hero shows its own mark and headline; the tavern lockup replaces both.
			ctx.effect(() => slots.inject("conversation.hero.brand.mark", () => slots.register(
				{ name: "conversation.hero.brand.mark" },
				function () { return React.createElement("span", { className: "dsh-tavern-hero-lockup dsh-tavern-lockup", role: "img", "aria-label": "DSH Tavern" }); }
			)), "dsh-tavern: hero brand");
			ctx.effect(() => slots.inject("sidebar.brand.mark", () => slots.register(
				{ name: "sidebar.brand.mark", priority: -1 },
				function (props) { const size = (props && props.size) || 24; return React.createElement("span", { className: "dsh-tavern-logo", "aria-hidden": "true", style: { width: size + 4, height: size + 4 } }); }
			)), "dsh-tavern: sidebar brand mark");
			// Whether the left drawer is open on narrow layouts, as of the last render. Opening the right
			// column used to close it as a side effect; now that it stays shut (#213), close the drawer here.
			let sidebarWide = false;
			// dsh-go 在 768..1023px 用自己的抽屉（html[data-dsh-app-layout="drawer"] 且无 data-sidebar-drawer）：
			// 内部侧栏常驻展开，抽屉显隐由 window.__dshApp 切换 frame[data-dsh-app-drawer]，不能调 ctx.layout.toggleSidebar 折叠内栏。
			function dshGoAppDrawer() {
				if (typeof document === "undefined" || typeof window === "undefined") return null;
				if (document.documentElement.getAttribute("data-dsh-app-layout") !== "drawer") return null;
				const frame = document.querySelector('[data-slot="root"] > [class*="_frame"]');
				return frame && !frame.hasAttribute("data-sidebar-drawer") && window.__dshApp ? window.__dshApp : null;
			}
			function closeNarrowSidebar() {
				const appDrawer = dshGoAppDrawer();
				if (appDrawer && typeof appDrawer.closeSidebar === "function") { appDrawer.closeSidebar(); return; }
				const frame = typeof document !== "undefined" ? document.querySelector('[data-slot="root"] > [class*="_frame"]') : null;
				if (frame && frame.hasAttribute("data-sidebar-collapsed")) { sidebarWide = false; return; }
				if (sidebarWide) { sidebarWide = false; ctx.layout.toggleSidebar(); }
			}
			ctx.effect(() => slots.inject("sidebar.workspaces", () => slots.register(
				{ name: "sidebar.workspaces", priority: -1, children: { "tavern.sidebar.chrome": { kind: "list", scope: "root" } } },
				function (props) { sidebarWide = Boolean(props.wide); return React.createElement(TavernSidebar, Object.assign({}, props, {
					collapsed: !props.wide,
					embedded: true,
					closeNarrowSidebar: closeNarrowSidebar,
					sessions: createSessionCompat(ctx.sessions, resolveUiWorkspace(ctx)),
					workspaces: ctx.workspaces,
					conversationHost: createConversationHostAdapter(ctx),
                    executeSlash: createTavernFrameSlashExecutor(ctx),
					theme: ctx.theme,
					// play saves keep their own name in the Tavern chat; the host
					// session title (shown in the conversation header) follows the card name.
					renameChat: async function (sessionId, title) {
						await rpc("renameConversation", { sessionId: sessionId, title: title }, sessionId);
						notifyTavernDataChanged(["sessions"], "conversation.rename");
					},
					syncHostTitle: async function (sessionId, title) {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === undefined) return false;
						const result = await session.rename(title);
						return Boolean(result && result.ok);
					},
					renameSession: async function (sessionId, title) {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === undefined) throw new Error("找不到该对话");
						const result = await session.rename(title);
						if (!result.ok) throw new Error(result.error.message);
						await rpc("renameConversation", { sessionId: sessionId, title: title }, sessionId);
						notifyTavernDataChanged(["sessions"], "conversation.rename");
					},
					archiveSession: function (sessionId) { return ctx.workspaces.archiveSession(sessionId); },
					toggleSidebar: function () {
						const appDrawer = dshGoAppDrawer();
						if (appDrawer && typeof appDrawer.toggleSidebar === "function") { appDrawer.toggleSidebar(); return; }
						if (props.wide) ctx.layout.toggleSidebar(); else props.expandSidebar();
					},
					// Entering a game or the card workspace opens these tabs beside it. On phone-width
					// layouts the right column covers the story, so leave it closed and show the story (#213).
					openConversationSettingsTab: async function (sessionId) {
						if (narrowLayout()) return closeNarrowSidebar();
						if (tavernSettingsTabsShownFor === sessionId) return;
						// Claim before awaiting the setting, so a second call during the read cannot open twice.
						tavernSettingsTabsShownFor = sessionId;
						// The setting is off: release the claim, so turning it on later still opens the tabs.
						if (!await tavernAutoOpenStatus.read()) { if (tavernSettingsTabsShownFor === sessionId) tavernSettingsTabsShownFor = ""; return; }
						// The column already shows one of these pages (it was never closed, or the sidebar remounted):
						// opening again expands the column and focuses the page, pulling it over the story for nothing.
						if (tavernRightColumnShowing(ctx, ["dsh-tavern:conversation-settings", "dsh-tavern:status"])) return;
						const opened = await openTavernSidebarTab(ctx, { type: "dsh-tavern:conversation-settings" }, { sessionId: sessionId }) && await openTavernSidebarTab(ctx, { type: "dsh-tavern:status" }, { sessionId: sessionId });
						// Not opened (the player already moved on, or the host refused): try again next time this game is entered.
						if (!opened) { if (tavernSettingsTabsShownFor === sessionId) tavernSettingsTabsShownFor = ""; return; }
						expandTavernRightColumn(ctx);
					},
					openCardLibraryTab: function (sessionId) { if (narrowLayout()) return closeNarrowSidebar(); return openTavernSidebarTab(ctx, { type: "dsh-tavern:cards", meta: null }, { sessionId: sessionId }); },
					openPresetLibraryTab: function (sessionId) { if (narrowLayout()) return closeNarrowSidebar(); return openTavernSidebarTab(ctx, { type: "dsh-tavern:presets" }, { sessionId: sessionId }); },
					openWorldBookLibraryTab: function (sessionId) { if (narrowLayout()) return closeNarrowSidebar(); return openTavernSidebarTab(ctx, { type: "dsh-tavern:worldbooks" }, { sessionId: sessionId }); },
					openResourcesTab: function (sessionId) { if (narrowLayout()) return closeNarrowSidebar(); return openTavernSidebarTab(ctx, { type: "dsh-tavern:resources" }, { sessionId: sessionId }); },
					appendMention: input.appendMention,
					injectTaskPrompt: input.injectTaskPrompt,
					cleanWorkspaceDraft: input.cleanWorkspaceDraft
				})); }
			)), "dsh-tavern: Tavern workspace browser");
		}
		return Object.freeze({ register: register });
		}
		const tavernShellFeature = createTavernShellFeatureModule();
