		function createTavernShellFeatureModule() {
		// @include modules/host-compatibility.js
		function TavernSidebar(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const collapsed = props.collapsed;
			const current = props.useSessions(function (state) { return state.current; });
			const summaries = props.useSessions(function (state) { return state.byId; });
			const workspaceId = props.useWorkspaces(function (state) { return props.conversationHost.workspaceId(state, current); });
			const [cards, setCards] = React.useState([]);
			const [initialResources, setInitialResources] = React.useState([]);
			const [selectedInitialResources, setSelectedInitialResources] = React.useState({});
			const [history, setHistory] = React.useState([]);
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
			const cardBatch = useCardBatchDeletion(cards, busy, setBusy, refresh, props.archiveSession);
			const organization = useCardOrganization(cards, busy, refresh, error => setError(error), cardBatch);
			const [error, setError] = usePersistentError("左侧栏操作");
			const [uiMode, setUiMode] = React.useState("play");
			const [requestMode, setRequestMode] = React.useState("dsh");
			const compatibilityAvailable = false;
			const [trustedCardMode, setTrustedCardMode] = React.useState(true);
			const [cardEntry, setCardEntry] = React.useState("");
			const [openingPicker, setOpeningPicker] = React.useState(null);
			const openingLayoutRef = React.useRef(null);
			const [openingSettingsCollapsed, setOpeningSettingsCollapsed] = React.useState(false);
			const openingSettingsManual = React.useRef(false);
			React.useEffect(function () {
				openingSettingsManual.current = false;
				setOpeningSettingsCollapsed(false);
			}, [openingPicker && openingPicker.card.path]);
			React.useEffect(function () {
				const dialog = openingLayoutRef.current;
				if (!openingPicker || !dialog || typeof ResizeObserver === "undefined") return;
				function fit() {
					if (!openingSettingsManual.current && dialog.scrollHeight > dialog.clientHeight + 2) setOpeningSettingsCollapsed(true);
				}
				const observer = new ResizeObserver(fit);
				observer.observe(dialog);
				const preview = dialog.querySelector(".dsh-tavern-greeting-preview");
				if (preview) observer.observe(preview);
				fit();
				return function () { observer.disconnect(); };
			}, [openingPicker, picking]);

			const [chatImport, setChatImport] = React.useState(null);
			const chatImportFile = React.useRef(null);
			const [pendingOpen, setPendingOpen] = React.useState(null);
			const [menuSession, setMenuSession] = React.useState(null);
			const [managing, setManaging] = React.useState(false);
			const [selectedChats, setSelectedChats] = React.useState([]);
			const [deleteNotice, setDeleteNotice] = React.useState("");
			React.useEffect(function () { setSelectedChats([]); setManaging(false); setDeleteNotice(""); }, [uiMode, requestMode]);
			const removedChatsHandler = React.useRef(null);
			React.useEffect(function () {
				function onRemoved(event) { if (removedChatsHandler.current) removedChatsHandler.current(event.detail && event.detail.sessionIds || []); }
				window.addEventListener("dsh-tavern-chats-removed", onRemoved);
				return function () { window.removeEventListener("dsh-tavern-chats-removed", onRemoved); };
			}, []);
			function toggleChatSelection(chatId) {
				if (busy) return;
				setSelectedChats(function (ids) { return ids.includes(chatId) ? ids.filter(function (id) { return id !== chatId; }) : ids.concat(chatId); });
			}
			async function deleteSelectedConversations() {
				const items = visibleHistory.filter(function (item) { return selectedChats.includes(item.chatId); });
				if (busy || !items.length || !await askConfirm("删除这 " + items.length + " 个对话？\n删除后无法恢复，人物卡和世界书会保留。")) return;
				setBusy(true); setError(""); setDeleteNotice("");
				try {
					const outcome = await deleteTavernChats(items, props.archiveSession);
					const failures = outcome.failures;
					const removed = outcome.removed;
					setSelectedChats(failures.map(function (result) { return result.chatId; }));
					setDeleteNotice("已删除 " + removed.length + " 个" + (failures.length ? "，" + failures.length + " 个失败，可重试" : ""));
					if (failures.length) setError(failures.map(function (result) { const item = items.find(function (item) { return item.chatId === result.chatId; }); return (item && (item.title || item.cardName) || result.chatId) + "：" + result.error; }).join("\n"));
					if (items.some(function (item) { return item.sessionId === current && removed.includes(item.chatId); })) {
						props.sessions.clear();
						const next = visibleHistory.find(function (item) { return !removed.includes(item.chatId); });
						if (next) await openSessionWhenReady(next.sessionId);
						else openPicker("cards");
					}
					await refresh();
				} catch (error) { setError(String(error.message || error)); await refresh(); }
				finally { setBusy(false); }
			}
			const [updateStatus, setUpdateStatus] = React.useState({ phase: "loading", host: "cli" });
			const updateStatusRef = React.useRef(updateStatus);
			const updateActionRef = React.useRef({ pending: false, generation: 0 });
			function publishUpdateStatus(next) {
				updateStatusRef.current = next;
				// Polls return fresh objects; unchanged status must not re-render the sidebar.
				setUpdateStatus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
			}
			function isUpdateBusy(status) {
				return ["loading", "checking", "running", "cancelling", "blocked"].includes(status.phase);
			}
			async function callUpdate(method) {
				const controller = new AbortController();
				let timer;
				try {
					// Stop waiting for a lost response, never replay a mutation. The next status read reconciles it.
					const timeout = new Promise(function (_resolve, reject) {
						timer = window.setTimeout(function () {
							const error = new Error("更新服务请求超时，正在核实状态");
							error.retryable = true;
							reject(error);
							controller.abort();
						}, 30000);
					});
					return await Promise.race([call(method, undefined, { signal: controller.signal }), timeout]);
				} finally { window.clearTimeout(timer); }
			}
			const updateStartedAtRef = React.useRef(0);
			const updateRecoveryRef = React.useRef({ sawOffline: false, reloading: false });
			const lastModeSession = React.useRef(null);
			const fileRef = React.useRef(null);
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
					resourceRoot: function () { return call("getResourceWorkspace"); },
					createWorkspace: function (input) { return props.workspaces.create(input); }
				});
			}
            if (playPrewarmRef.current === null) {
                playPrewarmRef.current = createConversationPrewarmModule({ resolveWorkspace: playWorkspaceResolverRef.current });
            }
			if (sessionListRecoveryRef.current === null) {
				sessionListRecoveryRef.current = createSessionListRecoveryModule({
					summary: function (sessionId) { return props.sessions.list.getSnapshot().byId[sessionId]; },
					binding: function (sessionId) { return props.sessions.binding(sessionId); },
					refresh: function () { return typeof props.sessions.refresh === "function" ? props.sessions.refresh() : Promise.resolve(); },
					open: function (sessionId) { props.sessions.open(sessionId); },
					isUnknownSession: isUnknownSessionSelectError
				});
			}
			const currentSummary = current ? summaries[current] : null;
			const readyTavernSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); }) ? current : "";
			const readyCardSession = current && summaries[current] && summaries[current].blank === false && history.some(function (entry) { return entry.sessionId === current && entry.mode === "card"; }) ? current : "";

			React.useEffect(function () {
				if (!current || !summaries[current] || !props.sessions.binding(current)) return;
				const latest = tavernErrorHub.getSnapshot()[0];
				if (!latest || latest.source !== "左侧栏操作") return;
				if (latest.message === "DSH Session 列表同步超时，请刷新页面后重试：" + current) setError("");
			}, [current, summaries]);
			function call(method, args, requestOptions) { return rpc(method, args, undefined, requestOptions); }
			function isMissingUpdateApiError(error) {
				return String(error && error.message || error || "").indexOf("未知方法: getUpdateStatus") >= 0;
			}
			function notifyDataChanged(kinds) {
				notifyTavernDataChanged(kinds, "sidebar");
			}
			function refresh(kinds) {
                if (!Array.isArray(kinds) || !kinds.length || kinds.indexOf("*") >= 0) kinds = null;
				return Promise.all([
					(!kinds || kinds.indexOf("cards") >= 0) && call("listCards").then(function (result) {
						setCards(result.cards || []); tavernErrorHub.resolve("左侧栏人物卡");
					}, function (err) { tavernErrorHub.report("左侧栏人物卡", err); }),
					(!kinds || kinds.indexOf("sessions") >= 0) && call("listSessions").then(function (result) {
						const sessions = result.sessions || [];
						setHistory(sessions); setTrustedCardMode(!result.capabilities || result.capabilities.trustedCardMode !== false); publishSessionModes(sessions);
						if (!sessions.some(function (entry) { return entry.sessionId === current && isPlayMode(entry.mode); })) {
							setRequestMode(result.capabilities?.compatibilityMode === true && window.localStorage.getItem("dsh-tavern-request-mode") === "sillytavern" ? "sillytavern" : "dsh");
						}
						tavernErrorHub.resolve("左侧栏历史");
					}, function (err) { tavernErrorHub.report("左侧栏历史", err); })
				]);
			}
			React.useEffect(function () {
				function refreshSettings() { void refresh(); }
				window.addEventListener("dsh-tavern-settings-changed", refreshSettings);
				return function () { window.removeEventListener("dsh-tavern-settings-changed", refreshSettings); };
			}, [props.sessionId]);
			React.useEffect(function () {
				refresh();
				function onData(event) { if (tavernDataChangeAffects(event, ["cards", "sessions"], "sidebar")) refresh(event && event.detail && event.detail.kinds); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onData); };
			}, []);
			React.useEffect(function () {
				if (!current) return;
				return tavernCoordination.subscribe(current, function () {});
			}, [current]);
			React.useEffect(function () {
				return function () { playPrewarmRef.current.cancel(); };
			}, []);
			React.useEffect(function () {
				let stopped = false;
				let received = false;
				let pending = false;
				let failures = 0;
				async function refreshUpdateStatus() {
					if (stopped || pending || updateActionRef.current.pending) return;
					const generation = updateActionRef.current.generation;
					pending = true;
					try {
						const result = await callUpdate("getUpdateStatus");
						if (!stopped && generation === updateActionRef.current.generation && !updateActionRef.current.pending && result && result.status) {
							received = true;
							failures = 0;
							tavernErrorHub.resolve("更新状态");
							const status = result.status;
							const completedInThisPage = status.phase === "completed" && updateStartedAtRef.current > 0 && Number(status.completedAt || 0) >= updateStartedAtRef.current;
							const next = status.phase === "completed" && !completedInThisPage ? { ...status, phase: "idle", host: status.host || "cli" } : status;
							// Ignore reads begun before an update action, even if they finish afterward.
							publishUpdateStatus(next);
						}
					} catch (err) {
							if (stopped || generation !== updateActionRef.current.generation || updateActionRef.current.pending) return;
							failures += 1;
							// Only this read-only poll gets a startup grace period. Never replay startUpdate.
							if ((err && err.retryable || err instanceof TypeError) && failures < 3) return;
							if (isMissingUpdateApiError(err)) {
								if (!received) publishUpdateStatus({ phase: "restart-required", host: "desktop" });
							} else {
								if (!received && !["running", "cancelling", "blocked"].includes(updateStatusRef.current.phase)) publishUpdateStatus({ phase: "failed", host: "cli", error: String(err && err.message || err) });
								tavernErrorHub.report("更新状态", err);
							}
						} finally { pending = false; }
				}
				refreshUpdateStatus();
				const timer = window.setInterval(refreshUpdateStatus, 2500);
				return function () { stopped = true; window.clearInterval(timer); };
			}, []);
			React.useEffect(function () {
				if (updateStatus.phase !== "running" || updateStatus.host === "desktop") return;
				let stopped = false;
				const recovery = updateRecoveryRef.current;
				async function probeRestartedService() {
					try {
						const response = await window.fetch(window.location.origin + "/?tavern-update-probe=" + Date.now(), { cache: "no-store" });
						if (!stopped && response.ok && recovery.sawOffline && !recovery.reloading) {
							recovery.reloading = true;
							window.location.reload();
						}
					} catch (error) {
						if (!stopped) recovery.sawOffline = true;
					}
				}
				probeRestartedService();
				const timer = window.setInterval(probeRestartedService, 400);
				return function () { stopped = true; window.clearInterval(timer); };
			}, [updateStatus.phase, updateStatus.host]);
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
				if (isPlayMode(item.mode)) setRequestMode(compatibilityAvailable && item.requestMode === "sillytavern" ? "sillytavern" : "dsh");
			}, [current, history, compatibilityAvailable]);
			React.useEffect(function () {
				if (!openingPicker || !openingPicker.card || openingPicker.preparing) return;
				let stopped = false;
				const cardPath = openingPicker.card.path;
				const userName = String(openingPicker.userName || "你").trim() || "你";
				const preparedKey = JSON.stringify([userName, compatibilityAvailable && (openingPicker.requestMode || requestMode) === "sillytavern" ? "sillytavern" : "dsh"]);
				if (openingPicker.preparedKey === preparedKey) return;
				const timer = window.setTimeout(async function () {
					try {
						const response = await initializeFullOpeningTemplate(await call("getCardOpenings", { previewTransport: "deferred-v1", path: cardPath, userName: userName, requestMode: compatibilityAvailable && (openingPicker.requestMode || requestMode) === "sillytavern" ? "sillytavern" : "dsh" }));
						if (stopped) return;
						setOpeningPicker(function (current) {
							if (!current || current.card.path !== cardPath || (String(current.userName || "你").trim() || "你") !== userName) return current;
							const openings = response.openings || [];
							const selected = current.openings && current.openings[current.index];
							const selectedIndex = selected ? openings.findIndex(function (item) { return item.id === selected.id; }) : -1;
							return Object.assign({}, current, { preparedKey: preparedKey, preparationId: response.preparationId || "", openings: openings, index: selectedIndex >= 0 ? selectedIndex : 0, trustedCardMode: response.trustedCardMode });
						});
					} catch (err) { if (!stopped) setError(String(err && err.message || err)); }
				}, 250);
				return function () { stopped = true; window.clearTimeout(timer); };
			}, [openingPicker && openingPicker.card && openingPicker.card.path, openingPicker && openingPicker.userName, openingPicker && openingPicker.preparing, requestMode, compatibilityAvailable]);
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
				if (uiMode === "play" && openingPicker) setRequestMode(openingPicker.requestMode || "dsh");
				setError("");
				setPicking(true);
				// Agent tools and external file edits do not emit browser-local data events.
				void call("listCards").then(function (result) {
					setCards(result.cards || []); tavernErrorHub.resolve("左侧栏人物卡");
				}, function (error) { tavernErrorHub.report("左侧栏人物卡", error); });
				void call("preparePlayStart").catch(function (error) { console.warn("dsh-tavern: 游戏启动资源预热失败，将在开始时读取", error); });
			}
			function closePicker() {
				if (busy) return;
				cardBatch.reset();
				setPendingChatImport(null);
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
			function isUnknownSessionSelectError(error) {
				return /sessions\.select: unknown session/i.test(String(error && error.message || error || ""));
			}
			async function openSessionWhenReady(sessionId) {
				await sessionListRecoveryRef.current.open(sessionId);
				await call("markConversationOpened", { sessionId: sessionId });
				await refresh(["sessions"]);
				setError("");
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
						pending.taskSupplement = "【已关联游玩记录】\n" + String(reference.label || "游玩记录") + "\nref: " + String(reference.path) + "\n使用 tavern_read_play_chat 读取，先查看 overview。";
					}
					if (typeof props.openCardLibraryTab === "function") props.openCardLibraryTab(pending.sessionId);
					if (typeof props.openPresetLibraryTab === "function") props.openPresetLibraryTab(pending.sessionId);
					if (typeof props.openWorldBookLibraryTab === "function") props.openWorldBookLibraryTab(pending.sessionId);
					if (typeof props.openResourcesTab === "function") props.openResourcesTab(pending.sessionId);
					if (pending.task) await props.injectTaskPrompt(pending.sessionId, pending.task, pending.label, pending.card, (pending.selectedResources || []).length > 0, pending.taskSupplement);
					(pending.selectedResources || []).forEach(function (resource) { props.appendMention(pending.sessionId, resource.kind, resource.path, resource.title); });
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
				createChat: function (request, sessionId) {
					return call("startChat", {
						path: request.card && request.card.path ? request.card.path : "",
						sessionId: sessionId,
						mode: request.targetMode,
						cardTask: request.task || "",
						openingId: request.openingId || "",
						preparationId: request.preparationId || "",
						userName: request.userName || "你",
						requestMode: compatibilityAvailable && request.requestMode === "sillytavern" ? "sillytavern" : "dsh"
					});
				},
				rememberPending: setPendingOpen,
				finishOpen: finishPendingOpen
			});
			React.useEffect(function () {
				function onStartSessionOpening(event) {
					const detail = event.detail;
					if (!detail || detail.handled || detail.sourceSessionId !== current) return;
					detail.handled = true;
					if (busy) { detail.reject(new Error("正在处理其他操作，请稍后重试")); return; }
					setBusy(true); setError("");
					conversationLifecycle.start(Object.assign({ kind: "play" }, detail.request)).then(detail.resolve, function (error) {
						setError("开始旅程失败：" + String(error.message || error)); detail.reject(error);
					}).finally(function () { setBusy(false); });
				}
				window.addEventListener("dsh-tavern-start-session-opening", onStartSessionOpening);
				return function () { window.removeEventListener("dsh-tavern-start-session-opening", onStartSessionOpening); };
			}, [current, busy, conversationLifecycle]);
			async function retryPendingOpen() {
				if (!pendingOpen) return;
				setBusy(true); setError("");
				try { await finishPendingOpen(pendingOpen); startAttemptsRef.current.complete(pendingOpen.sessionId); }
				catch (err) { setError("重新连接 Session 失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function readChatImportFile(file) {
				if (file.size > 8 * 1024 * 1024) throw new Error("聊天文件最大支持 8 MB");
				return await file.text();
			}
			async function loadChatImportPreview(card, text, fileName) {
				setBusy(true); setError("");
				try {
					const preview = await call("previewChatImport", { cardPath: card.path, text: text });
					setChatImport({ cardPath: card.path, text: text, fileName: fileName, preview: preview, userName: preview.userName, textOnly: false });
				} catch (error) { setError(String(error.message || error)); }
				finally { setBusy(false); }
			}
			async function previewChatImport(file) {
				if (!file || !openingPicker) return;
				let text;
				try { text = await readChatImportFile(file); } catch (error) { setError(String(error.message || error)); return; }
				await loadChatImportPreview(openingPicker.card, text, file.name);
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
				if (matches.length === 1) await preparePlayConversation(matches[0]);
			}
			React.useEffect(function () {
				if (!pendingChatImport || !openingPicker || openingPicker.preparing || busy) return;
				const pending = pendingChatImport;
				setPendingChatImport(null);
				void loadChatImportPreview(openingPicker.card, pending.text, pending.fileName);
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
					if (file.size > 512 * 1024 * 1024) throw new Error("存档文件超过 512 MB");
					const bytes = new Uint8Array(await file.arrayBuffer());
					let binary = "";
					for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
					const imported = await call("importGameSave", { fileB64: btoa(binary) });
					notifyDataChanged(["cards", "sessions"]);
					closePicker();
					await finishPendingOpen({ sessionId: imported.sessionId, targetMode: "story" });
				} catch (error) { setError("导入存档失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			async function importConversation() {
				if (busy || !chatImport || !openingPicker || chatImport.cardPath !== openingPicker.card.path) return;
				setBusy(true); setError("");
				const key = "dsh-tavern:chat-import:" + JSON.stringify([chatImport.preview.digest, chatImport.cardPath, chatImport.userName, chatImport.textOnly]);
				try {
					await playPrewarmRef.current.cancel();
					let attempt;
					try { attempt = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
					if (!attempt) {
						const targetWorkspaceId = await playWorkspaceResolverRef.current();
						attempt = { operationId: window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : String(Date.now()) + ":" + String(Math.random()), sessionId: await props.conversationHost.connectWorkspace(targetWorkspaceId) };
						localStorage.setItem(key, JSON.stringify(attempt));
					}
					await waitForSessionSummary(attempt.sessionId);
					await ensureTavernPreset(attempt.sessionId, { kind: "play" });
					const imported = await call("importChatHistory", Object.assign({}, attempt, { cardPath: chatImport.cardPath, text: chatImport.text, fileName: chatImport.fileName, userName: chatImport.userName, textOnly: chatImport.textOnly }));
					const pending = { sessionId: attempt.sessionId, targetMode: imported.mode || "story" };
					setPendingOpen(pending);
					localStorage.removeItem(key);
					await finishPendingOpen(pending);
					setChatImport(null);
				} catch (error) { setError("导入失败：" + String(error.message || error)); }
				finally { setBusy(false); }
			}
			async function newConversation(card, requestedMode, openingId, userName, initialMessage) {
				const targetMode = requestedMode || (uiMode === "play" ? playModeOfCard(card) : "card");
				const startedAt = Date.now();
                const timing = openingPerformance.begin("startClick");
                let successful = false;
				const previousOpeningPicker = openingPicker;
                let created = null;
				const transitionOpening = previousOpeningPicker && previousOpeningPicker.openings ? previousOpeningPicker.openings.filter(function (item) { return item.id === openingId; })[0] : null;
				tavernSessionTransition.begin({ projection: transitionOpening && transitionOpening.projection, trustedCardMode: previousOpeningPicker && previousOpeningPicker.trustedCardMode === true });
				setBusy(true); setError("");
				try {
					const resolvedUserName = String(userName || "你").trim() || "你";
					let preparedWorkspaceId = "";
					try { preparedWorkspaceId = await timing.measure("claimPrewarm", () => playPrewarmRef.current.claim(card && card.path)); }
					catch (prewarmError) { console.warn("dsh-tavern: 工作区预热不可用，改为正常创建", prewarmError); }
					created = await conversationLifecycle.start({ kind: "play", targetMode: targetMode, card: card, preparationId: previousOpeningPicker && previousOpeningPicker.preparationId || "", openingId: openingId || "", userName: resolvedUserName, requestMode: compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh", preparedWorkspaceId: preparedWorkspaceId });
					if (initialMessage) await timing.measure("submitInitialMessage", () => props.executeSlash("/send " + substituteTavernIdentityMacros(initialMessage, { playerName: resolvedUserName, characterName: card && card.name }) + "|/trigger", created.sessionId));
					if (targetMode !== "card") window.localStorage.setItem("dsh-tavern-player-name", resolvedUserName);
					successful = true;
					console.info("dsh-tavern: 开始游戏完成", (Date.now() - startedAt) + "ms", preparedWorkspaceId ? "工作区已就绪" : "即时创建");
				} catch (err) { if (!created) setOpeningPicker(previousOpeningPicker); setError((created ? "游戏已创建，开局消息发送失败：" : String(err && err.phase || "创建对话") + "失败：") + String(err && err.message || err)); if (initialMessage) throw err; }
				finally { timing.finish(successful); tavernSessionTransition.end(); setBusy(false); }
			}
			async function preparePlayConversation(card) {
				setBusy(true); setError("");
                const timing = typeof openingPerformance !== "undefined" ? openingPerformance.begin("preparePreview") : null;
                let successful = false;
				playPrewarmRef.current.begin({ key: card.path, kind: "play" });
				try {
					const globalSettings = await rpc("getTavernSettings");
                    const userName = globalSettings.settings?.defaultPlaySettings?.playerName || "你";
					const preparedKey = JSON.stringify([userName, compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh"]);
					setOpeningPicker({ card: card, requestMode: requestMode, openings: [], index: 0, userName: userName, preparing: true });
					const response = await initializeFullOpeningTemplate(await call("getCardOpenings", { previewTransport: "deferred-v1", path: card.path, userName: userName, requestMode: compatibilityAvailable && requestMode === "sillytavern" ? "sillytavern" : "dsh" }));
					const openings = response.openings || [];
					setOpeningPicker({ card: card, requestMode: requestMode, preparing: false, preparedKey: preparedKey, preparationId: response.preparationId || "", openings: openings, index: 0, userName: userName, trustedCardMode: response.trustedCardMode });
				successful = true;
				} catch (err) { setOpeningPicker(null); playPrewarmRef.current.cancel(); setError(String(err && err.message || err)); }
				finally { if (timing) timing.finish(successful); setBusy(false); }
			}
			async function importCard(file) {
				setBusy(true); setError("");
				try { const payload = await parseCardFile(file); await call("importCard", { payload: payload }); await refresh(); notifyDataChanged(["cards"]); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
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
			async function switchMode(nextMode) {
				playPrewarmRef.current.cancel();
				setUiMode(nextMode); setPicking(false); setMenuSession(null);
				const first = history.filter(function (item) {
					if (groupOfMode(item.mode) !== nextMode) return false;
					if (nextMode !== "play") return true;
					return (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
				})[0];
				if (first) {
					try { await openSessionWhenReady(first.sessionId); }
					catch (err) { setError("打开 Session 失败：" + String(err && err.message || err)); }
				}
				else if (nextMode === "card") openPicker();
				else openPicker();
			}
			async function switchPlayRequestMode(nextRequestMode) {
				if (!compatibilityAvailable && nextRequestMode === "sillytavern") return;
				playPrewarmRef.current.cancel();
				setUiMode("play"); setPicking(false); setMenuSession(null); setBusy(true); setError("");
				setRequestMode(nextRequestMode);
				window.localStorage.setItem("dsh-tavern-request-mode", nextRequestMode);
                if (openingPicker && (openingPicker.requestMode || "dsh") === nextRequestMode) {
                    setPicking(true); setBusy(false); return;
                }
				try {
					const target = history.filter(function (item) {
						return isPlayMode(item.mode) && (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === nextRequestMode;
					})[0];
					if (!target) { props.sessions.clear(); openPicker(); return; }
					if (target.sessionId !== current) await openSessionWhenReady(target.sessionId);
				} catch (err) { setError("切换对话列表失败：" + String(err && err.message || err)); }
				finally { setBusy(false); }
			}
            async function rescueConversation(item) {
                if (busy || !await askConfirm("存档救援：仅在旧对话无法继续使用时操作。\n\n迁移玩家输入和剧情正文，并携带最后可用的 MVU 快照继续更新状态。快照可能落后于正文，迁移后请核对数值；MVU 卡缺少有效快照时会停止救援。新对话按故事模式继续，不恢复旧剧本进度。导入的历史不能回退或重新生成。原存档保留。\n\n确定迁移剧情到新对话？")) return;
                setBusy(true); setError(""); setMenuSession(null);
                const key = "dsh-tavern:rescue:" + item.chatId;
                try {
                    await playPrewarmRef.current.cancel();
                    let attempt;
                    try { attempt = JSON.parse(localStorage.getItem(key) || "null"); } catch (_) {}
                    if (!attempt) {
                        const workspaceId = await playWorkspaceResolverRef.current();
                        attempt = { operationId: window.crypto.randomUUID(), sessionId: await props.conversationHost.connectWorkspace(workspaceId) };
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
				const title = await askTavernText({ title: "重命名对话", initialValue: currentTitle || item.cardName + "的新对话", maxLength: 80 });
				if (title === null || title === currentTitle) return;
				setBusy(true); setError("");
				try { await props.renameSession(item.sessionId, title); await refresh(); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function deleteConversation(item, currentTitle) {
				setMenuSession(null);
				if (!await askConfirm("确定删除对话“" + (currentTitle || item.cardName + "的新对话") + "”吗？\n删除后将从酒馆历史中移除。")) return;
				setBusy(true); setError("");
				try {
					const prepared = await call("prepareDeleteChats", { chatIds: [item.chatId] });
					if (!prepared.results[0].ok) throw new Error(prepared.results[0].error);
					try { await props.archiveSession(item.sessionId); }
					catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
					await call("deleteChat", { chatId: item.chatId });
					if (current === item.sessionId) {
						const next = history.filter(function (entry) {
							if (entry.sessionId === item.sessionId || groupOfMode(entry.mode) !== uiMode) return false;
							if (uiMode !== "play") return true;
							return (entry.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
						})[0];
						if (next) await openSessionWhenReady(next.sessionId);
						else { props.sessions.clear(); openPicker("cards"); }
					}
					await refresh();
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function forkConversation(item, currentTitle, turn) {
				setMenuSession(null);
				setBusy(true); setError("");
				let targetSessionId = "";
				let forkCreated = false;
				try {
					const plan = await call("prepareConversationFork", { chatId: item.chatId, sessionId: item.sessionId, turn: Number(turn) || 0 });
					targetSessionId = await props.conversationHost.forkSession(item.sessionId, plan.atSeq);
					await call("forkChat", {
						chatId: item.chatId,
						sessionId: item.sessionId,
						targetSessionId: targetSessionId,
						turn: plan.turn, sourceRevision: plan.sourceRevision, atSeq: plan.atSeq
					});
					forkCreated = true;
					const forkTitle = (currentTitle || item.cardName + "的新对话") + " · 分支";
					try { await props.renameSession(targetSessionId, forkTitle); }
					catch (renameError) { console.warn("dsh-tavern: 分叉已创建，但自动命名失败", renameError); }
					const pending = { sessionId: targetSessionId, targetMode: item.mode };
					setPendingOpen(pending);
					await finishPendingOpen(pending);
				} catch (err) {
					if (targetSessionId && !forkCreated) {
						try { await props.archiveSession(targetSessionId); }
						catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) console.warn("dsh-tavern: 清理分叉目标 Session 失败", archiveError); }
					}
					setError("分叉对话失败：" + String(err && err.message || err));
				} finally { setBusy(false); }
			}
			React.useEffect(function () {
				return tavernConversationForkRequests.bind(function (request) {
					if (busy) throw new Error("当前有其他操作正在进行，请稍后再分叉");
					const item = history.find(function (entry) { return entry.sessionId === request.sessionId && isPlayMode(entry.mode); });
					if (!item) throw new Error("找不到当前游玩存档");
					const summary = summaries[item.sessionId];
					const title = item.title || (summary && summary.displayTitle ? summary.displayTitle : item.cardName + "的新对话");
					return forkConversation(item, title, request.turn);
				});
			}, [history, summaries, busy]);
			async function checkUpdate() {
				const status = updateStatusRef.current;
				if (updateActionRef.current.pending || isUpdateBusy(status) || ["restart-required", "installed-restart-required", "package-managed"].includes(status.phase)) return;
				updateActionRef.current.pending = true;
				updateActionRef.current.generation += 1;
				publishUpdateStatus({ ...status, phase: "checking", host: status.host || "cli", checkedAt: Date.now(), error: "" });
				try {
					const result = await callUpdate("checkUpdate");
					if (result && result.status) publishUpdateStatus(result.status);
				} catch (err) {
					publishUpdateStatus({ ...status, phase: "check-failed", host: status.host || "cli", error: String(err && err.message || err) });
					tavernErrorHub.report("检查更新", err);
				} finally {
					updateActionRef.current.pending = false;
					updateActionRef.current.generation += 1;
				}
			}
			async function performUpdate() {
				const status = updateStatusRef.current;
				if (updateActionRef.current.pending || !["update-available", "repair-required"].includes(status.phase)) return;
				// Lock before opening the confirmation so repeated clicks cannot launch two requests.
				updateActionRef.current.pending = true;
				updateActionRef.current.generation += 1;
				try {
					const repairing = status.phase === "repair-required";
					if (!await askConfirm(repairing
						? "将重新安装当前构建以修复上次未完成的更新，期间会短暂断开。人物卡、资料和对话数据会保留。\n确定修复安装吗？"
						: "更新期间会短暂断开，人物卡、资料和对话数据不会受到影响。\n确定更新到 GitHub 最新版吗？")) return;
					updateStartedAtRef.current = Date.now();
					updateRecoveryRef.current = { sawOffline: false, reloading: false };
					publishUpdateStatus({ ...status, phase: "running", host: status.host || "cli", startedAt: updateStartedAtRef.current, cancellable: false, error: "" });
					const result = await callUpdate("startUpdate");
					if (result && result.status) publishUpdateStatus(result.status);
				} catch (err) {
					// A lost response does not prove that the installer stopped. Let the read-only poll reconcile it.
					publishUpdateStatus({ ...updateStatusRef.current, error: "更新请求结果尚未确认，正在核实状态：" + String(err && err.message || err) });
					tavernErrorHub.report("插件更新", err);
				} finally {
					updateActionRef.current.pending = false;
					updateActionRef.current.generation += 1;
				}
			}
			async function cancelUpdate() {
				const status = updateStatusRef.current;
				if (updateActionRef.current.pending || status.phase !== "running" || status.cancellable !== true) return;
				updateActionRef.current.pending = true;
				updateActionRef.current.generation += 1;
				publishUpdateStatus({ ...status, phase: "cancelling", error: "" });
				try {
					const result = await callUpdate("cancelUpdate");
					if (result && result.status) publishUpdateStatus(result.status);
				} catch (err) {
					publishUpdateStatus({ ...updateStatusRef.current, error: "取消请求结果尚未确认，正在核实状态：" + String(err && err.message || err) });
					tavernErrorHub.report("取消更新", err);
				} finally {
					updateActionRef.current.pending = false;
					updateActionRef.current.generation += 1;
				}
			}
			const h = React.createElement;
			const collapsedSidebar = collapsed ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-sidebar collapsed" },
					h("button", { className: "dsh-tavern-side-icon", title: "新建对话（跟随当前模式）", onClick: function () { props.toggleSidebar(); window.setTimeout(function () { openPicker("cards"); }, 180); } }, "＋")
				)
			) : null;
			const visibleHistory = history.filter(function (item) {
				if (groupOfMode(item.mode) !== uiMode) return false;
				if (uiMode !== "play") return true;
				return (item.requestMode === "sillytavern" ? "sillytavern" : "dsh") === requestMode;
			});
			// Deleting a card elsewhere may remove the chat open here; never leave it on screen.
			removedChatsHandler.current = function (sessionIds) {
				if (!sessionIds.includes(current)) return;
				props.sessions.clear();
				const next = visibleHistory.find(function (item) { return !sessionIds.includes(item.sessionId); });
				if (next) openSessionWhenReady(next.sessionId).catch(function (err) { setError(String(err && err.message || err)); });
				else openPicker("cards");
			};
			function renderHistoryRow(item) {
				const summary = summaries[item.sessionId];
				const title = item.title || (summary && summary.displayTitle ? summary.displayTitle : (item.cardName + "的新对话"));
				return h("div", { key: item.sessionId, className: "dsh-tavern-side-row" + (current === item.sessionId ? " active" : "") },
					managing ? h("input", { type: "checkbox", checked: selectedChats.includes(item.chatId), disabled: busy, "aria-label": "选择对话：" + title, onChange: function () { toggleChatSelection(item.chatId); } }) : null,
					h("button", { className: "dsh-tavern-side-row-main", disabled: busy, onClick: async function () {
					if (managing) { toggleChatSelection(item.chatId); return; }
					try {
						if (summary && summary.blank) await call("ensureOpening", { sessionId: item.sessionId });
						await openSessionWhenReady(item.sessionId);
					} catch (err) { setError(String(err && err.message || err)); }
				} },
					h("div", { className: "dsh-tavern-side-row-name" }, title),
					h("div", { className: "dsh-tavern-side-row-meta" }, h("span", null, item.mode === "card" ? (item.cardPath ? ("已创建：" + item.cardName) : "尚未创建正式人物卡") : modeLabel(item.mode || "story")), h("span", null, formatTime(item.createdAt || item.lastOpenedAt || (summary ? summary.updatedAt : item.updatedAt))))
					),
					!managing ? h("button", { className: "dsh-tavern-side-row-more", title: "对话操作", "aria-expanded": menuSession === item.sessionId ? "true" : "false", onClick: function () { setMenuSession(menuSession === item.sessionId ? null : item.sessionId); } }, "⋯") : null,
					!managing && menuSession === item.sessionId ? h("div", { className: "dsh-tavern-side-row-menu" },
						h("button", { disabled: busy, onClick: function () { renameConversation(item, title); } }, "重命名"),
                        isPlayMode(item.mode || "story") ? h("button", { disabled: busy, onClick: () => rescueConversation(item) }, "存档救援") : null,
						h("button", { className: "danger", disabled: busy, onClick: function () { deleteConversation(item, title); } }, "删除")
					) : null
				);
			}
			const rows = uiMode !== "play" ? visibleHistory.map(renderHistoryRow) : groupTavernHistory(visibleHistory, summaries).map(function (group) {
				const expanded = historyGroupState[group.key] === true;
				return h("section", { key: group.key, className: "dsh-tavern-history-group" },
					h("button", { className: "dsh-tavern-history-group-toggle", "aria-expanded": expanded, title: group.path || group.name,
						onClick: function () { setHistoryGroupState(previous => ({ ...previous, [group.key]: !expanded })); setMenuSession(null); }
					}, h("span", { "aria-hidden": true }, expanded ? "▾" : "▸"), h("span", { className: "dsh-tavern-history-group-name" }, group.name), h("span", { className: "dsh-tavern-history-group-count" }, group.items.length)),
					expanded ? h("div", { className: "dsh-tavern-history-group-items" }, group.items.map(renderHistoryRow)) : null);
			});
			const selectedOpening = openingPicker && openingPicker.openings[openingPicker.index];
			const pickerError = error ? h("div", { className: "dsh-tavern-picker-error", role: "alert" },
				h("div", null, error),
				pendingOpen ? h("button", { className: "dsh-tavern-btn", disabled: busy, style: { marginTop: "8px" }, onClick: retryPendingOpen }, "重新连接已创建的 Session") : null
			) : null;
			const importChoice = chatImport && openingPicker && chatImport.cardPath === openingPicker.card.path ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "导入到：" + openingPicker.card.name)),
				h("div", { className: "dsh-tavern-greeting-preview" },
					h("p", null, "文件：" + chatImport.fileName), h("p", null, "共 " + chatImport.preview.count + " 条消息"),
					h("label", null, "玩家称呼", h("input", { value: chatImport.userName, maxLength: 80, disabled: busy, onChange: function (event) { setChatImport(Object.assign({}, chatImport, { userName: event.target.value })); } })),
					h("p", null, "最后一条消息："), h("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, chatImport.preview.lastMessage),
					h("p", null, "将创建独立对话，使用这张人物卡及其关联世界书。"),
					chatImport.preview.warnings.map(function (warning, index) { return h("p", { key: index }, warning); }),
					chatImport.preview.incompatible ? h("label", null, h("input", { type: "checkbox", checked: chatImport.textOnly, disabled: busy, onChange: function (event) { setChatImport(Object.assign({}, chatImport, { textOnly: event.target.checked })); } }), "变量结构不兼容：仅导入正文，使用人物卡初值（也可返回换卡）") : h("p", null, chatImport.preview.hasMvu ? "将恢复 MVU 状态" : "将导入聊天正文")),
				h("div", { className: "dsh-tavern-picker-foot" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setChatImport(null); setError(""); } }, "返回"),
					h("button", { className: "dsh-tavern-question-primary", disabled: busy || Boolean(pendingOpen) || (chatImport.preview.incompatible && !chatImport.textOnly), onClick: importConversation }, busy ? "正在导入…" : "导入并打开"))) : null;
			const openingChoice = openingPicker ? h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: discardOpening }, "放弃开局"), h("span", null, openingPicker.card.name + " · 游戏准备"), h("button", { className: "dsh-tavern-btn", "aria-expanded": !openingSettingsCollapsed, onClick: function () { openingSettingsManual.current = true; setOpeningSettingsCollapsed(function (value) { return !value; }); } }, openingSettingsCollapsed ? "展开设置" : "折叠设置"), h("span", { className: "dsh-tavern-spacer" }), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: closePicker }, "暂时收起")),
				busy ? h("div", { className: "dsh-tavern-session-switching", role: "status", "aria-live": "polite" }, openingPicker.preparing ? "正在准备开场与脚本资源…" : "正在完成游戏初始化…", openingPicker.preparing ? h("div", { style: { marginTop: "8px", fontSize: "13px", opacity: .75 } }, "首次打开可能需要下载资源，请稍候；后续打开通常更快。") : null) : null,
					selectedOpening ? h("div", { hidden: openingSettingsCollapsed },
						h("label", { className: "dsh-tavern-player-name" }, h("span", null, "故事中的玩家称呼（可选）"), h("input", { value: openingPicker.userName ?? "", maxLength: 80, placeholder: "你", disabled: busy, onChange: function (event) { const userName = event.target.value; setOpeningPicker(function (current) { return current ? Object.assign({}, current, { userName: userName }) : current; }); } })),
						h("div", { className: "dsh-tavern-player-name-help" }, "可以填写姓名、昵称或身份；默认沿用你上次使用的称呼，也可以在这里针对本局修改。开场白预览会随之更新。")
					) : null,
				openingPicker.openings.length > 1 ? h("div", { className: "dsh-tavern-greeting-nav" },
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "上一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index - 1 + openingPicker.openings.length) % openingPicker.openings.length })); } }, "←"),
					h("div", { className: "dsh-tavern-greeting-count" }, (openingPicker.index + 1) + " / " + openingPicker.openings.length),
					h("button", { className: "dsh-tavern-btn", disabled: busy, "aria-label": "下一条开场白", onClick: function () { setOpeningPicker(Object.assign({}, openingPicker, { index: (openingPicker.index + 1) % openingPicker.openings.length })); } }, "→")
				) : (!openingPicker.preparing && openingPicker.openings.length === 0 ? h("div", { className: "dsh-tavern-side-empty" }, "这张人物卡没有开场白，将从空白场景开始。") : null),
				selectedOpening ? h("div", {
					key: selectedOpening.id,
					className: "dsh-tavern-greeting-preview",
                    style: { pointerEvents: busy ? "none" : undefined },
					role: "region",
					"aria-label": openingPicker.card.name + "开场白预览"
				}, renderTavernProjection(selectedOpening.projection, {
					streaming: false,
					codeLabels: { copyLabel: "复制", copiedLabel: "已复制" },
					mentions: undefined,
					sessionId: "",
					turn: 1,
					helperContext: selectedOpening.helperContext,
                    frameSizing: selectedOpening.frameSizing,
					openingPreview: selectedOpening.openingPreview,
                    onSubmitOpening: function (text) { if (busy || !picking || uiMode !== "play" || collapsed) throw new Error("请返回开局准备页后继续"); return newConversation(openingPicker.card, null, selectedOpening.id, openingPicker.userName || "你", text); },
					onSelectOpening: function (id) {
						if (busy || !picking || uiMode !== "play" || collapsed) throw new Error("请返回开局准备页后继续");
						const index = openingPicker.openings.findIndex(function (opening) { return opening.id === id; });
						if (index < 0) throw new Error("人物卡开场白不存在");
						setOpeningPicker(Object.assign({}, openingPicker, { index: index }));
					},
					trustedCardMode: openingPicker.trustedCardMode
				})) : null,
				h("div", { className: "dsh-tavern-picker-foot", style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "24px", flexWrap: "wrap" } }, h("input", { ref: chatImportFile, type: "file", accept: ".jsonl", style: { display: "none" }, onChange: function (event) { previewChatImport(event.target.files && event.target.files[0]); event.target.value = ""; } }), h("div", { style: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px" } }, h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { chatImportFile.current.click(); } }, "导入 SillyTavern 聊天记录"), h("small", { style: { opacity: .7 } }, "（必须和人物卡匹配）")), h("button", { className: "dsh-tavern-question-primary", disabled: busy || openingPicker.preparing || (openingPicker.openings.length > 0 && !selectedOpening), onClick: function () { newConversation(openingPicker.card, null, selectedOpening ? selectedOpening.id : "", openingPicker.userName || "你"); } }, "开始新游戏"))
			) : null;
			const playPicker = h("div", { ref: openingLayoutRef, className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": openingPicker ? "游戏准备" : "选择人物卡开始游玩" }, pickerError, openingPicker ? h(React.Fragment, null, importChoice, h("div", { style: { display: importChoice ? "none" : "contents" } }, openingChoice)) : h(React.Fragment, null,
				h("div", { className: "dsh-tavern-card-picker-head" }, h("span", null, "选择人物卡 · 开始游玩"), h("span", { className: "dsh-tavern-spacer" }), cardBatch.managing ? null : h("button", { className: "dsh-tavern-btn", disabled: busy || !cards.length, onClick: function () { cardBatch.begin(); } }, "批量管理"), h(MobileCardImportButton, { inputRef: fileRef, disabled: busy, onImported: async function () { await refresh(); notifyDataChanged(["cards"]); } }),
					h("input", { ref: saveImportFile, type: "file", accept: ".dshsave,.zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; event.target.value = ""; if (file) importGameSave(file); } }),
					h("input", { ref: sillyTavernChatFile, type: "file", accept: ".jsonl", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; event.target.value = ""; void chooseSillyTavernChat(file); } }),
					h("div", { className: "dsh-tavern-more-actions dsh-tavern-save-import-menu", ref: saveImportMenu },
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, "aria-haspopup": "menu", "aria-expanded": saveImportMenuOpen, onClick: function () { setSaveImportMenuOpen(function (value) { return !value; }); } }, "导入存档"),
						h("div", { className: "dsh-tavern-more-menu", role: "menu", "aria-label": "导入存档", hidden: !saveImportMenuOpen, onClick: function (event) { if (event.target.closest("button:not(:disabled)")) setSaveImportMenuOpen(false); } },
							h("button", { type: "button", role: "menuitem", disabled: busy, title: "在其他电脑的 DSH Tavern 导出的存档，作为一局新游戏继续玩", onClick: function () { if (saveImportFile.current) saveImportFile.current.click(); } }, "DSH Tavern 存档（.dshsave）"),
							h("button", { type: "button", role: "menuitem", disabled: busy, title: "SillyTavern 导出的聊天记录，需要对应的人物卡", onClick: function () { if (sillyTavernChatFile.current) sillyTavernChatFile.current.click(); } }, "SillyTavern 聊天记录（.jsonl）"))),
					h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				pendingChatImport ? h("div", { className: "dsh-tavern-side-empty", role: "status", style: { padding: "4px 6px", display: "flex", alignItems: "center", gap: "8px" } }, h("span", null, "选择这份 SillyTavern 聊天记录对应的人物卡" + (pendingChatImport.characterName ? "（记录里的角色：" + pendingChatImport.characterName + "）" : "")), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { setPendingChatImport(null); } }, "取消")) : null,
				organization.toolbar(),
				organization.visible.length ? h(React.Fragment, null, h("div", { className: "dsh-tavern-side-empty", style: { padding: "4px 6px" } }, "已绑定剧本的人物卡将自动按剧本推进；未绑定的按自由故事推进。剧本绑定在“卡片模式”中管理。"), organization.renderCards(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
					cardBatch.checkbox(card),
					h("button", { className: "dsh-tavern-card-pick" + (card.hasImage ? " with-image" : "") + (cardBatch.managing && cardBatch.isSelected(card.path) ? " selected" : ""), disabled: busy || (!cardBatch.managing && Boolean(card.readError)), onClick: function () { if (cardBatch.managing) cardBatch.toggle(card.path); else preparePlayConversation(card); } }, h(TavernCardListContent, { showPath: true, card: card, detail: card.script ? ("剧本：" + card.script.title) : "自由故事（未绑定剧本）" }))
				); })) : h("div", { className: "dsh-tavern-empty" }, cards.length ? "没有匹配的人物卡" : "还没有人物卡。\n点“导入人物卡”添加 PNG/JSON 卡片。")
			));

			const cardEditRows = cards.length ? cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick" + (card.hasImage ? " with-image" : ""), disabled: busy, onClick: function () { newCardConversation(card, cardEntry === "gentle" ? "gentle" : "edit", cardEntry === "gentle" ? "人物卡温和改写" : "修改人物卡"); } }, h(TavernCardListContent, { showPath: true, card: card, detail: cardEntry === "gentle" ? "另存温和副本，再配置试玩案例" : "选择这张人物卡开始修改" }))
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡，可先在空白工作台中创建。");
			const cardMvuRows = cards.length ? cards.map(function (card) { return h("div", { key: card.path, className: "dsh-tavern-card-pick-wrap" },
				h("button", { className: "dsh-tavern-card-pick" + (card.hasImage ? " with-image" : ""), disabled: busy, onClick: function () { newCardConversation(card, "mvu", "把人物卡转成 MVU 版"); } }, h(TavernCardListContent, { showPath: true, card: card, detail: "转换为 MVU 后，状态栏绝对不会掉格式" }))
			); }) : h("div", { className: "dsh-tavern-empty" }, "还没有人物卡，可先导入一张需要转换的卡。");
			const chosenInitialResources = Object.keys(selectedInitialResources).map(function (key) { return selectedInitialResources[key]; });
			function initialResourceGroup(title, items) {
				return h(React.Fragment, null,
					h("div", { className: "dsh-tavern-picker-group" }, title + " · " + items.length),
					items.length ? items.map(function (item) {
						const key = item.kind + ":" + item.path;
						const selected = !!selectedInitialResources[key];
						return h("button", { key: item.kind + ":" + item.path, className: "dsh-tavern-card-pick" + (selected ? " selected" : ""), "aria-pressed": selected ? "true" : "false", disabled: busy, onClick: function () { toggleInitialResource(item); } }, h("b", null, (selected ? "✓ " : "") + item.title), h("span", null, item.detail || (item.chunkCount ? item.chunkCount + " 块" : "可作为人物卡参考资料")));
					}) : h("div", { className: "dsh-tavern-side-empty", style: { padding: "8px" } }, "暂无")
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
				input.accept = kind === "worldbook" || kind === "preset" ? ".json,application/json" : ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip";
				input.click();
			}
			const initialResourceTitle = cardEntry === "writing-skill" ? "剧本与素材" : "剧本";
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
				) : h("div", { className: "dsh-tavern-empty" }, "暂无可选" + initialResourceTitle + "，可点击右上角导入。"));
			const initialImportButtons = cardEntry === "resource-edit"
				? h(React.Fragment, null,
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("source"); } }, "导入剧本或素材"),
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("worldbook"); } }, "导入世界书"),
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("preset"); } }, "导入预设")
				)
				: (cardEntry === "writing-skill" || cardEntry === "extract"
					? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: function () { startInitialImport("source"); } }, "导入剧本或素材")
					: null);
			const cardPicker = h("div", { className: "dsh-tavern-card-picker", role: "dialog", "aria-modal": "true", "aria-label": "选择卡片工作台起始任务" }, pickerError,
				h("div", { className: "dsh-tavern-card-picker-head" }, cardEntry ? h("button", { className: "dsh-tavern-btn", onClick: function () { setCardEntry(""); } }, "← 返回") : h("span", null, "选择起始任务"), cardEntry === "writing-skill" ? h("span", null, "选择参考素材（至少 1 份）") : cardEntry === "extract" ? h("span", null, "选择初始剧本（至少 1 份）") : cardEntry === "mvu" ? h("span", null, "选择要转换的人物卡") : cardEntry === "resource-edit" ? h("span", null, "选择一个编辑目标") : null, h("span", { className: "dsh-tavern-spacer" }), cardEntry === "edit" || cardEntry === "gentle" || cardEntry === "mvu" ? h(MobileCardImportButton, { inputRef: fileRef, disabled: busy, onImported: async function () { await refresh(); notifyDataChanged(["cards"]); } }) : null, initialImportButtons, h("button", { className: "dsh-tavern-btn", onClick: closePicker }, "关闭")),
				h("input", { ref: fileRef, type: "file", accept: ".png,.json", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importCard(f); e.target.value = ""; } }),
				h("input", { ref: initialImportRef, type: "file", accept: ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importInitialResource(f, initialImportKindRef.current); e.target.value = ""; } }),
					(cardEntry === "edit" || cardEntry === "gentle") ? cardEditRows : cardEntry === "mvu" ? cardMvuRows : cardEntry === "writing-skill" || cardEntry === "extract" || cardEntry === "resource-edit" ? initialResourcePicker : h(React.Fragment, null,
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
			const updateMessage = updateStatus.phase === "package-managed"
				? "关闭酒馆后，在终端重新运行安装命令，再启动 tavern。"
				: updateStatus.phase === "checking"
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
					? "请重启 DSH Desktop 以加载新版插件。"
				: updateStatus.phase === "completed"
					? (updateStatus.host === "desktop"
						? "更新完成，请重启 DSH Desktop。"
						: updateStatus.host === "android"
							? "Android 更新完成，3088 服务已重启；如移动端界面未更新，请重启 DSHA。"
							: "更新完成，请刷新页面。")
					: updateStatus.phase === "failed" || updateStatus.phase === "check-failed"
						? (updateStatus.error || "更新失败，请稍后重试。")
						: "尚未检查更新";
			const currentVersionLabel = updateStatus.currentVersion && updateStatus.currentVersion !== "unknown" ? "v" + updateStatus.currentVersion : "版本未知";
			const currentCommitLabel = (updateStatus.currentCommit || "").slice(0, 7) || "构建未知";
			const updateHostLabel = updateStatus.phase === "package-managed" ? "插件安装版" : updateStatus.host === "desktop" ? "Desktop 版" : (updateStatus.host === "android" ? "Android 版" : "命令行版");
			const checkingOrRunning = isUpdateBusy(updateStatus);
			const cancelSupported = ["running", "cancelling"].includes(updateStatus.phase) && updateStatus.cancellable === true;
			const updateActions = updateStatus.phase === "package-managed"
				? h("details", { className: "dsh-tavern-update-actions" },
					h("summary", { className: "dsh-tavern-update-button" }, "查看更新命令"),
					h("code", { style: { display: "block", overflowWrap: "anywhere", userSelect: "text" } }, updateStatus.updateCommand))
				: updateStatus.phase === "update-available" || updateStatus.phase === "repair-required"
				? h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", onClick: checkUpdate }, "检查更新"),
					h("button", { className: "dsh-tavern-update-button primary", onClick: performUpdate }, updateStatus.phase === "repair-required" ? "修复安装" : "进行更新"))
				: h("div", { className: "dsh-tavern-update-actions" },
					h("button", { className: "dsh-tavern-update-button", disabled: checkingOrRunning || updateStatus.phase === "restart-required" || updateStatus.phase === "installed-restart-required", onClick: checkUpdate }, updateStatus.phase === "checking" ? "正在检查…" : (updateStatus.phase === "running" ? "正在更新…" : (updateStatus.phase === "cancelling" ? "正在取消…" : (updateStatus.phase === "blocked" ? "等待安全停止" : (updateStatus.phase === "installed-restart-required" ? "请手动重启" : (updateStatus.phase === "restart-required" ? "重启 Desktop 后可用" : "检查更新")))))),
					cancelSupported ? h("button", { className: "dsh-tavern-update-button", disabled: updateStatus.phase === "cancelling", onClick: cancelUpdate }, updateStatus.phase === "cancelling" ? "正在取消…" : "取消更新") : null);
			return h(React.Fragment, null, h(TavernErrorCenter), collapsedSidebar, h("div", { className: "dsh-tavern-sidebar", style: { display: collapsed ? "none" : undefined, position: "relative", width: props.embedded ? "100%" : props.width + "px" } },
				h("div", { className: "dsh-tavern-side-head" }, h("div", { className: "dsh-tavern-side-brand dsh-tavern-lockup", role: "img", "aria-label": "DSH Tavern" }), props.embedded ? null : h("button", { className: "dsh-tavern-side-icon", title: "收起侧栏", onClick: props.toggleSidebar }, "◧")),
				h("div", { className: "dsh-tavern-mode-switch" + (compatibilityAvailable ? " compatibility-enabled" : "") },
					h("button", { className: uiMode === "play" && requestMode === "dsh" ? "active" : "", disabled: busy, onClick: function () { switchPlayRequestMode("dsh"); } }, "游玩"),
					h("button", { className: uiMode === "card" ? "active" : "", disabled: busy, onClick: function () { switchMode("card"); } }, "卡片")
				),
				h("button", { className: "dsh-tavern-side-new", disabled: busy, onClick: function () { openPicker(); } }, uiMode === "play" ? (openingPicker ? "继续开局 · " + openingPicker.card.name : requestMode === "sillytavern" ? "＋ 选择人物卡 · 新开silly 对话" : "＋ 选择人物卡 · 新开游玩") : "＋ 新建卡片工作台对话"),
				uiMode === "play" && requestMode === "sillytavern" ? h("div", { className: "dsh-tavern-compatibility-notice" },
					h("strong", null, "silly 模式"),
					h("div", null, "按 SillyTavern 方式组织对话。未选择外部预设时使用内置纯净预设；选择后使用整份外部预设。对话与普通游玩分别保存。")
				) : null,
				h("div", { className: "dsh-tavern-side-title dsh-tavern-history-heading" },
					h("span", null, uiMode === "play" ? (requestMode === "sillytavern" ? "silly 对话" : "游玩历史") : "卡片历史"),
					h("button", { className: "dsh-tavern-history-action", disabled: busy, onClick: function () { setManaging(!managing); setSelectedChats([]); setMenuSession(null); setDeleteNotice(""); } }, managing ? "取消" : "管理")),
				managing ? h("div", { className: "dsh-tavern-history-selection" },
					h("button", { className: "dsh-tavern-history-action", disabled: busy || !visibleHistory.length, onClick: function () { setSelectedChats(visibleHistory.map(function (item) { return item.chatId; })); } }, "全选"),
					h("span", null, "已选 " + visibleHistory.filter(function (item) { return selectedChats.includes(item.chatId); }).length)) : null,
				h("div", { className: "dsh-tavern-side-list" }, rows.length ? rows : h("div", { className: "dsh-tavern-side-empty" }, uiMode === "play" ? (requestMode === "sillytavern" ? "还没有silly 对话。\n选择人物卡开始；未选择外部预设时自动使用内置纯净预设。" : "还没有游玩对话。\n选择人物卡开始；绑定剧本的卡会按剧本推进。") : "还没有卡片工作台对话。\n可以空白开始，再按需添加人物卡和剧本。")),
				managing ? h("button", { className: "dsh-tavern-btn", style: { flexShrink: 0, margin: "8px 12px", color: "#e57373" }, disabled: busy || !visibleHistory.some(function (item) { return selectedChats.includes(item.chatId); }), onClick: deleteSelectedConversations }, busy ? "正在删除…" : "删除所选（" + visibleHistory.filter(function (item) { return selectedChats.includes(item.chatId); }).length + "）") : null,
				deleteNotice ? h("div", { role: "status", style: { padding: "4px 12px" } }, deleteNotice) : null,
				!picking && error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, error) : null,
				h("div", { className: "dsh-tavern-update" },
					h("div", { className: "dsh-tavern-update-row" },
						h("div", { className: "dsh-tavern-update-identity", title: "DSH Tavern " + currentVersionLabel + " · " + currentCommitLabel + " · " + updateHostLabel }, "DSH Tavern " + currentVersionLabel + " · " + currentCommitLabel),
						updateActions),
                    h(TavernHostCompatibility),
					updateStatus.phase === "idle" || updateStatus.phase === "loading" ? null : h("div", { className: "dsh-tavern-update-status" + (updateStatus.phase === "failed" || updateStatus.phase === "check-failed" || updateStatus.phase === "blocked" || updateStatus.stalled ? " error" : "") }, updateMessage)
				),
				(openingPicker || (picking && uiMode === "play")) ? h("div", { key: "play-picker", className: "dsh-tavern-picker-overlay", style: { display: picking && uiMode === "play" ? undefined : "none" }, onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, playPicker) : null,
                picking && uiMode === "card" ? h("div", { key: "card-picker", className: "dsh-tavern-picker-overlay", onMouseDown: function (event) { if (event.target === event.currentTarget) closePicker(); } }, cardPicker) : null
			));
		}

		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			const uiConversation = ctx.get("uiConversation") || ctx.get("conversation");
			ctx.effect(function () {
				document.body.classList.add("dsh-tavern-shell-active");
				const releaseLandingStyles = installTavernLandingStyles(document);
				const releaseViewport = installVisualViewportPin(document);
				const releaseBrand = installTavernBrand(document, __TAVERN_BRAND_URLS__);
				return function () {
					releaseBrand();
					releaseViewport();
					releaseLandingStyles();
					document.body.classList.remove("dsh-tavern-shell-active");
				};
			}, "dsh-tavern: shell marker");
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
			ctx.effect(() => slots.inject("sidebar.workspaces", () => slots.register(
				{ name: "sidebar.workspaces", priority: -1 },
				function (props) { return React.createElement(TavernSidebar, Object.assign({}, props, {
					collapsed: !props.wide,
					embedded: true,
					sessions: ctx.sessions,
					workspaces: ctx.workspaces,
					conversationHost: createConversationHostAdapter(ctx),
                    executeSlash: createTavernFrameSlashExecutor(ctx),
					renameSession: async function (sessionId, title) {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === undefined) throw new Error("找不到该对话");
						const result = await session.rename(title);
						if (!result.ok) throw new Error(result.error.message);
						await rpc("renameConversation", { sessionId: sessionId, title: title }, sessionId);
						notifyTavernDataChanged(["sessions"], "conversation.rename");
					},
					archiveSession: function (sessionId) { return ctx.workspaces.archiveSession(sessionId); },
					toggleSidebar: function () { if (props.wide) ctx.layout.toggleSidebar(); else props.expandSidebar(); },
					openConversationSettingsTab: async function (sessionId) { await openTavernSidebarTab(ctx, { type: "dsh-tavern:conversation-settings" }, { sessionId: sessionId }); await openTavernSidebarTab(ctx, { type: "dsh-tavern:status" }, { sessionId: sessionId }); },
					openCardLibraryTab: function (sessionId) { return openTavernSidebarTab(ctx, { type: "dsh-tavern:cards", meta: null }, { sessionId: sessionId }); },
					openPresetLibraryTab: function (sessionId) { return openTavernSidebarTab(ctx, { type: "dsh-tavern:presets" }, { sessionId: sessionId }); },
					openWorldBookLibraryTab: function (sessionId) { return openTavernSidebarTab(ctx, { type: "dsh-tavern:worldbooks" }, { sessionId: sessionId }); },
					openResourcesTab: function (sessionId) { return openTavernSidebarTab(ctx, { type: "dsh-tavern:resources" }, { sessionId: sessionId }); },
					appendMention: input.appendMention,
					injectTaskPrompt: input.injectTaskPrompt,
					cleanWorkspaceDraft: input.cleanWorkspaceDraft
				})); }
			)), "dsh-tavern: Tavern workspace browser");
		}
		return Object.freeze({ register: register });
		}
		const tavernShellFeature = createTavernShellFeatureModule();
