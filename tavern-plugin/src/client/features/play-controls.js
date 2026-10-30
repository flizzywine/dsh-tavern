		function createPlayControlsFeatureModule() {
			const historyProjection = createTurnHistoryProjection();
            const { TavernConversationSettingsTab, TavernConversationSettingsAction } = createConversationSettingsModule({
                React, rpc, useLiveTavernView, useTavernSessionMode, isPlayMode,
                invalidateView: sessionId => liveTavernView.invalidate(sessionId),
                notifyTavernDataChanged,
                UserPreferenceProfileTab, TavernConversationWritingSkills, backgroundModelLabel
            });
			function TavernConversationExportAction(props) {
                // The header only needs session membership. Building a complete
                // Tavern view here delays the button behind templates and history.
                const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
                const available = Boolean(useTavernSessionMode(owner));
                const [busy, setBusy] = React.useState(false);
                const [open, setOpen] = React.useState(false);
                const root = React.useRef(null);
                // 「底部面板」 opens or folds the bottom workbench (collapsed on a phone at load);
                // listed only while it holds tabs, since the host's own toggle is hidden in Tavern.
                const sidebar = props.sidebar;
                const bottom = React.useSyncExternalStore(React.useCallback(listener => sidebar && typeof sidebar.subscribeState === "function" ? sidebar.subscribeState(listener) : () => {}, [sidebar]),
                    () => tavernBottomPanel.tabs(sidebar) ? (tavernBottomPanel.open(sidebar) ? "open" : "closed") : "");
                // on a phone in play the ⋯ also holds the moved top-bar entries (phone-play.js).
                const phone = usePhonePlay(props.sessionId, props.sessions);
                React.useEffect(function () {
                    setOpen(false);
                }, [props.sessionId]);
                React.useLayoutEffect(function () {
                    if (open && phone && root.current) root.current.querySelectorAll(".dsh-tavern-more-menu button").forEach(function (node) { if (!node.closest(".fork-phone-readout")) node.setAttribute("role", "menuitem"); });
                });
                React.useEffect(function () {
                    if (!open) return;
                    // The readout's model and context popovers are portalled to <body>; using them keeps this menu open.
                    function outside(event) { if (!root.current || !root.current.contains(event.target) && !event.target.closest?.(".fork-model-panel, .fork-metrics-popover, .fork-metrics-tooltip")) setOpen(false); }
                    function escape(event) { if (event.key === "Escape") { setOpen(false); root.current?.querySelector("[aria-haspopup]")?.focus(); } }
                    document.addEventListener("pointerdown", outside, true);
                    document.addEventListener("keydown", escape);
                    return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
                }, [open]);
				if (!available) return null;
				async function exportText() {
					setBusy(true);
					try {
						const snapshot = props.sessions.list.getSnapshot();
						const summary = snapshot.byId && snapshot.byId[props.sessionId];
						const result = await rpc("exportConversation", { title: summary && summary.displayTitle || "" }, props.sessionId);
						// With illustrations the Markdown and its pictures arrive together as a zip.
						const blob = result.base64
							? new Blob([Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); })], { type: "application/zip" })
							: new Blob([result.text], { type: "text/markdown;charset=utf-8" });
						downloadTavernBlob(blob, result.filename || "对话记录.md");
					} catch (err) { tavernErrorHub.report("导出故事正文", err); }
					finally { setBusy(false); }
				}
				async function exportSave() {
					setBusy(true);
					try {
						const result = await rpc("exportGameSave", { images: true }, props.sessionId);
						const bytes = Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); });
						downloadTavernBlob(new Blob([bytes], { type: "application/zip" }), result.filename);
					} catch (err) { tavernErrorHub.report("导出存档", err); }
					finally { setBusy(false); }
				}
				async function exportLogs() {
					setBusy(true);
					try {
						const result = await rpc("exportTavernLogs", {}, props.sessionId);
						const bytes = Uint8Array.from(atob(result.base64), function (value) { return value.charCodeAt(0); });
						downloadTavernBlob(new Blob([bytes], { type: "application/zip" }), result.filename);
					} catch (err) { tavernErrorHub.report("导出日志", err); }
					finally { setBusy(false); }
				}
				const exportItems = [
                        React.createElement("button", { key: "save", type: "button", role: "menuitem", disabled: busy, title: "导出这一局的存档，可在其他电脑的酒馆里导入继续玩", onClick: exportSave }, "存档"),
                        React.createElement("button", { key: "logs", type: "button", role: "menuitem", "data-tavern-log-export": "", disabled: busy, "aria-label": "日志", title: "下载 Session、MVU、生图与更新日志；含私人剧情，分享前请检查隐私", onClick: exportLogs }, "日志（用于排查错误）"),
                        React.createElement("button", { key: "text", type: "button", role: "menuitem", disabled: busy, title: "导出玩家与角色正文的 Markdown；有配图时连同图片打包为 zip", onClick: exportText }, "故事正文")];
                const bottomItem = bottom ? React.createElement("button", { key: "bottom", type: "button", role: "menuitemcheckbox", "aria-checked": bottom === "open", title: "底部面板", onClick: function () { tavernBottomPanel.toggle(); } }, bottom === "open" ? "收起底部面板" : "底部面板") : null;
				return React.createElement("div", { className: "dsh-tavern-more-actions dsh-tavern-export-menu", ref: root },
                    React.createElement("button", { type: "button", className: "dsh-tavern-export-action", "aria-haspopup": "menu", "aria-expanded": open, "aria-busy": busy, "aria-label": "更多", title: phone ? "更多" : "更多：导出存档、日志、纯对话 TXT", "data-fork-more": "", onClick: function () { setOpen(value => !value); } }, busy ? "…" : "⋯"), // low-frequency, folded behind ⋯
                    React.createElement("div", { className: "dsh-tavern-more-menu" + (phone ? " fork-phone-more-menu" : ""), role: "menu", "aria-label": phone ? "更多" : "导出", hidden: !open, onKeyDown: phone ? phoneModMenuKeys : undefined,
                        onClick: function (event) { if (event.target.closest("button:not(:disabled)") && !event.target.closest("[data-keep-open]")) setOpen(false); } },
                        phone ? React.createElement(PhonePlayMoreItems, { open, sessionId: props.sessionId, exportItems, extraItems: bottomItem, renderSlot: open ? props.renderSlot : null, openStatus: function () { props.openStatus(owner); } })
                            : React.createElement(React.Fragment, null, exportItems, bottomItem)
                    ));
            }

			function TavernCompactionAction(props) {
				const [busy, setBusy] = React.useState(false);
				const [resultLabel, setResultLabel] = React.useState("");
				const [resultTitle, setResultTitle] = React.useState("");
				const running = props.useSession(function (snapshot) { return snapshot.running; });
				// all button instances share foreground + background progress.
				const compaction = useCompactionState(props.sessionId);
				const compacting = busy || compaction.running;
				async function compactContext() {
					if (compacting || running) return;
					setBusy(true);
					setResultLabel("");
					setResultTitle("");
					compactionRuns.set(props.sessionId, { phase: "running" }); // joint toolbar progress
					try {
                        const response = await rpc("runCompaction", {}, props.sessionId);
                        const operation = response.result;
                        if (!operation) throw new Error("当前会话不支持剧情压缩");
                        setResultTitle(compactionProgressTitle(operation));
                        if (operation.status !== "completed") throw new Error("上下文压缩未全部完成。" + compactionProgressTitle(operation));
                        setResultLabel(operation.backgroundSessionId ? "前台和后台已压缩" : "前台已压缩");
						compactionRuns.set(props.sessionId, null);
					} catch (err) { compactionRuns.set(props.sessionId, { phase: "failed", message: String(err && err.message || err) }); }
					finally { setBusy(false); liveTavernView.invalidate(props.sessionId); }
				}
				const progress = compactionProgressTitle(compaction.operation);
				const title = compacting ? "压缩中…" + (progress ? " " + progress : "") : resultTitle || progress || "压缩上下文";
				return React.createElement("button", { className: props.inMenu ? "" : "dsh-tavern-choice-trigger", role: props.inMenu ? "menuitem" : undefined, disabled: compacting || running, "aria-busy": compacting, "aria-label": compacting ? "压缩中…" : "压缩上下文", title: title, onClick: compactContext }, compacting ? "压缩中…" : (resultLabel || "压缩上下文"));
			}

			// @include modules/story-ledger.js

			// @include modules/mvu-variables.js

			// @include script-navigation.js

        function TavernSaveUpgrade(props) {
            const [state, setState] = React.useState(null);
            const [error, setError] = React.useState("");
            const [started, setStarted] = React.useState(false);
            const [requestBusy, setRequestBusy] = React.useState(false);
            const [refresh, setRefresh] = React.useState(0);
            React.useEffect(function () {
                let disposed = false, timer;
                async function read() {
                    try {
                        const next = await rpc("getSaveUpgrade", {}, props.sessionId);
                        if (disposed) return;
                        setState(next); setError("");
                        if (next.phase === "running") timer = setTimeout(read, 1000);
                        else if (next.phase === "completed" && started) liveTavernView.invalidate(props.sessionId);
                    } catch (err) { if (!disposed) setError(String(err.message || err)); }
                }
                read();
                return function () { disposed = true; clearTimeout(timer); };
            }, [props.sessionId, refresh, started]);
            async function migrate() {
                if (requestBusy || state?.phase === "running") return;
                setRequestBusy(true); setError("");
                try {
                    await rpc("upgradeSave", {}, props.sessionId);
                    setStarted(true); setRefresh(value => value + 1);
                } catch (err) { setError(String(err.message || err)); }
                finally { setRequestBusy(false); }
            }
            if (!state && !error || state?.storage === "current" && state?.sessions?.ready) return null;
            const h = React.createElement;
            const busy = requestBusy || state?.phase === "running";
            const stage = {sessions:"正在检查会话日志迁移…",reading:"正在读取剧情与变量…",converting:"正在迁移存储并读回存档…",verifying:"正在校验剧情、变量和历史版本…"}[state?.stage] || "正在迁移…";
            return h("section", {className:"dsh-tavern-status-section", "aria-label":"存档迁移"},
                h("div", {className:"dsh-tavern-status-label"}, "存档迁移"),
                h("div", {className:"dsh-tavern-status-empty"}, "统一迁移本局的会话日志与剧情存储，保留正文、变量、分支和历史版本。旧文件保留原样；迁移后的新进度写入新版存档。"),
                busy ? h("div", {role:"status"}, stage + " 大存档可能需要较长时间，暂时不要关闭或重启酒馆。") : null,
                error || state?.phase === "failed" ? h("div", {className:"dsh-card-error",role:"alert"}, error || state.error) : null,
                state?.sessions?.warning && state.phase !== "failed" ? h("div", {className:"dsh-tavern-status-empty",role:"note"}, state.sessions.warning) : null,
                state?.phase === "failed" && !state.sessions?.ready ? h("div", {className:"dsh-tavern-status-empty"}, "这局的旧会话日志暂时无法升级，原档已保留。请点「导出诊断文件」，把文件发给开发者（不含剧情正文）；修复发布后更新酒馆即可自动升级。想先接着玩，可以在左侧对话菜单「⋯」里用「存档救援」把剧情转到新对话。") : null,
                state?.phase === "failed" && !state.sessions?.ready ? h("button", {type:"button",className:"dsh-tavern-btn",onClick:() => downloadSessionDiagnostics({}, props.sessionId).catch(err => setError("导出诊断文件失败：" + String(err.message || err)))}, "导出诊断文件") : null,
                !state ? h("button", {className:"dsh-tavern-btn",onClick:()=>setRefresh(value=>value+1)}, "重新检查存档迁移") :
                h("button", {type:"button",className:"dsh-tavern-btn",disabled:busy || props.busy,onClick:migrate}, busy ? "迁移中…" : state.phase === "failed" ? "重试迁移" : "迁移存档"),
                !busy && props.busy ? h("div", {className:"dsh-tavern-status-empty"}, "请等待本轮游玩和后台结算完成后再迁移。") : null
            );
        }

			function TavernStatusPanel(props) {
				const [designRemoving, setDesignRemoving] = React.useState("");
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const [error, setError] = usePersistentError("酒馆状态");
			const [guideDraft, setGuideDraft] = React.useState("");
			const guideInputRef = React.useRef(null);
			const [guideBusy, setGuideBusy] = React.useState(false);
            const [guideNotice, setGuideNotice] = React.useState("");
			const [guideError, setGuideError] = usePersistentError("Guide");
            const [styleDraft, setStyleDraft] = React.useState("");
            const [styleBusy, setStyleBusy] = React.useState(false);
            const [styleError, setStyleError] = React.useState("");
            const [styleEditing, setStyleEditing] = React.useState(false);
            const [styleExpanded, setStyleExpanded] = React.useState(false);
			const [settlementRetryBusy, setSettlementRetryBusy] = React.useState(false);
			const [cardUpdateBusy, setCardUpdateBusy] = React.useState(false);
            const [cardUpdateError, setCardUpdateError] = React.useState("");
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const stateKey = String(running) + ":" + String(latestMessageId || "");
			const liveState = useLiveTavernView(props.sessionId, stateKey);
			const view = liveState.view;
			const loadState = liveState.phase;
            React.useEffect(function () {
                if (view?.characterDesignTask?.status === "done" && view.characterDesignTask.published?.length) notifyTavernDataChanged(["worldbooks", "cards"], "character-design");
            }, [props.sessionId, JSON.stringify(view?.characterDesignTask?.published || [])]);
			const missingCard = isMissingTavernCardError(liveState.error);
			const debugTurns = view && Array.isArray(view.debugTurns) ? view.debugTurns : [];
			const latestDebugTurn = Number(debugTurns[0] && debugTurns[0].turn) || 0;
			React.useEffect(function () {
				setError(missingCard ? "" : (liveState.error || ""));
			}, [liveState.error, missingCard]);
            const [resourceLinkBusy, setResourceLinkBusy] = React.useState(false);
            const [resourceLinkError, setResourceLinkError] = React.useState("");
            const [resourceBinding, setResourceBinding] = React.useState(null);
            React.useEffect(function () {
                const cardPath = view?.card?.path;
                let active = true, revision = 0;
                setResourceBinding(null); setResourceLinkError("");
                async function refreshBinding() {
                    if (!cardPath) return;
                    const request = ++revision;
                    try {
                        const result = await rpc("getWorldBookBinding", { cardPath }, props.sessionId);
                        if (active && request === revision) setResourceBinding({ cardPath, binding: result.binding });
                    } catch (_) {
                        if (active && request === revision) setResourceBinding({ cardPath, failed: true });
                    }
                }
                function onData(event) { if (tavernDataChangeAffects(event, ["worldbooks", "cards"])) refreshBinding(); }
                refreshBinding();
                window.addEventListener("dsh-tavern-data-changed", onData);
                return () => { active = false; window.removeEventListener("dsh-tavern-data-changed", onData); };
            }, [props.sessionId, view?.card?.path]);
            const currentResourceBinding = resourceBinding?.cardPath === view?.card?.path ? resourceBinding : null;
            const primaryWorldBook = currentResourceBinding?.binding?.books?.[0] || currentResourceBinding?.binding;
            const noWorldBook = currentResourceBinding && !currentResourceBinding.failed && !primaryWorldBook?.source;
            const unavailableWorldBook = primaryWorldBook?.source && !primaryWorldBook.available;
            async function openWorldBookDetail() {
                setResourceLinkBusy(true); setResourceLinkError("");
                try {
                    const result = await rpc("getWorldBookBinding", { cardPath: view.card.path }, props.sessionId);
                    const binding = result.binding?.books?.[0] || result.binding;
                    setResourceBinding({ cardPath: view.card.path, binding: result.binding });
                    if (!binding?.source) { setResourceLinkError("本局人物卡尚未绑定世界书。"); return; }
                    if (!binding.available) { setResourceLinkError("绑定的世界书已不可用，请在人物卡详情中检查绑定。"); return; }
                    props.openStyleTab("dsh-tavern:worldbooks", { worldBookSource: binding.source });
                } catch (err) { setResourceLinkError(String(err && err.message || err)); }
                finally { setResourceLinkBusy(false); }
            }
			async function addGuide() {
				const text = guideDraft.trim();
				if (!text) return;
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("addGuide", { text: text }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
					setGuideDraft("");
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
            async function retryStyleReference() {
                setStyleBusy(true); setStyleError("");
                try {
                    await rpc("retryStyleReference", { guidance: styleDraft.trim() }, props.sessionId);
                    liveTavernView.invalidate(props.sessionId);
                    setStyleDraft(""); setStyleEditing(false); setStyleExpanded(false);
                } catch (err) { setStyleError(String(err && err.message || err)); }
                finally { setStyleBusy(false); }
            }
            async function saveGuideLibrary() {
                if (guideBusy || !(view.guides || []).length) return;
                const name = await askTavernText({ title: "Guide 方案名称", initialValue: "本局 Guide", maxLength: 80 });
                if (!name) return;
                setGuideBusy(true); setGuideError(""); setGuideNotice("");
                try {
                    await rpc("saveGuideLibrary", { name }, props.sessionId);
                    notifyTavernDataChanged(["guide-library"], "guide-library");
                    setGuideNotice("已保存到Guide 库，本局 Guide保持不变。");
                } catch (err) { setGuideError(String(err.message || err)); }
                finally { setGuideBusy(false); }
            }
			async function removeGuide(guide, index) {
				setGuideBusy(true); setGuideError("");
				try {
					await rpc("deleteGuide", guide.id ? { id: guide.id } : { index, expected: guide }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (err) { setGuideError(String(err && err.message || err)); }
				finally { setGuideBusy(false); }
			}
			// Card and world book edits load by themselves; this is a legacy save's manual sync or a retry.
			async function applyUpdatedCard() {
				if (cardUpdateBusy || !view?.cardUpdate || view.cardUpdate.error) return;
				setCardUpdateBusy(true); setCardUpdateError("");
				try { await rpc("applyUpdatedCard", { digest: view.cardUpdate.digest }, props.sessionId); liveTavernView.invalidate(props.sessionId); }
				catch (error) { setCardUpdateError(String(error.message || error)); }
				finally { setCardUpdateBusy(false); }
			}
			async function retrySettlement() {
				if (!view || settlementRetryBusy) return;
				setSettlementRetryBusy(true);
				try {
					await rpc("retrySettlement", { turn: view.settlementTurn }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
				} catch (retryError) { tavernErrorHub.report("重试后台结算", retryError); }
				finally { setSettlementRetryBusy(false); }
			}
			async function removeCharacterDesign(name) {
				if (designRemoving || !await askConfirm("删除人物档案“" + name + "”？会同时移除本局世界书里为它生成的条目（手动改过的条目保留），人物卡的世界书库不变。")) return;
				setDesignRemoving(name);
				try {
					const result = await rpc("removeCharacterDesign", { name: name }, props.sessionId);
					if (result.worldbookEdited) tavernErrorHub.report("删除人物档案", new Error("档案已删除；本局世界书里“" + name + "”的条目被手动改过，已保留，如需移除请到世界书中处理。"));
					liveTavernView.invalidate(props.sessionId);
				} catch (error) { tavernErrorHub.report("删除人物档案", error); }
				finally { setDesignRemoving(""); }
			}
			async function designCharacter(initialValue = "") {
                await askTavernText({ title: "设计人物", description: "设计意见（选填）。留空则根据当前剧情和已有档案设计人物。", initialValue, allowEmpty: true, maxLength: 4000, confirmLabel: "开始设计",
                    onSubmit: async guidance => { await rpc("designCharacter", { guidance }, props.sessionId); liveTavernView.invalidate(props.sessionId); }
                });
            }
            React.useEffect(function () {
                if (!["running", "queued"].includes(view?.characterDesignTask?.status)) return;
                const timer = setInterval(() => liveTavernView.invalidate(props.sessionId), 2000);
                return () => clearInterval(timer);
            }, [props.sessionId, view?.characterDesignTask?.status]);
			function characterDesignTime(ts) {
				if (!ts) return "";
				const date = new Date(ts);
				return (date.getMonth() + 1) + "/" + date.getDate() + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
			}
			const h = React.createElement;
			if (!view) return h("aside", { className: "dsh-tavern-status dsh-tavern-status-dashboard" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "状态栏")),
				h("div", { className: "dsh-tavern-status-body" },
					h("div", { className: "dsh-tavern-status-empty" }, missingCard ? "人物卡已删除，酒馆状态不可用；已有对话仍可查看。" : (loadState === "retrying" ? "正在重新连接酒馆状态…" : (error || (loadState === "loading" ? "正在加载酒馆状态…" : "选择人物卡后，这里会显示持续状态。")))),
					loadState === "retrying" || missingCard ? h("button", { className: "dsh-tavern-btn", onClick: function () { liveTavernView.invalidate(props.sessionId); } }, "重新加载") : null
				)
			);
			if (view.mode === "card") return null;
			// rendering moved to status-panel.js (StatusPanelView).
			return h(StatusPanelView, { view: view, running: running, props: props, guideDraft: guideDraft, setGuideDraft: setGuideDraft, guideBusy: guideBusy, guideError: guideError, guideInputRef: guideInputRef,
				guideNotice, saveGuideLibrary, resourceLinkBusy, currentResourceBinding, noWorldBook, unavailableWorldBook, resourceLinkError, openWorldBookDetail,
                styleDraft, setStyleDraft, styleBusy, styleError, retryStyleReference, styleEditing, setStyleEditing, styleExpanded, setStyleExpanded,
                addGuide: addGuide, removeGuide: removeGuide, cardUpdateBusy: cardUpdateBusy, cardUpdateError: cardUpdateError, applyUpdatedCard: applyUpdatedCard,
				settlementRetryBusy: settlementRetryBusy, retrySettlement: retrySettlement, latestDebugTurn: latestDebugTurn, designCharacter: designCharacter, designRemoving, removeCharacterDesign });
		}

		// @include status-panel.js
		// @include gal-choices.js

		function TavernCardAppDock(props) {
			const slotRef = React.useRef(null);
			const controllerRef = React.useRef(null);
			const presence = React.useSyncExternalStore(tavernCardAppPresence.subscribe, tavernCardAppPresence.inspect);
			React.useEffect(function () {
				if (!slotRef.current) return;
				const controller = createTavernCardAppDock({ document: document, slot: slotRef.current, sessionId: props.sessionId, onChange: tavernCardAppPresence.change });
				controllerRef.current = controller;
				return function () { controllerRef.current = null; controller.dispose(); };
			}, []);
			return React.createElement("section", { className: "dsh-tavern-status-section dsh-tavern-card-app-section", hidden: !presence.attached },
				React.createElement("div", { className: "dsh-tavern-card-app-head" },
					React.createElement("div", { className: "dsh-tavern-status-label" }, "人物卡应用"),
					React.createElement("button", { className: "dsh-tavern-btn", disabled: !presence.attached, onClick: function () { if (controllerRef.current) controllerRef.current.open(); } }, presence.attached ? "打开手机" : "恢复中…")
				),
				presence.recovering ? React.createElement("div", { className: "dsh-tavern-card-app-recovering", role: "status" }, "正在恢复人物卡应用…") : null,
				React.createElement("div", { ref: slotRef, className: "dsh-tavern-card-app-slot" })
			);
		}

		function TavernStatusTab(props) {
			const binding = React.useSyncExternalStore(
				function (listener) { return props.sessions.list.subscribe(listener); },
				function () { return props.sessions.binding(props.sessionId); },
				function () { return props.sessions.binding(props.sessionId); }
			);
			const h = React.createElement;
			if (!binding) return h("aside", { className: "dsh-tavern-status" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "酒馆状态")),
				h("div", { className: "dsh-tavern-status-body" }, h("div", { className: "dsh-tavern-status-empty" }, "正在连接当前会话…"))
			);
			function useSession(selector) {
				return React.useSyncExternalStore(
					function (listener) { return binding.session.subscribe(listener); },
					function () { return selector(binding.session.getSnapshot()); },
					function () { return selector(binding.session.getSnapshot()); }
				);
			}
			const chat = resolveConversationChatBinding(props.uiConversation, binding);
			function useChat(selector) {
				return React.useSyncExternalStore(
					function (listener) { return chat.subscribe(listener); },
					function () { return selector(chat.getSnapshot()); },
					function () { return selector(chat.getSnapshot()); }
				);
			}
			return h(TavernStatusPanel, { sessionId: props.sessionId, useSession: useSession, useChat: useChat, executeSlash: props.executeSlash, openStyleTab: props.openStyleTab });
		}

        const interactions = createPlayInteractionFlow({ rpc, coordinationView, coordination: tavernCoordination,
            applyBodyResult: (sessionId, view, tail) => applyBodyRegenerationResult({ liveTavernView, historyProjection, sessionId, view, tail }),
            reportError: (source, error) => tavernErrorHub.report(source, error),
            bodyErrorText: error => playerErrorText(error, { fallback: "重新生成没有完成" }), timers: window
        });
        const setCandidatePanel = interactions.candidates.set;
        const setCandidateGuidePanel = interactions.guide.set;
        const setRegenPanel = interactions.regeneration.set;
        const { readyCandidatePanel, submitCandidateTask, submitBodyRegeneration } = interactions;
        function useInteractionPanel(store) { return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot); }
        function useCandidatePanel() { return useInteractionPanel(interactions.candidates); }
        function useCandidateGuidePanel() { return useInteractionPanel(interactions.guide); }
        function useRegenPanel() { return useInteractionPanel(interactions.regeneration); }
		// a dismissed candidate failure stays dismissed
		// across a reload; only the latest dismissed task is kept because only the latest round can show one.
		const CANDIDATE_ERROR_DISMISSED_KEY = "dsh-tavern:candidate-error-dismissed";
		function dismissCandidateError(panel) {
			if (panel && panel.taskKey) { try { window.sessionStorage.setItem(CANDIDATE_ERROR_DISMISSED_KEY, panel.taskKey); } catch (_) {} }
			setCandidatePanel(null);
		}
		function candidateErrorDismissed(taskKey) {
			try { return window.sessionStorage.getItem(CANDIDATE_ERROR_DISMISSED_KEY) === taskKey; } catch (_) { return false; }
		}

        // @include gal-regenerate.js

		// A failed turn never committed a story round, so recovering it is not a
		// rollback: remove the interrupted reply and resend the same input, which
		// lets the provider reuse the cached prompt prefix.
		async function submitFailedTurnReplay(sessionId) {
			const res = await rpc("replayTurn", {}, sessionId);
			applyBodyRegenerationResult({ liveTavernView: liveTavernView, historyProjection: historyProjection, sessionId: sessionId, view: res.view, tail: null });
			setRegenPanel(null);
			setCandidatePanel(null);
			setCandidateGuidePanel(null);
			notifyTavernDataChanged(["sessions"], "play-controls");
			tavernCoordination.invalidate(sessionId);
			return res;
		}
		// the stage's 「⚠ 正文生成失败 · 重新生成」 is this same replay.
		function replayFailedStageTurn(sessionId) {
			return submitFailedTurnReplay(sessionId)
				.catch(function (err) { tavernErrorHub.report("重新生成本轮", err); })
				.finally(function () { liveTavernView.invalidate(sessionId); });
		}

		// Clear the failed or stopped latest round back to before it began (story, variables
		// and progress stay as they were) and hand its input back to the box.
		async function withdrawFailedTavernTurn(sessionId, inputActions, currentDraft) {
			const result = await rpc("rollbackTurn", { expectedTurn: null }, sessionId) || {};
			historyProjection.rolledBack(sessionId, result.view);
			setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null);
			const text = String(result.view && result.view.clearedInput || "");
			if (text.trim() !== "") {
				const current = String(currentDraft || "");
				// Never glue the old input onto a new one: sent together, the reply acts out both.
				if (current.trim() === "" || current === text) inputActions.setDraft(text);
				else if (await askTavernConfirm("输入框里已有新的内容。要用撤回的原输入替换它吗？\n\n原输入：" + text, { confirmText: "替换", cancelText: "保留新内容" })) inputActions.setDraft(text);
			}
			return result;
		}

		// Any problem in a game (a card that will not play, wrong display, slowness, a plain question)
		// goes to the debugging Agent in the card workbench, with this game attached as evidence.
		function TavernDebugButton(props) {
			const [busy, setBusy] = React.useState(false);
			const live = useLiveTavernView(props.sessionId, "debug");
			const turn = Number(props.turn) || Number(live.view && live.view.debugTurns && live.view.debugTurns[0] && live.view.debugTurns[0].turn) || 1;
			async function open() {
				if (busy) return;
				setBusy(true);
				try { await openPlayChatDebugWorkspace(props.sessionId, turn); }
				catch (error) { tavernErrorHub.report("交给调试 Agent", error); }
				finally { setBusy(false); }
			}
			return React.createElement("button", { type: "button", role: props.role, className: props.className, disabled: busy, onClick: open,
				title: "卡不能玩、显示异常、太卡太慢，或有疑问：在卡片工作台打开调试 Agent，并附上这一局的记录" }, busy ? "正在打开调试 Agent…" : (props.label || "交给调试 Agent"));
		}

		function CandidateAction(props) {
			const [busy, setBusy] = React.useState(false);
			const candidatePanelState = useCandidatePanel();
			const regenPanelState = useRegenPanel();
			const sessionMode = useTavernSessionMode(props.sessionId);
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const rollbackViewState = useLiveTavernView(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const settlementActive = activity.role === "settlement" && (activity.phase === "pending" || activity.phase === "running");
			const canRollback = rollbackViewState.view && (rollbackViewState.view.canRegenerate ?? rollbackViewState.view.canRollback) === true;
            const clearIncomplete = rollbackViewState.view && rollbackViewState.view.canClearIncompleteReply === true;
			const canReplayFailed = rollbackViewState.view && rollbackViewState.view.canReplayFailedTurn === true;
			// foreground and background compaction run in sequence; block generation until both finish.
			const compacting = Boolean(rollbackViewState.view && rollbackViewState.view.contextCompaction && rollbackViewState.view.contextCompaction.operation && rollbackViewState.view.contextCompaction.operation.status === "running");
			React.useEffect(function () {
				if (!compacting) return;
				const timer = window.setInterval(function () { liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }, 2000);
				return function () {
					window.clearInterval(timer);
					const panel = interactions.candidates.getSnapshot();
					if (panel && panel.sessionId === props.sessionId && panel.phase === "error" && /压缩/.test(String(panel.error || ""))) setCandidatePanel(null);
				};
			}, [compacting, props.sessionId]);
			const candidateTask = activityState.view && activityState.view.task;
			const taskForMessage = candidateTask && candidateTask.kind === "candidate" && candidateTask.input && String(candidateTask.input.messageId || "") === String(props.messageId || "") ? candidateTask : null;
			const taskBusy = !!(taskForMessage && taskForMessage.busy);
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const [replayBusy, setReplayBusy] = React.useState(false);
			const [withdrawBusy, setWithdrawBusy] = React.useState(false);
			const draft = props.useInput(snapshot => snapshot.draft);
			const projectedTaskRef = React.useRef("");
			React.useEffect(function () {
				if (!taskForMessage) return;
				const projection = String(taskForMessage.taskId || "") + ":" + String(taskForMessage.version || 0) + ":" + String(taskForMessage.status || "");
				if (projectedTaskRef.current === projection) return;
				projectedTaskRef.current = projection;
				if (taskForMessage.busy) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
					return;
				}
				if (taskForMessage.status === "succeeded" && taskForMessage.result && taskForMessage.result.candidates) {
					setCandidatePanel(readyCandidatePanel(props.sessionId, props.messageId, taskForMessage.result.candidates));
					setCandidateGuidePanel(null);
					return;
				}
				if (taskForMessage.terminal && !candidateErrorDismissed(projection)) {
					setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], taskKey: projection, error: playerErrorText(taskForMessage.error || "候选生成未完成", { fallback: "候选生成未完成" }) });
				}
			}, [props.sessionId, props.messageId, taskForMessage && taskForMessage.taskId, taskForMessage && taskForMessage.version, taskForMessage && taskForMessage.status]);
			const reconciledActivityRef = React.useRef("");
			React.useEffect(function () {
				if (!activityState.view || activity.busy) return;
				const revision = activity.phase + ":" + String(activityState.view.updatedAt || 0);
				if (reconciledActivityRef.current === revision) return;
				reconciledActivityRef.current = revision;
				// The host list stream already carries running/activity/blank changes; a full
				// session.list rescans every stored Session and cost seconds per turn.
				liveTavernView.invalidate(props.sessionId);
			}, [props.sessionId, activity.phase, activity.busy, activityState.view && activityState.view.updatedAt]);
			async function generate(force, guidance) {
				if (busy || activity.busy) return;
				setBusy(true);
				setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "loading", choices: [], error: "" });
				try {
					await submitCandidateTask(props.sessionId, props.messageId, guidance);
				} catch (err) { tavernErrorHub.report("候选项生成", err); setCandidatePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "error", choices: [], error: playerErrorText(err, { fallback: "候选生成未完成" }) }); }
				finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			function regenerationPanelFor(event, phase) {
				const tail = event && event.currentTarget ? event.currentTarget.closest('[data-chat-flow-kind="turn-tail"]') : null;
				return { sessionId: props.sessionId, phase: phase, guidance: "", text: "", error: "", tail: tail };
			}
			function openRegeneration(event) {
				if (!canRollback || frontRunning || (activity.busy && !settlementActive) || regenBusy) return;
				setCandidatePanel(null);
				setRegenPanel(regenerationPanelFor(event, "input"));
			}
			// A failed tail has nothing to replace: one click clears the
			// interrupted reply and replays the same request, so no guidance box.
			async function replayFailed() {
				if (!canReplayFailed || frontRunning || replayBusy) return;
				setReplayBusy(true);
				try { await submitFailedTurnReplay(props.sessionId); }
				catch (err) { tavernErrorHub.report("重新生成本轮", err); }
				finally { setReplayBusy(false); liveTavernView.invalidate(props.sessionId); }
			}
			// Learned from huajiao1998/dsh-tavern-sqlite-v2: a failed or stopped round can also be
			// dropped entirely, not only replayed.
			async function withdrawFailed() {
				if (!canReplayFailed || frontRunning || replayBusy || withdrawBusy) return;
				setWithdrawBusy(true);
				try { await withdrawFailedTavernTurn(props.sessionId, props.inputActions, draft); }
				catch (err) { tavernErrorHub.report("撤回这条输入", err); }
				finally {
					setWithdrawBusy(false);
					notifyTavernDataChanged(["sessions"], "play-controls");
					liveTavernView.invalidate(props.sessionId);
					tavernCoordination.invalidate(props.sessionId);
				}
			}
			const h = React.createElement;
			const isScript = sessionMode === "script";
			const hasReadyPanel = candidatePanelState !== null && candidatePanelState.sessionId === props.sessionId && candidatePanelState.messageId === props.messageId && candidatePanelState.phase === "ready";
			if (!isPlayMode(sessionMode) || latestMessageId !== props.messageId) return null;
			// only="choices" in the composer, only="regen" under the latest reply.
			return h(React.Fragment, null,
				props.only === "regen" ? null : h("button", { className: "dsh-tavern-choice-trigger", "data-fork-action": hasReadyPanel ? "choices-again" : "choices", "data-busy": (busy || taskBusy || activity.busy || settlementActive) || undefined, "aria-busy": (busy || taskBusy || activity.busy || settlementActive) || undefined, disabled: busy || taskBusy || activity.busy || settlementActive || regenBusy || compacting, title: compacting ? "正在压缩上下文，完成后可生成候选项" : (busy || taskBusy) ? "正在生成候选项…" : settlementActive ? "当前正文正在后台结算，请等待完成" : (activity.busy ? activity.blockReason : (hasReadyPanel ? "重新生成候选项（可先填写意见）" : (isScript ? "手动生成候选项；由于跟随剧本，只有一个推荐候选项" : "手动生成候选项"))), onClick: function () {
					setRegenPanel(null);
					if (hasReadyPanel) {
						const previous = candidatePanelState;
						setCandidatePanel(null);
						setCandidateGuidePanel({ sessionId: props.sessionId, messageId: props.messageId, phase: "input", error: "", previous: previous });
					} else {
						generate(false);
					}
				} }, settlementActive ? "后台结算中…" : (activity.busy ? activity.label : ((busy || taskBusy) ? "生成中…" : (hasReadyPanel ? "重新生成候选项" : "生成候选项")))),
				props.only !== "choices" && (canReplayFailed || canRollback) ? h("button", { className: "dsh-tavern-choice-trigger", "data-fork-action": canReplayFailed ? "replay" : "regen", "data-busy": (replayBusy || regenBusy) || undefined, "aria-busy": (replayBusy || regenBusy) || undefined, disabled: frontRunning || compacting || (!canReplayFailed && activity.busy && !settlementActive) || regenBusy || replayBusy, title: replayBusy ? "正在重放本轮请求…" : regenBusy ? "正在重新生成正文…" : compacting ? "正在压缩上下文，请稍候" : canReplayFailed ? "移除被中断的回复并原样重放本轮请求（复用模型缓存）" : (settlementActive ? "重新生成将取消当前正文的后台结算" : (activity.busy ? activity.blockReason : "可选择填写意见，再重新生成并替换当前正文")), onClick: canReplayFailed ? replayFailed : openRegeneration }, replayBusy ? "重放中…" : regenBusy ? "重生成中…" : canReplayFailed ? "重新生成本轮" : "重新生成正文") : null,
				props.only !== "choices" && canReplayFailed ? h("button", { className: "dsh-tavern-choice-trigger dsh-tavern-withdraw-failed", disabled: frontRunning || replayBusy || withdrawBusy, title: "清除这一轮：恢复到这一轮开始前，此前的剧情和变量不变，原输入放回输入框", onClick: withdrawFailed }, withdrawBusy ? "撤回中…" : "撤回这条输入") : null,
				props.only !== "choices" && canReplayFailed ? h(TavernDebugButton, { sessionId: props.sessionId, className: "dsh-tavern-choice-trigger", label: "交给调试 Agent" }) : null
			);
		}

		function TavernRollbackAction(props) {
			const [rolling, setRolling] = React.useState(false);
			const regenPanelState = useRegenPanel();
			const frontRunning = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const rollbackViewState = useLiveTavernView(props.sessionId, "rollback:" + String(frontRunning) + ":" + String(latestMessageId || ""));
			const activityState = useTavernCoordination(props.sessionId, "rollback:" + String(frontRunning) + ":" + String(latestMessageId || ""));
			const activity = describeTavernActivity(activityState.view && activityState.view.activity);
			const settlementActive = activity.role === "settlement" && (activity.phase === "pending" || activity.phase === "running");
			const canRollback = rollbackViewState.view && rollbackViewState.view.canRollback === true;
            const clearIncomplete = rollbackViewState.view && rollbackViewState.view.canClearIncompleteReply === true;
			const regenBusy = regenPanelState !== null && regenPanelState.sessionId === props.sessionId && regenPanelState.phase === "loading";
			const targetTurn = Number(rollbackViewState.view && rollbackViewState.view.rollbackTargetTurn) || 0;
            const targetLabel = targetTurn > 0 ? "回退第 " + targetTurn + " 轮" : "回退本轮";
			const blocked = rolling || frontRunning || regenBusy || activity.busy || settlementActive;
			async function rollback() {
				if (!canRollback || blocked) return;
				setRolling(true);
				try {
					const result = await rpc("rollbackTurn", { expectedTurn: clearIncomplete ? null : targetTurn }, props.sessionId);
					historyProjection.rolledBack(props.sessionId, result && result.view);
					setCandidatePanel(null);
					setRegenPanel(null);
					setCandidateGuidePanel(null);
					notifyTavernDataChanged(["sessions"], "play-controls");
					if (result && result.view && result.view.rollbackWarning) tavernErrorHub.report("回退提示", new Error(result.view.rollbackWarning));
				} catch (err) {
					tavernErrorHub.report("回退本轮", err);
				} finally { setRolling(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
			}
			if (!canRollback) {
                // While a reply is streaming, the surface has no settled target yet; the
                // server's "not in the message stream" reason would wrongly read as permanent.
                const reason = blocked && !rolling ? "正在生成或后台处理中，完成或停止后才能回退" : rollbackViewState.view && rollbackViewState.view.rollbackUnavailableReason;
                return reason ? React.createElement("button", { type: "button", role: "menuitem", disabled: true, className: "dsh-tavern-menu-unavailable", title: reason },
                    React.createElement("span", null, "回退本轮"),
                    React.createElement("small", null, reason.includes("没有可回退") ? "暂无可回退轮次" : reason)) : null;
            }
			return React.createElement("button", { className: "danger", role: "menuitem", disabled: blocked, title: blocked ? "请等待当前生成或后台处理完成后再回退" : clearIncomplete ? "清除未完成回复，保留已完成剧情" : "删除最近一次用户输入和这段 LLM 输出", onClick: rollback }, rolling ? "处理中…" : clearIncomplete ? "清除未完成回复" : targetLabel);
		}

        function TavernUndoRollbackAction(props) {
            const [busy, setBusy] = React.useState(false);
            const running = props.useSession(function (state) { return state.running === true; });
            const live = useLiveTavernView(props.sessionId, "undo:" + String(running));
            const turn = Number(live.view && live.view.undoRollbackTurn) || 0;
            if (!turn) return null;
            async function undo() {
                if (busy || running) return;
                setBusy(true);
                try {
                    const result = await rpc("undoRollbackTurn", {}, props.sessionId);
                    historyProjection.restored(props.sessionId, result && result.view);
                    setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null);
                    notifyTavernDataChanged(["sessions"], "play-controls");
                } catch (error) { tavernErrorHub.report("撤销回退", error); }
                finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
            }
            return React.createElement("button", { role: "menuitem", disabled: busy || running, onClick: undo,
                title: "恢复第 " + turn + " 轮正文和状态；新的操作会使此恢复点失效" }, busy ? "恢复中…" : "撤销回退（恢复第 " + turn + " 轮）");
        }

        // 每轮消息上的「回退到这一轮」：一次删掉它之后的所有轮次，一次撤销即可全部恢复。
        function TavernRollbackToAction(props) {
            const messageId = String(props.messageId || "");
            const liveState = useScopedLiveTavernView(props.sessionId, "rollback-to:" + messageId, [["mode"], ["canRollback"], ["rollbackTargetTurn"], ["forkTurnsByMessageId", messageId]]);
            const [busy, setBusy] = React.useState(false);
            const view = liveState.view;
            const turn = Number(view && view.forkTurnsByMessageId && view.forkTurnsByMessageId[messageId]) || 0;
            const latest = Number(view && view.rollbackTargetTurn) || 0;
            if (!view || !isPlayMode(view.mode) || view.canRollback !== true || !(turn > 0) || !(latest > turn)) return null;
            async function rollbackTo() {
                if (busy) return;
                if (!await askTavernConfirm("回退到第 " + turn + " 轮？\n\n第 " + turn + " 轮之后的所有输入和正文都会删除，剧情状态回到第 " + turn + " 轮结束时。之后可在菜单里「撤销回退」一次全部恢复。", { confirmText: "回退", cancelText: "取消" })) return;
                setBusy(true);
                try {
                    const result = await rpc("rollbackToTurn", { turn: turn }, props.sessionId);
                    historyProjection.rolledBack(props.sessionId, result && result.view);
                    setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null);
                    notifyTavernDataChanged(["sessions"], "play-controls");
                    if (result && result.view && result.view.rollbackWarning) tavernErrorHub.report("回退提示", new Error(result.view.rollbackWarning));
                } catch (error) { tavernErrorHub.report("回退到这一轮", error); }
                finally { setBusy(false); liveTavernView.invalidate(props.sessionId); tavernCoordination.invalidate(props.sessionId); }
            }
            const label = busy ? "正在回退…" : "回退到这一轮";
            return React.createElement(DshUi.Tooltip, { label: label, side: "bottom" },
                React.createElement("button", { type: "button", className: "dsh-tavern-message-fork dsh-tavern-message-rollback", "aria-label": label, disabled: busy, onClick: rollbackTo },
                    React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
                        React.createElement("path", { d: "M5 5v14" }), React.createElement("path", { d: "M19 12H9m4-5-5 5 5 5" }))));
        }

		const bodyEditPanel = { value: null, listeners: new Set() };
		function setBodyEditPanel(value) {
			bodyEditPanel.value = value;
			bodyEditPanel.listeners.forEach(function (listener) { listener(value); });
		}
		function useBodyEditPanel() {
			const [value, setValue] = React.useState(bodyEditPanel.value);
			React.useEffect(function () { bodyEditPanel.listeners.add(setValue); return function () { bodyEditPanel.listeners.delete(setValue); }; }, []);
			return value;
		}
		function TavernEditBodyAction(props) {
			const [busy, setBusy] = React.useState(false);
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const live = useLiveTavernView(props.sessionId, "edit:" + String(running) + ":" + String(latestMessageId));
			const coordination = useTavernCoordination(props.sessionId, String(running));
			const activity = describeTavernActivity(coordination.view && coordination.view.activity);
			async function openEditor() {
				setBusy(true);
				try {
					const result = await rpc("getBodyEdit", {}, props.sessionId);
					setRegenPanel(null); setCandidatePanel(null); setCandidateGuidePanel(null);
					setBodyEditPanel({ sessionId: props.sessionId, edit: result.edit, texts: result.edit.parts.filter(function (part) { return part.kind === "text"; }).map(function (part) { return part.text; }), busy: false, error: "" });
				} catch (error) { tavernErrorHub.report("编辑正文", error); }
				finally { setBusy(false); }
			}
			if (!live.view || !(live.view.canEditBody ?? live.view.canRollback)) return null;
			return React.createElement("button", { role: "menuitem", disabled: busy || running || activity.busy, onClick: openEditor }, busy ? "读取中…" : "编辑正文");
		}
		function BodyEditPanel(props) {
			const panel = useBodyEditPanel();
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const h = React.createElement;
			// The user-message edit button lives in another feature module; it opens
			// this panel through a page event instead of reaching into this closure.
			React.useEffect(function () {
				function open(event) {
					const detail = event && event.detail ? event.detail : {};
					if (!detail.edit || detail.sessionId !== props.sessionId) return;
					setBodyEditPanel({ sessionId: detail.sessionId, edit: detail.edit, texts: Array.isArray(detail.texts) ? detail.texts : [], busy: false, error: "" });
				}
				window.addEventListener("dsh-tavern-open-body-edit", open);
				return function () { window.removeEventListener("dsh-tavern-open-body-edit", open); };
			}, [props.sessionId]);
			if (!panel || panel.sessionId !== props.sessionId) return null;
			const label = panel.edit.role === "user" ? "编辑这条输入" : "编辑正文";
			const failed = panel.edit.failed === true;
			async function save() {
				setBodyEditPanel(Object.assign({}, panel, { busy: true, error: "" }));
				try {
					const result = await rpc("saveBodyEdit", { token: panel.edit.token, role: panel.edit.role, index: panel.edit.index, turn: panel.edit.turn, seq: panel.edit.seq, texts: panel.texts }, props.sessionId);
					if (result && typeof result.composerText === "string") {
						// A failed turn was withdrawn; hand the edited text back to the composer.
						if (result.view) liveTavernView.setView(props.sessionId, result.view);
						notifyTavernDataChanged(["sessions"], "play-controls");
						tavernCoordination.invalidate(props.sessionId);
						setBodyEditPanel(null);
						if (result.composerText.trim() !== "" && props.inputActions && typeof props.inputActions.setDraft === "function") props.inputActions.setDraft(result.composerText);
						return;
					}
					liveTavernView.setView(props.sessionId, result.view);
					notifyTavernDataChanged(["sessions"], "play-controls");
					tavernCoordination.invalidate(props.sessionId);
					setBodyEditPanel(null);
				} catch (error) { setBodyEditPanel(Object.assign({}, panel, { busy: false, error: String(error.message || error) })); }
			}
			let textIndex = 0;
			return h("div", { className: "dsh-tavern-question fork-body-edit", role: "region", "aria-label": label },
				h("div", { className: "dsh-tavern-question-head" }, h("span", null, label)),
				panel.edit.role === "user" ? h("div", { className: "dsh-tavern-question-sub" }, failed
					? "这是失败轮的输入。保存只改文字，不会自动重试或撤回；之后点「重新生成本轮」会按新文字重发，点「撤回这条输入」会把它放回输入框。"
					: "只改这一条输入，不会自动重写已生成的回复；需要新回复时保存后再点「重新生成正文」。") : null,
				panel.error ? h("div", { className: "dsh-tavern-choice-error", role: "alert" }, panel.error) : null,
				h("div", { style: { maxHeight: "50vh", overflowY: "auto" } }, panel.edit.parts.map(function (part, index) {
					if (part.kind === "html") return h("div", { key: index, className: "dsh-tavern-question-sub" }, "HTML 内容保持原样");
					if (part.kind !== "text") return null;
					const current = textIndex++;
					return h("textarea", { key: index, className: "dsh-tavern-regen-input", "aria-label": "正文文本 " + (current + 1), rows: Math.min(60, Math.max(3, panel.texts[current].split("\n").length)), value: panel.texts[current], disabled: panel.busy, onChange: function (event) {
						const texts = panel.texts.slice(); texts[current] = event.target.value;
						setBodyEditPanel(Object.assign({}, panel, { texts: texts }));
					} });
				})),
				h("div", { className: "dsh-tavern-question-foot" },
					h("button", { className: "dsh-tavern-question-primary", disabled: panel.busy || running, onClick: save }, panel.busy ? "保存中…" : "保存"),
					h("button", { className: "dsh-tavern-question-free", disabled: panel.busy, onClick: function () { setBodyEditPanel(null); } }, "取消")));
		}

        // @include modules/background-wait.js

		function TavernStopBackgroundAction(props) {
			const [busy, setBusy] = React.useState(false);
			const state = useTavernCoordination(props.sessionId);
			const activity = state.view && state.view.activity;
			// The game's own background work only: a director runs beside it and is not stopped here.
			if (!activity || (!activity.busy && activity.phase !== "pending")) return null;
			async function stop() {
				if (busy) return;
				setBusy(true);
				try {
					await rpc("stopBackground", { operationId: activity.operationId }, props.sessionId);
					liveTavernView.invalidate(props.sessionId);
					tavernCoordination.invalidate(props.sessionId);
				} catch (error) { tavernErrorHub.report("停止后台", error); }
				finally { setBusy(false); }
			}
			return React.createElement("button", { type: "button", className: "dsh-tavern-choice-trigger", role: props.inMenu ? "menuitem" : undefined, disabled: busy, onClick: stop }, busy ? "正在停止…" : "停止后台");
		}

        // Manual plugin tasks (tavern.manualTask): one button each, run as an exclusive background task.
        function TavernPluginTasks(props) {
            const h = React.createElement;
            const [tasks, setTasks] = React.useState(null);
            const [starting, setStarting] = React.useState("");
            const [error, setError] = React.useState("");
            const running = Boolean(props.activity?.busy && props.activity.role === "plugin-task");
            const load = React.useCallback(async function () {
                try { setTasks((await rpc("listGamePlugins", {}, props.sessionId)).plugins?.tasks || null); }
                catch (_) { /* The game's own controls stay usable. */ }
            }, [props.sessionId]);
            React.useEffect(function () { void load(); }, [load, running]);
            React.useEffect(function () {
                if (!running) return;
                const timer = setInterval(() => { liveTavernView.invalidate(props.sessionId); void load(); }, 2000);
                return () => clearInterval(timer);
            }, [props.sessionId, running, load]);
            if (!tasks || !tasks.manual.length) return null;
            async function start(task, input) {
                await rpc("startPluginTask", { key: task.key, input }, props.sessionId);
                liveTavernView.invalidate(props.sessionId);
                await load();
            }
            async function run(task) {
                if (task.input) {
                    await askTavernText({ title: task.title, description: task.input.label, placeholder: task.input.placeholder, allowEmpty: true, maxLength: 4000, confirmLabel: "开始", onSubmit: input => start(task, input) });
                    return;
                }
                setStarting(task.key); setError("");
                try { await start(task); }
                catch (err) { setError(String(err.message || err)); }
                finally { setStarting(""); }
            }
            return h("section", { className: "dsh-tavern-status-section" },
                h("div", { className: "dsh-tavern-status-label" }, "插件任务"),
                tasks.running ? h("div", { className: "dsh-tavern-status-empty", role: "status" }, "正在运行：" + tasks.running.title + "（插件 " + tasks.running.plugin + "）") : null,
                h("div", { className: "dsh-tavern-plugin-tasks" }, tasks.manual.map(task => h("button", { key: task.key, type: "button", className: "dsh-tavern-btn",
                    title: task.description || "插件 " + task.plugin, disabled: props.busy || running || Boolean(starting), onClick: () => void run(task) }, starting === task.key ? "启动中…" : task.title))),
                error ? h("div", { className: "dsh-card-error", role: "alert" }, error) : null);
        }

		function TavernMoreActions(props) {
			const [open, setOpen] = React.useState(false);
            const [restoring, setRestoring] = React.useState(false);
			const [placement, setPlacement] = React.useState(null);
			const root = React.useRef(null);
			const trigger = React.useRef(null);
            // Removing cleared notices is a one-way quiet; this puts them back after
            // the player changed their mind (or hid the tail the hard way).
            async function restoreErrorNotices() {
                if (restoring) return;
                setRestoring(true);
                try {
                    const result = await rpc("setAllFailedErrorVisibility", { sessionId: props.sessionId, hidden: false });
                    liveTavernView.setView(props.sessionId, result.view);
                } catch (error) { tavernErrorHub.report("恢复错误提示", error); }
                finally { setRestoring(false); }
            }
			// The mobile composer seat scrolls (overflow-y: auto), which clipped an absolutely
			// positioned menu to a thin strip. Anchor it to the viewport above the trigger instead.
			React.useLayoutEffect(function () {
				if (!open) { setPlacement(null); return; }
				function place() {
					const rect = trigger.current && trigger.current.getBoundingClientRect();
					if (!rect) return;
					const width = document.documentElement.clientWidth || window.innerWidth;
					setPlacement({ position: "fixed", top: "auto", left: "auto", right: Math.max(8, width - rect.right) + "px", bottom: (window.innerHeight - rect.top + 6) + "px", maxHeight: Math.max(120, rect.top - 12) + "px", overflowY: "auto" });
				}
				place();
				window.addEventListener("resize", place);
				if (window.visualViewport) window.visualViewport.addEventListener("resize", place);
				return function () { window.removeEventListener("resize", place); if (window.visualViewport) window.visualViewport.removeEventListener("resize", place); };
			}, [open]);
			React.useEffect(function () {
				if (!open) return;
				function closeOutside(event) { if (!root.current || !root.current.contains(event.target)) setOpen(false); }
				function closeOnEscape(event) { if (event.key === "Escape") setOpen(false); }
				document.addEventListener("pointerdown", closeOutside, true);
				document.addEventListener("keydown", closeOnEscape);
				return function () { document.removeEventListener("pointerdown", closeOutside, true); document.removeEventListener("keydown", closeOnEscape); };
			}, [open]);
			return React.createElement("div", { className: "dsh-tavern-more-actions", ref: root },
				React.createElement("button", { ref: trigger, type: "button", className: "dsh-tavern-choice-trigger", "data-fork-action": "more", title: "更多操作：编辑正文、回退、压缩上下文…", "aria-haspopup": "menu", "aria-expanded": open, onClick: function () { setOpen(function (value) { return !value; }); } }, "更多 ▾"),
				React.createElement("div", { className: "dsh-tavern-more-menu", role: "menu", hidden: !open, style: placement || undefined, onClick: function (event) { if (event.target && event.target.closest && event.target.closest("button:not(:disabled)")) setOpen(false); } },
                    React.createElement(TavernStopBackgroundAction, Object.assign({}, props, { inMenu: true })),
					React.createElement(TavernEditBodyAction, props),
					React.createElement(TavernRollbackAction, props),
                    React.createElement(TavernUndoRollbackAction, props),
                    React.createElement("button", { type: "button", role: "menuitem", disabled: restoring, title: "把已移除或已隐藏的失败提示显示回来，正文和历史不受影响", onClick: restoreErrorNotices }, "恢复全部错误提示"),
					React.createElement(TavernDebugButton, { sessionId: props.sessionId, role: "menuitem", label: "遇到问题？交给调试 Agent" }),
					React.createElement(TavernCompactionAction, Object.assign({}, props, { inMenu: true })))
			);
		}

		// @include variable-receipt.js
		// @include turn-actions.js
		// @include phone-play.js

		// the chat page's 回到最新, in the composer's top-right corner (O37), shown only while
		// scrolled away from the newest message. It replaces the host's 回到底部 (tavern.css hides it), whose own at-bottom
		// flag could stay stale after layout shifts; this one reads the scroller's geometry (jump-latest.js).
		function ChatJumpLatest() {
			const [box, setBox] = React.useState(null);
			const latest = useJumpLatest(box);
			const wrap = React.useCallback(function (node) { setBox(node && node.closest ? node.closest("[data-conversation-scroll]") : null); }, []);
			return React.createElement("span", { ref: wrap, className: "fork-chat-jump-latest" },
				React.createElement(JumpLatest, { skin: "chat", away: latest.away, onJump: latest.jump, focusAfter: function () {
					const input = box && box.querySelector("[data-composer-input]");
					if (input) input.focus({ preventScroll: true });
				} }));
		}

		function CandidateDockActions(props) {
			const address = props.sessions && props.sessions.subagentAddress(props.sessionId);
			const ownerSessionId = address ? address.parentSessionId : props.sessionId;
			const sessionMode = useTavernSessionMode(ownerSessionId);
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const running = props.useSession(function (snapshot) { return snapshot.running === true; });
			const live = useLiveTavernView(ownerSessionId, String(running) + ":" + String(latestMessageId || ""));
			const imageTurn = Number(live.view && live.view.latestAssistantTurn) || 0;
			const h = React.createElement;
			if (!sessionMode) return null;
			// top-level play sessions render these inside the composer (input.left).
			const inline = props.placement === "inline";
			if (inline && (address || !isPlayMode(sessionMode))) return null;
			const compacting = live.view && live.view.contextCompaction && live.view.contextCompaction.operation && live.view.contextCompaction.operation.status === "running";
			const compactionStatus = live.view && live.view.contextCompaction && (compacting || live.view.contextCompaction.warning) ? h("span", { role: "status", className: "dsh-tavern-settings-desc fork-compaction-status" }, compacting ? "正在压缩前后台上下文…" : live.view.contextCompaction.warning,
				// a warning can be dismissed; it otherwise stays until a later compaction succeeds.
				!compacting && live.view.contextCompaction.warning ? h("button", { type: "button", className: "fork-compaction-dismiss", "aria-label": "关闭这条提示", title: "关闭这条提示", onClick: function () {
					rpc("dismissCompactionWarning", { sessionId: ownerSessionId }, ownerSessionId).then(function () { liveTavernView.invalidate(ownerSessionId); }, function (error) { tavernErrorHub.report("关闭压缩提示", error); });
				} }, "×") : null) : null;
			if (!inline && !address && isPlayMode(sessionMode)) return h(CompactionLine, { sessionId: ownerSessionId }); // compaction divider replaces the status text
			if (address) return isPlayMode(sessionMode) ? h("div", { className: "dsh-tavern-dock-actions" }, h(TavernStopBackgroundAction, { sessionId: ownerSessionId })) : null;
			return h("div", { className: "dsh-tavern-dock-actions" + (inline ? " dsh-fork-inline-actions" : ""),
				"data-compacting": live.view && live.view.contextCompaction && live.view.contextCompaction.operation && live.view.contextCompaction.operation.status === "running" || undefined },
				isPlayMode(sessionMode) && latestMessageId ? React.createElement(CandidateAction, Object.assign({}, props, { messageId: latestMessageId }, inline ? { only: "choices" } : null)) : null,
				isPlayMode(sessionMode) && live.view && !live.view.canClearIncompleteReply ? React.createElement(TavernPluginComposerActions, { sessionId: props.sessionId, turn: imageTurn, running: running }) : null,
				// per-round items moved under the latest reply; session-level ones stay here as icons.
				inline && typeof props.openStatus === "function" ? h("button", { type: "button", className: "dsh-tavern-choice-trigger", "data-fork-action": "guide", "data-count": (live.view && live.view.guides || []).length || undefined,
					title: (live.view && live.view.guides || []).length ? "Guide：" + live.view.guides.length + " 条生效中" : "添加 Guide（影响正文、候选与变量结算）",
					onClick: function () { Promise.resolve(props.openStatus()).then(function () { window.setTimeout(function () { window.dispatchEvent(new CustomEvent("dsh-fork-focus-guide")); }, 250); }); } }, "Guide") : null, // the label shows in the phone ＋ menu; the icon toolbar hides button text
				inline ? h("span", { className: "dsh-fork-icon-slot", "data-fork-icon": "compact", title: "压缩上下文" }, React.createElement(TavernCompactionAction, props)) : null,
				inline ? h("span", { className: "dsh-fork-icon-slot", "data-fork-icon": "stop", title: "停止后台任务" }, React.createElement(TavernStopBackgroundAction, Object.assign({}, props, { sessionId: ownerSessionId }))) : null,
				inline ? null : isPlayMode(sessionMode) ? React.createElement(TavernMoreActions, props) : React.createElement(TavernCompactionAction, props),
                inline ? null : compactionStatus
			);
		}

		// the composer's round actions; on a phone in play they sit in the ＋ menu.
		function RoundActionsSeat(props) {
			const phone = usePhonePlay(props.sessionId, props.sessions);
			const actions = React.createElement(CandidateDockActions, props);
			return phone ? React.createElement(PhoneComposerPlus, null, actions) : actions;
		}

        function observeTurnErrorProjection(root, apply, host = window) {
            let frame = null, disposed = false;
            const selector = '[data-chat-flow-kind], [data-turn-tail]';
            function containsRows(node) {
                return node.nodeType === 1 && (node.matches(selector) || !!node.querySelector(selector));
            }
            const observer = new host.MutationObserver(function (records) {
                if (disposed || !records.some(function (record) {
                    if (record.type === "attributes") return true;
                    // Native error contents may replace our controls; prose streaming cannot.
                    if (record.target.closest?.('[data-chat-flow-kind="turn-error"]')) return true;
                    return Array.from(record.addedNodes).some(containsRows) || Array.from(record.removedNodes).some(containsRows);
                })) return;
                if (frame === null) frame = host.requestAnimationFrame(function () {
                    frame = null;
                    if (!disposed) apply();
                });
            });
            observer.observe(root, { childList: true, subtree: true, attributes: true,
                attributeFilter: ["data-chat-flow-kind", "data-chat-flow-key", "data-chat-turn", "data-turn-tail"] });
            return { disconnect() {
                disposed = true; observer.disconnect();
                if (frame !== null) host.cancelAnimationFrame(frame);
                frame = null;
            } };
        }
		// the stage's 停止 while a reply is written. The host stops
		// the run and, when the body has not committed, withdraws the pick through the same failed-tail clearing as
		// 「撤回这条输入」 below (round-history interrupt). Resolves to the view (withdrawn, clearedInput) or null on error.
		async function interruptStageTurn(sessionId) {
			try {
				const result = await rpc("interruptTurn", {}, sessionId);
				const view = result && result.view || null;
				if (view && view.withdrawn) { historyProjection.rolledBack(sessionId, view); setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null); }
				return view;
			} catch (error) { tavernErrorHub.report("停止生成", error); return null; }
			finally {
				notifyTavernDataChanged(["sessions"], "play-controls");
				liveTavernView.invalidate(sessionId);
				tavernCoordination.invalidate(sessionId);
			}
		}
		function SupersededTurnErrors(props) {
			const marker = React.useRef(null);
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const state = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const turns = state.view && state.view.suppressedDshErrorTurns || [];
			const hiddenTurns = state.view && state.view.hiddenDshErrorTurns;
			const replayTurn = state.view && state.view.canReplayFailedTurn ? Number(state.view.replayFailedTurn) || null : null;
			const staleTurns = state.view && state.view.staleDshErrorTurns || [];
			const filteredStreak = Number(state.view && state.view.filteredFailureStreak) || 0;
			// 右侧「轮次导航」只列正文行计划里真的画了正文的轮次；点击时自己滚、缺行时自己往前翻。
			const railPlan = React.useMemo(function () { return state.view ? tavernPlanOf(state.view) : null; }, [state.view && state.view.transcriptTurns, state.view && state.view.transcriptFrom]);
			const railAccept = railPlan ? function (turn) { return tavernPlanShowsRow(railPlan, turn, "reply"); } : null;
			const railKey = railPlan ? JSON.stringify(railPlan) : "";
			const canRewind = !!(state.view && state.view.canRegenerate === true);
			const draft = props.useInput(snapshot => snapshot.draft);
			const draftRef = React.useRef(draft);
			draftRef.current = draft;
			const revision = turns.join(",") + ":" + (Array.isArray(hiddenTurns) ? "saved:" + hiddenTurns.join(",") : "local") + ":" + String(replayTurn || "")
				+ ":" + staleTurns.join(",") + ":" + filteredStreak + ":" + canRewind + ":rail:" + railKey;
			// Clearing a failed tail is the first half of both recovery actions.
			async function clearFailedTail() {
				const result = await rpc("rollbackTurn", { expectedTurn: null }, props.sessionId);
				historyProjection.rolledBack(props.sessionId, result && result.view);
				setCandidatePanel(null); setRegenPanel(null); setCandidateGuidePanel(null);
				return result || {};
			}
			function refreshAfterRecovery() {
				notifyTavernDataChanged(["sessions"], "play-controls");
				liveTavernView.invalidate(props.sessionId);
				tavernCoordination.invalidate(props.sessionId);
			}
			React.useEffect(function () {
				const root = marker.current && marker.current.closest("[data-conversation-scroll]");
				if (!root) return;
				const projection = createSupersededErrorProjection(root);
				const rail = createTurnRailFilter(root);
				const controls = createTurnErrorControls(root, {
                    sessionId: props.sessionId, storage: window.localStorage, hiddenTurns: hiddenTurns, replayTurn: replayTurn,
                    onToggle: !Array.isArray(hiddenTurns) ? undefined : async function (turn, hidden) {
                        const result = await rpc("setFailedErrorVisibility", { sessionId: props.sessionId, turn: turn, hidden: hidden });
                        liveTavernView.setView(props.sessionId, result.view);
                    },
                    // Clearing the stacked line only touches the cleared failures;
                    // the tail failure keeps its replay and withdraw buttons.
                    onRemoveStale: !Array.isArray(hiddenTurns) ? undefined : async function (turns) {
                        const result = await rpc("setAllFailedErrorVisibility", { sessionId: props.sessionId, hidden: true, turns: turns });
                        liveTavernView.setView(props.sessionId, result.view);
                    },
                    onReplay: replayTurn === null ? undefined : async function () {
                        try { await submitFailedTurnReplay(props.sessionId); }
                        catch (error) { tavernErrorHub.report("重新生成本轮", error); }
                        finally { liveTavernView.invalidate(props.sessionId); }
                    },
                    staleTurns: staleTurns, filteredStreak: filteredStreak, canRewind: canRewind,
                    onWithdraw: replayTurn === null ? undefined : async function () {
                        try { await withdrawFailedTavernTurn(props.sessionId, props.inputActions, draftRef.current); }
                        catch (error) { tavernErrorHub.report("撤回这条输入", error); }
                        finally { refreshAfterRecovery(); }
                    },
                    onRewind: replayTurn === null || !canRewind ? undefined : async function () {
                        try {
                            const cleared = await clearFailedTail();
                            const target = Number(cleared.view && cleared.view.rollbackTargetTurn) || null;
                            const result = await rpc("rollbackTurn", { expectedTurn: target }, props.sessionId);
                            historyProjection.rolledBack(props.sessionId, result && result.view);
                            if (result && result.view && result.view.rollbackWarning) tavernErrorHub.report("回退提示", new Error(result.view.rollbackWarning));
                        } catch (error) { tavernErrorHub.report("回退上一轮", error); }
                        finally { refreshAfterRecovery(); }
                    },
                    onError: function (error) { tavernErrorHub.report("保存错误提示状态失败", error); }
                });
				// Settled rounds fold their work-step rows away; the live round keeps its
				// progress, and the error row below owns the one control that brings them back.
				const stepFold = createStepFoldControls(root);
				const apply = function () { projection.apply(turns); controls.apply(); stepFold.apply(); rail.apply({ accept: railAccept }); };
				apply();
				const observer = observeTurnErrorProjection(root, apply);
				return function () { observer.disconnect(); controls.dispose(); stepFold.dispose(); projection.dispose(); rail.dispose(); };
			}, [props.sessionId, revision]);
			return React.createElement("span", { ref: marker, hidden: true, "data-tavern-error-projection": props.sessionId });
		}
		// @include background-suppression.js
		const pollBackgroundSuppression = createBackgroundSuppressionPoller(rpc);
		function TurnHistoryProjection(props) {
			const running = props.useSession(function (snapshot) { return snapshot.running; });
			const latestMessageId = props.useChat(latestTavernAssistantMessageId);
			const suppressionState = useLiveTavernView(props.sessionId, "suppression:" + String(latestMessageId || "") + ":" + String(running));
			const [backgroundTurns, setBackgroundTurns] = React.useState([]);
			const [backgroundRevision, setBackgroundRevision] = React.useState(0);
			React.useEffect(function () { setBackgroundTurns([]); }, [props.sessionId]);
			React.useEffect(function () {
				function changed(event) { if (event.detail?.sessionId === props.sessionId) setBackgroundRevision(value => value + 1); }
				window.addEventListener("dsh-tavern-background-history-changed", changed);
				return function () { window.removeEventListener("dsh-tavern-background-history-changed", changed); };
			}, [props.sessionId]);
			React.useEffect(function () {
				if (!String(props.sessionId || "").startsWith("background-")) return;
				return pollBackgroundSuppression(props.sessionId, running,
					result => setBackgroundTurns(result.turns || []),
					error => console.warn("后台回退显示刷新失败", error));
			}, [props.sessionId, latestMessageId, running, backgroundRevision]);
			// Background Agent sessions have no row plan: their rolled-back turns hide whole.
			const backgroundTurnsRevision = backgroundTurns.join(",");
			// The row plan decides which rows show (Wiki「设计：transcript-row-plan」).
			// Immutable and keyed by turn: a changed plan is a new object, never serialized here.
			const transcriptTurns = suppressionState.view && suppressionState.view.transcriptTurns || null;
			const transcriptFrom = suppressionState.view ? suppressionState.view.transcriptFrom : null;
			React.useEffect(function () {
				let frame = null;
				function applyProjectionState() {
					frame = null;
					historyProjection.apply(props.sessionId, transcriptTurns ? { turns: transcriptTurns, from: transcriptFrom } : null, backgroundTurns);
				}
				function scheduleProjection() {
					if (frame === null) frame = window.requestAnimationFrame(applyProjectionState);
				}
				scheduleProjection();
				// Only chat-row mounts and ownership changes matter; streamed prose and
				// composer edits mutate the page every frame and must not re-scan history.
				const rowSelector = "[data-chat-flow-kind], [data-chat-turn], [data-turn-tail]";
				function touchesRows(node) {
					return node.nodeType === 1 && (node.matches(rowSelector) || !!node.querySelector(rowSelector));
				}
				const observer = new window.MutationObserver(function (records) {
					if (records.some(function (record) {
						return record.type === "attributes" || Array.from(record.addedNodes).some(touchesRows) || Array.from(record.removedNodes).some(touchesRows);
					})) scheduleProjection();
				});
				observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-chat-flow-kind", "data-chat-turn", "data-turn-tail"] });
				return function () { observer.disconnect(); if (frame !== null) window.cancelAnimationFrame(frame); };
			}, [props.sessionId, latestMessageId, running, backgroundTurnsRevision, transcriptTurns, transcriptFrom]);
			return null;
		}
        const { CandidateQuestion, CandidateGuidePanel, RegenPanel } = createPlayInteractionPanels({
            interactions, useCandidatePanel, useCandidateGuidePanel, useRegenPanel, dismissCandidateError, usePhonePlay: usePhonePlay
        });
        const { HeaderItems: TavernHeaderItems } = createTavernHeaderFeature({
            StatusAction: TavernConversationSettingsAction, ExportAction: TavernConversationExportAction,
            openPage: (ctx, id, sessionId) => openTavernSidebarTab(ctx, { type: id }, { sessionId }),
            openWorldbooks: (node, sessionId) => worldBookSwitcherFeature.open(node, sessionId)
        });

		function register(input) {
			const ctx = input.ctx;
			const slots = input.slots;
			installTavernAssetLaunchers(ctx, slots);
			const uiConversation = ctx.get("uiConversation") || ctx.get("conversation");
			const executeSlash = createTavernFrameSlashExecutor(ctx);
            ctx.effect(() => registerTab(ctx.betterSidebar, {
                id: "dsh-tavern:conversation-settings", title: "本局设置", order: 8, single: true,
                component: props => React.createElement(TavernConversationSettingsTab, { sessionId: props.scope.sessionId, sessions: ctx.sessions })
            }), "dsh-tavern: conversation settings tab");
            // Replace shipped host chrome that is noise in the Tavern profile.
            // Same id + lower priority shadows the host entry (lowest renders).
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "dsh-better-sidebar:bottom-toggle", order: 10, priority: -1 },
                () => null
            )), "dsh-tavern: hide bottom panel toggle");
            ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
                { name: "conversation.session.header.actions", id: "agent-preset", order: -10, priority: -1 },
                () => null
            )), "dsh-tavern: hide host agent-preset label");
            // the host subagent count dropdown is developer chrome in play (the breadcrumb copy is hidden in
            // shell.css). A list slot shadows an id for every session, so the empty entry is registered only while a mounted
            // play session has the debug view off; card sessions and the debug view keep the host entry.
            let playShadowHolds = 0, releasePlayShadow = null;
            function holdPlayShadow() {
                if (playShadowHolds++ === 0) releasePlayShadow = ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
                    { name: "conversation.session.header.actions", id: "subagent-catalog", order: 10, priority: -1 },
                    () => null
                )), "dsh-tavern: hide host subagent catalog in play");
                return function () { if (--playShadowHolds === 0) { releasePlayShadow(); releasePlayShadow = null; } };
            }
            // on a phone the play top bar is the title and ⋯ only. The
            // context diagnostics hourglass (Better Sidebar) is shadowed like the subagent catalog; the rest is CSS under the class.
            let phoneShadowHolds = 0, releasePhoneShadow = null;
            function holdPhoneShadow() {
                const releaseClass = holdPhonePlayClass();
                if (phoneShadowHolds++ === 0) releasePhoneShadow = ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                    { name: "conversation.session.header.utilities", id: "dsh-better-sidebar:context-diagnostics", order: 20, priority: -1 },
                    () => null
                )), "dsh-tavern: hide context diagnostics in phone play");
                return function () { releaseClass(); if (--phoneShadowHolds === 0) { releasePhoneShadow(); releasePhoneShadow = null; } };
            }
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "dsh-fork-play-chrome", order: -190 },
                function (props) {
                    const owner = ctx.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
                    const play = isPlayMode(useTavernSessionMode(owner));
                    const preferences = React.useSyncExternalStore(displayPreferences.subscribe, displayPreferences.snapshot, displayPreferences.snapshot);
                    const hide = play && !(preferences && preferences.hideContextAndReasoning === false);
                    const phone = usePhoneWidth() && hide;
                    React.useEffect(() => hide ? holdPlayShadow() : undefined, [hide]);
                    React.useEffect(() => phone ? holdPhoneShadow() : undefined, [phone]);
                    return null;
                }
            )), "dsh-tavern: play-only host chrome");
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "open-in-app", order: -10, priority: -1 },
                () => null
            )), "dsh-tavern: hide host open-in-app");
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                { name: "conversation.session.header.utilities", id: "session-log-download", order: 0, priority: -1 },
                () => null
            )), "dsh-tavern: hide host session-log-download");
            ctx.effect(() => slots.inject("conversation.session.header.actions", () => slots.register(
                { name: "conversation.session.header.actions", id: "dsh-tavern-immersive", order: 9 },
                () => React.createElement(TavernImmersiveAction)
            )), "dsh-tavern: immersive header action");
            ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
                // the ⋯ menu's phone-play readout row (filled by dsh-tavern-ui with the composer's model and context controls).
                { name: "conversation.session.header.utilities", id: "dsh-tavern-header-items", order: 80, children: { "tavern.play.readout": { kind: "list", scope: "session" } } },
                function (props) {
                    const owner = ctx.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
                    const mode = useTavernSessionMode(owner);
                    if (!mode) return null;
                    return React.createElement(TavernHeaderItems, Object.assign({}, props, { ctx: ctx, sessions: ctx.sessions, openStatus: sessionId => openTavernSidebarTab(ctx, { type: "dsh-tavern:status" }, { sessionId }) }));
                }
            )), "dsh-tavern: header items");
			ctx.effect(() => tavernPanelRegistry.onPin(sessionId => openTavernSidebarTab(ctx, { type: "dsh-tavern:status" }, { sessionId })), "dsh-tavern: reveal pinned panels");
			// the status tab stays open in the right sidebar and the composer's guide icon opens it; by default the
			// top bar has no 酒馆状态 button (TAVERN_HEADER_DEFAULT), the owner can add it in 顶栏设置.
			ctx.effect(() => registerTab(ctx.betterSidebar, {
				id: "dsh-tavern:status",
				title: "酒馆状态",
				icon: function (size) { return React.createElement(StatusTabIcon, { sessions: ctx.sessions, size: size || 16 }); },
				order: 7,
				single: true,
				component: function (props) {
					return React.createElement(TavernStatusTab, { sessions: ctx.sessions, uiConversation: uiConversation, sessionId: props.scope.sessionId, executeSlash: executeSlash, openStyleTab: function (type, meta) { openTavernSidebarTab(ctx, { type: type, meta: meta }, { sessionId: props.scope.sessionId }); } });
				}
			}), "dsh-tavern: Better Sidebar status tab");
			ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-tavern:background-tasks", title: "后台任务", order: 7, single: true,
				component: props => React.createElement(TavernBackgroundTasksTab, { sessionId: props.scope.sessionId }) }), "dsh-tavern: background tasks tab");
			ctx.effect(() => slots.inject("conversation.chat.assistant-actions", () => slots.register(
				{ name: "conversation.chat.assistant-actions", id: "dsh-tavern-rollback-to", order: 19, inject: function (sessionId) { return { sessionId: sessionId }; } },
				TavernRollbackToAction
			)), "dsh-tavern: rollback-to-turn action");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-actions", order: -130, label: "候选项操作" },
				function (props) { return React.createElement(CandidateDockActions, Object.assign({}, props, {
					sessions: ctx.sessions,
					executeCompact: function (sessionId) { return ctx.remote.commands.execute(sessionId, "/compact", []); }
				})); }
			)), "dsh-tavern: candidate dock actions");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-question", order: -120, label: "下一步行动" },
				function (props) { return React.createElement(React.Fragment, null,
					React.createElement(SupersededTurnErrors, Object.assign({}, props, { key: props.sessionId })),
					React.createElement(TurnHistoryProjection, Object.assign({}, props, { key: "history:" + props.sessionId })),
					React.createElement(CandidateQuestion, Object.assign({}, props, { sessions: ctx.sessions }))
				); }
			)), "dsh-tavern: candidate question panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-candidate-guide", order: -115, label: "重新生成候选项" },
				function (props) { return React.createElement(CandidateGuidePanel, props); }
			)), "dsh-tavern: candidate guide panel");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-fork-session-shell", order: -200, label: "会话外壳" },
				function (props) { return React.createElement(React.Fragment, null,
					React.createElement(CardStageHost, { key: "stage:" + props.sessionId, sessionId: props.sessionId, executeSlash: executeSlash }),
					// galgame stage view
					React.createElement(GalStageHost, { key: "gal:" + props.sessionId, sessionId: props.sessionId, Regenerate: GalRegenerate, replayFailed: replayFailedStageTurn, Choices: GalChoices, choiceProps: { useChat: props.useChat, useSession: props.useSession, executeSlash: executeSlash, interruptTurn: interruptStageTurn } })); }
			)), "dsh-tavern: fork session shell");
            ctx.effect(() => slots.inject("conversation.chat.node", () => slots.register({
                name: "conversation.chat.node", key: "manual-compaction", priority: -1
            }, ManualCompactionNodeView)), "dsh-tavern: player compaction result");
            ctx.effect(() => slots.inject("conversation.chat.node", () => slots.register({
                name: "conversation.chat.node", key: "compaction", priority: -1
            }, CompactionNodeView)), "dsh-tavern: player compaction checkpoint");
			ctx.effect(() => slots.inject("conversation.chat.assistant-actions", () => slots.register(
				{ name: "conversation.chat.assistant-actions", id: "dsh-fork-turn-actions", order: 10, inject: function (sessionId) { return { sessionId: sessionId }; } },
				TurnActions
			)), "dsh-tavern: latest round actions under the reply");
			ctx.effect(() => slots.inject("conversation.input.overlay", () => slots.register(
				{ name: "conversation.input.overlay", id: "dsh-fork-jump-latest", order: 10, label: "回到最新" },
				function (props) { return React.createElement(ChatJumpLatest, { key: props.sessionId }); }
			)), "dsh-tavern: chat jump-to-latest");
			ctx.effect(() => slots.inject("conversation.input.left", () => slots.register(
				{ name: "conversation.input.left", id: "dsh-fork-round-actions", order: 10, label: "本轮操作" },
				function (props) { return typeof props.useChat === "function" && typeof props.useSession === "function" ? React.createElement(RoundActionsSeat, Object.assign({}, props, {
					placement: "inline",
					openStatus: function () { return openTavernSidebarTab(ctx, { type: "dsh-tavern:status" }, { sessionId: props.sessionId }); },
					sessions: ctx.sessions,
					refreshSessions: function () { return typeof ctx.sessions.refresh === "function" ? ctx.sessions.refresh() : Promise.resolve(); },
					executeCompact: function (sessionId) { return ctx.remote.commands.execute(sessionId, "/compact", []); }
				})) : null; }
			)), "dsh-tavern: round actions in composer");
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
				{ name: "conversation.session.header.utilities", id: "dsh-card-stage-toggle", order: 84 },
				function (props) { return React.createElement(CardStageToggle, { key: props.sessionId, sessionId: props.sessionId }); }
			)), "dsh-tavern: card stage toggle");
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
				{ name: "conversation.session.header.utilities", id: "dsh-fork-gal-stage-toggle", order: 83 },
				function (props) { return React.createElement(GalStageToggle, { key: props.sessionId, sessionId: props.sessionId }); }
			)), "dsh-tavern: galgame stage toggle");
			// the BGM player's chat placement (bgm-player.js).
			ctx.effect(() => slots.inject("conversation.session.header.utilities", () => slots.register(
				{ name: "conversation.session.header.utilities", id: "dsh-fork-bgm-player", order: 82 },
				function (props) { return React.createElement(BgmChat, { key: props.sessionId, sessionId: props.sessionId }); }
			)), "dsh-tavern: BGM player");
			ctx.effect(() => slots.inject("conversation.input.dock", () => slots.register(
				{ name: "conversation.input.dock", id: "dsh-tavern-regen", order: -110, label: "重新生成正文" },
				function (props) { return React.createElement(React.Fragment, null, React.createElement(RegenPanel, props), React.createElement(BodyEditPanel, props)); }
			)), "dsh-tavern: regen body panel");
		}
		return Object.freeze({ register: register });
		}
		const playControlsFeature = createPlayControlsFeatureModule();
		const assistantRendererFeature = createTavernAssistantRendererFeatureModule();
